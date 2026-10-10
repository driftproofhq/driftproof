// SPDX-License-Identifier: Apache-2.0
'use strict';

// Regrade: the executor behind lib/reuse.js's `regrade` decision (spec 044).
//
// When only the judge (or the grading template) differs between two receipts,
// triage says the existing generations can be rescored. This does it: it takes a
// sealed receipt, the skill it was run on and the answers its draws graded, and
// judges every draw again with the judge it is given. The generation side of the
// new receipt is the original's, draw for draw; the judge side is new.
//
// THE SAME CODE A RUN JUDGES WITH. Each draw goes through lib/run.js judgeCase,
// its replies through lib/run.js attest, each case through lib/sampling.js
// acrossDraws, and the receipt through lib/receipt.js buildReceipt. Nothing here
// grades, aggregates or seals by a second route.
//
// THE DRAW SET IS THE ORIGINAL'S. The sampling rule's escalation decides how many
// generations to draw; with the generations fixed there is nothing for it to
// decide, so `n_planned` and `stopping_reason` are carried and no draw is added.
//
// A DRAW WITH NO ANSWER TO GRADE IS CARRIED, NOT GRADED: one with no
// generation_hash (the generation timed out) or one cut at the output cap (spec
// 026 AC-8), or a files-capture draw whose workspace the run could not collect
// (spec 137 AC-2: its answer was never seen whole, so it stays lost). A draw
// whose original judge gave no score has an answer and is graded.
//
// A RUBRIC REGRADE (spec 184) is the same regrade with the original's judge and a revised suite whose
// cases differ from the original's only in `rubric` and `pass_threshold`, and, in a case that lists
// criteria objects (spec 185 A-185-8), its `criteria`. Every answer is graded under the revised rubric,
// criteria and threshold, and the new receipt carries the revised suite_hash. The answers it reads are
// the ones `run --keep-transcripts` keeps, every draw's, in answers.json.

const fs = require('fs');
const path = require('path');
const { sha256, sha256Canonical, canonicalize } = require('./canonical');
const { suiteIdentity, criteriaOf, listsCriteria } = require('./skill');
const { SUITE_FORMAT } = require('../config');
const { judgeCase, attest, outcomeFor, resolveCallTimeoutMs, criteriaJudgments } = require('./run');
const { judgeSettings, promptTemplateHash, caseRubricHash } = require('./judge');
const { buildReceipt, verifyReceiptHash, FAILED_STATUSES, REGRADE_SIDECAR } = require('./receipt');
const { acrossDraws } = require('./sampling');
const { resolveModel, surfaceForModel, isMeteredSurface } = require('./provider');
const { priceForModel, assertRegistered } = require('./models');
const { perCallCostUSD } = require('./cost');
const { buildPricingSnapshot, computeEconomics } = require('./value');
const { canonicalModelId } = require('./usage');
const { RUNNER_VERSION } = require('../config');
const { lostAnswer } = require('./capture');

const isTimeout = (e) => !!(e && (e.code === 'TIMEOUT' || /tim(e|ed)\s*out/i.test(String((e && e.message) || ''))));

// Spec 137 AC-2: a files-capture draw carries its captured_files once its workspace was
// collected; one without them is a draw the run lost because the collection did not complete.
function uncollected(d, receipt) {
  const capture = receipt && receipt.run && receipt.run.capture;
  return !!(capture && capture.mode === 'files') && !Array.isArray(d.captured_files);
}

// Whether a draw carries an answer the judge can grade.
function gradable(d, receipt) { return !!(d && d.generation_hash && d.truncated !== true) && !uncollected(d, receipt); }

// Every draw to grade, with its case and mode, in receipt order.
function drawsToGrade(receipt) {
  const out = [];
  for (const c of receipt.results.cases) for (const d of ((c.generation || {}).draws || [])) if (gradable(d, receipt)) out.push({ c, d });
  return out;
}

