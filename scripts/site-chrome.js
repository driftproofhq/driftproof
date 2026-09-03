#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/site-chrome.js — everything on a page that is NOT the page.
//
// The nav, the footer, the TL;DR card and the table scroll wrappers. All four
// are template chrome: derived from data the page or its receipts already carry,
// injected between markers, and idempotent, so a re-run replaces rather than
// appends.
//
// WHY MARKERS AND NOT A HAND-PATCH, again. Report pages are rendered by
// scripts/prepare-report-00N.js and the repo gate asserts report 007's page is
// byte-identical to what its receipts render. Chrome applied to the file on disk
// and not to the renderer is regenerated away by the next report, and takes that
// assertion red on the way. So the renderer calls this, on a page it has not
// written yet, exactly as it already calls applyHeadTags.
//
// WHAT THIS MAY NOT DO. It may not touch the body text or any figure of a
// published report (CONSTITUTION invariant 4). specs/020-site-relaunch/gate.mjs
// AC-21 strips these markers and compares the result against the branch base,
// byte for byte, so a chrome injector that edited a sentence takes the gate red.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';

const TLDR_OPEN = '<!--driftproof:tldr-->';
const TLDR_CLOSE = '<!--/driftproof:tldr-->';
const TW_OPEN = '<!--driftproof:tw-->';
const TW_CLOSE = '<!--/driftproof:tw-->';
const NAV_OPEN = '<!--driftproof:nav-->';
const NAV_CLOSE = '<!--/driftproof:nav-->';
const FOOT_OPEN = '<!--driftproof:foot-->';
const FOOT_CLOSE = '<!--/driftproof:foot-->';
const SCRIPTS_OPEN = '<!--driftproof:scripts-->';
const SCRIPTS_CLOSE = '<!--/driftproof:scripts-->';
const SUB_OPEN = '<!--driftproof:subscribe-->';
const SUB_CLOSE = '<!--/driftproof:subscribe-->';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Root-relative, because this site is served from an apex domain and five
// documentation pages change directory depth in this same loop.
const DOCS_LINKS = [
  ['/methodology/', 'Methodology'],
  ['/neutrality/', 'Neutrality'],
  ['/interop/', 'Interop'],
  ['/authoring/', 'Authoring'],
  ['/judge-policy/', 'Judge policy'],
  ['/glossary/', 'Glossary'],
  ['/report-types/', 'Report types'],
];

const NAV = `${NAV_OPEN}<header class="site">
<a class="brand" href="/"><img class="brand-mark" src="/favicon.svg" alt="" width="28" height="28"><span>Driftproof</span></a>
<nav class="site-nav" aria-label="Site">
<a href="/reports/">Reports</a>
<a href="/#how-it-works">How it works</a>
<details class="docs-menu"><summary>Docs</summary><div class="docs-menu-list">
${DOCS_LINKS.map(([h, t]) => `<a href="${h}">${t}</a>`).join('\n')}
</div></details>
<a href="https://github.com/driftproofhq/driftproof">GitHub</a>
</nav>
</header>${NAV_CLOSE}`;

// THE ONLY CLIENT SCRIPT ON THIS SITE, besides the analytics beacon: the island
// loader and the copy button. Both are vanilla, dependency-free and deferred to
// the end of the body, so every page is complete and readable before either runs.
// specs/020-site-relaunch/gate.mjs enumerates every <script> on every published
// page and asserts the set is exactly these plus the beacon.
const SCRIPTS = `${SCRIPTS_OPEN}<script src="/copy-button.js" defer></script>
<script type="module" src="/islands/loader.js"></script>${SCRIPTS_CLOSE}`;

const FOOTER = `${FOOT_OPEN}<footer class="site">
<p>Driftproof · <code>Apache-2.0</code> · <a href="https://github.com/driftproofhq/driftproof">github.com/driftproofhq/driftproof</a></p>
<p class="foot-links"><a href="mailto:hello@driftproofhq.com">hello@driftproofhq.com</a> · <a href="/methodology/">Methodology</a> · <a href="/neutrality/">Neutrality</a> · <a href="/glossary/">Glossary</a> · <a href="/report-types/">Report types</a> · <a href="/feed.xml">RSS</a> · <a href="/llms.txt">llms.txt</a></p>
</footer>${FOOT_CLOSE}`;

