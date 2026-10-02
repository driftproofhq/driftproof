# git-workflow-and-versioning — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-29T06:17:46.758Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `ee303cee2a58c945…`

## Headline

with_skill **0.856 ± n/a (1 case)** vs baseline **0.579 ± n/a (1 case)**

skill lift **+0.276** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.856 ± 0.010 | Uses `fix:` prefix with a specific subject, and the body states the user-facing symptom (links dying in ~1 hour) plus the unit-conversion cause and impact, exceeding a bare diff restatement. |
| `commit-message-conventional-type` | baseline | borderline ⚠ | 0.579 ± 0.322 | Body explains cause and user-facing impact well and subject is specific, but subject uses 'Fix ...' rather than the conventional `fix:` prefix, triggering the 0.3 cap. |
