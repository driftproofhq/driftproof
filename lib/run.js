// SPDX-License-Identifier: Apache-2.0
'use strict';

const { complete, resolveModel, surfaceForModel, CODEX_OVERHEAD_NOTE } = require('./provider');
const { gradeSamples, judgeSettings } = require('./judge');
const { buildReceipt } = require('./receipt');
const { sha256 } = require('./canonical');
const { registryStatus, providerForModel } = require('./models');
const { perCallCostUSD } = require('./cost');
const { runChecks } = require('./checks');
const { estimateTokens } = require('./skillCost');
const { RUNNER_VERSION, DEFAULT_JUDGE_SAMPLES } = require('../config');

// Known model release dates (best-effort; null when unknown). Recorded into the
// receipt so drift reports can order runs by model age. Dateless model ids
// (the 4.6 generation onward) carry no date, so the announcement date is
// recorded explicitly here from Anthropic's public launch posts (provenance
// noted in the report; consistent with spec open question #4 — dates are
// best-effort, not verified against the Models API in this run).
const MODEL_RELEASE_DATES = {
  'claude-haiku-4-5-20251001': '2025-10-01',
  'claude-haiku-4-5': '2025-10-01',
  'claude-sonnet-5': '2026-06-30',     // anthropic.com/news/claude-sonnet-5
  'claude-sonnet-4-6': '2026-02-17',   // anthropic.com/news/claude-sonnet-4-6
  'claude-opus-5': '2026-07-24',       // anthropic.com/news/claude-opus-5
  'claude-opus-4-8': '2026-05-28',     // anthropic.com/news/claude-opus-4-8
};

