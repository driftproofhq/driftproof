// SPDX-License-Identifier: Apache-2.0
'use strict';
process.env.DRIFTPROOF_STUB = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin/driftproof');
const PROBE = path.join(ROOT, 'specs/723-recheck/probe.cjs');
const MODEL = 'claude-haiku-4-5';
const { buildDriftReport } = require('../lib/diff');
const { sealReceipt, validateReceipt, verifyReceiptHash, comparisonOf } = require('../lib/receipt');
const { acrossDraws } = require('../lib/sampling');
const { resolveCount } = require('../lib/counts');
const archived = require('../receipts/report-017c/campaign-1/0960909c6068a7174c8e22ce9840e5d92ad1c3d7251cc71261d9dea7d26488a6.json');
const CAVEAT = 'A separation between dates cannot be attributed to the model, the harness or chance.';
const NO_SEPARATION = 'No separation detected between dates; this is not evidence that nothing changed.';
const NOTHING_TO_COMPARE = 'Nothing to compare yet: no two results could be compared.';
const made = [];
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const api = () => require('../lib/recheck');
function temp() {
  const p = fs.mkdtempSync('/var/tmp/spec723-'); made.push(p); return p;
}
test.after(() => { for (const p of made) fs.rmSync(p, { recursive: true, force: true }); });
function fixture(kind = 'skill') {
  const cwd = temp(), subject = path.join(cwd, kind === 'skill' ? 'subject' : 'rules.md');
  const suiteBytes = Buffer.from('{\n "cases": [{"id":"one","prompt":"Name a fruit.","rubric":"Name one fruit."}]\n}\n');
  let suite;
  if (kind === 'skill') {
    fs.mkdirSync(path.join(subject, 'evals'), { recursive: true });
    fs.writeFileSync(path.join(subject, 'SKILL.md'), '# Saved tests\n\nName one fruit.\n');
    fs.writeFileSync(path.join(subject, 'bundle.bin'), Buffer.from([0, 1, 127, 255]));
    suite = path.join(subject, 'evals/evals.json');
  } else {
    fs.writeFileSync(subject, Buffer.from('\ufeff# Rules\r\nName one fruit.\r\n'));
    suite = path.join(cwd, 'tasks.json');
  }
  fs.writeFileSync(suite, suiteBytes);
  return { cwd, subject, suite, out: path.join(cwd, 'saved'), trace: path.join(cwd, 'calls.ndjson'), kind };
}
function env(f, extra = {}) {
  const clean = {};
  for (const k of ['PATH', 'LANG', 'LC_ALL', 'SystemRoot']) if (process.env[k]) clean[k] = process.env[k];
  return { ...clean, HOME: f.cwd, TMPDIR: '/var/tmp', DRIFTPROOF_STUB: '1',
    NODE_OPTIONS: '--require=' + PROBE, SPEC723_TRACE: f.trace, ...extra };
}
function cli(f, args, extra = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: f.cwd, env: env(f, extra), encoding: 'utf8', timeout: 1800000, maxBuffer: 8 * 1024 * 1024
  });
  assert.ifError(r.error);
  return r;
}
function ok(r) { assert.equal(r.status, 0, r.stderr + '\n' + r.stdout); return r; }
function trace(f) {
  return fs.existsSync(f.trace) ? fs.readFileSync(f.trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}
function init(f, flags = ['--models', MODEL, '--samples', '2']) {
  ok(cli(f, ['recheck', 'init', f.subject, ...(f.kind === 'context' ? ['--suite', f.suite] : []), ...flags, '--out', f.out]));
  return read(path.join(f.out, 'recheck.json'));
}
function receipts(f) {
  const dir = path.join(f.out, 'receipts');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => ({ file: n, receipt: read(path.join(dir, n)) })) : [];
}
function noCalls(f) { assert.equal(trace(f).filter(r => r.kind === 'call').length, 0); }
function exactCopies(f, m) {
  assert.ok(m.files.length >= (f.kind === 'skill' ? 3 : 2));
  for (const file of m.files) {
    assert.ok(!path.isAbsolute(file.path) && !file.path.split(/[\\/]/).includes('..'));
    assert.equal(sha(fs.readFileSync(path.join(f.out, file.path))), file.sha256);
  }
  assert.deepEqual(fs.readFileSync(path.join(f.out, m.suite.path)), fs.readFileSync(f.suite));
  const src = f.kind === 'skill' ? path.join(f.subject, 'SKILL.md') : f.subject;
  const dst = f.kind === 'skill' ? path.join(f.out, m.subject.path, 'SKILL.md') : path.join(f.out, m.subject.path);
  assert.deepEqual(fs.readFileSync(dst), fs.readFileSync(src));
  if (f.kind === 'skill') assert.deepEqual(fs.readFileSync(path.join(f.out, m.subject.path, 'bundle.bin')), fs.readFileSync(path.join(f.subject, 'bundle.bin')));
}
for (const kind of ['skill', 'context']) test('AC-1 init copies exact ' + kind + ' bytes without running', () => {
  const f = fixture(kind), m = init(f);
  exactCopies(f, m); noCalls(f);
  assert.equal(fs.readFileSync(path.join(f.out, 'recheck.sha256'), 'utf8').trim(), sha(fs.readFileSync(path.join(f.out, 'recheck.json'))));
});
function defaultProvenance(m) {
  assert.equal(m.sources.models, 'default'); assert.equal(m.sources.samples, 'default');
  assert.equal(m.sources.timeout, 'default'); assert.equal(m.settings.timeout.explicit_ms, null);
}
test('AC-2 defaults are not explicit choices; the false-explicit plant reads red', () => {
  const f = fixture(), m = init(f, []);
  defaultProvenance(m);
  assert.ok(m.settings.draws_cap > 0);
  assert.ok(Object.values(m.settings.timeout.generation_ms).length > 0);
  assert.ok(Object.values(m.settings.timeout.generation_ms).every(n => n > 0));
  assert.ok(Object.values(m.settings.timeout.judge_ms).every(n => n > 0));
  const plant = structuredClone(m); plant.sources.timeout = 'flag'; plant.settings.timeout.explicit_ms = 300000;
  assert.throws(() => defaultProvenance(plant), { code: 'ERR_ASSERTION' });
});
test('AC-2/3 configuration agrees with direct run and later caller settings cannot move it', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.cwd, '.driftproofrc'), JSON.stringify({ samples: 3, judge_model: MODEL, capture: 'text', concurrency: 1 }));
  fs.writeFileSync(path.join(f.subject, '.driftproofrc'), JSON.stringify({ samples: 9, capture: 'files' }));
  const m = init(f, ['--models', MODEL]);
  assert.equal(m.settings.samples, 3); assert.equal(m.settings.capture, 'text');
  assert.equal(m.sources.samples, 'working-directory');
  ok(cli(f, ['run', f.subject, '--models', MODEL, '--out', path.join(f.cwd, 'direct')]));
  const direct = trace(f).find(r => r.kind === 'runner');
  fs.writeFileSync(path.join(f.cwd, '.driftproofrc'), JSON.stringify({ samples: 7, capture: 'files' }));
  fs.rmSync(f.subject, { recursive: true });
  ok(cli(f, ['recheck', 'run', f.out]));
  const saved = trace(f).filter(r => r.kind === 'runner').at(-1);
  assert.equal(saved.model, direct.model);
  for (const k of ['samples', 'judgeModel', 'capture', 'maxCases', 'maxCalls', 'concurrency', 'trusted']) assert.equal(saved.options[k], direct.options[k], k);
  assert.equal(saved.contentHash, direct.contentHash); assert.equal(saved.suiteHash, direct.suiteHash);
  assert.deepEqual(read(path.join(f.out, 'recheck.json')), m);
});
for (const plant of ['subject', 'suite', 'manifest', 'seal', 'added', 'deleted', 'link']) {
  test('AC-1/4 plant ' + plant + ' is refused before calls', () => {
    const f = fixture(), m = init(f), subject = path.join(f.out, m.subject.path, 'SKILL.md');
    if (plant === 'subject') fs.appendFileSync(subject, 'x');
    if (plant === 'suite') fs.appendFileSync(path.join(f.out, m.suite.path), ' ');
    if (plant === 'manifest') fs.appendFileSync(path.join(f.out, 'recheck.json'), ' ');
    if (plant === 'seal') fs.unlinkSync(path.join(f.out, 'recheck.sha256'));
    if (plant === 'added') fs.writeFileSync(path.join(f.out, m.subject.path, 'new.txt'), 'Extra input');
    if (plant === 'deleted') fs.unlinkSync(subject);
    if (plant === 'link') { fs.unlinkSync(subject); fs.symlinkSync(path.join(f.subject, 'SKILL.md'), subject); }
    const r = cli(f, ['recheck', 'run', f.out]);
    assert.notEqual(r.status, 0); assert.match(r.stderr + r.stdout, /refus|chang|hash|seal|missing|link/i);
    noCalls(f); assert.equal(receipts(f).length, 0);
  });
}
test('AC-4 exported run cannot bypass the manifest check', async () => {
  const lib = api(), f = fixture(), m = init(f);
  fs.appendFileSync(path.join(f.out, m.suite.path), ' ');
  const provider = require('../lib/provider'), original = provider.complete;
  let calls = 0;
  provider.complete = () => { calls++; throw Error('No provider call allowed'); };
  try {
    await assert.rejects(async () => lib.runRecheck(f.out), /refus|chang|hash|seal/i);
    assert.equal(calls, 0); assert.equal(receipts(f).length, 0);
  } finally { provider.complete = original; }
});
for (const change of ['template', 'sampling']) test('AC-3 installed procedure change refuses before calls: ' + change, () => {
  const f = fixture(); init(f);
  const r = cli(f, ['recheck', 'run', f.out], { SPEC723_PROCEDURE_PLANT: change });
  assert.notEqual(r.status, 0); assert.match(r.stderr + r.stdout, /judge|template|procedure|sampling|draw/i); noCalls(f);
});
test('AC-5 two runs retain ordinary receipts and actual call counts', () => {
  const f = fixture(); init(f);
  ok(cli(f, ['recheck', 'run', f.out]));
  const before = receipts(f); assert.equal(before.length, 1);
  ok(cli(f, ['recheck', 'run', f.out]));
  const after = receipts(f); assert.equal(after.length, 2);
  assert.deepEqual(after.find(x => x.file === before[0].file), before[0]);
  const emitted = trace(f).filter(x => x.kind === 'receipt').map(x => x.receipt);
  assert.deepEqual(after.map(x => x.receipt.receipt_hash).sort(), emitted.map(x => x.receipt_hash).sort());
  for (const { file, receipt: r } of after) {
    assert.match(file, /\d{4}-?\d{2}-?\d{2}/);
    assert.equal(validateReceipt(r).valid, true); assert.equal(verifyReceiptHash(r), true);
    assert.equal(r.verification_level, 'UNVERIFIED'); assert.equal(r.run.surface, 'stub');
    assert.deepEqual(r, emitted.find(x => x.receipt_hash === r.receipt_hash));
    for (const [i, c] of r.results.cases.entries()) {
      assert.equal(c.generation.n_drawn, c.generation.draws.length);
      assert.equal(resolveCount(r, i, 'judge_samples_per_generation'), 2);
      for (const d of c.generation.draws) assert.equal(d.samples.length, 2);
    }
  }
  const expectedCalls = after.flatMap(x => x.receipt.results.cases).reduce((n, c) => n + c.generation.draws.reduce((sum, d) => sum + 1 + d.samples.length, 0), 0);
  assert.equal(trace(f).filter(x => x.kind === 'call').length, expectedCalls);
});
test('AC-11 init refuses existing output and invalid context without calls or overwrites', () => {
  const f = fixture(); init(f);
  const bytes = fs.readFileSync(path.join(f.out, 'recheck.json'));
  assert.notEqual(cli(f, ['recheck', 'init', f.subject, '--out', f.out]).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.out, 'recheck.json')), bytes);
  const bad = fixture('context'); fs.writeFileSync(bad.subject, Buffer.from([0]));
  assert.notEqual(cli(bad, ['recheck', 'init', bad.subject, '--suite', bad.suite, '--out', bad.out]).status, 0);
  assert.equal(fs.existsSync(bad.out), false); noCalls(f); noCalls(bad);
});
test('AC-11 an outside path and linked receipt destination cannot write outside', () => {
  const f = fixture(), m = init(f);
  m.subject.path = '../subject'; fs.writeFileSync(path.join(f.out, 'recheck.json'), JSON.stringify(m));
  assert.notEqual(cli(f, ['recheck', 'run', f.out]).status, 0); noCalls(f);
  const g = fixture(); init(g);
  const outside = path.join(g.cwd, 'outside'); fs.mkdirSync(outside);
  fs.rmSync(path.join(g.out, 'receipts'), { force: true, recursive: true });
  fs.symlinkSync(outside, path.join(g.out, 'receipts'));
  assert.notEqual(cli(g, ['recheck', 'run', g.out]).status, 0);
  assert.deepEqual(fs.readdirSync(outside), []); noCalls(g);
});

