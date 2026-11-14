// SPDX-License-Identifier: Apache-2.0
'use strict';
// tests/readme-current.test.js - issue 797: the public README is current.
//
// Every report count the README says is docs/data/reports.json's list (held to the report pages), in
// words, and a planted stale count reads red. The free measurement line says only the /measure/ page's
// own sentences and links it. The paper line carries version 2's facts from docs/data/paper.json.
//
//   node --test tests/readme-current.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const RC = require('../scripts/report-count.js');

const ROOT = path.join(__dirname, '..');
const readme = () => fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const essay = () => fs.readFileSync(path.join(ROOT, 'docs', 'writing', 'three-releases', 'index.html'), 'utf8');
const reportsJson = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'reports.json'), 'utf8')).reports;
const counts = () => ({
  reports: RC.numberWord(RC.reportCount(ROOT)),
  kinds: RC.numberWord(new Set(reportsJson().map((r) => r.type.value)).size),
  essay: RC.essayCount(essay()),
});
const opening = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'build-readme-opening.mjs')).href);

test('the count is the report list, held to the report pages', () => {
  assert.strictEqual(RC.reportCount(ROOT), reportsJson().length);
  const pages = fs.readdirSync(path.join(ROOT, 'docs', 'reports')).filter((x) => /^\d+$/.test(x) && fs.existsSync(path.join(ROOT, 'docs', 'reports', x, 'index.html')));
  assert.strictEqual(pages.length, reportsJson().length);
});

test('PLANT: a listed report with no page, and a page not listed, each throw', () => {
  const listed = reportsJson().map((r) => String(r.number.value));
  assert.throws(() => RC.listAgainstPages([...listed, '020'], listed), /listed without a page \["020"\]/);
  assert.throws(() => RC.listAgainstPages(listed, [...listed, '012']), /a page not listed \["012"\]/);
});

test('every README count sentence says the report list\'s count', () => {
  const c = counts();
  assert.deepStrictEqual(RC.staleReadmeCounts(readme(), c), []);
  const link = /\[All ([a-z-]+) reports\]\(#reports\)/.exec(readme());
  assert.ok(link, 'the first screen links "All <word> reports"');
  assert.strictEqual(link[1], c.reports);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'stats.json'), 'utf8')).reports_published_word.value, c.reports);
});

test('PLANT: a stale count in each README sentence reads red', () => {
  const c = counts();
  const text = readme();
  const other = RC.numberWord(RC.reportCount(ROOT) - 1);
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  for (const [from, to, what] of [
    [`${cap(c.reports)} reports are published`, `${cap(other)} reports are published`, "the roll's opening sentence"],
    [`**${cap(c.reports)} published reports**`, `**${cap(other)} published reports**`, "the roll's heading line"],
    [`reads all ${c.essay} reports`, `reads all ${other} reports`, "the launch essay's count"],
  ]) {
    assert.ok(text.includes(from), `README.md carries ${from}`);
    assert.deepStrictEqual(RC.staleReadmeCounts(text.replace(from, to), c), [what]);
  }
});

test('PLANT: the first screen with a stale count reads red', async () => {
  const { composeOpening, ANCHOR } = await opening();
  const text = readme();
  const head = text.slice(0, text.indexOf(ANCHOR));
  assert.strictEqual(composeOpening({ root: ROOT }), head);
  const c = counts();
  const stale = head.replace(`[All ${c.reports} reports]`, `[All ${RC.numberWord(RC.reportCount(ROOT) - 1)} reports]`);
  assert.notStrictEqual(stale, head);
  assert.notStrictEqual(composeOpening({ root: ROOT }), stale);
});

test('the next report moves every count, with no word list to run out', () => {
  assert.strictEqual(RC.numberWord(19), 'nineteen');
  assert.strictEqual(RC.numberWord(21), 'twenty-one');
  const next = RC.writeReadmeCounts(readme(), { ...counts(), reports: 'nineteen', essay: 'nineteen' });
  assert.ok(next.includes('Nineteen reports are published'));
  assert.ok(next.includes('**Nineteen published reports**'));
  assert.ok(next.includes('reads all nineteen reports'));
  assert.deepStrictEqual(RC.staleReadmeCounts(next, { ...counts(), reports: 'nineteen', essay: 'nineteen' }), []);
});

test('the free measurement line is present, linked, and says only the page\'s words', async () => {
  const { measureLine } = await opening();
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'readme-opening.json'), 'utf8'));
  const line = measureLine(ROOT, d.measure);
  assert.match(line, /\]\(https:\/\/driftproofhq\.com\/measure\/\)/);
  assert.ok(readme().includes(line.trim()), 'README.md carries the composed measure line');
  const page = fs.readFileSync(path.join(ROOT, 'docs', 'measure', 'index.html'), 'utf8').replace(/&#39;/g, "'");
  for (const s of d.measure.sentences) assert.ok(page.includes(s), `the published /measure/ page says ${s}`);
  assert.ok(readme().indexOf(line.trim()) < readme().indexOf('Driftproof **consumes**'), 'the line is on the first screen');
});

test('PLANT: a measure sentence the page does not say throws', async () => {
  const { measureLine } = await opening();
  assert.throws(() => measureLine(ROOT, { label: 'Free measurement', sentences: ['Send us your skills.', 'Every skill passes.'] }), /do not say "Every skill passes\."/);
});

test('the paper line carries version 2 and links the paper page', async () => {
  const { paperBlock } = await opening();
  const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'paper.json'), 'utf8'));
  const block = paperBlock(ROOT);
  assert.ok(readme().includes(block), 'README.md carries the composed paper block');
  const flat = block.replace(/\s+/g, ' ');
  for (const s of ['](https://driftproofhq.com/paper/)', `[${P.doi}](https://doi.org/${P.doi})`, `[${P.concept_doi}](https://doi.org/${P.concept_doi})`, P.version_line]) assert.ok(flat.includes(s), `the paper line carries ${s}`);
  assert.strictEqual(P.doi, '10.5281/zenodo.24136677');
  assert.ok(!readme().includes(P.earlier.doi), 'README.md does not name version 1\'s DOI');
});

test('nothing new in the README carries an em dash', () => {
  const text = readme();
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'readme-opening.json'), 'utf8'));
  const begin = text.indexOf('<!--driftproof:readme-paper-->');
  const end = text.indexOf('<!--/driftproof:readme-paper-->');
  assert.ok(begin >= 0 && end > begin);
  const roll = (/^- \*\*\[Report #019\][^\n]*/m.exec(text) || [''])[0];
  assert.ok(roll, 'the roll carries Report 019');
  for (const s of [text.slice(begin, end), roll, d.measure.label, ...d.measure.sentences]) assert.ok(!s.includes('\u2014'), JSON.stringify(s.slice(0, 60)));
});
