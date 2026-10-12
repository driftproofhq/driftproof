// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 205, spec 188. Only this test file runs during the claim-review stage.
// Product calls use the offline stub. Planner probes deny network and child
// processes independently. Scratch, receipts and stdout stay under /var/tmp.
// Loading lib/plan.js is inside each test so missing implementation reads red
// on each contract, while independent plant checks can still run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
process.env.DRIFTPROOF_STUB = '1';
const { loadSkill, suiteIdentity } = require('../lib/skill');
const { runSkillOnModel, projectCalls, outcomeFor } = require('../lib/run');
const { sealReceipt, validateReceipt, verifyReceiptHash, comparisonOf } = require('../lib/receipt');
const { acrossDraws } = require('../lib/sampling');
const { placeCounts, resolveCount } = require('../lib/counts');
const { estimateRunCostUSD } = require('../lib/cost');
const { resolveModel, surfaceForModel } = require('../lib/provider');
const { judgeSettings } = require('../lib/judge');
const { caseRule, suiteBand, bandDriver, receiptVerdict } = require('../lib/verdict');
const { SAMPLING } = require('../lib/sampling');
const { DEFAULT_JUDGE_SAMPLES, EFFECT_FLOOR, POWER_Z } = require('../config');
const oracle = require('../specs/188-issue-205-plan/probes/contract.cjs');
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin/driftproof');
const MODEL = resolveModel('haiku');
const JUDGE = resolveModel('sonnet');
const QUALIFICATIONS = 'Spreads held. Writes no receipt and moves no verdict. Targets are hypothetical; the runner may stop before them. Recorded provenance must still hold; this cannot certify currentness offline.';
const TIME = '2026-10-10T22:33:00.000Z';
let scratch, skillDir, skill, original, guard;
const planner = () => require('../lib/plan.js');
const defaultInput = (extras = {}) => ({ skill, model: MODEL, judgeModel: JUDGE, samples: 2, ...extras });
function env(stub = true) {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^NODE_OPTIONS$/.test(k)) continue;
    out[k] = v;
  }
  return { ...out, TMPDIR: '/var/tmp', ...(stub ? { DRIFTPROOF_STUB: '1' } : {}) };
}
function child(args, { denied = false, cwd = scratch, stub = true } = {}) {
  return spawnSync(process.execPath, [...(denied ? ['--require', guard] : []), BIN, ...args], {
    cwd, env: env(stub), encoding: 'utf8', timeout: 1800000, maxBuffer: 4 * 1024 * 1024,
  });
}
function successful(r) {
  assert.equal(r.error, undefined, r.error && r.error.message);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
}
function refused(r, named) {
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.equal(r.stdout.trim(), '', 'refusal must not ship a partial plan');
  assert.match(r.stderr, /refused|invalid|cannot|expected|missing|not|unknown|duplicate|no /i);
  if (named) assert.match(r.stderr, named);
}
function receiptFile(r, name = 'evidence.json') {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, JSON.stringify(r));
  return file;
}
function fingerprint(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, entry.name), rel = path.relative(dir, p);
      if (entry.isSymbolicLink()) out.push([rel, 'link', fs.readlinkSync(p)]);
      else if (entry.isDirectory()) { out.push([rel, 'dir']); walk(p); }
      else out.push([rel, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]);
    }
  };
  walk(dir);
  return JSON.stringify(out);
}
function valid(r) {
  assert.ok(verifyReceiptHash(r), 'fixture is sealed');
  const result = validateReceipt(r);
  assert.ok(result.valid, JSON.stringify(result.errors));
  return r;
}
function updateCounts(r) {
  delete r.run.counts;
  if (r.run.arms) for (const a of Object.values(r.run.arms)) delete a.counts;
  for (const c of r.results.cases) delete c.counts;
  placeCounts(r, r.results.cases.map((c, index) => ({ index, counts: {
    generations_per_arm: c.generation.draws.length,
    judge_samples_per_generation: r.run.judge.samples,
  } })));
}
// Synthetic but schema-valid, kept UNVERIFIED and surface stub. Re-sealing a
// fixture never stamps it TESTED. Draw means, generation summaries and counts
// all derive from the same explicit score lists.
function shaped(byId = {}, { omitted = [], lost = [], at = TIME } = {}) {
  const r = structuredClone(original);
  r.run.date_utc = at;
  r.run.generated_at = at;
  r.results.cases = r.results.cases.filter((c) => !omitted.includes(c.id));
  for (const c of r.results.cases) {
    const scores = (byId[c.id] && byId[c.id][c.mode]) || [0.49, 0.5, 0.51];
    const template = c.generation.draws[0];
    const draws = scores.map((score, i) => ({
      ...structuredClone(template), draw_index: i,
      mean: score, stddev: 0, samples: Array(r.run.judge.samples).fill(score),
    }));
    if (lost.some((x) => x.id === c.id && x.mode === c.mode)) {
      draws.push({ draw_index: draws.length, generation_hash: null, status: 'unmeasured', reason: 'timeout', samples: [], mean: null, stddev: null, stop_reason: null, truncated: false, reported_model: null });
    }
    const a = acrossDraws(draws);
    c.generation = { ...c.generation, draws, ...a, n_truncated: 0 };
    c.mean = a.mean; c.score = a.mean; c.stddev = a.sd;
    c.outcome = outcomeFor(a.mean, a.sd, c.threshold);
    c.samples = draws[0].samples;
    if (a.n_measured === 0) {
      c.case_status = 'failed_timeout'; c.reason = 'timeout';
      for (const key of ['mean','score','stddev','samples','outcome','threshold','judge','generation_hash','judge_sample_hashes','usage','judge_usage','checks']) delete c[key];
      r.run.status = 'incomplete';
    }
  }
  // Issue 13 moved comparisonOf to raw rows so both aggregate arms use matched cases.
  // Keep synthetic evidence on the same receipt construction path as run.
  const calculated = comparisonOf(r.results.cases);
  r.results.aggregates = calculated.aggregates;
  r.comparison = calculated.comparison;
  const failed = (calculated.aggregates.excluded_cases || []).length;
  if (failed) r.run.failed_case_count = failed;
  else delete r.run.failed_case_count;
  updateCounts(r);
  return valid(sealReceipt(r));
}
// Model-lane shape for compatibility checks only. No model was called and
// these invented scores establish no public measurement or TESTED receipt.
function modelEvidence() {
  const r = shaped();
  r.run.surface = surfaceForModel(MODEL);
  r.run.harness = { name: 'claude-code', version: 'fixture-v1' };
  r.run.answered_by = { kind: 'model', attested: true, reported_model: MODEL,
    reported_models: [MODEL], isolation: 'eval-user' };
  Object.assign(r.run.judge, judgeSettings(r.run.judge.samples, JUDGE), {
    harness: { name: 'claude-code', version: 'fixture-v1' }, isolation: 'eval-user',
  });
  return valid(sealReceipt(r));
}
function powerPlan(r, extras = {}) {
  return planner().planSkill(defaultInput({ receipts: [r], draws: 3, ...extras }));
}
function caseOf(p, id = 'c1') {
  const c = p.cases.find((c) => c.id === id);
  assert.ok(c, 'current case missing: ' + id);
  return c;
}
function caseInput(r, draws = 3, lift = EFFECT_FLOOR, id = 'c1') {
  const scores = (mode) => r.results.cases.find((c) => c.id === id && c.mode === mode).generation.draws.filter((d) => d.status === 'measured').map((d) => d.mean);
  return { withScores: scores('with_skill'), baseScores: scores('baseline'), hash: r.receipt_hash, samples: r.run.judge.samples, draws, lift };
}