// Reshaped only in memory for adversarial tests, never published as evidence.
function shaped(score, day) {
  const r = structuredClone(archived);
  r.run.date_utc = '2026-10-' + String(day).padStart(2, '0') + 'T00:00:00.000Z';
  for (const c of r.results.cases.filter(c => c.mode === 'with_skill')) {
    for (const d of c.generation.draws) { d.samples = d.samples.map(() => score); d.mean = score; d.stddev = 0; }
    Object.assign(c.generation, acrossDraws(c.generation.draws));
    c.mean = score; c.score = score; c.stddev = 0; c.samples = c.samples.map(() => score);
  }
  const calculated = comparisonOf(r.results.cases);
  r.results.aggregates = calculated.aggregates; r.comparison = calculated.comparison;
  return sealReceipt(r);
}
function differ(a, b) {
  try {
    const d = buildDriftReport(a, b, { mode: 'release' });
    const headline = /## Headline\s+\*\*([\s\S]*?)\*\*/.exec(d.markdown);
    assert.ok(headline);
    return { headline: headline[1].replace(/\u2014/g, ':'), per_case: d.perCase, refused: d.refused, refusal_reason: d.refusal_reason };
  } catch (e) {
    if (e.code === 'ERR_ASSERTION') throw e;
    return { error: e.message, code: e.code || null };
  }
}
function entries(rs) { return rs.map((receipt, i) => ({ file: String(rs.length - i) + '.json', receipt })); }
function rowContext(row, receipt) {
  assert.equal(row.date_utc, receipt.run.date_utc); assert.equal(row.model_id, receipt.run.model_id);
  assert.deepEqual(row.harness, receipt.run.harness || null);
  assert.equal(row.runner_version, receipt.run.runner_version);
  assert.deepEqual(row.judge, receipt.run.judge); assert.equal(row.surface, receipt.run.surface);
  assert.ok(Object.hasOwn(row.bands, 'with_skill') && Object.hasOwn(row.bands, 'baseline'));
}
for (const [label, score] of [['equal', 0.5], ['upward', 0.9], ['downward', 0.1], ['below-floor', 0.51]]) {
  test('AC-6 differ oracle and false-reading plant: ' + label, () => {
    const a = shaped(0.5, 1), b = shaped(score, 2), expected = differ(a, b);
    assert.equal(validateReceipt(a).valid, true); assert.equal(validateReceipt(b).valid, true);
    const h = api().buildRecheckHistory(entries([b, a]));
    assert.equal(h.rows.length, 2); assert.deepEqual(h.rows[1].previous.differ, expected);
    assert.deepEqual(h.rows[1].first.differ, expected);
    rowContext(h.rows[0], a); rowContext(h.rows[1], b);
    assert.equal(h.caveat, CAVEAT);
    assert.equal(h.conclusion, ['upward', 'downward'].includes(label) ? 'The same tests read differently' : NO_SEPARATION);
    const plant = structuredClone(h.rows[1].previous.differ); plant.headline = 'invented stable result';
    assert.throws(() => assert.deepEqual(plant, expected), { code: 'ERR_ASSERTION' });
    for (const key of ['harness', 'judge']) {
      const row = structuredClone(h.rows[1]); delete row[key];
      assert.throws(() => rowContext(row, b), { code: 'ERR_ASSERTION' });
    }
  });
}
test('AC-6 lost draws retain the differ reading', () => {
  const a = shaped(0.5, 1), b = shaped(0.7, 2), c = b.results.cases.find(c => c.mode === 'with_skill');
  c.generation.draws[0] = { draw_index: 0, generation_hash: null, status: 'unmeasured', reason: 'timeout', samples: [], mean: null, stddev: null, stop_reason: null, truncated: false };
  Object.assign(c.generation, acrossDraws(c.generation.draws));
  const changed = sealReceipt(b), h = api().buildRecheckHistory(entries([a, changed]));
  assert.deepEqual(h.rows[1].previous.differ, differ(a, changed));
});
function allRows(h, wanted) { assert.deepEqual(h.rows.map(x => x.file).sort(), wanted.slice().sort()); }
test('AC-7 incomplete stays adjacent; the omitted-row plant reads red', () => {
  const a = shaped(0.5, 1), b = shaped(0.5, 2), c = shaped(0.5, 3);
  b.run.status = 'incomplete';
  const incomplete = sealReceipt(b), input = entries([c, incomplete, a]);
  const h = api().buildRecheckHistory(input);
  allRows(h, input.map(x => x.file));
  assert.match(h.rows[1].status, /not measured/i); assert.match(h.rows[1].previous.reading, /not measured/i);
  assert.deepEqual(h.rows[2].previous.differ, differ(incomplete, c)); assert.deepEqual(h.rows[2].first.differ, differ(a, c));
  const plant = { ...h, rows: h.rows.filter(x => x.file !== input[1].file) };
  assert.throws(() => allRows(plant, input.map(x => x.file)), { code: 'ERR_ASSERTION' });
});
for (const key of ['model_id', 'surface', 'temperature', 'sampling', 'samples', 'prompt_template_hash', 'code_revision', 'isolation', 'endpoint', 'harness']) {
  test('AC-9 changed judge ' + key + ' prevents an eligible comparison', () => {
    const a = shaped(0.5, 1), b = shaped(0.8, 2);
    const values = { model_id: 'claude-sonnet-5-5', surface: 'openai-cli', temperature: 0.5,
      sampling: 'api-temperature-0', samples: 6, prompt_template_hash: '1'.repeat(64),
      code_revision: 'judge-code-1111111111111111', isolation: 'same-user',
      endpoint: { ...b.run.judge.endpoint, custom: true, sha256: '2'.repeat(64) },
      harness: { ...b.run.judge.harness, version: '9.9.9' } };
    b.run.judge[key] = values[key];
    if (key === 'samples') {
      b.run.counts.judge_samples_per_generation = 6;
      for (const c of b.results.cases) if (c.counts?.judge_samples_per_generation) c.counts.judge_samples_per_generation = 6;
    }
    assert.equal(validateReceipt(b).valid, true, JSON.stringify(validateReceipt(b).errors));
    const h = api().buildRecheckHistory(entries([a, sealReceipt(b)]));
    assert.match(h.rows[1].previous.reading, /not measured|refus/i);
    assert.notEqual(h.conclusion, 'The same tests read differently');
  });
}
test('AC-9 bad hash and unreadable entry remain visible without numbers', () => {
  const a = shaped(0.5, 1), b = structuredClone(a); b.run.date_utc = '2026-10-02T00:00:00.000Z';
  const h = api().buildRecheckHistory([...entries([a, b]), { file: 'bad.json', error: 'Invalid JSON' }]);
  assert.equal(h.rows.length, 3);
  for (const row of h.rows.filter(x => x.file !== '2.json')) {
    assert.match(row.status, /invalid|unreadable|not measured|refus/i); assert.equal(row.bands, null);
  }
});
test('AC-8/10 text carries every column, caveat and view command', () => {
  const f = fixture(); init(f); ok(cli(f, ['recheck', 'run', f.out]));
  const h = JSON.parse(ok(cli(f, ['recheck', 'history', f.out, '--json'])).stdout);
  const text = ok(cli(f, ['recheck', 'history', f.out])).stdout;
  const [r] = receipts(f); rowContext(h.rows[0], r.receipt);
  assert.ok(text.includes(CAVEAT));
  for (const word of ['harness not recorded', 'judge', 'surface', 'with', 'without', r.receipt.run.model_id, r.receipt.run.runner_version]) assert.ok(text.includes(word), word);
  assert.ok(text.includes('driftproof view')); assert.match(text, /no comparison|no comparable|not measured/i);
  assert.equal(h.conclusion, NOTHING_TO_COMPARE);
});
test('AC-10 empty history retains caveat and limited conclusion', () => {
  const h = api().buildRecheckHistory([]);
  assert.deepEqual(h.rows, []); assert.equal(h.caveat, CAVEAT); assert.equal(h.conclusion, NOTHING_TO_COMPARE);
});
test('AC-12 usage and public command explanation exist', () => {
  const f = fixture(), help = cli(f, ['--help']);
  assert.match(help.stdout, /recheck init/); assert.match(help.stdout, /recheck run/); assert.match(help.stdout, /recheck history/);
  assert.match(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), /driftproof recheck/);
});

