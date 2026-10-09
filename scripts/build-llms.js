#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/build-llms.js - docs/llms.txt and docs/llms-full.txt (spec 135), both derived.
//
// llms.txt KEEPS ITS OPENING AND ITS STRUCTURE. The title, the blockquote and the paragraph under
// it, and the three sections, are the ones scripts/build-sitemap.js has always written. What
// changes: each report line says, after its link, one plain sentence of what the report found,
// the first sentence of the report's "What we found." point in docs/data/report-summaries.json
// (spec 125's summaries, which spec 134 rewrites; this file reads whatever they say and writes
// none of it), then "Models:" and the report's models as the Base's line ended, by their human
// names from scripts/model-names.js, never a registry id (the operator's ruling of 1 Oct 2026);
// and the answer pages and the paper are listed first under "Method and definitions".
//
// llms-full.txt is the same opening, then the Markdown copy of each answer page, the paper and the
// methodology, whole, as scripts/build-markdown.js writes them, then each report's line from
// llms.txt, with the link to that report's own copy where build-markdown.js writes one (Reports
// 009 to 013; the operator ruled no copies for 001 to 008). A report's body is a dated record,
// frozen with the words it was published in; its copy sits beside it under docs/reports/, where
// spec 031 reads it as a record, and is linked here rather than carried into a live file. No
// report's body is carried. It is only as current as the copies, so run that builder first.
//
// scripts/build-sitemap.js renders llms.txt through renderLlms() here, so the two cannot disagree.
//
//   node scripts/build-llms.js            write both
//   node scripts/build-llms.js --check    fail if either is stale
const fs = require('fs');
const path = require('path');
const { humanModelName } = require('./model-names.js');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const OPENING = `# Driftproof

> A public instrument and public record measuring whether agent skills still
> deliver their claimed lift as models, providers and releases move underneath
> them. Every published number carries a dated, hash-verified receipt.

Driftproof runs a skill's own eval suite twice, with the skill and without it,
scores each answer several times so every result is a range rather than one
fragile number, and claims a verdict only when the two ranges do not overlap and
the move clears the effect floor. When it cannot stand behind a number it
publishes a refusal instead of a guess.
`;

// The first sentence of a text: up to the first full stop, question or exclamation mark that
// ends a word (a decimal point does not).
function firstSentence(text) {
  const m = /^[\s\S]*?[.?!](?=\s|$)/.exec(String(text).trim());
  if (!m) throw new Error(`no sentence in ${JSON.stringify(String(text).slice(0, 80))}`);
  return m[0].replace(/\s+/g, ' ');
}
const FOUND = 'What we found.';
function finding(summaries, number) {
  const s = summaries.reports[number];
  if (!s) throw new Error(`docs/data/report-summaries.json has no summary for Report ${number}`);
  const p = s.points.find((x) => x.lead === FOUND);
  if (!p) throw new Error(`Report ${number}'s summary has no "${FOUND}" point; the llms line reads it`);
  return firstSentence(p.text);
}

function answerLines(root) {
  const A = readJson(root, 'docs/data/answers.json');
  const P = A.pages;
  const paper = readJson(root, 'docs/data/paper.json');
  const q = (k) => P[k].questions.map((x) => x.question).join(' ');
  return [
    `- [${A.links['what-is-driftproof']}](${ORIGIN}/what-is-driftproof/): ${A.descriptor}.`,
    `- [${A.links['agent-skill-evaluation']}](${ORIGIN}/agent-skill-evaluation/): ${q('agent-skill-evaluation')}`,
    `- [${A.links['agent-skill-regression-testing']}](${ORIGIN}/agent-skill-regression-testing/): ${q('agent-skill-regression-testing')}`,
    `- [${A.links.compare}](${ORIGIN}/compare/): ${firstSentence(P.compare.intro)}`,
    `- [${A.links.paper}](${ORIGIN}/paper/): ${paper.title}. ${paper.version_line}. ${paper.preprint_line}.`,
    `- [${A.links['benchmark-gap']}](${ORIGIN}/benchmark-gap/): type two benchmark scores and the question count, and see whether the gap clears the benchmark's own sampling noise.`,
    ...phraseLines(),
  ];
}

// ONE LINE PER PHRASE A PAGE OWNS, then the maintainer and the upstream fixes (spec 169, issue 60).
// The link text is the phrase the page's title leads with.
function phraseLines() {
  return [
    `- [Skill evaluation across model releases](${ORIGIN}/agent-skill-regression-testing/): whether an agent skill still helps after the model under it changes, answered from the published reports.`,
    `- [Evaluation receipts](${ORIGIN}/r/): every published receipt, dated and hash-verified, listed by the report it belongs to.`,
    `- [LLM eval measurement defects](${ORIGIN}/paper/): the paper on measurement defects in LLM and agent evaluation tools, with its data and its citation.`,
    `- [Maintainer](${ORIGIN}/maintainer/): who maintains Driftproof: Maverick (mavericksea-ai on GitHub), who also writes its reports and the paper.`,
    `- [Fixes merged into other evaluation tools](${ORIGIN}/what-is-driftproof/#fixes-merged-upstream): the fixes the maintainer contributed upstream, each credited in its project's own release notes.`,
    // Spec 171, issue 51: Maverick's piece, which the gap calculator links as its Piece.
    `- [AI benchmark gaps vs sampling noise](${ORIGIN}/leaderboard-noise/): a piece by Maverick that checks the gaps quoted in frontier launch posts and on public leaderboards against each benchmark's own sampling noise, with its code and data linked.`,
  ];
}

