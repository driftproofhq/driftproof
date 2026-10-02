# Drift report

**Skill:** code-review-and-quality `0.0.0`

| | 2026-09-29 | 2026-09-29 |
|---|---|---|
| model | `claude-sonnet-5` | `claude-sonnet-5-5` |
| run date (UTC) | 2026-09-29T05:57:51.258Z | 2026-09-29T05:42:54.981Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `13d360d7f786` | `13d360d7f786` |
| suite_hash | `5d729f885294` | `5d729f885294` |
| with_skill (mean ± band) | 0.657 ± n/a (1 case) | 0.896 ± n/a (1 case) |
| baseline score | 0.573 | 0.861 |
| skill lift (Δ) | +0.085 | +0.034 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.238 (0.657 ± n/a (1 case) → 0.896 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

Underpowered: 1 of the cases with no separation under the rule. Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case severity-labeled-findings: the two arms' spreads sum to 0.259, at or above the 0.05 floor).

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-29 (mean ± sd) | 2026-09-29 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `severity-labeled-findings` | 0.657 ± 0.257 (generation) | 0.896 ± 0.002 (generation) | +0.238 | no separation detected; Not enough draws to conclude at this effect floor |