test('AC-5 probe calibration sees the existing runner and stub provider calls', () => {
  const f = fixture();
  ok(cli(f, ['run', f.subject, '--models', MODEL, '--samples', '2', '--out', path.join(f.cwd, 'direct')]));
  const seen = trace(f);
  assert.equal(seen.filter(x => x.kind === 'runner').length, 1);
  assert.equal(seen.filter(x => x.kind === 'receipt').length, 1);
  const r = seen.find(x => x.kind === 'receipt').receipt;
  assert.equal(validateReceipt(r).valid, true); assert.equal(verifyReceiptHash(r), true);
  assert.equal(r.run.surface, 'stub'); assert.equal(r.verification_level, 'UNVERIFIED');
  const calls = r.results.cases.reduce((n, c) => n + c.generation.draws.reduce((sum, d) => sum + 1 + d.samples.length, 0), 0);
  assert.equal(seen.filter(x => x.kind === 'call').length, calls);
});

test('AC-6 mixed upward and downward tasks retain the whole differ reading', () => {
  const a = shaped(0.5, 1), b = shaped(0.9, 2);
  const c = b.results.cases.find(c => c.mode === 'with_skill');
  for (const d of c.generation.draws) { d.samples = d.samples.map(() => 0.1); d.mean = 0.1; d.stddev = 0; }
  Object.assign(c.generation, acrossDraws(c.generation.draws)); c.mean = 0.1; c.score = 0.1;
  const changed = sealReceipt(b), expected = differ(a, changed);
  assert.ok(expected.per_case.some(c => c.verdict === 'regression'));
  assert.ok(expected.per_case.some(c => c.verdict === 'improvement'));
  const h = api().buildRecheckHistory(entries([a, changed]));
  assert.deepEqual(h.rows[1].previous.differ, expected);
  assert.equal(h.conclusion, 'The same tests read differently');
});
for (const key of ['harness', 'isolation', 'endpoint', 'code_revision']) {
  test('AC-9 both judges missing ' + key + ' are unknown, not equal', () => {
    const a = shaped(0.5, 1), b = shaped(0.9, 2);
    delete a.run.judge[key]; delete b.run.judge[key];
    const h = api().buildRecheckHistory(entries([sealReceipt(a), sealReceipt(b)]));
    assert.match(h.rows[1].previous.reading, /not measured|refus|unknown/i);
    assert.notEqual(h.conclusion, 'The same tests read differently');
  });
}
for (const field of ['subject', 'suite', 'capture', 'rubric']) {
  test('AC-9 changed ' + field + ' is never compared as the same tests', () => {
    const a = shaped(0.5, 1), b = shaped(0.9, 2);
    if (field === 'subject') b.skill.content_hash = '1'.repeat(64);
    if (field === 'suite') b.suite.suite_hash = '1'.repeat(64);
    if (field === 'capture') b.run.capture.mode = 'files';
    if (field === 'rubric') b.results.cases[0].judge.rubric_hash = '1'.repeat(64);
    const h = api().buildRecheckHistory(entries([a, sealReceipt(b)]));
    // A-723-10: a plant that fails the schema has no comparison, and its row says not measured instead.
    assert.match(h.rows[1].previous ? h.rows[1].previous.reading : h.rows[1].status, /not measured|refus/i);
    assert.notEqual(h.conclusion, 'The same tests read differently');
  });
}
test('AC-9 previous and first chains do not cross target models', () => {
  const a = shaped(0.5, 1), b = shaped(0.8, 2), c = shaped(0.9, 3);
  b.run.model_id = a.run.model_id === 'claude-sonnet-5-5' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5';
  assert.notEqual(b.run.model_id, a.run.model_id, 'the plant must change the target model');
  const h = api().buildRecheckHistory(entries([c, sealReceipt(b), a]));
  assert.equal(h.rows.length, 3); assert.equal(h.rows[1].previous, null); assert.equal(h.rows[1].first, null);
  assert.deepEqual(h.rows[2].previous.differ, differ(a, c));
});
test('AC-4 settings remain inside the manifest seal', () => {
  for (const field of ['samples', 'draws_cap', 'capture', 'placebo', 'max_cases', 'max_calls', 'max_usd', 'concurrency']) {
    const f = fixture(), m = init(f);
    m.settings[field] = field === 'capture' ? 'files' : field === 'placebo' ? true : 999;
    fs.writeFileSync(path.join(f.out, 'recheck.json'), JSON.stringify(m));
    assert.notEqual(cli(f, ['recheck', 'run', f.out]).status, 0, field); noCalls(f);
  }
});
test('AC-11 invalid suite and subject link are rejected by init', () => {
  api();
  const f = fixture('context');
  fs.writeFileSync(f.suite, '{"cases":[]}');
  assert.notEqual(cli(f, ['recheck', 'init', f.subject, '--suite', f.suite, '--out', f.out]).status, 0);
  assert.equal(fs.existsSync(f.out), false); noCalls(f);
  const g = fixture('context'), link = path.join(g.cwd, 'linked.md');
  fs.symlinkSync(g.subject, link);
  assert.notEqual(cli(g, ['recheck', 'init', link, '--suite', g.suite, '--out', g.out]).status, 0);
  assert.equal(fs.existsSync(g.out), false); noCalls(g);
});


