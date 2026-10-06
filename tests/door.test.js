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

// Spec 140: the trusted lane outside a git repository, and init into a skill that exists.
const NOUSER = 'driftproof-nouser-140';
// A copy of the plugin with version-guard.json's start_minimum set to a value: null (no release recorded) or a
// version above the runner this checkout pins. The release bump has written the tree's own as RUNNER_VERSION
// (the 0.14.0 release commit; spec 138 A-138-6), so the refusals that read a runner before the release read a copy, as tests/start.test.js does.
function guardedDoor(startMinimum) {
  const dir = path.join(tmp(), 'plugin');
  fs.cpSync(path.join(ROOT, 'plugin', 'driftproof'), dir, { recursive: true });
  const g = path.join(dir, 'version-guard.json');
  fs.writeFileSync(g, JSON.stringify({ ...JSON.parse(fs.readFileSync(g, 'utf8')), start_minimum: startMinimum }, null, 2));
  return path.join(dir, 'lib', 'door.mjs');
}
function doorIn(sb, args, { extra = {}, input = '', doorFile = DOOR } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^OPENAI_|^DRIFTPROOF_|^SPEC0|^GIT_/.test(k)) continue;
    env[k] = v;
  }
  Object.assign(env, {
    PATH: [FAKE_BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    SPEC028_ROOT: ROOT, SPEC028_SPAWNLOG: sb.log, GIT_CEILING_DIRECTORIES: sb.root, DRIFTPROOF_STUB: '1', ...extra,
  });
  return spawnSync(process.execPath, [doorFile, ...args], { cwd: sb.work, env, input, encoding: 'utf8', timeout: 300000 });
}

test('no git repository: refused without the flag whatever stdin holds, nothing spawned; the flag runs on the trusted lane and says why', () => {
  for (const input of ['', 'yes\n']) {
    const sb = sandbox({ repo: false });
    const r = doorIn(sb, ['run', 'my-skill'], { input });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /this is not a git repository/);
    assert.match(r.stderr, /--trust-outside-repo/);
    assert.equal(npx(sb).length, 0);
  }
  const sb = sandbox({ repo: false });
  const r = doorIn(sb, ['run', 'my-skill', '--trust-outside-repo']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /you confirmed it with --trust-outside-repo/);
  const run = npx(sb).find((v) => v[0] === 'run');
  assert.equal(run[run.length - 1], '--trusted-skill');
});

test('no git repository and no isolation account: the message names the account as missing and still offers the flag', () => {
  const sb = sandbox({ repo: false });
  const r = doorIn(sb, ['run', 'my-skill'], { extra: { DRIFTPROOF_EVAL_USER: NOUSER } });
  assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes(`has no isolation account (${NOUSER})`), r.stderr);
  assert.match(r.stderr, /--trust-outside-repo/);
  assert.equal(npx(sb).length, 0);
});

