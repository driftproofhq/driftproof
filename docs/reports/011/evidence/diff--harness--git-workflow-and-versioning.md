# Drift report

**Skill:** git-workflow-and-versioning `0.0.0`

| | 2026-09-15 | 2026-09-23 |
|---|---|---|
| model | `claude-opus-5` | `claude-opus-5` |
| run date (UTC) | 2026-09-15T16:06:45.501Z | 2026-09-23T06:59:34.361Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `91c8c72654ee` | `91c8c72654ee` |
| suite_hash | `4e74150753d0` | `4e74150753d0` |
| with_skill (mean ± band) | 0.862 ± n/a (1 case) | 0.861 ± n/a (1 case) |
| baseline score | 0.300 | 0.765 |
| skill lift (Δ) | +0.562 | +0.096 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved -0.001 (0.862 ± n/a (1 case) → 0.861 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-15 (mean ± sd) | 2026-09-23 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `commit-message-conventional-type` | 0.862 ± 0.007 (generation) | 0.861 ± 0.008 (generation) | -0.001 | no separation detected |
