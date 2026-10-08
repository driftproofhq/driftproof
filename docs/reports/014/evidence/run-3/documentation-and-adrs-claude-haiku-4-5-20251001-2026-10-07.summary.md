# documentation-and-adrs — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T22:01:07.808Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `c298235bf3e35b72…`

## Headline

with_skill **0.739 ± n/a (1 case)** vs baseline **0.605 ± n/a (1 case)**

skill lift **+0.134** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | borderline ⚠ | 0.739 ± 0.092 | Removes all three 'what'-restating comments, the commented-out legacyRate line, and the bare TODO; no intent comment added for the gold-tier discount, so not exemplary. |
| `comment-intent-not-implementation` | baseline | fail | 0.605 ± 0.084 | Met (a) removed all 'what' comments, (b) removed commented-out legacy line, (d) no restating comments added; missed (c) left bare TODO dangling and added no intent comment. |
