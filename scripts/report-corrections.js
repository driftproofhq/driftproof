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
//   - Report 008, after that entry: one more dated entry, on the baseline arm that lost a draw
//     (issue 109, spec 031 A-031-27). Its figures are read from the receipts the page reads, below.
//   - Report 011: its title, which said release day, corrected in its <h1>, and one dated entry
//     after its Amendment 1 saying what the title said, what is true and the source (issue 8, spec
//     161 A-161-2). The one place this script replaces bytes rather than inserting them, and
//     `stripInterimLines` puts the first title back exactly.
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

// ── Report 008: the baseline arm that lost a draw (issue 109, spec 031 A-031-27) ──────────────
//
// A private outside audit of 9 Oct 2026 read the receipt behind Report 008's "The baseline arm fell"
// sentence. The older side of that move lost one of its draws to a timeout, and the page does not
// say so. Scored at the bottom of the scale, the lost draw leaves the arm's band overlapping the new
// model's; scored at the top, it does not. A reading one lost draw can overturn is not a separation
// under the rule. The entry says that, after the entry above, and every figure in it is read here
// from the receipts the page reads, by the rule's own code. Nothing is printed if the receipts or
// the page stop reading as the entry says.
const LOST_DRAW_DATE = '2026-10-09';
const LOST_DRAW_ON = '008';
const LOST_DRAW_CARD = /  <div class="card" id="amendment-lost-draw">\n(?:    <p>[^\n]*<\/p>\n)+  <\/div>\n\n/;

// The one arm of the page's receipts that lost draws, with what the entry prints about it.
// `cells` is the page's { slug, from, baseline, receipt } list, from its builder.
function lostDrawFigures(cells) {
  const { lostDrawsOf, readCases } = require('../lib/verdict');
  const { mean, stddev, bandVerdict, WITHIN_NOISE } = require('../lib/stats');
  const { bandOf } = require('../lib/reuse');
  const { SCORE_SCALE } = require('../config');
  const found = [];
  for (const cell of cells) {
    for (const [side, rel] of [['older', cell.baseline], ['newer', cell.receipt]]) {
      const r = JSON.parse(read(rel));
      r.results.cases.forEach((c, i) => { const l = lostDrawsOf(c); if (l) found.push({ cell, side, rel, r, c, i, l }); });
    }
  }
  if (found.length !== 1) throw new Error(`Report 008: ${found.length} arms of its receipts lost draws, and the entry is written for one`);
  const { cell, side, rel, r, c, i, l } = found[0];
  const draws = (c.generation && c.generation.draws) || [];
  const lostAt = draws.map((d, k) => (d.status === 'measured' ? null : k)).filter((k) => k !== null);
  const keptAt = draws.map((d, k) => (d.status === 'measured' ? k : null)).filter((k) => k !== null);
  if (side !== 'older' || c.mode !== 'baseline' || !l.measured || l.lost !== 1 || lostAt.length !== 1) {
    throw new Error(`Report 008: the arm that lost draws (${rel}, ${c.id}, ${c.mode}) is not an older baseline with one lost draw the rule can bound`);
  }
  const newer = JSON.parse(read(cell.receipt));
  const row = (x, mode) => x.results.cases.find((y) => y.id === c.id && y.mode === mode);
  const o = bandOf(c);
  const n = bandOf(row(newer, 'baseline'));
  const w = bandOf(row(r, 'with_skill'));
  const nw = bandOf(row(newer, 'with_skill'));
  // THE READING IS THE RULE'S. The older baseline arm against the newer one, read by readCases, which
  // bounds a lost draw over every score it could have had (lib/verdict.js boundedCase): the move as
  // the page read it, and whether it holds whatever the lost draw scored. Report 007's own lift on
  // the case is read by the same function over its receipt.
  const across = readCases({ results: { cases: [c, { ...row(newer, 'baseline'), mode: 'with_skill' }] } }).find((x) => x.id === c.id);
  const held = readCases(r).find((x) => x.id === c.id);
  // The figures the entry prints for that reading: the arm's mean and sd with its lost draw scored
  // at each end of the scale, [score, mean, sd], and whether each overlaps the new arm's band.
  const scored = (t) => { const xs = [...l.measured, t]; return [t, mean(xs), stddev(xs)]; };
  const low = scored(SCORE_SCALE.worst);
  const high = scored(SCORE_SCALE.best);
  const overlaps = (s) => bandVerdict(s[1], s[2], n.mean, n.sd) === WITHIN_NOISE;
  if (!across || across.observed !== 'separated-down' || across.state.startsWith('separated') || !overlaps(low) || overlaps(high) || !held || held.state !== 'separated-up') {
    throw new Error(`Report 008: the receipts do not read as the entry says (across the release ${across && `${across.observed} read ${across.state}`}, Report 007 ${held && held.state})`);
  }
  const g = c.generation;
  return { slug: cell.slug, from: cell.from, id: c.id, rel, index: i, drawn: g.n_drawn, measured: g.n_measured, unmeasured: g.n_unmeasured, reason: draws[lostAt[0]].reason, lostAt, keptAt, scores: l.measured, o, n, w, nw, low, high };
}

