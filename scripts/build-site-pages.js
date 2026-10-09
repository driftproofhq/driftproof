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
const answers = require('./answer-pages.js');

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

// Spec 133 R-5: 404.html and /subscribed/ are published and not indexed.
const NOINDEX = '<meta name="robots" content="noindex">\n';

function shell({ title, description, main, bodyClass = '', head = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="/style.css">
${head}</head>
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
// verdict two ways. The label is the page's own, pageLabel, which is the cases word where spec 143
// reads the cases disagreeing.
function receiptWords(receipt) {
  const { pageLabel, honestLine } = require('./build-receipt-pages.js');
  const v = require('../lib/verdict.js').receiptVerdict(receipt);
  return { verdict: v.verdict, label: pageLabel(v), honest: honestLine(v) };
}
// Spec 143: the *What a receipt can say* item for the cases kind. Its label and line are the receipt
// page's own (CASES_PAGE, built from lib/verdict.js's CASES_WORD and CASES_LINE), so a reworded
// constant moves this item with every other surface.
function casesItem() {
  const [label, line] = require('./build-receipt-pages.js').CASES_PAGE;
  return `<li><strong>${label}.</strong> ${line} The cases score too far apart from each other for more draws to be expected to bring the comparison band under the floor, and the receipt prints the band with each case's draw-to-draw spread taken out.</li>`;
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
      // THE DRAWING SAID IN WORDS (spec 170), where the card's verdict is the band rule's own
      // separation: a Passing receipt's two ranges are drawn apart above this line.
      ...(verdict === 'PASSED' ? [{ note: 'the two ranges do not overlap: separated' }] : []),
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
  // THE STATS BAND UNDER THE HERO (spec 170): the first three of the strip's figures, the same fields
  // and labels, on the shell's surface. Its own classes, so the strip stays the six spec 025 reads.
  const statBand = [
    ['reports_published', 'reports published'],
    ['receipts_published', 'receipts published'],
    ['substrates_measured', 'models measured on'],
  ].map(([k, label]) => `<p class="stat"><span class="stat-value" data-stat="${k}">${esc(V(k))}</span> <span class="stat-label">${label}</span></p>`).join('\n');

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

<section id="stats" class="screen is-wide">
<div class="stat-band">
${statBand}
</div>
<p class="gap-line">Comparing two benchmark scores? The <a href="/benchmark-gap/">gap calculator</a> says whether the gap is bigger than the benchmark's own sampling noise.</p>
<p class="gap-line">A piece by Maverick: <a href="/leaderboard-noise/">quoted AI benchmark gaps, checked against their own sampling noise</a>.</p>
</section>

<section id="states" class="screen is-text">
<h2>What a receipt can say</h2>
<ul class="states">
<li><strong>Passing.</strong> A case separated upward under the band rule: the two ranges do not overlap and the move clears the effect floor. That is a separation detected under the rule, not proof that the skill moved the score.</li>
<li><strong>Regressed.</strong> A case separated downward under the same rule.</li>
<li><strong>No separation detected.</strong> The ranges overlap at this sample size, which is not evidence that nothing changed.</li>
<li><strong>Not enough draws.</strong> Not enough draws to conclude at this effect floor. The receipt prints how many draws per arm would have been needed, or that no number of draws reaches the floor at the spreads it measured.</li>
${casesItem()}
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
<div class="card playground" data-island="band-playground" data-cases='${esc(caseData).replace(/'/g, '&#39;')}' data-floor="${esc(V('effect_floor'))}">
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
<p>That installs <code>/driftproof:start</code>, <code>/driftproof:init</code>, <code>/driftproof:run</code> and <code>/driftproof:badge</code>. The plugin hands your arguments to the pinned runner and writes the receipt that runner would have written; <code>/driftproof:run</code> spends your Claude Code subscription rather than an API key. It measures and never changes a skill's instructions. The one file it adds is a new <code>evals/evals.json</code>, from <code>/driftproof:start</code> or <code>/driftproof:init</code>, to a skill that has none, after you say yes in the run.</p>
<p>Start with a skill you already have. In Claude Code, from the folder above it, in a git repository, run <code>/driftproof:init path/to/your-skill</code>. Claude reads your <code>SKILL.md</code> and drafts test cases with you, aimed at outcomes you would check. It adds them only after you say yes, labelled as drafted from the skill and approved by you, then runs a quick check and opens a results page: your first receipt. A quick check is a first look and cannot produce a verdict. <code>/driftproof:run</code> on a skill with no test cases offers the same draft. For a new skill, scaffold one with <code>npx driftproof init my-skill</code>, as the next section shows.</p>
<p>Driftproof is tested on Linux and macOS. In an outside retest on macOS the shipped gate failed only in the publishing helper, which needs GNU <code>realpath -m</code>. Windows is untested: from Node's source the plugin would not find <code>npx</code> there, but that failure has never been observed. A CI matrix across Linux, macOS and Windows is planned, and <a href="/findings/">the findings page</a> has the figures.</p>
</section>

<section id="ci" class="screen is-text">
<h2>In CI: npx and the GitHub Action</h2>
<p>You need <code>Node 22</code> or newer and an <code>ANTHROPIC_API_KEY</code>. From a clean checkout to a receipt for a new skill, on the command line:</p>
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
${reportCard(latest, HOME_CARD_STAT, { counts: false })}
<p><a href="/reports/">All <span data-stat="reports_published">${esc(V('reports_published'))}</span> reports</a></p>
<p class="writing">Writing: <a href="/writing/three-releases/">${esc(latest.essay_links[0].title.value)}</a>, the launch essay, revised to read all ${esc(V('reports_published_word'))} reports together on what a moving model does to encoded expertise.</p>
</section>

<section id="subscribe" class="screen is-text">
<h2>Get the next one</h2>
${chrome.SUB_OPEN}${chrome.SUB_CLOSE}
<p>Every report is also in the <a href="/feed.xml">Atom feed</a>.</p>
</section>

<section id="answers" class="screen is-text">
${answers.answerLinks()}
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
    "Asks whether a skill still helps when a newer version of the model underneath it comes out."],
  'Substrate durability report': ['overlapping',
    "Asks whether a skill helps just as much on a different company's model, reached through that company's own command-line tool."],
  'Capability-gap report': ['separated',
    "Asks whether a skill still helps on a stronger model from the same company."],
  'Value report': ['overlapping',
    'Keeps the model the same and asks what a skill costs to run, beside whether it helps.'],
  'Revision drift report': ['refused',
    "Keeps the model and the tools the same and changes only the skill's own text."],
  'Instrument re-measurement report': ['overlapping',
    'Changes neither, and runs again tests an earlier report published, with a corrected way of measuring.'],
  'Instrument comparison report': ['overlapping',
    'Keeps the skills and their tasks the same and measures them with two instruments, two different test tools, saying what each can and cannot show.'],
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
  // A report with no receipts has no plot and so no state (spec 041): the chip carries no
  // state class rather than one that names a band it does not have.
  if (!rel) return null;
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
// THE HOMEPAGE'S LATEST CARD CARRIES NO SUMMARY SENTENCE (spec 039). The sentence is
// the report's own headline, and Report 009's names Claude Code's native plugin eval,
// which spec 037 AC-1 forbids the homepage to name (S-6). The report's text cannot be
// edited to suit the homepage (CONSTITUTION invariant 4), and the heading above the
// line already states what the report is, so on the homepage the line is dropped
// rather than reworded. /reports/ renders it on every card, this one included.
// The fields the homepage's latest card names (spec 020 AC-9), one definition, exported so a
// gate can call reportCard the way the homepage calls it (spec 025 AC-9, A-025-29).
const HOME_CARD_STAT = (k) => ({ number: ' data-stat="latest_report_number"', date: ' data-stat="latest_report_date"', what_moved: ' data-stat="latest_report_what_moved"' })[k] || '';

