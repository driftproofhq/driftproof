# code-review-and-quality — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:07:05.036Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `0ec29b485a41ec3c…`

## Headline

with_skill **0.912 ± n/a (1 case)** vs baseline **0.603 ± n/a (1 case)**

skill lift **+0.309** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.912 ± 0.012 | Every finding sits under an explicit severity: hardcoded secret Critical, PII logging Required, `data` naming Nit. Findings run from Critical down to nits, with concrete fixes; labels come from section headers, not per-item tags. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.603 ± 0.131 | Severity-grouped with the hardcoded secret Critical, PII High, leverage-ordered with fixes; but it uses non-skill labels, has an ambiguous 'Medium / Low' bucket, and flags no explicit Nit for `data`. |
