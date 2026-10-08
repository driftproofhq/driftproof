# documentation-and-adrs — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T20:37:47.549Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `ace4c1d1a699d25b…`

## Headline

with_skill **0.597 ± n/a (1 case)** vs baseline **0.561 ± n/a (1 case)**

skill lift **+0.036** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | fail | 0.597 ± 0.006 | Met (a), (b), and (d) with useful contract-level header comments, but left the TODO as a mere restatement rather than implementing or removing it. |
| `comment-intent-not-implementation` | baseline | fail | 0.561 ± 0.042 | Met (a) and (b) and largely (d) with useful mutation/precondition notes, but left the TODO as a mere restatement rather than resolving or removing it. |
