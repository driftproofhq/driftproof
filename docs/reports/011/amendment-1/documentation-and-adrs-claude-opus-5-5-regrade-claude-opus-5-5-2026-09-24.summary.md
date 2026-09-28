# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:18:11.322Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `51a3d724dd17be44…`

## Headline

with_skill **0.658 ± n/a (1 case)** vs baseline **0.587 ± n/a (1 case)**

skill lift **+0.071** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | borderline ⚠ | 0.658 ± 0.105 | Meets (a), (b), and adds a useful side-effect doc comment. Misses (c): the TODO remains with a placeholder reason. The '10% gold-tier discount' comment only partly states intent (d). |
| `comment-intent-not-implementation` | baseline | fail | 0.587 ± 0.012 | Meets (a) and (b); misses (c) by rewording rather than removing the TODO; (d) partial: side-effect comment explains why, but 'Gold tier gets 10% off' restates the code. |
