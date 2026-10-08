# git-workflow-and-versioning — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T20:48:24.950Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `5d46e61c93a1bc1d…`

## Headline

with_skill **0.839 ± n/a (1 case)** vs baseline **0.849 ± n/a (1 case)**

skill lift **-0.010** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.839 ± 0.014 | Uses `fix:` prefix with a specific subject, and the body states the user-facing consequence (links expiring in ~1h not 24h) and the wrong-unit cause. |
| `commit-message-conventional-type` | baseline | pass | 0.849 ± 0.012 | Uses `fix(auth):` prefix, specific subject, and body conveying both user-facing impact (1h vs 24h expiry) and cause (wrong time unit) actionably. |
