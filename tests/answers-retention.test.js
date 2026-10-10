// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 184 (issue 176), part 1: under --keep-transcripts the run keeps every answer it
// was returned, one row per draw, in transcripts/<receipt_hash>/answers.json.
//
//   node --test tests/answers-retention.test.js
//
// No model is called. lib/provider.js's `complete` is replaced by a double BEFORE lib/judge.js and
// lib/run.js are loaded (each takes `complete` when it loads); the CLI rows run bin/driftproof on the
// stub surface. SPEC184_ROOT names another copy of the code to load (the gate's Base and planted
// copies); by default it is this checkout. Everything written goes under the system temp directory and
// is removed after.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const RT = process.env.SPEC184_ROOT || path.join(__dirname, '..');
const R = (m) => require(path.join(RT, m));
const MODEL = 'claude-haiku-4-5';
const SAMPLES = 3;
process.env.DRIFTPROOF_STUB = '1';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `spec184-${name}-`)); made.push(d); return d; };

// The double. `gen`: unique (a new text every call, an empty one every fourth) or same (one text for
// every call). `judge`: valid, invalid (not JSON) or timeout (every judge call times out).
const seen = { gen: 0, judge: 0, texts: [], genMode: 'unique', judgeMode: 'valid' };
const reset = (genMode = 'unique', judgeMode = 'valid') => Object.assign(seen, { gen: 0, judge: 0, texts: [], genMode, judgeMode });
const provider = R('lib/provider.js');
provider.complete = async ({ system, prompt }) => {
  const judge = /Return ONLY this JSON object/.test(String(prompt || ''));
  const base = { usage: { input_tokens: 10, output_tokens: 5 }, wall_ms: 1, attempts: 1, answeredBy: 'stub', surface: 'stub', reportedModels: null, stopReason: 'end_turn', isolation: 'none' };
  if (judge) {
    const n = ++seen.judge;
    if (seen.judgeMode === 'timeout') throw Object.assign(new Error(`provider timed out (double) on judge call ${n}`), { code: 'TIMEOUT', attempts: 1 });
    const text = seen.judgeMode === 'invalid' ? `not a grade at all, reply ${n}` : JSON.stringify({ score: 0.6 + (n % 3) / 10, pass: true, reason: `double grade ${n}` });
    return { ...base, text };
  }
  const n = ++seen.gen;
  const text = seen.genMode === 'same' ? 'the one answer every draw gives'
    : n % 4 === 0 ? '' : `answer ${n} ${system ? 'with' : 'without'} the skill`;
  seen.texts.push(text);
  return { ...base, text };
};
const { runSkillOnModel } = R('lib/run.js');
const regrade = R('lib/regrade.js');
const { loadSkill } = R('lib/skill.js');

function skillDir(cases = [1, 2].map((i) => ({ id: `c${i}`, prompt: `Question ${i}?`, rubric: 'One short sentence scores 0.80.' }))) {
  const dir = path.join(tmp('skill'), 'fx');
  fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: fx184\nversion: 0.1.0\n---\n\n# fx184\n\nAnswer in one short sentence.\n');
  fs.writeFileSync(path.join(dir, 'evals', 'evals.json'), JSON.stringify({ cases }));
  return dir;
}
const run = (concurrency, extra = {}) => runSkillOnModel({ skill: loadSkill(skillDir()), model: MODEL, opts: { samples: SAMPLES, concurrency, keepTranscripts: true, nowIso: '2026-10-10T00:00:00.000Z', ...extra } });
const drawsOf = (receipt) => receipt.results.cases.flatMap((c) => c.generation.draws.map((d) => ({ id: c.id, mode: c.mode, d })));
const archiveOf = (r) => {
  assert.equal(typeof regrade.answersArchive, 'function', 'lib/regrade.js exports answersArchive');
  assert.ok(Array.isArray(r.answers), 'runSkillOnModel returns the kept answers under keepTranscripts');
  return regrade.answersArchive({ receipt: r.receipt, kept: r.answers });
};
// One row per draw, keyed by case, mode and draw index, in receipt order.
function rowsMatchDraws(doc, receipt, where) {
  const draws = drawsOf(receipt);
  assert.equal(doc.draws.length, draws.length, `${where}: one row per draw`);
  const keys = new Set(doc.draws.map((x) => `${x.id}\u0000${x.mode}\u0000${x.draw_index}`));
  assert.equal(keys.size, draws.length, `${where}: every row is a distinct (case, mode, draw)`);
  draws.forEach(({ id, mode, d }, i) => {
    const row = doc.draws[i];
    assert.deepEqual([row.id, row.mode, row.draw_index, row.generation_hash, row.status], [id, mode, d.draw_index, d.generation_hash, d.status], `${where}: row ${i} is the receipt's draw`);
  });
}

