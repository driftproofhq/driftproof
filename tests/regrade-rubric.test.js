// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 184 (issue 176), part 2: `driftproof regrade --rubric <evals.json>` grades a
// receipt's saved answers again under a revised rubric, with no generation call, and refuses anything
// but a rubric or threshold change before any call.
//
//   node --test tests/regrade-rubric.test.js
//
// No model is called. The CLI rows run bin/driftproof on the stub surface with a preload that wraps
// lib/provider.js's `complete` and writes one line per call to a log, generation or judge, so the call
// count is read from what was called, not from what the command says. The in-process rows replace
// `complete` with a counting double before lib/run.js and lib/judge.js load. SPEC184_ROOT names another
// copy of the code to load (the gate's Base and planted copies); by default it is this checkout.
// Everything written goes under the system temp directory and is removed after.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const RT = process.env.SPEC184_ROOT || path.join(__dirname, '..');
const R = (m) => require(path.join(RT, m));
const SAMPLES = 2;
// The in-process counter, set on lib/provider.js before any module that takes `complete` loads.
process.env.DRIFTPROOF_STUB = '1';
// Issue 196 (A-184-8): a rubric regrade keeps the original's judge environment, and the CLI children
// below run with no surface setting, so this process runs with none either.
delete process.env.CLAUDE_PROVIDER;
delete process.env.OPENAI_SURFACE;
const provider = R('lib/provider.js');
const realComplete = provider.complete;
const seen = { generation: 0, judge: 0 };
const isJudge = (a) => /Return ONLY this JSON object/.test(String((a && a.prompt) || ''));
// A test may answer a call itself (AC-10); a null answer falls through to the stub.
let override = null;
provider.complete = async (a) => {
  seen[isJudge(a) ? 'judge' : 'generation'] += 1;
  const o = override ? override(a) : null;
  if (o) return o;
  return { ...await realComplete(a), reportedModels: [provider.resolveModel(a.model)] };
};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `spec184-${name}-`)); made.push(d); return d; };

const CASES = [
  { id: 'c1', prompt: 'Name one primary colour.', rubric: 'A primary colour, named.', pass_threshold: 0.7 },
  { id: 'c2', prompt: 'Name one prime number.', rubric: 'A prime number, named.', pass_threshold: 0.7 },
  { id: 'c3', prompt: 'Name one planet.', rubric: 'A planet, named.', pass_threshold: 0.7 },
];
function writeSkill(dir, cases = CASES, body = 'Answer in one short sentence.') {
  fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: fx184r\nversion: 0.1.0\n---\n\n# fx184r\n\n${body}\n`);
  fs.writeFileSync(path.join(dir, 'evals', 'evals.json'), JSON.stringify({ cases }, null, 2));
  return dir;
}
const clone = (x) => JSON.parse(JSON.stringify(x));
// The revision the issue names: c2's rubric rewritten, c1's threshold raised above the stub's
// with-skill score (0.85), so c1's with_skill arm moves from pass to fail.
function revisedCases() {
  const c = clone(CASES);
  c[1].rubric = 'A prime number, named, with no other text.';
  c[0].pass_threshold = 0.9;
  return c;
}

// ── the CLI, on the stub, with every call logged ────────────────────────────────────────────────────
function stubEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^DRIFTPROOF_|^NODE_OPTIONS$|^GITHUB_|^RUNNER_|^INPUT_/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, DRIFTPROOF_STUB: '1', ...extra };
}
let preloadFile = null;
function preload() {
  if (preloadFile) return preloadFile;
  preloadFile = path.join(tmp('preload'), 'log-calls.js');
  fs.writeFileSync(preloadFile, [
    "'use strict';",
    `const provider = require(${JSON.stringify(path.join(RT, 'lib', 'provider.js'))});`,
    "const fs = require('fs');",
    'const real = provider.complete;',
    "provider.complete = async (a) => { fs.appendFileSync(process.env.SPEC184_CALL_LOG, (/Return ONLY this JSON object/.test(String((a && a.prompt) || '')) ? 'judge' : 'generation') + '\\n'); return { ...await real(a), reportedModels: [provider.resolveModel(a.model)] }; };",
    '',
  ].join('\n'));
  return preloadFile;
}
function cli(args, cwd, log, extra = {}) {
  const env = stubEnv({ SPEC184_CALL_LOG: log, NODE_OPTIONS: `--require ${preload()}`, ...extra });
  return spawnSync(process.execPath, [path.join(RT, 'bin', 'driftproof'), ...args], { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 64 << 20 });
}
const calls = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
const filesIn = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);

// One original, made once: a stub run with --keep-transcripts.
let ORIG = null;
function original() {
  if (ORIG) return ORIG;
  const work = tmp('orig');
  const skill = writeSkill(path.join(work, 'skill'));
  const log = path.join(work, 'run.log');
  const r = cli(['run', skill, '--samples', String(SAMPLES), '--keep-transcripts', '--trusted-skill', '--out', path.join(work, 'receipts')], work, log);
  assert.equal(r.status, 0, `the original run: ${r.stderr}`);
  const file = path.join(work, 'receipts', filesIn(path.join(work, 'receipts')).find((f) => f.endsWith('.json')));
  const receipt = readJson(file);
  const revised = path.join(work, 'revised.json');
  fs.writeFileSync(revised, JSON.stringify({ cases: revisedCases() }, null, 2));
  ORIG = { work, skill, file, receipt, revised, archive: path.join(work, 'transcripts', receipt.receipt_hash), runCalls: calls(log) };
  return ORIG;
}
const gradableDraws = (receipt) => receipt.results.cases.flatMap((c) => c.generation.draws).filter((d) => d.generation_hash && d.truncated !== true);
let N = 0;
// A rubric regrade of the original through the CLI, into its own directory, with its own call log.
function rubricRegrade(extra = [], { receipt, skill, answers, revised, env } = {}) {
  const o = original();
  N += 1;
  const dir = path.join(o.work, `rg-${N}`);
  fs.mkdirSync(dir);
  const log = path.join(dir, 'calls.log');
  const out = path.join(dir, 'out');
  const args = ['regrade', receipt || o.file, '--skill', skill || o.skill, '--answers', answers || o.archive, '--rubric', revised || o.revised, '--trusted-skill', '--out', out, ...extra];
  const r = cli(args, o.work, log, env);
  const files = filesIn(out);
  const rf = files.find((f) => f.endsWith('.json') && !f.endsWith('.regrade.json'));
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls: calls(log), files, out, receipt: rf ? path.join(out, rf) : null };
}

test('AC-4 a rubric regrade of a kept archive: no generation call, the revised suite, the original untouched', () => {
  const o = original();
  assert.ok(o.runCalls.includes('generation'), 'the preload sees the run\'s generation calls');
  const before = fs.readFileSync(o.file);
  const g = rubricRegrade();
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.calls.filter((c) => c === 'generation').length, 0, 'no generation call');
  assert.equal(g.calls.filter((c) => c === 'judge').length, gradableDraws(o.receipt).length * SAMPLES, 'one judge call per answer and sample');
  assert.ok(Buffer.compare(before, fs.readFileSync(o.file)) === 0, 'the original receipt\'s bytes are unchanged');
  assert.ok(/-regrade-rubric-/.test(path.basename(g.receipt)), `the receipt is named a rubric regrade: ${path.basename(g.receipt)}`);
  const out = readJson(g.receipt);
  const { validateReceipt, verifyReceiptHash } = R('lib/receipt.js');
  assert.ok(validateReceipt(out).valid, JSON.stringify(validateReceipt(out).errors));
  assert.ok(verifyReceiptHash(out));
  const { suiteIdentity } = R('lib/skill.js');
  const { rubricHash } = R('lib/judge.js');
  const want = suiteIdentity({ cases: revisedCases() });
  assert.equal(out.suite.suite_hash, want.suiteHash, 'the receipt carries the revised suite hash');
  assert.notEqual(out.suite.suite_hash, o.receipt.suite.suite_hash);
  assert.deepEqual(out.run.grader_revision.rubric_hashes, out.results.cases.map((c) => rubricHash(want.cases.find((k) => k.id === c.id).rubric)));
  assert.ok(out.run.judged_at && !('generated_at' in out.run), 'a re-judge, with no generation in it');
  for (const m of ['with_skill', 'baseline']) assert.equal(out.run.arms[m].generated_at, o.receipt.run.generated_at, `${m}: the original's generation time`);
  out.results.cases.forEach((c, i) => {
    const oc = o.receipt.results.cases[i];
    assert.equal(c.generation.draws.length, oc.generation.draws.length);
    c.generation.draws.forEach((d, j) => {
      const od = oc.generation.draws[j];
      for (const k of ['draw_index', 'generation_hash', 'stop_reason', 'truncated', 'reported_model', 'usage']) assert.deepEqual(d[k], od[k], `${c.id}/${c.mode} draw ${j}: ${k} is the original's`);
    });
  });
  const c1 = out.results.cases.find((c) => c.id === 'c1' && c.mode === 'with_skill');
  assert.equal(c1.threshold, 0.9, 'graded under the revised threshold');
  const side = readJson(g.receipt.replace(/\.json$/, '.regrade.json'));
  assert.equal(side.receipt_hash, out.receipt_hash);
  // Issue 196 (A-184-12): the provenance names the original inside the receipt's hash, and the sidecar,
  // which repeats no key the receipt carries (spec 044 AC-6), names the receipt.
  assert.equal(out.run.regraded_from.receipt_hash, o.receipt.receipt_hash, 'provenance names the original');
  assert.ok(!('regraded_from' in side), 'the sidecar repeats no key the receipt carries');
  const rv = side.rubric_revision;
  assert.ok(rv, 'the sidecar carries rubric_revision');
  assert.equal(rv.original_suite_hash, o.receipt.suite.suite_hash);
  assert.equal(rv.revised_suite_hash, want.suiteHash);
  assert.equal(rv.sha256, sha(fs.readFileSync(o.revised)));
  assert.deepEqual(rv.cases_changed, [{ id: 'c1', fields: ['pass_threshold'] }, { id: 'c2', fields: ['rubric'] }]);
  assert.match(rv.note, /regrade of the original receipt's saved answers under a revised rubric/);
  assert.match(rv.note, /no answer was generated/);
});

// ── in process: the executor is never called ────────────────────────────────────────────────────────
test('AC-5 in process, a rubric regrade calls no executor and grades under the revised threshold', async () => {
  const { runSkillOnModel } = R('lib/run.js');
  const regrade = R('lib/regrade.js');
  const { loadSkill } = R('lib/skill.js');
  const skill = loadSkill(writeSkill(path.join(tmp('inproc'), 'skill')));
  seen.generation = 0; seen.judge = 0;
  const r = await runSkillOnModel({ skill, model: 'claude-haiku-4-5', opts: { samples: SAMPLES, keepTranscripts: true } });
  assert.ok(seen.generation > 0 && seen.judge > 0, 'the counter sees the run\'s generation and judge calls');
  assert.equal(typeof regrade.answersArchive, 'function', 'lib/regrade.js exports answersArchive');
  const { answers } = regrade.answersArchive({ receipt: r.receipt, kept: r.answers });
  const file = path.join(tmp('revised'), 'evals.json');
  fs.writeFileSync(file, JSON.stringify({ cases: revisedCases() }));
  assert.equal(typeof regrade.readRevisedSuite, 'function', 'lib/regrade.js exports readRevisedSuite');
  const revised = regrade.readRevisedSuite(file);
  const plan = regrade.planRegrade({ receipt: r.receipt, skill, answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised });
  assert.deepEqual(plan.problems, []);
  seen.generation = 0; seen.judge = 0;
  const out = await regrade.regradeReceipt({ receipt: r.receipt, skill, answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised, opts: { trusted: true } });
  assert.equal(seen.generation, 0, 'zero executor calls');
  assert.equal(seen.judge, gradableDraws(r.receipt).length * SAMPLES);
  const was = r.receipt.results.cases.find((c) => c.id === 'c1' && c.mode === 'with_skill');
  const now = out.receipt.results.cases.find((c) => c.id === 'c1' && c.mode === 'with_skill');
  assert.equal(was.outcome, 'pass');
  assert.equal(now.outcome, 'fail', 'the revised threshold decides the outcome');
  assert.equal(out.receipt.suite.suite_hash, revised.suiteHash);
});

