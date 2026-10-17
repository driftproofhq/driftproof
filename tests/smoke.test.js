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
const crypto = require('crypto');
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

// A-139-17 (issue 367): the preset is a first look, one case and two draws per arm.
test('the quick preset is two judge samples, concurrency four, one case and two draws per arm', () => {
  assert.deepEqual({ ...fr.QUICK }, { samples: 2, concurrency: 4, maxCases: 1, draws: 2 });
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
  // A-139-17: a quick run on a suite of more than one case is narrowed, and so incomplete too. The
  // forged fixture is cut from a one-case suite's quick run, so the smoke route alone refuses it.
  const one = skill(root, 1);
  const quick1 = cli(['run', one, '--quick', '--trusted-skill', '--models', MODEL, '--out', out('smoke1')], root);
  for (const [n, r] of [['control', control], ['quick', quick], ['quick7', quick7], ['quick1', quick1]]) assert.equal(r.status, 0, `${n}: ${r.stderr.slice(-800)}`);
  FX = { root, two, seven, control, quick, quick7, c: receiptIn(out('control')), s: receiptIn(out('smoke')), s7: receiptIn(out('smoke7')), s1: receiptIn(out('smoke1')), out };
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
  const { s1, c, root } = fixtures();
  const forged = sealReceipt({ ...JSON.parse(JSON.stringify(s1.receipt)), verification_level: 'TESTED' });
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

// ── A-139-17 (issue 367): a one-case first look, quiet setup on the first-run path, five-line help ──
// Every count is computed from QUICK; nothing here types the preset's numbers.

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const QUICK_CALLS = () => QUICK.maxCases * QUICK.draws * (2 + 2 * QUICK.samples);
const view = () => require('../lib/view');
const COMPARE = /\b(?:better|worse|helped|hurt|improved?|PASS|FAIL|BORDERLINE|PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)\b|lift|±|\b[01]\.\d{3}\b/i;

// The archive a quick run keeps, and the draw-0 text of each arm of its one case, each checked
// against the hash the receipt seals.
function archiveOf(root, receipt) {
  return JSON.parse(fs.readFileSync(path.join(root, 'transcripts', receipt.receipt_hash, 'answers.json'), 'utf8'));
}
function sealedFirstDraws(receipt, archive) {
  const ids = [...new Set(receipt.results.cases.map((c) => c.id))];
  assert.equal(ids.length, 1, 'a first look runs one test task');
  const out = {};
  for (const mode of ['with_skill', 'baseline']) {
    const row = receipt.results.cases.find((c) => c.id === ids[0] && c.mode === mode);
    const h = row.generation.draws[0].generation_hash;
    const text = archive.answers[h];
    assert.equal(typeof text, 'string', `${mode}: the archive holds draw 0's answer`);
    assert.equal(sha256(text), h, `${mode}: the archived text is the text the receipt seals`);
    out[mode] = text;
  }
  return out;
}

// AC-367-1: the counts a quick run prints and reports, against what its receipt records.
function readCounts(stdout, receipt) {
  const n = QUICK_CALLS();
  assert.match(stdout, new RegExp(`projected calls: ${n}/model\\b`), 'the projection is the preset\'s');
  assert.match(stdout, new RegExp(`\\(${n} calls\\)`), 'the calls made are the projection');
  for (const c of receipt.results.cases) {
    assert.equal(c.generation.n_planned, QUICK.draws, `${c.id}/${c.mode} n_planned`);
    assert.equal(c.generation.n_drawn, QUICK.draws, `${c.id}/${c.mode} n_drawn`);
    assert.equal(c.generation.stopping_reason, 'max_reached', `${c.id}/${c.mode} stopping_reason`);
  }
}

// The columns of a side-by-side block, read by the header's separator: the header is the two labels
// and nothing else, and every other line is a piece of one answer or the other.
const squash = (s) => s.replace(/\s+/g, '');
function columns(block) {
  assert.ok(Array.isArray(block) && block.length > 1, 'the renderer gives lines');
  const head = block[0];
  const at = head.indexOf(' | ');
  assert.ok(at > 0, 'the header has two columns');
  assert.equal(head.slice(0, at).trim(), 'with the skill');
  assert.equal(head.slice(at + 3).trim(), 'without the skill');
  const left = []; const right = [];
  for (const line of block.slice(1)) { left.push(line.slice(0, at)); right.push(line.slice(at + 3)); }
  return { left: squash(left.join('')), right: squash(right.join('')) };
}
// AC-367-3, AC-367-4: the side by side on stdout is the renderer's block over the sealed texts, the
// block holds the two answers and nothing else, and no line of the run compares them.
const COMPARATIVE = /\b(?:better|worse|helped|hurt|improved?)\b/i;
function readSideBySideStdout(stdout, texts) {
  const block = view().sideBySide(texts.with_skill, texts.baseline);
  const c = columns(block);
  assert.equal(c.left, squash(texts.with_skill), 'the left column is the with-skill answer');
  assert.equal(c.right, squash(texts.baseline), 'the right column is the baseline answer');
  assert.ok(stdout.includes(block.join('\n')), 'stdout carries the side by side of the two sealed answers');
  assert.doesNotMatch(stdout.replace(block.join('\n'), ''), COMPARATIVE, 'no line outside the answers compares them');
}
// AC-367-3 (the claim review's B2): outside the two answers, a quick run's stdout carries no outcome
// label and no score. A dollar figure is not a score.
const OUTCOME = /\b(?:PASS|FAIL|BORDERLINE)\b/i;
const SCORE = /(?<![$\w.])[01]\.\d{2,}(?![\w.])/;
function readNoScores(stdout, texts) {
  const rest = stdout.replace(view().sideBySide(texts.with_skill, texts.baseline).join('\n'), '');
  assert.doesNotMatch(rest, OUTCOME, 'an outcome label on a quick run\'s stdout');
  assert.doesNotMatch(rest, SCORE, 'a score on a quick run\'s stdout');
  assert.doesNotMatch(rest, /skill lift|±/, 'a lift or a band on a quick run\'s stdout');
}

// AC-367-6: the setup a quick run prints before its first call.
function readQuiet(r, skillName, caseId = 'c1') {
  const lines = r.stdout.split('\n');
  const first = lines.findIndex((l) => l.startsWith('── model:'));
  assert.ok(first >= 0, 'a model line');
  const setup = lines.slice(0, first).filter((l) => l.trim());
  assert.ok(setup.length <= 3, `at most three setup lines, read ${setup.length}:\n${setup.join('\n')}`);
  const text = setup.join('\n');
  for (const want of [skillName, MODEL, `projected calls: ${QUICK_CALLS()}`, `concurrency: ${QUICK.concurrency}`, 'projected cost', SMOKE_LINE]) assert.ok(text.includes(want), `the setup names ${want}`);
  assert.match(text, new RegExp(`\\(${caseId}\\b`), 'the setup names the test task by its id');
  assert.match(text, /\b1 test task\b/);
  for (const gone of ['content_hash:', 'registry:', 'answer capture:']) assert.ok(!text.includes(gone), `the quiet form leaves out ${gone}`);
  assert.match(r.stderr, /! WARNING: the judge is the target model/, 'the judge-is-target warning is not held back');
}

test('issue 367 AC-367-1: a quick run projects, makes and reports the preset\'s calls, two draws per arm', () => {
  const { s, quick } = fixtures();
  readCounts(quick.stdout, s.receipt);
  for (const plant of [quick.stdout.replace(`projected calls: ${QUICK_CALLS()}/model`, 'projected calls: 60/model'), quick.stdout.replace(`(${QUICK_CALLS()} calls)`, '(60 calls)')]) {
    assert.throws(() => readCounts(plant, s.receipt), assert.AssertionError);
  }
  const drawn = JSON.parse(JSON.stringify(s.receipt));
  drawn.results.cases[0].generation.stopping_reason = 'below_min';
  assert.throws(() => readCounts(quick.stdout, drawn), assert.AssertionError);
});

test('issue 367 AC-367-1: a quick run given --max-calls below its calls is refused before any call, naming them', () => {
  const root = tmp();
  const dir = skill(root, 2);
  const r = cli(['run', dir, '--quick', '--trusted-skill', '--models', MODEL, '--max-calls', String(QUICK_CALLS() - 1), '--out', path.join(root, 'o')], root);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, new RegExp(`projected ${QUICK_CALLS()} calls/model exceeds --max-calls ${QUICK_CALLS() - 1}`));
  assert.equal(fs.existsSync(path.join(root, 'o')), false);
});

test('issue 367 AC-367-2: the draw cap is honoured only for a run that names the preset', () => {
  const root = tmp();
  const dir = skill(root, 1);
  const script = `const { runSkillOnModel } = require(${JSON.stringify(path.join(ROOT, 'lib', 'run.js'))});
const { loadSkill } = require(${JSON.stringify(path.join(ROOT, 'lib', 'skill.js'))});
(async () => {
  const out = {};
  for (const [k, opts] of [['plain', { draws: 2 }], ['preset', { draws: 2, preset: 'quick' }]]) {
    const { receipt } = await runSkillOnModel({ skill: loadSkill(process.argv[1]), model: 'haiku', opts: { samples: 2, maxCalls: 1000, ...opts } });
    out[k] = { preset: receipt.run.preset || null, level: receipt.verification_level, drawn: receipt.results.cases.map((c) => c.generation.n_drawn) };
  }
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });`;
  const r = spawnSync(process.execPath, ['-e', script, dir], { cwd: root, env: env({ DRIFTPROOF_STUB: '1' }), encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const { SAMPLING } = require('../lib/sampling');
  assert.equal(out.plain.preset, null);
  for (const n of out.plain.drawn) assert.ok(n >= SAMPLING.min, `a run with no preset draws by the sampling rule: ${n}`);
  assert.equal(out.preset.preset, 'quick');
  assert.equal(out.preset.level, 'UNVERIFIED');
  for (const n of out.preset.drawn) assert.equal(n, QUICK.draws);
});

test('issue 367 AC-367-3, AC-367-4: stdout shows draw 0 of each arm side by side, as sealed, and compares nothing', () => {
  const { s, quick, root } = fixtures();
  const texts = sealedFirstDraws(s.receipt, archiveOf(root, s.receipt));
  assert.notEqual(texts.with_skill, texts.baseline, 'the fixture\'s two answers differ, so a swap is visible');
  readSideBySideStdout(quick.stdout, texts);
  assert.ok(quick.stdout.lastIndexOf(SMOKE_LINE) > quick.stdout.indexOf(view().sideBySide(texts.with_skill, texts.baseline)[0]), 'the plain line is said after the answers');
  assert.throws(() => readSideBySideStdout(quick.stdout, { with_skill: texts.baseline, baseline: texts.with_skill }), assert.AssertionError, 'arms swapped');
  const block = view().sideBySide(texts.with_skill, texts.baseline).join('\n');
  assert.throws(() => readSideBySideStdout(quick.stdout.replace(block, `${block}\n  with the skill scored better`), texts), assert.AssertionError, 'a comparison added');
});

test('issue 367 AC-367-3: outside the two answers a quick run prints no outcome label and no score', () => {
  const { s, quick, control, root } = fixtures();
  const texts = sealedFirstDraws(s.receipt, archiveOf(root, s.receipt));
  readNoScores(quick.stdout, texts);
  assert.match(control.stdout, /skill lift/, 'a run without --quick still prints its result');
  for (const plant of ['  c1 / with_skill: PASS (0.90 ± 0.00)\n', '  → smoke run: with 0.90 vs base 0.40\n', '  c1 / baseline: borderline\n']) {
    assert.throws(() => readNoScores(quick.stdout + plant, texts), assert.AssertionError, plant);
  }
});

test('issue 367 AC-367-1: the one test task is the first in the suite, and the setup names it', () => {
  const { s, quick } = fixtures();
  const readCase = (receipt, stdout) => {
    const ids = [...new Set(receipt.results.cases.map((c) => c.id))];
    assert.deepEqual(ids, ['c1'], 'the first case in file order');
    readQuiet({ stdout, stderr: quick.stderr }, 'fx-skill-2', ids[0]);
  };
  readCase(s.receipt, quick.stdout);
  const other = JSON.parse(JSON.stringify(s.receipt));
  for (const c of other.results.cases) c.id = 'c2';
  assert.throws(() => readCase(other, quick.stdout), assert.AssertionError, 'another case run');
});

test('issue 367 AC-367-1: a draw that does not reach the judge is named with its reason', () => {
  const { s } = fixtures();
  const lines = fr.unmeasuredLines(s.receipt);
  assert.deepEqual(lines, [], 'every draw of the fixture reached the judge');
  const r = JSON.parse(JSON.stringify(s.receipt));
  const row = r.results.cases.find((c) => c.mode === 'baseline');
  Object.assign(row.generation.draws[1], { status: 'unmeasured', reason: 'empty generation (the surface returned no text)', mean: null, samples: [] });
  const named = fr.unmeasuredLines(r);
  assert.equal(named.length, 1);
  assert.match(named[0], new RegExp(`${row.id} / baseline draw 1`));
  assert.ok(named[0].includes('empty generation (the surface returned no text)'));
});

test('issue 367 AC-367-4: an unmeasured draw 0 is labelled, and control characters are made visible', () => {
  const { s, root } = fixtures();
  const archive = archiveOf(root, s.receipt);
  const r = JSON.parse(JSON.stringify(s.receipt));
  const row = r.results.cases.find((c) => c.mode === 'with_skill');
  Object.assign(row.generation.draws[0], { status: 'unmeasured', reason: 'generation truncated at the output cap (stop_reason max_tokens)', mean: null, stddev: null, samples: [] });
  Object.assign(row.generation, require('../lib/sampling').acrossDraws(row.generation.draws));
  const look = view().firstLookOf(r, archive.answers);
  assert.match(look.arms.with_skill.note || '', /not measured: generation truncated at the output cap/);
  assert.equal(look.arms.baseline.note, null, 'a measured draw 0 carries no label');
  const page = firstLookOf(firstLookBox(sealReceipt(r), archive));
  assert.match(page.with_skill, /not measured: generation truncated at the output cap/);

  const hostile = 'ok\u001b[8mhidden\u001b[0m\rover\u009b2J\u0007end\ttab';
  const block = view().sideBySide(hostile, 'plain');
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(block.join('\n')), 'no control character reaches the terminal');
  assert.ok(block.join('\n').includes('\\x1b[8m'), 'the escape is shown as text');
  const html = view().firstLookHtml({ with_skill: { text: hostile }, baseline: { text: 'plain' } });
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(html), 'no control character reaches the page');
  assert.ok(html.includes('\\x1b[8m'));
});

test('issue 367 AC-367-5: a quick run from the skill folder is refused, writing nothing there', () => {
  const root = tmp();
  const dir = skill(root, 1);
  const before = fs.readdirSync(dir).sort();
  const r = cli(['run', '.', '--quick'], dir, { DRIFTPROOF_STUB: '1' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /REFUSED \(run\)[^\n]*Run it from the folder above the skill/);
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'no receipts or transcripts under the skill');
  const sub = path.join(dir, 'notes');
  fs.mkdirSync(sub);
  assert.equal(cli(['run', '..', '--quick'], sub, { DRIFTPROOF_STUB: '1' }).status, 2, 'from inside the skill folder too');
});

test('issue 367 AC-367-4: the side-by-side renderer puts the with-skill answer on the left, every character kept', () => {
  const left = 'Use a short subject line.\nThen a blank line, then the body, wrapped at seventy-two characters.';
  const right = 'Write what changed.';
  const c = columns(view().sideBySide(left, right));
  assert.equal(c.left, squash(left));
  assert.equal(c.right, squash(right));
  const swapped = columns(view().sideBySide(right, left));
  assert.notEqual(swapped.left, squash(left), 'the order is the arguments\' order');
});

// AC-367-5: the receipt records what the run kept, and the run names where it kept it.
function readKept(receipt, stdout, root) {
  const archive = path.join(root, 'transcripts', receipt.receipt_hash, 'answers.json');
  assert.ok(fs.existsSync(archive), 'the answers are kept under the working directory');
  assert.equal(receipt.run.transcripts, 'retained-local', 'the receipt records the answers as kept');
  assert.ok(stdout.includes(path.join('transcripts', receipt.receipt_hash)), 'the output names the folder');
}
test('issue 367 AC-367-5: a quick run keeps its answers under the working directory and its receipt says so', () => {
  const { s, quick, root } = fixtures();
  readKept(s.receipt, quick.stdout, root);
  assert.throws(() => readKept({ ...s.receipt, run: { ...s.receipt.run, transcripts: 'hashes-only' } }, quick.stdout, root), assert.AssertionError, 'hashes-only beside a written archive');
});

// AC-367-4, AC-367-5: the view page's first look, read from a folder that holds receipts/ and transcripts/.
function firstLookOf(html) {
  const m = /<[a-z]+ [^>]*data-field="first-look"[^>]*>[\s\S]*?<!-- \/first-look -->/.exec(html);
  assert.ok(m, 'the page has a first-look block');
  const arm = (mode) => {
    const a = new RegExp(`data-arm="${mode}"[^>]*>([\\s\\S]*?)(?=data-arm="|<!-- /first-look -->)`).exec(m[0]);
    assert.ok(a, `a ${mode} column`);
    return a[1];
  };
  return { block: m[0], with_skill: arm('with_skill'), baseline: arm('baseline') };
}
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function firstLookBox(receipt, archive) {
  const box = tmp();
  fs.mkdirSync(path.join(box, 'receipts'));
  fs.writeFileSync(path.join(box, 'receipts', 'r-quick.json'), JSON.stringify(receipt, null, 2));
  const tdir = path.join(box, 'transcripts', receipt.receipt_hash);
  fs.mkdirSync(tdir, { recursive: true });
  if (archive) fs.writeFileSync(path.join(tdir, 'answers.json'), JSON.stringify(archive, null, 2));
  return view().renderView(path.join(box, 'receipts'), { now: new Date('2026-10-16T00:00:00Z'), label: 'receipts' }).html;
}

test('issue 367 AC-367-4: the view shows draw 0 of each arm side by side, checked against the sealed hash', () => {
  const { s, root } = fixtures();
  const archive = archiveOf(root, s.receipt);
  const texts = sealedFirstDraws(s.receipt, archive);
  const look = firstLookOf(firstLookBox(s.receipt, archive));
  assert.ok(look.with_skill.includes(escHtml(texts.with_skill)), 'the with-skill column holds its sealed answer');
  assert.ok(look.baseline.includes(escHtml(texts.baseline)), 'the baseline column holds its sealed answer');
  assert.ok(!look.with_skill.includes(escHtml(texts.baseline)), 'the arms are not swapped');
  assert.doesNotMatch(look.block.replace(escHtml(texts.with_skill), '').replace(escHtml(texts.baseline), ''), COMPARE);

  // An archive edited after the run: no text is shown for that arm, and the page says why.
  const edited = JSON.parse(JSON.stringify(archive));
  const h = s.receipt.results.cases.find((c) => c.mode === 'with_skill').generation.draws[0].generation_hash;
  edited.answers[h] = 'an answer nobody was returned';
  const e = firstLookOf(firstLookBox(s.receipt, edited));
  assert.ok(!e.with_skill.includes('an answer nobody was returned'), 'an edited text is not shown');
  assert.match(e.with_skill, /does not match/);
  // No archive: no text, and the page says why.
  const none = firstLookOf(firstLookBox(s.receipt, null));
  assert.ok(!none.with_skill.includes(escHtml(texts.with_skill)));
  assert.match(none.with_skill, /not found/);

  // Draw 1 differs from draw 0 (resealed): the page still shows draw 0.
  const r2 = JSON.parse(JSON.stringify(s.receipt));
  const row = r2.results.cases.find((c) => c.mode === 'with_skill');
  const other = 'a second draw that came back different';
  row.generation.draws[1].generation_hash = sha256(other);
  const sealed2 = sealReceipt(r2);
  const a2 = JSON.parse(JSON.stringify(archive));
  a2.answers[sha256(other)] = other;
  const d = firstLookOf(firstLookBox(sealed2, a2));
  assert.ok(d.with_skill.includes(escHtml(texts.with_skill)) && !d.with_skill.includes(other), 'draw 0 is shown, not draw 1');
});

test('issue 367 AC-367-5: the first look is escaped text, and the page still loads nothing', () => {
  const html = view().firstLookHtml({ with_skill: { text: '<script>alert(1)</script></p>' }, baseline: { text: '<img src=x onerror=alert(2)>' } });
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;&lt;/p&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'));
  assert.ok(!/<script|<img/i.test(html), 'no answer becomes markup');
  const { s, root } = fixtures();
  const page = firstLookBox(s.receipt, archiveOf(root, s.receipt));
  assert.ok(page.includes(`content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:"`));
  assert.equal((page.match(/<script\b/g) || []).length, 1, 'one inline script');
  assert.doesNotMatch(page, /\s(?:src|href)\s*=\s*["']?(?:https?:|\/\/|file:)|url\(\s*["']?(?:https?:|\/\/|file:)/i);
});

test('issue 367 AC-367-6: a quick run says what runs in at most three lines, and holds back no warning', () => {
  const { quick, control } = fixtures();
  readQuiet(quick, 'fx-skill-2');
  for (const want of ['content_hash:', 'registry:', 'answer capture:']) assert.ok(control.stdout.includes(want), `a run without --quick still prints ${want}`);
  assert.throws(() => readQuiet({ ...quick, stderr: quick.stderr.replace(/ *! WARNING: the judge is the target model[^\n]*\n/, '') }, 'fx-skill-2'), assert.AssertionError, 'the warning held back');
  assert.throws(() => readQuiet({ ...quick, stdout: quick.stdout.replace('── model:', '  isolation: same-user\n── model:') }, 'fx-skill-2'), assert.AssertionError, 'a fourth line');
  assert.throws(() => readQuiet(control, 'fx-skill-2'), assert.AssertionError, 'a run without --quick is not quiet');
});

// AC-367-8: driftproof with no argument, and the full list.
const LONG_FLAGS = ['--help', '-h', 'help'];
// A CLI command by its name, a plugin slash command as written (`/driftproof:start`).
function commandsOf(text) {
  return new Set([...text.matchAll(/(\/driftproof:|\bdriftproof )([a-z][a-z-]*)\b/g)].map((m) => (m[1] === '/driftproof:' ? `${m[1]}${m[2]}` : m[2])));
}
function readShort(r, full) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  const lines = r.stdout.replace(/\n$/, '').split('\n');
  assert.equal(lines.length, 5, `five lines, read ${lines.length}`);
  assert.match(lines[0], /^start here\b/i);
  assert.ok(lines[0].includes('driftproof init <skill-dir>'), 'the first line names the first command');
  const known = commandsOf(full);
  for (const c of commandsOf(r.stdout)) assert.ok(known.has(c), `a command the full list names: ${c}`);
  const quickLine = lines.find((l) => l.includes('--quick'));
  if (quickLine) assert.match(quickLine, /no verdict/);
  // A-139-21 (issue 378): the em dash is no longer read.
  assert.doesNotMatch(r.stdout, /\bconfiden(ce|t)\b|\bstatistically\b|\bsignifican(t|ce)\b/i);
}

test('issue 367 AC-367-8: driftproof with no argument prints five lines, the first naming the command to run first', async () => {
  const { LEXICON } = await import('../specs/031-artefact-claims/probes/bands.mjs');
  const root = tmp();
  const full = cli(['--help'], root);
  assert.equal(full.status, 0);
  for (const c of ['overlap', 'init', 'run', 'plan', 'lint-suite', 'diff', 'regrade', 'stale', 'view', 'validate', 'badge', 'decide', 'import', 'export']) assert.ok(commandsOf(full.stdout).has(c), `the full list names ${c}`);
  for (const f of LONG_FLAGS) assert.equal(cli([f], root).stdout, full.stdout, `${f} prints the full list`);
  const short = cli([], root);
  readShort(short, full.stdout);
  for (const { cls, re } of LEXICON) assert.equal(re.test(short.stdout.replace(/\s+/g, ' ')), false, `spec 031 lexicon: ${cls}`);
  assert.throws(() => readShort({ ...short, stdout: full.stdout }, full.stdout), assert.AssertionError, 'the full list on no argument');
  assert.throws(() => readShort({ ...short, stdout: short.stdout.replace(/^start here/i, 'Welcome') }, full.stdout), assert.AssertionError);
  assert.throws(() => readShort({ ...short, stdout: short.stdout.replace(/\n[^\n]*\n$/, '\n  driftproof frobnicate <dir>\n') }, full.stdout), assert.AssertionError);
  // Plants: a slash command the full list does not name, and the full list without /driftproof:start.
  assert.ok(commandsOf(short.stdout).has('/driftproof:start'), 'the reader reads the slash command');
  assert.throws(() => readShort({ ...short, stdout: short.stdout.replace('/driftproof:start', '/driftproof:frobnicate') }, full.stdout), assert.AssertionError);
  assert.throws(() => readShort(short, full.stdout.replaceAll('/driftproof:start', 'the guided start')), assert.AssertionError);
  // An error path that printed the full list still does.
  const bare = cli(['run'], root);
  assert.equal(bare.status, 2);
  assert.equal(bare.stdout, full.stdout);
});

test('issue 367 AC-367-9: the help, the receipt spec and the methodology page say the preset\'s numbers', () => {
  const root = tmp();
  const full = cli(['--help'], root).stdout;
  const docs = { help: full };
  for (const f of ['spec/RECEIPT.md', 'docs/methodology/index.html', 'docs/methodology/index.md', 'docs/llms-full.txt']) docs[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const [name, text] of Object.entries(docs)) {
    const flat = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    assert.doesNotMatch(flat, /at most (?:5|five) cases/i, `${name} still says at most five cases`);
    assert.ok(flat.includes('one test task'), `${name} says one test task`);
    assert.doesNotMatch(flat, /its test tasks run|its suite run/, `${name} says the run checks more tasks than it runs`);
    assert.ok(flat.includes(`${QUICK.draws} draws per arm`), `${name} says ${QUICK.draws} draws per arm`);
    assert.ok(flat.includes(`${QUICK.samples} judge samples`), `${name} says ${QUICK.samples} judge samples`);
    assert.match(flat, /cannot produce a verdict/, `${name} says a smoke run cannot produce a verdict`);
  }
});

test('issue 367 AC-367-10: plan reads the quick case\'s spread and names every other case as unmeasured', () => {
  const { s, two, root } = fixtures();
  const planOf = (file) => cli(['plan', two, '--model', MODEL, '--judge-model', MODEL, '--from', file], root);
  const r = planOf(s.file);
  assert.equal(r.status, 0, r.stderr);
  const id = s.receipt.results.cases[0].id;
  const other = ['c1', 'c2'].find((x) => x !== id);
  assert.doesNotMatch(r.stdout, new RegExp(`Case "${id}": unknown power`), 'the quick case has spread');
  assert.match(r.stdout, new RegExp(`Case "${other}": unknown power`), 'the case the quick run did not run is named');
  // Plant: one draw per arm leaves plan nothing to read for that case.
  const one = JSON.parse(JSON.stringify(s.receipt));
  const { acrossDraws } = require('../lib/sampling');
  for (const c of one.results.cases) {
    c.generation.draws = c.generation.draws.slice(0, 1);
    Object.assign(c.generation, acrossDraws(c.generation.draws));
    if (c.counts && Number.isInteger(c.counts.generations_per_arm)) c.counts.generations_per_arm = 1;
  }
  if (one.run.counts && Number.isInteger(one.run.counts.generations_per_arm)) one.run.counts.generations_per_arm = 1;
  const f = path.join(root, 'one-draw.json');
  fs.writeFileSync(f, JSON.stringify(sealReceipt(one), null, 2));
  const p = planOf(f);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, new RegExp(`Case "${id}": unknown power`), 'one draw per arm reads unknown');
});
