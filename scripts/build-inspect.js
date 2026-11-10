#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {"href":"/inspect/","label":"Inspect these instructions"}
// Issue 725 (spec 725): /inspect/, "Inspect these instructions". The browser for the inspect scanner
// (spec 724): a visitor pastes or drops a skill file, a rules file or a prompt, and the island reads it
// in the page with the published module, docs/import-core/inspect.mjs. Nothing leaves the page.
//
// This builder writes the static page: the words, the command, the class list in plain words, in the
// pattern file's order, and the price table the island reads its prices from, one row per registered
// model through the same priceFor the CLI uses, dated by the registry's newest commit. The marker above
// registers the page with scripts/reader-pages.js, so the footer, README.md, llms.txt,
// llms-full.txt, the sitemaps and the page dates list it with no hand edit.
//   node scripts/build-inspect.js [--check]
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { INSPECT_CLOSING } = require('../lib/import-core/inspect.cjs');
const { loadRegistry } = require('../lib/models');
const { priceFor } = require('../lib/cost');
const { humanModelName } = require('./model-names');
const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const REL = 'inspect/index.html', URL_PATH = '/inspect/';
const PATTERNS = path.join(ROOT, 'lib/import-core/inspect-patterns.json');
const REGISTRY = 'config/models.json';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };

// The page's own words (spec 725 AC-4). The lede is also the description the head builder derives.
// The page inspects and reads; it never says safe, secure, verified, score, grade or rank.
const COMMAND = 'npx driftproof inspect <file>';
const WORDS = {
  h1: 'Inspect these instructions',
  lede: 'Got custom instructions, a prompt or a skill from someone else? Paste it here before ChatGPT or Claude reads it, and see every character, hidden ones too.',
  stays: 'Nothing you paste leaves this page. Your browser reads the text here, sends it nowhere and stores nothing. No model is called.',
  needsScript: 'Reading in the page needs JavaScript. The same check runs on your computer from the command line:',
  aboutHeading: 'What the check points out',
  aboutIntro: 'Each kind below is a place to look rather than a judgement about the file. The check reads the text as written and decodes nothing.',
  costHeading: 'The cost estimate',
  costBefore: 'The page counts lines, bytes and estimated tokens, then shows what sending this text with every call would cost per 1,000 calls at each registered model\'s input price. Every figure is an estimate, for the input text only. Prices are Driftproof\'s registry prices in US dollars per million input tokens, last changed on ',
  costAfter: '.',
  planNote: 'On a monthly chat plan you do not pay this per message. These figures matter if you pay per call.',
  priceCaption: 'The prices this page uses, one row per model',
  foundHeading: 'If it finds something',
  // AC-4 bars the word a reader may expect here: a clean result is "not a guarantee" (A-725-3).
  found: [
    'Hidden characters or long encoded runs: check what each one is for before you use the text, and ask the person who sent it if you cannot tell. Some emoji hold a hidden joiner or selector.',
    'Lines that ask the assistant to hide something from you, read keys or send data elsewhere: delete them, or do not use the file.',
    'A clean result is not a guarantee. Read every line yourself before you use the file.',
  ],
  notHeading: 'What this page does not do',
  notDo: 'It does not follow links, upload files, call a model or look the file up anywhere. It does not measure whether the instructions help.',
  nextHeading: 'Where to go next',
  tryBefore: 'To find out whether the instructions make any difference, in your own chat window and with nothing to install, open ',
  tryLink: 'Try it yourself',
  tryAfter: '.',
  pluginBefore: 'In Claude Code, the Driftproof plugin runs this same check on a local file or skill folder with ',
  pluginCommand: '/driftproof:inspect',
  pluginAfter: '. The check itself calls no model; Claude Code shows its report in your session.',
  measure: 'To see the same-length fake that stands in for your file, open ',
  measureLink: 'See your file\'s fake',
  measureAfter: '. To measure the file, run ',
  measureCommand: 'npx driftproof run <path> --suite tasks.json --placebo',
  measureEnd: ' on your computer; a measurement run can call a model and incur costs.',
};
// Each class of the pattern file, with a plain label and one plain sentence (spec 725 AC-4). The
// island reads these from the list's attributes, so the page with and without script says the same.
const CLASSES = {
  invisible: { label: 'Hidden characters', plain: 'Characters you cannot see, such as zero-width spaces, joiners and marks that change the direction of text. The page shows each one as a code in curly braces.' },
  encoded: { label: 'Long encoded runs', plain: 'A run of more than 128 letters, digits and symbols that may hold encoded text. Nothing is decoded.' },
  url: { label: 'Web addresses', plain: 'A line that names a web address. Nothing is fetched.' },
  tools: { label: 'Tool permissions', plain: 'A front-matter key at the top of the file that grants or denies tools to the assistant.' },
  duplicate: { label: 'Repeated lines', plain: 'A line that already appeared, word for word, earlier in the text. Markdown markers such as code fences and table rulers do not count.' },
  shell: { label: 'Shell commands', plain: 'A command that downloads, decodes or runs something, or pipes text into a shell.' },
  agent: { label: 'Instructions to the assistant', plain: 'A few fixed English phrasings that ask the assistant to keep something from you, ignore other instructions, read keys or files that may hold credentials, or send data elsewhere. Reworded or translated text is not caught.' },
};