function reportCard(r, stat = () => '', { counts = true } = {}) {
  const tail = esc(r.what_moved.value);
  const plain = `Report <span${stat('number')}>${esc(r.number.value)}</span>: ${tail}`;
  const moved = plain.endsWith(tail) ? '' : `<p class="card-moved">${tail}</p>\n`;
  // Spec 047: where the caller names a field for the title's tail, the tail is wrapped in it,
  // so a numeral a title carries (Report 011's "Claude Opus 5.5") names the stats.json field it
  // prints, as spec 020 AC-9 requires of every figure the homepage shows.
  const title = stat('what_moved') ? `Report <span${stat('number')}>${esc(r.number.value)}</span>: <span${stat('what_moved')}>${tail}</span>` : plain;
  return `<article class="card report-card" data-report="${esc(r.number.value)}">
<div>
<p class="card-type${r.plot ? ` is-${plotState(r.plot.value)}` : ''}">${esc(r.type.value)}</p>
<h3><a href="/reports/${esc(r.number.value)}/">${title}</a></h3>
${moved}<p class="card-models">${r.model_ids.map((m) => `<code>${esc(m.value)}</code>`).join(' ')}</p>
<p class="card-date"><span${stat('date')}>${esc(r.date.value)}</span></p>
${counts ? `<p class="card-counts">${esc(r.headline_counts.value)}</p>\n` : ''}</div>
${r.plot ? `${chrome.inlinePlot(r.plot.value, 'card-plot', `Band plot for the first cell of Report ${r.number.value}.`)}\n` : ''}</article>`;
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
<div class="split">
<div><h1>Reports</h1></div>
<p>Every report Driftproof has published, newest first. ${esc(V('reports_published'))} reports, ${esc(V('receipts_published'))} receipts, all of them dated and hash-verified.</p>
</div>
${cards}
</section>

<section id="report-types" class="screen">
<div class="types-grid">
<div>
<h2>The ${word(TYPES.length)} report types</h2>
<p>All ${word(TYPES.length)} use the same rule: a verdict is claimed only when the two ranges do not overlap and the move clears the floor. They differ in what moves underneath the skill, or, in the value report, in which axes are measured.</p>
</div>
${types}
</div>
</section>

<section id="writing" class="screen">
<div class="split">
<div><h2>Writing</h2></div>
<p><a href="${esc(essay.href.value)}">${esc(essay.title.value)}</a>: the launch essay, revised to read all ${esc(V('reports_published_word'))} reports together on what a moving model does to encoded expertise, and on what a corrected instrument did to three published results.</p>
</div>
</section>

<section id="answers" class="screen">
${answers.answerSplit()}
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
    // NOT INDEXED (spec 133 R-5): the page a form returns to is not a page a search result should
    // show, so it carries noindex and the sitemap leaves it out.
    head: NOINDEX,
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
    head: NOINDEX,
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
    // ONE CELL PER TERM (spec 125 A-125-9): the list takes two columns on a wide track, and a <div>
    // around each pair is what lets a term and its definition share one cell.
    return `<div><dt id="${id}">${term.charAt(0).toUpperCase()}${term.slice(1)}</dt>
<dd>${body} <a href="${esc(href)}">Source: ${esc(label)}</a>.</dd></div>`;
  }).join('\n');
  const main = `<main class="screens">
<section id="glossary" class="screen">
<div class="split">
<div><h1>Glossary</h1></div>
<p>${word(TERMS.length).charAt(0).toUpperCase()}${word(TERMS.length).slice(1)} words this site uses in a particular way, two sentences each, every one linking to the section it comes from. The verdict rule, in the methodology's own words: ${esc(V('verdict_rule'))}</p>
</div>
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
<h3><dfn>${esc(type)}</dfn></h3>
<p>${note}</p>
<p>Example: <a href="/reports/${esc(ex.number.value)}/">Report ${esc(ex.number.value)}</a>, <cite>${esc(ex.what_moved.value)}</cite>${/[.?!]$/.test(ex.what_moved.value) ? '' : '.'}</p>
</div>
</section>`;
  }).join('\n');
  const main = `<main class="screens">
<section id="types" class="screen is-text">
<h1>The ${word(TYPES.length)} report types</h1>
<p>Driftproof publishes ${word(TYPES.length)} kinds of report. Where one compares a model with the skill and without it, it calls a change the same way. They differ in what changes underneath the skill; the value report also counts what a skill costs, and the instrument comparison compares the test tools themselves, so its example has no run without the skill. Each type's name, and each example's title, is the report's own.</p>
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

// ── docs/interop.md: the receipt version it names (spec 004 A-004-3) ────────
// The guide's contract sentence named the receipt spec version as typed text, and
// it stayed at the version of the day it was written while the schema moved on.
// The version is now read from spec/receipt.schema.json, the schema_version const
// the served schema carries, and written into that sentence on every build. The
// sentence is the anchor: where it is gone, the build fails rather than leaving a
// version nobody wrote.
const INTEROP_CONTRACT = /\(JSON Schema draft 2020-12, spec v\d+(?:\.\d+)+\)/;
function receiptSchemaVersion(root = ROOT) {
  const s = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'receipt.schema.json'), 'utf8'));
  const v = s && s.properties && s.properties.schema_version && s.properties.schema_version.const;
  if (typeof v !== 'string' || !/^\d+(?:\.\d+)+$/.test(v)) throw new Error('spec/receipt.schema.json: no schema_version const to cite');
  return v;
}
function patchInteropMd(md, root = ROOT) {
  if (!INTEROP_CONTRACT.test(md)) throw new Error('docs/interop.md: the contract sentence that names the receipt spec version is no longer there');
  return md.replace(INTEROP_CONTRACT, `(JSON Schema draft 2020-12, spec v${receiptSchemaVersion(root)})`);
}

const PATCHES = { 'methodology/index.html': patchMethodology, 'interop.md': patchInteropMd };

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
<p>Fixes also go the other way, to the skills this project measures: in <code>addyosmani/agent-skills</code>, two merged pull requests, <a href="https://github.com/addyosmani/agent-skills/pull/576">binding grader results to their declared expectations</a> and <a href="https://github.com/addyosmani/agent-skills/pull/578">a hook that rewrote a file on disk</a>, and one issue, <a href="https://github.com/addyosmani/agent-skills/issues/569">an injection that ran on every session start</a>.</p>

<p class="muted">The counts are taken by <code>scripts/build-facts.mjs</code> at one commit of the source repository, whose records do not reach the public tree. The rule behind each count is in <a href="/data/build-facts.json"><code>/data/build-facts.json</code></a>.</p>
</main>`;
  return shell({
    title: 'How this is built',
    description: 'How Driftproof is built: criteria before code, gates that fail first, an approver that did not build the change, amendments rather than edits, and audits published against the project.',
    main,
  });
}

