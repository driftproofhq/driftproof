# Drift report

**Skill:** git-workflow-and-versioning `0.0.0`

| | 2026-09-24 | 2026-09-24 |
|---|---|---|
| model | `claude-opus-5` | `claude-opus-5-5` |
| run date (UTC) | 2026-09-24T07:32:09.846Z | 2026-09-24T07:10:19.225Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `91c8c72654ee` | `91c8c72654ee` |
| suite_hash | `4e74150753d0` | `4e74150753d0` |
| with_skill (mean ± band) | 0.866 ± n/a (1 case) | 0.858 ± n/a (1 case) |
| baseline score | 0.774 | 0.300 |
| skill lift (Δ) | +0.091 | +0.558 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved -0.008 (0.866 ± n/a (1 case) → 0.858 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-24 (mean ± sd) | 2026-09-24 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `commit-message-conventional-type` | 0.866 ± 0.005 (generation) | 0.858 ± 0.010 (generation) | -0.008 | no separation detected |

