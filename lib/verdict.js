// SPDX-License-Identifier: Apache-2.0
'use strict';

const { EFFECT_FLOOR } = require('../config');

// Single-receipt verdict + shields.io badge.
//
// `diff` compares TWO receipts across model releases; a single receipt already
// carries its own honest verdict: does the skill still help on THIS model? That
// is exactly `comparison.delta` (with-skill mean minus baseline mean), read
// through the SAME practical-significance floor the drift rule uses (config.js
// EFFECT_FLOOR). Band separation is not applied here — a single run has no second
// band to separate from — but the effect floor is, so a trivial lift below the
// judge's quantization grid is reported as "no effect", never as "passing".
//
//   delta >=  EFFECT_FLOOR → PASSED    (the skill measurably helps)
//   |delta| <  EFFECT_FLOOR → NO_EFFECT (within the judge's noise floor)
//   delta <= -EFFECT_FLOOR → REGRESSED (the skill measurably hurts on this model)

const VERDICTS = {
  PASSED: { color: 'brightgreen', word: 'passing' },
  NO_EFFECT: { color: 'lightgrey', word: 'no effect' },
  REGRESSED: { color: 'red', word: 'regressed' },
};

// Strip a trailing -YYYYMMDD date stamp so the badge reads cleanly
// (claude-haiku-4-5-20251001 → claude-haiku-4-5).
function shortModel(modelId) {
  return String(modelId || 'unknown').replace(/-\d{8}$/, '');
}

// Derive the verdict object from a receipt. Returns
//   { verdict, delta, floor, model, message, color }
function verdictFromReceipt(receipt) {
  const cmp = (receipt && receipt.comparison) || {};
  const delta = typeof cmp.delta === 'number' ? cmp.delta : 0;
  const model = shortModel(receipt && receipt.run && receipt.run.model_id);
  let verdict;
  if (delta >= EFFECT_FLOOR) verdict = 'PASSED';
  else if (delta <= -EFFECT_FLOOR) verdict = 'REGRESSED';
  else verdict = 'NO_EFFECT';
  const meta = VERDICTS[verdict];
  return {
    verdict,
    delta,
    floor: EFFECT_FLOOR,
    model,
    message: `${meta.word} on ${model}`,
    color: meta.color,
  };
}

// A shields.io "endpoint" badge object (schemaVersion 1). Committed as JSON and
// referenced via https://img.shields.io/endpoint?url=<public-url-of-this-json>.
function badgeEndpoint(receipt, { label = 'driftproof' } = {}) {
  const v = verdictFromReceipt(receipt);
  return {
    schemaVersion: 1,
    label,
    message: v.message,
    color: v.color,
  };
}

// Lines suitable for appending to a GitHub Actions $GITHUB_OUTPUT file.
function githubOutputLines(receipt) {
  const v = verdictFromReceipt(receipt);
  return [
    `verdict=${v.verdict}`,
    `delta=${v.delta}`,
    `message=${v.message}`,
    `color=${v.color}`,
  ].join('\n');
}

module.exports = { verdictFromReceipt, badgeEndpoint, githubOutputLines, shortModel, VERDICTS };
