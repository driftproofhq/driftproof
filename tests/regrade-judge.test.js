// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 212, spec 044 A-044-6. No model or network call: complete is replaced before its consumers
// load. SPEC212_ROOT loads a gate's scratch product; tests remain this checkout's. All writes use
// TMPDIR, defaulting to /var/tmp. The counter observes provider calls independently of the receipt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ROOT = process.env.SPEC212_ROOT || path.join(__dirname, '..');
const R = (p) => require(path.join(ROOT, p));
const made = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'issue212-'));
  made.push(d); return d;
};
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
// Only the harness's version read is doubled. CLI tests use a provider preload in their own process.
const spawn = cp.spawnSync;
cp.spawnSync = (cmd, args, opts) => args && args.includes('--version')
  ? { status: 0, stdout: '2.1.295 (Claude Code)\n', stderr: '' } : spawn(cmd, args, opts);
process.env.TMPDIR = process.env.TMPDIR || '/var/tmp';
delete process.env.DRIFTPROOF_STUB;
process.env.CLAUDE_PROVIDER = 'cli';
const MODEL = 'claude-haiku-4-5';
const IDS = ['claude-haiku-4-5-20251001', 'claude-haiku-4-5-20251002'];
const SAMPLES = 2;
let choose = null;
let calls = [];
const reply = (a, extra = {}) => ({
  text: /Return ONLY this JSON object/.test(a.prompt)
    ? JSON.stringify(a.prompt.includes('criterion')
      ? { judgments: [{ id: 'answer', decision: 'met', reason: 'An answer is present.' }] }
      : { score: 0.8, reason: 'An answer is present.' }) : 'A primary colour is red.',
  usage: { input_tokens: 10, output_tokens: 5 }, wall_ms: 1, attempts: 1,
  answeredBy: 'model', surface: 'claude-cli', reportedModels: [MODEL],
  stopReason: 'end_turn', isolation: 'same-user', ...extra,
});
const provider = R('lib/provider.js');
const endpointComplete = provider.complete;
let attemptSchedule = () => 1;
let endpointMode = false;
provider.complete = async (a) => {
  const call = { model: a.model, prompt: a.prompt, attempts: 0 };
  calls.push(call);
  for (let i = 0; i < (endpointMode ? 0 : attemptSchedule(calls.length)); i += 1) {
    if (process.env.DRIFTPROOF_STUB !== '1') { if (a.onAttempt) a.onAttempt(i + 1); call.attempts += 1; }
  }
  try {
    const out = choose ? await choose(a, calls.length) : reply(a);
    call.reply = clone(out);
    return out;
  } catch (e) { throw e; }
};
const { runSkillOnModel } = R('lib/run.js');
const { regradeReceipt, answersArchive } = R('lib/regrade.js');
const { loadSkill } = R('lib/skill.js');
const { sealReceipt, verifyReceiptHash, validateReceipt } = R('lib/receipt.js');
const { sha256Canonical } = R('lib/canonical.js');
const clone = (x) => structuredClone(x);
const draws = (r) => r.results.cases.flatMap((c) => c.generation.draws);
const originals = new Map();
async function original(criteria = false) {
  if (originals.has(criteria)) return originals.get(criteria);
  const dir = tmp(), sk = path.join(dir, 'skill');
  fs.mkdirSync(path.join(sk, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: fx212\nversion: 1.0.0\n---\n\nAnswer the question.\n');
  const c = { id: 'colour', prompt: 'Name a primary colour.', rubric: 'An answer names a primary colour.', pass_threshold: 0.7 };
  if (criteria) c.criteria = [{ id: 'answer', description: 'An answer names a primary colour.', weight: 1 }];
  fs.writeFileSync(path.join(sk, 'evals', 'evals.json'), JSON.stringify({ cases: [c] }));
  choose = null;
  const skill = loadSkill(sk);
  const r = await runSkillOnModel({ skill, model: MODEL, opts: { samples: SAMPLES, keepTranscripts: true, trusted: true } });
  assert.equal(r.receipt.verification_level, 'TESTED', 'the fixture is an identified model run');
  assert.ok(draws(r.receipt).every((d) => d.status === 'measured'), 'the fixture has measured answers');
  const { answers } = answersArchive({ receipt: r.receipt, kept: r.answers });
  const out = { dir, sk, skill, receipt: r.receipt, answers };
  originals.set(criteria, out); return out;
}
async function grade(o, fn, receipt = o.receipt) {
  choose = fn; calls = [];
  try {
    return await regradeReceipt({ receipt, skill: o.skill, answers: o.answers,
      judgeModel: 'haiku', samples: SAMPLES, opts: { trusted: true } });
  } finally { choose = null; }
}
const timeoutReply = () => Object.assign(new Error('fixture timed out'), { code: 'TIMEOUT', attempts: 3 });
async function refused(o, fn, receipt = o.receipt, check = () => {}) {
  await assert.rejects(grade(o, fn, receipt), (e) => {
    assert.equal(e.code, 'SUBSTRATE_MISMATCH');
    assert.match(e.message, /identity|named none|substrate mismatch/);
    check(e); return true;
  });
}

test('AC-13 every plain judge sample identifies its model, including criteria and a later draw', async (t) => {
  for (const criteria of [false, true]) {
    const o = await original(criteria);
    const low = clone(o.receipt); low.verification_level = 'UNVERIFIED'; sealReceipt(low);
    for (const r of [o.receipt, low]) {
      for (const identity of [undefined, null, [], [''], ['   ']]) {
        await t.test(JSON.stringify({ criteria, level: r.verification_level, identity: identity ?? String(identity) }), async () => {
          await refused(o, (a) => { const x = reply(a, { reportedModels: identity }); if (identity === undefined) delete x.reportedModels; return x; }, r);
        });
      }
      for (const at of [1, SAMPLES, SAMPLES + 1, draws(r).length * SAMPLES]) {
        await t.test(JSON.stringify({ criteria, level: r.verification_level, anonymous: at }), async () => {
          await refused(o, (a, n) => reply(a, { reportedModels: n === at ? null : [MODEL] }), r);
          assert.equal(calls.length, Math.ceil(at / SAMPLES) * SAMPLES, 'no later draw runs after the refused sample batch');
        });
      }
    }
    await refused(o, (a) => reply(a, { reportedModels: ['claude-opus-4-8'] }));
    await refused(o, (a) => reply(a, { reportedModels: ['claude-opus-4-8'], servedModel: 'claude-opus-4-8' }));
    await refused(o, (a) => reply(a, { reportedModels: [MODEL, 'claude-opus-4-8'], servedModel: 'claude-opus-4-8' }));
  }
});

test('AC-14 identity is read for invalid scores', async () => {
  const o = await original();
  await refused(o, (a) => reply(a, { text: 'not a score', reportedModels: null }));
});

test('AC-14 identity is read for replies beside a timeout', async () => {
  const o = await original();
  await refused(o, (a, n) => { if (n === 2) throw timeoutReply(); return reply(a, { reportedModels: n === 1 ? null : [MODEL] }); });
  assert.equal(calls.length, SAMPLES, 'timeout batch refusal makes no later draw call');
});

function cliEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^ANTHROPIC_|^OPENAI_|^CLAUDE_|^DRIFTPROOF_|^NODE_OPTIONS$|^SPEC212_/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, SPEC212_ROOT: ROOT, CLAUDE_PROVIDER: 'cli', ...extra };
}
function preload(dir) {
  const f = path.join(dir, 'preload.cjs');
  fs.writeFileSync(f, String.raw`
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const spawn = cp.spawnSync;
cp.spawnSync = (cmd, args, opts) => args && args.includes('--version')
  ? { status: 0, stdout: '2.1.295 (Claude Code)\n', stderr: '' } : spawn(cmd, args, opts);
const p = require(path.join(process.env.SPEC212_ROOT, 'lib/provider.js'));
let n = 0;
p.complete = async (a) => {
  n += 1; if (a.onAttempt) a.onAttempt(1); fs.appendFileSync(process.env.SPEC212_CALLS, 'judge\n');
  return { text: '{"score":0.8,"reason":"An answer is present."}', answeredBy: 'model', surface: 'claude-cli',
    reportedModels: process.env.SPEC212_IDENTITY ? ({ many: Array(1000000).fill('claude-haiku-4-5'), huge: ['x'.repeat(1000000)], malformed: ['bad id'], nonarray: {}, nonstring: [42] })[process.env.SPEC212_IDENTITY] : n === Number(process.env.SPEC212_ANONYMOUS) ? null : ['claude-haiku-4-5'],
    usage: { input_tokens: 10, output_tokens: 5 }, wall_ms: 1, attempts: 1, stopReason: 'end_turn', isolation: 'same-user' };
};
`);
  return f;
}
test('AC-14 command refuses anonymous first and last samples with exit 5 and no files', async (t) => {
  const o = await original();
  const receiptFile = path.join(o.dir, 'original.json'), answersFile = path.join(o.dir, 'answers.json');
  fs.writeFileSync(receiptFile, JSON.stringify(o.receipt));
  fs.writeFileSync(answersFile, JSON.stringify({ answers: o.answers }));
  for (const at of [1, draws(o.receipt).length * SAMPLES]) {
    await t.test('anonymous sample ' + at, () => {
    const dir = tmp(), out = path.join(dir, 'out'), log = path.join(dir, 'calls.txt');
    const r = spawn(process.execPath, [path.join(ROOT, 'bin/driftproof'), 'regrade', receiptFile,
      '--skill', o.sk, '--answers', answersFile, '--judge-model', 'haiku', '--samples', String(SAMPLES),
      '--trusted-skill', '--out', out], { cwd: dir, encoding: 'utf8', timeout: 1800000,
      env: cliEnv({ NODE_OPTIONS: '--require ' + preload(dir), SPEC212_CALLS: log, SPEC212_ANONYMOUS: String(at) }) });
    assert.equal(r.status, 5, r.stderr);
    assert.match(r.stderr, /substrate mismatch/);
    assert.deepEqual(fs.existsSync(out) ? fs.readdirSync(out) : [], [], 'no receipt, summary or sidecar');
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, Math.ceil(at / SAMPLES) * SAMPLES);
    });
  }
});

