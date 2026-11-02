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
