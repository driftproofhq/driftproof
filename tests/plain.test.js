// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for lib/plain.js (spec 128 AC-1, AC-2): the plain label and sentence per state.
//
//   node --test tests/plain.test.js
//
// The receipts are built in memory, draw by draw, through lib/sampling.js acrossDraws, and each is
// checked to read the intended verdict through lib/verdict.js before its words are. No floor is
// typed: EFFECT_FLOOR is read from config.js. A decision is taken over a temp directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EFFECT_FLOOR } = require('../config');
const { receiptVerdict, UNDERPOWERED_LINE, lostDrawsLine } = require('../lib/verdict');
const { acrossDraws } = require('../lib/sampling');
const { sealReceipt } = require('../lib/receipt');
const decision = require('../lib/decision');
const plain = require('../lib/plain');

const LOST = null;
function arm(id, mode, scores) {
  const draws = scores.map((x, i) => (x === LOST
    ? { draw_index: i, status: 'unmeasured', reason: 'timeout', samples: [], mean: null, stddev: null }
    : { draw_index: i, status: 'measured', samples: [x], mean: x, stddev: 0 }));
  const a = acrossDraws(draws);
  return { id, mode, mean: a.mean, generation: { draws, n_drawn: a.n_drawn, n_measured: a.n_measured, n_unmeasured: a.n_unmeasured, mean: a.mean, sd: a.sd } };
}
function receipt(withScores, baseScores, { model = 'fx-model', skill = 'fx-skill', level = 'TESTED', kind = 'model', status = 'complete', source = null } = {}) {
  const w = arm('c1', 'with_skill', withScores);
  const b = arm('c1', 'baseline', baseScores);
  return sealReceipt({
    verification_level: level,
    skill: { name: skill },
    suite: { case_count: 1 },
    run: { model_id: model, date_utc: '2026-09-29T00:00:00Z', status, ...(kind ? { answered_by: { kind } } : {}), ...(source ? { source } : {}) },
    results: { cases: [w, b] },
    comparison: { with_skill_score: w.mean, baseline_score: b.mean, delta: w.mean - b.mean },
  });
}
const DIRECTION = /no clear difference|no effect|helped|hurt/i;

test('PASSED and REGRESSED: the label, the figures and the task count', () => {
  const up = receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56]);
  assert.equal(receiptVerdict(up).verdict, 'PASSED');
  const p = plain.plainOf(up);
  assert.equal(p.label, plain.LABELS.PASSED);
  assert.equal(p.sentence, 'The skill clearly helped: 0.850 with it and 0.570 without, on 1 test task.');
  const down = receipt([0.57, 0.58, 0.56], [0.85, 0.84, 0.86]);
  assert.equal(receiptVerdict(down).verdict, 'REGRESSED');
  assert.equal(plain.plainOf(down).sentence, 'The skill clearly hurt: 0.570 with it and 0.850 without, on 1 test task.');
});

test('NO_EFFECT: the floor is config.js EFFECT_FLOOR', () => {
  const r = receipt([0.80, 0.80, 0.81], [0.80, 0.81, 0.80]);
  assert.equal(receiptVerdict(r).verdict, 'NO_EFFECT');
  const p = plain.plainOf(r);
  assert.equal(p.label, plain.LABELS.NO_EFFECT);
  assert.ok(p.sentence.endsWith(`with enough answers to have seen a gap of ${EFFECT_FLOOR}.`), p.sentence);
});

test('UNDERPOWERED: a clause per reason, never a direction, and spec 035\'s plain line as the detail', () => {
  const cases = {
    draws: [[0.78, 0.80, 0.82], [0.77, 0.79, 0.81], 'but the scores varied too much to call it'],
    spread: [[0.77, 0.80, 0.83], [0.76, 0.79, 0.82], 'but the scores varied too much to call it'],
    single_draw: [[0.80], [0.79], 'but one side had a single answer'],
    lost_draws: [[0.80, 0.81, 0.80, LOST], [0.80, 0.80, 0.81], 'but some answers were lost'],
  };
  for (const [reason, [w, b, clause]] of Object.entries(cases)) {
    const r = receipt(w, b);
    const v = receiptVerdict(r);
    assert.equal(v.verdict, 'UNDERPOWERED', reason);
    assert.equal(v.drawsNeeded.reason, reason);
    const p = plain.plainOf(r);
    assert.equal(p.label, plain.LABELS.UNDERPOWERED);
    assert.ok(p.sentence.startsWith('Too few answers to tell: ') && p.sentence.includes(clause), p.sentence);
    assert.doesNotMatch(p.sentence, DIRECTION);
    assert.ok(p.detail.startsWith(`${UNDERPOWERED_LINE}.`), p.detail);
  }
});

