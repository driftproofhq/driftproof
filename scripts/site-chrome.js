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
const { htmlToText, escapeAttr } = require('./html-text.js');

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

const esc = escapeAttr;

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
<a href="/paper/">Paper</a>
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

// THE RECEIPTS LINK (spec 133 R-7) puts the receipts index one click from every page, and so every
// receipt page two clicks from the homepage: report bodies link receipt files, not their pages.
const FOOTER = `${FOOT_OPEN}<footer class="site">
<p>Driftproof · <code>Apache-2.0</code> · <a href="https://github.com/driftproofhq/driftproof">github.com/driftproofhq/driftproof</a></p>
<p class="foot-links"><a href="mailto:hello@driftproofhq.com">hello@driftproofhq.com</a> · <a href="/methodology/">Methodology</a> · <a href="/neutrality/">Neutrality</a> · <a href="/glossary/">Glossary</a> · <a href="/report-types/">Report types</a> · <a href="/r/">Receipts</a> · <a href="/what-is-driftproof/">What is Driftproof</a> · <a href="/agent-skill-evaluation/">Skill evaluation</a> · <a href="/agent-skill-regression-testing/">Regression testing</a> · <a href="/compare/">Compare the tools</a> · <a href="/feed.xml">RSS</a> · <a href="/llms.txt">llms.txt</a></p>
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
// A PLOT, INLINED (spec 038 A-038-3). A plot referenced by <img> is rendered by the browser as an
// isolated document that loads no web font, so its text sets in a fallback face; inlined, it takes
// the page's own. The bytes are the generated file's, read at build, with one class added: this
// embeds an artifact, it does not draw a second one, and spec 038 AC-6 reads each inlined plot
// against the file it came from. The <title> the generator wrote is the accessible name.
// ONE PATTERN ID PER INLINED PLOT (spec 038 approval F-4). Every plot file defines `<pattern
// id="hatch">`, which is unique inside the file; inlined, a page with eight plots carried eight
// elements with one id and every `url(#hatch)` resolved to the first. The id takes the file's name,
// so it is unique per plot and the same on every build.
function uniqueHatch(src, rel) {
  const hatch = `hatch-${path.basename(rel, '.svg').replace(/[^A-Za-z0-9_-]/g, '-')}`;
  return src.replace(/\bid="hatch"/g, `id="${hatch}"`).replace(/url\(#hatch\)/g, `url(#${hatch})`);
}
function inlinePlot(rel, extraClass = '', alt = null) {
  // Callers name a plot as the page does: `/plots/x.svg`, `plots/x.svg` or `docs/plots/x.svg`.
  let src = fs.readFileSync(path.join(ROOT, 'docs', rel.replace(/^\/?(?:docs\/)?/, '')), 'utf8').trim();
  // THE ACCESSIBLE NAME IS THE ONE THE PAGE ALREADY GAVE IT (spec 038 A-038-4). A plot file's own
  // <title> names the cell and states its band's state, which an <img alt> never put on the page; a
  // page that inlined it would gain a sentence, and a receipt page whose verdict is another state
  // would carry that state's label. The alt the <img> carried becomes the title, and the file's own
  // title stays in the file, where spec 038 AC-7 holds it equal to the Base's.
  if (alt !== null) {
    const t = /<title>[\s\S]*?<\/title>/.exec(src);
    if (!t) throw new Error(`${rel}: no title on the plot to replace`);
    src = src.replace(t[0], `<title>${esc(alt)}</title>`);
  }
  src = uniqueHatch(src, rel);
  if (!extraClass) return src;
  const m = /^<svg\b[^>]*\bclass="([^"]*)"/.exec(src);
  if (!m) throw new Error(`${rel}: no class on the plot's root element`);
  return src.replace(`class="${m[1]}"`, `class="${extraClass} ${m[1]}"`);
}

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