// ── /maintainer/ (spec 169) ─────────────────────────────────────────────────
// Who maintains Driftproof, in issue 60's words as the operator approved them on 8 Oct 2026. The
// paper's title, its concept DOI and its record are read from docs/data/paper.json; the releases and
// pull requests from scripts/answer-pages.js's UPSTREAM_CREDITS, the list /what-is-driftproof/ also
// renders. The Person node in the head is scripts/build-head-tags.js's.
function maintainerPage() {
  const P = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'paper.json'), 'utf8'));
  const me = answers.MAINTAINER_PROFILE;
  const a = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
  const rows = answers.UPSTREAM_CREDITS.map((c) => `<tr><td>${esc(c.project)}</td><td>${a(c.release_url, c.release)}</td><td>${c.pulls.map((n) => (c.linked ? a(answers.pullUrl(c.repo, n), `#${n}`) : `#${n}`)).join(', ')}</td></tr>`).join('\n');
  const main = `<main class="prose maintainer">
<h1>Maintainer</h1>
<p class="lede">Driftproof is maintained by Maverick (${a(me, 'mavericksea-ai')} on GitHub), who also writes its reports and the paper, and does the upstream research on other evaluation tools. Maverick works under this name. Contact: <a href="mailto:hello@driftproofhq.com">hello@driftproofhq.com</a>.</p>

<h2 id="research">Research</h2>
<ul>
<li>Paper: ${a('/paper/', P.title)} (preprint, Zenodo, ${a(P.concept_doi_url, P.concept_doi_url.replace(/^https:\/\//, ''))}), written by ${a(me, 'Maverick')} and published under the project name ${esc(P.author)}.</li>
<li>${a('/reports/', 'Reports')}: dated measurements of whether agent skills still help after each model release.</li>
</ul>

<h2 id="merged-upstream">Merged upstream, credited in release notes</h2>
<table>
<thead>
<tr><th scope="col">Project</th><th scope="col">Release</th><th scope="col">PRs</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
<p>Open and in review: ${a('https://github.com/pulls?q=is%3Apr+author%3Amavericksea-ai', 'all pull requests by mavericksea-ai')}.</p>

<h2 id="how-the-upstream-work-is-done">How the upstream work is done</h2>
<p>Findings come from reading a tool's scoring code and reproducing the defect, sometimes starting from an outside audit. They are not Driftproof runs, and the project does not claim them as such. Every issue filed on another project ends with a line saying the author maintains Driftproof.</p>

<p><strong>Elsewhere:</strong> ${a(me, 'GitHub')} · ${a('https://dev.to/driftproofhq', 'DEV')} · ${a('https://www.npmjs.com/package/driftproof', 'npm')} · ${a(P.record_url, 'Zenodo')}</p>
</main>`;
  return shell({
    title: 'Maintainer: Maverick (mavericksea-ai)',
    description: 'Driftproof is maintained by Maverick (mavericksea-ai on GitHub), who also writes its reports and the paper.',
    main,
  });
}

