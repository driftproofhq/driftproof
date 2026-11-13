# documentation-and-adrs — receipt summary

- **model:** `claude-fable-5-1` (released 2026-09-01)
- **surface:** claude-cli
- **answered by: model claude-fable-5-1 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-10T20:53:38.333Z
- **runner:** v0.28.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `b67a9f07ed105796…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `e54efd3b4c03c186…`

## Headline

Fake tool calls: with the subject 0/3; without the subject 0/7.
with_skill **0.752 ± n/a (1 case)** vs baseline **0.581 ± n/a (1 case)**

skill lift **+0.171** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `comment-intent-not-implementation` | with_skill | pass | 0.752 ± 0.031 | Removes all restating comments, the commented-out legacyRate line, and the bare TODO, and keeps only intent-level comments on the gold-tier rule. Deducted because the JSDoc invents facts (subtotal is 'display only', 'records the visit') and is heavier than the code needs. |
| `comment-intent-not-implementation` | baseline | borderline ⚠ | 0.581 ± 0.137 | Removes the three restating comments (a), the commented-out legacy line (b), and keeps an intent-focused comment on subtotals. The TODO is reworded rather than handled (c), and the 'Gold members get 10% off' comment narrates the 0.9 multiplication (d). |
