# git-workflow-and-versioning — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T21:27:24.200Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `ce5e71feb67ea891…`

## Headline

with_skill **0.828 ± n/a (1 case)** vs baseline **0.838 ± n/a (1 case)**

skill lift **-0.010** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.828 ± 0.004 | Uses conventional `fix:` prefix with a specific subject, and the body explains the user-facing symptom (1h vs 24h expiry) and the unit-conversion cause; slightly redundant restatement keeps it just above baseline. |
| `commit-message-conventional-type` | baseline | pass | 0.838 ± 0.015 | Conventional `fix(auth):` prefix, specific imperative subject, and a body giving both the user-facing symptom (~1h vs 24h expiry) and the unit-conversion cause; slight redundancy in closing sentence. |
