# git-workflow-and-versioning — receipt summary

- **model:** `claude-opus-5` (released 2026-07-24)
- **surface:** claude-cli
- **answered by: model claude-opus-5 (attested by the surface; the same-user spawn (--trusted-skill))**
- **run (UTC):** 2026-09-23T06:59:34.361Z
- **runner:** v0.10.1
- **judge:** 3 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `2ba4ef175d7f1caf…`

## Headline

with_skill **0.861 ± n/a (1 case)** vs baseline **0.765 ± n/a (1 case)**

skill lift **+0.096** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 3 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.861 ± 0.008 | Subject uses `fix:` prefix and is specific; body explains the wrong-unit cause and user-facing impact plus migration caveat, exceeding a bare restatement of the diff. |
| `commit-message-conventional-type` | baseline | borderline ⚠ | 0.765 ± 0.269 | Uses `fix(auth):` prefix with a specific subject; body explains user-facing consequence and cause, though it deliberately omits concrete units and adds hedged verbosity. |
