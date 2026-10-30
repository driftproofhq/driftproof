// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 207, spec 190. Receipt-only plants and independent arithmetic.
// Run one file: nice -n 10 timeout 1800s node --test tests/lift-breakdown.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Only the preservation harness may launch guarded CLI children. Product subprocess calls stay trapped.
const harnessExec = { execFile: require('node:child_process').execFileSync, spawn: require('node:child_process').spawnSync };
// Install call traps before loading product modules, including their destructured imports.
let externalCalls = 0;
const restoreCalls = [];
const guardedCalls = [];
const rejectCall = () => { externalCalls++; throw new Error('receipt-only violation'); };
function guardCall(obj, key) {
  const original = obj[key]; obj[key] = rejectCall;
  guardedCalls.push(() => obj[key]());
  restoreCalls.push(() => { obj[key] = original; });
}
for (const module of ['node:http', 'node:https']) for (const key of ['request', 'get']) guardCall(require(module), key);
guardCall(require('node:net'), 'connect'); guardCall(globalThis, 'fetch');
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) guardCall(require('node:child_process'), key);
guardCall(require('../lib/provider'), 'complete');
test.after(() => { for (const restore of restoreCalls.reverse()) restore(); });

const P = '../specs/190-issue-207-lift-breakdown/probes/';
const { fixture, variants, corpus, wordingPlants } = require(P + 'plants.cjs');
const O = require(P + 'oracle.cjs');
const { capture } = require(P + 'baseline.cjs');
const { validateReceipt, verifyReceiptHash, sealReceipt } = require('../lib/receipt');
const { EFFECT_FLOOR, POWER_Z } = require('../config');
const view = require('../lib/view');
const { buildDriftReport: defaultDriftReport } = require('../lib/diff');
const buildDriftReport = (a, b, opts = {}) => defaultDriftReport(a, b, { ...opts, includeLiftBreakdown: true });
const D = require(P + 'default-diff.cjs');
const { receiptVerdict } = require('../lib/verdict');
const BEFORE = require(P + 'before-build.json');
const V = variants();
const CORPUS = corpus();
const LINE = 'Not enough draws to conclude at this effect floor';

