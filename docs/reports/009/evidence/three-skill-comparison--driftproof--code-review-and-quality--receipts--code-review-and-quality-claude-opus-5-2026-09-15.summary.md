# code-review-and-quality — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-15T16:04:34.736Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `4e3e1dddda5592ac…`

## Headline

with_skill **0.918 ± n/a (1 case)** vs baseline **0.783 ± n/a (1 case)**

skill lift **+0.134** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.918 ± 0.010 | Critical/Required/Nit severity labels are explicit, and order runs Critical to nits with a concrete fix per finding. The hardcoded secret and PII are Critical, `data` is a Nit; section labels and 'FYI' are minor flaws. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.783 ± 0.094 | Severity tiers are explicit (Critical/High/Medium/Low) and ordered by leverage; the hardcoded secret is Critical, PII logging High, naming Low. The `data` name is lumped into Medium; labels deviate from skill vocabulary. |
