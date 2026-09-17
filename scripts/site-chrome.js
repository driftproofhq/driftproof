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
const ANCHOR_OPEN = '<!--driftproof:anchor-->';
const ANCHOR_CLOSE = '<!--/driftproof:anchor-->';
// The fragment the TL;DR card links on a multi-directory report (AC-18, spec 021
// v1.2). It is a NAME the card and the anchor share, so the two cannot drift.
const RECEIPTS_ANCHOR = 'receipts';
const SUB_OPEN = '<!--driftproof:subscribe-->';
const SUB_CLOSE = '<!--/driftproof:subscribe-->';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// WHAT THE SITE FOOTER IS, DEFINED ONCE (spec 025 AC-1).
//
// Reports 002 to 008 each close their <main> with a per-report line in a
// `<footer class="site">` element. It is chrome by shape and by class, and it sat
// inside the frozen body only because `splitReportBody` was written to a POSITION
// - outside <main> - rather than to a definition. A footer is chrome wherever it
// sits, and this is the one place that is written down: the gate imports it, the
// extraction below uses it, and `applyNavFooter` relocates by it. A second copy,
// in a gate, would be a second thing that can be right about a different page,
// which is what spec 020 amendment 29 says about the extraction as a whole.
const SITE_FOOTER_RE = /<footer\b[^>]*\bclass="site"[^>]*>[\s\S]*?<\/footer>\n?/;
const stripSiteFooter = (html) => String(html).replace(new RegExp(SITE_FOOTER_RE.source, 'g'), '');

// Root-relative, because this site is served from an apex domain and five
// documentation pages change directory depth in this same loop.
const DOCS_LINKS = [
  ['/methodology/', 'Methodology'],
  ['/neutrality/', 'Neutrality'],
  ['/interop/', 'Interop'],
  ['/authoring/', 'Authoring'],
  ['/judge-policy/', 'Judge policy'],
  ['/findings/', 'Findings'],
  ['/how-this-is-built/', 'How this is built'],
  ['/glossary/', 'Glossary'],
  ['/report-types/', 'Report types'],
];

// THE MENU IS A CONTROL AND THE NAV IS ITS TARGET, and they are siblings rather
// than nested (spec 025 AC-12). Under 390px the header wraps into three lines of
// links before a reader reaches a word of the page, so it collapses to the
// wordmark plus one disclosure.
//
// A <nav> INSIDE a closed <details> is hidden by the user agent at every
// viewport, and the desktop design needs it visible; overriding that from author
// CSS works in some engines and not in others, and a nav that disappears on one
// browser is worse than a nav that is always there. So the disclosure is a
// sibling and the collapse is one CSS rule on `[open] ~ nav`. No script, one copy
// of every link, and with CSS off the nav is simply visible.
const NAV = `${NAV_OPEN}<header class="site">
<a class="brand" href="/"><img class="brand-mark" src="/favicon.svg" alt="" width="28" height="28"><span>Driftproof</span></a>
<details class="nav-menu"><summary>Menu</summary></details>
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

// ── the receipt, one template ────────────────────────────────────────────────
//
// TWO VARIANTS, ONE RENDERER (spec 025 AC-5). The hero card on the homepage and
// the TL;DR card at the top of a report page are the same object: a heading, a
// column of label-and-value rows, a band plot, and a hash last. They were two
// pieces of markup that happened to look alike, which is how one of them grew a
// wrapped value under its label column and the other did not.
//
// THE VALUE IS ITS OWN GRID COLUMN, so a value long enough to wrap stays inside
// it. Spec 020 AC-19 fixed that once on the TL;DR card after Report 007's verdict
// wrapped back under its label; the fix is structural rather than visual, and
// having one renderer is what stops it being fixed once per card.
//
// `value` is HTML, not text, because a row may carry <code> chips or a link.
// Every call site escapes what it interpolates, and spec 020 AC-43 renders this
// for a synthetic row whose every field carries <, >, & and " and asserts no raw
// form reaches the page.
function receiptCard({ variant, heading, rows, tail = '', label = '' }) {
  const el = variant === 'tldr' ? 'aside' : 'div';
  // A <p> and not an <h2> on the TL;DR variant: the card is injected immediately
  // after <main>, above the report's own <h1>, and a heading above the first
  // heading is a document outline nobody meant.
  const head = variant === 'tldr'
    ? `<p class="receipt-heading">${heading}</p>`
    : `<h2 class="receipt-heading">${heading}</h2>`;
  const body = rows.map((r) => {
    if (r.plot) return r.plot;
    const cls = ['receipt-row', r.rowClass].filter(Boolean).join(' ');
    const vcls = [r.valueClass || 'receipt-value', r.stamp ? `receipt-stamp is-${r.stamp}` : ''].filter(Boolean).join(' ');
    return `<p class="${cls}"><span class="receipt-key">${esc(r.key)}</span> <span class="${vcls}">${r.value}</span></p>`;
  }).join('\n');
  return `<${el} class="card receipt${variant === 'tldr' ? ' is-tldr' : ''}"${label ? ` aria-label="${esc(label)}"` : ''}>
