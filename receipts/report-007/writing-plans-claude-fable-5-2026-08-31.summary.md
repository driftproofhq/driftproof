# writing-plans — receipt summary

- **model:** `claude-fable-5`
- **surface:** claude-cli
- **run (UTC):** 2026-08-31T13:27:03.897Z
- **runner:** v0.6.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `5325ab3d55d5bacd…`
- **suite:** 7 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `5c48336fb87837ca…`

## Headline

> ⏱ **INCOMPLETE** — 1 case(s) failed (timed out after retries) and are EXCLUDED from the aggregates below; this receipt must not be used to compute a drift/durability verdict.

with_skill **0.847 ± 0.034** vs baseline **0.731 ± 0.110**

skill lift **+0.116** (combined uncertainty ± 0.115)

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `bite-sized-tdd-steps` | with_skill | pass | 0.875 ± 0.001 | Five single-action steps, test-first, actual code/commands shown, expected output for fail and pass runs stated. Exemplary structure and granularity. |
| `bite-sized-tdd-steps` | baseline | fail | 0.622 ± 0.066 | Exemplary granularity with exact commands and expected outputs, but missing the required commit step (4 of 5 discrete test-first cycle steps). |
| `repair-placeholder-steps` | with_skill | pass | 0.878 ± 0.012 | All five placeholders explicitly flagged and rewritten into concrete steps: validation rules stated exactly, actual parametrized test code shown, concrete error handling specified, cross-reference explanation includes understanding tasks must repeat independently. Exemplary structure with Files/Inte |
| `repair-placeholder-steps` | baseline | borderline ⚠ | 0.745 ± 0.053 | Flags all 5 placeholders and rewrites most concretely. Misses explicit requirement: test step describes cases but shows no actual test code. |
| `file-structure-by-responsibility` | with_skill | pass | 0.854 ± 0.017 | Feature files grouped cohesively by responsibility with single clear accountability each. Explicitly states 'change together' rationale. Lacks explicit acknowledgment that it would defer to established convention if one existed. |
| `file-structure-by-responsibility` | baseline | borderline ⚠ | 0.800 ± 0.117 | Correctly groups by responsibility (not layer), assigns each file ONE clear responsibility, explicitly states 'files that change together' principle, and acknowledges codebase conventions. Exemplary. |
| `interfaces-exact-signatures` | with_skill | pass | 0.831 ± 0.008 | All CAP RULES satisfied: explicit Interfaces blocks with concrete named types; Task 2's Consumes matches Task 1's Produces exactly (class name, method signatures, all types). Meets SCORING ANCHOR (0.80) with Files blocks, complete signatures, and verbatim matching. Exceeds through implementation ste |
| `interfaces-exact-signatures` | baseline | pass | 0.807 ± 0.006 | Perfect: both tasks declare explicit Produces/Consumes with concrete named types; Task 2 Consumes exactly matches Task 1 Produces (TokenBucketRateLimiter, __init__, allow_request with identical signatures). Exceeds baseline with exceptional clarity and interface structure, but does not explicitly no |
| `task-right-sizing-testable-deliverable` | with_skill | pass | 0.781 ± 0.055 | Does not fold framework scaffolding into endpoint task as rubric specifies; sound justification via reviewer-rejection principle, independent testing. |
| `task-right-sizing-testable-deliverable` | baseline | fail | 0.572 ± 0.098 | Each task independently testable with solid justification; violates folding principle but avoids the no-test penalty. |
| `full-small-plan-header-and-tasks` | with_skill | pass | 0.867 ± 0.033 | All required elements present: header with Goal/Architecture/Tech Stack, verbatim Global Constraints block, exact file paths, bite-sized test-first steps with real code, run-fail/pass/commit steps, concrete ValueError tests covering all error classes. Exemplary constraint documentation and run comma |
| `full-small-plan-header-and-tasks` | baseline | ⏱ failed_timeout | — (not measured) | provider(claude-cli) timed out after 120000ms |
| `self-review-spec-coverage` | with_skill | pass | 0.845 ± 0.001 | Correct per-requirement mapping identifying purge_expired gap and clear/clear_all mismatch with concrete fixes. Lacks formatted requirement-to-task table for exemplary grade. |
| `self-review-spec-coverage` | baseline | pass | 0.843 ± 0.011 | Per-requirement mapping finds both issues (purge_expired gap, clear/clear_all mismatch) with concrete fixes; structured and exemplary, though secondary observations slightly exceed rubric scope. |
