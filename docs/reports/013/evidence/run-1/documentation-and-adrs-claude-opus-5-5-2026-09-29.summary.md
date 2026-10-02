# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:37:54.396Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `c28455c50e6997c2…`

## Headline

with_skill **0.650 ± n/a (1 case)** vs baseline **0.534 ± n/a (1 case)**

skill lift **+0.116** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | borderline ⚠ | 0.650 ± 0.102 | Meets (a), (b), (d) — restating comments and commented-out code removed, added comments explain mutation contract and a real trap — but the TODO remains as a rephrased note rather than implemented or removed. |
| `comment-intent-not-implementation` | baseline | fail | 0.534 ± 0.039 | Meets (a) and (b) cleanly, but leaves the bare TODO verbatim (c) and its added gold-tier comment restates the 'what' (10% off) rather than the why (d). |
