// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 792: Report 019's page, results at a glance, laid-out rows and a table that fits. Written
// before the builder changes. The page is restyled and nothing it says may move: every check reads
// the base page (the Base commit's, through git) or the sealed receipts, never the builder's output
// as its own oracle.
//
// Each check is a function over a page's HTML, run once on the committed page (the control) and
// once on each plant, which must read red.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
process.env.DRIFTPROOF_REGISTRY = path.join(ROOT, 'specs/783-fable-5-2-scope/registry.json');
const BASE = '0de8cc1146a53bd24b439c53e6b2e8bfaddb032a';
const PAGE_REL = 'docs/reports/019/index.html';
const CSS_REL = 'docs/tokens.css';

const { placeboReading } = require(path.join(ROOT, 'lib/verdict'));
const { plainOf } = require(path.join(ROOT, 'lib/plain'));
const { htmlToText } = require(path.join(ROOT, 'scripts/html-text'));
const O = require(path.join(ROOT, 'scripts/offer.js'));
const B = () => require(path.join(ROOT, 'scripts/prepare-report-019.js'));

const gitShow = (rel) => { const r = spawnSync('git', ['show', BASE + ':' + rel], { cwd: ROOT, maxBuffer: 1 << 28 }); assert.equal(r.status, 0, 'the Base commit is readable: ' + rel); return r.stdout.toString('utf8'); };
const basePage = gitShow(PAGE_REL);
const newPage = () => fs.readFileSync(path.join(ROOT, PAGE_REL), 'utf8');
let model; const M = () => (model = model || B().readReport({}));

// ── HTML, read the way a person sees it ──
// Issue 807: the tags are read by spec 148's tokenizer, not a regex, and the entities decoded once.
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&amp;': '&' };
const decode = (s) => s.replace(/&(?:lt|gt|quot|#39|amp|#\d+);/g, (e) => ENTITIES[e] || String.fromCodePoint(Number(e.slice(2, -1))));
const BLOCK = ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'td', 'tr', 'dt', 'dd', 'div', 'section', 'summary', 'details', 'ul', 'ol', 'table', 'thead', 'tbody', 'caption', 'aside', 'header', 'footer', 'nav', 'main', 'br', 'pre', 'figure', 'figcaption', 'dl', 'blockquote'];
const visible = (html) => htmlToText(html, { skip: ['script', 'style'], blockTags: BLOCK, decode, collapse: true });
const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>') + 7);
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
// The element that starts at `start`, with its nested elements of the same name.
function outer(html, start) {
  const name = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start))[1];
  const re = new RegExp('<(/?)' + name + '\\b[^>]*>', 'g'); re.lastIndex = start; let depth = 0, m;
  while ((m = re.exec(html))) { if (m[1]) { if (--depth === 0) return html.slice(start, re.lastIndex); } else depth++; }
  throw new Error('unclosed <' + name + '> at ' + start);
}
const all = (html, re) => [...html.matchAll(new RegExp(re.source, 'g'))].map((m) => ({ at: m.index, tag: m[0], a: attrs(m[0]), html: outer(html, m.index) }));
const one = (html, re, why) => { const xs = all(html, re); assert.equal(xs.length, 1, why || String(re)); return xs[0]; };
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const n3 = (x) => x.toFixed(3);
// Display rounding: half away from zero at two decimals, read from the decimal form.
const round2 = (v) => (Math.sign(v) * Math.round(Number((Math.abs(v) * 100).toPrecision(12))) / 100).toFixed(2);
const BLOCKS = /<(?:p|li|h[1-3]|th|dt|dd|pre)\b[^>]*>/;
const report020Table = (html) => one(mainOf(html), /<section id="report-020"[^>]*>/).html.match(/<table[\s\S]*?<\/table>/)[0];

// ── the oracle: the counted twenty, read from their receipts here ──
function counted() {
  const m = M();
  return [...m.fourteen.map((r) => ({ r, kind: 'counted' })), ...m.six.map((r) => ({ r, kind: 'tools' }))].map(({ r, kind }) => {
    const x = r.receipt, reading = placeboReading(x).reading, key = O.labelOf(reading);
    return { skill: r.skill, repository: r.repository, attempt: r.attempt_id, src: r.src, kind, reading, key, label: O.LABELS[key], plain: B().PLAIN[reading], none: plainOf(x).label,
      means: { with_skill: x.comparison.with_skill_score, baseline: x.comparison.baseline_score, placebo: x.placebo.comparison.placebo_score } };
  });
}
const COUNTS = ['ABOVE_PLACEBO', 'BELOW_PLACEBO', 'NO_DIFFERENCE', 'INCONCLUSIVE', 'UNDERPOWERED', 'NOT_MEASURED'];
const CAVEATS = ['headline-method', 'headline-ruled-change', 'headline-bases', 'headline-caveat', 'headline-judge', 'headline-effort'];
const GROUPS = ['The fourteen, graded on the reply', 'The six, with tools on'];
const NEW_WORDS = ['The twenty at a glance', 'One entry for each skill counted, in the order of the rows below. The chip is the reading against the same-length placebo, by the case rule, task by task. Open a row for its tasks, bands and receipt.',
  'Means over all of a skill\'s tasks, apart from the case rule; they can point the other way.', 'Skill', 'Against the same-length placebo', 'Against no skill', 'With the skill', 'With no skill', 'With the placebo',
  'tools on', 'of', 'Read this before the results', ...GROUPS];
