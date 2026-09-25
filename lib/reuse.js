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
//      Spec 053 made it one comparison of two provenance records, shared with
//      `driftproof stale` (lib/stale.js), and added the harness and the judge's
//      template; see PROVENANCE below.
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

// ── PROVENANCE: ONE COMPARISON FOR TRIAGE AND STALE (spec 053 AC-1, AC-2) ─────
//
// What a receipt records about how its numbers were made, and one pure function
// that compares two such records: two receipts (`triage`), or a receipt and what
// would run today (`driftproof stale`, lib/stale.js). Before spec 053 `triage`
// read `run.rubric_hash`, which no receipt carries (rubric hashes are per case),
// and never looked at the judge's template or the harness, so a rubric or
// template change was reused and a harness change went unseen.
//
// UNKNOWN IS NEVER CURRENT. An axis either side does not record is `unknown`,
// with the reason, and an arm with an unknown axis is not reused.
//
// THE SUITE HASH COVERS PROMPTS AND RUBRICS TOGETHER ({id, prompt, rubric,
// pass_threshold}), and no receipt records a per-case prompt hash. So a
// different suite reruns both arms even when only a rubric moved: the record
// cannot show the prompts did not. A case's rubric hash moving under an equal
// suite hash (the rubric hash also covers the judge's system prompt) regrades
// that case (spec 053 R-3).

// The axes, in the order a reader is shown them, with what a difference does
// and to which arms.
const AXES = [
  { axis: 'model', effect: 'rerun', arms: ['with_skill', 'baseline'], why: 'the model differs, so the generation would differ' },
  { axis: 'harness', effect: 'rerun', arms: ['with_skill', 'baseline'], why: 'the harness differs, so the generation would differ' },
  { axis: 'skill', effect: 'rerun', arms: ['with_skill'], why: 'the skill content differs, so the with-skill generation would differ; the baseline arm contains no skill text and still stands' },
  { axis: 'suite', effect: 'rerun', arms: ['with_skill', 'baseline'], why: 'the suite differs, so the prompts may differ' },
  { axis: 'judge_model', effect: 'regrade', arms: ['with_skill', 'baseline'], why: 'the judge model differs, so the existing generations can be graded again' },
  { axis: 'judge_template', effect: 'regrade', arms: ['with_skill', 'baseline'], why: 'the judge prompt template differs, so the existing generations can be graded again' },
  { axis: 'rubric', effect: 'regrade', arms: ['with_skill', 'baseline'], why: 'a case\'s rubric hash differs under the same suite, so that case can be graded again' },
];
const UNRECORDED = { model: 'no model id', harness: 'no harness (receipts before v0.9 carry none)', skill: 'no skill content hash', suite: 'no suite hash', judge_model: 'no judge model', judge_template: 'no judge prompt template hash (receipts before v0.6 carry none)', rubric: 'no per-case rubric hash' };

const canonicalId = (id) => (id == null ? null : String(id).replace(/-\d{8}$/, ''));

// THE HARNESS BY SEMVER (spec 053 A-053-1, the operator's instruction of 24 Sep 2026, a departure
// from the brief's exact match). A major or minor change (2.1 to 2.2) reruns both arms; a patch-only
// change (2.1.281 to 2.1.282) is an advisory. Claude Code ships a patch release every few days, and
// an exact match would mark every receipt stale within days. A version that is not semver, or a
// different harness, must match exactly.
const semver = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(String(v)); return m ? [m[1], m[2], m[3], m[4]] : null; };
function harnessDrift(a, b) {
  if (a.name !== b.name) return 'moved';
  if (a.version === b.version) return 'same';
  const x = semver(a.version); const y = semver(b.version);
  if (!x || !y) return 'moved';
  if (x[0] === y[0] && x[1] === y[1]) return x[2] === y[2] && x[3] === y[3] ? 'same' : 'patch';
  return 'moved';
}