test('AC-3/5 context runs keep explicit settings across all saved targets', () => {
  const f = fixture('context');
  const m = init(f, ['--models', MODEL + ',claude-sonnet-5-5', '--judge-model', MODEL,
    '--samples', '2', '--timeout', '3', '--placebo']);
  fs.unlinkSync(f.subject); fs.unlinkSync(f.suite);
  ok(cli(f, ['recheck', 'run', f.out]));
  const runs = trace(f).filter(x => x.kind === 'runner');
  assert.deepEqual(runs.map(x => x.model), m.settings.models);
  for (const run of runs) {
    assert.equal(run.options.judgeModel, MODEL); assert.equal(run.options.samples, 2);
    assert.equal(run.options.timeoutMs, 3000); assert.equal(run.options.placebo, true);
    assert.equal(run.options.trusted, false);
  }
  const saved = receipts(f); assert.equal(saved.length, 2);
  for (const { receipt } of saved) {
    assert.equal(validateReceipt(receipt).valid, true); assert.equal(verifyReceiptHash(receipt), true);
    assert.equal(receipt.skill.unit, 'context_file');
    assert.deepEqual([...new Set(receipt.results.cases.map(c => c.mode))].sort(), ['baseline', 'placebo', 'with_skill']);
  }
});
test('AC-3 a frozen call cap refuses before any call', () => {
  const f = fixture(); init(f, ['--models', MODEL, '--max-calls', '1']);
  const r = cli(f, ['recheck', 'run', f.out]);
  assert.equal(r.status, 3); assert.match(r.stderr, /cost guard.*max-calls/);
  noCalls(f); assert.equal(receipts(f).length, 0);
});


