// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 669: Report 018's page builder. No model is called: every fixture receipt is the stub's, run
// through spec 655's own campaign driver under a temporary root, never the tree. A paid-shaped root
// carries synthetic judge scores, with every dependent figure recomputed and resealed, so the readings
// below are chosen, not measured. The published page is read against the committed campaign root.
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
const CAMPAIGN = 'receipts/report-018';
const BUILDER = process.env.REPORT018_BUILDER || path.join(ROOT, 'scripts/prepare-report-018.js');
const P = require(path.join(DIR, 'protocol.cjs'));
const C = require(path.join(ROOT, 'specs/408-skill-measurements/campaign.cjs'));
const P408 = require(path.join(ROOT, 'specs/408-skill-measurements/publication.cjs'));
const R = require(path.join(DIR, 'run-campaign.cjs'));
const T = require(path.join(ROOT, S613, 'tally.cjs'));
const { sha256 } = require(path.join(ROOT, 'lib/canonical'));
const { suiteIdentity } = require(path.join(ROOT, 'lib/skill'));
const { sealReceipt, comparisonOf, repositoryJudgeRelationship } = require(path.join(ROOT, 'lib/receipt'));
const { mean, stddev, round } = require(path.join(ROOT, 'lib/stats'));
const { acrossDraws } = require(path.join(ROOT, 'lib/sampling'));
const { runSkillOnModel, outcomeFor } = require(path.join(ROOT, 'lib/run'));
const { auditDirectory } = require(path.join(ROOT, 'specs/408-skill-measurements/eval-audit.cjs'));
const { placeboReading, placeboLine, placeboFigures, placeboPairing, armOf, receiptVerdict, PLACEBO_WORDS } = require(path.join(ROOT, 'lib/verdict'));
const { plainOf } = require(path.join(ROOT, 'lib/plain'));
const placebo = require(path.join(ROOT, 'lib/placebo'));
const policy = require(path.join(ROOT, 'lib/report-015-publication'));
const H = require(path.join(ROOT, 'scripts/skill-handoff.js'));

const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const code = (c) => (e) => e.code === c;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ENTITY = { '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const textOf = (html) => {
  let text = html;
  for (let prev = null; prev !== text;) { prev = text; text = text.replace(/<[^>]+>/g, ''); }
  return text.replace(/&(?:quot|#39|lt|gt|amp);/g, (e) => ENTITY[e]);
};
const builder = () => require(BUILDER);
const tmp = (p) => fs.mkdtempSync('/var/tmp/report018-page-' + p + '-');
const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DRIFTPROOF_STUB: '1', TMPDIR: '/var/tmp' }, timeout: 600000 });
const HAIKU = 'claude-haiku-5-5';
const LIMITATION = "The judge uses the same model as the target. Self-grading may favor its own model's answers.";
const CAVEAT = 'Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.';

// The spec 655 fixture: a copy of every input the plan reads, clearly synthetic skill texts in place
// of the pinned ones, the roster re-pinned over them and this plan rebuilt (tests/report-018-plan.test.js
// does the same). The panel inputs are every roster text by its Report 017 attempt id.
const SETTINGS = { permissions: { deny: ['Read', 'WebFetch', 'WebSearch'] }, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, autoMemoryEnabled: false, disableClaudeAiConnectors: true };
const handsOff = (skill) => '---\nname: ' + skill + '\n---\nCall the Skill tool with "synthetic-other-skill".\n';
const plain = (skill) => '---\nname: ' + skill + '\n---\nSynthetic test instructions for ' + skill + ' only. No provider call.\n';
// One counted skill that does not hand off gets the shortest text, so the panel's pick is not a hand-off row.
const SHORTEST = 'tdd';
const textFor = (skill) => (P.HANDOFF_SKILLS.includes(skill) ? handsOff(skill) : skill === SHORTEST ? '---\nname: ' + skill + '\n---\nShort synthetic text.\n' : plain(skill));
function fixture() {
  const root = fs.mkdtempSync('/var/tmp/report018-page-fixture-');
  const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.cpSync(path.join(ROOT, rel), path.join(root, rel), { recursive: true }); };
  copy(P.SOURCE); copy(S613); copy(SPEC); copy(ROSTER); copy('scripts/skill-handoff.js'); for (const f of P.RUNNER_FILES) copy(f);
  const at = path.join(root, P.SOURCE);
  const plan = json(path.join(root, ROSTER, 'plan.json')); const sources = json(path.join(at, 'sources.json'));
  const panel = path.join(root, 'receipts/report-017-panel'); fs.mkdirSync(panel, { recursive: true });
  for (const a of plan.execution.attempts) {
    const p = a.protocol; const s = sources.find((x) => x.repository === p.repository && x.skill === p.skill);
    const text = textFor(p.skill);
    const old = s.skill_sha256; s.skill_sha256 = sha256(text);
    const raw = fs.readFileSync(path.join(at, s.suite), 'utf8').replaceAll(old, s.skill_sha256); fs.writeFileSync(path.join(at, s.suite), raw);
    p.skill_sha256 = s.skill_sha256; p.evals_sha256 = sha256(raw); p.suite_hash = suiteIdentity(JSON.parse(raw)).suiteHash;
    const row = plan.rows.find((r) => r.skill === p.skill && r.repository === p.repository);
    a.attempt_id = sha256(JSON.stringify(p)); row.attempt_id = a.attempt_id;
    fs.writeFileSync(path.join(panel, a.attempt_id + '.md'), text);
  }
  fs.writeFileSync(path.join(at, 'sources.json'), JSON.stringify(sources));
  fs.writeFileSync(path.join(root, ROSTER, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  const planFile = path.join(root, SPEC, 'plan.json');
  const built = node(['-e', 'const B=require(process.argv[1]);require("node:fs").writeFileSync(process.argv[3],JSON.stringify(B.buildPlan({root:process.argv[2]}),null,2)+"\\n")', path.join(DIR, 'build-plan.cjs'), root, planFile]);
  assert.equal(built.status, 0, built.stderr);
  const inputs = path.join(root, 'inputs'); fs.mkdirSync(inputs);
  const frozen = json(planFile);
  for (const a of frozen.execution.attempts) fs.writeFileSync(path.join(inputs, a.attempt_id + '.md'), textFor(a.protocol.skill));
  const home = path.join(root, 'eval'); fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify(SETTINGS));
  return { root, inputs, home, panel, planFile, plan: frozen, bytes: fs.readFileSync(planFile), roster: plan };
}
const F = fixture();
const REAL = json(path.join(DIR, 'plan.json'));
// A fixture root is not a git repository. Its recorded head is a snapshot of the pinned files, the plan
// and the note, served as git would serve that commit (spec 613 A-613-3).
const FIXTURE_HEAD = 'f'.repeat(40);
const SNAPSHOT = new Map([...Object.keys(F.plan.runner_hashes), SPEC + '/plan.json', SPEC + '/outcomes.md'].map((file) => [file, fs.readFileSync(path.join(F.root, file))]));
const READER = { head: () => FIXTURE_HEAD, isAncestor: (h) => h === FIXTURE_HEAD, show: (h, file) => (h === FIXTURE_HEAD && SNAPSHOT.has(file) ? SNAPSHOT.get(file) : null) };
const HEADS = { [sha256(F.bytes)]: FIXTURE_HEAD };

