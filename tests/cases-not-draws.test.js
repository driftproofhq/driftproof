// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 143: where a wide band over the cases is the cases disagreeing, every surface
// says more cases are needed, not more draws; where it is draw spread, the plain line stands. The
// receipts are built in memory, draw by draw, through lib/sampling.js acrossDraws and sealed with
// lib/receipt.js, as tests/verdict-band.test.js builds them. No floor, z or word is typed where the
// tree holds it: EFFECT_FLOOR and POWER_Z are read from config.js, and the surfaces are compared with
// the constants lib/verdict.js exports (AC-3 holds those to the spec's words). A decision is taken
// over a temp directory.
//
//   node --test tests/cases-not-draws.test.js
//
// Every test name starts with the criterion it checks; spec 143's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EFFECT_FLOOR, POWER_Z } = require('../config');
const verdict = require('../lib/verdict');
const { receiptVerdict, verdictFromReceipt, badgeEndpoint, githubOutputLines, drawsLine, UNDERPOWERED_LINE, VERDICTS } = verdict;
const { acrossDraws } = require('../lib/sampling');
const { sealReceipt, validateReceipt, listReceipts } = require('../lib/receipt');
const { stddev, combineUncertainty, round } = require('../lib/stats');
const decision = require('../lib/decision');
const plain = require('../lib/plain');
const { badgeSvg, STATE } = require('../lib/badge-svg');
const { renderView } = require('../lib/view');
const pages = require('../scripts/build-receipt-pages');

const LOST = null;
// One arm of one case: each draw judged twice, every sample the draw's score.
function arm(id, mode, scores) {
  const draws = scores.map((x, i) => (x === LOST
    ? { draw_index: i, status: 'unmeasured', reason: 'timeout', samples: [], mean: null, stddev: null }
    : { draw_index: i, status: 'measured', samples: [x, x], mean: x, stddev: 0 }));
  const a = acrossDraws(draws);
  return { id, mode, mean: a.mean, stddev: a.sd, generation: { draws, n_drawn: a.n_drawn, n_measured: a.n_measured, n_unmeasured: a.n_unmeasured, mean: a.mean, sd: a.sd } };
}
// A receipt of cases, each [with-skill scores, baseline scores].
function receipt(cases, { model = 'fx-model', skill = 'fx-skill' } = {}) {
  const rows = cases.flatMap(([w, b], i) => [arm(`c${i + 1}`, 'with_skill', w), arm(`c${i + 1}`, 'baseline', b)]);
  const means = (mode) => rows.filter((r) => r.mode === mode).map((r) => r.mean);
  const mw = means('with_skill'); const mb = means('baseline');
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = (xs) => (xs.length < 2 ? null : round(stddev(xs)));
  const comparison = { with_skill_score: round(avg(mw)), baseline_score: round(avg(mb)), delta: round(avg(mw) - avg(mb)), delta_uncertainty: cases.length < 2 ? null : combineUncertainty(sd(mw), sd(mb)) };
  if (cases.length < 2) comparison.delta_uncertainty_unavailable = 'single_case';
  return sealReceipt({
    verification_level: 'TESTED',
    skill: { name: skill },
    suite: { case_count: cases.length },
    run: { model_id: model, date_utc: '2026-10-02T00:00:00Z', answered_by: { kind: 'model' }, judge: { samples: 2 } },
    results: { cases: rows },
    comparison,
  });
}

// THE FIXTURES.
// CASES: spec 137's operator shape. Every draw of a case scores the same, so the whole band is the
// cases sitting apart.
const CASES = [[[0.3, 0.3, 0.3], [0.3, 0.3, 0.3]], [[0.6, 0.6, 0.6], [0.6, 0.6, 0.6]], [[0.72, 0.72, 0.72], [0.72, 0.72, 0.72]]];
// DRAWS: two cases a gap just over the floor apart, each arm's three draws spread by d, near the most
// a case that reads no separation allows (R-2: 2d + Z sqrt(2 d^2 / 3) under the floor). The draw
// share takes BETWEEN under the floor.
const D = 0.0135;
const GAP = EFFECT_FLOOR * 1.01;
const spread = (x) => [x - D, x, x + D];
const DRAWS = [[spread(0.5), spread(0.5)], [spread(0.5 + GAP), spread(0.5 + GAP)]];
// TIGHT: the same two cases with no draw spread. Same band; BETWEEN is the band.
const TIGHT = [[[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]], [[0.5 + GAP, 0.5 + GAP, 0.5 + GAP], [0.5 + GAP, 0.5 + GAP, 0.5 + GAP]]];
// Spec 035's two case-level shapes, one case each: a draws count, and spreads that reach the floor.
const CASE_DRAWS = [[[0.78, 0.80, 0.82], [0.77, 0.79, 0.81]]];
const CASE_SPREAD = [[[0.77, 0.80, 0.83], [0.76, 0.79, 0.82]]];
// LOST: spec 137's lost-draw fixture. Its band is widened, and BETWEEN cannot be read.
const many = (x, n) => Array(n).fill(x);
const LOST_GAP = EFFECT_FLOOR - 0.0005;
const LOSTCASE = [[[...many(0.8, 600), LOST], many(0.8, 600)], [many(0.8 + LOST_GAP, 600), many(0.8 + LOST_GAP, 600)]];

const casesWord = verdict.CASES_WORD;
const casesLine = verdict.CASES_LINE;
const drawsWord = VERDICTS.UNDERPOWERED.word;

