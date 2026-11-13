#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 790 (spec 790): Report 019, "Skill or sugar pill, on Fable 5.2?", twenty skills on Fable 5.2:
// fourteen graded on the reply, six with tools on and graded on what Claude Code left, with Report 020
// as its own section. Every reading, count and figure comes from scripts/report-019-reader.js; this file
// only renders. The headline's total and counts lines are plan (a)'s frozen templates with N twenty
// (spec 783 A-783-4); the fourteen and six lines are spec 790 AC-7's. Spec 794: the page opens with the
// answer in plain words and one chart of the twenty, and the frozen wording folds into "How we tested".
//   node scripts/prepare-report-019.js [--out DOCS] [--stub] [--check]
const fs = require('node:fs'), path = require('node:path');
const C = require('../specs/408-skill-measurements/campaign.cjs');
const R = require('./report-019-reader.js');
const { placeboReading, armOf, receiptVerdict } = require('../lib/verdict');
const { plainOf } = require('../lib/plain');
const { sha256 } = require('../lib/canonical');
const policy = require('../lib/report-015-publication');
const O = require('./offer.js');
const { applyHeadTags } = require('./build-head-tags'), { reportRow } = require('./site-data.mjs');
const { annotateCampaignFigures } = require('./prepare-report-015');
const { humanModelName } = require('./model-names');

const ROOT = R.ROOT, REL = 'reports/019/index.html';
const TITLE = 'Skill or sugar pill, on Fable 5.2? Twenty skills against a same-length placebo';
const TESTED = 'Twenty skills on Fable 5.2, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5: fourteen graded on the reply, and six run with tools on and graded on what Claude Code left.';
const MOVED = 'a same-length placebo text';
// Spec 786's note, "Report 019's headline", verbatim (spec 790 AC-8).
const METHOD_SENTENCE = 'Six of these skills hand work to other skills or tools, so they ran with tools on, after the other fourteen, and each was scored on what Claude Code ended up doing.';
// The one ruled change to the frozen text-only note (spec 790 AC-8, the issue's one line).
const RULED_CHANGE = 'The note fixed before the text-only run counted these six differently; Maverick\'s ruling of 11 Nov 2026 counts them by their tools-on reading.';
// Spec 786's note, "Limits, said with the readings", verbatim.
const BASES = 'The six are scored on the end state; the fourteen on the reply. The two are not the same test.';
const CAVEAT = 'Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.';
const CONTEXT_MARK = 'text-only, not counted';
// Plain words first, the reader's token beside them. INCONCLUSIVE, UNDERPOWERED and NOT_MEASURED take the
// verdict library's word for the state, as the essay does (issue 661): spec 435's census reads "too few
// answers to tell" beside a count as one of Report 015's counts.
const { VERDICTS } = require('../lib/verdict');
const PLAIN = { ABOVE_PLACEBO: 'beat the fake', BELOW_PLACEBO: 'below the fake', NO_DIFFERENCE: 'no difference', INCONCLUSIVE: VERDICTS.INCONCLUSIVE.word, UNDERPOWERED: VERDICTS.UNDERPOWERED.word, NOT_MEASURED: VERDICTS.NOT_MEASURED.word };
const ARM_WORDS = { with_skill: 'with the skill', baseline: 'with no skill', placebo: 'with the placebo' };
const PAGE_URL = 'https://driftproofhq.com/reports/019/';
// The reader that produced the page, pinned on it (spec 790 AC-18).
const READER = ['scripts/prepare-report-019.js', 'scripts/report-019-reader.js', 'scripts/answer-redaction.js', 'specs/783-fable-5-2-scope/placebo/run-campaign.cjs', 'specs/783-fable-5-2-scope/boundary/run-campaign.cjs', 'specs/613-placebo-skills-report/run-campaign.cjs', 'specs/613-placebo-skills-report/tally.cjs', 'specs/408-skill-measurements/ledger.cjs', 'specs/786-tools-on-routers/world.cjs', 'lib/verdict.js', 'lib/plain.js', 'lib/receipt.js', 'scripts/offer.js'];
const esc = C.esc, need = C.need;
const fmtDate = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(d));
const usd = (v) => (Math.round(v * 100) / 100).toFixed(2);
// Display rounding (spec 792): half away from zero at two decimals, read from the decimal form.
const round2 = (v) => (Math.sign(v) * Math.round(Number((Math.abs(v) * 100).toPrecision(12))) / 100).toFixed(2);
// Three decimals, as lib/plain.js prints a receipt's means (its n3), so a glance mean reads as the row.
const n3 = (v) => v.toFixed(3);
const fig = (v, src, shown = v) => '<data value="' + esc(v) + '" data-src="' + esc(src) + '" data-at="recorded evidence" data-fn="report 019 reader" data-dp="exact">' + esc(shown) + '</data>';
const money = (v, src) => 'USD ' + fig(v, src, usd(v));
const band = (a, src) => (a ? fig(a.mean, src) + ' plus or minus ' + fig(a.sd, src) : 'no band');
const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs.at(-1));

