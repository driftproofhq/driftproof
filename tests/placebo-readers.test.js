// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 610. Provider replies come only from spec 440's fixture table.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const Module = require('node:module');
const F = require('../specs/440-placebo-arm/fixtures');
process.env.DRIFTPROOF_STUB = '1';
const V = require('../lib/verdict');
const P = require('../lib/plain');
const { renderView } = require('../lib/view');
const { toSummaryJson } = require('../lib/export');
const { buildDriftReport } = require('../lib/diff');
const { sealReceipt, verifyReceiptHash, listReceipts } = require('../lib/receipt');
const { decideSet } = require('../lib/decision');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'a5d9fdb03b006dae270aef6391296d8f6c504657';
const dirs = [];
const tmp = () => { const d = fs.mkdtempSync('/var/tmp/placebo-readers-'); dirs.push(d); return d; };
test.after(() => { F.cleanup(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n3 = n => typeof n === 'number' ? n.toFixed(3) : 'no score';
const aggregate = r => 'with ' + n3(r.placebo.comparison.with_skill_score) + ' · placebo ' + n3(r.placebo.comparison.placebo_score);
const sentence = r => 'Against a same-length placebo (' + r.placebo.bytes + ' bytes): ' + V.placeboLine(V.placeboReading(r)) + '.';
const options = { now: new Date('2026-11-01T00:00:00Z'), label: 'fixture', stale: { noHarnessCheck: true } };
function directory(r) { const d = tmp(); fs.writeFileSync(path.join(d, 'r.json'), JSON.stringify(r)); return d; }
function cli(args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_/.test(k)));
  return cp.spawnSync(process.execPath, [path.join(ROOT, 'bin/driftproof'), ...args], { cwd: ROOT, env: { ...env, DRIFTPROOF_STUB: '1', SOURCE_DATE_EPOCH: '1793491200' }, encoding: 'utf8', timeout: 1800000 });
}
// Inject dependencies, not source-text edits. This also reads the pinned pre-change modules.
function load(rel, dependencies = {}, base = null) {
  const filename = path.join(ROOT, rel);
  const source = base ? cp.execFileSync('git', ['show', base + ':' + rel], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }) : fs.readFileSync(filename, 'utf8');
  const m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const real = m.require.bind(m);
  m.require = id => Object.hasOwn(dependencies, id) ? dependencies[id] : real(id);
  m._compile(source, filename);
  return m.exports;
}
let saved;
async function receipt() {
  if (!saved) saved = (await F.run(F.plans(require('../config').EFFECT_FLOOR).above)).receipt;
  return structuredClone(saved);
}
function absent(r) { const x = structuredClone(r); delete x.placebo; return sealReceipt(x); }
function expectedPlain(r) {
  const c = r.placebo.comparison;
  return { line: V.placeboLine(V.placeboReading(r)), with: c.with_skill_score, placebo: c.placebo_score, delta: c.delta };
}
function assertPresent(r, plain) { assert.deepEqual(plain.placebo, expectedPlain(r)); }

test('AC-1: every fixture reading is passed through plain, including NOT_MEASURED and placebo_unverified', async () => {
  const all = [];
  for (const name of ['above', 'below', 'flat', 'underpowered', 'inconclusive', 'placeboLost']) all.push((await F.run(F.plans(require('../config').EFFECT_FLOOR)[name])).receipt);
  const stub = await receipt(); stub.verification_level = 'UNVERIFIED'; stub.run.surface = 'stub'; stub.run.answered_by.kind = 'stub'; all.push(sealReceipt(stub));
  const bad = await receipt(); bad.placebo.sha256 = '0'.repeat(64); all.push(sealReceipt(bad));
  assert.ok(V.placeboReading(all.at(-1)).notMeasured.includes('placebo_unverified'));
  assert.equal(V.placeboReading(all.at(-2)).reading, 'NOT_MEASURED');
  for (const r of all) {
    assert.equal(require('../lib/receipt').validateReceipt(r).valid, true, 'fixture satisfies the receipt schema');
    const before = JSON.stringify(r);
    assertPresent(r, P.plainOf(r));
    const dir = directory(r);
    const d = decideSet(dir, r.run.model_id);
    assertPresent(r, P.plainOfRow(d.rows[0], r));
    const html = renderView(dir, options).html;
    assert.ok(html.includes(escapeHtml(V.placeboLine(V.placeboReading(r)))));
    assert.ok(P.commentMarkdown(d, dir, { key: 'fixture' }).includes(sentence(r)));
    assert.ok(P.summaryLead(d, dir).includes(sentence(r)));
    assert.equal(toSummaryJson(r).placebo.reading, V.placeboReading(r).reading);
    assert.ok(buildDriftReport(r, r).markdown.includes(sentence(r)));
    assert.equal(JSON.stringify(r), before);
  }
});

