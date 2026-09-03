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
const chrome = require('./site-chrome.js');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';
// THE DEFAULT CARD IS CONTENT-ADDRESSED (spec 020 A2): docs/og.<contenthash>.png.
// Resolved by pattern rather than named, so regenerating the card changes the URL
// and a cache keyed on URL cannot go on serving the old one.
function defaultCardName(root = ROOT) {
  const dir = path.join(root, 'docs');
  const hit = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => /^og\.[0-9a-f]{8}\.png$/.test(n)) : null;
  if (!hit) throw new Error('no docs/og.<contenthash>.png - run: python3 scripts/build-og-card.py --default-hashed --out-dir docs');
  return hit;
}
const CARD = () => `${ORIGIN}/${defaultCardName()}`;
const OPEN = '<!-- driftproof:card-tags -->';
const CLOSE = '<!-- /driftproof:card-tags -->';

// The recorded Cloudflare Web Analytics tag, verbatim as the dashboard issues
// it. The token is not a secret: it ships in client-side HTML on every page by
// design, which is why it can be committed and asserted against.
//
// SPEC 020 makes it CONDITIONAL on docs/site.config.json, and beaconFor() is
// written so that the recorded token reproduces this exact string, byte for
// byte. tests/gate.js asserts that string on every published page and a
// functionally-equivalent re-spelling would take it red for no gain.
const BEACON = "<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{\"token\": \"d78764dd442f49cb9bb203bd6302e9b4\"}'></script><!-- End Cloudflare Web Analytics -->";
const beaconFor = (token) => (token
  ? `<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${token}"}'></script><!-- End Cloudflare Web Analytics -->`
  : '');

// ── the optional slots (spec 020 AC-26) ─────────────────────────────────────
//
// Four fields, all optional, all non-secret. WHERE A FIELD IS SET the template
// renders its markup; WHERE IT IS NOT it renders nothing at all. Not an empty
// meta, not a commented-out form, not a placeholder: an empty tag is markup that
// says the site is configured when it is not, and the gate renders this file
// with each field cleared and asserts the markup VANISHES rather than emptying.
//
// The RSS link is not one of the four. It is always present, because the feed
// always exists.
const CONFIG_PATH = path.join(ROOT, 'docs', 'site.config.json');
function siteConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}
function verificationTags(cfg) {
  const out = [];
  if (cfg.google_site_verification) out.push(`<meta name="google-site-verification" content="${esc(cfg.google_site_verification)}">`);
  if (cfg.bing_site_verification) out.push(`<meta name="msvalidate.01" content="${esc(cfg.bing_site_verification)}">`);
  return out;
}
function subscribeForm(cfg) {
  if (!cfg.subscribe_form_action) return '';
  return `<form class="subscribe" action="${esc(cfg.subscribe_form_action)}" method="post">
<label for="subscribe-email">Email</label>
<input id="subscribe-email" type="email" name="email" autocomplete="email" required>
<button type="submit">Send me the next report</button>
</form>`;
}

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
  // Cut before an em dash, like every other value this loop derives: AC-35
  // forbids U+2014 outside a published report BODY, and a <meta> is not a body.
  return clamp(strip(headline).split(' \u2014 ')[0].trim());
}

// ── spec 020: the whole head, derived ───────────────────────────────────────
//
// Everything below is a PROPERTY OF THE PAGE, computed from the page and from
// docs/data/*.json. Nothing here is a per-page constant somebody has to remember
// to update, which is the defect this file was written to close and which spec
// 020 extends from the card tags to the title, the description, the canonical,
// the per-report card and the structured data.
const ICONS = [
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon-180.png" sizes="180x180">',
  '<link rel="icon" href="/icon-512.png" sizes="512x512" type="image/png">',
];
const HOME_TITLE = 'Driftproof: dated, hash-verified receipts that an agent skill still helps';
const BRAND_SUFFIX = ' | Driftproof';

function reportsData() {
  const p = path.join(ROOT, 'docs', 'data', 'reports.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8')).reports;
}

// A report page's card, found by prefix. The filename carries a hash of the
// bytes, so the name changes when the card changes and a cache keyed on URL
// cannot go on serving the old one (requester addition (a)).
function cardFor(rel) {
  const m = /^reports\/(\d+)\/index\.html$/.exec(rel);
  const dir = path.join(ROOT, 'docs', 'cards');
  if (!m || !fs.existsSync(dir)) return CARD();
  const want = new RegExp(`^report-${m[1]}\\.[0-9a-f]{8}\\.png$`);
  const hit = fs.readdirSync(dir).find((n) => want.test(n));
  return hit ? `${ORIGIN}/cards/${hit}` : CARD();
}