test('AC-9 execution history compares the sealed hidden-test scoring identity', () => {
  // Valid resealed data stays in memory. No archived receipt is changed.
  const a = structuredClone(require('../receipts/report-016/receipt-fb8788547a36.json'));
  const b = structuredClone(a);
  a.run.date_utc = '2026-10-01T00:00:00.000Z'; b.run.date_utc = '2026-10-02T00:00:00.000Z';
  const first = sealReceipt(a), sameTests = sealReceipt(b);
  assert.equal(validateReceipt(first).valid, true); assert.equal(validateReceipt(sameTests).valid, true);
  assert.equal(api().buildRecheckHistory(entries([first, sameTests])).rows[1].previous.eligible, true);
  b.run.scoring.component_hashes.hidden_tests = '1'.repeat(64);
  const changedTests = sealReceipt(b);
  assert.equal(validateReceipt(changedTests).valid, true, 'plant must reach eligibility, not schema refusal');
  const comparison = api().buildRecheckHistory(entries([first, changedTests])).rows[1].previous;
  assert.deepEqual(comparison.differ, differ(first, changedTests));
  assert.equal(comparison.eligible, false);
  assert.match(comparison.reading, /not measured.*scoring/i);
});


test('AC-2/11 prototype keys cannot supply ignored subject settings', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.subject, '.driftproofrc'), '{"__proto__":{"samples":9,"capture":"files"}}');
  const m = init(f, []);
  assert.equal(m.settings.samples, require('../config').DEFAULT_JUDGE_SAMPLES);
  assert.equal(m.settings.capture, require('../lib/capture').DEFAULT_CAPTURE);
  assert.equal(m.sources.samples, 'default'); assert.equal(m.sources.capture, 'default');
  noCalls(f);
});
test('AC-11 inherited object names are not recheck subcommands', () => {
  const f = fixture(); init(f);
  for (const name of ['constructor', 'toString', '__proto__']) {
    const r = cli(f, ['recheck', name, f.out]);
    assert.equal(r.status, 2, name); assert.match(r.stderr, /use recheck/);
  }
  noCalls(f);
});