// THE ORACLE for BETWEEN, from the receipt's draws, apart from lib/verdict.js: per arm, the sample
// variance of the case means less the mean of s^2 / n, floored at zero; the two arms in quadrature.
function oracleBetween(r) {
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = (xs) => { const m = mean(xs); return xs.reduce((t, x) => t + (x - m) ** 2, 0) / (xs.length - 1); };
  let sum = 0;
  for (const mode of ['with_skill', 'baseline']) {
    const arms = r.results.cases.filter((c) => c.mode === mode).map((c) => c.generation.draws.map((d) => d.mean));
    const share = mean(arms.map((xs) => variance(xs) / xs.length));
    sum += Math.max(0, variance(arms.map(mean)) - share);
  }
  return Math.sqrt(sum);
}

test('AC-1 the operator\'s shape reads the cases kind: BETWEEN is the band, and no number of draws narrows it', () => {
  const r = receipt(CASES);
  const v = receiptVerdict(r);
  assert.equal(v.verdict, 'UNDERPOWERED');
  assert.equal(v.drawsNeeded.reason, 'suite_band');
  assert.equal(v.drawsNeeded.driver, 'cases');
  assert.ok(Math.abs(v.drawsNeeded.between - oracleBetween(r)) < 1e-5, `${v.drawsNeeded.between} against ${oracleBetween(r)}`);
  assert.ok(v.drawsNeeded.between >= EFFECT_FLOOR);
});

test('AC-1 draw spread that more draws would narrow reads the draws kind, and the same gap with no draw spread reads the cases kind', () => {
  const draws = receipt(DRAWS);
  const v = receiptVerdict(draws);
  assert.equal(v.verdict, 'UNDERPOWERED');
  assert.ok(v.cases.every((c) => c.state === 'not-separated'), JSON.stringify(v.cases.map((c) => c.state)));
  assert.equal(v.drawsNeeded.reason, 'suite_band');
  assert.ok(v.drawsNeeded.band >= EFFECT_FLOOR, String(v.drawsNeeded.band));
  assert.ok(v.drawsNeeded.between < EFFECT_FLOOR, String(v.drawsNeeded.between));
  assert.ok(Math.abs(v.drawsNeeded.between - oracleBetween(draws)) < 1e-5, `${v.drawsNeeded.between} against ${oracleBetween(draws)}`);
  assert.equal(v.drawsNeeded.driver, 'draws');
  const tight = receiptVerdict(receipt(TIGHT));
  assert.equal(tight.verdict, 'UNDERPOWERED');
  assert.ok(Math.abs(tight.drawsNeeded.band - v.drawsNeeded.band) < 1e-5, 'the two fixtures do not share a band');
  assert.equal(tight.drawsNeeded.driver, 'cases');
});

// EDGE: two cases exactly the floor apart, each arm's draws spread by e, so BETWEEN is
// sqrt(F^2 - 2 e^2 / 3), 2e-7 under the floor, and rounds to it at six places (lane 117 finding 13).
const E = Math.sqrt(3 * EFFECT_FLOOR * 2e-7);
const nudge = (x) => [x - E, x, x + E];
const EDGE = [[nudge(0.5), nudge(0.5)], [nudge(0.5 + EFFECT_FLOOR), nudge(0.5 + EFFECT_FLOOR)]];

test('AC-1 the driver is read from BETWEEN as the receipt records it', () => {
  const r = receipt(EDGE);
  const v = receiptVerdict(r);
  assert.equal(v.drawsNeeded.reason, 'suite_band');
  assert.ok(oracleBetween(r) < EFFECT_FLOOR && Math.round(oracleBetween(r) * 1e6) / 1e6 === EFFECT_FLOOR, `the fixture's BETWEEN is ${oracleBetween(r)}`);
  assert.equal(v.drawsNeeded.between, EFFECT_FLOOR);
  assert.equal(v.drawsNeeded.driver, 'cases');
});

test('AC-1 a lost draw leaves BETWEEN unread, and the reading keeps the Base\'s words', () => {
  const v = receiptVerdict(receipt(LOSTCASE));
  assert.equal(v.verdict, 'UNDERPOWERED');
  assert.equal(v.drawsNeeded.reason, 'suite_band');
  assert.equal(v.drawsNeeded.widened, true);
  assert.equal(v.drawsNeeded.between, null);
  assert.equal(v.drawsNeeded.driver, null);
  assert.equal(drawsLine(v.drawsNeeded), `Draws needed: no draw count at this band (the comparison band over the 2 cases is plus or minus ${Number(v.drawsNeeded.band).toFixed(3)} at most, over every score the lost draws could have had, at or above the ${EFFECT_FLOOR} floor).`);
  assert.equal(verdict.underpoweredLine(v.drawsNeeded), UNDERPOWERED_LINE);
});

// An arm with no recorded generation.sd (the receipt schema does not require it): its draw share is
// not on the receipt, so BETWEEN is not read from a share of 0 (pre-review finding 9).
test('AC-1 an arm with no recorded sd leaves BETWEEN unread, and the reading keeps the Base\'s words', () => {
  const r = receipt(CASES);
  delete r.results.cases.find((c) => c.mode === 'baseline').generation.sd;
  const v = receiptVerdict(r);
  assert.equal(v.verdict, 'UNDERPOWERED');
  assert.equal(v.drawsNeeded.reason, 'suite_band');
  assert.equal(v.drawsNeeded.between, null);
  assert.equal(v.drawsNeeded.driver, null);
  assert.equal(verdict.underpoweredLine(v.drawsNeeded), UNDERPOWERED_LINE);
  assert.equal(verdictFromReceipt(r).message, `${drawsWord} on fx-model`);
});

