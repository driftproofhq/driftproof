// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 265 (issue 265): `driftproof import <dir> --from nvidia-cards --commit <sha>`, spec 117. Each
// criterion has a reader here that shares no code with lib/importers-nvidia.js: the cards and
// benchmarks.json are parsed again from disk by tests/nvidia-reader.js, every receipt is rebuilt on its
// own, and each reader is shown to fail a planted subject. The fixtures are real cards at the pinned
// commit (tests/fixtures/nvidia/README.md); each test copies them into a temporary git checkout,
// committed with a fixed author, date and message, and negative inputs are copies changed there.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const R = require('./nvidia-reader');

const { EM, ARROW, REASON, T, fill, sha256, gitSha1, clone, oracle, problems, figureProblems, checkAgainst, headOf, printedNumbers, parseCard, figuresOf, UNKNOWN_FIELDS } = R;
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const SPEC = path.join(ROOT, 'specs', '265-nvidia-cards-import');
const PROVE = path.join(SPEC, 'probes', 'prove.mjs');
const FIX = path.join(__dirname, 'fixtures', 'nvidia');
const SRC = path.join(FIX, 'skills-source');
const CARDS = fs.readdirSync(path.join(SRC, 'skills')).sort();
const ONLY = CARDS.join(',');
const AT = '2026-10-14T12:00:00.000Z';
const PINNED = '14a98ae278cec7e867695189d0f4003c08e4f765';

const lib = () => require('../lib/importers-nvidia');
const { validateReceipt, verifyReceiptHash, sealReceipt } = require('../lib/receipt');

// ── checkouts ───────────────────────────────────────────────────────────────
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `spec265-${tag}-`));
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name); const b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b); else fs.copyFileSync(a, b);
  }
}
// git with a fixed author, date and message, so the same files give the same commit (AC-18, AC-24).
// The name and the address are the tag `spec265`, not a person's.
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_AUTHOR_NAME: 'spec265', GIT_AUTHOR_EMAIL: 'spec265', GIT_COMMITTER_NAME: 'spec265', GIT_COMMITTER_EMAIL: 'spec265', GIT_AUTHOR_DATE: '2026-10-14T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-14T00:00:00Z', GIT_CONFIG_NOSYSTEM: '1' };
function gitIn(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function commitAll(dir, message = 'fixture') { gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '--allow-empty', '-m', message); return headOf(dir); }
// A git checkout of the fixture source, changed by `edit(dir)` before its commit.
function checkout(tag, edit) {
  const d = path.join(tmp(tag), 'skills-source');
  copyTree(SRC, d);
  if (edit) edit(d);
  gitIn(d, 'init', '-q');
  commitAll(d);
  return d;
}
let baseDir = null;
const BASE = () => baseDir || (baseDir = checkout('base'));
const cardPath = (d, cd) => path.join(d, 'skills', cd, 'BENCHMARK.md');
const editCard = (d, cd, f) => fs.writeFileSync(cardPath(d, cd), f(fs.readFileSync(cardPath(d, cd), 'utf8')));
const editBench = (d, f) => { const p = path.join(d, 'benchmarks.json'); const j = JSON.parse(fs.readFileSync(p, 'utf8')); f(j); fs.writeFileSync(p, JSON.stringify(j, null, 2)); };
// benchmarks.json cut to the fixture skills, its counts set to match (AC-18's whole import).
const cutBench = (x) => editBench(x, (j) => {
  j.skills = j.skills.filter((s) => CARDS.includes(s.catalog_dir));
  j.results = j.results.filter((r) => CARDS.includes(r.catalog_dir));
  j.skills_without_results = j.skills_without_results.filter((c) => CARDS.includes(c));
  j.skill_count = j.skills.length; j.result_row_count = j.results.length;
});

function runImport(dir, only = CARDS, importedAt = AT, commit = headOf(dir)) { return lib().importNvidiaCards(dir, { commit, only, importedAt }); }
const want = (dir, only = CARDS, importedAt = AT) => oracle(dir, only, { importedAt, commit: headOf(dir) });
function cli(args, opts = {}) { return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: opts.cwd || ROOT, env: { ...process.env, ...(opts.env || {}) } }); }
const importArgs = (dir, only, out, commit = headOf(dir)) => ['import', dir, '--from', 'nvidia-cards', ...(commit ? ['--commit', commit] : []), ...(only ? ['--only', only.join(',')] : []), '--out', out];
const listed = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);
const receiptOf = (got, cd, agent) => { const x = got.receipts.find((r) => r.skill === cd && r.agent === agent); assert.ok(x, `no receipt for ${cd} ${agent}`); return x.receipt; };
function refusedBoth(dir, only, re, tag, commit = headOf(dir)) {
  assert.throws(() => runImport(dir, only, AT, commit), (e) => e instanceof lib().NvidiaRefused && re.test(e.message), `${tag}: the function refuses`);
  const out = tmp(`${tag.replace(/[^A-Za-z0-9-]/g, '_')}-out`);
  const r = cli(importArgs(dir, only, out, commit));
  assert.equal(r.status, 1, `${tag}: the CLI exits 1 (stderr: ${r.stderr.slice(0, 300)})`);
  assert.match(r.stderr, re, `${tag}: the CLI names the reason`);
  assert.deepEqual(listed(out), [], `${tag}: no file is written`);
}
// A checkout changed after its commit: the files on disk are not the commit's.
function dirty(tag, edit) { const d = checkout(tag); edit(d); return d; }

// ── fixtures ────────────────────────────────────────────────────────────────
test('fixtures: each file is the pinned commit\'s bytes, by its git blob sha1', () => {
  const s = JSON.parse(fs.readFileSync(path.join(FIX, 'SOURCES.json'), 'utf8'));
  assert.equal(s.commit, PINNED);
  for (const f of s.files) assert.equal(gitSha1(fs.readFileSync(path.join(FIX, f.file))), f.git_blob_sha1, f.file);
  assert.deepEqual(s.selection.skills, CARDS);
  for (const l of ['LICENSE-CC-BY-4.0', 'LICENSE-APACHE', 'README.md']) assert.ok(fs.existsSync(path.join(FIX, l)), l);
  // The reader parses every fixture cell by a shape.
  let cells = 0;
  for (const cd of CARDS) {
    const card = parseCard(fs.readFileSync(cardPath(SRC, cd), 'utf8'));
    for (const r of card.table ? card.table.rows : []) for (const a of card.table.agents) { assert.notEqual(figuresOf(r.cells[a], card.newer), undefined, `${cd} ${a} ${r.dimension}`); cells++; }
  }
  assert.ok(cells > 100);
  assert.equal(JSON.parse(fs.readFileSync(path.join(SRC, 'benchmarks.json'), 'utf8')).schema_version, 2);
});

// ── AC-1, one receipt per pair with results ─────────────────────────────────
test('AC-1: one receipt per pair with results; a column with no results gets none and is listed', () => {
  const w = want(BASE());
  const got = runImport(BASE());
  assert.deepEqual(got.receipts.map((r) => `${r.skill}|${r.agent}`), w.receipts.map((r) => `${r.skill}|${r.agent}`));
  const bench = JSON.parse(fs.readFileSync(path.join(SRC, 'benchmarks.json'), 'utf8'));
  const pairs = new Set(bench.results.filter((r) => CARDS.includes(r.catalog_dir)).map((r) => `${r.catalog_dir}|${r.agent}`));
  assert.equal(got.receipts.length, pairs.size);
  assert.deepEqual(got.receipts.filter((r) => r.skill === 'i4h-workflow-scene-edit').map((r) => r.agent), ['codex']);
  assert.equal(got.receipts.filter((r) => r.skill === 'nemoclaw-user-guide' || r.skill === 'rag-eval').length, 0);
  assert.deepEqual(got.report.pairs_without_results, [{ skill: 'i4h-workflow-scene-edit', agent: 'claude-code' }, { skill: 'nemoclaw-user-guide', agent: 'claude-code' }, { skill: 'nemoclaw-user-guide', agent: 'codex' }]);
  const d = checkout('mixed', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace(`| Security | 23.1% ${ARROW} 61.5% (+38.4 points) |`, '| Security | Not available |')));
  refusedBoth(d, ['accelerated-computing-cudf'], /accelerated-computing-cudf.*claude-code|claude-code.*accelerated-computing-cudf/, 'mixed column');
});

test('AC-1: each receipt has its own file; the two agents of one card never share one; the same import names the same files', () => {
  const a = tmp('names-a'); const b = tmp('names-b');
  for (const out of [a, b]) { const r = cli(importArgs(BASE(), CARDS, out)); assert.equal(r.status, 0, r.stderr); }
  const files = listed(a).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, want(BASE()).receipts.length);
  assert.deepEqual(listed(b), listed(a));
  for (const f of files) assert.match(f, /imported-nvidia-cards-(?:claude-code|codex)/);
  assert.deepEqual(runImport(BASE()).receipts.map((x) => `${x.name}.json`).sort(), files);
});

// ── AC-2, every card matched to its index row ───────────────────────────────
test('AC-2: a whole import needs a card for every index row and an index row for every card', () => {
  refusedBoth(BASE(), null, /no card|card.*missing|394/, 'the fixture checkout whole');
  refusedBoth(BASE(), ['not-a-skill'], /not-a-skill/, '--only an absent skill');
  refusedBoth(checkout('stray', (x) => copyTree(path.join(x, 'skills', 'doca-aes-gcm'), path.join(x, 'skills', 'stray-card'))), ['stray-card'], /stray-card/, 'a card with no skills row');
  refusedBoth(checkout('v3', (x) => editBench(x, (j) => { j.schema_version = 3; })), CARDS, /schema_version/, 'schema_version 3');
  refusedBoth(checkout('rows', (x) => editBench(x, (j) => { j.result_row_count += 1; })), CARDS, /result_row_count/, 'result_row_count off by one');
  refusedBoth(checkout('hasres', (x) => editBench(x, (j) => { j.skills.find((s) => s.catalog_dir === 'rag-eval').has_results = true; })), CARDS, /rag-eval/, 'has_results against skills_without_results');
  refusedBoth(checkout('nobench', (x) => fs.rmSync(path.join(x, 'benchmarks.json'))), CARDS, /benchmarks\.json/, 'no benchmarks.json');
});

// ── AC-3, figures as printed ────────────────────────────────────────────────
test('AC-3: every row is the card cell byte for byte, its numbers read by the closed set of shapes', () => {
  const got = runImport(BASE());
  for (const x of got.receipts) assert.deepEqual(figureProblems(x.receipt, BASE()), [], `${x.skill} ${x.agent}`);
  const r = receiptOf(got, 'accelerated-computing-cudf', 'claude-code');
  const security = r.source_figures.rows.find((x) => x.dimension === 'Security');
  assert.deepEqual(security, { dimension: 'Security', printed: `23.1% ${ARROW} 61.5% (+38.4 points)`, score_pct: 61.5, baseline_pct: 23.1, uplift: 38.4, uplift_unit: 'points', tasks: null });
  const correctness = r.source_figures.rows.find((x) => x.dimension === 'Correctness');
  assert.equal(correctness.uplift, 0);
  assert.equal(r.source_figures.rows[0].dimension, 'Overall');
  assert.equal(r.source_figures.rows[0].printed, `81.5% ${EM} baseline ran, but no comparable score was available; uplift unavailable`);
  const p1 = clone(r); p1.source_figures.rows[1].printed += ' '; assert.notDeepEqual(figureProblems(p1, BASE()), []);
  const p2 = clone(r); p2.source_figures.rows[1].score_pct = 61.6; assert.notDeepEqual(figureProblems(p2, BASE()), []);
  refusedBoth(checkout('shape', (x) => editCard(x, 'amc-setup-calibration-stack', (t) => t.replace('| 84% (+33%)', '| 84 % (+33%)'))), ['amc-setup-calibration-stack'], /84 % \(\+33%\)/, 'a cell of no shape');
  refusedBoth(checkout('unit', (x) => editCard(x, 'amc-setup-calibration-stack', (t) => t.replace('| 84% (+33%)', '| 84% (+33 points)'))), ['amc-setup-calibration-stack'], /Correctness/, 'points on an older card');
  // `\u00b1` reads 0 only where U is zero, on the Overall row as on a dimension row.
  refusedBoth(checkout('pm-overall', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace(`| Overall | 81.5% ${EM} baseline ran, but no comparable score was available; uplift unavailable |`, `| Overall | 81.0% ${ARROW} 81.5% (\u00b10.5 points) |`))), ['accelerated-computing-cudf'], /Overall/, '\u00b10.5 on the Overall row');
  refusedBoth(checkout('pm-dim', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace(`| Correctness | 100.0% ${ARROW} 100.0% (\u00b10.0 points) |`, `| Correctness | 100.0% ${ARROW} 100.0% (\u00b10.5 points) |`))), ['accelerated-computing-cudf'], /Correctness/, '\u00b10.5 on a dimension row');
});

