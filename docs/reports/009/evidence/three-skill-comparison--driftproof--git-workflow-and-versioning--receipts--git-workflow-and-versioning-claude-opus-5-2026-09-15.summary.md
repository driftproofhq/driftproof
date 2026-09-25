# git-workflow-and-versioning — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-15T16:06:45.501Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `2df794c7f2539a9c…`

## Headline

with_skill **0.862 ± n/a (1 case)** vs baseline **0.300 ± n/a (1 case)**

skill lift **+0.562** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.862 ± 0.007 | Uses `fix:` with a specific subject; the body explains the cause (unconverted unit) and user impact (expired-link errors), so it is exemplary, though it never names the actual units. |
| `commit-message-conventional-type` | baseline | fail | 0.300 ± 0.000 | Subject lacks the conventional `fix:` prefix, triggering the 0.3 cap, although the subject is specific and the body explains cause and user impact well. |
