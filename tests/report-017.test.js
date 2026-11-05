// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 627: Report 017's page builder. No model is called: every receipt is the stub's. Each
// campaign root is built by hand under /var/tmp, as spec 613's tests forge prior manifests, without
// runCampaign or its lock. A paid-shaped root carries synthetic judge scores, with every dependent
// figure recomputed and resealed, so the readings below are chosen, not measured.
process.env.DRIFTPROOF_STUB = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'specs/613-placebo-skills-report');
const BUILDER = process.env.REPORT017_BUILDER || path.join(ROOT, 'scripts/prepare-report-017.js');
const P = require(path.join(DIR, 'protocol.cjs'));
const C = require(path.join(ROOT, 'specs/408-skill-measurements/campaign.cjs'));
const P408 = require(path.join(ROOT, 'specs/408-skill-measurements/publication.cjs'));
const R = require(path.join(DIR, 'run-campaign.cjs'));
const T = require(path.join(DIR, 'tally.cjs'));
const { publication } = require(path.join(DIR, 'publication.cjs'));
const { sha256 } = require(path.join(ROOT, 'lib/canonical'));
const { suiteIdentity } = require(path.join(ROOT, 'lib/skill'));
const { sealReceipt, comparisonOf } = require(path.join(ROOT, 'lib/receipt'));
const { mean, stddev, round } = require(path.join(ROOT, 'lib/stats'));
const { acrossDraws } = require(path.join(ROOT, 'lib/sampling'));
const { runSkillOnModel, outcomeFor } = require(path.join(ROOT, 'lib/run'));
const { placeboReading, placeboLine, placeboFigures, placeboPairing, armOf, receiptVerdict, PLACEBO_WORDS } = require(path.join(ROOT, 'lib/verdict'));
const { plainOf } = require(path.join(ROOT, 'lib/plain'));
const placebo = require(path.join(ROOT, 'lib/placebo'));
const policy = require(path.join(ROOT, 'lib/report-015-publication'));
const { auditDirectory } = require(path.join(ROOT, 'specs/408-skill-measurements/eval-audit.cjs'));

const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const code = (c) => (e) => e.code === c;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Tags are stripped until none is left, so a tag split by another (`<<b>b>`) cannot survive; then each
// entity is decoded once, in one pass, so `&amp;lt;` reads as the text `&lt;` and never as `<`.
const ENTITY = { '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const textOf = (html) => {
  let text = html;
  for (let prev = null; prev !== text;) { prev = text; text = text.replace(/<[^>]+>/g, ''); }
  return text.replace(/&(?:quot|#39|lt|gt|amp);/g, (e) => ENTITY[e]);
};
const builder = () => require(BUILDER);
const tmp = (p) => fs.mkdtempSync('/var/tmp/report017-page-' + p + '-');

// The spec 613 fixture: a copy of every input the plan reads, clearly synthetic skill texts in place
// of the pinned ones, and the plan rebuilt over it (tests/report-017-plan.test.js does the same).
const SETTINGS = { permissions: { deny: ['Read', 'WebFetch', 'WebSearch'] }, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, autoMemoryEnabled: false, disableClaudeAiConnectors: true };
const textFor = (skill) => '---\nname: ' + skill + '\n---\nSynthetic test instructions for ' + skill + ' only. No provider call.\n';
function fixture() {
  const root = tmp('fixture');
  const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.cpSync(path.join(ROOT, rel), path.join(root, rel), { recursive: true }); };
  copy(P.SOURCE); copy(P.SPEC); for (const f of P.RUNNER_FILES) copy(f);
  const at = path.join(root, P.SOURCE);
  const plan = json(path.join(at, 'plan.json')); const sources = json(path.join(at, 'sources.json'));
  for (const a of plan.execution.attempts.slice(0, 20)) {
    const p = a.protocol; const s = sources.find((x) => x.repository === p.repository && x.skill === p.skill);
    const old = s.skill_sha256; s.skill_sha256 = sha256(textFor(p.skill));
    const raw = fs.readFileSync(path.join(at, s.suite), 'utf8').replaceAll(old, s.skill_sha256); fs.writeFileSync(path.join(at, s.suite), raw);
    const evals = sha256(raw); const hash = suiteIdentity(JSON.parse(raw)).suiteHash;
    for (const list of ['plain', 'capped']) for (const r of plan[list].rows) if (r.suite === s.suite) { r.evals_sha256 = evals; r.suite_hash = hash; }
    for (const x of plan.execution.attempts) if (x.protocol.repository === p.repository && x.protocol.skill === p.skill) { x.protocol.evals_sha256 = evals; x.protocol.suite_hash = hash; x.attempt_id = sha256(JSON.stringify(x.protocol)); }
  }
  fs.writeFileSync(path.join(at, 'sources.json'), JSON.stringify(sources));
  fs.writeFileSync(path.join(at, 'plan.json'), JSON.stringify(plan));
  const planFile = path.join(root, P.SPEC, 'plan.json');
  const built = spawnSync(process.execPath, ['-e', 'const B=require(process.argv[1]);require("node:fs").writeFileSync(process.argv[3],JSON.stringify(B.buildPlan({root:process.argv[2]}),null,2)+"\\n")', path.join(DIR, 'build-plan.cjs'), root, planFile], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TMPDIR: '/var/tmp' } });
  assert.equal(built.status, 0, built.stderr);
  const inputs = path.join(root, 'inputs'); fs.mkdirSync(inputs);
  const frozen = json(planFile);
  for (const a of frozen.execution.attempts) fs.writeFileSync(path.join(inputs, a.attempt_id + '.md'), textFor(a.protocol.skill));
  const home = path.join(root, 'eval'); fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify(SETTINGS));
  return { root, inputs, home, planFile, plan: frozen };
}
const F = fixture();
// Report 015's ids for the twenty, from the real frozen plan: the fixture's own differ, because its
// skill texts are synthetic.
const REAL = json(path.join(DIR, 'plan.json'));
const R015 = REAL.rows.map((r) => r.report_015_attempt_id);
// Spec 613 A-613-3: a fixture root is not a git repository. Its recorded head is a snapshot of the
// pinned files, the plan and the note, served as git would serve that commit, as spec 613's own tests
// do (tests/report-017-plan.test.js codeAt). The real root is read through git at its recorded head.
const FIXTURE_HEAD = 'f'.repeat(40);
const SNAPSHOT = new Map([...Object.keys(F.plan.runner_hashes), P.SPEC + '/plan.json', P.SPEC + '/outcomes.md'].map((file) => [file, fs.readFileSync(path.join(F.root, file))]));
const READER = { head: () => FIXTURE_HEAD, isAncestor: (h) => h === FIXTURE_HEAD, show: (h, file) => (h === FIXTURE_HEAD && SNAPSHOT.has(file) ? SNAPSHOT.get(file) : null) };
const HEADS = { [sha256(fs.readFileSync(F.planFile))]: FIXTURE_HEAD };