test('AC-1 over 500 seeded band-rung receipts, BETWEEN is the oracle\'s, never above the band, and the draws kind only under R-2\'s bound', () => {
  const bound = EFFECT_FLOOR * Math.sqrt(1 + 1 / (Math.SQRT2 + POWER_Z) ** 2);
  let seed = 143;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const kinds = { cases: 0, draws: 0 };
  let read = 0;
  for (let i = 0; i < 500; i++) {
    const k = 2 + Math.floor(rnd() * 2);
    const n = 2 + Math.floor(rnd() * 3);
    const sdMax = EFFECT_FLOOR / (2 + POWER_Z * Math.sqrt(2 / n));
    const cases = [];
    for (let c = 0; c < k; c++) {
      const centre = 0.4 + (c === 0 ? 0 : EFFECT_FLOOR * (0.6 + 0.6 * rnd()));
      const armScores = () => {
        const raw = Array.from({ length: n }, () => rnd() - 0.5);
        const m = raw.reduce((a, b) => a + b, 0) / n;
        const s = Math.sqrt(raw.reduce((t, x) => t + (x - m) ** 2, 0) / (n - 1)) || 1;
        const want = sdMax * (0.5 + 0.48 * rnd());
        return raw.map((x) => Math.round((centre + ((x - m) / s) * want) * 1e6) / 1e6);
      };
      cases.push([armScores(), armScores()]);
    }
    const r = receipt(cases);
    const v = receiptVerdict(r);
    if (!(v.drawsNeeded && v.drawsNeeded.reason === 'suite_band')) continue;
    read++;
    const d = v.drawsNeeded;
    assert.ok(Math.abs(d.between - oracleBetween(r)) < 1e-5, `receipt ${i}: ${d.between} against ${oracleBetween(r)}`);
    assert.ok(d.between <= d.band + 1e-6, `receipt ${i}: BETWEEN ${d.between} above the band ${d.band}`);
    assert.equal(d.driver, d.between < EFFECT_FLOOR ? 'draws' : 'cases', `receipt ${i}`);
    if (d.driver === 'draws') assert.ok(d.band < bound, `receipt ${i}: the draws kind at a band of ${d.band}, at or above ${bound}`);
    kinds[d.driver]++;
  }
  assert.ok(read >= 50 && kinds.cases > 0 && kinds.draws > 0, `band-rung receipts read ${read}, kinds ${JSON.stringify(kinds)}`);
});

// THE CLAIM BEHIND THE WORDS, by simulation (lane 117 finding 11). The oracle above re-implements the
// rule's arithmetic; this test reads what the words say of it. Each case's true mean is drawn from
// N(0.5, sB^2) and shared by its two arms, and each draw from N(mean, SW^2). Per arm the sample
// variance of the case means is expected to be sB^2 + SW^2 / n, so the band squared is expected to be
// 2 (sB^2 + SW^2 / n): more draws are expected to narrow it toward 2 sB^2, the cases' own spread, and
// never below it. Seeded, so it reads the same every run.
// The simulation reads the estimator, suiteBand, directly, and not receipts a reader can reach: with
// SW = 0.1 a case's two spreads already sum to about the floor, so such a case reads `spread` and never
// the band rung. A reachable band-rung receipt of the draws kind has a band under R-2's bound,
// F sqrt(1 + 1/(sqrt(2) + Z)^2), about 4 percent above the floor (pre-review finding 11). The test after
// it reads receipts that reach the band rung.
test('AC-1 more draws are expected to narrow a band of draw spread toward the cases\' spread, and not under the floor where the cases sit apart (seeded simulation)', () => {
  const { suiteBand } = verdict;
  let seed = 1431;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed + 0.5) / 2147483648; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const K = 3; const SW = 0.1; const T = 4000;
  const ids = Array.from({ length: K }, (_, i) => ({ id: `c${i + 1}` }));
  const mean2 = (sB, n) => {
    let band = 0; let between = 0;
    for (let t = 0; t < T; t++) {
      const rows = [];
      for (let i = 0; i < K; i++) {
        const c = 0.5 + sB * gauss();
        for (const mode of ['with_skill', 'baseline']) rows.push(arm(`c${i + 1}`, mode, Array.from({ length: n }, () => c + SW * gauss())));
      }
      const b = suiteBand({ results: { cases: rows } }, ids);
      band += b.value ** 2; between += b.between ** 2;
    }
    return { band: band / T, between: between / T, expect: 2 * (sB ** 2 + SW ** 2 / n) };
  };
  const near = (got, want) => Math.abs(got - want) <= 0.15 * want;
  // The cases close together (sB under the floor): the band is wide from draw spread.
  const close = 0.4 * EFFECT_FLOOR;
  const c3 = mean2(close, 3); const c30 = mean2(close, 30);
  assert.ok(near(c3.band, c3.expect) && near(c30.band, c30.expect), JSON.stringify({ c3, c30 }));
  assert.ok(c3.band >= EFFECT_FLOOR ** 2, `at 3 draws the band is not wide: ${JSON.stringify(c3)}`);
  assert.ok(c30.band - 2 * close ** 2 < (c3.band - 2 * close ** 2) / 5, `30 draws did not take the band toward the cases' spread: ${JSON.stringify({ c3, c30 })}`);
  // The cases apart (sB at or above the floor): no draw count takes the band, or BETWEEN, under it.
  const apart = 1.2 * EFFECT_FLOOR;
  for (const n of [3, 30]) {
    const a = mean2(apart, n);
    assert.ok(near(a.band, a.expect), `${n} draws: ${JSON.stringify(a)}`);
    assert.ok(a.band >= EFFECT_FLOOR ** 2 && a.between >= EFFECT_FLOOR ** 2, `${n} draws: ${JSON.stringify(a)}`);
  }
});

