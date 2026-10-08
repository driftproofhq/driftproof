// SPDX-License-Identifier: Apache-2.0
'use strict';

// The site's design tokens the view page needs (spec 128 R-8), each declaration copied verbatim from
// the fenced token block of docs/tokens.css, the one place the site writes them. The npm package does
// not carry docs/, so the view cannot read that file where it runs; spec 128's gate (AC-7) holds
// every line here equal to the declaration of the same name there, so a token moved on the site is a
// red row until it is moved here too. The first declaration of each name is the desktop one.
//
// TOKENS_CSS is the fenced block the view's stylesheet opens with, and the block lib/band-plot.js
// reads its plot tokens out of, in the form scripts/band-plot.mjs reads docs/tokens.css.

const DECLARATIONS = [
  '--paper: #ECE5D5;',
  '--paper-2: #FBF8F0;',
  '--ink: #1F1D1A;',
  '--ink-muted: #625C50;',
  '--rule: #CBC1AC;',
  '--arm-baseline: var(--ink-muted);',
  '--accent: #44CC11;',
  '--arm-skill: var(--ink);',
  '--accent-ink: #2A3C9E;',
  '--refused: #BDB3A0;',
  '--state-separated: var(--accent-ink);',
  '--state-overlapping: var(--ink-muted);',
  '--state-refused: #6F5500;',
  '--reg: #9B2C24;',
  '--mixed: #6F5500;',
  '--sans: "Alegreya Sans", "Gill Sans", "Segoe UI", system-ui, sans-serif;',
  '--mono: "Courier Prime", ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;',
  '--display: "Newsreader", "Iowan Old Style", Georgia, serif;',
  '--values: var(--mono);',
  '--t-h1-page: 44px;',
  '--t-h3: 22px;',
  '--t-body: 18px;',
  '--t-verdict: 24px;',
  '--t-mono: 15px;',
  '--t-mono-sm: 14px;',
  '--t-eyebrow: 15px;',
  '--t-fine: 15px;',
  '--t-receipt-heading: 26px;',
  '--t-plot: 12px;',
  '--t-plot-lg: 19px;',
  '--lh-body: 1.6;',
  '--radius: 3px;',
  '--w-wide: 1200px;',
  '--w-receipt-label: 6rem;',
  '--perforation: 2px;',
  '--tooth: 12px;',
  '--stamp-tilt: -2.5deg;',
  '--sheet-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);',
];

const TOKENS_CSS = `/* driftproof:tokens */
:root {
${DECLARATIONS.map((d) => `  ${d}`).join('\n')}
  color-scheme: light;
}
/* driftproof:/tokens */`;

module.exports = { DECLARATIONS, TOKENS_CSS };
