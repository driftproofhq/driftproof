# Report #002 — QA dump (findings only, no publishing)

Generated from live real-run receipts in `receipts/report-002`. Substrates: **claude-sonnet-5** (claude-cli, anthropic) vs **gpt-5.6-sol** (openai-cli, codex). Judge: claude-haiku-4-5. Effect floor: **0.05**.

## (a) Durability verdict rule — as implemented (Report #001-aligned)

Source: `scripts/prepare-report-002.js` `durabilityVerdict()` + `substrateDirection()`; floor `config.EFFECT_FLOOR = 0.05`.

Per substrate, the direction is the **tally of per-case verdicts** (NOT the aggregate mean delta). A case counts as improved/regressed only when BOTH:
- its `with_skill` and `baseline` bands (mean ± stddev over the 5 judge samples) do **not** overlap, AND
- `|with.mean − baseline.mean| ≥ 0.05` (the effect floor).

This is the same anti-cry-wolf discipline as Report #001 (there the two bands are old-model vs new-model with_skill; here with_skill vs baseline within one substrate). The aggregate Δ is reported only as context. Per-substrate direction:
- ≥1 regressed case, 0 improved → **hurt**; ≥1 improved, 0 regressed → **help**; both → **mixed**; neither → **flat**.

A driving case (one that separates + clears the floor) whose with_skill or baseline band is **zero-width** (all 5 samples identical) marks the verdict **low-resolution: judge quantization** — the effect is a clean grid-step the floor still gates, but grid-limited. The verdict stands; it is flagged, not suppressed.

Cross-substrate label from the (Claude, GPT) pair of directions:
- either substrate purely **hurt** → `REGRESSES on <who>` (names Claude &/or GPT)
- both **help** → `DURABLE`
- both **flat** → `NO EFFECT`
- otherwise (help/flat, or any `mixed` without a pure-hurt side) → `SUBSTRATE-DEPENDENT`
- either receipt `run.status === "incomplete"` → **NOT MEASURED** (no band fabricated from a partial sample set; excluded from all four verdicts).

## (b) Per-skill table — both substrates

| Skill | tokens | Claude with ±sd | Claude base ±sd | Δ Claude | GPT with ±sd | GPT base ±sd | Δ GPT | Verdict |
|---|--:|---|---|--:|---|---|--:|---|
| `code-review-and-quality` | 5117 | 0.825 ± 0.083 | 0.827 ± 0.058 | -0.002 | 0.867 ± 0.029 | 0.794 ± 0.126 | +0.073 | SUBSTRATE-DEPENDENT |
| `commit-work` | 621 | 0.867 ± 0.012 | 0.863 ± 0.007 | +0.004 | 0.831 ± 0.061 | 0.775 ± 0.145 | +0.057 | SUBSTRATE-DEPENDENT |
| `crafting-effective-readmes` | 669 | 0.789 ± 0.235 | 0.874 ± 0.018 | -0.085 | 0.849 ± 0.028 | 0.863 ± 0.035 | -0.014 | REGRESSES on Claude & GPT † low-res |
| `documentation-and-adrs` | 2437 | 0.739 ± 0.301 | 0.713 ± 0.314 | +0.027 | 0.817 ± 0.100 | 0.796 ± 0.097 | +0.021 | SUBSTRATE-DEPENDENT † low-res |
| `git-workflow-and-versioning` | 3431 | 0.839 ± 0.085 | 0.871 ± 0.008 | -0.031 | 0.809 ± 0.128 | 0.808 ± 0.092 | +0.001 | REGRESSES on Claude |
| `naming-analyzer` | 2291 | 0.833 ± 0.084 | 0.715 ± 0.191 | +0.119 | 0.845 ± 0.034 | 0.757 ± 0.113 | +0.088 | DURABLE † low-res |
| `requesting-code-review` | 738 | 0.736 ± 0.202 | 0.617 ± 0.215 | +0.119 | 0.801 ± 0.059 | 0.765 ± 0.125 | +0.037 | DURABLE † low-res |
| `skill-creator` | 8247 | 0.876 ± 0.014 | 0.817 ± 0.098 | +0.059 | 0.815 ± 0.113 | 0.845 ± 0.048 | -0.030 | SUBSTRATE-DEPENDENT |
| `writing-clearly-and-concisely` | 941 | 0.850 ± 0.056 | 0.852 ± 0.024 | -0.003 | 0.853 ± 0.060 | 0.829 ± 0.068 | +0.025 | NO EFFECT |
| `writing-plans` | 1722 | 0.759 ± 0.186 | 0.655 ± 0.192 | +0.104 | 0.805 ± 0.084 | 0.644 ± 0.223 | +0.161 | DURABLE † low-res |

## (c) Harness-suppression check (GPT / codex preamble)

Hypothesis: the codex CLI's ~12–15k-token preamble could swamp the SKILL.md signal, making every GPT delta collapse to ~0 (a harness artifact), rather than reflecting real per-skill substrate behavior. Uniform near-zero GPT deltas = suspicious; a mix of real +/−/0 = substrate-real.

