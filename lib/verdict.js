// SPDX-License-Identifier: Apache-2.0
'use strict';

const crypto = require('crypto');
const { EFFECT_FLOOR, POWER_Z } = require('../config');
// Its own line: spec 035's POWER_Z mutation plants at the line above, as it stands.
const { SCORE_SCALE } = require('../config');
const { bandOf } = require('./reuse');
const { isMeasured } = require('./sampling');
const { duplicateCaseRows, ambiguityLine, suiteNarrowed } = require('./receipt');

// Spec 050 AC-3. A receipt with two rows for one (id, mode) has no verdict: which row
// the byId map below kept would decide it. The error carries a code so a caller that
// renders refusals can tell this one from a defect.
class AmbiguousReceiptError extends Error {
  constructor(dups) {
    super(`ambiguous receipt: ${ambiguityLine(dups)}; a verdict over it would depend on which row was read`);
    this.code = 'AMBIGUOUS_RECEIPT';
    this.duplicates = dups;
  }
}

// Single-receipt verdict + shields.io badge.
//
// `diff` compares TWO receipts across model releases; a single receipt carries its
// own verdict: does the skill still help on THIS model, and could this receipt have
// told? Spec 035 (R-1 to R-5, spec.md) reads it per case, from the receipt's own
// fields, with the same band rule the differ applies:
//
//   R-1  a case SEPARATES when the with_skill and baseline bands (mean plus or minus
//        one sample sd across draws) do not overlap AND the means differ by at least
//        EFFECT_FLOOR;
//   R-2  its RESOLUTION is s_w + s_b + POWER_Z * sqrt(s_w^2/n_w + s_b^2/n_b);
//   R-3  a case that does not separate is UNDERPOWERED when an arm has fewer than two
//        measured draws or its resolution reaches the floor;
//   R-4  the draws that would have been needed, per arm, with the spreads held;
//   R-5  REGRESSED when any case separated downward, else PASSED when any separated
//        upward, else UNDERPOWERED when any case is underpowered, else NO_EFFECT.
//
// Spec 119 bounds a case that lost draws (boundedCase below), and R-5 gains the rung
// INCONCLUSIVE for a separation not shown to hold for every score the lost draws could
// have had.
//
// Until spec 035 this read only `comparison.delta` against the floor, so a receipt
// whose aggregate cleared the floor with no case separated rendered passing, and the
// 0.10.1 reliability audit measured 34.56% of binary-null receipts labelled passing.
//
// R-5's four refusals are the ones `lib/decision.js` decisionState has applied since
// spec 030: not TESTED, `run.answered_by.kind` not `model`, an incomplete run, no
// numeric delta. This reader used to apply three of them, and to default an absent
// `verification_level` to TESTED, so a receipt that said nothing about what answered
// it was badged on its numbers while the Action path read it as `not measured`. Both
// readers now refuse on an ABSENT field as they refuse on a stated wrong one, which
// is the fail-safe direction and the only reading under which one receipt cannot get
// two answers. Every receipt under `receipts/` predates `answered_by` (schema v0.1 to
// v0.5, the field arrived in v0.6) and is refused by the badge from here on, exactly
// as `driftproof decide` has always refused it.

const VERDICTS = {
  PASSED: { color: 'brightgreen', word: 'passing' },
  NO_EFFECT: { color: 'lightgrey', word: 'no effect' },
  REGRESSED: { color: 'red', word: 'regressed' },
  // Interop (Phase 7): a receipt below TESTED (imported/DECLARED) or with no
  // delta (a source tool with no baseline mode) never gets a pass/fail verdict
  // — declared numbers are recorded, not verified, so the badge says so.
  NOT_MEASURED: { color: 'lightgrey', word: 'not measured' },
  // Spec 035: the receipt's own spreads and draws cannot resolve a shift of the
  // effect floor. Not a finding about the skill; a finding about this receipt.
  UNDERPOWERED: { color: 'blue', word: 'not enough draws' },
  // Spec 119: a case separated on the draws that were measured, and the separation is not
  // shown to hold for every score its lost draws could have had. The colour and word are the ones
  // lib/decision.js RENDER gives the `inconclusive` state this verdict maps to.
  INCONCLUSIVE: { color: 'yellow', word: 'inconclusive' },
};

// THE PLAIN LINE for the UNDERPOWERED state (spec 035 AC-9). Every surface that
// renders the state in words carries exactly this sentence.
const UNDERPOWERED_LINE = 'Not enough draws to conclude at this effect floor';

