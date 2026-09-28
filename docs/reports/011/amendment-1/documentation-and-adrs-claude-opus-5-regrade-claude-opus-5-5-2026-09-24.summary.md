# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:40:41.370Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `dd464b6678e1c87c…`

## Headline

with_skill **0.801 ± n/a (1 case)** vs baseline **0.517 ± n/a (1 case)**

skill lift **+0.285** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | pass | 0.801 ± 0.099 | Meets (a)-(d): removes restating comments, commented-out legacy line and bare TODO; added comments state mutation contract, non-idempotence and stale-total gotcha rather than restating code. |
| `comment-intent-not-implementation` | baseline | fail | 0.517 ± 0.109 | Meets (a) and (b), but misses (c) because the TODO is kept rather than handled or removed; (d) is weakened because 'flat 10% off' restates 0.9. |