// The provenance a receipt records. Every field is null when the receipt does
// not record it; an imported receipt's `unknown` model is null.
function provenanceOf(r) {
  const run = (r && r.run) || {};
  const judge = run.judge || {};
  const cases = (r && r.results && Array.isArray(r.results.cases)) ? r.results.cases : [];
  const rubrics = {};
  for (const c of cases) if (c && c.judge && typeof c.judge.rubric_hash === 'string' && !(c.id in rubrics)) rubrics[c.id] = c.judge.rubric_hash;
  const firstCaseJudge = (cases.find((c) => c && c.judge && c.judge.model_id) || { judge: {} }).judge.model_id;
  return {
    model_id: run.model_id && run.model_id !== 'unknown' ? run.model_id : null,
    harness: run.harness && typeof run.harness.name === 'string' ? { name: run.harness.name, version: run.harness.version == null ? null : String(run.harness.version) } : null,
    skill_hash: (r && r.skill && r.skill.content_hash) || null,
    suite_hash: (r && r.suite && r.suite.suite_hash) || null,
    case_ids: cases.length ? [...new Set(cases.map((c) => c.id))].sort() : null,
    judge_model_id: judge.model_id || firstCaseJudge || null,
    judge_template_hash: judge.prompt_template_hash || null,
    rubrics: Object.keys(rubrics).length ? rubrics : null,
  };
}

const show = (axis, v) => {
  if (v == null) return null;
  if (axis === 'harness') return v.version == null ? v.name : `${v.name} ${v.version}`;
  if (axis === 'rubric' && typeof v === 'object') return `${Object.keys(v).length} case(s)`;
  return v;
};

// One entry per axis: { axis, recorded, current, effect, arms, reason[, cases, cases_added, cases_removed] }.
// `why` optionally carries a reason for a current value that could not be found
// (lib/stale.js: "no --skill given", "claude --version failed: ...").
function compareProvenance(rec, cur, why = {}) {
  const out = [];
  const entry = (a, recorded, current, same, extra = {}) => {
    const unknownSide = recorded == null ? `the receipt records ${UNRECORDED[a.axis]}` : current == null ? (why[a.axis] || `the other side records ${UNRECORDED[a.axis]}`) : null;
    if (unknownSide) return out.push({ axis: a.axis, recorded: show(a.axis, recorded), current: show(a.axis, current), effect: 'unknown', arms: a.arms, reason: unknownSide, ...extra });
    if (same) return out.push({ axis: a.axis, recorded: show(a.axis, recorded), current: show(a.axis, current), effect: 'current', arms: a.arms, reason: 'unchanged', ...extra });
    return out.push({ axis: a.axis, recorded: show(a.axis, recorded), current: show(a.axis, current), effect: a.effect, arms: a.arms, reason: a.why, ...extra });
  };
  const A = Object.fromEntries(AXES.map((a) => [a.axis, a]));
  entry(A.model, rec.model_id, cur.model_id, canonicalId(rec.model_id) === canonicalId(cur.model_id));
  // A harness with no version recorded is unknown, except an API surface, which has no harness to drift.
  const h = (x) => (x && (x.version != null || x.name === 'api') ? x : null);
  const drift = h(rec.harness) && h(cur.harness) ? harnessDrift(rec.harness, cur.harness) : null;
  if (drift === 'patch') out.push({ axis: 'harness', recorded: show('harness', rec.harness), current: show('harness', cur.harness), effect: 'advisory', arms: A.harness.arms, reason: 'a patch release of the same harness: an advisory, not a rerun (spec 053 A-053-1)' });
  else entry(A.harness, h(rec.harness), h(cur.harness), drift === 'same');
  entry(A.skill, rec.skill_hash, cur.skill_hash, rec.skill_hash === cur.skill_hash);
  const added = rec.case_ids && cur.case_ids ? cur.case_ids.filter((id) => !rec.case_ids.includes(id)) : [];
  const removed = rec.case_ids && cur.case_ids ? rec.case_ids.filter((id) => !cur.case_ids.includes(id)) : [];
  entry(A.suite, rec.suite_hash, cur.suite_hash, rec.suite_hash === cur.suite_hash, added.length || removed.length ? { cases_added: added, cases_removed: removed } : {});
  entry(A.judge_model, rec.judge_model_id, cur.judge_model_id, canonicalId(rec.judge_model_id) === canonicalId(cur.judge_model_id));
  entry(A.judge_template, rec.judge_template_hash, cur.judge_template_hash, rec.judge_template_hash === cur.judge_template_hash);
  // The rubric, per case, over the cases both sides record.
  if (rec.rubrics && cur.rubrics) {
    const moved = Object.keys(rec.rubrics).filter((id) => id in cur.rubrics && rec.rubrics[id] !== cur.rubrics[id]).sort();
    const suiteMoved = out.find((e) => e.axis === 'suite').effect === 'rerun';
    if (!moved.length) entry(A.rubric, 'recorded', 'recorded', true);
    else if (suiteMoved) out.push({ axis: 'rubric', recorded: `${moved.length} case(s)`, current: `${moved.length} case(s)`, effect: 'rerun', arms: A.rubric.arms, cases: moved, reason: 'the rubric moved on these cases, and the suite differs, so the rerun the suite needs grades them again; the receipt records no per-case prompt hash, so a rubric edit cannot be told from a prompt edit' });
    else out.push({ axis: 'rubric', recorded: `${moved.length} case(s)`, current: `${moved.length} case(s)`, effect: 'regrade', arms: A.rubric.arms, cases: moved, reason: A.rubric.why });
  } else entry(A.rubric, rec.rubrics, cur.rubrics, false);
  return out;
}

