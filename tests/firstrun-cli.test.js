// SPDX-License-Identifier: Apache-2.0
'use strict';

// End-to-end unit tests for spec 138's run changes through bin/driftproof (AC-1, AC-7): the
// progress lines, and the warning when the judge is the target.
//
//   node --test tests/firstrun-cli.test.js
//
// THE MODEL IS SPEC 028'S FAKE `claude` (specs/028-claude-code-plugin/probes/bin/claude), first on
// PATH, reached on the trusted lane, so the progress run makes real calls to a double. Warning assertions also use the fake model surface.
// Stub assertions require no live warning or progress. No credential is in any environment here, and nothing is spent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SAMPLING } = require('../lib/sampling');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const FAKE_BIN = path.join(ROOT, 'specs', '028-claude-code-plugin', 'probes', 'bin');
const MODEL = 'claude-haiku-4-5';
const made = [];
let SPAWNLOG = null;
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec138-cli-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function env(extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^OPENAI_|^DRIFTPROOF_|^SPEC0/.test(k)) continue;
    e[k] = v;
  }
  e.PATH = [FAKE_BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
  if (SPAWNLOG) e.SPEC028_SPAWNLOG = SPAWNLOG;
  return { ...e, ...extra };
}
const cli = (args, cwd, extra) => spawnSync(process.execPath, [BIN, ...args], { cwd, env: env(extra), encoding: 'utf8', timeout: 300000 });

function skill(root, n) {
  const dir = path.join(root, `fx-skill-${n}`);
  fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: fx-skill-${n}\nversion: 1.0.0\n---\n\n# fx-skill-${n}\n\nAnswer in one short sentence.\n`);
  const cases = Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, prompt: `Question ${i + 1}?`, rubric: 'One short sentence scores 0.80.' }));
  fs.writeFileSync(path.join(dir, 'evals', 'evals.json'), JSON.stringify({ cases }, null, 2));
  return dir;
}

// The run the progress and warning tests read: a two-case skill, answered by the fake, no judge set.
let FX = null;
function fixture() {
  if (FX) return FX;
  const root = tmp();
  SPAWNLOG = path.join(root, 'spawns.ndjson');
  const two = skill(root, 2);
  const control = cli(['run', two, '--trusted-skill', '--models', MODEL, '--samples', '2', '--out', path.join(root, 'control')], root);
  assert.equal(control.status, 0, control.stderr.slice(-800));
  FX = { root, control };
  return FX;
}

