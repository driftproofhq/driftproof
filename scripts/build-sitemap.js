#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// docs/sitemap.xml, feed.xml, robots.txt and llms.txt — ALL DERIVED from the
// built page set and from docs/data/reports.json, never hand-listed.
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

// lastmod is the file's own last commit date, read at GENERATION time and
// committed with the result. It is deliberately not recomputed by the gate: a
// published tree is one squashed commit, so `git log` there reports the publish
// date for every file and byte-identity against a regeneration is not a property
// that holds in both trees. The gate asserts what does — set equality and a
// well-formed lastmod — and this script's --check asserts regenerable-identical
// in the source tree, where the question means something.
function lastmodOf(f) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  try {
    const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch (_e) { return null; }
}

function entries() {
  return pageFiles()
    .filter((f) => !isStub(f))
    .map((f) => ({ loc: urlOf(f), lastmod: lastmodOf(f) }))
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

// The report line names what moved, not the page's own <h1>. It used to
// interpolate the h1 after "Report NNN:", which reproduced the number - "Report
// 006: Report #006 - the skill text moves" - and carried a hash sign and an em
// dash into a file this loop writes (Q2).
function renderLlms(rows) {
  return `# Driftproof

> A public instrument and public record measuring whether agent skills still
> deliver their claimed lift as models, providers and releases move underneath
> them. Every published number carries a dated, hash-verified receipt.

Driftproof runs a skill's own eval suite twice, with the skill and without it,
scores each answer several times so every result is a range rather than one
fragile number, and claims a verdict only when the two ranges do not overlap and
the move clears the effect floor. When it cannot stand behind a number it
publishes a refusal instead of a guess.

## Reports

${rows.map((r) => `- [Report ${r.number.value}: ${r.what_moved.value}](${ORIGIN}/reports/${r.number.value}/): ${r.type.value}, ${r.date.value}. ${r.headline_counts.value} Models: ${r.model_ids.map((m) => m.value).join(', ')}.`).join('\n')}

## Method and definitions

- [Methodology](${ORIGIN}/methodology/): how a run is scored, what a band is, and what the effect floor does.
- [Neutrality](${ORIGIN}/neutrality/): what Driftproof will not claim, and the limitations it discloses.
- [Glossary](${ORIGIN}/glossary/): drift report, receipt, band, effect floor, substrate, surface, refusal, cell, arm, and the verification lattice.
- [Report types](${ORIGIN}/report-types/): the six kinds of report and what moves underneath the skill in each.
- [Receipt specification](https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md): the receipt format, its schema versions, and the UNVERIFIED / DECLARED / TESTED / FORMAL levels.

## Optional

- [Interop](${ORIGIN}/interop/): importing results from other tools as DECLARED, and exporting a summary.
- [Authoring](${ORIGIN}/authoring/): writing a skill and an eval suite worth measuring.
- [Judge policy](${ORIGIN}/judge-policy/): which model judges, and why it is held fixed.
- [Atom feed](${ORIGIN}/feed.xml)
`;
}

function render(rows) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + rows.map((r) => `  <url><loc>${r.loc}</loc>${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ''}</url>\n`).join('')
    + '</urlset>\n';
}

if (require.main === module) {
  const docs = path.join(ROOT, 'docs');
  const rows = reportRows();
  const want = {
    'sitemap.xml': render(entries()),
    'feed.xml': renderFeed(rows),
    'robots.txt': renderRobots(),
    'llms.txt': renderLlms(rows),
  };

  const outAt = process.argv.indexOf('--llms-out');
  if (outAt > -1) {
    fs.writeFileSync(path.resolve(process.argv[outAt + 1]), want['llms.txt']);
    process.exit(0);
  }

  if (process.argv.includes('--check')) {
    const stale = Object.entries(want).filter(([name, body]) => {
      const f = path.join(docs, name);
      return !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== body;
    }).map(([name]) => name);
    if (stale.length) {
      console.error(`STALE against the derived page set — run: node scripts/build-sitemap.js\n  ${stale.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`sitemap, feed, robots and llms.txt all match the derived page set (${want['sitemap.xml'].match(/<loc>/g).length} URLs, ${rows.length} reports)`);
  } else {
    for (const [name, body] of Object.entries(want)) fs.writeFileSync(path.join(docs, name), body);
    console.log(`docs/sitemap.xml: ${want['sitemap.xml'].match(/<loc>/g).length} URLs; feed.xml, robots.txt, llms.txt: ${rows.length} reports`);
  }
}

module.exports = { pageFiles, entries, render, renderFeed, renderRobots, renderLlms, urlOf, isStub, ORIGIN };