// Each arm's decision: rerun, then regrade, then unknown, then reuse.
const RANK = { rerun: 3, regrade: 2, unknown: 1, current: 0, advisory: 0 };
function armDecisions(axes) {
  const arms = {};
  for (const arm of ['with_skill', 'baseline']) {
    const on = axes.filter((e) => e.arms.includes(arm));
    const top = on.reduce((m, e) => (RANK[e.effect] > RANK[m] ? e.effect : m), 'current');
    const decision = RANK[top] === 0 ? 'reuse' : top;
    const because = on.filter((e) => e.effect === top && decision !== 'reuse');
    const cases = decision === 'regrade' && because.every((e) => Array.isArray(e.cases)) ? [...new Set(because.flatMap((e) => e.cases))].sort() : null;
    arms[arm] = { decision, axes: because.map((e) => e.axis), ...(cases ? { cases } : {}) };
  }
  return arms;
}

// Two receipts' provenance compared (spec 053 AC-2). The decision is the most
// consequential arm's: rerun, then regrade, then unknown, then reuse. `cases`
// names the cases a rubric regrade reaches.
function triage(a, b) {
  const axes = compareProvenance(provenanceOf(a), provenanceOf(b));
  const arms = armDecisions(axes);
  const decision = ['rerun', 'regrade', 'unknown'].find((d) => arms.with_skill.decision === d || arms.baseline.decision === d) || 'reuse';
  const first = axes.find((e) => e.effect === decision);
  const advised = axes.filter((e) => e.effect === 'advisory').map((e) => e.axis);
  const reason = decision === 'reuse'
    ? `model, harness, skill, suite, judge, template and rubric all match${advised.length ? ` but for a patch release of the ${advised.join(', ')} (an advisory)` : ''}, so the earlier result stands`
    : decision === 'unknown' ? `${first.axis} is unknown: ${first.reason}` : first.reason;
  const cases = decision === 'regrade' ? (arms.with_skill.cases || arms.baseline.cases || null) : null;
  return { decision, reason, arms, axes, ...(cases ? { cases } : {}) };
}

module.exports = { compare, baselineReproduces, triage, REFUSAL_REASONS, bandOf, provenanceOf, compareProvenance, armDecisions, AXES };