test('the flag inside a git repository, with a value, or where git cannot say, is refused, nothing spawned', () => {
  const inRepo = sandbox();
  assert.equal(doorIn(inRepo, ['run', 'my-skill', '--trust-outside-repo']).status, 2);
  assert.equal(npx(inRepo).length, 0);
  for (const args of [['run', 'my-skill', '--trust-outside-repo', 'yes'], ['run', 'my-skill', '--trust-outside-repo=yes']]) {
    const sb = sandbox({ repo: false });
    assert.equal(doorIn(sb, args).status, 2, args.join(' '));
    assert.equal(npx(sb).length, 0);
  }
  const sb = sandbox();
  const fakeGit = path.join(sb.root, 'fake-git');
  fs.mkdirSync(fakeGit);
  fs.writeFileSync(path.join(fakeGit, 'git'), '#!/bin/sh\necho "fatal: detected dubious ownership in repository at \'$PWD\'" >&2\nexit 128\n', { mode: 0o755 });
  const r = doorIn(sb, ['run', 'my-skill', '--trust-outside-repo'], { extra: { PATH: [fakeGit, FAKE_BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /dubious ownership/);
  assert.equal(npx(sb).length, 0);
});

test('start outside a repository names /driftproof:run with the flag and never tells start to take it', () => {
  const sb = sandbox({ repo: false });
  const r = doorIn(sb, ['start', 'my-skill']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /\/driftproof:run \S+ --trust-outside-repo/);
  assert.doesNotMatch(r.stderr, /this command again with --trust-outside-repo/);
  assert.equal(npx(sb).length, 0);
});

test('init into a skill that exists needs the yes: refused without it, nothing spawned or written; SKILL.md is never touched', () => {
  const sb = sandbox({ suite: false });
  const md = path.join(sb.skill, 'SKILL.md');
  const before = fs.readFileSync(md, 'utf8');
  const noYes = doorIn(sb, ['init', 'my-skill'], { input: 'yes\n' });
  assert.equal(noYes.status, 2, noYes.stderr);
  assert.match(noYes.stderr, /init would put evals\/evals\.json into/);
  assert.match(noYes.stderr, /--confirm-write/);
  assert.equal(npx(sb).length, 0);
  assert.equal(fs.existsSync(path.join(sb.skill, 'evals', 'evals.json')), false);
  // With the yes, on a runner before the release (start_minimum null, or above the runner): refused after the version probe.
  for (const [name, doorFile] of [['no release recorded (null)', guardedDoor(null)], ['a minimum above the runner', guardedDoor('999.0.0')]]) {
    const yes = doorIn(sb, ['init', 'my-skill', '--confirm-write'], { doorFile });
    assert.equal(yes.status, 2, `${name}: ${yes.stderr}`);
    assert.match(yes.stderr, /init needs/, name);
    assert.deepEqual(npx(sb).map((v) => v[0]), ['--version'], name);
    assert.equal(fs.existsSync(path.join(sb.skill, 'evals', 'evals.json')), false, name);
    assert.equal(fs.readFileSync(md, 'utf8'), before, name);
    fs.rmSync(sb.log, { force: true });
  }
  // The set state, the tree as the release bump leaves it (start_minimum equals RUNNER_VERSION): the yes goes past the
  // guard, adds evals/evals.json and nothing else, and SKILL.md is as it was.
  const guard = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'driftproof', 'version-guard.json'), 'utf8'));
  assert.equal(guard.start_minimum, require('../config').RUNNER_VERSION, 'the tree records start_minimum as RUNNER_VERSION');
  const set = doorIn(sb, ['init', 'my-skill', '--confirm-write']);
  assert.equal(set.status, 0, set.stderr);
  assert.doesNotMatch(set.stderr, /init needs/);
  assert.deepEqual(npx(sb).map((v) => v[0]), ['--version', 'init']);
  assert.deepEqual(fs.readdirSync(sb.skill).sort(), ['SKILL.md', 'evals']);
  assert.deepEqual(fs.readdirSync(path.join(sb.skill, 'evals')), ['evals.json']);
  assert.equal(fs.readFileSync(md, 'utf8'), before);
});

test('init: --confirm-write for a folder with no SKILL.md is refused; a new folder needs no yes', () => {
  const sb = sandbox({ suite: false });
  fs.mkdirSync(path.join(sb.work, 'bare'));
  const r = doorIn(sb, ['init', 'bare', '--confirm-write']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /confirms adding test cases to a skill that exists/);
  assert.equal(npx(sb).length, 0);
  const fresh = doorIn(sb, ['init', 'fresh']);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.ok(fs.existsSync(path.join(sb.work, 'fresh', 'SKILL.md')));
});

