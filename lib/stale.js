// SPDX-License-Identifier: Apache-2.0
'use strict';

// `driftproof stale` (spec 053): for each receipt, does its conclusion still stand under what would
// run today, or does it need a rerun of one or both arms, or only a regrade?
//
// What a receipt recorded is read by lib/reuse.js provenanceOf; what would run today is built here,
// from the same places `driftproof run` reads (flags, then .driftproofrc; a value nobody set is
// unknown, never a default); the two are compared by lib/reuse.js compareProvenance, the function
// `triage()` uses, so the command and the triage cannot disagree about an axis. The one axis built
// here and not there is the capture mode (spec 146 R-6): see captureAxis.
//
// No model call and no network. The one thing spawned is `claude --version` or `codex --version`,
// and only when neither --harness-version nor --no-harness-check is given.
//
// THE OUTPUT IS A PUBLIC CONTRACT (spec/stale.v1.schema.json, `driftproof.stale/1`): fields are
// only ever added. It carries no clock, so the same inputs print the same bytes.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { provenanceOf, compareProvenance, armDecisions } = require('./reuse');
const { loadSkill, loadSubject, suiteIdentity } = require('./skill');
const { caseRubricHash, caseRubricHash0190, promptTemplateHash } = require('./judge');
const { resolveModel } = require('./provider');
const { loadRegistry } = require('./models');
const { validateReceipt, verifyReceiptHash, readReceiptFile, boundedErrors } = require('./receipt');
const { invisibleShown, shellArg } = require('./names');
const { RUNNER_VERSION, PROJECT_NAME } = require('../config');
const { DEFAULT_CAPTURE, assertMode } = require('./capture');

const SCHEMA_ID = 'driftproof.stale/1';
const HARNESS_BIN = { 'claude-code': 'claude', codex: 'codex' };
const SURFACE_HARNESS = { 'claude-cli': 'claude-code', 'openai-cli': 'codex', api: 'api', 'openai-api': 'api' };

// Today's version of a harness, read from its binary on PATH (spec 053 R-5).
function harnessVersionNow(name) {
  const bin = HARNESS_BIN[name];
  if (!bin) return { version: null, why: `no way to read today's ${name} version` };
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (r.error) return { version: null, why: `${bin} --version could not run: ${r.error.code || r.error.message}` };
  if (r.status !== 0) return { version: null, why: `${bin} --version exited ${r.status}` };
  const m = /\d+\.\d+\.\d+[0-9A-Za-z.+-]*/.exec(r.stdout || '');
  return m ? { version: m[0] } : { version: null, why: `${bin} --version printed no version` };
}

