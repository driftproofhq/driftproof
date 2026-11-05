#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/glossary-terms.js - the glossary's entries, and the plain-word cards built from them (spec 689).
//
// ONE SOURCE. Every entry below is rendered twice: as the glossary page (scripts/build-site-pages.js
// glossaryPage) and as the card a reader opens on the first use of the entry's word on any other page. Both
// read `plain`, so the glossary and the cards cannot disagree. A card never says anything of its own.
//
// THE CARDS ARE CHROME. applyTerms runs inside scripts/site-chrome.js applyChrome, the step every page
// builder reaches through scripts/build-head-tags.js, so a page added later carries the markers the day its
// builder runs, with no list of pages here. A marker is a fenced link:
//
//   <!--driftproof:term--><a class="term" href="/glossary/#term-x" data-entry="term-x" data-name="X"
//   data-plain="...">word</a><!--/driftproof:term-->
//
// so that without script it is a link to the entry, and so that `unwrapTerms` can put the word back as it
// was: splitReportBody (spec 020 AC-21), the Markdown copies (spec 135) and every re-render read the page
// with the markers taken out, and a frozen report body does not move.
//
// WHERE A MARKER MAY STAND (spec 689 AC-2). On the first use of any of the entry's word forms inside <main>
// that stands between white space (or the start of its text) and white space (or its end), outside
// machine-read text: a heading, a link, a button or summary, code, a table header, a term being defined, a
// value another reader parses by position, an island's static fallback, the receipt cards, the cite box.
// A word followed by a comma, a full stop or an apostrophe is not the first use, and the next one is: that is
// what keeps every text reader on the site, those that drop tags and those that turn tags into spaces,
// reading the same sentence. A page that already carries the id a marker would link (the glossary) gets no
// marker for it.
//
//   node scripts/glossary-terms.js            count the markers on every published page
//   node scripts/glossary-terms.js --check    fail if any page's markers are stale or disagree with the glossary
const fs = require('fs');
const path = require('path');
const { tokenize, attrOf, escapeAttr, VOID } = require('./html-text.js');

const ROOT = path.join(__dirname, '..');

const CORE = '/methodology/#the-core-with-vs-without-sampled-banded';
const RULE = '/methodology/#the-drift-verdict-rule-anti-false-positive';
const SURFACES = '/methodology/#providers-surfaces-and-neutrality';
const FORMAT = '/methodology/#receipts-are-an-open-format';
const RECEIPT_SPEC = 'https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md';
const BANDS = '/methodology/#where-a-band-comes-from';

