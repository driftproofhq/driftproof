// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 790: Report 019's page, twenty skills on Fable 5.2 (fourteen on the reply, six with tools on),
// with Report 020 as its own section. Written before the builder. Every oracle here reads the
// committed receipts, manifests and records itself; nothing is typed but what the spec fixes.
//
// The builder is scripts/prepare-report-019.js. It is required lazily, so each test reads red on its
// own until it exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
// The plans' runs load the plan's registry copy; the text reader refuses any other (spec 783).
process.env.DRIFTPROOF_REGISTRY = path.join(ROOT, 'specs/783-fable-5-2-scope/registry.json');

const TEXT = path.join(ROOT, 'receipts/report-019');
const TOOLS = path.join(ROOT, 'receipts/report-019-tools-on');
const BOUNDARY = path.join(ROOT, 'receipts/report-020');
const S786 = path.join(ROOT, 'specs/786-tools-on-routers');
const S783 = path.join(ROOT, 'specs/783-fable-5-2-scope');
const PAGE = path.join(ROOT, 'docs/reports/019/index.html');
const SIX = ['find-skills', 'agent-browser', 'hyperframes', 'hyperframes-registry', 'grill-me', 'grill-with-docs'];
const SUPERSEDED = '90d1d852330f1f7b0d57faf8751b642eab1587416a34f374d05578a96b1daf33';

const { sha256 } = require(path.join(ROOT, 'lib/canonical'));
const { sealReceipt } = require(path.join(ROOT, 'lib/receipt'));
const { placeboReading } = require(path.join(ROOT, 'lib/verdict'));
const O = require(path.join(ROOT, 'scripts/offer.js'));
const hygiene = require(path.join(ROOT, 'lib/hygiene.js'));
const RA = () => require(path.join(S783, 'placebo/run-campaign.cjs'));
const RB = () => require(path.join(S783, 'boundary/run-campaign.cjs'));
const B = () => require(path.join(ROOT, 'scripts/prepare-report-019.js'));

const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
const code = (c) => (e) => e && e.code === c;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

