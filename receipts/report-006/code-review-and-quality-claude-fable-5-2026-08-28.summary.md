# code-review-and-quality — receipt summary

- **model:** `claude-fable-5`
- **surface:** claude-cli
- **run (UTC):** 2026-08-28T19:38:41.182Z
- **runner:** v0.5.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 7 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `965d4dfdcc66916e…`

## Headline

with_skill **0.881 ± 0.014** vs baseline **0.852 ± 0.070**

skill lift **+0.029** (combined uncertainty ± 0.071)

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.886 ± 0.106 | All findings have explicit severity labels with correct calibration: hardcoded secret as Critical, PII logging as Critical (within required band), cosmetic naming as Nit. Findings ordered by leverage (Critical→Required→Nit), concrete fixes provided for all substantive issues. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.696 ± 0.029 | Correctly marks hardcoded secret Critical with exemplary severity ordering and fixes. Omits explicit Nit label for variable naming; PII logging calibrated as High not Critical/Required. |
| `commit-message-imperative-body` | with_skill | pass | 0.880 ± 0.007 | Imperative first line, comprehensive body explaining what and why, names retry parameters and mentions test—exemplary response. |
| `commit-message-imperative-body` | baseline | pass | 0.872 ± 0.008 | Perfect imperative first line; body clearly explains problem (context/why) and solution (what). Additionally exemplary: explicitly names retry parameters (3 attempts, exponential backoff) and mentions added test. |
| `security-axis-sql-injection` | with_skill | pass | 0.870 ± 0.012 | Correctly identifies SQL injection as Critical with concrete parameterized-query fix. Also flags boundary validation, keeps injection clearly-led, identifies IDOR, provides complete working example. No errors. |
| `security-axis-sql-injection` | baseline | pass | 0.888 ± 0.013 | Identifies SQL injection as blocking, proposes parameterized query fix, flags input validation. Exemplary organization with security citations, attack examples, and additional vulnerability identification. |
| `propose-structural-remedy` | with_skill | pass | 0.910 ± 0.022 | Precisely identifies repeated-conditional/missing-model smell; proposes concrete Record<FileKind, FileKindMeta> typed-lookup-table restructuring collapsing three functions. Sketches actual data structure and explains multiple benefits with exceptional clarity. |
| `propose-structural-remedy` | baseline | pass | 0.902 ± 0.013 | Identifies repeated-conditional smell across three functions, proposes concrete typed-record lookup-table restructuring collapsing the switches, sketches actual data structure with benefits. |
| `oversized-change-split` | with_skill | pass | 0.880 ± 0.012 | Flags size as too large, separates refactor from feature, names Stack strategy explicitly, requests standalone descriptions—all exemplary criteria met. |
| `oversized-change-split` | baseline | pass | 0.870 ± 0.007 | Meets all rubric requirements: flags ~1,400 lines as too large/split needed, explicitly calls out refactor-feature mixing with reasoned explanation, names concrete Stack strategy ('PR A first, PR B branched on top'), and demands real descriptions. Professional and collaborative tone strengthens it. |
| `approve-when-improves-health` | with_skill | pass | 0.868 ± 0.011 | Verdict correctly approves; explicitly articulates don't-block-over-nits principle; addresses duplication, conventions, and test coverage; treats `re` naming as optional nit. |
| `approve-when-improves-health` | baseline | pass | 0.866 ± 0.011 | Approves correctly; explains code-health wins (dedup + test + conventions); explicitly frames `re` naming as non-blocking and wasteful to challenge, embodying the approval principle. |
| `reject-clean-it-up-later` | with_skill | pass | 0.876 ± 0.009 | Clearly declines defer-and-approve, requires fix before merge with concrete steps, explains WHY deferred cleanup fails, offers help to unblock author. Minor: escape hatch doesn't explicitly require self-assigned ticket, only 'tracked ticket.' |
| `reject-clean-it-up-later` | baseline | pass | 0.870 ± 0.007 | Clearly declines defer-and-approve; requires fix before merge with exemplary tone and concrete paths, but lacks explicit tracked-bug fallback. |
