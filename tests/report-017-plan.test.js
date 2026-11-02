// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 613: Report 017's frozen plan, its campaign driver and its pre-registered headline. No model is
// called: every run is the stub, and every plant is written under a temporary root, never the tree.
process.env.DRIFTPROOF_STUB = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'specs/613-placebo-skills-report');
const P = require(path.join(DIR, 'protocol.cjs'));
const C = require(path.join(ROOT, 'specs/408-skill-measurements/campaign.cjs'));
const { sha256 } = require(path.join(ROOT, 'lib/canonical'));
const { suiteIdentity } = require(path.join(ROOT, 'lib/skill'));
const { sealReceipt } = require(path.join(ROOT, 'lib/receipt'));
const { perCallCostUSD } = require(path.join(ROOT, 'lib/cost'));
const { fakeToolCallCounts } = require(path.join(ROOT, 'lib/text-capture'));
const { runSkillOnModel } = require(path.join(ROOT, 'lib/run'));
const { placeboReading, receiptVerdict, PLACEBO_WORDS } = require(path.join(ROOT, 'lib/verdict'));
const R = require(path.join(DIR, 'run-campaign.cjs'));
const { readPlan, runCampaign, verifyPlaceboOutcome, preflight, readChain } = R;
const { summarizeReceipt } = require(path.join(ROOT, 'lib/run'));
const { publication, RECORDED_HEADS } = require(path.join(DIR, 'publication.cjs'));
const { plainOf } = require(path.join(ROOT, 'lib/plain'));
const T = require(path.join(DIR, 'tally.cjs'));

const SETTINGS = { permissions: { deny: ['Read', 'WebFetch', 'WebSearch'] }, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, autoMemoryEnabled: false, disableClaudeAiConnectors: true };
const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DRIFTPROOF_STUB: '1', TMPDIR: '/var/tmp' }, timeout: 600000 });
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const code = (c) => (e) => e.code === c;
// A new campaign root, and the manifest its log names last.
const fresh = () => fs.mkdtempSync('/var/tmp/report017-root-');
const headOf = (croot) => path.join(croot, R.readLog(croot).at(-1).manifest);
// A fixture root is not a git repository. Its recorded head is a snapshot of the pinned files, the
// plan and the note, taken the first time it is read, served as git would serve that commit.
const FIXTURE_HEAD = 'f'.repeat(40);
function codeAt(f) {
  if (!f.snapshot) { f.snapshot = new Map(); for (const file of [...Object.keys(f.plan.runner_hashes), P.SPEC + '/plan.json', P.SPEC + '/outcomes.md']) f.snapshot.set(file, fs.readFileSync(path.join(f.root, file))); }
  return { head: () => FIXTURE_HEAD, isAncestor: (h) => h === FIXTURE_HEAD, show: (h, file) => (h === FIXTURE_HEAD && f.snapshot.has(file) ? f.snapshot.get(file) : null) };
}
const pubAt = (f, opts) => publication({ root: f.root, stub: true, recordedHeads: { [sha256(f.bytes)]: FIXTURE_HEAD }, reader: codeAt(f), ...opts });

// A temporary copy of every input the plan reads, with clearly synthetic skill texts in place of the
// pinned ones (the pinned SKILL.md bytes are not in the repository), and the plan rebuilt over it.
const textFor = (skill, extra = {}) => '---\nname: ' + skill + '\n---\nSynthetic test instructions for ' + skill + ' only. No provider call.\n' + (extra[skill] || '');
function fixture(extra = {}) {
  const root = fs.mkdtempSync('/var/tmp/report017-fixture-');
  const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.cpSync(path.join(ROOT, rel), path.join(root, rel), { recursive: true }); };
  copy(P.SOURCE); copy(P.SPEC); for (const f of P.RUNNER_FILES) copy(f);
  const at = path.join(root, P.SOURCE);
  const plan = json(path.join(at, 'plan.json')); const sources = json(path.join(at, 'sources.json'));
  for (const a of plan.execution.attempts.slice(0, 20)) {
    const p = a.protocol; const s = sources.find((x) => x.repository === p.repository && x.skill === p.skill);
    const text = textFor(p.skill, extra);
    const old = s.skill_sha256; s.skill_sha256 = sha256(text);
    const raw = fs.readFileSync(path.join(at, s.suite), 'utf8').replaceAll(old, s.skill_sha256); fs.writeFileSync(path.join(at, s.suite), raw);
    const evals = sha256(raw); const hash = suiteIdentity(JSON.parse(raw)).suiteHash;
    for (const list of ['plain', 'capped']) for (const r of plan[list].rows) if (r.suite === s.suite) { r.evals_sha256 = evals; r.suite_hash = hash; }
    for (const x of plan.execution.attempts) if (x.protocol.repository === p.repository && x.protocol.skill === p.skill) { x.protocol.evals_sha256 = evals; x.protocol.suite_hash = hash; x.attempt_id = sha256(JSON.stringify(x.protocol)); }
  }
  fs.writeFileSync(path.join(at, 'sources.json'), JSON.stringify(sources));
  fs.writeFileSync(path.join(at, 'plan.json'), JSON.stringify(plan));
  const planFile = path.join(root, P.SPEC, 'plan.json');
  const built = node(['-e', 'const B=require(process.argv[1]);require("node:fs").writeFileSync(process.argv[3],JSON.stringify(B.buildPlan({root:process.argv[2]}),null,2)+"\\n")', path.join(DIR, 'build-plan.cjs'), root, planFile]);
  assert.equal(built.status, 0, built.stderr);
  const inputs = path.join(root, 'inputs'); fs.mkdirSync(inputs);
  const frozen = json(planFile);
  for (const a of frozen.execution.attempts) fs.writeFileSync(path.join(inputs, a.attempt_id + '.md'), textFor(a.protocol.skill, extra));
  const home = path.join(root, 'eval'); fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify(SETTINGS));
  return { root, inputs, home, planFile, plan: frozen, bytes: fs.readFileSync(planFile) };
}
// Write a changed plan under the temporary root, read it, put the plan back.
function readsAs(f, mutate, reason, why) {
  const plan = JSON.parse(f.bytes); mutate(plan);
  fs.writeFileSync(f.planFile, JSON.stringify(plan, null, 2) + '\n');
  try { assert.throws(() => readPlan(f.root), code(reason), why); } finally { fs.writeFileSync(f.planFile, f.bytes); }
}
const reid = (a) => { a.attempt_id = sha256(JSON.stringify(a.protocol)); };

test('AC-1, AC-9: build-plan --check reproduces plan.json and prints the projection table, both methods', () => {
  const r = node([path.join(DIR, 'build-plan.cjs'), '--check']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| Planned calls \| Usage profile USD \| Fixed-token reference USD \| Sum of max_usd \| Cap \|$/m);
  assert.equal(r.stdout.split('\n').filter((l) => /^\| \d+ \| /.test(l)).length, 21, '20 attempt rows and the total row are printed');
  assert.match(r.stdout, /report 017 plan: 20 attempts; 10800 planned calls; .*no spend; current( \(historical: the frozen plan of receipts\/[a-z0-9-]+; not rebuilt from the live tree\))?$/m);
  const md = fs.readFileSync(path.join(DIR, 'projection.md'), 'utf8');
  for (const l of r.stdout.split('\n').filter((x) => x.startsWith('|'))) assert.ok(md.includes(l), 'the printed table is the committed one: ' + l);
  // A-613-3: the committed plan is receipts/report-017c's frozen plan, so --check reads it as historical.
  assert.match(r.stdout, /historical: the frozen plan of receipts\/report-017c/);
  assert.ok(fs.readFileSync(path.join(DIR, 'plan.json')).equals(fs.readFileSync(path.join(ROOT, 'receipts/report-017c/plan.json'))));
});

