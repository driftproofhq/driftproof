// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 185 (issue 179): a case may list weighted criteria; the judge decides each one,
// and the code computes the weighted total and the pass. Each run goes through lib/run.js
// runSkillOnModel, its judgeCase, lib/judge.js gradeSamples and lib/receipt.js's writer, offline.
//
//   node --test tests/judge-criteria.test.js
//
// THE MODEL DOUBLE is the one tests/substrate-auxiliary.test.js uses: child_process.spawn replaced on
// the module object lib/provider.js calls it through, so nothing is spawned and no model is called. A
// generation call is answered with GEN_TEXT; a judge call (its prompt asks for a strict JSON object) is
// answered with the text the test's REPLY gives. spawnSync is replaced too, so the harness version
// read spawns nothing.
//
// SPEC185_ROOT names another tree to load lib/ from (the gate's copy of the Base, or a planted copy);
// the default is this repository. AC-5 also loads the Base's lib/ beside it, taken by git archive at
// the Base spec 185's header names into a directory under the system temp directory, never the tree.
//
// Every test name starts with the criterion it checks; spec 185's gate selects by that prefix.

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
const ROOT = process.env.SPEC185_ROOT ? path.resolve(process.env.SPEC185_ROOT) : REPO;
const SPEC = path.join(REPO, 'specs', '185-criterion-judgments', 'spec.md');
const OLD_RECEIPT = path.join(REPO, 'docs', 'reports', '011', 'amendment-1', 'documentation-and-adrs-claude-opus-5-regrade-claude-opus-5-2026-09-24.json');

const realExecFileSync = cp.execFileSync;
const calls = [];
const JUDGE = /Return ONLY this JSON object/;
const GEN_TEXT = 'A decision record: context, the decision, its consequences.';
const FREE_REPLY = JSON.stringify({ score: 0.8, pass: true, reason: 'double' });
let REPLY = () => FREE_REPLY;
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
        const result = call.judge ? REPLY(call.input) : GEN_TEXT;
        c.stdout.end(JSON.stringify({ type: 'result', result, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 100 }, modelUsage: { [String(req).replace(/-\d{8}$/, '')]: { inputTokens: 10, outputTokens: 40, cacheReadInputTokens: 100, cacheCreationInputTokens: 0 } } }));
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
  judge: require(path.join(root, 'lib', 'judge.js')),
  skill: require(path.join(root, 'lib', 'skill.js')),
  stale: require(path.join(root, 'lib', 'stale.js')),
});
const lib = libOf(ROOT);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SYS = '---\nname: fx\n---\nWrite the ADR.';
const PROMPT = 'Write an ADR choosing a database.';
const RUBRIC = 'A complete ADR with context, decision and consequences.';
// One case, as a suite file would carry it.
const caseOf = (extra = {}) => ({ id: 'adr-1', prompt: PROMPT, rubric: RUBRIC, pass_threshold: 0.75, ...extra });
const FOUR = [
  { id: 'context', weight: 1, description: 'States the context that forces the decision.' },
  { id: 'decision', weight: 1, description: 'States the decision in one sentence.' },
  { id: 'consequences', weight: 1, description: 'Lists the consequences, good and bad.' },
  { id: 'alternatives', weight: 1, description: 'Names at least one alternative considered.' },
];
// The skill the runner is given, its suite normalised and hashed by the tree under test.
function skillOf(l, raw) {
  const { cases, suiteHash } = l.skill.suiteIdentity(raw);
  return { name: 'fx-adr', version: '1.0.0', contentHash: sha(SYS), skillMd: SYS, suite: { format: 'agentskills.io/evals', suiteHash, caseCount: cases.length, cases } };
}
const OPTS = { samples: 2, trusted: true, judgeModel: 'haiku', nowIso: '2026-10-10T12:00:00.000Z' };
async function run(l, raw, reply, opts = {}) {
  REPLY = typeof reply === 'function' ? reply : () => reply;
  calls.length = 0;
  return l.run.runSkillOnModel({ skill: skillOf(l, raw), model: 'claude-opus-5-5', opts: { ...OPTS, ...opts } });
}
const judgments = (list, extra = {}) => JSON.stringify({ judgments: list.map(([id, decision, reason]) => ({ id, decision, reason: reason || `${id} ${decision}` })), ...extra });
const drawsOf = (r) => r.results.cases.flatMap((c) => c.generation.draws);

// A run whose clock reads one instant throughout, so two runs of one suite write the same bytes.
async function frozen(fn) {
  const Real = Date;
  const T = Real.parse(OPTS.nowIso);
  global.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } };
  try { return await fn(); } finally { global.Date = Real; }
}

