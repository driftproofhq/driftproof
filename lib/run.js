// SPDX-License-Identifier: Apache-2.0
'use strict';

const { complete, resolveModel, surfaceForModel, isMeteredSurface, retryPolicyForSurface, CODEX_OVERHEAD_NOTE, buildSpawnPlan } = require('./provider');
const { spawnSync } = require('child_process');
const { gradeSamples, judgeSettings, promptTemplateHash, isTruncated } = require('./judge');
const { buildReceipt, caseFailed, FAILED_STATUSES } = require('./receipt');
const { sha256 } = require('./canonical');
const { registryStatus, providerForModel, priceForModel, assertRegistered } = require('./models');
const { perCallCostUSD } = require('./cost');
const { runChecks } = require('./checks');
const { estimateTokens } = require('./skillCost');
const { hasUsage, normalizeUsage } = require('./usage');
const { buildPricingSnapshot, computeEconomics } = require('./value');
const { RUNNER_VERSION, DEFAULT_JUDGE_SAMPLES, DEV_MAX_CALLS } = require('../config');
const { stubEnabled } = require('./stub');
const { canonicalModelId } = require('./usage');
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

// The harness that will answer, recorded when a run starts (spec 053 AC-8, R-4): claude-code on
// claude-cli, codex on openai-cli, each version read from `<bin> --version` through the same spawn
// plan the run's calls use, so it is the binary that answers; "api" with no version on an API
// surface. A version that cannot be read is null and the reason is returned for the caller to print;
// it never stops a run. The receipt has no field for the reason (receipt v0.9's run.harness is
// {name, version}).
const HARNESS_OF = { 'claude-cli': ['claude-code', 'claude'], 'openai-cli': ['codex', 'codex'] };
function harnessFor(surface, trusted) {
  if (surface === 'api' || surface === 'openai-api') return { harness: { name: 'api', version: null } };
  const h = HARNESS_OF[surface];
  if (!h) return { harness: null };
  const [name, bin] = h;
  try {
    const plan = buildSpawnPlan({ bin, args: ['--version'], trusted });
    const r = spawnSync(plan.file, plan.args, { env: plan.env, encoding: 'utf8', timeout: 30000 });
    if (r.error) return { harness: { name, version: null }, reason: `${bin} --version could not run: ${r.error.code || r.error.message}` };
    if (r.status !== 0) return { harness: { name, version: null }, reason: `${bin} --version exited ${r.status}` };
    const m = /\d+\.\d+\.\d+[0-9A-Za-z.+-]*/.exec(r.stdout || '');
    return m ? { harness: { name, version: m[0] } } : { harness: { name, version: null }, reason: `${bin} --version printed no version` };
  } catch (e) {
    return { harness: { name, version: null }, reason: `${bin} --version could not be planned: ${e.message}` };
  }
}

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
  const out = await complete({ system, prompt: caseObj.prompt, model, maxTokens: 1024, timeoutMs, trusted });
  // The whole reply travels: what answered, what it said served the call, why
  // it stopped, and which spawn path was taken (spec 026 AC-1, AC-2, AC-8).
  return { text: out.text, usage: out.usage, wall_ms: out.wall_ms, attempts: out.attempts, answeredBy: out.answeredBy, surface: out.surface, reportedModels: out.reportedModels, stopReason: out.stopReason, isolation: out.isolation };
}

// ── what answered (spec 026, AC-2) ───────────────────────────────────────────
// The surface's echo is compared with the requested id on CANONICAL ids (the
// real claude CLI keys its usage by the undated form). A surface that names a
// DIFFERENT model stops the run before the next call; no receipt is written,
// because a receipt naming a model that did not answer is the defect this
// exists to close. A surface that names nothing is recorded as attested: false.
function attest(reply, requestedId, phase) {
  const reported = Array.isArray(reply && reply.reportedModels) ? reply.reportedModels : null;
  if (!reported || !reported.length) return { attested: false, reported };
  const want = canonicalModelId(resolveModel(requestedId));
  const other = reported.find((id) => canonicalModelId(id) !== want);
  if (other) {
    const e = new Error(`substrate mismatch: the ${phase} surface answered as "${other}" where "${requestedId}" (canonical "${want}") was requested; the run stops before the next call and no receipt is written`);
    e.code = 'SUBSTRATE_MISMATCH';
    e.requested = requestedId; e.reported = other;
    throw e;
  }
  return { attested: true, reported };
}

