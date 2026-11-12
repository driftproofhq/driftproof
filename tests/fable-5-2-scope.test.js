// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 783: two frozen plans on claude-fable-5-2 and one cost table. (a) Report 017's placebo design
// with the target moved, Report 019; (b) the release boundary for three skills on Report 011's bytes and
// cases, Fable 5.2 against a fresh Fable 5.1, Report 020. No model is called: every run is the stub,
// every plant is written under a temporary root, and no campaign root is created under receipts/.
// The drivers read the plans' registry copy, as the paid commands give it.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const SPEC = 'specs/783-fable-5-2-scope';
process.env.DRIFTPROOF_STUB = '1';
process.env.DRIFTPROOF_REGISTRY = path.join(ROOT, SPEC, 'registry.json');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const DIR = path.join(ROOT, SPEC);
const A = path.join(DIR, 'placebo');
const B = path.join(DIR, 'boundary');
const S408 = 'specs/408-skill-measurements';
const S613 = 'specs/613-placebo-skills-report';
const ROSTER = 'receipts/report-017c';
const R018 = 'receipts/report-018';
const R011 = 'receipts/report-011';
const BUNDLE = 'specs/000-governance/external-runs/three-skill-comparison';
const { sha256 } = require(path.join(ROOT, 'lib/canonical'));
const { suiteIdentity, loadSkill } = require(path.join(ROOT, 'lib/skill'));
const { projectCalls } = require(path.join(ROOT, 'lib/run'));
const { placeboReading, receiptVerdict, PLACEBO_WORDS } = require(path.join(ROOT, 'lib/verdict'));
const { repositoryJudgeRelationship } = require(path.join(ROOT, 'lib/receipt'));
const H = require(path.join(ROOT, 'scripts/skill-handoff.js'));
const PR = require(path.join(DIR, 'price.cjs'));
const PA = require(path.join(A, 'protocol.cjs'));
const PB = require(path.join(B, 'protocol.cjs'));
const RA = require(path.join(A, 'run-campaign.cjs'));
const RB = require(path.join(B, 'run-campaign.cjs'));

const FABLE = 'claude-fable-5-2', FABLE51 = 'claude-fable-5-1', HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5';
const OPUS5 = 'claude-opus-5', OPUS55 = 'claude-opus-5-5', CLI = '2.1.311', RUNNER = '0.28.0';
const SKILLS = ['code-review-and-quality', 'git-workflow-and-versioning', 'documentation-and-adrs'];
const ROUTERS = ['find-skills', 'agent-browser', 'hyperframes', 'hyperframes-registry'];
const POLICY = 'That judge is fixed at claude-haiku-5-5 and changed only rarely';
const NOT_COMPARED = 'results scored by different graders are not compared directly';
const NOT_BESIDE_011 = 'Report 020\'s judge differs from Report 011\'s, so Report 020\'s figures are not set beside Report 011\'s as if comparable.';
// The first API variable the surface gate refuses, planted with a placeholder value, never a credential.
const CREDENTIAL = PR.API_VARIABLES[0];
const SETTINGS = { permissions: { deny: ['Read', 'WebFetch', 'WebSearch'] }, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, autoMemoryEnabled: false, disableClaudeAiConnectors: true };
// The builders run offline on the packaged registry (spec 408's guard refuses another); the preflight and
// the drivers read the plans' registry copy.
const offline = () => { const env = { ...process.env, DRIFTPROOF_STUB: '1', TMPDIR: '/var/tmp' }; delete env.DRIFTPROOF_REGISTRY; return env; };
const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: offline(), timeout: 600000 });
const nodeReg = (args, extra = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DRIFTPROOF_STUB: '1', TMPDIR: '/var/tmp', ...extra }, timeout: 600000 });
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const code = (c) => (e) => e.code === c;
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const fresh = () => fs.mkdtempSync('/var/tmp/s783-root-');
const catalog = () => json(path.join(DIR, 'evidence/model-catalog-fable-5-2.json'));
const planA = () => json(path.join(A, 'plan.json'));
const planB = () => json(path.join(B, 'plan.json'));
const specText = () => fs.readFileSync(path.join(DIR, 'spec.md'), 'utf8');

