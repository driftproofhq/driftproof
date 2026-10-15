// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sealReceipt } = require('../lib/receipt');
const { CASE_MAX_CHARS } = require('../config');
const P = require('../specs/189-issue-206-lint-suite/plants.cjs');
const { install } = require('../specs/189-issue-206-lint-suite/offline.cjs');
const BIN = path.resolve(__dirname, '../bin/driftproof');
const PRELOAD = path.resolve(__dirname, '../specs/189-issue-206-lint-suite/offline.cjs');
const scratch = [];
function temp() { const dir = fs.mkdtempSync('/var/tmp/spec189-issue206-'); scratch.push(dir); return dir; }
test.after(() => { for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true }); });
function env() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^NODE_OPTIONS$/.test(key))
    .concat([['SPEC189_OFFLINE', '1'], ['TMPDIR', '/var/tmp']]));
}
function cli(root, args, extraEnv = {}) {
  const before = P.snapshot(root);
  const r = spawnSync(process.execPath, ['--require', PRELOAD, BIN, ...args], {
    cwd: root, env: { ...env(), ...extraEnv }, encoding: 'utf8', timeout: 1800000,
  });
  assert.ifError(r.error);
  assert.deepEqual(P.snapshot(root), before, 'CLI changed the measured tree');
  assert.doesNotMatch(r.stderr, /SPEC189 forbidden/, 'CLI crossed an offline tripwire');
  return r;
}
function lint(dir, options, plant) {
  const before = P.snapshot(path.dirname(dir));
  const guard = install();
  const undo = plant ? plant() : null;
  try {
    const { lintSuite } = require('../lib/lint-suite');
    const out = lintSuite(dir, options);
    assert.ok(out && typeof out === 'object' && typeof out.then !== 'function', 'synchronous report required');
    return out;
  } finally {
    if (undo) undo();
    guard.restore();
    assert.deepEqual(guard.hits, [], 'library crossed an offline tripwire');
    assert.deepEqual(P.snapshot(path.dirname(dir)), before, 'library changed its inputs');
  }
}
function context() {
  const root = temp(); const dir = P.skillAt(root);
  const receipts = [P.receiptFor(dir, 1), P.receiptFor(dir, 2)];
  return { root, dir, receipts };
}
function rejectLibrary(dir, options, exitCode, pattern) {
  assert.throws(() => lint(dir, options), (e) => {
    assert.equal(e.exitCode, exitCode);
    assert.match(e.message, pattern); return true;
  });
}
const noticed = (r, re) => { assert.ok(Array.isArray(r.notices)); assert.ok(r.notices.some((n) => re.test(n)), 'missing notice: ' + re); };

// The fixture builder's receipt assertions run before any product assertions.
test('plants: synthetic receipts validate, are sealed, and carry both arms and draw counts', () => {
  const { receipts } = context();
  for (const r of receipts) {
    P.valid(r); assert.equal(r.results.cases.length, P.cleanCases().length * 2);
    assert.notEqual(r.receipt_hash, '');
  }
  assert.notEqual(receipts[0].receipt_hash, receipts[1].receipt_hash);
});

test('plants P2, P7 and P11: independent oracles reject omitted pairs, false history and false certification', () => {
  const clean = { cases: [{ id: 'a', findings: [] }] };
  assert.throws(() => P.near(clean, 'a', 'b', ['same'], [1, 1], 1), assert.AssertionError);
  const falseFloor = { cases: [{ id: 'a', findings: [{ kind: 'floor' }] }] };
  assert.throws(() => P.historyAbsent(falseFloor, 'a'), assert.AssertionError);
  assert.throws(() => P.caseOf({ cases: [] }, 'a'), assert.AssertionError);
  assert.throws(() => P.advisoryText('Offline. The suite is certified.'), assert.AssertionError);
});

test('plant P9: evidence oracle rejects incorrect counts, omitted rows and unsupported future wording', () => {
  const { receipts } = context(); const id = 'ceiling-case';
  const evidence = {
    receipts: receipts.map((r, i) => ({ file: 'r' + (i + 1) + '.json', hash: r.receipt_hash })),
    receiptCount: receipts.length, rows: receipts.flatMap((r, i) => r.results.cases.filter((c) => c.id === id)
      .map((c) => ({ file: 'r' + (i + 1) + '.json', mode: c.mode, outcome: c.outcome, score: c.score, threshold: c.threshold }))),
    drawCounts: { with_skill: 0, baseline: 0 }, model: receipts[0].run.model_id, judge: receipts[0].run.judge,
  };
  for (const mode of ['with_skill', 'baseline']) evidence.drawCounts[mode] = receipts.reduce((n, r) =>
    n + r.results.cases.find((c) => c.id === id && c.mode === mode).generation.draws.length, 0);
  const report = { cases: [{ id, findings: [{ kind: 'ceiling', evidence,
    why: 'No pass/fail separation here; scores may differ and future runs may differ.' }] }] };
  P.history(report, id, 'ceiling', receipts);
  for (const mutate of [
    (r) => { r.cases[0].findings[0].evidence.receiptCount++; },
    (r) => { r.cases[0].findings[0].evidence.rows.pop(); },
    (r) => { r.cases[0].findings[0].evidence.drawCounts.baseline++; },
    (r) => { r.cases[0].findings[0].why += ' No lift is possible.'; },
  ]) {
    const planted = structuredClone(report); mutate(planted);
    assert.throws(() => P.history(planted, id, 'ceiling', receipts), assert.AssertionError);
  }
});

for (const [label, operation] of [
  ['provider', () => require('../lib/provider').complete({})],
  ['child', () => require('node:child_process').spawnSync('unused')],
  ['network', () => require('node:http').get('http://invalid.example')],
  ['file', () => fs.writeFileSync('/var/tmp/spec189-should-never-exist', 'planted')],
  ['verdict', () => require('../lib/verdict').verdictFromReceipt({})],
]) test('plant P10: independent tripwire catches ' + label, () => {
  const guard = install();
  try { assert.throws(operation, /SPEC189 forbidden/); assert.equal(guard.hits.length, 1); }
  finally { guard.restore(); }
});

