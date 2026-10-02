# Drift report

**Skill:** git-workflow-and-versioning `0.0.0`

| | 2026-09-29 | 2026-09-29 |
|---|---|---|
| model | `claude-sonnet-5` | `claude-sonnet-5-5` |
| run date (UTC) | 2026-09-29T04:15:21.408Z | 2026-09-29T04:00:32.606Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `91c8c72654ee` | `91c8c72654ee` |
| suite_hash | `4e74150753d0` | `4e74150753d0` |
| with_skill (mean ± band) | 0.814 ± n/a (1 case) | 0.860 ± n/a (1 case) |
| baseline score | 0.802 | 0.860 |
| skill lift (Δ) | +0.012 | +0.000 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.046 (0.814 ± n/a (1 case) → 0.860 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 0 with no separation detected, 1 below the 0.05 effect floor.

Underpowered: 1 of the cases with no separation under the rule. Not enough draws to conclude at this effect floor. Draws needed: 22 draws per arm (case commit-message-conventional-type), with the spreads held.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-29 (mean ± sd) | 2026-09-29 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `commit-message-conventional-type` | 0.814 ± 0.028 (generation) | 0.860 ± 0.009 (generation) | +0.046 | below effect floor; Not enough draws to conclude at this effect floor |