function releaseDateFor(modelId) {
  if (MODEL_RELEASE_DATES[modelId]) return MODEL_RELEASE_DATES[modelId];
  // Derive from a trailing YYYYMMDD in the id if present.
  const m = String(modelId).match(/(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Calls for one model run: each case does 2 generations (with_skill + baseline)
// and 2×samples judge calls (each generation judged `samples` times).
function projectCalls(caseCount, samples) {
  return caseCount * (2 + 2 * samples);
}

// Ask the target model to perform one eval case. `withSkill` decides whether the
// SKILL.md is prepended as a system prompt (the whole point: measure the skill's
// marginal effect vs a bare baseline).
async function runCase({ skillMd, caseObj, model, withSkill, timeoutMs }) {
  // Test seam (gate only): force a persistent timeout for a named case id so the
  // failed_timeout path is exercised deterministically without any live call.
  if (process.env.DRIFTPROOF_TEST_TIMEOUT_CASEID && process.env.DRIFTPROOF_TEST_TIMEOUT_CASEID === caseObj.id) {
    const e = new Error('provider timed out (test seam) after retries');
    e.code = 'TIMEOUT'; e.attempts = 4;
    throw e;
  }
  const system = withSkill ? skillMd : undefined;
  const { text, usage, attempts } = await complete({ system, prompt: caseObj.prompt, model, maxTokens: 1024, timeoutMs });
  return { text, usage, attempts };
}

// Determine a case outcome from its sampled band and threshold.
//   borderline : threshold lies within [mean - stddev, mean + stddev]
//   pass/fail  : mean clears / misses the threshold with the band clear of it
//   score      : un-thresholded case (report the number, no pass/fail)
function outcomeFor(mean, stddev, threshold) {
  if (typeof threshold !== 'number') return 'score';
  if (mean - stddev <= threshold && threshold <= mean + stddev) return 'borderline';
  return mean >= threshold ? 'pass' : 'fail';
}

// Judge one generated response `samples` times → sampled case result.
// `generationHash` binds the graded case to the exact generation text (v0.3).
// Returns { caseResult, sampleTexts } — sampleTexts is transient (retained only
// under --keep-transcripts; never part of the receipt).
async function judgeCase({ caseObj, response, generationHash, judgeModel, mode, timeoutMs, samples }) {
  const g = await gradeSamples({ task: caseObj.prompt, response, rubric: caseObj.rubric, model: judgeModel, samples, timeoutMs });
  const outcome = outcomeFor(g.mean, g.stddev, caseObj.pass_threshold);
  const caseResult = {
    id: caseObj.id,
    mode,
    outcome,
    score: g.mean,        // `score` == sampled mean (v0.1 readers still work)
    mean: g.mean,
    stddev: g.stddev,
    samples: g.samples,
    // v0.3 transcript auditability: hash of the graded generation + one hash per
    // judge sample. These make a receipt checkable against retained transcripts.
    generation_hash: generationHash,
    judge_sample_hashes: g.sample_hashes,
    threshold: typeof caseObj.pass_threshold === 'number' ? caseObj.pass_threshold : null,
    reason: g.reason,
    judge: { model_id: g.model_id, rubric_hash: g.rubric_hash },
  };
  // v0.3.1 deterministic post-checks (supplementary; NOT folded into `outcome`).
  const checks = runChecks(response, caseObj.checks);
  if (checks.length) caseResult.checks = checks;
  return { caseResult, sampleTexts: g.sample_texts, attempts: g.attempts };
}

// Run up to `concurrency` async tasks at a time, preserving input order in the
// results. Keeps the CLI grind tractable (each `claude -p` cold-start dominates
// wall-clock, so a handful of concurrent spawns is a large speedup) without
// unbounded fan-out.
async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(concurrency, items.length))).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Run the full suite for ONE model, both modes, sampled judge-grading, and build
// a sealed receipt. Enforces a hard call cap; every model+judge call counts.
//
// opts: { maxCases, maxCalls, samples, judgeModel, timeoutMs, concurrency,
//         onProgress, budget, keepTranscripts, nowIso }
//   budget          — optional BudgetTracker; accumulates estimated per-call
//                     USD as the run proceeds and hard-stops at 1.25× the cap.
//   keepTranscripts — when true, the run records transcripts:"retained-local"
//                     and returns the raw generations + judge outputs so the
//                     caller can write them to transcripts/<receipt-id>/.
async function runSkillOnModel({ skill, model, opts = {} }) {
  const modelId = resolveModel(model);
  const judgeModel = opts.judgeModel ? resolveModel(opts.judgeModel) : modelId;
  const timeoutMs = opts.timeoutMs || 120000;
  // Optional per-case timeout overrides { caseId: ms }; a slow case can get a
  // longer budget without lengthening every other case's per-call timeout.
  const caseTimeoutMs = opts.caseTimeoutMs || {};
  const maxCalls = opts.maxCalls || 200;
  const samples = opts.samples || DEFAULT_JUDGE_SAMPLES;
  const concurrency = Math.max(1, opts.concurrency || 1);
  const onProgress = opts.onProgress || (() => {});
  const budget = opts.budget || null;
  const keepTranscripts = !!opts.keepTranscripts;

  let cases = skill.suite.cases;
  if (opts.maxCases && cases.length > opts.maxCases) cases = cases.slice(0, opts.maxCases);

  // Cost guard: project the whole run up front and refuse before spending a
  // single call if it would blow the cap.
  const projected = projectCalls(cases.length, samples);
  if (projected > maxCalls) {
    const e = new Error(`cost guard: projected ${projected} calls exceeds cap ${maxCalls} (${cases.length} cases × (2 + 2×${samples} samples)). Raise --max-calls or lower --max-cases/--samples.`);
    e.code = 'CALL_CAP';
    throw e;
  }

  // One task per (case, mode). Order is preserved in the receipt regardless of
  // completion order, so receipts are deterministic under concurrency.
  const tasks = [];
  for (const c of cases) for (const withSkill of [true, false]) tasks.push({ c, withSkill });

  let calls = 0;
  let failedCases = 0;
  const isTimeout = (e) => !!(e && (e.code === 'TIMEOUT' || /tim(e|ed)\s*out/i.test(String((e && e.message) || ''))));
  const genKind = (ws) => (ws ? 'gen_with_skill' : 'gen_baseline');
  const pairs = await mapPool(tasks, concurrency, async ({ c, withSkill }) => {
    const mode = withSkill ? 'with_skill' : 'baseline';
    const ct = caseTimeoutMs[c.id] || timeoutMs;
    try {
      onProgress({ case: c.id, mode, phase: 'generate' });
      const gen = await runCase({ skillMd: skill.skillMd, caseObj: c, model: modelId, withSkill, timeoutMs: ct });
      calls += 1;
      // Live budget: count the generation call INCLUDING retries, then hard-stop
      // if over 1.25× cap.
      if (budget) budget.add((gen.attempts || 1) * perCallCostUSD(modelId, genKind(withSkill)));
      const generationHash = sha256(String(gen.text || ''));
      onProgress({ case: c.id, mode, phase: 'judge', samples });
      const jr = await judgeCase({ caseObj: c, response: gen.text, generationHash, judgeModel, mode, timeoutMs: ct, samples });
      calls += samples;
      // Live budget: count all judge calls (retries included) for this (case, mode).
      if (budget) budget.add((jr.attempts || samples) * perCallCostUSD(judgeModel, 'judge'));
      onProgress({ case: c.id, mode, phase: 'done', outcome: jr.caseResult.outcome, score: jr.caseResult.mean, stddev: jr.caseResult.stddev });
      const transcript = keepTranscripts
        ? { id: c.id, mode, generation: String(gen.text || ''), judge_outputs: jr.sampleTexts }
        : null;
      return { caseResult: jr.caseResult, transcript };
    } catch (e) {
      if (e && e.code === 'BUDGET_HARDSTOP') throw e;   // budget hard-stop stays fatal
      if (!isTimeout(e)) throw e;                        // non-timeout errors stay fatal
      // Persistent timeout → NON-FATAL: charge the consumed attempts, record the
      // case as failed_timeout (no fabricated samples), and continue the run.
      if (budget) {
        try {
          if (e.phase === 'judge') budget.add((e.judgeAttempts || 1) * perCallCostUSD(judgeModel, 'judge'));
          else budget.add((e.attempts || 1) * perCallCostUSD(modelId, genKind(withSkill)));
        } catch (be) { if (be && be.code === 'BUDGET_HARDSTOP') throw be; }
      }
      failedCases += 1;
      onProgress({ case: c.id, mode, phase: 'failed', reason: String((e && e.message) || 'timeout') });
      return { caseResult: { id: c.id, mode, case_status: 'failed_timeout', reason: String((e && e.message) || 'timeout').slice(0, 200) }, transcript: null };
    }
  });
  const caseResults = pairs.map((p) => p.caseResult);
  const transcripts = keepTranscripts ? pairs.map((p) => p.transcript) : null;

  const surface = surfaceForModel(modelId);
  const receipt = buildReceipt({
    skill: {
      name: skill.name, version: skill.version, contentHash: skill.contentHash,
      // v0.3.1 value-per-token axis: estimated SKILL.md token size.
      tokens: estimateTokens(skill.skillMd),
    },
    suite: { format: skill.suite.format, suiteHash: skill.suite.suiteHash, caseCount: skill.suite.caseCount },
    run: {
      model_id: modelId,
      model_release_date: releaseDateFor(modelId),
      provider: providerForModel(modelId),
      surface,
      // v0.3.1: on the openai/cli (codex) surface, record the fixed harness preamble.
      surface_overhead_note: surface === 'openai-cli' ? CODEX_OVERHEAD_NOTE : undefined,
      runner_version: RUNNER_VERSION,
      date_utc: opts.nowIso || new Date().toISOString(),
      registry: registryStatus(modelId),
      transcripts: keepTranscripts ? 'retained-local' : 'hashes-only',
      judge: judgeSettings(samples, judgeModel),
    },
    cases: caseResults,
    verificationLevel: 'TESTED',
  });

  return { receipt, calls, transcripts, failedCases };
}

function band(mean, sd) { return `${mean.toFixed(3)} ± ${sd.toFixed(3)}`; }

// Render a short human-readable markdown summary of a receipt.
function summarizeReceipt(receipt) {
  const L = [];
  L.push(`# ${receipt.skill.name} — receipt summary`);
  L.push('');
  L.push(`- **model:** \`${receipt.run.model_id}\`${receipt.run.model_release_date ? ` (released ${receipt.run.model_release_date})` : ''}`);
  L.push(`- **surface:** ${receipt.run.surface}`);
  L.push(`- **run (UTC):** ${receipt.run.date_utc}`);
  L.push(`- **runner:** v${receipt.run.runner_version}`);
  const j = receipt.run.judge || {};
  L.push(`- **judge:** ${j.samples || 1} samples/case, temperature ${j.temperature == null ? 'n/a' : j.temperature} (${j.sampling || 'single'})`);
  if (receipt.run.registry) L.push(`- **registry:** ${receipt.run.registry}   **transcripts:** ${receipt.run.transcripts || 'hashes-only'}`);
  L.push(`- **skill content_hash:** \`${receipt.skill.content_hash.slice(0, 16)}…\``);
  L.push(`- **suite:** ${receipt.suite.case_count} cases (${receipt.suite.format})`);
  L.push(`- **verification:** ${receipt.verification_level}`);
  L.push(`- **receipt_hash:** \`${receipt.receipt_hash.slice(0, 16)}…\``);
  L.push('');
  L.push(`## Headline`);
  L.push('');
  const cmp = receipt.comparison;
  const aggs = receipt.results.aggregates;
  const sign = cmp.delta >= 0 ? '+' : '';
  if (receipt.run.status === 'incomplete') {
    L.push(`> ⏱ **INCOMPLETE** — ${receipt.run.failed_case_count} case(s) failed (timed out after retries) and are EXCLUDED from the aggregates below; this receipt must not be used to compute a drift/durability verdict.`);
    L.push('');
  }
  L.push(`with_skill **${band(aggs.with_skill.mean_score, aggs.with_skill.stddev)}** vs baseline **${band(aggs.baseline.mean_score, aggs.baseline.stddev)}**`);
  L.push('');
  L.push(`skill lift **${sign}${cmp.delta.toFixed(3)}** (combined uncertainty ± ${cmp.delta_uncertainty.toFixed(3)})`);
  L.push('');
  L.push(`## Per-case (mean ± stddev over ${(receipt.run.judge || {}).samples || 1} judge samples)`);
  L.push('');
  L.push(`| case | mode | outcome | mean ± stddev | judge reason |`);
  L.push(`|---|---|---|---|---|`);
  for (const c of receipt.results.cases) {
    if (c.case_status === 'failed_timeout') {
      L.push(`| \`${c.id}\` | ${c.mode} | ⏱ failed_timeout | — (not measured) | ${c.reason || 'timed out'} |`);
      continue;
    }
    const flag = c.outcome === 'borderline' ? ' ⚠' : '';
    L.push(`| \`${c.id}\` | ${c.mode} | ${c.outcome}${flag} | ${band(c.mean, c.stddev || 0)} | ${c.reason || ''} |`);
  }
  L.push('');
  return L.join('\n');
}

module.exports = { runSkillOnModel, summarizeReceipt, releaseDateFor, projectCalls, outcomeFor };
