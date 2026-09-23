# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-15T16:11:24.010Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `3f52ddb6b849ee54…`

## Headline

with_skill **0.822 ± n/a (1 case)** vs baseline **0.532 ± n/a (1 case)**

skill lift **+0.291** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | pass | 0.822 ± 0.017 | Meets (a), (b), and (c). Added comments give non-obvious caller intent (side effects, total not recomputed), though the JSDoc partly narrates behavior and omits why gold gets 10%. |
| `comment-intent-not-implementation` | baseline | fail | 0.532 ± 0.093 | Meets (a) and (b), and (d) holds with intent-focused added comments; misses (c): the expired-coupons TODO is reworded but still an unhandled TODO, not implemented or removed. |
