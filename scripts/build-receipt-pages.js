#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// build-receipt-pages.js: one human page per receipt (spec 036).
//
// For every receipt under receipts/ outside a *-draft/ path, writes
// docs/r/<receipt_hash>/index.html and docs/r/<receipt_hash>/badge.svg, and asks
// scripts/build-og-card.py for the receipt's share card. The page is at a stable URL
// because the hash is: the badge links to it, and a receipt that changed would be a
// different receipt with a different page.
//
// EVERY WORD OF A VERDICT COMES FROM ONE READING. The token is lib/verdict.js
// receiptVerdict's; the label and the honest line under it are the table in
// specs/036-badge-and-receipt-page/spec.md, copied into LABELS and CLAUSES below; every
// figure is read from the receipt file.
//
// THE HONEST LINE FOR NOT_MEASURED IS DERIVED, NOT FIXED (A-036-4). NOT_MEASURED has five
// routes into it -- R-5's four refusals and A-036-3's rung -- and until this amendment the
// page printed one sentence for all of them: "it is below TESTED, incomplete, or has no
// numeric lift". On 118 of the 120 archived receipts all three of those were false: the
// receipt was TESTED, complete and carried a numeric lift, and the reason it was not
// measured -- that it does not record what answered the run -- appeared nowhere on the page.
// The sentence is now composed from receiptVerdict's `notMeasured` routes, so the page names
// the refusal that actually fired, and every one of them where more than one did.
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN: no model call and no network call.
//
//   node scripts/build-receipt-pages.js          # write docs/r/ and the cards
//   node scripts/build-receipt-pages.js --check  # exit 1 if a page, badge or card is stale

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { receiptVerdict, drawsLine } = require('../lib/verdict');
const { verifyReceiptHash } = require('../lib/receipt');
const { badgeSvg } = require('../lib/badge-svg');
const chrome = require('./site-chrome');
const { applyHeadTags } = require('./build-head-tags');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, 'r');
const ORIGIN = 'https://driftproofhq.com';
const RAW = 'https://raw.githubusercontent.com/driftproofhq/driftproof/main';

const LABELS = {
  PASSED: ['Passing', 'A case separated upward under the band rule. That is a separation detected under the rule, not proof that the skill moved the score.'],
  REGRESSED: ['Regressed', 'A case separated downward under the band rule. That is a separation detected under the rule, not proof that the skill moved the score.'],
  UNDERPOWERED: ['Not enough draws', 'Not enough draws to conclude at this effect floor.'],
  NO_EFFECT: ['No separation detected', 'No separation detected at this sample size, which is not evidence that nothing changed.'],
  NOT_MEASURED: ['Not measured', null],   // route-derived: see CLAUSES and honestLine below
};

// A-036-4, spec.md § The honest line, the NOT_MEASURED routes. One clause per route, each a
// statement about THIS receipt that a reader can check against the fields above it on the page.
// No clause carries a comma, so the list below reads as a list.
const CLAUSES = {
  below_tested: 'its verification level is below TESTED',
  no_answered_by: 'it does not record that a model answered the run',
  no_numeric_lift: 'it records no numeric lift',
  incomplete: 'its run is marked incomplete',
  no_readable_case: 'no case in it has two readable arms',
};

// The states whose whole content is that this receipt could not resolve the question. A lift
// figure is a measurement, so neither may print one: A-036-2 took it off the badge for exactly
// this reason, and A-036-4 takes it off the page, which is the larger surface and the one a
// reader lands on from the badge.
const NO_LIFT = new Set(['UNDERPOWERED', 'NOT_MEASURED']);

// The sentence under the label, for any state. For NOT_MEASURED it names every route that
// fired, in the order receiptVerdict tests them; for the other four it is the fixed line.
function honestLine(v) {
  if (v.verdict !== 'NOT_MEASURED') return LABELS[v.verdict][1];
  const parts = (v.notMeasured || []).map((k) => CLAUSES[k]).filter(Boolean);
  if (!parts.length) throw new Error('NOT_MEASURED with no route: the page cannot state a reason the reader cannot check');
  const list = parts.length === 1 ? parts[0]
    : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `This receipt carries no verdict: ${list}.`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n3 = (x) => Number(x).toFixed(3);

function receipts() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (/-draft$/.test(e.name)) continue; walk(p); continue; }
      if (!e.name.endsWith('.json') || e.name.startsWith('_')) continue;
      let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { continue; }
      if (!j || !j.results || !j.receipt_hash) continue;
      out.push({ rel: path.relative(ROOT, p).split(path.sep).join('/'), receipt: j });
    }
  })(path.join(ROOT, 'receipts'));
  return out;
}