test('AC-1 every distinct answer is kept, one row per draw, at --concurrency 1 and 4', async () => {
  for (const concurrency of [1, 4]) {
    reset('unique', 'valid');
    const r = await run(concurrency);
    const doc = archiveOf(r);
    assert.equal(doc.format, 'driftproof-answers/2');
    assert.equal(doc.receipt_hash, r.receipt.receipt_hash);
    const returned = [...new Set(seen.texts.filter(Boolean))];
    assert.ok(returned.length > 4, `--concurrency ${concurrency}: the double returned ${returned.length} answers`);
    for (const t of returned) assert.equal(doc.answers[sha(t)], t, `--concurrency ${concurrency}: "${t}" is kept`);
    assert.equal(Object.keys(doc.answers).length, returned.length, `--concurrency ${concurrency}: nothing else is in answers`);
    rowsMatchDraws(doc, r.receipt, `--concurrency ${concurrency}`);
    let measured = 0;
    for (const row of doc.draws) {
      if (row.generation_hash) assert.equal(row.answer_sha256, row.generation_hash, `--concurrency ${concurrency}: ${row.id}/${row.mode} draw ${row.draw_index} keeps the text its hash is`);
      else assert.equal(row.answer_sha256, null, `--concurrency ${concurrency}: an empty draw has no answer`);
      if (row.status === 'measured') { measured += 1; assert.equal(row.judge_outputs.length, SAMPLES, 'a measured draw keeps its judge outputs'); }
    }
    assert.ok(measured > r.receipt.results.cases.length, `--concurrency ${concurrency}: more measured draws (${measured}) than tasks, so more than the last of each is kept`);
  }
});

test('AC-1 one text for every draw is one answers entry, and every draw is still a row', async () => {
  reset('same', 'valid');
  const r = await run(1);
  const doc = archiveOf(r);
  assert.deepEqual(Object.keys(doc.answers), [sha('the one answer every draw gives')]);
  rowsMatchDraws(doc, r.receipt, 'same text');
  assert.ok(doc.draws.length > r.receipt.results.cases.length, 'more rows than tasks');
});

test('AC-2 with every judge reply invalid, every answer is kept with its judge outputs', async () => {
  reset('unique', 'invalid');
  const r = await run(1);
  const doc = archiveOf(r);
  rowsMatchDraws(doc, r.receipt, 'invalid judge');
  assert.ok(doc.draws.every((x) => x.status === 'unmeasured'), 'no draw is measured');
  for (const t of seen.texts.filter(Boolean)) assert.equal(doc.answers[sha(t)], t, `"${t}" is kept`);
  const judged = doc.draws.filter((x) => x.answer_sha256);
  assert.ok(judged.length > 0);
  for (const row of judged) {
    assert.equal(row.answer_sha256, row.generation_hash);
    assert.equal(row.judge_outputs.length, SAMPLES, 'the invalid replies are kept');
    assert.ok(row.judge_outputs.every((x) => /^not a grade at all/.test(x)));
  }
});