// Strip a trailing -YYYYMMDD date stamp so the badge reads cleanly
// (claude-haiku-4-5-20251001 → claude-haiku-4-5).
function shortModel(modelId) {
  return String(modelId || 'unknown').replace(/-\d{8}$/, '');
}

// One arm of one case, from the receipt's own fields, through the one band
// definition every comparison path shares (lib/reuse.js bandOf, spec 016 AC-1). A
// generation-sampled receipt's band counts its measured draws; an older receipt's
// band is its judge samples over one generation, which is one draw.
function armOf(c) {
  const band = bandOf(c);
  if (!band) return null;
  return { mean: band.mean, sd: band.sd, n: band.source === 'generation' ? (typeof band.n === 'number' ? band.n : 0) : 1 };
}

// R-1 to R-4 for one pair of arms. `a` is the arm the delta is measured from and
// `b` the arm it is measured to: for a receipt, baseline and with_skill; for the
// differ, the older receipt's with_skill and the newer one's.
function caseRule(a, b, { floor = EFFECT_FLOOR, z = POWER_Z } = {}) {
  const delta = b.mean - a.mean;
  // Spec 036 A-036-2: the draws this case actually took, which is the smaller of the two
  // arms' measured draws. The binding arm is the one that would have to be drawn again,
  // so it is the one a reader is owed beside the count that would have been needed.
  const drawsTaken = Math.min(a.n, b.n);
  const apart = b.mean - b.sd > a.mean + a.sd || a.mean - a.sd > b.mean + b.sd;
  if (apart && Math.abs(delta) >= floor) return { state: delta > 0 ? 'separated-up' : 'separated-down', delta, drawsTaken };
  if (a.n < 2 || b.n < 2) return { state: 'underpowered', delta, resolution: null, drawsNeeded: null, reason: 'single_draw', drawsTaken };
  const resolution = a.sd + b.sd + z * Math.sqrt((a.sd * a.sd) / a.n + (b.sd * b.sd) / b.n);
  if (resolution < floor) return { state: 'not-separated', delta, resolution, drawsTaken };
  const spread = a.sd + b.sd;
  if (spread >= floor) return { state: 'underpowered', delta, resolution, drawsNeeded: null, reason: 'spread', spread, drawsTaken };
  const drawsNeeded = Math.max(2, Math.floor((z * z * (a.sd * a.sd + b.sd * b.sd)) / ((floor - spread) ** 2)) + 1);
  return { state: 'underpowered', delta, resolution, drawsNeeded, reason: 'draws', spread, drawsTaken };
}

// Spec 119. THE DRAWS AN ARM LOST, read off the receipt. An unmeasured draw is left out of its
// arm's mean and sd (lib/sampling.js acrossDraws), so a kept case that lost some draws is read
// from its survivors: losing the lowest-scoring with-skill draws raises the with-skill mean, and
// losing the highest lowers it. Null when the arm lost none. The count is the larger of the lost
// records and `n_unmeasured`, and the arm is bounded (`measured` set) only when its records hold
// every draw it drew and name every draw it lost (A-119-1, F-2); otherwise no bound can be read.
const NO_REASON = 'no reason recorded';
const reasonOf = (d) => (typeof d.reason === 'string' && d.reason.trim() ? d.reason.replace(/\s+/g, ' ').trim() : NO_REASON);
function lostDrawsOf(row) {
  const g = row && row.generation;
  if (!g || typeof g !== 'object') return null;
  const draws = Array.isArray(g.draws) ? g.draws : null;
  const records = draws ? draws.filter((d) => !isMeasured(d)) : [];
  const counted = Number.isInteger(g.n_unmeasured) && g.n_unmeasured > 0 ? g.n_unmeasured : 0;
  const lost = Math.max(records.length, counted);
  if (!lost) return null;
  const drawnCount = Number.isInteger(g.n_drawn) ? g.n_drawn : 0;
  const complete = !!draws && records.length === lost && draws.length >= drawnCount;
  const reasons = [...new Set([...records.map(reasonOf), ...(records.length < lost ? [NO_REASON] : [])])];
  const drawn = Math.max(draws ? draws.length : 0, drawnCount, lost + (Number.isInteger(g.n_measured) ? g.n_measured : 0));
  return { lost, drawn, reasons, measured: complete ? draws.filter(isMeasured).map((d) => d.mean) : null };
}

