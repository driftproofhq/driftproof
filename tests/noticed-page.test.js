// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 691: /noticed/, the placebo-arm answers of Reports 017 and 018, card by card. Every oracle
// here reads the reports' rows, the receipts, the answers files, the suites and the report pages
// itself, never the builder's own list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { sha256 } = require('../lib/canonical');
const { suiteIdentity } = require('../lib/skill');
const { repositoryJudgeRelationship } = require('../lib/receipt');
const { PLACEBO_WORDS } = require('../lib/verdict');
const { LABELS } = require('../lib/plain');
const placebo = require('../lib/placebo');
const { htmlToText, tokenize, attrOf } = require('../scripts/html-text.js');
const { humanModelName } = require('../scripts/model-names.js');
const R17 = require('../scripts/prepare-report-017.js');
const R18 = require('../scripts/prepare-report-018.js');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const PAGE = 'noticed/index.html';
const ISLAND = 'islands/noticed.js';
const STYLE = 'noticed/style.css';
const URL_PATH = '/noticed/';
const SUITES = path.join(ROOT, 'specs/408-skill-measurements/suites');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'noticed-691-'));
const read = (rel) => fs.readFileSync(path.join(DOCS, rel), 'utf8');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const code = (c) => (e) => e.code === c;
const ENT = { '&#39;': '\'', '&#x27;': '\'', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const decode = (s) => s.replace(/&#39;|&#x27;|&quot;|&lt;|&gt;|&amp;/g, (m) => ENT[m]);
const textOf = (html) => htmlToText(html, { skip: ['script', 'style', 'noscript'], decode, collapse: true });
const PREAMBLE = 'Do not use tools, access the network, write files, run commands or install anything. Answer only in text using the supplied facts.';
const CUT = 240;

function builder() {
  const file = path.join(ROOT, 'scripts/build-noticed.js');
  assert.ok(fs.existsSync(file), 'scripts/build-noticed.js is not built yet');
  return require(file);
}
// The suite whose recomputed hash is the receipt's, found here by scanning every file.
function suiteFileFor(receipt, dir = SUITES) {
  const hits = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).filter((n) => {
    try { return suiteIdentity(json(path.join(dir, n))).suiteHash === receipt.suite.suite_hash; } catch { return false; }
  });
  assert.equal(hits.length, 1, 'exactly one committed suite carries the receipt\'s suite hash');
  return path.join(dir, hits[0]);
}
const answersFileOf = (row) => path.resolve(ROOT, row.src).replace(/\.json$/, '-answers.json');
// The fake's first sentence: up to the first full stop, question or exclamation mark that ends a word.
const firstSentence = (t) => /^[\s\S]*?[.?!](?=\s|$)/.exec(String(t).trim())[0];
// The opening rule, read here: the text up to the first paragraph break at or after the 240th
// character, moved past a fenced code block it would split; the whole answer with no such break.
function openingOf(text) {
  const t = String(text);
  const inFence = (i) => (t.slice(0, i).match(/^(?:```|~~~)/gm) || []).length % 2 === 1;
  const re = /\n[ \t]*\n/g;
  let m;
  while ((m = re.exec(t))) {
    if (m.index < CUT || inFence(m.index)) continue;
    return { opening: t.slice(0, m.index), whole: false };
  }
  return { opening: t, whole: true };
}
// Every card the rule gives, read here: each report's rows in plan order, each suite's cases in
// suite order, the placebo row's draw 0 and the kept answer the receipt seals for it.
function sealedCards() {
  const out = [];
  for (const [number, campaign] of [['017', R17.readCampaign({ campaignRoot: path.join(ROOT, R17.CAMPAIGN) })], ['018', R18.readCampaign({ campaignRoot: path.join(ROOT, R18.CAMPAIGN) })]]) {
    for (const row of campaign.rows) {
      if (!row.receipt) continue;
      const receipt = row.receipt, archive = json(answersFileOf(row));
      assert.equal(archive.receipt_hash, receipt.receipt_hash);
      const suite = json(suiteFileFor(receipt));
      const b = receipt.placebo;
      const fake = placebo.buildPlaceboText(b.bytes, b.seed, b.corpus, b.revision);
      assert.equal(placebo.sha256Hex(fake), b.sha256);
      for (const c of suite.cases) {
        const pr = receipt.results.cases.find((x) => x.id === c.id && x.mode === 'placebo');
        const d = pr.generation.draws.find((x) => x.draw_index === 0);
        assert.equal(d.status, 'measured');
        const answer = archive.answers[d.generation_hash];
        assert.equal(sha256(answer), d.generation_hash);
        out.push({ report: number, attempt_id: row.attempt_id, skill: row.skill, task: c.id, prompt: c.prompt, answer, fake: firstSentence(fake), bytes: b.bytes,
          receipt_hash: receipt.receipt_hash, model: humanModelName(receipt.run.model_id), judge: humanModelName(receipt.run.judge.model_id), src: row.src, campaign, row });
      }
    }
  }
  return out;
}
// The page's cards, read out of the committed page.
function pageCards(html) {
  return [...html.matchAll(/<article class="panel note"([^>]*)>([\s\S]*?)<\/article>/g)].map((m) => {
    const attr = (k) => (new RegExp(`\\s${k}="([^"]*)"`).exec(m[1]) || [])[1];
    const pick = (re) => { const x = re.exec(m[2]); return x ? decode(x[1]) : null; };
    return {
      html: m[0], body: m[2], report: attr('data-report'), attempt_id: attr('data-attempt'), task: attr('data-task'),
      opening: pick(/<pre class="note-opening" data-quote="text">([\s\S]*?)<\/pre>/),
      whole: pick(/<pre class="note-whole" data-quote="text">([\s\S]*?)<\/pre>/),
      prompt: textOf((/<p class="note-prompt" data-quote="text">([\s\S]*?)<\/p>/.exec(m[2]) || [])[1] || ''),
      fake: (pick(/<p class="note-fake" data-quote="text">([\s\S]*?)<\/p>/) || '').replace(/^“([\s\S]*)”$/, '$1'),
      bytes: (/<data class="note-bytes" value="(\d+)" data-src="([^"]+)">/.exec(m[2]) || []).slice(1),
      receipt: (/<a class="note-receipt" href="\/r\/([0-9a-f]{64})\/">/.exec(m[2]) || [])[1],
      caveat: pick(/<p class="note-caveat">([\s\S]*?)<\/p>/),
    };
  });
}
const identity = (cards) => cards.map((c) => [c.report, c.attempt_id, c.task].join('/'));

