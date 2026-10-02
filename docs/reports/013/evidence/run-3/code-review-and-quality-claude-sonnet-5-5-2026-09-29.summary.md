# code-review-and-quality — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T05:42:54.981Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `d7e4c01f343915d7…`

## Headline

with_skill **0.896 ± n/a (1 case)** vs baseline **0.861 ± n/a (1 case)**

skill lift **+0.034** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.896 ± 0.002 | Explicit Critical/Required/Optional labels, secret marked Critical, PII logging Required, `data` naming Optional, ordered by leverage with concrete fixes; severity tiers slightly broad (no Nit tier). |
| `severity-labeled-findings` | baseline | pass | 0.861 ± 0.025 | Explicit severity tiers on every finding, hardcoded secret Critical, PII logging High, ordered by leverage with concrete fixes; cosmetic `data` naming rated Medium rather than Nit. |
