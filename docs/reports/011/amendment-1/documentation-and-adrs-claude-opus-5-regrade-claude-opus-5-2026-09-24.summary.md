# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:37:30.838Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `2d871adfaefa09c0…`

## Headline

with_skill **0.807 ± n/a (1 case)** vs baseline **0.583 ± n/a (1 case)**

skill lift **+0.223** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | borderline ⚠ | 0.807 ± 0.109 | Removes all three restating comments and the commented-out legacy line, drops the bare TODO with justification, and adds genuinely useful contract/idempotence/staleness comments that explain intent rather than restate code. |
| `comment-intent-not-implementation` | baseline | fail | 0.583 ± 0.046 | Meets (a), (b), and largely (d), but leaves the coupon TODO unresolved — merely reworded rather than implemented or removed — and `flat 10% off` restates the 0.9. |
