// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 137 AC-7: a receipt whose comparison band reaches the effect floor does not
// read NO_EFFECT. The receipts are built in memory, draw by draw, through lib/sampling.js
// acrossDraws and sealed with lib/receipt.js, as tests/plain.test.js builds them; the band each
// carries is the one lib/receipt.js comparisonOf would record (the quadrature sum of the two arms'
// sample sds of the per-case means), computed here from lib/stats.js. No floor is typed: it is read
// from config.js.
//
//   node --test tests/verdict-band.test.js
//
// Every test name starts with the criterion it checks; spec 137's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EFFECT_FLOOR } = require('../config');
const { receiptVerdict, verdictFromReceipt, drawsLine, CASES_LINE } = require('../lib/verdict');
const { acrossDraws } = require('../lib/sampling');
const { sealReceipt } = require('../lib/receipt');
const { stddev, combineUncertainty, round } = require('../lib/stats');
const decision = require('../lib/decision');
const plain = require('../lib/plain');
const { badgeSvg } = require('../lib/badge-svg');

const LOST = null;
// One arm of one case: each draw judged `samples` times, every sample the draw's score.
function arm(id, mode, scores, samples = 2) {
  const draws = scores.map((x, i) => (x === LOST
    ? { draw_index: i, status: 'unmeasured', reason: 'timeout', samples: [], mean: null, stddev: null }
    : { draw_index: i, status: 'measured', samples: Array(samples).fill(x), mean: x, stddev: 0 }));
  const a = acrossDraws(draws);
  return { id, mode, mean: a.mean, stddev: a.sd, generation: { draws, n_drawn: a.n_drawn, n_measured: a.n_measured, n_unmeasured: a.n_unmeasured, mean: a.mean, sd: a.sd } };
}
// A receipt of cases, each [with-skill scores, baseline scores].
function receipt(cases) {
  const rows = cases.flatMap(([w, b], i) => [arm(`c${i + 1}`, 'with_skill', w), arm(`c${i + 1}`, 'baseline', b)]);
  const means = (mode) => rows.filter((r) => r.mode === mode).map((r) => r.mean);
  const mw = means('with_skill'); const mb = means('baseline');
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = (xs) => (xs.length < 2 ? null : round(stddev(xs)));
  const comparison = { with_skill_score: round(avg(mw)), baseline_score: round(avg(mb)), delta: round(avg(mw) - avg(mb)), delta_uncertainty: cases.length < 2 ? null : combineUncertainty(sd(mw), sd(mb)) };
  if (cases.length < 2) comparison.delta_uncertainty_unavailable = 'single_case';
  return sealReceipt({
    verification_level: 'TESTED',
    skill: { name: 'fx-skill' },
    suite: { case_count: cases.length },
    run: { model_id: 'fx-model', date_utc: '2026-10-01T00:00:00Z', answered_by: { kind: 'model' }, judge: { samples: 2 } },
    results: { cases: rows },
    comparison,
  });
}

// The operator's shape: 3 cases, 3 draws an arm (the runner's minimum), 2 judge samples a draw. Each
// case's two arms agree, and the cases sit far apart. Spec 143 (A-137-6): every draw of a case scores
// the same, so the whole band is the cases sitting apart, and it reads the cases words.
const WIDE = [[[0.3, 0.3, 0.3], [0.3, 0.3, 0.3]], [[0.6, 0.6, 0.6], [0.6, 0.6, 0.6]], [[0.72, 0.72, 0.72], [0.72, 0.72, 0.72]]];

test('AC-7 a band of plus or minus 0.30 from 3 cases and 2 samples reads underpowered, more cases needed, not NO_EFFECT', () => {
  const r = receipt(WIDE);
  assert.ok(r.comparison.delta_uncertainty >= 0.3, `the fixture's band is ${r.comparison.delta_uncertainty}`);
  const v = receiptVerdict(r);
  assert.equal(v.verdict, 'UNDERPOWERED');
  assert.deepEqual({ ...v.drawsNeeded, band: undefined }, { value: null, reason: 'suite_band', band: undefined, cases: 3, widened: false, taken: 3, between: v.drawsNeeded.band, driver: 'cases' });
  assert.ok(Math.abs(v.drawsNeeded.band - r.comparison.delta_uncertainty) < 1e-5, 'the band read is not the band the receipt records');
  const b = r.comparison.delta_uncertainty.toFixed(3);
  assert.equal(drawsLine(v.drawsNeeded), `Draws needed: none is expected to bring this band under the floor (the comparison band over the 3 cases is plus or minus ${b}; with each case's draw-to-draw spread taken out it is plus or minus ${b}, still at or above the ${EFFECT_FLOOR} floor).`);
});