test.before(async () => {
  scratch = fs.mkdtempSync('/var/tmp/spec188-plan-');
  skillDir = path.join(scratch, 'skill');
  fs.mkdirSync(path.join(skillDir, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: plan-fixture\nversion: 1.0.0\n---\n# Plan fixture\nAnswer each task in one sentence.\n');
  fs.writeFileSync(path.join(skillDir, 'evals/evals.json'), JSON.stringify({ cases: [1, 2].map((n) => ({ id: 'c' + n, prompt: 'Answer task ' + n, rubric: 'One sentence.', pass_threshold: 0.7 })) }));
  skill = loadSkill(skillDir);
  original = valid((await runSkillOnModel({ skill, model: MODEL, opts: { samples: 2, judgeModel: JUDGE, nowIso: TIME } })).receipt);
  guard = path.join(scratch, 'deny.cjs');
  fs.writeFileSync(guard, String.raw`
'use strict';
const attempts = [];
const deny = (...args) => { attempts.push('forbidden'); throw new Error('SPEC188_FORBIDDEN_CALL'); };
process.on('exit', () => { if (attempts.length) { process.stderr.write('SPEC188_FORBIDDEN_ATTEMPTS=' + attempts.length + '\n'); process.exitCode = 91; } });
const fs = require('node:fs');
for (const key of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'truncate', 'truncateSync', 'ftruncate', 'ftruncateSync', 'write', 'writeSync', 'writev', 'writevSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'link', 'linkSync', 'symlink', 'symlinkSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'utimes', 'utimesSync', 'createWriteStream', 'fchmod', 'fchmodSync', 'fchown', 'fchownSync', 'futimes', 'futimesSync', 'lutimes', 'lutimesSync', 'lchown', 'lchownSync', 'lchmod', 'lchmodSync']) if (fs[key]) fs[key] = deny;
for (const key of ['writeFile', 'appendFile', 'truncate', 'mkdir', 'mkdtemp', 'unlink', 'rm', 'rmdir', 'rename', 'copyFile', 'cp', 'link', 'symlink', 'chmod', 'chown', 'utimes', 'lutimes', 'lchown', 'lchmod']) if (fs.promises[key]) fs.promises[key] = async (...args) => deny(...args);
const writing = (flags) => typeof flags === 'string' ? /[wa+]/.test(flags) : !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND));
for (const key of ['open', 'openSync']) { const read = fs[key]; fs[key] = function(file, flags, ...args) { if (writing(flags)) return deny(); return read.call(this, file, flags, ...args); }; }
const open = fs.promises.open; fs.promises.open = async function(file, flags, ...args) { if (writing(flags)) return deny(); const handle = await open.call(this, file, flags, ...args); for (const key of ['write', 'writev', 'writeFile', 'appendFile', 'truncate', 'chmod', 'chown', 'utimes', 'createWriteStream']) handle[key] = deny; return handle; };
for (const name of ['node:http', 'node:https']) { const m = require(name); m.request = deny; m.get = deny; }
const net = require('node:net'); net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny;
const tls = require('node:tls'); tls.connect = deny;
global.fetch = deny;
const cp = require('node:child_process');
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = deny;
const provider = require(process.env.SPEC188_PROVIDER);
provider.complete = deny;
`);
});
test.after(() => { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); });

// Guard's module location is passed as an environment value, never persisted.
function guardedPlan(args, { stub = false } = {}) {
  const childEnv = { ...env(stub), SPEC188_PROVIDER: path.join(ROOT, 'lib/provider.js') };
  return spawnSync(process.execPath, ['--require', guard, BIN, 'plan', ...args], { cwd: scratch, env: childEnv, encoding: 'utf8', timeout: 1800000, maxBuffer: 4 * 1024 * 1024 });
}

test('AC-1 CLI plan with and without evidence is offline and leaves every input byte unchanged', () => {
  const file = receiptFile(shaped());
  const before = fingerprint(scratch);
  const unknown = successful(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE]));
  oracle.readFallback(unknown, ['c1', 'c2']);
  successful(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE, '--from', file], { stub: true }));
  assert.equal(fingerprint(scratch), before, 'planner writes no files');
});

test('AC-1 library leaves the skill and receipts unchanged and does not move a verdict', () => {
  const r = shaped();
  const input = defaultInput({ receipts: [r] });
  const before = JSON.stringify(input), verdict = receiptVerdict(r);
  planner().planSkill(input);
  assert.equal(JSON.stringify(input), before, 'all arguments unchanged');
  assert.deepEqual(receiptVerdict(r), verdict);
  assert.equal(r.verification_level, 'UNVERIFIED');
});

test('AC-1 independent guard catches provider, network and child calls, and fingerprints catch a receipt write', () => {
  const probe = (expression) => spawnSync(process.execPath, ['--require', guard, '-e', expression], { env: { ...env(), SPEC188_PROVIDER: path.join(ROOT, 'lib/provider.js') }, encoding: 'utf8', timeout: 1800000 });
  for (const expression of [
    "require(process.env.SPEC188_PROVIDER).complete({})",
    "require('node:http').get('http://example.invalid')",
    "require('node:https').request('https://example.invalid')",
    "require('node:net').connect(1)",
    "require('node:tls').connect(1)",
    "fetch('https://example.invalid')",
    "require('node:child_process').spawnSync('example')",
  ]) {
    const out = probe(expression);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /SPEC188_FORBIDDEN_CALL/);
  }
  const before = fingerprint(scratch), file = path.join(scratch, 'planted-receipt.json');
  fs.writeFileSync(file, '{}');
  assert.notEqual(fingerprint(scratch), before);
  fs.unlinkSync(file);
  const r = shaped(), was = JSON.stringify(r);
  r.verification_level = 'TESTED';
  assert.notEqual(JSON.stringify(r), was, 'input mutation detector');
});

test('AC-2 calls and every cost component equal run over different models, judges and draw counts', () => {
  for (const model of [MODEL, JUDGE]) for (const judgeModel of [MODEL, JUDGE]) for (const samples of [1, 2, 5]) for (const draws of [1, 3, SAMPLING.max]) {
    const p = planner().planSkill(defaultInput({ model, judgeModel, samples, draws }));
    oracle.readCost(p, { caseCount: skill.suite.caseCount, samples, draws, model, judgeModel });
  }
});

test('AC-2 default projection equals a real CLI stub run and actual adaptive calls have their own smaller projection', () => {
  const p = planner().planSkill(defaultInput());
  const outDir = path.join(scratch, 'run-out');
  const out = successful(child(['run', skillDir, '--models', MODEL, '--judge-model', JUDGE, '--samples', '2', '--out', outDir]));
  const calls = /projected calls: (\d+)\/model[^\n]*= (\d+)/.exec(out);
  const dollars = /projected cost: ~\$(\d+\.\d+)/.exec(out);
  assert.ok(calls && dollars, 'run printed both budget projections');
  assert.equal(p.calls, Number(calls[2]));
  assert.equal(p.cost.totalUSD.toFixed(2), dollars[1]);
  const file = fs.readdirSync(outDir).find((f) => f.endsWith('.json'));
  const r = valid(JSON.parse(fs.readFileSync(path.join(outDir, file), 'utf8')));
  const ns = r.results.cases.map((_, i) => resolveCount(r, i, 'generations_per_arm'));
  assert.ok(ns.every((n) => n === ns[0]));
  const actual = planner().planSkill(defaultInput({ draws: ns[0] }));
  assert.equal(actual.calls, r.results.cases.reduce((n, c) => n + c.generation.draws.length + c.generation.draws.reduce((j, d) => j + d.samples.length, 0), 0));
  assert.deepEqual(actual.cost, estimateRunCostUSD({ caseCount: skill.suite.caseCount, draws: ns[0], samples: 2, models: [MODEL], judgeModel: JUDGE }));
  assert.ok(actual.calls < p.calls, 'adaptive execution is not the ceiling projection');
});

test('AC-2 cost assertions reject every planted understatement and changed cost component', () => {
  const input = { caseCount: 2, samples: 5, draws: 3, model: MODEL, judgeModel: JUDGE };
  const p = { ...input, calls: projectCalls(2, 5, 3), cost: estimateRunCostUSD({ ...input, models: [MODEL] }) };
  oracle.killed(p, (p) => oracle.readCost(p, input), oracle.COST_PLANTS);
});

test('AC-3 samples affects cost only and draws affects resolution independently', () => {
  const r = shaped();
  const a = powerPlan(r, { samples: 2, draws: 3 });
  const b = powerPlan(r, { samples: 7, draws: 3 });
  const c = powerPlan(r, { samples: 2, draws: 8 });
  assert.deepEqual(a.cases, b.cases, 'judge samples cannot invent generation spread');
  assert.notEqual(a.calls, b.calls);
  assert.notEqual(a.cost.totalUSD, b.cost.totalUSD);
  assert.ok(caseOf(c).resolution < caseOf(a).resolution);
  assert.notEqual(a.calls, c.calls);
  assert.match(planner().formatPlan(b), /spreads? (?:is |are )?held/i);
});

test('AC-4 fixtures are sealed, schema-valid and never TESTED before they reach the planner', () => {
  for (const r of [shaped(), shaped({}, { omitted: ['c2'] }), shaped({}, { lost: [{ id: 'c1', mode: 'baseline' }] }), shaped({ c1: { with_skill: [0.5], baseline: [0.5] } })]) {
    valid(r);
    assert.equal(r.verification_level, 'UNVERIFIED');
    assert.equal(receiptVerdict(r).verdict, 'NOT_MEASURED');
  }
});

test('AC-4 sealed generation records supply spread rather than judge sd or receipt filenames', () => {
  const r = shaped();
  const c = caseOf(powerPlan(r));
  oracle.readCase(c, caseInput(r));
  assert.ok(c.arms.with_skill.sd > 0);
  assert.equal(r.results.cases[0].generation.judge_sd_mean, 0);
  const file = receiptFile(r, 'apparently-foreign-model.json');
  successful(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE, '--from', file], { stub: true }));
});

