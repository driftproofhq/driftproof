// SPDX-License-Identifier: Apache-2.0
'use strict';

const { complete, resolveModel, surfaceForModel, isMeteredSurface, retryPolicyForSurface, CODEX_OVERHEAD_NOTE, buildSpawnPlan, callRoute, ROUTING_VARIABLES } = require('./provider');
const { spawnSync } = require('child_process');
const { gradeSamples, judgeSettings, promptTemplateHash, criteriaTemplateHash, isTruncated, JUDGE_CODE_REVISION } = require('./judge');
const { buildReceipt, caseFailed, FAILED_STATUSES } = require('./receipt');
const { sha256 } = require('./canonical');
const { registryStatus, providerForModel, priceForModel, assertRegistered } = require('./models');
const { perCallCostUSD } = require('./cost');
const { runChecks } = require('./checks');
const { estimateTokens, skillTokenCost, costSentence, assertReceiptShape } = require('./skillCost');
const { hasUsage, normalizeUsage } = require('./usage');
const { buildPricingSnapshot, computeEconomics } = require('./value');
const { RUNNER_VERSION, DEFAULT_JUDGE_SAMPLES, DEV_MAX_CALLS } = require('../config');
const { stubEnabled } = require('./stub');
const { canonicalModelId } = require('./usage');
const { SAMPLING, acrossDraws, nextAction } = require('./sampling');
const { suiteCanary } = require('./canary');
const { DEFAULT_CAPTURE, assertMode, judgedAnswer, lostAnswer, captureLine } = require('./capture');
const checkpoint = {
  invoke:(...args)=>require('./capture').checkpointInvoke(...args),
  beginDraw:(...args)=>require('./capture').optionalCheckpoint()?.beginDraw(...args),
  finishDraw:(...args)=>require('./capture').optionalCheckpoint()?.finishDraw(...args),
};
const { PRESET_QUICK, SMOKE_LINE, isSmoke } = require('./smoke');
const { receiptAggregatesOnly, AGGREGATES_ONLY_LINE } = require('./verdict');
// Spec 440: the placebo arm. Its builder and guard are reached through the module, so the spec's
// tests can watch them.
const placebo = require('./placebo');
const { placeboReading, placeboPairing, placeboFigures, placeboLine } = require('./verdict');
const { sealReceipt } = require('./receipt');
// Spec 438: the transport bound, the subject's kind, and a name escaped for Markdown.
const { requestPlan, requestFits, EVAL_USER_DEFAULT } = require('./provider');
const { kindOf } = require('./receipt');
const { mdText } = require('./names');

// Spec 438 (§ The transport bound): every with-skill request the run would send is measured, as the
// provider builds it, against its surface's bound, before the cost guard and before any call. A stub
// run is checked against the surface its model is configured for, and names the default eval user, as
// it takes no hop (F-022-4).
function assertSubjectFits({ skill, cases, modelId, trusted, capture }) {
  const surface = surfaceForModel(modelId);
  for (const c of cases) {
    const req = requestPlan({ surface, system: skill.skillMd, prompt: c.prompt, model: modelId, maxTokens: 1024, trusted, capture, ...(stubEnabled() ? { user: EVAL_USER_DEFAULT } : {}) });
    const over = requestFits(req);
    if (over) {
      throw Object.assign(new Error(`the subject is past what the ${surface} surface can carry: ${over.what} would be ${over.size}, and the bound is ${over.bound}. Nothing run, no receipt written.`), { code: 'SUBJECT_TRANSPORT', surface, ...over });
    }
  }
}

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

// THE JUDGE'S SETTING (issue 196, A-184-13): what the judge grades in besides its model, sample count
// and template, as a run records it in run.judge and a rubric regrade compares it. The surface, sampling
// and temperature are lib/judge.js judgeSettings's, with surface `stub` when the stub answers. The
// harness is the judge surface's (`<bin> --version` through the judge's own spawn plan; `api` with no
// version on an api surface; `none` on the stub): on a CLI surface the CLI's own instructions are part
// of what the judge reads. The isolation is the judge's spawn path: eval-user (the hop), same-user
// (--trusted-skill), none (an api surface, the stub). The endpoint (A-184-20) is the route the judge's
// call takes, resolved by the code that makes the call (lib/provider.js callRoute): whether its address
// is custom, the sha256 of the address and never the address, what resolved it (`runner`, `cli` or
// `none`), and each routing variable the call is handed, set or not with the sha256 of its value. The
// hop hands its child HOME and PATH only; what its login shell reads from the eval user's profile is not
// recorded. The code revision is lib/judge.js JUDGE_CODE_REVISION. `harness`, when given, is a harness
// already read for this surface and spawn path, so it is not read twice. -> { settings, harness,
// harnessReason, isolation, endpoint, code_revision }
function judgeEnvironment({ judgeModel, samples, trusted = false, harness = null }) {
  const settings = judgeSettings(samples, judgeModel);
  const stub = stubEnabled();
  const surface = stub ? 'stub' : settings.surface;
  const cli = surface === 'claude-cli' || surface === 'openai-cli';
  const isolation = cli ? (trusted ? 'same-user' : 'eval-user') : 'none';
  const read = stub ? { harness: { name: 'none', version: null } } : harness ? { harness } : harnessFor(surface, trusted);
  const route = callRoute(judgeModel, { trusted });
  const routing = Object.fromEntries(ROUTING_VARIABLES.map((k) => [k, route.routing[k] === undefined ? { set: false, sha256: null } : { set: true, sha256: sha256(String(route.routing[k])) }]));
  return {
    settings: { ...settings, surface },
    harness: read.harness || { name: 'none', version: null },
    harnessReason: read.reason || null,
    isolation,
    endpoint: { custom: route.custom, sha256: route.url ? sha256(route.url) : null, resolved_by: route.resolvedBy, routing },
    code_revision: JUDGE_CODE_REVISION,
  };
}

