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
// to date is lib/stale.js staleReport's own reading, with the options `driftproof stale` takes. The
// look is the site's receipt: its tokens (lib/view-tokens.js) and its band plot (lib/band-plot.js),
// both held equal to the site's files by spec 128's gate.

const fs = require('fs');
const path = require('path');
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

// Whether a receipt is up to date, in the stale check's own words (spec 128 R-7).
function staleLine(s) {
  if (s.status === 'current') {
    const adv = (s.advisories || [])[0];
    return { status: 'current', text: `Up to date, by the stale check${adv ? `; a newer model is out: ${adv.model_id}, released ${adv.released}` : ''}.` };
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
.hatch-defs { position: absolute; width: 0; height: 0; }`;

// Selecting a cell shows its sheets. The page reads without it: the first cell's are shown.
const SCRIPT = `(function () {
  var cells = document.querySelectorAll('button.cell');
  function pick(b) {
    cells.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    document.querySelectorAll('section.sel').forEach(function (s) { s.hidden = s.getAttribute('data-cell') !== b.getAttribute('data-cell'); });
  }
  cells.forEach(function (b) { b.addEventListener('click', function () { pick(b); }); });
})();`;

// The page over a directory. Returns { html, receipts } and html null when it holds no receipt.
function renderView(dir, { now = new Date(), label = dir, stale = {} } = {}) {
  const found = collect(dir);
  if (!found.length) return { html: null, receipts: 0 };
  const report = staleReport(found.map((x) => x.file), stale);
  const entries = found.map((x, i) => {
    const s = report.receipts[i];
    const rel = path.relative(dir, x.file).split(path.sep).join('/');
    if (s.error) return { rel, error: s.error };
    const run = x.receipt.run || {};
    return { rel, receipt: x.receipt, plain: plainOf(x.receipt), stale: staleLine(s), date: String(run.date_utc || ''), skill: String((x.receipt.skill || {}).name || 'unnamed skill'), model: String(run.model_id || 'unknown model') };
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
  const keyStates = ['PASSED', 'NO_EFFECT', 'UNDERPOWERED', ...['UNDERPOWERED_CASES', 'REGRESSED', 'INCONCLUSIVE', 'REPORTED', 'SMOKE', 'NOT_MEASURED', 'PRE_ANSWERED_BY'].filter((s) => counts[s])];
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
  const sheet = (e) => {
    const { cell, basis } = caseCellOf(e.receipt);
    const band = (b) => (b ? `${b.mean.toFixed(3)} ± ${b.sd.toFixed(3)}` : 'no score');
    const samples = ((e.receipt.run || {}).judge || {}).samples;
    // Answers per arm (AC-4, F-3): each test task's first row per arm, as caseCellOf reads the one
    // task, its draws summed over the test tasks; no row when any task lacks a count.
    const cases = ((e.receipt.results || {}).cases || []).filter((c) => !c.case_status || c.case_status === 'ok');
    const ids = [...new Set(cases.map((c) => c.id))];
    const nTasks = ids.length;
    const armN = (mode) => { const bs = ids.map((id) => bandOf(cases.find((c) => c.id === id && c.mode === mode))); return bs.length && bs.every((b) => b && Number.isInteger(b.n)) ? bs.reduce((t, b) => t + b.n, 0) : null; };
    const nArm = [armN('with_skill'), armN('baseline')];
    const answers = nArm.every((n) => Number.isInteger(n))
      ? `<div class="row"><span class="k">Answers</span><span class="v" data-field="answers">${nArm[0]} with the skill, ${nArm[1]} without${nTasks > 1 ? `, across ${nTasks} test tasks` : ''}${Number.isInteger(samples) ? `, each scored ${samples} ${samples === 1 ? 'time' : 'times'}` : ''}</span></div>\n` : '';
    const level = typeof e.receipt.verification_level === 'string' ? e.receipt.verification_level : 'not recorded';
    const said = basis === 'draws' ? 'The bars are the spread of the scores across the answers to its one test task.' : 'The bars are the spread of the scores across its test tasks, as the site draws a receipt.';
    return `<article class="sheet" data-file="${esc(e.rel)}" data-state="${e.plain.state}">
<h3>${esc(e.skill)} · ${esc(rowLabel(e))}</h3>
<div class="center"><span class="stamp v-${e.plain.state}" data-field="label">${esc(e.plain.label)}</span></div>
<p class="said" data-field="sentence">${esc(e.plain.sentence)}</p>
${e.plain.detail ? `<p class="detail" data-field="detail">${esc(e.plain.detail)}</p>\n` : ''}<div class="band">${plot(e, cell, `${e.skill} on ${e.model}, ${e.rel}`)}</div>
<p class="basis">${esc(said)}</p>
<div class="row"><span class="k">Model</span><span class="v">${esc(e.model)}</span></div>
<div class="row"><span class="k">Verification level</span><span class="v" data-field="verification">${esc(level)}</span></div>
${answers}<div class="row"><span class="k">With / without</span><span class="v">${esc(`${band(cell.skill)} / ${band(cell.baseline)}`)}</span></div>
<div class="row"><span class="k">Up to date?</span><span class="v stale" data-field="stale" data-status="${esc(e.stale.status)}">${esc(e.stale.text)}</span></div>
<div class="row"><span class="k">Run</span><span class="v">${esc(e.date || 'undated')}</span></div>
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
  return { html, receipts: entries.length };
}

module.exports = { renderView, isViewPage, staleLine, GENERATOR };