// ── AC-4, every value appears in the card or in benchmarks.json ─────────────
test('AC-4: card and benchmarks.json must agree; a disagreement refuses, naming the field and both values', () => {
  refusedBoth(checkout('cardscore', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace(`23.1% ${ARROW} 61.5% (+38.4 points)`, `23.1% ${ARROW} 61.6% (+38.5 points)`))), ['accelerated-computing-cudf'], /score_pct.*61\.6.*61\.5|score_pct.*61\.5.*61\.6/, 'a card score changed');
  refusedBoth(checkout('benchup', (x) => editBench(x, (j) => { j.results.find((r) => r.catalog_dir === 'doca-aes-gcm' && r.agent === 'codex' && r.dimension === 'Efficiency').uplift_pct = 65; })), ['doca-aes-gcm'], /uplift/, 'a benchmarks.json uplift changed');
  refusedBoth(checkout('attempts', (x) => editBench(x, (j) => { j.skills.find((s) => s.catalog_dir === 'data-designer').attempts_per_task = 3; })), ['data-designer'], /attempts_per_task/, 'attempts_per_task changed');
  refusedBoth(checkout('attempts-word', (x) => editCard(x, 'data-designer', (t) => t.replace('- Attempts per task: 2', '- Attempts per task: two'))), ['data-designer'], /Attempts per task/, 'an attempts line of no shape');
  const r = clone(receiptOf(runImport(BASE()), 'doca-aes-gcm', 'codex'));
  r.source_figures.rows[0].score_pct = 99;
  assert.notDeepEqual(figureProblems(r, BASE()), [], 'a figure the card does not print fails the reader');
  // dataset_digest is the value in backticks; the note in parentheses is not carried.
  const cudf = receiptOf(runImport(BASE()), 'accelerated-computing-cudf', 'codex');
  assert.equal(cudf.source_figures.dataset_digest, 'sha256:307ff81fa3f0d04ee89889dcedc5ac0208fc0eb5dba112e1c8ed515a08fa3ba9');
});

// ── AC-5, an unstated unit stays unstated ───────────────────────────────────
test('AC-5: a bare percent uplift carries uplift_unit unstated and no baseline; a stated one carries both', () => {
  const got = runImport(BASE());
  const r = receiptOf(got, 'amc-setup-calibration-stack', 'claude-code');
  assert.deepEqual(r.source_figures.rows.find((x) => x.dimension === 'Correctness'), { dimension: 'Correctness', printed: '84% (+33%)', score_pct: 84, baseline_pct: null, uplift: 33, uplift_unit: 'unstated', tasks: 6 });
  assert.ok(r.run.import.notices.includes(T.unit));
  const p1 = clone(r); p1.source_figures.rows.find((x) => x.dimension === 'Correctness').baseline_pct = 51; assert.notDeepEqual(figureProblems(p1, BASE()), []);
  const p2 = clone(r); p2.source_figures.rows.find((x) => x.dimension === 'Correctness').uplift_unit = 'points'; assert.notDeepEqual(figureProblems(p2, BASE()), []);
  const n = clone(receiptOf(got, 'accelerated-computing-cudf', 'claude-code')); n.source_figures.rows.find((x) => x.dimension === 'Security').baseline_pct = null; assert.notDeepEqual(figureProblems(n, BASE()), []);
  for (const row of r.source_figures.rows) assert.equal(row.baseline_pct, null, row.dimension);
  assert.equal(Object.hasOwn(r, 'economics'), false);
});

// ── AC-6, the mark and the block are hashed ─────────────────────────────────
test('AC-6: the mark and source_figures sit inside receipt_hash', () => {
  const r = receiptOf(runImport(BASE()), 'accelerated-computing-cudf', 'codex');
  assert.ok(verifyReceiptHash(r));
  assert.equal(r.uncertainty_unavailable, 'aggregates_only');
  const plants = [
    (x) => { delete x.uncertainty_unavailable; },
    (x) => { delete x.source_figures; },
    (x) => { x.source_figures.rows[2].printed += ' '; },
    (x) => { x.source_figures.rows[1].uplift_unit = 'unstated'; },
    (x) => { x.source_figures.source.commit = 'f'.repeat(40); },
  ];
  for (const plant of plants) {
    const p = clone(r); plant(p);
    assert.equal(verifyReceiptHash(p), false, String(plant));
    assert.notEqual(sealReceipt(p).receipt_hash, r.receipt_hash, String(plant));
  }
});

// ── AC-7, the schema holds the mark to its meaning ──────────────────────────
test('AC-7: v0.13 refuses the mark where it would not mean what it says', () => {
  const r = receiptOf(runImport(BASE()), 'amc-setup-calibration-stack', 'codex');
  assert.equal(r.schema_version, '0.13');
  assert.equal(validateReceipt(r).valid, true, JSON.stringify(validateReceipt(r).errors));
  const plants = {
    'source_figures without the mark': (x) => { delete x.uncertainty_unavailable; },
    'the mark on TESTED': (x) => { x.verification_level = 'TESTED'; },
    'a numeric delta': (x) => { x.comparison.delta = 0.1; },
    'a numeric with_skill_score': (x) => { x.comparison.with_skill_score = 0.8; },
    'no no_cases reason': (x) => { delete x.comparison.delta_uncertainty_unavailable; },
    'a row with no case_status': (x) => { delete x.results.cases[0].case_status; },
    'a row with case_status ok': (x) => { x.results.cases[0].case_status = 'ok'; },
    'a row carrying samples': (x) => { x.results.cases[0].samples = [0.84]; },
    'a row carrying a score': (x) => { x.results.cases[0].score = 0.84; },
    'a row carrying counts': (x) => { x.results.cases[0].counts = { generations_per_arm: 1 }; },
    'run.counts': (x) => { x.run.counts = { generations_per_arm: 1 }; },
    'an aggregate mean': (x) => { x.results.aggregates.with_skill.mean_score = 0.84; },
    'an aggregate stddev': (x) => { x.results.aggregates.baseline.stddev = 0.1; },
    'NVIDIA\'s verdict carried': (x) => { x.source_figures.verdict = 'PASS'; },
    'a field in source': (x) => { x.source_figures.source.remote = 'x'; },
    'a field in a source file': (x) => { x.source_figures.source.files[0].size = 1; },
    'another repo': (x) => { x.source_figures.source.repo = 'someone/skills'; },
    'a short commit': (x) => { x.source_figures.source.commit = 'abc123'; },
    'an upper-case blob sha1': (x) => { x.source_figures.source.files[1].git_blob_sha1 = x.source_figures.source.files[1].git_blob_sha1.toUpperCase(); },
    'the files out of order': (x) => { x.source_figures.source.files.reverse(); },
    'one file only': (x) => { x.source_figures.source.files.pop(); },
    'a third unit': (x) => { x.source_figures.rows[1].uplift_unit = 'percent'; },
    'a field in a row': (x) => { x.source_figures.rows[1].band = 'high'; },
    'a second mark value': (x) => { x.uncertainty_unavailable = 'other'; },
  };
  for (const [name, plant] of Object.entries(plants)) {
    const p = clone(r); plant(p); sealReceipt(p);
    assert.equal(validateReceipt(p).valid, false, name);
  }
});

// ── AC-8, rows carry no figure; the comparison is null ──────────────────────
test('AC-8: two figure-less rows per dimension, each excluded with spec 049\'s reason; a null comparison; no count', () => {
  const got = runImport(BASE());
  for (const x of got.receipts) {
    const card = parseCard(fs.readFileSync(cardPath(BASE(), x.skill), 'utf8'));
    const dims = card.table.rows.map((r) => r.dimension).filter((d) => d !== 'Overall');
    assert.deepEqual(x.receipt.results.cases, dims.flatMap((d) => ['with_skill', 'baseline'].map((mode) => ({ id: `dimension:${d.toLowerCase()}`, mode, label: d, case_status: 'no_observations' }))));
    for (const e of x.receipt.results.aggregates.excluded_cases) assert.equal(e.reason, REASON);
    assert.deepEqual(figureProblems(x.receipt, BASE()), []);
  }
  const r = receiptOf(got, 'doca-aes-gcm', 'claude-code');
  const p1 = clone(r); p1.results.cases[0].samples = [1]; assert.notDeepEqual(figureProblems(p1, BASE()), []);
  const p2 = clone(r); p2.run.counts = { generations_per_arm: 1 }; assert.notDeepEqual(figureProblems(p2, BASE()), []);
  const p3 = clone(r); p3.comparison.delta = 0.3; assert.notDeepEqual(figureProblems(p3, BASE()), []);
});

// ── AC-9, the model is the card's ───────────────────────────────────────────
test('AC-9: the model and provider are read from the card, never guessed; agent entries are a closed set', () => {
  const got = runImport(BASE());
  const codex = receiptOf(got, 'accelerated-computing-cudf', 'codex');
  assert.equal(codex.run.model_id, 'openai/openai/gpt-5.5');
  assert.equal(codex.run.provider, 'openai');
  assert.deepEqual(codex.run.harness, { name: 'codex', version: null });
  assert.equal(receiptOf(got, 'accelerated-computing-cudf', 'claude-code').run.model_id, 'aws/anthropic/bedrock-claude-opus-4-8');
  assert.equal(receiptOf(got, 'doca-aes-gcm', 'claude-code').run.model_id, 'aws/anthropic/bedrock-claude-opus-4-8');
  assert.equal(receiptOf(got, 'bionemo-codonfm-score', 'claude-code').run.model_id, 'aws/anthropic/bedrock-claude-opus-5');
  const old = receiptOf(got, 'amc-setup-calibration-stack', 'claude-code');
  assert.equal(old.run.model_id, 'unknown');
  assert.equal(old.run.provider, 'unknown');
  assert.ok(old.run.import.notices.includes(fill(T.noModel, { agent: 'claude-code' })));
  const d = checkout('nomodel', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace('Claude Code (`aws/anthropic/bedrock-claude-opus-4-8`), ', '')));
  const cc = runImport(d, ['accelerated-computing-cudf']).receipts.find((x) => x.agent === 'claude-code').receipt;
  assert.equal(cc.run.model_id, 'unknown');
  assert.ok(cc.run.import.notices.includes(fill(T.noModel, { agent: 'claude-code' })));
  const w = want(BASE(), ['amc-setup-calibration-stack']).receipts[0].receipt;
  const p = clone(old); p.run.model_id = 'aws/anthropic/bedrock-claude-opus-4-8';
  assert.ok(problems(p, w).includes('run.model_id'), 'a guessed model fails the reader');
  refusedBoth(checkout('agent-extra', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace('- Claude Code (`aws/anthropic/bedrock-claude-opus-4-8`)\n', '- Claude Code (`aws/anthropic/bedrock-claude-opus-4-8`) extra\n'))), ['doca-aes-gcm'], /Agents Used|agent entry/, 'an agent entry of no shape');
  refusedBoth(checkout('agent-header', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace('| Claude Code (`aws/anthropic/bedrock-claude-opus-4-8`) |', '| Claude Code (`aws/anthropic/bedrock-claude-opus-5`) |'))), ['doca-aes-gcm'], /bedrock-claude-opus-5/, 'a header model other than the list\'s');
});

// ── AC-10, the run date and the import time ─────────────────────────────────
test('AC-10: the run date is the card\'s day; the import time is in imported_at only', () => {
  const r = receiptOf(runImport(BASE()), 'data-designer', 'codex');
  assert.equal(r.run.date_utc, '2026-06-02T00:00:00Z');
  assert.equal(r.source_figures.evaluation_date, '2026-06-02');
  assert.ok(r.run.import.notices.includes(T.date));
  assert.equal(r.run.import.imported_at, AT);
  assert.equal(JSON.stringify(r).split(AT).length - 1, 1, 'the import time appears once');
  const w = want(BASE(), ['data-designer']).receipts.find((x) => x.agent === 'codex').receipt;
  const p = clone(r); p.run.date_utc = AT; assert.ok(problems(p, w).includes('run.date_utc'));
  refusedBoth(checkout('nodate', (x) => editCard(x, 'data-designer', (t) => t.replace(/^- Evaluation date: .*\n/m, ''))), ['data-designer'], /evaluation date|evaluation_date/i, 'a card with no evaluation date');
});

// ── AC-11, the bytes read are the bytes hashed ──────────────────────────────
test('AC-11: the card\'s and benchmarks.json\'s sha256 and blob sha1 come from the bytes read', () => {
  const cd = 'ambient-healthcare-agent-with-nemotron-voice-agent';
  const r = receiptOf(runImport(BASE()), cd, 'codex');
  const cardBytes = fs.readFileSync(cardPath(BASE(), cd));
  const benchBytes = fs.readFileSync(path.join(BASE(), 'benchmarks.json'));
  assert.equal(r.run.import.source_sha256, sha256(cardBytes));
  assert.deepEqual(r.run.import.sidecars, [{ file: 'benchmarks.json', sha256: sha256(benchBytes) }]);
  assert.deepEqual(r.source_figures.source.files, [{ path: `skills/${cd}/BENCHMARK.md`, git_blob_sha1: gitSha1(cardBytes) }, { path: 'benchmarks.json', git_blob_sha1: gitSha1(benchBytes) }]);
  const d1 = checkout('ws-card', (x) => fs.appendFileSync(cardPath(x, cd), ' '));
  const r1 = receiptOf(runImport(d1, [cd]), cd, 'codex');
  assert.notEqual(r1.run.import.source_sha256, r.run.import.source_sha256);
  assert.notEqual(r1.source_figures.source.files[0].git_blob_sha1, r.source_figures.source.files[0].git_blob_sha1);
  const d2 = checkout('ws-bench', (x) => fs.appendFileSync(path.join(x, 'benchmarks.json'), ' '));
  const r2 = receiptOf(runImport(d2, [cd]), cd, 'codex');
  assert.notEqual(r2.run.import.sidecars[0].sha256, r.run.import.sidecars[0].sha256);
  assert.notEqual(r2.source_figures.source.files[1].git_blob_sha1, r.source_figures.source.files[1].git_blob_sha1);
  const w = want(BASE(), [cd]).receipts.find((x) => x.agent === 'codex').receipt;
  const p = clone(r); p.run.import.sidecars = []; assert.notDeepEqual(problems(p, w), []);
});

