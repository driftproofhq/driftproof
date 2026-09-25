# Drift report

**Skill:** code-review-and-quality `0.0.0`

| | 2026-09-24 | 2026-09-24 |
|---|---|---|
| model | `claude-opus-5` | `claude-opus-5-5` |
| run date (UTC) | 2026-09-24T07:21:40.499Z | 2026-09-24T07:04:47.676Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `13d360d7f786` | `13d360d7f786` |
| suite_hash | `5d729f885294` | `5d729f885294` |
| with_skill (mean ± band) | 0.899 ± n/a (1 case) | 0.902 ± n/a (1 case) |
| baseline score | 0.870 | 0.693 |
| skill lift (Δ) | +0.029 | +0.209 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.003 (0.899 ± n/a (1 case) → 0.902 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-24 (mean ± sd) | 2026-09-24 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `severity-labeled-findings` | 0.899 ± 0.005 (generation) | 0.902 ± 0.016 (generation) | +0.003 | no separation detected |

