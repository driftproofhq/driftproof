// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseYaml } = require('../specs/024-runner-hostile-input-proof/probes/yaml');
const { parseGithubOutput } = require('../specs/024-runner-hostile-input-proof/probes/common');
const { suiteIdentity } = require('../lib/skill');
const ROOT = path.resolve(__dirname, '..');
const MODEL = 'claude-haiku-4-5';
const RULES = '# Rules\nAnswer briefly and name one concrete example.\n';
const SUITE = { cases: [{ id: 'one', prompt: 'Name a fruit.', rubric: 'Names one fruit.' }] };
const read = (f) => fs.readFileSync(f, 'utf8');
const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = fs.mkdtempSync('/var/tmp/action-rules-624-'); made.push(dir);
  for (const sub of ['rt', 'shim', 'skill/evals']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), RULES);
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(SUITE));
  fs.writeFileSync(path.join(dir, 'skill/SKILL.md'), '# Skill\nAnswer briefly.\n');
  fs.writeFileSync(path.join(dir, 'skill/evals/evals.json'), JSON.stringify(SUITE));
  // A shell spy runs before Node. Invalid input must not reach even this file.
  fs.writeFileSync(path.join(dir, 'shim/node'), '#!/usr/bin/env bash\nprintf \'%s\\0\' "$@" >> "$NODE_ARGV"\nprintf \'started\\n\' >> "$NODE_STARTED"\nexec "$REAL_NODE" "$@"\n', { mode: 0o755 });
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^INPUT_|^GITHUB_|^NODE_|^DRIFTPROOF_|^CLAUDE_|^ANTHROPIC_|^OPENAI_/.test(k)) continue;
    env[k] = v;
  }
  Object.assign(env, {
    PATH: path.join(dir, 'shim') + path.delimiter + process.env.PATH,
    DRIFTPROOF_STUB: '1', REAL_NODE: process.execPath,
    NODE_ARGV: path.join(dir, 'argv'), NODE_STARTED: path.join(dir, 'started'),
    GITHUB_ACTION_PATH: ROOT, RUNNER_TEMP: path.join(dir, 'rt'),
    GITHUB_OUTPUT: path.join(dir, 'output'), GITHUB_STEP_SUMMARY: path.join(dir, 'summary'),
    INPUT_SKILL_DIR: 'CLAUDE.md', INPUT_SUITE: 'tasks.json', INPUT_PLACEBO: 'true',
    INPUT_MODELS: MODEL, INPUT_MAX_USD: '20', INPUT_MAX_CALLS: '2000',
    INPUT_FAIL_ON_REGRESSION: 'true', INPUT_FAIL_ON_UNDERPOWERED: 'false'
  });
  return { dir, env };
}
function run(f, overrides = {}) {
  const env = { ...f.env, ...overrides };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return spawnSync('bash', [path.join(ROOT, 'action/run.sh')], { cwd: f.dir, env, encoding: 'utf8', timeout: 1800000 });
}
function argv(f) { return read(f.env.NODE_ARGV).split('\0'); }
function outputs(f) { return Object.fromEntries(parseGithubOutput(read(f.env.GITHUB_OUTPUT)).map(({ key, value }) => [key, value])); }
function receipt(f) {
  const out = outputs(f);
  const files = fs.readdirSync(out.receipts_dir).filter((x) => x.endsWith('.json') && !x.includes('.summary.') && x !== 'badge.json');
  assert.equal(files.length, 1);
  return { out, file: path.join(out.receipts_dir, files[0]), value: JSON.parse(read(path.join(out.receipts_dir, files[0]))) };
}
function refusedBeforeNode(f, overrides, input) {
  const r = run(f, overrides);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, new RegExp('^::error title=Driftproof::' + input + ':', 'm'));
  assert.equal(fs.existsSync(f.env.NODE_STARTED), false, 'Node did not start');
  assert.deepEqual(fs.readdirSync(f.env.RUNNER_TEMP), [], 'no receipt or cwd directory');
}