test('AC-15 anonymous stub replies have the sole exception, always UNVERIFIED', async (t) => {
  const o = await original();
  const stub = (a) => reply(a, { answeredBy: 'stub', surface: 'stub', reportedModels: null });
  process.env.DRIFTPROOF_STUB = '1';
  try {
    await t.test('genuine stub stays UNVERIFIED', async () => {
    const out = await grade(o, stub);
    assert.equal(out.receipt.verification_level, 'UNVERIFIED');
    assert.equal(out.receipt.run.judge.surface, 'stub');
    assert.equal(out.receipt.run.judge.reported_models, null);
    });
    await t.test('a model reply has no stub exception', async () => { await refused(o, (a) => reply(a, { reportedModels: null })); });
    await t.test('mixed replies have no stub exception', async () => { await refused(o, (a, n) => n === 1 ? stub(a) : reply(a)); });
  } finally { delete process.env.DRIFTPROOF_STUB; }
  await t.test('a stub label on a model path has no exception', async () => { await refused(o, stub); });
});

function generationSide(r) {
  return r.results.cases.map((c) => ({ id: c.id, mode: c.mode,
    n_planned: c.generation.n_planned, stopping_reason: c.generation.stopping_reason,
    draws: c.generation.draws.map((d) => Object.fromEntries(
      ['draw_index', 'generation_hash', 'stop_reason', 'truncated', 'reported_model', 'usage', 'captured_files']
        .filter((k) => Object.hasOwn(d, k)).map((k) => [k, d[k]]))) }));
}
test('AC-16 identified receipts seal their own dated ids and preserve the generation and lineage', async () => {
  const o = await original();
  const originalBytes = JSON.stringify(o.receipt), answersBytes = JSON.stringify(o.answers);
  const out = await grade(o, (a, n) => reply(a, { reportedModels: [IDS[n % IDS.length], 'claude-opus-4-8'], servedModel: MODEL }));
  const r = out.receipt;
  assert.equal(r.verification_level, 'TESTED');
  assert.deepEqual(r.run.judge.reported_models, IDS, 'the sorted unique dated judge ids, not auxiliary ids or the original judge');
  assert.equal(r.run.judge.model_id, provider.resolveModel('haiku'));
  assert.deepEqual(generationSide(r), generationSide(o.receipt));
  assert.equal(JSON.stringify(o.receipt), originalBytes);
  assert.equal(JSON.stringify(o.answers), answersBytes);
  assert.equal(r.run.regraded_from.receipt_hash, o.receipt.receipt_hash);
  assert.deepEqual(r.run.regraded_from.judge, o.receipt.run.judge);
  assert.equal(r.run.regraded_from.answers_sha256, sha256Canonical(o.answers));
  for (const d of draws(r)) {
    assert.equal(d.samples.length, SAMPLES);
    assert.equal(d.judge_sample_hashes.length, SAMPLES);
    assert.ok(d.auxiliary_calls.some((x) => x.phase === 'judge' && x.model === 'claude-opus-4-8'));
  }
  assert.ok(validateReceipt(r).valid, JSON.stringify(validateReceipt(r).errors));
  assert.ok(verifyReceiptHash(r));
  const tampered = clone(r); tampered.run.judge.reported_models = [MODEL];
  assert.equal(verifyReceiptHash(tampered), false, 'judge identity is inside the receipt hash');
  const low = clone(o.receipt); low.verification_level = 'UNVERIFIED'; sealReceipt(low);
  assert.equal((await grade(o, (a) => reply(a), low)).receipt.verification_level, 'UNVERIFIED');
});