// ── the plain summary (spec 125) ────────────────────────────────────────────
// One row per report in docs/data/report-summaries.json, written for a reader who has never seen
// the instrument and tied, point by point, to the files it names (specs/125-site-wide-layout
// AC-5 checks every quote). It is the first thing in the TL;DR fence, so it sits under the title
// and no frozen body moves. A `{name}` is read from the file the row's `values` names: a fact the
// receipts do not carry, such as a model's release date, is never typed.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FORMATS = {
  'd Mon': (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v)); if (!m) throw new Error(`not a date: ${v}`); return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`; },
  'd Mon yyyy': (v) => `${FORMATS['d Mon'](v)} ${String(v).slice(0, 4)}`,
};
// THE SUMMARY'S HEADING STATES ITS QUESTION (spec 134). It is a heading with its own id, so the
// contents rail lists it and no anchor is inserted into the fence.
const summaryId = (number) => `what-report-${esc(number)}-found`;
const summaryHeading = (number) => `<h2 class="eyebrow" id="${summaryId(number)}">What did Report ${esc(number)} find?</h2>`;
function summariesData() {
  const f = path.join(ROOT, 'docs', 'data', 'report-summaries.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).reports : {};
}
function summaryValue(number, row, name) {
  const v = row.values && row.values[name];
  if (!v) throw new Error(`report ${number}: the summary names {${name}} and no value`);
  const got = v.at.split('.').reduce((o, k) => (o == null ? o : o[k]), JSON.parse(fs.readFileSync(path.join(ROOT, v.file), 'utf8')));
  if (got == null) throw new Error(`report ${number}: ${v.file} has no ${v.at}`);
  return (FORMATS[v.format] || String)(got);
}
// THE SUMMARY AS PLAIN TEXT (spec 126): each point's lead and text with its {name} values read, for
// a surface that is not a page, the README's latest-finding line. The page's summary below is built
// from the same row by the same resolver, so the two cannot say different things.
function summaryPoints(number) {
  const row = summariesData()[String(number)];
  if (!row) return null;
  return row.points.map((p) => ({ lead: p.lead, text: p.text.replace(/\{([a-z_]+)\}/g, (_, n) => summaryValue(number, row, n)) }));
}
function plainSummary(number) {
  const row = summariesData()[String(number)];
  if (!row) return '';
  const value = (name) => summaryValue(number, row, name);
  const text = (t) => esc(t).replace(/\{([a-z_]+)\}/g, (_, n) => esc(value(n)));
  return `<section class="plain-summary" aria-labelledby="${summaryId(number)}">${summaryHeading(number)}<ul>
${row.points.map((p) => `<li><b>${esc(p.lead)}</b> ${text(p.text)}</li>`).join('\n')}
</ul></section>`;
}

// ── the answers first (spec 134) ────────────────────────────────────────────
// Three to five plain sentences, each read from one receipt and linking its page, under a heading
// that states the question they answer (scripts/report-answers.js holds the rule). They replace spec
// 125's summary wherever the rule finds enough receipts; a report it cannot answer from its receipts
// (Report 010 links none, Reports 001 to 008 record no answerer, and Report 011's body compares two
// receipts within one run) keeps spec 125's row (spec 134 R-4, R-7, R-10). A report run more than
// once leads with what holds across its runs (R-9). The body is the page being rendered
// when the caller has it, and otherwise the file the row cites, as recordedFor reads it.
function answersSummary(r, html) {
  let page = html;
  if (page == null) {
    const rel = r && r.number && typeof r.number.from === 'string' ? r.number.from : null;
    if (!rel || !/^docs\/reports\/\d+\/index\.html$/.test(rel) || !fs.existsSync(path.join(ROOT, rel))) return '';
    page = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  }
  const got = require('./report-answers').answersFor(r, splitReportBody(String(page)).body, { esc });
  if (!got) return '';
  // A sentence across the runs (spec 134 R-9) names every receipt it counts; any other, its one.
  const li = (x, cls) => (x.across
    ? `<li class="${cls} across" data-receipts="${esc(x.rels.join(' '))}">${x.html}</li>`
    : `<li class="${cls}" data-receipt="${esc(x.rel)}">${x.html}</li>`);
  // The native harness's results, on a report that compares two harnesses (the operator's ruling of
  // 2 Oct 2026): not an answer read from a receipt, so it names the evidence files it reads, and it
  // stands before the limit sentence, which stays last.
  const harness = got.harness ? [`<li class="harness" data-sources="${esc(got.harness.files.join(' '))}">${got.harness.html}</li>`] : [];
  return `<section class="plain-summary" aria-labelledby="${summaryId(r.number.value)}">${summaryHeading(r.number.value)}<ul>
