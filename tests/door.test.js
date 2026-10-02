// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for the plugin door's spec 138 change (AC-4): the three flags passed through to the
// CLI after the contract, and a second positional refused.
//
//   node --test tests/door.test.js
//
// THE DOUBLES ARE SPEC 028'S: its fake `npx` maps `driftproof@<pinned>` onto this checkout's
// bin/driftproof and logs every argument vector. Every folder is under the system temp
// directory, in a git repository made there, and removed after.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOOR = path.join(ROOT, 'plugin', 'driftproof', 'lib', 'door.mjs');
const FAKE_BIN = path.join(ROOT, 'specs', '028-claude-code-plugin', 'probes', 'bin');
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec138-door-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A sandbox: a working folder, a skill in it, and a spawn log.
function sandbox({ suite = true, repo = true } = {}) {
  const root = tmp();
  const work = path.join(root, 'work');
  const skill = path.join(work, 'my-skill');
  fs.mkdirSync(path.join(skill, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: my-skill\n---\n\n# my-skill\n\nBe brief.\n');
  if (suite) fs.writeFileSync(path.join(skill, 'evals', 'evals.json'), JSON.stringify({ cases: [{ id: 'a', prompt: 'Q?', rubric: 'R' }] }));
  else fs.rmdirSync(path.join(skill, 'evals'));
  if (repo) spawnSync('git', ['init', '-q'], { cwd: work });
  return { root, work, skill, log: path.join(root, 'spawns.ndjson') };
}
function door(sb, args, { stub = true, extra = {} } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^OPENAI_|^DRIFTPROOF_|^SPEC0|^GIT_/.test(k)) continue;
    env[k] = v;
  }
  Object.assign(env, {
    PATH: [FAKE_BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    SPEC028_ROOT: ROOT,
    SPEC028_SPAWNLOG: sb.log,
    GIT_CEILING_DIRECTORIES: sb.root,
    ...(stub ? { DRIFTPROOF_STUB: '1' } : {}),
    ...extra,
  });
  return spawnSync(process.execPath, [DOOR, ...args], { cwd: sb.work, env, encoding: 'utf8', timeout: 300000 });
}
const spawns = (sb) => (fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const npx = (sb) => spawns(sb).filter((s) => s.bin === 'npx').map((s) => s.argv.slice(1));

test('run passes --samples, --concurrency and --max-cases, once each, after the contract', () => {
  const sb = sandbox();
  const r = door(sb, ['run', 'my-skill', '--samples', '2', '--concurrency', '3', '--max-cases', '1']);
  assert.equal(r.status, 0, r.stderr);
  const run = npx(sb).find((v) => v[0] === 'run');
  assert.ok(run, JSON.stringify(npx(sb)));
  const pairs = (flag) => run.reduce((n, x, i) => n + (x === flag && run[i + 1] !== undefined ? 1 : 0), 0);
  assert.deepEqual([pairs('--samples'), pairs('--concurrency'), pairs('--max-cases')], [1, 1, 1]);
  assert.equal(run[run.indexOf('--samples') + 1], '2');
  assert.equal(run[run.indexOf('--concurrency') + 1], '3');
  assert.equal(run[run.indexOf('--max-cases') + 1], '1');
  assert.equal(run[run.length - 1], '--trusted-skill');
});

test('each payload the CLI refuses for the three flags, the door refuses first, naming the input, spawning nothing', () => {
  for (const flag of ['samples', 'concurrency', 'max-cases']) {
    for (const v of ['0', '01', '-1', 'abc', '1.5', '1;2', '$(id)', '`id`', '1\n2', '']) {
      const sb = sandbox();
      const r = door(sb, ['run', 'my-skill', `--${flag}`, v]);
      assert.equal(r.status, 2, `--${flag} ${JSON.stringify(v)}`);
      assert.match(r.stderr, new RegExp(`REFUSED: ${flag}: expected`), r.stderr);
      assert.equal(spawns(sb).length, 0, `--${flag} ${JSON.stringify(v)} spawned`);
    }
  }
});

test('a second positional is refused, spawning nothing', () => {
  const sb = sandbox();
  const r = door(sb, ['run', 'my-skill', 'other']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /run takes one folder and was given 2/);
  assert.equal(spawns(sb).length, 0);
});
