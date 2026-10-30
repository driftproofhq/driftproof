// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 553: the plugin takes a CLAUDE.md or AGENTS.md as well as a skill folder, the CLI's usage
// names a rules file and --suite, and the README says how to test one.
//
//   node --test tests/rules-file-door.test.js
//
// THE DOUBLES ARE SPEC 028'S, as in tests/start.test.js: its fake `npx` maps `driftproof@<pinned>`
// onto this checkout's bin/driftproof under DRIFTPROOF_STUB=1 and logs every argument vector. A fake
// opener records what the door asks it to open. Every folder is under the system temp directory and
// removed after. No model is called.

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
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'issue553-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const TASKS = { cases: [{ id: 'a', prompt: 'Write a commit message for a typo fix.', rubric: 'One line, imperative mood. A fully correct answer scores 0.80.' }] };
const RULES = '# Project rules\n\nWrite commit messages in the imperative mood.\n';

// A sandbox: a working folder in a git repository (unless repo is false) holding a rules file, a
// skill, a tasks file inside the repository, a draft outside it, a spawn log and a fake opener.
function sandbox({ repo = true, name = 'CLAUDE.md' } = {}) {
  const root = tmp();
  const work = path.join(root, 'work');
  fs.mkdirSync(path.join(work, 'my-skill', 'evals'), { recursive: true });
  fs.writeFileSync(path.join(work, 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\n\n# my-skill\n\nBe brief.\n');
  fs.writeFileSync(path.join(work, 'my-skill', 'evals', 'evals.json'), JSON.stringify(TASKS));
  fs.writeFileSync(path.join(work, name), RULES);
  fs.writeFileSync(path.join(work, 'tasks.json'), JSON.stringify(TASKS));
  const draft = path.join(root, 'draft-tasks.json');
  fs.writeFileSync(draft, JSON.stringify(TASKS));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const openLog = path.join(root, 'open.ndjson');
  for (const opener of ['xdg-open', 'open']) {
    fs.writeFileSync(path.join(bin, opener), `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(openLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`, { mode: 0o755 });
  }
  if (repo) spawnSync('git', ['init', '-q'], { cwd: work });
  return { root, work, bin, draft, rules: path.join(work, name), log: path.join(root, 'spawns.ndjson'), openLog };
}
function door(sb, args, { cwd = sb.work } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^OPENAI_|^DRIFTPROOF_|^SPEC0|^GIT_/.test(k)) continue;
    env[k] = v;
  }
  Object.assign(env, {
    PATH: [sb.bin, FAKE_BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    SPEC028_ROOT: ROOT, SPEC028_SPAWNLOG: sb.log, GIT_CEILING_DIRECTORIES: sb.root, DRIFTPROOF_STUB: '1',
  });
  return spawnSync(process.execPath, [DOOR, ...args], { cwd, env, encoding: 'utf8', timeout: 300000 });
}
const spawns = (sb) => (fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const npx = (sb) => spawns(sb).filter((s) => s.bin === 'npx').map((s) => s.argv.slice(1));
const runs = (sb) => npx(sb).filter((v) => v[0] === 'run');
const valueOf = (v, flag) => (v.indexOf(flag) >= 0 ? v[v.indexOf(flag) + 1] : undefined);
const refusedQuietly = (sb, r, re) => {
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, re);
  assert.deepEqual(npx(sb), [], 'nothing was spawned');
  assert.equal(fs.existsSync(path.join(sb.work, 'receipts')), false, 'no receipts folder');
};

test('run takes a CLAUDE.md with --suite, on the trusted lane, and writes a context-file receipt', () => {
  const sb = sandbox();
  const r = door(sb, ['run', 'CLAUDE.md', '--suite', 'tasks.json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [v] = runs(sb);
  assert.equal(v[1], fs.realpathSync(sb.rules));
  assert.equal(valueOf(v, '--suite'), fs.realpathSync(path.join(sb.work, 'tasks.json')));
  assert.equal(v[v.length - 1], '--trusted-skill');
  assert.equal(v.includes('--placebo'), false);
  const receipts = fs.readdirSync(path.join(sb.work, 'receipts')).filter((f) => f.endsWith('.json') && !f.includes('.regrade'));
  assert.equal(receipts.length, 1);
  const receipt = JSON.parse(fs.readFileSync(path.join(sb.work, 'receipts', receipts[0]), 'utf8'));
  assert.equal(JSON.stringify(receipt).includes('context_file'), true, 'the receipt names a context file');
  assert.equal(fs.readFileSync(sb.rules, 'utf8'), RULES, 'the rules file is unchanged');
});

test('run takes an AGENTS.md with --placebo, emitted once', () => {
  const sb = sandbox({ name: 'AGENTS.md' });
  const r = door(sb, ['run', 'AGENTS.md', '--suite', 'tasks.json', '--placebo']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [v] = runs(sb);
  assert.equal(v.filter((x) => x === '--placebo').length, 1, JSON.stringify(v));
});

test('a skill folder still runs as before, and takes --placebo', () => {
  const sb = sandbox();
  const r = door(sb, ['run', 'my-skill', '--placebo']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [v] = runs(sb);
  assert.equal(v.includes('--suite'), false);
  assert.equal(v.includes('--placebo'), true);
});

test('the path checks of the input contract hold for a rules file and its suite', () => {
  // A file with another name, a link, a suite carrying a shell metacharacter or a control character,
  // and a rules file under a folder whose name carries one: each refused before anything is spawned.
  let sb = sandbox();
  fs.writeFileSync(path.join(sb.work, 'notes.md'), RULES);
  refusedQuietly(sb, door(sb, ['run', 'notes.md', '--suite', 'tasks.json']), /REFUSED: skill-dir: .*CLAUDE\.md or AGENTS\.md/);
  sb = sandbox();
  fs.renameSync(sb.rules, path.join(sb.work, 'real.md'));
  fs.symlinkSync(path.join(sb.work, 'real.md'), sb.rules);
  refusedQuietly(sb, door(sb, ['run', 'CLAUDE.md', '--suite', 'tasks.json']), /REFUSED: skill-dir: .*link/);
  for (const bad of ['a;b.json', 'a$(x).json', 'a\u0001b.json']) {
    sb = sandbox();
    fs.writeFileSync(path.join(sb.work, bad), JSON.stringify(TASKS));
    refusedQuietly(sb, door(sb, ['run', 'CLAUDE.md', '--suite', bad]), /REFUSED: suite: contains/);
  }
  sb = sandbox();
  fs.mkdirSync(path.join(sb.work, 'x`y'));
  fs.writeFileSync(path.join(sb.work, 'x`y', 'CLAUDE.md'), RULES);
  refusedQuietly(sb, door(sb, ['run', 'x`y/CLAUDE.md', '--suite', 'tasks.json']), /REFUSED: skill-dir: contains a shell metacharacter/);
  sb = sandbox();
  refusedQuietly(sb, door(sb, ['run', 'CLAUDE.md', '--suite', 'missing.json']), /REFUSED: suite: not a file/);
  sb = sandbox();
  fs.symlinkSync(path.join(sb.work, 'tasks.json'), path.join(sb.work, 'linked.json'));
  refusedQuietly(sb, door(sb, ['run', 'CLAUDE.md', '--suite', 'linked.json']), /REFUSED: suite: .*link/);
});

test('--suite is for a rules file only, and a run suite stays inside the repository', () => {
  let sb = sandbox();
  refusedQuietly(sb, door(sb, ['run', 'my-skill', '--suite', 'tasks.json']), /REFUSED: .*evals\/evals\.json.*--suite/);
  sb = sandbox();
  refusedQuietly(sb, door(sb, ['run', 'CLAUDE.md', '--suite', sb.draft]), /REFUSED: the tasks file .* resolves outside this repository/);
  sb = sandbox();
  const outside = path.join(sb.root, 'CLAUDE.md');
  fs.writeFileSync(outside, RULES);
  refusedQuietly(sb, door(sb, ['run', outside, '--suite', 'tasks.json']), /REFUSED: the rules file at .* resolves outside this repository/);
});

test('a rules file with no suite is offered a draft through start, and run writes nothing', () => {
  const sb = sandbox();
  const r = door(sb, ['run', 'CLAUDE.md']);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /has no tasks file yet.*\/driftproof:start .*CLAUDE\.md/);
  assert.match(r.stderr, /SUITE_REQUIRED/);
  assert.equal(fs.existsSync(path.join(sb.work, 'receipts')), false);
});

test('repository capture is not taken by the door, which names the CLI', () => {
  const sb = sandbox();
  refusedQuietly(sb, door(sb, ['run', 'CLAUDE.md', '--suite', 'tasks.json', '--capture', 'repository']), /run does not take --capture/);
});

test('start on a rules file asks for the yes first, then runs the quick run on the draft and opens the page', () => {
  let sb = sandbox();
  const no = door(sb, ['start', 'CLAUDE.md', '--suite', sb.draft]);
  refusedQuietly(sb, no, /receipts.*driftproof-view\.html.*--confirm-write/s);
  assert.deepEqual(fs.readdirSync(sb.work).sort(), ['.git', 'CLAUDE.md', 'my-skill', 'tasks.json']);
  sb = sandbox();
  const r = door(sb, ['start', 'CLAUDE.md', '--suite', sb.draft, '--confirm-write']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const vectors = npx(sb);
  assert.deepEqual(vectors.map((v) => v[0]), ['--version', 'run', 'view'], 'no init: nothing is added beside the rules file');
  const [quick] = runs(sb);
  assert.equal(quick[1], fs.realpathSync(sb.rules));
  assert.equal(valueOf(quick, '--suite'), sb.draft);
  for (const f of ['--quick', '--trusted-skill']) assert.ok(quick.includes(f), f);
  assert.equal(quick.includes('--placebo'), false);
  assert.equal(fs.readFileSync(sb.rules, 'utf8'), RULES);
  assert.deepEqual(fs.readdirSync(sb.work).filter((f) => !['receipts', 'transcripts', 'driftproof-view.html'].includes(f)).sort(), ['.git', 'CLAUDE.md', 'my-skill', 'tasks.json']);
  assert.ok(fs.existsSync(path.join(sb.work, 'driftproof-view.html')));
  const opened = fs.readFileSync(sb.openLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(opened, [[path.join(sb.work, 'driftproof-view.html')]]);
});

test('start on a rules file refuses a skill draft, no suite, and --placebo without --full', () => {
  let sb = sandbox();
  refusedQuietly(sb, door(sb, ['start', 'CLAUDE.md', '--cases', sb.draft, '--confirm-write']), /--cases .*skill/);
  sb = sandbox();
  refusedQuietly(sb, door(sb, ['start', 'CLAUDE.md', '--confirm-write']), /no tasks file.*--suite/);
  sb = sandbox();
  refusedQuietly(sb, door(sb, ['start', 'CLAUDE.md', '--suite', sb.draft, '--confirm-write', '--placebo']), /--placebo .*--full/);
  sb = sandbox();
  refusedQuietly(sb, door(sb, ['start', 'my-skill', '--suite', sb.draft]), /REFUSED: .*evals\/evals\.json.*--suite/);
});

test('start --full on a rules file passes --placebo and the five-task cap to the full run', () => {
  const sb = sandbox();
  const r = door(sb, ['start', 'CLAUDE.md', '--suite', sb.draft, '--confirm-write', '--full', '--placebo']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [full] = runs(sb);
  assert.equal(runs(sb).length, 1);
  assert.equal(full.includes('--quick'), false);
  assert.equal(valueOf(full, '--max-cases'), '5');
  assert.equal(valueOf(full, '--suite'), sb.draft);
  assert.equal(full.filter((x) => x === '--placebo').length, 1);
});

test('start with no folder lists a CLAUDE.md or AGENTS.md here and opens no sample', () => {
  const sb = sandbox();
  fs.rmSync(path.join(sb.work, 'my-skill'), { recursive: true });
  fs.writeFileSync(path.join(sb.work, 'AGENTS.md'), RULES);
  const r = door(sb, ['start']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /rules files here/);
  assert.match(r.stdout, /^ {2}AGENTS\.md/m);
  assert.match(r.stdout, /^ {2}CLAUDE\.md/m);
  assert.equal(fs.existsSync(sb.openLog), false, 'no sample was opened');
  assert.deepEqual(npx(sb), []);
});

test('with no git repository a rules file runs only after the person says it is theirs', () => {
  let sb = sandbox({ repo: false });
  refusedQuietly(sb, door(sb, ['run', 'CLAUDE.md', '--suite', 'tasks.json']), /not a git repository.*--trust-outside-repo/s);
  sb = sandbox({ repo: false });
  const r = door(sb, ['run', 'CLAUDE.md', '--suite', 'tasks.json', '--trust-outside-repo']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(runs(sb).length, 1);
});

test('the command files say how to test a rules file, what the placebo and repository capture cost', () => {
  const start = fs.readFileSync(path.join(ROOT, 'plugin', 'driftproof', 'commands', 'start.md'), 'utf8');
  const run = fs.readFileSync(path.join(ROOT, 'plugin', 'driftproof', 'commands', 'run.md'), 'utf8');
  assert.match(start, /door\.mjs" start <rules-file> --suite <draft> --confirm-write\n/);
  assert.match(run, /door\.mjs" run <rules-file> --suite <tasks> \[--placebo\]\n/);
  for (const text of [start, run]) {
    for (const word of ['CLAUDE.md', 'AGENTS.md', '--placebo', '--capture repository', 'half as many calls again']) assert.ok(text.includes(word), word);
  }
});

test('the CLI usage names a rules file and --suite', () => {
  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'driftproof'), '--help'], { encoding: 'utf8' }).stdout;
  assert.match(help, /driftproof run <skill-dir \| rules-file> /);
  assert.match(help, /\[--suite FILE\]/);
  assert.match(help, /a rules file .*needs --suite FILE/i);
});

// The README section: its length, and every command in it, read against the code that takes it.
test('the README section is short and its commands are ones the CLI and the plugin take', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const at = readme.indexOf('\n### Test your CLAUDE.md or AGENTS.md\n');
  assert.ok(at >= 0, 'the README has the section');
  const rest = readme.slice(at + 1);
  const end = rest.slice(4).search(/\n#{2,3} /);
  const section = end < 0 ? rest : rest.slice(0, end + 5);
  assert.ok(section.trim().split('\n').length <= 25, `the section is ${section.trim().split('\n').length} lines`);
  const bin = fs.readFileSync(path.join(ROOT, 'bin', 'driftproof'), 'utf8');
  const cliRun = JSON.parse(`[${/^ {2}run: \[(.*)\],$/m.exec(bin)[1].replace(/'/g, '"')}]`);
  const doorText = fs.readFileSync(DOOR, 'utf8');
  const doorAccepts = (c) => JSON.parse(`[${new RegExp(`^ {2}${c}: \\[(.*)\\],$`, 'm').exec(doorText)[1].replace(/'/g, '"')}]`);
  const lines = section.split('\n').filter((l) => /^(npx driftproof|\/driftproof:)/.test(l.trim()));
  assert.ok(lines.length >= 2, 'the section gives the command');
  for (const line of lines) {
    const words = line.trim().split(/\s+/);
    const flags = words.filter((w) => w.startsWith('--')).map((w) => w.slice(2));
    const takes = words[0] === 'npx' ? cliRun : doorAccepts(words[0].replace('/driftproof:', ''));
    for (const f of flags) assert.ok(takes.includes(f), `${line.trim()}: --${f} is taken`);
  }
  assert.match(section, /placebo/);
  for (const re of [/\bimproves?\b/i, /\bproves?\b/i, /\bworks\b/i]) assert.doesNotMatch(section, re);
});
