// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 139's smoke run (AC-2, AC-3): the quick preset in lib/firstrun.js and
// lib/smoke.js, a --quick run's receipt and output, and every reader of a verdict over it.
//
//   node --test tests/smoke.test.js
//
// THE MODEL IS SPEC 028'S FAKE `claude` (specs/028-claude-code-plugin/probes/bin/claude), first on
// PATH, reached on the trusted lane, so a run is answered by a "model" and a smoke receipt is
// UNVERIFIED for one reason only: its preset. A stub run is UNVERIFIED for its own reason and would
// show nothing about the preset. No credential is in any environment here, and nothing is spent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateReceipt, sealReceipt } = require('../lib/receipt');
const { receiptVerdict } = require('../lib/verdict');
const { decideSet } = require('../lib/decision');
const plain = require('../lib/plain');
const fr = require('../lib/firstrun');
const smoke = require('../lib/smoke');
const { QUICK, SMOKE_LINE } = fr;

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const FAKE_BIN = path.join(ROOT, 'specs', '028-claude-code-plugin', 'probes', 'bin');
const MODEL = 'claude-haiku-4-5';
const made = [];
let SPAWNLOG = null;
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec139-smoke-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function env(extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^OPENAI_|^DRIFTPROOF_|^SPEC0/.test(k)) continue;
    e[k] = v;
  }
  e.PATH = [FAKE_BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
  if (SPAWNLOG) e.SPEC028_SPAWNLOG = SPAWNLOG;
  return { ...e, ...extra };
}
const cli = (args, cwd, extra) => spawnSync(process.execPath, [BIN, ...args], { cwd, env: env(extra), encoding: 'utf8', timeout: 300000 });

function skill(root, n) {
  const dir = path.join(root, `fx-skill-${n}`);
  fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: fx-skill-${n}\nversion: 1.0.0\n---\n\n# fx-skill-${n}\n\nAnswer in one short sentence.\n`);
  const cases = Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, prompt: `Question ${i + 1}?`, rubric: 'One short sentence scores 0.80.' }));
  fs.writeFileSync(path.join(dir, 'evals', 'evals.json'), JSON.stringify({ cases }, null, 2));
  return dir;
}
const receiptIn = (dir) => {
  const f = fs.readdirSync(dir).filter((x) => x.endsWith('.json'));
  assert.equal(f.length, 1, `one receipt in ${dir}: ${f}`);
  return { file: path.join(dir, f[0]), receipt: JSON.parse(fs.readFileSync(path.join(dir, f[0]), 'utf8')) };
};

test('the quick preset is two judge samples, concurrency four, at most five cases', () => {
  assert.deepEqual({ ...fr.QUICK }, { samples: 2, concurrency: 4, maxCases: 5 });
  assert.ok(Object.isFrozen(fr.QUICK));
  assert.equal(fr.PRESET_QUICK, smoke.PRESET_QUICK);
  assert.equal(fr.SMOKE_LINE, 'A smoke run cannot produce a verdict');
});

test('--quick names each of the three flags it sets when one is given beside it', () => {
  assert.deepEqual(fr.quickConflicts({ quick: true }), []);
  assert.deepEqual(fr.quickConflicts({ quick: true, samples: '5' }), ['samples']);
  assert.deepEqual(fr.quickConflicts({ quick: true, 'max-cases': '1', concurrency: '2', models: 'x' }), ['concurrency', 'max-cases']);
});

test('the banner and the result line carry the plain line and no lift', () => {
  assert.ok(fr.quickBanner().includes(fr.SMOKE_LINE));
  assert.ok(fr.quickBanner().includes('UNVERIFIED'));
  const r = fr.quickResultLine('0.800 ± 0.000', '0.400 ± 0.000');
  assert.ok(r.includes(fr.SMOKE_LINE));
  assert.doesNotMatch(r, /lift|[+-]\d\.\d{3}\b(?! ±)/);
});

test('isSmoke reads run.preset and nothing else', () => {
  assert.equal(smoke.isSmoke({ run: { preset: 'quick' } }), true);
  assert.equal(smoke.isSmoke({ run: {} }), false);
  assert.equal(smoke.isSmoke({ run: { preset: 'other' } }), false);
  assert.equal(smoke.isSmoke(null), false);
  assert.equal(smoke.isSmoke({ verification_level: 'UNVERIFIED' }), false);
});

