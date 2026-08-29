// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalize, sha256 } = require('./canonical');
const { RECEIPT_SCHEMA_VERSION } = require('../config');
const { aggregateBands, combineUncertainty, round } = require('./stats');

// Schema file per receipt version. The current schema is receipt.schema.json;
// older versions live alongside it so v0.1 receipts still validate. The
// validator picks the schema by the receipt's own schema_version field.
const SCHEMA_FILES = {
  '0.1': 'receipt.v0.1.schema.json',
  '0.2': 'receipt.v0.2.schema.json',
  '0.3': 'receipt.v0.3.schema.json',
  '0.3.1': 'receipt.v0.3.1.schema.json',
  '0.4': 'receipt.schema.json',
};

const _validators = {};
// Lazily compile the JSON Schema validator (ajv) for a given version. Kept lazy
// so the library can be required without ajv present (pure hashing utilities).
function getValidator(version) {
  const v = SCHEMA_FILES[version] ? version : RECEIPT_SCHEMA_VERSION;
  if (_validators[v]) return _validators[v];
  let Ajv;
  // The schema is JSON Schema draft 2020-12, so use ajv's 2020 build.
  try { Ajv = require('ajv/dist/2020'); }
  catch (_e) { throw new Error('receipt validation requires the `ajv` package (npm install)'); }
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'spec', SCHEMA_FILES[v]), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  _validators[v] = ajv.compile(schema);
  return _validators[v];
}

// Compute the receipt_hash: sha256 over the canonical receipt JSON with the
// receipt_hash field itself removed. Deterministic and reproducible.
function computeReceiptHash(receipt) {
  const { receipt_hash, ...rest } = receipt; // eslint-disable-line no-unused-vars
  return sha256(canonicalize(rest));
}

// Stamp (or re-stamp) the receipt_hash in place and return the receipt.
function sealReceipt(receipt) {
  receipt.receipt_hash = computeReceiptHash(receipt);
  return receipt;
}

// Verify a receipt's self-hash matches its contents (tamper-evidence lite).
function verifyReceiptHash(receipt) {
  return receipt.receipt_hash === computeReceiptHash(receipt);
}

// Validate against the schema matching the receipt's own schema_version (so both
// v0.1 and v0.2 receipts validate). Returns { valid, errors, version }.
function validateReceipt(receipt) {
  const version = (receipt && receipt.schema_version) || RECEIPT_SCHEMA_VERSION;
  const validate = getValidator(version);
  const valid = validate(receipt);
  return { valid, errors: valid ? [] : (validate.errors || []), version };
}

function mean(nums) {
  if (!nums.length) return 0;
  return round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// Aggregate one mode's cases: mean of case means, band (suite dispersion — the
// stddev of the per-case means; see lib/stats.aggregateBands), and pass count.
function aggregate(caseResults) {
  const band = aggregateBands(caseResults.map((r) => ({ mean: r.mean != null ? r.mean : r.score, stddev: r.stddev || 0, n: Array.isArray(r.samples) ? r.samples.length : 1 })));
  const passes = caseResults.filter((r) => r.outcome === 'pass').length;
  const borderline = caseResults.filter((r) => r.outcome === 'borderline').length;
  return { case_count: caseResults.length, pass_count: passes, borderline_count: borderline, mean_score: band.mean, stddev: band.stddev };
}

// Assemble a full receipt from the runner's raw pieces, seal it, and return it.
//   skill:   { name, version, contentHash }
//   suite:   { format, suiteHash, caseCount }
//   run:     { model_id, model_release_date, surface, runner_version, date_utc, judge, registry, transcripts }
//   cases:   [ { id, mode, outcome, score, mean, stddev, samples, generation_hash, judge_sample_hashes, threshold, reason, judge } ]
//   editorialReviews: optional [ { url, source, date } ]
function buildReceipt({ skill, suite, run, cases, economics = null, verificationLevel = 'TESTED', editorialReviews = null }) {
  // v0.3.1: cases marked failed_timeout are recorded in results.cases but EXCLUDED
  // from aggregates — a band is never fabricated from a case that did not complete.
  const okCases = cases.filter((c) => c.case_status !== 'failed_timeout');
  const failedCount = cases.length - okCases.length;
  const withSkill = okCases.filter((c) => c.mode === 'with_skill');
  const baseline = okCases.filter((c) => c.mode === 'baseline');
  const aggWith = aggregate(withSkill);
  const aggBase = aggregate(baseline);

  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    skill: {
      name: skill.name,
      version: skill.version,
      content_hash: skill.contentHash,
    },
    suite: {
      format: suite.format,
      suite_hash: suite.suiteHash,
      case_count: suite.caseCount,
    },
    run: {
      model_id: run.model_id,
      model_release_date: run.model_release_date == null ? null : run.model_release_date,
      // v0.3.1: two-axis provider (registry `provider`, else inferred). Defaults
      // to anthropic for any legacy caller that omits it.
      provider: run.provider || 'anthropic',
      surface: run.surface,
      runner_version: run.runner_version,
      date_utc: run.date_utc,
      // v0.3: registry provenance + transcript-retention mode. Defaults keep the
      // honest, cheapest interpretation when a caller omits them.
      registry: run.registry || 'unregistered',
      transcripts: run.transcripts || 'hashes-only',
      judge: run.judge || { samples: 1, temperature: null, sampling: 'single', surface: run.surface },
    },
    results: {
      cases,
      aggregates: { with_skill: aggWith, baseline: aggBase },
    },
    comparison: {
      with_skill_score: aggWith.mean_score,
      baseline_score: aggBase.mean_score,
      delta: round(aggWith.mean_score - aggBase.mean_score),
      // Combined uncertainty of the delta: quadrature sum of the two aggregate
      // bands. Diff uses this for the headline "within noise" vs real-move rule.
      delta_uncertainty: combineUncertainty(aggWith.stddev, aggBase.stddev),
    },
    verification_level: verificationLevel,
    receipt_hash: '',
  };
  // v0.3.1 additive-optional fields (canonicalization sorts keys, so placement
  // here does not affect the hash):
  //   run.surface_overhead_note — the fixed harness preamble on the openai/cli surface.
  //   skill.tokens              — estimated SKILL.md token size (value-per-token axis).
  if (run.surface_overhead_note) receipt.run.surface_overhead_note = run.surface_overhead_note;
  if (skill.tokens != null) receipt.skill.tokens = skill.tokens;
  // v0.4 economics (additive-optional): the frozen prices this receipt's derived
  // dollar figures were computed from, and the derived block itself. A receipt
  // from a surface that reports no usage simply omits both.
  if (run.pricing_snapshot) receipt.run.pricing_snapshot = run.pricing_snapshot;
  if (economics) receipt.economics = economics;
  // v0.3.1: mark the receipt incomplete when any case failed (excluded above).
  if (failedCount > 0) {
    receipt.run.status = 'incomplete';
    receipt.run.failed_case_count = failedCount;
  }
  if (editorialReviews && editorialReviews.length) receipt.editorial_reviews = editorialReviews;
  return sealReceipt(receipt);
}

module.exports = {
  buildReceipt, sealReceipt, computeReceiptHash, verifyReceiptHash, validateReceipt,
};
