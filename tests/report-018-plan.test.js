// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 655: Report 018's frozen plan, Report 017's placebo design on claude-haiku-5-5 with the fixed
// Haiku 5.5 judge. No model is called: every run is the stub, every plant is written under a temporary
// root, never the tree, and no campaign root is created under receipts/.
process.env.DRIFTPROOF_STUB = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SPEC = 'specs/655-report-018-plan';
const DIR = path.join(ROOT, SPEC);
const S613 = 'specs/613-placebo-skills-report';
const ROSTER = 'receipts/report-017c';
const { sha256 } = require(path.join(ROOT, 'lib/canonical'));
const { suiteIdentity } = require(path.join(ROOT, 'lib/skill'));
const { projectCalls } = require(path.join(ROOT, 'lib/run'));
const { placeboReading, receiptVerdict, PLACEBO_WORDS } = require(path.join(ROOT, 'lib/verdict'));
const H = require(path.join(ROOT, 'scripts/skill-handoff.js'));
const prices = require(path.join(ROOT, 'specs/408-skill-measurements/pricing.json'));
// The modules this spec builds, required late so the tests that need none of them run before the build.
const P = () => require(path.join(DIR, 'protocol.cjs'));
const R = () => require(path.join(DIR, 'run-campaign.cjs'));
const T = () => require(path.join(ROOT, S613, 'tally.cjs'));

const SETTINGS = { permissions: { deny: ['Read', 'WebFetch', 'WebSearch'] }, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, autoMemoryEnabled: false, disableClaudeAiConnectors: true };
const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DRIFTPROOF_STUB: '1', TMPDIR: '/var/tmp' }, timeout: 600000 });
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const code = (c) => (e) => e.code === c;
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5';
const LIMITATION = "The judge uses the same model as the target. Self-grading may favor its own model's answers.";
const POLICY = 'That judge is fixed at claude-haiku-5-5 and changed only rarely';
const NOT_COMPARED = 'results scored by different graders are not compared directly';
const roster = () => json(path.join(ROOT, ROSTER, 'plan.json'));
const manifest = () => json(path.join(ROOT, ROSTER, 'campaign-1/manifest.json'));
const fresh = () => fs.mkdtempSync('/var/tmp/report018-root-');

// Independent pricing oracle: the published table, twice all input at the list rate, the high tier
// for the whole request above the threshold, as spec 408's pricing.cjs prices a call.
function price(model, usage) {
  const row = prices.models[model]; const rate = row.threshold && usage.input_tokens > row.threshold ? row.above : row;
  return (2 * usage.input_tokens * rate.input + usage.output_tokens * rate.output) / 1e6;
}
// Report 017's sealed receipt at a rank, repriced: generation and judging at Haiku 5.5.
function repriced(rank) {
  const o = manifest().outcomes[rank - 1]; const r = json(path.join(ROOT, ROSTER, 'campaign-1', o.attempt_id + '.json'));
  let recorded = 0, judge = 0, judged = 0; const arm = {}, draws = {};
  for (const c of r.results.cases) for (const d of c.generation.draws) {
    const g = price(HAIKU, d.usage), j = price(HAIKU, d.judge_usage);
    recorded += g + j; judge += j; judged++; arm[c.mode] = (arm[c.mode] || 0) + g; draws[c.mode] = (draws[c.mode] || 0) + 1;
  }
  let maximum = judge / judged * 90; for (const k of Object.keys(arm)) maximum += arm[k] / draws[k] * 30;
  return { skill: r.skill.name, recorded, maximum, judge, arm, cost: o.cost_usd, receipt_hash: r.receipt_hash };
}

