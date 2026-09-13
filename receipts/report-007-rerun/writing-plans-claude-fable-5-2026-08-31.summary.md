# writing-plans — receipt summary

- **model:** `claude-fable-5`
- **surface:** claude-cli
- **run (UTC):** 2026-08-31T19:52:29.216Z
- **runner:** v0.6.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `5325ab3d55d5bacd…`
- **suite:** 7 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `f0dd7f573ee59593…`

## Headline

with_skill **0.833 ± 0.074** vs baseline **0.701 ± 0.139**

skill lift **+0.131** (combined uncertainty ± 0.157)

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `bite-sized-tdd-steps` | with_skill | pass | 0.872 ± 0.008 | Exemplary response: 5 discrete single-action steps following test-first cycle perfectly. Shows actual test code, implementation, exact commands (pytest, git), and expected failure/pass output for each run step. |
| `bite-sized-tdd-steps` | baseline | borderline ⚠ | 0.752 ± 0.155 | All five core steps present (write-failing-test, run-to-fail, implement, run-to-pass, commit), each single-action with real code/commands and expected outputs. Exemplary: exact run commands, clear expected failure/pass states. Minor: task 6 mixes documentation with commit action. |
| `repair-placeholder-steps` | with_skill | pass | 0.877 ± 0.004 | Identifies all five placeholders explicitly; rewrites with concrete validation rules, full test code, exact error messages, and explains why 'Similar to Task 1' must show actual code since engineers read tasks independently. |
| `repair-placeholder-steps` | baseline | borderline ⚠ | 0.740 ± 0.094 | Identifies all five placeholders explicitly and rewrites each into concrete steps with exact validation rules, error messages, HTTP status/body, and enumerated test cases; meets baseline requirement but doesn't show actual test code syntax. |
| `file-structure-by-responsibility` | with_skill | pass | 0.831 ± 0.006 | Feature-grouped with one responsibility per file, explicit change-together rationale, convention-aware reasoning. |
| `file-structure-by-responsibility` | baseline | pass | 0.821 ± 0.010 | Feature files kept together with each having one responsibility and explicit grouping rationale. Meets scoring anchor but lacks explicit 'files that change together' principle statement needed for exemplary. |
| `interfaces-exact-signatures` | with_skill | pass | 0.829 ± 0.006 | Both tasks declare complete Interfaces blocks with concrete class/method names and parameter/return types. Task 2's Consumes exactly matches Task 1's Produces verbatim. All file paths exact. Meets 0.80 baseline but does not exceed it—self-review notes the match but does not explicitly state that Pro |
| `interfaces-exact-signatures` | baseline | borderline ⚠ | 0.725 ± 0.144 | Both tasks declare complete Interfaces with concrete named types; Task 2's Consumes exactly matches Task 1's Produces; exemplary pedagogical framing on contract matching. |
| `task-right-sizing-testable-deliverable` | with_skill | borderline ⚠ | 0.676 ± 0.169 | Correctly folds scaffolding into endpoint task; independently testable deliverables; explicitly invokes task-sizing principle; justified merge/split decisions via reviewer leverage. |
| `task-right-sizing-testable-deliverable` | baseline | borderline ⚠ | 0.637 ± 0.133 | Correctly folds VERSION and uptime into endpoint task with independent testing. Splits framework bootstrap separately but with independent smoke-test verification and explicit justification. Meets underlying principles but deviates from stated folding preference. |
| `full-small-plan-header-and-tasks` | with_skill | pass | 0.903 ± 0.013 | Exemplary plan: complete header with Goal/Architecture/Tech Stack; Global Constraints copying all verbatim values; exact file paths (src/duration.py, tests/test_duration.py); bite-sized test-first tasks with real code and concrete run commands; run-to-fail/pass/commit steps; comprehensive ValueError |
| `full-small-plan-header-and-tasks` | baseline | fail | 0.420 ± 0.084 | Comprehensive content but missing HEADER, Global Constraints section, and bite-sized test-first task decomposition; task sequence too coarse. |
| `self-review-spec-coverage` | with_skill | pass | 0.843 ± 0.020 | Correctly performs per-requirement mapping, identifies the purge_expired gap and clear/clear_all naming defect with exact fixes, goes requirement-by-requirement with explicit tracing. |
| `self-review-spec-coverage` | baseline | pass | 0.815 ± 0.005 | Correct per-requirement mapping, identified purge_expired gap and clear/clear_all mismatch with concrete fixes. Exemplary but not perfect. |