// What would run today, for one receipt. `why` carries the reason for each value that could not be found.
// Spec 173 (S-5): with `fromReceipt`, a skill, model or judge that no flag and no rc gives is the one the
// receipt records, and `taken` names each axis read that way, so a reader can say so. `driftproof stale`
// never passes it: there, a value nobody set is still unknown.
function currentProvenance(receipt, opts, cache) {
  const why = {};
  const taken = [];
  const rec = provenanceOf(receipt);
  const rc = opts.rc || {};
  const own = opts.fromReceipt ? rec : null;
  // Model: --model, else the rc's models; the receipt's model is current when the rc names it.
  let model = null;
  if (opts.model) model = resolveModel(opts.model);
  else if (rc.models !== undefined && rc.models !== null) {
    const list = String(rc.models).split(',').map((x) => x.trim()).filter(Boolean).map((x) => resolveModel(x));
    model = rec.model_id && list.includes(resolveModel(rec.model_id)) ? resolveModel(rec.model_id) : list.join(',') || null;
  } else if (own && own.model_id) { model = own.model_id; taken.push('model'); }
  if (!model) why.model = 'no --model given and no models in .driftproofrc';
  // Judge: --judge, else the rc's judge_model.
  const judgeRaw = opts.judge || rc.judge_model || null;
  let judge = judgeRaw ? resolveModel(judgeRaw) : null;
  if (!judge && own && own.judge_model_id) { judge = own.judge_model_id; taken.push('judge'); }
  if (!judge) why.judge_model = 'no --judge given and no judge_model in .driftproofrc';
  // Skill and suite. From the receipt, the suite is its suite hash, its case ids and its rubric hashes.
  let skillHash = null; let suite = null; let rubrics = null;
  // Spec 438: today's kind is the kind of the subject --skill loads (a skill directory, or a context file
  // with its --suite); taken from the receipt, the receipt's own.
  let kind = null;
  if (opts.skill) {
    const s = cache.skill || (cache.skill = staleSubject(opts.skill, opts.suite));
    skillHash = s.contentHash;
    kind = s.unit;
    if (!opts.suite) suite = { suiteHash: s.suite.suiteHash, cases: s.suite.cases };
  } else if (own && own.skill_hash) { skillHash = own.skill_hash; kind = own.kind; taken.push('skill'); } else why.skill = 'no --skill given';
  if (opts.suite) suite = cache.suite || (cache.suite = suiteIdentity(JSON.parse(fs.readFileSync(opts.suite, 'utf8'))));
  // Spec 185 (R-7): the hash a run records for each case, so a criteria case's is read as its own.
  // Issue 196 (A-185-16): and, for a criteria case, the form 0.19.0 wrote, so a receipt carrying it is
  // said to, never read as another rubric without a word.
  let earlier = null;
  if (suite) {
    rubrics = Object.fromEntries(suite.cases.map((c) => [c.id, caseRubricHash(c)]));
    earlier = Object.fromEntries(suite.cases.filter((c) => Array.isArray(c.criteria)).map((c) => [c.id, caseRubricHash0190(c)]));
  } else if (own && !opts.skill && own.suite_hash) {
    suite = { suiteHash: own.suite_hash, caseIds: own.case_ids };
    rubrics = own.rubrics;
  }
  if (!suite) { why.suite = 'no --suite or --skill given'; why.rubric = why.suite; }
  // Harness: the receipt's harness name, else its surface's.
  const name = (rec.harness && rec.harness.name) || SURFACE_HARNESS[(receipt.run || {}).surface] || null;
  let harness = null;
  if (!name) why.harness = 'the receipt names no harness and no surface with one';
  else if (name === 'api') harness = { name: 'api', version: null };
  else if (opts.noHarnessCheck) why.harness = 'not checked (--no-harness-check)';
  else if (opts.harnessVersion) harness = { name, version: String(opts.harnessVersion) };
  else {
    const v = cache[`h:${name}`] || (cache[`h:${name}`] = harnessVersionNow(name));
    harness = { name, version: v.version };
    if (v.version == null) why.harness = v.why;
  }
  // Capture mode (spec 146 R-1): --capture, else the working directory's rc, else `run`'s own default.
  // The suite carries no mode, and a skill directory's rc has `capture` dropped by bin/driftproof loadRc.
  const capture = assertMode(opts.capture || (rc.capture != null ? rc.capture : DEFAULT_CAPTURE));
  return {
    prov: {
      capture,
      // Spec 438: `driftproof run` is configured to inject, so today's delivery is injected.
      kind, delivery: 'injected',
      model_id: model, harness, skill_hash: skillHash, suite_hash: suite ? suite.suiteHash : null,
      case_ids: suite ? ('caseIds' in suite ? suite.caseIds : [...new Set(suite.cases.map((c) => c.id))].sort()) : null,
      judge_model_id: judge, judge_template_hash: promptTemplateHash(), rubrics,
    },
    why,
    taken,
    earlier,
  };
}

// The subject --skill names: a skill directory as before (its suite may be given apart with --suite), or
// a context file, whose suite --suite gives (spec 438).
function staleSubject(subject, suiteFile) {
  let dir = false;
  try { dir = fs.statSync(subject).isDirectory(); } catch (_e) { dir = false; }
  return dir ? { ...loadSkill(subject), unit: 'skill' } : loadSubject(subject, { suite: suiteFile });
}

