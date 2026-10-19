// SPDX-License-Identifier: Apache-2.0
'use strict';

// `driftproof view` (spec 128): one self-contained page from a folder of receipts, for a reader who
// does not read a terminal.
//
// THE PAGE LOADS NOTHING. Its styles, its plots and its script are inline, it names no font file
// (the site's family names lead each stack, and the system fallbacks after them set the text when
// they are not installed), and a Content-Security-Policy with default-src 'none' stops anything a
// later edit might add. It opens from disk. Rendering it makes no model call and no network request.
//
// EVERY WORD OF A RESULT IS lib/plain.js's. A label, a sentence, a detail, the key and the lede's
// phrases come from there, read through lib/verdict.js receiptVerdict, and whether a receipt is up
// to date is lib/stale.js staleReport's own reading, with the options `driftproof stale` takes and,
// from spec 173, `fromReceipt`, which `driftproof view` passes. The
// look is the site's receipt: its tokens (lib/view-tokens.js) and its band plot (lib/band-plot.js),
// both held equal to the site's files by spec 128's gate.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listReceipts } = require('./receipt');
const { staleReport } = require('./stale');
const { plainOf, LABELS, KEY, LEDE, LEDE_ORDER, NONE_HURT } = require('./plain');
const { SMOKE_LINE } = require('./smoke');
const { renderCell, caseCellOf, renderRows, HATCH } = require('./band-plot');
const { bandOf } = require('./reuse');
const { TOKENS_CSS } = require('./view-tokens');
const { loadRegistry } = require('./models');
const { resolveModel } = require('./provider');

const GENERATOR = '<meta name="generator" content="driftproof view">';

// Whether a file is a page this command wrote, so --out may write over it and over nothing else.
function isViewPage(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8').includes(GENERATOR);
  } catch { return false; }
}

// Every receipt under the directory and its subdirectories, by lib/receipt.js listReceipts' rule in
// each: sidecars and JSON that is not a receipt are left out; a file that does not parse is kept,
// so the page can name it.
function collect(dir) {
  const out = [];
  (function walk(d) {
    for (const x of listReceipts(d)) out.push(x);
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
    }
  })(dir);
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n, one, many = `${one}s`) => `${n < WORDS.length ? WORDS[n] : n} ${n === 1 ? one : many}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const f3 = (x) => (typeof x === 'number' ? x.toFixed(3) : 'no score');

// Whether a receipt is up to date, in the stale check's own words (spec 128 R-7). Spec 173 (S-5): with
// no flag and no rc to say otherwise, the check reads the skill, model and judge from the receipt, and
// an up-to-date row says which it took, so it claims no more than was compared.
const TAKEN = ['skill', 'model', 'judge'];
const listed = (xs, word) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} ${word} ${xs[xs.length - 1]}`);
function staleLine(s) {
  if (s.status === 'current') {
    const adv = (s.advisories || [])[0];
    const took = TAKEN.filter((a) => (s.taken || []).includes(a));
    const from = took.length ? `, taking the ${listed(took, 'and')} from this receipt (no ${listed(took.map((a) => `--${a}`), 'or')} given)` : '';
    return { status: 'current', text: `Up to date, by the stale check${from}${adv ? `; a newer model is out: ${adv.model_id}, released ${adv.released}` : ''}.` };
  }
  if (s.status === 'stale') {
    const w = s.arms.with_skill.decision; const b = s.arms.baseline.decision;
    const act = (x) => x === 'rerun' || x === 'regrade';
    const what = act(w) && w === b ? `${w} both arms` : [act(w) ? `${w} the with-skill arm` : null, act(b) ? `${b} the baseline arm` : null].filter(Boolean).join(' and ');
    return { status: 'stale', text: `Out of date: the stale check says ${what}${s.next ? `, with ${s.next}` : ''}.` };
  }
  const unknown = (s.axes || []).filter((a) => a.effect === 'unknown');
  const pick = unknown.find((a) => a.recorded == null) || unknown[0];
  return { status: s.status, text: `Can't tell: ${pick ? pick.reason : 'the stale check could not say'}.` };
}

// The order models run across the grid: by registry release date, then by id; unregistered last.
function modelOrder(models) {
  let reg = null;
  try { reg = loadRegistry(); } catch { reg = null; }
  const released = (id) => { let r = null; try { r = reg && (reg.byId[resolveModel(id)] || reg.byId[id]); } catch { r = null; } return r && typeof r.released === 'string' ? r.released : '9999'; };
  return [...models].sort((a, b) => (released(a) === released(b) ? (a < b ? -1 : a > b ? 1 : 0) : released(a) < released(b) ? -1 : 1));
}