// The answer check (AC-4): every draw to grade has an answer, and each answer is
// the text its generation_hash was taken over. An answer that fails either is a
// regrade of something no model wrote.
function answerProblems(receipt, answers) {
  const bad = [];
  for (const { c, d } of drawsToGrade(receipt)) {
    const where = `${c.id}/${c.mode} draw ${d.draw_index}`;
    const text = answers[d.generation_hash];
    if (typeof text !== 'string') bad.push(`${where}: no answer for generation_hash ${d.generation_hash.slice(0, 12)}`);
    else if (sha256(text) !== d.generation_hash) bad.push(`${where}: the answer's sha256 is not its generation_hash ${d.generation_hash.slice(0, 12)}`);
  }
  return bad;
}

// ── the answers a run kept, and where a regrade reads them (spec 184) ────────
// answers.json: { format, receipt_hash, model_id, answers: { <sha256>: <text> }, draws: [row] }. Each
// row is one draw, in receipt order: its case, mode and draw index, the receipt's generation_hash and
// status, the sha256 of the answer kept (null when none came back) and the judge outputs that came
// back for it. One text is one `answers` entry however many draws returned it. `answers` is the shape
// `regrade --answers` has always read, so the file is read as it is.
const ANSWERS_FORMAT = 'driftproof-answers/2';
const ANSWERS_ARCHIVE = 'answers.json';

// `kept` is lib/run.js runSkillOnModel's `answers`. Nothing is made up for a draw with no answer.
function answersArchive({ receipt, kept }) {
  const answers = {};
  const draws = [];
  for (const k of kept || []) {
    const text = typeof k.answer === 'string' && k.answer ? k.answer : null;
    const h = text === null ? null : sha256(text);
    if (h !== null && !Object.hasOwn(answers, h)) answers[h] = text;
    draws.push({ id: k.id, mode: k.mode, draw_index: k.draw_index, generation_hash: k.generation_hash || null, answer_sha256: h, status: k.status, judge_outputs: Array.isArray(k.judge_outputs) ? k.judge_outputs : [] });
  }
  return { format: ANSWERS_FORMAT, receipt_hash: receipt.receipt_hash, model_id: receipt.run.model_id, answers, draws };
}

// What `--answers` names: a file (its `answers`, whatever its format), or a transcripts directory (its
// answers.json, else, in an archive written before spec 184, each per-case file's generation keyed by
// its sha256). An older archive reads as what it holds: the last measured draw of each case and mode.
// -> { answers, source: { kind, file, sha256 } }
function readAnswers(p) {
  const abs = path.resolve(p);
  const answersOf = (bytes) => (JSON.parse(bytes.toString('utf8')) || {}).answers || {};
  if (!fs.statSync(abs).isDirectory()) {
    const bytes = fs.readFileSync(abs);
    return { answers: answersOf(bytes), source: { kind: 'file', file: path.basename(abs), sha256: sha256(bytes) } };
  }
  const archived = path.join(abs, ANSWERS_ARCHIVE);
  if (fs.existsSync(archived)) {
    const bytes = fs.readFileSync(archived);
    return { answers: answersOf(bytes), source: { kind: 'archive', file: `${path.basename(abs)}/${ANSWERS_ARCHIVE}`, sha256: sha256(bytes) } };
  }
  const answers = {};
  for (const name of fs.readdirSync(abs).filter((f) => f.endsWith('.json') && f !== 'index.json').sort()) {
    let t = null;
    try { t = JSON.parse(fs.readFileSync(path.join(abs, name), 'utf8')); } catch (_e) { continue; }
    if (t && typeof t.generation === 'string' && t.generation) answers[sha256(t.generation)] = t.generation;
  }
  return { answers, source: { kind: 'legacy-archive', file: path.basename(abs), sha256: sha256Canonical(answers) } };
}

// A suite's case list as written, in the three shapes lib/skill.js normalizeCases reads; null if none.
function rawCases(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.cases)) return raw.cases;
  if (raw && Array.isArray(raw.evals)) return raw.evals;
  return null;
}