test('AC-17 refusal counts retries and timeouts as they happened', async (t) => {
  const o = await original();
  const check = (e) => {
    const attempts = calls.reduce((n, c) => n + c.attempts, 0);
    assert.equal(e.callsMade, attempts, 'callsMade equals the provider attempt counter');
    assert.equal(e.attemptsMade, attempts);
    assert.equal(e.logicalCallsMade, calls.length);
    assert.equal(e.drawsJudged, 1);
    assert.match(e.message, new RegExp(attempts + ' judge call\\(s\\) were made'));
    assert.ok(calls.every((c) => /Return ONLY this JSON object/.test(c.prompt)), 'no generation call');
  };
  await t.test('retried anonymous reply', async () => {
    attemptSchedule = (n) => n + 1;
    await refused(o, (a, n) => reply(a, { attempts: 1, reportedModels: n === 2 ? null : [MODEL] }), o.receipt, check);
    assert.equal(calls.length, SAMPLES);
    attemptSchedule = () => 1;
  });
  await t.test('anonymous reply beside a retried timeout', async () => {
    attemptSchedule = (n) => n === 2 ? 3 : 2;
    await refused(o, (a, n) => { if (n === 2) throw timeoutReply(); return reply(a, { attempts: 1, reportedModels: null }); }, o.receipt, check);
    attemptSchedule = () => 1;
    assert.equal(calls.length, SAMPLES);
  });
});

