# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-23T07:08:39.029Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `34107e18c90f3b20…`

## Headline

with_skill **0.804 ± n/a (1 case)** vs baseline **0.567 ± n/a (1 case)**

skill lift **+0.237** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | pass | 0.804 ± 0.103 | Removes all three what-comments (a), the commented-out legacyRate (b), and the bare TODO with justification (c); remaining comments document mutation contract, non-idempotence, and stale-total risk — intent, not what (d). |
| `comment-intent-not-implementation` | baseline | fail | 0.567 ± 0.033 | Meets (a), (b), and adds a useful intent/mutation doc comment, but leaves an unimplemented TODO and the '10% off' comment restates what 0.9 does rather than why. |
