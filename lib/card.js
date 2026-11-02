// SPDX-License-Identifier: Apache-2.0
'use strict';

// The result card (spec 628): one receipt drawn as one SVG, 600 by 315, the link-preview ratio, for a
// person to commit beside a badge or paste into a post.
//
// EVERY WORD OF THE RESULT IS lib/plain.js's. The stamp is plainOf's label and the sentence is plainOf's
// sentence, the words `driftproof view` gives the same receipt; this file holds no label of its own.
// The stamp's colour is the view's: the class `v-<state>` and the token its `.v-<state>` rule names.
//
// A LIFT FIGURE IS A MEASUREMENT (spec 036 A-036-2), so the card prints one only for a state that
// measured one, and not where the comparison is marked unreliable. A smoke run and a receipt below
// TESTED say so in plainOf's words, with no figure.
//
// A PUBLICATION LIMIT OUTRANKS THE WORDS. Report 015's router receipts are drawn with that report's
// label and reason (lib/report-015-publication.js), as the badge and the site draw them, with no lift
// and no band plot.
//
// THE CARD LOADS NOTHING. No script, no image, no font file; the one link is an `--href` the person
// gives. Colours are lib/view-tokens.js's values, resolved here, so a renderer that reads no CSS
// variable draws the same stamp. Text widths are fixed with textLength, as lib/badge-svg.js fixes
// them, so a text cannot spill out of the card whatever font the viewer has. Every string read from
// the receipt is escaped and made visible (lib/names.js invisibleShown); a name or a model is cut at
// 60 characters. The same receipt gives the same bytes: nothing here reads a clock.

const fs = require('fs');
const { RUNNER_VERSION } = require('../config');
const { plainOf } = require('./plain');
const { receiptVerdict, placeboReading, placeboLine } = require('./verdict');
const { cellOf, renderCell, SIZES } = require('./band-plot');
const { invisibleShown } = require('./names');
const { DECLARATIONS } = require('./view-tokens');
const { routerLimit, LABEL: ROUTER_LABEL, REASON: ROUTER_REASON } = require('./report-015-publication');
const { fakeToolCallWarning } = require('./text-capture');

// Whether a file is a card this command wrote, so --out may write over it and over nothing else.
const CARD_MARK = '<metadata>driftproof card</metadata>';
function isCardFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8').includes(CARD_MARK);
  } catch { return false; }
}

// The view's `.v-<state>` rules (lib/view.js), as a table: the token each paints and its border style.
// tests/card.test.js reads the rules from a page the view writes and holds this table equal to them.
const STAMP = {
  PASSED: { token: 'state-separated', dash: 'solid' },
  REGRESSED: { token: 'reg', dash: 'solid' },
  NO_EFFECT: { token: 'ink', dash: 'solid' },
  UNDERPOWERED: { token: 'state-overlapping', dash: 'dashed' },
  INCONCLUSIVE: { token: 'mixed', dash: 'dashed' },
  REPORTED: { token: 'state-refused', dash: 'dotted' },
  SMOKE: { token: 'state-refused', dash: 'dotted' },
  NOT_MEASURED: { token: 'state-refused', dash: 'dashed' },
  PRE_ANSWERED_BY: { token: 'state-refused', dash: 'dashed' },
  REFUSED: { token: 'state-refused', dash: 'dashed' },
};
const DASH = { solid: '', dashed: ' stroke-dasharray="6 3"', dotted: ' stroke-dasharray="2 3"' };

