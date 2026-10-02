# code-review-and-quality — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T06:14:31.245Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `de6e30b2499278e8…`

## Headline

with_skill **0.903 ± n/a (1 case)** vs baseline **0.713 ± n/a (1 case)**

skill lift **+0.190** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.903 ± 0.015 | Explicit Critical/Required/Consider/Nit labels on every finding, secret marked Critical, PII logging Critical, `data` name a Nit, ordered by leverage with concrete fixes. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.713 ± 0.211 | Every finding carries an explicit severity (Critical/High/Medium/Low), hardcoded secret and PII logging are Critical, cosmetic naming is Low, findings ordered by leverage, concrete fixes given; `data` naming folded into a Medium rather than labeled a nit. |