// A temporary copy of every input the plan reads, with clearly synthetic skill texts in place of the
// pinned ones (the pinned SKILL.md bytes are not in the repository), and the plan rebuilt over it.
// Report 017's receipts are copied unchanged: the projection reads their usage by rank and skill.
// `texts` replaces a skill's whole synthetic text; `before` edits the copied inputs before the build;
// `refuse` returns the builder's refusal code instead of a fixture.
const handsOff = (skill) => '---\nname: ' + skill + '\n---\nCall the Skill tool with "synthetic-other-skill".\n';
const plain = (skill) => '---\nname: ' + skill + '\n---\nSynthetic test instructions for ' + skill + ' only. No provider call.\n';
const textFor = (skill, texts = {}) => texts[skill] || (P().HANDOFF_SKILLS.includes(skill) ? handsOff(skill) : plain(skill));
const buildCode = (root) => node(['-e', 'try{require(process.argv[1]).buildPlan({root:process.argv[2]});console.log("built")}catch(e){console.log(e.code||e.message)}', path.join(DIR, 'build-plan.cjs'), root]).stdout.trim();
function fixture({ texts = {}, before = null, refuse = false } = {}) {
  const root = fs.mkdtempSync('/var/tmp/report018-fixture-');
  const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.cpSync(path.join(ROOT, rel), path.join(root, rel), { recursive: true }); };
  copy(P().SOURCE); copy(S613); copy(SPEC); copy(ROSTER); copy('scripts/skill-handoff.js'); for (const f of P().RUNNER_FILES) copy(f);
  const at = path.join(root, P().SOURCE);
  const plan = json(path.join(root, ROSTER, 'plan.json')); const sources = json(path.join(at, 'sources.json'));
  const panel = path.join(root, 'receipts/report-017-panel'); fs.mkdirSync(panel, { recursive: true });
  for (const a of plan.execution.attempts) {
    const p = a.protocol; const s = sources.find((x) => x.repository === p.repository && x.skill === p.skill);
    const text = textFor(p.skill, texts);
    const old = s.skill_sha256; s.skill_sha256 = sha256(text);
    const raw = fs.readFileSync(path.join(at, s.suite), 'utf8').replaceAll(old, s.skill_sha256); fs.writeFileSync(path.join(at, s.suite), raw);
    p.skill_sha256 = s.skill_sha256; p.evals_sha256 = sha256(raw); p.suite_hash = suiteIdentity(JSON.parse(raw)).suiteHash;
    const row = plan.rows.find((r) => r.skill === p.skill && r.repository === p.repository);
    a.attempt_id = sha256(JSON.stringify(p)); row.attempt_id = a.attempt_id;
    if (P().HANDOFF_SKILLS.includes(p.skill)) fs.writeFileSync(path.join(panel, a.attempt_id + '.md'), text);
  }
  fs.writeFileSync(path.join(at, 'sources.json'), JSON.stringify(sources));
  fs.writeFileSync(path.join(root, ROSTER, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  if (before) before(root);
  if (refuse) return buildCode(root);
  const planFile = path.join(root, SPEC, 'plan.json');
  const built = node(['-e', 'const B=require(process.argv[1]);require("node:fs").writeFileSync(process.argv[3],JSON.stringify(B.buildPlan({root:process.argv[2]}),null,2)+"\\n")', path.join(DIR, 'build-plan.cjs'), root, planFile]);
  assert.equal(built.status, 0, built.stderr);
  const inputs = path.join(root, 'inputs'); fs.mkdirSync(inputs);
  const frozen = json(planFile);
  for (const a of frozen.execution.attempts) fs.writeFileSync(path.join(inputs, a.attempt_id + '.md'), textFor(a.protocol.skill, texts));
  const home = path.join(root, 'eval'); fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify(SETTINGS));
  return { root, inputs, home, panel, planFile, plan: frozen, bytes: fs.readFileSync(planFile), roster: plan };
}
// Write a changed plan under the temporary root, read it, put the plan back.
function readsAs(f, mutate, reason, why) {
  const plan = JSON.parse(f.bytes); mutate(plan);
  fs.writeFileSync(f.planFile, JSON.stringify(plan, null, 2) + '\n');
  const ok = Array.isArray(reason) ? (e) => reason.includes(e.code) : code(reason);
  try { assert.throws(() => R().readPlan(f.root), ok, why); } finally { fs.writeFileSync(f.planFile, f.bytes); }
}
const reid = (a) => { a.attempt_id = sha256(JSON.stringify(a.protocol)); };
// A fixture root is not a git repository. Its recorded head is a snapshot of the pinned files, the
// plan and the note, served as git would serve that commit (spec 613 A-613-3).
const FIXTURE_HEAD = 'f'.repeat(40);
function codeAt(f) {
  if (!f.snapshot) { f.snapshot = new Map(); for (const file of [...Object.keys(f.plan.runner_hashes), SPEC + '/plan.json', SPEC + '/outcomes.md']) f.snapshot.set(file, fs.readFileSync(path.join(f.root, file))); }
  return { head: () => FIXTURE_HEAD, isAncestor: (h) => h === FIXTURE_HEAD, show: (h, file) => (h === FIXTURE_HEAD && f.snapshot.has(file) ? f.snapshot.get(file) : null) };
}
const noRun = () => { const s = { runs: 0 }; s.adapters = { run: () => { s.runs++; throw Error('PROVIDER_CALL'); } }; return s; };

