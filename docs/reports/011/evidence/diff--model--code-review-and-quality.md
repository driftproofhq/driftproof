# Drift report

**Skill:** code-review-and-quality `0.0.0`

| | 2026-09-23 | 2026-09-23 |
|---|---|---|
| model | `claude-opus-5` | `claude-opus-5-5` |
| run date (UTC) | 2026-09-23T06:49:59.857Z | 2026-09-23T06:34:35.169Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 3 | 3 |
| skill content_hash | `13d360d7f786` | `13d360d7f786` |
| suite_hash | `5d729f885294` | `5d729f885294` |
| with_skill (mean ± band) | 0.901 ± n/a (1 case) | 0.910 ± n/a (1 case) |
| baseline score | 0.862 | 0.680 |
| skill lift (Δ) | +0.039 | +0.230 |

> **⚠ Caveats**
> - band provenance: `(generation)` is an ACROSS-DRAW spread: the standard deviation of the case's score across n generation draws per arm.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.009 (0.901 ± n/a (1 case) → 0.910 ± n/a (1 case); band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 1 with no separation detected.

## Per-case with_skill (band overlap → verdict)

| case | 2026-09-23 (mean ± sd) | 2026-09-23 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `severity-labeled-findings` | 0.901 ± 0.007 (generation) | 0.910 ± 0.015 (generation) | +0.009 | no separation detected |