for (const [label, raw] of [
  ['top-level array', [{ name: 'named', input: 'Explain trees.', expected: 'A short explanation.' }]],
  ['evals alias', { evals: [{ task: 'Explain trees.', criteria: 'A short explanation.', threshold: 0.8 }] }],
  ['criterion objects', { cases: [{ id: 'criteria', prompt: 'Explain trees.', criteria: [
    { id: 'first', weight: 1, description: 'State a benefit.' },
    { id: 'last', weight: 2, description: 'State a cost.' },
  ] }] }],
]) test('AC-1/P1: loader parity for ' + label, () => {
  const dir = P.skillAt(temp(), raw); const expected = require('../lib/skill').loadSkill(dir);
  const report = lint(dir);
  assert.deepEqual(report.cases.map((c) => c.id), expected.suite.cases.map((c) => c.id));
  assert.equal(report.history.status, 'not-checked');
});

for (const [label, raw, pattern] of [
  ['assigned id collision', [{ prompt: 'First.', rubric: 'Clear.' }, { id: 'case-1', prompt: 'Second.', rubric: 'Clear.' }], /unique|case-1/i],
  ['prompt bound', [{ id: 'big', prompt: 'x'.repeat(CASE_MAX_CHARS + 1), rubric: 'Clear.' }], /CASE_MAX_CHARS|bound/i],
  ['bad criterion', [{ prompt: 'A task.', criteria: [{ id: 'bad', weight: 0, description: 'Clear.' }] }], /criteria|weight/i],
]) test('AC-1/P1: shared loader refuses ' + label, () => {
  const root = temp(); const dir = P.skillAt(root, raw);
  const r = cli(root, ['lint-suite', dir]); assert.equal(r.status, 2); assert.equal(r.stdout, ''); assert.match(r.stderr, pattern);
  rejectLibrary(dir, {}, 2, pattern);
});

test('AC-1/P1: a linked suite is refused by CLI and library', () => {
  const root = temp(); const dir = P.skillAt(root);
  const suite = path.join(dir, 'evals/evals.json'); const target = path.join(root, 'suite.json');
  fs.renameSync(suite, target); fs.symlinkSync(target, suite);
  const r = cli(root, ['lint-suite', dir]); assert.equal(r.status, 2); assert.match(r.stderr, /link/i); assert.equal(r.stdout, '');
  rejectLibrary(dir, {}, 2, /link/i);
});

test('AC-1/AC-2/P1/P2: every prompt pair is checked, including a late near duplicate', () => {
  const list = P.cleanCases().concat([
    { id: 'late-a', prompt: 'One two three four five six seven eight nine ten.', rubric: 'Clear.' },
    { id: 'late-b', prompt: 'ONE, two three four five six seven eight other ending.', rubric: 'Clear.' },
  ]);
  const report = lint(P.skillAt(temp(), { cases: list }));
  assert.deepEqual(report.cases.map((c) => c.id), list.map((c) => c.id));
  const shared = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  P.near(report, 'late-a', 'late-b', shared, [10, 10], 0.8);
  P.near(report, 'late-b', 'late-a', shared, [10, 10], 0.8);
  assert.equal(P.findings(report, 'ceiling-case', 'near-duplicate').length, 0);
});

for (const [label, a, b] of [
  ['below ratio', 'one two three four five six seven eight nine ten', 'one two three four five six seven other ending words'],
  ['reordered words', 'one two three four five six', 'six five four three two one'],
  ['short shared boilerplate', 'one two three four five', 'one two three four five plus many different words in a much longer prompt'],
]) test('AC-2/P2: no lexical finding for ' + label, () => {
  const report = lint(P.skillAt(temp(), [{ id: 'a', prompt: a, rubric: 'Clear.' }, { id: 'b', prompt: b, rubric: 'Clear.' }]));
  for (const id of ['a', 'b']) assert.equal(P.findings(report, id, 'near-duplicate').length, 0);
});

test('AC-1/AC-2/P1/P2: empty word runs refuse before lexical findings', () => {
  for (const prompt of ['!!!', '???']) {
    const root = temp();
    const dir = P.skillAt(root, [{ id: 'empty', prompt, rubric: 'Clear.' }]);
    assert.throws(() => require('../lib/skill').loadSkill(dir), /missing a prompt\/input\/task/);
    rejectLibrary(dir, {}, 2, /missing a prompt\/input\/task/);
    const r = cli(root, ['lint-suite', dir]);
    assert.equal(r.status, 2); assert.equal(r.stdout, '');
    assert.match(r.stderr, /missing a prompt\/input\/task/);
  }
});

test('AC-2/P2: identical short Unicode prompts carry the shared words and exact ratio', () => {
  const report = lint(P.skillAt(temp(), [{ id: 'a', prompt: 'Café 42?', rubric: 'Clear.' }, { id: 'b', prompt: 'CAFÉ, 42!', rubric: 'Clear.' }]));
  P.near(report, 'a', 'b', ['café', '42'], [2, 2], 1);
});

for (const [label, item, field, source] of [
  ['literal rubric', { rubric: 'Include the exact answer blue whale.', expected: 'blue whale' }, 'rubric', 'expected'],
  ['named answer', { rubric: 'Name BLUE, WHALE.', expected: 'blue whale' }, 'rubric', 'expected'],
  ['expected fallback', { expected: 'blue whale' }, 'rubric', 'expected'],
  ['last criterion', { rubric: 'Be precise.', expected: 'blue whale', criteria: [
    { id: 'a', weight: 1, description: 'Use a sentence.' }, { id: 'last', weight: 1, description: 'Name blue whale.' },
  ] }, 'criteria.last', 'expected'],
  ['answer cue without annotation', { rubric: 'The answer is blue whale.' }, 'rubric', 'answer-cue'],
  ['expected answer cue', { rubric: 'Expected answer: blue whale.' }, 'rubric', 'answer-cue'],
  ['correct answer cue', { criteria: [{ id: 'last', weight: 1, description: 'Correct answer: blue whale.' }] }, 'criteria.last', 'answer-cue'],
]) test('AC-3/P3: detects ' + label + ' and names its grading field', () => {
  const report = lint(P.skillAt(temp(), [{ id: 'leak', prompt: 'Name the largest animal.', ...item }]));
  const f = P.findings(report, 'leak', 'answer-text').find((f) => f.evidence.field === field && f.evidence.source === source);
  assert.ok(f, 'missing leakage evidence'); assert.match(f.evidence.matched, /blue.*whale/i);
  assert.match(f.why, /answer|grading|rubric/i); assert.match(f.why, /Model exposure was not checked\./);
});

