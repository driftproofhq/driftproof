# Drift report

**Skill:** code-review-and-quality `0.0.0`

| | 2026-09-29 | 2026-09-29 |
|---|---|---|
| model | `claude-sonnet-5` | `claude-sonnet-5-5` |
| run date (UTC) | 2026-09-29T04:56:13.861Z | 2026-09-29T04:42:56.786Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `13d360d7f786` | `13d360d7f786` |
| suite_hash | `5d729f885294` | `5d729f885294` |
| with_skill (mean ± band) | 0.881 ± n/a (1 case) | 0.900 ± n/a (1 case) |
| baseline score | 0.674 | 0.849 |
| skill lift (Δ) | +0.207 | +0.051 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.019 (0.881 ± n/a (1 case) → 0.900 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 0 with no separation detected, 1 below the 0.05 effect floor.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-29 (mean ± sd) | 2026-09-29 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `severity-labeled-findings` | 0.881 ± 0.005 (generation) | 0.900 ± 0.012 (generation) | +0.019 | below effect floor |
