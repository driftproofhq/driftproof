// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 729. A passive reader of sealed evidence. No grading, sealing, provider
// call or publication lookup. Every public entry point validates before use.
const fs = require('node:fs');
const path = require('node:path');
const { validateReceipt, verifyReceiptHash, readReceiptFile, kindOf } = require('./receipt');
const { plainOf, LABELS } = require('./plain');
const { receiptAggregatesOnly, AGGREGATES_ONLY_LINE, placeboReading, casesDisagree } = require('./verdict');
const { summarizeReceipt } = require('./run');
const { bandOf } = require('./reuse');
const { resolveCount, judgeSamplesOrNull } = require('./counts');
const { skillTokenCost, costSentence } = require('./skillCost');
const { suiteIdentity } = require('./skill');
const { readSuite, suiteMismatch } = require('./blind');
const { invisibleShown, shellArg } = require('./names');
const { TOKENS_CSS } = require('./view-tokens');

const GENERATOR = '<meta name="generator" content="driftproof sheet">';
const HELP = 'driftproof sheet <receipt.json> [--suite evals.json] [--out FILE.html]\nWrite a printable result with its limits. Task text is included only with a matching --suite.\nFull tasks follow in an appendix; long tasks may take extra pages.';
const LIMITS = Object.freeze([
  'This result covers these tasks, this judge and this day.',
  'A judge is a model.',
  'No clear difference is not proof of no effect.',
  "A receipt's hash shows integrity since sealing, not who ran it or that a model ran.",
]);
const SAME_JUDGE = "The judge uses the same model as the target. Self-grading may favor its own model's answers.";
const PLACEBO_LIMIT = 'Scoring above the placebo is not the same as scoring above no file.';
// Issue 756 (A-729-3): placeboReading's reading in plain words. The reading itself is not decided here.
const AGAINST = 'Against a same-length placebo: ';
const NOT_READ = 'Not read against the placebo: ';
const PLACEBO_WORDS = Object.freeze({
  ABOVE_PLACEBO: AGAINST + 'at least one task scored above it, and none below.',
  BELOW_PLACEBO: AGAINST + 'at least one task scored below it.',
  INCONCLUSIVE: AGAINST + 'inconclusive; it shows no direction.',
  NO_DIFFERENCE: AGAINST + 'no clear difference on any task.',
});
function placeboWords(r) {
  if (r.reading === 'UNDERPOWERED') return AGAINST + (casesDisagree(r.drawsNeeded) ? LABELS.UNDERPOWERED_CASES : LABELS.UNDERPOWERED).toLowerCase() + '.';
  if (r.reading !== 'NOT_MEASURED') return PLACEBO_WORDS[r.reading];
  if (r.notMeasured.includes('placebo_unverified')) return NOT_READ + 'its record could not be checked.';
  if (r.notMeasured.includes('placebo_cases_differ')) return NOT_READ + 'these tasks could not be paired with it: ' + r.excluded.map(e => invisibleShown(e.id)).join(', ') + '.';
  return NOT_READ + 'this result was not measured.';
}
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const shown = value => value === undefined || value === null || value === '' ? 'not recorded' : invisibleShown(value);
const field = (name, value) => '<span data-field="' + name + '">' + esc(shown(value)) + '</span>';
const p = text => '<p>' + esc(text) + '</p>';
const error = (message, exitCode = 2) => Object.assign(new Error(message), { exitCode });
function verified(receipt) {
  if (!validateReceipt(receipt).valid) throw error('receipt schema is invalid; nothing written. Run driftproof validate on the receipt.', 4);
  if (!verifyReceiptHash(receipt)) throw error('receipt_hash MISMATCH; nothing written. Run driftproof validate on the receipt.', 4);
}

