// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
process.env.TMPDIR = '/var/tmp';
process.env.CLAUDE_PROVIDER = 'cli';
delete process.env.DRIFTPROOF_STUB;
const spawn = cp.spawnSync;
cp.spawnSync = (cmd, args, opts) => args?.includes('--version')
  ? { status: 0, stdout: '2.1.295 (Claude Code)\n', stderr: '' } : spawn(cmd, args, opts);
const MODEL = 'claude-haiku-4-5';
const BAD = '{"score":';
const GOOD = '{"score":0.8,"reason":"An answer is present."}';
let requests = [], judgeCalls = 0, generationCalls = 0, respond;
const provider = require('../lib/provider');
provider.complete = async (a) => {
  const judge = /Return ONLY/.test(a.prompt);
  if (a.onAttempt) a.onAttempt(1);
  requests.push(a);
  if (!judge) {
    generationCalls++;
    return reply('A primary colour is red.');
  }
  judgeCalls++;
  const value = respond(judgeCalls, a);
  if (value instanceof Error) throw value;
  return typeof value === 'string' ? reply(value) : value;
};
function reply(text, extra = {}) {
  return { text, attempts: 1, usage: { input_tokens: 10, output_tokens: 5 },
    answeredBy: 'model', surface: 'claude-cli', reportedModels: [MODEL],
    stopReason: 'end_turn', isolation: 'same-user', wall_ms: 1, ...extra };
}
function reset(fn) { requests = []; judgeCalls = generationCalls = 0; respond = fn; }
const { gradeOnce, gradeSamples } = require('../lib/judge');
const { runSkillOnModel } = require('../lib/run');
const { regradeReceipt, answersArchive } = require('../lib/regrade');
const { validateReceipt, verifyReceiptHash, sealReceipt } = require('../lib/receipt');
const { sha256 } = require('../lib/canonical');
const input = { task: 'Name a primary colour.', response: 'Red.', rubric: 'Names a colour.', model: MODEL, temperature: 0, timeoutMs: 1234, trusted: true };
const draws = r => r.results.cases.flatMap(c => c.generation.draws);

