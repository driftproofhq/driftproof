# documentation-and-adrs — receipt summary

- **model:** `claude-fable-5-2`
- **surface:** claude-cli
- **answered by: model claude-fable-5-2 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-10T20:36:35.290Z
- **runner:** v0.28.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `dca693a087ecbc14…`

## Headline

Fake tool calls: with the subject 0/4; without the subject 0/3.
with_skill **0.500 ± n/a (1 case)** vs baseline **0.393 ± n/a (1 case)**

skill lift **+0.107** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | fail | 0.500 ± 0.076 | Removes the three restating comments and the commented-out legacyRate line, and the doc comment explains intent. It keeps the bare TODO about expired coupons, violating criterion (c), and the gold-discount note partly narrates the code. |
| `comment-intent-not-implementation` | baseline | fail | 0.393 ± 0.049 | Removes the three restating comments (a) and adds a useful side-effects header, but leaves the commented-out `legacyRate` line (b) and the bare TODO (c). The new gold-tier comment mostly restates the 10% what rather than giving a business reason (d). |
