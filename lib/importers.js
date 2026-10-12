// SPDX-License-Identifier: Apache-2.0
'use strict';

// Receipt interop — importers (Phase 7). Convert results from neighboring eval
// tools into valid Driftproof receipts with HONEST epistemics:
//
//   - verification_level DECLARED (never TESTED — we did not run, hash, or
//     judge the generations),
//   - run.surface "external" + run.source "imported/<tool>",
//   - generation/judge-sample hashes OMITTED, content/suite/rubric hashes null —
//     hashes are never fabricated,
//   - no baseline mode in the source tool → empty baseline aggregate + null
//     comparison, never a fabricated 0-baseline.
//
// The per-tool field mappings (and the assumed-shape disclosure — neither tool
// publishes a frozen results schema, so the checked-in fixtures ARE the
// compatibility contract) are documented in docs/interop.md.

const { RECEIPT_SCHEMA_VERSION, RUNNER_VERSION, SUITE_FORMAT } = require('../config');
const { sealReceipt, comparisonOf } = require('./receipt');
const { mean, stddev, round } = require('./stats');
const { outcomeFor } = require('./run');
const { inferProvider } = require('./provider');
const { registryStatus } = require('./models');
const { placeCounts } = require('./counts');

const IMPORT_TOOLS = ['agent-skills-eval', 'skillgrade'];

// Issue 13: fixed resource bounds apply to every imported format, including sidecars.
const IMPORT_METHOD = 'matched-measured-cases/1';
const IMPORT_MAX_BYTES = 16 * 1024 * 1024;
const importScoreValid = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
function importDiagnostic(text, max = 2048) {
  return String(text).replace(/[\x00-\x1f\x7f\u2028\u2029]/g, c => /[\x7f\u2028\u2029]/.test(c) ? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0') : JSON.stringify(c).slice(1, -1)).slice(0, max);
}
function readImportBytes(file) {
  const fs = require('node:fs');
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > IMPORT_MAX_BYTES) throw new Error('import byte limit exceeded or input is not a regular file');
    const buf = Buffer.alloc(IMPORT_MAX_BYTES + 1);
    let n = 0, got;
    while (n < buf.length && (got = fs.readSync(fd, buf, n, buf.length - n, null)) > 0) n += got;
    if (n > IMPORT_MAX_BYTES) throw new Error('import byte limit exceeded');
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}
function checkImportInput(data) {
  const stack = [[data, 0]]; let entries = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (++entries > 200000 || depth > 32) throw new Error('import JSON entry or depth limit exceeded');
    if (typeof v === 'string' && v.length > 16384) throw new Error('import text limit exceeded');
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length > 10000) throw new Error('import array or object entry limit exceeded');
      for (const k of keys) {
        if (k.length > 16384) throw new Error('import text limit exceeded');
        stack.push([v[k], depth + 1]);
      }
    }
  }
}
function importCaseIdentity(value, seen, stringsOnly = false) {
  if (!((typeof value === 'string' && value.length && value.length <= 256 && JSON.stringify(value).length <= 512) || (!stringsOnly && Number.isSafeInteger(value)))) throw new Error('invalid or unsafe case identity');
  const id = String(value), type = typeof value;
  if (seen.has(id) && seen.get(id) !== type) throw new Error('ambiguous numeric and string case identity');
  seen.set(id, type); return id;
}
function importExclusionNotices(excluded) {
  return excluded.map(e => importDiagnostic('case ' + JSON.stringify(e.id) + ' (' + e.modes.join(', ') + '): ' + importDiagnostic(e.reason, 600), 1024));
}
function expectationIdentity(list, key) {
  if (!Array.isArray(list) || !list.length || !list.every(e => e && typeof e[key] === 'string')) return null;
  return JSON.stringify(list.map(e => e[key]).sort());
}