// The <title> each page class owes.
//
// THE BOUND IS 80, not 70 (spec amendment 11). R5 requires the FULL model id out
// of the receipt, `claude-fable-5` rather than `fable-5`, which is seven
// characters a two-model report pays twice. Six of the seven report titles fit
// inside 80 with their type; Report 007's is 83.
//
// WHAT DROPS WHEN ONE DOES NOT FIT IS THE TYPE, WHOLE. The ids are the thing R5
// names as having to survive, and a truncated type reads as a type that does not
// exist - "Instrument" is not a kind of report. The type is still carried by the
// page's own eyebrow, the TL;DR card, the reports index and the Open Graph card,
// so nothing is lost from the page; only the tab loses it. A title that cannot
// fit even without its type throws, rather than shipping a mangled id.
const TITLE_MAX = 80;
function pageTitle(html, rel, rows) {
  if (rel === 'index.html') return HOME_TITLE;
  const m = /^reports\/(\d+)\/index\.html$/.exec(rel);
  if (m) {
    const row = rows.find((r) => String(r.number.value) === m[1]);
    if (!row) throw new Error(`${rel}: no entry in docs/data/reports.json`);
    const type = row.type.value.replace(/\s*report$/i, '');
    const models = row.model_ids.map((x) => x.value).join(', ');
    const full = `Report ${m[1]}: ${type}, ${models}${BRAND_SUFFIX}`;
    if (full.length <= TITLE_MAX) return full;
    const untyped = `Report ${m[1]}: ${models}${BRAND_SUFFIX}`;
    if (untyped.length <= TITLE_MAX) return untyped;
    throw new Error(`${rel}: no title under ${TITLE_MAX} characters keeps every model id (${untyped.length})`);
  }
  const current = first(html, /<title>([\s\S]*?)<\/title>/);
  let name = current === null ? null : strip(current);
  if (name === null) name = strip(first(html, /<h1[^>]*>([\s\S]*?)<\/h1>/) || rel);
  name = name.replace(/\s*[|\u00b7]\s*Driftproof\s*$/i, '').replace(/^Driftproof\s*[\u2014:|\u00b7-]\s*/i, '').trim();
  return `${name}${BRAND_SUFFIX}`;
}

// The description is the page's OWN OPENING, so a page that changes what it says
// changes its description by regeneration rather than by somebody remembering.
// It must open with the first paragraph verbatim (AC-14 asserts that), reach 50
// characters and stop by 160.
//
// Cut at an em dash, never through one: AC-35 forbids U+2014 outside a report
// BODY, and a <meta> is not a body. Recorded as spec amendment 4.
const DESC_MIN = 50;
const DESC_MAX = 160;
function pageDescription(html) {
  const main = html.slice(Math.max(0, html.indexOf('<main')))
    // Not the TL;DR card: that is chrome this loop injected, and a description
    // derived from it would describe the summary rather than the page.
    .replace(/<!--driftproof:tldr-->[\s\S]*?<!--\/driftproof:tldr-->/g, '');
  const paras = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => strip(m[1]).split(' \u2014 ')[0].trim())
    .filter((t) => t.length > 0);
  if (!paras.length) throw new Error('no paragraph to derive a description from');
  let out = paras[0];
  for (let i = 1; i < paras.length && out.length < DESC_MIN; i++) {
    out = `${out.replace(/[.\s]*$/, '')}. ${paras[i]}`;
  }
  if (out.length <= DESC_MAX) return out;
  let cut = out.slice(0, DESC_MAX - 1);
  const at = cut.lastIndexOf(' ');
  if (at > DESC_MAX * 0.6) cut = cut.slice(0, at);
  return `${cut.replace(/[\s,;:(]+$/, '')}\u2026`;
}

// A REDIRECT STUB'S CANONICAL NAMES ITS TARGET. The stub exists only to hand a
// crawler and a reader on to the page that moved; a canonical pointing back at
// the stub would ask the index to keep the address being retired. og:url stays
// the stub's own URL, because that is the URL being shared.
function canonicalOf(html, rel) {
  const m = html.match(/<meta\s+http-equiv="refresh"\s+content="0;\s*url=([^"]+)"/i);
  return m ? `${ORIGIN}${m[1]}` : urlOf(rel);
}

// ── structured data ─────────────────────────────────────────────────────────
const ld = (obj) => `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;

function jsonLd(html, rel, rows, title, description) {
  const url = urlOf(rel);
  if (rel === 'index.html') {
    return [
      ld({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Driftproof', url: `${ORIGIN}/`, description }),
      ld({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Driftproof',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Node.js 22+',
        url: `${ORIGIN}/`,
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        codeRepository: 'https://github.com/driftproofhq/driftproof',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      }),
    ].join('\n');
  }
  const m = /^reports\/(\d+)\/index\.html$/.exec(rel);
  if (m) {
    const row = rows.find((r) => String(r.number.value) === m[1]) || null;
    // One Dataset per receipt the PAGE links, counted off the page itself so the
    // structured data cannot claim more evidence than the report offers.
    const linked = [...new Set([...html.matchAll(/href="([^"]*receipts\/[^"]+\.json)"/g)].map((x) => x[1]))];
    return [
      ld({
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: strip(first(html, /<h1[^>]*>([\s\S]*?)<\/h1>/) || title),
        name: title,
        description,
        url,
        datePublished: row ? row.date.value : undefined,
        publisher: { '@type': 'Organization', name: 'Driftproof', url: `${ORIGIN}/` },
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        hasPart: linked.map((href) => ({
          '@type': 'Dataset',
          name: href.split('/').pop(),
          description: 'A hash-verified Driftproof receipt.',
          encodingFormat: 'application/json',
          contentUrl: href.startsWith('http') ? href : `${ORIGIN}/${href.replace(/^\//, '')}`,
          license: 'https://www.apache.org/licenses/LICENSE-2.0',
        })),
      }),
      ld({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Driftproof', item: `${ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'Reports', item: `${ORIGIN}/reports/` },
          { '@type': 'ListItem', position: 3, name: `Report ${m[1]}`, item: url },
        ],
      }),
    ].join('\n');
  }
  return ld({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url,
    isPartOf: { '@type': 'WebSite', name: 'Driftproof', url: `${ORIGIN}/` },
  });
}