// A-655-1 (issue 669): the paid run of 2 Nov 2026 made the plan historical. The only campaign root is
// the one its log names, and planning still creates nothing.
const CAMPAIGN = 'receipts/report-018';
test('AC-7 (A-655-1): the campaign root is the paid run\'s, and planning created nothing else', () => {
  const roots = fs.readdirSync(path.join(ROOT, 'receipts')).filter((n) => /^report-018/.test(n));
  assert.deepEqual(roots, ['report-018'], 'the one receipts/report-018* directory is the campaign root');
  assert.ok(!fs.existsSync(path.join(DIR, 'campaign.log')), 'the spec directory holds no log');
  const log = R().readLog(path.join(ROOT, CAMPAIGN));
  assert.equal(log.length, 3); assert.ok(log.every((e) => e.plan_sha256 === sha256(fs.readFileSync(path.join(DIR, 'plan.json')))));
  assert.deepEqual(log.map((e) => e.manifest), ['campaign-1/manifest.json', 'campaign-2/manifest.json', 'campaign-3/manifest.json']);
  assert.equal(fs.readFileSync(path.join(ROOT, CAMPAIGN, 'plan.json'), 'utf8'), fs.readFileSync(path.join(DIR, 'plan.json'), 'utf8'), 'the root keeps the frozen plan');
  assert.equal(fs.readFileSync(path.join(ROOT, CAMPAIGN, 'outcomes.md'), 'utf8'), fs.readFileSync(path.join(DIR, 'outcomes.md'), 'utf8'), 'and the frozen note');
  const head = json(path.join(ROOT, CAMPAIGN, log.at(-1).manifest));
  assert.equal(head.stub, false); assert.equal(head.outcomes.filter((o) => o.status === 'receipt').length, 20);
  // Planning creates nothing: the builder reads the plan as historical and refuses to regenerate it.
  const r = node([path.join(DIR, 'build-plan.cjs'), '--check']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /historical: the frozen plan of receipts\/report-018/);
  const w = node([path.join(DIR, 'build-plan.cjs')]);
  assert.notEqual(w.status, 0); assert.match(w.stderr, /PLAN_HISTORICAL/);
});