// ── refused before any call ─────────────────────────────────────────────────────────────────────────
function variant(name, mutate) {
  const o = original();
  const dir = path.join(o.work, `variant-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  return mutate(dir, o);
}
function suiteVariant(name, edit) {
  return variant(name, (dir) => { const c = revisedCases(); const v = edit(c) || c; const f = path.join(dir, 'evals.json'); fs.writeFileSync(f, JSON.stringify({ cases: v })); return { revised: f }; });
}
function answersVariant(name, edit) {
  return variant(name, (dir, o) => {
    const doc = readJson(path.join(o.archive, 'answers.json'));
    edit(doc.answers);
    const f = path.join(dir, 'answers.json');
    fs.writeFileSync(f, JSON.stringify(doc));
    return { answers: f };
  });
}
const REFUSALS = [
  ['a missing answer', () => answersVariant('missing', (a) => { delete a[Object.keys(a)[0]]; }), /no answer for generation_hash/],
  ['a tampered answer', () => answersVariant('tampered', (a) => { const k = Object.keys(a)[0]; a[k] = `${a[k]} (edited)`; }), /is not its generation_hash/],
  ['an altered receipt', () => variant('receipt', (dir, o) => { const r = clone(o.receipt); r.results.cases[0].reason = 'edited after sealing'; const f = path.join(dir, 'receipt.json'); fs.writeFileSync(f, JSON.stringify(r)); return { receipt: f }; }), /receipt_hash does not verify/],
  ['a changed skill', () => variant('skill', (dir) => ({ skill: writeSkill(path.join(dir, 'skill'), CASES, 'Answer in two short sentences.') })), /content_hash/],
  ['a changed prompt', () => suiteVariant('prompt', (c) => { c[1].prompt = 'Name one even prime number.'; }), /case c2: the field prompt differs/],
  ['a changed case id', () => suiteVariant('id', (c) => { c[2].id = 'c3-renamed'; }), /case c3 is removed[\s\S]*case c3-renamed is added|case c3-renamed is added[\s\S]*case c3 is removed/],
  ['a case added', () => suiteVariant('added', (c) => [...c, { id: 'c4', prompt: 'Name one ocean.', rubric: 'An ocean.', pass_threshold: 0.7 }]), /case c4 is added/],
  ['a case removed', () => suiteVariant('removed', (c) => c.slice(0, 2)), /case c3 is removed/],
  ['a changed case order', () => suiteVariant('order', (c) => [c[1], c[0], c[2]]), /the case order differs/],
  ['a changed checks field', () => suiteVariant('checks', (c) => { c[0].checks = [{ type: 'regex', pattern: 'red' }]; }), /case c1: the key checks is not in the original case/],
  ['no difference', () => suiteVariant('same', () => clone(CASES)), /nothing differs/],
  ['another judge', () => ({ extra: ['--judge-model', 'claude-sonnet-5'] }), /keeps the original's judge/],
];
test('AC-6 each input that is not a rubric-only revision of the original is refused before any call', () => {
  for (const [name, make, why] of REFUSALS) {
    const v = make();
    const g = rubricRegrade(v.extra || [], v);
    assert.equal(g.status, 2, `${name}: exit ${g.status}; ${g.stderr.slice(-400)}`);
    assert.deepEqual(g.calls, [], `${name}: no call`);
    assert.deepEqual(g.files, [], `${name}: no file`);
    assert.match(g.stderr, why, `${name}: the refusal names what differs`);
  }
});

test('AC-7 the call and dollar guards refuse before any call, and the regrade runs at the projection', () => {
  const o = original();
  const projected = gradableDraws(o.receipt).length * SAMPLES;
  const under = rubricRegrade(['--max-calls', String(projected - 1)]);
  assert.equal(under.status, 3, under.stderr);
  assert.deepEqual(under.calls, []);
  assert.equal(under.receipt, null);
  const usd = rubricRegrade(['--max-usd', '0.0001']);
  assert.equal(usd.status, 3, usd.stderr);
  assert.deepEqual(usd.calls, []);
  const at = rubricRegrade(['--max-calls', String(projected)]);
  assert.equal(at.status, 0, at.stderr);
  assert.equal(at.calls.length, projected);
});

// Issue 196 (A-184-13): a receipt at 0.10 records none of v0.12's judge fields, so a rubric regrade
// of it is refused, naming each, and a judge regrade of it still runs.
test('AC-8 a driftproof-answers/1 file still regrades by rubric; a receipt resealed at schema 0.10 is refused by rubric, naming the judge fields it lacks, and still regrades by judge', () => {
  const v1 = variant('v1', (dir, o) => {
    const doc = readJson(path.join(o.archive, 'answers.json'));
    const f = path.join(dir, 'answers.json');
    fs.writeFileSync(f, JSON.stringify({ format: 'driftproof-answers/1', answers: doc.answers }));
    return { answers: f };
  });
  const a = rubricRegrade([], v1);
  assert.equal(a.status, 0, a.stderr);
  const older = variant('older', (dir, o) => {
    const { sealReceipt, validateReceipt } = R('lib/receipt.js');
    const r = clone(o.receipt);
    r.schema_version = '0.10';
    for (const k of ['harness', 'isolation', 'endpoint', 'code_revision', 'reported_models', 'criteria_template_hash']) delete r.run.judge[k];
    delete r.receipt_hash;
    const sealed = sealReceipt(r);
    assert.ok(validateReceipt(sealed).valid, `the resealed receipt validates at 0.10: ${JSON.stringify(validateReceipt(sealed).errors).slice(0, 300)}`);
    const f = path.join(dir, 'receipt.json');
    fs.writeFileSync(f, JSON.stringify(sealed));
    return { receipt: f };
  });
  const b = rubricRegrade([], older);
  assert.equal(b.status, 2, b.stderr);
  assert.deepEqual(b.calls, []);
  assert.deepEqual(b.files, []);
  for (const what of ['harness', 'isolation', 'endpoint', 'code revision', 'reported models']) assert.match(b.stderr, new RegExp(`the original records no judge ${what} \\(a receipt from before schema v0\\.12\\)`), what);
  const out = path.join(older.receipt, '..', 'judge-out');
  const j = cli(['regrade', older.receipt, '--skill', original().skill, '--answers', original().archive, '--judge-model', 'claude-sonnet-5', '--trusted-skill', '--out', out], original().work, path.join(out, '..', 'judge.log'));
  assert.equal(j.status, 0, j.stderr);
  const { RECEIPT_SCHEMA_VERSION } = R('config.js');
  const written = filesIn(out).find((f) => f.endsWith('.json') && !f.endsWith('.regrade.json'));
  assert.equal(readJson(path.join(out, written)).schema_version, RECEIPT_SCHEMA_VERSION, 'the regrade writes the running receipt version');
});

test('AC-9 the help and spec/RECEIPT.md say what is kept and how a rubric regrade runs', () => {
  const h = spawnSync(process.execPath, [path.join(RT, 'bin', 'driftproof'), 'help'], { encoding: 'utf8', env: stubEnv() });
  const help = String(h.stdout).replace(/\s+/g, ' ');
  assert.match(help, /--rubric <evals\.json>/);
  assert.match(help, /answers\.json holds every answer the run was returned/);
  assert.match(help, /only in each case's rubric and pass_threshold/);
  const doc = fs.readFileSync(path.join(RT, 'spec', 'RECEIPT.md'), 'utf8');
  const m = doc.match(/^## Transcripts[^\n]*\n([\s\S]*?)(?=^## )/m);
  assert.ok(m, 'spec/RECEIPT.md has its Transcripts section');
  const section = m[1].replace(/\s+/g, ' ');
  assert.match(section, /`answers\.json`[^.]*every answer the run was returned/);
  assert.match(section, /regrade --rubric/);
  assert.match(section, /only in each case's `rubric` and `pass_threshold`/);
});

// ── the fix loop (A-184-1 to A-184-5) ───────────────────────────────────────────────────────────────
const stubReply = (text, extra = {}) => ({ text, usage: { input_tokens: 10, output_tokens: 5 }, wall_ms: 1, attempts: 1, answeredBy: 'stub', surface: 'stub', reportedModels: null, stopReason: 'end_turn', isolation: 'none', ...extra });

test('AC-10 files capture: a draw the judge could not score is hashed as its judged answer, and regrade --rubric from the archive grades it', async () => {
  const { runSkillOnModel } = R('lib/run.js');
  const regrade = R('lib/regrade.js');
  const { loadSkill } = R('lib/skill.js');
  const work = tmp('files');
  const skillDir = writeSkill(path.join(work, 'skill'));
  const content = 'red, yellow and blue\n';
  let judgeN = 0;
  override = (a) => {
    if (isJudge(a)) { judgeN += 1; return judgeN === 1 ? stubReply('not a grade at all', { reportedModels: [provider.resolveModel(a.model)] }) : null; }
    return stubReply('Red is a primary colour; the list is in the file below.', { workspace: [{ path: 'colours.txt', bytes: Buffer.byteLength(content), included: true, content }] });
  };
  let r;
  try {
    r = await runSkillOnModel({ skill: loadSkill(skillDir), model: 'claude-haiku-4-5', opts: { samples: SAMPLES, keepTranscripts: true, capture: 'files', trusted: true } });
  } finally { override = null; }
  assert.equal(typeof regrade.answersArchive, 'function', 'lib/regrade.js exports answersArchive');
  const doc = regrade.answersArchive({ receipt: r.receipt, kept: r.answers });
  const failed = doc.draws.filter((x) => x.status === 'unmeasured' && x.answer_sha256);
  assert.ok(failed.length >= 1, 'the first judge reply left one draw unmeasured with its answer kept');
  for (const row of doc.draws) if (row.answer_sha256) assert.equal(row.generation_hash, row.answer_sha256, `${row.id}/${row.mode} draw ${row.draw_index} (${row.status}): the receipt's hash is the judged answer's`);
  // The archive on disk, and the CLI's rubric regrade from it, every call logged.
  const receiptFile = path.join(work, 'receipt.json');
  fs.writeFileSync(receiptFile, JSON.stringify(r.receipt, null, 2));
  const archive = path.join(work, 'archive');
  fs.mkdirSync(archive);
  fs.writeFileSync(path.join(archive, 'answers.json'), JSON.stringify(doc, null, 2));
  const revisedFile = path.join(work, 'revised.json');
  fs.writeFileSync(revisedFile, JSON.stringify({ cases: revisedCases() }));
  const log = path.join(work, 'calls.log');
  const out = path.join(work, 'out');
  const g = cli(['regrade', receiptFile, '--skill', skillDir, '--answers', archive, '--rubric', revisedFile, '--trusted-skill', '--out', out], work, log);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(calls(log).filter((c) => c === 'generation').length, 0, 'zero executor calls');
  assert.equal(calls(log).filter((c) => c === 'judge').length, gradableDraws(r.receipt).length * SAMPLES);
});

// AC-11: the revised suite is read as written, before normalisation.
const RAW_REFUSALS = [
  ['a threshold given as a string', (c) => { c[0].pass_threshold = '0.9'; }, /case c1: pass_threshold "0\.9" is not a number in \[0, 1\]/],
  ['a threshold out of range', (c) => { c[0].pass_threshold = 5; }, /case c1: pass_threshold 5 is not a number in \[0, 1\]/],
  ['a misspelt threshold key', (c) => { delete c[0].pass_threshold; c[0].pass_treshold = 0.9; }, /case c1: the key pass_treshold is not in the original case/],
  ['a key the original case does not carry', (c) => { c[2].notes = 'graded by hand last time'; }, /case c3: the key notes is not in the original case/],
  ['a rubric alias the normaliser would drop', (c) => { c[1].criteria = 'Any prime.'; }, /case c2: the key criteria is not in the original case/],
  ['a rubric that is not a string', (c) => { c[1].rubric = ['A prime number.']; }, /case c2: rubric is not a non-empty string/],
];
test('AC-11 the revised suite is read as written: a threshold not a number in [0, 1], a key the original lacks, or a dropped alias is refused', () => {
  for (const [name, edit, why] of RAW_REFUSALS) {
    const v = suiteVariant(`raw-${name.replace(/\W+/g, '-')}`, (c) => { edit(c); });
    const g = rubricRegrade([], v);
    assert.equal(g.status, 2, `${name}: exit ${g.status}; ${g.stderr.slice(-300)}`);
    assert.deepEqual(g.calls, [], `${name}: no call`);
    assert.deepEqual(g.files, [], `${name}: no file`);
    assert.match(g.stderr, why, `${name}: the refusal names it`);
  }
});

test('AC-12 a regrade\'s summary says it is a regrade, naming the original receipt and its run date, rubric and judge alike', () => {
  const o = original();
  const g = rubricRegrade();
  assert.equal(g.status, 0, g.stderr);
  const judgeOut = path.join(o.work, `judge-${++N}`);
  const j = cli(['regrade', o.file, '--skill', o.skill, '--answers', o.archive, '--judge-model', 'claude-sonnet-5', '--trusted-skill', '--out', judgeOut], o.work, path.join(o.work, `judge-${N}.log`));
  assert.equal(j.status, 0, j.stderr);
  const jr = path.join(judgeOut, filesIn(judgeOut).find((f) => f.endsWith('.json') && !f.endsWith('.regrade.json')));
  for (const [kind, file, words] of [['rubric', g.receipt, /under a revised rubric/], ['judge', jr, /by the judge claude-sonnet-5/]]) {
    const md = fs.readFileSync(file.replace(/\.json$/, '.summary.md'), 'utf8');
    const out = readJson(file);
    assert.doesNotMatch(md, /^- \*\*run \(UTC\):\*\*/m, `${kind}: no line presents the regrade time as a run date`);
    assert.match(md, new RegExp(`^- \\*\\*graded \\(UTC\\):\\*\\* ${out.run.date_utc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'), `${kind}: the regrade time is the grading time`);
    assert.match(md, /a regrade of the saved answers of receipt/, `${kind}: it says it is a regrade`);
    assert.ok(md.includes(o.receipt.receipt_hash.slice(0, 16)), `${kind}: it names the original receipt`);
    assert.ok(md.includes(path.basename(o.file)), `${kind}: it names the original receipt's file`);
    assert.ok(md.includes(`run ${o.receipt.run.date_utc}`), `${kind}: it names the original run date`);
    assert.match(md, words, `${kind}: it says what graded the answers again`);
    assert.match(md, /no answer was generated/);
  }
});

