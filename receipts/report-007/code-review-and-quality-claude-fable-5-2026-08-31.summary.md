# code-review-and-quality — receipt summary

- **model:** `claude-fable-5`
- **surface:** claude-cli
- **run (UTC):** 2026-08-31T07:59:57.284Z
- **runner:** v0.6.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 7 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `7d940158ee7f65b3…`

## Headline

with_skill **0.885 ± 0.017** vs baseline **0.830 ± 0.109**

skill lift **+0.055** (combined uncertainty ± 0.111)

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.917 ± 0.026 | All findings labeled with explicit severity levels; hardcoded secret and cosmetic issue correctly calibrated (Critical and Nit); findings well-ordered by leverage; concrete fixes provided. Exemplary. |
| `severity-labeled-findings` | baseline | fail | 0.585 ± 0.071 | Only 1 of 8 findings carries explicit severity label from rubric's defined set (Critical/Required/Optional/Nit); catastrophically fails the sole grading criterion despite correct issue identification and structure. |
| `commit-message-imperative-body` | with_skill | pass | 0.868 ± 0.007 | Imperative first line is short, standalone, and informative. Body clearly states what (retry 503 up to 3 attempts with backoff) and why (transient gateway outages failing checkout). Names parameters and mentions added test. Exemplary execution. |
| `commit-message-imperative-body` | baseline | pass | 0.872 ± 0.003 | Imperative first line with clear context; body explains both what (retry logic with 3 attempts) and why (prevent checkout failures); names test. |
| `security-axis-sql-injection` | with_skill | pass | 0.881 ± 0.003 | Identifies SQL injection as Critical/blocking, proposes parameterized-query fix, flags input validation at boundary, keeps injection clearly led. Exceeds baseline but not exceptional in every respect. |
| `security-axis-sql-injection` | baseline | pass | 0.885 ± 0.009 | Identifies SQL injection as Critical, proposes concrete parameterized-query fix, exemplary with boundary validation flags and clear leading. Comprehensive scope. |
| `propose-structural-remedy` | with_skill | pass | 0.897 ± 0.011 | Identifies repeated-conditional smell across three functions, proposes concrete typed-record restructuring with explicit data structure. Exemplary: sketches Record<FileKind, FileKindDisplay> entries and notes single-entry maintenance benefit. Adds type safety and backwards-compatibility analysis. |
| `propose-structural-remedy` | baseline | pass | 0.885 ± 0.007 | Identifies repeated-conditional smell across three functions; proposes concrete typed lookup-table remedy that collapses switches; sketches data structure and notes benefits. |
| `oversized-change-split` | with_skill | pass | 0.882 ± 0.006 | Correctly flags 1,400 lines as too large to review (>1,000 threshold) and must split. Explicitly calls out mixing refactoring and feature work as separate concerns. Exemplary: names 'Stack' strategy concretely (refactor first, feature on top) and demands standalone descriptions instead of 'Recurring |
| `oversized-change-split` | baseline | pass | 0.869 ± 0.021 | Meets all core rubric points: flags size, separates refactor from feature, describes Stack strategy, requests standalone descriptions. |
| `approve-when-improves-health` | with_skill | pass | 0.877 ± 0.002 | Verdict correct (Approve). Explicitly articulates principle: 'don't block over nits,' treats `re` as optional, covers de-duplication/test/conventions thoroughly. |
| `approve-when-improves-health` | baseline | pass | 0.877 ± 0.018 | Correctly approves with clear reasoning on code health (dedup/test/conventions), explicitly articulates the 'don't block nits' principle ('review noise,' signal-loss), and demonstrates proportional oversight. Exemplary. |
| `reject-clean-it-up-later` | with_skill | pass | 0.872 ± 0.014 | Declines defer-and-approve, requires fix before merge, explicitly explains why deferred cleanup fails ('rarely survives contact with release week'), offers multiple concrete paths professionally. |
| `reject-clean-it-up-later` | baseline | pass | 0.836 ± 0.023 | Declines defer-and-approve, explains WHY deferred cleanup fails, offers fix-before-merge paths; emergency fallback omits bug filing. |