test('AC-9, AC-10: the note is pinned in the spec and pre-registers the judge, the limitation, the shapes, the routers and the hand-off skills', () => {
  const note = fs.readFileSync(path.join(DIR, 'outcomes.md'), 'utf8');
  const spec = fs.readFileSync(path.join(DIR, 'spec.md'), 'utf8');
  const pin = /<!--outcomes_sha256-->([0-9a-f]{64})<!--\/outcomes_sha256-->/.exec(spec);
  assert.ok(pin, 'the spec pins the note'); assert.equal(pin[1], sha256(Buffer.from(note)));
  assert.ok(note.includes(PLACEBO_WORDS.ABOVE_PLACEBO), 'the reader\'s own words, verbatim');
  const block = /```report-018-headlines\n([\s\S]*?)```/.exec(note); assert.ok(block, 'the fence is named by the plan\'s report');
  const keys = block[1].trim().split('\n').map((l) => l.split(':')[0]);
  assert.deepEqual(keys, ['all', 'not_read', 'many_underpowered', 'none', 'some', 'counts', 'routers']);
  for (const l of block[1].trim().split('\n')) assert.ok(/ABOVE_PLACEBO|beat the fake|not measured|UNDERPOWERED|left out/.test(l), l);
  assert.ok(/N is 16/.test(note));
  for (const s of ['find-skills', 'agent-browser', 'hyperframes', 'hyperframes-registry', 'grill-me', 'grill-with-docs']) assert.ok(note.includes(s), s);
  // B1: the fixed judge, by the policy's own line, and the same-model limitation in the library's words.
  assert.match(note, /The judge is claude-haiku-5-5, the judge the judge policy fixes/);
  assert.ok(note.includes(POLICY), 'the policy sentence'); assert.ok(note.includes('(/judge-policy/)'), 'the policy page cited');
  assert.ok(note.includes(LIMITATION), 'the limitation, verbatim'); assert.ok(note.includes('run.judge.relationship'));
  assert.ok(!note.includes(SONNET + ', not the target'), 'no Sonnet judge');
  // M1: Report 018 stands alone.
  assert.match(note, /show no Report 017 or Report 015 reading, verdict, count or\nfigure\. One methods sentence names the design and what changed/);
  assert.ok(note.includes(NOT_COMPARED), 'the policy line on different graders');
  assert.match(note, /Both stay in the 16/);
  // m6: the hand-off preflight over all 20 supplied texts.
  assert.match(note, /applies the rule\nto all 20 supplied texts, and refuses unless the texts that pass it are exactly these two/);
  // m5: the fence rule is stated.
  assert.match(note, /The fence is named by the plan's\nreport number, `report-018-headlines`; a note fenced for another report refuses/);
});

test('AC-6, m7 (A-655-1): the round budget is recorded in prior-spend.json and the spec; the corrections are the chain\'s', () => {
  const ps = json(path.join(DIR, 'prior-spend.json'));
  // A-655-1: four corrections, each a USD 0 outcome of a manifest in the chain, bound to its note.
  const chain = R().readLog(path.join(ROOT, CAMPAIGN)).map((e) => ({ file: e.manifest, sha256: sha256(fs.readFileSync(path.join(ROOT, CAMPAIGN, e.manifest))) }));
  const ids = new Set(json(path.join(DIR, 'plan.json')).execution.attempts.map((a) => a.attempt_id));
  assert.equal(ps.corrections.length, 4);
  for (const c of ps.corrections) {
    assert.ok(chain.some((m) => m.sha256 === c.manifest_sha256), 'a manifest of the chain');
    assert.ok(ids.has(c.attempt_id)); assert.equal(c.cost_usd, 0); assert.equal(sha256(c.note), c.note_sha256);
  }
  assert.deepEqual(ps.corrections.map((c) => c.manifest_sha256), [chain[0].sha256, chain[0].sha256, chain[0].sha256, chain[1].sha256]);
  assert.equal(ps.round_budget.budget_usd, 500); assert.equal(ps.round_budget.spent_usd, 27.59); assert.equal(ps.round_budget.remaining_usd, 472.41);
  assert.equal(round4(ps.round_budget.spent.reduce((n, s) => n + s.usd, 0)), 27.59);
  assert.deepEqual(ps.round_budget.spent.map((s) => s.campaign_root), ['receipts/report-017b', 'receipts/report-017c']);
  const spec = fs.readFileSync(path.join(DIR, 'spec.md'), 'utf8');
  assert.match(spec, /USD 500, of which\n\s*USD 27\.59 was spent/);
});

test('AC-11, m1: Report 017\'s publication under spec 613\'s default protocol is unchanged, by digest', () => {
  const { publication } = require(path.join(ROOT, S613, 'publication.cjs'));
  const r = publication({ campaignRoot: path.join(ROOT, ROSTER), stub: false });
  assert.equal(sha256(JSON.stringify(r.headline)), 'f825d16874e99058a62a0a570fb66bb65c03535def97928e88818059a6e4b7f3');
  assert.equal(sha256(JSON.stringify(r.rows)), '248fedd402527923cbb7dda141f172f9fdae197248607df44af3c4e8cc269529');
  assert.equal(sha256(JSON.stringify(r.tally)), 'b99c49f921ea182d738dadfbb60442d8bf7fa30c545c0c7b1f6ab55b05ee7097');
});

test('AC-4, AC-12: build-plan --check reproduces plan.json and prints the committed projection table', () => {
  const r = node([path.join(DIR, 'build-plan.cjs'), '--check']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| Planned calls \| Recorded usage repriced USD \| At the sampling maximum USD \| Report 017 recorded USD \| Fixed-token reference USD \| Sum of max_usd \| Cap \| Round remainder USD \|$/m);
  assert.equal(r.stdout.split('\n').filter((l) => /^\| \d+ \| /.test(l)).length, 21, '20 attempt rows and the total row are printed');
  // A-655-1: the plan is historical, so --check renders the table from the committed plan and says so.
  assert.match(r.stdout, /^report 018 plan: 20 attempts; 10800 planned calls; .*no spend; current \(historical: the frozen plan of receipts\/report-018; not rebuilt from the live tree\)$/m);
  const md = fs.readFileSync(path.join(DIR, 'projection.md'), 'utf8');
  for (const l of r.stdout.split('\n').filter((x) => x.startsWith('|'))) assert.ok(md.includes(l), 'the printed table is the committed one: ' + l);
  const plan = json(path.join(DIR, 'plan.json'));
  assert.equal(plan.outcomes.sha256, sha256(fs.readFileSync(path.join(DIR, 'outcomes.md'))));
  assert.equal(plan.report, '018'); assert.equal(plan.plan_version, 2); assert.equal(plan.protocol_state, 'frozen'); assert.equal(plan.spend_authorized, false);
  // The frozen plan's hash, as the spec's status line records it.
  const pin = /<!--plan_sha256-->([0-9a-f]{64})<!--\/plan_sha256-->/.exec(fs.readFileSync(path.join(DIR, 'spec.md'), 'utf8'));
  assert.ok(pin, 'the spec pins the plan'); assert.equal(pin[1], sha256(fs.readFileSync(path.join(DIR, 'plan.json'))));
});

test('AC-1 to AC-4: the frozen plan is Report 017\'s twenty, in order, with its pins, Haiku 5.5 target and judge, three arms, new ids', () => {
  const plan = json(path.join(DIR, 'plan.json')); const source = roster();
  assert.equal(plan.execution.attempts.length, 20); assert.equal(plan.rows.length, 20);
  assert.equal(plan.model, HAIKU); assert.equal(plan.judge, HAIKU); assert.equal(plan.arms, 3); assert.equal(plan.samples, 5);
  assert.deepEqual(plan.draws, { min: 3, max: 10 }); assert.equal(plan.cap_usd, 30);
  assert.equal(plan.source.plan, ROSTER + '/plan.json'); assert.equal(plan.source.plan_sha256, sha256(fs.readFileSync(path.join(ROOT, ROSTER, 'plan.json'))));
  // m4: the pricing table and the source pins are named by hash.
  assert.equal(plan.pricing_sha256, sha256(fs.readFileSync(path.join(ROOT, 'specs/408-skill-measurements/pricing.json'))));
  assert.equal(plan.sources_sha256, sha256(fs.readFileSync(path.join(ROOT, 'specs/408-skill-measurements/sources.json'))));
  const PINNED = ['repository', 'skill', 'skill_path', 'commit', 'skill_sha256', 'evals_sha256', 'suite_hash', 'placebo_revision', 'placebo_corpus_hash', 'list', 'judge', 'samples', 'draws', 'capture', 'arms', 'ordinal'];
  for (const [i, a] of plan.execution.attempts.entries()) {
    const s = source.execution.attempts[i];
    for (const k of PINNED) assert.deepEqual(a.protocol[k], s.protocol[k], 'rank ' + (i + 1) + ' ' + k);
    assert.equal(a.protocol.report, '018'); assert.equal(a.protocol.model, HAIKU); assert.equal(a.protocol.judge, HAIKU);
    assert.equal(a.attempt_id, sha256(JSON.stringify(a.protocol)), 'the id is the protocol\'s hash');
    assert.notEqual(a.attempt_id, s.attempt_id, 'a Report 018 id is never a Report 017 id');
    const row = plan.rows[i];
    assert.equal(row.rank, i + 1); assert.equal(row.attempt_id, a.attempt_id); assert.equal(row.skill, s.protocol.skill);
    assert.equal(row.report_017_attempt_id, s.attempt_id); assert.equal(row.report_015_attempt_id, source.rows[i].report_015_attempt_id);
    assert.equal(row.router, P().ROUTERS.includes(row.skill)); assert.equal(row.planned_calls, projectCalls(3, 5, 10, 3)); assert.equal(row.planned_calls, 540);
  }
  assert.deepEqual(plan.routers.skills, source.routers.skills); assert.equal(plan.routers.qualification, source.routers.qualification);
  assert.equal(plan.totals.planned_calls, 10800);
});

test('AC-6, AC-12: the projection is Report 017\'s recorded usage repriced at Haiku 5.5, with ceilings under the cap and the cap under the round remainder', () => {
  const plan = json(path.join(DIR, 'plan.json'));
  let recorded = 0, maximum = 0, ceilings = 0;
  for (const row of plan.rows) {
    const want = repriced(row.rank); assert.equal(want.skill, row.skill);
    const got = row.projection;
    assert.equal(got.recorded_usd, round4(want.recorded), row.skill + ' recorded');
    assert.equal(got.maximum_usd, round4(want.maximum), row.skill + ' at the sampling maximum');
    assert.equal(got.judge_usd, round4(want.judge)); for (const k of ['with_skill', 'baseline', 'placebo']) assert.equal(got.per_arm_usd[k], round4(want.arm[k]), k);
    assert.equal(got.report_017_cost_usd, want.cost); assert.equal(got.report_017_receipt_hash, want.receipt_hash);
    assert.equal(got.generation_model, HAIKU); assert.equal(got.judge_model, HAIKU);
    assert.equal(row.max_usd, round4(round4(want.maximum) * 1.5), row.skill + ' ceiling: the recorded maximum times 1.5');
    assert.equal(got.fixed_token_reference.assumptions.judgeModel, HAIKU); assert.ok(got.fixed_token_reference.estimated_usd > 0);
    recorded += want.recorded; maximum += want.maximum; ceilings += row.max_usd;
  }
  assert.equal(plan.totals.recorded_usd, round4(recorded)); assert.equal(plan.totals.maximum_usd, round4(maximum)); assert.equal(plan.totals.max_usd, round4(ceilings));
  assert.ok(plan.totals.max_usd < plan.cap_usd, 'the ceilings, not the cap, bound a campaign that reaches every planned call');
  assert.equal(plan.totals.report_017_cost_usd, round4(manifest().outcomes.reduce((n, o) => n + o.cost_usd, 0)));
  assert.equal(plan.max_usd_basis, 'Report 017 recorded usage repriced at the sampling maximum, times 1.5');
  assert.equal(plan.totals.max_usd, 17.5949, 'N2: the sum of the rounded per-attempt ceilings');
  // N1: the same-model limitation, derived from the frozen plan in the library's own words.
  const { repositoryJudgeRelationship } = require(path.join(ROOT, 'lib/receipt'));
  assert.equal(plan.judge_relationship, repositoryJudgeRelationship(plan.model, plan.judge).limitation);
  assert.equal(plan.judge_relationship, LIMITATION);
  // m7: the round budget, carried from prior-spend.json; the cap fits the remainder.
  const ps = json(path.join(DIR, 'prior-spend.json'));
  assert.deepEqual(plan.round_budget, { budget_usd: ps.round_budget.budget_usd, spent_usd: ps.round_budget.spent_usd, remaining_usd: ps.round_budget.remaining_usd });
  assert.ok(plan.cap_usd <= plan.round_budget.remaining_usd);
  // m2: a manifest whose rank 1 receipt is another skill's refuses the build.
  const swapped = fixture({ refuse: true, before: (root) => { const m = path.join(root, ROSTER, 'campaign-1/manifest.json'); const j = json(m); [j.outcomes[0], j.outcomes[1]] = [j.outcomes[1], j.outcomes[0]]; fs.writeFileSync(m, JSON.stringify(j)); } });
  assert.equal(swapped, 'PROJECTION_SOURCE');
});

test('AC-9: the hand-off skills are Report 017\'s two, by this plan\'s ids, with the rule\'s note and their pinned bytes', () => {
  const plan = json(path.join(DIR, 'plan.json')); const source = roster();
  const skills = H.ATTEMPTS.map((id) => source.execution.attempts.find((a) => a.attempt_id === id).protocol.skill);
  assert.deepEqual(P().HANDOFF_SKILLS, skills);
  assert.deepEqual(plan.handoff.skills, skills);
  assert.deepEqual(plan.handoff.attempt_ids, skills.map((s) => plan.execution.attempts.find((a) => a.protocol.skill === s).attempt_id));
  assert.equal(plan.handoff.rule, 'scripts/skill-handoff.js handsOffOnly');
  const texts = H.committed(ROOT);
  assert.equal(plan.handoff.note, H.note(texts, 'the pre-registered counts'));
  for (const t of texts) assert.equal(plan.execution.attempts.find((a) => a.protocol.skill === t.skill).protocol.skill_sha256, t.sha256, 'the same bytes as the committed text');
  for (const row of plan.rows) assert.equal(row.handoff, skills.includes(row.skill), row.skill);
  // Plant: one byte added to a hand-off text refuses the build.
  const f = fixture(); const id = f.roster.execution.attempts.find((a) => a.protocol.skill === skills[0]).attempt_id;
  fs.appendFileSync(path.join(f.panel, id + '.md'), '\n');
  assert.equal(buildCode(f.root), 'HANDOFF_BINDING');
  // m2: a hand-off text with prose after its call, pinned as such, does not pass the rule.
  const prose = handsOff(skills[0]).trimEnd() + ' Then write a summary.\n';
  assert.equal(H.handsOffOnly(prose), false, 'control: the rule refuses the text');
  assert.equal(fixture({ refuse: true, texts: { [skills[0]]: prose } }), 'HANDOFF_RULE');
});

test('AC-7: estimation is offline; a provider, process or network call fails PROVIDER_CALL', () => {
  const builder = JSON.stringify(path.join(DIR, 'build-plan.cjs'));
  const control = node(['-e', 'const B=require(' + builder + ');B.buildPlan();console.log("built")']);
  assert.equal(control.status, 0, control.stderr); assert.equal(control.stdout.trim(), 'built');
  const plants = [
    "require('../../lib/cost').estimateRunCostUSD=()=>require('../../lib/provider').complete({})",
    "require('../../lib/cost').estimateRunCostUSD=()=>require('node:child_process').spawnSync('forbidden')",
    "require('../../lib/cost').estimateRunCostUSD=()=>fetch('https://example.invalid')",
  ];
  for (const plant of plants) {
    const script = 'process.chdir(' + JSON.stringify(DIR) + ');' + plant.replaceAll("'../../lib/", "'" + ROOT + "/lib/") + ';try{require(' + builder + ').buildPlan();process.exitCode=2;}catch(e){if(e.code!==\'PROVIDER_CALL\')throw e;console.log(e.code);}';
    const r = node(['-e', script]);
    assert.equal(r.status, 0, plant + ': ' + r.stderr); assert.equal(r.stdout.trim(), 'PROVIDER_CALL', plant);
  }
});

test('AC-1 to AC-4, AC-6, AC-9: readPlan refuses every planted change to the frozen plan before any call', () => {
  const f = fixture();
  assert.equal(R().readPlan(f.root).plan.execution.attempts.length, 20, 'control: the fixture plan reads');
  readsAs(f, (p) => { const [a, b] = [p.execution.attempts[0], p.execution.attempts[1]]; [a.protocol.ordinal, b.protocol.ordinal] = [b.protocol.ordinal, a.protocol.ordinal]; reid(a); reid(b); p.execution.attempts[0] = b; p.execution.attempts[1] = a; }, 'PLAN_BINDING', 'two attempts swapped');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.skill_sha256 = 'a'.repeat(64); reid(p.execution.attempts[3]); }, 'SKILL_BYTES', 'another skill pin');
  readsAs(f, (p) => { p.execution.attempts[3].protocol.suite_hash = 'b'.repeat(64); reid(p.execution.attempts[3]); }, 'SUITE_BINDING', 'another suite hash');
  readsAs(f, (p) => { p.execution.attempts[5].protocol.placebo_corpus_hash = 'c'.repeat(64); reid(p.execution.attempts[5]); }, 'PLAN_BINDING', 'another corpus');
  readsAs(f, (p) => { p.execution.attempts[2].protocol.model = SONNET; reid(p.execution.attempts[2]); }, 'PLAN_BINDING', 'another target on one attempt');
  readsAs(f, (p) => { p.model = SONNET; }, 'PLAN_BINDING', 'another target on the plan');
  readsAs(f, (p) => { p.execution.attempts[2].protocol.judge = SONNET; reid(p.execution.attempts[2]); }, ['PLAN_BINDING', 'JUDGE_INELIGIBLE'], 'a Sonnet judge on one attempt');
  readsAs(f, (p) => { p.judge = SONNET; }, ['PLAN_BINDING', 'JUDGE_INELIGIBLE'], 'a Sonnet judge on the plan');
  readsAs(f, (p) => { p.report = '017'; }, 'PLAN_BINDING', 'another report');
  readsAs(f, (p) => { p.execution.attempts[7].protocol.arms = 2; reid(p.execution.attempts[7]); }, 'PLAN_BINDING', 'two arms on one attempt');
  readsAs(f, (p) => { p.execution.attempts[9].attempt_id = 'd'.repeat(64); }, 'PLAN_BINDING', 'an id that is not its protocol\'s hash');
  readsAs(f, (p) => { p.rows[0].max_usd = 100; }, 'PLAN_BINDING', 'a raised ceiling');
  readsAs(f, (p) => { p.cap_usd = 1000; }, 'PLAN_BINDING', 'a raised cap');
  // Plant: a byte of a pinned runner file.
  const run = path.join(f.root, 'lib/run.js'); const live = fs.readFileSync(run); fs.appendFileSync(run, '\n');
  try { assert.throws(() => R().readPlan(f.root), code('RUNNER_BINDING')); } finally { fs.writeFileSync(run, live); }
  // Plant: a template edited in the note.
  const note = path.join(f.root, SPEC, 'outcomes.md'); const bytes = fs.readFileSync(note);
  fs.writeFileSync(note, bytes.toString('utf8').replace('All {N} skills beat the fake', 'Every one of the {N} skills beat the fake'));
  try { assert.throws(() => R().readPlan(f.root), code('OUTCOMES_BINDING')); } finally { fs.writeFileSync(note, bytes); }
});

