// SPDX-License-Identifier: Apache-2.0
'use strict';

// The plain words for a result (spec 128): one label and one sentence per state, for a reader who
// does not read a terminal. The view page, the job summary's first line and the pull request comment
// all take their words from here, so the three cannot disagree, and none of them holds a label of
// its own.
//
// THE STATE IS READ, NEVER WORKED OUT HERE. A receipt's state is lib/verdict.js receiptVerdict's; a
// run's row is lib/decision.js decideSet's. This module only says each one in words, and no sentence
// says more than its state means (spec 031's claims discipline): UNDERPOWERED and INCONCLUSIVE never
// name a direction, and a receipt below TESTED gets no verdict at all. The labels are the site's
// words (the operator's ruling of 30 Sep 2026). The effect floor is config.js's, read, never typed.
//
// Spec 035 AC-9 binds every surface that renders UNDERPOWERED in words to carry its plain line, so
// an UNDERPOWERED result carries it as its detail, with the receipt's draws line. Spec 143 (A-035-9):
// where the cases disagree, it carries the cases line instead, under its own label, and the result
// names its words `UNDERPOWERED_CASES` while its state stays `UNDERPOWERED`.
//
// RECORDED BEFORE ANSWERED_BY EXISTED (spec 145, the operator's ruling of 2 Oct 2026). A receipt with
// no run.answered_by whose own schema defines none was written before the field existed, and is said
// so, not given the label of a receipt that lost it. That is a plain state of its own, never a
// verdict: receiptVerdict still reads NOT_MEASURED for it, and the clause of its route stays the
// site's. The schema is the one the receipt names (lib/receipt.js schemaDefines), so a receipt in a
// format that has the field and lacks it reads Not measured, as before.
//
// Spec 139: A SMOKE RUN GETS NO VERDICT, AND SAYS WHY. Its receipt is below TESTED, so receiptVerdict
// reads it NOT_MEASURED, and here its words are the smoke run's (R-4) rather than "Reported, not
// measured", which would say Driftproof did not measure it. run.preset is read for those words only,
// and to refuse: a receipt that names the preset and still reads as measured is given No result.

const path = require('path');
const { EFFECT_FLOOR } = require('../config');
const { receiptVerdict, readCases, underpoweredLine, casesDisagree, drawsLine, lostDrawsLine, lostDrawsShort } = require('./verdict');
const { duplicateCaseRows, ambiguityLine, listReceipts, schemaDefines } = require('./receipt');
const { failsJob, markdownText, markdownLost, markdownDraws } = require('./decision');
const { SMOKE_LINE, isSmoke } = require('./smoke');

const LABELS = {
  PASSED: 'Clearly helped',
  REGRESSED: 'Clearly hurt',
  NO_EFFECT: 'No clear difference',
  UNDERPOWERED: 'Too few answers to tell',
  // Spec 143: UNDERPOWERED where the cases disagree. Not a state: the words a state is said in.
  UNDERPOWERED_CASES: 'Too few test tasks to tell',
  INCONCLUSIVE: 'Inconclusive',
  REPORTED: 'Reported, not measured',
  SMOKE: 'Smoke run, no verdict',
  NOT_MEASURED: 'Not measured',
  PRE_ANSWERED_BY: 'Recorded before answered_by existed',
  REFUSED: 'No result',
};

// One clause per NOT_MEASURED route, the site's own (scripts/build-receipt-pages.js CLAUSES). The
// package cannot read that script, so the words are held here too, and spec 128's gate holds the two
// equal key for key until the site builder reads them from here.
const CLAUSES = {
  below_tested: 'its verification level is below TESTED',
  no_answered_by: 'it does not record that a model answered the run',
  no_numeric_lift: 'it records no numeric lift',
  incomplete: 'its run is marked incomplete',
  smoke: 'it is a smoke run and a smoke run cannot produce a verdict',
  no_readable_case: 'no case in it has two readable arms',
};

