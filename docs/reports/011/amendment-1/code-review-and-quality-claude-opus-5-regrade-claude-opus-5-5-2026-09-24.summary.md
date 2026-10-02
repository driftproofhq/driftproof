# code-review-and-quality — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:23:36.568Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `13d360d7f786de37…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `31b1313fe305c381…`

## Headline

with_skill **0.901 ± n/a (1 case)** vs baseline **0.788 ± n/a (1 case)**

skill lift **+0.113** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `severity-labeled-findings` | with_skill | pass | 0.901 ± 0.013 | Explicit severity sections; hardcoded secret Critical, PII logging Critical, `data` name Nit; leverage ordering; concrete fixes throughout. Minor flaw: a 'Required' item sits in the Nit section. |
| `severity-labeled-findings` | baseline | borderline ⚠ | 0.788 ± 0.134 | Explicit severity tiers throughout: hardcoded secret Critical, PII logging High, `data` naming Low; ordered by leverage with fixes, but uses Critical/High/Medium/Low rather than the skill's Required/Nit vocabulary. |
