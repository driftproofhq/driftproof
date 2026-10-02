# Drift report

**Skill:** documentation-and-adrs `0.0.0`

| | 2026-09-23 | 2026-09-29 |
|---|---|---|
| model | `claude-opus-5-5` | `claude-opus-5-5` |
| run date (UTC) | 2026-09-23T06:43:12.011Z | 2026-09-29T05:20:20.883Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `b67a9f07ed10` | `b67a9f07ed10` |
| suite_hash | `6cce54e7d9d0` | `6cce54e7d9d0` |
| with_skill (mean ± band) | 0.661 ± n/a (1 case) | 0.850 ± n/a (1 case) |
| baseline score | 0.567 | 0.550 |
| skill lift (Δ) | +0.094 | +0.300 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**IMPROVED: separation detected under the rule on 1 case, upward (bands do not overlap and the move clears the effect floor); none downward.**

with_skill mean moved +0.189 (0.661 ± n/a (1 case) → 0.850 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 1 improvement(s), 0 with no separation detected.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-23 (mean ± sd) | 2026-09-29 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `comment-intent-not-implementation` | 0.661 ± 0.148 (generation) | 0.850 ± 0.007 (generation) | +0.189 | 🔼 improvement |