// The same reading, through receipts that reach the band rung (pre-review finding 11, overnight
// decision 24: the simulation reaches the band rung). Three fixed cases per arm, their true means
// 0.5 - a, 0.5 and 0.5 + a, so the cases' own spread per arm is a^2, and each draw scores its case's
// mean plus a draw spread of D, the most a resolved case allows at 3 draws (the DRAWS fixture's). Each
// set is read by receiptVerdict. Where the cases sit close (2 a^2 just under F^2), the band is at or
// above the floor at 3 draws in expectation and under it at 30, and BETWEEN is under it: more draws
// narrow it. Where they sit apart, neither the band nor BETWEEN goes under the floor at either count.
// Both regimes reach the band rung, and the close one reads the draws kind more often. A single
// receipt's reading holds only in expectation, so the shares are compared, not required to be whole.
test('AC-1 band-rung receipts: more draws narrow a band of draw spread under the floor, and not one of cases sitting apart (seeded simulation through receiptVerdict)', () => {
  const { suiteBand } = verdict;
  let seed = 1432;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed + 0.5) / 2147483648; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const T = 4000;
  const ids = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
  const run = (a, n) => {
    const f = { band: 0, between: 0, rung: 0, draws: 0, cases: 0 };
    for (let t = 0; t < T; t++) {
      const rows = [];
      [-a, 0, a].forEach((o, i) => { for (const mode of ['with_skill', 'baseline']) rows.push(arm(`c${i + 1}`, mode, Array.from({ length: n }, () => round(0.5 + o + D * gauss())))); });
      const r = { verification_level: 'TESTED', run: { model_id: 'fx-model', answered_by: { kind: 'model' }, judge: { samples: 2 } }, suite: { case_count: 3 }, results: { cases: rows }, comparison: { delta: 0 } };
      const b = suiteBand(r, ids);
      f.band += b.value ** 2 / T; f.between += b.between ** 2 / T;
      const d = receiptVerdict(r).drawsNeeded;
      if (d && d.reason === 'suite_band') { f.rung += 1; if (d.driver) f[d.driver] += 1; }
    }
    return f;
  };
  const F2 = EFFECT_FLOOR ** 2;
  const close3 = run(0.7 * EFFECT_FLOOR, 3); const close30 = run(0.7 * EFFECT_FLOOR, 30);
  const apart3 = run(0.775 * EFFECT_FLOOR, 3); const apart30 = run(0.775 * EFFECT_FLOOR, 30);
  const all = JSON.stringify({ close3, close30, apart3, apart30, F2 });
  assert.ok(close3.band >= F2 && close3.between < F2, `close, 3 draws: ${all}`);
  assert.ok(close30.band < F2, `close, 30 draws: the band did not go under the floor: ${all}`);
  for (const f of [apart3, apart30]) assert.ok(f.band >= F2 && f.between >= F2, `apart: ${all}`);
  for (const f of [close3, close30, apart3, apart30]) assert.ok(f.rung > 0 && f.draws + f.cases === f.rung, `the band rung is not reached, or a driver is null: ${all}`);
  assert.ok(close3.draws > 0 && close3.draws / close3.rung > apart3.draws / apart3.rung, `the draws kind is not read more often where the cases sit close: ${all}`);
  assert.ok(apart30.cases / apart30.rung >= 0.95, `apart, 30 draws: ${all}`);
});

// A decision over a temp directory of receipts, one per model.
function setDir(t, receipts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-not-draws-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const r of receipts) fs.writeFileSync(path.join(dir, `${r.skill.name}-${r.run.model_id}-2026-10-02.json`), JSON.stringify(r));
  return dir;
}

test('AC-2 the badge message, its endpoint and --github-output say more cases needed where the cases disagree, with the state\'s token and colour', () => {
  const r = receipt(CASES);
  const v = verdictFromReceipt(r);
  assert.equal(v.verdict, 'UNDERPOWERED');
  assert.equal(v.color, VERDICTS.UNDERPOWERED.color);
  assert.equal(v.message, `${casesWord} on fx-model`);
  assert.equal(badgeEndpoint(r).message, `${casesWord} on fx-model`);
  const out = githubOutputLines(r);
  assert.match(out, /\nUNDERPOWERED\n/);
  assert.ok(out.includes(`\n${casesWord} on fx-model\n`), out);
  assert.ok(!out.includes(drawsWord), out);
});

test('AC-2 the badge SVG\'s state segment says more cases needed, with the state\'s fill and data-verdict', () => {
  const svg = badgeSvg(receipt(CASES));
  assert.match(svg, /data-verdict="UNDERPOWERED"/);
  assert.ok(svg.includes(`<text data-seg="state"`) && svg.includes(`>${casesWord}</text>`), svg);
  assert.ok(svg.includes(`fill="${STATE.UNDERPOWERED.fill}"`), 'the state fill moved');
  assert.ok(!svg.includes(drawsWord), svg);
  assert.match(svg, /3 draws, no count at this band/);
});

test('AC-2 decide: the set badge, the summary row and the ::error line carry the cases words where the cases disagree', (t) => {
  const cases = receipt(CASES, { model: 'fx-a' });
  const dir = setDir(t, [cases]);
  const opts = { failOnRegression: true, failOnUnderpowered: true };
  const d = decision.decideSet(dir, 'fx-a', opts);
  assert.equal(d.rows[0].state, 'underpowered');
  assert.equal(decision.badgeEndpointForSet(d).message, `${casesWord} on fx-a`);
  assert.equal(decision.badgeEndpointForSet(d).color, decision.RENDER.underpowered.color);
  const out = decision.githubOutputLines(d);
  assert.match(out, /\nUNDERPOWERED\n/);
  assert.match(out, /draws_needed<<ghadelim_[0-9a-f]+\nnone\n/);
  const summary = decision.summaryMarkdown(d);
  assert.ok(summary.includes(`${casesLine}. ${drawsLine(d.rows[0].drawsNeeded)}`), summary);
  assert.ok(!summary.includes(UNDERPOWERED_LINE), summary);
  const errors = decision.enforcementLines(d, opts).filter((l) => l.startsWith('::error'));
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes(`fx-a: underpowered - ${casesLine}.`), errors[0]);
  assert.equal(decision.failsJob(d.rows[0], opts), true);
});

