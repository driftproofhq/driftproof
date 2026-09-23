// SPDX-License-Identifier: Apache-2.0
'use strict';

// The badge, drawn (spec 036).
//
// The shields endpoint JSON (lib/verdict.js badgeEndpoint) carries a label, a message
// and a colour, which is all a shields badge can hold. This draws the badge itself, so
// it can show what a reader needs at a glance: the state, the model, the date, the lift
// and its uncertainty. Four segments, left to right:
//
//   driftproof | <state label> | <model> · <date> | lift <+0.000> <± 0.000 | no ±>
//
// The fourth segment carries the lift ONLY for a state that measured one. UNDERPOWERED and
// NOT_MEASURED carry the draws taken against the draws needed instead (A-036-2):
//
//   driftproof | not enough draws | <model> · <date> | 3 draws of 87 needed
//
// THE WORDS ARE HUMAN; THE TOKENS ARE DATA. What a reader sees is a label (passing, not
// enough draws); the machine token the Action and the differ publish sits on the root
// element as data-verdict, with the receipt hash beside it, and never in the text.
//
// UNDERPOWERED IS DRAWN AS THE HONEST STATE, not as a failure: a calm indigo no other
// state uses, an open hatch over it, a dashed edge around it, and the words "not enough
// draws". Every state's text is white on a fill it clears 4.5:1 against, hatch included.
//
// Text widths are fixed with textLength, so a text's rendered box is the width this file
// allots it whatever font the viewer has, and it cannot spill out of its segment.

const { receiptVerdict, shortModel, receiptDrawsTaken } = require('./verdict');

const INK = '#ffffff';
const BRAND = '#24292f';
const DETAIL = '#4b5563';
const EFFECT = '#374151';
const STATE = {
  PASSED: { fill: '#1a7f37' },
  REGRESSED: { fill: '#b42318' },
  UNDERPOWERED: { fill: '#3538cd', hatch: '#444ce7', edge: '#a4bcfd' },
  NO_EFFECT: { fill: '#57606a' },
  NOT_MEASURED: { fill: '#656d76' },
};
const LABELS = {
  PASSED: 'passing',
  REGRESSED: 'regressed',
  UNDERPOWERED: 'not enough draws',
  NO_EFFECT: 'no separation detected',
  NOT_MEASURED: 'not measured',
};

const H = 20;
const PAD = 7;
const CHAR = 6.6;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textW = (s) => Math.round(String(s).length * CHAR * 10) / 10;

// A LIFT FIGURE IS A MEASUREMENT, so only a state that measured one may print it
// (spec 036 A-036-2). UNDERPOWERED says the receipt's draws cannot resolve a shift of the
// effect floor, and NOT_MEASURED says the receipt carries no verdict at all. A lift beside
// either is the badge answering, in its most legible segment, a question the state has just
// said it cannot answer -- and a reader who takes one figure from a badge takes that one.
// Those two states print what the reader can act on instead: the draws taken against the
// draws that would have been needed.
function effectText(receipt, v) {
  const c = receipt.comparison || {};
  if (v.verdict === 'UNDERPOWERED' || v.verdict === 'NOT_MEASURED') return drawsText(receipt, v);
  const lift = typeof c.delta === 'number' ? `lift ${c.delta >= 0 ? '+' : '-'}${Math.abs(c.delta).toFixed(3)}` : 'no lift';
  const unc = typeof c.delta_uncertainty === 'number' ? `± ${c.delta_uncertainty.toFixed(3)}`
    : c.delta_uncertainty_unavailable === 'single_case' ? 'no ± (1 case)' : 'no ±';
  return `${lift} ${unc}`;
}

// Draws taken against draws needed, in the badge's words. The needed count is
// receiptDrawsNeeded's, the same figure drawsLine prints in a sentence, so the badge and
// the page cannot say two different numbers. Where no count exists the badge says which
// of the two reasons it is, rather than printing a bare figure or nothing at all.
//
// BOTH NUMBERS ARE ONE CASE'S (A-036-7). Where a case sets the draws needed, the draws taken
// are that case's own, which receiptDrawsNeeded carries as `taken`. This read the smallest
// over every readable case, so a receipt whose binding case drew 4 and whose other case drew
// 2 badged "2 draws of 5 needed": a 2 from a case the 5 does not belong to. Where no case sets
// the draws needed (NOT_MEASURED carries no verdict to compute one from) there is no binding
// case, and the smallest over every readable case is the figure.
function drawsText(receipt, v) {
  const d = v.drawsNeeded;
  const taken = d ? d.taken : receiptDrawsTaken(receipt);
  if (taken === null || taken === undefined) return 'no draws recorded';
  const draws = `${taken} ${taken === 1 ? 'draw' : 'draws'}`;
  if (!d) return `${draws}, needed not computed`;
  if (typeof d.value === 'number') return `${draws} of ${d.value} needed`;
  return `${draws}, no count at these spreads`;
}

function badgeSvg(receipt, { href = null } = {}) {
  const v = receiptVerdict(receipt);
  const state = STATE[v.verdict];
  const label = LABELS[v.verdict];
  const model = shortModel((receipt.run || {}).model_id);
  const date = String((receipt.run || {}).date_utc || '').slice(0, 10);
  const segs = [
    { seg: 'brand', text: 'driftproof', fill: BRAND },
    { seg: 'state', text: label, fill: state.fill },
    { seg: 'detail', text: `${model} · ${date}`, fill: DETAIL },
    { seg: 'effect', text: effectText(receipt, v), fill: EFFECT },
  ];
  let x = 0;
  for (const s of segs) { s.w = Math.round(textW(s.text) + 2 * PAD); s.x = x; x += s.w; }
  const width = x;
  const title = `driftproof: ${label} on ${model}, ${date}, ${effectText(receipt, v)}`;
  const L = [];
  L.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(title)}" data-verdict="${v.verdict}" data-receipt-hash="${esc(receipt.receipt_hash || '')}">`);
  L.push(`<title>${esc(title)}</title>`);
  if (state.hatch) {
    L.push(`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${state.hatch}" stroke-width="3"/></pattern></defs>`);
  }
  if (href) L.push(`<a href="${esc(href)}">`);
  for (const s of segs) {
    const isState = s.seg === 'state';
    const edge = isState && state.edge ? ` stroke="${state.edge}" stroke-width="1" stroke-dasharray="3 2"` : '';
    L.push(`<rect data-seg="${s.seg}" x="${s.x}" y="0" width="${s.w}" height="${H}" fill="${s.fill}"${edge}/>`);
    if (isState && state.hatch) L.push(`<rect data-seg="state-hatch" x="${s.x}" y="0" width="${s.w}" height="${H}" fill="url(#hatch)" opacity="0.35"/>`);
  }
  for (const s of segs) {
    L.push(`<text data-seg="${s.seg}" x="${s.x + PAD}" y="14" fill="${INK}" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" textLength="${textW(s.text)}" lengthAdjust="spacingAndGlyphs">${esc(s.text)}</text>`);
  }
  if (href) L.push('</a>');
  L.push('</svg>');
  return L.join('\n') + '\n';
}

module.exports = { badgeSvg, LABELS, STATE };