// Issue 196 (A-185-16): a criteria case whose recorded rubric hash is the form 0.19.0 wrote, for the
// same criteria, reads as moved, because this runner's form also covers how each criterion line is
// rendered, and the receipt cannot show that rendering. The axis keeps its effect and says why.
function earlierForm(axes, receipt, earlier) {
  const e = axes.find((x) => x.axis === 'rubric' && Array.isArray(x.cases));
  if (!e || !earlier) return;
  const rec = provenanceOf(receipt).rubrics || {};
  const old = e.cases.filter((id) => typeof earlier[id] === 'string' && rec[id] === earlier[id]);
  if (!old.length) return;
  e.reason = `${e.reason}; case(s) ${old.join(', ')} record the rubric hash in the form 0.19.0 wrote for a criteria case, which did not cover how each criterion line is rendered, so this runner's form differs for the same criteria; a regrade records the current form`;
}

// The newer-model advisory (spec 053 R-9): same family, registered, released after both the run's
// date and the recorded model's release date. No advisory when either date is missing.
const dated = (m) => !!m && typeof m.released === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.released);
function advisories(receipt) {
  const reg = loadRegistry();
  const id = (receipt.run || {}).model_id;
  const row = id ? reg.byId[resolveModel(id)] || reg.byId[id] : null;
  const runDay = typeof (receipt.run || {}).date_utc === 'string' ? receipt.run.date_utc.slice(0, 10) : null;
  if (!dated(row) || !runDay) return [];
  return reg.models
    .filter((m) => m.id !== row.id && m.family === row.family && !m.auto_added && dated(m) && String(m.released) > runDay && String(m.released) > String(row.released))
    .sort((a, b) => (a.released === b.released ? (a.id < b.id ? -1 : 1) : (a.released < b.released ? 1 : -1)))
    .map((m) => ({ model_id: m.id, released: m.released }));
}

// The capture axis (spec 146). The receipt's recorded mode against the mode today. A different mode
// reruns both arms: a files run turns writes on for both and a text run turns them off for both, so
// the generation would differ in each. A receipt that records none cannot be told, and is never
// current. Built here and not in lib/reuse.js compareProvenance (spec 146 R-6): that function's
// callers are triage(), which no product code calls, and spec 053's table, whose base record
// records no mode.
function captureAxis(receipt, mode) {
  const run = receipt.run || {};
  const recorded = run.capture && typeof run.capture.mode === 'string' ? run.capture.mode : null;
  const axis = { axis: 'capture', recorded, current: mode };
  const arms = ['with_skill', 'baseline'];
  if (recorded === null) return { ...axis, effect: 'unknown', arms, reason: 'the receipt records no capture mode (receipts before v0.10 carry none); the mode today is text unless --capture or capture in the working directory\'s .driftproofrc says otherwise' };
  if (recorded === 'repository' && mode === 'repository') {
    let current;try{const e=require('./repository-execution').environment();current={...require('./repository').policy(),runtime_image_digest:e.runtime_image_digest,effective_environment_hash:e.effective_environment_hash};}catch{return {...axis,effect:'unknown',arms,reason:'The pinned repository environment is unavailable.'};}
    if(require('./canonical').canonicalize(current)!==require('./canonical').canonicalize(run.capture))return {...axis,effect:'rerun',arms,reason:'Repository measurement contract differs.'};
  }
  if (recorded === mode) return { ...axis, effect: 'current', arms, reason: 'unchanged' };
  return { ...axis, effect: 'rerun', arms, reason: 'the capture mode differs, so the answer the judge sees would differ' };
}

