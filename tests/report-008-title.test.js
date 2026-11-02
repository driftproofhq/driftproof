// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for Report 008's corrected title (issue 582, spec 031 A-031-34), which
// scripts/report-corrections.js writes: the entry is not written when a case in either arm separates
// across the release (I-2), and stripInterimLines takes out exactly the entry and the <h1> swap (I-4).
//
//   node --test tests/report-008-title.test.js
//
// The two titles are typed from the amendment, not read from the script under test.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rc = require('../scripts/report-corrections.js');
const { CELLS } = require('../scripts/prepare-report-008.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const page = () => read('docs/reports/008/index.html');
const WAS = '<h1>Report 008: the skill stabilises the floor, not the ceiling</h1>';
const NOW = '<h1>Report 008: Claude Fable 5.1, no separation detected across the release in either arm</h1>';
const cells = () => CELLS.map((c) => ({ slug: c.slug, from: c.from, baseline: c.baseline, receipt: c.receipt }));

// The cells with the newer code-review receipt replaced by a copy in which one arm of one case is
// moved far below its older band, so that case separates across the release.
const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function plantedCells(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r008-title-'));
  dirs.push(dir);
  const cs = cells();
  const r = JSON.parse(read(cs[0].receipt));
  const c = r.results.cases.find((x) => x.id === 'commit-message-imperative-body' && x.mode === mode);
  c.generation.mean = 0.5;
  const file = path.join(dir, path.basename(cs[0].receipt));
  fs.writeFileSync(file, JSON.stringify(r));
  cs[0].receipt = path.relative(ROOT, file);
  return cs;
}

test('I-4 the page carries the corrected title, and applying the corrections to it changes nothing', () => {
  const p = page();
  assert.equal(p.split(NOW).length, 2);
  assert.ok(!p.includes(WAS));
  assert.equal(rc.applyToPage(p, '008', { cells: cells() }), p);
});

test('I-4 stripInterimLines puts the first title back and takes every inserted entry out, exactly', () => {
  const p = page();
  const bare = rc.stripInterimLines(p, '008');
  assert.notEqual(bare, p);
  assert.equal(bare.split(WAS).length, 2);
  assert.ok(!bare.includes(NOW));
  for (const id of ['amendment-title', 'amendment-lost-draw', 'amendment-interim-note', 'interim-note']) assert.ok(!bare.includes(`id="${id}"`), id);
  assert.equal(rc.applyToPage(bare, '008', { cells: cells() }), p);
});

test('I-4 a word changed in the title entry stays in what the strip returns, and the script refuses the page', () => {
  const p = page();
  const tweaked = p.replace('This entry corrects the page&rsquo;s title', 'This entry corrects the title');
  assert.notEqual(tweaked, p);
  assert.equal(rc.stripInterimLines(tweaked, '008'), tweaked);
  assert.throws(() => rc.applyToPage(tweaked, '008', { cells: cells() }), /title entry that is not the one this script writes/);
});

test('I-2 a case that separates across the release, in either arm, stops the title entry', () => {
  const bare = rc.stripInterimLines(page(), '008');
  for (const mode of ['with_skill', 'baseline']) {
    assert.throws(() => rc.applyToPage(bare, '008', { cells: plantedCells(mode) }), /separated across the release/, mode);
  }
});
