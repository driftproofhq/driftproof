#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 790: Report 019's readers. Every reading on the page comes from here, and nothing here renders.
//   - The text twenty: spec 783 plan (a)'s `publication`, the reader its campaign was planned with.
//   - Report 020's three pairs: spec 783 plan (b)'s `verdicts`.
//   - The six with tools on: read here, over spec 786's manifest and plan (AC-1 to AC-6).
// Plans (a) and (b) load the plan's own registry copy, which lib/models.js fixes when it loads, so they
// are read in a child process with DRIFTPROOF_REGISTRY set to that copy. The parent then reads every
// receipt again and checks it is the one the child read. scripts/site-data.mjs requires this file for
// the latest report's counts, so it requires no page builder.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { sha256 } = require('../lib/canonical');
const { verifyReceiptHash, validateReceipt } = require('../lib/receipt');
const { placeboReading, placeboLine, placeboProblems, receiptVerdict } = require('../lib/verdict');
const { plainOf } = require('../lib/plain');
const O = require('./offer.js');
const redaction = require('./answer-redaction.js');

const ROOT = path.resolve(__dirname, '..');
const S783 = 'specs/783-fable-5-2-scope', S786 = 'specs/786-tools-on-routers';
const TEXT = 'receipts/report-019', TOOLS = 'receipts/report-019-tools-on', BOUNDARY = 'receipts/report-020';
const REGISTRY = path.join(ROOT, S783, 'registry.json');
// The six read with tools on (spec 783 A-783-4, spec 786 AC-1), in plan (a)'s order on the page.
const SIX = ['find-skills', 'grill-me', 'grill-with-docs', 'agent-browser', 'hyperframes', 'hyperframes-registry'];
const MODEL = 'claude-fable-5-2', JUDGE = 'claude-haiku-5-5', CLI = '2.1.311';
const COUNTS = [['A', 'ABOVE_PLACEBO'], ['B', 'BELOW_PLACEBO'], ['D', 'NO_DIFFERENCE'], ['I', 'INCONCLUSIVE'], ['U', 'UNDERPOWERED'], ['M', 'NOT_MEASURED']];
// The caveat on top scores (spec 790 AC-10): a task-arm mean at or above this reads as at or near the top.
const TOP = 0.9;
const NETWORKS = new Set(['none', 'draw-loopback']);
// The words for each kind of local copy a world spec names (spec 790 TBD-6). An unknown kind refuses.
const COPY_KINDS = { 'skills-api': 'the skills registry', npm: 'an npm registry', app: 'a web app', static: 'the HyperFrames registry' };

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const need = (ok, code) => { if (!ok) fail(code); };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const relOf = (f) => { const r = path.relative(ROOT, f); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : path.basename(f); };
const contentHashOf = (skillSha) => require('node:crypto').createHash('sha256').update('SKILL.md').update('\0').update(skillSha).update('\n').digest('hex');

function gitReader(root = ROOT) {
  const git = (args) => spawnSync('git', args, { cwd: root, maxBuffer: 1 << 28 });
  return {
    isAncestor: (h) => git(['merge-base', '--is-ancestor', h, 'HEAD']).status === 0,
    show: (h, f) => { const r = git(['show', h + ':' + f]); return r.status === 0 ? r.stdout : null; },
  };
}

