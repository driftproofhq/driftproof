#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/build-readme-opening.mjs - the README's first screen (spec 126), written above its first
// body line, `Driftproof **consumes**`, from docs/data/readme-opening.json and the files each value
// names. Nothing in the opening is kept by hand in two places:
//
//   - the words no other file holds (the pitch, what Driftproof tells you, what it does not show,
//     what the two plugin commands do, the labels) are the data file's;
//   - the two `claude plugin` lines are the README's own `### Install` section's;
//   - the Node.js major is package.json `engines.node`;
//   - every in-page link is the GitHub anchor of a heading the README carries;
//   - the report count word is docs/data/stats.json `reports_published_word`;
//   - the latest finding is the first sentence of the newest report's "What we found." point in
//     docs/data/report-summaries.json (spec 125), resolved by scripts/site-chrome.js
//     `summaryPoints`, the same resolver the report page's own summary uses, and dated by
//     stats.json `latest_report_date`. A new report's summary row moves the line on the next run.
//     The opening is a first-read surface (issue 652): a term the summary uses undefined, such as
//     "by the case rule", is said in the data file's plain words (`finding_plain`), which carry no
//     count, so no figure moves; the report page keeps the summary's own words.
//   - the free measurement line (issue 797) is the data file's choice of the /measure/ page's own
//     sentences, each found on that page, linked to it;
//   - the paper line below the first screen (issue 797) is docs/data/paper.json's facts, in its
//     own fence, written and checked with the opening;
//   - the badge's image line is kept as the README carries it; spec 020 AC-30 holds it to its Base;
//   - the view screenshot is a committed file under docs/, shown by its site URL (the site serves
//     docs/ at its root), so it renders on GitHub and on npm, where a repository path would not;
//     its receipts link is package.json `repository.url`'s tree on `main`, the public mirror.
//
//   node scripts/build-readme-opening.mjs           write README.md's opening
//   node scripts/build-readme-opening.mjs --check   exit 1 when README.md's opening is not current
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
export const ANCHOR = 'Driftproof **consumes**';
const WIDTH = 80;
const ORIGIN = 'https://driftproofhq.com';

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const json = (root, rel) => JSON.parse(read(root, rel));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GitHub's anchor for a heading: markup out, lower case, anything but letters, digits, spaces,
// hyphens and underscores dropped, each space a hyphen.
function slug(heading) {
  const t = heading.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1');
  return t.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
}
function headings(readme) {
  const out = [];
  let fenced = false;
  for (const line of readme.split('\n')) {
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    const m = !fenced && /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], anchor: slug(m[2]) });
  }
  return out;
}
function section(readme, title, level) {
  const lines = readme.split('\n');
  const start = lines.findIndex((l) => l === `${'#'.repeat(level)} ${title}`);
  if (start < 0) throw new Error(`README.md has no "${'#'.repeat(level)} ${title}" heading`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { const m = /^(#{1,6})\s/.exec(lines[i]); if (m && m[1].length <= level) { end = i; break; } }
  return lines.slice(start, end).join('\n');
}

// Greedy at WIDTH columns. A soft line break is a space in Markdown, so wrapping changes nothing a
// reader sees, provided no line opens with a list, heading or quote marker: such a line takes the
// word before it.
export function wrap(text) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (cur && `${cur} ${w}`.length > WIDTH) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  for (let i = 1; i < lines.length; i++) {
    while (/^([-+*#>]|\d+[.)])(\s|$)/.test(lines[i])) {
      const prev = lines[i - 1].split(' ');
      if (prev.length < 2) break;
      lines[i] = `${prev.pop()} ${lines[i]}`;
      lines[i - 1] = prev.join(' ');
    }
  }
  return lines.join('\n');
}

// The newest report's finding: the first sentence of its "What we found." point. Its first letter
// is lowered after the colon unless the word is a name, which is a word the same summary
// capitalises after a lower-case letter or a comma.
export function latestFinding({ root = DEFAULT_ROOT } = {}) {
  const require = createRequire(path.join(root, 'scripts', 'build-readme-opening.mjs'));
  const chrome = require(path.join(root, 'scripts', 'site-chrome.js'));
  const stats = json(root, 'docs/data/stats.json');
  const plain = json(root, 'docs/data/readme-opening.json').finding_plain || {};
  for (const [term, words] of Object.entries(plain)) if (/\d/.test(words)) throw new Error(`docs/data/readme-opening.json finding_plain gives "${term}" words that carry a figure: ${JSON.stringify(words)}`);
  const n = String(stats.latest_report_number.value);
  const date = chrome.FORMATS['d Mon yyyy'](stats.latest_report_date.value);
  const points = chrome.summaryPoints(n);
  if (!points) throw new Error(`docs/data/report-summaries.json has no row for report ${n}, the newest`);
  const found = points.find((p) => p.lead === 'What we found.');
  if (!found) throw new Error(`report ${n}'s summary has no "What we found." point`);
  let first = found.text.split(/(?<=[.!?])\s+(?=[A-Z])/)[0];
  for (const [term, words] of Object.entries(plain)) first = first.split(term).join(words);
  const w = first.split(/\s+/)[0];
  const proper = new RegExp(`[a-z,;:)] ${escRe(w)}\\b`).test(points.map((p) => p.text).join(' '));
  return { n, date, sentence: proper ? first : first.charAt(0).toLowerCase() + first.slice(1) };
}

// A file under docs/ as the site serves it; the view image and its receipts link.
export function siteUrl(rel) {
  if (!/^docs\//.test(rel)) throw new Error(`${rel} is not under docs/, so the site does not serve it`);
  return `${ORIGIN}/${rel.slice('docs/'.length)}`;
}
export function repoTreeUrl(root, rel) {
  const url = ((json(root, 'package.json').repository || {}).url || '').replace(/^git\+/, '').replace(/\.git$/, '');
  if (!/^https:\/\/github\.com\//.test(url)) throw new Error(`package.json repository.url is not a GitHub URL: ${JSON.stringify(url)}`);
  return `${url}/tree/main/${rel.replace(/\/$/, '')}`;
}
// Issue 797: the free measurement offer, one line. Its link text and sentences are the data file's
// choice of the /measure/ page's own sentences, read from the words that page is built from
// (scripts/build-measure.js `const WORDS = {...}`, read as text so the README builder needs nothing
// the page builder requires); each must be found in a string there, so the line says nothing the page
// does not.
const MEASURE_BUILDER = 'scripts/build-measure.js';
export function measureLine(root, m) {
  if (!m) return '';
  const src = read(root, MEASURE_BUILDER);
  const a = src.indexOf('const WORDS = {'); const b = src.indexOf('\n};', a);
  if (a < 0 || b < 0) throw new Error(`${MEASURE_BUILDER} carries no "const WORDS = {...};" block`);
  const strings = [...src.slice(a, b).matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((x) => (x[1] ?? x[2]).replace(/\\(.)/g, '$1'));
  for (const s of m.sentences) if (!strings.some((x) => x.includes(s))) throw new Error(`the /measure/ page's words (${MEASURE_BUILDER}) do not say ${JSON.stringify(s)}`);
  const rel = (/^const REL = '([^']+)';$/m.exec(src) || [])[1];
  if (!rel) throw new Error(`${MEASURE_BUILDER} names no REL for its page`);
  const [first, ...rest] = m.sentences;
  return `${wrap(`**${m.label}** · [${first.replace(/\.$/, '')}](${ORIGIN}/${rel.replace(/index\.html$/, '')}). ${rest.join(' ')}`)}\n\n`;
}

// Issue 797: the paper, below the first screen in its own fence, from docs/data/paper.json (spec 127
// A-127-9), the facts the paper page shows: title, version, status, the version's DOI and the DOI for
// all versions.
export const PAPER_FENCE = ['<!--driftproof:readme-paper-->', '<!--/driftproof:readme-paper-->'];
export function paperBlock(root) {
  const P = json(root, 'docs/data/paper.json');
  return `${PAPER_FENCE[0]}\n${wrap(`📄 **Paper** · [${P.title}](${ORIGIN}${P.scholar.abstract_html_url.replace(ORIGIN, '')}). ${P.version_line}. ${P.preprint_line}. DOI [${P.doi}](${P.doi_url}); all versions [${P.concept_doi}](${P.concept_doi_url}).`)}\n${PAPER_FENCE[1]}`;
}
function withPaper(root, readme) {
  const block = paperBlock(root);
  const a = readme.indexOf(PAPER_FENCE[0]); const b = readme.indexOf(PAPER_FENCE[1]);
  if (a >= 0 && b > a) return readme.slice(0, a) + block + readme.slice(b + PAPER_FENCE[1].length);
  const at = readme.indexOf(PAPER_AFTER);
  if (at < 0) throw new Error(`README.md has no "${PAPER_AFTER}" paragraph to place the paper before`);
  return `${readme.slice(0, at)}${block}\n\n${readme.slice(at)}`;
}
const PAPER_AFTER = 'Driftproof does **not** commit third-party skill content.';

function viewBlock(root, v) {
  if (!v || !v.image) return '';
  const caption = String(v.caption || '').replace('{receipts_url}', repoTreeUrl(root, (v.receipts || [])[0] || ''));
  return `![${v.alt}](${siteUrl(v.image)})\n${wrap(caption)}\n${v.note ? `${wrap(v.note)}\n` : ''}\n`;
}

export function composeOpening({ root = DEFAULT_ROOT } = {}) {
  const readme = read(root, 'README.md');
  const at = readme.indexOf(ANCHOR);
  if (at < 0) throw new Error(`README.md has no "${ANCHOR}" line`);
  const d = json(root, 'docs/data/readme-opening.json');
  if (!/^Driftproof\b/.test(d.title || '')) throw new Error('docs/data/readme-opening.json title does not open with the name, Driftproof');
  const stats = json(root, 'docs/data/stats.json');
  const heads = headings(readme);
  const anchor = (pred, what) => { const h = heads.find(pred); if (!h) throw new Error(`README.md has no heading ${what}`); return h.anchor; };
  const plugin = section(readme, d.install_link.heading, 3).split('\n').map((l) => l.trim()).filter((l) => /^claude plugin /.test(l));
  if (plugin.length !== 2) throw new Error(`the Install section carries ${plugin.length} claude plugin lines, not two`);
  const engines = ((json(root, 'package.json').engines || {}).node) || '';
  const major = (/(\d+)/.exec(engines) || [])[1];
  if (!major) throw new Error(`package.json engines.node names no version: ${JSON.stringify(engines)}`);
  const badge = (readme.slice(0, at).match(/^\[!\[driftproof\][^\n]*$/m) || [])[0];
  if (!badge) throw new Error("README.md's opening carries no badge line to keep");
  const firstRun = d.first_run_link ? `[${d.first_run_link.label}](#${anchor((h) => h.level === 2 && h.text === d.first_run_link.heading, `## ${d.first_run_link.heading}`)}) · ` : '';
  const install = `#${anchor((h) => h.level === 3 && h.text === d.install_link.heading, `### ${d.install_link.heading}`)}`;
  const quick = `#${anchor((h) => h.level === 2 && h.text.startsWith(d.quickstart_link.heading_starts), `## ${d.quickstart_link.heading_starts}...`)}`;
  const reports = `#${anchor((h) => h.level === 2 && h.text === d.reports_link.heading, `## ${d.reports_link.heading}`)}`;
  const f = latestFinding({ root });
  const host = new URL(d.site_link).host;
  const view = viewBlock(root, d.view);
  return `<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- The first screen is written by scripts/build-readme-opening.mjs from docs/data/readme-opening.json (spec 126): edit that file, never this block. -->
# ${d.title}

**${d.pitch}**

${wrap(d.what)}

${d.limits ? `${wrap(d.limits)}\n\n` : ''}### ${d.try_heading}

\`\`\`bash
${plugin.join('\n')}
\`\`\`

${wrap(d.commands.replace('{node_major}', major))}
${firstRun}[${d.install_link.label}](${install}) · [${d.quickstart_link.label}](${quick})

${wrap(`**${d.finding_label}** · [Report ${f.n}](${ORIGIN}/reports/${f.n}/), ${f.date}: ${f.sentence}`)}

${measureLine(root, d.measure)}${badge}
${wrap(d.badge_caption)}

[${d.reports_link.label.replace('{reports_word}', stats.reports_published_word.value)}](${reports}) · [${host}](${d.site_link})

${createRequire(import.meta.url)('./reader-pages.js').pages().map(p => '['+p.label+']('+ORIGIN+p.href+')').join(' · ')}

${view}`;
}

function main() {
  const check = process.argv.includes('--check');
  const file = path.join(DEFAULT_ROOT, 'README.md');
  const readme = fs.readFileSync(file, 'utf8');
  const at = readme.indexOf(ANCHOR);
  const out = withPaper(DEFAULT_ROOT, composeOpening({ root: DEFAULT_ROOT }) + readme.slice(at));
  if (out === readme) { console.log('README opening current'); return; }
  if (check) { console.error('STALE: README.md\'s opening or paper line is not what docs/data/readme-opening.json and docs/data/paper.json compose - run: node scripts/build-readme-opening.mjs'); process.exit(1); }
  fs.writeFileSync(file, out);
  console.log('README opening written');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