test('AC-7 every surface says it: the badge, decide, and the plain sentence', () => {
  const r = receipt(WIDE);
  assert.equal(verdictFromReceipt(r).message, 'more cases needed on fx-model');
  assert.equal(decision.decisionState(r), 'underpowered');
  const p = plain.plainOf(r);
  assert.equal(p.label, plain.LABELS.UNDERPOWERED_CASES);
  assert.ok(p.sentence.includes('but the test tasks scored too far apart from each other to call it'), p.sentence);
  assert.ok(p.detail.startsWith(`${CASES_LINE}.`), p.detail);
  assert.match(badgeSvg(r), /3 draws, no count at this band/);
});

test('AC-7 a narrow band still reads NO_EFFECT, and a one-case receipt reads as it did', () => {
  const narrow = receipt([[[0.8, 0.8, 0.81], [0.8, 0.81, 0.8]], [[0.82, 0.82, 0.82], [0.82, 0.82, 0.82]], [[0.81, 0.81, 0.81], [0.81, 0.81, 0.81]]]);
  assert.ok(narrow.comparison.delta_uncertainty < EFFECT_FLOOR);
  assert.equal(receiptVerdict(narrow).verdict, 'NO_EFFECT');
  // One case forms no band: unchanged here, and left for the operator (VERDICT-MOVES.md).
  assert.equal(receiptVerdict(receipt([WIDE[0]])).verdict, 'NO_EFFECT');
});

test('AC-7 the rung turns at the floor: a band just over it reads underpowered, one just under it NO_EFFECT', () => {
  // Two cases whose means sit one gap g apart in each arm: each arm's sd is g / sqrt(2), so the band
  // is g. Read either side of the floor.
  const f = EFFECT_FLOOR;
  const at = (g) => receipt([[[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]], [[0.5 + g, 0.5 + g, 0.5 + g], [0.5 + g, 0.5 + g, 0.5 + g]]]);
  const over = at(f + 0.0005); const under = at(f - 0.0005);
  assert.ok(over.comparison.delta_uncertainty >= f && under.comparison.delta_uncertainty < f);
  assert.equal(receiptVerdict(over).verdict, 'UNDERPOWERED');
  assert.equal(receiptVerdict(under).verdict, 'NO_EFFECT');
});

test('AC-7 lost draws widen the band: a band under the floor on the survivors that some score of the lost draws could take over it reads underpowered', () => {
  // Two cases, each arm's two case means one gap g apart, so the band is g, just under the floor.
  // Case 1's with-skill arm draws 600 times and loses one, so spec 119 keeps its no-separation
  // reading (its envelope is narrow), and the lost draw can move that arm's mean by about 1/601.
  // Widened by that, the band reaches the floor.
  const g = EFFECT_FLOOR - 0.0005;
  const many = (x, n) => Array(n).fill(x);
  const base = [[many(0.8, 600), many(0.8, 600)], [many(0.8 + g, 600), many(0.8 + g, 600)]];
  const held = receipt(base);
  assert.ok(held.comparison.delta_uncertainty < EFFECT_FLOOR, String(held.comparison.delta_uncertainty));
  assert.equal(receiptVerdict(held).verdict, 'NO_EFFECT');
  const lost = receipt([[[...many(0.8, 600), LOST], many(0.8, 600)], base[1]]);
  assert.ok(lost.comparison.delta_uncertainty < EFFECT_FLOOR);
  const v = receiptVerdict(lost);
  assert.ok(v.cases.every((c) => c.state === 'not-separated'), JSON.stringify(v.cases.map((c) => c.state)));
  assert.equal(v.verdict, 'UNDERPOWERED');
  assert.equal(v.drawsNeeded.reason, 'suite_band');
  assert.equal(v.drawsNeeded.widened, true);
  assert.match(drawsLine(v.drawsNeeded), /at most, over every score the lost draws could have had/);
});
