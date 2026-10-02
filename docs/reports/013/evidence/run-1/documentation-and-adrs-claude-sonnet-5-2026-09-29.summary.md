# documentation-and-adrs — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **answered by: model claude-sonnet-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:19:32.046Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `76c9cfff2b939e17…`

## Headline

with_skill **0.602 ± n/a (1 case)** vs baseline **0.661 ± n/a (1 case)**

skill lift **-0.059** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | fail | 0.602 ± 0.004 | Met (a) removing all 'what' comments and (b) deleting the commented-out legacyRate line, but left the bare TODO dangling (c) and added no intent comment (d). |
| `comment-intent-not-implementation` | baseline | borderline ⚠ | 0.661 ± 0.187 | Removes all three restating comments, the commented-out legacyRate line, and the bare TODO; retained comment states the gold-tier business rule, though it borders on restating the 0.9 multiplier. |
