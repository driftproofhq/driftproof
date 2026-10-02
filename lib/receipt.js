// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalize, sha256 } = require('./canonical');
const { RECEIPT_SCHEMA_VERSION } = require('../config');
const { placeCounts, judgeCountsDisagree } = require('./counts');
const { aggregateBands, combineUncertainty, round } = require('./stats');

// Schema file per receipt version. The current schema is receipt.schema.json;
// older versions live alongside it so v0.1 receipts still validate. The
// validator picks the schema by the receipt's own schema_version field.
const SCHEMA_FILES = {
  '0.1': 'receipt.v0.1.schema.json',
  '0.2': 'receipt.v0.2.schema.json',
  '0.3': 'receipt.v0.3.schema.json',
  '0.3.1': 'receipt.v0.3.1.schema.json',
  // v0.4 moved from the unversioned filename to a version-pinned one when v0.5
  // took the current pointer. Without this the archive would lose v0.4: every
  // published v0.4 receipt asserts conformance by NUMBER, and the number has to
  // keep resolving to the schema it meant (AC-10).
  '0.4': 'receipt.v0.4.schema.json',
  // v0.5 moved the same way when v0.6 took the current pointer (spec 026): the
  // six report-008 receipts assert v0.5 by number, and v0.6 is not additive for
  // the validator (it requires the receipt to say what answered it), so the
  // number has to keep resolving to the schema it meant.
  '0.5': 'receipt.v0.5.schema.json',
  // v0.6 moved the same way when v0.7 took the current pointer (spec 035): v0.7 adds a
  // verdict token a reader derives (UNDERPOWERED), and a v0.6 receipt restamped 0.7
  // is refused by the const, so the number keeps resolving to the schema it meant.
  '0.6': 'receipt.v0.6.schema.json',
  // v0.7 moved the same way when v0.8 took the current pointer (spec 043): v0.8 makes
  // run.judge.samples optional and adds counts and clocks, and its const refuses a v0.7
  // receipt that has not been restamped, so the number keeps resolving to the schema it meant.
  '0.7': 'receipt.v0.7.schema.json',
  // v0.8 moved the same way when v0.9 took the current pointer (spec 049): v0.9 adds the
  // import record, the harness, the unit and activation, and its const refuses a v0.8 receipt
  // that has not been restamped, so the number keeps resolving to the schema it meant.
  '0.8': 'receipt.v0.8.schema.json',
  // v0.9 moved the same way when v0.10 took the current pointer (spec 137): v0.10 adds
  // run.capture and a draw's captured_files, and its const refuses a v0.9 receipt that has not
  // been restamped, so the number keeps resolving to the schema it meant.
  '0.9': 'receipt.v0.9.schema.json',
  '0.10': 'receipt.schema.json',
};

// THE BAND RULE, stated on every receipt (results.aggregates.band_rule, spec
// 026 AC-6) so a reader recomputes the summary from the rows by the formula
// it names rather than by guessing which of the two "bands" a receipt carries.
// Per case, stddev is the spread of judge samples; per arm, it is this.
const BAND_RULE = 'per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases';

// THE ONE PREDICATE for "this case did not complete" (spec 026 AC-3). Every
// reader in lib/ and scripts/ asks this, never the failed_timeout literal: a
// reader that excluded by that literal admitted a failed_unmeasured case (an
// empty generation, a judge with no score) into its statistics as if it had
// been measured. A case is failed when its case_status is present and is not
// 'ok'; the status names what was observed, and both failure statuses are
// recorded without fabricated samples or hashes.
const FAILED_STATUSES = ['failed_timeout', 'failed_unmeasured'];
function caseFailed(c) { return !!(c && c.case_status && c.case_status !== 'ok'); }

// Spec 062 (register row 2): the table is read by OWN key and the cache is a Map. Until this
// the lookup was `SCHEMA_FILES[version]`, so a receipt whose schema_version named an
// Object.prototype property ("constructor", "toString") found something truthy, fell back to
// the current schema's cached validator and read VALID; and a version nobody knew was checked
// against the current schema as though it had claimed it. A version that is not a row here has
// no schema, and a receipt with no schema is not valid.
const _validators = new Map();
// Lazily compile the JSON Schema validator (ajv) for a given version. Kept lazy
// so the library can be required without ajv present (pure hashing utilities).
// Returns null for a version the table does not hold.
function getValidator(version) {
  if (typeof version !== 'string' || !Object.hasOwn(SCHEMA_FILES, version)) return null;
  if (_validators.has(version)) return _validators.get(version);
  let Ajv;
  // The schema is JSON Schema draft 2020-12, so use ajv's 2020 build.
  try { Ajv = require('ajv/dist/2020'); }
  catch (_e) { throw new Error('receipt validation requires the `ajv` package (npm install)'); }
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'spec', SCHEMA_FILES[version]), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  _validators.set(version, validate);
  return validate;
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

