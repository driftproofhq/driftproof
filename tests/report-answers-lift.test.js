// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 134 A-134-6: a report body that counts each model's own result across the runs
// (Report 014's `data-fn="lift-verdict"` elements) keeps spec 125's hand-written summary, because the
// answers-first rule reads one receipt per sentence and would lead with the latest run alone.
//
//   node --test tests/report-answers-lift.test.js
//
// The body is Report 014's own page; the second test changes only the element's function name, so the
// same page is then read from its receipts as any other report's would be.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { answersFor } = require('../scripts/report-answers');

const ROOT = path.join(__dirname, '..');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reports = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'reports.json'), 'utf8'));
const rows = Array.isArray(reports) ? reports : reports.reports;
const row = rows.find((r) => String(r.number.value) === '014');
const page = fs.readFileSync(path.join(ROOT, 'docs', 'reports', '014', 'index.html'), 'utf8');

test('Report 014 carries lift-verdict elements', () => {
  assert.ok(row, 'docs/data/reports.json has a row for Report 014');
  assert.match(page, /data-fn="lift-verdict"/);
});

test('a body with lift-verdict elements keeps the summary row: no answers are read from one receipt', () => {
  assert.equal(answersFor(row, page, { esc, root: ROOT }), null);
});

test('the same body with the element renamed is read from its receipts', () => {
  const renamed = page.replace(/data-fn="lift-verdict"/g, 'data-fn="v"');
  assert.notEqual(answersFor(row, renamed, { esc, root: ROOT }), null);
});
