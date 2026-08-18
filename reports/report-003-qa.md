# Report #003 — QA (for maintainer review before publish)

**Type:** Release drift report (Report #001 family).
**Pair:** `claude-opus-4-8` (older, released 2026-05-28) → `claude-opus-5` (newer, released 2026-07-24).
**Surface:** `claude-cli` (`claude -p -m`), provider anthropic. **Judge:** `claude-haiku-4-5`, n=5, rubric v1.2 (Report #001 suites).
**Suites:** the same 10 public skills, 7 cases each. **Runner:** 0.3.0. **Effect floor:** 0.05.
**Run window:** 2026-08-11 17:55 UTC → 2026-08-12 04:28 UTC. **Metered-equiv:** ~$11.79 (guard $40).
**Receipts:** `receipts/report-003-draft/` (20 files, both versions × 10 skills — all present, all complete).

Every number below is re-derived from the receipts via the shipped `buildDriftReport`/`driftVerdict` code path (`scratchpad/qa-extract.js`), not hand-entered.

---

## Headline

**2 regressed · 4 improved · 0 mixed · 4 within noise** over 10 skills, **1 low-resolution flag.**

This is the *tally of per-case band-separated verdicts that clear the 0.05 floor* — not an aggregate-delta count. Read the fragility notes before quoting it: **one of the two regressions rests exactly on the floor**, and both regressions are single-case verdicts on skills whose aggregate `with_skill` band did not move beyond noise.

---

## Per-skill table

Bands are `with_skill` aggregate mean ± stddev (over 5 judge samples, averaged across the 7 cases). Lift = `with_skill − baseline` on that version. Verdict is the per-case drift tally.

| Skill | old `with` | new `with` | Δ (context) | base old→new | lift old→new | Verdict |
|---|---|---|---|---|---|---|
| code-review-and-quality | 0.887 ± 0.024 | 0.886 ± 0.016 | −0.000 | 0.819→0.833 | +0.068→+0.054 | WITHIN NOISE |
| commit-work | 0.882 ± 0.015 | 0.882 ± 0.014 | −0.000 | 0.847→0.886 | +0.035→−0.004 | WITHIN NOISE |
| crafting-effective-readmes | 0.760 ± 0.213 | 0.871 ± 0.032 | +0.111 | 0.870→0.795 | **−0.109→+0.076** | IMPROVED (2) |
| documentation-and-adrs | 0.769 ± 0.232 | 0.867 ± 0.032 | +0.098 | 0.795→0.839 | −0.026→+0.028 | IMPROVED (1) |
| git-workflow-and-versioning | 0.879 ± 0.009 | 0.877 ± 0.011 | −0.002 | 0.839→0.878 | +0.040→−0.001 | WITHIN NOISE |
| naming-analyzer | 0.874 ± 0.012 | 0.866 ± 0.054 | −0.008 | 0.797→0.798 | +0.077→+0.068 | **REGRESSED (1)** |
| requesting-code-review | 0.762 ± 0.214 | 0.871 ± 0.025 | +0.109 | 0.544→0.671 | +0.218→+0.200 | IMPROVED (1) |
| skill-creator | 0.887 ± 0.007 | 0.885 ± 0.008 | −0.001 | 0.849→0.889 | +0.038→−0.003 | WITHIN NOISE |
| writing-clearly-and-concisely | 0.876 ± 0.024 | 0.845 ± 0.033 | −0.030 | 0.874→0.861 | +0.001→−0.016 | **REGRESSED (1)** |
| writing-plans | 0.864 ± 0.033 | 0.883 ± 0.028 | +0.019 | 0.578→0.690 | +0.285→+0.193 | IMPROVED (1) † low-res |

---

## Verdict re-derivation — the two REGRESSED skills (scrutinize these)

The rule: a case is a regression only if the old and new `with_skill` bands (mean ± stddev, n=5) **do not overlap** AND `|Δmean| ≥ 0.05`.

### 1. writing-clearly-and-concisely → REGRESSED (1) — **FRAGILE, rests exactly on the floor**

- Driver case `positive-form-status-sentences`: **0.916 ± 0.032 → 0.866 ± 0.011**, Δmean = **−0.050**.
- Band separation: old low = 0.884, new high = 0.877 → separated by 0.007 (non-overlapping ✓).
- Floor: |−0.050| = 0.050 = the floor **exactly** (passes `≥`). A single hundredth less and this is WITHIN NOISE.
- Context: the aggregate `with_skill` band moved 0.876 → 0.845 (Δ−0.030 — *within noise*), and the skill's lift over baseline was ~0 on both versions (+0.001 → −0.016). So on this skill the SKILL barely did anything on either model; the regression verdict is one case sitting precisely on the threshold.
- **My read:** technically a valid REGRESSED(1) under the rule, but it is the single most fragile verdict in the report and should be described that way — not as a robust regression. Candidate for a per-row fragility note in the published table.

### 2. naming-analyzer → REGRESSED (1) — valid, but aggregate is within noise

- Driver case `abbreviations-wellknown-js`: **0.872 ± 0.013 → 0.744 ± 0.096**, Δmean = **−0.128**.
- Band separation: old low = 0.859, new high = 0.840 → separated by 0.019 (non-overlapping ✓).
- Floor: |−0.128| = 0.128 ≫ 0.05 ✓. Clears comfortably on magnitude.
- Caveat: the *new* band widened sharply (±0.013 → ±0.096) — the new model got **noisier** on this case, not merely lower. The regression is real but is as much a variance blow-up as a mean drop.
- Context: aggregate `with_skill` 0.874 → 0.866 (Δ−0.008, within noise); the skill still HELPS on opus-5 (lift +0.068 over baseline). So: overall the skill is fine on the new model; one case degraded and got noisy.
- **My read:** valid REGRESSED(1). Honest framing = "one case regressed + destabilised; the skill remains net-beneficial in aggregate."

**Neither regression is an aggregate regression.** Both skills' overall `with_skill` bands are within noise. This is the anti-cry-wolf discipline working as intended (per-case, floor-gated), but the headline "2 regressed" must not be read as "2 skills got worse overall."

---

## Low-resolution flag (1)

### writing-plans → IMPROVED (1), low-res

- Driver case `interfaces-exact-signatures`: **0.800 ± 0.000 → 0.886 ± 0.030**, Δmean = +0.086.
- The **old** band is zero-width — all 5 judge samples returned exactly 0.800 (a clean grid step). New band [0.856, 0.916] sits entirely above it; separation ✓, floor ✓.
- The verdict stands, but its confidence is grid-limited: the judge could not resolve any finer structure on the old side. Correctly flagged † low-res in the draft.

---

## Zero-variance / saturation / floor audit

- **Zero-variance cases (all 5 judge samples identical):** 7 total across the 20 receipts — documentation-and-adrs (3: base opus-4-8 @0.6, with/base opus-5 @0.8/@0.6), naming-analyzer (2: base @0.6 both versions), requesting-code-review (1: base opus-4-8 @0.3), writing-plans (1: `with_skill` opus-4-8 @0.8 — the low-res driver above). Only the writing-plans case *drives* a verdict (→ the low-res flag); the other 6 are baseline or non-driving `with_skill` cases and affect no label. All sit on clean grid steps (0.3/0.6/0.8), consistent with judge quantization rather than a scoring bug.
- **Saturation (mean ≥ 0.99):** 0 cases. No ceiling effects.
- **Floor (mean ≤ 0.05):** 0 cases. No basement effects.

## Judge-vs-postcheck disagreements

**N/A for this report.** These 10 suites are **judge-only** — there is no deterministic postcheck field in any case (`hasPostcheck: false` across all 20 receipts). Grading is the n=5 haiku judge against the v1.2 rubric, full stop. Nothing to cross-check against, so no disagreement rows. Stated here so the absence is explicit, not an omission.

## Completeness / failure audit

- **20/20 receipts present**, both versions × 10 skills, 7 cases × 2 modes each. No missing pairs.
- **0 `failed_timeout`, 0 incomplete cases, 0 `case_status` errors.** The 22 `fail` outcomes are all legitimate low-score cases (20 of them baseline/no-skill), which is expected — the skill's job is to lift baseline cases above the 0.7 threshold. The 20 `borderline` outcomes are likewise per-case pass/fail near threshold, not errors.
- This confirms the 900s timeout + concurrency-2 configuration fully resolved the run-1 timeout failures; every case completed on its merits.

---

## Notable findings (for the report narrative, not verdicts)

1. **crafting-effective-readmes — lift sign flip.** The skill was **net-negative on opus-4-8** (`with` 0.760 < baseline 0.870, lift −0.109) and **net-positive on opus-5** (`with` 0.871 > baseline 0.795, lift +0.076). The old `with` band was very noisy (±0.213), so the "hurt" was unstable — but the direction flipped cleanly. This is the strongest release-drift story in the set: a skill that was dead weight on the older model earns its keep on the newer one. (Verdict IMPROVED(2) is on the `with_skill` band basis; the lift-flip is context.)
2. **documentation-and-adrs — milder sign flip** (lift −0.026 → +0.028), old `with` band also very noisy (±0.232).
3. **"Model caught up" on 3 within-noise skills.** commit-work, git-workflow, skill-creator all show baseline JUMPING on opus-5 (e.g. skill-creator base 0.849 → 0.889) while `with_skill` stays flat and high → lift collapses to ~0/slightly negative. The skill isn't regressing; the newer model reaches nearly the same quality *without* it. Worth saying plainly: a shrinking lift can mean the model improved, not the skill decayed.
4. **The high-variance old bands** (crafting-readmes ±0.213, documentation ±0.232, requesting-code-review ±0.214) are all skills where opus-4-8 was erratic with the skill and opus-5 stabilised (±0.03 range). Stabilisation is itself a release effect.

---

## Proposed essay tally sentence (candidate — needs your approval)

The essay placeholder is: `Report #003 (opus-4-8 → opus-5): [TALLY SENTENCE AFTER QA].`

Candidate, honest to the fragility above:

> Report #003 (opus-4-8 → opus-5): 4 improved, 2 regressed, 4 within noise — but both regressions are single cases on skills that are otherwise fine (one sits exactly on the effect floor), and the sharpest signal is a skill that hurt on the old model and helped on the new one.

If you want a tighter one that still doesn't overclaim:

> Report #003 (opus-4-8 → opus-5): 4 improved, 2 regressed (both single-case, one exactly on the floor), 4 within noise — same files, same judge, only the model changed.

**Do not publish or fill the essay tally until you confirm which sentence (or your own edit).** Nothing has been published; the draft is noindex at `docs/reports/003-draft/index.html`.
