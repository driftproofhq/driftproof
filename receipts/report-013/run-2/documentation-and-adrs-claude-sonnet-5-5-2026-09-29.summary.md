# documentation-and-adrs — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:51:21.171Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `b47d8f54c46e68e0…`

## Headline

with_skill **0.813 ± n/a (1 case)** vs baseline **0.576 ± n/a (1 case)**

skill lift **+0.238** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | pass | 0.813 ± 0.094 | Removes all three restating comments (a), the commented-out legacyRate line (b), and the bare TODO (c); the single added comment names the gold-tier business rule behind 0.9 (d). |
| `comment-intent-not-implementation` | baseline | fail | 0.576 ± 0.025 | Met (a), (b), and largely (d), but left the bare `// TODO: handle expired coupons` untouched, and the gold-tier comment mostly restates what `* 0.9` does. |