const corruptions = [
  ['hash', (r) => { r.results.cases[0].generation.draws[0].mean += 0.01; }, false],
  ['schema', (r) => { r.schema_version = 'constructor'; }, true],
  ['duplicate', (r) => { r.results.cases.push(structuredClone(r.results.cases[0])); }, true],
  ['summary', (r) => { r.results.cases[0].generation.sd += 0.01; }, true],
  ['measured count', (r) => { r.results.cases[0].generation.n_measured++; }, true],
  ['drawn count', (r) => { r.results.cases[0].generation.n_drawn++; }, true],
  ['resolved count', (r) => { r.run.counts.generations_per_arm++; }, true],
  ['judge count', (r) => { r.run.judge.samples++; }, true],
  ['draw mean', (r) => { r.results.cases[0].generation.draws[0].mean += 0.02; }, true],
];
for (const [name, mutate, reseal] of corruptions) test('AC-4/AC-6 refuse planted ' + name + ' through both public entry points', () => {
  const r = shaped(); mutate(r);
  const bad = reseal ? sealReceipt(r) : r;
  assert.throws(() => powerPlan(bad), /hash|schema|duplicate|ambiguous|count|mean|summary|draw|sample|spread|invalid/i);
  const file = receiptFile(bad, 'bad-' + name.replace(/ /g, '-') + '.json');
  refused(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE, '--from', file], { stub: true }));
});

const mismatches = [
  ['skill', (r) => { r.skill.content_hash = '0'.repeat(64); }],
  ['suite', (r) => { r.suite.suite_hash = '0'.repeat(64); }],
  ['suite count', (r) => { r.suite.case_count++; }],
  ['model', (r) => { r.run.model_id = JUDGE; }],
  ['judge', (r) => { r.run.judge.model_id = MODEL; }],
  ['case judge', (r) => { r.results.cases[0].judge.model_id = MODEL; }],
  ['arm model', (r) => { r.run.arms = { baseline: { model_id: JUDGE, generated_at: TIME } }; }],
  ['template', (r) => { r.run.judge.prompt_template_hash = '0'.repeat(64); }],
  ['missing template', (r) => { delete r.run.judge.prompt_template_hash; }],
  ['rubric', (r) => { r.results.cases[0].judge.rubric_hash = '0'.repeat(64); }],
  ['threshold', (r) => { r.results.cases[0].threshold = 0.1; }],
  ['temperature', (r) => { r.run.judge.temperature = 0.5; }],
  ['sampling', (r) => { r.run.judge.sampling = 'single'; }],
  ['capture', (r) => { r.run.capture.mode = 'files'; }],
  ['missing capture', (r) => { delete r.run.capture; }],
];
for (const [name, mutate] of mismatches) test('AC-5/AC-6 compatibility plant: ' + name + ' cannot skip the library or CLI door', () => {
  const r = shaped(); mutate(r); const bad = sealReceipt(r);
  assert.throws(() => powerPlan(bad), /skill|suite|model|judge|template|rubric|threshold|temperature|sampling|capture|provenance|invalid|compatib/i);
  const file = receiptFile(bad, 'foreign-' + name.replace(/ /g, '-') + '.json');
  refused(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE, '--from', file], { stub: true }));
});

test('AC-5 criteria weights and descriptions belong to suite identity even when the rubric text holds', () => {
  const cases = skill.suite.cases.map((c) => ({ ...c, criteria: [{ id: 'one', weight: 1, description: 'One sentence.' }] }));
  const a = suiteIdentity({ cases });
  const revised = cases.map((c) => ({ ...c, criteria: [{ ...c.criteria[0], weight: 2 }] }));
  const b = suiteIdentity({ cases: revised });
  assert.notEqual(a.suiteHash, b.suiteHash);
  const current = { ...skill, suite: { ...skill.suite, cases: a.cases, suiteHash: a.suiteHash } };
  assert.throws(() => planner().planSkill(defaultInput({ skill: current, receipts: [shaped()] })), /suite|criteria|compatib/i);
});

test('AC-5 surfaces, harness version and isolation stay constant across all supplied receipts', () => {
  for (const [name, mutate] of [
    ['generation surface', (r) => { r.run.surface = 'claude-cli'; }],
    ['judge surface', (r) => { r.run.judge.surface = 'claude-cli'; }],
    ['harness', (r) => { r.run.harness = { name: 'claude-code', version: 'changed' }; }],
    ['isolation', (r) => { r.run.answered_by.isolation = 'same-user'; }],
  ]) {
    const good = shaped(), r = structuredClone(good); mutate(r);
    assert.throws(() => planner().planSkill(defaultInput({ receipts: [good, sealReceipt(r)] })), /surface|harness|isolation|synthetic|provenance|invalid|compatib/i, name);
  }
});

// A-188-5, F-1/F-3: each receipt must be admitted alone. Only their
// cross-receipt comparison may refuse the pair, in either argument order.
const lanePlants = [
  ['generation surface', r => { r.run.surface = 'openai-cli'; }],
  ['generation harness name', r => { r.run.harness.name = 'codex'; }],
  ['generation harness version', r => { r.run.harness.version = 'fixture-v2'; }],
  ['generation isolation', r => { r.run.answered_by.isolation = 'same-user'; }],
  ['judge harness name', r => { r.run.judge.harness.name = 'codex'; }],
  ['judge harness version', r => { r.run.judge.harness.version = 'fixture-v2'; }],
  ['judge isolation', r => { r.run.judge.isolation = 'same-user'; }],
];
for (const [name, mutate] of lanePlants) test('AC-5 model lane comparison plant: ' + name, () => {
  const good = modelEvidence(), changed = structuredClone(good);
  mutate(changed);
  const bad = valid(sealReceipt(changed));
  for (const r of [good, bad]) {
    assert.equal(powerPlan(r).evidenceKind, 'model', 'fixture reaches the model lane');
    successful(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE,
      '--from', receiptFile(r)]));
  }
  const a = receiptFile(good, 'lane-good.json'), b = receiptFile(bad, 'lane-changed.json');
  for (const order of [[a, b], [b, a]]) {
    assert.throws(() => planner().planSkill(defaultInput({
      receipts: order.map(f => JSON.parse(fs.readFileSync(f, 'utf8'))),
    })), /^Error: plan refused: incompatible or inconsistent surface harness isolation provenance$/, name);
    refused(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE,
      '--from', order[0], '--from', order[1]]), /surface harness isolation provenance/);
  }
});

for (const [name, mutate, reason] of [
  ['generation harness version', r => { r.run.harness.version = null; }, /missing harness version provenance/],
  ['judge surface', r => { r.run.judge.surface = 'openai-cli'; }, /judge surface/],
  ['judge harness', r => { delete r.run.judge.harness; }, /missing judge harness isolation provenance/],
  ['judge harness version', r => { r.run.judge.harness.version = null; }, /missing judge harness version provenance/],
  ['judge isolation', r => { delete r.run.judge.isolation; }, /missing judge harness isolation provenance/],
]) test('AC-5 model lane admission plant: ' + name, () => {
  const r = modelEvidence();
  assert.equal(powerPlan(r).evidenceKind, 'model');
  mutate(r); const bad = valid(sealReceipt(r));
  assert.throws(() => powerPlan(bad), reason);
  refused(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE,
    '--from', receiptFile(bad)]), reason);
});

test('AC-6 every repeated --from is checked, in both orders, before any plan is printed', () => {
  const good = shaped(), bad = structuredClone(good);
  bad.results.cases[0].generation.draws[0].mean += 0.01;
  const a = receiptFile(good, 'good.json'), b = receiptFile(bad, 'tampered.json');
  for (const order of [[a, b], [b, a]]) {
    refused(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE, '--from', order[0], '--from=' + order[1]], { stub: true }));
    assert.throws(() => planner().planSkill(defaultInput({ receipts: order.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))) })), /hash|tamper|invalid/i);
  }
  const malformed = path.join(scratch, 'broken.json'); fs.writeFileSync(malformed, '{');
  refused(guardedPlan([skillDir, '--from', malformed]));
  refused(guardedPlan([skillDir, '--from', path.join(scratch, 'absent.json')]));
});

test('AC-7/AC-8 every per-case figure and strict draw target equal independent statistics and caseRule', () => {
  const r = shaped({ c1: { with_skill: [0.481, 0.5, 0.519], baseline: [0.489, 0.5, 0.511] } });
  for (const draws of [2, 3, 10, 30]) for (const lift of [EFFECT_FLOOR, 0.08, 0.3]) {
    const c = caseOf(powerPlan(r, { draws, lift })), input = caseInput(r, draws, lift);
    oracle.readCase(c, input);
    const w = oracle.measured(input.withScores), b = oracle.measured(input.baseScores);
    const v = caseRule({ ...b, mean: 0.5, n: draws }, { ...w, mean: 0.5, n: draws }, { floor: lift });
    oracle.numeric(c.resolution, v.resolution, 'same R-2 resolution');
    assert.equal(c.state === 'underpowered', v.state === 'underpowered');
    if (v.drawsNeeded !== undefined) assert.equal(c.drawsNeeded, v.drawsNeeded);
  }
});

