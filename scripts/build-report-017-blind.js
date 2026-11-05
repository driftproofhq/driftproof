#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 638 (spec 638): /reports/017/blind/, the blind read on Report 017's real kept answers.
// The skill is the shortest counted skill whose pinned text is not a hand-off (A-638-1), each text
// read and pin-checked by spec 627's panelOf over readCampaign's rows; no score is read. The
// pairs are lib/blind.js pairsOf over the receipt and its answers sidecar, every verified pair, with
// prompts from the one committed suite whose recomputed hash is the receipt's. The page's island is
// lib/blind.js mountBlind's own source text behind a small adapter, written here, so the logic is
// not forked. Nothing here reads or writes a receipt, an answers file or a suite.
//   node scripts/build-report-017-blind.js [--check]
const fs = require('node:fs'), path = require('node:path');
const C = require('../specs/408-skill-measurements/campaign.cjs');
const R17 = require('./prepare-report-017.js');
const blind = require('../lib/blind');
const { placeboReading } = require('../lib/verdict');
const { applyHeadTags, beaconFor, siteConfig } = require('./build-head-tags');
const { humanModelName } = require('./model-names');
const { handsOffOnly } = require('./skill-handoff');
const ROOT = path.join(__dirname, '..');
const REL = 'reports/017/blind/index.html', ISLAND = 'islands/blind-read.js', URL_PATH = '/reports/017/blind/';
const SUITES = path.join(ROOT, 'specs/408-skill-measurements/suites');
const REPO = 'https://github.com/driftproofhq/driftproof/blob/main/';
const esc = C.esc, need = C.need;

// The page's own words (spec 638 AC-14). <skill> is the picked skill's name.
const TITLE = 'Can you tell which answer had the skill?';
const NOSCRIPT = 'The blind read needs JavaScript. Without it no pair is shown; the receipt, its kept answers and the suite are linked below.';
const descriptionOf = (skill) => 'Two AI answers to the same task: one written with the ' + skill + ' skill, one with unrelated text of the same length in its place. Guess which is which.';
const INTRO = "Report 017 gave an AI model the same tasks with a skill, and again with a placebo in the skill's place. The placebo is unrelated text cut to the same length as the skill's instruction text. Same length means the instructions given to the model, not its answers.";
const howOf = (skill) => 'Each pair below is one task from that run. One answer came from the model given the ' + skill + ' skill. The other came from the same model given the placebo instead, on the same try of that task, matched by draw number. They are shown in random order as Answer A and Answer B. Pick the one you think had the skill, then press Reveal.';
const GAME = 'This is a game of noticing. It is not a test of you, and not a measurement of the skill.';
// The cues (spec 638 AC-14, A-638-1, A-638-2), held to the pairs shown: the builder refuses
// (CUE_GROUNDING) unless every skill answer has the section and no placebo answer has it; more than
// half the skill answers open by saying they did not save the file, and more of them than of the
// placebo answers; and more than half the skill answers run longer.
const CUES = 'Every answer written with the skill has a "Suggested skills" section, which the skill\'s text asks for. Most open by saying they did not save the file the skill asks for, and most run longer than the placebo answer beside them. A right pick can come from those cues, not from the skill helping.';
const SECTION = /suggested skills/i;
const NOT_SAVED = /\b(?:didn['’]t|did not|haven['’]t|have not|can['’]t|cannot|won['’]t|will not)\s+(?:write|written|save|saved)\b/i;
const opening = (text) => String(text).split('\n').find((l) => l.trim()) || '';
const cuesHold = (pairs) => {
  const half = pairs.length / 2, count = (f) => pairs.filter(f).length;
  const opensWith = count((p) => NOT_SAVED.test(opening(p.with_answer))), opensAgainst = count((p) => NOT_SAVED.test(opening(p.against_answer)));
  return pairs.length > 0 && pairs.every((p) => SECTION.test(p.with_answer)) && !pairs.some((p) => SECTION.test(p.against_answer))
    && opensWith > half && opensWith > opensAgainst && count((p) => p.with_answer.length > p.against_answer.length) > half;
};
// Why this skill (spec 638 A-638-1), naming the shorter skills the rule passed over as hand-offs.
const listOf = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const pickLine = (skill, skipped) => 'This page uses ' + skill + ": the shortest skill counted in Report 017's headline whose text does more than hand off to another skill, chosen by its text and length alone, not by any result."
  + (skipped.length ? ' ' + listOf(skipped) + (skipped.length === 1 ? ' is' : ' are') + ' shorter, but ' + (skipped.length === 1 ? 'its whole text only tells' : 'each one\'s whole text only tells') + ' the model to call other skills.' : '');
