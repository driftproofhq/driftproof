# Drift report

**Skill:** requesting-code-review `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T10:04:38.061Z | 2026-07-28T09:57:41.597Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `91e606681d87` | `91e606681d87` |
| suite_hash | `07e786694312` | `07e786694312` |
| with_skill (mean ± band) | 0.668 ± 0.249 | 0.719 ± 0.226 |
| baseline score | 0.540 | 0.617 |
| skill lift (Δ) | +0.128 | +0.103 |

## Headline

**IMPROVED — 1 case improved (bands do not overlap); none regressed.**

with_skill mean moved +0.052 (0.668 ± 0.249 → 0.719 ± 0.226; band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 1 improvement(s), 6 within noise (1 of them band-separated but below the 0.05 effect floor).

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `request-package-basic` | 0.898 ± 0.030 | 0.866 ± 0.021 | -0.032 | within noise |
| `full-handoff-before-merge` | 0.400 ± 0.000 | 0.396 ± 0.009 | -0.004 | within noise |
| `mandatory-vs-optional-triggers` | 0.862 ± 0.013 | 0.864 ± 0.013 | +0.002 | within noise |
| `resist-simple-self-review` | 0.864 ± 0.009 | 0.882 ± 0.022 | +0.018 | within noise |
| `identify-base-head-shas` | 0.800 ± 0.000 | 0.824 ± 0.018 | +0.024 | within noise (below floor) |
| `crafted-context-not-session-history` | 0.290 ± 0.022 | 0.384 ± 0.188 | +0.094 | within noise |
| `triage-review-findings` | 0.560 ± 0.029 | 0.820 ± 0.109 | +0.260 | 🔼 improvement |