// One start of a campaign root, by hand: a stub run per attempt, annotated as the campaign does;
// the attempts in `fail` are recorded failures with no receipt.
async function stubRoot({ fail = [] } = {}) {
  const ctx = R.readPlan(F.root); const croot = tmp('root');
  fs.copyFileSync(F.planFile, path.join(croot, 'plan.json')); fs.copyFileSync(path.join(F.root, P.SPEC, 'outcomes.md'), path.join(croot, 'outcomes.md'));
  const out = path.join(croot, 'campaign-001'); fs.mkdirSync(out);
  const outcomes = [];
  for (const [i, a] of ctx.plan.execution.attempts.entries()) {
    if (fail.includes(i)) { outcomes.push({ attempt_id: a.attempt_id, status: 'failure', reason: 'CANCELLED', cost_usd: 0 }); continue; }
    const result = await runSkillOnModel({ skill: C.loadSubject(ctx, a, F.inputs), model: a.protocol.model, opts: { placebo: true, judgeModel: a.protocol.judge, samples: 5, maxCalls: 540, keepTranscripts: true, capture: 'text', concurrency: 1, trusted: false } });
    const audit = { ...auditDirectory(F.home, {}, []), isolation: 'eval-user', checked_at: new Date().toISOString(), configuration_unchanged: true };
    const rec = C.annotate(ctx, a, result, audit);
    fs.writeFileSync(path.join(out, a.attempt_id + '.json'), JSON.stringify(rec.receipt, null, 2) + '\n');
    fs.writeFileSync(path.join(out, a.attempt_id + '-answers.json'), JSON.stringify(rec.answers, null, 2) + '\n');
    outcomes.push({ attempt_id: a.attempt_id, status: 'receipt', receipt_hash: rec.receipt.receipt_hash, cost_usd: C.receiptCost(rec.receipt), cost_complete: true, dispatched: true });
  }
  const list = json(path.join(F.root, P.SPEC, 'prior-spend.json')).corrections;
  const head = path.join(out, 'manifest.json');
  fs.writeFileSync(head, JSON.stringify({ format: 'driftproof-skill-campaign/1', report: '017', plan_sha256: ctx.plan_hash, cap_usd: 400, stub: true, corrections: { count: list.length, sha256: sha256(JSON.stringify(list)) }, priors: [], outcomes, spent_usd: outcomes.reduce((n, o) => n + o.cost_usd, 0) }, null, 2) + '\n');
  fs.appendFileSync(path.join(croot, 'campaign.log'), JSON.stringify({ plan_sha256: ctx.plan_hash, manifest: 'campaign-001/manifest.json', priors: [] }) + '\n');
  return { croot, out, head, ctx };
}
// Rewrite one receipt's judge outputs to the scores `score(row)` gives, and every figure that
// depends on them, as the runner would have written them.
function rescore(r, answers, score) {
  let k = 0;
  for (const c of r.results.cases) {
    const g = c.generation;
    for (const d of g.draws) {
      const ev = answers.draws[k++]; const s = score(c);
      ev.judge_outputs = ev.judge_outputs.map((_, i) => JSON.stringify({ score: s, reason: 'synthetic test score ' + i }));
      d.samples = ev.judge_outputs.map(() => s); d.judge_sample_hashes = ev.judge_outputs.map(sha256);
      d.mean = round(mean(d.samples)); d.stddev = round(stddev(d.samples));
    }
    Object.assign(g, acrossDraws(g.draws));
    c.mean = c.score = g.mean; c.stddev = g.sd; c.outcome = outcomeFor(c.mean, c.stddev, c.threshold);
    const last = g.draws.at(-1); for (const key of ['samples', 'generation_hash', 'judge_sample_hashes']) c[key] = structuredClone(last[key]);
  }
  const x = comparisonOf(r.results.cases); r.results.aggregates = x.aggregates; r.comparison = x.comparison;
  const f = placeboFigures(r, placeboPairing(r).ids);
  r.placebo.aggregates = { ...f.aggregates, ...('excluded_cases' in (r.placebo.aggregates || {}) ? { excluded_cases: r.placebo.aggregates.excluded_cases } : {}) };
  r.placebo.comparison = f.comparison;
}
// Write a receipt back sealed, its answers and its manifest outcome bound to the new hash.
function reseal(root, i, r, answers) {
  sealReceipt(r); answers.receipt_hash = r.receipt_hash;
  const id = root.ctx.plan.execution.attempts[i].attempt_id;
  fs.writeFileSync(path.join(root.out, id + '.json'), JSON.stringify(r, null, 2) + '\n');
  fs.writeFileSync(path.join(root.out, id + '-answers.json'), JSON.stringify(answers, null, 2) + '\n');
  const m = json(root.head); m.outcomes[i].receipt_hash = r.receipt_hash; fs.writeFileSync(root.head, JSON.stringify(m, null, 2) + '\n');
}
const ARMS = { above: { with_skill: 0.9, baseline: 0.3, placebo: 0.3 }, below: { with_skill: 0.3, baseline: 0.3, placebo: 0.9 }, level: { with_skill: 0.5, baseline: 0.5, placebo: 0.5 } };
// Routers always read above the placebo, so a count that took them in would show it.
const patternOf = (i) => (REAL.rows[i].router ? 'above' : ['above', 'below', 'level'][i % 3]);
// A paid-shaped root: each receipt marked as the paid path seals one (spec 613's modelShaped) and
// rescored by its pattern; `arms` may change a pattern's scores.
async function paidRoot({ fail = [19], arms = ARMS } = {}) {
  const root = await stubRoot({ fail });
  const m = json(root.head);
  for (const [i, o] of m.outcomes.entries()) {
    if (o.status !== 'receipt') continue;
    const a = root.ctx.plan.execution.attempts[i];
    const r = json(path.join(root.out, a.attempt_id + '.json')); const answers = json(path.join(root.out, a.attempt_id + '-answers.json'));
    r.verification_level = 'TESTED'; r.run.surface = 'claude-cli'; r.run.harness = { name: 'claude', version: 'synthetic-fixture' };
    r.run.answered_by = { kind: 'model', attested: true, reported_model: a.protocol.model, reported_models: [a.protocol.model], isolation: 'eval-user' };
    r.run.judge.surface = 'claude-cli'; r.run.judge.harness = { name: 'claude', version: 'synthetic-fixture' }; r.run.judge.isolation = 'eval-user'; r.run.judge.reported_models = [a.protocol.judge]; r.run.judge.endpoint.resolved_by = 'cli';
    for (const c of r.results.cases) for (const d of c.generation.draws) d.reported_model = a.protocol.model;
    rescore(r, answers, (c) => arms[patternOf(i)][c.mode]);
    reseal(root, i, r, answers);
  }
  const head = json(root.head); head.stub = false; fs.writeFileSync(root.head, JSON.stringify(head, null, 2) + '\n');
  return root;
}
const opts = (root, extra = {}) => ({ root: F.root, campaignRoot: root.croot, panelDir: F.inputs, report015Ids: R015, out: tmp('out'), placeboPage: false, recordedHeads: HEADS, reader: READER, ...extra });
const receiptOf = (root, i) => json(path.join(root.out, root.ctx.plan.execution.attempts[i].attempt_id + '.json'));
// The page's section for one attempt.
const sectionOf = (html, id) => { const at = html.indexOf('data-attempt="' + id + '"'); assert.ok(at > 0, id); return html.slice(at, html.indexOf('</section>', at)); };