// One start of a campaign root, by hand: a stub run per attempt, annotated as the campaign does,
// without runCampaign or its eval-account lock (the gate runs this file beside spec 655's plan test,
// which takes that lock; spec 627 Inferences 4 builds Report 017's roots the same way). The attempts
// in `fail` are recorded failures with no receipt.
async function stubRoot({ fail = [] } = {}) {
  const ctx = R.readPlan(F.root); const croot = tmp('root');
  fs.copyFileSync(F.planFile, path.join(croot, 'plan.json')); fs.copyFileSync(path.join(F.root, SPEC, 'outcomes.md'), path.join(croot, 'outcomes.md'));
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
  const list = json(path.join(F.root, SPEC, 'prior-spend.json')).corrections;
  const head = path.join(out, 'manifest.json');
  fs.writeFileSync(head, JSON.stringify({ format: 'driftproof-skill-campaign/1', report: P.REPORT, plan_sha256: ctx.plan_hash, cap_usd: P.CAP_USD, budget_description: P.BUDGET, stub: true, corrections: { count: list.length, sha256: sha256(JSON.stringify(list)) }, priors: [], outcomes, spent_usd: outcomes.reduce((n, o) => n + o.cost_usd, 0) }, null, 2) + '\n');
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
const opts = (root, extra = {}) => ({ root: F.root, campaignRoot: root.croot, panelDir: F.panel, out: tmp('out'), placeboPage: false, recordedHeads: HEADS, reader: READER, ...extra });
const receiptOf = (root, i) => json(path.join(root.out, root.ctx.plan.execution.attempts[i].attempt_id + '.json'));
const sectionOf = (html, id) => { const at = html.indexOf('data-attempt="' + id + '"'); assert.ok(at > 0, id); return html.slice(at, html.indexOf('</section>', at)); };
const lines = (h) => ['big', 'headline-counts', 'headline-routers'].map((k) => textOf(new RegExp('<p class="' + k + '"[^>]*>([\\s\\S]*?)</p>').exec(h)[1]));
// A-669-3: the chart's counts, read off its count elements, and the plain counts line, against the
// counts given; the plain words lead and the reader's token stands beside each.
const PLAIN = { ABOVE_PLACEBO: 'beat the fake', BELOW_PLACEBO: 'below the fake', NO_DIFFERENCE: 'no difference', INCONCLUSIVE: 'inconclusive', UNDERPOWERED: 'too few answers to tell', NOT_MEASURED: 'not measured' };
function chartReads(html, want, N) {
  const fig = /<figure class="placebo-chart">([\s\S]*?)<\/figure>/.exec(html); assert.ok(fig, 'the chart');
  const got = Object.fromEntries([...fig[1].matchAll(/class="chart-count" data-count-of="([A-Z_]+)">(\d+)<\/text>/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(got, want, 'the chart counts are the tally\'s');
  assert.equal(Object.values(got).reduce((n, x) => n + x, 0), N, 'the bars sum to N');
  for (const plain of Object.values(PLAIN)) assert.ok(fig[1].includes('>' + plain + '</text>'), 'a bar labelled in plain words: ' + plain);
  assert.ok(fig[1].includes('<title id="placebo-chart-title">') && fig[1].includes('<figcaption>') && fig[1].includes('fill="currentColor"') && /viewBox="0 0 \d+ \d+" width="100%"/.test(fig[1]), 'a titled, captioned, theme-safe SVG');
  for (const tok of Object.keys(PLAIN)) assert.ok(textOf(fig[1]).includes(PLAIN[tok] + ' is ' + tok), 'the legend puts the plain words first, the token beside: ' + tok);
  const plainLine = textOf(/<p class="headline-counts-plain">([\s\S]*?)<\/p>/.exec(html)[1]);
  assert.equal(plainLine, 'Of the ' + N + ' skills counted: ' + Object.keys(PLAIN).map((tok) => want[tok] + ' ' + PLAIN[tok]).join(', ') + '.');
  assert.match(html, /<p class="headline-counts" data-fn="placebo-tally">[\s\S]*?<\/p><p class="headline-counts-plain">/, 'the plain line stands beside the frozen counts line');
  assert.doesNotMatch(textOf(fig[1]) + plainLine, /%|\bratio\b|\brank/i);
}
// A-669-3: every row opens on its summary line inside a details element, with the limitation outside it.
function rowsCollapse(html) {
  const sections = html.split('<section class="placebo-result').slice(1);
  assert.ok(sections.length > 0);
  for (const s of sections) {
    const sec = s.slice(0, s.indexOf('</section>') + 10);
    assert.match(sec, /^[^>]*><details class="placebo-row"><summary><span class="row-skill">[\s\S]*?<\/summary>[\s\S]*<\/details><p class="judge-limitation">[^<]*<\/p><\/section>$/, 'a details element, then the limitation');
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(sec)[1]; const t = textOf(summary);
    const tok = /data-reading="([A-Z_]+)"/.exec(sec)[1];
    assert.ok(t.includes('Against the same-length placebo: ' + PLAIN[tok] + ' ' + tok), 'plain words first, the token beside: ' + t.slice(0, 80));
    assert.ok(t.includes('Against no skill: '), 'the verdict line');
    assert.ok(!summary.includes('<data ') && !summary.includes('<p '), 'the summary line is phrasing content');
  }
}
// The page's visible text outside the frozen note's own sections (Method and Limits) and the head.
function outsideNote(html) {
  const body = html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<pre[\s\S]*?<\/pre>/g, '');
  const method = body.indexOf('<h2>Method</h2>'); const record = body.indexOf('<section id="campaign-run-record">');
  assert.ok(method > 0 && record > method, 'Method, then Limits, then the run record');
  return textOf(body.slice(0, method) + body.slice(record));
}

test('AC-2, AC-3, AC-4, AC-6, AC-9, AC-12, AC-13, AC-14, AC-15, AC-17, AC-18: a paid-shaped campaign builds a page whose every line is the library\'s, and --check reproduces it', async () => {
  const root = await paidRoot(); const o = opts(root); const B = builder();
  const done = B.writeReport(o); const html = fs.readFileSync(done.page, 'utf8');
  assert.deepEqual(fs.readdirSync(o.out, { recursive: true }).filter((f) => fs.statSync(path.join(o.out, f)).isFile()).sort(), ['data/report-summaries.json', 'reports/018/index.html'], 'AC-18: only the page and the summaries are written');
  assert.doesNotThrow(() => B.checkReport(o), 'AC-17 control: the page just written passes --check');
  const attempts = root.ctx.plan.execution.attempts;
  assert.deepEqual([...html.matchAll(/data-attempt="([a-f0-9]{64})"/g)].map((m) => m[1]), attempts.map((a) => a.attempt_id), 'AC-2: one row per attempt, in plan order');
  const counted = { ABOVE_PLACEBO: 0, BELOW_PLACEBO: 0, NO_DIFFERENCE: 0, INCONCLUSIVE: 0, UNDERPOWERED: 0, NOT_MEASURED: 0 };
  let routerAbove = 0;
  for (const [i, a] of attempts.entries()) {
    const s = sectionOf(html, a.attempt_id); const text = textOf(s);
    // AC-9: the limitation with every reading, verbatim, once per row.
    assert.equal((s.match(/class="judge-limitation"/g) || []).length, 1, 'one limitation element per row');
    assert.ok(text.includes(LIMITATION), 'AC-9: the limitation in row ' + (i + 1));
    assert.ok(!s.includes('report-015-context'), 'AC-10: no row context from another report');
    if (i === 19) {
      assert.match(s, /data-reading="NOT_MEASURED"/); assert.ok(text.includes('no sealed receipt for this attempt (CANCELLED)'), 'AC-2: a failure renders its reason');
      counted.NOT_MEASURED += 1; continue;
    }
    const r = receiptOf(root, i); const reading = placeboReading(r);
    assert.ok(text.includes('Against the same-length placebo: ' + placeboLine(reading)), 'AC-3: the placebo line, verbatim, rank ' + (i + 1));
    if (REAL.rows[i].router) {
      assert.ok(text.includes('Against no skill: ' + policy.LABEL + '.'), 'AC-5: a router row reads the limit');
      assert.doesNotMatch(text, /The skill clearly (helped|hurt)|Too few answers to tell|No clear difference/, 'no skill verdict on a router row');
    } else {
      const pr = plainOf(r);
      assert.ok(text.includes('Against no skill: ' + pr.sentence), 'AC-3, AC-11: the verdict sentence, verbatim');
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
    const second = { above: 'NO_DIFFERENCE', below: 'PLACEBO_ABOVE_BASELINE', level: 'NO_DIFFERENCE' }[patternOf(i)];
    assert.ok(text.includes('The placebo against no skill, shown here and not counted: ' + second), 'AC-6: the secondary reading');
    if (REAL.rows[i].router) {
      routerAbove += reading.reading === 'ABOVE_PLACEBO' ? 1 : 0;
      assert.ok(text.includes(policy.REASON) && s.includes('href="/reports/015/#amendment-1"') && text.includes('Left out of the headline count.'), 'AC-5: the router qualification');
    } else counted[reading.reading] += 1;
    assert.doesNotMatch(s.slice(0, s.indexOf('class="placebo-line"')), /<data /, 'AC-12: the heading and router lines carry no figure');
  }
  assert.equal(routerAbove, 4, 'every router reads above the placebo in this fixture');
  // AC-4: the headline, filled by hand from the counts above over the 16; the dek is the template line itself.
  assert.equal(Object.values(counted).reduce((n, x) => n + x, 0), 16);
  const A = counted.ABOVE_PLACEBO; assert.ok(A > 0 && A < 16);
  const [big, counts, routers] = lines(html);
  assert.equal(big, A + ' of 16 skills beat the fake on Haiku 5.5: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none. A skill that did not beat the fake is not shown to do no better than it.');
  assert.equal(counts, 'Of the 16: ABOVE_PLACEBO ' + A + ', BELOW_PLACEBO ' + counted.BELOW_PLACEBO + ', NO_DIFFERENCE ' + counted.NO_DIFFERENCE + ', INCONCLUSIVE 0, UNDERPOWERED 0, NOT_MEASURED ' + counted.NOT_MEASURED + '. Beat the fake means ABOVE_PLACEBO only.');
  assert.match(routers, /^find-skills, agent-browser, hyperframes and hyperframes-registry are left out of these counts/);
  assert.ok(html.includes('data-fn="placebo-tally"'), 'the counts line carries the tally mark spec 134 A-134-22 reads');
  // A-669-3: the chart's counts and the plain counts line are the tally's, by hand from the counts above.
  chartReads(html, { ABOVE_PLACEBO: A, BELOW_PLACEBO: counted.BELOW_PLACEBO, NO_DIFFERENCE: counted.NO_DIFFERENCE, INCONCLUSIVE: 0, UNDERPOWERED: 0, NOT_MEASURED: counted.NOT_MEASURED }, 16);
  rowsCollapse(html);
  // A-669-1: the description opens with the dek's first clause verbatim (spec 020 AC-14), then names the fake.
  assert.equal(/data-card-description="([^"]*)"/.exec(html)[1], A + ' of 16 skills beat the fake on Haiku 5.5 by the case rule: the fake is a same-length placebo text.', 'AC-4: the description is the first claim, whole');
  assert.ok(big.startsWith(A + ' of 16 skills beat the fake on Haiku 5.5'), 'the description\'s opening is the dek\'s');
  // AC-9: the limitation before any reading: once before the headline, and in the summary row.
  const before = html.slice(0, html.indexOf('<div class="headline">'));
  assert.equal((before.match(/class="judge-limitation"/g) || []).length, 1, 'one limitation line before the headline');
  assert.ok(textOf(before).includes(LIMITATION));
  assert.equal(LIMITATION, repositoryJudgeRelationship(HAIKU, HAIKU).limitation);
  assert.equal((html.match(/class="judge-limitation"/g) || []).length, 21, 'before the headline and in every row');
  assert.ok(textOf(/<p class="headline-caveat">([\s\S]*?)<\/p>/.exec(html)[1]) === CAVEAT, 'AC-11: the caveat, with no count');
  // AC-13: the hand-off note after the caveat and in both hand-off rows, the plan's words.
  const note = root.ctx.plan.handoff.note;
  assert.deepEqual([...html.matchAll(/<p class="handoff-note">([\s\S]*?)<\/p>/g)].map((m) => textOf(m[1])), [note, note, note]);
  assert.match(html, /<p class="headline-caveat">[^<]*<\/p><p class="handoff-note">/, 'after the caveat');
  assert.deepEqual(html.split('<section class="placebo-result').slice(1).filter((s) => s.includes('class="handoff-note"')).map((s) => /data-attempt="([a-f0-9]{64})"/.exec(s)[1]), root.ctx.plan.handoff.attempt_ids, 'in exactly the two rows');
  // AC-16: the panel is the shortest counted skill, its text the panel input's, its fake rebuilt here.
  const pick = attempts.map((a, i) => ({ a, i })).filter(({ i }) => i !== 19 && !REAL.rows[i].router).sort((x, y) => Buffer.byteLength(textFor(x.a.protocol.skill)) - Buffer.byteLength(textFor(y.a.protocol.skill)) || x.i - y.i)[0];
  const skillText = textFor(pick.a.protocol.skill); const fake = placebo.placeboFor({ skillText, seed: receiptOf(root, pick.i).skill.content_hash }).text;
  assert.ok(html.includes('<pre class="panel-skill">' + esc(skillText) + '</pre>') && html.includes('<pre class="panel-placebo">' + esc(fake) + '</pre>'), 'AC-16: the panel');
  assert.ok(!html.includes('href="/placebo/"'), 'AC-16: no link while docs/placebo/ does not exist');
  assert.ok(B.buildReport({ ...o, placeboPage: true }).html.includes('<a href="/placebo/">Fake my file</a>'), 'AC-16: the link once it does');
  // AC-12: no confidence lexicon, ratio or ranking word in the visible text; every number element names a source.
  const visible = textOf(html.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<head>[\s\S]*?<\/head>/, ''));
  assert.doesNotMatch(visible, /\b(confiden\w*|significan\w*|likely|probabl\w*|prove[sn]?|proof|ratio|ranking|ranked|winners?|best|worst|percent)\b|%/i);
  for (const m of html.matchAll(/<data value="(\d[\d.]*)"([^>]*)>/g)) assert.match(m[2], /data-src="[^"]+"/, 'a number element names its source');
  // AC-10: outside the note's own sections, no Report 017, and Report 015 only as the amendment citation.
  const outside = outsideNote(html);
  assert.doesNotMatch(outside, /Report 017/);
  for (const m of outside.matchAll(/Report 015(?! Amendment 1)/g)) assert.fail('Report 015 named outside the amendment citation: ' + outside.slice(m.index, m.index + 60));
  // AC-14: the run record.
  const record = textOf(/<section id="campaign-run-record">([\s\S]*?)<\/section>/.exec(html)[1]);
  assert.ok(record.includes('Recorded costs are API-equivalent estimates, not a subscription invoice.') && record.includes('The surface was claude-cli.'));
  assert.ok(record.includes('campaign-001/manifest.json, SHA-256 ' + sha256(fs.readFileSync(root.head))), 'the manifest and its hash');
  assert.ok(record.includes('Plan SHA-256 ' + sha256(fs.readFileSync(path.join(root.croot, 'plan.json')))) && record.includes('Pre-registered note SHA-256 ' + sha256(fs.readFileSync(path.join(root.croot, 'outcomes.md')))));
  for (const f of B.READER) assert.ok(record.includes(f + ', SHA-256 ' + sha256(fs.readFileSync(path.join(ROOT, f)))), 'the reader pin ' + f);
  assert.ok(B.READER.includes('specs/655-report-018-plan/run-campaign.cjs') && !B.READER.includes('scripts/prepare-report-017.js'), 'the reader is this plan\'s; Report 017\'s builder is not imported');
  assert.ok(record.includes('19 of 20 attempts have a sealed receipt'));
  // AC-15: the limits.
  const limits = textOf(html.slice(html.indexOf('<h2>Limits</h2>'), html.indexOf('<section id="campaign-run-record">')));
  for (const s of [P408.SCOPE, P408.ISOLATION, P408.ROUTER, 'The judge is the target\'s model.', 'The placebo text is not inert', 'It does not combine the 20 readings into one score.', 'a placebo text can still bear on a task by chance']) assert.ok(limits.includes(s), s);
  // The method carries the note's own sections, the methods sentence among them.
  const method = textOf(html.slice(html.indexOf('<h2>Method</h2>'), html.indexOf('<h2>Limits</h2>')));
  for (const s of ['The judge is claude-haiku-5-5, the judge the judge policy fixes', 'One methods sentence names the design and what changed', 'The report reads exactly one sealed receipt per attempt id', 'The headline counts the other 16 skills. N is 16.', 'grill-me and grill-with-docs each have a whole text that only calls another skill']) assert.ok(method.includes(s), s);
  // AC-17: a committed page edited while the receipts stay refuses --check.
  const pub017 = require(path.join(ROOT, S613, 'publication.cjs')).publication({ campaignRoot: path.join(ROOT, 'receipts/report-017c'), stub: false });
  const plants = [
    ['a placebo line retyped', (h) => h.replace(esc(PLACEBO_WORDS.ABOVE_PLACEBO), 'beat the fake')],
    ['a tally count changed', (h) => h.replace(/(<p class="headline-counts" data-fn="placebo-tally">Of the <data value="16"[^>]*>16<\/data>: ABOVE_PLACEBO <data value=")(\d+)("[^>]*>)(\d+)/, (_, a, n, b) => a + (Number(n) + 1) + b + (Number(n) + 1))],
    ['a headline word changed', (h) => h.replace('skills beat the fake on Haiku 5.5: by the case rule', 'skills outscored the fake on Haiku 5.5: by the case rule')],
    ['the limitation removed from one row', (h) => h.replace(/(<\/details>)<p class="judge-limitation">[^<]*<\/p>/, '$1')],
    ['a Report 017 figure inserted', (h) => h.replace('<p class="headline-routers">', '<p class="headline-context">Report 017: ' + esc(pub017.headline[1]) + '</p><p class="headline-routers">')],
    // A-669-3: a chart count typed instead of read; a limitation hidden inside a closed details.
    ['a chart count typed', (h) => h.replace(/(<text [^>]*class="chart-count" data-count-of="ABOVE_PLACEBO">)(\d+)(<\/text>)/, (_, a, n, b) => a + (Number(n) + 1) + b)],
    ['a limitation hidden inside a closed details', (h) => h.replace(/<\/details>(<p class="judge-limitation">[^<]*<\/p>)<\/section>/, '$1</details></section>')],
  ];
  for (const [what, edit] of plants) {
    const edited = edit(html); assert.notEqual(edited, html, what + ' is planted');
    fs.writeFileSync(done.page, edited); assert.throws(() => B.checkReport(o), code('REPORT_DRIFT'), what);
  }
  fs.writeFileSync(done.page, html);
  const summary = fs.readFileSync(done.summaryFile, 'utf8');
  // The plant edits this report's own row: the builder owns the 018 row alone, so another row's word is not its drift.
  assert.ok(summary.includes('beat the fake on Haiku 5.5'), 'the 018 row is in the summaries');
  fs.writeFileSync(done.summaryFile, summary.replace('beat the fake on Haiku 5.5', 'outscored the fake on Haiku 5.5')); assert.throws(() => B.checkReport(o), code('REPORT_SUMMARY_DRIFT'), 'a summary word');
  fs.writeFileSync(done.summaryFile, summary); assert.doesNotThrow(() => B.checkReport(o), 'control: restored');
  // The summary row quotes the page, and carries the limitation and the caveat.
  const points = json(done.summaryFile).reports['018'].points;
  for (const p of points) assert.ok(textOf(html).includes(p.text), p.lead);
  assert.ok(points.some((p) => p.text === LIMITATION) && points.some((p) => p.text === CAVEAT), 'the summary states the limitation and the caveat');
  assert.equal(points.find((p) => p.lead === 'What we found.').text, big, 'the finding is the dek');
});

test('AC-1: a score edited and resealed is refused by the reconstruction, which the reader alone does not see', async () => {
  const root = await paidRoot(); const B = builder(); const i = 1;
  const a = root.ctx.plan.execution.attempts[i]; const r = receiptOf(root, i); const answers = json(path.join(root.out, a.attempt_id + '-answers.json'));
  const c = r.results.cases.find((x) => x.mode === 'baseline'); const d = c.generation.draws[0];
  d.samples[0] = d.samples[0] === 0 ? 1 : 0; d.mean = round(mean(d.samples)); d.stddev = round(stddev(d.samples));
  Object.assign(c.generation, acrossDraws(c.generation.draws)); c.mean = c.score = c.generation.mean; c.stddev = c.generation.sd; c.outcome = outcomeFor(c.mean, c.stddev, c.threshold);
  const x = comparisonOf(r.results.cases); r.results.aggregates = x.aggregates; r.comparison = x.comparison;
  reseal(root, i, r, answers);
  assert.equal(R.publication({ root: F.root, campaignRoot: root.croot, stub: false, recordedHeads: HEADS, reader: READER }).rows.length, 20, 'the reader alone reads the planted root');
  assert.throws(() => B.buildReport(opts(root)), code('SCORE_RECONSTRUCTION'));
});

test('AC-2: a dropped receipt, a dropped outcome, or a second receipt for one attempt id refuses', async () => {
  const B = builder();
  const root = await paidRoot(); const id = root.ctx.plan.execution.attempts[3].attempt_id;
  fs.unlinkSync(path.join(root.out, id + '.json'));
  assert.throws(() => B.buildReport(opts(root)), code('ATTEMPT_COVERAGE'), 'a receipt file deleted');
  const other = await paidRoot(); const m = json(other.head); m.outcomes.splice(3, 1); fs.writeFileSync(other.head, JSON.stringify(m, null, 2) + '\n');
  assert.throws(() => B.buildReport(opts(other)), code('ATTEMPT_COVERAGE'), 'an outcome removed from the manifest');
  // A copy of the finished campaign, chained as a resume of it: every attempt id now has two receipts.
  const dup = await paidRoot(); const second = path.join(dup.croot, 'campaign-002'); fs.cpSync(dup.out, second, { recursive: true });
  const first = fs.readFileSync(dup.head); const copy = json(path.join(second, 'manifest.json'));
  copy.priors = [{ path: '../campaign-001/manifest.json', sha256: sha256(first), adjustments: [] }];
  fs.writeFileSync(path.join(second, 'manifest.json'), JSON.stringify(copy, null, 2) + '\n');
  const entry = R.readLog(dup.croot)[0];
  fs.appendFileSync(path.join(dup.croot, 'campaign.log'), JSON.stringify({ ...entry, manifest: 'campaign-002/manifest.json', priors: ['campaign-001/manifest.json'] }) + '\n');
  assert.throws(() => B.buildReport(opts(dup)), code('PRIOR_DUPLICATE_RECEIPT'), 'a second receipt for one attempt id');
});

test('AC-6: the placebo against no skill moves rows, never a headline line', async () => {
  const B = builder();
  const a = B.buildReport(opts(await paidRoot())).html;
  const b = B.buildReport(opts(await paidRoot({ arms: { ...ARMS, above: { with_skill: 0.9, baseline: 0.9, placebo: 0.3 } } }))).html;
  assert.deepEqual(lines(a), lines(b), 'the headline is unmoved');
  assert.ok(textOf(a).includes('not counted: NO_DIFFERENCE') && textOf(b).includes('not counted: PLACEBO_BELOW_BASELINE'), 'the rows moved');
});

test('AC-7, AC-9: a placebo block that does not check reads not measured, never a direction; the builder refuses it; a row without the limitation refuses', async () => {
  const B = builder(); const root = await paidRoot(); const i = 0;
  const a = root.ctx.plan.execution.attempts[i]; const r = receiptOf(root, i); const answers = json(path.join(root.out, a.attempt_id + '-answers.json'));
  r.placebo.comparison.delta += 0.1;
  const readings = T.readingsOf(r);
  const row = { index: i, attempt: a, attempt_id: a.attempt_id, skill: a.protocol.skill, repository: a.protocol.repository, router: false, reading: { ...readings, receipt_hash: r.receipt_hash }, receipt: r, src: 'synthetic', reason: null, limitation: LIMITATION };
  const html = B.rowHTML(row);
  assert.match(html, /data-reading="NOT_MEASURED"/);
  assert.ok(textOf(html).includes('Against the same-length placebo: not measured against the placebo (placebo_unverified)'));
  for (const w of [...Object.values(PLACEBO_WORDS), 'ABOVE_PLACEBO', 'BELOW_PLACEBO', 'with the same-length placebo ']) assert.ok(!textOf(html).includes(w), 'no direction: ' + w);
  assert.throws(() => B.rowHTML({ ...row, limitation: '' }), code('LIMITATION_BINDING'), 'AC-9: a row without the limitation');
  assert.throws(() => B.rowHTML({ ...row, limitation: 'The judge is a different model.' }), code('LIMITATION_BINDING'), 'AC-9: a row with another string');
  reseal(root, i, r, answers);
  assert.throws(() => B.buildReport(opts(root)), code('PLACEBO_ARM'));
});

test('AC-8: publish mode refuses a stub chain; test mode reads it and never writes under docs/', async () => {
  const B = builder(); const root = await stubRoot();
  const o = opts(root);
  assert.throws(() => B.writeReport(o), code('UNVERIFIED')); assert.deepEqual(fs.readdirSync(o.out), [], 'nothing written');
  const stub = B.writeReport({ ...o, stub: true }); const html = fs.readFileSync(stub.page, 'utf8');
  assert.equal((html.match(/data-reading="NOT_MEASURED"/g) || []).length, 20, 'every stub row reads NOT_MEASURED');
  assert.ok(lines(html)[0].startsWith('16 of 16 skills were not measured against the same-length placebo on Haiku 5.5'));
  assert.equal(/data-card-description="([^"]*)"/.exec(html)[1], '16 of 16 skills were not measured against the same-length placebo on Haiku 5.5, and 0 of 16 beat the fake by the case rule.');
  assert.doesNotThrow(() => B.checkReport({ ...o, stub: true }));
  const before = fs.existsSync(path.join(ROOT, 'docs/reports/018'));
  assert.throws(() => B.writeReport({ ...o, stub: true, out: path.join(ROOT, 'docs') }), code('OUTPUT_DIRECTORY'));
  const cli = spawnSync(process.execPath, [BUILDER, '--stub', '--root', root.croot, '--out', path.join(ROOT, 'docs')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /report 018: refused: OUTPUT_DIRECTORY/);
  assert.equal(fs.existsSync(path.join(ROOT, 'docs/reports/018')), before, 'docs/ is not written');
});

test('AC-13, AC-16: a panel or hand-off input that is not the sealed skill refuses', async () => {
  const B = builder(); const root = await paidRoot();
  const panel = tmp('panel'); fs.cpSync(F.panel, panel, { recursive: true });
  const pick = B.panelOf(B.readCampaign(opts(root)).rows, panel).row;
  fs.appendFileSync(path.join(panel, pick.panel_id + '.md'), 'x');
  assert.throws(() => B.buildReport(opts(root, { panelDir: panel })), code('PANEL_BINDING'), 'one byte');
  fs.unlinkSync(path.join(panel, pick.panel_id + '.md'));
  assert.throws(() => B.buildReport(opts(root, { panelDir: panel })), code('PANEL_INPUT'), 'the input missing');
  // The hand-off texts, by the row's Report 017 attempt id.
  const rows = root.ctx.plan.rows; const handoff = rows.find((r) => r.skill === 'grill-with-docs');
  const h = tmp('handoff'); fs.cpSync(F.panel, h, { recursive: true });
  fs.appendFileSync(path.join(h, handoff.report_017_attempt_id + '.md'), 'x');
  assert.throws(() => B.buildReport(opts(root, { panelDir: h })), code('HANDOFF_BINDING'), 'one byte added to a hand-off text');
  fs.writeFileSync(path.join(h, handoff.report_017_attempt_id + '.md'), plain('grill-with-docs'));
  assert.throws(() => B.buildReport(opts(root, { panelDir: h })), code('HANDOFF_BINDING'), 'a text that is not the pin');
  fs.unlinkSync(path.join(h, handoff.report_017_attempt_id + '.md'));
  assert.throws(() => B.buildReport(opts(root, { panelDir: h })), code('HANDOFF_INPUT'), 'the text missing');
  // A text that is the pin but does not hand off: the fixture is re-pinned over it, so the rule alone refuses.
  const prose = handsOff('grill-me').trimEnd() + ' Then write a summary.\n';
  assert.equal(H.handsOffOnly(prose), false, 'control: the rule refuses the text');
  assert.throws(() => H.handoffTexts({ plan: { execution: { attempts: [{ attempt_id: 'a'.repeat(64), protocol: { repository: 'x', skill: 'grill-me', skill_sha256: sha256(prose) } }] } }, panelDir: (() => { const d = tmp('rule'); fs.writeFileSync(path.join(d, 'a'.repeat(64) + '.md'), prose); return d; })(), ids: ['a'.repeat(64)] }), code('HANDOFF_RULE'));
});

test('AC-4, AC-9, AC-10, AC-11, AC-14, AC-17: the published page is what the builder makes from receipts/report-018, its dek the reader\'s headline, with no Report 017 reading', () => {
  const B = builder();
  assert.equal(B.CAMPAIGN, CAMPAIGN);
  const done = B.checkReport(B.parse([]));
  const pub = R.publication({ campaignRoot: path.join(ROOT, CAMPAIGN), stub: false });
  const html = fs.readFileSync(done.page, 'utf8');
  assert.deepEqual(lines(html), pub.headline, 'the dek is the frozen template line verbatim, then the counts and the routers');
  assert.equal(pub.tally.N, 16); assert.equal(pub.tally.shape, 'some');
  assert.equal(done.built.campaign.rows.filter((r) => r.receipt).length, 20);
  assert.equal((html.match(/<section class="placebo-result router-result"/g) || []).length, 4);
  assert.equal((html.match(/class="judge-limitation"/g) || []).length, 21, 'the limitation before the headline and in every row');
  assert.equal(textOf(/<p class="headline-caveat">([\s\S]*?)<\/p>/.exec(html)[1]), CAVEAT);
  // A-669-3: the chart and the plain counts line are the reader's tally; every row collapses with its limitation visible.
  chartReads(html, { ABOVE_PLACEBO: pub.tally.A, BELOW_PLACEBO: pub.tally.B, NO_DIFFERENCE: pub.tally.D, INCONCLUSIVE: pub.tally.I, UNDERPOWERED: pub.tally.U, NOT_MEASURED: pub.tally.M }, pub.tally.N);
  rowsCollapse(html);
  const body = html.slice(html.indexOf('<h2 id="each-skill">'), html.indexOf('<h2>Method</h2>'));
  assert.ok(!body.includes('<script') && !body.includes('data-island'), 'no script in the rows: they open without it');
  for (const s of html.split('<section class="placebo-result').slice(1)) {
    assert.ok(/Against the same-length placebo: /.test(textOf(s)) && /Against no skill: /.test(textOf(s)), 'both readings on every row');
    if (s.startsWith(' router-result')) assert.doesNotMatch(textOf(s.slice(0, s.indexOf('</section>'))), /The skill clearly (helped|hurt)/);
  }
  // AC-11: a skill that beat the fake and regressed against no skill shows both, in its receipt's own words.
  const both = done.built.campaign.rows.filter((r) => r.receipt && !r.router && r.reading.placebo === 'ABOVE_PLACEBO' && r.reading.verdict === 'REGRESSED');
  assert.ok(both.length > 0, 'the campaign holds such a receipt');
  for (const r of both) {
    const text = textOf(sectionOf(html, r.attempt_id));
    assert.ok(text.includes('Against the same-length placebo: ' + PLACEBO_WORDS.ABOVE_PLACEBO) && text.includes('Against no skill: ' + plainOf(r.receipt).sentence), r.skill);
  }
  // AC-10: no Report 017 reading, by the oracle of spec 613's own reader; no Report 015 context.
  const pub017 = require(path.join(ROOT, S613, 'publication.cjs')).publication({ campaignRoot: path.join(ROOT, 'receipts/report-017c'), stub: false });
  const visible = textOf(html);
  for (const line of pub017.headline.slice(0, 2)) assert.ok(!visible.includes(line), 'no Report 017 headline line');
  assert.ok(!visible.includes('On Claude Sonnet 5.5, ') && !html.includes('report-015-context') && !visible.includes('Report 015 read this skill'));
  assert.doesNotMatch(outsideNote(html), /Report 017/);
  // AC-14: three manifests, the chain's spend, the recorded head.
  const record = textOf(/<section id="campaign-run-record">([\s\S]*?)<\/section>/.exec(html)[1]);
  for (const n of [1, 2, 3]) assert.ok(record.includes(CAMPAIGN + '/campaign-' + n + '/manifest.json, SHA-256 ' + sha256(fs.readFileSync(path.join(ROOT, CAMPAIGN, 'campaign-' + n, 'manifest.json')))));
  assert.ok(record.includes('20 of 20 attempts have a sealed receipt') && record.includes('The surface was claude-cli.'));
  assert.ok(record.includes('Recorded spend across the chain: USD ' + done.built.campaign.ledger.spent + '.'));
  // Issue 671 (A-669-4): where a row's overall averages do not point its verdict's way, the line against no
  // skill names the task that decided it, in lib/plain.js's words, and never pairs the averages with the verdict.
  const points = (r) => Number(r.receipt.comparison.with_skill_score.toFixed(3)) > Number(r.receipt.comparison.baseline_score.toFixed(3));
  const disagree = done.built.campaign.rows.filter((r) => r.receipt && !r.router && ['PASSED', 'REGRESSED'].includes(r.reading.verdict) && points(r) !== (r.reading.verdict === 'PASSED'));
  assert.deepEqual(disagree.map((r) => r.skill).sort(), ['frontend-design', 'grill-me', 'grilling']);
  for (const r of disagree) {
    const text = textOf(sectionOf(html, r.attempt_id));
    assert.ok(text.includes('Against no skill: The skill clearly ' + (r.reading.verdict === 'PASSED' ? 'helped' : 'hurt') + ' on 1 of 3 test tasks: the '), r.skill);
    assert.ok(text.includes('Against no skill: ' + plainOf(r.receipt).sentence), r.skill + ': the library\'s words');
    assert.doesNotMatch(text, /The skill clearly (?:helped|hurt): \d/, r.skill + ': the averages are not paired with the verdict');
  }
  // The page's dated record of that rewording, after the run record and before the receipts (spec 020 AC-21).
  const entry = '<h2 id="amendments">Amendments</h2><section id="amendment-1"><h3>Amendment 1, 3 Nov 2026</h3><p>Reworded the line against no skill in the rows where the overall averages with and without the skill do not point the verdict&#39;s way: it names the task that decided it and gives the averages over all the tasks. The verdict is decided per task, so those averages can sit equal or point the other way. Counts, readings and receipts are unchanged.</p></section>';
  assert.ok(html.indexOf('<section id="campaign-run-record">') < html.indexOf(entry) && html.indexOf(entry) < html.indexOf('<h2>Receipts</h2>'), 'after the run record, before the receipts');
  assert.equal(require(path.join(ROOT, 'scripts/site-chrome.js')).splitReportBody(html).amendments, entry);
  // The data layer: what moved is the placebo text; the summary's limit names the snapshot, model, judge and tasks.
  const rows = json(path.join(ROOT, 'docs/data/reports.json')).reports;
  assert.equal(rows.find((r) => r.number.value === '018').what_moved.value, 'a same-length placebo text');
  const summary = json(path.join(ROOT, 'docs/data/report-summaries.json')).reports['018'];
  const limit = summary.points.at(-1); assert.equal(limit.lead, 'What it does not show.');
  for (const w of ['Skills.sh snapshot of 2026-10-17', 'Claude Haiku 5.5', 'three text tasks']) assert.ok(limit.text.includes(w), w);
  assert.ok(summary.points.some((p) => p.text === LIMITATION), 'the summary states the limitation');
  // A-669-2 (spec 134 A-134-22, extended): the opening is spec 125's summary row, led by the
  // pre-registered headline, with the limitation and the caveat as points; no sentence read from one receipt.
  const opening = /<section class="plain-summary"[\s\S]*?<\/section>/.exec(html)[0];
  for (const p of summary.points) assert.ok(textOf(opening).includes(p.text), p.lead);
  assert.doesNotMatch(opening, /data-receipt=|class="answer/, 'no sentence read from one receipt');
});

test('A-669-2 (spec 134 A-134-22): Report 018 is set aside by the type rule, as Report 017 is; renamed or retyped, the rule would open with one-receipt verdicts', () => {
  const { answersFor } = require(path.join(ROOT, 'scripts/report-answers'));
  const { splitReportBody } = require(path.join(ROOT, 'scripts/site-chrome.js'));
  const rows = json(path.join(ROOT, 'docs/data/reports.json')).reports;
  const row = rows.find((r) => r.number.value === '018');
  const page = fs.readFileSync(path.join(ROOT, 'docs/reports/018/index.html'), 'utf8');
  assert.equal(answersFor(row, splitReportBody(page).body, { esc, root: ROOT }), null, 'set aside');
  // Plants: without the tally element, or with the row's type changed, the rule reads one receipt per sentence.
  const renamed = answersFor(row, splitReportBody(page.replace(/data-fn="placebo-tally"/g, 'data-fn="v"')).body, { esc, root: ROOT });
  assert.ok(renamed && renamed.answers.length >= 2, 'plant: the element renamed');
  assert.notEqual(answersFor({ ...row, type: { ...row.type, value: 'Capability-gap report' } }, splitReportBody(page).body, { esc, root: ROOT }), null, 'plant: another type');
  // Control: Report 017 reads the same way, and spec 134's § Exceptions lists both.
  const row017 = rows.find((r) => r.number.value === '017');
  assert.equal(answersFor(row017, splitReportBody(fs.readFileSync(path.join(ROOT, 'docs/reports/017/index.html'), 'utf8')).body, { esc, root: ROOT }), null);
  const md = fs.readFileSync(path.join(ROOT, 'specs/134-seo-answer-first-reports/spec.md'), 'utf8');
  const ex = md.slice(md.indexOf('\n## Exceptions'), md.indexOf('\n## ', md.indexOf('\n## Exceptions') + 5));
  assert.ok(/^\| 017 \|/m.test(ex) && /^\| 018 \|/m.test(ex), 'both listed');
});

test('AC-5, AC-16: the Markdown copy holds the panel\'s bytes; the router receipt pages take the limit by rule; every receipt page points to Report 018', () => {
  const B = builder(); const html = fs.readFileSync(path.join(ROOT, 'docs/reports/018/index.html'), 'utf8');
  const md = fs.readFileSync(path.join(ROOT, 'docs/reports/018/index.md'), 'utf8');
  const at = md.indexOf('Its same-length placebo'); const block = /```\n([\s\S]*?)\n```/.exec(md.slice(at))[1];
  const c = B.readCampaign({ campaignRoot: path.join(ROOT, CAMPAIGN) });
  const pick = B.panelOf(c.rows, path.join(ROOT, B.PANEL)).row; const p = pick.receipt.placebo;
  assert.equal(Buffer.byteLength(block, 'utf8'), p.bytes, 'the copy holds every byte');
  assert.equal(sha256(block), p.sha256, 'the copy hashes to the receipt\'s placebo.sha256');
  const tail = /\s+$/.exec(block); if (tail) assert.ok(html.includes('<p class="panel-note">This text ends with ') && md.includes('This text ends with '));
  // The meta and OG descriptions are the dek's first claim, whole.
  const pub = R.publication({ campaignRoot: path.join(ROOT, CAMPAIGN), stub: false });
  const want = pub.tally.A + ' of ' + pub.tally.N + ' skills beat the fake on Haiku 5.5 by the case rule: the fake is a same-length placebo text.';
  assert.ok(pub.headline[0].startsWith(want.split(' by the case rule')[0]), 'A-669-1: the description opens with the dek\'s first clause');
  assert.equal(/<meta name="description" content="([^"]*)"/.exec(html)[1], want); assert.equal(/<meta property="og:description" content="([^"]*)"/.exec(html)[1], want);
  assert.equal(json(path.join(ROOT, 'docs/data/reports.json')).reports.find((r) => r.number.value === '018').og_description.value, want);
  // The twenty receipt pages.
  const dir = path.join(ROOT, CAMPAIGN, 'campaign-3');
  const all = fs.readdirSync(dir).filter((f) => /^[0-9a-f]{64}\.json$/.test(f)).map((f) => json(path.join(dir, f)));
  assert.equal(all.length, 20);
  const routers = all.filter((r) => P.ROUTERS.includes(r.skill.name)); assert.equal(routers.length, 4);
  for (const r of all) {
    assert.equal(!!policy.routerLimit(r), routers.includes(r), r.skill.name);
    const page = fs.readFileSync(path.join(ROOT, 'docs/r', r.receipt_hash, 'index.html'), 'utf8');
    assert.ok(page.includes('<a href="/reports/018/">Report 018</a> shows that reading.'), r.skill.name + ': the receipt page points to the placebo reading');
    if (!routers.includes(r)) continue;
    const verdict = textOf(/<section class="receipt-verdict[\s\S]*?<\/section>/.exec(page)[0]);
    assert.ok(verdict.includes(policy.LABEL) && verdict.includes(policy.REASON) && page.includes('href="/reports/015/#amendment-1"'), r.skill.name + ': the limit and Amendment 1');
    assert.doesNotMatch(verdict, /Regressed|Passing|clearly (helped|hurt)/i, r.skill.name + ': no skill verdict on the page');
    const badge = fs.readFileSync(path.join(ROOT, 'docs/r', r.receipt_hash, 'badge.svg'), 'utf8');
    assert.ok(badge.includes(policy.LABEL) && !/passing|regressed/i.test(badge), r.skill.name + ': the badge');
  }
  // The receipt-page builder names this campaign root as the one whose receipts point to Report 018.
  assert.ok(fs.readFileSync(path.join(ROOT, 'scripts/build-receipt-pages.js'), 'utf8').includes("'" + CAMPAIGN + "/'"));
});

test('AC-18: Reports 013, 015, 016 and 017 still match their own --check, the summaries keep their rows, and Report 017\'s builder is the bytes its page pins', async () => {
  const B = builder(); const o = opts(await paidRoot()); const done = B.writeReport(o);
  const before = json(path.join(ROOT, 'docs/data/report-summaries.json')); const after = json(done.summaryFile);
  const others = (s) => Object.keys(s.reports).filter((k) => k !== '018');
  assert.deepEqual(others(after), others(before));
  for (const k of others(before)) assert.deepEqual(after.reports[k], before.reports[k], k);
  const page017 = textOf(fs.readFileSync(path.join(ROOT, 'docs/reports/017/index.html'), 'utf8'));
  assert.ok(page017.includes('scripts/prepare-report-017.js, SHA-256 ' + sha256(fs.readFileSync(path.join(ROOT, 'scripts/prepare-report-017.js')))), 'Report 017\'s page pins its builder\'s live bytes');
  for (const n of ['013', '015', '016', '017']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/prepare-report-' + n + '.js'), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
    assert.equal(r.status, 0, n + ': ' + r.stderr);
  }
});
