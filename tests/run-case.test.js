// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 612: `driftproof run --case <id>` runs only the named test cases, in the
// suite's order, and a run of fewer cases than its suite gets no verdict.
//
//   node --test tests/run-case.test.js
//
// No model is called. A run is a stub run (DRIFTPROOF_STUB=1), or is answered by spec 028's fake
// `claude` (specs/028-claude-code-plugin/probes/bin/claude), first on PATH, on the trusted lane, which
// logs every spawn, so a refusal before any call reads as an empty spawn log. No credential is in any
// environment here. Every file is written under the system temp directory and removed after.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { validateReceipt } = require('../lib/receipt');
const { receiptVerdict } = require('../lib/verdict');
const { decisionState } = require('../lib/decision');
const { staleReport } = require('../lib/stale');
const { sideBySide } = require('../lib/view');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const { LAUNCHER: DOOR } = require('../specs/028-claude-code-plugin/probes/door-copy.cjs');
const FAKE_BIN = path.join(ROOT, 'specs', '028-claude-code-plugin', 'probes', 'bin');
const MODEL = 'claude-haiku-4-5';
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec612-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function env({ stub = true, log = null, extra = {} } = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^SPEC0|^SOURCE_DATE_EPOCH$|^GIT_/.test(k)) continue;
    e[k] = v;
  }
  e.PATH = [FAKE_BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
  if (log) e.SPEC028_SPAWNLOG = log;
  return { ...e, ...(stub ? { DRIFTPROOF_STUB: '1' } : {}), ...extra };
}
const cli = (args, cwd, opts) => spawnSync(process.execPath, [BIN, ...args], { cwd, env: env(opts), encoding: 'utf8', timeout: 300000 });
const spawnsIn = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);

function skill(root, n, name = `fx-skill-${n}`) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\nversion: 1.0.0\n---\n\n# ${name}\n\nAnswer in one short sentence.\n`);
  const cases = Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, prompt: `Question ${i + 1}?`, rubric: 'One short sentence scores 0.80.' }));
  fs.writeFileSync(path.join(dir, 'evals', 'evals.json'), JSON.stringify({ cases }, null, 2));
  return dir;
}
function receiptIn(dir) {
  const f = fs.readdirSync(dir).filter((x) => x.endsWith('.json'));
  assert.equal(f.length, 1, `one receipt in ${dir}: ${f}`);
  const file = path.join(dir, f[0]);
  return { file, receipt: JSON.parse(fs.readFileSync(file, 'utf8')), summary: fs.readFileSync(file.replace(/\.json$/, '.summary.md'), 'utf8') };
}
const clone = (x) => JSON.parse(JSON.stringify(x));

// The stub fixtures: one three-case suite, run narrowed with the flags out of order and repeated, and
// run whole.
let FX = null;
function fixtures() {
  if (FX) return FX;
  const root = tmp();
  const three = skill(root, 3);
  const out = (n) => path.join(root, n);
  const narrowed = cli(['run', three, '--models', MODEL, '--samples', '1', '--case', 'c3', '--case', 'c1', '--case=c1', '--out', out('narrowed')], root);
  const full = cli(['run', three, '--models', MODEL, '--samples', '1', '--out', out('full')], root);
  for (const [n, r] of [['narrowed', narrowed], ['full', full]]) assert.equal(r.status, 0, `${n}: ${r.stderr.slice(-800)}`);
  FX = { root, three, narrowed, full, n: receiptIn(out('narrowed')), f: receiptIn(out('full')) };
  return FX;
}