// The classes in the pattern file's order of first appearance: the keyed kinds, then the phrase classes.
function classOrder(file = PATTERNS) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  const order = [...new Set([...Object.keys(p).filter((k) => p[k] && typeof p[k] === 'object' && typeof p[k].message === 'string'), ...p.phrases.map((r) => r.class)])];
  need(order.length === Object.keys(CLASSES).length && order.every((c) => CLASSES[c]), 'CLASS_LABELS');
  return order;
}
// The prices the island supplies: every registered model, in the registry's order, through priceFor, as
// lib/inspect.js supplies them to the CLI; dated by the registry's newest commit (its author date).
function pricesSnapshot(root = ROOT) {
  // One row per registered model, as the CLI prints. A name an earlier row already shows adds the registry id,
  // so no two rows read the same (A-725-3).
  const shown = new Set();
  const rows = loadRegistry().models.map((m) => {
    const human = humanModelName(m.id), name = shown.has(human) ? human + ' (' + m.id + ')' : human;
    shown.add(human);
    return { model: m.id, name, input: priceFor(m.id).input };
  });
  need(rows.length > 0 && rows.every((r) => Number.isFinite(r.input) && r.input >= 0), 'PRICES');
  const date = execFileSync('git', ['-C', root, 'log', '-1', '--format=%as', '--', REGISTRY], { encoding: 'utf8' }).trim();
  need(/^\d{4}-\d{2}-\d{2}$/.test(date), 'REGISTRY_DATE');
  return { rows, date };
}