// ── AC-12, economics from the token table only ──────────────────────────────
test('AC-12: token totals as printed where the card has an All cases row; closed cell shapes; no economics otherwise', () => {
  const got = runImport(BASE());
  const r = receiptOf(got, 'accelerated-computing-cudf', 'claude-code');
  assert.deepEqual(r.economics, { basis: 'source-reported', with_skill: { total_tokens: 15380001 }, baseline: { total_tokens: 9883350 }, judge_excluded: true });
  assert.deepEqual(r.source_figures.tokens, { with_skill: '15,380,001', without_skill: '9,883,350', delta: '+5,496,651', change: '+55.62%', coverage: 'skill 13/13; base 13/13' });
  const none = receiptOf(got, 'amc-run-rtsp-calibration', 'codex');
  assert.equal(Object.hasOwn(none, 'economics'), false);
  assert.equal(none.source_figures.tokens, null);
  assert.ok(none.run.import.notices.includes(T.noTokens));
  assert.ok(got.report.economics_unknown.some((x) => x.skill === 'amc-run-rtsp-calibration' && x.agent === 'codex'));
  const cut = receiptOf(runImport(checkout('notokens', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace(/## Token Usage[\s\S]*?(?=## Tier Status)/, ''))), ['accelerated-computing-cudf']), 'accelerated-computing-cudf', 'claude-code');
  assert.equal(Object.hasOwn(cut, 'economics'), false);
  assert.ok(cut.run.import.notices.includes(T.noTokens));
  // A table with no All cases row for the agent: its own notice.
  const norow = runImport(checkout('norow', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace(/^\| claude-code \| All cases \|.*\n/m, ''))), ['accelerated-computing-cudf']);
  const nr = receiptOf(norow, 'accelerated-computing-cudf', 'claude-code');
  assert.equal(Object.hasOwn(nr, 'economics'), false);
  assert.equal(nr.source_figures.tokens, null);
  assert.ok(nr.run.import.notices.includes(fill(T.noTokenRow, { agent: 'claude-code' })));
  assert.ok(!nr.run.import.notices.includes(T.noTokens));
  assert.ok(norow.report.economics_unknown.some((x) => x.skill === 'accelerated-computing-cudf' && x.agent === 'claude-code'));
  for (const [tag, cell] of [['comma', '12,34'], ['empty', ''], ['na', 'N/A']]) {
    refusedBoth(checkout(`tok-${tag}`, (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace('| claude-code | All cases | 15,380,001 |', `| claude-code | All cases | ${cell} |`))), ['accelerated-computing-cudf'], /With skill|with_skill|token/, `a With skill cell ${JSON.stringify(cell)}`);
  }
  const w = want(BASE(), ['accelerated-computing-cudf']).receipts[0].receipt;
  const p1 = clone(r); p1.economics.with_skill.mean_total_tokens = 15380001 / 13; assert.notDeepEqual(problems(p1, w), []);
  const p2 = clone(r); p2.economics.baseline.total_tokens += 1; assert.notDeepEqual(problems(p2, w), []);
});

// ── AC-13, every leaf traced ────────────────────────────────────────────────
test('AC-13: every leaf of every receipt equals the reader\'s own receipt, built from the files alone', () => {
  const w = want(BASE());
  const got = runImport(BASE());
  assert.equal(got.receipts.length, w.receipts.length);
  got.receipts.forEach((x, i) => {
    assert.deepEqual(problems(x.receipt, w.receipts[i].receipt), [], `${x.skill} ${x.agent}`);
    assert.ok(verifyReceiptHash(x.receipt));
    assert.equal(validateReceipt(x.receipt).valid, true, `${x.skill} ${x.agent}: ${JSON.stringify(validateReceipt(x.receipt).errors)}`);
  });
  const r = got.receipts[0].receipt; const ww = w.receipts[0].receipt;
  const p1 = clone(r); p1.run.extra = 1; assert.deepEqual(problems(p1, ww), ['run.extra']);
  const p2 = clone(r); p2.skill.version = '1.0.0'; assert.deepEqual(problems(p2, ww), ['skill.version']);
  const p3 = clone(r); p3.source_figures.environment_moved = p3.source_figures.environment; delete p3.source_figures.environment; assert.equal(problems(p3, ww).length, 2);
  assert.ok(r.run.import.notices.includes(fill(T.unknown, { fields: UNKNOWN_FIELDS })));
});

// ── AC-14, NVIDIA's own verdict is not carried ──────────────────────────────
test('AC-14: no receipt carries NVIDIA\'s verdict, tier status, recommendation or average uplift', () => {
  const got = runImport(BASE());
  for (const x of got.receipts) {
    const s = JSON.stringify(x.receipt);
    for (const w of ['"PASS"', '"FAIL"', 'Recommended for publication', 'PASSED WITH OBSERVATIONS', 'average_uplift', 'pass_threshold', 'validation_status', 'NEUTRAL']) assert.ok(!s.includes(w), `${x.skill} ${x.agent} carries ${w}`);
    assert.ok(x.receipt.run.import.notices.includes(T.verdict));
  }
  const p = clone(got.receipts[0].receipt); p.source_figures.verdict = 'PASS'; sealReceipt(p);
  assert.equal(validateReceipt(p).valid, false);
  assert.notDeepEqual(problems(p, want(BASE()).receipts[0].receipt), []);
});

// ── AC-15, notices are fixed text ───────────────────────────────────────────
test('AC-15: the notices are the fixed texts, the whole list recomputed; public text says hashed, never sealed', () => {
  const w = want(BASE());
  const got = runImport(BASE());
  got.receipts.forEach((x, i) => assert.deepEqual(x.receipt.run.import.notices, w.receipts[i].receipt.run.import.notices, `${x.skill} ${x.agent}`));
  const ww = w.receipts[0].receipt;
  for (const plant of [(n) => n.push('NVIDIA reports PASS'), (n) => n.push('statistical confidence unavailable'), (n) => n.pop()]) {
    const p = clone(got.receipts[0].receipt); plant(p.run.import.notices);
    assert.notDeepEqual(problems(p, ww), [], String(plant));
  }
  const sealed = /\bseal(?:ed|s|ing)?\b/i;
  for (const x of got.receipts) for (const n of x.receipt.run.import.notices) assert.doesNotMatch(n, sealed);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'lib', 'importers-nvidia.js'), 'utf8'), sealed, 'lib/importers-nvidia.js');
  const interop = fs.readFileSync(path.join(ROOT, 'docs', 'interop.md'), 'utf8').split(/^## .*NVIDIA.*$/m)[1] || '';
  assert.ok(interop.length > 0); assert.doesNotMatch(interop.split(/^## /m)[0], sealed, 'docs/interop.md NVIDIA section');
  const v13 = (fs.readFileSync(path.join(ROOT, 'spec', 'RECEIPT.md'), 'utf8').split(/^## What v0\.13 adds/m)[1] || '').split(/^## /m)[0];
  assert.ok(v13.length > 0); assert.doesNotMatch(v13, sealed, 'spec/RECEIPT.md What v0.13 adds');
  assert.match('the figures are sealed', sealed, 'the check sees the word');
});

// ── AC-16, the import report ────────────────────────────────────────────────
test('AC-16: the report gives the real counts, through the function, the CLI\'s printed values and --report', () => {
  const w = want(BASE()).report;
  const got = runImport(BASE());
  assert.deepEqual(got.report, w);
  assert.deepEqual(got.report.skills_without_results, ['nemoclaw-user-guide', 'rag-eval']);
  assert.equal(got.report.repo, 'NVIDIA/skills');
  assert.equal(got.report.commit, headOf(BASE()));
  const out = tmp('report'); const file = path.join(tmp('report-file'), 'report.json');
  const r = cli([...importArgs(BASE(), CARDS, out), '--report', file]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), w);
  const printed = (stdout) => Object.fromEntries(stdout.split('\n').map((l) => /^report ([a-z_0-9]+): (.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], JSON.parse(m[2])]));
  assert.deepEqual(printed(r.stdout), w, 'every printed value equals the report');
  assert.notDeepEqual(printed(r.stdout.replace(/^report receipts_written: \d+$/m, 'report receipts_written: 1')), w, 'the same comparison sees a changed printed value');
  const p1 = clone(w); p1.receipts_written -= 1; assert.notDeepEqual(got.report, p1);
  const p2 = clone(w); p2.skills_without_results.pop(); assert.notDeepEqual(got.report, p2);
});

// ── AC-17, the proving run ──────────────────────────────────────────────────
test('AC-17: the proving probe reads the fixture checkout with every leaf compared and no disagreement', () => {
  const r = spawnSync(process.execPath, [PROVE, BASE(), '--only', ONLY], { encoding: 'utf8', env: { ...process.env, SPEC265_TMP: tmp('prove') } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const w = want(BASE()).report;
  const last = r.stdout.trim().split('\n').pop();
  assert.equal(last, `spec 265 proving run: ${w.receipts_written} receipts, ${w.skills_with_results} skills with results, ${w.skills_without_results.length} without, every leaf compared, 0 disagreements`);
  assert.ok(!fs.readdirSync(ROOT).some((f) => /^spec265/.test(f)), 'nothing is written in the tree');
  // Plant: the probe's own leaf comparison, given a receipt with one leaf changed, reports it.
  const planted = spawnSync(process.execPath, [PROVE, BASE(), '--only', ONLY, '--plant-leaf'], { encoding: 'utf8', env: { ...process.env, SPEC265_TMP: tmp('prove-plant') } });
  assert.equal(planted.status, 1, planted.stdout + planted.stderr);
  assert.match(planted.stdout.trim().split('\n').pop(), /every leaf compared, [1-9]\d* disagreements$/);
});

// ── AC-18, the same import twice ────────────────────────────────────────────
test('AC-18: the same checkout gives the same receipts, twice, from another path, in another listing order', () => {
  const norm = (got) => got.receipts.map((x) => { const r = clone(x.receipt); delete r.receipt_hash; delete r.run.import.imported_at; return r; });
  const a = runImport(BASE(), CARDS, AT); const b = runImport(BASE(), CARDS, '2026-10-15T08:00:00.000Z');
  assert.deepEqual(norm(b), norm(a));
  const moved = checkout('moved');
  assert.equal(headOf(moved), headOf(BASE()), 'the same files give the same commit');
  assert.deepEqual(norm(runImport(moved)), norm(a));
  for (const x of a.receipts) assert.ok(!JSON.stringify(x.receipt).includes(ROOT) && !JSON.stringify(x.receipt).includes(os.homedir()), 'no absolute path');
  // A whole import, read as listed and with every listing reversed.
  const whole = checkout('whole', cutBench);
  const straight = runImport(whole, null);
  assert.deepEqual(norm(straight), norm(want(whole, null)));
  assert.equal(straight.receipts.length, want(BASE()).receipts.length, 'the whole import reads every fixture pair');
  const real = fs.readdirSync;
  const calls = [];
  fs.readdirSync = function reversed(...args) { calls.push(path.resolve(String(args[0]))); const r = real.apply(fs, args); return Array.isArray(r) ? r.slice().reverse() : r; };
  let rev;
  try { delete require.cache[require.resolve('../lib/importers-nvidia')]; rev = runImport(whole, null); } finally { fs.readdirSync = real; delete require.cache[require.resolve('../lib/importers-nvidia')]; }
  const listedSkills = (c) => c.includes(path.resolve(whole, 'skills'));
  assert.ok(listedSkills(calls), 'the patched listing was read on the checkout\'s skills folder');
  assert.equal(listedSkills([]), false, 'the same check reads an uncalled patch as a failure');
  assert.deepEqual(norm(rev), norm(straight));
});

// ── AC-19, no path skips a check; source text is bounded ────────────────────
test('AC-19: the module exports three names; flags it does not take exit 2', () => {
  assert.deepEqual(Object.keys(lib()).sort(), ['NVIDIA_TOOLS', 'NvidiaRefused', 'importNvidiaCards']);
  assert.deepEqual(lib().NVIDIA_TOOLS, ['nvidia-cards']);
  for (const flag of [['--with', 'x'], ['--skill', 'x'], ['--count-errored-runs'], ['--arm', 'baseline']]) {
    const out = tmp('flag');
    const r = cli([...importArgs(BASE(), CARDS, out), ...flag]);
    assert.equal(r.status, 2, flag.join(' '));
    assert.deepEqual(listed(out), []);
  }
});

test('AC-19: every refusal through both paths; nothing is written; bounds and links refused', () => {
  refusedBoth(checkout('big', (x) => editCard(x, 'rag-eval', (t) => t + 'x'.repeat(1024 * 1024 + 1))), ['rag-eval'], /1 MiB|too large|bytes/, 'a card above 1 MiB');
  refusedBoth(checkout('cr', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace('## Results\n', '## Results\r\n'))), ['doca-aes-gcm'], /carriage return/, 'a card with a carriage return');
  refusedBoth(checkout('newline', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace('- Codex (`openai/openai/gpt-5.5`)', '- Codex (`openai/open\nai`)'))), ['doca-aes-gcm'], /model|Agents/, 'a model id broken by a newline');
  refusedBoth(checkout('badmodel', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace('- Codex (`openai/openai/gpt-5.5`)', '- Codex (`openai//gpt 5.5`)'))), ['doca-aes-gcm'], /model id/, 'a model id that is not plain');
  refusedBoth(checkout('rootmodel', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace(/openai\/openai\/gpt-5\.5/g, '/opt/m/x'))), ['doca-aes-gcm'], /model id/, 'a model id with a leading slash');
  // The planted home path is joined at run time, so the tree never carries one.
  const home = ['', 'home', 'someone', 'gpt'].join('/');
  refusedBoth(checkout('home', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace(/openai\/openai\/gpt-5\.5/g, home))), ['doca-aes-gcm'], /model id|local path/, 'a home path as a model id');
  refusedBoth(checkout('link', (x) => { const c = cardPath(x, 'doca-aes-gcm'); const real = c + '.real'; fs.renameSync(c, real); fs.symlinkSync(real, c); }), ['doca-aes-gcm'], /link/, 'a card that is a symbolic link');
  refusedBoth(checkout('dirlink', (x) => { const d = path.join(x, 'skills', 'doca-aes-gcm'); fs.renameSync(d, path.join(x, 'doca-real')); fs.symlinkSync(path.join(x, 'doca-real'), d); }), ['doca-aes-gcm'], /link/, 'the card\'s folder as a symbolic link');
  const top = tmp('toplink'); fs.symlinkSync(BASE(), path.join(top, 'src'));
  refusedBoth(path.join(top, 'src'), CARDS, /link/, 'the path given is a symbolic link', headOf(BASE()));
  refusedBoth(checkout('late', (x) => editCard(x, 'i4h-workflow-scene-edit', (t) => t.replace('| Security | Not available |', '| Security | 99% |'))), CARDS, /i4h-workflow-scene-edit/, 'a refusal after earlier skills were read');
});