// The band plot scripts/band-plot.mjs already draws for this receipt, if it drew one.
function plotFor(rel) {
  const key = rel.replace(/^receipts\//, '').split('/').join('--').replace(/\.json$/, '');
  return fs.existsSync(path.join(DOCS, 'plots', `${key}.hero.svg`)) ? `/plots/${key}.hero.svg` : null;
}

function armRow(receipt, mode, name) {
  const agg = ((receipt.results || {}).aggregates || {})[mode] || null;
  const cmp = receipt.comparison || {};
  const mean = agg && typeof agg.mean_score === 'number' ? agg.mean_score : (mode === 'with_skill' ? cmp.with_skill_score : cmp.baseline_score);
  if (typeof mean !== 'number') return '';
  const spread = agg && typeof agg.stddev === 'number' ? `± ${n3(agg.stddev)}` : 'no spread recorded';
  const cases = agg && typeof agg.case_count === 'number' ? agg.case_count : ((receipt.suite || {}).case_count || '');
  return `      <tr><td>${name}</td><td><span class="arm-mean">${n3(mean)}</span></td><td>${esc(spread)}</td><td>${esc(cases)}</td></tr>`;
}

function page({ rel, receipt: r }) {
  const v = receiptVerdict(r);
  const label = LABELS[v.verdict][0];
  const honest = honestLine(v);
  const run = r.run || {};
  const date = String(run.date_utc || '').slice(0, 10);
  const url = `${ORIGIN}/r/${r.receipt_hash}/`;
  const file = path.basename(rel);
  const cmp = r.comparison || {};
  const lift = typeof cmp.delta === 'number' ? `${cmp.delta >= 0 ? '+' : '-'}${n3(Math.abs(cmp.delta))}` : null;
  const unc = typeof cmp.delta_uncertainty === 'number' ? `± ${n3(cmp.delta_uncertainty)}`
    : cmp.delta_uncertainty_unavailable === 'single_case' ? 'no ± (1 case)' : 'no ±';
  // A-036-4. The lift and its uncertainty are stated only where the state measured one. The
  // page used to print "Lift +0.128, ± 0.362" under a label reading "Not measured", which is
  // the badge's defect on a larger surface: the most precise-looking figure on the page
  // answering the question the label above it had just said this receipt cannot answer.
  const effect = NO_LIFT.has(v.verdict)
    ? 'No lift is stated for a state that did not measure one.'
    : `Lift ${lift === null ? 'not recorded' : esc(lift)}, ${esc(unc)}.`;
  const verified = verifyReceiptHash(r)
    ? `receipt_hash verified when this page was built from ${rel}; ${run.transcripts ? `run.transcripts records ${run.transcripts}` : 'this receipt does not record run.transcripts'}.`
    : `receipt_hash did not verify when this page was built from ${rel}.`;
  const plot = plotFor(rel);
  const snippet = `[![driftproof](${url}badge.svg)](${url})`;
  const curl = `curl -fsSLO ${RAW}/${rel}`;
  const validate = `npx driftproof validate ${file}`;
  // The first paragraph is the page's description and its link preview, so it says
  // what the page is in a sentence rather than in an eyebrow's two words.
  const main = `<main class="receipt-page">
  <p class="receipt-lede">The Driftproof receipt for <code>${esc((r.skill || {}).name)}</code> on ${esc(run.model_id)}, run on ${esc(date)}, and what it can say.</p>
  <h1><code>${esc((r.skill || {}).name)}</code> on <span data-field="model">${esc(run.model_id)}</span></h1>
  <p class="receipt-meta">Run on <span data-field="date">${esc(date)}</span>, runner ${esc(run.runner_version || 'not recorded')}, surface ${esc(run.surface || 'not recorded')}, verification level <code>${esc(r.verification_level || 'not recorded')}</code>.</p>

  <section class="receipt-verdict state-${v.verdict.toLowerCase().replace(/_/g, '-')}">
    <p class="receipt-label" data-field="label">${esc(label)}</p>
    <p class="receipt-honest" data-field="honest">${esc(honest)}</p>
${v.verdict === 'UNDERPOWERED' ? `    <p class="receipt-draws">${esc(drawsLine(v.drawsNeeded))}</p>\n` : ''}    <p><img class="receipt-badge" src="badge.svg" alt="${esc(`driftproof badge: ${label.toLowerCase()} on ${run.model_id}, ${date}`)}"></p>
  </section>

  <section class="receipt-arms">
    <h2>The two arms</h2>
    <table class="summary">
      <thead><tr><th>arm</th><th>mean</th><th>spread across cases</th><th>cases</th></tr></thead>
      <tbody>
${armRow(r, 'with_skill', 'with the skill')}
${armRow(r, 'baseline', 'without the skill')}
      </tbody>
    </table>
    <p class="muted">${effect} A spread is the sample standard deviation of the per-case means: a descriptive spread with no coverage probability. The verdict above reads each case's two bands, not these aggregates.</p>
${plot ? `    <img class="bandplot" src="${plot}" alt="The two arms of this receipt drawn as ranges, with the effect floor marked." width="520" height="160">\n` : ''}  </section>

  <section class="receipt-verify">
    <h2>What was verified</h2>
    <p>${esc(verified)}</p>
    <p>Receipt hash: <code class="receipt-hash">${esc(r.receipt_hash)}</code></p>
    <details class="verify" open>
      <summary>Verify this receipt yourself</summary>
      <p><span class="copy-cta"><code>${esc(curl)}</code><button type="button" data-copy="${esc(curl)}">Copy</button></span></p>
      <p><span class="copy-cta"><code>${esc(validate)}</code><button type="button" data-copy="${esc(validate)}">Copy</button></span></p>
    </details>
  </section>

  <section class="receipt-embed">
    <h2>Embed the badge</h2>
    <p><span class="copy-cta"><code>${esc(snippet)}</code><button type="button" data-copy="${esc(snippet)}">Copy</button></span></p>
  </section>
</main>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`Receipt: ${(r.skill || {}).name} on ${run.model_id}`)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
${chrome.NAV}
${main}
${chrome.FOOTER}
</body>
</html>
`;
  return { html: applyHeadTags(html, `r/${r.receipt_hash}/index.html`), badge: badgeSvg(r, { href: url }), label };
}

function card({ receipt: r }, label, outDir) {
  return execFileSync('python3', [path.join(__dirname, 'build-og-card.py'), '--receipt', r.receipt_hash.slice(0, 16), '--skill', (r.skill || {}).name, '--model', (r.run || {}).model_id, '--date', String((r.run || {}).date_utc || '').slice(0, 10), '--label', label, '--out-dir', outDir], { encoding: 'utf8' }).trim();
}

function main() {
  const check = process.argv.includes('--check');
  const all = receipts();
  const seen = new Set();
  const stale = [];
  // Cards first, so each page's head finds its card by name.
  const labels = new Map(all.map((x) => [x.receipt.receipt_hash, LABELS[receiptVerdict(x.receipt).verdict][0]]));
  if (!check) for (const x of all) card(x, labels.get(x.receipt.receipt_hash), path.join(DOCS, 'cards'));
  for (const x of all) {
    const h = x.receipt.receipt_hash;
    if (seen.has(h)) throw new Error(`two receipts carry receipt_hash ${h}`);
    seen.add(h);
    const { html, badge } = page(x);
    const dir = path.join(OUT, h);
    if (check) {
      if (!fs.existsSync(path.join(dir, 'index.html')) || fs.readFileSync(path.join(dir, 'index.html'), 'utf8') !== html) stale.push(`r/${h.slice(0, 12)}/index.html`);
      if (!fs.existsSync(path.join(dir, 'badge.svg')) || fs.readFileSync(path.join(dir, 'badge.svg'), 'utf8') !== badge) stale.push(`r/${h.slice(0, 12)}/badge.svg`);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html);
      fs.writeFileSync(path.join(dir, 'badge.svg'), badge);
    }
  }
  if (fs.existsSync(OUT)) for (const d of fs.readdirSync(OUT)) if (!seen.has(d)) { if (check) stale.push(`r/${d}: no receipt`); else fs.rmSync(path.join(OUT, d), { recursive: true }); }
  if (check) {
    if (stale.length) { console.error(`receipt pages: ${stale.length} stale\n  ${stale.slice(0, 10).join('\n  ')}`); process.exit(1); }
    console.log(`receipt pages: ${all.length} pages and badges match their receipts`);
    return;
  }
  console.log(`wrote ${all.length} receipt pages, badges and cards`);
}

if (require.main === module) main();
module.exports = { receipts, page, LABELS, CLAUSES, honestLine };