// A-723-7: the saved lane. A fake `claude` on the operator PATH shows which lane a run really took, as
// spec 022's AC-5 control does. It answers judge prompts with a grade, and no model is reached.
function claudeShim(f) {
  const { CLAUDE_CANNED, CLAUDE_JUDGE } = require('../specs/022-eval-user-isolation/probes/common');
  const dir = path.join(f.cwd, 'shim'), marker = path.join(f.cwd, 'shim-ran');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'claude'), '#!' + process.execPath + '\n' +
    'const fs=require("fs");fs.appendFileSync(' + JSON.stringify(marker) + ',"x\\n");\n' +
    'if(process.argv.includes("--version")){process.stdout.write("1.0.0 (Claude Code)\\n");process.exit(0);}\n' +
    'let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>process.stdout.write(/Return ONLY this JSON object/.test(input)?' +
    JSON.stringify(CLAUDE_JUDGE) + ':' + JSON.stringify(CLAUDE_CANNED) + '));\n', { mode: 0o755 });
  return { marker, env: { PATH: dir + path.delimiter + process.env.PATH, DRIFTPROOF_STUB: undefined, NODE_OPTIONS: undefined, SPEC723_TRACE: undefined, DRIFTPROOF_EVAL_USER: 'driftproof-eval-does-not-exist' } };
}
const lastRunner = f => trace(f).filter(x => x.kind === 'runner').at(-1);
function reseal(f, m) {
  const bytes = JSON.stringify(m, null, 2) + '\n';
  fs.writeFileSync(path.join(f.out, 'recheck.json'), bytes);
  fs.writeFileSync(path.join(f.out, 'recheck.sha256'), sha(bytes) + '\n');
}
test('A-723-7 a trusted folder reaches the operator-path CLI; an untrusted folder does not', () => {
  const t = fixture(), shim = claudeShim(t);
  ok(cli(t, ['recheck', 'init', t.subject, '--models', MODEL, '--samples', '1', '--trusted-skill', '--out', t.out], shim.env));
  const m = read(path.join(t.out, 'recheck.json'));
  assert.equal(m.settings.trusted, true); assert.equal(m.sources.trusted, 'flag');
  assert.equal(fs.existsSync(shim.marker), false, 'init calls no CLI');
  const run = ok(cli(t, ['recheck', 'run', t.out, '--trusted-skill'], shim.env));
  assert.ok(fs.existsSync(shim.marker), 'the saved lane reached the operator-path CLI');
  assert.match(run.stdout, /isolation: same-user/);
  const [saved] = receipts(t);
  assert.equal(saved.receipt.run.judge.isolation, 'same-user');
  assert.equal(saved.receipt.run.answered_by.isolation, 'same-user');

  const u = fixture(), other = claudeShim(u);
  ok(cli(u, ['recheck', 'init', u.subject, '--models', MODEL, '--samples', '1', '--out', u.out], other.env));
  const refused = cli(u, ['recheck', 'run', u.out], other.env);
  assert.notEqual(refused.status, 0, refused.stdout);
  assert.equal(fs.existsSync(other.marker), false, 'an untrusted folder never reaches the operator-path CLI');
  assert.doesNotMatch(refused.stdout, /isolation: same-user/);
  assert.match(refused.stderr + refused.stdout, /eval|hop|sudo|isolat/i);
  assert.equal(receipts(u).length, 0);
});
test('A-723-7 only the flag sets the lane, the seal holds it, and the stub trace reads it', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.cwd, '.driftproofrc'), JSON.stringify({ trusted_skill: true, trusted: true, 'trusted-skill': true }));
  const plain = init(f, ['--models', MODEL]);
  assert.equal(plain.settings.trusted, false); assert.equal(plain.sources.trusted, 'default');
  assert.ok(plain.procedure.targets.every(x => x.isolation === 'eval-user' && x.judge_isolation === 'eval-user'));
  ok(cli(f, ['recheck', 'run', f.out]));
  assert.equal(lastRunner(f).options.trusted, false);

  const t = fixture(), m = init(t, ['--models', MODEL, '--trusted-skill']);
  assert.ok(m.procedure.targets.every(x => x.isolation === 'same-user' && x.judge_isolation === 'same-user'));
  ok(cli(t, ['recheck', 'run', t.out, '--trusted-skill']));
  assert.equal(lastRunner(t).options.trusted, true);

  const edited = fixture(), em = init(edited, ['--models', MODEL]);
  em.settings.trusted = true;
  fs.writeFileSync(path.join(edited.out, 'recheck.json'), JSON.stringify(em));
  assert.notEqual(cli(edited, ['recheck', 'run', edited.out]).status, 0); noCalls(edited);

  const flipped = fixture(), fm = init(flipped, ['--models', MODEL]);
  fm.settings.trusted = true; reseal(flipped, fm);
  const stale = cli(flipped, ['recheck', 'run', flipped.out, '--trusted-skill']);
  assert.notEqual(stale.status, 0); assert.match(stale.stderr, /procedure changed/); noCalls(flipped);
});
test('A-723-7 a folder saved with no lane runs as it always did', () => {
  const f = fixture(), m = init(f, ['--models', MODEL]);
  delete m.settings.trusted; delete m.sources.trusted; reseal(f, m);
  const run = ok(cli(f, ['recheck', 'run', f.out]));
  assert.equal(lastRunner(f).options.trusted, false);
  assert.doesNotMatch(run.stdout, /isolation: same-user/);
});
test('A-723-7 history refuses the flag, which takes no value and is not saved beside repository capture', () => {
  const f = fixture(); init(f, ['--models', MODEL]);
  const refused = cli(f, ['recheck', 'history', f.out, '--trusted-skill']);
  assert.equal(refused.status, 2, refused.stderr); assert.match(refused.stderr, /trusted-skill/);
  const g = fixture();
  for (const spelling of [['--trusted-skill=false'], ['--trusted-skill', 'false']]) {
    assert.equal(cli(g, ['recheck', 'init', g.subject, ...spelling, '--out', g.out]).status, 2, spelling.join(' '));
    assert.equal(fs.existsSync(g.out), false);
  }
  const r = cli(g, ['recheck', 'init', g.subject, '--capture', 'repository', '--trusted-skill', '--out', g.out]);
  assert.equal(r.status, 2, r.stderr); assert.match(r.stderr, /repository capture/i);
  assert.equal(fs.existsSync(g.out), false); noCalls(f); noCalls(g);
});
test('A-723-7 readings from different lanes never compare', () => {
  const control = api().buildRecheckHistory(entries([shaped(0.5, 1), shaped(0.8, 2)])).rows[1].previous;
  assert.equal(control.eligible, true, 'one lane compares');
  const plants = {
    'both lanes': r => { r.run.judge.isolation = 'same-user'; r.run.answered_by.isolation = 'same-user'; },
    'the answering lane alone': r => { r.run.answered_by.isolation = 'same-user'; },
    'the judge lane alone': r => { r.run.judge.isolation = 'same-user'; },
  };
  for (const [label, change] of Object.entries(plants)) {
    const b = shaped(0.8, 2); change(b);
    assert.equal(validateReceipt(b).valid, true, label);
    const h = api().buildRecheckHistory(entries([shaped(0.5, 1), sealReceipt(b)]));
    assert.equal(h.rows[1].previous.eligible, false, label);
    assert.match(h.rows[1].previous.reading, /not measured.*(lane|isolation)/i, label);
    assert.notEqual(h.conclusion, 'The same tests read differently', label);
  }
});
test('A-723-8 a trusted folder run without the flag refuses before any call and never reaches the operator-path CLI', async () => {
  const f = fixture(), m = init(f, ['--models', MODEL, '--trusted-skill']);
  assert.equal(m.settings.trusted, true);
  const r = cli(f, ['recheck', 'run', f.out]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /the folder was saved to run on your own CLI; pass --trusted-skill if this file is yours/);
  assert.doesNotMatch(r.stdout, /isolation: same-user/);
  noCalls(f); assert.equal(receipts(f).length, 0);

  const received = fixture(), shim = claudeShim(received);
  ok(cli(received, ['recheck', 'init', received.subject, '--models', MODEL, '--samples', '1', '--trusted-skill', '--out', received.out], shim.env));
  assert.equal(cli(received, ['recheck', 'run', received.out], shim.env).status, 2);
  assert.equal(fs.existsSync(shim.marker), false, 'no flag, no same-user call');
  assert.equal(receipts(received).length, 0);

  const provider = require('../lib/provider'), original = provider.complete;
  let calls = 0;
  provider.complete = () => { calls++; throw Error('No provider call allowed'); };
  try {
    await assert.rejects(async () => api().runRecheck(f.out), /saved to run on your own CLI/);
    assert.equal(calls, 0); assert.equal(receipts(f).length, 0);
  } finally { provider.complete = original; }
});
test('A-723-8 an untrusted folder refuses the flag before any call, with or without a saved lane', () => {
  const f = fixture(); init(f, ['--models', MODEL]);
  const r = cli(f, ['recheck', 'run', f.out, '--trusted-skill']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /the lane would change, so the readings could not compare/);
  noCalls(f); assert.equal(receipts(f).length, 0);

  const old = fixture(), m = init(old, ['--models', MODEL]);
  delete m.settings.trusted; delete m.sources.trusted; reseal(old, m);
  const refused = cli(old, ['recheck', 'run', old.out, '--trusted-skill']);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /the lane would change/);
  noCalls(old); assert.equal(receipts(old).length, 0);
});
test('A-723-9 --json reads the folder in either position, and still takes no value', () => {
  const f = fixture(); init(f, ['--models', MODEL]); ok(cli(f, ['recheck', 'run', f.out]));
  const before = JSON.parse(ok(cli(f, ['recheck', 'history', '--json', f.out])).stdout);
  const after = JSON.parse(ok(cli(f, ['recheck', 'history', f.out, '--json'])).stdout);
  const first = JSON.parse(ok(cli(f, ['recheck', '--json', 'history', f.out])).stdout);
  assert.equal(before.rows.length, 1);
  assert.deepEqual(before, after); assert.deepEqual(first, after);
  for (const args of [['recheck', 'history', f.out, '--json=x'], ['recheck', 'history', '--json=' + f.out], ['recheck', 'history', f.out, '--json', 'stray']]) {
    assert.equal(cli(f, args).status, 2, args.join(' '));
  }
});
const unreadableOracle = (text, n) => {
  const lines = text.split('\n'), at = lines.findIndex(l => /could not be read/.test(l));
  assert.ok(at >= 0, 'the sentence is there');
  assert.equal(lines.filter(l => /could not be read/.test(l)).length, 1, 'said once');
  assert.match(lines[at], new RegExp('^' + n + ' receipt file'));
  assert.ok(lines.slice(0, at).every(l => l.includes(' | ')), 'under the list');
  assert.ok(lines.slice(at + 1).some(l => l === CAVEAT), 'above the closing lines');
};
test('A-723-9 an unreadable receipt is said once under the list, and a clean history says nothing', () => {
  const a = shaped(0.5, 1), b = shaped(0.8, 2), bad = n => ({ file: 'bad-' + n + '.json', error: 'receipt is unreadable' });
  const clean = api().buildRecheckHistory(entries([a, b]));
  assert.equal(clean.unreadable_note, null);
  assert.doesNotMatch(api().formatRecheckHistory(clean), /could not be read/);
  const one = api().buildRecheckHistory([...entries([a, b]), bad(1)]);
  assert.match(one.unreadable_note, /^1 receipt file here could not be read/);
  assert.equal(one.rows[1].previous.eligible, true, 'the later reading still compares with the earlier one, which is why it must be said');
  unreadableOracle(api().formatRecheckHistory(one), 1);
  const two = api().buildRecheckHistory([...entries([a, b]), bad(1), bad(2)]);
  assert.match(two.unreadable_note, /^2 receipt files here could not be read/);
  unreadableOracle(api().formatRecheckHistory(two), 2);
  assert.throws(() => unreadableOracle(api().formatRecheckHistory({ ...one, unreadable_note: null }), 1), 'a text with no sentence fails');

  const f = fixture(); init(f, ['--models', MODEL]); ok(cli(f, ['recheck', 'run', f.out]));
  fs.writeFileSync(path.join(f.out, 'receipts', 'broken.json'), '{not json');
  const text = ok(cli(f, ['recheck', 'history', f.out])).stdout;
  assert.match(text, /^1 receipt file here could not be read/m);
  assert.match(JSON.parse(ok(cli(f, ['recheck', 'history', f.out, '--json'])).stdout).unreadable_note, /could not be read/);
});