test('AC-3, AC-4, AC-5, AC-11, AC-12, AC-13, AC-14: a paid-shaped campaign builds a page whose every line is the library\'s, and --check reproduces it', async () => {
  const root = await paidRoot(); const o = opts(root); const B = builder();
  const done = B.writeReport(o); const html = fs.readFileSync(done.page, 'utf8');
  assert.deepEqual(fs.readdirSync(o.out, { recursive: true }).filter((f) => fs.statSync(path.join(o.out, f)).isFile()).sort(), ['data/report-summaries.json', 'reports/017/index.html'], 'AC-15: only the page and the summaries are written');
  assert.doesNotThrow(() => B.checkReport(o), 'AC-14 control: the page just written passes --check');
  // Independent oracle: each receipt file read here, and its lines computed by the library here.
  const attempts = root.ctx.plan.execution.attempts;
  assert.deepEqual([...html.matchAll(/data-attempt="([a-f0-9]{64})"/g)].map((m) => m[1]), attempts.map((a) => a.attempt_id), 'AC-2: one row per attempt, in plan order');
  const counted = { ABOVE_PLACEBO: 0, BELOW_PLACEBO: 0, NO_DIFFERENCE: 0, INCONCLUSIVE: 0, UNDERPOWERED: 0, NOT_MEASURED: 0 };
  let routerAbove = 0;
  for (const [i, a] of attempts.entries()) {
    const s = sectionOf(html, a.attempt_id); const text = textOf(s);
    if (i === 19) {
      assert.match(s, /data-reading="NOT_MEASURED"/); assert.ok(text.includes('no sealed receipt for this attempt (CANCELLED)'), 'AC-2: a failure renders its reason');
      counted.NOT_MEASURED += 1; continue;
    }
    const r = receiptOf(root, i); const reading = placeboReading(r);
    assert.ok(text.includes('Against the same-length placebo: ' + placeboLine(reading)), 'AC-3: the placebo line, verbatim, rank ' + (i + 1));
    if (REAL.rows[i].router) {
      // A-627-3 (M2): a router's row reads the limit's label, never a skill verdict.
      assert.ok(text.includes('Against no skill: ' + policy.LABEL + '.'), 'a router row reads the limit');
      assert.doesNotMatch(text, /The skill clearly (helped|hurt)|Too few answers to tell|No clear difference/, 'no skill verdict on a router row');
    } else {
      const pr = plainOf(r);
      assert.ok(text.includes('Against no skill: ' + pr.sentence), 'AC-3: the verdict sentence, verbatim');
      // A-627-3 (M1): its why and each task's state against no skill, from the receipt's own rows.
      if (pr.why !== pr.sentence) assert.ok(text.includes(pr.why), 'the verdict\'s why');
      for (const c of receiptVerdict(r).cases) {
        const w = armOf(r.results.cases.find((x) => x.id === c.id && x.mode === 'with_skill')); const b = armOf(r.results.cases.find((x) => x.id === c.id && x.mode === 'baseline'));
        assert.ok(text.includes(c.id + ' (' + c.state + '): with the skill ' + w.mean + ' plus or minus ' + w.sd + '; without it ' + b.mean + ' plus or minus ' + b.sd + '.'), 'the task against no skill');
      }
    }
    for (const c of reading.cases) {
      const w = armOf(r.results.cases.find((x) => x.id === c.id && x.mode === 'with_skill')); const p = armOf(r.results.cases.find((x) => x.id === c.id && x.mode === 'placebo'));
      assert.ok(text.includes(c.id + ' (' + c.state + '): with the skill ' + w.mean + ' plus or minus ' + w.sd + '; with the same-length placebo ' + p.mean + ' plus or minus ' + p.sd + '.'), 'AC-3: the task with both bands');
    }
    assert.equal(reading.reading, { above: 'ABOVE_PLACEBO', below: 'BELOW_PLACEBO', level: 'NO_DIFFERENCE' }[patternOf(i)], 'the fixture reads its chosen reading');
    // The secondary reading, by hand: the placebo's scores against the baseline's.
    const second = { above: 'NO_DIFFERENCE', below: 'PLACEBO_ABOVE_BASELINE', level: 'NO_DIFFERENCE' }[patternOf(i)];
    assert.ok(text.includes('The placebo against no skill, shown here and not counted: ' + second), 'AC-6: the secondary reading');
    if (REAL.rows[i].router) {
      routerAbove += reading.reading === 'ABOVE_PLACEBO' ? 1 : 0;
      assert.ok(text.includes(policy.REASON) && s.includes('href="/reports/015/#amendment-1"') && text.includes('Left out of the headline count.'), 'AC-5: the router qualification');
    } else counted[reading.reading] += 1;
    assert.ok(text.includes('Context only, not this measurement: Report 015 read this skill in a separate, earlier run on '), 'AC-9: Report 015 as context');
    assert.ok(s.includes('data-src="receipts/skill-measurements/published/' + R015[i] + '.json"'), 'AC-9: its date names its own sealed receipt');
    assert.doesNotMatch(s.slice(0, s.indexOf('class="placebo-line"')), /<data /, 'AC-11: the heading and router lines carry no figure');
  }
  assert.equal(routerAbove, 4, 'every router reads above the placebo in this fixture');
  // AC-4: the headline, filled by hand from the counts above over the 16.
  assert.equal(Object.values(counted).reduce((n, x) => n + x, 0), 16);
  const A = counted.ABOVE_PLACEBO; assert.ok(A > 0 && A < 16);
  const big = textOf(/<p class="big"[^>]*>([\s\S]*?)<\/p>/.exec(html)[1]);
  assert.equal(big, 'On Claude Sonnet 5.5, ' + A + ' of 16 skills beat the fake: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none. A skill that did not beat the fake is not shown to do no better than it.');
  assert.equal(textOf(/<p class="headline-counts" data-fn="placebo-tally">([\s\S]*?)<\/p>/.exec(html)[1]), 'Of the 16: ABOVE_PLACEBO ' + A + ', BELOW_PLACEBO ' + counted.BELOW_PLACEBO + ', NO_DIFFERENCE ' + counted.NO_DIFFERENCE + ', INCONCLUSIVE 0, UNDERPOWERED 0, NOT_MEASURED ' + counted.NOT_MEASURED + '. Beat the fake means ABOVE_PLACEBO only.');
  assert.match(textOf(/<p class="headline-routers">([\s\S]*?)<\/p>/.exec(html)[1]), /^find-skills, agent-browser, hyperframes and hyperframes-registry are left out of these counts/);
  // AC-10: the panel is the shortest counted skill, its text the input's, its fake rebuilt here by placeboFor.
  const pick = attempts.map((a, i) => ({ a, i })).filter(({ i }) => i !== 19 && !REAL.rows[i].router).sort((x, y) => Buffer.byteLength(textFor(x.a.protocol.skill)) - Buffer.byteLength(textFor(y.a.protocol.skill)) || x.i - y.i)[0];
  const skillText = textFor(pick.a.protocol.skill); const fake = placebo.placeboFor({ skillText, seed: receiptOf(root, pick.i).skill.content_hash }).text;
  assert.ok(html.includes('<pre class="panel-skill">' + esc(skillText) + '</pre>') && html.includes('<pre class="panel-placebo">' + esc(fake) + '</pre>'), 'AC-10: the panel');
  assert.ok(!html.includes('href="/placebo/"'), 'AC-10: no link while docs/placebo/ does not exist');
  assert.ok(B.buildReport({ ...o, placeboPage: true }).html.includes('<a href="/placebo/">Fake my file</a>'), 'AC-10: the link once it does');
  // AC-11: no confidence lexicon, ratio or ranking word in the visible text; every number element names a source.
  const visible = textOf(html.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<head>[\s\S]*?<\/head>/, ''));
  assert.doesNotMatch(visible, /\b(confiden\w*|significan\w*|likely|probabl\w*|prove[sn]?|proof|ratio|ranking|ranked|winners?|best|worst|percent)\b|%/i);
  for (const m of html.matchAll(/<data value="(\d[\d.]*)"([^>]*)>/g)) assert.match(m[2], /data-src="[^"]+"/, 'a number element names its source');
  // AC-12: the run record.
  const record = textOf(/<section id="campaign-run-record">([\s\S]*?)<\/section>/.exec(html)[1]);
  assert.ok(record.includes('Recorded costs are API-equivalent estimates, not a subscription invoice.') && record.includes('The surface was claude-cli.'));
  assert.ok(record.includes('campaign-001/manifest.json, SHA-256 ' + sha256(fs.readFileSync(root.head))), 'the manifest and its hash');
  assert.ok(record.includes('Plan SHA-256 ' + sha256(fs.readFileSync(path.join(root.croot, 'plan.json')))) && record.includes('Pre-registered note SHA-256 ' + sha256(fs.readFileSync(path.join(root.croot, 'outcomes.md')))));
  for (const f of B.READER) assert.ok(record.includes(f + ', SHA-256 ' + sha256(fs.readFileSync(path.join(ROOT, f)))), 'the reader pin ' + f);
  assert.ok(record.includes('19 of 20 attempts have a sealed receipt'));
  // AC-13: the limits.
  const limits = textOf(html.slice(html.indexOf('<h2>Limits</h2>'), html.indexOf('<section id="campaign-run-record">')));
  for (const s of [P408.SCOPE, P408.ISOLATION, P408.ROUTER, 'The placebo text is not inert', 'It does not combine the 20 readings into one score.', 'a placebo text can still bear on a task by chance']) assert.ok(limits.includes(s), s);
  // AC-14: a committed page edited while the receipts stay refuses --check.
  const plants = [
    ['a placebo line retyped', (h) => h.replace(esc(PLACEBO_WORDS.ABOVE_PLACEBO), 'beat the fake')],
    ['a tally count changed', (h) => h.replace(/(<p class="headline-counts" data-fn="placebo-tally">Of the <data value="16"[^>]*>16<\/data>: ABOVE_PLACEBO <data value=")(\d+)("[^>]*>)(\d+)/, (_, a, n, b) => a + (Number(n) + 1) + b + (Number(n) + 1))],
    ['a dek word changed', (h) => h.replace('skills beat the fake: by the case rule', 'skills outscored the fake: by the case rule')],
  ];
  for (const [what, edit] of plants) {
    const edited = edit(html); assert.notEqual(edited, html, what + ' is planted');
    fs.writeFileSync(done.page, edited); assert.throws(() => B.checkReport(o), code('REPORT_DRIFT'), what);
  }
  fs.writeFileSync(done.page, html);
  const summary = fs.readFileSync(done.summaryFile, 'utf8');
  fs.writeFileSync(done.summaryFile, summary.replace('beat the fake', 'outscored the fake')); assert.throws(() => B.checkReport(o), code('REPORT_SUMMARY_DRIFT'), 'a summary word');
  fs.writeFileSync(done.summaryFile, summary); assert.doesNotThrow(() => B.checkReport(o), 'control: restored');
  // The summary row quotes the page.
  for (const p of json(done.summaryFile).reports['017'].points) assert.ok(textOf(html).includes(p.text), p.lead);
});

