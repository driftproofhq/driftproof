// SPDX-License-Identifier: Apache-2.0
'use strict';

const { complete, surfaceForModel } = require('./provider');
const { extractJsonObject } = require('./json');
const { sha256 } = require('./canonical');
const { mean, stddev } = require('./stats');
const { sumUsage } = require('./usage');

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

// The score a judge reply carries, or null when it carries none (spec 026
// AC-3, F2). A non-numeric or non-finite value is not a score; a number outside
// [0, 1] is on a scale the rubric did not ask for and is not clamped into one
// (85 is not 1.0). This replaced clamp01, whose silent 0 for a non-finite value
// scored an absent output as the worst possible one.
// Stop reasons that mean the surface cut the reply at its output cap: the
// Messages API's and the claude CLI's `max_tokens`, Chat Completions'
// `length`. A cut reply is a partial answer (spec 026 AC-8, F4).
const TRUNCATION_STOP_REASONS = new Set(['max_tokens', 'length']);
function isTruncated(stopReason) { return TRUNCATION_STOP_REASONS.has(String(stopReason || '')); }

function scoreOf(parsed) {
  const x = Number(parsed && parsed.score);
  if (!Number.isFinite(x)) return null;
  if (x < 0 || x > 1) return null;
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
async function gradeOnce({ task, response, rubric, model, timeoutMs, temperature, trusted = false }) {
  const prompt = buildJudgePrompt({ task, response, rubric });
  const out = await complete({ system: JUDGE_SYSTEM, prompt, model, maxTokens: 400, timeoutMs, temperature, trusted });
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
  const score = scoreOf(parsed);
  if (score === null) {
    const x = parsed && parsed.score;
    const reason = x === undefined || x === null ? 'judge output carries no numeric score'
      : !Number.isFinite(Number(x)) ? `judge output carries no numeric score (score ${JSON.stringify(x)})`
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
// AC-3). The remaining samples are not taken.
// `mean` ± `stddev` is the per-case confidence band (raw spread of the N scores)
// used by the borderline-outcome rule and per-case drift band-overlap logic.
// NO DEFAULT TIMEOUT HERE (spec 017 AC-2). This defaulted to 120000, which
// outranked the per-surface policy exactly as lib/run.js's literal did — so the
// JUDGE calls timed out on the api policy while running on a CLI surface, which
// is the second shadowing site and the one #007's prep session had not found.
// Passing `undefined` through lets lib/provider.js resolve the declared policy.
// `trusted` (spec 022) is plumbed to complete() untouched: the judge takes the
// same spawn path as the generation it grades, so --trusted-skill is whole-run.
async function gradeSamples({ task, response, rubric, model, samples = 5, timeoutMs, trusted = false }) {
  const settings = judgeSettings(samples, model);
  const scores = [];
  const reasons = [];
  const rawTexts = [];
  const usages = [];
  const replies = [];   // v0.6: what answered each judge call, for the runner's attestation
  let attemptsTotal = 0;
  for (let i = 0; i < samples; i++) {
    let r;
    try {
      r = await gradeOnce({ task, response, rubric, model, timeoutMs, temperature: settings.temperature === null ? undefined : settings.temperature, trusted });
    } catch (e) {
      // A judge sample that persistently failed (e.g. timed out after retries):
      // tag the error so the runner can charge for the spend and mark the whole
      // case failed_timeout (a partial sample set must never become a band).
      if (e && typeof e === 'object') { e.phase = 'judge'; e.judgeAttempts = attemptsTotal + (e.attempts || 1); }
      throw e;
    }
    attemptsTotal += r.attempts || 1;
    usages.push(r.usage || null);
    replies.push(r.reply || null);
    rawTexts.push(r.raw || '');
    if (r.unmeasured) {
      return {
        unmeasured: true, reason: r.reason, samples: [], mean: null, stddev: null,
        sample_texts: rawTexts, sample_hashes: rawTexts.map((t) => sha256(t)),
        judge_settings: settings, model_id: model, rubric_hash: rubricHash(rubric),
        attempts: attemptsTotal, usage: sumUsage(usages), replies,
      };
    }
    scores.push(r.score);
    reasons.push(r.reason);
  }
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
    rubric_hash: rubricHash(rubric),
    attempts: attemptsTotal,
    // v0.4: the measurement overhead of grading this one case — the SUM over all
    // N judge calls. Recorded in the receipt as the case's `judge_usage` and
    // EXCLUDED from every skill-value figure (lib/value.js): it is a cost we
    // impose to measure, not a cost of running the skill.
    usage: sumUsage(usages),
    replies,
  };
}

module.exports = { gradeOnce, gradeSamples, judgeSettings, rubricHash, buildJudgePrompt, promptTemplateHash, scoreOf, isTruncated, TRUNCATION_STOP_REASONS, JUDGE_SYSTEM };
