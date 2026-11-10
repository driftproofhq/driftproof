// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256, sha256Canonical } = require('../lib/canonical');
const { sealReceipt, listReceipts } = require('../lib/receipt');
const { pairsOf, tallyOf, judgeReadingOf, readArchive, runBlind, HONESTY, chanceLine, resultLines, makeRecord, writeRecord, readSuite } = require('../lib/blind');
const { renderView, staleLine } = require('../lib/view');
const { staleReport } = require('../lib/stale');
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin/driftproof');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-619-'));
const out = path.join(dir, 'receipts');
let receipt, file, archive, archiveFile;
test('A-619-3: an answer keeps its emoji whole, and a hidden character still shows', () => {
  const { termText, shellArg } = require('../lib/names');
  const of = (...points) => String.fromCodePoint(...points);
  const emoji = {
    'a warning sign': of(0x26a0, 0xfe0f),
    'a text-style heart': of(0x2764, 0xfe0e),
    'a skin tone': of(0x1f44d, 0x1f3fd),
    'a joined person': of(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb),
    'a rainbow flag': of(0x1f3f3, 0xfe0f, 0x200d, 0x1f308),
    'a keycap': of(0x31, 0xfe0f, 0x20e3),
    'the flag of England': of(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f),
    'the flag of Wales': of(0x1f3f4, 0xe0067, 0xe0062, 0xe0077, 0xe006c, 0xe0073, 0xe007f),
  };
  for (const [what, form] of Object.entries(emoji)) {
    const text = 'Before ' + form + ' after';
    assert.equal(termText(text), text, what);
    assert.equal(shellArg(text), "'" + text + "'", what);
  }
  const hidden = {
    'a zero-width space': [of(0x200b), '\\u{200b}'],
    'a lone selector': ['a' + of(0xfe0f), 'a\\u{fe0f}'],
    'a second selector': [of(0x26a0, 0xfe0f, 0xfe0f), of(0x26a0, 0xfe0f) + '\\u{fe0f}'],
    'a joiner between letters': ['a' + of(0x200d) + 'b', 'a\\u{200d}b'],
    'a joiner after the last emoji': [of(0x1f600, 0x200d), of(0x1f600) + '\\u{200d}'],
    'a tag run after a black flag': [of(0x1f3f4, 0xe0041, 0xe0042), of(0x1f3f4) + '\\u{e0041}\\u{e0042}'],
    'a tag after an emoji': [of(0x1f600, 0xe0041), of(0x1f600) + '\\u{e0041}'],
    'a right-to-left override': [of(0x202e), '\\u{202e}'],
    'a control': [of(0x1b), '\\u{1b}'],
  };
  for (const [what, [text, shown]] of Object.entries(hidden)) assert.equal(termText(text), shown, what);
  for (const text of ['it' + of(0x27) + 's ' + of(0x26a0, 0xfe0f), 'a' + of(0x200b) + 'b ' + of(0x26a0, 0xfe0f), of(0xe0041) + of(0x5c)]) {
    const back = spawnSync('bash', ['-c', 'printf %s ' + shellArg(text)], { encoding: 'utf8' });
    assert.equal(back.stdout, text, 'shellArg gives back the exact bytes');
  }
});

test.before(() => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|^DRIFTPROOF_/.test(k)));
  const r = spawnSync(process.execPath, [BIN, 'run', path.join(ROOT, 'examples/commit-message-conventions'), '--placebo', '--keep-transcripts', '--out', out], { cwd: dir, env: { ...env, DRIFTPROOF_STUB: '1' }, encoding: 'utf8', timeout: 1800000 });
  assert.equal(r.status, 0, r.stderr);
  file = listReceipts(out)[0].file;
  receipt = JSON.parse(fs.readFileSync(file));
  archiveFile = path.join(dir, 'transcripts', receipt.receipt_hash, 'answers.json');
  archive = JSON.parse(fs.readFileSync(archiveFile));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const cli = (f = file, args = []) => spawnSync(process.execPath, [BIN, 'blind', f, ...args], { cwd: dir, encoding: 'utf8', timeout: 1800000 });

