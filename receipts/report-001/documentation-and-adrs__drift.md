# Drift report

**Skill:** documentation-and-adrs `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T08:51:55.000Z | 2026-07-28T16:16:10.390Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `e11562bf0b57` | `e11562bf0b57` |
| suite_hash | `254e2b627209` | `254e2b627209` |
| with_skill (mean ± band) | 0.825 ± 0.100 | 0.706 ± 0.297 |
| baseline score | 0.809 | 0.720 |
| skill lift (Δ) | +0.016 | -0.014 |

## Headline

**MIXED — 2 case regressions and 1 improvement on non-overlapping bands.**

with_skill mean moved -0.119 (0.825 ± 0.100 → 0.706 ± 0.297; band = suite dispersion). Per-case band-overlap verdicts: 2 regression(s), 1 improvement(s), 4 within noise.

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `match-existing-adr-convention` | 0.858 ± 0.016 | 0.076 ± 0.043 | -0.782 | 🔻 regression |
| `surface-conflicting-adr-conventions` | 0.850 ± 0.025 | 0.582 ± 0.149 | -0.268 | 🔻 regression |
| `supersede-not-delete-old-adr` | 0.886 ± 0.013 | 0.876 ± 0.005 | -0.010 | within noise |
| `comment-intent-not-implementation` | 0.860 ± 0.014 | 0.864 ± 0.017 | +0.004 | within noise |
| `document-why-not-what-rewrite` | 0.860 ± 0.010 | 0.868 ± 0.013 | +0.008 | within noise |
| `adr-for-costly-to-reverse-decision` | 0.864 ± 0.018 | 0.876 ± 0.005 | +0.012 | within noise |
| `document-public-api-function` | 0.600 ± 0.000 | 0.800 ± 0.000 | +0.200 | 🔼 improvement |

## Regressions (2) — bands do not overlap

- `match-existing-adr-convention`: 0.858 ± 0.016 → 0.076 ± 0.043 (-0.782)
- `surface-conflicting-adr-conventions`: 0.850 ± 0.025 → 0.582 ± 0.149 (-0.268)