// The two fixtures every reader test reads: one skill, run with and without --quick.
let FX = null;
function fixtures() {
  if (FX) return FX;
  const root = tmp();
  SPAWNLOG = path.join(root, 'spawns.ndjson');
  const two = skill(root, 2);
  const seven = skill(root, 7);
  const out = (n) => path.join(root, n);
  const control = cli(['run', two, '--trusted-skill', '--models', MODEL, '--samples', '2', '--out', out('control')], root);
  const quick = cli(['run', two, '--quick', '--trusted-skill', '--models', MODEL, '--out', out('smoke')], root);
  const quick7 = cli(['run', seven, '--quick', '--trusted-skill', '--models', MODEL, '--out', out('smoke7')], root);
  for (const [n, r] of [['control', control], ['quick', quick], ['quick7', quick7]]) assert.equal(r.status, 0, `${n}: ${r.stderr.slice(-800)}`);
  FX = { root, two, seven, control, quick, quick7, c: receiptIn(out('control')), s: receiptIn(out('smoke')), s7: receiptIn(out('smoke7')), out };
  return FX;
}

test('every call was answered by the fake claude, and none carried a key', () => {
  fixtures();
  const spawns = fs.readFileSync(SPAWNLOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(spawns.length > 0, 'the fake was reached');
  for (const s of spawns) {
    assert.equal(s.bin, 'claude');
    assert.equal(s.viaFakeBin, true);
    assert.equal(s.had_api_key, false);
  }
});

test('the control reads a verdict, so a smoke reading of none is not a reader that refuses everything', () => {
  const { c } = fixtures();
  assert.equal(c.receipt.verification_level, 'TESTED');
  assert.equal(c.receipt.run.answered_by.kind, 'model');
  assert.equal(c.receipt.run.preset, undefined);
  assert.notEqual(receiptVerdict(c.receipt).verdict, 'NOT_MEASURED');
});

test('--quick: two judge samples, at most five cases, the preset, UNVERIFIED, and valid', () => {
  const { s, s7, quick } = fixtures();
  assert.equal(s.receipt.run.preset, 'quick');
  assert.equal(s.receipt.verification_level, 'UNVERIFIED');
  assert.equal(s.receipt.run.answered_by.kind, 'model', 'a model answered: the preset alone is why');
  assert.equal(s.receipt.run.judge.samples, QUICK.samples);
  assert.equal(validateReceipt(s.receipt).valid, true, JSON.stringify(validateReceipt(s.receipt).errors));
  assert.equal(new Set(s7.receipt.results.cases.map((x) => x.id)).size, QUICK.maxCases);
  assert.match(path.basename(s.file), /-quick-/);
  assert.match(quick.stdout, new RegExp(`concurrency: ${QUICK.concurrency}`));
});

test('--quick says it cannot produce a verdict before and after, and prints no lift', () => {
  const { quick, control, out } = fixtures();
  const said = quick.stdout.split(SMOKE_LINE).length - 1;
  assert.ok(said >= 2, `the plain line before the first call and after the receipt: ${said}`);
  assert.doesNotMatch(quick.stdout, /skill lift/);
  assert.match(control.stdout, /skill lift/);
  const summary = fs.readdirSync(out('smoke')).find((x) => x.endsWith('.summary.md'));
  const md = fs.readFileSync(path.join(out('smoke'), summary), 'utf8');
  assert.ok(md.includes(SMOKE_LINE));
  assert.doesNotMatch(md, /skill lift \*\*[+-]/);
});

test('--quick refuses its three flags beside it and a value given to it, writing nothing', () => {
  const root = tmp();
  const dir = skill(root, 1);
  for (const extra of [['--samples', '5'], ['--concurrency', '2'], ['--max-cases', '1']]) {
    const r = cli(['run', dir, '--quick', ...extra, '--trusted-skill', '--out', path.join(root, 'o')], root);
    assert.equal(r.status, 2, extra.join(' '));
    assert.match(r.stderr, /REFUSED \(run\): --quick sets/);
    assert.equal(r.stdout, '');
    assert.equal(fs.existsSync(path.join(root, 'o')), false);
  }
  for (const form of [['--quick=yes'], ['--quick', 'true']]) {
    const r = cli(['run', dir, ...form, '--trusted-skill'], root);
    assert.equal(r.status, 2, form.join(' '));
    assert.match(r.stderr, /takes no value/);
  }
});

test('--quick reads the .driftproofrc values it sets by the input contract: a malformed one is refused, a well-formed one is not used', () => {
  // The stub answers: the rc is read before any call, and nothing is spent.
  const stub = { DRIFTPROOF_STUB: '1' };
  for (const [key, bad] of [['samples', 'abc'], ['concurrency', '0'], ['max_cases', '-1']]) {
    const root = tmp();
    const dir = skill(root, 1);
    fs.writeFileSync(path.join(root, '.driftproofrc'), JSON.stringify({ [key]: bad }));
    const r = cli(['run', dir, '--quick', '--out', path.join(root, 'o')], root, stub);
    assert.equal(r.status, 2, `${key} ${bad}: ${r.stderr}`);
    assert.match(r.stderr, /REFUSED/);
    assert.doesNotMatch(r.stderr, /not used for this run/);
    assert.equal(fs.existsSync(path.join(root, 'o')), false);
  }
  const root = tmp();
  const dir = skill(root, 1);
  fs.writeFileSync(path.join(root, '.driftproofrc'), JSON.stringify({ samples: 7 }));
  const r = cli(['run', dir, '--quick', '--out', path.join(root, 'o')], root, stub);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /the \.driftproofrc value for samples is not used for this run/);
  assert.equal(receiptIn(path.join(root, 'o')).receipt.run.judge.samples, QUICK.samples);
});

