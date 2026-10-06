// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for the plain state of a receipt recorded before answered_by existed (spec 145 AC-2).
//
//   node --test tests/plain-recorded-before.test.js
//
// The receipts are built in memory, as tests/plain.test.js builds them, and re-sealed. The formats are
// read, never typed: the version a receipt is stamped with is one whose schema file under spec/ does
// or does not define run.answered_by, found here by reading each file, and the current one is
// config.js RECEIPT_SCHEMA_VERSION.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RECEIPT_SCHEMA_VERSION } = require('../config');
const { receiptVerdict } = require('../lib/verdict');
const { acrossDraws } = require('../lib/sampling');
const { sealReceipt, schemaDefines } = require('../lib/receipt');
const decision = require('../lib/decision');
const plain = require('../lib/plain');
const { renderView } = require('../lib/view');
const { meaningOf } = require('../scripts/report-answers');

const SPEC = path.join(__dirname, '..', 'spec');
// The formats the tree holds a schema for, by file name, and whether each defines run.answered_by.
// receipt.schema.json is the current one. Read from the files, not from lib/receipt.js's table.
const formats = fs.readdirSync(SPEC).flatMap((f) => {
  const m = /^receipt(?:\.v([0-9.]+))?\.schema\.json$/.exec(f);
  if (!m) return [];
  const schema = JSON.parse(fs.readFileSync(path.join(SPEC, f), 'utf8'));
  const version = m[1] || RECEIPT_SCHEMA_VERSION;
  const run = schema.properties && schema.properties.run;
  return [{ version, has: !!(run && run.properties && run.properties.answered_by) }];
});
const OLD = formats.filter((f) => !f.has).map((f) => f.version);
const NEW = formats.filter((f) => f.has).map((f) => f.version);

function arm(id, mode, scores) {
  const draws = scores.map((x, i) => ({ draw_index: i, status: 'measured', samples: [x], mean: x, stddev: 0 }));
  const a = acrossDraws(draws);
  return { id, mode, mean: a.mean, generation: { draws, n_drawn: a.n_drawn, n_measured: a.n_measured, n_unmeasured: a.n_unmeasured, mean: a.mean, sd: a.sd } };
}
function receipt({ version, kind = null, level = 'TESTED', status = 'complete' } = {}) {
  const w = arm('c1', 'with_skill', [0.85, 0.84, 0.86]);
  const b = arm('c1', 'baseline', [0.57, 0.58, 0.56]);
  return sealReceipt({
    ...(version ? { schema_version: version } : {}),
    verification_level: level,
    skill: { name: 'fx-skill' },
    suite: { case_count: 1 },
    run: { model_id: 'fx-model', date_utc: '2026-09-29T00:00:00Z', status, ...(kind ? { answered_by: { kind } } : {}) },
    results: { cases: [w, b] },
    comparison: { with_skill_score: w.mean, baseline_score: b.mean, delta: w.mean - b.mean },
  });
}

test('the formats are read from the schema files, and the field arrived partway through them', () => {
  assert.ok(OLD.length > 0 && NEW.length > 0, JSON.stringify(formats));
  assert.ok(NEW.includes(RECEIPT_SCHEMA_VERSION));
  for (const f of formats) assert.equal(schemaDefines(f.version, 'run', 'answered_by'), f.has, f.version);
});

test('no answered_by in a format that has none: the receipt is said to be recorded before the field existed', () => {
  for (const version of OLD) {
    const r = receipt({ version });
    const v = receiptVerdict(r);
    assert.equal(v.verdict, 'NOT_MEASURED', version);
    assert.deepEqual(v.notMeasured, ['no_answered_by'], version);
    const p = plain.plainOf(r);
    assert.equal(p.state, 'PRE_ANSWERED_BY', version);
    assert.equal(p.label, plain.LABELS.PRE_ANSWERED_BY);
    assert.notEqual(p.label, plain.LABELS.NOT_MEASURED);
    assert.equal(p.sentence, `${plain.LABELS.PRE_ANSWERED_BY}: this receipt carries no verdict, because it was written in receipt format v${version}, which has no field saying what answered the run.`);
    assert.equal(p.why, p.sentence);
    assert.doesNotMatch(p.sentence, /—/);
  }
});

test('no answered_by in a format that has the field, or in none it names: still Not measured', () => {
  for (const version of [...NEW, undefined, 'not-a-version']) {
    const r = receipt({ version });
    assert.equal(receiptVerdict(r).verdict, 'NOT_MEASURED');
    const p = plain.plainOf(r);
    assert.equal(p.state, 'NOT_MEASURED', String(version));
    assert.equal(p.label, plain.LABELS.NOT_MEASURED);
    assert.equal(p.sentence, `Not measured: this receipt carries no verdict, because ${plain.CLAUSES.no_answered_by}.`);
  }
});

test('an answered_by that is not a model is not "before the field": Not measured, as it was', () => {
  const r = receipt({ version: OLD[0], kind: 'external' });
  assert.equal(plain.plainOf(r).state, 'NOT_MEASURED');
});

test('below TESTED is Reported, not measured, whatever the format', () => {
  const r = receipt({ version: OLD[0], level: 'DECLARED' });
  assert.deepEqual(receiptVerdict(r).notMeasured.slice(0, 2), ['below_tested', 'no_answered_by']);
  const p = plain.plainOf(r);
  assert.equal(p.state, 'REPORTED');
  assert.equal(p.label, plain.LABELS.REPORTED);
});

