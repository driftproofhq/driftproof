// SPDX-License-Identifier: Apache-2.0
'use strict';

// The decision a RUN reaches, over every receipt it produced (spec 030).
//
// `lib/verdict.js` answers a question about ONE receipt: does the skill still
// help on THIS model? That question is still asked and still answered there,
// unchanged. This module answers the one the action actually needs and never
// had a place to ask: a run takes a LIST of models and must reach a single
// decision over all of them.
//
// Until spec 030, `action/run.sh` picked one receipt with `ls … | head -1` and
// decided the job from it. Receipts are named `<skill>-<model>-<date>.json`, so
// that pick is ordered by model id: `claude-haiku-4-5` sorts before
// `claude-sonnet-5`, and a regression on any model that did not sort first was
// reported as a pass, with a green check and a brightgreen badge. The seam lives
// here, in lib/, rather than in the shell, because `bin/driftproof badge` needs
// it too and because a decision state is a property of a receipt.

const fs = require('fs');
const path = require('path');
const { EFFECT_FLOOR } = require('../config');
const { shortModel, githubOutputEntry } = require('./verdict');

// The six decision states (spec 030 AC-4).
//
// `helped` is the sixth, and is a RECORDED DEVIATION from the brief's five
// (spec.md A-030-1): a model on which the skill measurably helped needs a row
// that says so. `no detected effect` is false about such a model - the effect
// was detected and it cleared the floor - and widening it to mean "not a
// regression" would put a measured lift and a measured nothing in one cell.
const STATES = ['regression', 'refused', 'inconclusive', 'not measured', 'no detected effect', 'helped'];

// WORST FIRST. This is the single definition of the ordering; AC-1's
// enforcement and AC-3's badge both read it, so they cannot disagree about
// which of two states governs a run.
const STATE_ORDER = STATES.slice();

// States that must never render as success on any surface the action writes -
// the badge, the summary row, or the check title (AC-4).
const NEVER_SUCCESS = ['inconclusive', 'not measured'];

// States that fail the job. `refused` fails CLOSED (AC-2): a model that
// produced no receipt is not a model that passed. `regression` fails subject to
// fail-on-regression. An unmeasured run does not fail on its own (AC-4's rule)
// - it is not evidence that the skill hurt - but it never renders as success.
function failsJob(state, { failOnRegression = true } = {}) {
  // AC-2. `refused` fails CLOSED and is NOT subject to fail-on-regression: that
  // input says what to do about a measured regression, and a model that
  // produced no receipt was not measured at all. A run that silently narrowed
  // to the models that survived would be AC-1's defect with a different cause -
  // the decision taken over a subset nobody chose.
  if (state === 'refused') return true;
  if (state === 'regression') return !!failOnRegression;
  return false;
}

// The mapping rule of spec 030 AC-4, in order; the first match wins. A null or
// missing receipt is `refused`.
//
// `not measured` is tested BEFORE `inconclusive` and before any delta is read,
// because a receipt below TESTED has not measured anything its delta could be
// about - spec 026 AC-1 is what makes a stub receipt unable to claim TESTED,
// and reading its delta first would grade a run that never ran.
// The rule is read off AC-4's table and nothing is supplied that the receipt
// does not carry. Until this it read
//
//   const level = receipt.verification_level || 'TESTED';
//   ... || (kind && kind !== 'model')
//
// - a receipt with no `verification_level` was GRADED ON ITS DELTA as though it
// had claimed TESTED, and a receipt with no `answered_by` block had the second
// clause skipped entirely. Both defaults point the same way: they let a receipt
// that says nothing about how it was answered reach `helped`. AC-4 says each
// state SHALL be derived "by the rule below and by no other", and the rule says
// `verification_level != "TESTED"` and `run.answered_by.kind != "model"` - an
// absent field satisfies both. The receipts the shipped runner writes always
// carry a level and an answered_by block (lib/run.js answeredByOf always
// returns a kind), so this changes nothing about a run the action produced; it
// changes what happens to a receipt from somewhere else, and it changes it in
// the fail-safe direction.
function decisionState(receipt) {
  if (!receipt) return 'refused';
  const level = receipt.verification_level;
  const kind = receipt.run && receipt.run.answered_by ? receipt.run.answered_by.kind : undefined;
  if (level !== 'TESTED' || kind !== 'model') return 'not measured';
  const cmp = receipt.comparison || {};
  if ((receipt.run && receipt.run.status === 'incomplete') || typeof cmp.delta !== 'number') return 'inconclusive';
  if (cmp.delta <= -EFFECT_FLOOR) return 'regression';
  if (cmp.delta >= EFFECT_FLOOR) return 'helped';
  return 'no detected effect';
}