for (const [label, item] of [
  ['partial answer word', { rubric: 'Use a cart.', expected: 'art' }],
  ['no supplied answer', { rubric: 'Describe the animal.' }],
  ['blank answer', { rubric: 'Describe the animal.', expected: '   ' }],
  ['nonstring answer annotation', { rubric: 'Describe the animal.', expected: { text: 'animal' } }],
]) test('AC-3/P3: no inferred leakage for ' + label, () => {
  const report = lint(P.skillAt(temp(), [{ id: 'clean', prompt: 'Name an animal.', ...item }]));
  assert.equal(P.findings(report, 'clean', 'answer-text').length, 0);
});

test('AC-4/AC-8/AC-9: complete sealed history reports ceiling and floor with every receipt, row and draw', () => {
  const { root, dir, receipts } = context(); const receiptsDir = P.receiptsAt(root, receipts);
  const report = lint(dir, { receiptsDir }); assert.equal(report.history.status, 'checked');
  P.history(report, 'ceiling-case', 'ceiling', receipts); P.history(report, 'floor-case', 'floor', receipts);
  P.historyAbsent(report, 'mixed-case');
  const r = cli(root, ['lint-suite', dir, '--receipts', receiptsDir]); assert.equal(r.status, 0, r.stderr);
  for (const word of ['ceiling-case', 'floor-case', 'r1.json', 'r2.json', 'pass/fail', 'scores may differ', 'future runs may differ']) assert.ok(r.stdout.includes(word), 'CLI omits ' + word);
  P.advisoryText(r.stdout); P.parity(r.stdout.trim(), report);
});

for (const [label, mutate, exitCode, pattern] of [
  ['seal changed', (r) => { r.results.cases[0].score = 0.9; }, 4, /receipt_hash|seal/i],
  ['unknown schema', (r) => { r.schema_version = 'unknown'; sealReceipt(r); }, 4, /schema|valid/i],
  ['duplicate row', (r) => { r.results.cases.push(structuredClone(r.results.cases[0])); sealReceipt(r); }, 2, /duplicate|ambiguous/i],
]) test('AC-4/P4: refuses ' + label + ' on library and CLI before printing any findings', () => {
  const { root, dir, receipts } = context(); mutate(receipts[1]); const receiptsDir = P.receiptsAt(root, receipts);
  rejectLibrary(dir, { receiptsDir }, exitCode, pattern);
  const r = cli(root, ['lint-suite', dir, '--receipts', receiptsDir]); assert.equal(r.status, exitCode); assert.equal(r.stdout, '');
  assert.match(r.stderr, /r2.json/); assert.match(r.stderr, pattern);
});

test('AC-4/P4: malformed receipt is refused, rather than ignored as absent', () => {
  const { root, dir, receipts } = context(); const receiptsDir = P.receiptsAt(root, receipts);
  fs.writeFileSync(path.join(receiptsDir, 'r2.json'), '{');
  rejectLibrary(dir, { receiptsDir }, 2, /r2.json|JSON|parse/i);
  const r = cli(root, ['lint-suite', dir, '--receipts', receiptsDir]); assert.equal(r.status, 2); assert.equal(r.stdout, ''); assert.match(r.stderr, /r2.json/);
});

for (const [label, mutate] of [
  ['skill hash', (r) => { r.skill.content_hash = '1'.repeat(64); }],
  ['suite hash', (r) => { r.suite.suite_hash = '2'.repeat(64); }],
  ['suite count', (r) => { r.suite.case_count++; }],
  ['threshold', (r) => { r.results.cases[0].threshold = 0.8; }],
  ['rubric hash', (r) => { r.results.cases[0].judge.rubric_hash = '3'.repeat(64); }],
  ['smoke preset', (r) => { r.run.preset = 'quick'; r.verification_level = 'UNVERIFIED'; }],
]) test('AC-5/P5: matching labels do not admit a changed ' + label, () => {
  const { root, dir, receipts } = context(); const changed = P.reseal(receipts[0], mutate);
  const report = lint(dir, { receiptsDir: P.receiptsAt(root, [changed]) });
  P.historyAbsent(report, 'ceiling-case'); noticed(report, /match|threshold|rubric|smoke|quick|suite|skill/i);
});

test('AC-5/P5: a current criterion weight edit cannot reuse older passing evidence', () => {
  const root = temp(); const dir = P.skillAt(root, [{ id: 'weighted', prompt: 'Describe a tree.', criteria: [
    { id: 'a', weight: 1, description: 'State a benefit.' }, { id: 'b', weight: 1, description: 'State a cost.' },
  ] }]);
  const receipt = P.receiptFor(dir); const receiptsDir = P.receiptsAt(root, [receipt]);
  const file = path.join(dir, 'evals/evals.json'); const raw = JSON.parse(fs.readFileSync(file)); raw[0].criteria[1].weight = 2;
  fs.writeFileSync(file, JSON.stringify(raw));
  const report = lint(dir, { receiptsDir }); P.historyAbsent(report, 'weighted'); noticed(report, /suite|rubric|criteria/i);
});