test('every call was answered by the fake claude, and none carried a key', () => {
  fixture();
  const spawns = fs.readFileSync(SPAWNLOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(spawns.length > 0, 'the fake was reached');
  for (const s of spawns) {
    assert.equal(s.bin, 'claude');
    assert.equal(s.viaFakeBin, true);
    assert.equal(s.had_api_key, false);
  }
});

test('progress: a line per call or judge batch on stderr, the last naming the calls the run reports; none on stdout', () => {
  const { control } = fixture();
  const lines = control.stderr.split('\n').filter((l) => l.includes('progress: call '));
  assert.ok(lines.length > 0);
  assert.doesNotMatch(control.stdout, /progress: call /);
  const last = /progress: call (\d+) of/.exec(lines[lines.length - 1]);
  const reported = /\((\d+) calls\)/.exec(control.stdout);
  assert.equal(Number(last[1]), Number(reported[1]));
  const first = /progress: call 1 of (\d+) to (\d+)/.exec(lines[0]);
  assert.ok(first, lines[0]);
  const perDraw = 1 + 2;
  assert.equal(Number(first[1]), 2 * 2 * SAMPLING.min * perDraw);
  assert.equal(Number(first[2]), 2 * 2 * SAMPLING.max * perDraw);
});

test('the judge is the target: a loud warning on stderr before the first progress line, and none for another judge', () => {
  const { control } = fixture();
  const err = control.stderr;
  const w = err.indexOf('WARNING: the judge is the target model');
  assert.ok(w >= 0, err.slice(0, 400));
  assert.ok(w < err.indexOf('progress: call '));
  const root = tmp();
  const dir = skill(root, 1);
  const other = cli(['run', dir, '--trusted-skill', '--models', MODEL, '--judge-model', 'claude-sonnet-5', '--max-cases', '1', '--samples', '1', '--out', path.join(root, 'o')], root);
  assert.equal(other.status, 0, other.stderr);
  assert.doesNotMatch(other.stderr, /WARNING: the judge/);
  const dated = cli(['run', dir, '--trusted-skill', '--models', MODEL, '--judge-model', 'claude-haiku-4-5-20251001', '--max-cases', '1', '--samples', '1', '--out', path.join(root, 'o2')], root);
  assert.equal(dated.status, 0, dated.stderr);
  assert.match(dated.stderr, /WARNING: the judge is the target model, claude-haiku-4-5\./);
  const stub = cli(['run', dir, '--models', MODEL, '--samples', '1', '--out', path.join(root, 'stub')], root, { DRIFTPROOF_STUB: '1' });
  assert.equal(stub.status, 0, stub.stderr);
  assert.doesNotMatch(stub.stderr, /WARNING: the judge|progress: call|model that wrote each answer/i);
});

// Spec 140 (R-3): a missing isolation account is one plain line, before the skill is read.
test('a run that needs the isolation account refuses in one line when there is none, writing nothing; a stub run and a trusted run never ask', () => {
  const NOUSER = 'driftproof-nouser-140';
  assert.notEqual(spawnSync('id', ['-u', NOUSER]).status, 0, 'the test needs an account id does not know');
  const root = tmp();
  const out = path.join(root, 'o');
  const none = cli(['run', path.join(root, 'no-such-skill'), '--models', MODEL, '--out', out], root, { DRIFTPROOF_EVAL_USER: NOUSER });
  assert.equal(none.status, 2, none.stderr);
  const lines = none.stderr.split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 1, none.stderr);
  assert.match(lines[0], /REFUSED \(isolation\): /);
  assert.ok(lines[0].includes(NOUSER) && lines[0].includes('--trusted-skill'));
  assert.equal(none.stdout, '');
  assert.equal(fs.existsSync(out), false, 'no receipts folder made');
  const dir = skill(root, 1);
  const stub = cli(['run', dir, '--models', MODEL, '--max-cases', '1', '--samples', '1', '--out', path.join(root, 'o2')], root, { DRIFTPROOF_STUB: '1', DRIFTPROOF_EVAL_USER: NOUSER });
  assert.equal(stub.status, 0, stub.stderr);
  assert.doesNotMatch(stub.stderr, /REFUSED \(isolation\)/);
  const trusted = cli(['run', dir, '--trusted-skill', '--models', MODEL, '--max-cases', '1', '--samples', '1', '--out', path.join(root, 'o3')], root, { DRIFTPROOF_EVAL_USER: NOUSER });
  assert.doesNotMatch(trusted.stderr, /REFUSED \(isolation\)/);
});