function reportLines(root) {
  const rows = readJson(root, 'docs/data/reports.json').reports;
  const summaries = readJson(root, 'docs/data/report-summaries.json');
  return rows.map((r) => ({ number: r.number.value, line: `- [Report ${r.number.value}: ${r.what_moved.value}](${ORIGIN}/reports/${r.number.value}/): ${finding(summaries, r.number.value)} Models: ${r.model_ids.map((m) => humanModelName(m.value)).join(', ')}.` }));
}

// How many kinds of report the site lists, said as /report-types/ says it: the distinct report types
// in docs/data/reports.json, by the same functions scripts/build-site-pages.js renders that page
// with, never a number typed here (spec 142 AC-5). Required when it is read, not at load: that
// file loads the answer pages, which read this one's neighbours.
function reportKinds(root) {
  const { reportTypes, word } = require('./build-site-pages.js');
  return word(reportTypes(readJson(root, 'docs/data/reports.json').reports).length);
}

function renderLlms(root = ROOT) {
  return `${OPENING}
## Reports

${reportLines(root).map((r) => r.line).join('\n')}

## Method and definitions

${answerLines(root).join('\n')}
- [Methodology](${ORIGIN}/methodology/): how a run is scored, what a band is, and what the effect floor does.
- [Neutrality](${ORIGIN}/neutrality/): what Driftproof will not claim, and the limitations it discloses.
- [Glossary](${ORIGIN}/glossary/): drift report, receipt, band, effect floor, substrate, surface, refusal, cell, arm, and the verification lattice.
- [Report types](${ORIGIN}/report-types/): the ${reportKinds(root)} kinds of report and what moves underneath the skill in each.
- [Receipt specification](https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md): the receipt format, its schema versions, and the UNVERIFIED / DECLARED / TESTED / FORMAL levels.

## Optional

- [Interop](${ORIGIN}/interop/): importing results from other tools as DECLARED, and exporting a summary.
- [Authoring](${ORIGIN}/authoring/): writing a skill and an eval suite worth measuring.
- [Judge policy](${ORIGIN}/judge-policy/): which model judges, and why it is held fixed.
- [Findings](${ORIGIN}/findings/): what three external audits of 0.10.0 and 0.10.1 found, what is fixed, and what is still open.
- [Atom feed](${ORIGIN}/feed.xml)
`;
}

// The copies llms-full.txt carries whole, in order: the answer pages, the paper, the methodology.
function fullOrder() {
  const md = require('./build-markdown.js');
  return md.PAGES.map((p) => md.mdOf(`${p}/index.html`)).sort((a, b) => ORDER.indexOf(a.split('/')[0]) - ORDER.indexOf(b.split('/')[0]));
}
const ORDER = ['what-is-driftproof', 'agent-skill-evaluation', 'agent-skill-regression-testing', 'compare', 'paper', 'methodology'];
function renderLlmsFull(root = ROOT) {
  const parts = fullOrder().map((rel) => {
    const f = path.join(root, 'docs', rel);
    if (!fs.existsSync(f)) throw new Error(`docs/${rel} is missing - run: node scripts/build-markdown.js`);
    return fs.readFileSync(f, 'utf8').replace(/\s+$/, '');
  });
  // Only the reports build-markdown.js copies have a copy to link; a report outside its set (the
  // operator's ruling: no copies for 001 to 008) is its llms.txt line alone.
  const copied = new Set(require('./build-markdown.js').pageSet(root));
  const reports = reportLines(root).map((r) => {
    if (!copied.has(`reports/${r.number}/index.html`)) return r.line;
    const rel = `reports/${r.number}/index.md`;
    if (!fs.existsSync(path.join(root, 'docs', rel))) throw new Error(`docs/${rel} is missing - run: node scripts/build-markdown.js`);
    return `${r.line} Its full text: <${ORIGIN}/${rel}>`;
  });
  return `${OPENING}\n${parts.map((p) => `---\n\n${p}\n`).join('\n')}\n---\n\n# Reports\n\n${reports.join('\n')}\n`;
}

if (require.main === module) {
  const want = { 'llms.txt': renderLlms(), 'llms-full.txt': renderLlmsFull() };
  const check = process.argv.includes('--check');
  const stale = Object.entries(want).filter(([n, body]) => {
    const f = path.join(ROOT, 'docs', n);
    return !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== body;
  }).map(([n]) => n);
  if (check) {
    if (stale.length) { console.error(`stale - run: node scripts/build-llms.js\n  ${stale.join('\n  ')}`); process.exit(1); }
    console.log('llms.txt and llms-full.txt are current');
  } else {
    for (const [n, body] of Object.entries(want)) fs.writeFileSync(path.join(ROOT, 'docs', n), body);
    console.log(`llms.txt and llms-full.txt written (${fullOrder().length} copies and ${reportLines(ROOT).length} report lines in llms-full.txt)`);
  }
}

module.exports = { renderLlms, renderLlmsFull, fullOrder, OPENING };