const MEANS_NOTE = NEW_WORDS[2];

// ── the checks ──
function rowsOf(html) {
  return all(mainOf(html), /<section class="placebo-result[^"]*"[^>]*>/).map((s) => {
    const kind = /result-(\w+)/.exec(s.a.class)[1], d = s.html, i = d.indexOf('</summary>');
    return { key: s.a['data-attempt'] + ' ' + kind, kind, attempt: s.a['data-attempt'], id: s.a.id, reading: s.a['data-reading'], summary: d.slice(d.indexOf('<summary>'), i + 10), opened: d.slice(i + 10, d.lastIndexOf('</details>')) };
  });
}

// The run record's reader pins: the files that built the page, each with its sha256 (spec 790 AC-18).
// This change edits the builder, so its pin moves with it; each pin is read against the file itself.
const PINS = /<ul class="reader-pins">[\s\S]*?<\/ul>/;
function checkPins(html) {
  const pins = (h) => [...PINS.exec(mainOf(h))[0].matchAll(/<li><code>([^<]+)<\/code>, SHA-256 <code>([0-9a-f]{64})<\/code><\/li>/g)].map((m) => [m[1], m[2]]);
  const was = pins(basePage), now = pins(html);
  assert.deepEqual(now.map(([f]) => f), was.map(([f]) => f), 'the same reader files, in order');
  for (const [f, h] of now) assert.equal(h, require(path.join(ROOT, 'lib/canonical')).sha256(fs.readFileSync(path.join(ROOT, f))), 'each pin is its file\'s sha256: ' + f);
}

// AC-1: every block and every figure of the base page is still there.
function checkWords(html) {
  checkPins(html);
  const text = visible(mainOf(html).replace(PINS, '')), want = new Map();
  const baseMain = mainOf(basePage).replace(/<summary>[\s\S]*?<\/summary>/g, '').replace(PINS, '');
  for (const b of all(baseMain, BLOCKS)) { const t = visible(b.html); if (/[A-Za-z0-9]/.test(t)) want.set(t, (want.get(t) || 0) + 1); }
  for (const [t, n] of want) assert.ok(count(text, t) >= n, 'a base block is still on the page ' + n + ' times: ' + t.slice(0, 120));
  const table = report020Table(basePage);
  const key = (d) => [d.a.value, d.a['data-src'], d.a['data-at'], d.a['data-fn']].join('|');
  const have = new Map();
  for (const d of all(mainOf(html), /<data\b[^>]*>/)) { const k = key(d); have.set(k, [...(have.get(k) || []), visible(d.html)]); }
  for (const d of all(mainOf(basePage).replace(table, ''), /<data\b[^>]*>/)) {
    const k = key(d), xs = have.get(k) || [], at = xs.indexOf(visible(d.html));
    assert.ok(at >= 0, 'a base figure is still on the page with its source and text: ' + k + ' ' + visible(d.html)); xs.splice(at, 1);
  }
}

// AC-2: the same rows, in the same order, each opened row byte for byte.
function checkRows(html) {
  const was = rowsOf(basePage), now = rowsOf(html);
  assert.deepEqual(now.map((r) => r.key), was.map((r) => r.key), 'the same rows in the same order');
  now.forEach((r, i) => assert.equal(r.opened, was[i].opened, 'an opened row shows what it shows today: ' + r.key));
}