test('AC-500-1/3/4: malformed then valid retries the identical request and accounts for both replies', async () => {
  reset(n => reply(n === 1 ? BAD : GOOD, { usage: { input_tokens: n * 10, output_tokens: n * 5 } }));
  const g = await gradeSamples({ ...input, samples: 1 });
  assert.equal(judgeCalls, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(g.samples, [0.8]);
  assert.equal(g.attempts, 2);
  assert.equal(g.usage.input_tokens, 30);
  assert.equal(g.usage.output_tokens, 15);
  assert.equal(g.replies.length, 2);
  assert.equal(g.parseRetries.length, 1);
  assert.equal(g.parseRetries[0].recovered, true);
  assert.deepEqual(g.parseRetries[0].attempts.map(a => a.output_sha256), [sha256(BAD), sha256(GOOD)]);
});

test('AC-500-1/3: twice malformed stays unmeasured with the existing reason', async () => {
  reset(() => BAD);
  const g = await gradeSamples({ ...input, samples: 1 });
  assert.equal(judgeCalls, 2);
  assert.equal(g.unmeasured, true);
  assert.equal(g.reason, 'judge output unparseable');
  assert.deepEqual(g.samples, []);
  assert.equal(g.parseRetries[0].recovered, false);
  assert.equal(g.usage.input_tokens, 20);
});

test('AC-500-2: no retry for scores, semantic failures, empty, cut or failed replies', async () => {
  for (const text of ['{"score":0}', '{"score":1}', '{"score":null}', '{"score":"0.8"}', '{"score":2}', '{}', '']) {
    reset(() => text);
    await gradeOnce(input);
    assert.equal(judgeCalls, 1, text);
  }
  reset(() => reply(BAD, { stopReason: 'max_tokens' }));
  assert.match((await gradeOnce(input)).reason, /truncated/);
  assert.equal(judgeCalls, 1);
  reset(() => Object.assign(new Error('timed out'), { code: 'TIMEOUT', attempts: 1 }));
  await assert.rejects(gradeOnce(input), { code: 'TIMEOUT' });
  assert.equal(judgeCalls, 1);
  reset(() => '{"judgments":[]}');
  const g = await gradeOnce({ ...input, criteria: [{ id: 'colour', weight: 1, text: 'Names a colour.' }] });
  assert.equal(g.unmeasured, true);
  assert.equal(judgeCalls, 1);
});

test('AC-500-3: zero is recovered and another failed sample still excludes the draw', async () => {
  reset(n => n === 1 ? BAD : '{"score":0}');
  assert.equal((await gradeOnce(input)).score, 0);
  reset(n => n === 2 ? GOOD : BAD);
  const g = await gradeSamples({ ...input, samples: 2, oneAtATime: true });
  assert.equal(g.unmeasured, true);
  assert.deepEqual(g.samples, []);
  assert.equal(judgeCalls, 4);
  assert.equal(g.parseRetries.filter(r => r.recovered).length, 1);
});

test('AC-500-4: retry timeout retains first reply and attempted retry; cap is not bypassed', async () => {
  reset(n => n === 1 ? BAD : Object.assign(new Error('timed out'), { code: 'TIMEOUT', attempts: 1 }));
  await assert.rejects(gradeSamples({ ...input, samples: 1 }), e => {
    assert.equal(e.judgeAttempts, 2);
    assert.equal(e.judgeReplies.length, 1);
    assert.equal(e.parseRetries[0].attempts[0].output_sha256, sha256(BAD));
    assert.equal(e.parseRetries[0].attempts[1].output_sha256, null);
    return e.code === 'TIMEOUT';
  });
  reset(() => BAD);
  let dispatched = 0;
  await assert.rejects(gradeSamples({ ...input, samples: 1, onAttempt() {
    if (dispatched++) throw Object.assign(new Error('cap reached'), { code: 'CALL_CAP', attempts: 0 });
  } }), { code: 'CALL_CAP' });
  assert.equal(judgeCalls, 1);
});

let dir;
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
function skill() {
  if (!dir) {
    dir = fs.mkdtempSync('/var/tmp/issue500-');
    fs.mkdirSync(path.join(dir, 'evals'));
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: fx500\nversion: 1.0.0\n---\n\nAnswer the question.\n');
    fs.writeFileSync(path.join(dir, 'evals/evals.json'), JSON.stringify({ cases: [
      { id: 'colour', prompt: input.task, rubric: input.rubric, pass_threshold: 0.7 },
    ] }));
  }
  return require('../lib/skill').loadSkill(dir);
}
async function run() {
  return runSkillOnModel({ skill: skill(), model: MODEL, opts: { samples: 1, trusted: true, keepTranscripts: true, concurrency: 1 } });
}
function checkReceipt(r, retries, recovered) {
  assert.ok(validateReceipt(r).valid, JSON.stringify(validateReceipt(r).errors));
  assert.ok(verifyReceiptHash(r));
  assert.equal(r.run.judge.parse_retries, retries);
  assert.equal(r.run.judge.parse_recoveries, recovered);
  const records = draws(r).flatMap(d => d.judge_parse_retries || []);
  assert.equal(records.length, retries);
  for (const entry of records) {
    assert.equal(entry.attempts.length, 2);
    for (const a of entry.attempts) {
      assert.equal(a.attempts, 1);
      const p = r.run.pricing_snapshot.models[r.run.judge.model_id];
      const cost = Math.round((10 * p.input_per_mtok + 5 * p.output_per_mtok)) / 1e6;
      assert.equal(a.cost_usd, cost);
      assert.equal(a.usage.input_tokens, 10);
    }
  }
  for (const key of ['parse_retries', 'parse_recoveries']) {
    const bad = structuredClone(r); bad.run.judge[key]++;
    assert.equal(verifyReceiptHash(bad), false);
    bad.run.judge[key] = -1; sealReceipt(bad);
    assert.equal(validateReceipt(bad).valid, false);
  }
  if (records.length) {
    const bad = structuredClone(r);
    draws(bad)[0].judge_parse_retries[0].attempts[0].cost_usd++;
    assert.equal(verifyReceiptHash(bad), false);
  }
}

test('AC-500-4/5/6: run and regrade seal retry counts, attempt costs and all usage; generations stay single', async () => {
  reset(n => n % 2 ? BAD : GOOD);
  const original = await run();
  const n = draws(original.receipt).length;
  assert.equal(generationCalls, n);
  assert.equal(judgeCalls, n * 2);
  assert.equal(original.calls, n * 3);
  checkReceipt(original.receipt, n, n);
  for (const d of draws(original.receipt)) assert.equal(d.judge_usage.input_tokens, 20);
  const p = original.receipt.run.pricing_snapshot.models[MODEL];
  assert.equal(original.receipt.economics.judge_overhead.total_cost_usd, Math.round(n * (20 * p.input_per_mtok + 10 * p.output_per_mtok)) / 1e6);
  const { answers } = answersArchive({ receipt: original.receipt, kept: original.answers });
  reset(n => n % 2 ? BAD : GOOD);
  const rg = await regradeReceipt({ receipt: original.receipt, skill: skill(), answers, judgeModel: MODEL, samples: 1, opts: { trusted: true } });
  assert.equal(generationCalls, 0);
  assert.equal(rg.calls, 2 * n);
  checkReceipt(rg.receipt, n, n);
  for (const d of draws(rg.receipt)) assert.deepEqual(d.judge_sample_evidence.map(e => e.output_sha256), d.judge_sample_hashes);
  reset(() => GOOD);
  const fresh = await regradeReceipt({ receipt: original.receipt, skill: skill(), answers, judgeModel: MODEL, samples: 1, opts: { trusted: true } });
  checkReceipt(fresh.receipt, 0, 0);
  // Old receipts have no new fields. Reading and validation do not rewrite them.
  const old = structuredClone(fresh.receipt);
  delete old.run.judge.parse_retries; delete old.run.judge.parse_recoveries;
  for (const d of draws(old)) delete d.judge_parse_retries;
  sealReceipt(old);
  const bytes = JSON.stringify(old);
  assert.ok(validateReceipt(old).valid); assert.ok(verifyReceiptHash(old));
  assert.equal(JSON.stringify(old), bytes);
});

test('AC-500-3/5: two failures are disclosed; retry timeout accounts for partial usage', async () => {
  reset(() => BAD);
  const out = await run();
  const n = draws(out.receipt).length;
  checkReceipt(out.receipt, n, 0);
  for (const d of draws(out.receipt)) {
    assert.equal(d.status, 'unmeasured');
    assert.equal(d.reason, 'judge output unparseable');
    assert.deepEqual(d.samples, []);
  }
  reset(n => n % 2 ? BAD : Object.assign(new Error('timed out'), { code: 'TIMEOUT', attempts: 1 }));
  const timed = await run();
  for (const d of draws(timed.receipt)) {
    assert.equal(d.judge_usage.input_tokens, 10);
    assert.equal(d.judge_parse_retries[0].attempts[1].cost_usd, null);
  }
  assert.equal(timed.receipt.run.judge.parse_retries, draws(timed.receipt).length);
});

test("AC-500-4: a recovered score cannot hide the first reply's wrong model", async () => {
  reset(n => n % 2 ? reply(BAD, { reportedModels: ['claude-sonnet-4-5'] }) : GOOD);
  await assert.rejects(run(), { code: 'SUBSTRATE_MISMATCH' });
});

test('AC-500-1: repository strict parser retries malformed JSON instead of repairing it', async () => {
  const capture = require('../lib/capture');
  const originalOptional = capture.optionalCheckpoint;
  const originalInvoke = capture.checkpointInvoke;
  const context = { doc: { binding: { capture_mode: 'repository' } } };
  capture.optionalCheckpoint = () => ({ context: { getStore: () => context } });
  capture.checkpointInvoke = (fn, request) => fn(request);
  try {
    const answer = capture.annotateRepositoryAnswer('A primary colour is red.').answer;
    reset(n => reply(n === 1 ? '{"score":0.8,}' : GOOD, { delivery: { complete: true } }));
    const g = await gradeOnce({ ...input, response: answer });
    assert.equal(g.score, 0.8);
    assert.equal(judgeCalls, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[0].capture, 'repository');
    assert.equal(requests[0].repositoryJudge, true);
  } finally {
    capture.optionalCheckpoint = originalOptional;
    capture.checkpointInvoke = originalInvoke;
  }
});

test('AC-500-4: run call cap also bounds parse retries', async () => {
  reset(n => n % 2 ? BAD : GOOD);
  await assert.rejects(runSkillOnModel({ skill: skill(), model: MODEL,
    opts: { samples: 1, trusted: true, preset: 'quick', draws: 2, maxCalls: 8, concurrency: 1 } }), { code: 'CALL_CAP' });
  assert.equal(judgeCalls + generationCalls, 8);
});

test('AC-500-4/5: samples skipped after a checkpoint error add no retry records', async () => {
  const capture = require('../lib/capture');
  const originalOptional = capture.optionalCheckpoint;
  const originalInvoke = capture.checkpointInvoke;
  capture.optionalCheckpoint = () => ({ context: { getStore: () => ({ doc: { binding: { capture_mode: 'text' } } }) } });
  capture.checkpointInvoke = (fn, request) => fn(request);
  try {
    reset(n => n === 1 ? BAD : Object.assign(new Error('timed out'), { code: 'TIMEOUT', attempts: 1 }));
    await assert.rejects(gradeSamples({ ...input, samples: 3, oneAtATime: true }), e => {
      assert.equal(judgeCalls, 2);
      assert.equal(e.judgeAttempts, 2);
      assert.equal(e.judgeCalls, 2);
      assert.equal(e.parseRetries.length, 1);
      return e.code === 'TIMEOUT';
    });
  } finally {
    capture.optionalCheckpoint = originalOptional;
    capture.checkpointInvoke = originalInvoke;
  }
});


test('AC-538-7: judge markup retries stay separate from fake generations, including v0.15 receipts', async () => {
  const markup = '<function_calls><invoke name="Read"></invoke></function_calls>';
  reset(n => n % 2 ? markup : GOOD);
  const original = await run();
  const n = draws(original.receipt).length;
  assert.equal(generationCalls, n);
  assert.equal(judgeCalls, n * 2);
  checkReceipt(original.receipt, n, n);
  const checkCounts = r => {
    for (const arm of Object.values(r.results.fake_tool_calls)) assert.equal(arm.count, 0);
    for (const d of draws(r)) {
      assert.equal(d.status, 'measured');
      assert.equal(d.capture_outcome, undefined);
      assert.equal(d.mean, 0.8);
    }
  };
  checkCounts(original.receipt);
  const old = structuredClone(original.receipt);
  old.schema_version = '0.15';
  delete old.results.fake_tool_calls;
  sealReceipt(old);
  const bytes = JSON.stringify(old);
  assert.ok(validateReceipt(old).valid, JSON.stringify(validateReceipt(old).errors));
  assert.ok(verifyReceiptHash(old));
  assert.equal(JSON.stringify(old), bytes);
  const { answers } = answersArchive({ receipt: old, kept: original.answers });
  reset(i => i % 2 ? markup : GOOD);
  const rg = await regradeReceipt({ receipt: old, skill: skill(), answers, judgeModel: MODEL, samples: 1, opts: { trusted: true } });
  assert.equal(generationCalls, 0);
  assert.equal(judgeCalls, n * 2);
  checkReceipt(rg.receipt, n, n);
  checkCounts(rg.receipt);
});