test('UNDERPOWERED is read from the verdict, not the delta: a lift over the floor still reads too few answers', () => {
  const r = receipt([0.60, 0.90, 0.75], [0.50, 0.80, 0.65]);
  assert.ok(r.comparison.delta >= EFFECT_FLOOR);
  assert.equal(plain.plainOf(r).label, plain.LABELS.UNDERPOWERED);
});

test('INCONCLUSIVE: names the lost draws and no direction', () => {
  const r = receipt([0.85, 0.84, 0.86, LOST], [0.57, 0.58, 0.56]);
  const v = receiptVerdict(r);
  assert.equal(v.verdict, 'INCONCLUSIVE');
  const p = plain.plainOf(r);
  assert.equal(p.label, plain.LABELS.INCONCLUSIVE);
  assert.doesNotMatch(p.sentence, DIRECTION);
  assert.equal(p.detail, lostDrawsLine(v.lostDraws));
});

test('below TESTED: reported, not measured, with the tool named and no verdict or lift', () => {
  const r = receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { level: 'DECLARED', kind: 'external', source: 'imported/skillgrade' });
  const p = plain.plainOf(r);
  assert.equal(p.label, plain.LABELS.REPORTED);
  assert.ok(p.sentence.startsWith('Reported, not measured: `skillgrade` reported 0.850 with the skill and 0.570 without.'), p.sentence);
  assert.doesNotMatch(p.sentence, /clearly|lift|[+-]\d\.\d{3}/i);
});

test('an imported tool\'s name is shown as code and cannot break a line (F-6, A-128-4)', () => {
  const r = receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { level: 'DECLARED', kind: 'external', source: 'imported/x`y\n@someone [x](https://h.example)' });
  const p = plain.plainOf(r);
  assert.ok(p.sentence.startsWith("Reported, not measured: `x'y @someone [x](https://h.example)` reported 0.850"), p.sentence);
  assert.doesNotMatch(p.sentence, /\n/);
});

test('the comment names the receipt\'s verification level (F-5, A-128-4)', (t) => {
  const r = receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { model: 'fx-d' });
  const dir = setDir([r]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = decision.decideSet(dir, 'fx-d');
  const last = plain.commentMarkdown(d, dir, { key: 'abc123' }).split('\n').pop();
  assert.ok(last.includes(`verification level \`${r.verification_level}\``), last);
});

test('a run no model answered: reported, not measured, with no tool named (A-128-3)', () => {
  const r = receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { level: 'UNVERIFIED', kind: 'stub' });
  assert.ok(receiptVerdict(r).notMeasured.includes('below_tested'));
  const p = plain.plainOf(r);
  assert.equal(p.label, plain.LABELS.REPORTED);
  assert.ok(p.sentence.startsWith('Reported, not measured: the receipt reports 0.850 with the skill and 0.570 without.'), p.sentence);
});

test('the why line, the comment\'s, per state (A-128-3)', () => {
  const up = plain.plainOf(receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56]));
  assert.equal(up.why, `0.850 with the skill and 0.570 without; the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least ${EFFECT_FLOOR}.`);
  const down = plain.plainOf(receipt([0.57, 0.58, 0.56], [0.85, 0.84, 0.86]));
  assert.equal(down.why, `0.570 with the skill and 0.850 without; the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least ${EFFECT_FLOOR}.`);
  const flat = plain.plainOf(receipt([0.80, 0.80, 0.81], [0.80, 0.81, 0.80]));
  assert.equal(flat.why, `there were enough answers to have seen a gap of ${EFFECT_FLOOR}, and the test task did not show one.`);
  const under = plain.plainOf(receipt([0.78, 0.80, 0.82], [0.77, 0.79, 0.81]));
  assert.equal(under.why, under.detail);
  assert.doesNotMatch(under.why, DIRECTION);
  const lost = plain.plainOf(receipt([0.85, 0.84, 0.86, LOST], [0.57, 0.58, 0.56]));
  assert.equal(lost.why, lost.detail);
  assert.doesNotMatch(lost.why, DIRECTION);
  const nm = plain.plainOf(receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { kind: null }));
  assert.equal(nm.why, nm.sentence);
});

test('the key and the lede: no conclusion from a non-separation, ranges for a separation (A-128-3)', () => {
  const lede = plain.LEDE_ORDER.flatMap((s) => [plain.LEDE[s]('1', 1), plain.LEDE[s]('2', 2)]);
  for (const t of [...Object.values(plain.KEY), ...lede]) assert.doesNotMatch(t, /\bthere (?:was|is) none\b/i, t);
  for (const s of ['UNDERPOWERED', 'INCONCLUSIVE']) {
    assert.doesNotMatch(plain.KEY[s], DIRECTION);
    assert.doesNotMatch(plain.LEDE[s]('2', 2), DIRECTION);
  }
  for (const s of ['PASSED', 'REGRESSED']) {
    assert.match(plain.KEY[s], /two ranges of scores/);
    assert.doesNotMatch(plain.KEY[s], /two sets|the scores with the skill/);
  }
  assert.doesNotMatch(plain.KEY.REPORTED + plain.LEDE.REPORTED('2', 2), /^another tool|by another tool and/);
});

