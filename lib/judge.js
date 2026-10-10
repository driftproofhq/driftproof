// SPDX-License-Identifier: Apache-2.0
'use strict';

const { complete, surfaceForModel } = require('./provider');
const { extractJsonObject } = require('./json');
const { canonicalize, sha256 } = require('./canonical');
const { mean, stddev, round } = require('./stats');
const { sumUsage } = require('./usage');
const { SCORE_SCALE } = require('../config');

// Rubric-based LLM judge.
//
// REWRITTEN from scratch. Only the generic SHAPE of a private "gap report"
// grader was reused: (system role) + (material + rubric) + "return ONLY JSON" +
// salvage-parse + clamp/validate the score. All domain content (sales/committee/
// deal) was dropped — none of it applies here. Scanned clean against the deny-list.
//
// The judge reads a model's OUTPUT for one eval case and grades it against that
// case's rubric, returning a normalized score in [0,1] plus a short reason.

const JUDGE_SYSTEM =
  'You are a strict, fair grader. You are given a TASK, a model RESPONSE to that task, '
  + 'and a RUBRIC describing what a good response must do. Grade only against the rubric. '
  + 'Be objective and specific: reward exactly what the rubric asks for and nothing else. '
  + 'Return your grade as JSON only.';

// Build the grading prompt. Kept deterministic so the same (task, response,
// rubric) always yields the same prompt and thus a stable rubric_hash.
function buildJudgePrompt({ task, response, rubric }) {
  return [
    'TASK GIVEN TO THE MODEL:',
    '"""',
    String(task || '').trim(),
    '"""',
    '',
    'MODEL RESPONSE TO GRADE:',
    '"""',
    String(response || '').trim(),
    '"""',
    '',
    'RUBRIC (grade strictly against this):',
    '"""',
    String(rubric || '').trim(),
    '"""',
    '',
    'Return ONLY this JSON object, no prose before or after:',
    '{',
    '  "score": <number 0.0 to 1.0, fraction of the rubric satisfied>,',
    '  "pass": <true if the response substantially meets the rubric, else false>,',
    '  "reason": "<one sentence, <=30 words, citing the specific rubric points met or missed>"',
    '}',
  ].join('\n');
}

// The rubric_hash recorded in the receipt binds a grade to the EXACT grading
// instruction used, so a later reader can tell whether two receipts were graded
// the same way. It hashes the judge system prompt + the case rubric text.
function rubricHash(rubric) {
  return sha256(JUDGE_SYSTEM + '\n---\n' + String(rubric || '').trim());
}

// v0.6 (spec 026 AC-11): a digest over the grading TEMPLATE with its three
// slots empty, recorded once per run as run.judge.prompt_template_hash. The
// rubric_hash above binds a grade to the case's rubric; this binds every grade
// of the run to the words around it. A different template is a different judge,
// and `diff` computes no verdict across one.
function promptTemplateHash() {
  return sha256(JUDGE_SYSTEM + '\n---\n' + buildJudgePrompt({ task: '', response: '', rubric: '' }));
}

// ── criteria cases (spec 185) ────────────────────────────────────────────────
// A case that lists criteria is graded per criterion. The judge decides each
// one, met or not_met, and gives no total: the weighted total and the pass are
// computed here, in code, from the decisions and the case's weights. The
// operator's 10 Oct 2026 regrade showed a judge returning components totalling
// 1.0 with a score of 0.875, and a pass under the threshold. Computing the
// total fixes that arithmetic, not the judge's reading of an answer.
const CRITERIA_SYSTEM =
  'You are a strict, fair grader. You are given a TASK, a model RESPONSE to that task, '
  + 'and a list of CRITERIA. Decide each criterion on its own: met if the response satisfies it, '
  + 'not_met if it does not. Judge only what the response contains. '
  + 'Return your decisions as JSON only.';
const DECISIONS = ['met', 'not_met'];