// Independent price oracle. List prices per million tokens: the estimate for claude-fable-5-2, the
// product registry for the rest, Haiku 5.5's long-prompt tier from spec 408's table; twice all input.
const registry = json(path.join(ROOT, 'config/models.json'));
const haiku = json(path.join(ROOT, S408, 'pricing.json')).models[HAIKU];
function rate(model, inputTokens) {
  if (model === FABLE) return { input: 10, output: 50 };
  if (model === HAIKU) return haiku.threshold && inputTokens > haiku.threshold ? haiku.above : haiku;
  const row = registry.models.find((m) => m.id === model); assert.ok(row, 'a registered price for ' + model);
  return { input: row.input_price, output: row.output_price };
}
const price = (model, u) => { const r = rate(model, u.input_tokens); return (2 * u.input_tokens * r.input + u.output_tokens * r.output) / 1e6; };
// A receipt repriced: generation at `target`, judging at `judge` with the judge usage scaled by `scale`;
// and the per-draw means at `perArm` draws per arm with every arm judged.
function reprice(receipt, target, judge, perArm, scale = 1) {
  let recorded = 0, judged = 0, judgeUsd = 0; const arm = {}, draws = {};
  for (const c of receipt.results.cases) for (const d of c.generation.draws) {
    const g = price(target, d.usage), j = price(judge, { input_tokens: Math.ceil(d.judge_usage.input_tokens * scale), output_tokens: Math.ceil(d.judge_usage.output_tokens * scale) });
    recorded += g + j; judgeUsd += j; judged++; arm[c.mode] = (arm[c.mode] || 0) + g; draws[c.mode] = (draws[c.mode] || 0) + 1;
  }
  const arms = Object.keys(arm);
  let maximum = judgeUsd / judged * perArm * arms.length; for (const k of arms) maximum += arm[k] / draws[k] * perArm;
  return { recorded, maximum };
}
function campaignHead(root) {
  const log = fs.readFileSync(path.join(ROOT, root, 'campaign.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const file = path.join(ROOT, root, log.at(-1).manifest);
  return { dir: path.dirname(file), manifest: json(file) };
}
const headReceipt = (head, rank) => json(path.join(head.dir, head.manifest.outcomes[rank - 1].attempt_id + '.json'));
const r011 = (model, skill) => json(path.join(ROOT, R011, skill + '-' + model + '-2026-09-23.json'));
const sums = () => Object.fromEntries(fs.readFileSync(path.join(ROOT, BUNDLE, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean).map((l) => { const [h, f] = l.split(/\s+/); return [f, h]; }));
// A temporary root holding copies of `rels`, for plants that must never touch the tree.
function copyRoot(rels) {
  const root = fresh();
  for (const rel of rels) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.cpSync(path.join(ROOT, rel), path.join(root, rel), { recursive: true }); }
  return root;
}
function planted(file, mutate) { const bytes = fs.readFileSync(file); const p = JSON.parse(bytes); mutate(p); fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n'); return () => fs.writeFileSync(file, bytes); }

// ---- the catalog, the model id and the release ------------------------------------------------------

test('AC-22: the model id and the Claude Code minimum are the catalog extract\'s, and both plans name them', () => {
  const c = catalog(); const f = c.models.find((m) => m.id === FABLE);
  assert.ok(f, 'the catalog names claude-fable-5-2'); assert.equal(f.name, 'Fable 5.2'); assert.equal(f.min_claude_code_version, '2.1.290');
  assert.equal(c.alias_targets.fable.default, FABLE);
  assert.ok(!/\/home\/|@/.test(fs.readFileSync(path.join(DIR, 'evidence/model-catalog-fable-5-2.json'), 'utf8')), 'no home path or email in the extract');
  const sha = sha256(fs.readFileSync(path.join(DIR, 'evidence/model-catalog-fable-5-2.json')));
  for (const plan of [planA(), planB()]) {
    assert.equal(plan.claude_code_version, CLI); assert.equal(plan.surface, 'claude-cli'); assert.equal(plan.runner_version, RUNNER);
  }
  assert.equal(planA().catalog.sha256, sha); assert.equal(planA().catalog.min_claude_code_version, '2.1.290');
  for (const m of [FABLE, FABLE51]) assert.equal(planB().catalog[m].sha256, sha);
  // Reports 017 and 018 sealed the pinned CLI in every receipt.
  for (const root of [ROSTER, R018]) { const head = campaignHead(root); for (let rank = 1; rank <= 20; rank++) assert.equal(headReceipt(head, rank).run.harness.version, CLI, root + ' rank ' + rank); }
  // Plant: a CLI below the catalog's minimum refuses the record.
  assert.throws(() => PR.catalogRecord(ROOT, FABLE, '2.1.289'), code('CATALOG'));
});

test('AC-3, AC-12, AC-14: a paid start runs only the pinned release on the pinned CLI, on the subscription surface', () => {
  const live = require(path.join(ROOT, 'config')).RUNNER_VERSION;
  const plan = (v) => ({ runner_version: v, claude_code_version: CLI });
  assert.doesNotThrow(() => PR.releaseGate(plan(live), () => CLI), 'control: the live release and the pinned CLI pass');
  assert.throws(() => PR.releaseGate(plan(live), () => '2.1.312'), code('HARNESS_BINDING'));
  assert.throws(() => PR.releaseGate(plan(live), () => null), code('HARNESS_BINDING'), 'an unreadable version refuses');
  assert.throws(() => PR.releaseGate(plan('9.9.9'), () => CLI), code('RUNNER_VERSION'));
  assert.doesNotThrow(() => PR.surfaceGate({}), 'control: a clean environment');
  for (const v of PR.API_VARIABLES) assert.throws(() => PR.surfaceGate({ [v]: 'planted' }), code('SURFACE_BINDING'), v);
  assert.throws(() => PR.surfaceGate({ CLAUDE_PROVIDER: 'api' }), code('SURFACE_BINDING'));
});

test('AC-19: one price table and one registry copy, generated, outside the product registry, priced as an estimate', () => {
  const r = node([path.join(DIR, 'price.cjs'), '--check']); assert.equal(r.status, 0, r.stderr);
  const reg = json(path.join(DIR, 'registry.json')); const row = reg.models.find((m) => m.id === FABLE);
  assert.equal(row.input_price, 10); assert.equal(row.output_price, 50); assert.equal(row.price_estimate, true); assert.equal(row.judge_eligible, false);
  const rest = structuredClone(reg); rest.models = rest.models.filter((m) => m.id !== FABLE);
  assert.deepEqual(rest, registry, 'the registry copy is config/models.json with one row added');
  const pt = json(path.join(DIR, 'pricing.json')); const p408 = json(path.join(ROOT, S408, 'pricing.json'));
  for (const [k, v] of Object.entries(p408.models)) assert.deepEqual(pt.models[k], v, 'spec 408\'s row for ' + k);
  assert.equal(pt.models[FABLE].price_estimate, true); assert.equal(pt.models[FABLE].input, 10); assert.equal(pt.models[FABLE].output, 50);
  assert.equal(pt.models[FABLE51].input, registry.models.find((m) => m.id === FABLE51).input_price);
  assert.ok(!registry.models.some((m) => m.id === FABLE), 'config/models.json carries no Fable 5.2 row');
  assert.ok(!(FABLE in p408.models), 'spec 408\'s pricing.json file carries no Fable 5.2 row');
  for (const plan of [planA(), planB()]) {
    assert.deepEqual(plan.price_estimate, PR.ESTIMATE); assert.equal(plan.price_estimate.price_estimate, true);
    assert.equal(plan.pricing_sha256, sha256(fs.readFileSync(path.join(DIR, 'pricing.json'))));
    assert.equal(plan.registry_sha256, sha256(fs.readFileSync(path.join(DIR, 'registry.json'))));
  }
  // Plants: a table that is not the plan's; a spec 408 row changed in the table.
  assert.throws(() => PR.installPrices(ROOT, 'e'.repeat(64)), code('PRICE_BINDING'));
  const root = copyRoot([SPEC + '/pricing.json']); const file = path.join(root, SPEC, 'pricing.json');
  planted(file, (t) => { t.models[HAIKU].input = 0.01; });
  assert.throws(() => PR.installPrices(root, sha256(fs.readFileSync(file))), code('PRICE_TABLE'));
});

// ---- plan (a): Report 017's placebo design on Fable 5.2 ---------------------------------------------

test('AC-1 to AC-4: plan (a) is Report 017\'s twenty, in order, with its pins, Fable 5.2 by full id, the Haiku 5.5 judge, three arms, new ids, frozen', () => {
  const plan = planA(); const source = json(path.join(ROOT, ROSTER, 'plan.json'));
  const r018 = json(path.join(ROOT, 'specs/655-report-018-plan/plan.json'));
  assert.equal(plan.report, '019'); assert.equal(plan.plan_version, 2); assert.equal(plan.protocol_state, 'frozen'); assert.equal(plan.spend_authorized, false);
  assert.equal(plan.model, FABLE); assert.equal(plan.judge, HAIKU); assert.equal(plan.arms, 3); assert.equal(plan.samples, 5);
  assert.deepEqual(plan.draws, { min: 3, max: 10 }); assert.equal(plan.capture, 'text');
  assert.equal(plan.execution.attempts.length, 20); assert.equal(plan.rows.length, 20);
  const PINNED = ['list', 'repository', 'skill', 'skill_path', 'commit', 'skill_sha256', 'evals_sha256', 'suite_hash', 'judge', 'samples', 'draws', 'capture', 'arms', 'placebo_revision', 'placebo_corpus_hash', 'ordinal'];
  for (const [i, a] of plan.execution.attempts.entries()) {
    const s = source.execution.attempts[i];
    for (const k of PINNED) assert.deepEqual(a.protocol[k], s.protocol[k], 'rank ' + (i + 1) + ' ' + k);
    assert.deepEqual(Object.keys(a.protocol).sort(), Object.keys(s.protocol).sort(), 'no field added or dropped');
    assert.equal(a.protocol.report, '019'); assert.equal(a.protocol.model, FABLE);
    assert.equal(a.attempt_id, sha256(JSON.stringify(a.protocol)));
    assert.notEqual(a.attempt_id, s.attempt_id); assert.notEqual(a.attempt_id, r018.execution.attempts[i].attempt_id);
    const row = plan.rows[i];
    assert.equal(row.rank, i + 1); assert.equal(row.skill, s.protocol.skill); assert.equal(row.report_017_attempt_id, s.attempt_id);
    assert.equal(row.router, ROUTERS.includes(row.skill)); assert.equal(row.planned_calls, projectCalls(3, 5, 10, 3)); assert.equal(row.planned_calls, 540);
  }
  assert.equal(plan.totals.planned_calls, 10800);
  assert.equal(plan.source.plan_sha256, sha256(fs.readFileSync(path.join(ROOT, ROSTER, 'plan.json'))));
  for (const f of [SPEC + '/placebo/run-campaign.cjs', SPEC + '/price.cjs', SPEC + '/registry.json', SPEC + '/pricing.json', 'lib/run.js']) assert.ok(f in plan.runner_hashes, f + ' is pinned');
  assert.deepEqual(plan.routers.skills, ROUTERS);
  // The frozen plan's hash, as the spec records it.
  const pin = /<!--placebo_plan_sha256-->([0-9a-f]{64})<!--\/placebo_plan_sha256-->/.exec(specText());
  assert.ok(pin, 'the spec pins plan (a)'); assert.equal(pin[1], sha256(fs.readFileSync(path.join(A, 'plan.json'))));
  const r = node([path.join(A, 'build-plan.cjs'), '--check']); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^report 019 plan: 20 attempts; 10800 planned calls; .*Fable 5\.2 price an estimate; no spend; current$/m);
  const md = fs.readFileSync(path.join(A, 'projection.md'), 'utf8');
  for (const l of r.stdout.split('\n').filter((x) => x.startsWith('|'))) assert.ok(md.includes(l), 'the printed table is the committed one: ' + l);
});

test('AC-6: plan (a)\'s projection is the larger of Reports 017 and 018\'s receipts repriced at the Fable estimate, with ceilings under a cap of 375', () => {
  const plan = planA(); const h17 = campaignHead(ROSTER), h18 = campaignHead(R018);
  let ceilings = 0, recorded = 0, maximum = 0;
  for (const row of plan.rows) {
    const r17 = headReceipt(h17, row.rank), r18 = headReceipt(h18, row.rank);
    assert.equal(r17.skill.name, row.skill); assert.equal(r18.skill.name, row.skill);
    const x = reprice(r17, FABLE, HAIKU, 30), y = reprice(r18, FABLE, HAIKU, 30); const p = row.projection;
    assert.equal(p.report_017.attempt_id, row.report_017_attempt_id, 'Report 017\'s source receipt is the roster attempt');
    assert.equal(p.report_018.receipt_hash, r18.receipt_hash); assert.equal(p.report_017.receipt_hash, r17.receipt_hash);
    assert.equal(p.report_017.recorded_usd, round4(x.recorded), row.skill); assert.equal(p.report_017.maximum_usd, round4(x.maximum), row.skill);
    assert.equal(p.report_018.recorded_usd, round4(y.recorded), row.skill); assert.equal(p.report_018.maximum_usd, round4(y.maximum), row.skill);
    assert.equal(p.recorded_usd, Math.max(round4(x.recorded), round4(y.recorded))); assert.equal(p.maximum_usd, Math.max(round4(x.maximum), round4(y.maximum)));
    assert.equal(row.max_usd, round4(p.maximum_usd * 1.5), row.skill + ' ceiling');
    assert.equal(p.generation_model, FABLE); assert.equal(p.judge_model, HAIKU);
    ceilings += row.max_usd; recorded += p.recorded_usd; maximum += p.maximum_usd;
  }
  assert.equal(plan.totals.max_usd, round4(ceilings)); assert.equal(plan.totals.recorded_usd, round4(recorded)); assert.equal(plan.totals.maximum_usd, round4(maximum));
  assert.equal(plan.cap_usd, 375); assert.ok(plan.totals.max_usd <= plan.cap_usd);
  assert.deepEqual(plan.issue_cap, { budget_usd: 800, spent_usd: 0, remaining_usd: 800, caps: { '019': 375, '020': 45 } });
});

test('AC-9, AC-10: plan (a)\'s note pre-registers the judge, the relationship, the effort, the price, the shapes, the routers and the hand-off skills, and stands alone', () => {
  const plan = planA(); const note = fs.readFileSync(path.join(A, 'outcomes.md'), 'utf8');
  assert.equal(plan.outcomes.sha256, sha256(Buffer.from(note)));
  const pin = /<!--placebo_outcomes_sha256-->([0-9a-f]{64})<!--\/placebo_outcomes_sha256-->/.exec(specText());
  assert.ok(pin, 'the spec pins the note'); assert.equal(pin[1], plan.outcomes.sha256);
  assert.ok(note.includes(PLACEBO_WORDS.ABOVE_PLACEBO));
  const block = /```report-019-headlines\n([\s\S]*?)```/.exec(note); assert.ok(block, 'the fence is named by the plan\'s report');
  assert.deepEqual(block[1].trim().split('\n').map((l) => l.split(':')[0]), ['all', 'not_read', 'many_underpowered', 'none', 'some', 'counts', 'routers']);
  for (const l of block[1].trim().split('\n')) assert.ok(/ABOVE_PLACEBO|beat the fake|not measured|UNDERPOWERED|left out/.test(l), l);
  assert.match(note, /N is 16/); for (const s of [...ROUTERS, 'grill-me', 'grill-with-docs']) assert.ok(note.includes(s), s);
  assert.match(note, /The judge is claude-haiku-5-5, the judge the judge policy fixes/); assert.ok(note.includes(POLICY)); assert.ok(note.includes(NOT_COMPARED));
  assert.equal(plan.judge_relationship, repositoryJudgeRelationship(FABLE, HAIKU).limitation);
  assert.match(note, /The judge is a different model from the target/);
  assert.match(note, /show no Report 017 or Report 018 reading, verdict, count or\s+figure/);
  const def = catalog().models.find((m) => m.id === FABLE).default_effort;
  assert.deepEqual(plan.effort, { set: false, catalog_default: def, source: PR.CATALOG });
  assert.ok(note.includes('No effort setting is passed, so the catalog default for claude-fable-5-2, ' + def + ', applies.'));
  assert.match(note, /USD 10 input and USD 50 output per million tokens/); assert.match(note, /Driftproof 0\.28\.0/);
  assert.equal(plan.handoff.note, H.note(H.committed(ROOT), 'the pre-registered counts'));
  const templates = RA.readOutcomes(plan, ROOT);
  assert.match(RA.headline(RA.tally(plan, new Map(plan.rows.map((r) => [r.attempt_id, 'NO_DIFFERENCE']))), templates)[0], /^None of the 16 skills beat the fake on Fable 5\.2/);
});

// A temporary copy of every input plan (a) reads, with synthetic skill texts in place of the pinned ones,
// and the plan rebuilt over it, as spec 655's test does.
const handsOff = (skill) => '---\nname: ' + skill + '\n---\nCall the Skill tool with "synthetic-other-skill".\n';
const plain = (skill) => '---\nname: ' + skill + '\n---\nSynthetic test instructions for ' + skill + ' only. No provider call.\n';
const textFor = (skill) => (PA.HANDOFF_SKILLS.includes(skill) ? handsOff(skill) : plain(skill));
function fixture() {
  const root = copyRoot([S408, S613, 'specs/655-report-018-plan', SPEC, ROSTER, R018, 'scripts/skill-handoff.js', ...PA.RUNNER_FILES.filter((f) => !f.startsWith(SPEC) && !f.startsWith(S408) && !f.startsWith(S613))]);
  const at = path.join(root, S408);
  const plan = json(path.join(root, ROSTER, 'plan.json')); const sources = json(path.join(at, 'sources.json'));
  const panel = path.join(root, 'receipts/report-017-panel'); fs.mkdirSync(panel, { recursive: true });
  for (const a of plan.execution.attempts) {
    const p = a.protocol; const s = sources.find((x) => x.repository === p.repository && x.skill === p.skill);
    const text = textFor(p.skill); const old = s.skill_sha256; s.skill_sha256 = sha256(text);
    const raw = fs.readFileSync(path.join(at, s.suite), 'utf8').replaceAll(old, s.skill_sha256); fs.writeFileSync(path.join(at, s.suite), raw);
    p.skill_sha256 = s.skill_sha256; p.evals_sha256 = sha256(raw); p.suite_hash = suiteIdentity(JSON.parse(raw)).suiteHash;
    const row = plan.rows.find((r) => r.skill === p.skill && r.repository === p.repository);
    a.attempt_id = sha256(JSON.stringify(p)); row.attempt_id = a.attempt_id;
    if (PA.HANDOFF_SKILLS.includes(p.skill)) fs.writeFileSync(path.join(panel, a.attempt_id + '.md'), text);
  }
  fs.writeFileSync(path.join(at, 'sources.json'), JSON.stringify(sources));
  fs.writeFileSync(path.join(root, ROSTER, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  // Report 018's head receipts are the projection's second source: rank, skill and repository match.
  const planFile = path.join(root, SPEC, 'placebo/plan.json');
  const built = node(['-e', 'const B=require(process.argv[1]);require("node:fs").writeFileSync(process.argv[3],JSON.stringify(B.buildPlan({root:process.argv[2]}),null,2)+"\\n")', path.join(A, 'build-plan.cjs'), root, planFile]);
  assert.equal(built.status, 0, built.stderr);
  const inputs = path.join(root, 'inputs'); fs.mkdirSync(inputs);
  const frozen = json(planFile);
  for (const a of frozen.execution.attempts) fs.writeFileSync(path.join(inputs, a.attempt_id + '.md'), textFor(a.protocol.skill));
  const home = path.join(root, 'eval'); fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify(SETTINGS));
  return { root, inputs, home, planFile, plan: frozen, bytes: fs.readFileSync(planFile) };
}
function readsAs(f, mutate, reason, why) {
  const plan = JSON.parse(f.bytes); mutate(plan);
  fs.writeFileSync(f.planFile, JSON.stringify(plan, null, 2) + '\n');
  const ok = Array.isArray(reason) ? (e) => reason.includes(e.code) : code(reason);
  try { assert.throws(() => RA.readPlan(f.root), ok, why); } finally { fs.writeFileSync(f.planFile, f.bytes); }
}
const reid = (a) => { a.attempt_id = sha256(JSON.stringify(a.protocol)); };
const noRun = () => { const s = { runs: 0 }; s.adapters = { run: () => { s.runs++; throw Error('PROVIDER_CALL'); } }; return s; };

test('AC-1 to AC-4, AC-6, AC-12: plan (a)\'s readPlan and driver refuse every planted change before any call', async () => {
  const f = fixture();
  assert.equal(RA.readPlan(f.root).plan.execution.attempts.length, 20, 'control: the fixture plan reads');
  readsAs(f, (p) => { const [a, b] = [p.execution.attempts[0], p.execution.attempts[1]]; [a.protocol.ordinal, b.protocol.ordinal] = [b.protocol.ordinal, a.protocol.ordinal]; reid(a); reid(b); p.execution.attempts[0] = b; p.execution.attempts[1] = a; }, 'PLAN_BINDING', 'two attempts swapped');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.skill_sha256 = 'a'.repeat(64); reid(p.execution.attempts[3]); }, 'SKILL_BYTES', 'another skill pin');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.suite_hash = 'b'.repeat(64); reid(p.execution.attempts[3]); }, 'SUITE_BINDING', 'another suite hash');
  readsAs(f, (p) => { p.execution.attempts[5].protocol.placebo_corpus_hash = 'c'.repeat(64); reid(p.execution.attempts[5]); }, 'PLAN_BINDING', 'another corpus');
  for (const m of ['fable', FABLE51]) {
    readsAs(f, (p) => { p.execution.attempts[2].protocol.model = m; reid(p.execution.attempts[2]); }, 'PLAN_BINDING', m + ' on one attempt');
    readsAs(f, (p) => { p.model = m; }, 'PLAN_BINDING', m + ' on the plan');
  }
  readsAs(f, (p) => { p.execution.attempts[2].protocol.judge = SONNET; reid(p.execution.attempts[2]); }, ['PLAN_BINDING', 'JUDGE_INELIGIBLE'], 'a Sonnet judge');
  readsAs(f, (p) => { p.report = '018'; }, 'PLAN_BINDING', 'another report');
  readsAs(f, (p) => { p.execution.attempts[7].protocol.arms = 2; reid(p.execution.attempts[7]); }, 'PLAN_BINDING', 'two arms');
  readsAs(f, (p) => { p.execution.attempts[9].attempt_id = 'd'.repeat(64); }, 'PLAN_BINDING', 'an id that is not its protocol\'s hash');
  readsAs(f, (p) => { p.rows[0].max_usd = 100; }, 'PLAN_BINDING', 'a raised ceiling');
  readsAs(f, (p) => { p.cap_usd = 1000; }, 'PLAN_BINDING', 'a raised cap');
  readsAs(f, (p) => { delete p.price_estimate; }, 'PLAN_BINDING', 'the estimate flag removed');
  readsAs(f, (p) => { p.claude_code_version = '2.1.312'; }, 'PLAN_BINDING', 'another Claude Code version');
  readsAs(f, (p) => { p.runner_version = '0.27.0'; }, 'PLAN_BINDING', 'another runner release');
  readsAs(f, (p) => { p.effort = { ...p.effort, set: true }; }, 'PLAN_BINDING', 'an effort setting');
  readsAs(f, (p) => { p.pricing_sha256 = 'e'.repeat(64); }, 'PRICE_BINDING', 'another price table');
  for (const rel of ['lib/run.js', SPEC + '/placebo/run-campaign.cjs']) {
    const file = path.join(f.root, rel); const live = fs.readFileSync(file); fs.appendFileSync(file, '\n');
    try { assert.throws(() => RA.readPlan(f.root), code('RUNNER_BINDING'), rel); } finally { fs.writeFileSync(file, live); }
  }
  // AC-12: an API credential or another surface in the environment refuses before any call.
  const none = noRun();
  for (const v of PR.API_VARIABLES) {
    process.env[v] = 'planted';
    try { await assert.rejects(RA.runCampaign({ root: f.root, campaignRoot: fresh(), inputs: f.inputs, evalHome: f.home, adapters: none.adapters }), code('SURFACE_BINDING'), v); } finally { delete process.env[v]; }
  }
  assert.equal(none.runs, 0);
});