// ── AC-24, the source is recorded and checkable ─────────────────────────────
test('AC-24: --commit is the checkout\'s HEAD, every file read is the commit\'s blob, and the record is checkable', () => {
  const r = receiptOf(runImport(BASE()), 'doca-aes-gcm', 'codex');
  assert.deepEqual(r.source_figures.source, { repo: 'NVIDIA/skills', commit: headOf(BASE()), files: [{ path: 'skills/doca-aes-gcm/BENCHMARK.md', git_blob_sha1: gitSha1(fs.readFileSync(cardPath(BASE(), 'doca-aes-gcm'))) }, { path: 'benchmarks.json', git_blob_sha1: gitSha1(fs.readFileSync(path.join(BASE(), 'benchmarks.json'))) }] });
  // The fixture files are the pinned commit's bytes, so their blob sha1s are NVIDIA's.
  const pinned = JSON.parse(fs.readFileSync(path.join(FIX, 'SOURCES.json'), 'utf8')).files;
  const blobOf = (p) => pinned.find((f) => f.source_path === p).git_blob_sha1;
  for (const f of r.source_figures.source.files) assert.equal(f.git_blob_sha1, blobOf(f.path), f.path);
  assert.deepEqual(checkAgainst(r, BASE()), [], 'the checker passes the receipt against its commit');
  // No --commit: exit 2 through the CLI, refused through the function.
  const out = tmp('nocommit');
  const nc = cli(importArgs(BASE(), CARDS, out, null));
  assert.equal(nc.status, 2, nc.stderr); assert.match(nc.stderr, /--commit/); assert.deepEqual(listed(out), []);
  assert.throws(() => lib().importNvidiaCards(BASE(), { only: CARDS, importedAt: AT }), (e) => e instanceof lib().NvidiaRefused && /--commit/.test(e.message));
  refusedBoth(BASE(), CARDS, /--commit/, 'a short commit', headOf(BASE()).slice(0, 12));
  refusedBoth(BASE(), CARDS, /HEAD/, 'a commit that is not HEAD', 'f'.repeat(40));
  refusedBoth(dirty('dirty', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace('| 100% (+0%)', '| 100% (+0%) '))), ['doca-aes-gcm'], /doca-aes-gcm.*(?:HEAD|commit)/, 'a card changed after the commit');
  const untracked = checkout('untracked'); gitIn(untracked, 'rm', '-q', '--cached', 'skills/doca-aes-gcm/BENCHMARK.md'); gitIn(untracked, 'commit', '-q', '-m', 'drop');
  refusedBoth(untracked, ['doca-aes-gcm'], /doca-aes-gcm.*(?:HEAD|commit)/, 'a card the commit does not hold');
  refusedBoth(SRC, ['doca-aes-gcm'], /top of a git/, 'the fixture folder inside this repository', headOf(ROOT));
  // A figure edited and hashed again: it validates and verifies, and the checker fails it.
  const edited = clone(r); edited.source_figures.rows[1].score_pct += 1; sealReceipt(edited);
  assert.equal(verifyReceiptHash(edited), true); assert.equal(validateReceipt(edited).valid, true);
  assert.notDeepEqual(checkAgainst(edited, BASE()), [], 'the checker sees the edited figure');
  // A checkout whose card and benchmarks.json were edited to agree: the checker passes it against its
  // own commit, and its blob sha1s are not the pinned ones.
  const fork = checkout('fork', (x) => {
    editCard(x, 'doca-aes-gcm', (t) => t.replace('| Correctness | 4 | 75% (+15%) |', '| Correctness | 4 | 99% (+15%) |'));
    editBench(x, (j) => { j.results.find((y) => y.catalog_dir === 'doca-aes-gcm' && y.agent === 'claude-code' && y.dimension === 'Correctness').score_pct = 99; });
  });
  const fr = receiptOf(runImport(fork, ['doca-aes-gcm']), 'doca-aes-gcm', 'claude-code');
  assert.deepEqual(checkAgainst(fr, fork), []);
  for (const f of fr.source_figures.source.files) assert.notEqual(f.git_blob_sha1, blobOf(f.path), `${f.path}: a fork's blob is not the pinned one`);
});

// ── AC-25, the agent set is closed ──────────────────────────────────────────
test('AC-25: an agent other than claude-code and codex refuses; a pair with results and no column refuses', () => {
  refusedBoth(checkout('gemini-header', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace('| Codex (Baseline \u2192 Skill Uplift) |', '| Gemini CLI (Baseline \u2192 Skill Uplift) |'))), ['accelerated-computing-cudf'], /Gemini CLI/, 'a third agent in the header');
  refusedBoth(checkout('gemini-results', (x) => editBench(x, (j) => { j.results.push({ ...j.results.find((r) => r.catalog_dir === 'doca-aes-gcm'), agent: 'gemini' }); j.result_row_count += 1; })), ['doca-aes-gcm'], /gemini/, 'a results row for a third agent');
  const dropCodex = (t) => t.split('\n').map((l) => (/^\| ?(?:Measure|Overall|Security|Correctness|Discoverability|Effectiveness|Efficiency|---)/.test(l) && l.split('|').length === 5 ? l.split('|').slice(0, 3).join('|') + '|' : l)).join('\n');
  refusedBoth(checkout('no-codex', (x) => editCard(x, 'accelerated-computing-cudf', dropCodex)), ['accelerated-computing-cudf'], /codex/, 'a pair with results and no column');
});

// ── AC-26, the card and the index agree both ways ───────────────────────────
test('AC-26: dimensions one to one, unique case ids, and no figure column without results', () => {
  refusedBoth(checkout('no-results', (x) => editBench(x, (j) => { j.results = j.results.filter((r) => !(r.catalog_dir === 'doca-aes-gcm' && r.agent === 'codex')); j.result_row_count = j.results.length; })), ['doca-aes-gcm'], /doca-aes-gcm.*codex|codex.*doca-aes-gcm/, 'a figure column with no results rows');
  refusedBoth(checkout('extra-dim', (x) => editBench(x, (j) => { j.results.push({ ...j.results.find((r) => r.catalog_dir === 'doca-aes-gcm' && r.agent === 'claude-code'), dimension: 'Safety' }); j.result_row_count += 1; })), ['doca-aes-gcm'], /Safety/, 'a results dimension the card does not print');
  refusedBoth(checkout('renamed', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace('| Security | 4 |', '| Safety | 4 |'))), ['doca-aes-gcm'], /Safety|Security/, 'a card dimension missing from results');
  refusedBoth(checkout('twin-row', (x) => editCard(x, 'doca-aes-gcm', (t) => t.replace(/^(\| Security \| 4 \|.*)$/m, '$1\n| security | 4 | 100% (+0%) | 100% (+0%) |'))), ['doca-aes-gcm'], /security/, 'two rows with one case id');
});

// ── AC-27, the results table is the one under its heading ───────────────────
test('AC-27: only the table under the results heading is read; header shapes are closed', () => {
  const move = (t) => { const L = t.split('\n'); const i = L.findIndex((l) => l.startsWith('| Measure |')); const tbl = L.splice(i, 8); const j = L.findIndex((l) => l.startsWith('| Dimension | Question |')); L.splice(j + 7, 0, '', ...tbl); return L.join('\n'); };
  refusedBoth(checkout('moved-table', (x) => editCard(x, 'accelerated-computing-cudf', move)), ['accelerated-computing-cudf'], /no column|results table/, 'a results table moved under Scoring Methodology');
  refusedBoth(checkout('bad-header', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace('| Claude Code (Baseline \u2192 Skill Uplift) |', '| Claude Code (Skill) |'))), ['accelerated-computing-cudf'], /Claude Code \(Skill\)/, 'a header cell of no shape');
  refusedBoth(checkout('two-formats', (x) => editCard(x, 'accelerated-computing-cudf', (t) => t.replace('## Evaluation Metadata\n', '## Evaluation Metadata\n\n## Evaluation Summary\n'))), ['accelerated-computing-cudf'], /format/, 'both format headings');
});

// ── AC-28, receipt files never collide or overwrite ─────────────────────────
test('AC-28: a name collision or an existing file refuses and writes nothing', () => {
  const twin = checkout('twin', (x) => {
    copyTree(path.join(x, 'skills', 'doca-aes-gcm'), path.join(x, 'skills', 'doca-aes-gcm-twin'));
    editBench(x, (j) => {
      j.skills.push({ ...j.skills.find((s) => s.catalog_dir === 'doca-aes-gcm'), catalog_dir: 'doca-aes-gcm-twin' });
      j.results.push(...j.results.filter((r) => r.catalog_dir === 'doca-aes-gcm').map((r) => ({ ...r, catalog_dir: 'doca-aes-gcm-twin' })));
      j.skill_count = j.skills.length; j.result_row_count = j.results.length;
    });
  });
  refusedBoth(twin, ['doca-aes-gcm', 'doca-aes-gcm-twin'], /file name|same file/, 'two folders with the same card bytes');
  const out = tmp('existing');
  const first = cli(importArgs(BASE(), ['doca-aes-gcm'], out));
  assert.equal(first.status, 0, first.stderr);
  const files = listed(out); const before = files.map((f) => fs.readFileSync(path.join(out, f), 'utf8'));
  fs.rmSync(path.join(out, files[1]));
  const again = cli(importArgs(BASE(), ['doca-aes-gcm'], out));
  assert.equal(again.status, 1, again.stdout);
  assert.match(again.stderr, /exists/);
  assert.deepEqual(listed(out), [files[0]], 'no file is written, and the existing one stays');
  assert.equal(fs.readFileSync(path.join(out, files[0]), 'utf8'), before[0]);
});

// ── AC-20, receipt v0.13 is additive, and nothing loosens ───────────────────
test('AC-20: v0.12 is frozen; v0.13 is v0.12 plus the added fields and rules only', () => {
  const cfg = require('../config');
  assert.equal(cfg.RECEIPT_SCHEMA_VERSION, '0.13');
  const v13 = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'receipt.schema.json'), 'utf8'));
  const v12 = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'receipt.v0.12.schema.json'), 'utf8'));
  const base = JSON.parse(spawnSync('git', ['-C', ROOT, 'show', 'd76e13da4f9a8c8d93a41a03b6a8cf6721f04091:spec/receipt.schema.json'], { encoding: 'utf8' }).stdout);
  const noId = (s) => { const x = clone(s); delete x.$id; return x; };
  assert.deepEqual(noId(v12), noId(base), 'v0.12 is frozen as it was');
  assert.equal(v12.$id, 'https://driftproofhq.com/spec/receipt.v0.12.schema.json');
  const undesc = (v) => (Array.isArray(v) ? v.map(undesc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'description' && k !== '$comment').map(([k, x]) => [k, undesc(x)])) : v);
  const cut = clone(v13);
  delete cut.properties.uncertainty_unavailable; delete cut.properties.source_figures;
  delete cut.properties.economics.properties.with_skill.properties.total_tokens; delete cut.properties.economics.properties.baseline.properties.total_tokens;
  // A-265-1 (issue 317): judge_overhead's two optional counts; spec 317 AC-9 holds them optional.
  for (const k of ['judged_draws_counted', 'judged_draws_missing_usage']) delete cut.properties.economics.properties.judge_overhead.properties[k];
  cut.allOf = cut.allOf.filter((r) => !(typeof r.$comment === 'string' && r.$comment.startsWith('driftproof/v0.13')));
  cut.properties.schema_version.const = '0.12';
  delete cut.$id; const b = noId(base);
  assert.deepEqual(undesc(cut), undesc(b), 'v0.13 adds and loosens nothing');
  const wide = clone(cut); wide.properties.verification_level.enum = [...(wide.properties.verification_level.enum || []), 'X'];
  assert.notDeepEqual(undesc(wide), undesc(b));
  const h = require('../lib/importers-harbor').importHarbor({ withJob: path.join(__dirname, 'fixtures', 'harbor', 'skill-placebo', 'trials', 'skill-caveman'), withoutJob: path.join(__dirname, 'fixtures', 'harbor', 'skill-placebo', 'trials', 'baseline'), importedAt: AT }).receipt;
  assert.equal(validateReceipt(sealReceipt({ ...clone(h), schema_version: '0.12' })).valid, true, 'v0.12 receipt');
  assert.equal(validateReceipt(sealReceipt({ ...clone(h), schema_version: '0.13' })).valid, true, 'restamped 0.13');
  assert.equal(validateReceipt(sealReceipt({ ...clone(receiptOf(runImport(BASE()), 'doca-aes-gcm', 'codex')), schema_version: '0.12' })).valid, false, 'the mark is refused at v0.12');
  assert.equal(fs.readFileSync(path.join(ROOT, 'docs', 'spec', 'receipt.v0.12.schema.json'), 'utf8'), fs.readFileSync(path.join(ROOT, 'spec', 'receipt.v0.12.schema.json'), 'utf8'), 'the served frozen copy');
});

