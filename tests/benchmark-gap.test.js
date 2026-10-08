// SPDX-License-Identifier: Apache-2.0
'use strict';
// tests/benchmark-gap.test.js - the benchmark gap calculator's numeric check (spec 167).
//
// Three checks, each against the frozen protocol of R-9's leaderboard-noise METHOD.md: the hand
// sanity pair, ten rows taken from R-9's own results.csv (tests/fixtures/benchmark-gap/
// results-sample.csv; every number as R-9 wrote it, the model, source and URL columns replaced by
// neutral labels because R-9's results are unpublished), and the published minimum-gap table.
//
//   node --test tests/benchmark-gap.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gap = require('../docs/benchmark-gap/gap.js');

function closeTo(actual, expected, delta, msg) {
  assert.ok(Math.abs(actual - expected) <= delta, `${msg}: got ${actual}, expected ${expected} (delta ${Math.abs(actual - expected)} > ${delta})`);
}

test('hand sanity check: 50 of 100', () => {
  const [lo, hi] = gap.wilsonInterval(0.5, 100);
  closeTo(lo, 0.4038315303659956, 1e-12, 'lower');
  closeTo(hi, 0.5961684696340044, 1e-12, 'upper');
});

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split('\n');
  const headers = headerLine.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

test("R-9's fixture rows match to 1e-9", () => {
  const csvPath = path.join(__dirname, 'fixtures', 'benchmark-gap', 'results-sample.csv');
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  assert.equal(rows.length, 10, 'ten fixture rows');

  for (const row of rows) {
    const N = Number(row.N);
    const pA = Number(row.score_A);
    const pB = Number(row.score_B);

    const [loA, hiA] = gap.wilsonInterval(pA, N);
    const [loB, hiB] = gap.wilsonInterval(pB, N);
    closeTo(loA, Number(row.wilson_lower_A), 1e-9, `${row.comparison_id} wilson_lower_A`);
    closeTo(hiA, Number(row.wilson_upper_A), 1e-9, `${row.comparison_id} wilson_upper_A`);
    closeTo(loB, Number(row.wilson_lower_B), 1e-9, `${row.comparison_id} wilson_lower_B`);
    closeTo(hiB, Number(row.wilson_upper_B), 1e-9, `${row.comparison_id} wilson_upper_B`);

    const [dLo, dHi] = gap.newcombeDiff(pA, N, pB, N);
    closeTo(dLo, Number(row.item_lower), 1e-9, `${row.comparison_id} item_lower`);
    closeTo(dHi, Number(row.item_upper), 1e-9, `${row.comparison_id} item_upper`);

    const verdict = gap.verdictOf(dLo, dHi);
    assert.equal(verdict, row.item_noise_verdict, `${row.comparison_id} item_noise_verdict`);

    const minGapQ = gap.minimumGapQuestions(N);
    assert.equal(minGapQ, Number(row.minimum_gap_questions), `${row.comparison_id} minimum_gap_questions`);
    closeTo(minGapQ / N, Number(row.minimum_gap), 1e-9, `${row.comparison_id} minimum_gap`);

    const gapQuestions = Math.round(Math.abs(pA - pB) * N);
    const below = gapQuestions < minGapQ;
    assert.equal(below ? 'True' : 'False', row.below_minimum_gap, `${row.comparison_id} below_minimum_gap`);
  }
});

test('the minimum-gap rule reproduces the published table', () => {
  const table = { 30: 8, 66: 12, 100: 14, 198: 20, 225: 21, 300: 24, 500: 31, 642: 36, 2294: 67, 2500: 70, 12032: 153 };
  for (const [n, expected] of Object.entries(table)) {
    assert.equal(gap.minimumGapQuestions(Number(n)), expected, `minimum gap at N=${n}`);
  }
});

test('tab 2: the repeated-runs band rule', () => {
  assert.equal(gap.runsVerdict({ mean: 0.8, sd: 0.02, runs: 3 }, { mean: 0.5, sd: 0.02, runs: 3 }), gap.SEPARATED);
  assert.equal(gap.runsVerdict({ mean: 0.8, sd: 0.1, runs: 3 }, { mean: 0.75, sd: 0.1, runs: 3 }), gap.NO_SEPARATION);
  assert.equal(gap.runsVerdict({ mean: 0.8, sd: 0, runs: 1 }, { mean: 0.5, sd: 0.02, runs: 3 }), gap.NOT_ENOUGH_DRAWS);
  assert.equal(gap.runsVerdict({ mean: 0.8, sd: 0.02, runs: 3 }, { mean: 0.5, sd: 0, runs: 1 }), gap.NOT_ENOUGH_DRAWS);
});

test('the required-questions search resumes from the last k and gives the same answer as a search from 1', () => {
  // A search from k = 1 at every N, the form the page used before the review's F-5, written out here.
  const fromOne = (g) => {
    for (let n = 2; n <= 100000; n++) {
      const k = gap.minimumGapQuestions(n);
      if (k !== null && k / n <= g) return n;
    }
    return null;
  };
  for (const g of [0.5, 0.2, 0.1, 0.05, 0.03, 0.02, 0.01, 0.005, 0.0015, 0.0005]) {
    assert.equal(gap.requiredQuestionsForGap(g), fromOne(g), `gap ${g}`);
  }
  // The non-decreasing k the resumed search relies on, at every N up to the limit.
  let prev = 0;
  for (let n = 2; n <= 100000; n++) {
    const k = gap.minimumGapQuestions(n);
    assert.ok(k !== null && k >= prev, `k falls or is missing at N = ${n}`);
    prev = k;
  }
});
