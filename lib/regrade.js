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
const { readRequired, SUITE_MAX_BYTES, suiteIdentity, criteriaOf, listsCriteria } = require('./skill');
const { SUITE_FORMAT } = require('../config');
const { judgeCase, attest, outcomeFor, resolveCallTimeoutMs, criteriaJudgments, criteriaTemplate, judgeEnvironment: judgeSettingOf, judgeSnapshotIds } = require('./run');
const { judgeSettings, promptTemplateHash, caseRubricHash, criteriaTemplateHash } = require('./judge');
const { buildReceipt, verifyReceiptHash, FAILED_STATUSES, REGRADE_SIDECAR, kindOf, deliveryOf } = require('./receipt');
// Spec 265 AC-74: a regrade derives a receipt from another, so a marked receipt is refused first: it
// carries printed figures and no answers, and nothing in it could be graded again.
const { receiptAggregatesOnly, AGGREGATES_ONLY_LINE } = require('./verdict');
const MARKED_REGRADE = `the receipt carries the mark, ${AGGREGATES_ONLY_LINE}; it holds no answers, so there is nothing to regrade`;
const { acrossDraws } = require('./sampling');
const { resolveModel, surfaceForModel, isMeteredSurface, inferProvider, ROUTING_VARIABLES } = require('./provider');
const { stubEnabled } = require('./stub');
const { priceForModel, assertRegistered } = require('./models');
const { perCallCostUSD } = require('./cost');
const { buildPricingSnapshot, computeEconomics } = require('./value');
const { canonicalModelId } = require('./usage');
const { RUNNER_VERSION, DEV_MAX_CALLS } = require('../config');
const { lostAnswer } = require('./capture');

const isTimeout = (e) => !!(e && (e.code === 'TIMEOUT' || /tim(e|ed)\s*out/i.test(String((e && e.message) || ''))));
// Issue 196 (A-184-24): what a draw whose judge call timed out records as its reason.
const JUDGE_TIMEOUT_REASON = 'the judge call timed out after its retries, so no score was given';

// Spec 137 AC-2: a files-capture draw carries its captured_files once its workspace was
// collected; one without them is a draw the run lost because the collection did not complete.
function uncollected(d, receipt) {
  const capture = receipt && receipt.run && receipt.run.capture;
  return !!(capture && capture.mode === 'files') && !Array.isArray(d.captured_files);
}

// Whether a draw carries an answer the judge can grade.
function gradable(d, receipt) { return !!(d && d.generation_hash && d.truncated !== true) && !uncollected(d, receipt); }

// Every draw with an answer to check, with its case and mode, in receipt order.
function drawsToGrade(receipt) {
  const out = [];
  for (const c of receipt.results.cases) for (const d of ((c.generation || {}).draws || [])) if (gradable(d, receipt)) out.push({ c, d });
  return out;
}

// THE ONE READING OF WHETHER A DRAW REACHES THE JUDGE (issue 196, A-184-9). Planning, the cost guards,
// execution and the recorded counts all read it. A draw with no answer to grade is carried; a draw
// whose answer lostAnswer reads as lost (spec 137 R-4, R-5: it points at a file it does not include,
// or only describes work) is lost, and no judge call is made for it; any other is judged. Read only
// after answerProblems has found every answer. -> { carry } | { lost } | { judge }
function readingOf(d, receipt, answers) {
  if (!gradable(d, receipt)) return { carry: true };
  // The files are the draw's own captured_files, as the runner's workspace was; none in text capture
  // or before v0.10.
  const lost = require('./text-capture').textFakeToolCall(answers[d.generation_hash], receipt.run.capture?.mode) || lostAnswer(answers[d.generation_hash], d.captured_files);
  return lost ? { lost } : { judge: true };
}

// Every draw that reaches the judge, with its case and mode, in receipt order.
function drawsToJudge(receipt, answers) {
  return drawsToGrade(receipt).filter(({ d }) => readingOf(d, receipt, answers).judge);
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

// Issue 212: bounds are checked before reading, parsing, copying or hashing answers.
const ANSWER_BYTES = 16777216;
const ANSWER_TEXT_BYTES = 1048576;
const ANSWER_ENTRIES = 4096;
function inputRefusal(why) {
  return Object.assign(new Error('regrade refused, nothing run: ' + why), { code: 'REGRADE_REFUSED' });
}
function answerBounds(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return 'answers must be an object';
  let count = 0, total = 0;
  for (const key in answers) {
    if (!Object.hasOwn(answers, key)) continue;
    if (++count > ANSWER_ENTRIES) return 'answers exceed 4096 entries';
    if (key.length !== 64 || !/^[a-f0-9]{64}$/.test(key)) return 'an answer key is not a 64-character sha256';
    const text = answers[key];
    if (typeof text !== 'string') return 'an answer is not text';
    if (text.length > ANSWER_TEXT_BYTES || Buffer.byteLength(text, 'utf8') > ANSWER_TEXT_BYTES) return 'an answer exceeds 1048576 bytes';
    total += Buffer.byteLength(text, 'utf8');
    if (total > ANSWER_BYTES) return 'answers exceed 16777216 bytes';
  }
  return null;
}
// A fixed chunk limits reads even if the file grows after fstat. No readFileSync on an archive.
function boundedAnswerFile(file, remaining = ANSWER_BYTES) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > remaining) throw inputRefusal('answers archive exceeds 16777216 bytes or is not a regular file');
    const chunks = [], chunk = Buffer.alloc(65536);
    let size = 0;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, remaining - size + 1), null);
      if (!n) break;
      size += n;
      if (size > remaining) throw inputRefusal('answers archive exceeds 16777216 bytes');
      chunks.push(Buffer.from(chunk.subarray(0, n)));
    }
    return Buffer.concat(chunks, size);
  } finally { fs.closeSync(fd); }
}
function parseAnswers(bytes) {
  let raw;
  try { raw = JSON.parse(bytes.toString('utf8')); } catch (_) { throw inputRefusal('answers archive is not valid JSON'); }
  const answers = raw && raw.answers;
  const problem = answerBounds(answers);
  if (problem) throw inputRefusal(problem);
  return answers;
}