test('AC-2, AC-9: the preflight refuses supplied bytes that are not the pin, and a hand-off set that is not the plan\'s, before any call', async () => {
  const f = fixture(); const ctx = R().readPlan(f.root);
  const ready = R().preflight(ctx, f.inputs);
  assert.equal(ready.problem, null, 'control: the fixture inputs are ready'); assert.ok(ready.rows.every((r) => r.status === 'ok'));
  const a = ctx.plan.execution.attempts[4]; fs.appendFileSync(path.join(f.inputs, a.attempt_id + '.md'), ' ');
  assert.equal(R().preflight(ctx, f.inputs).rows.find((r) => r.attempt_id === a.attempt_id).status, 'SKILL_BYTES');
  const none = noRun();
  await assert.rejects(R().runCampaign({ root: f.root, campaignRoot: fresh(), inputs: f.inputs, evalHome: f.home, adapters: none.adapters }), code('SKILL_BYTES'));
  // m6: a third supplied text that hands off, pinned as such, is not this plan's hand-off set.
  const g = fixture({ texts: { tdd: handsOff('tdd') } }); const gctx = R().readPlan(g.root);
  const r = R().preflight(gctx, g.inputs);
  assert.equal(r.problem, 'HANDOFF_SET'); assert.equal(r.rows.find((x) => x.skill === 'tdd').status, 'HANDOFF_SET');
  await assert.rejects(R().runCampaign({ root: g.root, campaignRoot: fresh(), inputs: g.inputs, evalHome: g.home, adapters: none.adapters }), code('HANDOFF_SET'));
  assert.equal(none.runs, 0);
});