// The run's answered_by block, derived from every reply the run received and
// never from the surface the runner would have chosen (spec 026 AC-1: a stub
// run used to record the real surface name because the name was computed
// from the model id, not from what answered). With no reply at all (every
// call failed before answering) the kind is what the process would have
// answered with, which is the one thing still known.
function answeredByOf(replies, { attestedGen = false, reportedAll = new Set() } = {}) {
  const kinds = new Set(replies.map((r) => r && r.answeredBy).filter(Boolean));
  const kind = replies.length ? (kinds.size === 1 && kinds.has('stub') ? 'stub' : 'model') : (stubEnabled() ? 'stub' : 'model');
  const iso = replies.map((r) => r && r.isolation).find(Boolean) || 'none';
  const reportedModels = reportedAll.size ? [...reportedAll].sort() : null;
  return { kind, attested: kind === 'model' && attestedGen, reported_models: reportedModels, isolation: iso };
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
  // A judge that produced no score produced no measurement (spec 026 AC-3):
  // the draw is unmeasured with the judge's reason, and no sample is kept.
  // The judge calls that WERE made travel with the unmeasured result: their
  // output hashes (transcript auditability: the judge said something, and a
  // reader can check what) and their usage, so the receipt records every call.
  if (g.unmeasured) return { unmeasured: true, reason: g.reason, sampleTexts: g.sample_texts, sampleHashes: g.sample_hashes || [], attempts: g.attempts, replies: g.replies || [], judge_usage: hasUsage(g.usage) ? g.usage : null };
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
  return { caseResult, sampleTexts: g.sample_texts, attempts: g.attempts, replies: g.replies || [] };
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
  // Spec 026 AC-10 (F6): the target and the judge must be models the registry
  // knows, checked HERE, on the path the CLI, the report scripts and the
  // trigger all share, before the cost guard and before any call. bin/driftproof
  // makes the same check at its door so the refusal names the registry path in
  // its own message; this one is the door every caller passes.
  assertRegistered(modelId, 'model');
  assertRegistered(judgeModel, 'judge model');
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
  // Spec 026 AC-1, AC-2: every reply the run received, for the answered_by
  // block; whether every generation reply attested the requested model (read
  // from the surface's echo, AC-2); every canonical id any reply named.
  const replies = [];
  let attestedGen = true;
  const reportedAll = new Set();
  const isTimeout = (e) => !!(e && (e.code === 'TIMEOUT' || /tim(e|ed)\s*out/i.test(String((e && e.message) || ''))));
  const genKind = (ws) => (ws ? 'gen_with_skill' : 'gen_baseline');
  // v0.8 (spec 043 AC-4): when generation began, per receipt, before the first call.
  // date_utc (nowIso, below) is stamped after the last call, or passed by a batch caller.
  const generatedAt = new Date().toISOString();
  // spec 053: the harness, read once as generation begins; a stub run has none.
  const harnessRead = stubEnabled() ? { harness: null } : harnessFor(surfaceForModel(modelId), trusted);
  if (harnessRead.reason) console.error(`  ! harness version not recorded: ${harnessRead.reason}; the run carries on with run.harness.version null`);
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
    // Spec 026 AC-3: an unmeasured draw that was NOT a timeout (an empty
    // generation, a judge with no score) makes the case failed_unmeasured
    // rather than failed_timeout when no draw measured.
    let nonTimeout = false;

    // An UNMEASURED draw carries no score, no fabricated samples, and the
    // reason it carries none; it is excluded from every statistic rather than
    // counted as a zero. v0.6 adds what the surface said about the reply. The
    // generation's own hash is kept when there was text.
    const unmeasuredDraw = (drawIndex, reason, gen) => ({
      draw_index: drawIndex,
      generation_hash: gen && String(gen.text || '') ? sha256(String(gen.text || '')) : null,
      status: 'unmeasured',
      reason: String(reason || '').slice(0, 200),
      samples: [],
      mean: null,
      stddev: null,
      stop_reason: gen ? (gen.stopReason || null) : null,
      truncated: !!(gen && gen.truncated === true),
      reported_model: gen && gen.attested ? modelId : null,
    });

    while (!action.stop && draws.length < SAMPLING.max) {
      const drawIndex = draws.length;
      try {
        onProgress({ case: c.id, mode, phase: 'generate', draw: drawIndex });
        const gen = await runCase({ skillMd: skill.skillMd, caseObj: c, model: modelId, withSkill, timeoutMs: ctGen, trusted });
        calls += 1;
        if (budget) budget.add((gen.attempts || 1) * perCallCostUSD(modelId, genKind(withSkill)));
        replies.push(gen);
        // What answered, on canonical ids; a different model stops the run.
        const a = attest(gen, modelId, 'generation');
        gen.attested = a.attested;
        if (!a.attested) attestedGen = false;
        for (const id of (a.reported || [])) reportedAll.add(canonicalModelId(id));
        gen.truncated = isTruncated(gen.stopReason);
        // Spec 026 AC-8 (F4): a generation cut at the output cap is a partial
        // answer, and a partial answer graded as a whole one is a score about
        // something the model did not write. Recorded truncated, unmeasured,
        // never judged.
        if (gen.truncated === true) {
          nonTimeout = true;
          const d = unmeasuredDraw(drawIndex, `generation truncated at the output cap (stop_reason ${gen.stopReason})`, gen);
          if (hasUsage(gen.usage)) d.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
          draws.push(d);
          onProgress({ case: c.id, mode, phase: 'failed', draw: drawIndex, reason: d.reason });
          action = nextAction(draws);
          continue;
        }
        // Spec 026 AC-3 (F2): an empty generation is the absence of an output,
        // not an output that scored zero. It is not sent to the judge.
        if (!String(gen.text || '').trim()) {
          nonTimeout = true;
          const d = unmeasuredDraw(drawIndex, 'empty generation (the surface returned no text)', gen);
          if (hasUsage(gen.usage)) d.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
          draws.push(d);
          onProgress({ case: c.id, mode, phase: 'failed', draw: drawIndex, reason: d.reason });
          action = nextAction(draws);
          continue;
        }
        const generationHash = sha256(String(gen.text || ''));
        onProgress({ case: c.id, mode, phase: 'judge', samples, draw: drawIndex });
        const jr = await judgeCase({ caseObj: c, response: gen.text, generationHash, judgeModel, mode, timeoutMs: ctJudge, samples, trusted });
        calls += samples;
        if (budget) budget.add((jr.attempts || samples) * perCallCostUSD(judgeModel, 'judge'));
        for (const r of (jr.replies || [])) {
          if (!r) continue;
          replies.push(r);
          const ja = attest(r, judgeModel, 'judge');
          for (const id of (ja.reported || [])) reportedAll.add(canonicalModelId(id));
        }
        if (jr.unmeasured) {
          // The judge returned no score for this draw (empty, unparseable,
          // non-numeric, out of range): unmeasured, naming the judge's reason;
          // the generation's own hash is kept.
          nonTimeout = true;
          const d = unmeasuredDraw(drawIndex, jr.reason, gen);
          // The judge samples taken before the draw was called unmeasured are
          // recorded by hash (no score entered any statistic; the calls happened).
          if ((jr.sampleHashes || []).length) d.judge_sample_hashes = jr.sampleHashes;
          if (hasUsage(gen.usage)) d.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
          if (jr.judge_usage) d.judge_usage = jr.judge_usage;
          draws.push(d);
          onProgress({ case: c.id, mode, phase: 'failed', draw: drawIndex, reason: d.reason });
          action = nextAction(draws);
          continue;
        }
        const draw = {
          draw_index: drawIndex,
          generation_hash: generationHash,
          status: 'measured',
          samples: jr.caseResult.samples,
          judge_sample_hashes: jr.caseResult.judge_sample_hashes,
          mean: jr.caseResult.mean,
          stddev: jr.caseResult.stddev,
          // v0.6 (spec 026 AC-2, AC-8): why the generation stopped, that it
          // was not cut (a cut draw never reaches here), and what the surface
          // said served it (null when it said nothing).
          stop_reason: gen.stopReason || null,
          truncated: false,
          reported_model: gen.attested ? modelId : null,
        };
        if (hasUsage(gen.usage)) draw.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
        if (jr.caseResult.judge_usage) draw.judge_usage = jr.caseResult.judge_usage;
        draws.push(draw);
        last = jr;
        if (keepTranscripts) lastTranscript = { id: c.id, mode, generation: String(gen.text || ''), judge_outputs: jr.sampleTexts };
      } catch (e) {
        if (e && e.code === 'BUDGET_HARDSTOP') throw e;   // budget hard-stop stays fatal
        if (!isTimeout(e)) { fatal = e; break; }          // non-timeout errors stay fatal (a SUBSTRATE_MISMATCH among them)
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
          stop_reason: null,
          truncated: false,
          reported_model: null,
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
      // v0.6 (spec 026 AC-8): draws cut at the output cap, counted here so a
      // reader sees it without walking the draw list.
      n_truncated: draws.filter((d) => d.truncated === true).length,
      draws,
    };

    // Every draw failed: the case is recorded failed, carrying the draw list
    // showing WHAT failed and how often. failed_timeout when every failure was
    // a timeout; failed_unmeasured when any draw was unmeasured for another
    // reason (spec 026 AC-3). The two share one predicate, caseFailed, in
    // lib/receipt.js, and no reader excludes by either literal.
    if (!last) {
      failedCases += 1;
      const status = nonTimeout ? FAILED_STATUSES[1] : FAILED_STATUSES[0];
      const lastReason = [...draws].reverse().map((d) => d.reason).find(Boolean) || 'timeout';
      return { caseResult: { id: c.id, mode, case_status: status, reason: lastReason, generation }, transcript: null };
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

  // THE SURFACE IS WHAT ANSWERED, not what the runner would have chosen for
  // the model id (spec 026 AC-1, F1). A stub run records surface stub, judge
  // surface stub, answered_by.kind stub, and is UNVERIFIED: it measured nothing.
  const answered = answeredByOf(replies, { attestedGen: attestedGen && replies.some((r) => r && r.answeredBy === 'model'), reportedAll });
  const answeredBy = { kind: answered.kind, attested: answered.attested, reported_model: answered.attested ? modelId : null, reported_models: answered.reported_models, isolation: answered.isolation };
  const surface = answered.kind === 'stub' ? 'stub' : surfaceForModel(modelId);
  // v0.6 (spec 026 AC-11): which judge ran, and the template it graded with.
  const judgeBlock = { ...judgeSettings(samples, judgeModel), ...(answered.kind === 'stub' ? { surface: 'stub' } : {}), model_id: judgeModel, prompt_template_hash: promptTemplateHash() };
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
      // v0.3.1: on the openai/cli (codex) surface, record the fixed harness
      // preamble. Absent on a stub run: it describes a harness that did not run.
      surface_overhead_note: surface === 'openai-cli' ? CODEX_OVERHEAD_NOTE : undefined,
      // v0.9, spec 053: the harness that answered; absent on a stub run.
      harness: surface !== 'stub' && harnessRead.harness ? harnessRead.harness : undefined,
      runner_version: RUNNER_VERSION,
      date_utc: nowIso,
      generated_at: generatedAt,
      registry: registryStatus(modelId),
      transcripts: keepTranscripts ? 'retained-local' : 'hashes-only',
      judge: judgeBlock,
      pricing_snapshot: pricingSnapshot,
      answered_by: answeredBy,
    },
    cases: caseResults,
    economics,
    // The level is DERIVED from what answered: only a model-answered run may
    // read TESTED. The schema refuses TESTED on a stub receipt as the second,
    // independent control (spec 026 AC-1).
    verificationLevel: answered.kind === 'model' ? 'TESTED' : 'UNVERIFIED',
  });

  return { receipt, calls, transcripts, failedCases };
}