// Issue 196 (A-184-22): the ids a judge reply named for the judge's own model, as named, so a dated
// snapshot is told from another of the same model. Auxiliary ids are the draw's (spec 180). -> [id]
function judgeSnapshotIds(reported, judgeModel) {
  const want = canonicalModelId(resolveModel(judgeModel));
  return (reported || []).filter((id) => canonicalModelId(id) === want);
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
// Spec 440 AC-12: `arms` is 3 for a run with the placebo arm, and defaults to 2.
function projectCalls(caseCount, samples, draws = 1, arms = 2) {
  return caseCount * draws * arms * (1 + samples);
}

// Ask the target model to perform one eval case. `withSkill` decides whether the
// SKILL.md is prepended as a system prompt (the whole point: measure the skill's
// marginal effect vs a bare baseline).
async function runCase({ skillMd, caseObj, model, withSkill, timeoutMs, trusted = false, capture = DEFAULT_CAPTURE }) {
  // Test seam (gate only): force a persistent timeout for a named case id so the
  // failed_timeout path is exercised deterministically without any live call.
  if (process.env.DRIFTPROOF_TEST_TIMEOUT_CASEID && process.env.DRIFTPROOF_TEST_TIMEOUT_CASEID === caseObj.id) {
    const e = new Error('provider timed out (test seam) after retries');
    e.code = 'TIMEOUT'; e.attempts = 4;
    throw e;
  }
  const system = withSkill ? skillMd : undefined;
  const out = await checkpoint.invoke(complete, { system, prompt: caseObj.prompt, model, maxTokens: capture === 'repository' ? 16384 : 1024, timeoutMs, trusted, capture }, 'generation');
  let snapshot={};
  if(capture==='repository'&&out.workspace_snapshot){
    const context=require('./checkpoint').context.getStore();
    if(context){const saved=await require('./hidden-execution').publishFinalWorkspace(out.workspace_snapshot,{directory:context.dir,runtime:require('./repository-execution').environment()});snapshot={snapshot_hash:saved.snapshot_hash,snapshot_file:saved.snapshotFile};}
  }
  // The whole reply travels: what answered, what it said served the call, why
  // it stopped, and which spawn path was taken (spec 026 AC-1, AC-2, AC-8), and
  // in files capture the workspace it left (spec 137).
  return { ...snapshot, ...(out.request_hash ? {request_hash:out.request_hash,transcript_hash:out.transcript_hash} : {}), ...(out.delivery ? { delivery: out.delivery } : {}), ...(out.collection ? { collection: out.collection } : {}), text: out.text, usage: out.usage, wall_ms: out.wall_ms, attempts: out.attempts, answeredBy: out.answeredBy, surface: out.surface, reportedModels: out.reportedModels, modelTokens: out.modelTokens, servedModel: out.servedModel, stopReason: out.stopReason, isolation: out.isolation, ...('workspace' in out ? { workspace: out.workspace } : {}) };
}

// ── what answered (spec 026, AC-2) ───────────────────────────────────────────
// The surface's echo is compared with the requested id on CANONICAL ids (the
// real claude CLI keys its usage by the undated form). A surface that names a
// DIFFERENT model stops the run before the next call; no receipt is written,
// because a receipt naming a model that did not answer is the defect this
// exists to close. A surface that names nothing is recorded as attested: false.
//
// WHICH MODEL SERVED THE MAIN TURN (issue 134, spec 180 R-1). Claude Code can
// make calls of its own on another model (an auxiliary Haiku call) and name
// that model in the same reply. A call attests when the requested canonical id
// is among the ids named AND served the main turn:
//   1. the requested id is not named: refused;
//   2. the result names its serving model and it is another: refused;
//   3. every id named is the requested one: attested (the shape before 2.1.29x);
//   4. the result names the requested model as serving: attested;
//   5. else the requested id must carry more than half of the output tokens
//      the reply counts per id (ids summed by canonical form); a tie, or no
//      count at all, is refused.
// An attested reply returns every other id, verbatim with its token counts, as
// `auxiliary`, for the draw to record; none is dropped.
function mainTurn(reply, reported, want) {
  const others = reported.filter((id) => canonicalModelId(id) !== want);
  if (others.length === reported.length) return { other: others[0], why: 'the requested model is not among the models it named' };
  const served = reply && typeof reply.servedModel === 'string' && reply.servedModel ? reply.servedModel : null;
  if (served && canonicalModelId(served) !== want) return { other: served, why: 'its result names that model as serving the turn' };
  if (!others.length) return { other: null, auxiliary: [] };
  const tokens = reply && reply.modelTokens && typeof reply.modelTokens === 'object' ? reply.modelTokens : {};
  const out = (id) => (tokens[id] && Number.isFinite(tokens[id].output_tokens) ? tokens[id].output_tokens : 0);
  if (!served) {
    const mine = reported.filter((id) => canonicalModelId(id) === want).reduce((a, id) => a + out(id), 0);
    const rest = others.reduce((a, id) => a + out(id), 0);
    if (!(mine > rest)) {
      const top = [...others].sort((x, y) => out(y) - out(x))[0];
      return { other: top, why: `the requested model carried ${mine} of ${mine + rest} output tokens, not more than half, so it did not serve the main turn` };
    }
  }
  const auxiliary = others.map((id) => ({
    model: id,
    input_tokens: tokens[id] && Number.isFinite(tokens[id].input_tokens) ? tokens[id].input_tokens : null,
    output_tokens: tokens[id] && Number.isFinite(tokens[id].output_tokens) ? tokens[id].output_tokens : null,
  }));
  return { other: null, auxiliary };
}
function attest(reply, requestedId, phase) {
  const reported = Array.isArray(reply && reply.reportedModels) ? reply.reportedModels : null;
  if (!reported || !reported.length) return { attested: false, reported };
  const want = canonicalModelId(resolveModel(requestedId));
  const served = mainTurn(reply, reported, want);
  const other = served.other;
  if (other) {
    const e = new Error(`substrate mismatch: the ${phase} surface answered as "${other}" where "${requestedId}" (canonical "${want}") was requested (${served.why}); the run stops before the next call and no receipt is written`);
    e.code = 'SUBSTRATE_MISMATCH';
    e.requested = requestedId; e.reported = other;
    throw e;
  }
  const auxiliary = served.auxiliary || [];
  return { attested: true, reported, ...(auxiliary.length ? { auxiliary } : {}) };
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
// `concurrency` is the run's --concurrency (issue 104, A-173-3): at 1, the default
// and the regrade's, the judge samples are asked one at a time.
// Spec 185: a case that lists criteria is graded per criterion, and a measured
// result returns `criteriaSamples`, one record per judge sample, beside the case
// result (the case row has no field for them; the draw and the retained record do).
// Issue 196 (A-185-16): a criteria case's result carries the criteria template hash its judge
// calls were made on, measured or not. Issue 196 (A-184-10): `withChecks` false runs no
// deterministic check; a regrade carries the original's check results instead.
async function judgeCase({ caseObj, response, generationHash, judgeModel, mode, timeoutMs, samples, trusted = false, concurrency = 1, withChecks = true, onAttempt = null }) {
  const g = await gradeSamples({ task: caseObj.prompt, response, rubric: caseObj.rubric, criteria: caseObj.criteria, threshold: caseObj.pass_threshold, model: judgeModel, samples, timeoutMs, trusted, oneAtATime: concurrency <= 1, onAttempt });
  const template = Array.isArray(caseObj.criteria) ? { criteriaTemplateHash: criteriaTemplateHash() } : {};
  // A judge that produced no score produced no measurement (spec 026 AC-3):
  // the draw is unmeasured with the judge's reason, and no sample is kept.
  // The judge calls that WERE made travel with the unmeasured result: their
  // output hashes (transcript auditability: the judge said something, and a
  // reader can check what) and their usage, so the receipt records every call.
  if (g.unmeasured) return { unmeasured: true, reason: g.reason, sampleTexts: g.sample_texts, sampleHashes: g.sample_hashes || [], attempts: g.attempts, replies: g.replies || [], judge_usage: hasUsage(g.usage) ? g.usage : null, ...template };
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
  const checks = withChecks ? runChecks(response, caseObj.checks) : [];
  if (checks.length) caseResult.checks = checks;
  // v0.4: grading overhead for this case row, kept OUT of the skill-value math.
  if (hasUsage(g.usage)) caseResult.judge_usage = g.usage;
  return { caseResult, sampleTexts: g.sample_texts, attempts: g.attempts, replies: g.replies || [], ...(g.criteria_samples ? { criteriaSamples: g.criteria_samples } : {}), ...template };
}

// Spec 185 (R-5): what a measured draw of a criteria case records, per judge
// sample: the computed total and pass, each criterion's decision, and the names
// of the reply's keys that were not read. Nothing for a case without criteria.
function criteriaJudgments(jr) {
  if (!jr.criteriaSamples) return {};
  return { criteria_judgments: jr.criteriaSamples.map((s) => ({ total: s.total, pass: s.pass, judgments: s.judgments.map((j) => ({ id: j.id, decision: j.decision })), ignored: s.ignored })) };
}

// Issue 196 (A-185-16): what a judged draw of a criteria case records, measured or not: the criteria
// template hash its judge calls were made on. Nothing for a case without criteria.
function criteriaTemplate(jr) {
  return jr && jr.criteriaTemplateHash ? { criteria_template_hash: jr.criteriaTemplateHash } : {};
}

// The retained record bin/driftproof writes for one case and mode under
// --keep-transcripts (spec/RECEIPT.md § Transcripts). Spec 185 (R-6): a criteria
// case's record also carries each judge sample's raw reply beside its parsed
// judgments, total, pass and ignored keys; any other record is the four keys.
function transcriptRecord(t) {
  return { id: t.id, mode: t.mode, generation: t.generation, judge_outputs: t.judge_outputs, ...(t.criteria_samples ? { criteria_samples: t.criteria_samples } : {}) };
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

// How many of a task's draws to take at once (spec 173 R-3): at most `concurrency`, and only draws the
// sampling rule (lib/sampling.js nextAction) takes whatever the draws already in flight return. Below
// the minimum the rule draws again whatever the scores, so the draws still short of SAMPLING.min are
// certain, unless the cap, or every draw lost at the minimum, could stop the rule first. Past the
// minimum the next draw depends on the scores, so it is one at a time. Called only when the rule has
// said to draw, so it is never less than one. Pure: a draw list in, a count out. `cap` is the most
// draws the arm may take: SAMPLING.max, or the quick preset's own (A-139-17).
function drawsAtOnce(draws, concurrency, cap = SAMPLING.max) {
  const a = acrossDraws(draws);
  let k = 1;
  while (k < concurrency) {
    if (a.n_measured + k >= SAMPLING.min) break;
    if (a.n_drawn + k >= cap) break;
    if (a.n_measured === 0 && a.n_drawn + k >= SAMPLING.min) break;
    k += 1;
  }
  return k;
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
//                     caller can write them to transcripts/<receipt-id>/:
//                     `transcripts`, the last measured draw of each case and
//                     mode, and `answers`, every draw's (spec 184).
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
  return retryPolicyForSurface(surface, { capture: opts.capture }).timeoutMs;
};

async function runSkillOnModel(args) { return args.opts?.checkpointDir || args.opts?.resume ? require('./checkpoint').runWithCheckpoint(args, runSkillCore) : runSkillCore(args); }
async function runSkillCore({ skill, model, opts = {} }) {
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
  // Spec 137: which answer is judged. `text` unless the caller says `files`, and `files` only on a
  // surface where a child can write one; refused before the cost guard and before any call.
  const capture = assertMode(opts.capture || DEFAULT_CAPTURE);
  const executionBundle=(opts.executionSuite||skill.suite.executionFreeze)?require('./execution-grading').assertExecutionRun(skill,opts):null;
  if (capture === 'repository') {
    if (!opts.checkpointDir && !opts.resume && !stubEnabled()) throw Object.assign(new Error('Repository runs require an output checkpoint directory.'), {code:'CHECKPOINT_REQUIRED'});
    require('./repository').policy({timeoutMs:genTimeoutMs});
    if (Object.keys(opts.caseTimeoutMs||{}).length) throw Object.assign(new Error('Repository capture requires one timeout across cases.'), {code:'CAPTURE_LIMITS'});
    if (concurrency !== 1) throw Object.assign(new Error('Repository calls must be serial.'), { code: 'CHECKPOINT_CONCURRENCY' });
    require('./repository-execution').assertRequest({ surface: surfaceForModel(modelId), trusted });
    require('./repository-execution').assertRequest({ surface: surfaceForModel(judgeModel), trusted });
  }
  if (capture === 'files' && !stubEnabled() && isMeteredSurface(surfaceForModel(modelId))) {
    const e = new Error(`capture files: the ${surfaceForModel(modelId)} surface has no tools and no working directory, so nothing can write a file; run a CLI surface or capture text. Nothing run, no receipt written.`);
    e.code = 'CAPTURE_SURFACE';
    throw e;
  }

  // spec 139 (R-3): a run under the quick preset is a smoke run. Its receipt names the preset and
  // is UNVERIFIED whatever answered it, so every reader that refuses below TESTED refuses it.
  const preset = opts.preset === PRESET_QUICK ? PRESET_QUICK : null;
  // A-139-17 (AC-367-2): the draws per arm are capped below the sampling rule's ceiling only for a run
  // that names the preset, whose receipt is UNVERIFIED. Any other run draws by the sampling rule.
  const drawCap = preset && Number.isInteger(opts.draws) && opts.draws >= 1 ? Math.min(opts.draws, SAMPLING.max) : SAMPLING.max;

  let cases = skill.suite.cases;
  if (opts.taskIds) {
    if (preset !== PRESET_QUICK || new Set(opts.taskIds).size !== opts.taskIds.length || opts.taskIds.some(id=>!cases.some(c=>c.id===id))) throw new Error('Diagnostic task selection is invalid.');
    cases=opts.taskIds.map(id=>cases.find(c=>c.id===id));
  }
  if (opts.onlyArm && (preset !== PRESET_QUICK || !['with_skill','baseline','placebo'].includes(opts.onlyArm))) throw new Error('A single arm requires the diagnostic quick preset.');
  if (opts.maxCases && cases.length > opts.maxCases) cases = cases.slice(0, opts.maxCases);

  // Issue 489: only record an explicit supported setting that every selected case uses.
  // Library callers keep their per-case overrides; a varying run has no uniform record.
  const recordsTimeout = Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0 && opts.timeoutMs <= 2147478647
    && cases.every((c) => (caseTimeoutMs[c.id] || opts.timeoutMs) === opts.timeoutMs);

  // Spec 440: the placebo, built and checked before the cost guard and before any call. It is the
  // skill text's length in bytes (AC-1), and shares no six-word run with the skill text (AC-2).
  const arms = opts.placebo ? 3 : 2;
  let placeboText = null;
  if (opts.placebo) {
    const p = placebo.placeboFor({ skillText: skill.skillMd, seed: skill.contentHash });
    placebo.assertPlaceboLength(skill.skillMd, p);
    const shared = placebo.sharedRun(skill.skillMd, p.text);
    if (shared) {
      const e = new Error(`placebo: the placebo shares the words "${shared}" with the skill text, so it would repeat the skill's own wording; nothing run, no receipt written`);
      e.code = 'PLACEBO_OVERLAP';
      throw e;
    }
    placeboText = p.text;
  }

  assertSubjectFits({ skill, cases, modelId, trusted, capture });

  // Cost guard: project the whole run up front and refuse before spending a
  // single call if it would blow the cap.
  // The WORST CASE, deliberately: escalation is adaptive and a guard that
  // projects the floor would wave through a run that then draws ten times.
  // Refusing a run that would have fit is recoverable; overspending is not.
  const projected = projectCalls(cases.length, samples, drawCap, arms);
  if (projected > maxCalls) {
    const e = new Error(arms === 2
      ? `cost guard: projected ${projected} calls exceeds cap ${maxCalls} (${cases.length} cases × (2 + 2×${samples} samples)). Raise --max-calls or lower --max-cases/--samples.`
      : `cost guard: projected ${projected} calls exceeds cap ${maxCalls} (${cases.length} cases × 3 arms × (1 + ${samples} samples), the placebo arm included). Raise --max-calls or lower --max-cases/--samples.`);
    e.code = 'CALL_CAP';
    throw e;
  }

  // One task per (case, mode). Order is preserved in the receipt regardless of
  // completion order, so receipts are deterministic under concurrency.
  const tasks = [];
  for (const c of cases) for (const mode of ['with_skill', 'baseline', ...(placeboText ? ['placebo'] : [])]) if (!opts.onlyArm || mode === opts.onlyArm) tasks.push({ c, mode });

  let calls = 0;
  let failedCases = 0;
  // Spec 026 AC-1, AC-2: every reply the run received, for the answered_by
  // block; whether every generation reply attested the requested model (read
  // from the surface's echo, AC-2); every canonical id any reply named.
  const replies = [];
  let attestedGen = true;
  const reportedAll = new Set();
  // Issue 196 (A-184-22): the ids the judge's replies named for the judge's own model, as named.
  const judgeIds = new Set();
  let judgeIdentityComplete = true;
  const isTimeout = (e) => !!(e && (e.code === 'TIMEOUT' || /tim(e|ed)\s*out/i.test(String((e && e.message) || ''))));
  const genKind = (mode) => `gen_${mode}`;
  // v0.8 (spec 043 AC-4): when generation began, per receipt, before the first call.
  // date_utc (nowIso, below) is stamped after the last call, or passed by a batch caller.
  const generatedAt = new Date().toISOString();
  // spec 053: the harness, read once as generation begins; a stub run has none.
  const harnessRead = stubEnabled() ? { harness: null } : capture === 'repository' ? {harness:{name:'claude-code',version:require('./repository-execution').environment().profile.configuration.cli_version}} : harnessFor(surfaceForModel(modelId), trusted);
  if (harnessRead.reason) console.error(`  ! harness version not recorded: ${harnessRead.reason}; the run carries on with run.harness.version null`);
  // Issue 196 (A-184-13): the judge's own setting, read before any call. Its harness is the one just
  // read when the judge shares the generation's surface, else it is read for the judge's.
  const sharesHarness = !stubEnabled() && judgeSettings(samples, judgeModel).surface === surfaceForModel(modelId);
  const judgeEnv = judgeEnvironment({ judgeModel, samples, trusted, harness: sharesHarness ? harnessRead.harness : null });
  if (!sharesHarness && judgeEnv.harnessReason) console.error(`  ! judge harness version not recorded: ${judgeEnv.harnessReason}; the run carries on with run.judge.harness.version null`);
  const pairs = await mapPool(tasks, concurrency, async ({ c, mode }) => {
    // Spec 440 AC-3: the placebo arm makes the with-skill arm's call with the placebo as its system
    // text; nothing else differs.
    const withSkill = mode !== 'baseline';
    const systemText = mode === 'placebo' ? placeboText : skill.skillMd;
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
    const keptAnswers = [];      // spec 184: every draw's answer, in index order, under --keep-transcripts
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
    // The words an empty files-capture reply's reason gains for the files the judge could not be
    // shown: the first three, each with its own reason, as many as fit the reason's 200 characters
    // whole, then "and more".
    const notShown = (files) => {
      if (!files.length) return '';
      const head = '; the workspace held no file the judge could be shown (';
      const base = 'empty generation (the surface returned no text)'.length + head.length + ')'.length;
      const parts = [];
      for (let i = 0; i < files.length && i < 3; i++) {
        const part = `${files[i].path}: ${files[i].why}`;
        const more = i + 1 < files.length ? ', and more'.length : 0;
        if (base + [...parts, part].join(', ').length + more > 200) break;
        parts.push(part);
      }
      if (!parts.length) return `${head}${files.length} named in captured_files)`;
      return `${head}${parts.join(', ')}${parts.length < files.length ? ', and more' : ''})`;
    };
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

    // One draw: its generation, then its judge samples. It returns what the draw adds to the arm, and
    // never touches the arm's draw list: the loop below takes a batch's draws in their index order
    // (spec 173 R-3), so the receipt is the one a draw-at-a-time loop writes.
    // Spec 184 (R-1): `kept` is the answer the draw was returned and the judge outputs that came back
    // for it, set as they arrive, so a draw the judge failed on keeps its answer too.
    const drawOnce = async (drawIndex) => {
      const kept = { answer: null, judge_outputs: [] };
      checkpoint.beginDraw([modelId, skill.contentHash, c.id, mode, drawIndex]);
      const result = await drawAnswer(drawIndex, kept);
      if (result.draw) checkpoint.finishDraw(result.draw, kept);
      return { ...result, kept };
    };
    const drawAnswer = async (drawIndex, kept) => {
      let completed = null, execution=null, executionGen=null, annotateDraw=d=>d;
      const aux = [];
      const observeJudge = (received) => {
        if (opts.onReply) for (const [sample, r] of received.entries()) {
          if (r) opts.onReply({ phase: 'judge', case: c.id, mode, draw: drawIndex, sample, reply: r });
        }
      };
      const recordJudge = (received) => {
        for (const r of received) {
          if (!r) { judgeIdentityComplete = false; continue; }
          replies.push(r);
          const ja = attest(r, judgeModel, 'judge');
          const ids = judgeSnapshotIds(ja.reported, judgeModel);
          if (!ja.attested || !ids.length) judgeIdentityComplete = false;
          for (const id of (ja.reported || [])) reportedAll.add(canonicalModelId(id));
          for (const id of ids) judgeIds.add(id);
          for (const x of (ja.auxiliary || [])) aux.push({ phase: 'judge', ...x });
        }
      };
      try {
        onProgress({ case: c.id, mode, phase: 'generate', draw: drawIndex });
        const gen = await runCase({ skillMd: systemText, caseObj: c, model: modelId, withSkill, timeoutMs: ctGen, trusted, capture });
        executionGen=gen;
        if (opts.onReply) opts.onReply({ phase: 'generation', case: c.id, mode, draw: drawIndex, sample: null, reply: gen });
        calls += 1;
        if (budget) budget.add((gen.attempts || 1) * perCallCostUSD(modelId, genKind(mode)));
        replies.push(gen);
        // What answered, on canonical ids; a different model stops the run.
        const a = attest(gen, modelId, 'generation');
        gen.attested = a.attested;
        if (!a.attested) attestedGen = false;
        for (const id of (a.reported || [])) reportedAll.add(canonicalModelId(id));
        // Issue 134 (spec 180 R-2): every auxiliary call the surface named, generation and judge,
        // is recorded on the draw with its tokens; absent when there was none.
        aux.push(...(a.auxiliary || []).map((x) => ({ phase: 'generation', ...x })));
        const noteAux = annotateDraw = (d) => { if (aux.length) d.auxiliary_calls = aux; if (capture === 'repository') { if(gen.snapshot_hash)d.snapshot_hash=gen.snapshot_hash; if(executionBundle){d.score_basis=c.id==='result-type-typescript'?'judge-only':'hidden-tests';d.primary=execution?.pass_rate??null;if(execution)d.execution=execution;} d.repository_files=(gen.workspace||[]).map(({content,...f})=>f); if(gen.request_hash){d.request_hash=gen.request_hash;d.transcript_hash=gen.transcript_hash;} d.delivery = gen.delivery || { complete: false, terminal_status: 'incomplete_evidence', tool_calls: null, tool_results: null, observed_tool_calls: 0, observed_tool_results: 0, tool_events: [], reasons: ['missing_evidence'] }; d.collection = gen.collection || { enumeration_complete: true, omissions: (gen.workspace || []).filter(f => !f.included).length }; } return d; };
        if (capture === 'repository' && gen.delivery && gen.delivery.complete === false) {
          kept.answer=judgedAnswer(gen.text,gen.workspace||[],capture)||null;
          const d = {...unmeasuredDraw(drawIndex, gen.delivery.terminal_status, gen),generation_hash:kept.answer===null?null:sha256(kept.answer)};
          return { draw: noteAux(d), answer:kept.answer, nonTimeout: true };
        }
        gen.truncated = isTruncated(gen.stopReason);
        // Spec 184: the reply as it came back, kept even when it is cut or lost below; an empty reply
        // is no answer.
        kept.answer = String(gen.text || '') || null;
        // Spec 026 AC-8 (F4): a generation cut at the output cap is a partial
        // answer, and a partial answer graded as a whole one is a score about
        // something the model did not write. Recorded truncated, unmeasured,
        // never judged.
        if (gen.truncated === true) {
          const d = unmeasuredDraw(drawIndex, `generation truncated at the output cap (stop_reason ${gen.stopReason})`, gen);
          if (hasUsage(gen.usage)) d.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
          onProgress({ case: c.id, mode, phase: 'failed', draw: drawIndex, reason: d.reason });
          return { draw: noteAux(d), nonTimeout: true };
        }
        // Spec 026 AC-3 (F2): an empty generation is the absence of an output,
        // not an output that scored zero. It is not sent to the judge. Spec 141 R-4:
        // in files capture the workspace is read first, so a child that left its
        // answer in a file and replied with nothing is judged on the file.
        if(executionBundle){
          if(!gen.snapshot_file)throw Object.assign(Error('Execution generation has no durable snapshot.'),{code:'EXECUTION_HARNESS'});
          const selected=executionBundle.cases.find(x=>x.id===c.id);
          if(!selected.judge_only)execution=await require('./hidden-execution').executeHiddenTests({snapshotFile:gen.snapshot_file,caseSpec:selected,user:require('./provider').evalUser(),runtime:require('./repository-execution').environment(),freezeHash:executionBundle.freeze_hash});
        }
        const filesShown = capture !== 'text' && Array.isArray(gen.workspace) && gen.workspace.some((f) => f.included === true);
        if (!execution && !String(gen.text || '').trim() && !filesShown) {
          // A-141-1 (F-3): in files capture the files the collector named stay on the draw, and the
          // reason names them with theirs, so none is dropped.
          const named = capture !== 'text' && Array.isArray(gen.workspace) ? gen.workspace : [];
          const d = { ...unmeasuredDraw(drawIndex, `empty generation (the surface returned no text)${notShown(named)}`, gen), ...(named.length ? { captured_files: named.map((f) => ({ path: f.path, bytes: f.bytes, included: f.included === true })) } : {}) };
          if (hasUsage(gen.usage)) d.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
          onProgress({ case: c.id, mode, phase: 'failed', draw: drawIndex, reason: d.reason });
          return { draw: noteAux(d), nonTimeout: true };
        }
        // Spec 137 R-3: THE JUDGED ANSWER is the reply, and in files capture the files the child
        // left, each in a block. In text capture it is the reply byte for byte. A files-capture
        // draw whose workspace could not be collected was not seen whole, so it is lost.
        const workspace = capture !== 'text' ? gen.workspace : [];
        const capturedFiles = Array.isArray(workspace) && capture !== 'text' ? { captured_files: workspace.map((f) => ({ path: f.path, bytes: f.bytes, included: f.included === true })) } : {};
        const answer = judgedAnswer(gen.text, workspace, capture);
        kept.answer = answer;
        // Spec 137 R-4, R-5: an answer that points at a file the judge is not shown, or only
        // describes work, is a lost draw, never a score. Read off the answer by lib/capture.js
        // lostAnswer, a pattern reading with no model call; never judged.
        const lost = Array.isArray(workspace) ? (capture === 'repository' ? null : lostAnswer(answer, workspace)) : { reason: 'the workspace could not be collected, so the answer was not seen whole' };
        if (lost) {
          const d = { ...unmeasuredDraw(drawIndex, lost.reason, { ...gen, text: answer }), ...capturedFiles };
          if (hasUsage(gen.usage)) d.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
          onProgress({ case: c.id, mode, phase: 'failed', draw: drawIndex, reason: d.reason });
          return { draw: noteAux(d), nonTimeout: true };
        }
        const generationHash = sha256(answer);
        // Preserve the generation side even when the judge never returns a grade.
        completed = { ...unmeasuredDraw(drawIndex, '', { ...gen, text: answer }), ...capturedFiles };
        if (hasUsage(gen.usage)) completed.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
        onProgress({ case: c.id, mode, phase: 'judge', samples, draw: drawIndex });
        let jr = await judgeCase({ caseObj: c, response: answer, generationHash, judgeModel, mode, timeoutMs: ctJudge, samples, trusted, concurrency });
        kept.judge_outputs = jr.sampleTexts || [];
        observeJudge(jr.replies || []);
        calls += samples;
        if (budget) budget.add((jr.attempts || samples) * perCallCostUSD(judgeModel, 'judge'));
        recordJudge(jr.replies || []);
        const secondary=executionBundle?require('./execution-grading').secondaryGrade(jr):null;
        if(execution)jr=require('./execution-grading').primaryJudgeResult(jr,execution,c,mode,generationHash,judgeModel);
        if (jr.unmeasured) {
          // The judge returned no score for this draw (empty, unparseable,
          // non-numeric, out of range): unmeasured, naming the judge's reason;
          // the generation's own hash is kept. Spec 184 A-184-1: it is the hash of
          // the answer the judge was shown, as on a measured or lost draw; in files
          // capture that is the reply with its file blocks, not the reply alone.
          const d = unmeasuredDraw(drawIndex, jr.reason, { ...gen, text: answer });
          // The judge samples that answered are recorded by hash (no score
          // entered any statistic; the calls happened).
          if ((jr.sampleHashes || []).length) d.judge_sample_hashes = jr.sampleHashes;
          if (hasUsage(gen.usage)) d.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
          if (jr.judge_usage) d.judge_usage = jr.judge_usage;
          Object.assign(d, capturedFiles, criteriaTemplate(jr),secondary?{secondary}:{});
          onProgress({ case: c.id, mode, phase: 'failed', draw: drawIndex, reason: d.reason });
          return { draw: noteAux(d), nonTimeout: true };
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
          ...capturedFiles,
          ...(secondary?{secondary}:{}),
        };
        if (hasUsage(gen.usage)) draw.usage = normalizeUsage({ ...gen.usage, wall_ms: gen.wall_ms });
        if (jr.caseResult.judge_usage) draw.judge_usage = jr.caseResult.judge_usage;
        Object.assign(draw, criteriaJudgments(jr));
        Object.assign(draw, criteriaTemplate(jr));
        // Spec 173: the draw's judge calls are done. lib/progress.js settles them on this, since a
        // task's next draw may already be under way.
        onProgress({ case: c.id, mode, phase: 'judged', draw: drawIndex });
        return { draw: noteAux(draw), jr, answer };
      } catch (e) {
        if (e && e.judgeReplies) observeJudge(e.judgeReplies);
        if (e && e.code === 'BUDGET_HARDSTOP') throw e;   // budget hard-stop stays fatal
        if (!isTimeout(e)) return { fatal: e };           // non-timeout errors stay fatal (a SUBSTRATE_MISMATCH among them)
        if (budget) {
          try {
            if (e.phase === 'judge') budget.add((e.judgeAttempts || 1) * perCallCostUSD(judgeModel, 'judge'));
            else budget.add((e.attempts || 1) * perCallCostUSD(modelId, genKind(mode)));
          } catch (be) { if (be && be.code === 'BUDGET_HARDSTOP') throw be; }
        }
        // F-009-L: the draw is UNMEASURED. No score, no fabricated samples, and
        // it is excluded from every statistic rather than counted as a zero — a
        // zero asserts a measurement, and a timeout is the absence of one.
        if (e.phase === 'judge') {
          calls += e.judgeCalls || samples;
          kept.judge_outputs = e.judgeTexts || [];
          recordJudge(e.judgeReplies || []);
        }
        if(execution&&e.phase==='judge'){
          const failed={unmeasured:true,reason:'Secondary judge call timed out.',sampleTexts:kept.judge_outputs,sampleHashes:kept.judge_outputs.map(sha256),replies:e.judgeReplies||[]};
          const partialUsage=require('./usage').sumUsage((e.judgeReplies||[]).map(r=>r?.usage));if(hasUsage(partialUsage))failed.judge_usage=partialUsage;
          const grading=require('./execution-grading'),jr=grading.primaryJudgeResult(failed,execution,c,mode,sha256(kept.answer),judgeModel);
          const d={draw_index:drawIndex,generation_hash:sha256(kept.answer),status:'measured',samples:[execution.pass_rate],mean:execution.pass_rate,stddev:0,judge_sample_hashes:failed.sampleHashes,secondary:grading.secondaryGrade(failed),stop_reason:executionGen.stopReason||null,truncated:false,reported_model:executionGen.attested?modelId:null};
          if(hasUsage(partialUsage))d.judge_usage=partialUsage;
          if(hasUsage(executionGen.usage))d.usage=normalizeUsage({...executionGen.usage,wall_ms:executionGen.wall_ms});
          return {draw:annotateDraw(d),jr,answer:kept.answer,nonTimeout:true};
        }
        const d = {
          ...unmeasuredDraw(drawIndex, '', null),
          ...(completed || {}),
          generation_hash: kept.answer === null ? null : sha256(kept.answer),
          mean: null,
          stddev: null,
          reason: completed ? 'the judge call timed out after its retries, so no score was given'
            : 'the generation call timed out after its retries, so no answer was returned',
          ...(aux.length ? { auxiliary_calls: aux } : {}),
          ...(kept.judge_outputs.length ? { judge_sample_hashes: kept.judge_outputs.map(sha256) } : {}),
        };
        onProgress({ case: c.id, mode, phase: 'failed', draw: drawIndex, reason: d.reason });
        if(executionBundle&&e.phase==='judge')d.secondary=require('./execution-grading').secondaryGrade({unmeasured:true,reason:d.reason,sampleHashes:kept.judge_outputs.map(sha256)});
        return { draw: executionBundle?annotateDraw(d):d };
      }
    };

    // Spec 173 (R-3): a task's draws run up to `concurrency` at once, and only as many as the sampling
    // rule takes whatever the draws in flight return (drawsAtOnce). They are taken in index order, and
    // the rule reads the list after each batch, so the draws, their order and the stopping reason are
    // the one-at-a-time loop's. A fatal error in a batch stops the arm as it did.
    while (!action.stop && draws.length < drawCap) {
      const batch = drawsAtOnce(draws, concurrency, drawCap);
      const got = await Promise.all(Array.from({ length: batch }, (_, j) => drawOnce(draws.length + j)));
      for (const g of got) {
        if (g.fatal) { fatal = g.fatal; break; }
        draws.push(g.draw);
        // Spec 184 (R-1): every draw is a row, with the answer it was returned (null when none came
        // back) and the judge outputs that came back for it, whatever its status.
        if (keepTranscripts) keptAnswers.push({ id: c.id, mode, draw_index: g.draw.draw_index, generation_hash: g.draw.generation_hash, status: g.draw.status, answer: g.kept.answer, judge_outputs: g.kept.judge_outputs });
        if (g.nonTimeout) nonTimeout = true;
        if (!g.jr) continue;
        last = g.jr;
        // Issue 104: the per-case transcript keeps the last measured draw of the task only (spec/RECEIPT.md
        // § Transcripts). It is decided here, in index order, so a later draw in the batch overwrites it.
        if (keepTranscripts) lastTranscript = { id: c.id, mode, generation: g.answer, judge_outputs: g.jr.sampleTexts, ...(g.jr.criteriaSamples ? { criteria_samples: g.jr.criteriaSamples } : {}) };
      }
      if (fatal) break;
      action = nextAction(draws);
    }
    if (fatal) throw fatal;
    // A-139-17: the preset's cap stopped the arm before the sampling rule did; the receipt says so.
    if (!action.stop && draws.length >= drawCap) action = { stop: true, reason: 'max_reached' };

    const agg = acrossDraws(draws);
    const generation = {
      n_planned: drawCap < SAMPLING.max ? drawCap : SAMPLING.min,
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
      return { caseResult: { id: c.id, mode, case_status: status, reason: lastReason, generation, ...(executionBundle?{score_basis:c.id==='result-type-typescript'?'judge-only':'hidden-tests',primary:null,secondary:require('./execution-grading').secondaryAcrossDraws(draws)}:{}) }, transcript: null, answers: keptAnswers };
    }

    // The v0.4-shaped fields now describe the DRAW SET, not one arbitrary draw,
    // so a v0.4 reader pointed at a v0.5 receipt reads the aggregate rather than
    // whichever draw happened to be last. `generation_hash`, `samples` and
    // `judge_sample_hashes` continue to describe the last measured draw, which
    // is the one they have always described; RECEIPT.md states this.
    const caseResult = { ...last.caseResult, generation };
    if(executionBundle)Object.assign(caseResult,{score_basis:c.id==='result-type-typescript'?'judge-only':'hidden-tests',primary:c.id==='result-type-typescript'?null:agg.mean,secondary:require('./execution-grading').secondaryAcrossDraws(draws)});
    caseResult.mean = agg.mean;
    caseResult.score = agg.mean;
    caseResult.stddev = agg.sd;
    caseResult.outcome = outcomeFor(agg.mean, agg.sd, c.pass_threshold);
    onProgress({ case: c.id, mode, phase: 'done', outcome: caseResult.outcome, score: caseResult.mean, stddev: caseResult.stddev });
    return { caseResult, transcript: lastTranscript, answers: keptAnswers };
  });
  const caseResults = pairs.map((p) => p.caseResult);
  const transcripts = keepTranscripts ? pairs.map((p) => p.transcript) : null;
  // Spec 184: every draw's answer, in receipt order (task order, then draw index).
  const answers = keepTranscripts ? pairs.flatMap((p) => p.answers) : null;

  // THE SURFACE IS WHAT ANSWERED, not what the runner would have chosen for
  // the model id (spec 026 AC-1, F1). A stub run records surface stub, judge
  // surface stub, answered_by.kind stub, and is UNVERIFIED: it measured nothing.
  const answered = answeredByOf(replies, { attestedGen: attestedGen && replies.some((r) => r && r.answeredBy === 'model'), reportedAll });
  const answeredBy = { kind: answered.kind, attested: answered.attested, reported_model: answered.attested ? modelId : null, reported_models: answered.reported_models, isolation: answered.isolation };
  const surface = answered.kind === 'stub' ? 'stub' : surfaceForModel(modelId);
  // v0.6 (spec 026 AC-11): which judge ran, and the template it graded with.
  // v0.12 (issue 196): and the judge's harness, isolation, endpoint and code revision; the ids it
  // answered as (A-184-22); and, when a case lists criteria, the criteria template once (A-185-19).
  if (!judgeIdentityComplete) judgeIds.clear();
  const judgeBlock = {
    ...judgeSettings(samples, judgeModel), ...(answered.kind === 'stub' ? { surface: 'stub' } : {}), model_id: judgeModel, prompt_template_hash: promptTemplateHash(), harness: judgeEnv.harness, isolation: judgeEnv.isolation, endpoint: judgeEnv.endpoint, code_revision: judgeEnv.code_revision,
    reported_models: judgeIds.size ? [...judgeIds].sort() : null,
    ...(capture==='repository'?{relationship:require('./receipt').repositoryJudgeRelationship(modelId,judgeModel)}:{}),
    ...(cases.some((c) => Array.isArray(c.criteria)) ? { criteria_template_hash: criteriaTemplateHash() } : {}),
  };
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
      // v0.15 (spec 438): a skill directory or a context file, as lib/skill.js loadSubject read it.
      unit: skill.unit || 'skill',
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
      ...(executionBundle?{scoring:require('./execution-grading').scoringDescriptor(executionBundle),secondary_complete:caseResults.every(c=>c.generation.draws.every(d=>d.secondary?.status==='measured'))}:{}),
      ...(recordsTimeout ? { timeout_ms: genTimeoutMs } : {}),
      pricing_snapshot: pricingSnapshot,
      answered_by: answeredBy,
      // v0.10, spec 137: which answer was judged.
      ...(capture==='repository'?{scope:{kind:opts.onlyArm?'diagnostic':'comparison',task_ids:cases.map(c=>c.id),expected_arms:opts.onlyArm?[opts.onlyArm]:['with_skill','baseline',...(placeboText?['placebo']:[])],...(opts.onlyArm?{draws_per_arm:drawCap}:{})}}:{}),
      capture: capture === 'repository' ? { ...require('./repository').policy({timeoutMs:genTimeoutMs}), answer_annotation:require('./capture').REPOSITORY_ANNOTATION, ...(() => { const e = require('./repository-execution').environment(); return { runtime_image_digest: e.runtime_image_digest, effective_environment_hash: e.effective_environment_hash }; })() } : { mode: capture },
      // v0.11, spec 139: the preset a smoke run was made under; absent on every other run.
      ...(preset ? { preset } : {}),
    },
    cases: caseResults,
    economics,
    // The level is DERIVED from what answered: only a model-answered run may
    // read TESTED. The schema refuses TESTED on a stub receipt as the second,
    // independent control (spec 026 AC-1). Spec 139: nor may a smoke run, and the
    // schema refuses TESTED on a receipt that names a preset, the same way.
    verificationLevel: answered.kind === 'model' && !preset ? 'TESTED' : 'UNVERIFIED',
  });

  return { receipt: placeboText ? withPlaceboBlock(receipt, skill, placeboText) : receipt, calls, transcripts, answers, failedCases };
}

