#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// docs/sitemap.xml (an index since spec 133) and its two children, sitemap-pages.xml and
// sitemap-receipts.xml, docs/data/page-dates.json, feed.xml, robots.txt and llms.txt: ALL DERIVED
// from the built page set, its history and docs/data/reports.json, never hand-listed.
//
// The hand-maintained file this replaces silently omitted Report #005 and #006:
// it listed 11 URLs for a 13-page site, Search Console read and confirmed the
// 11, and nothing failed. The set is the property "every .html under docs/ that
// build-public.sh publishes", so a new report page appears without anyone
// remembering it, and the repo gate asserts this file matches that property in
// BOTH directions — one direction is exactly how a subset passes.
//
// Generated into a COMMITTED file rather than only at publish time: produced
// only during the build, the dev tree's copy would be permanently stale and the
// gate assertion, which runs over docs/ in both trees, would fail in dev.
//
// A REDIRECT STUB IS NOT A PAGE (spec 020 AC-22). The five documentation pages
// moved to clean paths and left a meta-refresh stub at each old address, so that
// every already-indexed URL and every link inside a published report body still
// resolves. Listing a stub in the sitemap asks a crawler to index a document
// whose only content is "this moved", so stubs are filtered out here and the
// repo gate applies the same rule in both directions - plus one more, that every
// stub's canonical target IS listed, so a stub can never hide a missing page.
//
// llms.txt IS GENERATED, NEVER MAINTAINED (requester addition (b)). The draft
// spec 019a declined to ship predated Report #007 and would have shipped a stale
// index the day it landed. This one is a function of docs/data/reports.json, and
// the spec gate asserts both that it regenerates identically and that its report
// set is exactly the data's.
//
//   node scripts/build-sitemap.js                regenerate all four
//   node scripts/build-sitemap.js --check        fail if any is stale
//   node scripts/build-sitemap.js --llms-out F   write llms.txt to F and stop
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const chrome = require('./site-chrome.js');
const { htmlToText } = require('./html-text.js');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';

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

// A stub carries a meta refresh: it exists to hand a reader on, and it is not a
// document anybody should be sent to by a search engine.
function isStub(f) {
  return /<meta\s+http-equiv="refresh"/i.test(fs.readFileSync(f, 'utf8'));
}

// An index.html becomes its directory URL, which is the form the sitemap has
// always used — one URL per page, never two for the same document.
function urlOf(f) {
  const rel = path.relative(path.join(ROOT, 'docs'), f).split(path.sep).join('/');
  return ORIGIN + '/' + (rel === 'index.html' ? '' : rel.replace(/(^|\/)index\.html$/, '$1'));
}

// A PAGE THAT SAYS NOINDEX IS NOT LISTED (spec 133 R-5): 404.html and /subscribed/ are published
// and not indexed, and a sitemap that lists them asks a crawler for pages the pages refuse.
function isNoindex(f) {
  return /<meta\s+name="robots"\s+content="[^"]*\bnoindex\b/i.test(fs.readFileSync(f, 'utf8'));
}
const relOf = (f) => path.relative(path.join(ROOT, 'docs'), f).split(path.sep).join('/');
const isReceipt = (rel) => /^r\/[0-9a-f]{64}\/index\.html$/.test(rel);