function breakdown(r) {
  assert.equal(typeof view.liftBreakdown, 'function', 'AC-1: receipt-only liftBreakdown is not implemented');
  return view.liftBreakdown(r);
}
// One folder read by each renderer in turn, so a path in the staleness text is the same for all.
function pages(r, ...renderers) {
  const dir = fs.mkdtempSync(path.join('/var/tmp', 'spec190-view-'));
  try {
    const file = path.join(dir, 'receipt.json');
    const bytes = JSON.stringify(r);
    fs.writeFileSync(file, bytes);
    return renderers.map(renderView => {
      const html = renderView(dir, { label: 'fixture', now: new Date(r.run.date_utc || V.normal.run.date_utc), stale: { noHarnessCheck: true } }).html;
      assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'receipt file changed');
      assert.ok(html, 'view emitted no page');
      return html;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const render = r => pages(r, view.renderView)[0];
// A-190-16 (PR 271 F-1): schema-valid receipts over each breakdown limit, with the reason each must name.
function overLimit() {
  const cases = fixture(Array.from({ length: 129 }, (_, i) => ['c' + i, [0.6, 0.6], [0.5, 0.5]]));
  const draws = fixture([['draws', Array(65).fill(0.6), [0.5, 0.5]], ['other', [0.5, 0.5], [0.5, 0.5]]]);
  const string = fixture(); string.results.cases[0].reason = 's'.repeat(4097); sealReceipt(string);
  return [['case rows', 256, cases], ['draws per arm', 64, draws], ['string bytes', 4096, string]].map(([limit, max, receipt]) => {
    assert.ok(validateReceipt(receipt).valid, limit + ': ' + JSON.stringify(validateReceipt(receipt).errors));
    assert.ok(verifyReceiptHash(receipt), limit);
    assert.throws(() => view.assertLiftLimits(receipt), { code: 'LIFT_LIMIT' }, limit + ': plant is within the limits');
    return { limit, receipt, reason: 'Lift breakdown limit: ' + limit + ' exceeds ' + max + '.' };
  });
}
const LIFT_SECTION = /<section data-field="lift-breakdown">[\s\S]*?<\/section>/g;
const pageBody = html => /<main class="wrap">[\s\S]*<\/main>/.exec(html)[0];
// The page body dev renders, and this branch's with its one lift section per sheet taken out, are byte-identical.
function preservedView(h, r) {
  const [html, base] = pages(r, view.renderView, h.baseView);
  for (const [name, re] of [['label', /<span class="stamp[^>]*data-field="label">[^<]*<\/span>/], ['bands', /<div class="band">[\s\S]*?<\/div>\n<p class="basis">/],
    ['band figures', /<span class="k">With \/ without<\/span><span class="v">[^<]*<\/span>/], ['staleness', /<span class="v stale"[^>]*>[^<]*<\/span>/]]) {
    assert.ok(re.exec(base), name + ': missing from dev rendering');
    assert.equal((re.exec(html) || [])[0], re.exec(base)[0], name + ': differs from dev rendering');
  }
  assert.equal((html.match(LIFT_SECTION) || []).length, (base.match(/<article class="sheet" data-file=[^>]*data-state="(?!ERROR)/g) || []).length, 'one lift section per dev sheet');
  // A-190-19 (issue 439): spec 077's Token cost row follows the lift section. It is read here against spec
  // 077's oracle, once where that reading shows a cost and never where it does not, and set aside with it.
  const want = cost077(r);
  assert.deepEqual((html.match(TOKEN_ROW) || []).map((x) => x.replace(/^[\s\S]*data-field="token-cost">|<\/span><\/div>\n$/g, '')), want === null ? [] : [escView(want)], 'spec 077 token cost row');
  assert.equal(pageBody(html).replace(LIFT_SECTION, '').replace(TOKEN_ROW, ''), pageBody(base), 'page body differs from dev rendering');
  return html;
}
const TOKEN_ROW = /<div class="row"><span class="k">Token cost<\/span><span class="v" data-field="token-cost">[^<]*<\/span><\/div>\n/g;
const escView = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function cost077(r) {
  const C077 = require('../specs/077-cost-next-to-lift/reading.js');
  let sealed = false; try { sealed = require('../lib/receipt').verifyReceiptHash(r); } catch { sealed = false; }
  let router = false; try { router = !!require('../lib/report-015-publication').routerLimit(r); } catch { router = 'throws'; }
  const e = C077.expected(r, { sealed, router });
  return e.shown ? e.figure : null;
}
// The original diff fields, with the opted-in sections taken off, equal dev's.
function preservedReport(h, a, b, opts = {}) {
  const report = buildDriftReport(a, b, opts);
  const old = { ...report }; delete old.liftBreakdown;
  old.markdown = old.markdown.split('\n## Lift breakdown:')[0];
  D.same(old, h.baseReport(a, b, opts));
  return report;
}
function evidence(r) {
  const e = O.arithmetic(r);
  return {
    ...e, receiptHash: r.receipt_hash,
    excluded: e.rows.filter(c => c.excluded).map(c => ({ id: c.id, reason: 'failed arm' })),
    rows: e.rows.map(c => ({ ...c, state: 'unavailable', carriesLift: null })),
    hurtCases: [],
  };
}
function htmlControl(r) {
  const cell = (key, value) => '<td data-lift-value="' + key + '">' + value + '</td>';
  const rows = O.expected(r).rows.map(row => {
    const cells = [['with', row.withSkill], ['baseline', row.baseline]].flatMap(([prefix, a]) =>
      ['mean', 'sd', 'n', 'drawn', 'lost'].map(k => cell(prefix + '-' + k, !a || a[k] == null ? 'n/a' : ['mean', 'sd'].includes(k) ? a[k].toFixed(3) : a[k])));
    cells.push(cell('delta', row.delta == null ? 'n/a' : row.delta.toFixed(3)), cell('leave-lift', row.leaveOneOut ? row.leaveOneOut.lift.toFixed(3) : 'n/a'), cell('state', O.STATES[row.state]), cell('carrier', O.carrierText(row.carriesLift)), cell('reason', row.reason));
    return '<tr data-lift-case="' + row.id + '"><th>' + row.id + '</th>' + cells.join('') + '</tr>';
  });
  return '<section data-field="lift-breakdown"><table>' + rows.join('') + '</table><p data-lift-hurts>Downward cases: ' + (O.expected(r).hurtCases.join(', ') || 'none') + '.</p></section>';
}
function markdownControl(r, label = 'A') {
  const header = '| case | with mean | with spread | baseline mean | baseline spread | difference | with measured | with drawn | with lost | baseline measured | baseline drawn | baseline lost | state | lift without case | carries lift | reason |';
  const f = n => n == null ? 'n/a' : n.toFixed(3);
  const rows = O.expected(r).rows.map(c => {
    const w = c.withSkill; const b = c.baseline;
    return '| ' + [c.id, f(w && w.mean), f(w && w.sd), f(b && b.mean), f(b && b.sd), f(c.delta),
      ...[w && w.n, w && w.drawn, w && w.lost, b && b.n, b && b.drawn, b && b.lost].map(n => n == null ? 'n/a' : n),
      O.STATES[c.state], f(c.leaveOneOut && c.leaveOneOut.lift), O.carrierText(c.carriesLift), c.reason].join(' | ') + ' |';
  });
  return '\n## Lift breakdown: ' + label + '\n' + header + '\n' + rows.join('\n') + '\nDownward cases: ' + (O.expected(r).hurtCases.join(', ') || 'none') + '.';
}
function check(a, r) {
  O.checkNumbers(a, r);
  O.checkCarriers(a, r);
  O.checkState(a, r, EFFECT_FLOOR, POWER_Z);
}
function immutable(r, fn) {
  const bytes = JSON.stringify(r);
  const verdict = JSON.stringify(receiptVerdict(r));
  const result = fn();
  assert.equal(JSON.stringify(r), bytes, 'AC-6: input mutated');
  assert.equal(JSON.stringify(receiptVerdict(r)), verdict, 'AC-6: verdict changed');
  assert.ok(verifyReceiptHash(r), 'AC-6: hash changed');
  return result;
}
const caveatControl = 'Recorded draw scores. Sample spread. Each case has equal weight. Removing a case is a descriptive calculation.';

test('controls: all synthetic evidence is schema-valid and sealed; oracle uses draw scores', () => {
  for (const [name, r] of [...Object.entries(V), ...CORPUS.map((r, i) => ['seed-' + i, r])]) {
    assert.ok(validateReceipt(r).valid, name + ': ' + JSON.stringify(validateReceipt(r).errors));
    assert.ok(verifyReceiptHash(r), name);
    O.checkNumbers(evidence(r), r);
  }
  assert.equal(O.arithmetic(V.normal).lift, 0.1);
  assert.equal(O.arithmetic(V.normal).rows.find(c => c.id === 'driver').leaveOneOut.lift, -0.15);
  assert.equal(O.arithmetic(V.missing).lift, null);
  assert.equal(O.arithmetic(V.one).rows[0].leaveOneOut, null);
});

test('controls AC-1 to AC-3: each wrong figure, pairing, count and coverage plant reads red', () => {
  const mutations = {
    'M-1 cached suite score': a => { a.lift = V.cached.comparison.delta; },
    'M-2 omitted case hidden': a => { a.rows.pop(); },
    'M-3 wrong case identity': a => { a.rows[0].id = 'other'; },
    'M-4 arm swapping': a => { [a.rows[0].withSkill, a.rows[0].baseline] = [a.rows[0].baseline, a.rows[0].withSkill]; },
    'M-5 wrong spread': a => { a.rows[0].withSkill.sd = 0.123; },
    'M-6 judge samples counted as answers': a => { a.rows[0].withSkill.n *= 3; },
    'M-7 lost count ignored': a => { a.rows[0].withSkill.lost++; },
    'M-8 drawn count invented': a => { a.rows[0].baseline.drawn++; },
    'M-9 one arm omitted': a => { a.rows[0].leaveOneOut.lift = 0.4; },
    'M-10 cached case difference': a => { a.rows[1].delta = 0.9; },
    'M-11 pooled draws': a => { a.lift = 0.2; },
    'M-12 receipt identity omitted': a => { delete a.receiptHash; },
    'M-13 included count wrong': a => { a.includedCount++; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const a = evidence(V.normal); mutate(a);
    assert.throws(() => O.checkNumbers(a, V.normal), { name: 'AssertionError' }, name);
  }
  const loss = evidence(V.lost); loss.rows[0].withSkill.mean = 0.4;
  assert.throws(() => O.checkNumbers(loss, V.lost), { name: 'AssertionError' }, 'M-14 zero-filled loss');
  const failed = evidence(V.failed); failed.excluded = [];
  assert.throws(() => O.checkNumbers(failed, V.failed), { name: 'AssertionError' }, 'M-15 failed arm kept');
  const legacy = evidence(V.legacy); legacy.lift = V.legacy.comparison.delta;
  assert.throws(() => O.checkNumbers(legacy, V.legacy), { name: 'AssertionError' }, 'M-16 legacy samples invented as draws');
  const missing = evidence(V.missing); missing.lift = 0.1;
  assert.throws(() => O.checkNumbers(missing, V.missing), { name: 'AssertionError' }, 'M-17 incomplete evidence narrowed');
});

test('controls AC-4 and AC-5: reversed state, omitted hurt and wrong carrier plants read red', () => {
  const a = evidence(V.normal);
  a.rows.forEach(c => { c.state = c.id === 'driver' ? 'helps' : c.id === 'hurt' ? 'hurts' : 'no-separation'; c.carriesLift = c.id === 'driver'; });
  a.hurtCases = ['hurt'];
  O.checkState(a, V.normal, EFFECT_FLOOR, POWER_Z); O.checkCarriers(a, V.normal);
  for (const mutate of [
    b => { b.rows[0].state = 'hurts'; }, b => { b.hurtCases = []; },
  ]) {
    const b = structuredClone(a); mutate(b);
    assert.throws(() => O.checkState(b, V.normal, EFFECT_FLOOR, POWER_Z), { name: 'AssertionError' });
  }
  const carrier = structuredClone(a); carrier.rows[0].carriesLift = false;
  assert.throws(() => O.checkCarriers(carrier, V.normal), { name: 'AssertionError' }, 'M-18 dominant case missed');
  const zero = evidence(V.zero); zero.rows.forEach(c => { c.carriesLift = false; });
  O.checkCarriers(zero, V.zero); zero.rows[0].carriesLift = true;
  assert.throws(() => O.checkCarriers(zero, V.zero), { name: 'AssertionError' }, 'M-19 zero full lift called carried');
  const wide = evidence(V.wide); wide.rows[0].state = 'underpowered'; O.checkState(wide, V.wide, EFFECT_FLOOR, POWER_Z);
  wide.rows[0].state = 'no-separation';
  assert.throws(() => O.checkState(wide, V.wide, EFFECT_FLOOR, POWER_Z), { name: 'AssertionError' }, 'M-20 wide case called resolved');
});

test('controls AC-7: visible HTML and Markdown readers reject wrong or absent sections and figures', () => {
  const html = htmlControl(V.normal); O.visibleRows(html, V.normal);
  for (const mutant of [
    html.replace('data-field="lift-breakdown"', 'data-field="other"'),
    html.replace('data-lift-case="driver"', 'data-lift-case="hidden"'),
    html.replace('data-lift-value="delta">0.600', 'data-lift-value="delta">0.999'),
    html.replace('data-lift-value="with-n">3', 'data-lift-value="with-n">9'),
    html.replace('data-lift-value="leave-lift">-0.150', 'data-lift-value="leave-lift">0.999'),
  ]) assert.throws(() => O.visibleRows(mutant, V.normal), { name: 'AssertionError' });
  const md = markdownControl(V.normal); O.markdownRows(md, V.normal, 'A');
  for (const mutant of [md.replace('Lift breakdown: A', 'Lift breakdown: B'), md.replace('0.600', '0.999'), md.replace('-0.150', '0.999')])
    assert.throws(() => O.markdownRows(mutant, V.normal, 'A'), { name: 'AssertionError' });
});

test('controls AC-6 and AC-8: baseline and wording readers see planted changes', () => {
  assert.deepEqual(capture(), BEFORE);
  const changed = structuredClone(BEFORE); changed.report.headlineDelta = 0.99;
  assert.throws(() => assert.deepEqual(capture(), changed), { name: 'AssertionError' });
  changed.view.fields[0][1] = 'altered result';
  assert.throws(() => assert.deepEqual(capture().view, changed.view), { name: 'AssertionError' });
  O.words(caveatControl);
  for (const phrase of ['recorded draw scores', 'sample spread', 'equal weight', 'removing']) {
    assert.throws(() => O.words(caveatControl.replace(new RegExp(phrase, 'i'), '')), { name: 'AssertionError' });
  }
  for (const phrase of wordingPlants) {
    assert.throws(() => O.words(caveatControl + phrase), { name: 'AssertionError' });
  }
});

test('AC-1: shared receipt-only helper exists and rejects unsealed and invalid evidence', () => {
  const tampered = structuredClone(V.normal); tampered.results.cases[0].generation.draws[0].mean = 0.1;
  assert.equal(typeof view.liftBreakdown, 'function', 'shared breakdown helper missing');
  assert.throws(() => view.liftBreakdown(tampered), /hash|seal|invalid|receipt/i);
  const bad = structuredClone(V.normal); bad.schema_version = 'unknown'; sealReceipt(bad);
  assert.throws(() => view.liftBreakdown(bad), /schema|invalid|receipt/i);
  for (const r of [tampered, bad]) assert.doesNotMatch(render(r), /data-field="lift-breakdown"/);
});

test('AC-1 and AC-6: no provider, network, subprocess or receipt mutation on either product path', () => {
  for (const r of [V.normal, V.lost, V.cached]) {
    immutable(r, () => check(breakdown(r), r));
    immutable(r, () => render(r));
    immutable(r, () => buildDriftReport(r, V.shared));
  }
  assert.equal(externalCalls, 0, 'an external call path ran');
});

test('AC-1 to AC-3: independent figures over all plants and a seeded unequal-draw corpus', () => {
  for (const r of [...Object.values(V), ...CORPUS]) immutable(r, () => check(breakdown(r), r));
  assert.equal(breakdown(V.cached).lift, breakdown(V.normal).lift, 'cached headline used');
  const reordered = structuredClone(V.shuffle);
  for (const c of reordered.results.cases) c.generation.draws.reverse();
  sealReceipt(reordered);
  check(breakdown(reordered), reordered);
});

test('AC-2: duplicate identities are refused on the shared and rendered paths', () => {
  const r = structuredClone(V.normal); r.results.cases.push(structuredClone(r.results.cases[0])); sealReceipt(r);
  assert.equal(typeof view.liftBreakdown, 'function');
  assert.throws(() => view.liftBreakdown(r), /duplicate|ambiguous|receipt/i);
  assert.doesNotMatch(render(r), /data-field="lift-breakdown"/);
  assert.throws(() => buildDriftReport(r, V.normal), /duplicate|ambiguous|receipt/i);
});

test('AC-2 and AC-3: no fabricated evidence for missing arms, legacy, all-lost or malformed draws', () => {
  for (const r of [V.missing, V.absent, V.legacy]) {
    const a = breakdown(r); O.checkNumbers(a, r); assert.equal(a.lift, null);
    assert.ok(a.rows.every(c => c.leaveOneOut === null && c.carriesLift === null));
  }
  const r = fixture();
  r.results.cases[0].generation.n_drawn++; sealReceipt(r);
  assert.throws(() => breakdown(r), /draw|count|contradict/i);
  for (const value of [null, 1.1]) {
    const bad = fixture(); bad.results.cases[0].generation.draws[0].mean = value; sealReceipt(bad);
    if (!validateReceipt(bad).valid) assert.throws(() => breakdown(bad), /schema|invalid|receipt/i);
    else { const a = breakdown(bad); O.checkNumbers(a, bad); assert.equal(a.lift, null); }
  }
  const allLost = fixture();
  const g = allLost.results.cases[0].generation;
  g.draws = g.draws.map(d => ({ ...d, status: 'unmeasured', mean: null, stddev: null, samples: [], generation_hash: null, reason: 'timeout' }));
  g.n_measured = 0; g.n_unmeasured = g.draws.length; sealReceipt(allLost);
  assert.ok(validateReceipt(allLost).valid, 'all-lost plant must be schema-valid');
  const a = breakdown(allLost); O.checkNumbers(a, allLost); assert.equal(a.lift, null);
});

test('AC-3: draw means are answers, judge samples are not extra answers or weights', () => {
  const r = fixture();
  r.results.cases[0].generation.draws[0].samples = [0.1, 0.1, 0.1, 0.1, 0.1];
  sealReceipt(r);
  const a = breakdown(r);
  O.checkNumbers(a, r); assert.equal(a.rows[0].withSkill.n, 3);
  assert.equal(a.rows[0].withSkill.mean, 0.9);
  assert.equal(a.lift, 0.1);
});

test('AC-4: every inclusive floor step, one place below, and both directions', () => {
  for (let i = 0; i < 20; i++) for (const direction of [1, -1]) {
    const low = i / 20; const high = (i + 1) / 20;
    const b = direction === 1 ? low : high;
    const w = direction === 1 ? high : low;
    const exact = fixture([['edge', [w, w], [b, b]]]);
    check(breakdown(exact), exact);
    assert.equal(breakdown(exact).rows[0].state, direction === 1 ? 'helps' : 'hurts');
    const near = O.six(w - direction * 0.000001);
    const under = fixture([['edge', [near, near], [b, b]]]);
    check(breakdown(under), under);
    assert.equal(breakdown(under).rows[0].state, 'no-separation');
  }
});

test('AC-4: overlap, touching, wide spreads and single draws do not claim separation', () => {
  const touch = fixture([['touch', [0.637132, 0.787132], [0.425, 0.575]]]);
  check(breakdown(touch), touch);
  assert.equal(breakdown(touch).rows[0].state, 'underpowered');
  for (const r of [V.wide, V.singleDraw]) {
    check(breakdown(r), r); assert.equal(breakdown(r).rows[0].state, 'underpowered');
    const section = O.visibleRows(render(r), r); assert.ok(O.textOf(section).includes(LINE));
    const report = buildDriftReport(r, r);
    const sectionMd = O.markdownRows(report.markdown, r, 'A'); assert.ok(sectionMd.includes(LINE));
  }
  assert.equal(breakdown(V.singleDraw).rows[0].withSkill.sd, null);
});

test('AC-4: every valid refusal suppresses labels, carriers and downward-case assertions', () => {
  const refused = [];
  for (const change of [
    r => { r.verification_level = 'DECLARED'; },
    r => { r.verification_level = 'DECLARED'; r.run.answered_by.kind = 'stub'; },
    r => { r.verification_level = 'DECLARED'; r.run.preset = 'quick'; },
    r => { r.run.status = 'incomplete'; },
    r => { r.suite.case_count++; },
  ]) { const r = fixture(); change(r); sealReceipt(r); refused.push(r); }
  for (const r of refused) {
    assert.ok(validateReceipt(r).valid, JSON.stringify(validateReceipt(r).errors));
    const a = breakdown(r); check(a, r);
    assert.ok(a.rows.every(c => c.state === 'unavailable' && c.carriesLift === null));
    assert.deepEqual(a.hurtCases, []);
    const text = O.textOf(O.visibleRows(render(r), r));
    assert.doesNotMatch(text, /\bhelps\b|\bhurts\b|leaves no positive measured lift/i);
    const md = O.markdownRows(buildDriftReport(r, r).markdown, r, 'A');
    assert.doesNotMatch(md, /\bhelps\b|\bhurts\b|leaves no positive measured lift/i);
  }
});

test('AC-4: lost draws cannot create a helps claim or a carrier by being dropped', () => {
  const a = breakdown(V.lost); O.checkNumbers(a, V.lost); O.checkCarriers(a, V.lost);
  assert.equal(a.rows.find(c => c.id === 'loss').state, 'inconclusive');
  assert.ok(a.rows.every(c => c.carriesLift === null));
  assert.deepEqual(a.hurtCases, []);
  for (const text of [O.textOf(O.visibleRows(render(V.lost), V.lost)), O.markdownRows(buildDriftReport(V.lost, V.lost).markdown, V.lost, 'A')]) {
    assert.match(text, /lost|unmeasured/i); assert.match(text, /inconclusive/i);
  }
});

test('AC-5: dominant, shared, zero, negative, zero-omission and single-case lift', () => {
  for (const r of [V.normal, V.shared, V.zero, V.negative, V.zeroOmission, V.one]) {
    const a = breakdown(r); O.checkNumbers(a, r); O.checkCarriers(a, r);
  }
  assert.equal(breakdown(V.normal).rows.find(c => c.id === 'driver').carriesLift, true);
  assert.ok(breakdown(V.shared).rows.every(c => c.carriesLift === false));
  assert.ok(breakdown(V.zero).rows.every(c => c.carriesLift === false));
  assert.ok(breakdown(V.negative).rows.every(c => c.carriesLift === false));
  assert.equal(breakdown(V.zeroOmission).rows.find(c => c.id === 'only-positive').carriesLift, true);
  assert.equal(breakdown(V.one).rows[0].leaveOneOut, null);
  assert.equal(breakdown(V.one).rows[0].carriesLift, null);
});

test('AC-6: existing verdict, diff fields, Markdown and view numbers equal the before-build record', () => {
  assert.deepEqual(capture(), BEFORE);
  const report = buildDriftReport(V.normal, V.normal);
  assert.ok(report.liftBreakdown, 'new breakdown not returned');
  const old = { ...report }; delete old.liftBreakdown;
  old.markdown = old.markdown.split('\n## Lift breakdown:')[0];
  assert.deepEqual(old, BEFORE.report);
  const html = render(V.normal);
  assert.deepEqual(O.oldView(html), BEFORE.view);
  O.visibleRows(html, V.normal);
  // A-190-16 (PR 271 F-1): beyond V.normal, dev's own renderer and report hold the over-limit receipts.
  const h = D.harness(harnessExec);
  try {
    for (const r of [V.normal, ...overLimit().map(o => o.receipt)]) { preservedView(h, r); preservedReport(h, r, V.normal); }
  } finally { h.close(); }
});

test('AC-6, AC-7 and AC-16 (A-190-16): a receipt over a breakdown limit keeps dev\'s sheet; only its lift section is unavailable', () => {
  const h = D.harness(harnessExec);
  try {
    for (const { limit, receipt, reason } of overLimit()) {
      const html = preservedView(h, receipt);
      assert.match(html, /<article class="sheet" data-file="receipt\.json" data-state="(?!ERROR)/, limit + ': sheet dropped');
      assert.doesNotMatch(html, /class="unread"/, limit + ': receipt listed as not read');
      const sections = html.match(LIFT_SECTION);
      assert.equal(sections.length, 1, limit);
      assert.equal(O.textOf(sections[0]), 'Lift by caseLift breakdown unavailable: ' + reason, limit + ': unavailable reason');
      assert.doesNotMatch(sections[0], /data-lift-case/, limit + ': partial figures shown');
    }
  } finally { h.close(); }
});

test('AC-6, AC-7 and AC-16 (A-190-16): diff --lift-breakdown over a receipt past a limit keeps every original field and section', () => {
  const h = D.harness(harnessExec);
  try {
    const other = structuredClone(V.normal); other.skill.content_hash = 'b'.repeat(64); sealReceipt(other);
    for (const { limit, receipt, reason } of overLimit()) for (const mode of ['release', 'revision']) {
      for (const [a, b, over, label] of [[receipt, other, 'a', 'A'], [other, receipt, 'b', 'B']]) {
        const report = preservedReport(h, a, b, { mode });
        assert.deepEqual(report.liftBreakdown[over], { error: reason }, limit + ' ' + mode + ': breakdown not unavailable');
        check(report.liftBreakdown[over === 'a' ? 'b' : 'a'], other);
        const section = report.markdown.split('\n## Lift breakdown: ' + label + '\n')[1].split('\n## Lift breakdown:')[0];
        assert.equal(section, '\nLift breakdown unavailable: ' + reason + '\n', limit + ' ' + mode + ': unavailable section');
        O.markdownRows(report.markdown, other, label === 'A' ? 'B' : 'A');
      }
    }
  } finally { h.close(); }
});

test('AC-7: every view sheet visibly renders independently recomputed rows and downward cases', () => {
  for (const r of [...Object.values(V), ...CORPUS]) {
    const section = O.visibleRows(render(r), r);
    O.words(O.textOf(section));
  }
  const section = O.textOf(O.visibleRows(render(V.normal), V.normal));
  assert.match(section, /hurt/);
  assert.match(section, /hurts/i);
  assert.match(section, /removing this case leaves no positive measured lift/i);
});

test('AC-7: view emits a breakdown for every receipt in a cell, with its own evidence', () => {
  const dir = fs.mkdtempSync('/var/tmp/spec190-multi-');
  try {
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(V.normal));
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(V.shared));
    const html = view.renderView(dir, { label: 'fixture', stale: { noHarnessCheck: true } }).html;
    for (const [file, r] of [['a.json', V.normal], ['b.json', V.shared]]) {
      const sheet = [...html.matchAll(/<article class="sheet" data-file="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g)].find(m => m[1] === file);
      assert.ok(sheet, file); O.visibleRows(sheet[2], r);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('AC-7: diff keeps A and B separate, including unmatched cases, in release and revision modes', () => {
  const b = structuredClone(V.shared); b.skill.content_hash = 'b'.repeat(64); sealReceipt(b);
  for (const mode of ['release', 'revision']) {
    const result = buildDriftReport(V.normal, b, { mode, labelA: 'Pinned', labelB: 'Current' });
    assert.ok(result.liftBreakdown, 'both within-receipt breakdowns missing');
    check(result.liftBreakdown.a, V.normal); check(result.liftBreakdown.b, b);
    for (const [label, r] of [['Pinned', V.normal], ['Current', b]]) O.words(O.markdownRows(result.markdown, r, label));
    assert.equal(result.liftBreakdown.a.lift, 0.1);
    assert.equal(result.liftBreakdown.b.lift, 0.4);
    assert.deepEqual(new Set(result.liftBreakdown.b.rows.map(c => c.id)), new Set(['first', 'second']));
  }
});

test('AC-7: identifiers and labels cannot break HTML or Markdown table structure', () => {
  const html = render(V.unsafe);
  O.visibleRows(html, V.unsafe);
  assert.doesNotMatch(html, /<img src=x/);
  const label = 'A|<img src=x>\n' + String.fromCharCode(96) + 'label';
  const report = buildDriftReport(V.unsafe, V.normal, { labelA: label });
  assert.ok(report.liftBreakdown, 'breakdown missing');
  const section = report.markdown.slice(report.markdown.indexOf('\n## Lift breakdown:'));
  assert.doesNotMatch(section, /<img src=x/);
  assert.ok(!section.includes(V.unsafe.results.cases[0].id), 'raw unsafe identifier emitted');
  const tableLines = section.split('\n').filter(line => line.startsWith('|'));
  // The unsafe id must stay in one row. Only unescaped separators count.
  const data = tableLines.find(line => line.includes('unsafe'));
  assert.ok(data, 'escaped case was omitted');
  assert.equal((data.match(/(?<!\\)\|/g) || []).length, 17, 'unsafe id introduced a table column');
});

test('AC-8: new sections use qualified words and add no external script or interaction', () => {
  const html = render(V.normal);
  const section = O.visibleRows(html, V.normal);
  O.words(O.textOf(section));
  assert.doesNotMatch(section, /<script\b|<button\b|on(?:click|error)\s*=/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
  const md = O.markdownRows(buildDriftReport(V.normal, V.normal).markdown, V.normal, 'A'); O.words(md);
});

test('AC-8: README explains the two receipt-only breakdowns and missing draw evidence', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const section = /<!-- issue 207: lift breakdown begin -->([\s\S]*?)<!-- issue 207: lift breakdown end -->/.exec(readme);
  assert.ok(section, 'README lift breakdown explanation missing');
  O.words(section[1]);
  for (const phrase of ['driftproof view', 'driftproof diff', 'no model call', 'draw', 'unavailable', 'verdict']) assert.ok(section[1].toLowerCase().includes(phrase), phrase);
});

test('AC-9: both arms use the sealed same grading model and rubric before comparative labels', () => {
  for (const change of [
    r => { r.results.cases[0].judge.model_id = 'other-judge'; },
    r => { r.results.cases[0].judge.rubric_hash = 'b'.repeat(64); },
    r => { r.run.judge.model_id = 'other-judge'; },
  ]) {
    const r = fixture(); change(r); sealReceipt(r);
    assert.ok(validateReceipt(r).valid, JSON.stringify(validateReceipt(r).errors));
    const a = breakdown(r); O.checkNumbers(a, r); O.checkCarriers(a, r); O.checkState(a, r, EFFECT_FLOOR, POWER_Z);
    assert.ok(a.rows.every(c => c.carriesLift === null), 'a mixed instrument cannot carry a measured claim');
    assert.equal(a.rows.find(c => c.id === 'driver').state, 'unavailable');
    for (const text of [O.textOf(O.visibleRows(render(r), r)), O.markdownRows(buildDriftReport(r, r).markdown, r, 'A')]) {
      assert.match(text, /grad|rubric|instrument/i, 'different instrument is not explained');
    }
  }
});
test('controls AC-1 and AC-9: call, input mutation and grading mismatch plants are detected', () => {
  assert.equal(externalCalls, 0, 'a product external call escaped');
  for (const invoke of guardedCalls) assert.throws(invoke, /receipt-only violation/);
  assert.equal(externalCalls, guardedCalls.length, 'call entry point trap blind'); externalCalls = 0;
  const r = fixture();
  assert.throws(() => immutable(r, () => { r.comparison.delta = 0.99; }), { name: 'AssertionError' }, 'input mutation plant');
  const mixed = fixture(); mixed.results.cases[0].judge.rubric_hash = 'b'.repeat(64); sealReceipt(mixed);
  const a = evidence(mixed); a.rows[0].state = 'helps'; a.rows[0].carriesLift = true;
  assert.throws(() => O.checkState(a, mixed, EFFECT_FLOOR, POWER_Z), { name: 'AssertionError' }, 'rubric mismatch plant');
  assert.throws(() => O.checkCarriers(a, mixed), { name: 'AssertionError' }, 'mixed grading carrier plant');
});

// Review plants, A-190-1 to A-190-9. Each tests the real product path and an independent reader.
test('AC-10: positivity is decided before the reporting round', () => {
  const r = fixture([['driver', [0.9, 0.9], [0.3, 0.3]], ['tiny', [0.500001, 0.500001], [0.5, 0.5]], ['flat-a', [0.5, 0.5], [0.5, 0.5]], ['flat-b', [0.5, 0.5], [0.5, 0.5]]]);
  const a = breakdown(r); check(a, r);
  assert.equal(a.rows.find(c => c.id === 'driver').leaveOneOut.lift, 0);
  assert.equal(a.rows.find(c => c.id === 'driver').carriesLift, false);
  const mutant = O.expected(r); mutant.rows.find(c => c.id === 'driver').carriesLift = true;
  assert.throws(() => O.checkCarriers(mutant, r), { name: 'AssertionError' }, 'rounded positivity plant');
  for (const sign of [1, -1]) {
    const tiny = fixture([['tiny', [0.5 + sign * 0.000001], [0.5]], ['flat-a', [0.5], [0.5]], ['flat-b', [0.5], [0.5]]]);
    const result = breakdown(tiny); check(result, tiny);
    assert.equal(result.lift, 0);
    assert.equal(result.rows.find(c => c.id === 'tiny').carriesLift, sign === 1);
  }
});
test('AC-11: every permutation of the four review scores gives identical answers', () => {
  const values = [0.749042, 0.694953, 0.126388, 0.594691];
  function permute(xs) { return xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permute(xs.filter((_, j) => j !== i)).map(rest => [x, ...rest])); }
  const r = fixture([['boundary', values, [0.5, 0.5]], ['other', [0.7, 0.7], [0.2, 0.2]]]);
  const base = breakdown(r); assert.equal(base.rows[0].withSkill.mean, 0.541269);
  for (const order of permute(r.results.cases[0].generation.draws)) {
    const copy = structuredClone(r); copy.results.cases[0].generation.draws = order;
    copy.results.cases.reverse(); sealReceipt(copy);
    const got = breakdown(copy);
    assert.equal(got.lift, base.lift);
    assert.deepEqual(got.hurtCases, base.hurtCases);
    assert.deepEqual([...got.rows].sort((a, b) => a.id.localeCompare(b.id)), [...base.rows].sort((a, b) => a.id.localeCompare(b.id)));
  }
  assert.equal(O.average(values), O.average([...values].reverse()));
  const mutant = O.expected(r); mutant.rows[0].withSkill.mean = 0.541268;
  assert.throws(() => O.checkNumbers(mutant, r), { name: 'AssertionError' });
});
test('AC-12: duplicated draw identities and every contradictory count are refused', () => {
  for (const change of [
    g => { g.draws[1].draw_index = g.draws[0].draw_index; },
    g => { g.n_drawn++; }, g => { g.n_measured--; }, g => { g.n_unmeasured++; },
  ]) {
    const r = fixture(); change(r.results.cases[0].generation); sealReceipt(r);
    assert.ok(validateReceipt(r).valid, 'plant must reach new consistency reader');
    assert.throws(() => O.arithmetic(r), { name: 'AssertionError' });
    assert.throws(() => breakdown(r), /draw|count|contradict|ambiguous/i);
    const html = render(r);
    const sec = /<section[^>]*data-field="lift-breakdown"[^>]*>([\s\S]*?)<\/section>/.exec(html);
    assert.ok(sec && /unavailable/i.test(O.textOf(sec[1])));
    assert.doesNotMatch(sec[1], /data-lift-case=/);
    assert.match(buildDriftReport(r, V.normal).markdown, /breakdown unavailable.*(?:draw|count|ambiguous)/i);
  }
});
test('AC-13: dated snapshots never become the same grader by suffix removal', () => {
  for (const pair of [['grader-20260901', 'grader-20261001'], ['grader-20260901', 'grader-20260901']]) {
    const r = fixture(); r.run.judge.model_id = 'grader';
    r.results.cases.forEach(c => { c.judge.model_id = c.mode === 'with_skill' ? pair[0] : pair[1]; }); sealReceipt(r);
    const a = breakdown(r); check(a, r);
    assert.ok(a.rows.every(c => c.state === 'unavailable' && c.carriesLift === null));
  }
  const r = fixture(); r.run.judge.model_id = 'grader-20260901'; r.results.cases.forEach(c => { c.judge.model_id = r.run.judge.model_id; }); sealReceipt(r);
  check(breakdown(r), r); assert.equal(breakdown(r).rows[0].state, 'helps');
});
test('AC-14: visible state, carrier, reason and downward-list lies read red in both formats', () => {
  for (const r of [V.normal, V.shared, V.failed]) {
    const html = render(r); const md = buildDriftReport(r, r).markdown;
    O.visibleRows(html, r); O.markdownRows(md, r, 'A');
    const edits = r === V.failed ? [['Case excluded: failed_timeout.', 'Case excluded: other.']]
      : r === V.shared ? [['Does not carry the positive measured lift', 'Removing this case leaves no positive measured lift'], ['Downward cases: none.', 'Downward cases: invented.']]
        : [['Helps under the rule', 'Hurts under the rule'], ['Downward cases: hurt.', 'Downward cases: none.']];
    for (const [before, after] of edits) {
      assert.ok(html.includes(before) && md.includes(before), 'plant anchor exists');
      assert.throws(() => O.visibleRows(html.replace(before, after), r), { name: 'AssertionError' });
      assert.throws(() => O.markdownRows(md.replace(before, after), r, 'A'), { name: 'AssertionError' });
    }
  }
});
test('AC-15: each eligibility protection has an isolated subject with other guards satisfied', () => {
  assert.equal(typeof view.liftEligibilityReasons, 'function', 'shared eligibility reader missing');
  const plants = [
    [r => { r.verification_level = 'DECLARED'; }, 'Receipt is below TESTED.'],
    [r => { r.run.answered_by.kind = 'stub'; }, 'A model did not answer this receipt.'],
    [r => { r.run.preset = 'quick'; }, 'This is a smoke receipt.'],
    [r => { r.run.status = 'incomplete'; }, 'The run is incomplete.'],
    [r => { r.suite.case_count++; }, 'The recorded suite is narrowed.'],
    [r => { r.comparison.delta = null; }, 'The receipt has no numeric comparison.'],
  ];
  for (const [change, reason] of plants) {
    const r = fixture(); change(r); sealReceipt(r);
    assert.deepEqual(O.eligibilityReasons(r), [reason], 'isolated oracle protection');
    assert.deepEqual(view.liftEligibilityReasons(r), [reason], 'dedicated guard removed');
    if (!validateReceipt(r).valid) assert.throws(() => breakdown(r), /schema|invalid|receipt/i);
    else { const a = breakdown(r); check(a, r); assert.ok(a.rows.every(c => c.state === 'unavailable')); }
  }
});
test('AC-15: lost scores retain or invalidate separation in each direction', () => {
  for (const direction of [1, -1]) for (const survives of [true, false]) {
    const high = survives ? Array(9).fill(1).concat(null) : [0.60, 0.60, null];
    const low = survives ? [0, 0] : [0.55, 0.55];
    const r = fixture([['loss', direction > 0 ? high : low, direction > 0 ? low : high], ['flat', [0.5, 0.5], [0.5, 0.5]]]);
    const a = breakdown(r); check(a, r);
    const want = survives ? direction > 0 ? 'helps' : 'hurts' : 'inconclusive';
    assert.equal(a.rows.find(c => c.id === 'loss').state, want);
    O.visibleRows(render(r), r); O.markdownRows(buildDriftReport(r, r).markdown, r, 'A');
    const mutant = O.expected(r); mutant.rows.find(c => c.id === 'loss').state = survives ? 'inconclusive' : direction > 0 ? 'helps' : 'hurts';
    assert.throws(() => O.checkState(mutant, r), { name: 'AssertionError' });
  }
});
test('AC-16: supported shape, depth, byte, label and node limits include their boundaries', () => {
  assert.deepEqual(view.LIFT_LIMITS, { receiptBytes: 2097152, cases: 128, draws: 64, identifierBytes: 256, stringBytes: 4096, nodes: 65536, depth: 32, outputBytes: 1048576 });
  const shape = fixture(Array.from({ length: 128 }, (_, i) => ['c' + i, [0.6, 0.6], [0.5, 0.5]]));
  assert.equal(breakdown(shape).caseCount, 128);
  const overCases = fixture(Array.from({ length: 129 }, (_, i) => ['c' + i, [0.6, 0.6], [0.5, 0.5]]));
  assert.throws(() => breakdown(overCases), /limit|128|case/i);
  const draws = fixture([['draws', Array(64).fill(0.6), [0.5, 0.5]]]); check(breakdown(draws), draws);
  assert.throws(() => breakdown(fixture([['draws', Array(65).fill(0.6), [0.5, 0.5]]])), /limit|64|draw/i);
  check(breakdown(fixture([['x'.repeat(256), [0.6, 0.6], [0.5, 0.5]]])), fixture([['x'.repeat(256), [0.6, 0.6], [0.5, 0.5]]]));
  assert.throws(() => breakdown(fixture([['x'.repeat(257), [0.6, 0.6], [0.5, 0.5]]])), /limit|identifier|256/i);
  const string = fixture(); string.results.cases[0].reason = 's'.repeat(4096); sealReceipt(string); breakdown(string);
  string.results.cases[0].reason += 's'; sealReceipt(string); assert.throws(() => breakdown(string), /limit|string|4096/i);
  const depth = fixture(); let cursor = depth.results.cases[0].generation.extra = {};
  for (let i = 0; i < 27; i++) cursor = cursor.child = {};
  sealReceipt(depth); breakdown(depth); cursor.child = {}; sealReceipt(depth);
  assert.throws(() => breakdown(depth), /limit|depth|32/i);
  const nodes = fixture(); nodes.results.cases[0].generation.extra = [];
  const count = obj => 1 + (obj && typeof obj === 'object' ? Object.values(obj).reduce((n, v) => n + count(v), 0) : 0);
  const remaining = 65536 - count(nodes);
  nodes.results.cases[0].generation.extra = Array(remaining).fill(0); sealReceipt(nodes); breakdown(nodes);
  nodes.results.cases[0].generation.extra.push(0); sealReceipt(nodes); assert.throws(() => breakdown(nodes), /limit|node|65536/i);
  const bytes = fixture(); const padding = bytes.results.cases[0].generation.extra = [];
  while (Buffer.byteLength(JSON.stringify(bytes)) < 2097152) padding.push('p'.repeat(4096));
  const excess = Buffer.byteLength(JSON.stringify(bytes)) - 2097152;
  padding[padding.length - 1] = padding[padding.length - 1].slice(0, 4096 - excess);
  sealReceipt(bytes); assert.equal(Buffer.byteLength(JSON.stringify(bytes)), 2097152); breakdown(bytes);
  padding.push('x'); sealReceipt(bytes); assert.throws(() => breakdown(bytes), /limit|byte|2097152/i);
  assert.equal(typeof view.liftOutput, 'function');
  assert.equal(view.liftOutput('x'.repeat(1048576)).length, 1048576);
  assert.throws(() => view.liftOutput('x'.repeat(1048577)), /limit|output|1048576/i);
  const report = buildDriftReport(V.normal, V.shared, { labelA: 'x'.repeat(256) }); assert.ok(report.liftBreakdown.a);
  assert.throws(() => buildDriftReport(V.normal, V.shared, { labelA: 'x'.repeat(257) }), /limit|label|256/i);
  const poisoned = fixture(); poisoned.results.cases = Array(257);
  Object.defineProperty(poisoned, 'comparison', { get() { throw new Error('expensive getter touched'); } });
  assert.throws(() => breakdown(poisoned), /limit|case|256/i, 'limit must precede expensive evidence processing');
});
test('AC-17: the claim and README state evidence and eligibility exceptions', () => {
  const spec = fs.readFileSync(path.join(__dirname, '../specs/190-issue-207-lift-breakdown/spec.md'), 'utf8');
  const claim = spec.split('\n').find(s => s.startsWith('**Public claim:**'));
  const read = text => { assert.match(text, /where evidence and eligibility permit/i); assert.match(text, /states why unavailable/i); };
  read(claim);
  assert.throws(() => read(claim.replace('where evidence and eligibility permit', 'always')), { name: 'AssertionError' });
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const section = /<!-- issue 207: lift breakdown begin -->([\s\S]*?)<!-- issue 207: lift breakdown end -->/.exec(readme);
  assert.ok(section, 'README qualification missing'); read(section[1]);
  assert.throws(() => read(section[1].replace('states why unavailable', 'answers everything')), { name: 'AssertionError' });
});
test('AC-18: actual population arithmetic on nonconstant draws is rejected', () => {
  const e = O.expected(V.wide);
  const xs = V.wide.results.cases[0].generation.draws.map(d => d.mean);
  const mean = xs.reduce((n, x) => n + x, 0) / xs.length;
  e.rows[0].withSkill.sd = O.six(Math.sqrt(xs.reduce((n, x) => n + (x - mean) ** 2, 0) / xs.length));
  assert.notEqual(e.rows[0].withSkill.sd, O.spread(xs));
  assert.throws(() => O.checkNumbers(e, V.wide), { name: 'AssertionError' }, 'actual population formula plant');
  for (const invoke of guardedCalls) assert.throws(invoke, /receipt-only violation/);
  externalCalls = 0;
});

test('AC-16: both product paths refuse oversized sections without showing partial figures', () => {
  const r = fixture(Array.from({ length: 128 }, (_, i) => ['large' + i, [0.6, 0.6], [0.5, 0.5]]));
  for (const row of r.results.cases.filter(c => c.mode === 'baseline')) {
    row.case_status = 'failed_timeout'; row.reason = '&'.repeat(4096);
    delete row.mean; delete row.score; delete row.samples;
  }
  r.run.status = 'incomplete'; sealReceipt(r);
  assert.ok(validateReceipt(r).valid, JSON.stringify(validateReceipt(r).errors));
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 2097152);
  const html = render(r);
  const section = /<section data-field="lift-breakdown">([\s\S]*?)<\/section>/.exec(html)[1];
  assert.match(O.textOf(section), /unavailable.*output bytes.*1048576/i);
  assert.doesNotMatch(section, /data-lift-case/);
  const md = buildDriftReport(r, r).markdown;
  for (const label of ['A', 'B']) {
    const section = md.split('## Lift breakdown: ' + label + '\n')[1].split('## Lift breakdown:')[0];
    assert.match(section, /unavailable.*output bytes.*1048576/i);
    assert.doesNotMatch(section, /\| case \|/);
    assert.ok(Buffer.byteLength(section) <= 1048576);
  }
  const poisoned = fixture();
  Object.defineProperty(poisoned, 'comparison', { get() { throw new Error('expensive getter touched'); } });
  assert.throws(() => buildDriftReport(poisoned, r, { labelA: 'x'.repeat(257) }), /limit.*label/i);
});

test('AC-3 and AC-11: subnormal sealed scores keep finite sample spreads', () => {
  const r = fixture([['small', [Number.MIN_VALUE, 0.5], [0, 0]], ['flat', [0.5, 0.5], [0.5, 0.5]]]);
  assert.equal(O.spread([Number.MIN_VALUE, 0.5]), 0.353553);
  const a = breakdown(r); check(a, r);
  assert.equal(a.rows.find(c => c.id === 'small').withSkill.sd, 0.353553);
  const shuffled = structuredClone(r);
  for (const row of shuffled.results.cases) row.generation.draws.reverse();
  sealReceipt(shuffled);
  assert.deepEqual(breakdown(shuffled).rows, a.rows);
});





test('AC-21: CLI opt-in works in either position, both modes and --out', () => {
  const h = D.harness(harnessExec);
  try {
    const a = V.normal; const b = structuredClone(V.shared);
    b.skill.content_hash = 'b'.repeat(64); b.run.date_utc = '2026-10-11T00:00:00Z'; sealReceipt(b);
    const files = [path.join(h.tmp, 'a.json'), path.join(h.tmp, 'b.json')];
    files.forEach((f, i) => fs.writeFileSync(f, JSON.stringify([a, b][i])));
    for (const mode of ['release', 'revision']) {
      const args = ['diff', ...files, '--mode', mode];
      const plain = h.cli(args); assert.equal(plain.status, 0, plain.stderr);
      assert.doesNotMatch(plain.stdout, /^## Lift breakdown:/m);
      for (const position of ['before', 'after']) {
        const opted = h.cli(position === 'before' ? ['diff', '--lift-breakdown', ...files, '--mode', mode] : [...args, '--lift-breakdown']);
        assert.equal(opted.status, 0, opted.stderr); assert.equal(opted.stderr, plain.stderr);
        // Inspect the actual CLI labels; independent readers inspect both sections below.
        const headings = [...opted.stdout.matchAll(/^## Lift breakdown: (.+)$/gm)].map(m => m[1]);
        assert.equal(headings.length, 2, 'flag was not forwarded or a receipt positional was swallowed');
        O.markdownRows(opted.stdout, a, headings[0]); O.markdownRows(opted.stdout, b, headings[1]);
      }
      const out = path.join(h.tmp, 'opted.md');
      const written = h.cli([...args, '--lift-breakdown', '--out', out]);
      assert.equal(written.status, 0, written.stderr);
      assert.equal(written.stdout, 'Drift report written to ' + out + '\n');
      const markdown = fs.readFileSync(out, 'utf8');
      assert.equal([...markdown.matchAll(/^## Lift breakdown:/gm)].length, 2);
      const headings = [...markdown.matchAll(/^## Lift breakdown: (.+)$/gm)].map(m => m[1]);
      O.markdownRows(markdown, a, headings[0]); O.markdownRows(markdown, b, headings[1]);
    }
  } finally { h.close(); }
});

test('AC-21: value refusals exit 2, name --lift-breakdown and write no report', () => {
  const h = D.harness(harnessExec);
  try {
    const a = path.join(h.tmp, 'a.json'); fs.writeFileSync(a, JSON.stringify(V.normal));
    const out = path.join(h.tmp, 'refused.md');
    for (const value of ['', 'false', 'true', 'yes', 'no', 'on', 'off', '1', '0', 'anything']) {
      const forms = [['--lift-breakdown=' + value]];
      if (/^(true|false|yes|no|on|off|1|0)$/.test(value)) forms.push(['--lift-breakdown', value]);
      for (const flag of forms) {
        const result = h.cli(['diff', a, a, ...flag, '--out', out]);
        assert.equal(result.status, 2, 'value form was accepted: ' + flag.join(' '));
        assert.equal(result.stdout, ''); assert.match(result.stderr, /--lift-breakdown takes no value, and was given one/);
        assert.equal(fs.existsSync(out), false, 'refusal wrote a report');
      }
    }
  } finally { h.close(); }
});

test('AC-21: help and README name the opt-in and keep the default unchanged', () => {
  const h = D.harness(harnessExec);
  try {
    const help = h.cli(['--help']); assert.equal(help.status, 0);
    assert.match(help.stdout, /diff <receiptA.json> <receiptB.json>[^\n]*\[--lift-breakdown\]/);
    const line = help.stdout.split('\n').find(l => l.includes('diff --lift-breakdown'));
    assert.ok(line, 'missing qualified flag help'); O.words(line); assert.match(line, /recorded draw scores/i);
    const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
    const section = /<!-- issue 207: lift breakdown begin -->([\s\S]*?)<!-- issue 207: lift breakdown end -->/.exec(readme)[1];
    O.words(section); assert.match(section, /driftproof diff --lift-breakdown/);
    assert.match(section, /without (?:the |this )?flag[^.]*unchanged/i);
  } finally { h.close(); }
});