test('another route that fires is said after the format, in the site\'s clause', () => {
  const r = receipt({ version: OLD[0], status: 'incomplete' });
  assert.deepEqual(receiptVerdict(r).notMeasured, ['no_answered_by', 'incomplete']);
  const p = plain.plainOf(r);
  assert.equal(p.state, 'PRE_ANSWERED_BY');
  assert.equal(p.sentence, `${plain.LABELS.PRE_ANSWERED_BY}: this receipt carries no verdict, because it was written in receipt format v${OLD[0]}, which has no field saying what answered the run, and ${plain.CLAUSES.incomplete}.`);
});

test('the clauses are untouched: the site\'s, key for key', () => {
  assert.deepEqual(plain.CLAUSES, require('../scripts/build-receipt-pages').CLAUSES);
});

test('the key and the lede carry the state, in the order the page counts it', () => {
  assert.ok(plain.KEY.PRE_ANSWERED_BY && plain.LEDE.PRE_ANSWERED_BY);
  assert.ok(plain.LEDE_ORDER.includes('PRE_ANSWERED_BY'));
  assert.equal(plain.LEDE.PRE_ANSWERED_BY('<b>1</b>', 1), `<b>1</b> was recorded before answered_by existed`);
  assert.equal(plain.LEDE.PRE_ANSWERED_BY('<b>2</b>', 2), `<b>2</b> were recorded before answered_by existed`);
  assert.doesNotMatch(plain.KEY.PRE_ANSWERED_BY, /—|\bno model\b|\bnever\b/);
});

function setDir(receipts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-before-test-'));
  receipts.forEach((r, i) => fs.writeFileSync(path.join(dir, `r${i}.json`), JSON.stringify(r)));
  return dir;
}

test('a decision row for it reads the receipt\'s own words', (t) => {
  const r = receipt({ version: OLD[0] });
  const dir = setDir([r]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = decision.decideSet(dir, 'fx-model');
  assert.equal(d.rows[0].state, 'not measured');
  assert.deepEqual(plain.plainOfRow(d.rows[0], r), plain.plainOf(r));
  assert.ok(plain.summaryLead(d, dir).includes(plain.plainOf(r).sentence));
});

// The view, over the tracked receipts: a copy of one in an old format, and one in the current format with
// the field cut. The copy keeps its hash, so the page reads it as the receipt it is.
function tracked(dir = path.join(__dirname, '..', 'receipts')) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tracked(p));
    else if (e.name.endsWith('.json')) {
      try { const r = JSON.parse(fs.readFileSync(p, 'utf8')); if (r && r.receipt_hash && r.run) out.push({ p, r }); } catch (_e) { /* not a receipt */ }
    }
  }
  return out;
}

test('the view page names the state in the chip, the sheet, the key and the lede, over an old receipt', (t) => {
  const old = tracked().find((x) => x.r.run.answered_by === undefined && OLD.includes(x.r.schema_version));
  assert.ok(old, 'no tracked receipt predates answered_by');
  const dir = setDir([old.r]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { html, receipts } = renderView(dir, { now: new Date(0), stale: { noHarnessCheck: true } });
  assert.equal(receipts, 1);
  const label = plain.LABELS.PRE_ANSWERED_BY;
  assert.match(html, new RegExp(`<span class="chip v-PRE_ANSWERED_BY" data-field="label">${label}</span>`));
  assert.match(html, new RegExp(`<span class="stamp v-PRE_ANSWERED_BY" data-field="label">${label}</span>`));
  assert.ok(html.includes(`<b>${label}</b>: ${plain.KEY.PRE_ANSWERED_BY}`));
  assert.ok(html.includes(`<b data-count="PRE_ANSWERED_BY">1</b> was recorded before answered_by existed`));
  assert.ok(!html.includes(`>${plain.LABELS.NOT_MEASURED}<`), 'the page must not label it Not measured');
  assert.match(html, /\.v-NOT_MEASURED, \.v-PRE_ANSWERED_BY, \.v-REFUSED \{/);
});

test('every tracked receipt without answered_by reads by the format it names, and no other receipt\'s words move', () => {
  const all = tracked();
  assert.ok(all.length > 0);
  let pre = 0;
  for (const { p, r } of all) {
    let want;
    try { want = receiptVerdict(r); } catch (_e) { continue; }
    const got = plain.plainOf(r);
    const predates = want.verdict === 'NOT_MEASURED' && want.notMeasured.includes('no_answered_by') && !want.notMeasured.includes('below_tested')
      && r.run.answered_by === undefined && OLD.includes(r.schema_version);
    assert.equal(got.state === 'PRE_ANSWERED_BY', predates, path.relative(path.join(__dirname, '..'), p));
    if (predates) pre += 1;
    else assert.notEqual(got.label, plain.LABELS.PRE_ANSWERED_BY);
  }
  assert.ok(pre > 0);
});

test('the report answers say a receipt from before answered_by as the site does: carrying no verdict, with the site\'s clause', () => {
  const old = tracked().find(({ r }) => plain.plainOf(r).state === 'PRE_ANSWERED_BY');
  assert.ok(old, 'no tracked receipt predates answered_by');
  assert.ok(meaningOf(old.r).startsWith('its receipt carries no verdict, because '));
  assert.ok(meaningOf(old.r).includes(plain.CLAUSES.no_answered_by));
});
