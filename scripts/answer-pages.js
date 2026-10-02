#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/answer-pages.js - the answer pages (spec 135): /what-is-driftproof/,
// /agent-skill-evaluation/, /agent-skill-regression-testing/ and /compare/, and the
// question that leads the paper page.
//
// NOTHING ON THESE PAGES IS TYPED HERE BUT A HEADING OR A LABEL. The words come from
// three places, each read at build:
//   docs/data/answers.json   every paragraph, with its sources. A source is a public file
//                            and a quote found verbatim in that file's visible text; the
//                            build throws when a quote is not there. A paragraph in the
//                            "quotes" form is its quotes and nothing else, so a question
//                            page is built only from existing report, methodology and
//                            paper text (spec 135 AC-4).
//   docs/data/research.json  lane 59's confirmed research, written by
//                            specs/135-seo-answer-pages/probes/record.mjs page-data: the
//                            compare table, the upstream fixes and the coverage, each item
//                            with its URL, the day read and a quote. What UNCONFIRMED.md
//                            names is not in it.
//   docs/data/*.json         the reports, the stats and the paper, as every other page
//                            reads them.
//
// EVERY NUMERAL IS A LINK (spec 135 AC-6). A numeral in a quote links to the section the
// quote came from; a numeral in a research item links to that item's own source.
//
// Called by scripts/build-site-pages.js, which owns the shell, the chrome and the write.
const fs = require('fs');
const path = require('path');
const { humanModelName } = require('./model-names.js');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const ORIGIN = 'https://driftproofhq.com';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// ── visible text, the one normalisation every quote is read through ─────────────────────
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', times: '×', plusmn: '±', middot: '·',
  hellip: '…', ndash: '–', mdash: '—', minus: '−',
};
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 16)))
    .replace(/&([a-z]+);/g, (m, n) => (NAMED[n] === undefined ? m : NAMED[n]));
}
// The text a reader gets from a page's <main>: scripts, styles and drawings removed,
// tags removed, references decoded, runs of white space read as one space. A file that
// is not HTML is read as its raw text, white space collapsed. The paper's question section
// is this builder's own output, so it is never a source: a quote from the paper page is
// found in the page without it.
function visibleText(src, file) {
  let s = String(src);
  if (/\.html?$/.test(file)) {
    const at = s.indexOf('<main');
    if (at > -1) s = s.slice(at, s.indexOf('</main>', at) > -1 ? s.indexOf('</main>', at) : undefined);
    s = s.replace(/<section class="paper-question"[\s\S]*?<\/section>/g, ' ')
      .replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<style\b[\s\S]*?<\/style>/g, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/g, ' ').replace(/<!--[\s\S]*?-->/g, '')
      // A block boundary is a space; an inline tag (a link, a figure's <data>, <code>) is not,
      // so "0.05</data>." reads "0.05." as a reader sees it.
      .replace(/<\/?(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|tr|td|th|table|thead|tbody|br|section|article|figure|figcaption|details|summary|pre|blockquote|header|footer|nav|main|hr)\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '');
    s = decode(s);
  }
  return s.replace(/\s+/g, ' ').trim();
}
const norm = (q) => String(q).replace(/\s+/g, ' ').trim();

