# documentation-and-adrs — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **answered by: model claude-sonnet-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T06:06:43.398Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `8e52377012db6079…`

## Headline

with_skill **0.641 ± n/a (1 case)** vs baseline **0.727 ± n/a (1 case)**

skill lift **-0.085** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | borderline ⚠ | 0.641 ± 0.167 | Meets (a), (b), (c) fully; the one added comment flags a non-obvious interaction but describes behavior/scope rather than business intent, so (d) is only partly satisfied. |
| `comment-intent-not-implementation` | baseline | borderline ⚠ | 0.727 ± 0.118 | Removed all 'what' restatements (a) and the commented-out legacy line (b), but left the bare TODO dangling (c) and added no intent comment for the gold-tier discount. |
