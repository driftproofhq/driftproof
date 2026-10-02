# git-workflow-and-versioning — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **answered by: model claude-sonnet-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:15:21.408Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `14902c6b274a124b…`

## Headline

with_skill **0.814 ± n/a (1 case)** vs baseline **0.802 ± n/a (1 case)**

skill lift **+0.012** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.814 ± 0.028 | Uses `fix:` prefix with a specific subject, and the body states both the user-facing consequence (24h links expiring in ~1h) and the unit-conversion cause. |
| `commit-message-conventional-type` | baseline | pass | 0.802 ± 0.043 | Uses `fix(auth):` prefix with a specific subject and a body giving consequence and cause; minor deduction for the internally inconsistent invented detail "24 minutes' worth ... (~1 hour)". |
