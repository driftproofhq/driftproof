# Drift report

**Skill:** git-workflow-and-versioning `0.0.0`

| | 2026-09-29 | 2026-09-29 |
|---|---|---|
| model | `claude-sonnet-5` | `claude-sonnet-5-5` |
| run date (UTC) | 2026-09-29T06:00:53.481Z | 2026-09-29T05:45:44.389Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `91c8c72654ee` | `91c8c72654ee` |
| suite_hash | `4e74150753d0` | `4e74150753d0` |
| with_skill (mean ± band) | 0.831 ± n/a (1 case) | 0.863 ± n/a (1 case) |
| baseline score | 0.836 | 0.857 |
| skill lift (Δ) | -0.004 | +0.007 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.032 (0.831 ± n/a (1 case) → 0.863 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 0 with no separation detected, 1 below the 0.05 effect floor.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-29 (mean ± sd) | 2026-09-29 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `commit-message-conventional-type` | 0.831 ± 0.010 (generation) | 0.863 ± 0.009 (generation) | +0.032 | below effect floor |