// The builder's check, in a child (it installs the offline guard), over a fixture root.
const checkAt = (root) => node(['-e', 'try{const r=require(process.argv[1]).check(process.argv[2]);console.log(r.historical?"historical "+r.historical:"rebuilt")}catch(e){console.log(e.message)}', path.join(DIR, 'build-plan.cjs'), root]).stdout.trim();
function finish(f) {
  // A finished root: the frozen plan, its log and a manifest holding a sealed receipt.
  const at = path.join(f.root, 'receipts/report-017x'); fs.mkdirSync(path.join(at, 'campaign-1'), { recursive: true });
  fs.copyFileSync(f.planFile, path.join(at, 'plan.json')); fs.writeFileSync(path.join(at, 'campaign.log'), JSON.stringify({ plan_sha256: sha256(f.bytes), manifest: 'campaign-1/manifest.json', priors: [] }) + '\n');
  fs.writeFileSync(path.join(at, 'campaign-1/manifest.json'), JSON.stringify({ outcomes: [{ attempt_id: f.plan.execution.attempts[0].attempt_id, status: 'receipt' }] }));
}
test('A-613-3: --check rebuilds the plan before a paid run and reads it as historical after one', () => {
  const f = fixture(); const run = path.join(f.root, 'lib/run.js'); const live = fs.readFileSync(run);
  const table = node(['-e', 'const B=require(process.argv[1]);require("node:fs").writeFileSync(process.argv[3],B.render(JSON.parse(require("node:fs").readFileSync(process.argv[2]))))', path.join(DIR, 'build-plan.cjs'), f.planFile, path.join(f.root, P.SPEC, 'projection.md')]);
  assert.equal(table.status, 0, table.stderr);
  assert.equal(checkAt(f.root), 'rebuilt', 'control: before a run the plan rebuilds from the live tree');
  fs.appendFileSync(run, '\n');
  assert.equal(checkAt(f.root), 'STALE_GENERATED: plan.json', 'before a run, a moved live tree makes the plan stale');
  finish(f);
  assert.equal(checkAt(f.root), 'historical receipts/report-017x', 'after a run, a moved live tree moves nothing');
  fs.writeFileSync(run, live);
  const md = path.join(f.root, P.SPEC, 'projection.md'); fs.appendFileSync(md, '\n');
  assert.equal(checkAt(f.root), 'STALE_GENERATED: projection.md', 'after a run, the table must still render from the frozen plan');
});

test('AC-1 to AC-4: the frozen plan is Report 015\'s twenty, in order, with its pins, Sonnet 5.5, Haiku 5.5 and three arms', () => {
  // Independent oracle: read spec 408's frozen roster and source pins directly.
  const plan = json(path.join(DIR, 'plan.json'));
  const source = json(path.join(ROOT, P.SOURCE, 'plan.json')); const sources = json(path.join(ROOT, P.SOURCE, 'sources.json'));
  const roster = source.execution.attempts.slice(0, 20);
  assert.ok(roster.every((a) => a.protocol.model_option === 'option_1'));
  assert.equal(plan.plan_version, 2); assert.equal(plan.execution.attempts.length, 20);
  assert.equal(plan.model, 'claude-sonnet-5-5'); assert.equal(plan.judge, 'claude-haiku-5-5'); assert.equal(plan.samples, 5);
  assert.deepEqual(plan.draws, { min: 3, max: 10 }); assert.equal(plan.capture, 'text'); assert.equal(plan.arms, 3); assert.equal(plan.cap_usd, 400);
  assert.equal(plan.placebo.corpus_hash, '817668a2a4fdd95353cbcc95927d177bd8764ac4d8473bf30dd72630074fa72e');
  for (const [i, a] of plan.execution.attempts.entries()) {
    const s = roster[i].protocol; const pin = sources.find((x) => x.repository === s.repository && x.skill === s.skill);
    for (const k of ['repository', 'skill', 'skill_path', 'commit', 'evals_sha256', 'suite_hash']) assert.equal(a.protocol[k], s[k], k + ' of rank ' + (i + 1));
    assert.equal(a.protocol.skill_sha256, pin.skill_sha256);
    assert.equal(a.protocol.model, 'claude-sonnet-5-5'); assert.equal(a.protocol.judge, 'claude-haiku-5-5'); assert.equal(a.protocol.arms, 3); assert.equal(a.protocol.ordinal, i + 1);
    assert.equal(a.attempt_id, sha256(JSON.stringify(a.protocol)));
    const row = plan.rows[i];
    assert.equal(row.planned_calls, 3 * 3 * 10 * (1 + 5)); assert.equal(row.report_015_attempt_id, roster[i].attempt_id);
    assert.equal(row.max_usd, Math.round(source.plain.rows[i].options.option_1.estimated_usd * 1.5 * 1e4) / 1e4);
    assert.equal(row.router, ['find-skills', 'agent-browser', 'hyperframes', 'hyperframes-registry'].includes(s.skill));
  }
  assert.equal(plan.totals.planned_calls, 10800); assert.ok(plan.totals.max_usd <= plan.cap_usd);
  // A-613-3: before a run the live tree must hold the pins; independently computed here, the live
  // read passes exactly when every pinned byte is the live byte, and refuses RUNNER_BINDING otherwise.
  const { configAtVersion } = require(path.join(ROOT, P.SOURCE, 'version-binding.cjs'));
  const live = Object.entries(plan.runner_hashes).every(([file, h]) => { const b = fs.readFileSync(path.join(ROOT, file)); return sha256(file === 'config.js' ? configAtVersion(b, plan.runner_version) : b) === h; });
  if (live) assert.doesNotThrow(() => readPlan()); else assert.throws(() => readPlan(), code('RUNNER_BINDING'), 'a moved live tree refuses a run');
  // After the run the plan reads as receipts/report-017c froze it, its pins at the recorded head.
  const ctx = readPlan(ROOT, { frozen: path.join(ROOT, 'receipts/report-017c') });
  assert.equal(ctx.plan_hash, sha256(fs.readFileSync(path.join(DIR, 'plan.json'))));
  assert.equal(R.pinsAtHead(ctx, RECORDED_HEADS[ctx.plan_hash], R.gitReader(ROOT)), 'judge-code-99b2456256e5a440', 'the pins hold at 3ef94167e, whose judging code the receipts record');
});

test('AC-2 to AC-5: a changed pin, model, judge, arms count or order refuses with its binding', () => {
  const f = fixture();
  assert.doesNotThrow(() => readPlan(f.root), 'control: the fixture plan reads');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.skill_sha256 = '0'.repeat(64); reid(p.execution.attempts[3]); p.rows[3].attempt_id = p.execution.attempts[3].attempt_id; }, 'SKILL_BYTES', 'one skill_sha256');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.suite_hash = '0'.repeat(64); reid(p.execution.attempts[3]); p.rows[3].attempt_id = p.execution.attempts[3].attempt_id; }, 'SUITE_BINDING', 'one suite hash');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.evals_sha256 = '0'.repeat(64); reid(p.execution.attempts[3]); p.rows[3].attempt_id = p.execution.attempts[3].attempt_id; }, 'SUITE_BINDING', 'one suite byte hash');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.model = 'claude-opus-5-5'; reid(p.execution.attempts[3]); p.rows[3].attempt_id = p.execution.attempts[3].attempt_id; }, 'PLAN_BINDING', 'one attempt model');
  readsAs(f, (p) => { p.model = 'claude-opus-5-5'; }, 'PLAN_BINDING', 'the plan model');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.judge = 'claude-haiku-4-5'; reid(p.execution.attempts[3]); p.rows[3].attempt_id = p.execution.attempts[3].attempt_id; }, 'PLAN_BINDING', 'one attempt judge');
  readsAs(f, (p) => { p.judge = 'claude-haiku-4-5'; }, 'PLAN_BINDING', 'the plan judge');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.arms = 2; reid(p.execution.attempts[3]); p.rows[3].attempt_id = p.execution.attempts[3].attempt_id; }, 'PLAN_BINDING', 'one attempt arms count');
  readsAs(f, (p) => { p.arms = 2; }, 'PLAN_BINDING', 'the plan arms count');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.placebo_corpus_hash = '0'.repeat(64); reid(p.execution.attempts[3]); p.rows[3].attempt_id = p.execution.attempts[3].attempt_id; }, 'PLAN_BINDING', 'the placebo corpus');
  readsAs(f, (p) => {
    const [a, b] = p.execution.attempts; a.protocol.ordinal = 2; b.protocol.ordinal = 1; reid(a); reid(b);
    p.execution.attempts = [b, a, ...p.execution.attempts.slice(2)]; p.rows = [{ ...p.rows[1], rank: 1 }, { ...p.rows[0], rank: 2 }, ...p.rows.slice(2)];
  }, 'PLAN_BINDING', 'two attempts swapped');
  readsAs(f, (p) => { p.execution.attempts[3].attempt_id = '0'.repeat(64); }, 'PLAN_BINDING', 'an attempt id that is not its protocol');
  readsAs(f, (p) => { p.rows[3].max_usd = 50; }, 'PLAN_BINDING', 'a raised attempt ceiling');
  readsAs(f, (p) => { p.cap_usd = 4000; }, 'PLAN_BINDING', 'a raised cap');
  readsAs(f, (p) => { p.rows[0].router = false; }, 'PLAN_BINDING', 'a router counted');
  assert.doesNotThrow(() => readPlan(f.root), 'control: the restored plan reads');
  // The bytes the plan points at, each changed in place and put back.
  const suite = path.join(f.root, P.SOURCE, 'suites/mattpocock--skills--tdd.json'); const before = fs.readFileSync(suite);
  fs.writeFileSync(suite, Buffer.concat([before, Buffer.from(' ')])); assert.throws(() => readPlan(f.root), code('SUITE_BINDING'), 'a suite byte'); fs.writeFileSync(suite, before);
  const run = path.join(f.root, 'lib/run.js'); const live = fs.readFileSync(run);
  fs.writeFileSync(run, Buffer.concat([live, Buffer.from('\n')])); assert.throws(() => readPlan(f.root), code('RUNNER_BINDING'), 'a runner byte'); fs.writeFileSync(run, live);
  const note = path.join(f.root, P.SPEC, 'outcomes.md'); const text = fs.readFileSync(note);
  fs.writeFileSync(note, text.toString().replace('some: {A} of {N}', 'some: {A} of {N} or more')); assert.throws(() => readPlan(f.root), code('OUTCOMES_BINDING'), 'a headline template'); fs.writeFileSync(note, text);
  assert.doesNotThrow(() => readPlan(f.root), 'control: the restored inputs read');
});