test('AC-2 with every judge call timing out, every answer is kept, though the draw records no hash', async () => {
  reset('unique', 'timeout');
  const r = await run(1);
  const doc = archiveOf(r);
  rowsMatchDraws(doc, r.receipt, 'judge timeout');
  const returned = seen.texts.filter(Boolean);
  assert.ok(returned.length > 0);
  for (const t of returned) assert.equal(doc.answers[sha(t)], t, `"${t}" is kept`);
  const kept = doc.draws.filter((x) => x.answer_sha256);
  assert.equal(kept.length, returned.length, 'one kept row per answer returned');
  for (const row of kept) assert.equal(row.generation_hash, null, 'the receipt records no hash for a draw whose judging timed out');
});

// ── the CLI ──────────────────────────────────────────────────────────────────────────────────────────
function stubEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^DRIFTPROOF_|^NODE_OPTIONS$|^GITHUB_|^RUNNER_|^INPUT_/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, DRIFTPROOF_STUB: '1', ...extra };
}
const cli = (args, cwd, env = stubEnv()) => spawnSync(process.execPath, [path.join(RT, 'bin', 'driftproof'), ...args], { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 64 << 20 });
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('AC-3 run --keep-transcripts writes answers.json beside index.json, and colliding names stay apart', () => {
  const work = tmp('cli');
  // "a_b" and "a-b" make one file name, a-b-<mode>.json.
  const skill = skillDir([{ id: 'a_b', prompt: 'First?', rubric: 'Any sentence.' }, { id: 'a-b', prompt: 'Second?', rubric: 'Any sentence.' }]);
  const r = cli(['run', skill, '--samples', '2', '--keep-transcripts', '--trusted-skill', '--out', path.join(work, 'receipts')], work);
  assert.equal(r.status, 0, r.stderr);
  const file = fs.readdirSync(path.join(work, 'receipts')).find((f) => f.endsWith('.json'));
  const receipt = readJson(path.join(work, 'receipts', file));
  const dir = path.join(work, 'transcripts', receipt.receipt_hash);
  const index = readJson(path.join(dir, 'index.json'));
  assert.equal(index.entries.length, 4, 'one per-case file per case and mode');
  assert.equal(new Set(index.entries).size, 4, 'two case ids that make one name get two files');
  for (const e of index.entries) {
    const t = readJson(path.join(dir, e));
    assert.ok(receipt.results.cases.some((c) => c.id === t.id && c.mode === t.mode), `${e} is a case and mode of the receipt`);
    assert.equal(typeof t.generation, 'string');
  }
  assert.equal(new Set(index.entries.map((e) => { const t = readJson(path.join(dir, e)); return `${t.id}/${t.mode}`; })).size, 4, 'no per-case file is written over');
  assert.equal(index.answers, 'answers.json');
  const doc = readJson(path.join(dir, 'answers.json'));
  assert.equal(doc.format, 'driftproof-answers/2');
  assert.equal(doc.receipt_hash, receipt.receipt_hash);
  rowsMatchDraws(doc, receipt, 'the CLI archive');
  for (const [h, t] of Object.entries(doc.answers)) assert.equal(sha(t), h);
  // regrade --answers reads the file as it is.
  const judges = readJson(path.join(RT, 'config', 'models.json')).models.filter((m) => m.judge_eligible).map((m) => m.id);
  const judge = judges.find((j) => j !== receipt.run.judge.model_id);
  const g = cli(['regrade', path.join(work, 'receipts', file), '--skill', skill, '--answers', path.join(dir, 'answers.json'), '--judge-model', judge, '--trusted-skill', '--out', path.join(work, 'regraded')], work);
  assert.equal(g.status, 0, g.stderr);
});