// A recorded mean or sd is rounded to six places (lib/stats.js round), so a mean, an sd, or a
// mean plus or minus an sd read off rounded values sits within 1e-6 of the unrounded figure.
// Each end of an envelope is widened by twice that, so neither the rounding nor the float
// arithmetic below can carry a fill past it; inside the slack a reading fails closed (A-119-1).
const ROUNDING_SLACK = 2e-6;

// The unrounded mean and sample sd of a list of scores, as lib/stats.js computes them.
function moments(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
  return { mean: m, sd };
}

// Spec 119, A-119-1. ONE ARM'S ENVELOPE over every score its lost draws could have had: the lowest
// mean minus sd, the highest mean plus sd, the lowest and highest mean, the highest sd, and the
// draws it would then have. An arm that lost none is its recorded band. The proof is in spec.md
// A-119-1: mean minus sd is concave in the lost scores and mean plus sd and sd convex, so each
// extreme sits at a corner of the scale's box, and the draws of one arm are interchangeable, so a
// corner is fixed by how many lost draws sit at the worst score: L + 1 fills, not 2^L.
function envelope(c, lost) {
  if (!lost) {
    const a = armOf(c);
    return a && { lo: a.mean - a.sd, hi: a.mean + a.sd, loHi: a.mean - a.sd, hiLo: a.mean + a.sd, meanLo: a.mean, meanHi: a.mean, sdHi: a.sd, n: a.n };
  }
  if (!lost.measured) return null;
  const { worst, best } = SCORE_SCALE;
  const L = lost.lost;
  const at = Array.from({ length: L + 1 }, (_, j) => moments([...lost.measured, ...Array(j).fill(worst), ...Array(L - j).fill(best)]));
  const s = ROUNDING_SLACK;
  return {
    lo: Math.min(...at.map((m) => m.mean - m.sd)) - s,
    hi: Math.max(...at.map((m) => m.mean + m.sd)) + s,
    loHi: level(lost.measured, L, (m) => m.mean - m.sd, 1) + s,
    hiLo: level(lost.measured, L, (m) => m.mean + m.sd, -1) - s,
    meanLo: at[L].mean - s,
    meanHi: at[0].mean + s,
    sdHi: Math.max(...at.map((m) => m.sd)) + s,
    n: lost.measured.length + L,
  };
}

// Spec 119, A-119-2. THE OTHER EXTREMES: the highest mean minus sd and the lowest mean plus sd over
// every fill. Mean minus sd is concave and does not depend on the order of the lost scores, so the
// average of a best fill's permutations, every lost draw at one score t, is a best fill too; mean
// plus sd is convex, the same for its lowest. Each is then one concave (or convex, `sign` -1) function
// of t on the scale, read by a golden-section search over t and at both ends of the scale.
function level(measured, L, f, sign) {
  const { worst, best } = SCORE_SCALE;
  const g = (t) => sign * f(moments([...measured, ...Array(L).fill(t)]));
  const r = (Math.sqrt(5) - 1) / 2;
  let a = worst; let b = best;
  for (let i = 0; i < 80; i++) {
    const x = b - r * (b - a); const y = a + r * (b - a);
    if (g(x) < g(y)) a = x; else b = y;
  }
  return sign * Math.max(g(worst), g(best), g(a), g(b), g((a + b) / 2));
}

// caseRule's readings, each true of every fill in two envelopes (A-119-1). A separation up holds
// when the with-skill arm's lowest end clears the baseline's highest and the smallest delta
// reaches the floor; down, the other way. No separation holds when both arms have two draws, no
// delta reaches the floor, and the resolution at both arms' largest sds is under it.
const holdsUp = (w, b, floor) => w.lo > b.hi && w.meanLo - b.meanHi >= floor;
const holdsDown = (w, b, floor) => b.lo > w.hi && b.meanLo - w.meanHi >= floor;
const holdsFlat = (w, b, floor, z) => w.n >= 2 && b.n >= 2 && w.meanHi - b.meanLo < floor && b.meanHi - w.meanLo < floor
  && w.sdHi + b.sdHi + z * Math.sqrt((b.sdHi * b.sdHi) / b.n + (w.sdHi * w.sdHi) / w.n) < floor;
