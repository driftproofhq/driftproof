// SPDX-License-Identifier: Apache-2.0
'use strict';

const { EFFECT_FLOOR } = require('../config');

// Economics of a run — what a skill COSTS to run, alongside whether it helps.
//
// Driftproof has always answered "does this skill still help?". Spec v0.4 adds
// the other half a reader needs to act: what it costs in money and in latency.
// The three axes are deliberately kept SEPARATE and always shown TOGETHER:
//
//   1. accuracy lift  — with-skill vs baseline, with bands (the existing verdict)
//   2. Δ cost         — metered-equivalent dollars the skill adds per call
//   3. Δ latency      — wall-clock the skill adds, observed on the run's surface
//
// THERE IS NO COMPOSITE SCORE, ANYWHERE, EVER. Collapsing three axes with
// different units, different error bars, and different decision-owners into one
// "value score" would manufacture a number nobody can trace back to evidence —
// exactly the cry-wolf failure the band rule exists to prevent. A reader weighs
// the three against their own constraints; the report refuses to weigh them on
// the reader's behalf. This module therefore exports no such function, and the
// gate asserts none appears.
//
// RATIO FRAMINGS ARE FLOOR-GATED. A ratio like "dollars per 0.01 lift" is
// only meaningful when the benefit it prices is a real move. When the lift did not clear
// the effect floor (or its bands overlap), the ratio renders "n/a (within noise)"
// — never a number, however tempting the arithmetic. Dividing noise by a cost
// produces a precise-looking figure with no evidence under it.
//
// PRICING IS FROZEN AT RUN TIME. Registry prices change (vendors cut prices; we
// correct estimates). A receipt that recomputed its costs against today's
// registry would silently change meaning after publication, so every derived
// dollar figure is computed from the run's own `run.pricing_snapshot` and NEVER
// from the live registry. Functions here take the snapshot as an argument and
// have no access to lib/models — that is the enforcement, not a convention.

// What each surface's dollar figure MEANS. On a subscription CLI the actual
// metered spend is $0; the figure is what the same tokens would have cost on the
// metered API, which is the only cross-substrate-comparable basis available.
const COST_BASIS = {
  metered: 'metered',
  equivalent: 'metered-equivalent',
};

const LATENCY_DISCLOSURE =
  'observed on subscription CLI surface, indicative';

const NOISE_CELL = 'n/a (within noise)';

// A floor-clearing NEGATIVE lift: the skill measurably hurt, so there is no
// benefit to put a price on.
const REGRESSED_CELL = 'n/a (skill regressed)';

// A cell with at least one separated, floor-clearing DRIVER whose AGGREGATE lift
// does not clear the floor. It is not "within noise" — the QA re-derivation found
// six such cells rendering the noise string while the Verdict basis on the same
// page named their drivers (QA V-4, 2026-08-19). The aggregate stays the
// denominator (spec 002 AC-4, DECISIONS #9), so no price is quoted, but the cell
// must not claim an absence of evidence that the page itself contradicts.
const DRIVER_ONLY_CELL = 'n/a (driver-only)';

// The unit of benefit the cost is expressed against. 0.01 is one fifth of the
// 0.05 effect floor — small enough to read as "a point of lift", large enough
// that the quoted cost stays in human range.
const LIFT_POINT = 0.01;

// Absolute per-call cost on a CLI surface is inflated by a fixed harness preamble
// (~25k input tokens on claude-cli, ~11k on codex) that we neither control nor
// can strip. It is identical in both arms, so it CANCELS in every Δ figure —
// which is why the incremental columns are the honest ones.
const ABSOLUTE_COST_CAVEAT =
  'Absolute per-call cost on a CLI surface includes a fixed harness preamble '
  + '(observed ~25k input tokens on claude-cli, ~11k on codex) that we do not control. '
  + 'It is identical in the with-skill and baseline arms, so it cancels in the Δ '
  + 'figures — read the incremental columns, not the absolute ones.';

// Cached input is costed at the full list rate here (an over-estimate on
// cache-heavy surfaces). Cache-discount multipliers are vendor- and tier-specific
// and would be a guess; `cached_tokens` is recorded on every case so a reader can
// recompute under their own assumption.
const CACHE_PRICING_NOTE =
  'Cached input tokens are costed at the list input rate (an over-estimate where '
  + 'caching is heavy); cached_tokens is recorded per call so a reader can recompute.';