// ── the TL;DR card ──────────────────────────────────────────────────────────
// Rendered from docs/data/reports.json, which is itself derived from the report
// page and its receipts. Nothing here is typed, and AC-19 asserts every numeral
// in the card appears verbatim in the body below it: chrome may restate what the
// report says and may not make a claim of its own.
function bibtex(r) {
  const models = r.model_ids.map((m) => m.value).join(', ');
  return [
    `@techreport{driftproof-${r.number.value},`,
    `  title  = {${r.title.value}},`,
    '  author = {Driftproof},',
    `  year   = {${String(r.date.value).slice(0, 4)}},`,
    `  type   = {${r.type.value}},`,
    `  note   = {${models}},`,
    `  url    = {${ORIGIN}/reports/${r.number.value}/}`,
    '}',
  ].join('\n');
}

// THE VERDICT ROW IS CONDITIONAL, and that is the fix rather than the omission.
// VERDICT and HEADLINE were derived from the same sentence, so Report 007's card
// printed one string twice under two labels. docs/data/reports.json now carries
// verdict_line only where the report HAS a verdict line of its own, and a report
// that has none renders no row at all: a summary repeated under a VERDICT label
// is a claim the report never made twice.
function tldrCard(r) {
  const models = r.model_ids.map((m) => `<code>${esc(m.value)}</code>`).join(' ');
  // The same field, as prose in the title line. It is derived here rather than
  // inline below because the inline form was the one interpolation in this file
  // that reached the page raw while the line four rows down escaped the same
  // values: spec 020 AC-43, approval finding F1.
  const modelList = esc(r.model_ids.map((m) => m.value).join(', '));
  const receipts = r.receipt_paths.length
    ? `<a href="https://github.com/driftproofhq/driftproof/tree/main/receipts/report-${esc(r.number.value)}/">${r.receipt_paths.length} receipts</a>`
    : 'no receipts linked';
  return `${TLDR_OPEN}<aside class="tldr" aria-label="Report summary">
<p class="tldr-line"><span class="tldr-key">Report</span> <span class="tldr-title">Report ${esc(r.number.value)}: ${esc(r.type.value.replace(/\s*report$/i, ''))}, ${modelList}</span></p>
<p class="tldr-line"><span class="tldr-key">Type</span> <span class="tldr-type">${esc(r.type.value)}</span></p>
<p class="tldr-line"><span class="tldr-key">What moved</span> <span class="tldr-moved">${esc(r.what_moved.value)}</span></p>
<p class="tldr-line"><span class="tldr-key">Models</span> <span class="tldr-models">${models}</span></p>
<p class="tldr-line"><span class="tldr-key">Headline</span> <span class="tldr-counts">${esc(r.headline_counts.value)}</span></p>
${r.verdict_line ? `<p class="tldr-line"><span class="tldr-key">Verdict</span> <span class="tldr-verdict">${esc(r.verdict_line.value)}</span></p>\n` : ''}<p class="tldr-line"><span class="tldr-key">Receipts</span> <span class="tldr-receipts">${receipts}</span></p>
<details class="tldr-cite"><summary>Cite this</summary><pre><code>${esc(bibtex(r))}</code></pre></details>
</aside>${TLDR_CLOSE}`;
}

// ── application ─────────────────────────────────────────────────────────────
const stripBetween = (html, open, close) =>
  html.replace(new RegExp(`${open}[\\s\\S]*?${close}\\n?`, 'g'), '');

