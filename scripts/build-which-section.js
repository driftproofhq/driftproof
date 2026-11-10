#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {"href":"/which-section/","label":"Which section did the work?"}
// Issue 743 (spec 743): /which-section/, "Which section did the work?". Three Report 018 skills, each
// with the heading that holds the most text of its own removed by a fixed rule, run through
// `driftproof compare` by the operator.
// This page is rendered from receipts/which-section/: the manifest, the six sealed receipts and the
// three compare.md readings, each the current renderer's reading of its two sealed receipts
// (--readings re-renders them with no model call; A-743-4). Every binding is read before a line is derived:
//   - a receipt is read through readReceiptFile, must verify and validate, and its file name must
//     carry its own hash (spec 743 AC-3);
//   - the manifest's bytes and hashes must agree with each other, with sources.json, with the suite
//     file, and with the sealed subject hashes, which derive from the SKILL.md sha256 alone (AC-2);
//   - the three skills must be the rule's: a passing, non-router Report 018 receipt whose subject and
//     suite hashes the compare receipts carry (AC-1);
//   - compare.md must equal, byte for byte, what lib/compare.js renderCompareReport derives from the
//     two receipts today (AC-4). The third-party SKILL.md bytes are not in the tree, so the renderer
//     is handed a stand-in subject of the manifest's byte count and the receipt's sealed estimate.
// The per-task lines and the closing sentence are the renderer's words; the plain headline is one
// fixed map of compareCaseReading's four values. No other verdict word is written here.
//   node scripts/build-which-section.js [--check | --readings]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readReceiptFile, verifyReceiptHash, validateReceipt } = require('../lib/receipt');
const { renderCompareReport, compareCaseReading, sideNames } = require('../lib/compare');
const { mdText } = require('../lib/names');
const { suiteIdentity } = require('../lib/skill');
const { estimateTokens } = require('../lib/skillCost');
const { receiptVerdict } = require('../lib/verdict');
const { LABELS } = require('../lib/plain');
const { sha256 } = require('../lib/canonical');
const { humanModelName } = require('./model-names');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const REL = 'which-section/index.html';
const URL_PATH = '/which-section/';
const DIR = 'receipts/which-section';
const GITHUB = 'https://github.com/driftproofhq/driftproof/tree/main/';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fail = (code, detail) => { throw Object.assign(new Error(code + (detail ? ': ' + detail : '')), { code }); };
const need = (ok, code, detail) => { if (!ok) fail(code, detail); };
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => { need(Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length, 'COUNT'); return NUMBER_WORDS[n]; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The one fixed map from the differ's per-task words to the page's (spec 743 AC-4). A is the whole
// file and B the file without the section. Anything else the renderer prints is shown as not measured.
const SPREAD = 'by more than their usual spread';
const READING_WORDS = Object.freeze({
  lower: 'answers scored lower on average without the section, ' + SPREAD,
  higher: 'answers scored higher on average without the section, ' + SPREAD,
  'no clear difference': 'no clear difference',
  'too few answers': 'too few answers to tell',
});
// What was detected, never a cause (A-743-4): each phrase takes its tasks.
const HEADLINE_WORDS = Object.freeze({
  lower: (tasks) => 'answers on ' + tasks + ' scored lower on average, ' + SPREAD,
  higher: (tasks) => 'answers on ' + tasks + ' scored higher on average, ' + SPREAD,
  'no clear difference': (tasks) => 'there was no clear difference on ' + tasks,
  'too few answers': (tasks) => 'there were too few answers to tell on ' + tasks,
});
const NOT_MEASURED = (tasks) => 'nothing was measured on ' + tasks;
// The six limits, printed once before the cards (issue 743's hard rules; spec 730 AC-6; A-743-4).
const CAVEATS = Object.freeze([
  'The three tasks were drafted by Driftproof from the skill\'s own description; they are not the author\'s tests.',
  'One section was removed, so sections that matter only together are not seen.',
  'A shorter file is also a shorter file, so length moved too.',
  'This model, this judge (the model grading itself), this day.',
  'The two runs were sequential, so time-of-day conditions were not identical.',
  'No clear difference is not proof the section does nothing.',
]);
// The seventh sentence counts the tasks actually on the page (issue 758).
const chanceCaveat = (total) => 'Across these ' + word(total) + ' tasks, chance alone can produce a difference like the ones below; this page does not say whether one came from the removal, from the time between the two runs or from chance.';
const AB_DEFINED = 'A = whole file, B = file without the section';
const BLOCK_HEADING = 'What compare prints for these two folders';
const WORDS = Object.freeze({
  h1: 'Which section did the work?',
  lede: 'Three popular skills, each with its longest stretch of text under one heading removed by a fixed rule, run again on the same tasks. What moved, what did not, and how to try it yourself.',
  what: 'A skill is a file of instructions that people add to an AI assistant. A long file raises a fair question: which lines do anything? Driftproof\'s compare command runs two versions of a file on the same tasks and says whether the scores clearly moved between them.',
  example: 'This page is a worked example. We took three skills Driftproof had already measured in Report 018, removed from each the longest stretch of text under one heading by the rule below, and ran compare: the whole file against the file without that text.',
  selection: 'The skills are the first three, in Report 018\'s own order, whose result there read “' + LABELS.PASSED + '”, that are not routers (a router\'s whole text hands the task to another skill), and whose file has at least two sections below its title. No skill was chosen by hand.',
  removal: 'In each file we measured the text under every heading, from its heading line to the next heading line of any level, so a subsection is measured on its own and does not count toward the heading above it. A heading line starts with one to six # characters and a space. The title at the top and anything inside a code block do not count. The heading with the most bytes of its own text was removed, with that text. Every other byte stayed as it was.',
  listSections: 'This is not how the --list-sections option measures. It runs each section to the next heading of the same or a higher level, so a heading\'s subsections count toward its size. On two of the three files above it shows a section called Process as larger than the one removed, because Process holds it. The cards used the any-level measure. Each heading removed has no subsections, so naming it to the --without-section option on the pinned file gives the same reduced file.',
  removalLine: 'The removal rule in one line: find the heading below the title with the most bytes of its own text, from its heading line to the next heading line of any level, and remove those lines, leaving every other byte as it was.',
  cards: 'Each card gives the plain reading first, then the exact lines compare prints for the two folders, worked out again from the sealed receipts in today\'s wording. A reading is about these tasks on this day; it is not advice about the skill.',
  limits: 'Read these before the readings below. They apply to every card.',
  yours: 'The same two commands work on any Markdown rules file, such as a CLAUDE.md or AGENTS.md, with a tasks file beside it. The first lists the sections and their sizes without spending anything. The second removes one named section, runs both versions on your tasks, and writes the two receipts and the reading. Both count a heading\'s subsections as part of its section, unlike the rule the cards used.',
  yoursSkill: 'For a skill folder, make a copy, remove the section from the copy\'s SKILL.md, keep the same evals/evals.json in both, and compare the two folders. To redo one of the three above, fetch the pinned file from the repository at the commit shown, check its hash, apply the removal rule, and check the reduced file\'s hash against the card.',
  evidence: 'The six receipts, the three readings and the manifest are in the public repository. Each receipt has its own page with the two arms, what was verified and how to check the file yourself.',
});

const DOCS_HAS = (rel) => fs.existsSync(path.join(DOCS, rel));
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// A subject's content hash is sha256Files over its one bundled file, SKILL.md (evals/ is excluded),
// so it derives from the SKILL.md sha256 alone: the manifest's A and B hashes are bound to the seals.
function subjectHashOf(skillSha256) {
  const h = crypto.createHash('sha256');
  h.update('SKILL.md', 'utf8'); h.update('\0'); h.update(skillSha256); h.update('\n');
  return h.digest('hex');
}
// The renderer's stand-in (spec 743 § Design): the receipt's sealed name, unit, hash, token estimate
// and the committed suite, with a text of exactly the manifest's byte count. The renderer's own checks
// compare it with the receipt; a byte count that is not the run's reads red against compare.md.
function standIn(receipt, bytes, suiteRaw) {
  const tokens = receipt.skill.tokens;
  let chars = null;
  for (let c = 4 * tokens; c > 4 * tokens - 4; c--) if (c <= bytes && bytes <= 2 * c) { chars = c; break; }
  need(chars !== null, 'BYTES', 'no text of ' + bytes + ' bytes estimates to ' + tokens + ' tokens');
  const text = 'é'.repeat(bytes - chars) + 'a'.repeat(2 * chars - bytes);
  need(Buffer.byteLength(text) === bytes && estimateTokens(text) === tokens, 'BYTES');
  const { cases, suiteHash } = suiteIdentity(suiteRaw);
  return { name: receipt.skill.name, unit: receipt.skill.unit, contentHash: receipt.skill.content_hash, skillMd: text, suite: { suiteHash, caseCount: cases.length, cases } };
}
function readReceipt(file) {
  let r;
  try { r = readReceiptFile(file); } catch (e) { fail('RECEIPT', path.basename(file) + ': ' + e.message); }
  need(verifyReceiptHash(r), 'RECEIPT', path.basename(file) + ': receipt_hash does not verify');
  need(validateReceipt(r).valid, 'RECEIPT', path.basename(file) + ': the receipt does not validate');
  need(path.basename(file) === path.basename(file).replace(/compare-[AB]-([0-9a-f]{64})\.json$/, (m, h) => (h === r.receipt_hash ? m : '')) && /compare-[AB]-[0-9a-f]{64}\.json$/.test(file), 'RECEIPT', path.basename(file) + ': the file name is not the receipt hash');
  return r;
}
// The per-task block of a rendered reading: the lines after "Model: ..." and its blank line, up to the
// next blank line. They are the "- task: reading" lines, any draws or lost-answer lines, and the closing
// sentence, exactly as the renderer wrote them.
function blockOf(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.startsWith('Model: ')) + 2;
  need(start >= 2, 'READING', 'no Model line');
  const end = lines.indexOf('', start);
  return lines.slice(start, end < 0 ? lines.length : end);
}
// The kind of each per-task line: the two separated readings carry this pair's names, the others are fixed.
function perTaskOf(block, names) {
  const lower = compareCaseReading({ verdict: 'regression' }, names), higher = compareCaseReading({ verdict: 'improvement' }, names);
  return block.filter((l) => l.startsWith('- ')).map((l) => {
    const m = /^- (.+?): (.+)$/.exec(l); need(m, 'READING', l);
    return { id: m[1], reading: m[2], kind: m[2] === lower ? 'lower' : m[2] === higher ? 'higher' : m[2] };
  });
}
function tasksPhrase(ids, total) {
  if (ids.length === total) return 'these ' + word(total) + ' tasks';
  if (ids.length === 1) return 'the ' + ids[0] + ' task';
  return 'the ' + ids.slice(0, -1).join(', ') + ' and ' + ids.at(-1) + ' tasks';
}
// The plain headline (spec 743 AC-4): tasks grouped by the fixed map, in a fixed order, each group one
// phrase; the heading quoted as the file writes it.
function headlineRest(perTask) {
  const order = [...Object.keys(HEADLINE_WORDS), null];
  const parts = [];
  for (const key of order) {
    const ids = perTask.filter((t) => (key === null ? !HEADLINE_WORDS[t.kind] : t.kind === key)).map((t) => t.id);
    if (ids.length) parts.push((key === null ? NOT_MEASURED : HEADLINE_WORDS[key])(tasksPhrase(ids, perTask.length)));
  }
  need(parts.length, 'READING', 'no per-task line');
  return (parts.length === 2 ? parts.join(', and ') : parts.join('; ')) + '.';
}
const plainHeadline = (heading, perTask) => 'With “' + heading + '” removed, ' + headlineRest(perTask);
// The heading is quoted source text inside the headline, marked as such for every reader of the page's own words.
const headlineHtml = (heading, perTask) => 'With <span data-quote="text">“' + esc(heading) + '”</span> removed, ' + esc(headlineRest(perTask));

