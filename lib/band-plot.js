// SPDX-License-Identifier: Apache-2.0
'use strict';

// lib/band-plot.js: the site's band plot, for the view page (spec 128 R-8).
//
// A COPY, HELD EQUAL. scripts/band-plot.mjs draws every band plot on the site, and the npm package
// does not carry scripts/ or docs/. So the geometry, the cell and renderCell below are that file's,
// taken from it as they stand (converted to CommonJS, reading its token block from text instead of
// from docs/tokens.css), and spec 128's gate (AC-7) renders every tracked receipt's cell at every
// size through both and holds the bytes equal. The refactor that makes scripts/band-plot.mjs import
// this module, so there is one copy again, is left to the chain's build after specs 125 and 127.
//
// Two functions are the view's own: caseCellOf, the cell a single receipt's sheet draws, and
// renderRows, the timeline. Both draw with the geometry, the classes and the tokens below.

const { bandOf } = require('./reuse');
const { EFFECT_FLOOR } = require('../config');
const { TOKENS_CSS } = require('./view-tokens');

// ── the geometry, published ──────────────────────────────────────────────────
//
// PAD is at least four dot diameters at every size, so a DOT drawn at 0 or at 1
// stands clear of the edge rather than against it. The geometry that shipped
// before spec 020's fix pass was inset by 10 in a 320-wide box, and the
// zero-width band of the bundled example receipt hung off the right edge as a
// clipped sliver on the front page, in the playground and on every thumbnail.
const SIZES = {
  hero: { W: 520, H: 160, PAD: 28, DOT: 6, band: 20, labelA: 34, barA: 40, labelB: 84, barB: 90, AXIS: 124, tick: 142, verdict: 16, floorTop: 26 },
  card: { W: 260, H: 72, PAD: 20, DOT: 5, band: 13, labelA: 11, barA: 14, labelB: 39, barB: 42, AXIS: 58, tick: 70, verdict: 11, floorTop: 12 },
  play: { W: 640, H: 200, PAD: 32, DOT: 6, band: 20, labelA: 52, barA: 58, labelB: 98, barB: 104, AXIS: 150, tick: 168, verdict: 18, floorTop: 44 },
};
// The one geometry every other drawing of these bands has to match. It is the
// playground's, because the playground is the only other drawing: it may not
// import anything, so spec 020 AC-41 reads its three numbers and compares them
// with these rather than trusting them to agree.
const PLOT = { W: SIZES.play.W, H: SIZES.play.H, PAD: SIZES.play.PAD, AXIS: SIZES.play.AXIS, DOT: SIZES.play.DOT };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── the token block, read from the token text ────────────────────────────────
const TOKEN_OPEN = '/* driftproof:tokens */';
const TOKEN_CLOSE = '/* driftproof:/tokens */';
const NEEDED = [
  'paper', 'paper-2', 'ink', 'ink-muted', 'rule', 'arm-baseline', 'accent', 'arm-skill', 'accent-ink',
  'refused', 'state-separated', 'state-overlapping', 'state-refused',
  'sans', 'mono', 'values', 'radius', 't-plot', 't-plot-lg',
];
function tokenBlock(css = TOKENS_CSS) {
  const a = css.indexOf(TOKEN_OPEN);
  const b = css.indexOf(TOKEN_CLOSE);
  if (a < 0 || b < 0) throw new Error('the token text carries no fenced token block');
  const block = css.slice(a, b);
  const lines = NEEDED.map((name) => {
    const m = block.match(new RegExp(`^\\s*(--${name}:[^\\n]*;)`, 'm'));
    if (!m) throw new Error(`the token block declares no --${name}`);
    return `  ${m[1]}`;
  });
  return `${TOKEN_OPEN}\nsvg {\n${lines.join('\n')}\n}\n${TOKEN_CLOSE}`;
}

