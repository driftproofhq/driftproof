#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/report-corrections.js - spec 161's dated notes on Reports 001 to 008, and the three
// judge cost corrections on Report 007.
//
// WHAT IT ADDS, and nothing else. A published report is amended with a dated record and never
// edited silently (CONSTITUTION invariant 4), so this script only INSERTS, and every inserted
// byte is one of these, each read back by `stripInterimLines` for the gates that hold the rest of a page:
//   - Report 007: one correction line directly under each of the three judge cost figures. The
//     figure keeps the value it was published at; the line gives the total counted over every
//     draw, the same figure spec 158 makes the receipt record.
//   - Reports 001 to 005, 007 and 008: one note at the end of the headline block, saying the
//     headline counts include receipts that the receipt pages mark Not measured, and that
//     corrected counts follow in spec 159.
//   - the same reports: one dated entry appended to the page's Amendments, naming the note.
//     Reports 002 and 004 had no Amendments section, so the entry starts one.
//
// WHERE THE NOTE IS TRUE. Not on every page. `NOTE_ON` below is the table, and `notApplicable`
// holds the reason for each page that does not take it. `checkNote` reads every receipt a page
// links with the badge's own rule (`receiptVerdict`) and refuses to write the note on a page
// where one of them is not Not measured, so the claim is read from the receipts and not typed.
//
// WHERE THE FIGURES COME FROM. The corrected totals are computed here from each receipt's
// `draws[].judge_usage`, priced at the receipt's own frozen snapshot by the same `computeEconomics`
// the page's figure comes from, with the one field the defect read (the case-level judge usage,
// which is the last draw's) replaced by the sum over the draws. They must equal `EXPECTED`, the
// three values the operator gave on 3 Oct 2026; if a computed value differs, this throws and
// prints neither.
//
//   node scripts/report-corrections.js            write the notes, the corrections and the md mirror
//   node scripts/report-corrections.js --check    exit 1 if any page or the mirror is not as written
//
// IDEMPOTENT. A page that already carries a note, a correction or an entry is left as it is, and
// a page that carries one that is not the one this script writes is refused.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATE = '2026-10-03';

// The three corrected totals, as the operator gave them. A tripwire and not a source: the values
// printed come from the receipts.
const EXPECTED = { 'code-review-and-quality': '8.047195', 'git-workflow-and-versioning': '7.634930', 'writing-plans': '13.737220' };