// ── AC-1 ────────────────────────────────────────────────────────────────────────────────────────────
// Each arm's rows, by id, in receipt order, are exactly the named cases in the suite's order.
function readSelection(receipt, want) {
  for (const mode of ['with_skill', 'baseline']) {
    assert.deepEqual(receipt.results.cases.filter((c) => c.mode === mode).map((c) => c.id), want, `${mode}: the named cases, once each, in suite order`);
  }
  assert.deepEqual([...new Set(receipt.results.cases.map((c) => c.mode))].sort(), ['baseline', 'with_skill']);
}
test('AC-1: --case runs exactly the named cases on both arms, in suite order, a repeated id once', () => {
  const { n } = fixtures();
  readSelection(n.receipt, ['c1', 'c3']);
  const flagOrder = clone(n.receipt);
  flagOrder.results.cases = [...flagOrder.results.cases.filter((c) => c.id === 'c3'), ...flagOrder.results.cases.filter((c) => c.id === 'c1')];
  assert.throws(() => readSelection(flagOrder, ['c1', 'c3']), assert.AssertionError, 'a selection in flag order');
  const extra = clone(n.receipt);
  extra.results.cases.push(...extra.results.cases.filter((c) => c.id === 'c1').map((c) => ({ ...c, id: 'c2' })));
  assert.throws(() => readSelection(extra, ['c1', 'c3']), assert.AssertionError, 'a case not named');
});

// ── AC-2 ────────────────────────────────────────────────────────────────────────────────────────────
function readSuiteHeld(narrowed, full) {
  assert.equal(narrowed.suite.case_count, 3, 'the suite holds three cases');
  for (const k of ['case_count', 'suite_hash', 'canary', 'format']) assert.deepEqual(narrowed.suite[k], full.suite[k], `suite.${k} is the full suite's`);
}
test('AC-2: a narrowed receipt carries the full suite\'s case count, suite hash and canary', () => {
  const { n, f } = fixtures();
  assert.ok(n.receipt.suite.canary, 'the receipt carries a canary');
  readSuiteHeld(n.receipt, f.receipt);
  const cut = clone(n.receipt);
  cut.suite.case_count = 2;
  assert.throws(() => readSuiteHeld(cut, f.receipt), assert.AssertionError, 'the narrowed count recorded as the suite\'s');
});

// ── AC-3 ────────────────────────────────────────────────────────────────────────────────────────────
// The receipt as a TESTED run by a model would write it: a plant that removes every other refusal.
function asTested(receipt) {
  const r = clone(receipt);
  r.verification_level = 'TESTED';
  r.run.answered_by = { kind: 'model', model_id: MODEL };
  if (typeof r.comparison.delta !== 'number') r.comparison.delta = 0.1;
  return r;
}
test('AC-3: a narrowed run reads NOT_MEASURED by the incomplete route, and decide reads it inconclusive', () => {
  const { n } = fixtures();
  const v = receiptVerdict(n.receipt);
  assert.equal(v.verdict, 'NOT_MEASURED');
  assert.ok(v.notMeasured.includes('incomplete'), JSON.stringify(v.notMeasured));
  // The plant: the receipt read TESTED after narrowing. Only the incomplete route is left, and it holds.
  const tested = asTested(n.receipt);
  const t = receiptVerdict(tested);
  assert.equal(t.verdict, 'NOT_MEASURED');
  assert.deepEqual(t.notMeasured, ['incomplete']);
  assert.ok(['inconclusive', 'regression'].includes(decisionState(tested)), decisionState(tested));
  assert.notEqual(decisionState(tested), 'pass');
  // The same plant with the suite's count cut to the cases run reads a verdict: the reading rests on AC-2.
  const cut = asTested(n.receipt);
  cut.suite.case_count = 2;
  assert.ok(!(receiptVerdict(cut).notMeasured || []).includes('incomplete'), 'with the count cut, the incomplete route does not fire');
});