// Shared receipt shell for both importers. `judgeBlock` describes the SOURCE
// tool's grading, never our sampled judge. v0.8 (spec 043): it carries no sample
// count, because neither source format defines one; `perCase` carries only the counts
// the source establishes, and placeCounts writes them at the narrowest honest scope.
// A case with no observation (case_status no_observations) is listed, excluded from
// every aggregate, and named in excluded_cases with `excludedReasons[id]`.
function importedReceipt({ tool, skillName, skillVersion, suiteFormat, caseCount, modelId, dateUtc, judgeBlock, cases, comparison, perCase = [], excludedReasons = {}, conflicts = new Map(), importedAt, sourceBytes, comparative = true }) {
  const reasons = Object.fromEntries(cases.map((c, i) => [i, Object.hasOwn(excludedReasons, c.id) ? excludedReasons[c.id] : undefined]));
  const calculated = comparisonOf(cases, { comparative, conflicts, reasons });
  const notices = importExclusionNotices(calculated.aggregates.excluded_cases || []);
  if (comparative && calculated.comparison.delta === null) notices.push('no usable matched case remains: the comparison is unavailable');
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    skill: {
      name: skillName,
      version: skillVersion || 'unknown',
      // Never seen the skill bytes — null, never fabricated.
      content_hash: null,
    },
    suite: { format: suiteFormat, suite_hash: null, case_count: caseCount },
    run: {
      model_id: modelId,
      model_release_date: null,
      provider: inferProvider(modelId),
      surface: 'external',
      source: `imported/${tool}`,
      import: { tool, format: tool, format_version: null, comparison_method: IMPORT_METHOD, source_sha256: require('node:crypto').createHash('sha256').update(sourceBytes || JSON.stringify(cases)).digest('hex'), imported_at: importedAt || null, ...(notices.length ? { notices } : {}) },
      runner_version: RUNNER_VERSION,
      date_utc: dateUtc,
      registry: registryStatus(modelId),
      transcripts: 'none',
      // v0.6: the source tool's grader is the judge that ran; its template is
      // not ours to hash (null, the one place the schema allows it).
      judge: { ...judgeBlock, model_id: (cases.find((c) => c.judge && c.judge.model_id) || { judge: { model_id: 'unknown' } }).judge.model_id, prompt_template_hash: null },
      // v0.6 (spec 026 AC-1): what answered. An external tool's harness did;
      // nothing here attested a model, and nothing was spawned by us.
      answered_by: { kind: 'external', attested: false, reported_model: null, reported_models: null, isolation: 'none' },
    },
    results: {
      cases,
      aggregates: calculated.aggregates,
    },
    comparison: comparative ? calculated.comparison : comparison,
    verification_level: 'DECLARED',
    receipt_hash: '',
  };
  placeCounts(receipt, perCase);
  return sealReceipt(receipt);
}