// ── pricing snapshot ──────────────────────────────────────────────────────────
// Freeze the prices for exactly the models a run touches. `lookup` is injected
// (lib/models.priceForModel) so this module never reads the registry itself.
function buildPricingSnapshot({ models, lookup, nowIso }) {
  const entries = {};
  for (const m of models || []) {
    if (!m || entries[m]) continue;
    const p = lookup(m) || {};
    entries[m] = {
      input_per_mtok: Number(p.input),
      output_per_mtok: Number(p.output),
      registered: !!p.registered,
    };
  }
  return {
    frozen_at: nowIso,
    source: 'config/models.json',
    currency: 'USD',
    models: entries,
    note: 'Prices frozen at run time. Every derived cost in this receipt is computed '
      + 'from THIS snapshot, never from the live registry, so the receipt keeps its '
      + 'meaning when registry prices later change.',
  };
}

// USD for one call's usage at snapshot prices. Returns null when either the
// usage or the price is unknown — a missing number is never imputed as zero.
function costForUsage(usage, price) {
  if (!usage || !price) return null;
  if (usage.input_tokens == null && usage.output_tokens == null) return null;
  const inRate = Number(price.input_per_mtok);
  const outRate = Number(price.output_per_mtok);
  if (!Number.isFinite(inRate) || !Number.isFinite(outRate)) return null;
  const usd = (Number(usage.input_tokens || 0) / 1e6) * inRate
    + (Number(usage.output_tokens || 0) / 1e6) * outRate;
  return round6(usd);
}

// ── small stats (median / IQR, kept here so latency needs no new dependency) ──
function median(nums) {
  const xs = (nums || []).filter((x) => Number.isFinite(Number(x))).map(Number).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : round2((xs[mid - 1] + xs[mid]) / 2);
}

// Quartiles by the "exclusive halves" convention (Tukey hinges): the median is
// not included in either half when n is odd.
function quartiles(nums) {
  const xs = (nums || []).filter((x) => Number.isFinite(Number(x))).map(Number).sort((a, b) => a - b);
  if (xs.length < 4) return { p25: null, p75: null, iqr: null };
  const mid = Math.floor(xs.length / 2);
  const lower = xs.slice(0, mid);
  const upper = xs.slice(xs.length % 2 ? mid + 1 : mid);
  const p25 = median(lower);
  const p75 = median(upper);
  return { p25, p75, iqr: p25 == null || p75 == null ? null : round2(p75 - p25) };
}

