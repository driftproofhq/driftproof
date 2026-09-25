// SPDX-License-Identifier: Apache-2.0
'use strict';

const crypto = require('crypto');
const { EFFECT_FLOOR, POWER_Z } = require('../config');
const { bandOf } = require('./reuse');
const { duplicateCaseRows, ambiguityLine } = require('./receipt');

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

// The receipt's draws needed, over its underpowered cases: no draw count when any case's
// spread alone reaches the floor, else the largest count, else two per arm when a case
// had a single draw.
function receiptDrawsNeeded(cases) {
  const u = cases.filter((c) => c.state === 'underpowered');
  if (!u.length) return null;
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
  const incomplete = !!(receipt && receipt.run && receipt.run.status === 'incomplete');
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
  const byId = new Map();
  for (const c of (receipt.results && receipt.results.cases) || []) {
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
    cases.push({ id, ...caseRule(b, w) });
  }
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
  const verdict = has('separated-down') ? 'REGRESSED' : has('separated-up') ? 'PASSED' : has('underpowered') ? 'UNDERPOWERED' : 'NO_EFFECT';
  return { verdict, cases, drawsNeeded: verdict === 'UNDERPOWERED' ? receiptDrawsNeeded(cases) : null, notMeasured: null };
}

// Derive the verdict object from a receipt. Returns
//   { verdict, delta, floor, model, message, color, drawsNeeded }
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
    message: `${meta.word} on ${model}`,
    color: meta.color,
    drawsNeeded: v.drawsNeeded,
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

function githubOutputLines(receipt) {
  const v = verdictFromReceipt(receipt);
  return [
    ['verdict', v.verdict],
    ['delta', v.delta],
    ['message', v.message],
    ['color', v.color],
  ].map(([k, val]) => githubOutputEntry(k, val)).join('\n');
}

module.exports = {
  verdictFromReceipt, badgeEndpoint, githubOutputLines, githubOutputEntry, shortModel, VERDICTS,
  receiptVerdict, caseRule, armOf, drawsLine, receiptDrawsTaken, UNDERPOWERED_LINE, NOT_MEASURED_ROUTES,
  AmbiguousReceiptError,
};
