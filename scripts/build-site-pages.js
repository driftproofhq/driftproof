#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/build-site-pages.js — the pages that are not reports.
//
// The homepage, /reports/, /glossary/, /report-types/, 404 and the documentation
// pages at their clean paths. Rendered from docs/data/*.json so that NO FIGURE ON
// A NON-REPORT PAGE IS TYPED. The old homepage said "tens of thousands of skills
// are shared publicly", which was true of nothing anybody could check; spec 020
// AC-9 asserts every numeral this file emits outside a code block is the exact
// string a NAMED field of docs/data/stats.json prints, and this is the switch
// that makes that hold. Every rendered figure carries data-stat="<field>": the
// gate reads the attribute, compares the element's own text to that field, and
// then requires NO numeral to be left over anywhere else on the page. Sharing a
// digit with a receipt hash is not provenance.
//
// The chrome (nav, footer, TL;DR cards, table wrappers) comes from
// scripts/site-chrome.js and the head block from scripts/build-head-tags.js, so
// a report page rendered by its own pinned generator and a page rendered here
// carry the same one.
//
//   node scripts/build-site-pages.js            write the pages
//   node scripts/build-site-pages.js --check    fail if any is stale
const fs = require('fs');
const path = require('path');
const chrome = require('./site-chrome.js');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const esc = chrome.esc;

const stats = () => JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'stats.json'), 'utf8'));
const reports = () => JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'reports.json'), 'utf8')).reports;

// Every figure on a non-report page goes through V(). It throws on a key that
// does not exist, so a template that outgrows its data fails at build rather
// than shipping an empty span.
function reader(S) {
  return (key) => {
    if (!S[key] || S[key].value === undefined) throw new Error(`stats.json has no field "${key}"`);
    return S[key].value;
  };
}

