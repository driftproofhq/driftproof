# git-workflow-and-versioning — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-24T07:28:38.217Z
- **runner:** v0.11.2
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `926fd5eeec003045…`

## Headline

with_skill **0.853 ± n/a (1 case)** vs baseline **0.766 ± n/a (1 case)**

skill lift **+0.087** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.853 ± 0.007 | Uses `fix:` prefix with a specific subject, and the body conveys both the user-facing impact (links dead after ~1 hour) and the unit-conversion cause plus existing-token behavior. |
| `commit-message-conventional-type` | baseline | borderline ⚠ | 0.766 ± 0.269 | Uses conventional `fix(auth):` prefix with a specific subject; body conveys user-facing symptom, unit-conversion cause, and migration impact, exceeding a bare diff restatement. |