function block(html, rel, title, description, rows, cfg) {
  const isHome = rel === 'index.html';
  return [
    OPEN,
    '<link rel="stylesheet" href="/tokens.css">',
    `<link rel="canonical" href="${canonicalOf(html, rel)}">`,
    '<link rel="alternate" type="application/atom+xml" title="Driftproof reports" href="/feed.xml">',
    ...ICONS,
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(descriptionOf(html, rel))}">`,
    `<meta property="og:image" content="${cardFor(rel)}">`,
    `<meta property="og:url" content="${urlOf(rel)}">`,
    `<meta property="og:type" content="${isHome ? 'website' : 'article'}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    ...verificationTags(cfg),
    jsonLd(html, rel, rows, title, description),
    CLOSE,
  ].filter((line) => line !== '').join('\n');
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
function applyHeadTags(html, rel, config) {
  // The config is read here when a caller does not supply one, so every switch
  // in the build sees the same optional slots without passing them around.
  const cfg = config || siteConfig();
  // The chrome comes first, so the head block is derived from the page as it
  // will ship. Spec 020 AC-12 puts the same nav on every published page and AC-19
  // puts a TL;DR card at the top of every report; doing both here rather than in
  // a second sweep is what keeps report 007's renderer, which already calls this,
  // emitting the finished page and its byte-identity assertion green.
  html = chrome.applyChrome(html, rel);
  // Strip what a previous run left, so this replaces rather than appends.
  let out = html
    .replace(new RegExp(`${OPEN}[\\s\\S]*?${CLOSE}\\n?`, 'g'), '')
    .split(BEACON).join('');
  // The subscribe slot is a fenced region in the page body, rewritten from the
  // config exactly as the head block is, so one switch owns every optional slot.
  out = out.replace(new RegExp(`${chrome.SUB_OPEN}[\\s\\S]*?${chrome.SUB_CLOSE}`, 'g'),
    `${chrome.SUB_OPEN}${subscribeForm(cfg)}${chrome.SUB_CLOSE}`);
  // A description outside the fence would be a second one; the fence owns it.
  out = out.replace(/[ \t]*<meta\s+name="description"[^>]*>\n?/g, '');
  out = out.replace(/[ \t]*<link rel="stylesheet" href="(?:\.\.\/)*tokens\.css">\n?/g, '');

  const rows = reportsData();
  const title = pageTitle(out, rel, rows);
  const description = pageDescription(out);
  out = /<title>[\s\S]*?<\/title>/.test(out)
    ? out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    : out.replace(/<\/head>/, `<title>${esc(title)}</title>\n</head>`);

  const head = out.indexOf('</head>');
  if (head < 0) throw new Error(`${rel}: no </head>`);
  // The beacon goes LAST in <head>, after the card tags.
  const beacon = beaconFor(cfg.cloudflare_analytics_token);
  const insert = `${block(out, rel, title, description, rows, cfg)}\n${beacon ? `${beacon}\n` : ''}`;
  out = out.slice(0, head).replace(/\s*$/, '\n') + insert + out.slice(head);
  return out;
}

// render() takes a DOCS-RELATIVE PATH, not a file. It used to take a file and
// call relOf() on it, which meant a caller holding a rel - and every caller
// outside this file's own loop does - produced `https://driftproofhq.com/../`
// and a canonical URL for a page that does not exist. spec 020 AC-26 also needs
// a render it can hand a config to, so this is the one entry point for both.
const render = (html, rel, cfg) => applyHeadTags(html, rel, cfg);

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = [];
  let n = 0;
  for (const f of pageFiles()) {
    const before = fs.readFileSync(f, 'utf8');
    const after = render(before, relOf(f));
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

module.exports = { pageFiles, render, applyHeadTags, defaultCardName, titleOf, descriptionOf, pageTitle, pageDescription, cardFor, canonicalOf, siteConfig, beaconFor, subscribeForm, verificationTags, BEACON, ORIGIN, CARD, HOME_TITLE };