test('AC-1: a score edited and resealed is refused by the reconstruction, which the reader alone does not see', async () => {
  const root = await paidRoot(); const B = builder(); const i = 1;
  const a = root.ctx.plan.execution.attempts[i]; const r = receiptOf(root, i); const answers = json(path.join(root.out, a.attempt_id + '-answers.json'));
  const c = r.results.cases.find((x) => x.mode === 'baseline'); const d = c.generation.draws[0];
  d.samples[0] = d.samples[0] === 0 ? 1 : 0; d.mean = round(mean(d.samples)); d.stddev = round(stddev(d.samples));
  Object.assign(c.generation, acrossDraws(c.generation.draws)); c.mean = c.score = c.generation.mean; c.stddev = c.generation.sd; c.outcome = outcomeFor(c.mean, c.stddev, c.threshold);
  const x = comparisonOf(r.results.cases); r.results.aggregates = x.aggregates; r.comparison = x.comparison;
  reseal(root, i, r, answers);
  assert.equal(publication({ root: F.root, campaignRoot: root.croot, stub: false, recordedHeads: HEADS, reader: READER }).rows.length, 20, 'the reader alone reads the planted root');
  assert.throws(() => B.buildReport(opts(root)), code('SCORE_RECONSTRUCTION'));
});

test('AC-2: a dropped receipt or a dropped outcome refuses ATTEMPT_COVERAGE', async () => {
  const B = builder();
  const root = await paidRoot(); const id = root.ctx.plan.execution.attempts[3].attempt_id;
  fs.unlinkSync(path.join(root.out, id + '.json'));
  assert.throws(() => B.buildReport(opts(root)), code('ATTEMPT_COVERAGE'), 'a receipt file deleted');
  const other = await paidRoot(); const m = json(other.head); m.outcomes.splice(3, 1); fs.writeFileSync(other.head, JSON.stringify(m, null, 2) + '\n');
  assert.throws(() => B.buildReport(opts(other)), code('ATTEMPT_COVERAGE'), 'an outcome removed from the manifest');
});

test('AC-6: the placebo against no skill moves rows, never a headline line', async () => {
  const B = builder();
  const a = B.buildReport(opts(await paidRoot())).html;
  const b = B.buildReport(opts(await paidRoot({ arms: { ...ARMS, above: { with_skill: 0.9, baseline: 0.9, placebo: 0.3 } } }))).html;
  const lines = (h) => ['big', 'headline-counts', 'headline-routers'].map((k) => textOf(new RegExp('<p class="' + k + '"[^>]*>([\\s\\S]*?)</p>').exec(h)[1]));
  assert.deepEqual(lines(a), lines(b), 'the headline is unmoved');
  assert.ok(textOf(a).includes('not counted: NO_DIFFERENCE') && textOf(b).includes('not counted: PLACEBO_BELOW_BASELINE'), 'the rows moved');
});

test('AC-7: a placebo block that does not check reads not measured, never a direction; the builder refuses it', async () => {
  const B = builder(); const root = await paidRoot(); const i = 0;
  const a = root.ctx.plan.execution.attempts[i]; const r = receiptOf(root, i); const answers = json(path.join(root.out, a.attempt_id + '-answers.json'));
  r.placebo.comparison.delta += 0.1;
  const readings = T.readingsOf(r);
  const html = B.rowHTML({ index: i, attempt: a, attempt_id: a.attempt_id, skill: a.protocol.skill, repository: a.protocol.repository, router: false, reading: { ...readings, receipt_hash: r.receipt_hash }, receipt: r, src: 'synthetic', reason: null, report015: { hash: '0'.repeat(64), date: '2026-10-21', label: 'synthetic' } });
  assert.match(html, /data-reading="NOT_MEASURED"/);
  assert.ok(textOf(html).includes('Against the same-length placebo: not measured against the placebo (placebo_unverified)'));
  for (const w of [...Object.values(PLACEBO_WORDS), 'ABOVE_PLACEBO', 'BELOW_PLACEBO', 'with the same-length placebo ']) assert.ok(!textOf(html).includes(w), 'no direction: ' + w);
  reseal(root, i, r, answers);
  assert.throws(() => B.buildReport(opts(root)), code('PLACEBO_ARM'));
});