// Issue 489: CLI timeout regressions also run in the published-tree gate.
{
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 489, A-438-3. Real CLI parsing and run/judge wiring, with complete()
// observed before the offline stub responds. No network, subprocess model or spend.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateReceipt, verifyReceiptHash, sealReceipt } = require('../lib/receipt');
const { QUICK } = require('../lib/firstrun');
const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin/driftproof');
const PRELOAD = path.join(__dirname, 'timeout-seam.js');
const ANTHROPIC = 'claude-haiku-4-5';
const OPENAI = 'gpt-5.6-sol';
const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function timeoutFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue489-'));
  made.push(dir);
  const skill = path.join(dir, 'skill');
  fs.mkdirSync(path.join(skill, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '# Timeout fixture\n\nSay hello briefly.\n');
  fs.writeFileSync(path.join(skill, 'evals/evals.json'), JSON.stringify({
    cases: [1, 2].map((n) => ({ id: 'c' + n, prompt: 'Say hello ' + n + '.', rubric: 'The answer says hello.' })),
  }));
  return { dir, skill, out: path.join(dir, 'receipts'), calls: path.join(dir, 'calls.jsonl') };
}
function timeoutEnv(fx, extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^SPEC489_|^NODE_OPTIONS$/.test(key)) continue;
    env[key] = value;
  }
  return { ...env, DRIFTPROOF_STUB: '1', CLAUDE_PROVIDER: 'cli', OPENAI_SURFACE: 'api', SPEC489_CALLS: fx.calls, ...extra };
}
function timeoutCli(fx, flags = [], extra = {}, subject = fx.skill) {
  const result = spawnSync(process.execPath, ['--require', PRELOAD, BIN, 'run', subject,
    '--models', ANTHROPIC, '--judge-model', OPENAI, '--out', fx.out, ...flags], {
    cwd: fx.dir, env: timeoutEnv(fx, extra), encoding: 'utf8', timeout: 1800000,
  });
  assert.ifError(result.error);
  const calls = fs.existsSync(fx.calls) ? fs.readFileSync(fx.calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const receipts = fs.existsSync(fx.out) ? fs.readdirSync(fx.out).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(fx.out, f), 'utf8'))) : [];
  return { ...result, calls, receipts };
}
function successfulTimeoutRun(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.receipts.length > 0, 'a receipt was emitted');
}
function everyTimeoutCall(calls, expected) {
  assert.ok(calls.some((c) => c.phase === 'generation'), 'observed generations');
  assert.ok(calls.some((c) => c.phase === 'judge'), 'observed judge samples');
  assert.ok(calls.some((c) => c.arm === 'baseline'), 'observed the baseline');
  assert.ok(calls.some((c) => c.arm === 'with_skill'), 'observed the subject arm');
  for (const call of calls) assert.equal(call.timeoutMs, expected, call.phase + ' on ' + call.surface);
}
function recordedTimeout(receipt, ms) {
  assert.equal(receipt.run.timeout_ms, ms, 'the receipt records the explicit per-call setting in milliseconds');
  assert.equal(validateReceipt(receipt).valid, true, 'the new field validates');
  assert.equal(verifyReceiptHash(receipt), true, 'the record is inside the receipt seal');
}
function timeoutCounts(result) {
  for (const receipt of result.receipts) {
    const calls = result.calls.filter((c) => c.model === receipt.run.model_id && c.phase === 'generation');
    assert.equal(calls.length, receipt.results.cases.reduce((n, row) => n + row.generation.draws.length, 0));
  }
  const draws = result.receipts.flatMap((r) => r.results.cases).flatMap((row) => row.generation.draws);
  assert.equal(result.calls.filter((c) => c.phase === 'judge').length, draws.reduce((n, d) => n + d.samples.length, 0));
}
function quickTimeoutShape(receipt) {
  assert.equal(receipt.run.preset, 'quick');
  assert.equal(receipt.verification_level, 'UNVERIFIED');
  assert.equal(receipt.run.judge.samples, QUICK.samples);
  assert.equal(new Set(receipt.results.cases.map((row) => row.id)).size, QUICK.maxCases);
  for (const row of receipt.results.cases) assert.equal(row.generation.draws.length, QUICK.draws);
}

for (const [claude, openai] of [['cli', 'api'], ['api', 'cli'], ['cli', 'cli'], ['api', 'api']]) {
  test('AC-489-1: --timeout reaches every generation and judge on ' + claude + '/' + openai, () => {
    const result = timeoutCli(timeoutFixture(), ['--timeout', '901', '--samples', '2'], {
      CLAUDE_PROVIDER: claude, OPENAI_SURFACE: openai,
    });
    successfulTimeoutRun(result);
    everyTimeoutCall(result.calls, 901000);
    timeoutCounts(result);
    for (const receipt of result.receipts) recordedTimeout(receipt, 901000);
  });
}
test('AC-489-1: every target receives the timeout, including both arms and every sample', () => {
  const result = timeoutCli(timeoutFixture(), ['--models', ANTHROPIC + ',' + OPENAI, '--timeout=902', '--samples', '2']);
  successfulTimeoutRun(result);
  assert.equal(result.receipts.length, 2);
  everyTimeoutCall(result.calls, 902000);
  timeoutCounts(result);
  for (const receipt of result.receipts) recordedTimeout(receipt, 902000);
});
test('AC-489-1: context file subjects and the placebo arm keep the same timeout', () => {
  const fx = timeoutFixture();
  const subject = path.join(fx.dir, 'rules.md');
  fs.writeFileSync(subject, '# Rules\n\nSay hello briefly.\n');
  const result = timeoutCli(fx, ['--timeout', '903', '--samples', '1', '--placebo',
    '--suite', path.join(fx.skill, 'evals/evals.json')], {}, subject);
  successfulTimeoutRun(result);
  everyTimeoutCall(result.calls, 903000);
  const receipt = result.receipts[0];
  assert.equal(receipt.skill.unit, 'context_file');
  assert.ok(receipt.results.cases.some((row) => row.mode === 'placebo'));
  timeoutCounts(result);
  recordedTimeout(receipt, 903000);
});

