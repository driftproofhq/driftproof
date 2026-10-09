// SPDX-License-Identifier: Apache-2.0
'use strict';

// What a first run needs that a measurement does not: the warning when a model grades its own answers
// (spec 138), the quick smoke preset and the words a smoke result carries (spec 139), the check that
// the isolation account exists before a run that needs it starts (spec 140), and the small full run a
// quick run is followed by on offer (spec 173).
//
// THE PRESET IS THE OPERATOR'S NUMBERS, IN ONE PLACE (spec 139 R-2): two judge samples, four at
// once, at most five cases. The generation draws are not changed by it.
//
// What a smoke receipt carries, and the plain line every smoke surface says, are lib/smoke.js's,
// which requires nothing, so a reader that must not reach the provider can read them.

const { resolveModel, evalUserExists } = require('./provider');
const { canonicalModelId } = require('./usage');
const { PRESET_QUICK, SMOKE_LINE, isSmoke } = require('./smoke');
const { projectCalls } = require('./run');
const { SAMPLING } = require('./sampling');
const { duration } = require('./progress');
const { DEFAULT_JUDGE_SAMPLES } = require('../config');

const QUICK = Object.freeze({ samples: 2, concurrency: 4, maxCases: 5 });
// THE SMALL FULL RUN (spec 173 R-2), offered after a quick run: the same cases, at most five, four at
// once, and the normal judge samples. It is not a preset: its receipt names none and is read by the
// verdict rules like any run's.
const FULL = Object.freeze({ maxCases: 5, concurrency: 4 });
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

// What the small full run would take, read off a smoke receipt (spec 173 R-2): its test tasks (at most
// FULL.maxCases), the calls at the fewest and the most draws the sampling rule allows (projectCalls),
// and the time, scaled from the smoke run's own time (generated_at to date_utc) by the calls it made.
// A receipt that records no start time gives no time.
function fullRunOffer(receipt) {
  const run = (receipt && receipt.run) || {};
  const cases = (receipt && receipt.results && receipt.results.cases) || [];
  const count = receipt && receipt.suite && Number.isInteger(receipt.suite.case_count) ? receipt.suite.case_count : new Set(cases.map((c) => c.id)).size;
  const tasks = Math.min(FULL.maxCases, count);
  const samples = DEFAULT_JUDGE_SAMPLES;
  const calls = [projectCalls(tasks, samples, SAMPLING.min), projectCalls(tasks, samples, SAMPLING.max)];
  // The smoke run's own calls: each draw's generation and the judge samples it records.
  const made = cases.reduce((n, c) => n + ((c.generation && c.generation.draws) || []).reduce((m, d) => m + 1 + (d.judge_sample_hashes || d.samples || []).length, 0), 0);
  const ms = Date.parse(run.date_utc) - Date.parse(run.generated_at);
  const time = made > 0 && Number.isFinite(ms) && ms >= 0 ? calls.map((n) => (ms / made) * n) : null;
  return { tasks, maxCases: FULL.maxCases, samples, concurrency: FULL.concurrency, calls, ms: time };
}
// The offer, in one line, as `driftproof view` prints it after a quick run.
function fullRunLine(o) {
  const t = o.ms ? `takes about ${duration(o.ms[0])} to ${duration(o.ms[1])}, scaled from this smoke run's own time` : 'takes a time this smoke run cannot scale from, because its receipt records no start time';
  return `  offer: a small full run on the same ${o.tasks} test task${o.tasks === 1 ? '' : 's'} (at most ${o.maxCases}), ${o.samples} judge samples, --concurrency ${o.concurrency}, makes ${o.calls[0]} to ${o.calls[1]} calls and ${t}. Its result is what the verdict rules read, and on so few test tasks it is often "Too few test tasks to tell".`;
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
  FULL, fullRunOffer, fullRunLine,
  selfJudged, selfJudgeLines, evalUserExists, isolationPreflight,
};