test('AC-17 successful counts equal the judged and carried branches and actual attempts', async () => {
  const o = await original();
  const r = clone(o.receipt);
  const d = draws(r)[0]; d.truncated = true; d.stop_reason = 'max_tokens'; sealReceipt(r);
  attemptSchedule = () => 2;
  const out = await grade(o, (a) => reply(a, { attempts: 1 }), r);
  attemptSchedule = () => 1;
  const total = draws(r).length;
  assert.deepEqual(out.receipt.run.regrade.draws, { graded: total - 1, carried: 1 });
  assert.equal(calls.length, (total - 1) * SAMPLES);
  const attempts = calls.reduce((n, c) => n + c.attempts, 0);
  assert.equal(out.calls, attempts);
  assert.equal(out.receipt.run.regrade.judge_calls, attempts);
  assert.equal(out.receipt.run.regrade.judge_attempts, attempts);
  assert.equal(out.receipt.run.regrade.judge_logical_calls, calls.length);
  assert.deepEqual(draws(out.receipt)[0], d, 'the carried draw is unchanged');
});

// The rendered claim paragraph is deliberately constrained. Review its full context under 031/035.
const CLAIM_TEXT = 'A plain judge regrade refuses anonymous judge replies; no receipt is written. Each returned sample must report the requested judge identity. A mixed-model reply must explicitly name the requested judge as serving the reply. Reported ids preserve dates when supplied. The stub exception records UNVERIFIED. An UNVERIFIED original stays UNVERIFIED. Reported identity comes from the reply and does not authenticate provider identity or measure grading accuracy.';
function docRule(text, html = false) {
  const rendered = html ? require('../scripts/html-text.js').htmlToText(text, { skip: ['script', 'style'], collapse: true }) : text.replace(/\s+/g, ' ').trim();
  const section = html ? /<p id="plain-judge-regrade">([\s\S]*?)<\/p>/.exec(text)
    : /## Plain judge regrade\n\n([^\n]+)\n/.exec(text);
  if (!section) return false;
  const plain = html ? require('../scripts/html-text.js').htmlToText(section[1], { collapse: true }) : section[1].replace(/\s+/g, ' ').trim();
  return plain === CLAIM_TEXT && !/It is false that|proven identity|proves provider identity|has statistical confidence|does not refuse anonymous|anonymous judge replies are accepted/i.test(rendered);
}
test('AC-18 receipt and methodology sources state the refusal and stub exception in rendered context', async (t) => {
  for (const file of ['spec/RECEIPT.md', 'docs/methodology/index.html']) {
    await t.test(file, () => {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8'), html = file.endsWith('.html');
      assert.ok(docRule(text, html), file + ' states the reviewed claim in its full rendered paragraph');
      for (const term of ['plain judge regrade refuses anonymous judge replies', 'no receipt is written', 'stub exception', 'UNVERIFIED']) {
        assert.equal(docRule(text.replace(new RegExp(term, 'gi'), 'removed'), html), false, 'the reader detects a missing ' + term);
      }
      for (const plant of [
        text.replace('A plain judge', 'It is false that a plain judge'),
        text.replace(CLAIM_TEXT, CLAIM_TEXT + ' Anonymous judge replies are accepted.'),
        text + '\nThe regrade has proven identity and has statistical confidence.\n',
      ]) assert.equal(docRule(plant, html), false, 'rendered context rejects negation, contradiction and stronger claims');
    });
  }
});

test('AC-19 mixed-model judge replies require explicit serving evidence', async () => {
  const o = await original();
  const mixed = (a, extra) => reply(a, { reportedModels: [MODEL, 'claude-opus-4-8'],
    modelTokens: { [MODEL]: { output_tokens: 60 }, 'claude-opus-4-8': { output_tokens: 40 } }, ...extra });
  for (const extra of [{}, { servedModel: null }, { servedModel: 'claude-opus-4-8' }, { servedModel: 'claude-sonnet-5' }]) {
    await refused(o, (a) => mixed(a, extra));
  }
  const out = await grade(o, (a) => mixed(a, { servedModel: MODEL }));
  assert.equal(out.receipt.verification_level, 'TESTED');
});

