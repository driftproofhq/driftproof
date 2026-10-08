# code-review-and-quality — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T20:25:36.917Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `cb75db64ce25b96e…`

## Headline

with_skill **0.891 ± n/a (1 case)** vs baseline **0.821 ± n/a (1 case)**

skill lift **+0.070** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.891 ± 0.012 | Explicit Critical/Required/Nit labels; secret Critical, PII logging Required, `data` name Nit; leverage-ordered with concrete fixes, though PII sits late within Required. |
| `severity-labeled-findings` | baseline | pass | 0.821 ± 0.051 | Explicit severity labels, secret Critical, PII logging High, findings ordered by leverage with concrete fixes; but cosmetic `data` naming labeled Medium rather than Nit/Optional. |
