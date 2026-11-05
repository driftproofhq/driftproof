#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {"href":"/noticed/","label":"The AI noticed the sugar pill"}
// Issue 691 (spec 691): /noticed/, "The AI noticed the sugar pill". Every card is the first answer a
// model gave to one task of one skill in Report 017 or Report 018 when it was handed the same-length
// placebo text in the skill's place, verbatim, beside the task and the fake's first sentence, with a
// link to the receipt that seals it. The cards are every such answer, in the reports' own order, by a
// rule that reads position alone: no score, band, verdict or reading is read, and nothing is counted.
// Each report's caveats stand on every card taken from it. Nothing here writes a receipt, an answers
// file, a suite or a report.
//   node scripts/build-noticed.js [--check]
const fs = require('node:fs'), path = require('node:path');
const C = require('../specs/408-skill-measurements/campaign.cjs');
const R17 = require('./prepare-report-017.js');
const R18 = require('./prepare-report-018.js');
const blind = require('../lib/blind');
const placebo = require('../lib/placebo');
const { sha256 } = require('../lib/canonical');
const { repositoryJudgeRelationship } = require('../lib/receipt');
const { applyHeadTags, beaconFor, siteConfig } = require('./build-head-tags');
const { humanModelName } = require('./model-names');
const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const REL = 'noticed/index.html', URL_PATH = '/noticed/';
const SUITES = path.join(ROOT, 'specs/408-skill-measurements/suites');
const esc = C.esc, need = C.need;

// The page's own words (spec 691 AC-4). The lede is also the description the head builder derives.
const WORDS = {
  h1: 'The AI noticed the sugar pill',
  lede: 'Real answers from an AI that was handed a page about a market town instead of the skill it was being tested with. Flip through the cards.',
  sugar: 'In medicine a sugar pill is a placebo: it looks like the medicine and does nothing, so a trial can tell what the medicine itself adds. Driftproof does the same with a skill: the model answers each task with the skill and again with a fake of the same length, a few harmless sentences about a market town, so a report can tell what the skill\'s own words add.',
  cards: 'The cards below are the model\'s answers from the fake side of Reports 017 and 018. Often the model just does the task. Sometimes it says, in so many words, that the text it was handed describes a town and has nothing to do with the job. That is the sugar pill being noticed.',
  rule: 'A fixed rule picks the cards, so none of them is here because it is funny. For every skill in Report 017 and Report 018, in the reports\' own order, there is one card for each of the skill\'s tasks: the first answer the model gave to that task when it was handed the fake in place of the skill. Nothing is left out, nothing is reordered and nothing is sorted by how well it noticed.',
  noCount: 'This page counts nothing. It does not say how many answers noticed the fake, and it is not a measurement; the readings are on the reports, and each card links to its receipt.',
  fakeNote: 'Every fake starts with the same sentence about the morning light. After that its sentences are shuffled by a number made from the skill\'s own text, and the whole thing is cut to the skill\'s exact length, so the model gets as much text as the skill would have given it, about something else entirely.',
  openingNote: 'Each card shows the opening of the answer, whole paragraphs and never a cut sentence, with the whole answer one tap away. The task is shown as the model saw it; its first two sentences are the same rules every task carries.',
  private: 'Flipping through the cards sends nothing anywhere and stores nothing.',
  counter: 'The site\'s visit counter (Cloudflare Web Analytics) still counts the page view.',
  // The three links the issue asks for, as text; the markup is in pageHtml.
  next: 'See the fake for your own file on Fake my file. Guess which answer had the skill on Can you tell? Walk through a whole test on How it works.',
};
// The two sentences every task of these suites opens with (spec 408); shown muted on the card.
const PREAMBLE = 'Do not use tools, access the network, write files, run commands or install anything. Answer only in text using the supplied facts.';
// The opening rule's cut: the first paragraph break at or after this many characters.
const CUT = 240;
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// The two reports, each read through its own builder's reader, which checks every receipt's seal and
// schema and reconstructs its scores. Memoised per process: the inputs are the committed roots.
const memo = new Map();
const REPORTS = [
  { number: '017', page: 'reports/017/index.html', read: () => R17.readCampaign({ campaignRoot: path.join(ROOT, R17.CAMPAIGN) }) },
  { number: '018', page: 'reports/018/index.html', read: () => R18.readCampaign({ campaignRoot: path.join(ROOT, R18.CAMPAIGN) }) },
];
function campaignOf(rep) {
  if (!memo.has(rep.number)) memo.set(rep.number, rep.read());
  return memo.get(rep.number);
}

