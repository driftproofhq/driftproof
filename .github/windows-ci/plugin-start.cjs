// SPDX-License-Identifier: Apache-2.0
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const c = require('./common.cjs');
function assertSample(observation) {
  const { result, metadata: m, pageExists, pageBytes, before, after } = observation;
  c.success(result, 'AC-15 sample');
  assert.ok(result.stdout.includes('no SKILL.md found under '), 'AC-15 empty directory');
  const sentence = 'a sample results page, opened from this plugin with no model call and nothing written: report ' + m.report + ' holds ' + m.runs + ' runs of ' + m.skill + ' on ' + m.model + ', run ' + m.dates.join(', ') + ', and the page shows every one.';
  assert.ok(result.stdout.includes(sentence), 'AC-15 independent sample metadata');
  assert.ok(result.stdout.includes("It is a sample of report " + m.report + "'s runs, not a result for a skill of yours."), 'AC-15 sample disclaimer');
  assert.ok(result.stdout.includes('the results page is ' + m.page + ' (file://' + m.page + ')'), 'AC-15 sample page path');
  assert.equal(pageExists, true, 'AC-15 sample page exists'); assert.ok(pageBytes > 0, 'AC-15 nonempty sample page');
  assert.deepEqual(after, before, 'AC-15 sample wrote files');
}
function assertListing(observation) {
  const { result, expected, before, after } = observation;
  c.success(result, 'AC-15 listing');
  assert.ok(result.stdout.includes('skills under '), 'AC-15 listing heading');
  assert.doesNotMatch(result.stdout, /sample results page|the results page is/, 'AC-15 no sample for a listing');
  const actual = {};
  for (const line of result.stdout.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^  (.+?)  \((has test cases|no test cases yet)\)$/.exec(line);
    if (!match) continue;
    const name = match[1].replace(/\\/g, '/');
    assert.ok(!Object.hasOwn(actual, name), 'AC-15 unique listed skill');
    actual[name] = match[2] === 'has test cases';
  }
  assert.deepEqual(actual, expected, 'AC-15 complete listing and case status');
  assert.deepEqual(after, before, 'AC-15 listing wrote files');
}
function runPlugin() {
  c.prepare(); const plant = c.plantArg(['sample', 'listing']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'windows plugin '));
  const plugin = path.join(c.ROOT, 'plugin/driftproof'), beforePlugin = c.snapshot(plugin);
  try {
    const empty = path.join(dir, 'empty'), listing = path.join(dir, 'listing');
    fs.mkdirSync(empty); fs.mkdirSync(listing);
    const sample = path.join(plugin, 'sample'), reports = fs.readdirSync(sample).filter((f) => /^report-\d+$/.test(f));
    assert.equal(reports.length, 1, 'AC-15 one bundled report');
    const receipts = [];
    function walk(at) {
      for (const e of fs.readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, e.name);
        if (e.isDirectory()) walk(full); else if (e.name.endsWith('.json')) receipts.push(JSON.parse(fs.readFileSync(full, 'utf8')));
      }
    }
    walk(path.join(sample, reports[0])); assert.ok(receipts.length, 'AC-15 bundled receipts');
    assert.equal(new Set(receipts.map((r) => r.skill.name)).size, 1); assert.equal(new Set(receipts.map((r) => r.run.model_id)).size, 1);
    const page = path.join(sample, 'driftproof-view.html');
    const metadata = { report: reports[0].slice('report-'.length), runs: receipts.length,
      skill: receipts[0].skill.name, model: receipts[0].run.model_id,
      dates: [...new Set(receipts.map((r) => r.run.date_utc.slice(0, 10)))].sort(), page };
    const env = { ...c.cleanEnv(), GIT_CEILING_DIRECTORIES: dir };
    const before = c.snapshot(empty);
    const result = c.run(process.execPath, [path.join(plugin, 'lib/door.mjs'), 'start'], { cwd: empty, env });
    if (plant === 'sample') result.status = 1;
    assertSample({ result, metadata, pageExists: fs.statSync(page).isFile(), pageBytes: fs.statSync(page).size, before, after: c.snapshot(empty) });
    const expected = { ready: true, draft: false, '.claude/skills/hidden': true };
    for (const [relative, cases] of Object.entries(expected)) {
      const at = path.join(listing, relative); fs.mkdirSync(at, { recursive: true });
      fs.writeFileSync(path.join(at, 'SKILL.md'), '---\nname: ' + path.basename(at) + '\n---\n\nBe brief.\n');
      if (cases) { fs.mkdirSync(path.join(at, 'evals')); fs.writeFileSync(path.join(at, 'evals/evals.json'), JSON.stringify({ cases: [{ id: 'one', prompt: 'Q', rubric: 'R' }] })); }
    }
    const beforeList = c.snapshot(listing);
    const listed = c.run(process.execPath, [path.join(plugin, 'lib/door.mjs'), 'start'], { cwd: listing, env });
    if (plant === 'listing') listed.stdout = 'skills under fixture:\n';
    assertListing({ result: listed, expected, before: beforeList, after: c.snapshot(listing) });
    c.assertUnchanged(beforePlugin, c.snapshot(plugin));
    console.log('Windows plugin start: bundled sample and all three listed skills passed; no bytes written');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (!plant) {
    for (const name of ['sample', 'listing']) c.ownMutation(__filename, name, 'AC-15');
    console.log('Windows plugin start: sample and listing executable-boundary mutations rejected');
  }
}
if (require.main === module) c.main(runPlugin);
module.exports = { assertSample, assertListing, runPlugin };