// ── AC-21, the docs ─────────────────────────────────────────────────────────
test('AC-21: RECEIPT.md says what v0.13 adds; interop.md has the NVIDIA section; the interop page has the import line', () => {
  const receiptMd = fs.readFileSync(path.join(ROOT, 'spec', 'RECEIPT.md'), 'utf8');
  assert.match(receiptMd, /^# Driftproof receipt, spec v0\.13$/m);
  const sec = receiptMd.split(/^## What v0\.13 adds/m)[1];
  assert.ok(sec, 'a What v0.13 adds section');
  const body = sec.split(/^## /m)[0];
  for (const w of ['uncertainty_unavailable', 'source_figures', 'aggregates_only', 'source', 'git_blob_sha1', 'total_tokens', 'unstated', 'no verdict', 'does not attest']) assert.ok(body.includes(w), `the section names ${w}`);
  const interop = fs.readFileSync(path.join(ROOT, 'docs', 'interop.md'), 'utf8');
  const nv = interop.split(/^## .*NVIDIA.*$/m)[1];
  assert.ok(nv, 'an NVIDIA section');
  const nvBody = nv.split(/^## /m)[0];
  for (const w of ['--from nvidia-cards', '--commit', '--only', 'benchmarks.json', 'BENCHMARK.md', 'source_figures', 'uncertainty_unavailable', 'git_blob_sha1', 'does not attest', 'unstated', 'source-reported', 'CC BY 4.0', 'no verdict']) assert.ok(nvBody.includes(w), `the NVIDIA section names ${w}`);
  assert.ok(!/\bconfiden(t|ce)\b/i.test(nvBody), 'no confidence language in the section'); // A-265-5: no em dash reading
  assert.match(fs.readFileSync(path.join(ROOT, 'docs', 'interop', 'index.html'), 'utf8'), /--from nvidia-cards/);
});

// ── AC-22, wording on every line this spec adds ─────────────────────────────
// A-265-5 (issue 378): the em dash is no longer read, so the module's own text is not read for it or its escape.
test('AC-22: the importer carries no confidence wording', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'importers-nvidia.js'), 'utf8');
  assert.ok(!/\bconfiden(t|ce)\b|\bsignifican(t|ce)\b/i.test(src), 'no confidence wording');
});

// ── AC-23, siblings amended ─────────────────────────────────────────────────
test('AC-23: each sibling whose reading moves names issue 265 in an amendment in its own spec', () => {
  const siblings = JSON.parse(fs.readFileSync(path.join(SPEC, 'siblings.json'), 'utf8'));
  assert.ok(siblings.length > 0);
  for (const s of siblings) {
    const text = fs.readFileSync(path.join(ROOT, 'specs', s.spec, 'spec.md'), 'utf8');
    assert.match(text, /issue 265/, `${s.spec} names issue 265`);
    assert.ok(text.includes(s.amendment), `${s.spec} carries ${s.amendment}`);
  }
});

// ── verdict readers (AC-29 onwards) ─────────────────────────────────────────
// Each reader is given three subjects: two real imported receipts (a newer card, and an older card with
// an unstated unit), and a planted one, a real TESTED receipt from the published archive with the mark
// and source_figures added and hashed again. None may yield a verdict word. The same TESTED receipt
// without the mark is the control: the reader must yield a verdict word on it, so the reader is live and
// the pattern is seen to match. A reader that refuses by throwing gives no word.
const RJ = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const BASE_A = 'receipts/report-014/run-1/documentation-and-adrs-claude-haiku-4-5-20251001-2026-10-07.json';
const BASE_B = 'receipts/report-014/run-1/documentation-and-adrs-claude-haiku-5-5-2026-10-07.json';
let importedCache = null;
const imported = () => importedCache || (importedCache = runImport(BASE()));
function mark(r) {
  const x = clone(r);
  x.uncertainty_unavailable = 'aggregates_only';
  x.source_figures = clone(receiptOf(imported(), 'accelerated-computing-cudf', 'claude-code').source_figures);
  return sealReceipt(x);
}
const subjects = () => [
  { name: 'imported (newer card)', r: receiptOf(imported(), 'accelerated-computing-cudf', 'claude-code') },
  { name: 'imported (older card, unit unstated)', r: receiptOf(imported(), 'amc-setup-calibration-stack', 'claude-code') },
  { name: 'planted (TESTED with the mark)', r: mark(RJ(BASE_A)) },
];
const said = (f) => { try { const o = f(); return typeof o === 'string' ? o : JSON.stringify(o); } catch (e) { return `refused: ${e && e.message}`; } };
function holds(name, read, re) {
  assert.match(said(() => read(RJ(BASE_A))), re, `${name}: the unmarked control yields a verdict word`);
  for (const s of subjects()) assert.doesNotMatch(said(() => read(s.r)), re, `${name} on the ${s.name} receipt`);
}
function holdsPair(name, read, re) {
  assert.match(said(() => read(RJ(BASE_A), RJ(BASE_B))), re, `${name}: the unmarked control pair yields a verdict word`);
  for (const s of subjects()) {
    assert.doesNotMatch(said(() => read(s.r, RJ(BASE_B))), re, `${name}: ${s.name} first`);
    assert.doesNotMatch(said(() => read(RJ(BASE_A), s.r)), re, `${name}: ${s.name} second`);
    assert.doesNotMatch(said(() => read(s.r, s.r)), re, `${name}: ${s.name} both`);
  }
}
// A run date shown with a time: the day alone is what a marked receipt's readers show (AC-10).
const TIMED = /\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}/;
function dayAlone(name, read) {
  assert.match(said(() => read(RJ(BASE_A))), TIMED, `${name}: the unmarked control shows a time, so the check is live`);
  for (const s of subjects()) assert.doesNotMatch(said(() => read(s.r)), TIMED, `${name}: ${s.name} shows its run date with a time`);
}
function dirOf(tag, receipts) { const d = tmp(tag); receipts.forEach((r, i) => fs.writeFileSync(path.join(d, `r${i}.json`), JSON.stringify(r, null, 2))); return d; }

const TOKENS = /\b(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)\b/;
const BADGE = /\b(?:passing|regressed|no effect|not enough draws|more cases needed|inconclusive|no separation detected)\b/i;
const PLAIN = /Clearly helped|Clearly hurt|No clear difference|Too few answers to tell|clearly helped|clearly hurt|no clear difference|too few (?:answers|test tasks) to tell|result was inconclusive/;
const CASES = /separated-up|separated-down|underpowered|not-separated|no-separation/;
const STATES = /"state":"(?:regression|inconclusive|underpowered|no detected effect|helped)"/;
// The runner's not-separated value, read from its own module rather than typed (spec 031 A-031-20).
const NOISE = require('../lib/stats').WITHIN_NOISE;
const NOISE_UP = NOISE.toUpperCase();
const DRIFT = new RegExp(`\\*\\*(?:DRIFT|IMPROVED|MIXED|NO SEPARATION DETECTED|INCONCLUSIVE|REVISION REGRESSED|REVISION IMPROVED)\\b|\\| (?:🔻 )?regression \\||\\| (?:🔺 )?improvement \\||${NOISE}`);
const PLOT = /\b(?:separated|overlapping)\b/;
const SCRIPT = new RegExp(`\\b(?:DURABLE|REGRESSES|NO EFFECT|SUBSTRATE-DEPENDENT|TIER-DEPENDENT|IMPROVED|REGRESSED|MIXED)\\b|"dir":"(?:help|hurt|mixed|flat)"|${NOISE_UP}`);
const LIFT = /"lift":-?\d|Lift from recorded draws: [-+]?\d|Helps under the rule|Hurts under the rule|"state":"(?:helps|hurts|no-separation|underpowered|inconclusive)"/;

const V = () => require('../lib/verdict');
test('AC-30: lib/verdict.js receiptVerdict reads NOT_MEASURED on a receipt carrying the mark', () => holds('receiptVerdict', (r) => { const v = V().receiptVerdict(r); return v.verdict === 'NOT_MEASURED' && v.notMeasured && v.notMeasured.includes('aggregates_only') ? 'NOT_MEASURED aggregates_only' : v.verdict; }, TOKENS));
test('AC-31: lib/verdict.js verdictFromReceipt gives no badge word', () => holds('verdictFromReceipt', (r) => V().verdictFromReceipt(r), BADGE));
test('AC-32: lib/verdict.js badgeEndpoint gives no badge word', () => holds('badgeEndpoint', (r) => V().badgeEndpoint(r), BADGE));
test('AC-33: lib/verdict.js githubOutputLines gives no verdict token and no delta', () => holds('githubOutputLines', (r) => V().githubOutputLines(r), /\b(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)\b|delta<<\w+\n[-+]?\d/));
test('AC-34: lib/verdict.js readCases reads no case state', () => holds('readCases', (r) => V().readCases(r), CASES));
test('AC-35: lib/decision.js decisionState reads not measured', () => holds('decisionState', (r) => ({ state: require('../lib/decision').decisionState(r) }), STATES));
test('AC-36: lib/decision.js decideSet gives the model no verdict state and no delta', () => holds('decideSet', (r) => {
  const d = require('../lib/decision').decideSet(dirOf('decide', [r]), r.run.model_id, {});
  return d.rows.map((x) => ({ state: x.state, delta: x.delta }));
}, /"state":"(?:regression|inconclusive|underpowered|no detected effect|helped)"|"delta":-?\d/));
test('AC-37: lib/plain.js plainOf gives no plain verdict label', () => holds('plainOf', (r) => require('../lib/plain').plainOf(r), PLAIN));
test('AC-38: lib/plain.js plainOfRow, summaryLead and commentMarkdown give no plain verdict', () => holds('plain rows', (r) => {
  const P = require('../lib/plain'); const dir = dirOf('plainrows', [r]);
  const d = require('../lib/decision').decideSet(dir, r.run.model_id, {});
  return [d.rows.map((row) => P.plainOfRow(row, r)), P.summaryLead(d, dir), P.commentMarkdown(d, dir, { key: 'k' })];
}, PLAIN));
test('AC-39: lib/badge-svg.js badgeSvg draws no verdict word and no lift', () => holds('badgeSvg', (r) => require('../lib/badge-svg').badgeSvg(r), /\b(?:passing|regressed|no effect|not enough draws|more cases needed|inconclusive)\b|[-+]0\.\d{2}/i));
test('AC-40: lib/diff.js buildDriftReport (release) gives no headline verdict and no per-case verdict', () => holdsPair('buildDriftReport', (a, b) => { const d = require('../lib/diff').buildDriftReport(a, b); return d.markdown + JSON.stringify(d.perCase.map((c) => c.verdict)); }, DRIFT));
test('AC-41: lib/diff.js buildDriftReport (revision) gives no revision headline', () => holdsPair('buildDriftReport revision', (a, b) => {
  const x = clone(b); x.skill = clone(a.skill); x.skill.content_hash = 'f'.repeat(64); x.run.model_id = a.run.model_id; sealReceipt(x);
  return require('../lib/diff').buildDriftReport(a, x, { mode: 'revision' }).markdown;
}, /\*\*(?:REVISION REGRESSED|REVISION IMPROVED|MIXED|NO SEPARATION DETECTED|INCONCLUSIVE)\b/));
test('AC-42: lib/diff.js buildDriftReport with the lift breakdown gives no lift reading', () => holdsPair('buildDriftReport lift', (a, b) => JSON.stringify(require('../lib/diff').buildDriftReport(a, b, { includeLiftBreakdown: true }).liftBreakdown || null), LIFT));
test('AC-43: lib/view.js liftBreakdown, renderLiftHtml and renderLiftMarkdown give no lift and no lift state', () => holds('liftBreakdown', (r) => {
  const Vw = require('../lib/view'); const lb = Vw.liftBreakdown(r);
  return JSON.stringify({ lift: lb.lift, rows: lb.rows.map((x) => ({ state: x.state })) }) + Vw.renderLiftHtml(lb) + Vw.renderLiftMarkdown(lb);
}, LIFT));
const VIEW = /data-label="(?:Clearly helped|Clearly hurt|No clear difference|Too few answers to tell)"|data-field="label">(?:Clearly|No clear|Too few)|data-state="(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)"|\bv-(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)\b|data-field="sentence">The skill clearly|data-count="(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED)">[1-9]|Lift from recorded draws: [-+]?\d/;
// A text without its <style> elements, every other byte as it was. Read by spec 148's tokenizer, not
// a regex (issue 335): it finds <STYLE> and </style > too. The tokenizer drops a tag the input ends
// inside, which is no style element, so that tail is kept.
const { tokenize } = require('../scripts/html-text');
function withoutStyle(s) {
  const src = String(s);
  let read = ''; let out = ''; let inStyle = false;
  for (const t of tokenize(src)) {
    const piece = t.type === 'text' ? t.text : t.raw;
    read += piece;
    if (t.type === 'start' && t.name === 'style') { inStyle = true; continue; }
    if (inStyle) { if (t.type === 'end' && t.name === 'style') inStyle = false; continue; }
    out += piece;
  }
  return inStyle ? out : out + src.slice(read.length);
}
// The page's styles define the state classes for every page, so they are not the receipt's (AC-44).
const viewHtml = (r) => withoutStyle(require('../lib/view').renderView(dirOf('view', [r]), { now: new Date('2026-10-14T00:00:00Z'), stale: { noHarnessCheck: true } }).html || '');
// The view's own clock is set to a day start, so a time the view shows is the receipt's.
const receiptPart = (html) => html.replace(/2026-10-14(?:T| )00:00(?::00(?:\.000)?Z?)?/g, '');
test('AC-44: lib/view.js renderView gives the receipt no verdict label, state or lift, and its run date as the day alone', () => {
  // The style drop reads a style element in any case and with a spaced end tag, and keeps every other byte.
  assert.equal(withoutStyle('a<STYLE>.v-PASSED{}</style >b<p class="state-passed">51 %</p><style>x</style>c<x'), 'ab<p class="state-passed">51 %</p>c<x');
  holds('renderView', viewHtml, VIEW);
  dayAlone('renderView', (r) => receiptPart(viewHtml(r)));
});
test('AC-45: lib/band-plot.js cellOf and caseCellOf read refused', () => holds('cellOf', (r) => { const B = require('../lib/band-plot'); return [B.cellOf(r).state, B.caseCellOf(r).cell.state]; }, PLOT));
test('AC-46: lib/export.js toSummaryJson writes NOT_MEASURED, a null delta and band, and null scores', () => holds('toSummaryJson', (r) => require('../lib/export').toSummaryJson(r), /"verdict":"(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)"|"delta":-?\d|"delta_uncertainty":\d|"mean":\d/));
test('AC-47: lib/run.js summarizeReceipt prints no lift figure, and the run date as the day alone', () => {
  holds('summarizeReceipt', (r) => require('../lib/run').summarizeReceipt(r), /skill lift \*\*[-+]\d/);
  dayAlone('summarizeReceipt', (r) => require('../lib/run').summarizeReceipt(r));
});
function planSkillDir() {
  const d = path.join(tmp('planskill'), 'skill');
  fs.mkdirSync(path.join(d, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), '---\nname: plan-fixture\nversion: 1.0.0\n---\n# Plan fixture\nAnswer each task in one sentence.\n');
  fs.writeFileSync(path.join(d, 'evals', 'evals.json'), JSON.stringify({ cases: [1, 2].map((n) => ({ id: 'c' + n, prompt: 'Answer task ' + n, rubric: 'One sentence.', pass_threshold: 0.7 })) }));
  return d;
}
test('AC-48: lib/plan.js takes no receipt carrying the mark as a prior, and says why', () => {
  const Pl = require('../lib/plan');
  const skillDir = planSkillDir();
  for (const s of subjects()) {
    const f = path.join(dirOf('plan', [s.r]), 'r0.json');
    assert.throws(() => Pl.planSkill({ skill: Pl.loadPlanSkill(skillDir), receipts: Pl.readPlanReceipts([f]), model: s.r.run.model_id }), /aggregates only/, s.name);
  }
});
test('AC-49: stale, the run totals and the value readers carry no verdict word for a marked receipt; stale shows the day alone', () => {
  const val = require('../lib/value');
  const St = require('../lib/stale');
  for (const s of subjects()) {
    const f = path.join(dirOf('stale', [s.r]), 'r0.json');
    const st = said(() => St.staleReport([f], { noHarnessCheck: true }));
    assert.doesNotMatch(st, /\b(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|helped|hurt|regressed)\b/, `stale on ${s.name}`);
    assert.doesNotMatch(said(() => St.renderText(St.staleReport([f], { noHarnessCheck: true }))), TIMED, `stale text on ${s.name}`);
    assert.doesNotMatch(said(() => val.runTotalFromReceipts([s.r])), /\b(?:PASSED|REGRESSED|regressed|helped)\b/, `run totals on ${s.name}`);
  }
});

function cliOut(args, cwd) { const r = cli(args, { cwd }); return `${r.status} ${r.stdout} ${r.stderr}`; }
function holdsCli(name, run, re) {
  const ctl = tmp(`${name}-ctl`); fs.writeFileSync(path.join(ctl, 'r.json'), JSON.stringify(RJ(BASE_A), null, 2));
  assert.match(run(path.join(ctl, 'r.json'), ctl, RJ(BASE_A)), re, `${name}: the unmarked control yields a verdict word`);
  for (const s of subjects()) {
    const d = tmp(`${name}-s`); fs.writeFileSync(path.join(d, 'r.json'), JSON.stringify(s.r, null, 2));
    assert.doesNotMatch(run(path.join(d, 'r.json'), d, s.r), re, `${name} on the ${s.name} receipt`);
  }
}
test('AC-50: driftproof badge <file>, as endpoint, svg and GitHub outputs, gives no verdict word', () => {
  holdsCli('badge', (f, d) => cliOut(['badge', f], d), BADGE);
  holdsCli('badge-svg', (f, d) => cliOut(['badge', f, '--svg'], d), BADGE);
  holdsCli('badge-gh', (f, d) => cliOut(['badge', f, '--github-output'], d), TOKENS);
});
test('AC-51: driftproof badge <dir> gives no verdict word', () => holdsCli('badge-dir', (f, d, r) => cliOut(['badge', d, '--models', r.run.model_id], d), BADGE));
test('AC-52: driftproof decide gives the model no verdict state', () => holdsCli('decide', (f, d, r) => cliOut(['decide', d, '--models', r.run.model_id], d), /"state": "(?:regression|inconclusive|underpowered|no detected effect|helped)"/));
test('AC-53: driftproof diff gives no drift verdict, in either mode', () => {
  const b = tmp('diff-b'); fs.writeFileSync(path.join(b, 'b.json'), JSON.stringify(RJ(BASE_B), null, 2));
  holdsCli('diff', (f, d) => cliOut(['diff', f, path.join(b, 'b.json')], d), DRIFT);
  holdsCli('diff-rev', (f, d) => cliOut(['diff', path.join(b, 'b.json'), f], d), DRIFT);
});
test('AC-54: driftproof view gives the receipt no verdict label', () => holdsCli('view', (f, d) => {
  const out = path.join(d, 'v.html'); const r = cli(['view', d, '--out', out, '--no-harness-check'], { cwd: d, env: { SOURCE_DATE_EPOCH: '1760400000' } });
  return `${r.status} ${fs.existsSync(out) ? withoutStyle(fs.readFileSync(out, 'utf8')) : ''} ${r.stderr}`;
}, VIEW));
test('AC-55: driftproof export writes NOT_MEASURED and a null delta', () => holdsCli('export', (f, d) => cliOut(['export', f], d), /"verdict": "(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)"|"delta": -?\d/));
test('AC-56: driftproof plan refuses a marked receipt as a prior, and says why', () => {
  const skillDir = planSkillDir();
  for (const s of subjects()) {
    const d = tmp('plan-cli'); fs.writeFileSync(path.join(d, 'r.json'), JSON.stringify(s.r, null, 2));
    const r = cli(['plan', skillDir, '--model', s.r.run.model_id, '--from', path.join(d, 'r.json')], { cwd: d });
    assert.equal(r.status, 2, `${s.name}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stdout + r.stderr, /aggregates only/, s.name);
  }
});

test('AC-57: action/comment.js posts no verdict word for a marked receipt', async () => {
  const http = require('node:http');
  async function post(receipt) {
    const dir = dirOf('action', [receipt]); const ev = path.join(tmp('action-ev'), 'event.json');
    fs.writeFileSync(ev, JSON.stringify({ pull_request: { number: 1 } }));
    let body = '';
    const server = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { if (req.method !== 'GET') body += b; res.setHeader('content-type', 'application/json'); res.end(req.method === 'GET' ? '[]' : '{}'); });
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const env = { ...process.env, DRIFTPROOF_RECEIPTS: dir, GITHUB_TOKEN: 'x', GITHUB_EVENT_PATH: ev, GITHUB_REPOSITORY: 'o/r', GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, INPUT_MODELS: receipt.run.model_id };
    const child = require('node:child_process').spawn(process.execPath, [path.join(ROOT, 'action', 'comment.js')], { env });
    await new Promise((ok) => child.on('exit', ok));
    server.close();
    return body;
  }
  assert.match(await post(RJ(BASE_A)), PLAIN, 'the unmarked control is commented with a verdict');
  for (const s of subjects()) assert.doesNotMatch(await post(s.r), PLAIN, s.name);
});
test('AC-58: plugin/driftproof/lib/door.mjs reads no verdict from a receipt itself', () => {
  const src = fs.readFileSync(path.join(ROOT, 'plugin', 'driftproof', 'lib', 'door.mjs'), 'utf8');
  const reads = /\b(?:receiptVerdict|verdictFromReceipt|readCases|decisionState|plainOf|buildDriftReport|cellOf)\s*\(/;
  assert.doesNotMatch(src, reads, 'the door takes its words from the pinned runner\'s badge only');
  assert.match(src + '\nreceiptVerdict(r)', reads, 'the same check sees a planted call');
});

test('AC-59: scripts/build-receipt-pages.js gives a marked receipt no verdict label, honest line or badge word, and its date as the day alone', () => {
  const bp = require('../scripts/build-receipt-pages');
  holds('receipt page', (r) => { const p = bp.page({ rel: 'receipts/x/y.json', receipt: r }); return [p.label, withoutStyle(p.html), p.badge, bp.honestLine(V().receiptVerdict(r)), bp.pageLabel(V().receiptVerdict(r)), [...bp.cardLabels([{ rel: 'receipts/x/y.json', receipt: r }]).values()]].join('\n'); }, /\b(?:Passing|Regressed|Not enough draws|No separation detected|More cases needed|Inconclusive)\b|separated (?:upward|downward)|state-(?:passed|regressed|underpowered|no-effect)/);
  for (const s of subjects()) {
    const html = said(() => bp.page({ rel: 'receipts/x/y.json', receipt: s.r }).html);
    assert.doesNotMatch(html, TIMED, `${s.name}: the page shows a time`);
    assert.doesNotMatch(html, /toLocale(?:Date|Time)?String|Intl\.DateTimeFormat|new Date\(/, `${s.name}: the page converts a date`);
  }
  assert.match('2026-10-07T12:00', TIMED, 'the check sees a time');
});
test('AC-60: scripts/build-site-pages.js gives a marked receipt no verdict words', () => {
  const sp = require('../scripts/build-site-pages');
  holds('receiptWords', (r) => sp.receiptWords(r), /"verdict":"(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)"|Passing|Regressed|Not enough draws|No separation detected/);
});

// AC-61: the readers of fixed published receipts. Every line in which each reads a command-line
// argument or an environment variable, recorded with what it is. A new input, or a changed one, is a
// line this list does not hold.
const FIXED_INPUTS = {
  'scripts/site-data.mjs': {
    "const i = process.argv.indexOf('--out');": 'output folder',
    "const outDir = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(DOCS, 'data');": 'output folder',
    'if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();': 'the script\'s own path',
  },
  'scripts/report-corrections.js': { 'function main(argv = process.argv.slice(2)) {': 'flags', "const check = argv.includes('--check');": 'flag' },
  'scripts/prepare-report-006.js': { 'function main(argv = process.argv.slice(2)) {': 'flags', "if (argv.includes('--promote')) {": 'flag', "if (argv.includes('--check')) {": 'flag' },
  'scripts/prepare-report-007.js': { 'function main(argv = process.argv.slice(2)) {': 'flags', "if (argv.includes('--page')) { process.stdout.write(html); return 0; }": 'flag', "if (argv.includes('--check')) {": 'flag' },
  'scripts/prepare-report-008.js': { 'const args = process.argv.slice(2);': 'flags', "if (args.includes('--page')) { process.stdout.write(page); return 0; }": 'flag', "if (args.includes('--check')) {": 'flag' },
  'scripts/prepare-report-009.js': { 'const args = process.argv.slice(2);': 'flags', "if (args.includes('--page')) { process.stdout.write(page); return 0; }": 'flag', "if (args.includes('--check')) {": 'flag' },
  'scripts/prepare-report-010.js': { 'const args = process.argv.slice(2);': 'flags', "if (args.includes('--evidence')) { copyEvidence(); return 0; }": 'flag', "if (args.includes('--page')) { process.stdout.write(page); return 0; }": 'flag', "if (args.includes('--check')) {": 'flag' },
  'scripts/build-report-001.js': { "const RECEIPTS = process.env.DP_RECEIPTS ? path.resolve(process.env.DP_RECEIPTS) : path.join(ROOT, 'receipts', 'report-001');": 'a receipt folder, read only through lib/diff.js buildDriftReport, which refuses a marked receipt (AC-40)' },
  'scripts/rebuild-index-and-drift.js': {},
  'scripts/rebuild-report-005.js': {
    'function argValue(argv, name) {': 'flags', 'const i = argv.indexOf(name);': 'flags', "return i > -1 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;": 'flags',
    'async function rebuildReport005(argv) {': 'flags', "if (argv.filter((a) => a === '--out-root').length > 1) throw new Error('--out-root is given more than once');": 'a receipt folder, read through prepare-report-005.js, which validates each receipt and reads it through skillDirection (AC-67)',
    'argv = argv.slice();': 'flags', "let outArg = argValue(argv, '--out-root');": 'the same receipt folder', "if (argv.includes('--out-root') && !outArg) throw new Error('--out-root needs a directory');": 'the same receipt folder',
    "argv.push('--out-root', outArg);": 'the same receipt folder', "if (!argv.includes('--render-only')) throw new Error('the rebuild renders with --render-only only');": 'flag',
    'if (argv.includes(bad)) throw new Error(`the rebuild refuses ${bad}: it renders from the receipts that exist`);': 'flag', 'await p5.main(argv);': 'flags',
    'rebuildReport005(process.argv.slice(2)).catch((e) => { console.error(`rebuild-report-005: ${e && (e.message || e)}`); process.exit(1); });': 'flags',
  },
  'scripts/run-report-001.js': {
    'function parseArgs(argv) {': 'flags', 'for (let i = 0; i < argv.length; i++) {': 'flags', "if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }": 'flags',
    'const flags = parseArgs(process.argv.slice(2));': 'flags', "const outDir = path.resolve(flags.out || path.join(ROOT, 'receipts', 'report-001'));": 'output folder for the receipts its own live run writes',
    'const newModel = flags.new || manifest.model_pair.new;   // claude-sonnet-5': 'a model id', 'const oldModel = flags.old || manifest.model_pair.old;   // claude-sonnet-4-6': 'a model id',
    'const samples = flags.samples ? parseInt(flags.samples, 10) : 5;': 'a count', 'const concurrency = flags.concurrency ? parseInt(flags.concurrency, 10) : 5;': 'a count',
    'const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) : undefined;': 'a count', "const only = flags.only ? new Set(String(flags.only).split(',').map((s) => s.trim())) : null;": 'skill names',
  },
  'scripts/fill-week3.js': {},
  'docs/islands/band-playground.js': {},
};
const INPUT_LINE = /\bargv\b|\bargs\b|process\.env|\bflags\.\w|\bf\[['"]/;
const inputsOf = (text) => text.split('\n').map((l) => l.trim()).filter((l) => INPUT_LINE.test(l) && !l.startsWith('//'));
test('AC-61: readers of the published archive take no receipt path, and only read receipts that carry no mark', () => {
  const FIXED = {
    'scripts/site-data.mjs': /receipts\//, 'scripts/report-corrections.js': /docs\/reports\//, 'scripts/prepare-report-006.js': /receipts\/report-00[56]\//,
    'scripts/prepare-report-007.js': /receipts\/report-007/, 'scripts/prepare-report-008.js': /receipts\/report-008\//, 'scripts/prepare-report-009.js': /docs\/reports\/009\/evidence/, 'scripts/prepare-report-010.js': /docs\/reports\/009|R9/,
    'scripts/build-report-001.js': /receipts\/report-001|'receipts', 'report-001'/, 'scripts/rebuild-index-and-drift.js': /receipts\/report-001\//, 'scripts/run-report-001.js': /receipts\/report-001|'receipts', 'report-001'/, 'scripts/fill-week3.js': /receipts\/report-001\//,
  };
  for (const [f, re] of Object.entries(FIXED)) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), re, `${f} reads a fixed published path`);
  for (const [f, rec] of Object.entries(FIXED_INPUTS)) assert.deepEqual(inputsOf(fs.readFileSync(path.join(ROOT, f), 'utf8')), Object.keys(rec), `${f}: its arguments and environment are the recorded ones`);
  assert.notDeepEqual(inputsOf(fs.readFileSync(path.join(ROOT, 'scripts', 'fill-week3.js'), 'utf8') + '\nconst p = process.argv[2]; const r = JSON.parse(fs.readFileSync(p));'), [], 'the same listing sees a receipt path read from the command line');
  const scan = (roots) => { const hit = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json')) { const t = fs.readFileSync(p, 'utf8'); if (t.includes('"uncertainty_unavailable"') || t.includes('"source_figures"')) hit.push(p); } } }; roots.forEach(walk); return hit; };
  assert.deepEqual(scan([path.join(ROOT, 'receipts'), path.join(ROOT, 'docs', 'reports')]), [], 'no published receipt carries the mark');
  const planted = tmp('archive'); fs.writeFileSync(path.join(planted, 'x.json'), JSON.stringify(mark(RJ(BASE_A))));
  assert.equal(scan([planted]).length, 1, 'the same scan finds a planted one');
});
test('AC-62: scripts/band-plot.mjs cellOf and renderCell read refused', async () => {
  const bpm = await import(path.join(ROOT, 'scripts', 'band-plot.mjs'));
  holds('band-plot.mjs', (r) => { const c = bpm.cellOf(r); return c.state + (c.state === 'refused' ? '' : bpm.renderCell(c, { title: 't', size: 'card' })); }, PLOT);
});
test('AC-63: scripts/report-answers.js meaningOf and pairVerdict give no reading', () => {
  const ra = require('../scripts/report-answers');
  holds('meaningOf', (r) => ra.meaningOf(r), PLAIN);
  holdsPair('pairVerdict', (a, b) => ra.pairVerdict(a, b), /separated-up|separated-down|"token":"(?:underpowered|no-separation)"/);
});
test('AC-64: scripts/prepare-report-002.js durabilityVerdict, and qa-report-002.js through it, give no label', () => {
  const p2 = require('../scripts/prepare-report-002');
  holdsPair('durabilityVerdict', (a, b) => p2.durabilityVerdict(a, b), SCRIPT);
  const run = (a, b) => { const d = tmp('qa002'); fs.mkdirSync(path.join(d, 'receipts', 'report-002'), { recursive: true }); fs.mkdirSync(path.join(d, 'reports')); fs.writeFileSync(path.join(d, 'receipts', 'report-002', 'x__claude-sonnet-5.json'), JSON.stringify(a)); fs.writeFileSync(path.join(d, 'receipts', 'report-002', 'x__gpt-5.6-sol.json'), JSON.stringify(b)); const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'qa-report-002.js')], { cwd: d, encoding: 'utf8' }); return r.stdout.split('\n').filter((l) => /\bx\b/.test(l)).join('\n'); };
  holdsPair('qa-report-002', run, /\b(?:DURABLE|REGRESSES|NO EFFECT|SUBSTRATE-DEPENDENT)\b/);
});
test('AC-65: scripts/prepare-report-003.js driftVerdict gives no label', () => holdsPair('driftVerdict', (a, b) => require('../scripts/prepare-report-003').driftVerdict(a, b), SCRIPT));
test('AC-66: scripts/prepare-report-004.js capabilityVerdict and tierDirection give no label', () => {
  const p4 = require('../scripts/prepare-report-004');
  holdsPair('capabilityVerdict', (a, b) => p4.capabilityVerdict(a, b), SCRIPT);
  holds('tierDirection', (r) => p4.tierDirection(r), /"dir":"(?:help|hurt|mixed|flat)"/);
});
test('AC-67: scripts/prepare-report-005.js skillDirection gives no direction', () => holds('skillDirection', (r) => require('../scripts/prepare-report-005').skillDirection(r), /"dir":"(?:help|hurt|mixed|flat)"|"separated":true/));
test('AC-68: lib/revision.js revisionClass, which prepare-report-006 and run-report-006 read, classifies no marked pair', () => holdsPair('revisionClass', (a, b) => require('../lib/revision').revisionClass(require('../lib/diff').buildDriftReport(a, b, { mode: 'revision' }).perCase), new RegExp(`REVISION IMPROVED|REVISION REGRESSED|MIXED|${NOISE_UP}`)));
test('AC-69: scripts/run-report-006.js verdictForCell reads NOT MEASURED for a marked fresh receipt', () => {
  const r6 = require('../scripts/run-report-006');
  const cell = r6.CELLS[0];
  const fresh = clone(RJ(`receipts/report-005/${cell.slug}__${cell.model}.json`)); fresh.skill.content_hash = 'f'.repeat(64); sealReceipt(fresh);
  const read = (r) => { const f = path.join(tmp('r006'), 'fresh.json'); fs.writeFileSync(f, JSON.stringify(r)); return said(() => { const v = r6.verdictForCell(cell, f); return { verdict: v.verdict, markdown: v.markdown }; }); };
  const re = /"verdict":\[|\*\*(?:REVISION IMPROVED|REVISION REGRESSED|MIXED|NO SEPARATION DETECTED|INCONCLUSIVE)\b/;
  assert.match(read(fresh), re, 'the live control reads a verdict');
  assert.doesNotMatch(read(mark(fresh)), re, 'the marked copy');
  for (const s of subjects()) assert.doesNotMatch(read(s.r), re, s.name);
});
test('AC-70: scripts/prepare-report-007.js and -008.js read no marked receipt: archiveRows and driftFor refuse it', () => {
  const p7 = require('../scripts/prepare-report-007'); const p8 = require('../scripts/prepare-report-008');
  for (const s of subjects()) {
    const abs = path.join(tmp('p78'), 'x.json'); fs.writeFileSync(abs, JSON.stringify(s.r));
    const f = path.relative(ROOT, abs);
    assert.doesNotMatch(said(() => p7.archiveRows([{ slug: 'code-review-and-quality', receipt: s.r, archive005: f, archive006: f }])), new RegExp(`\\b(?:improved|regressed|no effect|${NOISE_UP})\\b`), `archiveRows on ${s.name}`);
    assert.doesNotMatch(said(() => p8.driftFor({ slug: 'code-review-and-quality', baseline: f, receipt: f, labelA: 'a', labelB: 'b' })), new RegExp(`\\b(?:improved|regressed|no effect|${NOISE_UP})\\b`), `driftFor on ${s.name}`);
  }
});
test('AC-71: scripts/prepare-report-011.js, -013.js and -014.js verdicts refuse a marked receipt', () => {
  const sets = { '011': require('../scripts/prepare-report-011'), '013': require('../scripts/prepare-report-013'), '014': require('../scripts/prepare-report-014') };
  for (const [n, m] of Object.entries(sets)) {
    const rec = m.readAll();
    assert.match(said(() => m.verdicts(rec)), /token|PASSED|NO_EFFECT|UNDERPOWERED|REGRESSED/, `report ${n}: the published set reads verdicts`);
    for (const s of subjects()) {
      const k = Object.keys(rec)[0]; const planted = { ...rec, [k]: s.r };
      assert.match(said(() => m.verdicts(planted)), /^refused: /, `report ${n} refuses ${s.name}`);
    }
  }
});
test('AC-72: scripts/prepare-report.js skillVerdict gives a marked pair no label', () => {
  const pr = require('../scripts/prepare-report');
  assert.equal(typeof pr.skillVerdict, 'function', 'skillVerdict is exported so it can be read');
  holdsPair('skillVerdict', (a, b) => pr.skillVerdict(require('../lib/diff').buildDriftReport(a, b)), new RegExp(`\\b(?:MIXED|REGRESSED|IMPROVED|${NOISE_UP})\\b`));
});

// AC-73: the reader list is closed. Every file under the roots whose text matches the pattern is in
// readers.json, and every entry names a file that exists and criteria the spec states. A-265-4 (issue 381):
// a reader is executable code, a .js, .mjs or .cjs file or a file under bin/; a data file is never one.
const isCode = (rel) => /\.(?:js|mjs|cjs)$/.test(rel) || rel.startsWith('bin/');
function unlisted(root, table) {
  const re = new RegExp(table.pattern);
  const found = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) { for (const e of fs.readdirSync(abs).sort()) walk(path.posix.join(rel, e)); return; }
    if (st.isFile() && isCode(rel) && re.test(fs.readFileSync(abs, 'utf8'))) found.push(rel);
  };
  for (const r of table.roots) walk(r);
  return found.filter((f) => !Object.hasOwn(table.files, f));
}
test('AC-73: every file that reads verification_level, comparison or receiptVerdict is in the reader list', () => {
  const table = JSON.parse(fs.readFileSync(path.join(SPEC, 'readers.json'), 'utf8'));
  assert.deepEqual(unlisted(ROOT, table), [], 'every matching file is listed');
  const specText = fs.readFileSync(path.join(SPEC, 'spec.md'), 'utf8');
  const stated = new Set([...specText.matchAll(/\*\*(AC-\d+)\b|^\| (AC-\d+) \|/gm)].map((m) => m[1] || m[2]));
  for (const [f, e] of Object.entries(table.files)) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
    assert.ok(isCode(f), `${f} is executable code`);
    assert.ok(['reader', 'writer', 'fixed', 'other'].includes(e.class), `${f}: a class`);
    if (e.class === 'other') assert.ok(typeof e.reason === 'string' && e.reason.length > 10, `${f}: a reason`);
    else { assert.ok(Array.isArray(e.acs) && e.acs.length, `${f}: criteria`); for (const ac of e.acs) assert.ok(stated.has(ac), `${f}: ${ac} is stated in the spec`); }
  }
  // Plants: a new reader in a scratch tree is seen as unlisted; an entry naming AC-99 is seen as unstated.
  // A-265-3 (issue 377) planted a fourth copy of a sample receipt, read as unlisted. Under A-265-4 a receipt
  // is data, so the same copy is planted and must be read as no reader at all.
  const scratch = tmp('readers');
  for (const r of table.roots) if (fs.existsSync(path.join(ROOT, r))) copyTree(path.join(ROOT, r), path.join(scratch, r));
  fs.writeFileSync(path.join(scratch, 'lib', 'new-reader.js'), 'module.exports = (receipt) => receipt.verification_level;\n');
  // A-265-4: a data file carrying the word, here a receipt-shaped .json, is not a reader; a .cjs or a bin/ file is.
  fs.writeFileSync(path.join(scratch, 'lib', 'sample.json'), '{"verification_level": "imported"}\n');
  fs.writeFileSync(path.join(scratch, 'lib', 'new-reader.cjs'), 'module.exports = (r) => r.verification_level;\n');
  fs.writeFileSync(path.join(scratch, 'bin', 'new-door'), 'console.log(r.verification_level);\n');
  const sample = 'plugin/driftproof/sample/report-014';
  const copied = `${sample}/run-4/git-workflow-and-versioning-claude-haiku-5-5-2026-10-07.json`;
  fs.mkdirSync(path.join(scratch, sample, 'run-4'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, sample, 'run-1', 'git-workflow-and-versioning-claude-haiku-5-5-2026-10-07.json'), path.join(scratch, copied));
  assert.ok(/verification_level/.test(fs.readFileSync(path.join(scratch, copied), 'utf8')), 'the copied sample receipt carries the word');
  assert.deepEqual(unlisted(scratch, table).sort(), ['bin/new-door','lib/new-reader.cjs', 'lib/new-reader.js']);
  assert.equal(stated.has('AC-99'), false);
});

// AC-74: regrade, a writer that derives a receipt from another, refuses a marked receipt first.
test('AC-74: lib/regrade.js refuses a marked receipt before anything else, naming aggregates only', async () => {
  const Rg = require('../lib/regrade');
  const skill = { contentHash: 'x', suite: { suiteHash: 'y', cases: [] } };
  for (const s of subjects()) {
    const p = Rg.planRegrade({ receipt: s.r, skill, answers: { answers: [] }, judgeModel: 'claude-haiku-4-5', samples: 1 });
    assert.equal(p.problems.length, 1, `${s.name}: ${JSON.stringify(p.problems)}`);
    assert.match(p.problems[0], /aggregates only/);
    assert.equal(p.calls, 0);
    await assert.rejects(() => Rg.regradeReceipt({ receipt: s.r, skill, answers: { answers: [] }, judgeModel: 'claude-haiku-4-5', samples: 1 }), /aggregates only/, s.name);
  }
  assert.doesNotMatch(said(() => Rg.planRegrade({ receipt: RJ(BASE_A), skill, answers: { answers: [] }, judgeModel: 'claude-haiku-4-5', samples: 1 })), /aggregates only/, 'the unmarked control is not refused for the mark');
});

// AC-75: lint-suite's history excludes a marked receipt. lintSuite is run on spec 189's fixture skill with
// one receipt in its receipt directory, and the history notice is read. The subjects are the two imported
// receipts. The planted archive receipt is not one: it is v0.12 with v0.13's fields, refused by the schema
// check before history is read, as is any TESTED receipt with the mark. The control is the fixture's own
// receipt: history is checked and nothing is excluded, so the run reaches addHistory. The plant is
// lib/lint-suite.js with the call that reads the rule taken out, compiled in place of the module: the
// notice then names another reason, not aggregates only.
const LINT_SRC = path.join(ROOT, 'lib', 'lint-suite.js');
const HISTORY_CALL = 'if(historyReason(r))reason=historyReason(r);';
function lintFrom(src) {
  const Module = require('node:module');
  const m = new Module(LINT_SRC, module); m.filename = LINT_SRC; m.paths = Module._nodeModulePaths(path.dirname(LINT_SRC));
  m._compile(src, LINT_SRC); return m.exports;
}
function lintHistory(L, r) {
  const P = require('../specs/189-issue-206-lint-suite/plants.cjs');
  const root = tmp('lint'); const dir = P.skillAt(root);
  const rep = L.lintSuite(dir, { receiptsDir: P.receiptsAt(root, [typeof r === 'function' ? r(dir) : r]) });
  return { status: rep.history.status, excluded: rep.notices.filter((n) => /excluded from history/.test(n)) };
}
const AGG_NOTICE = /^"r1\.json": aggregates only: .*; excluded from history\.$/;
test('AC-75: lib/lint-suite.js excludes a marked receipt from its history, naming aggregates only', () => {
  const P = require('../specs/189-issue-206-lint-suite/plants.cjs');
  const L = require('../lib/lint-suite');
  assert.deepEqual(lintHistory(L, (dir) => P.receiptFor(dir, 1)), { status: 'checked', excluded: [] }, 'the control is history evidence');
  for (const s of subjects().slice(0, 2)) {
    const got = lintHistory(L, s.r);
    assert.equal(got.status, 'no-usable-history', `${s.name}: ${JSON.stringify(got)}`);
    assert.equal(got.excluded.length, 1, `${s.name}: ${JSON.stringify(got)}`);
    assert.match(got.excluded[0], AGG_NOTICE, s.name);
  }
  // Plant: the call taken out, each subject's notice no longer names aggregates only.
  const src = fs.readFileSync(LINT_SRC, 'utf8');
  assert.equal(src.split(HISTORY_CALL).length, 2, 'the call is in addHistory once');
  const planted = lintFrom(src.replace(HISTORY_CALL, ''));
  for (const s of subjects().slice(0, 2)) {
    const got = lintHistory(planted, s.r);
    assert.equal(got.excluded.length, 1, `planted, ${s.name}: ${JSON.stringify(got)}`);
    assert.doesNotMatch(got.excluded[0], AGG_NOTICE, `planted, ${s.name}`);
  }
});

// AC-76 (A-265-2, issue 334): spec 267's skill index builder gives a marked receipt no verdict word. Each
// subject is listed alone in a scratch index manifest, under each of the three sources, with the records
// the build reads beside it: Report 009's identity records copied from the tree, an empty skill-placebo
// verdicts file and install record. A Driftproof or skill-placebo listing is refused; an NVIDIA listing
// builds only a DECLARED receipt, and its row is read from the built page.
const INDEX_PROTOCOL = 'docs/reports/009/evidence/three-skill-comparison--protocol.md';
const INDEX_UPSTREAM = 'specs/034-report-009-three-skill-comparison/evidence/upstream-skill-sha256-20260915T185745Z.txt';
const INDEX_FILE = { driftproof: 'receipts/report-009/x.json', 'skill-placebo': 'index-receipts/skill-placebo/x.json', nvidia: 'index-receipts/nvidia/x.json' };
function indexRoot(source, r) {
  const root = tmp('index');
  const put = (rel, b) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), b); };
  for (const rel of [INDEX_PROTOCOL, INDEX_UPSTREAM]) put(rel, fs.readFileSync(path.join(ROOT, rel)));
  const verdicts = Buffer.from('{"comparisons":{}}\n'); const lock = Buffer.from('{"skills":[]}\n');
  put('index-receipts/skill-placebo/claude-code.json', verdicts); put('index-receipts/skill-placebo/skills.lock.json', lock);
  for (const id of ['skill-placebo', 'nvidia']) put(`index-receipts/${id}/LICENSE`, 'stand-in licence text, spec 265 AC-76\n');
  const bytes = Buffer.from(JSON.stringify(r, null, 2)); put(INDEX_FILE[source], bytes);
  const sf = r.source_figures && r.source_figures.source;
  const commit = sf && /^[0-9a-f]{40}$/.test(String(sf.commit)) ? sf.commit : 'e'.repeat(40);
  const card = sf && sf.files && sf.files[0] ? String(sf.files[0].path).replace(/\/BENCHMARK\.md$/, '') : 'skills/x';
  const entry = { source, file: INDEX_FILE[source], sha256: sha256(bytes), name: card.split('/').pop(), skill_commit: commit, identity: { owner: 'NVIDIA', repo: 'skills', path: card, unit: 'skill' } };
  if (source === 'driftproof') entry.report = '009';
  if (source === 'skill-placebo') entry.verdict_key = 'x';
  put('index-receipts/sources.json', JSON.stringify({
    sources: [
      { id: 'driftproof', name: 'Driftproof', repo: 'driftproofhq/driftproof', commit: null, licence: 'Apache-2.0', identity_record: { protocol: INDEX_PROTOCOL, upstream: INDEX_UPSTREAM } },
      { id: 'skill-placebo', name: 'skill-placebo', repo: 'simonether/skill-placebo', commit: 'e'.repeat(40), licence: 'MIT', licence_file: 'index-receipts/skill-placebo/LICENSE',
        verdicts: { file: 'index-receipts/skill-placebo/claude-code.json', git_blob_sha1: gitSha1(verdicts) }, identity_record: { file: 'index-receipts/skill-placebo/skills.lock.json', git_blob_sha1: gitSha1(lock) } },
      { id: 'nvidia', name: 'NVIDIA', repo: 'NVIDIA/skills', commit, licence: 'CC-BY-4.0', licence_file: 'index-receipts/nvidia/LICENSE' },
    ],
    receipts: [entry],
    model_aliases: {},
  }, null, 2));
  return root;
}
// -> { refused: message } or { rows: [the row markup of every built page] }
async function indexed(source, r) {
  const { buildSkillIndex } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'scripts', 'build-skill-index.mjs')).href);
  try {
    const out = buildSkillIndex({ root: indexRoot(source, r), buildDate: '2026-10-15' });
    return { rows: out.files.filter((f) => f.path.endsWith('.html')).flatMap((f) => String(f.bytes).match(/<article class="skill-row"[\s\S]*?<\/article>/g) || []) };
  } catch (e) { return { refused: String(e && e.message) }; }
}
const unmark = (r) => { const x = clone(r); delete x.uncertainty_unavailable; delete x.source_figures; return sealReceipt(x); };
const INDEX_WORDS = () => {
  const { LABELS } = require('../lib/plain');
  const words = ['PASSED', 'REGRESSED', 'NO_EFFECT', 'UNDERPOWERED', 'UNDERPOWERED_CASES', 'INCONCLUSIVE', 'SMOKE', 'REPORTED'].map((k) => LABELS[k]);
  return new RegExp([...words, V().UNDERPOWERED_LINE, V().CASES_LINE].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
};
test('AC-76: scripts/build-skill-index.mjs gives a marked receipt no verdict word: refused unless an NVIDIA row, which is the card\'s figures', async () => {
  const words = INDEX_WORDS();
  for (const s of subjects()) {
    for (const source of ['driftproof', 'skill-placebo']) {
      const got = await indexed(source, s.r);
      assert.ok(got.refused, `${s.name} listed as ${source} is refused: ${JSON.stringify(got).slice(0, 200)}`);
    }
    const nv = await indexed('nvidia', s.r);
    if (s.r.verification_level !== 'DECLARED') { assert.ok(nv.refused, `${s.name} listed as nvidia is refused`); continue; }
    assert.equal(nv.refused, undefined, `${s.name} listed as nvidia builds: ${nv.refused}`);
    assert.equal(nv.rows.length, 1, `${s.name}: one row`);
    const row = nv.rows[0];
    assert.match(row, /data-evidence="aggregates-only"/, s.name);
    const overall = s.r.source_figures.rows.find((x) => x.dimension === 'Overall') || s.r.source_figures.rows[0];
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    assert.ok(row.includes(esc(overall.printed)), `${s.name}: the row carries the card's ${overall.dimension} cell as printed`);
    assert.doesNotMatch(row, words, `${s.name}: the row carries a verdict word`);
    // Plant: the same row with a verdict word written in is seen.
    assert.match(row.replace('<dd>', '<dd>Clearly helped. '), words);
  }
  // Plants: the mark is what refuses. The planted subject as a Driftproof receipt, and an imported subject
  // restamped imported/harbor as a skill-placebo receipt, are refused naming aggregates only; the same
  // receipts without the mark are not refused for it.
  const planted = subjects()[2].r;
  assert.match((await indexed('driftproof', planted)).refused || '', /aggregates only/, 'the planted subject as a Driftproof receipt');
  assert.doesNotMatch((await indexed('driftproof', unmark(planted))).refused || 'built', /aggregates only/, 'the planted subject without the mark');
  const harbor = (r) => { const x = clone(r); x.run.source = 'imported/harbor'; return sealReceipt(x); };
  const imp = subjects()[0].r;
  assert.match((await indexed('skill-placebo', harbor(imp))).refused || '', /aggregates only/, 'an imported subject restamped imported/harbor');
  assert.doesNotMatch((await indexed('skill-placebo', unmark(harbor(imp)))).refused || 'built', /aggregates only/, 'the same without the mark');
  assert.match((await indexed('nvidia', unmark(imp))).refused || '', /marked aggregates only/, 'an NVIDIA listing without the mark is refused');
});

// AC-29: no reader turns the printed figures into a sample, a spread, a baseline or a relative figure,
// and an unstated unit stays unstated. Each text reader is run on a marked receipt and on the same
// receipt with every printed figure moved; a number that differs between the two must be one the card
// prints. Hashes, temporary paths and the reader's own random delimiters are taken out first.
const TMP_RE = new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\s"\'<)]*', 'g');
const numbersIn = (s) => new Set([...withoutStyle(s).replace(TMP_RE, '<tmp>').replace(/[0-9a-f]{8,}/gi, '<hex>').matchAll(/\d+(?:\.\d+)?/g)].map((m) => String(Number(m[0]))));
function movedFigures(r) {
  const x = clone(r);
  for (const row of x.source_figures.rows) {
    // Each field moves by its own step, so a difference or a ratio of two of them moves too.
    for (const [k, step] of [['score_pct', 7.3], ['baseline_pct', 3.1], ['uplift', 1.7]]) if (typeof row[k] === 'number') row[k] = Math.round((row[k] + step) * 10) / 10;
    row.printed = row.printed.replace(/\d+(?:\.\d+)?/g, (n) => String(Math.round((Number(n) + 7.3) * 10) / 10));
  }
  return sealReceipt(x);
}
const TEXT_READERS = {
  plainOf: (r) => require('../lib/plain').plainOf(r),
  badgeSvg: (r) => require('../lib/badge-svg').badgeSvg(r),
  badgeEndpoint: (r) => V().badgeEndpoint(r),
  toSummaryJson: (r) => require('../lib/export').toSummaryJson(r),
  summarizeReceipt: (r) => require('../lib/run').summarizeReceipt(r),
  page: (r) => require('../scripts/build-receipt-pages').page({ rel: 'receipts/x/y.json', receipt: r }).html,
  receiptWords: (r) => require('../scripts/build-site-pages').receiptWords(r),
  liftBreakdown: (r) => require('../lib/view').liftBreakdown(r),
  cellOf: (r) => require('../lib/band-plot').cellOf(r),
  view: (r) => viewHtml(r),
};
function workedOut(read, r) {
  const a = numbersIn(said(() => read(r))); const b = numbersIn(said(() => read(movedFigures(r))));
  const printed = printedNumbers(r);
  return [...a].filter((n) => !b.has(n) && !printed.has(n));
}
test('AC-29: no reader works out a baseline, a spread, a relative uplift or a unit from the printed figures', () => {
  for (const s of subjects().slice(0, 2)) {
    for (const [k, read] of Object.entries(TEXT_READERS)) assert.deepEqual(workedOut(read, s.r), [], `${k} on ${s.name} prints a number worked out from the figures`);
  }
  const old = receiptOf(imported(), 'amc-setup-calibration-stack', 'claude-code');
  const worded = (s) => /\b51(?:\.0+)?\s*%|\b0\.51\b|\bpoints?\b|\u00b1\s*\d/.test(withoutStyle(s));
  for (const [k, read] of Object.entries(TEXT_READERS)) assert.equal(worded(said(() => read(old))), false, `${k} states a unit or a baseline`);
  // Plants: a relative uplift, a worked-out baseline and a stated unit, each seen by the same checks.
  const correctness = (r) => r.source_figures.rows.find((x) => x.dimension === 'Correctness');
  assert.deepEqual(workedOut((r) => `${(correctness(r).score_pct / (1 + correctness(r).uplift / 100)).toFixed(1)}%`, old), ['63.2']);
  assert.notDeepEqual(workedOut((r) => `baseline ${correctness(r).score_pct - correctness(r).uplift}%`, old), []);
  assert.equal(worded('uplift +33 points'), true);
  assert.equal(worded('baseline 51%'), true);
});

module.exports = { CARDS, AT };