// ── AC-4 ────────────────────────────────────────────────────────────────────────────────────────────
// Every refusal on the fake claude's trusted lane: exit 2, no model line, no output folder, no spawn.
function refusedBeforeAnyCall(args, extraFiles = () => {}) {
  const root = tmp();
  const three = skill(root, 3);
  extraFiles(root);
  const log = path.join(root, 'spawns.ndjson');
  const o = path.join(root, 'o');
  const r = cli(['run', three, '--trusted-skill', '--models', MODEL, ...args, '--out', o], root, { stub: false, log });
  assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /REFUSED/);
  assert.doesNotMatch(r.stdout, /── model:/);
  assert.equal(fs.existsSync(o), false, 'no output folder');
  assert.equal(fs.existsSync(path.join(root, 'transcripts')), false, 'no transcripts');
  assert.deepEqual(spawnsIn(log), [], 'nothing was spawned');
  return r;
}
test('AC-4: the plant, an accepted --case run on the same lane spawns the fake claude', () => {
  const root = tmp();
  const three = skill(root, 3);
  const log = path.join(root, 'spawns.ndjson');
  const r = cli(['run', three, '--trusted-skill', '--models', MODEL, '--samples', '1', '--case', 'c2', '--out', path.join(root, 'o')], root, { stub: false, log });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(spawnsIn(log).length > 0, 'an accepted run reaches the fake');
  readSelection(receiptIn(path.join(root, 'o')).receipt, ['c2']);
});
test('AC-4: an id not in the suite is refused before any call, naming it and the suite\'s ids', () => {
  const r = refusedBeforeAnyCall(['--case', 'c1', '--case', 'nope']);
  assert.match(r.stderr, /"nope"/);
  assert.doesNotMatch(r.stderr, /"c1" is not/);
  for (const id of ['c1', 'c2', 'c3']) assert.ok(r.stderr.includes(`"${id}"`), `the suite's id ${id} is listed`);
});
test('AC-4: --case with no value, an empty value or a control character is refused before any call', () => {
  assert.match(refusedBeforeAnyCall(['--case']).stderr, /case: expected a test case id/);
  assert.match(refusedBeforeAnyCall(['--case=']).stderr, /case: expected a test case id/);
  assert.match(refusedBeforeAnyCall(['--case', '--samples', '1']).stderr, /case: expected a test case id/);
  const ctl = refusedBeforeAnyCall(['--case', 'c1\u001b[31m']);
  assert.match(ctl.stderr, /case: contains a control character/);
  assert.ok(!/\u001b/.test(ctl.stderr), 'the refusal writes no control character');
  assert.match(refusedBeforeAnyCall(['--case', 'c1\u0085']).stderr, /control character/);
});
test('AC-4: --case beside --max-cases, two beside --quick, and with a checkpoint run are refused', () => {
  assert.match(refusedBeforeAnyCall(['--case', 'c1', '--max-cases', '1']).stderr, /--case names the cases to run.*--max-cases/);
  const q = refusedBeforeAnyCall(['--quick', '--case', 'c1', '--case', 'c2']);
  assert.match(q.stderr, /REFUSED \(run\): --quick runs one test task, and was given 2 with --case \(c1, c2\)/);
  assert.match(refusedBeforeAnyCall(['--case', 'c1', '--capture', 'repository']).stderr, /--case .*checkpoint/);
  assert.match(refusedBeforeAnyCall(['--case', 'c1', '--resume', 'cp']).stderr, /--case .*checkpoint/);
});

