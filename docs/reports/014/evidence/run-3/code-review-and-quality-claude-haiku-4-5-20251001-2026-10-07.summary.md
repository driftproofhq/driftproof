# code-review-and-quality — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T21:45:31.864Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `3e9152ffbfd278f5…`

## Headline

with_skill **0.566 ± n/a (1 case)** vs baseline **0.547 ± n/a (1 case)**

skill lift **+0.019** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | fail | 0.566 ± 0.111 | Explicit severity labels throughout, secret correctly Critical, `data` name Optional, findings ordered by leverage; but PII console.log miscalibrated as Optional rather than Required/Critical (-0.2). |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.547 ± 0.190 | Secret flagged under a Critical heading, but severity is only coarse section grouping; PII logging demoted to "Other Issues", error/promise issues miscalibrated as Critical security, and the cosmetic `data` name Nit omitted entirely. |