// The revised suite of a rubric regrade, normalised and hashed by the code a run hashes a suite with,
// and its cases as written (A-184-2): normalisation turns a threshold that is not a number into 0.7
// and drops a key it does not read, so the comparison reads the file, not only the normalised cases.
function readRevisedSuite(file) {
  const abs = path.resolve(file);
  const bytes = fs.readFileSync(abs);
  const raw = JSON.parse(bytes.toString('utf8'));
  const { cases, suiteHash } = suiteIdentity(raw);
  return { format: SUITE_FORMAT, suiteHash, caseCount: cases.length, cases, raw: rawCases(raw), file: path.basename(abs), sha256: sha256(bytes) };
}

// The original suite's cases as written: the skill's own evals/evals.json, read again and held to the
// hash the skill was loaded with, so the bytes compared are the bytes the receipt's suite_hash covers.
function originalRawCases(skill) {
  if (!skill || !skill.dir) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(skill.dir, 'evals', 'evals.json'), 'utf8'));
    return suiteIdentity(raw).suiteHash === skill.suite.suiteHash ? rawCases(raw) : null;
  } catch (_e) { return null; }
}

// Which grading fields changed, case by case, read on the normalised cases. -> [{ id, fields }]
// Spec 185 (A-185-8): a criteria case's criteria are a grading field; a case without them has none,
// so its reading is spec 184's.
const GRADING_FIELDS = ['criteria', 'pass_threshold', 'rubric'];
function gradingChanges(original, revised) {
  const changed = [];
  for (const k of revised.cases) {
    const o = original.cases.find((x) => x.id === k.id);
    if (!o) continue;
    const fields = GRADING_FIELDS.filter((f) => canonicalize(o[f]) !== canonicalize(k[f]));
    if (fields.length) changed.push({ id: k.id, fields });
  }
  return changed;
}

