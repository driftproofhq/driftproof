# code-review-and-quality — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-23T06:34:35.169Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `5c3ad19b40dd4b39…`

## Headline

with_skill **0.910 ± n/a (1 case)** vs baseline **0.680 ± n/a (1 case)**

skill lift **+0.230** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.910 ± 0.015 | Explicit Critical/Required/Nit labels on every finding; secret is Critical, PII logging Required, `data` name a Nit; ordered by leverage with concrete fixes throughout. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.680 ± 0.218 | Explicit severity sections with hardcoded secret as Critical, PII logging High, naming as Medium/Low; ordered by leverage with concrete fixes, but skips the `data` name nit explicitly. |
