# tdd — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T16:11:23.317Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `cc5466e20027f223…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `9ca6bc6c1a104662…`

## Headline

Fake tool calls: with the subject 0/10; without the subject 0/10; placebo 0/9.
with_skill **0.986 ± 0.013** vs baseline **0.946 ± 0.094**

skill lift **+0.040** (combined uncertainty ± 0.095)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `test` | with_skill | pass | 1.000 ± 0.000 | Tests the public reserve(4, 2) interface, asserts the given literal value 2, proposes the failing test before implementation, and describes one minimal green step with a single next slice. |
| `test` | baseline | pass | 1.000 ± 0.000 | Calls the public reserve(4, 2) seam, asserts the given value 2, proposes running the test red before implementing, and describes one minimal green step before the next test. |
| `coupling` | with_skill | pass | 0.975 ± 0.050 | Criterion 1 met: flags spying on private normalizeCart as implementation coupling. Criterion 2 met: identifies the reduce-with-production-formula expectation as tautological. Criterion 3 met: replaces it with a hardcoded observable total of 15. Criterion 4 met: keeps the test at the public order int |
| `coupling` | baseline | pass | 1.000 ± 0.000 | Covers all four rubric points: flags spying on private normalizeCart as implementation coupling, identifies the reduce-formula expectation as tautological, replaces it with a literal total of 15, and keeps the test at the public order interface. |
| `agreement` | with_skill | pass | 0.983 ± 0.029 | The response proposes agreeing on a public refund seam before writing tests, names observable outcomes (full refund, partial balance, over-refund rejection), states explicit misses, and rejects testing all internals. |
| `agreement` | baseline | borderline ⚠ | 0.838 ± 0.103 | Meets criteria 1 (agree on a public seam first), 3 (lists seam limits), and 4 (avoids private-internals suite); misses 2, since it lists observable outputs generically without naming a concrete refund outcome. |
## Same-length placebo

- **placebo:** 3629 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `78b1bb9bd02ed351…`)
- case rule: Not enough draws to conclude at this effect floor
- aggregate, apart from the case rule: mean score with_skill 0.986, placebo 0.978, difference (with_skill minus placebo) +0.008, combined uncertainty ± 0.028