// Spec 440: a run with the placebo arm writes the placebo block, sealed with the rest: what the placebo
// was, the corpus it was drawn from, and the figures over the paired cases. The figures are the
// reader's own (lib/verdict.js placeboFigures), so a reader recomputing them from the rows gets these.
// Issue 438: at the current version, 0.15, as every run; 0.14 is frozen.
function withPlaceboBlock(built, skill, placeboText) {
  const { receipt_hash: _old, ...receipt } = built;   // eslint-disable-line no-unused-vars
  receipt.schema_version = placebo.PLACEBO_SCHEMA_VERSION;
  const corpus = [...placebo.PLACEBO_CORPORA[placebo.PLACEBO_REVISION]];
  const pr = placeboPairing(receipt);
  const f = placeboFigures(receipt, pr.ids);
  const scheduled=receipt.run.scope?require('./receipt').inspectScope(receipt.run.scope,receipt.results.cases).excluded.filter(e=>e.modes.includes('placebo')):[];
  const excluded=[...new Map([...pr.excluded,...scheduled].map(e=>[e.id,e])).values()];
  receipt.placebo = {
    revision: placebo.PLACEBO_REVISION,
    length_measure: 'utf8_bytes',
    skill_bytes: Buffer.byteLength(skill.skillMd, 'utf8'),
    bytes: Buffer.byteLength(placeboText, 'utf8'),
    seed: skill.contentHash,
    corpus,
    corpus_hash: placebo.corpusHashOf(corpus),
    sha256: placebo.sha256Hex(placeboText),
    skill_tokens_estimate: estimateTokens(skill.skillMd),
    tokens_estimate: estimateTokens(placeboText),
    aggregates: { ...f.aggregates, ...(excluded.length ? { excluded_cases: excluded.map((e) => ({ id: e.id, modes: ['placebo'], reason: e.reason })) } : {}) },
    comparison: f.comparison,
  };
  return sealReceipt(receipt);
}