const CSS = `${TOKENS_CSS}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: var(--t-body); line-height: var(--lh-body); padding: 32px 16px 56px; }
.wrap { max-width: var(--w-wide); margin: 0 auto; }
button:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
.eyebrow { font-family: var(--mono); font-size: var(--t-eyebrow); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-muted); margin: 0 0 8px; overflow-wrap: anywhere; }
h1 { font-family: var(--display); font-weight: 500; font-size: var(--t-h1-page); line-height: 1.1; margin: 0 0 12px; text-wrap: balance; }
h2 { font-family: var(--display); font-weight: 500; font-size: var(--t-receipt-heading); margin: 0 0 10px; overflow-wrap: anywhere; }
.lede { font-family: var(--display); font-size: var(--t-verdict); line-height: 1.4; max-width: 60ch; margin: 0 0 14px; }
.lede b { font-weight: 500; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: var(--t-fine); color: var(--ink-muted); margin-bottom: 18px; }
.key { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 10px 22px; font-size: var(--t-fine); color: var(--ink-muted); margin: 0 0 26px; }
.key p { margin: 0; }
.key b { color: var(--ink); font-weight: 500; }
.grid { display: grid; grid-template-columns: minmax(130px, .8fr) repeat(var(--cols), minmax(0, 1fr)); gap: 10px; margin-bottom: 30px; }
.grid .h { font-family: var(--mono); font-size: var(--t-mono-sm); letter-spacing: .05em; color: var(--ink-muted); align-self: end; padding: 0 4px 2px; overflow-wrap: anywhere; }
.grid .rowh { font-weight: 500; align-self: center; padding: 0 4px; overflow-wrap: anywhere; }
.cell { text-align: left; font: inherit; color: inherit; background: var(--paper-2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 10px 12px; cursor: pointer; display: grid; gap: 6px; min-width: 0; }
.cell.empty { cursor: default; color: var(--ink-muted); font-size: var(--t-fine); }
.cell[aria-pressed="true"] { outline: 2px solid var(--ink); outline-offset: 1px; }
.cell > span { min-width: 0; }
.cell .chip { white-space: normal; }
.cell .runs { font-size: var(--t-mono-sm); color: var(--ink-muted); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.nums { font-family: var(--values); font-size: var(--t-mono-sm); font-variant-numeric: tabular-nums; }
.chip { display: inline-block; font-size: var(--t-mono-sm); font-weight: 500; padding: 1px 8px; border-radius: var(--radius); border: 1.5px solid currentColor; white-space: nowrap; background: var(--paper-2); }
.dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; border: 1.5px solid currentColor; background: currentColor; }
@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } .grid .h { display: none; } .grid .rowh { margin-top: 10px; } }
.sheets { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 34px 26px; align-items: start; margin-bottom: 30px; }
.sheet { position: relative; background: var(--paper-2); box-shadow: var(--sheet-shadow); padding: 22px 22px 18px; margin-top: var(--tooth); min-width: 0; }
.sheet::before, .sheet::after { content: ""; position: absolute; left: 0; right: 0; height: var(--tooth); background-color: var(--paper-2);
  -webkit-mask: conic-gradient(from -45deg at bottom, black 90deg, transparent 0) bottom / calc(2 * var(--tooth)) var(--tooth) repeat-x;
          mask: conic-gradient(from -45deg at bottom, black 90deg, transparent 0) bottom / calc(2 * var(--tooth)) var(--tooth) repeat-x; }
.sheet::before { top: calc(-1 * var(--tooth) + 1px); }
.sheet::after { bottom: calc(-1 * var(--tooth) + 1px);
  -webkit-mask: conic-gradient(from 135deg at top, black 90deg, transparent 0) top / calc(2 * var(--tooth)) var(--tooth) repeat-x;
          mask: conic-gradient(from 135deg at top, black 90deg, transparent 0) top / calc(2 * var(--tooth)) var(--tooth) repeat-x; }
.sheet.timeline { grid-column: 1 / -1; }
.sheet h3 { font-family: var(--display); font-weight: 400; font-size: var(--t-h3); text-align: center; margin: 0 0 10px; padding-bottom: 10px; border-bottom: var(--perforation) dotted var(--rule); overflow-wrap: anywhere; }
.center { text-align: center; }
.stamp { display: inline-block; transform: rotate(var(--stamp-tilt)); font-family: var(--mono); font-weight: 700; font-size: var(--t-mono); letter-spacing: .04em; text-transform: uppercase; padding: 3px 10px; border: 2px solid currentColor; border-radius: var(--radius); margin: 2px 0 10px; mix-blend-mode: multiply; }
.v-PASSED { color: var(--state-separated); }
.v-REGRESSED { color: var(--reg); }
.v-NO_EFFECT { color: var(--ink); }
.v-UNDERPOWERED { color: var(--state-overlapping); border-style: dashed; }
.v-INCONCLUSIVE { color: var(--mixed); border-style: dashed; }
.v-REPORTED, .v-SMOKE { color: var(--state-refused); border-style: dotted; }
.v-NOT_MEASURED, .v-PRE_ANSWERED_BY, .v-REFUSED { color: var(--state-refused); border-style: dashed; }
.dot.v-UNDERPOWERED, .dot.v-INCONCLUSIVE, .dot.v-REPORTED, .dot.v-SMOKE, .dot.v-NOT_MEASURED, .dot.v-PRE_ANSWERED_BY, .dot.v-REFUSED { background: transparent; }
.said { margin: 0 0 10px; }
.detail, .basis { margin: 0 0 8px; font-size: var(--t-fine); color: var(--ink-muted); }
.row { display: grid; grid-template-columns: var(--w-receipt-label) 1fr; gap: 0 12px; padding: 6px 0; border-top: 1px dotted var(--rule); font-size: var(--t-fine); }
.row .k { color: var(--ink-muted); }
.row .v { font-family: var(--values); font-size: var(--t-mono-sm); overflow-wrap: anywhere; }
.band svg { display: block; width: 100%; height: auto; margin: 6px 0 8px; }
.stale { color: var(--state-refused); }
.note { font-family: var(--mono); font-size: var(--t-mono-sm); color: var(--state-refused); border: 1px dashed var(--state-refused); border-radius: var(--radius); padding: 1px 7px; display: inline-block; }
.foot { margin-top: 34px; font-size: var(--t-fine); }
.lift-scroll { overflow-x: auto; max-width: 100%; }
.lift-scroll table { border-collapse: collapse; font-size: var(--t-fine); }
.lift-scroll th, .lift-scroll td { padding: 6px; text-align: left; border-bottom: 1px dotted var(--rule); vertical-align: top; }
.lift-scroll th[scope=row] { overflow-wrap: anywhere; min-width: 12ch; }
.hatch-defs { position: absolute; width: 0; height: 0; }
.first-look { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; margin: 0 0 8px; }
.first-look .basis { grid-column: 1 / -1; }
.look-col { min-width: 0; border-top: 1px dotted var(--rule); padding-top: 6px; }
.look-col .k { margin: 0 0 4px; font-size: var(--t-fine); color: var(--ink-muted); }
.look-col pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--values); font-size: var(--t-mono-sm); }`;

// Selecting a cell shows its sheets. The page reads without it: the first cell's are shown.
const SCRIPT = `(function () {
  var cells = document.querySelectorAll('button.cell');
  function pick(b) {
    cells.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    document.querySelectorAll('section.sel').forEach(function (s) { s.hidden = s.getAttribute('data-cell') !== b.getAttribute('data-cell'); });
  }
  cells.forEach(function (b) { b.addEventListener('click', function () { pick(b); }); });
})();`;

