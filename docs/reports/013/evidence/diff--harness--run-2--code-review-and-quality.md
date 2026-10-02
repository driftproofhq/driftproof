# Drift report

**Skill:** code-review-and-quality `0.0.0`

| | 2026-09-23 | 2026-09-29 |
|---|---|---|
| model | `claude-opus-5-5` | `claude-opus-5-5` |
| run date (UTC) | 2026-09-23T06:34:35.169Z | 2026-09-29T05:10:32.793Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `13d360d7f786` | `13d360d7f786` |
| suite_hash | `5d729f885294` | `5d729f885294` |
| with_skill (mean ± band) | 0.910 ± n/a (1 case) | 0.894 ± n/a (1 case) |
| baseline score | 0.680 | 0.857 |
| skill lift (Δ) | +0.230 | +0.038 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved -0.016 (0.910 ± n/a (1 case) → 0.894 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

Underpowered: 1 of the cases with no separation under the rule. Not enough draws to conclude at this effect floor. Draws needed: 6 draws per arm (case severity-labeled-findings), with the spreads held.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-23 (mean ± sd) | 2026-09-29 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `severity-labeled-findings` | 0.910 ± 0.015 (generation) | 0.894 ± 0.017 (generation) | -0.016 | no separation detected; Not enough draws to conclude at this effect floor |
