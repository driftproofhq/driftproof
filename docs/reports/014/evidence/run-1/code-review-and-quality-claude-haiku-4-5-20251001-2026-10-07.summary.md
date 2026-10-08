# code-review-and-quality — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T20:57:32.293Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `d1a00f6045586a6c…`

## Headline

with_skill **0.677 ± n/a (1 case)** vs baseline **0.339 ± n/a (1 case)**

skill lift **+0.339** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | borderline ⚠ | 0.677 ± 0.044 | Explicit severity labels on all findings, hardcoded secret correctly Critical, PII logging Critical, good leverage ordering and concrete fixes; but omits the cosmetic `data` naming nit, never exercising the Nit/Optional tier. |
| `severity-labeled-findings` | baseline | fail | 0.339 ± 0.035 | Only one section is a true severity label (Critical, correctly covering the hardcoded secret); Functional/Code Quality are categories not severities, no Nit/Optional tier exists, PII logging demoted to Code Quality, and the `data` naming nit is omitted. |