// A-119-2: whether some fill might separate the case down. A fill separates it down only when the
// baseline's mean minus sd is above the with-skill mean plus sd and the drop reaches the floor, so
// when the baseline's highest lower end is not above the with-skill arm's lowest upper end, or the
// largest drop is under the floor, no fill does. Otherwise one might, and a pass does not hold.
const mayDown = (w, b, floor) => !(b.loHi <= w.hiLo || b.meanHi - w.meanLo < floor);

// Spec 119, THE OPERATOR'S RULINGS OF 28 AND 29 SEP 2026: A READING MUST HOLD WHATEVER THE LOST
// DRAWS WOULD HAVE SCORED. A separation up counts toward a pass, and a separation down as a
// regression, only when it holds over both envelopes; otherwise it reads `inconclusive`. No
// separation keeps its reading only when it holds over both, and otherwise reads `underpowered`.
// An arm that cannot be bounded holds nothing. A case already underpowered on its measured draws
// stays underpowered with no draws-needed count: that arithmetic assumes no draw is lost (A-119-1).
function boundedCase(id, read, e, { floor = EFFECT_FLOOR, z = POWER_Z } = {}) {
  const lw = lostDrawsOf(e.with_skill);
  const lb = lostDrawsOf(e.baseline);
  if (!lw && !lb) return read;
  const w = envelope(e.with_skill, lw);
  const b = envelope(e.baseline, lb);
  const arm = (l) => (l ? { lost: l.lost, drawn: l.drawn, reasons: l.reasons } : null);
  const lost = { case: id, with_skill: arm(lw), baseline: arm(lb), reasons: [...new Set([...(lw ? lw.reasons : []), ...(lb ? lb.reasons : [])])] };
  const bounded = !!(w && b);
  const unheld = (state) => ({ state, reason: 'lost_draws', observed: read.state, delta: read.delta, resolution: null, drawsNeeded: null, drawsTaken: read.drawsTaken, lost, mayDown: !bounded || mayDown(w, b, floor) });
  if (read.state === 'separated-up') return bounded && holdsUp(w, b, floor) ? read : unheld('inconclusive');
  if (read.state === 'separated-down') return bounded && holdsDown(w, b, floor) ? read : unheld('inconclusive');
  if (read.state === 'not-separated') return bounded && holdsFlat(w, b, floor, z) ? read : unheld('underpowered');
  return unheld('underpowered');
}

// The total a list of lost-draw entries names, and the two ways a surface says it: the short
// form where a surface has one segment (a badge), and the full line where it has a sentence,
// each arm's counts with every reason its lost draws record (AC-4, R-5).
function lostDrawsCount(list) {
  return (list || []).reduce((n, l) => n + (l.with_skill ? l.with_skill.lost : 0) + (l.baseline ? l.baseline.lost : 0), 0);
}
function lostDrawsShort(list) {
  const k = lostDrawsCount(list);
  return `${k} ${k === 1 ? 'draw' : 'draws'} lost`;
}
function lostDrawsLine(list) {
  if (!list || !list.length) return null;
  const arm = (a, name) => (a ? `${a.lost} of ${a.drawn} ${name} ${a.drawn === 1 ? 'draw' : 'draws'} (${(a.reasons || []).join(' / ')})` : null);
  const parts = list.map((l) => `case ${l.case} lost ${[arm(l.with_skill, 'with-skill'), arm(l.baseline, 'baseline')].filter(Boolean).join(' and ')}`);
  return `Lost draws: ${parts.join('; ')}. Neither a separation nor its absence is shown to hold for every score the lost draws could have had, and a draws-needed count would assume their scores, so none is given.`;
}

// The receipt's draws needed, over its underpowered cases: no draw count when any case's
// spread alone reaches the floor, else the largest count, else two per arm when a case
// had a single draw.
function receiptDrawsNeeded(cases) {
  const u = cases.filter((c) => c.state === 'underpowered');
  if (!u.length) return null;
  // Spec 119: an underpowered case with lost draws has no count, and it is named first: the
  // counts below assume no draw is lost.
  const lost = u.filter((c) => c.reason === 'lost_draws');
  if (lost.length) return { value: null, reason: 'lost_draws', case: lost[0].id, lost: lost.map((c) => c.lost), taken: lost[0].drawsTaken };
  const spread = u.find((c) => c.reason === 'spread');
  if (spread) return { value: null, reason: 'spread', case: spread.id, spread: spread.spread, taken: spread.drawsTaken };
  const draws = u.filter((c) => c.reason === 'draws').sort((x, y) => y.drawsNeeded - x.drawsNeeded)[0];
  if (draws) return { value: draws.drawsNeeded, reason: 'draws', case: draws.id, taken: draws.drawsTaken };
  return { value: 2, reason: 'single_draw', case: u[0].id, taken: u[0].drawsTaken };
}