test('AC-11: estimation is offline; a provider, process or network call fails PROVIDER_CALL', () => {
  const builder = JSON.stringify(path.join(DIR, 'build-plan.cjs'));
  const control = node(['-e', 'const B=require(' + builder + ');B.buildPlan();console.log("built")']);
  assert.equal(control.status, 0, control.stderr); assert.equal(control.stdout.trim(), 'built');
  const plants = [
    "require('../../lib/cost').estimateRunCostUSD=()=>require('../../lib/provider').complete({})",
    "require('../../lib/cost').estimateRunCostUSD=()=>require('node:child_process').spawnSync('forbidden')",
    "require('../../lib/cost').estimateRunCostUSD=()=>fetch('https://example.invalid')",
  ];
  for (const plant of plants) {
    // The plant is made before the builder loads, so the builder's own import reads the planted function.
    const script = 'process.chdir(' + JSON.stringify(DIR) + ');' + plant.replaceAll("'../../lib/", "'" + ROOT + "/lib/") + ';try{require(' + builder + ').buildPlan();process.exitCode=2;}catch(e){if(e.code!==\'PROVIDER_CALL\')throw e;console.log(e.code);}';
    const r = node(['-e', script]);
    assert.equal(r.status, 0, plant + ': ' + r.stderr); assert.equal(r.stdout.trim(), 'PROVIDER_CALL', plant);
  }
});

test('AC-6, AC-7, AC-10: a stub campaign writes 20 placebo stub receipts, each with rows and block, each NOT_MEASURED', async () => {
  const f = fixture(); const croot = fresh();
  const seen = [];
  const m = await runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home, adapters: { run: (args) => { seen.push(args.opts); return runSkillOnModel(args); } } });
  const out = path.dirname(headOf(croot));
  assert.equal(path.dirname(out), croot, 'the campaign directory sits in the campaign root');
  assert.equal(sha256(fs.readFileSync(path.join(croot, 'plan.json'))), m.plan_sha256, 'the root keeps the plan as started');
  assert.equal(m.outcomes.length, 20); assert.equal(m.stub, true); assert.equal(m.plan_sha256, sha256(f.bytes));
  assert.deepEqual(m.outcomes.map((o) => o.status), Array(20).fill('receipt'), JSON.stringify(m.outcomes.filter((o) => o.status !== 'receipt').map((o) => o.reason)));
  assert.equal(seen.length, 20);
  for (const o of seen) {
    assert.equal(o.placebo, true); assert.equal(o.maxCalls, 540); assert.equal(o.samples, 5); assert.equal(o.judgeModel, 'claude-haiku-5-5'); assert.equal(o.capture, 'text');
    for (const k of ['preset', 'onlyArm', 'taskIds', 'maxCases', 'draws']) assert.equal(o[k], undefined, k + ' is never set');
  }
  const readings = new Map();
  for (const [i, o] of m.outcomes.entries()) {
    const r = json(path.join(out, o.attempt_id + '.json'));
    assert.equal(r.receipt_hash, o.receipt_hash); assert.equal(r.verification_level, 'UNVERIFIED');
    assert.equal(r.run.model_id, 'claude-sonnet-5-5'); assert.equal(r.run.judge.model_id, 'claude-haiku-5-5');
    assert.equal(r.results.cases.filter((c) => c.mode === 'placebo').length, 3, 'three placebo rows');
    assert.ok(r.placebo && r.placebo.bytes === r.placebo.skill_bytes && r.placebo.corpus_hash === f.plan.placebo.corpus_hash, 'the block');
    assert.equal(r.results.cases[0].generation.issue408.attempt_id, f.plan.execution.attempts[i].attempt_id);
    const p = placeboReading(r); assert.equal(p.reading, 'NOT_MEASURED'); assert.ok(p.notMeasured.includes('below_tested'));
    assert.equal(receiptVerdict(r).verdict, 'NOT_MEASURED');
    readings.set(o.attempt_id, T.readingsOf(r).placebo);
  }
  // Stub readings are never a result: the headline is the not-read shape, out of 16.
  const t = T.tally(f.plan, readings); assert.equal(t.shape, 'not_read'); assert.equal(t.M, 16); assert.equal(t.A, 0);
  assert.equal(T.headline(t, T.readOutcomes(f.plan, f.root))[0], '16 of 16 skills were not measured against the same-length placebo, and 0 of 16 beat the fake by the case rule. A skill that was not measured has no result.');
});

test('AC-2, AC-6, AC-20: the preflight refuses changed or missing skill bytes before any call; a run without the arm keeps nothing', async () => {
  const f = fixture(); let runs = 0;
  const counting = { run: (args) => { runs++; return runSkillOnModel(args); } };
  const first = path.join(f.inputs, f.plan.execution.attempts[0].attempt_id + '.md');
  const ctx = readPlan(f.root);
  assert.equal(preflight(ctx, f.inputs).problem, null, 'control: every fixture input is ready');
  fs.appendFileSync(first, 'x');
  assert.equal(preflight(ctx, f.inputs).rows[0].status, 'SKILL_BYTES');
  const out = fresh();
  await assert.rejects(runCampaign({ root: f.root, campaignRoot: out, inputs: f.inputs, evalHome: f.home, adapters: counting }), code('SKILL_BYTES'));
  assert.equal(runs, 0); assert.deepEqual(fs.readdirSync(out), [], 'no manifest, no log, no receipt');
  fs.writeFileSync(first, fs.readFileSync(first, 'utf8').slice(0, -1));
  const third = path.join(f.inputs, f.plan.execution.attempts[2].attempt_id + '.md'); const kept = fs.readFileSync(third); fs.unlinkSync(third);
  assert.equal(preflight(ctx, f.inputs).rows[2].status, 'INPUT_MISSING');
  await assert.rejects(runCampaign({ root: f.root, campaignRoot: out, inputs: f.inputs, evalHome: f.home, adapters: counting }), code('INPUT_MISSING')); assert.equal(runs, 0);
  fs.writeFileSync(third, kept);
  // Pinned bytes that repeat the placebo's opening sentence are refused by the preflight.
  const opening = require(path.join(ROOT, 'lib/placebo')).PLACEBO_OPENING;
  const g = fixture({ tdd: opening + '\n' });
  const check = preflight(readPlan(g.root), g.inputs);
  assert.equal(check.problem, 'PLACEBO_OVERLAP'); assert.equal(check.rows.filter((r) => r.status !== 'ok').map((r) => r.skill).join(), 'tdd');
  // A-613-3: a moved live tree refuses the preflight and a start, before any call.
  const moved = path.join(f.root, 'lib/receipt.js'); const kept2 = fs.readFileSync(moved); fs.appendFileSync(moved, '\n');
  assert.throws(() => preflight(readPlan(f.root), f.inputs), code('RUNNER_BINDING'));
  await assert.rejects(runCampaign({ root: f.root, campaignRoot: fresh(), inputs: f.inputs, evalHome: f.home, adapters: counting }), code('RUNNER_BINDING')); assert.equal(runs, 0);
  fs.writeFileSync(moved, kept2);
  const cli = node([path.join(DIR, 'preflight.cjs'), '--inputs', f.inputs]);
  assert.equal(cli.status, 1, 'the real tree has no pinned inputs here: the CLI refuses'); assert.match(cli.stdout, /report 017 preflight: \d+\/20 inputs ready; refused: [A-Z_]+; no call made/);
  const dropped = await runCampaign({ root: f.root, campaignRoot: fresh(), inputs: f.inputs, evalHome: f.home, adapters: { run: (args) => runSkillOnModel({ ...args, opts: { ...args.opts, placebo: false } }) } });
  assert.equal(dropped.outcomes[0].reason, 'PLACEBO_ARM', 'a two-arm receipt is never kept');
});