test('AC-1: declared defaults and both inputs cross only through the run step env', () => {
  const action = parseYaml(read(path.join(ROOT, 'action.yml')));
  for (const [name, fallback] of [['suite', ''], ['placebo', 'false']]) {
    assert.equal(String(action.inputs[name]?.default), fallback);
    assert.equal(String(action.inputs[name]?.required), 'false');
    const run = action.runs.steps.find((s) => s.id === 'run');
    assert.equal(run.env['INPUT_' + name.toUpperCase()], '${{ inputs.' + name + ' }}');
  }
  for (const s of action.runs.steps) if (s.run) assert.equal(s.run.includes('${{'), false);
});

test('AC-1, AC-5: a rules file and placebo reach the real CLI, sealed receipt, decision, badge, summary and enforcement', () => {
  const f = fixture(); const r = run(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const args = argv(f);
  assert.equal(args[2], path.join(f.dir, 'CLAUDE.md'));
  assert.equal(args[args.indexOf('--suite') + 1], path.join(f.dir, 'tasks.json'));
  assert.equal(args.filter((a) => a === '--placebo').length, 1);
  const { out, value: rec } = receipt(f);
  assert.equal(rec.skill.name, 'CLAUDE.md');
  assert.equal(rec.skill.unit, 'context_file');
  assert.equal(rec.skill.content_hash, crypto.createHash('sha256').update(RULES).digest('hex'));
  assert.equal(rec.suite.suite_hash, suiteIdentity(SUITE).suiteHash);
  assert.equal(rec.placebo.bytes, Buffer.byteLength(RULES));
  assert.equal(rec.placebo.skill_bytes, Buffer.byteLength(RULES));
  assert.deepEqual([...new Set(rec.results.cases.map((c) => c.mode))].sort(), ['baseline', 'placebo', 'with_skill']);
  assert.equal(rec.verification_level, 'UNVERIFIED');
  assert.equal(rec.run.surface, 'stub');
  assert.equal(require('../lib/receipt').verifyReceiptHash(rec), true);
  assert.equal(out.verdict, 'NOT_MEASURED');
  assert.equal(out.receipt_count, '1');
  assert.equal(out.missing_models, '');
  assert.match(read(path.join(out.receipts_dir, 'badge.json')), /not measured/i);
  assert.match(read(f.env.GITHUB_STEP_SUMMARY), /not measured/i);
  assert.match(read(f.env.GITHUB_STEP_SUMMARY), /claude-haiku-4-5/);
  const enforce = spawnSync('bash', [path.join(ROOT, 'action/enforce.sh')], { cwd: f.dir,
    env: { ...f.env, DRIFTPROOF_VERDICT: out.verdict, DRIFTPROOF_DELTA: out.delta, DRIFTPROOF_RECEIPTS: out.receipts_dir }, encoding: 'utf8', timeout: 1800000 });
  assert.equal(enforce.status, 0, enforce.stdout + enforce.stderr);
});

for (const [label, overrides, input] of [
  ['placebo yes', { INPUT_PLACEBO: 'yes', INPUT_SKILL_DIR: 'skill' }, 'placebo'],
  ['placebo empty', { INPUT_PLACEBO: '', INPUT_SKILL_DIR: 'skill' }, 'placebo'],
  ['suite control', { INPUT_SUITE: 'tasks\n.json', INPUT_SKILL_DIR: 'skill' }, 'suite'],
  ['suite missing', { INPUT_SUITE: 'missing.json', INPUT_SKILL_DIR: 'skill' }, 'suite'],
  ['suite directory', { INPUT_SUITE: 'skill', INPUT_SKILL_DIR: 'skill' }, 'suite'],
]) test('AC-2 plant: ' + label + ' is refused before Node and mktemp', () => refusedBeforeNode(fixture(), overrides, input));

for (const input of ['suite', 'placebo']) test('AC-2, AC-6: the self-test hostile payload is refused in ' + input, () => {
  const f = fixture();
  const wf = parseYaml(read(path.join(ROOT, '.github/workflows/action-selftest.yml')));
  refusedBeforeNode(f, { INPUT_SKILL_DIR: 'skill', ['INPUT_' + input.toUpperCase()]: wf.jobs.stub.env.HOSTILE }, input);
  assert.equal(fs.readdirSync(f.env.RUNNER_TEMP).some((p) => p.startsWith('driftproof-injection')), false);
});

for (const [name, target] of [['linked.md', 'CLAUDE.md'], ['broken.md', 'missing.md']]) {
  test('AC-3 plant: symlink subject ' + name + ' is refused before Node', () => {
    const f = fixture(); fs.symlinkSync(target, path.join(f.dir, name));
    refusedBeforeNode(f, { INPUT_SKILL_DIR: name }, 'skill-dir');
  });
}
test('AC-3: a directory symlink keeps the CLI directory contract', () => {
  const f = fixture(); fs.symlinkSync('skill', path.join(f.dir, 'linked-dir'));
  const r = run(f, { INPUT_SKILL_DIR: 'linked-dir', INPUT_SUITE: '', INPUT_PLACEBO: 'false' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(receipt(f).value.skill.unit, 'skill');
});

test('AC-3 plant: a non-Markdown file is refused before Node', () => {
  const f = fixture(); fs.writeFileSync(path.join(f.dir, 'rules.txt'), RULES);
  refusedBeforeNode(f, { INPUT_SKILL_DIR: 'rules.txt' }, 'skill-dir');
});

for (const name of ['AGENTS.MD', 'team.MARKDOWN']) test('AC-1, AC-3: absolute paths and case-insensitive extension ' + name, () => {
  const f = fixture(); fs.writeFileSync(path.join(f.dir, name), RULES);
  const suite = path.join(f.dir, 'tasks.json');
  const r = run(f, { INPUT_SKILL_DIR: path.join(f.dir, name), INPUT_SUITE: suite, INPUT_PLACEBO: 'false' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(argv(f)[argv(f).indexOf('--suite') + 1], suite);
  assert.equal(argv(f).includes('--placebo'), false);
  assert.equal(receipt(f).value.placebo, undefined);
});

test('AC-1: shell characters and spaces in a suite path remain one literal argument', () => {
  const f = fixture(); const name = 'tasks " ; $(touch injected) `touch tick`.json';
  fs.writeFileSync(path.join(f.dir, name), JSON.stringify(SUITE));
  const r = run(f, { INPUT_SUITE: name });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(argv(f)[argv(f).indexOf('--suite') + 1], path.join(f.dir, name));
  assert.equal(fs.existsSync(path.join(f.dir, 'injected')), false);
  assert.equal(fs.existsSync(path.join(f.dir, 'tick')), false);
});

for (const value of ['', undefined]) test('AC-1: directory defaults omit suite and placebo, suite=' + String(value), () => {
  const f = fixture(); const r = run(f, { INPUT_SKILL_DIR: 'skill', INPUT_SUITE: value, INPUT_PLACEBO: value === undefined ? undefined : 'false' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(argv(f).includes('--suite'), false);
  assert.equal(argv(f).includes('--placebo'), false);
  assert.equal(receipt(f).value.placebo, undefined);
});

for (const [name, overrides, code] of [
  ['file without suite', { INPUT_SUITE: '' }, 'SUITE_REQUIRED'],
  ['directory with suite', { INPUT_SKILL_DIR: 'skill' }, 'SUITE_WITH_SKILL'],
]) test('AC-4 plant: CLI refuses ' + name + ' with an Action annotation', () => {
  const f = fixture(); const r = run(f, overrides);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, new RegExp(code));
  assert.match(r.stdout + r.stderr, /^::error title=Driftproof::/m);
});

test('AC-5 plants: tampered and unreadable context receipts fail closed and retain model attribution', () => {
  const f = fixture(); assert.equal(run(f).status, 0);
  const { file, value: rec, out } = receipt(f);
  function decide() {
    return spawnSync(process.execPath, [path.join(ROOT, 'bin/driftproof'), 'decide', out.receipts_dir, '--models', MODEL, '--enforce'],
      { cwd: f.dir, env: f.env, encoding: 'utf8', timeout: 1800000 });
  }
  rec.skill.content_hash = '0'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(rec));
  let r = decide(); assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /hash|seal|mismatch/i);
  fs.writeFileSync(file, '{');
  r = decide(); assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /unreadable/i);
  assert.ok((r.stdout + r.stderr).includes(path.basename(file)));
  assert.match(r.stdout + r.stderr, /claude-haiku-4-5/);
});

// Issue 746: real Action bytes, local origin, no model or network calls.
function git(f, ...args) {
  const r = spawnSync('git', args, { cwd: f.dir, encoding: 'utf8', timeout: 1800000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout.trim();
}
function comparisonFixture({ name = 'CLAUDE.md', same = false, missing = false, kind = 'file' } = {}) {
  const f = fixture();
  git(f, 'init', '--initial-branch=base');
  if (name !== 'CLAUDE.md') fs.renameSync(path.join(f.dir, 'CLAUDE.md'), path.join(f.dir, name));
  fs.writeFileSync(path.join(f.dir, name), same ? RULES : '# Old rules\nAnswer in detail.\n');
  if (kind !== 'file') {
    fs.rmSync(path.join(f.dir, name));
    if (kind === 'directory') {
      fs.mkdirSync(path.join(f.dir, name));
      fs.writeFileSync(path.join(f.dir, name, 'child.md'), '# Old rules\n');
    } else fs.symlinkSync('missing.md', path.join(f.dir, name));
  }
  git(f, 'add', '--', 'tasks.json');
  if (!missing) git(f, 'add', '--', name);
  git(f, '-c', 'user.name=Fixture', '-c', 'user.email=', 'commit', '-m', 'base fixture');
  git(f, 'remote', 'add', 'origin', f.dir);
  fs.rmSync(path.join(f.dir, name), { recursive: true, force: true });
  fs.writeFileSync(path.join(f.dir, name), RULES);
  const realGit = process.env.PATH.split(path.delimiter).map((p) => path.join(p, 'git')).find((p) => fs.existsSync(p));
  fs.writeFileSync(path.join(f.dir, 'shim/git'), '#!/usr/bin/env bash\nprintf \'%s\\0\' "$@" >> "$GIT_ARGV"\nexec "$REAL_GIT" "$@"\n', { mode: 0o755 });
  Object.assign(f.env, { INPUT_SKILL_DIR: name, INPUT_COMPARE_WITH_BASE: 'true',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'base', REAL_GIT: realGit, GIT_ARGV: path.join(f.dir, 'git-argv') });
  return f;
}
function compareReceipts(f) {
  const out = outputs(f);
  const collect = (dir) => fs.readdirSync(dir).filter((n) => /^compare-[AB]-.*\.json$/.test(n))
    .map((n) => ({ file: path.join(dir, n), value: JSON.parse(read(path.join(dir, n))) }));
  return { out, a: collect(path.join(out.receipts_dir, 'base')), b: collect(out.receipts_dir),
    report: read(path.join(out.receipts_dir, 'compare.md')) };
}
function enforceComparison(f, out) {
  return spawnSync('bash', [path.join(ROOT, 'action/enforce.sh')], { cwd: f.dir,
    env: { ...f.env, DRIFTPROOF_VERDICT: out.verdict, DRIFTPROOF_DELTA: out.delta, DRIFTPROOF_RECEIPTS: out.receipts_dir },
    encoding: 'utf8', timeout: 1800000 });
}
function postComparison(f, out, existing = false) {
  const event = path.join(f.dir, 'event.json'), posted = path.join(f.dir, 'posted.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 1 } }));
  fs.rmSync(posted, { force: true });
  const key = crypto.createHash('sha256').update(f.env.INPUT_SKILL_DIR).digest('hex').slice(0, 16);
  const marker = require('../lib/plain').markerLine(key);
  const code = 'global.fetch = async (url, opts) => { if (opts.method === "GET") return {ok:true,status:200,json:async()=> ' +
    JSON.stringify(existing ? [{ id: 12, body: marker + '\nold', user: { type: 'User' } }, { id: 13, body: marker + '\nold', user: { type: 'Bot' } }] : []) +
    '}; require("fs").writeFileSync(process.env.POSTED, JSON.stringify({url,method:opts.method,...JSON.parse(opts.body)})); return {ok:true,status:201,json:async()=>({id:13})}; }; require(process.env.COMMENT);';
  const r = spawnSync(process.execPath, ['-e', code], { cwd: f.dir, encoding: 'utf8', timeout: 1800000,
    env: { ...f.env, GITHUB_TOKEN: 'fixture', GITHUB_REPOSITORY: 'example/rules', GITHUB_EVENT_PATH: event,
      DRIFTPROOF_RECEIPTS: out.receipts_dir, COMMENT: path.join(ROOT, 'action/comment.js'), POSTED: posted } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { ...r, posted: fs.existsSync(posted) ? JSON.parse(read(posted)) : null, marker };
}

test('746 AC-2: compare defaults false, maps through env, and output is declared', () => {
  const a = parseYaml(read(path.join(ROOT, 'action.yml')));
  const expression = (s) => '$' + '{{ ' + s + ' }}';
  assert.equal(String(a.inputs['compare-with-base']?.default), 'false');
  assert.equal(a.runs.steps.find((s) => s.id === 'run').env.INPUT_COMPARE_WITH_BASE, expression('inputs.compare-with-base'));
  assert.equal(a.outputs.compare_reading.value, expression('steps.run.outputs.compare_reading'));
  for (const s of a.runs.steps) if (s.run) assert.equal(s.run.includes('$' + '{{'), false);
});
for (const bad of ['', 'yes', '$(touch injected)']) test('746 AC-2 plant: boolean ' + JSON.stringify(bad), () => {
  refusedBeforeNode(fixture(), { INPUT_COMPARE_WITH_BASE: bad }, 'compare-with-base');
});
for (const ref of ['a..b', '-base', 'base;touch injected', 'base\nnext', 'a/.hidden', 'a.lock', 'a//b']) {
  test('746 AC-2 plant: base ref ' + JSON.stringify(ref), () => {
    const f = comparisonFixture();
    refusedBeforeNode(f, { GITHUB_BASE_REF: ref }, 'base-ref');
    if (/\.\.|^-|;|\n/.test(ref)) assert.equal(fs.existsSync(f.env.GIT_ARGV), false);
  });
}
for (const [label, options, overrides] of [
  ['base directory', { kind: 'directory' }, {}], ['base symlink', { kind: 'symlink' }, {}],
  ['missing base', { missing: true }, {}], ['identical bytes', { same: true }, {}],
  ['not a PR', {}, { GITHUB_EVENT_NAME: 'workflow_dispatch' }],
  ['fetch unavailable', {}, { GITHUB_BASE_REF: 'missing-branch' }],
]) test('746 AC-4 plant: ' + label + ' notices and runs only the new file', () => {
  const f = comparisonFixture(options), r = run(f, overrides);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((r.stdout.match(/^::notice/gm) || []).length, 1);
  const { out, value } = receipt(f);
  assert.equal(out.compare_reading, '');
  assert.equal(value.skill.content_hash, crypto.createHash('sha256').update(RULES).digest('hex'));
  assert.equal(argv(f).includes('compare'), false);
});

test('746 AC-1, AC-3, AC-5, AC-7: literal paths, isolated rc, shared settings and B-only decisions', () => {
  const name = 'rules " ; $(touch injected) ' + String.fromCharCode(96) + 'touch tick' + String.fromCharCode(96) + '.md';
  const f = comparisonFixture({ name });
  fs.writeFileSync(path.join(f.dir, '.driftproofrc'), '{not valid json');
  f.env.INPUT_MODELS = MODEL + ',claude-sonnet-5';
  const r = run(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const { out, a, b, report } = compareReceipts(f);
  assert.equal(a.length, 2); assert.equal(b.length, 2);
  assert.equal(argv(f)[1], 'compare');
  assert.equal(argv(f)[3], path.join(f.dir, name));
  assert.ok(read(f.env.GIT_ARGV).split('\0').includes('refs/driftproof/base:' + name));
  assert.equal(fs.existsSync(path.join(f.dir, 'injected')), false);
  assert.equal(fs.existsSync(path.join(f.dir, 'tick')), false);
  for (const { value } of [...a, ...b]) {
    assert.equal(require('../lib/receipt').verifyReceiptHash(value), true);
    assert.equal(value.suite.suite_hash, suiteIdentity(SUITE).suiteHash);
    assert.equal(value.run.surface, 'stub');
    assert.deepEqual([...new Set(value.results.cases.map((c) => c.mode))].sort(), ['baseline', 'placebo', 'with_skill']);
  }
  for (const { value } of b) assert.equal(value.skill.content_hash, crypto.createHash('sha256').update(RULES).digest('hex'));
  assert.notEqual(a[0].value.skill.content_hash, b[0].value.skill.content_hash);
  assert.equal(out.receipt_count, '2'); assert.equal(out.verdict, 'NOT_MEASURED');
  assert.equal(out.compare_reading, Array(2).fill('Not measured: the receipts do not support a revision verdict.').join(' '));
  assert.match(report, /sequential/);
  assert.equal(enforceComparison(f, out).status, 0);
  fs.writeFileSync(a[0].file, '{');
  assert.equal(enforceComparison(f, out).status, 0, 'base cannot decide enforcement');
  fs.writeFileSync(b[0].file, '{');
  assert.notEqual(enforceComparison(f, out).status, 0, 'new receipt still decides enforcement');
});

test('746 AC-6 plants: verbatim escaped report, lengths, hashes, caveat and stub limits before B reading', () => {
  const f = comparisonFixture({ name: 'rules <tag> & [click](https:example).md' });
  const hostile = 'task <b> & [link](https://example.test) @person #123 ' + String.fromCharCode(96);
  fs.writeFileSync(path.join(f.dir, 'tasks.json'), JSON.stringify({ cases: [{ ...SUITE.cases[0], id: hostile }] }));
  const r = run(f); assert.equal(r.status, 0, r.stdout + r.stderr);
  const { out, a, b, report } = compareReceipts(f);
  const p = postComparison(f, out, true);
  assert.equal(p.posted.method, 'PATCH'); assert.match(p.posted.url, /comments\/13$/);
  const body = p.posted.body;
  assert.ok(body.startsWith(p.marker + '\n'));
  const exact = (s) => assert.ok(s.includes(report), 'the full comparison stays verbatim');
  exact(body);
  assert.ok(body.indexOf(report) < body.indexOf('**Driftproof:'));
  assert.match(body, /measure nothing/);
  for (const { value } of [a[0], b[0]]) assert.ok(body.includes(value.skill.content_hash.slice(0, 8)));
  assert.ok(body.includes(require('../lib/names').mdText(hostile)));
  const lengthLine = report.split('\n').find((l) => / bytes;/.test(l));
  const taskLine = report.split('\n').find((l) => l.startsWith('- '));
  const caveat = report.split('\n').find((l) => /two runs were sequential/.test(l));
  for (const line of [lengthLine, taskLine, caveat]) {
    assert.ok(line); assert.throws(() => exact(body.replace(line, 'removed')));
  }
  fs.writeFileSync(a[0].file, JSON.stringify({ ...a[0].value, receipt_hash: '0'.repeat(64) }));
  const denied = postComparison(f, out);
  assert.equal(denied.posted, null); assert.match(denied.stdout, /::notice/);
});

// Issue 762 (A-746-3, EXT-4): a real remote and a real checkout, so depth and remote-tracking refs mean what they do in a job.
const OLD_BASE = '# Old rules\nAnswer in detail.\n';
const NEW_BASE = '# Moved rules\nAnswer with one list.\n';
function gitIn(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=', ...args], { cwd, encoding: 'utf8', timeout: 1800000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout.trim();
}
// A remote whose base has `commits` commits, and a checkout of it at `depth` (0 is full history), on a pull request branch.
function checkoutFixture({ depth = 0, commits = 2, moves = true } = {}) {
  const f = fixture();
  const origin = fs.mkdtempSync('/var/tmp/action-rules-762-origin-'); made.push(origin);
  gitIn(origin, 'init', '--initial-branch=base');
  fs.writeFileSync(path.join(origin, 'tasks.json'), JSON.stringify(SUITE));
  for (let i = 0; i < commits; i++) {
    fs.writeFileSync(path.join(origin, 'CLAUDE.md'), OLD_BASE + 'Revision ' + i + '.\n');
    gitIn(origin, 'add', '--', 'CLAUDE.md', 'tasks.json');
    gitIn(origin, 'commit', '-m', 'base ' + i);
  }
  for (const name of ['CLAUDE.md', 'tasks.json']) fs.rmSync(path.join(f.dir, name));
  gitIn(f.dir, 'init', '--initial-branch=start');
  gitIn(f.dir, 'remote', 'add', 'origin', 'file://' + origin);
  gitIn(f.dir, 'fetch', ...(depth ? ['--depth=' + depth] : []), 'origin', '+refs/heads/base:refs/remotes/origin/base');
  gitIn(f.dir, 'checkout', '-q', '-b', 'pr', 'origin/base');
  fs.writeFileSync(path.join(f.dir, 'CLAUDE.md'), RULES);
  if (moves) {
    fs.writeFileSync(path.join(origin, 'CLAUDE.md'), NEW_BASE);
    gitIn(origin, 'add', '--', 'CLAUDE.md');
    gitIn(origin, 'commit', '-m', 'base moved on');
  }
  Object.assign(f.env, { INPUT_COMPARE_WITH_BASE: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'base' });
  return f;
}
// What a later step in the job can read from the checkout.
function checkoutState(f) {
  const shallowFile = path.join(f.dir, '.git/shallow'), fetchHead = path.join(f.dir, '.git/FETCH_HEAD');
  return {
    isShallow: gitIn(f.dir, 'rev-parse', '--is-shallow-repository'),
    shallow: fs.existsSync(shallowFile) ? read(shallowFile) : null,
    originBase: gitIn(f.dir, 'rev-parse', 'refs/remotes/origin/base'),
    head: gitIn(f.dir, 'rev-parse', 'HEAD'),
    reachable: gitIn(f.dir, 'rev-list', '--count', 'HEAD'),
    fetchHead: fs.existsSync(fetchHead) ? read(fetchHead) : null,
    privateRefs: gitIn(f.dir, 'for-each-ref', 'refs/driftproof/'),
  };
}

test('762 AC-8, AC-9, AC-11: a full-history checkout stays full, origin/<base> stays put and nothing is left behind', () => {
  const f = checkoutFixture(), before = checkoutState(f);
  assert.equal(before.isShallow, 'false');
  const r = run(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(argv(f)[1], 'compare', 'the comparison ran');
  assert.deepEqual(checkoutState(f), before);
  assert.equal(fs.existsSync(path.join(f.dir, '.git/shallow')), false);
  assert.equal(gitIn(f.dir, 'log', '--format=%s', 'refs/remotes/origin/base..HEAD'), '', 'a later log of the base range is what it was');
});
test('762 AC-10: the comparison reads the tip the remote holds, not the checkout\'s old remote-tracking ref', () => {
  const f = checkoutFixture(); const r = run(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const { a } = compareReceipts(f);
  assert.equal(a[0].value.skill.content_hash, crypto.createHash('sha256').update(NEW_BASE).digest('hex'));
  assert.notEqual(read(path.join(f.dir, 'CLAUDE.md')), NEW_BASE);
});
for (const [label, options] of [['a depth-1 checkout', { depth: 1 }], ['a depth-3 checkout holding the base tip', { depth: 3, commits: 5, moves: false }]]) {
  test('762 AC-12 plant: ' + label + ' keeps its boundary', () => {
    const f = checkoutFixture(options), before = checkoutState(f);
    assert.equal(before.isShallow, 'true');
    const r = run(f);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(argv(f)[1], 'compare', 'the comparison ran');
    assert.deepEqual(checkoutState(f), before);
  });
}
test('762 AC-13: the checkout is put back before the long run starts, so a job cancelled during it leaves nothing behind', () => {
  const f = checkoutFixture({ depth: 3, commits: 5, moves: false }), before = checkoutState(f), snap = path.join(f.dir, 'at-cli-start');
  // The shim reads what a later step would see at the moment the CLI starts.
  fs.writeFileSync(path.join(f.dir, 'shim/node'), '#!/usr/bin/env bash\nif [ "$2" = compare ]; then git -C "$CHECKOUT" for-each-ref refs/driftproof/ > "$SNAP.refs"; cp "$CHECKOUT/.git/shallow" "$SNAP.shallow"; fi\nprintf \'%s\\0\' "$@" >> "$NODE_ARGV"\nexec "$REAL_NODE" "$@"\n', { mode: 0o755 });
  const r = run(f, { CHECKOUT: f.dir, SNAP: snap });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(argv(f)[1], 'compare', 'the comparison ran');
  assert.equal(read(snap + '.refs'), '', 'no private ref while the CLI runs');
  assert.equal(read(snap + '.shallow'), before.shallow, 'the shallow boundary is back while the CLI runs');
  assert.deepEqual(checkoutState(f), before);
});
test('762 AC-11 plant: a base branch the remote does not have leaves no ref and moves nothing', () => {
  const f = checkoutFixture(), before = checkoutState(f);
  const r = run(f, { GITHUB_BASE_REF: 'missing-branch' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(argv(f).includes('compare'), false);
  assert.equal((r.stdout.match(/^::notice/gm) || []).length, 1);
  assert.deepEqual(checkoutState(f), before);
});