let B, built, html, sealed, cards;
test.before(() => {
  B = builder();
  built = B.pageOf();
  html = read(PAGE);
  sealed = sealedCards();
  cards = pageCards(html);
});
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('AC-1: every skill with a receipt, every task, the first placebo answer, in the reports\' order, by position alone', () => {
  assert.ok(sealed.length >= 100, 'both reports give cards: ' + sealed.length);
  assert.deepEqual(identity(cards), identity(sealed), 'the page\'s cards are the sealed cards, in order');
  assert.deepEqual(identity(built.cards), identity(sealed), 'the builder\'s cards are the same list');
  assert.equal(new Set(identity(cards)).size, cards.length, 'no card is doubled');
  const rows017 = sealed.find((c) => c.report === '017').campaign.rows, rows018 = sealed.find((c) => c.report === '018').campaign.rows;
  const want = (rows, n) => identity(sealed.filter((c) => c.report === n));
  const pick = (rows, n) => identity(B.cardsOf(n, rows, { suitesDir: SUITES }));
  const plant = (rows, edit) => rows.map((r) => (r.receipt ? { ...r, receipt: edit(structuredClone(r.receipt), r) } : r));
  // Plants: every draw mean swapped between the skill and the placebo, every case mean doubled, the
  // scores gone: the same cards. A router given the smallest skill_bytes: the same cards.
  const swapped = (rows) => plant(rows, (r) => {
    for (const w of r.results.cases.filter((c) => c.mode === 'with_skill')) {
      const a = r.results.cases.find((c) => c.id === w.id && c.mode === 'placebo');
      for (const d of w.generation.draws) { const e = a && a.generation.draws.find((x) => x.draw_index === d.draw_index); if (e) [d.mean, e.mean] = [e.mean, d.mean]; }
    }
    return r;
  });
  for (const [rows, n] of [[rows017, '017'], [rows018, '018']]) {
    assert.deepEqual(pick(swapped(rows), n), want(rows, n), 'scores swapped');
    assert.deepEqual(pick(plant(rows, (r) => { for (const c of r.results.cases) if (typeof c.mean === 'number') c.mean *= 2; return r; }), n), want(rows, n), 'case means doubled');
    assert.deepEqual(pick(plant(rows, (r) => { r.comparison = null; r.verification_level = 'UNVERIFIED'; return r; }), n), want(rows, n), 'the comparison removed');
    const router = rows.find((r) => r.router && r.receipt);
    assert.ok(router, 'the campaign has a router with a receipt');
    assert.deepEqual(pick(plant(rows, (r, row) => { if (row === router) r.placebo.skill_bytes = 1; return r; }), n), want(rows, n), 'a router made shortest');
    // A first draw marked unmeasured refuses; nothing is skipped.
    const unmeasured = plant(rows, (r, row) => { if (row === rows.find((x) => x.receipt)) r.results.cases.find((c) => c.mode === 'placebo').generation.draws.find((d) => d.draw_index === 0).status = 'lost'; return r; });
    assert.throws(() => B.cardsOf(n, unmeasured, { suitesDir: SUITES }), code('CARD_COVERAGE'));
  }
  // A page copy with one card removed fails the oracle.
  const copy = html.replace(cards[3].html, '');
  assert.notDeepEqual(identity(pageCards(copy)), identity(sealed));
});