// ── agent-skills-eval (darkrishabh/agent-skills-eval) ────────────────────────
// Same suite lineage as Driftproof (agentskills.io evals.json). Runs each eval
// with_skill and without_skill; an LLM judge grades BINARY per assertion. The
// converter reads the rolled-up benchmark artifact:
//   { skill_name, version?, target, judge, timestamp?, evals: [
//       { id, with_skill: { pass, assertions?: [{assertion, pass, reasoning?}] },
//         without_skill: { ... } } ] }
// Per (eval, mode): mean = fraction of assertions passed (else 1/0 from the
// eval-level pass); samples = [mean] — the ONE grade their judge produced,
// never resampled; stddev 0; outcome from their pass verdict.
function modeScore(grading) {
  const asserts = Array.isArray(grading.assertions) ? grading.assertions : [];
  if (asserts.length) return round(asserts.filter((a) => a.pass === true).length / asserts.length);
  return grading.pass === true ? 1 : 0;
}
function importAgentSkillsEval(data, { importedAt, sourceBytes } = {}) {
  checkImportInput(data);
  sourceBytes ||= Buffer.from(JSON.stringify(data));
  if (!data || !Array.isArray(data.evals)) throw new Error('agent-skills-eval import: expected { skill_name, target, judge, evals: [...] } (see docs/interop.md)');
  if (!data.timestamp && !importedAt) importedAt = new Date().toISOString();
  const judgeModel = data.judge || 'unknown';
  const cases = []; const conflicts = new Map(); const seen = new Map(); const ids = new Set();
  for (const ev of data.evals) {
    const id = importCaseIdentity(ev.id, seen);
    if (ids.has(id)) throw new Error('duplicate eval identity'); ids.add(id);
    const bases = [ev.with_skill, ev.without_skill].filter(Boolean).map(g => expectationIdentity(g.assertions, 'assertion')).filter(x => x !== null);
    const totals = [ev.with_skill, ev.without_skill].filter(g => Array.isArray(g?.assertions) && g.assertions.length).map(g => g.assertions.length);
    if (new Set(totals).size > 1 || new Set(bases).size > 1) conflicts.set(id, { modes: ['with_skill', 'baseline'], reason: 'the recorded assertion totals or grading identities differ' });
    for (const [theirMode, ourMode] of [['with_skill', 'with_skill'], ['without_skill', 'baseline']]) {
      const grading = ev[theirMode];
      if (!grading) continue;
      const assertions = Array.isArray(grading.assertions) ? grading.assertions : [];
      if (grading.error != null || (assertions.length ? !assertions.every(a => a && typeof a.pass === 'boolean') : typeof grading.pass !== 'boolean')) {
        cases.push({ id, mode: ourMode, case_status: 'no_observations', excluded_draws: [{ draw_index: 1, reason: 'the source gives this grading no usable boolean scoring evidence or records an error' }] }); continue;
      }
      const m = modeScore(grading);
      const failing = assertions.find((a) => a.pass === false);
      const c = {
        id,
        mode: ourMode,
        outcome: typeof grading.pass === 'boolean' ? (grading.pass ? 'pass' : 'fail') : 'score',
        score: m, mean: m, stddev: 0,
        samples: [m],
        threshold: null,
        judge: { model_id: judgeModel, rubric_hash: null },
      };
      if (failing && failing.reasoning) c.reason = String(failing.reasoning).slice(0, 300);
      cases.push(c);
    }
  }
  return importedReceipt({
    tool: 'agent-skills-eval', importedAt, sourceBytes, conflicts,
    skillName: data.skill_name || 'unknown',
    skillVersion: data.version,
    suiteFormat: SUITE_FORMAT, // agentskills.io/evals — same suite lineage
    caseCount: data.evals.length,
    modelId: data.target || 'unknown',
    dateUtc: data.timestamp || importedAt,
    // No count of either kind: the agent-skills-eval benchmark format defines neither
    // (spec 043 AC-5, A-1), so none is written until it does.
    judgeBlock: { temperature: null, sampling: 'external', surface: 'external' },
    cases,
  });
}