// ── /paper/ (spec 127) ──────────────────────────────────────────────────────
// The paper "Reported, Not Measured", as its Zenodo record publishes it. The PDF is
// Zenodo's: the site serves no copy (spec 127 A-127-5). Every fact
// is read from docs/data/paper.json, which specs/127-paper-page-and-citation's
// recorder writes from the project's own record and the Zenodo record: nothing here is typed
// but the labels, and spec 127 § Page labels lists each one for the approval to read
// against the paper. The abstract is the record's HTML as sent. The first paragraph
// is the title, so the head builder's description is a fact and never a shortened
// abstract (spec 127 AC-11, spec 020 AC-14).
// THE PAPER'S STATUS NOTE (spec 169, issue 60): what moved upstream since the paper's counts of 30
// September, dated, in the issue's words as the operator approved them on 8 Oct 2026. It is the one
// part of the page that is not a fact or a label of the paper, and spec 169's gate holds its words;
// the paper's text, its counts and its data files do not move, and the rest of <main> is spec 127's. The MLflow and Agent Skills links are
// answer-pages.js's credits, the list /what-is-driftproof/ and /maintainer/ render.
function paperStatus() {
  const [mlflow, , skills] = answers.UPSTREAM_CREDITS;
  const a = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
  return `<section class="paper-status" id="since-publication">
<h2 id="paper-status">Since publication (updated 8 October 2026)</h2>
<p>The paper reports upstream status as of 30 September 2026: of the thirteen counted defects, five fixes were merged and one more was approved. Since then:</p>
<ul>
<li><strong>MLflow, relative change with a negative baseline</strong> (Appendix A.1, row 14): merged on 6 October as ${a(answers.pullUrl(mlflow.repo, 26252), '#26252')} and shipped in ${a(mlflow.release_url, `${mlflow.project} ${mlflow.release}`)}. Six of the thirteen are now merged.</li>
<li><strong>Agent Skills floor-guard follow-up</strong> (row 5, listed but not counted): merged as ${a(answers.pullUrl(skills.repo, 614), '#614')} and shipped in Agent Skills 0.6.12.</li>
<li><strong>alibaba/skill-up</strong> (not in the paper): a failed expect pre-check shrinks the benchmark denominator, so a placeholder answer can outscore a judged one. Reported on ${a('https://github.com/alibaba/skill-up/issues/246#issuecomment-6050718340', '#246')}; the maintainers opened ${a('https://github.com/alibaba/skill-up/issues/300', '#300')} to fix it.</li>
</ul>
<p>The other open fixes are unchanged. This note will be updated as they move; the paper's own numbers will change only in a new version.</p>
</section>`;
}

function paperPage() {
  const P = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'paper.json'), 'utf8'));
  const a = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
  const scholar = [
    ['citation_title', P.title],
    ['citation_author', P.author],
    ['citation_publication_date', P.scholar.date],
    ['citation_doi', P.doi],
    ['citation_pdf_url', P.scholar.pdf_url],
    ['citation_abstract_html_url', P.scholar.abstract_html_url],
  ].map(([k, v]) => `<meta name="${k}" content="${esc(v)}">\n`).join('');
  const main = `<main class="prose">
<h1>Paper</h1>
<p class="lede">${esc(P.title)}</p>
<p>${esc(P.author)}<br>${esc(P.version_line)}<br>${esc(P.preprint_line)}</p>

${answers.paperQuestion()}

<h2 id="paper-abstract">Abstract</h2>
<div id="abstract">
${P.abstract_html}
</div>

<h2 id="paper-read">Read the paper</h2>
<dl>
<dt>The Zenodo record</dt><dd>${a(P.record_url, P.record_url)}</dd>
<dt>The PDF on Zenodo</dt><dd>${a(P.pdf_url, P.pdf_name)}</dd>
<dt>DOI for this version</dt><dd>${a(P.doi_url, P.doi)}</dd>
<dt>DOI for all versions</dt><dd>${a(P.concept_doi_url, P.concept_doi)}</dd>
<dt>Licence</dt><dd>CC BY 4.0</dd>
</dl>

${paperStatus()}

<h2 id="paper-data">Data</h2>
<dl>
<dt>The paper's Appendix A.1 as data</dt>
${P.data.map((d) => `<dd>${a(d.url, d.name)}</dd>`).join('\n')}
</dl>

<h2 id="paper-cite">Cite</h2>
<h3>Plain text</h3>
<p id="cite-plain">${esc(P.citation)}</p>
<h3>BibTeX</h3>
<pre id="cite-bibtex">${esc(P.bibtex)}</pre>
</main>`;
  return shell({ title: `${P.title} | Driftproof`, description: P.title, main, head: scholar });
}

