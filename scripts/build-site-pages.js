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

// THE THREE STATES, DRAWN FROM REAL CELLS (spec 025 AC-11). They were three pill
// icons in cards: a picture OF the instrument rather than the instrument. Each is
// now a band plot of a published cell that is actually in that state, chosen as
// the first in sorted order so the choice is derivable and stable rather than
// picked. A state with no cell in the archive throws, rather than rendering a
// figure of something this site has never measured.
function statePlot(state) {
  const dir = path.join(DOCS, 'plots');
  const hit = fs.readdirSync(dir).sort()
    // THE ROOT CLASS, not any occurrence of the word. Every plot's own token block
    // declares --state-separated, --state-overlapping and --state-refused, so a
    // scan for the bare word finds the first DECLARATION in every file and reports
    // that every cell is separated. The state a plot is in is the class on its
    // <svg> element, and that is the only place it is a fact rather than a name.
    .find((n) => n.endsWith('.card.svg')
      && new RegExp(`<svg[^>]*class="[^"]*\\bstate-${state}\\b`).test(fs.readFileSync(path.join(dir, n), 'utf8')));
  if (!hit) throw new Error(`no published cell is in the ${state} state`);
  return `plots/${hit}`;
}

// ── the receipt, hero variant ───────────────────────────────────────────────
//
// The same renderer the TL;DR card goes through (spec 025 AC-5). The row order
// is the page's own, unchanged: the scope rule of this loop is that the visible
// text of every page equals main's outside a written allowlist, and a reordered
// column of labels is a reordered page.
//
// THE PLOT SITS BETWEEN THE DATE AND THE HASH, which is where the design puts
// it and where it does not disturb a word: an image carries no text, so moving
// it moves nothing a reader reads.
const STAMP = { PASSED: 'passed', NO_EFFECT: 'no-effect', REGRESSED: 'regressed', REFUSED: 'refused' };
// The plot state whose colour the card's caption takes, for a verdict: the stamp map's reading.
const CAPTION_STATE = { PASSED: 'separated', NO_EFFECT: 'overlapping' };
// What a receipt's page says of it: its label and the honest line under it, from the table the
// receipt pages render (spec 036 § The honest line), so the homepage and the page cannot word one
// verdict two ways.
function receiptWords(receipt) {
  const { LABELS, honestLine } = require('./build-receipt-pages.js');
  const v = require('../lib/verdict.js').receiptVerdict(receipt);
  return { verdict: v.verdict, label: LABELS[v.verdict][0], honest: honestLine(v) };
}
// THE VERDICT ROW IS THE LINKED RECEIPT'S OWN (spec 037 A-037-2, P-10 (b)). The card sits beside a
// link to that receipt's page, which states the verdict lib/verdict.js reads off the receipt, so the
// row reads it the same way and from the same file. The other rows read stats.json, re-cut from the
// same receipt at the 0.11.0 pre-build (DECISIONS 2026-09-16, spec 035 F-3).
//
// SO IS THE PLOT'S CAPTION (spec 037 A-037-3, F-2). The inlined plot names the band plot's own
// state, drawn from the arm aggregates, and it read *separated* under a verdict row reading *Not
// measured*: one receipt, two readings, on the first screen. The caption word becomes the page's
// label, the title's state sentence becomes the label alone (A-037-4: the honest line stays on the
// linked page, because PASSED's names the band rule and spec 020 AC-8 bars that from the hero), and the caption's colour
// follows the verdict as the stamp does. The bands, ticks and floor are the generated file's bytes.
function heroReceipt(V, receipt) {
  const { verdict, label } = receiptWords(receipt);
  const mono = (v) => `<code>${esc(v)}</code>`;
  // THE HERO PLOT IS INLINE, and the reason is the one animation on this site
  // (spec 025 AC-7). A stylesheet cannot reach inside an <img>, so a plot loaded
  // that way could only animate by carrying its own @media block - and then 123
  // generated files would each carry one, when the criterion says exactly one
  // exists. The bytes are the generated file's own, read at build: this inlines
  // an artifact, it does not draw a second one.
  const src = chrome.uniqueHatch(fs.readFileSync(path.join(DOCS, V('example_receipt_plot')), 'utf8').trim(), V('example_receipt_plot'));
  const state = CAPTION_STATE[verdict] || 'refused';
  const swaps = [
    [/class="bandplot (is-hero) state-(?:separated|overlapping|refused)"/, `class="receipt-plot bandplot $1 state-${state}"`],
    [/(<title>[^<]*?\. )(?:separated|overlapping|refused): [^.<]*\. (Without the skill)/, `$1${esc(label)}. $2`],
    [/(\.verdict \{[^}]*fill: var\(--)state-(?:separated|overlapping|refused)(\);)/, `$1state-${state}$2`],
    [/(<text class="verdict"[^>]*>)[^<]*(<\/text>)/, `$1${esc(label)}$2`],
  ];
  const plot = swaps.reduce((svg, [re, to]) => {
    const n = (svg.match(new RegExp(re.source, 'g')) || []).length;
    if (n !== 1) throw new Error(`the hero plot's caption: ${re} matched ${n} time(s), not once`);
    return svg.replace(re, to);
  }, src);
  return chrome.receiptCard({
    variant: 'hero',
    heading: 'A receipt, in full',
    rows: [
      { key: 'Verdict', rowClass: 'receipt-row-verdict', stamp: STAMP[verdict] || 'refused', value: esc(label) },
      { key: 'Model', value: mono(V('example_receipt_model')) },
      { key: 'Date', rowClass: 'receipt-row-date', value: mono(V('example_receipt_date')) },
      { key: 'Skill', value: mono(V('example_receipt_skill')) },
      // A-025-16: 3 decimals for display, matching lib/decision.js's delta
      // formatting. stats.json keeps the field at its full, provenance-checked
      // precision (spec 020 AC-6 requires the stored value to appear verbatim
      // in the file it cites); only this row's rendered text is rounded, since
      // a generation-sampled receipt's six-decimal score wrapped the row to two
      // lines (spec 026 A-026-13 gave the bundled example real per-case samples).
      { key: 'Range', value: mono(`${Number(V('example_receipt_baseline')).toFixed(3)} without, ${Number(V('example_receipt_with_skill')).toFixed(3)} with`) },
      { plot },
      { key: 'Receipt hash', rowClass: 'receipt-row-hash', value: mono(V('example_receipt_hash')) },
    ],
  });
}

