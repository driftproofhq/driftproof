# git-workflow-and-versioning — receipt summary

- **model:** `claude-fable-5-1` (released 2026-09-01)
- **surface:** claude-cli
- **answered by: model claude-fable-5-1 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-10T20:46:04.198Z
- **runner:** v0.28.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** retained-local
- **skill content_hash:** `91c8c72654ee6ef1…`
- **suite:** 1 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `67e3d1e37b651180…`

## Headline

Fake tool calls: with the subject 0/3; without the subject 0/3.
with_skill **0.845 ± n/a (1 case)** vs baseline **0.844 ± n/a (1 case)**

skill lift **+0.001** (combined uncertainty ± n/a (1 case))

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.845 ± 0.009 | Subject uses the `fix:` type and is specific; the body explains the cause (wrong unit) and the user-facing impact (early dead links), and notes that existing tokens are unaffected. The cause is stated vaguely as 'a different unit' without naming the units. |
| `commit-message-conventional-type` | baseline | pass | 0.844 ± 0.009 | Subject uses the conventional `fix(auth):` prefix with a specific, user-visible description. The body explains the wrong-unit cause, the roughly 24x shortfall, and the user impact, so it goes beyond restating the diff. It is not fully exemplary because it does not name the specific units involved. |
