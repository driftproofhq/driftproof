// SPDX-License-Identifier: Apache-2.0
'use strict';

// Value-per-token axis.
//
// A skill is not free: its SKILL.md is prepended to every generation, so a skill
// that lifts scores by +0.10 for 400 tokens is a very different proposition from
// one that lifts +0.10 for 6,000 tokens. Driftproof reports each skill's lift
// (delta) BOTH raw AND normalized per 1,000 skill tokens.
//
// Token estimate: a coarse `ceil(chars / 4)` proxy — the standard rough rule for
// English text, NOT a model tokenizer (no tiktoken dependency; the number is a
// consistent proxy for comparing skills, not a billing figure). Documented on
// docs/methodology.html.

const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  const s = String(text || '');
  if (!s.length) return 0;
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

// Lift per 1,000 skill tokens: delta / (skillTokens / 1000). Null when the token
// count is unknown or zero (avoids a divide-by-zero masquerading as infinite value).
function deltaPer1kTokens(delta, skillTokens) {
  if (typeof delta !== 'number' || !skillTokens || skillTokens <= 0) return null;
  return Math.round((delta / (skillTokens / 1000)) * 1e4) / 1e4;
}

module.exports = { estimateTokens, deltaPer1kTokens, CHARS_PER_TOKEN };
