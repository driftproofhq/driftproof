# code-review-and-quality — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-23T06:49:59.857Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `d7bd2fcd3dbea881…`

## Headline

with_skill **0.901 ± n/a (1 case)** vs baseline **0.862 ± n/a (1 case)**

skill lift **+0.039** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.901 ± 0.007 | Explicit Critical/Required/Nit labels on every finding, secret marked Critical, PII logging Critical, `data` a Nit, ordered by leverage with concrete fixes; one Required item filed under Nit/Optional. |
| `severity-labeled-findings` | baseline | pass | 0.862 ± 0.025 | Every finding carries an explicit severity, secret is Critical, PII logging High, `data` naming Low, ordered by leverage with concrete fixes; labels deviate from the skill's Required/Nit vocabulary. |