// ── A FIRST LOOK (spec 139 A-139-17, issue 367) ─────────────────────────────────────────────────
// A quick run's one test task, draw 0 of each arm, side by side: on stdout (`sideBySide`, which
// `driftproof run --quick` prints) and on the page (`firstLookHtml`). Both take their text from
// `firstLookOf`, which shows an answer only when its sha256 is the generation_hash the receipt seals,
// labels a draw 0 that was not measured, and never puts another draw in its place. Nothing here
// compares the two answers.
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
// Every C0 and C1 control character but a newline and a tab, as a visible escape (AC-367-4), so an
// answer cannot hide or rewrite the lines around it.
const visible = (s) => String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
const ARMS = ['with_skill', 'baseline'];
// The two arms of the receipt's first case, draw 0 of each. `answers` is { <sha256>: text }, the
// answers archive's map, or null when no archive was found.
function firstLookOf(receipt, answers) {
  const cases = ((receipt && receipt.results) || {}).cases || [];
  const id = cases.length ? cases[0].id : null;
  const arms = {};
  for (const mode of ARMS) {
    const row = cases.find((c) => c.id === id && c.mode === mode);
    const d = row && row.generation ? (row.generation.draws || []).find((x) => x.draw_index === 0) : null;
    const note = !d ? null : d.status !== 'measured' ? `draw 0 not measured: ${d.reason || 'no reason recorded'}` : null;
    let text = null; let why = null;
    if (!d || !d.generation_hash) why = 'no answer came back for draw 0';
    else if (!answers) why = 'the answers file was not found';
    else if (typeof answers[d.generation_hash] !== 'string') why = 'the answers file does not hold draw 0';
    else if (sha256(answers[d.generation_hash]) !== d.generation_hash) why = 'the kept answer does not match the hash the receipt seals';
    else text = answers[d.generation_hash];
    arms[mode] = { text, why, note };
  }
  return { id, arms };
}
// One answer as lines of at most `width` characters: tabs as spaces, words kept whole where they fit.
function wrap(text, width) {
  const out = [];
  for (const raw of visible(text).replace(/\t/g, '    ').split('\n')) {
    let line = raw;
    while (line.length > width) {
      let cut = line.lastIndexOf(' ', width);
      if (cut <= 0) cut = width;
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^ /, '');
    }
    out.push(line);
  }
  return out;
}
// The terminal's side by side: a header, then the with-skill answer on the left and the baseline
// answer on the right, at a fixed width.
const LOOK_WIDTH = 38;
function sideBySide(left, right, width = LOOK_WIDTH) {
  const l = wrap(left || '', width); const r = wrap(right || '', width);
  const row = (a, b) => `  ${a.padEnd(width)} | ${b}`;
  const lines = [row('with the skill', 'without the skill')];
  for (let i = 0; i < Math.max(l.length, r.length); i++) lines.push(row(l[i] || '', r[i] || ''));
  return lines;
}
// The page's side by side: each arm's answer as escaped text, or the reason none is shown, and the
// label of a draw 0 that was not measured.
function firstLookHtml(arms, id = null) {
  const col = (mode, label) => {
    const a = arms[mode] || {};
    const body = typeof a.text === 'string' ? `<pre>${esc(visible(a.text))}</pre>` : `<p class="detail">${esc(a.why || 'no answer is shown')}</p>`;
    return `<div class="look-col" data-arm="${mode}"><p class="k">${label}</p>${a.note ? `<p class="detail" data-field="draw-status">${esc(a.note)}</p>` : ''}${body}</div>`;
  };
  return `<div class="first-look" data-field="first-look"><p class="basis">${esc(`First look${id ? ` at test task ${id}` : ''}: draw 0 of each arm, as it came back.`)}</p>${col('with_skill', 'With the skill')}${col('baseline', 'Without the skill')}</div><!-- /first-look -->\n`;
}
// The answers archive a quick run kept, read from transcripts/ in the folder that holds the receipts
// folder: only for a receipt_hash that is a sha256, and only up to the regrade reader's byte bound.
const ARCHIVE_BYTES = 16777216;
function archivedAnswers(dir, receipt) {
  const h = String((receipt && receipt.receipt_hash) || '');
  if (!/^[0-9a-f]{64}$/.test(h)) return null;
  const file = path.join(path.dirname(dir), 'transcripts', h, 'answers.json');
  try {
    if (fs.statSync(file).size > ARCHIVE_BYTES) return null;
    const a = JSON.parse(fs.readFileSync(file, 'utf8'));
    return a && typeof a.answers === 'object' && !Array.isArray(a.answers) ? a.answers : null;
  } catch { return null; }
}

// Spec 265 AC-44: a marked receipt's run date is the card's day, so the view shows the day alone,
// never a time; every place the page prints a date reads this.
function viewDate(r) { const d = String((r.run || {}).date_utc || ''); return receiptAggregatesOnly(r) ? d.slice(0, 10) : d; }

