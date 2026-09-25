// SPDX-License-Identifier: Apache-2.0
//
// tests/interop-page.js - the repository gate's check that docs/interop/index.html names the receipt
// version the schema declares, the frozen versions spec/ carries, and an import line for every
// --from value the CLI accepts (spec 052 AC-4). The page is static HTML and its version was typed by
// hand twice; the second time it stayed at v0.7 while the schema reached v0.9 and nothing noticed.
//
// Inputs are passed in, not read here, so a planted page or a planted schema can be checked without
// a tree: `current` is spec/receipt.schema.json's schema_version const, `frozen` every version with a
// spec/receipt.v<version>.schema.json file, `tools` the CLI's --from values.
'use strict';

const order = (v) => v.split('.').map(Number);
function compare(a, b) {
  const x = order(a); const y = order(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

function checkInteropPage({ html, current, frozen, tools }) {
  const problems = [];
  const text = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const cited = [...text.matchAll(/receipt spec v([0-9][0-9.]*[0-9])/g)].map((m) => m[1]);
  if (!cited.length) problems.push('the page cites no receipt spec version');
  for (const v of cited) if (v !== current) problems.push(`the page cites receipt spec v${v}; the schema declares ${current}`);
  const sorted = [...frozen].sort(compare);
  const range = sorted.length ? `v${sorted[0]} to v${sorted[sorted.length - 1]}` : null;
  const said = /Prior schema versions \(([^)]*)\)/.exec(text);
  if (!said) problems.push('the page has no "Prior schema versions (...)" sentence');
  else if (!range || said[1].split(',')[0].trim() !== range) problems.push(`the page names the frozen versions as "${said[1]}"; spec/ freezes ${range}`);
  for (const t of tools) if (!new RegExp(`driftproof import [^<]*--from ${t.replace(/[-]/g, '\\-')}(?![\\w-])`).test(html)) problems.push(`the page has no import line for --from ${t}`);
  return { ok: problems.length === 0, problems };
}

module.exports = { checkInteropPage };
