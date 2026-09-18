# Drift report

**Skill:** naming-analyzer `0.0.0`

| | old claude-sonnet-4-6 | new claude-sonnet-5 |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-5` |
| run date (UTC) | 2026-07-28T09:50:21.633Z | 2026-07-28T09:42:52.947Z |
| surface | claude-cli | claude-cli |
| judge samples/case | 5 | 5 |
| skill content_hash | `6091f9796552` | `6091f9796552` |
| suite_hash | `0d046f22ca97` | `0d046f22ca97` |
| with_skill (mean ± band) | 0.817 ± 0.077 | 0.839 ± 0.026 |
| baseline score | 0.703 | 0.757 |
| skill lift (Δ) | +0.113 | +0.082 |

## Headline

**MIXED — 2 case regressions and 2 improvements on non-overlapping bands.**

with_skill mean moved +0.022 (0.817 ± 0.077 → 0.839 ± 0.026; band = suite dispersion). Per-case band-overlap verdicts: 2 regression(s), 2 improvement(s), 3 within noise (1 of them band-separated but below the 0.05 effect floor).

## Per-case with_skill (band overlap → verdict)

| case | old claude-sonnet-4-6 (mean ± sd) | new claude-sonnet-5 (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `go-acronym-casing` | 0.868 ± 0.016 | 0.814 ± 0.022 | -0.054 | 🔻 regression |
| `constants-include-units-js` | 0.866 ± 0.011 | 0.814 ± 0.022 | -0.052 | 🔻 regression |
| `vague-names-js` | 0.854 ± 0.045 | 0.816 ± 0.042 | -0.038 | within noise |
| `language-casing-python` | 0.886 ± 0.024 | 0.882 ± 0.013 | -0.004 | within noise |
| `misleading-name-mutation-js` | 0.828 ± 0.008 | 0.842 ± 0.004 | +0.014 | within noise (below floor) |
| `boolean-prefixes-js` | 0.720 ± 0.115 | 0.860 ± 0.010 | +0.140 | 🔼 improvement |
| `abbreviations-wellknown-js` | 0.696 ± 0.099 | 0.846 ± 0.027 | +0.150 | 🔼 improvement |

## Regressions (2) — bands do not overlap

- `go-acronym-casing`: 0.868 ± 0.016 → 0.814 ± 0.022 (-0.054)
- `constants-include-units-js`: 0.866 ± 0.011 → 0.814 ± 0.022 (-0.052)