test('AC-7/AC-8 independent case assertions kill statistic, count and recommendation plants', () => {
  const input = { withScores: [0.49, 0.5, 0.51], baseScores: [0.49, 0.5, 0.51], draws: 2, lift: EFFECT_FLOOR, hash: '1'.repeat(64), samples: 2 };
  const w = oracle.measured(input.withScores), b = oracle.measured(input.baseScores);
  const c = { ...oracle.expectedCase(w, b, input.draws, input.lift), evidenceHash: input.hash, evidenceSamples: 2, arms: { with_skill: w, baseline: b } };
  oracle.killed(c, (c) => oracle.readCase(c, input), oracle.CASE_PLANTS);
});

test('AC-8 strict equality at the resolution requires one more generation draw', () => {
  const r = shaped({ c1: { with_skill: [0.375, 0.5, 0.625], baseline: [0.375, 0.5, 0.625] } });
  const input = caseInput(r, 8), w = oracle.measured(input.withScores), b = oracle.measured(input.baseScores);
  const equality = w.sd + b.sd + POWER_Z * Math.sqrt((w.sd ** 2 + b.sd ** 2) / 8);
  const c = caseOf(powerPlan(r, { draws: 8, lift: equality }));
  assert.equal(c.state, 'underpowered');
  assert.equal(c.drawsNeeded, 9);
  assert.equal(caseOf(powerPlan(r, { draws: 9, lift: equality })).state, 'resolved');
});

test('AC-8 one projected draw stays unknown and a recommendation beyond the runner cap says so', () => {
  oracle.readUnknown(caseOf(powerPlan(shaped(), { draws: 1 })));
  const r = shaped({ c1: { with_skill: [0.476, 0.5, 0.524], baseline: [0.476, 0.5, 0.524] } });
  const p = powerPlan(r);
  assert.ok(caseOf(p).drawsNeeded > SAMPLING.max);
  assert.match(planner().formatPlan(p), /adaptive|ceiling|current run policy/i);
});

test('AC-9 irreducible spread, equality, zero measured spread and lifts below the verdict floor', () => {
  const wide = shaped({ c1: { with_skill: [0.4, 0.5, 0.6], baseline: [0.4, 0.5, 0.6] } });
  const input = caseInput(wide), w = oracle.measured(input.withScores), b = oracle.measured(input.baseScores);
  for (const lift of [EFFECT_FLOOR, w.sd + b.sd]) {
    const c = caseOf(powerPlan(wide, { draws: 1000, lift }));
    assert.equal(c.drawsNeeded, null);
    assert.equal(c.state, 'underpowered');
  }
  const zero = shaped({ c1: { with_skill: [0.5, 0.5, 0.5], baseline: [0.5, 0.5, 0.5] } });
  oracle.readCase(caseOf(powerPlan(zero)), caseInput(zero));
  const tiny = caseOf(powerPlan(zero, { lift: EFFECT_FLOOR / 2 }));
  assert.equal(tiny.state, 'unsupported');
  assert.equal(tiny.drawsNeeded, null);
  assert.ok(tiny.limitingLift >= EFFECT_FLOOR);
});

test('AC-10/AC-11 the observed between-case guard prints the cases sentence and gives no invented case or draw target', () => {
  const r = shaped({ c1: { with_skill: [0.2, 0.2, 0.2], baseline: [0.2, 0.2, 0.2] }, c2: { with_skill: [0.8, 0.8, 0.8], baseline: [0.8, 0.8, 0.8] } });
  const p = powerPlan(r);
  const band = suiteBand(r, [{ id: 'c1' }, { id: 'c2' }]);
  oracle.readSuite(p.suite, { state: 'underpowered', band: band.value, between: band.between, driver: bandDriver(band) });
  assert.equal(p.suite.reason, 'suite_band', 'library carries the suite limitation');
  assert.equal(p.state, 'underpowered');
  assert.equal(p.drawsNeeded, null);
  const text = planner().formatPlan(p);
  oracle.readPowerWords(text, true);
  assert.doesNotMatch(text, /\b\d+ (?:additional|more) cases\b/i);
  const reader = (s) => oracle.readSuite(s, { state: 'underpowered', band: band.value, between: band.between, driver: 'cases' });
  oracle.killed(p.suite, reader, [
    ['ignore suite rung', (s) => { s.state = 'resolved'; }],
    ['invent count', (s) => { s.drawsNeeded = 20; }],
    ['draws instead of cases', (s) => { s.driver = 'draws'; }],
    ['omit suite case dispersion', (s) => { s.band = 0; }],
  ]);
});

test('A-188-6 AC-10/AC-11 case limitations precede a cases-driven suite band', () => {
  for (const scores of [[0.1, 0.2, 0.3], [0.184, 0.2, 0.216]]) {
    const r = shaped({
      c1: { with_skill: scores, baseline: scores },
      c2: { with_skill: [0.8, 0.8, 0.8], baseline: [0.8, 0.8, 0.8] },
    });
    const band = suiteBand(r, [{ id: 'c1' }, { id: 'c2' }]);
    assert.ok(band.value >= EFFECT_FLOOR, 'plant reaches the suite band');
    assert.equal(bandDriver(band), 'cases');
    const p = powerPlan(r);
    const c = caseOf(p);
    oracle.readCase(c, caseInput(r));
    assert.equal(c.state, 'underpowered', 'plant reaches the case limitation');
    assert.equal(caseOf(p, 'c2').state, 'resolved');
    assert.equal(p.state, 'underpowered');
    assert.equal(p.suite.band, band.value, 'observed figures remain visible');
    assert.equal(p.suite.driver, 'cases');
    assert.equal(p.suite.reason, null, 'case limitation blocks the suite rung');
    assert.equal(p.suite.state, 'resolved', 'suite rung does not override the case');
    assert.equal(p.drawsNeeded, c.drawsNeeded, 'finite case targets remain available');
    const file = receiptFile(r);
    for (const lift of [EFFECT_FLOOR, 0.06]) {
      const atLift = powerPlan(r, { lift });
      // At the higher lift the narrower case resolves for planning, but its
      // unchanged verdict-floor limitation still precedes the suite sentence.
      if (c.drawsNeeded !== null && lift > EFFECT_FLOOR) {
        assert.equal(caseOf(atLift).state, 'resolved');
        assert.equal(atLift.suite.reason, 'suite_band');
      }
      for (const output of [planner().formatPlan(atLift), successful(guardedPlan([
        skillDir, '--model', MODEL, '--judge-model', JUDGE, '--draws', '3',
        '--lift', String(lift), '--from', file,
      ], { stub: true }))]) {
        oracle.readPowerWords(output);
        assert.ok(output.includes(oracle.DRAW_WORDS));
        assert.ok(!output.includes(oracle.CASE_WORDS), 'suite sentence cannot replace the case limitation');
        if (caseOf(atLift).drawsNeeded !== null) {
          assert.ok(output.includes('Hypothetical strict minimum generation draws per arm: ' + caseOf(atLift).drawsNeeded + '.'));
        }
      }
    }
  }
});

test('AC-10 suite draw driver is not labelled as between-case disagreement', () => {
  const r = shaped({ c1: { with_skill: [0.38, 0.4, 0.42], baseline: [0.38, 0.4, 0.42] }, c2: { with_skill: [0.431, 0.451, 0.471], baseline: [0.431, 0.451, 0.471] } });
  // Requested planning lift clears per-case resolution at large n. The observed
  // suite band is still at the threshold; its R-6/R-143 reading remains visible.
  const band = suiteBand(r, [{ id: 'c1' }, { id: 'c2' }]);
  assert.equal(bandDriver(band), 'draws');
  const p = powerPlan(r, { draws: 10000, lift: EFFECT_FLOOR });
  assert.equal(p.suite.driver, 'draws');
  assert.equal(p.suite.band, band.value);
  assert.equal(p.suite.between, band.between);
  assert.equal(p.suite.state, 'underpowered');
  assert.equal(p.suite.reason, 'suite_band', 'draws driver carries the suite limitation');
  assert.equal(p.drawsNeeded, null);
  oracle.readPowerWords(planner().formatPlan(p));
});

test('AC-11 applicable exact words appear in both the formatter and real CLI output', () => {
  for (const [r, casesDriver] of [
    [shaped({ c1: { with_skill: [0.4, 0.5, 0.6], baseline: [0.4, 0.5, 0.6] } }), false],
    [shaped({ c1: { with_skill: [0.2, 0.2, 0.2], baseline: [0.2, 0.2, 0.2] }, c2: { with_skill: [0.8, 0.8, 0.8], baseline: [0.8, 0.8, 0.8] } }), true],
  ]) {
    const p = powerPlan(r), file = receiptFile(r);
    oracle.readPowerWords(planner().formatPlan(p), casesDriver);
    oracle.readPowerWords(successful(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE, '--draws', '3', '--from', file], { stub: true })), casesDriver);
  }
});

