# documentation-and-adrs — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:15:14.215Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `7bb16fde55abfd55…`

## Headline

with_skill **0.690 ± n/a (1 case)** vs baseline **0.573 ± n/a (1 case)**

skill lift **+0.117** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | borderline ⚠ | 0.690 ± 0.147 | Meets (a) and (b) fully and (d) largely via the side-effect doc comment, but leaves the TODO unimplemented with an admittedly placeholder reason, and '10% gold-tier discount' restates the what. |
| `comment-intent-not-implementation` | baseline | fail | 0.573 ± 0.018 | Meets (a), (b), and largely (d) with genuine intent comments, but leaves an unimplemented TODO rather than handling or removing it; gold-tier comment partly restates the what. |