// Each entry: its name as the glossary heads it, its plain line (one or two sentences in everyday words, no
// digit, no internal token), the fuller definition in the site's own words for what the methodology and
// spec/RECEIPT.md say, the section it comes from, and the word forms a page may use for it. A form is a
// regular-expression alternative; the leading letter may be a capital, so a sentence-initial use counts.
const ENTRIES = [
  { name: 'skill',
    plain: 'A file of instructions that people add to an AI assistant, such as Claude, to make it better at a job. Driftproof tests whether a skill really helps.',
    body: 'A directory holding a SKILL.md, whose instructions are sent with every request in the with-skill arm and are measured by their content hash, so a receipt names the exact bytes it read. The skill\'s own test cases are the tasks a run asks.',
    href: CORE, label: 'with and without the skill', match: ['AI skills?', '[Ss]kills?'] },
  { name: 'drift report',
    plain: 'A report that asks whether a skill still helps after something underneath it changed, such as a new version of the model.',
    body: 'A dated comparison of two runs of the same eval suite, asking whether a skill still helps after something underneath it moved. It names what moved, reports a verdict per cell, and links the receipts every figure came from.',
    href: RULE, label: 'the drift verdict rule', match: ['[Dd]rift reports?'] },
  { name: 'receipt',
    plain: 'The dated file that records one test: the skill, the model, every score and the result. Anyone can check that it has not changed since it was sealed.',
    body: 'The dated, hash-verified JSON file a single run emits: the skill and its content hash, the model, the surface, every case score, and the comparison between the two arms. It is the unit of evidence on this site, and every published number traces to one.',
    href: RECEIPT_SPEC, label: 'the receipt specification', match: ['[Rr]eceipts?'] },
  { name: 'band',
    plain: 'The range a score is given instead of one number: the average plus or minus the usual spread of the scores. Two bands that do not overlap are what a report calls separated.',
    body: 'The range a score carries instead of a single number, because a scorer asked twice does not answer identically twice. A band is a descriptive spread, the mean plus or minus one sample standard deviation across n generations scored by the fixed judge, and whether two bands overlap decides whether a separation is detected under the rule.',
    href: CORE, label: 'with vs without, sampled, banded', match: ['[Bb]ands?'] },
  { name: 'draw',
    plain: 'One answer the model gave to a task. Each task is asked several times, so a result is a range of scores rather than one number.',
    body: 'Each arm is generated several times, and more until the spread across draws settles. The judge scores every draw several times, and a receipt records how many draws each arm had.',
    href: BANDS, label: 'where a band comes from', match: ['[Dd]raws?'] },
  { name: 'separated',
    plain: 'The two ranges of scores, with the skill and without it, do not overlap, and the gap is at least the effect floor. It is what a report means by a clear difference, and it is not proof that the skill caused it.',
    body: 'Separation is detected under the rule when the two bands do not overlap and the move clears the effect floor; it is a detection under the rule, not proof that the skill moved the score. Where bands touch or overlap, or a move is below the floor, the report says no separation detected at this sample size.',
    href: RULE, label: 'the drift verdict rule', match: ['[Ss]eparated', '[Ss]eparation'] },
  { name: 'effect floor',
    plain: 'The smallest gap that counts. A smaller difference is not called a change, however the ranges fall, because the grader scores in coarse steps.',
    body: 'The smallest lift that counts as a lift, below which a difference is reported as no effect however the bands fall. It exists because a score can move by a rounding artefact of the scoring grid and mean nothing at all.',
    href: RULE, label: 'the drift verdict rule', match: ['[Ee]ffect floors?'] },
  { name: 'baseline',
    plain: 'The run without the skill: the same tasks and the same model, with nothing added. Every score with the skill is compared against it.',
    body: 'The arm run without the skill text, against which the with-skill arm is read: the lift is the with-skill mean minus the baseline mean. A placebo arm, where a report has one, is read against the baseline too.',
    href: CORE, label: 'with and without the skill', match: ['[Bb]aselines?'] },
  { name: 'placebo arm',
    plain: 'A fake skill: a text of the same length as the skill, built from sentences chosen without looking at any task. The skill is scored against the fake as well as against nothing, the way a medicine is tested against a sugar pill.',
    body: 'An optional third arm, answered with a text of exactly the skill text\'s length in bytes in the skill\'s place, drawn from a fixed corpus chosen without reference to any task, which can by chance bear on a case. Its reading is the verdict\'s own case rule applied to the skill against that text, given beside the verdict and never in its place.',
    href: RECEIPT_SPEC, label: 'the receipt specification', match: ['[Pp]lacebo arms?', '[Pp]lacebos?'] },
  { name: 'judge',
    plain: 'The judge, also called the grader, is an AI model, sometimes the same one that answered, that scores each answer against a guide written for the task. It is an AI, not a person, and it can be wrong.',
    body: 'One fixed grader scores every answer in a report several times, so a moved result cannot come from a changed grader; the judge\'s model, instructions and sampling are recorded on the receipt. The judge policy says when the grader changes and what it cannot do.',
    href: '/judge-policy/#plain-why-one-grader', label: 'why one grader', match: ['[Jj]udges?', '[Gg]raders?'] },
  { name: 'case rule',
    plain: 'A reading that takes each test task on its own. A skill clearly helped if it scored clearly higher on at least one task and clearly lower on none, and clearly hurt if it scored clearly lower on any.',
    body: 'The rule reads each case\'s two bands under the effect floor and combines the cases: separated upward on at least one case and downward on none reads as helped, and downward on any case reads as hurt. The aggregate figures over all cases are given beside it and can point the other way.',
    href: '/how-it-works/#step-4', label: 'repeat, then read the case rule', match: ['[Cc]ase rules?'] },
  { name: 'substrate',
    plain: 'The model underneath the skill, down to its exact version and the company that serves it. Skills stand still while the model underneath them moves.',
    body: 'The model underneath the skill: a specific version, from a specific provider, at a specific tier. Driftproof exists because the substrate moves while the skill file stands still.',
    href: SURFACES, label: 'providers, surfaces and neutrality', match: ['[Ss]ubstrates?'] },
  { name: 'surface',
    plain: 'How the model was reached: through a paid programming interface or through a subscription command-line tool. The same model can behave a little differently over the two.',
    body: 'How the model was reached: a metered API or a subscription CLI. The same model over two surfaces is not guaranteed to behave identically, so every receipt records which one it ran on.',
    href: SURFACES, label: 'providers, surfaces and neutrality', match: ['[Ss]urfaces?'] },
  { name: 'refusal',
    plain: 'A result that reports no verdict because the run could not stand behind one. It is published as a refusal rather than guessed at.',
    body: 'A published result that reports no verdict, because the run could not stand behind one. A refusal is an outcome and not an error, and publishing it is the alternative to guessing.',
    href: RULE, label: 'the drift verdict rule', match: ['[Rr]efusals?', '[Rr]efused'] },
  { name: 'cell',
    plain: 'One skill tested on one model. A report is a grid of cells, and each cell gets its own verdict.',
    body: 'One skill measured on one substrate: the smallest unit a report gives a verdict to. A report is a grid of cells, and a cell that refuses does not sink the ones that did not.',
    href: CORE, label: 'with vs without, sampled, banded', match: ['[Cc]ells?'] },
  { name: 'arm',
    plain: 'One side of the comparison: the run with the skill, or the run without it. Some reports add a third arm, the fake.',
    body: 'One side of the comparison: the run WITH the skill, or the baseline run without it. Every case is run in both arms, and the difference between the two arms is the only thing a lift can mean.',
    href: CORE, label: 'with vs without, sampled, banded', match: ['[Aa]rms?'] },
  { name: 'lattice',
    plain: 'The four levels of trust a receipt can carry, from a number nobody checked, through one Driftproof measured itself, to one checked by a formal proof.',
    body: 'The four verification levels a receipt can carry: UNVERIFIED, DECLARED, TESTED and FORMAL. A number Driftproof measured itself is TESTED; a number imported from another tool is DECLARED, recorded but not verified, and never given a pass or fail verdict.',
    href: FORMAT, label: 'receipts are an open format', match: ['[Ll]attice'] },
  // The two words every report table since 007 uses and this page did not define (spec 025 AC-19). A reader
  // who meets `(legacy)` beside a band had nowhere to look it up.
  { name: 'generation sampling',
    plain: 'Asking the model the same task several times, so the range measures the model giving different answers and not only the grader re-reading one answer.',
    body: 'Running each arm more than once, so that a band measures the model writing a different answer and not only the judge re-reading one. A receipt that ran no generation sampling carries a legacy band, and one that ran it carries a generation band.',
    href: BANDS, label: 'where a band comes from', match: ['[Gg]eneration sampling'] },
  { name: 'band source (legacy, generation)',
    plain: 'A label beside a range saying how it was measured: from one answer scored several times, or from several answers each scored several times.',
    body: 'The label a report table puts beside a band, saying which instrument produced it. A legacy band is the judge re-scoring a single generation; a generation band is the across-draw spread of several.',
    href: BANDS, label: 'where a band comes from', match: ['[Bb]and sources?'] },
  // Spec 438 (spec 025 A-025-14): the two fields spec/RECEIPT.md v0.15 adds, in spec 438's own words.
  { name: 'context file',
    plain: 'A file of standing instructions, such as a CLAUDE.md or an AGENTS.md, tested in place of a skill.',
    body: 'Any Markdown file, such as a CLAUDE.md, an AGENTS.md or a shared rules file, measured as a subject in place of a skill. Its exact bytes are the with-skill system text and their sha256 is its content hash; the receipt records its kind as context_file.',
    href: RECEIPT_SPEC, label: 'the receipt specification', match: ['[Cc]ontext files?'] },
  { name: 'delivery',
    plain: 'How the skill\'s text reached the model in a run: put into each request by Driftproof, loaded by a tool that had it installed, or not recorded.',
    body: 'How a run was configured to deliver its subject, recorded on every receipt: injected, the runner puts the subject text into each with-skill request it builds; installed, a harness loaded the subject from where it was installed, which only an import says; unknown, an imported source that does not say. It records the configuration, not that a request was sent.',
    href: RECEIPT_SPEC, label: 'the receipt specification', match: ['[Dd]elivery'] },
  { name: 'router',
    plain: 'A skill that hands the job to another skill or tool instead of doing it itself. The text tasks here can only test what a router writes back, not the work it hands off, so a router gets no verdict.',
    body: 'A skill whose instructions delegate the task to another skill or tool, so a text-only run tests its written response and not the delegated work. Report 015 Amendment 1 records the limit: a router\'s receipt gives no verdict, because the skill it hands off to was not tested, and its rows are left out of the headline counts.',
    href: '/reports/015/#amendment-1', label: 'Report 015 Amendment 1', match: ['[Rr]outers?'] },
  // Issue 490: terms for the capture, saved progress and configured grader pair.
  { name: 'repository capture',
    plain: 'A way of testing where the model works inside a fresh copy of a code repository, with its tools, and the changes it makes are graded along with its reply.',
    body: 'A capture mode that grades the reply and captured text changes from a fresh pinned starter repository, with coding tools available. The receipt discloses observed tool evidence and capture omissions; availability alone does not prove execution.',
    href: '/methodology/#repository-capture', label: 'repository capture', match: ['[Rr]epository capture'] },
  { name: 'checkpoint',
    plain: 'Saved progress of a run, so a paused or interrupted run can continue without redoing finished work.',
    body: 'Durable run progress that retains finished draws and saved judge samples for a compatible resume. A pause or resume leaves the verdict rules unchanged and records the run segments in the final receipt.',
    href: '/methodology/#checkpoint-pause-resume', label: 'checkpoint, pause and resume', match: ['[Cc]heckpoints?'] },
  { name: 'crossed judging',
    plain: 'An older grading setup in which two models graded each other\'s answers. One grader now scores both.',
    body: 'A historical R-2 pairing: Sonnet judged Haiku and Haiku judged Sonnet. Sonnet 5.5 now judges both targets; self-grading is disclosed.',
    href: '/methodology/#crossed-judging', label: 'R-2 judge configuration', match: ['[Cc]rossed judging'] },
];