function lostDrawCard(html, f) {
  const f3 = (x) => Number(x).toFixed(3);
  const s3 = (x) => `${x >= 0 ? '+' : ''}${Number(x).toFixed(3)}`;
  // A band as the page prints one, with its source: every band here is over generation draws.
  const label = ` <span class="muted">(${esc(f.o.source)})</span>`;
  const band = (b) => `${f3(b.mean)} ± ${f3(b.sd)}${label}`;
  const at = (s) => `${f3(s[1])} ± ${f3(s[2])}${label}`;
  const move = s3(f.n.mean - f.o.mean);
  const fell = `The baseline arm fell ${f3(f.o.mean)} to ${f3(f.n.mean)}`;
  const grew = `The cell's lift on this case therefore <em>grew</em>, ${s3(f.w.mean - f.o.mean)} to ${s3(f.nw.mean - f.n.mean)}`;
  const widest = `the widest baseline movement is ${f3(Math.abs(f.n.mean - f.o.mean))}`;
  const zero = '<strong>0 unmeasured</strong>';
  for (const words of [`${fell}.`, grew, widest, zero]) {
    if (!html.includes(words)) throw new Error(`Report 008 no longer carries the words its entry reads: ${words}`);
  }
  // The entry names the receipt and does not link it: the page's Receipts section links it, and the
  // head's structured data lists the receipts in the order the page first links them.
  if (!html.includes(`/${f.rel}"`)) throw new Error(`Report 008 does not link ${f.rel}`);
  const a = AMEND_H2.exec(html);
  const end = a ? lineBefore(html, a.index + a[0].length) : -1;
  if (end < 0) throw new Error('Report 008: no Amendments section to end the entry in');
  const section = html.slice(a.index, end);
  const labels = [...section.matchAll(/<strong>v(\d+)\.(\d+) &middot; /g)].map((m) => [Number(m[1]), Number(m[2])]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  if (!labels.length) throw new Error('Report 008: its Amendments carry no label to follow');
  const [major, minor] = labels[labels.length - 1];
  // The earlier entry that reads this move as a separation, and its date, read from the section.
  const said = `<code>${f.id}</code>, did separate under the rule, at ${move}`;
  const card = section.split('<div class="card"').find((x) => x.includes(said));
  const saidOn = card && /<strong>v\d+\.\d+ &middot; (\d{4}-\d{2}-\d{2})<\/strong>/.exec(card);
  if (!saidOn) throw new Error(`Report 008: no entry of its Amendments carries "${said}"`);
  const quote = (s) => s.replace(/<\/?em>/g, '').replace(/'/g, '&rsquo;');
  const runs = (ks) => (ks.every((k, j) => j === 0 || k === ks[j - 1] + 1) ? `${ks[0]} to ${ks[ks.length - 1]}` : `${ks.slice(0, -1).join(', ')} and ${ks[ks.length - 1]}`);
  const scores = `${f.scores.slice(0, -1).map(f3).join(', ')} and ${f3(f.scores[f.scores.length - 1])}`;
  const ps = [
    `<strong>v${major}.${minor + 1} &middot; ${LOST_DRAW_DATE}</strong>. <strong>This entry corrects how one baseline move on this page is read; no earlier text is changed, and no figure, verdict token, table value or receipt reference changes.</strong> For <code>${esc(f.id)}</code> in the <code>${esc(f.slug)}</code> cell, this page says <em>&ldquo;${quote(fell)}&rdquo;</em>, and builds on it <em>&ldquo;${quote(grew)}&rdquo;</em>. The same move is the page&rsquo;s widest baseline movement, and its entry of ${saidOn[1]} reads it as the one baseline case that separated under the rule across the release, at ${move}. A private outside audit of the same date as this entry read the receipt behind it, and this entry records what that receipt holds.`,
    `<strong>What the receipt records.</strong> The older side of that move is the case&rsquo;s baseline arm in <code>${esc(f.rel)}</code>, <code>results.cases[${f.index}]</code>. It drew ${f.drawn} generation draws and measured ${f.measured}: draw ${f.lostAt[0]} has no score and records <em>&ldquo;${esc(f.reason)}&rdquo;</em>, and draws ${runs(f.keptAt)} score ${scores}. Its <code>n_measured</code> is ${f.measured} and its <code>n_unmeasured</code> ${f.unmeasured}, and ${band(f.o)} is the mean and sample standard deviation of the ${f.measured} measured draws. This page does not name the lost draw. Its count of 0 unmeasured draws is of the two receipts measured for it, not of the Report 007 receipts they are diffed against.`,
    `<strong>With the lost draw bounded.</strong> Scored ${f.low[0]}, the bottom of the scale, the arm reads ${at(f.low)}, from ${f3(f.low[1] - f.low[2])} to ${f3(f.low[1] + f.low[2])}, which overlaps the new model&rsquo;s ${band(f.n)}. Scored ${f.high[0]}, the top of the scale, it reads ${at(f.high)}, and the two bands do not overlap. A reading that the score of one lost draw can overturn is not a separation under the rule. So <em>fell ${f3(f.o.mean)} to ${f3(f.n.mean)}</em> is not a separation under the rule, and neither is the lift that <em>grew</em> on it, nor the reading of this case as separated in the entry of ${saidOn[1]}. Across the release this baseline case was not separated, which is not evidence that it did not move.`,
    `<strong>What stands.</strong> Report 007&rsquo;s lift on this case, ${s3(f.w.mean - f.o.mean)}, with_skill against baseline on <code>${esc(f.from)}</code>, stands: at either score of the lost draw the baseline band&rsquo;s highest end is ${f3(Math.max(f.low[1] + f.low[2], f.high[1] + f.high[2]))}, below the with_skill band&rsquo;s lowest end, ${f3(f.w.lo)}. The new model&rsquo;s receipts lost no draw, and this entry changes no reading made within them. Filed under the wording rules of the repository's spec 031, amendment A-031-27.`,
  ];
  return { at: end, card: `  <div class="card" id="amendment-lost-draw">\n${ps.map((p) => `    <p>${p}</p>\n`).join('')}  </div>\n` };
}

// Report 008 with the lost-draw entry at the end of its Amendments. A page that carries an entry of
// that id that is not the one this script writes is refused.
function applyLostDraw(html, opts) {
  const f = lostDrawFigures((opts && opts.cells) || cellsFor008().cells);
  if (html.includes('id="amendment-lost-draw"')) {
    const bare = html.replace(LOST_DRAW_CARD, '');
    if (bare === html || applyLostDraw(bare, opts) !== html) throw new Error('Report 008 carries a lost-draw entry that is not the one this script writes');
    return html;
  }
  const { at, card } = lostDrawCard(html, f);
  return html.slice(0, at) + card + '\n' + html.slice(at);
}

// ── Report 011: the title, which said release day (issue 8, spec 161 A-161-2) ─────────────────
//
// Report 011 was published as "on release day". The vendor's news index lists Claude Opus 5.5 the
// day before the run every figure on the page is read from began. The correction puts the corrected
// title in the page's <h1>, which every builder that lists the report reads, and appends one dated
// entry after Amendment 1. Nothing else on the page moves. The release date is read from the record
// saved beside the vendor's page, as published beside the report, and the run's start from the run
// record published there; the entry is not written if the run did not begin the day after.
const RETITLE_ON = '011';
const RETITLE_DATE = '2026-10-10';
const TITLE_WAS = 'Report 011: Claude Opus 5.5 on release day, three skills';
const TITLE_NOW = 'Report 011: Claude Opus 5.5, the day after its release, three skills';
const RETITLE_RECORD = 'specs/161-report-corrections-interim/evidence/report-011-release-date.json';
const RETITLE_PUB = 'docs/reports/011/amendment-2/release-date.json';
const RETITLE_RUN = 'docs/reports/011/evidence/run-20260923T062806Z--run-record.json';
const RETITLE_CARD = /  <div class="card" id="amendment-retitle">\n(?: {4}<[^\n]*\n)+ {2}<\/div>\n\n/;
const H1_WAS = `<h1>${TITLE_WAS}</h1>`;
const H1_NOW = `<h1>${TITLE_NOW}</h1>`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 2026-09-22, or a run stamp 20260923T062806Z, as 22 Sep 2026.
const dayMon = (iso) => { const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(iso); return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`; };
const isoDay = (iso) => { const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(iso); return `${m[1]}-${m[2]}-${m[3]}`; };

function retitleCard() {
  const rec = JSON.parse(read(RETITLE_PUB));
  const st = JSON.parse(read(RETITLE_RUN)).stamp;
  const next = new Date(`${isoDay(rec.released_on)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  if (next.toISOString().slice(0, 10) !== isoDay(st)) throw new Error(`Report 011: the run ${st} did not begin the day after the release, ${rec.released_on}, and the entry says it did`);
  const ps = [
    `<h3 id="amendment-2">Amendment 2, ${RETITLE_DATE}: the title, which said release day</h3>`,
    `<p>This report was first published as <q>${esc(TITLE_WAS)}</q>. The vendor&rsquo;s news index lists Claude Opus 5.5 on ${dayMon(rec.released_on)}, and the run every figure on this page is read from, <code>${esc(st)}</code>, began on ${dayMon(st)} at ${st.slice(9, 11)}:${st.slice(11, 13)} UTC, the day after. The title now says so: <q>${esc(TITLE_NOW)}</q>. It reads so on this page, in its Markdown copy and in the site&rsquo;s lists of reports.</p>`,
    `<p>This amendment changes the title and nothing else: no sentence, figure, table, verdict or file above it, and no receipt or badge. The news index was read on ${dayMon(rec.read_at)}. Its record, with the line quoted and the sha256 of the page, is published beside this page as <a href="amendment-2/release-date.json"><code>release-date.json</code></a>.</p>`,
  ];
  return `  <div class="card" id="amendment-retitle">\n${ps.map((p) => `    ${p}\n`).join('')}  </div>\n`;
}

// Report 011 with its corrected <h1> and the entry at the end of its Amendments. A page that carries an
// entry of that id that is not the one this script writes, or a title it does not expect, is refused.
function applyRetitle(html) {
  if (html.includes('id="amendment-retitle"')) {
    const bare = html.replace(RETITLE_CARD, '').replace(H1_NOW, H1_WAS);
    if (bare === html || applyRetitle(bare) !== html) throw new Error('Report 011 carries a retitle entry that is not the one this script writes');
    return html;
  }
  if (html.split(H1_WAS).length !== 2) throw new Error(`Report 011 does not carry ${H1_WAS} once`);
  const a = AMEND_H2.exec(html);
  const end = a ? lineBefore(html, a.index + a[0].length) : -1;
  if (end < 0) throw new Error('Report 011: no Amendments section to end the entry in');
  const section = html.slice(a.index, end);
  if (!section.includes('<h3 id="amendment-1">Amendment 1, ') || section.includes('<h3 id="amendment-2"')) throw new Error('Report 011: its Amendments do not hold Amendment 1 alone');
  return html.slice(0, end).replace(H1_WAS, H1_NOW) + retitleCard() + '\n' + html.slice(end);
}

// The page with the first title back and the entry out, taken only if correcting it again gives the
// page byte for byte; otherwise the page as it is, so a changed byte stays in it.
function stripRetitle(html) {
  if (!html.includes('id="amendment-retitle"')) return html;
  const candidate = html.replace(RETITLE_CARD, '').replace(H1_NOW, H1_WAS);
  try {
    return applyRetitle(candidate) === html ? candidate : html;
  } catch {
    return html;
  }
}

// A page with the note, the entry and (Report 007) the three corrections, and Report 008's lost-draw
// entry; Report 011 with its title corrected. `opts.cells` is the page's cells, from the builder that
// knows them: Report 007's { receipt, model } list, with `opts.judgeModel` its judge, or Report 008's
// { slug, from, baseline, receipt } list.
function applyToPage(html, n, opts = {}) {
  if (n === RETITLE_ON) return applyRetitle(html);
  if (!NOTE_ON.includes(n)) return html;
  const out = applyInterim(html, n, opts);
  return n === LOST_DRAW_ON ? applyLostDraw(out, opts) : out;
}

function applyInterim(html, n, opts) {
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
    .replace(/ *<p class="muted judge-correction">[^\n]*<\/p>\n/g, '')
    .replace(LOST_DRAW_CARD, '');
  // An entry in an existing Amendments section: the card and the blank line after it. In a section
  // this script started (no Amendments before), the heading goes with it.
  out = out.replace(/ *<!--driftproof:anchor--><span id="amendments"[^>]*><\/span><!--\/driftproof:anchor--><h2>Amendments<\/h2>\n  <div class="card" id="amendment-interim-note">\n    <p>[^\n]*<\/p>\n  <\/div>\n\n/, '');
  out = out.replace(/\n  <div class="card" id="amendment-interim-note">\n    <p>[^\n]*<\/p>\n  <\/div>(?=\n\n  <p class="foot">)/, '');
  out = out.replace(/  <div class="card" id="amendment-interim-note">\n    <p>[^\n]*<\/p>\n  <\/div>\n\n/, '');
  return out;
}

function stripInterimLines(html, n, opts) {
  if (n === RETITLE_ON) return stripRetitle(html);
  const candidate = looseStrip(html);
  if (candidate === html) return html;
  try {
    const o = opts || (n === '007' ? cellsFor007() : n === LOST_DRAW_ON ? cellsFor008() : {});
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

function cellsFor008() {
  const p = require('./prepare-report-008.js');
  return { cells: p.CELLS.map((c) => ({ slug: c.slug, from: c.from, baseline: c.baseline, receipt: c.receipt })) };
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
    write(PAGE(n), applyToPage(read(PAGE(n)), n, n === '007' ? cellsFor007() : n === LOST_DRAW_ON ? cellsFor008() : {}));
  }
  write(MD001, applyToMarkdown(read(MD001)));
  // Report 011's record, published as saved, before the page that reads it.
  const rec = read(RETITLE_RECORD);
  const pub = path.join(ROOT, RETITLE_PUB);
  if (!fs.existsSync(pub) || fs.readFileSync(pub, 'utf8') !== rec) {
    if (check) stale.push(RETITLE_PUB);
    else { fs.mkdirSync(path.dirname(pub), { recursive: true }); fs.writeFileSync(pub, rec); }
  }
  if (!stale.includes(RETITLE_PUB)) write(PAGE(RETITLE_ON), applyToPage(read(PAGE(RETITLE_ON)), RETITLE_ON));
  if (stale.length) {
    console.error(`not as written - run: node scripts/report-corrections.js\n  ${stale.join('\n  ')}`);
    return 1;
  }
  console.log(check ? `${NOTE_ON.length} report pages and the Report 001 mirror carry spec 161's notes, Report ${LOST_DRAW_ON} its lost-draw entry and Report ${RETITLE_ON} its corrected title` : `spec 161's notes written on ${NOTE_ON.length} report pages and the Report 001 mirror, Report ${LOST_DRAW_ON}'s lost-draw entry and Report ${RETITLE_ON}'s corrected title`);
  return 0;
}

module.exports = {
  DATE, EXPECTED, ENTRY_VERSION, NOTE_ON, notApplicable, judgeCost, linkedReceipts, badgeReadings, checkNote, cells007,
  noteHtml, noteMd, correctionHtml, entryBody, applyToPage, applyToMarkdown, stripInterimLines, PAGE, MD001,
};

if (require.main === module) process.exitCode = main();
