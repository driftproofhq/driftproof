# Drift report

**Skill:** skill-creator `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T10:39:56.009Z | 2026-07-28T10:32:05.487Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `97b28eb90f76` | `97b28eb90f76` |
| suite_hash | `39c3dd5b52de` | `39c3dd5b52de` |
| with_skill (mean ± band) | 0.842 ± 0.095 | 0.875 ± 0.012 |
| baseline score | 0.828 | 0.774 |
| skill lift (Δ) | +0.014 | +0.101 |

## Headline

**IMPROVED — 1 case improved (bands do not overlap); none regressed.**

with_skill mean moved +0.033 (0.842 ± 0.095 → 0.875 ± 0.012; band = suite dispersion). Per-case band-overlap verdicts: 0 regression(s), 1 improvement(s), 6 within noise.

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `restructure-oversized-skill` | 0.882 ± 0.018 | 0.854 ± 0.032 | -0.028 | within noise |
| `reframe-rigid-musts` | 0.876 ± 0.005 | 0.872 ± 0.004 | -0.004 | within noise |
| `domain-variant-organization` | 0.876 ± 0.015 | 0.872 ± 0.008 | -0.004 | within noise |
| `write-triggering-description` | 0.874 ± 0.013 | 0.874 ± 0.011 | +0.000 | within noise |
| `critique-and-fix-skillmd` | 0.890 ± 0.035 | 0.894 ± 0.025 | +0.004 | within noise |
| `output-format-template` | 0.868 ± 0.011 | 0.880 ± 0.012 | +0.012 | within noise |
| `draft-full-skillmd` | 0.628 ± 0.074 | 0.882 ± 0.022 | +0.254 | 🔼 improvement |
