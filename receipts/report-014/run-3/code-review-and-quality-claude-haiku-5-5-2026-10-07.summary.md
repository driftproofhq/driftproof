# code-review-and-quality — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T21:08:05.850Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `d001090cd7f42f64…`

## Headline

with_skill **0.770 ± n/a (1 case)** vs baseline **0.823 ± n/a (1 case)**

skill lift **-0.053** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | borderline ⚠ | 0.770 ± 0.158 | Explicit Critical/Required/Nit labels, secret marked Critical, PII logging Required, cosmetic point as Nit, severity-ordered with concrete fixes; misses the `data` naming nit. |
| `severity-labeled-findings` | baseline | pass | 0.823 ± 0.031 | Explicit severity labels throughout, hardcoded secret Critical, PII logging High, findings ordered by leverage with fixes; cosmetic `data` name sits at Medium rather than Nit/Optional. |
