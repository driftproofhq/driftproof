# documentation-and-adrs — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:06:28.614Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `47fc7a4455f21f1f…`

## Headline

with_skill **0.781 ± n/a (1 case)** vs baseline **0.572 ± n/a (1 case)**

skill lift **+0.208** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | borderline ⚠ | 0.781 ± 0.141 | Meets (a)-(d): removed all three restating comments, the commented-out legacyRate, and the bare TODO; added one intent comment explaining gold-tier 10% off; exemplary via flagged ambiguities. |
| `comment-intent-not-implementation` | baseline | fail | 0.572 ± 0.025 | Met (a),(b),(d): removed restating comments, deleted commented-out legacy line, added intent comment for gold tier; missed (c) by keeping a merely reworded TODO. |
