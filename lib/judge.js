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

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
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

// Grade one response once. Returns { score, reason, raw }.
// `raw` is the judge's verbatim output text (hashed into the receipt for
// transcript auditability, and optionally retained under --keep-transcripts).
async function gradeOnce({ task, response, rubric, model, timeoutMs, temperature, trusted = false }) {
  const prompt = buildJudgePrompt({ task, response, rubric });
  const { text, attempts, usage } = await complete({ system: JUDGE_SYSTEM, prompt, model, maxTokens: 400, timeoutMs, temperature, trusted });
  let parsed;
  try {
    parsed = extractJsonObject(text);
  } catch (_e) {
    // Unsalvageable judge output → conservative 0 (a judge that can't be parsed
    // must never silently "pass"), tagged so the caller can see it happened.
    return { score: 0, reason: 'judge output unparseable', unparsed: true, raw: String(text || ''), attempts: attempts || 1, usage };
  }
  return { score: clamp01(parsed.score), reason: String(parsed.reason || '').slice(0, 300), raw: String(text || ''), attempts: attempts || 1, usage };
}

// Grade a response N times and return the sampled distribution:
//   { samples:[scores], mean, stddev, reason, judge_settings, model_id, rubric_hash }
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
    scores.push(r.score);
    reasons.push(r.reason);
    rawTexts.push(r.raw || '');
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
  };
}

module.exports = { gradeOnce, gradeSamples, judgeSettings, rubricHash, buildJudgePrompt, JUDGE_SYSTEM };