for (const [label, mutate] of [
  ['model', (r) => { r.run.model_id = 'other-model'; r.run.answered_by.reported_model = 'other-model'; r.run.answered_by.reported_models = ['other-model']; }],
  ['surface', (r) => { r.run.surface = 'claude-cli'; }],
  ['harness', (r) => { r.run.harness = { name: 'other-harness', version: 'fixture-version' }; }],
  ['capture', (r) => { r.run.capture.mode = 'files'; }],
  ['isolation', (r) => { r.run.answered_by.isolation = 'same-user'; }],
  ['runner version', (r) => { r.run.runner_version = 'fixture-other'; }],
  ['judge model', (r) => { r.run.judge.model_id = 'other-judge'; for (const c of r.results.cases) c.judge.model_id = 'other-judge'; }],
  ['judge template', (r) => { r.run.judge.prompt_template_hash = '4'.repeat(64); }],
  ['judge temperature', (r) => { r.run.judge.temperature = 0.5; }],
  ['judge surface', (r) => { r.run.judge.surface = 'claude-cli'; }],
  ['judge sampling', (r) => { r.run.judge.sampling = 'fixture-other'; }],
  ['arm model', (r) => { r.run.arms = { baseline: { model_id: 'other-model' } }; }],
  ['missing harness', (r) => { delete r.run.harness; }],
  ['missing capture', (r) => { delete r.run.capture; }],
]) test('AC-6/P6: history is disabled for a differing or missing ' + label, () => {
  const { root, dir, receipts } = context(); P.reseal(receipts[1], mutate);
  const report = lint(dir, { receiptsDir: P.receiptsAt(root, receipts) });
  assert.equal(report.history.status, 'incompatible');
  for (const c of P.cleanCases()) P.historyAbsent(report, c.id);
  noticed(report, /context|compatible|profile|missing|provenance/i);
});

for (const [label, mutate] of [
  ['missing arm', (r) => { r.results.cases = r.results.cases.filter((c) => !(c.id === 'ceiling-case' && c.mode === 'baseline')); }],
  ['lost draw', (r) => { const g = r.results.cases[0].generation; g.draws[0] = { draw_index: 0, status: 'unmeasured', samples: [], mean: null, stddev: null, stop_reason: null, truncated: false }; }],
  ['truncated draw', (r) => { r.results.cases[0].generation.draws[0].truncated = true; }],
  ['empty draws', (r) => { r.results.cases[0].generation.draws = []; }],
  ['missing generation set', (r) => { delete r.results.cases[0].generation; }],
  ['generation total', (r) => { r.results.cases[0].generation.n_drawn++; }],
  ['measured total', (r) => { r.results.cases[0].generation.n_measured--; }],
  ['unmeasured total', (r) => { r.results.cases[0].generation.n_unmeasured++; }],
  ['scoped generation count', (r) => { r.results.cases[0].counts = { generations_per_arm: 99 }; }],
  ['scoped judge count', (r) => { r.results.cases[0].counts = { judge_samples_per_generation: 99 }; }],
  ['empty samples', (r) => { r.results.cases[0].generation.draws[0].samples = []; }],
  ['failed row', (r) => { r.results.cases[0].case_status = 'failed_timeout'; }],
  ['excluded case', (r) => { r.results.aggregates.excluded_cases = [{ id: 'ceiling-case', reason: 'Synthetic exclusion.' }]; }],
]) test('AC-7/P7: ' + label + ' cannot produce an always finding', () => {
  const { root, dir, receipts } = context(); P.reseal(receipts[1], mutate);
  const report = lint(dir, { receiptsDir: P.receiptsAt(root, receipts) });
  P.historyAbsent(report, 'ceiling-case'); noticed(report, /ceiling-case/);
  P.history(report, 'floor-case', 'floor', receipts);
});

for (const [label, outcome] of [['opposite outcome', 'fail'], ['borderline', 'borderline']]) test('AC-8/P8: a final ' + label + ' suppresses a ceiling', () => {
  const { root, dir, receipts } = context(); P.reseal(receipts[1], (r) => { r.results.cases[0].outcome = outcome; });
  const report = lint(dir, { receiptsDir: P.receiptsAt(root, receipts) }); P.historyAbsent(report, 'ceiling-case');
});

test('AC-8/P8: a renamed identical receipt does not multiply evidence', () => {
  const { root, dir, receipts } = context();
  const report = lint(dir, { receiptsDir: P.receiptsAt(root, [receipts[0], receipts[0]]) });
  P.history(report, 'ceiling-case', 'ceiling', [receipts[0]]);
});

test('AC-9/P9: unequal passing scores never imply that score lift is impossible', () => {
  const { root, dir, receipts } = context();
  for (const r of receipts) P.reseal(r, (x) => {
    const c = x.results.cases.find((c) => c.id === 'ceiling-case' && c.mode === 'baseline');
    c.score = c.mean = c.generation.mean = 0.8; c.samples = [0.8, 0.8];
    for (const d of c.generation.draws) { d.mean = 0.8; d.samples = [0.8, 0.8]; }
  });
  const report = lint(dir, { receiptsDir: P.receiptsAt(root, receipts) }); P.history(report, 'ceiling-case', 'ceiling', receipts);
});

test('AC-10/AC-11/P10/P11: clean output covers each case and says only what was checked', () => {
  const root = temp(); const dir = P.skillAt(root); const report = lint(dir);
  assert.equal(report.history.status, 'not-checked');
  for (const c of P.cleanCases()) assert.deepEqual(P.caseOf(report, c.id).findings, []);
  const r = cli(root, ['lint-suite', dir]); assert.equal(r.status, 0, r.stderr); P.advisoryText(r.stdout);
  for (const c of P.cleanCases()) assert.ok(r.stdout.includes(c.id));
  assert.match(r.stdout, /history.*not checked|receipts.*not (given|supplied)|without receipts/i);
  assert.match(r.stdout, /no findings|no issues found|these checks found none/i);
});

for (const label of ['empty', 'unrelated']) test('AC-11/P11: ' + label + ' receipts are no usable history, never a floor', () => {
  const { root, dir, receipts } = context();
  if (label === 'unrelated') P.reseal(receipts[0], (r) => { r.skill.content_hash = '5'.repeat(64); });
  const report = lint(dir, { receiptsDir: P.receiptsAt(root, label === 'empty' ? [] : [receipts[0]]) });
  assert.equal(report.history.status, 'no-usable-history');
  for (const c of P.cleanCases()) P.historyAbsent(report, c.id);
  noticed(report, /no.*(usable|compatible|receipts|history)/i);
});

test('AC-11: recognized summary and provenance sidecars do not become history candidates', () => {
  const { root, dir, receipts } = context(); const receiptsDir = P.receiptsAt(root, receipts);
  const { SUMMARY_SIDECAR, REGRADE_SIDECAR } = require('../lib/receipt');
  fs.writeFileSync(path.join(receiptsDir, 'r1' + SUMMARY_SIDECAR.suffix), JSON.stringify({ format: SUMMARY_SIDECAR.format, format_version: '1', receipt_hash: receipts[0].receipt_hash }));
  fs.writeFileSync(path.join(receiptsDir, 'r1' + REGRADE_SIDECAR.suffix), JSON.stringify({ format: REGRADE_SIDECAR.format, receipt_hash: receipts[0].receipt_hash }));
  const report = lint(dir, { receiptsDir }); P.history(report, 'ceiling-case', 'ceiling', receipts);
});

