// SPDX-License-Identifier: Apache-2.0
'use strict';

// Tests for the PATH a sweep runs under (spec 029 A-029-2): scripts/nightly.mjs stops at its start,
// exit 2, when `claude` or `spectrace` is not on PATH, and prints the PATH it read; the sweep's record
// carries the PATH in its header; and the sweep prints it first. No gate runs, nothing is cloned that
// the test does not make, and nothing is downloaded.
//
//   node --test tests/sweep-path.test.js
//
// Every test name starts with the criterion it checks; spec 029's gate runs this file whole.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const NIGHTLY = path.join(ROOT, 'scripts', 'nightly.mjs');
const SWEEP = path.join(ROOT, 'specs', '029-scanner-loop', 'probes', 'sweep.mjs');
const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sweep-path-test-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

// A bin directory holding executable stand-ins for the named tools, and git's own directory, so a
// nightly that passes the check can reach its clone. node is run by absolute path.
function binWith(dir, names, { executable = true } = {}) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(bin, n), '#!/bin/sh\nexit 0\n', { mode: executable ? 0o755 : 0o644 });
  return bin;
}
const gitDir = () => {
  const r = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' });
  return path.dirname(r.stdout.trim());
};
function nightly(dir, PATH) {
  const state = path.join(dir, 'state');
  const r = spawnSync(process.execPath, [NIGHTLY, '--repo', path.join(dir, 'no-such-repository'), '--state', state, '--inputs-from', dir],
    { encoding: 'utf8', env: { ...process.env, PATH, DP_LOCK_OWNER: 'test' }, timeout: 60000 });
  return { r, state };
}

test('AC-13 a nightly with neither claude nor spectrace on PATH stops at its start, exit 2, naming both and the PATH', () => {
  const dir = tmp();
  try {
    const bin = binWith(dir, []);
    const { r, state } = nightly(dir, `${bin}${path.delimiter}${gitDir()}`);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /REFUSING: claude and spectrace not found on PATH/);
    assert.ok(r.stderr.includes(`PATH: ${bin.split(`${os.homedir()}/`).join('~/')}`), r.stderr);
    assert.equal(fs.existsSync(state), false, 'a refused nightly makes no state directory and clones nothing');
  } finally { rm(dir); }
});

test('AC-13 a nightly with one of the two missing names that one only', () => {
  const dir = tmp();
  try {
    const bin = binWith(dir, ['claude']);
    const { r } = nightly(dir, `${bin}${path.delimiter}${gitDir()}`);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /REFUSING: spectrace not found on PATH/);
    assert.doesNotMatch(r.stderr, /REFUSING: claude/);
  } finally { rm(dir); }
});

test('AC-13 a file named claude that is not executable is not on PATH', () => {
  const dir = tmp();
  try {
    const bin = binWith(dir, ['claude', 'spectrace'], { executable: false });
    const { r } = nightly(dir, `${bin}${path.delimiter}${gitDir()}`);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /REFUSING: claude and spectrace not found on PATH/);
  } finally { rm(dir); }
});

test('AC-13 with both on PATH the nightly passes the check and goes on to its clone', () => {
  const dir = tmp();
  try {
    const bin = binWith(dir, ['claude', 'spectrace']);
    const { r } = nightly(dir, `${bin}${path.delimiter}${gitDir()}`);
    // The repository named does not exist, so the run stops at the clone: past the check.
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /REFUSING/);
    assert.match(r.stderr, /nightly: clone of .* failed/);
    assert.match(r.stderr.split('\n')[0], /^nightly: PATH /, 'the PATH is the first line');
  } finally { rm(dir); }
});

test('AC-13 the sweep record carries the PATH in its header, and the sweep prints it first', async () => {
  const sweep = await import(pathToFileURL(SWEEP).href);
  const rec = await sweep.sweepRun({ only: ['no-such-spec'] });
  assert.equal(rec.runs.length, 0);
  assert.equal(rec.path, process.env.PATH);
  const keys = Object.keys(rec);
  assert.ok(keys.indexOf('path') > -1 && keys.indexOf('path') < keys.indexOf('discovered'), `path is a header field: ${keys.join(', ')}`);
  assert.equal(sweep.pathLine({ PATH: '/h/u/.local/bin:/usr/bin' }, '/h/u'), '  PATH: ~/.local/bin:/usr/bin\n');
  assert.equal(sweep.pathLine({}, '/h/u'), '  PATH: (unset)\n');
  // The CLI's first line, read from a run that stops at once: --core of a spec no tree carries.
  const r = spawnSync(process.execPath, [SWEEP, '--core', 'no-such-spec'], { encoding: 'utf8', cwd: ROOT, timeout: 60000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr.split('\n')[0], /^ {2}PATH: /);
});
