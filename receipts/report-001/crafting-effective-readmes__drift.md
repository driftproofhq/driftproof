# Drift report

**Skill:** crafting-effective-readmes `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T09:32:15.041Z | 2026-07-28T09:26:22.105Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `de1307bbac35` | `de1307bbac35` |
| suite_hash | `71c93b477513` | `71c93b477513` |
| with_skill (mean ± band) | 0.870 ± 0.015 | 0.804 ± 0.192 |
| baseline score | 0.849 | 0.811 |
| skill lift (Δ) | +0.021 | -0.007 |

## Headline

**DRIFT — 2 cases regressed (bands do not overlap); the skill is measurably weaker on 2 cases.**

with_skill mean moved -0.066 (0.870 ± 0.015 → 0.804 ± 0.192; band = suite dispersion). Per-case band-overlap verdicts: 2 regression(s), 0 improvement(s), 5 within noise.

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `lead-with-one-sentence-problem` | 0.874 ± 0.005 | 0.374 ± 0.136 | -0.500 | 🔻 regression |
| `categorize-task-before-writing` | 0.868 ± 0.008 | 0.818 ± 0.034 | -0.050 | 🔻 regression |
| `audience-config-folder-future-you` | 0.876 ± 0.015 | 0.870 ± 0.012 | -0.006 | within noise |
| `review-validate-against-project-files` | 0.888 ± 0.029 | 0.890 ± 0.024 | +0.002 | within noise |
| `three-mandatory-sections-cli-tool` | 0.872 ± 0.008 | 0.876 ± 0.013 | +0.004 | within noise |
| `audience-internal-service-runbook` | 0.872 ± 0.004 | 0.894 ± 0.028 | +0.022 | within noise |
| `oss-project-type-sections` | 0.840 ± 0.090 | 0.908 ± 0.041 | +0.068 | within noise |

## Regressions (2) — bands do not overlap

- `lead-with-one-sentence-problem`: 0.874 ± 0.005 → 0.374 ± 0.136 (-0.500)
- `categorize-task-before-writing`: 0.868 ± 0.008 → 0.818 ± 0.034 (-0.050)
