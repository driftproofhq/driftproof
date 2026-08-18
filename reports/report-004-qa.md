# Report #004 — QA (for maintainer review before publish)

**Type:** Capability-gap report (Report #002's verdict style, one provider, two tiers). **NOT release drift** — `claude-fable-5` has no family predecessor; this is a cross-family study.
**Pair:** `claude-opus-5` (flagship, released 2026-07-24) vs `claude-fable-5` (frontier, released 2026-06-09 — registry field updated null → 2026-06-09 for this report, verified from Anthropic's announcements; the export-control pause Jun 12–30 and Jul 1 redeployment are noted for the record).
**Surface:** `claude-cli` (`claude -p -m`), provider anthropic. **Judge:** `claude-haiku-4-5`, n=5, rubric v1.2 (Report #001 suites). **Suites:** the same 10 public skills, 7 cases each. **Runner:** 0.3.0. **Effect floor:** 0.05.
**Run window:** 2026-08-16 17:19 UTC → 2026-08-17 01:35 UTC (~8.3h). **Metered-equiv:** ~$16.08 (guard $40); $0 actual (subscription CLI, disclosed).
**Receipts:** `receipts/report-004-draft/` — **20/20 present, complete, schema-valid, self-hash verified. Zero `failed_timeout`.**

Every number below is re-derived from the receipts via the shipped `capabilityVerdict`/`tierDirection` code path (`scripts/prepare-report-004.js`), not hand-entered.

---

## Headline

**3 DURABLE · 5 TIER-DEPENDENT · 0 REGRESSES · 2 NO EFFECT** — over 10 skills, 2 low-res flags.

Read §3 before quoting "0 regresses": the claim is robust on the frontier side outright, but one TIER-DEPENDENT verdict (documentation-and-adrs) is kept out of REGRESSES-on-opus partly by a zero-width point-band driver.

---

## Per-skill table

Bands are `with_skill` aggregate mean ± stddev; lift = `with_skill − baseline` on that tier; **liftShift** = fable lift − opus lift; **baseShift** = fable baseline − opus baseline (the catch-up direction signal).

| Skill | opus-5 with | fable-5 with | base opus→fable | lift opus→fable | liftShift | Verdict |
|---|---|---|---|---|---|---|
| code-review-and-quality | 0.875 ± 0.022 | 0.880 ± 0.028 | 0.845→0.798 | +0.030→+0.082 | +0.051 | DURABLE |
| commit-work | 0.878 ± 0.019 | 0.877 ± 0.017 | 0.877→0.874 | +0.001→+0.003 | +0.002 | TIER-DEPENDENT |
| crafting-effective-readmes | 0.881 ± 0.011 | 0.886 ± 0.021 | 0.860→0.859 | +0.021→+0.027 | +0.006 | NO EFFECT |
| documentation-and-adrs | 0.843 ± 0.083 | 0.862 ± 0.036 | 0.839→0.798 | +0.004→+0.064 | +0.060 | TIER-DEPENDENT † low-res |
| git-workflow-and-versioning | 0.879 ± 0.011 | 0.875 ± 0.011 | 0.878→0.876 | +0.001→−0.001 | −0.002 | NO EFFECT |
| naming-analyzer | 0.851 ± 0.108 | 0.833 ± 0.069 | 0.820→0.757 | +0.030→+0.075 | +0.045 | TIER-DEPENDENT |
| requesting-code-review | 0.835 ± 0.124 | 0.855 ± 0.042 | 0.550→0.715 | +0.285→+0.140 | −0.146 | DURABLE † low-res |
| skill-creator | 0.893 ± 0.013 | 0.889 ± 0.009 | 0.864→0.872 | +0.029→+0.017 | −0.013 | TIER-DEPENDENT |
| writing-clearly-and-concisely | 0.856 ± 0.021 | 0.870 ± 0.024 | 0.853→0.858 | +0.003→+0.013 | +0.009 | TIER-DEPENDENT |
| writing-plans | 0.866 ± 0.028 | 0.827 ± 0.109 | 0.689→0.705 | +0.177→+0.122 | −0.055 | DURABLE |

---

## §1 Baseline-catch-up direction split (the 5 TIER-DEPENDENT skills)

The report's honest headline hangs on which way TIER-DEPENDENT leans: **"absorbed"** (fable's baseline rose toward the with_skill band — the skill going ceremonial at the frontier) vs **"amplified"** (fable's baseline came in lower — the skill earns *more* at the frontier).

| Skill | baseShift | lift opus→fable | Lean | Basis |
|---|---|---|---|---|
| documentation-and-adrs | **−0.041** | +0.004→+0.064 | **AMPLIFIED** | Fable baseline dropped (0.839→0.798) while with held (0.843→0.862); fable earns 2 lift drivers (+0.232 †pb, +0.202 †pb) where opus was mixed (one lift +0.200 †pb, one hurt −0.206). |
| naming-analyzer | **−0.063** | +0.030→+0.075 | **AMPLIFIED** | Largest baseline drop in the set (0.820→0.757); fable side is pure lifts (+0.160, +0.332) vs opus mixed (2 lifts, 1 hurt −0.140). |
| writing-clearly-and-concisely | +0.005 | +0.003→+0.013 | **AMPLIFIED (marginal)** | Baselines statistically identical; the only driver anywhere is a fable lift (+0.076, 0.026 above floor). Both aggregate lifts are within noise — the weakest lean in the table. |
| skill-creator | +0.009 | +0.029→+0.017 | **ABSORBED (marginal)** | Fable baseline nudged up (0.864→0.872) and the fable side has zero drivers (opus keeps one, +0.134). The skill's residual value shrinks at the frontier — but from an already-near-ceremonial base. |
| commit-work | −0.003 | +0.001→+0.003 | **ABSORBED (on both tiers)** | Baselines ~0.875 on BOTH tiers with lift ≈ 0 on both; the single opus driver (+0.062) is 0.012 above the floor. This skill went ceremonial on the flagship already (#003 showed its opus-5 lift collapsing to −0.004); fable simply continues the state. |

**Split: 3 amplified (1 marginal) / 2 absorbed (both marginal-to-inherited).** Adding the 3 DURABLE skills (all of which keep or grow real lift at the frontier — code-review even flips *anti*-catch-up with baseShift −0.047) and the 2 NO EFFECT skills (ceremonial on both tiers, not newly so on fable): **the run does NOT support "baselines catch up further on fable-5" as a general story.** The frontier tier's baselines were *lower* than the flagship's on 3 of 10 skills, roughly equal on 5, and meaningfully higher on only 1 (requesting-code-review, +0.165 — and even there the skill stays DURABLE with +0.140 residual lift). The ceremonial-skill thesis at the edge is, on this evidence, **rejected in its strong form**: where skills were ceremonial on fable, they were already ceremonial on opus.

Honest caveat: baseShift compares fresh generations run ~5 days apart from #003 and within one run across tiers; generation variance (spec open question #2) means single-skill baseShifts under ~0.05 should not be narrated as real movement. The 2 amplified leans that clear that bar (−0.041, −0.063) plus code-review's −0.047 are the only baseline moves worth a sentence.

## §2 Longitudinal consistency (#004's opus-5 column vs Report #003's opus-5 column)

The opus-5 column here is an independent re-run of #003's "new" column — same 10 suites, same judge, same surface, fresh generations 5 days later. This is the series' **first cross-report repeatability evidence**:

- **git-workflow-and-versioning — reproduced exactly.** #003 lift on opus-5: −0.001; #004: +0.001. The collapsed-lift finding ("model caught up") repeats, and #004 extends it: fable-5 is also −0.001 → NO EFFECT is now a *two-report, two-tier* verdict.
- **commit-work — reproduced.** #003: −0.004; #004: +0.001. Same collapsed state, now shown on both tiers (fable +0.003).
- **skill-creator — reproduced.** #003: −0.003; #004: +0.029 (both within noise of zero at aggregate).
- **naming-analyzer — case-level reproduction of #003's regression.** #003's REGRESSED(1) driver was `abbreviations-wellknown-js` (0.872→0.744, noisy). #004 independently finds the SAME case as opus-5's only hurt driver (−0.140 vs baseline) — while on fable-5 the same case LIFTS +0.332. The #003 finding was real, and it is opus-5-specific.
- **writing-plans / requesting-code-review — the two big-lift skills reproduce.** #003 opus-5 lifts +0.193 / +0.200; #004: +0.177 / +0.285. The skills that genuinely earn their keep keep earning it.
- **writing-clearly-and-concisely — reproduced ~0.** #003: −0.016; #004: +0.003. (#003's floor-exact REGRESSED(1) was already flagged fragile; #004's independent ~0 lift is consistent with that read.)
- **Magnitude wobble, direction stable:** crafting-readmes (+0.076 → +0.021) and documentation-and-adrs (+0.028 → +0.004) kept sign but shrank; their baselines also moved run-to-run (readmes 0.795→0.860) — generation variance, disclosed above, not drift.

Ten of ten skills keep their #003 sign-or-noise character. Worth a line in the published report: **the method's verdicts repeat across independent runs.**

## §3 Robustness of "0 REGRESSES"

A REGRESSES verdict requires one tier to be *purely* hurt (≥1 hurt driver, 0 lift drivers). Audit of every hurt driver in the run:

- **Fable-5 side: zero hurt drivers anywhere.** Every fable driver in all 10 skills is a lift. "Encoded expertise never measurably hurts on the frontier tier" is **robust outright** — no floor-edge, no point-band involvement.
- **Opus-5 side: 2 hurt drivers**, both inside mixed (TIER-DEPENDENT) skills:
  - `naming-analyzer` / `abbreviations-wellknown-js` −0.140: coexists with two lift drivers (+0.054, +0.276). Even discounting the floor-edge +0.054 (only 0.004 above the floor), the +0.276 lift stands on a real band → mixed holds; **cannot flip to REGRESSES**.
  - `documentation-and-adrs` / `match-existing-adr-convention` −0.206: coexists with ONE lift driver, `document-public-api-function` +0.200 — **which rests on a zero-width point band** (with_skill all-5-samples 0.8, baseline all-5 0.6). **This is the fragile spot:** if a reader discounts point-band drivers, the opus side becomes purely hurt and the skill's verdict flips TIER-DEPENDENT → REGRESSES on claude-opus-5. The † low-res flag covers exactly this; the published report should say it in words, not just the dagger. (Note the flip would indict the *flagship*, not the frontier — fable's side is two lifts.)
- **Floor-edge audit** (drivers within 0.01 of the 0.05 floor): `naming-analyzer/boolean-prefixes-js` +0.054 (no verdict depends on it, see above) and nothing else — `commit-work`'s single driver is +0.062 (0.012 clear); if it *had* fallen below floor the flip is benign (TIER-DEPENDENT → NO EFFECT).
- **The 2 low-res flags, explicitly:**
  1. `documentation-and-adrs` (TIER-DEPENDENT †): 3 of its 4 drivers are point-band (opus +0.200 †pb; fable +0.232 †pb, +0.202 †pb). The *direction* (amplified on fable) survives on the one clean driver plus the aggregate picture, but this is the least-resolved verdict in the report — grid-limited on both tiers.
  2. `requesting-code-review` (DURABLE †): 1 of 7 drivers point-band (opus `full-handoff-before-merge` +0.410 †pb). Discounting it leaves 3 non-point-band opus drivers (+0.606, +0.576, +0.234) and 3 fable drivers — **DURABLE cannot flip**; the flag is honest bookkeeping, not fragility.

**Bottom line:** "0 REGRESSES" holds under every discount except one — treat point-band drivers as void and documentation-and-adrs becomes REGRESSES *on the flagship*. State that in the published report.

## Zero-variance / saturation / floor audit

- **Zero-variance cases (all 5 judge samples identical): 8** across 20 receipts — commit-work/fable `conventional-commit-single-change` with@0.85; documentation-and-adrs opus `document-public-api-function` with@0.8 + base@0.6, fable `comment-intent-not-implementation` base@0.6 + `document-public-api-function` base@0.6; naming-analyzer/fable `language-casing-python` base@0.6; requesting-code-review/opus `full-handoff-before-merge` with@0.8; writing-plans/fable `interfaces-exact-signatures` base@0.8. All on clean grid steps (0.6/0.8/0.85) — judge quantization, consistent with #003's pattern (7 such cases) and not a scoring bug. Five of the eight touch verdict drivers → the two † flags above.
- **Saturation (mean ≥ 0.99): 0. Floor (mean ≤ 0.05): 0.** No ceiling or basement effects.

## Judge-vs-postcheck disagreements

Unlike #003 (which pre-dated check-annotated suites in its pinned rubrics), this run's `commit-work` suite carries deterministic post-checks on 3 cases (12 check-bearing case rows across the two tiers, 20 individual checks). **Result: 20/20 checks PASS, and every check-bearing case also passes the judge — zero disagreements.** The structural assertions (conventional-commit shape, rate-limit mention, lockfile-with-manifest staging, patch staging) corroborate the judge on both tiers. The other 9 suites are judge-only (no `checks` fields) — stated so the absence is explicit.

## Completeness / failure audit

- 20/20 receipts, both tiers × 10 skills, 14 case-rows each (7 cases × 2 modes). No missing pairs, no `failed_timeout`, no incomplete receipts, no invalid hashes. The 900s/concurrency-2 config again produced a zero-timeout run.
- Run was resume-clean: 0 restored, 0 skipped (single uninterrupted pass).

---

## Honest headline sentence candidates (pick or edit — publish gates on you)

Faithful to the direction split (§1) and the robustness caveat (§3):

> **Report #004 (opus-5 vs fable-5, capability gap): 3 durable, 5 tier-dependent, 2 no effect, 0 regressions — and the frontier tier does not eat the skills: baselines came in *lower* on fable-5 as often as higher, and every skill that was ceremonial at the edge was already ceremonial on the flagship.**

Tighter:

> **Report #004 (opus-5 vs fable-5): encoded expertise survives the frontier tier — 3 durable, 5 tier-dependent, 0 regressions; where lift had collapsed, it had collapsed on the flagship first.**

With the repeatability angle (§2), if you'd rather lead with method:

> **Report #004 (opus-5 vs fable-5, capability gap): 0 regressions at the frontier, and the first cross-report repeatability check — all 10 opus-5 verdicts reproduce Report #003's, including the same single regressing case on naming-analyzer.**

**Do not publish until you confirm a sentence (or your own edit).** Nothing is published; the draft is noindex at `docs/reports/004-draft/index.html`, receipts in `receipts/report-004-draft/`, entry queued in `reports/pending-publish.md`.