test('AC-1/6: changed score, absent archive and pipe refuse without output or writes', () => {
  const before = fs.readdirSync(out);
  const bad = structuredClone(receipt); bad.results.cases[0].mean += 0.01;
  const badFile = path.join(dir, 'bad.json'); fs.writeFileSync(badFile, JSON.stringify(bad));
  const changed = cli(badFile); assert.equal(changed.status, 4); assert.equal(changed.stdout, ''); assert.match(changed.stderr, /bad.json/);
  const pipe = cli(); assert.equal(pipe.status, 2); assert.match(pipe.stderr, /terminal/); assert.match(pipe.stderr, /driftproof view/);
  fs.renameSync(archiveFile, archiveFile + '.saved');
  try { const missing = cli(); assert.equal(missing.status, 2); assert.match(missing.stderr, /answers.json/); assert.match(missing.stderr, /--keep-transcripts/); assert.match(missing.stderr, /--quick/); } finally { fs.renameSync(archiveFile + '.saved', archiveFile); }
  for (const args of [['--against', 'other'], ['--pairs', '0'], ['--pairs'], ['--out', 'record.json'], ['--unknown']]) assert.equal(cli(file, args).status, 2);
  assert.deepEqual(fs.readdirSync(out), before);
});

test('AC-2/3: pairing, archive prompt identity and negative plants', () => {
  const paired = pairsOf(receipt, archive);
  assert.equal(paired.against, 'placebo'); assert.ok(paired.pairs.length > 10);
  assert.equal(paired.pairs[0].prompt, archive.suite.cases[0].prompt);
  assert.equal(pairsOf(receipt, archive, 'baseline').against, 'baseline');
  const noPlacebo = structuredClone(receipt); delete noPlacebo.placebo; noPlacebo.results.cases = noPlacebo.results.cases.filter(c => c.mode !== 'placebo');
  const sealed = sealReceipt(require('./receipt-versions').recount(noPlacebo));
  assert.equal(pairsOf(sealed, archive).against, 'baseline');
  assert.throws(() => pairsOf(sealed, archive, 'placebo'), /placebo/);
  const noFile = path.join(dir, 'no-placebo.json'); fs.writeFileSync(noFile, JSON.stringify(sealed));
  assert.equal(cli(noFile, ['--against', 'placebo']).status, 2);
  const edited = structuredClone(archive);
  const hash = receipt.results.cases[0].generation.draws[0].generation_hash;
  edited.answers[hash] = 'EDITED ANSWER MUST NOT APPEAR';
  const dropped = pairsOf(receipt, edited); assert.ok(dropped.dropped.length > 0);
  assert.ok(dropped.dropped.some(d => /hash/.test(d.reason))); assert.ok(!JSON.stringify(dropped.pairs).includes('EDITED ANSWER'));
  delete edited.answers[hash]; assert.ok(pairsOf(receipt, edited).dropped.some(d => /missing/.test(d.reason)));
  const moved = structuredClone(archive); moved.suite.cases[0].prompt = 'ALTERED PROMPT';
  assert.ok(!JSON.stringify(pairsOf(receipt, moved).pairs).includes('ALTERED PROMPT'));
  const unmeasured = structuredClone(receipt);
  const opposite = unmeasured.results.cases.find(c => c.mode === 'placebo');
  opposite.generation.draws[0] = { ...opposite.generation.draws[0], status: 'unmeasured', reason: 'timeout', mean: null, stddev: null, samples: [], judge_sample_hashes: [] };
  opposite.generation.n_measured--; opposite.generation.n_unmeasured++;
  const missingDraw = pairsOf(sealReceipt(unmeasured), archive);
  assert.ok(missingDraw.dropped.some(d => /matching measured placebo draw missing/.test(d.reason)));
  const old = { answers: archive.answers }; assert.match(pairsOf(receipt, old).pairs[0].prompt, /not kept/);
});

