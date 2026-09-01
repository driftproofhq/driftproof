// SPDX-License-Identifier: Apache-2.0
'use strict';

// The project name lives in exactly ONE place so a future rename touches one
// constant. Everything user-facing (CLI banner, receipt runner id, file names)
// derives from PROJECT_NAME.
const PROJECT_NAME = 'driftproof';

// Bumped whenever the runner's behaviour or receipt-generation semantics change
// in a way that could affect results. Recorded into every receipt as
// run.runner_version so a receipt is reproducible against a known engine.
const RUNNER_VERSION = '0.7.2';

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
// v0.4   (additive over v0.3.1) adds the ECONOMICS axis: per-case, per-arm
//        generation `usage` (input/output/cached tokens + measured wall_ms), a
//        separate per-case `judge_usage` (measurement overhead, excluded from
//        every skill-value figure), run.pricing_snapshot (registry prices frozen
//        at run time so derived dollars stay reproducible), and the derived
//        `economics` block. v0.3.1 is frozen as receipt.v0.3.1.schema.json;
//        v0.1/v0.2/v0.3/v0.3.1 receipts all still load.
const RECEIPT_SCHEMA_VERSION = '0.5';

// Hard USD budget defaults per entry point (Week 4). --max-usd overrides any of
// these. The projection is refused before any call if it exceeds the cap, on
// BOTH surfaces; a run also hard-stops mid-flight at 1.25× (see lib/cost.js).
//   dev     — an interactive `driftproof run`
//   report  — a full Report-#001-style suite run (scripts/run-report-001.js)
//   trigger — a release-trigger-initiated prepare-report run
// Recalibrated 2026-09-01 (spec 018). BOTH literals below were set against a
// draws=1 projection and were never rescaled when spec 014 (5e08ba2) made the
// runner draw the generation up to SAMPLING.max times per arm and spec 016 made
// estimateRunCostUSD require the draw factor. The projection grew 10x; these did
// not, so `npx driftproof run` refused every suite of two or more cases and the
// v0.7.0 Action self-test aborted with exit 3. REPORT_MAX_USD was raised 40->300
// on 2026-08-31 for exactly this reason; that pass missed the dev path, which is
// the one the Action and every npx user take.
//
// DERIVATION — the headroom the pre-sampling defaults carried is preserved, not
// widened. Bundled 10-case example, 5 judge samples, per-case factor 2+2*5 = 12:
//   draws=1  ->  120 calls, $0.3525   headroom 200/120 = 1.67x,  $2/$0.3525 = 5.67x
//   draws=10 -> 1200 calls, $3.5250   1200 * 1.67 = 2000,  $3.5250 * 5.67 = $20.00
// A 2000-call cap under draws=10 is exactly as tight as 200 was under draws=1.
// LITERALS ON PURPOSE (spec 018 AC-2): a default derived from the suite in hand
// can never fire, which retires the guard instead of recalibrating it.
const DEV_MAX_USD = 20;
const DEV_MAX_CALLS = 2000;
// Raised from $40 on 2026-08-31 by the repository owner, in daylight, recorded in
// DECISIONS. The run did not get more expensive — the projection got honest:
// spec 016 made estimateRunCostUSD require a draw factor, and v0.5 has drawn the
// generation up to SAMPLING.max times per arm since spec 014, so the old cap had
// been passing on a figure up to ten times too small. Set above the ceiling this
// instrument can currently reach (#007's measured basis at the ceiling is
// $268.83) rather than just above today's staging figure, because a cap tripped
// by the next honest run teaches everyone to nudge it.
const REPORT_MAX_USD = 300;
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

// ── generation sampling (receipt spec v0.5) ─────────────────────────────────
//
// Report #006 measured across-draw spread at sd 0.186 and 0.183 while the
// instrument sampled only the judge. These are the policy that samples the
// other axis. Constants, not literals in the runner: lib/sampling.js reads
// them, so moving one here moves the policy, and the gate asserts that by
// value rather than by grepping for a name.
//
// MIN is 3 because two draws give an sd that is barely a measurement and one
// gives none at all. MAX is 10: #006's probe used 20 by hand and found the
// shape at well under half of that, and a per-case ceiling bounds the spend.
// The SD threshold is the effect floor — a spread wider than the smallest move
// the verdict rule will call real is exactly when more draws are owed.
const GENERATION_SAMPLES_MIN = 3;
const GENERATION_SAMPLES_MAX = 10;
const GENERATION_SD_THRESHOLD = EFFECT_FLOOR;
const GENERATION_STABILITY_EPS = 0.01;

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

// Report #005 is a VALUE report — the fourth report type. It asks what a skill
// COSTS to run alongside whether it helps, over three substrates, and shows the
// three axes (accuracy lift / Δcost / Δlatency) side by side and never combined.
// Same suites, same fixed judge; the substrate list spans two providers so the
// economics are read across surfaces, not within one vendor's pricing.
const REPORT_005_MODELS = ['claude-sonnet-5', 'claude-fable-5', 'gpt-5.6-sol'];
const REPORT_005_JUDGE_MODEL = 'claude-haiku-4-5';

module.exports = {
  PROJECT_NAME, RUNNER_VERSION, SUITE_FORMAT, RECEIPT_SCHEMA_VERSION, DEFAULT_JUDGE_SAMPLES,
  EFFECT_FLOOR, DEV_MAX_USD, DEV_MAX_CALLS, REPORT_MAX_USD, TRIGGER_MAX_USD,
  GENERATION_SAMPLES_MIN, GENERATION_SAMPLES_MAX, GENERATION_SD_THRESHOLD, GENERATION_STABILITY_EPS,
  REPORT_002_CLAUDE_MODEL, REPORT_002_GPT_MODEL, REPORT_002_JUDGE_MODEL,
  REPORT_003_NEW_MODEL, REPORT_003_OLD_MODEL, REPORT_003_JUDGE_MODEL,
  REPORT_004_BASE_MODEL, REPORT_004_FRONTIER_MODEL, REPORT_004_JUDGE_MODEL,
  REPORT_005_MODELS, REPORT_005_JUDGE_MODEL,
};
