# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T06:24:35.613Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `be8805bb87c94001…`

## Headline

with_skill **0.840 ± n/a (1 case)** vs baseline **0.518 ± n/a (1 case)**

skill lift **+0.322** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | pass | 0.840 ± 0.020 | Removes all three restating comments, the commented-out legacyRate, and the bare TODO; remaining JSDoc and inline comments explain intent, mutation, and non-idempotency. |
| `comment-intent-not-implementation` | baseline | fail | 0.518 ± 0.083 | Met (a), (b), and largely (d) with useful mutation/intent notes, but left the bare TODO dangling and the 'Gold tier gets 10% off' line partly restates the code. |
