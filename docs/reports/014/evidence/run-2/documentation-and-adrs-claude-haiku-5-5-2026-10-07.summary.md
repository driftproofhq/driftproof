# documentation-and-adrs — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T20:56:04.145Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `d1829e258160c025…`

## Headline

with_skill **0.500 ± n/a (1 case)** vs baseline **0.589 ± n/a (1 case)**

skill lift **-0.089** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | fail | 0.500 ± 0.087 | Met (a) and (b) and mostly (d), but left the bare TODO dangling (c), and the mutation comment leans toward narrating behavior rather than intent. |
| `comment-intent-not-implementation` | baseline | fail | 0.589 ± 0.005 | Meets (a) and (b) and keeps comments caveat/contract-focused rather than narrating code, but leaves the bare TODO dangling verbatim, violating (c) and lacking a true WHY for the gold discount. |
