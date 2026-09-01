// SPDX-License-Identifier: Apache-2.0
'use strict';

// Rerun / regrade / reuse, and the baseline-reproduction precondition.
// Receipt spec v0.5.
//
// TWO THINGS LIVE HERE, both decided from what two receipts RECORD rather than
// from a flag someone passed:
//
//   1. THE PRECONDITION (AC-6). Report #006's whole result. The no-skill arm
//      contains no skill text, so a skill revision cannot move it. If it fails
//      to reproduce the arm an earlier receipt measured on the same model, the
//      same surface and the same suite, then whatever else changed, the two
//      receipts are not measuring the same thing — and a verdict computed across
//      them would be a comparison whose premise was never checked. That is the
//      F-009-X class. The comparison is REFUSED and no verdict is asserted.
//
//   2. THE TRIAGE (AC-8). Terminal-Bench 4.0 distinguishes rerunning a task,
//      regrading an existing transcript, and reusing a prior result. Adopted,
//      translated: our unit is a (case, arm) draw set, and the trigger is the
//      receipt's own recorded provenance — model, suite and skill content force
//      a rerun because the generation would differ; judge and rubric force a
//      regrade because only the scoring would; neither changing permits reuse.
//
// PURE: two receipts in, a decision out. No I/O, no provider. F-009-K's lesson
// applied — the decision derives from the artifact, never from a filename.

const { round } = require('./stats');

// EVERY REASON STATES WHAT WAS OBSERVED AND STOPS THERE (F-009-N). The control
// proves non-reproduction; it cannot say why. A reason that named a cause — "the
// skill regressed", "the model got worse" — would be a finding this instrument
// did not measure, which is the one thing it must never publish.
const REFUSAL_REASONS = {
  baseline_did_not_reproduce: ({ observed, expected } = {}) =>
    `the baseline arm did not reproduce: this run observed ${observed}, the earlier receipt recorded ${expected}, and the bands do not overlap. No verdict is asserted; the control shows non-reproduction and cannot establish a cause.`,
  baseline_missing: () =>
    'no baseline arm is present in one of the two receipts, so reproduction cannot be checked and no verdict is asserted.',
  baseline_unmeasured: () =>
    'the baseline arm has no measured draws, so reproduction cannot be checked and no verdict is asserted.',
  incomparable_surface: () =>
    'the two receipts record different surfaces, so the earlier measurement cannot stand as a control here and no verdict is asserted.',
};

const casesOf = (r) => ((r && r.results && r.results.cases) || []);
const armOf = (r, mode) => casesOf(r).filter((c) => c.mode === mode);

// THE ONE BAND DEFINITION, and it resolves the shape the receipt actually
// recorded (spec 016 AC-1, closing F-015-C).
//
// WHAT WENT WRONG. This read `c.generation.mean` and nothing else. That block
// exists on v0.5 receipts and on no earlier one — v0.4 records the same
// measurement as `c.mean` and `c.stddev` — so every v0.4 case resolved to `null`
// and `baselineReproduces` returned `baseline_unmeasured` for EVERY v0.4→v0.5
// pair, always, whatever the baselines had done. The precondition written
// specifically for cross-version comparison could not pass against the archive
// it exists to compare against, and Report #007's entire comparison step is
// v0.4-against-v0.5.
//
// It survived 487 repo assertions and three approval rounds because every
// assertion that ever exercised it handed it a fixture built to the CURRENT
// schema. That is the seventh narrowing class, `fixture-vs-real-artifact`.
//
// THE BAND CARRIES WHICH SHAPE IT CAME FROM, and the two are not the same
// statistic: v0.5's `sd` is spread ACROSS DRAWS, v0.4's `stddev` is spread across
// JUDGE SAMPLES of one draw. Comparing them is the only comparison v0.4 admits —
// it is the band that version measured — but a reader is owed the fact that the
// older side is a judge-level band, so `source` travels with it and the differ
// says so rather than presenting them as like for like.
//
// NO SWITCH GUARDS THE LEGACY PATH. An earlier revision carried a const-true
// `LEGACY_BAND_ENABLED` so a probe could disable the fallback without editing the
// logic; that leaves the pre-fix behaviour resident in the shipped tree, which an
// approval called what it is — a hazard a comment does not remove. The mutation
// probe patches this source in a disposable copy instead, and fails loudly if its
// anchor moves.
function bandOf(c) {
  if (!c) return null;
  const g = c.generation;
  if (g && typeof g.mean === 'number') {
    const sd = typeof g.sd === 'number' ? g.sd : 0;
    return { mean: g.mean, sd, lo: g.mean - sd, hi: g.mean + sd, n: g.n_measured, source: 'generation' };
  }
  // v0.4 and earlier: the same measurement, under the names that version used.
  // `score` is v0.1's spelling of the mean and is accepted for the same reason.
  const mean = typeof c.mean === 'number' ? c.mean : (typeof c.score === 'number' ? c.score : null);
  if (mean === null) return null;
  const sd = typeof c.stddev === 'number' ? c.stddev : 0;
  return { mean, sd, lo: mean - sd, hi: mean + sd, n: Array.isArray(c.samples) ? c.samples.length : null, source: 'legacy' };
}

