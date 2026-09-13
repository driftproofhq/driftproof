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

## Headline

**WITHIN NOISE — no case moved beyond its confidence band; the skill holds up.**

with_skill mean moved +0.008 (0.833 ± 0.074 → 0.840 ± 0.078; band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 0 improvement(s), 10 within noise.

## Per-case with_skill (band overlap → verdict)

| case | 2026-07-28 (mean ± sd) | 2026-07-28 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `long-body-wrap-72` | 0.838 ± 0.047 | 0.828 ± 0.031 | -0.010 | within noise |
| `breaking-change` | 0.892 ± 0.008 | 0.884 ± 0.025 | -0.008 | within noise |
| `chore-vs-feat` | 0.650 ± 0.000 | 0.650 ± 0.000 | +0.000 | within noise |
| `footer-issue-ref` | 0.800 ± 0.000 | 0.800 ± 0.000 | +0.000 | within noise |
| `fix-with-body` | 0.866 ± 0.011 | 0.868 ± 0.015 | +0.002 | within noise |
| `feat-basic` | 0.850 ± 0.000 | 0.856 ± 0.013 | +0.006 | within noise |
| `build-type-selection` | 0.810 ± 0.022 | 0.820 ± 0.027 | +0.010 | within noise |
| `perf-not-refactor` | 0.916 ± 0.009 | 0.938 ± 0.016 | +0.022 | within noise |
| `revert-format` | 0.828 ± 0.052 | 0.856 ± 0.063 | +0.028 | within noise |
| `split-unrelated` | 0.876 ± 0.013 | 0.904 ± 0.017 | +0.028 | within noise |
