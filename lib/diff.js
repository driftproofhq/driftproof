// SPDX-License-Identifier: Apache-2.0
'use strict';

const { bandVerdict, round } = require('./stats');
const { EFFECT_FLOOR } = require('../config');
const { revisionHeadline } = require('./revision');

// Practical-significance gate applied ON TOP of band separation. bandVerdict()
// stays a pure geometry test (kept that way so its unit checks are unambiguous);
// this wrapper additionally requires |delta| >= EFFECT_FLOOR before a verdict is
// claimed. A separated-but-trivial move (below the judge's quantization floor)
// becomes "within noise (below effect floor)".
const WITHIN_NOISE_FLOOR = 'within noise (below effect floor)';
function verdictWithFloor(before, after, delta) {
  const raw = bandVerdict(before.mean, before.stddev, after.mean, after.stddev);
  if ((raw === 'regression' || raw === 'improvement') && Math.abs(delta) < EFFECT_FLOOR) {
    return WITHIN_NOISE_FLOOR;
  }
  return raw;
}
function isWithinNoise(v) { return v === 'within noise' || v === WITHIN_NOISE_FLOOR; }

// Build a drift report (markdown) between two receipts.
//
// CREDIBILITY CORE — the anti-false-positive rule: a per-case regression (or
// improvement) is claimed ONLY when (1) the two confidence bands do NOT overlap
// AND (2) the mean moved by at least EFFECT_FLOOR (practical-significance floor,
// see config.js). When the bands overlap OR the move is below the floor, the
// change is reported as "within noise" and is NOT counted as a regression. A tool
// that cries wolf is worse than useless, so band separation PLUS a real-sized
// delta — not either alone — is what triggers a verdict.

// Map case-id → { mean, stddev } for a receipt's with_skill cases. Falls back to
// score/0 for v0.1 receipts that have no per-case band.
function withSkillBands(receipt) {
  const out = {};
  for (const c of receipt.results.cases) {
    if (c.mode !== 'with_skill') continue;
    out[c.id] = { mean: c.mean != null ? c.mean : c.score, stddev: c.stddev || 0 };
  }
  return out;
}

// Aggregate with_skill band for a receipt (mean_score ± stddev). v0.1 receipts
// have no aggregate stddev → 0 (bands collapse to points; every move looks real,
// which is exactly the v0.1 weakness v0.2 fixes).
function aggWithBand(receipt) {
  const a = receipt.results.aggregates.with_skill;
  return { mean: a.mean_score, stddev: a.stddev || 0 };
}

function fmt(n) { return n == null ? 'n/a' : (n >= 0 ? '+' : '') + n.toFixed(3); }
function pct(n) { return n == null ? 'n/a' : n.toFixed(3); }
function bandStr(x) { return `${x.mean.toFixed(3)} ± ${x.stddev.toFixed(3)}`; }
function short(h) { return h ? String(h).slice(0, 12) : 'n/a'; }

// The headline is a SUMMARY of the per-case band-overlap verdicts — the credibility
// core lives per case (judge-sample bands), and the headline just aggregates it.
// It deliberately does NOT run a separate band test on the aggregate mean: the
// aggregate band is suite dispersion, and a separate test there would either cry
// wolf (if too tight) or mask real per-case drift (if too wide).
function headlineVerdict(perCase) {
  const reg = perCase.filter((r) => r.verdict === 'regression').length;
  const imp = perCase.filter((r) => r.verdict === 'improvement').length;
  const s = (n) => (n === 1 ? '' : 's');
  if (reg && imp) return `MIXED — ${reg} case regression${s(reg)} and ${imp} improvement${s(imp)} on non-overlapping bands.`;
  if (reg) return `DRIFT — ${reg} case${s(reg)} regressed (bands do not overlap); the skill is measurably weaker on ${reg} case${s(reg)}.`;
  if (imp) return `IMPROVED — ${imp} case${s(imp)} improved (bands do not overlap); none regressed.`;
  return 'WITHIN NOISE — no case moved beyond its confidence band; the skill holds up.';
}

// A revision pair is a pair in which the SKILL TEXT is the only thing that
// moved. `diff` was built for release drift, where the model varies and the text
// is fixed; this inverts it, so the fields that release drift merely warns about
// become the preconditions of the comparison. Returns the offending field name,
// or null when the pair is a valid revision pair.
function revisionPairProblem(a, b) {
  if ((a.run.model_id || '') !== (b.run.model_id || '')) return 'run.model_id';
  if ((a.run.provider || 'anthropic') !== (b.run.provider || 'anthropic')) return 'run.provider';
  if ((a.run.surface || '') !== (b.run.surface || '')) return 'run.surface';
  if ((a.suite.suite_hash || '') !== (b.suite.suite_hash || '')) return 'suite.suite_hash';
  if ((a.skill.content_hash || '') === (b.skill.content_hash || '')) return 'skill.content_hash';
  return null;
}