// The criteria prompt. Weights are not shown: the judge decides, the code weighs.
// A rubric the case also has is shown as context.
function buildCriteriaPrompt({ task, response, rubric, criteria }) {
  const context = String(rubric || '').trim();
  return [
    'TASK GIVEN TO THE MODEL:',
    '"""',
    String(task || '').trim(),
    '"""',
    '',
    'MODEL RESPONSE TO GRADE:',
    '"""',
    String(response || '').trim(),
    '"""',
    '',
    ...(context ? ['CONTEXT FOR THE CRITERIA:', '"""', context, '"""', ''] : []),
    'CRITERIA (decide each one on its own):',
    ...(criteria || []).map((c) => `- ${c.id}: ${String(c.description).trim()}`),
    '',
    'Return ONLY this JSON object, no prose before or after:',
    '{',
    '  "judgments": [',
    '    { "id": "<criterion id>", "decision": "met" or "not_met", "reason": "<one sentence, <=30 words>" }',
    '  ]',
    '}',
    'Give exactly one entry for each criterion id above. Give no total score and no pass.',
  ].join('\n');
}

// A criteria case's rubric_hash binds its grades to the criteria template, the
// rubric shown as context, and every criterion's id, weight and description, so
// an edit to any of them moves it (R-7). A case without criteria keeps
// rubricHash of its rubric, byte for byte.
function caseRubricHash(c) {
  if (!c || !Array.isArray(c.criteria)) return rubricHash(c && c.rubric);
  const template = buildCriteriaPrompt({ task: '', response: '', rubric: '', criteria: [] });
  const listed = canonicalize(c.criteria.map((x) => ({ id: x.id, weight: x.weight, description: x.description })));
  return sha256([CRITERIA_SYSTEM, template, String(c.rubric || '').trim(), listed].join('\n---\n'));
}

// The judgments a reply carries, validated before anything is scored (R-3):
// every criterion exactly once, with an allowed decision. Entries are read in
// order and the first fault is returned as { error }; a missing criterion is
// named after every entry is read. Otherwise { judgments, ignored }: the
// judgments in the case's criteria order, and the sorted names of every key the
// reply carried that is not read: a top-level key other than `judgments` (a
// `score`, a `pass`) by its name, and a key inside an entry other than `id`,
// `decision` and `reason` as `judgments[<id>].<key>` (A-185-5).
const ENTRY_KEYS = new Set(['id', 'decision', 'reason']);
function readJudgments(parsed, criteria) {
  const list = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.judgments : undefined;
  if (!Array.isArray(list)) return { error: 'judge output carries no judgments list' };
  const known = new Set(criteria.map((c) => c.id));
  const seen = new Map();
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const n = i + 1;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { error: `judge judgment ${n} is malformed (not an object)` };
    if (typeof e.id !== 'string') return { error: `judge judgment ${n} is malformed (its id ${JSON.stringify(e.id === undefined ? null : e.id)} is not a string)` };
    if (e.reason !== undefined && typeof e.reason !== 'string') return { error: `judge judgment ${n} is malformed (its reason for criterion ${JSON.stringify(e.id)} is not a string)` };
    if (!known.has(e.id)) return { error: `judge judgment ${n} names unknown criterion ${JSON.stringify(e.id)}` };
    if (seen.has(e.id)) return { error: `judge judged criterion ${JSON.stringify(e.id)} more than once` };
    if (!DECISIONS.includes(e.decision)) return { error: `judge decision ${JSON.stringify(e.decision === undefined ? null : e.decision)} for criterion ${JSON.stringify(e.id)} is not one of ${DECISIONS.join(', ')}` };
    seen.set(e.id, { id: e.id, decision: e.decision, reason: String(e.reason || '').slice(0, 300) });
  }
  const absent = criteria.find((c) => !seen.has(c.id));
  if (absent) return { error: `judge output has no judgment for criterion ${JSON.stringify(absent.id)}` };
  const ignored = Object.keys(parsed).filter((k) => k !== 'judgments');
  for (const e of list) for (const k of Object.keys(e)) if (!ENTRY_KEYS.has(k)) ignored.push(`judgments[${e.id}].${k}`);
  return { judgments: criteria.map((c) => seen.get(c.id)), ignored: ignored.sort() };
}