// ── the answer pages (spec 135) ─────────────────────────────────────────────────────────
// Rendered by scripts/answer-pages.js from docs/data/answers.json and docs/data/research.json;
// this file gives them the shell. The description the shell carries is replaced by the head
// builder's, derived from the page's first paragraph, as on every other page.
const answerPage = (render) => () => {
  const { title, main } = render();
  return shell({ title, description: title, main });
};

// ── /benchmark-gap/ (spec 167) ──────────────────────────────────────────────────────────────
// The companion calculator to the leaderboard-noise write-up (R-9): a reader types two scores and a
// question count and sees whether the gap clears the benchmark's own sampling noise, by the same
// frozen formula (docs/benchmark-gap/gap.js). Runs entirely in the browser; this file writes only the
// markup and the preset table, never a figure the calculator itself computes.
const BENCHMARK_GAP_PRESETS = [
  ['SWE-bench Verified', 500, 'https://www.swebench.com/'],
  ['SWE-bench Pro V2 Full', 642, 'https://scale.com/leaderboard/swe_bench_pro_public_v2'],
  ['SWE-bench Lite', 300, 'https://www.swebench.com/'],
  ['SWE-bench Multilingual', 300, 'https://www.swebench.com/'],
  ['SWE-bench Multimodal', 517, 'https://www.swebench.com/'],
  ['SWE-bench Full', 2294, 'https://www.swebench.com/'],
  ['Terminal-Bench 4.0', 66, 'https://www.tbench.ai/'],
  ['Terminal-Bench-Science 0.1', 70, 'https://www.tbench.ai/'],
  ['Aider polyglot', 225, 'https://aider.chat/docs/leaderboards/'],
  ['GPQA Diamond', 198, 'https://arxiv.org/abs/2311.12022'],
  ['AIME 2025', 30, 'https://matharena.ai/'],
  ["Humanity's Last Exam", 2500, 'https://lastexam.ai/'],
  ['MMLU-Pro', 12032, 'https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro'],
  ['Chartography', 100, 'https://www.tbench.ai/'],
  ['DeepSWE v1.1', 113, 'https://github.com/agentica-project/deepswe'],
  ['RiemannBench', 25, 'https://github.com/epoch-research/riemannbench'],
];
// THREE PRESETS, AT THE EDGE OF NOISE (spec 170): a small, a middling and a large benchmark from the
// table above, each with the smallest lead the frozen rule calls separated at its N, read from gap.js
// at build. Each card's button loads the rule's own boundary pair, B = floor((N - k) / 2) and A = B + k,
// as percentages rounded outward, so the calculator computes the same reading. A button and not a link:
// a link with a query string is an internal href that spec 020 AC-37 and spec 125 AC-12 resolve as a
// file, and there is none.
const BENCHMARK_GAP_FAMOUS = ['AIME 2025', 'SWE-bench Verified', 'MMLU-Pro'];
function famousGapCards() {
  const CALC = require('../docs/benchmark-gap/gap.js');
  const pc = (x) => (x * 100).toFixed(1);
  return BENCHMARK_GAP_FAMOUS.map((label) => {
    const [, n, source] = BENCHMARK_GAP_PRESETS.find(([l]) => l === label);
    const k = CALC.minimumGapQuestions(n);
    const B = Math.floor((n - k) / 2);
    const a = (Math.ceil(((B + k) / n) * 10000) / 100).toFixed(2);
    const b = (Math.floor((B / n) * 10000) / 100).toFixed(2);
    const [lo, hi] = CALC.newcombeDiff(Number(a) / 100, n, Number(b) / 100, n);
    if (CALC.verdictOf(lo, hi) !== CALC.SEPARATED) throw new Error(`${label}: the rounded boundary pair does not read separated`);
    return `<article class="gap-famous">
<h3>${esc(label)}</h3>
<p><code>${n}</code> questions (<a href="${esc(source)}">source</a>). A lead needs at least <code>${k}</code> questions, <code>${pc(k / n)}</code> points, before it clears this benchmark's sampling noise.</p>
<p><button type="button" class="gap-load" data-a="${a}" data-b="${b}" data-n="${n}">Load ${a}% vs ${b}%</button></p>
</article>`;
  }).join('\n');
}
// THE PAGE OPENS WITH AN EXAMPLE ALREADY COMPUTED (spec 170): a preset and two scores, written into the
// fields and rendered into the result by gap.js's own CALC.render at build. The island
// (docs/islands/benchmark-gap.js) renders with the same function, so it has nothing to change on mount
// and the first paint is the final one; a query string replaces the example.
//
// PLAIN WORDS ABOVE THE FOLD (spec 174, issue 63): one explainer line, the preset, the two scores and a
// "Check the gap" button; the question count fills itself from the preset and shows only for a custom
// benchmark. The result is the plain verdict. Everything else the page says is still on it, behind one
// "Show the statistics" expander, a native <details>, closed, its content in the page: the result card
// with the stamp, the plot and the interval numbers, the preset cards, the assumptions, the method and
// the sources. Spec 174 AC-2 reads the copy outside it for the statistics words.
const BENCHMARK_GAP_EXAMPLE = { preset: 'SWE-bench Verified', a: '72', b: '70' };
function benchmarkGapPage() {
  const CALC = require('../docs/benchmark-gap/gap.js');
  const ex = { ...BENCHMARK_GAP_EXAMPLE, n: String(BENCHMARK_GAP_PRESETS.find(([l]) => l === BENCHMARK_GAP_EXAMPLE.preset)[1]) };
  const options = BENCHMARK_GAP_PRESETS.map(([label, n, source]) => `<option value="${n}" title="N = ${n}, source: ${esc(source)}"${label === ex.preset ? ' selected' : ''}>${esc(label)} (${n})</option>`).join('\n');
  const sources = BENCHMARK_GAP_PRESETS.map(([label, n, source]) => `<li>${esc(label)}: N = ${n}. <a href="${esc(source)}">${esc(source)}</a></li>`).join('\n');
  const field = (id, label, attrs) => `<div class="gap-field"><label for="${id}">${label}</label>\n<input id="${id}" ${attrs}></div>`;
  const check = (id) => `<p class="gap-actions"><button type="button" class="gap-check" id="${id}">Check the gap</button></p>`;
  const main = `<main class="calc">
<h1>Benchmark gap calculator</h1>
<p class="lede">Pick a benchmark and type two scores to see whether the gap clears the benchmark's own noise, or could come down to luck in which questions were asked.</p>
<p class="gap-how"><a href="#how-this-works">How this works</a></p>

<div class="gap-tool">
<div class="gap-tabs" role="tablist" aria-label="Calculator mode">
<button type="button" class="gap-tab" role="tab" id="gap-tab-items" aria-controls="gap-panel-items" data-tab="items" aria-selected="true">I have two scores</button>
<button type="button" class="gap-tab" role="tab" id="gap-tab-runs" aria-controls="gap-panel-runs" data-tab="runs" aria-selected="false" tabindex="-1">I ran it more than once</button>
</div>

<section id="gap-panel-items" class="gap-panel" role="tabpanel" aria-labelledby="gap-tab-items">
<div class="gap-inputs">
<h3>Two scores (item noise)</h3>
<div class="gap-fields">
<div class="gap-field is-wide"><label for="gap-preset">Benchmark</label>
<select id="gap-preset">${options}
<option value="custom">Custom: type the number of questions</option>
</select></div>
${field('gap-score-a', 'Score A (%)', `type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${ex.a}"`)}
${field('gap-score-b', 'Score B (%)', `type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${ex.b}"`)}
<div class="gap-field is-wide" id="gap-n-field" hidden><label for="gap-n">Number of benchmark questions</label>
<input id="gap-n" type="number" min="1" step="1" inputmode="numeric" value="${ex.n}"></div>
</div>
${check('gap-items-check')}
</div>
<div id="gap-items-out" class="gap-out" aria-live="polite" data-island="benchmark-gap">${CALC.render.items(ex.a, ex.b, ex.n)}</div>
</section>

<section id="gap-panel-runs" class="gap-panel" role="tabpanel" aria-labelledby="gap-tab-runs" hidden>
<div class="gap-inputs">
<h3>Repeated runs (Driftproof's band rule)</h3>
<p>For each side: its average score, how far its runs usually sit from that average, and how many runs it had.</p>
<div class="gap-fields">
${field('gap-runs-a-mean', 'A: average score (%)', 'type="number" step="any"')}
${field('gap-runs-a-sd', 'A: spread between runs (points)', 'type="number" step="any" min="0"')}
${field('gap-runs-a-n', 'A: number of runs', 'type="number" step="1" min="0"')}
${field('gap-runs-b-mean', 'B: average score (%)', 'type="number" step="any"')}
${field('gap-runs-b-sd', 'B: spread between runs (points)', 'type="number" step="any" min="0"')}
${field('gap-runs-b-n', 'B: number of runs', 'type="number" step="1" min="0"')}
</div>
${check('gap-runs-check')}
</div>
<div id="gap-runs-out" class="gap-out" aria-live="polite"></div>
</section>

<p class="gap-copy"><button type="button" id="gap-copy-link">Copy link</button></p>
</div>

<details class="gap-stats">
<summary>Show the statistics</summary>
<div id="gap-items-stats" class="gap-out">${CALC.render.itemsStats(ex.a, ex.b, ex.n)}</div>
<div id="gap-runs-stats" class="gap-out" hidden></div>

<h2 id="gap-presets">Three presets, at the edge of noise</h2>
<div class="gap-famous-list">
${famousGapCards()}
</div>

<h2>What this does not tell you</h2>
<ul>
<li>Item noise is not run noise: the two tabs answer different questions and use different rules.</li>
<li>No separation detected is not equal ability: it means this sample size could not tell them apart.</li>
<li>Both intervals assume independent questions.</li>
</ul>

<h2 id="how-this-works">How this works</h2>
<p>Method frozen 7 Oct 2026: Wilson 95% intervals and Newcombe's hybrid difference, written out in <a href="/benchmark-gap/gap.js">gap.js</a>; the verdict words are the <a href="/methodology/">methodology page</a>'s.</p>
<p>Mean and standard deviation in percent, and the run count, per arm. This is the rule the published reports use: bands that do not overlap read separated. <a href="/methodology/">Methodology</a>.</p>
<p>On the runs tab, the spread between runs is one standard deviation, in points.</p>
${NOISE_PIECE_LINE}

<h2>Presets and their sources</h2>
<ul class="gap-sources">
${sources}
</ul>

<p>Method per the Driftproof paper (<a href="https://driftproofhq.com/paper">driftproofhq.com/paper</a>): the band rule and the verdict words.</p>
</details>
</main>`;
  return shell({
    title: 'Benchmark gap calculator | Driftproof',
    description: "Type two benchmark scores and the number of questions, and see whether the gap clears the benchmark's own sampling noise, by Wilson and Newcombe intervals.",
    main,
  });
}

// ── /leaderboard-noise/ (spec 171) ───────────────────────────────────────────────────────────────
// Maverick's piece on quoted benchmark gaps, in issue 51's words as he approved them on 8 Oct 2026: a
// code-and-data analysis crediting the Driftproof paper's method, not a Driftproof run, so the page
// carries no receipt, badge, stamp or report number. The words sit on the desk; the figure and the two
// tables are evidence on paper, in classes docs/tokens.css already paints. Every figure in them is read
// from docs/data/leaderboard-noise.json, which cites the frozen FINDINGS; the text's own numbers are
// his and are spec 171's to hold.
const NOISE_PIECE_LINE = '<p class="gap-piece">Piece: <a href="/leaderboard-noise/">AI benchmark gaps vs sampling noise</a>, by Maverick, applies this method to the gaps quoted in launch posts and on public leaderboards.</p>';
const NOISE_REPO = 'https://github.com/driftproofhq/ranknoise';
const NOISE_SCORE_TYPES = 'https://github.com/driftproofhq/ranknoise/blob/main/method/SCORE_TYPES.md';
const NOISE_GAP_RULE = 'https://github.com/driftproofhq/ranknoise/blob/main/src/core.js#L12';
const noiseData = () => JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'leaderboard-noise.json'), 'utf8'));

// THE FIGURE, IN THE REPORT CHARTS' INK (spec 171 AC-5): one group per post, a filled bar for its
// separated comparisons, a hollow one for those not separated and a dashed one for those not checkable
// (A-171-2), on one scale, each labelled with its count. A post
// with none says so in words. No axis ticks: every numeral drawn is a count the data file carries.
function noiseFigure(D) {
  const W = 380; const x0 = 8; const x1 = W - 36; const top = 44; const nameH = 24; const rowH = 22; const gapP = 12; const barH = 14;
  const max = Math.max(...D.posts.flatMap((p) => [p.separated, p.comparisons - p.separated - p.not_checkable, p.not_checkable]));
  if (!(max > 0)) throw new Error('docs/data/leaderboard-noise.json: no post has a comparison to draw');
  const unit = (x1 - x0) / max;
  const groups = []; let y = top;
  for (const p of D.posts) {
    if (p.separated + p.not_checkable > p.comparisons) throw new Error(`docs/data/leaderboard-noise.json: ${p.id} has more separated and not checkable than comparisons`);
    const g = [`<text class="model" x="0" y="${y + nameH - 6}">${esc(`${p.id} ${p.label}, ${p.date}`)}</text>`];
    y += nameH;
    const rows = [['with', p.separated], ['without', p.comparisons - p.separated - p.not_checkable], ['unchecked', p.not_checkable]].filter(([, n]) => n > 0);
    if (!rows.length) { g.push(`<text class="tick" x="${x0}" y="${y + 16}">0 comparisons</text>`); y += rowH; }
    for (const [cls, n] of rows) {
      const w = (n * unit).toFixed(1);
      g.push(`<rect class="${cls}" x="${x0}" y="${y + 3}" width="${w}" height="${barH}"/><text class="tick" x="${(x0 + n * unit + 6).toFixed(1)}" y="${y + 16}">${n}</text>`);
      y += rowH;
    }
    groups.push(`<g class="post" data-post="${esc(p.id)}">${g.join('')}</g>`);
    y += gapP;
  }
  const H = y - gapP + 8;
  const key = '<g class="key"><rect class="with" x="0" y="8" width="16" height="14"/><text class="tick" x="22" y="20">separated</text><rect class="without" x="118" y="8" width="16" height="14"/><text class="tick" x="140" y="20">not separated</text><rect class="unchecked" x="250" y="8" width="16" height="14"/><text class="tick" x="272" y="20">not checkable</text></g>';
  return `<svg class="chart-panel" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="noise-figure-title"><title id="noise-figure-title">Headline comparisons in each launch post: separated, not separated and not checkable</title>${key}${groups.join('')}</svg>`;
}

function leaderboardNoisePage() {
  const D = noiseData();
  const T = D.totals;
  const repo = (text) => `<a href="${NOISE_REPO}">${text}</a>`;
  const rows = (rs) => rs.map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('\n');
  const head = (hs) => `<thead><tr>${hs.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>`;
  // A bare <table>: the chrome wraps each one in its paper .table-wrap (site-chrome.js).
  const perPost = `<table>
${head(['Post', 'Date', 'Headline comparisons', 'Separated', 'Not checkable'])}
<tbody>
${rows([...D.posts.map((p) => [`${p.id} ${p.label}`, p.date, p.comparisons, p.separated, p.not_checkable]), [`All ${word(D.posts.length)} posts`, '', T.headline.comparisons, T.headline.separated, T.headline.not_checkable]])}
</tbody>
</table>
<p class="caption">Each launch post's headline comparisons, from the frozen FINDINGS read with the 8 October score-type audit.</p>`;
  const minGap = `<table>
${head(['Benchmark', 'Items', 'Smallest gap that clears the noise', 'In points'])}
<tbody>
${rows(D.minimum_gap.map((g) => [g.benchmark, g.of, g.question_count_allowed === false ? 'points only' : g.questions, `${g.points} pp`]))}
</tbody>
</table>
<p class="caption">The smallest gap that clears each benchmark's own sampling noise, from the frozen FINDINGS. Terminal-Bench 4.0 and Aider polyglot scores are not one run over their items (Terminal-Bench averages repeated trials per task; Aider allows a second repair attempt), so their gap is given in points only, by the repo's <a href="${NOISE_GAP_RULE}">gap rule</a>.</p>`;
  const figure = `<div class="chart-panels">
<figure class="chart-cell">
${noiseFigure(D)}
<figcaption class="caption">Headline comparisons in each launch post. Filled bars are separated, hollow bars are not, dashed bars are not checkable, and each bar is labelled with its count. P2 and P4 have zero comparisons. From the frozen FINDINGS read with the 8 October score-type audit; the detailed charts are in the data repository.</figcaption>
</figure>
</div>`;
  const lede = "Six frontier launch posts and nine public leaderboards, every quoted gap tested against the benchmark's own sampling noise, with a method frozen before the data was collected. Most gaps don't clear it. For 28 of them, the published data isn't even enough to check.";
  const main = `<main class="prose noise">
<h1>We checked 162 quoted AI benchmark gaps against their own noise. 20 hold up.</h1>
<p class="muted">Counts use <a href="${NOISE_SCORE_TYPES}">each benchmark's own published intervals</a> where they exist; where none exists, the gap is marked as not checkable.</p>
<p class="lede">${lede}</p>
<p class="byline muted">Written by <a href="/maintainer/">Maverick</a>.</p>

<h2>The scoreboard problem in one example</h2>
<p>On SWE-bench Multilingual, the top two models score 72.7% and 66.3%. That looks decisive. It is a gap on 300 tasks, and this benchmark needs about 24 tasks of daylight before a gap at this size clears its own sampling noise. Six positions on that leaderboard sit inside the noise of first place.</p>

<h2>What we did</h2>
<p>We took the six most recent frontier launch announcements (Anthropic, OpenAI, Google and Mistral, September 22 to October 6) and nine public leaderboard views (SWE-bench's six, Terminal-Bench, Aider polyglot, SWE-bench Pro V2). We extracted every eligible head-to-head gap: 44 from the launch posts, 118 adjacent pairs from the leaderboards, 162 in all. Then we asked one question per gap: is it bigger than the sampling noise of the benchmark it comes from? The method (Wilson 95% intervals, Newcombe difference, a paired check where per-task results exist) was frozen before any data was read, and every number, source and hash is in the ${repo('open repo')}.</p>
${figure}
${perPost}

<h2>Finding one: most quoted gaps don't clear the noise</h2>
<p>Of the 44 launch-post gaps, 11 clear it, 5 don't and 28 can't be checked. Of the 118 leaderboard pairs, 9 clear it and 109 don't. Only 14 pairs anywhere had published per-task results allowing the stronger paired test; one clears it. Small benchmarks are the worst: Terminal-Bench has 66 tasks, so on the simple reading two models need to be about 18 points apart, and 25 of its 27 quoted gaps are smaller than that. Read with its own published intervals where they match, 4 of the 27 separate, 15 don't and 8 can't be checked.</p>
${minGap}

<h2>Finding two: for most comparisons, you can't even check</h2>
<p>This is the result we didn't expect. Many published scores are not one run over N questions; they're averages over repeated runs, with the repeat counts often unstated and harness, tools and effort settings differing between the two sides. For 483 of the 617 comparisons we examined (including an appendix of effort-curve contrasts), the published data does not support an honest repeat-aware interval at all. We withdraw those as claims rather than guessing, and 175 of them had looked separated under the simple reading. The replication crisis question for AI benchmarks is not whether the gap is significant. It is whether anyone published enough for the question to be answerable.</p>

<h2>Finding three: when sources do publish error bars, verdicts move in both directions</h2>
<p>Terminal-Bench publishes real 95% intervals. Using them, first place does separate from positions 3 through 15; second place is the only one the test can't tell apart from first. Four gaps that looked unresolved under the simple reading become separated under the source's own bars.* Error bars are not a pedantic garnish; they change the reading both ways.</p>
<p class="muted">* One of the four, on Chartography, uses an interval read off Chartography's published graphs, not stated numbers.</p>
<p>Also worth knowing: GPQA Diamond, AIME 2025 and MMLU-Pro, until recently fixtures of every launch post, appear in none of the six. And one result that looked clearly separated compares a lab-run score against a competitor's self-reported one; it is now marked not checkable.</p>

<h2>Check any gap yourself</h2>
<p>The <a href="/benchmark-gap/">gap calculator</a> takes two scores and an N and gives the verdict in questions, not percentage points. The data, method, archived-source hashes and every one of the 617 rows are in the ${repo('repo')}. None of this says two models are equal; no separation detected means this benchmark, at this size, with this data, cannot tell.</p>
<p>Method per the <a href="/paper/">Driftproof paper</a>. A gap you can't distinguish from noise is not a lead; it's a coin flip with a press release.</p>
</main>`;
  return shell({
    title: 'AI benchmark gaps vs noise: 20 of 162 hold up | Driftproof',
    description: lede,
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
  'maintainer/index.html': maintainerPage,
  'paper/index.html': paperPage,
  'what-is-driftproof/index.html': answerPage(answers.whatIsPage),
  'agent-skill-evaluation/index.html': answerPage(() => answers.questionPage('agent-skill-evaluation')),
  'agent-skill-regression-testing/index.html': answerPage(() => answers.questionPage('agent-skill-regression-testing')),
  'compare/index.html': answerPage(answers.comparePage),
  'benchmark-gap/index.html': benchmarkGapPage,
  'leaderboard-noise/index.html': leaderboardNoisePage,
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
module.exports = { BENCHMARK_GAP_PRESETS, BENCHMARK_GAP_FAMOUS, paperPage, maintainerPage, shell, heroReceipt, receiptWords, casesItem, reportCard, HOME_CARD_STAT, statePlot, plotState, subscribedPage, reportTypes, typeNote, word, bandFacts, bandsSection, floorFigure, checksSchemaVersion, tokensSchemaVersion, patchMethodology, receiptSchemaVersion, patchInteropMd, PATCHES, homepage, reportsIndex, glossaryPage, reportTypesPage, notFoundPage, redirectStub, STUBS, TERMS, TARGETS, reader, stats, reports, buildCards };