test('AC-8: publish mode refuses a stub chain; test mode reads it and never writes under docs/', async () => {
  const B = builder(); const root = await stubRoot();
  const o = opts(root);
  assert.throws(() => B.writeReport(o), code('UNVERIFIED')); assert.deepEqual(fs.readdirSync(o.out), [], 'nothing written');
  const stub = B.writeReport({ ...o, stub: true }); const html = fs.readFileSync(stub.page, 'utf8');
  assert.equal((html.match(/data-reading="NOT_MEASURED"/g) || []).length, 20, 'every stub row reads NOT_MEASURED');
  assert.ok(textOf(/<p class="big"[^>]*>([\s\S]*?)<\/p>/.exec(html)[1]).startsWith('On Claude Sonnet 5.5, 16 of 16 skills were not measured against the same-length placebo'));
  // A-627-5: the not_read shape's description is its first sentence, whole.
  assert.equal(/data-card-description="([^"]*)"/.exec(html)[1], 'On Claude Sonnet 5.5, 16 of 16 skills were not measured against the same-length placebo, and 0 of 16 beat a same-length placebo by the case rule.');
  assert.doesNotThrow(() => B.checkReport({ ...o, stub: true }));
  const before = fs.existsSync(path.join(ROOT, 'docs/reports/017'));
  assert.throws(() => B.writeReport({ ...o, stub: true, out: path.join(ROOT, 'docs') }), code('OUTPUT_DIRECTORY'));
  const cli = spawnSync(process.execPath, [BUILDER, '--stub', '--root', root.croot, '--out', path.join(ROOT, 'docs')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /report 017: refused: OUTPUT_DIRECTORY/);
  assert.equal(fs.existsSync(path.join(ROOT, 'docs/reports/017')), before, 'docs/ is not written');
});

test('AC-9: Report 015 is read from its sealed receipt by the plan row\'s id', async () => {
  const B = builder(); const root = await paidRoot();
  const ids = [...R015]; ids[5] = '0'.repeat(64);
  assert.throws(() => B.buildReport(opts(root, { report015Ids: ids })), code('REPORT_015_BINDING'));
  // Control on the real frozen plan: every id is a sealed Sonnet 5.5 receipt for the same skill.
  const byId = new Map(P408.readPublished(ROOT).items.map((x) => [x.attempt.attempt_id, x]));
  for (const [i, row] of REAL.rows.entries()) {
    const x = byId.get(row.report_015_attempt_id); const p = REAL.execution.attempts[i].protocol;
    assert.ok(x && x.attempt.protocol.skill === p.skill && x.attempt.protocol.repository === p.repository && x.receipt.run.model_id === 'claude-sonnet-5-5', 'rank ' + (i + 1));
  }
});

test('AC-10: the panel refuses an input that is not the sealed skill', async () => {
  const B = builder(); const root = await paidRoot();
  const panel = tmp('panel'); fs.cpSync(F.inputs, panel, { recursive: true });
  const pick = B.panelOf(B.readCampaign(opts(root)).rows, panel).row;
  fs.appendFileSync(path.join(panel, pick.attempt_id + '.md'), 'x');
  assert.throws(() => B.buildReport(opts(root, { panelDir: panel })), code('PANEL_BINDING'), 'one byte');
  fs.unlinkSync(path.join(panel, pick.attempt_id + '.md'));
  assert.throws(() => B.buildReport(opts(root, { panelDir: panel })), code('PANEL_INPUT'), 'the input missing');
});

test('A-627-1, AC-4, AC-14: the published page is what the builder makes from receipts/report-017c, its dek the reader\'s headline', () => {
  const B = builder();
  assert.equal(B.CAMPAIGN, 'receipts/report-017c');
  const done = B.checkReport(B.parse([]));
  const pub = publication({ campaignRoot: path.join(ROOT, 'receipts/report-017c'), stub: false });
  const html = fs.readFileSync(done.page, 'utf8');
  const lines = ['big', 'headline-counts', 'headline-routers'].map((k) => textOf(new RegExp('<p class="' + k + '"[^>]*>([\\s\\S]*?)</p>').exec(html)[1]));
  // The dek is the model it was read on, then the frozen template line verbatim (A-627-3).
  assert.deepEqual(lines, ['On Claude Sonnet 5.5, ' + pub.headline[0], pub.headline[1], pub.headline[2]]);
  assert.equal(done.built.campaign.rows.filter((r) => r.receipt).length, 20);
  // M3: the caveat, with no count, and every row with a receipt shows both readings.
  assert.equal(textOf(/<p class="headline-caveat">([\s\S]*?)<\/p>/.exec(html)[1]), 'Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.');
  for (const s of html.split('<section class="placebo-result').slice(1)) {
    assert.ok(/Against the same-length placebo: /.test(textOf(s)) && /Against no skill: /.test(textOf(s)), 'both readings on every row');
    // M2: no router row gives a skill verdict.
    if (s.startsWith(' router-result')) assert.doesNotMatch(textOf(s.slice(0, s.indexOf('</section>'))), /The skill clearly (helped|hurt)/);
  }
  assert.equal((html.match(/<section class="placebo-result router-result"/g) || []).length, 4);
  // m2: what moved is the placebo text, read from the h1's own attribute; another report's h1 is what moved.
  const rows = json(path.join(ROOT, 'docs/data/reports.json')).reports;
  assert.equal(rows.find((r) => r.number.value === '017').what_moved.value, 'a same-length placebo text');
  const r016 = rows.find((r) => r.number.value === '016'); assert.equal(r016.what_moved.value, r016.title.value);
  // m1: the summary's limit names the snapshot, the model and judge, and the tasks.
  const limit = json(path.join(ROOT, 'docs/data/report-summaries.json')).reports['017'].points.at(-1);
  assert.equal(limit.lead, 'What it does not show.');
  for (const w of ['Skills.sh snapshot of 2026-10-17', 'Claude Sonnet 5.5', 'Claude Haiku 5.5', 'three text tasks']) assert.ok(limit.text.includes(w), w);
});

