# documentation-and-adrs — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **answered by: model claude-sonnet-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T05:04:47.416Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `be6e3ee15add5310…`

## Headline

with_skill **0.700 ± n/a (1 case)** vs baseline **0.706 ± n/a (1 case)**

skill lift **-0.006** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | borderline ⚠ | 0.700 ± 0.098 | Met (a) and (b) and added no 'what' comments, but left the bare TODO dangling (c) and added no intent/why comment for the gold-tier discount (d). |
| `comment-intent-not-implementation` | baseline | borderline ⚠ | 0.706 ± 0.104 | Meets (a) and (b) — all three restating comments and the commented-out legacyRate line removed — but leaves the bare TODO dangling, missing (c); no intent comment added per (d). |