test('AC-4/5: scripted reads, independent arithmetic, create-only records and consumers', async () => {
  const pairs = pairsOf(receipt, archive).pairs.slice(0, 3).map((p, i) => ({ ...p, with_mean: [0.9, 0.1, 0.5][i], against_mean: 0.5 }));
  assert.deepEqual(judgeReadingOf(pairs), { higher: 1, lower: 1, same: 1 });
  assert.deepEqual(tallyOf([{ shown_first: 'with_skill', pick: 'A' }, { shown_first: 'baseline', pick: 'A' }, { shown_first: 'baseline', pick: 'B' }]), { picked_correct: 2, pairs_total: 3 });
  const rows = pairs.map(p => ({ id: p.id, draw_index: p.draw_index, shown_first: 'with_skill', pick: 'A', correct: true }));
  const record = makeRecord(receipt, 'placebo', rows, judgeReadingOf(pairs));
  const { sha256: digest, ...unsigned } = record; assert.equal(digest, sha256Canonical(unsigned));
  const a = writeRecord(file, record), b = writeRecord(file, record);
  assert.match(b, /-2.blind.json$/); assert.notEqual(a, b); assert.equal(listReceipts(out).length, 1);
  const text = fs.readFileSync(a, 'utf8');
  assert.ok(!text.includes(pairs[0].prompt)); assert.ok(!text.includes(pairs[0].with_answer)); assert.ok(!text.includes('@')); assert.ok(!text.includes('/' + 'home'));
  assert.ok(!renderView(out).html.includes('not read'));
  const stale = spawnSync(process.execPath, [BIN, 'stale', a], { encoding: 'utf8', timeout: 1800000 });
  assert.ok(!stale.stdout.includes('does not verify'));
  const preload = path.join(dir, 'terminal.cjs'); fs.writeFileSync(preload, 'Object.defineProperty(process.stdin, "isTTY", { value: true });');
  const terminal = spawnSync(process.execPath, ['--require', preload, BIN, 'blind', file, '--pairs', '1', '--against', 'baseline'], { cwd: dir, input: 'A\n', encoding: 'utf8', timeout: 1800000 });
  assert.equal(terminal.status, 0, terminal.stderr); assert.match(terminal.stdout, /You picked the file's answer [01] of 1 times/);
  assert.throws(() => makeRecord(receipt, 'placebo', [{ id: '../private', pick: 'A', shown_first: 'with_skill' }], { higher: 0, lower: 0, same: 0 }), /identifiers/);
  const lines = resultLines(record, receipt); assert.ok(lines.includes(chanceLine(3))); assert.ok(lines.includes(HONESTY));
  const printed = []; const picks = ['bad', 'A', 'B'];
  const result = await runBlind(file, { pairs: '2' }, { isTTY: true, coin: () => 0, ask: async () => picks.shift(), print: s => printed.push(s) });
  assert.equal(result.picked_correct, 1); assert.equal(result.pairs_total, 2);
  assert.ok(printed.join('\n').includes('Answer A')); assert.ok(printed.includes(HONESTY));
  assert.ok(printed.includes("You picked the file's answer 1 of 2 times"));
  const before = fs.readdirSync(out); await assert.rejects(runBlind(file, {}, { isTTY: true, ask: async () => null, print: () => {} }), /ended/); assert.deepEqual(fs.readdirSync(out), before);
});

test('AC-7/8: real browser reads capped pairs, early reveal, safe payload and no requests', async () => {
  const { chromium } = require('playwright');
  const r = structuredClone(receipt), a = structuredClone(archive);
  const payload = '</script><script>globalThis.blindInjected=1</script>';
  const hash = sha256(payload); a.answers[hash] = payload;
  r.results.cases[0].generation.draws[0].generation_hash = hash;
  const sealed = sealReceipt(r);
  const nested = path.join(dir, 'browser', 'receipts'); fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'one.json'), JSON.stringify(sealed));
  fs.writeFileSync(path.join(nested, 'two.json'), JSON.stringify(sealed));
  const arc = path.join(dir, 'browser', 'transcripts', sealed.receipt_hash); fs.mkdirSync(arc, { recursive: true }); fs.writeFileSync(path.join(arc, 'answers.json'), JSON.stringify(a));
  const html = renderView(nested).html;
  assert.equal((html.match(/data-field="blind-read"/g) || []).length, 2);
  assert.ok(!html.includes(payload)); assert.ok(html.includes('\\u003c/script>'));
  assert.match(html, /data-pairs="10"/); assert.ok(html.includes('10 of '));
  assert.ok(html.includes('<noscript>')); assert.ok(html.includes('driftproof blind'));
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">`));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); const requests = [], errors = []; page.on('request', r => requests.push(r.url())); page.on('pageerror', e => errors.push(e.message));
    await page.setContent(html);
    const blocks = page.locator('[data-field="blind-read"]'); const first = blocks.nth(0), second = blocks.nth(1);
    assert.equal(await first.locator('[data-blind-result]').isVisible(), false);
    await first.getByRole('button', { name: 'Reveal', exact: true }).click();
    assert.equal(await first.locator('[data-blind-result]').isVisible(), true);
    assert.equal(await second.locator('[data-blind-result]').isVisible(), false);
    const early = JSON.parse(await first.locator('textarea').inputValue()); assert.equal(early.pairs_total, 0); assert.ok(!('sha256' in early));
    // A-619-1: one pair at a time, and Reveal after the last pick.
    for (let i = 0; i < 10; i++) {
      await second.locator('fieldset:visible').getByLabel('Answer A', { exact: true }).check();
      if (i < 9) await second.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await second.getByRole('button', { name: 'Reveal', exact: true }).click();
    const record = JSON.parse(await second.locator('textarea').inputValue()); assert.equal(record.pairs_total, 10);
    assert.equal(record.picked_correct, record.pairs.filter(p => p.shown_first === 'with_skill').length);
    assert.ok((await second.innerText()).includes(HONESTY)); assert.ok((await second.innerText()).includes(chanceLine(10)));
    assert.equal(await page.evaluate(() => globalThis.blindInjected), undefined); assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// A-619-1 (issue 633): prompts from a matching suite, one pair at a time, bounded panes.
const SUITE = path.join(ROOT, 'examples/commit-message-conventions/evals/evals.json');
let suiteN = 0;
function suiteCopy(edit) {
  const s = JSON.parse(fs.readFileSync(SUITE, 'utf8')); if (edit) edit(s);
  const f = path.join(dir, 'suite-' + (++suiteN) + '.json'); fs.writeFileSync(f, JSON.stringify(s)); return f;
}
const promptOf = id => JSON.parse(fs.readFileSync(SUITE, 'utf8')).cases.find(c => c.id === id).prompt;
// A results folder whose archives hold answers and no suite, as Report 017's did.
function keptFolder(name, receipts) {
  const root = path.join(dir, name), rd = path.join(root, 'receipts'); fs.mkdirSync(rd, { recursive: true });
  for (const [file, r] of Object.entries(receipts)) {
    fs.writeFileSync(path.join(rd, file), JSON.stringify(r));
    const arc = path.join(root, 'transcripts', r.receipt_hash); fs.mkdirSync(arc, { recursive: true });
    fs.writeFileSync(path.join(arc, 'answers.json'), JSON.stringify({ answers: archive.answers }));
  }
  return rd;
}
const blindData = html => [...html.matchAll(/<script type="application\/json" data-blind-data>([^<]*)<\/script>/g)].map(m => JSON.parse(m[1]));
const terminal = () => { const f = path.join(dir, 'tty-633.cjs'); fs.writeFileSync(f, 'Object.defineProperty(process.stdin, "isTTY", { value: true });'); return f; };

test('AC-9/12/13: a matching suite fills each pair by case id; without it the words stay', () => {
  const old = { answers: archive.answers }, suite = readSuite(SUITE);
  assert.equal(suite.suiteHash, receipt.suite.suite_hash);
  const filled = pairsOf(receipt, old, undefined, suite).pairs;
  assert.ok(new Set(filled.map(p => p.id)).size >= 2);
  for (const p of filled) assert.equal(p.prompt, promptOf(p.id), p.id);
  for (const p of pairsOf(receipt, old).pairs) assert.equal(p.prompt, 'Task prompt not kept in this archive.');
  for (const p of pairsOf(receipt, archive).pairs) assert.equal(p.prompt, promptOf(p.id));
  const altered = structuredClone(archive); altered.suite.cases[0].prompt = 'ALTERED PROMPT';
  assert.ok(!JSON.stringify(pairsOf(receipt, altered, undefined, suite).pairs).includes('ALTERED PROMPT'));
  // AC-9: pairsOf recomputes the hash; a hash handed to it is never trusted.
  const forged = { suiteHash: receipt.suite.suite_hash, cases: [{ id: filled[0].id, prompt: 'FORGED', rubric: 'Any rubric.', pass_threshold: 0.7 }] };
  assert.ok(!JSON.stringify(pairsOf(receipt, old, undefined, forged).pairs).includes('FORGED'));
  const mixed = { ...suite, cases: suite.cases.map((c, i) => (i ? c : { ...c, prompt: 'FORGED' })) };
  assert.ok(!JSON.stringify(pairsOf(receipt, old, undefined, mixed).pairs).includes('FORGED'));
});

test('AC-9/11: a suite changed by one character, or not a regular file, supplies no text', () => {
  const edited = suiteCopy(s => { s.cases[0].prompt += '.'; });
  const suite = readSuite(edited);
  assert.notEqual(suite.suiteHash, receipt.suite.suite_hash);
  const pairs = pairsOf(receipt, { answers: archive.answers }, undefined, suite).pairs;
  assert.ok(pairs.length); for (const p of pairs) assert.equal(p.prompt, 'Task prompt not kept in this archive.');
  const link = path.join(dir, 'suite-link.json'); fs.symlinkSync(SUITE, link);
  assert.throws(() => readSuite(link)); assert.throws(() => readSuite(path.join(dir, 'no-suite.json')));
});

test('AC-10: blind refuses a suite that does not match, writing nothing; a matching one prints the prompt', async () => {
  const rd = keptFolder('blind-suite', { 'r.json': receipt }), r = path.join(rd, 'r.json'), tty = terminal();
  const notJson = path.join(dir, 'not-json.json'); fs.writeFileSync(notJson, '{ not json');
  const edited = suiteCopy(s => { s.cases[0].prompt += '.'; });
  const run = args => spawnSync(process.execPath, ['--require', tty, BIN, 'blind', r, '--pairs', '1', ...args], { cwd: dir, input: 'A\n', encoding: 'utf8', timeout: 1800000 });
  const before = fs.readdirSync(rd);
  const refused = run(['--suite', edited]);
  assert.equal(refused.status, 2); assert.equal(refused.stdout, '');
  assert.ok(refused.stderr.includes(path.basename(edited)), refused.stderr);
  assert.ok(refused.stderr.includes(receipt.suite.suite_hash.slice(0, 12)), refused.stderr);
  assert.ok(refused.stderr.includes(readSuite(edited).suiteHash.slice(0, 12)), refused.stderr);
  for (const args of [['--suite', notJson], ['--suite', path.join(dir, 'absent.json')], ['--suite']]) assert.equal(run(args).status, 2, args.join(' '));
  assert.deepEqual(fs.readdirSync(rd), before);
  const printed = [];
  const record = await runBlind(r, { pairs: '1', suite: SUITE }, { isTTY: true, coin: () => 0, ask: async () => 'A', print: s => printed.push(s) });
  assert.ok(printed.includes(promptOf(record.pairs[0].id)));
  assert.ok(!printed.includes('Task prompt not kept in this archive.'));
});

const NOTE = 'data-field="blind-suite-note"';
const sheetsOf = html => Object.fromEntries(html.split('<article class="sheet" data-file="').slice(1).map(s => [s.slice(0, s.indexOf('"')), s.slice(0, s.indexOf('</article>'))]));
const staleRow = sheet => { const m = /data-field="stale" data-status="([^"]*)">([^<]*)</.exec(sheet); return m && { status: m[1], text: m[2] }; };

test('AC-11: view fills only the receipts a suite matches, with one note on the others, and no new exit', () => {
  const other = structuredClone(receipt); other.suite.suite_hash = sha256('another suite');
  const second = sealReceipt(other);
  const rd = keptFolder('view-suite', { 'one.json': receipt, 'two.json': second });
  const out = path.join(dir, 'view-suite', 'page.html');
  const view = args => spawnSync(process.execPath, [BIN, 'view', rd, '--out', out, '--no-harness-check', ...args], { cwd: dir, encoding: 'utf8', timeout: 1800000 });
  const ok = view(['--suite', SUITE]); assert.equal(ok.status, 0, ok.stderr);
  const sheets = sheetsOf(fs.readFileSync(out, 'utf8'));
  for (const p of blindData(sheets['one.json'])[0].pairs) assert.equal(p.prompt, promptOf(p.id));
  for (const p of blindData(sheets['two.json'])[0].pairs) assert.equal(p.prompt, 'Task prompt not kept in this archive.');
  assert.ok(!sheets['one.json'].includes(NOTE)); assert.equal(sheets['two.json'].split(NOTE).length - 1, 1);
  const edited = suiteCopy(s => { s.cases[0].prompt += '.'; });
  const still = view(['--suite', edited]); assert.equal(still.status, 0, still.stderr);
  for (const [name, sheet] of Object.entries(sheetsOf(fs.readFileSync(out, 'utf8')))) {
    for (const p of blindData(sheet)[0].pairs) assert.equal(p.prompt, 'Task prompt not kept in this archive.', name);
    assert.equal(sheet.split(NOTE).length - 1, 1, name);
  }
  for (const d of blindData(renderView(rd).html)) for (const p of d.pairs) assert.equal(p.prompt, 'Task prompt not kept in this archive.');
  assert.ok(!renderView(rd).html.includes(NOTE));
  assert.equal(fs.readFileSync(path.join(rd, 'one.json'), 'utf8'), JSON.stringify(receipt));
});

test('AC-11: an edited suite over a context-file run keeps its stale reading and fills no prompt', () => {
  const root = path.join(dir, 'context'), rd = path.join(root, 'receipts'); fs.mkdirSync(root, { recursive: true });
  const claude = path.join(root, 'CLAUDE.md'); fs.writeFileSync(claude, '# Rules\n\nWrite commit messages in the Conventional Commits form.\n');
  const cases = JSON.parse(fs.readFileSync(SUITE, 'utf8')).cases.slice(0, 2);
  const tasks = path.join(root, 'tasks.json'); fs.writeFileSync(tasks, JSON.stringify({ cases }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|^DRIFTPROOF_/.test(k)));
  const run = spawnSync(process.execPath, [BIN, 'run', claude, '--suite', tasks, '--keep-transcripts', '--out', rd], { cwd: root, env: { ...env, DRIFTPROOF_STUB: '1' }, encoding: 'utf8', timeout: 1800000 });
  assert.equal(run.status, 0, run.stderr);
  const file = listReceipts(rd)[0].file, r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kept = path.join(root, 'transcripts', r.receipt_hash, 'answers.json');
  fs.writeFileSync(kept, JSON.stringify({ answers: JSON.parse(fs.readFileSync(kept, 'utf8')).answers }));
  const edited = path.join(root, 'tasks-edited.json'); fs.writeFileSync(edited, JSON.stringify({ cases: cases.map((c, i) => (i ? c : { ...c, prompt: c.prompt + ' Edited.' })) }));
  const out = path.join(root, 'page.html');
  for (const [suite, filled] of [[edited, false], [tasks, true]]) {
    const v = spawnSync(process.execPath, [BIN, 'view', rd, '--skill', claude, '--suite', suite, '--no-harness-check', '--out', out], { cwd: root, encoding: 'utf8', timeout: 1800000 });
    assert.equal(v.status, 0, v.stderr);
    const sheet = Object.values(sheetsOf(fs.readFileSync(out, 'utf8')))[0];
    const today = staleLine(staleReport([file], { skill: claude, suite, model: null, judge: null, harnessVersion: null, noHarnessCheck: true, strict: false, rc: {}, fromReceipt: true }).receipts[0]);
    const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    assert.deepEqual(staleRow(sheet), { status: escHtml(today.status), text: escHtml(today.text) });
    if (!filled) assert.notEqual(today.status, 'current');
    for (const p of blindData(sheet)[0].pairs) assert.equal(p.prompt, filled ? cases.find(c => c.id === p.id).prompt : 'Task prompt not kept in this archive.');
  }
});

test('AC-11a: view reads a suite readSuite refuses as before, fills no prompt, and keeps its old refusals', () => {
  const rd = keptFolder('view-fallback', { 'one.json': receipt }), file = path.join(rd, 'one.json');
  const out = path.join(dir, 'view-fallback', 'page.html');
  const view = suite => spawnSync(process.execPath, [BIN, 'view', rd, '--out', out, '--no-harness-check', '--suite', suite], { cwd: dir, encoding: 'utf8', timeout: 1800000 });
  const link = path.join(dir, 'suite-link-633.json'); fs.symlinkSync(SUITE, link);
  const raw = fs.readFileSync(SUITE, 'utf8');
  const big = path.join(dir, 'suite-big-633.json');
  fs.writeFileSync(big, raw.slice(0, raw.lastIndexOf('}')) + ',"pad":"' + 'x'.repeat(require('../lib/skill').SUITE_MAX_BYTES) + '"}');
  const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  for (const [suite, why] of [[link, /link/], [big, /limit/]]) {
    const v = view(suite); assert.equal(v.status, 0, v.stderr);
    const sheet = sheetsOf(fs.readFileSync(out, 'utf8'))['one.json'];
    const before = staleLine(staleReport([file], { skill: null, suite, model: null, judge: null, harnessVersion: null, noHarnessCheck: true, strict: false, rc: {}, fromReceipt: true }).receipts[0]);
    assert.deepEqual(staleRow(sheet), { status: escHtml(before.status), text: escHtml(before.text) });
    for (const p of blindData(sheet)[0].pairs) assert.equal(p.prompt, 'Task prompt not kept in this archive.');
    assert.equal(sheet.split(NOTE).length - 1, 1);
    assert.match(sheet.slice(sheet.indexOf(NOTE)).split('</p>')[0], why);
  }
  fs.writeFileSync(path.join(dir, 'not-json-633.json'), '{ not json');
  for (const given of ['not-json-633.json', 'absent-633.json']) {
    const v = view(given); assert.equal(v.status, 2); assert.ok(v.stderr.includes('--suite ' + given + ': '), v.stderr);
  }
});

const MAPPING = [/The file used|with_skill|placebo|baseline/, /with(out)? the (skill|file)/i];
const ARM_MARKUP = /data-arm|shown_first|with_skill|baseline|placebo|against/;
test('AC-14/15/16/17/18: a real browser reads one bounded pair at a time and reveals only on Reveal', async () => {
  const { chromium } = require('playwright');
  const r = structuredClone(receipt), a = { answers: { ...archive.answers } };
  const long = Array.from({ length: 400 }, (_, i) => 'Line ' + i + ' of a long planning answer.').join('\n'), wide = 'x'.repeat(6000);
  const first = r.results.cases.find(c => c.mode === 'with_skill'), counter = r.results.cases.find(c => c.mode === 'placebo' && c.id === first.id);
  a.answers[sha256(long)] = long; a.answers[sha256(wide)] = wide;
  first.generation.draws[0].generation_hash = sha256(long); counter.generation.draws[0].generation_hash = sha256(wide);
  const sealed = sealReceipt(r);
  const root = path.join(dir, 'bounded'), rd = path.join(root, 'receipts'), arc = path.join(root, 'transcripts', sealed.receipt_hash);
  fs.mkdirSync(rd, { recursive: true }); fs.mkdirSync(arc, { recursive: true });
  fs.writeFileSync(path.join(rd, 'r.json'), JSON.stringify(sealed)); fs.writeFileSync(path.join(arc, 'answers.json'), JSON.stringify(a));
  const html = renderView(rd, { suite: readSuite(SUITE) }).html;
  assert.ok(html.includes('<noscript>Use driftproof blind in a terminal to read these pairs.</noscript>'));
  assert.ok(!/<script[^>]*\ssrc=/i.test(html));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const [width, height] of [[1280, 800], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height } }); const requests = [], errors = [];
      page.on('request', q => requests.push(q.url())); page.on('pageerror', e => errors.push(e.message));
      await page.setContent(html);
      const block = page.locator('[data-field="blind-read"]');
      assert.equal(await block.locator('fieldset:visible').count(), 1);
      assert.match(await block.innerText(), /Pair 1 of 10/);
      assert.ok((await block.locator('fieldset:visible').innerText()).includes(promptOf(first.id)));
      assert.equal(await block.getByRole('button', { name: 'Previous', exact: true }).isDisabled(), true);
      const panes = block.locator('fieldset:visible [data-blind-pane]'); assert.equal(await panes.count(), 2);
      const [p, q] = [await panes.nth(0).boundingBox(), await panes.nth(1).boundingBox()];
      if (width === 1280) { assert.ok(Math.abs(p.y - q.y) < 2, 'side by side'); assert.ok(q.x > p.x + p.width - 2); }
      else assert.ok(q.y >= p.y + p.height - 2, 'stacked');
      for (const i of [0, 1]) {
        const m = await panes.nth(i).evaluate(n => ({ s: n.scrollHeight, c: n.clientHeight, o: getComputedStyle(n).overflowY }));
        assert.ok(m.s > m.c, 'the long answer scrolls inside its pane'); assert.equal(m.o, 'auto');
      }
      const tall = (await block.boundingBox()).height;
      assert.ok(tall <= 1.1 * height, 'one pair is about one screen: ' + tall + 'px at ' + width + 'x' + height);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal page scroll');
      const paneTexts = () => block.locator('fieldset:visible [data-blind-pane]').evaluateAll(ns => ns.map(n => n.textContent));
      const pairs = block.locator('[data-blind-pairs]');
      const hidden = async () => {
        const text = await pairs.innerText();
        for (const re of MAPPING) assert.ok(!re.test(text), 'no mapping in the visible text before Reveal: ' + re);
        const attrs = await pairs.evaluate(n => [n, ...n.querySelectorAll('*')].flatMap(e => [...e.attributes].map(a => a.name + '=' + a.value)).join(' '));
        assert.ok(!ARM_MARKUP.test(attrs), 'no arm token in any attribute before Reveal: ' + attrs.match(ARM_MARKUP));
      };
      const picks = []; let firstOrder;
      for (let i = 0; i < 10; i++) {
        assert.match(await pairs.innerText(), new RegExp('Pair ' + (i + 1) + ' of 10'));
        await hidden();
        const letter = i % 3 ? 'A' : 'B'; picks.push(letter);
        await block.locator('fieldset:visible').getByLabel('Answer ' + letter, { exact: true }).check();
        if (i === 0) {
          firstOrder = await paneTexts();
          await block.getByRole('button', { name: 'Next', exact: true }).click();
          await block.getByRole('button', { name: 'Previous', exact: true }).click();
          assert.equal(await block.locator('fieldset:visible').getByLabel('Answer B', { exact: true }).isChecked(), true, 'a pick stays');
          assert.deepEqual(await paneTexts(), firstOrder, 'a pair keeps its order');
        }
        if (i < 9) await block.getByRole('button', { name: 'Next', exact: true }).click();
      }
      assert.equal(await block.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
      assert.equal(await block.locator('[data-blind-result]').isVisible(), false, 'the last pick does not reveal');
      assert.match(await block.innerText(), /All 10 pairs picked/);
      await hidden();
      await block.getByRole('button', { name: 'Reveal', exact: true }).click();
      const record = JSON.parse(await block.locator('textarea').inputValue());
      assert.deepEqual(record.pairs.map(x => x.pick), picks);
      assert.equal(firstOrder[0] === long, record.pairs[0].shown_first === 'with_skill', 'pane A matches shown_first');
      assert.ok(firstOrder.includes(long) && firstOrder.includes(wide));
      assert.deepEqual(await block.locator('[data-blind-result] > p').allInnerTexts().then(t => t.slice(0, 5)), resultLines(record, sealed));
      assert.deepEqual(requests, []); assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('AC-15: a smoke sheet keeps its labelled first look closed until Reveal', async () => {
  const { chromium } = require('playwright');
  const root = path.join(dir, 'smoke'), rd = path.join(root, 'receipts'); fs.mkdirSync(root, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|^DRIFTPROOF_/.test(k)));
  const run = spawnSync(process.execPath, [BIN, 'run', path.join(ROOT, 'examples/commit-message-conventions'), '--quick', '--out', rd], { cwd: root, env: { ...env, DRIFTPROOF_STUB: '1' }, encoding: 'utf8', timeout: 1800000 });
  assert.equal(run.status, 0, run.stderr);
  const html = renderView(rd).html;
  assert.match(html, /data-state="SMOKE"/); assert.ok(html.includes('data-field="blind-read"')); assert.ok(html.includes('data-field="first-look"'));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); const requests = [];
    page.on('request', q => requests.push(q.url()));
    await page.setContent(html);
    const sheet = page.locator('article.sheet[data-state="SMOKE"]');
    const before = await sheet.innerText();
    assert.ok(!before.includes('With the skill') && !before.includes('Without the skill'), 'no labelled answers before Reveal');
    await sheet.getByRole('button', { name: 'Reveal', exact: true }).click();
    const after = await sheet.innerText();
    assert.ok(after.includes('With the skill') && after.includes('Without the skill'), 'Reveal opens the first look');
    assert.deepEqual(requests, []);
    await page.close();
    const still = await browser.newPage({ javaScriptEnabled: false });
    await still.setContent(html);
    const plain = still.locator('article.sheet[data-state="SMOKE"]');
    assert.ok(!(await plain.innerText()).includes('With the skill'));
    await plain.locator('[data-blind-look] > summary').click();
    assert.ok((await plain.innerText()).includes('With the skill'), 'without script the reader can open it');
    await still.close();
  } finally { await browser.close(); }
});