for (const value of ['0', '-1', '1.5', 'abc', '01', '1e3', '', 'Infinity', '2147479', '2147484', '9999999999999999999999999']) {
  test('AC-489-2: refuses timeout ' + JSON.stringify(value) + ' before any call or receipt', () => {
    const result = timeoutCli(timeoutFixture(), ['--timeout=' + value, '--quick']);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /REFUSED/);
    assert.match(result.stderr, /positive integer|timeout[^\n]*(?:value|range|maximum|2147483)/i);
    assert.doesNotMatch(result.stderr, /unknown flag/i, 'the timeout value itself was checked');
    assert.equal(result.calls.length, 0);
    assert.equal(result.receipts.length, 0);
  });
}
test('AC-489-2: the smallest and largest supported seconds keep their exact value', () => {
  for (const seconds of [1, 2147478]) {
    const result = timeoutCli(timeoutFixture(), ['--quick', '--timeout', String(seconds)]);
    successfulTimeoutRun(result);
    everyTimeoutCall(result.calls, seconds * 1000);
    recordedTimeout(result.receipts[0], seconds * 1000);
  }
});

test('AC-489-2: a missing timeout value is refused before any call', () => {
  const result = timeoutCli(timeoutFixture(), ['--quick', '--timeout']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /timeout[^\n]*(?:value|integer)/i);
  assert.doesNotMatch(result.stderr, /unknown flag/i);
  assert.equal(result.calls.length, 0);
  assert.equal(result.receipts.length, 0);
});
test('AC-489-2 plant: a successful run is rejected by the refusal oracle', () => {
  const result = timeoutCli(timeoutFixture(), ['--quick']);
  successfulTimeoutRun(result);
  assert.throws(() => assert.equal(result.status, 2), assert.AssertionError);
  assert.ok(result.calls.length > 0);
});

test('AC-489-3: the timeout is schema checked and hashed, and cannot be edited without resealing', () => {
  const result = timeoutCli(timeoutFixture(), ['--quick', '--timeout', '904']);
  successfulTimeoutRun(result);
  const receipt = result.receipts[0];
  recordedTimeout(receipt, 904000);
  const edited = structuredClone(receipt);
  edited.run.timeout_ms++;
  assert.equal(verifyReceiptHash(edited), false, 'plant: an altered timeout breaks the seal');
  const omitted = structuredClone(receipt);
  delete omitted.run.timeout_ms;
  assert.throws(() => recordedTimeout(sealReceipt(omitted), 904000), assert.AssertionError, 'plant: omission cannot claim an explicit setting');
  for (const value of [0, -1, 1.5, '904000', null, 2147484000]) {
    const bad = structuredClone(receipt);
    bad.run.timeout_ms = value;
    assert.equal(validateReceipt(sealReceipt(bad)).valid, false, 'plant: malformed recorded timeout ' + JSON.stringify(value));
  }
});

test('AC-489-4: no flag retains each surface default and omits an unrequested setting', () => {
  for (const [claude, openai] of [['cli', 'api'], ['api', 'cli']]) {
    const result = timeoutCli(timeoutFixture(), ['--quick'], { CLAUDE_PROVIDER: claude, OPENAI_SURFACE: openai });
    successfulTimeoutRun(result);
    for (const call of result.calls) {
      const expected = call.surface.endsWith('cli') ? 300000 : 120000;
      assert.equal(call.timeoutMs, expected);
      assert.throws(() => assert.equal({ ...call, timeoutMs: 901000 }.timeoutMs, expected), assert.AssertionError, 'plant: silently extending the default is caught');
    }
    assert.equal(Object.hasOwn(result.receipts[0].run, 'timeout_ms'), false);
    quickTimeoutShape(result.receipts[0]);
    timeoutCounts(result);
  }
});
test('AC-489-5: --quick retains its task, draws, samples and level beside --timeout', () => {
  const result = timeoutCli(timeoutFixture(), ['--quick', '--timeout', '905']);
  successfulTimeoutRun(result);
  quickTimeoutShape(result.receipts[0]);
  everyTimeoutCall(result.calls, 905000);
  timeoutCounts(result);
  const changed = structuredClone(result.receipts[0]);
  changed.verification_level = 'TESTED';
  assert.throws(() => quickTimeoutShape(changed), assert.AssertionError, 'plant: a quick verdict is caught');
});

for (const plant of ['drop-generation', 'drop-judge']) {
  test('AC-489-1 plant: the call oracle catches ' + plant, () => {
    const result = timeoutCli(timeoutFixture(), ['--quick', '--timeout', '906'], { SPEC489_PLANT: plant });
    successfulTimeoutRun(result);
    assert.throws(() => everyTimeoutCall(result.calls, 906000), assert.AssertionError);
  });
}