// The weighted total (R-4): the weights of the criteria decided met over the sum
// of all the weights, rounded to six places as every other figure is.
function weightedTotal(judgments, criteria) {
  const decided = new Map(judgments.map((j) => [j.id, j.decision]));
  const all = criteria.reduce((a, c) => a + c.weight, 0);
  const met = criteria.reduce((a, c) => a + (decided.get(c.id) === 'met' ? c.weight : 0), 0);
  return round(met / all);
}

// One criteria sample, from a reply that parsed: unmeasured with the fault, or
// the computed total as its score, and the sample's record (R-5, R-6). The case
// row's reason is the code's, from the decisions.
function gradeCriteria(base, parsed, criteria, threshold) {
  const read = readJudgments(parsed, criteria);
  if (read.error) return { ...base, unmeasured: true, reason: read.error };
  const total = weightedTotal(read.judgments, criteria);
  const pass = typeof threshold === 'number' ? total >= threshold : null;
  const ids = (d) => read.judgments.filter((j) => j.decision === d).map((j) => j.id).join(', ') || 'none';
  const reason = `criteria met: ${ids('met')}; not met: ${ids('not_met')}; weighted total ${total}`.slice(0, 300);
  return { ...base, score: total, reason, criteria: { raw: base.raw, judgments: read.judgments, total, pass, ignored: read.ignored } };
}

// The score a judge reply carries, or null when it carries none (spec 026
// AC-3, F2). A non-numeric or non-finite value is not a score; a number outside
// the score scale (config.js SCORE_SCALE, [0, 1]) is on a scale the rubric did
// not ask for and is not clamped into one (85 is not 1.0). This replaced
// clamp01, whose silent 0 for a non-finite value scored an absent output as the
// worst possible one.
// Stop reasons that mean the surface cut the reply at its output cap: the
// Messages API's and the claude CLI's `max_tokens`, Chat Completions'
// `length`. A cut reply is a partial answer (spec 026 AC-8, F4).
const TRUNCATION_STOP_REASONS = new Set(['max_tokens', 'length']);
function isTruncated(stopReason) { return TRUNCATION_STOP_REASONS.has(String(stopReason || '')); }

// Only a JSON number is a score (spec 032 AC-1). Number() turned null, false,
// "" and [] into 0 and true into 1, and each of those became a measured sample:
// a judge that said nothing scored the worst possible grade, and two receipts
// over the same generations read as a regression. Every non-number becomes NaN
// here and is refused by the isFinite line below, which stays the one line every
// non-number reaches (spec 026's clamp mutation is planted on it).
function scoreOf(parsed) {
  const raw = parsed ? parsed.score : undefined;
  const x = typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(x)) return null;
  if (x < SCORE_SCALE.worst || x > SCORE_SCALE.best) return null;
  return x;
}

// Judge settings for the JUDGE model's surface. Determinism where the surface
// allows: on an api surface (Anthropic `api` or `openai-api`) we pin temperature 0
// for judge calls (and record it); on a cli/subscription surface sampling params
// are surface-controlled and cannot be set, so temperature is null and `sampling`
// says so. `judgeModel` defaults to the fixed Haiku judge, whose surface is the
// Anthropic axis. Recorded into every receipt.
function judgeSettings(samples, judgeModel) {
  const surface = surfaceForModel(judgeModel || 'claude-haiku-4-5');
  if (surface === 'api' || surface === 'openai-api') {
    return { samples, temperature: 0, sampling: 'api-temperature-0', surface };
  }
  return { samples, temperature: null, sampling: 'surface-controlled', surface };
}

