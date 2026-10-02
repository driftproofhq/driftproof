# git-workflow-and-versioning — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **answered by: model claude-sonnet-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T06:00:53.481Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `f3c90a5948a5dd76…`

## Headline

with_skill **0.831 ± n/a (1 case)** vs baseline **0.836 ± n/a (1 case)**

skill lift **-0.004** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.831 ± 0.010 | Uses `fix:` prefix with a specific subject and a body giving cause (wrong unit) and impact (~1h vs 24h); cause arithmetic slightly inconsistent, limiting exemplary credit. |
| `commit-message-conventional-type` | baseline | pass | 0.836 ± 0.025 | Uses `fix(auth):` prefix, specific subject, and a body giving cause and user-facing impact; invented minutes-as-milliseconds detail is arithmetically inconsistent with ~1 hour, so not exemplary. |