// AC-3, AC-4: one glance entry per counted skill, agreeing with its row and its receipt.
function glanceOf(html) { return one(mainOf(html), /<section id="at-a-glance"[^>]*>/, 'one glance section').html; }
function checkGlance(html) {
  const g = glanceOf(html), want = counted(), rows = rowsOf(html);
  const entries = all(g, /<tr class="r019-entry[^"]*"[^>]*>/);
  assert.equal(entries.length, 20, 'one entry per counted skill');
  const groups = all(g, /<tr class="r019-group[^"]*"[^>]*>/);
  assert.deepEqual(groups.map((x) => visible(x.html)), GROUPS, 'the two section titles group the entries');
  assert.ok(groups[0].at < entries[0].at && entries[13].at < groups[1].at && groups[1].at < entries[14].at, 'fourteen under the first title, six under the second');
  entries.forEach((e, i) => {
    const w = want[i], why = w.skill + ' (' + w.kind + ')';
    assert.equal(e.a['data-attempt'], w.attempt, 'row order: ' + why); assert.equal(e.a['data-reading'], w.reading, why);
    const href = /<a href="#([^"]+)"/.exec(e.html); assert.ok(href, 'the entry links to its row: ' + why);
    const row = rows.filter((r) => r.id === href[1]); assert.equal(row.length, 1, 'the link names one row: ' + why);
    assert.equal(row[0].attempt, w.attempt, 'the link names the counted row: ' + why); assert.equal(row[0].kind, w.kind, why); assert.equal(row[0].reading, w.reading, why);
    assert.equal(count(e.html, '<span class="r019-chip is-' + w.key + '">' + w.label + '</span>'), 1, 'the chip is the label, with its key: ' + why);
    assert.equal(count(e.html, '<code class="reading-token">' + w.reading + '</code>'), 1, 'the token as small text: ' + why);
    assert.equal(count(e.html, 'class="r019-tools"'), w.kind === 'tools' ? 1 : 0, 'tools on, the six only: ' + why);
    for (const arm of ['with_skill', 'baseline', 'placebo']) {
      const d = all(e.html, new RegExp('<data\\b[^>]*data-arm="' + arm + '"[^>]*>'));
      assert.equal(d.length, 1, 'one ' + arm + ' mean: ' + why);
      assert.equal(Number(d[0].a.value), w.means[arm], 'the sealed ' + arm + ' figure: ' + why); assert.equal(d[0].a['data-src'], w.src, 'its receipt: ' + why);
      assert.equal(visible(d[0].html), n3(w.means[arm]), 'three decimals, as lib/plain.js prints it: ' + why);
    }
    const expect = [w.skill, w.repository, ...(w.kind === 'tools' ? ['tools on'] : []), w.label, w.plain, w.reading, w.none, n3(w.means.with_skill), n3(w.means.baseline), n3(w.means.placebo)].join(' ');
    assert.equal(visible(e.html), expect, 'the entry says exactly its receipt\'s readings and means: ' + why);
  });
  assert.equal(count(visible(g), MEANS_NOTE), 1, 'the means are said to be apart from the case rule, once');
  assert.doesNotMatch(g, /text-only, not counted/, 'no context receipt in the glance');
}

// AC-5: the large figures and the chips are the tally; the counts lines stay.
function checkTally(html) {
  const want = counted(), t = Object.fromEntries(COUNTS.map((k) => [k, want.filter((w) => w.reading === k).length]));
  const A14 = want.slice(0, 14).filter((w) => w.reading === 'ABOVE_PLACEBO').length, A6 = want.slice(14).filter((w) => w.reading === 'ABOVE_PLACEBO').length;
  const head = one(mainOf(html), /<div class="headline">/, 'the headline keeps its class').html;
  const stats = all(head, /<div class="r019-stat"[^>]*>/); assert.equal(stats.length, 2, 'two large figures');
  const baseParts = all(mainOf(basePage), /<p class="headline-part">/).map((p) => visible(p.html));
  [[A14, 14], [A6, 6]].forEach(([a, n], i) => {
    const f = one(stats[i].html, /<p class="r019-figure"[^>]*>/).html, d = all(f, /<data\b[^>]*>/);
    assert.deepEqual(d.map((x) => Number(x.a.value)), [a, n], 'the large figure is the tally'); assert.ok(d.every((x) => x.a['data-src']), 'each names its source');
    assert.equal(visible(f), a + ' of ' + n);
    assert.equal(visible(one(stats[i].html, /<p class="headline-part">/).html), baseParts[i], 'the headline line, verbatim');
  });
  const plain = one(mainOf(html), /<p class="headline-counts-plain[^"]*"[^>]*>/).html;
  assert.equal(visible(plain), visible(one(mainOf(basePage), /<p class="headline-counts-plain">/).html), 'the plain counts line reads as today');
  const chips = all(plain, /<span class="r019-count"[^>]*>/);
  assert.deepEqual(chips.map((c) => c.a['data-reading']), COUNTS, 'one chip per reading, in the counts order');
  chips.forEach((c) => assert.equal(Number(one(c.html, /<data\b[^>]*>/).a.value), t[c.a['data-reading']], 'a chip is the tally: ' + c.a['data-reading']));
  assert.equal(chips.reduce((n, c) => n + Number(one(c.html, /<data\b[^>]*>/).a.value), 0), 20, 'the chips sum to the twenty');
  for (const cls of ['headline-counts', 'big', 'headline-labels']) {
    const re = new RegExp('<p class="' + cls + '"[^>]*>');
    assert.equal(visible(one(mainOf(html), re).html), visible(one(mainOf(basePage), re).html), 'verbatim: ' + cls);
  }
}

