# writing-plans — receipt summary

- **model:** `claude-fable-5`
- **surface:** claude-cli
- **run (UTC):** 2026-08-28T21:09:53.835Z
- **runner:** v0.5.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `5325ab3d55d5bacd…`
- **suite:** 7 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `eb19fdfa43cd85c9…`

## Headline

> ⏱ **INCOMPLETE** — 2 case(s) failed (timed out after retries) and are EXCLUDED from the aggregates below; this receipt must not be used to compute a drift/durability verdict.

with_skill **0.809 ± 0.103** vs baseline **0.754 ± 0.164**

skill lift **+0.055** (combined uncertainty ± 0.194)

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `bite-sized-tdd-steps` | with_skill | pass | 0.876 ± 0.015 | All five core steps present in order with real test code, exact run commands, and expected outputs; exemplary detail throughout. Minor: Step 5 (doctest) is extra verification beyond the rubric's five core steps. |
| `bite-sized-tdd-steps` | baseline | pass | 0.812 ± 0.068 | Follows test-first cycle correctly with exemplary run commands and expected outputs. Minor issues: step 1 setup lacks exact commands (-0.02), step 9 bundles verify+commit (-0.03), step 5 incorrectly states 'Expected: 9 passed' but clarifies '12 passed' (-0.04). |
| `repair-placeholder-steps` | with_skill | pass | 0.844 ± 0.030 | Explicitly flags all five placeholders; rewrites concretely with full test code, exact rules, explicit error contract, and task independence rationale. |
| `repair-placeholder-steps` | baseline | pass | 0.784 ± 0.036 | All five placeholders explicitly flagged and rewritten into concrete steps with real content (exact rules, error contract, test cases, file paths, done criteria). No placeholders reintroduced. Does not reach 0.81-0.90 exemplary tier: missing explanation that Task 1 should be self-contained because e |
| `file-structure-by-responsibility` | with_skill | pass | 0.862 ± 0.016 | Correctly groups feature files together in src/invoices/export/ by responsibility, not layer; each file has one clear responsibility; explicitly states 'files that change together' principle and adapts to existing patterns. |
| `file-structure-by-responsibility` | baseline | pass | 0.830 ± 0.027 | Organizes feature together (lib/invoices/), each file one clear responsibility, groups by cohesion not layer, explains rationale explicitly, acknowledges codebase patterns. |
| `interfaces-exact-signatures` | with_skill | pass | 0.832 ± 0.034 | Both tasks have explicit Interfaces blocks with complete signatures (class names, method names, parameter types, return types). Task 2's Consumes matches Task 1's Produces exactly—class name, all three methods, parameter types, and return types identical. Self-review explicitly validates type consis |
| `interfaces-exact-signatures` | baseline | pass | 0.800 ± 0.000 | All baseline requirements met: Files, Interfaces blocks, complete named signatures, Task 2 Consumes matches Task 1 Produces exactly. No explicit pedagogical note. |
| `task-right-sizing-testable-deliverable` | with_skill | borderline ⚠ | 0.602 ± 0.180 | Correctly folds VERSION/uptime into endpoint task with justifications; incorrectly splits framework scaffold instead of folding in. |
| `task-right-sizing-testable-deliverable` | baseline | ⏱ failed_timeout | — (not measured) | provider(claude-cli) timed out after 120000ms |
| `full-small-plan-header-and-tasks` | with_skill | ⏱ failed_timeout | — (not measured) | provider(claude-cli) timed out after 120000ms |
| `full-small-plan-header-and-tasks` | baseline | fail | 0.424 ± 0.185 | CAP RULE triggered: §7 provides coarse lumped steps, not bite-sized test-first decomposition. Also missing: dedicated Global Constraints section copying constraint values verbatim, and separate Tech Stack header. |
| `self-review-spec-coverage` | with_skill | pass | 0.838 ± 0.022 | Per-requirement mapping complete; purge_expired gap identified; clear/clear_all mismatch caught with fixes. Structured analysis nearly exemplary but not quite formal table. |
| `self-review-spec-coverage` | baseline | pass | 0.872 ± 0.013 | Identifies purge_expired gap and clear/clear_all mismatch with concrete fixes. Exemplary per-requirement mapping and structure, meets 0.81–0.90 criteria. |
