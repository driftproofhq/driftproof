// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 638: a public blind read on Report 017's kept answers. Every oracle here reads the receipt,
// the answers file and the suites itself, or asks lib/view.js renderView, never the generator.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { sha256 } = require('../lib/canonical');
const { suiteIdentity } = require('../lib/skill');
const { verifyReceiptHash } = require('../lib/receipt');
const { placeboReading, placeboLine, PLACEBO_WORDS } = require('../lib/verdict');
const { pairsOf, readSuite, readingLine, dropLine, HONESTY, mountBlind } = require('../lib/blind');
const { renderView } = require('../lib/view');
const { htmlToText, tokenize, attrOf } = require('../scripts/html-text.js');
const { splitReportBody } = require('../scripts/site-chrome.js');
const { MOUNT } = require('../scripts/glossary-terms.js');
const { humanModelName } = require('../scripts/model-names.js');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const PAGE = 'reports/017/blind/index.html';
const ISLAND = 'islands/blind-read.js';
const URL_PATH = '/reports/017/blind/';
const SUITES = path.join(ROOT, 'specs/408-skill-measurements/suites');
const PANEL = path.join(ROOT, 'receipts/report-017-panel');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'blind-638-'));
const read = (rel) => fs.readFileSync(path.join(DOCS, rel), 'utf8');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const code = (c) => (e) => e.code === c;
const ENT = { '&#39;': '\'', '&#x27;': '\'', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const decode = (s) => s.replace(/&#39;|&#x27;|&quot;|&lt;|&gt;|&amp;/g, (m) => ENT[m]);
const textOf = (html) => htmlToText(html, { skip: ['script', 'style', 'noscript'], decode, collapse: true });
// The mapping words spec 619 AC-15 reads for, and the arm tokens no attribute may carry.
const MAPPING = [/The file used|with_skill|placebo|baseline/, /with(out)? the (skill|file)/i];
const ARM_MARKUP = /data-arm|shown_first|with_skill|baseline|placebo|against/;
// The reading's plain words (spec 638 AC-14), written out: one per placebo reading token they are true of.
const PLAIN = {
  UNDERPOWERED: 'In plain words, this run cannot tell the skill and the placebo apart.',
  BELOW_PLACEBO: 'In plain words, on at least one task the skill\'s answers scored clearly below the placebo\'s: beyond the spread between tries and by at least the report\'s margin.',
};

function builder() {
  const file = path.join(ROOT, 'scripts/build-report-017-blind.js');
  assert.ok(fs.existsSync(file), 'scripts/build-report-017-blind.js is not built yet');
  return require(file);
}
// The page's data: the mount's one base64 attribute, decoded here (spec 638 decision 3).
function dataOf(html) {
  const m = /<section\b[^>]*\sdata-island="blind-read"[^>]*\sdata-blind-source="([A-Za-z0-9+/=]+)"/.exec(html);
  assert.ok(m, 'the page carries one blind-read mount with its data');
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}
// The suite whose recomputed hash is the receipt's, found here by scanning every file.
function suiteFileFor(receipt, dir = SUITES) {
  const hits = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).filter((n) => {
    try { return suiteIdentity(json(path.join(dir, n))).suiteHash === receipt.suite.suite_hash; } catch { return false; }
  });
  assert.equal(hits.length, 1, 'exactly one committed suite carries the receipt\'s suite hash');
  return path.join(dir, hits[0]);
}
// Every verified pair, read here from the receipt's rows and the answers the receipt seals: a
// measured with-skill draw and the measured placebo draw with its draw number, both answers kept.
function sealedPairs(receipt, archive) {
  const rows = receipt.results.cases, out = [];
  for (const w of rows.filter((c) => c.mode === 'with_skill')) {
    const a = rows.find((c) => c.id === w.id && c.mode === 'placebo');
    for (const d of w.generation.draws) {
      const e = a && a.generation.draws.find((x) => x.draw_index === d.draw_index);
      if (d.status !== 'measured' || !e || e.status !== 'measured') continue;
      const wt = archive.answers[d.generation_hash], at = archive.answers[e.generation_hash];
      if (typeof wt !== 'string' || typeof at !== 'string' || sha256(wt) !== d.generation_hash || sha256(at) !== e.generation_hash) continue;
      out.push({ id: w.id, draw_index: d.draw_index, with: wt, against: at, with_mean: d.mean, against_mean: e.mean });
    }
  }
  return out;
}
// The chance that fair coin flips over n pairs give k or more right, summed here.
function tail(n, k) {
  const choose = (m, j) => { let r = 1; for (let i = 1; i <= j; i++) r = r * (m - j + i) / i; return r; };
  let s = 0; for (let j = k; j <= n; j++) s += choose(n, j);
  return s / 2 ** n;
}

let B, built, receipt, archive, html, skill, sealed;
test.before(() => {
  B = builder();
  built = B.pageOf();
  receipt = json(built.receiptFile);
  archive = json(built.answersFile);
  html = read(PAGE);
  skill = receipt.skill.name;
  sealed = sealedPairs(receipt, archive);
});
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// The hand-off reading (A-638-1, A-638-4): spec 627 A-627-7's shared rule. After YAML front matter
// the body is one or more sentences, each an instruction to call the Skill tool naming only the
// skills to call. A text without front matter, a bulleted list or a sentence led by "Then" is not
// one: the rule reads the sentence form, not just the verb.
const { handsOffOnly } = require('../scripts/skill-handoff.js');
const HANDOFF_CASES = [
  ['---\nname: a\n---\n\nCall the Skill tool with "grilling".\n', true],
  ['---\nname: a\n---\nCall the Skill tool with "grilling". Call the Skill tool with "domain-modeling".\n', true],
  ['---\nname: a\n---\nCall the Skill tool with "grilling". Then call the Skill tool with "domain-modeling".\n', false],
  ['---\nname: a\n---\n- Call the Skill tool with "x"\n- Call the Skill tool with "y"\n', false],
  ['Call the Skill tool with "grilling".', false],
  ['---\nname: a\n---\n\nCall the Skill tool twice, for "grilling" and "domain-modeling".\n', true],
  ['---\nname: a\n---\nCall the Skill tool with "grilling", then write a summary.\n', false],
  ['---\nname: a\n---\nCall the Skill tool with "grilling".\n\nAsk one question at a time.\n', false],
  ['---\nname: a\n---\n\n', false],
  ['---\nname: a\n---\nWrite a handoff document. Name which skills the next agent should call the Skill tool for.\n', false],
];
// Every counted skill with a receipt, shortest first by the placebo block's skill_bytes, plan order on ties.
const byLength = (rows) => rows.filter((r) => !r.router && r.receipt).sort((a, b) => a.receipt.placebo.skill_bytes - b.receipt.placebo.skill_bytes || a.index - b.index);
const textOf017 = (row) => fs.readFileSync(path.join(PANEL, row.attempt_id + '.md'), 'utf8');

test('AC-1: the skill is the shortest counted skill that is not a hand-off, and the rule reads no score', () => {
  const rows = built.campaign.rows;
  for (const [text, want] of HANDOFF_CASES) { assert.equal(handsOffOnly(text), want, JSON.stringify(text)); assert.equal(B.isHandoff(text), want, 'the generator reads the shared rule'); }
  // Build-time bound (A-638-4): the rule is linear on long whitespace runs.
  const padded = '---\nname: a\n---\n' + ' '.repeat(20000) + 'Call the Skill tool with "x".' + ' '.repeat(20000) + '\n';
  const t0 = process.hrtime.bigint(); const padResult = handsOffOnly(padded); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(padResult, true); assert.ok(ms < 200, 'handsOffOnly took ' + ms.toFixed(1) + ' ms on 40,000 spaces');
  const order = byLength(rows), at = order.findIndex((r) => !B.isHandoff(textOf017(r)));
  const oracle = order[at];
  assert.ok(at > 0, 'the shortest counted skill is a hand-off and is passed over');
  assert.equal(oracle.skill, 'handoff', 'the ruling\'s expected pick');
  assert.ok(oracle.attempt_id.startsWith('335148930bb2'));
  for (const r of order.slice(0, at)) assert.ok(B.isHandoff(textOf017(r)), r.skill + ' is a hand-off');
  assert.equal(built.row.attempt_id, oracle.attempt_id);
  assert.equal(dataOf(html).skill, oracle.receipt.skill.name);
  // Plant: a shorter skill's pinned text missing refuses; the rule never passes over a text it has not read.
  const partial = path.join(scratch, 'panel'); fs.mkdirSync(partial, { recursive: true });
  fs.copyFileSync(path.join(PANEL, oracle.attempt_id + '.md'), path.join(partial, oracle.attempt_id + '.md'));
  assert.throws(() => B.skillOf(rows, partial), code('PANEL_INPUT'));
  const plant = (edit) => rows.map((r) => (r.receipt ? { ...r, receipt: edit(structuredClone(r.receipt), r) } : r));
  const pick = (rs) => B.skillOf(rs, PANEL).row.attempt_id;
  // Plants: no results at all; every with-skill and placebo mean swapped; a router made shortest.
  assert.equal(pick(plant((r) => ({ ...r, results: null }))), oracle.attempt_id, 'results removed');
  const swapped = plant((r) => {
    for (const w of r.results.cases.filter((c) => c.mode === 'with_skill')) {
      const a = r.results.cases.find((c) => c.id === w.id && c.mode === 'placebo');
      for (const d of w.generation.draws) { const e = a && a.generation.draws.find((x) => x.draw_index === d.draw_index); if (e) [d.mean, e.mean] = [e.mean, d.mean]; }
    }
    return r;
  });
  assert.equal(pick(swapped), oracle.attempt_id, 'scores swapped');
  const router = rows.find((r) => r.router && r.receipt);
  assert.ok(router, 'the campaign has a router with a receipt');
  assert.equal(pick(plant((r, row) => { if (row === router) r.placebo.skill_bytes = 1; return r; })), oracle.attempt_id, 'a router with the smallest skill_bytes');
});

test('AC-2: the sealed receipt Report 017 counts for the attempt, and its own answers', () => {
  assert.ok(verifyReceiptHash(receipt));
  const data = dataOf(html);
  assert.equal(data.receipt_hash, receipt.receipt_hash);
  const report = read('reports/017/index.html');
  const row = new RegExp('<section class="placebo-result[^"]*" data-attempt="' + built.row.attempt_id + '"[\\s\\S]*?</section>').exec(report);
  assert.ok(row, 'Report 017 has a row for the attempt');
  assert.equal(/Receipt <code>([0-9a-f]{64})<\/code>/.exec(row[0])[1], data.receipt_hash, 'the receipt Report 017 shows for the attempt');
  assert.equal(archive.receipt_hash, receipt.receipt_hash);
  // Plants.
  assert.throws(() => B.blindData({ receipt, archive: { ...archive, receipt_hash: '0'.repeat(64) }, suitesDir: SUITES }), code('ANSWERS_BINDING'));
  const rescored = structuredClone(receipt); rescored.results.cases.find((c) => c.mode === 'with_skill').generation.draws[0].mean += 0.05;
  assert.throws(() => B.blindData({ receipt: rescored, archive, suitesDir: SUITES }), (e) => e.exitCode === 4);
  const first = data.pairs[0], edited = structuredClone(archive);
  const hash = receipt.results.cases.find((c) => c.mode === 'with_skill' && c.id === first.id).generation.draws.find((d) => d.draw_index === first.draw_index).generation_hash;
  edited.answers[hash] += 'x';
  const out = B.blindData({ receipt, archive: edited, suitesDir: SUITES });
  assert.ok(!out.data.pairs.some((p) => p.id === first.id && p.draw_index === first.draw_index), 'the edited pair is never shown');
  assert.deepEqual(out.paired.dropped, [{ id: first.id, draw_index: first.draw_index, reason: 'kept answer hash mismatch' }]);
  assert.equal(out.data.pairs.length, sealed.length - 1);
});

test('AC-3: every verified pair, as pairsOf gives them; the rest of the data is view\'s', () => {
  const data = dataOf(html);
  const all = pairsOf(receipt, archive, undefined, readSuite(suiteFileFor(receipt)));
  assert.deepEqual(data.pairs, all.pairs, 'every pair, in the library\'s order, no cap');
  assert.deepEqual(data.pairs.map((p) => [p.id, p.draw_index]), sealed.map((p) => [p.id, p.draw_index]), 'the pairs the receipt seals');
  assert.ok(data.pairs.length > 10, 'more pairs than view\'s cap, all shown');
  const root = path.join(scratch, 'view'), rd = path.join(root, 'receipts'), arc = path.join(root, 'transcripts', receipt.receipt_hash);
  fs.mkdirSync(rd, { recursive: true }); fs.mkdirSync(arc, { recursive: true });
  fs.copyFileSync(built.receiptFile, path.join(rd, 'grill-me.json'));
  fs.copyFileSync(built.answersFile, path.join(arc, 'answers.json'));
  const view = renderView(rd, { suite: readSuite(suiteFileFor(receipt)) }).html;
  const blocks = [...view.matchAll(/<script type="application\/json" data-blind-data>([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  const want = JSON.parse(blocks[0][1]);
  assert.deepEqual({ ...data, pairs: data.pairs.slice(0, 10) }, want, 'view\'s data, its pairs the page\'s first ten');
  assert.ok(textOf(html).includes(data.pairs.length + ' of ' + all.pairs.length + ' verified pairs. ' + dropLine(all.dropped)), 'the counts and the drop line');
});

test('AC-4: every answer and score traces to the receipt\'s draws, against the placebo', () => {
  const data = dataOf(html);
  assert.equal(data.against, 'placebo');
  const draw = (id, mode, i) => receipt.results.cases.find((c) => c.id === id && c.mode === mode).generation.draws.find((d) => d.draw_index === i);
  assert.ok(data.pairs.length > 0);
  for (const p of data.pairs) {
    const w = draw(p.id, 'with_skill', p.draw_index), a = draw(p.id, 'placebo', p.draw_index);
    assert.equal(w.status, 'measured'); assert.equal(a.status, 'measured');
    assert.equal(sha256(p.with_answer), w.generation_hash, p.id + ' ' + p.draw_index + ' with');
    assert.equal(sha256(p.against_answer), a.generation_hash, p.id + ' ' + p.draw_index + ' placebo');
    assert.equal(p.with_mean, w.mean); assert.equal(p.against_mean, a.mean);
  }
});

test('AC-5: prompts come from the suite whose hash the receipt sealed, never its file name', () => {
  const real = suiteFileFor(receipt), prompts = new Map(json(real).cases.map((c) => [c.id, c.prompt]));
  for (const p of dataOf(html).pairs) assert.equal(p.prompt, prompts.get(p.id), p.id);
  const dir = (name, files) => { const d = path.join(scratch, name); fs.mkdirSync(d, { recursive: true }); for (const [n, text] of files) fs.writeFileSync(path.join(d, n), text); return d; };
  const realText = fs.readFileSync(real, 'utf8'), other = fs.readdirSync(SUITES).find((n) => n.endsWith('.json') && path.join(SUITES, n) !== real);
  const promptsOf = (d) => B.blindData({ receipt, archive, suitesDir: d }).data.pairs.map((p) => p.prompt);
  const want = dataOf(html).pairs.map((p) => p.prompt);
  assert.deepEqual(promptsOf(dir('renamed', [['zz.json', realText]])), want, 'a renamed suite is found by its hash');
  const swapped = dir('swapped', [[path.basename(real), fs.readFileSync(path.join(SUITES, other), 'utf8')], [other, realText]]);
  assert.deepEqual(promptsOf(swapped), want, 'the file under the skill\'s name is not read for its name');
  const edited = JSON.parse(realText); edited.cases[0].prompt = edited.cases[0].prompt.replace(/.$/, (c) => (c === '.' ? '!' : '.'));
  assert.throws(() => promptsOf(dir('edited', [[path.basename(real), JSON.stringify(edited)]])), code('SUITE_BINDING'), 'a prompt changed by one character');
});

// Issue 661: llms.txt reads this page's h1 by the tokenizer (CodeQL js/incomplete-multi-character-
// sanitization on the tag pattern it used): inline markup, a ">" inside a quoted attribute and a
// script in any letter case leave the heading's words, each entity decoded once; the real line is
// the one docs/llms.txt carries.
test('issue 661: the llms.txt line reads the h1 as text, by the tokenizer', () => {
  const { blindLines } = require('../scripts/build-llms.js');
  const root = fs.mkdtempSync(path.join(scratch, 'llms-'));
  const dir = path.join(root, 'docs/reports/017/blind');
  fs.mkdirSync(dir, { recursive: true });
  const page = (h1) => fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><meta name="description" content="A blind read &amp; a check."></head><body>${h1}</body></html>`);
  const want = '- [Can you tell & see?](https://driftproofhq.com/reports/017/blind/): A blind read & a check.';
  page('<h1 class="x">Can <em>you</em> tell &amp; see?</h1>');
  assert.deepEqual(blindLines(root), [want]);
  page('<h1><span title="a>b">Can you tell</span> &amp; see<SCRIPT>x()</SCRIPT >?</h1>');
  assert.deepEqual(blindLines(root), [want], 'a ">" inside a quoted attribute and a script in any letter case');
  assert.deepEqual(blindLines(fs.mkdtempSync(path.join(scratch, 'none-'))), [], 'no page, no line');
  const real = blindLines(ROOT);
  assert.equal(real.length, 1);
  assert.ok(read('llms.txt').split('\n').includes(real[0]), 'docs/llms.txt carries the line as built');
});

test('AC-7, AC-8, AC-10: the honesty line, the scripts, the island and the static fallback', () => {
  const data = dataOf(html);
  assert.equal(data.honesty, HONESTY);
  assert.equal(data.reading, readingLine(receipt));
  assert.ok(textOf(html).includes(HONESTY), 'the honesty line is on the page before any pick');
  const ALLOWED = ['/islands/loader.js', '/copy-button.js', 'https://static.cloudflareinsights.com/beacon.min.js'];
  // Issue 661: every script start tag, read by the tokenizer so `<SCRIPT>` and a ">" inside a quoted
  // attribute read as a browser reads them (CodeQL js/bad-tag-filter): the ones that are neither an
  // allowed source nor JSON-LD, as written.
  const scriptProblems = (h) => tokenize(h).filter((t) => t.type === 'start' && t.name === 'script' && attrOf(t, 'type') !== 'application/ld+json').filter((t) => {
    const src = attrOf(t, 'src');
    return !(src && ALLOWED.includes(src));
  }).map((t) => t.raw);
  assert.deepEqual(scriptProblems(html), [], 'every script is an allowed source');
  assert.ok(html.includes('</body>'));
  assert.deepEqual(scriptProblems(html.replace('</body>', '<SCRIPT SRC="/x.js"></SCRIPT></body>')), ['<SCRIPT SRC="/x.js">'], 'plant: an upper-case script tag is read');
  assert.deepEqual(scriptProblems(html.replace('</body>', '<script data-x="a>b" src="/y.js"></script></body>')), ['<script data-x="a>b" src="/y.js">'], 'plant: a ">" inside a quoted attribute stays inside the tag');
  // A-638-6 (issue 766): every island mount, read by the tokenizer. The page holds its own and the one the
  // site step writes on every reader page (spec 689), whose name is read from that step's mount.
  const islandsOf = (h) => tokenize(h).filter((t) => t.type === 'start' && attrOf(t, 'data-island') !== null).map((t) => attrOf(t, 'data-island')).sort();
  const islands = ['blind-read', ...islandsOf(MOUNT)].sort();
  assert.notDeepEqual(islandsOf(html.replace('</body>', '<div data-island="planted"></div></body>')), islands, 'plant: a third island');
  assert.notDeepEqual(islandsOf(html.replace('</body>', '<div data-island="blind-read"></div></body>')), islands, 'plant: a second blind-read mount');
  assert.notDeepEqual(islandsOf(html.replace(MOUNT, '')), islands, 'plant: the site step\'s mount removed');
  assert.deepEqual(islandsOf(html), islands, 'its own island and the site step\'s, and no other');
  assert.doesNotMatch(html, /<form\b/i);
  const equiv = (h) => [...h.matchAll(/<meta\s+http-equiv="([^"]+)"/gi)].map((m) => m[1].toLowerCase()).sort();
  assert.deepEqual(equiv(html), equiv(read('placebo/index.html')), 'the policy is the other site pages\'');
  const island = read(ISLAND);
  assert.ok(island.includes(mountBlind.toString()), 'the island holds mountBlind verbatim');
  const body = island.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(body, /\b(?:require|process|Buffer|fetch|XMLHttpRequest|WebSocket|EventSource|Worker|sendBeacon|localStorage|sessionStorage|indexedDB)\b|eval\s*\(|import\s*\(|^\s*import\s|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.cookie\s*=/m);
  assert.match(body, /new TextDecoder\(\)/, 'the data is decoded as UTF-8');
  assert.match(body, /removeAttribute\('data-blind-source'\)/, 'the data attribute is removed once decoded');
  const mount = /<section\b[^>]*data-island="blind-read"[\s\S]*?<\/section>/.exec(html)[0];
  assert.equal(decode(/<noscript><p>([\s\S]*?)<\/p><\/noscript>/.exec(mount)[1]), B.NOSCRIPT);
});

test('AC-14, AC-15: the page\'s own words, in order before the block, and the exact spread line', () => {
  const N = dataOf(html).pairs.length;
  let K = 0; while (tail(N, K) > 0.05) K++;
  const P = (100 * tail(N, K)).toFixed(1);
  assert.deepEqual([N, K, P], [12, 10, '1.9'], 'for N = 12, K is 10 and P is 1.9');
  const NOSCRIPT = 'The blind read needs JavaScript. Without it no pair is shown; the receipt, its kept answers and the suite are linked below.';
  assert.equal(B.NOSCRIPT, NOSCRIPT);
  const all = pairsOf(receipt, archive, undefined, readSuite(suiteFileFor(receipt)));
  // The shorter skills the rule passed over, named in plan order of length, read here from the texts.
  const order = byLength(built.campaign.rows), shorter = order.slice(0, order.findIndex((r) => r.attempt_id === built.row.attempt_id)).map((r) => r.skill);
  assert.deepEqual(shorter, ['grill-me', 'grill-with-docs']);
  const passed = shorter.slice(0, -1).join(', ') + ' and ' + shorter.at(-1) + ' are shorter, but each one\'s whole text only tells';
  // The scope line (A-638-2), from the receipt's fields and the pairs, read here; then as written.
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(receipt.run.date_utc));
  const scope = 'These are ' + N + ' tries of ' + new Set(dataOf(html).pairs.map((p) => p.id)).size + ' text-only tasks, answered by ' + humanModelName(receipt.run.model_id)
    + ' and scored by ' + humanModelName(receipt.run.judge.model_id) + ' on ' + day + '. The tasks forbid saving files, which ' + skill + ' asks for. This reads this run, not ' + skill + ' in general.';
  assert.equal(scope, 'These are 12 tries of 3 text-only tasks, answered by Claude Sonnet 5.5 and scored by Claude Haiku 5.5 on 1 November 2026. The tasks forbid saving files, which handoff asks for. This reads this run, not handoff in general.');
  const description = 'Two AI answers to the same task: one written with the ' + skill + ' skill, one with unrelated text of the same length in its place. Guess which is which.';
  const lines = [
    description,
    'Report 017 gave an AI model the same tasks with a skill, and again with a placebo in the skill\'s place. The placebo is unrelated text cut to the same length as the skill\'s instruction text. Same length means the instructions given to the model, not its answers.',
    'Each pair below is one task from that run. One answer came from the model given the ' + skill + ' skill. The other came from the same model given the placebo instead, on the same try of that task, matched by draw number. They are shown in random order as Answer A and Answer B. Pick the one you think had the skill, then press Reveal.',
    'This is a game of noticing. It is not a test of you, and not a measurement of the skill.',
    HONESTY,
    'Every answer written with the skill has a "Suggested skills" section, which the skill\'s text asks for. Most open by saying they did not save the file the skill asks for, and most run longer than the placebo answer beside them. A right pick can come from those cues, not from the skill helping.',
    'This page uses ' + skill + ': the shortest skill counted in Report 017\'s headline whose text does more than hand off to another skill, chosen by its text and length alone, not by any result. ' + passed + ' the model to call other skills.',
    'Report 017 reads ' + skill + ' against its placebo as "' + readingLine(receipt) + '". ' + PLAIN[placeboReading(receipt).reading],
    scope,
    N + ' of ' + all.pairs.length + ' verified pairs. ' + dropLine(all.dropped),
    'Picking at random, a reader gets ' + K + ' or more of these ' + N + ' right about ' + P + '% of the time.',
    'The page source holds which answer is which. Read the pairs before you read the source.',
  ];
  const main = /<main\b[\s\S]*<\/main>/.exec(html)[0];
  const at = main.indexOf('data-island="blind-read"');
  const paras = [...main.slice(0, at).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => textOf(m[1]).trim());
  assert.deepEqual(paras.filter((p) => lines.includes(p)), lines, 'each pinned paragraph, whole and in order, before the block');
  assert.equal(textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1]), 'Can you tell which answer had the skill?');
  // The description is derived from the page's own first paragraph (spec 020 AC-14, A-638-3): the
  // page declares none, and the first paragraph in main is the description, whole.
  assert.doesNotMatch(/<main\b[^>]*>/.exec(html)[0], /data-description/);
  assert.equal(paras[0], description, 'the first paragraph is the description');
  assert.equal(require('../scripts/build-head-tags.js').pageDescription(html), description, 'the head builder derives it');
  assert.equal(decode(/<meta name="description" content="([^"]*)">/.exec(html)[1]), description);
  assert.equal(decode(/<meta property="og:description" content="([^"]*)">/.exec(html)[1]), description);
  assert.doesNotMatch(textOf(html), /test yourself/i);
  // The cue sentence is held to the data, read here: every skill answer has the section the skill's
  // text asks for, no placebo answer has it, and most skill answers run longer.
  const data = dataOf(html), section = /suggested skills/i;
  assert.match(textOf017(built.row), /suggested skills/i, 'the skill\'s text asks for the section');
  assert.ok(data.pairs.every((p) => section.test(p.with_answer)), 'every skill answer has the section');
  assert.ok(!data.pairs.some((p) => section.test(p.against_answer)), 'no placebo answer has it');
  assert.ok(data.pairs.filter((p) => p.with_answer.length > p.against_answer.length).length > N / 2, 'most skill answers run longer');
  assert.equal(B.cuesHold(data.pairs), true, 'control');
  assert.equal(B.cuesHold([{ ...data.pairs[0], with_answer: data.pairs[0].with_answer.replace(/suggested skills/gi, 'next steps') }, ...data.pairs.slice(1)]), false, 'plant: one skill answer without the section');
  assert.equal(B.cuesHold(data.pairs.map((p) => ({ ...p, against_answer: p.against_answer + 'x'.repeat(p.with_answer.length) }))), false, 'plant: no length cue');
  // The opening cue, read here: most skill answers' first line says the file was not saved, and more
  // of them than of the placebo answers.
  const notSaved = /\b(?:didn['’]t|did not|haven['’]t|have not|can['’]t|cannot|won['’]t|will not)\s+(?:write|written|save|saved)\b/i;
  const first = (t) => t.split('\n').find((l) => l.trim()) || '';
  const opensW = data.pairs.filter((p) => notSaved.test(first(p.with_answer))).length, opensP = data.pairs.filter((p) => notSaved.test(first(p.against_answer))).length;
  assert.ok(opensW > N / 2 && opensW > opensP, 'most skill answers open by saying the file was not saved: ' + opensW + ' against ' + opensP);
  assert.match(textOf017(built.row), /\bsave\b/i, 'the skill\'s text asks to save the file');
  assert.equal(B.cuesHold(data.pairs.map((p) => ({ ...p, with_answer: '# Handoff\n' + p.with_answer }))), false, 'plant: no skill answer opens with it');
  assert.equal(B.cuesHold(data.pairs.map((p) => ({ ...p, against_answer: first(p.with_answer) + '\n' + p.against_answer.replace(/suggested skills/gi, '') }))), false, 'plant: the placebo answers open with it as often');
  // The scope line's saving clause is grounded: a suite prompt without the prohibition, or a skill
  // text that asks for no saving, refuses the build.
  const suite = readSuite(suiteFileFor(receipt));
  assert.equal(B.scopeLine({ receipt, data, suite, skillText: textOf017(built.row) }), scope, 'control');
  const loose = { ...suite, cases: suite.cases.map((c, i) => (i ? c : { ...c, prompt: c.prompt.replace(/write files, /, '') })) };
  assert.throws(() => B.scopeLine({ receipt, data, suite: loose, skillText: textOf017(built.row) }), code('SCOPE_GROUNDING'), 'plant: one prompt allows writing files');
  assert.throws(() => B.scopeLine({ receipt, data, suite, skillText: '---\nname: x\n---\nWrite a summary.\n' }), code('SCOPE_GROUNDING'), 'plant: a skill that asks for no saving');
  // Build-time bound (A-638-4): the prohibition check is linear on a long prompt with no full stop,
  // whether it holds (the sentence then a long tail) or not (a long "do not" with no sentence).
  const longTail = suite.cases[0].prompt + ' ' + 'x'.repeat(60000);
  const slow = { ...suite, cases: suite.cases.map((c) => ({ ...c, prompt: longTail })) };
  const t1 = process.hrtime.bigint(); B.scopeLine({ receipt, data, suite: slow, skillText: textOf017(built.row) });
  assert.throws(() => B.scopeLine({ receipt, data, suite: { ...suite, cases: [{ ...suite.cases[0], prompt: 'Do not ' + 'a'.repeat(60000) }] }, skillText: textOf017(built.row) }), code('SCOPE_GROUNDING'));
  const ms1 = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.ok(ms1 < 200, 'the scope check took ' + ms1.toFixed(1) + ' ms on 60,000-character prompts');
  // What leaves the page (A-638-2): the picks never do, and the visit counter is named when the beacon is on the page.
  const privacy = 'Your picks never leave this page: it sends none of them, stores nothing and calls no model. The site\'s visit counter (Cloudflare Web Analytics) still counts the page view.';
  assert.match(html, /<script type='module' src='https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js'/, 'the page carries the beacon');
  assert.equal(textOf(/<p class="blind-private">([\s\S]*?)<\/p>/.exec(html)[1]), privacy);
  assert.doesNotMatch(textOf(html), /sends nothing/);
  // The page states that its source holds the mapping.
  assert.ok(paras.includes('The page source holds which answer is which. Read the pairs before you read the source.'));
  // The reading's plain words exist for the receipt's reading; a token without words refuses.
  assert.deepEqual(B.PLAIN, PLAIN);
  assert.ok(PLAIN[placeboReading(receipt).reading], 'the receipt reads ' + placeboReading(receipt).reading);
  assert.equal(B.readingWords({ reading: placeboReading(receipt).reading, line: readingLine(receipt) }, skill), lines.find((l) => l.startsWith('Report 017 reads ')), 'control');
  for (const reading of [...Object.keys(PLACEBO_WORDS), 'UNDERPOWERED', 'NOT_MEASURED'].filter((r) => !PLAIN[r])) assert.throws(() => B.readingWords({ reading, line: 'x' }, skill), code('READING_WORDS'), reading);
});

test('AC-11: --check reproduces the page and the island, and refuses one changed byte', () => {
  assert.doesNotThrow(() => B.check());
  const out = path.join(scratch, 'docs');
  B.write({ out });
  assert.doesNotThrow(() => B.check({ out }), 'control: a page just written passes');
  for (const rel of [PAGE, ISLAND]) {
    const file = path.join(out, rel), was = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, was.replace(/e/, 'E'));
    assert.throws(() => B.check({ out }), code('BLIND_PAGE_DRIFT'), rel);
    fs.writeFileSync(file, was);
  }
});

// A-638-5, issue 693: the link record is identified by what it records, not its
// ordinal position. Every assertion below reads the matching section itself.
function assertBlindLinkAmendment(amendments, selectedSkill) {
  const note = "Added a link, after the opening panel, to a blind read of " + selectedSkill + "'s kept answers. Counts, readings and receipts are unchanged.";
  const sections = [...amendments.matchAll(/<section id="amendment-(\d+)">([\s\S]*?)<\/section>/g)];
  const matches = sections.filter(([, , body]) => [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].some(m => textOf(m[1]) === note));
  assert.equal(matches.length, 1, 'one amendment records the blind-page link and preserves counts, readings and receipts');
  const [section, number, body] = matches[0];
  const heading = /<h3>([\s\S]*?)<\/h3>/.exec(body);
  assert.ok(heading, 'the matching amendment has its own heading');
  const date = /^Amendment ([1-9]\d*), (\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(textOf(heading[1]));
  assert.ok(date, 'the matching amendment is dated');
  assert.equal(date[1], number, 'the heading agrees with its section number');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const month = months.findIndex(m => date[3] === m || date[3] === m.slice(0,3));
  assert.ok(month >= 0, 'a real month');
  const day = Number(date[2]), year = Number(date[4]), parsed = new Date(Date.UTC(year, month, day));
  assert.equal(parsed.getUTCFullYear(),year);
  assert.equal(parsed.getUTCMonth(),month);
  assert.equal(parsed.getUTCDate(),day, 'a real calendar day');
  return section;
}

test('AC-12: sitemap, head, llms.txt and one link from Report 017 with a dated amendment', () => {
  assert.ok(read('sitemap-pages.xml').includes('<loc>https://driftproofhq.com' + URL_PATH + '</loc>'));
  assert.equal(require('../scripts/build-head-tags.js').render(html, PAGE), html, 'the head builder leaves the page as it is');
  const h1 = textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1]);
  const description = decode(/<meta name="description" content="([^"]*)">/.exec(html)[1]);
  const llms = read('llms.txt'), optional = llms.slice(llms.indexOf('## Optional'));
  assert.ok(optional.includes('- [' + h1 + '](https://driftproofhq.com' + URL_PATH + '): ' + description + '\n'), 'llms.txt lists the page in Optional');
  const report = read('reports/017/index.html');
  assert.equal((report.match(new RegExp('href="' + URL_PATH + '"', 'g')) || []).length, 1, 'one link');
  assert.ok(textOf(report).includes('Can you tell which answer had the skill? Try a blind read of ' + skill + '\'s kept answers.'), 'the link line names the page\'s skill');
  const { amendments } = splitReportBody(report);
  assertBlindLinkAmendment(amendments, skill);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-report-baselines.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});


test('AC-12 plants: the link amendment stays dated and specific when later amendments follow', () => {
  const { amendments } = splitReportBody(read('reports/017/index.html'));
  const record = assertBlindLinkAmendment(amendments, skill);
  assert.doesNotThrow(() => assertBlindLinkAmendment(amendments + '<section id="amendment-99"><h3>Amendment 99, 4 Nov 2026</h3><p>A later unrelated change.</p></section>', skill));
  const renumbered = record.replace(/amendment-\d+/, 'amendment-42').replace(/Amendment \d+,/, 'Amendment 42,');
  assert.doesNotThrow(() => assertBlindLinkAmendment(amendments.replace(record,renumbered),skill));
  const plants = [
    '',
    record.replace(/<h3>[\s\S]*?<\/h3>/, '<h3>Amendment 2</h3>'),
    record.replace(/, \d{1,2} [A-Za-z]+ \d{4}/, ', 31 Feb 2026'),
    record.replace(/Amendment \d+,/, 'Amendment 97,'),
    record.replace(skill, 'another-skill'),
    record.replace('Counts, readings and receipts are unchanged.', 'The results changed.'),
    record.replace('Added a link, after the opening panel,', 'Added an unrelated note,')
  ];
  for (const planted of plants) assert.throws(() => assertBlindLinkAmendment(amendments.replace(record,planted),skill));
});

test('AC-13: building moves no receipt, answers, suite or Report 017 reading', () => {
  const files = [built.receiptFile, built.answersFile, suiteFileFor(receipt)];
  const before = files.map((f) => sha256(fs.readFileSync(f)));
  B.write({ out: path.join(scratch, 'again') });
  assert.deepEqual(files.map((f) => sha256(fs.readFileSync(f))), before);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/prepare-report-017.js'), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  assert.equal(r.status, 0, r.stderr);
});

test('AC-6, AC-7, AC-8, AC-9, AC-10: Chromium reads one bounded pair at a time, counts what happened and sends nothing', { timeout: 1800000 }, async (t) => {
  const { chromium } = require('playwright');
  const shots = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'blind-638-shots-'));
  const server = http.createServer((req, res) => {
    let file = path.resolve(DOCS, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(DOCS + path.sep)) return res.writeHead(403).end();
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + URL_PATH;
  const n = sealed.length;
  const open = async (context) => {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    const block = page.locator('[data-island="blind-read"]');
    await block.locator('[data-blind-nav]').waitFor({ state: 'visible' });
    return { page, block };
  };
  const paneTexts = (block) => block.locator('fieldset:visible [data-blind-pane]').evaluateAll((ns) => ns.map((x) => x.textContent));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    // AC-6 plant: the order follows crypto.getRandomValues. Zero bytes put the skill in pane A,
    // one bytes the placebo, on every pair.
    for (const v of [0, 1]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await context.addInitScript((byte) => Object.defineProperty(Crypto.prototype, 'getRandomValues', { configurable: true, value(a) { a.fill(byte); return a; } }), v);
      const { block } = await open(context);
      for (let i = 0; i < n; i++) {
        const [a, b] = await paneTexts(block);
        assert.deepEqual([a, b], v === 0 ? [sealed[i].with, sealed[i].against] : [sealed[i].against, sealed[i].with], 'pair ' + (i + 1) + ' under bytes of ' + v);
        if (i < n - 1) await block.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await context.close();
    }
    for (const [width, height] of [[1280, 800], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const requests = [], errors = [];
      await context.route('**/*', async (route) => {
        requests.push(route.request().url());
        if (new URL(route.request().url()).hostname === '127.0.0.1') await route.continue(); else await route.abort();
      });
      context.on('weberror', (e) => errors.push(e.error().message));
      const { page, block } = await open(context);
      const state = () => page.evaluate(() => ({ url: location.href, cookie: document.cookie, local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
      const before = await state(), loaded = requests.length;
      assert.equal(await block.locator('[data-blind-data]').count(), 0, 'the decoded data does not stay in the page');
      assert.equal(await block.getAttribute('data-blind-source'), null, 'the data attribute is gone once decoded');
      assert.equal(await block.locator('fieldset:visible').count(), 1);
      assert.match(await block.innerText(), new RegExp('Pair 1 of ' + n));
      assert.equal(await block.getByRole('button', { name: 'Previous', exact: true }).isDisabled(), true);
      const panes = block.locator('fieldset:visible [data-blind-pane]'); assert.equal(await panes.count(), 2);
      const [p, q] = [await panes.nth(0).boundingBox(), await panes.nth(1).boundingBox()];
      if (width === 1280) { assert.ok(Math.abs(p.y - q.y) < 2, 'side by side'); assert.ok(q.x > p.x + p.width - 2); } else assert.ok(q.y >= p.y + p.height - 2, 'stacked');
      for (const i of [0, 1]) {
        const m = await panes.nth(i).evaluate((e) => ({ c: e.clientHeight, o: getComputedStyle(e).overflowY, tab: e.getAttribute('tabindex'), role: e.getAttribute('role'), label: e.getAttribute('aria-label') }));
        assert.equal(m.o, 'auto'); assert.ok(m.c <= 0.6 * height, 'a pane is bounded');
        assert.deepEqual([m.tab, m.role, m.label], ['0', 'region', 'Answer ' + 'AB'[i] + ' of pair 1'], 'a pane is reachable by keyboard and named');
      }
      await panes.nth(0).focus();
      assert.equal(await panes.nth(0).evaluate((e) => document.activeElement === e), true, 'a pane takes focus');
      const tall = (await block.locator('fieldset:visible').boundingBox()).height + (await block.locator('[data-blind-nav]').boundingBox()).height;
      assert.ok(tall <= 1.1 * height, 'one pair is about one screen: ' + tall + 'px at ' + width + 'x' + height);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
      await block.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(shots, 'blind-' + width + '.png'), fullPage: false });
      const hidden = async () => {
        const text = await block.evaluate((e) => { const c = e.cloneNode(true); c.querySelectorAll('[data-blind-pane], .blind-prompt').forEach((x) => x.remove()); return c.textContent; });
        for (const re of MAPPING) assert.ok(!re.test(text), 'no mapping in the text before Reveal: ' + re);
        const attrs = await block.evaluate((e) => [e, ...e.querySelectorAll('*')].flatMap((x) => [...x.attributes].map((a) => a.name + '=' + a.value)).join(' '));
        assert.ok(!ARM_MARKUP.test(attrs), 'no arm token in any attribute before Reveal: ' + attrs.match(ARM_MARKUP));
      };
      const picks = [], shown = []; let firstOrder;
      for (let i = 0; i < n; i++) {
        assert.match(await block.innerText(), new RegExp('Pair ' + (i + 1) + ' of ' + n));
        await hidden();
        shown.push(await paneTexts(block));
        const letter = i % 3 ? 'A' : 'B'; picks.push(letter);
        await block.locator('fieldset:visible').getByLabel('Answer ' + letter, { exact: true }).check();
        if (i === 0) {
          firstOrder = shown[0];
          await block.getByRole('button', { name: 'Next', exact: true }).click();
          await block.getByRole('button', { name: 'Previous', exact: true }).click();
          assert.equal(await block.locator('fieldset:visible').getByLabel('Answer B', { exact: true }).isChecked(), true, 'a pick stays');
          assert.deepEqual(await paneTexts(block), firstOrder, 'a pair keeps its order');
        }
        if (i < n - 1) await block.getByRole('button', { name: 'Next', exact: true }).click();
      }
      assert.equal(await block.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
      assert.equal(await block.locator('[data-blind-result]').isVisible(), false, 'the last pick does not reveal');
      assert.match(await block.innerText(), new RegExp('All ' + n + ' pairs picked'));
      await hidden();
      // The oracle: each shown pair found among the sealed pairs by its two pane texts, the right
      // pane the one holding the skill's sealed answer, the judge counts from the receipt's means.
      const found = shown.map(([a, b]) => {
        const s = sealed.find((x) => (x.with === a && x.against === b) || (x.with === b && x.against === a));
        assert.ok(s, 'every shown pair is a sealed pair');
        return { s, right: s.with === a ? 'A' : 'B' };
      });
      assert.equal(new Set(found.map((f) => f.s)).size, n, 'every sealed pair is shown once');
      const right = found.filter((f, i) => f.right === picks[i]).length;
      const judge = { higher: 0, lower: 0, same: 0 };
      for (const { s } of found) judge[s.with_mean > s.against_mean ? 'higher' : s.with_mean < s.against_mean ? 'lower' : 'same']++;
      await block.getByRole('button', { name: 'Reveal', exact: true }).click();
      const expected = ["You picked the file's answer " + right + ' of ' + n + ' times', 'A reader picking at random would be right about ' + Math.round(n / 2) + ' times',
        "the judge scored the file's answer higher in " + judge.higher + ', lower in ' + judge.lower + ', the same in ' + judge.same, placeboLine(placeboReading(receipt)), HONESTY];
      assert.deepEqual((await block.locator('[data-blind-result] > p').allInnerTexts()).slice(0, 5), expected);
      const record = JSON.parse(await block.locator('textarea').inputValue());
      assert.equal(record.format, 'driftproof-blind/1'); assert.equal(record.sha256, undefined);
      assert.equal(record.receipt_hash, receipt.receipt_hash);
      assert.deepEqual(record.pairs.map((x) => x.pick), picks);
      assert.deepEqual(record.pairs.map((x) => [x.id, x.draw_index]), found.map((f) => [f.s.id, f.s.draw_index]));
      assert.deepEqual(record.pairs.map((x) => x.correct), found.map((f, i) => f.right === picks[i]));
      await page.screenshot({ path: path.join(shots, 'blind-' + width + '-revealed.png'), fullPage: true });
      assert.equal(requests.length, loaded, 'picking and revealing make no request');
      assert.deepEqual(await state(), before, 'nothing is stored and the address does not move');
      assert.deepEqual(errors, []);
      // Plants: the observers see a request and a write.
      await page.evaluate(() => fetch('/privacy-plant').catch(() => {}));
      assert.ok(requests.length > loaded, 'the request observer sees a planted request');
      await page.evaluate(() => localStorage.setItem('privacy-plant', 'seen'));
      assert.notDeepEqual(await state(), before, 'the state observer sees a planted write');
      await context.close();
    }
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const fallback = await nojs.newPage(); await fallback.goto(url);
    const main = await fallback.locator('main').innerText();
    assert.ok(main.includes(B.NOSCRIPT), 'the noscript line'); assert.ok(main.includes(HONESTY), 'the honesty line');
    assert.ok(await fallback.locator('main a[href*="-answers.json"]').count() >= 1, 'the kept answers are linked');
    assert.equal(await fallback.locator('fieldset, [data-blind-pane]').count(), 0, 'no pair without script');
    for (const s of sealed) assert.ok(!main.includes(s.with.slice(0, 80)) && !main.includes(s.against.slice(0, 80)), 'no answer without script');
    await fallback.screenshot({ path: path.join(shots, 'blind-390-noscript.png'), fullPage: true });
    await nojs.close();
    t.diagnostic('screenshots: ' + shots);
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