test('AC-11 exact sentence and forbidden-prose plants fail the independent wording reader', () => {
  for (const [line, driver] of [[oracle.DRAW_WORDS, false], [oracle.CASE_WORDS, true]]) {
    oracle.readPowerWords(line + '. ' + QUALIFICATIONS, driver);
    assert.throws(() => oracle.readPowerWords(line, driver));
    assert.throws(() => oracle.readPowerWords(line + '. ' + QUALIFICATIONS + ' This proves the skill improves scores.', driver));
    assert.throws(() => oracle.readPowerWords('With the spreads held.', driver));
    // The shipped gate reads this verdict value from the same declared source.
    for (const bad of ['\u2014', 'with confidence', 'statistically significant', require('../lib/stats').WITHIN_NOISE]) {
      assert.throws(() => oracle.readPowerWords(line + '. ' + QUALIFICATIONS + ' ' + bad, driver), /public wording|spec 031 band lexicon/);
    }
  }
});

test('AC-11 nondefault lift states the planning threshold and the unchanged verdict floor', () => {
  const r = shaped({ c1: { with_skill: [0.4, 0.5, 0.6], baseline: [0.4, 0.5, 0.6] } });
  const text = planner().formatPlan(powerPlan(r, { lift: 0.1 }));
  assert.match(text, /0\.1/);
  assert.ok(text.includes(String(EFFECT_FLOOR)));
  assert.match(text, /verdict[^\n]*floor|floor[^\n]*verdict/i);
  oracle.readPowerWords(text);
});

test('AC-12 without receipts every case and the full suite stay unknown with costs and a cheap workflow', () => {
  const p = planner().planSkill(defaultInput());
  assert.equal(p.evidenceKind, 'none');
  assert.equal(p.state, 'unknown');
  assert.equal(p.resolution, null);
  assert.equal(p.drawsNeeded, null);
  assert.deepEqual(p.cases.map((c) => c.id), skill.suite.cases.map((c) => c.id));
  for (const c of p.cases) oracle.readUnknown(c);
  oracle.readCost(p, { caseCount: 2, samples: 2, draws: SAMPLING.max, model: MODEL, judgeModel: JUDGE });
  oracle.readFallback(planner().formatPlan(p), ['c1', 'c2']);
});

test('AC-12 partial smoke evidence informs covered cases but never omits an uncovered case or grows TESTED', () => {
  const r = shaped({}, { omitted: ['c2'] });
  r.run.preset = 'quick';
  const smoke = valid(sealReceipt(r)), before = JSON.stringify(smoke);
  const p = powerPlan(smoke);
  oracle.readCase(caseOf(p, 'c1'), caseInput(smoke));
  oracle.readUnknown(caseOf(p, 'c2'));
  assert.equal(p.state, 'unknown');
  assert.equal(p.caseCount, skill.suite.caseCount);
  assert.equal(p.drawsNeeded, null);
  assert.equal(JSON.stringify(smoke), before);
  assert.equal(receiptVerdict(smoke).verdict, 'NOT_MEASURED');
  oracle.readFallback(planner().formatPlan(p), ['c2']);
});

test('AC-12 one draw, lost draws and absent generation records never become zero spread', () => {
  const one = shaped({ c1: { with_skill: [0.5], baseline: [0.5] } });
  oracle.readUnknown(caseOf(powerPlan(one)));
  const lost = shaped({}, { lost: [{ id: 'c1', mode: 'baseline' }] });
  oracle.readUnknown(caseOf(powerPlan(lost)));
  const absent = structuredClone(shaped());
  for (const c of absent.results.cases) delete c.generation;
  delete absent.generation_sampled;
  const legacy = valid(sealReceipt(absent));
  for (const c of powerPlan(legacy).cases) oracle.readUnknown(c);
});

test('AC-12 the synthetic lane is explicit and cannot be presented as measured model power', () => {
  const p = powerPlan(shaped());
  assert.equal(p.evidenceKind, 'synthetic');
  assert.match(planner().formatPlan(p), /synthetic|stub/i);
  assert.equal(original.verification_level, 'UNVERIFIED');
  const c = { state: 'unknown', reason: 'no generation spread', resolution: null, limitingLift: null, drawsNeeded: null };
  oracle.killed(c, oracle.readUnknown, [
    ['assumed spread', (c) => { c.resolution = 0.1; }],
    ['zero filled missing', (c) => { c.limitingLift = 0; }],
    ['invent recommendation', (c) => { c.drawsNeeded = 5; }],
    ['claim resolved', (c) => { c.state = 'resolved'; }],
  ]);
});

test('AC-12 a resealed stub promoted to model evidence is refused at both doors', () => {
  const r = shaped();
  r.run.answered_by.kind = 'model';
  const bad = valid(sealReceipt(r));
  assert.equal(bad.run.surface, 'stub', 'only the claimed evidence kind changed');
  assert.throws(() => powerPlan(bad), /provenance|surface/);
  refused(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE,
    '--from', receiptFile(bad)]), /provenance|surface/);
});

test('AC-13 separate receipts cover separate cases, and both --from forms retain all inputs', () => {
  const a = shaped({}, { omitted: ['c2'] }), b = shaped({}, { omitted: ['c1'] });
  const p = planner().planSkill(defaultInput({ receipts: [a, b], draws: 3 }));
  oracle.readCase(caseOf(p, 'c1'), caseInput(a));
  oracle.readCase(caseOf(p, 'c2'), caseInput(b, 3, EFFECT_FLOOR, 'c2'));
  assert.ok(p.cases.every((c) => c.state !== 'unknown'));
  const af = receiptFile(a, 'partial-a.json'), bf = receiptFile(b, 'partial-b.json');
  const out = successful(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE, '--draws=3', '--from', af, '--from=' + bf], { stub: true }));
  assert.ok(out.includes(a.receipt_hash) && out.includes(b.receipt_hash), 'CLI names each sealed source');
});

test('AC-13 duplicates, argument order and regrades do not manufacture independent draws', () => {
  const a = shaped(), b = structuredClone(a);
  b.run.judged_at = '2026-10-10T22:34:00.000Z';
  b.run.date_utc = b.run.judged_at;
  b.run.grader_revision = { prompt_template_hash: b.run.judge.prompt_template_hash, rubric_hashes: [...new Set(b.results.cases.map((c) => c.judge.rubric_hash))] };
  const regrade = valid(sealReceipt(b));
  const plan = (receipts) => planner().planSkill(defaultInput({ receipts, draws: 3 }));
  assert.deepEqual(plan([a, a]).cases, plan([a]).cases);
  assert.deepEqual(plan([a, regrade]).cases, plan([regrade, a]).cases);
  for (const c of plan([a, regrade]).cases) {
    assert.equal(c.evidenceHash, regrade.receipt_hash);
    assert.equal(c.arms.with_skill.n, 3);
    assert.equal(c.arms.baseline.n, 3);
  }
});

test('AC-13 a newer lost pair cannot be replaced with older clean evidence', () => {
  const a = shaped(), b = shaped({}, { lost: [{ id: 'c1', mode: 'baseline' }], at: '2026-10-10T22:35:00.000Z' });
  for (const receipts of [[a, b], [b, a]]) {
    const p = planner().planSkill(defaultInput({ receipts }));
    oracle.readUnknown(caseOf(p));
    assert.equal(caseOf(p).evidenceHash, b.receipt_hash);
    assert.equal(p.state, 'unknown');
  }
});

test('AC-13 two receipts with different single arms cannot be stitched into an eligible pair', () => {
  const a = structuredClone(shaped()), b = structuredClone(shaped());
  a.results.cases = a.results.cases.filter((c) => c.mode !== 'baseline');
  b.results.cases = b.results.cases.filter((c) => c.mode !== 'with_skill');
  const p = planner().planSkill(defaultInput({ receipts: [sealReceipt(a), sealReceipt(b)] }));
  for (const c of p.cases) oracle.readUnknown(c);
});

test('AC-14 built-in defaults, registered aliases and full-suite cost match run without reading rc', () => {
  const p = planner().planSkill({ skill });
  oracle.readCost(p, { caseCount: 2, samples: DEFAULT_JUDGE_SAMPLES, draws: SAMPLING.max, model: MODEL, judgeModel: MODEL });
  const alias = planner().planSkill({ skill, model: 'sonnet', judgeModel: 'haiku' });
  assert.equal(alias.model, JUDGE); assert.equal(alias.judgeModel, MODEL);
  const rc = path.join(scratch, '.driftproofrc');
  fs.writeFileSync(rc, JSON.stringify({ max_cases: 1, samples: 1, judge_model: JUDGE }));
  try {
    const out = successful(guardedPlan([skillDir]));
    assert.match(out, /\.driftproofrc[^\n]*(?:not read|ignored)|(?:not read|ignored)[^\n]*\.driftproofrc/i);
    assert.match(out, new RegExp(String(projectCalls(2, DEFAULT_JUDGE_SAMPLES, SAMPLING.max))));
  } finally { fs.unlinkSync(rc); }
});

for (const [flag, values] of [
  ['samples', ['0', '-1', '2.5', 'abc', '01', '2junk', '9007199254740992', '']],
  ['draws', ['0', '-1', '2.5', 'abc', '01', '2junk', '9007199254740992', '']],
  ['lift', ['0', '-0.1', '1.1', 'NaN', 'Infinity', '0.1junk', '']],
]) test('AC-14 --' + flag + ' rejects every malformed value rather than defaulting or truncating it', () => {
  for (const value of values) refused(guardedPlan([skillDir, '--' + flag + '=' + value]), new RegExp(flag));
  refused(guardedPlan([skillDir, '--' + flag]), new RegExp(flag));
});

