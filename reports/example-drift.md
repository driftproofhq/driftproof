# Drift report

**Skill:** commit-message-conventions `0.2.0`

| | 2026-07-28 | 2026-07-28 |
|---|---|---|
| model | `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` |
| run date (UTC) | 2026-07-28T04:27:42.815Z | 2026-07-28T05:12:17.084Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `7796e0efea33` | `7796e0efea33` |
| suite_hash | `220b1101477f` | `220b1101477f` |
| with_skill (mean ± band) | 0.833 ± 0.074 | 0.840 ± 0.078 |
| baseline score | 0.429 | 0.521 |
| skill lift (Δ) | +0.404 | +0.319 |

> **⚠ Caveats**
> - judge template unrecorded on 2026-07-28 and 2026-07-28 (a pre-v0.6 receipt carries no run.judge.prompt_template_hash); the judge model id and the rubric hashes are compared, the template is not.
> - band provenance: `(legacy)` is a JUDGE-SAMPLE spread over a single generation: the standard deviation across the judge's samples of that one text.

## Headline

**NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean ± 1 sd); this is not evidence that nothing changed.**

with_skill mean moved +0.008 (0.833 ± 0.074 → 0.840 ± 0.078; band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 10 with no separation detected.

## Per-case with_skill (band overlap → verdict)

| case | 2026-07-28 (mean ± sd) | 2026-07-28 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `long-body-wrap-72` | 0.838 ± 0.047 (legacy) | 0.828 ± 0.031 (legacy) | -0.010 | no separation detected |
| `breaking-change` | 0.892 ± 0.008 (legacy) | 0.884 ± 0.025 (legacy) | -0.008 | no separation detected |
| `chore-vs-feat` | 0.650 ± 0.000 (legacy) | 0.650 ± 0.000 (legacy) | +0.000 | no separation detected |
| `footer-issue-ref` | 0.800 ± 0.000 (legacy) | 0.800 ± 0.000 (legacy) | +0.000 | no separation detected |
| `fix-with-body` | 0.866 ± 0.011 (legacy) | 0.868 ± 0.015 (legacy) | +0.002 | no separation detected |
| `feat-basic` | 0.850 ± 0.000 (legacy) | 0.856 ± 0.013 (legacy) | +0.006 | no separation detected |
| `build-type-selection` | 0.810 ± 0.022 (legacy) | 0.820 ± 0.027 (legacy) | +0.010 | no separation detected |
| `perf-not-refactor` | 0.916 ± 0.009 (legacy) | 0.938 ± 0.016 (legacy) | +0.022 | no separation detected |
| `revert-format` | 0.828 ± 0.052 (legacy) | 0.856 ± 0.063 (legacy) | +0.028 | no separation detected |
| `split-unrelated` | 0.876 ± 0.013 (legacy) | 0.904 ± 0.017 (legacy) | +0.028 | no separation detected |

