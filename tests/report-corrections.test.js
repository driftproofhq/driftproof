// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for scripts/report-corrections.js (spec 161): the three judge cost totals, the stop when a
// computed value differs from the operator's, the pages that take the note, and the exact reading of
// what the script inserts.
//
//   node --test tests/report-corrections.test.js
//
// Each expected value below is typed from the operator's three values of 3 Oct 2026 or read from lib/verdict.js,
// the badge's own rule. None is computed by the script under test.
//
// Every test name starts with the criterion it checks; spec 161's gate runs the file whole.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const rc = require('../scripts/report-corrections.js');
const { receiptVerdict } = require('../lib/verdict.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CELLS = [
  { receipt: 'receipts/report-007/code-review-and-quality-claude-fable-5-2026-08-31.json', model: 'claude-fable-5' },
  { receipt: 'receipts/report-007/git-workflow-and-versioning-claude-sonnet-5-2026-08-31.json', model: 'claude-sonnet-5' },
  { receipt: 'receipts/report-007-rerun/writing-plans-claude-fable-5-2026-08-31.json', model: 'claude-fable-5' },
];

test('AC-7 the totals computed from the draws are the operator\'s three values, and the published figures are the page\'s', () => {
  const got = rc.cells007(CELLS, 'claude-haiku-4-5');
  assert.deepEqual(got.map((c) => c.corrected), ['8.047195', '7.634930', '13.737220']);
  assert.deepEqual(got.map((c) => c.published), ['2.601445', '2.313420', '3.253265']);
  assert.deepEqual(got.map((c) => c.rows), [14, 14, 14]);
});

test('AC-7 a computed total that differs from the operator\'s stops the script and prints neither value', () => {
  const was = rc.EXPECTED['writing-plans'];
  rc.EXPECTED['writing-plans'] = '13.737221';
  try {
    assert.throws(() => rc.cells007(CELLS, 'claude-haiku-4-5'), (e) => /computes to 13\.737220/.test(e.message) && /13\.737221/.test(e.message) && /neither is printed/.test(e.message));
  } finally {
    rc.EXPECTED['writing-plans'] = was;
  }
  assert.equal(rc.EXPECTED['writing-plans'], '13.737220');
});

test('AC-7 Report 006 takes no note, and a page that links a receipt the badge reads as measured takes none', () => {
  assert.throws(() => rc.checkNote('006', read('docs/reports/006/index.html')), /takes no note/);
  const measured = fs.readdirSync(path.join(ROOT, 'receipts', 'report-009')).map((f) => `receipts/report-009/${f}`)
    .find((f) => f.endsWith('.json') && receiptVerdict(JSON.parse(read(f))).verdict !== 'NOT_MEASURED');
  assert.ok(measured, 'the tree holds a receipt the badge reads as measured');
  const page = `<a href="https://github.com/driftproofhq/driftproof/blob/main/${measured}">r</a>`;
  assert.throws(() => rc.checkNote('003', page), /do not all read Not measured/);
});

test('AC-7 the pages that take the note are the table\'s, each linking only receipts the badge reads as Not measured', () => {
  assert.deepEqual(rc.NOTE_ON, ['001', '002', '003', '004', '005', '007', '008']);
  for (const n of rc.NOTE_ON) {
    const r = rc.badgeReadings(read(`docs/reports/${n}/index.html`));
    assert.ok(r.files.length > 0, `Report ${n} links receipts`);
    assert.deepEqual(Object.keys(r.tally), ['NOT_MEASURED'], `Report ${n}`);
  }
});

test('AC-7 applying the script to a page that carries its lines changes nothing, and refuses a page that carries some of them', () => {
  const p003 = read('docs/reports/003/index.html');
  assert.equal(rc.applyToPage(p003, '003'), p003);
  const half = p003.replace(/ *<div class="card" id="amendment-interim-note">\n    <p>[^\n]*<\/p>\n  <\/div>\n\n/, '');
  assert.notEqual(half, p003);
  assert.throws(() => rc.applyToPage(half, '003'), /carries part of the notes/);
});

test('AC-7 stripInterimLines takes out exactly the script\'s bytes: a page with its lines put back is the page, and a note with one word changed stays', () => {
  const p003 = read('docs/reports/003/index.html');
  const bare = rc.stripInterimLines(p003, '003');
  assert.notEqual(bare, p003);
  assert.ok(!bare.includes('interim-note'));
  assert.equal(rc.applyToPage(bare, '003'), p003);
  const tweaked = p003.replace('Corrected counts follow', 'Corrected counts will follow');
  assert.equal(rc.stripInterimLines(tweaked, '003'), tweaked);
  assert.equal(rc.stripInterimLines(read('docs/reports/006/index.html'), '006'), read('docs/reports/006/index.html'));
});
