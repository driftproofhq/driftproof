// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
process.env.DRIFTPROOF_STUB = '1';
const provider = require('../lib/provider');
const complete = provider.complete;
let generationCalls = 0;
let providerCalls = 0;
provider.complete = async (args) => {
  providerCalls++;
  if (!/Return ONLY this JSON object/.test(args.prompt)) generationCalls++;
  return { ...await complete(args), reportedModels: [provider.resolveModel(args.model)] };
};
const { runSkillOnModel } = require('../lib/run');
const { loadSkill } = require('../lib/skill');
const { triage } = require('../lib/reuse');
const { staleReport, renderText } = require('../lib/stale');
const { sealReceipt, validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { regradeReceipt, readRevisedSuite } = require('../lib/regrade');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue580-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const model = 'claude-haiku-4-5';
const cases = [
  { id: 'one', prompt: 'Name a colour.', rubric: 'One colour.', pass_threshold: 0.7 },
  { id: 'two', prompt: 'Name a planet.', rubric: 'One planet.', pass_threshold: 0.7 },
];
const clone = structuredClone;
function skillAt(name, rows) {
  const d = path.join(dir, name);
  fs.mkdirSync(path.join(d, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), "# Fixture\n\nAnswer in one sentence.\n");
  fs.writeFileSync(path.join(d, 'evals/evals.json'), JSON.stringify({ cases: rows }));
  return loadSkill(d);
}
let original, skill, kept;
test.before(async () => {
  skill = skillAt('original', cases);
  const result = await runSkillOnModel({ skill, model, opts: { samples: 2, keepTranscripts: true } });
  kept = Object.fromEntries(result.answers.filter(x => x.answer).map(x => [createHash('sha256').update(x.answer).digest('hex'), x.answer]));
  original = result.receipt;
});
function assess(receipt, rows) {
  const current = skillAt('current', rows);
  const file = path.join(dir, 'receipt.json');
  fs.writeFileSync(file, JSON.stringify(receipt));
  const doc = staleReport([file], { skill: current.dir, model, judge: model, noHarnessCheck: true });
  assert.equal(doc.summary.errors, 0, JSON.stringify(doc.receipts));
  return { doc, result: doc.receipts[0], current, file };
}
function rubric() { const r = clone(cases); r[1].rubric = 'Exactly one planet, no other words.'; return r; }
function both(result, decision) {
  assert.equal(result.arms.with_skill.decision, decision);
  assert.equal(result.arms.baseline.decision, decision);
}
test('580 a run seals prompt and grading evidence; rubric-only stale names the affected case', () => {
  for (const row of original.results.cases) {
    assert.equal(row.generation.suite_case.prompt_hash, createHash('sha256').update(cases.find(c => c.id === row.id).prompt).digest('hex'));
  }
  assert.equal(verifyReceiptHash(original), true);
  assert.equal(validateReceipt(original).valid, true);
  const { doc, result } = assess(original, rubric());
  both(result, 'regrade');
  assert.deepEqual(result.arms.baseline.cases, ['two']);
  assert.equal(doc.exit_code, 1);
  assert.match(renderText(doc), /regrade case\(s\) two/);
  assert.match(result.next, /regrade .* --skill <original-skill-dir> .*--rubric /);
  assert.ok(result.next.includes('--judge-model ' + model));
});
test('580 threshold-only changes regrade the affected case', () => {
  const rows = clone(cases); rows[0].pass_threshold = 0.9;
  const { result } = assess(original, rows);
  both(result, 'regrade');
  assert.deepEqual(result.arms.baseline.cases, ['one']);
});
for (const [name, change] of [
  ['prompt edit', r => { r[0].prompt += ' Explain why.'; }],
  ['case add', r => { r.push({ id: 'three', prompt: 'Name a tree.', rubric: 'One tree.' }); }],
  ['case remove', r => { r.pop(); }],
  ['case reorder', r => { r.reverse(); }],
  ['grading kind', r => { r[1].criteria = [{ id: 'planet', description: 'A planet.', weight: 1 }]; }],
]) test('580 ' + name + ' with a rubric edit reruns', () => {
  const rows = rubric(); change(rows);
  both(assess(original, rows).result, 'rerun');
});
for (const [name, change] of [
  ['old receipt', r => { for (const c of r.results.cases) delete c.generation.suite_case; }],
  ['missing evidence', r => { delete r.results.cases[0].generation.suite_case; }],
  ['malformed evidence', r => { r.results.cases[0].generation.suite_case = { prompt_hash: 'bad' }; }],
  ['conflicting arm evidence', r => { r.results.cases[0].generation.suite_case = { ...r.results.cases[0].generation.suite_case, prompt_hash: '0'.repeat(64) }; }],
]) test('580 ' + name + ' stays valid and reruns', () => {
  const r = clone(original); change(r); const sealed = sealReceipt(r);
  assert.equal(validateReceipt(sealed).valid, true);
  both(assess(sealed, rubric()).result, 'rerun');
});
test('580 stale rejects unsealed evidence', () => {
  const r = clone(original); r.results.cases[0].generation.suite_case = { prompt_hash: '0'.repeat(64) };
  const file = path.join(dir, 'unsealed.json'); fs.writeFileSync(file, JSON.stringify(r));
  assert.equal(staleReport([file]).exit_code, 2);
});
test('580 real CLI JSON and text carry the rubric route', () => {
  const { current, file } = assess(original, rubric());
  const args = [path.resolve('bin/driftproof'), 'stale', file, '--skill', current.dir, '--model', model, '--judge', model, '--no-harness-check'];
  const run = extra => spawnSync(process.execPath, [...args, ...extra], { cwd: dir, env: { ...process.env, DRIFTPROOF_STUB: '1' }, encoding: 'utf8', timeout: 1800000 });
  const json = run(['--json']); assert.equal(json.status, 1, json.stderr);
  both(JSON.parse(json.stdout).receipts[0], 'regrade');
  const text = run([]); assert.equal(text.status, 1, text.stderr);
  assert.match(text.stdout, /regrade case\(s\) two/);
});
test('580 rubric regrade makes no generations and its evidence supports the next comparison', async () => {
  const rows = rubric();
  const revisedSkill = skillAt('revised', rows);
  const revised = readRevisedSuite(path.join(revisedSkill.dir, 'evals/evals.json'));
  const before = generationCalls;
  const out = await regradeReceipt({ receipt: original, skill, answers: kept, judgeModel: model, samples: 2, revised, opts: {} });
  assert.equal(generationCalls, before);
  assert.equal(validateReceipt(out.receipt).valid, true);
  assert.equal(verifyReceiptHash(out.receipt), true);
  both(triage(original, out.receipt), 'regrade');
  assert.deepEqual(triage(original, out.receipt).cases, ['two']);
  const changed = clone(out.receipt); changed.run.model_id = 'gpt-5.5';
  both(triage(original, sealReceipt(changed)), 'rerun');
  const unsealed = clone(out.receipt); unsealed.results.cases[0].generation.suite_case.prompt_hash = '0'.repeat(64);
  both(triage(original, unsealed), 'rerun');
  const next = clone(rows); next[0].pass_threshold = 0.9;
  both(assess(out.receipt, next).result, 'regrade');
});

test('580 a partial run cannot establish the full suite prompts', async () => {
  const result = await runSkillOnModel({ skill, model, opts: { samples: 2, maxCases: 1 } });
  assert.equal(validateReceipt(result.receipt).valid, true);
  both(assess(result.receipt, rubric()).result, 'rerun');
});

// Issue 617: the rerun command, pasted as printed, is taken by run's own flag table.
test('617 the printed rerun command runs as printed', () => {
  const rows = clone(cases); rows[0].prompt += ' Explain why.';
  const { result } = assess(original, rows);
  both(result, 'rerun');
  assert.match(result.next, /^driftproof run /);
  const pasted = spawnSync('sh', ['-c', 'driftproof() { exec "$NODE" "$BIN" "$@"; }\n' + result.next], {
    cwd: dir, encoding: 'utf8', timeout: 1800000,
    env: { ...process.env, DRIFTPROOF_STUB: '1', NODE: process.execPath, BIN: path.resolve('bin/driftproof') },
  });
  assert.doesNotMatch(pasted.stderr, /REFUSED/);
  assert.equal(pasted.status, 0, pasted.stderr);
});
test('580 prompt-only edits rerun and unchanged old receipts retain their reading', () => {
  const rows = clone(cases); rows[0].prompt += ' Explain.';
  both(assess(original, rows).result, 'rerun');
  const legacy = clone(original);
  for (const c of legacy.results.cases) delete c.generation.suite_case;
  const a = assess(original, cases).result;
  const b = assess(sealReceipt(legacy), cases).result;
  assert.deepEqual(a.arms, b.arms);
});
test('580 an edited original is refused by regrade before any generation', async () => {
  const current = skillAt('wrong-original', rubric());
  const before = generationCalls;
  await assert.rejects(regradeReceipt({ receipt: original, skill: current, answers: kept, judgeModel: model, samples: 2, opts: {} }), /suite.*hash/);
  assert.equal(generationCalls, before);
});
test('580 unexplained suite changes and a simultaneous skill change do not bypass rerun', () => {
  const altered = clone(original); altered.suite.suite_hash = '0'.repeat(64);
  both(triage(original, sealReceipt(altered)), 'rerun');
  const { current, file } = assess(original, rubric());
  fs.appendFileSync(path.join(current.dir, 'SKILL.md'), 'Use two sentences.');
  const r = staleReport([file], { skill: current.dir, model, judge: model, noHarnessCheck: true }).receipts[0];
  assert.equal(r.arms.with_skill.decision, 'rerun');
  assert.equal(r.arms.baseline.decision, 'regrade');
  assert.match(r.next, /driftproof run /);
});

test('580 context-file subjects keep rerun because the rubric CLI requires an original skill directory', async () => {
  const file = path.join(dir, 'rules.md'); fs.writeFileSync(file, '# Rules\nAnswer briefly.');
  const suiteFile = path.join(dir, 'context-suite.json'); fs.writeFileSync(suiteFile, JSON.stringify({ cases }));
  const subject = require('../lib/skill').loadSubject(file, { suite: suiteFile });
  const run = await runSkillOnModel({ skill: subject, model, opts: { samples: 2 } });
  const receiptFile = path.join(dir, 'context-receipt.json'); fs.writeFileSync(receiptFile, JSON.stringify(run.receipt));
  fs.writeFileSync(suiteFile, JSON.stringify({ cases: rubric() }));
  const report = staleReport([receiptFile], { skill: file, suite: suiteFile, model, judge: model, noHarnessCheck: true });
  assert.equal(report.summary.errors, 0);
  both(report.receipts[0], 'rerun');
});

test('580 judge-only checks without a current suite keep the plain regrade command', () => {
  const file = path.join(dir, 'judge-only.json'); fs.writeFileSync(file, JSON.stringify(original));
  const report = staleReport([file], { model, judge: 'gpt-5.5', noHarnessCheck: true });
  assert.equal(report.summary.errors, 0);
  both(report.receipts[0], 'regrade');
  assert.ok(!report.receipts[0].next.includes('--rubric'));
  assert.match(report.receipts[0].next, /--judge-model gpt-5\.5/);
});

// Issue 606: data plants for receipt kinds the regrade executor refuses.
function validSealed(receipt) {
  const checked = validateReceipt(receipt);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(verifyReceiptHash(receipt), true);
}
function rerunRoute(doc) {
  assert.equal(doc.summary.errors, 0, JSON.stringify(doc.receipts));
  const result = doc.receipts[0];
  both(result, 'rerun');
  assert.equal(result.axes.find(a => a.axis === 'suite').effect, 'rerun');
  assert.equal(doc.exit_code, 1);
  assert.match(result.next, /driftproof run /);
  assert.doesNotMatch(result.next, /regrade|--rubric/);
  assert.match(renderText(doc), /driftproof run /);
  assert.doesNotMatch(renderText(doc), /regrade|--rubric/);
}
for (const edit of ['rubric', 'threshold']) {
  test('606 placebo receipt with a ' + edit + ' edit offers rerun in JSON and text', async () => {
    const { receipt } = await runSkillOnModel({ skill, model, opts: { samples: 2, placebo: true } });
    validSealed(receipt);
    assert.ok(receipt.placebo);
    assert.ok(receipt.results.cases.some(c => c.mode === 'placebo'));
    const rows = clone(cases);
    if (edit === 'rubric') rows[1].rubric = rubric()[1].rubric;
    else rows[1].pass_threshold = 0.9;
    const bytes = JSON.stringify(receipt);
    const before = providerCalls;
    await assert.rejects(regradeReceipt({ receipt }), { code: 'PLACEBO_REGRADE' });
    const { doc, current, file } = assess(receipt, rows);
    assert.equal(providerCalls, before);
    assert.equal(JSON.stringify(receipt), bytes);
    // The actual CLI must carry the same recommendation as the shared reader.
    const args = [path.resolve('bin/driftproof'), 'stale', file, '--skill', current.dir,
      '--model', model, '--judge', model, '--no-harness-check'];
    const json = spawnSync(process.execPath, [...args, '--json'], { cwd: dir, encoding: 'utf8', timeout: 1800000 });
    assert.equal(json.status, 1, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout).receipts[0].arms, doc.receipts[0].arms);
    const human = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', timeout: 1800000 });
    assert.equal(human.status, 1, human.stderr);
    rerunRoute(doc);
    rerunRoute(JSON.parse(json.stdout));
    assert.match(human.stdout, /driftproof run /);
    assert.doesNotMatch(human.stdout, /regrade|--rubric/);
  });
}
test('606 reuse excludes placebo on either side of a rubric comparison', async () => {
  const revisedSkill = skillAt('606-revised', rubric());
  const ordinary = (await runSkillOnModel({ skill: revisedSkill, model, opts: { samples: 2 } })).receipt;
  const placebo = (await runSkillOnModel({ skill, model, opts: { samples: 2, placebo: true } })).receipt;
  for (const receipt of [original, ordinary, placebo]) validSealed(receipt);
  const bytes = JSON.stringify([original, ordinary, placebo]);
  const before = providerCalls;
  both(triage(original, ordinary), 'regrade');
  const forward = triage(placebo, ordinary);
  const reverse = triage(ordinary, placebo);
  assert.equal(providerCalls, before);
  assert.equal(JSON.stringify([original, ordinary, placebo]), bytes);
  both(forward, 'rerun');
  both(reverse, 'rerun');
  for (const result of [forward, reverse]) {
    assert.equal(result.axes.find(a => a.axis === 'suite').effect, 'rerun');
  }
});
test('606 execution-scored receipt with sealed prompt evidence and a rubric edit offers rerun', async () => {
  const receipt = clone(require('../receipts/report-016/receipt-15f01115639f.json'));
  const raw = clone(require('../specs/471-rules-files-report/evals.json'));
  const { suiteIdentity, suiteCaseEvidence } = require('../lib/skill');
  const originalSuite = suiteIdentity(raw);
  assert.equal(receipt.suite.suite_hash, originalSuite.suiteHash);
  assert.ok(receipt.run.scoring);
  // Align the scratch fixture's grading hashes with this runner so an older
  // judge template does not add unrelated drift to the rubric-only edit.
  const { promptTemplateHash, caseRubricHash } = require('../lib/judge');
  receipt.run.judge.prompt_template_hash = promptTemplateHash();
  // Add the optional evidence old receipts predate, keeping all execution data.
  for (const row of receipt.results.cases) {
    const i = originalSuite.cases.findIndex(c => c.id === row.id);
    assert.ok(i >= 0);
    row.generation.suite_case = suiteCaseEvidence(originalSuite.cases[i], i);
    row.judge.rubric_hash = caseRubricHash(originalSuite.cases[i]);
  }
  const sealed = sealReceipt(receipt);
  validSealed(sealed);
  const revised = clone(originalSuite.cases);
  revised[0].rubric += ' Explain each assertion.';
  const suiteFile = path.join(dir, '606-execution-suite.json');
  const receiptFile = path.join(dir, '606-execution-receipt.json');
  fs.writeFileSync(suiteFile, JSON.stringify({ cases: revised }));
  fs.writeFileSync(receiptFile, JSON.stringify(sealed));
  const bytes = JSON.stringify(sealed);
  const before = providerCalls;
  await assert.rejects(regradeReceipt({ receipt: sealed }), { code: 'EXECUTION_REGRADE' });
  const doc = staleReport([receiptFile], { suite: suiteFile, fromReceipt: true, noHarnessCheck: true });
  assert.equal(providerCalls, before);
  assert.equal(JSON.stringify(sealed), bytes);
  rerunRoute(doc);
  assert.match(renderText(doc), /repo contract/);
});
