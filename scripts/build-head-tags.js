#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// The card tags and the analytics beacon, injected into every published page's
// <head> and DERIVED from that page's own content.
//
// WHY A SCRIPT AND NOT A HAND-PATCH. Report pages are rendered by
// scripts/prepare-report-00N.js, so a property applied to the built artifact is
// regenerated away by the next report — the failure class of the #005 v1.0.1
// amendment, where a publication property landed on the artifact instead of on
// the switch that renders it. There are eight such generators, each pinned to
// the report it produced, so the property is not duplicated across all eight.
// It is asserted ONCE, by tests/gate.js, over the derived page set: a Report
// #008 page that lands without these tags takes the gate red before it can
// publish, and `node scripts/build-head-tags.js` is the one-command fix.
//
// IDEMPOTENT. The block is fenced by markers and the beacon is matched exactly,
// so a re-run replaces rather than appends. Running it twice is running it once.
//
//   node scripts/build-head-tags.js            rewrite every page
//   node scripts/build-head-tags.js --check    fail if any page is stale
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';
const CARD = `${ORIGIN}/og.png`;
const OPEN = '<!-- driftproof:card-tags -->';
const CLOSE = '<!-- /driftproof:card-tags -->';

// The recorded Cloudflare Web Analytics tag, verbatim as the dashboard issues
// it. The token is not a secret: it ships in client-side HTML on every page by
// design, which is why it can be committed and asserted against.
const BEACON = "<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{\"token\": \"d78764dd442f49cb9bb203bd6302e9b4\"}'></script><!-- End Cloudflare Web Analytics -->";

// The published page set, filtered through build-public.sh's own EXCLUDE_RE so
// this script and the publish cannot disagree about what a published page is.
function excludeRe() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-public.sh'), 'utf8');
  const m = src.match(/EXCLUDE_RE='([^']+)'/) || src.match(/EXCLUDE_RE="([^"]+)"/);
  if (!m) throw new Error('cannot read EXCLUDE_RE out of scripts/build-public.sh');
  return new RegExp(m[1]);
}

function pageFiles() {
  const docsDir = path.join(ROOT, 'docs');
  const ex = excludeRe();
  const out = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!e.name.endsWith('.html')) continue;
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (!ex.test(rel)) out.push(f);
    }
  })(docsDir);
  return out;
}

const relOf = (f) => path.relative(path.join(ROOT, 'docs'), f).split(path.sep).join('/');
const urlOf = (rel) => ORIGIN + '/' + (rel === 'index.html' ? '' : rel.replace(/(^|\/)index\.html$/, '$1'));
const isReport = (rel) => /^reports\/[^/]+\/index\.html$/.test(rel);

