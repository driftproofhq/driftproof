# Drift report

**Skill:** git-workflow-and-versioning `0.0.0`

| | 2026-09-23 | 2026-09-23 |
|---|---|---|
| model | `claude-opus-5` | `claude-opus-5-5` |
| run date (UTC) | 2026-09-23T06:59:34.361Z | 2026-09-23T06:36:59.519Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `91c8c72654ee` | `91c8c72654ee` |
| suite_hash | `4e74150753d0` | `4e74150753d0` |
| with_skill (mean ± band) | 0.861 ± n/a (1 case) | 0.838 ± n/a (1 case) |
| baseline score | 0.765 | 0.300 |
| skill lift (Δ) | +0.096 | +0.538 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved -0.023 (0.861 ± n/a (1 case) → 0.838 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

Underpowered: 1 of the cases with no separation under the rule. Not enough draws to conclude at this effect floor. Draws needed: 16 draws per arm (case commit-message-conventional-type), with the spreads held.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-23 (mean ± sd) | 2026-09-23 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `commit-message-conventional-type` | 0.861 ± 0.008 (generation) | 0.838 ± 0.027 (generation) | -0.023 | no separation detected; Not enough draws to conclude at this effect floor |

