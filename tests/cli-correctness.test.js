// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 579: observable regressions and data plants, with no provider calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { releaseDateFor } = require('../lib/run');
const { loadRegistry } = require('../lib/models');
const { decideSet, githubOutputLines, decisionState } = require('../lib/decision');
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { importAnthropic } = require('../lib/importers-anthropic');
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin/driftproof');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'issue579-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const temp = () => fs.mkdtempSync(path.join(scratch, 'case-'));
const cli = args => spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
const output = d => Object.fromEntries([...githubOutputLines(d).matchAll(/^(\w+)<<([^\n]+)\n([^\n]*)\n\2$/gm)].map(m => [m[1], m[3]]));

test('579 release dates come from every registry row, including current models and aliases', () => {
  for (const row of loadRegistry().models) assert.equal(releaseDateFor(row.id), row.released ?? null, row.id);
  assert.equal(releaseDateFor('haiku'), releaseDateFor('claude-haiku-4-5'));
  assert.equal(releaseDateFor('unknown-model-20260101'), null);
});

test('579 an alternate registry owns dates; a dated id without a registry date stays null', () => {
  const file = path.join(temp(), 'models.json');
  const ids = ['claude-opus-5', 'claude-haiku-4-5-20251001', 'gpt-5.6-sol'];
  fs.writeFileSync(file, JSON.stringify({ models: [{ id: ids[0], released: '2026-01-02' }, { id: ids[1] }, { id: ids[2], released: null }] }));
  const child = spawnSync(process.execPath, ['-e', 'const {releaseDateFor}=require("./lib/run"); console.log(JSON.stringify(process.argv.slice(1).map(releaseDateFor)))', ...ids], {
    cwd: ROOT, env: { ...process.env, DRIFTPROOF_REGISTRY: file }, encoding: 'utf8', timeout: 1800000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), ['2026-01-02', null, null]);
});

test('579 Action delta is unavailable for an empty or missing reading, and preserves measured zero', () => {
  const dir = temp();
  assert.equal(output(decideSet(dir, '')).delta, 'n/a');
  assert.equal(output(decideSet(dir, 'claude-haiku-4-5')).delta, 'n/a');
  const d = decideSet(dir, 'claude-haiku-4-5');
  for (const delta of [0, -0.25, 0.25]) {
    d.rows[0].state = 'no detected effect'; d.rows[0].delta = delta; d.worst = 'no detected effect';
    assert.equal(output(d).delta, String(delta));
  }
  d.rows[0].smoke = true;
  assert.equal(output(d).delta, 'n/a');
  const r = cli(['decide', dir, '--models', 'claude-haiku-4-5', '--github-output']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^delta<<[^\n]+\nn\/a\n/m);
});

function passingSet() {
  const dir = temp();
  const source = path.join(ROOT, 'receipts/commit-message-conventions-claude-haiku-4-5-20251001-2026-09-16.json');
  const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
  assert.equal(validateReceipt(receipt).valid, true);
  assert.equal(verifyReceiptHash(receipt), true);
  assert.equal(decisionState(receipt), 'helped');
  fs.copyFileSync(source, path.join(dir, 'passing.json'));
  return { dir, model: receipt.run.model_id };
}

test('579 a corrupt receipt cannot disappear from a passing badge set', () => {
  const { dir, model } = passingSet();
  const good = cli(['badge', dir]);
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).color, 'brightgreen');
  fs.writeFileSync(path.join(dir, 'unrelated.json'), '{ truncated');
  const dest = path.join(temp(), 'badge.json');
  for (const flags of [[], ['--models', model], ['--github-output'], ['--out', dest]]) {
    const r = cli(['badge', dir, ...flags]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /unreadable/i);
    assert.match(r.stderr, /unrelated\.json/);
    assert.equal(r.stdout, '');
  }
  assert.equal(fs.existsSync(dest), false);
});

test('579 a directory containing only a corrupt receipt refuses as unreadable', () => {
  const dir = temp(); fs.writeFileSync(path.join(dir, 'broken.json'), '{');
  const r = cli(['badge', dir]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /unreadable/i);
  assert.equal(r.stdout, '');
});

test('579 imported quoted paths redact apostrophe-space suffixes in Node and browser cores', async () => {
  const cores = [await import('../lib/import-core/anthropic.mjs'), await import('../docs/import-core/anthropic.mjs')];
  const fixture = path.join(ROOT, 'specs/049-anthropic-formats-importer/fixtures/negative/errored-run.json');
  const local = ['~', "Ada' work", 'x.json'].join('/');
  for (const ending of ["'", '']) {
    const doc = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    doc.cases[0].arms.with[1].error = "said 'hello world'; open '" + local + ending;
    const bytes = JSON.stringify(doc);
    const file = path.join(temp(), 'aggregate-result.json'); fs.writeFileSync(file, bytes);
    const imported = importAnthropic(file, { from: 'claude-plugin-eval', importedAt: '2026-10-31T00:00:00Z' }).receipt;
    assert.equal(validateReceipt(imported).valid, true);
    assert.equal(verifyReceiptHash(imported), true);
    const receipts = [imported, ...cores.map(m => m.createAnthropicCore().prepare(new TextEncoder().encode(bytes), { from: 'claude-plugin-eval', importedAt: '2026-10-31T00:00:00Z' })())];
    for (const receipt of receipts) {
      const text = JSON.stringify(receipt);
      assert.doesNotMatch(text, /Ada|work|x\.json/);
      assert.match(text, /<local path>/);
      assert.match(text, /hello world/);
    }
  }
});

test('579 stale help includes the harness patch advisory among exit 3 causes', () => {
  const r = cli(['stale', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Exit 0 current, 1 stale, 3[^;]*patch[^;]*harness/s);
  assert.match(r.stdout, /--strict turns 3 into 1/);
});


test('579 Action enforcement accepts unavailable readings and still names missing models', () => {
  const dir = temp(), model = 'claude-haiku-4-5';
  const published = output(decideSet(dir, model));
  const enforce = (verdict, delta) => spawnSync('bash', [path.join(ROOT, 'action/enforce.sh')], {
    cwd: ROOT, encoding: 'utf8', timeout: 1800000,
    env: { ...process.env, GITHUB_ACTION_PATH: ROOT, DRIFTPROOF_RECEIPTS: dir,
      DRIFTPROOF_VERDICT: verdict, DRIFTPROOF_DELTA: delta, INPUT_MODELS: model,
      INPUT_FAIL_ON_REGRESSION: 'true', INPUT_FAIL_ON_UNDERPOWERED: 'false' },
  });
  const missing = enforce(published.verdict, published.delta);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout + missing.stderr, /claude-haiku-4-5/);
  assert.doesNotMatch(missing.stdout + missing.stderr, /delta: expected/);
  for (const [verdict, delta] of [['PASSED', 'n/a'], ['REFUSED', 'NaN'], ['REFUSED', 'n/a\nextra'], ['REFUSED', '']]) {
    const bad = enforce(verdict, delta);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout + bad.stderr, /delta: expected/);
  }
});
