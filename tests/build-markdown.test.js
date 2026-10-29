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

// Issue 408: a table cell must retain boundaries between paragraphs and disclosures.
test('AC-5 nested table evidence keeps words apart and preserves inline joins', () => {
  const out=md('<table><tr><th>Model</th></tr><tr><td><p>Answering model: Example</p><section><p>Clearly helped.</p><details><summary>Why this result?</summary><p>A task improved.</p><ul><li>One task.</li><li>Another task.</li></ul></details></section></td></tr></table>');
  assert.ok(out.includes('| Answering model: Example Clearly helped. Why this result? A task improved. One task. Another task. |'),out);
  const inline=md('<table><tr><td>pre<b>fix</b>: <data>0</data>.<data>75</data>, <a href="/record">record</a>.</td></tr></table>');
  assert.ok(inline.includes('| pre**fix**: 0.75, [record](https://driftproofhq.com/record). |'),inline);
});

// Issue 501, review F-2: trailing visual labels introduce their own pane in prose.
test('AC-18/22 comparison panes keep each label with its own content, including an empty pane', () => {
  const out = md('<div class="doors wide"><div class="door none"><div class="door-body"></div><b>Nothing</b><span>No added file</span></div><div class="door file"><div class="door-body"><pre>Use &lt;rules&gt;.</pre></div><b>The file</b><span>Injected instructions</span></div><div class="door placebo"><div class="door-body"><p>A ferry crossed.</p></div><b>Its fake</b><span>Irrelevant prose, equal bytes</span></div></div>');
  assert.equal(out, '# Title\n\nCanonical: <https://driftproofhq.com/paper/>\n\n**Nothing**\n\nNo added file\n\n**The file**\n\nInjected instructions\n\n' + '\x60\x60\x60\nUse <rules>.\n\x60\x60\x60' + '\n\n**Its fake**\n\nIrrelevant prose, equal bytes\n\nA ferry crossed.\n');
});