function evidenceOf(r, i) {
  return { sample_index: i, output_sha256: R('lib/canonical.js').sha256(r.text),
    reported_models: r.reportedModels ?? null, served_model: r.servedModel ?? null,
    answered_by: r.answeredBy, surface: r.surface };
}
function correspondence(r, observed, returnedPerDraw = SAMPLES) {
  const judged = draws(r).filter((d) => d.judge_sample_evidence);
  return judged.every((d, j) => {
    const batch = observed.slice(j * returnedPerDraw, (j + 1) * returnedPerDraw);
    return JSON.stringify(d.judge_sample_evidence) === JSON.stringify(batch.map(evidenceOf))
      && JSON.stringify(d.judge_sample_hashes) === JSON.stringify(batch.map((x) => R('lib/canonical.js').sha256(x.text)));
  }) && judged.length * returnedPerDraw === observed.length;
}
test('AC-20 per-sample evidence matches observed replies and detects replaced hashes and identity', async () => {
  const o = await original();
  for (const identical of [false, true]) {
    const out = await grade(o, (a, n) => reply(a, { reportedModels: [IDS[n % 2], IDS[n % 2]],
      text: JSON.stringify({ score: 0.8, reason: identical ? 'Same answer.' : 'Sample ' + n }) }));
    const observed = calls.map((c) => c.reply);
    assert.equal(correspondence(out.receipt, observed), true, 'sample evidence corresponds to each observed output and identity');
    for (const mutate of [
      (d) => { d.judge_sample_hashes[0] = '0'.repeat(64); },
      (d) => { d.judge_sample_evidence[0].reported_models = null; },
      (d) => { d.judge_sample_evidence[0].output_sha256 = '1'.repeat(64); },
      ...(!identical ? [(d) => { d.judge_sample_hashes[1] = d.judge_sample_hashes[0]; }] : []),
    ]) {
      const plant = clone(out.receipt); mutate(draws(plant)[0]);
      assert.equal(correspondence(plant, observed), false, 'planted sample correspondence reads RED');
      assert.equal(verifyReceiptHash(plant), false);
    }
  }
  await refused(o, (a, n) => reply(a, { reportedModels: n === 2 ? null : [MODEL] }));
  const invalid = await grade(o, (a) => reply(a, { text: 'invalid score' }));
  assert.equal(correspondence(invalid.receipt, calls.map((c) => c.reply), 2 * SAMPLES), true);
  const timed = await grade(o, (a, n) => { if (n % SAMPLES === 0) throw timeoutReply(); return reply(a); });
  for (const d of draws(timed.receipt)) {
    assert.equal(d.judge_sample_evidence.length, 1, 'timeout keeps the returned sample identity');
    assert.deepEqual(d.judge_sample_hashes, d.judge_sample_evidence.map((e) => e.output_sha256));
  }
});

// Issue 500: expected batch sizes come from these stubs, never receipt counters.
test('AC-20 parse retries seal every returned identity and hash without adding scores', async (t) => {
  const o = await original();
  for (const mode of ['recovered', 'failed', 'timeout', 'mixed']) {
    await t.test(mode, async () => {
      const out = await grade(o, (a, n) => {
        const malformed = mode === 'mixed' ? n % 3 === 1 : n % 2 === 1 || mode === 'failed';
        if (mode === 'timeout' && n % 2 === 0) throw timeoutReply();
        return reply(a, { reportedModels: [IDS[n % 2], IDS[n % 2]],
          text: malformed ? 'malformed reply ' + n : JSON.stringify({ score: 0.8, reason: 'Reply ' + n }) });
      });
      const observed = calls.filter(c => c.reply).map(c => c.reply);
      const returnedPerDraw = mode === 'timeout' ? SAMPLES : mode === 'mixed' ? SAMPLES + 1 : 2 * SAMPLES;
      assert.equal(correspondence(out.receipt, observed, returnedPerDraw), true,
        'every returned attempt keeps its own observed identity and output');
      for (const d of draws(out.receipt)) {
        assert.equal(d.samples.length, ['recovered', 'mixed'].includes(mode) ? SAMPLES : 0);
        assert.equal(d.judge_usage.input_tokens, returnedPerDraw * 10);
      }
      if (['recovered', 'mixed'].includes(mode)) for (const c of out.receipt.results.cases) {
        assert.equal(c.judge_sample_hashes.length, SAMPLES, 'case hashes still describe scoring samples');
      }
      assert.ok(validateReceipt(out.receipt).valid);
      assert.ok(verifyReceiptHash(out.receipt));
      for (const mutate of [
        d => { d.judge_sample_evidence.shift(); d.judge_sample_hashes.shift(); },
        d => { d.judge_sample_evidence[0].reported_models = null; },
        d => { d.judge_sample_hashes[0] = '0'.repeat(64); },
      ]) {
        const plant = clone(out.receipt); mutate(draws(plant)[0]);
        assert.equal(correspondence(plant, observed, returnedPerDraw), false,
          'dropping or replacing initial retry evidence reads RED');
        assert.equal(verifyReceiptHash(plant), false);
      }
    });
  }
});

