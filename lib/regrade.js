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
// 026 AC-8). A draw whose original judge gave no score has an answer and is graded.

const { sha256 } = require('./canonical');
const { judgeCase, attest, outcomeFor, resolveCallTimeoutMs } = require('./run');
const { judgeSettings, promptTemplateHash, rubricHash } = require('./judge');
const { buildReceipt, verifyReceiptHash, FAILED_STATUSES } = require('./receipt');
const { acrossDraws } = require('./sampling');
const { resolveModel, surfaceForModel, isMeteredSurface } = require('./provider');
const { priceForModel, assertRegistered } = require('./models');
const { perCallCostUSD } = require('./cost');
const { buildPricingSnapshot, computeEconomics } = require('./value');
const { canonicalModelId } = require('./usage');
const { RUNNER_VERSION } = require('../config');

const isTimeout = (e) => !!(e && (e.code === 'TIMEOUT' || /tim(e|ed)\s*out/i.test(String((e && e.message) || ''))));

// Whether a draw carries an answer the judge can grade.
function gradable(d) { return !!(d && d.generation_hash && d.truncated !== true); }

// Every draw to grade, with its case and mode, in receipt order.
function drawsToGrade(receipt) {
  const out = [];
  for (const c of receipt.results.cases) for (const d of ((c.generation || {}).draws || [])) if (gradable(d)) out.push({ c, d });
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

// Everything that must hold before the first call, and what the regrade will
// cost. No call is made. -> { problems, draws, calls, usd }
function planRegrade({ receipt, skill, answers, judgeModel, samples }) {
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
  if (!problems.length) problems.push(...answerProblems(receipt, answers));
  const draws = problems.length ? 0 : drawsToGrade(receipt).length;
  const calls = draws * samples;
  const usd = Math.round(calls * perCallCostUSD(resolveModel(judgeModel), 'judge') * 1e4) / 1e4;
  return { problems, draws, calls, usd };
}

// The generation side of a draw, carried as it was.
function generationSide(d) {
  const g = { stop_reason: d.stop_reason === undefined ? null : d.stop_reason, truncated: d.truncated === true, reported_model: d.reported_model === undefined ? null : d.reported_model };
  return g;
}

// Regrade one sealed receipt. opts: { trusted, budget, timeoutMs, onProgress, nowIso }.
// -> { receipt, provenance, calls }
async function regradeReceipt({ receipt, skill, answers, judgeModel, samples, opts = {} }) {
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
    const caseObj = skill.suite.cases.find((k) => k.id === orig.id);
    const mode = orig.mode;
    const draws = [];
    let last = null;
    for (const d of orig.generation.draws) {
      if (!gradable(d)) { draws.push(JSON.parse(JSON.stringify(d))); continue; }
      const gen = generationSide(d);
      const usage = d.usage ? { usage: d.usage } : {};
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
      for (const reply of (jr.replies || [])) {
        if (!reply) continue;
        replies.push(reply);
        attest(reply, judgeModel, 'judge');
      }
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
    rubric_hashes: cases.map((c) => { const k = skill.suite.cases.find((x) => x.id === c.id); return k ? rubricHash(k.rubric) : null; }),
  };
  const out = buildReceipt({
    skill: { name: receipt.skill.name, version: receipt.skill.version, contentHash: receipt.skill.content_hash, tokens: receipt.skill.tokens },
    suite: { format: receipt.suite.format, suiteHash: receipt.suite.suite_hash, caseCount: receipt.suite.case_count, canary: receipt.suite.canary },
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
    format: 'driftproof-regrade/2',
    receipt_hash: out.receipt_hash,
    regraded_from: { receipt_hash: receipt.receipt_hash, runner_version: receipt.run.runner_version, date_utc: receipt.run.date_utc, judge: receipt.run.judge },
    generated_at_basis: receipt.run.generated_at || (receipt.run.arms && Object.values(receipt.run.arms).some((x) => x && x.generated_at))
      ? "the original receipt's own generated_at"
      : "the original receipt's run.date_utc: a receipt of that schema records no separate generation time",
    draws: { graded: drawsToGrade(receipt).length, carried: receipt.results.cases.reduce((a, c) => a + c.generation.draws.length, 0) - drawsToGrade(receipt).length },
    judge_reported_models: [...new Set(replies.flatMap((r) => (r.reportedModels || []).map((id) => canonicalModelId(id))))].sort(),
    calls,
  };
  return { receipt: out, provenance, calls };
}

module.exports = { regradeReceipt, planRegrade, answerProblems, drawsToGrade, gradable };