test('AC-3, AC-5, AC-8, AC-10, AC-11: a stub campaign writes 20 placebo stub receipts under plan (a), each NOT_MEASURED; the harness check and spec 613\'s plants hold', async () => {
  const f = fixture(); const croot = fresh();
  const m = await RA.runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home });
  assert.equal(m.report, '019'); assert.equal(m.plan_sha256, sha256(f.bytes)); assert.equal(m.cap_usd, 375); assert.equal(m.stub, true);
  assert.equal(m.outcomes.length, 20); assert.ok(m.outcomes.every((o) => o.status === 'receipt'));
  const out = path.dirname(path.join(croot, RA.readLog(croot).at(-1).manifest));
  for (const [i, o] of m.outcomes.entries()) {
    const a = f.plan.execution.attempts[i]; assert.equal(o.attempt_id, a.attempt_id);
    const r = json(path.join(out, a.attempt_id + '.json'));
    assert.equal(r.verification_level, 'UNVERIFIED'); assert.ok(r.placebo); assert.equal(r.results.cases.filter((c) => c.mode === 'placebo').length, 3);
    assert.equal(r.run.model_id, FABLE); assert.equal(r.run.judge.model_id, HAIKU);
    assert.equal(r.results.cases[0].generation.issue408.pricing_sha256, f.plan.pricing_sha256, 'the receipt seals the plan\'s price table');
    assert.equal(receiptVerdict(r).verdict, 'NOT_MEASURED'); assert.equal(placeboReading(r).reading, 'NOT_MEASURED');
  }
  const ctx = RA.readPlan(f.root); const first = json(path.join(out, f.plan.execution.attempts[0].attempt_id + '.json'));
  // AC-3: a paid receipt's Claude Code version and runner release are the plan's.
  const withRun = (harness, runner) => { const r = structuredClone(first); r.run.harness = { name: 'claude-code', version: harness }; r.run.runner_version = runner; return r; };
  assert.doesNotThrow(() => RA.harnessCheck(ctx, withRun(CLI, RUNNER)), 'control: the pinned version and release pass');
  assert.throws(() => RA.harnessCheck(ctx, withRun('2.1.312', RUNNER)), code('HARNESS_BINDING'));
  assert.throws(() => RA.harnessCheck(ctx, withRun(CLI, '0.27.0')), code('RUNNER_VERSION'));
  // AC-5: the block dropped refuses.
  const noBlock = structuredClone(first); delete noBlock.placebo;
  assert.throws(() => RA.placeboArm(ctx, ctx.plan.execution.attempts[0], noBlock), code('PLACEBO_ARM'));
  // AC-10: publication carries the plan's judge relationship, effort, release and price estimate.
  const pub = RA.publication({ root: f.root, campaignRoot: croot, stub: true, recordedHeads: { [sha256(f.bytes)]: 'f'.repeat(40) }, reader: { head: () => 'f'.repeat(40), isAncestor: () => true, show: (h, file) => fs.readFileSync(path.join(f.root, file)) } });
  assert.equal(pub.rows.length, 20); assert.deepEqual(pub.effort, f.plan.effort); assert.equal(pub.runner_version, RUNNER); assert.deepEqual(pub.price_estimate, PR.ESTIMATE);
  assert.equal(pub.tally.shape, 'not_read'); assert.match(pub.headline[0], /^16 of 16 skills were not measured against the same-length placebo on Fable 5\.2/);
  // AC-11: a second unchained start refuses before any run.
  const none = noRun();
  await assert.rejects(RA.runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home, adapters: none.adapters }), code('CAMPAIGN_STARTED'));
  assert.equal(none.runs, 0);
});

