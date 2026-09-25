# git-workflow-and-versioning — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:32:09.846Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `9c08411c7a4b85b9…`

## Headline

with_skill **0.866 ± n/a (1 case)** vs baseline **0.774 ± n/a (1 case)**

skill lift **+0.091** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.866 ± 0.005 | Uses `fix:` prefix with a specific subject; body explains the wrong-unit cause, user-facing early expiry, and a maintainer-actionable note on existing tokens. Exemplary. |
| `commit-message-conventional-type` | baseline | borderline ⚠ | 0.774 ± 0.272 | Uses the conventional fix(auth): prefix with a specific subject; the body states the user-facing impact (links expiring after an hour) and the unit-conversion cause, plus migration implications. |