// Reports that take the note, with the version label of the Amendments entry each gets (the page's
// last label, plus one) and the reason the other reports do not.
const ENTRY_VERSION = { '001': 'v1.4', '002': 'v1.1', '003': 'v1.2', '004': 'v1.1', '005': 'v1.4', '007': 'v1.3', '008': 'v1.2' };
const NOTE_ON = Object.keys(ENTRY_VERSION);
const notApplicable = {
  '006': 'its headline reads no verdict count: "none of the three returned a verdict", which is what its receipts read, so there is no count for spec 159 to correct',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── the figures ───────────────────────────────────────────────────────────────

// The judge usage of one case row summed over its draws. A row with no per-draw judge usage has
// nothing to sum: the defect cannot have under-counted it, and it is returned as it was.
function usageOverDraws(row) {
  const used = ((row.generation && row.generation.draws) || []).map((d) => d.judge_usage).filter(Boolean);
  if (!used.length) return row.judge_usage;
  return {
    input_tokens: used.reduce((a, u) => a + Number(u.input_tokens || 0), 0),
    output_tokens: used.reduce((a, u) => a + Number(u.output_tokens || 0), 0),
  };
}

// { published, corrected, rows } for one receipt: the figure the page prints, and the total over
// every draw, each to six places as the page prints its figures.
function judgeCost(receiptRel, judgeModel) {
  const { computeEconomics } = require('../lib/value');
  const { caseFailed } = require('../lib/receipt');
  const receipt = JSON.parse(read(receiptRel));
  const price = {
    modelId: receipt.run.model_id, judgeModelId: judgeModel, pricingSnapshot: receipt.run.pricing_snapshot,
    surface: receipt.run.surface, meteredSurface: false,
  };
  const published = computeEconomics({ cases: receipt.results.cases, ...price }).judge_overhead;
  const summed = receipt.results.cases.map((c) => (caseFailed(c) ? c : { ...c, judge_usage: usageOverDraws(c) }));
  const corrected = computeEconomics({ cases: summed, ...price }).judge_overhead;
  return {
    published: published.total_cost_usd.toFixed(6),
    corrected: corrected.total_cost_usd.toFixed(6),
    rows: corrected.case_rows_measured,
  };
}

// The slug a receipt path names, which keys EXPECTED.
const slugOf = (receiptRel) => Object.keys(EXPECTED).find((s) => path.basename(receiptRel).startsWith(`${s}-`));

// ── what the badge reads for the receipts a page links ───────────────────────

function linkedReceipts(html) {
  const set = new Set();
  for (const m of html.matchAll(/(?:blob|tree)\/main\/(receipts\/[^"#?]+?\.json)/g)) set.add(m[1]);
  for (const m of html.matchAll(/href="(?:\.\.\/)+(receipts\/[^"#?]+?\.json)"/g)) set.add(m[1]);
  return [...set].sort();
}

function badgeReadings(html) {
  const { receiptVerdict } = require('../lib/verdict');
  const tally = {};
  const files = linkedReceipts(html);
  for (const f of files) {
    const v = receiptVerdict(JSON.parse(read(f))).verdict;
    tally[v] = (tally[v] || 0) + 1;
  }
  return { files, tally };
}

// The note is written only where every receipt the page links reads Not measured.
function checkNote(n, html) {
  if (!NOTE_ON.includes(n)) throw new Error(`Report ${n} takes no note: ${notApplicable[n] || 'it is not listed'}`);
  const { files, tally } = badgeReadings(html);
  if (!files.length || Object.keys(tally).some((k) => k !== 'NOT_MEASURED')) {
    throw new Error(`Report ${n}: the receipts it links do not all read Not measured (${JSON.stringify(tally)}), so the note is not true of it`);
  }
  return files.length;
}

// ── the words ─────────────────────────────────────────────────────────────────

const noteHtml = () => `    <p class="muted interim-note" id="interim-note"><strong>Note, ${DATE}.</strong> The headline counts on this page include receipts whose receipt pages mark them Not measured. Corrected counts follow in spec 159.</p>\n`;
const noteMd = () => `**Note, ${DATE}.** The headline counts in this report include receipts whose receipt pages mark them Not measured. Corrected counts follow in spec 159.`;

const correctionHtml = (corrected) => `  <p class="muted judge-correction"><strong>Correction, ${DATE}.</strong> This judge cost was counted from the last draw only. Counted over the judge usage the receipt records on its draws (a draw with no judge usage adds nothing), it is $${corrected}. The figure above is left as it was published. The fix is spec 158.</p>\n`;

function entryBody(n, html, extra) {
  const files = checkNote(n, html);
  return `<strong>${ENTRY_VERSION[n]} &middot; ${DATE}</strong>. <strong>This entry adds a dated note under the headline; no earlier text is changed, and no figure, verdict token, table value or receipt reference changes.</strong> The note says the headline counts on this page include receipts whose receipt pages mark them Not measured, and that corrected counts follow in spec 159. It was written after each of the ${files} receipts this page links was read with the badge's own rule, and all ${files} read Not measured.${extra || ''}`;
}

function extra007(cells) {
  const lines = cells.map((c) => `<code>${esc(c.slug)}</code>@<code>${esc(c.model)}</code> from $${c.published} to $${c.corrected}`);
  return ` The same entry adds a dated correction under each of the three judge cost figures in the Economics section: the judge cost was counted from the last draw only. Summed over the judge usage each receipt records on its draws (a draw with no judge usage adds nothing), and priced as the page prices it, the totals are ${lines.join(', ')}. The published figures are left as they were. The fix is spec 158.`;
}

// ── the receipt cells on Report 007 ───────────────────────────────────────────

function cells007(cells, judgeModel) {
  return cells.map((c) => {
    const slug = slugOf(c.receipt);
    const j = judgeCost(c.receipt, judgeModel);
    if (!slug || j.corrected !== EXPECTED[slug]) {
      throw new Error(`the corrected judge cost of ${c.receipt} computes to ${j.corrected}, and the operator's value is ${EXPECTED[slug]}: stopping, neither is printed`);
    }
    return { receipt: c.receipt, slug, model: c.model, ...j };
  });
}

// ── the insertions, as pure functions of a page ──────────────────────────────

const HEAD_OPEN = '<div class="headline">';
const AMEND_H2 = /<h2[^>]*>\s*Amendments\s*<\/h2>/i;
const NEW_HEADING = '<!--driftproof:anchor--><span id="amendments" class="toc-anchor"></span><!--/driftproof:anchor--><h2>Amendments</h2>';
const ANCHORED_RECEIPTS = /^ *(?:<!--driftproof:anchor-->)?<span id="receipts"/m;

// The line a section ends before: the line holding the next <h2> after `from`.
function lineBefore(html, from) {
  const re = /<h2[^>]*>/g;
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) return -1;
  return html.lastIndexOf('\n', m.index) + 1;
}

function insertNote(html, n) {
  const open = html.indexOf(HEAD_OPEN);
  const close = open < 0 ? -1 : html.indexOf('\n  </div>\n', open);
  if (close < 0) throw new Error(`Report ${n}: no headline block to end the note under`);
  return html.slice(0, close + 1) + noteHtml() + html.slice(close + 1);
}

function entryCard(n, html, extra) {
  return `  <div class="card" id="amendment-interim-note">\n    <p>${entryBody(n, html, extra)}</p>\n  </div>\n`;
}

function insertEntry(html, n, extra) {
  const card = entryCard(n, html, extra);
  const a = AMEND_H2.exec(html);
  if (n === '001') {
    // Report 001's Amendments run to the end of the page, so the entry goes before the footer line,
    // as the entry of 2026-09-14 does.
    const foot = '\n\n  <p class="foot">';
    const at = html.indexOf(foot, a ? a.index : 0);
    if (!a || at < 0 || html.split(foot).length !== 2) throw new Error('Report 001: no single end to the Amendments entries');
    return html.slice(0, at) + '\n' + card.replace(/\n$/, '') + html.slice(at);
  }
  if (a) {
    const at = lineBefore(html, a.index + a[0].length);
    if (at < 0) throw new Error(`Report ${n}: the Amendments section has no end`);
    return html.slice(0, at) + card + '\n' + html.slice(at);
  }
  // No Amendments section yet: start one before Receipts, with the anchor the page's chrome gives every
  // heading, so a re-render of the chrome leaves it as it is.
  const m = ANCHORED_RECEIPTS.exec(html);
  if (!m) throw new Error(`Report ${n}: no Receipts section to start an Amendments section before`);
  return html.slice(0, m.index) + `  ${NEW_HEADING}\n${card}\n` + html.slice(m.index);
}

function insertCorrections(html, cells) {
  let out = html;
  for (const c of cells) {
    const printed = `<p class="muted">Judge overhead, excluded: $${c.published} over ${c.rows} case rows.`;
    const at = out.indexOf(printed);
    if (at < 0 || out.indexOf(printed, at + 1) >= 0) throw new Error(`Report 007: the figure $${c.published} is not printed exactly once`);
    const end = out.indexOf('\n', at) + 1;
    out = out.slice(0, end) + correctionHtml(c.corrected) + out.slice(end);
  }
  return out;
}

const carries = (html) => ({
  note: html.includes('id="interim-note"'),
  entry: html.includes('id="amendment-interim-note"'),
  corrections: (html.match(/class="muted judge-correction"/g) || []).length,
});

// A page with the note, the entry and (Report 007) the three corrections. `opts.cells` is Report
// 007's { receipt, model } list and `opts.judgeModel` its judge, from the builder that knows them.
function applyToPage(html, n, opts = {}) {
  if (!NOTE_ON.includes(n)) return html;
  const had = carries(html);
  if (had.note || had.entry || had.corrections) {
    const want = n === '007' ? 3 : 0;
    if (!(had.note && had.entry && had.corrections === want)) throw new Error(`Report ${n} carries part of the notes (${JSON.stringify(had)}); refusing to add the rest`);
    return html;
  }
  let extra = '';
  let out = html;
  if (n === '007') {
    const cells = cells007(opts.cells, opts.judgeModel);
    out = insertCorrections(out, cells);
    extra = extra007(cells);
  }
  checkNote(n, html);
  out = insertNote(out, n);
  return insertEntry(out, n, extra);
}

// The page as it was before this script: exactly the inserted bytes taken out. Read by the sibling
// gates that hold the rest of a page to a recorded digest, so that "nothing else moved" is read and
// not assumed. EXACT: the candidate is the page with every line of the script's shapes removed, and
// it is taken only if putting the script's own output back reproduces the page byte for byte. A page
// whose note has one word changed, or whose entry is not the one the script writes, is returned as
// it is, so its changed bytes are still in it.
function looseStrip(html) {
  let out = html
    .replace(/ *<p class="muted interim-note" id="interim-note">[^\n]*<\/p>\n/g, '')
    .replace(/ *<p class="muted judge-correction">[^\n]*<\/p>\n/g, '');
  // An entry in an existing Amendments section: the card and the blank line after it. In a section
  // this script started (no Amendments before), the heading goes with it.
  out = out.replace(/ *<!--driftproof:anchor--><span id="amendments"[^>]*><\/span><!--\/driftproof:anchor--><h2>Amendments<\/h2>\n  <div class="card" id="amendment-interim-note">\n    <p>[^\n]*<\/p>\n  <\/div>\n\n/, '');
  out = out.replace(/\n  <div class="card" id="amendment-interim-note">\n    <p>[^\n]*<\/p>\n  <\/div>(?=\n\n  <p class="foot">)/, '');
  out = out.replace(/  <div class="card" id="amendment-interim-note">\n    <p>[^\n]*<\/p>\n  <\/div>\n\n/, '');
  return out;
}

function stripInterimLines(html, n, opts) {
  const candidate = looseStrip(html);
  if (candidate === html) return html;
  try {
    const o = opts || (n === '007' ? cellsFor007() : {});
    return applyToPage(candidate, n, o) === html ? candidate : html;
  } catch {
    return html;
  }
}

// ── the markdown mirror of Report 001 ─────────────────────────────────────────

function applyToMarkdown(md) {
  if (md.includes('**Note, 2026-10-03.**')) {
    if (!md.includes(noteMd())) throw new Error('reports/report-001.md carries a note that is not the one this script writes');
    return md;
  }
  const head = md.indexOf('\n## Headline\n');
  const next = head < 0 ? -1 : md.indexOf('\n## ', head + 1);
  if (next < 0) throw new Error('reports/report-001.md: no Headline section');
  const html = read('docs/reports/001/index.html');
  const entry = `**${ENTRY_VERSION['001']}** · ${DATE}. This entry adds a dated note under the headline; no earlier text is changed, and no figure, verdict token, table value or receipt reference changes. The note says the headline counts in this report include receipts whose receipt pages mark them Not measured, and that corrected counts follow in spec 159.`;
  checkNote('001', html);
  return `${md.slice(0, next).replace(/\n*$/, '\n')}\n${noteMd()}\n${md.slice(next)}`.replace(/\n*$/, '\n') + `\n${entry}\n`;
}

// ── the page set ──────────────────────────────────────────────────────────────

const PAGE = (n) => `docs/reports/${n}/index.html`;
const MD001 = 'reports/report-001.md';

function cellsFor007() {
  const p = require('./prepare-report-007.js');
  return { cells: p.CELLS.map((c) => ({ receipt: c.receipt, model: c.model })), judgeModel: p.JUDGE_MODEL };
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const stale = [];
  const write = (rel, text) => {
    const was = read(rel);
    if (was === text) return;
    if (check) { stale.push(rel); return; }
    fs.writeFileSync(path.join(ROOT, rel), text);
  };
  for (const n of NOTE_ON) {
    write(PAGE(n), applyToPage(read(PAGE(n)), n, n === '007' ? cellsFor007() : {}));
  }
  write(MD001, applyToMarkdown(read(MD001)));
  if (stale.length) {
    console.error(`not as written - run: node scripts/report-corrections.js\n  ${stale.join('\n  ')}`);
    return 1;
  }
  console.log(check ? `${NOTE_ON.length} report pages and the Report 001 mirror carry spec 161's notes` : `spec 161's notes written on ${NOTE_ON.length} report pages and the Report 001 mirror`);
  return 0;
}

module.exports = {
  DATE, EXPECTED, ENTRY_VERSION, NOTE_ON, notApplicable, judgeCost, linkedReceipts, badgeReadings, checkNote, cells007,
  noteHtml, noteMd, correctionHtml, entryBody, applyToPage, applyToMarkdown, stripInterimLines, PAGE, MD001,
};

if (require.main === module) process.exitCode = main();