// A-723-10. The hidden characters are written as escapes, so this file holds none of them.
const HIDDEN = '\u{E0041}\u{E0042}\u{200B}';
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const historyOf = (f, ...flags) => ok(cli(f, ['recheck', 'history', f.out, ...flags])).stdout;
function savedFolder() { const f = fixture(); init(f, ['--models', MODEL]); return f; }
const receiptsDir = f => path.join(f.out, 'receipts');
test('A-723-10 a receipt that fails its checks is listed by name and fixed words, with nothing read from inside it', () => {
  const f = savedFolder(), unsealed = shaped(0.5, 1);
  unsealed.run.model_id = 'claude' + HIDDEN + ' SECRET-INSTRUCTION'; unsealed.run.harness = { name: HIDDEN + 'SECRET-HARNESS', version: '1' };
  fs.writeFileSync(path.join(receiptsDir(f), 'bad' + HIDDEN + '.json'), JSON.stringify(unsealed));
  const schema = structuredClone(shaped(0.5, 2)); delete schema.run.provider; schema.run.date_utc = HIDDEN + 'SECRET-DATE';
  fs.writeFileSync(path.join(receiptsDir(f), 'schema.json'), JSON.stringify(sealReceipt(schema)));
  const text = historyOf(f), json = historyOf(f, '--json');
  for (const out of [text, json]) { assert.doesNotMatch(out, IGNORABLE); assert.doesNotMatch(out, /SECRET-/); }
  assert.match(text, /bad\\u\{e0041\}\\u\{e0042\}\\u\{200b\}\.json \| not measured: receipt hash is invalid/);
  assert.match(text, /^schema\.json \| not measured: receipt (hash|schema) is invalid$/m);
  assert.match(text, /^2 receipt files here could not be read/m);
  const row = JSON.parse(json).rows.find(r => r.file === 'schema.json');
  for (const key of ['date_utc', 'model_id', 'harness', 'runner_version', 'judge', 'surface', 'bands', 'previous', 'first']) assert.equal(row[key], null, key);
});
test('A-723-10 a valid receipt has every hidden character shown and each field cut', () => {
  const big = shaped(0.5, 1); big.run.model_id = 'm'.repeat(1 << 20) + HIDDEN;
  const sealed = sealReceipt(big);
  assert.equal(validateReceipt(sealed).valid, true); assert.equal(verifyReceiptHash(sealed), true);
  const longText = api().formatRecheckHistory(api().buildRecheckHistory(entries([sealed])));
  assert.ok(longText.length < 5000, 'the field is capped');
  assert.match(longText, new RegExp('m{300} \\[cut, ' + big.run.model_id.length + ' characters in all\\]'));
  const hidden = shaped(0.5, 1); hidden.run.model_id = 'model' + HIDDEN;
  const text = api().formatRecheckHistory(api().buildRecheckHistory(entries([sealReceipt(hidden)])));
  assert.doesNotMatch(text, IGNORABLE);
  assert.match(text, /model\\u\{e0041\}\\u\{e0042\}\\u\{200b\}/);
  const json = api().historyJson(api().buildRecheckHistory(entries([sealReceipt(big)])));
  assert.ok(json.length < 200000, 'the JSON fields are capped');
  assert.doesNotMatch(json, IGNORABLE);
  const names = require('../lib/names');
  assert.equal(names.invisibleShown('a' + HIDDEN + 'b'), 'a\\u{e0041}\\u{e0042}\\u{200b}b');
  assert.equal(names.invisibleShown('plain name'), 'plain name');
  assert.equal(names.shellArg('a\u{200B}b'), "$'a\\xe2\\x80\\x8bb'");
});
test('A-723-10 a folder of N+1 receipts prints N and says the list was cut', () => {
  const N = api().HISTORY_MAX_ROWS, f = savedFolder();
  for (let i = 0; i < N; i++) fs.writeFileSync(path.join(receiptsDir(f), 'r' + String(i).padStart(4, '0') + '.json'), '{}');
  const exact = historyOf(f);
  assert.equal(exact.split('\n').filter(l => l.includes(' | ')).length, N);
  assert.doesNotMatch(exact, /list was cut/);
  fs.writeFileSync(path.join(receiptsDir(f), 'r' + String(N).padStart(4, '0') + '.json'), '{}');
  const text = historyOf(f), rows = text.split('\n').filter(l => l.includes(' | '));
  assert.equal(rows.length, N);
  assert.ok(!rows.some(l => l.startsWith('r0000.json')), 'the oldest name is the one dropped');
  assert.match(text, new RegExp('^The list was cut: only the last ' + N + ' of ' + (N + 1) + ' receipt files'  , 'm'));
  assert.equal(JSON.parse(historyOf(f, '--json')).rows.length, N);
});
test('A-723-10 the closing lines say what was and was not compared, in plain words', () => {
  const pair = api().buildRecheckHistory(entries([shaped(0.5, 1), shaped(0.5, 2)]));
  assert.equal(pair.conclusion, NO_SEPARATION);
  assert.equal(api().formatRecheckHistory(pair).split('\n').at(-1), NO_SEPARATION);
  const single = api().buildRecheckHistory(entries([shaped(0.5, 1)]));
  assert.equal(single.conclusion, NOTHING_TO_COMPARE);
  const low = shaped(0.5, 2); low.verification_level = 'UNVERIFIED';
  const sealedLow = sealReceipt(low);
  assert.equal(validateReceipt(sealedLow).valid, true);
  const h = api().buildRecheckHistory(entries([shaped(0.5, 1), sealedLow]));
  assert.match(h.rows[1].status, /^not measured: its verification level is below TESTED$/);
  assert.match(h.rows[1].previous.reading, /^Not measured: /);
  assert.match(h.rows[1].previous.differ.headline, /^NOT MEASURED/, 'the differ block keeps its own text');
  assert.doesNotMatch(api().formatRecheckHistory(h), /NOT MEASURED|REFUSED|DRIFT|IMPROVED|MIXED/);
  assert.equal(h.conclusion, NOTHING_TO_COMPARE);
  const down = api().buildRecheckHistory(entries([shaped(0.5, 1), shaped(0.1, 2)]));
  assert.match(down.rows[1].previous.reading, /^separated on task/);
  assert.equal(down.conclusion, 'The same tests read differently');
});
test('A-723-10 init refuses an output folder inside the skill, and leaves the skill unchanged', () => {
  const f = fixture(), before = require('../lib/skill').loadSubject(f.subject).contentHash, here = { ...f, cwd: f.subject };
  for (const args of [['recheck', 'init', '.'], ['recheck', 'init', '.', '--out', 'sub/rk'], ['recheck', 'init', f.subject, '--out', path.join(f.subject, 'rk')]]) {
    const r = cli(here, args);
    assert.equal(r.status, 2, args.join(' ') + r.stderr);
    assert.match(r.stderr, /inside the skill/);
  }
  assert.equal(fs.existsSync(path.join(f.subject, 'recheck')), false);
  assert.equal(require('../lib/skill').loadSubject(f.subject).contentHash, before);
});
test('A-723-10 a skill with no name seals the name run would give it', () => {
  const f = fixture(), tone = path.join(f.cwd, 'tone-guide');
  fs.renameSync(f.subject, tone); fs.writeFileSync(path.join(tone, 'SKILL.md'), 'Write in a calm tone.\n');
  f.subject = tone;
  const m = init(f, ['--models', MODEL]);
  assert.equal(m.subject.name, 'tone-guide');
  ok(cli(f, ['recheck', 'run', f.out]));
  ok(cli(f, ['run', tone, '--models', MODEL, '--samples', '2', '--out', path.join(f.cwd, 'plain')]));
  const direct = read(path.join(f.cwd, 'plain', fs.readdirSync(path.join(f.cwd, 'plain')).find(n => n.endsWith('.json'))));
  assert.equal(receipts(f)[0].receipt.skill.name, direct.skill.name);
  assert.equal(receipts(f)[0].receipt.skill.content_hash, direct.skill.content_hash);
  const named = fixture(), saved = init(named, ['--models', MODEL]);
  assert.equal(saved.subject.name, undefined, 'a skill with an H1 keeps its own name');
});
test('A-723-10 a folder with no receipts folder runs and reads as empty', () => {
  const f = savedFolder(); fs.rmdirSync(receiptsDir(f));
  const history = historyOf(f);
  assert.ok(history.split('\n').includes(NOTHING_TO_COMPARE));
  assert.equal(fs.existsSync(receiptsDir(f)), false, 'history does not create it');
  ok(cli(f, ['recheck', 'run', f.out]));
  assert.equal(receipts(f).length, 1);
  assert.equal(fs.statSync(receiptsDir(f)).mode & 0o777, 0o700);
});
test('A-723-10 the files the loader ignores are ignored, and a changed set names the file', () => {
  const f = savedFolder(), m = read(path.join(f.out, 'recheck.json'));
  fs.writeFileSync(path.join(f.out, m.subject.path, '.DS_Store'), 'finder');
  ok(cli(f, ['recheck', 'run', f.out]));
  assert.equal(receipts(f).length, 1);
  fs.writeFileSync(path.join(f.out, m.subject.path, 'extra.md'), 'More.');
  const added = cli(f, ['recheck', 'run', f.out]);
  assert.equal(added.status, 2); assert.match(added.stderr, /subject\/extra\.md/);
  fs.unlinkSync(path.join(f.out, m.subject.path, 'extra.md'));
  fs.unlinkSync(path.join(f.out, m.subject.path, 'bundle.bin'));
  const lost = cli(f, ['recheck', 'run', f.out]);
  assert.equal(lost.status, 2); assert.match(lost.stderr, /subject\/bundle\.bin/);
});
test('A-723-10 on the isolated lane a missing account refuses in one line and says what works', () => {
  const f = fixture(), shim = claudeShim(f);
  ok(cli(f, ['recheck', 'init', f.subject, '--models', MODEL, '--samples', '1', '--out', f.out], shim.env));
  const r = cli(f, ['recheck', 'run', f.out], shim.env);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /isolation account driftproof-eval-does-not-exist/);
  assert.match(r.stderr, /save a new recheck folder with recheck init --trusted-skill/);
  assert.match(r.stderr, /comparable only with each other/);
  assert.doesNotMatch(r.stderr, /pass --trusted-skill/);
  assert.equal(r.stderr.trim().split('\n').length, 1, 'one line');
  assert.equal(fs.existsSync(shim.marker), false); assert.equal(receipts(f).length, 0);
  const flagged = cli(f, ['recheck', 'run', f.out, '--trusted-skill'], shim.env);
  assert.equal(flagged.status, 2);
  assert.match(flagged.stderr, /the lane would change/);
  assert.match(flagged.stderr, /save a new recheck folder with recheck init --trusted-skill/);
});
test('A-723-10 an environment change names what moved, and repository timeouts are the runner\'s', () => {
  const f = savedFolder();
  const r = cli(f, ['recheck', 'run', f.out], { CLAUDE_PROVIDER: 'api' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /was saved on the claude-cli surface and this environment reaches it on api/);
  assert.match(r.stderr, /restore that setting/);
  assert.doesNotMatch(r.stderr, /installed sampling/);
  noCalls(f);
  const g = fixture(), m = init(g, ['--models', MODEL, '--capture', 'repository']);
  assert.equal(m.settings.timeout.generation_ms[MODEL], require('../lib/run').resolveCallTimeoutMs(m.procedure.targets[0].surface, { capture: 'repository' }));
  assert.equal(m.procedure.targets[0].generation_timeout_ms, m.settings.timeout.generation_ms[MODEL]);
});
test('A-723-10 init refuses a files capture no run would accept', () => {
  const f = fixture();
  const r = cli(f, ['recheck', 'init', f.subject, '--models', MODEL, '--capture', 'files', '--out', f.out], { DRIFTPROOF_STUB: undefined, NODE_OPTIONS: undefined, SPEC723_TRACE: undefined, CLAUDE_PROVIDER: 'api' });
  assert.equal(r.status, 2, r.stderr); assert.match(r.stderr, /capture files/);
  assert.equal(fs.existsSync(f.out), false);
});
test('A-723-10 no recheck refusal prints a raw Node error or an absolute path', () => {
  const f = fixture(), pathy = new RegExp(f.cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const cases = [
    [['recheck', 'init', f.subject, '--out'], /--out needs a value/],
    [['recheck', 'init', f.subject, '--suite'], /--suite needs a value/],
    [['recheck', 'init', f.subject, '--out', path.join(f.cwd, 'new/sub/rk')], /does not exist/],
    [['recheck', 'run', path.join(f.cwd, 'nofolder')], /nofolder does not exist/],
    [['recheck', 'history', path.join(f.cwd, 'nofolder')], /nofolder does not exist/],
    [['recheck', 'init', path.join(f.cwd, 'absent.md'), '--suite', f.suite, '--out', f.out], /./],
  ];
  for (const [args, re] of cases) {
    const r = cli(f, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, re, args.join(' '));
    assert.doesNotMatch(r.stderr, /ENOENT|paths\[1\]|lstat/, args.join(' '));
    assert.doesNotMatch(r.stderr, pathy, args.join(' '));
  }
  assert.equal(api().refusalWords(Object.assign(new Error('x'), { code: 'ENOENT', syscall: 'open', path: path.join(f.cwd, 'gone.json') })), 'gone.json does not exist');
  assert.equal(api().refusalWords(new Error('the suite /a/b/c.json is not there')), 'the suite c.json is not there');
});