test('AC-2: every quote and figure traces to the receipt, the answers file, the suite and the rebuilt fake', () => {
  for (let i = 0; i < sealed.length; i++) {
    const s = sealed[i], c = cards[i];
    assert.equal(c.whole === null ? c.opening : c.whole, s.answer, s.skill + '/' + s.task + ': the whole answer, verbatim');
    assert.equal(c.prompt, s.prompt.replace(/\s+/g, ' ').trim(), s.skill + '/' + s.task + ': the prompt');
    assert.equal(c.fake, s.fake, 'the fake\'s first sentence');
    assert.deepEqual(c.bytes, [String(s.bytes), s.src], 'the byte count, from the block, naming the receipt file');
    assert.equal(c.receipt, s.receipt_hash);
  }
  const rows = sealed[0].campaign.rows, first = rows.find((r) => r.receipt);
  const archive = json(answersFileOf(first));
  const edit = (f) => (row) => (row === first ? f(structuredClone(json(answersFileOf(row)))) : json(answersFileOf(row)));
  const control = B.cardsOf('017', rows, { suitesDir: SUITES });
  assert.deepEqual(identity(control), identity(sealed.filter((c) => c.report === '017')));
  const hash = first.receipt.results.cases.find((c) => c.mode === 'placebo').generation.draws.find((d) => d.draw_index === 0).generation_hash;
  assert.throws(() => B.cardsOf('017', rows, { suitesDir: SUITES, answersOf: edit((a) => { a.answers[hash] += 'x'; return a; }) }), code('ANSWER_BINDING'), 'one kept answer edited by a byte');
  assert.throws(() => B.cardsOf('017', rows, { suitesDir: SUITES, answersOf: edit((a) => { a.receipt_hash = '0'.repeat(64); return a; }) }), code('ANSWERS_BINDING'), 'the answers file naming another receipt');
  assert.equal(archive.receipt_hash, first.receipt.receipt_hash);
  // The suite: by its hash, never its name. A renamed suite gives the same cards; one prompt changed
  // by one character refuses.
  const real = suiteFileFor(first.receipt), realText = fs.readFileSync(real, 'utf8');
  const dir = (name, files) => { const d = path.join(scratch, name); fs.mkdirSync(d, { recursive: true }); for (const [n, text] of files) fs.writeFileSync(path.join(d, n), text); return d; };
  const only = [first];
  assert.deepEqual(B.cardsOf('017', only, { suitesDir: dir('renamed', [['zz.json', realText]]) }).map((c) => c.prompt), control.filter((c) => c.attempt_id === first.attempt_id).map((c) => c.prompt), 'a renamed suite is found by its hash');
  const edited = JSON.parse(realText); edited.cases[0].prompt = edited.cases[0].prompt.replace(/.$/, (ch) => (ch === '.' ? '!' : '.'));
  assert.throws(() => B.cardsOf('017', only, { suitesDir: dir('edited', [[path.basename(real), JSON.stringify(edited)]]) }), code('SUITE_BINDING'), 'a prompt changed by one character');
  // The fake: rebuilt and hash-checked.
  const fake = B.fakeOf(first.receipt);
  assert.equal(placebo.sha256Hex(fake.text), first.receipt.placebo.sha256);
  assert.equal(fake.sentence, sealed[0].fake);
  const tampered = structuredClone(first.receipt); tampered.placebo.sha256 = '0'.repeat(64);
  assert.throws(() => B.fakeOf(tampered), code('FAKE_BINDING'));
  const longer = structuredClone(first.receipt); longer.placebo.bytes += 1;
  assert.throws(() => B.fakeOf(longer), code('FAKE_BINDING'));
  assert.equal(B.PREAMBLE, PREAMBLE);
  for (const s of sealed) assert.ok(s.prompt.startsWith(PREAMBLE), 'every prompt opens with the preamble');
  assert.throws(() => B.cardsOf('017', only, { suitesDir: dir('loose', [[path.basename(real), realText.replace('Do not use tools, access the network, write files, run commands or install anything. ', '')]]) }), (e) => ['PROMPT_PREAMBLE', 'SUITE_BINDING'].includes(e.code), 'a prompt without the preamble');
});