// THE FOOTER IS ONLY REPLACED OUTSIDE <main>.
//
// Reports #002, #003 and #004 close their own <main> with a per-report footer
// line inside it - "Driftproof - Apache-2.0 - Report #004 - Capability-gap...".
// That line is body text of a published report. Replacing it would be a silent
// edit to a published report, which CONSTITUTION invariant 4 forbids and which
// spec 020 AC-21 catches: the assertion compares each report body against the
// branch base, byte for byte, outside the fenced chrome.
//
// So those three keep their own footer, untouched, and gain the site footer
// beneath it. A little redundancy on three pages is the cheap side of that
// trade; the expensive side is a page nobody can diff against what it published.
function applyNavFooter(html) {
  let out = stripBetween(html, NAV_OPEN, NAV_CLOSE);
  out = stripBetween(out, FOOT_OPEN, FOOT_CLOSE);
  out = out.replace(/<header class="site">[\s\S]*?<\/header>/, NAV);
  if (!out.includes(NAV_OPEN)) out = out.replace(/<body>/, `<body>\n${NAV}`);

  const end = out.lastIndexOf('</main>');
  const head = end < 0 ? '' : out.slice(0, end + 7);
  const tail = end < 0 ? out : out.slice(end + 7);
  const withFooter = tail.replace(/<footer class="site">[\s\S]*?<\/footer>/, FOOTER);
  out = head + (withFooter.includes(FOOT_OPEN) ? withFooter : withFooter.replace(/<\/body>/, `${FOOTER}\n</body>`));
  out = stripBetween(out, SCRIPTS_OPEN, SCRIPTS_CLOSE);
  out = out.replace(/<\/body>/, `${SCRIPTS}\n</body>`);
  return out;
}

// Tables scroll on a 380px viewport. Wrapped between markers so AC-21 can strip
// the wrapper and compare the table itself, unchanged, against the base.
function wrapTables(html) {
  const out = html
    .split(`${TW_OPEN}<div class="table-wrap">`).join('')
    .split(`</div>${TW_CLOSE}`).join('');
  return out.replace(/<table[\s\S]*?<\/table>/g, (t) => `${TW_OPEN}<div class="table-wrap">${t}</div>${TW_CLOSE}`);
}

function reportsData() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'reports.json'), 'utf8')).reports;
}

// The one entry point, taking a docs-relative path rather than a file, because
// prepare-report-007.js calls it on a page it has not written yet.
function applyChrome(html, rel, data) {
  let out = applyNavFooter(html);
  out = stripBetween(out, TLDR_OPEN, TLDR_CLOSE);
  // The `-draft` suffix is part of the PATH, never part of the report. An
  // unapproved report is published nowhere (build-public.sh drops `*-draft/`).
  // This comment used to add that nothing in the bytes marks the draft state, so
  // promotion is a rename and only a rename. That was WRONG, and Report 008's
  // promotion on 2026-09-03 measured it wrong: this function is draft-aware, but
  // `build-head-tags.js` is not, so a draft page silently gets a fallback title
  // and a bare WebPage JSON-LD, and acquires its real title, its canonical URL
  // and its TechArticle structured data only when the path loses the suffix.
  // Promotion re-renders. A draft page that could not render its own TL;DR card would
  // make that false: the card would appear for the first time at promotion, in a
  // page nobody had reviewed with it. The number is what the card is keyed on,
  // and `008-draft` is report 008.
  const m = /^reports\/(\d+)(?:-draft)?\/index\.html$/.exec(rel);
  if (m) {
    const rows = data || reportsData();
    const row = rows.find((r) => String(r.number.value) === m[1]);
    if (row) out = out.replace(/(<main[^>]*>\s*)/, `$1${tldrCard(row)}\n`);
  }
  out = wrapTables(out);
  return out;
}

// THE HOOK A REPORT GENERATOR CALLS (spec 020 A3).
//
// `scripts/prepare-report-00N.js` renders a page and hands it here before
// writing, exactly as it already hands it to applyHeadTags - which itself calls
// applyChrome, so a generator that only calls applyHeadTags is already covered.
// This name exists so the contract is visible at the call site rather than
// inferred from a chain, and so Report #008's generator has one thing to call.
//
// Idempotent: markers are stripped before they are re-emitted, so rendering
// twice is rendering once.
function renderReportPage(html, rel, data) {
  return applyChrome(html, rel, data);
}

module.exports = {
  applyChrome, renderReportPage, applyNavFooter, wrapTables, tldrCard, bibtex, reportsData,
  NAV, FOOTER, SCRIPTS, DOCS_LINKS, ORIGIN, esc,
  TLDR_OPEN, TLDR_CLOSE, TW_OPEN, TW_CLOSE, SUB_OPEN, SUB_CLOSE,
};