// ── text ────────────────────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s)
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_m, n) => ENT[n]);
const strip = (html) => decode(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// One cap for every description, so a long page and a short one produce the
// same shape of card.
//
// A word boundary is not enough here. Report #007's headline paragraph reaches
// the cap inside `(+0.055 ± 0.111)`, and a card reading "…its own band (+0.055
// ±…" publishes half a figure. On a site whose first invariant is that every
// published number carries a receipt, a truncated number is worse than no
// number: it is a claim nobody can check, on the one surface the gate cannot
// read. So the cut is pulled back out of any parenthetical it lands inside, and
// off any trailing operator or digit fragment.
const CAP = 200;
function clamp(s) {
  if (s.length <= CAP) return s;
  let cut = s.slice(0, CAP - 1);
  const at = cut.lastIndexOf(' ');
  if (at > CAP * 0.6) cut = cut.slice(0, at);
  const open = cut.lastIndexOf('(');
  if (open > -1 && cut.indexOf(')', open) === -1) cut = cut.slice(0, open);
  return `${cut.replace(/[\s,;:.—–+±-]+$/, '')}…`;
}

const first = (html, re) => { const m = html.match(re); return m ? m[1] : null; };

// og:title — the page's <title>, except on a report page, where the <title> can
// be as bare as "Driftproof Report #001" while the <h1> carries the report's
// actual title. audit-index.md §2 records those bare titles as a defect; taking
// the <h1> routes around it without editing a <title> this loop does not own.
function titleOf(html, rel) {
  const src = isReport(rel)
    ? first(html, /<h1[^>]*>([\s\S]*?)<\/h1>/)
    : first(html, /<title>([\s\S]*?)<\/title>/);
  if (src === null) throw new Error(`${rel}: no ${isReport(rel) ? '<h1>' : '<title>'} to derive og:title from`);
  return strip(src);
}

// og:description — the page's own meta description where it has one; otherwise
// its headline paragraph, then its eyebrow, then its first paragraph. Six report
// pages carry no description at all (#001, #002, #004, #005, #006, #007), and
// deriving theirs from the page means a report that amends its headline amends
// its card by regeneration rather than by somebody remembering.
function descriptionOf(html, rel) {
  const meta = first(html, /<meta\s+name="description"\s+content="([^"]*)"/);
  if (meta !== null) return clamp(strip(meta));
  const headline = first(html, /<div class="headline">[\s\S]*?<p class="big"[^>]*>([\s\S]*?)<\/p>/)
    || first(html, /<p class="report-type"[^>]*>([\s\S]*?)<\/p>/)
    || first(html, /<main[^>]*>[\s\S]*?<p(?![^>]*class="(?:report-type|version-note|pair)")[^>]*>([\s\S]*?)<\/p>/);
  if (headline === null) throw new Error(`${rel}: nothing to derive og:description from`);
  return clamp(strip(headline));
}

function block(html, rel) {
  return [
    OPEN,
    `<meta property="og:title" content="${esc(titleOf(html, rel))}">`,
    `<meta property="og:description" content="${esc(descriptionOf(html, rel))}">`,
    `<meta property="og:image" content="${CARD}">`,
    `<meta property="og:url" content="${urlOf(rel)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    CLOSE,
  ].join('\n');
}

// THE ONE ENTRY POINT, and the reason it takes a docs-relative path rather than
// a file: `scripts/prepare-report-007.js` calls it on a page it has not written
// yet.
//
// That call is not optional. The repo gate asserts report 007's page is
// BYTE-IDENTICAL to what its receipts render — the page is a pure function of
// them — so injecting tags into the file on disk and not into the renderer would
// have taken an existing invariant red. The choice was to weaken that assertion
// or to make the renderer emit the finished page; the second keeps one source of
// truth for the head block and leaves the invariant exactly as strong as it was.
function applyHeadTags(html, rel) {
  // Strip what a previous run left, so this replaces rather than appends.
  let out = html
    .replace(new RegExp(`${OPEN}[\\s\\S]*?${CLOSE}\\n?`, 'g'), '')
    .split(BEACON).join('');
  const head = out.indexOf('</head>');
  if (head < 0) throw new Error(`${rel}: no </head>`);
  // The beacon goes LAST in <head>, after the card tags.
  const insert = `${block(html, rel)}\n${BEACON}\n`;
  out = out.slice(0, head).replace(/\s*$/, '\n') + insert + out.slice(head);
  return out;
}

const render = (html, f) => applyHeadTags(html, relOf(f));

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = [];
  let n = 0;
  for (const f of pageFiles()) {
    const before = fs.readFileSync(f, 'utf8');
    const after = render(before, f);
    if (before === after) { n++; continue; }
    if (check) { stale.push(relOf(f)); continue; }
    fs.writeFileSync(f, after);
    n++;
  }
  if (check && stale.length) {
    console.error(`stale head tags — run: node scripts/build-head-tags.js\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(check ? `all ${n} published pages carry current head tags` : `head tags written to ${n} published pages`);
}

module.exports = { pageFiles, render, applyHeadTags, titleOf, descriptionOf, BEACON, ORIGIN, CARD };
