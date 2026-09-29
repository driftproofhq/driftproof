# Drift report

**Skill:** git-workflow-and-versioning `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-30T04:30:22.375Z | 2026-07-30T04:23:06.313Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `c0e9cf58fddf` | `c0e9cf58fddf` |
| suite_hash | `2f3e8cd66159` | `2f3e8cd66159` |
| with_skill (mean ± band) | 0.868 ± 0.025 | 0.834 ± 0.104 |
| baseline score | 0.788 | 0.859 |
| skill lift (Δ) | +0.081 | -0.025 |

## Headline

**MIXED — 1 case regression and 1 improvement on non-overlapping bands.**

with_skill mean moved -0.034 (0.868 ± 0.025 → 0.834 ± 0.104; band = suite dispersion). Per-case band-overlap verdicts: 1 regression(s), 1 improvement(s), 5 within noise.

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `commit-message-conventional-type` | 0.856 ± 0.013 | 0.600 ± 0.000 | -0.256 | 🔻 regression |
| `release-cut-version-tag-changelog` | 0.910 ± 0.017 | 0.888 ± 0.011 | -0.022 | within noise |
| `changelog-curated-by-impact` | 0.888 ± 0.029 | 0.876 ± 0.011 | -0.012 | within noise |
| `split-into-atomic-commits` | 0.868 ± 0.008 | 0.858 ± 0.011 | -0.010 | within noise |
| `semver-clean-bump` | 0.860 ± 0.012 | 0.856 ± 0.009 | -0.004 | within noise |
| `trunk-based-short-lived-branches` | 0.864 ± 0.023 | 0.868 ± 0.013 | +0.004 | within noise |
| `semver-hidden-breaking-change` | 0.832 ± 0.020 | 0.894 ± 0.022 | +0.062 | 🔼 improvement |

## Regressions (1) — bands do not overlap

- `commit-message-conventional-type`: 0.856 ± 0.013 → 0.600 ± 0.000 (-0.256)