test('AC-14 direct library calls cannot bypass numeric and model refusals', () => {
  for (const flag of ['samples', 'draws']) for (const value of [0, -1, 1.5, NaN, Infinity, true, '2junk', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => planner().planSkill(defaultInput({ [flag]: value })), /sample|draw|integer|number|value|finite/i);
  }
  for (const lift of [0, -0.1, 1.1, NaN, Infinity, true, '0.1junk']) assert.throws(() => planner().planSkill(defaultInput({ lift })), /lift|number|value|finite/i);
  for (const options of [{ model: 'missing-model-id' }, { judgeModel: 'missing-judge-id' }]) assert.throws(() => planner().planSkill(defaultInput(options)), /model|registry/i);
});

test('AC-14 CLI rejects unknown flags, extra positionals and unregistered target or judge', () => {
  for (const args of [
    [skillDir, '--modle', MODEL], [skillDir, 'extra'], [skillDir, '--max-cases', '1'],
    [skillDir, '--model', 'missing-model-id'], [skillDir, '--judge-model', 'missing-judge-id'],
  ]) refused(guardedPlan(args));
});

test('AC-14 every accepted suite shape uses loadSkill and duplicate, empty and linked suites are refused', () => {
  const canonical = skill.suite.cases;
  for (const raw of [canonical, { cases: canonical }, { evals: canonical }]) {
    const dir = fs.mkdtempSync(path.join(scratch, 'shape-'));
    fs.mkdirSync(path.join(dir, 'evals'));
    fs.writeFileSync(path.join(dir, 'SKILL.md'), fs.readFileSync(path.join(skillDir, 'SKILL.md')));
    fs.writeFileSync(path.join(dir, 'evals/evals.json'), JSON.stringify(raw));
    successful(guardedPlan([dir]));
    assert.equal(planner().planSkill({ skill: loadSkill(dir) }).caseCount, 2);
  }
  for (const raw of [[], { cases: [canonical[0], canonical[0]] }]) {
    const dir = fs.mkdtempSync(path.join(scratch, 'bad-suite-'));
    fs.mkdirSync(path.join(dir, 'evals'));
    fs.writeFileSync(path.join(dir, 'SKILL.md'), fs.readFileSync(path.join(skillDir, 'SKILL.md')));
    fs.writeFileSync(path.join(dir, 'evals/evals.json'), JSON.stringify(raw));
    refused(guardedPlan([dir]));
  }
  const linked = fs.mkdtempSync(path.join(scratch, 'linked-'));
  fs.symlinkSync(path.join(skillDir, 'SKILL.md'), path.join(linked, 'SKILL.md'));
  refused(guardedPlan([linked]), /link/i);
});

test('AC-15 help and the README plan section carry the reviewed claim and full offline workflow', () => {
  const help = successful(child(['--help']));
  const at = help.indexOf('plan <skill-dir>');
  assert.ok(at >= 0, 'help advertises plan');
  const notes = /  - Planning:([\s\S]*?)(?=\n  - |$)/.exec(help);
  assert.ok(notes, 'help has scoped planning notes');
  oracle.readDocs(notes[1]);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const start = /^##[^\n]*\b[Pp]lan[^\n]*$/m.exec(readme);
  assert.ok(start, 'README has a plan section');
  const after = readme.slice(start.index + start[0].length);
  const end = after.search(/^## /m);
  const section = after.slice(0, end < 0 ? after.length : end);
  oracle.readDocs(section);
});

test('AC-15 documentation readers kill missing workflow and count-conflation plants', () => {
  const text = 'plan --from --draws --samples --lift --model --judge-model\n' +
    'Judge samples per answer. Generation draws per case per arm. Spreads held.\n' +
    'Rough token-assumption cost estimate. Actual charges can exceed it.\n' + QUALIFICATIONS + '\n' +
    'Power cannot be judged until spread is measured.\n' +
    'driftproof run ./skill --quick --models haiku\n' +
    'driftproof plan ./skill --from receipt.json';
  oracle.readDocs(text);
  for (const removed of ['--from', 'Judge samples per answer', 'Generation draws per case per arm', 'Spreads held', 'Actual charges can exceed', 'hypothetical', 'runner may stop before', 'cannot certify currentness offline', 'Power cannot be judged until spread is measured', 'driftproof run ./skill --quick --models haiku']) {
    assert.throws(() => oracle.readDocs(text.split(removed).join('')), { name: 'AssertionError' }, removed);
  }
});

// A-188-1: each review finding has a direct regression and planted violation.
function guardedLibrary(expression, options = {}) {
  const file = receiptFile(shaped(), 'library-evidence.json');
  return spawnSync(process.execPath, ['--require', guard, '-e', expression], {
    cwd: scratch, env: { ...env(), ...options, SPEC188_PROVIDER: path.join(ROOT, 'lib/provider.js'),
      PLAN_MODULE: path.join(ROOT, 'lib/plan.js'), SKILL_DIR: skillDir, RECEIPT_FILE: file,
      PLAN_MODEL: MODEL, PLAN_JUDGE: JUDGE }, encoding: 'utf8', timeout: 1800000,
  });
}
const LIBRARY_PLAN = String.raw`
const p = require(process.env.PLAN_MODULE);
const skill = p.loadPlanSkill(process.env.SKILL_DIR);
const receipts = [JSON.parse(require('node:fs').readFileSync(process.env.RECEIPT_FILE, 'utf8'))];
const plan = p.planSkill({skill, receipts, model: process.env.PLAN_MODEL, judgeModel: process.env.PLAN_JUDGE});
process.stdout.write(p.formatPlan(plan));
`;

test('AC-16 ordinary rounded sds require six, never five at the equality boundary', () => {
  const r = shaped({ c1: { with_skill: [.49,.5,.51], baseline: [.48,.5,.52] } });
  const c = caseOf(powerPlan(r, { draws: 5 }));
  oracle.readCase(c, caseInput(r, 5));
  assert.equal(c.drawsNeeded, 6);
  assert.equal(c.state, 'underpowered');
  assert.equal(caseOf(powerPlan(r, { draws: 6 })).state, 'resolved');
  oracle.killed(c, (c) => oracle.readCase(c, caseInput(r, 5)), [['algebraic five', (c) => { c.drawsNeeded = 5; }]]);
});

test('AC-17 seven hypothetical draws may stop at three under the unchanged adaptive policy', () => {
  const r = shaped({ c1: { with_skill: [.484,.5,.516], baseline: [.484,.5,.516] } });
  const row = r.results.cases.find((c) => c.id === 'c1');
  assert.equal(require('../lib/sampling').nextAction(row.generation.draws).stop, true);
  const p = powerPlan(r);
  assert.equal(caseOf(p).drawsNeeded, 7);
  oracle.readQualifications(planner().formatPlan(p));
  assert.ok(7 <= SAMPLING.max);
});

test('AC-18 zero spread below-floor request never claims insufficient draws at the verdict floor', () => {
  const r = shaped({ c1: { with_skill: [.5,.5,.5], baseline: [.5,.5,.5] } });
  const p = powerPlan(r, { lift: .01 });
  assert.equal(caseOf(p).state, 'unsupported');
  assert.equal(caseOf(p).resolution, 0);
  assert.equal(caseOf(p).drawsNeeded, null);
  const text = planner().formatPlan(p);
  assert.match(text, /unsupported|below.*verdict.*floor/i);
  assert.ok(!text.includes(oracle.DRAW_WORDS));
  oracle.readQualifications(text);
  const file = receiptFile(r);
  const cli = successful(guardedPlan([skillDir, '--model', MODEL, '--judge-model', JUDGE, '--lift', '.01', '--from', file], {stub:true}));
  assert.ok(!cli.includes(oracle.DRAW_WORDS));
});

test('AC-19 nonregular receipt is refused before opening a potentially blocking stream', () => {
  refused(guardedPlan([skillDir, '--from', '/dev/stdin']), /regular|link|file/i);
  assert.throws(() => planner().readPlanReceipts(['/dev/stdin']), /regular|link|file/i);
});

test('AC-19 file bytes and JSON depth are bounded before parsing or hashing', () => {
  const limits = planner().PLAN_LIMITS;
  assert.equal(limits.fileBytes, 16 * 1024 * 1024);
  assert.equal(limits.depth, 64);
  const huge = path.join(scratch, 'huge.json');
  fs.writeFileSync(huge, ' '.repeat(limits.fileBytes + 1));
  refused(guardedPlan([skillDir, '--from', huge]), /bound|bytes|size|limit/i);
  assert.throws(() => planner().readPlanReceipts([huge]), /bound|bytes|size|limit/i);
  const deep = path.join(scratch, 'deep.json');
  fs.writeFileSync(deep, '['.repeat(65) + '0' + ']'.repeat(65));
  refused(guardedPlan([skillDir, '--from', deep]), /depth|nest|bound|limit/i);
  assert.throws(() => planner().readPlanReceipts([deep]), /depth|nest|bound|limit/i);
  const dir = fs.mkdtempSync(path.join(scratch, 'bounded-skill-'));
  fs.mkdirSync(path.join(dir, 'evals'));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'x'.repeat(require('../config').SKILL_MAX_BYTES + 1));
  fs.writeFileSync(path.join(dir, 'evals/evals.json'), JSON.stringify(skill.suite.cases));
  refused(guardedPlan([dir]), /bound|bytes|size|limit/i);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skill.skillMd);
  for (const text of [' '.repeat(limits.fileBytes + 1), '['.repeat(65)+'0'+']'.repeat(65)]) {
    fs.writeFileSync(path.join(dir, 'evals/evals.json'), text);
    refused(guardedPlan([dir]), /bound|bytes|size|depth|nest|limit/i);
    assert.throws(() => planner().loadPlanSkill(dir), /bound|bytes|size|depth|nest|limit/i);
  }
});

