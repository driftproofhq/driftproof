# Drift report

**Skill:** code-review-and-quality `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T15:44:13.435Z | 2026-07-28T15:34:56.552Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `534b6663e6ff` | `534b6663e6ff` |
| suite_hash | `4729eb8fc298` | `4729eb8fc298` |
| with_skill (mean ± band) | 0.869 ± 0.025 | 0.854 ± 0.031 |
| baseline score | 0.824 | 0.836 |
| skill lift (Δ) | +0.045 | +0.018 |

## Headline

**WITHIN NOISE — no case moved beyond its confidence band; the skill holds up.**

with_skill mean moved -0.014 (0.869 ± 0.025 → 0.854 ± 0.031; band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 7 within noise (1 of them band-separated but below the 0.05 effect floor).

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `severity-labeled-findings` | 0.908 ± 0.042 | 0.794 ± 0.091 | -0.114 | within noise |
| `security-axis-sql-injection` | 0.882 ± 0.008 | 0.858 ± 0.008 | -0.024 | within noise (below floor) |
| `commit-message-imperative-body` | 0.862 ± 0.013 | 0.856 ± 0.009 | -0.006 | within noise |
| `reject-clean-it-up-later` | 0.866 ± 0.015 | 0.868 ± 0.008 | +0.002 | within noise |
| `oversized-change-split` | 0.856 ± 0.015 | 0.860 ± 0.010 | +0.004 | within noise |
| `propose-structural-remedy` | 0.878 ± 0.019 | 0.896 ± 0.022 | +0.018 | within noise |
| `approve-when-improves-health` | 0.828 ± 0.028 | 0.848 ± 0.026 | +0.020 | within noise |