// Spec 440 AC-14: the summary's placebo section, after the per-case table. The reading's words name
// the case rule; the aggregate is its own line, apart from it.
function placeboSection(receipt) {
  const p = receipt.placebo;
  const r = placeboReading(receipt);
  const L = ['## Same-length placebo', ''];
  L.push(`- **placebo:** ${p.bytes} bytes, the skill text's length in bytes, from the revision ${p.revision} corpus, a fixed text chosen without reference to any task (sha256 \`${String(p.sha256).slice(0, 16)}…\`)`);
  L.push(`- ${placeboLine(r)}`);
  if (r.reading !== 'NOT_MEASURED') {
    const c = r.figures.comparison;
    const n = (x) => (x == null ? 'n/a' : x.toFixed(3));
    L.push(`- aggregate, apart from the case rule: mean score with_skill ${n(c.with_skill_score)}, placebo ${n(c.placebo_score)}, difference (with_skill minus placebo) ${c.delta == null ? 'n/a' : `${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(3)}`}, combined uncertainty ± ${n(c.delta_uncertainty)}`);
  }
  L.push('');
  return L.join('\n');
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
// The answered_by block, said in one line for the summary and the CLI. `name` says the reported
// model id; a stub summary passes `code` (issue 245), the CLI passes nothing.
function answeredLine(receipt, name = (s) => s) {
  const ab = (receipt.run && receipt.run.answered_by) || null;
  if (!ab) return 'answered by: unrecorded (pre-v0.6 receipt)';
  if (ab.kind === 'stub') return 'answered by: stub (DRIFTPROOF_STUB) — nothing answered; this run measured nothing (UNVERIFIED)';
  if (ab.kind === 'external') return 'answered by: an external tool (imported)';
  const iso = ab.isolation === 'eval-user' ? 'the isolated eval-user hop' : ab.isolation === 'same-user' ? 'the same-user spawn (--trusted-skill)' : 'no spawn (api surface)';
  return ab.attested
    ? `answered by: model ${name(ab.reported_model)} (attested by the surface; ${iso})`
    : `answered by: model, but the surface did not report which model answered (attested: false; ${iso})`;
}

// Issue 245 (spec 245 AC-8): a string a user chose, said in a stub summary as one code span on one
// line, so it cannot read as a lift or a verdict.
const code = (s) => `\`${String(s).replace(/`/g, "'").replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')}\``;
// Issue 245: the roles the stub filled, read from the sealed receipt alone, never from the
// environment (spec 245 AC-1). -> null on a receipt no stub answered or graded
function stubRoles(receipt) {
  const run = receipt.run || {};
  const answered = (run.answered_by || {}).kind === 'stub' || run.surface === 'stub';
  const judged = (run.judge || {}).surface === 'stub';
  if (!answered && !judged) return null;
  const by = (run.answered_by || {}).kind === 'model' ? 'a model wrote the saved answers' : 'the saved answers came from outside the stub';
  const role = answered && judged ? 'the stub wrote every answer and gave every grade; no model was called'
    : answered ? 'the stub wrote every answer and a model graded them; the answers are canned text'
      : `${by} and the stub gave every grade; no model graded them`;
  return { answered, judged, role };
}