// THE HATCH, DEFINED ONCE. The refused state is a grey fill under one 45-degree
// hatch: a band nobody measured should not look like a band somebody did.
const HATCH = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<rect width="6" height="6" fill="var(--refused)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--paper)" stroke-width="2"/>
</pattern></defs>`;

// The arm aggregate: mean of the per-case means, spread as the sample standard
// deviation of those means. Returns null when the arm has no measured case,
// which is what makes a refusal a refusal rather than a zero.
function arm(receipt, mode) {
  const cases = ((receipt.results || {}).cases || []).filter((c) => c.mode === mode);
  const means = cases.map(bandOf).filter(Boolean).map((b) => b.mean);
  if (!means.length) return null;
  const mean = means.reduce((s, v) => s + v, 0) / means.length;
  const sd = means.length > 1
    ? Math.sqrt(means.reduce((s, v) => s + (v - mean) ** 2, 0) / (means.length - 1))
    : 0;
  return { mean, sd, lo: mean - sd, hi: mean + sd, n: means.length };
}

function cellOf(receipt) {
  const baseline = arm(receipt, 'baseline');
  const skill = arm(receipt, 'with_skill');
  if (!baseline || !skill) return { state: 'refused', baseline, skill, delta: null };
  const overlap = baseline.lo <= skill.hi && skill.lo <= baseline.hi;
  const delta = skill.mean - baseline.mean;
  const state = (!overlap && Math.abs(delta) >= EFFECT_FLOOR) ? 'separated' : 'overlapping';
  return { state, baseline, skill, delta };
}

const LABEL = {
  separated: 'separated: the ranges do not overlap and the move clears the floor',
  overlapping: 'overlapping: no separation detected at this sample size',
  refused: 'refused: this cell returned no measurement',
};
const SHORT = { separated: 'separated', overlapping: 'overlapping', refused: 'refused' };
// THE BANDS ARE THE ARMS, ALWAYS: the ribbon's second pass without the skill, full ink with
// it, hatched where nothing was measured. The VERDICT is what changes colour, and it
// is a word rather than a bar. Painting the with-skill band by verdict made the
// picture argue its own conclusion, and made two plots of the same two numbers
// different pictures because a threshold fell on one side or the other.
const STATE_TOKEN = { separated: 'state-separated', overlapping: 'state-overlapping', refused: 'state-refused' };
const TICKS = [0, 0.25, 0.5, 0.75, 1];

function renderCell(cell, { title = 'band plot', size = 'hero', tokens = TOKENS_CSS } = {}) {
  const g = SIZES[size];
  if (!g) throw new Error(`unknown plot size: ${size}`);
  const X = (v) => g.PAD + clamp01(v) * (g.W - 2 * g.PAD);
  const { state, baseline, skill } = cell;

  // THE VALUE IS PRINTED ON ITS BAND (spec 038 AC-6, Instrument's plot drawn in ink). A band is
  // the mean plus and minus one spread, so its centre IS the mean, and the figure set at the
  // centre marks the mean with the number itself. Knocked out in receipt stock on the ink. A
  // band too narrow to hold its figure - a point, or a tight spread - prints it beside the band
  // on the same row, in ink on the ground, on whichever side has room.
  //
  // The width a figure needs is estimated at 0.62em a character plus a margin, which is wider
  // than the site's face and than the fallback an <img> plot sets it in (I-4), so a figure the
  // estimate calls inside is inside in both. spec 038 AC-3 measures it in a browser.
  const px = size === 'hero' ? 19 : 12;
  const fits = (chars) => chars * 0.62 * px + 10;
  const value = (band, y, arm) => {
    const s = band.mean.toFixed(3);
    const cy = (y + g.band / 2 + px / 3).toFixed(1);
    const lo = X(band.lo); const hi = X(band.hi); const at = X(band.mean);
    const cls = `value value-${arm}`;
    if (band.hi - band.lo > 0 && hi - lo >= fits(s.length)) {
      return `<text class="${cls} on-band" x="${at.toFixed(1)}" y="${cy}" text-anchor="middle">${s}</text>`;
    }
    const edgeR = Math.max(hi, at + g.DOT) + 5; const edgeL = Math.min(lo, at - g.DOT) - 5;
    const right = edgeR + fits(s.length) - 10 <= g.W - 2;
    return right
      ? `<text class="${cls} beside" x="${edgeR.toFixed(1)}" y="${cy}" text-anchor="start">${s}</text>`
      : `<text class="${cls} beside" x="${edgeL.toFixed(1)}" y="${cy}" text-anchor="end">${s}</text>`;
  };

  // A BAND OF ZERO WIDTH IS A POINT, and it is drawn as one: a filled dot with an outline, not a
  // bar padded up to a visible minimum (spec 020 AC-41). A band paints only the arm tokens
  // (spec 025 A-025-10), which since spec 038 are the ribbon's two passes, so neither is a hue.
  const bar = (band, y, cls, fill, arm) => {
    if (!band) {
      return `<rect class="${cls} unmeasured" x="${X(0).toFixed(1)}" y="${y}" width="${(X(1) - X(0)).toFixed(1)}" height="${g.band}" rx="${g.band / 2}" fill="url(#hatch)"/>`;
    }
    const lo = X(band.lo); const hi = X(band.hi);
    if (!(band.hi - band.lo > 0)) {
      return `<circle class="${cls} point" cx="${X(band.mean).toFixed(1)}" cy="${(y + g.band / 2).toFixed(1)}" r="${g.DOT}" fill="${fill}" stroke="var(--arm-baseline)" stroke-width="1.5"/>\n${value(band, y, arm)}`;
    }
    return `<rect class="${cls}" x="${lo.toFixed(1)}" y="${y}" width="${Math.max(2, hi - lo).toFixed(1)}" height="${g.band}" rx="1.5" fill="${fill}"/>\n${value(band, y, arm)}`;
  };

  // THE FLOOR, DRAWN WHERE IT BITES: the baseline mean plus one floor, the point the with-skill
  // mean has to clear. A cell with no baseline falls back to the floor read on the axis itself.
  const floorAt = baseline ? clamp01(baseline.mean + EFFECT_FLOOR) : EFFECT_FLOOR;
  const alt = `${title}. ${LABEL[state]}. `
    + (baseline ? `Without the skill, ${baseline.mean.toFixed(3)} plus or minus ${baseline.sd.toFixed(3)}. ` : 'Without the skill, no measurement. ')
    + (skill ? `With the skill, ${skill.mean.toFixed(3)} plus or minus ${skill.sd.toFixed(3)}.` : 'With the skill, no measurement.');

  // THE GRATICULE: one rule at each quarter, from above the first band to the axis, so a figure
  // on a band can be read against the scale without a ruler.
  const grat = TICKS.map((t) => `<line class="grat" x1="${X(t).toFixed(1)}" y1="${g.floorTop}" x2="${X(t).toFixed(1)}" y2="${g.AXIS}"/>`).join('\n');
  const ticks = TICKS.map((t) => {
    const anchor = t === 0 ? 'start' : t === 1 ? 'end' : 'middle';
    return `<text class="tick" x="${X(t).toFixed(1)}" y="${g.tick}" text-anchor="${anchor}">${t}</text>`;
  }).join('\n');

  // EVERY RULE IS SCOPED TO THIS PLOT'S OWN CLASSES. The homepage inlines the hero plot, and an
  // inline <style> reaches every SVG on its page: unscoped, this plot's axis rule repainted the
  // playground island's axis (spec 025 AC-3, measured by its --final under A-025-22).
  const P = `.bandplot.is-${size}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.W} ${g.H}" width="100%" role="img" class="bandplot is-${size} state-${state}">