// Spec 050: every (id, mode) pair that occurs more than once in results.cases, with
// the index of each row that carries it. A receipt is one row per case and arm; two
// rows for one pair are two measurements that every reader keyed by (id, mode) would
// collapse into one, keeping whichever came last. So a regression measured in the
// first row could vanish from the verdict while the receipt still validated and its
// hash still verified (an outside correctness audit, finding 1). This is the one
// definition of an ambiguous receipt: validation, the verdict, the decision and the
// CLI all call it, so none of them can disagree about what counts.
function duplicateCaseRows(receipt) {
  const cases = receipt && receipt.results && Array.isArray(receipt.results.cases) ? receipt.results.cases : [];
  const seen = new Map();
  cases.forEach((c, i) => {
    const key = JSON.stringify([c && c.id, c && c.mode]);
    if (!seen.has(key)) seen.set(key, { id: c && c.id, mode: c && c.mode, rows: [] });
    seen.get(key).rows.push(i);
  });
  return [...seen.values()].filter((d) => d.rows.length > 1);
}

// The sentence every refusal of an ambiguous receipt uses, so the CLI, the verdict
// and the decision say the same thing about the same receipt.
function ambiguityLine(dups) {
  return dups.map((d) => `case ${JSON.stringify(d.id)} has ${d.rows.length} ${d.mode} rows (results.cases ${d.rows.join(', ')})`).join('; ');
}

// Validate against the schema matching the receipt's own schema_version (so both
// v0.1 and v0.2 receipts validate). Returns { valid, errors, version }.
//
// Spec 062: a schema_version that is absent, or is not a version the table holds, is invalid,
// with no fallback to the current schema. Absent is not read as current: every receipt the
// runner and the importers write carries one.
function validateReceipt(receipt) {
  const version = receipt && typeof receipt === 'object' ? receipt.schema_version : undefined;
  const validate = getValidator(version);
  if (!validate) {
    return { valid: false, errors: [{ instancePath: '/schema_version', message: `unknown schema_version ${JSON.stringify(version === undefined ? null : version)}: not a version this validator holds (${Object.keys(SCHEMA_FILES).join(', ')}); no other schema was tried` }], version };
  }
  const valid = validate(receipt);
  const errors = valid ? [] : (validate.errors || []);
  // v0.8 (spec 043 AC-2): run.judge.samples and run.counts.judge_samples_per_generation
  // are two spellings of one count; a receipt that gives both must give one value. v0.9
  // and v0.10 keep both fields, so they keep the rule.
  if (version === '0.8' || version === '0.9' || version === '0.10') {
    if (judgeCountsDisagree(receipt)) errors.push({ instancePath: '/run/counts/judge_samples_per_generation', message: 'differs from run.judge.samples' });
  }
  // Spec 050 AC-2: one row per (id, mode), in every schema version. No schema can say
  // it (uniqueness over a pair of fields is outside JSON Schema), so it is said here.
  for (const d of duplicateCaseRows(receipt)) {
    for (const i of d.rows.slice(1)) errors.push({ instancePath: `/results/cases/${i}`, message: `duplicate case id and mode: ${JSON.stringify(d.id)} ${d.mode} is also at /results/cases/${d.rows[0]}` });
  }
  return { valid: errors.length === 0, errors, version };
}

// Spec 062 (register row 4): whether a receipt ran fewer cases than its suite holds. The receipt
// records the ids it ran (results.cases) and the suite's count (suite.case_count), not the
// suite's ids, so a receipt narrows its suite when either arm names fewer distinct case ids than
// the suite counts (R-5). A failed case keeps its rows, so it is not a cut. A
// narrowed receipt is not a reading of the suite its suite_hash names, and both readers treat it
// as incomplete (lib/verdict.js receiptVerdict, lib/decision.js decisionState).
function suiteNarrowed(receipt) {
  const n = receipt && receipt.suite ? receipt.suite.case_count : undefined;
  if (!Number.isInteger(n)) return false;
  const ids = { with_skill: new Set(), baseline: new Set() };
  for (const c of (receipt.results && receipt.results.cases) || []) if (c && ids[c.mode]) ids[c.mode].add(c.id);
  return ids.with_skill.size < n || ids.baseline.size < n;
}