// Spec 140 (the pre-review's F-2): with no repository the flag carries a skill inside the folder the
// person runs from, on its real path, and nothing else.
test('no git repository, with the flag: a skill outside the working folder and a link out of it are refused, nothing spawned; one inside runs', () => {
  const sb = sandbox({ repo: false });
  const far = path.join(sb.root, 'elsewhere', 'stranger');
  fs.mkdirSync(far, { recursive: true });
  fs.writeFileSync(path.join(far, 'SKILL.md'), '---\nname: stranger\n---\n\n# stranger\n');
  fs.symlinkSync(far, path.join(sb.work, 'link'));
  for (const target of [far, 'link']) {
    const r = doorIn(sb, ['run', target, '--trust-outside-repo']);
    assert.equal(r.status, 2, `${target}: ${r.stderr}`);
    assert.match(r.stderr, /resolves outside the folder you run from/);
    assert.match(r.stderr, /npx driftproof@\S+ run /);
    assert.equal(npx(sb).length, 0, target);
  }
  const ok = doorIn(sb, ['run', 'my-skill', '--trust-outside-repo']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(npx(sb).filter((v) => v[0] === 'run').length, 1);
});

test('git that cannot be run is not "no repository": refused with the flag and without it, nothing spawned', () => {
  const sb = sandbox({ repo: false });
  const empty = path.join(sb.root, 'no-git-here');
  fs.mkdirSync(empty);
  for (const args of [['run', 'my-skill'], ['run', 'my-skill', '--trust-outside-repo']]) {
    const r = doorIn(sb, args, { extra: { PATH: empty } });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /git could not say whether there is a git repository here/);
    assert.equal(npx(sb).length, 0);
  }
});

// The door cannot import lib/, so it holds its own copy of the CLI's default isolation account and of
// the pattern a name must match. Nothing else ties them; this does, so a move in lib/provider.js
// cannot leave the door saying "no isolation account" or "has one" about the wrong user.
test('the door\'s default isolation account and name pattern are the CLI\'s (lib/provider.js)', () => {
  const doorSrc = fs.readFileSync(DOOR, 'utf8');
  const provSrc = fs.readFileSync(path.join(ROOT, 'lib', 'provider.js'), 'utf8');
  const expr = /const DEFAULT_ACCOUNT = ([^;]+);/.exec(doorSrc);
  const dflt = /const EVAL_USER_DEFAULT = '([^']+)';/.exec(provSrc);
  assert.ok(expr && dflt, 'both defaults are found');
  assert.equal(Function('"use strict"; return (' + expr[1] + ');')(), dflt[1]);
  const doorRe = /const EVAL_USER_RE = (\/[^\n]+\/);/.exec(doorSrc);
  const provRe = /const EVAL_USER_RE = (\/[^\n]+\/);/.exec(provSrc);
  assert.ok(doorRe && provRe, 'both patterns are found');
  assert.equal(doorRe[1], provRe[1]);
});

// Spec 165: init on a skill that exists leads into the guided run, and run on a skill with no suite
// offers a draft. On this tree start_minimum is null, so the guided steps are seen reaching the version
// guard (the runner is probed, nothing is written); the whole run is the gate's and start.test.js's.
test('init given a draft takes the steps of start: the yes first, then the version guard; nothing is written', () => {
  const sb = sandbox({ suite: false });
  const draft = path.join(sb.work, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'a', prompt: 'Q?', rubric: 'R' }] }));
  const noYes = doorIn(sb, ['init', 'my-skill', '--cases', 'cases-draft.json']);
  assert.equal(noYes.status, 2, noYes.stderr);
  assert.match(noYes.stderr, /init would add evals\/evals\.json to/);
  assert.equal(npx(sb).length, 0);
  // With the yes, below start's own minimum (null, or above the runner): the version guard refuses, nothing is written.
  for (const [name, doorFile] of [['no release recorded (null)', guardedDoor(null)], ['a minimum above the runner', guardedDoor('999.0.0')]]) {
    const yes = doorIn(sb, ['init', 'my-skill', '--cases', 'cases-draft.json', '--confirm-write'], { doorFile });
    assert.equal(yes.status, 2, `${name}: ${yes.stderr}`);
    assert.match(yes.stdout, /leads into the guided first run/, name);
    assert.match(yes.stderr, /init needs/, name);
    assert.deepEqual(npx(sb).map((v) => v[0]), ['--version'], name);
    assert.equal(fs.existsSync(path.join(sb.skill, 'evals', 'evals.json')), false, name);
    fs.rmSync(sb.log, { force: true });
  }
  // The set state, the tree as the release bump leaves it: the yes goes past the guard to init.
  const set = doorIn(sb, ['init', 'my-skill', '--cases', 'cases-draft.json', '--confirm-write']);
  assert.match(set.stdout, /leads into the guided first run/);
  assert.equal(set.status, 0, set.stderr);
  assert.doesNotMatch(set.stderr, /init needs/);
  assert.deepEqual(npx(sb).map((v) => v[0]), ['--version', 'init', 'run', 'view'], 'the version probe, init, then the guided first run');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sb.skill, 'evals', 'evals.json'), 'utf8')).cases.map((c) => c.id), ['a']);
});

