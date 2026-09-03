# writing-plans — receipt summary

- **model:** `claude-fable-5-1`
- **surface:** claude-cli
- **run (UTC):** 2026-09-02T01:14:17.307Z
- **runner:** v0.7.2
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `5325ab3d55d5bacd…`
- **suite:** 7 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `3368a89f9b69401b…`

## Headline

with_skill **0.844 ± 0.048** vs baseline **0.718 ± 0.198**

skill lift **+0.126** (combined uncertainty ± 0.203)

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `bite-sized-tdd-steps` | with_skill | pass | 0.889 ± 0.013 | All five required test-first steps present as discrete single-action items with real code, exact commands, and expected outputs; bonus Step 5 (doctest) and comprehensive 9-test suite elevate to exemplary range. |
| `bite-sized-tdd-steps` | baseline | pass | 0.860 ± 0.021 | Exemplary test-first plan with all 5 required phases (write-fail, run-fail, implement, run-pass, commit) as separate bite-sized steps. Actual test code, implementation code, exact commands, and expected outputs shown throughout. Includes bonus validation (doctest, regression check). No CAP violation |
| `repair-placeholder-steps` | with_skill | pass | 0.848 ± 0.031 | Correctly identifies all five placeholders as defects and rewrites with concrete steps, actual test code, exact rules, explicit interfaces, and working implementations. Exemplary structure and completeness; lacks only explicit statement that tasks may be read out of order. |
| `repair-placeholder-steps` | baseline | pass | 0.790 ± 0.033 | Explicitly flags all five placeholders and rewrites concretely with exact validation rules, error codes/JSON shapes, enumerated test cases, and clear acceptance criteria. Meets fully-correct baseline but doesn't explain why Task 1 reference must be eliminated for independent reading. |
| `file-structure-by-responsibility` | with_skill | pass | 0.853 ± 0.013 | Feature-grouped responsibly with single responsibilities per file; explicitly states 'files that change together' rationale; acknowledges no established convention. |
| `file-structure-by-responsibility` | baseline | pass | 0.861 ± 0.012 | Correctly groups export feature together by responsibility, each file has one clear responsibility, and grouping rationale explicitly stated. Meets baseline but lacks explicit conditional that it would follow established pattern if one existed. |
| `interfaces-exact-signatures` | with_skill | pass | 0.823 ± 0.033 | Both tasks declare Files and Interfaces blocks with concrete signatures (class names, method names, parameter types, return types). Task 2's Consumes exactly matches Task 1's Produces verbatim. |
| `interfaces-exact-signatures` | baseline | pass | 0.796 ± 0.054 | Both tasks have Files + Interfaces blocks with complete signatures; Task 2 Consumes matches Task 1 Produces exactly. Lacks explicit note that Produces block is how implementer learns names/types. |
| `task-right-sizing-testable-deliverable` | with_skill | borderline ⚠ | 0.752 ± 0.152 | Correctly folds scaffolding (framework, VERSION) into endpoint task; each task independently testable; explicitly justifies splits via reviewer rejection principle. |
| `task-right-sizing-testable-deliverable` | baseline | fail | 0.449 ± 0.092 | Violates core principle by splitting 'framework install' (explicit scaffolding example) into separate task rather than folding into endpoint task; version/uptime also separated against rubric guidance. |
| `full-small-plan-header-and-tasks` | with_skill | pass | 0.895 ± 0.019 | Complete header with Goal/Architecture/Tech Stack; Global Constraints copying verbatim constraint values; exact file paths; bite-sized test-first steps with real code, run commands, expected outputs; comprehensive ValueError test coverage; no placeholders. |
| `full-small-plan-header-and-tasks` | baseline | fail | 0.415 ± 0.094 | Capped at 0.3: 'write tests' step lacks shown code (T2 describes but doesn't provide actual unittest). Missing formal header (Goal/Architecture/Tech Stack) and Global Constraints section copying values verbatim. Implementation code IS shown; structure is otherwise exemplary. |
| `self-review-spec-coverage` | with_skill | pass | 0.850 ± 0.011 | Response correctly maps all five requirements per-requirement, identifies purge_expired gap and clear/clear_all mismatch, proposes concrete fixes (add Task 4, rename method). Exceeds baseline through exemplary structure and comprehensive analysis. |
| `self-review-spec-coverage` | baseline | pass | 0.855 ± 0.009 | Correctly maps all five requirements per-requirement, identifies purge_expired gap and clear/clear_all mismatch, proposes concrete fixes, exemplary structure with explicit mapping section. |
