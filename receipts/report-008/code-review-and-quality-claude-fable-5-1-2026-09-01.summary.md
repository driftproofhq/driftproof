# code-review-and-quality — receipt summary

- **model:** `claude-fable-5-1`
- **surface:** claude-cli
- **run (UTC):** 2026-09-01T20:44:42.353Z
- **runner:** v0.7.2
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 7 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `1e6a697783d54e14…`

## Headline

with_skill **0.865 ± 0.036** vs baseline **0.793 ± 0.214**

skill lift **+0.072** (combined uncertainty ± 0.217)

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | borderline ⚠ | 0.796 ± 0.147 | Explicit labels on all findings; hardcoded secret correctly Critical; cosmetic names correctly Nit; findings ordered by leverage. One calibration issue: un-awaited fetch marked Critical (rubric specifies Required severity for this correctness finding). |
| `severity-labeled-findings` | baseline | fail | 0.308 ± 0.019 | Response lacks explicit severity labels (Critical/Required/Nit) on findings; rubric caps unlabeled findings at 0.3. |
| `commit-message-imperative-body` | with_skill | pass | 0.869 ± 0.006 | Imperative first line, informative and specific. Body clearly explains what (3 attempts, exponential backoff, test added) and why (transient 503s fail checkout). Exemplary detail. |
| `commit-message-imperative-body` | baseline | pass | 0.872 ± 0.005 | Imperative first line is short, standalone, and specific. Body clearly states what (3-attempt retry with exponential backoff) and why (brief outages broke checkout). Exemplary: explicitly names parameters and mentions the test added. |
| `security-axis-sql-injection` | with_skill | pass | 0.891 ± 0.008 | Identifies SQL injection as Critical/blocking issue, proposes correct parameterized-query fix (idiomatic %s with params), and also flags input validation at boundary as separate finding. |
| `security-axis-sql-injection` | baseline | pass | 0.878 ± 0.007 | Identifies SQL injection as Critical/blocking, proposes parameterized-query fix, and exemplarily flags input validation at the boundary with complete corrected code. |
| `propose-structural-remedy` | with_skill | pass | 0.903 ± 0.010 | Identifies repeated-conditional smell across three functions, proposes concrete typed-lookup-table replacement with {label, icon, color} record structure, demonstrates benefit of single-entry extension, and provides complete working implementation. |
| `propose-structural-remedy` | baseline | pass | 0.900 ± 0.014 | Correctly identifies repeated-conditional smell across three functions, proposes concrete typed-record-based dispatcher (KIND_META Record<FileKind, KindMeta>) collapsing all branches, sketches actual structure, notes single-entry-per-kind benefit and type safety gains. |
| `oversized-change-split` | with_skill | pass | 0.890 ± 0.012 | Meets all requirements: flags ~1,400 lines as too large to split (✓), explicitly calls out refactor-feature mixing (✓), names concrete Stack strategy operationally (land refactor, stack feature) (✓), asks for standalone descriptions. Exemplary execution; minor gap: could name 'Stack' terminology exp |
| `oversized-change-split` | baseline | pass | 0.864 ± 0.037 | Meets all required elements: flags ~1,400 lines as too large, explicitly calls out refactor/feature separation, names Stack strategy (refactor first, feature stacked), requests real descriptions. Exemplary execution. |
| `approve-when-improves-health` | with_skill | pass | 0.847 ± 0.034 | Correctly approves with sound reasoning (de-duplication, test, conventions), explicitly frames `re` as non-blocking nit, invokes approval principle, provides exemplary analysis. |
| `approve-when-improves-health` | baseline | pass | 0.859 ± 0.017 | Correct approve verdict citing code-health improvements (deduplication, test, conventions); explicitly articulates 'don't block over nits' principle; treats `re` as optional. Adds thoughtful advisory checks without blocking. |
| `reject-clean-it-up-later` | with_skill | pass | 0.861 ± 0.022 | Declines defer-and-approve, explains why cleanup rarely happens, requires fix-before-merge or self-assigned bug (option 3), offers three concrete paths forward, maintains professional code-focused tone. |
| `reject-clean-it-up-later` | baseline | pass | 0.868 ± 0.007 | Declines defer-and-approve firmly, explains why deferred fixes slip, requires fix before merge, and offers three concrete actionable paths—professional and exemplary. |
