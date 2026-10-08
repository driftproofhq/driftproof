# git-workflow-and-versioning — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-10-07T20:29:31.013Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `8b2539f694021931…`

## Headline

with_skill **0.849 ± n/a (1 case)** vs baseline **0.300 ± n/a (1 case)**

skill lift **+0.549** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.849 ± 0.008 | Uses conventional `fix(auth):` prefix with a specific subject, and the body conveys both the user-facing symptom (1h vs 24h expiry) and the wrong-unit cause; slightly redundant phrasing. |
| `commit-message-conventional-type` | baseline | fail | 0.300 ± 0.000 | Subject reads 'Fix password-reset link expiry...' without the conventional `fix:` prefix, triggering the 0.3 cap despite a specific subject and a clear why-focused body. |