test('AC-8: an attempt stops at its ceiling with its observed cost recorded', async () => {
  const f = fixture(); const model = 'claude-sonnet-5-5';
  const run = (input) => async ({ opts }) => {
    for (let k = 0; k < 2; k++) {
      opts.onProgress({ phase: 'generate', mode: 'with_skill', case: 'x', draw: k });
      opts.onReply({ phase: 'generate', case: 'x', mode: 'with_skill', draw: k, reply: { answeredBy: 'stub', usage: { input_tokens: input, output_tokens: 0 } } });
      opts.budget.add(perCallCostUSD(model, 'gen_with_skill'));
    }
    throw Object.assign(Error('PLANTED_END'), { code: 'PLANTED_END' });
  };
  const control = await runCampaign({ root: f.root, campaignRoot: fresh(), inputs: f.inputs, evalHome: f.home, adapters: { run: run(1000) } });
  assert.equal(control.outcomes[0].reason, 'PLANTED_END', 'control: a cheap attempt passes the ceiling check');
  // 2,000,000 input tokens at twice USD 2 per million is USD 8 a call: the second call passes 12.8708.
  const m = await runCampaign({ root: f.root, campaignRoot: fresh(), inputs: f.inputs, evalHome: f.home, adapters: { run: run(2000000) } });
  assert.equal(m.outcomes[0].reason, 'ATTEMPT_MAX_USD'); assert.equal(m.outcomes[0].cost_usd, 16); assert.equal(m.outcomes[0].cost_complete, true);
  assert.equal(m.outcomes[0].calls.length, 2); assert.ok(m.outcomes.slice(1).every((o) => o.reason === 'CANCELLED'));
});

// A clearly synthetic model-shaped receipt from the stub, as spec 408's campaign tests build one,
// confined to a temporary root: the paid path's verifier reads all three arms.
async function modelShaped(f) {
  const ctx = readPlan(f.root); const a = ctx.plan.execution.attempts[1];
  const skill = C.loadSubject(ctx, a, f.inputs);
  const result = await runSkillOnModel({ skill, model: a.protocol.model, opts: { placebo: true, judgeModel: a.protocol.judge, samples: 5, maxCalls: 540, keepTranscripts: true, capture: 'text' } });
  const r = result.receipt; r.verification_level = 'TESTED'; r.run.surface = 'claude-cli'; r.run.harness = { name: 'claude', version: 'synthetic-fixture' };
  r.run.answered_by = { kind: 'model', attested: true, reported_model: a.protocol.model, reported_models: [a.protocol.model], isolation: 'eval-user' };
  r.run.judge.surface = 'claude-cli'; r.run.judge.harness = { name: 'claude', version: 'synthetic-fixture' }; r.run.judge.isolation = 'eval-user'; r.run.judge.reported_models = [a.protocol.judge]; r.run.judge.endpoint.resolved_by = 'cli';
  for (const c of r.results.cases) for (const d of c.generation.draws) d.reported_model = a.protocol.model;
  const audit = { ...require(path.join(ROOT, 'specs/408-skill-measurements/eval-audit.cjs')).auditDirectory(f.home, {}, []), isolation: 'eval-user', checked_at: new Date().toISOString() };
  return { ctx, a, record: C.annotate(ctx, a, result, audit) };
}
test('AC-6, AC-12: the paid path verifies every arm of a placebo receipt and refuses a planted one', async () => {
  const f = fixture(); const { ctx, a, record } = await modelShaped(f);
  const v = verifyPlaceboOutcome(ctx, a, record.receipt, record.answers);
  const draws = (mode) => record.receipt.results.cases.filter((c) => c.mode === mode).reduce((n, c) => n + c.generation.draws.length, 0);
  assert.equal(v.skill.generations, draws('with_skill') + draws('baseline'), 'the skill view reads the with-skill and baseline draws');
  assert.equal(v.placebo.generations, draws('with_skill') + draws('placebo'), 'the placebo view reads the with-skill and placebo draws');
  const swap = (r) => { const at = r.results.cases.findIndex((c) => c.mode === 'placebo'); const c = r.results.cases; [c[at], c[at - 1]] = [c[at - 1], c[at]]; };
  const plants = [
    ['the arm dropped, block and rows', 'PLACEBO_ARM', (r) => { delete r.placebo; r.results.cases = r.results.cases.filter((c) => c.mode !== 'placebo'); r.results.fake_tool_calls = fakeToolCallCounts(r); }, true],
    ['the block\'s delta', 'PLACEBO_ARM', (r) => { r.placebo.comparison.delta += 0.1; }, true],
    ['a placebo row dropped', 'RECEIPT_SCHEMA', (r) => { r.results.cases = r.results.cases.filter((c, i) => !(c.mode === 'placebo' && i === 2)); }, true],
    ['a placebo row out of its case order', 'ACTUAL_COUNTS', swap, true],
    ['the block edited, unsealed', 'RECEIPT_SEAL', (r) => { r.placebo.bytes += 1; }, false],
  ];
  for (const [what, reason, mutate, reseal] of plants) {
    const r = structuredClone(record.receipt); const answers = structuredClone(record.answers); mutate(r);
    if (reseal) { sealReceipt(r); answers.receipt_hash = r.receipt_hash; }
    assert.throws(() => verifyPlaceboOutcome(ctx, a, r, answers), code(reason), what);
  }
  const tampered = structuredClone(record.answers); const at = tampered.draws.findIndex((d) => d.mode === 'placebo'); tampered.draws[at].judge_outputs[0] += ' tampered';
  assert.throws(() => verifyPlaceboOutcome(ctx, a, record.receipt, tampered), code('RECEIPT_EVIDENCE'), 'a placebo judge output');
});

test('AC-13, AC-14: the headline counts ABOVE_PLACEBO only, out of the 16 non-routers, in the frozen templates', () => {
  const plan = json(path.join(DIR, 'plan.json')); const templates = T.readOutcomes(plan);
  const ids = plan.rows.filter((r) => !r.router).map((r) => r.attempt_id); const routers = plan.rows.filter((r) => r.router).map((r) => r.attempt_id);
  assert.equal(ids.length, 16); assert.deepEqual(plan.rows.filter((r) => r.router).map((r) => r.skill), ['find-skills', 'agent-browser', 'hyperframes', 'hyperframes-registry']);
  const of = (tokens, routerToken) => new Map([...ids.map((id, i) => [id, tokens[i]]), ...routers.map((id) => [id, routerToken])].filter(([, t]) => t));
  const fill = (n, t) => Array(n).fill(t);
  const rule = 'by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none.';
  const notShown = ' A skill that did not beat the fake is not shown to do no better than it.';
  const many = (u, a) => u + ' of 16 skills read UNDERPOWERED against the same-length placebo, and ' + a + ' of 16 beat the fake by the case rule. Each receipt\'s own line says whether more draws or more cases are needed.' + notShown;
  const none = 'None of the 16 skills beat the fake: none met the case rule (above the same-length placebo on at least one of three tasks and below it on none).' + notShown;
  assert.ok(!templates.none.includes('none scored above'), 'the none line never reads as no skill scoring above the placebo on any task');
  const cases = [
    [fill(16, 'ABOVE_PLACEBO'), 'NOT_MEASURED', 'all', 'All 16 skills beat the fake: ' + rule],
    [fill(16, 'NO_DIFFERENCE'), 'ABOVE_PLACEBO', 'none', none],
    [[...fill(8, 'ABOVE_PLACEBO')], 'ABOVE_PLACEBO', 'not_read', '8 of 16 skills were not measured against the same-length placebo, and 8 of 16 beat the fake by the case rule. A skill that was not measured has no result.'],
    [[...fill(8, 'UNDERPOWERED'), ...fill(3, 'ABOVE_PLACEBO'), ...fill(5, 'NO_DIFFERENCE')], null, 'many_underpowered', many(8, 3)],
    [[...fill(7, 'UNDERPOWERED'), ...fill(9, 'INCONCLUSIVE')], 'ABOVE_PLACEBO', 'none', none],
    [['ABOVE_PLACEBO', ...fill(15, 'INCONCLUSIVE')], null, 'some', '1 of 16 skills beat the fake: ' + rule + notShown],
    [['ABOVE_PLACEBO', 'BELOW_PLACEBO', ...fill(14, 'UNDERPOWERED')], null, 'many_underpowered', many(14, 1)],
  ];
  for (const [tokens, routerToken, shape, first] of cases) {
    const t = T.tally(plan, of(tokens, routerToken));
    assert.equal(t.shape, shape, first); assert.equal(t.N, 16); assert.equal(t.A + t.B + t.D + t.I + t.U + t.M, 16, 'every count is out of the 16');
    const h = T.headline(t, templates); assert.equal(h[0], first);
    assert.match(h[1], /^Of the 16: ABOVE_PLACEBO \d+, BELOW_PLACEBO \d+, NO_DIFFERENCE \d+, INCONCLUSIVE \d+, UNDERPOWERED \d+, NOT_MEASURED \d+\. Beat the fake means ABOVE_PLACEBO only\.$/);
    assert.match(h[2], /Report 015 Amendment 1/);
  }
  // A router moving to ABOVE_PLACEBO moves no count; a non-router moving to it moves A by one.
  const base = [...fill(4, 'ABOVE_PLACEBO'), ...fill(12, 'NO_DIFFERENCE')];
  assert.equal(T.tally(plan, of(base, 'NO_DIFFERENCE')).A, T.tally(plan, of(base, 'ABOVE_PLACEBO')).A);
  assert.equal(T.tally(plan, of(['ABOVE_PLACEBO', ...base.slice(1).map((x, i) => (i === 4 ? 'ABOVE_PLACEBO' : x))], null)).A, 5);
  assert.throws(() => T.tally(plan, of(['BEAT_THE_FAKE', ...base.slice(1)], null)), code('READING_UNKNOWN'));
  // The note holds the reader's own words for ABOVE_PLACEBO, and the spec pins the note's hash.
  const note = fs.readFileSync(path.join(DIR, 'outcomes.md'), 'utf8');
  assert.ok(note.includes(PLACEBO_WORDS.ABOVE_PLACEBO));
  assert.ok(fs.readFileSync(path.join(DIR, 'spec.md'), 'utf8').includes('<!--outcomes_sha256-->' + plan.outcomes.sha256 + '<!--/outcomes_sha256-->'), 'spec.md pins the note');
  // The secondary reading is shown per skill and moves no count or headline line.
  const secondary = (t) => new Map(plan.rows.map((r) => [r.attempt_id, t]));
  const at = T.tally(plan, of(base, null), secondary('PLACEBO_BELOW_BASELINE')); const bt = T.tally(plan, of(base, null), secondary('PLACEBO_ABOVE_BASELINE'));
  assert.deepEqual(T.headline(at, templates), T.headline(bt, templates)); assert.equal(at.secondary.length, 20);
  assert.ok(at.secondary.every((s) => s.placebo_vs_baseline === 'PLACEBO_BELOW_BASELINE'));
});