function buildDriftReport(a, b, { labelA = 'A', labelB = 'B', mode = 'release' } = {}) {
  const revision = mode === 'revision';
  const aB = withSkillBands(a);
  const bB = withSkillBands(b);
  const ids = [...new Set([...Object.keys(aB), ...Object.keys(bB)])];

  // Interop (Phase 7): drift verdicts require TESTED receipts on BOTH sides.
  // An imported (DECLARED) receipt is a faithful record of another tool's
  // declaration — its numbers are shown, but band-verified regression/
  // improvement verdicts are never computed from evidence we did not run.
  const levelOf = (r) => r.verification_level || 'TESTED';
  const belowTested = [[labelA, a], [labelB, b]].filter(([, r]) => levelOf(r) !== 'TESTED');
  const measured = belowTested.length === 0;

  const perCase = ids.map((id) => {
    const before = aB[id] || null;
    const after = bB[id] || null;
    const delta = (before && after) ? round(after.mean - before.mean) : null;
    const verdict = !measured ? 'not measured'
      : (before && after) ? verdictWithFloor(before, after, delta) : 'n/a';
    return { id, before, after, delta, verdict };
  });
  // Sort worst-first: regressions, then by delta.
  const order = { regression: 0, 'within noise': 1, [WITHIN_NOISE_FLOOR]: 1, improvement: 2, 'n/a': 3, 'not measured': 3 };
  perCase.sort((x, y) => (order[x.verdict] - order[y.verdict]) || ((x.delta || 0) - (y.delta || 0)));

  const aAgg = aggWithBand(a);
  const bAgg = aggWithBand(b);
  const headlineDelta = round(bAgg.mean - aAgg.mean);
  const regressions = perCase.filter((r) => r.verdict === 'regression');

  const L = [];
  if (revision) {
    // The axis leads. In a release-drift report the model is what moved and it
    // belongs at the top; here the model is the control and the skill's own text
    // is the finding, so content_hash is the first row a reader meets.
    L.push(`# Revision drift report`);
    L.push('');
    L.push(`**Skill:** ${a.skill.name} \`${a.skill.version}\``);
    L.push('');
    L.push(`**Report type:** revision drift — the skill's own text is the variable under test; the substrate is held fixed.`);
    L.push('');
    L.push(`Left column is the **pinned** revision; right column is the **current** upstream revision.`);
    L.push('');
    L.push(`| | ${labelA} | ${labelB} |`);
    L.push(`|---|---|---|`);
    L.push(`| skill content_hash | \`${short(a.skill.content_hash)}\` | \`${short(b.skill.content_hash)}\` |`);
    L.push(`| model (held) | \`${a.run.model_id}\` | \`${b.run.model_id}\` |`);
    L.push(`| provider (held) | ${a.run.provider || 'anthropic'} | ${b.run.provider || 'anthropic'} |`);
    L.push(`| surface (held) | ${a.run.surface} | ${b.run.surface} |`);
    L.push(`| suite_hash (held) | \`${short(a.suite.suite_hash)}\` | \`${short(b.suite.suite_hash)}\` |`);
    L.push(`| run date (UTC) | ${a.run.date_utc} | ${b.run.date_utc} |`);
    L.push(`| judge samples/case | ${(a.run.judge || {}).samples || 1} | ${(b.run.judge || {}).samples || 1} |`);
    L.push(`| with_skill (mean ± band) | ${bandStr(aAgg)} | ${bandStr(bAgg)} |`);
    L.push(`| baseline score | ${pct(a.comparison.baseline_score)} | ${pct(b.comparison.baseline_score)} |`);
    L.push(`| skill lift (Δ) | ${fmt(a.comparison.delta)} | ${fmt(b.comparison.delta)} |`);
    L.push('');
  } else {
  L.push(`# Drift report`);
  L.push('');
  L.push(`**Skill:** ${a.skill.name} \`${a.skill.version}\``);
  L.push('');
  L.push(`| | ${labelA} | ${labelB} |`);
  L.push(`|---|---|---|`);
  L.push(`| model | \`${a.run.model_id}\` | \`${b.run.model_id}\` |`);
  L.push(`| run date (UTC) | ${a.run.date_utc} | ${b.run.date_utc} |`);
  L.push(`| surface | ${a.run.surface} | ${b.run.surface} |`);
  L.push(`| judge samples/case | ${(a.run.judge || {}).samples || 1} | ${(b.run.judge || {}).samples || 1} |`);
  L.push(`| skill content_hash | \`${short(a.skill.content_hash)}\` | \`${short(b.skill.content_hash)}\` |`);
  L.push(`| suite_hash | \`${short(a.suite.suite_hash)}\` | \`${short(b.suite.suite_hash)}\` |`);
  L.push(`| with_skill (mean ± band) | ${bandStr(aAgg)} | ${bandStr(bAgg)} |`);
  L.push(`| baseline score | ${pct(a.comparison.baseline_score)} | ${pct(b.comparison.baseline_score)} |`);
  L.push(`| skill lift (Δ) | ${fmt(a.comparison.delta)} | ${fmt(b.comparison.delta)} |`);
  L.push('');
  }

  const warnings = [];
  // In revision mode the changed skill text is the INDEPENDENT VARIABLE, not
  // contamination, and the held-constant substrate is what makes the comparison
  // valid. The release-drift caveat below says the opposite of both, so it is
  // replaced rather than suppressed: a reader is told what is held, and why a
  // separated band is attributable to the revision.
  if (revision) {
    warnings.push(`model \`${a.run.model_id}\`, provider ${a.run.provider || 'anthropic'}, surface ${a.run.surface} and suite_hash \`${short(a.suite.suite_hash)}\` are held constant across both receipts — the skill text is the only variable under test, so a band-separated move above the ${EFFECT_FLOOR} floor is attributable to the revision.`);
  }
  if (!revision && a.skill.content_hash !== b.skill.content_hash) warnings.push('skill content_hash differs — the skill itself changed between receipts, so drift mixes skill edits with model drift.');
  if (!revision && a.suite.suite_hash !== b.suite.suite_hash) warnings.push('suite_hash differs — the eval suite changed; per-case comparison may be misleading.');
  if (a.skill.name !== b.skill.name) warnings.push(`different skills (${a.skill.name} vs ${b.skill.name}) — comparison is not meaningful.`);
  if ((a.run.judge || {}).samples <= 1 || (b.run.judge || {}).samples <= 1) warnings.push('one or both receipts are single-sample (no bands) — non-overlap can only be trusted when both sides are sampled.');
  if (!measured) warnings.push(`verdicts NOT computed — ${belowTested.map(([l, r]) => `${l} is ${levelOf(r)}${r.run && r.run.source ? ` (${r.run.source})` : ''}`).join('; ')}. Drift verdicts require TESTED receipts on both sides; declared numbers are shown as context only (see /interop.html).`);
  // Cross-provider / cross-surface disclosure (Phase 6). A comparison across
  // providers is a skill-DURABILITY comparison across substrates, not model drift
  // over time; across surfaces, sampling control differs. Both are flagged so a
  // reader never mistakes one for the other (see docs/neutrality.html).
  if (!revision && (a.run.provider || 'anthropic') !== (b.run.provider || 'anthropic')) warnings.push(`different providers (${a.run.provider || 'anthropic'} vs ${b.run.provider || 'anthropic'}) — this is a cross-substrate durability comparison, not model drift over time; read the delta, not absolute scores (see the neutrality policy).`);
  if (!revision && a.run.surface !== b.run.surface) warnings.push(`different surfaces (${a.run.surface} vs ${b.run.surface}) — sampling control differs between surfaces; compare with care.`);
  if (warnings.length) {
    L.push('> **⚠ Caveats**');
    for (const w of warnings) L.push(`> - ${w}`);
    L.push('');
  }

  const nWithin = perCase.filter((r) => isWithinNoise(r.verdict)).length;
  const nFloor = perCase.filter((r) => r.verdict === WITHIN_NOISE_FLOOR).length;
  L.push(`## Headline`);
  L.push('');
  if (!measured) {
    L.push(`**NOT MEASURED — ${belowTested.length} receipt(s) below TESTED. Drift verdicts require TESTED receipts on both sides; the declared numbers above are context, not band-verified evidence.**`);
    L.push('');
  } else {
    L.push(`**${revision ? revisionHeadline(perCase) : headlineVerdict(perCase)}**`);
    L.push('');
    L.push(`with_skill mean moved ${fmt(headlineDelta)} (${bandStr(aAgg)} → ${bandStr(bAgg)}; band = suite dispersion). Per-case band-overlap verdicts: ${regressions.length} regression(s), ${perCase.filter((r) => r.verdict === 'improvement').length} improvement(s), ${nWithin} within noise${nFloor ? ` (${nFloor} of them band-separated but below the ${EFFECT_FLOOR} effect floor)` : ''}.`);
    L.push('');
  }

  L.push(`## Per-case with_skill (band overlap → verdict)`);
  L.push('');
  L.push(`| case | ${labelA} (mean ± sd) | ${labelB} (mean ± sd) | Δ | verdict |`);
  L.push(`|---|---|---|---|---|`);
  for (const r of perCase) {
    const flag = r.verdict === 'regression' ? '🔻 regression' : r.verdict === 'improvement' ? '🔼 improvement' : r.verdict === WITHIN_NOISE_FLOOR ? 'within noise (below floor)' : r.verdict === 'within noise' ? 'within noise' : r.verdict === 'not measured' ? 'not measured' : 'n/a';
    L.push(`| \`${r.id}\` | ${r.before ? bandStr(r.before) : 'n/a'} | ${r.after ? bandStr(r.after) : 'n/a'} | ${fmt(r.delta)} | ${flag} |`);
  }
  L.push('');

  if (regressions.length) {
    L.push(`## Regressions (${regressions.length}) — bands do not overlap`);
    L.push('');
    for (const r of regressions) {
      L.push(`- \`${r.id}\`: ${bandStr(r.before)} → ${bandStr(r.after)} (${fmt(r.delta)})`);
    }
    L.push('');
  }

  return { markdown: L.join('\n'), perCase, headlineDelta, regressions };
}

module.exports = { buildDriftReport, withSkillBands, revisionPairProblem };