// What a rubric regrade may change: each case's rubric and pass_threshold, nothing else. A case id
// changed, added or removed, a changed order, any other field, or no change at all is a problem, named.
// A-184-2: the fields are read as written. The rubric is the key the original case's rubric was read
// from (rubric, criteria or expected), and must be a non-empty string; the threshold is the original's
// threshold key (pass_threshold or threshold, pass_threshold when it had none), and must be a number
// in [0, 1]. Any other key that differs, a key the original case does not carry, or a key the revised
// case drops is refused. `originalRaw` is the original's cases as written.
// Spec 185 (A-185-8): a case whose original lists criteria objects (lib/skill.js listsCriteria) may
// change its criteria, held to the checks a run applies (criteriaOf), and its rubric key is `rubric` or
// `expected`, never `criteria`. A case may not change shape, from criteria objects to none or back:
// that is refused, named. A case with no criteria objects is read as above.
// -> { problems, changed: [{ id, fields }] }, changed in the revised suite's order.
function suiteDifferences(original, revised, originalRaw) {
  const problems = [];
  const was = original.cases.map((c) => c.id);
  const now = revised.cases.map((c) => c.id);
  const removed = was.filter((id) => !now.includes(id));
  const added = now.filter((id) => !was.includes(id));
  for (const id of removed) problems.push(`case ${id} is removed in the revised suite`);
  for (const id of added) problems.push(`case ${id} is added in the revised suite`);
  if (!removed.length && !added.length && canonicalize(was) !== canonicalize(now)) problems.push(`the case order differs: ${was.join(', ')} in the original, ${now.join(', ')} in the revised suite`);
  if (!Array.isArray(originalRaw) || originalRaw.length !== original.cases.length || !Array.isArray(revised.raw) || revised.raw.length !== revised.cases.length) {
    problems.push("the original suite or the revised one cannot be read as written, so the two cannot be compared field by field");
    return { problems, changed: [] };
  }
  revised.cases.forEach((nk, j) => {
    const i = was.indexOf(nk.id);
    if (i < 0) return;
    const o = originalRaw[i] || {};
    const k = revised.raw[j] || {};
    const listedWas = listsCriteria(o);
    const listedNow = listsCriteria(k);
    const shape = (x) => (x ? 'criteria objects' : 'a rubric');
    if (listedWas !== listedNow) {
      problems.push(`case ${nk.id}: the case changes shape, from ${shape(listedWas)} in the original to ${shape(listedNow)} in the revised case; a rubric regrade keeps each case's shape`);
      return;
    }
    if (listedWas) {
      try { criteriaOf(k.criteria, nk.id); } catch (e) { problems.push(e.message); }
    }
    const rubricKey = (listedWas ? ['rubric', 'expected'] : ['rubric', 'criteria', 'expected']).find((f) => o[f]) || 'rubric';
    const thresholdKey = typeof o.pass_threshold === 'number' ? 'pass_threshold' : typeof o.threshold === 'number' ? 'threshold' : 'pass_threshold';
    for (const f of [...new Set([...Object.keys(o), ...Object.keys(k)])].sort()) {
      const inO = Object.hasOwn(o, f);
      const inK = Object.hasOwn(k, f);
      // Both lists are criteria (the shapes agree), and the revised one was held to criteriaOf above.
      if (listedWas && f === 'criteria') continue;
      if (f === thresholdKey && inK) {
        if (typeof k[f] !== 'number' || !Number.isFinite(k[f]) || k[f] < 0 || k[f] > 1) problems.push(`case ${nk.id}: ${f} ${JSON.stringify(k[f])} is not a number in [0, 1]`);
        if (inO || f === 'pass_threshold') continue;
      }
      if (!inO) { problems.push(`case ${nk.id}: the key ${f} is not in the original case; a rubric regrade changes only the rubric and the pass threshold`); continue; }
      if (!inK) { problems.push(`case ${nk.id}: the key ${f} is missing from the revised case`); continue; }
      if (f === rubricKey) {
        if (typeof k[f] !== 'string' || !k[f].trim()) problems.push(`case ${nk.id}: ${f} is not a non-empty string`);
        continue;
      }
      if (canonicalize(o[f]) !== canonicalize(k[f])) problems.push(`case ${nk.id}: the field ${f} differs from the original's; a rubric regrade changes only rubric and pass_threshold`);
    }
  });
  const changed = gradingChanges(original, revised);
  if (!problems.length && !changed.length) problems.push("nothing differs: the revised suite is the original's, so there is no revised rubric to grade under");
  return { problems, changed };
}

// A-184-4, A-184-5: a rubric regrade changes the rubric only, so the judge, its sample count and its
// prompt template are the original's. Checked here, where every caller passes, before any call.
function sameGrader({ receipt, judgeModel, samples }) {
  const j = (receipt.run && receipt.run.judge) || {};
  const problems = [];
  if (!j.model_id || canonicalModelId(resolveModel(judgeModel)) !== canonicalModelId(resolveModel(j.model_id))) problems.push(`a rubric regrade keeps the original's judge ${j.model_id || '(none recorded)'}, and ${judgeModel} is another; regrade with another judge without --rubric`);
  if (samples !== j.samples) problems.push(`judge samples ${samples}, not the original's ${Number.isInteger(j.samples) ? j.samples : '(none recorded)'}: a rubric regrade keeps the original's sample count`);
  const template = promptTemplateHash();
  if (j.prompt_template_hash !== template) problems.push(`the original's judge prompt_template_hash ${j.prompt_template_hash ? `${String(j.prompt_template_hash).slice(0, 12)}…` : '(none recorded)'} is not this runner's ${template.slice(0, 12)}…: the regrade would change the judge template as well as the rubric`);
  return problems;
}

