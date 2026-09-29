# git-workflow-and-versioning — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:10:19.225Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `2b0faa827373fc04…`

## Headline

with_skill **0.858 ± n/a (1 case)** vs baseline **0.300 ± n/a (1 case)**

skill lift **+0.558** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.858 ± 0.010 | Subject uses `fix:` and specifically names the change; the body explains the wrong-unit cause and the user-facing impact (premature expiry errors), beyond restating the diff. |
| `commit-message-conventional-type` | baseline | fail | 0.300 ± 0.000 | Subject lacks the conventional `fix:` prefix, triggering the 0.3 cap, although it is specific and the body clearly explains cause and user impact. |
