# documentation-and-adrs — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T21:20:58.469Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `aac9b8993050bd0c…`

## Headline

with_skill **0.542 ± n/a (1 case)** vs baseline **0.483 ± n/a (1 case)**

skill lift **+0.059** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | fail | 0.542 ± 0.065 | Met (a) and (b) cleanly, but left the bare TODO merely reworded, and the added comment leans toward describing what the line does rather than business intent. |
| `comment-intent-not-implementation` | baseline | fail | 0.483 ± 0.035 | Met (a) and (b), but left the bare TODO as a mere restatement (c), and remaining comments give behavioral caveats rather than why/intent (d). |