// Spec 265 AC-47: the summary of a receipt carrying the mark. The run date is the day alone, as the
// source gives it, and the headline says why no figure is shown.
function summarizeMarked(receipt) {
  const run = receipt.run || {};
  return [
    `# ${(receipt.skill || {}).name} receipt summary`,
    '',
    `- **model:** \`${run.model_id}\``,
    `- **surface:** ${run.surface}`,
    `- **source:** ${run.source || 'unknown'}`,
    `- **run (UTC):** ${String(run.date_utc || 'undated').slice(0, 10)}`,
    `- **verification:** ${receipt.verification_level}`,
    `- **receipt_hash:** \`${String(receipt.receipt_hash || '').slice(0, 16)}…\``,
    '',
    '## Headline',
    '',
    `${AGGREGATES_ONLY_LINE.charAt(0).toUpperCase()}${AGGREGATES_ONLY_LINE.slice(1)}.`,
    'No lift, score, band or case result is shown.',
    '',
  ].join('\n');
}

// Render a short human-readable markdown summary of a receipt.
// Spec 184 A-184-3: a re-judge (run.judged_at) is never presented as a run. Its date_utc is the
// grading time. `opts.regradeOf` ({ receipt_hash, file, date_utc, kind: 'rubric' | 'judge', judge }),
// which `driftproof regrade` passes for both kinds, names the original receipt and its run date.
// Spec 438 (§ What a reader is told): a context file's summary says what the delivery field records and,
// apart from it, what was sent, read off the subject-bearing requests: a with-skill draw whose answer
// came back, on a receipt a model answered.
const SUBJECT_LINES = {
  sent: (n) => `- **subject:** context file ${n}, delivery injected: the with-skill requests that completed carried its text`,
  stub: (n) => `- **subject:** context file ${n}, delivery injected as configured; the stub answered, so no request carried its text`,
  none: (n) => `- **subject:** context file ${n}, delivery injected as configured; no with-skill request completed`,
};
function subjectSent(receipt) {
  const by = (receipt.run && receipt.run.answered_by) || {};
  if (by.kind === 'stub') return 'stub';
  const answered = (c) => ((c.generation || {}).draws || []).some((d) => typeof d.generation_hash === 'string' && d.generation_hash);
  return by.kind === 'model' && receipt.results.cases.some((c) => c.mode === 'with_skill' && answered(c)) ? 'sent' : 'none';
}