const SOURCE = 'The page source holds which answer is which. Read the pairs before you read the source.';
// What leaves the page (A-638-2): the picks never do; the site's own visit counter, when the head
// builder puts its beacon on the page, still counts the view, and the page says so.
const PRIVATE = 'Your picks never leave this page: it sends none of them, stores nothing and calls no model.';
const COUNTER = "The site's visit counter (Cloudflare Web Analytics) still counts the page view.";
// The scope of the run (A-638-2), from the receipt's own fields and the pairs, never typed. The
// clause on saving files is held to the suite and the skill text (SCOPE_GROUNDING): every task
// prompt opens with the fixed no-tools sentence spec 408's suites share, which forbids writing files
// (anchored, as scripts/how-it-works.js reads it, rather than a span regex that is quadratic on a
// prompt with no full stop: A-638-4), asks for text only, and the skill's text asks to save one.
const NO_TOOLS = 'Do not use tools, access the network, write files, run commands or install anything.';
const forbids = (prompt) => String(prompt).startsWith(NO_TOOLS);
const TEXT_ONLY = /\banswer only in text\b/i, ASKS_TO_SAVE = /\bsave\b/i;
const dayOf = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d));
function scopeLine({ receipt, data, suite, skillText }) {
  need(suite.cases.length > 0 && suite.cases.every((c) => forbids(c.prompt) && TEXT_ONLY.test(c.prompt)) && ASKS_TO_SAVE.test(skillText), 'SCOPE_GROUNDING');
  const tasks = new Set(data.pairs.map((p) => p.id)).size;
  return 'These are ' + data.pairs.length + ' tries of ' + tasks + ' text-only tasks, answered by ' + humanModelName(receipt.run.model_id) + ' and scored by ' + humanModelName(receipt.run.judge.model_id)
    + ' on ' + dayOf(receipt.run.date_utc) + '. The tasks forbid saving files, which ' + data.skill + ' asks for. This reads this run, not ' + data.skill + ' in general.';
}
// The reading's plain words, written for the one placebo reading they are true of. Any other
// reading has none here, and the page refuses to build rather than say something untrue.
const PLAIN = {
  UNDERPOWERED: 'In plain words, this run cannot tell the skill and the placebo apart.',
  BELOW_PLACEBO: "In plain words, on at least one task the skill's answers scored clearly below the placebo's: beyond the spread between tries and by at least the report's margin.",
};
function readingWords({ reading, line }, skill) {
  const words = PLAIN[reading];
  need(words, 'READING_WORDS');
  return 'Report 017 reads ' + skill + ' against its placebo as "' + line + '". ' + words;
}
// A random reader's spread over n pairs (spec 638 AC-15): K, the smallest count fair coin flips reach
// or pass at most one time in twenty, and that exact binomial tail in percent, to one decimal.
function spreadOf(n) {
  const choose = (m, j) => { let r = 1; for (let i = 1; i <= j; i++) r = r * (m - j + i) / i; return r; };
  const tail = (k) => { let s = 0; for (let j = k; j <= n; j++) s += choose(n, j); return s / 2 ** n; };
  let k = 0; while (tail(k) > 0.05) k++;
  return 'Picking at random, a reader gets ' + k + ' or more of these ' + n + ' right about ' + (100 * tail(k)).toFixed(1) + '% of the time.';
}

// A hand-off (Maverick's ruling of 2026-11-01 UTC, issue 642): after the front matter, the skill's body
// is only one or more instructions to call the Skill tool. The rule is the shared one, spec 627
// A-627-7's `handsOffOnly`, read on the text alone (A-638-4).
const isHandoff = (text) => handsOffOnly(String(text));

// The skill (spec 638 A-638-1): the shortest non-router skill with a receipt, by the placebo block's
// skill_bytes, ties by plan order, whose pinned text is not a hand-off. Each candidate's text is
// spec 627's panel input, read and pin-checked by panelOf; a missing one refuses (PANEL_INPUT)
// rather than being passed over. No score, band or verdict is read.
function skillOf(rows, panelDir) {
  const order = rows.filter((r) => !r.router && r.receipt)
    .sort((a, b) => a.receipt.placebo.skill_bytes - b.receipt.placebo.skill_bytes || a.index - b.index);
  const skipped = [];
  for (const row of order) {
    const panel = R17.panelOf([row], panelDir);
    if (!isHandoff(panel.text)) return { ...panel, skipped };
    skipped.push(row.skill);
  }
  return C.fail('NO_SKILL');
}

