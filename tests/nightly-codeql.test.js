// SPDX-License-Identifier: Apache-2.0
'use strict';

// Tests for the CodeQL step of scripts/nightly.mjs (spec 148), through `--codeql-only`: the sweep's
// own clone, checkout, scan call, report and exit code, with a stand-in for scripts/codeql-local.sh
// named by --codeql-script (the real scan is in the spec's gate). No gate runs, no CLI runs, nothing
// is downloaded.
//
//   node --test tests/nightly-codeql.test.js
//
// Every test name starts with the criterion it checks; spec 148's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const NIGHTLY = path.join(__dirname, '..', 'scripts', 'nightly.mjs');
const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'nightly-codeql-test-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

// A stand-in for scripts/codeql-local.sh: it records its arguments and the commit of the tree it was
// given, writes the summary the test names (unless it names none), and exits as told.
const STAND_IN = `#!/usr/bin/env bash
set -u
args="$*"; out=""; tree=""
while [ $# -gt 0 ]; do
  case "$1" in --out) out="$2"; shift ;; --tree) tree="$2"; shift ;; esac
  shift
done
mkdir -p "$out"
printf '%s\\n' "$args" > "$out/args.txt"
git -C "$tree" rev-parse HEAD > "$out/tree-head.txt"
if [ -n "\${FAKE_SUMMARY:-}" ]; then printf '%s\\n' "$FAKE_SUMMARY" > "$out/summary.json"; fi
exit "\${FAKE_EXIT:-0}"
`;

function world() {
  const dir = tmp();
  const src = path.join(dir, 'src');
  const git = (...a) => spawnSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
  fs.mkdirSync(src);
  git('init', '-q', '-b', 'dev');
  fs.writeFileSync(path.join(src, 'a.js'), 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'the commit swept');
  const script = path.join(dir, 'stand-in.sh');
  fs.writeFileSync(script, STAND_IN);
  return { dir, src, script, head: git('rev-parse', 'HEAD').stdout.trim(), state: path.join(dir, 'state') };
}
const SUMMARY = (o) => JSON.stringify({ state: 'clean', total: 11, on_baseline: 11, gone: [], new: [], extracted_files: 300, tool: '2.27.1', ...o });
function nightly(w, env, extra = []) {
  const r = spawnSync(process.execPath, [NIGHTLY, '--repo', w.src, '--ref', 'dev', '--state', w.state, '--inputs-from', w.src, '--codeql-only', '--codeql-script', w.script, '--codeql-out', path.join(w.dir, 'scans'), ...extra], { encoding: 'utf8', env: { ...process.env, ...env } });
  const runs = fs.existsSync(path.join(w.state, 'runs')) ? fs.readdirSync(path.join(w.state, 'runs')).sort() : [];
  const result = runs.length ? JSON.parse(fs.readFileSync(path.join(w.state, 'runs', runs[runs.length - 1], 'result.json'), 'utf8')) : null;
  return { r, result };
}
// The scan's own directory is under the world's directory, which the test removes.
const cleanUp = (w) => rm(w.dir);

test('AC-9 a scan with nothing off the baseline is GREEN, exit 0, and the scan was given the swept commit', () => {
  const w = world();
  const { r, result } = nightly(w, { FAKE_SUMMARY: SUMMARY({}), FAKE_EXIT: '0' });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /CodeQL scan .*: GREEN/);
    assert.match(r.stdout, /CodeQL \(local scan, default suite, CLI 2\.27\.1, 300 files\): 11 results, 11 on the baseline, 0 new\./);
    assert.match(r.stdout, /Script: .*stand-in\.sh\./);
    assert.equal(result.verdict, 'GREEN');
    const out = result.codeql.out;
    assert.equal(fs.readFileSync(path.join(out, 'tree-head.txt'), 'utf8').trim(), w.head);
    // The scan reads the committed bytes of the swept commit, not the working copy.
    assert.match(fs.readFileSync(path.join(out, 'args.txt'), 'utf8'), new RegExp(`^scan --tree .* --rev ${w.head} --out `));
    assert.equal(fs.existsSync(path.join(w.state, 'last.json')), false, 'a scan alone moves no state file');
    assert.equal(fs.existsSync(path.join(w.state, 'last-green.json')), false);
    assert.equal(fs.existsSync(path.join(w.state, 'morning-report.md')), false);
  } finally { cleanUp(w); }
});

