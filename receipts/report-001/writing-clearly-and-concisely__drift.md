# Drift report

**Skill:** writing-clearly-and-concisely `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T09:19:44.444Z | 2026-07-28T16:36:12.851Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `0c1678b0debc` | `0c1678b0debc` |
| suite_hash | `64c8f1554190` | `64c8f1554190` |
| with_skill (mean ± band) | 0.864 ± 0.016 | 0.841 ± 0.064 |
| baseline score | 0.839 | 0.813 |
| skill lift (Δ) | +0.024 | +0.028 |

## Headline

**DRIFT — 1 case regressed (bands do not overlap); the skill is measurably weaker on 1 case.**

with_skill mean moved -0.022 (0.864 ± 0.016 → 0.841 ± 0.064; band = suite dispersion). Per-case band-overlap verdicts: 1 regression(s), 0 improvement(s), 6 within noise (1 of them band-separated but below the 0.05 effect floor).

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `concrete-language-incident-summary` | 0.862 ± 0.022 | 0.710 ± 0.073 | -0.152 | 🔻 regression |
| `emphatic-word-at-end` | 0.848 ± 0.023 | 0.806 ± 0.013 | -0.042 | within noise (below floor) |
| `tighten-puffy-release-note` | 0.874 ± 0.032 | 0.862 ± 0.022 | -0.012 | within noise |
| `positive-form-status-sentences` | 0.886 ± 0.038 | 0.884 ± 0.015 | -0.002 | within noise |
| `active-voice-logging-passage` | 0.852 ± 0.004 | 0.862 ± 0.011 | +0.010 | within noise |
| `omit-needless-words-cache-note` | 0.878 ± 0.033 | 0.894 ± 0.039 | +0.016 | within noise |
| `keep-related-words-together-modifiers` | 0.846 ± 0.011 | 0.872 ± 0.023 | +0.026 | within noise |

## Regressions (1) — bands do not overlap

- `concrete-language-incident-summary`: 0.862 ± 0.022 → 0.710 ± 0.073 (-0.152)
