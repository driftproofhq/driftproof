// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 146: `driftproof stale` reads the receipt's recorded capture mode as an axis
// (AC-1 to AC-6). The subjects are lib/stale.js staleReport and renderText, bin/driftproof's `stale`
// command, spec/stale.v1.schema.json, and stale/run.mjs, the stale Action's script.
//
//   node --test tests/stale-capture.test.js
//
// THE MODEL DOUBLE is the one tests/answer-capture-run.test.js uses: child_process.spawn replaced on
// the module object lib/provider.js calls it through, so a receipt is made by the runner itself
// (runSkillOnModel, trusted, one capture mode or the other) and nothing is spawned. spawnSync is
// replaced too, before lib/run.js and lib/stale.js load, so the harness version the runner records
// is the one the test sets and `stale` spawns nothing. The two commands under test, bin/driftproof
// and stale/run.mjs, run as child processes through the real spawnSync, taken before the double is
// installed, with an environment that holds no credential and no stub switch.
//
// Every test name starts with the criterion it checks; spec 146's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const realSpawnSync = cp.spawnSync;
const JUDGE = /Return ONLY this JSON object/;
const cliJson = (result) => JSON.stringify({ type: 'result', result, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
cp.spawn = (file, args, options) => {
  const call = { file, args: [...args], cwd: (options && options.cwd) || null, input: '' };
  const c = new EventEmitter();
  c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => true;
  c.stdin = {
    write(d) { call.input += d; },
    on() {},
    end() {
      setImmediate(() => {
        const out = JUDGE.test(call.input) ? cliJson(JSON.stringify({ score: 0.8, pass: true, reason: 'double' })) : cliJson('ok');
        c.stdout.end(out); c.stderr.end();
        setImmediate(() => c.emit('close', 0, null));
      });
    },
  };
  return c;
};
const HARNESS = '2.1.285';
cp.spawnSync = (file, args) => {
  const all = [file, ...args];
  const bin = all[all.lastIndexOf('--version') - 1];
  return { status: 0, stdout: bin === 'claude' ? `${HARNESS} (Claude Code)\n` : '', stderr: '' };
};

delete process.env.DRIFTPROOF_STUB;
delete process.env.DRIFTPROOF_EVAL_USER;
process.env.CLAUDE_PROVIDER = 'cli';
const { runSkillOnModel } = require('../lib/run');
const { loadSkill } = require('../lib/skill');
const { sealReceipt } = require('../lib/receipt');
const { staleReport, renderText } = require('../lib/stale');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const RUN = path.join(ROOT, 'stale', 'run.mjs');
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'spec146-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* gone */ } });
let n = 0;
const scratch = (tag) => { const d = path.join(TMP, `${tag}-${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };

// ── what the tests read ──────────────────────────────────────────────────────────────────────────
// A small skill with a suite, written under TMP so `stale --skill` hashes the bytes the run was given.
const SKILL = scratch('skill');
fs.mkdirSync(path.join(SKILL, 'evals'));
fs.writeFileSync(path.join(SKILL, 'SKILL.md'), '---\nname: capture-fixture\nversion: 0.0.1\n---\n# capture-fixture\n\nAnswer in one short sentence.\n');
const SUITE = {
  skill_name: 'capture-fixture',
  evals: [{ id: 'greet', prompt: 'Say hello to a new colleague.', expected_output: 'One short friendly sentence.', rubric: 'Score 1 if the answer is one short friendly sentence, else 0.' }],
};
fs.writeFileSync(path.join(SKILL, 'evals', 'evals.json'), JSON.stringify(SUITE));

const AXES = ['model', 'harness', 'capture', 'skill', 'suite', 'judge_model', 'judge_template', 'rubric'];
const axisOf = (x, a) => x.axes.find((e) => e.axis === a);
const armsOf = (x) => `${x.arms.with_skill.decision}/${x.arms.baseline.decision}`;

// A receipt the runner wrote in `mode`, or with the record of it taken out and the receipt re-sealed
// (a receipt before v0.10, or one an importer made).
const made = {};
async function receiptFile(mode, { unrecorded = false } = {}) {
  const key = `${mode}:${unrecorded}`;
  if (!made[key]) {
    const { receipt } = await runSkillOnModel({ skill: loadSkill(SKILL), model: 'haiku', opts: { samples: 2, trusted: true, capture: mode } });
    assert.deepEqual(receipt.run.capture, { mode });
    if (unrecorded) { delete receipt.run.capture; sealReceipt(receipt); }
    made[key] = receipt;
  }
  const f = path.join(scratch('receipt'), 'receipt.json');
  fs.writeFileSync(f, JSON.stringify(made[key]));
  return f;
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// What every other axis asks for: the run's own skill, model, judge and harness version.
async function opts(file, extra = {}) {
  const r = readJson(file);
  return { skill: SKILL, model: r.run.model_id, judge: r.run.judge.model_id, harnessVersion: HARNESS, ...extra };
}
async function read(file, extra) {
  const doc = staleReport([file], await opts(file, extra));
  assert.equal(doc.receipts.length, 1);
  assert.ok(!doc.receipts[0].error, doc.receipts[0].error);
  return { doc, x: doc.receipts[0] };
}

// The CLI and the Action, as child processes. No stub switch, no credential.
const cleanEnv = (extra = {}) => ({ PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: TMP, HOME: TMP, ...extra });
function cli(args, { cwd = TMP, env = {} } = {}) {
  const r = realSpawnSync(process.execPath, [BIN, 'stale', ...args], { cwd, env: cleanEnv(env), encoding: 'utf8' });
  let doc = null; try { doc = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, doc };
}
async function cliArgs(file, extra = []) {
  const o = await opts(file);
  return [file, '--skill', o.skill, '--model', o.model, '--judge', o.judge, '--harness-version', HARNESS, ...extra];
}

// The Base's copy of a file: the tree the probe names in SPEC146_BASE_ROOT, else the commit the spec's
// Base line records, read by git. A test that cannot find either fails; it is never skipped.
function baseFile(rel) {
  if (process.env.SPEC146_BASE_ROOT) return fs.readFileSync(path.join(process.env.SPEC146_BASE_ROOT, rel), 'utf8');
  const spec = fs.readFileSync(path.join(ROOT, 'specs', '146-stale-capture-axis', 'spec.md'), 'utf8');
  const sha = /\*\*Base:\*\*\s*`[^`]+` at `([0-9a-f]{40})`/.exec(spec)[1];
  const r = realSpawnSync('git', ['-C', ROOT, 'show', `${sha}:${rel}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `git show ${sha.slice(0, 8)}:${rel}`);
  return r.stdout;
}

// ── AC-1: a recorded mode that is not the mode today is stale on capture ─────────────────────────────

test('AC-1 a receipt read in the other mode is stale on capture: rerun both arms, every other axis current', async () => {
  for (const [recorded, today] of [['files', 'text'], ['text', 'files']]) {
    const file = await receiptFile(recorded);
    const { x } = await read(file, { capture: today });
    assert.deepEqual(x.axes.map((e) => e.axis), AXES, 'the capture axis sits after the harness');
    const a = axisOf(x, 'capture');
    assert.equal(a.recorded, recorded);
    assert.equal(a.current, today);
    assert.equal(a.effect, 'rerun');
    assert.deepEqual(a.arms, ['with_skill', 'baseline']);
    assert.match(a.reason, /the capture mode differs/);
    assert.equal(x.status, 'stale');
    assert.equal(armsOf(x), 'rerun/rerun');
    for (const e of x.axes.filter((y) => y.axis !== 'capture')) assert.equal(e.effect, 'current', `${recorded} to ${today}: ${e.axis} ${e.effect}`);
  }
});

test('AC-1 a receipt read in the mode it recorded is current on capture and the axis adds nothing', async () => {
  for (const mode of ['text', 'files']) {
    const file = await receiptFile(mode);
    const { x } = await read(file, { capture: mode });
    const a = axisOf(x, 'capture');
    assert.equal(a.recorded, mode);
    assert.equal(a.current, mode);
    assert.equal(a.effect, 'current');
    assert.equal(x.status, 'current');
    assert.equal(armsOf(x), 'reuse/reuse');
    assert.deepEqual(x.axes.filter((e) => e.effect !== 'current'), []);
    assert.equal(x.next, null);
  }
});

test('AC-1 the capture axis alone makes a receipt stale, and a moved mode outranks an unknown axis', async () => {
  const file = await receiptFile('files');
  const { x } = await read(file, { capture: 'text', judge: null, rc: {} });
  assert.equal(axisOf(x, 'judge_model').effect, 'unknown');
  assert.equal(axisOf(x, 'capture').effect, 'rerun');
  assert.equal(x.status, 'stale');
});

// ── AC-2: a receipt that records no mode cannot be told ─────────────────────────────────────────────

test('AC-2 a receipt that records no capture mode reads unknown on capture in either mode, never current', async () => {
  const file = await receiptFile('text', { unrecorded: true });
  assert.equal(readJson(file).run.capture, undefined);
  for (const capture of ['text', 'files', undefined]) {
    const { x } = await read(file, { capture });
    const a = axisOf(x, 'capture');
    assert.equal(a.recorded, null);
    assert.equal(a.current, capture || 'text');
    assert.equal(a.effect, 'unknown');
    assert.match(a.reason, /the receipt records no capture mode/);
    assert.match(a.reason, /the mode today is text unless --capture or capture in the working directory's \.driftproofrc says otherwise/);
    assert.equal(x.status, 'unknown', String(capture));
    assert.equal(armsOf(x), 'unknown/unknown');
    for (const e of x.axes.filter((y) => y.axis !== 'capture')) assert.equal(e.effect, 'current', `${e.axis} ${e.effect}`);
  }
});

test('AC-2 an unrecorded mode leaves stale what another axis made stale, and --strict turns the exit 3 into 1', async () => {
  const file = await receiptFile('text', { unrecorded: true });
  const moved = await read(file, { harnessVersion: '2.2.0' });
  assert.equal(axisOf(moved.x, 'harness').effect, 'rerun');
  assert.equal(axisOf(moved.x, 'capture').effect, 'unknown');
  assert.equal(moved.x.status, 'stale');
  const args = await cliArgs(file, ['--json']);
  const plain = cli(args);
  const strict = cli([...args, '--strict']);
  assert.equal(plain.doc.receipts[0].status, 'unknown');
  assert.equal(plain.code, 3);
  assert.equal(strict.code, 1);
});

// ── AC-3: today's mode is the flag, then the working directory's rc, then text ──────────────────────

test('AC-3 the flag wins over the rc, the rc over the default, and the default is text', async () => {
  const files = await receiptFile('files');
  const text = await receiptFile('text');
  const today = async (file, extra) => axisOf((await read(file, extra)).x, 'capture');
  // The flag, against an rc that says the other.
  let a = await today(files, { capture: 'files', rc: { capture: 'text' } });
  assert.deepEqual([a.current, a.effect], ['files', 'current']);
  a = await today(text, { capture: 'text', rc: { capture: 'files' } });
  assert.deepEqual([a.current, a.effect], ['text', 'current']);
  // The rc alone.
  a = await today(files, { rc: { capture: 'files' } });
  assert.deepEqual([a.current, a.effect], ['files', 'current']);
  a = await today(files, { rc: { capture: 'text' } });
  assert.deepEqual([a.current, a.effect], ['text', 'rerun']);
  // Neither: text, which is what `run` would do.
  a = await today(text, {});
  assert.deepEqual([a.current, a.effect], ['text', 'current']);
  a = await today(files, { rc: {} });
  assert.deepEqual([a.current, a.effect], ['text', 'rerun']);
});

test('AC-3 through the command: a working directory rc asks for the mode, and a skill directory rc does not', async () => {
  const file = await receiptFile('files');
  const args = await cliArgs(file, ['--json']);
  const capture = (r) => axisOf(r.doc.receipts[0], 'capture');
  // The working directory's rc.
  const withRc = scratch('cwd'); fs.writeFileSync(path.join(withRc, '.driftproofrc'), JSON.stringify({ capture: 'files' }));
  assert.deepEqual([capture(cli(args, { cwd: withRc })).current, capture(cli(args, { cwd: withRc })).effect], ['files', 'current']);
  // None: text, and the receipt is stale on it.
  const bare = scratch('cwd');
  assert.deepEqual([capture(cli(args, { cwd: bare })).current, capture(cli(args, { cwd: bare })).effect], ['text', 'rerun']);
  // A skill directory's rc, with nothing in the working directory: dropped, as `run` drops it.
  const skill2 = scratch('skill'); fs.cpSync(SKILL, skill2, { recursive: true });
  fs.writeFileSync(path.join(skill2, '.driftproofrc'), JSON.stringify({ capture: 'files' }));
  const viaSkillRc = cli(args.map((x) => (x === SKILL ? skill2 : x)), { cwd: bare });
  assert.deepEqual([capture(viaSkillRc).current, capture(viaSkillRc).effect], ['text', 'rerun']);
  assert.match(viaSkillRc.stderr, /capture; ignored/);
});

test('AC-3 the suite carries no mode: a suite file that names one is read for none', async () => {
  const file = await receiptFile('text');
  const suite = path.join(scratch('suite'), 'evals.json');
  fs.writeFileSync(suite, JSON.stringify({ ...SUITE, capture: 'files', evals: SUITE.evals.map((e) => ({ ...e, capture: 'files' })) }));
  const { x } = await read(file, { suite });
  const a = axisOf(x, 'capture');
  assert.deepEqual([a.recorded, a.current, a.effect], ['text', 'text', 'current']);
});

// ── AC-4: a bad mode exits 2 before anything is read ────────────────────────────────────────────────

test('AC-4 --capture with no value, or a value that is not text or files, exits 2 and prints no report', async () => {
  const file = await receiptFile('text');
  const args = await cliArgs(file);
  const bare = cli([...args, '--capture']);
  assert.equal(bare.code, 2);
  assert.match(bare.stderr, /--capture needs a value/);
  assert.equal(bare.stdout, '');
  const bad = cli([...args, '--capture', 'both']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--capture "both": expected text or files/);
  assert.equal(bad.stdout, '');
  const ok = cli([...args, '--capture', 'files']);
  assert.notEqual(ok.code, 2);
  assert.match(ok.stdout, /capture\s+text to files/);
});

test('AC-4 a capture in the working directory\'s .driftproofrc that is not text or files exits 2, naming the value', async () => {
  const file = await receiptFile('text');
  const cwd = scratch('cwd'); fs.writeFileSync(path.join(cwd, '.driftproofrc'), JSON.stringify({ capture: 'both' }));
  const r = cli(await cliArgs(file), { cwd });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /capture in \.driftproofrc "both": expected text or files/);
  assert.equal(r.stdout, '');
  // The library refuses the same, per receipt, if a caller hands it one.
  const doc = staleReport([file], await opts(file, { capture: 'both' }));
  assert.equal(doc.summary.errors, 1);
  assert.equal(doc.exit_code, 2);
});

test('AC-4 (A-146-2) --capture is read before the rc, so a good flag beside a bad rc capture is not refused, as for run', async () => {
  const file = await receiptFile('text');
  const cwd = scratch('cwd'); fs.writeFileSync(path.join(cwd, '.driftproofrc'), JSON.stringify({ capture: 'both' }));
  const r = cli([...(await cliArgs(file, ['--json'])), '--capture', 'text'], { cwd });
  assert.notEqual(r.code, 2);
  assert.equal(r.stderr.includes('expected text or files'), false);
  assert.deepEqual([axisOf(r.doc.receipts[0], 'capture').current, axisOf(r.doc.receipts[0], 'capture').effect], ['text', 'current']);
});

// ── AC-5: the document and the text carry the axis, additively ──────────────────────────────────────

const Ajv = require('ajv/dist/2020');
const validator = () => new Ajv({ allErrors: true, strict: false }).compile(readJson(path.join(ROOT, 'spec', 'stale.v1.schema.json')));

test('AC-5 the --json document carries the capture axis and validates against the committed schema', async () => {
  const validate = validator();
  const moved = await receiptFile('files');
  const unrecorded = await receiptFile('text', { unrecorded: true });
  const current = await receiptFile('text');
  for (const [file, extra, want] of [[moved, ['--capture', 'text'], 'rerun'], [unrecorded, [], 'unknown'], [current, ['--capture', 'text'], 'current']]) {
    const r = cli(await cliArgs(file, [...extra, '--json']));
    assert.ok(r.doc, r.stderr);
    assert.ok(validate(r.doc), JSON.stringify(validate.errors && validate.errors.slice(0, 2)));
    const a = axisOf(r.doc.receipts[0], 'capture');
    assert.equal(a.effect, want);
    for (const k of ['axis', 'recorded', 'current', 'effect', 'arms', 'reason']) assert.ok(k in a, k);
  }
});

test('AC-5 the served schema is the committed one byte for byte, and differs from the Base\'s by the enum value and the description', () => {
  const served = path.join(ROOT, 'docs', 'spec', 'stale.v1.schema.json');
  assert.equal(fs.readFileSync(served, 'utf8'), fs.readFileSync(path.join(ROOT, 'spec', 'stale.v1.schema.json'), 'utf8'));
  const now = readJson(path.join(ROOT, 'spec', 'stale.v1.schema.json'));
  const base = JSON.parse(baseFile('spec/stale.v1.schema.json'));
  const axisEnum = (s) => s.properties.receipts.items.oneOf[0].properties.axes.items.properties.axis.enum;
  assert.deepEqual(axisEnum(now).filter((a) => !axisEnum(base).includes(a)), ['capture']);
  assert.deepEqual(axisEnum(base).filter((a) => !axisEnum(now).includes(a)), []);
  const strip = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.description; axisEnum(c).splice(0, axisEnum(c).length, ...axisEnum(c).filter((a) => a !== 'capture')); return c; };
  assert.deepEqual(strip(now), strip(base), 'nothing else in the schema moved');
});

test('AC-5 the text shows a capture line for an axis that is not current, its effect set apart by whitespace, and none when current', async () => {
  const moved = await receiptFile('files');
  const doc = staleReport([moved], await opts(moved, { capture: 'text' }));
  // The axis lines are indented under the header, which is not an axis line though a skill may be called capture-something.
  const axisLine = (text) => text.split('\n').find((l) => /^\s+capture\s/.test(l));
  const line = axisLine(renderText(doc));
  assert.match(line, /^\s+capture\s+files to text\s{2,}rerun both arms$/);
  const unrecorded = await receiptFile('text', { unrecorded: true });
  const u = axisLine(renderText(staleReport([unrecorded], await opts(unrecorded))));
  assert.match(u, /^\s+capture\s+unrecorded to text\s{2,}unknown: the receipt records no capture mode/);
  const current = await receiptFile('text');
  assert.equal(axisLine(renderText(staleReport([current], await opts(current, { capture: 'text' })))), undefined);
});

test('AC-5 the next command carries --capture when the flag was given, and not when the rc or the default gave the mode', async () => {
  const file = await receiptFile('files');
  const flagged = (await read(file, { capture: 'text' })).x;
  assert.match(flagged.next, /^driftproof run .* --model \S+ --capture text$/);
  const flaggedFiles = (await read(await receiptFile('text'), { capture: 'files' })).x;
  assert.match(flaggedFiles.next, / --capture files$/);
  const viaRc = (await read(file, { rc: { capture: 'text' } })).x;
  assert.doesNotMatch(viaRc.next, /--capture/);
  const viaDefault = (await read(file, {})).x;
  assert.doesNotMatch(viaDefault.next, /--capture/);
});

// ── AC-6: the stale Action reports the axis ─────────────────────────────────────────────────────────

function action(receiptFileName, mode) {
  const ws = scratch('ws');
  const out = path.join(ws, 'github-output'); const summary = path.join(ws, 'summary.md');
  // The model and judge come from the workspace's .driftproofrc, as spec 057 AC-1 reads them, and so does the mode.
  const run = readJson(receiptFileName).run;
  fs.writeFileSync(path.join(ws, '.driftproofrc'), JSON.stringify({ models: run.model_id, judge_model: run.judge.model_id, capture: mode }));
  fs.copyFileSync(receiptFileName, path.join(ws, 'receipt.json'));
  const r = realSpawnSync(process.execPath, [RUN], {
    cwd: ws, encoding: 'utf8',
    env: cleanEnv({
      GITHUB_WORKSPACE: ws, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: TMP,
      INPUT_RECEIPTS: 'receipt.json', INPUT_SKILL: SKILL, INPUT_SUITE: '', INPUT_MODEL: '', INPUT_JUDGE: '', INPUT_HARNESS_VERSION: HARNESS,
      INPUT_STRICT: 'false', INPUT_FAIL_ON_STALE: 'false', INPUT_OPEN_ISSUE: 'false', INPUT_ISSUE_LABEL: 'driftproof-stale', INPUT_GITHUB_TOKEN: '',
    }),
  });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  return { code: r.status, stderr: r.stderr, summary: read(summary), outputs: read(out) };
}

test('AC-6 the stale Action reports a moved mode and an unrecorded one in its summary, with no input added', async () => {
  const moved = action(await receiptFile('files'), 'text');
  assert.equal(moved.code, 0, moved.stderr);
  assert.match(moved.outputs, /^result=stale$/m);
  assert.match(moved.summary, /capture: rerun both arms/);
  const unrecorded = action(await receiptFile('text', { unrecorded: true }), 'text');
  assert.equal(unrecorded.code, 0, unrecorded.stderr);
  assert.match(unrecorded.outputs, /^result=advisory$/m);
  assert.match(unrecorded.summary, /capture: unknown: the receipt records no capture mode/);
  // The mode the receipt recorded: nothing about capture is reported, and nothing is stale.
  const same = action(await receiptFile('text'), 'text');
  assert.equal(same.code, 0, same.stderr);
  assert.doesNotMatch(same.summary, /capture:/);
  assert.doesNotMatch(same.outputs, /^result=stale$/m);
});

test('AC-6 stale/run.mjs and the inputs of stale/action.yml are the Base\'s', () => {
  assert.equal(fs.readFileSync(RUN, 'utf8'), baseFile('stale/run.mjs'));
  const inputs = (yaml) => [...((yaml.match(/^inputs:\n([\s\S]*?)^\S/m) || [])[1] || '').matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]);
  const now = inputs(fs.readFileSync(path.join(ROOT, 'stale', 'action.yml'), 'utf8'));
  assert.ok(now.length > 0);
  assert.deepEqual(now, inputs(baseFile('stale/action.yml')));
  assert.ok(!now.includes('capture'));
});