test('AC-2, AC-9, AC-12: plan (a)\'s preflight script stages only pinned bytes, reports each input and refuses another release, with no call', () => {
  const f = fixture(); const from = fresh(); const inputs = path.join(fresh(), 'staged');
  const script = path.join(A, 'preflight.cjs'), config = path.join(f.root, 'config.js'), live = fs.readFileSync(config, 'utf8');
  const release = (v) => fs.writeFileSync(config, live.replace(/^const RUNNER_VERSION = '[^']+';$/m, "const RUNNER_VERSION = '" + v + "';"));
  // The texts sit under their Report 017 ids, one of them with a byte changed.
  for (const [i, a] of f.plan.execution.attempts.entries()) fs.writeFileSync(path.join(from, f.plan.rows[i].report_017_attempt_id + '.md'), textFor(a.protocol.skill) + (i === 4 ? ' ' : ''));
  release('0.27.0');
  const old = nodeReg([script, '--root', f.root, '--inputs', inputs, '--stage-from', from]);
  assert.equal(old.status, 1); assert.match(old.stdout, /^report 019 preflight: 0\/20 inputs ready; refused: RUNNER_VERSION; no call made$/m);
  assert.ok(!fs.existsSync(inputs), 'a refused preflight stages nothing');
  release(RUNNER);
  const one = nodeReg([script, '--root', f.root, '--inputs', inputs, '--stage-from', from]);
  assert.equal(one.status, 1, one.stderr); assert.match(one.stdout, /^report 019 preflight: 19\/20 inputs ready; refused: INPUT_MISSING; plan sha256 [0-9a-f]{64}; no call made$/m);
  assert.equal(fs.readdirSync(inputs).length, 19, 'the changed text is not staged');
  const a4 = f.plan.execution.attempts[4]; fs.writeFileSync(path.join(inputs, a4.attempt_id + '.md'), textFor(a4.protocol.skill));
  const all = nodeReg([script, '--root', f.root, '--inputs', inputs]);
  assert.equal(all.status, 0, all.stdout + all.stderr); assert.match(all.stdout, /^report 019 preflight: 20\/20 inputs ready; ready; plan sha256 [0-9a-f]{64}; no call made$/m);
  const leaked = nodeReg([script, '--root', f.root, '--inputs', inputs], { [CREDENTIAL]: 'planted' });
  assert.match(leaked.stdout, /refused: SURFACE_BINDING; no call made/);
  const bare = node([script, '--root', f.root, '--inputs', inputs]);
  assert.match(bare.stdout, /refused: (REGISTRY_BINDING|UNREGISTERED_MODEL); no call made/, 'without the plan\'s registry copy the plan does not read');
});

// ---- plan (b): the release boundary on Fable 5.2 ----------------------------------------------------

test('AC-13, AC-14, AC-16: plan (b) is six fresh runs on Report 011\'s bytes and case, the two sides differing only in the model, Fable 5.1 re-run', () => {
  const plan = planB(); const s = sums();
  assert.equal(plan.report, '020'); assert.equal(plan.protocol_state, 'frozen'); assert.equal(plan.spend_authorized, false);
  assert.deepEqual(plan.models, [FABLE, FABLE51]); assert.equal(plan.judge, HAIKU); assert.equal(plan.samples, 5); assert.equal(plan.arms, 2); assert.equal(plan.cases, 1);
  assert.deepEqual(plan.draws, { min: 3, max: 10 }); assert.equal(plan.isolation, 'eval-user');
  const order = [FABLE, FABLE51].flatMap((model) => SKILLS.map((skill) => [model, skill]));
  assert.deepEqual(plan.execution.attempts.map((a) => [a.protocol.model, a.protocol.skill]), order);
  for (const [i, a] of plan.execution.attempts.entries()) {
    const p = a.protocol; const dir = path.join(ROOT, BUNDLE, 'inputs/driftproof', p.skill);
    assert.equal(a.attempt_id, sha256(JSON.stringify(p))); assert.equal(p.ordinal, i + 1); assert.equal(p.report, '020');
    assert.equal(p.skill_md_sha256, s['inputs/driftproof/' + p.skill + '/SKILL.md']); assert.equal(p.skill_md_sha256, sha256(fs.readFileSync(path.join(dir, 'SKILL.md'))));
    assert.equal(p.evals_sha256, s['inputs/driftproof/' + p.skill + '/evals/evals.json']);
    assert.equal(p.content_hash, loadSkill(dir).contentHash);
    for (const m of [OPUS5, OPUS55]) { assert.equal(p.content_hash, r011(m, p.skill).skill.content_hash); assert.equal(p.suite_hash, r011(m, p.skill).suite.suite_hash); }
    assert.equal(p.judge, HAIKU); assert.equal(p.samples, 5); assert.equal(p.claude_code_version, CLI); assert.equal(p.runner_version, RUNNER);
    assert.equal(p.surface, 'claude-cli'); assert.equal(p.isolation, 'eval-user'); assert.equal(p.effort, 'none set');
    assert.deepEqual(p.flags, ['--judge-model', HAIKU, '--samples', '5', '--capture', 'text', '--concurrency', '1', '--keep-transcripts', '--max-calls', '120', '--max-usd', '8']);
    assert.ok(!p.flags.includes('--trusted-skill') && !p.flags.some((x) => /effort|quick|case|placebo/.test(x)), 'no same-user lane, effort, preset, case subset or third arm');
    assert.equal(a.planned_calls, projectCalls(1, 5, 10, 2)); assert.equal(a.planned_calls, 120); assert.equal(a.table, 'model');
  }
  // The model table's two sides differ only in the model.
  const strip = (p) => { const { model, ordinal, ...rest } = p; return JSON.stringify(rest); };
  for (const [i, skill] of SKILLS.entries()) {
    const t = plan.model_table[i]; assert.equal(t.skill, skill);
    const [x, y] = [t.first, t.second].map((id) => plan.execution.attempts.find((a) => a.attempt_id === id).protocol);
    assert.equal(x.model, FABLE51); assert.equal(y.model, FABLE); assert.equal(strip(x), strip(y), skill);
  }
  assert.equal(plan.harness_table.planned, false); assert.equal(plan.totals.planned_calls, 720);
  // AC-16: no committed receipt is a Fable 5.1 receipt of these skills, so the side is a re-run.
  const found = [];
  // A-783-1: plan (b)'s own campaign root holds its own run's receipts, not existing ones; it is not searched.
  const own = path.join(ROOT, 'receipts/report-020');
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) { if (f !== own) walk(f); } else if (n.name.endsWith('.json') && fs.readFileSync(f, 'utf8').includes(FABLE51)) { try { const r = json(f); if (r.run && r.run.model_id === FABLE51 && SKILLS.includes(r.skill && r.skill.name)) found.push(path.relative(ROOT, f)); } catch { /* not a receipt */ } } } };
  walk(path.join(ROOT, 'receipts'));
  // Every committed Fable 5.1 receipt of these skills is listed, each differing in more than the model.
  assert.equal(plan.comparison_side.model, FABLE51); assert.equal(plan.comparison_side.decision, 're-run');
  assert.deepEqual(plan.comparison_side.existing.map((e) => e.receipt), found);
  for (const e of plan.comparison_side.existing) {
    const r = json(path.join(ROOT, e.receipt)); assert.equal(e.receipt_hash, r.receipt_hash);
    assert.ok(e.differs.length > 0, e.receipt + ' differs in more than the model');
    if (r.suite.suite_hash !== plan.inputs.skills[r.skill.name].suite_hash) assert.ok(e.differs.includes('suite.suite_hash'));
    if (r.run.runner_version !== RUNNER) assert.ok(e.differs.includes('run.runner_version'));
  }
  assert.ok(found.includes('receipts/report-008/code-review-and-quality-claude-fable-5-1-2026-09-01.json'), 'Report 008\'s Fable 5.1 receipt is found');
  const pin = /<!--boundary_plan_sha256-->([0-9a-f]{64})<!--\/boundary_plan_sha256-->/.exec(specText());
  assert.ok(pin, 'the spec pins plan (b)'); assert.equal(pin[1], sha256(fs.readFileSync(path.join(B, 'plan.json'))));
  const r = node([path.join(B, 'build-plan.cjs'), '--check']); assert.equal(r.status, 0, r.stderr);
  // A-783-1: once plan (b)'s campaign root holds its frozen plan and a sealed receipt, --check reads the
  // plan as historical and says so (spec 613 A-613-3).
  const ran = fs.existsSync(path.join(own, 'plan.json')) && fs.readFileSync(path.join(own, 'plan.json')).equals(fs.readFileSync(path.join(B, 'plan.json')));
  assert.match(r.stdout, ran ? /^report 020 plan: 6 runs; 720 planned calls; .*Fable 5\.2 price an estimate; no spend; current \(historical: the frozen plan of receipts\/report-020; not rebuilt from the live tree\)$/m
    : /^report 020 plan: 6 runs; 720 planned calls; .*Fable 5\.2 price an estimate; no spend; current$/m);
  const md = fs.readFileSync(path.join(B, 'projection.md'), 'utf8');
  for (const l of r.stdout.split('\n').filter((x) => x.startsWith('|'))) assert.ok(md.includes(l), 'the printed table is the committed one: ' + l);
});

