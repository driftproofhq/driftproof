// SPDX-License-Identifier: Apache-2.0
'use strict';

// The project name lives in exactly ONE place so a future rename touches one
// constant. Everything user-facing (CLI banner, receipt runner id, file names)
// derives from PROJECT_NAME.
const PROJECT_NAME = 'driftproof';

// Bumped whenever the runner's behaviour or receipt-generation semantics change
// in a way that could affect results. Recorded into every receipt as
// run.runner_version so a receipt is reproducible against a known engine.
const RUNNER_VERSION = '0.4.0';

// The eval format we CONSUME (we deliberately do not invent our own).
const SUITE_FORMAT = 'agentskills.io/evals';

// Receipt schema version this runner emits. Loader/validator accept older
// versions too (see lib/receipt.js), but new receipts are stamped current.
// v0.3   adds transcript-auditability: per-case generation_hash + judge_sample_
//        hashes[], plus run.registry and run.transcripts.
// v0.3.1 (additive over v0.3) adds run.provider (two-axis provider), the OpenAI
//        surface enums (openai-api/openai-cli), optional run.surface_overhead_note,
//        optional per-case checks[] (deterministic post-checks), and optional
//        skill.tokens (value-per-token axis). v0.1/v0.2/v0.3 receipts still load.
const RECEIPT_SCHEMA_VERSION = '0.3.1';

// Hard USD budget defaults per entry point (Week 4). --max-usd overrides any of
// these. The projection is refused before any call if it exceeds the cap, on
// BOTH surfaces; a run also hard-stops mid-flight at 1.25× (see lib/cost.js).
//   dev     — an interactive `driftproof run`
//   report  — a full Report-#001-style suite run (scripts/run-report-001.js)
//   trigger — a release-trigger-initiated prepare-report run
const DEV_MAX_USD = 2;
const REPORT_MAX_USD = 40;
const TRIGGER_MAX_USD = 25;

// Default number of judge samples per case in sampled mode. Sampling is what
// turns a single noisy grade into a mean ± band; --samples overrides it.
const DEFAULT_JUDGE_SAMPLES = 5;

// Minimum practical-effect floor for a drift verdict. Band separation alone is
// necessary but NOT sufficient to claim a regression/improvement: the mean must
// ALSO move by at least this much. Rationale — the Haiku judge quantizes scores
// to a coarse ~0.05–0.1 grid, so a confident grade often has stddev 0 (a "point
// band"). Two point bands that differ by a single quantum (e.g. 0.60 vs 0.64)
// are technically non-overlapping yet represent no meaningful behaviour change.
// The floor turns such statistically-separated-but-trivial moves into
// "within noise (below effect floor)". 0.05 = one judge quantum. Documented in
// spec/RECEIPT.md § "Drift verdict rule" and the report methodology.
const EFFECT_FLOOR = 0.05;

// Report #002 is the first CROSS-PROVIDER report: the same suites, the same fixed
// Haiku judge, run on two substrates — a Claude flagship and a GPT flagship. The
// GPT flagship is a config constant (not hard-coded across scripts) so a future
// edition swaps one line. Default: the current GPT flagship, gpt-5.6-sol.
const REPORT_002_CLAUDE_MODEL = 'claude-sonnet-5';
const REPORT_002_GPT_MODEL = 'gpt-5.6-sol';
const REPORT_002_JUDGE_MODEL = 'claude-haiku-4-5';

// Report #003 is a RELEASE DRIFT report (Report #001's type): one provider, two
// model versions, verdicts REGRESSED/IMPROVED/MIXED/WITHIN NOISE per skill under
// the per-case band-separation rule + effect floor. New vs its family predecessor.
const REPORT_003_NEW_MODEL = 'claude-opus-5';
const REPORT_003_OLD_MODEL = 'claude-opus-4-8';
const REPORT_003_JUDGE_MODEL = 'claude-haiku-4-5';

// Report #004 is a CAPABILITY-GAP report (Report #002's verdict style, ONE
// provider, TWO tiers): fable-5 has NO family predecessor, so this is a
// cross-family study, NOT release drift. Per skill: the with/without delta on
// EACH model with bands; tier comparison is context. Headline question: does
// encoded expertise still lift output on the frontier tier?
const REPORT_004_BASE_MODEL = 'claude-opus-5';     // flagship tier
const REPORT_004_FRONTIER_MODEL = 'claude-fable-5'; // frontier tier (full id — no alias)
const REPORT_004_JUDGE_MODEL = 'claude-haiku-4-5';

module.exports = {
  PROJECT_NAME, RUNNER_VERSION, SUITE_FORMAT, RECEIPT_SCHEMA_VERSION, DEFAULT_JUDGE_SAMPLES,
  EFFECT_FLOOR, DEV_MAX_USD, REPORT_MAX_USD, TRIGGER_MAX_USD,
  REPORT_002_CLAUDE_MODEL, REPORT_002_GPT_MODEL, REPORT_002_JUDGE_MODEL,
  REPORT_003_NEW_MODEL, REPORT_003_OLD_MODEL, REPORT_003_JUDGE_MODEL,
  REPORT_004_BASE_MODEL, REPORT_004_FRONTIER_MODEL, REPORT_004_JUDGE_MODEL,
};