test('no reader gives a smoke receipt a verdict', () => {
  const { s, s7, root } = fixtures();
  for (const r of [s.receipt, s7.receipt]) {
    const v = receiptVerdict(r);
    assert.equal(v.verdict, 'NOT_MEASURED');
    assert.ok(v.notMeasured.includes('below_tested'));
    const p = plain.plainOf(r);
    assert.equal(p.state, 'SMOKE');
    assert.equal(p.label, 'Smoke run, no verdict');
    assert.ok(p.sentence.includes(SMOKE_LINE));
    assert.doesNotMatch(`${p.sentence} ${p.why}`, /helped|hurt|no clear difference|no effect|[+-]\d\.\d{3}/i);
  }
  const d = decideSet(path.dirname(s.file), MODEL);
  assert.equal(d.rows[0].state, 'not measured');
  assert.equal(plain.plainOfRow(d.rows[0], s.receipt).label, 'Smoke run, no verdict');
  assert.ok(plain.commentMarkdown(d, path.dirname(s.file), { key: 'k' }).includes('Smoke run, no verdict'));

  const badge = cli(['badge', s.file], root);
  assert.equal(badge.status, 0, badge.stderr);
  assert.match(JSON.parse(badge.stdout).message, /^not measured on /);
  const gh = cli(['badge', s.file, '--github-output'], root);
  assert.match(gh.stdout, /verdict<<ghadelim_[0-9a-f]+\nNOT_MEASURED\n/);
  // R-4: no lift for a smoke receipt, in the badge's GitHub output either.
  assert.match(gh.stdout, /delta<<ghadelim_[0-9a-f]+\nn\/a\n/);
  const svg = cli(['badge', s.file, '--svg'], root);
  assert.match(svg.stdout, /NOT_MEASURED/);
  assert.doesNotMatch(svg.stdout, /PASSED|REGRESSED|NO_EFFECT/);

  const summary = path.join(root, 'summary.md');
  const dec = cli(['decide', path.dirname(s.file), '--models', MODEL, '--enforce', '--summary', summary], root);
  assert.equal(dec.status, 0, dec.stderr);
  const md = fs.readFileSync(summary, 'utf8');
  assert.ok(md.includes(SMOKE_LINE));
  // The job summary's Lift cell and decide's GitHub output give no lift for a smoke row.
  assert.match(md, /\| [^|]*not measured[^|]*\| n\/a \|/);
  const dgh = cli(['decide', path.dirname(s.file), '--models', MODEL, '--github-output'], root);
  assert.match(dgh.stdout, /delta<<ghadelim_[0-9a-f]+\nn\/a\n/);

  const exp = cli(['export', s.file], root);
  assert.equal(JSON.parse(exp.stdout).verdict, 'NOT_MEASURED');
  const expOut = path.join(root, 'export-out');
  fs.mkdirSync(expOut);
  const line = cli(['export', s.file, '--out', expOut], root).stdout;
  assert.match(line, /delta n\/a \(a smoke run cannot produce a verdict\)/);

  const page = path.join(root, 'view.html');
  const view = cli(['view', path.dirname(s.file), '--out', page, '--no-harness-check'], root);
  assert.equal(view.status, 0, view.stderr);
  const html = fs.readFileSync(page, 'utf8');
  assert.ok(html.includes('Smoke run, no verdict'));
  assert.match(html, /data-count="SMOKE"/);
  // The smoke sheet draws its two arms with no band state; the token block names colours only.
  const sheet = /<article class="sheet" data-file="[^"]*" data-state="SMOKE">[\s\S]*?<\/article>/.exec(html);
  assert.ok(sheet, 'a smoke sheet');
  assert.doesNotMatch(sheet[0].replace(/--state-[a-z]+:[^;]*;/g, ''), /\b(?:separated|overlapping)\b/);
});

test('a receipt at the current version whose two judge counts disagree is refused (spec 043 AC-2)', () => {
  const { s, root } = fixtures();
  const split = JSON.parse(JSON.stringify(s.receipt));
  split.run.counts = { ...(split.run.counts || {}), judge_samples_per_generation: split.run.judge.samples + 7 };
  const sealed = sealReceipt(split);
  const v = validateReceipt(sealed);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => /differs from run\.judge\.samples/.test(e.message)), JSON.stringify(v.errors));
  const f = path.join(root, 'split.json');
  fs.writeFileSync(f, JSON.stringify(sealed, null, 2));
  assert.equal(cli(['validate', f], root).status, 1);
});

