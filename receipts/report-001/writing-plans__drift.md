# Drift report

**Skill:** writing-plans `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T10:24:30.802Z | 2026-07-28T10:14:16.389Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `5ac443162b52` | `5ac443162b52` |
| suite_hash | `37cb3c341572` | `37cb3c341572` |
| with_skill (mean ± band) | 0.811 ± 0.089 | 0.785 ± 0.145 |
| baseline score | 0.576 | 0.675 |
| skill lift (Δ) | +0.235 | +0.110 |

## Headline

**MIXED — 1 case regression and 1 improvement on non-overlapping bands.**

with_skill mean moved -0.025 (0.811 ± 0.089 → 0.785 ± 0.145; band = suite dispersion). Per-case band-overlap verdicts: 1 regression(s), 1 improvement(s), 5 within noise.

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `task-right-sizing-testable-deliverable` | 0.816 ± 0.094 | 0.460 ± 0.150 | -0.356 | 🔻 regression |
| `self-review-spec-coverage` | 0.882 ± 0.011 | 0.844 ± 0.029 | -0.038 | within noise |
| `full-small-plan-header-and-tasks` | 0.882 ± 0.030 | 0.850 ± 0.041 | -0.032 | within noise |
| `bite-sized-tdd-steps` | 0.864 ± 0.013 | 0.876 ± 0.005 | +0.012 | within noise |
| `file-structure-by-responsibility` | 0.802 ± 0.004 | 0.826 ± 0.037 | +0.024 | within noise |
| `repair-placeholder-steps` | 0.802 ± 0.004 | 0.836 ± 0.035 | +0.034 | within noise |
| `interfaces-exact-signatures` | 0.626 ± 0.150 | 0.804 ± 0.009 | +0.178 | 🔼 improvement |

## Regressions (1) — bands do not overlap

- `task-right-sizing-testable-deliverable`: 0.816 ± 0.094 → 0.460 ± 0.150 (-0.356)
