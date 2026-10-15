// SPDX-License-Identifier: Apache-2.0
'use strict';

// Receipt interop — export (Phase 7). The lightweight interchange: a minimal,
// STABLE, flat JSON summary of one receipt (skill, model, bands, delta,
// verdict) that other tools can consume without a receipt parser. The
// "driftproof/summary" v1 keys are frozen; additions bump format_version.
// Documented in docs/interop.md; snapshot-tested in the gate.

const { verdictFromReceipt, receiptAggregatesOnly } = require('./verdict');
const { SUMMARY_SIDECAR } = require('./receipt');

const SUMMARY_FORMAT = SUMMARY_SIDECAR.format;
const SUMMARY_FORMAT_VERSION = '1';

// Build the summary object for one receipt. Deterministic for a given receipt:
// fixed key order, no export-time timestamps. `reportUrl` is caller-supplied
// (receipts do not know where their report lives), else null.
const { judgeSamplesOrNull } = require('./counts');

// Spec 265 AC-46: a receipt carrying the mark gives no score, band or delta, whatever its fields
// hold, so a summary read alone carries no lift. Its verdict is NOT_MEASURED (lib/verdict.js).
function toSummaryJson(receipt, opts = {}) {
  const s = summaryFields(receipt, opts);
  if (receiptAggregatesOnly(receipt)) {
    // Every figure of the summary's with-skill score is null, its keys kept; there is no baseline score.
    s.scores = { with_skill: Object.fromEntries(Object.keys(s.scores.with_skill).map((k) => [k, null])), baseline: null };
    s.delta = null;
    s.delta_uncertainty = null;
  }
  return s;
}

function summaryFields(receipt, { reportUrl = null } = {}) {
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
      // v0.8 (spec 043 AC-1): null when the receipt does not establish the count, never 1.
      samples: judgeSamplesOrNull(receipt),
    },
    receipt_hash: receipt.receipt_hash,
    report_url: reportUrl,
    spec: 'https://driftproofhq.com/spec/receipt.schema.json',
  };
}

module.exports = { toSummaryJson, SUMMARY_FORMAT, SUMMARY_FORMAT_VERSION };