function exportedTimeoutRun(opts) {
  const fx = timeoutFixture();
  const script = 'const {loadSkill}=require(' + JSON.stringify(path.join(ROOT, 'lib/skill')) + ');' +
    'const {runSkillOnModel}=require(' + JSON.stringify(path.join(ROOT, 'lib/run')) + ');' +
    'runSkillOnModel({skill:loadSkill(' + JSON.stringify(fx.skill) + '),model:' + JSON.stringify(ANTHROPIC) +
    ',opts:' + JSON.stringify({ judgeModel: OPENAI, samples: 2, maxCalls: 500, ...opts }) +
    '}).then(r=>process.stdout.write(JSON.stringify(r.receipt))).catch(e=>{console.error(e);process.exitCode=1;});';
  const result = spawnSync(process.execPath, ['--require', PRELOAD, '-e', script], {
    cwd: fx.dir, env: timeoutEnv(fx), encoding: 'utf8', timeout: 1800000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return { receipt: JSON.parse(result.stdout),
    calls: fs.readFileSync(fx.calls, 'utf8').trim().split('\n').map(JSON.parse) };
}
test('AC-489-6: exported runSkillOnModel records its explicit timeout as the CLI does', () => {
  const { receipt, calls } = exportedTimeoutRun({ timeoutMs: 907000 });
  everyTimeoutCall(calls, 907000);
  recordedTimeout(receipt, 907000);
});
test('AC-489-6: a per-case override cannot be recorded as a uniform timeout', () => {
  const { receipt, calls } = exportedTimeoutRun({ timeoutMs: 907000, caseTimeoutMs: { c1: 1000 } });
  assert.deepEqual([...new Set(calls.map((c) => c.timeoutMs))].sort((a, b) => a - b), [1000, 907000]);
  assert.equal(Object.hasOwn(receipt.run, 'timeout_ms'), false);
  const planted = structuredClone(receipt);
  planted.run.timeout_ms = 907000;
  assert.throws(() => assert.equal(Object.hasOwn(planted.run, 'timeout_ms'), false), assert.AssertionError,
    'plant: a false uniform record is caught');
});

test('AC-489-7: CLI help names seconds and the generation and judge scope', () => {
  const fx = timeoutFixture();
  const result = spawnSync(process.execPath, [BIN, '--help'], {
    cwd: fx.dir, env: timeoutEnv(fx), encoding: 'utf8', timeout: 1800000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--timeout(?:[ =]+)(?:<seconds>|seconds|N)/);
  assert.match(result.stdout, /timeout[^\n]*(?:generation.*judge|judge.*generation)/i);
});

test('AC-489-1: a long API timeout also extends the Anthropic SDK request cap', async () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const saved = Object.fromEntries(['DRIFTPROOF_STUB', 'CLAUDE_PROVIDER', 'ANTHROPIC_API_KEY'].map((key) => [key, process.env[key]]));
  const requests = [];
  class TimeoutApiFixture {
    constructor() {
      this.timeout = 600000;
      this.messages = { create: async (params, options) => {
        requests.push(options);
        return { model: params.model, content: [{ type: 'text', text: 'Hello.' }],
          usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' };
      } };
    }
  }
  Module._load = function (name, ...args) {
    return name === '@anthropic-ai/sdk' ? TimeoutApiFixture : originalLoad.call(this, name, ...args);
  };
  delete process.env.DRIFTPROOF_STUB;
  process.env.CLAUDE_PROVIDER = 'api';
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'fixture' });
  try {
    const { complete } = require('../lib/provider');
    await complete({ model: ANTHROPIC, prompt: 'Say hello.', timeoutMs: 901000 });
    assert.equal(requests[0].timeout, 901000, 'the SDK must not end a longer call at its shorter default');
    assert.equal(requests[0].maxRetries, 0, 'the provider still owns retries');
    await complete({ model: ANTHROPIC, prompt: 'Say hello.' });
    assert.deepEqual(requests[1], { maxRetries: 0 }, 'an absent override keeps the SDK default');
    assert.throws(() => assert.equal({ ...requests[0], timeout: 600000 }.timeout, 901000),
      assert.AssertionError, 'plant: retaining the shorter SDK cap reads RED');
  } finally {
    Module._load = originalLoad;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

}