// The suite whose hash, recomputed by readSuite, is the receipt's. A file name is never read.
function suiteFor(receipt, suitesDir) {
  const hits = [];
  for (const name of fs.readdirSync(suitesDir).filter((n) => n.endsWith('.json')).sort()) {
    let suite; try { suite = blind.readSuite(path.join(suitesDir, name)); } catch { continue; }
    if (suite.suiteHash === receipt.suite.suite_hash) hits.push(suite);
  }
  need(hits.length > 0, 'SUITE_BINDING');
  return hits[0];
}

// The block's data, the shape lib/view.js writes, with every verified pair.
function blindData({ receipt, archive, suitesDir = SUITES }) {
  need(archive && typeof archive === 'object' && archive.receipt_hash === receipt.receipt_hash, 'ANSWERS_BINDING');
  const suite = suiteFor(receipt, suitesDir);
  const paired = blind.pairsOf(receipt, archive, undefined, suite);
  need(paired.against === 'placebo', 'PLACEBO_ARM');
  need(paired.suite_matched === true, 'SUITE_BINDING');
  need(paired.pairs.length > 0, 'NO_PAIRS');
  blind.safeIds(paired.pairs);
  const data = { pairs: paired.pairs, against: paired.against, receipt_hash: receipt.receipt_hash, skill: String((receipt.skill || {}).name || 'unnamed skill'),
    instance: 1, reading: blind.readingLine(receipt), honesty: blind.HONESTY };
  return { data, paired, suite };
}

// The island: mountBlind as lib/blind.js writes it, and the adapter that hands it the data.
function islandSource() {
  return `// SPDX-License-Identifier: Apache-2.0
// Generated by scripts/build-report-017-blind.js (spec 638). Do not edit: run the generator.
// mountBlind below is lib/blind.js's own source text. The site allows no inline script (spec 020
// AC-32), so the mount carries the block's JSON base64 encoded; the adapter decodes it as UTF-8 into
// the element mountBlind reads, mounts, removes both, and makes each answer pane keyboard reachable.
${blind.mountBlind.toString()}

export function mount(el) {
  const bytes = Uint8Array.from(atob(el.getAttribute('data-blind-source') || ''), (c) => c.charCodeAt(0));
  el.removeAttribute('data-blind-source');
  const holder = document.createElement('div');
  holder.hidden = true;
  holder.setAttribute('data-blind-data', '');
  holder.textContent = new TextDecoder().decode(bytes);
  el.appendChild(holder);
  try { mountBlind(el); } finally { holder.remove(); }
  el.querySelectorAll('[data-blind-pane]').forEach((pane, i) => {
    pane.tabIndex = 0;
    pane.setAttribute('role', 'region');
    pane.setAttribute('aria-label', 'Answer ' + (i % 2 ? 'B' : 'A') + ' of pair ' + (Math.floor(i / 2) + 1));
  });
}
`;
}