// What each label means, for a page's key. Written against the rule each state is read by: R-1
// compares ranges (the average plus or minus one spread), not single scores, and a non-separation
// is never read as a conclusion (spec 031).
const KEY = {
  PASSED: `on at least one test task, the average with the skill was higher, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least ${EFFECT_FLOOR}.`,
  REGRESSED: `on at least one test task, the average with the skill was lower, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least ${EFFECT_FLOOR}.`,
  NO_EFFECT: `there were enough answers to have seen a ${EFFECT_FLOOR} gap, and none was seen.`,
  UNDERPOWERED: 'there were too few answers, or they varied too much, to call it either way. It does not mean the skill does nothing.',
  UNDERPOWERED_CASES: 'the test tasks scored too far apart from each other to call it either way, and more answers are not expected to change that. It does not mean the skill does nothing.',
  INCONCLUSIVE: 'some answers were lost, or the run did not complete, so the result shows no direction.',
  REPORTED: 'the receipt is below TESTED: its numbers were reported (by another tool, or by a run no model answered), not measured by Driftproof, so there is no verdict.',
  SMOKE: `a quick smoke run (--quick) checks that the skill and its test tasks run. It takes too few answers and test tasks to give a verdict. ${SMOKE_LINE}.`,
  NOT_MEASURED: 'the receipt carries no verdict; its sheet says why.',
  PRE_ANSWERED_BY: 'the receipt was written in a format that has no field saying what answered the run, so it carries no verdict; its sheet says which format.',
  REFUSED: 'the file could not be read as one result; its sheet says why.',
};

// The phrase a page's lede counts each state with, in this order. `n` is the count as the page sets
// it, `k` the number.
const LEDE_ORDER = ['PASSED', 'REGRESSED', 'NO_EFFECT', 'UNDERPOWERED', 'UNDERPOWERED_CASES', 'INCONCLUSIVE', 'REPORTED', 'SMOKE', 'NOT_MEASURED', 'PRE_ANSWERED_BY', 'REFUSED'];
const LEDE = {
  PASSED: (n) => `the skill clearly helped in ${n}`,
  REGRESSED: (n) => `it clearly hurt in ${n}`,
  NO_EFFECT: (n) => `it made no clear difference in ${n}`,
  UNDERPOWERED: (n) => `there were too few answers to tell in ${n}`,
  UNDERPOWERED_CASES: (n) => `there were too few test tasks to tell in ${n}`,
  INCONCLUSIVE: (n, k) => `${n} ${k === 1 ? 'was' : 'were'} inconclusive`,
  REPORTED: (n, k) => `${n} ${k === 1 ? 'was' : 'were'} reported, not measured`,
  SMOKE: (n, k) => `${n} ${k === 1 ? 'was a smoke run' : 'were smoke runs'} with no verdict`,
  NOT_MEASURED: (n, k) => `${n} ${k === 1 ? 'carries' : 'carry'} no verdict`,
  PRE_ANSWERED_BY: (n, k) => `${n} ${k === 1 ? 'was' : 'were'} recorded before answered_by existed`,
  REFUSED: (n) => `${n} gave no result`,
};
const NONE_HURT = 'None showed the skill clearly hurting.';

const n3 = (x) => (typeof x === 'number' ? x.toFixed(3) : 'no score');
const tasks = (n) => `${n} test task${n === 1 ? '' : 's'}`;
// The site's join (scripts/build-receipt-pages.js honestLine): one clause, or a list ending in "and".
const joined = (parts) => (parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`);

// A skill's name, a case id and an imported tool's name are text someone else wrote, and the summary
// and the comment are markdown posted with the repository's token: each is shown as code (F-6), and
// no read value may break a line.
const oneLine = (s) => String(s).replace(/\s*[\r\n]+\s*/g, ' ');
const code = (s) => `\`${oneLine(s).replace(/`/g, "'")}\``;

// The receipt's own figures: the two arms' scores as its comparison records them, and the tool that
// reported them when it was imported.
function figuresOf(receipt, cases) {
  const cmp = (receipt && receipt.comparison) || {};
  const source = receipt && receipt.run && typeof receipt.run.source === 'string' && receipt.run.source.startsWith('imported/') ? receipt.run.source.slice('imported/'.length) : null;
  return { with: n3(cmp.with_skill_score), without: n3(cmp.baseline_score), tasks: tasks(cases), source, format: receipt && receipt.schema_version };
}