// ── receipt files (spec 062, register row 3) ────────────────────────────────
// The writer's naming rule and the readers' listing rule, in one module. Until this the name was
// assembled in bin/driftproof and read back by lib/decision.js with a different rule: a second run
// on the same day overwrote the first, a regrade sidecar in the directory was read as a receipt
// that did not verify, and a model id with a dot was looked for in a name that held its slug.

// The file-name form of a skill name or a model id. Named for what it is rather than `slug`: the
// probe-copies rule reads an exported name, and spec 054's probe has a heading-anchor `slug` of its
// own that is not this function (spec 062 A-062-1).
function fileSlug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// <skill>-<model>[-<tag>]-<date>[-<hash12>]. `hash` is the first 12 characters of the receipt's
// own receipt_hash for a run, so two runs on one day name two files; an import passes its source
// document's hash, which keeps the name spec 049 gave it.
function receiptBaseName({ skill, model, date, hash = null, tag = null }) {
  return [fileSlug(skill), fileSlug(model), ...(tag ? [tag] : []), date, ...(hash ? [String(hash).slice(0, 12)] : [])].join('-');
}

// The regrade provenance sidecar: its name is the receipt's base name with this suffix, and its
// `format` names this version. `regrade`'s writers read both from here (lib/regrade.js the format,
// bin/driftproof the name), so the listing rule below is the writer's own (spec 069).
const REGRADE_SIDECAR = { suffix: '.regrade.json', format: 'driftproof-regrade/2' };
const REGRADE_FAMILY = REGRADE_SIDECAR.format.split('/')[0];

// The summary export kept beside its receipt: `export --out <dir>` names it the receipt's base name
// with this suffix, and lib/export.js stamps this format on it (spec 107). It carries the receipt's
// receipt_hash as a reference, so the listing rule below skips it by name and shape.
const SUMMARY_SIDECAR = { suffix: '.summary.json', format: 'driftproof/summary' };

// The files a writer puts beside a receipt that carry its receipt_hash and are not receipts. A file
// is one of these only when its name AND its shape match (spec 069, the operator's ruling Q1): a
// name alone or a shape alone is not enough, so a receipt renamed, or a sidecar renamed, is not
// passed over. None of them carries `results`.
//   - regrade provenance: `format` is a version of the regrade format. The published Report 011
//     sidecars carry the version before the writer's current one, and read as sidecars.
//   - surface record (spec 042's run): `receipt` names the receipt it sits beside, which is its own
//     name with the suffix replaced by `.json`.
//   - summary export (spec 107): `format` is the summary format and `format_version` a string of
//     digits.
const RECEIPT_SIDECARS = [
  { kind: 'regrade provenance', suffix: REGRADE_SIDECAR.suffix,
    shape: (doc) => typeof doc.format === 'string' && new RegExp(`^${REGRADE_FAMILY}/[0-9]+$`).test(doc.format) },
  { kind: 'surface record', suffix: '.surface.json',
    shape: (doc, name) => doc.receipt === `${name.slice(0, -'.surface.json'.length)}.json` },
  { kind: 'summary export', suffix: SUMMARY_SIDECAR.suffix,
    shape: (doc) => doc.format === SUMMARY_SIDECAR.format && typeof doc.format_version === 'string' && /^[0-9]+$/.test(doc.format_version) },
];
function sidecarKind(name, doc) {
  if (Object.hasOwn(doc, 'results')) return null;
  const s = RECEIPT_SIDECARS.find((x) => name.endsWith(x.suffix) && name.length > x.suffix.length && x.shape(doc, name));
  return s ? s.kind : null;
}

// Every receipt in a directory, sorted by file name: { file, receipt, error }. A `.json` file that
// parses to an object carrying `receipt_hash` or `results` is returned, unless it is a sidecar by
// name and shape (above), so the caller's hash check refuses by name a receipt with either field
// removed, rather than reading it as absent (spec 062 A-062-3 for `receipt_hash`, spec 069 for
// `results`). An object carrying neither is not a receipt and is not returned: a badge, a stale
// document. A `.json` file that does not parse IS returned, with receipt null and the
// parser's message: it may be a receipt, and spec 030 AC-2 fails its model closed as unreadable.
function listReceipts(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { out.push({ file, receipt: null, error: e.message }); continue; }
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) continue;
    if (!Object.hasOwn(receipt, 'results') && !Object.hasOwn(receipt, 'receipt_hash')) continue;
    if (sidecarKind(name, receipt)) continue;
    out.push({ file, receipt, error: null });
  }
  return out;
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