// Spec 036 A-036-2: the draws a receipt actually took, read WITHOUT the four refusals
// receiptVerdict applies. A NOT_MEASURED receipt still holds draws, and the badge is
// owed them: the refusals say the receipt carries no verdict, not that it carries no
// draws. The figure is the smallest binding arm over the receipt's readable cases, so
// it is the count that would have to grow. Null when no case has two readable arms.
function receiptDrawsTaken(receipt) {
  const byId = new Map();
  for (const c of (receipt && receipt.results && receipt.results.cases) || []) {
    if (c.case_status && c.case_status !== 'ok') continue;
    const e = byId.get(c.id) || {};
    e[c.mode] = c;
    byId.set(c.id, e);
  }
  let taken = null;
  for (const [, e] of byId) {
    const w = armOf(e.with_skill);
    const b = armOf(e.baseline);
    if (!w || !b) continue;
    const n = Math.min(w.n, b.n);
    taken = taken === null ? n : Math.min(taken, n);
  }
  return taken;
}

// The one sentence that says it, for every surface that prints the draws needed.
function drawsLine(d) {
  if (!d) return null;
  if (d.reason === 'lost_draws') return lostDrawsLine(d.lost);
  if (d.reason === 'spread') return `Draws needed: no draw count at these spreads (case ${d.case}: the two arms' spreads sum to ${Number(d.spread).toFixed(3)}, at or above the ${EFFECT_FLOOR} floor).`;
  if (d.reason === 'single_draw') return `Draws needed: at least 2 draws per arm to measure a spread (case ${d.case} has one).`;
  return `Draws needed: ${d.value} draws per arm (case ${d.case}), with the spreads held.`;
}

// Spec 036 A-036-4: the five routes into NOT_MEASURED, as tokens. Four are R-5's refusals
// and the fifth is A-036-3's rung, which is reachable only once all four have cleared. The
// order is the order receiptVerdict tests them, and it is the order a surface states them in.
const NOT_MEASURED_ROUTES = ['below_tested', 'no_answered_by', 'no_numeric_lift', 'incomplete', 'no_readable_case'];

// Every refusal that fired, not the first. A receipt can be silent about what answered it AND
// mark its run incomplete, and a sentence that names one of those while the other is equally
// true is thinner than the receipt, which is the direction this reader refuses to go.
function notMeasuredRoutes(level, kind, delta, incomplete) {
  const r = [];
  if (level !== 'TESTED') r.push('below_tested');
  if (kind !== 'model') r.push('no_answered_by');
  if (typeof delta !== 'number') r.push('no_numeric_lift');
  if (incomplete) r.push('incomplete');
  return r;
}