// A SLUG, not the name with its spaces swapped: "band source (legacy, generation)" would otherwise give an
// id carrying brackets and a comma, which is a fragment nobody can link by hand.
const slugOf = (name) => `term-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const TERMS = ENTRIES.map((e) => ({ ...e, id: slugOf(e.name) }));

const TERM_OPEN = '<!--driftproof:term-->';
const TERM_CLOSE = '<!--/driftproof:term-->';
const CARDS_OPEN = '<!--driftproof:cards-->';
const CARDS_CLOSE = '<!--/driftproof:cards-->';
const FOOT_OPEN = '<!--driftproof:foot-->';
// What the mount says without script, where the markers are plain links to the glossary; the island
// rewrites it to say that a tap opens a note (docs/islands/jargon-cards.js).
const NOTE_TEXT = 'Words with a dotted line link to the glossary, where each is explained in plain words.';
const MOUNT = `${CARDS_OPEN}<div class="jargon-cards" data-island="jargon-cards"><p class="jargon-note">${NOTE_TEXT}</p></div>${CARDS_CLOSE}`;

// The word comes back exactly as the page had it: a marker wraps one run of text and nothing else.
const MARKER_RE = /<!--driftproof:term--><a class="term"[^>]*>([^<]*)<\/a><!--\/driftproof:term-->/g;
const unwrapTerms = (html) => String(html).replace(MARKER_RE, (_m, word) => word);
const stripCards = (html) => String(html).replace(new RegExp(`${CARDS_OPEN}[\\s\\S]*?${CARDS_CLOSE}\\n?`, 'g'), '');

// ── machine-read text ─────────────────────────────────────────────────────────────────────────────
const SKIP_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button', 'summary', 'label', 'code', 'pre', 'kbd', 'samp', 'var',
  'script', 'style', 'template', 'textarea', 'select', 'option', 'svg', 'math', 'title', 'table', 'th', 'dt', 'dfn', 'abbr', 'cite', 'q',
  'data', 'time', 'mark', 'nav', 'header', 'footer', 'form', 'input']);
// skill-entry: the skill lookup reads each /skills/ row strictly and refuses markup in it (spec 315 AC-3, issue 716).
const SKIP_CLASSES = new Set(['receipt', 'report-card', 'plain-summary', 'tldr-cite', 'copy-cta', 'report-type', 'headline-caveat', 'handoff-note', 'skill-entry']);
// Not an island's mount: an island reads its mount's text nodes or replaces them whole, and never its
// markup, so a marker inside one is a card where the island keeps the prose and nothing where it does not.
const SKIP_ATTRS = ['data-stat', 'data-field', 'data-quote', 'data-copy'];
const classesOf = (tok) => String(attrOf(tok, 'class') || '').split(/\s+/).filter(Boolean);
const skips = (tok) => SKIP_TAGS.has(tok.name) || classesOf(tok).some((c) => SKIP_CLASSES.has(c)) || SKIP_ATTRS.some((a) => attrOf(tok, a) !== null);
// The elements whose end tag HTML lets a writer leave out: a start tag of one of these closes an open <p>,
// an <li> closes an open <li>, a <dt> or <dd> closes an open <dt> or <dd>. Without this an unclosed <dt>
// would read as holding the rest of its page.
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
function popTo(stack, names) {
  const i = Math.max(...names.map((n) => stack.map((x) => x.name).lastIndexOf(n)));
  if (i >= 0) stack.length = i;
}
// An <li> closes an open <li>, and a <dt> or <dd> an open <dt> or <dd>, only inside the same list: a list
// opened since then holds the new item (issue 716: a nested list closed its skill-entry row).
function popItem(stack, names, lists) {
  const at = stack.map((x) => x.name);
  const item = Math.max(...names.map((n) => at.lastIndexOf(n)));
  const list = Math.max(...lists.map((n) => at.lastIndexOf(n)));
  if (item > list) stack.length = item;
}

// The one pattern over every entry's forms, longest form first so "placebo arm" wins over "placebo" and
// "band source" over "band" at the same position; a match stands between white space or the text's ends.
const byLength = (a, b) => b.replace(/\[..\]|\?/g, 'x').length - a.replace(/\[..\]|\?/g, 'x').length;
const ALL_FORMS = TERMS.flatMap((t) => t.match).sort(byLength);
const WORD_RE = new RegExp(`(?<=^|\\s)(?:${ALL_FORMS.join('|')})(?=\\s|$)`, 'g');
const entryOf = (word) => TERMS.find((t) => t.match.some((f) => new RegExp(`^(?:${f})$`).test(word)));
const isReaderPage = (html) => html.indexOf('<main') >= 0 && html.lastIndexOf('</main>') >= 0 && !/<meta http-equiv="refresh"/.test(html);

const marker = (t, word) => `${TERM_OPEN}<a class="term" href="/glossary/#${t.id}" data-entry="${t.id}" data-name="${escapeAttr(t.name.charAt(0).toUpperCase() + t.name.slice(1))}" data-plain="${escapeAttr(t.plain)}">${word}</a>${TERM_CLOSE}`;

// The markers and the mount, written over a page that has none (the step unwraps first, so a committed page
// renders to itself). Idempotent by construction.
function applyTerms(html) {
  let out = stripCards(unwrapTerms(html));
  if (!isReaderPage(out)) return out;
  const a = out.indexOf('<main');
  const b = out.lastIndexOf('</main>');
  const ids = new Set([...out.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const tokens = tokenize(out);
  // A page the tokenizer cannot give back byte for byte (an input ending inside a tag) is left alone.
  if (tokens.map((t) => (t.type === 'text' ? t.text : t.raw)).join('') !== out) return out;
  const stack = [];
  const seen = new Set();
  let pos = 0;
  const parts = [];
  for (const t of tokens) {
    const at = pos;
    pos += t.type === 'text' ? t.text.length : t.raw.length;
    if (t.type === 'start') {
      if (P_CLOSERS.has(t.name)) popTo(stack, ['p']);
      if (t.name === 'li') popItem(stack, ['li'], ['ul', 'ol', 'menu']);
      if (t.name === 'dt' || t.name === 'dd') popItem(stack, ['dt', 'dd'], ['dl']);
      if (!VOID.has(t.name) && !t.selfClosing) stack.push(t);
      parts.push(t.raw);
      continue;
    }
    if (t.type === 'end') { popTo(stack, [t.name]); parts.push(t.raw); continue; }
    if (t.type !== 'text') { parts.push(t.raw); continue; }
    if (at < a || at >= b || stack.some(skips)) { parts.push(t.text); continue; }
    parts.push(t.text.replace(WORD_RE, (word) => {
      const entry = entryOf(word);
      if (!entry || seen.has(entry.id) || ids.has(entry.id)) return word;
      seen.add(entry.id);
      return marker(entry, word);
    }));
  }
  out = parts.join('');
  if (!seen.size) return out;
  const foot = out.indexOf(FOOT_OPEN);
  return foot >= 0 ? `${out.slice(0, foot)}${MOUNT}\n${out.slice(foot)}` : out.replace(/<\/body>/, `${MOUNT}\n</body>`);
}

// The markers a page carries, read back: { id, name, plain, href, word }.
function markersOf(html) {
  return [...String(html).matchAll(/<!--driftproof:term--><a class="term" href="([^"]*)" data-entry="([^"]*)" data-name="([^"]*)" data-plain="([^"]*)">([^<]*)<\/a><!--\/driftproof:term-->/g)]
    .map((m) => ({ href: m[1], id: m[2], name: m[3], plain: m[4], word: m[5] }));
}

module.exports = { TERMS, TERM_OPEN, TERM_CLOSE, CARDS_OPEN, CARDS_CLOSE, NOTE_TEXT, MOUNT, SKIP_TAGS, SKIP_CLASSES, SKIP_ATTRS,
  unwrapTerms, stripCards, applyTerms, markersOf, isReaderPage, slugOf };

if (require.main === module) {
  // Required here, not above: build-head-tags.js requires site-chrome.js, which requires this file.
  const { pageFiles, render } = require('./build-head-tags.js');
  const check = process.argv.includes('--check');
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const stale = [];
  const disagree = [];
  let pages = 0;
  let markers = 0;
  const perEntry = new Map();
  for (const f of pageFiles()) {
    const rel = path.relative(path.join(ROOT, 'docs'), f).split(path.sep).join('/');
    const before = fs.readFileSync(f, 'utf8');
    if (!isReaderPage(before)) continue;
    pages += 1;
    if (check && render(before, rel) !== before) stale.push(rel);
    const seen = new Set();
    for (const m of markersOf(before)) {
      markers += 1;
      perEntry.set(m.id, (perEntry.get(m.id) || 0) + 1);
      const t = TERMS.find((x) => x.id === m.id);
      if (!t) disagree.push(`${rel}: ${m.id} is not a glossary entry`);
      else if (decode(m.plain) !== t.plain) disagree.push(`${rel}: the card for ${m.id} does not say what the glossary says`);
      if (seen.has(m.id)) disagree.push(`${rel}: two markers for ${m.id}`);
      seen.add(m.id);
    }
  }
  if (check && (stale.length || disagree.length)) {
    if (stale.length) console.error(`stale plain-word cards: run node scripts/build-head-tags.js\n  ${stale.join('\n  ')}`);
    if (disagree.length) console.error(`cards that disagree with the glossary\n  ${disagree.join('\n  ')}`);
    process.exit(1);
  }
  if (!check) for (const [id, n] of [...perEntry].sort((x, y) => y[1] - x[1])) console.log(`${String(n).padStart(5)}  ${id}`);
  console.log(`plain-word cards ${check ? 'current' : 'counted'} on ${pages} reader pages: ${markers} markers, ${perEntry.size} of ${TERMS.length} entries used`);
}
