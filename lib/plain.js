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
// an UNDERPOWERED result carries it as its detail, with the receipt's draws line.

const path = require('path');
const { EFFECT_FLOOR } = require('../config');
const { receiptVerdict, readCases, UNDERPOWERED_LINE, drawsLine, lostDrawsLine, lostDrawsShort } = require('./verdict');
const { duplicateCaseRows, ambiguityLine, listReceipts } = require('./receipt');
const { failsJob } = require('./decision');

const LABELS = {
  PASSED: 'Clearly helped',
  REGRESSED: 'Clearly hurt',
  NO_EFFECT: 'No clear difference',
  UNDERPOWERED: 'Too few answers to tell',
  INCONCLUSIVE: 'Inconclusive',
  REPORTED: 'Reported, not measured',
  NOT_MEASURED: 'Not measured',
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
  INCONCLUSIVE: 'some answers were lost, or the run did not complete, so the result shows no direction.',
  REPORTED: 'the receipt is below TESTED: its numbers were reported (by another tool, or by a run no model answered), not measured by Driftproof, so there is no verdict.',
  NOT_MEASURED: 'the receipt carries no verdict; its sheet says why.',
  REFUSED: 'the file could not be read as one result; its sheet says why.',
};

// The phrase a page's lede counts each state with, in this order. `n` is the count as the page sets
// it, `k` the number.
const LEDE_ORDER = ['PASSED', 'REGRESSED', 'NO_EFFECT', 'UNDERPOWERED', 'INCONCLUSIVE', 'REPORTED', 'NOT_MEASURED', 'REFUSED'];
const LEDE = {
  PASSED: (n) => `the skill clearly helped in ${n}`,
  REGRESSED: (n) => `it clearly hurt in ${n}`,
  NO_EFFECT: (n) => `it made no clear difference in ${n}`,
  UNDERPOWERED: (n) => `there were too few answers to tell in ${n}`,
  INCONCLUSIVE: (n, k) => `${n} ${k === 1 ? 'was' : 'were'} inconclusive`,
  REPORTED: (n, k) => `${n} ${k === 1 ? 'was' : 'were'} reported, not measured`,
  NOT_MEASURED: (n, k) => `${n} ${k === 1 ? 'carries' : 'carry'} no verdict`,
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
  return { with: n3(cmp.with_skill_score), without: n3(cmp.baseline_score), tasks: tasks(cases), source };
}

// The UNDERPOWERED clause names the reason the draws line names (spec 128 R-5).
const UNDERPOWERED_BUT = {
  single_draw: 'but one side had a single answer, too few to see how much the scores vary',
  lost_draws: 'but some answers were lost, and the reading is not shown to hold for every score they could have had',
  // Spec 137 R-6: the test tasks scored too far apart for the comparison band to sit under the floor.
  suite_band: 'but the test tasks scored too far apart from each other to call it',
};

const SENTENCES = {
  PASSED: (f) => `The skill clearly helped: ${f.with} with it and ${f.without} without, on ${f.tasks}.`,
  REGRESSED: (f) => `The skill clearly hurt: ${f.with} with it and ${f.without} without, on ${f.tasks}.`,
  NO_EFFECT: (f) => `No clear difference: ${f.with} with the skill and ${f.without} without, with enough answers to have seen a gap of ${EFFECT_FLOOR}.`,
  UNDERPOWERED: (f, v) => `Too few answers to tell: ${f.with} with the skill and ${f.without} without, ${UNDERPOWERED_BUT[v.drawsNeeded && v.drawsNeeded.reason] || 'but the scores varied too much to call it'}.`,
  INCONCLUSIVE: (f, v) => `Inconclusive: some answers were lost (${lostDrawsShort(v.lostDraws)}), and the result is not shown to hold for every score they could have had, so it shows no direction.`,
  INCOMPLETE: () => 'Inconclusive: the run did not complete, so it gives no result.',
  REPORTED: (f) => `Reported, not measured: ${f.source ? `${code(f.source)} reported` : 'the receipt reports'} ${f.with} with the skill and ${f.without} without. Driftproof did not measure these numbers, so there is no verdict.`,
  NOT_MEASURED: (f, v) => `Not measured: this receipt carries no verdict, because ${joined((v.notMeasured || []).map((k) => CLAUSES[k] || k))}.`,
};