// The worst state in a set, by STATE_ORDER. An empty set has no decision, and
// says so with null rather than defaulting to something benign.
function worstState(states) {
  let worst = null;
  for (const s of states) {
    const i = STATE_ORDER.indexOf(s);
    if (i < 0) continue;
    if (worst === null || i < STATE_ORDER.indexOf(worst)) worst = s;
  }
  return worst;
}

// Every receipt in a directory, excluding the summaries and the badge writer's
// own earlier output. Mirrors what action/run.sh's glob selected from, so the
// set this reads is the set that was there to be read.
function receiptFiles(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.includes('.summary.') && f !== 'badge.json')
    .sort()
    .map((f) => path.join(dir, f));
}

// Parse the `models` input the same way the runner does: comma-separated, with
// surrounding whitespace ignored and empty entries dropped.
function parseModels(csv) {
  return String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// A receipt matches a requested id exactly, or after the release date stamp is
// stripped from both - `claude-haiku-4-5-20251001` IS `claude-haiku-4-5`, which
// is the equivalence lib/verdict.js's shortModel already defines for the badge.
function matchesModel(receiptModelId, requested) {
  return receiptModelId === requested || shortModel(receiptModelId) === shortModel(requested);
}

// The same question for a receipt that CANNOT BE READ. `matchesModel` reads
// `run.model_id`, and for an unreadable receipt that field is inside the bytes
// that will not parse. The FILENAME is the only thing left that names a model:
// the runner writes `<skill>-<model>-<date>.json`, so the id appears in the
// basename as a dash-delimited run.
//
// Until this, the unreadable branch matched by POSITION - the first unreadable
// file in the directory, whichever model it belonged to. With one requested model
// absent and another's receipt unreadable, the two causes were hung on the wrong
// models: the absent model was reported as "exists and is unreadable" naming the
// OTHER model's file, and the model whose file was actually corrupt was reported
// as having produced nothing. Both still failed closed and both ids still
// appeared somewhere, which is why AC-2's arms stayed green - they drove one
// cause at a time and never both at once (F-1 of 2026-09-12).
function fileNamesModel(file, requested) {
  const base = path.basename(file);
  // Both spellings, for the reason `matchesModel` takes both: a receipt for
  // `claude-haiku-4-5-20251001` answers a request for `claude-haiku-4-5`.
  for (const id of new Set([requested, shortModel(requested)])) {
    if (base.includes(`-${id}-`)) return true;
  }
  return false;
}

// The decision over a run: one row per REQUESTED model, in the order requested.
//
// Rows come from the requested list rather than from the directory listing, so
// a model that produced no receipt is a row that says `refused` instead of a
// row that is simply absent. That is the whole of AC-2: absence is not a pass.
function decideSet(dir, requestedCsv, { failOnRegression = true } = {}) {
  const requested = parseModels(requestedCsv);
  const files = receiptFiles(dir);
  const loaded = files.map((f) => {
    let receipt = null, error = null;
    try { receipt = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { error = e.message; }
    return { file: f, receipt, error };
  });
  const used = new Set();
  const rows = requested.map((model) => {
    const hit = loaded.find((l) => !used.has(l.file) && l.receipt
      && l.receipt.run && matchesModel(l.receipt.run.model_id, model));
    if (hit) used.add(hit.file);
    // A receipt that exists and cannot be parsed is UNREADABLE, not absent.
    // Both fail closed, and the row says which - the register's
    // absence-vs-unreadable distinction, kept at the point it is decided.
    const unreadable = !hit && loaded.find((l) => !used.has(l.file) && l.error
      && fileNamesModel(l.file, model));
    if (unreadable) used.add(unreadable.file);
    const receipt = hit ? hit.receipt : null;
    const state = decisionState(receipt);
    return {
      model,
      state,
      delta: receipt && receipt.comparison && typeof receipt.comparison.delta === 'number'
        ? receipt.comparison.delta : null,
      file: hit ? path.basename(hit.file) : (unreadable ? path.basename(unreadable.file) : null),
      // The distinction is carried on the ROW, not left in a sentence, because
      // the enforcement message has to say which of the two happened (AC-2's
      // mutation class, absence-vs-unreadable).
      unreadable: unreadable ? unreadable.error : null,
      // A SHORT CAUSE, not the parser's text. V8's JSON.parse message echoes the
      // first bytes of the input - "Unexpected token '|', \"|{bad\" is not valid
      // JSON" - and this string is rendered into a markdown table cell, where one
      // unescaped `|` adds a column and a newline ends the row. The detail still
      // reaches the annotation, which is not a table; the cell carries the cause,
      // and the filename is already beside it in the same cell (F-2 of
      // 2026-09-12).
      reason: unreadable ? 'receipt unreadable (not valid JSON)' : (hit ? null : 'no receipt for this model'),
    };
  });
  // Receipts the run wrote for models nobody requested are reported rather than
  // dropped: they are evidence that the run did something other than what it
  // was asked for.
  const unexpected = loaded.filter((l) => !used.has(l.file))
    // An unreadable file whose name matches no requested model is still reported,
    // and reported AS unreadable. Calling it a receipt for a model nobody asked
    // for would state as fact the one thing its bytes could not tell us.
    .map((l) => (l.error ? `${path.basename(l.file)} (unreadable)` : path.basename(l.file)));
  const worst = worstState(rows.map((r) => r.state));
  return {
    rows,
    worst,
    regressed: rows.filter((r) => r.state === 'regression').map((r) => r.model),
    missing: rows.filter((r) => r.state === 'refused').map((r) => r.model),
    // `missing` is every model that reached no readable receipt, which is what
    // the missing_models output has always published. `absent` and `unreadable`
    // split it by CAUSE: nothing was written for this model, or something was
    // written and cannot be read. Both fail closed; they are not the same fact,
    // and the failure has to say which.
    absent: rows.filter((r) => r.state === 'refused' && !r.unreadable).map((r) => r.model),
    unreadable: rows.filter((r) => r.state === 'refused' && r.unreadable)
      .map((r) => ({ model: r.model, file: r.file, error: r.unreadable })),
    unexpected,
    receiptCount: files.length,
    requestedCount: requested.length,
    fails: rows.some((r) => failsJob(r.state, { failOnRegression })),
  };
}

module.exports = {
  STATES, STATE_ORDER, NEVER_SUCCESS, EFFECT_FLOOR,
  decisionState, worstState, failsJob, decideSet, receiptFiles, parseModels, matchesModel,
};

// ── the three surfaces the action writes ────────────────────────────────────
//
// AC-4 binds all three: the badge, the summary row and the check title. A state
// in NEVER_SUCCESS must not render as success on any of them, which is why the
// renderers live together - three surfaces fed by one table cannot drift apart
// the way three hand-written strings do.

// How each state renders. `color` is the shields colour; `marker` is the
// summary row's marker. Only `helped` gets a success marker: `no detected
// effect` is not a failure but it is not a success either, and the two
// NEVER_SUCCESS states carry a warning.
const RENDER = {
  regression: { word: 'regressed', color: 'red', marker: '\u274c' },
  refused: { word: 'refused', color: 'red', marker: '\u274c' },
  inconclusive: { word: 'inconclusive', color: 'yellow', marker: '\u26a0\ufe0f' },
  'not measured': { word: 'not measured', color: 'lightgrey', marker: '\u26a0\ufe0f' },
  'no detected effect': { word: 'no effect', color: 'lightgrey', marker: '\u2014' },
  helped: { word: 'passing', color: 'brightgreen', marker: '\u2705' },
};

// The one place a state becomes a success claim. AC-4's clause is enforced here
// rather than restated at each surface.
function rendersAsSuccess(state) {
  return state === 'helped';
}

// The badge over a SET (AC-3): the worst state, naming the model it came from,
// and how many models share it when more than one does.
function badgeMessage(d) {
  const worst = d.worst;
  if (!worst) return 'no receipts';
  const r = RENDER[worst];
  const sharing = d.rows.filter((row) => row.state === worst);
  const named = sharing[0] ? sharing[0].model : 'unknown';
  const extra = sharing.length > 1 ? ` (+${sharing.length - 1} more)` : '';
  return `${r.word} on ${shortModel(named)}${extra}`;
}

function badgeEndpointForSet(d, { label = 'driftproof' } = {}) {
  const worst = d.worst;
  return {
    schemaVersion: 1,
    label,
    message: badgeMessage(d),
    color: worst ? RENDER[worst].color : 'lightgrey',
  };
}

// The step outputs. `verdict` keeps the vocabulary lib/verdict.js publishes, so
// a workflow reading steps.run.outputs.verdict is not broken by this change;
// `worst`, `regressed` and `missing` are new and carry what it could not say.
const VERDICT_WORD = {
  regression: 'REGRESSED', refused: 'REFUSED', inconclusive: 'INCONCLUSIVE',
  'not measured': 'NOT_MEASURED', 'no detected effect': 'NO_EFFECT', helped: 'PASSED',
};

function githubOutputLines(d) {
  const worst = d.worst;
  const badge = badgeEndpointForSet(d);
  const worstRow = d.rows.find((r) => r.state === worst);
  return [
    ['verdict', worst ? VERDICT_WORD[worst] : 'NOT_MEASURED'],
    ['delta', worstRow && worstRow.delta !== null ? worstRow.delta : 0],
    ['message', badge.message],
    ['color', badge.color],
    ['worst_state', worst || 'none'],
    ['regressed_models', d.regressed.join(',')],
    ['missing_models', d.missing.join(',')],
    ['receipt_count', d.receiptCount],
  ].map(([k, v]) => githubOutputEntry(k, v)).join('\n');
}

// Anything reaching a table cell from outside this module - a filename, a reason,
// a model id - is escaped FOR THE CELL it sits in. A markdown row is delimited by
// `|`, so one unescaped pipe adds a column and the row stops lining up with its
// header; a newline ends the row outright. The cause AC-4's own finding had was a
// parser echo, and that echo is gone from the cell - but the filename is still
// read off a directory, so the row is made to survive the byte rather than made
// to depend on where the byte came from.
function cell(s) {
  return s === null || s === undefined ? '' : String(s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

// The job summary: one row per REQUESTED model, in the order requested (AC-4).
function summaryMarkdown(d) {
  const L = [];
  L.push('### Driftproof');
  L.push('');
  L.push('| Model | Decision | Lift | Receipt |');
  L.push('|---|---|---|---|');
  for (const row of d.rows) {
    const r = RENDER[row.state];
    const delta = row.delta === null ? 'n/a' : (row.delta >= 0 ? '+' : '') + row.delta.toFixed(3);
    const note = row.reason ? ` <br><sub>${cell(row.reason)}</sub>` : '';
    L.push(`| \`${cell(row.model)}\` | ${r.marker} ${row.state} | ${delta} | ${cell(row.file) || '\u2014'}${note} |`);
  }
  L.push('');
  L.push(`Decided over ${d.receiptCount} receipt(s) for ${d.requestedCount} requested model(s). `
    + `Worst: **${d.worst || 'none'}**.`);
  if (d.unexpected.length) {
    L.push('');
    L.push(`Receipts in the directory that no requested model claimed: ${d.unexpected.join(', ')}.`);
  }
  return L.join('\n');
}

// The check title and the human line the enforcement step prints.
//
// The message names THE MODELS THAT REGRESSED, never the requested list. The
// old line interpolated the requested list, so one model's regression was
// reported against every model asked for - the same defect as the selection,
// seen from the other side.
// The parser's message still reaches the ANNOTATION, where the detail is worth
// having - but a workflow command is ONE LINE: a newline inside it ends the
// command and drops everything after, and an unbounded echo of a file's bytes
// does not belong in a check annotation either. One line, bounded, cut marked.
function oneLine(s, max = 160) {
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
}

function enforcementLines(d, { failOnRegression = true } = {}) {
  const L = [];
  const per = d.rows.map((r) => `${r.model}: ${r.state}`).join(', ');
  L.push(`Driftproof decision over ${d.receiptCount} receipt(s) for ${d.requestedCount} model(s) - ${per}`);
  // AC-2: the count is reported before any verdict, and names each model that
  // reached no readable receipt. Absence is not a pass.
  //
  // The two causes are reported apart (absence-vs-unreadable). A model with NO
  // receipt and a model whose receipt exists and cannot be parsed both fail
  // closed, but they send the reader to different places - one to the run that
  // never wrote it, one to the file that is there - so a single message naming
  // both as "no receipt was produced" would be false about one of them.
  if (d.absent.length) {
    L.push(`::error title=Driftproof::No receipt was produced for ${d.absent.join(', ')} - `
      + `${d.receiptCount} receipt(s) for ${d.requestedCount} requested model(s). `
      + `Failing closed: a model that was not measured did not pass.`);
  }
  if (d.unreadable.length) {
    L.push(`::error title=Driftproof::The receipt for `
      + `${d.unreadable.map((u) => `${u.model} exists and is unreadable (${u.file}: ${oneLine(u.error)})`).join('; ')}. `
      + `Failing closed: a receipt that cannot be read is not a pass, and is not the same as one that was never written.`);
  }
  if (d.regressed.length) {
    const deltas = d.rows.filter((r) => r.state === 'regression')
      .map((r) => `${r.model} (delta ${r.delta})`).join(', ');
    if (failOnRegression) {
      L.push(`::error title=Driftproof::Skill REGRESSED on ${deltas}`);
    } else {
      L.push(`::warning title=Driftproof::Skill REGRESSED on ${deltas} (fail-on-regression is false)`);
    }
  }
  // AC-4: an unmeasured run renders as unmeasured, never as passing, and does
  // not fail the job on its own.
  const unmeasured = d.rows.filter((r) => NEVER_SUCCESS.includes(r.state));
  if (unmeasured.length) {
    // AC-4 binds the TITLE: a `::warning` "whose title names the state and the
    // models it came from". Until this it named `unmeasured[0].state` and no
    // model at all - both facts were in the MESSAGE, which is not where the
    // criterion puts them, and with two never-success states present the title
    // carried only the first row's. A reader who sees the annotation collapsed
    // to its title in a check list saw neither the second state nor any model
    // (F-4 of 2026-09-12).
    //
    // Grouped by state, worst first, from STATE_ORDER - the same single ordering
    // AC-1's enforcement and AC-3's badge read, so the title cannot disagree with
    // them about which state governs.
    //
    // NO COMMA IN THE TITLE, and that is load-bearing rather than a style
    // choice: GitHub parses a workflow command's properties as a
    // COMMA-SEPARATED list, so `title=not measured,inconclusive` ends the title
    // at the comma and leaves the rest to be read as a property GitHub does not
    // know. States are joined with ' / ' and the models under one state with
    // ' + ', neither of which GitHub reads.
    const states = STATE_ORDER.filter((s) => unmeasured.some((r) => r.state === s));
    const title = states
      .map((s) => `${s} on ${unmeasured.filter((r) => r.state === s).map((r) => r.model).join(' + ')}`)
      .join(' / ');
    L.push(`::warning title=Driftproof: ${title}::`
      + `${unmeasured.map((r) => `${r.model}: ${r.state}`).join(', ')} - `
      + `this run did not measure these models, and is not a pass on them.`);
  }
  return L;
}

module.exports.RENDER = RENDER;
module.exports.rendersAsSuccess = rendersAsSuccess;
module.exports.badgeMessage = badgeMessage;
module.exports.badgeEndpointForSet = badgeEndpointForSet;
module.exports.githubOutputLines = githubOutputLines;
module.exports.summaryMarkdown = summaryMarkdown;
module.exports.enforcementLines = enforcementLines;
module.exports.VERDICT_WORD = VERDICT_WORD;