// The Base's lib/, config and schemas, by git archive, beside a link to this tree's node_modules. The
// receipt records the runner version, which a release bump moves away from the Base's; it is an input,
// not the subject, so the copy's config.js is given the tree under test's RUNNER_VERSION (as spec 180
// A-180-1 does) and every other byte is still compared.
function baseTree() {
  const m = /^\*\*Base:\*\* `[^`]*` at `([0-9a-f]{40})`/m.exec(fs.readFileSync(SPEC, 'utf8'));
  assert.ok(m, 'spec 185 names no Base');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec185-base-'));
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

// ── AC-1, the suite field ──────────────────────────────────────────────────────────────────────────

test('AC-1 a criteria case loads with its criteria as given, and needs no rubric', () => {
  const [c] = lib.skill.normalizeCases([caseOf({ criteria: FOUR })]);
  assert.deepEqual(c.criteria, FOUR);
  const [bare] = lib.skill.normalizeCases([{ id: 'x', prompt: PROMPT, criteria: [{ id: 'a', weight: 2, description: 'A.', note: 'not carried' }] }]);
  assert.deepEqual(bare.criteria, [{ id: 'a', weight: 2, description: 'A.' }]);
  assert.equal(bare.rubric, '');
});

// A-185-2: an empty list and a list with no object in it are not criteria lists (AC-11 reads them on
// dev's path); a list that mixes objects and other entries is refused.
test('AC-1 a criteria list that breaks a rule is refused with BAD_CRITERIA, naming the case', () => {
  const bad = {
    duplicate: [{ id: 'a', weight: 1, description: 'A.' }, { id: 'a', weight: 1, description: 'B.' }],
    'zero weight': [{ id: 'a', weight: 0, description: 'A.' }],
    'negative weight': [{ id: 'a', weight: -1, description: 'A.' }],
    'string weight': [{ id: 'a', weight: '1', description: 'A.' }],
    'empty description': [{ id: 'a', weight: 1, description: '' }],
    'mixed objects and strings': [{ id: 'a', weight: 1, description: 'A.' }, 'b'],
  };
  for (const [what, criteria] of Object.entries(bad)) {
    assert.throws(() => lib.skill.normalizeCases([caseOf({ criteria })]), (e) => e.code === 'BAD_CRITERIA' && /case "adr-1"/.test(e.message), what);
  }
});

test('AC-1 weights whose sum is not finite are refused, naming the sum (A-185-1)', () => {
  const criteria = [{ id: 'a', weight: 1e308, description: 'A.' }, { id: 'b', weight: 1e308, description: 'B.' }];
  assert.throws(() => lib.skill.normalizeCases([caseOf({ criteria })]), (e) => e.code === 'BAD_CRITERIA' && /case "adr-1"/.test(e.message) && /weights sum to Infinity/.test(e.message));
  const [ok] = lib.skill.normalizeCases([caseOf({ criteria: [{ id: 'a', weight: 1e308, description: 'A.' }, { id: 'b', weight: 1, description: 'B.' }] })]);
  assert.equal(ok.criteria.length, 2);
});

test('AC-1 an id that is not 1 to 64 of A-Z, a-z, 0-9, underscore, dot and hyphen is refused, naming the entry (A-185-4)', () => {
  const at = (id) => [{ id: 'ok', weight: 1, description: 'A.' }, { id, weight: 1, description: 'B.' }];
  for (const [what, id] of Object.entries({ newline: 'a\n- forged: line', '65 characters': 'x'.repeat(65), space: 'a b', empty: '' })) {
    assert.throws(() => lib.skill.normalizeCases([caseOf({ criteria: at(id) })]), (e) => e.code === 'BAD_CRITERIA' && /case "adr-1"/.test(e.message) && /entry 2/.test(e.message), what);
  }
  const [c] = lib.skill.normalizeCases([caseOf({ criteria: at('A_z.0-' + 'x'.repeat(58)) })]);
  assert.equal(c.criteria[1].id.length, 64);
});

test('AC-1 an edit to one weight, one description or one id moves the suite hash', () => {
  const h = (criteria) => lib.skill.suiteIdentity([caseOf({ criteria })]).suiteHash;
  const base = h(FOUR);
  assert.notEqual(base, lib.skill.suiteIdentity([caseOf()]).suiteHash);
  const edit = (i, k, v) => FOUR.map((x, j) => (j === i ? { ...x, [k]: v } : x));
  assert.notEqual(h(edit(0, 'weight', 2)), base);
  assert.notEqual(h(edit(1, 'description', 'Another.')), base);
  assert.notEqual(h(edit(2, 'id', 'effects')), base);
});

test('AC-1 a string criteria is still the rubric', () => {
  const [c] = lib.skill.normalizeCases([{ id: 'x', prompt: PROMPT, criteria: 'The rubric, by another name.' }]);
  assert.equal(c.rubric, 'The rubric, by another name.');
  assert.equal(c.criteria, undefined);
});

// ── AC-2, the three demonstration faults ───────────────────────────────────────────────────────────

test('AC-2 (a) every criterion met with the reply\'s score 0.875 computes 1.0, and the score is recorded as ignored', async () => {
  const reply = judgments(FOUR.map((x) => [x.id, 'met']), { score: 0.875, pass: true });
  const { receipt } = await run(lib, [caseOf({ criteria: FOUR })], reply);
  const draws = drawsOf(receipt);
  assert.ok(draws.length >= 2 && draws.every((d) => d.status === 'measured'), 'every draw measured');
  for (const d of draws) {
    assert.deepEqual(d.samples, [1, 1]);
    assert.equal(d.criteria_judgments.length, 2);
    for (const j of d.criteria_judgments) {
      assert.equal(j.total, 1);
      assert.equal(j.pass, true);
      assert.deepEqual(j.ignored, ['pass', 'score']);
      assert.deepEqual(j.judgments, FOUR.map((x) => ({ id: x.id, decision: 'met' })));
    }
  }
  assert.ok(receipt.results.cases.every((c) => c.mean === 1 && c.outcome === 'pass'));
});

test('AC-2 (b) a reply\'s pass true under the threshold computes fail', async () => {
  const criteria = [{ id: 'context', weight: 5, description: 'States the context.' }, { id: 'decision', weight: 3, description: 'States the decision.' }];
  const reply = judgments([['context', 'met'], ['decision', 'not_met']], { score: 0.9, pass: true });
  const { receipt } = await run(lib, [caseOf({ criteria })], reply);
  for (const d of drawsOf(receipt)) {
    assert.deepEqual(d.samples, [0.625, 0.625]);
    assert.ok(d.criteria_judgments.every((j) => j.total === 0.625 && j.pass === false));
  }
  for (const c of receipt.results.cases) {
    assert.equal(c.mean, 0.625);
    assert.equal(c.outcome, 'fail');
  }
});

test('AC-2 (c) a met decision with a reason that says the answer missed it: the total follows the decision, and the reason is kept verbatim', async () => {
  const criteria = [{ id: 'cites-source', weight: 1, description: 'Cites the benchmark it relies on.' }];
  const said = 'The response does not cite the benchmark, so this is not satisfied.';
  const reply = judgments([['cites-source', 'met', said]]);
  const { receipt, transcripts } = await run(lib, [caseOf({ criteria })], reply, { keepTranscripts: true });
  assert.ok(drawsOf(receipt).every((d) => d.samples.every((s) => s === 1)));
  const kept = transcripts.filter(Boolean);
  assert.ok(kept.length >= 2);
  for (const t of kept) {
    for (const s of t.criteria_samples) {
      assert.equal(s.judgments[0].reason, said);
      assert.equal(s.judgments[0].decision, 'met');
      assert.ok(s.raw.includes(said));
    }
  }
});

test('AC-2 keys inside an entry beyond id, decision and reason are not read, and are recorded as ignored by criterion (A-185-5)', async () => {
  const reply = JSON.stringify({
    judgments: FOUR.map((x) => (x.id === 'context' ? { id: x.id, decision: 'met', reason: 'r', weight: 99 } : { id: x.id, decision: x.id === 'alternatives' ? 'not_met' : 'met', reason: 'r', ...(x.id === 'decision' ? { score: 1 } : {}) })),
    score: 1,
  });
  const { receipt } = await run(lib, [caseOf({ criteria: FOUR })], reply);
  for (const d of drawsOf(receipt)) {
    assert.deepEqual(d.samples, [0.75, 0.75]);
    for (const j of d.criteria_judgments) assert.deepEqual(j.ignored, ['judgments[context].weight', 'judgments[decision].score', 'score']);
  }
});

// ── AC-3, malformed replies are unmeasured ─────────────────────────────────────────────────────────

test('AC-3 one bad judge sample among good ones makes the whole draw unmeasured, naming it, and no sample enters a statistic', async () => {
  const criteria = [{ id: 'a', weight: 1, description: 'A.' }, { id: 'b', weight: 1, description: 'B.' }];
  let k = 0;
  const reply = () => (k++ % 2 === 0 ? judgments([['a', 'met'], ['b', 'met']]) : judgments([['a', 'met']]));
  const { receipt } = await run(lib, [caseOf({ criteria })], reply);
  const draws = drawsOf(receipt);
  assert.ok(draws.length >= 1);
  for (const d of draws) {
    assert.equal(d.status, 'unmeasured');
    assert.deepEqual(d.samples, []);
    assert.equal(d.mean, null);
    assert.match(d.reason, /no judgment for criterion "b"/);
    assert.equal(d.judge_sample_hashes.length, 2, 'both judge calls are recorded by hash');
    assert.ok(!('criteria_judgments' in d));
  }
  assert.ok(receipt.results.cases.every((c) => c.case_status === 'failed_unmeasured'));
});

test('AC-3 a missing, duplicate, unknown or malformed entry, a decision outside the set and no list each make the draw unmeasured with a reason naming it', async () => {
  const criteria = [{ id: 'a', weight: 1, description: 'A.' }, { id: 'b', weight: 1, description: 'B.' }];
  const faults = {
    missing: [judgments([['a', 'met']]), /no judgment for criterion "b"/],
    duplicate: [judgments([['a', 'met'], ['a', 'not_met'], ['b', 'met']]), /judged criterion "a" more than once/],
    unknown: [judgments([['a', 'met'], ['b', 'met'], ['z', 'met']]), /judgment 3 names unknown criterion "z"/],
    'malformed entry': [JSON.stringify({ judgments: ['a', { id: 'b', decision: 'met' }] }), /judgment 1 is malformed/],
    'malformed id': [JSON.stringify({ judgments: [{ id: 7, decision: 'met' }, { id: 'b', decision: 'met' }] }), /judgment 1 is malformed/],
    partial: [judgments([['a', 'partial'], ['b', 'met']]), /decision "partial" for criterion "a" is not one of met, not_met/],
    'no list': [JSON.stringify({ score: 1, pass: true, reason: 'all good' }), /carries no judgments list/],
  };
  for (const [what, [reply, why]] of Object.entries(faults)) {
    const { receipt } = await run(lib, [caseOf({ criteria })], reply);
    const draws = drawsOf(receipt);
    assert.ok(draws.length >= 1 && draws.every((d) => d.status === 'unmeasured' && d.samples.length === 0 && d.mean === null), `${what}: every draw unmeasured`);
    assert.ok(draws.every((d) => why.test(d.reason)), `${what}: ${draws.map((d) => d.reason).join(' | ')}`);
    assert.ok(draws.every((d) => !('criteria_judgments' in d)), `${what}: an unmeasured draw records judgments`);
    for (const c of receipt.results.cases) {
      assert.equal(c.case_status, 'failed_unmeasured', what);
      assert.match(c.reason, why, what);
    }
    assert.equal(receipt.results.aggregates.with_skill.case_count, 0, what);
  }
});

// ── AC-4, weights ──────────────────────────────────────────────────────────────────────────────────

test('AC-4 weights 3, 1 and 1 with the first and third met give 0.8 on the receipt', async () => {
  const criteria = [{ id: 'a', weight: 3, description: 'A.' }, { id: 'b', weight: 1, description: 'B.' }, { id: 'c', weight: 1, description: 'C.' }];
  const { receipt } = await run(lib, [caseOf({ criteria })], judgments([['a', 'met'], ['b', 'not_met'], ['c', 'met']]));
  assert.ok(drawsOf(receipt).every((d) => d.samples.every((s) => s === 0.8)));
  assert.ok(receipt.results.cases.every((c) => c.mean === 0.8 && c.samples.every((s) => s === 0.8)));
});

test('AC-4 weights 0.1, 0.2 and 0.7 with the first two met give exactly 0.3', async () => {
  const criteria = [{ id: 'a', weight: 0.1, description: 'A.' }, { id: 'b', weight: 0.2, description: 'B.' }, { id: 'c', weight: 0.7, description: 'C.' }];
  const { receipt } = await run(lib, [caseOf({ criteria })], judgments([['a', 'met'], ['b', 'met'], ['c', 'not_met']]));
  assert.ok(drawsOf(receipt).every((d) => d.samples.every((s) => s === 0.3)), JSON.stringify(drawsOf(receipt).map((d) => d.samples)));
});

test('AC-4 judge samples that disagree: each draw\'s mean and sd are of the totals, and criteria_judgments keep sample order', async () => {
  let k = 0;
  const reply = () => (k++ % 2 === 0
    ? judgments(FOUR.map((x) => [x.id, 'met']))
    : judgments(FOUR.map((x) => [x.id, x.id === 'alternatives' ? 'not_met' : 'met'])));
  const { receipt } = await run(lib, [caseOf({ criteria: FOUR })], reply);
  const draws = drawsOf(receipt);
  assert.ok(draws.length >= 2);
  for (const d of draws) {
    assert.deepEqual(d.samples, [1, 0.75]);
    assert.equal(d.mean, 0.875);
    assert.equal(d.stddev, 0.176777);
    assert.deepEqual(d.criteria_judgments.map((j) => j.total), d.samples);
    assert.deepEqual(d.criteria_judgments[1].judgments.find((j) => j.id === 'alternatives'), { id: 'alternatives', decision: 'not_met' });
  }
});

test('AC-4 ids that are prototype keys grade by their own weights, and a missing one is named', async () => {
  const criteria = [{ id: '__proto__', weight: 2, description: 'A.' }, { id: 'constructor', weight: 1, description: 'B.' }, { id: 'toString', weight: 1, description: 'C.' }];
  const [c] = lib.skill.normalizeCases([caseOf({ criteria })]);
  assert.deepEqual(c.criteria.map((x) => x.id), ['__proto__', 'constructor', 'toString']);
  const { receipt } = await run(lib, [caseOf({ criteria })], judgments([['__proto__', 'met'], ['constructor', 'not_met'], ['toString', 'met']]));
  for (const d of drawsOf(receipt)) {
    assert.deepEqual(d.samples, [0.75, 0.75]);
    assert.deepEqual(d.criteria_judgments[0].judgments.map((j) => j.id), ['__proto__', 'constructor', 'toString']);
  }
  const missing = await run(lib, [caseOf({ criteria })], judgments([['constructor', 'met'], ['toString', 'met']]));
  assert.ok(drawsOf(missing.receipt).every((d) => d.status === 'unmeasured' && /no judgment for criterion "__proto__"/.test(d.reason)));
});

// ── AC-5, the free-text path is byte-identical ─────────────────────────────────────────────────────

test('AC-5 a suite with no criteria case writes a receipt byte-identical to the Base\'s, with the same suite hash, prompt and rubric hash', async () => {
  const dir = baseTree();
  try {
    const base = libOf(dir);
    const raw = [caseOf(), { id: 'adr-2', prompt: 'Write an ADR choosing a queue.', criteria: 'A string criteria is the rubric.', threshold: 0.6 }];
    assert.equal(lib.skill.suiteIdentity(raw).suiteHash, base.skill.suiteIdentity(raw).suiteHash);
    const slots = { task: PROMPT, response: GEN_TEXT, rubric: RUBRIC };
    assert.equal(lib.judge.buildJudgePrompt(slots), base.judge.buildJudgePrompt(slots));
    assert.equal(lib.judge.rubricHash(RUBRIC), base.judge.rubricHash(RUBRIC));
    assert.equal(lib.judge.promptTemplateHash(), base.judge.promptTemplateHash());
    const mine = await frozen(() => run(lib, raw, FREE_REPLY));
    const theirs = await frozen(() => run(base, raw, FREE_REPLY));
    assert.ok(drawsOf(mine.receipt).every((d) => !('criteria_judgments' in d)));
    // The clock is the only input that moves between two runs; with it fixed, a second run of this
    // tree writes the same bytes, so a difference from the Base is the code's.
    const again = await frozen(() => run(lib, raw, FREE_REPLY));
    assert.equal(JSON.stringify(again.receipt), JSON.stringify(mine.receipt), 'two runs of this tree differ: the comparison would not be about the code');
    assert.equal(JSON.stringify(mine.receipt), JSON.stringify(theirs.receipt));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC-6, the retained record ──────────────────────────────────────────────────────────────────────

test('AC-6 a criteria run keeps, per judge sample, the raw reply beside its judgments, total, pass and ignored keys', async () => {
  const reply = judgments([['context', 'met', 'Context is stated.'], ['decision', 'not_met', 'No decision sentence.'], ['consequences', 'met'], ['alternatives', 'met']], { total: 1 });
  const { receipt, transcripts } = await run(lib, [caseOf({ criteria: FOUR })], reply, { keepTranscripts: true });
  const kept = transcripts.filter(Boolean);
  assert.equal(kept.length, 2);
  for (const t of kept) {
    const row = receipt.results.cases.find((c) => c.id === t.id && c.mode === t.mode);
    assert.equal(t.criteria_samples.length, 2);
    t.criteria_samples.forEach((s, i) => {
      assert.equal(s.raw, t.judge_outputs[i]);
      assert.equal(sha(s.raw), row.judge_sample_hashes[i]);
      assert.equal(s.total, 0.75);
      assert.equal(s.pass, true);
      assert.deepEqual(s.ignored, ['total']);
      assert.deepEqual(s.judgments[1], { id: 'decision', decision: 'not_met', reason: 'No decision sentence.' });
    });
    const rec = lib.run.transcriptRecord(t);
    assert.deepEqual(rec.criteria_samples, t.criteria_samples);
  }
});

test('AC-6 the record of a case without criteria is exactly the Base\'s four keys', async () => {
  const { transcripts } = await run(lib, [caseOf()], FREE_REPLY, { keepTranscripts: true });
  for (const t of transcripts.filter(Boolean)) {
    assert.deepEqual(Object.keys(lib.run.transcriptRecord(t)), ['id', 'mode', 'generation', 'judge_outputs']);
  }
});

// ── AC-7, the rubric hash ──────────────────────────────────────────────────────────────────────────

test('AC-7 the criteria enter the case rubric hash, which the row, and stale\'s current side, both give', async () => {
  const [c] = lib.skill.normalizeCases([caseOf({ criteria: FOUR })]);
  const h = lib.judge.caseRubricHash(c);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.notEqual(h, lib.judge.rubricHash(RUBRIC));
  const moved = (k, v) => lib.judge.caseRubricHash({ ...c, criteria: c.criteria.map((x, j) => (j === 0 ? { ...x, [k]: v } : x)) });
  assert.notEqual(moved('weight', 4), h);
  assert.notEqual(moved('description', 'Another.'), h);
  assert.notEqual(moved('id', 'why'), h);
  const [free] = lib.skill.normalizeCases([caseOf()]);
  assert.equal(lib.judge.caseRubricHash(free), lib.judge.rubricHash(RUBRIC));
  const { receipt } = await run(lib, [caseOf({ criteria: FOUR })], judgments(FOUR.map((x) => [x.id, 'met'])));
  assert.ok(receipt.results.cases.every((r) => r.judge.rubric_hash === h));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec185-suite-'));
  try {
    const file = path.join(dir, 'evals.json');
    fs.writeFileSync(file, JSON.stringify([caseOf({ criteria: FOUR })]));
    const { prov } = lib.stale.currentProvenance(receipt, { suite: file, noHarnessCheck: true, model: 'claude-opus-5-5', judge: 'haiku' }, {});
    assert.equal(prov.rubrics['adr-1'], h);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC-8, the regrade ──────────────────────────────────────────────────────────────────────────────

test('AC-8 a criteria regrade of retained answers makes no generation call, and its draws carry the judgments', async () => {
  const raw = [caseOf({ criteria: FOUR })];
  const { receipt } = await run(lib, raw, judgments(FOUR.map((x) => [x.id, 'met'])));
  const answers = {};
  for (const d of drawsOf(receipt)) answers[d.generation_hash] = GEN_TEXT;
  const skill = skillOf(lib, raw);
  REPLY = () => judgments([['context', 'met'], ['decision', 'met'], ['consequences', 'not_met'], ['alternatives', 'met']], { score: 0.5 });
  calls.length = 0;
  const out = await lib.regrade.regradeReceipt({ receipt, skill, answers, judgeModel: 'haiku', samples: 3, opts: { trusted: true } });
  const draws = drawsOf(out.receipt);
  assert.equal(calls.filter((c) => !c.judge).length, 0, 'the regrade made a generation call');
  assert.equal(calls.filter((c) => c.judge).length, draws.length * 3);
  assert.ok(draws.length >= 2 && draws.every((d) => d.status === 'measured'));
  for (const d of draws) {
    assert.deepEqual(d.samples, [0.75, 0.75, 0.75]);
    assert.equal(d.criteria_judgments.length, 3);
    assert.ok(d.criteria_judgments.every((j) => j.total === 0.75 && j.pass === true && j.ignored.join() === 'score'));
  }
  assert.ok(out.receipt.run.grader_revision.rubric_hashes.every((x) => x === lib.judge.caseRubricHash(skill.suite.cases[0])));
  const v = lib.receipt.validateReceipt(out.receipt);
  assert.ok(v.valid, JSON.stringify(v.errors));
  assert.ok(lib.receipt.verifyReceiptHash(out.receipt));
});

// ── AC-9, receipts validate ────────────────────────────────────────────────────────────────────────

test('AC-9 a criteria receipt validates under schema version 0.11', async () => {
  const { receipt } = await run(lib, [caseOf({ criteria: FOUR })], judgments(FOUR.map((x) => [x.id, 'met'])));
  assert.equal(receipt.schema_version, '0.11');
  assert.ok(drawsOf(receipt).every((d) => Array.isArray(d.criteria_judgments)));
  const v = lib.receipt.validateReceipt(receipt);
  assert.ok(v.valid, JSON.stringify(v.errors));
  assert.ok(lib.receipt.verifyReceiptHash(receipt));
});

test('AC-9 older receipt: a tracked published v0.7 receipt still validates against its own schema, and its hash verifies', () => {
  const old = JSON.parse(fs.readFileSync(OLD_RECEIPT, 'utf8'));
  assert.equal(old.schema_version, '0.7');
  const v = lib.receipt.validateReceipt(old);
  assert.ok(v.valid, JSON.stringify(v.errors));
  assert.ok(lib.receipt.verifyReceiptHash(old));
});

// ── AC-13, a rubric regrade of a criteria case (A-185-8) ───────────────────────────────────────────

// A skill directory on disk (a rubric regrade reads the original suite as written from it), its run on
// the double, and its kept answers. Every generation is GEN_TEXT, so every answer is that text.
async function criteriaOriginal(cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec185-rubric-'));
  fs.mkdirSync(path.join(dir, 'skill', 'evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skill', 'SKILL.md'), SYS);
  fs.writeFileSync(path.join(dir, 'skill', 'evals', 'evals.json'), JSON.stringify({ cases }, null, 2));
  const skill = lib.skill.loadSkill(path.join(dir, 'skill'));
  REPLY = (prompt) => decide(prompt, []);
  calls.length = 0;
  const { receipt } = await lib.run.runSkillOnModel({ skill, model: 'claude-opus-5-5', opts: OPTS });
  const answers = {};
  for (const d of drawsOf(receipt)) if (d.generation_hash) answers[d.generation_hash] = GEN_TEXT;
  const revisedFile = (rc) => { const f = path.join(dir, `revised-${crypto.randomUUID()}.json`); fs.writeFileSync(f, JSON.stringify({ cases: rc })); return f; };
  return { dir, skill, receipt, answers, revisedFile };
}
// A judge reply to whatever prompt it is given: for a criteria prompt, one entry per criterion the
// prompt lists, `met` but for the ids in notMet; for a free-text prompt, the free-text reply.
function decide(prompt, notMet) {
  const at = prompt.indexOf('CRITERIA (decide each one on its own):');
  if (at < 0) return FREE_REPLY;
  const ids = [...prompt.slice(at).matchAll(/^- ([A-Za-z0-9_.-]+): /gm)].map((m) => m[1]);
  return judgments(ids.map((id) => [id, notMet.includes(id) ? 'not_met' : 'met']));
}
const plan = (o, revised) => lib.regrade.planRegrade({ receipt: o.receipt, skill: o.skill, answers: o.answers, judgeModel: 'haiku', samples: OPTS.samples, revised });
const CRIT_CASES = () => [
  { id: 'crit', prompt: PROMPT, pass_threshold: 0.75, criteria: clone185(FOUR) },
  { id: 'both', prompt: 'Write an ADR choosing a queue.', rubric: RUBRIC, pass_threshold: 0.5, criteria: [{ id: 'a', weight: 1, description: 'A.' }, { id: 'b', weight: 1, description: 'B.' }] },
];
function clone185(x) { return JSON.parse(JSON.stringify(x)); }

test('AC-13 a criteria case regraded under revised criteria: no generation call, its judgments recorded, the total by the revised weights', async () => {
  const o = await criteriaOriginal(CRIT_CASES());
  try {
    const rc = CRIT_CASES();
    // crit: a weight moved, a criterion removed, one added. both: a description and a weight moved.
    rc[0].criteria = [{ id: 'context', weight: 3, description: 'States the context.' }, FOUR[1], FOUR[2], { id: 'tradeoffs', weight: 1, description: 'Names a trade-off.' }];
    rc[1].criteria = [{ id: 'a', weight: 1, description: 'A.' }, { id: 'b', weight: 3, description: 'B, said plainly.' }];
    const revised = lib.regrade.readRevisedSuite(o.revisedFile(rc));
    assert.deepEqual(plan(o, revised).problems, []);
    REPLY = (prompt) => decide(prompt, ['decision', 'b']);
    calls.length = 0;
    const out = await lib.regrade.regradeReceipt({ receipt: o.receipt, skill: o.skill, answers: o.answers, judgeModel: 'haiku', samples: OPTS.samples, revised, opts: { trusted: true } });
    const draws = (id) => out.receipt.results.cases.filter((c) => c.id === id).flatMap((c) => c.generation.draws);
    assert.equal(calls.filter((c) => !c.judge).length, 0, 'zero executor calls');
    assert.equal(calls.filter((c) => c.judge).length, drawsOf(out.receipt).length * OPTS.samples);
    for (const [id, total, ids] of [['crit', 0.833333, ['context', 'decision', 'consequences', 'tradeoffs']], ['both', 0.25, ['a', 'b']]]) {
      assert.ok(draws(id).length >= 2);
      for (const d of draws(id)) {
        assert.equal(d.status, 'measured');
        assert.deepEqual(d.samples, [total, total], `${id}: the total by the revised weights`);
        assert.deepEqual(d.criteria_judgments[0].judgments.map((j) => j.id), ids, `${id}: judged on the revised criteria`);
      }
    }
    const hashes = out.receipt.run.grader_revision.rubric_hashes;
    out.receipt.results.cases.forEach((c, i) => {
      assert.equal(hashes[i], lib.judge.caseRubricHash(revised.cases.find((k) => k.id === c.id)));
      assert.notEqual(hashes[i], lib.judge.caseRubricHash(o.skill.suite.cases.find((k) => k.id === c.id)));
      assert.equal(c.judge.rubric_hash, hashes[i]);
    });
    assert.deepEqual(out.provenance.rubric_revision.cases_changed, [{ id: 'crit', fields: ['criteria'] }, { id: 'both', fields: ['criteria'] }]);
    assert.equal(out.receipt.suite.suite_hash, revised.suiteHash);
    const v = lib.receipt.validateReceipt(out.receipt);
    assert.ok(v.valid, JSON.stringify(v.errors));
  } finally {
    fs.rmSync(o.dir, { recursive: true, force: true });
  }
});

test('AC-13 a case that switches shape, criteria objects to a rubric alone or back, is refused naming it; every other spec 184 rule stands', async () => {
  const cases = [...CRIT_CASES(), { id: 'free', prompt: 'Write an ADR choosing a cache.', rubric: RUBRIC, pass_threshold: 0.7 }];
  const o = await criteriaOriginal(cases);
  try {
    const toRubric = clone185(cases); delete toRubric[0].criteria; toRubric[0].rubric = 'A complete ADR.';
    const toCriteria = clone185(cases); toCriteria[2].criteria = [{ id: 'a', weight: 1, description: 'A.' }];
    const prompt = clone185(cases); prompt[0].prompt = 'Write an ADR choosing a datastore.'; prompt[0].criteria[0].weight = 2;
    const threshold = clone185(cases); threshold[1].pass_threshold = 5; threshold[1].criteria[0].weight = 2;
    for (const [what, rc, why] of [
      ['criteria to a rubric', toRubric, /case crit: the case changes shape, from criteria objects in the original to a rubric in the revised case/],
      ['a rubric to criteria', toCriteria, /case free: the case changes shape, from a rubric in the original to criteria objects in the revised case/],
      ['a changed prompt beside a criteria edit', prompt, /case crit: the field prompt differs/],
      ['a threshold of 5 beside a criteria edit', threshold, /case both: pass_threshold 5 is not a number in \[0, 1\]/],
    ]) {
      calls.length = 0;
      const p = plan(o, lib.regrade.readRevisedSuite(o.revisedFile(rc))).problems;
      assert.ok(p.some((x) => why.test(x)), `${what}: ${p.join(' | ')}`);
      assert.equal(calls.length, 0, `${what}: no call`);
    }
  } finally {
    fs.rmSync(o.dir, { recursive: true, force: true });
  }
});

test('AC-13 a revised criteria list that a run would refuse (a duplicate id, a bad weight) is refused before any call, naming it', async () => {
  const o = await criteriaOriginal(CRIT_CASES());
  try {
    const good = lib.regrade.readRevisedSuite(o.revisedFile((() => { const rc = CRIT_CASES(); rc[0].criteria[0].weight = 2; return rc; })()));
    for (const [what, edit, why] of [
      ['a duplicate id', (c) => { c[0].criteria[1].id = 'context'; }, /case "crit" criteria: entry 2 repeats the id "context"/],
      ['a weight of 0', (c) => { c[1].criteria[1].weight = 0; }, /case "both" criteria: entry 2 \("b"\) has weight 0/],
    ]) {
      const rc = CRIT_CASES(); rc[0].criteria[0].weight = 2; edit(rc);
      // On load, as the CLI reads --rubric: refused by the code a run loads a suite with.
      assert.throws(() => lib.regrade.readRevisedSuite(o.revisedFile(rc)), (e) => e.code === 'BAD_CRITERIA' && why.test(e.message), what);
      // In planRegrade, for a caller that hands it the cases as written: the same check, named.
      calls.length = 0;
      const p = plan(o, { ...good, raw: rc }).problems;
      assert.ok(p.some((x) => why.test(x)), `${what}: ${p.join(' | ')}`);
      assert.equal(calls.length, 0, `${what}: no call`);
    }
  } finally {
    fs.rmSync(o.dir, { recursive: true, force: true });
  }
});

test('AC-13 old path: a case with no criteria objects regrades exactly as spec 184 has it', async () => {
  const cases = [
    { id: 'old', prompt: PROMPT, rubric: RUBRIC, pass_threshold: 0.7, criteria: ['must name the database'] },
    { id: 'free', prompt: 'Write an ADR choosing a cache.', rubric: RUBRIC, pass_threshold: 0.7 },
  ];
  // A case whose rubric was read from a list of strings: spec 184 holds its rubric key to a non-empty
  // string, so such a suite is refused whatever else changes.
  const cases2 = [
    { id: 'old2', prompt: 'Write an ADR choosing a queue.', pass_threshold: 0.7, criteria: ['must name the queue'] },
    { id: 'free', prompt: 'Write an ADR choosing a cache.', rubric: RUBRIC, pass_threshold: 0.7 },
  ];
  const o = await criteriaOriginal(cases);
  const o2 = await criteriaOriginal(cases2);
  try {
    const rc = clone185(cases); rc[0].rubric = 'A complete ADR, naming the database.'; rc[1].pass_threshold = 0.9;
    const revised = lib.regrade.readRevisedSuite(o.revisedFile(rc));
    assert.deepEqual(plan(o, revised).problems, []);
    REPLY = (prompt) => decide(prompt, []);
    calls.length = 0;
    const out = await lib.regrade.regradeReceipt({ receipt: o.receipt, skill: o.skill, answers: o.answers, judgeModel: 'haiku', samples: OPTS.samples, revised, opts: { trusted: true } });
    assert.equal(calls.filter((c) => !c.judge).length, 0);
    assert.ok(drawsOf(out.receipt).every((d) => d.status === 'measured' && !('criteria_judgments' in d)));
    assert.deepEqual(out.provenance.rubric_revision.cases_changed, [{ id: 'old', fields: ['rubric'] }, { id: 'free', fields: ['pass_threshold'] }]);
    assert.deepEqual(out.receipt.run.grader_revision.rubric_hashes, out.receipt.results.cases.map((c) => lib.judge.rubricHash(revised.cases.find((k) => k.id === c.id).rubric)));
    // A list of strings is no grading field of its own: under a rubric it is another key, and as the
    // rubric it must be a non-empty string, as spec 184 reads it.
    const other = clone185(cases); other[0].criteria = ['must name the database twice'];
    assert.ok(plan(o, lib.regrade.readRevisedSuite(o.revisedFile(other))).problems.some((x) => /case old: the field criteria differs from the original's/.test(x)));
    for (const edit of [(c) => { c[0].criteria = ['must name the queue and why']; }, (c) => { c[1].pass_threshold = 0.9; }]) {
      const asRubric = clone185(cases2); edit(asRubric);
      assert.ok(plan(o2, lib.regrade.readRevisedSuite(o2.revisedFile(asRubric))).problems.some((x) => /case old2: criteria is not a non-empty string/.test(x)));
    }
  } finally {
    fs.rmSync(o.dir, { recursive: true, force: true });
    fs.rmSync(o2.dir, { recursive: true, force: true });
  }
});

// ── AC-10, the docs ────────────────────────────────────────────────────────────────────────────────

test('AC-10 spec/RECEIPT.md states the criteria field, what a draw and a retained record carry, and what is not claimed', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'spec', 'RECEIPT.md'), 'utf8');
  const at = doc.indexOf('\n## Criteria cases');
  assert.ok(at >= 0, 'no section');
  const sec = doc.slice(at + 1, doc.indexOf('\n## ', at + 1));
  for (const want of ['`criteria`', '`criteria_judgments`', '`criteria_samples`', '`met`', '`not_met`', 'computed in code', 'ignored', 'unmeasured', 'not the judge\'s reading']) {
    assert.ok(sec.includes(want), `the section does not say ${want}`);
  }
  // A-185-2, A-185-3, A-185-5, A-185-6: what the section says about old suites, the sample pass, the
  // entry-level ignored keys and the regrade.
  for (const want of ['a list of strings', 'an empty list', '`judgments[<id>].<key>`', 'per sample', 'a mean exactly at the threshold reads borderline', 'no `--keep-transcripts`', 'not the per-criterion reasons or the raw replies']) {
    assert.ok(sec.includes(want), `the section does not say ${want}`);
  }
  // A-185-8: the rubric regrade of a criteria case, in this section and in § Transcripts, where spec
  // 184 states rubric mode.
  assert.ok(sec.includes('`regrade --rubric`') && sec.includes('may revise its criteria'), 'the section does not say a rubric regrade may revise criteria');
  const tr = doc.match(/^## Transcripts[^\n]*\n([\s\S]*?)(?=^## )/m);
  assert.ok(tr, 'no Transcripts section');
  const flat = tr[1].replace(/\s+/g, ' ');
  for (const want of ['in a case that lists criteria objects, its `criteria`', 'may not change shape']) assert.ok(flat.includes(want), `§ Transcripts does not say ${want}`);
});

test('AC-10 the methodology page says a sample\'s pass is per sample and a mean exactly at the threshold reads borderline (A-185-3)', () => {
  const page = fs.readFileSync(path.join(REPO, 'docs', 'methodology', 'index.html'), 'utf8');
  const p = page.split('\n').find((l) => l.includes('weighted criteria'));
  assert.ok(p, 'no paragraph on weighted criteria');
  for (const want of ['per sample', 'exactly at the threshold reads borderline']) assert.ok(p.includes(want), `the paragraph does not say ${want}`);
});

// ── AC-11, suites without criteria objects load as on the Base ─────────────────────────────────────

test('AC-11 a criteria list of strings, or an empty one, loads and hashes byte-identically to the Base, with or without a rubric (A-185-2)', () => {
  const dir = baseTree();
  try {
    const base = libOf(dir);
    const suites = {
      'strings with a rubric': [{ id: 's1', prompt: PROMPT, rubric: RUBRIC, criteria: ['must name the database', 'must say why'] }],
      'strings without a rubric': [{ id: 's2', prompt: PROMPT, criteria: ['must name the database'] }],
      'empty with a rubric': [{ id: 'e1', prompt: PROMPT, rubric: RUBRIC, criteria: [] }],
      'empty without a rubric': [{ id: 'e2', prompt: PROMPT, criteria: [] }],
    };
    for (const [what, raw] of Object.entries(suites)) {
      const mine = lib.skill.suiteIdentity(raw);
      const theirs = base.skill.suiteIdentity(raw);
      assert.equal(JSON.stringify(mine.cases), JSON.stringify(theirs.cases), what);
      assert.equal(mine.suiteHash, theirs.suiteHash, what);
      assert.equal(lib.judge.caseRubricHash(mine.cases[0]), base.judge.rubricHash(theirs.cases[0].rubric), what);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC-12, a sample's pass and the case outcome ────────────────────────────────────────────────────

test('AC-12 three of four equal weights met at pass_threshold 0.75: each sample passes, and the case reads borderline (A-185-3)', async () => {
  const { receipt } = await run(lib, [caseOf({ criteria: FOUR })], judgments(FOUR.map((x) => [x.id, x.id === 'alternatives' ? 'not_met' : 'met'])));
  for (const d of drawsOf(receipt)) {
    assert.ok(d.criteria_judgments.every((j) => j.total === 0.75 && j.pass === true));
  }
  for (const c of receipt.results.cases) {
    assert.equal(c.mean, 0.75);
    assert.equal(c.stddev, 0);
    assert.equal(c.outcome, 'borderline');
  }
});