test('AC-21 real provider retries are counted from simulated endpoint invocations despite incorrect metadata', async () => {
  const o = await original();
  const realSpawn = cp.spawn, realTimer = global.setTimeout;
  const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
  let endpoint = [], pendingAttempt = 0, anonymous = false;
  global.setTimeout = (fn, ms, ...args) => realTimer(fn, ms === 30000 || ms === 60000 ? 0 : ms, ...args);
  cp.spawn = (_cmd, args) => {
    endpoint.push(args); pendingAttempt += 1;
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    child.stdin.on('finish', () => queueMicrotask(() => {
      const last = pendingAttempt === 3;
      if (last) {
        child.stdout.end(JSON.stringify({ result: '{"score":0.8,"reason":"An answer is present."}',
          modelUsage: anonymous ? {} : { [MODEL]: { inputTokens: 10, outputTokens: 5 } } }));
        pendingAttempt = 0;
      } else child.stderr.end('429 rate limit');
      child.emit('close', last ? 0 : 1, null);
    }));
    return child;
  };
  const saved = choose;
  try {
    endpointMode = true;
    choose = async (a) => ({ ...await endpointComplete(a), attempts: 2 }); calls = [];
    const out = await regradeReceipt({ receipt: o.receipt, skill: o.skill, answers: o.answers,
      judgeModel: 'haiku', samples: SAMPLES, opts: { trusted: true } });
    assert.equal(out.calls, endpoint.length, 'real retry counter equals endpoint invocations despite incorrect attempts metadata');
    assert.equal(out.receipt.run.regrade.judge_attempts, endpoint.length);
    assert.equal(endpoint.length, draws(o.receipt).length * SAMPLES * 3);
    endpoint = []; anonymous = true;
    await assert.rejects(regradeReceipt({ receipt: o.receipt, skill: o.skill, answers: o.answers,
      judgeModel: 'haiku', samples: SAMPLES, opts: { trusted: true } }), (e) => {
      assert.equal(e.code, 'SUBSTRATE_MISMATCH');
      assert.equal(e.callsMade, endpoint.length);
      assert.equal(e.attemptsMade, endpoint.length);
      return true;
    });
    assert.equal(endpoint.length, SAMPLES * 3);
  } finally { choose = saved; endpointMode = false; cp.spawn = realSpawn; global.setTimeout = realTimer; }
});

test('AC-23 hostile direct answers and identities refuse with bounded diagnostics', async () => {
  const o = await original();
  const hugeText = 'x'.repeat(1048577);
  const badAnswers = [ { ...o.answers, [R('lib/canonical.js').sha256(hugeText)]: hugeText },
    { ...o.answers, ...Object.fromEntries(Array.from({ length: 4097 }, (_, n) => [n.toString(16).padStart(64, '0'), 'x'])) },
    { ...o.answers, ['x'.repeat(257)]: 'x' },
    { ...o.answers, ...Object.fromEntries(Array.from({ length: 17 }, (_, n) => [n.toString(16).padStart(64, '0'), 'x'.repeat(1048576)])) }, null, [] ];
  for (const answers of badAnswers) {
    calls = [];
    await assert.rejects(regradeReceipt({ receipt: o.receipt, skill: o.skill, answers,
      judgeModel: 'haiku', samples: SAMPLES, opts: { trusted: true } }), (e) => {
      assert.equal(e.code, 'REGRADE_REFUSED'); assert.ok(e.message.length < 2048); return true;
    });
    assert.equal(calls.length, 0);
  }
  for (const identity of [Array(129).fill(MODEL), Array(1000000).fill(MODEL), ['x'.repeat(257)], [42], [{}], {}, ['bad id'], ['bad\nidentity'], ['é'], ['']]) {
    await refused(o, (a) => reply(a, { reportedModels: identity }), o.receipt, (e) => assert.ok(e.message.length < 2048));
    assert.equal(calls.length, SAMPLES);
  }
  await refused(o, (a) => reply(a, { servedModel: 'x'.repeat(257) }));
});