test('AC-14, AC-15, AC-18: plan (b)\'s readPlan refuses every planted change, on a copy of its inputs', () => {
  const root = copyRoot([SPEC, R011, BUNDLE + '/SHA256SUMS', BUNDLE + '/inputs', S408, ...RB.runnerFiles(ROOT).filter((f) => !f.startsWith(SPEC))]);
  assert.equal(RB.readPlan(root).plan.execution.attempts.length, 6, 'control: the copy reads');
  const file = path.join(root, SPEC, 'boundary/plan.json');
  const reads = (mutate, want, why) => { const undo = planted(file, mutate); try { assert.throws(() => RB.readPlan(root), (e) => [].concat(want).includes(e.code), why); } finally { undo(); } };
  const re = (a) => { a.attempt_id = sha256(JSON.stringify(a.protocol)); };
  reads((p) => { p.execution.attempts[0].protocol.judge = OPUS5; re(p.execution.attempts[0]); }, ['PLAN_BINDING', 'JUDGE_INELIGIBLE'], 'Report 011\'s judge on one run');
  reads((p) => { p.execution.attempts[4].protocol.samples = 3; re(p.execution.attempts[4]); }, 'PLAN_BINDING', 'three samples on one side');
  reads((p) => { p.execution.attempts[1].protocol.claude_code_version = '2.1.280'; re(p.execution.attempts[1]); }, 'PLAN_BINDING', 'another CLI on one run');
  reads((p) => { p.execution.attempts[3].protocol.flags = [...p.execution.attempts[3].protocol.flags, '--trusted-skill']; re(p.execution.attempts[3]); }, 'PLAN_BINDING', 'the same-user lane on one run');
  reads((p) => { p.execution.attempts[2].max_usd = 50; }, 'PLAN_BINDING', 'a raised ceiling');
  reads((p) => { p.cap_usd = 500; }, 'PLAN_BINDING', 'a raised cap');
  reads((p) => { p.comparison_side.existing = ['receipts/elsewhere.json']; }, 'COMPARISON_SIDE', 'a receipt listed without its differences');
  reads((p) => { p.comparison_side.existing[0].differs = []; }, 'COMPARISON_SIDE', 'a matching receipt the plan would not reuse');
  reads((p) => { p.comparison_side.decision = 'reuse'; }, 'COMPARISON_SIDE', 'reuse of a receipt that differs');
  reads((p) => { p.report_011.statement = 'Report 020 compares with Report 011.'; }, 'PLAN_BINDING', 'the Report 011 statement edited');
  reads((p) => { p.effort.catalog_default[FABLE] = 'high'; }, 'PLAN_BINDING', 'another effort record');
  const md = path.join(root, BUNDLE, 'inputs/driftproof', SKILLS[0], 'SKILL.md'); const live = fs.readFileSync(md); fs.appendFileSync(md, ' ');
  try { assert.throws(() => RB.readPlan(root), code('SKILL_BYTES')); } finally { fs.writeFileSync(md, live); }
  const lib = path.join(root, 'lib/run.js'); const bytes = fs.readFileSync(lib); fs.appendFileSync(lib, '\n');
  try { assert.throws(() => RB.readPlan(root), code('RUNNER_BINDING')); } finally { fs.writeFileSync(lib, bytes); }
  fs.writeFileSync(path.join(root, 'lib/new-module.js'), '\'use strict\';\n');
  assert.throws(() => RB.readPlan(root), code('RUNNER_BINDING'), 'a library file the plan does not pin');
});