test('AC-5, AC-8, AC-10, AC-11: a stub campaign writes 20 placebo stub receipts, each NOT_MEASURED, under this plan, through spec 613\'s driver', async () => {
  const f = fixture(); const croot = fresh();
  const m = await R().runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home });
  assert.equal(m.report, '018'); assert.equal(m.plan_sha256, sha256(f.bytes)); assert.equal(m.cap_usd, 30); assert.equal(m.stub, true);
  assert.equal(m.outcomes.length, 20); assert.ok(m.outcomes.every((o) => o.status === 'receipt'));
  const file = path.join(croot, R().readLog(croot).at(-1).manifest); const out = path.dirname(file);
  for (const [i, o] of m.outcomes.entries()) {
    const a = f.plan.execution.attempts[i]; assert.equal(o.attempt_id, a.attempt_id);
    const r = json(path.join(out, a.attempt_id + '.json'));
    assert.equal(r.verification_level, 'UNVERIFIED'); assert.ok(r.placebo, 'the block'); assert.equal(r.results.cases.filter((c) => c.mode === 'placebo').length, 3);
    assert.equal(r.run.model_id, HAIKU); assert.equal(r.run.judge.model_id, HAIKU);
    assert.equal(r.results.cases[0].generation.issue408.plan_sha256, sha256(f.bytes)); assert.equal(r.results.cases[0].generation.issue408.attempt_id, a.attempt_id);
    assert.equal(receiptVerdict(r).verdict, 'NOT_MEASURED'); assert.equal(placeboReading(r).reading, 'NOT_MEASURED');
  }
  // N1: the publication reader attaches the plan's judge relationship to every row, in the library's words.
  const pub = R().publication({ root: f.root, campaignRoot: croot, stub: true, recordedHeads: { [sha256(f.bytes)]: FIXTURE_HEAD }, reader: codeAt(f) });
  assert.equal(pub.rows.length, 20); assert.ok(pub.rows.every((r) => r.judge_relationship === LIMITATION)); assert.equal(pub.judge_relationship, LIMITATION);
  assert.equal(pub.tally.shape, 'not_read'); assert.match(pub.headline[0], /^16 of 16 skills were not measured against the same-length placebo on Haiku 5.5/);
  assert.equal(pub.handoff_note, f.plan.handoff.note); assert.deepEqual(pub.rows.filter((r) => r.handoff).map((r) => r.skill), P().HANDOFF_SKILLS);
  // N4: plants through this directory's bound verifier. The block dropped (PLACEBO_ARM); the block edited after the seal (RECEIPT_SEAL).
  const ctx0 = R().readPlan(f.root); const first = json(path.join(out, f.plan.execution.attempts[0].attempt_id + '.json'));
  const answers = json(path.join(out, f.plan.execution.attempts[0].attempt_id + '-answers.json'));
  const noBlock = structuredClone(first); delete noBlock.placebo;
  assert.throws(() => R().placeboArm(ctx0, ctx0.plan.execution.attempts[0], noBlock), code('PLACEBO_ARM'));
  const edited = structuredClone(first); edited.placebo.seed = 'f'.repeat(64);
  assert.throws(() => R().verifyPlaceboOutcome(ctx0, ctx0.plan.execution.attempts[0], edited, answers), code('RECEIPT_SEAL'));
  assert.doesNotThrow(() => R().placeboArm(ctx0, ctx0.plan.execution.attempts[0], first), 'control: the sealed stub receipt passes the arm check');
  // The exports are spec 613's functions bound to this protocol: a second unchained start refuses before any run.
  const none = noRun();
  await assert.rejects(R().runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home, adapters: none.adapters }), code('CAMPAIGN_STARTED'));
  // m2: a copy of the finished campaign beside the chain owns the same receipts.
  const copy = fs.mkdtempSync('/var/tmp/report018-dup-'); fs.cpSync(out, copy, { recursive: true });
  const dup = path.join(copy, 'manifest.json'); fs.writeFileSync(dup, JSON.stringify({ ...json(dup), copy: true }));
  await assert.rejects(R().runCampaign({ root: f.root, campaignRoot: croot, inputs: f.inputs, evalHome: f.home, prior: [file, dup], adapters: none.adapters }), code('PRIOR_DUPLICATE_RECEIPT'));
  assert.equal(none.runs, 0); assert.equal(R().readLog(croot).length, 1, 'a refused start writes no log line');
  // AC-10 (m3): a Report 017 receipt is not a Report 018 receipt, by its campaign record alone.
  const foreign = json(path.join(ROOT, ROSTER, 'campaign-1', manifest().outcomes[0].attempt_id + '.json'));
  const foreignAnswers = json(path.join(ROOT, ROSTER, 'campaign-1', manifest().outcomes[0].attempt_id + '-answers.json'));
  assert.throws(() => R().sealedFacts(ctx0, ctx0.plan.execution.attempts[0], foreign, foreignAnswers), code('ATTEMPT_BINDING'));
});