test('AC-23 oversized and malformed archives refuse before reading or parsing', async () => {
  const o = await original(), dir = tmp(), huge = path.join(dir, 'huge.json');
  const fd = fs.openSync(huge, 'w'); fs.ftruncateSync(fd, 2 ** 31); fs.closeSync(fd);
  const { readAnswers } = R('lib/regrade.js');
  for (const file of [huge, dir]) {
    if (file === dir) fs.renameSync(huge, path.join(dir, 'answers.json'));
    assert.throws(() => readAnswers(file), (e) => { assert.equal(e.code, 'REGRADE_REFUSED'); assert.ok(e.message.length < 2048); return true; });
  }
  const legacy = tmp(); const hugeLegacy = path.join(legacy, 'one.json');
  const lf = fs.openSync(hugeLegacy, 'w'); fs.ftruncateSync(lf, 16777217); fs.closeSync(lf);
  assert.throws(() => readAnswers(legacy), (e) => e.code === 'REGRADE_REFUSED');
  const manyFiles = tmp();
  for (let i = 0; i < 4097; i += 1) fs.writeFileSync(path.join(manyFiles, i + '.json'), '{}');
  assert.throws(() => readAnswers(manyFiles), (e) => e.code === 'REGRADE_REFUSED');
  const totalDir = tmp();
  for (const name of ['a.json', 'b.json']) {
    const fd = fs.openSync(path.join(totalDir, name), 'w'); fs.ftruncateSync(fd, 9000000); fs.closeSync(fd);
  }
  assert.throws(() => readAnswers(totalDir), (e) => e.code === 'REGRADE_REFUSED');
  const malformed = path.join(tmp(), 'answers.json'); fs.writeFileSync(malformed, '{');
  assert.throws(() => readAnswers(malformed), (e) => e.code === 'REGRADE_REFUSED' && e.message.length < 2048);
  // A file that grows after its stat must not be passed to readFileSync or JSON.parse.
  const growing = path.join(tmp(), 'growing.json'); fs.writeFileSync(growing, '{}');
  const realRead = fs.readSync; let grew = false;
  fs.readSync = (...args) => { if (!grew) { grew = true; fs.truncateSync(growing, 16777217); } return realRead(...args); };
  try { assert.throws(() => readAnswers(growing), (e) => e.code === 'REGRADE_REFUSED'); }
  finally { fs.readSync = realRead; }
  const rf = path.join(o.dir, 'bounded-original.json'); fs.writeFileSync(rf, JSON.stringify(o.receipt));
  const out = path.join(tmp(), 'out');
  const result = spawn(process.execPath, [path.join(ROOT, 'bin/driftproof'), 'regrade', rf,
    '--skill', o.sk, '--answers', path.join(dir, 'answers.json'), '--judge-model', 'haiku',
    '--trusted-skill', '--out', out], { encoding: 'utf8', timeout: 1800000, env: cliEnv({}) });
  assert.equal(result.status, 2); assert.ok(Buffer.byteLength(result.stderr) < 2048);
  assert.deepEqual(fs.existsSync(out) ? fs.readdirSync(out) : [], []);
});

test('AC-24 reported ids preserve dates, lexical ordering and duplicates only in sample evidence', async () => {
  const o = await original();
  const out = await grade(o, (a, n) => reply(a, { reportedModels: n % 2 ? [IDS[1], IDS[1]] : [IDS[0], MODEL, IDS[0]] }));
  assert.deepEqual(out.receipt.run.judge.reported_models, [MODEL, ...IDS], 'reported judge ids are unique and lexically sorted');
  assert.deepEqual(draws(out.receipt)[0].judge_sample_evidence[0].reported_models, [IDS[1], IDS[1]]);
  assert.deepEqual(draws(out.receipt)[0].judge_sample_evidence[1].reported_models, [IDS[0], MODEL, IDS[0]]);
});

test('AC-23 command bounds malformed and oversized judge identities', async () => {
  const o = await original(), rf = path.join(o.dir, 'identity-original.json'), af = path.join(o.dir, 'identity-answers.json');
  fs.writeFileSync(rf, JSON.stringify(o.receipt)); fs.writeFileSync(af, JSON.stringify({ answers: o.answers }));
  for (const identity of ['many', 'huge', 'malformed', 'nonarray', 'nonstring']) {
    const dir = tmp(), out = path.join(dir, 'out'), log = path.join(dir, 'calls.txt');
    const r = spawn(process.execPath, [path.join(ROOT, 'bin/driftproof'), 'regrade', rf, '--skill', o.sk,
      '--answers', af, '--judge-model', 'haiku', '--samples', String(SAMPLES), '--trusted-skill', '--out', out],
      { encoding: 'utf8', timeout: 1800000, env: cliEnv({ NODE_OPTIONS: '--require ' + preload(dir), SPEC212_CALLS: log, SPEC212_IDENTITY: identity }) });
    assert.equal(r.status, 5, r.stderr); assert.ok(Buffer.byteLength(r.stderr) < 2048);
    assert.deepEqual(fs.existsSync(out) ? fs.readdirSync(out) : [], []);
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, SAMPLES, 'bounded identity refusal stops after its batch');
  }
});

test('AC-21 timeout metadata cannot erase endpoint attempts or logical calls', async () => {
  const o = await original(); attemptSchedule = () => 3;
  try {
    const out = await grade(o, () => { throw Object.assign(timeoutReply(), { attempts: 0 }); });
    const attempts = calls.reduce((n, c) => n + c.attempts, 0);
    assert.equal(out.calls, attempts, 'timeout metadata cannot erase actual endpoint attempts');
    assert.equal(out.receipt.run.regrade.judge_attempts, attempts);
    assert.equal(out.receipt.run.regrade.judge_logical_calls, calls.length, 'timeout metadata cannot erase actual logical calls');
  } finally { attemptSchedule = () => 1; }
});


