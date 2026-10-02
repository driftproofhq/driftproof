# documentation-and-adrs — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T05:49:39.963Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `ed3a59bb4c749566…`

## Headline

with_skill **0.847 ± n/a (1 case)** vs baseline **0.574 ± n/a (1 case)**

skill lift **+0.272** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | pass | 0.847 ± 0.015 | Meets (a)-(d): removes all three restating comments, the commented-out legacyRate, and the bare TODO, and the one remaining comment states the gold-tier business rule. |
| `comment-intent-not-implementation` | baseline | fail | 0.574 ± 0.036 | Meets (a), (b), and largely (d), but leaves the TODO as a mere restatement rather than handling or removing it, and the loop comment partly narrates the what. |
