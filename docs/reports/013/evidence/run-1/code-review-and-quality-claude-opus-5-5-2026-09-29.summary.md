# code-review-and-quality — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:26:04.501Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `6eec133f88fec12c…`

## Headline

with_skill **0.907 ± n/a (1 case)** vs baseline **0.831 ± n/a (1 case)**

skill lift **+0.076** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.907 ± 0.015 | Explicit Critical/Required/Nit labels; secret Critical, PII Required, `data` Nit; ordered by leverage with concrete fixes each, only the unlabeled 'Verification gap' section slightly imperfect. |
| `severity-labeled-findings` | baseline | pass | 0.831 ± 0.066 | Every finding carries an explicit severity; secret is Critical, PII logging High, naming Low; ordered by leverage with concrete fixes, but labels deviate from the skill's taxonomy and `data` sits at Medium. |
