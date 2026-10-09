// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 180 (issue 134): the substrate check on a claude-cli reply whose modelUsage names
// an auxiliary model beside the requested one. Each fixture runs through lib/run.js runSkillOnModel,
// its attest() and lib/receipt.js's writer, offline.
//
//   node --test tests/substrate-auxiliary.test.js
//
// THE MODEL DOUBLE is the one tests/answer-capture-run.test.js uses: child_process.spawn replaced on the
// module object lib/provider.js calls it through, so nothing is spawned and no model is called. It
// answers in the CLI's JSON shape, with the modelUsage map the test's SHAPE names, keyed by the model
// the call asked for (its --model argument). spawnSync is replaced too, so the harness version read
// spawns nothing.
//
// SPEC180_ROOT names another tree to load lib/ from (the gate's copy of the Base, or a planted copy);
// the default is this repository. AC-4 also loads the Base's lib/ beside it, taken by git archive at
// the Base spec 180's header names into a directory under the system temp directory, never the tree.
//
// Every test name starts with the criterion it checks; spec 180's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const REPO = path.join(__dirname, '..');
const ROOT = process.env.SPEC180_ROOT ? path.resolve(process.env.SPEC180_ROOT) : REPO;
const SPEC = path.join(REPO, 'specs', '180-auxiliary-model-attestation', 'spec.md');

const realExecFileSync = cp.execFileSync;
const calls = [];
let SHAPE = 'single';
const JUDGE = /Return ONLY this JSON object/;
const canon = (id) => String(id).replace(/-\d{8}$/, '');
const entry = (i, o, cr = 0) => ({ inputTokens: i, outputTokens: o, cacheReadInputTokens: cr, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0, contextWindow: 200000, maxOutputTokens: 32000 });
// What the reply says served the call, per shape, for a call that asked for `req`.
const SHAPES = {
  // (d) the shape before 2.1.29x: one key, the requested model's.
  single: (req) => ({ modelUsage: { [canon(req)]: entry(10, 40, 100) } }),
  // (a) the issue's report: Claude Code's own Haiku call beside the requested model.
  aux: (req) => ({ modelUsage: { 'claude-haiku-5-5': entry(897, 8), [canon(req)]: entry(10, 40, 100) } }),
  // (a) the same, with a result message that names the requested model as serving.
  'aux-named': (req) => ({ model: req, modelUsage: { 'claude-haiku-5-5': entry(897, 8), [canon(req)]: entry(10, 40, 100) } }),
  // (b) the requested model absent.
  absent: () => ({ modelUsage: { 'claude-haiku-5-5': entry(897, 8) } }),
  // (c) another model served the main turn, the requested id present: by the output tokens...
  'other-main': (req) => ({ modelUsage: { [canon(req)]: entry(10, 4), 'claude-sonnet-5': entry(10, 400) } }),
  // ...and by the result naming another model while the requested id carries the bulk.
  'other-named': (req) => ({ model: 'claude-sonnet-5', modelUsage: { [canon(req)]: entry(10, 400), 'claude-haiku-5-5': entry(897, 8) } }),
};
const GEN_TEXT = 'A decision record: context, the decision, its consequences.';
cp.spawn = (file, args, options) => {
  const call = { file, args: [...args], cwd: (options && options.cwd) || null, input: '' };
  calls.push(call);
  const c = new EventEmitter();
  c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => true;
  c.stdin = {
    write(d) { call.input += d; },
    on() {},
    end() {
      setImmediate(() => {
        call.judge = JUDGE.test(call.input);
        const req = call.args[call.args.indexOf('--model') + 1];
        const result = call.judge ? JSON.stringify({ score: 0.8, pass: true, reason: 'double' }) : GEN_TEXT;
        c.stdout.end(JSON.stringify({ type: 'result', result, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 100 }, ...SHAPES[SHAPE](req) }));
        c.stderr.end();
        setImmediate(() => c.emit('close', 0, null));
      });
    },
  };
  return c;
};
cp.spawnSync = () => ({ status: 0, stdout: '2.1.295 (Claude Code)\n', stderr: '' });

delete process.env.DRIFTPROOF_STUB;
delete process.env.DRIFTPROOF_EVAL_USER;
process.env.CLAUDE_PROVIDER = 'cli';
const libOf = (root) => ({
  run: require(path.join(root, 'lib', 'run.js')),
  regrade: require(path.join(root, 'lib', 'regrade.js')),
  receipt: require(path.join(root, 'lib', 'receipt.js')),
});
const lib = libOf(ROOT);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SYS = '---\nname: fx\n---\nWrite the ADR.';
function skillOf() {
  const cases = [{ id: 'adr-1', prompt: 'Write an ADR choosing a database.', rubric: 'A complete ADR with context, decision and consequences.', pass_threshold: 0.7 }];
  return { name: 'fx-adr', version: '1.0.0', contentHash: sha(SYS), skillMd: SYS, suite: { format: 'agentskills.io/evals', suiteHash: sha(JSON.stringify(cases)), caseCount: cases.length, cases } };
}
const OPTS = { samples: 2, trusted: true, judgeModel: 'haiku', nowIso: '2026-10-09T16:05:00.000Z' };
const run = (l, shape) => { SHAPE = shape; calls.length = 0; return l.run.runSkillOnModel({ skill: skillOf(), model: 'claude-opus-5-5', opts: OPTS }); };
const drawsOf = (r) => r.results.cases.flatMap((c) => c.generation.draws);