// ── the six, with tools on ──
function readToolsOn({ root = path.join(ROOT, TOOLS), git = gitReader(), stub = false } = {}) {
  const dir = path.resolve(root), plan = read(path.join(ROOT, S786, 'plan.json')), planBytes = fs.readFileSync(path.join(ROOT, S786, 'plan.json'));
  const noteBytes = fs.readFileSync(path.join(ROOT, plan.outcomes.path));
  need(sha256(noteBytes) === plan.outcomes.sha256, 'OUTCOMES_BINDING');
  const mfile = path.join(dir, 'manifest.json'); need(fs.existsSync(mfile), 'CAMPAIGN_ROOT');
  const mbytes = fs.readFileSync(mfile), m = JSON.parse(mbytes);
  need(m.format === 'driftproof-786-campaign/1' && Array.isArray(m.starts) && Array.isArray(m.outcomes), 'PRIOR_MANIFEST');
  if (!stub) need(m.stub === false, 'UNVERIFIED');
  const attempts = plan.attempts;
  need(attempts.length === 6 && [...attempts.map((a) => a.protocol.skill)].sort().join() === [...SIX].sort().join(), 'PLAN_BINDING');
  const supersedesOf = (a) => [].concat(a.supersedes || []);
  const superseded = new Set(attempts.flatMap(supersedesOf));
  // AC-2: one receipt per attempt; the superseded attempt is never a receipt; nothing foreign.
  const receiptsOf = (id) => m.outcomes.filter((o) => o.attempt_id === id && o.status === 'receipt');
  for (const o of m.outcomes) if (o.status === 'receipt') need(receiptsOf(o.attempt_id).length === 1, 'PRIOR_DUPLICATE_RECEIPT');
  const files = fs.readdirSync(dir);
  for (const id of superseded) need(!receiptsOf(id).length && !files.some((f) => f.startsWith(id)), 'ATTEMPT_SUPERSEDED');
  const expected = new Set(['manifest.json', ...m.outcomes.filter((o) => o.status === 'receipt').flatMap((o) => [o.attempt_id + '.json', o.attempt_id + '-answers.json'])]);
  for (const f of files) need(expected.has(f), 'FOREIGN_FILE');
  for (const o of m.outcomes) need(o.status === 'receipt' || o.status === 'failure', 'PRIOR_MANIFEST');
  for (const o of m.outcomes.filter((x) => x.status === 'receipt')) need(attempts.some((a) => a.attempt_id === o.attempt_id), 'ATTEMPT_COVERAGE');
  for (const o of m.outcomes.filter((x) => x.status === 'failure')) need(superseded.has(o.attempt_id) || !attempts.some((a) => a.attempt_id === o.attempt_id), 'ATTEMPT_COVERAGE');
  for (const o of m.outcomes) need(Number.isFinite(o.cost_usd) && o.cost_usd >= 0, 'PRIOR_COST_UNKNOWN');

  // AC-6: every start's plan, read at its commit, is the one it records and pins the same note and checks.
  const starts = m.starts.map((s) => {
    need(/^[0-9a-f]{40}$/.test(s.head || '') && git.isAncestor(s.head), 'CAMPAIGN_HEAD');
    const b = git.show(s.head, S786 + '/plan.json'); need(b && sha256(b) === s.plan_sha256, 'PLAN_BINDING');
    const p = JSON.parse(b);
    need(p.outcomes && p.outcomes.sha256 === plan.outcomes.sha256 && p.outcomes.path === plan.outcomes.path, 'OUTCOMES_BINDING');
    const nb = git.show(s.head, p.outcomes.path); need(nb && sha256(nb) === plan.outcomes.sha256, 'OUTCOMES_BINDING');
    for (const id of s.attempts) {
      const then = p.attempts.find((a) => a.attempt_id === id); need(then, 'PLAN_BINDING');
      const now = attempts.find((a) => a.attempt_id === id);
      if (now) need(JSON.stringify(then.tasks) === JSON.stringify(now.tasks) && JSON.stringify(then.protocol) === JSON.stringify(now.protocol), 'PLAN_BINDING');
    }
    return { head: s.head, plan_sha256: s.plan_sha256, attempts: s.attempts, plan: p };
  });
  const startOf = (id) => starts.find((s) => s.attempts.includes(id));

  const rows = attempts.map((a) => {
    const [o] = receiptsOf(a.attempt_id); need(o, 'ATTEMPT_COVERAGE');
    const rf = path.join(dir, a.attempt_id + '.json'), af = path.join(dir, a.attempt_id + '-answers.json');
    need(fs.existsSync(rf) && fs.existsSync(af), 'ATTEMPT_COVERAGE');
    const r = read(rf), answers = read(af), p = a.protocol;
    // AC-1: sealed, valid, the manifest's, and its start's attempt.
    need(verifyReceiptHash(r) && r.receipt_hash === o.receipt_hash, 'RECEIPT_SEAL');
    if (!stub) need(r.verification_level === 'TESTED' && r.run.answered_by && r.run.answered_by.kind === 'model' && r.run.answered_by.attested === true, 'UNVERIFIED');
    const meta = r.results.cases[0] && r.results.cases[0].generation.issue786, st = startOf(a.attempt_id);
    for (const c of r.results.cases) need(JSON.stringify(c.generation.issue786) === JSON.stringify(meta), 'ATTEMPT_BINDING');
    need(meta && st && meta.attempt_id === a.attempt_id && meta.plan_sha256 === o.plan_sha256 && meta.head === o.head && st.plan_sha256 === o.plan_sha256 && st.head === o.head, 'ATTEMPT_BINDING');
    need(meta.budget_cost_usd === o.cost_usd, 'RECEIPT_COST');
    // AC-3: the skill's pinned bytes, the same pin plan (a) holds for that skill.
    need(r.skill.name === p.skill && r.skill.content_hash === contentHashOf(p.skill_sha256), 'SKILL_BYTES');
    // One target, one CLI, one judge, the plan's suite and capture.
    need(r.run.model_id === MODEL && p.model === MODEL && r.run.answered_by.reported_model === MODEL, 'MODEL_BINDING');
    need(r.run.harness && r.run.harness.version === CLI && p.claude_code_version === CLI, 'HARNESS_BINDING');
    need(r.run.judge.model_id === JUDGE && r.run.judge.samples === 5 && p.judge === JUDGE, 'JUDGE_BINDING');
    need(r.suite.suite_hash === p.suite_hash && r.run.surface === 'claude-cli', 'SUITE_BINDING');
    // AC-4: the frozen check's score of the end state, and nothing else.
    const sc = r.run.scoring;
    need(r.run.capture.mode === 'repository-tools-on' && p.capture === 'repository-tools-on' && sc && sc.contract === 'end-state-v1' && sc.secondary_role === 'reply-judge', 'SCORE_BASIS');
    const draws = r.results.cases.flatMap((c) => c.generation.draws.map((d) => ({ c, d })));
    for (const { d } of draws) if (d.status === 'measured') need(d.score_basis === 'end-state' && Array.isArray(d.samples) && d.samples.length === 1 && d.samples[0] === d.primary && d.end_state && d.end_state.score === d.primary, 'SCORE_BASIS');
    const frozen = Object.fromEntries(a.tasks.map((t) => [t.id, t.check_sha256]));
    need(sc.tasks.length === a.tasks.length && sc.tasks.every((t) => frozen[t.id] === t.check_sha256), 'CHECK_BINDING');
    for (const { c, d } of draws) if (d.end_state) need(frozen[c.id] === d.end_state.check_sha256, 'CHECK_BINDING');
    // The schema after the score's own bindings, so a refusal names its cause; it reads the rest.
    need(validateReceipt(r).valid, 'RECEIPT_SCHEMA');
    for (const c of r.results.cases) {
      const ms = c.generation.draws.filter((d) => d.status === 'measured').map((d) => d.primary);
      need(ms.length === c.generation.n_measured && (!ms.length || Math.abs(ms.reduce((x, y) => x + y, 0) / ms.length - c.generation.mean) < 1e-6), 'SCORE_RECONSTRUCTION');
    }
    // AC-5: one world for the three arms, the plan's, rebuilt from the committed world files.
    const w = r.run.capture.world;
    need(w && w.manifest_sha256 === a.world.manifest_sha256 && JSON.stringify(w.skills) === JSON.stringify(a.world.skills) && JSON.stringify(p.world) === JSON.stringify(a.world), 'WORLD_BINDING');
    const built = require('../' + S786 + '/world.cjs').worldManifest(path.join(ROOT, S786, 'worlds', a.world.name));
    need(built.sha256 === a.world.manifest_sha256, 'WORLD_BINDING');
    let worldSpec = null;
    if (a.world.spec_sha256) { const sb = fs.readFileSync(path.join(ROOT, S786, 'worlds', a.world.name + '.json')); need(sha256(sb) === a.world.spec_sha256, 'WORLD_BINDING'); worldSpec = JSON.parse(sb); need(worldSpec.network === w.network, 'WORLD_BINDING'); }
    need(placeboProblems(r).length === 0 && r.placebo.seed === r.skill.content_hash && r.placebo.corpus_hash === p.placebo_corpus_hash, 'ARM_BINDING');
    // The retained answers: one per draw, each hashing to its draw.
    need(Array.isArray(answers) && answers.length === draws.length, 'RECEIPT_EVIDENCE');
    draws.forEach(({ c, d }, k) => { const e = answers[k]; need(e && e.id === c.id && e.mode === c.mode && e.draw_index === d.draw_index && e.generation_hash === d.generation_hash && typeof e.answer === 'string' && sha256(e.answer) === d.generation_hash && JSON.stringify((e.judge_outputs || []).map(sha256)) === JSON.stringify(d.judge_sample_hashes || []), 'RECEIPT_EVIDENCE'); });
    // The reading, in lib/verdict.js's and lib/plain.js's words.
    const pr = placeboReading(r), key = O.labelOf(pr.reading);
    const grilling = {};
    for (const { c, d } of draws) {
      const calls = ((d.delivery && d.delivery.tool_events) || []).filter((e) => e.type === 'tool_use' && e.name === 'Skill').map((e) => e.input && e.input.skill);
      grilling[c.mode] = grilling[c.mode] || [0, 0]; grilling[c.mode][1]++; if (calls.includes('grilling')) grilling[c.mode][0]++;
    }
    return {
      skill: p.skill, repository: p.repository, attempt_id: a.attempt_id, report_019_attempt_id: a.report_019_attempt_id, receipt_hash: r.receipt_hash, receipt: r,
      src: relOf(rf), answers_src: relOf(af), head: o.head, plan_sha256: o.plan_sha256, cost_usd: o.cost_usd, max_usd: a.max_usd,
      placebo: pr.reading, placebo_line: placeboLine(pr), verdict: receiptVerdict(r).verdict, sentence: plainOf(r).sentence, why: plainOf(r).why,
      label_key: key, label: O.LABELS[key], generations: draws.length,
      task_means: r.results.cases.map((c) => ({ id: c.id, mode: c.mode, mean: c.generation.mean })),
      grilling, world: { name: a.world.name, skills: w.skills, network: w.network, tool_network: r.run.capture.isolation && r.run.capture.isolation.tool_network, spec: worldSpec },
    };
  });
  const failures = m.outcomes.filter((o) => o.status === 'failure').map((o) => {
    const st = startOf(o.attempt_id), then = st && st.plan.attempts.find((a) => a.attempt_id === o.attempt_id);
    need(then, 'PLAN_BINDING');
    return { attempt_id: o.attempt_id, skill: o.skill, reason: o.reason, cost_usd: o.cost_usd, max_usd: then.max_usd, superseded_by: (attempts.find((a) => supersedesOf(a).includes(o.attempt_id)) || {}).attempt_id || null };
  });
  // The smoke runs' spend the re-freeze recorded, each manifest pinned by sha256 (spec 786 A-786-8).
  const freeze = read(path.join(ROOT, S786, 'freeze.json')), fa = Array.isArray(freeze.attempts) ? freeze.attempts : Object.values(freeze.attempts);
  const smokes = fa.filter((x) => x.ceiling).flatMap((x) => x.ceiling.sources).filter((s) => !/receipts\/report-019-tools-on\/manifest\.json$/.test(s.path));
  for (const s of smokes) need(/^[0-9a-f]{64}$/.test(s.sha256) && Number.isFinite(s.cost_usd), 'SPEND_BINDING');
  const campaignSpend = round6(m.outcomes.reduce((n, o) => n + o.cost_usd, 0)), smokeSpend = round6(smokes.reduce((n, s) => n + s.cost_usd, 0));
  return {
    rows, superseded: failures.filter((f) => superseded.has(f.attempt_id)), failures, starts: starts.map(({ plan: _p, ...s }) => s),
    manifest: { file: relOf(mfile), sha256: sha256(mbytes) }, plan_sha256: sha256(planBytes), note_sha256: plan.outcomes.sha256, note_path: plan.outcomes.path,
    effort: plan.effort, projection: { generation_usd: plan.projection.generation_p75_usd, judged_draw_usd: plan.projection.judge_draw_p75_usd }, cap_usd: plan.cap_usd,
    spend: { campaign_usd: campaignSpend, smoke_usd: smokeSpend, smokes: smokes.map((s) => ({ sha256: s.sha256, cost_usd: s.cost_usd })), total_usd: round6(campaignSpend + smokeSpend) },
    runner_version: (rows[0] && rows[0].receipt.run.runner_version) || null, stub,
  };
}

