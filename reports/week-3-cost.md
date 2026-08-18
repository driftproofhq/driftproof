<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driftproof Week 3 — cost log

Report #001 was produced on the **`claude-cli`** surface (subscription session,
`ANTHROPIC_API_KEY` stripped from the child env), so **metered API spend for the
week was $0.00.** The dollar figures below are the *hypothetical* metered cost —
what the same calls would have cost on the metered Messages API at standard
first-party per-MTok rates — computed by the Week-3 dollar cost guard
(`lib/cost.js`) as a rough upper bound. They exist to prove the run sits far
under the USD 40 hard budget, and to exercise the guard the mission asked for.

## Budget guard

The runner projects the metered dollar cost up front (`lib/cost.js`,
`estimateRunCostUSD`) and, on the `api` surface, refuses to spend if the
projection exceeds `--max-usd` (default 40). On `claude-cli` the figure is
printed but never blocks, because actual metered spend is $0.

Per-skill projection (7 cases, n=5, both models, judge = haiku): **~$0.84**.
Full report (10 skills): **~$8.37** — comfortably inside the $40 budget.

## Spend by phase

All calls via `claude-cli` (subscription) → **$0.00 metered.**

| phase | calls | models | metered est (api-equivalent) |
|---|---|---|---|
| model servability smoke test | 3 | sonnet-5, sonnet-4-6, haiku-4-5 | ~$0.00 |
| pipeline probes (partial, n=2) | ~30 | pair + judge | ~$0.10 |
| **Report #001 full run** (10 skills × 2 models × 7 cases × (2 gen + 2×5 judge)) | **1,680** | sonnet-5, sonnet-4-6, judge haiku-4-5 | **~$8.37** |
| **total** | **~1,713** | — | **~$8.5** |

Wall-clock is dominated by `claude -p` cold-start; the run used `--concurrency 8`
to keep the grind tractable. Sampling stayed at the mandated **n=5** for the
published run (the guard trims skills, never samples, if a budget is tight).

<!-- machine-readable (parsed by tests/gate.js) -->
```
TOTAL_METERED_USD_ESTIMATE: 8.37
BUDGET_USD: 40
ACTUAL_METERED_USD: 0.00
SURFACE: claude-cli
```