// Everything that must hold before the first call, and what the regrade will
// cost. No call is made. `revised` is a rubric regrade's suite (spec 184).
// -> { problems, draws, calls, usd }
function planRegrade({ receipt, skill, answers, judgeModel, samples, revised = null }) {
  const problems = [];
  if (!verifyReceiptHash(receipt)) problems.push('the receipt_hash does not verify: the receipt was edited after it was sealed');
  if (skill.contentHash !== receipt.skill.content_hash) problems.push(`the skill's content_hash ${String(skill.contentHash).slice(0, 12)} is not the receipt's ${String(receipt.skill.content_hash).slice(0, 12)}`);
  if (skill.suite.suiteHash !== receipt.suite.suite_hash) problems.push(`the suite's hash ${String(skill.suite.suiteHash).slice(0, 12)} is not the receipt's ${String(receipt.suite.suite_hash).slice(0, 12)}`);
  // One row per (case, mode) (spec 044 A-044-4): a receipt with two rows for one case and mode
  // is ambiguous, which spec 050's validation refuses; refused here before any call, not after the
  // spend.
  const rows = new Set();
  for (const c of receipt.results.cases) {
    const key = `${c.id}\u0000${c.mode}`;
    if (rows.has(key)) problems.push(`case ${c.id}/${c.mode} appears in more than one row; the receipt is ambiguous`);
    rows.add(key);
  }
  for (const c of receipt.results.cases) {
    if (!skill.suite.cases.some((k) => k.id === c.id)) problems.push(`case ${c.id} is not in the suite`);
    if (!c.generation || !Array.isArray(c.generation.draws)) problems.push(`case ${c.id}/${c.mode} carries no draw set; a pre-v0.5 receipt cannot be regraded draw by draw`);
  }
  // Spec 184 (R-4): the grader is the original's, and the revised suite is compared with the original
  // the skill was checked to carry, both as written.
  if (revised) problems.push(...sameGrader({ receipt, judgeModel, samples }));
  if (revised && !problems.length) problems.push(...suiteDifferences(skill.suite, revised, originalRawCases(skill)).problems);
  if (!problems.length) problems.push(...answerProblems(receipt, answers));
  const draws = problems.length ? 0 : drawsToGrade(receipt).length;
  const calls = draws * samples;
  const usd = Math.round(calls * perCallCostUSD(resolveModel(judgeModel), 'judge') * 1e4) / 1e4;
  return { problems, draws, calls, usd };
}

// The generation side of a draw, carried as it was.
function generationSide(d) {
  const g = { stop_reason: d.stop_reason === undefined ? null : d.stop_reason, truncated: d.truncated === true, reported_model: d.reported_model === undefined ? null : d.reported_model };
  // Spec 137: the files the draw's answer carries are generation side too, and the next regrade
  // reads the answer with them.
  if (Array.isArray(d.captured_files)) g.captured_files = d.captured_files.map((f) => ({ path: f.path, bytes: f.bytes, included: f.included === true }));
  // Issue 134: the generation's auxiliary calls are generation side too; its judge's are replaced by
  // the regrade's own.
  const aux = Array.isArray(d.auxiliary_calls) ? d.auxiliary_calls.filter((x) => x && x.phase === 'generation') : [];
  if (aux.length) g.auxiliary_calls = aux.map((x) => ({ ...x }));
  return g;
}