function meanOf(nums) {
  const xs = (nums || []).filter((x) => Number.isFinite(Number(x))).map(Number);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ── per-arm economics ─────────────────────────────────────────────────────────
// One arm = all completed case rows of one mode (with_skill | baseline). Only
// the GENERATION usage of each row feeds this; judge usage is measurement
// overhead and is never passed in (see computeEconomics).
function armEconomics(rows, price) {
  const usages = rows.map((r) => r.usage).filter(Boolean);
  const costs = usages.map((u) => costForUsage(u, price)).filter((c) => c != null);
  const wall = usages.map((u) => (u.wall_ms == null ? null : u.wall_ms)).filter((x) => x != null);
  const q = quartiles(wall);
  const mIn = meanOf(usages.map((u) => u.input_tokens));
  const mOut = meanOf(usages.map((u) => u.output_tokens));
  return {
    call_count: usages.length,
    mean_input_tokens: mIn == null ? null : round2(mIn),
    mean_output_tokens: mOut == null ? null : round2(mOut),
    mean_cost_usd_per_call: costs.length ? round6(meanOf(costs)) : null,
    median_wall_ms: median(wall),
    wall_ms_p25: q.p25,
    wall_ms_p75: q.p75,
    wall_ms_iqr: q.iqr,
  };
}

// Build the receipt's `economics` block from its case rows.
//
//   cases            results.cases (failed_timeout rows are excluded)
//   modelId          the run's generation model — priced from the snapshot
//   judgeModelId     the judge model — priced ONLY for the excluded-overhead line
//   pricingSnapshot  run.pricing_snapshot (the frozen prices; never the registry)
//   surface          the run surface, to label the cost basis honestly
function computeEconomics({ cases, modelId, judgeModelId, pricingSnapshot, surface, meteredSurface }) {
  const price = (pricingSnapshot && pricingSnapshot.models && pricingSnapshot.models[modelId]) || null;
  const ok = (cases || []).filter((c) => c.case_status !== 'failed_timeout');
  const withRows = ok.filter((c) => c.mode === 'with_skill');
  const baseRows = ok.filter((c) => c.mode === 'baseline');

  const w = armEconomics(withRows, price);
  const b = armEconomics(baseRows, price);

  const incrementalPerCall = (w.mean_cost_usd_per_call == null || b.mean_cost_usd_per_call == null)
    ? null : round6(w.mean_cost_usd_per_call - b.mean_cost_usd_per_call);
  const outputDelta = (w.mean_output_tokens == null || b.mean_output_tokens == null)
    ? null : round2(w.mean_output_tokens - b.mean_output_tokens);
  const wallDelta = (w.median_wall_ms == null || b.median_wall_ms == null)
    ? null : round2(w.median_wall_ms - b.median_wall_ms);

  // Judge cost is computed for DISCLOSURE only — it is measurement overhead we
  // impose, not a cost of running the skill, so it never touches the fields above.
  const judgePrice = (pricingSnapshot && pricingSnapshot.models && pricingSnapshot.models[judgeModelId]) || null;
  const judgeUsages = ok.map((c) => c.judge_usage).filter(Boolean);
  const judgeCosts = judgeUsages.map((u) => costForUsage(u, judgePrice)).filter((c) => c != null);

  return {
    basis: meteredSurface ? COST_BASIS.metered : COST_BASIS.equivalent,
    surface,
    with_skill: w,
    baseline: b,
    skill_incremental_cost_usd_per_call: incrementalPerCall,
    skill_incremental_cost_usd_per_1k_calls: incrementalPerCall == null ? null : round4(incrementalPerCall * 1000),
    output_tokens_delta: outputDelta,
    median_wall_ms_delta: wallDelta,
    judge_excluded: true,
    judge_overhead: {
      note: 'Measurement overhead imposed by Driftproof, NOT a cost of running the skill. '
        + 'Excluded from every field above.',
      total_cost_usd: judgeCosts.length ? round6(judgeCosts.reduce((a, c) => a + c, 0)) : null,
      case_rows_measured: judgeUsages.length,
    },
    notes: {
      absolute_cost: ABSOLUTE_COST_CAVEAT,
      cache_pricing: CACHE_PRICING_NOTE,
      latency: LATENCY_DISCLOSURE,
    },
  };
}

// Every dollar figure must be re-derivable from the receipt's OWN frozen pricing.
//
// Tokens are the durable measurement — what the skill actually consumed. Dollars
// are a dated derived view of those tokens, and provider pricing moves
// independently of model behaviour. So a dollar figure is only publishable if a
// reader can recompute it from the tokens and the frozen rates recorded alongside
// it; anything else is an authoritative-looking number with no derivation behind
// it. This is the check, used by the gate rather than trusted by convention.
//
//   arms   { with_skill: {mean_input_tokens, mean_output_tokens, mean_cost_usd_per_call}, baseline: {…} }
//   rates  { input_per_mtok, output_per_mtok }   — from run.pricing_snapshot
//
// Cost is linear in tokens, so the mean of per-call costs equals the cost of the
// mean tokens exactly; the tolerance below absorbs only rounding of the stored
// figures, not disagreement.
function dollarsTraceable({ arms, rates, incrementalPer1kCalls, tolerance = 1e-5 }) {
  const mismatches = [];
  if (!arms || !rates || !Number.isFinite(Number(rates.input_per_mtok)) || !Number.isFinite(Number(rates.output_per_mtok))) {
    return { traceable: false, mismatches: [{ reason: 'no frozen rates to derive from' }] };
  }
  const derivedArm = {};
  for (const arm of ['with_skill', 'baseline']) {
    const a = arms[arm];
    if (!a) continue;
    if (a.mean_cost_usd_per_call == null) continue;   // nothing claimed, nothing to trace
    const derived = (Number(a.mean_input_tokens || 0) / 1e6) * Number(rates.input_per_mtok)
      + (Number(a.mean_output_tokens || 0) / 1e6) * Number(rates.output_per_mtok);
    derivedArm[arm] = derived;
    const diff = Math.abs(derived - Number(a.mean_cost_usd_per_call));
    if (!(diff <= tolerance)) {
      mismatches.push({ arm, recorded: a.mean_cost_usd_per_call, derived: round6(derived), diff: round6(diff) });
    }
  }

  // THE PUBLISHED FIGURE, not merely its inputs. Four consecutive approvals
  // flagged the same gap: verifying the two per-arm means leaves the subtraction
  // and the ×1000 scaling that actually produce the rendered
  // `derived: $X/1k calls` outside the traced chain — so a wrong-but-non-zero
  // increment passed everything. The increment is re-derived here from the
  // DERIVED arm costs (never from the recorded ones), so an error anywhere in
  // tokens → rates → arm cost → subtraction → scaling is caught.
  if (incrementalPer1kCalls != null) {
    if (derivedArm.with_skill == null || derivedArm.baseline == null) {
      mismatches.push({ field: 'skill_incremental_cost_usd_per_1k_calls', reason: 'an arm cost could not be derived, so the increment cannot be traced' });
    } else {
      const derivedIncrement = (derivedArm.with_skill - derivedArm.baseline) * 1000;
      const diff = Math.abs(derivedIncrement - Number(incrementalPer1kCalls));
      // Scaled by 1000, so the tolerance scales with it.
      if (!(diff <= tolerance * 1000)) {
        mismatches.push({
          field: 'skill_incremental_cost_usd_per_1k_calls',
          recorded: incrementalPer1kCalls, derived: round6(derivedIncrement), diff: round6(diff),
        });
      }
    }
  }
  return { traceable: mismatches.length === 0, mismatches };
}

// Re-derive a receipt's own generation and judge spend from its CASE ROWS —
// tokens × the rates frozen into that same receipt — rather than reading the
// aggregates it recorded. Same adjacency disease as F2: a figure read verbatim is
// a figure nobody checked. The judge model is taken per row from `case.judge.model_id`,
// so a run whose judge changed mid-flight still prices each row correctly.
function receiptCostBreakdown(receipt) {
  const snap = receipt && receipt.run && receipt.run.pricing_snapshot;
  const models = (snap && snap.models) || null;
  if (!models) return { derivable: false, generation_usd: null, judge_usd: null, reason: 'no frozen pricing' };
  const genRate = models[receipt.run.model_id];
  if (!genRate) return { derivable: false, generation_usd: null, judge_usd: null, reason: 'generation model absent from the frozen snapshot' };
  let generation = 0;
  let judge = 0;
  let missingJudgeRate = null;
  for (const c of ((receipt.results || {}).cases || [])) {
    if (c.case_status === 'failed_timeout') continue;
    const g = costForUsage(c.usage, genRate);
    if (g != null) generation += g;
    if (c.judge_usage) {
      const jid = (c.judge || {}).model_id;
      const jRate = jid ? models[jid] : null;
      if (!jRate) { missingJudgeRate = jid || '(unnamed judge)'; continue; }
      const j = costForUsage(c.judge_usage, jRate);
      if (j != null) judge += j;
    }
  }
  if (missingJudgeRate) {
    return { derivable: false, generation_usd: null, judge_usd: null, reason: `judge model ${missingJudgeRate} absent from the frozen snapshot` };
  }
  return { derivable: true, generation_usd: round6(generation), judge_usd: round6(judge) };
}

// The run's total metered-equivalent spend, derived from the receipts themselves.
//
// The obvious source for a run-total is the up-front projection — and it is the
// wrong one. A projection prices ASSUMED per-call token constants at whatever the
// registry says TODAY; it is explicitly "a rough upper bound, not an invoice". Put
// on a page next to a disclosure promising every dollar re-derives from frozen
// rates, it makes that promise false. This derives the total from what was
// actually measured: each receipt's per-arm mean cost (already computed at that
// receipt's own frozen rates) times its call count, plus the judge overhead the
// same receipt recorded.
//
// Judge cost is INCLUDED here and excluded from skill-value figures — different
// questions. "What did this run cost to perform" includes the measuring; "what
// does this skill cost to run" does not.
function runTotalFromReceipts(receipts) {
  let generation = 0;
  let judge = 0;
  let counted = 0;
  const untraceable = [];
  for (const r of receipts || []) {
    const e = (r && r.economics) || null;
    const snap = r && r.run && r.run.pricing_snapshot;
    if (!e || !snap) { untraceable.push({ model: r && r.run && r.run.model_id, reason: 'no economics or no frozen pricing' }); continue; }
    // B1: both halves are RE-DERIVED from the receipt's case rows at its frozen
    // rates — not read from the aggregates. The judge half in particular was
    // previously taken verbatim from `judge_overhead.total_cost_usd`, so a
    // write-time mispricing would have flowed into the published headline
    // untested.
    const bd = receiptCostBreakdown(r);
    if (!bd.derivable) { untraceable.push({ model: r.run.model_id, reason: bd.reason }); continue; }
    generation += bd.generation_usd;
    judge += bd.judge_usd;
    counted += 1;
  }
  // CONSTITUTION invariant 1: a published number states its verification level
  // rather than implying one. The total inherits the WEAKEST level among the
  // receipts it was derived from — a sum is only as verified as its least-verified
  // term, so a single DECLARED (e.g. imported) receipt drags the headline down
  // rather than hiding behind the TESTED majority.
  const level = weakestVerificationLevel(receipts);

  // Display triple, rounded to cents and made ARITHMETICALLY EXACT as displayed:
  // the total is the sum of the two rounded components, so a reader adding the
  // printed figures gets the printed total. Rounding each independently produced
  // "$60.73 + $3.44 = $64.18" — off by a cent on a page whose disclosure promises
  // every dollar re-derives.
  const genDisplay = round2(generation);
  const judgeDisplay = round2(judge);
  return {
    total_usd: round6(generation + judge),
    generation_usd: round6(generation),
    judge_usd: round6(judge),
    display: {
      generation_usd: genDisplay,
      judge_usd: judgeDisplay,
      total_usd: round2(genDisplay + judgeDisplay),
    },
    verification_level: level,
    receipts_counted: counted,
    traceable: untraceable.length === 0 && counted > 0,
    untraceable,
  };
}

// The community lattice, weakest first. A receipt with no stated level is treated
// as UNVERIFIED — absence is not evidence of verification.
const VERIFICATION_LATTICE = ['UNVERIFIED', 'DECLARED', 'TESTED', 'FORMAL'];
function weakestVerificationLevel(receipts) {
  const list = (receipts || []).map((r) => (r && r.verification_level) || 'UNVERIFIED');
  if (!list.length) return 'UNVERIFIED';
  return list.reduce((weakest, lvl) => {
    const a = VERIFICATION_LATTICE.indexOf(weakest);
    const b = VERIFICATION_LATTICE.indexOf(lvl);
    return (b < 0 || b < a) ? (b < 0 ? 'UNVERIFIED' : lvl) : weakest;
  }, 'FORMAL');
}

// ── presentation rules ────────────────────────────────────────────────────────
// Whether a lift is allowed to appear as the numerator of a ratio: it must have
// cleared the effect floor AND been a real (band-separated) move. `separated` is
// supplied by the caller from the same per-case band rule the verdict uses — this
// function never re-derives a verdict.
function liftIsReportable({ lift, separated }) {
  if (typeof lift !== 'number' || !Number.isFinite(lift)) return false;
  if (separated === false) return false;
  return Math.abs(lift) >= EFFECT_FLOOR;
}

// A rendered cell "looks zero" when its leading numeric token is zero — the
// failure this unit was changed to fix. `+0.00 /$/1k` next to a real, floor-
// clearing lift states the opposite of the measurement. Exported so the spec gate
// and the repo gate share ONE definition of the defect rather than each carrying
// its own regex. A cell with no numeric token at all (the noise string) is not
// zero-looking — it makes no numeric claim.
function isZeroLooking(cell) {
  const m = String(cell == null ? '' : cell).match(/-?\d+(?:\.\d+)?/);
  if (!m) return false;
  return Number(m[0]) === 0;
}

// Cost per unit of measured benefit: dollars per 0.01 lift.
//
//   cost_per_0.01_lift = incremental_cost_per_1k_calls × 0.01 ÷ |lift|
//
// This replaced "lift per dollar per 1,000 calls", which was arithmetically fine
// and practically useless: real incremental costs are $24–70 per 1k calls against
// lifts of 0.03–0.6, so every real cell rendered `+0.00` — reading as "no benefit
// per dollar" beside a case that had moved +0.636. Inverting the ratio puts the
// number in human range and asks the question a reader actually has: what does
// this benefit cost me? It also cannot collapse toward zero as costs rise.
//
// The floor gate is unchanged and still decides whether ANY number renders: a
// lift that did not clear the effect floor with separated bands returns the noise
// cell, never a figure. Returns a rendered STRING, never a bare number, so a
// caller cannot format its way around the rule.
function costPerLiftPoint({ lift, separated, incrementalCostPer1kCalls }) {
  if (!liftIsReportable({ lift, separated })) {
    // Two different absences, two different strings. `separated` means at least
    // one case cleared the floor with non-overlapping bands; when that holds and
    // only the aggregate falls short, the evidence exists and is listed under
    // Verdict basis — saying "within noise" there contradicts the same page.
    return separated ? DRIVER_ONLY_CELL : NOISE_CELL;
  }
  const cost = Number(incrementalCostPer1kCalls);
  if (!Number.isFinite(cost) || cost === 0) return NOISE_CELL;
  // A negative lift can clear the floor — the skill measurably HURT. There is no
  // benefit to price, and a negative price would read as a refund, so the cell
  // states the regression instead of pricing it.
  if (lift < 0) return REGRESSED_CELL;
  // A negative COST is the mirror case: the skill improved measured quality AND
  // made the call cheaper. "What one unit of benefit costs" has no meaning when
  // the benefit is free, and a negative price sorts backwards against every other
  // cell in the column (more negative = better), which is the same reading
  // failure `+0.00 /$/1k` had. Four cells reach this on the #005 data.
  if (cost < 0) return `saves $${Math.abs(cost).toFixed(2)}/1k calls`;
  const perPoint = (cost * LIFT_POINT) / Math.abs(lift);
  if (!Number.isFinite(perPoint)) return NOISE_CELL;
  // Two decimals down to a cent; below that, two significant figures, so a small
  // but real cost never displays as $0.00 — the very defect this replaced.
  const shown = perPoint >= 0.01 ? perPoint.toFixed(2) : Number(perPoint.toPrecision(2)).toString();
  return `$${shown} per ${LIFT_POINT} lift`;
}

// ── T4 (AC-7) — what measurement cost in TIME ────────────────────────────────
// The judge is excluded from every value figure by construction, which makes it
// easy to forget how much of a run it is. In dollars it is the smaller half on
// two of three substrates; in wall-clock it dominates. Receipts carry per-call
// `wall_ms` on both the generation and the judge side, so this is measured, not
// modelled. There is no run finish stamp on a receipt — see the run record, which
// labels any finish as derived.
function runWallClockFromReceipts(receipts) {
  let genMs = 0, judgeMs = 0, calls = 0, rows = 0;
  for (const r of receipts || []) {
    for (const c of ((r.results || {}).cases || [])) {
      const u = c.usage, j = c.judge_usage;
      if (u && u.wall_ms != null) { genMs += Number(u.wall_ms); calls++; }
      if (j && j.wall_ms != null) { judgeMs += Number(j.wall_ms); rows++; }
    }
  }
  const totalMs = genMs + judgeMs;
  const hours = (ms) => round2(ms / 3.6e6);
  return {
    generation_hours: hours(genMs),
    judge_hours: hours(judgeMs),
    total_hours: hours(totalMs),
    judge_share_pct: totalMs > 0 ? Math.round((100 * judgeMs) / totalMs) : null,
    generation_calls: calls,
    judged_rows: rows,
    measured: totalMs > 0,
  };
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }
function round4(n) { return Math.round(Number(n) * 1e4) / 1e4; }
function round6(n) { return Math.round(Number(n) * 1e6) / 1e6; }

module.exports = {
  buildPricingSnapshot, costForUsage, computeEconomics, armEconomics,
  liftIsReportable, costPerLiftPoint, isZeroLooking, dollarsTraceable, runTotalFromReceipts,
  runWallClockFromReceipts,
  receiptCostBreakdown,
  weakestVerificationLevel, VERIFICATION_LATTICE,
  median, quartiles,
  COST_BASIS, LATENCY_DISCLOSURE, NOISE_CELL, REGRESSED_CELL, DRIVER_ONLY_CELL, LIFT_POINT,
  ABSOLUTE_COST_CAVEAT, CACHE_PRICING_NOTE,
};
