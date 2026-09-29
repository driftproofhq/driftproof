// SPDX-License-Identifier: Apache-2.0
'use strict';

// `driftproof stale` (spec 053): for each receipt, does its conclusion still stand under what would
// run today, or does it need a rerun of one or both arms, or only a regrade?
//
// What a receipt recorded is read by lib/reuse.js provenanceOf; what would run today is built here,
// from the same places `driftproof run` reads (flags, then .driftproofrc; a value nobody set is
// unknown, never a default); the two are compared by lib/reuse.js compareProvenance, the function
// `triage()` uses, so the command and the triage cannot disagree about an axis.
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
const { loadSkill, suiteIdentity } = require('./skill');
const { rubricHash, promptTemplateHash } = require('./judge');
const { resolveModel } = require('./provider');
const { loadRegistry } = require('./models');
const { validateReceipt, verifyReceiptHash } = require('./receipt');
const { RUNNER_VERSION, PROJECT_NAME } = require('../config');

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
function currentProvenance(receipt, opts, cache) {
  const why = {};
  const rec = provenanceOf(receipt);
  const rc = opts.rc || {};
  // Model: --model, else the rc's models; the receipt's model is current when the rc names it.
  let model = null;
  if (opts.model) model = resolveModel(opts.model);
  else if (rc.models !== undefined && rc.models !== null) {
    const list = String(rc.models).split(',').map((x) => x.trim()).filter(Boolean).map((x) => resolveModel(x));
    model = rec.model_id && list.includes(resolveModel(rec.model_id)) ? resolveModel(rec.model_id) : list.join(',') || null;
  }
  if (!model) why.model = 'no --model given and no models in .driftproofrc';
  // Judge: --judge, else the rc's judge_model.
  const judgeRaw = opts.judge || rc.judge_model || null;
  const judge = judgeRaw ? resolveModel(judgeRaw) : null;
  if (!judge) why.judge_model = 'no --judge given and no judge_model in .driftproofrc';
  // Skill and suite.
  let skillHash = null; let suite = null;
  if (opts.skill) {
    const s = cache.skill || (cache.skill = loadSkill(opts.skill));
    skillHash = s.contentHash;
    if (!opts.suite) suite = { suiteHash: s.suite.suiteHash, cases: s.suite.cases };
  } else why.skill = 'no --skill given';
  if (opts.suite) suite = cache.suite || (cache.suite = suiteIdentity(JSON.parse(fs.readFileSync(opts.suite, 'utf8'))));
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
  const rubrics = suite ? Object.fromEntries(suite.cases.map((c) => [c.id, rubricHash(c.rubric)])) : null;
  return {
    prov: {
      model_id: model, harness, skill_hash: skillHash, suite_hash: suite ? suite.suiteHash : null,
      case_ids: suite ? [...new Set(suite.cases.map((c) => c.id))].sort() : null,
      judge_model_id: judge, judge_template_hash: promptTemplateHash(), rubrics,
    },
    why,
  };
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

// The command to run next (spec 053 R-7).
function nextCommand(file, receipt, arms, opts, current) {
  const skillArg = opts.skill || '<skill dir>';
  const d = [arms.with_skill.decision, arms.baseline.decision];
  if (d.includes('rerun')) return `${PROJECT_NAME} run ${skillArg} --model ${current.model_id && !current.model_id.includes(',') ? current.model_id : receipt.run.model_id}`;
  if (d.includes('regrade')) return `${PROJECT_NAME} regrade ${file} --skill ${skillArg} --answers <answers.json> --judge-model ${current.judge_model_id || receipt.run.judge.model_id}`;
  return null;
}

function assess(file, receipt, opts, cache) {
  const { prov, why } = currentProvenance(receipt, opts, cache);
  const axes = compareProvenance(provenanceOf(receipt), prov, why);
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
  };
}

// The whole report: every receipt read, validated and assessed, and the exit code (spec 053 R-8).
function staleReport(files, opts = {}) {
  const cache = {};
  const receipts = files.map((file) => {
    let r;
    try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { path: file, error: e.code === 'ENOENT' ? 'the file does not exist' : `the file is not a readable JSON document: ${e.message}` }; }
    const v = validateReceipt(r);
    if (!v.valid) return { path: file, error: `the receipt does not validate: ${(v.errors || []).slice(0, 2).map((x) => (typeof x === 'string' ? x : `${x.instancePath || ''} ${x.message || ''}`.trim())).join('; ')}` };
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
const LABEL = { model: 'model', harness: 'harness', skill: 'skill', suite: 'suite', judge_model: 'judge model', judge_template: 'judge template', rubric: 'rubric' };
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
    if (x.error) { L.push(`${x.path}   ERROR`, `  ${x.error}`, ''); continue; }
    L.push(`${x.skill || '(no skill)'}   ${x.model_id || '(no model)'}   ${x.date_utc ? String(x.date_utc).slice(0, 10) : '(no date)'}   ${x.status.toUpperCase()}`);
    for (const e of x.axes) {
      if (e.effect === 'current' && e.axis !== 'judge_model') continue;
      const now = e.current == null ? 'not known' : short(e.current);
      const move = e.effect === 'current' ? `${now}, unchanged` : `${short(e.recorded)} to ${now}`;
      // Two spaces at least between the move and its effect, however long the move (approval F-1).
      L.push(`  ${LABEL[e.axis].padEnd(14)}${(move + '  ').padEnd(38)}${e.effect === 'current' ? '' : effectText(e)}`.trimEnd());
    }
    for (const a of x.advisories) L.push(`  ${'newer model'.padEnd(14)}${a.model_id}, released ${a.released} (advisory)`);
    L.push(`  ${'next'.padEnd(14)}${x.next || (x.status === 'current' ? 'nothing to run' : 'nothing can be decided until the unknown axes are known')}`, '');
  }
  const s = doc.summary;
  L.push(`${s.receipts} receipt(s): ${s.current} current, ${s.stale} stale, ${s.unknown} unknown, ${s.errors} error(s); exit ${doc.exit_code}${doc.strict ? ' (--strict)' : ''}`);
  return L.join('\n') + '\n';
}

module.exports = { staleReport, renderText, currentProvenance, advisories, SCHEMA_ID };