function shell({ title, description, main, bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="/style.css">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${chrome.NAV}
${main}
${chrome.FOOTER}
</body>
</html>
`;
}

// ── the homepage ────────────────────────────────────────────────────────────
function homepage() {
  const S = stats();
  const V = reader(S);
  const R = reports();
  const latest = R[0];
  const example = JSON.parse(fs.readFileSync(path.join(ROOT,
    'receipts', 'commit-message-conventions-claude-haiku-4-5-20251001-2026-07-27.json'), 'utf8'));
  // Real per-case scores for the playground island. Read from the bundled
  // receipt at build; the island invents nothing and fetches nothing.
  const caseData = JSON.stringify(['baseline', 'with_skill'].map((mode) =>
    example.results.cases.filter((c) => c.mode === mode).map((c) => Number(c.score.toFixed(4)))));

  const panels = [
    ['separated', 'Separated', 'The two ranges do not overlap. Something moved, and it moved by more than the noise.'],
    ['overlapping', 'Overlapping', 'The ranges share space. We say nothing moved beyond the noise, and we say it plainly.'],
    ['refused', 'Refused', 'The run could not stand behind a number, so it reports no result instead of guessing one.'],
  ].map(([k, h, p]) => `<div class="panel">
<img src="/assets/glyph-${k}.svg" alt="Two horizontal ranges, drawn ${k === 'separated' ? 'apart' : k === 'overlapping' ? 'crossing each other' : 'with one greyed and struck through'}." width="128" height="80">
<h3>${h}</h3>
<p>${p}</p>
</div>`).join('\n');

  const statCards = [
    ['reports_published', 'reports published'],
    ['receipts_published', 'receipts published'],
    ['substrates_measured', 'models measured on'],
    ['cases_measured', 'eval cases scored'],
    ['refusals_published', 'refusals published'],
    ['cells_within_noise', 'runs where nothing moved beyond the noise'],
  ].map(([k, label]) => `<div class="stat"><b data-stat="${k}">${esc(V(k))}</b><span>${label}</span></div>`).join('\n');

  const main = `<main>
<section id="hero" class="screen">
<div>
<h1>Your skill passed. On which model? On what date?</h1>
<p class="hero-sub">A SKILL.md teaches an AI coding agent how you like things done. When a new model ships, the same file can stop helping, or start hurting. Driftproof re-runs the skill's tests on the new model and hands you a dated, hash-verified receipt saying whether it still helps.</p>
<div class="cta-row">
<span class="copy-cta"><code>npx driftproof init my-skill</code><button type="button" data-copy="npx driftproof init my-skill">Copy</button></span>
<a class="cta" href="/reports/${esc(V('latest_report_number'))}/">Read the latest report</a>
</div>
</div>
<div class="receipt-card">
<h2>A receipt, in full</h2>
<dl>
<div class="lead field-verdict"><dt>Verdict</dt><dd class="verdict">${esc(V('example_receipt_verdict'))}</dd></div>
<div class="lead field-model"><dt>Model</dt><dd><code>${esc(V('example_receipt_model'))}</code></dd></div>
<div class="lead field-date"><dt>Date</dt><dd><code>${esc(V('example_receipt_date'))}</code></dd></div>
<div class="field-skill"><dt>Skill</dt><dd><code>${esc(V('example_receipt_skill'))}</code></dd></div>
<div class="field-band"><dt>Range</dt><dd><code>${esc(V('example_receipt_baseline'))} without, ${esc(V('example_receipt_with_skill'))} with</code></dd></div>
<div class="field-hash"><dt>Receipt hash</dt><dd><code>${esc(V('example_receipt_hash'))}</code></dd></div>
</dl>
<img class="receipt-plot" src="/${esc(V('example_receipt_plot'))}" alt="Two horizontal ranges on a zero to one scale. Without the skill the range is wide and low; with the skill it sits at the top and the two do not overlap." width="320" height="96">
</div>
</section>

<section id="how-it-works" class="screen">
<h2>How it works</h2>
<ol class="steps">
<li>Run your skill's tests twice: with the skill, and without it.</li>
<li>Score each answer several times, so every result is a range, not one fragile number.</li>
<li>Only call it a win or a loss when the ranges don't overlap. Otherwise we say: nothing moved beyond the noise.</li>
</ol>
<p class="naming">That range is a <strong>band</strong>. The dated file that records all of it is a <strong>receipt</strong>. What changes between two receipts is <strong>drift</strong>.</p>
<div class="panels">
${panels}
</div>
<div class="playground" data-island="band-playground" data-cases='${esc(caseData)}' data-floor="${esc(V('effect_floor'))}">
<img class="card-plot" src="/${esc(V('example_receipt_plot'))}" alt="The same two ranges, drawn from the bundled example receipt." width="320" height="96">
<p class="muted">Move the floor and change what counts as a band to see the verdict change. This is the bundled example receipt's own per-case data.</p>
</div>
</section>

<section id="skeptic" class="screen">
<h2>Skills don't break. Models move.</h2>
<div class="stats">
${statCards}
</div>
<p>On the report that measured it, draw-to-draw spread reaches <strong>sd <span data-stat="draw_spread_sd">${esc(V('draw_spread_sd'))}</span></strong> on a single case (<code>${esc(V('draw_spread_case'))}</code>). That is the across-draw spread of the model writing a different answer, not of the scorer re-reading one, and it is wider than the scorer's.</p>
<p>We publish refusals instead of guesses, and we publish our own instrument defects on the page. <a href="/methodology/">Read the methodology</a>, or <a href="/neutrality/">read what we will not claim</a>.</p>
</section>

<section id="audience" class="screen">
<h2>Who it's for</h2>
<div class="cols">
<div><h3>Skill authors</h3><p>Prove it helps before you publish.</p></div>
<div><h3>Catalog maintainers</h3><p>Know which of your skills broke when the model changed.</p></div>
<div><h3>Platform teams</h3><p>An evidence trail for the skills your agents run in production.</p></div>
</div>
</section>

<section id="quickstart" class="screen">
<h2>Run it on your own skill</h2>
<p>You need <code>Node 22</code> or newer and an <code>ANTHROPIC_API_KEY</code>. From "found the repo" to a receipt for your own skill is about five steps:</p>
<pre><code>npx driftproof init my-skill          # scaffold SKILL.md + evals/evals.json + .driftproofrc
# edit the 3 example cases so each is grounded in a claim your SKILL.md makes
export CLAUDE_PROVIDER=api
read -rsp "Anthropic API key: " ANTHROPIC_API_KEY &amp;&amp; export ANTHROPIC_API_KEY
npx driftproof run my-skill --models claude-haiku-4-5
cat receipts/*.summary.md              # read the receipt + human summary</code></pre>
<p>The <strong>verdict</strong> answers "does the skill still help on this model?". <code>PASSED</code> means the with-skill score beats the baseline by at least the effect floor, <code>NO_EFFECT</code> means it doesn't, <code>REGRESSED</code> means the skill hurts. Each case is judged several times so it carries its own range, and a case counts as moved only when the ranges don't overlap.</p>
</section>

<section id="ci" class="screen">
<h2>Verification in CI</h2>
<p>Wire drift detection into a repo with the <a href="https://github.com/driftproofhq/driftproof#verification-in-ci-github-action--badge">GitHub Action</a> (<code>uses: driftproofhq/driftproof@v${esc(V('version'))}</code>): it re-runs the suite on every push, uploads the receipt, and fails the job if the skill <em>regressed</em>. <code>driftproof badge</code> turns any receipt into a shields.io badge, so the claim on your README carries the model and the date it was measured.</p>
<p><img alt="driftproof badge: passing on claude-haiku-4-5" src="https://img.shields.io/endpoint?url=https://driftproofhq.com/badges/commit-message-conventions.json"></p>
</section>

<section id="latest" class="screen">
<h2>Latest report</h2>
<article class="report-card" data-report="${esc(latest.number.value)}">
<div>
<p class="card-type">${esc(latest.type.value)}</p>
<h3><a href="/reports/${esc(latest.number.value)}/">Report <span data-stat="latest_report_number">${esc(latest.number.value)}</span>: ${esc(latest.what_moved.value)}</a></h3>
<p class="card-models">${latest.model_ids.map((m) => `<code>${esc(m.value)}</code>`).join(' ')}</p>
<p class="card-date" data-stat="latest_report_date">${esc(V('latest_report_date'))}</p>
<p class="card-counts">${esc(latest.headline_counts.value)}</p>
</div>
<img class="card-plot" src="/${esc(latest.plot.value)}" alt="Band plot for the first cell of this report." width="320" height="96">
</article>
<p><a href="/reports/">All <span data-stat="reports_published">${esc(V('reports_published'))}</span> reports</a></p>
<p class="writing">Writing: <a href="/writing/three-releases/">${esc(latest.essay_links[0].title.value)}</a>, the launch essay, revised to read all ${esc(V('reports_published_word'))} reports together on what a moving model does to encoded expertise.</p>
</section>

<section id="subscribe" class="screen">
<h2>Get the next one</h2>
${chrome.SUB_OPEN}${chrome.SUB_CLOSE}
<p>Every report is also in the <a href="/feed.xml">Atom feed</a>.</p>
</section>

<section id="roadmap" class="screen">
<h2>Roadmap</h2>
<ul>
<li>More reports as the models move. A release watcher polls for new versions daily and queues a draft report for review when one ships.</li>
<li>Signed receipts, planned and not yet shipped: a key signature over the canonical form, so that a receipt could be <em>trusted</em> rather than only read. Today's receipts are hash-verified, which is integrity and not authenticity.</li>
<li>A sandboxed execution harness for tool-execution skills (document renderers, diagram and asset generators) that <a href="/reports/${esc(V('first_report_number'))}/">Report <span data-stat="first_report_number">${esc(V('first_report_number'))}</span></a> scopes out.</li>
</ul>
</section>
</main>`;

  return shell({
    title: 'Driftproof: dated, hash-verified receipts that an agent skill still helps',
    description: "A SKILL.md teaches an AI coding agent how you like things done. When a new model ships, the same file can stop helping, or start hurting.",
    main,
  });
}

// ── per-report Open Graph cards (AC-16) ─────────────────────────────────────
//
// Generated by scripts/build-og-card.py, EXTENDED - not by a second image
// pipeline. The filename carries a hash of the PNG's own bytes, so a card that
// changes gets a new URL and a cache keyed on URL cannot serve the stale one.
// The script deletes the previous hash for the same report, so the directory
// never accumulates orphans.
function buildCards() {
  const { execFileSync } = require('child_process');
  const py = path.join(ROOT, 'scripts', 'build-og-card.py');
  const out = [execFileSync('python3', [py, '--default-hashed', '--out-dir', DOCS], { encoding: 'utf8' }).trim()];
  for (const r of reports()) {
    const name = execFileSync('python3', [
      py,
      '--report', String(r.number.value),
      '--type', r.type.value,
      '--models', r.model_ids.map((m) => m.value).join('  '),
      // The green line is the report's own verdict where it has one, and its
      // summary where it does not (amendment 12). Same rule in the gate, which
      // redraws every card from this data and compares bytes.
      '--counts', String((r.verdict_line && r.verdict_line.value) || '').trim() || r.headline_counts.value,
      '--out-dir', path.join(DOCS, 'cards'),
    ], { encoding: 'utf8' }).trim();
    out.push(name);
  }
  return out;
}

// ── /reports/ ───────────────────────────────────────────────────────────────
//
// The recap that used to sit at the bottom of the homepage. One card per entry
// in docs/data/reports.json, newest first, so a Report #008 card appears the day
// its data does and nobody has to remember to add one.
//
// The six-type explanation below the cards is the paragraph the old homepage
// carried, re-set without em dashes and split into one block per type so each
// can carry its glyph and its example. No claim in it changes.
const TYPE_NOTES = [
  ['release drift report', 'separated',
    "Asks whether a skill's verdict holds when the model version underneath it changes."],
  ['substrate durability report', 'overlapping',
    'Asks whether it holds across a change of substrate: a different model behind a different vendor CLI.'],
  ['capability-gap report', 'separated',
    'Asks whether it holds on a higher tier of the same provider.'],
  ['value report', 'overlapping',
    'Holds the substrate still and asks what a skill costs to run, alongside whether it helps.'],
  ['revision drift report', 'refused',
    "Holds everything underneath still and moves the skill's own text."],
  ['instrument re-measurement report', 'overlapping',
    'Moves neither, and re-runs cells an earlier report published on a corrected measuring device.'],
];

// THE CARD STATES WHAT MOVED ONCE (fix pass R6). The card's title is
// `Report NNN: <what moved>` and the line beneath it was the same sentence
// again, on every card.
//
// It is a CONDITION and not a deletion, and the difference is worth a line.
// With today's title shape the condition is always true and the line never
// renders; if the title shape changes - a house title carrying the type and the
// models, say - the line comes back rather than the card quietly losing what
// moved. AC-18 asserts the property on the RENDERED card rather than here, so a
// condition that became wrong would be caught by reading the page.
function reportCard(r) {
  const tail = esc(r.what_moved.value);
  const title = `Report ${esc(r.number.value)}: ${tail}`;
  const moved = title.endsWith(tail) ? '' : `<p class="card-moved">${tail}</p>\n`;
  return `<article class="report-card" data-report="${esc(r.number.value)}">
<div>
<p class="card-type">${esc(r.type.value)}</p>
<h3><a href="/reports/${esc(r.number.value)}/">${title}</a></h3>
${moved}<p class="card-models">${r.model_ids.map((m) => `<code>${esc(m.value)}</code>`).join(' ')}</p>
<p class="card-date">${esc(r.date.value)}</p>
<p class="card-counts">${esc(r.headline_counts.value)}</p>
</div>
<img class="card-plot" src="/${esc(r.plot.value)}" alt="Band plot for the first cell of Report ${esc(r.number.value)}." width="320" height="96">
</article>`;
}

function typeExample(label, R) {
  const hit = R.find((r) => r.type.value.toLowerCase().startsWith(label.replace(/ report$/, '').toLowerCase()));
  return hit || R[0];
}

function reportsIndex() {
  const S = stats();
  const V = reader(S);
  const R = reports();
  const cards = R.map(reportCard).join('\n');
  const types = TYPE_NOTES.map(([label, glyph, note]) => {
    const ex = typeExample(label, R);
    return `<section class="report-type-card">
<img src="/assets/glyph-${glyph}.svg" alt="" width="96" height="60">
<div>
<h3>${label.charAt(0).toUpperCase()}${label.slice(1)}</h3>
<p>${note} Example: <a href="/reports/${esc(ex.number.value)}/">Report ${esc(ex.number.value)}</a>.</p>
</div>
</section>`;
  }).join('\n');
  const essay = R[0].essay_links[0];
  const main = `<main>
<section id="all-reports" class="screen">
<h2>Reports</h2>
<p>Every report Driftproof has published, newest first. ${esc(V('reports_published'))} reports, ${esc(V('receipts_published'))} receipts, all of them dated and hash-verified.</p>
${cards}
</section>

<section id="report-types" class="screen">
<h2>The six report types</h2>
<p>All six use the same rule: a verdict is claimed only when the two ranges do not overlap and the move clears the floor. They differ in what moves underneath the skill, or, in the value report, in which axes are measured.</p>
${types}
</section>

<section id="writing" class="screen">
<h2>Writing</h2>
<p><a href="${esc(essay.href.value)}">${esc(essay.title.value)}</a>: the launch essay, revised to read all ${esc(V('reports_published_word'))} reports together on what a moving model does to encoded expertise, and on what a corrected instrument did to three published results.</p>
</section>
</main>`;
  return shell({
    title: 'Reports | Driftproof',
    description: 'Every report Driftproof has published, newest first, with the six report types and what moves underneath the skill in each.',
    main,
  });
}


// ── redirect stubs and 404 ──────────────────────────────────────────────────
//
// The five documentation pages move from /x.html to /x/. Search Console has
// already indexed the old paths and every published report body links them, and
// a report body may not be edited. So the old path stays, as a stub: a meta
// refresh, a canonical pointing at the new location, and a visible link for a
// reader whose browser does not follow the refresh.
//
// A stub is NOT a page. scripts/build-sitemap.js leaves it out of the sitemap
// and the gate asserts, in both directions, that the sitemap is exactly the
// non-stub page set - and that every stub's canonical target IS listed, so a
// stub can never hide a page that went missing.
const STUBS = {
  methodology: 'Methodology',
  neutrality: 'Neutrality',
  interop: 'Interop',
  authoring: 'Authoring',
  'judge-policy': 'Judge policy',
};

function redirectStub(slug, label) {
  const main = `<main>
<section class="screen">
<h1>${esc(label)} has moved</h1>
<p>This page now lives at <a href="/${slug}/">driftproofhq.com/${slug}/</a>, and your browser should be taking you there. If it does not, follow the link.</p>
</section>
</main>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=/${slug}/">
<title>${esc(label)} | Driftproof</title>
<meta name="description" content="This page has moved to driftproofhq.com/${slug}/.">
<link rel="stylesheet" href="/style.css">
</head>
<body>
${chrome.NAV}
${main}
${chrome.FOOTER}
</body>
</html>
`;
}

function notFoundPage() {
  const V = reader(stats());
  const main = `<main>
<section class="screen">
<h1>That page is not here</h1>
<p>Nothing lives at this address. The reports are the thing most people are looking for, and there are ${esc(V('reports_published'))} of them.</p>
<p><a class="cta" href="/reports/">All reports</a> <a class="cta secondary" href="/">Home</a></p>
</section>
</main>`;
  return shell({
    title: 'Not found | Driftproof',
    description: 'Nothing lives at this address. The reports, the methodology and the glossary are all one link away from here.',
    main,
  });
}


// ── /glossary/ and /report-types/ ───────────────────────────────────────────
//
// Ten terms, two sentences each, every one linking to the section it is taken
// from. The definitions are the site's own words for what the methodology and
// spec/RECEIPT.md already say; the link is what lets a reader check that claim
// rather than take it.
const M = 'https://driftproofhq.com/methodology/';
const CORE = `/methodology/#the-core-with-vs-without-sampled-banded`;
const RULE = `/methodology/#the-drift-verdict-rule-anti-false-positive`;
const SURFACES = `/methodology/#providers-surfaces-and-neutrality`;
const FORMAT = `/methodology/#receipts-are-an-open-format`;
const RECEIPT_SPEC = 'https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md';

const TERMS = [
  ['drift report', 'A dated comparison of two runs of the same eval suite, asking whether a skill still helps after something underneath it moved. It names what moved, reports a verdict per cell, and links the receipts every figure came from.', RULE, 'the drift verdict rule'],
  ['receipt', 'The dated, hash-verified JSON file a single run emits: the skill and its content hash, the model, the surface, every case score, and the comparison between the two arms. It is the unit of evidence on this site, and every published number traces to one.', RECEIPT_SPEC, 'the receipt specification'],
  ['band', 'The range a score carries instead of a single number, because a scorer asked twice does not answer identically twice. A result is a band, not a point, and the width of that band is what decides whether a difference is real.', CORE, 'with vs without, sampled, banded'],
  ['effect floor', 'The smallest lift that counts as a lift, below which a difference is reported as no effect however the bands fall. It exists because a score can move by a rounding artefact of the scoring grid and mean nothing at all.', RULE, 'the drift verdict rule'],
  ['substrate', 'The model underneath the skill: a specific version, from a specific provider, at a specific tier. Driftproof exists because the substrate moves while the skill file stands still.', SURFACES, 'providers, surfaces and neutrality'],
  ['surface', 'How the model was reached: a metered API or a subscription CLI. The same model over two surfaces is not guaranteed to behave identically, so every receipt records which one it ran on.', SURFACES, 'providers, surfaces and neutrality'],
  ['refusal', 'A published result that reports no verdict, because the run could not stand behind one. A refusal is an outcome and not an error, and publishing it is the alternative to guessing.', RULE, 'the drift verdict rule'],
  ['cell', 'One skill measured on one substrate: the smallest unit a report gives a verdict to. A report is a grid of cells, and a cell that refuses does not sink the ones that did not.', CORE, 'with vs without, sampled, banded'],
  ['arm', 'One side of the comparison: the run WITH the skill, or the baseline run without it. Every case is run in both arms, and the difference between the two arms is the only thing a lift can mean.', CORE, 'with vs without, sampled, banded'],
  ['lattice', 'The four verification levels a receipt can carry: UNVERIFIED, DECLARED, TESTED and FORMAL. A number Driftproof measured itself is TESTED; a number imported from another tool is DECLARED, recorded but not verified, and never given a pass or fail verdict.', FORMAT, 'receipts are an open format'],
];

// THE QUOTED RULE IS A SENTENCE, and the template does not add to it (fix pass
// R8). This paragraph used to append a full stop to a value that already carried
// one, so it read "within noise - never as drift..". The spaced hyphen was not
// this page's either: the value is quoted out of the methodology page, and it is
// fixed there, because a quotation cannot be repaired anywhere but at its source.
function glossaryPage() {
  const V = reader(stats());
  const entries = TERMS.map(([term, body, href, label]) => {
    const id = `term-${term.replace(/ /g, '-')}`;
    return `<dt id="${id}">${term.charAt(0).toUpperCase()}${term.slice(1)}</dt>
<dd>${body} <a href="${esc(href)}">Source: ${esc(label)}</a>.</dd>`;
  }).join('\n');
  const main = `<main>
<section id="glossary" class="screen">
<h2>Glossary</h2>
<p>Ten words this site uses in a particular way, two sentences each, every one linking to the section it comes from. The verdict rule, in the methodology's own words: ${esc(V('verdict_rule'))}</p>
<dl class="glossary">
${entries}
</dl>
</section>
</main>`;
  return shell({
    title: 'Glossary | Driftproof',
    description: 'Ten words this site uses in a particular way, two sentences each, every one linking to the section of the methodology or the receipt spec it comes from.',
    main,
  });
}

function reportTypesPage() {
  const R = reports();
  const cards = TYPE_NOTES.map(([label, glyph, note]) => {
    const ex = typeExample(label, R);
    return `<section class="report-type-card">
<img src="/assets/glyph-${glyph}.svg" alt="" width="96" height="60">
<div>
<h3>${label.charAt(0).toUpperCase()}${label.slice(1)}</h3>
<p>${note}</p>
<p>Example: <a href="/reports/${esc(ex.number.value)}/">Report ${esc(ex.number.value)}</a>, ${esc(ex.what_moved.value)}.</p>
</div>
</section>`;
  }).join('\n');
  const main = `<main>
<section id="types" class="screen">
<h2>The six report types</h2>
<p>Driftproof publishes six kinds of report. All six use the same rule, and they differ in what moves underneath the skill, or, in the value report, in which axes are measured.</p>
${cards}
</section>
</main>`;
  return shell({
    title: 'Report types | Driftproof',
    description: 'Driftproof publishes six kinds of report. They share one verdict rule and differ in what moves underneath the skill in each.',
    main,
  });
}

const TARGETS = {
  'index.html': homepage,
  'glossary/index.html': glossaryPage,
  'report-types/index.html': reportTypesPage,
  'reports/index.html': reportsIndex,
  '404.html': notFoundPage,
  ...Object.fromEntries(Object.entries(STUBS).map(([slug, label]) => [`${slug}.html`, () => redirectStub(slug, label)])),
};

function main() {
  const check = process.argv.includes('--check');
  if (!check) buildCards();
  const headTags = require('./build-head-tags.js');
  const stale = [];
  for (const [rel, render] of Object.entries(TARGETS)) {
    const dest = path.join(DOCS, rel);
    const out = headTags.render(render(), rel);
    const before = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (before === out) continue;
    if (check) { stale.push(rel); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
  }
  if (check && stale.length) {
    console.error(`stale site pages - run: node scripts/build-site-pages.js\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(check ? `all ${Object.keys(TARGETS).length} rendered pages are current`
    : `${Object.keys(TARGETS).length} site pages written`);
}

if (require.main === module) main();
module.exports = { shell, homepage, reportsIndex, glossaryPage, reportTypesPage, notFoundPage, redirectStub, STUBS, TERMS, TARGETS, reader, stats, reports, buildCards };