const CSS = TOKENS_CSS + `
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.45 var(--sans); }
main { max-width: 850px; margin: 24px auto; padding: 32px; background: var(--paper-2); }
h1 { font: 32px/1.1 var(--display); margin: 0 0 14px; }
h2 { font: 600 19px/1.2 var(--sans); margin: 14px 0 4px; }
h3 { font: 600 17px/1.2 var(--sans); }
p { margin: 4px 0; }
section { overflow-wrap: anywhere; }
strong { font-weight: 700; }
.record { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; }
.record p { margin: 0; }
.wide { grid-column: 1 / -1; }
code, pre, .hash { font-family: var(--mono); font-size: .9em; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 12px; }
table { width: 100%; border-collapse: collapse; font-size: .85em; margin: 6px 0; }
th, td { text-align: left; vertical-align: top; padding: 4px; border-bottom: 1px solid var(--rule); overflow-wrap: anywhere; }
#limits { border-block: 1px solid var(--ink); margin-top: 10px; padding-bottom: 6px; }
a { color: var(--accent-ink); }
.appendix { margin-top: 28px; border-top: 1px solid var(--rule); }
.task { margin-top: 20px; }
@page { margin: 12mm; }
@media print {
  body { background: white; color: black; font-size: 9pt; line-height: 1.2; }
  main { max-width: none; margin: 0; padding: 0; background: white; }
  h1 { font-size: 19pt; margin-bottom: 8px; }
  h2 { font-size: 11pt; margin-top: 8px; }
  h3 { font-size: 10pt; }
  p { margin: 3px 0; }
  th, td { padding: 3px; }
  #limits { break-inside: avoid; }
  h2, h3 { break-after: avoid; }
  .appendix { break-before: page; margin-top: 0; border: 0; }
  pre { white-space: pre-wrap; }
  a { color: black; }
}
`;

