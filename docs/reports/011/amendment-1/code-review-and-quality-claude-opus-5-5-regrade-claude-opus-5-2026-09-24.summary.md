# code-review-and-quality — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:04:47.676Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `50ec421ffe9b762e…`

## Headline

with_skill **0.902 ± n/a (1 case)** vs baseline **0.693 ± n/a (1 case)**

skill lift **+0.209** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.902 ± 0.016 | Explicit severity sections with hardcoded secret as Critical, PII logging as Required, `data` name as Nit; ordered by leverage with concrete fixes, though several findings are escalated to Critical. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.693 ± 0.185 | Explicit severity sections throughout, secret marked Critical, PII logging High, cosmetic naming demoted to Medium/Low, ordered by leverage with concrete fixes; uses non-skill labels and omits the `data` nit. |