// One invocation of the campaign over the fixture, recording which skills were run. The account
// audit of the dispatch at position stopAt fails, before its run starts, so its cost is known (0)
// and dispatch stops as on any failure.
async function campaign(f, croot, { prior = [], stopAt = null } = {}) {
  const ran = []; let audits = 0;
  const { auditDirectory } = require(path.join(ROOT, 'specs/408-skill-measurements/eval-audit.cjs'));
  const audit = () => { if (++audits === stopAt) throw Object.assign(Error('PLANTED_STOP'), { code: 'PLANTED_STOP' }); return { ...auditDirectory(f.home, {}, []), isolation: 'eval-user', checked_at: new Date().toISOString() }; };
  const m = await runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home, prior, adapters: { audit, run: (args) => { ran.push(args.skill.name); return runSkillOnModel(args); } } });
  const file = headOf(croot);
  return { m, out: path.dirname(file), file, ran };
}
// Hand-written prior manifests under the fixture's plan, each in its own directory of a new
// campaign root and named in its log: every attempt NOT_STARTED but those each setter sets.
const noCorrections = { count: 0, sha256: sha256(JSON.stringify([])) };
function forgedRoot(f, setters, extra = {}) {
  const croot = fresh();
  fs.copyFileSync(f.planFile, path.join(croot, 'plan.json')); fs.copyFileSync(path.join(f.root, P.SPEC, 'outcomes.md'), path.join(croot, 'outcomes.md'));
  const files = setters.map((set, n) => {
    const outcomes = f.plan.execution.attempts.map((a) => ({ attempt_id: a.attempt_id, status: 'failure', reason: 'NOT_STARTED', cost_usd: 0 }));
    set(outcomes);
    const dir = path.join(croot, 'forged-' + n); fs.mkdirSync(dir); const file = path.join(dir, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'driftproof-skill-campaign/1', report: '017', plan_sha256: sha256(f.bytes), cap_usd: 400, stub: true, corrections: noCorrections, priors: [], outcomes, n, ...extra }));
    fs.appendFileSync(path.join(croot, 'campaign.log'), JSON.stringify({ plan_sha256: sha256(f.bytes), manifest: 'forged-' + n + '/manifest.json', priors: [] }) + '\n');
    return file;
  });
  return { croot, files };
}
const ranFailure = (o, cost, more = {}) => Object.assign(o, { reason: 'PLANTED_STOP', cost_usd: cost, cost_complete: true, dispatched: true, calls: [], ...more });

test('AC-17: a stopped campaign resumes from its ledger: spend carries, receipts are never run again, a second receipt is refused', async () => {
  const f = fixture(); const skills = f.plan.execution.attempts.map((a) => a.protocol.skill); const croot = fresh();
  const first = await campaign(f, croot, { stopAt: 3 });
  assert.deepEqual(first.m.outcomes.slice(0, 3).map((o) => o.status), ['receipt', 'receipt', 'failure']);
  assert.equal(first.m.outcomes[2].reason, 'PLANTED_STOP'); assert.ok(first.m.outcomes.slice(3).every((o) => o.reason === 'CANCELLED'));
  assert.ok(first.m.spent_usd > 0, 'the stub receipts carry a priced cost');
  const second = await campaign(f, croot, { prior: [first.file] });
  assert.deepEqual(second.ran, skills.slice(2), 'attempts 1 and 2 are not run again; the stopped and cancelled ones are');
  assert.equal(second.m.prior_spend_usd, first.m.spent_usd, 'prior spend carries');
  const added = second.m.outcomes.slice(2).reduce((n, o) => n + o.cost_usd, 0);
  assert.ok(Math.abs(second.m.spent_usd - (first.m.spent_usd + added)) < 1e-6, 'spend is the chain total');
  assert.deepEqual(second.m.outcomes.slice(0, 2).map((o) => o.reason), ['PREVIOUS_RECEIPT', 'PREVIOUS_RECEIPT']);
  assert.ok(second.m.outcomes.slice(2).every((o) => o.status === 'receipt'));
  assert.equal(readChain(readPlan(f.root), [second.file], true).receipts.size, 20, 'one receipt per attempt across the chain');
  const third = await campaign(f, croot, { prior: [second.file] }); assert.deepEqual(third.ran, [], 'a complete chain dispatches nothing');
  let runs = 0; const none = { run: () => { runs++; throw Error('PROVIDER_CALL'); } };
  // Plant: a copy of the first campaign beside the chain, owning the same two receipts.
  const copy = fs.mkdtempSync('/var/tmp/report017-dup-'); fs.cpSync(first.out, copy, { recursive: true });
  const dup = path.join(copy, 'manifest.json'); fs.writeFileSync(dup, JSON.stringify({ ...json(dup), copy: true }));
  await assert.rejects(runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home, prior: [third.file, dup], adapters: none }), code('PRIOR_DUPLICATE_RECEIPT'));
  // Plant: prior spend near the cap stops admission before any run.
  const spent = forgedRoot(f, [(o) => ranFailure(o[0], 390)]);
  const capped = await runCampaign({ root: f.root, campaignRoot: spent.croot, inputs: f.inputs, evalHome: f.home, prior: spent.files, adapters: none });
  assert.equal(capped.prior_spend_usd, 390); assert.equal(capped.outcomes[0].reason, 'BUDGET_REMAINING'); assert.ok(capped.outcomes.slice(1).every((o) => o.reason === 'CANCELLED'));
  // Plants: a prior under another plan; a prior failure whose cost is not known and has no correction.
  const foreign = forgedRoot(f, [() => {}], { plan_sha256: '0'.repeat(64) });
  await assert.rejects(runCampaign({ root: f.root, campaignRoot: foreign.croot, inputs: f.inputs, evalHome: f.home, prior: foreign.files, adapters: none }), code('PLAN_BINDING'));
  const unknown = forgedRoot(f, [(o) => ranFailure(o[0], 1, { cost_complete: false })]);
  await assert.rejects(runCampaign({ root: f.root, campaignRoot: unknown.croot, inputs: f.inputs, evalHome: f.home, prior: unknown.files, adapters: none }), code('PRIOR_COST_UNKNOWN'));
  assert.equal(runs, 0, 'no plant reached a run');
  // Re-dispatch is bounded: an attempt that has run and failed three times is not run a fourth.
  const thrice = forgedRoot(f, [1, 2, 3].map(() => (o) => ranFailure(o[0], 0)));
  const limited = await campaign(f, thrice.croot, { prior: thrice.files, stopAt: 1 });
  assert.equal(limited.m.outcomes[0].reason, 'ATTEMPT_LIMIT'); assert.equal(limited.m.outcomes[1].reason, 'PLANTED_STOP', 'the next attempt is the first dispatched');
  const twice = forgedRoot(f, [1, 2].map(() => (o) => ranFailure(o[0], 0)));
  const again = await campaign(f, twice.croot, { prior: twice.files, stopAt: 1 });
  assert.equal(again.m.outcomes[0].reason, 'PLANTED_STOP', 'control: after two failed runs the attempt is dispatched again');
  assert.equal(again.m.outcomes[0].dispatched, false, 'a failure before its run starts is not counted as a run');
});