// Why, in one line, for the pull request comment. The words are AC-1's Why column.
const WHY = {
  PASSED: (f, n) => `${f.with} with the skill and ${f.without} without; ${n === 1 ? 'the' : `on at least one of the ${n} test tasks, the`} two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least ${EFFECT_FLOOR}.`,
  REGRESSED: (f, n) => `${f.with} with the skill and ${f.without} without; ${n === 1 ? 'the' : `on at least one of the ${n} test tasks, the`} two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least ${EFFECT_FLOOR}.`,
  NO_EFFECT: (f, n) => `there were enough answers to have seen a gap of ${EFFECT_FLOOR}, and ${n === 1 ? 'the test task did not show one' : `none of the ${n} test tasks showed one`}.`,
};

const underpoweredDetail = (v) => (v.drawsNeeded ? `${UNDERPOWERED_LINE}. ${drawsLine(v.drawsNeeded)}` : `${UNDERPOWERED_LINE}.`);

// One result in words. `v` carries what the state's sentence reads: drawsNeeded, lostDraws, notMeasured.
function build(state, receipt, v, cases) {
  const f = figuresOf(receipt, cases);
  const label = LABELS[state === 'INCOMPLETE' ? 'INCONCLUSIVE' : state];
  const sentence = SENTENCES[state](f, v);
  let detail = null;
  if (state === 'UNDERPOWERED') return { state, label, sentence, detail: underpoweredDetail(v), why: underpoweredDetail(v), cases };
  if (state === 'INCONCLUSIVE') detail = v.lostDraws ? lostDrawsLine(v.lostDraws) : null;
  const why = WHY[state] ? WHY[state](f, cases) : (detail || sentence);
  return { state: state === 'INCOMPLETE' ? 'INCONCLUSIVE' : state, label, sentence, detail, why, cases };
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
function fromVerdict(receipt, v) {
  if (v.verdict === 'NOT_MEASURED') {
    const routes = v.notMeasured || [];
    return build(routes.includes('below_tested') ? 'REPORTED' : 'NOT_MEASURED', receipt, v, 0);
  }
  return build(v.verdict, receipt, v, v.cases.length);
}

// The decision state a row carries, and the receipt verdict whose words it takes.
const ROW_WORDS = { helped: 'PASSED', regression: 'REGRESSED', 'no detected effect': 'NO_EFFECT', underpowered: 'UNDERPOWERED' };

// A run's row in words (lib/decision.js decideSet). `receipt` is the row's receipt, or null.
function plainOfRow(row, receipt) {
  if (row.state === 'refused') {
    const sentence = `No result for this model: ${row.reason || 'no receipt was read'}.`;
    return { state: 'REFUSED', label: LABELS.REFUSED, sentence, detail: null, why: sentence, cases: 0 };
  }
  if (row.state === 'not measured') return plainOf(receipt);
  const cases = readCases(receipt).length;
  if (row.state === 'inconclusive') {
    if (row.lostDraws) return build('INCONCLUSIVE', receipt, { lostDraws: row.lostDraws }, cases);
    return build('INCOMPLETE', receipt, {}, cases);
  }
  const state = ROW_WORDS[row.state];
  if (!state) throw new Error(`plainOfRow: the decision state ${JSON.stringify(row.state)} has no words`);
  return build(state, receipt, { drawsNeeded: row.drawsNeeded, lostDraws: row.lostDraws }, cases);
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
  return `**\`${w.row.model}\`: ${w.plain.sentence}**${many} ${fails ? 'This run fails the job.' : 'This run does not fail the job.'}`.replace(/\s*[\r\n]+\s*/g, ' ');
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
    r && typeof r.receipt_hash === 'string' ? `Receipt \`${r.receipt_hash.slice(0, 8)}\`` : null,
    r ? `verification level ${code(typeof r.verification_level === 'string' ? r.verification_level : 'not recorded')}` : null,
  ].filter(Boolean).join(', ');
  L.push(`${about ? `${about.charAt(0).toUpperCase()}${about.slice(1)} · ` : ''}${runUrl ? `[job summary](${runUrl}) · ` : ''}this comment is updated in place on each run`);
  return L.join('\n');
}

module.exports = { LABELS, CLAUSES, KEY, LEDE, LEDE_ORDER, NONE_HURT, plainOf, plainOfRow, summaryLead, commentMarkdown, markerLine, MARKER_PREFIX };