// The command to run next (spec 053 R-7). A mode given as --capture is carried, so running the command
// does what the check assumed; a mode from the rc or the default is the one `run` reads itself.
// Spec 438 (AC-16): each path and id in it is one shell argument, quoted where it needs to be, so the
// command gives back the path a reader gave; a context file's names its suite.
function nextCommand(file, receipt, arms, opts, current) {
  const skillArg = opts.skill ? `${shellArg(opts.skill)}${current.kind === 'context_file' && opts.suite ? ` --suite ${shellArg(opts.suite)}` : ''}` : '<skill dir>';
  const d = [arms.with_skill.decision, arms.baseline.decision];
  if (d.includes('rerun')) return `${PROJECT_NAME} run ${skillArg} --model ${shellArg(current.model_id && !current.model_id.includes(',') ? current.model_id : receipt.run.model_id)}${opts.capture ? ` --capture ${current.capture}` : ''}`;
  if (d.includes('regrade')) return `${PROJECT_NAME} regrade ${shellArg(file)} --skill ${skillArg} --answers <answers.json> --judge-model ${shellArg(current.judge_model_id || receipt.run.judge.model_id)}`;
  return null;
}

function assess(file, receipt, opts, cache) {
  const { prov, why, taken, earlier } = currentProvenance(receipt, opts, cache);
  const axes = compareProvenance(provenanceOf(receipt), prov, why);
  earlierForm(axes, receipt, earlier);
  // After the harness, so the axes that change the generation are read together (spec 146 R-4).
  axes.splice(axes.findIndex((e) => e.axis === 'harness') + 1, 0, captureAxis(receipt, prov.capture));
  const arms = armDecisions(axes);
  const d = [arms.with_skill.decision, arms.baseline.decision];
  const status = d.includes('rerun') || d.includes('regrade') ? 'stale' : d.includes('unknown') ? 'unknown' : 'current';
  const run = receipt.run || {};
  return {
    path: file,
    receipt_hash: receipt.receipt_hash || null,
    skill: (receipt.skill && receipt.skill.name) || null,
    model_id: run.model_id || null,
    date_utc: run.date_utc || null,
    verification_level: receipt.verification_level || null,
    status,
    arms,
    axes,
    advisories: advisories(receipt),
    runner_version: { recorded: run.runner_version || null, current: RUNNER_VERSION },
    next: nextCommand(file, receipt, arms, opts, prov),
    // Spec 173: which axes were read from the receipt, for a caller that asked (the view); never in
    // `driftproof stale`'s output, whose fields do not move.
    ...(opts.fromReceipt ? { taken } : {}),
  };
}

// The whole report: every receipt read, validated and assessed, and the exit code (spec 053 R-8).
function staleReport(files, opts = {}) {
  const cache = {};
  const receipts = files.map((file) => {
    let r;
    // Spec 438: through the bounded reader; every diagnostic bounded.
    if (!fs.existsSync(file)) return { path: file, error: 'the file does not exist' };
    try { r = readReceiptFile(file); } catch (e) { return { path: file, error: e.code === 'RECEIPT_JSON' ? `the file is not a readable JSON document: ${e.message}` : `the receipt is refused: ${e.message}` }; }
    const v = validateReceipt(r);
    if (!v.valid) return { path: file, error: `the receipt does not validate: ${boundedErrors(v.errors).slice(0, 2).map((x) => (typeof x === 'string' ? x : `${x.instancePath || ''} ${x.message || ''}`.trim())).join('; ')}` };
    // As `driftproof validate` reads a receipt: the schema, and the hash over its content.
    if (!verifyReceiptHash(r)) return { path: file, error: 'the receipt_hash does not match the receipt\'s content' };
    try { return assess(file, r, opts, cache); } catch (e) { return { path: file, error: `the receipt could not be assessed: ${e.message}` }; }
  });
  const ok = receipts.filter((x) => !x.error);
  // Advisories: a newer model, and an axis that moved by a patch release only (A-053-1).
  const summary = { receipts: receipts.length, current: ok.filter((x) => x.status === 'current').length, stale: ok.filter((x) => x.status === 'stale').length, unknown: ok.filter((x) => x.status === 'unknown').length, errors: receipts.length - ok.length, advisories: ok.reduce((n, x) => n + x.advisories.length + x.axes.filter((e) => e.effect === 'advisory').length, 0) };
  let exit = summary.errors ? 2 : summary.stale ? 1 : summary.unknown || summary.advisories ? 3 : 0;
  if (opts.strict && exit === 3) exit = 1;
  return { schema: SCHEMA_ID, runner_version: RUNNER_VERSION, strict: !!opts.strict, receipts, summary, exit_code: exit };
}