// The comparison block from the two arms' aggregates. Every null it carries is
// named: `delta_uncertainty_unavailable` is `no_cases` when an arm has no
// included case (then every score is null too: the mean of nothing is not a
// number) and `single_case` when an arm has one (a mean, no band). Otherwise
// the block is numeric and the field is absent (spec 026 AC-7).
function comparisonOf(aggWith, aggBase) {
  const noCases = aggWith.case_count === 0 || aggBase.case_count === 0;
  const single = !noCases && (aggWith.case_count < 2 || aggBase.case_count < 2);
  const cmp = {
    with_skill_score: aggWith.mean_score,
    baseline_score: aggBase.mean_score,
    delta: noCases ? null : round(aggWith.mean_score - aggBase.mean_score),
    // Combined uncertainty of the delta: quadrature sum of the two aggregate
    // bands. A figure beside the delta; the per-case band rule decides the headline.
    delta_uncertainty: noCases ? null : combineUncertainty(aggWith.stddev, aggBase.stddev),
  };
  if (noCases) cmp.delta_uncertainty_unavailable = 'no_cases';
  else if (single) cmp.delta_uncertainty_unavailable = 'single_case';
  return cmp;
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
  //
  // PAIRWISE, NOT PER ARM (spec 017 AC-5, AC-6). This filtered a FLAT list and
  // then split by mode, so a case whose baseline failed kept its with_skill arm:
  // #007's cell 3 recorded with_skill case_count 7 against baseline 6, and its
  // headline `delta` of +0.116 was a 7-case mean minus a 6-case mean.
  //
  // `comparison.delta` is PAIRED BY CONSTRUCTION — one suite, measured twice —
  // and a paired statistic computed over unequal sets is not the statistic it
  // names. So an arm that cannot be measured removes its CASE from both sides.
  //
  // Exclusion, not refusal, and the reason is recorded rather than argued: an
  // aggregate is a summary statistic, not a verdict, so the "refuse rather than
  // assert" rule that governs verdicts does not reach it; and refusing the whole
  // aggregate would discard thirteen sound arms because one failed. What the
  // aggregate owes a reader instead is that it says what it covered, which
  // `excluded_cases` provides.
  //
  // The excluded case STAYS in `results.cases`. It is removed from the mean, not
  // from the record — deleting the evidence of a failure is a different and worse
  // defect than averaging over it.
  const armUnusable = (c) => caseFailed(c)
    || (c.mean == null && c.score == null);
  const excludedIds = new Map();
  for (const c of cases) {
    if (!armUnusable(c)) continue;
    if (excludedIds.has(c.id)) { excludedIds.get(c.id).modes.push(c.mode); continue; }
    excludedIds.set(c.id, {
      id: c.id,
      modes: [c.mode],
      reason: c.reason
        || (c.generation && c.generation.stopping_reason === 'unmeasured_exhausted'
          ? 'every generation draw was unmeasured'
          : 'the arm has no measured result'),
    });
  }
  const okCases = cases.filter((c) => !excludedIds.has(c.id));
  const withSkill = okCases.filter((c) => c.mode === 'with_skill');
  const baseline = okCases.filter((c) => c.mode === 'baseline');
  const excludedCases = [...excludedIds.values()];
  // `run.failed_case_count` COUNTS CASES, and is computed FROM the list it
  // summarises rather than alongside it, so the two fields cannot disagree.
  //
  // It was `cases.length - okCases.length`, which counted ROWS. That was the
  // same number while exclusion was per arm; once AC-5 made exclusion pairwise
  // the subtraction removed BOTH arms of every excluded case, so one failed arm
  // reported 2. Measured on the archive before this fix: #006's writing-plans
  // receipt recomputed to 4 against the 2 it records, and #007's to 2 against 1
  // — two published figures doubled by a change that never named this field.
  //
  // The field's name says cases and the aggregates exclude by case, so the
  // count is the length of `results.aggregates.excluded_cases` and nothing
  // else. A case whose BOTH arms failed is one exclusion and counts once.
  const failedCount = excludedCases.length;
  const aggWith = aggregate(withSkill);
  const aggBase = aggregate(baseline);

  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    // v0.5 CAPABILITY FLAG (F-014-F). DERIVED FROM THE CASES THEMSELVES, never
    // from a caller's argument: the exposure this closes is a receipt asserting
    // something it does not carry, and a flag taken on trust from the caller
    // would be the same defect with an extra step. Absent when no case carries a
    // draw set, which is what keeps every legacy and imported receipt valid.
    ...(cases.some((c) => c && c.generation) ? { generation_sampled: true } : {}),
    skill: {
      name: skill.name,
      version: skill.version,
      content_hash: skill.contentHash,
    },
    suite: {
      format: suite.format,
      suite_hash: suite.suiteHash,
      case_count: suite.caseCount,
      // v0.5: the per-suite canary. THIS is the canonical assembly — the runner
      // built the field and this function dropped it, so the live smoke emitted
      // `canary: undefined` and the schema, which makes it optional, said
      // nothing. Caught by reading the receipt a real run produced, not by a
      // gate; the assertion that would have caught it is added with the fix.
      ...(suite.canary ? { canary: suite.canary } : {}),
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
      // v0.8 (spec 043 AC-4): when generation began, stamped by the runner before its
      // first generation call; date_utc keeps its meaning.
      ...(run.generated_at ? { generated_at: run.generated_at } : {}),
      // v0.8 (spec 043 AC-4; spec 044): a re-judge of frozen outputs. Its archived arms
      // are carried before placeCounts reads them, and the two clocks travel together.
      ...(run.arms ? { arms: run.arms } : {}),
      ...(run.judged_at ? { judged_at: run.judged_at, grader_revision: run.grader_revision } : {}),
      // v0.3: registry provenance + transcript-retention mode. Defaults keep the
      // honest, cheapest interpretation when a caller omits them.
      registry: run.registry || 'unregistered',
      transcripts: run.transcripts || 'hashes-only',
      // v0.8: no default judge-sample count; a caller that says nothing leaves it unknown.
      judge: run.judge || { temperature: null, sampling: 'single', surface: run.surface },
      // v0.6 (spec 026 AC-1, AC-2): what answered. Carried from the caller as
      // given and never defaulted: a receipt that does not say what answered it
      // is refused by the schema, which is the point.
      ...(run.answered_by ? { answered_by: run.answered_by } : {}),
      // v0.10 (spec 137): which answer was judged, `text` or `files`. Carried as given and
      // never defaulted: a receipt from a caller that does not say carries none.
      ...(run.capture && typeof run.capture.mode === 'string' ? { capture: { mode: run.capture.mode } } : {}),
    },
    results: {
      cases,
      aggregates: {
        with_skill: aggWith,
        baseline: aggBase,
        band_rule: BAND_RULE,
        // Present only when something was excluded, so a clean run's receipt is
        // unchanged and the archive does not acquire an empty field.
        ...(excludedCases.length ? { excluded_cases: excludedCases } : {}),
      },
    },
    comparison: comparisonOf(aggWith, aggBase),
    verification_level: verificationLevel,
    receipt_hash: '',
  };
  // v0.3.1 additive-optional fields (canonicalization sorts keys, so placement
  // here does not affect the hash):
  //   run.surface_overhead_note — the fixed harness preamble on the openai/cli surface.
  //   skill.tokens              — estimated SKILL.md token size (value-per-token axis).
  if (run.surface_overhead_note) receipt.run.surface_overhead_note = run.surface_overhead_note;
  if (skill.tokens != null) receipt.skill.tokens = skill.tokens;
  // v0.9, spec 053: the harness the runner read as the run began ({name, version}; absent on a stub run).
  if (run.harness && typeof run.harness.name === 'string') receipt.run.harness = { name: run.harness.name, version: run.harness.version == null ? null : String(run.harness.version) };
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
  // v0.8 counts (spec 043 AC-3, AC-7): what the runner establishes, per case. The judge
  // count is the samples the run was asked for; the generation count is the draws the
  // case recorded. A case without a draw set (failed, or a legacy caller) establishes
  // no generation count, so none is written for it.
  const judgeN = receipt.run.judge && Number.isInteger(receipt.run.judge.samples) ? receipt.run.judge.samples : null;
  placeCounts(receipt, cases.map((c, index) => ({
    index,
    counts: {
      ...(c.generation && Array.isArray(c.generation.draws) ? { generations_per_arm: c.generation.draws.length } : {}),
      ...(judgeN !== null && !caseFailed(c) ? { judge_samples_per_generation: judgeN } : {}),
    },
  })));
  return sealReceipt(receipt);
}

module.exports = {
  buildReceipt, sealReceipt, computeReceiptHash, verifyReceiptHash, validateReceipt, BAND_RULE, comparisonOf, caseFailed, FAILED_STATUSES,
  duplicateCaseRows, ambiguityLine, suiteNarrowed, fileSlug, receiptBaseName, listReceipts, REGRADE_SIDECAR, SUMMARY_SIDECAR,
};