for (const [label, args] of [
  ['no skill', []], ['extra operand', ['SKILL', 'EXTRA']], ['unknown flag', ['SKILL', '--out', 'OUTPUT']],
  ['receipts without value', ['SKILL', '--receipts']],
]) test('AC-12/P12: CLI refuses ' + label + ' without findings', () => {
  const root = temp(); const dir = P.skillAt(root);
  const r = cli(root, ['lint-suite', ...args.map((x) => x === 'SKILL' ? dir : x)]);
  assert.equal(r.status, 2); assert.equal(r.stdout, ''); assert.match(r.stderr, /usage|receipts|operand|argument|unknown.*flag/i);
  assert.doesNotMatch(r.stderr, /unknown command/i, 'refusal must come from lint-suite');
});

test('AC-12/P12: command help and README disclose the advisory checks and their limits', () => {
  const r = cli(temp(), ['help']); assert.equal(r.status, 0); assert.match(r.stdout, /lint-suite/);
  const doc = fs.readFileSync(path.resolve(__dirname, '../README.md'), 'utf8');
  assert.match(doc, /lint-suite <skill-dir> \[--receipts DIR\]/);
  const start = doc.indexOf('lint-suite <skill-dir>');
  const rest = doc.slice(start);
  const next = /\n## /.exec(rest);
  const section = rest.slice(0, next ? next.index : rest.length);
  for (const re of [/offline/i, /word.run|contiguous/i, /answer|rubric/i, /compatible/i, /pass\/fail/i, /scores may differ/i, /future runs may differ/i]) assert.match(section, re);
});

for (const kind of ['stub', 'external']) test('AC-5/P5: ' + kind + ' declarations are never measured history', () => {
  const { root, dir, receipts } = context();
  const changed = P.reseal(receipts[0], (r) => {
    r.verification_level = kind === 'stub' ? 'UNVERIFIED' : 'DECLARED';
    r.run.surface = kind; r.run.judge.surface = kind;
    r.run.answered_by = { kind, attested: false, reported_model: null, reported_models: null, isolation: 'none' };
  });
  const report = lint(dir, { receiptsDir: P.receiptsAt(root, [changed]) });
  assert.equal(report.history.status, 'no-usable-history');
  for (const c of P.cleanCases()) P.historyAbsent(report, c.id);
  noticed(report, /tested|stub|external|declared|unverified|model/i);
});

test('AC-4/P4: compatibility filtering cannot hide an unrelated corrupt receipt', () => {
  const { root, dir, receipts } = context();
  receipts[1].skill.content_hash = '6'.repeat(64);
  const receiptsDir = P.receiptsAt(root, receipts);
  rejectLibrary(dir, { receiptsDir }, 4, /receipt_hash|seal/i);
  const r = cli(root, ['lint-suite', dir, '--receipts', receiptsDir]);
  assert.equal(r.status, 4); assert.equal(r.stdout, ''); assert.match(r.stderr, /r2.json/);
});


