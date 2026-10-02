# code-review-and-quality — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **answered by: model claude-sonnet-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T05:57:51.258Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `5d276fa7fded94d5…`

## Headline

with_skill **0.657 ± n/a (1 case)** vs baseline **0.573 ± n/a (1 case)**

skill lift **+0.085** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | borderline ⚠ | 0.657 ± 0.257 | Explicit Critical/Required/Nit labels on every finding, secret marked Critical, PII logging Critical, findings ordered by leverage with fixes; misses the cosmetic `data` naming nit. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.573 ± 0.176 | Explicit severity labels on every finding, secret marked Critical, cosmetic naming last and ordered by leverage; PII logging only Medium and the `data` name nit is absent. |