test('A-627-5: the Markdown panel is the receipt\'s bytes, and the card description is a whole claim', async () => {
  const B = builder(); const html = fs.readFileSync(path.join(ROOT, 'docs/reports/017/index.html'), 'utf8');
  const md = fs.readFileSync(path.join(ROOT, 'docs/reports/017/index.md'), 'utf8');
  // The panel's placebo in the copy, independently: the code block under "Its same-length placebo".
  const at = md.indexOf('Its same-length placebo'); const block = /```\n([\s\S]*?)\n```/.exec(md.slice(at))[1];
  const pick = B.readCampaign({ campaignRoot: path.join(ROOT, B.CAMPAIGN) }).rows.find((r) => r.attempt.protocol.skill === 'grill-me');
  const p = pick.receipt.placebo;
  assert.equal(Buffer.byteLength(block, 'utf8'), p.bytes, 'the copy holds every byte');
  assert.equal(sha256(block), p.sha256, 'the copy hashes to the receipt\'s placebo.sha256');
  // The trailing whitespace is stated in words, on the page and in the copy, and is what the block ends with.
  const tail = /\s+$/.exec(block); assert.ok(tail, 'this placebo ends in whitespace');
  assert.equal(tail[0], ' '); assert.ok(html.includes('<p class="panel-note">This text ends with one space.</p>') && md.includes('This text ends with one space.'));
  // Control: the old rule, which trimmed every trailing space, gives another hash.
  assert.notEqual(sha256(block.replace(/\s+$/, '')), p.sha256);
  // The description: the template's first claim, whole, after the model; built here by hand from the tally.
  const pub = publication({ campaignRoot: path.join(ROOT, 'receipts/report-017c'), stub: false });
  assert.equal(pub.tally.shape, 'some');
  const want = 'On Claude Sonnet 5.5, ' + pub.tally.A + ' of ' + pub.tally.N + ' skills beat a same-length placebo by the case rule.';
  const meta = /<meta name="description" content="([^"]*)"/.exec(html)[1]; const og = /<meta property="og:description" content="([^"]*)"/.exec(html)[1];
  assert.equal(meta, want); assert.equal(og, want);
  assert.ok(!meta.includes('…') && /\.$/.test(meta) && meta.length <= 155, 'ends on a full clause, uncut');
  assert.equal(json(path.join(ROOT, 'docs/data/reports.json')).reports.find((r) => r.number.value === '017').og_description.value, want);
  // Plant: without the dek's stated description the row cuts the first sentence mid-claim.
  const { reportRow } = await import(path.join(ROOT, 'scripts/site-data.mjs'));
  const cut = reportRow('017', { pageRel: 'docs/reports/017/index.html', html: html.replace(/ data-card-description="[^"]*"/, '') }).og_description.value;
  assert.ok(cut.endsWith('…'), 'the planted page reads a cut description: ' + cut);
});

test('A-627-3 (B1): Report 017\'s router receipts take Report 015 Amendment 1\'s limit by rule, on every surface', () => {
  const dir = path.join(ROOT, 'receipts/report-017c/campaign-1');
  const all = fs.readdirSync(dir).filter((f) => /^[0-9a-f]{64}\.json$/.test(f)).map((f) => json(path.join(dir, f)));
  const routers = all.filter((r) => ['find-skills', 'agent-browser', 'hyperframes', 'hyperframes-registry'].includes(r.skill.name));
  assert.equal(routers.length, 4);
  for (const r of all) assert.equal(!!policy.routerLimit(r), routers.includes(r), r.skill.name);
  const { badgeSvg } = require(path.join(ROOT, 'lib/badge-svg'));
  for (const r of all) {
    const page = fs.readFileSync(path.join(ROOT, 'docs/r', r.receipt_hash, 'index.html'), 'utf8');
    const verdict = textOf(/<section class="receipt-verdict[\s\S]*?<\/section>/.exec(page)[0]);
    assert.ok(page.includes('<a href="/reports/017/">Report 017</a> shows that reading.'), 'every 017c receipt page points to the placebo reading');
    if (!routers.includes(r)) continue;
    assert.ok(verdict.includes(policy.LABEL) && verdict.includes(policy.REASON) && page.includes('href="/reports/015/#amendment-1"'), r.skill.name + ': the limit and Amendment 1');
    assert.doesNotMatch(verdict, /Regressed|Passing|clearly (helped|hurt)/i, r.skill.name + ': no skill verdict on the page');
    const badge = fs.readFileSync(path.join(ROOT, 'docs/r', r.receipt_hash, 'badge.svg'), 'utf8');
    assert.ok(badge.includes(policy.LABEL) && !/passing|regressed/i.test(badge), r.skill.name + ': the badge');
    assert.equal(badge, badgeSvg(r, { href: 'https://driftproofhq.com/r/' + r.receipt_hash + '/' }), 'the committed badge is the builder\'s');
  }
  // Plants: the rule reads the sealed campaign record's source, not a list.
  const r = structuredClone(routers[0]); const C0 = r.results.cases.map((c) => c.generation.issue408);
  for (const m of C0) m.source = { ...m.source, skill: 'grill-me' };
  sealReceipt(r); assert.equal(policy.routerLimit(r), null, 'the source names a counted skill: no limit');
  const named = structuredClone(routers[0]); named.skill.name = 'renamed'; sealReceipt(named);
  assert.throws(() => policy.routerLimit(named), code('ROUTER_RECEIPT_BINDING'), 'a router source under another skill name');
  const unsealed = structuredClone(routers[0]); unsealed.comparison.delta += 0.1;
  assert.throws(() => policy.routerLimit(unsealed), code('ROUTER_RECEIPT_BINDING'), 'an unsealed router receipt');
  // A-627-6: the band plots. A router's plots carry the notice spec 020 admits; a counted receipt's plot
  // carrying it is refused; a retained-answers sidecar has no plot.
  const notices = require(path.join(ROOT, 'specs/020-site-relaunch/router-notices.cjs'));
  const fileKey = (r) => 'report-017c--campaign-1--' + fs.readdirSync(dir).find((f) => /^[0-9a-f]{64}\.json$/.test(f) && json(path.join(dir, f)).receipt_hash === r.receipt_hash).replace(/\.json$/, '');
  for (const r of routers) for (const size of ['card', 'hero', 'play']) {
    const n = fileKey(r) + '.' + size + '.svg'; const svg = fs.readFileSync(path.join(ROOT, 'docs/plots', n), 'utf8');
    assert.ok(notices.names.has(n) && notices.faults(n, svg).length === 0 && svg.includes(policy.LABEL), n + ': the admitted notice');
  }
  const counted = all.find((r) => !routers.includes(r)); const routerSvg = fs.readFileSync(path.join(ROOT, 'docs/plots', fileKey(routers[0]) + '.card.svg'), 'utf8');
  assert.ok(notices.faults(fileKey(counted) + '.card.svg', routerSvg).some((f) => f.startsWith('not an admitted notice identity')), 'plant: a counted 017c plot carrying the notice is refused');
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'docs/plots')).filter((n) => /-answers\.(card|hero|play)\.svg$/.test(n)), [], 'no sidecar plot');
  // The receipt-page builder's campaign root is the report builder's.
  assert.ok(fs.readFileSync(path.join(ROOT, 'scripts/build-receipt-pages.js'), 'utf8').includes("const REPORT017_ROOT = '" + builder().CAMPAIGN + "/';"));
});

test('AC-4, AC-5, spec 134 A-134-22: the placebo tally keeps spec 125\'s summary; renamed, the rule would open with one-receipt verdicts', () => {
  const { answersFor } = require(path.join(ROOT, 'scripts/report-answers'));
  const row = json(path.join(ROOT, 'docs/data/reports.json')).reports.find((r) => String(r.number.value) === '017');
  const page = fs.readFileSync(path.join(ROOT, 'docs/reports/017/index.html'), 'utf8');
  assert.equal(answersFor(row, page, { esc, root: ROOT }), null);
  assert.notEqual(answersFor(row, page.replace(/data-fn="placebo-tally"/g, 'data-fn="v"'), { esc, root: ROOT }), null, 'plant: without the element the rule reads one receipt per sentence');
  // m5: the element alone sets nothing aside; a page of any other type that carries it is read as before.
  for (const type of ['Capability-gap report', 'Rules-file behaviour report']) {
    assert.notEqual(answersFor({ ...row, type: { ...row.type, value: type } }, page, { esc, root: ROOT }), null, 'plant: the tally element on a ' + type);
  }
  // The opening the page shows is the summary row: its lead finding is the pre-registered headline.
  const opening = /<section class="plain-summary"[\s\S]*?<\/section>/.exec(page)[0];
  for (const p of json(path.join(ROOT, 'docs/data/report-summaries.json')).reports['017'].points) assert.ok(textOf(opening).includes(p.text), p.lead);
  assert.ok(textOf(opening).includes('beating it does not mean beating no skill'), 'M3: the opening carries the caveat');
  assert.doesNotMatch(opening, /data-receipt=/, 'no sentence read from one receipt');
});

