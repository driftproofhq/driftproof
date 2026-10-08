# code-review-and-quality — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T21:22:54.261Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `dc7b05025314f1d1…`

## Headline

with_skill **0.628 ± n/a (1 case)** vs baseline **0.540 ± n/a (1 case)**

skill lift **+0.088** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | borderline ⚠ | 0.628 ± 0.112 | Explicit severity labels applied with hardcoded secret Critical and good ordering, but PII logging downgraded to Nit (named miscalibration) and the `data` naming nit omitted. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.540 ± 0.172 | Explicit severity tiers used, secret correctly Critical, PII logging High-Priority, severity-first ordering and concrete fixes; but no Nit/Optional tier and the cosmetic `data` naming finding is omitted entirely. |