test('AC-3: the opening is whole paragraphs of the sealed answer, never a cut sentence or a split code block', () => {
  assert.equal(B.CUT, CUT);
  for (let i = 0; i < sealed.length; i++) {
    const s = sealed[i], c = cards[i], want = openingOf(s.answer);
    assert.equal(c.opening, want.opening, s.skill + '/' + s.task + ': the opening');
    assert.ok(s.answer.startsWith(c.opening), 'a prefix of the answer');
    if (want.whole) assert.equal(c.whole, null, 'an answer shown whole has no fold'); else { assert.equal(c.whole, s.answer); assert.match(c.body, /<summary>Read the whole answer<\/summary>/); }
    const after = s.answer.slice(c.opening.length);
    assert.ok(want.whole || /^\n[ \t]*\n/.test(after), 'the cut is a paragraph break');
    assert.equal((c.opening.match(/^(?:```|~~~)/gm) || []).length % 2, 0, 'no open fence');
    assert.ok(c.opening.length >= Math.min(CUT, s.answer.length), 'at least the cut, or the whole');
    assert.deepEqual(B.openingOf(s.answer), want, 'the builder reads the same rule');
  }
  // Fixtures: a break inside a fence is passed over; no break gives the whole; a short answer is whole.
  const fenced = 'Intro.\n\n```js\n' + 'x'.repeat(260) + '\n\nconst y = 1;\n```\n\nAfter the fence.\n\nMore.';
  assert.deepEqual(B.openingOf(fenced), { opening: fenced.slice(0, fenced.indexOf('\n\nAfter')), whole: false });
  assert.deepEqual(B.openingOf('One line ' + 'z'.repeat(400)), { opening: 'One line ' + 'z'.repeat(400), whole: true });
  assert.deepEqual(B.openingOf('Short.\n\nAnswer.'), { opening: 'Short.\n\nAnswer.', whole: true });
  const two = 'A'.repeat(100) + '\n\n' + 'B'.repeat(200) + '\n\n' + 'C';
  assert.deepEqual(B.openingOf(two), { opening: 'A'.repeat(100) + '\n\n' + 'B'.repeat(200), whole: false });
  // Plants: an opening cut mid-sentence in a copy; a word of a whole answer changed in a copy.
  const long = cards.find((c) => c.whole !== null);
  const cut = long.opening.slice(0, Math.floor(long.opening.length / 2));
  const copy = html.replace(long.body, long.body.replace(long.opening, cut));
  assert.notEqual(pageCards(copy)[cards.indexOf(long)].opening, openingOf(sealed[cards.indexOf(long)].answer).opening, 'a mid-sentence cut is read');
  const changed = html.replace(long.body, long.body.replace('<pre class="note-whole" data-quote="text">', '<pre class="note-whole" data-quote="text">Z'));
  assert.notEqual(pageCards(changed)[cards.indexOf(long)].whole, sealed[cards.indexOf(long)].answer);
});

const H1 = 'The AI noticed the sugar pill';
const LEDE = 'Real answers from an AI that was handed a page about a market town instead of the skill it was being tested with. Flip through the cards.';
const SUGAR = 'In medicine a sugar pill is a placebo: it looks like the medicine and does nothing, so a trial can tell what the medicine itself adds. Driftproof does the same with a skill: the model answers each task with the skill and again with a fake of the same length, a few harmless sentences about a market town, so a report can tell what the skill\'s own words add.';
const CARDS = 'The cards below are the model\'s answers from the fake side of Reports 017 and 018. Often the model just does the task. Sometimes it says, in so many words, that the text it was handed describes a town and has nothing to do with the job. That is the sugar pill being noticed.';
const RULE = 'A fixed rule picks the cards, so none of them is here because it is funny. For every skill in Report 017 and Report 018, in the reports\' own order, there is one card for each of the skill\'s tasks: the first answer the model gave to that task when it was handed the fake in place of the skill. Nothing is left out, nothing is reordered and nothing is sorted by how well it noticed.';
const NO_COUNT = 'This page counts nothing. It does not say how many answers noticed the fake, and it is not a measurement; the readings are on the reports, and each card links to its receipt.';
const FAKE_NOTE = 'Every fake starts with the same sentence about the morning light. After that its sentences are shuffled by a number made from the skill\'s own text, and the whole thing is cut to the skill\'s exact length, so the model gets as much text as the skill would have given it, about something else entirely.';
const OPENING_NOTE = 'Each card shows the opening of the answer, whole paragraphs and never a cut sentence, with the whole answer one tap away. The task is shown as the model saw it; its first two sentences are the same rules every task carries.';
const PRIVATE = 'Flipping through the cards sends nothing anywhere and stores nothing.';
const COUNTER = 'The site\'s visit counter (Cloudflare Web Analytics) still counts the page view.';
const NEXT = 'See the fake for your own file on Fake my file. Guess which answer had the skill on Can you tell? Walk through a whole test on How it works.';

test('AC-4: the page\'s own words, in order, and no verdict word or typed number', () => {
  const main = /<main\b[\s\S]*<\/main>/.exec(html)[0];
  const outside = main.replace(/<article class="panel note"[\s\S]*?<\/article>/g, '');
  const paras = [...outside.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => textOf(m[1]).trim());
  const lines = [LEDE, SUGAR, CARDS, RULE, NO_COUNT, FAKE_NOTE, OPENING_NOTE, PRIVATE + ' ' + COUNTER, NEXT];
  assert.deepEqual(paras.filter((p) => lines.includes(p)), lines, 'each pinned paragraph, whole and in order');
  assert.equal(paras[0], LEDE, 'the first paragraph is the description');
  assert.equal(textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1]), H1);
  assert.doesNotMatch(/<main\b[^>]*>/.exec(html)[0], /data-description/);
  assert.equal(require('../scripts/build-head-tags.js').pageDescription(html), LEDE, 'the head builder derives it');
  assert.equal(decode(/<meta name="description" content="([^"]*)">/.exec(html)[1]), LEDE);
  assert.match(html, /<script type='module' src='https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js'/, 'the page carries the beacon, which the privacy line names');
  assert.deepEqual([B.WORDS.h1, B.WORDS.lede, B.WORDS.sugar, B.WORDS.cards, B.WORDS.rule, B.WORDS.noCount, B.WORDS.fakeNote, B.WORDS.openingNote, B.WORDS.private, B.WORDS.counter], [H1, LEDE, SUGAR, CARDS, RULE, NO_COUNT, FAKE_NOTE, OPENING_NOTE, PRIVATE, COUNTER]);
  // No verdict word, reading token, count of noticing or typed number outside the quoted material and
  // the read figures.
  const plain = (h) => {
    const m = /<main\b[\s\S]*<\/main>/.exec(h)[0];
    return textOf(m.replace(/<(p|pre|span)\b[^>]*\sdata-quote="[^"]*"[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<data\b[^>]*>[\s\S]*?<\/data>/g, ' '));
  };
  const BANNED = [...Object.values(PLACEBO_WORDS), ...Object.keys(PLACEBO_WORDS), 'UNDERPOWERED', 'NOT_MEASURED', ...Object.values(LABELS), 'clearly helped', 'clearly hurt', 'beat the fake', 'below the fake', 'confidence'];
  const banned = (t) => BANNED.filter((w) => t.toLowerCase().includes(String(w).toLowerCase()));
  const digits = (t) => t.replace(/Reports? 01[78](?: and 01[78])?/g, '').replace(/Claude (?:Sonnet|Haiku|Opus) \d+\.\d+/g, '').match(/\d+/g) || [];
  const t = plain(html);
  assert.deepEqual(banned(t), [], 'no verdict word or reading token');
  assert.deepEqual(digits(t), [], 'no digit outside the read figures and the quotes');
  assert.doesNotMatch(t, /\b\d+ (?:answers|cards)\b[^.]*\bnoticed\b/, 'no count of answers that noticed');
  assert.match(t, /This page counts nothing\./, 'the page says it counts nothing');
  const at = html.indexOf('<div class="deck"');
  const plantAt = (s) => html.slice(0, at) + '<p>' + s + '</p>' + html.slice(at);
  assert.deepEqual(digits(plain(plantAt('12 of 120 answers noticed the fake.'))), ['12', '120'], 'plant: a typed count is read');
  assert.deepEqual(banned(plain(plantAt('handoff beat the fake.'))), ['beat the fake'], 'plant: a verdict phrase is read');
  assert.deepEqual(banned(plain(plantAt('ABOVE_PLACEBO'))), ['ABOVE_PLACEBO'], 'plant: a reading token is read');
  assert.ok(digits(plain(plantAt('<data value="7">7</data>'))).length === 0 && digits(plain(plantAt('<p data-quote="text">7 towns</p>'))).length === 0, 'control: a read figure and a quote are not counted');
  // The labels on a card, and the links the issue asks for.
  for (const c of cards) { assert.match(c.body, /What the AI was handed instead of the skill/); assert.match(c.body, />The task</); assert.match(c.body, /What the AI answered/); }
  for (const href of ['/placebo/', '/reports/017/blind/', '/how-it-works/']) assert.ok(outside.includes('href="' + href + '"'), href);
});

test('AC-5: each report\'s caveats stand on every card from it', () => {
  const caveatOf = (n) => decode(/<p class="headline-caveat">([\s\S]*?)<\/p>/.exec(read('reports/' + n + '/index.html'))[1]);
  const limitation = decode(/<p class="judge-limitation">([\s\S]*?)<\/p>/.exec(read('reports/018/index.html'))[1]);
  assert.equal(limitation, repositoryJudgeRelationship('claude-haiku-5-5', 'claude-haiku-5-5').limitation);
  const word = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  for (let i = 0; i < sealed.length; i++) {
    const s = sealed[i], c = cards[i];
    const count = s.row.receipt.suite.case_count;
    const scope = 'Each skill had ' + word[count] + ' text tasks, written by Driftproof. The answers came from ' + s.model + ' and the scores from ' + s.judge + '; no score is shown here.';
    const want = 'From Report ' + s.report + '. ' + scope + ' The report\'s own caveat' + (s.report === '018' ? 's' : '') + ': “' + caveatOf(s.report) + '”' + (s.report === '018' ? ' “' + limitation + '”' : '');
    assert.equal(textOf(c.caveat || ''), want, s.skill + '/' + s.task);
    assert.ok(/<footer class="note-foot">[\s\S]*<p class="note-caveat">/.test(c.body), 'the caveat sits in the card\'s own footer');
  }
  // Plants: one card's caveat removed in a copy; the renderer given no caveat; a report page without one.
  const copy = html.replace(cards[0].html, cards[0].html.replace(/<p class="note-caveat">[\s\S]*?<\/p>/, ''));
  assert.equal(pageCards(copy)[0].caveat, null, 'the missing caveat is read');
  assert.throws(() => B.cardHTML(built.cards[0], { text: '' }), code('CAVEAT_BINDING'));
  assert.throws(() => B.cardHTML(built.cards[0], null), code('CAVEAT_BINDING'));
  const docs = path.join(scratch, 'docs-no-caveat'); fs.mkdirSync(path.join(docs, 'reports/017'), { recursive: true }); fs.mkdirSync(path.join(docs, 'reports/018'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'reports/017/index.html'), read('reports/017/index.html').replace(/<p class="headline-caveat">[\s\S]*?<\/p>/, ''));
  fs.writeFileSync(path.join(docs, 'reports/018/index.html'), read('reports/018/index.html'));
  const rows017 = sealed[0].campaign.rows, rows018 = sealed.find((c) => c.report === '018').campaign.rows;
  assert.throws(() => B.caveatsOf('017', rows017, { docsDir: docs }), code('REPORT_CAVEAT'));
  assert.doesNotThrow(() => B.caveatsOf('018', rows018, { docsDir: docs }), 'control');
  assert.equal(B.caveatsOf('018', rows018, { docsDir: DOCS }).limitation, limitation);
  const other = rows018.map((r, i) => (i === rows018.findIndex((x) => x.receipt) ? { ...r, receipt: { ...r.receipt, run: { ...r.receipt.run, judge: { ...r.receipt.run.judge, model_id: 'claude-sonnet-5-5' } } } } : r));
  assert.throws(() => B.caveatsOf('018', other, { docsDir: DOCS }), code('SCOPE_BINDING'), 'receipts differing in judge');
  const page018 = read('reports/018/index.html').replace(/<p class="judge-limitation">[\s\S]*?<\/p>/, '<p class="judge-limitation">The judge is another model.</p>');
  fs.writeFileSync(path.join(docs, 'reports/018/index.html'), page018);
  assert.throws(() => B.caveatsOf('018', rows018, { docsDir: docs }), code('LIMITATION_BINDING'), 'a limitation that is not the library\'s');
});

test('AC-7: the scripts, the island and the static mount', () => {
  const ALLOWED = ['/islands/loader.js', '/copy-button.js', 'https://static.cloudflareinsights.com/beacon.min.js'];
  const scriptProblems = (h) => tokenize(h).filter((t) => t.type === 'start' && t.name === 'script' && attrOf(t, 'type') !== 'application/ld+json').filter((t) => !ALLOWED.includes(attrOf(t, 'src'))).map((t) => t.raw);
  assert.deepEqual(scriptProblems(html), [], 'every script is an allowed source');
  assert.deepEqual(scriptProblems(html.replace('</body>', '<script src="/x.js"></script></body>')), ['<script src="/x.js">'], 'plant');
  // Issue 716: the deck is the page's one island of its own; the plain-word cards (spec 689) are the shared chrome's.
  assert.deepEqual([...html.matchAll(/data-island="([^"]+)"/g)].map((m) => m[1]).sort(), ['jargon-cards', 'noticed']);
  assert.match(html, /<div class="deck" data-island="noticed">/);
  assert.doesNotMatch(html, /<form\b/i);
  const equiv = (h) => [...h.matchAll(/<meta\s+http-equiv="([^"]+)"/gi)].map((m) => m[1].toLowerCase()).sort();
  assert.deepEqual(equiv(html), equiv(read('placebo/index.html')), 'the policy is the other site pages\'');
  const island = read(ISLAND);
  const body = island.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(body, /\b(?:require|process|Buffer|fetch|XMLHttpRequest|WebSocket|EventSource|Worker|sendBeacon|localStorage|sessionStorage|indexedDB)\b|eval\s*\(|import\s*\(|^\s*import\s|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.cookie\s*=/m);
  assert.match(body, /export function mount\(/);
  // The mount's static content is the cards: a paragraph inside the mount, nothing fetched.
  const mount = /<div class="deck" data-island="noticed">[\s\S]*<\/div>\s*<h2/.exec(html)[0];
  assert.ok((mount.match(/<article class="panel note"/g) || []).length === cards.length && /<p\b/.test(mount));
  // The stylesheet: motion only inside the guard (spec 025 AC-7), colours, radii and sizes by token.
  const css = read(STYLE).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const rest = css.replace(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?\n\}/g, ' ');
  assert.doesNotMatch(rest, /\b(transition|animation)\s*:|@keyframes/, 'no motion outside the guard');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/, 'the guard exists');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no raw colour');
  for (const m of css.matchAll(/(?:^|[;{])\s*font-size\s*:\s*([^;}]+)/gm)) assert.match(m[1].trim(), /^var\(--t-[a-z0-9-]+\)$/, 'font-size ' + m[1]);
  for (const m of css.matchAll(/(?:^|[;{])\s*border-radius\s*:\s*([^;}]+)/gm)) assert.equal(m[1].trim(), 'var(--radius)');
  for (const m of css.matchAll(/(?:^|[;{])\s*max-width\s*:\s*([^;}]+)/gm)) assert.match(m[1].trim(), /^(var\(--w-[a-z-]+\)|100%|none)$/);
});

test('AC-8: --check reproduces the page, writes one file, and moves nothing', { timeout: 1200000 }, () => {
  assert.doesNotThrow(() => B.check());
  const out = path.join(scratch, 'docs');
  const files = B.write({ out });
  assert.deepEqual(files.map((f) => path.relative(out, f.file)), [PAGE], 'one file');
  assert.doesNotThrow(() => B.check({ out }), 'control: a page just written passes');
  const file = path.join(out, PAGE), was = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, was.replace(/e/, 'E'));
  assert.throws(() => B.check({ out }), code('NOTICED_PAGE_DRIFT'));
  fs.writeFileSync(file, was);
  const inputs = [...new Set(sealed.flatMap((s) => [path.resolve(ROOT, s.src), answersFileOf(s.row), suiteFileFor(s.row.receipt)]))];
  const before = inputs.map((f) => sha256(fs.readFileSync(f)));
  B.write({ out: path.join(scratch, 'again') });
  assert.deepEqual(inputs.map((f) => sha256(fs.readFileSync(f))), before, 'no receipt, answers file or suite moved');
  for (const script of ['scripts/prepare-report-017.js', 'scripts/prepare-report-018.js']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, script), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
    assert.equal(r.status, 0, script + ': ' + r.stdout + r.stderr);
  }
});

test('AC-9: sitemap, head, llms.txt and every link', () => {
  assert.ok(read('sitemap-pages.xml').includes('<loc>https://driftproofhq.com' + URL_PATH + '</loc>'));
  assert.equal(require('../scripts/build-head-tags.js').render(html, PAGE), html, 'the head builder leaves the page as it is');
  const h1 = textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1]);
  const description = decode(/<meta name="description" content="([^"]*)">/.exec(html)[1]);
  const llms = read('llms.txt'), optional = llms.slice(llms.indexOf('## Optional'));
  assert.ok(optional.includes('- [' + h1 + '](https://driftproofhq.com' + URL_PATH + '): ' + description + '\n'), 'llms.txt lists the page in Optional');
  const { noticedLines } = require('../scripts/build-llms.js');
  assert.deepEqual(noticedLines(ROOT), ['- [' + h1 + '](https://driftproofhq.com' + URL_PATH + '): ' + description]);
  assert.deepEqual(noticedLines(fs.mkdtempSync(path.join(scratch, 'none-'))), [], 'no page, no line');
  for (const rel of ['placebo/index.html', 'reports/017/blind/index.html', 'how-it-works/index.html', 'reports/017/index.html', 'reports/018/index.html']) assert.ok(fs.existsSync(path.join(DOCS, rel)), rel);
  for (const c of cards) {
    assert.ok(fs.existsSync(path.join(DOCS, 'r', c.receipt, 'index.html')), 'the receipt page exists: ' + c.receipt);
    assert.ok(c.body.includes('href="/reports/' + c.report + '/"'), 'the report is linked');
  }
  const rows = sealed[0].campaign.rows;
  assert.throws(() => B.cardsOf('017', [rows.find((r) => r.receipt)], { suitesDir: SUITES, docsDir: path.join(scratch, 'no-receipt-pages') }), code('RECEIPT_PAGE'));
});

test('AC-6, AC-7: Chromium flips one card at a time, by button and key, sends nothing, and stays still when asked', { timeout: 1200000 }, async (t) => {
  const { chromium } = require('playwright');
  const shots = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'noticed-691-shots-'));
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
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    for (const [width, height, motion] of [[1280, 800, 'no-preference'], [390, 844, 'reduce']]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion });
      const requests = [], errors = [];
      await context.route('**/*', async (route) => {
        requests.push(route.request().url());
        if (new URL(route.request().url()).hostname === '127.0.0.1') await route.continue(); else await route.abort();
      });
      context.on('weberror', (e) => errors.push(e.error().message));
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      const deck = page.locator('[data-island="noticed"]');
      await deck.locator('[data-deck-nav]').first().waitFor({ state: 'visible' });
      const state = () => page.evaluate(() => ({ url: location.href, cookie: document.cookie, local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
      const before = await state(), loaded = requests.length;
      const visible = () => deck.locator('article:visible');
      const count = () => deck.locator('[data-deck-count]').first().innerText();
      assert.equal(await visible().count(), 1, 'one card at a time');
      assert.equal(await count(), 'Card 1 of ' + n);
      // Issue 716: no card, held mid-turn (its tilt and slide, transition off), makes the page scroll sideways (spec 025 AC-12).
      await page.emulateMedia({ reducedMotion: 'no-preference' }); // the turn is styled only where motion is allowed
      const wideTurns = await deck.evaluate(async (d) => {
        const cards = [...d.querySelectorAll('article.note')]; const was = cards.map((c) => c.hidden); const bad = [];
        for (const [i, c] of cards.entries()) {
          cards.forEach((x) => { x.hidden = x !== c; }); c.style.transition = 'none'; c.classList.add('is-turning');
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          if (document.documentElement.scrollWidth > window.innerWidth) bad.push(i + 1);
          c.classList.remove('is-turning'); c.style.transition = '';
        }
        cards.forEach((x, i) => { x.hidden = was[i]; });
        return bad;
      });
      await page.emulateMedia({ reducedMotion: motion });
      assert.deepEqual(wideTurns, [], 'cards that scroll the page sideways mid-turn at ' + width);
      const prev = deck.getByRole('button', { name: 'Previous', exact: true }).first(), next = deck.getByRole('button', { name: 'Next', exact: true }).first();
      assert.equal(await prev.isDisabled(), true);
      // The controls take the shell tokens; the disabled one is --shell-muted on --surface.
      const colours = await prev.evaluate((b) => { const s = getComputedStyle(b); return [s.color, s.backgroundColor]; });
      const tokens = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return [s.getPropertyValue('--shell-muted').trim(), s.getPropertyValue('--surface').trim()]; });
      const rgb = (hex) => 'rgb(' + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
      assert.deepEqual(colours, tokens.map(rgb), 'a disabled control is --shell-muted on --surface');
      await next.click();
      assert.equal(await count(), 'Card 2 of ' + n);
      assert.equal(await visible().getAttribute('data-attempt'), cards[1].attempt_id);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.matches('article.note')), true, 'the shown card takes focus');
      await page.keyboard.press('ArrowRight');
      assert.equal(await count(), 'Card 3 of ' + n);
      await page.keyboard.press('ArrowLeft');
      assert.equal(await count(), 'Card 2 of ' + n);
      assert.equal(await visible().getAttribute('data-task'), cards[1].task);
      // The fold opens the whole answer, in the page.
      const fold = visible().locator('details.note-more');
      if (await fold.count()) { await fold.locator('summary').click(); assert.equal(await fold.evaluate((d) => d.open), true); await fold.locator('summary').click(); }
      // Issue 716: arrows on a summary or link do not flip cards (spec 702, review 698 F-1), so the keys below start from the card.
      await visible().focus();
      // Layout: no sideways scroll.
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at ' + width);
      // Motion: with reduced motion asked for, no card carries a transition.
      const duration = await visible().evaluate((a) => getComputedStyle(a).transitionDuration);
      if (motion === 'reduce') assert.equal(duration, '0s', 'nothing moves when asked'); else assert.notEqual(duration, '0s', 'the guarded turn is allowed');
      await page.screenshot({ path: path.join(shots, 'noticed-' + width + '.png'), fullPage: false });
      // Keyboard to the last card, then back to the first.
      for (let i = 2; i < n; i++) await page.keyboard.press('ArrowRight');
      assert.equal(await count(), 'Card ' + n + ' of ' + n);
      assert.equal(await next.isDisabled(), true);
      assert.equal(await visible().getAttribute('data-attempt'), cards[n - 1].attempt_id);
      await page.keyboard.press('ArrowRight');
      assert.equal(await count(), 'Card ' + n + ' of ' + n, 'the last card stays');
      await page.screenshot({ path: path.join(shots, 'noticed-' + width + '-last.png'), fullPage: true });
      assert.equal(requests.length, loaded, 'flipping makes no request');
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
    assert.equal(await fallback.locator('article.note:visible').count(), n, 'every card shows without script');
    assert.equal(await fallback.locator('[data-deck-nav]').count(), 0, 'no nav without script');
    assert.ok(await fallback.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll without script');
    await fallback.screenshot({ path: path.join(shots, 'noticed-390-noscript.png'), fullPage: false });
    await nojs.close();
    t.diagnostic('screenshots: ' + shots);
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
