// SPDX-License-Identifier: Apache-2.0
'use strict';

const { complete, resolveModel, surfaceForModel, isMeteredSurface, retryPolicyForSurface, CODEX_OVERHEAD_NOTE } = require('./provider');
const { gradeSamples, judgeSettings } = require('./judge');
const { buildReceipt } = require('./receipt');
const { sha256 } = require('./canonical');
const { registryStatus, providerForModel, priceForModel } = require('./models');
const { perCallCostUSD } = require('./cost');
const { runChecks } = require('./checks');
const { estimateTokens } = require('./skillCost');
const { hasUsage, normalizeUsage } = require('./usage');
const { buildPricingSnapshot, computeEconomics } = require('./value');
const { RUNNER_VERSION, DEFAULT_JUDGE_SAMPLES, DEV_MAX_CALLS } = require('../config');
const { SAMPLING, acrossDraws, nextAction } = require('./sampling');
const { suiteCanary } = require('./canary');

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
// and 2×samples judge calls (each generation judged `samples` times) — times the
// number of GENERATION DRAWS per arm (v0.5).
//
// `draws` DEFAULTS TO 1 so every existing caller projects exactly what it
// projected before; the runner's own cost guard passes the sampling MAXIMUM,
// which is the fail-safe direction for a guard that decides whether to spend.
function projectCalls(caseCount, samples, draws = 1) {
  return caseCount * draws * (2 + 2 * samples);
}