// A text's first sentence: up to the first full stop, question or exclamation mark that ends a word.
function firstSentence(text) {
  const m = /^[\s\S]*?[.?!](?=\s|$)/.exec(String(text).trim());
  need(m, 'FAKE_BINDING');
  return m[0];
}
// The fake, rebuilt from the receipt's block and refused unless it is the one the block seals.
function fakeOf(receipt) {
  const b = receipt.placebo;
  need(b && placebo.corpusHashOf(b.corpus) === b.corpus_hash && b.corpus_hash === placebo.PLACEBO_CORPUS_HASHES[b.revision], 'FAKE_BINDING');
  const text = placebo.buildPlaceboText(b.bytes, b.seed, b.corpus, b.revision);
  need(placebo.sha256Hex(text) === b.sha256 && Buffer.byteLength(text, 'utf8') === b.bytes, 'FAKE_BINDING');
  return { text, sentence: firstSentence(text), bytes: b.bytes };
}
// The opening (spec 691 AC-3): the text up to the first paragraph break at or after the cut, moved
// past a fenced code block it would split; the whole answer when there is no such break.
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
// The suite whose hash, recomputed by readSuite, is the receipt's. A file name is never read.
function suiteFor(receipt, suitesDir = SUITES) {
  const hits = [];
  for (const name of fs.readdirSync(suitesDir).filter((n) => n.endsWith('.json')).sort()) {
    let suite; try { suite = blind.readSuite(path.join(suitesDir, name)); } catch { continue; }
    if (suite.suiteHash === receipt.suite.suite_hash) hits.push(suite);
  }
  need(hits.length > 0, 'SUITE_BINDING');
  return hits[0];
}
const answersFileOf = (row) => path.resolve(ROOT, row.src).replace(/\.json$/, '-answers.json');

// The cards of one report (spec 691 AC-1, AC-2): every row with a receipt in plan order, every case
// in suite order, the placebo row's first draw and the kept answer the receipt seals for it. A
// missing, unmeasured or unkept first answer refuses; nothing is skipped. No score is read.
function cardsOf(number, rows, opts = {}) {
  const suitesDir = opts.suitesDir || SUITES, docsDir = opts.docsDir || DOCS;
  const answersOf = opts.answersOf || ((row) => C.read(answersFileOf(row)));
  const cards = [];
  for (const row of rows) {
    if (!row.receipt) continue;
    const receipt = row.receipt, archive = answersOf(row);
    need(archive && typeof archive === 'object' && archive.receipt_hash === receipt.receipt_hash && archive.answers && typeof archive.answers === 'object', 'ANSWERS_BINDING');
    const suite = suiteFor(receipt, suitesDir);
    need(suite.raw && suite.raw.author === 'Driftproof' && suite.cases.length === receipt.suite.case_count, 'SCOPE_BINDING');
    const fake = fakeOf(receipt);
    need(fs.existsSync(path.join(docsDir, 'r', receipt.receipt_hash, 'index.html')), 'RECEIPT_PAGE');
    for (const c of suite.cases) {
      need(typeof c.prompt === 'string' && c.prompt.startsWith(PREAMBLE), 'PROMPT_PREAMBLE');
      const pr = receipt.results.cases.find((x) => x.id === c.id && x.mode === 'placebo');
      const d = pr && pr.generation && pr.generation.draws.find((x) => x.draw_index === 0);
      need(d && d.status === 'measured' && typeof d.generation_hash === 'string', 'CARD_COVERAGE');
      const answer = archive.answers[d.generation_hash];
      need(typeof answer === 'string', 'CARD_COVERAGE');
      need(sha256(answer) === d.generation_hash, 'ANSWER_BINDING');
      cards.push({ report: number, index: cards.length, attempt_id: row.attempt_id, skill: row.skill, repository: row.repository, task: c.id, prompt: c.prompt, answer, ...openingOf(answer),
        fake: fake.sentence, bytes: fake.bytes, receipt_hash: receipt.receipt_hash, src: row.src, model: humanModelName(receipt.run.model_id), judge: humanModelName(receipt.run.judge.model_id) });
    }
  }
  need(cards.length > 0, 'CARD_COVERAGE');
  return cards;
}

