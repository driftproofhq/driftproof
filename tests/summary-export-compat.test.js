// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const file = 'tests/fixtures/export-summary.snapshot.json';
const original = fs.readFileSync(path.join(ROOT, file), 'utf8');
function generator(text) {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/pipeline.mjs'), 'utf8');
  const begin = source.indexOf('function recutSnapshot(');
  const end = source.indexOf('\nfunction checkTouched(', begin);
  assert.ok(begin >= 0 && end > begin);
  const writes = [];
  const build = new Function('fs', 'path', 'SNAPSHOT_FILE', 'readText', source.slice(begin, end) + '; return recutSnapshot;')(
    { writeFileSync: (p, next) => { assert.equal(p, path.join(ROOT, file)); writes.push(next); } }, path, file, () => text);
  const changed = build(ROOT, (root, argv) => {
    assert.equal(root, ROOT); assert.equal(argv[0], '-e');
    let output = '';
    vm.runInNewContext(argv[1], { require: createRequire(path.join(ROOT, 'package.json')), process: { stdout: { write: s => { output += s; } } } });
    return output;
  });
  return { changed, writes };
}
test('814: the snapshot generator preserves the historical summary and rejects changed leaves', () => {
  assert.deepEqual(generator(original), { changed: false, writes: [] });
  for (const mutate of [x => { x.scores.with_skill.mean = 0.1; }, x => { delete x.placebo; }]) {
    const plant = JSON.parse(original); mutate(plant);
    assert.throws(() => generator(JSON.stringify(plant, null, 1) + '\n'), /more than receipt_hash/);
  }
  const hashPlant = JSON.parse(original); hashPlant.receipt_hash = '0'.repeat(64);
  assert.deepEqual(generator(JSON.stringify(hashPlant, null, 1) + '\n'), { changed: true, writes: [original] });
  assert.equal(fs.readFileSync(path.join(ROOT, file), 'utf8'), original);
});