// Recompute from raw fields even when the caller used readSuite: its cached hash
// and cases are not authority. The file name is diagnostic text only.
function matchedSuite(receipt, suite) {
  if (!suite) return { cases: null, warning: null };
  try {
    const identity = suiteIdentity(suite.raw === undefined ? suite : suite.raw);
    if (identity.suiteHash !== receipt.suite.suite_hash) {
      const reason = suiteMismatch({ ...identity, file: suite.file || 'evals.json' }, receipt).message;
      return { cases: null, warning: reason.replace(/ No record written\.$/, '') + ' The result sheet is written without task text.' };
    }
    const ids = new Set(receipt.results.cases.map(c => c.id));
    return { cases: identity.cases.filter(c => ids.has(c.id)), warning: null };
  } catch (e) {
    return { cases: null, warning: 'The suite could not supply task text: ' + e.message };
  }
}
function placeboDescription(receipt) {
  if (!receipt.placebo) return '';
  const line = summarizeReceipt(receipt).split('\n').find(line => line.startsWith('- **placebo:** '));
  return line ? line.slice('- **placebo:** '.length).replace(/`/g, '') : '';
}
function drawCounts(receipt, mode) {
  const rows = receipt.results.cases.map((c, i) => ({ c, i })).filter(x => x.c.mode === mode);
  if (!rows.length) return null;
  const count = key => {
    const values = rows.map(({ c, i }) => Array.isArray(c.generation?.draws)
      ? key === 'drawn' ? c.generation.draws.length : c.generation.draws.filter(d => d.status === 'measured').length
      : key === 'drawn' ? resolveCount(receipt, i, 'generations_per_arm') : null);
    return values.every(Number.isInteger) ? values.reduce((a, b) => a + b, 0) : null;
  };
  return shown(count('drawn')) + ' drawn; ' + shown(count('measured')) + ' measured';
}
const armName = mode => ({ with_skill: 'With the file', baseline: 'With nothing', placebo: 'With a same-length fake' })[mode];
function costHtml(receipt) {
  const e = receipt.economics;
  const tokenCost = skillTokenCost(receipt);
  if (tokenCost.kind === 'simulated') return '<p data-field="cost">' + esc(costSentence(tokenCost.text)) + '</p>';
  const tokenLine = tokenCost.shown ? p(costSentence(tokenCost.text)) : '';
  if (!e) return '<p data-field="cost">not recorded</p>' + tokenLine;
  const cols = [['call_count', 'Calls'], ['mean_input_tokens', 'Input tokens per call, mean'], ['mean_output_tokens', 'Output tokens per call, mean'], ['mean_cost_usd_per_call', 'USD per call, mean']];
  let table = '<table><thead><tr><th scope="col">Comparison</th>' + cols.map(([, label]) => '<th scope="col">' + label + '</th>').join('') + '</tr></thead><tbody>';
  for (const mode of ['with_skill', 'baseline']) {
    const arm = e[mode] || {};
    table += '<tr><th scope="row">' + armName(mode) + '</th>' + cols.map(([key]) => '<td>' + field('cost-' + mode + '-' + key, arm[key]) + '</td>').join('') + '</tr>';
  }
  table += '</tbody></table>';
  let extra = '';
  for (const mode of ['with_skill', 'baseline']) {
    const arm = e[mode] || {};
    if (arm.mean_total_tokens != null) extra += p(armName(mode) + ': ' + arm.mean_total_tokens + ' total tokens per call, mean.');
    if (arm.total_tokens != null) extra += p(armName(mode) + ': ' + arm.total_tokens + ' total tokens reported.');
  }
  return '<p>Cost basis: ' + field('cost-basis', e.basis) + '. ' + (e.judge_excluded === true ? 'Grading excluded.' : 'Grading inclusion not recorded.') + '</p>'
    + (e.basis === 'metered-equivalent' ? p('Metered-equivalent cost is what these tokens would cost on the metered API, not a subscription bill.') : '')
    + table + extra + tokenLine;
}
function bandHtml(receipt) {
  if (receiptAggregatesOnly(receipt)) return '';
  const ids = [...new Set(receipt.results.cases.map(c => c.id))];
  const band = row => {
    const b = !row?.case_status || row.case_status === 'ok' ? bandOf(row) : null;
    return b ? b.mean.toFixed(3) + ' ± ' + b.sd.toFixed(3) : 'no score';
  };
  return '<h2>What were the scores for each task?</h2><p>The ranges show the average plus or minus one spread. For receipts with repeated answers, the spread is across answers; older receipts record spread across judge samples.</p><table data-field="bands"><thead><tr><th scope="col">Task</th><th scope="col">With the file</th><th scope="col">With nothing</th></tr></thead><tbody>'
    + ids.map(id => '<tr><th scope="row">' + esc(invisibleShown(id)) + '</th>' + ['with_skill', 'baseline'].map(mode => '<td>' + esc(band(receipt.results.cases.find(c => c.id === id && c.mode === mode))) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}
// A span prevents HTML's pre element from swallowing the first newline. Numeric
// references preserve carriage returns rather than letting HTML normalize them.
const verbatim = (name, text) => '<pre><span data-field="' + name + '">' + esc(text).replace(/\r/g, '&#13;') + '</span></pre>';
function taskHtml(cases) {
  if (!cases) return '';
  return '<h2>What were the full tasks and scoring guides?</h2>' + cases.map(c => '<article class="task"><h3>What did task ' + esc(invisibleShown(c.id)) + ' ask?</h3>' + verbatim('prompt', c.prompt) + '<p>Scoring guide</p>'
    + (c.rubric ? verbatim('rubric', c.rubric) : '')
    + (c.criteria || []).map(k => '<p>' + esc(invisibleShown(k.id)) + ' · Weight: ' + esc(k.weight) + '</p>' + verbatim('criterion', k.description)).join('')
    + '<p>Pass threshold: ' + esc(c.pass_threshold) + '</p></article>').join('');
}
function countsHtml(receipt) {
  if (receiptAggregatesOnly(receipt) || !receipt.results.cases.length) return '';
  return '<h2>How many answers did each task have?</h2><table><thead><tr><th scope="col">Task</th><th scope="col">Comparison</th><th scope="col">Drawn</th><th scope="col">Measured</th><th scope="col">Judge samples per answer</th></tr></thead><tbody>'
    + receipt.results.cases.map((c, i) => {
      const draws = c.generation?.draws;
      const drawn = Array.isArray(draws) ? draws.length : resolveCount(receipt, i, 'generations_per_arm');
      const measured = Array.isArray(draws) ? draws.filter(d => d.status === 'measured').length : null;
      return '<tr><th scope="row">' + esc(invisibleShown(c.id)) + '</th><td>' + esc(armName(c.mode)) + '</td><td>' + field('drawn-row-' + i, drawn) + '</td><td>' + field('measured-row-' + i, measured) + '</td><td>' + field('judge-samples-row-' + i, resolveCount(receipt, i, 'judge_samples_per_generation')) + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function renderSheet(receipt, { suite = null, receiptName = 'receipt.json' } = {}) {
  verified(receipt);
  const { cases, warning } = matchedSuite(receipt, suite);
  const plain = plainOf(receipt), run = receipt.run, judge = run.judge || {};
  const marked = receiptAggregatesOnly(receipt), kind = kindOf(receipt);
  const portableName = path.basename(String(receiptName || 'receipt.json'));
  const validateName = portableName.startsWith('-') ? './' + portableName : portableName;
  const compared = ['with_skill', 'baseline', ...(receipt.placebo ? ['placebo'] : [])].map(mode => armName(mode) + (receipt.results.cases.some(c => c.mode === mode) ? '' : ': not recorded')).join('; ') + '.';
  const record = (label, name, value, wide = false) => '<p' + (wide ? ' class="wide"' : '') + '>' + label + ': ' + field(name, value) + '</p>';
  const identity = record('Date UTC', 'date', run.date_utc) + record('Model', 'model', run.model_id)
    + record('Judge', 'judge', judge.model_id) + record('Judge samples per answer at run scope', 'judge-samples', judgeSamplesOrNull(receipt))
    + record('Harness', 'harness', run.harness ? shown(run.harness.name) + ' / ' + shown(run.harness.version) : null)
    + record('Runner version', 'runner', run.runner_version) + record('Surface', 'surface', run.surface) + record('Verification level', 'verification', receipt.verification_level)
    + record('Receipt hash', 'receipt-hash', receipt.receipt_hash, true);
  const draws = ['with_skill', 'baseline', 'placebo'].filter(mode => receipt.results.cases.some(c => c.mode === mode)).map(mode => record(armName(mode), 'draws-' + mode, drawCounts(receipt, mode))).join('');
  const limits = LIMITS.map(p).join('') + (receipt.placebo ? p(PLACEBO_LIMIT) : '') + (judge.model_id && judge.model_id !== 'unknown' && judge.model_id === run.model_id ? p(SAME_JUDGE) : '');
  const appendix = taskHtml(cases) + bandHtml(receipt) + countsHtml(receipt);
  const html = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + GENERATOR
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'none\'; base-uri \'none\'; form-action \'none\'">'
    + '<title>Result sheet: ' + esc(invisibleShown(receipt.skill.name)) + '</title><style>' + CSS + '</style></head><body><main>'
    + '<div data-page="summary"><h1>Result sheet</h1>'
    + '<section><h2>The question</h2><p>' + field('subject-name', receipt.skill.name) + ' · ' + field('subject-kind', kind.value === 'context_file' ? 'context file' : kind.value) + ' · ' + esc(shown(run.model_id)) + '</p><p class="hash">Subject sha256: ' + field('subject-hash', receipt.skill.content_hash) + '</p></section>'
    + '<section><h2>What we gave the AI</h2><p>' + (cases ? 'Full tasks and scoring guides follow in the appendix.' : 'The tasks are identified by hash only. Ask the person who ran this for the matching evals.json, then pass it with --suite to include the task text.') + '</p><p class="hash">Suite sha256: ' + field('suite-hash', receipt.suite.suite_hash) + '</p></section>'
    + '<section><h2>What we compared</h2>' + p(compared) + (receipt.placebo ? p(placeboDescription(receipt)) : '') + '</section>'
    + '<section><h2>What we found</h2><p><strong data-field="label">' + esc(plain.label) + '</strong></p><p data-field="sentence">' + esc(plain.sentence) + '</p>'
    + (plain.detail ? '<p data-field="detail">' + esc(plain.detail) + '</p>' : '')
    + (receipt.placebo ? '<p data-field="placebo">' + esc(placeboWords(placeboReading(receipt))) + '</p>' : '')
    + (marked ? p(AGGREGATES_ONLY_LINE) : p('The scores for each task follow in the appendix.')) + '</section>'
    + '<section><h2>What it cost</h2>' + costHtml(receipt) + '</section>'
    + '<section id="limits"><h2>What this does not show</h2>' + limits + '</section>'
    + '<section><h2>The record</h2><div class="record">' + identity + '</div><div class="record">' + draws + '</div></section>'
    + '<section><h2>Check it yourself</h2><p><code data-field="validate">' + esc('driftproof validate ' + shellArg(validateName)) + '</code></p><p>Keep the receipt beside this sheet, then run this from that folder. MISMATCH means the receipt content does not match its sealed hash.</p><p>If this receipt is published: <a href="https://driftproofhq.com/r/' + esc(receipt.receipt_hash) + '/">open its receipt page</a>.</p></section></div>'
    + (appendix ? '<section class="appendix">' + appendix + '</section>' : '') + '</main></body></html>\n';
  return { html, warning };
}

function writeSheet(file, { suiteFile, out } = {}) {
  let receipt;
  try { receipt = readReceiptFile(file); } catch (e) { throw error(e.message, 4); }
  verified(receipt);
  const target = path.resolve(out || path.join(path.dirname(file), path.basename(file, path.extname(file)) + '.sheet.html'));
  if (target === path.resolve(file) || (suiteFile && target === path.resolve(suiteFile))) throw error('Output is an input file; nothing written.');
  let suite = null, suiteWarning = null;
  if (suiteFile) {
    try { suite = readSuite(suiteFile); } catch (e) { suiteWarning = e.message; }
  }
  const result = renderSheet(receipt, { suite, receiptName: path.basename(file) });
  let fd;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try { fd = fs.openSync(target, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const st = fs.lstatSync(target);
      if (!st.isFile() || st.nlink !== 1) throw error('Output is not a regular, unlinked sheet; nothing written.');
      fd = fs.openSync(target, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(fd);
      if (opened.dev !== st.dev || opened.ino !== st.ino || opened.nlink !== 1) throw error('Output changed while opening; nothing written.');
      const start = Buffer.alloc(4096), n = fs.readSync(fd, start, 0, start.length, 0);
      if (!start.subarray(0, n).toString('utf8').includes(GENERATOR)) throw error('Output already exists and is not a result sheet; nothing written.');
      fs.ftruncateSync(fd, 0);
    }
    fs.writeFileSync(fd, result.html);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  return { file: target, warning: result.warning || suiteWarning };
}
function runSheet(args) {
  try {
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(HELP); return; }
    const positional = [], flags = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i], equal = arg.indexOf('='), key = equal < 0 ? arg : arg.slice(0, equal);
      if (['--suite', '--out'].includes(key)) {
        if (Object.hasOwn(flags, key)) throw error('Repeated flag: ' + key);
        const value = equal < 0 ? args[++i] : arg.slice(equal + 1);
        if (!value || value.startsWith('-')) throw error(key + ' requires a file value.');
        flags[key] = value;
      } else if (arg.startsWith('-')) throw error('Unknown flag: ' + arg);
      else positional.push(arg);
    }
    if (positional.length !== 1) throw error(HELP);
    const result = writeSheet(positional[0], { suiteFile: flags['--suite'], out: flags['--out'] });
    if (result.warning) console.error(invisibleShown(result.warning));
    console.log(invisibleShown(path.relative(process.cwd(), result.file) || path.basename(result.file)));
  } catch (e) {
    console.error('REFUSED (sheet): ' + invisibleShown(e.message));
    process.exitCode = e.exitCode || 2;
  }
}
module.exports = { renderSheet, writeSheet, runSheet };