test('AC-1 plant: dropping the block reads RED against the presence oracle', async () => {
  const r = await receipt();
  assertPresent(r, P.plainOf(r));
  assert.throws(() => assertPresent(r, P.plainOf(absent(r))), assert.AssertionError);
});

test('AC-2: sheet, grid, comment and summary show the reading and separate aggregate', async () => {
  const r = await receipt(), dir = directory(r), d = decideSet(dir, r.run.model_id);
  const html = renderView(dir, options).html;
  assert.match(html, /Same-length placebo/);
  assert.match(html, /data-field="placebo"/);
  assert.ok(html.includes(escapeHtml(V.placeboLine(V.placeboReading(r)))));
  assert.ok(html.includes('without · ' + n3(r.placebo.comparison.placebo_score) + ' placebo</span>'));
  for (const text of [html, P.commentMarkdown(d, dir, { key: 'fixture' }), P.summaryLead(d, dir)]) {
    assert.ok(text.includes(aggregate(r)), 'recorded aggregate');
    assert.ok(text.includes('apart from the case rule'));
  }
  assert.ok(P.commentMarkdown(d, dir, { key: 'fixture' }).includes(sentence(r)));
  const lead = P.summaryLead(d, dir);
  assert.ok(lead.split('\n')[1].includes(sentence(r)));
  assert.match(lead.split('\n')[0], /This run (?:does not fail|fails) the job\.$/);
  // A row refusal and a receipt warning may not silently drop an existing block.
  assertPresent(r, P.plainOfRow({ state: 'refused', reason: 'fixture' }, r));
});

test('AC-2: view reads verdict words through plain; retyped-word dependency plant reads RED', async () => {
  const r = await receipt(), dir = directory(r);
  const sentinel = 'fixture-only reading <&>'; // proves delegation and HTML escaping
  const words = load('lib/plain.js', { './verdict': { ...V, placeboLine: () => sentinel } });
  assert.equal(words.plainOf(r).placebo.line, sentinel);
  const check = view => assert.ok(view.renderView(dir, options).html.includes(escapeHtml(sentinel)));
  check(load('lib/view.js', { './plain': words }));
  const retyped = { ...words, plainOf: x => ({ ...words.plainOf(x), placebo: { ...words.plainOf(x).placebo, line: V.placeboLine(V.placeboReading(x)) } }) };
  assert.throws(() => check(load('lib/view.js', { './plain': retyped })), assert.AssertionError);
});

test('AC-2: diff names each side independently and does not move its decision', async () => {
  const a = await receipt(), b = (await F.run(F.plans(require('../config').EFFECT_FLOOR).below)).receipt;
  for (const mode of ['release', 'revision']) {
    for (const [left, right] of [[a, b], [absent(a), b], [a, absent(b)]]) {
      const result = buildDriftReport(left, right, { mode, labelA: 'Left', labelB: 'Right' });
      for (const [label, r] of [['Left', left], ['Right', right]]) {
        const lines = result.markdown.split('\n').filter(l => l.includes('Against a same-length placebo') && l.includes(label));
        assert.equal(lines.length, r.placebo ? 1 : 0);
        if (r.placebo) { assert.ok(lines[0].includes(sentence(r))); assert.ok(lines[0].includes(aggregate(r))); }
      }
      const old = load('lib/diff.js', {}, BASE).buildDriftReport(left, right, { mode, labelA: 'Left', labelB: 'Right' });
      const { markdown, ...rest } = result; const { markdown: oldMarkdown, ...oldRest } = old;
      assert.deepEqual(rest, oldRest);
      assert.equal(markdown.split('## Headline')[1], oldMarkdown.split('## Headline')[1]);
    }
  }
});

