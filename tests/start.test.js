// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for the plugin door's spec 139 changes (AC-4, AC-8): --quick passed through to the
// CLI and refused beside the three flags it sets, and the guided first run (`start`). Spec 173
// A-173-2: a direct `start --full` with no quick run's receipt asks one question at a terminal.
//
//   node --test tests/start.test.js
//
// THE DOUBLES ARE SPEC 028'S: its fake `npx` maps `driftproof@<pinned>` onto this checkout's
// bin/driftproof and logs every argument vector, and its fake `claude` answers the runs that are
// not stub runs. A fake opener here records what the door asks it to open. Every folder is under
// the system temp directory, in a git repository made there, and removed after.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { htmlOutsideScriptBodies } = require('../.github/windows-ci/common.cjs');

const ROOT = path.join(__dirname, '..');
const DOOR = path.join(ROOT, 'plugin', 'driftproof', 'lib', 'door.mjs');
const FAKE_BIN = path.join(ROOT, 'specs', '028-claude-code-plugin', 'probes', 'bin');
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec139-start-')); made.push(d); return d; };
// A copy of door.mjs's semverGte (an ES module the CommonJS test cannot require).
function semverGte(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0; const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A sandbox: a working folder in a git repository, a skill in it, a spawn log, and a bin folder
// holding a fake opener under both names the door may call.
function sandbox({ suite = true } = {}) {
  const root = tmp();
  const work = path.join(root, 'work');
  const skill = path.join(work, 'my-skill');
  fs.mkdirSync(path.join(skill, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: my-skill\n---\n\n# my-skill\n\nBe brief.\n');
  if (suite) fs.writeFileSync(path.join(skill, 'evals', 'evals.json'), JSON.stringify({ cases: [{ id: 'a', prompt: 'Q?', rubric: 'R' }] }));
  else fs.rmdirSync(path.join(skill, 'evals'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const openLog = path.join(root, 'open.ndjson');
  for (const name of ['xdg-open', 'open']) {
    fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(openLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`, { mode: 0o755 });
  }
  spawnSync('git', ['init', '-q'], { cwd: work });
  return { root, work, skill, bin, log: path.join(root, 'spawns.ndjson'), openLog };
}
// THE RELEASED DOOR (spec 139 A-139-5, the pre-review's F-2). `start` carries a minimum of its own,
// version-guard.json's start_minimum, null until the release that ships `init --cases` writes it as
// the new RUNNER_VERSION; that release has now written it (A-139-9), so the tree's door passes start
// at the runner's own version. The tests that read start past the guard read a copy of the plugin with
// start_minimum set as that bump sets it, to the runner's own version, read from config.js and never typed.
let releasedPlugin = null;
function released(startMinimum = require('../config').RUNNER_VERSION) {
  const dir = path.join(tmp(), 'plugin');
  fs.cpSync(path.join(ROOT, 'plugin', 'driftproof'), dir, { recursive: true });
  const g = path.join(dir, 'version-guard.json');
  fs.writeFileSync(g, JSON.stringify({ ...JSON.parse(fs.readFileSync(g, 'utf8')), start_minimum: startMinimum }, null, 2));
  return path.join(dir, 'lib', 'door.mjs');
}
const releasedDoor = () => (releasedPlugin = releasedPlugin || released());
function doorEnv(sb, { stub = true, extra = {} } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^OPENAI_|^DRIFTPROOF_|^SPEC0|^GIT_/.test(k)) continue;
    env[k] = v;
  }
  return Object.assign(env, {
    PATH: [sb.bin, FAKE_BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    SPEC028_ROOT: ROOT,
    SPEC028_SPAWNLOG: sb.log,
    GIT_CEILING_DIRECTORIES: sb.root,
    ...(stub ? { DRIFTPROOF_STUB: '1' } : {}),
    ...extra,
  });
}
function door(sb, args, { stub = true, extra = {}, doorFile = DOOR, cwd = sb.work, input } = {}) {
  return spawnSync(process.execPath, [doorFile, ...args], { cwd, env: doorEnv(sb, { stub, extra }), input, encoding: 'utf8', timeout: 300000 });
}
// Spec 173 A-173-2: the door under a terminal. util-linux `script` gives it one and passes `answer` in
// as typed; the end of `answer` is the end of input.
const HAS_SCRIPT = spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0;
function ttyDoor(sb, args, answer) {
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const r = spawnSync('script', ['-qec', [process.execPath, DOOR, ...args].map(q).join(' '), '/dev/null'], { cwd: sb.work, env: doorEnv(sb), input: answer, encoding: 'utf8', timeout: 300000 });
  const out = String(r.stdout || '').replace(/\r/g, '');
  return { status: r.status, out, asked: (out.match(/\[y\/N\]/g) || []).length };
}
const spawns = (sb) => (fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const npx = (sb) => spawns(sb).filter((s) => s.bin === 'npx').map((s) => s.argv.slice(1));

test('run passes --quick, which takes no value, and refuses it beside each of the three', () => {
  const sb = sandbox();
  const r = door(sb, ['run', 'my-skill', '--quick']);
  assert.equal(r.status, 0, r.stderr);
  const run = npx(sb).find((v) => v[0] === 'run');
  assert.equal(run.filter((x) => x === '--quick').length, 1, JSON.stringify(run));
  for (const extra of [['--samples', '2'], ['--concurrency', '2'], ['--max-cases', '2']]) {
    const sb2 = sandbox();
    const bad = door(sb2, ['run', 'my-skill', '--quick', ...extra]);
    assert.equal(bad.status, 2, extra.join(' '));
    assert.match(bad.stderr, new RegExp(`REFUSED: --quick sets ${extra[0]}`));
    assert.equal(spawns(sb2).length, 0);
  }
});

test('a word after --quick is a second folder, refused, spawning nothing', () => {
  const sb = sandbox();
  const r = door(sb, ['run', 'my-skill', '--quick', 'yes']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /takes one folder/);
  assert.equal(spawns(sb).length, 0);
});

test('start with no folder lists the skills, past node_modules and dot folders, and spawns nothing', () => {
  const sb = sandbox();
  for (const d of ['node_modules/hidden-skill', '.cache/dot-skill', 'nested/b-skill']) {
    fs.mkdirSync(path.join(sb.work, d), { recursive: true });
    fs.writeFileSync(path.join(sb.work, d, 'SKILL.md'), '# x\n');
  }
  const r = door(sb, ['start']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /my-skill {2}\(has test cases\)/);
  assert.match(r.stdout, /nested\/b-skill {2}\(no test cases yet\)/);
  assert.doesNotMatch(r.stdout, /hidden-skill|dot-skill/);
  assert.equal(spawns(sb).length, 0);
});

test('start given a flag and no folder refuses, naming the flag, spawning nothing', () => {
  const sb = sandbox({ suite: false });
  const draft = path.join(sb.work, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'x', prompt: 'p', rubric: 'r' }] }));
  for (const args of [['start', '--cases', draft], ['start', '--models', 'claude-haiku-4-5']]) {
    const r = door(sb, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, new RegExp(`${args[1]} and no skill folder`));
    assert.doesNotMatch(r.stdout, /skills under/);
  }
  assert.equal(spawns(sb).length, 0);
});

test('start refuses a skill with no suite and no draft, a draft beside a suite, and a draft that is a folder, spawning nothing', () => {
  const none = sandbox({ suite: false });
  const r = door(none, ['start', 'my-skill']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /has no evals\/evals\.json yet/);
  assert.equal(spawns(none).length, 0);
  const both = sandbox();
  const draft = path.join(both.work, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'x', prompt: 'p', rubric: 'r' }] }));
  const r2 = door(both, ['start', 'my-skill', '--cases', draft]);
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /already has evals\/evals\.json, and init never/);
  assert.equal(spawns(both).length, 0);
  const dir = sandbox({ suite: false });
  const r3 = door(dir, ['start', 'my-skill', '--cases', dir.work]);
  assert.equal(r3.status, 2);
  assert.match(r3.stderr, /cases: not a file/);
  assert.equal(spawns(dir).length, 0);
});

test('start where there is no git repository is refused as run is, spawning nothing', () => {
  const sb = sandbox();
  fs.rmSync(path.join(sb.work, '.git'), { recursive: true, force: true });
  const r = door(sb, ['start', 'my-skill']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /this is not a git repository/);
  assert.equal(spawns(sb).length, 0);
});

test('start with a draft: init with the cases, a quick run, the view, then the page opened by its path', () => {
  const sb = sandbox({ suite: false });
  const draft = path.join(sb.work, 'cases-draft.json');
  const cases = { cases: [{ id: 'one', prompt: 'Say hi.', rubric: 'Says hi; 0.80 when it does.' }, { id: 'two', prompt: 'Say bye.', rubric: 'Says bye.' }] };
  fs.writeFileSync(draft, JSON.stringify(cases));
  const skillMd = fs.readFileSync(path.join(sb.skill, 'SKILL.md'), 'utf8');
  const r = door(sb, ['start', 'my-skill', '--cases', draft, '--confirm-write'], { stub: false, doorFile: releasedDoor() });
  assert.equal(r.status, 0, r.stderr.slice(-1500));
  const v = npx(sb);
  assert.deepEqual(v.map((x) => x[0]), ['--version', 'init', 'run', 'view']);
  assert.deepEqual(v[1], ['init', fs.realpathSync(sb.skill), '--cases', draft, '--drafted-from-skill']);
  assert.ok(v[2].includes('--quick') && v[2].includes('--trusted-skill'), JSON.stringify(v[2]));
  assert.deepEqual(v[3], ['view', 'receipts', '--out', 'driftproof-view.html']);
  const page = path.join(sb.work, 'driftproof-view.html');
  assert.deepEqual(fs.readFileSync(sb.openLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)), [[page]]);
  assert.ok(fs.readFileSync(page, 'utf8').includes('Smoke run, no verdict'));
  assert.equal(fs.readFileSync(path.join(sb.skill, 'SKILL.md'), 'utf8'), skillMd);
  const suite = JSON.parse(fs.readFileSync(path.join(sb.skill, 'evals', 'evals.json'), 'utf8'));
  assert.deepEqual(suite.cases.map((c) => c.id), ['one', 'two']);
  const rdir = path.join(sb.work, 'receipts');
  const receipt = JSON.parse(fs.readFileSync(path.join(rdir, fs.readdirSync(rdir).find((f) => f.endsWith('.json') && !f.endsWith('.summary.json'))), 'utf8'));
  assert.equal(receipt.run.preset, 'quick');
  assert.equal(receipt.verification_level, 'UNVERIFIED');
  assert.equal(receipt.run.answered_by.kind, 'model');
  assert.ok(spawns(sb).filter((s) => s.bin === 'claude').every((s) => s.viaFakeBin && !s.had_api_key));
});

test('start with a draft and no --confirm-write is refused, writing and spawning nothing (the person\'s yes)', () => {
  const sb = sandbox({ suite: false });
  const draft = path.join(sb.work, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'one', prompt: 'Say hi.', rubric: 'Says hi.' }] }));
  const r = door(sb, ['start', 'my-skill', '--cases', draft]);
  assert.equal(r.status, 2, r.stderr.slice(-800));
  assert.match(r.stderr, /--confirm-write/);
  assert.match(r.stderr, /the person's yes/);
  // Spec 172 (M-5): the one question names every file and folder the run will create, not the
  // suite file alone: receipts/ and the results page, both written in the folder you run start from.
  assert.match(r.stderr, new RegExp(`receipts`));
  assert.match(r.stderr, new RegExp(`driftproof-view\\.html`));
  assert.equal(spawns(sb).length, 0);
  assert.equal(fs.existsSync(path.join(sb.skill, 'evals')), false, 'nothing was written into the skill folder');
  assert.equal(fs.existsSync(path.join(sb.work, 'receipts')), false, 'receipts/ is not made until a receipt is written');
});

test('--confirm-write with no draft has nothing to confirm, and run takes no such flag', () => {
  const sb = sandbox();
  const r = door(sb, ['start', 'my-skill', '--confirm-write']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--confirm-write confirms/);
  const run = door(sb, ['run', 'my-skill', '--confirm-write']);
  assert.equal(run.status, 2);
  assert.equal(spawns(sb).length, 0);
});

test('start adds evals/evals.json and no other file, and refuses a link, an evals that is a link, and a folder with no SKILL.md', () => {
  const sb = sandbox({ suite: false });
  const draft = path.join(sb.work, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'one', prompt: 'Say hi.', rubric: 'Says hi.' }] }));
  fs.mkdirSync(path.join(sb.skill, 'notes'));
  fs.writeFileSync(path.join(sb.skill, 'notes', 'extra.md'), 'kept\n');
  const list = () => fs.readdirSync(sb.skill, { recursive: true }).sort();
  const before = list();
  const md = fs.statSync(path.join(sb.skill, 'SKILL.md'));
  const r = door(sb, ['start', 'my-skill', '--cases', draft, '--confirm-write'], { stub: false, doorFile: releasedDoor() });
  assert.equal(r.status, 0, r.stderr.slice(-800));
  assert.deepEqual(list().filter((f) => !before.includes(f)), ['evals', path.join('evals', 'evals.json')]);
  const after = fs.statSync(path.join(sb.skill, 'SKILL.md'));
  assert.equal(after.ino, md.ino);
  assert.equal(after.mtimeMs, md.mtimeMs);
  assert.equal(fs.readFileSync(path.join(sb.skill, 'notes', 'extra.md'), 'utf8'), 'kept\n');
  assert.equal(fs.existsSync(path.join(sb.skill, '.driftproofrc')), false);

  // A dangling link where the suite would go, an evals that is a link, and a folder with no SKILL.md.
  for (const [name, prep, words] of [
    ['dangling', (d) => { fs.mkdirSync(path.join(d, 'evals')); fs.symlinkSync(path.join(d, 'nowhere.json'), path.join(d, 'evals', 'evals.json')); }, /already has evals\/evals\.json/],
    ['evalslink', (d) => { fs.mkdirSync(`${d}-elsewhere`); fs.symlinkSync(`${d}-elsewhere`, path.join(d, 'evals')); }, /is not a plain folder/],
  ]) {
    const sb2 = sandbox({ suite: false });
    prep(sb2.skill);
    const d2 = path.join(sb2.work, 'cases-draft.json');
    fs.writeFileSync(d2, JSON.stringify({ cases: [{ id: 'one', prompt: 'p', rubric: 'r' }] }));
    const r2 = door(sb2, ['start', 'my-skill', '--cases', d2, '--confirm-write']);
    assert.equal(r2.status, 2, `${name}: ${r2.stderr.slice(-400)}`);
    assert.match(r2.stderr, words);
    assert.equal(spawns(sb2).length, 0, name);
  }
  const sb3 = sandbox({ suite: false });
  fs.mkdirSync(path.join(sb3.work, 'bare'));
  const d3 = path.join(sb3.work, 'cases-draft.json');
  fs.writeFileSync(d3, JSON.stringify({ cases: [{ id: 'one', prompt: 'p', rubric: 'r' }] }));
  const r3 = door(sb3, ['start', 'bare', '--cases', d3, '--confirm-write']);
  assert.equal(r3.status, 2);
  assert.match(r3.stderr, /has no SKILL\.md/);
  assert.equal(fs.existsSync(path.join(sb3.work, 'bare', 'SKILL.md')), false, 'no SKILL.md is ever created');
});

test('start on a skill with a suite runs without init', () => {
  const sb = sandbox();
  const r = door(sb, ['start', 'my-skill'], { doorFile: releasedDoor() });
  assert.equal(r.status, 0, r.stderr.slice(-1500));
  assert.deepEqual(npx(sb).map((x) => x[0]), ['--version', 'run', 'view']);
});

// Spec 173 A-173-2 (issue 92, the ruling on Q2): a direct --full with no quick run's receipt in the
// folder asks one question at a terminal, then runs; with no terminal it neither refuses nor asks.
test('the door\'s copy of the quick preset is lib/smoke.js\'s', () => {
  const { PRESET_QUICK } = require('../lib/smoke');
  assert.match(fs.readFileSync(DOOR, 'utf8'), new RegExp(`^const PRESET_QUICK = '${PRESET_QUICK}';$`, 'm'));
});

test('start --full with no quick run\'s receipt and no terminal is not refused and not asked: it says whose yes it is and runs', () => {
  const sb = sandbox();
  const r = door(sb, ['start', 'my-skill', '--full'], { input: 'n\n' });
  assert.equal(r.status, 0, r.stderr.slice(-800));
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /REFUSED|\[y\/N\]/);
  assert.match(r.stdout, /no quick run's receipt in .*start\.md has Claude ask the person/);
  assert.deepEqual(npx(sb).map((x) => x[0]), ['--version', 'run', 'view']);
});

test('start --full at a terminal with no quick run\'s receipt asks once: a no spawns and writes nothing, a yes runs', { skip: !HAS_SCRIPT && 'util-linux script is not on this machine' }, () => {
  for (const answer of ['n\n', '\n', '']) {
    const sb = sandbox();
    const before = snapshot(sb.work);
    const r = ttyDoor(sb, ['start', 'my-skill', '--full'], answer);
    assert.equal(r.asked, 1, `${JSON.stringify(answer)}: ${r.out.slice(-400)}`);
    assert.equal(r.status, 0, r.out.slice(-400));
    assert.match(r.out, /not run: the answer was not yes/);
    assert.equal(spawns(sb).length, 0, JSON.stringify(answer));
    assert.deepEqual(snapshot(sb.work), before, JSON.stringify(answer));
  }
  const sb = sandbox();
  const r = ttyDoor(sb, ['start', 'my-skill', '--full'], 'y\n');
  assert.equal(r.asked, 1, r.out.slice(-400));
  assert.equal(r.status, 0, r.out.slice(-800));
  assert.deepEqual(npx(sb).map((x) => x[0]), ['--version', 'run', 'view']);
  assert.ok(!npx(sb)[1].includes('--quick'), JSON.stringify(npx(sb)[1]));
});

test('start --full at a terminal with a quick run\'s receipt in receipts/ asks nothing, and start alone asks nothing', { skip: !HAS_SCRIPT && 'util-linux script is not on this machine' }, () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.work, 'receipts'));
  fs.writeFileSync(path.join(sb.work, 'receipts', 'quick.json'), JSON.stringify({ run: { preset: require('../lib/smoke').PRESET_QUICK } }));
  const r = ttyDoor(sb, ['start', 'my-skill', '--full'], '');
  assert.equal(r.asked, 0, r.out.slice(-400));
  assert.equal(r.status, 0, r.out.slice(-800));
  assert.deepEqual(npx(sb).map((x) => x[0]), ['--version', 'run', 'view']);
  const sb2 = sandbox();
  const q = ttyDoor(sb2, ['start', 'my-skill'], '');
  assert.equal(q.asked, 0, q.out.slice(-400));
  assert.ok((npx(sb2).find((x) => x[0] === 'run') || []).includes('--quick'));
});

// Every file under a folder, by path and bytes (links by their target), for "changed nothing".
function snapshot(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, f);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) out[f] = `link:${fs.readlinkSync(p)}`;
    else if (st.isFile()) out[f] = fs.readFileSync(p, 'base64');
  }
  return out;
}

test('start on a runner before its own minimum refuses after --version, spawning no init and changing nothing (F-2)', () => {
  // The set state: a release has written start_minimum and it never moves after, so the tree's own
  // start_minimum reads as a string no higher than the runner's own version.
  const guard = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'driftproof', 'version-guard.json'), 'utf8'));
  assert.equal(typeof guard.start_minimum, 'string', 'the tree records start_minimum as a string');
  assert.ok(semverGte(require('../config').RUNNER_VERSION, guard.start_minimum), 'start_minimum is not above RUNNER_VERSION');
  for (const [name, doorFile] of [['no release recorded (null)', released(null)], ['a minimum above the runner', released('999.0.0')]]) {
    const sb = sandbox({ suite: false });
    const draft = path.join(sb.work, 'cases-draft.json');
    fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'one', prompt: 'p', rubric: 'r' }] }));
    const before = snapshot(sb.skill);
    const r = door(sb, ['start', 'my-skill', '--cases', draft, '--confirm-write'], { doorFile });
    assert.equal(r.status, 2, `${name}: ${r.stderr.slice(-400)}`);
    assert.match(r.stderr, /start needs .*and the pinned runner reported .*Update the plugin/);
    assert.deepEqual(npx(sb).map((x) => x[0]), ['--version'], name);
    assert.deepEqual(snapshot(sb.skill), before, name);
  }
  // At or above it, the tree as it is: start goes past the guard to init and does not ask for an update.
  const sb = sandbox({ suite: false });
  const draft = path.join(sb.work, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'one', prompt: 'p', rubric: 'r' }] }));
  const r = door(sb, ['start', 'my-skill', '--cases', draft, '--confirm-write'], { doorFile: DOOR });
  assert.doesNotMatch(r.stderr, /Update the plugin/, r.stderr.slice(-400));
  assert.ok(npx(sb).map((x) => x[0]).includes('init'), 'the tree at its own minimum reaches init');
});

test('start refuses from inside the skill folder, and a draft inside it, spawning nothing and changing nothing (F-3)', () => {
  const sb = sandbox({ suite: false });
  fs.mkdirSync(path.join(sb.skill, 'notes'));
  const draft = path.join(sb.work, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'one', prompt: 'p', rubric: 'r' }] }));
  const before = snapshot(sb.skill);
  for (const [cwd, dir] of [[sb.skill, '.'], [path.join(sb.skill, 'notes'), '..']]) {
    for (const args of [['start', dir], ['start', dir, '--cases', draft, '--confirm-write']]) {
      const r = door(sb, args, { cwd, doorFile: releasedDoor() });
      assert.equal(r.status, 2, `${args.join(' ')} from ${cwd}: ${r.stderr.slice(-400)}`);
      assert.match(r.stderr, /Run start from the folder above the skill/);
    }
  }
  const inside = path.join(sb.skill, 'notes', 'cases-draft.json');
  fs.writeFileSync(inside, fs.readFileSync(draft));
  const before2 = snapshot(sb.skill);
  const r = door(sb, ['start', 'my-skill', '--cases', inside, '--confirm-write'], { doorFile: releasedDoor() });
  assert.equal(r.status, 2, r.stderr.slice(-400));
  assert.match(r.stderr, /is inside the skill folder/);
  assert.equal(spawns(sb).length, 0);
  assert.deepEqual(snapshot(sb.skill), before2);
  delete before2[path.join('notes', 'cases-draft.json')];
  assert.deepEqual(before2, before);
  // Listed from inside it, the skill folder itself is not offered.
  const l = door(sb, ['start'], { cwd: sb.skill });
  assert.equal(l.status, 0, l.stderr);
  assert.doesNotMatch(l.stdout, /^ {2}\. {2}\(/m);
  assert.match(l.stdout, /run start from the folder above it/);
});

// ── Spec 139 A-139-18 (issue 368): the plugin's first run ─────────────────────────────────────
// Each invariant of the amendment's claim is one reader below, run on the tree and on a planted copy
// of the plugin, which the same reader must read RED for the planted reason.
const PLUGIN = path.join(ROOT, 'plugin', 'driftproof');
// The amendment's Base, read from A-139-18 itself.
const BASE_368 = (() => {
  const spec = fs.readFileSync(path.join(ROOT, 'specs', '139-quick-and-guided-first-run', 'spec.md'), 'utf8');
  const a = spec.slice(spec.indexOf('### A-139-18 '));
  const m = /^\*\*This amendment's Base:\*\* `dev` at `([0-9a-f]{40})`/m.exec(a);
  assert.ok(m, 'spec 139 A-139-18 records no Base');
  return m[1];
})();
const DESCRIPTOR = 'Driftproof (driftproofhq): open-source agent skill evaluation and regression testing across model releases';
const WHAT_TO_TYPE = 'in the folder that holds your skills.';
// A copy of the plugin with each [file, from, to] applied; a plant whose text is not there fails the test.
function planted(...edits) {
  const dir = path.join(tmp(), 'plugin');
  fs.cpSync(PLUGIN, dir, { recursive: true });
  for (const [file, from, to] of edits) {
    const f = path.join(dir, file);
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(t.includes(from), `plant not applied: ${file} carries no ${JSON.stringify(from.slice(0, 80))}`);
    fs.writeFileSync(f, t.split(from).join(to));
  }
  return dir;
}
const doorOf = (pluginDir) => path.join(pluginDir, 'lib', 'door.mjs');
const reds = (problems, re) => problems.some((p) => re.test(p));
const SAMPLE_PAGE = 'driftproof-view.html';
// The sample's one report folder, and every receipt under it by its path inside that folder.
const sampleReport = (pluginDir) => fs.readdirSync(path.join(pluginDir, 'sample')).filter((f) => /^report-\d{3}$/.test(f));
function receiptsUnder(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir, { recursive: true }).sort()) {
    if (!f.endsWith('.json')) continue;
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (r && r.receipt_hash && r.results) out[f.split(path.sep).join('/')] = r;
  }
  return out;
}
const sampleReceipts = (pluginDir) => Object.values(receiptsUnder(path.join(pluginDir, 'sample', sampleReport(pluginDir)[0])));

// AC-368-1 to AC-368-3, the files: exactly the receipts of one pair in one published report, byte for
// byte, sealed; the page the CLI writes for them; the page named sample/report-NNN, naming the pair.
function readSampleFiles(pluginDir) {
  const out = [];
  const dir = path.join(pluginDir, 'sample');
  if (!fs.existsSync(dir)) return ['there is no sample folder'];
  const reports = sampleReport(pluginDir);
  if (reports.length !== 1) return [`the sample folder holds ${reports.length} report folders, not one`];
  const report = reports[0];
  const num = report.slice('report-'.length);
  if (!fs.existsSync(path.join(ROOT, 'docs', 'reports', num, 'index.html'))) out.push(`report ${num} is not published`);
  const mine = receiptsUnder(path.join(dir, report));
  const pairs = [...new Set(Object.values(mine).map((r) => `${r.skill.name} on ${r.run.model_id}`))];
  if (pairs.length !== 1) return [...out, `the sample holds ${pairs.length} skill and model pairs, not one`];
  const first = Object.values(mine)[0];
  const theirs = receiptsUnder(path.join(ROOT, 'receipts', report));
  const pairOf = Object.keys(theirs).filter((f) => theirs[f].skill.name === first.skill.name && theirs[f].run.model_id === first.run.model_id);
  const tracked = new Set(spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--', `receipts/${report}`], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean));
  for (const f of pairOf) {
    if (!tracked.has(`receipts/${report}/${f}`)) continue;
    if (!mine[f]) out.push(`the sample leaves out the report's receipt ${f}`);
  }
  for (const f of Object.keys(mine)) {
    if (!pairOf.includes(f) || !fs.readFileSync(path.join(dir, report, f)).equals(fs.readFileSync(path.join(ROOT, 'receipts', report, f)))) out.push(`no tracked receipt of report ${num} has the bytes of the sample's ${f}`);
    if (!require('../lib/receipt').verifyReceiptHash(mine[f])) out.push(`the sample's ${f} receipt_hash does not verify`);
  }
  const pageFile = path.join(dir, SAMPLE_PAGE);
  if (!fs.existsSync(pageFile)) return [...out, `there is no sample/${SAMPLE_PAGE}`];
  const page = fs.readFileSync(pageFile, 'utf8');
  const made = /· made (\d{1,2} [A-Z][a-z]{2} \d{4}) ·/.exec(page);
  if (!made) return [...out, 'the sample page says no day it was made'];
  const epoch = String(Date.parse(`${made[1]} 00:00:00 UTC`) / 1000);
  const again = path.join(tmp(), SAMPLE_PAGE);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^DRIFTPROOF_|^SPEC0|^SOURCE_DATE_EPOCH$/.test(k)));
  const v = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'driftproof'), 'view', `sample/${report}`, '--out', again], { cwd: pluginDir, encoding: 'utf8', env: { ...env, SOURCE_DATE_EPOCH: epoch } });
  if (v.status !== 0) out.push(`the CLI did not write the page again: ${v.stderr.slice(-200)}`);
  else if (!fs.readFileSync(again).equals(Buffer.from(page))) out.push('the sample page is not the page the CLI writes for the sample receipts');
  const title = /<title>([^<]*)<\/title>/.exec(page);
  const eyebrow = /<p class="eyebrow">([^<]*)<\/p>/.exec(page);
  if (!title || !title[1].includes(`sample/${report}`)) out.push(`the sample page's title does not say sample/${report}`);
  if (!eyebrow || !eyebrow[1].includes(`sample/${report}`)) out.push(`the sample page's first line does not say sample/${report}`);
  const named = [['skill', first.skill.name], ['model', first.run.model_id], ...Object.values(mine).map((r) => ['run date', r.run.date_utc])];
  for (const [what, value] of named) if (!page.includes(value)) out.push(`the sample page does not name the ${what} ${value}`);
  return out;
}

test('AC-368-1 to AC-368-3: the sample is every receipt of one pair in a published report, unaltered, the page is the CLI\'s for them, and it says it is a sample', () => {
  assert.deepEqual(readSampleFiles(PLUGIN), []);
  const reportDir = (d) => path.join(d, 'sample', sampleReport(d)[0]);
  // Plant (AC-368-1): one score changed in a copy of a sample receipt.
  const a = path.join(tmp(), 'plugin');
  fs.cpSync(PLUGIN, a, { recursive: true });
  const f = path.join(reportDir(a), Object.keys(receiptsUnder(reportDir(a)))[0]);
  const t = fs.readFileSync(f, 'utf8');
  const m = /"with_skill_score": ([0-9.]+)/.exec(t);
  assert.ok(m, 'plant not applied: the sample receipt carries no with_skill_score');
  fs.writeFileSync(f, t.replace(m[0], `"with_skill_score": ${Number(m[1]) === 0 ? 0.5 : 0}`));
  const pa = readSampleFiles(a);
  assert.ok(reds(pa, /no tracked receipt/) && reds(pa, /does not verify/), pa.join('\n'));
  // Plant (AC-368-1, M1): one run's receipt removed from a copy, so the sample would pick runs.
  const g = path.join(tmp(), 'plugin');
  fs.cpSync(PLUGIN, g, { recursive: true });
  const keys = Object.keys(receiptsUnder(reportDir(g)));
  assert.ok(keys.length > 1, 'plant not applied: the sample holds one receipt');
  fs.rmSync(path.join(reportDir(g), keys[keys.length - 1]));
  assert.ok(reds(readSampleFiles(g), /leaves out/), 'a sample with a run left out was not read RED');
  // Plant (AC-368-2): one figure changed in a copy of the page.
  const page = fs.readFileSync(path.join(PLUGIN, 'sample', SAMPLE_PAGE), 'utf8');
  const fig = /\d\.\d{3}/.exec(page);
  assert.ok(fig, 'plant not applied: the sample page carries no figure');
  const b = planted([path.join('sample', SAMPLE_PAGE), fig[0], fig[0] === '0.999' ? '0.998' : '0.999']);
  assert.ok(reds(readSampleFiles(b), /not the page the CLI writes/), 'a changed figure was not seen');
});

// AC-368-3 to AC-368-5, the door: with no skill, the sample opened from the plugin by its path, no CLI
// and no model spawned, nothing written, and the way on named; with a skill, or from a skill folder, none.
function readSampleDoor(pluginDir) {
  const out = [];
  const sb = sandbox();
  fs.rmSync(sb.skill, { recursive: true, force: true });
  const before = snapshot(sb.work);
  const r = door(sb, ['start'], { doorFile: doorOf(pluginDir) });
  if (r.status !== 0) out.push(`start with no skill exited ${r.status}: ${r.stderr.slice(-200)}`);
  if (spawns(sb).length) out.push(`start with no skill spawned ${spawns(sb).map((s) => s.bin).join(', ')}`);
  const opened = fs.existsSync(sb.openLog) ? fs.readFileSync(sb.openLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const want = path.join(fs.realpathSync(pluginDir), 'sample', SAMPLE_PAGE);
  if (JSON.stringify(opened) !== JSON.stringify([[want]])) out.push(`the opener was given ${JSON.stringify(opened)}, not the sample page's path alone`);
  if (JSON.stringify(snapshot(sb.work)) !== JSON.stringify(before)) out.push('start with no skill changed the working folder');
  const recs = sampleReceipts(pluginDir);
  const num = sampleReport(pluginDir)[0].slice('report-'.length);
  // The line that names the pair's skill begins "a sample results page" and says whose runs it shows.
  const line = (r.stdout.split('\n').find((l) => l.includes(recs[0].skill.name)) || '').replace('[driftproof-plugin] ', '');
  if (!line.startsWith('a sample results page')) out.push('the door\'s line that names the receipts does not call it a sample');
  if (!line.includes(`a sample of report ${num}'s runs`)) out.push(`the door's line does not say it is a sample of report ${num}'s runs`);
  for (const v of [`${recs.length} runs`, recs[0].skill.name, recs[0].run.model_id, ...recs.map((x) => x.run.date_utc.slice(0, 10))]) if (!line.includes(v)) out.push(`the door's line does not name ${v}`);
  if (!r.stdout.includes('~/.claude/skills')) out.push('the door does not name ~/.claude/skills');
  if (!r.stdout.includes('/driftproof:start')) out.push('the door does not say to type /driftproof:start');
  // Where the walk sees a SKILL.md, or cannot see every folder, no sample (B1).
  const cases = [
    ['with a skill listed', () => null],
    ['from a skill folder', (s) => s.skill],
    ['with a skill in .claude/skills alone', (s) => { fs.mkdirSync(path.join(s.work, '.claude', 'skills'), { recursive: true }); fs.renameSync(s.skill, path.join(s.work, '.claude', 'skills', 'my-skill')); return null; }],
    ['with a linked skill folder and a link cycle', (s) => { const far = path.join(s.root, 'dotfiles'); fs.mkdirSync(far); fs.renameSync(s.skill, path.join(far, 'my-skill')); fs.symlinkSync(path.join(far, 'my-skill'), path.join(s.work, 'my-skill')); fs.symlinkSync(s.work, path.join(s.work, 'loop')); return null; }],
    ['with a linked SKILL.md', (s) => { const far = path.join(s.root, 'SKILL-far.md'); fs.renameSync(path.join(s.skill, 'SKILL.md'), far); fs.symlinkSync(far, path.join(s.skill, 'SKILL.md')); return null; }],
  ];
  if (process.getuid && process.getuid() !== 0) cases.push(['with a folder it cannot read', (s) => { fs.rmSync(s.skill, { recursive: true, force: true }); const locked = path.join(s.work, 'locked'); fs.mkdirSync(locked); fs.chmodSync(locked, 0); made.push(locked); return null; }]);
  for (const [name, prep] of cases) {
    const s2 = sandbox();
    const cwd = prep(s2) || s2.work;
    const r2 = door(s2, ['start'], { doorFile: doorOf(pluginDir), cwd });
    const locked = path.join(s2.work, 'locked');
    if (fs.existsSync(locked)) fs.chmodSync(locked, 0o755);
    if (r2.status !== 0) out.push(`start ${name} exited ${r2.status}: ${r2.stderr.slice(-200)}`);
    if (fs.existsSync(s2.openLog)) out.push(`start ${name} opened ${fs.readFileSync(s2.openLog, 'utf8').trim()}`);
    if (!/folder it cannot read/.test(name) && !/from a skill folder/.test(name) && !/my-skill/.test(r2.stdout)) out.push(`start ${name} did not list the skill`);
  }
  return out;
}

test('AC-368-3 to AC-368-5: with no skill, start opens the sample by its path alone, spawns no CLI and writes nothing; with a skill it does not', () => {
  assert.deepEqual(readSampleDoor(PLUGIN), []);
  const page = fs.readFileSync(path.join(PLUGIN, 'sample', SAMPLE_PAGE), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(page);
  assert.ok(csp && /default-src 'none'/.test(csp[1]), 'the sample page carries no default-src \'none\'');
  assert.doesNotMatch(htmlOutsideScriptBodies(page), /(?:src|href)="(?:https?:)?\/\/|@import|url\((?!#|data:)/);
  for (const [name, edits, re] of [
    ['the sample rendered through the CLI', [['lib/door.mjs', 'openView(SAMPLE_PAGE);', "runCli(['view', path.join(PLUGIN_ROOT, 'sample'), '--out', 'driftproof-view.html']); openView(SAMPLE_PAGE);"]], /spawned npx|changed the working folder/],
    ['a line that drops the word sample', [['lib/door.mjs', "'a sample results page", "'a results page"]], /does not call it a sample/],
    ['the sample opened on every listing', [['lib/door.mjs', "  say('skills under ' + root + ':');", "  openSample();\n  say('skills under ' + root + ':');"]], /with a skill listed opened/],
    ['a line that drops ~/.claude/skills', [['lib/door.mjs', "'~/.claude/skills'", "'your skills folder'"]], /~\/\.claude\/skills/],
    // B1: a walk that does not look in .claude/skills, that does not follow links, or that reads a folder
    // it could not read as empty.
    ['no walk of .claude/skills', [['lib/door.mjs', '  walk(DOT_SKILLS, 1);\n', '']], /\.claude\/skills alone opened/],
    ['no link followed', [['lib/door.mjs', 'const followed = (d, e) => e.isSymbolicLink() && kindOf(path.join(d, e.name));', 'const followed = () => null;']], /linked skill folder and a link cycle opened|linked SKILL\.md opened/],
    ...(process.getuid && process.getuid() !== 0 ? [['a folder it could not read read as empty', [['lib/door.mjs', "if (!entries) { short = short || 'it could not read ' + d", "if (!entries) { void 0 && 'it could not read ' + d"]], /cannot read opened/]] : []),
  ]) assert.ok(reds(readSampleDoor(planted(...edits)), re), `${name}: not read RED`);
  // Sample receipts that name another skill: the door's line follows the receipts, never a typed name.
  const c = path.join(tmp(), 'plugin');
  fs.cpSync(PLUGIN, c, { recursive: true });
  const rd = path.join(c, 'sample', sampleReport(c)[0]);
  for (const f of Object.keys(receiptsUnder(rd))) {
    const r = JSON.parse(fs.readFileSync(path.join(rd, f), 'utf8'));
    r.skill.name = 'renamed-for-a-plant';
    fs.writeFileSync(path.join(rd, f), JSON.stringify(r));
  }
  assert.deepEqual(readSampleDoor(c), []);
});

// AC-368-6, the git check before any drafting: the listing says where there is no repository, and
// start.md has Claude raise it before step 3 and ask it inside the one yes.
function readGitCheck(pluginDir) {
  const out = [];
  const sb = sandbox({ suite: false });
  fs.rmSync(path.join(sb.work, '.git'), { recursive: true, force: true });
  const r = door(sb, ['start'], { doorFile: doorOf(pluginDir) });
  if (r.status !== 0) out.push(`the listing with no repository exited ${r.status}`);
  if (spawns(sb).length) out.push('the listing with no repository spawned');
  if (!/no git repository here/.test(r.stdout)) out.push('the listing does not say there is no git repository here');
  if (!/only if you wrote it/.test(r.stdout)) out.push('the listing does not say the skill runs as you only if you wrote it');
  if (!/--trust-outside-repo/.test(r.stdout)) out.push('the listing does not name --trust-outside-repo');
  if (!/npx driftproof@\S+ run /.test(r.stdout)) out.push('the listing does not name the isolation command');
  if (!/as you, with your files and your Claude Code login, only if you wrote it/.test(r.stdout)) out.push('the listing does not say a skill runs as you, with your files and your Claude Code login');
  const md = fs.readFileSync(path.join(pluginDir, 'commands', 'start.md'), 'utf8');
  if (!/no git repository/.test(stepOf(md, 1))) out.push('start.md\'s step 1 does not say what the listing says of the repository');
  // Step 2, before step 3's drafting: the authorship question, its own, with the real path and what
  // running as you means; only its yes gives the flag (M2, M3). Step 2's first paragraph is spec 172's.
  const two = stepOf(md, 2).replace(/\s+/g, ' ');
  for (const words of ['no git repository', 'before any drafting', 'whether they wrote the skill', 'a question of its own', 'real path', 'runs as you, with your files and your Claude Code login', '--trust-outside-repo', 'A yes to the write alone never']) {
    if (!two.includes(words)) out.push(`start.md's step 2, before step 3's drafting, does not say ${JSON.stringify(words)}`);
  }
  if (!stepOf(md, 4).replace(/\s+/g, ' ').includes('never adds `--trust-outside-repo`')) out.push('start.md\'s step 4 does not say its yes never adds --trust-outside-repo');
  return out;
}
// One numbered step of start.md, from its number to the next step or section.
function stepOf(md, n) {
  const at = md.indexOf(`\n${n}. **`);
  if (at === -1) return '';
  const ends = [md.indexOf(`\n${n + 1}. **`, at), md.indexOf('\n## ', at)].filter((i) => i !== -1);
  return md.slice(at, ends.length ? Math.min(...ends) : undefined);
}

test('AC-368-6: where there is no git repository the listing says so, and start.md asks who wrote the skill in step 2, before any drafting, on its own', () => {
  assert.deepEqual(readGitCheck(PLUGIN), []);
  assert.ok(reds(readGitCheck(planted(['lib/door.mjs', '  repoNote();\n', ''])), /no git repository here/), 'a listing that says nothing of the repository was not read RED');
  // The authorship paragraph of step 2, moved after the drafting step (M2).
  const md = fs.readFileSync(path.join(PLUGIN, 'commands', 'start.md'), 'utf8');
  const two = stepOf(md, 2);
  const at = two.indexOf('\n\n   **Where there is no git repository**');
  assert.ok(at !== -1, 'plant not applied: start.md\'s step 2 carries no paragraph on a folder with no git repository');
  const para = two.slice(at);
  const moved = md.replace(two, two.slice(0, at)).replace('\n5. **Run it.**', `${para}\n5. **Run it.**`);
  assert.ok(reds(readGitCheck(planted(['commands/start.md', md, moved])), /step 2, before step 3/), 'an authorship paragraph after the drafting step was not read RED');
  // The question without the real path, without what running as you means, and step 4 without its rule (M3).
  for (const [name, from, to] of [
    ['no real path', 'real path', 'folder'],
    ['no "as you"', 'runs as you, with your files and your Claude Code login', 'runs here'],
    ['step 4 without its rule', 'never adds `--trust-outside-repo`', 'adds nothing'],
  ]) assert.ok(reds(readGitCheck(planted(['commands/start.md', from, to])), /does not say/), `${name}: not read RED`);
});

// AC-368-7, the existing lane and nothing wider: --trust-outside-repo on start under spec 140's conditions.
function readTrustLane(pluginDir) {
  const out = [];
  const d = doorOf(pluginDir);
  const draftIn = (sb) => { const f = path.join(sb.root, 'cases-draft.json'); fs.writeFileSync(f, JSON.stringify({ cases: [{ id: 'one', prompt: 'Say hi.', rubric: 'Says hi.' }] })); return f; };
  const noRepo = () => { const sb = sandbox({ suite: false }); fs.rmSync(path.join(sb.work, '.git'), { recursive: true, force: true }); return sb; };
  // With no repository and the flag, after the yes: the run, on the trusted lane.
  const a = noRepo();
  const ra = door(a, ['start', 'my-skill', '--cases', draftIn(a), '--confirm-write', '--trust-outside-repo'], { stub: false, doorFile: d });
  if (ra.status !== 0) out.push(`no repository, the flag and a yes: exit ${ra.status}: ${ra.stderr.slice(-300)}`);
  else {
    const v = npx(a);
    if (JSON.stringify(v.map((x) => x[0])) !== JSON.stringify(['--version', 'init', 'run', 'view'])) out.push(`no repository, the flag and a yes spawned ${JSON.stringify(v.map((x) => x[0]))}`);
    if (!(v.find((x) => x[0] === 'run') || []).includes('--trusted-skill')) out.push('the run did not carry --trusted-skill');
  }
  // With no repository and no flag: refused as DR-16s, with the isolation command, nothing spawned or written.
  const b = noRepo();
  const rb = door(b, ['start', 'my-skill', '--cases', draftIn(b), '--confirm-write'], { doorFile: d });
  if (rb.status !== 2 || !/this is not a git repository/.test(rb.stderr)) out.push(`no repository and no flag: exit ${rb.status}, not DR-16s`);
  if (!/npx driftproof@\S+ run \S+ --models/.test(rb.stderr)) out.push('no repository and no flag: the refusal prints no isolation command');
  if (spawns(b).length || fs.existsSync(path.join(b.skill, 'evals'))) out.push('no repository and no flag: something was spawned or written');
  // Inside a repository the flag is refused (DR-39's words).
  const c = sandbox();
  const rc = door(c, ['start', 'my-skill', '--trust-outside-repo'], { doorFile: d });
  if (rc.status !== 2 || !/--trust-outside-repo is for a folder with no git repository/.test(rc.stderr)) out.push(`the flag inside a repository: exit ${rc.status}, not refused`);
  // A skill outside the working folder, with the flag.
  const e = noRepo();
  const far = path.join(e.root, 'far-skill');
  fs.mkdirSync(far);
  fs.writeFileSync(path.join(far, 'SKILL.md'), '---\nname: far\n---\n');
  const re = door(e, ['start', far, '--trust-outside-repo'], { doorFile: d });
  if (re.status !== 2 || !/resolves outside the folder you run from/.test(re.stderr)) out.push(`a skill outside the working folder with the flag: exit ${re.status}, not refused`);
  // Where git cannot say.
  const g = noRepo();
  fs.writeFileSync(path.join(g.bin, 'git'), '#!/bin/sh\necho "fatal: unsafe repository" >&2\nexit 1\n', { mode: 0o755 });
  const rg = door(g, ['start', 'my-skill', '--trust-outside-repo'], { doorFile: d });
  if (rg.status !== 2 || !/git could not say/.test(rg.stderr)) out.push(`git that cannot say, with the flag: exit ${rg.status}, not refused`);
  for (const sb of [c, e, g]) if (spawns(sb).length) out.push('a refused trust route spawned');
  return out;
}

test('AC-368-7: start takes --trust-outside-repo on spec 140\'s lane, and nothing wider', () => {
  assert.deepEqual(readTrustLane(PLUGIN), []);
  assert.ok(reds(readTrustLane(planted(['lib/door.mjs', '  if (repo.none && confirmed) {', '  if (repo.none) {'])), /not DR-16s|something was spawned/), 'spec 140\'s M-4 plant was not read RED through start');
});

// AC-368-8, one yes before any write, whoever starts it.
const frontMatter = (text) => (/^---\n([\s\S]*?)\n---/.exec(text) || [null, null])[1];
function readInvocation(pluginDir) {
  const out = [];
  for (const c of ['init', 'run', 'badge', 'start']) {
    const fm = frontMatter(fs.readFileSync(path.join(pluginDir, 'commands', `${c}.md`), 'utf8'));
    const carries = fm !== null && /^disable-model-invocation:[ \t]*true[ \t]*$/m.test(fm);
    if (c === 'start' && carries) out.push('start.md carries disable-model-invocation: true');
    if (c !== 'start' && !carries) out.push(`${c}.md does not carry disable-model-invocation: true`);
    if (fm === null || !/^description: \S/m.test(fm)) out.push(`${c}.md has no description`);
  }
  const md = fs.readFileSync(path.join(pluginDir, 'commands', 'start.md'), 'utf8');
  if (!/Never give the flag on your own\./.test(md)) out.push('start.md does not say never to give --confirm-write on its own');
  if (!/Never give `--trust-outside-repo` on your own\./.test(md)) out.push('start.md does not say never to give --trust-outside-repo on its own');
  const sb = sandbox({ suite: false });
  const draft = path.join(sb.root, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'one', prompt: 'p', rubric: 'r' }] }));
  const r = door(sb, ['start', 'my-skill', '--cases', draft], { doorFile: doorOf(pluginDir) });
  if (r.status !== 2 || spawns(sb).length || fs.existsSync(path.join(sb.skill, 'evals'))) out.push('a draft without --confirm-write was not refused with nothing spawned or written');
  return out;
}