${[...got.answers.map((x) => li(x, 'answer')), ...harness, li(got.limit, 'answer limit')].join('\n')}
</ul></section>`;
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
  const summary = answersSummary(r, html) || plainSummary(r.number.value);
  return `${TLDR_OPEN}${summary ? `${summary}\n` : ''}${receiptCard({
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

// ── the page grid, the contents rail and the facts rail (spec 125) ──────────
//
// EVERY PAGE BUT THE HOMEPAGE is wrapped in one `.page-grid`, and the wrapper, the
// contents rail and the facts rail all sit OUTSIDE <main>: the region
// `splitReportBody` reads is untouched, so no report body moves. The opening half
// (the wrapper's start tag and the contents rail) is fenced before `<main`, the
// closing half (the facts rail and the wrapper's end tag) after `</main>`; both
// fences are stripped first, so a re-run replaces rather than nests.
//
// A HEADING THE RAIL LINKS HAS TO BE A TARGET. Published bodies of Reports 001 to
// 008 carry no `id` on their headings, and adding one would edit a frozen body. So
// a heading without one gets an anchor in the same fence the Receipts anchor uses
// (`receiptsAnchor`), which `splitReportBody` already strips; the class tells this
// function's own anchors from that one.
const LAYOUT_OPEN = '<!--driftproof:layout-->';
const LAYOUT_CLOSE = '<!--/driftproof:layout-->';
const LAYOUT_END_OPEN = '<!--driftproof:layout-end-->';
const LAYOUT_END_CLOSE = '<!--/driftproof:layout-end-->';
const TOC_ANCHOR_RE = new RegExp(`${ANCHOR_OPEN}<span id="[^"]*" class="toc-anchor"></span>${ANCHOR_CLOSE}`, 'g');
const textOfHtml = (s) => htmlToText(s, { collapse: true });
// A heading repeated in a rail reads as a label: a spaced dash in it becomes a colon, so the rail
// carries no em dash and no spaced hyphen (spec 020 AC-35 and AC-42 read text outside <main>).
const railText = (s) => textOfHtml(s).replace(/\s+(?:—|&mdash;|–|&ndash;|-)\s+/g, ': ').replace(/—|&mdash;/g, ', ');
const slugOf = (s) => textOfHtml(s).toLowerCase()
  .replace(/&[a-z]+;|&#\d+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';

function tocFor(html) {
  const a = html.indexOf('<main');
  const b = html.lastIndexOf('</main>');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const heads = [];
  const re = /<h2\b([^>]*)>([\s\S]*?)<\/h2>/g;
  const main = html.slice(a, b);
  let m;
  while ((m = re.exec(main))) {
    const at = a + m.index;
    const own = /\bid="([^"]+)"/.exec(m[1]);
    const before = html.slice(Math.max(0, at - 200), at);
    const fenced = new RegExp(`<span id="([^"]+)"[^>]*></span>${ANCHOR_CLOSE}$`).exec(before);
    let id = own ? own[1] : fenced ? fenced[1] : null;
    let insert = null;
    if (!id) {
      const base = slugOf(m[2]);
      id = base;
      for (let k = 2; ids.has(id); k++) id = `${base}-${k}`;
      ids.add(id);
      insert = `${ANCHOR_OPEN}<span id="${escapeAttr(id)}" class="toc-anchor"></span>${ANCHOR_CLOSE}`;
    }
    heads.push({ at, id, text: textOfHtml(m[2]), insert });
  }
  return heads;
}

// A PAGE OF TERMS LISTS ITS TERMS (spec 125 A-125-9). The Glossary has one heading and a term per
// entry, each with its own id, so where a page has fewer than two headings its rail is its terms,
// in order. Every other page lists its headings.
function termsFor(html) {
  const main = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
  return [...main.matchAll(/<dt\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/dt>/g)].map((m) => ({ id: m[1], text: textOfHtml(m[2]) }));
}

// A PIECE OF WRITING LISTS THE REPORTS IT DISCUSSES (spec 125 A-125-9, spec 130 R-2). The essay has
// no heading, and a heading would be new words on it. So where a page under writing/ has fewer than
// two headings and no terms, its rail is each paragraph's first link to a report page, by that
// link's own text, in order, with an anchor in the same fence as a heading's before the paragraph.
function reportsFor(html) {
  const a = html.indexOf('<main');
  const main = html.slice(a, html.lastIndexOf('</main>'));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const out = [];
  for (const m of main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const l = /<a href="\/reports\/(\d{3})\/">([\s\S]*?)<\/a>/.exec(m[1]);
    if (!l) continue;
    let id = `on-report-${l[1]}`;
    for (let k = 2; ids.has(id); k++) id = `on-report-${l[1]}-${k}`;
    ids.add(id);
    out.push({ at: a + m.index, id, text: textOfHtml(l[2]), insert: `${ANCHOR_OPEN}<span id="${escapeAttr(id)}" class="toc-anchor"></span>${ANCHOR_CLOSE}` });
  }
  return out;
}

function factsRail(row) {
  const rpaths = row.receipt_paths.map((p) => (typeof p === 'string' ? p : p.value));
  const recs = rpaths.map((p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; } });
  const one = (get) => {
    const vals = recs.map((r) => { try { return get(r); } catch { return null; } });
    return vals.length && vals.every((v) => v && v === vals[0]) ? vals[0] : null;
  };
  const distinct = (get) => [...new Set(recs.map((r) => { try { return get(r); } catch { return null; } }).filter(Boolean))].sort();
  const grader = one((r) => r.run.judge.model_id);
  const surfaces = distinct((r) => r.run.surface);
  const rows = [
    ['Type', esc(row.type.value)],
    ['Models', row.model_ids.map((m) => `<code>${esc(m.value)}</code>`).join('<br>')],
    ...(grader ? [['Grader', `<code>${esc(grader)}</code>`]] : []),
    ...(surfaces.length ? [['Ran with', surfaces.map((s) => `<code>${esc(s)}</code>`).join('<br>')]] : []),
    ['Receipts', rpaths.length ? esc(String(rpaths.length)) : 'none linked'],
    ['Date', `<code>${esc(row.date.value)}</code>`],
  ];
  return `<aside class="facts-rail" aria-label="Report facts"><div class="rail-in"><p class="eyebrow">This report</p><dl>
${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('\n')}
</dl></div></aside>`;
}

function applyLayout(html, rel, data) {
  let out = stripBetween(html, LAYOUT_OPEN, LAYOUT_CLOSE);
  out = stripBetween(out, LAYOUT_END_OPEN, LAYOUT_END_CLOSE);
  out = out.replace(TOC_ANCHOR_RE, '');
  if (rel === 'index.html' || rel === '404.html' || /<meta http-equiv="refresh"/.test(out)) return out;
  if (out.indexOf('<main') < 0 || out.lastIndexOf('</main>') < 0) return out;
  const heads = tocFor(out);
  for (const h of [...heads].reverse()) if (h.insert) out = out.slice(0, h.at) + h.insert + out.slice(h.at);
  const m = /^reports\/(\d+)(?:-draft)?\/index\.html$/.exec(rel);
  const row = m ? (data || reportsData()).find((r) => String(r.number.value) === m[1]) : null;
  const mainTag = /<main\b([^>]*)>/.exec(out)[1];
  const cls = (/\bclass="([^"]*)"/.exec(mainTag) || [null, ''])[1].split(/\s+/);
  const reading = (cls.includes('report') && !cls.includes('shaped')) || /^writing\//.test(rel);
  const gridCls = ['page-grid', reading ? 'is-reading' : '', cls.includes('screens') ? 'is-screens' : '', row ? 'has-facts' : ''].filter(Boolean).join(' ');
  const terms = heads.length >= 2 ? [] : termsFor(out);
  const reports = heads.length >= 2 || terms.length >= 2 || !/^writing\//.test(rel) ? [] : reportsFor(out);
  if (reports.length >= 2) for (const h of [...reports].reverse()) out = out.slice(0, h.at) + h.insert + out.slice(h.at);
  const entries = heads.length >= 2 ? heads : terms.length >= 2 ? terms : reports.length >= 2 ? reports : [];
  const toc = entries.length
    ? `<nav class="page-toc" aria-label="On this page"><div class="rail-in"><p class="eyebrow">On this page</p><ol>
${entries.map((h) => `<li><a href="#${esc(h.id)}">${railText(h.text)}</a></li>`).join('\n')}
</ol></div></nav>`
    : '';
  const a = out.indexOf('<main');
  out = `${out.slice(0, a)}${LAYOUT_OPEN}<div class="${gridCls}">${toc ? `\n${toc}` : ''}${LAYOUT_CLOSE}\n${out.slice(a)}`;
  const b = out.lastIndexOf('</main>') + 7;
  const nl = out[b] === '\n' ? 1 : 0;
  const end = `${LAYOUT_END_OPEN}${row ? `${factsRail(row)}\n` : ''}</div>${LAYOUT_END_CLOSE}${nl ? '\n' : ''}`;
  out = out.slice(0, b + nl) + end + out.slice(b + nl);
  return out;
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
      // UNDER THE TITLE (spec 125 R-3): the fence follows the report's first </h1> inside <main>,
      // so the summary reads under the title; `splitReportBody` strips it wherever it sits. A page
      // with no heading in <main> keeps the fence at the top of <main> (spec 020 AC-43).
      const card = tldrCard(row, out);
      const a = out.indexOf('<main');
      const h = a < 0 ? -1 : out.indexOf('</h1>', a);
      const e = out.lastIndexOf('</main>');
      if (h >= 0 && (e < 0 || h < e)) out = `${out.slice(0, h + 5)}${card}\n${out.slice(h + 5)}`;
      else out = out.replace(/(<main[^>]*>\s*)/, (m0) => `${m0}${card}\n`);
      const rp = row.receipt_paths.map((x) => (typeof x === 'string' ? x : x.value));
      out = receiptsAnchor(out, new Set(rp.map((x) => x.replace(/\/[^/]+$/, ''))).size > 1);
    }
  }
  out = wrapTables(out);
  out = applyLayout(out, rel, data);
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
  inlinePlot,
  uniqueHatch,
  applyChrome, renderReportPage, applyNavFooter, wrapTables, tldrCard, receiptCard, bibtex, reportsData,
  plainSummary, summariesData, summaryPoints, FORMATS, answersSummary, applyLayout, factsRail, slugOf, LAYOUT_OPEN, LAYOUT_CLOSE, LAYOUT_END_OPEN, LAYOUT_END_CLOSE,
  splitReportBody,
  stripSiteFooter, SITE_FOOTER_RE,
  NAV, FOOTER, SCRIPTS, DOCS_LINKS, ORIGIN, esc,
  TLDR_OPEN, TLDR_CLOSE, TW_OPEN, TW_CLOSE, SUB_OPEN, SUB_CLOSE,
  ANCHOR_OPEN, ANCHOR_CLOSE, RECEIPTS_ANCHOR,
};