// The rows: one per skill, every binding read, the reading re-derived (spec 743 AC-1 to AC-4).
function readRows(opts = {}) {
  const dir = opts.dir || path.join(ROOT, DIR);
  const srcDir = DIR; // a figure names the tree's own file, where the committed copy lives
  const manifest = readJSON(path.join(dir, 'manifest.json'));
  need(Array.isArray(manifest.skills) && manifest.skills.length >= 1 && manifest.skills.length < NUMBER_WORDS.length, 'MANIFEST');
  for (const k of ['selection_rule', 'removal_rule', 'subject_rule']) need(typeof manifest[k] === 'string' && manifest[k].length > 40, 'MANIFEST', k);
  const sources = readJSON(path.join(ROOT, 'specs/408-skill-measurements/sources.json'));
  const plan = readJSON(path.join(ROOT, 'receipts/report-018/plan.json'));
  const rows = manifest.skills.map((s, index) => {
    for (const k of ['skill', 'repository', 'commit', 'skill_path', 'skill_sha256', 'suite', 'report_018_attempt_id']) need(typeof s[k] === 'string' && s[k], 'MANIFEST', k);
    need(s.removed && typeof s.removed.heading === 'string' && s.removed.heading && Number.isInteger(s.removed.level) && s.removed.level >= 1 && s.removed.level <= 6, 'MANIFEST', 'removed');
    for (const side of ['a', 'b']) for (const k of ['bytes', 'tokens_estimate']) need(Number.isSafeInteger(s[side][k]) && s[side][k] > 0, 'MANIFEST', side + '.' + k);
    const files = { a: path.join(dir, s.skill, s.a.receipt), b: path.join(dir, s.skill, s.b.receipt) };
    const receipts = { a: readReceipt(files.a), b: readReceipt(files.b) };
    const src = { a: srcDir + '/' + s.skill + '/' + s.a.receipt, b: srcDir + '/' + s.skill + '/' + s.b.receipt, manifest: srcDir + '/manifest.json' };
    // The edit is the stated edit (AC-2).
    need(s.a.bytes - s.removed_bytes === s.b.bytes, 'BYTES', s.skill + ': A bytes minus the bytes removed is not B bytes');
    need(s.removed_share_percent === Math.round(1000 * s.removed_bytes / s.a.bytes) / 10, 'SHARE', s.skill);
    need(s.a.tokens_estimate === receipts.a.skill.tokens && s.b.tokens_estimate === receipts.b.skill.tokens, 'TOKENS', s.skill + ': the sealed estimates');
    need(s.removed_tokens_estimate === receipts.a.skill.tokens - receipts.b.skill.tokens, 'TOKENS', s.skill + ': the difference of the sealed estimates');
    need(s.a.sha256 === s.skill_sha256, 'SOURCE', s.skill + ': A is not the pinned file');
    const source = sources.find((x) => x.skill === s.skill && x.repository === s.repository);
    need(source && source.commit === s.commit && source.skill_path === s.skill_path && source.skill_sha256 === s.skill_sha256, 'SOURCE', s.skill + ': sources.json disagrees');
    for (const side of ['a', 'b']) {
      need(/^[0-9a-f]{64}$/.test(s[side].sha256), 'REMOVAL', s.skill + ': ' + side + '.sha256');
      need(subjectHashOf(s[side].sha256) === receipts[side].skill.content_hash && s[side].subject_sha256 === receipts[side].skill.content_hash, 'REMOVAL', s.skill + ': ' + side + '\'s SKILL.md sha256 is not the sealed subject\'s');
      need(receipts[side].skill.unit === 'skill' && receipts[side].skill.name === receipts.a.skill.name, 'NAME', s.skill);
    }
    // The three skills are the rule's (AC-1).
    const row = plan.rows.find((x) => x.attempt_id === s.report_018_attempt_id);
    need(row && row.skill === s.skill && row.repository === s.repository && row.router === false, 'SELECTION', s.skill + ': not a non-router Report 018 row');
    const attempt = plan.execution.attempts.find((a) => a.attempt_id === row.attempt_id);
    need(attempt && attempt.protocol.skill_sha256 === s.skill_sha256 && attempt.protocol.commit === s.commit, 'SELECTION', s.skill + ': the plan protocol');
    const campaign = readJSON(path.join(ROOT, 'receipts/report-018/campaign-3', row.attempt_id + '.json'));
    need(verifyReceiptHash(campaign) && validateReceipt(campaign).valid, 'SELECTION', s.skill + ': the Report 018 receipt');
    need(receiptVerdict(campaign).verdict === 'PASSED', 'SELECTION', s.skill + ': the Report 018 receipt does not read PASSED');
    need(campaign.skill.content_hash === receipts.a.skill.content_hash, 'SELECTION', s.skill + ': A is not the Report 018 subject');
    const suiteBytes = fs.readFileSync(path.join(ROOT, s.suite));
    need(sha256(suiteBytes) === attempt.protocol.evals_sha256, 'SUITE', s.skill + ': the suite file is not the protocol\'s');
    const suiteRaw = JSON.parse(suiteBytes.toString('utf8'));
    need(suiteRaw.skill_sha256 === s.skill_sha256 && suiteRaw.repository === s.repository && suiteRaw.commit === s.commit, 'SUITE', s.skill + ': the suite names another file');
    const suite = suiteIdentity(suiteRaw);
    for (const side of ['a', 'b']) need(receipts[side].suite.suite_hash === suite.suiteHash && suite.suiteHash === attempt.protocol.suite_hash && receipts[side].suite.case_count === suite.cases.length, 'SUITE', s.skill + ': ' + side);
    need(suite.cases.length === 3, 'CAVEAT', s.skill + ': the fixed limits name three tasks');
    need(receipts.a.run.model_id === manifest.run.model && receipts.a.run.judge.model_id === manifest.run.judge && receipts.a.run.judge.samples === manifest.run.samples, 'RUN', s.skill);
    // The reading, re-derived (AC-4). A pair the renderer refuses is shown as its refusal.
    // Given only what the CLI gives it for two folders, so these are the lines the CLI prints (A-743-4).
    let markdown = null, refusal = null;
    const subjects = { a: standIn(receipts.a, s.a.bytes, suiteRaw), b: standIn(receipts.b, s.b.bytes, suiteRaw) };
    try { markdown = renderCompareReport(receipts.a, receipts.b, subjects).markdown; } catch (e) { if (!e.exitCode) throw e; refusal = e.message; }
    let block = null, perTask = [], headline = null;
    if (markdown !== null) {
      if (opts.rewriteReadings) fs.writeFileSync(path.join(dir, s.skill, s.reading || 'compare.md'), markdown);
      const committed = fs.readFileSync(path.join(dir, s.skill, s.reading || 'compare.md'), 'utf8');
      need(committed === markdown, 'READING', s.skill + ': compare.md is not what the renderer derives from the two receipts');
      block = blockOf(markdown);
      perTask = perTaskOf(block, sideNames(subjects, mdText));
      headline = plainHeadline(s.removed.heading, perTask);
    }
    const taskPage = 'tasks/' + s.repository + '/' + s.skill + '/index.html';
    const taskHtml = DOCS_HAS(taskPage) ? fs.readFileSync(path.join(DOCS, taskPage), 'utf8') : '';
    const tasks = perTask.map((t) => ({ ...t, plain: READING_WORDS[t.kind] || 'not measured', href: taskHtml.includes('id="' + esc(t.id) + '"') ? '/tasks/' + s.repository + '/' + s.skill + '/#' + t.id : null }));
    return { index, manifest: s, receipts, files, src, markdown, block, perTask, tasks, headline, refusal, evalsSha256: attempt.protocol.evals_sha256, caseCount: suite.cases.length, source };
  });
  return Object.assign(rows, { run: manifest.run, rules: { selection: manifest.selection_rule, removal: manifest.removal_rule } });
}