${head}
${body}${tail ? `\n${tail}` : ''}
</${el}>`;
}

// THE VERDICT ROW IS CONDITIONAL, and that is the fix rather than the omission.
// VERDICT and HEADLINE were derived from the same sentence, so Report 007's card
// printed one string twice under two labels. docs/data/reports.json now carries
// verdict_line only where the report HAS a verdict line of its own, and a report
// that has none renders no row at all: a summary repeated under a VERDICT label
// is a claim the report never made twice.
// THE RECORD'S OWN VALUES (spec 031 A-031-24). Where the report page carries an
// amended headline or verdict, the card renders the values as published, derived
// from the page by site-data.mjs recordedFields; the page is the one being rendered
// when the caller has it, and otherwise the file the row cites. Required at call
// time, not at load, because site-data.mjs loads the report renderers that load
// this file.
function recordedFor(r, html) {
  let page = html;
  const rel = r && r.number && typeof r.number.from === 'string' ? r.number.from : null;
  if (page == null) {
    if (!rel || !/^docs\/reports\/\d+\/index\.html$/.test(rel) || !fs.existsSync(path.join(ROOT, rel))) return null;
    page = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  }
  if (!/<p class="amended-(?:headline|verdict)">/.test(String(page))) return null;
  return require('./site-data.mjs').recordedFields(page, rel);
}

function tldrCard(r, html = null) {
  const models = r.model_ids.map((m) => `<code>${esc(m.value)}</code>`).join(' ');
  // The same field, as prose in the title line. It is derived here rather than
  // inline below because the inline form was the one interpolation in this file
  // that reached the page raw while the line four rows down escaped the same
  // values: spec 020 AC-43, approval finding F1.
  const modelList = esc(r.model_ids.map((m) => m.value).join(', '));
  // THE COUNT AND THE DESTINATION AGREE (F-R2, spec 021). This counted every
  // receipt the page links and pointed the count at `receipts/report-<n>/`, one
  // directory. Report 007 shipped "4 receipts" linking a directory holding
  // three, because its fourth is under `report-007-rerun`; Report 008 says five
  // across three directories and linked one holding two. A reader who follows
  // the link finds a different number from the one they clicked.
  //
  // THE MULTI-DIRECTORY DESTINATION IS THIS PAGE'S OWN RECEIPTS SECTION, which
  // is what AC-18 says and what this used not to do (F-2,
  // approval-20260903T192037Z). It linked the deepest directory CONTAINING every
  // receipt the page links, and for both 007 and 008 that parent is `receipts/`,
  // the entire archive: the destination went from a directory holding three to
  // one holding every receipt in the repository, which satisfies "the count
  // agrees with the destination" less well than before, not more. The section
  // lists exactly the receipts the count counts, so it is the one destination on
  // which the number is right by construction.
  //
  // A single-directory report is unchanged: the directory holds exactly what the
  // card counts, so it stays the destination and those cards stay byte-identical.
  const rpaths = r.receipt_paths.map((p) => (typeof p === 'string' ? p : p.value));
  const dirs = [...new Set(rpaths.map((p) => p.replace(/\/[^/]+$/, '')))];
  const receipts = rpaths.length
    ? (dirs.length > 1
      ? `<a href="#${RECEIPTS_ANCHOR}">${rpaths.length} linked receipts</a>`
      : `<a href="https://github.com/driftproofhq/driftproof/tree/main/${esc(dirs[0])}/">${rpaths.length} receipts</a>`)
    : 'no receipts linked';
  // THE REPORT TITLE IS THE HEADING, not a row labelled "Report". It was a row
  // whose label added nothing a reader could not see, and the receipt template
  // has a heading slot that is exactly what a title is. The string is unchanged,
  // so every numeral spec 020 AC-19 traces from the card into the body traces
  // from the same place.
  // THE CARD IS PART OF THE RECORD (spec 031 A-031-24): see recordedFor.
  const own = recordedFor(r, html) || r;
  const rows = [
    { key: 'Type', valueClass: 'tldr-type', value: esc(r.type.value) },
    { key: 'What moved', valueClass: 'tldr-moved', value: esc(r.what_moved.value) },
    { key: 'Models', valueClass: 'tldr-models', value: models },
    { key: 'Headline', valueClass: 'tldr-counts', value: esc(own.headline_counts.value) },
    ...(own.verdict_line ? [{ key: 'Verdict', valueClass: 'tldr-verdict', value: esc(own.verdict_line.value) }] : []),
    { key: 'Receipts', valueClass: 'tldr-receipts', value: receipts },
  ];
  return `${TLDR_OPEN}${receiptCard({
    variant: 'tldr',
    label: 'Report summary',
    heading: `Report ${esc(r.number.value)}: ${esc(r.type.value.replace(/\s*report$/i, ''))}, ${modelList}`,
    rows,
    tail: `<details class="tldr-cite"><summary>Cite this</summary><pre><code>${esc(bibtex(r))}</code></pre></details>`,
  })}${TLDR_CLOSE}`;
}

// ── application ─────────────────────────────────────────────────────────────
const stripBetween = (html, open, close) =>
  html.replace(new RegExp(`${open}[\\s\\S]*?${close}\\n?`, 'g'), '');

// THE ANCHOR THE CARD LINKS, and why it is chrome rather than an `id` on the
// heading. No published report body carries an `id` attribute; adding one to
// `<h2>Receipts</h2>` would be an edit to published content, which CONSTITUTION
// invariant 4 forbids and which the body freeze catches. So the renderer emits a
// fenced anchor immediately BEFORE the heading, `splitReportBody` strips it with
// the other fenced regions, and the frozen body is byte-unchanged.
//
// It is emitted only where a card actually links it, which is why the seven
// single-directory report pages do not move.
const receiptsAnchor = (html, wanted) => {
  const out = stripBetween(html, ANCHOR_OPEN, ANCHOR_CLOSE);
  if (!wanted) return out;
  return out.replace(/<h2[^>]*>\s*Receipts\s*<\/h2>/i,
    (m) => `${ANCHOR_OPEN}<span id="${RECEIPTS_ANCHOR}"></span>${ANCHOR_CLOSE}${m}`);
};

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
  // THE FOOTER IS RELOCATED, NOT REPLACED IN PLACE (spec 025 D-1). Everything
  // matching the site footer comes out of <main>, and the canonical one is
  // emitted once below it. The comment this replaces argued that a per-report
  // footer line inside <main> is body text and had to be left alone; that was
  // reasoning from where the element sits rather than from what it is, and it
  // left seven published pages carrying a footer inside the region the body
  // freeze reads. The relocation is a one-time transition, its seven before and
  // after digests are recorded in specs/025-design-pass/spec.md, and
  // specs/020-site-relaunch/coupling.mjs admits it exactly once.
  const head = end < 0 ? '' : stripSiteFooter(out.slice(0, end + 7));
  const tail = end < 0 ? out : out.slice(end + 7);
  const withFooter = tail.replace(new RegExp(SITE_FOOTER_RE.source), FOOTER);
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
    if (row) {
      out = out.replace(/(<main[^>]*>\s*)/, `$1${tldrCard(row, out)}\n`);
      const rp = row.receipt_paths.map((x) => (typeof x === 'string' ? x : x.value));
      out = receiptsAnchor(out, new Set(rp.map((x) => x.replace(/\/[^/]+$/, ''))).size > 1);
    }
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

// THE REPORT BODY, AND ITS AMENDMENTS (spec 021 AC-2, spec 020 amendment 29).
//
// CONSTITUTION invariant 4 says a published report is amended visibly and never
// edited silently. Holding that mechanically needs a definition of "the report",
// separate from the chrome around it, that survives the chrome being rebuilt.
//
// It lives HERE, in the module that WRITES the chrome, rather than in the gate
// that checks it. A gate carrying its own copy of this would be a second
// definition of what a report is, free to drift from the one the renderer uses,
// and the drift would show up as a published page the gate no longer recognises.
//
//   - `<main>` bounds it, so nav, footer, head tags and the beacon are out.
//   - The fenced regions are stripped by their markers, never by a path or a
//     class name, so the TL;DR card and the table wrappers may be re-cut freely.
//   - An element matching the site footer is chrome WHEREVER IT SITS, by the one
//     definition above, so a per-report footer line inside <main> is not body
//     (spec 025 AC-1).
//   - The Amendments section is returned SEPARATELY, because it is the one part
//     of a body that is allowed to change, and only by growing.
const AMENDMENTS_HEADING = /<h2[^>]*>\s*Amendments\s*<\/h2>/i;
function splitReportBody(pageHtml) {
  const a = pageHtml.indexOf('<main');
  const b = pageHtml.lastIndexOf('</main>');
  const main = a < 0 || b < 0 ? '' : pageHtml.slice(a, b + 7);
  const body = stripSiteFooter(main
    .replace(new RegExp(`${TLDR_OPEN}[\\s\\S]*?${TLDR_CLOSE}\\n?`, 'g'), '')
    .replace(new RegExp(`${ANCHOR_OPEN}[\\s\\S]*?${ANCHOR_CLOSE}\\n?`, 'g'), '')
    .replace(new RegExp(`${TW_OPEN}<div class="table-wrap">`, 'g'), '')
    .replace(new RegExp(`</div>${TW_CLOSE}`, 'g'), ''));
  const m = AMENDMENTS_HEADING.exec(body);
  if (!m) return { body, amendments: '' };
  // The section runs from its own heading to the next <h2>. Report 007 carries
  // two of them, `Amendments` and `Amendments filed by this report`; only the
  // first is this report's own record and only it is append-only.
  const start = m.index;
  const rest = body.slice(start + m[0].length);
  const next = /<h2[^>]*>/i.exec(rest);
  const end = next ? start + m[0].length + next.index : body.length;
  return { body: body.slice(0, start) + body.slice(end), amendments: body.slice(start, end) };
}

module.exports = {
  applyChrome, renderReportPage, applyNavFooter, wrapTables, tldrCard, receiptCard, bibtex, reportsData,
  splitReportBody,
  stripSiteFooter, SITE_FOOTER_RE,
  NAV, FOOTER, SCRIPTS, DOCS_LINKS, ORIGIN, esc,
  TLDR_OPEN, TLDR_CLOSE, TW_OPEN, TW_CLOSE, SUB_OPEN, SUB_CLOSE,
  ANCHOR_OPEN, ANCHOR_CLOSE, RECEIPTS_ANCHOR,
};
