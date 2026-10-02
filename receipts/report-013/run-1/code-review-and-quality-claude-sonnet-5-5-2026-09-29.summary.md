# code-review-and-quality — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T03:57:59.530Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `1910eae70ac29aad…`

## Headline

with_skill **0.887 ± n/a (1 case)** vs baseline **0.878 ± n/a (1 case)**

skill lift **+0.009** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.887 ± 0.025 | Explicit Critical/Required/Consider labels on every finding, secret marked Critical, PII logging Required, `data` name in Consider, ordered by leverage with concrete fixes; un-awaited fetch slightly over-labeled Critical. |
| `severity-labeled-findings` | baseline | pass | 0.878 ± 0.027 | Every finding carries an explicit severity heading, secret is Critical, PII logging High, `data` name Low; ordered by leverage with concrete fixes, but labels deviate from skill's Required/Nit vocabulary. |
