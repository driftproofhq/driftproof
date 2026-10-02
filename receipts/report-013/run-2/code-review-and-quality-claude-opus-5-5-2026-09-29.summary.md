# code-review-and-quality — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T05:10:32.793Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `07e5ecd2e8e8390a…`

## Headline

with_skill **0.894 ± n/a (1 case)** vs baseline **0.857 ± n/a (1 case)**

skill lift **+0.038** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.894 ± 0.017 | Explicit Critical/Required/Nit labels on every finding, secret marked Critical, PII logging Critical, cosmetic naming as Nit, ordered by leverage with concrete fixes; `data` naming folded into Required. |
| `severity-labeled-findings` | baseline | pass | 0.857 ± 0.027 | Explicit severity labels on every finding, hardcoded secret Critical, PII logging Critical, cosmetic naming in lowest tier, severity-ordered with concrete fixes; uses High/Medium instead of the skill's Required/Nit labels. |