// What `--answers` names: a file (its `answers`, whatever its format), or a transcripts directory (its
// answers.json, else, in an archive written before spec 184, each per-case file's generation keyed by
// its sha256). An older archive reads as what it holds: the last measured draw of each case and mode.
// -> { answers, source: { kind, file, sha256 } }
function readAnswers(p) {
  const abs = path.resolve(p);
  const answersOf = parseAnswers;
  if (!fs.statSync(abs).isDirectory()) {
    const bytes = boundedAnswerFile(abs);
    return { answers: answersOf(bytes), source: { kind: 'file', file: path.basename(abs), sha256: sha256(bytes) } };
  }
  const archived = path.join(abs, ANSWERS_ARCHIVE);
  if (fs.existsSync(archived)) {
    const bytes = boundedAnswerFile(archived);
    return { answers: answersOf(bytes), source: { kind: 'archive', file: `${path.basename(abs)}/${ANSWERS_ARCHIVE}`, sha256: sha256(bytes) } };
  }
  const answers = {}, names = [];
  // opendir reads incrementally instead of allocating an unbounded directory list.
  const directory = fs.opendirSync(abs);
  try {
    let entry;
    while ((entry = directory.readSync())) {
      if (!entry.name.endsWith('.json') || entry.name === 'index.json') continue;
      if (names.length >= ANSWER_ENTRIES) throw inputRefusal('legacy answers exceed 4096 files');
      names.push(entry.name);
    }
  } finally { directory.closeSync(); }
  let total = 0;
  for (const name of names.sort()) {
    const bytes = boundedAnswerFile(path.join(abs, name), ANSWER_BYTES - total);
    total += bytes.length;
    let t = null;
    try { t = JSON.parse(bytes.toString('utf8')); } catch (_e) { continue; }
    if (t && typeof t.generation === 'string' && t.generation) {
      if (t.generation.length > ANSWER_TEXT_BYTES || Buffer.byteLength(t.generation) > ANSWER_TEXT_BYTES) throw inputRefusal('an answer exceeds 1048576 bytes');
      answers[sha256(t.generation)] = t.generation;
    }
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
// Issue 196 (A-184-15): `text` is the file as read, which planRegrade and regradeReceipt hold the
// rest to.
function readRevisedSuite(file) {
  const abs = path.resolve(file);
  const bytes = readRequired(abs, abs, SUITE_MAX_BYTES, 'SUITE_MAX_BYTES');
  const text = bytes.toString('utf8');
  const raw = JSON.parse(text);
  const { cases, suiteHash } = suiteIdentity(raw);
  return { format: SUITE_FORMAT, suiteHash, caseCount: cases.length, cases, raw: rawCases(raw), file: path.basename(abs), sha256: sha256(bytes), text };
}

// The original suite's cases as written: the skill's own evals/evals.json, read again and held to the
// hash the skill was loaded with, so the bytes compared are the bytes the receipt's suite_hash covers.
function originalRawCases(skill) {
  if (!skill || !skill.dir) return null;
  try {
    const raw = JSON.parse(readRequired(path.join(skill.dir, 'evals', 'evals.json'), 'evals/evals.json', SUITE_MAX_BYTES, 'SUITE_MAX_BYTES').toString('utf8'));
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
// Issue 183 (A-185-10): a revised criterion's keys other than id, weight and description are read
// against the original's criterion of that id, as a case's keys are. A-185-11: a case that changes shape
// still has its other keys read; the keys that make the shape are named once, by the shape change.
// -> { problems, changed: [{ id, fields }] }, changed in the revised suite's order.
const SHAPE_KEYS = ['criteria', 'rubric', 'expected'];
const CRITERION_KEYS = ['description', 'id', 'weight'];
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
    let reshaped = false;
    if (listedWas !== listedNow) {
      problems.push(`case ${nk.id}: the case changes shape, from ${shape(listedWas)} in the original to ${shape(listedNow)} in the revised case; a rubric regrade keeps each case's shape`);
      reshaped = true;
    }
    if (listedWas && listedNow) {
      try { criteriaOf(k.criteria, nk.id); } catch (e) { problems.push(e.message); }
      const before = new Map(o.criteria.map((x) => [x && x.id, x]));
      for (const x of k.criteria) {
        if (!x || typeof x !== 'object') continue;
        const y = before.get(x.id) || {};
        const at = `case ${nk.id}: criterion ${JSON.stringify(x.id)}`;
        for (const f of [...new Set([...Object.keys(y), ...Object.keys(x)])].sort()) {
          if (CRITERION_KEYS.includes(f)) continue;
          if (!Object.hasOwn(y, f)) problems.push(`${at} carries the key ${f}, which the original's criterion of that id does not; a criterion is read by its id, weight and description only`);
          else if (!Object.hasOwn(x, f)) problems.push(`${at}: the key ${f} is missing from the revised criterion`);
          else if (canonicalize(y[f]) !== canonicalize(x[f])) problems.push(`${at}: the key ${f} differs from the original's; a rubric regrade changes a criterion's weight and description, not its other keys`);
        }
      }
    }
    const rubricKey = (listedWas ? ['rubric', 'expected'] : ['rubric', 'criteria', 'expected']).find((f) => o[f]) || 'rubric';
    const thresholdKey = typeof o.pass_threshold === 'number' ? 'pass_threshold' : typeof o.threshold === 'number' ? 'threshold' : 'pass_threshold';
    for (const f of [...new Set([...Object.keys(o), ...Object.keys(k)])].sort()) {
      const inO = Object.hasOwn(o, f);
      const inK = Object.hasOwn(k, f);
      if (reshaped && SHAPE_KEYS.includes(f)) continue;
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

// The judge environment a regrade by `judge` would grade in, before any call: the surface, sampling
// and temperature lib/judge.js judgeSettings records, read from the environment as a run reads them
// (lib/provider.js), and surface `stub` when the stub answers, as lib/run.js records a stub run's.
function judgeEnvironment(judge, samples) {
  return { ...judgeSettings(samples, judge), ...(stubEnabled() ? { surface: 'stub' } : {}) };
}

// How to make this environment's judge surface the one named. -> a clause
function surfaceHow(want, now, judge) {
  if (want === 'stub') return 'set DRIFTPROOF_STUB=1';
  if (now === 'stub') return `unset DRIFTPROOF_STUB${want ? ` and ${surfaceHow(want, null, judge)}` : ''}`;
  return {
    api: 'set CLAUDE_PROVIDER=api',
    'claude-cli': 'unset CLAUDE_PROVIDER or set it to cli',
    'openai-api': 'set OPENAI_SURFACE=api',
    'openai-cli': 'set OPENAI_SURFACE=cli',
  }[want] || `no setting here gives the ${want} surface the judge ${judge} ran on`;
}

// The surface whose judge settings record `sampling`, for the judge's provider. -> a surface or null
function samplingSurface(sampling, judge) {
  const openai = inferProvider(judge) === 'openai';
  if (sampling === 'api-temperature-0') return openai ? 'openai-api' : 'api';
  if (sampling === 'surface-controlled') return openai ? 'openai-cli' : 'claude-cli';
  return null;
}

// A-184-4, A-184-5: a rubric regrade changes the rubric only, so the judge, its sample count and its
// prompt template are the original's. Checked here, where every caller passes, before any call.
// Issue 196 (A-184-8): and so is the judge environment, `{ model_id, surface, sampling, temperature,
// samples, prompt_template_hash }` of the original's run.judge, each compared and each difference
// named with how to match it; an original that records no surface or no sampling is refused, by name.
function sameGrader({ receipt, judgeModel, samples }) {
  const j = (receipt.run && receipt.run.judge) || {};
  const problems = [];
  // Issue 196 (A-184-18): the model id is compared as recorded, aliases expanded and nothing else, so
  // a dated id is not the undated one it would read as once its date is stripped.
  if (!j.model_id || resolveModel(judgeModel) !== resolveModel(j.model_id)) problems.push(`a rubric regrade keeps the original's judge ${j.model_id || '(none recorded)'}, and ${judgeModel} is another; regrade with another judge without --rubric`);
  if (samples !== j.samples) problems.push(`judge samples ${samples}, not the original's ${Number.isInteger(j.samples) ? j.samples : '(none recorded)'}: a rubric regrade keeps the original's sample count`);
  const template = promptTemplateHash();
  if (j.prompt_template_hash !== template) problems.push(`the original's judge prompt_template_hash ${j.prompt_template_hash ? `${String(j.prompt_template_hash).slice(0, 12)}…` : '(none recorded)'} is not this runner's ${template.slice(0, 12)}…: the regrade would change the judge template as well as the rubric`);
  const judge = resolveModel(judgeModel);
  const env = judgeEnvironment(judge, samples);
  const shown = (v) => (v === null ? 'null' : v === undefined ? '(none recorded)' : String(v));
  if (typeof j.surface !== 'string' || !j.surface) problems.push('the original records no judge surface, so a rubric regrade cannot show it grades on the surface the original graded on; regrade with another judge without --rubric');
  else if (j.surface !== env.surface) problems.push(`judge surface ${env.surface} here, not the original's ${j.surface}: a rubric regrade keeps the original's judge surface; ${surfaceHow(j.surface, env.surface, judge)} to match`);
  if (typeof j.sampling !== 'string' || !j.sampling) problems.push('the original records no judge sampling, so a rubric regrade cannot show it samples the judge as the original did; regrade with another judge without --rubric');
  else if (j.sampling !== env.sampling) {
    const want = samplingSurface(j.sampling, judge);
    problems.push(`judge sampling ${env.sampling} here, not the original's ${j.sampling}: a rubric regrade keeps the original's judge sampling; ${want ? `${surfaceHow(want, null, judge)} to match` : 'no setting here gives it'}`);
  }
  if (!Object.hasOwn(j, 'temperature') || j.temperature !== env.temperature) {
    const want = typeof j.sampling === 'string' ? samplingSurface(j.sampling, judge) : null;
    problems.push(`judge temperature ${shown(env.temperature)} here, not the original's ${shown(j.temperature)}: a rubric regrade keeps the original's judge temperature; ${want ? `${surfaceHow(want, null, judge)} to match` : 'no setting here gives it'}`);
  }
  return problems;
}

// How to give the judge the original's isolation. -> a clause
const ISOLATION_HOW = {
  'same-user': 'pass --trusted-skill to match',
  'eval-user': 'leave out --trusted-skill to match',
  none: 'grade on the surface the original graded on (an api surface, or the stub) to match',
};
const endpointOf = (e) => (e.custom ? `a custom endpoint (sha256 ${String(e.sha256).slice(0, 12)}…)` : 'no custom endpoint');
// How to give the judge's endpoint the original's resolution. -> a clause
const RESOLVED_HOW = {
  runner: 'grade on the api surface the original graded on to match',
  cli: 'grade on the CLI surface the original graded on to match',
  none: 'grade on the stub, as the original did, to match',
};
// Issue 196 (A-184-20): each routing variable the judge's call is handed, set or not and the sha256 of
// its value, against the original's. -> [problem]
function routingDifferences(was, now) {
  const problems = [];
  const shown = (r) => (r && r.set ? `set (sha256 ${String(r.sha256).slice(0, 12)}…)` : 'not set');
  for (const k of ROUTING_VARIABLES) {
    const a = was[k] || { set: false, sha256: null };
    const b = now[k] || { set: false, sha256: null };
    if (a.set === b.set && (!a.set || a.sha256 === b.sha256)) continue;
    problems.push(`the judge's ${k} is ${b.set ? `set here (sha256 ${String(b.sha256).slice(0, 12)}…)` : 'not set here'}, and the original's was ${shown(a)}: a rubric regrade keeps the original's routing; ${a.set ? `set ${k} to the value whose sha256 the original records` : `unset ${k}`} to match`);
  }
  return problems;
}

// Issue 196 (A-184-13): the rest of the judge's setting, which a rubric regrade keeps too: the
// judge's harness and its version (a CLI's own instructions are part of what the judge reads), its
// isolation, its endpoint, and the revision of the code that reads its replies and decides which
// answers reach it. Each is compared with this environment's (`setting`, lib/run.js judgeEnvironment,
// imported here as judgeSettingOf)
// before any call, and each difference is named with how to match it. An original that records one of
// them not at all (a receipt from before schema v0.12) is refused, by name, as a missing surface is.
function sameJudgeSetting({ receipt, judgeModel, setting }) {
  const j = (receipt.run && receipt.run.judge) || {};
  const problems = [];
  const none = (what) => problems.push(`the original records no judge ${what} (a receipt from before schema v0.12), so a rubric regrade cannot show its judge's ${what} is the original's; regrade with another judge without --rubric`);
  const h = j.harness;
  const now = setting.harness;
  if (!h || typeof h.name !== 'string') none('harness');
  else if (h.name !== now.name) problems.push(`judge harness ${now.name} here, not the original's ${h.name}: a rubric regrade keeps the original's judge harness; grade on the surface the original graded on to match`);
  else if (h.name !== 'api' && h.name !== 'none' && (typeof h.version !== 'string' || typeof now.version !== 'string')) problems.push(`the judge harness ${h.name}'s version is ${typeof h.version === 'string' ? `${h.version} in the original and could not be read here` : 'not recorded by the original'}, so a rubric regrade cannot show the judge reads the same ${h.name} instructions`);
  else if (h.version !== now.version) problems.push(`judge harness ${now.name} ${now.version} here, not the original's ${h.version}: the CLI's own instructions are part of what the judge reads; run the regrade where ${h.name} ${h.version} answers to match`);
  if (typeof j.isolation !== 'string') none('isolation');
  else if (j.isolation !== setting.isolation) problems.push(`judge isolation ${setting.isolation} here, not the original's ${j.isolation}: a rubric regrade keeps the original's spawn path; ${ISOLATION_HOW[j.isolation] || 'no setting here gives it'}`);
  // Issue 196 (A-184-20): the endpoint is the address the call uses, how it was resolved, and the
  // routing variables the call is handed, each compared.
  const openai = inferProvider(resolveModel(judgeModel)) === 'openai';
  const variable = openai ? 'OPENAI_BASE_URL' : 'ANTHROPIC_BASE_URL';
  const registry = openai ? ', and a registry whose providers.openai.base_url gives that address,' : '';
  if (!j.endpoint || typeof j.endpoint.custom !== 'boolean') none('endpoint');
  else if (typeof j.endpoint.resolved_by !== 'string' || !j.endpoint.routing || typeof j.endpoint.routing !== 'object') none('endpoint routing');
  else {
    if (j.endpoint.custom !== setting.endpoint.custom || j.endpoint.sha256 !== setting.endpoint.sha256) problems.push(`the judge is handed ${endpointOf(setting.endpoint)} here, and the original's was handed ${endpointOf(j.endpoint)}: a rubric regrade keeps the original's endpoint; ${j.endpoint.custom ? `set ${variable}${registry} to the endpoint whose sha256 the original records` : `unset ${variable}${openai ? ' and use a registry with no other providers.openai.base_url' : ''}`} to match`);
    if (j.endpoint.resolved_by !== setting.endpoint.resolved_by) problems.push(`the judge's endpoint is resolved by ${setting.endpoint.resolved_by} here, not by ${j.endpoint.resolved_by} as the original's was: ${RESOLVED_HOW[j.endpoint.resolved_by] || 'no setting here gives it'}`);
    problems.push(...routingDifferences(j.endpoint.routing, setting.endpoint.routing));
  }
  if (typeof j.code_revision !== 'string') none('code revision');
  else if (j.code_revision !== setting.code_revision) problems.push(`the judge-reading code is ${setting.code_revision} here, not the original's ${j.code_revision}: a file on the judging path differs, so how a judge reply is read, or which answers reach the judge, may differ; regrade with the runner that made the original`);
  // Issue 196 (A-184-22): the dated ids the judge answered as are compared once the regrade's judge has
  // answered (sameSnapshot); an original that records none cannot be compared.
  if (!Array.isArray(j.reported_models) || j.reported_models.length === 0 || j.reported_models.some((id) => typeof id !== 'string' || !id.trim() || !judgeSnapshotIds([id], judgeModel).length)) {
    if (!Object.hasOwn(j, 'reported_models')) none('reported models');
    else problems.push("the original's judge reported models do not establish its identity, so a rubric regrade cannot match it; regrade with another judge without --rubric");
  }
  return problems;
}

// Issue 196 (A-184-22): the dated ids this regrade's judge answered as, against the original's
// run.judge.reported_models. Read after each draw's replies, an id the original's judge did not name
// stops the regrade there; read once every call is made (`done`), the two lists must be the same. A
// stop throws SUBSTRATE_MISMATCH, so no receipt is written and the calls made are said.
function sameSnapshot(receipt, answeredAs, done) {
  const was = Array.isArray(receipt.run.judge.reported_models) ? receipt.run.judge.reported_models : [];
  const now = [...answeredAs].sort();
  const differs = now.some((id) => !was.includes(id)) || (done && canonicalize(now) !== canonicalize(was));
  const shown = (ids) => (ids.length ? `answered as ${ids.join(', ')}` : 'named none');
  if (differs) throw Object.assign(new Error(`substrate mismatch: the judge ${shown(now)}, and the original's judge ${shown(was)}: a rubric regrade keeps the dated model the original's judge answered as, so it stops and no receipt is written`), { code: 'SUBSTRATE_MISMATCH' });
}

// Issue 196 (A-184-15): the suites a caller hands in are held to what they were read from, so neither
// planRegrade nor regradeReceipt grades by cases a caller built. The skill's cases must rehash to its
// suiteHash and, when it names its directory, be what its evals/evals.json loads to. A revised suite
// must carry the text it was read from (readRevisedSuite keeps it): its sha256 is the text's, its
// cases as written are what the text holds, and its cases and suite hash are what they load to.
function suiteIdentityProblems({ skill, revised }) {
  const problems = [];
  const same = (a, b) => canonicalize(a) === canonicalize(b);
  try {
    if (suiteIdentity({ cases: skill.suite.cases }).suiteHash !== skill.suite.suiteHash) problems.push("the skill's cases as given do not hash to its suiteHash: they are not the cases the skill was loaded with");
  } catch (e) { problems.push(`the skill's cases as given do not load: ${e.message}`); }
  if (skill.dir) {
    try {
      const own = suiteIdentity(JSON.parse(readRequired(path.join(skill.dir, 'evals', 'evals.json'), 'evals/evals.json', SUITE_MAX_BYTES, 'SUITE_MAX_BYTES').toString('utf8')));
      if (own.suiteHash !== skill.suite.suiteHash || !same(own.cases, skill.suite.cases)) problems.push("the skill's suite as given is not the one its evals/evals.json loads to");
    } catch (e) { problems.push(`the skill's evals/evals.json cannot be read again: ${e.message}`); }
  }
  if (!revised) return problems;
  if (typeof revised.text !== 'string') { problems.push('the revised suite carries no text it was read from, so its cases cannot be held to a file; read it with readRevisedSuite'); return problems; }
  if (sha256(Buffer.from(revised.text, 'utf8')) !== revised.sha256) problems.push("the revised suite's sha256 is not the sha256 of the text it was read from");
  let written = null;
  try { written = rawCases(JSON.parse(revised.text)); } catch (e) { problems.push(`the revised suite's text does not parse: ${e.message}`); }
  if (written && !same(written, revised.raw)) problems.push("the revised suite's cases as written are not the ones its text holds");
  try {
    const loaded = suiteIdentity(revised.raw);
    if (loaded.suiteHash !== revised.suiteHash || !same(loaded.cases, revised.cases)) problems.push("the revised suite's cases or suite hash are not what its cases as written load to");
  } catch (e) { problems.push(`the revised suite as written does not load: ${e.message}`); }
  return problems;
}

// Issue 196 (A-185-16): every judged draw of a criteria case records the criteria template hash it was
// graded on, and a rubric regrade, whose criteria may differ, keeps the template: each must be this
// runner's. A judged draw with none (a receipt made by 0.19.0) is refused, by case. The criteria cases
// are the original suite's, which planRegrade holds to the receipt's suite_hash.
// Issue 196 (A-185-19): and the run records the template once, in run.judge, which is compared too, so
// a criteria case whose every draw timed out, and so records none, is still compared.
function sameCriteriaTemplate({ receipt, skill }) {
  const problems = [];
  const criteriaTemplate = criteriaTemplateHash();
  const caseOf = (c) => ((skill && skill.suite && skill.suite.cases) || []).find((x) => x.id === c.id);
  const listed = receipt.results.cases.filter((c) => { const k = caseOf(c); return k && Array.isArray(k.criteria); });
  const j = (receipt.run && receipt.run.judge) || {};
  if (listed.length) {
    if (typeof j.criteria_template_hash !== 'string') problems.push(`the original records no run.judge.criteria_template_hash (a receipt made before the run recorded it), so a rubric regrade cannot show the criteria template is this runner's ${criteriaTemplate.slice(0, 12)}…; regrade with another judge without --rubric`);
    else if (j.criteria_template_hash !== criteriaTemplate) problems.push(`the original's run.judge.criteria_template_hash ${j.criteria_template_hash.slice(0, 12)}… is not this runner's ${criteriaTemplate.slice(0, 12)}…: the regrade would change the criteria template as well as the criteria`);
  }
  for (const c of listed) {
    const judged = ((c.generation || {}).draws || []).filter((d) => Array.isArray(d.judge_sample_hashes) && d.judge_sample_hashes.length);
    const none = judged.filter((d) => typeof d.criteria_template_hash !== 'string');
    const other = judged.filter((d) => typeof d.criteria_template_hash === 'string' && d.criteria_template_hash !== criteriaTemplate);
    if (none.length) problems.push(`case ${c.id}/${c.mode}: ${none.length} judged draw(s) record no criteria_template_hash (a receipt made by 0.19.0), so a rubric regrade cannot show the criteria template is this runner's ${criteriaTemplate.slice(0, 12)}…; regrade with another judge without --rubric`);
    if (other.length) problems.push(`case ${c.id}/${c.mode}: the original's criteria_template_hash ${String(other[0].criteria_template_hash).slice(0, 12)}… is not this runner's ${criteriaTemplate.slice(0, 12)}…: the regrade would change the criteria template as well as the criteria`);
  }
  return problems;
}

// Everything that must hold before the first call. No call is made. `revised` is a rubric regrade's
// suite (spec 184). Issue 196 (A-184-11): planRegrade and regradeReceipt both read this one function,
// so a caller of either meets every check. `trusted` is the judge's spawn path, and `setting` the
// judge's setting already read for it (lib/run.js judgeEnvironment), read here when not given.
// -> [problem]
function regradeProblems({ receipt, skill, answers, judgeModel, samples, revised = null, trusted = false, setting = null }) {
  if (receipt?.run?.capture?.mode === 'repository') return ['Repository regrade is not supported by issue 490; run the original measurement contract again.'];
  if (receiptAggregatesOnly(receipt)) return [MARKED_REGRADE];
  const problems = [];
  const bounds = answerBounds(answers);
  if (bounds) return [bounds];
  // Issue 196 (A-184-23): in both modes, a sample count is a whole number of 1 or more; anything else
  // projects no number and asks the judge an unknown number of times.
  if (!Number.isInteger(samples) || samples < 1) problems.push(`judge samples ${typeof samples === 'string' ? JSON.stringify(samples) : String(samples)} is not a whole number of 1 or more; nothing is projected or called`);
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
  problems.push(...suiteIdentityProblems({ skill, revised }));
  // Spec 184 (R-4): the grader is the original's, and the revised suite is compared with the original
  // the skill was checked to carry, both as written.
  if (revised) problems.push(...sameGrader({ receipt, judgeModel, samples }));
  if (revised) problems.push(...sameJudgeSetting({ receipt, judgeModel, setting: setting || judgeSettingOf({ judgeModel: resolveModel(judgeModel), samples, trusted }) }));
  if (revised) problems.push(...sameCriteriaTemplate({ receipt, skill }));
  if (revised && !problems.length) problems.push(...suiteDifferences(skill.suite, revised, originalRawCases(skill)).problems);
  if (!problems.length) problems.push(...answerProblems(receipt, answers));
  return problems;
}

// Everything that must hold before the first call, and what the regrade will
// cost. No call is made. `revised` is a rubric regrade's suite (spec 184).
// Issue 196 (A-184-9): `draws` counts the draws that reach the judge (readingOf), so a lost draw
// kept with its generation_hash is neither projected nor charged. A-184-23: a plan with a problem
// projects no call.
// -> { problems, draws, calls, usd }
function planRegrade({ receipt, skill, answers, judgeModel, samples, revised = null, trusted = false }) {
  const problems = regradeProblems({ receipt, skill, answers, judgeModel, samples, revised, trusted });
  const draws = problems.length ? 0 : drawsToJudge(receipt, answers).length;
  const calls = problems.length ? 0 : draws * samples;
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

// Issue 196 (A-184-10, A-184-16): a regrade runs no check. A case row carries the original row's check
// results only when its generation_hash is the original row's, the answer they were run on; else it
// carries none. checks_regrade says which, on every row whose original carried checks.
// -> { checks?, checks_regrade? }
function carriedChecks(orig, generationHash) {
  if (!Array.isArray(orig.checks) || typeof orig.generation_hash !== 'string') return {};
  const was = orig.generation_hash;
  if (generationHash === was) {
    return { checks: JSON.parse(JSON.stringify(orig.checks)), checks_regrade: { carried: true, generation_hash: was, reason: "carried from the original receipt's row, whose checks were run on this same answer; no check was run again" } };
  }
  const reason = typeof generationHash === 'string'
    ? `not carried: the original's checks were run on answer ${was.slice(0, 12)}, and this row's last measured draw is answer ${generationHash.slice(0, 12)}; no check was run again`
    : "not carried: no draw of this row was measured in the regrade, so it has no answer for the original's checks; no check was run again";
  return { checks_regrade: { carried: false, generation_hash: was, reason } };
}

// Issue 212: validate identity before attest can copy, canonicalize or interpolate an id.
function judgeIdentity(reply, judge, setting, revised) {
  const mismatch = (why) => { throw Object.assign(new Error('substrate mismatch: judge identity ' + why + '; no receipt is written'), { code: 'SUBSTRATE_MISMATCH' }); };
  const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 256
    && Buffer.byteLength(id, 'utf8') <= 256 && /^[A-Za-z0-9._-]+$/.test(id);
  const reported = reply && reply.reportedModels;
  if (reported != null && (!Array.isArray(reported) || reported.length > 128 || reported.some((id) => !validId(id)))) mismatch('has malformed ids or exceeds 128 ids of 256 bytes');
  if (reply && reply.servedModel != null && !validId(reply.servedModel)) mismatch('has a malformed serving id or exceeds 256 bytes');
  const configuredStub = setting.settings.surface === 'stub';
  const returnedStub = reply && reply.answeredBy === 'stub' && reply.surface === 'stub';
  if (!revised && configuredStub && returnedStub) return { attested: false, reported: null, auxiliary: [] };
  if (!revised && (configuredStub || returnedStub || !reply || reply.answeredBy !== 'model' || reply.surface === 'stub')) mismatch('does not match the configured model surface');
  if (!revised && Array.isArray(reported)) {
    const want = canonicalModelId(resolveModel(judge));
    const mixed = reported.some((id) => canonicalModelId(id) !== want);
    if (mixed && !reply.servedModel) mismatch('needs explicit serving-model evidence for a mixed-model reply');
    if (reply.servedModel && (!reported.some((id) => canonicalModelId(id) === canonicalModelId(reply.servedModel)) || canonicalModelId(reply.servedModel) !== want)) mismatch('names another or unreported serving model');
  }
  return attest(reply, judge, 'judge');
}
function sampleEvidence(received) {
  return received.map((reply, i) => ({
    sample_index: i, output_sha256: sha256(reply.text),
    reported_models: Array.isArray(reply.reportedModels) ? [...reply.reportedModels] : null,
    served_model: reply.servedModel || null, answered_by: reply.answeredBy, surface: reply.surface,
  }));
}

// Regrade one sealed receipt. opts: { trusted, budget, timeoutMs, onProgress, nowIso, maxCalls }.
// `revised` is a rubric regrade's suite (spec 184): each case is graded under its rubric and threshold.
// Issue 196 (A-184-11): it runs planRegrade's checks itself, and throws REGRADE_REFUSED naming every
// problem before any call. A-184-19: and the call cap a run takes (opts.maxCalls, DEV_MAX_CALLS when
// none is given), refusing a projection past it with CALL_CAP before any call; a budget hard-stop or a
// substrate mismatch after calls were made says the calls made (`callsMade` on the error, and its
// message). A-184-10, A-184-16: no deterministic check is run (carriedChecks).
// -> { receipt, provenance, calls }
function regradeSubjectRefusal(receipt) {
  const kind = kindOf(receipt).value; const delivery = deliveryOf(receipt).value;
  if (kind === 'skill' && delivery === 'injected') return null;
  return Object.assign(new Error(`regrade refused, nothing run: the receipt's subject is kind ${kind}, delivery ${delivery}; a regrade reads a skill directory and grades again answers sent with the skill injected, so no answer is graded again`), { code: 'SUBJECT_REGRADE' });
}

async function regradeReceipt({ receipt, skill, answers, judgeModel, samples, revised = null, opts = {} }) {
  if(receipt?.run?.scoring)throw Object.assign(Error('Execution-primary regrade is not supported; no calls made.'),{code:'EXECUTION_REGRADE'});
  // Spec 440 AC-13: a receipt with the placebo arm is not regraded. A regrade that left the placebo
  // arm under the old grader would pair answers graded by two graders.
  const placeboRows = receipt && receipt.results && Array.isArray(receipt.results.cases) && receipt.results.cases.some((c) => c && c.mode === 'placebo');
  if (receipt && (receipt.placebo || placeboRows)) throw Object.assign(new Error('regrade refused, nothing run: the receipt has a placebo arm, and a regrade of it is not supported, so no answer is graded again'), { code: 'PLACEBO_REGRADE' });
  if (receiptAggregatesOnly(receipt)) throw Object.assign(new Error(`regrade refused, nothing run: ${MARKED_REGRADE}`), { code: 'REGRADE_REFUSED', problems: [MARKED_REGRADE] });
  // Spec 438 (AC-10): a regrade reads a skill directory and grades again answers this runner sent, so a
  // receipt of another kind, or of another delivery, is refused before any call.
  const subjectRefusal = regradeSubjectRefusal(receipt);
  if (subjectRefusal) throw subjectRefusal;
  const trusted = !!opts.trusted;
  const judge = resolveModel(judgeModel);
  // Issue 196 (A-184-13): the judge's own setting, read once: compared in a rubric regrade, and
  // recorded in the new receipt's run.judge either way.
  const setting = judgeSettingOf({ judgeModel: judge, samples, trusted });
  const refused = regradeProblems({ receipt, skill, answers, judgeModel, samples, revised, trusted, setting });
  if (refused.length) throw Object.assign(new Error(`regrade refused, nothing run: ${refused.join('; ')}`), { code: 'REGRADE_REFUSED', problems: refused });
  // A-184-23: the cap is a whole number of 1 or more, so it is compared as a number.
  const maxCalls = opts.maxCalls === undefined || opts.maxCalls === null ? DEV_MAX_CALLS : opts.maxCalls;
  if (!Number.isInteger(maxCalls) || maxCalls < 1) throw Object.assign(new Error(`cost guard: the call cap ${typeof maxCalls === 'string' ? JSON.stringify(maxCalls) : String(maxCalls)} is not a whole number of 1 or more; nothing run`), { code: 'CALL_CAP', maxCalls });
  const projected = drawsToJudge(receipt, answers).length * samples;
  if (projected > maxCalls) throw Object.assign(new Error(`cost guard: projected ${projected} judge calls exceeds cap ${maxCalls}; nothing run`), { code: 'CALL_CAP', projected, maxCalls });
  const suite = revised || skill.suite;
  const modelId = receipt.run.model_id;
  assertRegistered(judge, 'judge model');
  const budget = opts.budget || null;
  // Issue 212 (A-044-8): canned stub samples still carry the budget's estimated call cost.
  // Their endpoint count stays zero; model surfaces charge independently observed attempts.
  const budgetAttempts = (observed, reported, logical) => revised ? reported : setting.settings.surface === 'stub' ? logical : observed;
  const onProgress = opts.onProgress || (() => {});
  const timeoutMs = resolveCallTimeoutMs(surfaceForModel(judge), opts);
  const judgedAt = new Date().toISOString();

  // Issue 196 (A-184-9, A-184-14): the judge calls made, counted from the attempts each draw's judge
  // made, a timed-out draw's among them, and the draws that reached the judge, counted as they did.
  let calls = 0;
  const parseRetries = [];
  let logicalCalls = 0;
  let attemptsMade = 0;
  const onAttempt = (attempt) => {
    if (attemptsMade >= maxCalls) throw Object.assign(new Error('cost guard: judge endpoint attempt cap reached; no further request made'), { code: 'CALL_CAP', maxCalls });
    attemptsMade += 1;
    if (!revised && attempt === 1) logicalCalls += 1;
  };
  let judged = 0;
  const replies = [];
  const cases = [];
  // Issue 196 (A-184-22): the dated ids this regrade's judge answered as, held to the original's in a
  // rubric regrade.
  const answeredAs = new Set();
  let judgeIdentityComplete = true;
  const recordReplies = (received) => {
    const aux = [];
    for (const reply of received) {
      const ja = judgeIdentity(reply, judgeModel, setting, revised);
      const ids = judgeSnapshotIds(ja.reported, judge);
      if (!ja.attested || !ids.length) judgeIdentityComplete = false;
      const stubException = !revised && setting.settings.surface === 'stub' && reply && reply.answeredBy === 'stub' && reply.surface === 'stub';
      if (!stubException && (!ja.attested || !ids.length)) throw Object.assign(new Error('substrate mismatch: a judge reply named none, so its identity cannot be established; no receipt is written'), { code: 'SUBSTRATE_MISMATCH' });
      if (!reply) continue;
      replies.push(reply);
      for (const id of ids) answeredAs.add(id);
      for (const x of (ja.auxiliary || [])) aux.push({ phase: 'judge', ...x });
    }
    if (revised) sameSnapshot(receipt, answeredAs, false);
    return aux;
  };
  try {
  for (const orig of receipt.results.cases) {
    const caseObj = suite.cases.find((k) => k.id === orig.id);
    const mode = orig.mode;
    const draws = [];
    let last = null;
    for (const d of orig.generation.draws) {
      const reading = readingOf(d, receipt, answers);
      if (reading.carry) { draws.push(JSON.parse(JSON.stringify(d))); continue; }
      const gen = generationSide(d);
      const usage = d.usage ? { usage: d.usage } : {};
      // Spec 137 R-4, R-5: the same reading the runner applies before a judge sees an answer. An
      // answer that points at a file it does not include, or only describes work, is a lost draw
      // here too, never a score, and no judge call is made for it.
      if (reading.lost) {
        draws.push({ draw_index: d.draw_index, generation_hash: d.generation_hash, status: 'unmeasured', reason: reading.lost.reason.slice(0, 200), ...(reading.lost.kind === 'fake_tool_call' ? { capture_outcome: reading.lost.kind } : {}), samples: [], mean: null, stddev: null, ...gen, ...usage });
        continue;
      }
      judged += 1;
      onProgress({ case: orig.id, mode, phase: 'judge', draw: d.draw_index, samples });
      let jr;
      const attemptsBefore = attemptsMade;
      try {
        jr = await judgeCase({ caseObj, response: answers[d.generation_hash], generationHash: d.generation_hash, judgeModel: judge, mode, timeoutMs, samples, trusted, withChecks: false, onAttempt });
      } catch (e) {
        if (!revised || e.judgeAttempts !== 0) {
          calls = revised ? calls + (e.judgeAttempts || 1) : attemptsMade;
        }
        if (revised || setting.settings.surface === 'stub') logicalCalls += e.judgeCalls ?? samples;
        parseRetries.push(...(e.parseRetries || []));
        if (e.parseRetries?.length) gen.judge_parse_retries = e.parseRetries;
        recordReplies(e.judgeReplies || []);
        if (e.code === 'CALL_CAP' || !isTimeout(e)) throw e;
        if (budget) budget.add(budgetAttempts(attemptsMade - attemptsBefore, e.judgeAttempts || 1, e.judgeCalls ?? samples) * perCallCostUSD(judge, 'judge'));
        // A-184-24: the runner's words, never the error's message, which can carry a path, an address
        // or a CLI's output.
        const partialJudgeUsage = require('./usage').sumUsage((e.judgeReplies || []).map(r => r?.usage));
        draws.push({ ...(require('./usage').hasUsage(partialJudgeUsage) ? { judge_usage: partialJudgeUsage } : {}), draw_index: d.draw_index, generation_hash: d.generation_hash, status: 'unmeasured', reason: JUDGE_TIMEOUT_REASON, samples: [], mean: null, stddev: null, ...(!revised && e.judgeReplies?.length ? { judge_sample_evidence: sampleEvidence(e.judgeReplies), judge_sample_hashes: e.judgeReplies.map((r) => sha256(r.text)) } : {}), ...gen, ...usage });
        continue;
      }
      parseRetries.push(...(jr.parseRetries || []));
      if (jr.parseRetries?.length) gen.judge_parse_retries = jr.parseRetries;
      const priorCalls = calls;
      calls = attemptsMade;
      if (revised) calls = priorCalls + (jr.attempts || samples);
      if (revised || setting.settings.surface === 'stub') logicalCalls += samples + (jr.parseRetries?.length || 0);
      const judgeAux = recordReplies(jr.replies || []);
      // AC-20: every returned reply keeps its identity and hash, including a
      // malformed first attempt. Case-level hashes still describe scoring samples.
      if (!revised) gen.judge_sample_evidence = sampleEvidence(jr.replies || []);
      const drawSampleHashes = revised
        ? jr.caseResult?.judge_sample_hashes || jr.sampleHashes || []
        : (jr.replies || []).map(r => sha256(r.text));
      if (judgeAux.length) gen.auxiliary_calls = [...(gen.auxiliary_calls || []), ...judgeAux];
      if (budget) budget.add(budgetAttempts(attemptsMade - attemptsBefore, jr.attempts || samples, samples + (jr.parseRetries?.length || 0)) * perCallCostUSD(judge, 'judge'));
      if (jr.unmeasured) {
        const u = { draw_index: d.draw_index, generation_hash: d.generation_hash, status: 'unmeasured', reason: String(jr.reason || '').slice(0, 200), samples: [], mean: null, stddev: null, ...gen };
        if (drawSampleHashes.length) u.judge_sample_hashes = drawSampleHashes;
        Object.assign(u, usage);
        if (jr.judge_usage) u.judge_usage = jr.judge_usage;
        Object.assign(u, criteriaTemplate(jr));
        draws.push(u);
        continue;
      }
      const m = {
        draw_index: d.draw_index, generation_hash: d.generation_hash, status: 'measured',
        samples: jr.caseResult.samples, judge_sample_hashes: drawSampleHashes,
        mean: jr.caseResult.mean, stddev: jr.caseResult.stddev, ...gen, ...usage,
      };
      if (jr.caseResult.judge_usage) m.judge_usage = jr.caseResult.judge_usage;
      // Spec 185 (R-8): a criteria case's draw records its judgments, as a run's does.
      Object.assign(m, criteriaJudgments(jr));
      Object.assign(m, criteriaTemplate(jr));
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
      cases.push({ id: orig.id, mode, case_status: nonTimeout ? FAILED_STATUSES[1] : FAILED_STATUSES[0], reason, generation, ...carriedChecks(orig, null) });
      continue;
    }
    const caseResult = { ...last.caseResult, generation };
    caseResult.mean = agg.mean;
    caseResult.score = agg.mean;
    caseResult.stddev = agg.sd;
    caseResult.outcome = outcomeFor(agg.mean, agg.sd, caseObj.pass_threshold);
    // Issue 196 (A-184-10, A-184-16): a check's definition is in no hash a receipt records, so it is
    // never run again; its results are carried only to the answer they were run on.
    Object.assign(caseResult, carriedChecks(orig, caseResult.generation_hash));
    onProgress({ case: orig.id, mode, phase: 'done', outcome: caseResult.outcome, score: caseResult.mean, stddev: caseResult.stddev });
    cases.push(caseResult);
  }
  if (revised) sameSnapshot(receipt, answeredAs, true);
  } catch (e) {
    // Issue 196 (A-184-19): a stop after calls were made says how many were made.
    if (e && typeof e === 'object') {
      e.callsMade = calls;
      e.attemptsMade = calls;
      e.logicalCallsMade = logicalCalls;
      e.drawsJudged = judged;
      e.message = `${e.message} (${calls} judge call(s) were made before it stopped, over ${judged} draw(s))`;
    }
    throw e;
  }

  // What answered the judge. A stub judge graded nothing: its receipt is UNVERIFIED
  // with judge surface stub, whatever answered the generations (spec 026 AC-1).
  const judgeStub = replies.length > 0 && replies.every((r) => r.answeredBy === 'stub');
  const judgeModelAnswered = replies.length > 0 && replies.every((r) => r.answeredBy === 'model');
  // v0.12 (issue 196, A-184-13): the regrade's own judge's harness, isolation, endpoint and code
  // revision, never the original's; the original's judge block is in run.regraded_from. A-184-22,
  // A-185-19: and its own ids answered as, and the criteria template when a graded case lists criteria.
  const judgeBlock = {
    ...judgeSettings(samples, judge), ...(judgeStub ? { surface: 'stub' } : {}), model_id: judge, prompt_template_hash: promptTemplateHash(), harness: setting.harness, isolation: setting.isolation, endpoint: setting.endpoint, code_revision: setting.code_revision,
    reported_models: judgeIdentityComplete && answeredAs.size ? [...answeredAs].sort() : null,
    ...(receipt.results.cases.some((c) => { const k = suite.cases.find((x) => x.id === c.id); return k && Array.isArray(k.criteria); }) ? { criteria_template_hash: criteriaTemplateHash() } : {}),
  };
  const nowIso = opts.nowIso || new Date().toISOString();
  const surface = receipt.run.surface;
  const pricingSnapshot = buildPricingSnapshot({ models: [modelId, judge], lookup: priceForModel, nowIso });
  // Spec 317 AC-15: the capture mode says which draws reached this judge; a draw copied whole above
  // carries the original judge's usage, and is not counted.
  Object.assign(judgeBlock, require('./judge').priceParseRetries(parseRetries, pricingSnapshot.models[judge]));
  const economics = computeEconomics({ cases, modelId, judgeModelId: judge, pricingSnapshot, surface, meteredSurface: isMeteredSurface(surface), captureMode: (receipt.run.capture || {}).mode });

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
  // Issue 196 (A-184-9): judged as it happened; every other draw, lost or with no answer, carried.
  const drawCounts = { graded: judged, carried: receipt.results.cases.reduce((a, c) => a + c.generation.draws.length, 0) - judged };
  const casesChanged = revised ? gradingChanges(skill.suite, revised) : null;
  // v0.12 (issue 196, A-184-12): the regrade's evidence, sealed inside the new receipt's hash. The
  // answers are named by the sha256 of the canonical JSON of the answers object the regrade read, which
  // a reader recomputes from the archive's `answers`; the revised suite by its file's sha256, held to
  // its text by suiteIdentityProblems.
  const regradedFrom = {
    receipt_hash: receipt.receipt_hash,
    runner_version: receipt.run.runner_version,
    run_date_utc: receipt.run.date_utc === undefined ? null : receipt.run.date_utc,
    answers_sha256: sha256Canonical(answers),
    ...(revised ? { rubric_revision_sha256: revised.sha256 } : {}),
    judge: JSON.parse(JSON.stringify(receipt.run.judge)),
  };
  const regrade = { mode: revised ? 'rubric' : 'judge', draws: { ...drawCounts }, judge_calls: calls, judge_attempts: calls, judge_logical_calls: logicalCalls, ...(revised ? { cases_changed: casesChanged } : {}) };
  // Spec 184 (R-5): a rubric regrade's receipt names the suite it graded under. The canary is the
  // original's: it is derived from the case ids, which a rubric regrade does not change.
  const out = buildReceipt({
    // Spec 438: the original's kind and delivery, as the reader functions read them.
    skill: { name: receipt.skill.name, version: receipt.skill.version, contentHash: receipt.skill.content_hash, tokens: receipt.skill.tokens, unit: kindOf(receipt).value },
    suite: { format: receipt.suite.format, suiteHash: revised ? revised.suiteHash : receipt.suite.suite_hash, caseCount: receipt.suite.case_count, canary: receipt.suite.canary },
    run: {
      delivery: deliveryOf(receipt).value,
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
      regraded_from: regradedFrom,
      regrade,
    },
    cases,
    economics,
    verificationLevel: receipt.verification_level === 'TESTED' && judgeModelAnswered && judgeIdentityComplete ? 'TESTED' : 'UNVERIFIED',
  });

  // Where the regrade came from. Since v0.12 (issue 196) the receipt itself seals the lineage, the
  // counts, the calls and the changed cases (run.regraded_from, run.regrade). This sidecar is bound
  // to the receipt by its hash and repeats no key the receipt carries (spec 044 AC-6), so the lineage
  // is the receipt's alone; it keeps readable counts and holds what the receipt does not (the answers
  // file's own sha256 and name, the revised file's name, the judges that reported).
  const provenance = {
    format: REGRADE_SIDECAR.format,
    receipt_hash: out.receipt_hash,
    generated_at_basis: receipt.run.generated_at || (receipt.run.arms && Object.values(receipt.run.arms).some((x) => x && x.generated_at))
      ? "the original receipt's own generated_at"
      : "the original receipt's run.date_utc: a receipt of that schema records no separate generation time",
    draws: { ...drawCounts },
    judge_reported_models: [...new Set(replies.flatMap((r) => (r.reportedModels || []).map((id) => canonicalModelId(id))))].sort(),
    calls,
    attempts: calls,
    logical_calls: logicalCalls,
    // Spec 184 (R-5): what a rubric regrade changed, and that it generated nothing.
    ...(revised ? {
      rubric_revision: {
        file: revised.file || null,
        sha256: revised.sha256 || null,
        original_suite_hash: receipt.suite.suite_hash,
        revised_suite_hash: revised.suiteHash,
        cases_changed: casesChanged,
        note: "a regrade of the original receipt's saved answers under a revised rubric: no answer was generated, and the generation side of every draw is the original's",
      },
    } : {}),
  };
  return { receipt: out, provenance, calls };
}

module.exports = {
  regradeReceipt, planRegrade, regradeProblems, answerProblems, drawsToGrade, drawsToJudge, readingOf, gradable, carriedChecks,
  answersArchive, readAnswers, readRevisedSuite, suiteDifferences, ANSWERS_FORMAT, ANSWERS_ARCHIVE,
};