test('AC-23: one campaign per root: a second unchained start and a sibling resume are refused before any call', async () => {
  const f = fixture(); const croot = fresh(); let runs = 0; const none = { run: () => { runs++; throw Error('PROVIDER_CALL'); } };
  const first = await campaign(f, croot, { stopAt: 3 });
  const lines = R.readLog(croot); assert.equal(lines.length, 1); assert.equal(lines[0].plan_sha256, sha256(f.bytes));
  await assert.rejects(runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home, adapters: none }), code('CAMPAIGN_STARTED'), 'a second start with no prior');
  const second = await campaign(f, croot, { prior: [first.file], stopAt: 2 });
  await assert.rejects(runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home, prior: [first.file], adapters: none }), code('CAMPAIGN_FORK'), 'a sibling resume from the same parent');
  await assert.rejects(runCampaign({ root: f.root, campaignRoot: croot, out: fs.mkdtempSync('/var/tmp/report017-elsewhere-'), inputs: f.inputs, evalHome: f.home, prior: [second.file], adapters: none }), code('OUTPUT_DIRECTORY'), 'a start outside the root');
  assert.equal(runs, 0); assert.equal(R.readLog(croot).length, 2, 'a refused start writes no log line');
  const control = await campaign(f, croot, { prior: [second.file] });
  assert.equal(R.readLog(croot).length, 3); assert.ok(control.ran.length > 0, 'control: a resume from the latest runs');
});

test('AC-19, AC-23: publication reads the root\'s one chain and refuses a stale head, an outside manifest, a duplicate owner, an unsealed receipt and a foreign file', async () => {
  const f = fixture(); const croot = fresh();
  const first = await campaign(f, croot, { stopAt: 3 }); const second = await campaign(f, croot, { prior: [first.file] });
  const pub = pubAt(f, { campaignRoot: croot, stub: true });
  assert.equal(pub.rows.length, 20); assert.ok(pub.rows.every((r) => r.receipt_hash && r.placebo === 'NOT_MEASURED' && r.placebo_vs_baseline === 'NOT_MEASURED'));
  assert.equal(pub.tally.shape, 'not_read'); assert.equal(pub.tally.secondary.length, 20); assert.equal(pub.plan_sha256, sha256(f.bytes)); assert.equal(pub.head, path.relative(croot, second.file));
  assert.equal(pubAt(f, { campaignRoot: croot, manifest: second.file, stub: true }).rows.length, 20, 'control: the head named');
  assert.throws(() => pubAt(f, { campaignRoot: croot, manifest: first.file, stub: true }), code('CAMPAIGN_HEAD'), 'a manifest that is not the log\'s latest');
  // Plant: a manifest under this plan in the root that the chain does not hold (a sibling written by hand).
  fs.cpSync(second.out, path.join(croot, 'sibling'), { recursive: true });
  assert.throws(() => pubAt(f, { campaignRoot: croot, stub: true }), code('FOREIGN_MANIFEST')); fs.rmSync(path.join(croot, 'sibling'), { recursive: true });
  // Plant: a head that names the whole chain as its prior and claims a second receipt for attempt 1.
  const dup = fs.mkdtempSync('/var/tmp/report017-owner-'); fs.cpSync(croot, dup, { recursive: true });
  const id = f.plan.execution.attempts[0].attempt_id; const own = path.join(dup, 'owner'); fs.mkdirSync(own);
  for (const s of ['.json', '-answers.json']) fs.copyFileSync(path.join(first.out, id + s), path.join(own, id + s));
  const outcomes = f.plan.execution.attempts.map((a) => ({ attempt_id: a.attempt_id, status: 'failure', reason: 'NOT_STARTED', cost_usd: 0 }));
  outcomes[0] = first.m.outcomes[0];
  const head = path.join(dup, path.relative(croot, second.file));
  fs.writeFileSync(path.join(own, 'manifest.json'), JSON.stringify({ format: 'driftproof-skill-campaign/1', report: '017', plan_sha256: sha256(f.bytes), cap_usd: 400, stub: true, corrections: noCorrections, priors: [{ path: path.relative(own, head), sha256: sha256(fs.readFileSync(head)) }], outcomes }));
  fs.appendFileSync(path.join(dup, 'campaign.log'), JSON.stringify({ plan_sha256: sha256(f.bytes), manifest: 'owner/manifest.json', priors: [] }) + '\n');
  assert.throws(() => pubAt(f, { campaignRoot: dup, stub: true }), code('PRIOR_DUPLICATE_RECEIPT'));
  // Plant: one receipt's score edited in place, not resealed.
  const file = path.join(first.out, id + '.json'); const bytes = fs.readFileSync(file);
  const edited = JSON.parse(bytes); edited.results.cases[0].score = 0.123; fs.writeFileSync(file, JSON.stringify(edited));
  assert.throws(() => pubAt(f, { campaignRoot: croot, stub: true }), code('RECEIPT_SEAL')); fs.writeFileSync(file, bytes);
  // Plants: a file in a campaign directory that its manifest does not name, and one in the root.
  fs.writeFileSync(path.join(first.out, 'extra.json'), '{}');
  assert.throws(() => pubAt(f, { campaignRoot: croot, stub: true }), code('FOREIGN_FILE')); fs.unlinkSync(path.join(first.out, 'extra.json'));
  fs.writeFileSync(path.join(croot, 'extra.json'), '{}');
  assert.throws(() => pubAt(f, { campaignRoot: croot, stub: true }), code('FOREIGN_FILE')); fs.unlinkSync(path.join(croot, 'extra.json'));
  assert.equal(pubAt(f, { campaignRoot: croot, stub: true }).rows.length, 20, 'control: the restored chain reads');
  // Plant: the same root, its frozen plan listed as abandoned (A-613-1).
  assert.throws(() => pubAt(f, { campaignRoot: croot, stub: true, abandoned: { [sha256(f.bytes)]: 'synthetic' } }), code('CAMPAIGN_ABANDONED'));
  const { ABANDONED } = require(path.join(DIR, 'publication.cjs'));
  assert.ok(Object.hasOwn(ABANDONED, '22599edc03c84b898abb95aff9635d33debaacf0a39451eb85b758d4529cd72b'), 'receipts/report-017 is recorded abandoned');
  assert.ok(Object.hasOwn(ABANDONED, 'b3ed79efe541ce4193b6a499f955a8e8b0d6db9ec59ebb5db558b3edcdf6f694'), 'receipts/report-017b is recorded abandoned (A-613-2)');
  // Where the abandoned roots are on this box, each refuses by the shipped list, before any receipt in
  // it is read.
  for (const name of ['report-017', 'report-017b']) {
    const at = path.join(ROOT, 'receipts', name);
    if (fs.existsSync(path.join(at, 'plan.json'))) assert.throws(() => publication({ campaignRoot: at }), code('CAMPAIGN_ABANDONED'), name);
  }
  assert.ok(!Object.hasOwn(ABANDONED, sha256(fs.readFileSync(path.join(DIR, 'plan.json')))), 'the committed frozen plan is not abandoned');
});

test('AC-22: a cost correction resumes a stopped campaign without moving the plan; a reader change after the run leaves it readable', async () => {
  const f = fixture(); const croot = fresh(); const before = sha256(f.bytes);
  for (const file of ['specs/613-placebo-skills-report/tally.cjs', 'specs/613-placebo-skills-report/publication.cjs', 'specs/613-placebo-skills-report/prior-spend.json', 'lib/plain.js']) assert.ok(!(file in f.plan.runner_hashes), file + ' is not pinned');
  const first = await timedOutJudge(f, 1000, croot);
  assert.equal(first.m.outcomes[0].reason, 'COST_UNKNOWN'); assert.equal(first.m.outcomes[0].cost_complete, false);
  const file = headOf(croot);
  await assert.rejects(campaign(f, croot, { prior: [file] }), code('PRIOR_COST_UNKNOWN'), 'control: no correction, no resume');
  // The operator's correction for the unknown cost, bound to that manifest and attempt.
  const spend = path.join(f.root, P.SPEC, 'prior-spend.json'); const original = fs.readFileSync(spend);
  const note = 'Synthetic test correction: the timed-out judge sample cost is set by the test.';
  const correction = { manifest_sha256: sha256(fs.readFileSync(file)), attempt_id: f.plan.execution.attempts[0].attempt_id, cost_usd: 0.5, note, note_sha256: sha256(note) };
  fs.writeFileSync(spend, JSON.stringify({ corrections: [correction] }));
  assert.equal(readPlan(f.root).plan_hash, before, 'the correction moves no plan pin');
  const second = await campaign(f, croot, { prior: [file] });
  assert.equal(second.m.prior_spend_usd, 0.5, 'the corrected cost is the prior spend');
  assert.deepEqual(second.m.corrections, { count: 1, sha256: sha256(JSON.stringify([correction])) }, 'the manifest records the corrections in force');
  assert.ok(second.m.outcomes.every((o) => o.status === 'receipt'), 'the chain reaches 20 receipts');
  assert.ok(Math.abs(second.m.spent_usd - (0.5 + second.m.outcomes.reduce((n, o) => n + o.cost_usd, 0))) < 1e-6, 'cumulative spend');
  assert.equal(pubAt(f, { campaignRoot: croot, stub: true }).rows.filter((r) => r.receipt_hash).length, 20);
  // Plant: the correction rewritten after a manifest recorded it.
  fs.writeFileSync(spend, JSON.stringify({ corrections: [{ ...correction, cost_usd: 0.1 }] }));
  assert.throws(() => pubAt(f, { campaignRoot: croot, stub: true }), code('CORRECTIONS_BINDING'));
  fs.writeFileSync(spend, JSON.stringify({ corrections: [correction] }));
  // A runner byte changed after the run: a resume refuses, the frozen reader still reads the chain.
  const run = path.join(f.root, 'lib/run.js'); fs.appendFileSync(run, '\n');
  await assert.rejects(campaign(f, croot, { prior: [second.file] }), code('RUNNER_BINDING'));
  assert.equal(pubAt(f, { campaignRoot: croot, stub: true }).rows.length, 20, 'publication reads the plan the campaign started with');
  fs.writeFileSync(spend, original);
});