// ── oracles ──
const toolsManifest = () => json(path.join(TOOLS, 'manifest.json'));
const toolsReceipts = () => toolsManifest().outcomes.filter((o) => o.status === 'receipt').map((o) => ({ o, r: json(path.join(TOOLS, o.attempt_id + '.json')) }));
function textReceipts() {
  const out = new Map();
  for (const d of fs.readdirSync(TEXT).filter((n) => /^campaign-\d+$/.test(n)).sort()) {
    for (const o of json(path.join(TEXT, d, 'manifest.json')).outcomes) if (o.status === 'receipt') out.set(o.attempt_id, json(path.join(TEXT, d, o.attempt_id + '.json')));
  }
  return [...out.values()];
}
const COUNT_KEYS = [['A', 'ABOVE_PLACEBO'], ['B', 'BELOW_PLACEBO'], ['D', 'NO_DIFFERENCE'], ['I', 'INCONCLUSIVE'], ['U', 'UNDERPOWERED'], ['M', 'NOT_MEASURED']];
function tallyOf(readings) {
  const t = { N: readings.length }; for (const [k, tok] of COUNT_KEYS) t[k] = readings.filter((r) => r === tok).length;
  t.labels = { keep: 0, delete: 0, cannot: 0 }; for (const r of readings) t.labels[O.labelOf(r)]++;
  return t;
}
function oracleTally() {
  const fourteen = textReceipts().filter((r) => !SIX.includes(r.skill.name)).map((r) => placeboReading(r).reading);
  const six = toolsReceipts().map(({ r }) => placeboReading(r).reading);
  assert.equal(fourteen.length, 14); assert.equal(six.length, 6);
  return { fourteen: tallyOf(fourteen), six: tallyOf(six), total: tallyOf([...fourteen, ...six]) };
}
function noteTemplates() {
  const note = fs.readFileSync(path.join(TEXT, 'outcomes.md'), 'utf8');
  const fence = /```report-019-headlines\n([\s\S]*?)```/.exec(note)[1];
  return Object.fromEntries(fence.trim().split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
}
const fill = (t, c) => t.replace(/\{([NABDIUM])\}/g, (_, k) => String(c[k]));
function grillingCounts(r) {
  const out = {};
  for (const c of r.results.cases) for (const d of c.generation.draws) {
    const calls = (d.delivery.tool_events || []).filter((e) => e.type === 'tool_use' && e.name === 'Skill').map((e) => e.input && e.input.skill);
    out[c.mode] = out[c.mode] || [0, 0]; out[c.mode][1]++; if (calls.includes('grilling')) out[c.mode][0]++;
  }
  return out;
}

// A copy of the tools-on root the test owns, for plants.
function toolsCopy() {
  const dir = fs.mkdtempSync('/var/tmp/report019-tools-');
  for (const f of fs.readdirSync(TOOLS)) fs.copyFileSync(path.join(TOOLS, f), path.join(dir, f));
  return dir;
}
// Edit one receipt in a copy, reseal it and, unless told not to, move the manifest's hash with it.
function replant(dir, skill, mutate, { manifest = true } = {}) {
  const m = json(path.join(dir, 'manifest.json')); const o = m.outcomes.find((x) => x.skill === skill && x.status === 'receipt');
  const f = path.join(dir, o.attempt_id + '.json'); const r = json(f); mutate(r); sealReceipt(r); write(f, r);
  if (manifest) { o.receipt_hash = r.receipt_hash; write(path.join(dir, 'manifest.json'), m); }
  return { o, r };
}

// ── AC-20: the hygiene scan over the three roots (red until TBD-1 is ruled and built) ──
test('AC-20: no file under the three campaign roots carries a hygiene hit', () => {
  const files = [TEXT, TOOLS, BOUNDARY].flatMap(walk);
  const hits = hygiene.scanFiles(files.map((f) => path.relative(ROOT, f)), (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'), () => null);
  assert.deepEqual(hits.map((h) => h.file + ' ' + h.kind), []);
});

// ── A-790-1: the home path written ~/, restored by the reader to the sealed bytes ──
test('AC-20, A-790-1: the redacted answers restore to their sealed bytes, and a record that does not restore refuses', () => {
  const X = require(path.join(ROOT, 'scripts/answer-redaction.js'));
  const files = walk(TEXT).filter((f) => f.endsWith('-answers.json') && json(f).redactions);
  assert.equal(files.length, 1, 'one answers file carries a record');
  const a = json(files[0]); assert.equal(X.count(a), 5);
  const back = X.restore(a);
  for (const e of a.redactions.answers) { assert.equal(sha256(back.answers[e.generation_hash]), e.generation_hash); assert.notEqual(a.answers[e.generation_hash], back.answers[e.generation_hash]); }
  for (const [h, t] of Object.entries(a.answers)) if (!a.redactions.answers.some((e) => e.generation_hash === h)) assert.equal(back.answers[h], t, 'an answer outside the record is untouched');
  // Through plan (a)'s reader, on a copy of the root the test owns.
  const copy = fs.mkdtempSync('/var/tmp/report019-text-'); fs.cpSync(TEXT, copy, { recursive: true });
  const target = path.join(copy, path.relative(TEXT, files[0])); const bytes = fs.readFileSync(target);
  const read = () => RA().publication({ campaignRoot: copy, stub: false });
  assert.equal(read().rows.length, 20, 'control: the redacted root reads');
  const plant = (mutate, want, why) => { const p = JSON.parse(bytes); mutate(p); write(target, p); try { assert.throws(read, code(want), why); } finally { fs.writeFileSync(target, bytes); } };
  plant((p) => { p.redactions.answers[0].offsets[0] += 1; }, 'REDACTION_BINDING', 'an offset moved');
  plant((p) => { p.redactions.answers.push(p.redactions.answers[0]); }, 'REDACTION_BINDING', 'an answer listed twice');
  plant((p) => { delete p.redactions; }, 'RECEIPT_EVIDENCE', 'the record removed, the text still redacted');
});

// ── A-783-5: plan (b) reads as historical from this tree ──
test('A-783-5: plan (b)\'s reader reads Report 020 from this tree, its runner pins read at the head its log records', () => {
  const v = RB().verdicts({ campaignRoot: BOUNDARY });
  assert.equal(v.rows.length, 3);
  assert.ok(v.rows.every((r) => r.verdict !== 'not-measured'), JSON.stringify(v.rows.map((r) => [r.skill, r.verdict])));
});

// ── AC-1 to AC-6: the tools-on reader ──
test('AC-1, AC-2, AC-3, AC-4: the tools-on reader reads the six, one sealed receipt each, by lib/verdict.js', () => {
  const t = B().readToolsOn({});
  assert.deepEqual(t.rows.map((r) => r.skill).sort(), [...SIX].sort());
  for (const { o, r } of toolsReceipts()) {
    const row = t.rows.find((x) => x.skill === o.skill);
    assert.equal(row.attempt_id, o.attempt_id); assert.equal(row.receipt_hash, r.receipt_hash);
    assert.equal(row.placebo, placeboReading(r).reading, o.skill);
    assert.equal(row.label, O.LABELS[O.labelOf(row.placebo)]);
  }
  assert.ok(!t.rows.some((r) => r.attempt_id === SUPERSEDED), 'the superseded attempt is never a reading');
  assert.ok(t.superseded.some((f) => f.attempt_id === SUPERSEDED && f.reason === 'ATTEMPT_MAX_USD'), 'it stays the failure it was');
});

test('AC-1: a resealed score, an edited answer and a foreign attempt binding each refuse', () => {
  const read = (dir) => B().readToolsOn({ root: dir });
  let d = toolsCopy(); replant(d, 'grill-me', (r) => { r.results.cases[0].generation.draws[0].samples = [0]; }, { manifest: false });
  assert.throws(() => read(d), code('RECEIPT_SEAL'), 'a resealed receipt the manifest does not name');
  d = toolsCopy(); { const o = toolsManifest().outcomes.find((x) => x.skill === 'find-skills'); const f = path.join(d, o.attempt_id + '-answers.json'); const a = json(f); a[0].answer += ' '; write(f, a); }
  assert.throws(() => read(d), code('RECEIPT_EVIDENCE'), 'an answer that does not hash to its draw');
  d = toolsCopy(); replant(d, 'hyperframes', (r) => { for (const c of r.results.cases) c.generation.issue786 = { ...c.generation.issue786, attempt_id: 'f'.repeat(64) }; });
  assert.throws(() => read(d), code('ATTEMPT_BINDING'));
  assert.equal(read(toolsCopy()).rows.length, 6, 'control: an unplanted copy reads');
});

test('AC-2: a missing receipt, a second receipt, the superseded id and a stray file each refuse', () => {
  const read = (dir) => B().readToolsOn({ root: dir });
  const m = toolsManifest(); const gm = m.outcomes.find((o) => o.skill === 'grill-me');
  let d = toolsCopy(); fs.rmSync(path.join(d, gm.attempt_id + '.json'));
  assert.throws(() => read(d), code('ATTEMPT_COVERAGE'));
  d = toolsCopy(); { const mm = json(path.join(d, 'manifest.json')); mm.outcomes.push({ ...gm }); write(path.join(d, 'manifest.json'), mm); }
  assert.throws(() => read(d), code('PRIOR_DUPLICATE_RECEIPT'));
  d = toolsCopy(); fs.copyFileSync(path.join(d, gm.attempt_id + '.json'), path.join(d, SUPERSEDED + '.json'));
  assert.throws(() => read(d), (e) => ['ATTEMPT_SUPERSEDED', 'FOREIGN_FILE'].includes(e.code));
  d = toolsCopy(); fs.writeFileSync(path.join(d, 'notes.txt'), 'x');
  assert.throws(() => read(d), code('FOREIGN_FILE'));
});

test('AC-3, AC-4, AC-5: other skill bytes, a judge-scored draw, a moved check and a moved world each refuse', () => {
  const read = (dir) => B().readToolsOn({ root: dir });
  let d = toolsCopy(); replant(d, 'agent-browser', (r) => { r.skill.content_hash = '0'.repeat(64); });
  assert.throws(() => read(d), code('SKILL_BYTES'));
  d = toolsCopy(); replant(d, 'grill-with-docs', (r) => { const x = r.results.cases[0].generation.draws[0]; x.samples = [x.secondary.mean === x.primary ? 1 - x.primary : x.secondary.mean]; });
  assert.throws(() => read(d), code('SCORE_BASIS'), 'a sample that is not the check\'s score');
  d = toolsCopy(); replant(d, 'hyperframes', (r) => { r.run.scoring.tasks[0].check_sha256 = 'a'.repeat(64); });
  assert.throws(() => read(d), code('CHECK_BINDING'));
  d = toolsCopy(); replant(d, 'find-skills', (r) => { r.run.capture.world.manifest_sha256 = 'b'.repeat(64); });
  assert.throws(() => read(d), code('WORLD_BINDING'));
});

test('AC-6: every start\'s plan, read at its head, hashes to its record and pins the same note and checks', () => {
  const real = RA().gitReader(ROOT);
  const t = B().readToolsOn({ git: real });
  assert.equal(t.starts.length, toolsManifest().starts.length);
  const head = toolsManifest().starts[0].head;
  const swap = (file, edit) => ({ isAncestor: (h) => real.isAncestor(h), show: (h, f) => { const b = real.show(h, f); return h === head && f === file ? edit(b) : b; } });
  assert.throws(() => B().readToolsOn({ git: swap('specs/786-tools-on-routers/plan.json', (b) => Buffer.concat([b, Buffer.from(' ')])) }), code('PLAN_BINDING'));
  assert.throws(() => B().readToolsOn({ git: swap('specs/786-tools-on-routers/outcomes.md', (b) => Buffer.concat([b, Buffer.from('\n')])) }), code('OUTCOMES_BINDING'));
});

// ── AC-7 to AC-12: the model the page is built from ──
test('AC-7: the headline is the tally of the twenty, fourteen then six then the total, in the frozen templates', () => {
  const want = oracleTally(); const m = B().readReport({});
  for (const k of ['fourteen', 'six', 'total']) for (const c of ['N', 'A', 'B', 'D', 'I', 'U', 'M']) assert.equal(m.tally[k][c], want[k][c], k + ' ' + c);
  assert.deepEqual(m.tally.fourteen.labels, want.fourteen.labels); assert.deepEqual(m.tally.six.labels, want.six.labels);
  const t = noteTemplates(); const shape = B().shapeOf(want.total);
  assert.equal(m.headline.fourteen, 'Of the 14 skills graded on the reply, ' + want.fourteen.A + ' beat the fake on Fable 5.2.');
  assert.equal(m.headline.six, 'Of the 6 skills graded on the end state with tools on, ' + want.six.A + ' beat the fake on Fable 5.2.');
  assert.equal(m.headline.total, fill(t[shape], want.total)); assert.equal(m.headline.counts, fill(t.counts, want.total));
  assert.ok(!Object.values(m.headline).some((l) => l.includes('left out of these counts')), 'the routers line is not printed');
  // The note's shape rule, with half of N read as 10 for N twenty (A-783-5).
  const z = { N: 20, A: 0, B: 0, D: 0, I: 0, U: 0, M: 0 };
  assert.equal(B().shapeOf({ ...z, A: 20 }), 'all'); assert.equal(B().shapeOf({ ...z, M: 10, A: 5 }), 'not_read');
  assert.equal(B().shapeOf({ ...z, M: 9, A: 1 }), 'some'); assert.equal(B().shapeOf({ ...z, U: 10, A: 3 }), 'many_underpowered');
  assert.equal(B().shapeOf({ ...z, U: 9, A: 1 }), 'some'); assert.equal(B().shapeOf({ ...z, D: 20 }), 'none');
});

test('AC-10: the caveats are the receipts\' counts, shown only while they hold', () => {
  const m = B().readReport({}); let at = 0, of = 0;
  for (const { r } of toolsReceipts()) for (const c of r.results.cases) { of++; if (c.generation.mean >= 0.9) at++; }
  assert.deepEqual([m.caveats.top.at_or_above, m.caveats.top.of, m.caveats.top.threshold], [at, of, 0.9]);
  assert.equal(m.caveats.top.shown, at * 2 > of);
  for (const { o, r } of toolsReceipts().filter(({ o }) => o.skill.startsWith('grill-'))) assert.deepEqual(m.caveats.grilling[o.skill], grillingCounts(r), o.skill);
  assert.equal(m.caveats.grilling.shown, Object.entries(m.caveats.grilling).filter(([k]) => k !== 'shown').every(([, arms]) => Object.values(arms).every(([n]) => n > 0)));
  for (const { o, r } of toolsReceipts()) {
    const c = m.caveats.cost.find((x) => x.skill === o.skill);
    assert.equal(c.cost_usd, o.cost_usd); assert.equal(c.generations, r.results.cases.reduce((n, k) => n + k.generation.draws.length, 0));
  }
  assert.ok(!m.caveats.cost.some((c) => c.attempt_id === SUPERSEDED && 'generations' in c), 'no per-generation figure for the stopped attempt (TBD-3)');
});

test('AC-11: the spend is the sum of the manifests and records, each named', () => {
  const m = B().readReport({}); const chains = json(path.join(S783, 'chains.json')).chains;
  const sum = (report) => round6(chains.filter((c) => c.report === report).flatMap((c) => c.manifests).reduce((n, x) => n + x.campaign_spend_usd, 0));
  const freeze = json(path.join(S786, 'freeze.json')); const at = Array.isArray(freeze.attempts) ? freeze.attempts : Object.values(freeze.attempts);
  const smokes = at.filter((a) => a.ceiling).flatMap((a) => a.ceiling.sources).filter((s) => /smoke/.test(s.path));
  const tools = round6(toolsManifest().outcomes.reduce((n, o) => n + o.cost_usd, 0) + smokes.reduce((n, s) => n + s.cost_usd, 0));
  assert.equal(m.spend.text_usd, sum('019')); assert.equal(m.spend.boundary_usd, sum('020')); assert.equal(m.spend.tools_usd, tools);
});

test('AC-12, AC-14, AC-15: Report 020\'s rows are plan (b)\'s reader\'s, and the upstream comment says only them', () => {
  const m = B().readReport({}); const v = RB().verdicts({ campaignRoot: BOUNDARY });
  assert.deepEqual(m.boundary.rows.map((r) => [r.skill, r.label]), v.rows.map((r) => [r.skill, r.label]));
  const lines = B().boundaryComment(m).split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 5, 'four plain lines and the link'); assert.match(lines[4], /https:\/\/driftproofhq\.com\/reports\/019\//);
  for (const r of v.rows) assert.equal(lines.filter((l) => l.includes(r.skill) && l.includes(r.label)).length, 1, r.skill);
  assert.doesNotMatch(lines.join(' '), /\b(confiden\w*|significan\w*|likely|probabl\w*|prove[sn]?|proof|better|worse)\b/i);
  assert.equal(m.effort.target, 'medium'); assert.deepEqual(m.boundary.effort, json(path.join(BOUNDARY, 'plan.json')).effort);
});

// ── AC-8, AC-9, AC-13, AC-16, AC-19: the published page ──
test('AC-8, AC-9, AC-13, AC-16: the published page says the ruled change once, marks the context rows, and stands alone', () => {
  const html = fs.readFileSync(PAGE, 'utf8'); const visible = textOf(html.replace(/<head>[\s\S]*?<\/head>/, ''));
  const first = visible.indexOf('text-only, not counted');
  for (const s of [B().METHOD_SENTENCE, B().RULED_CHANGE]) { assert.equal(visible.split(s).length - 1, 1, s); assert.ok(visible.indexOf(s) < first, 'before the first row: ' + s); }
  assert.equal(visible.split('text-only, not counted').length - 1, 6, 'one mark per context row');
  assert.doesNotMatch(visible, /\b(confiden\w*|significan\w*|likely|probabl\w*|prove[sn]?|proof|ratio|ranking|ranked|winners?|best|worst|percent)\b|%/i);
  for (const m of html.matchAll(/<data value="(\d[\d.]*)"([^>]*)>/g)) assert.match(m[2], /data-src="[^"]+"/, 'a number element names its source');
  // Outside the frozen notes' own sections, which name the earlier reports as designs, never as readings.
  const outside = textOf(html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<div class="note-section">[\s\S]*?<\/div>/g, ''));
  assert.doesNotMatch(outside, /Report 01[78]/); for (const m of outside.matchAll(/Report 015(?! Amendment 1)/g)) assert.fail('Report 015 outside the citation: ' + outside.slice(m.index, m.index + 60));
  assert.doesNotMatch(visible, /Report 011 (scored|read|measured)/, 'no Report 011 figure in Report 020\'s section');
});

test('AC-17: a stub root is never published, and test mode never writes under docs/', () => {
  const d = toolsCopy(); const m = json(path.join(d, 'manifest.json')); m.stub = true; write(path.join(d, 'manifest.json'), m);
  assert.throws(() => B().readReport({ toolsRoot: d }), code('UNVERIFIED'));
  assert.throws(() => B().main(['--stub', '--out', path.join(ROOT, 'docs')]), code('OUTPUT_DIRECTORY'));
});

test('AC-7, AC-9, AC-13, AC-14, AC-19: a committed page edited while the receipts stay refuses --check', () => {
  const m = B().readReport({}); const out = fs.mkdtempSync('/var/tmp/report019-docs-');
  fs.mkdirSync(path.join(out, 'reports/019'), { recursive: true }); fs.mkdirSync(path.join(out, 'data'));
  fs.copyFileSync(path.join(ROOT, 'docs/data/report-summaries.json'), path.join(out, 'data/report-summaries.json'));
  const page = path.join(out, 'reports/019/index.html'), live = fs.readFileSync(PAGE, 'utf8');
  fs.writeFileSync(page, live); B().checkReport({ out, model: m });
  const plants = [
    ['a headline count typed one up', (h) => h.replace(/( graded on the reply, <data value=")(\d+)("[^>]*>)(\d+)/, (_, a, n, b) => a + (Number(n) + 1) + b + (Number(n) + 1))],
    ['the context mark removed from one row', (h) => h.replace(' <span class="context-mark">(text-only, not counted)</span>', '')],
    ['a Report 018 counts line inserted', (h) => h.replace('<p class="headline-method">', '<p class="headline-context">Report 018: Of the 16: ABOVE_PLACEBO 12.</p><p class="headline-method">')],
    ['a Report 020 label changed', (h) => h.replace('<td class="boundary-verdict">no separation detected</td>', '<td class="boundary-verdict">separation detected, upward</td>')],
    ['the ruled change removed', (h) => h.replace(/<p class="headline-ruled-change">[^<]*<\/p>/, '')],
  ];
  for (const [why, edit] of plants) {
    const planted = edit(live); assert.notEqual(planted, live, 'the plant applies: ' + why);
    fs.writeFileSync(page, planted);
    assert.throws(() => B().checkReport({ out, model: m }), code('REPORT_DRIFT'), why);
  }
});

test('AC-19: --check rebuilds the committed page and its summary row byte for byte', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/prepare-report-019.js'), '--check'], { cwd: ROOT, encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stderr);
});