// A band the formula could not form is printed as what it is, never as 0.000
// (spec 026 AC-7): one included case has a mean and no dispersion; none has
// neither.
function band(mean, sd) {
  if (mean == null) return 'n/a (0 cases)';
  if (sd == null) return `${mean.toFixed(3)} ± n/a (1 case)`;
  return `${mean.toFixed(3)} ± ${sd.toFixed(3)}`;
}
// The comparison band, or the reason there is none.
function uncertaintyStr(cmp) {
  if (cmp.delta_uncertainty != null) return cmp.delta_uncertainty.toFixed(3);
  return `n/a (${cmp.delta_uncertainty_unavailable === 'single_case' ? '1 case' : cmp.delta_uncertainty_unavailable === 'no_cases' ? '0 cases' : 'no band'})`;
}
// The answered_by block, said in one line for the summary and the CLI.
function answeredLine(receipt) {
  const ab = (receipt.run && receipt.run.answered_by) || null;
  if (!ab) return 'answered by: unrecorded (pre-v0.6 receipt)';
  if (ab.kind === 'stub') return 'answered by: stub (DRIFTPROOF_STUB) — nothing answered; this run measured nothing (UNVERIFIED)';
  if (ab.kind === 'external') return 'answered by: an external tool (imported)';
  const iso = ab.isolation === 'eval-user' ? 'the isolated eval-user hop' : ab.isolation === 'same-user' ? 'the same-user spawn (--trusted-skill)' : 'no spawn (api surface)';
  return ab.attested
    ? `answered by: model ${ab.reported_model} (attested by the surface; ${iso})`
    : `answered by: model, but the surface did not report which model answered (attested: false; ${iso})`;
}