// The page over a directory. Returns { html, receipts, newest } and html null when it holds no receipt.
function renderView(dir, { now = new Date(), label = dir, stale = {} } = {}) {
  const found = collect(dir);
  if (!found.length) return { html: null, receipts: 0 };
  const report = staleReport(found.map((x) => x.file), stale);
  // Spec 190 A-190-16 (PR 271 F-1): the breakdown limits bound only liftAttempt's work. A receipt
  // over them keeps its sheet, and its lift section reads unavailable with the limit as the reason.
  const entries = found.map((x, i) => {
    const s = report.receipts[i];
    const rel = path.relative(dir, x.file).split(path.sep).join('/');
    if (s.error) return { rel, error: s.error };
    const run = x.receipt.run || {};
    return { rel, receipt: x.receipt, lift: liftAttempt(x.receipt), plain: plainOf(x.receipt), stale: staleLine(s), date: viewDate(x.receipt), skill: String((x.receipt.skill || {}).name || 'unnamed skill'), model: String(run.model_id || 'unknown model') };
  });
  const shown = entries.filter((e) => !e.error);
  const errors = entries.filter((e) => e.error);
  const byAge = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

  // The grid: skills down, models across, one cell per pair with a receipt, oldest receipt first.
  const skills = [...new Set(shown.map((e) => e.skill))].sort();
  const models = modelOrder(new Set(shown.map((e) => e.model)));
  const cells = [];
  for (const skill of skills) for (const model of models) {
    const list = shown.filter((e) => e.skill === skill && e.model === model).sort(byAge);
    if (list.length) cells.push({ key: `cell-${cells.length + 1}`, skill, model, list });
  }

  // The lede: each label counted over every receipt shown. Spec 143: an UNDERPOWERED result whose
  // cases disagree is counted under its own words, UNDERPOWERED_CASES.
  const counts = {};
  for (const x of shown) { const w = x.plain.words || x.plain.state; counts[w] = (counts[w] || 0) + 1; }
  const parts = LEDE_ORDER.filter((s) => counts[s]).map((s) => LEDE[s](`<b data-count="${s}">${counts[s]}</b>`, counts[s]));
  const phrase = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  const measured = shown.some((e) => ['PASSED', 'NO_EFFECT', 'UNDERPOWERED', 'INCONCLUSIVE'].includes(e.plain.state));
  const lede = shown.length
    ? `Across <b data-count="total">${shown.length}</b> ${shown.length === 1 ? 'result' : 'results'}, ${phrase}.${!counts.REGRESSED && measured ? ` ${NONE_HURT}` : ''}`
    : 'No receipt in this folder could be read.';

  // What the receipts share, said once.
  const judges = [...new Set(shown.map((e) => ((e.receipt.run || {}).judge || {}).model_id).filter(Boolean))].sort();
  const tasks = [...new Set(shown.map((e) => new Set(((e.receipt.results || {}).cases || []).map((c) => c.id)).size))];
  const per = [...new Set(cells.map((c) => c.list.length))];
  const meta = [
    per.length === 1 ? `${cap(count(per[0], 'receipt'))} per skill and model` : null,
    tasks.length === 1 ? `${cap(count(tasks[0], 'test task'))} per receipt` : null,
    judges.length ? `Answers scored by ${judges.join(', ')}` : null,
  ].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('');
  // Spec 139: a smoke run's state is keyed when the page shows one.
  // Issue 409, A-128-13: a smoke-only page carries no verdict labels.
  const keyStates = shown.length && shown.every((e) => e.plain.state === 'SMOKE') ? ['SMOKE'] : ['PASSED', 'NO_EFFECT', 'UNDERPOWERED', ...['UNDERPOWERED_CASES', 'REGRESSED', 'INCONCLUSIVE', 'REPORTED', 'SMOKE', 'NOT_MEASURED', 'PRE_ANSWERED_BY'].filter((s) => counts[s])];
  const key = keyStates.map((s) => `<p><b>${esc(LABELS[s])}</b>: ${esc(KEY[s])}</p>`).join('\n');

  const grid = [`<div class="h">Skill</div>${models.map((m) => `<div class="h">${esc(m)}</div>`).join('')}`];
  for (const skill of skills) {
    grid.push(`<div class="rowh">${esc(skill)}</div>`);
    for (const model of models) {
      const c = cells.find((x) => x.skill === skill && x.model === model);
      if (!c) { grid.push('<div class="cell empty">No receipt</div>'); continue; }
      const { list } = c;
      const newest = list[list.length - 1];
      const dots = list.map((e) => `<span class="dot v-${e.plain.state}" data-file="${esc(e.rel)}" title="${esc(`${e.date.slice(0, 10)}: ${e.plain.label}`)}"></span>`).join('');
      const cmp = newest.receipt.comparison || {};
      grid.push(`<button type="button" class="cell" data-cell="${c.key}" data-label="${esc(newest.plain.label)}" data-skill="${esc(skill)}" data-model="${esc(model)}" aria-pressed="${c === cells[0]}">`
        + `<span><span class="chip v-${newest.plain.state}" data-field="label">${esc(newest.plain.label)}</span></span>`
        + `<span class="nums">${f3(cmp.with_skill_score)} with · ${f3(cmp.baseline_score)} without</span>`
        + `<span class="runs">${esc(cap(count(list.length, 'receipt')))}: ${dots}</span></button>`);
    }
  }

  const rowLabel = (e) => { const d = path.posix.dirname(e.rel); return `${d === '.' ? e.date.slice(0, 16).replace('T', ' ') : `${d} · ${e.date.slice(0, 10)}`}`; };
  // Spec 139: a smoke sheet draws its two arms and no band state. The hero plot's state words
  // (separated, overlapping) are the verdict's own test in other words, and a smoke run has none.
  const plot = (e, cell, title) => (e.plain.state === 'SMOKE'
    ? renderRows([{ file: e.rel, label: 'this run', baseline: cell.baseline, skill: cell.skill }], { title })
    : renderCell(cell, { title, size: 'hero' }));
  const liftHtml = e => { try { return renderLiftHtml(e.lift); } catch (error) { return renderLiftHtml({ error: error.message }); } };
  // A-139-17: a smoke sheet shows its first look, the two answers of its one test task side by side.
  const look = (e) => {
    if (e.plain.state !== 'SMOKE') return '';
    const f = firstLookOf(e.receipt, archivedAnswers(dir, e.receipt));
    return firstLookHtml(f.arms, f.id);
  };
  const sheet = (e) => {
    const { cell, basis } = caseCellOf(e.receipt);
    const band = (b) => (b ? `${b.mean.toFixed(3)} ± ${b.sd.toFixed(3)}` : 'no score');
    const samples = ((e.receipt.run || {}).judge || {}).samples;
    // Answers per arm (AC-4, F-3): each test task's first row per arm, as caseCellOf reads the one
    // task, its draws summed over the test tasks; no row when any task lacks a count. The judge
    // samples are per answer, and the row says so of the answer, not of the test task (A-128-9).
    const cases = ((e.receipt.results || {}).cases || []).filter((c) => !c.case_status || c.case_status === 'ok');
    const ids = [...new Set(cases.map((c) => c.id))];
    const nTasks = ids.length;
    const armN = (mode) => { const bs = ids.map((id) => bandOf(cases.find((c) => c.id === id && c.mode === mode))); return bs.length && bs.every((b) => b && Number.isInteger(b.n)) ? bs.reduce((t, b) => t + b.n, 0) : null; };
    const nArm = [armN('with_skill'), armN('baseline')];
    const answers = nArm.every((n) => Number.isInteger(n))
      ? `<div class="row"><span class="k">Answers</span><span class="v" data-field="answers">${nArm[0]} with the skill, ${nArm[1]} without${nTasks > 1 ? `, across ${nTasks} test tasks` : ''}${Number.isInteger(samples) ? `; the judge scored each answer ${samples} ${samples === 1 ? 'time' : 'times'}` : ''}</span></div>\n` : '';
    const level = typeof e.receipt.verification_level === 'string' ? e.receipt.verification_level : 'not recorded';
    const said = basis === 'draws' ? 'The bars are the spread of the scores across the answers to its one test task.' : 'The bars are the spread of the scores across its test tasks, as the site draws a receipt.';
    // Spec 173 (R-2): a result in the words "Too few test tasks to tell" says what that means on its
    // number of test tasks, and what gives a clearer answer. Its label, sentence and state are
    // lib/plain.js's, and the rule that read it does not move.
    const clearer = e.plain.words === 'UNDERPOWERED_CASES' ? `<p class="detail" data-field="clearer" data-tasks="${nTasks}">${esc(`On ${count(nTasks, 'test task')}, the tasks scored too far apart from each other to call it, and more answers to the same tasks are not expected to change that. More test tasks give a clearer answer: add cases to the skill's evals/evals.json and run it again. The rule that reads the result stays the same.`)}</p>\n` : '';
    return `<article class="sheet" data-file="${esc(e.rel)}" data-state="${e.plain.state}">
<h3>${esc(e.skill)} · ${esc(rowLabel(e))}</h3>
<div class="center"><span class="stamp v-${e.plain.state}" data-field="label">${esc(e.plain.label)}</span></div>
<p class="said" data-field="sentence">${esc(e.plain.sentence)}</p>
${e.plain.detail ? `<p class="detail" data-field="detail">${esc(e.plain.detail)}</p>\n` : ''}${clearer}<div class="band">${plot(e, cell, `${e.skill} on ${e.model}, ${e.rel}`)}</div>
<p class="basis">${esc(said)}</p>
${look(e)}<div class="row"><span class="k">Model</span><span class="v">${esc(e.model)}</span></div>
<div class="row"><span class="k">Verification level</span><span class="v" data-field="verification">${esc(level)}</span></div>
${answers}<div class="row"><span class="k">With / without</span><span class="v">${esc(`${band(cell.skill)} / ${band(cell.baseline)}`)}</span></div>
<div class="row"><span class="k">Up to date?</span><span class="v stale" data-field="stale" data-status="${esc(e.stale.status)}">${esc(e.stale.text)}</span></div>
${liftHtml(e)}<div class="row"><span class="k">Run</span><span class="v">${esc(e.date || 'undated')}</span></div>
<div class="row"><span class="k">Receipt</span><span class="v">${esc(`${String(e.receipt.receipt_hash || '').slice(0, 12)}… · ${e.rel}`)}</span></div>
</article>`;
  };
  const sections = cells.map((c) => {
    const first = c.list[0].date.slice(0, 10); const last = c.list[c.list.length - 1].date.slice(0, 10);
    const when = first === last ? first : `${first} to ${last}`;
    const timeline = c.list.length > 1
      ? `<article class="sheet timeline" data-timeline="${c.key}"><h3>Timeline</h3><p class="said">One row per receipt, oldest first.</p><div class="band">${renderRows(c.list.map((e) => { const x = caseCellOf(e.receipt).cell; return { file: e.rel, label: rowLabel(e), baseline: x.baseline, skill: x.skill }; }), { title: `${c.skill} on ${c.model}` })}</div></article>\n`
      : '';
    return `<section class="sel" data-cell="${c.key}"${c === cells[0] ? '' : ' hidden'}>
<h2>${esc(`${c.skill} with ${c.model}: ${count(c.list.length, 'receipt')}, ${when}`)}</h2>
<div class="sheets">
${timeline}${c.list.map(sheet).join('\n')}
</div>
</section>`;
  }).join('\n');
  const unread = errors.length ? `<section class="unread">
<h2>${esc(cap(count(errors.length, 'file')))} not read</h2>
<div class="sheets">
${errors.map((e) => `<article class="sheet" data-file="${esc(e.rel)}" data-state="ERROR"><h3>${esc(e.rel)}</h3><p class="said" data-field="reason">${esc(e.error)}</p></article>`).join('\n')}
</div>
</section>` : '';
  // Imported is what run.source says, not the state: a stub's run and a regrade no model answered
  // are below TESTED too, and no other tool reported them.
  const imported = shown.filter((e) => e.plain.state === 'REPORTED' && /^imported\//.test(String((e.receipt.run || {}).source || ''))).length;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
${GENERATOR}
<title>${esc(`Driftproof results: ${label}`)}</title>
<style>
${CSS}
</style>
</head>
<body>
<svg class="hatch-defs" aria-hidden="true" focusable="false">${HATCH}</svg>
<main class="wrap">
<p class="eyebrow">${esc(`Driftproof results · ${label} · ${count(entries.length, 'receipt')} · made ${day(now)} · this page works offline`)}</p>
<h1>${esc(`Does the skill help? ${cap(count(skills.length, 'skill'))}, ${count(models.length, 'model')}`)}</h1>
<p class="lede">${lede}</p>
<div class="meta">${meta}</div>
<div class="key">
${key}
</div>
<div class="grid" role="group" aria-label="Results by skill and model" style="--cols: ${Math.max(1, models.length)}">
${grid.join('\n')}
</div>
${sections}
${unread}
<p class="foot"><span class="note">reported results</span> ${esc(`A receipt below TESTED (imported from another tool, or from a run no model answered) shows its reported numbers under a dotted "${LABELS.REPORTED}" stamp and gets no verdict, because Driftproof did not measure it.`)}${counts.SMOKE ? ` ${esc(`A smoke run (--quick) is below TESTED too, and is the exception: it shows under a dotted "${LABELS.SMOKE}" stamp. ${SMOKE_LINE}.`)}` : ''} Imported from another tool in this folder: <b data-count="imported">${imported ? imported : 'none'}</b>.</p>
</main>
<script>
${SCRIPT}
</script>
</body>
</html>
`;
  // Spec 173: the newest receipt shown, so `driftproof view` can offer the small full run after a quick one.
  const newest = shown.length ? [...shown].sort(byAge)[shown.length - 1].receipt : null;
  return { html, receipts: entries.length, newest };
}


// Issue 207, spec 190. New descriptive figures never rewrite the receipt or its verdict.
const { validateReceipt, verifyReceiptHash, duplicateCaseRows } = require('./receipt');
const { readCases, UNDERPOWERED_LINE } = require('./verdict');
const { receiptAggregatesOnly } = require('./verdict');
const LIFT_LIMITS = Object.freeze({ receiptBytes: 2097152, cases: 128, draws: 64, identifierBytes: 256,
  stringBytes: 4096, nodes: 65536, depth: 32, outputBytes: 1048576 });
function liftRefuse(message, code = 'INVALID_LIFT_EVIDENCE') {
  const error = new Error(message); error.code = code; throw error;
}
function liftLimit(name, maximum) { liftRefuse('Lift breakdown limit: ' + name + ' exceeds ' + maximum + '.', 'LIFT_LIMIT'); }
function assertLiftLimits(receipt) {
  const cases = receipt && receipt.results && receipt.results.cases;
  if (Array.isArray(cases)) {
    if (cases.length > LIFT_LIMITS.cases * 2) liftLimit('case rows', LIFT_LIMITS.cases * 2);
    const ids = new Set();
    for (const row of cases) {
      if (!row || typeof row !== 'object') continue;
      if (typeof row.id === 'string' && Buffer.byteLength(row.id) > LIFT_LIMITS.identifierBytes) liftLimit('case identifier bytes', LIFT_LIMITS.identifierBytes);
      ids.add(row.id);
      if (ids.size > LIFT_LIMITS.cases) liftLimit('cases', LIFT_LIMITS.cases);
      const draws = row.generation && row.generation.draws;
      if (Array.isArray(draws) && draws.length > LIFT_LIMITS.draws) liftLimit('draws per arm', LIFT_LIMITS.draws);
    }
  }
  let nodes = 0; let bytes = 0;
  const stack = [[receipt, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (++nodes > LIFT_LIMITS.nodes) liftLimit('nodes', LIFT_LIMITS.nodes);
    if (value && typeof value === 'object') {
      if (depth > LIFT_LIMITS.depth) liftLimit('depth', LIFT_LIMITS.depth);
      const keys = Object.keys(value);
      if (keys.length > LIFT_LIMITS.nodes) liftLimit('nodes', LIFT_LIMITS.nodes);
      bytes += 2 + Math.max(0, keys.length - 1);
      for (const key of keys) {
        if (!Array.isArray(value)) {
          if (Buffer.byteLength(key) > LIFT_LIMITS.stringBytes) liftLimit('string bytes', LIFT_LIMITS.stringBytes);
          bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
        }
        stack.push([value[key], depth + 1]);
      }
    } else {
      if (typeof value === 'string' && Buffer.byteLength(value) > LIFT_LIMITS.stringBytes) liftLimit('string bytes', LIFT_LIMITS.stringBytes);
      const json = JSON.stringify(value);
      bytes += json === undefined ? 0 : Buffer.byteLength(json);
    }
    if (bytes > LIFT_LIMITS.receiptBytes) liftLimit('receipt bytes', LIFT_LIMITS.receiptBytes);
  }
}
const LIFT_SCALE = 10n ** 324n;
function liftUnits(value) {
  const [mantissa, exp = '0'] = String(value).split('e');
  const places = (mantissa.split('.')[1] || '').length;
  return BigInt(mantissa.replace('.', '')) * 10n ** BigInt(324 + Number(exp) - places);
}
function liftAdd(a, b) {
  let n = a[0] * b[1] + b[0] * a[1]; let d = a[1] * b[1];
  let x = n < 0n ? -n : n; let y = d;
  while (y) { const remainder = x % y; x = y; y = remainder; }
  n /= x || 1n; d /= x || 1n;
  return [n, d];
}
function liftDifference(a, b) { return liftAdd(a, [-b[0], b[1]]); }
function liftRounded(fraction) {
  const sign = fraction[0] < 0n ? -1n : 1n;
  const scaled = fraction[0] * sign * 1000000n;
  return Number(sign * ((2n * scaled + fraction[1]) / (2n * fraction[1]))) / 1e6;
}
function liftNumber(fraction) {
  const digits = (fraction[0] * LIFT_SCALE / fraction[1]).toString().padStart(325, '0');
  return Number(digits.slice(0, -324) + '.' + digits.slice(-324));
}
function liftPairs(receipt) {
  const pairs = new Map();
  for (const row of receipt.results.cases) {
    const pair = pairs.get(row.id) || { id: row.id };
    if (pair[row.mode]) liftRefuse('Ambiguous receipt: duplicate case id and mode.', 'AMBIGUOUS_RECEIPT');
    pair[row.mode] = row;
    if (row.case_status && row.case_status !== 'ok' && !pair.failed) pair.failed = row;
    pairs.set(row.id, pair);
  }
  return [...pairs.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function liftEligibilityReasons(receipt) {
  const reasons = [];
  if (receipt.verification_level !== 'TESTED') reasons.push('Receipt is below TESTED.');
  if (!receipt.run.answered_by || receipt.run.answered_by.kind !== 'model') reasons.push('A model did not answer this receipt.');
  if (receipt.run.preset) reasons.push('This is a smoke receipt.');
  if (receipt.run.status === 'incomplete') reasons.push('The run is incomplete.');
  const cases = receipt.results.cases;
  if (['with_skill', 'baseline'].some(mode => new Set(cases.filter(c => c.mode === mode).map(c => c.id)).size < receipt.suite.case_count)) reasons.push('The recorded suite is narrowed.');
  if (typeof receipt.comparison.delta !== 'number') reasons.push('The receipt has no numeric comparison.');
  const same = liftPairs(receipt).filter(p => !p.failed).every(p => {
    const w = p.with_skill; const b = p.baseline;
    return w && b && w.judge && b.judge && w.judge.rubric_hash && w.judge.rubric_hash === b.judge.rubric_hash
      && w.judge.model_id === b.judge.model_id && w.judge.model_id === receipt.run.judge.model_id;
  });
  if (!same) reasons.push('Grading models or rubric hashes differ between the arms.');
  return reasons;
}
function liftArm(row) {
  const g = row && row.generation;
  if (!g || !Array.isArray(g.draws)) return null;
  const measured = g.draws.filter(d => d.status === 'measured');
  if (new Set(g.draws.map(d => d.draw_index)).size !== g.draws.length) liftRefuse('Ambiguous draw indices in a case arm.');
  if (g.n_drawn !== g.draws.length || g.n_measured !== measured.length || g.n_unmeasured !== g.draws.length - measured.length) liftRefuse('Contradictory draw status counts in a case arm.');
  if (!measured.length || measured.some(d => !Number.isFinite(d.mean) || d.mean < 0 || d.mean > 1)) return null;
  const values = measured.map(d => d.mean).sort((a, b) => a - b);
  const exact = [values.reduce((sum, n) => sum + liftUnits(n), 0n), LIFT_SCALE * BigInt(values.length)];
  const m = liftNumber(exact);
  const sd = values.length < 2 ? null : Math.round(Math.sqrt(values.reduce((s, n) => s + (n - m) ** 2, 0) / (values.length - 1)) * 1e6) / 1e6;
  return { exact, display: { mean: liftRounded(exact), sd, n: values.length, drawn: g.draws.length, lost: g.draws.length - values.length } };
}
function liftSuite(pairs) {
  if (!pairs.length || pairs.some(p => !p.w || !p.b)) return null;
  const arm = name => {
    const sum = pairs.reduce((s, p) => liftAdd(s, p[name].exact), [0n, 1n]);
    return [sum[0], sum[1] * BigInt(pairs.length)];
  };
  const w = arm('w'); const b = arm('b'); const delta = liftDifference(w, b);
  return { delta, display: { withSkill: liftRounded(w), baseline: liftRounded(b), lift: liftRounded(delta), caseCount: pairs.length } };
}
function liftBreakdown(receipt) {
  assertLiftLimits(receipt);
  if (duplicateCaseRows(receipt).length) liftRefuse('Ambiguous receipt: duplicate case id and mode.', 'AMBIGUOUS_RECEIPT');
  const validation = validateReceipt(receipt);
  if (!validation.valid) liftRefuse('Invalid receipt schema; lift breakdown unavailable.');
  if (!verifyReceiptHash(receipt)) liftRefuse('Invalid receipt hash; lift breakdown unavailable.');
  const pairs = liftPairs(receipt).map(p => ({ ...p, w: liftArm(p.with_skill), b: liftArm(p.baseline) }));
  const included = pairs.filter(p => !p.failed);
  const full = liftSuite(included);
  const eligibilityReasons = liftEligibilityReasons(receipt);
  const canCarry = !eligibilityReasons.length && full && included.length >= 2 && included.every(p => !p.w.display.lost && !p.b.display.lost);
  const evidence = [];
  for (const p of pairs) if (!p.failed && p.w && p.b) for (const [mode, a] of [['with_skill', p.w], ['baseline', p.b]]) {
    const original = p[mode];
    const derived = { ...original, generation: { ...original.generation, mean: a.display.mean, sd: a.display.sd || 0 } };
    const band = bandOf(derived);
    evidence.push({ ...derived, mean: band.mean, stddev: band.sd,
      generation: { ...derived.generation,
        draws: [...derived.generation.draws].sort((a, b) => (a.mean || 0) - (b.mean || 0) || a.draw_index - b.draw_index) } });
  }
  const bounded = new Map(readCases({ results: { cases: evidence } }).map(c => [c.id, c]));
  const rows = pairs.map(p => {
    const w = p.w && p.w.display; const b = p.b && p.b.display;
    const left = full && !p.failed ? liftSuite(included.filter(c => c.id !== p.id)) : null;
    let state = 'unavailable';
    if (!eligibilityReasons.length && !p.failed && w && b) {
      const rule = w.n < 2 || b.n < 2 ? { state: 'underpowered' } : bounded.get(p.id);
      const mapping = { 'separated-up': 'helps', 'separated-down': 'hurts', 'not-separated': 'no-separation', underpowered: 'underpowered', inconclusive: 'inconclusive' };
      state = mapping[rule && rule.state] || 'unavailable';
    }
    let reason = p.failed ? 'Case excluded: ' + p.failed.case_status + '. ' + (p.failed.reason || 'No measured result.')
      : eligibilityReasons.length ? eligibilityReasons.join(' ') : state === 'unavailable' ? 'Draw evidence is unavailable for this case.'
      : state === 'no-separation' ? 'No separation detected at this sample size; this is not evidence that nothing changed.'
      : state === 'underpowered' ? UNDERPOWERED_LINE
      : state === 'inconclusive' ? 'Separation on measured draws is not shown to hold for every score of the lost draws.'
      : 'Separation detected under the existing rule at this sample size.';
    if (w && b && (w.lost || b.lost)) reason += ' Lost draws: ' + w.lost + ' with the skill; ' + b.lost + ' baseline.';
    return { id: p.id, withSkill: w, baseline: b,
      delta: !p.failed && p.w && p.b ? liftRounded(liftDifference(p.w.exact, p.b.exact)) : null,
      state, reason, leaveOneOut: left ? left.display : null,
      carriesLift: canCarry && !p.failed ? full.delta[0] > 0n && left.delta[0] <= 0n : null };
  });
  return { receiptHash: receipt.receipt_hash, caseCount: pairs.length, includedCount: included.length,
    eligibilityReasons, excluded: rows.filter(c => pairs.find(p => p.id === c.id).failed).map(c => ({ id: c.id, reason: c.reason })),
    lift: full ? full.display.lift : null, rows,
    hurtCases: rows.filter(c => c.state === 'hurts').sort((a, b) => a.delta - b.delta || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(c => c.id) };
}
const LIFT_STATES = { helps: 'Helps under the rule', hurts: 'Hurts under the rule', 'no-separation': 'No separation detected',
  underpowered: UNDERPOWERED_LINE, inconclusive: 'Inconclusive on lost draws', unavailable: 'Unavailable' };
const liftCarrier = value => value === true ? 'Removing this case leaves no positive measured lift'
  : value === false ? 'Does not carry the positive measured lift' : 'Not assessed';
const liftFigure = n => n == null ? 'n/a' : n.toFixed(3);
const LIFT_NOTE = 'Recorded draw scores, with the sample spread across answers. Cases have equal weight. Removing a case recomputes both arm means from the remaining draws. Positivity is decided before reporting rounds the figures. These figures describe this receipt at this sample size; they predict no future result.';
function liftOutput(text) {
  if (Buffer.byteLength(text) > LIFT_LIMITS.outputBytes) liftLimit('output bytes', LIFT_LIMITS.outputBytes);
  return text;
}
function liftLabel(label) {
  if (Buffer.byteLength(String(label)) > LIFT_LIMITS.identifierBytes) liftLimit('report label bytes', LIFT_LIMITS.identifierBytes);
}
function liftAttempt(receipt) {
  try { return liftBreakdown(receipt); } catch (e) {
    if (e.code === 'AMBIGUOUS_RECEIPT') throw e;
    return { error: e.message };
  }
}
function liftCells(row) {
  const w = row.withSkill; const b = row.baseline;
  return [row.id, liftFigure(w && w.mean), liftFigure(w && w.sd), liftFigure(b && b.mean), liftFigure(b && b.sd), liftFigure(row.delta),
    ...[w && w.n, w && w.drawn, w && w.lost, b && b.n, b && b.drawn, b && b.lost].map(n => n == null ? 'n/a' : String(n)),
    LIFT_STATES[row.state], liftFigure(row.leaveOneOut && row.leaveOneOut.lift), liftCarrier(row.carriesLift), row.reason];
}
function renderLiftHtml(breakdown) {
  if (breakdown.error) return '<section data-field="lift-breakdown"><h4>Lift by case</h4><p>Lift breakdown unavailable: ' + esc(breakdown.error) + '</p></section>';
  const fields = ['case', 'with-mean', 'with-sd', 'baseline-mean', 'baseline-sd', 'delta', 'with-n', 'with-drawn', 'with-lost', 'baseline-n', 'baseline-drawn', 'baseline-lost', 'state', 'leave-lift', 'carrier', 'reason'];
  const headings = ['Case', 'With mean', 'With spread', 'Baseline mean', 'Baseline spread', 'Difference', 'With measured', 'With drawn', 'With lost', 'Baseline measured', 'Baseline drawn', 'Baseline lost', 'State', 'Lift without case', 'Carries lift', 'Reason'];
  const rows = breakdown.rows.map(row => '<tr data-lift-case="' + esc(row.id) + '">' + liftCells(row).map((s, i) => i === 0 ? '<th scope="row">' + esc(s) + '</th>' : '<td data-lift-value="' + fields[i] + '">' + esc(s) + '</td>').join('') + '</tr>');
  return liftOutput('<section data-field="lift-breakdown"><h4>Lift by case</h4><p>' + LIFT_NOTE + '</p><p>Lift from recorded draws: ' + liftFigure(breakdown.lift) + '. Included cases: ' + breakdown.includedCount + ' of ' + breakdown.caseCount + '.</p>'
    + (breakdown.eligibilityReasons.length ? '<p>' + esc(breakdown.eligibilityReasons.join(' ')) + '</p>' : '')
    + '<div class="lift-scroll"><table><caption>Recorded draw scores by case</caption><thead><tr>' + headings.map(s => '<th scope="col">' + s + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
    + '<p data-lift-hurts>Downward cases: ' + esc(breakdown.hurtCases.join(', ') || 'none') + '.</p></section>');
}
function liftMarkdownEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(new RegExp(String.fromCharCode(96), 'g'), '&#96;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\\/g, '&#92;');
}
function renderLiftMarkdown(breakdown, label) {
  liftLabel(label);
  const title = '\n## Lift breakdown: ' + liftMarkdownEscape(label) + '\n';
  if (breakdown.error) return title + '\nLift breakdown unavailable: ' + liftMarkdownEscape(breakdown.error) + '\n';
  const header = '| case | with mean | with spread | baseline mean | baseline spread | difference | with measured | with drawn | with lost | baseline measured | baseline drawn | baseline lost | state | lift without case | carries lift | reason |';
  const output = title + '\n' + LIFT_NOTE + '\n\nLift from recorded draws: ' + liftFigure(breakdown.lift) + '. Included cases: ' + breakdown.includedCount + ' of ' + breakdown.caseCount + '.\n\n'
    + (breakdown.eligibilityReasons.length ? liftMarkdownEscape(breakdown.eligibilityReasons.join(' ')) + '\n\n' : '')
    + header + '\n|' + Array(16).fill('---').join('|') + '|\n'
    + breakdown.rows.map(row => '| ' + liftCells(row).map(liftMarkdownEscape).join(' | ') + ' |').join('\n')
    + '\n\nDownward cases: ' + liftMarkdownEscape(breakdown.hurtCases.join(', ') || 'none') + '.\n';
  try { return liftOutput(output); } catch (error) {
    if (error.code !== 'LIFT_LIMIT') throw error;
    return title + '\nLift breakdown unavailable: ' + liftMarkdownEscape(error.message) + '\n';
  }
}

module.exports = { renderView, isViewPage, staleLine, GENERATOR, sideBySide, firstLookOf, firstLookHtml, liftBreakdown, liftEligibilityReasons, LIFT_LIMITS, assertLiftLimits, liftLabel, liftOutput, liftAttempt, renderLiftHtml, renderLiftMarkdown };