test('AC-9 a result off the baseline is RED, exit 1, and the report names its rule, file and line', () => {
  const w = world();
  const summary = SUMMARY({ state: 'new', total: 13, new: [{ rule: 'js/bad-tag-filter', file: 'scripts/site-chrome.js', line: 444, message: 'm' }, { rule: 'js/redos', file: 'scripts/build-markdown.js', line: 56, message: 'm' }] });
  const { r, result } = nightly(w, { FAKE_SUMMARY: summary, FAKE_EXIT: '1' });
  try {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /CodeQL scan .*: RED/);
    assert.match(r.stdout, /13 results, 11 on the baseline, 2 new\./);
    assert.match(r.stdout, /^ {2}- js\/bad-tag-filter scripts\/site-chrome\.js:444$/m);
    assert.match(r.stdout, /^ {2}- js\/redos scripts\/build-markdown\.js:56$/m);
    assert.match(r.stdout, /Next: /);
    assert.equal(result.verdict, 'RED');
    assert.equal(result.codeql.state, 'new');
  } finally { cleanUp(w); }
});

test('AC-9 a scan that cannot be read is ERROR, exit 2, never GREEN: no summary, a disagreeing exit, a missing script', () => {
  for (const [name, env, extra] of [
    ['the stand-in exits 2', { FAKE_SUMMARY: '', FAKE_EXIT: '2' }, []],
    ['exit 0 and no summary', { FAKE_SUMMARY: '', FAKE_EXIT: '0' }, []],
    ['exit 1 and no summary', { FAKE_SUMMARY: '', FAKE_EXIT: '1' }, []],
    ['exit 0 and a summary that says new', { FAKE_SUMMARY: SUMMARY({ state: 'new', new: [{ rule: 'js/r', file: 'f.js', line: 1, message: 'm' }] }), FAKE_EXIT: '0' }, []],
    ['exit 1 and a summary that says clean', { FAKE_SUMMARY: SUMMARY({}), FAKE_EXIT: '1' }, []],
    ['exit 7', { FAKE_SUMMARY: SUMMARY({}), FAKE_EXIT: '7' }, []],
  ]) {
    const w = world();
    const { r, result } = nightly(w, env, extra);
    try {
      assert.equal(r.status, 2, `${name}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /CodeQL scan .*: ERROR/, name);
      assert.match(r.stdout, /CodeQL \(local scan\): NOT READ, /, name);
      assert.equal(result.verdict, 'ERROR', name);
    } finally { cleanUp(w); }
  }
  const w = world();
  fs.rmSync(w.script);
  const { r, result } = nightly(w, {});
  try {
    assert.equal(r.status, 2);
    assert.match(r.stdout, /NOT READ, .*does not exist/);
  } finally { cleanUp(w); }
});

test('AC-9 the scan runs from the clone of the swept commit: a later commit on the source is not in it', () => {
  const w = world();
  const git = (...a) => spawnSync('git', ['-C', w.src, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
  git('checkout', '-q', '-b', 'other');
  fs.writeFileSync(path.join(w.src, 'b.js'), 'two\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'on another branch');
  git('checkout', '-q', 'dev');
  const { r, result } = nightly(w, { FAKE_SUMMARY: SUMMARY({}), FAKE_EXIT: '0' });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(result.commit, w.head);
    assert.equal(fs.readFileSync(path.join(result.codeql.out, 'tree-head.txt'), 'utf8').trim(), w.head);
  } finally { cleanUp(w); }
});
