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
const provider = R('lib/provider.js');
const realComplete = provider.complete;
const seen = { generation: 0, judge: 0 };
const isJudge = (a) => /Return ONLY this JSON object/.test(String((a && a.prompt) || ''));
// A test may answer a call itself (AC-10); a null answer falls through to the stub.
let override = null;
provider.complete = async (a) => {
  seen[isJudge(a) ? 'judge' : 'generation'] += 1;
  const o = override ? override(a) : null;
  return o || realComplete(a);
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
    "provider.complete = async (a) => { fs.appendFileSync(process.env.SPEC184_CALL_LOG, (/Return ONLY this JSON object/.test(String((a && a.prompt) || '')) ? 'judge' : 'generation') + '\\n'); return real(a); };",
    '',
  ].join('\n'));
  return preloadFile;
}
function cli(args, cwd, log) {
  const env = stubEnv({ SPEC184_CALL_LOG: log, NODE_OPTIONS: `--require ${preload()}` });
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
function rubricRegrade(extra = [], { receipt, skill, answers, revised } = {}) {
  const o = original();
  N += 1;
  const dir = path.join(o.work, `rg-${N}`);
  fs.mkdirSync(dir);
  const log = path.join(dir, 'calls.log');
  const out = path.join(dir, 'out');
  const args = ['regrade', receipt || o.file, '--skill', skill || o.skill, '--answers', answers || o.archive, '--rubric', revised || o.revised, '--trusted-skill', '--out', out, ...extra];
  const r = cli(args, o.work, log);
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
  assert.equal(side.regraded_from.receipt_hash, o.receipt.receipt_hash, 'provenance names the original');
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

test('AC-8 a driftproof-answers/1 file and a receipt resealed at schema 0.10 still regrade by rubric', () => {
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
    delete r.receipt_hash;
    const sealed = sealReceipt(r);
    assert.ok(validateReceipt(sealed).valid, `the resealed receipt validates at 0.10: ${JSON.stringify(validateReceipt(sealed).errors).slice(0, 300)}`);
    const f = path.join(dir, 'receipt.json');
    fs.writeFileSync(f, JSON.stringify(sealed));
    return { receipt: f };
  });
  const b = rubricRegrade([], older);
  assert.equal(b.status, 0, b.stderr);
  const { RECEIPT_SCHEMA_VERSION } = R('config.js');
  assert.equal(readJson(b.receipt).schema_version, RECEIPT_SCHEMA_VERSION, 'the regrade writes the running receipt version');
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
    if (isJudge(a)) { judgeN += 1; return judgeN === 1 ? stubReply('not a grade at all') : null; }
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
