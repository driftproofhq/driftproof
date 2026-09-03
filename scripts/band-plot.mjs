#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/band-plot.mjs — one SVG per cell (spec 020 AC-7).
//
// THE PLOT IS THE VERDICT RULE, NOT A PICTURE OF IT. `bandOf` comes from
// lib/reuse.js and the floor from config.js, both imported. A second
// implementation of either would be a second rule, and the first thing anyone
// would learn from a disagreement is that the picture was lying.
//
// THE CELL BAND IS SUITE DISPERSION, which is the definition Report #007 states
// on its own page: the sample standard deviation of the per-case means across a
// suite's cases, per arm. It is NOT the standard error of the mean. Applied
// uniformly here so a plot of a v0.1 receipt and a plot of a v0.5 receipt mean
// the same thing; where a receipt records a per-draw band, that band is what
// `bandOf` returns per case and it feeds the same aggregate.
//
//   node scripts/band-plot.mjs            write docs/plots/*.svg
//   node scripts/band-plot.mjs --out DIR  write somewhere else
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { bandOf } = require('../lib/reuse.js');
const { EFFECT_FLOOR } = require('../config.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// THE GEOMETRY, PUBLISHED (spec 020 AC-41). PAD was 10, which put the 0 and 1
// ends of the axis 10 units from a 320-wide edge, and a band of zero width drawn
// there as a minimum-width bar hung off the right edge as a clipped sliver. The
// bundled example receipt is schema v0.1 - one score per case, no per-draw
// samples - so its with-skill arm IS a single point at 1.0, and that sliver was
// the picture on the front page, in the playground and on every index thumbnail.
//
// PAD is now four dot diameters, so a DOT drawn at 0 or at 1 stands clear of the
// edge rather than against it. The values are exported because
// docs/islands/band-playground.js draws the same receipt and may not import
// anything; the gate asserts its three numbers equal these.
const W = 320, H = 96, PAD = 22, AXIS = 74, DOT = 5;
export const PLOT = { W, H, PAD, AXIS, DOT };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const X = (v) => PAD + clamp01(v) * (W - 2 * PAD);

// Every receipt in the archive, at every schema version it was written under.
// `_index.json` is a report index, not a cell, and is not one.
export function receiptFiles(root = ROOT) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!e.name.endsWith('.json') || e.name.startsWith('_')) continue;
      out.push(f);
    }
  })(path.join(root, 'receipts'));
  return out;
}

export const keyOf = (file, root = ROOT) =>
  path.relative(path.join(root, 'receipts'), file).split(path.sep).join('--').replace(/\.json$/, '');

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

export function cellOf(receipt) {
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
  overlapping: 'overlapping: nothing moved beyond the noise',
  refused: 'refused: this cell returned no measurement',
};
const SHORT = { separated: 'separated', overlapping: 'overlapping', refused: 'refused' };
// --state-separated, --state-overlapping, --state-refused from docs/tokens.css.
const FILL = { separated: '#2E7A0B', overlapping: '#5A646E', refused: '#806300' };
const OUTLINE = '#14181D';  // --ink

export function renderCell(cell, { title = 'band plot' } = {}) {
  const { state, baseline, skill } = cell;
  // A BAND OF ZERO WIDTH IS A POINT, and it is drawn as one: a filled dot with an
  // outline, not a bar padded up to a visible minimum. A minimum-width bar is a
  // picture of a range the receipt does not record, and at the axis end it was a
  // sliver clipped by the edge. The outline is what keeps the dot legible where
  // the fill and the ground are close.
  const bar = (band, y, cls, fill) => {
    if (!band) return `<line class="${cls} unmeasured" x1="${X(0)}" y1="${y + 5}" x2="${X(1)}" y2="${y + 5}" stroke="#C3C9D0" stroke-width="2" stroke-dasharray="4 4"/>`;
    const lo = X(band.lo), hi = X(band.hi);
    // Zero width, on the band's own scale rather than on a pixel rounding of it.
    // A band with width keeps its two-unit visible minimum, because that is a
    // narrow RANGE and drawing it as a point would claim something else.
    if (!(band.hi - band.lo > 0)) {
      return `<circle class="${cls} point" cx="${X(band.mean).toFixed(1)}" cy="${y + 5}" r="${DOT}" fill="${fill}" stroke="${OUTLINE}" stroke-width="1.5"/>`;
    }
    return `<rect class="${cls}" x="${lo.toFixed(1)}" y="${y}" width="${Math.max(2, hi - lo).toFixed(1)}" height="10" rx="5" fill="${fill}"/>`
      + `<circle class="${cls} mean" cx="${X(band.mean).toFixed(1)}" cy="${y + 5}" r="2.5" fill="#FBFAF7"/>`;
  };
  const alt = `${title}. ${LABEL[state]}. `
    + (baseline ? `Without the skill, ${baseline.mean.toFixed(3)} plus or minus ${baseline.sd.toFixed(3)}. ` : 'Without the skill, no measurement. ')
    + (skill ? `With the skill, ${skill.mean.toFixed(3)} plus or minus ${skill.sd.toFixed(3)}.` : 'With the skill, no measurement.');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" class="bandplot state-${state}">
<title>${esc(alt)}</title>
<line x1="${X(0)}" y1="${AXIS}" x2="${X(1)}" y2="${AXIS}" stroke="#E2E0D8" stroke-width="1"/>
<text x="${X(0)}" y="${AXIS + 14}" font-size="9" fill="#5A646E" font-family="system-ui, sans-serif">0</text>
<text x="${X(1)}" y="${AXIS + 14}" font-size="9" fill="#5A646E" text-anchor="end" font-family="system-ui, sans-serif">1</text>
<text x="${X(0)}" y="14" font-size="9" fill="#5A646E" font-family="system-ui, sans-serif">without the skill</text>
${bar(baseline, 18, 'band band-baseline', '#1F2933')}
<text x="${X(0)}" y="44" font-size="9" fill="#5A646E" font-family="system-ui, sans-serif">with the skill</text>
${bar(skill, 48, 'band band-skill', FILL[state])}
<text x="${X(1)}" y="14" font-size="9" font-weight="600" text-anchor="end" fill="${FILL[state]}" font-family="system-ui, sans-serif">${SHORT[state]}</text>
</svg>
`;
}

function main() {
  const i = process.argv.indexOf('--out');
  const outDir = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(ROOT, 'docs', 'plots');
  fs.mkdirSync(outDir, { recursive: true });
  for (const stale of fs.readdirSync(outDir)) if (stale.endsWith('.svg')) fs.unlinkSync(path.join(outDir, stale));
  let n = 0;
  for (const f of receiptFiles()) {
    const receipt = JSON.parse(fs.readFileSync(f, 'utf8'));
    const key = keyOf(f);
    fs.writeFileSync(path.join(outDir, `${key}.svg`), renderCell(cellOf(receipt), { title: key.replace(/--/g, ' ') }));
    n++;
  }
  console.log(`${n} band plots written to ${path.relative(ROOT, outDir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
