// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 168. Reads .github/workflows/release.yml, takes each step's own `run` script out of it, and runs
// that script the way the runner's `shell: bash` does (bash --noprofile --norc -eo pipefail) in a
// scratch directory, with stub npx, gh and sleep first on PATH. The stubs record every call and print
// what the test tells them to; nothing reaches the network, npm or GitHub. The step gets a fixed
// environment, never this process's, so no token reaches it. RELEASE_YML_FILE names another workflow
// file to read in place of the tracked one (the spec's gate runs the Base's and planted copies).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const YML = process.env.RELEASE_YML_FILE || path.join(ROOT, '.github', 'workflows', 'release.yml');
const RECORD = path.join(ROOT, 'release-record.json');

const PUBLISH = 'Publish to npm with provenance';
const VERIFY = 'Verify the registry holds the recorded integrity';
const RELEASE = 'Create the GitHub release from RELEASES.md';
const INDEXNOW = 'Tell IndexNow what changed';

// The steps of the one job, each as { name, keys, run }. Written for this workflow's shape: the job's
// `steps:` at four spaces, each item at six, its keys at eight, a `run: |` block indented past them.
function readSteps(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  assert.ok(start !== -1, `${YML}: no job-level steps: list`);
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && !/^ {6}/.test(l)) break;
    if (/^ {6}- /.test(l)) { items.push([l.replace(/^ {6}- /, '        ')]); continue; }
    if (items.length) items[items.length - 1].push(l);
  }
  return items.map((body) => {
    const keys = {};
    let run = null;
    for (let i = 0; i < body.length; i++) {
      const m = /^ {8}([A-Za-z-]+):\s*(.*)$/.exec(body[i]);
      if (!m) continue;
      keys[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (m[1] === 'run' && /^\|-?$/.test(m[2])) {
        const block = [];
        for (let j = i + 1; j < body.length && (!body[j].trim() || /^ {9}/.test(body[j])); j++) block.push(body[j]);
        while (block.length && !block[block.length - 1].trim()) block.pop();
        const indent = Math.min(...block.filter((b) => b.trim()).map((b) => b.match(/^ */)[0].length));
        run = block.map((b) => b.slice(indent)).join('\n') + '\n';
      }
    }
    return { name: keys.name || keys.uses || null, keys, run };
  });
}

function workflow() {
  const text = fs.readFileSync(YML, 'utf8');
  const steps = readSteps(text);
  const npm = /^ {6}NPM_VERSION:\s*(\S+)\s*$/m.exec(text);
  assert.ok(npm, `${YML}: the job env has no NPM_VERSION`);
  return { text, steps, npmVersion: npm[1] };
}

function step(steps, name) {
  const s = steps.filter((x) => x.name === name);
  assert.strictEqual(s.length, 1, `exactly one step named "${name}"`);
  assert.ok(s[0].run, `the step "${name}" has a run block`);
  return s[0];
}

const STUBS = {
  npx: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_LOG/npx"
[ -z "\${STUB_NPX_ERR:-}" ] || printf '%s\\n' "$STUB_NPX_ERR" >&2
[ -z "\${STUB_NPX_OUT:-}" ] || printf '%s\\n' "$STUB_NPX_OUT"
exit "\${STUB_NPX_EXIT:-0}"
`,
  sleep: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_LOG/sleep"
`,
  // release view: not found unless STUB_GH_BODY_FILE names the existing release's body. With
  // --jq .body, gh prints the string and a newline, as jq does.
  gh: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_LOG/gh"
if [ "\${1:-} \${2:-}" = "release view" ]; then
  [ -n "\${STUB_GH_BODY_FILE:-}" ] || { echo "release not found" >&2; exit 1; }
  rest="\${*:4}"
  case "$rest" in
    "") printf 'title:\\t%s\\ntag:\\t%s\\n--\\n' "$3" "$3"; cat "$STUB_GH_BODY_FILE" ;;
    "--json body --jq .body") cat "$STUB_GH_BODY_FILE"; echo ;;
    "--json body") node -e 'process.stdout.write(JSON.stringify({ body: require("fs").readFileSync(process.argv[1], "utf8") }) + "\\n")' "$STUB_GH_BODY_FILE" ;;
    *) echo "gh stub: unsupported release view arguments: $rest" >&2; exit 2 ;;
  esac
  exit 0