// AC-6: the caveats, grouped, visible and before the results.
function checkCaveats(html) {
  const main = mainOf(html), box = one(main, /<div class="r019-before"[^>]*>/, 'one caveat box');
  assert.equal(visible(one(box.html, /<h3\b[^>]*>/).html), 'Read this before the results');
  for (const cls of CAVEATS) {
    const re = new RegExp('<p class="' + cls + '">'), p = one(main, re, 'once: ' + cls);
    assert.ok(box.html.includes(p.html), 'in the box: ' + cls);
    assert.equal(visible(p.html), visible(one(mainOf(basePage), re).html), 'verbatim: ' + cls);
    // The summary at the top of the page repeats two of these lines, as it does today.
    assert.equal(count(visible(main), visible(p.html)), count(visible(mainOf(basePage)), visible(p.html)), 'said as many times as today: ' + cls);
  }
  for (const d of all(main, /<details\b[^>]*>/)) {
    assert.ok(!d.html.includes('class="r019-before"'), 'the box is in no details element');
    for (const cls of CAVEATS) assert.ok(!d.html.includes('<p class="' + cls + '">'), 'no caveat line in a details element: ' + cls);
  }
  const firstEntry = main.search(/<tr class="r019-entry/), firstRow = main.search(/<section class="placebo-result/);
  assert.ok(firstEntry > 0 && box.at < firstEntry && box.at < firstRow, 'before the first entry and the first row');
  assert.ok(main.search(/<div class="headline">/) < box.at, 'after the headline');
}

// AC-7: a summary laid out, with no code inside a sentence.
function summaryParts(s) {
  const span = (cls) => one(s, new RegExp('<span class="' + cls + '"[^>]*>'), cls);
  const reading = span('row-reading'), label = all(reading.html, /<span class="offer-label"[^>]*>/)[0];
  return { skill: visible(span('row-skill').html), label: visible(label.html), reading: visible(reading.html.replace(label.html, '')), verdict: visible(span('row-verdict').html) };
}
function checkSummaries(html) {
  const was = rowsOf(basePage), now = rowsOf(html);
  now.forEach((r, i) => {
    const b = summaryParts(was[i].summary), s = r.summary, why = r.key;
    const at = ['class="row-skill"', 'class="r019-chip', 'class="row-reading"', 'class="row-verdict"'].map((x) => s.indexOf(x));
    assert.ok(at.every((x, k) => x > 0 && (k === 0 || x > at[k - 1])), 'name, chip, placebo reading, no-skill reading, in order: ' + why);
    const reading = one(s, /<span class="row-reading"[^>]*>/).html;
    assert.equal(count(reading, '<code class="reading-token">'), 1, why);
    assert.match(reading.slice(reading.lastIndexOf('</code>') + 7), /^\s*<\/span>$/, 'nothing follows the token in its line: ' + why);
    assert.equal(visible(s), [b.skill, b.label, b.reading, b.verdict].join(' '), 'the summary says what it says today, laid out: ' + why);
    if (r.kind === 'context') assert.equal(count(s, '<span class="context-mark">(text-only, not counted)</span>'), 1, 'the context mark: ' + why);
    if (r.kind !== 'context') assert.ok(r.id, 'a counted row carries an id: ' + why);
  });
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique: ' + ids.filter((x, i) => ids.indexOf(x) !== i).join(' '));
}

// AC-8: Report 020's table, rounded for display, exact on the page.
function cellsOf(table) { return all(table.replace(/<thead[\s\S]*?<\/thead>/, ''), /<t[hd]\b[^>]*>/); }
function checkTable(html) {
  const main = mainOf(html), sec = one(main, /<section id="report-020"[^>]*>/).html;
  assert.match(sec, /<div class="table-wrap[^"]*"[^>]*>\s*<table class="boundary-table"/, 'the table sits in a table wrapper');
  const was = report020Table(basePage), now = report020Table(html);
  assert.equal(visible(now.match(/<thead[\s\S]*?<\/thead>/)[0]), visible(was.match(/<thead[\s\S]*?<\/thead>/)[0]), 'the header reads as today');
  const a = cellsOf(was), b = cellsOf(now); assert.equal(b.length, a.length, 'the same cells');
  a.forEach((c, i) => {
    const d = b[i], why = 'cell ' + i;
    const figs = all(c.html, /<data\b[^>]*>/);
    if (!figs.length) { assert.equal(visible(d.html), visible(c.html), 'a cell with no figure reads as today: ' + why); return; }
    assert.equal(d.a.title, visible(c.html), 'the exact text is the cell\'s title: ' + why);
    const nf = all(d.html, /<data\b[^>]*>/); assert.equal(nf.length, figs.length, why);
    let expect = c.html;
    figs.forEach((f, k) => {
      const g = nf[k], draws = k % 3 === 2;
      for (const x of ['value', 'data-src', 'data-at']) assert.equal(g.a[x], f.a[x], why + ' ' + x);
      assert.equal(g.a['data-dp'], draws ? 'exact' : '2', why); assert.equal(visible(g.html), draws ? visible(f.html) : round2(Number(f.a.value)), 'display rounding: ' + why);
      expect = expect.replace(f.html, '\u0000' + visible(g.html) + '\u0001');
    });
    assert.equal(visible(d.html), visible(expect.replace(/ plus or minus /g, ' ± ').replace(/[\u0000\u0001]/g, '')), 'the cell reads rounded, with ±: ' + why);
  });
}