// R-5, all four refusals, read off spec 035 spec.md and identical to the rule
// lib/decision.js states. An absent field satisfies "not TESTED" and "not model":
// a receipt that does not say is not taken to have said the reassuring thing.
function receiptVerdict(receipt) {
  // Spec 050 AC-3: refused before anything is read, whatever the level. An existing
  // receipt written before the loader refused duplicate ids reaches here unchanged,
  // and a surface that caught nothing must not render a verdict for it.
  const dups = duplicateCaseRows(receipt);
  if (dups.length) throw new AmbiguousReceiptError(dups);
  const cmp = (receipt && receipt.comparison) || {};
  // Below-TESTED receipts (imported/DECLARED) and null-delta receipts are never
  // verdicted — we did not run the suite, so we do not certify the outcome.
  const level = receipt && receipt.verification_level;
  // Spec 026 AC-1 made a stub receipt unable to claim TESTED, and v0.6 made a
  // TESTED receipt say what answered it. A receipt answered by a tool, a stub or
  // anything that is not a model has not measured a model, so its numbers are
  // recorded rather than verified and the badge says so.
  const kind = receipt && receipt.run && receipt.run.answered_by ? receipt.run.answered_by.kind : undefined;
  // Spec 026 AC-4: an INCOMPLETE receipt (its run block's status field reads
  // incomplete: a case had an arm that could not be measured) is not verdicted
  // either. spec/RECEIPT.md has said since v0.3.1 that a drift report must not
  // compute a verdict from one; the badge is the same reader with a shorter path.
  //
  // Spec 062 (register row 4): a receipt that ran fewer cases than its suite holds is incomplete
  // too, by the same route. Its suite_hash names the whole suite, so a verdict read off it would
  // be a verdict on cases that were never run.
  const incomplete = !!(receipt && receipt.run && receipt.run.status === 'incomplete') || suiteNarrowed(receipt);
  // Spec 036 A-036-4: WHICH REFUSAL FIRED. The guard below is one line and says only that
  // some refusal did; a surface that renders NOT_MEASURED in words owes its reader the one
  // that actually fired, and cannot get it from a boolean. `notMeasuredRoutes` names the same
  // four conditions as tokens, in the order they are tested, and carries EVERY route that
  // fired rather than the first: two can fire at once, and 2 of the 120 archived receipts
  // are exactly that case (absent answered_by and an incomplete run).
  //
  // The guard is written out in full beside it rather than as `routes.length` so that the
  // four conditions stay one readable line. The two therefore state the same rule twice, and
  // the drift that invites is held by AC-8's row, which reads the shipped routes against an
  // oracle that transcribes them independently, over the archive, the five state fixtures and
  // the rung edges. A guard and a route list that disagree read RED there.
  const routes = notMeasuredRoutes(level, kind, cmp.delta, incomplete);
  if (level !== 'TESTED' || kind !== 'model' || typeof cmp.delta !== 'number' || incomplete) return { verdict: 'NOT_MEASURED', cases: [], drawsNeeded: null, notMeasured: routes };
  const cases = readCases(receipt);
  // Spec 036 A-036-3, THE RUNG R-5 NEVER HAD. R-5 reads its ladder off the cases, and
  // every rung below REGRESSED is a statement about what the cases showed. NO_EFFECT is
  // the bottom rung and it is a MEASUREMENT: "no separation detected at this sample size".
  // A receipt whose every case was dropped -- case_status not ok, or an arm with no
  // readable band -- reaches that rung with an EMPTY cases array, so each has() is false
  // and the ladder fell through to NO_EFFECT. Nothing was measured, so the reassuring
  // reading was the one a silent receipt got, which is the exact failure the four
  // refusals above exist to prevent: a receipt that does not say is not taken to have
  // said the reassuring thing. Zero readable cases is NOT_MEASURED, and it is checked
  // BEFORE the ladder so no rung can be reached on no evidence.
  if (!cases.length) return { verdict: 'NOT_MEASURED', cases: [], drawsNeeded: null, notMeasured: ['no_readable_case'] };
  const has = (s) => cases.some((c) => c.state === s);
  // Spec 119, THE INCONCLUSIVE RUNG. A regression not shown to hold for every score the lost
  // draws could have had blocks a pass: the pass would be one the lost draws could overturn.
  // A-119-2, THE RECEIPT'S VERDICT HOLDS AT EVERY JOINT SCORE OF ITS LOST DRAWS. Cases do not share
  // lost draws, and a pass stands at a joint fill unless some case separates down there, so a pass
  // holds exactly when no case's own fills can separate it down: a case the bound did not keep,
  // whose lost draws might at some score separate it down (`mayDown`), blocks a pass. A case that
  // can only fail to separate up leaves standing a pass another case holds. A regression a case
  // holds is the top rung at every fill, and no effect already holds case by case, so neither needs
  // a rule here. The lost draws are named, on `lostDraws`, only where they are why the verdict is
  // what it is; a verdict that holds needs no such reason.
  const lostDown = cases.some((c) => c.state === 'inconclusive' && c.observed === 'separated-down');
  const mayRegress = cases.some((c) => c.mayDown);
  const verdict = has('separated-down') ? 'REGRESSED' : lostDown ? 'INCONCLUSIVE' : has('separated-up') ? (mayRegress ? 'INCONCLUSIVE' : 'PASSED')
    : has('inconclusive') ? 'INCONCLUSIVE' : has('underpowered') ? 'UNDERPOWERED' : 'NO_EFFECT';
  const lostDraws = cases.filter((c) => c.reason === 'lost_draws'
    && ((verdict === 'INCONCLUSIVE' && (c.state === 'inconclusive' || c.mayDown)) || (verdict === 'UNDERPOWERED' && c.state === 'underpowered'))).map((c) => c.lost);
  return { verdict, cases, drawsNeeded: verdict === 'UNDERPOWERED' ? receiptDrawsNeeded(cases) : null, notMeasured: null, ...(lostDraws.length ? { lostDraws } : {}) };
}

