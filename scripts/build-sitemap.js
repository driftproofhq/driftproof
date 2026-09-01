#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// docs/sitemap.xml — DERIVED from the built page set, never hand-listed.
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
//   node scripts/build-sitemap.js            regenerate
//   node scripts/build-sitemap.js --check    fail if stale
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
    .map((f) => ({ loc: urlOf(f), lastmod: lastmodOf(f) }))
    .sort((a, b) => a.loc.localeCompare(b.loc));
}

function render(rows) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + rows.map((r) => `  <url><loc>${r.loc}</loc>${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ''}</url>\n`).join('')
    + '</urlset>\n';
}

if (require.main === module) {
  const dest = path.join(ROOT, 'docs', 'sitemap.xml');
  const xml = render(entries());
  const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (current !== xml) {
      console.error('docs/sitemap.xml is STALE against the derived page set — run: node scripts/build-sitemap.js');
      process.exit(1);
    }
    console.log(`docs/sitemap.xml matches the derived page set (${xml.match(/<loc>/g).length} URLs)`);
  } else {
    fs.writeFileSync(dest, xml);
    console.log(`docs/sitemap.xml: ${xml.match(/<loc>/g).length} URLs`);
  }
}

module.exports = { pageFiles, entries, render, urlOf, ORIGIN };