// The UNDERPOWERED clause names the reason the draws line names (spec 128 R-5). Spec 143: the band
// rung's clause names its driver, and a band rung with no driver keeps `suite_band`'s.
const UNDERPOWERED_BUT = {
  single_draw: 'but one side had a single answer, too few to see how much the scores vary',
  lost_draws: 'but some answers were lost, and the reading is not shown to hold for every score they could have had',
  // Spec 137 R-6: the test tasks scored too far apart for the comparison band to sit under the floor.
  suite_band: 'but the test tasks scored too far apart from each other to call it',
  suite_band_cases: 'but the test tasks scored too far apart from each other to call it, and more answers are not expected to change that',
  suite_band_draws: 'but the scores varied too much from answer to answer to call it',
};
const butOf = (d) => UNDERPOWERED_BUT[d && d.reason === 'suite_band' && d.driver ? `suite_band_${d.driver}` : d && d.reason];

const SENTENCES = {
  PASSED: (f) => `The skill clearly helped: ${f.with} with it and ${f.without} without, on ${f.tasks}.`,
  REGRESSED: (f) => `The skill clearly hurt: ${f.with} with it and ${f.without} without, on ${f.tasks}.`,
  NO_EFFECT: (f) => `No clear difference: ${f.with} with the skill and ${f.without} without, with enough answers to have seen a gap of ${EFFECT_FLOOR}.`,
  UNDERPOWERED: (f, v) => `${casesDisagree(v.drawsNeeded) ? LABELS.UNDERPOWERED_CASES : 'Too few answers to tell'}: ${f.with} with the skill and ${f.without} without, ${butOf(v.drawsNeeded) || 'but the scores varied too much to call it'}.`,
  INCONCLUSIVE: (f, v) => `Inconclusive: some answers were lost (${lostDrawsShort(v.lostDraws)}), and the result is not shown to hold for every score they could have had, so it shows no direction.`,
  INCOMPLETE: () => 'Inconclusive: the run did not complete, so it gives no result.',
  REPORTED: (f) => `Reported, not measured: ${f.source ? `${code(f.source)} reported` : 'the receipt reports'} ${f.with} with the skill and ${f.without} without. Driftproof did not measure these numbers, so there is no verdict.`,
  NOT_MEASURED: (f, v) => `Not measured: this receipt carries no verdict, because ${joined((v.notMeasured || []).map((k) => CLAUSES[k] || k))}.`,
  // The first clause is the format the receipt names; the routes after it are the site's clauses, as
  // NOT_MEASURED joins them.
  PRE_ANSWERED_BY: (f, v) => `${LABELS.PRE_ANSWERED_BY}: this receipt carries no verdict, because ${joined([`it was written in receipt format v${f.format}, which has no field saying what answered the run`, ...(v.notMeasured || []).filter((k) => k !== 'no_answered_by').map((k) => CLAUSES[k] || k)])}.`,
  SMOKE: (f) => `Smoke run, no verdict: ${f.with} with the skill and ${f.without} without, on ${f.tasks}. ${SMOKE_LINE}; run without --quick for one.`,
};

// Why, in one line, for the pull request comment. The words are AC-1's Why column.
const WHY = {
  PASSED: (f, n) => `${f.with} with the skill and ${f.without} without; ${n === 1 ? 'the' : `on at least one of the ${n} test tasks, the`} two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least ${EFFECT_FLOOR}.`,
  REGRESSED: (f, n) => `${f.with} with the skill and ${f.without} without; ${n === 1 ? 'the' : `on at least one of the ${n} test tasks, the`} two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least ${EFFECT_FLOOR}.`,
  NO_EFFECT: (f, n) => `there were enough answers to have seen a gap of ${EFFECT_FLOOR}, and ${n === 1 ? 'the test task did not show one' : `none of the ${n} test tasks showed one`}.`,
};

const underpoweredDetail = (v) => (v.drawsNeeded ? `${underpoweredLine(v.drawsNeeded)}. ${drawsLine(v.drawsNeeded)}` : `${underpoweredLine(v.drawsNeeded)}.`);