// Grade one response once. Returns { score, reason, raw, ... } for a measured
// sample, or { unmeasured: true, reason, raw, ... } when the reply carries no
// score: empty, unparseable, no numeric score, or a score outside [0, 1]. A
// zero asserts a measurement ("the response satisfied none of the rubric");
// each of these is the absence of one, and no sample enters any statistic
// (spec 026 AC-3). The 2026-07 rule that an unparseable judge must never
// silently pass is kept by the stronger rule: it never silently scores at all.
// `raw` is the judge's verbatim output text (hashed into the receipt for
// transcript auditability, and optionally retained under --keep-transcripts).
// Spec 185: with `criteria`, the case is graded per criterion (gradeCriteria) on
// the criteria template, with room in the output cap for one entry per criterion.
async function gradeOnce({ task, response, rubric, criteria, threshold, model, timeoutMs, temperature, trusted = false }) {
  const listed = Array.isArray(criteria);
  const prompt = listed ? buildCriteriaPrompt({ task, response, rubric, criteria }) : buildJudgePrompt({ task, response, rubric });
  const system = listed ? CRITERIA_SYSTEM : JUDGE_SYSTEM;
  const out = await complete({ system, prompt, model, maxTokens: listed ? 400 + 60 * criteria.length : 400, timeoutMs, temperature, trusted });
  const { text, attempts, usage } = out;
  const base = { raw: String(text || ''), attempts: attempts || 1, usage, reply: out };
  // A judge reply cut at its output cap carries no complete grade.
  if (isTruncated(out.stopReason)) {
    return { ...base, unmeasured: true, reason: `judge output truncated at the output cap (stop_reason ${out.stopReason})` };
  }
  if (!String(text || '').trim()) {
    return { ...base, unmeasured: true, reason: 'judge output empty (the surface returned no text)' };
  }
  let parsed;
  try {
    parsed = extractJsonObject(text);
  } catch (_e) {
    return { ...base, unmeasured: true, reason: 'judge output unparseable' };
  }
  if (listed) return gradeCriteria(base, parsed, criteria, threshold);
  const score = scoreOf(parsed);
  if (score === null) {
    const x = parsed ? parsed.score : undefined;
    const reason = x === undefined ? 'judge output carries no numeric score'
      : typeof x !== 'number' ? `judge output carries no numeric score (score ${JSON.stringify(x)})`
        : !Number.isFinite(x) ? `judge output carries no numeric score (score ${String(x)})`
          : `judge score ${x} outside [0, 1]`;
    return { ...base, unmeasured: true, reason };
  }
  return { ...base, score, reason: String(parsed.reason || '').slice(0, 300) };
}

