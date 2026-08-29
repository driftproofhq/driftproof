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
const { sealReceipt } = require('./receipt');
const { mean, stddev, round, combineUncertainty, aggregateBands } = require('./stats');
const { outcomeFor } = require('./run');
const { inferProvider } = require('./provider');
const { registryStatus } = require('./models');

const IMPORT_TOOLS = ['agent-skills-eval', 'skillgrade'];

// Aggregate a list of imported cases the same way lib/receipt.aggregate does
// (suite dispersion band). An empty mode aggregates to the conventional empty
// aggregate (case_count 0) — its absence is signalled there, and in the null
// comparison, not by fabricated numbers.
function aggregateMode(cases) {
  const band = aggregateBands(cases.map((c) => ({ mean: c.mean, stddev: c.stddev || 0, n: c.samples.length })));
  return {
    case_count: cases.length,
    pass_count: cases.filter((c) => c.outcome === 'pass').length,
    borderline_count: cases.filter((c) => c.outcome === 'borderline').length,
    mean_score: band.mean,
    stddev: band.stddev,
  };
}

// Shared receipt shell for both importers. `judgeBlock` describes the SOURCE
// tool's grading (samples = what it actually did), never our sampled judge.
function importedReceipt({ tool, skillName, skillVersion, suiteFormat, caseCount, modelId, dateUtc, judgeBlock, cases, comparison }) {
  const withSkill = cases.filter((c) => c.mode === 'with_skill');
  const baseline = cases.filter((c) => c.mode === 'baseline');
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
      runner_version: RUNNER_VERSION,
      date_utc: dateUtc,
      registry: registryStatus(modelId),
      transcripts: 'none',
      judge: judgeBlock,
    },
    results: {
      cases,
      aggregates: { with_skill: aggregateMode(withSkill), baseline: aggregateMode(baseline) },
    },
    comparison,
    verification_level: 'DECLARED',
    receipt_hash: '',
  };
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
function importAgentSkillsEval(data, { importedAt } = {}) {
  if (!data || !Array.isArray(data.evals)) throw new Error('agent-skills-eval import: expected { skill_name, target, judge, evals: [...] } (see docs/interop.md)');
  const judgeModel = data.judge || 'unknown';
  const cases = [];
  for (const ev of data.evals) {
    for (const [theirMode, ourMode] of [['with_skill', 'with_skill'], ['without_skill', 'baseline']]) {
      const grading = ev[theirMode];
      if (!grading) continue;
      const m = modeScore(grading);
      const failing = (grading.assertions || []).find((a) => a.pass === false);
      const c = {
        id: String(ev.id),
        mode: ourMode,
        outcome: grading.pass === true ? 'pass' : 'fail',
        score: m, mean: m, stddev: 0,
        samples: [m],
        threshold: null,
        judge: { model_id: judgeModel, rubric_hash: null },
      };
      if (failing && failing.reasoning) c.reason = String(failing.reasoning).slice(0, 300);
      cases.push(c);
    }
  }
  const withMeans = cases.filter((c) => c.mode === 'with_skill').map((c) => c.mean);
  const baseMeans = cases.filter((c) => c.mode === 'baseline').map((c) => c.mean);
  const hasBaseline = baseMeans.length > 0;
  const wAgg = aggregateBands(cases.filter((c) => c.mode === 'with_skill').map((c) => ({ mean: c.mean, stddev: 0, n: 1 })));
  const bAgg = aggregateBands(cases.filter((c) => c.mode === 'baseline').map((c) => ({ mean: c.mean, stddev: 0, n: 1 })));
  const comparison = {
    with_skill_score: round(mean(withMeans)),
    baseline_score: hasBaseline ? round(mean(baseMeans)) : null,
    delta: hasBaseline ? round(mean(withMeans) - mean(baseMeans)) : null,
    delta_uncertainty: hasBaseline ? combineUncertainty(wAgg.stddev, bAgg.stddev) : null,
  };
  return importedReceipt({
    tool: 'agent-skills-eval',
    skillName: data.skill_name || 'unknown',
    skillVersion: data.version,
    suiteFormat: SUITE_FORMAT, // agentskills.io/evals — same suite lineage
    caseCount: data.evals.length,
    modelId: data.target || 'unknown',
    dateUtc: data.timestamp || importedAt || new Date().toISOString(),
    judgeBlock: { samples: 1, temperature: null, sampling: 'external', surface: 'external' },
    cases,
    comparison,
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
function importSkillgrade(data, { importedAt } = {}) {
  if (!data || !Array.isArray(data.tasks)) throw new Error('skillgrade import: expected { skill, agent, tasks: [...] } (see docs/interop.md)');
  const graderModel = data.grader_model || 'unknown';
  const defaultThreshold = typeof data.threshold === 'number' ? data.threshold : 0.8;
  const cases = [];
  let maxTrials = 1;
  for (const task of data.tasks) {
    const rewards = (task.trials || []).map((t) => (typeof t === 'number' ? t : t.reward)).filter((r) => typeof r === 'number');
    if (!rewards.length) continue;
    maxTrials = Math.max(maxTrials, rewards.length);
    const m = round(mean(rewards));
    const sd = round(stddev(rewards));
    const threshold = typeof task.threshold === 'number' ? task.threshold : defaultThreshold;
    cases.push({
      id: String(task.name),
      mode: 'with_skill',
      // Same outcome rule as a Driftproof run (borderline when the threshold
      // sits inside mean ± stddev) — a deterministic READING of their numbers.
      outcome: outcomeFor(m, sd, threshold),
      score: m, mean: m, stddev: sd,
      samples: rewards.map((r) => round(r)),
      threshold,
      judge: { model_id: graderModel, rubric_hash: null },
    });
  }
  return importedReceipt({
    tool: 'skillgrade',
    skillName: data.skill || 'unknown',
    skillVersion: data.version,
    suiteFormat: 'skillgrade/eval.yaml',
    caseCount: data.tasks.length,
    // skillgrade names an AGENT CLI (claude/gemini/codex), not a model id —
    // imported verbatim (or the results' model field when present).
    modelId: data.model || data.agent || 'unknown',
    dateUtc: data.timestamp || importedAt || new Date().toISOString(),
    judgeBlock: { samples: maxTrials, temperature: null, sampling: 'external', surface: 'external' },
    cases,
    // No baseline mode exists in skillgrade — nulls, never a fabricated 0.
    comparison: {
      with_skill_score: round(mean(cases.map((c) => c.mean))),
      baseline_score: null,
      delta: null,
      delta_uncertainty: null,
    },
  });
}

// Dispatch. `from` must name a supported tool.
function importResults(data, { from, importedAt } = {}) {
  switch (from) {
    case 'agent-skills-eval': return importAgentSkillsEval(data, { importedAt });
    case 'skillgrade': return importSkillgrade(data, { importedAt });
    default: throw new Error(`unknown import source "${from}" — supported: ${IMPORT_TOOLS.join(', ')}`);
  }
}

module.exports = { importResults, importAgentSkillsEval, importSkillgrade, IMPORT_TOOLS };
