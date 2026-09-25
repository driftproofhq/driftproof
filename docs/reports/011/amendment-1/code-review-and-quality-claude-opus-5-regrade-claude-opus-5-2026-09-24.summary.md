# code-review-and-quality — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:21:40.499Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `cf5efd0aa6eabfb7…`

## Headline

with_skill **0.899 ± n/a (1 case)** vs baseline **0.870 ± n/a (1 case)**

skill lift **+0.029** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.899 ± 0.005 | Explicit Critical/Required/Nit labels throughout; hardcoded live key and PII logging Critical, `data` name a Nit; ordered by leverage with concrete fixes, but a Required currency item sits under Nit/Optional. |
| `severity-labeled-findings` | baseline | pass | 0.870 ± 0.038 | Explicit severity labels throughout; secret marked Critical, PII logging High (~Required), `data` naming Low (~Nit); ordered by leverage with concrete fixes, but uses High/Medium/Low instead of the skill's defined labels. |