// R-1 to R-4 over every readable case of a receipt, with none of R-5's refusals applied: a case
// with a failed arm, or an arm with no readable band, is left out. receiptVerdict reads its ladder
// off this list; lib/decision.js reads it BEFORE the incomplete rule (spec 062, register row 1),
// because a case that was measured and separated down is a measured regression however many other
// cases went unmeasured.
function readCases(receipt) {
  const dups = duplicateCaseRows(receipt);
  if (dups.length) throw new AmbiguousReceiptError(dups);
  const byId = new Map();
  for (const c of (receipt && receipt.results && receipt.results.cases) || []) {
    if (c.case_status && c.case_status !== 'ok') continue;
    const e = byId.get(c.id) || {};
    e[c.mode] = c;
    byId.set(c.id, e);
  }
  const cases = [];
  for (const [id, e] of byId) {
    const w = armOf(e.with_skill);
    const b = armOf(e.baseline);
    if (!w || !b) continue;
    cases.push({ id, ...boundedCase(id, caseRule(b, w), e) });
  }
  return cases;
}

// Derive the verdict object from a receipt. Returns
//   { verdict, delta, floor, model, message, color, drawsNeeded[, lostDraws] }
// Spec 119: where lost draws are why the verdict is what it is, the message says how many.
function verdictFromReceipt(receipt) {
  const cmp = (receipt && receipt.comparison) || {};
  const delta = typeof cmp.delta === 'number' ? cmp.delta : 0;
  const model = shortModel(receipt && receipt.run && receipt.run.model_id);
  const v = receiptVerdict(receipt);
  const meta = VERDICTS[v.verdict];
  return {
    verdict: v.verdict,
    delta,
    floor: EFFECT_FLOOR,
    model,
    message: `${meta.word} on ${model}${v.lostDraws ? ` (${lostDrawsShort(v.lostDraws)})` : ''}`,
    color: meta.color,
    drawsNeeded: v.drawsNeeded,
    ...(v.lostDraws ? { lostDraws: v.lostDraws } : {}),
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
//
// Spec 023 (audit A6). Each entry is written in GitHub's multiline form,
//
//   name<<ghadelim_<32 hex>
//   value
//   ghadelim_<32 hex>
//
// with a delimiter drawn fresh from crypto.randomBytes for EVERY entry, so no
// value can close a block early; and any value carrying \r or \n is refused
// with a throw before anything is written. The bare `name=value` form this used
// to emit let a model_id with a newline in it (any string a receipt carries; a
// .driftproofrc in a skill directory sets it) append a second, attacker-chosen
// entry, and that entry was then interpolated into the enforce step's shell.
// Refusing is the honest writer: a line break in a model id is not a value
// anybody meant to publish. Entries are joined by '\n' with no trailing newline
// so the caller's console.log stays the one that terminates the text.
function githubOutputEntry(name, value) {
  const val = String(value);
  if (/[\r\n]/.test(val)) {
    throw new Error(`refusing to write $GITHUB_OUTPUT: the value of "${name}" contains a line break (${JSON.stringify(val)})`);
  }
  const delim = `ghadelim_${crypto.randomBytes(16).toString('hex')}`;
  return `${name}<<${delim}\n${val}\n${delim}`;
}

// Spec 119: `lost_draws` follows the four, only when lost draws are why the verdict is what
// it is, so a receipt without them writes the four entries it always wrote.
function githubOutputLines(receipt) {
  const v = verdictFromReceipt(receipt);
  return [
    ['verdict', v.verdict],
    ['delta', v.delta],
    ['message', v.message],
    ['color', v.color],
    ...(v.lostDraws ? [['lost_draws', lostDrawsLine(v.lostDraws)]] : []),
  ].map(([k, val]) => githubOutputEntry(k, val)).join('\n');
}

module.exports = {
  verdictFromReceipt, badgeEndpoint, githubOutputLines, githubOutputEntry, shortModel, VERDICTS,
  receiptVerdict, readCases, caseRule, armOf, drawsLine, receiptDrawsTaken, UNDERPOWERED_LINE, NOT_MEASURED_ROUTES,
  AmbiguousReceiptError, lostDrawsOf, lostDrawsLine, lostDrawsShort, lostDrawsCount,
};
