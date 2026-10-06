// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for scripts/build-markdown.js and scripts/build-head-tags.js (spec 148): the HTML reader
// that cannot backtrack (AC-6), the table cell that escapes a backslash before a pipe (AC-5), and
// the escaper for a value that builds a RegExp (AC-5).
//
//   node --test tests/build-markdown.test.js
//
// Every test name starts with the criterion it checks; spec 148's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const { toMarkdown } = require('../scripts/build-markdown.js');
const { escapeRegExp } = require('../scripts/build-head-tags.js');

const page = (body) => `<html><head><title>t</title></head><body><main><h1>Title</h1>${body}</main></body></html>`;
const md = (body) => toMarkdown(page(body), 'paper/index.html');

// A reader of one table row: cells split at a pipe that no backslash escapes, a backslash escapes
// the next character (CommonMark's rule, which GFM tables apply to the cell text). Written here, not
// taken from the code under test.
function cellsOf(row) {
  const cells = [];
  let cur = '';
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\\' && i + 1 < inner.length) { cur += inner[i + 1]; i += 1; continue; }
    if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

test('AC-5 a table cell with a backslash before a pipe keeps its columns and reads back as itself', () => {
  const cell = 'x\\y|z\\|w\\';
  const out = md(`<table><tr><th>a</th><th>b</th></tr><tr><td>${cell.replace(/\|/g, '&#124;')}</td><td>2</td></tr></table>`);
  const rows = out.split('\n').filter((l) => l.startsWith('|'));
  assert.equal(rows.length, 3);
  for (const r of rows) assert.equal(cellsOf(r).length, 2, r);
  assert.equal(cellsOf(rows[2])[0], cell);
  assert.equal(cellsOf(rows[2])[1], '2');
});

test('AC-5 a table cell with neither a backslash nor a pipe is unchanged', () => {
  const out = md('<table><tr><th>a</th></tr><tr><td>plain <b>bold</b> text</td></tr></table>');
  assert.ok(out.includes('| plain **bold** text |'), out);
});

test('AC-5 escapeRegExp escapes every character a pattern reads, the backslash included', () => {
  const special = '.*+?^${}()|[]\\';
  assert.equal(escapeRegExp(special), special.split('').map((c) => `\\${c}`).join(''));
  for (const input of ['Claude Sonnet 4.5', 'a+b', 'x(y)', '[z]', 'back\\slash', 'a\\.b', '$1', '^start', 'a|b', '{2}']) {
    const re = new RegExp(`^${escapeRegExp(input)}$`);
    assert.ok(re.test(input), input);
  }
  assert.equal(new RegExp(escapeRegExp('a.c')).test('abc'), false);
  assert.equal(new RegExp(escapeRegExp('a\\.c')).test('a.c'), false);
  assert.equal(new RegExp(escapeRegExp('a\\.c')).test('a\\.c'), true);
  assert.equal(escapeRegExp('plain-name 5'), 'plain-name 5');
});

test('AC-6 a tag with a long run of odd attributes is read in linear time, closed or not', () => {
  const odd = '!=""'.repeat(100000);
  for (const [name, html] of Object.entries({
    closed: `<A ${odd}>kept</A>`,
    unclosed: `<A ${odd}`,
    spaced: `<A ${'"" !='.repeat(100000)}>kept</A>`,
    equals: `<a ${'= '.repeat(200000)}>kept</a>`,
  })) {
    const t0 = Date.now();
    const out = md(`<p>before</p>${html}<p>after</p>`);
    const ms = Date.now() - t0;
    assert.ok(ms < 3000, `${name}: ${html.length} characters took ${ms} ms`);
    assert.ok(out.includes('before'), name);
  }
});

test('AC-6 the shape CodeQL names, a tag the input ends inside, after the page, is read in linear time', () => {
  // The previous pattern took about a second at 24 repetitions and doubled with each one more.
  const html = `${page('<p>before</p>')}<A !=${'"" !='.repeat(100000)}`;
  const t0 = Date.now();
  const out = toMarkdown(html, 'paper/index.html');
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `${html.length} characters took ${ms} ms`);
  assert.ok(out.includes('before'));
});

test('AC-6 the tree is the same one the page has: attributes with ">", comments, raw script text, void tags', () => {
  const out = md([
    '<p>one <a href="/x?a>b" title=\'q "r"\'>link</a> <!-- <b>no</b> --> two<br>three</p>',
    '<script>if (a<b) { s = "<p>no</p>"; }</script>',
    '<style>p > b { color: red }</style>',
    '<ul><li>a</li><li>b</li></ul>',
    '<p>1 < 2</p>',
  ].join(''));
  assert.equal(out, [
    '# Title',
    '',
    'Canonical: <https://driftproofhq.com/paper/>',
    '',
    'one [link](https://driftproofhq.com/x?a>b) two',
    'three',
    '',
    '- a',
    '- b',
    '',
    '1 < 2',
    '',
  ].join('\n'));
});
