# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-23T06:43:12.011Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `b924a435c70e0092…`

## Headline

with_skill **0.661 ± n/a (1 case)** vs baseline **0.567 ± n/a (1 case)**

skill lift **+0.094** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | borderline ⚠ | 0.661 ± 0.148 | Met (a) and (b) cleanly, but left the TODO as a restatement with an admitted placeholder reason, and the added '10% gold-tier discount' comment restates the what, not why. |
| `comment-intent-not-implementation` | baseline | fail | 0.567 ± 0.000 | Meets (a) and (b) fully; misses (c) by rephrasing rather than handling or removing the TODO; gold-tier comment partly restates the 'what' before adding intent. |