test('init <skill with a suite> and no flag is refused as at the Base (DR-62); --cases and --models are refused where the guided run does not take them', () => {
  const sb = sandbox();
  const r = doorIn(sb, ['init', 'my-skill']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /init would put evals\/evals\.json into/);
  assert.match(r.stderr, /--confirm-write/);
  assert.equal(npx(sb).length, 0);
  fs.mkdirSync(path.join(sb.work, 'bare'));
  const draft = path.join(sb.work, 'cases-draft.json');
  fs.writeFileSync(draft, '{"cases":[]}');
  for (const args of [['init', 'bare', '--cases', 'cases-draft.json'], ['init', 'bare', '--models', 'x'], ['init', 'my-skill', '--confirm-write', '--models', 'x']]) {
    const x = doorIn(sb, args);
    assert.equal(x.status, 2, x.stderr);
    assert.match(x.stderr, /--cases and --models are for the guided first run/);
  }
  assert.equal(npx(sb).filter((v) => v[0] !== '--version').length, 0);
});

test('init <skill with a suite> given a draft is refused with the route init has, /driftproof:start <dir>; a draft inside the skill is refused naming init alone', () => {
  const sb = sandbox();
  fs.writeFileSync(path.join(sb.work, 'cases-draft.json'), JSON.stringify({ cases: [{ id: 'a', prompt: 'Q?', rubric: 'R' }] }));
  const r = doorIn(sb, ['init', 'my-skill', '--cases', 'cases-draft.json', '--confirm-write']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Run \/driftproof:start \S*my-skill to run the suite it has\./);
  assert.doesNotMatch(r.stderr, /without --cases/);
  fs.writeFileSync(path.join(sb.skill, 'inside-draft.json'), '{"cases":[]}');
  const x = doorIn(sb, ['init', 'my-skill', '--cases', 'my-skill/inside-draft.json', '--confirm-write']);
  assert.equal(x.status, 2, x.stderr);
  assert.match(x.stderr, /Move the draft to the folder you run init from/);
  assert.doesNotMatch(x.stderr, /\bstart\b/);
  assert.equal(npx(sb).filter((v) => v[0] !== '--version').length, 0);
});

test('run on a skill with no suite offers a draft, writes nothing, and ends with the runner\'s own message', () => {
  const sb = sandbox({ suite: false });
  const r = doorIn(sb, ['run', 'my-skill']);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /has no test cases yet/);
  assert.match(r.stdout, /\/driftproof:start/);
  assert.match(r.stderr, /no evals\/evals\.json found/);
  assert.deepEqual(fs.readdirSync(sb.skill).sort(), ['SKILL.md']);
  const withSuite = sandbox();
  assert.doesNotMatch(doorIn(withSuite, ['run', 'my-skill']).stdout, /no test cases yet/);
});
