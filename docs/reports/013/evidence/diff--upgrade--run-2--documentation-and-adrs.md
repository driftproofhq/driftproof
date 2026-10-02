# Drift report

**Skill:** documentation-and-adrs `0.0.0`

| | 2026-09-29 | 2026-09-29 |
|---|---|---|
| model | `claude-sonnet-5` | `claude-sonnet-5-5` |
| run date (UTC) | 2026-09-29T05:04:47.416Z | 2026-09-29T04:51:21.171Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `b67a9f07ed10` | `b67a9f07ed10` |
| suite_hash | `6cce54e7d9d0` | `6cce54e7d9d0` |
| with_skill (mean ± band) | 0.700 ± n/a (1 case) | 0.813 ± n/a (1 case) |
| baseline score | 0.706 | 0.576 |
| skill lift (Δ) | -0.006 | +0.238 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.113 (0.700 ± n/a (1 case) → 0.813 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

Underpowered: 1 of the cases with no separation under the rule. Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case comment-intent-not-implementation: the two arms' spreads sum to 0.193, at or above the 0.05 floor).

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-29 (mean ± sd) | 2026-09-29 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `comment-intent-not-implementation` | 0.700 ± 0.098 (generation) | 0.813 ± 0.094 (generation) | +0.113 | no separation detected; Not enough draws to conclude at this effect floor |