// Ask the target model to perform one eval case. `withSkill` decides whether the
// SKILL.md is prepended as a system prompt (the whole point: measure the skill's
// marginal effect vs a bare baseline).
async function runCase({ skillMd, caseObj, model, withSkill, timeoutMs, trusted = false }) {
  // Test seam (gate only): force a persistent timeout for a named case id so the
  // failed_timeout path is exercised deterministically without any live call.
  if (process.env.DRIFTPROOF_TEST_TIMEOUT_CASEID && process.env.DRIFTPROOF_TEST_TIMEOUT_CASEID === caseObj.id) {
    const e = new Error('provider timed out (test seam) after retries');
    e.code = 'TIMEOUT'; e.attempts = 4;
    throw e;
  }
  const system = withSkill ? skillMd : undefined;
  const { text, usage, wall_ms, attempts } = await complete({ system, prompt: caseObj.prompt, model, maxTokens: 1024, timeoutMs, trusted });
  return { text, usage, wall_ms, attempts };
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
async function judgeCase({ caseObj, response, generationHash, judgeModel, mode, timeoutMs, samples, trusted = false }) {
  const g = await gradeSamples({ task: caseObj.prompt, response, rubric: caseObj.rubric, model: judgeModel, samples, timeoutMs, trusted });
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
  // v0.4: grading overhead for this case row, kept OUT of the skill-value math.
  if (hasUsage(g.usage)) caseResult.judge_usage = g.usage;
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
//         onProgress, budget, keepTranscripts, nowIso, trusted }
//   budget          — optional BudgetTracker; accumulates estimated per-call
//                     USD as the run proceeds and hard-stops at 1.25× the cap.
//   keepTranscripts — when true, the run records transcripts:"retained-local"
//                     and returns the raw generations + judge outputs so the
//                     caller can write them to transcripts/<receipt-id>/.
// THE ONE PLACE A CALL TIMEOUT IS DECIDED (spec 017 AC-1, AC-2).
//
// PURE: a surface name and the run's options in, milliseconds out. No I/O, no
// clock, no provider — so a probe can ask what a run WOULD use without making a
// call, which is what makes this criterion assertable at all.
//
// An operator-supplied `opts.timeoutMs` still wins; what is gone is the silent
// literal that used to stand in for a policy. `Number.isFinite` rather than a
// truthiness test, so an explicit 0 is a value and not a fall-through.
// Declared as a NAMED FUNCTION EXPRESSION bound to a const, not as a bare
// declaration. The binding the module exports and the name inside the function
// are then separable, so a mutation probe can rename the inner function to prove
// the export is load-bearing without the module failing to load on an undefined
// identifier. The inner name is kept for stack traces.
const resolveCallTimeoutMs = function resolveCallTimeoutMs(surface, opts = {}) {
  if (opts && Number.isFinite(opts.timeoutMs)) return opts.timeoutMs;
  return retryPolicyForSurface(surface).timeoutMs;
};

async function runSkillOnModel({ skill, model, opts = {} }) {
  const modelId = resolveModel(model);
  const judgeModel = opts.judgeModel ? resolveModel(opts.judgeModel) : modelId;
  // THE SURFACE'S OWN DECLARED TIMEOUT, resolved per arm (spec 017 AC-1).
  //
  // This read `opts.timeoutMs || 120000`, and `lib/provider.js` documents that an
  // explicit caller value wins — so the literal outranked the policy and the
  // 300 s claude-cli timeout, written for cold-start-dominated CLI subprocesses,
  // never executed. Report #007 lost 25 of 160 draws to
  // `provider(claude-cli) timed out after 120000ms`, and one arm entirely.
  //
  // RESOLVED SEPARATELY FOR GENERATION AND JUDGE, because they can be different
  // models on different surfaces: #007 generated on claude-fable-5 and judged on
  // claude-haiku-4-5. One shared timeout would apply one surface's policy to both.
  const genTimeoutMs = resolveCallTimeoutMs(surfaceForModel(modelId), opts);
  const judgeTimeoutMs = resolveCallTimeoutMs(surfaceForModel(judgeModel), opts);
  // Optional per-case timeout overrides { caseId: ms }; a slow case can get a
  // longer budget without lengthening every other case's per-call timeout.
  const caseTimeoutMs = opts.caseTimeoutMs || {};
  const maxCalls = opts.maxCalls || DEV_MAX_CALLS;
  const samples = opts.samples || DEFAULT_JUDGE_SAMPLES;
  const concurrency = Math.max(1, opts.concurrency || 1);
  const onProgress = opts.onProgress || (() => {});
  const budget = opts.budget || null;
  const keepTranscripts = !!opts.keepTranscripts;
  // spec 022: the SAME-USER legacy spawn is reachable only when a caller says
  // `trusted: true` (bin/driftproof --trusted-skill). Every other caller of this
  // function, the report scripts and the release watcher included, isolates.
  const trusted = !!opts.trusted;

  let cases = skill.suite.cases;
  if (opts.maxCases && cases.length > opts.maxCases) cases = cases.slice(0, opts.maxCases);

  // Cost guard: project the whole run up front and refuse before spending a
  // single call if it would blow the cap.
  // The WORST CASE, deliberately: escalation is adaptive and a guard that
  // projects the floor would wave through a run that then draws ten times.
  // Refusing a run that would have fit is recoverable; overspending is not.
  const projected = projectCalls(cases.length, samples, SAMPLING.max);
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
    // A per-case override is an operator's explicit input and still wins, for
    // both arms. Otherwise each arm uses its own surface's declared policy.
    const ctGen = caseTimeoutMs[c.id] || genTimeoutMs;
    const ctJudge = caseTimeoutMs[c.id] || judgeTimeoutMs;
    // v0.5 — DRAW THE GENERATION n TIMES, and keep each draw's judge samples
    // INSIDE that draw. Pooling k×n scores into one list is precisely what made
    // generation noise read as judge noise: it is the defect Report #006 exists
    // to name, and the nesting is the whole measurement.
    const draws = [];
    let last = null;             // last MEASURED draw — carries the v0.4-shaped fields
    let lastTranscript = null;
    let action = { stop: false, reason: 'below_min' };
    let fatal = null;

    while (!action.stop && draws.length < SAMPLING.max) {
      const drawIndex = draws.length;
      try {
        onProgress({ case: c.id, mode, phase: 'generate', draw: drawIndex });
        const gen = await runCase({ skillMd: skill.skillMd, caseObj: c, model: modelId, withSkill, timeoutMs: ctGen, trusted });
        calls += 1;
        if (budget) budget.add((gen.attempts || 1) * perCallCostUSD(modelId, genKind(withSkill)));
        const generationHash = sha256(String(gen.text || ''));
        onProgress({ case: c.id, mode, phase: 'judge', samples, draw: drawIndex });
        const jr = await judgeCase({ caseObj: c, response: gen.text, generationHash, judgeModel, mode, timeoutMs: ctJudge, samples, trusted });
        calls += samples;
        if (budget) budget.add((jr.attempts || samples) * perCallCostUSD(judgeModel, 'judge'));
        const draw = {
          draw_index: drawIndex,
          generation_hash: generationHash,
          status: 'measured',
          samples: jr.caseResult.samples,
          judge_sample_hashes: jr.caseResult.judge_sample_hashes,
          mean: jr.caseResult.mean,
          stddev: jr.caseResult.stddev,
        };
        if (hasUsage(gen.usage)) draw.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
        if (jr.caseResult.judge_usage) draw.judge_usage = jr.caseResult.judge_usage;
        draws.push(draw);
        last = jr;
        if (keepTranscripts) lastTranscript = { id: c.id, mode, generation: String(gen.text || ''), judge_outputs: jr.sampleTexts };
      } catch (e) {
        if (e && e.code === 'BUDGET_HARDSTOP') throw e;   // budget hard-stop stays fatal
        if (!isTimeout(e)) { fatal = e; break; }          // non-timeout errors stay fatal
        if (budget) {
          try {
            if (e.phase === 'judge') budget.add((e.judgeAttempts || 1) * perCallCostUSD(judgeModel, 'judge'));
            else budget.add((e.attempts || 1) * perCallCostUSD(modelId, genKind(withSkill)));
          } catch (be) { if (be && be.code === 'BUDGET_HARDSTOP') throw be; }
        }
        // F-009-L: the draw is UNMEASURED. No score, no fabricated samples, and
        // it is excluded from every statistic rather than counted as a zero — a
        // zero asserts a measurement, and a timeout is the absence of one.
        draws.push({
          draw_index: drawIndex,
          generation_hash: null,
          status: 'unmeasured',
          reason: String((e && e.message) || 'timeout').slice(0, 200),
          samples: [],
          mean: null,
          stddev: null,
        });
        onProgress({ case: c.id, mode, phase: 'failed', draw: drawIndex, reason: String((e && e.message) || 'timeout') });
      }
      action = nextAction(draws);
    }
    if (fatal) throw fatal;

    const agg = acrossDraws(draws);
    const generation = {
      n_planned: SAMPLING.min,
      n_drawn: agg.n_drawn,
      n_measured: agg.n_measured,
      n_unmeasured: agg.n_unmeasured,
      stopping_reason: action.reason,
      mean: agg.mean,
      sd: agg.sd,
      judge_sd_mean: agg.judge_sd_mean,
      variance_ratio: agg.variance_ratio,
      // WHICH null, when it is null (F-014-C). Copied through explicitly rather
      // than spread from `agg`: this assembly names its keys one by one, and the
      // canary was dropped by exactly such an assembly silently gaining a field
      // upstream that nothing here carried down (F-014-D).
      variance_ratio_unavailable: agg.variance_ratio_unavailable,
      draws,
    };

    // Every draw failed: the case is recorded failed_timeout as before, but it
    // now carries the draw list showing WHAT failed and how often.
    if (!last) {
      failedCases += 1;
      return { caseResult: { id: c.id, mode, case_status: 'failed_timeout', reason: (draws[draws.length - 1] || {}).reason || 'timeout', generation }, transcript: null };
    }

    // The v0.4-shaped fields now describe the DRAW SET, not one arbitrary draw,
    // so a v0.4 reader pointed at a v0.5 receipt reads the aggregate rather than
    // whichever draw happened to be last. `generation_hash`, `samples` and
    // `judge_sample_hashes` continue to describe the last measured draw, which
    // is the one they have always described; RECEIPT.md states this.
    const caseResult = { ...last.caseResult, generation };
    caseResult.mean = agg.mean;
    caseResult.score = agg.mean;
    caseResult.stddev = agg.sd;
    caseResult.outcome = outcomeFor(agg.mean, agg.sd, c.pass_threshold);
    onProgress({ case: c.id, mode, phase: 'done', outcome: caseResult.outcome, score: caseResult.mean, stddev: caseResult.stddev });
    return { caseResult, transcript: lastTranscript };
  });
  const caseResults = pairs.map((p) => p.caseResult);
  const transcripts = keepTranscripts ? pairs.map((p) => p.transcript) : null;

  const surface = surfaceForModel(modelId);
  const nowIso = opts.nowIso || new Date().toISOString();
  // v0.4 economics. The pricing snapshot is frozen HERE, at run time, from the
  // registry; every derived dollar figure below is computed from the snapshot and
  // never from the live registry, so this receipt keeps its meaning when prices
  // later change.
  const pricingSnapshot = buildPricingSnapshot({
    models: [modelId, judgeModel],
    lookup: priceForModel,
    nowIso,
  });
  const economics = computeEconomics({
    cases: caseResults,
    modelId,
    judgeModelId: judgeModel,
    pricingSnapshot,
    surface,
    meteredSurface: isMeteredSurface(surface),
  });
  const receipt = buildReceipt({
    skill: {
      name: skill.name, version: skill.version, contentHash: skill.contentHash,
      // v0.3.1 value-per-token axis: estimated SKILL.md token size.
      tokens: estimateTokens(skill.skillMd),
    },
    // v0.5: the suite canary. Derived from the suite identity and its case ids,
    // so it is stable without a registry and distinct across suites — a leaked
    // suite is detectable in a corpus. A detection aid, not a control.
    suite: {
      format: skill.suite.format,
      suiteHash: skill.suite.suiteHash,
      caseCount: skill.suite.caseCount,
      // The FULL suite, never the post---max-cases list: a canary derived from a
      // truncated run is not stable for the suite, and a canary that moves
      // cannot say which suite leaked. Approval finding, spec 014.
      canary: suiteCanary({ id: skill.name || skill.suite.suiteHash, cases: (skill.suite.cases || cases).map((c) => ({ id: c.id })) }),
    },
    run: {
      model_id: modelId,
      model_release_date: releaseDateFor(modelId),
      provider: providerForModel(modelId),
      surface,
      // v0.3.1: on the openai/cli (codex) surface, record the fixed harness preamble.
      surface_overhead_note: surface === 'openai-cli' ? CODEX_OVERHEAD_NOTE : undefined,
      runner_version: RUNNER_VERSION,
      date_utc: nowIso,
      registry: registryStatus(modelId),
      transcripts: keepTranscripts ? 'retained-local' : 'hashes-only',
      judge: judgeSettings(samples, judgeModel),
      pricing_snapshot: pricingSnapshot,
    },
    cases: caseResults,
    economics,
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
    L.push(`> ⏱ **INCOMPLETE** — ${receipt.run.failed_case_count} case(s) had an arm that could not be measured and are EXCLUDED from the aggregates below, BOTH arms together; this receipt must not be used to compute a drift/durability verdict.`);
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

module.exports = { runSkillOnModel, summarizeReceipt, releaseDateFor, projectCalls, outcomeFor, resolveCallTimeoutMs };
