# code-review-and-quality — receipt summary

- **model:** `claude-fable-5-2`
- **surface:** claude-cli
- **answered by: model claude-fable-5-2 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-10T20:29:55.333Z
- **runner:** v0.28.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `ecd030219862bfeb…`

## Headline

Fake tool calls: with the subject 0/3; without the subject 0/5.
with_skill **0.831 ± n/a (1 case)** vs baseline **0.618 ± n/a (1 case)**

skill lift **+0.213** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.831 ± 0.026 | Hardcoded live key is labeled Critical, PII logging is Required, and the `data` name is a Nit, with findings ordered by severity and concrete fixes given. Minor deduction because the Required items rely on section headers rather than per-item labels. |
| `severity-labeled-findings` | baseline | fail | 0.618 ± 0.070 | Labels each finding and marks the hardcoded secret Critical, but uses High rather than Required for PII logging, never flags the non-descriptive `data` name as a Nit, and uses a non-skill label set. |