test('AC-9, m5: the headline rules over this plan\'s note, fenced by its report; a router moved to ABOVE_PLACEBO moves no count', () => {
  const plan = json(path.join(DIR, 'plan.json'));
  const templates = R().readOutcomes(plan, ROOT);
  assert.deepEqual(Object.keys(templates).sort(), ['all', 'counts', 'many_underpowered', 'none', 'not_read', 'routers', 'some']);
  const readings = new Map(plan.rows.map((r) => [r.attempt_id, 'NO_DIFFERENCE']));
  const before = T().tally(plan, readings);
  for (const r of plan.rows.filter((x) => x.router)) readings.set(r.attempt_id, 'ABOVE_PLACEBO');
  const after = T().tally(plan, readings);
  assert.equal(before.N, 16); assert.equal(after.A, before.A); assert.equal(after.shape, 'none');
  assert.match(T().headline(after, templates)[0], /^None of the 16 skills beat the fake on Haiku 5.5/);
  // Plant: the same note fenced for Report 017, with its hash re-pinned, is not this plan's note.
  const dir = fs.mkdtempSync('/var/tmp/report018-fence-');
  const renamed = fs.readFileSync(path.join(DIR, 'outcomes.md'), 'utf8').replace('```report-018-headlines', '```report-017-headlines');
  const file = path.join(dir, 'outcomes.md'); fs.writeFileSync(file, renamed);
  assert.throws(() => R().readOutcomes({ ...plan, outcomes: { ...plan.outcomes, sha256: sha256(Buffer.from(renamed)) } }, ROOT, file), code('OUTCOMES_BINDING'));
  // Spec 613's own note reads under its plan through the same reader: the fence follows the report.
  assert.deepEqual(R().readOutcomes(roster(), ROOT), T().readOutcomes(roster(), ROOT));
});