// ── the homepage ────────────────────────────────────────────────────────────
function homepage() {
  const S = stats();
  const V = reader(S);
  const R = reports();
  const latest = R[0];
  const example = JSON.parse(fs.readFileSync(path.join(ROOT,
    'receipts', 'commit-message-conventions-claude-haiku-4-5-20251001-2026-09-17.json'), 'utf8'));
  // Real per-case scores for the playground island. Read from the bundled
  // receipt at build; the island invents nothing and fetches nothing.
  const caseData = JSON.stringify(['baseline', 'with_skill'].map((mode) =>
    example.results.cases.filter((c) => c.mode === mode).map((c) => Number(c.score.toFixed(4)))));

  const panels = [
    ['separated', 'Separated', 'The two ranges do not overlap, and the move clears the floor. A separation is detected under the rule, which is not proof that the skill moved.'],
    ['overlapping', 'Overlapping', 'The ranges share space. We say no separation detected at this sample size, and we say it plainly.'],
    ['refused', 'Refused', 'The run could not stand behind a number, so it reports no result instead of guessing one.'],
  ].map(([k, h, p]) => `<figure class="panel plot-figure">
<img class="bandplot" src="/${esc(statePlot(k))}" alt="Two horizontal ranges, drawn ${k === 'separated' ? 'apart' : k === 'overlapping' ? 'crossing each other' : 'with one hatched because nothing was measured'}." width="260" height="72">
<figcaption><span class="panel-title">${h}</span> ${p}</figcaption>
</figure>`).join('\n');

  const statCards = [
    ['reports_published', 'reports published'],
    ['receipts_published', 'receipts published'],
    ['substrates_measured', 'models measured on'],
    ['cases_measured', 'eval cases scored'],
    ['refusals_published', 'refusals published'],
    ['cells_within_noise', 'runs with no separation detected at their sample size'],
  ].map(([k, label]) => `<div class="strip-item"><span class="strip-value" data-stat="${k}">${esc(V(k))}</span><span class="strip-label">${label}</span></div>`).join('\n');

  // THE PROMISE FIRST, THE EVIDENCE UNDER IT (spec 037). The first screen asks the
  // question, gives the Claude Code plugin as the first install, and links a receipt
  // and the findings; everything a specialist wants is further down.
  const exampleHash = example.receipt_hash;
  const plugin = ['claude plugin marketplace add driftproofhq/driftproof', 'claude plugin install driftproof@driftproofhq'];
  const copy = (c) => `<span class="copy-cta"><code>${esc(c)}</code><button type="button" data-copy="${esc(c)}">Copy</button></span>`;
  const main = `<main class="screens">
<section id="hero" class="screen is-wide">
<div>
<h1>Is the gap your skill makes real, or noise? Did it hold on the last model release?</h1>
<p class="hero-sub">A SKILL.md teaches an AI coding agent how you like things done. A skill's own tests passing is one answer. Driftproof asks two more: whether the scores with the skill and without it separate beyond their spread, and whether that held when the model changed. Each answer is a dated, hash-verified receipt, and when there were too few draws to tell, the receipt says so.</p>
<div class="install-first">
<p class="install-label">Install in Claude Code</p>
${plugin.map(copy).join('\n')}
<p class="muted">Then run <code>/driftproof:run</code> on a skill in your repository. For CI, <a href="#ci">npx and the GitHub Action</a> are further down.</p>
</div>
<p class="hero-links"><a class="cta" href="/r/${esc(exampleHash)}/">See a receipt</a> <a href="/findings/">Read the findings</a> <a href="/reports/${esc(V('latest_report_number'))}/">Read the latest report</a></p>
</div>
${heroReceipt(V, example)}
</section>

<section id="states" class="screen is-text">
<h2>What a receipt can say</h2>
<ul class="states">
<li><strong>Passing.</strong> A case separated upward under the band rule: the two ranges do not overlap and the move clears the effect floor. That is a separation detected under the rule, not proof that the skill moved the score.</li>
<li><strong>Regressed.</strong> A case separated downward under the same rule.</li>
<li><strong>No separation detected.</strong> The ranges overlap at this sample size, which is not evidence that nothing changed.</li>
<li><strong>Not enough draws.</strong> Not enough draws to conclude at this effect floor. The receipt prints how many draws per arm would have been needed, or that no number of draws reaches the floor at the spreads it measured.</li>
<li><strong>Not measured.</strong> The receipt carries no verdict, and its page names every reason, such as a run that does not record that a model answered it.${receiptWords(example).label === 'Not measured' ? ' The receipt in the card above is one.' : ''}</li>
</ul>
<p>Every receipt has its own page, with its verdict, its two arms and a way to verify it yourself. <a href="/how-this-is-built/">How this is built</a> describes how the tool itself is checked.</p>
</section>

<section id="how-it-works" class="screen is-bleed">
<div class="bleed-inner">
<h2>How it works</h2>
<ol class="steps">
<li>Run your skill's tests twice: with the skill, and without it.</li>
<li>Draw each answer several times and score each draw several times, so every result is a range, not one fragile number.</li>
<li>Call it a separation only when the ranges don't overlap and the move clears the floor. When the ranges overlap, say no separation detected at this sample size; when the draws were too few to tell, say so.</li>
</ol>
<p class="naming">That range is a <strong>band</strong>. The dated file that records all of it is a <strong>receipt</strong>. What changes between two receipts is <strong>drift</strong>.</p>
<div class="panels">
${panels}
</div>
<div class="card playground" data-island="band-playground" data-cases='${esc(caseData)}' data-floor="${esc(V('effect_floor'))}">
<img class="bandplot" src="/${esc(V('example_receipt_plot_play'))}" alt="The same two ranges, drawn from the bundled example receipt." width="640" height="200">
<p class="muted">Move the floor and change what counts as a band to see the verdict change. This is the bundled example receipt's own per-case data.</p>
</div>
</div>
</section>

<section id="skeptic" class="screen is-bleed">
<div class="bleed-inner">
<h2>Skills don't break. Models move.</h2>
<div class="strip">
${statCards}
</div>
<p>On the report that measured it, draw-to-draw spread reaches <strong>sd <span data-stat="draw_spread_sd">${esc(V('draw_spread_sd'))}</span></strong> on a single case (<code>${esc(V('draw_spread_case'))}</code>). That is the across-draw spread of the model writing a different answer, not of the scorer re-reading one, and it is wider than the scorer's.</p>
<p>We publish refusals instead of guesses, and we publish <a href="/findings/">our own instrument defects</a>, including what outside audits found. <a href="/methodology/">Read the methodology</a>, or <a href="/neutrality/">read what we will not claim</a>.</p>
</div>
</section>

<section id="audience" class="screen is-text">
<h2>Who it's for</h2>
<div class="cols">
<div><h3>Skill authors</h3><p>See whether it helps before you publish, and on which model.</p></div>
<div><h3>Catalog maintainers</h3><p>See which of your skills stopped separating when the model changed.</p></div>
<div><h3>Platform teams</h3><p>An evidence trail for the skills your agents run in production.</p></div>
</div>
</section>

<section id="quickstart" class="screen is-text">
<h2>Install in Claude Code</h2>
${plugin.map((c) => `<p>${copy(c)}</p>`).join('\n')}
<p>That installs <code>/driftproof:init</code>, <code>/driftproof:run</code> and <code>/driftproof:badge</code>. The plugin hands your arguments to the pinned runner and writes the receipt that runner would have written; <code>/driftproof:run</code> spends your Claude Code subscription rather than an API key, and it never edits a skill.</p>
<p>Driftproof is tested on Linux and macOS. In an outside retest on macOS the shipped gate failed only in the publishing helper, which needs GNU <code>realpath -m</code>. Windows is untested: from Node's source the plugin would not find <code>npx</code> there, but that failure has never been observed. A CI matrix across Linux, macOS and Windows is planned, and <a href="/findings/">the findings page</a> has the figures.</p>
</section>

<section id="ci" class="screen is-text">
<h2>In CI: npx and the GitHub Action</h2>
<p>You need <code>Node 22</code> or newer and an <code>ANTHROPIC_API_KEY</code>. From a clean checkout to a receipt for your own skill:</p>
<pre><code>npx driftproof init my-skill          # scaffold SKILL.md + evals/evals.json + .driftproofrc
# edit the 3 example cases so each is grounded in a claim your SKILL.md makes
export CLAUDE_PROVIDER=api
read -rsp "Anthropic API key: " ANTHROPIC_API_KEY &amp;&amp; export ANTHROPIC_API_KEY
npx driftproof run my-skill --models claude-haiku-4-5
cat receipts/*.summary.md              # read the receipt + human summary</code></pre>
<p>Wire it into a repository with the <a href="https://github.com/driftproofhq/driftproof#verification-in-ci-github-action--badge">GitHub Action</a> (<code>uses: driftproofhq/driftproof@v${esc(V('version'))}</code>): it re-runs the suite on every push, uploads the receipts, and fails the job when a case separated downward. <code>driftproof badge</code> turns a receipt into a badge that carries the model and the date it was measured.</p>
<p><img alt="driftproof badge: ${esc(require('../lib/verdict.js').verdictFromReceipt(example).message)}" src="https://img.shields.io/endpoint?url=https://driftproofhq.com/badges/commit-message-conventions.json"></p>
</section>

<section id="latest" class="screen is-wide">
<h2>Latest report</h2>
${reportCard(latest, (k) => (k === 'number' ? ' data-stat="latest_report_number"' : ' data-stat="latest_report_date"'))}
<p><a href="/reports/">All <span data-stat="reports_published">${esc(V('reports_published'))}</span> reports</a></p>
<p class="writing">Writing: <a href="/writing/three-releases/">${esc(latest.essay_links[0].title.value)}</a>, the launch essay, revised to read all ${esc(V('reports_published_word'))} reports together on what a moving model does to encoded expertise.</p>
</section>

<section id="subscribe" class="screen is-text">
<h2>Get the next one</h2>
${chrome.SUB_OPEN}${chrome.SUB_CLOSE}
<p>Every report is also in the <a href="/feed.xml">Atom feed</a>.</p>
</section>

<section id="roadmap" class="screen is-text">
<h2>Roadmap</h2>
<ul>
<li>Next: activation checks.</li>
<li>Planned, not scheduled: a sandboxed execution harness for tool-execution skills (document renderers, diagram and asset generators), which <a href="/reports/${esc(V('first_report_number'))}/">Report <span data-stat="first_report_number">${esc(V('first_report_number'))}</span></a> scopes out.</li>
</ul>
</section>
</main>`;

  return shell({
    title: 'Driftproof: is the gap your skill makes real, or noise?',
    description: "A SKILL.md teaches an AI coding agent how you like things done. Driftproof asks whether the gap it makes is real or noise, and whether it held when the model changed.",
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
    // THE CARD IS THE RECORD'S OWN (spec 031 A-031-25). A report page's og:image is
    // part of the dated record, like its summary card and description, so where the
    // page carries an amended headline or verdict the card is drawn from the values
    // as published (site-data.mjs recordedFields), not the row's amended ones.
    // Required at call time: site-data.mjs loads the report renderers.
    const pageRel = `docs/reports/${r.number.value}/index.html`;
    const page = fs.existsSync(path.join(ROOT, pageRel)) ? fs.readFileSync(path.join(ROOT, pageRel), 'utf8') : '';
    const own = (/<p class="amended-(?:headline|verdict)">/.test(page) && require('./site-data.mjs').recordedFields(page, pageRel)) || r;
    const name = execFileSync('python3', [
      py,
      '--report', String(r.number.value),
      '--type', r.type.value,
      '--models', r.model_ids.map((m) => m.value).join('  '),
      // The green line is the report's own verdict where it has one, and its
      // summary where it does not (amendment 12). Same rule in the gate, which
      // redraws every card from this data and compares bytes.
      '--counts', String((own.verdict_line && own.verdict_line.value) || '').trim() || own.headline_counts.value,
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
// THE COUNT AND THE LIST ARE DERIVED (spec 025 AC-18). Two pages said "six" in
// prose and carried six hand-ordered blocks. Six is right today and was typed,
// which is the failure class the whole data layer exists to close, and it is the
// one figure on this site spec 020 AC-9's numeral scan cannot see because it is
// spelled as a word.
//
// The list is the distinct values of the `type` field in docs/data/reports.json,
// in order of first appearance, so the two pages cannot disagree with each other
// or with the archive. The NOTES are keyed by that value: a type with no note
// throws at build rather than rendering an empty block, which is the same
// contract reader() already gives every figure on a non-report page.
const TYPE_NOTES = {
  'Release drift report': ['separated',
    "Asks whether a skill's verdict holds when the model version underneath it changes."],
  'Substrate durability report': ['overlapping',
    'Asks whether it holds across a change of substrate: a different model behind a different vendor CLI.'],
  'Capability-gap report': ['separated',
    'Asks whether it holds on a higher tier of the same provider.'],
  'Value report': ['overlapping',
    'Holds the substrate still and asks what a skill costs to run, alongside whether it helps.'],
  'Revision drift report': ['refused',
    "Holds everything underneath still and moves the skill's own text."],
  'Instrument re-measurement report': ['overlapping',
    'Moves neither, and re-runs cells an earlier report published on a corrected measuring device.'],
};
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
const word = (n) => (WORDS[n] === undefined ? String(n) : WORDS[n]);
function reportTypes(R) {
  return [...new Set((R || reports()).map((r) => r.type.value))];
}
function typeNote(type) {
  const note = TYPE_NOTES[type];
  if (!note) throw new Error(`docs/data/reports.json carries the type "${type}" and this file has no note for it`);
  return note;
}

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
// THE CHIP CARRIES THE STATE THE REPORT'S OWN PLOT IS IN (spec 025 AC-9). The
// type eyebrow was a shouted line of capitals with no colour; it is a chip now,
// in the colour of the state, and the state is read off the plot this card
// already shows rather than restated. The verdict WORD is inside that plot,
// top right, where spec 025 AC-6 puts it at every size.
function plotState(rel) {
  const f = path.join(DOCS, rel);
  if (!fs.existsSync(f)) return 'overlapping';
  return (fs.readFileSync(f, 'utf8').match(/<svg[^>]*class="[^"]*\bstate-(separated|overlapping|refused)\b/) || [])[1] || 'overlapping';
}

// ONE CARD, TWO PAGES (spec 025 AC-9). `stat` is the homepage's only difference:
// spec 020 AC-9 requires every numeral the homepage prints to name the
// stats.json field it came from, and the reports index carries no such rule
// because it is not the page that page's criterion is about. It adds an
// attribute and never a character of text, and the gate asserts the two rendered
// cards are identical once the attributes are removed.
function reportCard(r, stat = () => '') {
  const tail = esc(r.what_moved.value);
  const title = `Report <span${stat('number')}>${esc(r.number.value)}</span>: ${tail}`;
  const moved = title.endsWith(tail) ? '' : `<p class="card-moved">${tail}</p>\n`;
  return `<article class="card report-card" data-report="${esc(r.number.value)}">
<div>
<p class="card-type is-${plotState(r.plot.value)}">${esc(r.type.value)}</p>
<h3><a href="/reports/${esc(r.number.value)}/">${title}</a></h3>
${moved}<p class="card-models">${r.model_ids.map((m) => `<code>${esc(m.value)}</code>`).join(' ')}</p>
<p class="card-date"><span${stat('date')}>${esc(r.date.value)}</span></p>
<p class="card-counts">${esc(r.headline_counts.value)}</p>
</div>
${chrome.inlinePlot(r.plot.value, 'card-plot', `Band plot for the first cell of Report ${r.number.value}.`)}
</article>`;
}

// The newest report of that type. reports.json is newest first, so `find` is the
// selection rather than a scan with a preference bolted on.
function typeExample(type, R) {
  return R.find((r) => r.type.value === type) || R[0];
}

function reportsIndex() {
  const S = stats();
  const V = reader(S);
  const R = reports();
  // `R.map(reportCard)` would hand the index in as the second argument, which is
  // the attribute writer. One arrow, and the card renders as itself.
  const cards = R.map((r) => reportCard(r)).join('\n');
  const TYPES = reportTypes(R);
  const types = TYPES.map((type) => {
    const [glyph, note] = typeNote(type);
    const ex = typeExample(type, R);
    return `<section class="report-type-card">
<img src="/assets/glyph-${glyph}.svg" alt="" width="96" height="60">
<div>
<h3>${esc(type)}</h3>
<p>${note} Example: <a href="/reports/${esc(ex.number.value)}/">Report ${esc(ex.number.value)}</a>.</p>
</div>
</section>`;
  }).join('\n');
  const essay = R[0].essay_links[0];
  const main = `<main class="screens">
<section id="all-reports" class="screen">
<h2>Reports</h2>
<p>Every report Driftproof has published, newest first. ${esc(V('reports_published'))} reports, ${esc(V('receipts_published'))} receipts, all of them dated and hash-verified.</p>
${cards}
</section>

<section id="report-types" class="screen is-text">
<h2>The ${word(TYPES.length)} report types</h2>
<p>All ${word(TYPES.length)} use the same rule: a verdict is claimed only when the two ranges do not overlap and the move clears the floor. They differ in what moves underneath the skill, or, in the value report, in which axes are measured.</p>
${types}
</section>

<section id="writing" class="screen">
<h2>Writing</h2>
<p><a href="${esc(essay.href.value)}">${esc(essay.title.value)}</a>: the launch essay, revised to read all ${esc(V('reports_published_word'))} reports together on what a moving model does to encoded expertise, and on what a corrected instrument did to three published results.</p>
</section>
</main>`;
  return shell({
    title: 'Reports | Driftproof',
    description: `Every report Driftproof has published, newest first, with the ${word(TYPES.length)} report types and what moves underneath the skill in each.`,
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
  const main = `<main class="screens">
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

// ── /subscribed/ ────────────────────────────────────────────────────────────
//
// Where the subscribe form comes back to (spec 025 AC-15, closing
// approval-20260902T085754Z F-iv and F-020-5). The form's action posts to
// Buttondown, which answers with its own confirmation page, so the last thing a
// reader saw after handing over an address was a third party's screen. This page
// keeps them here and gives the privacy line somewhere to point.
//
// THE PAGE SHIPS FIRST AND THE REDIRECT IS SET AFTERWARDS. Buttondown's
// post-subscribe destination is a setting in its dashboard, not a file in this
// repository; the marketing lane changes it after merge, and it is in the
// approval packet as a post-merge step. A redirect to a page that does not exist
// is worse than no redirect, so the page exists first.
function subscribedPage() {
  const main = `<main class="screens">
<section class="screen is-text">
<h1>You are on the list</h1>
<p>Thank you. One email per model release, and nothing else.</p>
<p><a class="cta" href="/reports/">Read the reports</a></p>
</section>
</main>`;
  return shell({
    title: 'Subscribed | Driftproof',
    description: 'Thank you. One email per model release, and nothing else.',
    main,
  });
}

function notFoundPage() {
  const V = reader(stats());
  const main = `<main class="screens">
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
const BANDS = `/methodology/#where-a-band-comes-from`;

const TERMS = [
  ['drift report', 'A dated comparison of two runs of the same eval suite, asking whether a skill still helps after something underneath it moved. It names what moved, reports a verdict per cell, and links the receipts every figure came from.', RULE, 'the drift verdict rule'],
  ['receipt', 'The dated, hash-verified JSON file a single run emits: the skill and its content hash, the model, the surface, every case score, and the comparison between the two arms. It is the unit of evidence on this site, and every published number traces to one.', RECEIPT_SPEC, 'the receipt specification'],
  ['band', 'The range a score carries instead of a single number, because a scorer asked twice does not answer identically twice. A band is a descriptive spread, the mean plus or minus one sample standard deviation across n generations scored by the fixed judge, and whether two bands overlap decides whether a separation is detected under the rule.', CORE, 'with vs without, sampled, banded'],
  ['effect floor', 'The smallest lift that counts as a lift, below which a difference is reported as no effect however the bands fall. It exists because a score can move by a rounding artefact of the scoring grid and mean nothing at all.', RULE, 'the drift verdict rule'],
  ['substrate', 'The model underneath the skill: a specific version, from a specific provider, at a specific tier. Driftproof exists because the substrate moves while the skill file stands still.', SURFACES, 'providers, surfaces and neutrality'],
  ['surface', 'How the model was reached: a metered API or a subscription CLI. The same model over two surfaces is not guaranteed to behave identically, so every receipt records which one it ran on.', SURFACES, 'providers, surfaces and neutrality'],
  ['refusal', 'A published result that reports no verdict, because the run could not stand behind one. A refusal is an outcome and not an error, and publishing it is the alternative to guessing.', RULE, 'the drift verdict rule'],
  ['cell', 'One skill measured on one substrate: the smallest unit a report gives a verdict to. A report is a grid of cells, and a cell that refuses does not sink the ones that did not.', CORE, 'with vs without, sampled, banded'],
  ['arm', 'One side of the comparison: the run WITH the skill, or the baseline run without it. Every case is run in both arms, and the difference between the two arms is the only thing a lift can mean.', CORE, 'with vs without, sampled, banded'],
  ['lattice', 'The four verification levels a receipt can carry: UNVERIFIED, DECLARED, TESTED and FORMAL. A number Driftproof measured itself is TESTED; a number imported from another tool is DECLARED, recorded but not verified, and never given a pass or fail verdict.', FORMAT, 'receipts are an open format'],
  // The two words every report table since 007 uses and this page did not
  // define (spec 025 AC-19). A reader who meets `(legacy)` beside a band had
  // nowhere to look it up.
  ['generation sampling', 'Running each arm more than once, so that a band measures the model writing a different answer and not only the judge re-reading one. A receipt that ran no generation sampling carries a legacy band, and one that ran it carries a generation band.', BANDS, 'where a band comes from'],
  ['band source (legacy, generation)', 'The label a report table puts beside a band, saying which instrument produced it. A legacy band is the judge re-scoring a single generation; a generation band is the across-draw spread of several.', BANDS, 'where a band comes from'],
];

// THE QUOTED RULE IS A SENTENCE, and the template does not add to it (fix pass
// R8). This paragraph used to append a full stop to a value that already carried
// one, so the quoted rule ended in two full stops. The spaced hyphen was not
// this page's either: the value is quoted out of the methodology page, and it is
// fixed there, because a quotation cannot be repaired anywhere but at its source.
function glossaryPage() {
  const V = reader(stats());
  const entries = TERMS.map(([term, body, href, label]) => {
    // A SLUG, not the term with its spaces swapped. "band source (legacy,
    // generation)" produced `term-band-source-(legacy,-generation)`, an id
    // carrying brackets and a comma, which is a fragment nobody can link by hand.
    const id = `term-${term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    return `<dt id="${id}">${term.charAt(0).toUpperCase()}${term.slice(1)}</dt>
<dd>${body} <a href="${esc(href)}">Source: ${esc(label)}</a>.</dd>`;
  }).join('\n');
  const main = `<main class="screens">
<section id="glossary" class="screen">
<h2>Glossary</h2>
<p>${word(TERMS.length).charAt(0).toUpperCase()}${word(TERMS.length).slice(1)} words this site uses in a particular way, two sentences each, every one linking to the section it comes from. The verdict rule, in the methodology's own words: ${esc(V('verdict_rule'))}</p>
<dl class="glossary">
${entries}
</dl>
</section>
</main>`;
  return shell({
    title: 'Glossary | Driftproof',
    description: `${word(TERMS.length).charAt(0).toUpperCase()}${word(TERMS.length).slice(1)} words this site uses in a particular way, two sentences each, every one linking to the section of the methodology or the receipt spec it comes from.`,
    main,
  });
}

function reportTypesPage() {
  const R = reports();
  const TYPES = reportTypes(R);
  const cards = TYPES.map((type) => {
    const [glyph, note] = typeNote(type);
    const ex = typeExample(type, R);
    return `<section class="report-type-card">
<img src="/assets/glyph-${glyph}.svg" alt="" width="96" height="60">
<div>
<h3>${esc(type)}</h3>
<p>${note}</p>
<p>Example: <a href="/reports/${esc(ex.number.value)}/">Report ${esc(ex.number.value)}</a>, ${esc(ex.what_moved.value)}.</p>
</div>
</section>`;
  }).join('\n');
  const main = `<main class="screens">
<section id="types" class="screen is-text">
<h2>The ${word(TYPES.length)} report types</h2>
<p>Driftproof publishes ${word(TYPES.length)} kinds of report. All ${word(TYPES.length)} use the same rule, and they differ in what moves underneath the skill, or, in the value report, in which axes are measured.</p>
${cards}
</section>
</main>`;
  return shell({
    title: 'Report types | Driftproof',
    description: `Driftproof publishes ${word(TYPES.length)} kinds of report. They share one verdict rule and differ in what moves underneath the skill in each.`,
    main,
  });
}

// ── /methodology/, the two regions this loop writes into it ─────────────────
//
// The page is a pre-existing document this loop MOVED and did not rewrite, so it
// is not in TARGETS and is not rendered from scratch. Two fenced regions inside
// it are, on the same terms as every other piece of chrome on this site:
// generated, idempotent, and stripped-and-re-emitted rather than appended.
//
// WHY THE SECTION IS GENERATED AT ALL. Every figure in it is derived from
// receipts and from the Report 006 and 007 pages, and spec 025 AC-16 asserts that
// each one is still findable in the file it cites. A section typed into the page
// would be eight numbers nobody could chase, on the page that explains how this
// instrument measures.
const BANDS_OPEN = '<!--driftproof:bands-->';
const BANDS_CLOSE = '<!--/driftproof:bands-->';
const CHECKS_OPEN = '<!--driftproof:checks-->';
const CHECKS_CLOSE = '<!--/driftproof:checks-->';
const METH = path.join(DOCS, 'methodology', 'index.html');

// THE PROBE THAT MEASURED GENERATION NOISE, found by its evidence rather than by
// its number. A report that carries a `probe-baseline-stability-*.json` under its
// own evidence/ is the report that ran the probe.
function probeReport() {
  const dir = path.join(DOCS, 'reports');
  for (const n of fs.readdirSync(dir).filter((x) => /^\d+$/.test(x)).sort()) {
    const ev = path.join(dir, n, 'evidence');
    if (!fs.existsSync(ev)) continue;
    const f = fs.readdirSync(ev).find((x) => /^probe-baseline-stability-.*\.json$/.test(x));
    if (f) return { n, dir: `docs/reports/${n}/evidence`, file: `docs/reports/${n}/evidence/${f}` };
  }
  throw new Error('no report carries a baseline-stability probe under its own evidence/');
}

// THE BAND-SOURCE LABELS a published report table carries, read structurally: a
// parenthesised token immediately after a band. Not a word list, because a word
// list is a second place for the answer to be.
function bandSourceLabels() {
  const out = new Map();
  const dir = path.join(DOCS, 'reports');
  for (const n of fs.readdirSync(dir).filter((x) => /^\d+$/.test(x)).sort()) {
    const f = path.join(dir, n, 'index.html');
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8');
    for (const t of html.match(/<table[\s\S]*?<\/table>/g) || []) {
      for (const m of chrome.esc && String(t).replace(/<[^>]*>/g, ' ').replace(/&plusmn;|&#177;/g, '±').matchAll(/±\s*[0-9.]+\s*\(([a-z]+)\)/g)) {
        if (!out.has(m[1])) out.set(m[1], n);
      }
    }
  }
  return out;
}

function bandFacts() {
  const cfg = require(path.join(ROOT, 'config.js'));
  const probe = probeReport();
  const probeJson = JSON.parse(fs.readFileSync(path.join(ROOT, probe.file), 'utf8'));
  const rows = probeJson.results || [];
  const draws = [...new Set(rows.map((r) => r.draws_completed))];
  if (draws.length !== 1) throw new Error(`the probe's arms ran different draw counts: ${draws.join(', ')}`);

  // The ratio column of the probe report's own "where the variance lives" table,
  // read off the page rather than recomputed: the page is what a reader checks.
  const page = fs.readFileSync(path.join(DOCS, 'reports', probe.n, 'index.html'), 'utf8');
  const ratios = [...page.matchAll(/<td><strong>([0-9.]+)(?:&times;|×)<\/strong><\/td>/g)].map((m) => m[1]);
  if (ratios.length < 2) throw new Error(`report ${probe.n} no longer states its variance ratios in a table`);

  const labels = bandSourceLabels();
  const firstLabelled = [...labels.values()].sort()[0];
  if (!firstLabelled) throw new Error('no published report table carries a band-source label');
  const labelledPage = `docs/reports/${firstLabelled}/index.html`;
  // Which earlier report the corrected instrument re-measured: the other report
  // number the labelled report's own table headers name.
  const labelledHtml = fs.readFileSync(path.join(ROOT, labelledPage), 'utf8');
  const cited = [...new Set([...labelledHtml.matchAll(/<th>Report (\d+) lift and band<\/th>/g)].map((m) => m[1]))]
    .filter((n) => n !== firstLabelled);
  if (cited.length !== 1) throw new Error(`report ${firstLabelled} names ${cited.length} re-measured reports, not one`);

  return {
    gen_min: { value: cfg.GENERATION_SAMPLES_MIN, from: 'config.js' },
    probe_report: { value: probe.n, from: probe.dir },
    probe_cases: { value: rows.length, from: probe.dir },
    draws_each: { value: draws[0], from: probe.file },
    ratio_a: { value: ratios[0], from: `docs/reports/${probe.n}/index.html` },
    ratio_b: { value: ratios[1], from: `docs/reports/${probe.n}/index.html` },
    first_labelled: { value: firstLabelled, from: labelledPage },
    remeasured: { value: cited[0], from: labelledPage },
    label_legacy: { value: 'legacy', from: labelledPage },
    label_generation: { value: 'generation', from: labelledPage },
  };
}

// THE D5 SHAPE, NOT A CARD (spec 025 A-025-8, approval finding F-1). This
// section used to open a `<div class="card">`, which made this loop the author
// of two of the bare card-class elements AC-10 forbids, on the page it rewrites
// most. A section that explains where a band comes from is a captioned band
// plot - the shape D5 gave the three states on the homepage - drawn from a real
// published cell in the separated state, chosen the way statePlot() chooses.
const heroOf = (rel) => rel.replace(/\.card\.svg$/, '.hero.svg');
function bandsSection() {
  const f = bandFacts();
  const plot = heroOf(statePlot('separated'));
  return `${BANDS_OPEN}<h2 id="where-a-band-comes-from">Where a band comes from</h2>
  <figure class="panel plot-figure is-prose">
    ${chrome.inlinePlot(plot, '', 'Two horizontal ranges from a published cell, one without the skill and one with it, drawn apart with the effect floor marked.')}
    <figcaption>
    <p>Each arm is generated at least ${word(f.gen_min.value)} times, and more until the across-draw spread settles. Each generation is scored by the fixed judge. A band is the mean and the spread of the per-case score across those draws.</p>
    <p>Every report published before Report ${esc(f.first_labelled.value)} used a single generation per arm, judged several times, so its bands measured the judge and not the model. Report ${esc(f.probe_report.value)}'s probe measured generation noise at ${esc(f.ratio_a.value)}&times; and ${esc(f.ratio_b.value)}&times; the judge noise on the ${word(f.probe_cases.value)} cases it probed, ${word(f.draws_each.value)} draws each. Report ${esc(f.first_labelled.value)} re-measured Report ${esc(f.remeasured.value)}'s cells under the corrected instrument. Every table since Report ${esc(f.first_labelled.value)} labels each band's source as ${esc(f.label_legacy.value)} or ${esc(f.label_generation.value)}.</p>
    </figcaption>
  </figure>${BANDS_CLOSE}`;
}

// THE FLOOR BLOCK, IN THE SAME SHAPE. Inserting the section split the verdict-rule
// card in two, and the reopened half was the other bare card this loop added.
// The floor's own words are the page's, untouched; what changes is the object
// they sit in: a captioned plot of a real cell in the overlapping state, where
// the floor marker is the thing to look at. Idempotent: a block already in this
// shape does not match the pattern.
const FLOOR_ALT = 'Two horizontal ranges from a published cell that overlap, with the effect floor marked as a dashed line.';
function floorFigure(html) {
  // A-038-3: a figure already in this shape carries an <img>, which the pattern below does not
  // match; the plot it names is inlined in place, idempotently, so the page takes the site's faces.
  const already = /<figure class="panel plot-figure is-prose" id="effect-floor-figure">\s*<img class="bandplot" src="\/([^"]+)"[^>]*>/;
  if (already.test(html)) return html.replace(already, (_m, rel) => `<figure class="panel plot-figure is-prose" id="effect-floor-figure">\n    ${chrome.inlinePlot(rel, '', FLOOR_ALT)}`);
  // A FIGURE ALREADY INLINED IS RE-INLINED TOO (spec 038 approval F-1). Once A-038-3 had inlined it,
  // neither pattern matched, so the A-038-4 rebuild left the plot file's own title on the page where
  // the <img> alt had been. The plot is drawn again from its file, with the alt as its title.
  const inlined = /(<figure class="panel plot-figure is-prose" id="effect-floor-figure">\s*)<svg\b[\s\S]*?<\/svg>/;
  if (inlined.test(html)) return html.replace(inlined, (_m, open) => `${open}${chrome.inlinePlot(heroOf(statePlot('overlapping')), '', FLOOR_ALT)}`);
  const re = /<div class="card">\s*<ul class="method">\s*(<li><strong>Effect floor\.<\/strong>[\s\S]*?<\/li>)\s*<\/ul>\s*(<p>[\s\S]*?<\/p>)\s*<\/div>/;
  if (!re.test(html)) return html;
  const plot = heroOf(statePlot('overlapping'));
  return html.replace(re, (_m, li, p) => `<figure class="panel plot-figure is-prose" id="effect-floor-figure">
    ${chrome.inlinePlot(plot, '', FLOOR_ALT)}
    <figcaption>
    <ul class="method">
      ${li}
    </ul>
    ${p}
    </figcaption>
  </figure>`);
}

// THE SCHEMA VERSION IS READ, AND THE READING IS GATED ON THE SHAPE IT CITES.
// The paragraph says deterministic checks are recorded as `{ name, kind, pass }`
// and names the version that introduced them. A version typed onto a page goes
// stale silently; a version read out of a document nobody checked goes WRONG
// silently, which is worse. So the row is required to still carry the shape the
// sentence beside it describes, and where it does not, this returns null and the
// citation does not render - the number is never updated to match a document
// that stopped saying what the page says it says.
// `root` is the tree spec/RECEIPT.md is read from. The gate's AC-17 mutation
// plants a RECEIPT.md with the shape removed in a scratch tree and runs THIS
// function and patchMethodology() against it, so the product path is what is
// proved absent, not a helper handed a row string (approval finding F-7).
function checksSchemaVersion(root = ROOT) {
  const src = (fs.readFileSync(path.join(root, 'spec', 'RECEIPT.md'), 'utf8').match(/^\s*\|\s*`checks`\s*\|[^\n]*/m) || [''])[0];
  if (!/\{\s*name,\s*kind,\s*pass\s*\}/.test(src)) return null;
  const m = src.match(/v(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function checksCitation(root = ROOT) {
  const v = checksSchemaVersion(root);
  return `${CHECKS_OPEN}${v === null ? '' : ` (spec v${esc(v)})`}${CHECKS_CLOSE}`;
}

// THE SECOND CITATION, which was typed. The value-per-token paragraph said
// "(skill.tokens, spec v0.3.1)" in plain prose, read by nothing, so under the
// mutation above the derived citation blanked and this one survived - the
// examination measured exactly that. It is derived now from the `tokens` row of
// spec/RECEIPT.md, by the same rule: the row has to still describe the field
// the sentence describes, or the citation does not render.
const TOKENS_OPEN = '<!--driftproof:tokens-cite-->';
const TOKENS_CLOSE = '<!--/driftproof:tokens-cite-->';
function tokensSchemaVersion(root = ROOT) {
  const src = (fs.readFileSync(path.join(root, 'spec', 'RECEIPT.md'), 'utf8').match(/^\s*\|\s*`tokens`\s*\|[^\n]*/m) || [''])[0];
  if (!/token size/i.test(src)) return null;
  const m = src.match(/v(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}
// THE CLOSING PAREN IS INSIDE THE FENCE. A comment marker is a tag to the
// visible-text rule, and a tag becomes a space, so a marker between the version
// and its paren split "v0.3.1)" into "v0.3.1 )" and AC-20 read a copy change.
function tokensCitation(root = ROOT) {
  const v = tokensSchemaVersion(root);
  return `${TOKENS_OPEN}${v === null ? ')' : `, spec v${esc(v)})`}${TOKENS_CLOSE}`;
}

// Idempotent, like every other fenced region on this site: the markers are the
// boundary, so a re-run replaces rather than appends. The section is inserted
// between the band-overlap rule and the effect floor the first time, which is
// where the criterion puts it and which splits the verdict-rule card in two.
function patchMethodology(html, root = ROOT) {
  let out = html;
  if (out.includes(BANDS_OPEN)) {
    out = out.replace(new RegExp(`${BANDS_OPEN}[\\s\\S]*?${BANDS_CLOSE}`), bandsSection());
  } else {
    // BETWEEN THE TWO BULLETS, which is where the criterion puts the section:
    // after the band-overlap rule and before the floor. They sit in one list, so
    // the list and its card are closed here and reopened after, and every
    // existing word keeps its place in the reading order.
    const cut = out.indexOf('      <li><strong>Effect floor.</strong>');
    if (cut < 0) throw new Error('docs/methodology/index.html: the effect-floor bullet is no longer where the section goes');
    out = `${out.slice(0, cut)}    </ul>\n  </div>\n\n  ${bandsSection()}\n\n  <div class="card">\n    <ul class="method">\n${out.slice(cut)}`;
  }
  out = floorFigure(out);
  if (out.includes(CHECKS_OPEN)) {
    out = out.replace(new RegExp(`${CHECKS_OPEN}[\\s\\S]*?${CHECKS_CLOSE}`), checksCitation(root));
  } else {
    const before = '<code>{ name, kind, pass }</code> (spec v0.3.1)';
    if (!out.includes(before)) throw new Error('docs/methodology/index.html: the deterministic-checks citation is no longer where it was');
    out = out.replace(before, `<code>{ name, kind, pass }</code>${checksCitation(root)}`);
  }
  if (out.includes(TOKENS_OPEN)) {
    out = out.replace(new RegExp(`${TOKENS_OPEN}[\\s\\S]*?${TOKENS_CLOSE}`), tokensCitation(root));
  } else {
    const before = '(<code>skill.tokens</code>, spec v0.3.1)';
    if (!out.includes(before)) throw new Error('docs/methodology/index.html: the skill.tokens citation is no longer where it was');
    out = out.replace(before, `(<code>skill.tokens</code>${tokensCitation(root)}`);
  }
  return out;
}

const PATCHES = { 'methodology/index.html': patchMethodology };

// ── How this is built (spec 037 AC-4) ───────────────────────────────────────
// The method in plain prose, with counts and no record contents. Every count is read
// from docs/data/build-facts.json, which scripts/build-facts.mjs takes at one commit of
// the source repository; spec 037's gate counts the records again.
function howBuiltPage() {
  const F = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'build-facts.json'), 'utf8'));
  const n = (k) => `<span data-fact="${k}">${esc(F.facts[k].value)}</span>`;
  const main = `<main class="prose how-built">
<h1>How this is built</h1>
<p>Driftproof is an instrument, so it is built the way it asks skills to be measured: every change is written down before it is made, checked by something that can fail, and reviewed by something that did not write it. This page describes the method. It shows counts read from the source repository's records as of <span data-fact="at_date">${esc(F.at_date)}</span>, and none of the records' contents.</p>

<h2>Criteria before code</h2>
<p>Every change starts as a specification that says what it must do, as numbered acceptance criteria, before any code is written. The records hold ${n('specs')} specifications and ${n('criteria')} acceptance criteria.</p>

<h2>Red before green, and red again under mutation</h2>
<p>A specification carries a gate, a script that checks its criteria. In this method the gate is written first and run while nothing is built, so it reads red, and those red runs are kept: ${n('red_records')} are on record. Once the work passes, the gate is run again against copies with a violation planted in them, and each planted copy has to turn it red. ${n('gates')} specifications carry a gate, and their gate files name a planted mutation on ${n('mutation_lines')} lines.</p>

<h2>An approver that did not build it</h2>
<p>Approval is a separate session. It reads the specification, the gate, the change and the operator's written rules from disk, runs the gate again, and works without the build's context: it receives no account of how the change was made. There are ${n('approvals')} approval records. In ${n('held')} of them the approver rejected the work or recorded blocking findings that held the merge, and ${n('rejected')} are outright rejections.</p>

<h2>Amendments rather than edits</h2>
<p>A published report or a merged specification is amended rather than edited in place: a numbered entry says what changed and why, and the original text stays where it was. The specifications carry ${n('amendments')} amendments numbered in the current format.</p>

<h2>A constitution and a decision log</h2>
<p>A constitution sets the rules every change is checked against, such as no published number without a receipt behind it. Decisions go into an append-only decision log that records what was chosen, what was not, and why; it holds ${n('decisions')} entries.</p>

<h2>Audits from outside, published against the project</h2>
<p>Outside audits of the tool are committed as received, and <a href="/findings/">the findings page</a> publishes what each found, what is fixed and what is still open. ${n('audits')} audit documents are on record.</p>

<p class="muted">The counts are taken by <code>scripts/build-facts.mjs</code> at one commit of the source repository, whose records do not reach the public tree. The rule behind each count is in <a href="/data/build-facts.json"><code>/data/build-facts.json</code></a>.</p>
</main>`;
  return shell({
    title: 'How this is built',
    description: 'How Driftproof is built: criteria before code, gates that fail first, an approver that did not build the change, amendments rather than edits, and audits published against the project.',
    main,
  });
}

const TARGETS = {
  'index.html': homepage,
  'glossary/index.html': glossaryPage,
  'report-types/index.html': reportTypesPage,
  'reports/index.html': reportsIndex,
  'subscribed/index.html': subscribedPage,
  'how-this-is-built/index.html': howBuiltPage,
  '404.html': notFoundPage,
  ...Object.fromEntries(Object.entries(STUBS).map(([slug, label]) => [`${slug}.html`, () => redirectStub(slug, label)])),
};

function main() {
  const check = process.argv.includes('--check');
  if (!check) buildCards();
  const headTags = require('./build-head-tags.js');
  const stale = [];
  // The patched pages first: the head block is derived from the page as it will
  // ship, and the section this writes into methodology changes what that page
  // says about itself.
  for (const [rel, patch] of Object.entries(PATCHES)) {
    const dest = path.join(DOCS, rel);
    const before = fs.readFileSync(dest, 'utf8');
    const out = patch(before);
    if (before === out) continue;
    if (check) { stale.push(rel); continue; }
    fs.writeFileSync(dest, out);
  }
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
module.exports = { shell, heroReceipt, reportCard, statePlot, plotState, subscribedPage, reportTypes, typeNote, word, bandFacts, bandsSection, floorFigure, checksSchemaVersion, tokensSchemaVersion, patchMethodology, PATCHES, homepage, reportsIndex, glossaryPage, reportTypesPage, notFoundPage, redirectStub, STUBS, TERMS, TARGETS, reader, stats, reports, buildCards };