| Skill | Δ GPT | |Δ|<floor? | Δ Claude (compare) | GPT base mean | Claude base mean |
|---|--:|:--:|--:|--:|--:|
| `code-review-and-quality` | +0.073 | no | -0.002 | 0.794 | 0.827 |
| `commit-work` | +0.057 | no | +0.004 | 0.775 | 0.863 |
| `crafting-effective-readmes` | -0.014 | YES | -0.085 | 0.863 | 0.874 |
| `documentation-and-adrs` | +0.021 | YES | +0.027 | 0.796 | 0.713 |
| `git-workflow-and-versioning` | +0.001 | YES | -0.031 | 0.808 | 0.871 |
| `naming-analyzer` | +0.088 | no | +0.119 | 0.757 | 0.715 |
| `requesting-code-review` | +0.037 | YES | +0.119 | 0.765 | 0.617 |
| `skill-creator` | -0.030 | YES | +0.059 | 0.845 | 0.817 |
| `writing-clearly-and-concisely` | +0.025 | YES | -0.003 | 0.829 | 0.852 |
| `writing-plans` | +0.161 | no | +0.104 | 0.644 | 0.655 |

GPT deltas: **6 flat (|Δ|<0.05) / 4 moved** (of 10 measured pairs).
Verdict on the pattern: **MIXED — substrate-real signal present** (4 skills clear the floor on GPT; suppression would force all to ~0).
Baseline levels: GPT mean baseline **0.788** vs Claude mean baseline **0.780** across 10 skills. GPT and Claude baselines are comparable.

## (d) Judge vs deterministic post-checks — disagreements (verbatim)

A disagreement = a case that carries deterministic `checks[]` where the checks verdict (all-pass) diverges from the judge outcome (pass/borderline/fail). Judge outcome derives from mean score vs threshold.

Cases carrying deterministic checks: **12**. Disagreements: **0**.

_None — every checked case's judge outcome agrees with its deterministic checks._

## (e) Zero-variance and saturation rows (Report #001 QA criteria)

Report #001 QA criteria applied here:
- **Effect floor 0.05** — a lift below one judge-quantization step is "no effect", never a pass (already gates every verdict above).
- **Zero-width / point band** — all 5 judge samples identical (stddev 0): a confident grade collapsed to a zero-width band; band-separation alone would be misleading, floor still governs.
- **Saturation / ceiling** — mean at/near 1.0 (≥0.95) or floor (≤0.05): little headroom, so a small delta is expected and not evidence of no skill value.

**Zero-variance case-bands (stddev = 0 over 5 samples):**
- `crafting-effective-readmes` / gpt-5.6-sol / `categorize-task-before-writing` (with_skill): all samples = 0.8 → point band at 0.800
- `documentation-and-adrs` / claude-sonnet-5 / `document-public-api-function` (with_skill): all samples = 0.8 → point band at 0.800
- `documentation-and-adrs` / claude-sonnet-5 / `document-public-api-function` (baseline): all samples = 0.6 → point band at 0.600
- `documentation-and-adrs` / gpt-5.6-sol / `document-public-api-function` (with_skill): all samples = 0.6 → point band at 0.600
- `documentation-and-adrs` / gpt-5.6-sol / `document-public-api-function` (baseline): all samples = 0.6 → point band at 0.600
- `documentation-and-adrs` / gpt-5.6-sol / `match-existing-adr-convention` (with_skill): all samples = 0.8 → point band at 0.800
- `documentation-and-adrs` / gpt-5.6-sol / `match-existing-adr-convention` (baseline): all samples = 0.8 → point band at 0.800
- `documentation-and-adrs` / gpt-5.6-sol / `surface-conflicting-adr-conventions` (with_skill): all samples = 0.87 → point band at 0.870
- `naming-analyzer` / claude-sonnet-5 / `language-casing-python` (baseline): all samples = 0.6 → point band at 0.600
- `naming-analyzer` / gpt-5.6-sol / `misleading-name-mutation-js` (with_skill): all samples = 0.8 → point band at 0.800
- `naming-analyzer` / gpt-5.6-sol / `language-casing-python` (baseline): all samples = 0.6 → point band at 0.600
- `requesting-code-review` / claude-sonnet-5 / `crafted-context-not-session-history` (with_skill): all samples = 0.3 → point band at 0.300
- `requesting-code-review` / claude-sonnet-5 / `identify-base-head-shas` (with_skill): all samples = 0.8 → point band at 0.800
- `requesting-code-review` / claude-sonnet-5 / `full-handoff-before-merge` (with_skill): all samples = 0.8 → point band at 0.800
- `requesting-code-review` / gpt-5.6-sol / `identify-base-head-shas` (with_skill): all samples = 0.8 → point band at 0.800
- `requesting-code-review` / gpt-5.6-sol / `mandatory-vs-optional-triggers` (with_skill): all samples = 0.8 → point band at 0.800
- `writing-plans` / claude-sonnet-5 / `repair-placeholder-steps` (baseline): all samples = 0.8 → point band at 0.800
- `writing-plans` / gpt-5.6-sol / `bite-sized-tdd-steps` (baseline): all samples = 0.6 → point band at 0.600
- `writing-plans` / gpt-5.6-sol / `interfaces-exact-signatures` (baseline): all samples = 0.8 → point band at 0.800

**Saturation rows (aggregate mean ≥ 0.95 or ≤ 0.05):**
- _none at the 0.95/0.05 thresholds_

## (f) Value-per-token extremes

VPT = delta per 1,000 skill tokens = `delta / (tokens/1000)` (lib/skillCost.js). Measured (skill × substrate) pairs only.

**Top 2 (best lift per token):**
- `requesting-code-review` / claude-sonnet-5: VPT +0.162 (Δ +0.119 over 738 tok)
- `writing-plans` / gpt-5.6-sol: VPT +0.093 (Δ +0.161 over 1722 tok)

**Bottom 2 (worst lift per token):**
- `crafting-effective-readmes` / claude-sonnet-5: VPT -0.127 (Δ -0.085 over 669 tok)
- `crafting-effective-readmes` / gpt-5.6-sol: VPT -0.021 (Δ -0.014 over 669 tok)