// A source's file, read once per build.
const cache = new Map();
function textOf(file) {
  if (!cache.has(file)) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) throw new Error(`a source names ${file}, which is not in the tree`);
    cache.set(file, visibleText(fs.readFileSync(abs, 'utf8'), file));
  }
  return cache.get(file);
}
// The page URL a docs/ file is served at, so a source's link can be checked against it.
function urlPathOf(file) {
  const m = /^docs\/(.*)$/.exec(file);
  if (!m) return null;
  return `/${m[1].replace(/(^|\/)index\.html$/, '$1')}`;
}
function checkSource(s, where) {
  if (!s || typeof s.file !== 'string' || typeof s.quote !== 'string' || typeof s.href !== 'string') {
    throw new Error(`${where}: a source needs a file, a quote and an href`);
  }
  if (!textOf(s.file).includes(norm(s.quote))) {
    throw new Error(`${where}: the quote is not in ${s.file}: ${JSON.stringify(s.quote.slice(0, 90))}`);
  }
  const [p, frag] = s.href.split('#');
  if (p !== urlPathOf(s.file)) throw new Error(`${where}: the link ${s.href} is not the page of ${s.file}`);
  if (frag && !new RegExp(`\\bid="${frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(fs.readFileSync(path.join(ROOT, s.file), 'utf8'))) {
    throw new Error(`${where}: ${s.file} carries no id="${frag}"`);
  }
  return s;
}

// ── numerals ───────────────────────────────────────────────────────────────────────────
// A model's human name is a name, not a figure: "Claude Opus 5.5" is not linked. The names are
// derived from the model ids in config/models.json and docs/data/reports.json by the one rule
// seo-common states, in its one module, scripts/model-names.js (claude-sonnet-5-5 is Claude
// Sonnet 5.5; claude-opus-5 is Claude Opus 5; a date suffix is not part of the name). A report's
// name, "Report 011", links that report.
let NAMES = null;
function modelNames() {
  if (NAMES) return NAMES;
  // Every id the registry names anywhere (a model, an alias, a pinned snapshot), and every id
  // a published report names. The registry scan also meets strings that are not model ids
  // ("claude-cli"); the module names none of them, so they are left out here.
  const ids = new Set([...JSON.stringify(readJson('config/models.json')).matchAll(/"(claude-[a-z0-9-]+)"/g)].map((m) => m[1]));
  for (const r of readJson('docs/data/reports.json').reports) for (const m of r.model_ids) ids.add(m.value);
  const named = (id) => { try { return humanModelName(id); } catch { return null; } };
  NAMES = [...new Set([...ids].map(named).filter(Boolean))].sort((a, b) => b.length - a.length);
  return NAMES;
}
let REPORTS = null;
const reportNumbers = () => (REPORTS = REPORTS || new Set(readJson('docs/data/reports.json').reports.map((r) => String(r.number.value))));

// Every run of digits, with its decimal or thousands separators, a sign directly before it
// when the sign opens a word, and a times sign directly after it. The text is escaped
// first; the link is added around the escaped numeral.
// An identifier is not a figure: a word that opens with a letter and carries a digit joined
// to it ("Apache-2.0", "v0.5", "claude-opus-5") is left whole and unlinked, as a model's name is.
const MONTH_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const IDENT_RE = '[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*';
// href is a URL, or a function from the figure (without its sign or times sign) to its URL.
function linkBare(text, href) {
  const e = esc(text);
  const to = (num) => esc(typeof href === 'function' ? href(num.replace(/\u00d7$/, '')) : href);
  // A date, "17 September 2026", is one figure and one link.
  const re = new RegExp(`(${IDENT_RE})|(^|[\\s(])([+\\-\\u2212]?)(\\d{1,2} ${MONTH_RE} \\d{4}|\\d+(?:[.,]\\d+)*(?:\\u00d7)?)|(\\d+(?:[.,]\\d+)*(?:\\u00d7)?)`, 'g');
  return e.replace(re, (m, ident, pre, sign, num, bare) => {
    if (ident !== undefined) return ident;
    if (bare !== undefined) return `<a href="${to(bare)}">${bare}</a>`;
    return `${pre}<a href="${to(num)}">${sign}${num}</a>`;
  });
}
function linkNumerals(text, href) {
  const names = modelNames().map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${names.length ? `(?:${names.join('|')})(?![\\d.])|` : ''}Report (\\d{3})\\b)`, 'g');
  let out = '';
  let at = 0;
  for (const m of String(text).matchAll(re)) {
    out += linkBare(text.slice(at, m.index), href);
    if (m[2] !== undefined && reportNumbers().has(m[2])) out += `<a href="/reports/${m[2]}/">${esc(m[0])}</a>`;
    else if (m[2] !== undefined) out += linkBare(m[0], href);
    else out += esc(m[0]);
    at = m.index + m[0].length;
  }
  return out + linkBare(text.slice(at), href);
}
// Numerals inside a string that already carries markup: only the text between tags.
function linkNumeralsHtml(html, href) {
  return html.split(/(<[^>]+>)/).map((part, i) => (i % 2 ? part : linkNumerals(decode(part), href))).join('');
}

// A quote from a report is followed by whose words they are: the report, linked, and the models
// it ran, by their human names, so a sentence such as "between the two models" is never read as
// another report's. Derived from the quote's file and docs/data/reports.json, never typed per page.
function attribution(file) {
  const m = /^docs\/reports\/(\d{3})\/index\.html$/.exec(file);
  if (!m) return null;
  const r = readJson('docs/data/reports.json').reports.find((x) => String(x.number.value) === m[1]);
  if (!r) throw new Error(`a quote names ${file}, which docs/data/reports.json does not list`);
  const names = r.model_ids.map((x) => humanModelName(x.value));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
  return `(Report ${m[1]}: ${list})`;
}

// ── a paragraph from answers.json ──────────────────────────────────────────────────────
// Two forms. {quotes: [source...]} renders the quotes, in order, each with its numerals
// linked to its own source: the paragraph is existing text and nothing else but, after each
// run of quotes from one report, that report's attribution.
// {text, href, sources: [source...]} is a sentence of this page's own, supported by its
// sources; its numerals link to href, which must be one of its sources' links.
// `self` is the file of the page being rendered: a quote from that page links its section as an
// in-page anchor, as spec 127 AC-7 asks of every link in the paper page's <main>.
function paragraph(p, where, cls = '', self = null) {
  const open = `<p${cls ? ` class="${cls}"` : ''}>`;
  const target = (s) => (s.file === self && s.href.includes('#') ? `#${s.href.split('#')[1]}` : s.href);
  if (Array.isArray(p.quotes)) {
    if (!p.quotes.length) throw new Error(`${where}: a quotes paragraph with no quote`);
    const parts = [];
    p.quotes.forEach((s, i) => {
      checkSource(s, `${where} quote ${i + 1}`);
      parts.push(linkNumerals(norm(s.quote), target(s)));
      const next = p.quotes[i + 1];
      const tag = attribution(s.file);
      if (tag && !(next && next.file === s.file)) parts.push(linkNumerals(tag, s.href.split('#')[0]));
    });
    return `${open}${parts.join(' ')}</p>`;
  }
  if (typeof p.text !== 'string' || !Array.isArray(p.sources) || !p.sources.length) throw new Error(`${where}: a paragraph needs quotes, or a text with its sources`);
  p.sources.forEach((s, i) => checkSource(s, `${where} source ${i + 1}`));
  if (/\d/.test(p.text) && !p.sources.some((s) => s.href === p.href)) throw new Error(`${where}: a numeral needs an href that is one of the paragraph's sources`);
  return `${open}${/\d/.test(p.text) ? linkNumerals(p.text, p.href) : esc(p.text)}</p>`;
}

function answers() { return readJson('docs/data/answers.json'); }
function research() { return readJson('docs/data/research.json'); }

// A question section: the heading, the direct answer first, then the rest.
function qaSection(q, where) {
  if (!q.id || !q.question || !Array.isArray(q.answer) || !q.answer.length) throw new Error(`${where}: a question needs an id, the question and an answer`);
  return `<section class="qa" id="${esc(q.id)}">
<h2>${esc(q.question)}</h2>
${q.answer.map((p, i) => paragraph(p, `${where} paragraph ${i + 1}`, i === 0 ? 'answer' : '')).join('\n')}
</section>`;
}

function questionPage(key) {
  const A = answers().pages[key];
  if (!A) throw new Error(`docs/data/answers.json has no page "${key}"`);
  const main = `<main class="prose answers">
<h1>${esc(A.h1)}</h1>
${A.intro ? `${paragraph(A.intro, `${key} intro`, 'lede')}\n` : ''}${A.questions.map((q) => qaSection(q, `${key} ${q.id}`)).join('\n\n')}
${relatedLinks(key)}
</main>`;
  return { title: A.title, main };
}

// The other answer pages, linked at the foot of each, so every one is two clicks from any.
const PAGES = [
  ['what-is-driftproof', '/what-is-driftproof/'],
  ['agent-skill-evaluation', '/agent-skill-evaluation/'],
  ['agent-skill-regression-testing', '/agent-skill-regression-testing/'],
  ['compare', '/compare/'],
];
function linkLabel(key) {
  const A = answers();
  const label = (A.links || {})[key];
  if (!label) throw new Error(`docs/data/answers.json carries no link label for "${key}"`);
  return label;
}
function relatedLinks(self) {
  return `<h2 id="more">More answers</h2>
<ul class="related">
${PAGES.filter(([k]) => k !== self).map(([k, href]) => `<li><a href="${href}">${esc(linkLabel(k))}</a></li>`).join('\n')}
<li><a href="/paper/">${esc(linkLabel('paper'))}</a></li>
</ul>`;
}

// A confirmed compare cell: its value, each figure linking the first of the cell's evidence whose
// quote carries it (research.json's figures, written by spec 135's record.mjs) or else the cell's
// lead evidence; then one dated link to each of its evidence URLs, in the research's order.
function researchCell(c, label) {
  const lead = c.evidence[0].url;
  const href = (num) => (c.figures && c.figures[num] !== undefined ? c.evidence[c.figures[num]].url : lead);
  const seen = new Set();
  const sources = c.evidence.filter((e) => !seen.has(e.url) && seen.add(e.url))
    .map((e) => `<a href="${esc(e.url)}">${esc(label)} ${esc(e.read)}</a>`);
  return `${linkNumerals(c.value, href)} (${sources.join('; ')})`;
}

// ── /what-is-driftproof/ ───────────────────────────────────────────────────────────────
function whatIsPage() {
  const all = answers();
  const A = all.pages['what-is-driftproof'];
  const K = all.pages.compare.labels.keys;
  const R = research();
  const reports = readJson('docs/data/reports.json').reports;
  const paper = readJson('docs/data/paper.json');
  if (!A.intro.text.startsWith(all.descriptor)) throw new Error('the first paragraph of /what-is-driftproof/ does not open with the descriptor');
  const sec = (id, h, body) => `<section id="${id}">\n<h2>${esc(h)}</h2>\n${body}\n</section>`;
  const paras = (list, where) => list.map((p, i) => paragraph(p, `${where} ${i + 1}`)).join('\n');
  const bare = (url) => esc(url.replace(/^https:\/\//, ''));

  // What each other tool measures and whether it runs a with and without comparison, from
  // the confirmed compare cells only; a cell the research left out is not described.
  const others = R.compare.tools.filter((t) => t.name !== 'Driftproof');
  const shown = (t, k) => t.cells.find((c) => c.key === k && c.shown);
  const toolLines = others.map((t) => {
    const parts = ['measures', 'with_without_skill'].map((k) => shown(t, k)).filter(Boolean)
      .map((c) => `${esc(K[c.key])}: ${researchCell(c, all.pages.compare.labels.source)}`);
    return `<li><strong>${esc(t.name)}</strong>. ${parts.join('. ')}.</li>`;
  }).join('\n');

  const reportLines = reports.map((r) => `<li><a href="/reports/${esc(r.number.value)}/">Report ${esc(r.number.value)}</a>: ${linkNumerals(r.what_moved.value, `/reports/${r.number.value}/`)}</li>`).join('\n');
  const fixLines = R.upstream.map((u) => `<li>${u.threads.map((t) => `<a href="${esc(t.url)}">${linkNumerals(t.label, t.url).replace(/<a href="[^"]*">([^<]*)<\/a>/g, '$1')}</a>`).join(' and ')}. ${u.what ? `${linkNumerals(u.what, u.what_source.url)} ` : ''}${linkNumerals(u.happened, u.threads[u.threads.length - 1].url)}</li>`).join('\n');
  const coverageLines = R.coverage.map((c) => `<li><a href="${esc(c.url)}">${linkNumerals(c.where, c.url).replace(/<a href="[^"]*">([^<]*)<\/a>/g, '$1')}</a>. ${linkNumerals(c.happened, c.url)}</li>`).join('\n');

  const main = `<main class="prose answers">
<h1>${esc(A.h1)}</h1>
${paragraph(A.intro, 'what-is intro', 'lede')}
${sec('what-it-measures', A.headings.measures, paras(A.measures, 'what-is measures'))}
${sec('what-it-does-not', A.headings.not, paras(A.not, 'what-is not'))}
${sec('how-it-differs', A.headings.differs, `${paras(A.differs, 'what-is differs')}
<p>${esc(A.labels.others)} <a href="/compare/">${esc(linkLabel('compare'))}</a>.</p>
<ul>
${toolLines}
</ul>`)}
${sec('published-evidence', A.headings.evidence, `<p>${esc(A.labels.evidence)}</p>
<ul>
${reportLines}
</ul>`)}
${sec('the-paper', A.headings.paper, `<p><a href="/paper/">${esc(paper.title)}</a>. ${esc(paper.preprint_line)}. DOI <a href="${esc(paper.doi_url)}">${esc(paper.doi)}</a>.</p>`)}
${sec('the-software', A.headings.software, `<ul>
<li><a href="${esc(R.profiles.repository)}">${bare(R.profiles.repository)}</a></li>
<li><a href="${esc(R.profiles.npm)}">${bare(R.profiles.npm)}</a></li>
</ul>`)}
${sec('upstream-and-coverage', A.headings.upstream, `<p>${esc(A.labels.upstream)}</p>
<ul>
${fixLines}
</ul>
<p>${esc(A.labels.coverage)}</p>
<ul>
${coverageLines}
</ul>`)}
${sec('the-name', A.headings.name, `<p>${esc(A.labels.name)}</p>`)}
${relatedLinks('what-is-driftproof')}
</main>`;
  return { title: A.title, main };
}

// ── /compare/ ──────────────────────────────────────────────────────────────────────────
// One table, what each tool measures, each cell dated to the day that tool's own docs were
// read. No ranking: the tools and the aspects stand in the research's order and nothing is
// sorted by a value. A cell the research did not confirm reads the not-shown label and
// nothing of its value.
function comparePage() {
  const A = answers().pages.compare;
  const R = research();
  const C = R.compare;
  const head = `<tr><th scope="col">${esc(A.labels.aspect)}</th>${C.tools.map((t) => `<th scope="col"><a href="${esc(t.home)}">${esc(t.name)}</a></th>`).join('')}</tr>`;
  const rows = C.keys.map((k) => {
    if (!A.labels.keys[k]) throw new Error(`docs/data/answers.json has no label for the aspect "${k}"`);
    return `<tr><th scope="row">${esc(A.labels.keys[k])}</th>${C.tools.map((t) => {
      const c = t.cells.find((x) => x.key === k);
      if (!c || !c.shown) return `<td class="not-shown">${esc(A.labels.not_shown)}</td>`;
      return `<td>${researchCell(c, A.labels.source)}</td>`;
    }).join('')}</tr>`;
  }).join('\n');
  const main = `<main class="prose answers">
<h1>${esc(A.h1)}</h1>
<p class="lede">${esc(A.intro)}</p>
<table class="compare">
<thead>
${head}
</thead>
<tbody>
${rows}
</tbody>
</table>
<p class="muted">${esc(A.labels.not_shown_note)}</p>
${relatedLinks('compare')}
</main>`;
  return { title: A.title, main };
}

// ── the question that leads the paper page ─────────────────────────────────────────────
// Its answer is sentences of the abstract, each found in docs/paper/index.html.
function paperQuestion() {
  const q = answers().pages.paper;
  return `<section class="paper-question" id="${esc(q.id)}">
<h2>${esc(q.question)}</h2>
${q.answer.map((p, i) => paragraph(p, `paper question ${i + 1}`, i === 0 ? 'answer' : '', 'docs/paper/index.html')).join('\n')}
</section>`;
}

// ── the links the homepage and the reports index carry ────────────────────────────────
function answerList() {
  return `<ul class="related">
${PAGES.map(([k, href]) => `<li><a href="${href}">${esc(linkLabel(k))}</a></li>`).join('\n')}
</ul>`;
}
function answerLinks(heading = answers().home_heading) {
  return `<h2>${esc(heading)}</h2>
${answerList()}`;
}
// The reports index is on the wide track, so the list stands beside its heading, as the page's
// Writing section does: a short link alone in the row would leave most of it empty (spec 125 AC-11).
function answerSplit(heading = answers().home_heading) {
  return `<div class="split">
<div><h2>${esc(heading)}</h2></div>
${answerList()}
</div>`;
}

module.exports = { whatIsPage, questionPage, comparePage, paperQuestion, answerLinks, answerSplit };