test('NOT_MEASURED by another route: the site\'s clauses, joined as the site joins them', () => {
  const one = plain.plainOf(receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { kind: null }));
  assert.equal(one.label, plain.LABELS.NOT_MEASURED);
  assert.equal(one.sentence, `Not measured: this receipt carries no verdict, because ${plain.CLAUSES.no_answered_by}.`);
  const two = plain.plainOf(receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { kind: null, status: 'incomplete' }));
  assert.equal(two.sentence, `Not measured: this receipt carries no verdict, because ${plain.CLAUSES.no_answered_by}, and ${plain.CLAUSES.incomplete}.`);
});

test('the clauses are the site\'s, key for key', () => {
  assert.deepEqual(plain.CLAUSES, require('../scripts/build-receipt-pages').CLAUSES);
});

test('an ambiguous receipt is no result', () => {
  const r = receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56]);
  r.results.cases.push(structuredClone(r.results.cases[0]));
  const p = plain.plainOf(r);
  assert.equal(p.label, plain.LABELS.REFUSED);
  assert.match(p.sentence, /^No result: /);
});

function setDir(receipts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-test-'));
  for (const r of receipts) fs.writeFileSync(path.join(dir, `${r.skill.name}-${r.run.model_id}-2026-09-29.json`), JSON.stringify(r));
  return dir;
}

test('rows: each decision state in words, and the lead agrees with failsJob', (t) => {
  const helped = receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { model: 'fx-a' });
  const under = receipt([0.78, 0.80, 0.82], [0.77, 0.79, 0.81], { model: 'fx-b' });
  const dir = setDir([helped, under]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const failOnUnderpowered of [false, true]) {
    const opts = { failOnRegression: true, failOnUnderpowered };
    const d = decision.decideSet(dir, 'fx-a,fx-b,fx-z', opts);
    const byModel = Object.fromEntries(d.rows.map((r) => [r.model, r]));
    assert.deepEqual(plain.plainOfRow(byModel['fx-a'], helped), plain.plainOf(helped));
    assert.deepEqual(plain.plainOfRow(byModel['fx-b'], under), plain.plainOf(under));
    const refused = plain.plainOfRow(byModel['fx-z'], null);
    assert.equal(refused.label, plain.LABELS.REFUSED);
    assert.equal(refused.sentence, `No result for this model: ${byModel['fx-z'].reason}.`);
    const lead = plain.summaryLead(d, dir, opts);
    assert.ok(lead.includes('fx-z') && lead.includes(refused.sentence), lead);
    assert.ok(lead.endsWith(d.fails ? 'This run fails the job.' : 'This run does not fail the job.'), lead);
  }
});

test('rows: an incomplete run reads inconclusive with its own sentence', (t) => {
  const r = receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { model: 'fx-a', status: 'incomplete' });
  const dir = setDir([r]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = decision.decideSet(dir, 'fx-a');
  assert.equal(d.rows[0].state, 'inconclusive');
  const p = plain.plainOfRow(d.rows[0], r);
  assert.equal(p.label, plain.LABELS.INCONCLUSIVE);
  assert.equal(p.sentence, 'Inconclusive: the run did not complete, so it gives no result.');
});

test('the comment: the marker first, the worst label, and spec 035\'s line for UNDERPOWERED', (t) => {
  const under = receipt([0.78, 0.80, 0.82], [0.77, 0.79, 0.81], { model: 'fx-b' });
  const dir = setDir([under]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = decision.decideSet(dir, 'fx-b');
  const body = plain.commentMarkdown(d, dir, { key: 'abc123', runUrl: 'https://github.example/r/1' });
  const lines = body.split('\n');
  assert.equal(lines[0], plain.markerLine('abc123'));
  assert.ok(lines[1].includes(plain.LABELS.UNDERPOWERED) && lines[1].includes('fx-b') && lines[1].includes('fx-skill'), lines[1]);
  assert.ok(body.includes(UNDERPOWERED_LINE));
});

test('the comment: a skill name is shown as code and cannot break a line', (t) => {
  const r = receipt([0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { model: 'fx-c', skill: 'fx`skill\n@someone [x](y)' });
  const dir = setDir([r]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = decision.decideSet(dir, 'fx-c');
  const lines = plain.commentMarkdown(d, dir, { key: 'abc123' }).split('\n');
  assert.equal(lines[0], plain.markerLine('abc123'));
  assert.ok(lines[1].endsWith("(`fx-c`, `fx'skill @someone [x](y)`)"), lines[1]);
});