test('AC-18: plan (b)\'s projection is the larger of Report 011\'s two receipts repriced per target, judging scaled to five Haiku samples, ceilings under a cap of 45', () => {
  const plan = planB(); let ceilings = 0;
  for (const a of plan.execution.attempts) {
    const [x, y] = [OPUS55, OPUS5].map((m) => { const r = r011(m, a.protocol.skill); return reprice(r, a.protocol.model, HAIKU, 10, 5 / r.run.judge.samples); });
    assert.equal(a.projection.recorded_usd, Math.max(round4(x.recorded), round4(y.recorded)), a.protocol.model + ' ' + a.protocol.skill);
    assert.equal(a.projection.maximum_usd, Math.max(round4(x.maximum), round4(y.maximum)));
    assert.equal(a.max_usd, round4(a.projection.maximum_usd * 1.5)); ceilings += a.max_usd;
  }
  assert.equal(plan.totals.max_usd, round4(ceilings)); assert.equal(plan.cap_usd, 45); assert.ok(plan.totals.max_usd <= plan.cap_usd);
  assert.deepEqual(plan.issue_cap, planA().issue_cap);
});

test('AC-17: plan (b)\'s note pre-registers Report 011\'s four labels, the with-skill rule, the judge difference, the effort and the limits', () => {
  const plan = planB(); const note = fs.readFileSync(path.join(B, 'outcomes.md'), 'utf8');
  assert.equal(plan.outcomes.sha256, sha256(Buffer.from(note)));
  const pin = /<!--boundary_outcomes_sha256-->([0-9a-f]{64})<!--\/boundary_outcomes_sha256-->/.exec(specText());
  assert.ok(pin, 'the spec pins the note'); assert.equal(pin[1], plan.outcomes.sha256);
  const src = fs.readFileSync(path.join(ROOT, 'scripts/prepare-report-011.js'), 'utf8');
  const labels = [...src.matchAll(/^\s+'?[\w-]+'?: '([^']+)',$/gm)].map((m) => m[1]).slice(0, 4);
  assert.deepEqual(labels, ['separation detected, upward', 'separation detected, downward', 'no separation detected', 'no separation detected; not enough draws to conclude at this effect floor']);
  for (const l of labels) { assert.ok(note.includes('- ' + l + '\n'), l); assert.ok(Object.values(RB.LABEL).includes(l), 'the reader\'s label: ' + l); }
  assert.match(note, /lib\/diff\.js buildDriftReport/); assert.match(note, /with-skill arms only/);
  // Word for word; the note wraps its prose, so line breaks read as spaces.
  const flat = note.replace(/\s+/g, ' ');
  assert.ok(flat.includes(NOT_BESIDE_011)); assert.equal(plan.report_011.statement, NOT_BESIDE_011);
  assert.ok(flat.includes(POLICY)); assert.ok(flat.includes(NOT_COMPARED));
  const def = (m) => catalog().models.find((x) => x.id === m).default_effort;
  assert.deepEqual(plan.effort.catalog_default, { [FABLE]: def(FABLE), [FABLE51]: def(FABLE51) });
  assert.ok(flat.includes('The catalog gives claude-fable-5-2 ' + def(FABLE) + ' and claude-fable-5-1 ' + def(FABLE51) + '. The two models ran at their own defaults'));
  for (const limit of ['One case per skill', 'Few draws', 'The judge is not Report 011\'s', 'No harness table is planned']) assert.ok(flat.includes(limit), limit);
});