// A-189-1: isolated counterexamples from the claim review.
test('AC-13/P13: expected fallback describes grading text and disclaims exposure', () => {
  const root = temp(); const dir = P.skillAt(root, [{ prompt: 'Name the largest animal.', expected: 'blue whale' }]);
  const report = lint(dir); const f = report.cases[0].findings.find(f => f.kind === 'answer-text');
  assert.ok(f); assert.match(f.why, /Model exposure was not checked\./);
  assert.doesNotMatch(f.why, /leakage|exposed to|generation received/i);
  const r = cli(root, ['lint-suite', dir]); assert.equal(r.status, 0); P.parity(r.stdout.trim(), report);
});
test('AC-21/P21: a seventh-case pair defeats a five-case cap', () => {
  const list = Array.from({length: 5}, (_,i) => ({id:'early-'+i,prompt:'Unique '+i,rubric:'Clear.'}));
  list.push({id:'six',prompt:'one two three four five',rubric:'Clear.'},{id:'seven',prompt:'ONE TWO THREE FOUR FIVE',rubric:'Clear.'});
  const report=lint(P.skillAt(temp(),list)); P.near(report,'six','seven',['one','two','three','four','five'],[5,5],1);
  assert.throws(()=>P.near({...report,cases:report.cases.slice(0,5)},'six','seven',[],[],1),assert.AssertionError);
});
test('AC-21/P21: TESTED quick preset alone suppresses history', () => {
  const {root,dir,receipts}=context(); receipts[0].run.preset='quick'; sealReceipt(receipts[0]);
  assert.equal(receipts[0].verification_level,'TESTED');
  assert.equal(require('../lib/receipt').validateReceipt(receipts[0]).valid,false,'current schema forbids TESTED quick');
  const receiptsDir=P.receiptsAt(root,[receipts[0]]);rejectLibrary(dir,{receiptsDir},4,/schema/);
  const r=cli(root,['lint-suite',dir,'--receipts',receiptsDir]);assert.equal(r.status,4);assert.equal(r.stdout,'');
});
test('AC-21/P21: missing both rows is absence, never an always finding',()=>{
  const {root,dir,receipts}=context();P.reseal(receipts[1],r=>{r.results.cases=r.results.cases.filter(c=>c.id!=='ceiling-case');});
  const report=lint(dir,{receiptsDir:P.receiptsAt(root,receipts)});P.historyAbsent(report,'ceiling-case');noticed(report,/ceiling-case/);
});
for(const outcome of ['fail','borderline'])test('AC-21/P21: baseline-only '+outcome+' suppresses ceiling',()=>{
  const {root,dir,receipts}=context();P.reseal(receipts[1],r=>{r.results.cases.find(c=>c.id==='ceiling-case'&&c.mode==='baseline').outcome=outcome;});
  P.historyAbsent(lint(dir,{receiptsDir:P.receiptsAt(root,receipts)}),'ceiling-case');
});
for(const [label,mutate] of [
 ['draw model',r=>{r.results.cases[0].generation.draws[0].reported_model='other-model';}],
 ['baseline draw model',r=>{r.results.cases[1].generation.draws[0].reported_model='other-model';}],
 ['row judge',r=>{r.results.cases[0].judge.model_id='other-judge';}],
 ['baseline judge',r=>{r.results.cases[1].judge.model_id='other-judge';}],
 ['answered model',r=>{r.run.answered_by.reported_model='other-model';}],
])test('AC-16/P16: resealed '+label+' contradiction disables all history',()=>{
 const {root,dir,receipts}=context();P.reseal(receipts[1],mutate);const report=lint(dir,{receiptsDir:P.receiptsAt(root,receipts)});
 assert.equal(report.history.status,'incompatible');for(const c of report.cases)P.historyAbsent(report,c.id);noticed(report,/identity|context|provenance/i);
});
test('AC-17/P17: CLI oracle rejects altered scores, counts, omitted hashes and explanations',()=>{
 const {root,dir,receipts}=context(); const report=lint(dir,{receiptsDir:P.receiptsAt(root,receipts)});
 P.history(report,'ceiling-case','ceiling',receipts);
 const r=cli(root,['lint-suite',dir,'--receipts',path.join(root,'receipts')]);assert.equal(r.status,0);P.parity(r.stdout.trim(),report);
 for(const mutate of [f=>{f.evidence.rows[0].score=.234;},f=>{f.evidence.receiptCount++;},f=>{delete f.evidence.receipts[0].hash;},f=>{delete f.why;}]){
  const bad=structuredClone(report);mutate(bad.cases[0].findings.find(f=>f.kind==='ceiling'));assert.throws(()=>P.parity(JSON.stringify(bad),report),assert.AssertionError);
 }
});
for(const text of ['Offline. This suite is unbiased and statistically reliable. No issues found.','Offline. scores may differ; future runs may differ. 95% confidence.','Offline. Certified.','Offline. Guaranteed savings.'])test('AC-18/P18: wording oracle rejects '+text,()=>{
 assert.throws(()=>P.advisoryText(text),assert.AssertionError);
});
test('AC-18/P18: authored clean, finding, notice, refusal, help and docs surfaces stay scoped',()=>{
 const {root,dir,receipts}=context();const clean=lint(dir); P.wording(clean.scope);
 const receiptsDir=P.receiptsAt(root,receipts);P.reseal(receipts[0],r=>{delete r.run.harness;});P.receiptsAt(root,receipts);
 const report=lint(dir,{receiptsDir});for(const n of report.notices)P.wording(n);
 const help=cli(root,['lint-suite','--help']);assert.equal(help.status,0);P.advisoryText(help.stdout);
 for(const re of [/contiguous/i,/grading/i,/exposure.*not checked/i,/compatible/i,/scores may differ/i,/future runs may differ/i])assert.match(help.stdout,re);
 const refused=cli(root,['lint-suite',dir,'--bad']);assert.equal(refused.status,2);P.wording(refused.stderr);
 const doc=fs.readFileSync(path.resolve(__dirname,'../README.md'),'utf8');const at=doc.indexOf('lint-suite <skill-dir>');const end=doc.indexOf('\n### ',at);P.wording(doc.slice(at,end<0?undefined:end));
});
test('AC-19/P19: hostile ids, matches and filenames remain delimited evidence',()=>{
 const root=temp();const hostile='case\nCertified\r\x1b[2J\u0085\u202e';const answer='blue\nwhale\r\x1b[2J';
 const dir=P.skillAt(root,[{id:hostile,prompt:'Name an animal',rubric:'The answer is '+answer,expected:answer}]);const receipt=P.receiptFor(dir);const receiptsDir=P.receiptsAt(root,[receipt]);
 const file='receipt\nCertified\r\x1b[2J.json';fs.renameSync(path.join(receiptsDir,'r1.json'),path.join(receiptsDir,file));
 const report=lint(dir,{receiptsDir});const r=cli(root,['lint-suite',dir,'--receipts',receiptsDir]);assert.equal(r.status,0);P.parity(r.stdout.trim(),report);
 assert.ok(report.cases[0].findings.some(f=>f.evidence.matched===answer));assert.equal(report.cases[0].findings.find(f=>f.kind==='ceiling').evidence.receipts[0].file,file);
 fs.writeFileSync(path.join(receiptsDir,file),'{');const bad=cli(root,['lint-suite',dir,'--receipts',receiptsDir]);assert.equal(bad.status,2);assert.equal(bad.stdout,'');
 assert.doesNotMatch(bad.stderr.trim(),/[\x00-\x1f\x7f-\x9f\u2028\u2029]/);assert.ok(bad.stderr.includes('\\n'));
});
for(const [expected,rubric]of [['猫','山猫'],['é','café'],['42','142']])test('AC-23/P23: Unicode whole-word negative '+expected,()=>{
 const report=lint(P.skillAt(temp(),[{prompt:'Name something',expected,rubric}]));assert.equal(report.cases[0].findings.length,0);
});
test('AC-22/P22: ties, multiple matches, repeat calls, row order and duplicate representative are canonical',()=>{
 const root=temp();const dir=P.skillAt(root,[{id:'a',prompt:'ONE two three four five x six seven eight nine ten',rubric:'blue whale and blue whale',expected:'blue whale'},{id:'b',prompt:'one two three four five y six seven eight nine ten',rubric:'Clear.'}]);
 // 5/11 is below threshold, so use an identical pair for tie evidence alongside the repeated answer.
 const r1=P.receiptFor(dir,1);const r2=P.receiptFor(dir,2);const receiptsDir=P.receiptsAt(root,[]);
 for(const [file,r]of [['z.json',r1],['b.json',r2],['a.json',r1]])fs.writeFileSync(path.join(receiptsDir,file),JSON.stringify(r));
 const report=lint(dir,{receiptsDir});assert.deepEqual(lint(dir,{receiptsDir}),report);
 assert.deepEqual(report.cases[0].findings.find(f=>f.kind==='ceiling').evidence.receipts.map(x=>x.file),['a.json','b.json']);
 const answer=report.cases[0].findings.filter(f=>f.kind==='answer-text');assert.equal(answer.length,1);assert.equal(answer[0].evidence.matched,'blue whale');
 for(const [file,r]of [['a.json',r1],['b.json',r2],['z.json',r1]]){const reordered=structuredClone(r);reordered.results.cases.reverse();sealReceipt(reordered);fs.writeFileSync(path.join(receiptsDir,file),JSON.stringify(reordered));}
 const reordered=lint(dir,{receiptsDir});
 // Resealing changes hashes, which are evidence. Restore hashes in the comparison only after independently checking new receipts.
 P.history(reordered,'a','ceiling',[JSON.parse(fs.readFileSync(path.join(receiptsDir,'a.json'))),JSON.parse(fs.readFileSync(path.join(receiptsDir,'b.json')))]);
 const comparable=x=>{const y=structuredClone(x);for(const c of y.cases)for(const f of c.findings)if(f.evidence.receipts)for(const r of f.evidence.receipts)r.hash='resealed';return y;};assert.deepEqual(comparable(reordered),comparable(report));
 for(const file of ['a.json','b.json','z.json'])fs.unlinkSync(path.join(receiptsDir,file));
 for(const [file,r]of [['a.json',r1],['b.json',r2],['z.json',r1]])fs.writeFileSync(path.join(receiptsDir,file),JSON.stringify(r));assert.deepEqual(lint(dir,{receiptsDir}),report);
});
test('AC-22/P22: longest equal runs choose earliest first-prompt position',()=>{
 const a='one two three four five six seven eight nine ten';const b='one two three four five six seven eight X one two three four five six seven eight';
 // longest 8 words appears twice in b; larger denominator limits this pair. It must remain absent, without inventing a higher ratio.
 const report=lint(P.skillAt(temp(),[{id:'a',prompt:a,rubric:'Clear.'},{id:'b',prompt:b,rubric:'Clear.'}]));assert.equal(P.findings(report,'a','near-duplicate').length,0);
});
for(const [label,raw,pattern]of [
 ['work',Array.from({length:500},(_,i)=>({id:'c'+i,prompt:'word '.repeat(3000),rubric:'Clear.'})),/LINT_WORK/],
 ['output',Array.from({length:500},(_,i)=>({id:'c'+i,prompt:'word',rubric:'Clear.'})),/LINT_OUTPUT/],
])test('AC-14/P14: named '+label+' budget refusal before output',()=>{
 const root=temp();const dir=P.skillAt(root,raw);rejectLibrary(dir,{},2,pattern);const r=cli(root,['lint-suite',dir]);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.match(r.stderr,pattern);
});
for(const [label,setup,pattern]of [
 ['suite annotation',({dir})=>{fs.appendFileSync(path.join(dir,'evals/evals.json'),' '.repeat(8388609));},/LINT_SUITE_BYTES/],
 ['huge receipt',({receiptsDir})=>{fs.truncateSync(path.join(receiptsDir,'r1.json'),8388609);},/LINT_RECEIPT_BYTES/],
 ['receipt link',({receiptsDir})=>{fs.unlinkSync(path.join(receiptsDir,'r1.json'));fs.symlinkSync('/dev/zero',path.join(receiptsDir,'r1.json'));},/regular|link/i],
 ['skill link device',({dir})=>{fs.unlinkSync(path.join(dir,'SKILL.md'));fs.symlinkSync('/dev/zero',path.join(dir,'SKILL.md'));},/link|regular/i],
 ['receipt directory link',({root,receiptsDir})=>{fs.renameSync(receiptsDir,path.join(root,'actual'));fs.symlinkSync(path.join(root,'actual'),receiptsDir);},/directory|link/i],
 ['receipt count',({receiptsDir,receipts})=>{for(let i=0;i<65;i++)fs.writeFileSync(path.join(receiptsDir,'extra'+i+'.json'),JSON.stringify(receipts[0]));},/LINT_RECEIPT_COUNT/],
 ['directory entries',({receiptsDir})=>{for(let i=0;i<4097;i++)fs.writeFileSync(path.join(receiptsDir,'entry'+i),'');},/LINT_DIRECTORY_ENTRIES/],
 ['total receipt bytes',({receiptsDir})=>{for(let i=0;i<9;i++){const f=path.join(receiptsDir,'large'+i+'.json');fs.writeFileSync(f,'{}');fs.truncateSync(f,8388608);}},/LINT_RECEIPT_TOTAL/],
])test('AC-15/P15: bounded refusal for '+label,()=>{
 const ctx=context();ctx.receiptsDir=P.receiptsAt(ctx.root,ctx.receipts);setup(ctx);
 rejectLibrary(ctx.dir,{receiptsDir:ctx.receiptsDir},2,pattern);const r=cli(ctx.root,['lint-suite',ctx.dir,'--receipts',ctx.receiptsDir]);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.match(r.stderr,pattern);
});
test('AC-15/P15: descriptor growth is caught by bounded reads', () => {
  const dir = P.skillAt(temp()), target = path.join(dir, 'evals/evals.json');
  fs.appendFileSync(target, ' '.repeat(8388609));
  let bytes = 0;
  const plant = () => {
    const stat = fs.lstatSync, fstat = fs.fstatSync, read = fs.readSync;
    fs.lstatSync = function (file, ...args) { const st = stat.call(this, file, ...args); if (file === target) st.size = 1; return st; };
    fs.fstatSync = function (...args) { const st = fstat.apply(this, args); st.size = 1; return st; };
    fs.readSync = function (...args) { const n = read.apply(this, args); bytes += n; return n; };
    return () => { fs.lstatSync = stat; fs.fstatSync = fstat; fs.readSync = read; };
  };
  assert.throws(() => lint(dir, {}, plant), e => e.exitCode === 2 && /LINT_SUITE_BYTES/.test(e.message));
  assert.ok(bytes > 8388608, 'plant must reach the bounded read, not only the pre-read stat');
});
for(const [label,operation]of [
 ['promise writable open',()=>fs.promises.open('/var/tmp/spec189-outside','w')],
 ['callback writable open',()=>fs.open('/var/tmp/spec189-outside','w',()=>{})],
 ['callback write',()=>fs.write(1,'planted',()=>{})],
 ['socket connect',()=>new(require('node:net').Socket)().connect(1,'invalid.example')],
 ['UDP',()=>require('node:dgram').createSocket('udp4')],
 ['outside write',()=>fs.writeFileSync('/var/tmp/spec189-outside','planted')],
])for(const caught of [false,true])for(const refusal of [false,true])test('AC-20/P20: '+label+' through product path, caught='+caught+', refusal='+refusal,()=>{
 const root=temp();const dir=P.skillAt(root);if(refusal)fs.writeFileSync(path.join(dir,'evals/evals.json'),'{');
 let fired=false;
 const plant=()=>{
  const original=fs.openSync;fs.openSync=function(file,...args){
   if(!fired&&String(file).endsWith('SKILL.md')){fired=true;if(caught){try{operation();}catch{}}else operation();}
   return original.call(this,file,...args);
  };
  return ()=>{fs.openSync=original;};
 };
 assert.throws(()=>lint(dir,{},plant),e=>e instanceof assert.AssertionError&&/tripwire/.test(e.message));assert.equal(fired,true);
});