<title>${esc(alt)}</title>
<style>${tokenBlock(tokens)}
${P} text { font-family: var(--sans); font-size: var(--${size === 'hero' ? 't-plot-lg' : 't-plot'}); font-variant-numeric: tabular-nums lining-nums; }
${P} .tick { fill: var(--ink-muted); }
${P} .arm-label { font-style: italic; fill: var(--ink-muted); }
${P} .verdict { font-weight: 500; fill: var(--${STATE_TOKEN[state]}); }
${P} .value { font-weight: 500; fill: var(--ink); }
${P} .value.on-band { fill: var(--paper-2); }
${P} .grat { stroke: var(--rule); stroke-width: 1; }
${P} .floor { stroke: var(--ink-muted); stroke-width: 1; stroke-dasharray: 3 3; }
${P} .axis { stroke: var(--ink); stroke-width: 1; }
</style>
${HATCH}
${grat}
<line class="axis" x1="${X(0).toFixed(1)}" y1="${g.AXIS}" x2="${X(1).toFixed(1)}" y2="${g.AXIS}"/>
${ticks}
<line class="floor" x1="${X(floorAt).toFixed(1)}" y1="${g.floorTop}" x2="${X(floorAt).toFixed(1)}" y2="${g.AXIS}"/>
<text class="verdict" x="${X(1).toFixed(1)}" y="${g.verdict}" text-anchor="end">${SHORT[state]}</text>
<text class="arm-label" x="${X(0).toFixed(1)}" y="${g.labelA}">without the skill</text>
${bar(baseline, g.barA, 'band band-baseline', 'var(--arm-baseline)', 'baseline')}
<text class="arm-label" x="${X(0).toFixed(1)}" y="${g.labelB}">with the skill</text>
${bar(skill, g.barB, 'band band-skill', state === 'refused' ? 'url(#hatch)' : 'var(--arm-skill)', 'skill')}
</svg>
`;
}

// ── the view's own drawings (spec 128) ──────────────────────────────────────

// The cell a receipt's sheet draws (spec 128 R-6). A receipt with one test task is drawn with that
// task's two bands, the spread across its draws, which is what its verdict reads; a receipt with
// several is drawn as the site draws it, the spread across its tasks (cellOf). `basis` says which,
// so the page can say it in words.
function caseCellOf(receipt) {
  const cases = ((receipt && receipt.results) || {}).cases || [];
  const ids = [...new Set(cases.map((c) => c.id))];
  if (ids.length !== 1) return { cell: cellOf(receipt || {}), basis: 'tasks' };
  const one = (mode) => {
    const b = bandOf(cases.find((c) => c.id === ids[0] && c.mode === mode && (!c.case_status || c.case_status === 'ok')));
    return b ? { mean: b.mean, sd: b.sd, lo: b.lo, hi: b.hi, n: b.n } : null;
  };
  const baseline = one('baseline');
  const skill = one('with_skill');
  if (!baseline || !skill) return { cell: { state: 'refused', baseline, skill, delta: null }, basis: 'draws' };
  const overlap = baseline.lo <= skill.hi && skill.lo <= baseline.hi;
  const delta = skill.mean - baseline.mean;
  const state = (!overlap && Math.abs(delta) >= EFFECT_FLOOR) ? 'separated' : 'overlapping';
  return { cell: { state, baseline, skill, delta }, basis: 'draws' };
}

// THE TIMELINE: one row per receipt, in the order given (the view gives oldest first), each row the
// two bands its sheet draws, on one shared axis, with the play geometry's pad, dot and band height.
// Each row is a <g data-file> so a reader can tell which receipt it is.
function renderRows(rows, { title = 'timeline', tokens = TOKENS_CSS } = {}) {
  const g = SIZES.play;
  const LABEL_W = 160;
  const ROW = 2 * g.band + 16;
  const TOP = 10;
  const AXIS = TOP + rows.length * ROW + 4;
  const H = AXIS + 26;
  const X = (v) => LABEL_W + clamp01(v) * (g.W - LABEL_W - g.PAD);
  const bar = (band, y, cls, fill) => {
    if (!band) return `<rect class="${cls} unmeasured" x="${X(0).toFixed(1)}" y="${y}" width="${(X(1) - X(0)).toFixed(1)}" height="${g.band}" rx="${g.band / 2}" fill="url(#hatch)"/>`;
    if (!(band.hi - band.lo > 0)) return `<circle class="${cls} point" cx="${X(band.mean).toFixed(1)}" cy="${(y + g.band / 2).toFixed(1)}" r="${g.DOT}" fill="${fill}" stroke="var(--arm-baseline)" stroke-width="1.5"/>`;
    const lo = X(band.lo); const hi = X(band.hi);
    return `<rect class="${cls}" x="${lo.toFixed(1)}" y="${y}" width="${Math.max(2, hi - lo).toFixed(1)}" height="${g.band}" rx="1.5" fill="${fill}"/>`;
  };
  const said = (b) => (b ? `${b.mean.toFixed(3)} plus or minus ${b.sd.toFixed(3)}` : 'no measurement');
  const alt = `${title}. ` + rows.map((r) => `${r.label}: without the skill ${said(r.baseline)}, with the skill ${said(r.skill)}.`).join(' ');
  const grat = TICKS.map((t) => `<line class="grat" x1="${X(t).toFixed(1)}" y1="${TOP}" x2="${X(t).toFixed(1)}" y2="${AXIS}"/>`).join('\n');
  const ticks = TICKS.map((t) => `<text class="tick" x="${X(t).toFixed(1)}" y="${AXIS + 18}" text-anchor="${t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}">${t}</text>`).join('\n');
  const body = rows.map((r, i) => {
    const y = TOP + i * ROW;
    return `<g data-file="${esc(r.file)}">
<text class="row-label" x="0" y="${y + g.band + 4}">${esc(r.label)}</text>
${bar(r.baseline, y, 'band band-baseline', 'var(--arm-baseline)')}
${bar(r.skill, y + g.band + 2, 'band band-skill', 'var(--arm-skill)')}
</g>`;
  }).join('\n');
  const P = '.bandplot.is-rows';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.W} ${H}" width="100%" role="img" class="bandplot is-rows">
<title>${esc(alt)}</title>
<style>${tokenBlock(tokens)}
${P} text { font-family: var(--sans); font-size: var(--t-plot); font-variant-numeric: tabular-nums lining-nums; }
${P} .tick, ${P} .row-label { fill: var(--ink-muted); }
${P} .grat { stroke: var(--rule); stroke-width: 1; }
${P} .axis { stroke: var(--ink); stroke-width: 1; }
</style>
${HATCH}
${grat}
<line class="axis" x1="${X(0).toFixed(1)}" y1="${AXIS}" x2="${X(1).toFixed(1)}" y2="${AXIS}"/>
${ticks}
${body}
</svg>
`;
}

module.exports = { SIZES, PLOT, NEEDED, HATCH, tokenBlock, cellOf, renderCell, caseCellOf, renderRows };