test('AC-3: export v2 preserves v1 leaves and exports exact placebo fields through CLI', async () => {
  const r = await receipt(), c = r.placebo.comparison;
  const wanted = { bytes: r.placebo.bytes, reading: V.placeboReading(r).reading, delta: c.delta, delta_uncertainty: c.delta_uncertainty, with_skill_score: c.with_skill_score, placebo_score: c.placebo_score };
  const s = toSummaryJson(r);
  assert.equal(s.format_version, '2'); assert.deepEqual(s.placebo, wanted);
  const { placebo, format_version, ...leaves } = s;
  const { format_version: oldVersion, ...oldLeaves } = load('lib/export.js', {}, BASE).toSummaryJson(r);
  assert.deepEqual(leaves, oldLeaves);
  const dir = directory(r), result = cli(['export', path.join(dir, 'r.json'), '--to', 'summary-json']);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), s);
  assert.equal(toSummaryJson(absent(r)).placebo, null);
  const empty = structuredClone(r); for (const k of Object.keys(empty.placebo.comparison)) empty.placebo.comparison[k] = null;
  const nulls = toSummaryJson(sealReceipt(empty)).placebo;
  for (const k of ['delta', 'delta_uncertainty', 'with_skill_score', 'placebo_score']) assert.equal(nulls[k], null);
});

test('AC-4: no block leaves plain, view and markdown byte-identical to the pre-change reader', async () => {
  const removed = absent(await receipt());
  const legacy = (await F.run(F.plans(require('../config').EFFECT_FLOOR).above, { placebo: false })).receipt;
  assert.equal(require('../lib/receipt').validateReceipt(legacy).valid, true);
  for (const r of [removed, legacy]) {
  const dir = directory(r), d = decideSet(dir, r.run.model_id);
  assert.ok(verifyReceiptHash(r));
  const old = load('lib/plain.js', {}, BASE);
  assert.deepEqual(P.plainOf(r), old.plainOf(r));
  assert.deepEqual(P.plainOfRow(d.rows[0], r), old.plainOfRow(d.rows[0], r));
  assert.equal(P.commentMarkdown(d, dir, { key: 'fixture' }), old.commentMarkdown(d, dir, { key: 'fixture' }));
  assert.equal(P.summaryLead(d, dir), old.summaryLead(d, dir));
  const html = renderView(dir, options).html;
  assert.ok(!html.includes('data-field="placebo"'));
  assert.equal(html, load('lib/view.js', { './plain': old }, BASE).renderView(dir, options).html);
  assert.equal(buildDriftReport(r, r).markdown, load('lib/diff.js', {}, BASE).buildDriftReport(r, r).markdown);
  }
});

test('AC-4: an ambiguous placebo receipt keeps the existing plain refusal', async () => {
  const r = await receipt(); r.results.cases.push(structuredClone(r.results.cases[0]));
  const sealed = sealReceipt(r);
  const old = load('lib/plain.js', {}, BASE);
  assert.equal(old.plainOf(sealed).state, 'REFUSED');
  assert.deepEqual(P.plainOf(sealed), old.plainOf(sealed));
  const row = { state: 'refused', reason: 'ambiguous fixture' };
  assert.deepEqual(P.plainOfRow(row, sealed), old.plainOfRow(row, sealed));
});

test('AC-4: CLI still refuses a tampered receipt and retains its verification boundary', async () => {
  const r = await receipt(); r.placebo.bytes++;
  const dir = directory(r);
  const result = cli(['export', path.join(dir, 'r.json'), '--to', 'summary-json']);
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes('"format": "driftproof/summary"'));
});

test('AC-5: view is deterministic under SOURCE_DATE_EPOCH and Report 016 renders', async () => {
  const r = await receipt(), dir = directory(r), out = path.join(tmp(), 'view.html');
  const args = ['view', dir, '--out', out];
  const first = cli(args); assert.equal(first.status, 0, first.stderr);
  const bytes = fs.readFileSync(out);
  const second = cli(args); assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(fs.readFileSync(out), bytes);
  const report = path.join(ROOT, 'receipts/report-016');
  const receipts = listReceipts(report).filter(x => x.receipt);
  assert.ok(receipts.some(x => x.receipt.placebo));
  const page = renderView(report, options);
  assert.equal(page.receipts, receipts.length);
  assert.ok(!page.html.includes('data-state="ERROR"'));
  assert.equal((page.html.match(/data-field="placebo"/g) || []).length, receipts.filter(x => x.receipt.placebo).length);
});

test('AC-5 merge hold: Report 013 page bytes are unchanged from the supplied branch tip', () => {
  const dir = path.join(ROOT, 'receipts/report-013');
  assert.equal(renderView(dir, options).html, load('lib/view.js', { './plain': load('lib/plain.js', {}, BASE) }, BASE).renderView(dir, options).html);
});