test('AC-18: the secondary reading is the case rule over the placebo against no skill, read from the rows', async () => {
  const f = fixture(); const { record } = await modelShaped(f); const r = record.receipt;
  // Independent path: lib/verdict.js's own placebo reader over a receipt whose skill rows are the
  // placebo's and whose placebo rows are the baseline's, with its block's figures recomputed.
  const { placeboPairing, placeboFigures } = require(path.join(ROOT, 'lib/verdict')); const { comparisonOf } = require(path.join(ROOT, 'lib/receipt'));
  const x = structuredClone(r);
  x.results.cases = r.results.cases.filter((c) => c.mode !== 'with_skill').flatMap((c) => (c.mode === 'placebo' ? [{ ...c, mode: 'with_skill' }] : [c, { ...c, mode: 'placebo' }]));
  const got = comparisonOf(x.results.cases); x.results.aggregates = { ...x.results.aggregates, ...got.aggregates }; x.comparison = got.comparison;
  const fig = placeboFigures(x, placeboPairing(x).ids); x.placebo.aggregates = fig.aggregates; x.placebo.comparison = fig.comparison;
  const map = { ABOVE_PLACEBO: 'PLACEBO_ABOVE_BASELINE', BELOW_PLACEBO: 'PLACEBO_BELOW_BASELINE' };
  const oracle = placeboReading(x).reading;
  assert.notEqual(oracle, 'NOT_MEASURED', 'the oracle reads a measured token');
  assert.equal(T.secondaryReading(r).reading, map[oracle] || oracle);
  assert.equal(T.readingsOf(r).placebo_vs_baseline, T.secondaryReading(r).reading);
  // It refuses wherever the placebo reading refuses: the block dropped, and a stub receipt.
  const dropped = structuredClone(r); delete dropped.placebo; assert.equal(T.secondaryReading(dropped).reading, 'NOT_MEASURED');
  const stub = structuredClone(r); stub.verification_level = 'UNVERIFIED'; assert.equal(T.secondaryReading(stub).reading, 'NOT_MEASURED');
});

test('AC-21: fake tool calls in the placebo arm move the placebo reading, never the verdict', async () => {
  const f = fixture(); const { record } = await modelShaped(f); const r = record.receipt;
  const strip = (x) => { const y = structuredClone(x); y.results.cases = y.results.cases.filter((c) => c.mode !== 'placebo'); delete y.placebo; return y; };
  const mark = (x, mode) => { const y = structuredClone(x); for (const c of y.results.cases) if (c.mode === mode) for (const d of c.generation.draws) d.capture_outcome = 'fake_tool_call'; return y; };
  assert.notEqual(receiptVerdict(r).verdict, 'NOT_MEASURED', 'control: the fixture reads a measured verdict');
  const fakePlacebo = mark(r, 'placebo');
  assert.deepEqual(receiptVerdict(fakePlacebo), receiptVerdict(strip(fakePlacebo)), 'the verdict is the one the receipt gives without its placebo arm');
  assert.equal(receiptVerdict(fakePlacebo).fakeToolCalls, undefined);
  assert.notEqual(plainOf(fakePlacebo).label, 'Comparison unreliable');
  assert.equal(placeboReading(fakePlacebo).reading, 'INCONCLUSIVE', 'the placebo reading reads its own two arms');
  const fakeBaseline = mark(r, 'baseline');
  assert.equal(receiptVerdict(fakeBaseline).verdict, 'INCONCLUSIVE', 'control: fake calls in a verdict arm still make it inconclusive');
  assert.equal(plainOf(fakeBaseline).label, 'Comparison unreliable');
  // The summary's headline names the placebo arm when only it carries the fake calls (N4).
  const generic = "Comparison unreliable: at least 5% of an arm's replies ended in fake tool calls.";
  const placeboOnly = summarizeReceipt(fakePlacebo);
  assert.ok(!placeboOnly.includes(generic), 'no verdict-wide warning above a verdict its arms do not qualify');
  assert.ok(placeboOnly.includes("Placebo comparison unreliable: at least 5% of the placebo arm's replies ended in fake tool calls."));
  assert.ok(summarizeReceipt(fakeBaseline).includes(generic), 'control: fake calls in a verdict arm keep the warning');
});

// A judge call that times out after four of its five samples answered, under the stub: the
// samples' usage is what the test gives, and every call made after the timeout is counted.
async function timedOutJudge(f, inputTokens, croot = fresh()) {
  const capture = require(path.join(ROOT, 'lib/capture')); const original = capture.checkpointInvoke;
  let judged = 0; let after = 0; let stopped = false;
  capture.checkpointInvoke = async (fn, request, phase) => {
    if (stopped) { after++; return fn(request); }
    if (phase !== 'judge') return fn(request);
    judged++;
    if (judged < 5) { const out = await fn(request); return { ...out, usage: { input_tokens: inputTokens, output_tokens: 0 } }; }
    stopped = true; throw Object.assign(Error('provider(claude-cli) timed out after 1ms'), { code: 'TIMEOUT' });
  };
  try { return { m: await runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home }), after }; } finally { capture.checkpointInvoke = original; }
}
test('AC-8: a judge timeout stops the attempt when its answered samples pass the ceiling or leave its cost unknown', async () => {
  const f = fixture();
  // 7,000,000 input tokens is above Haiku 5.5's threshold: USD 7 a sample, USD 28 for four.
  const over = await timedOutJudge(f, 7000000);
  assert.equal(over.m.outcomes[0].reason, 'ATTEMPT_MAX_USD'); assert.ok(over.m.outcomes[0].cost_usd >= 28); assert.equal(over.m.outcomes[0].cost_complete, false);
  assert.equal(over.after, 0, 'no call is made after the ceiling is passed');
  const cheap = await timedOutJudge(f, 1000);
  assert.equal(cheap.m.outcomes[0].reason, 'COST_UNKNOWN'); assert.equal(cheap.after, 0, 'no call is made once a cost is unknown');
  assert.ok(over.m.outcomes.slice(1).every((o) => o.reason === 'CANCELLED') && cheap.m.outcomes.slice(1).every((o) => o.reason === 'CANCELLED'));
});

