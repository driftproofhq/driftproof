# git-workflow-and-versioning — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:45:51.283Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `9750ab119e3c0992…`

## Headline

with_skill **0.863 ± n/a (1 case)** vs baseline **0.850 ± n/a (1 case)**

skill lift **+0.013** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.863 ± 0.000 | Uses `fix:` prefix with a specific subject and a body explaining the wrong-unit cause, user-facing impact, and handling of already-issued links. |
| `commit-message-conventional-type` | baseline | pass | 0.850 ± 0.007 | Uses conventional `fix(auth):` prefix, specific subject, and body conveys both user-facing impact (1h vs 24h expiry) and cause (wrong time unit); exemplary but slightly redundant file-path restatement. |
