# git-workflow-and-versioning — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T04:30:46.324Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `37d0c311a5dc31b2…`

## Headline

with_skill **0.861 ± n/a (1 case)** vs baseline **0.508 ± n/a (1 case)**

skill lift **+0.353** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.861 ± 0.005 | Uses `fix:` prefix, specific subject, and body explains wrong-unit cause plus user-facing impact (expired-link errors), exceeding a bare restatement of the diff. |
| `commit-message-conventional-type` | baseline | borderline ⚠ | 0.508 ± 0.287 | Subject lacks the conventional `fix:` prefix (uses bare 'Fix'), triggering the 0.3 cap despite a specific subject and a body that explains cause and impact. |