function summarizeReceipt(receipt, opts = {}) {
  assertReceiptShape(receipt);
  const regraded = !!(opts.regradeOf || receipt.run.judged_at);
  const cost = regraded ? skillTokenCost(receipt) : null;
  // Spec 265 AC-47: a receipt carrying the mark is summarised by its own header facts, its run date as
  // the day alone, and no lift, score, band or case result.
  if (receiptAggregatesOnly(receipt)) {
    const marked = summarizeMarked(receipt);
    return cost && cost.shown ? marked + costSentence(cost.text) + '\n' : marked;
  }
  const rg = opts.regradeOf || null;
  // Issue 245: a receipt that records stub answers or stub grades says so first, keeps its header
  // facts and shows no result (spec 245). Any other receipt's summary is the Base's, byte for byte.
  const stub = stubRoles(receipt);
  const say = stub ? code : (s) => s;
  const L = [];
  // Spec 438: a context file's name is its file name, kept as it is, so it is escaped wherever it is shown.
  const contextFile = kindOf(receipt).value === 'context_file';
  if (contextFile) L.push(`# ${mdText(receipt.skill.name)} receipt summary`);
  else L.push(stub ? `# ${code(receipt.skill.name)} receipt summary` : `# ${receipt.skill.name} — receipt summary`);
  L.push('');
  if (stub) {
    L.push(`> **STUB RUN (DRIFTPROOF_STUB=1):** ${stub.role}. This receipt is UNVERIFIED. Stub receipt measures nothing.`);
    L.push('');
  }
  if (contextFile) L.push(SUBJECT_LINES[subjectSent(receipt)](mdText(receipt.skill.name)));
  L.push(`- **model:** ${stub ? code(receipt.run.model_id) : `\`${receipt.run.model_id}\``}${receipt.run.model_release_date ? ` (released ${receipt.run.model_release_date})` : ''}`);
  L.push(`- **surface:** ${receipt.run.surface}`);
  L.push(`- **${stub && stub.answered ? 'answered by: the stub (DRIFTPROOF_STUB) wrote every answer; no model answered' : answeredLine(receipt, say)}**`);
  // Spec 137: said only where the receipt records it, so an older receipt's summary is unchanged.
  if (receipt.run.capture) L.push(`- **${captureLine(receipt.run.capture)}**`);
  if (receipt.run.capture?.mode === 'repository') L.push(...require('./repository-execution').summaryLines(receipt));
  if(receipt.run.scoring)L.push(...require('./execution-grading').executionSummaryLines(receipt));
  if (rg) {
    const grader = stub && stub.judged
      ? (rg.kind === 'rubric' ? 'by the stub under a revised rubric' : `by the stub, not by the judge ${rg.judge} it was asked for`)
      : (rg.kind === 'rubric' ? 'under a revised rubric' : `by the judge ${rg.judge}`);
    L.push(`- **regrade:** a regrade of the saved answers of receipt \`${String(rg.receipt_hash).slice(0, 16)}…\` (${say(rg.file)}, run ${rg.date_utc}), graded again ${grader}; no answer was generated`);
    L.push(`- **graded (UTC):** ${receipt.run.date_utc}`);
  } else if (receipt.run.judged_at) {
    L.push(`- **graded (UTC):** ${receipt.run.date_utc} (a regrade of answers generated earlier; no answer was generated)`);
  } else {
    L.push(`- **run (UTC):** ${receipt.run.date_utc}`);
  }
  L.push(`- **runner:** v${receipt.run.runner_version}`);
  const j = receipt.run.judge || {};
  // v0.8 (spec 043 AC-1): an absent count is unknown, never 1.
  const perCase = `${Number.isInteger(j.samples) ? j.samples : 'unknown'} samples/case`;
  L.push(stub && stub.judged
    ? `- **judge:** the stub (DRIFTPROOF_STUB), ${perCase}; no model graded`
    : `- **judge:** ${perCase}, temperature ${j.temperature == null ? 'n/a' : j.temperature} (${say(j.sampling || 'single')})`);
  if(j.relationship){
    L.push('- **configured judge model:** '+code(j.model_id));
    L.push(receipt.run.scoring?'Comparisons use hidden execution within one target model across baseline, with-file and placebo. Sonnet grades the secondary part.':'Comparisons are within one target model across baseline, with-file and placebo, all graded by the same judge.');
    if(j.relationship.limitation)L.push(j.relationship.limitation);
  }
  if (receipt.run.registry) L.push(`- **registry:** ${receipt.run.registry}   **transcripts:** ${receipt.run.transcripts || 'hashes-only'}`);
  L.push(`- **skill content_hash:** \`${receipt.skill.content_hash.slice(0, 16)}…\``);
  L.push(receipt.run.scope?.kind==='diagnostic'?`- **suite:** ${receipt.run.scope.task_ids.length} of ${receipt.suite.case_count} tasks (${say(receipt.suite.format)})`:`- **suite:** ${receipt.suite.case_count} cases (${say(receipt.suite.format)})`);
  L.push(`- **verification:** ${receipt.verification_level}`);
  L.push(`- **receipt_hash:** \`${receipt.receipt_hash.slice(0, 16)}…\``);
  L.push('');
  L.push(`## Headline`);
  L.push('');
  // Spec 245 AC-4: no lift, score, band or case result, and none of the banners that qualify them.
  if(receipt.run.scope?.kind==='diagnostic'){
    const s=require('./receipt').inspectScope(receipt.run.scope,receipt.results.cases);
    L.push('Diagnostic, '+s.measured+'/'+s.expected+' draws measured, comparison not scheduled.');
    if(s.excluded.length)L.push('INCOMPLETE: '+s.excluded.length+' scheduled task(s) could not be fully measured.');
    L.push('UNVERIFIED. A diagnostic cannot produce a verdict.','');
    return L.join('\n');
  }
  if (stub) {
    L.push('No lift, score, band or case result is shown.');
    if (cost && cost.shown) L.push('', costSentence(cost.text));
    L.push('');
    return L.join('\n');
  }
  const cmp = receipt.comparison;
  const aggs = receipt.results.aggregates;
  // Spec 139 (R-4): a smoke run's summary carries the plain line and no lift.
  const smoke = isSmoke(receipt);
  if (smoke) {
    L.push(`> **SMOKE RUN** (--quick): ${SMOKE_LINE}. This receipt is UNVERIFIED and records run.preset "${receipt.run.preset}"; its numbers show the run worked, not whether the skill helps.`);
    L.push('');
  }
  if(receipt.run.capture?.mode==='repository'&&!smoke){
    const v=require('./verdict'),reading=v.receiptVerdict(receipt);
    if(reading.verdict==='UNDERPOWERED')L.push('UNDERPOWERED. '+v.underpoweredLine(reading.drawsNeeded)+'. '+(v.drawsLine(reading.drawsNeeded)||''),'');
  }
  if (receipt.run.status === 'incomplete') {
    L.push(`> ⏱ **INCOMPLETE** — ${receipt.run.failed_case_count} case(s) had an arm that could not be measured and are EXCLUDED from the aggregates below, BOTH arms together; this receipt must not be used to compute a drift/durability verdict.`);
    L.push('');
  }
  // Spec 026 AC-8: draws cut at the output cap, said once for the run.
  // Spec 440: the placebo arm's rows are read in their own section, below, and nowhere above it.
  const rows = receipt.results.cases.filter((c) => c.mode !== 'placebo');
  const nTruncated = rows.reduce((a, c) => a + (((c.generation || {}).n_truncated) || 0), 0);
  if (nTruncated) {
    L.push(`> ✂ **${nTruncated} draw(s) truncated** at the output cap: each is unmeasured and excluded from every band below.`);
    L.push('');
  }
  L.push(`with_skill **${band(aggs.with_skill.mean_score, aggs.with_skill.stddev)}** vs baseline **${band(aggs.baseline.mean_score, aggs.baseline.stddev)}**`);
  L.push('');
  if (smoke) {
    L.push(`skill lift **n/a** (${SMOKE_LINE.charAt(0).toLowerCase()}${SMOKE_LINE.slice(1)})`);
  } else if (cmp.delta == null) {
    L.push(`skill lift **n/a** (${cmp.delta_uncertainty_unavailable === 'no_cases' ? 'no case was included on an arm' : 'no comparison'})`);
  } else {
    const sign = cmp.delta >= 0 ? '+' : '';
    L.push(`skill lift **${sign}${cmp.delta.toFixed(3)}** (combined uncertainty ± ${uncertaintyStr(cmp)})`);
  }
  L.push('');
  if (cost && cost.shown) L.push(costSentence(cost.text), '');
  // The rule the bands above are derived by, said beside them (spec 026 AC-6).
  L.push(`band rule: each arm's band is the sample stddev of its per-case means${aggs.band_rule ? ` — ${aggs.band_rule}` : ' (unstated on this pre-v0.6 receipt)'}`);
  L.push('');
  L.push(`## Per-case (mean ± stddev over ${Number.isInteger((receipt.run.judge || {}).samples) ? receipt.run.judge.samples : 'an unknown number of'} judge samples)`);
  L.push('');
  L.push(`| case | mode | outcome | mean ± stddev | judge reason |`);
  L.push(`|---|---|---|---|---|`);
  for (const c of rows) {
    if (caseFailed(c)) {
      L.push(`| \`${c.id}\` | ${c.mode} | ⏱ ${c.case_status} | — (not measured) | ${c.reason || 'not measured'} |`);
      continue;
    }
    const flag = c.outcome === 'borderline' ? ' ⚠' : '';
    L.push(`| \`${c.id}\` | ${c.mode} | ${c.outcome}${flag} | ${band(c.mean, c.stddev || 0)} | ${c.reason || ''} |`);
  }
  L.push('');
  // Spec 440 AC-14: the section follows the summary as it stands, so the text before it is the same
  // run's summary without the arm, byte for byte.
  return L.join('\n') + (receipt.placebo ? placeboSection(receipt) : '');
}

module.exports = { assertSubjectFits, runSkillOnModel, judgeCase, criteriaJudgments, criteriaTemplate, judgeEnvironment, judgeSnapshotIds, transcriptRecord, summarizeReceipt, releaseDateFor, projectCalls, outcomeFor, resolveCallTimeoutMs, answeredLine, answeredByOf, attest, band, uncertaintyStr, drawsAtOnce };
