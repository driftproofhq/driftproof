# git-workflow-and-versioning — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T21:50:37.187Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `bf1e17919f1e9068…`

## Headline

with_skill **0.813 ± n/a (1 case)** vs baseline **0.839 ± n/a (1 case)**

skill lift **-0.026** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.813 ± 0.003 | Uses `fix:` prefix with a specific subject and a body stating both cause (wrong time unit) and user-facing impact (links expiring 24x early), slightly beyond baseline correctness. |
| `commit-message-conventional-type` | baseline | pass | 0.839 ± 0.014 | Uses `fix(auth):` prefix with a specific subject; body states user-facing symptom (~1h vs 24h) and the wrong-unit cause, exceeding a mere diff restatement. |