fi
[ "\${1:-} \${2:-}" = "release create" ] && exit 0
echo "gh stub: unsupported call: $*" >&2
exit 2
`,
};

function scratch() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'release-yml-'));
  for (const d of ['bin', 'log', 'runner', 'work']) fs.mkdirSync(path.join(dir, d));
  for (const [name, body] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, 'bin', name), body, { mode: 0o755 });
  return dir;
}

// Runs a step's script with only the variables given, the stubs first on PATH.
function runStep(dir, s, vars, cwd) {
  assert.ok(!s.run.includes('${{'), `the step "${s.name}" interpolates an expression into its script; the test cannot run it as is`);
  const file = path.join(dir, `step-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);
  fs.writeFileSync(file, s.run);
  for (const f of fs.readdirSync(path.join(dir, 'log'))) fs.rmSync(path.join(dir, 'log', f));
  const env = {
    PATH: [path.join(dir, 'bin'), path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    HOME: path.join(dir, 'work'),
    TMPDIR: path.join(dir, 'work'),
    RUNNER_TEMP: path.join(dir, 'runner'),
    GITHUB_ENV: path.join(dir, 'runner', 'github-env'),
    STUB_LOG: path.join(dir, 'log'),
    ...vars,
  };
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], { cwd: cwd || path.join(dir, 'work'), env, encoding: 'utf8', timeout: 60000 });
  const calls = (name) => {
    const f = path.join(dir, 'log', name);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  };
  const lines = `${r.stdout}\n${r.stderr}`.split('\n');
  return { status: r.status, out: r.stdout, err: r.stderr, calls, has: (prefix) => lines.filter((l) => l.startsWith(prefix)) };
}