// A-627-7 and A-435-22 (issue 642): the two skills whose whole text only calls another skill. The
// notes are typed here by hand; the attempt ids are the two committed panel texts.
const HANDOFF = { '9ad7ac527a21f178392b4ae9d146922b7ad58ee6ca8dcef4f8d5172f95cdb027': 'grill-me', 'bfc0fd31bf2c53d679e22d467a049c6f8a5e2209265a755d14c5d2ca68a1ef02': 'grill-with-docs' };
const NOTE017 = "About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts.";
const NOTE015 = "About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the counts.";
const PANEL = path.join(ROOT, 'receipts/report-017-panel');
const handoff = () => require(path.join(ROOT, 'scripts/skill-handoff.js'));
const notesOf = (html) => [...html.matchAll(/<p class="handoff-note">([\s\S]*?)<\/p>/g)].map((m) => textOf(m[1]));

test('A-627-7: the hand-off rule matches both committed texts and no synthetic text that does more', () => {
  const H = handoff();
  // The panel directory holds these two and the blind read's pick, handoff (spec 638 A-638-1), nothing else.
  const BLIND_PICK = '335148930bb21ee4a130cc0964044930eb0c9f845dc4c35d918dd876343c4bed';
  assert.deepEqual(fs.readdirSync(PANEL).sort(), [...Object.keys(HANDOFF), BLIND_PICK].map((id) => id + '.md').sort(), 'the committed texts are the two hand-offs and the blind read\'s pick');
  for (const id of Object.keys(HANDOFF)) assert.equal(H.handsOffOnly(fs.readFileSync(path.join(PANEL, id + '.md'), 'utf8')), true, HANDOFF[id]);
  const fm = '---\nname: synthetic\ndescription: A synthetic test skill.\n---\n\n';
  assert.equal(H.handsOffOnly(fm + 'Call the Skill tool with "one".\nCall the Skill tool with "two".\n'), true, 'control: two calls');
  for (const [what, text] of [
    ['another instruction', fm + 'Use the Bash tool to run the tests.\n'],
    ['a call plus prose', fm + 'Call the Skill tool with "grilling".\n\nThen write a short plan and ask one question at a time.\n'],
    ['a call and prose in one sentence', fm + 'Call the Skill tool with "grilling", then write the plan.\n'],
    ['a heading after the call', fm + 'Call the Skill tool with "grilling".\n\n## Notes\n'],
    ['an empty body', fm],
    ['a blank body', fm + '\n  \n'],
    ['no front matter', 'Call the Skill tool with "grilling".\n'],
    ['unclosed front matter', '---\nname: synthetic\n\nCall the Skill tool with "grilling".\n'],
    ['a fixture skill text', textFor('grill-me')],
  ]) assert.equal(H.handsOffOnly(text), false, what);
});

test('A-627-7: the published page carries the hand-off note after the caveat and in both rows, and nothing else moves', () => {
  const B = builder();
  assert.deepEqual(B.parse([]).handoff, Object.keys(HANDOFF), 'the CLI names both attempts');
  const done = B.checkReport(B.parse([])); const html = fs.readFileSync(done.page, 'utf8');
  assert.deepEqual(notesOf(html), [NOTE017, NOTE017, NOTE017]);
  assert.match(html, /<p class="headline-caveat">[^<]*<\/p><p class="handoff-note">/, 'after the caveat');
  const rows = html.split('<section class="placebo-result').slice(1);
  assert.deepEqual(rows.filter((s) => s.includes('class="handoff-note"')).map((s) => /data-attempt="([a-f0-9]{64})"/.exec(s)[1]), Object.keys(HANDOFF), 'in exactly the two rows');
  for (const id of Object.keys(HANDOFF)) assert.ok(!sectionOf(html, id).includes('router'), HANDOFF[id] + ' is a counted row');
  // The reader's output is the one it gave before issue 642, by digest.
  const pub = publication({ campaignRoot: path.join(ROOT, 'receipts/report-017c'), stub: false });
  assert.equal(sha256(JSON.stringify(pub)), 'a2c8a3eb21a6b39b720cb66655206ec0f82a27b7b0c2698d9fff4e0997be2ced');
  assert.equal(pub.tally.N, 16);
  // The page's dated record of the note, before the receipts (spec 020 AC-21: a published body moves only with its Amendments).
  const { splitReportBody } = require(path.join(ROOT, 'scripts/site-chrome.js'));
  const entry = '<h2 id="amendments">Amendments</h2><section id="amendment-1"><h3>Amendment 1, 2 Nov 2026</h3><p>Added a note after the headline and in the rows for grill-me and grill-with-docs. The whole text of each skill only calls another skill, and these text tasks forbid tools. Counts, readings and receipts are unchanged.</p></section>';
  assert.ok(html.indexOf('<section id="campaign-run-record">') < html.indexOf(entry) && html.indexOf(entry) < html.indexOf('<h2>Receipts</h2>'), 'after the run record, before the receipts');
  // Issue 638 (A-627-8) appends the blind read's entry after it, so Amendment 1 stays the section's prefix.
  const blind = '<section id="amendment-2"><h3>Amendment 2, 2 Nov 2026</h3><p>Added a link, after the opening panel, to a blind read of handoff&#39;s kept answers. Counts, readings and receipts are unchanged.</p></section>';
  // Issue 671 (A-627-9) appends the reworded verdict line's entry after both, so the recorded prefix stays.
  const reworded = '<section id="amendment-3"><h3>Amendment 3, 3 Nov 2026</h3><p>Reworded the line against no skill in the rows where the overall averages with and without the skill do not point the verdict&#39;s way: it names the task that decided it and gives the averages over all the tasks. The verdict is decided per task, so those averages can sit equal or point the other way. Counts, readings and receipts are unchanged.</p></section>';
  // Issue 690 (A-627-10) appends the judge-notes entry after the three, so the recorded prefix stays.
  const notes = '<section id="amendment-4"><h3>Amendment 4, 4 Nov 2026</h3><p>Added, under each task of every row with a receipt, a way to open that task&#39;s prompt and rubric, the kept answers with the skill, with the fake text and with nothing, and the judge&#39;s scores and reasons for one try at a time. Counts, readings and receipts are unchanged.</p></section>';
  const sent = '<section id="amendment-5"><h3>Amendment 5, 4 Nov 2026</h3><p>Added Send this result to each row, with a fixed message that keeps its reading, model, judge, report, caveats and receipt together. Counts, readings and receipts are unchanged.</p></section>';
  assert.equal(splitReportBody(html).amendments, entry + blind + reworded + notes + sent);
  // Without the note the page is the same, but for the note's elements, its record and the record's
  // entry in the contents rail; the summary row is the same.
  const rail = '<li><a href="#amendments">Amendments</a></li>\n';
  assert.ok(html.includes(rail));
  const without = B.buildReport({ ...B.parse([]), handoff: [] });
  assert.equal(notesOf(without.html).length, 0);
  // Without the note, the section keeps the other entries alone, under their published numbers.
  assert.equal(splitReportBody(without.html).amendments, '<h2 id="amendments">Amendments</h2>' + blind + reworded + notes + sent);
  const noteEntry = entry.slice('<h2 id="amendments">Amendments</h2>'.length);
  // A-627-11 (issue 694): the same hand-off note also travels in both share payloads.
  // Verify exactly those added copies before removing that exact text for the old no-other-change oracle.
  const shareBlocks = [...html.matchAll(/<div class="send-result"[\s\S]*?<\/details><\/div>/g)].map(m => m[0]);
  const escapedNote = esc(NOTE017);
  const withNote = shareBlocks.filter(block => block.includes(escapedNote));
  assert.equal(withNote.length, Object.keys(HANDOFF).length);
  for (const block of withNote) assert.equal(block.split(escapedNote).length - 1, 2, 'payload and visible preview each keep the whole note');
  const withoutShareNote = html.replace(/<div class="send-result"[\s\S]*?<\/details><\/div>/g, block => block.split(escapedNote + ' ').join(''));
  assert.equal(withoutShareNote.replace(/<p class="handoff-note">[\s\S]*?<\/p>/g, '').replace(noteEntry, ''), without.html);
  assert.deepEqual(done.built.summary, without.summary);
  assert.deepEqual(done.built.campaign.pub, without.campaign.pub);
});

