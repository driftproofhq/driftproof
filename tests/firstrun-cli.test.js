// SPDX-License-Identifier: Apache-2.0
'use strict';

// End-to-end unit tests for spec 138's run changes through bin/driftproof (AC-1, AC-7): the
// progress lines, and the warning when the judge is the target.
//
//   node --test tests/firstrun-cli.test.js
//
// THE MODEL IS SPEC 028'S FAKE `claude` (specs/028-claude-code-plugin/probes/bin/claude), first on
// PATH, reached on the trusted lane, so the progress run makes real calls to a double. The other
// runs are stub runs. No credential is in any environment here, and nothing is spent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SAMPLING } = require('../lib/sampling');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const FAKE_BIN = path.join(ROOT, 'specs', '028-claude-code-plugin', 'probes', 'bin');
const MODEL = 'claude-haiku-4-5';
const made = [];
let SPAWNLOG = null;
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec138-cli-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function env(extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^OPENAI_|^DRIFTPROOF_|^SPEC0/.test(k)) continue;
    e[k] = v;
  }
  e.PATH = [FAKE_BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
  if (SPAWNLOG) e.SPEC028_SPAWNLOG = SPAWNLOG;
  return { ...e, ...extra };
}
const cli = (args, cwd, extra) => spawnSync(process.execPath, [BIN, ...args], { cwd, env: env(extra), encoding: 'utf8', timeout: 300000 });

function skill(root, n) {
  const dir = path.join(root, `fx-skill-${n}`);
  fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: fx-skill-${n}\nversion: 1.0.0\n---\n\n# fx-skill-${n}\n\nAnswer in one short sentence.\n`);
  const cases = Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, prompt: `Question ${i + 1}?`, rubric: 'One short sentence scores 0.80.' }));
  fs.writeFileSync(path.join(dir, 'evals', 'evals.json'), JSON.stringify({ cases }, null, 2));
  return dir;
}

// The run the progress and warning tests read: a two-case skill, answered by the fake, no judge set.
let FX = null;
function fixture() {
  if (FX) return FX;
  const root = tmp();
  SPAWNLOG = path.join(root, 'spawns.ndjson');
  const two = skill(root, 2);
  const control = cli(['run', two, '--trusted-skill', '--models', MODEL, '--samples', '2', '--out', path.join(root, 'control')], root);
  assert.equal(control.status, 0, control.stderr.slice(-800));
  FX = { root, control };
  return FX;
}

test('every call was answered by the fake claude, and none carried a key', () => {
  fixture();
  const spawns = fs.readFileSync(SPAWNLOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(spawns.length > 0, 'the fake was reached');
  for (const s of spawns) {
    assert.equal(s.bin, 'claude');
    assert.equal(s.viaFakeBin, true);
    assert.equal(s.had_api_key, false);
  }
});

test('progress: a line per call or judge batch on stderr, the last naming the calls the run reports; none on stdout', () => {
  const { control } = fixture();
  const lines = control.stderr.split('\n').filter((l) => l.includes('progress: call '));
  assert.ok(lines.length > 0);
  assert.doesNotMatch(control.stdout, /progress: call /);
  const last = /progress: call (\d+) of/.exec(lines[lines.length - 1]);
  const reported = /\((\d+) calls\)/.exec(control.stdout);
  assert.equal(Number(last[1]), Number(reported[1]));
  const first = /progress: call 1 of (\d+) to (\d+)/.exec(lines[0]);
  assert.ok(first, lines[0]);
  const perDraw = 1 + 2;
  assert.equal(Number(first[1]), 2 * 2 * SAMPLING.min * perDraw);
  assert.equal(Number(first[2]), 2 * 2 * SAMPLING.max * perDraw);
});

test('the judge is the target: a loud warning on stderr before the first progress line, and none for another judge', () => {
  const { control } = fixture();
  const err = control.stderr;
  const w = err.indexOf('WARNING: the judge is the target model');
  assert.ok(w >= 0, err.slice(0, 400));
  assert.ok(w < err.indexOf('progress: call '));
  const root = tmp();
  const dir = skill(root, 1);
  const other = cli(['run', dir, '--models', MODEL, '--judge-model', 'claude-sonnet-5', '--max-cases', '1', '--samples', '1', '--out', path.join(root, 'o')], root, { DRIFTPROOF_STUB: '1' });
  assert.equal(other.status, 0, other.stderr);
  assert.doesNotMatch(other.stderr, /WARNING: the judge/);
  const dated = cli(['run', dir, '--models', MODEL, '--judge-model', 'claude-haiku-4-5-20251001', '--max-cases', '1', '--samples', '1', '--out', path.join(root, 'o2')], root, { DRIFTPROOF_STUB: '1' });
  assert.match(dated.stderr, /WARNING: the judge is the target model, claude-haiku-4-5\./);
});
