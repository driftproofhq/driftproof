// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyReceiptHash } = require('../lib/receipt');
const receipt = require('../receipts/report-016/receipt-15f01115639f.json');

test('site plots exclude judge-only cases from the sealed primary arm summaries (issue 528)', async () => {
  const { cellOf, renderCell, SIZES } = await import('../scripts/band-plot.mjs');
  assert.equal(verifyReceiptHash(receipt), true);
  assert.deepEqual(receipt.run.scoring.judge_only_case_ids, ['result-type-typescript']);
  const cell = cellOf(receipt);
  for (const [mode, key, label] of [
    ['baseline', 'baseline', 'Without the skill'],
    ['with_skill', 'skill', 'With the skill'],
  ]) {
    const expected = receipt.results.aggregates[mode];
    const actual = cell[key];
    assert.equal(actual.n, expected.case_count);
    assert.equal(actual.mean.toFixed(3), expected.mean_score.toFixed(3));
    assert.equal(actual.sd.toFixed(3), expected.stddev.toFixed(3));
    for (const size of Object.keys(SIZES)) {
      const svg = renderCell(cell, { size });
      assert.ok(svg.includes(label + ', ' + expected.mean_score.toFixed(3)
        + ' plus or minus ' + expected.stddev.toFixed(3) + '.'), size + ' accessible values');
      assert.ok(svg.includes('>' + expected.mean_score.toFixed(3) + '</text>'), size + ' printed mean');
    }
  }
});
