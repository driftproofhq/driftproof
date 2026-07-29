# Drift report

**Skill:** commit-work `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T09:07:05.622Z | 2026-07-28T08:59:54.620Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `8f1f71640ab3` | `8f1f71640ab3` |
| suite_hash | `91ee92d7fc68` | `91ee92d7fc68` |
| with_skill (mean ± band) | 0.843 ± 0.054 | 0.853 ± 0.019 |
| baseline score | 0.697 | 0.643 |
| skill lift (Δ) | +0.146 | +0.210 |

## Headline

**IMPROVED — 1 case improved (bands do not overlap); none regressed.**

with_skill mean moved +0.010 (0.843 ± 0.054 → 0.853 ± 0.019; band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 1 improvement(s), 6 within noise.

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `conventional-commit-single-change` | 0.846 ± 0.009 | 0.814 ± 0.030 | -0.032 | within noise |
| `patch-stage-mixed-single-file` | 0.880 ± 0.016 | 0.860 ± 0.014 | -0.020 | within noise |
| `full-workflow-multi-concern-diff` | 0.884 ± 0.021 | 0.868 ± 0.011 | -0.016 | within noise |
| `split-feature-vs-refactor` | 0.860 ± 0.016 | 0.858 ± 0.011 | -0.002 | within noise |
| `split-dependency-bump-vs-behavior` | 0.870 ± 0.012 | 0.870 ± 0.007 | +0.000 | within noise |
| `review-cached-catch-secret-and-debug` | 0.834 ± 0.050 | 0.852 ± 0.058 | +0.018 | within noise |
| `two-sentence-describability-test` | 0.728 ± 0.029 | 0.850 ± 0.031 | +0.122 | 🔼 improvement |
