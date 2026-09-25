# Drift report

**Skill:** code-review-and-quality `0.0.0`

| | 2026-09-24 | 2026-09-24 |
|---|---|---|
| model | `claude-opus-5` | `claude-opus-5-5` |
| run date (UTC) | 2026-09-24T07:23:36.568Z | 2026-09-24T07:07:05.036Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `13d360d7f786` | `13d360d7f786` |
| suite_hash | `5d729f885294` | `5d729f885294` |
| with_skill (mean ± band) | 0.901 ± n/a (1 case) | 0.912 ± n/a (1 case) |
| baseline score | 0.788 | 0.603 |
| skill lift (Δ) | +0.113 | +0.309 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.011 (0.901 ± n/a (1 case) → 0.912 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-24 (mean ± sd) | 2026-09-24 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `severity-labeled-findings` | 0.901 ± 0.013 (generation) | 0.912 ± 0.012 (generation) | +0.011 | no separation detected |