// A set badge counts beside its word only the models said in that word, and counts the models in the
// same state but said in other words apart, by the state, so none drops off it (pre-review finding 8).
test('AC-2 decide: a set badge counts beside its word only the models said in that word, and the rest of the state apart', (t) => {
  for (const shapes of [[CASES, DRAWS, CASES], [CASES, DRAWS, DRAWS], [CASES, CASES, CASES]]) {
    const dir = setDir(t, shapes.map((x, i) => receipt(x, { model: `fx-${'abc'[i]}` })));
    const d = decision.decideSet(dir, 'fx-a,fx-b,fx-c');
    assert.deepEqual(d.rows.map((r) => r.state), ['underpowered', 'underpowered', 'underpowered']);
    const named = d.rows[0];
    const word = verdict.underpoweredWord(named.drawsNeeded);
    const same = d.rows.filter((r) => verdict.underpoweredWord(r.drawsNeeded) === word).length;
    const counts = [same > 1 ? `+${same - 1} more` : null, same < 3 ? `+${3 - same} more underpowered` : null].filter(Boolean);
    assert.equal(decision.badgeEndpointForSet(d).message, `${word} on ${named.model}${counts.length ? ` (${counts.join(', ')})` : ''}`);
    assert.deepEqual(d.rows.map((r) => verdict.underpoweredWord(r.drawsNeeded)).sort(), shapes.map((x) => (x === CASES ? casesWord : drawsWord)).sort());
  }
});

test('AC-2 the plain words, the job summary lead and the pull request comment carry the cases words', (t) => {
  const r = receipt(CASES, { model: 'fx-a' });
  const p = plain.plainOf(r);
  assert.equal(p.state, 'UNDERPOWERED');
  assert.equal(p.words, 'UNDERPOWERED_CASES');
  assert.equal(p.label, plain.LABELS.UNDERPOWERED_CASES);
  assert.ok(p.sentence.startsWith(`${plain.LABELS.UNDERPOWERED_CASES}: `), p.sentence);
  assert.ok(p.sentence.includes('and more answers are not expected to change that'), p.sentence);
  assert.ok(p.detail.startsWith(`${casesLine}. `), p.detail);
  assert.doesNotMatch(p.sentence, /no clear difference|no effect|helped|hurt/i);
  const dir = setDir(t, [r]);
  const d = decision.decideSet(dir, 'fx-a');
  assert.deepEqual(plain.plainOfRow(d.rows[0], r), p);
  const lead = plain.summaryLead(d, dir);
  assert.ok(lead.includes(p.sentence), lead);
  const body = plain.commentMarkdown(d, dir, { key: 'k143' });
  assert.ok(body.split('\n')[1].includes(plain.LABELS.UNDERPOWERED_CASES), body);
  assert.ok(body.includes(casesLine) && !body.includes(UNDERPOWERED_LINE), body);
});

// `driftproof view` reads only receipts that validate, so its fixtures are a tracked PASSED receipt
// of report 013 with its cases replaced, draw by draw, and sealed again (spec 128's planting method).
// The repository is read where the gate says it is (DRIFTPROOF_ARTIFACT_ROOT), else beside this file.
function validReceipt(cases, model) {
  const root = process.env.DRIFTPROOF_ARTIFACT_ROOT || path.join(__dirname, '..');
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(path.join(d, e.name));
    for (const x of listReceipts(d)) if (x.receipt) found.push(x.receipt);
  })(path.join(root, 'receipts', 'report-013'));
  const donor = found.find((r) => receiptVerdict(r).verdict === 'PASSED');
  const r = structuredClone(donor);
  const first = r.results.cases.filter((c) => c.id === r.results.cases[0].id);
  const sums = { with_skill: [], baseline: [] };
  r.results.cases = cases.flatMap(([w, b], i) => first.map((row) => {
    const c = structuredClone(row);
    const t0 = c.generation.draws[0];
    const draws = (c.mode === 'with_skill' ? w : b).map((x, j) => ({ ...t0, draw_index: j, status: 'measured', samples: [x], judge_sample_hashes: (t0.judge_sample_hashes || []).slice(0, 1), mean: x, stddev: 0, truncated: false }));
    const a = acrossDraws(draws);
    c.id = `c${i + 1}`;
    c.generation = { ...c.generation, draws, n_drawn: a.n_drawn, n_measured: a.n_measured, n_unmeasured: a.n_unmeasured, mean: a.mean, sd: a.sd, judge_sd_mean: a.judge_sd_mean, variance_ratio: a.variance_ratio, variance_ratio_unavailable: a.variance_ratio_unavailable, n_truncated: 0 };
    if (typeof c.mean === 'number') c.mean = a.mean;
    if (typeof c.score === 'number') c.score = a.mean;
    sums[c.mode].push(a.mean);
    return c;
  }));
  const avg = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
  r.suite = { ...r.suite, case_count: cases.length };
  r.run = { ...r.run, model_id: model };
  r.skill = { ...r.skill, name: 'fx-skill' };
  r.comparison = { ...r.comparison, with_skill_score: avg(sums.with_skill), baseline_score: avg(sums.baseline), delta: avg(sums.with_skill) - avg(sums.baseline) };
  const sealed = sealReceipt(r);
  const ok = validateReceipt(sealed);
  if (!ok.valid) throw new Error(`the view fixture does not validate: ${JSON.stringify(ok.errors).slice(0, 300)}`);
  return sealed;
}