test('AC-12, AC-13, AC-14: plan (b)\'s zero-cost preflight reads the runner\'s own preview of each run, and refuses an API credential', () => {
  const calls = [];
  const spy = (file, args, opts) => { calls.push(args); return spawnSync(file, args, opts); };
  const r = RB.preflight({ spawn: spy });
  assert.equal(r.rows.length, 6); assert.equal(r.problem, null, JSON.stringify(r.rows)); assert.ok(r.rows.every((x) => x.status === 'ok'));
  assert.ok(calls.every((a) => a.includes('--preview') && a.includes('--json')), 'every spawn is the runner\'s no-call preview');
  // Plant: a preview that says it would send other bytes.
  const lie = (file, args, opts) => { const out = spawnSync(file, args, opts); const v = JSON.parse(out.stdout); v.what_is_sent.system.sha256 = '0'.repeat(64); return { ...out, stdout: JSON.stringify(v) }; };
  assert.equal(RB.preflight({ spawn: lie }).problem, 'SKILL_BYTES');
  // Plant: a preview that would spend API credits on its judge.
  const metered = (file, args, opts) => { const out = spawnSync(file, args, opts); const v = JSON.parse(out.stdout); v.where[1].spend = 'metered'; return { ...out, stdout: JSON.stringify(v) }; };
  assert.equal(RB.preflight({ spawn: metered }).problem, 'SURFACE_BINDING');
  process.env[CREDENTIAL] = 'planted';
  try { assert.throws(() => RB.preflight({ spawn: () => { throw Error('PROVIDER_CALL'); } }), code('SURFACE_BINDING')); } finally { delete process.env[CREDENTIAL]; }
});

test('AC-17, AC-18: a stub campaign runs plan (b)\'s six runs through the runner, each receipt verified and read as not measured; a failed run stops the rest', async () => {
  const croot = fresh();
  const m = await RB.runCampaign({ campaignRoot: croot });
  assert.equal(m.report, '020'); assert.equal(m.stub, true); assert.equal(m.stop, null, JSON.stringify(m.outcomes));
  assert.ok(m.outcomes.every((o) => o.status === 'receipt'), JSON.stringify(m.outcomes));
  const plan = planB();
  for (const [i, o] of m.outcomes.entries()) {
    const a = plan.execution.attempts[i]; const r = json(path.join(croot, o.receipt));
    assert.equal(r.run.model_id, a.protocol.model); assert.equal(r.run.judge.model_id, HAIKU); assert.equal(r.run.judge.samples, 5);
    assert.equal(r.skill.content_hash, a.protocol.content_hash); assert.equal(r.verification_level, 'UNVERIFIED');
    // A stub receipt passed off as a measured one refuses.
    const passed = structuredClone(r); passed.run.answered_by = { ...passed.run.answered_by, kind: 'model' };
    assert.throws(() => RB.verifyReceipt({ plan }, a, passed, true), (e) => ['STUB_RECEIPT', 'RECEIPT_SEAL'].includes(e.code));
    // A paid reading of the stub receipt refuses: it is not TESTED on the subscription surface.
    assert.throws(() => RB.verifyReceipt({ plan }, a, r, false), (e) => ['RECEIPT_ELIGIBILITY', 'MODEL_BINDING'].includes(e.code));
  }
  const v = RB.verdicts({ campaignRoot: croot });
  assert.equal(v.rows.length, 3); assert.ok(v.rows.every((x) => x.verdict === 'not-measured' && x.label === 'not measured'));
  assert.equal(v.report_011, NOT_BESIDE_011); assert.deepEqual(v.effort, plan.effort); assert.equal(v.judge, HAIKU);
  // A second start continues the chain and runs nothing again.
  const again = await RB.runCampaign({ campaignRoot: croot, spawn: () => { throw Error('PROVIDER_CALL'); } });
  assert.ok(again.outcomes.every((o) => o.reason === 'PREVIOUS_RECEIPT'));
  // A failed run stops the campaign: the next runs are cancelled, not dispatched.
  let spawned = 0;
  const fail = await RB.runCampaign({ campaignRoot: fresh(), spawn: () => { spawned++; return { status: 1, stdout: '', stderr: 'planted failure' }; } });
  assert.equal(spawned, 1); assert.equal(fail.stop, 'RUN_FAILED'); assert.equal(fail.outcomes[0].reason, 'RUN_FAILED');
  assert.ok(fail.outcomes.slice(1).every((o) => o.reason === 'CANCELLED'));
  // A paid start without the plan's hash, or with an API credential, refuses before any run.
  delete process.env.DRIFTPROOF_STUB;
  try { await assert.rejects(RB.runCampaign({ campaignRoot: fresh(), execute: true, expectedPlan: 'f'.repeat(64) }), code('PLAN_BINDING')); } finally { process.env.DRIFTPROOF_STUB = '1'; }
  process.env[CREDENTIAL] = 'planted';
  try { await assert.rejects(RB.runCampaign({ campaignRoot: fresh(), spawn: () => { throw Error('PROVIDER_CALL'); } }), code('SURFACE_BINDING')); } finally { delete process.env[CREDENTIAL]; }
});

// ---- both plans --------------------------------------------------------------------------------------

