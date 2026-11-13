# code-review-and-quality — receipt summary

- **model:** `claude-fable-5-1` (released 2026-09-01)
- **surface:** claude-cli
- **answered by: model claude-fable-5-1 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-10T20:42:59.233Z
- **runner:** v0.28.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `79216e2ce275ef5e…`

## Headline

Fake tool calls: with the subject 0/5; without the subject 0/3.
with_skill **0.627 ± n/a (1 case)** vs baseline **0.210 ± n/a (1 case)**

skill lift **+0.417** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | borderline ⚠ | 0.627 ± 0.130 | Labels findings by Critical/Required/Optional sections, flags the hardcoded secret as Critical, orders by severity, and puts the `data` rename under Optional. Misses: the GET-vs-POST finding is overrated as Critical, and no Nit label is used. |
| `severity-labeled-findings` | baseline | fail | 0.210 ± 0.000 | Findings are numbered by priority but none carries an explicit Critical/Required/Nit/Optional label, which triggers the 0.3 cap. The hardcoded secret and PII logging are not labeled, and the `data` naming nit is omitted. |
