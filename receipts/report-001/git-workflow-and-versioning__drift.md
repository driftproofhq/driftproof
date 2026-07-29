# Drift report

**Skill:** git-workflow-and-versioning `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T08:38:43.448Z | 2026-07-28T08:33:17.013Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `c0e9cf58fddf` | `c0e9cf58fddf` |
| suite_hash | `3c691f114db4` | `3c691f114db4` |
| with_skill (mean ± band) | 0.864 ± 0.015 | 0.860 ± 0.028 |
| baseline score | 0.794 | 0.703 |
| skill lift (Δ) | +0.069 | +0.157 |

## Headline

**DRIFT — 1 case regressed (bands do not overlap); the skill is measurably weaker on 1 case.**

with_skill mean moved -0.003 (0.864 ± 0.015 → 0.860 ± 0.028; band = suite dispersion). Per-case band-overlap verdicts: 1 regression(s), 0 improvement(s), 6 within noise.

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `semver-clean-bump` | 0.866 ± 0.009 | 0.812 ± 0.018 | -0.054 | 🔻 regression |
| `commit-message-conventional-type` | 0.862 ± 0.011 | 0.828 ± 0.029 | -0.034 | within noise |
| `changelog-curated-by-impact` | 0.880 ± 0.030 | 0.872 ± 0.039 | -0.008 | within noise |
| `release-cut-version-tag-changelog` | 0.880 ± 0.012 | 0.882 ± 0.019 | +0.002 | within noise |
| `split-into-atomic-commits` | 0.864 ± 0.022 | 0.876 ± 0.015 | +0.012 | within noise |
| `trunk-based-short-lived-branches` | 0.858 ± 0.008 | 0.870 ± 0.014 | +0.012 | within noise |
| `semver-hidden-breaking-change` | 0.836 ± 0.035 | 0.882 ± 0.018 | +0.046 | within noise |

## Regressions (1) — bands do not overlap

- `semver-clean-bump`: 0.866 ± 0.009 → 0.812 ± 0.018 (-0.054)
