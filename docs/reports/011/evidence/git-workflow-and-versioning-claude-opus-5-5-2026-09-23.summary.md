# git-workflow-and-versioning — receipt summary

- **model:** `claude-opus-5-5`
- **surface:** claude-cli
- **answered by: model claude-opus-5-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-23T06:36:59.519Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `ca69c3436d0dbfa5…`

## Headline

with_skill **0.838 ± n/a (1 case)** vs baseline **0.300 ± n/a (1 case)**

skill lift **+0.538** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.838 ± 0.027 | Uses `fix:` prefix, specific subject, and a body conveying both user-facing impact (early expiry, forced re-request) and cause (missing unit conversion) beyond the diff. |
| `commit-message-conventional-type` | baseline | fail | 0.300 ± 0.000 | Body strongly explains cause and user-facing impact, and subject is specific, but subject lacks the conventional `fix:` type prefix, triggering the 0.3 cap. |
