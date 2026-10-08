#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/answer-pages.js - the answer pages (spec 135): /what-is-driftproof/,
// /agent-skill-evaluation/, /agent-skill-regression-testing/ and /compare/, and the
// question that leads the paper page.
//
// NOTHING ON THESE PAGES IS TYPED HERE BUT A HEADING OR A LABEL, with one exception: the fixes
// merged into other evaluation tools (spec 169), whose words are issue 60's as the operator approved
// them. The words come from three places, each read at build:
//   docs/data/answers.json   every paragraph, with its sources. A source is a public file
//                            and a quote found verbatim in that file's visible text; the
//                            build throws when a quote is not there. A paragraph in the
//                            "quotes" form is its quotes and nothing else, so a question
//                            page is built only from existing report, methodology and
//                            paper text (spec 135 AC-4).
//   docs/data/research.json  the confirmed research, written by
//                            specs/135-seo-answer-pages/probes/record.mjs page-data: the
//                            compare table, the upstream fixes and the coverage, each item
//                            with its URL, the day read and the lines that carry its figures.
//                            What UNCONFIRMED.md names is not in it.
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
const { tokenize, htmlToText, attrOf, escapeRegExp } = require('./html-text.js');

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
const BLOCK_TAGS = ['p', 'div', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'th', 'table', 'thead', 'tbody', 'br', 'section', 'article', 'figure', 'figcaption', 'details', 'summary', 'pre', 'blockquote', 'header', 'footer', 'nav', 'main', 'hr'];
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 16)))
    .replace(/&([a-z]+);/g, (m, n) => (NAMED[n] === undefined ? m : NAMED[n]));
}
// The text a reader gets from a page's <main>: scripts, styles and drawings removed,
// tags removed (scripts/html-text.js reads them as tags, never as a pattern), references decoded,
// runs of white space read as one space. A file that is not HTML is read as its raw text, white
// space collapsed. The paper's question section
// is this builder's own output, so it is never a source: a quote from the paper page is
// found in the page without it.
function visibleText(src, file) {
  let s = String(src);
  if (/\.html?$/.test(file)) {
    const at = s.indexOf('<main');
    if (at > -1) s = s.slice(at, s.indexOf('</main>', at) > -1 ? s.indexOf('</main>', at) : undefined);
    // A block boundary is a space; an inline tag (a link, a figure's <data>, <code>) is not,
    // so "0.05</data>." reads "0.05." as a reader sees it.
    s = htmlToText(s, {
      skip: ['script', 'style', 'svg'],
      skipIf: (t) => t.name === 'section' && attrOf(t, 'class') === 'paper-question',
      skipText: ' ',
      blockTags: BLOCK_TAGS,
      decode,
    });
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
  if (frag && !new RegExp(`\\bid="${escapeRegExp(frag)}"`).test(fs.readFileSync(path.join(ROOT, s.file), 'utf8'))) {
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
  const names = modelNames().map(escapeRegExp);
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
  return tokenize(html).map((t) => (t.type === 'text' ? linkNumerals(decode(t.text), href) : t.raw)).join('');
}
// The same escaped text with the links taken back out, for a label that sits inside a link already.
function plainNumerals(text, href) {
  return htmlToText(linkNumerals(text, href));
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
  ['benchmark-gap', '/benchmark-gap/'],
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
  const url = (e) => sourceUrl(e, `compare cell ${c.key}`);
  const lead = url(c.evidence[0]);
  const href = (num) => (c.figures && c.figures[num] !== undefined ? url(c.evidence[c.figures[num]]) : lead);
  const seen = new Set();
  const sources = c.evidence.map((e) => [url(e), e]).filter(([u]) => !seen.has(u) && seen.add(u))
    .map(([u, e]) => `<a href="${esc(u)}">${esc(label)} ${esc(e.read)}</a>`);
  return `${linkNumerals(c.value, href)} (${sources.join('; ')})`;
}

// The lines of this repository's own files, at the tag the research links, are found again at every
// build from the text they were recorded by (an evidence entry's line_text: the whole quote, its line
// breaks read as spaces), in the copy of the file as it was at that tag (the committed copy under
// REF_COPIES, a published path), never in the tree, which moves on after the tag, and never from a
// number kept in the data. The citation is the first and last line the text covers. A copy that is
// missing, and a text that is in no place of it or in two, stop the build (spec 142 AC-2). An entry
// with no line_text is a link as it stands.
const REF_COPIES = 'scripts/ref-copies';
function textRanges(text, needle) {
  const want = String(needle).replace(/\s+/g, ' ').trim();
  let flat = '';
  const lineAt = [];
  text.split('\n').forEach((l, i) => {
    const t = l.replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (flat) { flat += ' '; lineAt.push(i + 1); }
    flat += t;
    for (let k = 0; k < t.length; k += 1) lineAt.push(i + 1);
  });
  const out = [];
  for (let i = want ? flat.indexOf(want) : -1; i > -1; i = flat.indexOf(want, i + 1)) out.push({ from: lineAt[i], to: lineAt[i + want.length - 1] });
  return out;
}
function sourceUrl(e, where) {
  if (e.line_text === undefined) return e.url;
  const own = `${research().profiles.repository}/blob/`;
  if (!e.url.startsWith(own)) throw new Error(`${where}: ${e.url} carries a line text but is not a file of this repository`);
  const [, tag, rel] = /^([^/]+)\/([^#]+)/.exec(e.url.slice(own.length).replace(/#.*$/, '')) || [];
  const abs = path.join(ROOT, REF_COPIES, tag || '', rel || '');
  if (!rel || !fs.existsSync(abs)) throw new Error(`${where}: no copy of ${rel} at ${tag} under ${REF_COPIES}; read the pages' data again (record.mjs page-data) to keep one`);
  const at = textRanges(fs.readFileSync(abs, 'utf8'), e.line_text);
  if (at.length !== 1) throw new Error(`${where}: ${JSON.stringify(e.line_text.slice(0, 80))} is in ${at.length} place(s) of ${rel} at ${tag}, not one; read the pages' data again (record.mjs page-data) to record a text that is`);
  const { from, to } = at[0];
  return `${e.url.replace(/#.*$/, '')}#L${from}${to > from ? `-L${to}` : ''}`;
}

// ── the fixes merged into other evaluation tools (spec 169, issue 60) ──────────────────
// The one place the site types prose of its own about upstream work. The words are issue 60's, approved
// by the operator on 8 Oct 2026, who checked each merge and release note live that day; spec 169 §
// The credits lists the URLs, and its gate reads the section against them. Each credit is the
// maintainer's contribution, never a Driftproof run. /what-is-driftproof/ renders the section and
// /maintainer/ the table, both from this list, so the two cannot name different releases.
const MAINTAINER_PROFILE = 'https://github.com/mavericksea-ai';
const UPSTREAM_CREDITS = [
  { project: 'MLflow', release: '3.17.0', release_url: 'https://github.com/mlflow/mlflow/releases/tag/v3.17.0', repo: 'mlflow/mlflow', pulls: [26252], linked: true },
  { project: 'NVIDIA SkillEvaluator', release: 'v0.4.0', release_url: 'https://github.com/NVIDIA/SkillEvaluator/releases/tag/v0.4.0', repo: 'NVIDIA/SkillEvaluator', pulls: [154], linked: true },
  { project: 'Agent Skills', release: '0.6.10 to 0.6.12', release_url: 'https://github.com/addyosmani/agent-skills/releases', repo: 'addyosmani/agent-skills', pulls: [576, 578, 587, 598, 600, 614, 615], linked: false },
];
const pullUrl = (repo, n) => `https://github.com/${repo}/pull/${n}`;
const pullLink = (repo, n) => `<a href="${esc(pullUrl(repo, n))}">#${n}</a>`;
// The project label links its release note, which also links every numeral in it (spec 135 AC-6).
const creditLabel = (c) => `<strong><a href="${esc(c.release_url)}">${esc(`${c.project} ${c.release}`)}</a>:</strong>`;
function fixesMergedUpstream() {
  const [mlflow, nvidia, skills] = UPSTREAM_CREDITS;
  const p = (n) => pullLink(skills.repo, n);
  return `<section id="fixes-merged-upstream">
<h3>Fixes merged into other evaluation tools</h3>
<p>Driftproof's maintainer, Maverick (<a href="${MAINTAINER_PROFILE}">mavericksea-ai</a> on GitHub), reads the scoring and gating code of other evaluation tools and sends fixes upstream. Nine are merged, and each project credits them in its own release notes:</p>
<ul>
<li>${creditLabel(mlflow)} relative-change gates now use the baseline's magnitude, so a negative baseline no longer passes a worse model and fails a better one (${pullLink(mlflow.repo, 26252)}).</li>
<li>${creditLabel(nvidia)} a script earns execution credit only with evidence that it was run, not just read or searched (${pullLink(nvidia.repo, 154)}).</li>
<li>${creditLabel(skills)} grader results are bound to the expectations they answer (${p(576)}); stale grading is cleared and each run records its identity (${p(587)}); the ADR eval grades what the skill asks for (${p(598)}); the floor-guard reference catches untracked files, deleted tests and raised limits (${p(600)}, ${p(614)}). Two more fixes there are not about evaluation (${p(578)}, ${p(615)}).</li>
</ul>
<p>Nine more are open, in DeepEval, DSPy, Harbor, LangSmith, lm-evaluation-harness, Anthropic's skills repository and Superpowers. Six of the defects behind them are written up in the <a href="/paper/">paper</a>. More on who maintains Driftproof: <a href="/maintainer/">Maintainer</a>.</p>
</section>`;
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
  const coverageLines = R.coverage.map((c) => `<li><a href="${esc(c.url)}">${plainNumerals(c.where, c.url)}</a>. ${linkNumerals(c.happened, c.url)}</li>`).join('\n');

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
${sec('upstream-and-coverage', A.headings.upstream, `${fixesMergedUpstream()}
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

module.exports = { whatIsPage, questionPage, comparePage, paperQuestion, answerLinks, answerSplit, pageVisibleText: visibleText, UPSTREAM_CREDITS, MAINTAINER_PROFILE, pullUrl };