// Render a short human-readable markdown summary of a receipt.
function summarizeReceipt(receipt) {
  const L = [];
  L.push(`# ${receipt.skill.name} — receipt summary`);
  L.push('');
  L.push(`- **model:** \`${receipt.run.model_id}\`${receipt.run.model_release_date ? ` (released ${receipt.run.model_release_date})` : ''}`);
  L.push(`- **surface:** ${receipt.run.surface}`);
  L.push(`- **${answeredLine(receipt)}**`);
  L.push(`- **run (UTC):** ${receipt.run.date_utc}`);
  L.push(`- **runner:** v${receipt.run.runner_version}`);
  const j = receipt.run.judge || {};
  // v0.8 (spec 043 AC-1): an absent count is unknown, never 1.
  L.push(`- **judge:** ${Number.isInteger(j.samples) ? j.samples : 'unknown'} samples/case, temperature ${j.temperature == null ? 'n/a' : j.temperature} (${j.sampling || 'single'})`);
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
  if ((receipt.run.answered_by || {}).kind === 'stub') {
    L.push('> **STUB RUN** — DRIFTPROOF_STUB=1: nothing answered, the text was canned, and this run measured nothing. The receipt is UNVERIFIED and verdicts nothing.');
    L.push('');
  }
  if (receipt.run.status === 'incomplete') {
    L.push(`> ⏱ **INCOMPLETE** — ${receipt.run.failed_case_count} case(s) had an arm that could not be measured and are EXCLUDED from the aggregates below, BOTH arms together; this receipt must not be used to compute a drift/durability verdict.`);
    L.push('');
  }
  // Spec 026 AC-8: draws cut at the output cap, said once for the run.
  const nTruncated = receipt.results.cases.reduce((a, c) => a + (((c.generation || {}).n_truncated) || 0), 0);
  if (nTruncated) {
    L.push(`> ✂ **${nTruncated} draw(s) truncated** at the output cap: each is unmeasured and excluded from every band below.`);
    L.push('');
  }
  L.push(`with_skill **${band(aggs.with_skill.mean_score, aggs.with_skill.stddev)}** vs baseline **${band(aggs.baseline.mean_score, aggs.baseline.stddev)}**`);
  L.push('');
  if (cmp.delta == null) {
    L.push(`skill lift **n/a** (${cmp.delta_uncertainty_unavailable === 'no_cases' ? 'no case was included on an arm' : 'no comparison'})`);
  } else {
    const sign = cmp.delta >= 0 ? '+' : '';
    L.push(`skill lift **${sign}${cmp.delta.toFixed(3)}** (combined uncertainty ± ${uncertaintyStr(cmp)})`);
  }
  L.push('');
  // The rule the bands above are derived by, said beside them (spec 026 AC-6).
  L.push(`band rule: each arm's band is the sample stddev of its per-case means${aggs.band_rule ? ` — ${aggs.band_rule}` : ' (unstated on this pre-v0.6 receipt)'}`);
  L.push('');
  L.push(`## Per-case (mean ± stddev over ${Number.isInteger((receipt.run.judge || {}).samples) ? receipt.run.judge.samples : 'an unknown number of'} judge samples)`);
  L.push('');
  L.push(`| case | mode | outcome | mean ± stddev | judge reason |`);
  L.push(`|---|---|---|---|---|`);
  for (const c of receipt.results.cases) {
    if (caseFailed(c)) {
      L.push(`| \`${c.id}\` | ${c.mode} | ⏱ ${c.case_status} | — (not measured) | ${c.reason || 'not measured'} |`);
      continue;
    }
    const flag = c.outcome === 'borderline' ? ' ⚠' : '';
    L.push(`| \`${c.id}\` | ${c.mode} | ${c.outcome}${flag} | ${band(c.mean, c.stddev || 0)} | ${c.reason || ''} |`);
  }
  L.push('');
  return L.join('\n');
}

module.exports = { runSkillOnModel, judgeCase, summarizeReceipt, releaseDateFor, projectCalls, outcomeFor, resolveCallTimeoutMs, answeredLine, answeredByOf, attest, band, uncertaintyStr };
