# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T05:20:20.883Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `330f82a2417cf303…`

## Headline

with_skill **0.850 ± n/a (1 case)** vs baseline **0.550 ± n/a (1 case)**

skill lift **+0.300** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | pass | 0.850 ± 0.007 | Removes all three restating comments, the commented-out legacy line, and the bare TODO; remaining JSDoc and inline comment explain mutation, non-idempotency, and stale-total intent rather than the what. |
| `comment-intent-not-implementation` | baseline | fail | 0.550 ± 0.033 | Met (a) and (b) cleanly and added useful contract docs, but explicitly left the bare TODO (c) dangling and the retained gold-tier comment largely restates the 0.9 multiplication. |