// ── the page ────────────────────────────────────────────────────────────────
const fig = (value, src, at, fn) => '<data value="' + esc(value) + '" data-src="' + esc(src) + '" data-at="' + esc(at) + '"' + (fn ? ' data-fn="' + fn + '"' : '') + '>' + esc(fn === 'date' ? String(value).slice(0, 10) : value) + '</data>';
const model = (id) => '<span class="model-name">' + esc(humanModelName(id)) + '</span>';
const p = (text, cls) => '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(text) + '</p>';
function cardHtml(row) {
  const s = row.manifest, at = (i) => 'skills[' + row.index + '].' + i;
  const m = row.src.manifest;
  const heading = '#'.repeat(s.removed.level) + ' ' + s.removed.heading;
  const links = [['/r/' + row.receipts.a.receipt_hash + '/', 'Receipt for the whole file'], ['/r/' + row.receipts.b.receipt_hash + '/', 'Receipt for the reduced file'], [GITHUB + DIR + '/' + s.skill + '/' + (s.reading || 'compare.md'), 'The whole reading']];
  if (DOCS_HAS('tasks/' + s.repository + '/' + s.skill + '/index.html')) links.push(['/tasks/' + s.repository + '/' + s.skill + '/', 'The tasks and scoring guides']);
  if (DOCS_HAS('skills/' + s.repository + '/' + s.skill + '/index.html')) links.push(['/skills/' + s.repository + '/' + s.skill + '/', 'About this skill']);
  if (DOCS_HAS('skills/receipts/issue-408/suites/' + row.evalsSha256 + '.json')) links.push(['/skills/receipts/issue-408/suites/' + row.evalsSha256 + '.json', 'The suite file']);
  links.push(['https://github.com/' + s.repository + '/blob/' + s.commit + '/' + s.skill_path, 'The pinned file on GitHub']);
  const reading = row.refusal !== null
    ? '<p class="section-refusal">compare refused this pair, so no reading is shown. Its words: “' + esc(row.refusal) + '”</p>'
    : '<p class="section-headline">' + headlineHtml(s.removed.heading, row.perTask) + '</p>'
      + '<h4>Task by task</h4><ul class="section-tasks">' + row.tasks.map((t) => '<li>' + (t.href ? '<a href="' + esc(t.href) + '">' + esc(t.id) + '</a>' : esc(t.id)) + ': ' + esc(t.plain) + '</li>').join('') + '</ul>'
      + '<p class="section-names">' + esc(AB_DEFINED) + '</p>'
      + '<h4>' + esc(BLOCK_HEADING) + '</h4><pre class="reading-lines" data-quote="text">' + esc(row.block.join('\n')) + '</pre>';
  return '<article class="panel section-card" data-skill="' + esc(s.skill) + '" id="' + esc(s.skill) + '">'
    + '<p class="section-repo" data-quote="name">' + esc(s.repository) + '</p>'
    + '<h3><span data-quote="name">' + esc(s.skill) + '</span></h3>'
    + reading
    + '<h4>The edit</h4><dl class="section-facts">'
    + '<dt>Section removed</dt><dd><code data-quote="heading">' + esc(heading) + '</code></dd>'
    + '<dt>Its size</dt><dd>' + fig(s.removed_bytes, m, at('removed_bytes')) + ' bytes, ' + fig(s.removed_share_percent, m, at('removed_share_percent')) + '% of the file, about ' + fig(s.removed_tokens_estimate, m, at('removed_tokens_estimate')) + ' estimated tokens (the whole file\'s estimate minus the reduced file\'s)</dd>'
    + '<dt>Whole file</dt><dd>' + fig(s.a.bytes, m, at('a.bytes')) + ' bytes, about ' + fig(s.a.tokens_estimate, m, at('a.tokens_estimate')) + ' estimated tokens; its hash (<code>sha256</code>) ' + fig(s.a.sha256, m, at('a.sha256')) + '</dd>'
    + '<dt>Reduced file</dt><dd>' + fig(s.b.bytes, m, at('b.bytes')) + ' bytes, about ' + fig(s.b.tokens_estimate, m, at('b.tokens_estimate')) + ' estimated tokens; its hash (<code>sha256</code>) ' + fig(s.b.sha256, m, at('b.sha256')) + '</dd>'
    + '<dt>Source</dt><dd>' + esc(s.repository) + ' at commit ' + fig(s.commit, m, at('commit')) + ', <span data-quote="name">' + esc(s.skill_path) + '</span></dd>'
    + '<dt>Receipts</dt><dd>whole file ' + fig(row.receipts.a.receipt_hash, row.src.a, 'receipt_hash') + ', run ' + fig(row.receipts.a.run.date_utc, row.src.a, 'run.date_utc', 'date') + '; reduced file ' + fig(row.receipts.b.receipt_hash, row.src.b, 'receipt_hash') + ', run ' + fig(row.receipts.b.run.date_utc, row.src.b, 'run.date_utc', 'date') + '</dd>'
    + '</dl>'
    + '<nav class="section-links" aria-label="' + esc(s.skill + ' sources') + '">' + links.map(([h, t]) => '<a href="' + esc(h) + '">' + esc(t) + '</a>').join('') + '</nav>'
    + '</article>';
}
function pageHtml(rows) {
  const complete = rows.filter((r) => r.refusal === null);
  const first = rows[0];
  const pairs = cap(word(complete.length)) + ' of ' + word(rows.length) + ' pairs completed' + (complete.length === rows.length ? '.' : '; compare refused ' + rows.filter((r) => r.refusal !== null).map((r) => r.manifest.skill).join(' and ') + ', and the card shows the refusal.');
  const commands = ['npx driftproof compare FILE.md --list-sections', 'npx driftproof compare FILE.md --without-section "Heading" --suite tasks.json'];
  const skillCommand = 'npx driftproof compare skill-a skill-b --models claude-haiku-5-5 --samples 5';
  const caveats = [...CAVEATS, chanceCaveat(rows.reduce((n, r) => n + r.caseCount, 0))];
  const main = '<main class="which-section-page">'
    + '<header class="which-section-hero"><p class="eyebrow">A worked example of compare</p><h1>' + esc(WORDS.h1) + '</h1>' + p(WORDS.lede, 'lede') + '</header>'
    + '<h2 id="what">What we did</h2>' + p(WORDS.what) + p(WORDS.example)
    + '<p>' + model(first.receipts.a.run.model_id) + ' answered every task and ' + model(first.receipts.a.run.judge.model_id) + ' graded each answer ' + fig(first.receipts.a.run.judge.samples, first.src.a, 'run.judge.samples') + ' times, the same arrangement as Report 018. For each skill the whole file ran first, then the reduced file. The run was made by Driftproof on ' + fig(first.receipts.a.run.date_utc, first.src.a, 'run.date_utc', 'date') + '.</p>'
    + '<h2 id="rules">How the three were chosen, and what was removed</h2>' + p(WORDS.selection) + p(WORDS.removal)
    + '<p>' + esc(WORDS.listSections).replace(/--(list-sections|without-section)/g, '<code>--$1</code>') + '</p>'
    + '<h2 id="limits">What this can and cannot say</h2>' + p(WORDS.limits) + '<ul class="page-caveats">' + caveats.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>'
    + '<h2 id="skills">The three skills</h2>' + p(WORDS.cards) + p(pairs, 'pairs-complete')
    + rows.map(cardHtml).join('')
    + '<h2 id="yours">Do this to your own file</h2>' + p(WORDS.yours)
    + '<pre class="commands"><code>' + esc(commands.join('\n')) + '</code></pre>'
    + p(WORDS.yoursSkill) + '<pre class="commands"><code>' + esc(skillCommand) + '</code></pre>'
    + p(WORDS.removalLine)
    + '<h2 id="evidence">Where the evidence is</h2>' + p(WORDS.evidence)
    + '<p><a href="' + esc(GITHUB + DIR) + '">The receipts, readings and manifest</a> · <a href="/r/">Every receipt page</a> · <a href="/tasks/">Every task we gave a skill</a> · <a href="/reports/018/">Report 018</a></p>'
    + '</main>';
  return main;
}
function pageOf(opts = {}) {
  const rows = readRows(opts);
  const { shell } = require('./build-site-pages');
  const { render } = require('./build-head-tags');
  const html = render(shell({ title: WORDS.h1 + ' | Driftproof', description: WORDS.lede, main: pageHtml(rows), head: '<link rel="stylesheet" href="' + URL_PATH + 'style.css">\n' }), REL);
  // The page's own words carry no advice to cut and no internal token (spec 743 AC-5).
  for (const text of [...CAVEATS, ...Object.values(WORDS)]) need(!/\b(delete|useless)\b/i.test(text) && !/—/.test(text), 'WORDS');
  return { html, rows };
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
  for (const f of files) need(fs.existsSync(f.file) && fs.readFileSync(f.file, 'utf8') === f.text, 'WHICH_SECTION_PAGE_DRIFT', path.relative(ROOT, f.file));
  return files;
}
function main(argv = process.argv.slice(2)) {
  for (const a of argv) if (a !== '--check' && a !== '--readings') fail('ARGUMENT', a);
  if (argv.includes('--readings')) { console.log('which-section: ' + readRows({ rewriteReadings: true }).length + ' readings re-rendered from their sealed receipts, no model called'); return; }
  const isCheck = argv.includes('--check');
  const files = (isCheck ? check : write)();
  const n = (files[0].text.match(/<article class="panel section-card"/g) || []).length;
  console.log('which-section: the page ' + (isCheck ? 'matches' : 'written from') + ' the receipts and the manifest, ' + n + ' skills');
}
module.exports = { REL, URL_PATH, DIR, WORDS, CAVEATS, READING_WORDS, HEADLINE_WORDS, subjectHashOf, standIn, blockOf, plainHeadline, headlineHtml, readRows, cardHtml, pageHtml, pageOf, outputs, write, check, main };
if (require.main === module) try { main(); } catch (e) { console.error('which-section: refused: ' + e.message); process.exitCode = 1; }