// What the method paragraph may name (spec 790 AC-5, TBD-6): only what a world of the six holds.
function methodOf(tools) {
  const skills = [], cli = [], copies = [], browsers = [], networks = new Set();
  for (const r of tools.rows) {
    for (const s of r.world.skills) if (!skills.includes(s)) skills.push(s);
    networks.add(r.world.network); networks.add(r.world.tool_network);
    const spec = r.world.spec; if (!spec) continue;
    for (const t of spec.tools || []) if (!cli.includes(t)) cli.push(t);
    for (const f of spec.fixtures || []) { need(Object.hasOwn(COPY_KINDS, f.kind), 'METHOD_BINDING'); if (!copies.includes(COPY_KINDS[f.kind])) copies.push(COPY_KINDS[f.kind]); }
    if (spec.inputs && spec.inputs.chrome && spec.inputs.chrome.version) browsers.push('Chrome ' + spec.inputs.chrome.version);
  }
  for (const n of networks) need(NETWORKS.has(n), 'METHOD_BINDING');
  return { skills, cli, copies, browsers, offline: true };
}

// ── the text twenty and Report 020, through their own readers, in a child with the plans' registry ──
function sealedReadings({ textRoot = path.join(ROOT, TEXT), boundaryRoot = path.join(ROOT, BOUNDARY), stub = false } = {}) {
  const r = spawnSync(process.execPath, [__filename, '--sealed-readings', JSON.stringify({ textRoot: path.resolve(textRoot), boundaryRoot: path.resolve(boundaryRoot), stub })],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DRIFTPROOF_REGISTRY: REGISTRY }, maxBuffer: 1 << 28 });
  if (r.status !== 0) fail((/REFUSED (\S+)/.exec(r.stderr || '') || [, 'SEALED_READINGS'])[1]);
  return JSON.parse(r.stdout);
}
function childReadings({ textRoot, boundaryRoot, stub }) {
  const RA = require('../' + S783 + '/placebo/run-campaign.cjs'), RB = require('../' + S783 + '/boundary/run-campaign.cjs');
  const pub = RA.publication({ campaignRoot: textRoot, stub });
  const ctx = RA.readPlan(ROOT, { frozen: textRoot }), head = RA.rootEntries(ctx, textRoot).at(-1).file, ledger = RA.readChain(ctx, [head], stub, 'publication');
  const srcOf = (id) => { const o = ledger.receipts.get(id); return o ? relOf(path.join(path.dirname(o.file), id + '.json')) : null; };
  const text = {
    plan_sha256: pub.plan_sha256, note_sha256: ctx.plan.outcomes.sha256, code_head: pub.code_head, judge_relationship: pub.judge_relationship, effort: pub.effort,
    runner_version: pub.runner_version, claude_code_version: pub.claude_code_version, price_estimate: pub.price_estimate, handoff_note: pub.handoff_note,
    rows: pub.rows.map((x, i) => ({ ...x, repository: ctx.plan.execution.attempts[i].protocol.repository, src: srcOf(x.attempt_id) })),
    spent_usd: ledger.spent, manifests: ledger.manifests.map((mm) => ({ file: relOf(mm.file), sha256: mm.sha256 })),
  };
  const v = RB.verdicts({ campaignRoot: boundaryRoot });
  const log = fs.readFileSync(path.join(boundaryRoot, 'campaign.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const bm = log.map((e) => { const f = path.join(boundaryRoot, e.manifest), b = fs.readFileSync(f), mm = JSON.parse(b); return { file: relOf(f), sha256: sha256(b), spent_usd: mm.spent_usd, head: e.head || null, outcomes: mm.outcomes }; });
  const boundary = { ...v, manifests: bm.map(({ outcomes: _o, ...x }) => x), receipts: bm.flatMap((mm) => mm.outcomes.filter((o) => o.status === 'receipt').map((o) => ({ attempt_id: o.attempt_id, src: relOf(path.join(boundaryRoot, o.receipt)), receipt_hash: o.receipt_hash, cost_usd: o.cost_usd }))) };
  return { text, boundary };
}

// ── the model the page is built from ──
const tallyOf = (readings) => {
  const t = { N: readings.length }; for (const [k, tok] of COUNTS) t[k] = readings.filter((r) => r === tok).length;
  t.labels = { keep: 0, delete: 0, cannot: 0 }; for (const r of readings) t.labels[O.labelOf(r)]++;
  return t;
};
// The note's shape rule, in its order, with "half of N" read for N twenty (spec 783 A-783-4).
function shapeOf(t) {
  if (t.A === t.N) return 'all';
  if (t.M * 2 >= t.N) return 'not_read';
  if (t.U * 2 >= t.N) return 'many_underpowered';
  if (t.A === 0) return 'none';
  return 'some';
}
function templates(note) {
  const fence = /```report-019-headlines\n([\s\S]*?)```/.exec(note); need(fence, 'OUTCOMES_BINDING');
  return Object.fromEntries(fence[1].trim().split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
}
const fill = (t, c) => t.replace(/\{([NABDIUM])\}/g, (_, k) => { need(Number.isInteger(c[k]), 'TALLY_BINDING'); return String(c[k]); });

function readReport({ textRoot = path.join(ROOT, TEXT), toolsRoot = path.join(ROOT, TOOLS), boundaryRoot = path.join(ROOT, BOUNDARY), stub = false, git } = {}) {
  const tools = readToolsOn({ root: toolsRoot, stub, ...(git ? { git } : {}) });
  const sealed = sealedReadings({ textRoot, boundaryRoot, stub });
  const text = sealed.text;
  need(text.rows.length === 20, 'ATTEMPT_COVERAGE');
  // Each text row's receipt, read again here and checked to be the one the reader read.
  for (const row of text.rows) {
    need(row.src, 'ATTEMPT_COVERAGE');
    const r = read(path.join(ROOT, row.src)), answers = read(path.join(ROOT, row.src.replace(/\.json$/, '-answers.json')));
    need(verifyReceiptHash(r) && r.receipt_hash === row.receipt_hash, 'RECEIPT_SEAL');
    need(placeboLine(placeboReading(r)) === row.placebo_line && placeboReading(r).reading === row.placebo, 'READING_BINDING');
    Object.assign(row, { receipt: r, sentence: plainOf(r).sentence, why: plainOf(r).why, counted: !SIX.includes(row.skill), redacted: redaction.count(answers), label_key: O.labelOf(row.placebo), label: O.LABELS[O.labelOf(row.placebo)] });
  }
  // AC-3: the six's tools-on receipts measured plan (a)'s attempts for the same skills, with the same pin.
  for (const t of tools.rows) {
    const x = text.rows.find((r) => r.skill === t.skill); need(x && x.attempt_id === t.report_019_attempt_id && x.receipt.skill.content_hash === t.receipt.skill.content_hash, 'SKILL_BYTES');
  }
  const fourteen = text.rows.filter((r) => r.counted), six = SIX.map((s) => tools.rows.find((t) => t.skill === s));
  need(fourteen.length === 14 && six.every(Boolean), 'ATTEMPT_COVERAGE');
  const tally = { fourteen: tallyOf(fourteen.map((r) => r.placebo)), six: tallyOf(six.map((r) => r.placebo)), total: tallyOf([...fourteen, ...six].map((r) => r.placebo)) };
  tally.total.shape = shapeOf(tally.total);
  const note = fs.readFileSync(path.join(textRoot, 'outcomes.md'), 'utf8'), T = templates(note);
  need(sha256(Buffer.from(note)) === text.note_sha256, 'OUTCOMES_BINDING');
  const headline = {
    fourteen: 'Of the 14 skills graded on the reply, ' + tally.fourteen.A + ' beat the fake on Fable 5.2.',
    six: 'Of the 6 skills graded on the end state with tools on, ' + tally.six.A + ' beat the fake on Fable 5.2.',
    total: fill(T[tally.total.shape], tally.total), counts: fill(T.counts, tally.total),
  };
  need(tally.fourteen.N === 14 && tally.six.N === 6 && tally.total.N === 20, 'TALLY_BINDING');
  // AC-10: the caveats, each a count read from the receipts.
  const means = six.flatMap((r) => r.task_means.map((t) => t.mean));
  const top = { at_or_above: means.filter((x) => x >= TOP).length, of: means.length, threshold: TOP };
  top.shown = top.at_or_above * 2 > top.of;
  const grilling = Object.fromEntries(six.filter((r) => r.world.skills.includes('grilling')).map((r) => [r.skill, r.grilling]));
  const grillingShown = Object.values(grilling).length > 0 && Object.values(grilling).every((arms) => Object.values(arms).every(([n]) => n > 0));
  const cost = [...six.map((r) => ({ skill: r.skill, attempt_id: r.attempt_id, cost_usd: r.cost_usd, generations: r.generations, max_usd: r.max_usd })),
    ...tools.superseded.map((f) => ({ skill: f.skill, attempt_id: f.attempt_id, cost_usd: f.cost_usd, max_usd: f.max_usd, stopped: f.reason }))];
  // AC-11: the spend, each a sum of named records.
  const chains = read(path.join(ROOT, S783, 'chains.json')).chains;
  const readChain = chains.find((c) => c.report === '019' && c.read_chain);
  need(readChain && round6(readChain.manifests.reduce((n, x) => n + x.campaign_spend_usd, 0)) === round6(text.spent_usd), 'SPEND_BINDING');
  need(JSON.stringify(readChain.manifests.map((x) => x.sha256)) === JSON.stringify(text.manifests.map((x) => x.sha256)), 'SPEND_BINDING');
  const outside = chains.filter((c) => c.report === '019' && !c.read_chain);
  const outsideUsd = round6(outside.flatMap((c) => c.manifests).reduce((n, x) => n + x.campaign_spend_usd, 0));
  const boundaryUsd = round6(sealed.boundary.manifests.reduce((n, x) => n + x.spent_usd, 0));
  const bChain = chains.find((c) => c.report === '020' && c.read_chain);
  need(bChain && round6(bChain.manifests.reduce((n, x) => n + x.campaign_spend_usd, 0)) === boundaryUsd, 'SPEND_BINDING');
  const spend = { text_read_usd: round6(text.spent_usd), text_outside_usd: outsideUsd, text_usd: round6(text.spent_usd + outsideUsd), tools_campaign_usd: tools.spend.campaign_usd, tools_smoke_usd: tools.spend.smoke_usd, tools_usd: tools.spend.total_usd, boundary_usd: boundaryUsd };
  const bPlan = read(path.join(boundaryRoot, 'plan.json'));
  need(JSON.stringify(sealed.boundary.effort) === JSON.stringify(bPlan.effort), 'PLAN_BINDING');
  const effort = { target: text.effort && text.effort.catalog_default, set: text.effort && text.effort.set };
  need(effort.target === tools.effort.catalog_default && effort.set === false && tools.effort.set === false, 'PLAN_BINDING');
  return {
    text, tools, boundary: sealed.boundary, fourteen, six, context: SIX.map((s) => text.rows.find((r) => r.skill === s)),
    tally, headline, note, caveats: { top, grilling: { ...grilling, shown: grillingShown }, cost, projection: tools.projection },
    spend, effort, method: methodOf(tools), stub,
  };
}

// scripts/site-data.mjs reads the latest report's counts through this (spec 687 A-687-4).
function publication({ stub = false } = {}) { const m = readReport({ stub }); return { tally: m.tally.total }; }

module.exports = { ROOT, TEXT, TOOLS, BOUNDARY, SIX, COUNTS, TOP, COPY_KINDS, gitReader, readToolsOn, methodOf, sealedReadings, readReport, shapeOf, templates, fill, publication };

if (require.main === module && process.argv[2] === '--sealed-readings') {
  try { process.stdout.write(JSON.stringify(childReadings(JSON.parse(process.argv[3])))); }
  catch (e) { process.stderr.write('REFUSED ' + (e.code || 'SEALED_READINGS') + ' ' + (e.code ? '' : String(e.stack || e)) + '\n'); process.exitCode = 1; }
}