// A report's caveats (spec 691 AC-5): the scope read from its receipts, its own caveat line read from
// its published page, and for a same-model judge the limitation, which must be the library's.
const decode = (s) => String(s).replace(/&#39;|&quot;|&lt;|&gt;|&amp;/g, (m) => ({ '&#39;': '\'', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&' })[m]);
function paragraphsOf(html, cls) {
  return [...new Set([...String(html).matchAll(new RegExp('<p class="' + cls + '">([\\s\\S]*?)</p>', 'g'))].map((m) => decode(m[1]).replace(/\s+/g, ' ').trim()))];
}
function caveatsOf(number, rows, opts = {}) {
  const docsDir = opts.docsDir || DOCS;
  const receipts = rows.filter((r) => r.receipt).map((r) => r.receipt);
  need(receipts.length > 0, 'SCOPE_BINDING');
  const one = (get) => { const v = receipts.map(get); need(v.every((x) => x === v[0]), 'SCOPE_BINDING'); return v[0]; };
  const model = one((r) => r.run.model_id), judge = one((r) => r.run.judge.model_id), count = one((r) => r.suite.case_count);
  need(Number.isInteger(count) && count >= 1 && count < NUMBER_WORDS.length, 'SCOPE_BINDING');
  const scope = 'Each skill had ' + NUMBER_WORDS[count] + ' text tasks, written by Driftproof. The answers came from ' + humanModelName(model) + ' and the scores from ' + humanModelName(judge) + '; no score is shown here.';
  const file = path.join(docsDir, 'reports', number, 'index.html');
  need(fs.existsSync(file), 'REPORT_CAVEAT');
  const page = fs.readFileSync(file, 'utf8');
  const caveats = paragraphsOf(page, 'headline-caveat');
  need(caveats.length === 1 && caveats[0].length > 0, 'REPORT_CAVEAT');
  const limitations = paragraphsOf(page, 'judge-limitation');
  let limitation = null;
  if (limitations.length || model === judge) {
    need(limitations.length === 1 && limitations[0] === repositoryJudgeRelationship(model, judge).limitation, 'LIMITATION_BINDING');
    limitation = limitations[0];
  }
  const text = 'From Report ' + number + '. ' + scope + ' The report\'s own caveat' + (limitation ? 's' : '') + ': “' + caveats[0] + '”' + (limitation ? ' “' + limitation + '”' : '');
  return { number, scope, caveat: caveats[0], limitation, text };
}

// One card. The quoted material carries data-quote, the one figure is a data element naming the
// receipt file, and the caveats stand in the card's own footer; a card without them refuses.
function cardHTML(card, caveats) {
  need(caveats && typeof caveats.text === 'string' && caveats.text.length > 0, 'CAVEAT_BINDING');
  const name = (s) => '<span class="note-skill" data-quote="name">' + esc(s) + '</span>';
  const rest = card.prompt.slice(PREAMBLE.length);
  const fold = card.whole
    ? '<p class="note-whole-note">That is the whole answer.</p>'
    : '<details class="note-more"><summary>Read the whole answer</summary><pre class="note-whole" data-quote="text">' + esc(card.answer) + '</pre></details>';
  return '<article class="panel note" data-card data-report="' + esc(card.report) + '" data-attempt="' + esc(card.attempt_id) + '" data-task="' + esc(card.task) + '" tabindex="-1">'
    + '<p class="note-eyebrow eyebrow">Report ' + esc(card.report) + ' · answered by ' + esc(card.model) + '</p>'
    + '<h3 class="note-title">' + name(card.skill) + ' · the <span class="note-task-name" data-quote="name">' + esc(card.task) + '</span> task</h3>'
    + '<section class="note-part note-given"><p class="note-label">What the AI was handed instead of the skill</p>'
    + '<p class="note-fake" data-quote="text">“' + esc(card.fake) + '”</p>'
    + '<p class="note-fake-note">… and so on for <data class="note-bytes" value="' + esc(card.bytes) + '" data-src="' + esc(card.src) + '">' + esc(card.bytes) + '</data> bytes about the same town: the exact length of the ' + name(card.skill) + ' skill\'s text.</p></section>'
    + '<section class="note-part note-task"><p class="note-label">The task</p>'
    + '<p class="note-prompt" data-quote="text"><span class="note-preamble">' + esc(PREAMBLE) + '</span>' + esc(rest) + '</p></section>'
    + '<section class="note-part note-answer"><p class="note-label">What the AI answered</p>'
    + '<pre class="note-opening" data-quote="text">' + esc(card.opening) + '</pre>' + fold + '</section>'
    + '<footer class="note-foot"><p class="note-links"><a class="note-receipt" href="/r/' + esc(card.receipt_hash) + '/">The receipt</a> · <a href="/reports/' + esc(card.report) + '/">Report ' + esc(card.report) + '</a></p>'
    + '<p class="note-caveat">' + esc(caveats.text) + '</p></footer>'
    + '</article>';
}

function pageHtml({ reports }) {
  const p = (text, cls) => '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(text) + '</p>';
  need(WORDS.lede.length >= 50 && WORDS.lede.length <= 155, 'DESCRIPTION');
  const deck = reports.flatMap((r) => r.cards.map((c) => cardHTML(c, r.caveats))).join('');
  const links = 'See the fake for your own file on <a href="/placebo/">Fake my file</a>. Guess which answer had the skill on <a href="/reports/017/blind/">Can you tell?</a> Walk through a whole test on <a href="/how-it-works/">How it works</a>.';
  const main = '<main class="noticed-page">'
    + '<h1>' + esc(WORDS.h1) + '</h1>' + p(WORDS.lede, 'lede')
    + '<h2 id="sugar-pill">What a sugar pill is here</h2>' + p(WORDS.sugar) + p(WORDS.cards)
    + '<h2 id="cards">The cards</h2>'
    + '<div class="deck" data-island="noticed">' + deck + '</div>'
    + '<h2 id="rule">How the cards were chosen</h2>' + p(WORDS.rule) + p(WORDS.noCount) + p(WORDS.fakeNote) + p(WORDS.openingNote)
    + '<h2 id="stays">What stays in this page</h2>' + p(WORDS.private + (beaconFor(siteConfig().cloudflare_analytics_token) ? ' ' + WORDS.counter : ''), 'noticed-private')
    + '<h2 id="next">Where next</h2><p>' + links + '</p>'
    + '</main>';
  const raw = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(WORDS.h1) + ' | Driftproof</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="' + URL_PATH + 'style.css"></head><body>' + main + '</body></html>\n';
  // A second application normalizes the inserted chrome's boundary whitespace, as for Report 017.
  return applyHeadTags(applyHeadTags(raw, REL), REL);
}

function pageOf(opts = {}) {
  const docsDir = opts.docsDir || DOCS;
  const reports = REPORTS.map((rep) => {
    const campaign = campaignOf(rep);
    const caveats = caveatsOf(rep.number, campaign.rows, { docsDir });
    const cards = cardsOf(rep.number, campaign.rows, { suitesDir: opts.suitesDir, docsDir, answersOf: opts.answersOf });
    return { number: rep.number, campaign, caveats, cards };
  });
  return { html: pageHtml({ reports }), cards: reports.flatMap((r) => r.cards), reports };
}

function outputs(opts = {}) {
  const out = path.resolve(opts.out || DOCS);
  return [{ file: path.join(out, REL), text: pageOf(opts).html }];
}
function write(opts = {}) {
  const files = outputs(opts);
  for (const f of files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text); }
  return files;
}
function check(opts = {}) {
  const files = outputs(opts);
  for (const f of files) need(fs.existsSync(f.file) && fs.readFileSync(f.file, 'utf8') === f.text, 'NOTICED_PAGE_DRIFT');
  return files;
}

function main(argv = process.argv.slice(2)) {
  for (const a of argv) if (a !== '--check') C.fail('ARGUMENT');
  const isCheck = argv.includes('--check');
  const files = (isCheck ? check : write)();
  const n = (files[0].text.match(/<article class="panel note"/g) || []).length;
  console.log('noticed: the page ' + (isCheck ? 'matches' : 'written from') + ' the receipts, ' + n + ' cards');
}
module.exports = { REL, URL_PATH, WORDS, PREAMBLE, CUT, REPORTS, firstSentence, fakeOf, openingOf, suiteFor, cardsOf, caveatsOf, cardHTML, pageHtml, pageOf, outputs, write, check, main };
if (require.main === module) try { main(); } catch (e) { console.error('noticed: refused: ' + (e.code || e.message)); process.exitCode = 1; }