test('stale prints no verdict for a smoke receipt, in text or JSON', () => {
  const { s, root } = fixtures();
  const args = ['stale', s.file, '--model', MODEL, '--judge', MODEL, '--no-harness-check'];
  const text = cli(args, root).stdout;
  const json = cli([...args, '--json'], root).stdout;
  assert.ok(text.length, 'stale printed text');
  assert.equal(JSON.parse(json).receipts[0].verification_level, 'UNVERIFIED');
  const labels = ['PASSED', 'REGRESSED', 'NO_EFFECT', 'UNDERPOWERED', 'INCONCLUSIVE'].map((k) => plain.LABELS[k]);
  for (const out of [text, json]) {
    for (const l of labels) assert.ok(!out.includes(l), `stale carries ${l}`);
    assert.doesNotMatch(out, /\b(PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)\b|helped|hurt|no clear difference|no effect/i);
  }
});

test('a regrade of a smoke receipt carries the preset and stays below TESTED', () => {
  // The stub answers the run and the regrade's judge: nothing is spent, and the preset is read.
  const root = tmp();
  const dir = skill(root, 2);
  const stub = { DRIFTPROOF_STUB: '1' };
  const run = cli(['run', dir, '--quick', '--keep-transcripts', '--out', 'receipts'], root, stub);
  assert.equal(run.status, 0, run.stderr);
  const { file, receipt } = receiptIn(path.join(root, 'receipts'));
  const tdir = path.join(root, 'transcripts', receipt.receipt_hash);
  const kept = fs.readdirSync(tdir).filter((f) => f !== 'index.json').map((f) => JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8')));
  const answers = {};
  for (const c of receipt.results.cases) {
    const t = kept.find((x) => x.id === c.id && x.mode === c.mode);
    for (const d of c.generation.draws) answers[d.generation_hash] = t.generation;
  }
  fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({ answers }));
  const rg = cli(['regrade', file, '--skill', dir, '--answers', 'answers.json', '--judge-model', 'claude-sonnet-5', '--out', 'regraded'], root, stub);
  assert.equal(rg.status, 0, rg.stderr);
  // The regrade's provenance sidecar sits beside its receipt; the receipt is the hash-named file.
  const named = fs.readdirSync(path.join(root, 'regraded')).filter((f) => /[0-9a-f]{12}\.json$/.test(f));
  assert.equal(named.length, 1, `one regraded receipt: ${named}`);
  const out = JSON.parse(fs.readFileSync(path.join(root, 'regraded', named[0]), 'utf8'));
  assert.equal(out.run.preset, 'quick');
  assert.notEqual(out.verification_level, 'TESTED');
  assert.equal(validateReceipt(out).valid, true);
});

test('diff computes no verdict with a smoke receipt on either side', () => {
  const { c, s, root } = fixtures();
  const r = cli(['diff', c.file, s.file], root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NOT MEASURED|verdicts NOT computed/);
});

test('a receipt that names the preset and claims TESTED is refused by the schema, the badge, decide, the plain words, receiptVerdict, export and diff', () => {
  // export and diff verify a receipt's hash and do not validate it, as at the Base (spec 026 AC-7);
  // since A-139-5 receiptVerdict refuses a receipt that names a preset (route `smoke`), so export,
  // which reads through it, writes NOT_MEASURED, and diff counts a smoke receipt below TESTED.
  const { s, c, root } = fixtures();
  const forged = sealReceipt({ ...JSON.parse(JSON.stringify(s.receipt)), verification_level: 'TESTED' });
  assert.equal(validateReceipt(forged).valid, false);
  const dir = path.join(root, 'forged');
  fs.mkdirSync(dir);
  const f = path.join(dir, 'forged.json');
  fs.writeFileSync(f, JSON.stringify(forged, null, 2));
  assert.equal(cli(['badge', f], root).status, 4);
  assert.equal(cli(['decide', dir, '--models', MODEL], root).status, 4);
  assert.equal(plain.plainOf(forged).state, 'REFUSED');
  const v = receiptVerdict(forged);
  assert.equal(v.verdict, 'NOT_MEASURED');
  assert.deepEqual(v.notMeasured, ['smoke']);
  const e = cli(['export', f], root);
  assert.equal(e.status, 0, e.stderr);
  assert.equal(JSON.parse(e.stdout).verdict, 'NOT_MEASURED');
  const d = cli(['diff', c.file, f], root);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /verdicts NOT computed/);
  assert.doesNotMatch(d.stdout, /Per-case band-overlap verdicts:/);
});