// One result in words. `v` carries what the state's sentence reads: drawsNeeded, lostDraws, notMeasured.
function build(state, receipt, v, cases) {
  const f = figuresOf(receipt, cases);
  const label = LABELS[state === 'INCOMPLETE' ? 'INCONCLUSIVE' : state];
  const sentence = SENTENCES[state](f, v);
  let detail = null;
  if (state === 'UNDERPOWERED') {
    const words = casesDisagree(v.drawsNeeded) ? 'UNDERPOWERED_CASES' : state;
    return { state, words, label: LABELS[words], sentence, detail: underpoweredDetail(v), why: underpoweredDetail(v), cases };
  }
  if (state === 'INCONCLUSIVE') detail = v.lostDraws ? lostDrawsLine(v.lostDraws) : null;
  const why = WHY[state] ? WHY[state](f, cases) : (detail || sentence);
  return { state: state === 'INCOMPLETE' ? 'INCONCLUSIVE' : state, label, sentence, detail, why, cases };
}

// The test tasks a smoke receipt ran: its case ids, each counted once.
const smokeTasks = (receipt) => new Set(((receipt && receipt.results && receipt.results.cases) || []).map((c) => c.id)).size;

// Spec 139: a receipt that names the quick preset and reads as anything but NOT_MEASURED. The schema
// refuses it. badge and decide validate before reading, so they refuse it, exit 4; export and diff
// verify and do not validate, as at the Base (spec 139 stop rule item 2). The view, the job summary
// and the comment read it through here, so this says No result to them, and to any other caller
// that did not validate.
function smokeRefused() {
  const sentence = `No result: this receipt names the quick preset, a smoke run, and yet claims TESTED, a level no smoke run is stamped with. ${SMOKE_LINE}, so none is read from it.`;
  return { state: 'REFUSED', label: LABELS.REFUSED, sentence, detail: null, why: sentence, cases: 0 };
}

// A receipt in words, through receiptVerdict.
function plainOf(receipt) {
  // Spec 050 AC-3: a receipt with two rows for one case and arm has no verdict, and receiptVerdict
  // refuses it; the refusal is said here before it is asked.
  const dups = duplicateCaseRows(receipt);
  if (dups.length) {
    const sentence = `No result: ${ambiguityLine(dups)}; a verdict read from it would depend on which row was read.`;
    return { state: 'REFUSED', label: LABELS.REFUSED, sentence, detail: null, why: sentence, cases: 0 };
  }
  const v = receiptVerdict(receipt);
  return fromVerdict(receipt, v);
}
// Spec 145: no answered_by, and no answered_by in the format the receipt names. A receipt below TESTED
// is Reported, not measured before this is asked; a format this validator does not hold, or a missing
// schema_version, is not a claim about when the receipt was written.
function predatesAnsweredBy(receipt, routes) {
  if (!routes.includes('no_answered_by')) return false;
  const run = receipt && receipt.run;
  if (run && run.answered_by !== undefined) return false;
  return schemaDefines(receipt && receipt.schema_version, 'run', 'answered_by') === false;
}
function fromVerdict(receipt, v) {
  // A-139-5: receiptVerdict refuses every receipt that names the preset (route `smoke`); one that
  // does not also read below TESTED claims a level no smoke run is stamped with, and is No result.
  if (isSmoke(receipt)) return v.verdict === 'NOT_MEASURED' && (v.notMeasured || []).includes('below_tested') ? build('SMOKE', receipt, v, smokeTasks(receipt)) : smokeRefused();
  if (v.verdict === 'NOT_MEASURED') {
    const routes = v.notMeasured || [];
    if (routes.includes('below_tested')) return build('REPORTED', receipt, v, 0);
    return build(predatesAnsweredBy(receipt, routes) ? 'PRE_ANSWERED_BY' : 'NOT_MEASURED', receipt, v, 0);
  }
  return build(v.verdict, receipt, v, v.cases.length);
}

// The decision state a row carries, and the receipt verdict whose words it takes.
const ROW_WORDS = { helped: 'PASSED', regression: 'REGRESSED', 'no detected effect': 'NO_EFFECT', underpowered: 'UNDERPOWERED' };

