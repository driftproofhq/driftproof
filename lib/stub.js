// SPDX-License-Identifier: Apache-2.0
'use strict';

// Offline stub surface (DRIFTPROOF_STUB=1).
//
// When set, provider.complete() delegates here and NEVER contacts a model — no
// API call, no `claude` spawn, zero spend. It exists so the GitHub Action (and
// CI generally) can be exercised end-to-end for free: the runner still builds a
// fully-formed, schema-valid, self-hashed receipt with a real with-skill-vs-
// baseline lift; only the underlying text is canned.
//
// Determinism is the whole point, so scores carry no variance (stddev 0). The
// stub is model- and skill-agnostic: it distinguishes the two things the runner
// actually varies — whether the SKILL.md was supplied (with_skill vs baseline) —
// by marking each canned generation, and the canned judge grades on that marker.

// Markers embedded in canned generations. The judge stub reads them back out of
// the response it is handed, which is how a zero-model-call run still produces a
// non-trivial (positive) skill lift.
const MARK_SKILL = 'DRIFTPROOF_STUB_S';   // generation produced WITH the skill
const MARK_BASE = 'DRIFTPROOF_STUB_B';    // baseline generation (no skill)

// A judge call is recognised structurally (no import of judge.js — that would be
// circular, since judge.js requires provider.js): the judge prompt always ends by
// asking for a strict JSON object.
function isJudgePrompt(prompt) {
  return /Return ONLY this JSON object/.test(String(prompt || ''));
}

// Deterministic canned completion. `system` truthy ⇒ a with-skill generation
// (the runner passes SKILL.md as the system prompt only in with_skill mode).
function stubComplete({ system, prompt }) {
  if (isJudgePrompt(prompt)) {
    // Grade the response we were handed: reward the with-skill marker.
    const helped = new RegExp(MARK_SKILL).test(String(prompt || ''));
    const score = helped ? 0.85 : 0.42;
    const body = {
      score,
      pass: score >= 0.7,
      reason: `stub judge (DRIFTPROOF_STUB): ${helped ? 'with-skill marker present' : 'baseline'}`,
    };
    return { text: JSON.stringify(body), usage: stubUsage({ kind: 'judge', prompt }) };
  }
  // Generation call: canned, marked by mode.
  const mark = system ? MARK_SKILL : MARK_BASE;
  const text = `${mark}\nfeat(stub): canned offline generation for CI (no model was called)`;
  return { text, usage: stubUsage({ kind: 'gen', system, prompt }) };
}

// v0.4: deterministic synthetic usage, so a zero-model-call stub run still
// exercises the whole economics path (usage → pricing snapshot → derived cost/
// latency fields → the value report's three axes). The numbers are SYNTHETIC and
// deliberately shaped like the real surfaces: a large fixed harness preamble that
// is identical in both arms, plus the with-skill arm's extra SKILL.md input and
// its slightly longer, slower output. No randomness — same input, same usage.
const STUB_HARNESS_PREAMBLE_TOKENS = 20000;   // the fixed, arm-identical overhead
function stubUsage({ kind, system, prompt }) {
  const promptTokens = Math.ceil(String(prompt || '').length / 4);
  if (kind === 'judge') {
    return { input_tokens: 1200 + promptTokens, output_tokens: 60, cached_tokens: 800, wall_ms: 900 };
  }
  const skillTokens = system ? Math.ceil(String(system).length / 4) : 0;
  return {
    input_tokens: STUB_HARNESS_PREAMBLE_TOKENS + promptTokens + skillTokens,
    output_tokens: system ? 420 : 350,
    cached_tokens: STUB_HARNESS_PREAMBLE_TOKENS,
    wall_ms: system ? 4200 : 3600,
  };
}

function stubEnabled() {
  return process.env.DRIFTPROOF_STUB === '1';
}

module.exports = { stubComplete, stubEnabled, stubUsage, MARK_SKILL, MARK_BASE, STUB_HARNESS_PREAMBLE_TOKENS };