function pageHtml({ data, paired, suite, receipt, receiptRel, answersRel, skipped, skillText }) {
  const skill = data.skill, description = descriptionOf(skill);
  need(description.length >= 50 && description.length <= 155, 'DESCRIPTION');
  need(cuesHold(data.pairs), 'CUE_GROUNDING');
  const p = (text, cls) => '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(text) + '</p>';
  const suiteRel = path.relative(ROOT, suite.file).split(path.sep).join('/');
  const counts = data.pairs.length + ' of ' + paired.pairs.length + ' verified pairs. ' + blind.dropLine(paired.dropped);
  const source = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  const receiptPage = fs.existsSync(path.join(ROOT, 'docs/r', receipt.receipt_hash, 'index.html'))
    ? '<li><a href="/r/' + receipt.receipt_hash + '/">The receipt\'s page</a></li>' : '';
  // The description is the page's own first paragraph, whole, and the head builder derives the meta
  // and OG description from it (spec 020 AC-14, A-638-3); the page declares none of its own.
  const main = '<main class="blind-page">'
    + '<h1>' + esc(TITLE) + '</h1>'
    + p(description, 'lede') + '<p><a href="/can-you-tell/">Try every skill, both models, and the fake vs nothing twist</a></p>' + p(INTRO) + p(howOf(skill)) + p(GAME) + p(blind.HONESTY, 'blind-honesty') + p(CUES, 'blind-cues')
    + p(pickLine(skill, skipped)) + p(readingWords({ reading: placeboReading(receipt).reading, line: blind.readingLine(receipt) }, skill))
    + p(scopeLine({ receipt, data, suite, skillText }), 'blind-scope') + p(counts, 'blind-counts') + p(spreadOf(data.pairs.length)) + p(SOURCE, 'blind-source-note')
    + '<section class="blind" data-island="blind-read" data-blind-source="' + source + '"><h2>The pairs</h2>'
    + '<noscript><p>' + esc(NOSCRIPT) + '</p></noscript>'
    + '<div data-blind-pairs></div><p class="detail" data-blind-status aria-live="polite"></p>'
    + '<div class="blind-nav" data-blind-nav hidden><button type="button" data-blind-prev>Previous</button><button type="button" data-blind-next>Next</button><button type="button" data-blind-reveal>Reveal</button></div>'
    + '<div data-blind-result hidden></div></section>'
    + '<h2>What stays in this page</h2>' + p(PRIVATE + (beaconFor(siteConfig().cloudflare_analytics_token) ? ' ' + COUNTER : ''), 'blind-private')
    + '<h2>Where the pairs come from</h2>'
    + p('Receipt ' + receipt.receipt_hash + '. Each answer is shown whole, and its SHA-256 is the one the receipt seals for its task, arm and draw. Each prompt is the task of the suite whose hash the receipt seals.', 'blind-receipt')
    + '<ul class="blind-sources"><li><a href="' + REPO + esc(receiptRel) + '">The receipt</a></li><li><a href="' + REPO + esc(answersRel) + '">Its kept answers</a></li><li><a href="' + REPO + esc(suiteRel) + '">The suite</a></li>' + receiptPage + '</ul>'
    + '<p><a href="/reports/017/">Back to Report 017</a></p>'
    + '</main>';
  const raw = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(TITLE) + ' | Driftproof</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="' + URL_PATH + 'style.css"></head><body>' + main + '</body></html>\n';
  // A second application normalizes the inserted chrome's boundary whitespace, as for Report 017.
  return applyHeadTags(applyHeadTags(raw, REL), REL);
}

function pageOf(opts = {}) {
  const campaign = R17.readCampaign({ campaignRoot: opts.campaignRoot || path.join(ROOT, R17.CAMPAIGN) });
  const panel = skillOf(campaign.rows, opts.panelDir || path.join(ROOT, R17.PANEL)), row = panel.row;
  const receiptFile = path.resolve(ROOT, row.src), answersFile = receiptFile.replace(/\.json$/, '-answers.json');
  need(fs.existsSync(answersFile), 'ANSWERS_BINDING');
  const receipt = row.receipt, archive = C.read(answersFile);
  const { data, paired, suite } = blindData({ receipt, archive, suitesDir: opts.suitesDir || SUITES });
  const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
  const html = pageHtml({ data, paired, suite, receipt, receiptRel: rel(receiptFile), answersRel: rel(answersFile), skipped: panel.skipped, skillText: panel.text });
  return { html, island: islandSource(), data, paired, row, receipt, receiptFile, answersFile, suiteFile: suite.file, campaign };
}

function outputs(opts = {}) {
  const out = path.resolve(opts.out || path.join(ROOT, 'docs')), built = pageOf(opts);
  return [{ file: path.join(out, REL), text: built.html }, { file: path.join(out, ISLAND), text: built.island }];
}
function write(opts = {}) {
  const files = outputs(opts);
  for (const f of files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text); }
  return files;
}
function check(opts = {}) {
  const files = outputs(opts);
  for (const f of files) need(fs.existsSync(f.file) && fs.readFileSync(f.file, 'utf8') === f.text, 'BLIND_PAGE_DRIFT');
  return files;
}

function main(argv = process.argv.slice(2)) {
  for (const a of argv) if (a !== '--check') C.fail('ARGUMENT');
  const isCheck = argv.includes('--check');
  (isCheck ? check : write)();
  console.log('report 017 blind read: page and island ' + (isCheck ? 'match the receipt' : 'written from the receipt'));
}
module.exports = { REL, ISLAND, URL_PATH, NOSCRIPT, TITLE, isHandoff, skillOf, cuesHold, CUES, PLAIN, PRIVATE, COUNTER, scopeLine,suiteFor,blindData, readingWords, spreadOf, islandSource, pageOf, outputs, write, check, main };
if (require.main === module) try { main(); } catch (e) { console.error('report 017 blind read: refused: ' + (e.code || e.message)); process.exitCode = 1; }