test('AC-368-8: Claude may start /driftproof:start, the other three keep the key, and the one yes still holds', () => {
  assert.deepEqual(readInvocation(PLUGIN), []);
  const md = fs.readFileSync(path.join(PLUGIN, 'commands', 'start.md'), 'utf8');
  assert.ok(reds(readInvocation(planted(['commands/start.md', md.slice(0, 4), '---\ndisable-model-invocation: true\n'])), /start\.md carries/), 'the key put back on start.md was not read RED');
  assert.ok(reds(readInvocation(planted(['commands/run.md', 'disable-model-invocation: true\n', ''])), /run\.md does not carry/), 'the key removed from run.md was not read RED');
});

// AC-368-9, quiet setup and refusals in full. The door's lines are the ones that carry its mark.
function doorLinesBeforeRunner(stdout) {
  const lines = stdout.split('\n').filter((l) => l.trim());
  const first = lines.findIndex((l) => !l.startsWith('[driftproof-plugin]'));
  return first === -1 ? null : lines.slice(0, first);
}
function readQuiet(pluginDir) {
  const out = [];
  const d = doorOf(pluginDir);
  const runner = require('../config').RUNNER_VERSION;
  const runs = [];
  const withSuite = sandbox();
  runs.push(['a skill with a suite', withSuite, door(withSuite, ['start', 'my-skill'], { doorFile: d }), /inside this git repository/]);
  const drafted = sandbox({ suite: false });
  const draft = path.join(drafted.root, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'one', prompt: 'Say hi.', rubric: 'Says hi.' }] }));
  runs.push(['a draft with --confirm-write', drafted, door(drafted, ['start', 'my-skill', '--cases', draft, '--confirm-write'], { doorFile: d }), /inside this git repository/]);
  const outside = sandbox();
  fs.rmSync(path.join(outside.work, '.git'), { recursive: true, force: true });
  runs.push(['--trust-outside-repo', outside, door(outside, ['start', 'my-skill', '--trust-outside-repo'], { doorFile: d }), /--trust-outside-repo/]);
  const full = sandbox();
  runs.push(['--full', full, door(full, ['start', 'my-skill', '--full'], { doorFile: d }), /inside this git repository/]);
  for (const [name, sb, r, why] of runs) {
    if (r.status !== 0) { out.push(`${name}: exit ${r.status}: ${r.stderr.slice(-300)}`); continue; }
    const before = doorLinesBeforeRunner(r.stdout);
    if (before === null) { out.push(`${name}: no runner line was seen`); continue; }
    if (before.length > 1) out.push(`${name}: ${before.length} door lines before the runner's first line`);
    const one = before.join('\n');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const checks = [['the skill\'s folder', new RegExp(esc(fs.realpathSync(sb.skill)))], ['that it runs as you', /runs as you, with your files and your Claude Code login/], ['why it runs as you', why], ['the runner version', new RegExp(`runner ${esc(runner)}`)], ['the model', /model \S+/]];
    // M4: a confirmed draft's one line names the file it adds, by its full path.
    if (sb === drafted) checks.push(['the file it adds', new RegExp(esc(path.join(fs.realpathSync(sb.skill), 'evals', 'evals.json')))]);
    for (const [what, re] of checks) if (!re.test(one)) out.push(`${name}: the door's line does not name ${what}`);
  }
  // A refusal after the setup lines: every held line, then the refusal whole.
  const sb = sandbox({ suite: false });
  const d2 = path.join(sb.root, 'cases-draft.json');
  fs.writeFileSync(d2, JSON.stringify({ cases: [{ id: 'one', prompt: 'p', rubric: 'r' }] }));
  const guard = path.join(path.dirname(path.dirname(d)), 'version-guard.json');
  const was = fs.readFileSync(guard, 'utf8');
  fs.writeFileSync(guard, JSON.stringify({ ...JSON.parse(was), start_minimum: '999.0.0' }, null, 2));
  try {
    const r = door(sb, ['start', 'my-skill', '--cases', d2, '--confirm-write'], { doorFile: d });
    if (r.status !== 2 || !/start needs driftproof 999\.0\.0 or later, and the pinned runner reported .* Nothing was written\./.test(r.stderr)) out.push('the refusal below start\'s own minimum was not printed whole');
    for (const re of [/resolved skill-dir=/, /treating this skill as the author's own/, /adding one new file/]) if (!re.test(r.stdout)) out.push(`the refusal came without the held line ${re}`);
  } finally { fs.writeFileSync(guard, was); }
  return out;
}

test('AC-368-9: a successful start prints one door line before the runner, naming what it rests on; a refusal prints in full', () => {
  // The tree's own plugin is read through a copy, because the refusal reading writes its guard.
  assert.deepEqual(readQuiet(planted()), []);
  assert.ok(reds(readQuiet(planted(['lib/door.mjs', "holding = command === 'start';", 'holding = false;'])), /door lines before/), 'a door that holds nothing back was not read RED');
  assert.ok(reds(readQuiet(planted(['lib/door.mjs', '  flushHeld();\n  process.stderr.write(MARK + \' REFUSED: \' + line', '  process.stderr.write(MARK + \' REFUSED: \' + line'])), /without the held line/), 'a refusal that drops the held lines was not read RED');
  // M4: the one line without "as you", and without the file it adds.
  assert.ok(reds(readQuiet(planted(['lib/door.mjs', "' runs as you, with your files and your Claude Code login, because '", "' runs, because '"])), /does not name that it runs as you/), 'a line without "as you" was not read RED');
  assert.ok(reds(readQuiet(planted(['lib/door.mjs', "'; adding one new file, ' + path.join(dir, 'evals', 'evals.json')", "'; adding one new file'"])), /does not name the file it adds/), 'a line without the file it adds was not read RED');
});

// AC-368-10, what to type, and AC-368-11, the directory checklist and the words.
const baseText = (rel) => spawnSync('git', ['-C', ROOT, 'show', `${BASE_368}:${rel}`], { encoding: 'utf8' }).stdout;
// A-139-19 (issue 372): a release writes its version into the section's driftproof@ pin, so each side is read with
// its own tree's version set aside. Any other byte reads RED. A-139-20 (issue 382): set aside by the shared
// normaliser's setAside, the version being the one each side's plugin manifest carries, which a release bumps with
// the pins; the repository gate holds the manifest to package.json's.
async function readWhatToType(pluginDir) {
  const { setAside } = await import(path.join(ROOT, 'scripts', 'build-report-baselines.mjs'));
  const out = [];
  const m = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
  if (m.description !== `${DESCRIPTOR}. Type /driftproof:start ${WHAT_TO_TYPE}`) out.push(`the description is ${JSON.stringify(m.description)}`);
  const md = fs.readFileSync(path.join(pluginDir, 'README.md'), 'utf8');
  const lines = md.split('\n');
  const first = lines.slice(1).find((l) => l.trim());
  if (lines[0] !== '# Driftproof for Claude Code' || first !== `Type \`/driftproof:start\` ${WHAT_TO_TYPE}`) out.push(`the README's first line after its title is ${JSON.stringify(first)}`);
  const head = '## What it sends, and where';
  const at = md.indexOf(head);
  const list = md.indexOf('- `/driftproof:badge');
  if (at === -1 || list === -1 || at < list) out.push('the section What it sends, and where does not come after the command list');
  const base = baseText('plugin/driftproof/README.md');
  const body = (t) => { const i = t.indexOf(head); if (i === -1) return null; const j = t.indexOf('\n## ', i + head.length); return t.slice(i, j === -1 ? undefined : j); };
  const aside = (sec, manifest) => sec === null ? null : setAside(sec, JSON.parse(manifest).version);
  const tree = aside(body(md), JSON.stringify(m));
  if (tree === null || tree !== aside(body(base), baseText('plugin/driftproof/.claude-plugin/plugin.json'))) out.push('the section What it sends, and where is not the Base\'s byte for byte');
  return out;
}
// A-139-20 (issue 382): a copy of the plugin with release-prepare's own bump, its BUMP_ANCHORS for the plugin's files
// (or for one of them) applied by its applyAnchors, to 9.9.9.
async function bumpedPlugin(only) {
  const { BUMP_ANCHORS, applyAnchors } = await import(path.join(ROOT, 'scripts', 'pipeline.mjs'));
  const at = 'plugin/driftproof/';
  const anchors = BUMP_ANCHORS.filter((a) => a.file.startsWith(at) && (!only || a.file === at + only));
  const files = [...new Set(anchors.map((a) => a.file))];
  const text = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const { out, problems } = applyAnchors(new Map(files.map((f) => [f, text(f)])), anchors, JSON.parse(text('package.json')).version, '9.9.9');
  assert.deepEqual(problems, []);
  assert.equal(out.size, only ? 1 : 2, 'the bump moved the plugin\'s files');
  return planted(...[...out].map(([f, now]) => [f.slice(at.length), text(f), now]));
}

test('AC-368-10: the description and the README\'s first line say what to type, and the network section is the Base\'s, after the commands', async () => {
  assert.deepEqual(await readWhatToType(PLUGIN), []);
  assert.ok(reds(await readWhatToType(planted(['.claude-plugin/plugin.json', `. Type /driftproof:start ${WHAT_TO_TYPE}`, ''])), /the description is/), 'the descriptor alone was not read RED');
  const md = fs.readFileSync(path.join(PLUGIN, 'README.md'), 'utf8');
  const i = md.indexOf('## What it sends, and where');
  const sec = md.slice(i);
  const moved = md.slice(0, i).replace('This plugin adds four commands:', `${sec}\nThis plugin adds four commands:`);
  assert.ok(reds(await readWhatToType(planted(['README.md', md, moved])), /does not come after the command list/), 'the section above the command list was not read RED');
  // A-139-20 (issue 382): the release bump to 9.9.9 reads GREEN here and in the checklist; the README's pins bumped
  // without the manifest, and one other byte of the section beside the bump, read RED.
  const bumped = await bumpedPlugin();
  assert.deepEqual(await readWhatToType(bumped), []);
  assert.deepEqual(await readChecklist(bumped), []);
  assert.ok(reds(await readWhatToType(await bumpedPlugin('README.md')), /not the Base's byte for byte/), 'the pins bumped without the manifest were not read RED');
  const sent = fs.readFileSync(path.join(bumped, 'README.md'), 'utf8');
  const at = sent.indexOf('## What it sends, and where');
  const word = /\n- ([A-Z][a-z]+) /.exec(sent.slice(at));
  assert.ok(word, 'the section carries no item to plant in');
  fs.writeFileSync(path.join(bumped, 'README.md'), sent.slice(0, at) + sent.slice(at).replace(word[0], `\n- ${word[1]}s `));
  assert.ok(reds(await readWhatToType(bumped), /not the Base's byte for byte/), 'a changed byte beside the bump was not read RED');
});

const IMAGE = /\.(png|jpe?g|gif|webp|ico|svg)$/i;
async function readChecklist(pluginDir) {
  const out = [];
  const files = fs.readdirSync(pluginDir, { recursive: true }).filter((f) => fs.statSync(path.join(pluginDir, f)).isFile());
  if (files.length >= 512) out.push(`the plugin holds ${files.length} files`);
  for (const f of files) {
    if (path.basename(f) === '.gitattributes') out.push(`the plugin carries ${f}`);
    if (!IMAGE.test(f) && fs.statSync(path.join(pluginDir, f)).size >= 256 * 1024) out.push(`${f} is 256 KiB or more`);
  }
  const md = fs.readFileSync(path.join(pluginDir, 'README.md'), 'utf8');
  const words = md.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>|-]+/g, ' ').split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t)).length;
  if (words < 40) out.push(`the README carries ${words} words`);
  const v = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const pins = [...md.matchAll(/npx driftproof@([0-9][0-9A-Za-z.+-]*[0-9A-Za-z])/g)].map((x) => x[1]);
  if (!pins.length || pins.some((p) => p !== v)) out.push(`the README pins ${JSON.stringify(pins)}, and the manifest's version is ${v}`);
  // The words: no line added under plugin/ since the Base carries a lexicon phrasing or confidence language
  // (A-139-21, issue 378: the em dash is set aside, as spec 035's AC-9 sets it aside). Every file but an
  // image is read; a sample receipt is exempt by path (AC-368-1 holds its bytes).
  const receipt = (f) => {
    const m = /^sample\/(report-\d{3})\/(.+\.json)$/.exec(f);
    return !!m && fs.existsSync(path.join(ROOT, 'receipts', m[1], m[2]));
  };
  const { LEXICON } = await import(path.join(ROOT, 'specs', '031-artefact-claims', 'probes', 'bands.mjs'));
  const src = fs.readFileSync(path.join(ROOT, 'specs', '035-underpowered-verdict', 'probes', 'surfaces.mjs'), 'utf8');
  const lx = /const LEX_EXTRA = \/(.*)\/([a-z]*);/.exec(src);
  assert.ok(lx, 'could not read LEX_EXTRA out of spec 035 probes/surfaces.mjs');
  const LEX_EXTRA = new RegExp(lx[1], lx[2]);
  for (const rel of files.map((f) => f.split(path.sep).join('/')).filter((f) => !IMAGE.test(f) && !receipt(f))) {
    const was = new Set(baseText(`plugin/driftproof/${rel}`).split('\n'));
    for (const line of fs.readFileSync(path.join(pluginDir, rel), 'utf8').split('\n')) {
      if (was.has(line) || !line.trim()) continue;
      if (LEX_EXTRA.test(line.replace(/—|&mdash;/gi, ' '))) out.push(`${rel}: confidence language: ${line.trim().slice(0, 100)}`);
      for (const { cls, re } of LEXICON) if (re.test(line)) out.push(`${rel}: band lexicon ${cls}: ${line.trim().slice(0, 100)}`);
    }
  }
  return out;
}

test('AC-368-11: the plugin folder keeps the directory checklist, and the added lines keep the wording rules', async () => {
  assert.deepEqual(await readChecklist(PLUGIN), []);
  const big = path.join(tmp(), 'plugin');
  fs.cpSync(PLUGIN, big, { recursive: true });
  fs.writeFileSync(path.join(big, 'sample', 'notes.txt'), 'x'.repeat(300 * 1024));
  assert.ok(reds(await readChecklist(big), /256 KiB or more/), 'a 300 KiB file was not read RED');
  const md = fs.readFileSync(path.join(PLUGIN, 'commands', 'start.md'), 'utf8');
  // A-139-21 (issue 378): the plants carry confidence language where they carried an em dash, and an em dash
  // alone in start.md reads GREEN.
  const sure = planted(['commands/start.md', md, md.replace('# /driftproof:start\n', '# /driftproof:start\n\nA first result, with confidence, in one sitting.\n')]);
  assert.ok(reds(await readChecklist(sure), /start\.md: confidence language/), 'confidence language in start.md was not read RED');
  const dash = planted(['commands/start.md', md, md.replace('# /driftproof:start\n', '# /driftproof:start\n\nA first result — in one sitting.\n')]);
  assert.deepEqual(await readChecklist(dash), [], 'an em dash alone in start.md is not read');
  // F-1: an added plugin file other than a receipt is read, and so is a .json beside the receipts that is not one.
  const added = planted();
  fs.writeFileSync(path.join(added, 'sample', 'notes.md'), 'A sample, with confidence, of one report.\n');
  assert.ok(reds(await readChecklist(added), /sample\/notes\.md: confidence language/), 'confidence language in an added file was not read RED');
  const beside = planted();
  fs.writeFileSync(path.join(beside, 'sample', sampleReport(beside)[0], 'notes.json'), '{"note": "a sample, with confidence, of one report"}\n');
  assert.ok(reds(await readChecklist(beside), /notes\.json: confidence language/), 'confidence language in a .json that is no receipt was not read RED');
});