// ── AC-5 ────────────────────────────────────────────────────────────────────────────────────────────
test('AC-5: runSkillOnModel applies the selection and refuses an unknown id, maxCases and a checkpoint', () => {
  const root = tmp();
  const dir = skill(root, 3);
  const cp = path.join(root, 'cp');
  const script = `const { runSkillOnModel } = require(${JSON.stringify(path.join(ROOT, 'lib', 'run.js'))});
const { loadSkill } = require(${JSON.stringify(path.join(ROOT, 'lib', 'skill.js'))});
(async () => {
  const out = {};
  const s = loadSkill(process.argv[1]);
  for (const [k, opts] of [['ok', { caseIds: ['c3', 'c1', 'c3'] }], ['unknown', { caseIds: ['c1', 'zz'] }], ['empty', { caseIds: [] }], ['control', { caseIds: ['c1\\u0007'] }], ['maxCases', { caseIds: ['c1'], maxCases: 1 }], ['checkpoint', { caseIds: ['c1'], checkpointDir: process.argv[2] }]]) {
    try {
      const { receipt } = await runSkillOnModel({ skill: s, model: 'haiku', opts: { samples: 1, maxCalls: 2000, ...opts } });
      out[k] = { ids: receipt.results.cases.map((c) => c.id + '/' + c.mode), count: receipt.suite.case_count };
    } catch (e) { out[k] = { code: e.code || null, message: e.message }; }
  }
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });`;
  const r = spawnSync(process.execPath, ['-e', script, dir, cp], { cwd: root, env: env(), encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.ok, { ids: ['c1/with_skill', 'c1/baseline', 'c3/with_skill', 'c3/baseline'], count: 3 }, 'the plant: an accepted selection returns a receipt');
  assert.equal(out.unknown.code, 'UNKNOWN_CASE');
  assert.match(out.unknown.message, /"zz"/);
  assert.match(out.unknown.message, /"c1", "c2", "c3"/);
  assert.equal(out.empty.code, 'BAD_CASE_ID');
  assert.equal(out.control.code, 'BAD_CASE_ID');
  assert.equal(out.maxCases.code, 'CASE_WITH_MAX_CASES');
  assert.equal(out.checkpoint.code, 'CASE_CHECKPOINT');
  assert.equal(fs.existsSync(cp) && fs.readdirSync(cp).length > 0, false, 'nothing written to the checkpoint folder');
});

// ── AC-6 ────────────────────────────────────────────────────────────────────────────────────────────
test('AC-6: the projection and the cost guard count the named cases, not the suite', () => {
  const { projectCalls } = require('../lib/run');
  const { SAMPLING } = require('../lib/sampling');
  const one = projectCalls(1, 1, SAMPLING.max);
  assert.ok(projectCalls(3, 1, SAMPLING.max) > one, 'the suite\'s projection is above the one case\'s');
  const root = tmp();
  const three = skill(root, 3);
  const fits = cli(['run', three, '--models', MODEL, '--samples', '1', '--case', 'c2', '--max-calls', String(one), '--out', path.join(root, 'a')], root);
  assert.equal(fits.status, 0, fits.stderr);
  assert.match(fits.stdout, new RegExp(`projected synthetic calls: ${one}/model`));
  const over = cli(['run', three, '--models', MODEL, '--samples', '1', '--case', 'c2', '--max-calls', String(one - 1), '--out', path.join(root, 'b')], root);
  assert.equal(over.status, 3, over.stderr);
  assert.match(over.stderr, new RegExp(`projected ${one} calls/model exceeds --max-calls ${one - 1}`));
  assert.equal(fs.existsSync(path.join(root, 'b')), false);
});

// ── AC-7 ────────────────────────────────────────────────────────────────────────────────────────────
function readSelectionSummary(summary, receipt) {
  const ids = [...new Set(receipt.results.cases.map((c) => c.id))];
  const line = summary.split('\n').find((l) => l.startsWith('- **cases run:**'));
  assert.ok(line, 'the summary has a cases run line');
  assert.equal(line, `- **cases run:** ${ids.length} of ${receipt.suite.case_count}, chosen with --case: ${ids.map((id) => `\`${id}\``).join(', ')}. A run of fewer cases than its suite gets no verdict.`);
}
test('AC-7: stdout and the summary name the cases run and the suite\'s count; a full run names neither', () => {
  const { narrowed, full, n, f } = fixtures();
  assert.match(narrowed.stdout, /^ {2}cases: 2 of 3, chosen with --case \(c1, c3\); a run of fewer cases than its suite gets no verdict$/m);
  assert.ok(narrowed.stdout.indexOf('cases: 2 of 3') < narrowed.stdout.indexOf('── model:'), 'said before the run starts');
  readSelectionSummary(n.summary, n.receipt);
  assert.throws(() => readSelectionSummary(n.summary.replace('`c3`', '`c2`'), n.receipt), assert.AssertionError, 'a summary naming another case');
  assert.doesNotMatch(full.stdout, /chosen with --case/);
  assert.doesNotMatch(f.summary, /cases run/);
});

// ── AC-8 ────────────────────────────────────────────────────────────────────────────────────────────
// Draw 0 of each arm, read from the kept answers and checked against the hash the receipt seals.
function sealedFirstDraws(root, receipt) {
  const archive = JSON.parse(fs.readFileSync(path.join(root, 'transcripts', receipt.receipt_hash, 'answers.json'), 'utf8'));
  const ids = [...new Set(receipt.results.cases.map((c) => c.id))];
  assert.equal(ids.length, 1, 'a first look runs one test task');
  const texts = { id: ids[0] };
  for (const mode of ['with_skill', 'baseline']) {
    const h = receipt.results.cases.find((c) => c.mode === mode).generation.draws[0].generation_hash;
    assert.equal(sha256(archive.answers[h]), h, `${mode}: the kept answer is the sealed one`);
    texts[mode] = archive.answers[h];
  }
  return texts;
}
function readFirstLook(stdout, texts) {
  assert.ok(stdout.includes(`First look at test task ${texts.id}: draw 0 of each arm`), `the first look names ${texts.id}`);
  assert.ok(stdout.includes(sideBySide(texts.with_skill, texts.baseline).join('\n')), `stdout shows ${texts.id}'s two answers side by side`);
}
test('AC-8: --quick --case c2 runs c2 as the quick preset, names it as chosen, and prints its first look', () => {
  const root = tmp();
  const three = skill(root, 3);
  const chosen = cli(['run', three, '--quick', '--trusted-skill', '--models', MODEL, '--case', 'c2', '--out', path.join(root, 'chosen')], root, { stub: false });
  const first = cli(['run', three, '--quick', '--trusted-skill', '--models', MODEL, '--out', path.join(root, 'first')], root, { stub: false });
  for (const [k, r] of [['chosen', chosen], ['first', first]]) assert.equal(r.status, 0, `${k}: ${r.stderr.slice(-800)}`);
  const c = receiptIn(path.join(root, 'chosen')).receipt;
  const f = receiptIn(path.join(root, 'first')).receipt;
  readSelection(c, ['c2']);
  assert.equal(c.run.preset, 'quick');
  assert.ok(receiptVerdict(c).notMeasured.includes('smoke'));
  assert.match(chosen.stdout, /1 test task \(c2, chosen with --case\)/);
  assert.match(first.stdout, /1 test task \(c1, the first in the suite\)/);
  const tc = sealedFirstDraws(root, c);
  const tf = sealedFirstDraws(root, f);
  assert.notEqual(tc.with_skill, tf.with_skill, 'the two tasks\' answers differ, so a wrong task is visible');
  readFirstLook(chosen.stdout, tc);
  readFirstLook(first.stdout, tf);
  assert.throws(() => readFirstLook(chosen.stdout, tf), assert.AssertionError, 'the first look at the suite\'s first task');
});

