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
    return { text: JSON.stringify(body), usage: null };
  }
  // Generation call: canned, marked by mode.
  const mark = system ? MARK_SKILL : MARK_BASE;
  const text = `${mark}\nfeat(stub): canned offline generation for CI (no model was called)`;
  return { text, usage: null };
}

function stubEnabled() {
  return process.env.DRIFTPROOF_STUB === '1';
}

module.exports = { stubComplete, stubEnabled, MARK_SKILL, MARK_BASE };