test('A-613-3: a finished root is read at its recorded head: a moved live tree breaks nothing, a mismatch at the head refuses', async () => {
  // The real finished root, on a live tree that has moved since 3ef94167e.
  const real = path.join(ROOT, 'receipts/report-017c');
  const pub = publication({ campaignRoot: real, stub: false });
  assert.equal(pub.code_head, '3ef94167ee4cf63b61afc713440de39020c85b37'); assert.equal(pub.judge_code_revision, 'judge-code-99b2456256e5a440');
  assert.equal(pub.rows.filter((r) => r.receipt_hash).length, 20); assert.equal(pub.tally.N, 16);
  // Plants on the real root: a head that does not hold the pinned bytes (the branch's base), a head
  // that is not in this repository's history, no head at all, and the root without its log.
  const plan = sha256(fs.readFileSync(path.join(real, 'plan.json')));
  assert.throws(() => publication({ campaignRoot: real, stub: false, recordedHeads: { [plan]: 'c346b8e1a45d80dfb80ff7498278f251dfd17395' } }), code('PLAN_BINDING'), 'a head without the plan');
  assert.throws(() => publication({ campaignRoot: real, stub: false, recordedHeads: { [plan]: '0'.repeat(40) } }), code('CAMPAIGN_HEAD'), 'a head outside the history');
  assert.throws(() => publication({ campaignRoot: real, stub: false, recordedHeads: {} }), code('CAMPAIGN_HEAD_UNKNOWN'), 'no recorded head');
  const nolog = fs.mkdtempSync('/var/tmp/report017-nolog-'); fs.cpSync(real, nolog, { recursive: true }); fs.unlinkSync(path.join(nolog, 'campaign.log'));
  assert.throws(() => publication({ campaignRoot: nolog, stub: false }), code('CAMPAIGN_ROOT'), 'a root without its campaign log');
  // A fixture campaign: read at its head after the live tree moved; each tampered byte at the head refuses.
  const f = fixture(); const croot = fresh(); await campaign(f, croot);
  assert.equal(pubAt(f, { campaignRoot: croot }).rows.length, 20, 'control');
  const run = path.join(f.root, 'lib/run.js'); fs.appendFileSync(run, '\n');
  assert.throws(() => readPlan(f.root), code('RUNNER_BINDING'), 'the moved live tree refuses a run');
  assert.equal(pubAt(f, { campaignRoot: croot }).rows.length, 20, 'and publication of the finished root still reads');
  for (const [file, want] of [['lib/run.js', 'RUNNER_BINDING'], ['specs/408-skill-measurements/eval-audit.cjs', 'RUNNER_BINDING'], [P.SPEC + '/plan.json', 'PLAN_BINDING'], [P.SPEC + '/outcomes.md', 'OUTCOMES_BINDING']]) {
    const at = codeAt(f); const tampered = { ...at, show: (h, x) => (x === file ? Buffer.concat([at.show(h, x), Buffer.from(' ')]) : at.show(h, x)) };
    assert.throws(() => pubAt(f, { campaignRoot: croot, reader: tampered }), code(want), file + ' tampered at the head');
    const missing = { ...at, show: (h, x) => (x === file ? null : at.show(h, x)) };
    assert.throws(() => pubAt(f, { campaignRoot: croot, reader: missing }), code(want), file + ' absent at the head');
  }
  // Plant: a receipt sealed with another judging code than the head's.
  const m = json(headOf(croot)); const o = m.outcomes[0]; const rf = path.join(path.dirname(headOf(croot)), o.attempt_id + '.json'); const af = path.join(path.dirname(headOf(croot)), o.attempt_id + '-answers.json');
  const r = json(rf); const ans = json(af); r.run.judge.code_revision = 'judge-code-0000000000000000'; sealReceipt(r); ans.receipt_hash = r.receipt_hash; o.receipt_hash = r.receipt_hash;
  fs.writeFileSync(rf, JSON.stringify(r)); fs.writeFileSync(af, JSON.stringify(ans)); fs.writeFileSync(headOf(croot), JSON.stringify(m));
  assert.throws(() => pubAt(f, { campaignRoot: croot }), code('JUDGE_BINDING'));
  // Plant: a log line naming a head that disagrees with the recorded one.
  const g = fixture(); const groot = fresh(); await campaign(g, groot);
  const line = R.readLog(groot)[0]; fs.writeFileSync(path.join(groot, 'campaign.log'), JSON.stringify({ ...line, head: '1'.repeat(40) }) + '\n');
  assert.throws(() => pubAt(g, { campaignRoot: groot }), code('CAMPAIGN_HEAD'));
  assert.throws(() => R.pinsAtHead(readPlan(g.root), null, codeAt(g)), code('CAMPAIGN_HEAD'), 'a paid start with no head refuses');
});

// A-613-2 (A): lib/counts.js places a draw count at run, arm or case scope. A two-arm view must
// resolve every kept row's count exactly as the sealed receipt resolves that row.
function placed(receipt, how) {
  const r = structuredClone(receipt); const n = (c) => c.generation.draws.length;
  const rest = { ...(r.run.counts || {}) }; delete rest.generations_per_arm; r.run.counts = rest;
  const arm = (mode, v) => { r.run.arms = r.run.arms || {}; r.run.arms[mode] = { ...(r.run.arms[mode] || {}), counts: { generations_per_arm: v } }; };
  const byCase = (mode) => { for (const c of r.results.cases) if (c.mode === mode) c.counts = { ...(c.counts || {}), generations_per_arm: n(c) }; };
  if (how === 'placebo arm') { arm('placebo', 3); byCase('with_skill'); byCase('baseline'); }
  if (how === 'baseline arm') { arm('baseline', 3); byCase('with_skill'); byCase('placebo'); }
  if (how === 'two arms, two counts') { arm('baseline', 4); arm('placebo', 3); byCase('with_skill'); }
  if (how === 'every case') { byCase('with_skill'); byCase('baseline'); byCase('placebo'); }
  sealReceipt(r); return r;
}
test('A-613-2 (A): each two-arm view resolves every kept row\'s draw count as the sealed receipt does', async () => {
  const f = fixture(); const { ctx, a, record } = await modelShaped(f);
  const { resolveCount } = require(path.join(ROOT, 'lib/counts'));
  assert.equal(record.receipt.results.cases.every((c) => c.generation.draws.length === 3), true, 'the fixture draws three in every row');
  for (const how of ['run', 'placebo arm', 'baseline arm', 'two arms, two counts', 'every case']) {
    const r = how === 'run' ? record.receipt : placed(record.receipt, how);
    const v = R.views(r, { ...record.answers, receipt_hash: r.receipt_hash });
    for (const [name, view, from] of [['skill', v.skill.r, { with_skill: 'with_skill', baseline: 'baseline' }], ['placebo', v.fake.r, { with_skill: 'with_skill', baseline: 'placebo' }]]) {
      for (const [j, c] of view.results.cases.entries()) {
        const i = r.results.cases.findIndex((x) => x.id === c.id && x.mode === from[c.mode]);
        assert.equal(resolveCount(view, j, 'generations_per_arm'), resolveCount(r, i, 'generations_per_arm'), how + ': the ' + name + ' view, ' + c.id + '/' + c.mode);
        assert.notEqual(resolveCount(view, j, 'generations_per_arm'), null, how + ': resolved');
      }
    }
  }
  // The shape the paid run met: the placebo arm uniform at arm scope, the other arms by case.
  for (const how of ['placebo arm', 'baseline arm', 'every case']) {
    const r = placed(record.receipt, how); const answers = { ...record.answers, receipt_hash: r.receipt_hash };
    assert.doesNotThrow(() => verifyPlaceboOutcome(ctx, a, r, answers), how + ' verifies in both views');
  }
});

// A-613-2 (B): one judge sample whose first reply does not parse is asked once more (lib/judge.js).
// The patch shapes the first judge reply of the run; `transport` marks it retried by the transport.
async function judgeReplies(f, mode, croot = fresh()) {
  const capture = require(path.join(ROOT, 'lib/capture')); const original = capture.checkpointInvoke; let judged = 0;
  capture.checkpointInvoke = async (fn, request, phase) => {
    const out = await fn(request);
    if (phase !== 'judge' || ++judged !== 1) return out;
    return mode === 'transport' ? { ...out, attempts: 2 } : { ...out, text: 'no grade here', raw: 'no grade here' };
  };
  try { return { m: await runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home }), croot }; } finally { capture.checkpointInvoke = original; }
}
test('A-613-2 (B): a judge parse retry is a known cost and a served call; an unexplained reply count or a transport retry is not', async () => {
  const f = fixture();
  const { m, croot } = await judgeReplies(f, 'parse');
  assert.equal(m.outcomes[0].status, 'receipt', 'a parse retry keeps the receipt: ' + m.outcomes[0].reason);
  const receipt = json(path.join(path.dirname(headOf(croot)), m.outcomes[0].attempt_id + '.json'));
  const retried = receipt.results.cases.flatMap((c) => c.generation.draws).filter((d) => (d.judge_parse_retries || []).length);
  assert.equal(retried.length, 1, 'one draw records the parse retry');
  assert.equal(m.outcomes[0].cost_usd, C.receiptCost(receipt), 'its cost is the receipt\'s, the retry included');
  const plain = receipt.results.cases.reduce((n, c) => n + c.generation.draws.reduce((k, d) => k + 1 + d.judge_sample_hashes.length, 0), 0);
  assert.equal(R.servedCallsExpected(receipt), plain + 1, 'the retry is one more served call');
  // A transport retry stays an unknown cost.
  const transport = await judgeReplies(f, 'transport');
  assert.equal(transport.m.outcomes[0].reason, 'COST_UNKNOWN');
  // A reply count the receipt's retries do not explain refuses: one extra judge reply with no record,
  // and more replies than twice the samples.
  const per = perCallCostUSD('claude-haiku-5-5', 'judge');
  for (const extra of [1, 6]) {
    const run = async (args) => {
      const result = await runSkillOnModel(args); const o = args.opts; const c = result.receipt.results.cases[0];
      o.onProgress({ phase: 'judge', case: c.id, mode: c.mode, samples: 5, draw: 0 });
      for (let s = 0; s < 5 + extra; s++) o.onReply({ phase: 'judge', case: c.id, mode: c.mode, draw: 0, sample: s, reply: { answeredBy: 'stub', usage: { input_tokens: 10, output_tokens: 1 } } });
      o.budget.add((5 + extra) * per);
      return result;
    };
    const u = await runCampaign({ root: f.root, campaignRoot: fresh(), inputs: f.inputs, evalHome: f.home, adapters: { run } });
    assert.equal(u.outcomes[0].reason, 'COST_UNKNOWN', extra + ' unexplained judge replies');
  }
});
