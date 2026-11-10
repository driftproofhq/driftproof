# tdd — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T15:41:32.477Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `cc5466e20027f223…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `af48d1c09e9debed…`

## Headline

Fake tool calls: with the subject 0/10; without the subject 0/9; placebo 0/10.
with_skill **0.932 ± 0.104** vs baseline **0.917 ± 0.144**

skill lift **+0.015** (combined uncertainty ± 0.178)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `test` | with_skill | pass | 1.000 ± 0.000 | Tests the public reserve(stock, amount) seam, asserts the given value 2, proposes running the failing test before any implementation, and describes one minimal implementation step with the next test deferred. |
| `test` | baseline | pass | 1.000 ± 0.000 | Tests the public reserve(4, 2) interface, asserts the given value 2, proposes running the failing test before implementation, and describes one minimal implementation step. |
| `coupling` | with_skill | pass | 0.983 ± 0.029 | Identifies spying on the private normalizeCart helper as coupling, flags the reduce recomputation as tautological, replaces it with a literal total of 15, and keeps the test at the public total entry point. |
| `coupling` | baseline | pass | 1.000 ± 0.000 | Flags private-helper coupling, identifies the tautological reimplemented-formula expectation, replaces it with a literal total of 15, and keeps the test at the public getTotal interface. |
| `agreement` | with_skill | borderline ⚠ | 0.813 ± 0.225 | Meets all four criteria: proposes agreeing a public refund seam first, names the observable outcome (full refund returns success and reduces refundable balance), states what the seam misses, and avoids a private-method suite. |
| `agreement` | baseline | borderline ⚠ | 0.750 ± 0.000 | Meets criteria 1, 3, and 4: it asks for an agreed public refund seam first, lists what the seam misses, and avoids a private-method suite. It misses 2, since no concrete observable refund outcome is named. |
## Same-length placebo

- **placebo:** 3629 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `78b1bb9bd02ed351…`)
- case rule: Not enough draws to conclude at this effect floor
- aggregate, apart from the case rule: mean score with_skill 0.932, placebo 0.908, difference (with_skill minus placebo) +0.024, combined uncertainty ± 0.190