test('AC-19 parsed library inputs have equivalent pre-hash bounds', () => {
  const limits = planner().PLAN_LIMITS;
  const a = shaped();
  assert.equal(limits.receipts, 32);
  assert.throws(() => planner().planSkill(defaultInput({receipts:Array(33).fill(a)})), /receipt.*(?:limit|bound|count)|limit/i);
  let deep = {}; for (let i=0;i<65;i++) deep = { child:deep };
  for (const extra of [deep, {text:'x'.repeat(limits.fileBytes + 1)}, {nodes:Array.from({length:limits.nodes+1},()=>({}))}]) {
    const r = {...a, extra};
    assert.throws(() => planner().planSkill(defaultInput({receipts:[r]})), /bound|depth|bytes|nodes|limit/i);
  }
  const hugeRecord = structuredClone(a);
  hugeRecord.results.cases[0].generation.draws = Array(limits.records+1).fill(a.results.cases[0].generation.draws[0]);
  assert.throws(() => powerPlan(hugeRecord), /record|bound|limit/i);
  const manyBytes = Array.from({length:8},()=>({...a,extra:'x'.repeat(9*1024*1024)}));
  assert.throws(() => planner().planSkill(defaultInput({receipts:manyBytes})), /aggregate|bytes|bound|limit/i);
  const cyclic = {...a}; cyclic.extra = cyclic;
  assert.throws(() => powerPlan(cyclic), /cycle|JSON|plain|bound/i);
  const accessor = {...a}; Object.defineProperty(accessor,'extra',{enumerable:true,get(){throw Error('accessor evaluated');}});
  assert.throws(() => powerPlan(accessor), /accessor|plain|JSON/i);
  assert.throws(() => planner().planSkill(defaultInput({skill:{...skill,extra:deep}})), /depth|bound|limit/i);
});

test('AC-19 CLI receipt-count and aggregate bounds precede evidence checks', () => {
  const f = receiptFile(shaped());
  refused(guardedPlan([skillDir,...Array.from({length:33},()=>['--from',f]).flat()]), /count|limit|bound/i);
  const files = Array.from({length:5},(_,i)=>{const f=path.join(scratch,'large-'+i+'.json');fs.writeFileSync(f,' '.repeat(14*1024*1024));return f;});
  refused(guardedPlan([skillDir,...files.flatMap(f=>['--from',f])]), /aggregate|bytes|bound|limit/i);
});

test('AC-20 unsafe derived calls and unrepresentable recommendations never print an exact minimum', () => {
  for (const opts of [{samples:Number.MAX_SAFE_INTEGER,draws:1},{samples:2,draws:Number.MAX_SAFE_INTEGER}]) {
    assert.throws(() => planner().planSkill(defaultInput(opts)), /safe|represent|call|bound/i);
    refused(guardedPlan([skillDir,'--samples',String(opts.samples),'--draws',String(opts.draws)]), /safe|represent|call|bound/i);
  }
  const r = shaped({c1:{with_skill:[.475,.5,.525],baseline:[.475,.5,.525]}});
  const p = powerPlan(r,{lift:.05000000000000001});
  assert.equal(caseOf(p).drawsNeeded,null);
  assert.equal(caseOf(p).reason,'unrepresentable');
  assert.match(planner().formatPlan(p), /unrepresentable|cannot represent/i);
  assert.doesNotMatch(planner().formatPlan(p), /1\.038\d*e\+?32/);
});

test('AC-21 timestamps compare valid instants with deterministic null and hash ties', () => {
  const old=shaped({}, {at:'2026-10-11T00:00:00+02:00'});
  const newer=shaped({}, {at:'2026-10-10T23:00:00Z'});
  for(const receipts of [[old,newer],[newer,old]]) assert.equal(caseOf(planner().planSkill(defaultInput({receipts}))).evidenceHash,newer.receipt_hash);
  const a=shaped(); const b=structuredClone(a); delete b.run.generated_at; const tied=valid(sealReceipt(b));
  for (const key of ['generated_at', 'judged_at']) { const n=structuredClone(a); n.run[key]=null; assert.throws(()=>powerPlan(sealReceipt(n)), /schema|invalid|time/i, 'null timestamps are refused by the receipt schema'); }
  const greatest=[a.receipt_hash,tied.receipt_hash].sort().at(-1);
  for(const receipts of [[a,tied],[tied,a]]) assert.equal(caseOf(planner().planSkill(defaultInput({receipts}))).evidenceHash,greatest);
  const files=[receiptFile(old,'time-old.json'),receiptFile(newer,'time-new.json')];
  for(const zone of ['UTC','Pacific/Honolulu']) for(const order of [files,[...files].reverse()]) {
    const code=String.raw`const p=require(process.env.PLAN_MODULE);const skill=p.loadPlanSkill(process.env.SKILL_DIR);const receipts=p.readPlanReceipts(JSON.parse(process.env.PLAN_FILES));process.stdout.write(p.planSkill({skill,receipts,model:process.env.PLAN_MODEL,judgeModel:process.env.PLAN_JUDGE}).cases[0].evidenceHash);`;
    assert.equal(successful(guardedLibrary(code,{TZ:zone,PLAN_FILES:JSON.stringify(order)})),newer.receipt_hash);
  }
  for(const timestamp of ['2026-02-30T00:00:00Z','2026-10-10T22:33:00','2026-13-10T22:33:00Z','2026-10-10T25:00:00Z']) for(const key of ['generated_at','judged_at','date_utc']) {
    const r=structuredClone(a); r.run[key]=timestamp; const bad=sealReceipt(r);
    assert.throws(()=>powerPlan(bad),/time|date|zone|invalid/i);
    refused(guardedPlan([skillDir,'--model',MODEL,'--judge-model',JUDGE,'--from',receiptFile(bad)]), /time|date|zone|invalid/i);
  }
});

for(const kind of ['duplicate','gap','out-of-order']) test('AC-22 resealed '+kind+' draw indices cannot manufacture measured evidence',()=>{
  const r=shaped(),c=r.results.cases[0];
  if(kind==='duplicate') c.generation.draws.push(structuredClone(c.generation.draws[0]));
  else if(kind==='gap') c.generation.draws[1].draw_index=9;
  else c.generation.draws.reverse();
  const a=acrossDraws(c.generation.draws); Object.assign(c.generation,a); c.mean=a.mean; c.score=a.mean;c.stddev=a.sd;
  updateCounts(r);const bad=sealReceipt(r);
  assert.throws(()=>powerPlan(bad),/index|indices|duplicate|draw|complete/i);
  refused(guardedPlan([skillDir,'--model',MODEL,'--judge-model',JUDGE,'--from',receiptFile(bad)]));
});

test('AC-23 both guarded entry points record zero attempts, including library calls',()=>{
  successful(guardedLibrary(LIBRARY_PLAN));
  for(const args of [[skillDir], [skillDir,'--model',MODEL,'--judge-model',JUDGE,'--from',receiptFile(shaped())], [skillDir,'--samples','no']]) {
    const r=guardedPlan(args,{stub:true});assert.doesNotMatch(r.stderr,/FORBIDDEN/);assert.ok([0,2].includes(r.status));
  }
});

test('AC-23 caught calls, outside writes, restore and write-delete plants still fail the attempt guard',()=>{
  for(const expr of [
    "require(process.env.SPEC188_PROVIDER).complete({})",
    "require('node:https').get('https://example.invalid')",
    "require('node:child_process').spawnSync('harness',['--version'])",
    "require('node:fs').writeFileSync('/var/tmp/spec188-outside-plant','x')",
    "const f=require('node:fs');f.writeFileSync('/var/tmp/spec188-write-delete','x');f.unlinkSync('/var/tmp/spec188-write-delete')",
    "const f=require('node:fs');const was=f.readFileSync(process.env.RECEIPT_FILE);f.writeFileSync(process.env.RECEIPT_FILE,'x');f.writeFileSync(process.env.RECEIPT_FILE,was)",
    "require('node:fs').openSync('/var/tmp/spec188-write-open','w')",
    "require('node:fs').writeSync(999,Buffer.from('x'))",
  ]) {
    const r=guardedLibrary('try {'+expr+'} catch (_) {}');assert.equal(r.status,91,r.stderr);assert.match(r.stderr,/FORBIDDEN_ATTEMPTS/);
  }
  const promise=guardedLibrary("require('node:fs').promises.writeFile('/var/tmp/spec188-promise','x').catch(()=>{})");
  assert.equal(promise.status,91,promise.stderr);
});

