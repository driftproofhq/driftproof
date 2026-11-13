# git-workflow-and-versioning — receipt summary

- **model:** `claude-fable-5-2`
- **surface:** claude-cli
- **answered by: model claude-fable-5-2 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-10T20:32:19.504Z
- **runner:** v0.28.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `f36e3107e67a996f…`

## Headline

Fake tool calls: with the subject 0/3; without the subject 0/3.
with_skill **0.816 ± n/a (1 case)** vs baseline **0.300 ± n/a (1 case)**

skill lift **+0.516** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.816 ± 0.017 | Subject uses the fix: prefix with a specific description; body explains the user-facing impact (1 hour instead of 24) and the cause (wrong time unit), plus a note on pre-existing links. It does not name the specific unit mismatch, so it is not exemplary. |
| `commit-message-conventional-type` | baseline | fail | 0.300 ± 0.000 | Subject 'Fix password-reset links...' lacks the required conventional 'fix:' type prefix, triggering the cap. Subject is specific and the body explains the wrong-unit cause and user impact. |