test('AC-2 driftproof view counts the cases words apart and keys them', (t) => {
  const a = validReceipt(CASES, 'fx-a'); const b = validReceipt(CASE_DRAWS, 'fx-b'); const c = validReceipt(DRAWS, 'fx-c');
  assert.equal(plain.plainOf(a).words, 'UNDERPOWERED_CASES');
  assert.equal(plain.plainOf(b).words, 'UNDERPOWERED');
  // The band rung's draws kind is counted with the plain words, not the cases words (approval F-2).
  assert.equal(receiptVerdict(c).drawsNeeded.driver, 'draws');
  assert.equal(plain.plainOf(c).words, 'UNDERPOWERED');
  const dir = setDir(t, [a, b, c]);
  const { html } = renderView(dir, { now: new Date('2026-10-02T12:00:00Z') });
  assert.match(html, /data-count="UNDERPOWERED_CASES">1</);
  assert.match(html, /data-count="UNDERPOWERED">2</);
  assert.ok(html.includes(`<b>${plain.LABELS.UNDERPOWERED_CASES}</b>`), 'the key does not name the cases words');
  assert.ok(html.includes(plain.LABELS.UNDERPOWERED_CASES) && html.includes(plain.LABELS.UNDERPOWERED));
});

// The CLI badge line (spec 035 AC-9's first surface): `driftproof badge <receipt>` prints the badge JSON
// on stdout and the line and the draws line on stderr. node runs the tree's own bin; no model is called.
test('AC-2 the CLI badge line is the cases line where the cases disagree, and the plain line otherwise', (t) => {
  const { spawnSync } = require('child_process');
  const a = validReceipt(CASES, 'fx-a'); const b = validReceipt(CASE_DRAWS, 'fx-b');
  const dir = setDir(t, [a, b]);
  const run = (r) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'driftproof'), 'badge', path.join(dir, `${r.skill.name}-${r.run.model_id}-2026-10-02.json`)], { encoding: 'utf8' });
  const ca = run(a);
  assert.equal(ca.status, 0, ca.stderr);
  assert.equal(JSON.parse(ca.stdout).message, `${casesWord} on fx-a`);
  assert.ok(ca.stderr.startsWith(`${casesLine}.\n`), ca.stderr);
  assert.ok(!ca.stderr.includes(UNDERPOWERED_LINE), ca.stderr);
  const cb = run(b);
  assert.equal(cb.status, 0, cb.stderr);
  assert.ok(cb.stderr.startsWith(`${UNDERPOWERED_LINE}.\n`) && !cb.stderr.includes(casesLine), cb.stderr);
  // The band rung's draws kind (approval F-2).
  const c = validReceipt(DRAWS, 'fx-c');
  assert.equal(receiptVerdict(c).drawsNeeded.driver, 'draws');
  fs.writeFileSync(path.join(dir, `${c.skill.name}-${c.run.model_id}-2026-10-02.json`), JSON.stringify(c));
  const cc = run(c);
  assert.equal(cc.status, 0, cc.stderr);
  assert.equal(JSON.parse(cc.stdout).message, `${drawsWord} on fx-c`);
  assert.ok(cc.stderr.startsWith(`${UNDERPOWERED_LINE}.\n`) && !cc.stderr.includes(casesLine), cc.stderr);
});