// ── the human output ─────────────────────────────────────────────────────────
const LABEL = { model: 'model', harness: 'harness', capture: 'capture', skill: 'skill', suite: 'suite', judge_model: 'judge model', judge_template: 'judge template', rubric: 'rubric' };
const short = (v) => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v.slice(0, 8) : v == null ? 'unrecorded' : String(v));
function effectText(e) {
  if (e.effect === 'unknown') return `unknown: ${e.reason}`;
  if (e.effect === 'advisory') return 'a patch release only (advisory)';
  if (e.effect === 'regrade') return e.cases ? `regrade case(s) ${e.cases.join(', ')}` : 'regrade both arms';
  if (e.effect === 'rerun') {
    if (e.arms.length === 1) return 'rerun the with-skill arm; baseline still valid';
    const extra = [e.cases_added && e.cases_added.length ? `added ${e.cases_added.join(', ')}` : '', e.cases_removed && e.cases_removed.length ? `removed ${e.cases_removed.join(', ')}` : '', e.cases ? `rubric moved on ${e.cases.join(', ')}` : ''].filter(Boolean).join('; ');
    return `rerun both arms${extra ? ` (${extra})` : ''}`;
  }
  return 'unchanged';
}
function renderText(doc) {
  const L = [];
  for (const x of doc.receipts) {
    // Spec 438 (AC-16): a name, an id or a path a receipt or a reader supplied, made visible for a terminal.
    if (x.error) { L.push(`${invisibleShown(x.path)}   ERROR`, `  ${invisibleShown(x.error)}`, ''); continue; }
    L.push(`${x.skill ? invisibleShown(x.skill) : '(no skill)'}   ${x.model_id ? invisibleShown(x.model_id) : '(no model)'}   ${x.date_utc ? invisibleShown(String(x.date_utc).slice(0, 10)) : '(no date)'}   ${x.status.toUpperCase()}`);
    for (const e of x.axes) {
      if (e.effect === 'current' && e.axis !== 'judge_model') continue;
      const now = e.current == null ? 'not known' : short(e.current);
      const move = e.effect === 'current' ? `${now}, unchanged` : `${short(e.recorded)} to ${now}`;
      if (e.axis === "rubric" && e.reason) L.push(`    ${invisibleShown(e.reason)}`);
      // Two spaces at least between the move and its effect, however long the move (approval F-1).
      L.push(`  ${LABEL[e.axis].padEnd(14)}${(invisibleShown(move) + '  ').padEnd(38)}${e.effect === 'current' ? '' : invisibleShown(effectText(e))}`.trimEnd());
    }
    for (const a of x.advisories) L.push(`  ${'newer model'.padEnd(14)}${invisibleShown(a.model_id)}, released ${invisibleShown(a.released)} (advisory)`);
    L.push(`  ${'next'.padEnd(14)}${x.next || (x.status === 'current' ? 'nothing to run' : 'nothing can be decided until the unknown axes are known')}`, '');
  }
  const s = doc.summary;
  L.push(`${s.receipts} receipt(s): ${s.current} current, ${s.stale} stale, ${s.unknown} unknown, ${s.errors} error(s); exit ${doc.exit_code}${doc.strict ? ' (--strict)' : ''}`);
  return L.join('\n') + '\n';
}

module.exports = { staleReport, renderText, currentProvenance, advisories, SCHEMA_ID };