test('AC-25 stub and model regrades retain the budget hard-stop with independent attempt counts', async () => {
  const o = await original();
  const { BudgetTracker, perCallCostUSD } = R('lib/cost.js');
  const cost = perCallCostUSD(MODEL, 'judge');
  try {
    for (const timedOut of [false, true]) {
      process.env.DRIFTPROOF_STUB = '1';
      choose = timedOut ? () => { throw timeoutReply(); }
        : (a) => reply(a, { answeredBy: 'stub', surface: 'stub', reportedModels: null });
      calls = [];
      const budget = new BudgetTracker(1); budget.hardCap = 0;
      await assert.rejects(regradeReceipt({ receipt: o.receipt, skill: o.skill, answers: o.answers,
        judgeModel: 'haiku', samples: SAMPLES, opts: { trusted: true, budget } }), (e) => {
        assert.equal(e.code, 'BUDGET_HARDSTOP');
        assert.equal(e.callsMade, 0, 'stub hard-stop records zero endpoint attempts');
        assert.equal(e.attemptsMade, 0);
        assert.equal(e.logicalCallsMade, SAMPLES, 'stub hard-stop counts canned samples');
        assert.equal(e.drawsJudged, 1);
        return true;
      }, 'stub batch must cross the budget hard-stop');
      assert.equal(calls.length, SAMPLES, 'no later draw runs after the budget hard-stop');
      assert.equal(budget.spent, Math.round(cost * SAMPLES * 1e4) / 1e4);
    }
    // A successful stub charges every canned sample while its endpoint count remains zero.
    const budget = new BudgetTracker(1);
    choose = (a) => reply(a, { answeredBy: 'stub', surface: 'stub', reportedModels: null }); calls = [];
    const out = await regradeReceipt({ receipt: o.receipt, skill: o.skill, answers: o.answers,
      judgeModel: 'haiku', samples: SAMPLES, opts: { trusted: true, budget } });
    const expected = new BudgetTracker(1);
    for (const d of draws(o.receipt)) expected.add(cost * SAMPLES);
    assert.equal(budget.spent, expected.spent);
    assert.equal(out.calls, 0); assert.equal(out.receipt.run.regrade.judge_attempts, 0);
    assert.equal(out.receipt.run.regrade.judge_logical_calls, calls.length);
    assert.equal(out.receipt.verification_level, 'UNVERIFIED');
    delete process.env.DRIFTPROOF_STUB;
    // The same budget uses observed retries on a model surface, despite false returned metadata.
    for (const timedOut of [false, true]) {
      attemptSchedule = () => 3;
      choose = timedOut ? () => { throw Object.assign(timeoutReply(), { attempts: 0 }); }
        : (a) => reply(a, { attempts: 0 }); calls = [];
      const budget = new BudgetTracker(1); budget.hardCap = 0;
      await assert.rejects(regradeReceipt({ receipt: o.receipt, skill: o.skill, answers: o.answers,
        judgeModel: 'haiku', samples: SAMPLES, opts: { trusted: true, budget } }), (e) => {
        assert.equal(e.code, 'BUDGET_HARDSTOP');
        assert.equal(e.callsMade, calls.reduce((n, c) => n + c.attempts, 0));
        assert.equal(e.logicalCallsMade, SAMPLES); return true;
      });
      assert.equal(calls.length, SAMPLES);
      assert.equal(budget.spent, Math.round(cost * SAMPLES * 3 * 1e4) / 1e4);
    }
  } finally { delete process.env.DRIFTPROOF_STUB; choose = null; attemptSchedule = () => 1; }
});

test('AC-25 command stub budget hard-stop exits 3 and writes no output', async () => {
  const o = await original(), dir = tmp(), out = path.join(dir, 'out');
  const rf = path.join(dir, 'original.json'), af = path.join(dir, 'answers.json');
  fs.writeFileSync(rf, JSON.stringify(o.receipt)); fs.writeFileSync(af, JSON.stringify({ answers: o.answers }));
  const pre = path.join(dir, 'budget.cjs');
  fs.writeFileSync(pre, "const path = require('node:path'); const c = require(path.join(process.env.SPEC212_ROOT, 'lib/cost.js')); const Tracker = c.BudgetTracker; c.BudgetTracker = class extends Tracker { constructor(cap) { super(cap); this.hardCap = 0; } };\n");
  const r = spawn(process.execPath, [path.join(ROOT, 'bin/driftproof'), 'regrade', rf,
    '--skill', o.sk, '--answers', af, '--judge-model', 'haiku', '--samples', String(SAMPLES),
    '--trusted-skill', '--out', out], { encoding: 'utf8', timeout: 1800000, cwd: dir,
    env: cliEnv({ DRIFTPROOF_STUB: '1', NODE_OPTIONS: '--require ' + pre }) });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /ABORT \(budget hard-stop\)/);
  assert.deepEqual(fs.existsSync(out) ? fs.readdirSync(out) : [], [], 'no receipt, summary or sidecar');
});