function pageHtml(opts = {}) {
  const { shell } = require('./build-site-pages');
  const { applyHeadTags } = require('./build-head-tags');
  const p = (text, cls) => '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(text) + '</p>';
  need(WORDS.lede.length >= 50 && WORDS.lede.length <= 155, 'DESCRIPTION');
  const prices = opts.prices || pricesSnapshot();
  const list = classOrder().map((c) => '<li data-class="' + esc(c) + '" data-label="' + esc(CLASSES[c].label) + '" data-plain="' + esc(CLASSES[c].plain) + '"><strong>' + esc(CLASSES[c].label) + '.</strong> ' + esc(CLASSES[c].plain) + '</li>').join('');
  const rows = prices.rows.map((r) => '<tr data-model="' + esc(r.model) + '" data-name="' + esc(r.name) + '" data-input="' + esc(r.input) + '"><th scope="row">' + esc(r.name) + '</th><td>' + esc(r.input) + '</td></tr>').join('');
  const main = '<main class="drop-results-page inspect-page">'
    + '<h1>' + esc(WORDS.h1) + '</h1>' + p(WORDS.lede, 'lede') + p(WORDS.stays)
    + '<div class="inspect-reader" data-island="inspect">'
    + '<div class="inspect-fallback" data-inspect-fallback>' + p(WORDS.needsScript) + '<pre><code>' + esc(COMMAND) + '</code></pre></div>'
    + '<section class="inspect-about" data-inspect-about>'
    + '<h2 id="what-it-points-out">' + esc(WORDS.aboutHeading) + '</h2>' + p(WORDS.aboutIntro)
    + '<ul class="inspect-classes" data-inspect-classes>' + list + '</ul>'
    + '<h2 id="cost">' + esc(WORDS.costHeading) + '</h2>'
    + '<p>' + esc(WORDS.costBefore) + '<time data-inspect-prices-date datetime="' + esc(prices.date) + '">' + esc(prices.date) + '</time>' + esc(WORDS.costAfter) + '</p>'
    + '<p data-inspect-plan>' + esc(WORDS.planNote) + '</p>'
    + '<table class="inspect-prices" data-inspect-prices><caption>' + esc(WORDS.priceCaption) + '</caption><thead><tr><th scope="col">Model</th><th scope="col">US dollars per million input tokens</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '</section></div>'
    + '<p class="inspect-closing" data-inspect-closing>' + esc(INSPECT_CLOSING) + '</p>'
    + '<h2 id="if-it-finds-something">' + esc(WORDS.foundHeading) + '</h2>' + WORDS.found.map((t) => p(t)).join('')
    + '<h2 id="not">' + esc(WORDS.notHeading) + '</h2>' + p(WORDS.notDo)
    + '<h2 id="next">' + esc(WORDS.nextHeading) + '</h2>'
    + '<p>' + esc(WORDS.tryBefore) + '<a href="/try-it/">' + esc(WORDS.tryLink) + '</a>' + esc(WORDS.tryAfter) + '</p>'
    + '<p>' + esc(WORDS.pluginBefore) + '<code>' + esc(WORDS.pluginCommand) + '</code>' + esc(WORDS.pluginAfter) + '</p>'
    + '<p>' + esc(WORDS.measure) + '<a href="/placebo/">' + esc(WORDS.measureLink) + '</a>' + esc(WORDS.measureAfter) + '<code>' + esc(WORDS.measureCommand) + '</code>' + esc(WORDS.measureEnd) + '</p>'
    + '</main>';
  const raw = shell({ title: WORDS.h1 + ' | Driftproof', description: WORDS.lede, head: '<link rel="stylesheet" href="' + URL_PATH + 'style.css">\n', main });
  // A second application normalizes the inserted chrome's boundary whitespace, as the other reader pages do.
  return applyHeadTags(applyHeadTags(raw, REL), REL);
}

function outputs(opts = {}) {
  const out = path.resolve(opts.out || DOCS);
  return [{ file: path.join(out, REL), text: pageHtml(opts) }];
}
function write(opts = {}) {
  const files = outputs(opts);
  for (const f of files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text); }
  return files;
}
function check(opts = {}) {
  const files = outputs(opts);
  for (const f of files) need(fs.existsSync(f.file) && fs.readFileSync(f.file, 'utf8') === f.text, 'INSPECT_PAGE_DRIFT');
  return files;
}
function main(argv = process.argv.slice(2)) {
  for (const a of argv) need(a === '--check', 'ARGUMENT');
  const isCheck = argv.includes('--check');
  const files = (isCheck ? check : write)();
  const n = (files[0].text.match(/<tr data-model=/g) || []).length;
  console.log('inspect: the page ' + (isCheck ? 'matches' : 'written from') + ' the module, the pattern file and the registry, ' + n + ' price rows');
}
module.exports = { REL, URL_PATH, COMMAND, WORDS, CLASSES, classOrder, pricesSnapshot, pageHtml, outputs, write, check, main };
if (require.main === module) try { main(); } catch (e) { console.error('inspect: refused: ' + (e.code || e.message)); process.exitCode = 1; }