// The badge door's statement (spec 035 AC-9's second surface, pre-review finding 5): the plugin's door
// runs the pinned runner through spec 028's fake npx, which maps the pin onto this runtime, and says
// the line after the badge JSON. Its copies of the words are held to lib/verdict.js's exports here.
test('AC-2 the badge door says the cases line after a more cases needed badge, and the plain line otherwise', (t) => {
  const { spawnSync } = require('child_process');
  const root = process.env.DRIFTPROOF_ARTIFACT_ROOT || path.join(__dirname, '..');
  const a = validReceipt(CASES, 'fx-a'); const b = validReceipt(CASE_DRAWS, 'fx-b');
  const dir = setDir(t, [a, b]);
  const env = { ...process.env, PATH: [path.join(root, 'specs', '028-claude-code-plugin', 'probes', 'bin'), path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), SPEC028_ROOT: path.join(__dirname, '..') };
  const run = (r) => spawnSync(process.execPath, [path.join(__dirname, '..', 'plugin', 'driftproof', 'lib', 'door.mjs'), 'badge', `${r.skill.name}-${r.run.model_id}-2026-10-02.json`], { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
  const said = (out) => out.split('\n').filter((l) => l.startsWith('[driftproof-plugin] ') && !/render$/.test(l)).map((l) => l.slice('[driftproof-plugin] '.length));
  const da = run(a);
  assert.equal(da.status, 0, da.stderr);
  assert.ok(da.stdout.includes(`"message": "${casesWord} on fx-a"`), da.stdout);
  assert.ok(said(da.stdout).includes(`${casesLine}.`), da.stdout);
  assert.ok(!da.stdout.includes(UNDERPOWERED_LINE), da.stdout);
  const db = run(b);
  assert.equal(db.status, 0, db.stderr);
  assert.ok(said(db.stdout).includes(`${UNDERPOWERED_LINE}.`) && !db.stdout.includes(casesLine), db.stdout);
  // The band rung's draws kind (approval F-2).
  const c = validReceipt(DRAWS, 'fx-c');
  assert.equal(receiptVerdict(c).drawsNeeded.driver, 'draws');
  fs.writeFileSync(path.join(dir, `${c.skill.name}-${c.run.model_id}-2026-10-02.json`), JSON.stringify(c));
  const dc = run(c);
  assert.equal(dc.status, 0, dc.stderr);
  assert.ok(dc.stdout.includes(`"message": "${drawsWord} on fx-c"`), dc.stdout);
  assert.ok(said(dc.stdout).includes(`${UNDERPOWERED_LINE}.`) && !dc.stdout.includes(casesLine), dc.stdout);
});

test('AC-2 the receipt page\'s label and honest line are the cases words', () => {
  const v = receiptVerdict(receipt(CASES));
  assert.equal(pages.pageLabel(v), `${casesWord.charAt(0).toUpperCase()}${casesWord.slice(1)}`);
  assert.equal(pages.honestLine(v), `${casesLine}.`);
  assert.ok(!pages.honestLine(v).includes(UNDERPOWERED_LINE));
});

// The receipt page as the builder renders it, and each card's label (approval F-1): page() and
// cardLabels(), not only the helpers they call, for the cases kind and for every other reading.
test('AC-2 the receipt page the builder renders, and its card, carry the cases label and line, and every other reading the Base\'s', () => {
  const field = (html, f) => (new RegExp(`data-field="${f}">([^<]*)<`).exec(html) || [])[1];
  // The page names the model by its human name, so the fixtures carry a model id scripts/model-names.js
  // names; each fixture's receipt_hash is its own.
  const model = 'claude-sonnet-5-5';
  const render = (r) => pages.page({ rel: `receipts/fx/${r.skill.name}-${r.run.model_id}-2026-10-02.json`, receipt: r }).html;
  const cases = receipt(CASES, { model });
  const html = render(cases);
  assert.equal(field(html, 'label'), pages.CASES_PAGE[0]);
  assert.equal(field(html, 'honest'), `${casesLine}.`);
  assert.ok(html.includes(`driftproof badge: ${pages.CASES_PAGE[0].toLowerCase()} on ${model}`), 'the badge alt text does not carry the cases label');
  assert.ok(!html.includes(UNDERPOWERED_LINE) && !html.includes(pages.LABELS.UNDERPOWERED[0]), 'the cases page carries the plain words');
  const others = Object.entries({ DRAWS, CASE_DRAWS, CASE_SPREAD, LOSTCASE }).map(([name, shape]) => [name, receipt(shape, { model })]);
  for (const [name, r] of others) {
    const h = render(r);
    assert.equal(field(h, 'label'), pages.LABELS.UNDERPOWERED[0], name);
    assert.equal(field(h, 'honest'), pages.LABELS.UNDERPOWERED[1], name);
    assert.ok(!h.includes(casesLine) && !h.includes(pages.CASES_PAGE[0]), `${name} carries the cases words`);
  }
  const labels = pages.cardLabels([cases, ...others.map(([, r]) => r)].map((r) => ({ receipt: r })));
  assert.equal(labels.size, 5);
  assert.equal(labels.get(cases.receipt_hash), pages.CASES_PAGE[0]);
  for (const [name, r] of others) assert.equal(labels.get(r.receipt_hash), pages.LABELS.UNDERPOWERED[0], name);
});

// The site's two readers of a receipt's words (lane 117 finding 4): the homepage's receiptWords, which
// pairs the page's label with its honest line, and the answer pages' meaningOf, which reads the plain
// label. Each is required here, inside its test, so a runtime without it fails this test alone.
test('AC-2 the homepage\'s receipt words pair the page\'s own label with its honest line', () => {
  const { receiptWords } = require('../scripts/build-site-pages');
  const cases = receipt(CASES); const v = receiptVerdict(cases);
  assert.deepEqual(receiptWords(cases), { verdict: 'UNDERPOWERED', label: pages.pageLabel(v), honest: `${casesLine}.` });
  assert.notEqual(receiptWords(cases).label, pages.LABELS.UNDERPOWERED[0]);
  // Every other reading, the band rung's draws kind among them (approval F-2).
  for (const shape of [DRAWS, CASE_DRAWS, CASE_SPREAD, LOSTCASE]) {
    assert.deepEqual(receiptWords(receipt(shape)), { verdict: 'UNDERPOWERED', label: pages.LABELS.UNDERPOWERED[0], honest: pages.LABELS.UNDERPOWERED[1] });
  }
});

// The homepage's *What a receipt can say* list (pre-review finding 4): its cases item carries the
// page's label and the cases line, read from the constants, in the page the builder writes.
test('AC-2 the homepage\'s list of what a receipt can say carries the cases word and line', () => {
  const site = require('../scripts/build-site-pages');
  const label = `${casesWord.charAt(0).toUpperCase()}${casesWord.slice(1)}`;
  assert.ok(site.casesItem().startsWith(`<li><strong>${label}.</strong> ${casesLine}. `), site.casesItem());
  const home = site.homepage();
  assert.ok(home.includes(site.casesItem()), 'the homepage does not carry the cases item');
  assert.ok(home.includes(`<strong>${label}.</strong> ${casesLine}.`), 'the homepage does not carry the cases word and line');
});

test('AC-2 the answer pages\' meaning reads the result\'s own plain label', () => {
  const { meaningOf } = require('../scripts/report-answers');
  assert.equal(meaningOf(receipt(CASES)), `there were ${plain.LABELS.UNDERPOWERED_CASES.toLowerCase()}`);
  for (const shape of [DRAWS, CASE_DRAWS, CASE_SPREAD]) assert.equal(meaningOf(receipt(shape)), `there were ${plain.LABELS.UNDERPOWERED.toLowerCase()}`);
});

test('AC-2 every other UNDERPOWERED reading keeps the Base\'s words on the badge, the SVG, the plain words, the page\'s helpers, the summary row and the set badge', (t) => {
  for (const [name, shape] of Object.entries({ DRAWS, CASE_DRAWS, CASE_SPREAD, LOSTCASE })) {
    const r = receipt(shape, { model: `fx-${name.toLowerCase()}` });
    const v = receiptVerdict(r);
    assert.equal(v.verdict, 'UNDERPOWERED', name);
    assert.equal(verdictFromReceipt(r).message, `${drawsWord} on fx-${name.toLowerCase()}`, name);
    const svg = badgeSvg(r);
    assert.ok(svg.includes(`>${pages.LABELS.UNDERPOWERED[0].toLowerCase()}</text>`) && !svg.includes(casesWord), `${name}: ${svg.slice(0, 200)}`);
    const p = plain.plainOf(r);
    assert.equal(p.label, plain.LABELS.UNDERPOWERED, name);
    assert.ok(p.detail.startsWith(`${UNDERPOWERED_LINE}.`) && !p.detail.includes(casesLine), `${name}: ${p.detail}`);
    assert.equal(pages.pageLabel(v), pages.LABELS.UNDERPOWERED[0], name);
    assert.equal(pages.honestLine(v), pages.LABELS.UNDERPOWERED[1], name);
    const dir = setDir(t, [r]);
    const d = decision.decideSet(dir, `fx-${name.toLowerCase()}`, { failOnUnderpowered: true });
    assert.ok(decision.summaryMarkdown(d).includes(UNDERPOWERED_LINE) && !decision.summaryMarkdown(d).includes(casesLine), name);
    assert.equal(decision.badgeEndpointForSet(d).message, `${drawsWord} on fx-${name.toLowerCase()}`, name);
  }
  const v = receiptVerdict(receipt(DRAWS));
  assert.ok(plain.plainOf(receipt(DRAWS)).sentence.includes('but the scores varied too much from answer to answer to call it'));
  assert.match(drawsLine(v.drawsNeeded), /^Draws needed: no count at this band \(.*so more draws are expected to narrow the band\)\.$/);
});

// The other readings through decide's ::error line and outputs, the job summary lead and the pull
// request comment (approval F-2): a surface that typed the cases line for every row reads here.
test('AC-2 every other UNDERPOWERED reading keeps the Base\'s words through decide\'s ::error line and outputs, the summary lead and the comment', (t) => {
  for (const [name, shape] of Object.entries({ DRAWS, CASE_DRAWS, CASE_SPREAD, LOSTCASE })) {
    const model = `fx-${name.toLowerCase()}`;
    const r = receipt(shape, { model });
    const dir = setDir(t, [r]);
    const opts = { failOnRegression: true, failOnUnderpowered: true };
    const d = decision.decideSet(dir, model, opts);
    assert.equal(d.rows[0].state, 'underpowered', name);
    const errors = decision.enforcementLines(d, opts).filter((l) => l.startsWith('::error'));
    assert.equal(errors.length, 1, name);
    assert.ok(errors[0].includes(`${model}: underpowered - ${UNDERPOWERED_LINE}.`) && !errors[0].includes(casesLine), `${name}: ${errors[0]}`);
    const out = decision.githubOutputLines(d);
    assert.match(out, /\nUNDERPOWERED\n/, name);
    assert.ok(out.includes(`\n${drawsWord} on ${model}\n`) && !out.includes(casesWord) && !out.includes(casesLine), `${name}: ${out}`);
    const p = plain.plainOf(r);
    assert.equal(p.words, 'UNDERPOWERED', name);
    const lead = plain.summaryLead(d, dir);
    assert.ok(lead.includes(p.sentence) && !lead.includes(plain.LABELS.UNDERPOWERED_CASES) && !lead.includes(casesLine), `${name}: ${lead}`);
    const body = plain.commentMarkdown(d, dir, { key: 'k143' });
    assert.ok(body.split('\n')[1].includes(plain.LABELS.UNDERPOWERED), `${name}: ${body}`);
    assert.ok(body.includes(UNDERPOWERED_LINE) && !body.includes(casesLine) && !body.includes(plain.LABELS.UNDERPOWERED_CASES), `${name}: ${body}`);
  }
});

test('AC-3 the cases line and word read exactly as spec 143 says, beside spec 035\'s plain line', () => {
  assert.equal(verdict.CASES_LINE, 'More cases, not more draws, are needed to conclude at this effect floor');
  assert.equal(verdict.CASES_WORD, 'more cases needed');
  assert.equal(UNDERPOWERED_LINE, 'Not enough draws to conclude at this effect floor');
  assert.equal(VERDICTS.UNDERPOWERED.word, 'not enough draws');
});

test('AC-3 the words are read from one place: each helper returns the exported constants', () => {
  const cases = receiptVerdict(receipt(CASES)).drawsNeeded;
  const draws = receiptVerdict(receipt(DRAWS)).drawsNeeded;
  assert.equal(verdict.underpoweredLine(cases), verdict.CASES_LINE);
  assert.equal(verdict.underpoweredWord(cases), verdict.CASES_WORD);
  assert.equal(verdict.underpoweredLine(draws), UNDERPOWERED_LINE);
  assert.equal(verdict.underpoweredWord(draws), VERDICTS.UNDERPOWERED.word);
  assert.equal(verdict.underpoweredLine(null), UNDERPOWERED_LINE);
  assert.equal(verdict.casesDisagree(cases), true);
  assert.equal(verdict.casesDisagree(draws), false);
});