// A run whose clock reads one instant throughout, so two runs of one shape write the same bytes.
async function frozen(fn) {
  const Real = Date;
  const T = Real.parse(OPTS.nowIso);
  global.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } };
  try { return await fn(); } finally { global.Date = Real; }
}

// The Base's lib/, config and schemas, by git archive, beside a link to this tree's node_modules.
// The receipt records the runner version, which a release bump moves away from the Base's. It is an
// input, not the subject (issue 138): the copy's config.js is given the tree under test's
// RUNNER_VERSION, so every other byte is still compared and none is masked.
function baseTree() {
  const m = /^\*\*Base:\*\* `[^`]*` at `([0-9a-f]{40})`/m.exec(fs.readFileSync(SPEC, 'utf8'));
  assert.ok(m, 'spec 180 names no Base');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec180-base-'));
  const tar = realExecFileSync('git', ['archive', '--format=tar', m[1], 'lib', 'config', 'config.js', 'spec', 'package.json'], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
  realExecFileSync('tar', ['-x', '-C', dir], { input: tar });
  const version = require(path.join(ROOT, 'config.js')).RUNNER_VERSION;
  const cfg = path.join(dir, 'config.js');
  const was = fs.readFileSync(cfg, 'utf8');
  const line = /^const RUNNER_VERSION = '[^']*';$/m;
  assert.equal((was.match(new RegExp(line.source, 'gm')) || []).length, 1, 'the Base\'s config.js has no single RUNNER_VERSION line to hold equal');
  fs.writeFileSync(cfg, was.replace(line, () => `const RUNNER_VERSION = '${version}';`));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}

// ── (a) an auxiliary model beside the requested one ───────────────────────────────────────────────

test('AC-1 (a) an auxiliary Haiku beside the requested model attests, and every draw records it with its tokens', async () => {
  const { receipt } = await run(lib, 'aux');
  const ab = receipt.run.answered_by;
  assert.equal(ab.kind, 'model');
  assert.equal(ab.attested, true);
  assert.equal(ab.reported_model, 'claude-opus-5-5');
  assert.deepEqual(ab.reported_models, ['claude-haiku-4-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
  const draws = drawsOf(receipt);
  assert.ok(draws.length >= 2 && draws.every((d) => d.status === 'measured'), 'every draw measured');
  for (const d of draws) {
    assert.equal(d.reported_model, 'claude-opus-5-5');
    assert.deepEqual(d.auxiliary_calls, [
      { phase: 'generation', model: 'claude-haiku-5-5', input_tokens: 897, output_tokens: 8 },
      { phase: 'judge', model: 'claude-haiku-5-5', input_tokens: 897, output_tokens: 8 },
      { phase: 'judge', model: 'claude-haiku-5-5', input_tokens: 897, output_tokens: 8 },
    ]);
  }
  assert.deepEqual(receipt.run.harness, { name: 'claude-code', version: '2.1.295' });
  const v = lib.receipt.validateReceipt(receipt);
  assert.ok(v.valid, JSON.stringify(v.errors));
  assert.ok(lib.receipt.verifyReceiptHash(receipt));
});

test('AC-1 (a) with the result naming the requested model as serving, the auxiliary model attests the same way', async () => {
  const { receipt } = await run(lib, 'aux-named');
  assert.equal(receipt.run.answered_by.attested, true);
  assert.ok(drawsOf(receipt).every((d) => Array.isArray(d.auxiliary_calls) && d.auxiliary_calls[0].model === 'claude-haiku-5-5'));
});

// ── (b) the requested model absent ────────────────────────────────────────────────────────────────

test('AC-2 (b) the requested model absent stops the run at its first call, naming both ids and why', async () => {
  await assert.rejects(run(lib, 'absent'), (e) => {
    assert.equal(e.code, 'SUBSTRATE_MISMATCH');
    assert.match(e.message, /"claude-haiku-5-5"/);
    assert.match(e.message, /"claude-opus-5-5"/);
    assert.match(e.message, /the requested model is not among the models it named/);
    return true;
  });
  assert.equal(calls.length, 1, 'a call was made after the mismatch');
});

// ── (c) another model served the main turn, the requested id present ──────────────────────────────

test('AC-3 (c) another model carrying the bulk of the output tokens stops the run, the requested id present', async () => {
  await assert.rejects(run(lib, 'other-main'), (e) => {
    assert.equal(e.code, 'SUBSTRATE_MISMATCH');
    assert.equal(e.reported, 'claude-sonnet-5');
    assert.match(e.message, /carried 4 of 404 output tokens, not more than half/);
    return true;
  });
  assert.equal(calls.length, 1, 'a call was made after the mismatch');
});

test('AC-3 (c) a result naming another serving model stops the run, though the requested id carries the bulk', async () => {
  await assert.rejects(run(lib, 'other-named'), (e) => {
    assert.equal(e.code, 'SUBSTRATE_MISMATCH');
    assert.equal(e.reported, 'claude-sonnet-5');
    assert.match(e.message, /its result names that model as serving the turn/);
    return true;
  });
  assert.equal(calls.length, 1, 'a call was made after the mismatch');
});

test('AC-3 (c) a tie and a reply with no per-id counts are refused by attest()', () => {
  const tie = { reportedModels: ['claude-haiku-5-5', 'claude-opus-5-5'], modelTokens: { 'claude-haiku-5-5': { input_tokens: 1, output_tokens: 20 }, 'claude-opus-5-5': { input_tokens: 1, output_tokens: 20 } } };
  assert.throws(() => lib.run.attest(tie, 'claude-opus-5-5', 'generation'), (e) => e.code === 'SUBSTRATE_MISMATCH' && /carried 20 of 40/.test(e.message));
  const bare = { reportedModels: ['claude-haiku-5-5', 'claude-opus-5-5'] };
  assert.throws(() => lib.run.attest(bare, 'claude-opus-5-5', 'generation'), (e) => e.code === 'SUBSTRATE_MISMATCH' && /carried 0 of 0/.test(e.message));
});

// ── (d) the single-key shape, unchanged ───────────────────────────────────────────────────────────

test('AC-4 (d) the single-key shape writes a receipt byte-identical to the Base\'s, with no auxiliary record', async () => {
  const dir = baseTree();
  try {
    const base = libOf(dir);
    const mine = await frozen(() => run(lib, 'single'));
    const theirs = await frozen(() => run(base, 'single'));
    assert.ok(drawsOf(mine.receipt).every((d) => !('auxiliary_calls' in d)));
    assert.equal(mine.receipt.run.answered_by.attested, true);
    // The clock is the only input that moves between two runs; with it fixed, a second run of this
    // tree writes the same bytes, so a difference from the Base is the code's.
    const again = await frozen(() => run(lib, 'single'));
    assert.equal(JSON.stringify(again.receipt), JSON.stringify(mine.receipt), 'two runs of this tree differ: the comparison would not be about the code');
    assert.equal(JSON.stringify(mine.receipt), JSON.stringify(theirs.receipt));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── the regrade ───────────────────────────────────────────────────────────────────────────────────

test('AC-5 a regrade on a CLI with the auxiliary entry attests, keeps the generation\'s auxiliary calls and records its judge\'s', async () => {
  const { receipt } = await run(lib, 'aux');
  const answers = {};
  for (const d of drawsOf(receipt)) answers[d.generation_hash] = GEN_TEXT;
  SHAPE = 'aux'; calls.length = 0;
  const out = await lib.regrade.regradeReceipt({ receipt, skill: skillOf(), answers, judgeModel: 'haiku', samples: 3, opts: { trusted: true } });
  const draws = drawsOf(out.receipt);
  assert.ok(draws.length >= 2 && draws.every((d) => d.status === 'measured'));
  for (const d of draws) {
    assert.deepEqual(d.auxiliary_calls.map((x) => x.phase), ['generation', 'judge', 'judge', 'judge']);
    assert.ok(d.auxiliary_calls.every((x) => x.model === 'claude-haiku-5-5' && x.input_tokens === 897 && x.output_tokens === 8));
  }
  const v = lib.receipt.validateReceipt(out.receipt);
  assert.ok(v.valid, JSON.stringify(v.errors));
});

// ── the docs note ─────────────────────────────────────────────────────────────────────────────────

test('AC-6 spec/RECEIPT.md states the rule, the auxiliary record and the Claude Code range the claude-cli lane is verified on', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'spec', 'RECEIPT.md'), 'utf8');
  const at = doc.indexOf('\n## Auxiliary calls on claude-cli');
  assert.ok(at >= 0, 'no section');
  const sec = doc.slice(at + 1, doc.indexOf('\n## ', at + 1));
  for (const want of ['`auxiliary_calls`', 'more than half', 'served the main turn', 'SUBSTRATE_MISMATCH', '2.1.272', '2.1.284', '2.1.295', 'run.harness']) {
    assert.ok(sec.includes(want), `the section does not say ${want}`);
  }
});