test('AC-24 every rendered power state keeps all qualifications and rejects stronger claims',()=>{
  const states=[planner().planSkill(defaultInput()), powerPlan(shaped()), powerPlan(shaped(),{draws:10}), powerPlan(shaped(),{lift:.01})];
  for(const p of states) {
    const text=planner().formatPlan(p);oracle.readQualifications(text);
    for(const part of ['Spreads held','no verdict','hypothetical','runner may stop before','must still hold','cannot certify currentness offline']) {
      assert.throws(()=>oracle.readQualifications(text.replace(new RegExp(part,'ig'),'')),{name:'AssertionError'},part);
    }
    for(const claim of ['This proves the skill improves scores.','Guaranteed power.','The run will pass.','The run would produce a PASSED verdict.']) assert.throws(()=>oracle.readQualifications(text+' '+claim),{name:'AssertionError'});
  }
});

test('AC-25 long accepted prompts do not turn fixed-token USD estimates into upper bounds',()=>{
  const cases=skill.suite.cases.map(c=>({...c,prompt:'x'.repeat(require('../config').CASE_MAX_CHARS)}));
  const ident=suiteIdentity({cases});
  const long={...skill,suite:{...skill.suite,cases:ident.cases,suiteHash:ident.suiteHash}};
  const a=planner().planSkill(defaultInput()),b=planner().planSkill(defaultInput({skill:long}));
  assert.deepEqual(a.cost,b.cost);
  const text=planner().formatPlan(b);
  assert.match(text,/token.assumption/i);assert.match(text,/actual charges can exceed/i);
  assert.match(text,/3000/);assert.match(text,/1300/);
  assert.doesNotMatch(text,/USD[^\n]*upper.bound|upper.bound[^\n]*USD/i);
  assert.throws(()=>oracle.readQualifications(text+' USD is an upper-bound estimate.'),{name:'AssertionError'});
});

test('AC-19 JSON node and aggregate record limits hold before JSON.parse discards raw fields', () => {
  const nodes=path.join(scratch,'raw-nodes.json');
  fs.writeFileSync(nodes,'['+Array(200001).fill('0').join(',')+']');
  assert.throws(()=>planner().readPlanReceipts([nodes]),/node|bound|limit/i);
  const files=Array.from({length:3},(_,i)=>{
    const f=path.join(scratch,'raw-records-'+i+'.json');
    fs.writeFileSync(f,'{"results":{"cases":[{"generation":{"draws":['+Array(40000).fill('{"samples":[]}').join(',')+']}}]}}');
    return f;
  });
  assert.throws(()=>planner().readPlanReceipts(files),/record|bound|limit/i);
  const dir=fs.mkdtempSync(path.join(scratch,'raw-suite-'));
  fs.mkdirSync(path.join(dir,'evals'));
  fs.writeFileSync(path.join(dir,'SKILL.md'),skill.skillMd);
  fs.writeFileSync(path.join(dir,'evals/evals.json'),'{"cases":'+JSON.stringify(skill.suite.cases)+',"extra":['+Array(200001).fill('0').join(',')+']}');
  assert.throws(()=>planner().loadPlanSkill(dir),/node|bound|limit/i);
});

test('AC-23 all rendered and refusal states use the library guard too',()=>{
  for(const change of [
    'receipts.length=0;',
    'receipts[0].receipt_hash="bad";',
    'input.lift=.01;',
    'input.draws=1;',
    'input.samples=Number.MAX_SAFE_INTEGER;',
  ]) {
    const code='const p=require(process.env.PLAN_MODULE);const skill=p.loadPlanSkill(process.env.SKILL_DIR);const receipts=p.readPlanReceipts([process.env.RECEIPT_FILE]);const input={skill,receipts,model:process.env.PLAN_MODEL,judgeModel:process.env.PLAN_JUDGE};'+change+'try{process.stdout.write(p.formatPlan(p.planSkill(input)))}catch(e){process.stderr.write(e.message)}';
    const out=guardedLibrary(code); assert.equal(out.status,0,out.stderr);assert.doesNotMatch(out.stderr,/FORBIDDEN/);
  }
});

test('AC-14 rc defaults are ignored, while bundled bytes still enter the skill hash',()=>{
  const dir=fs.mkdtempSync(path.join(scratch,'rc-skill-'));
  fs.mkdirSync(path.join(dir,'evals'));
  fs.writeFileSync(path.join(dir,'SKILL.md'),skill.skillMd);
  fs.writeFileSync(path.join(dir,'evals/evals.json'),JSON.stringify(skill.suite.cases));
  const before=loadSkill(dir).contentHash;
  fs.writeFileSync(path.join(dir,'.driftproofrc'),'{malformed rc defaults');
  assert.notEqual(loadSkill(dir).contentHash,before,'bundled rc bytes retain loader identity');
  const out=successful(guardedPlan([dir]));
  assert.match(out,/\.driftproofrc defaults are ignored/);
  assert.doesNotMatch(out,/\.driftproofrc is not read/);
});

test('AC-13 unknown selected evidence still names the measured draws that happened',()=>{
  const r=shaped({}, {lost:[{id:'c1',mode:'baseline'}]});
  const c=caseOf(powerPlan(r));oracle.readUnknown(c);
  for(const mode of ['with_skill','baseline']) {
    const row=r.results.cases.find(x=>x.id==='c1'&&x.mode===mode);
    assert.equal(c.arms[mode].n,row.generation.draws.filter(d=>d.status==='measured').length);
    assert.equal(c.arms[mode].sd,null,'lost evidence never supplies planning spread');
  }
  assert.match(planner().formatPlan(powerPlan(r)),/Measured draws with skill 3; baseline 3/);
});

test('AC-19 option accessors and model coercions are refused before caller code can run',()=>{
  let invoked=0;
  const input=defaultInput();
  Object.defineProperty(input,'model',{enumerable:true,get(){invoked++;throw Error('getter executed');}});
  assert.throws(()=>planner().planSkill(input),/accessor|plain|JSON/i);
  assert.equal(invoked,0);
  for(const role of ['model','judgeModel']) {
    const value={toString(){invoked++;return MODEL;}};
    assert.throws(()=>planner().planSkill(defaultInput({[role]:value})),/model|string|JSON/i);
    assert.equal(invoked,0);
  }
});

test('AC-26 planner bands are classified comparison sites and route through the shared definition',()=>{
  const scope=require('./assertion-scope');
  const read=(root)=>{
    const sites=scope.bandSites(root);
    const mine=sites.comparison.filter(s=>s.file==='lib/plan.js');
    assert.equal(mine.length,2,'both planner constructions are classified');
    assert.ok(mine.every(s=>s.routed),'both route through bandOf');
    assert.equal(sites.unclassified.length,0);
  };
  read(ROOT);
  const dir=fs.mkdtempSync(path.join(scratch,'band-routing-'));
  fs.mkdirSync(path.join(dir,'lib'));
  const source=fs.readFileSync(path.join(ROOT,'lib/plan.js'),'utf8');
  fs.writeFileSync(path.join(dir,'lib/plan.js'),source);
  read(dir);
  fs.writeFileSync(path.join(dir,'lib/plan.js'),source.replaceAll('bandOf(c)','foreignBand(c)'));
  assert.throws(()=>read(dir),{name:'AssertionError'},'cut shared reader edge');
});

test('AC-12 every draw lost stays unknown with zero measured counts and no shared band',()=>{
  const r=shaped({c1:{with_skill:[],baseline:[]}}, {lost:[{id:'c1',mode:'with_skill'},{id:'c1',mode:'baseline'}]});
  const p=powerPlan(r), c=caseOf(p);oracle.readUnknown(c);
  assert.equal(c.arms.with_skill.n,0);assert.equal(c.arms.baseline.n,0);
  assert.equal(c.arms.with_skill.sd,null);assert.equal(c.arms.baseline.sd,null);
  oracle.readFallback(planner().formatPlan(p),['c1']);
});

test('Gate carry: token assumptions do not read as bare policy cap amounts',()=>{
  const scope=require('./assertion-scope');
  assert.deepEqual(scope.capLiteralClaims(ROOT).claims,[]);
  for(const plant of scope.CAP_WORD_PLANTS) {
    const override={[plant.rel]:scope.plantCapMutation(ROOT,plant)};
    const read=scope.capLiteralClaims(ROOT,override).claims.length ? 'red':'green';
    assert.equal(read,plant.expect,plant.id);
    for(const key of plant.greenWhenNarrowed || []) assert.equal(scope.capLiteralClaims(ROOT,override,{numberWord:scope.CAP_NUMBER_WORD_NARROWED[key]}).claims.length,0);
  }
});