function withScratch(fn) {
  const dir = scratch();
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name;
const REG = { PKG_NAME: PKG, VERSION: '9.9.9', TAG: 'v9.9.9', RECORDED: 'sha512-recorded' };

test('AC-1 the header comment lists exactly the keys of release-record.json and no longer says exactly two keys', () => {
  const { text } = workflow();
  const lines = text.split('\n');
  const header = lines.slice(0, lines.findIndex((l) => !l.startsWith('#')));
  const listed = header.map((l) => /^# {3}([a-z_]+) {2,}\S/.exec(l)).filter(Boolean).map((m) => m[1]);
  const keys = Object.keys(JSON.parse(fs.readFileSync(RECORD, 'utf8')));
  assert.deepStrictEqual(listed, keys, 'the schema listing names the record\'s keys, in order');
  const prose = header.map((l) => l.replace(/^#\s?/, '')).join(' ').replace(/\s+/g, ' ');
  assert.ok(!/exactly two keys/i.test(prose), 'the header still says "exactly two keys"');
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  for (const m of prose.matchAll(new RegExp(`\\b(${WORDS.join('|')}) keys\\b`, 'gi'))) {
    assert.strictEqual(WORDS.indexOf(m[1].toLowerCase()), keys.length, `the header says "${m[0]}" but the record has ${keys.length}`);
  }
});

for (const [label, stub] of [
  ['exiting 0', {}],
  ['exiting 1 with an E404 on stderr', { STUB_NPX_EXIT: '1', STUB_NPX_ERR: 'npm error code E404' }],
]) {
  test(`AC-2 the registry check, npm listing nothing (${label}): 20 tries 30 s apart, a warning, exit 0`, () => withScratch((dir) => {
    const { steps, npmVersion } = workflow();
    const r = runStep(dir, step(steps, VERIFY), { ...REG, NPM_VERSION: npmVersion, ...stub });
    const want = `-y npm@${npmVersion} view ${PKG}@9.9.9 dist.integrity`;
    assert.deepStrictEqual(r.calls('npx'), Array(20).fill(want), 'npx view is called 20 times');
    assert.deepStrictEqual(r.calls('sleep'), Array(19).fill('30'), 'sleep 30 between the tries');
    assert.strictEqual(r.status, 0, `exit status\n${r.out}${r.err}`);
    assert.ok(r.has('::warning::').length >= 1, 'a ::warning:: line is printed');
    assert.deepStrictEqual(r.has('::error::'), [], 'no ::error:: line');
  }));
}

test('AC-3 the registry check fails on a different integrity and passes quietly on the recorded one', () => withScratch((dir) => {
  const { steps, npmVersion } = workflow();
  const s = step(steps, VERIFY);
  const bad = runStep(dir, s, { ...REG, NPM_VERSION: npmVersion, STUB_NPX_OUT: 'sha512-other' });
  assert.notStrictEqual(bad.status, 0, 'a different integrity fails the step');
  assert.ok(bad.has('::error::').length >= 1, 'a different integrity prints ::error::');
  const good = runStep(dir, s, { ...REG, NPM_VERSION: npmVersion, STUB_NPX_OUT: REG.RECORDED });
  assert.strictEqual(good.status, 0, `the recorded integrity passes\n${good.out}${good.err}`);
  assert.deepStrictEqual(good.has('::warning::'), [], 'no ::warning:: line on the recorded integrity');
  assert.deepStrictEqual(good.has('::error::'), [], 'no ::error:: line on the recorded integrity');
  assert.deepStrictEqual(good.calls('sleep'), [], 'no wait when npm lists the version at once');
}));

test('AC-4 the IndexNow step cannot fail the job: continue-on-error is true', () => {
  const { steps } = workflow();
  assert.strictEqual(step(steps, INDEXNOW).keys['continue-on-error'], 'true');
});

test('AC-5 no step between the publish and the GitHub release stops the job on a version npm has not listed', () => withScratch((dir) => {
  const { steps, npmVersion } = workflow();
  const names = steps.map((s) => s.name);
  const p = names.indexOf(PUBLISH);
  const g = names.indexOf(RELEASE);
  assert.ok(p !== -1 && g !== -1 && p < g, 'the publish step comes before the GitHub release step');
  for (const k of ['if', 'timeout-minutes']) assert.ok(!(k in steps[g].keys), `the GitHub release step has no ${k}:`);
  for (const s of steps.slice(p + 1, g)) {
    for (const k of ['if', 'timeout-minutes']) assert.ok(!(k in s.keys), `"${s.name}" has no ${k}:`);
    assert.ok(s.run, `"${s.name}" is a run step the test can run`);
    const r = runStep(dir, s, { ...REG, NPM_VERSION: npmVersion });
    assert.strictEqual(r.status, 0, `"${s.name}" exits 0 when npm lists nothing\n${r.out}${r.err}`);
  }
}));

// The GitHub release step, run in a scratch directory that carries the real scripts/release-body.mjs
// beside a fixture RELEASES.md, so release-body.md is made by the script the workflow calls.
const NOTES = "## v9.9.9 - 2026-10-08\n\n### What's new\n\n- One user-facing line.\n- A second one.\n\n### Engineering log\n\nInternal.\n";
function releaseRun(dir, existing) {
  const work = path.join(dir, 'work');
  fs.mkdirSync(path.join(work, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'release-body.mjs'), path.join(work, 'scripts', 'release-body.mjs'));
  fs.writeFileSync(path.join(work, 'RELEASES.md'), NOTES);
  const vars = { TAG: 'v9.9.9' };
  if (existing !== undefined) {
    fs.writeFileSync(path.join(dir, 'existing-body.md'), existing);
    vars.STUB_GH_BODY_FILE = path.join(dir, 'existing-body.md');
  }
  const { steps } = workflow();
  const s = step(steps, RELEASE);
  return { s, r: runStep(dir, s, vars, work) };
}
// The body the real script makes from the fixture, which an identical existing release carries.
function body() {
  return withScratch((dir) => {
    const f = path.join(dir, 'RELEASES.md');
    fs.writeFileSync(f, NOTES);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release-body.mjs'), 'v9.9.9', '--file', f], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout;
  });
}

test('AC-6 an existing release with identical notes: exit 0, gh only views it', () => {
  const b = body();
  for (const existing of [b, b.replace(/\n+$/, '')]) {
    withScratch((dir) => {
      const { r } = releaseRun(dir, existing);
      assert.strictEqual(r.status, 0, `exit status\n${r.out}${r.err}`);
      assert.deepStrictEqual(r.has('::error::'), []);
      const calls = r.calls('gh');
      assert.ok(calls.length >= 1, 'gh release view was called');
      for (const c of calls) assert.match(c, /^release view v9\.9\.9\b/, `no gh call but release view: ${c}`);
    });
  }
});

test('AC-6 an existing release with different notes: an ::error:: naming the tag, exit non-zero, gh only views it', () => withScratch((dir) => {
  const b = body();
  const { r } = releaseRun(dir, b.replace('- A second one.', '- A line RELEASES.md does not have.'));
  assert.notStrictEqual(r.status, 0, 'different notes fail the step');
  const errors = r.has('::error::');
  assert.ok(errors.some((l) => l.includes('v9.9.9') && /existing notes .*differ from RELEASES\.md/.test(l)),
    `an ::error:: line names the tag and says the existing notes differ from RELEASES.md: ${JSON.stringify(errors)}`);
  const calls = r.calls('gh');
  assert.ok(calls.length >= 1, 'gh release view was called');
  for (const c of calls) assert.match(c, /^release view v9\.9\.9\b/, `no gh call but release view: ${c}`);
}));

test('AC-6 no existing release: gh release create once, with --verify-tag; the script never edits, deletes or uploads', () => withScratch((dir) => {
  const { s, r } = releaseRun(dir, undefined);
  assert.strictEqual(r.status, 0, `exit status\n${r.out}${r.err}`);
  const creates = r.calls('gh').filter((c) => c.startsWith('release create'));
  assert.strictEqual(creates.length, 1, 'one gh release create');
  assert.match(creates[0], /^release create v9\.9\.9 --verify-tag\b/);
  for (const re of [/\bgh\s+release\s+edit\b/, /\bgh\s+release\s+delete\b/, /\bgh\s+release\s+upload\b/, /\bgh\s+api\b/]) {
    assert.ok(!re.test(s.run), `the step's script has no ${re}`);
  }
}));
