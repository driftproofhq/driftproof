// SPDX-License-Identifier: Apache-2.0
'use strict';

// What a first run needs that a measurement does not: the warning when a model grades its own answers
// (spec 138), the quick smoke preset and the words a smoke result carries (spec 139), and the check
// that the isolation account exists before a run that needs it starts (spec 140).
//
// THE PRESET IS THE OPERATOR'S NUMBERS, IN ONE PLACE (spec 139 R-2): two judge samples, four at
// once, at most five cases. The generation draws are not changed by it.
//
// What a smoke receipt carries, and the plain line every smoke surface says, are lib/smoke.js's,
// which requires nothing, so a reader that must not reach the provider can read them.

const { resolveModel, evalUserExists } = require('./provider');
const { canonicalModelId } = require('./usage');
const { PRESET_QUICK, SMOKE_LINE, isSmoke } = require('./smoke');

const QUICK = Object.freeze({ samples: 2, concurrency: 4, maxCases: 5 });
// The three flags the preset sets, as `driftproof run` names them.
const QUICK_FLAGS = Object.freeze(['samples', 'concurrency', 'max-cases']);

// The flags given beside --quick that the preset sets. Each is refused, because a run that took one
// from each would not be the preset its receipt names.
function quickConflicts(flags) {
  return QUICK_FLAGS.filter((f) => Object.prototype.hasOwnProperty.call(flags || {}, f));
}

// The banner a quick run prints before its first call, and the line it prints after its receipt.
function quickBanner() {
  return `  QUICK SMOKE RUN (--quick): ${QUICK.samples} judge samples, concurrency ${QUICK.concurrency}, at most ${QUICK.maxCases} cases. ${SMOKE_LINE}: the receipt will be UNVERIFIED and record run.preset "${PRESET_QUICK}".`;
}
function quickResultLine(withBand, baseBand) {
  return `  → smoke run: with ${withBand} vs base ${baseBand}. ${SMOKE_LINE}; run without --quick for one.`;
}

// THE JUDGE IS THE TARGET (spec 138 R-9): compared on canonical ids, so a dated id and its undated
// form are one model. Ids that do not resolve are compared as given.
function canonical(id) {
  let r = id;
  try { r = resolveModel(id); } catch (_e) { r = id; }
  return canonicalModelId(r);
}
function selfJudged(target, judge) {
  return canonical(target) === canonical(judge);
}
function selfJudgeLines(target) {
  const m = canonical(target);
  return [
    `  ! WARNING: the judge is the target model, ${m}.`,
    '  !   The model that wrote each answer also grades it.',
    '  !   To grade with another model, pass --judge-model <id>, or set judge_model in the working directory\'s .driftproofrc.',
  ];
}

// THE ISOLATION ACCOUNT (spec 140 R-3). Whether it exists is lib/provider.js's to ask (`id -u`), where
// the other spawns are; why a run is refused for lacking it is this file's.
// Why the run is refused, in one plain sentence, or null when it may go on. Asked only of a run that
// would answer through the isolated lane: a subscription surface, no --trusted-skill, and not the
// stub. bin/driftproof prints it after `REFUSED (isolation): `, on one line.
function isolationPreflight({ surfaces, trusted, stub, user, exists }) {
  if (trusted || stub || !surfaces || !surfaces.length) return null;
  if (exists !== false) return null;
  return `this run would answer through the isolation account ${user}, and there is no such account on this machine; nothing run, no receipt written. If you wrote this skill yourself, run it as you with --trusted-skill. If you did not, set up the account first: a dedicated unprivileged user with its own logged-in claude and a passwordless sudo rule that lets you run commands as it (the Isolation section of the README says what it needs).`;
}

module.exports = {
  PRESET_QUICK, QUICK, QUICK_FLAGS, SMOKE_LINE, isSmoke, quickConflicts, quickBanner, quickResultLine,
  selfJudged, selfJudgeLines, evalUserExists, isolationPreflight,
};
