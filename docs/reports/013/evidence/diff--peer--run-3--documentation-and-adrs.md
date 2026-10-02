# Drift report

**Skill:** documentation-and-adrs `0.0.0`

| | 2026-09-29 | 2026-09-29 |
|---|---|---|
| model | `claude-opus-5-5` | `claude-sonnet-5-5` |
| run date (UTC) | 2026-09-29T06:24:35.613Z | 2026-09-29T05:49:39.963Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `b67a9f07ed10` | `b67a9f07ed10` |
| suite_hash | `6cce54e7d9d0` | `6cce54e7d9d0` |
| with_skill (mean ± band) | 0.840 ± n/a (1 case) | 0.847 ± n/a (1 case) |
| baseline score | 0.518 | 0.574 |
| skill lift (Δ) | +0.322 | +0.272 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.007 (0.840 ± n/a (1 case) → 0.847 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

Underpowered: 1 of the cases with no separation under the rule. Not enough draws to conclude at this effect floor. Draws needed: 11 draws per arm (case comment-intent-not-implementation), with the spreads held.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-29 (mean ± sd) | 2026-09-29 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `comment-intent-not-implementation` | 0.840 ± 0.020 (generation) | 0.847 ± 0.015 (generation) | +0.007 | no separation detected; Not enough draws to conclude at this effect floor |
