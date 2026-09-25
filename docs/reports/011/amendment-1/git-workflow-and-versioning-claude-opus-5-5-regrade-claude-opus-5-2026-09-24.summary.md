# git-workflow-and-versioning — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:08:55.691Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `30cc87c800433ab4…`

## Headline

with_skill **0.844 ± n/a (1 case)** vs baseline **0.300 ± n/a (1 case)**

skill lift **+0.544** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.844 ± 0.015 | Uses `fix:` prefix with a specific subject; body concisely conveys the wrong-unit cause and the user-facing expired-link impact, meeting the exemplary band. |
| `commit-message-conventional-type` | baseline | fail | 0.300 ± 0.000 | Body explains cause, impact, and fix well, but subject uses 'Fix ...' rather than the conventional `fix:` type prefix, triggering the 0.3 cap. |