test('AC-22/P22: lexical ties and earliest answer match have one defined selection', () => {
  const root=temp();const dir=P.skillAt(root,[{id:'a',prompt:'a b a b a b',rubric:'BLUE, WHALE then blue whale',expected:'blue whale'},{id:'b',prompt:'b a b a b a',rubric:'Clear.'}]);
  const report=lint(dir);P.near(report,'a','b',['a','b','a','b','a'],[6,6],5/6);
  P.near(report,'b','a',['a','b','a','b','a'],[6,6],5/6);
  assert.equal(P.findings(report,'a','answer-text')[0].evidence.matched,'BLUE, WHALE');
  const r=cli(root,['lint-suite',dir]);assert.equal(r.status,0);P.parity(r.stdout.trim(),report);
});
test('AC-19/P19: astral format controls escape without changing evidence',()=>{
 const root=temp();const dir=P.skillAt(root,[{id:'a\u{1bca0}',prompt:'Name an animal',rubric:'Clear.'}]);const report=lint(dir);
 const r=cli(root,['lint-suite',dir]);assert.equal(r.status,0);P.parity(r.stdout.trim(),report);assert.doesNotMatch(r.stdout,/\p{Cf}/u);
});
for (const kind of ['FIFO', 'socket', 'device']) test('AC-15/P15: ' + kind + ' metadata refuses before opening the candidate', () => {
  const { root, dir, receipts } = context();
  const receiptsDir = P.receiptsAt(root, receipts), target = path.join(receiptsDir, 'r1.json');
  let opened = false;
  const plant = () => {
    const lstat = fs.lstatSync, open = fs.openSync;
    fs.lstatSync = function (file, ...args) {
      const st = lstat.call(this, file, ...args);
      if (file === target) st.isFile = () => false;
      return st;
    };
    fs.openSync = function (file, ...args) { if (file === target) opened = true; return open.call(this, file, ...args); };
    return () => { fs.lstatSync = lstat; fs.openSync = open; };
  };
  assert.throws(() => lint(dir, { receiptsDir }, plant), e => e.exitCode === 2 && /regular/.test(e.message));
  assert.equal(opened, false);
});
test('AC-15/P15: descriptor ceasing to be regular refuses before reading', () => {
  const dir = P.skillAt(temp()); let readAny = false;
  const plant = () => {
    const original = fs.fstatSync, read = fs.readSync;
    fs.fstatSync = function (...args) { const st = original.apply(this, args); st.isFile = () => false; return st; };
    fs.readSync = function (...args) { readAny = true; return read.apply(this, args); };
    return () => { fs.fstatSync = original; fs.readSync = read; };
  };
  assert.throws(() => lint(dir, {}, plant), e => e.exitCode === 2 && /regular/.test(e.message));
  assert.equal(readAny, false);
});
for(const operation of ['promise','callback','write','socket','udp','file'])for(const caught of ['0','1'])for(const refusal of [false,true])test('AC-20/P20: CLI '+operation+' bypass, caught='+caught+', refusal='+refusal,()=>{
 const root=temp();const dir=P.skillAt(root);if(refusal)fs.writeFileSync(path.join(dir,'evals/evals.json'),'{');
 assert.throws(()=>cli(root,['lint-suite',dir],{SPEC189_PLANT:operation,SPEC189_CAUGHT:caught}),e=>e instanceof assert.AssertionError&&/tripwire/.test(e.message));
});
test('AC-20/P20: file-handle writes are independently trapped',async()=>{
 const root=temp();const file=path.join(root,'read-only');fs.writeFileSync(file,'unchanged');const guard=install();let handle;
 try{handle=await fs.promises.open(file,'r');assert.throws(()=>handle.write('planted'),/SPEC189 forbidden/);assert.equal(guard.hits.length,1);}
 finally{if(handle)await handle.close();guard.restore();}assert.equal(fs.readFileSync(file,'utf8'),'unchanged');
});