// Regrade one sealed receipt. opts: { trusted, budget, timeoutMs, onProgress, nowIso }. `revised` is a
// rubric regrade's suite (spec 184): each case is graded under its rubric and threshold.
// -> { receipt, provenance, calls }
async function regradeReceipt({ receipt, skill, answers, judgeModel, samples, revised = null, opts = {} }) {
  const suite = revised || skill.suite;
  const judge = resolveModel(judgeModel);
  const modelId = receipt.run.model_id;
  assertRegistered(judge, 'judge model');
  const trusted = !!opts.trusted;
  const budget = opts.budget || null;
  const onProgress = opts.onProgress || (() => {});
  const timeoutMs = resolveCallTimeoutMs(surfaceForModel(judge), opts);
  const judgedAt = new Date().toISOString();

  let calls = 0;
  const replies = [];
  const cases = [];
  for (const orig of receipt.results.cases) {
    const caseObj = suite.cases.find((k) => k.id === orig.id);
    const mode = orig.mode;
    const draws = [];
    let last = null;
    for (const d of orig.generation.draws) {
      if (!gradable(d, receipt)) { draws.push(JSON.parse(JSON.stringify(d))); continue; }
      const gen = generationSide(d);
      const usage = d.usage ? { usage: d.usage } : {};
      // Spec 137 R-4, R-5: the same reading the runner applies before a judge sees an answer. An
      // answer that points at a file it does not include, or only describes work, is a lost draw
      // here too, never a score, and no judge call is made for it. The files are the draw's own
      // captured_files, as the runner's workspace was; none in text capture or before v0.10.
      const lost = lostAnswer(answers[d.generation_hash], d.captured_files);
      if (lost) {
        draws.push({ draw_index: d.draw_index, generation_hash: d.generation_hash, status: 'unmeasured', reason: lost.reason.slice(0, 200), samples: [], mean: null, stddev: null, ...gen, ...usage });
        continue;
      }
      onProgress({ case: orig.id, mode, phase: 'judge', draw: d.draw_index, samples });
      let jr;
      try {
        jr = await judgeCase({ caseObj, response: answers[d.generation_hash], generationHash: d.generation_hash, judgeModel: judge, mode, timeoutMs, samples, trusted });
      } catch (e) {
        if (!isTimeout(e)) throw e;
        if (budget) budget.add((e.judgeAttempts || 1) * perCallCostUSD(judge, 'judge'));
        draws.push({ draw_index: d.draw_index, generation_hash: d.generation_hash, status: 'unmeasured', reason: String((e && e.message) || 'timeout').slice(0, 200), samples: [], mean: null, stddev: null, ...gen, ...usage });
        continue;
      }
      calls += samples;
      const judgeAux = [];
      for (const reply of (jr.replies || [])) {
        if (!reply) continue;
        replies.push(reply);
        for (const x of (attest(reply, judgeModel, 'judge').auxiliary || [])) judgeAux.push({ phase: 'judge', ...x });
      }
      if (judgeAux.length) gen.auxiliary_calls = [...(gen.auxiliary_calls || []), ...judgeAux];
      if (budget) budget.add((jr.attempts || samples) * perCallCostUSD(judge, 'judge'));
      if (jr.unmeasured) {
        const u = { draw_index: d.draw_index, generation_hash: d.generation_hash, status: 'unmeasured', reason: String(jr.reason || '').slice(0, 200), samples: [], mean: null, stddev: null, ...gen };
        if ((jr.sampleHashes || []).length) u.judge_sample_hashes = jr.sampleHashes;
        Object.assign(u, usage);
        if (jr.judge_usage) u.judge_usage = jr.judge_usage;
        draws.push(u);
        continue;
      }
      const m = {
        draw_index: d.draw_index, generation_hash: d.generation_hash, status: 'measured',
        samples: jr.caseResult.samples, judge_sample_hashes: jr.caseResult.judge_sample_hashes,
        mean: jr.caseResult.mean, stddev: jr.caseResult.stddev, ...gen, ...usage,
      };
      if (jr.caseResult.judge_usage) m.judge_usage = jr.caseResult.judge_usage;
      // Spec 185 (R-8): a criteria case's draw records its judgments, as a run's does.
      Object.assign(m, criteriaJudgments(jr));
      draws.push(m);
      last = jr;
    }
    const agg = acrossDraws(draws);
    const generation = {
      n_planned: orig.generation.n_planned,
      n_drawn: agg.n_drawn,
      n_measured: agg.n_measured,
      n_unmeasured: agg.n_unmeasured,
      stopping_reason: orig.generation.stopping_reason,
      mean: agg.mean,
      sd: agg.sd,
      judge_sd_mean: agg.judge_sd_mean,
      variance_ratio: agg.variance_ratio,
      variance_ratio_unavailable: agg.variance_ratio_unavailable,
      n_truncated: draws.filter((x) => x.truncated === true).length,
      draws,
    };
    if (!last) {
      const nonTimeout = draws.some((x) => x.status === 'unmeasured' && !/tim(e|ed)\s*out/i.test(String(x.reason || '')));
      const reason = [...draws].reverse().map((x) => x.reason).find(Boolean) || 'timeout';
      cases.push({ id: orig.id, mode, case_status: nonTimeout ? FAILED_STATUSES[1] : FAILED_STATUSES[0], reason, generation });
      continue;
    }
    const caseResult = { ...last.caseResult, generation };
    caseResult.mean = agg.mean;
    caseResult.score = agg.mean;
    caseResult.stddev = agg.sd;
    caseResult.outcome = outcomeFor(agg.mean, agg.sd, caseObj.pass_threshold);
    onProgress({ case: orig.id, mode, phase: 'done', outcome: caseResult.outcome, score: caseResult.mean, stddev: caseResult.stddev });
    cases.push(caseResult);
  }

  // What answered the judge. A stub judge graded nothing: its receipt is UNVERIFIED
  // with judge surface stub, whatever answered the generations (spec 026 AC-1).
  const judgeStub = replies.length > 0 && replies.every((r) => r.answeredBy === 'stub');
  const judgeModelAnswered = replies.length > 0 && replies.every((r) => r.answeredBy === 'model');
  const judgeBlock = { ...judgeSettings(samples, judge), ...(judgeStub ? { surface: 'stub' } : {}), model_id: judge, prompt_template_hash: promptTemplateHash() };
  const nowIso = opts.nowIso || new Date().toISOString();
  const surface = receipt.run.surface;
  const pricingSnapshot = buildPricingSnapshot({ models: [modelId, judge], lookup: priceForModel, nowIso });
  const economics = computeEconomics({ cases, modelId, judgeModelId: judge, pricingSnapshot, surface, meteredSurface: isMeteredSurface(surface) });

  // v0.8 (spec 043 AC-4). Every arm was generated in an earlier run, so each is archived:
  // its own model and generation time, carried from the original (the original's own arm
  // override where it has one, else its run's), and its own counts, because an archived arm
  // never inherits run.counts. lib/counts.js placeCounts places counts for arms generated in
  // this run and none is, so they are placed here by its rule: at arm scope when every case
  // of the arm has the same count, else on each case that has one. Nothing is generated in
  // a regrade, so the receipt carries no run.generated_at and no run.counts.
  const arms = {};
  for (const mode of ['with_skill', 'baseline']) {
    const modeCases = cases.filter((c) => c.mode === mode);
    if (!modeCases.length) continue;
    const a = (receipt.run.arms && receipt.run.arms[mode]) || {};
    arms[mode] = { model_id: a.model_id || modelId, generated_at: a.generated_at || receipt.run.generated_at || receipt.run.date_utc };
    const perCase = modeCases.map((c) => ({
      c,
      counts: {
        ...(c.generation && Array.isArray(c.generation.draws) ? { generations_per_arm: c.generation.draws.length } : {}),
        ...(!c.case_status ? { judge_samples_per_generation: samples } : {}),
      },
    }));
    for (const kind of ['generations_per_arm', 'judge_samples_per_generation']) {
      const values = perCase.map((x) => (Number.isInteger(x.counts[kind]) ? x.counts[kind] : null));
      if (values.every((v) => v !== null) && new Set(values).size === 1) arms[mode].counts = { ...(arms[mode].counts || {}), [kind]: values[0] };
      else for (const x of perCase) if (Number.isInteger(x.counts[kind])) x.c.counts = { ...(x.c.counts || {}), [kind]: x.counts[kind] };
    }
  }
  const graderRevision = {
    prompt_template_hash: judgeBlock.prompt_template_hash,
    // Spec 185 (R-7): the hash each case row records, criteria and all, under the suite it was graded by.
    rubric_hashes: cases.map((c) => { const k = suite.cases.find((x) => x.id === c.id); return k ? caseRubricHash(k) : null; }),
  };
  // Spec 184 (R-5): a rubric regrade's receipt names the suite it graded under. The canary is the
  // original's: it is derived from the case ids, which a rubric regrade does not change.
  const out = buildReceipt({
    skill: { name: receipt.skill.name, version: receipt.skill.version, contentHash: receipt.skill.content_hash, tokens: receipt.skill.tokens },
    suite: { format: receipt.suite.format, suiteHash: revised ? revised.suiteHash : receipt.suite.suite_hash, caseCount: receipt.suite.case_count, canary: receipt.suite.canary },
    run: {
      model_id: modelId,
      model_release_date: receipt.run.model_release_date,
      provider: receipt.run.provider,
      surface,
      surface_overhead_note: receipt.run.surface_overhead_note,
      runner_version: RUNNER_VERSION,
      date_utc: nowIso,
      registry: receipt.run.registry,
      transcripts: 'hashes-only',
      judge: judgeBlock,
      pricing_snapshot: pricingSnapshot,
      answered_by: receipt.run.answered_by,
      // Spec 137: the generation side is the original's, so its capture mode is too, when it says.
      capture: receipt.run.capture,
      // Spec 137 priority 5: and so is the harness that produced the answers, when it says.
      harness: receipt.run.harness,
      // Spec 139: a regrade of a smoke run is still a smoke run (its cases are at most the preset's),
      // so it carries the preset, and the schema refuses it at TESTED as it refuses the original.
      ...(receipt.run.preset ? { preset: receipt.run.preset } : {}),
      arms,
      judged_at: judgedAt,
      grader_revision: graderRevision,
    },
    cases,
    economics,
    verificationLevel: receipt.verification_level === 'TESTED' && judgeModelAnswered ? 'TESTED' : 'UNVERIFIED',
  });

  // Where the regrade came from: what v0.8 has no field for. The judge time, the grader
  // revision and the archived arms are in the receipt (spec 043 AC-4) and are not repeated
  // here; this sidecar is bound to the receipt by its hash.
  const provenance = {
    format: REGRADE_SIDECAR.format,
    receipt_hash: out.receipt_hash,
    regraded_from: { receipt_hash: receipt.receipt_hash, runner_version: receipt.run.runner_version, date_utc: receipt.run.date_utc, judge: receipt.run.judge },
    generated_at_basis: receipt.run.generated_at || (receipt.run.arms && Object.values(receipt.run.arms).some((x) => x && x.generated_at))
      ? "the original receipt's own generated_at"
      : "the original receipt's run.date_utc: a receipt of that schema records no separate generation time",
    draws: { graded: drawsToGrade(receipt).length, carried: receipt.results.cases.reduce((a, c) => a + c.generation.draws.length, 0) - drawsToGrade(receipt).length },
    judge_reported_models: [...new Set(replies.flatMap((r) => (r.reportedModels || []).map((id) => canonicalModelId(id))))].sort(),
    calls,
    // Spec 184 (R-5): what a rubric regrade changed, and that it generated nothing.
    ...(revised ? {
      rubric_revision: {
        file: revised.file || null,
        sha256: revised.sha256 || null,
        original_suite_hash: receipt.suite.suite_hash,
        revised_suite_hash: revised.suiteHash,
        cases_changed: gradingChanges(skill.suite, revised),
        note: "a regrade of the original receipt's saved answers under a revised rubric: no answer was generated, and the generation side of every draw is the original's",
      },
    } : {}),
  };
  return { receipt: out, provenance, calls };
}

module.exports = {
  regradeReceipt, planRegrade, answerProblems, drawsToGrade, gradable,
  answersArchive, readAnswers, readRevisedSuite, suiteDifferences, ANSWERS_FORMAT, ANSWERS_ARCHIVE,
};