test('AC-20, AC-21: one cost table, recomputed from both plans, inside the issue cap, with what is shared', () => {
  const a = planA(), b = planB(); const ps = json(path.join(DIR, 'prior-spend.json'));
  assert.deepEqual(ps.issue_cap, { budget_usd: 800, spent_usd: 0, remaining_usd: 800, source: 'operator, 10 Nov 2026' });
  assert.ok(a.cap_usd + b.cap_usd <= ps.issue_cap.remaining_usd);
  const r = node([path.join(DIR, 'build-cost.cjs'), '--check']); assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(DIR, 'cost.md'), 'utf8');
  for (const l of r.stdout.split('\n').filter((x) => x.startsWith('|'))) assert.ok(md.includes(l), 'the printed table is the committed one: ' + l);
  const money = (n) => n.toFixed(2);
  assert.ok(md.includes('| (a) placebo design on Fable 5.2 | 20 | 10800 | ' + money(a.totals.recorded_usd) + ' | ' + money(a.totals.maximum_usd) + ' | ' + money(a.totals.max_usd) + ' | ' + money(a.cap_usd) + ' |'));
  assert.ok(md.includes('| (b) release boundary, three skills | 6 | 720 | ' + money(b.totals.recorded_usd) + ' | ' + money(b.totals.maximum_usd) + ' | ' + money(b.totals.max_usd) + ' | ' + money(b.cap_usd) + ' |'));
  assert.ok(md.includes('| Total | 26 | 11520 | ' + money(a.totals.recorded_usd + b.totals.recorded_usd) + ' | ' + money(a.totals.maximum_usd + b.totals.maximum_usd) + ' | ' + money(a.totals.max_usd + b.totals.max_usd) + ' | ' + money(a.cap_usd + b.cap_usd) + ' |'));
  assert.match(md, /Metered spend on the claude-cli surface is USD 0/); assert.match(md, /is an estimate/);
  for (const s of ['Claude Code 2.1.311', 'no skill arm', 'no Fable 5.1 side', 'no placebo arm', 'no harness table', 'the same judge, claude-haiku-5-5 at 5 samples', 'one lock']) assert.ok(md.includes(s), s);
  assert.ok(md.includes('sha256 ' + sha256(fs.readFileSync(path.join(A, 'plan.json')))) && md.includes('sha256 ' + sha256(fs.readFileSync(path.join(B, 'plan.json')))), 'the table names both frozen plans');
  // A-783-3: the chain record (chains.json, written from each manifest's bytes) is what ran and what it
  // spent; cost.md shows it. The receipts are not in the tree, so the test reads the record, not the chains.
  const chains = json(path.join(DIR, 'chains.json'));
  const OLD_PLAN = '57eaf3cc30cb95b2ee0b23a90aced48311ac3f1cd898b8e7ed85acdac7b83aa9';
  const current = { placebo: sha256(fs.readFileSync(path.join(A, 'plan.json'))), boundary: sha256(fs.readFileSync(path.join(B, 'plan.json'))) };
  const report = { placebo: '019', boundary: '020' };
  const r6 = (n) => Math.round(n * 1e6) / 1e6;
  assert.deepEqual(chains.plans, current, 'the record names the current plans');
  for (const c of chains.chains) {
    // Each manifest names every earlier manifest of its chain as a prior, in order; spend is cumulative.
    c.manifests.forEach((m, i) => { assert.match(m.sha256, /^[0-9a-f]{64}$/); assert.deepEqual(m.priors, c.manifests.slice(0, i).map((x) => x.sha256), c.id + ' ' + m.campaign + ' priors'); });
    assert.equal(c.spend_usd, c.manifests.at(-1).cumulative_spend_usd, c.id);
    assert.equal(r6(c.manifests.reduce((n, m) => n + m.campaign_spend_usd, 0)), c.spend_usd, c.id + ' campaign spends sum to the chain');
    assert.ok(md.includes('| ' + c.id + ' | ' + c.plan_sha256.slice(0, 12) + ' | ' + c.status + ' | ' + (c.read_chain ? 'yes' : 'no') + ' | ' + c.manifests.length + ' | '), c.id + ' is in cost.md');
  }
  for (const [plan, rep] of Object.entries(report)) {
    const read = chains.chains.filter((c) => c.report === rep && c.read_chain);
    assert.equal(read.length, 1, 'one read chain for Report ' + rep); assert.equal(read[0].plan_sha256, current[plan], 'under the current plan'); assert.equal(read[0].status, 'complete');
  }
  const total = r6(chains.chains.reduce((n, c) => n + c.spend_usd, 0));
  assert.deepEqual(chains.spend, { total_usd: total, issue_cap_usd: ps.issue_cap.budget_usd, remaining_usd: r6(ps.issue_cap.budget_usd - total) });
  assert.ok(total <= ps.issue_cap.budget_usd, 'the issue spend fits its cap');
  assert.ok(md.includes('Spent: USD ' + total.toFixed(6) + '. Remaining: USD ' + r6(ps.issue_cap.budget_usd - total).toFixed(6) + '.'), 'cost.md states the spend and the remaining authority');
  const chain1 = chains.chains.find((c) => c.plan_sha256 === OLD_PLAN);
  assert.ok(chain1 && !chain1.read_chain && chain1.spend_usd === 4.518186, 'the stopped first chain is recorded, outside the read chain, with its spend');
  // A correction binds a manifest the record lists in the read chain of its plan, under that plan's current
  // sha256, for an attempt that failed in that manifest, with a cost and a note its sha256 binds.
  const readChain = (plan) => chains.chains.find((c) => c.report === report[plan] && c.read_chain && c.plan_sha256 === current[plan]);
  const correctionProblems = (corrections) => Object.entries(corrections).flatMap(([plan, list]) => (list || []).flatMap((c) => {
    const p = [], m = (readChain(plan)?.manifests || []).find((x) => x.sha256 === c.manifest_sha256);
    if (!m) p.push('not a manifest of the ' + plan + ' read chain');
    else if (!m.failed_attempts.some((f) => f.attempt_id === c.attempt_id)) p.push('not an attempt that failed in that manifest');
    if (c.plan_sha256 !== undefined && c.plan_sha256 !== current[plan]) p.push('names another plan');
    if (!Number.isFinite(c.cost_usd) || c.cost_usd < 0) p.push('no cost');
    if (typeof c.note !== 'string' || sha256(c.note) !== c.note_sha256) p.push('note not bound');
    return p.map((x) => plan + ' ' + String(c.manifest_sha256).slice(0, 12) + ': ' + x);
  }));
  assert.deepEqual(correctionProblems(ps.corrections), [], 'every recorded correction binds its plan\'s read chain');
  // Plants. Control: a correction for the failed attempt of the read chain's first manifest passes.
  const first = readChain('placebo').manifests[0], failed = first.failed_attempts[0];
  const valid = { manifest_sha256: first.sha256, attempt_id: failed.attempt_id, cost_usd: 1, note: 'synthetic', note_sha256: sha256('synthetic') };
  assert.deepEqual(correctionProblems({ placebo: [valid], boundary: [] }), [], 'control');
  const chain2 = chains.chains.find((c) => c.report === '019' && !c.read_chain && c.plan_sha256 === current.placebo);
  const stoppedSpend = chain1.manifests.find((x) => x.campaign_spend_usd > 0);
  for (const [why, c] of [
    ['chain 1\'s spend as a correction (another plan)', { ...valid, manifest_sha256: stoppedSpend.sha256, attempt_id: stoppedSpend.failed_attempts[0].attempt_id, cost_usd: stoppedSpend.campaign_spend_usd }],
    ['chain 1\'s first manifest (another plan)', { ...valid, manifest_sha256: chain1.manifests[0].sha256 }],
    ['chain 2\'s manifest (the same plan, not the read chain)', { ...valid, manifest_sha256: chain2.manifests[0].sha256, attempt_id: chain2.manifests[0].failed_attempts[0].attempt_id }],
    ['an unlisted manifest', { ...valid, manifest_sha256: 'd'.repeat(64) }],
    ['a note edited after its hash', { ...valid, note: 'synthetic, edited' }],
    ['a correction naming the old plan', { ...valid, plan_sha256: OLD_PLAN }],
    ['an attempt that did not fail in that manifest', { ...valid, attempt_id: a.execution.attempts.find((x) => !first.failed_attempts.some((f) => f.attempt_id === x.attempt_id)).attempt_id }],
    ['a plan (a) manifest filed under plan (b)', null],
  ]) assert.notDeepEqual(c ? correctionProblems({ placebo: [c], boundary: [] }) : correctionProblems({ placebo: [], boundary: [valid] }), [], why);
});

test('AC-7: every builder is offline, and no campaign root exists for either plan', () => {
  for (const builder of [path.join(A, 'build-plan.cjs'), path.join(B, 'build-plan.cjs')]) {
    const b = JSON.stringify(builder);
    const control = node(['-e', 'require(' + b + ').buildPlan();console.log("built")']);
    assert.equal(control.status, 0, control.stderr); assert.equal(control.stdout.trim(), 'built');
    for (const plant of [
      "require('" + ROOT + "/lib/cost').estimateRunCostUSD=()=>require('" + ROOT + "/lib/provider').complete({})",
      "require('" + ROOT + "/lib/cost').estimateRunCostUSD=()=>require('node:child_process').spawnSync('forbidden')",
      "require('" + ROOT + "/lib/cost').estimateRunCostUSD=()=>fetch('https://example.invalid')",
    ]) {
      const r = node(['-e', plant + ';try{require(' + b + ').buildPlan();process.exitCode=2;}catch(e){if(e.code!==\'PROVIDER_CALL\')throw e;console.log(e.code);}']);
      assert.equal(r.status, 0, plant + ': ' + r.stderr); assert.equal(r.stdout.trim(), 'PROVIDER_CALL', plant);
    }
  }
  // A-783-1: a campaign root may exist under receipts/ once a run starts. The build committed no receipt
  // bytes before a run, and a root that holds a plan holds its plan's frozen bytes.
  const tracked = spawnSync('git', ['ls-files', '--', 'receipts/report-019*', 'receipts/report-020*'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(tracked.status, 0, tracked.stderr); assert.equal(tracked.stdout, '', 'no file under a Report 019 or 020 campaign root is tracked');
  const frozen = { 'report-019': fs.readFileSync(path.join(A, 'plan.json')), 'report-020': fs.readFileSync(path.join(B, 'plan.json')) };
  const rootsHold = (receipts) => {
    for (const name of fs.readdirSync(receipts).filter((n) => /^report-0(19|20)/.test(n))) {
      const plan = path.join(receipts, name, 'plan.json'), want = frozen[name.slice(0, 10)];
      assert.ok(fs.statSync(path.join(receipts, name)).isDirectory(), name + ' is a campaign root');
      if (fs.existsSync(plan)) assert.ok(want && fs.readFileSync(plan).equals(want), name + ' holds its frozen plan');
    }
  };
  rootsHold(path.join(ROOT, 'receipts'));
  // Plant: a root holding another plan's bytes.
  const plantRoot = fresh(); fs.mkdirSync(path.join(plantRoot, 'report-019'));
  fs.writeFileSync(path.join(plantRoot, 'report-019/plan.json'), frozen['report-020']);
  assert.throws(() => rootsHold(plantRoot), /holds its frozen plan/);
});