test('A-627-7 plants: a hand-off text is the pinned bytes, present, a counted row and a hand-off', async () => {
  const B = builder(); const H = handoff(); const root = await paidRoot();
  const attempts = root.ctx.plan.execution.attempts; const at = (skill) => attempts.find((a) => a.protocol.skill === skill).attempt_id;
  assert.throws(() => B.buildReport(opts(root, { handoff: [at('grill-me')] })), code('HANDOFF_RULE'), 'a fixture text that does not hand off');
  assert.throws(() => B.buildReport(opts(root, { handoff: [at('find-skills')] })), code('HANDOFF_BINDING'), 'a router');
  assert.throws(() => B.buildReport(opts(root, { handoff: ['0'.repeat(64)] })), code('HANDOFF_BINDING'), 'an attempt the plan does not hold');
  const panel = tmp('handoff'); fs.cpSync(F.inputs, panel, { recursive: true });
  fs.appendFileSync(path.join(panel, at('grill-me') + '.md'), 'x');
  assert.throws(() => B.buildReport(opts(root, { handoff: [at('grill-me')], panelDir: panel })), code('HANDOFF_BINDING'), 'one byte added');
  fs.unlinkSync(path.join(panel, at('grill-me') + '.md'));
  assert.throws(() => B.buildReport(opts(root, { handoff: [at('grill-me')], panelDir: panel })), code('HANDOFF_INPUT'), 'the text missing');
  // On the committed texts and the frozen plan.
  const plan = json(path.join(ROOT, 'receipts/report-017c/plan.json')); const ids = Object.keys(HANDOFF);
  assert.deepEqual(H.handoffTexts({ plan, panelDir: PANEL, ids }).map((t) => t.skill), Object.values(HANDOFF), 'control');
  const real = tmp('handoff-real'); fs.cpSync(PANEL, real, { recursive: true });
  fs.appendFileSync(path.join(real, ids[1] + '.md'), 'x');
  assert.throws(() => H.handoffTexts({ plan, panelDir: real, ids }), code('HANDOFF_BINDING'), 'one byte added to grill-with-docs');
  fs.unlinkSync(path.join(real, ids[1] + '.md'));
  assert.throws(() => H.handoffTexts({ plan, panelDir: real, ids }), code('HANDOFF_INPUT'), 'grill-with-docs missing');
});

test('A-435-22: Report 015 carries the same note after the tally and in both rows, its four receipts found by their sealed source, and its counts unchanged', () => {
  const H = handoff(); const page015 = require(path.join(ROOT, 'scripts/prepare-report-015.js'));
  const html = fs.readFileSync(path.join(ROOT, 'docs/reports/015/index.html'), 'utf8');
  assert.equal(page015.buildPage(), html, 'the committed page is the builder\'s');
  assert.deepEqual(notesOf(html), [NOTE015, NOTE015, NOTE015]);
  assert.match(html, /<div class="campaign-tally">[\s\S]*?<\/div><p class="handoff-note">/, 'after the tally');
  // The dated record, appended: Amendment 1's recorded bytes (511, before issue 642) are still the section's prefix.
  const amendments = require(path.join(ROOT, 'scripts/site-chrome.js')).splitReportBody(html).amendments;
  assert.equal(sha256(Buffer.from(amendments, 'utf8').subarray(0, 511).toString('utf8')), 'cedcb492311bfdb951d43225f1d74211674cc3acda6dc4e27bc59d9fc6da39f0');
  assert.equal(Buffer.from(amendments, 'utf8').subarray(511).toString('utf8'), '<section id="amendment-2"><h3>Amendment 2, 2 Nov 2026</h3><p>Added a note after the tally and in the rows for grill-me and grill-with-docs. The whole text of each skill only calls another skill, and these text tasks forbid tools. Counts, readings and receipts are unchanged.</p></section>');
  const marked = [...html.matchAll(/<tr data-skill="([^"]+)">([\s\S]*?)<\/tr>/g)].filter((m) => m[2].includes('class="handoff-note"')).map((m) => m[1]);
  assert.deepEqual(marked, ['mattpocock/skills/grill-me', 'mattpocock/skills/grill-with-docs'], 'in exactly the two rows');
  // The four receipts, by their sealed source and the pins; no hash is listed.
  const pub = P408.readPublished(ROOT); const sources = json(path.join(ROOT, 'specs/408-skill-measurements/sources.json'));
  const texts = H.committed(ROOT);
  const found = pub.items.filter((x) => H.handoffReceipt(x.receipt, texts, sources));
  assert.deepEqual(found.map((x) => x.receipt.skill.name + ' ' + x.receipt.run.model_id).sort(), ['grill-me claude-opus-5-5', 'grill-me claude-sonnet-5-5', 'grill-with-docs claude-opus-5-5', 'grill-with-docs claude-sonnet-5-5']);
  for (const f of ['scripts/prepare-report-015.js', 'scripts/skill-handoff.js']) {
    const code015 = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const x of found) for (const h of [x.receipt.receipt_hash, x.attempt.attempt_id, x.receipt.results.cases[0].generation.issue408.source.skill_sha256]) { assert.match(h, /^[0-9a-f]{64}$/); assert.ok(!code015.includes(h), f + ' names no Report 015 receipt or pin'); }
  }
  const pinned = structuredClone(found[0].receipt); for (const c of pinned.results.cases) c.generation.issue408.source.skill_sha256 = '0'.repeat(64); sealReceipt(pinned);
  assert.throws(() => H.handoffReceipt(pinned, texts, sources), code('HANDOFF_BINDING'), 'another pinned hash');
  const unsealed = structuredClone(found[0].receipt); unsealed.comparison.delta += 0.1;
  assert.throws(() => H.handoffReceipt(unsealed, texts, sources), code('HANDOFF_BINDING'), 'an unsealed receipt');
  assert.equal(H.handoffReceipt(pub.items.find((x) => x.receipt.skill.name === 'grilling').receipt, texts, sources), null, 'the skill they call is not one');
  // Counts: the tally is the reader's, the summary row the reader's, and spec 435's counts hold.
  assert.ok(html.includes(P408.tally(pub)), 'the tally is unchanged');
  assert.deepEqual(json(path.join(ROOT, 'docs/data/report-summaries.json')).reports['015'], page015.summaryRow(pub));
  const R435 = require(path.join(ROOT, 'specs/435-report-015-router-amendment/reader.cjs'));
  R435.scoreboard(html, R435.evidence(ROOT));
});

test('AC-15: Reports 013, 015 and 016 still match their own --check, and the summaries keep their rows', async () => {
  const B = builder(); const o = opts(await paidRoot()); const done = B.writeReport(o);
  const before = json(path.join(ROOT, 'docs/data/report-summaries.json')); const after = json(done.summaryFile);
  const others = (s) => Object.keys(s.reports).filter((k) => k !== '017');
  assert.deepEqual(others(after), others(before));
  for (const k of others(before)) assert.deepEqual(after.reports[k], before.reports[k], k);
  for (const n of ['013', '015', '016']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/prepare-report-' + n + '.js'), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
    assert.equal(r.status, 0, n + ': ' + r.stderr);
  }
});