// ── a page's date: its last commit that changed its words (spec 133 R-6, AC-9) ──
//
// The date used to be the file's last commit. Every chrome pass touches every page, so every page
// carried the date of the last nav or footer change: all 185 read 2026-09-30 at spec 133's Base,
// and a crawler told everything changed is told nothing. A page's date is now the date of the newest
// commit, on the first-parent line, whose version of the page says different WORDS from the version
// before it: the text inside <main>, less the chrome's fenced regions, the site footer, scripts and
// styles, the definition spec 130 AC-4 reads. A head, nav, footer or layout change moves nothing.
//
// Read at GENERATION time and committed in docs/data/page-dates.json, which the sitemaps and a
// report's dateModified both read, so a published tree without history reads the same dates. A page
// whose working-tree words differ from HEAD's is dated `today`: its words change in the commit about
// to be made.
//
// THE COMMIT THAT MADE THE WORDS, NOT THE ONE THAT CARRIED THEM IN (spec 133 Amendment 4, approval
// F-2). On dev's first-parent line a --no-ff merge is the commit that changes a page's words, so the
// first-parent walk alone dated the page by the day the merge ran, and the committed dates went stale
// whenever a merge ran on a later day than the build. So a merge whose words came from another parent
// is followed into that parent's own line, down to the commit there that changed them. The date is
// the AUTHOR date, which a rebase, a cherry-pick and an amend keep. And a words commit that also
// wrote the page a new entry in page-dates.json, no later than itself, is dated by that entry: the
// generator wrote `today` before the commit, and a commit made the next day keeps the build's date.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeWords = (t) => t
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_m, n) => ENT[n]);
function mainWords(html) {
  const s = String(html || '');
  const a = s.indexOf('<main');
  const b = s.lastIndexOf('</main>');
  if (a < 0 || b < 0) return '';
  let m = s.slice(a, b);
  for (const [open, close] of [[chrome.TLDR_OPEN, chrome.TLDR_CLOSE], [chrome.ANCHOR_OPEN, chrome.ANCHOR_CLOSE], [chrome.SUB_OPEN, chrome.SUB_CLOSE], [chrome.LAYOUT_OPEN, chrome.LAYOUT_CLOSE], [chrome.LAYOUT_END_OPEN, chrome.LAYOUT_END_CLOSE]]) {
    m = m.split(open).map((part, i) => (i === 0 ? part : part.slice(part.indexOf(close) < 0 ? part.length : part.indexOf(close) + close.length))).join('');
  }
  return htmlToText(chrome.stripSiteFooter(m), { skip: ['script', 'style'], tagText: ' ', commentText: ' ', decode: decodeWords, collapse: true });
}
// Every version of each file under docs/ on the first-parent line from `rev`, less what `stop`
// reaches, newest first: path -> [{ sha, date, parents }].
function versions(root, rev = 'HEAD', stop = null) {
  const out = new Map();
  let cur = null;
  const log = execFileSync('git', ['-C', root, 'log', '--first-parent', '--diff-merges=first-parent', '--format=@@%H %as %P', '--name-only', rev, ...(stop ? [`^${stop}`] : []), '--', 'docs/'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) { const [sha, date, ...parents] = line.slice(2).split(' '); cur = { sha, date, parents }; continue; }
    if (!line || !cur) continue;
    if (!out.has(line)) out.set(line, []);
    out.get(line).push(cur);
  }
  return out;
}
// The blobs `<rev>:<path>` in one `git cat-file --batch`, as strings; a missing one is null.
function blobs(root, specs) {
  if (!specs.length) return [];
  const buf = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input: specs.join('\n') + '\n', maxBuffer: 1024 * 1024 * 1024 });
  const out = [];
  let at = 0;
  for (let i = 0; i < specs.length; i++) {
    const nl = buf.indexOf(10, at);
    const head = buf.toString('utf8', at, nl);
    if (/ missing$/.test(head)) { out.push(null); at = nl + 1; continue; }
    const size = Number(head.split(' ')[2]);
    out.push(buf.toString('utf8', nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  return out;
}
const DATES = 'docs/data/page-dates.json';
function contentDates({ root = ROOT, rels, today = new Date().toISOString().slice(0, 10) }) {
  const logs = new Map();
  const log = (rev, stop) => { const k = `${rev} ${stop || ''}`; if (!logs.has(k)) logs.set(k, versions(root, rev, stop)); return logs.get(k); };
  const seen = new Map();
  const words = (specs) => {
    const need = [...new Set(specs.filter((s) => !seen.has(s)))];
    blobs(root, need).forEach((t, i) => seen.set(need[i], t == null ? null : mainWords(t)));
    return specs.map((s) => seen.get(s));
  };
  const recorded = new Map();
  const entries = (rev) => {
    if (!recorded.has(rev)) { const t = blobs(root, [`${rev}:${DATES}`])[0]; let d = {}; try { d = (t && JSON.parse(t).dates) || {}; } catch { d = {}; } recorded.set(rev, d); }
    return recorded.get(rev);
  };
  // The newest commit on `rev`'s first-parent line, less what `stop` reaches, whose version of `p`
  // says other words than its parent's; a merge whose words one of its other parents carries is
  // followed into that parent's line.
  const wordsCommit = (p, rev, stop, depth) => {
    const vs = log(rev, stop).get(p) || [];
    if (!vs.length) return null;
    const texts = words([...vs.map((v) => `${v.sha}:${p}`), `${vs[vs.length - 1].sha}^:${p}`]);
    const i = vs.findIndex((_v, k) => texts[k] !== texts[k + 1]);
    if (i < 0) return null;
    const c = vs[i];
    if (depth < 64) {
      for (const q of c.parents.slice(1)) {
        if (words([`${q}:${p}`])[0] !== texts[i]) continue;
        const inner = wordsCommit(p, q, c.parents[0], depth + 1);
        if (inner) return inner;
      }
    }
    return c;
  };
  const out = {};
  for (const rel of rels) {
    const p = `docs/${rel}`;
    const file = path.join(root, p);
    const now = fs.existsSync(file) ? mainWords(fs.readFileSync(file, 'utf8')) : null;
    const c = now !== words([`HEAD:${p}`])[0] ? null : wordsCommit(p, 'HEAD', null, 0);
    if (!c) { out[rel] = today; continue; }
    const mine = entries(c.sha)[rel];
    const was = c.parents.length ? entries(`${c.sha}^`)[rel] : undefined;
    out[rel] = /^\d{4}-\d{2}-\d{2}$/.test(mine || '') && mine !== was && mine <= c.date ? mine : c.date;
  }
  return out;
}

// Every published page, stubs and noindex pages included, with its date.
function datesFile() {
  const rels = pageFiles().map(relOf);
  const dates = contentDates({ rels });
  return `${JSON.stringify({ _what: 'Derived at build by scripts/build-sitemap.js: each published page\'s last commit that changed its words (spec 133 R-6). Read by the sitemaps and by a report\'s dateModified. Do not hand-edit.', dates: Object.fromEntries(Object.entries(dates).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`;
}

// Indexable pages, split: editorial pages and receipt pages (spec 133 AC-8).
function entries(dates) {
  return pageFiles()
    .filter((f) => !isStub(f) && !isNoindex(f))
    .map((f) => ({ rel: relOf(f), loc: urlOf(f), lastmod: dates[relOf(f)] || null }))
    .sort((a, b) => a.loc.localeCompare(b.loc));
}

// ── the other three derived files ───────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reportRows = () => JSON.parse(
  fs.readFileSync(path.join(ROOT, 'docs', 'data', 'reports.json'), 'utf8')).reports;

function renderRobots() {
  return [
    '# https://driftproofhq.com',
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
}

// Atom, newest first. `updated` per entry is the report's own date, which is the
// date its receipts were run - not the date this file was generated, because a
// feed that re-dates every entry on every build tells a subscriber that seven
// reports changed when none did.
function renderFeed(rows) {
  const updated = (d) => `${d}T00:00:00Z`;
  const newest = rows.length ? rows[0].date.value : '1970-01-01';
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Driftproof reports</title>
  <subtitle>Dated, hash-verified receipts that an agent skill still helps.</subtitle>
  <link href="${ORIGIN}/feed.xml" rel="self"/>
  <link href="${ORIGIN}/"/>
  <id>${ORIGIN}/</id>
  <updated>${updated(newest)}</updated>
  <author><name>Driftproof</name></author>
${rows.map((r) => `  <entry>
    <title>${esc(`Report ${r.number.value}: ${r.type.value.replace(/\s*report$/i, '')}, ${r.model_ids.map((m) => m.value).join(', ')}`)}</title>
    <link href="${ORIGIN}/reports/${r.number.value}/"/>
    <id>${ORIGIN}/reports/${r.number.value}/</id>
    <updated>${updated(r.date.value)}</updated>
    <category term="${esc(r.type.value)}"/>
    <summary>${esc(`${r.headline_counts.value} Models: ${r.model_ids.map((m) => m.value).join(', ')}.`)}</summary>
  </entry>`).join('\n')}
</feed>
`;
}

// llms.txt is scripts/build-llms.js's (spec 135): its opening and sections are the ones this file
// wrote, its report lines one sentence of what each report found, and the answer pages listed. One
// renderer, so this file and that one cannot disagree; `rows` is kept for the callers that pass it.
function renderLlms(_rows) {
  return require('./build-llms.js').renderLlms();
}

function render(rows) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + rows.map((r) => `  <url><loc>${r.loc}</loc>${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ''}</url>\n`).join('')
    + '</urlset>\n';
}

// THE INDEX (spec 133 AC-8): docs/sitemap.xml names two sitemaps, the editorial pages and the
// receipts, so a crawler and Search Console read the two apart. robots.txt still names
// docs/sitemap.xml, which Search Console already has.
const CHILDREN = [['sitemap-pages.xml', (e) => !isReceipt(e.rel)], ['sitemap-receipts.xml', (e) => isReceipt(e.rel)]];
function renderIndex(kids) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + kids.map(([name, rows]) => {
      const newest = rows.map((r) => r.lastmod).filter(Boolean).sort().pop();
      return `  <sitemap><loc>${ORIGIN}/${name}</loc>${newest ? `<lastmod>${newest}</lastmod>` : ''}</sitemap>\n`;
    }).join('')
    + '</sitemapindex>\n';
}

// Every page URL the sitemaps list, following the index to its children in a docs/ directory: the
// one reader for anything that used to read <url><loc> out of docs/sitemap.xml.
function sitemapLocs(docsDir = path.join(ROOT, 'docs')) {
  const read = (n) => (fs.existsSync(path.join(docsDir, n)) ? fs.readFileSync(path.join(docsDir, n), 'utf8') : '');
  const top = read('sitemap.xml');
  const files = /<sitemapindex\b/.test(top)
    ? [...top.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(`${ORIGIN}/`, ''))
    : ['sitemap.xml'];
  return files.flatMap((n) => [...read(n).matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]*)<\/lastmod>)?\s*<\/url>/g)].map((m) => ({ loc: m[1], lastmod: m[2] || null })));
}

if (require.main === module) {
  const docs = path.join(ROOT, 'docs');
  const rows = reportRows();
  const outAt = process.argv.indexOf('--llms-out');
  if (outAt > -1) {
    fs.writeFileSync(path.resolve(process.argv[outAt + 1]), renderLlms(rows));
    process.exit(0);
  }
  const datesJson = datesFile();
  const all = entries(JSON.parse(datesJson).dates);
  const kids = CHILDREN.map(([name, keep]) => [name, all.filter(keep)]);
  const want = {
    'sitemap.xml': renderIndex(kids),
    ...Object.fromEntries(kids.map(([name, list]) => [name, render(list)])),
    'data/page-dates.json': datesJson,
    'feed.xml': renderFeed(rows),
    'robots.txt': renderRobots(),
    'llms.txt': renderLlms(rows),
  };
  const counts = kids.map(([name, list]) => `${name} ${list.length}`).join(', ');

  if (process.argv.includes('--check')) {
    const stale = Object.entries(want).filter(([name, body]) => {
      const f = path.join(docs, name);
      return !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== body;
    }).map(([name]) => name);
    if (stale.length) {
      console.error(`STALE against the derived page set — run: node scripts/build-sitemap.js\n  ${stale.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`sitemaps, page dates, feed, robots and llms.txt all match the derived page set (${counts}; ${rows.length} reports)`);
  } else {
    for (const [name, body] of Object.entries(want)) fs.writeFileSync(path.join(docs, name), body);
    console.log(`docs/sitemap.xml: an index of ${counts}; page-dates.json, feed.xml, robots.txt, llms.txt: ${rows.length} reports`);
  }
}

module.exports = { pageFiles, entries, render, renderIndex, renderFeed, renderRobots, renderLlms, urlOf, isStub, isNoindex, mainWords, contentDates, sitemapLocs, ORIGIN };