// ── skillgrade (mgechev/skillgrade) ──────────────────────────────────────────
// "Unit tests for your agent skills": N trials per task, each trial's reward =
// weighted grader scores (0..1), compared against a threshold. NO baseline mode
// — so the receipt carries an empty baseline aggregate and a null comparison.
// Trials are real repeated runs, so per-trial rewards map onto samples[]
// honestly (a genuine cross-trial band). Expected shape:
//   { skill, agent, grader_model?, threshold?, timestamp?, tasks: [
//       { name, threshold?, trials: [ { reward }, ... ] } ] }
function importSkillgrade(data, { importedAt, sourceBytes } = {}) {
  checkImportInput(data);
  sourceBytes ||= Buffer.from(JSON.stringify(data));
  if (!data || !Array.isArray(data.tasks)) throw new Error('skillgrade import: expected { skill, agent, tasks: [...] } (see docs/interop.md)');
  if (!data.timestamp && !importedAt) importedAt = new Date().toISOString();
  const graderModel = data.grader_model || 'unknown';
  const defaultThreshold = typeof data.threshold === 'number' ? data.threshold : 0.8;
  const cases = [];
  const perCase = [];
  const excludedReasons = Object.create(null);
  const seen = new Map(); const ids = new Set();
  for (const task of data.tasks) {
    const id = importCaseIdentity(task.name, seen, true);
    if (ids.has(id)) throw new Error('duplicate task identity'); ids.add(id);
    // Spec 043 A-3: keep the distinction the source makes. A trials list that is
    // present and empty is zero observations; no trials field is an unknown count.
    // Either way the task is listed and contributes no figure.
    if (!Array.isArray(task.trials)) {
      cases.push({ id, mode: 'with_skill', case_status: 'no_observations' });
      excludedReasons[id] = 'the source carries no trials field for this task: its trial count is unknown';
      continue;
    }
    const rewards = [];
    const rejected = [];
    task.trials.forEach((trial, i) => {
      const reward = typeof trial === 'number' ? trial : trial?.reward;
      if (importScoreValid(reward) && trial?.error == null && trial?.skippedPaidGraders !== true) rewards.push(reward);
      else rejected.push({ draw_index: i + 1, reason: 'the source gives this trial no usable reward or records an error or skipped graders' });
    });
    if (!task.trials.length) {
      perCase.push({ index: cases.length, counts: { generations_per_arm: 0 } });
      cases.push({ id, mode: 'with_skill', case_status: 'no_observations', samples: [] });
      excludedReasons[id] = 'the source lists no trials for this task (trials is empty): zero observations';
      continue;
    }
    if (!rewards.length) {
      perCase.push({ index: cases.length, counts: { generations_per_arm: 0 } });
      cases.push({ id, mode: 'with_skill', case_status: 'no_observations', excluded_draws: rejected });
      excludedReasons[id] = 'the source lists trials for this task but none carries a numeric reward';
      continue;
    }
    // Trials are independent generations (A-2): their number is this case's
    // generation count, and never a judge-sample count.
    perCase.push({ index: cases.length, counts: { generations_per_arm: rewards.length } });
    const m = round(mean(rewards));
    const sd = round(stddev(rewards));
    const threshold = typeof task.threshold === 'number' ? task.threshold : defaultThreshold;
    cases.push({
      id,
      mode: 'with_skill',
      // Same outcome rule as a Driftproof run (borderline when the threshold
      // sits inside mean ± stddev) — a deterministic READING of their numbers.
      outcome: outcomeFor(m, sd, threshold),
      score: m, mean: m, stddev: sd,
      samples: rewards.map((r) => round(r)),
      ...(rejected.length ? { excluded_draws: rejected } : {}),
      threshold,
      judge: { model_id: graderModel, rubric_hash: null },
    });
  }
  return importedReceipt({
    tool: 'skillgrade', importedAt, sourceBytes, comparative: false,
    skillName: data.skill || 'unknown',
    skillVersion: data.version,
    suiteFormat: 'skillgrade/eval.yaml',
    caseCount: data.tasks.length,
    // skillgrade names an AGENT CLI (claude/gemini/codex), not a model id —
    // imported verbatim (or the results' model field when present).
    modelId: data.model || data.agent || 'unknown',
    dateUtc: data.timestamp || importedAt,
    // No judge-sample count: the skillgrade format defines none, and a trial count is a
    // generation count (spec 043 AC-5, A-1, A-2).
    judgeBlock: { temperature: null, sampling: 'external', surface: 'external' },
    cases,
    perCase,
    excludedReasons,
    // No baseline mode exists in skillgrade — nulls, never a fabricated 0.
    comparison: {
      with_skill_score: round(mean(cases.filter((c) => !c.case_status).map((c) => c.mean))),
      baseline_score: null,
      delta: null,
      delta_uncertainty: null,
    },
  });
}

// Dispatch. `from` must name a supported tool.
function importResults(data, { from, importedAt, sourceBytes } = {}) {
  checkImportInput(data);
  switch (from) {
    case 'agent-skills-eval': return importAgentSkillsEval(data, { importedAt, sourceBytes });
    case 'skillgrade': return importSkillgrade(data, { importedAt, sourceBytes });
    default: throw new Error(`unknown import source "${from}" — supported: ${IMPORT_TOOLS.join(', ')}`);
  }
}

module.exports = { importResults, importAgentSkillsEval, importSkillgrade, IMPORT_TOOLS, IMPORT_METHOD, importScoreValid, readImportBytes, checkImportInput, importCaseIdentity, importDiagnostic, importExclusionNotices, expectationIdentity };
