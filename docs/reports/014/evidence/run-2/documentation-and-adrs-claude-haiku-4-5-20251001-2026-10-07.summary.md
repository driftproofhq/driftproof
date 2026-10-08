# documentation-and-adrs — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T21:36:52.734Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `3609ddc948814c96…`

## Headline

with_skill **0.772 ± n/a (1 case)** vs baseline **0.579 ± n/a (1 case)**

skill lift **+0.193** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | pass | 0.772 ± 0.063 | Removes all three what-restating comments, the commented-out legacyRate line, and the bare TODO; no new restating comments, but adds no intent comment, so not exemplary. |
| `comment-intent-not-implementation` | baseline | fail | 0.579 ± 0.053 | Met (a), (b), (d): removed all 'what'-restating comments and the commented-out legacyRate line; missed (c) by leaving the bare TODO dangling unaddressed. |