// AC-12: only the listed words are new.
function checkNewWords(html) {
  let main = mainOf(html).replace(/<summary>[\s\S]*?<\/summary>/g, ' ').replace(PINS, ' ');
  for (const e of all(main, /<tr class="r019-entry[^"]*"[^>]*>/)) main = main.replace(e.html, ' ');
  main = main.replace(report020Table(html).match(/<tbody[\s\S]*?<\/tbody>/)[0], ' ');
  let text = visible(main);
  const baseMain = mainOf(basePage).replace(/<summary>[\s\S]*?<\/summary>/g, '');
  const blocks = all(baseMain, BLOCKS).map((b) => visible(b.html)).filter((t) => /[A-Za-z0-9]/.test(t)).sort((x, y) => y.length - x.length);
  for (const t of blocks) text = text.replace(t, ' ');
  const allowed = new Set(NEW_WORDS.join(' ').toLowerCase().match(/[\p{L}±']+/gu));
  const left = (text.replace(/\d+(?:\.\d+)?/g, ' ').toLowerCase().match(/[\p{L}±']+/gu) || []).filter((w) => !allowed.has(w));
  assert.deepEqual([...new Set(left)], [], 'no word but the listed ones is new');
}

// AC-14: the method's note sections fold under its lead.
function checkMethod(html) {
  const main = mainOf(html), from = main.indexOf('<h2 id="method">') >= 0 ? main.indexOf('<h2 id="method">') : main.search(/<h2[^>]*>Method<\/h2>/);
  const to = main.search(/<h2[^>]*>Limits<\/h2>/); assert.ok(from > 0 && to > from, 'the method section');
  const m = main.slice(from, to), h3 = all(m, /<h3\b[^>]*>/);
  assert.ok(h3.length >= 11, 'the note sections keep their headings');
  for (const h of h3) assert.match(m.slice(0, h.at), /<details class="r019-fold"><summary>$/, 'folded under a summary: ' + visible(h.html));
}

const plantOn = (check, html, plants) => {
  check(html);
  for (const [why, edit] of plants) {
    const planted = edit(html); assert.notEqual(planted, html, 'the plant applies: ' + why);
    assert.throws(() => check(planted), assert.AssertionError, 'reads red: ' + why);
  }
};
const replaceOnce = (from, to) => (h) => { assert.ok(h.includes(from), 'plant anchor: ' + String(from).slice(0, 80)); return h.replace(from, to); };

// ── the tests ──
// A-792-3 (issue 794): the operator replaced this layout ("Spec 792's glance table and caveat box are
// replaced, not kept beside the new design"). Each criterion below that reads it is retired and named
// with the spec 794 criterion that now holds the claim, read against this spec's own page as its base.
const RETIRED = (by) => ({ skip: 'retired by A-792-3 (issue 794): held by spec 794 ' + by });
test('AC-1: every block and every figure of the base page is still on the page', RETIRED('AC-6'), () => {
  const h = newPage();
  plantOn(checkWords, h, [
    ['a caveat word changed', replaceOnce('so there was little room for a difference', 'so there was some room for a difference')],
    ['a block removed', (x) => x.replace(/<p class="headline-judge">[\s\S]*?<\/p>/, '')],
    ['a figure\'s value changed', (x) => x.replace(/(<p class="tools-on-caveat">[\s\S]*?<data value=")(\d+)/, (_, a, n) => a + (Number(n) + 1))],
    ['a figure\'s source changed', (x) => x.replace(/(<p class="tools-on-caveat">[\s\S]*?<data value="\d+" data-src=")[^"]+/, '$1elsewhere.json')],
    ['a reader pin that is not its file\'s', (x) => x.replace(/(<ul class="reader-pins"><li><code>[^<]+<\/code>, SHA-256 <code>)[0-9a-f]/, '$1z')],
  ]);
});

test('AC-2: the same rows, in order, each opened row byte for byte as today', RETIRED('AC-5'), () => {
  const h = newPage(), rows = rowsOf(h);
  plantOn(checkRows, h, [
    ['a task band changed in one row', (x) => x.replace(/(<ul class="placebo-tasks"><li[^>]*>[^<]*: with the skill <data value=")([\d.]+)/, (_, a, v) => a + v + '1')],
    ['one row removed', (x) => x.replace(/<section class="placebo-result[\s\S]*?<\/details><\/section>/, '')],
    ['two rows swapped', (x) => { const s = all(mainOf(x), /<section class="placebo-result[^"]*"[^>]*>/); return x.replace(s[0].html + s[1].html, s[1].html + s[0].html); }],
  ]);
  assert.equal(rows.length, 26);
});

test('AC-3, AC-4: one glance entry per counted skill, its readings and sealed means, beside its row', RETIRED('AC-2 and AC-3'), () => {
  const h = newPage();
  plantOn(checkGlance, h, [
    ['two chips swapped', (x) => x.replace('<span class="r019-chip is-keep">Keep</span>', '\u0000').replace('<span class="r019-chip is-cannot">Cannot tell</span>', '<span class="r019-chip is-keep">Keep</span>').replace('\u0000', '<span class="r019-chip is-cannot">Cannot tell</span>')],
    ['one entry removed', (x) => x.replace(all(glanceOf(x), /<tr class="r019-entry[^"]*"[^>]*>/)[3].html, '')],
    ['a link pointed at another row', (x) => { const e = all(glanceOf(x), /<tr class="r019-entry[^"]*"[^>]*>/); const h0 = /<a href="#([^"]+)"/.exec(e[0].html)[1], h1 = /<a href="#([^"]+)"/.exec(e[1].html)[1]; return x.replace(e[0].html, e[0].html.replace('#' + h0, '#' + h1)); }],
    ['the tools-on mark moved to a text-only skill', (x) => x.replace(/ <span class="r019-tools">tools on<\/span>/, '').replace(/(<tr class="r019-entry[^"]*"[^>]*><th[^>]*><a [^>]*>[^<]*<\/a>)/, '$1 <span class="r019-tools">tools on</span>')],
    ['the against-no-skill reading removed', (x) => x.replace(/<span class="r019-against-none">[^<]*<\/span>/, '')],
    ['a context receipt\'s reading in an entry', (x) => { const e = all(glanceOf(x), /<tr class="r019-entry[^"]*"[^>]*>/).at(-1); return x.replace(e.html, e.html.replace(/data-reading="[A-Z_]+"/, 'data-reading="ABOVE_PLACEBO"')); }],
    ['a mean\'s value changed', (x) => x.replace(/(<data value=")([\d.]+)("[^>]*data-arm="placebo")/, (_, a, v, b) => a + (Number(v) / 2) + b)],
    ['a mean at two decimals', (x) => x.replace(/(data-arm="with_skill"[^>]*>)(\d\.\d\d)\d</, '$1$2<')],
    ['the apart-from-the-case-rule line removed', replaceOnce(MEANS_NOTE.replace(/'/g, '&#39;'), '')],
  ]);
});

test('AC-4: a receipt whose two with-skill scores differ refuses GLANCE_BINDING', () => {
  const m = structuredClone(M()); m.fourteen[0].receipt.placebo.comparison.with_skill_score += 0.001;
  assert.throws(() => B().buildReport({ model: m }), (e) => e && e.code === 'GLANCE_BINDING');
});

test('AC-5: the large figures and the chips are the tally, and the home page still reads the counts', RETIRED('AC-1 and AC-10'), async () => {
  const h = newPage();
  plantOn(checkTally, h, [
    ['a large figure one up', (x) => x.replace(/(<p class="r019-figure"[^>]*><data value=")(\d+)("[^>]*>)(\d+)/, (_, a, n, b) => a + (Number(n) + 1) + b + (Number(n) + 1))],
    ['a chip one up', (x) => x.replace(/(<span class="r019-count" data-reading="BELOW_PLACEBO"[^>]*><data value=")(\d+)/, (_, a, n) => a + (Number(n) + 1))],
    ['a chip given another reading', replaceOnce('<span class="r019-count" data-reading="NO_DIFFERENCE"', '<span class="r019-count" data-reading="ABOVE_PLACEBO"')],
    ['the frozen counts line removed', (x) => x.replace(/<p class="headline-counts"[^>]*>[\s\S]*?<\/p>/, '')],
  ]);
  const { latestTally } = await import(path.join(ROOT, 'scripts/site-data.mjs'));
  assert.deepEqual(latestTally(h), latestTally(basePage), 'the home page parses the same counts');
});

test('AC-6: the caveats, grouped in one box, visible, after the headline and before the results', RETIRED('AC-8 and AC-10'), () => {
  const h = newPage();
  plantOn(checkCaveats, h, [
    ['the ruled change inside a closed details', (x) => x.replace(/<p class="headline-ruled-change">[\s\S]*?<\/p>/, (p) => '<details><summary>More</summary>' + p + '</details>')],
    ['a line moved after the first entry', (x) => { const p = /<p class="headline-judge">[\s\S]*?<\/p>/.exec(x)[0]; return x.replace(p, '').replace(/<\/tbody>/, '</tbody>' + p); }],
    ['a line said twice', (x) => x.replace(/<p class="headline-bases">[\s\S]*?<\/p>/, (p) => p + p.replace('headline-bases', 'r019-again'))],
  ]);
});

test('AC-7: each summary laid out, the token never inside a sentence, ids unique', RETIRED('AC-4 and AC-5'), () => {
  const h = newPage();
  plantOn(checkSummaries, h, [
    ['a word after a token in its line', (x) => x.replace(/(<span class="row-reading">[\s\S]*?<\/code>)/, '$1 and more')],
    ['a context mark removed', replaceOnce(' <span class="context-mark">(text-only, not counted)</span>', '')],
    ['a summary\'s chip removed', (x) => x.replace(/(<details class="placebo-row"><summary>[\s\S]*?)<span class="r019-chip[^"]*">[^<]*<\/span>/, '$1')],
    ['two rows given one id', (x) => { const r = rowsOf(x).filter((y) => y.id); return x.replace('id="' + r[1].id + '"', 'id="' + r[0].id + '"'); }],
  ]);
});

test('AC-8: Report 020\'s table is rounded for display, with the exact text and values on the page', () => {
  const h = newPage();
  plantOn(checkTable, h, [
    ['a rounded figure one step off', (x) => x.replace(/(<table class="boundary-table"[\s\S]*?data-dp="2"[^>]*>)(\d\.\d)(\d)/, (_, a, b, c) => a + b + ((Number(c) + 1) % 10))],
    ['a cell\'s title removed', (x) => x.replace(/(<table class="boundary-table"[\s\S]*?<td) title="[^"]*"/, '$1')],
    ['a draw count changed', (x) => x.replace(/(<table class="boundary-table"[\s\S]*?data-dp="exact"[^>]*>)(\d+)/, (_, a, n) => a + (Number(n) + 1))],
    ['a verdict cell changed', replaceOnce('<td class="boundary-verdict">no separation detected</td>', '<td class="boundary-verdict">separation detected, upward</td>')],
  ]);
});

test('AC-12: only the listed words are new, and spec 790\'s lexicon still holds', RETIRED('AC-6 and AC-7, with spec 790\'s lexicon test'), () => {
  const h = newPage();
  checkNewWords(basePage);
  plantOn(checkNewWords, h, [['a word added to the glance\'s lead', replaceOnce('task by task.', 'task by task, dramatically.')]]);
  assert.doesNotMatch(visible(mainOf(h)), /\b(confiden\w*|significan\w*|likely|probabl\w*|prove[sn]?|proof|ratio|ranking|ranked|winners?|best|worst|percent)\b|%/i);
});

test('AC-14: the method\'s note sections fold under its lead', RETIRED('AC-10'), () => {
  const h = newPage();
  plantOn(checkMethod, h, [['a section unfolded', (x) => x.replace(/<details class="r019-fold"><summary>(<h3[\s\S]*?<\/h3>)<\/summary>/, '$1<details class="r019-fold"><summary>')]]);
});

// AC-10: the styles are one block, scoped, and nothing else in the stylesheet moves.
const BLOCK_RE = /\/\* report 019 \(spec 792\) \*\/[\s\S]*?\/\* \/report 019 \(spec 792\) \*\/\n/;
function checkCss(css) {
  const m = BLOCK_RE.exec(css); assert.ok(m, 'one report 019 block'); assert.equal(css.match(new RegExp(BLOCK_RE.source, 'g')).length, 1);
  assert.equal(css.replace(BLOCK_RE, ''), gitShow(CSS_REL), 'outside the block, the stylesheet is the Base\'s');
  assert.ok(css.endsWith(m[0]), 'the block comes after every other rule');
  const body = m[0].replace(/\/\*[\s\S]*?\*\//g, '');
  for (const s of body.matchAll(/([^{}]+)\{/g)) {
    const sel = s[1].trim(); if (sel.startsWith('@')) continue;
    // A selector list splits at its top-level commas, not at those inside :is() or :not().
    const parts = []; let depth = 0, cur = '';
    for (const ch of sel) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    for (const part of parts) assert.match(part, /\.r019-/, 'a selector names a report 019 class: ' + part.trim());
  }
}
test('AC-10: the new styles are one scoped block at the end of docs/tokens.css', RETIRED('AC-14'), () => {
  const css = fs.readFileSync(path.join(ROOT, CSS_REL), 'utf8');
  plantOn(checkCss, css, [
    ['a selector with no report 019 class', (x) => x.replace('/* /report 019 (spec 792) */', '.placebo-row { color: var(--ink); }\n/* /report 019 (spec 792) */')],
    ['a byte changed outside the block', (x) => x.replace(':focus-visible { outline: 2px solid', ':focus-visible { outline: 3px solid')],
  ]);
});

test('AC-11: --check rebuilds the committed page byte for byte', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/prepare-report-019.js'), '--check'], { cwd: ROOT, encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stderr);
});

// ── AC-9, AC-10: in a browser ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
function serve() {
  const docs = path.join(ROOT, 'docs');
  const server = http.createServer((req, res) => {
    let f = path.join(docs, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(docs)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
async function withPage(width, height, fn) {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
  const server = await serve(), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width, height } }), page = await ctx.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto('http://127.0.0.1:' + server.address().port + '/reports/019/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally { await browser.close(); server.close(); }
}
const fits = (page) => page.evaluate(() => { const w = document.querySelector('#report-020 .table-wrap'), t = w.querySelector('table'); return { table: t.scrollWidth, wrap: w.clientWidth }; });
const pageWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth);
const stacked = (page) => page.evaluate(() => {
  const g = document.querySelector('#at-a-glance table'), out = [];
  for (const e of document.querySelectorAll('#at-a-glance tr.r019-entry')) {
    const r = e.getBoundingClientRect(), c = [...e.children].map((x) => x.getBoundingClientRect());
    out.push({ full: r.width >= g.getBoundingClientRect().width - 2, stacked: c.every((x, i) => i === 0 || x.top >= c[i - 1].bottom - 1) });
  }
  return out;
});
test('AC-9: the table fits at 1280 px, the page never scrolls sideways at 375 px, and the glance stacks', RETIRED('AC-13'), async () => {
  await withPage(1280, 900, async (page) => {
    const f = await fits(page); assert.ok(f.table <= f.wrap, 'the table fits its wrapper: ' + JSON.stringify(f));
    await page.addStyleTag({ content: '#report-020 table { min-width: 1400px; }' });
    const p = await fits(page); assert.ok(p.table > p.wrap, 'plant: a wide table reads red');
  });
  await withPage(375, 812, async (page) => {
    assert.ok(await pageWidth(page) <= 375, 'no sideways scroll at 375 px');
    const s = await stacked(page); assert.equal(s.length, 20); assert.ok(s.every((x) => x.full && x.stacked), 'each entry a full-width card: ' + JSON.stringify(s.filter((x) => !(x.full && x.stacked)).length));
    await page.addStyleTag({ content: '#at-a-glance { min-width: 500px; }' });
    assert.ok(await pageWidth(page) > 375, 'plant: a wide glance reads red');
  });
});

test('AC-10: one column of blocks at 1280 px, focus that shows, one look in both themes', RETIRED('AC-13'), async () => {
  await withPage(1280, 900, async (page) => {
    const edges = await page.evaluate(() => ['#at-a-glance', '.r019-before', 'section.placebo-result', '#report-020 .table-wrap'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.left), Math.round(r.right)]; }));
    for (const [s, l, r] of edges) { assert.ok(Math.abs(l - edges[0][1]) <= 1 && Math.abs(r - edges[0][2]) <= 1, 'one left and right edge: ' + JSON.stringify(edges)); void s; }
    // Forward, then back, so the focus arrives from the keyboard. Back first would land on a glossary
    // term before it, whose island opens a card with links of its own.
    const focusOf = async (sel) => { await page.focus(sel); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); return page.evaluate((q) => { const e = document.activeElement, c = getComputedStyle(e); return { same: e === document.querySelector(q), style: c.outlineStyle, width: parseFloat(c.outlineWidth) }; }, sel); };
    for (const sel of ['#at-a-glance tr.r019-entry a', 'section.placebo-result > details > summary']) {
      const f = await focusOf(sel); assert.ok(f.same && f.style !== 'none' && f.width >= 2, 'focus shows on ' + sel + ': ' + JSON.stringify(f));
    }
    const colours = (theme) => page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); return ['.r019-chip', 'tr.r019-entry', 'section.placebo-result > details > summary', '.r019-before'].map((s) => { const c = getComputedStyle(document.querySelector(s)); return [c.color, c.backgroundColor, c.borderColor]; }); }, theme);
    assert.deepEqual(await colours('light'), await colours('dark'), 'one committed look in both themes');
    await page.addStyleTag({ content: '#at-a-glance a:focus-visible { outline: none !important; }' });
    const f = await focusOf('#at-a-glance tr.r019-entry a'); assert.equal(f.style, 'none', 'plant: no outline reads red');
  });
});