// Grade a response N times and return the sampled distribution:
//   { samples:[scores], mean, stddev, reason, judge_settings, model_id, rubric_hash }
// or, when any sample is unmeasured, { unmeasured: true, reason, ... } with NO
// samples: a partial sample set must never become a band, and a draw one of
// whose judge samples carried no score is unmeasured as a whole (spec 026
// AC-3).
// SPEC 173 (R-3): THE N SAMPLES ARE ASKED TOGETHER, and read in sample order, so
// the result is the one the one-at-a-time loop gave for the same replies: the
// first sample that threw is thrown, else the first that carried no score makes
// the draw unmeasured with its reason. Every sample that answered is recorded
// (its output hash, its usage), because every call is now made.
// ISSUE 104 (A-173-3): WITH `oneAtATime`, each sample is asked only after the one
// before it has answered, so a run at --concurrency 1 (and a regrade) has one call
// in flight, as at spec 173's Base. The same samples are asked and read the same
// way, so the result is the same; only the timing moves.
// `mean` ± `stddev` is the per-case band, a descriptive spread (one sample sd of the N scores)
// used by the borderline-outcome rule and per-case drift band-overlap logic.
// NO DEFAULT TIMEOUT HERE (spec 017 AC-2). This defaulted to 120000, which
// outranked the per-surface policy exactly as lib/run.js's literal did — so the
// JUDGE calls timed out on the api policy while running on a CLI surface, which
// is the second shadowing site and the one #007's prep session had not found.
// Passing `undefined` through lets lib/provider.js resolve the declared policy.
// `trusted` (spec 022) is plumbed to complete() untouched: the judge takes the
// same spawn path as the generation it grades, so --trusted-skill is whole-run.
// SPEC 185: `criteria` and `threshold` grade a criteria case per criterion; its
// rubric_hash is caseRubricHash, and a measured result carries
// `criteria_samples`, one record per sample. Without criteria, all is as before.
async function gradeSamples({ task, response, rubric, criteria, threshold, model, samples = 5, timeoutMs, trusted = false, oneAtATime = false }) {
  const settings = judgeSettings(samples, model);
  const temperature = settings.temperature === null ? undefined : settings.temperature;
  const hash = caseRubricHash({ rubric, criteria });
  const askNow = () => gradeOnce({ task, response, rubric, criteria, threshold, model, timeoutMs, temperature, trusted }).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
  // askNow never rejects, so the chain goes on past a sample that failed.
  let before = Promise.resolve();
  const ask = oneAtATime ? () => (before = before.then(askNow)) : askNow;
  const settled = await Promise.all(Array.from({ length: samples }, ask));
  // Every call made is charged: an answered sample's attempts, and a failed one's.
  const attemptsTotal = settled.reduce((n, s) => n + ((s.status === 'fulfilled' ? s.value.attempts : s.reason && s.reason.attempts) || 1), 0);
  const first = settled.find((s) => s.status === 'rejected' || s.value.unmeasured);
  if (first && first.status === 'rejected') {
    // A judge sample that persistently failed (e.g. timed out after retries):
    // tag the error so the runner can charge for the spend and mark the whole
    // case failed_timeout (a partial sample set must never become a band).
    const e = first.reason;
    if (e && typeof e === 'object') { e.phase = 'judge'; e.judgeAttempts = attemptsTotal; }
    throw e;
  }
  const answered = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  const rawTexts = answered.map((r) => r.raw || '');
  const usages = answered.map((r) => r.usage || null);
  const replies = answered.map((r) => r.reply || null);   // v0.6: what answered each judge call, for the runner's attestation
  if (first) {
    return {
      unmeasured: true, reason: first.value.reason, samples: [], mean: null, stddev: null,
      sample_texts: rawTexts, sample_hashes: rawTexts.map((t) => sha256(t)),
      judge_settings: settings, model_id: model, rubric_hash: hash,
      attempts: attemptsTotal, usage: sumUsage(usages), replies,
    };
  }
  const scores = answered.map((r) => r.score);
  const reasons = answered.map((r) => r.reason);
  return {
    samples: scores,
    mean: mean(scores),
    stddev: stddev(scores),
    reason: reasons[0] || '',
    // v0.3 transcript auditability: verbatim judge outputs + their sha256 hashes,
    // one per sample. `sample_texts` is transient (retained only under
    // --keep-transcripts); `sample_hashes` goes into the receipt.
    sample_texts: rawTexts,
    sample_hashes: rawTexts.map((t) => sha256(t)),
    judge_settings: settings,
    model_id: model,
    rubric_hash: hash,
    attempts: attemptsTotal,
    // v0.4: the measurement overhead of grading this one case — the SUM over all
    // N judge calls. Recorded in the receipt as the case's `judge_usage` and
    // EXCLUDED from every skill-value figure (lib/value.js): it is a cost we
    // impose to measure, not a cost of running the skill.
    usage: sumUsage(usages),
    replies,
    ...(Array.isArray(criteria) ? { criteria_samples: answered.map((r) => r.criteria) } : {}),
  };
}

module.exports = {
  gradeOnce, gradeSamples, judgeSettings, rubricHash, buildJudgePrompt, promptTemplateHash, scoreOf, isTruncated, TRUNCATION_STOP_REASONS, JUDGE_SYSTEM,
  CRITERIA_SYSTEM, DECISIONS, buildCriteriaPrompt, caseRubricHash, readJudgments, weightedTotal,
};