// A run's row in words (lib/decision.js decideSet). `receipt` is the row's receipt, or null.
function plainOfRow(row, receipt) {
  if (row.state === 'refused') {
    const sentence = `No result for this model: ${markdownText(row.reason || 'no receipt was read')}.`;
    return { state: 'REFUSED', label: LABELS.REFUSED, sentence, detail: null, why: sentence, cases: 0 };
  }
  if (row.state === 'not measured') return plainOf(receipt);
  // Spec 139: a row read as measured over a receipt that names the preset is refused, never worded.
  if (isSmoke(receipt)) return smokeRefused();
  const cases = readCases(receipt).length;
  if (row.state === 'inconclusive') {
    if (row.lostDraws) return build('INCONCLUSIVE', receipt, { lostDraws: markdownLost(row.lostDraws) }, cases);
    return build('INCOMPLETE', receipt, {}, cases);
  }
  const state = ROW_WORDS[row.state];
  if (!state) throw new Error(`plainOfRow: the decision state ${JSON.stringify(row.state)} has no words`);
  return build(state, receipt, { drawsNeeded: markdownDraws(row.drawsNeeded), lostDraws: markdownLost(row.lostDraws) }, cases);
}

// The receipts of a decision's directory, by file name, for its rows.
function receiptsOf(dir) {
  const by = new Map();
  for (const { file, receipt } of listReceipts(dir)) if (receipt) by.set(path.basename(file), receipt);
  return by;
}
function worstOf(d, dir) {
  const worst = d.rows.find((r) => r.state === d.worst);
  if (!worst) return null;
  const receipt = worst.file ? receiptsOf(dir).get(worst.file) || null : null;
  return { row: worst, receipt, plain: plainOfRow(worst, receipt) };
}

// The job summary's first line (spec 128 AC-2, AC-11): the worst row's model and sentence, and
// whether the job fails, read from the same rule the enforcement step reads with the same inputs.
function summaryLead(d, dir, opts = {}) {
  const w = worstOf(d, dir);
  if (!w) return 'No model was asked for, so there is no result.';
  const fails = d.rows.some((r) => failsJob(r, opts));
  const many = d.rows.length > 1 ? ` Of the ${d.rows.length} models asked for, this is the lowest result; the table below has each.` : '';
  // One markdown line: a reason read off a directory may hold a line break.
  return `**${code(w.row.model)}: ${w.plain.sentence}**${many} ${fails ? 'This run fails the job.' : 'This run does not fail the job.'}`.replace(/\s*[\r\n]+\s*/g, ' ');
}

// The hidden first line the pull request comment is found by, one per skill directory.
const MARKER_PREFIX = '<!-- driftproof:pr-comment ';
const markerLine = (key) => `${MARKER_PREFIX}${key} -->`;

// The pull request comment (spec 128 AC-12): the marker, the worst row's label with its model and
// skill, one line on why, each model's label when there are several, and where to read more.
function commentMarkdown(d, dir, { key, runUrl = null } = {}) {
  const w = worstOf(d, dir);
  const L = [markerLine(key)];
  if (!w) { L.push('**Driftproof: no result.** No model was asked for.'); return L.join('\n'); }
  const skill = w.receipt && w.receipt.skill && w.receipt.skill.name;
  L.push(`**Driftproof: ${w.plain.label}** (${code(w.row.model)}${skill ? `, ${code(skill)}` : ''})`);
  L.push('');
  L.push(`Why: ${oneLine(w.plain.why)}`);
  if (d.rows.length > 1) {
    const by = receiptsOf(dir);
    L.push('');
    L.push(`Each model: ${d.rows.map((r) => `${code(r.model)} ${plainOfRow(r, r.file ? by.get(r.file) || null : null).label}`).join('; ')}.`);
  }
  L.push('');
  // The receipt's verification level, in the site's words (spec 128 F-5, invariant 1).
  const r = w.receipt;
  const about = [
    r && typeof r.receipt_hash === 'string' ? `Receipt ${code(r.receipt_hash.slice(0, 8))}` : null,
    r ? `verification level ${code(typeof r.verification_level === 'string' ? r.verification_level : 'not recorded')}` : null,
  ].filter(Boolean).join(', ');
  L.push(`${about ? `${about.charAt(0).toUpperCase()}${about.slice(1)} · ` : ''}${runUrl ? `[job summary](${runUrl}) · ` : ''}this comment is updated in place on each run`);
  return L.join('\n');
}

module.exports = { LABELS, CLAUSES, KEY, LEDE, LEDE_ORDER, NONE_HURT, plainOf, plainOfRow, summaryLead, commentMarkdown, markerLine, MARKER_PREFIX };