// The frozen note's own words for a section, in a note-section element: the page names other reports
// only inside these (spec 790 AC-13).
function noteSection(note, heading) {
  const at = note.indexOf('\n## ' + heading + '\n'); need(at >= 0, 'OUTCOMES_BINDING');
  const body = note.slice(at + heading.length + 5).split(/\n## /)[0].trim();
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  return '<div class="note-section">' + body.split(/\n\n+/).filter((b) => !b.startsWith('```')).map((b) => (/^- /.test(b) ? '<ul>' + b.split(/\n(?=- )/).map((l) => '<li>' + inline(l.slice(2).replace(/\n\s*/g, ' ')) + '</li>').join('') + '</ul>' : /^\d+\. /.test(b) ? '<ol>' + b.split(/\n(?=\d+\. )/).map((l) => '<li>' + inline(l.replace(/^\d+\. /, '').replace(/\n\s*/g, ' ')) + '</li>').join('') + '</ol>' : '<p>' + inline(b.replace(/\n/g, ' ')) + '</p>')).join('') + '</div>';
}
function tasksOf(receipt) {
  const arm = (id, mode) => armOf(receipt.results.cases.find((c) => c.id === id && c.mode === mode));
  return placeboReading(receipt).cases.map((c) => ({ id: c.id, state: c.state, skill: arm(c.id, 'with_skill'), fake: arm(c.id, 'placebo') }));
}
// The reading's plain words, then its token as small text at the end of the line, never inside a
// sentence (spec 792 AC-7).
const readingHTML = (row) => esc(PLAIN[row.placebo]) + ' <code class="reading-token">' + esc(row.placebo) + '</code>';
// The spec 781 label as a chip, its class from scripts/offer.js's key (spec 792 AC-3, AC-7).
const chipHTML = (row) => '<span class="r019-chip is-' + esc(O.labelOf(row.placebo)) + '">' + esc(row.label) + '</span>';
// The row a chart row links to: a counted row by its skill, a context row apart (spec 792 AC-7).
const rowId = (row, kind) => (kind === 'context' ? 'text-only-' : 'skill-') + String(row.skill).replace(/[^a-z0-9-]/gi, '-');

// Spec 794: a reading's group, in the words the answer and the chart use, groups in this order (AC-1,
// AC-2), and the fixed plain words a skill's line says for its reading: the verdict library's placebo
// words without the rule's name (AC-4). Nothing here is a figure.
const GROUPS = [
  { key: 'beat', word: 'Beat the fake', tokens: ['ABOVE_PLACEBO'] },
  { key: 'nobetter', word: 'Did not beat the fake', tokens: ['BELOW_PLACEBO', 'NO_DIFFERENCE'] },
  { key: 'cant', word: 'Can\'t tell yet', tokens: ['UNDERPOWERED', 'INCONCLUSIVE', 'NOT_MEASURED'] },
];
const groupOf = (token) => { const g = GROUPS.find((x) => x.tokens.includes(token)); need(g, 'READING_UNKNOWN'); return g; };
const SAYS = {
  ABOVE_PLACEBO: 'Scored above the fake on at least one task, and below it on none.',
  BELOW_PLACEBO: 'Scored below the fake on at least one task.',
  NO_DIFFERENCE: 'No task differed from the fake by enough to count.',
  UNDERPOWERED: 'Not enough answers to tell it from the fake.',
  INCONCLUSIVE: 'Inconclusive against the fake.',
  NOT_MEASURED: 'Not measured against the fake.',
};
// A group's parts in a chart header, in words with no reading code and no "draws" (AC-7).
const PART = { BELOW_PLACEBO: 'scored below it', NO_DIFFERENCE: 'showed no clear difference', UNDERPOWERED: 'not enough answers', INCONCLUSIVE: 'inconclusive', NOT_MEASURED: 'not measured' };
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
// The receipt's reading against no skill, in lib/plain.js's label (a router's text row: the policy's).
const noneLabel = (row, router) => (router ? policy.LABEL.replace(': ', ', ') : plainOf(row.receipt).label);
const TOOLS_MARK = 'tools on';

// One row (spec 790 AC-3, AC-4, AC-9). Every line is the reader's or the library's, for this row's
// own receipt. kind: 'counted' (the fourteen), 'tools' (the six), 'context' (the six's text receipts).
// Spec 794 AC-4: the summary is the name line, the group word as a chip and one plain sentence; the
// label and the reading the summary held before open the row (AC-5), above what it shows today.
function rowHTML(row, kind) {
  need(Object.hasOwn(PLAIN, row.placebo), 'READING_UNKNOWN');
  const r = row.receipt, src = row.src, router = kind === 'context' && !!policy.routerLimit(r), g = groupOf(row.placebo);
  const mark = kind === 'context' ? ' <span class="context-mark">(' + CONTEXT_MARK + ')</span>' : kind === 'tools' ? ' <span class="r019-tools">' + TOOLS_MARK + '</span>' : '';
  const says = SAYS[row.placebo] + ' Compared with no skill: ' + lowerFirst(noneLabel(row, router)) + '.';
  const summary = '<summary><span class="row-skill"><span class="r019-name">' + esc(row.skill) + '</span> <span class="comparison-repository">' + esc(row.repository) + '</span>' + mark + '</span> <span class="r019-verdict is-' + g.key + '">' + esc(g.word) + '</span> <span class="r019-says">' + esc(says) + '</span></summary>';
  const was = '<p class="r019-was"><span class="row-label">Label: </span>' + chipHTML(row) + ' <span class="row-reading"><span class="row-label">Against the same-length placebo: </span>' + readingHTML(row) + '</span></p>';
  const qual = kind !== 'context' ? '' : router ? '<p class="router-qualification">' + esc(policy.REASON) + ' <a href="' + policy.AMENDMENT + '">Report 015 Amendment 1</a>.</p>' : row.handoff ? '<p class="handoff-note">' + esc(row.handoff_note) + '</p>' : '';
  const basis = kind === 'tools' ? '<p class="score-basis">Graded on the end state: each draw\'s score is its task\'s check, written before any call. The judge\'s grade of the reply is secondary and enters no reading.</p>' : kind === 'context' ? '<p class="score-basis">Graded on the reply, with tools off. The tools-on reading above is the one counted.</p>' : '';
  const reading = (v, at, text) => '<data value="' + esc(v) + '" data-src="' + esc(src) + '" data-at="' + at + '">' + esc(text) + '</data>';
  const tasks = '<ul class="placebo-tasks">' + tasksOf(r).map((t) => '<li data-task="' + esc(t.id) + '">' + esc(t.id) + ' (' + esc(t.state) + '): with the skill ' + band(t.skill, src) + '; with the same-length placebo ' + band(t.fake, src) + '.</li>').join('') + '</ul>';
  const against = receiptVerdict(r).cases.map((c) => ({ id: c.id, state: c.state, skill: armOf(r.results.cases.find((x) => x.id === c.id && x.mode === 'with_skill')), none: armOf(r.results.cases.find((x) => x.id === c.id && x.mode === 'baseline')) }));
  const verdict = router ? '<p class="verdict-sentence"><span class="row-label">Against no skill: </span>' + esc(policy.LABEL) + '.</p>'
    : '<p class="verdict-sentence"><span class="row-label">Against no skill: </span>' + reading(row.verdict, 'verdict', row.sentence) + '</p>' + (row.why && row.why !== row.sentence ? '<p class="verdict-why">' + reading(row.verdict, 'verdict why', row.why) + '</p>' : '')
      + '<ul class="verdict-tasks">' + against.map((t) => '<li data-task="' + esc(t.id) + '">' + esc(t.id) + ' (' + esc(t.state) + '): with the skill ' + band(t.skill, src) + '; without it ' + band(t.none, src) + '.</li>').join('') + '</ul>';
  const secondary = row.placebo_vs_baseline ? '<p class="secondary-reading"><span class="row-label">The placebo against no skill, shown here and not counted: </span>' + reading(row.placebo_vs_baseline, 'secondary reading', row.placebo_vs_baseline) + '</p>' : '';
  const grill = kind === 'tools' && row.world.skills.includes('grilling') ? '<p class="grilling-calls">Draws with a Skill call to grilling: ' + Object.entries(row.grilling).map(([mode, [n, of]]) => fig(n, src) + ' of ' + fig(of, src) + ' ' + esc(ARM_WORDS[mode] || mode)).join(', ') + '.</p>' : '';
  const cost = kind === 'tools' ? '<p class="attempt-cost">Recorded cost ' + money(row.cost_usd, 'receipts/report-019-tools-on/manifest.json') + ' over ' + fig(row.generations, src) + ' generations, judging included.</p>' : '';
  const seal = '<p class="receipt-ref">Receipt <code>' + r.receipt_hash + '</code></p>';
  const html = '<section class="placebo-result result-' + kind + ' r019-row" data-attempt="' + row.attempt_id + '" data-reading="' + esc(row.placebo) + '" id="' + rowId(row, kind) + '"><details class="placebo-row">' + summary + was + '<h3>' + esc(row.skill) + ' <span class="comparison-repository">' + esc(row.repository) + '</span></h3>' + qual + basis
    + '<p class="placebo-line"><span class="row-label">Against the same-length placebo: </span>' + reading(row.placebo, 'placebo reading', row.placebo_line) + '</p>' + tasks + verdict + grill + cost + secondary + seal + '</details></section>';
  if (kind === 'context') need(summary.includes(CONTEXT_MARK), 'CONTEXT_MARK');
  return html;
}

function methodHTML(m) {
  const me = m.method;
  need(me.skills.length && me.cli.length && me.copies.length, 'METHOD_BINDING');
  const text = 'What was installed, the same in every version of a skill: the called skills (' + list(me.skills) + '), the command-line tools (' + list(me.cli) + '), ' + list(me.browsers) + ', and local copies of ' + list(me.copies) + ', each served on the draw\'s own loopback. There was no live internet: each draw\'s network was none or its own loopback. The router or pointer text was the only difference between the versions: the skill\'s text, no text, or a same-length placebo. The grade was the end state Claude Code left: files, installed skills, commands, app state and Skill calls, read by a check written before any call. The judge\'s grade of the reply was secondary and entered no reading.';
  return '<p class="tools-on-method">' + esc(text) + '</p>';
}
function caveatsHTML(m) {
  const c = m.caveats, out = [], src = 'receipts/report-019-tools-on/manifest.json';
  if (c.top.shown) out.push('Every version scored at or near the top on most tasks, so there was little room for a difference: ' + fig(c.top.at_or_above, 'receipts/report-019-tools-on') + ' of ' + fig(c.top.of, 'receipts/report-019-tools-on') + ' task means, one per task and version, were ' + fig(c.top.threshold, 'scripts/report-019-reader.js') + ' or above.');
  const g = Object.entries(c.grilling).filter(([k]) => k !== 'shown');
  if (c.grilling.shown) out.push('Every version of the two pointer skills called grilling, because it was installed in all of them. Draws with a grilling call: ' + g.map(([skill, arms]) => esc(skill) + ' ' + Object.entries(arms).map(([mode, [n, of]]) => fig(n, 'receipts/report-019-tools-on') + ' of ' + fig(of, 'receipts/report-019-tools-on') + ' ' + esc(ARM_WORDS[mode] || mode)).join(', ')).join('; ') + '.');
  const planned = c.projection.generation_usd + c.projection.judged_draw_usd;
  const done = c.cost.filter((x) => Number.isInteger(x.generations));
  const over = done.filter((x) => x.cost_usd / x.generations > planned);
  const stopped = c.cost.filter((x) => x.stopped), rerun = stopped.map((s) => done.find((d) => d.skill === s.skill));
  if (over.length) out.push('Tools-on runs cost more than planned for ' + fig(over.length, src) + ' of the six. The plan projected ' + money(c.projection.generation_usd, 'specs/786-tools-on-routers/plan.json') + ' a generation and ' + money(c.projection.judged_draw_usd, 'specs/786-tools-on-routers/plan.json') + ' a judged draw, from Report 016\'s 75th percentile at the Fable 5.2 estimate. Recorded cost a generation, judging included: ' + done.map((x) => esc(x.skill) + ' ' + money(x.cost_usd / x.generations, src)).join(', ') + '.'
    + stopped.map((s, i) => ' ' + esc(s.skill) + '\'s first attempt stopped at its ceiling of ' + money(s.max_usd, 'specs/786-tools-on-routers/freeze.json') + ' after ' + money(s.cost_usd, src) + ' and was run again under a raised cap, with a ceiling of ' + money(rerun[i].max_usd, 'specs/786-tools-on-routers/plan.json') + '; both attempts\' costs are counted.').join(''));
  return out.map((t) => '<p class="tools-on-caveat">' + t + '</p>').join('');
}
function boundaryHTML(m) {
  const b = m.boundary, note = fs.readFileSync(path.join(ROOT, R.BOUNDARY, 'outcomes.md'), 'utf8');
  const effort = b.effort.catalog_default, src = (h) => (b.receipts.find((x) => x.receipt_hash === h) || {}).src || R.BOUNDARY;
  // Spec 792 AC-8: each mean and spread at display rounding, "±" for "plus or minus", the draw count
  // whole; the exact value stays in each data element and the exact text in the cell's title.
  const fig2 = (v, s) => '<data value="' + esc(v) + '" data-src="' + esc(s) + '" data-at="recorded evidence" data-fn="report 019 reader" data-dp="2">' + round2(v) + '</data>';
  const arm = (a, h) => (a ? fig2(a.mean, src(h)) + ' ± ' + fig2(a.sd, src(h)) + ', ' + fig(a.draws, src(h)) + ' draws' : 'not measured');
  const exact = (a) => (a ? a.mean + ' plus or minus ' + a.sd + ', ' + a.draws + ' draws' : 'not measured');
  const cell = (cls, arms, html) => '<td' + cls + (arms.some(Boolean) ? ' title="' + esc(arms.map(exact).join('; ')) + '"' : '') + '>' + html + '</td>';
  const rows = b.rows.map((r) => '<tr data-skill="' + esc(r.skill) + '"><th scope="row">' + esc(r.skill) + '</th>' + cell('', [r.first.with_skill], arm(r.first.with_skill, r.first.receipt_hash)) + cell('', [r.second.with_skill], arm(r.second.with_skill, r.second.receipt_hash)) + '<td class="boundary-verdict">' + esc(r.label) + '</td>' + cell(' class="boundary-context"', [r.first.baseline, r.second.baseline], arm(r.first.baseline, r.first.receipt_hash) + '; ' + arm(r.second.baseline, r.second.receipt_hash)) + '</tr>').join('');
  // Spec 794 AC-9: one plain line per row, the reader's verdict in words; the rest folds under them.
  const said = (r) => R020_WORDS[r.verdict] || r.label;
  const lines = '<p class="r020-lead">' + capital(word(b.rows.length)) + ' skills, each run on both models with the skill loaded. On ' + esc(humanModelName('claude-fable-5-2')) + ', compared with ' + esc(humanModelName('claude-fable-5-1')) + ':</p><ul class="r020-lines">' + b.rows.map((r) => '<li><span class="r020-skill">' + esc(r.skill) + '</span><span class="r020-sep">: </span>' + esc(said(r)) + '.</li>').join('') + '</ul>';
  return '<section id="report-020"><h2>Report 020: Fable 5.2 against Fable 5.1 on three skills</h2>' + lines
    + '<details class="r019-fold r020-more"><summary>The table, how it was run and its limits</summary>'
    + '<p>Its own section, outside the twenty-skill headline. Three of Addy Osmani\'s skills, one case each, run fresh on ' + esc(humanModelName('claude-fable-5-2')) + ' and ' + esc(humanModelName('claude-fable-5-1')) + ', with the skill and without it, judged by claude-haiku-5-5 at five samples. Each verdict reads the two with-skill arms against each other, in Report 011\'s labels; upward means Fable 5.2 scored above Fable 5.1.</p>'
    + '<p class="boundary-effort">No effort setting was passed: Fable 5.2 ran at its default, ' + esc(effort['claude-fable-5-2']) + ', and Fable 5.1 at its default, ' + esc(effort['claude-fable-5-1']) + '. The table reads the two models as users get them, not at the same effort.</p>'
    + '<p class="boundary-statement">' + esc(b.report_011) + '</p>'
    + '<div class="r019-table-wrap"><table class="boundary-table"><thead><tr><th scope="col">Skill</th><th scope="col">Fable 5.1, with the skill</th><th scope="col">Fable 5.2, with the skill</th><th scope="col">Verdict</th><th scope="col">Without the skill, context only (Fable 5.1; Fable 5.2)</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<p>The means without the skill are context; no verdict is read from them.</p><h3>Limits</h3>' + noteSection(note, 'Limits') + noteSection(note, 'What the report does not say') + '</details></section>';
}
// Plan (b)'s verdicts in plain words (spec 794 AC-9); any other verdict keeps the reader's label.
const R020_WORDS = { 'separated-up': 'scored higher on Fable 5.2', 'no-separation': 'no clear difference', 'separated-down': 'scored lower on Fable 5.2' };
function comment(m) {
  const b = m.boundary, e = b.effort.catalog_default;
  return [
    'Driftproof compared Claude Fable 5.2 with Claude Fable 5.1 on three of these skills, one case each, with the skill loaded, each model at its default effort (' + e['claude-fable-5-2'] + ' and ' + e['claude-fable-5-1'] + '), judged by ' + b.judge + '; upward means Fable 5.2 scored above Fable 5.1.',
    ...b.rows.map((r) => r.skill + ': ' + r.label + '.'),
    'The receipts, the draws and the limits: ' + PAGE_URL + '#report-020',
  ].join('\n') + '\n';
}
const boundaryComment = (m) => comment(m);

// ── spec 794: the answer, the chart, the skills and the caveats ──
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const word = (n) => { need(Number.isInteger(n) && n >= 0 && n < WORDS.length, 'WORD_BINDING'); return WORDS[n]; };
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// The counted twenty, each with its kind, in plan order: the fourteen, then the six.
const countedOf = (m) => [...m.fourteen.map((row) => ({ row, kind: 'counted' })), ...m.six.map((row) => ({ row, kind: 'tools' }))];
// The counted twenty in group order, plan order inside a group (AC-2, AC-4): nothing is sorted by score.
const groupedOf = (m) => GROUPS.map((g) => ({ g, rows: countedOf(m).filter((x) => g.tokens.includes(x.row.placebo)) }));
// Each group's count, read from the tally (never typed), with the receipts it counts as its source (AC-1).
function groupCounts(m) {
  const t = m.tally.total, keyOf = Object.fromEntries(R.COUNTS.map(([k, tok]) => [tok, k]));
  return groupedOf(m).map(({ g, rows }) => {
    const n = g.tokens.reduce((s, tok) => s + t[keyOf[tok]], 0);
    need(n === rows.length, 'TALLY_BINDING');
    return { g, n, rows, parts: g.tokens.map((tok) => [tok, t[keyOf[tok]]]).filter(([, c]) => c > 0), src: rows.map((x) => x.row.src).join(' ') };
  });
}
// The tasks each counted skill was read on: one number for all twenty, or the builder refuses (AC-1).
function tasksPerSkill(m) {
  const ns = [...new Set(countedOf(m).map((x) => placeboReading(x.row.receipt).cases.length))];
  need(ns.length === 1, 'TASKS_BINDING');
  return ns[0];
}
const tallyData = (v, src) => '<data value="' + esc(v) + '" data-src="' + esc(src) + '" data-at="recorded evidence" data-fn="placebo-tally" data-dp="exact">' + esc(v) + '</data>';
// The answer's sentences, in order, a group with no skill left out (AC-1). A bit is words or a count
// ({ n, src }). `first` is the first group's verb: "beat it" after the question, "beat the fake" in
// the summary. A-794-3 (PR 795, F-1): the middle group "did not beat it", never "did no better": the
// frozen Terms say no reading shows a skill does no better than the fake. Where there is room (the
// answer card, not the summary) its split follows, its parts in SPLIT's words, while two are not zero.
const SPLIT = { BELOW_PLACEBO: 'scored below it', NO_DIFFERENCE: 'showed no clear difference' };
const splitBits = (c) => (c.parts.length > 1 ? [' (', ...c.parts.flatMap(([tok, n], i) => [...(i ? [', '] : []), { n, src: c.rows.filter((x) => x.row.placebo === tok).map((x) => x.row.src).join(' ') }, ' ' + (SPLIT[tok] || PART[tok])]), ')'] : []);
const ANSWER = {
  beat: (c, first) => [{ n: c.n, src: c.src }, ' ' + first + '.'],
  nobetter: (c, first, room) => [{ n: c.n, src: c.src }, ' did not beat it', ...(room ? splitBits(c) : []), '.'],
  cant: (c) => ['For ', { n: c.n, src: c.src }, ' we can\'t tell yet.'],
};
function answerParts(m, first, room) {
  return groupCounts(m).filter((c) => c.n > 0).map((c) => ({ c, bits: ANSWER[c.g.key](c, first, room) }));
}
// scripts/build-site-pages.js's plain words for the frozen headline's last sentence (PLAIN_POINTS).
const NOT_USELESS = 'Not beating the fake does not show a skill is useless.';
const bitText = (b) => (typeof b === 'object' ? String(b.n) : b);
// The summary's one sentence (spec 794 AC-1): the llms files and the feed read a summary's first
// sentence, so the answer is whole in it.
function answerSentence(m) {
  const parts = answerParts(m, 'beat the fake', false).map(({ bits }) => lowerFirst(bits.map(bitText).join('')).replace(/\.$/, ''));
  return 'Of the ' + m.tally.total.N + ' skills, ' + (parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ', and ' + parts.at(-1)) + '.';
}
// How the twenty were graded, from the receipts: the fourteen by a judge that is not the target, the
// six by a check written before any call (spec 786), so the line says no more than they record.
function howLine(m) {
  const fourteen = m.fourteen.map((r) => r.receipt), six = m.six.map((r) => r.receipt);
  need(fourteen.every((r) => r.run.judge && r.run.judge.model_id && r.run.judge.model_id !== r.run.model_id), 'JUDGE_BINDING');
  need(six.every((r) => r.run.scoring && Array.isArray(r.run.scoring.tasks)), 'SCORE_BASIS');
  need([...fourteen, ...six].every((r) => r.run.model_id === 'claude-fable-5-2'), 'MODEL_BINDING');
  return 'On ' + humanModelName('claude-fable-5-2') + ', ' + word(tasksPerSkill(m)) + ' tasks per skill. Another model judged the answers of the ' + word(m.fourteen.length) + '; the ' + word(m.six.length) + ' run with tools on were graded on what Claude Code did, by a check written before the run.';
}

// The chart's one scale: from the lowest of the averages, down to a tenth, to 1 (AC-2). A mark's x is
// a percentage of its track, 3 to 97, so a dot at either end stays inside it.
function scaleOf(m) {
  const vs = countedOf(m).flatMap(({ row: { receipt: r } }) => [r.comparison.with_skill_score, r.placebo.comparison.placebo_score, r.comparison.baseline_score]);
  need(vs.every((v) => typeof v === 'number' && v >= 0 && v <= 1), 'SCALE_BINDING');
  const lo = Math.floor(Math.min(...vs) * 10) / 10;
  need(lo < 1, 'SCALE_BINDING');
  return { lo, x: (v) => (3 + ((v - lo) / (1 - lo)) * 94).toFixed(2), ticks: Array.from({ length: Math.round((1 - lo) * 10) + 1 }, (_, i) => Math.round(lo * 10 + i) / 10) };
}
// A small drawing in the legend, titled, for a reader with no picture (spec 020 AC-37).
const glyph = (cls, title) => '<svg class="r019-glyph ' + cls + '" width="16" height="16" aria-hidden="true"><title>' + esc(title) + '</title>'
  + (cls === 'is-tick' ? '<line class="r019-fake" x1="8" x2="8" y1="1" y2="15"/>' : cls === 'is-ring' ? '<circle class="r019-none" cx="8" cy="8" r="4.5"/>' : '<circle class="r019-dot" cx="8" cy="8" r="6"/>') + '</svg>';
const CHART_NOTE = 'Each mark is an average over all of a skill\'s tasks. The verdict is decided task by task, so a mark can point the other way.';
const COLUMNS = ['With the skill', 'With the fake', 'With no skill'];
function chartHTML(m) {
  const s = scaleOf(m), counts = groupCounts(m);
  const mean = (v, arm, src, label) => { need(typeof v === 'number' && Number.isFinite(v), 'GLANCE_BINDING'); return '<td class="r019-n" data-label="' + esc(label) + '"><data value="' + esc(v) + '" data-src="' + esc(src) + '" data-at="sealed comparison" data-fn="report 019 reader" data-dp="3" data-arm="' + arm + '">' + n3(v) + '</data></td>'; };
  const axis = '<svg class="r019-scale" height="26" aria-hidden="true"><title>' + esc('The scale, from ' + s.ticks[0].toFixed(1) + ' to ' + s.ticks.at(-1).toFixed(1)) + '</title>'
    + s.ticks.map((t) => '<line class="r019-grid" x1="' + s.x(t) + '%" x2="' + s.x(t) + '%" y1="19" y2="26"/><text class="r019-tick" x="' + s.x(t) + '%" y="13" text-anchor="middle">' + t.toFixed(1) + '</text>').join('') + '</svg>';
  const bar = ({ row, kind }, g) => {
    const r = row.receipt, w = r.comparison.with_skill_score, f = r.placebo.comparison.placebo_score, b = r.comparison.baseline_score;
    need(r.placebo.comparison.with_skill_score === w, 'GLANCE_BINDING');
    const title = row.skill + ': with the skill ' + n3(w) + ', with the fake ' + n3(f) + ', with no skill ' + n3(b);
    // Faint gridlines at the odd tenths inside the scale (0.5, 0.7, 0.9 today), under the marks.
    const grid = s.ticks.filter((t) => t < 1 && Math.round(t * 10) % 2 === 1).map((t) => '<line class="r019-grid" x1="' + s.x(t) + '%" x2="' + s.x(t) + '%" y1="0" y2="24"/>').join('');
    const track = '<svg class="r019-track" height="24" aria-hidden="true"><title>' + esc(title) + '</title>' + grid + '<line class="r019-rail" x1="3%" x2="97%" y1="12" y2="12"/>'
      + '<line class="r019-gap" x1="' + s.x(f) + '%" x2="' + s.x(w) + '%" y1="12" y2="12"/><circle class="r019-none" cx="' + s.x(b) + '%" cy="12" r="5"/>'
      + '<line class="r019-fake" x1="' + s.x(f) + '%" x2="' + s.x(f) + '%" y1="5" y2="19"/><circle class="r019-dot" cx="' + s.x(w) + '%" cy="12" r="7"/></svg>';
    return '<tr class="r019-bar is-' + g.key + '" data-attempt="' + row.attempt_id + '" data-reading="' + esc(row.placebo) + '"><th scope="row"><a href="#' + rowId(row, kind) + '">' + esc(row.skill) + '</a>' + (kind === 'tools' ? ' <span class="r019-tools">' + TOOLS_MARK + '</span>' : '') + '</th>'
      + '<td class="r019-c-scale">' + track + '</td>' + mean(w, 'with_skill', row.src, COLUMNS[0]) + mean(f, 'placebo', row.src, COLUMNS[1]) + mean(b, 'baseline', row.src, COLUMNS[2]) + '</tr>';
  };
  const groupRow = (c) => '<tr class="r019-group is-' + c.g.key + '"><th colspan="5" scope="colgroup">' + esc(c.g.word) + ' <span class="r019-group-n">' + tallyData(c.n, c.src) + '</span>'
    + (c.parts.length > 1 ? ' <span class="r019-split">' + c.parts.map(([tok, n]) => tallyData(n, c.rows.filter((x) => x.row.placebo === tok).map((x) => x.row.src).join(' ')) + ' ' + esc(PART[tok])).join(', ') + '</span>' : '')
    // On a phone the head row is not shown, so each group's header repeats the scale strip under it.
    + '<span class="r019-group-scale">' + axis + '</span></th></tr>';
  const key = '<p class="r019-key"><span class="r019-key-marks"><span class="r019-key-item">' + glyph('is-dot', 'dot') + 'The skill</span> <span class="r019-key-item">' + glyph('is-tick', 'tick') + 'The fake</span> <span class="r019-key-item">' + glyph('is-ring', 'ring') + 'No skill</span></span> '
    + '<span class="r019-key-colours">' + counts.filter((c) => c.n > 0).map((c) => '<span class="r019-key-item is-' + c.g.key + '">' + glyph('is-dot', 'dot') + esc(c.g.word) + '</span>').join(' ') + '</span></p>';
  return '<figure class="r019-chart-fig">' + key + '<table class="r019-chart"><thead><tr><th scope="col" class="r019-c-skill">Skill</th><th scope="col" class="r019-c-scale"><span class="r019-scale-label">Average score</span>' + axis + '</th>'
    + COLUMNS.map((c) => '<th scope="col" class="r019-c-n">' + esc(c) + '</th>').join('') + '</tr></thead>'
    + counts.filter((c) => c.n > 0).map((c) => '<tbody class="r019-groupbody is-' + c.g.key + '">' + groupRow(c) + c.rows.map((x) => bar(x, c.g)).join('') + '</tbody>').join('')
    + '</table><p class="r019-chart-note">' + esc(CHART_NOTE) + '</p></figure>';
}
// AC-1: the question, the answer and how it was graded, then the chart, one paper card (decision 8).
function answerHTML(m) {
  const N = m.tally.total.N, all = countedOf(m).map((x) => x.row.src).join(' ');
  need(N === countedOf(m).length, 'TALLY_BINDING');
  const line = answerParts(m, 'beat it', true).map(({ c, bits }) => '<span class="r019-part is-' + c.g.key + '">' + bits.map((b) => (typeof b === 'object' ? tallyData(b.n, b.src) : esc(b))).join('') + '</span>').join(' ');
  return '<section id="the-answer" class="r019-answer"><div class="r019-card r019-lead"><h2 class="r019-question">Did these ' + tallyData(N, all) + ' skills beat a same-length fake?</h2><p class="r019-answer-line">' + line + '</p><p class="r019-answer-how">' + esc(howLine(m)) + '</p></div>'
    + '<div class="r019-card r019-chart-card">' + chartHTML(m) + '</div></section>';
}
// AC-4: each counted skill's row, grouped as the chart is.
function skillsHTML(m) {
  return '<section id="each-skill" class="r019-skills"><h2>Each skill</h2><p class="r019-skills-lead">Open a skill for its tasks, its scores and its receipt.</p>'
    + '<div class="r019-card r019-skills-card">' + groupCounts(m).filter((c) => c.n > 0).map((c) => '<h3 class="r019-group-head is-' + c.g.key + '">' + esc(c.g.word) + '</h3><div class="placebo-results r019-rows">' + c.rows.map((x) => rowHTML(x.row, x.kind)).join('') + '</div>').join('') + '</div></section>';
}
// AC-8: four plain caveats, each said only while what it qualifies is on the page.
function caveatsPlainHTML(m) {
  const cant = groupCounts(m).find((c) => c.g.key === 'cant').n;
  const out = [
    ...(m.six.length ? ['The ' + word(m.six.length) + ' skills marked ' + TOOLS_MARK + ' ran with tools on and were graded on what Claude Code did, not on its reply. That is not the same test as the other ' + word(m.fourteen.length) + '.'] : []),
    'Beating the fake is not the same as beating no skill. Each skill\'s details show both.',
    ...(cant ? ['Can\'t tell yet means there was not enough evidence to call it. It does not mean the skill had no effect.'] : []),
    'This is one model, ' + humanModelName('claude-fable-5-2') + ', and ' + word(tasksPerSkill(m)) + ' tasks per skill. It says nothing about other models or other tasks.',
  ];
  return '<section id="keep-in-mind" class="r019-caveats"><h2>Keep in mind</h2><ul>' + out.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul></section>';
}

function body(m) {
  // Spec 792 AC-4: a counted receipt whose two with-skill scores differ is refused before anything is
  // read from it (the chart draws the first beside the fake's).
  for (const { row: { receipt: r } } of countedOf(m)) need(r.placebo && r.placebo.comparison && r.placebo.comparison.with_skill_score === r.comparison.with_skill_score, 'GLANCE_BINDING');
  const text = m.text, tools = m.tools, all = [...m.fourteen, ...m.six].map((r) => r.src).join(' ');
  const receipts = [...text.rows.map((r) => r.receipt), ...tools.rows.map((r) => r.receipt)];
  const dates = receipts.map((r) => r.run.date_utc).sort(), first = dates[0], firstSrc = [...text.rows, ...tools.rows].find((r) => r.receipt.run.date_utc === first).src;
  // Spec 794 AC-10: the title, then the answer; the meta and type lines move into the folded section.
  const head = '<h1 data-what-moved="' + esc(MOVED) + '">' + esc(TITLE) + '</h1>';
  const meta = '<p class="report-type">Placebo comparison report<span class="muted">. ' + esc(TESTED) + '</span></p><p class="report-meta">Report 019. Recorded on <data data-row="date" value="' + first.slice(0, 10) + '" data-src="' + esc(firstSrc) + '">' + fmtDate(first) + '</data>. Answering model <data data-row="model" value="claude-fable-5-2" data-src="config/models.json">' + esc(humanModelName('claude-fable-5-2')) + '</data>; judge ' + esc(humanModelName('claude-haiku-5-5')) + '.</p>';
  const t = m.tally, H = m.headline;
  const labels = 'In plain labels: of the fourteen, Keep ' + t.fourteen.labels.keep + ', Delete candidate ' + t.fourteen.labels.delete + ', Cannot tell ' + t.fourteen.labels.cannot + '; of the six, Keep ' + t.six.labels.keep + ', Delete candidate ' + t.six.labels.delete + ', Cannot tell ' + t.six.labels.cannot + '.';
  // The frozen headline, verbatim (spec 790 AC-7): the fourteen and six lines, the total line, the plain
  // counts line the home page parses, the frozen counts line and the label line.
  const headline = '<h3>The headline, as fixed before the run</h3><div class="r019-frozen"><div class="headline"><p class="headline-part">' + annotateCampaignFigures(esc(H.fourteen), all) + '</p><p class="headline-part">' + annotateCampaignFigures(esc(H.six), all) + '</p><p class="big">' + annotateCampaignFigures(esc(H.total), all) + '</p></div>'
    + '<p class="headline-counts-plain">' + annotateCampaignFigures(esc('Of the ' + t.total.N + ' skills counted: '), all) + R.COUNTS.map(([k, tok]) => '<span class="r019-count" data-reading="' + tok + '">' + annotateCampaignFigures(esc(t.total[k] + ' ' + PLAIN[tok]), all) + '</span>').join(', ') + '.</p>'
    + '<p class="headline-counts" data-fn="placebo-tally">' + annotateCampaignFigures(esc(H.counts), all) + '</p><p class="headline-labels">' + annotateCampaignFigures(esc(labels), all) + '</p></div>'
    // The notes next to the headline, word for word (spec 790 AC-8), before the first context row.
    + '<div class="r019-notes"><p class="headline-method">' + esc(METHOD_SENTENCE) + '</p><p class="headline-ruled-change">' + esc(RULED_CHANGE) + '</p><p class="headline-bases">' + esc(BASES) + '</p><p class="headline-caveat">' + esc(CAVEAT) + '</p>'
    + '<p class="headline-judge">The judge is claude-haiku-5-5 at five samples, a different model from the target. For the six, its grade of the reply is a secondary score and enters no reading.</p>'
    + '<p class="headline-effort">No effort setting was passed, so claude-fable-5-2 ran at its catalog default, ' + esc(m.effort.target) + '.</p></div>';
  const six = '<h3>The six, with tools on</h3>' + methodHTML(m) + caveatsHTML(m);
  const context = '<h3>The same six as text-only receipts</h3><p>Published and linked as context. They enter no count and no headline line.</p><div class="placebo-results r019-rows">' + m.context.map((r) => rowHTML({ ...r, handoff_note: text.handoff_note }, 'context')).join('') + '</div>';
  const n019 = m.note, n786 = fs.readFileSync(path.join(ROOT, tools.note_path), 'utf8');
  // Each pre-registered note section folds under its heading, its words unchanged (spec 792 AC-14).
  const fold = (h, body) => '<details class="r019-fold"><summary><h4>' + esc(h) + '</h4></summary>' + body + '</details>';
  const method = '<h3>Method</h3><p>These sections are the pre-registered notes, as fixed before each run: plan (a)\'s for the text-only twenty, then spec 786\'s for the six with tools on.</p><div class="r019-folds">'
    + ['What each receipt shows', 'The judge', 'The effort setting', 'The price', 'Report 019 stands alone', 'Which receipt is read', 'Terms', 'Secondary reading: the placebo against no skill'].map((h) => fold(h, noteSection(n019, h))).join('')
    + ['What runs', 'How a draw is scored', 'The readings'].map((h) => fold('With tools on: ' + h.toLowerCase(), noteSection(n786, h))).join('') + '</div>';
  const limits = '<h3>Limits</h3>' + noteSection(n019, 'Limits') + noteSection(n019, 'What the report does not say') + noteSection(n786, 'Limits, said with the readings') + '<p>The placebo corpus was chosen without reference to any task, so a placebo text can still bear on a task by chance.</p><p>Unkeyed seals and retained outputs permit checking internal consistency; they do not authenticate an origin.</p>';
  const s = m.spend, redacted = text.rows.filter((r) => r.redacted);
  const record = '<section id="campaign-run-record"><h3>Run record</h3>'
    + '<p>Spend, read from the records. Report 019 text-only ' + money(s.text_usd, 'specs/783-fable-5-2-scope/chains.json') + ': ' + money(s.text_read_usd, R.TEXT) + ' in the chain read here and ' + money(s.text_outside_usd, 'specs/783-fable-5-2-scope/chains.json') + ' in stopped chains recorded in <code>specs/783-fable-5-2-scope/chains.json</code>. With tools on ' + money(s.tools_usd, R.TOOLS) + ': ' + money(s.tools_campaign_usd, R.TOOLS + '/manifest.json') + ' in the campaign manifest, the stopped attempt included, and ' + money(s.tools_smoke_usd, 'specs/786-tools-on-routers/freeze.json') + ' in smoke runs recorded in <code>specs/786-tools-on-routers/freeze.json</code>. Report 020 ' + money(s.boundary_usd, R.BOUNDARY) + '. Recorded costs are API-equivalent estimates, not a subscription invoice, with claude-fable-5-2 priced at an estimate of USD 10 input and USD 50 output per million tokens. Metered spend on the subscription surface was USD 0.</p>'
    + '<p>The text-only twenty: plan SHA-256 <code>' + text.plan_sha256 + '</code>, pre-registered note SHA-256 <code>' + text.note_sha256 + '</code>, run at <code>' + esc(text.code_head) + '</code>, runner ' + esc(text.runner_version) + ', Claude Code ' + esc(text.claude_code_version) + '.</p><ol class="campaign-runs">' + text.manifests.map((x) => '<li><code>' + esc(x.file) + '</code>, SHA-256 <code>' + x.sha256 + '</code></li>').join('') + '</ol>'
    + '<p>The six with tools on: plan SHA-256 <code>' + tools.plan_sha256 + '</code>, pre-registered note SHA-256 <code>' + tools.note_sha256 + '</code>, manifest <code>' + esc(tools.manifest.file) + '</code>, SHA-256 <code>' + tools.manifest.sha256 + '</code>. Each attempt ran from the source branch at the commit its start records, runner ' + esc(tools.runner_version) + ', Claude Code 2.1.311:</p><ol class="campaign-starts">' + tools.starts.map((x) => '<li>commit <code>' + x.head + '</code>, plan SHA-256 <code>' + x.plan_sha256 + '</code></li>').join('') + '</ol>'
    + '<p>Report 020: plan SHA-256 <code>' + m.boundary.plan_sha256 + '</code>.</p><ol class="campaign-runs">' + m.boundary.manifests.map((x) => '<li><code>' + esc(x.file) + '</code>, SHA-256 <code>' + x.sha256 + '</code>' + (x.head ? ', commit <code>' + x.head + '</code>' : '') + '</li>').join('') + '</ol>'
    + (redacted.length ? '<p>' + redacted.map((r) => 'The retained answers of ' + esc(r.skill) + '\'s text-only receipt show the eval account\'s home directory as <code>~/</code> in ' + fig(r.redacted, r.src.replace(/\.json$/, '-answers.json')) + ' answers. The reader restores the original from the account name and checks it against the hash the receipt seals.').join(' ') + '</p>' : '')
    + '<p>Read and built by:</p><ul class="reader-pins">' + READER.map((f) => '<li><code>' + f + '</code>, SHA-256 <code>' + sha256(fs.readFileSync(path.join(ROOT, f))) + '</code></li>').join('') + '</ul></section>';
  const link = (src, label) => '<li><a href="https://github.com/driftproofhq/driftproof/blob/main/' + esc(src) + '">' + esc(label) + '</a></li>';
  const receiptsList = '<h2>Receipts</h2><ul>' + m.fourteen.map((r) => link(r.src, r.skill + ', graded on the reply')).join('') + m.six.map((r) => link(r.src, r.skill + ', with tools on')).join('') + m.context.map((r) => link(r.src, r.skill + ', ' + CONTEXT_MARK.replace(', not counted', '') + ' context')).join('') + m.boundary.receipts.map((r) => link(r.src, 'Report 020, ' + path.basename(r.src, '.json'))).join('') + '</ul>';
  // AC-10: everything else in one folded section, closed; the receipts list after it, unfolded.
  const how = '<section id="how-we-tested" class="r019-how-section"><details class="r019-how"><summary><h2>How we tested</h2><span class="r019-how-what">The headline as fixed before the run, the full method, the judge, the price, the run record and the limits.</span></summary>'
    + meta + headline + six + context + method + limits + record + '</details></section>';
  return head + answerHTML(m) + skillsHTML(m) + caveatsPlainHTML(m) + boundaryHTML(m) + how + receiptsList;
}

// Spec 125's summary under the title (spec 794 AC-1, AC-11, decision 1): the answer's counts in the
// answer's words, how it was graded, and its limits, in plain words; the frozen headline is not here.
function summaryRow(m) {
  const tasks = word(tasksPerSkill(m));
  const points = [
    ['What we tested.', capital(word(m.tally.total.N)) + ' skills on ' + humanModelName('claude-fable-5-2') + ', ' + tasks + ' tasks each, with the skill, with no skill and with a same-length fake.'],
    // The home page's plain line for the frozen "is not shown to do no better than it" (A-794-3).
    ['What we found.', answerSentence(m) + ' ' + NOT_USELESS],
    ['How it was graded.', 'Another model judged the ' + word(m.fourteen.length) + '. The ' + word(m.six.length) + ' run with tools on were graded on what Claude Code did, by a check written before the run.'],
    ['What it doesn\'t show.', 'Beating the fake is not beating no skill. It does not show how these skills do beyond ' + tasks + ' tasks each, or how Fable 5.2 compares with other models.'],
  ];
  return { points: points.map(([lead, text]) => ({ lead, text, sources: [{ file: 'docs/' + REL, quote: text }] })) };
}

function buildReport(opts = {}) {
  const m = opts.model || R.readReport({ stub: !!opts.stub });
  const raw = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(TITLE) + ' | Driftproof</title><link rel="stylesheet" href="/style.css"></head><body><main class="report shaped r019-page">' + body(m) + '</main></body></html>\n';
  const row = reportRow('019', { pageRel: 'docs/' + REL, html: raw });
  return { html: applyHeadTags(applyHeadTags(raw, REL, undefined, undefined, [row]), REL, undefined, undefined, [row]), summary: summaryRow(m), model: m };
}
function outputs(opts) {
  const out = path.resolve(opts.out || path.join(ROOT, 'docs'));
  if (opts.stub) need(!(out + path.sep).startsWith(path.join(ROOT, 'docs') + path.sep) && out !== path.join(ROOT, 'docs'), 'OUTPUT_DIRECTORY');
  const built = buildReport(opts), summaryFile = path.join(out, 'data/report-summaries.json');
  const summary = JSON.parse(fs.readFileSync(fs.existsSync(summaryFile) ? summaryFile : path.join(ROOT, 'docs/data/report-summaries.json'), 'utf8'));
  summary.reports['019'] = built.summary;
  return { page: path.join(out, REL), html: built.html, summaryFile, summary: JSON.stringify(summary, null, 2) + '\n', built };
}
function writeReport(opts) {
  const first = outputs(opts); fs.mkdirSync(path.dirname(first.summaryFile), { recursive: true }); fs.writeFileSync(first.summaryFile, first.summary);
  const o = outputs({ ...opts, model: first.built.model }); need(o.summary === first.summary, 'REPORT_SUMMARY_DRIFT'); fs.mkdirSync(path.dirname(o.page), { recursive: true }); fs.writeFileSync(o.page, o.html); return o;
}
function checkReport(opts = {}) { const o = outputs(opts); need(fs.existsSync(o.page) && fs.readFileSync(o.page, 'utf8') === o.html, 'REPORT_DRIFT'); need(fs.existsSync(o.summaryFile) && fs.readFileSync(o.summaryFile, 'utf8') === o.summary, 'REPORT_SUMMARY_DRIFT'); return o; }

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--check') o.check = true; else if (a === '--stub') o.stub = true; else if (a === '--out') { const v = argv[++i]; need(v && !v.startsWith('--'), 'ARGUMENT'); o.out = v; } else C.fail('ARGUMENT'); }
  return o;
}
function main(argv = process.argv.slice(2)) {
  const o = parse(argv);
  if (o.stub) need(o.out && !(path.resolve(o.out) + path.sep).startsWith(path.join(ROOT, 'docs') + path.sep) && path.resolve(o.out) !== path.join(ROOT, 'docs'), 'OUTPUT_DIRECTORY');
  const done = o.check ? checkReport(o) : writeReport(o), t = done.built.model.tally;
  console.log('report 019: page and summary ' + (o.check ? 'match' : 'written from') + ' ' + (t.fourteen.N + t.six.N) + ' counted receipts (' + t.fourteen.N + ' on the reply, ' + t.six.N + ' with tools on) and ' + done.built.model.boundary.rows.length + ' Report 020 pairs; headline shape ' + t.total.shape);
}

module.exports = {
  TITLE, REL, READER, METHOD_SENTENCE, RULED_CHANGE, BASES, CAVEAT, CONTEXT_MARK, PLAIN,
  readToolsOn: R.readToolsOn, readReport: R.readReport, shapeOf: R.shapeOf, boundaryComment,
  rowHTML, buildReport, summaryRow, outputs, writeReport, checkReport, parse, main,
};
if (require.main === module) try { main(); } catch (e) { console.error('report 019: refused: ' + (e.code || e.message)); process.exitCode = 1; }
