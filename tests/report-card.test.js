// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 667: a report card states what moved once (spec 020 AC-18, amendment 13). The separate
// card-moved line appears exactly where the title's tail is not the row's what_moved, and says
// what moved; where the title already says it, there is no line. Read on the tracked reports index
// and homepage, and on the exported reportCard in both of its calling forms. Spec 020's own
// reading runs on the box only, which is how Report 017's card lost the line after issue 652.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tokenize, attrOf, htmlToText } = require('../scripts/html-text.js');
const { reportCard, reportName, HOME_CARD_STAT } = require('../scripts/build-site-pages.js');
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const reports = JSON.parse(read('docs/data/reports.json')).reports;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const textOf = (html) => htmlToText(html, { skip: ['script', 'style'], collapse: true,
  decode: (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ENTITIES[k]) });

// The elements named `name` whose start tag `matches`, each with its HTML, by the tokenizer.
function elements(html, name, matches = () => true) {
  const found = [];
  let current = null;
  let depth = 0;
  for (const t of tokenize(html)) {
    if (current) {
      current.html += t.type === 'text' ? t.text : t.raw;
      if (t.name === name && t.type === 'start') depth++;
      if (t.name === name && t.type === 'end' && --depth === 0) { found.push(current); current = null; }
    } else if (t.type === 'start' && t.name === name && matches(t)) {
      current = { tag: t, html: t.raw };
      depth = 1;
    }
  }
  return found;
}
const hasClass = (name) => (t) => (attrOf(t, 'class') || '').split(/\s+/).includes(name);
const cardsOf = (html) => elements(html, 'article', hasClass('report-card'));
const titleTail = (card) => {
  const headings = elements(card, 'h3');
  assert.equal(headings.length, 1, 'one card title');
  return textOf(headings[0].html).replace(/^Report\s+\d+:\s*/, '');
};
// The reading: no line where the title's tail is what moved; one line, saying it, where it is not.
function assertMovedOnce(card, row) {
  const lines = elements(card, 'p', hasClass('card-moved')).map((e) => textOf(e.html));
  const expected = titleTail(card) === row.what_moved.value ? [] : [`What moved: ${row.what_moved.value}`];
  assert.deepEqual(lines, expected, `report ${row.number.value}: what moved once`);
}
function assertPage(html, rows) {
  const cards = cardsOf(html);
  assert.equal(cards.length, rows.length, 'one card per report');
  rows.forEach((row, i) => {
    assert.equal(attrOf(cards[i].tag, 'data-report'), row.number.value);
    assertMovedOnce(cards[i].html, row);
  });
}

test('667: a report whose title is not what moved is in the data, so the line has a case', () => {
  assert.ok(reports.some((r) => reportName(r) !== r.what_moved.value), 'no report needs the separate line');
});

test('667: every tracked /reports/ card states what moved once', () => {
  assertPage(read('docs/reports/index.html'), reports);
});

test('667: the tracked homepage card states what moved once', () => {
  assertPage(read('docs/index.html'), [reports[0]]);
});

for (const home of [false, true]) {
  test(`667: the exported reportCard states what moved once, home=${home}`, () => {
    for (const row of reports) assertMovedOnce(reportCard(row, home ? HOME_CARD_STAT : undefined, { counts: !home }), row);
  });
}

// The plants, on a card written by hand so they read the reader and not the generator.
const row = { number: { value: '999' }, type: { value: 'Example comparison' }, title: { value: 'A title & a comparison' },
  what_moved: { value: 'the fixed input' }, date: { value: '2026-11-02' },
  model_ids: [{ value: 'example-model' }], headline_counts: { value: 'Two measured runs.' } };
const movedLine = '<p class="card-moved">What moved: the fixed input</p>';
const valid = `<article class="card report-card" data-report="999"><h3><a href="/reports/999/">Report <span>999</span>: A title &amp; a comparison</a></h3>${movedLine}<p class="card-models"><code>example-model</code></p><p class="card-date">2026-11-02</p><p class="card-counts">Two measured runs.</p></article>`;

test('667 plants: a missing, doubled or wrong line reads red; a title that says it needs no line', () => {
  assert.doesNotThrow(() => assertMovedOnce(valid, row));
  for (const planted of ['', movedLine + movedLine, movedLine.replace('fixed', 'different')]) {
    assert.throws(() => assertMovedOnce(valid.replace(movedLine, planted), row), /what moved once/);
  }
  const same = { ...row, what_moved: row.title };
  const titleOnly = valid.replace(movedLine, '');
  assert.doesNotThrow(() => assertMovedOnce(titleOnly, same));
  assert.throws(() => assertMovedOnce(titleOnly.replace('</h3>', '</h3><p class="card-moved">What moved: A title &amp; a comparison</p>'), same), /what moved once/);
});

test('667: the generator with an escaped title that is what moved writes no line, and one that is not writes one', () => {
  const same = { ...row, what_moved: row.title };
  for (const r of [same, row]) for (const home of [false, true]) assertMovedOnce(reportCard(r, home ? HOME_CARD_STAT : undefined), r);
});
