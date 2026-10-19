// SPDX-License-Identifier: Apache-2.0
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const c = require('./common.cjs');
const inventory = require('./row-inventory.json');
const CORE_FILES = ['tests/init.test.js', 'tests/firstrun.test.js', 'tests/progress.test.js',
  'tests/plain.test.js', 'tests/verdict-band.test.js', 'tests/answers-retention.test.js', 'tests/view-answers.test.js'];
function assertRows(rows, expected) {
  assert.ok(Array.isArray(rows), 'AC-16 row inventory exists');
  for (const row of rows) {
    assert.equal(row.status, 'pass', 'AC-16 row passed'); assert.equal(row.skip, false, 'AC-16 no skipped row'); assert.equal(row.todo, false, 'AC-16 no todo row');
    assert.ok(Array.isArray(row.identity) && row.identity.length && row.identity.every((x) => typeof x === 'string'), 'AC-16 full row identity');
  }
  const actual = rows.map((row) => JSON.stringify(row.identity));
  const wanted = expected.map((identity) => JSON.stringify(identity));
  assert.equal(new Set(wanted).size, wanted.length, 'AC-16 unique expected inventory');
  assert.equal(new Set(actual).size, actual.length, 'AC-16 duplicate row identity');
  assert.deepEqual(actual.sort(), wanted.sort(), 'AC-16 missing or unexpected row inventory identity');
}
function assertResults(results) {
  assert.deepEqual(results.map((r) => r.file).sort(), [...CORE_FILES].sort(), 'AC-16 completed file set');
  for (const result of results) {
    c.success(result, 'AC-16 ' + result.file);
    assertRows(result.rows, inventory[result.file]);
    const counts = {};
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
      if (!match) continue;
      assert.ok(!Object.hasOwn(counts, match[1]), 'AC-16 unique summary field'); counts[match[1]] = Number(match[2]);
    }
    assert.deepEqual(Object.keys(counts).sort(), ['cancelled', 'fail', 'pass', 'skipped', 'tests', 'todo'], 'AC-16 complete summary');
    assert.ok(counts.tests > 0, 'AC-16 nonempty test file');
    assert.equal(counts.tests, inventory[result.file].length, 'AC-16 summary equals row inventory');
    assert.equal(counts.pass, counts.tests, 'AC-16 every row passed');
    for (const field of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(counts[field], 0, 'AC-16 ' + field);
  }
}
function collectFile(file, actual = path.join(c.ROOT, file), extra = []) {
  const result = c.run(process.execPath, ['--test', '--test-reporter', path.join(__dirname, 'row-reporter.cjs'), ...extra, actual]);
  const rows = [], fields = [];
  for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
    const record = JSON.parse(line);
    if (record.type === 'row') { const { type, ...row } = record; rows.push(row); }
    else { assert.equal(record.type, 'summary'); fields.push('# ' + record.field + ' ' + record.value); }
  }
  return { ...result, stderr: result.stderr + rows.filter((r) => r.status === 'fail').map((r) => r.identity.join(' / ') + ': ' + r.error).join('\n'), file, rows, stdout: fields.join('\n') + '\n' };
}
function rowMutationTests() {
  const file = 'tests/progress.test.js';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'windows rows '));
  try {
    let source = fs.readFileSync(path.join(c.ROOT, file), 'utf8');
    source = source.replace(/require\('([.][.]\/[^']+)'\)/g, (_, relative) => 'require(' + JSON.stringify(path.resolve(c.ROOT, 'tests', relative)) + ')');
    assert.ok(source.includes('\ntest('), 'AC-16 conditional plant anchor');
    source = "const process = { platform: 'win32' };\n" + source.replace('\ntest(', "\nif (process.platform !== 'win32') test(");
    const planted = path.join(dir, 'conditional.cjs'); fs.writeFileSync(planted, source);
    const conditional = collectFile(file, planted); c.success(conditional, 'AC-16 conditional registration plant completed');
    assert.equal(conditional.rows.length, inventory[file].length - 1, 'AC-16 one conditionally omitted registration');
    assert.throws(() => assertRows(conditional.rows, inventory[file]), /AC-16/);
    const filtered = collectFile(file, undefined, ['--test-name-pattern', '^durations read as']);
    c.success(filtered, 'AC-16 name-filter plant completed');
    const ran = filtered.rows.filter((r) => !r.skip && r.status === 'pass').length;
    assert.ok(ran > 0 && ran < inventory[file].length, 'AC-16 filter narrows the executed rows');
    assert.throws(() => assertRows(filtered.rows, inventory[file]), /AC-16/);
    const nested = path.join(dir, 'nested.cjs');
    fs.writeFileSync(nested, "const test=require('node:test');test('parent',async t=>{await t.test('child',()=>{});});\n");
    const nestedResult = collectFile('nested fixture', nested); c.success(nestedResult, 'AC-16 nested control');
    assertRows(nestedResult.rows, [['parent'], ['parent', 'child']]);
    assert.throws(() => assertRows([...nestedResult.rows, nestedResult.rows[0]], [['parent'], ['parent', 'child']]), /duplicate/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function runCore() {
  c.prepare(); const plant = c.plantArg(['row']);
  const results = CORE_FILES.map((file) => collectFile(file));
  // Actual collection boundary: mutate after the real reporter has returned.
  if (plant === 'row') results[0].rows.pop();
  assertResults(results);
  rowMutationTests();
  if (!plant) c.ownMutation(__filename, 'row', 'AC-16');
  console.log('Windows core: ' + CORE_FILES.length + ' files, ' + results.reduce((n, r) => n + r.rows.length, 0) + ' inventoried rows passed, 0 skipped; conditional, filter, duplicate and executable plants rejected');
}
if (require.main === module) c.main(runCore);
module.exports = { CORE_FILES, assertRows, assertResults, collectFile, rowMutationTests, runCore };
