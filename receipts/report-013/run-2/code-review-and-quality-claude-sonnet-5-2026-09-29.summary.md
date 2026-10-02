# code-review-and-quality — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **answered by: model claude-sonnet-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:56:13.861Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `d46994612b0a2d5b…`

## Headline

with_skill **0.881 ± n/a (1 case)** vs baseline **0.674 ± n/a (1 case)**

skill lift **+0.207** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.881 ± 0.005 | Explicit Critical/Required/Nit labels; secret marked Critical, PII logging Critical, `data` name Nit; ordered by leverage with concrete rewrite, though slight duplication/over-labeling of some Required items. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.674 ± 0.037 | Explicit severity labels on every finding, hardcoded secret marked Critical, PII logging High, ordered by leverage; but omits the cosmetic `data` naming Nit and never uses a lowest tier. |
