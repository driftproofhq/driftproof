# Drift report

**Skill:** commit-work `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-30T04:49:01.938Z | 2026-07-30T04:38:17.763Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `8f1f71640ab3` | `8f1f71640ab3` |
| suite_hash | `93e7d1363b3c` | `93e7d1363b3c` |
| with_skill (mean ± band) | 0.825 ± 0.082 | 0.849 ± 0.028 |
| baseline score | 0.818 | 0.766 |
| skill lift (Δ) | +0.007 | +0.083 |

## Headline

**IMPROVED — 1 case improved (bands do not overlap); none regressed.**

with_skill mean moved +0.024 (0.825 ± 0.082 → 0.849 ± 0.028; band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 1 improvement(s), 6 within noise.

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `full-workflow-multi-concern-diff` | 0.906 ± 0.034 | 0.876 ± 0.011 | -0.030 | within noise |
| `patch-stage-mixed-single-file` | 0.872 ± 0.008 | 0.860 ± 0.010 | -0.012 | within noise |
| `review-cached-catch-secret-and-debug` | 0.852 ± 0.054 | 0.844 ± 0.092 | -0.008 | within noise |
| `split-dependency-bump-vs-behavior` | 0.872 ± 0.004 | 0.866 ± 0.015 | -0.006 | within noise |
| `split-feature-vs-refactor` | 0.852 ± 0.011 | 0.854 ± 0.011 | +0.002 | within noise |
| `conventional-commit-single-change` | 0.738 ± 0.069 | 0.790 ± 0.041 | +0.052 | within noise |
| `two-sentence-describability-test` | 0.682 ± 0.054 | 0.850 ± 0.023 | +0.168 | 🔼 improvement |
