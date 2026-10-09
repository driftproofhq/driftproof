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