// A token's value, its var() references followed, from lib/view-tokens.js.
const TOKENS = Object.fromEntries(DECLARATIONS.map((d) => d.match(/^--([a-z0-9-]+):\s*(.*);$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
function tokenValue(name) {
  let v = TOKENS[name];
  for (let i = 0; i < 8 && /^var\(--[a-z0-9-]+\)$/.test(v || ''); i++) v = TOKENS[v.slice(6, -1)];
  if (!/^#[0-9A-Fa-f]{3,8}$/.test(v || '')) throw new Error(`the token --${name} resolves to no colour`);
  return v;
}

// The states that measured a lift (spec 036 A-036-2).
const MEASURED = ['PASSED', 'REGRESSED', 'NO_EFFECT'];

const W = 600;
const H = 315;
const PAD = 24;
const FONT = 'Verdana,DejaVu Sans,sans-serif';
const NAME_MAX = 60;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const chars = (s) => [...String(s)];
const cut = (s, n) => (chars(s).length > n ? `${chars(s).slice(0, n).join('')}…` : String(s));
// The width a text is given: lib/badge-svg.js's 6.6 at 11px, 0.6em a character, a little more for bold.
const textW = (s, size, bold) => Math.round(chars(s).length * size * (bold ? 0.66 : 0.6) * 10) / 10;
const perLine = (size, width) => Math.floor(width / (size * 0.6));

// One line of text, its width fixed and never past `max`.
function line(field, s, { x, y, size, fill, bold = false, anchor = null, max = W - 2 * PAD }) {
  if (!s) return '';
  const w = Math.min(textW(s, size, bold), max);
  return `<text data-field="${field}" x="${x}" y="${y}" fill="${fill}" font-family="${FONT}" font-size="${size}"${bold ? ' font-weight="bold"' : ''}${anchor ? ` text-anchor="${anchor}"` : ''} textLength="${w}" lengthAdjust="spacingAndGlyphs">${esc(s)}</text>`;
}

// Words to lines of at most `n` characters, at most `most` lines, the last cut with an ellipsis.
function wrap(s, n, most) {
  const lines = [];
  let cur = null;
  for (let word of String(s).split(' ')) {
    while (chars(word).length > n) {
      if (cur !== null) { lines.push(cur); cur = null; }
      lines.push(chars(word).slice(0, n).join(''));
      word = chars(word).slice(n).join('');
    }
    if (cur === null) cur = word;
    else if (chars(cur).length + 1 + chars(word).length <= n) cur += ` ${word}`;
    else { lines.push(cur); cur = word; }
  }
  if (cur !== null) lines.push(cur);
  if (lines.length <= most) return lines;
  const kept = lines.slice(0, most);
  kept[most - 1] = `${chars(kept[most - 1]).slice(0, n - 1).join('')}…`;
  return kept;
}

// The lift as lib/badge-svg.js prints it, for a state that measured one; otherwise null.
function liftText(receipt) {
  const c = receipt.comparison || {};
  if (typeof c.delta !== 'number') return null;
  const lift = `lift ${c.delta >= 0 ? '+' : '-'}${Math.abs(c.delta).toFixed(3)}`;
  const unc = typeof c.delta_uncertainty === 'number' ? `± ${c.delta_uncertainty.toFixed(3)}`
    : c.delta_uncertainty_unavailable === 'single_case' ? 'no ± (1 case)' : 'no ±';
  return `${lift} ${unc}`;
}

// The placebo line, when the receipt has a placebo arm.
function placeboOf(receipt) {
  const r = placeboReading(receipt);
  if (r.reading === 'NOT_MEASURED' && (r.notMeasured || []).includes('no_placebo')) return null;
  return placeboLine(r);
}

// An --href the card may carry: an http or https URL, or a relative path; no space or control
// character. A reason it may not, or null.
function hrefProblem(href) {
  const s = String(href);
  if (!s) return 'is empty';
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(s)) return 'holds a space or a control character';
  if (/^https?:\/\//i.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return 'names a scheme other than http or https';
  return null;
}

function cardSvg(receipt, { href = null } = {}) {
  if (href !== null && hrefProblem(href)) throw new Error(`--href ${hrefProblem(href)}`);
  const limit = routerLimit(receipt);
  const plain = plainOf(receipt);
  const label = plain.label;
  const state = limit ? 'NOT_MEASURED' : plain.state;
  const words = limit ? { label: ROUTER_LABEL, sentence: ROUTER_REASON } : { label, sentence: plain.sentence };
  const v = receiptVerdict(receipt);
  const lift = !limit && MEASURED.includes(v.verdict) && !fakeToolCallWarning(receipt) ? liftText(receipt) : null;
  const placebo = limit ? null : placeboOf(receipt);

  const run = receipt.run || {};
  const name = cut(invisibleShown((receipt.skill || {}).name || 'unnamed skill'), NAME_MAX);
  const model = cut(invisibleShown(run.model_id || 'unknown model'), NAME_MAX);
  const date = invisibleShown(String(run.date_utc || 'undated').slice(0, 10));
  const hash = invisibleShown(String(receipt.receipt_hash || ''));
  const stampLabel = invisibleShown(words.label);
  const sentence = invisibleShown(words.sentence);

  const ink = tokenValue('ink');
  const muted = tokenValue('ink-muted');
  const stamp = STAMP[state] || STAMP.REFUSED;
  const colour = tokenValue(stamp.token);
  const title = `driftproof card: ${stampLabel}. ${sentence} ${name} on ${model}, ${date}.`;

  const L = [];
  L.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" data-state="${state}" data-receipt-hash="${esc(hash)}">`);
  L.push(CARD_MARK);
  L.push(`<title>${esc(title)}</title>`);
  if (href !== null) L.push(`<a href="${esc(href)}">`);
  L.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="3" fill="${tokenValue('paper-2')}" stroke="${tokenValue('rule')}"/>`);
  // The stamp, pressed at the view's tilt.
  const sw = Math.min(textW(stampLabel, 15, true), 360) + 24;
  L.push(`<g class="stamp v-${state}" transform="rotate(-2.5 ${PAD} 38)">`);
  L.push(`<rect x="${PAD}" y="22" width="${sw}" height="32" rx="3" fill="none" stroke="${colour}" stroke-width="2"${DASH[stamp.dash]}/>`);
  L.push(line('label', stampLabel, { x: PAD + 12, y: 43, size: 15, fill: colour, bold: true, max: 360 }));
  L.push('</g>');
  L.push(line('receipt', hash ? `Receipt ${hash.slice(0, 12)}…` : 'Receipt unsealed', { x: W - PAD, y: 42, size: 11, fill: muted, anchor: 'end', max: 170 }));
  // The sentence, then the placebo line, wrapped to the card's width.
  wrap(sentence, perLine(16, W - 2 * PAD), 4).forEach((s, i) => L.push(line('sentence', s, { x: PAD, y: 92 + 22 * i, size: 16, fill: ink })));
  if (placebo) wrap(invisibleShown(placebo), perLine(12, W - 2 * PAD), 2).forEach((s, i) => L.push(line('placebo', s, { x: PAD, y: 180 + 15 * i, size: 12, fill: muted })));
  L.push(`<line x1="${PAD}" y1="204" x2="${W - PAD}" y2="204" stroke="${tokenValue('rule')}" stroke-width="1"/>`);
  // Which receipt: the skill or rules file, the model and the date, and the lift where one was measured.
  L.push(line('name', name, { x: PAD, y: 232, size: 13, fill: ink, bold: true, max: 270 }));
  L.push(line('model', `${model} · ${date}`, { x: PAD, y: 252, size: 12, fill: muted, max: 270 }));
  if (lift) L.push(line('lift', lift, { x: PAD, y: 274, size: 12, fill: ink, bold: true, max: 270 }));
  // The band plot at card size, as the site draws it, set in its own viewport.
  if (!limit) {
    const g = SIZES.card;
    L.push(`<svg x="${W - PAD - g.W}" y="214" width="${g.W}" height="${g.H}" viewBox="0 0 ${g.W} ${g.H}">`);
    L.push(renderCell(cellOf(receipt), { size: 'card' }).replace(/\n$/, ''));
    L.push('</svg>');
  }
  L.push(line('version', `driftproof ${RUNNER_VERSION}`, { x: PAD, y: 300, size: 10, fill: muted }));
  if (href !== null) L.push('</a>');
  L.push('</svg>');
  return L.filter(Boolean).join('\n') + '\n';
}

module.exports = { cardSvg, isCardFile, hrefProblem, CARD_MARK, STAMP, MEASURED, tokenValue };
