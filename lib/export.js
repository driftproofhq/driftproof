// SPDX-License-Identifier: Apache-2.0
'use strict';

// Receipt interop — export (Phase 7). The lightweight interchange: a minimal,
// STABLE, flat JSON summary of one receipt (skill, model, bands, delta,
// verdict) that other tools can consume without a receipt parser. The
// "driftproof/summary" v1 keys are frozen; additions bump format_version.
// Documented in docs/interop.md; snapshot-tested in the gate.

const { verdictFromReceipt } = require('./verdict');

const SUMMARY_FORMAT = 'driftproof/summary';
const SUMMARY_FORMAT_VERSION = '1';

// Build the summary object for one receipt. Deterministic for a given receipt:
// fixed key order, no export-time timestamps. `reportUrl` is caller-supplied
// (receipts do not know where their report lives), else null.
function toSummaryJson(receipt, { reportUrl = null } = {}) {
  const agg = receipt.results.aggregates;
  const cmp = receipt.comparison || {};
  const hasBaseline = agg.baseline && agg.baseline.case_count > 0;
  const v = verdictFromReceipt(receipt);
  return {
    format: SUMMARY_FORMAT,
    format_version: SUMMARY_FORMAT_VERSION,
    skill: { name: receipt.skill.name, version: receipt.skill.version },
    model: {
      id: receipt.run.model_id,
      provider: receipt.run.provider || 'anthropic',
      surface: receipt.run.surface,
    },
    run_date_utc: receipt.run.date_utc,
    scores: {
      with_skill: { mean: agg.with_skill.mean_score, stddev: agg.with_skill.stddev },
      baseline: hasBaseline ? { mean: agg.baseline.mean_score, stddev: agg.baseline.stddev } : null,
    },
    delta: typeof cmp.delta === 'number' ? cmp.delta : null,
    delta_uncertainty: typeof cmp.delta_uncertainty === 'number' ? cmp.delta_uncertainty : null,
    verdict: v.verdict,
    verification_level: receipt.verification_level,
    source: receipt.run.source || 'driftproof',
    judge: {
      model_id: (receipt.results.cases.find((c) => c.judge) || { judge: { model_id: 'unknown' } }).judge.model_id,
      samples: (receipt.run.judge || {}).samples || 1,
    },
    receipt_hash: receipt.receipt_hash,
    report_url: reportUrl,
    spec: 'https://driftproofhq.com/spec/receipt.schema.json',
  };
}

module.exports = { toSummaryJson, SUMMARY_FORMAT, SUMMARY_FORMAT_VERSION };