test('AC-14 when the transcripts directory is already taken, the run writes nothing: no receipt beside a partial archive', () => {
  const work = tmp('taken');
  const skill = skillDir();
  // One instant for every clock read, so two stub runs seal the same receipt and name the same
  // transcripts directory.
  const clock = path.join(work, 'fixed-clock.js');
  fs.writeFileSync(clock, [
    "'use strict';",
    'const RealDate = Date;',
    "const FIXED = RealDate.parse('2026-10-10T00:00:00.000Z');",
    'global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };',
    '',
  ].join('\n'));
  const env = stubEnv({ NODE_OPTIONS: `--require ${clock}` });
  const first = cli(['run', skill, '--samples', '2', '--keep-transcripts', '--trusted-skill', '--out', path.join(work, 'r1')], work, env);
  assert.equal(first.status, 0, first.stderr);
  const dirs = fs.readdirSync(path.join(work, 'transcripts'));
  assert.equal(dirs.length, 1);
  const archive = path.join(work, 'transcripts', dirs[0]);
  const before = Object.fromEntries(fs.readdirSync(archive).map((f) => [f, fs.readFileSync(path.join(archive, f), 'utf8')]));
  const second = cli(['run', skill, '--samples', '2', '--keep-transcripts', '--trusted-skill', '--out', path.join(work, 'r2')], work, env);
  assert.deepEqual(fs.readdirSync(path.join(work, 'transcripts')), dirs, 'the second run sealed the same receipt, so it names the same directory');
  assert.notEqual(second.status, 0, 'the second run does not report success');
  assert.match(second.stderr, new RegExp(`transcripts/${dirs[0]}`), 'it names the directory that is taken');
  const r2 = path.join(work, 'r2');
  assert.deepEqual(fs.existsSync(r2) ? fs.readdirSync(r2) : [], [], 'no receipt is written beside the taken archive');
  const after = Object.fromEntries(fs.readdirSync(archive).map((f) => [f, fs.readFileSync(path.join(archive, f), 'utf8')]));
  assert.deepEqual(after, before, 'the archive is not written over');
});

test('AC-8 an archive written before every draw was kept reads as what it holds, and nothing is made up', async () => {
  reset('unique', 'valid');
  const r = await run(1);
  assert.equal(typeof regrade.readAnswers, 'function', 'lib/regrade.js exports readAnswers');
  // The archive the Base wrote: one file per case and mode, the last measured draw's, and index.json.
  const dir = tmp('legacy');
  const entries = [];
  for (const t of r.transcripts.filter(Boolean)) {
    const f = `${t.id}-${t.mode}.json`;
    fs.writeFileSync(path.join(dir, f), JSON.stringify({ id: t.id, mode: t.mode, generation: t.generation, judge_outputs: t.judge_outputs }));
    entries.push(f);
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ receipt_hash: r.receipt.receipt_hash, entries }));
  const got = regrade.readAnswers(dir);
  const want = Object.fromEntries(r.transcripts.filter(Boolean).map((t) => [sha(t.generation), t.generation]));
  assert.deepEqual(got.answers, want, 'the per-case texts and nothing else');
  assert.equal(got.source.kind, 'legacy-archive');
});

test('AC-8 a regrade from an older archive refuses each draw it holds no answer for', async () => {
  reset('unique', 'valid');
  const dirSkill = skillDir();
  const skill = loadSkill(dirSkill);
  const r = await runSkillOnModel({ skill, model: MODEL, opts: { samples: SAMPLES, concurrency: 1, keepTranscripts: true, nowIso: '2026-10-10T00:00:00.000Z' } });
  const dir = tmp('legacy2');
  for (const t of r.transcripts.filter(Boolean)) fs.writeFileSync(path.join(dir, `${t.id}-${t.mode}.json`), JSON.stringify({ id: t.id, mode: t.mode, generation: t.generation, judge_outputs: t.judge_outputs }));
  const { answers } = regrade.readAnswers(dir);
  const plan = regrade.planRegrade({ receipt: r.receipt, skill, answers, judgeModel: MODEL, samples: SAMPLES });
  const gradable = drawsOf(r.receipt).filter((x) => x.d.generation_hash && x.d.truncated !== true);
  const missing = gradable.filter((x) => !Object.hasOwn(answers, x.d.generation_hash));
  assert.ok(missing.length > 0, 'the older archive lacks some draws');
  assert.equal(plan.problems.length, missing.length, 'one refusal per draw with no answer');
  for (const x of missing) assert.ok(plan.problems.some((p) => p.startsWith(`${x.id}/${x.mode} draw ${x.d.draw_index}: no answer`)), `${x.id}/${x.mode} draw ${x.d.draw_index} is named`);
  assert.equal(plan.calls, 0);
});