function baselineReproduces(older, newer) {
  const a = armOf(older, 'baseline');
  const b = armOf(newer, 'baseline');
  if (!a.length || !b.length) return { ok: false, key: 'baseline_missing' };
  const bad = [];
  for (const nb of b) {
    const ob = a.find((x) => x.id === nb.id);
    if (!ob) continue;
    const bandA = bandOf(ob); const bandB = bandOf(nb);
    if (!bandA || !bandB) return { ok: false, key: 'baseline_unmeasured' };
    const overlap = bandA.lo <= bandB.hi && bandB.lo <= bandA.hi;
    if (!overlap) bad.push({ id: nb.id, observed: round(bandB.mean), expected: round(bandA.mean) });
  }
  if (bad.length) return { ok: false, key: 'baseline_did_not_reproduce', ...bad[0], cases: bad };
  return { ok: true };
}

// The verdict path. REFUSED is a RESULT, not an error: it carries no delta, and
// it is what #006 published three times.
function compare(older, newer) {
  const pre = baselineReproduces(older, newer);
  if (!pre.ok) {
    const reason = REFUSAL_REASONS[pre.key]({ observed: pre.observed, expected: pre.expected });
    return { verdict: 'REFUSED', reason, reason_key: pre.key, delta: null, cases: pre.cases || [] };
  }
  const ws = (r) => { const arm = armOf(r, 'with_skill'); const b = arm.map(bandOf).filter(Boolean); return b.length ? b.reduce((s, x) => s + x.mean, 0) / b.length : null; };
  const a = ws(older); const b = ws(newer);
  if (a === null || b === null) return { verdict: 'REFUSED', reason: REFUSAL_REASONS.baseline_unmeasured(), reason_key: 'baseline_unmeasured', delta: null };
  return { verdict: 'MEASURED', delta: round(b - a), baseline_reproduced: true };
}

function triage(a, b) {
  const g = (r, p, d) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), r) ?? d;
  const changed = (p) => g(a, p) !== g(b, p);
  if (changed('run.model_id')) return { decision: 'rerun', reason: 'the model id differs, so the generation would differ' };
  if (changed('suite.suite_hash')) return { decision: 'rerun', reason: 'the suite content differs, so the prompts would differ' };
  if (changed('skill.content_hash')) return { decision: 'rerun', reason: 'the skill content differs, so the with-skill generation would differ' };
  if (changed('run.judge.model_id')) return { decision: 'regrade', reason: 'only the judge differs, so the existing generations can be rescored' };
  if (changed('run.rubric_hash')) return { decision: 'regrade', reason: 'only the rubric differs, so the existing generations can be rescored' };
  return { decision: 'reuse', reason: 'model, suite, skill, judge and rubric all match, so the earlier result stands' };
}

module.exports = { compare, baselineReproduces, triage, REFUSAL_REASONS, bandOf };
