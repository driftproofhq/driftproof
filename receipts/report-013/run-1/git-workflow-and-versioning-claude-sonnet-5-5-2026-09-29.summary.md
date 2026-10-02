# git-workflow-and-versioning — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:00:32.606Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `8842319fabc68510…`

## Headline

with_skill **0.860 ± n/a (1 case)** vs baseline **0.860 ± n/a (1 case)**

skill lift **+0.000** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.860 ± 0.009 | Uses `fix:` prefix with specific subject; body explains wrong-unit cause and user-facing impact (expired links/error) plus intent, exceeding a bare diff restatement. |
| `commit-message-conventional-type` | baseline | pass | 0.860 ± 0.009 | Subject uses `fix(auth):` with a specific description; body explains the user-facing symptom, the unit-conversion cause, the fix, and already-issued-link impact — exemplary but not flawless. |