// ── AC-9 ────────────────────────────────────────────────────────────────────────────────────────────
test('AC-9: stale\'s rerun command carries no --case, and the receipt adds no field', () => {
  const { n, f, three } = fixtures();
  const doc = staleReport([n.file], { skill: three, model: 'claude-sonnet-5', noHarnessCheck: true });
  const row = doc.receipts[0];
  assert.equal(row.status, 'stale');
  assert.match(row.next, /^driftproof run \S+ --models claude-sonnet-5$/);
  assert.doesNotMatch(row.next, /--case/);
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(n.receipt), keys(f.receipt));
  for (const k of ['run', 'suite', 'skill', 'results']) assert.deepEqual(keys(n.receipt[k]), keys(f.receipt[k]), `${k} carries the full run's fields`);
  assert.equal(validateReceipt(n.receipt).valid, true);
});

// ── AC-10 ───────────────────────────────────────────────────────────────────────────────────────────
test('AC-10: /driftproof:run refuses --case, spawning nothing, and the help says --case is CLI only', () => {
  const root = tmp();
  const work = path.join(root, 'work');
  skill(work, 2, 'my-skill');
  spawnSync('git', ['init', '-q'], { cwd: work });
  const log = path.join(root, 'spawns.ndjson');
  const r = spawnSync(process.execPath, [DOOR, 'run', 'my-skill', '--case', 'c1'], { cwd: work, env: env({ log, extra: { SPEC028_ROOT: ROOT, GIT_CEILING_DIRECTORIES: root } }), encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /REFUSED: run does not take --case\b/);
  assert.deepEqual(spawnsIn(log), [], 'nothing was spawned');
  const help = cli(['--help'], root);
  assert.match(help.stdout, /\[--case ID\]\.\.\./);
  assert.match(help.stdout, /--case ID runs only that test case.*\n(?:.*\n)*?.*CLI only: \/driftproof:run does not take it/);
});