test('AC-15/P15: bounded skill tree counts empty directories as well as files', () => {
  const root = temp(), dir = P.skillAt(root);
  for (let i = 0; i < 80; i++) for (let j = 0; j < 80; j++) fs.mkdirSync(path.join(dir, 'd' + i, 'e' + j), { recursive: true });
  rejectLibrary(dir, {}, 2, /LINT_DIRECTORY_ENTRIES/);
  const r = cli(root, ['lint-suite', dir]);
  assert.equal(r.status, 2); assert.equal(r.stdout, ''); assert.match(r.stderr, /LINT_DIRECTORY_ENTRIES/);
});


test('AC-4/P4: deeply nested unsealed receipt refuses by file before report', () => {
  const { root, dir, receipts } = context(), receiptsDir = P.receiptsAt(root, receipts);
  fs.writeFileSync(path.join(receiptsDir, 'r2.json'), '{"receipt_hash":"bad","annotation":' + '['.repeat(10000) + '0' + ']'.repeat(10000) + '}');
  rejectLibrary(dir, { receiptsDir }, 4, /r2\.json.*seal|seal.*r2\.json/i);
  const r = cli(root, ['lint-suite', dir, '--receipts', receiptsDir]);
  assert.equal(r.status, 4); assert.equal(r.stdout, ''); assert.match(r.stderr, /r2.json/);
});
