# git-workflow-and-versioning — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **answered by: model claude-sonnet-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:58:46.174Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `8a6cf114ed244626…`

## Headline

with_skill **0.851 ± n/a (1 case)** vs baseline **0.831 ± n/a (1 case)**

skill lift **+0.020** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.851 ± 0.002 | Uses `fix:` prefix with a specific subject and a body conveying user-facing impact (1h vs 24h) and cause (missing unit conversion); slightly speculative millisecond detail prevents higher. |
| `commit-message-conventional-type` | baseline | pass | 0.831 ± 0.033 | Conventional `fix(auth):` prefix, specific subject, and body conveying both user-facing impact (~1h vs 24h) and root cause (wrong time unit); actionable for maintainers. |