test('AC-13 a rubric regrade keeps every other grading input: another judge, another sample count or another judge template is refused before any call', () => {
  const o = original();
  // In planRegrade, the library every caller passes.
  const regrade = R('lib/regrade.js');
  const { loadSkill } = R('lib/skill.js');
  const skill = loadSkill(o.skill);
  const { answers } = regrade.readAnswers(o.archive);
  const revised = regrade.readRevisedSuite(o.revised);
  const plan = (over) => regrade.planRegrade({ receipt: o.receipt, skill, answers, judgeModel: o.receipt.run.judge.model_id, samples: SAMPLES, revised, ...over });
  assert.deepEqual(plan({}).problems, [], 'the control plan has no problem');
  assert.ok(plan({ judgeModel: 'claude-sonnet-5' }).problems.some((p) => /keeps the original's judge/.test(p)), 'another judge is refused in planRegrade');
  assert.ok(plan({ samples: SAMPLES + 1 }).problems.some((p) => /judge samples 3, not the original's 2/.test(p)), 'another sample count is refused in planRegrade');
  // Through the CLI: --samples, and a receipt whose judge template differs from this runner's.
  const s = rubricRegrade(['--samples', String(SAMPLES + 1)]);
  assert.equal(s.status, 2, s.stderr);
  assert.deepEqual(s.calls, []);
  assert.match(s.stderr, /judge samples 3, not the original's 2/);
  const t = variant('template', (dir) => {
    const { sealReceipt } = R('lib/receipt.js');
    const r = clone(o.receipt);
    r.run.judge.prompt_template_hash = '0'.repeat(64);
    delete r.receipt_hash;
    const f = path.join(dir, 'receipt.json');
    fs.writeFileSync(f, JSON.stringify(sealReceipt(r)));
    return { receipt: f };
  });
  const g = rubricRegrade([], t);
  assert.equal(g.status, 2, g.stderr);
  assert.deepEqual(g.calls, []);
  assert.deepEqual(g.files, []);
  assert.match(g.stderr, /prompt_template_hash 000000000000… is not this runner's/);
});

// ── issue 196 (A-184-8 to A-184-11), each red on the tree before it ─────────────────────────────────

// The original receipt with one edit, sealed again, in its own variant directory.
function resealed(name, edit) {
  return variant(name, (dir, o) => {
    const { sealReceipt } = R('lib/receipt.js');
    const r = clone(o.receipt);
    edit(r);
    delete r.receipt_hash;
    const f = path.join(dir, 'receipt.json');
    fs.writeFileSync(f, JSON.stringify(sealReceipt(r)));
    return { receipt: f };
  });
}

test('AC-15 a rubric regrade keeps the original\'s judge environment: another surface, sampling or temperature is refused, each named with how to match it (A-184-8)', () => {
  const o = original();
  assert.equal(o.receipt.run.judge.surface, 'stub', 'the original was judged on the stub');
  // The outside review's case: an original judged on the api surface, regraded where nothing selects it.
  const api = resealed('judge-api', (r) => { Object.assign(r.run.judge, { surface: 'api', sampling: 'api-temperature-0', temperature: 0 }); });
  const a = rubricRegrade([], api);
  assert.equal(a.status, 2, a.stderr);
  assert.deepEqual(a.calls, []);
  assert.deepEqual(a.files, []);
  assert.match(a.stderr, /judge surface stub here, not the original's api: [^\n]*unset DRIFTPROOF_STUB and set CLAUDE_PROVIDER=api to match/);
  assert.match(a.stderr, /judge sampling surface-controlled here, not the original's api-temperature-0: [^\n]*set CLAUDE_PROVIDER=api to match/);
  assert.match(a.stderr, /judge temperature null here, not the original's 0: /);
  // The original as it was, regraded where CLAUDE_PROVIDER=api: the sampling and the temperature differ.
  const b = rubricRegrade([], { env: { CLAUDE_PROVIDER: 'api' } });
  assert.equal(b.status, 2, b.stderr);
  assert.deepEqual(b.calls, []);
  assert.deepEqual(b.files, []);
  assert.match(b.stderr, /judge sampling api-temperature-0 here, not the original's surface-controlled: [^\n]*unset CLAUDE_PROVIDER or set it to cli to match/);
  assert.match(b.stderr, /judge temperature 0 here, not the original's null: /);
  // An original that records no surface, or no sampling, is refused by name.
  for (const [field, why] of [['surface', /the original records no judge surface/], ['sampling', /the original records no judge sampling/]]) {
    const g = rubricRegrade([], resealed(`judge-no-${field}`, (r) => { delete r.run.judge[field]; }));
    assert.equal(g.status, 2, `${field}: ${g.stderr}`);
    assert.deepEqual(g.calls, [], field);
    assert.deepEqual(g.files, [], field);
    assert.match(g.stderr, why, field);
  }
  // In planRegrade, the library every caller passes: the control is clean, and CLAUDE_PROVIDER=api is named.
  const regrade = R('lib/regrade.js');
  const { loadSkill } = R('lib/skill.js');
  const plan = () => regrade.planRegrade({ receipt: o.receipt, skill: loadSkill(o.skill), answers: regrade.readAnswers(o.archive).answers, judgeModel: o.receipt.run.judge.model_id, samples: SAMPLES, revised: regrade.readRevisedSuite(o.revised) });
  assert.deepEqual(plan().problems, [], 'the control plan has no problem');
  process.env.CLAUDE_PROVIDER = 'api';
  let p;
  try { p = plan().problems; } finally { delete process.env.CLAUDE_PROVIDER; }
  assert.ok(p.some((x) => /judge sampling api-temperature-0 here, not the original's surface-controlled/.test(x)), p.join(' | '));
  // Spec 044's judge regrade, another judge on purpose, is unchanged: the api-judged original regrades.
  const out = path.join(o.work, `judge-env-${++N}`);
  const j = cli(['regrade', api.receipt, '--skill', o.skill, '--answers', o.archive, '--judge-model', 'claude-sonnet-5', '--trusted-skill', '--out', out], o.work, path.join(o.work, `judge-env-${N}.log`));
  assert.equal(j.status, 0, j.stderr);
});

// An in-process original on the stub whose every third generation is an answer that points at a file
// it does not include: the run keeps such a draw lost, with its generation_hash (spec 137 R-4).
async function lostOriginal(name) {
  const { runSkillOnModel } = R('lib/run.js');
  const regrade = R('lib/regrade.js');
  const { loadSkill } = R('lib/skill.js');
  const work = tmp(name);
  const skillDir = writeSkill(path.join(work, 'skill'));
  let k = 0;
  override = (a) => {
    if (isJudge(a)) return null;
    k += 1;
    return k % 3 === 1 ? stubReply('I saved the answer to answer.md.') : null;
  };
  let r;
  try {
    r = await runSkillOnModel({ skill: loadSkill(skillDir), model: 'claude-haiku-4-5', opts: { samples: SAMPLES, keepTranscripts: true, trusted: true } });
  } finally { override = null; }
  const doc = regrade.answersArchive({ receipt: r.receipt, kept: r.answers });
  const revisedFile = path.join(work, 'revised.json');
  fs.writeFileSync(revisedFile, JSON.stringify({ cases: revisedCases() }));
  return { work, skillDir, receipt: r.receipt, doc, revisedFile };
}

test('AC-16 planning counts only the draws that reach the judge: a lost draw kept with its generation_hash is not projected, called or counted as graded (A-184-9)', async () => {
  const regrade = R('lib/regrade.js');
  const { loadSkill } = R('lib/skill.js');
  const o = await lostOriginal('lost');
  const all = o.receipt.results.cases.flatMap((c) => c.generation.draws);
  const lost = all.filter((d) => d.generation_hash && /points at a file the judge was not shown/.test(d.reason || ''));
  assert.ok(lost.length >= 1, 'the run kept a lost draw with its generation_hash');
  const judged = gradableDraws(o.receipt).length - lost.length;
  assert.ok(judged >= 1);
  const revised = regrade.readRevisedSuite(o.revisedFile);
  const plan = regrade.planRegrade({ receipt: o.receipt, skill: loadSkill(o.skillDir), answers: o.doc.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.draws, judged, 'the plan counts the draws that reach the judge');
  assert.equal(plan.calls, judged * SAMPLES, 'and projects their calls only');
  seen.generation = 0; seen.judge = 0;
  const out = await regrade.regradeReceipt({ receipt: o.receipt, skill: loadSkill(o.skillDir), answers: o.doc.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised, opts: { trusted: true } });
  assert.equal(seen.generation, 0);
  assert.equal(seen.judge, plan.calls, 'the calls made are the calls planned');
  assert.deepEqual(out.provenance.draws, { graded: judged, carried: all.length - judged }, 'the sidecar counts what was judged and what was carried');
  // Through the CLI: --max-calls at the true projection runs, and the sidecar's answers say what was graded.
  const receiptFile = path.join(o.work, 'receipt.json');
  fs.writeFileSync(receiptFile, JSON.stringify(o.receipt, null, 2));
  const archive = path.join(o.work, 'archive');
  fs.mkdirSync(archive);
  fs.writeFileSync(path.join(archive, 'answers.json'), JSON.stringify(o.doc, null, 2));
  const log = path.join(o.work, 'calls.log');
  const outDir = path.join(o.work, 'out');
  const g = cli(['regrade', receiptFile, '--skill', o.skillDir, '--answers', archive, '--rubric', o.revisedFile, '--trusted-skill', '--max-calls', String(judged * SAMPLES), '--out', outDir], o.work, log);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(calls(log).filter((c) => c === 'judge').length, judged * SAMPLES);
  const side = readJson(path.join(outDir, filesIn(outDir).find((f) => f.endsWith('.regrade.json'))));
  assert.equal(side.answers.graded, judged, 'the sidecar\'s answers count the answers graded');
  assert.deepEqual(side.draws, { graded: judged, carried: all.length - judged });
});

test('AC-17 a regrade runs no deterministic check: each case row carries the original\'s check results, in a judge regrade and a rubric regrade (A-184-10)', async () => {
  const { runSkillOnModel } = R('lib/run.js');
  const regrade = R('lib/regrade.js');
  const { loadSkill } = R('lib/skill.js');
  const { runChecks } = R('lib/checks.js');
  const { validateReceipt } = R('lib/receipt.js');
  const work = tmp('checks');
  const withChecks = clone(CASES);
  withChecks[1].checks = [{ name: 'says-something', kind: 'min_length', value: 1 }];
  const skillDir = writeSkill(path.join(work, 'skill'), withChecks);
  const before = loadSkill(skillDir);
  const r = await runSkillOnModel({ skill: before, model: 'claude-haiku-4-5', opts: { samples: SAMPLES, keepTranscripts: true, trusted: true } });
  const c2 = r.receipt.results.cases.filter((c) => c.id === 'c2');
  assert.ok(c2.length === 2 && c2.every((c) => Array.isArray(c.checks) && c.checks[0].pass === true), 'the run recorded c2\'s check passing');
  const { answers } = regrade.answersArchive({ receipt: r.receipt, kept: r.answers });
  // After the run, c2's check is edited and c3 gains one. Neither moves a hash the receipt records.
  const edited = clone(withChecks);
  edited[1].checks[0].value = 100000;
  edited[2].checks = [{ name: 'added-later', kind: 'min_length', value: 1 }];
  writeSkill(skillDir, edited);
  const after = loadSkill(skillDir);
  assert.equal(after.contentHash, before.contentHash, 'evals/ is not in the skill content_hash');
  assert.equal(after.suite.suiteHash, before.suite.suiteHash, 'checks are not in the suite_hash');
  for (const d of c2.flatMap((c) => c.generation.draws).filter((x) => x.status === 'measured')) {
    assert.equal(runChecks(answers[d.generation_hash], edited[1].checks)[0].pass, false, 'run now, the edited check would fail the answer it passed');
  }
  const rc = clone(edited);
  rc[1].rubric = 'A prime number, named, with no other text.';
  const file = path.join(work, 'revised.json');
  fs.writeFileSync(file, JSON.stringify({ cases: rc }));
  const revised = regrade.readRevisedSuite(file);
  for (const [kind, args] of [['judge', { judgeModel: 'claude-sonnet-5' }], ['rubric', { judgeModel: 'claude-haiku-4-5', revised }]]) {
    const out = await regrade.regradeReceipt({ receipt: r.receipt, skill: after, answers, samples: SAMPLES, ...args, opts: { trusted: true } });
    out.receipt.results.cases.forEach((c, i) => {
      const was = r.receipt.results.cases[i];
      assert.deepEqual(c.checks, was.checks, `${kind}: ${c.id}/${c.mode} carries the original's check results`);
    });
    assert.ok(validateReceipt(out.receipt).valid, JSON.stringify(validateReceipt(out.receipt).errors));
  }
});

test('AC-18 regradeReceipt runs planRegrade\'s checks itself and refuses before any call (A-184-11)', async () => {
  const { runSkillOnModel } = R('lib/run.js');
  const regrade = R('lib/regrade.js');
  const { loadSkill } = R('lib/skill.js');
  const { sealReceipt } = R('lib/receipt.js');
  const work = tmp('direct');
  const skillDir = writeSkill(path.join(work, 'skill'));
  const r = await runSkillOnModel({ skill: loadSkill(skillDir), model: 'claude-haiku-4-5', opts: { samples: SAMPLES, keepTranscripts: true, trusted: true } });
  const { answers } = regrade.answersArchive({ receipt: r.receipt, kept: r.answers });
  const file = path.join(work, 'revised.json');
  fs.writeFileSync(file, JSON.stringify({ cases: revisedCases() }));
  const revised = regrade.readRevisedSuite(file);
  const reseal = (edit) => { const x = clone(r.receipt); edit(x); delete x.receipt_hash; return sealReceipt(x); };
  const edited = clone(r.receipt);
  edited.results.cases[0].reason = 'edited after sealing';
  // Two draws with different answers: one's answer is planted behind the other's hash.
  const [h1, h2] = [...new Set(gradableDraws(r.receipt).map((d) => d.generation_hash))];
  assert.ok(h1 && h2 && answers[h1] !== answers[h2], 'two distinct answers to swap');
  const swapped = { ...answers, [h1]: answers[h2] };
  const REFUSED = [
    ['an edit after sealing', { receipt: edited }, /receipt_hash does not verify/],
    ['a re-sealed edit of the skill hash', { receipt: reseal((x) => { x.skill.content_hash = '0'.repeat(64); }) }, /the skill's content_hash/],
    ['an answer planted behind another hash', { answers: swapped }, /is not its generation_hash/],
    ['another judge sample count in rubric mode', { samples: SAMPLES + 1, revised }, /judge samples 3, not the original's 2/],
    ['another judge in rubric mode', { judgeModel: 'claude-sonnet-5', revised }, /keeps the original's judge/],
  ];
  for (const [name, over, why] of REFUSED) {
    seen.generation = 0; seen.judge = 0;
    await assert.rejects(
      regrade.regradeReceipt({ receipt: r.receipt, skill: loadSkill(skillDir), answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, ...over, opts: { trusted: true } }),
      (e) => e && e.code === 'REGRADE_REFUSED' && why.test(e.message),
      `${name}: refused, named`,
    );
    assert.equal(seen.generation + seen.judge, 0, `${name}: no call`);
  }
});

// ── issue 196, the claim review (A-184-12 to A-184-19), each red on the tree before it ─────────────

// An in-process original on the stub, with its kept answers and a revised suite file. `generate`, when
// given, answers each generation call (its index from 1), and `judge` each judge call; null falls
// through to the stub.
async function inProcessOriginal(name, { cases = CASES, generate = null, judge = null } = {}) {
  const { runSkillOnModel } = R('lib/run.js');
  const regrade = R('lib/regrade.js');
  const { loadSkill } = R('lib/skill.js');
  const work = tmp(name);
  const skillDir = writeSkill(path.join(work, 'skill'), cases);
  let k = 0;
  override = generate || judge ? (a) => (isJudge(a) ? (judge ? judge(a) : null) : (generate ? generate(++k) : null)) : null;
  let r;
  try {
    r = await runSkillOnModel({ skill: loadSkill(skillDir), model: 'claude-haiku-4-5', opts: { samples: SAMPLES, keepTranscripts: true, trusted: true } });
  } finally { override = null; }
  const { answers } = regrade.answersArchive({ receipt: r.receipt, kept: r.answers });
  const rc = clone(cases);
  rc[0].pass_threshold = 0.9;
  const revisedFile = path.join(work, 'revised.json');
  fs.writeFileSync(revisedFile, JSON.stringify({ cases: rc }));
  return { work, skillDir, receipt: r.receipt, answers, revisedFile, skill: () => loadSkill(skillDir), revised: () => regrade.readRevisedSuite(revisedFile) };
}
// The receipt with one edit to a copy, sealed again.
function resealedCopy(receipt, edit) {
  const { sealReceipt } = R('lib/receipt.js');
  const x = clone(receipt);
  edit(x);
  delete x.receipt_hash;
  return sealReceipt(x);
}
// Run fn with these environment variables set (a value of null unsets one), then put them back.
function withEnv(vars, fn) {
  const was = {};
  for (const k of Object.keys(vars)) { was[k] = process.env[k]; if (vars[k] === null) delete process.env[k]; else process.env[k] = vars[k]; }
  const back = () => { for (const k of Object.keys(vars)) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; } };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(back);
    back();
    return out;
  } catch (e) { back(); throw e; }
}
// Issue 196 (A-184-20): the routing variables the judge's endpoint record names, named here and not read
// from lib/, so one left out of the record reads red. NO_ROUTE unsets each for a withEnv call, and
// unrouted() is the record of none set.
const ROUTING = ['ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'HTTPS_PROXY'];
const NO_ROUTE = Object.fromEntries(ROUTING.map((k) => [k, null]));
const unrouted = () => Object.fromEntries(ROUTING.map((k) => [k, { set: false, sha256: null }]));

test('AC-19 a rubric regrade keeps the rest of the judge\'s setting: its harness and version, isolation, endpoint and code revision, each named; an original that records none is refused by name; the regraded receipt states its own judge\'s (A-184-13)', async () => {
  const regrade = R('lib/regrade.js');
  const { judgeEnvironment } = R('lib/run.js');
  const { JUDGE_CODE_REVISION } = R('lib/judge.js');
  const o = await inProcessOriginal('setting');
  const j = o.receipt.run.judge;
  assert.deepEqual({ harness: j.harness, isolation: j.isolation, endpoint: j.endpoint, code_revision: j.code_revision }, { harness: { name: 'none', version: null }, isolation: 'none', endpoint: { custom: false, sha256: null, resolved_by: 'none', routing: unrouted() }, code_revision: JUDGE_CODE_REVISION }, 'a stub run records its judge\'s setting');
  const plan = (receipt) => regrade.planRegrade({ receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised: o.revised(), trusted: true }).problems;
  assert.deepEqual(plan(o.receipt), [], 'the control plan has no problem');
  const judged = (edit) => resealedCopy(o.receipt, (x) => edit(x.run.judge));
  for (const [what, edit, why] of [
    ['another harness and version', (x) => { x.harness = { name: 'claude-code', version: '2.1.290' }; }, /judge harness none here, not the original's claude-code/],
    ['another isolation', (x) => { x.isolation = 'same-user'; }, /judge isolation none here, not the original's same-user: [^\n]*pass --trusted-skill to match/],
    ['a custom endpoint', (x) => { x.endpoint = { ...x.endpoint, custom: true, sha256: sha('http://127.0.0.1:9/elsewhere') }; },/the judge is handed no custom endpoint here, and the original's was handed a custom endpoint \(sha256 [0-9a-f]{12}…\)[^\n]*set ANTHROPIC_BASE_URL to the endpoint whose sha256 the original records/],
    ['another code revision', (x) => { x.code_revision = 'judge-code-ffffffffffffffff'; }, /the judge-reading code is judge-code-[0-9a-f]{16} here, not the original's judge-code-ffffffffffffffff/],
  ]) assert.ok(plan(judged(edit)).some((x) => why.test(x)), `${what}: ${plan(judged(edit)).join(' | ')}`);
  for (const [field, name] of [['harness', 'harness'], ['isolation', 'isolation'], ['endpoint', 'endpoint'], ['code_revision', 'code revision']]) {
    const p = plan(judged((x) => { delete x[field]; }));
    assert.ok(p.some((x) => new RegExp(`the original records no judge ${name} \\(a receipt from before schema v0\\.12\\)`).test(x)), `${field}: ${p.join(' | ')}`);
  }
  // The environment's side, read with no call: what the judge would be handed. The address is never kept.
  const url = 'http://127.0.0.1:9/some-other-service';
  const api = withEnv({ DRIFTPROOF_STUB: null, CLAUDE_PROVIDER: 'api', ANTHROPIC_BASE_URL: url, ...NO_ROUTE }, () => judgeEnvironment({ judgeModel: 'claude-haiku-4-5', samples: SAMPLES }));
  assert.deepEqual({ harness: api.harness, isolation: api.isolation, endpoint: api.endpoint }, { harness: { name: 'api', version: null }, isolation: 'none', endpoint: { custom: true, sha256: sha(url), resolved_by: 'runner', routing: unrouted() } });
  assert.ok(!JSON.stringify(api).includes('127.0.0.1'), 'the address is not recorded');
  const cliHarness = { name: 'claude-code', version: '9.9.9' };
  const hop = withEnv({ DRIFTPROOF_STUB: null, CLAUDE_PROVIDER: null, ANTHROPIC_BASE_URL: url, ...NO_ROUTE }, () => judgeEnvironment({ judgeModel: 'claude-haiku-4-5', samples: SAMPLES, trusted: false, harness: cliHarness }));
  assert.deepEqual({ isolation: hop.isolation, endpoint: hop.endpoint, harness: hop.harness }, { isolation: 'eval-user', endpoint: { custom: false, sha256: null, resolved_by: 'cli', routing: unrouted() }, harness: cliHarness }, 'the hop hands its child no endpoint variable');
  const same = withEnv({ DRIFTPROOF_STUB: null, CLAUDE_PROVIDER: null, ANTHROPIC_BASE_URL: url, ...NO_ROUTE }, () => judgeEnvironment({ judgeModel: 'claude-haiku-4-5', samples: SAMPLES, trusted: true, harness: cliHarness }));
  assert.deepEqual({ isolation: same.isolation, endpoint: same.endpoint }, { isolation: 'same-user', endpoint: { custom: true, sha256: sha(url), resolved_by: 'cli', routing: unrouted() } }, '--trusted-skill hands the judge the operator\'s environment');
  const openai = withEnv({ DRIFTPROOF_STUB: null, OPENAI_SURFACE: 'api', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', ANTHROPIC_BASE_URL: url, ...NO_ROUTE }, () => judgeEnvironment({ judgeModel: 'gpt-5.6-sol', samples: SAMPLES }));
  assert.deepEqual(openai.endpoint, { custom: true, sha256: sha('http://127.0.0.1:9/v1'), resolved_by: 'runner', routing: unrouted() }, 'an OpenAI judge is handed OPENAI_BASE_URL');
  // The review's case: an api-judged original, regraded where ANTHROPIC_BASE_URL points elsewhere.
  const apiJudged = judged((x) => Object.assign(x, { surface: 'api', sampling: 'api-temperature-0', temperature: 0 }));
  const p = withEnv({ DRIFTPROOF_STUB: null, CLAUDE_PROVIDER: 'api', ANTHROPIC_BASE_URL: url, ...NO_ROUTE }, () => plan(apiJudged));
  assert.ok(p.some((x) => /judge harness api here, not the original's none/.test(x)), p.join(' | '));
  assert.ok(p.some((x) => /the judge is handed a custom endpoint \(sha256 [0-9a-f]{12}…\) here, and the original's was handed no custom endpoint[^\n]*unset ANTHROPIC_BASE_URL to match/.test(x)), p.join(' | '));
  // The regraded receipt states its own judge's setting, and keeps the original's in regraded_from.
  const elsewhere = judged((x) => { x.harness = { name: 'claude-code', version: '2.1.290' }; x.isolation = 'same-user'; });
  const out = await regrade.regradeReceipt({ receipt: elsewhere, skill: o.skill(), answers: o.answers, judgeModel: 'claude-sonnet-5', samples: SAMPLES, opts: { trusted: true } });
  assert.deepEqual(out.receipt.run.judge.harness, { name: 'none', version: null }, 'the regrade\'s own judge harness');
  assert.equal(out.receipt.run.judge.isolation, 'none', 'the regrade\'s own judge isolation');
  assert.deepEqual(out.receipt.run.regraded_from.judge.harness, { name: 'claude-code', version: '2.1.290' }, 'the original\'s judge, kept as it recorded it');
});

// The files the judge-code revision covers, each hashed whole (A-184-21, which replaced A-184-13's
// selected functions): named here, not read from lib/judge.js, so a file left out of the derivation reads
// red. The reply's reading and scoring (lib/judge.js, lib/json.js, lib/stats.js), the draws and their
// sampling (lib/sampling.js), the call, its retries and its reply extraction (lib/provider.js,
// lib/usage.js), the judging path of a run and of a regrade (lib/run.js, lib/regrade.js), which answers
// reach the judge (lib/capture.js), the hashes (lib/canonical.js) and the score scale (config.js).
const JUDGE_CODE_FILES = ['config.js', 'lib/canonical.js', 'lib/capture.js', 'lib/json.js', 'lib/judge.js', 'lib/provider.js', 'lib/regrade.js', 'lib/run.js', 'lib/sampling.js', 'lib/stats.js', 'lib/usage.js'];
function judgeCodeDigest(root) {
  return sha(JUDGE_CODE_FILES.map((f) => `${f} ${sha(fs.readFileSync(path.join(root, f)))}`).join('\n'));
}

test('AC-20 the judge-code revision is the digest of the files on the judging path, each hashed whole, and a run records it (A-184-13, A-184-21)', async () => {
  const { JUDGE_CODE_REVISION } = R('lib/judge.js');
  assert.equal(JUDGE_CODE_REVISION, `judge-code-${judgeCodeDigest(RT).slice(0, 16)}`, 'the revision is not the digest of the files on the judging path, each hashed whole');
  const o = await inProcessOriginal('code-revision');
  assert.equal(o.receipt.run.judge.code_revision, JUDGE_CODE_REVISION);
});

test('AC-21 planRegrade and regradeReceipt hold the suites a caller hands in to what they were read from, and refuse before any call (A-184-15)', async () => {
  const regrade = R('lib/regrade.js');
  const o = await inProcessOriginal('identity');
  const revised = o.revised();
  const skill = o.skill();
  // The review's case: a revised case's task swapped, and its hash replaced, by the caller.
  const swapped = { ...revised, cases: clone(revised.cases), suiteHash: 'f'.repeat(64) };
  swapped.cases[1].prompt = 'TASK SWAPPED BY CALLER';
  const noText = { ...revised };
  delete noText.text;
  const skillSwapped = { ...skill, suite: { ...skill.suite, cases: clone(skill.suite.cases) } };
  skillSwapped.suite.cases[1].prompt = 'TASK SWAPPED BY CALLER';
  const elsewhere = writeSkill(path.join(o.work, 'elsewhere'), CASES.map((c, i) => (i === 2 ? { ...c, rubric: 'A planet of the solar system, named.' } : c)));
  for (const [what, over, why] of [
    ['a revised case swapped, its hash replaced', { revised: swapped }, /the revised suite's cases or suite hash are not what its cases as written load to/],
    ['revised cases as written its text does not hold', { revised: { ...revised, raw: revised.raw.map((c, i) => (i === 0 ? { ...c, rubric: 'Edited by the caller.' } : c)) } }, /the revised suite's cases as written are not the ones its text holds/],
    ['a revised sha256 that is not its text\'s', { revised: { ...revised, sha256: '0'.repeat(64) } }, /the revised suite's sha256 is not the sha256 of the text it was read from/],
    ['a revised suite with no text', { revised: noText }, /the revised suite carries no text it was read from/],
    ['a skill whose cases were swapped', { skill: skillSwapped }, /the skill's cases as given do not hash to its suiteHash/],
    ['a skill naming another directory', { skill: { ...skill, dir: elsewhere } }, /the skill's suite as given is not the one its evals\/evals\.json loads to/],
  ]) {
    const args = { receipt: o.receipt, skill, answers: o.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised, trusted: true, ...over };
    const p = regrade.planRegrade(args).problems;
    assert.ok(p.some((x) => why.test(x)), `${what}: ${p.join(' | ')}`);
    seen.generation = 0; seen.judge = 0;
    await assert.rejects(regrade.regradeReceipt({ ...args, opts: { trusted: true } }), (e) => e && e.code === 'REGRADE_REFUSED' && why.test(e.message), what);
    assert.equal(seen.generation + seen.judge, 0, `${what}: no call`);
  }
  // A judge regrade reads the skill's cases too.
  await assert.rejects(regrade.regradeReceipt({ receipt: o.receipt, skill: skillSwapped, answers: o.answers, judgeModel: 'claude-sonnet-5', samples: SAMPLES, opts: { trusted: true } }), (e) => e && e.code === 'REGRADE_REFUSED');
});

test('AC-22 the judge calls a regrade records are the attempts it made, a timed-out draw\'s among them, and agree with the plan and the draws (A-184-14)', async () => {
  const regrade = R('lib/regrade.js');
  const o = await inProcessOriginal('timeout');
  const revised = o.revised();
  const plan = regrade.planRegrade({ receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised, trusted: true });
  assert.deepEqual(plan.problems, []);
  // The review's case: the first judge call of the first judged draw times out.
  let first = true;
  override = (a) => {
    if (isJudge(a) && first) { first = false; throw Object.assign(new Error('call timed out'), { code: 'TIMEOUT' }); }
    return null;
  };
  seen.generation = 0; seen.judge = 0;
  let out;
  try {
    out = await regrade.regradeReceipt({ receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised, opts: { trusted: true } });
  } finally { override = null; }
  const all = o.receipt.results.cases.reduce((a, c) => a + c.generation.draws.length, 0);
  assert.equal(seen.judge, plan.calls, 'every planned call was made');
  assert.equal(out.calls, seen.judge, 'the calls recorded are the calls made, the timed-out draw\'s among them');
  assert.equal(out.provenance.calls, seen.judge);
  assert.equal(out.receipt.run.regrade.judge_calls, seen.judge);
  assert.deepEqual(out.receipt.run.regrade.draws, { graded: plan.draws, carried: all - plan.draws });
  assert.equal(out.receipt.results.cases.flatMap((c) => c.generation.draws).filter((d) => /timed out/.test(d.reason || '')).length, 1, 'one draw timed out');
});

test('AC-23 a row carries the original\'s check results only when its answer is the one they were run on; else none, and checks_regrade says so (A-184-16)', async () => {
  const regrade = R('lib/regrade.js');
  const { validateReceipt } = R('lib/receipt.js');
  const cases = clone(CASES);
  cases[1].checks = [{ name: 'says-something', kind: 'min_length', value: 1 }];
  // A distinct answer per generation, so each draw has its own generation_hash.
  const o = await inProcessOriginal('wrong-answer', { cases, generate: (k) => stubReply(`Answer variant ${k}.`) });
  const was = o.receipt.results.cases.find((c) => c.id === 'c2' && c.mode === 'with_skill');
  const lastText = o.answers[was.generation_hash];
  assert.ok(Array.isArray(was.checks) && was.checks[0].pass === true);
  // The review's case: the judge gives no grade on the row's last measured draw, so the regraded row's
  // last measured draw is another answer.
  override = (a) => (isJudge(a) && a.prompt.includes(lastText.trim()) ? stubReply('not a grade at all') : null);
  let out;
  try {
    out = await regrade.regradeReceipt({ receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-sonnet-5', samples: SAMPLES, opts: { trusted: true } });
  } finally { override = null; }
  const now = out.receipt.results.cases.find((c) => c.id === 'c2' && c.mode === 'with_skill');
  assert.notEqual(now.generation_hash, was.generation_hash);
  assert.ok(!('checks' in now), 'no check result carried to an answer it was not run on');
  assert.equal(now.checks_regrade.carried, false);
  assert.equal(now.checks_regrade.generation_hash, was.generation_hash);
  assert.match(now.checks_regrade.reason, /not carried: the original's checks were run on answer [0-9a-f]{12}, and this row's last measured draw is answer [0-9a-f]{12}/);
  const base = out.receipt.results.cases.find((c) => c.id === 'c2' && c.mode === 'baseline');
  const baseWas = o.receipt.results.cases.find((c) => c.id === 'c2' && c.mode === 'baseline');
  assert.deepEqual(base.checks, baseWas.checks, 'the same answer carries its check results');
  assert.deepEqual(base.checks_regrade, { carried: true, generation_hash: baseWas.generation_hash, reason: "carried from the original receipt's row, whose checks were run on this same answer; no check was run again" });
  for (const c of out.receipt.results.cases.filter((x) => x.id !== 'c2')) assert.ok(!('checks_regrade' in c), `${c.id}/${c.mode}: no checks, no marker`);
  assert.ok(validateReceipt(out.receipt).valid, JSON.stringify(validateReceipt(out.receipt).errors));
  // Every draw of a row unmeasured: no answer to carry check results to.
  override = (a) => (isJudge(a) ? stubReply('not a grade at all') : null);
  let none;
  try {
    none = await regrade.regradeReceipt({ receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-sonnet-5', samples: SAMPLES, opts: { trusted: true } });
  } finally { override = null; }
  const failed = none.receipt.results.cases.find((c) => c.id === 'c2' && c.mode === 'with_skill');
  assert.ok(!('checks' in failed));
  assert.match(failed.checks_regrade.reason, /not carried: no draw of this row was measured in the regrade/);
  assert.ok(validateReceipt(none.receipt).valid, JSON.stringify(validateReceipt(none.receipt).errors));
});

test('AC-24 a rubric regrade compares the judge\'s model id as recorded: a dated id is not the undated one (A-184-18)', async () => {
  const regrade = R('lib/regrade.js');
  const o = await inProcessOriginal('model-id');
  assert.equal(o.receipt.run.judge.model_id, 'claude-haiku-4-5', 'the original records the undated id');
  const plan = (judgeModel) => regrade.planRegrade({ receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel, samples: SAMPLES, revised: o.revised(), trusted: true }).problems;
  assert.deepEqual(plan('claude-haiku-4-5'), []);
  for (const id of ['claude-haiku-4-5-20251001', 'claude-haiku-4-5-20990101']) {
    assert.ok(plan(id).some((x) => x.startsWith(`a rubric regrade keeps the original's judge claude-haiku-4-5, and ${id} is another`)), `${id}: ${plan(id).join(' | ')}`);
    seen.judge = 0;
    await assert.rejects(regrade.regradeReceipt({ receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel: id, samples: SAMPLES, revised: o.revised(), opts: { trusted: true } }), (e) => e && e.code === 'REGRADE_REFUSED');
    assert.equal(seen.judge, 0, `${id}: no call`);
  }
});

test('AC-25 regradeReceipt takes a call cap, and a stop after calls were made says how many were made (A-184-19)', async () => {
  const regrade = R('lib/regrade.js');
  const { BudgetTracker } = R('lib/cost.js');
  const { DEV_MAX_CALLS } = R('config.js');
  const o = await inProcessOriginal('interrupted');
  const revised = o.revised();
  const args = { receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised };
  const projected = regrade.planRegrade({ ...args, trusted: true }).calls;
  seen.judge = 0;
  await assert.rejects(regrade.regradeReceipt({ ...args, opts: { trusted: true, maxCalls: projected - 1 } }), (e) => e && e.code === 'CALL_CAP' && e.maxCalls === projected - 1);
  assert.equal(seen.judge, 0, 'the cap refuses before any call');
  // A direct caller that names no cap has DEV_MAX_CALLS, as a run does.
  const many = Math.ceil((DEV_MAX_CALLS + 1) / regrade.drawsToJudge(o.receipt, o.answers).length);
  await assert.rejects(regrade.regradeReceipt({ ...args, revised: null, judgeModel: 'claude-sonnet-5', samples: many, opts: { trusted: true } }), (e) => e && e.code === 'CALL_CAP' && e.maxCalls === DEV_MAX_CALLS);
  assert.equal(seen.judge, 0, 'the default cap refuses before any call');
  // A budget hard-stop after the first draw's calls says the calls made.
  seen.judge = 0;
  await assert.rejects(regrade.regradeReceipt({ ...args, opts: { trusted: true, budget: new BudgetTracker(1e-9) } }), (e) => e && e.code === 'BUDGET_HARDSTOP' && e.callsMade === seen.judge && e.callsMade === SAMPLES && /\(2 judge call\(s\) were made before it stopped, over 1 draw\(s\)\)/.test(e.message));
  // So does a substrate mismatch.
  override = (a) => (isJudge(a) ? stubReply('{"score": 0.5}', { reportedModels: ['claude-opus-4-8'] }) : null);
  seen.judge = 0;
  try {
    await assert.rejects(regrade.regradeReceipt({ ...args, opts: { trusted: true } }), (e) => e && e.code === 'SUBSTRATE_MISMATCH' && e.callsMade === seen.judge && e.callsMade > 0 && /judge call\(s\) were made before it stopped/.test(e.message));
  } finally { override = null; }
});

test('AC-26 a regraded receipt seals its evidence inside its hash: regraded_from, regrade and each row\'s checks_regrade; older receipts validate as before (A-184-12)', () => {
  const o = original();
  const g = rubricRegrade();
  assert.equal(g.status, 0, g.stderr);
  const out = readJson(g.receipt);
  const { validateReceipt, verifyReceiptHash } = R('lib/receipt.js');
  const { sha256Canonical } = R('lib/canonical.js');
  const { RECEIPT_SCHEMA_VERSION } = R('config.js');
  assert.equal(out.schema_version, RECEIPT_SCHEMA_VERSION);
  assert.ok(validateReceipt(out).valid, JSON.stringify(validateReceipt(out).errors));
  assert.ok(verifyReceiptHash(out));
  const side = readJson(g.receipt.replace(/\.json$/, '.regrade.json'));
  assert.deepEqual(out.run.regraded_from, {
    receipt_hash: o.receipt.receipt_hash,
    runner_version: o.receipt.run.runner_version,
    run_date_utc: o.receipt.run.date_utc,
    answers_sha256: sha256Canonical(R('lib/regrade.js').readAnswers(o.archive).answers),
    rubric_revision_sha256: sha(fs.readFileSync(o.revised)),
    judge: o.receipt.run.judge,
  });
  assert.deepEqual(out.run.regrade, { mode: 'rubric', draws: side.draws, judge_calls: g.calls.filter((c) => c === 'judge').length, judge_attempts: g.calls.filter((c) => c === 'judge').length, judge_logical_calls: g.calls.filter((c) => c === 'judge').length, cases_changed: [{ id: 'c1', fields: ['pass_threshold'] }, { id: 'c2', fields: ['rubric'] }] });
  assert.equal(side.receipt_hash, out.receipt_hash, 'the sidecar names the receipt');
  const receiptKeys = [...Object.keys(out), ...Object.keys(out.run)].filter((k) => k !== 'receipt_hash');
  assert.deepEqual(Object.keys(side).filter((k) => receiptKeys.includes(k)), [], 'and repeats no key the receipt carries, so the lineage is the receipt\'s alone');
  // An edit to any sealed field reads unverified.
  for (const [what, edit] of [
    ['the original receipt hash', (x) => { x.run.regraded_from.receipt_hash = '0'.repeat(64); }],
    ['the original runner version', (x) => { x.run.regraded_from.runner_version = '0.1.0'; }],
    ['the answers sha256', (x) => { x.run.regraded_from.answers_sha256 = '0'.repeat(64); }],
    ['the revised file sha256', (x) => { x.run.regraded_from.rubric_revision_sha256 = '0'.repeat(64); }],
    ['the original judge', (x) => { x.run.regraded_from.judge.samples += 1; }],
    ['the draws graded', (x) => { x.run.regrade.draws.graded += 1; }],
    ['the judge calls', (x) => { x.run.regrade.judge_calls += 1; }],
    ['the endpoint attempts', (x) => { x.run.regrade.judge_attempts += 1; }],
    ['the logical calls', (x) => { x.run.regrade.judge_logical_calls += 1; }],
    ['the cases changed', (x) => { x.run.regrade.cases_changed.pop(); }],
  ]) { const x = clone(out); edit(x); assert.equal(verifyReceiptHash(x), false, what); }
  // A judge regrade says so, and names no revised file or changed case.
  const jOut = path.join(o.work, `sealed-judge-${++N}`);
  const j = cli(['regrade', o.file, '--skill', o.skill, '--answers', o.archive, '--judge-model', 'claude-sonnet-5', '--trusted-skill', '--out', jOut], o.work, path.join(o.work, `sealed-judge-${N}.log`));
  assert.equal(j.status, 0, j.stderr);
  const jr = readJson(path.join(jOut, filesIn(jOut).find((f) => f.endsWith('.json') && !f.endsWith('.regrade.json'))));
  assert.equal(jr.run.regrade.mode, 'judge');
  assert.ok(!('cases_changed' in jr.run.regrade) && !('rubric_revision_sha256' in jr.run.regraded_from));
  assert.ok(validateReceipt(jr).valid, JSON.stringify(validateReceipt(jr).errors));
  // The schema holds the pieces together.
  const invalid = (what, edit) => { const x = clone(out); edit(x); assert.equal(validateReceipt(x).valid, false, what); };
  invalid('a rubric regrade with no revised file', (x) => { delete x.run.regraded_from.rubric_revision_sha256; });
  invalid('a rubric regrade with no changed cases', (x) => { delete x.run.regrade.cases_changed; });
  invalid('regraded_from without regrade', (x) => { delete x.run.regrade; });
  invalid('regrade without regraded_from', (x) => { delete x.run.regraded_from; });
  invalid('a marker that carried nothing beside checks', (x) => { x.results.cases[0].checks = [{ name: 'n', kind: 'regex', pass: true }]; x.results.cases[0].checks_regrade = { carried: false, generation_hash: '0'.repeat(64), reason: 'r' }; });
  // v0.11 is frozen, and a receipt of that shape still validates at 0.11.
  const v011 = JSON.parse(fs.readFileSync(path.join(RT, 'spec', 'receipt.v0.11.schema.json'), 'utf8'));
  assert.equal(v011.$id, 'https://driftproofhq.com/spec/receipt.v0.11.schema.json');
  assert.equal(v011.properties.schema_version.const, '0.11');
  const older = clone(o.receipt);
  for (const k of ['harness', 'isolation', 'endpoint', 'code_revision', 'reported_models', 'criteria_template_hash']) delete older.run.judge[k];
  older.schema_version = '0.11';
  R('lib/receipt.js').sealReceipt(older);
  const v = validateReceipt(older);
  assert.ok(v.valid && v.version === '0.11', JSON.stringify(v.errors));
});

test('AC-27 spec/RECEIPT.md and the methodology page say what a regraded receipt seals, and what the judge\'s setting is (A-184-12, A-184-13)', () => {
  const doc = fs.readFileSync(path.join(RT, 'spec', 'RECEIPT.md'), 'utf8');
  assert.match(doc.split('\n').slice(0, 3).join('\n'), /spec v0\.12\b/);
  const at = doc.indexOf('\n## What v0.12 adds');
  assert.ok(at >= 0, 'spec/RECEIPT.md has no What v0.12 adds section');
  const sec = doc.slice(at + 1, doc.indexOf('\n## ', at + 1)).replace(/\s+/g, ' ');
  for (const want of ['`run.regraded_from`', '`run.regrade`', '`checks_regrade`', '`answers_sha256`', '`rubric_revision_sha256`', '`judge_calls`', '`cases_changed`', '`harness`', '`isolation`', '`endpoint`', '`code_revision`', 'inside its hash', 'never the address', 'receipt.v0.11.schema.json']) {
    assert.ok(sec.includes(want), `§ What v0.12 adds does not say ${want}`);
  }
  const tr = doc.match(/^## Transcripts[^\n]*\n([\s\S]*?)(?=^## )/m)[1].replace(/\s+/g, ' ');
  assert.ok(!/sidecar[^.]*(only|alone)[^.]*record/.test(tr), '§ Transcripts says the sidecar is the only record');
  assert.ok(tr.includes('sealed inside its hash'), '§ Transcripts does not say the evidence is sealed inside the receipt\'s hash');
  const page = fs.readFileSync(path.join(__dirname, '..', 'docs', 'methodology', 'index.html'), 'utf8');
  const p = page.split('\n').find((l) => l.includes('graded again under a revised rubric'));
  assert.ok(p, 'the methodology page has no regrade paragraph');
  for (const want of ['sealed in its hash', 'the original receipt', 'the answers', 'the calls made', 'never run again']) assert.ok(p.includes(want), `the methodology regrade sentence does not say ${want}`);
});

// ── issue 196, the second claim review (A-184-20 to A-184-26), each red on the tip it read ─────────

// A child node process given the tree under test's root as its one argument, with this environment
// set before lib/ loads, its last line read as JSON. Nothing of this process's routing reaches it.
function childJson(script, env = {}) {
  const base = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(DRIFTPROOF_|ANTHROPIC_|OPENAI_|CLAUDE_|NODE_OPTIONS$)/.test(k) || ROUTING.includes(k)) continue;
    base[k] = v;
  }
  const r = spawnSync(process.execPath, ['-e', script, RT], { env: { ...base, ...env }, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('AC-28 the judge\'s endpoint is the address its call uses, resolved by the code that makes the call, with the routing variables it is handed; each is compared, and a missing one refused (A-184-20)', async () => {
  const regrade = R('lib/regrade.js');
  const { judgeEnvironment } = R('lib/run.js');
  const provider = R('lib/provider.js');
  // (a) The review's case: an OpenAI judge whose registry names another address, with OPENAI_BASE_URL
  // unset. The record is the sha256 of the address the call was sent to.
  const proxy = 'https://judge-proxy.example.net/v1';
  const reg = JSON.parse(fs.readFileSync(path.join(RT, 'config', 'models.json'), 'utf8'));
  reg.providers.openai.base_url = proxy;
  const regFile = path.join(tmp('registry'), 'models.json');
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const openai = childJson([
    "const path = require('path'); const RT = process.argv[1];",
    "const { judgeEnvironment } = require(path.join(RT, 'lib', 'run.js'));",
    "const provider = require(path.join(RT, 'lib', 'provider.js'));",
    "const e = judgeEnvironment({ judgeModel: 'gpt-5.5', samples: 2 });",
    'let url = null;',
    "global.fetch = async (u) => { url = String(u); return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'gpt-5.5', choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) }; };",
    "provider.complete({ prompt: 'p', model: 'gpt-5.5', maxTokens: 5 }).then(() => console.log(JSON.stringify({ endpoint: e.endpoint, url })), (err) => console.log(JSON.stringify({ endpoint: e.endpoint, url, error: err.message })));",
  ].join('\n'), { DRIFTPROOF_REGISTRY: regFile, OPENAI_SURFACE: 'api', OPENAI_API_KEY: 'x' });
  assert.equal(openai.url, `${proxy}/chat/completions`, `the call went to ${openai.url}: ${openai.error || ''}`);
  assert.deepEqual(openai.endpoint, { custom: true, sha256: sha(proxy), resolved_by: 'runner', routing: unrouted() }, 'the record is the address the call was sent to');
  assert.ok(!JSON.stringify(openai.endpoint).includes('judge-proxy'), 'the address is not recorded');
  // (b) An Anthropic api judge: the record is read off the client the call is made with, set or not.
  const spy = [
    "const path = require('path'); const RT = process.argv[1];",
    "const sdk = require.resolve('@anthropic-ai/sdk', { paths: [path.join(RT, 'lib')] });",
    'const Real = require(sdk);',
    'let used = null;',
    "class Spy extends Real { constructor(o) { super(o); const self = this; this.messages = { create: async () => { used = self.baseURL; return { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-haiku-4-5-20251001', stop_reason: 'end_turn' }; } }; } }",
    'require.cache[sdk].exports = Spy;',
    "const { judgeEnvironment } = require(path.join(RT, 'lib', 'run.js'));",
    "const e = judgeEnvironment({ judgeModel: 'claude-haiku-4-5', samples: 2 });",
    "require(path.join(RT, 'lib', 'provider.js')).complete({ prompt: 'p', model: 'claude-haiku-4-5', maxTokens: 5 }).then(() => console.log(JSON.stringify({ endpoint: e.endpoint, used })), (err) => console.log(JSON.stringify({ endpoint: e.endpoint, used, error: err.message })));",
  ].join('\n');
  const elsewhere = 'http://127.0.0.1:9/elsewhere';
  const set = childJson(spy, { CLAUDE_PROVIDER: 'api', ANTHROPIC_API_KEY: 'x', ANTHROPIC_BASE_URL: elsewhere });
  assert.equal(set.used, elsewhere, set.error);
  assert.deepEqual(set.endpoint, { custom: true, sha256: sha(set.used), resolved_by: 'runner', routing: unrouted() });
  const unset = childJson(spy, { CLAUDE_PROVIDER: 'api', ANTHROPIC_API_KEY: 'x' });
  assert.ok(typeof unset.used === 'string' && unset.used, unset.error);
  assert.deepEqual(unset.endpoint, { custom: false, sha256: sha(unset.used), resolved_by: 'runner', routing: unrouted() }, 'the default address is recorded too, as not custom');
  // (c) The routing variables, set or not and the sha256 of each value, as the call is handed them.
  const cliHarness = { name: 'claude-code', version: '9.9.9' };
  const routed = { DRIFTPROOF_STUB: null, CLAUDE_PROVIDER: null, ANTHROPIC_BASE_URL: null, ...NO_ROUTE, CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock-proxy.example.net', HTTPS_PROXY: 'http://proxy.example.net:3128' };
  const trusted = withEnv(routed, () => judgeEnvironment({ judgeModel: 'claude-haiku-4-5', samples: SAMPLES, trusted: true, harness: cliHarness }));
  const handed = withEnv(routed, () => provider.buildSpawnPlan({ bin: 'claude', args: ['-p'], trusted: true }).env);
  assert.equal(trusted.endpoint.resolved_by, 'cli');
  const expectedRouting = Object.fromEntries(ROUTING.map((k) => [k, handed[k] === undefined
    ? { set: false, sha256: null } : { set: true, sha256: sha(handed[k]) }]));
  assert.deepEqual(trusted.endpoint, { custom: false, sha256: null, resolved_by: 'cli', routing: expectedRouting },
    'only the routing flags and value hashes handed to --trusted-skill are recorded, with no extra fields');
  assert.deepEqual(ROUTING.filter((k) => trusted.endpoint.routing[k].set), ['ANTHROPIC_BEDROCK_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'HTTPS_PROXY']);
  const routedHosts = new Set(['ANTHROPIC_BEDROCK_BASE_URL', 'HTTPS_PROXY'].map((k) => new URL(routed[k]).host));
  JSON.stringify(trusted.endpoint, (_key, value) => {
    if (typeof value === 'string' && URL.canParse(value)) {
      assert.ok(!routedHosts.has(new URL(value).host), 'no routing URL is recorded, only its sha256');
    }
    return value;
  });
  const hop = withEnv(routed, () => judgeEnvironment({ judgeModel: 'claude-haiku-4-5', samples: SAMPLES, trusted: false, harness: cliHarness }));
  assert.deepEqual(hop.endpoint, { custom: false, sha256: null, resolved_by: 'cli', routing: unrouted() }, 'the hop hands its child HOME and PATH, and none of these');
  const api = withEnv({ ...routed, CLAUDE_PROVIDER: 'api' }, () => judgeEnvironment({ judgeModel: 'claude-haiku-4-5', samples: SAMPLES }));
  assert.deepEqual(ROUTING.filter((k) => api.endpoint.routing[k].set), ['ANTHROPIC_BEDROCK_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'HTTPS_PROXY'], 'an api call is made in this process\'s environment');
  // (d) Each is compared in a rubric regrade, and an original that records none is refused by name.
  const o = await inProcessOriginal('routing');
  const plan = (receipt) => regrade.planRegrade({ receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised: o.revised(), trusted: true }).problems;
  const hasOne = (p, re, what) => assert.ok(p.some((x) => re.test(x)), `${what}: ${p.join(' | ')}`);
  hasOne(plan(resealedCopy(o.receipt, (x) => { x.run.judge.endpoint.routing.HTTPS_PROXY = { set: true, sha256: sha('http://proxy.example.net:3128') }; })), /the judge's HTTPS_PROXY is not set here, and the original's was set \(sha256 [0-9a-f]{12}…\)[^\n]*set HTTPS_PROXY to the value whose sha256 the original records to match/, 'a routing variable the original had set');
  hasOne(plan(resealedCopy(o.receipt, (x) => { delete x.run.judge.endpoint.routing; })), /the original records no judge endpoint routing \(a receipt from before schema v0\.12\)/, 'no routing recorded');
  hasOne(plan(resealedCopy(o.receipt, (x) => { delete x.run.judge.endpoint.resolved_by; })), /the original records no judge endpoint routing \(a receipt from before schema v0\.12\)/, 'no resolution recorded');
  hasOne(plan(resealedCopy(o.receipt, (x) => { x.run.judge.endpoint.resolved_by = 'cli'; })), /the judge's endpoint is resolved by none here, not by cli as the original's was/, 'another resolution');
  // An api-judged original, regraded on the api with the same address: nothing about the endpoint is
  // named; with HTTPS_PROXY set here, it is.
  const apiJudged = resealedCopy(o.receipt, (x) => Object.assign(x.run.judge, { surface: 'api', sampling: 'api-temperature-0', temperature: 0, harness: { name: 'api', version: null }, endpoint: { custom: false, sha256: sha(unset.used), resolved_by: 'runner', routing: unrouted() } }));
  const env = { DRIFTPROOF_STUB: null, CLAUDE_PROVIDER: 'api', ANTHROPIC_BASE_URL: null, ...NO_ROUTE };
  const quiet = withEnv(env, () => plan(apiJudged));
  assert.deepEqual(quiet.filter((x) => /endpoint|HTTPS_PROXY|BEDROCK|VERTEX/.test(x)), [], quiet.join(' | '));
  hasOne(withEnv({ ...env, HTTPS_PROXY: 'http://proxy.example.net:3128' }, () => plan(apiJudged)), /the judge's HTTPS_PROXY is set here \(sha256 [0-9a-f]{12}…\), and the original's was not set[^\n]*unset HTTPS_PROXY to match/, 'a routing variable set only here');
});

test('AC-29 a one-character change in any file the judge-code revision covers moves it, and the review\'s edit to lib/json.js moves it and what is graded (A-184-21)', () => {
  const d = tmp('code-copy');
  for (const p of ['lib', 'config', 'config.js', 'package.json']) fs.cpSync(path.join(RT, p), path.join(d, p), { recursive: true });
  fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(d, 'node_modules'));
  const node = (script) => { const r = spawnSync(process.execPath, ['-e', script, d], { encoding: 'utf8', env: stubEnv(), timeout: 60000 }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const revision = () => node("process.stdout.write(require(require('path').join(process.argv[1], 'lib', 'judge.js')).JUDGE_CODE_REVISION)");
  const base = revision();
  assert.match(base, /^judge-code-[0-9a-f]{16}$/);
  const revisions = new Set([base]);
  for (const f of JUDGE_CODE_FILES) {
    const file = path.join(d, f);
    const was = fs.readFileSync(file);
    fs.writeFileSync(file, Buffer.concat([was, Buffer.from(' ')]));
    try {
      const now = revision();
      assert.ok(!revisions.has(now), `a one-character change to ${f} did not move the revision (${now})`);
      revisions.add(now);
    } finally { fs.writeFileSync(file, was); }
  }
  assert.equal(revision(), base, 'the copy, restored, reads the revision it had');
  // The review's case: lib/json.js's trailing-comma repair cut. The same reply is graded otherwise, and
  // the revision moves with it.
  const graded = () => JSON.parse(node([
    "const path = require('path'); const d = process.argv[1];",
    "const provider = require(path.join(d, 'lib', 'provider.js'));",
    "provider.complete = async () => ({ text: '{\"score\": 0.9, \"reason\": \"ok\",}', attempts: 1, usage: {}, answeredBy: 'model' });",
    "const J = require(path.join(d, 'lib', 'judge.js'));",
    "J.gradeOnce({ task: 't', response: 'r', rubric: 'x', model: 'claude-haiku-4-5' }).then((g) => console.log(JSON.stringify({ revision: J.JUDGE_CODE_REVISION, unmeasured: !!g.unmeasured, score: g.score === undefined ? null : g.score })));",
  ].join('\n')));
  const before = graded();
  assert.deepEqual(before, { revision: base, unmeasured: false, score: 0.9 });
  const json = path.join(d, 'lib', 'json.js');
  const was = fs.readFileSync(json, 'utf8');
  const repair = "let fixed = s.replace(/,\\s*([\\]}])/g, '$1');";
  assert.equal(was.split(repair).length, 2, 'lib/json.js has its trailing-comma repair once');
  fs.writeFileSync(json, was.replace(repair, () => 'let fixed = s;'));
  const after = graded();
  assert.equal(after.unmeasured, true, 'the cut repair grades the same reply otherwise');
  assert.notEqual(after.revision, base, 'and the revision moves with it');
});

test('AC-30 a run records the dated ids its judge answered as, and a rubric regrade refuses to write a receipt whose judge answered as another (A-184-22)', async () => {
  const regrade = R('lib/regrade.js');
  const plain = await inProcessOriginal('snapshot-none', { judge: (a) => isJudge(a) ? stubReply('{"score":0.8}') : null });
  assert.equal(plain.receipt.run.judge.reported_models, null, 'a judge that named no model records null');
  const said = (...ids) => (a) => (isJudge(a) ? stubReply('{"score": 0.85, "reason": "ok"}', { reportedModels: ids }) : null);
  const o = await inProcessOriginal('snapshot', { judge: said('claude-haiku-4-5-20251001') });
  assert.deepEqual(o.receipt.run.judge.reported_models, ['claude-haiku-4-5-20251001'], 'the dated id, as the judge named it');
  const args = { receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised: o.revised() };
  const regradeSaying = async (fn, extra = {}) => {
    override = fn;
    seen.generation = 0; seen.judge = 0;
    try { return await regrade.regradeReceipt({ ...args, ...extra, opts: { trusted: true } }); } finally { override = null; }
  };
  const same = await regradeSaying(said('claude-haiku-4-5-20251001'));
  assert.deepEqual(same.receipt.run.judge.reported_models, ['claude-haiku-4-5-20251001'], 'the regrade records its own judge\'s');
  // Another snapshot of the same model: the regrade stops after the draw that showed it, and writes nothing.
  await assert.rejects(regradeSaying(said('claude-haiku-4-5-20990101')), (e) => e && e.code === 'SUBSTRATE_MISMATCH' && /claude-haiku-4-5-20990101/.test(e.message) && /claude-haiku-4-5-20251001/.test(e.message) && /no receipt is written/.test(e.message) && e.callsMade === seen.judge && seen.judge === SAMPLES);
  // A judge that names none, where the original's named one: refused once its calls are made.
  await assert.rejects(regradeSaying(said()), (e) => e && e.code === 'SUBSTRATE_MISMATCH' && /named none/.test(e.message) && e.callsMade === seen.judge && seen.judge > 0);
  // An original that records none is refused by name, before any call.
  const none = resealedCopy(o.receipt, (x) => { delete x.run.judge.reported_models; });
  const p = regrade.planRegrade({ ...args, receipt: none, trusted: true }).problems;
  assert.ok(p.some((x) => /the original records no judge reported models \(a receipt from before schema v0\.12\)/.test(x)), p.join(' | '));
  // A judge regrade grades with another judge on purpose, and compares none.
  const other = await regradeSaying(said(), { judgeModel: 'claude-sonnet-5', revised: null });
  assert.equal(other.receipt.run.judge.reported_models, null);
});

test('AC-31 a regrade takes a whole number of judge samples, 1 or more, in both modes, and a call cap that is one too, before any call (A-184-23)', async () => {
  const regrade = R('lib/regrade.js');
  const o = await inProcessOriginal('samples');
  const shown = (s) => (typeof s === 'string' ? JSON.stringify(s) : String(s));
  for (const [mode, extra] of [['judge', { judgeModel: 'claude-sonnet-5' }], ['rubric', { judgeModel: 'claude-haiku-4-5', revised: o.revised() }]]) {
    for (const s of [undefined, null, 0, -1, 1.5, '2', NaN]) {
      const args = { receipt: o.receipt, skill: o.skill(), answers: o.answers, samples: s, ...extra };
      const plan = regrade.planRegrade({ ...args, trusted: true });
      assert.ok(plan.problems.some((x) => /^judge samples .* is not a whole number of 1 or more/.test(x)), `${mode}, samples ${shown(s)}: ${plan.problems.join(' | ')}`);
      assert.ok(Number.isFinite(plan.calls) && Number.isFinite(plan.usd), `${mode}, samples ${shown(s)}: the plan projects a number`);
      seen.generation = 0; seen.judge = 0;
      await assert.rejects(regrade.regradeReceipt({ ...args, opts: { trusted: true, maxCalls: 1 } }), (e) => e && e.code === 'REGRADE_REFUSED' && /judge samples .* is not a whole number of 1 or more/.test(e.message), `${mode}, samples ${shown(s)}`);
      assert.equal(seen.generation + seen.judge, 0, `${mode}, samples ${shown(s)}: no call`);
    }
  }
  for (const m of ['100', NaN, 0, -1, 1.5, Infinity]) {
    seen.judge = 0;
    await assert.rejects(regrade.regradeReceipt({ receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-sonnet-5', samples: SAMPLES, opts: { trusted: true, maxCalls: m } }), (e) => e && e.code === 'CALL_CAP' && /is not a whole number of 1 or more/.test(e.message), `maxCalls ${shown(m)}`);
    assert.equal(seen.judge, 0, `maxCalls ${shown(m)}: no call`);
  }
});

test('AC-32 a judge timeout in a regrade records fixed words as its reason, never the error\'s message (A-184-24)', async () => {
  const regrade = R('lib/regrade.js');
  const o = await inProcessOriginal('timeout-words');
  const message = 'provider(claude-cli) timed out after 300000ms: ~/private/notes token=abc123';
  override = (a) => {
    if (isJudge(a) && a.prompt.includes('Name one planet.')) throw Object.assign(new Error(message), { code: 'TIMEOUT' });
    return null;
  };
  let out;
  try {
    out = await regrade.regradeReceipt({ receipt: o.receipt, skill: o.skill(), answers: o.answers, judgeModel: 'claude-haiku-4-5', samples: SAMPLES, revised: o.revised(), opts: { trusted: true } });
  } finally { override = null; }
  const FIXED = 'the judge call timed out after its retries, so no score was given';
  const c3 = out.receipt.results.cases.filter((c) => c.id === 'c3');
  assert.equal(c3.length, 2);
  for (const c of c3) {
    assert.equal(c.case_status, 'failed_timeout', `c3/${c.mode}`);
    assert.equal(c.reason, FIXED, `c3/${c.mode}: the row's reason`);
    for (const d of c.generation.draws) assert.equal(d.reason, FIXED, `c3/${c.mode} draw ${d.draw_index}`);
  }
  const text = JSON.stringify(out.receipt);
  assert.ok(!text.includes('token=abc123') && !text.includes('private/notes'), 'nothing of the error\'s message is in the receipt');
});

test('AC-33 regrade writes no file when the regraded receipt fails schema validation or its hash does not verify (A-184-25)', () => {
  original();
  const breaker = (name, body) => {
    const f = path.join(tmp('breaker'), `${name}.js`);
    fs.writeFileSync(f, [
      "'use strict';",
      `const regrade = require(${JSON.stringify(path.join(RT, 'lib', 'regrade.js'))});`,
      `const { sealReceipt } = require(${JSON.stringify(path.join(RT, 'lib', 'receipt.js'))});`,
      'const real = regrade.regradeReceipt;',
      `regrade.regradeReceipt = async (a) => { const out = await real(a); ${body} return out; };`,
      '',
    ].join('\n'));
    return f;
  };
  for (const [what, body, why] of [
    ['a schema-invalid receipt', 'out.receipt.run.judge.samples = 0; delete out.receipt.receipt_hash; sealReceipt(out.receipt);', /regraded receipt FAILED schema validation/],
    ['a hash that does not verify', "out.receipt.results.cases[0].reason = 'edited after sealing';", /receipt_hash does not verify/],
  ]) {
    const g = rubricRegrade([], { env: { NODE_OPTIONS: `--require ${preload()} --require ${breaker(what.replace(/\W+/g, '-'), body)}` } });
    assert.equal(g.status, 1, `${what}: ${g.stderr}`);
    assert.match(g.stderr, why, what);
    assert.match(g.stderr, /nothing written/, what);
    assert.deepEqual(g.files, [], `${what}: no file written`);
  }
});

test('AC-34 spec/RECEIPT.md and the methodology page say what the judge record holds and compares, what is not recorded, and what the sidecar holds (A-184-20 to A-184-26)', () => {
  const doc = fs.readFileSync(path.join(RT, 'spec', 'RECEIPT.md'), 'utf8');
  const flat = (s) => s.replace(/\s+/g, ' ');
  const at = doc.indexOf('\n## What v0.12 adds');
  const sec = flat(doc.slice(at + 1, doc.indexOf('\n## ', at + 1)));
  assert.ok(!/hands its child only `HOME` and `PATH`, so a judge behind it is handed none/.test(sec), 'the hop sentence the review found false');
  for (const want of ['login shell', '`resolved_by`', '`routing`', ...ROUTING.map((k) => `\`${k}\``), 'unsalted', '`reported_models`', '`criteria_template_hash`', 'Not recorded and not compared', '`~/.claude/settings.json`', '`CLAUDE.md`', 'shell profile', ...JUDGE_CODE_FILES.map((f) => `\`${f}\``)]) {
    assert.ok(sec.includes(want), `§ What v0.12 adds does not say ${want}`);
  }
  assert.ok(!/repeats no (top-level )?key/.test(flat(doc)), 'spec/RECEIPT.md still says the sidecar repeats no key');
  for (const k of ['`format`', '`receipt_hash`', '`generated_at_basis`', '`draws`', '`calls`', '`judge_reported_models`', '`answers`', '`rubric_revision`']) assert.ok(sec.includes(k), `§ What v0.12 adds does not name the sidecar's ${k}`);
  const page = fs.readFileSync(path.join(__dirname, '..', 'docs', 'methodology', 'index.html'), 'utf8');
  const p = page.split('\n').find((l) => l.includes('graded again under a revised rubric'));
  assert.ok(p, 'the methodology page has no regrade paragraph');
  assert.ok(!p.includes('by the same grader in the same setting'), 'the page still says the same setting without saying what is recorded');
  for (const want of ['refuses a grader whose recorded setting differs', 'not recorded', 'settings files', 'shell profile']) assert.ok(p.includes(want), `the methodology regrade paragraph does not say ${want}`);
});

// Issue 196 handover: these plants reproduce the remaining independent findings.
test('AC-35 a judge timeout preserves the completed answer hash and fixed reason for regrading', async () => {
  const o = await inProcessOriginal('timeout-retained', { judge: (a) => {
    if (isJudge(a) && a.prompt.includes('Name one planet.')) throw Object.assign(new Error('timed out private fixture'), { code: 'TIMEOUT', attempts: 4 });
    return null;
  } });
  for (const c of o.receipt.results.cases.filter(c => c.id === 'c3')) for (const d of c.generation.draws) {
    assert.ok(d.generation_hash && Object.hasOwn(o.answers, d.generation_hash), 'completed answer is sealed');
    assert.equal(d.generation_hash, sha(o.answers[d.generation_hash]));
    assert.equal(d.reason, 'the judge call timed out after its retries, so no score was given');
  }
  const args = { receipt:o.receipt, skill:o.skill(), answers:o.answers, judgeModel:'claude-haiku-4-5', samples:SAMPLES, revised:o.revised(), trusted:true };
  const plan = R('lib/regrade.js').planRegrade(args);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.draws, o.receipt.results.cases.flatMap(c=>c.generation.draws).length);
});

test('AC-36 rubric regrades refuse absent original and current judge identities, including a single anonymous reply', async () => {
  const o = await inProcessOriginal('no-identity');
  const regrade = R('lib/regrade.js');
  const args = { receipt:o.receipt, skill:o.skill(), answers:o.answers, judgeModel:'claude-haiku-4-5', samples:SAMPLES, revised:o.revised(), opts:{trusted:true} };
  for (const reported of [null, [], ['']]) {
    const receipt = resealedCopy(o.receipt, r => { r.run.judge.reported_models = reported; });
    const problems = regrade.planRegrade({...args,receipt,trusted:true}).problems;
    assert.ok(problems.some(x => /reported models|identity/.test(x)), 'missing original identity is refused before calls');
    seen.judge=0;
    await assert.rejects(regrade.regradeReceipt({...args,receipt}), /reported models|identity/);
    assert.equal(seen.judge,0);
  }
  let n=0;
  override=a=>isJudge(a) && ++n===1 ? stubReply('{"score":0.9,"reason":"ok"}') : null;
  try { await assert.rejects(regrade.regradeReceipt(args), /identity|named none/); } finally { override=null; }
});

test('AC-37 endpoint attempts include retries and timeouts, logical calls are separate, and the cap stops requests during execution', () => {
  const script = `
    const fs=require('fs'), path=require('path');
    const root=process.argv[1], work=process.argv[2];
    process.env.OPENAI_SURFACE='api';delete process.env.DRIFTPROOF_STUB;
    const timer=global.setTimeout;global.setTimeout=(fn,ms,...a)=>timer(fn,[3000,6000,12000].includes(ms)?0:ms,...a);
    let requests=0, mode='ok';
    global.fetch=async (url,opts)=>{requests++;if(mode==='timeout'||mode==='retry'&&requests%4!==0)throw Object.assign(new Error(mode==='timeout'?'timed out':'429 fixture'),{code:mode==='timeout'?'TIMEOUT':undefined,status:429});const b=JSON.parse(opts.body);return {ok:true,text:async()=>JSON.stringify({model:b.model,choices:[{message:{content:/strict, fair grader/.test(b.messages[0]?.content||'')?'{"score":0.8,"reason":"ok"}':'Red is a primary colour.'},finish_reason:'stop'}]})};};
    const {loadSkill}=require(path.join(root,'lib/skill'));const {runSkillOnModel}=require(path.join(root,'lib/run'));
    const {regradeReceipt,answersArchive}=require(path.join(root,'lib/regrade'));
    (async()=>{const skill=loadSkill(work);const orig=await runSkillOnModel({skill,model:'gpt-5.6-sol',opts:{samples:2,sampling:{min:1,max:1},judgeModel:'gpt-5.6-sol',keepTranscripts:true,trusted:true}});
    const args={receipt:orig.receipt,skill,answers:answersArchive({receipt:orig.receipt,kept:orig.answers}).answers,judgeModel:'gpt-5.6-sol',samples:2};
    const rows=[];for(const kind of ['retry','timeout']){mode=kind;requests=0;const out=await regradeReceipt({...args,opts:{maxCalls:100}});rows.push({kind,requests,sealed:out.receipt.run.regrade,sidecar:out.provenance});}
    mode='retry';requests=0;let error;try{await regradeReceipt({...args,opts:{maxCalls:12}});}catch(e){error={code:e.code,callsMade:e.callsMade,attemptsMade:e.attemptsMade};}rows.push({kind:'cap',requests,error});console.log(JSON.stringify(rows));})().catch(e=>{console.error(e);process.exitCode=1});
  `;
  const work=writeSkill(path.join(tmp('requests'),'skill'),[CASES[0]]);
  const r=spawnSync(process.execPath,['-e',script,RT,work],{encoding:'utf8',env:stubEnv({ OPENAI_API_KEY: 'x' }),timeout:60000});
  assert.equal(r.status,0,r.stderr);
  const rows=JSON.parse(r.stdout);
  for(const row of rows.slice(0,2)) {
    assert.equal(row.requests,48,row.kind);
    assert.equal(row.sealed.judge_attempts,row.requests,row.kind);
    assert.equal(row.sealed.judge_logical_calls,12,row.kind);
    assert.equal(row.sidecar.attempts,row.requests,row.kind);
    assert.equal(row.sidecar.logical_calls,12,row.kind);
  }
  assert.equal(rows[2].requests,12,'cap is enforced before the thirteenth request');
  assert.equal(rows[2].error?.code,'CALL_CAP');
  assert.equal(rows[2].error.attemptsMade,12);
});


test('AC-37 the Anthropic SDK cannot retry outside the endpoint attempt guard', () => {
  const script = `
    const path = require('path');
    const Module = require('module');
    const originalLoad = Module._load;
    let requests = 0, guarded = 0;
    Module._load = function(name, ...args) {
      if (name === '@anthropic-ai/sdk') return class {
        constructor() { this.messages = { create: async (_params, options) => {
          requests += options?.maxRetries === 0 ? 1 : 3;
          throw Object.assign(new Error('429 fixture'), { status: 429 });
        } }; }
      };
      return originalLoad.call(this, name, ...args);
    };
    const timer = global.setTimeout;
    global.setTimeout = (fn, ms, ...args) => timer(fn, [3000,6000,12000].includes(ms) ? 0 : ms, ...args);
    require(path.join(process.argv[1], 'lib/provider.js')).complete({
      model: 'claude-haiku-4-5', prompt: 'Grade.',
      onAttempt: () => { if (guarded === 2) throw Object.assign(new Error('cap reached'), {code:'CALL_CAP'}); guarded++; }
    }).catch(e => console.log(JSON.stringify({ requests, guarded, code:e.code, attempts:e.attempts })));
  `;
  const env = stubEnv({ CLAUDE_PROVIDER: 'api', ANTHROPIC_API_KEY: 'fixture' });
  delete env.DRIFTPROOF_STUB;
  const r = spawnSync(process.execPath, ['-e', script, RT], { encoding:'utf8', env, timeout:60000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { requests:2, guarded:2, code:'CALL_CAP', attempts:2 });
});


test('AC-36 a judge-only regrade with an anonymous sample cannot become an identified rubric original', async () => {
  const regrade = R('lib/regrade.js');
  const o = await inProcessOriginal('identity-chain');
  const args = { receipt:o.receipt, skill:o.skill(), answers:o.answers, judgeModel:'claude-haiku-4-5', samples:SAMPLES, opts:{trusted:true} };
  let n = 0;
  override = a => isJudge(a) && ++n === 1 ? stubReply('{"score":0.8,"reason":"ok"}') : null;
  let out;
  try { out = await regrade.regradeReceipt(args); } finally { override = null; }
  assert.equal(out.receipt.run.judge.reported_models, null, 'one anonymous sample makes the identity incomplete');
  const problems = regrade.planRegrade({ ...args, receipt:out.receipt, revised:o.revised(), trusted:true }).problems;
  assert.ok(problems.some(x => /reported models|identity/.test(x)), problems.join(' | '));
});

test('AC-37 exhausted non-timeout failures report every attempted request and logical call', async () => {
  const regrade = R('lib/regrade.js');
  const o = await inProcessOriginal('failed-attempts');
  // A-184-32 (issue 220): count attempts at the provider boundary, as the API path does.
  let attempts = 0;
  override = a => {
    assert.ok(isJudge(a), 'a regrade must not generate an answer');
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      a.onAttempt(attempt);
      attempts += 1;
    }
    throw Object.assign(new Error('429 fixture'), { status:429, attempts:4 });
  };
  seen.judge = 0;
  try {
    await withEnv({ DRIFTPROOF_STUB: null, CLAUDE_PROVIDER: 'api' }, async () => {
      await assert.rejects(regrade.regradeReceipt({ receipt:o.receipt, skill:o.skill(), answers:o.answers, judgeModel:'claude-haiku-4-5', samples:SAMPLES, opts:{trusted:true} }), e => {
        assert.equal(attempts, seen.judge * 4, 'four attempted requests per logical call');
        assert.equal(e.attemptsMade, attempts);
        assert.equal(e.callsMade, seen.judge * 4);
        assert.equal(e.logicalCallsMade, seen.judge);
        assert.equal(seen.judge, SAMPLES);
        return true;
      });
    });
  } finally { override = null; }
});


test('AC-34 the count fields and identity refusal are explained on the methodology page with the cap source named', () => {
  const doc = fs.readFileSync(path.join(RT, 'spec', 'RECEIPT.md'), 'utf8');
  assert.ok(doc.includes('`DEV_MAX_CALLS`'), 'the receipt specification names the cap constant');
  const page = fs.readFileSync(path.join(__dirname, '..', 'docs', 'methodology', 'index.html'), 'utf8');
  for (const text of ['logical judge calls', 'CLI invocation', 'no recorded judge identity', 'requests made inside a CLI are not counted']) assert.ok(page.includes(text), text);
});
