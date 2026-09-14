<!-- SPDX-License-Identifier: Apache-2.0 -->
# Report #005 — fresh-context QA re-derivation

**Draft under review:** `docs/reports/005-draft/index.html` at commit `ba6eff4`
**Receipts:** `receipts/report-005-draft/` (30 receipts, all `TESTED`)
**Performed:** 2026-08-19T06:56:44Z
**Basis:** CONSTITUTION invariant 3. Worked only from the draft page, the 30
receipts, `spec/receipt.schema.json`, `REPORT-STYLE.md`, `CONSTITUTION.md`,
`DECISIONS.md` (1–8) and `specs/001-ratio-framing/`. Every figure below was
recomputed from the receipt JSON in a standalone script that imports **no repo
code** — in particular not `lib/value.js`, whose output is the thing under test.

## Verdict

**PUBLISHABLE WITH REQUIRED FIXES.**

The arithmetic is sound. Every number I could recompute, I reproduced — 30/30
cells, 48/48 drivers, the headline, and the 20/10/13 tally. I found **no
computational defect**.

What fails is the **framing layer**: the headline sentence, three legend claims,
and one disclosure state more than the receipts support, and the page omits a
`REPORT-STYLE`-mandated section. Nine fixes are required before publish; none
requires a re-run and none changes a computed number.

---

## Task 1 — Re-derivation of the numbers

Independent recomputation from the receipts, compared against every rendered
string on the page.

| Quantity | Result |
|---|---|
| Per-cell bands (`mean ± stddev`) | **30/30 reproduce** |
| Baseline means and lift Δ | **30/30 reproduce** |
| Δ input / Δ output tokens | **30/30 reproduce** (recomputed as the difference of per-arm means, and separately as the mean of per-case `usage` — both agree to <0.01 tok) |
| Derived $/1k calls | **30/30 match the receipt field**; re-derived independently from mean tokens × frozen rates, max divergence **$0.001 per 1k calls** (receipts store means rounded to 2dp) |
| Δ latency | **30/30 reproduce** from per-case `usage.wall_ms` medians |
| Cost-per-0.01-lift cells | **14/14 reproduce** exactly |
| Driver lists (Verdict basis) | **48/48 reproduce** — ids, Δ values, `†point-band` marks and arrow directions all match |
| Tally | **20 separated / 10 within noise / 13 low-res — reproduces** |
| Headline total | generation **$105.22**, judge **$87.57** — both reproduce, including from tokens × frozen rates |

**Figures I could not reproduce exactly: none.** Two observations of note:

1. **The headline total is 1¢ low.** True sum is **$192.7955** → $192.80; the page
   prints **$192.79** because it renders the total as the sum of the
   cent-rounded components ($105.22 + $87.57), a deliberate choice from spec 001
   so the arithmetic a reader performs on the page holds. Defensible, and I would
   keep it — but the direction is worth knowing: the page understates.
2. **`naming-analyzer` / `gpt-5.6-sol`** renders `$13.28/1k`; the receipt field is
   `13.275`, my token re-derivation `13.2748`. A half-cent rounding boundary, not
   a defect.

Cross-checks that passed: all 30 receipts `verification_level: TESTED`; all 30
share one `pricing_snapshot.frozen_at` (`2026-08-18T19:01:02.260Z`, matching the
page's "frozen 2026-08-18"); every case carries exactly `n=5` judge samples;
420/420 case rows carry `usage` (see C1 below); 0 rows with non-ok status.

---

## Task 2 — Verdict-basis audit

The page states its rule plainly: *a case drives the accuracy axis only when the
`with_skill` and `baseline` bands (mean ± stddev, n=5) do not overlap AND the mean
moves ≥ 0.05.* I applied exactly that rule to all 210 case pairs.

**Every driver on the page follows from its receipt. No driver is missing, invented,
or mis-signed.** The verdict *basis* is clean.

The **prose above it is not**. Composition of the 20 cells the page calls
"reportable lift":

| | cells |
|---|---|
| all drivers positive | 13 |
| **mixed** (up and down drivers in the same cell) | **5** |
| **all drivers negative** (regression only) | **2** |

### Finding V-1 (required fix) — two cells "earned" a regression, not a lift

> "**20 of 30 skill × substrate pairs earned a reportable lift** — and now carry a price."

- `commit-work` / `claude-fable-5` — sole driver `two-sentence-describability-test` **Δ−0.122**; aggregate **−0.010**
- `crafting-effective-readmes` / `gpt-5.6-sol` — sole driver `categorize-task-before-writing` **Δ−0.078** †point-band; aggregate **−0.006**

Neither earned a lift. Both earned a floor-clearing, band-separated *regression*,
and the page's own Verdict basis says so with a 🔻. A reader who reads only the
headline is told the opposite of the evidence.

### Finding V-2 (required fix) — four of the 20 have a negative aggregate lift

`documentation-and-adrs`/`claude-sonnet-5` (**−0.048**, and its largest driver is
`match-existing-adr-convention` at **Δ−0.758**), `git-workflow-and-versioning`/`gpt-5.6-sol`
(−0.002), plus the two above. Counting these as pairs that "earned a reportable
lift" is not supportable in any reading.

### Finding V-3 (required fix) — "and now carry a price" is true of 14, not 20

Only **14** cells render a price; **6** render `n/a (within noise)` — see Task 3.

### Finding V-4 (required fix) — the 6 driver-only cells contradict the page

These render `n/a (within noise)` in the cost/benefit column while the Verdict
basis section on the same page names their separated, floor-clearing drivers:

| cell | aggregate Δ | drivers |
|---|---|---|
| `code-review-and-quality` / `claude-sonnet-5` | +0.035 | 1 up (Δ+0.196) |
| `skill-creator` / `gpt-5.6-sol` | +0.042 | 2 up (Δ+0.192, +0.154) |
| `documentation-and-adrs` / `claude-sonnet-5` | −0.048 | 2 up, 1 down |
| `git-workflow-and-versioning` / `gpt-5.6-sol` | −0.002 | 2 up, 1 down |
| `commit-work` / `claude-fable-5` | −0.010 | 1 down |
| `crafting-effective-readmes` / `gpt-5.6-sol` | −0.006 | 1 down |

"Within noise" is factually wrong for a cell with a named driver that cleared the
floor with separated bands. The lift column compounds it: it appends
"(within noise)" by a *different* rule (no drivers at all), so `Δ +0.042` carries
no annotation while its ratio cell says "within noise", and `Δ +0.021` is
annotated while another sub-floor cell is not. Two rules, one label, adjacent
columns.

### Finding V-5 (required fix) — the low-resolution note is missing entirely

`REPORT-STYLE.md` § "Low-resolution note (judge quantization)" requires a section
flagging any verdict supported in whole or in part by a zero-width point band,
listing each affected verdict and its case. **The string "low-resolution" does not
appear on the page.** The only trace is 14 `†point-band` marks inside a collapsed
`<details>`. What the reader is not told:

- **13 of the 20** separated cells rest partly on a point band
- **10 of the 14** priced cells do
- **3 of the 4** priced cells that rest on a *single* driver have that driver on a point band — `code-review-and-quality`/`claude-fable-5` ($6.78, driver Δ+0.636 †), `naming-analyzer`/`claude-fable-5` ($7.97 †), `writing-plans`/`gpt-5.6-sol` ($3.79 †)
- 2 drivers have **both** arms zero-width (`document-public-api-function` on sonnet and fable, Δ+0.200 each)

This is the report's own anti-cry-wolf machinery, suppressed at exactly the point
where a price tag makes it consequential.

*(Borderline: 28 of 420 case-arms are `borderline`. The page never mentions
borderline and no rendered figure depends on it — no finding, recorded for
completeness.)*

---

## Task 3 — TBD-1 resolved: **the denominator stays the aggregate**

### Recommendation

**Keep the aggregate lift as the ratio denominator. Do not switch to the driver's
lift.** Fix the *labels* instead (V-1, V-3, V-4).

### Why — the arithmetic, not taste

The numerator is a **per-call cost paid on every case in the suite**. The
aggregate lift is the **per-case average benefit over the same 7 cases**.
Numerator and denominator span the same population, so the quotient means what it
says. A driver's lift is measured on **1 of 7 cases** while the cost is still paid
on all 7 — pricing one against the other mixes populations and systematically
flatters the skill by up to ~7×. Measured effect if the driver lift were
substituted:

| cell | price now | price under driver-lift |
|---|---|---|
| `git-workflow-and-versioning`/`claude-sonnet-5` | $1.19 | **$0.25** (4.8× cheaper) |
| `code-review-and-quality`/`claude-fable-5` | $6.78 | **$1.09** (6.2× cheaper) |
| `naming-analyzer`/`gpt-5.6-sol` | $1.94 | **$0.50** |
| `documentation-and-adrs`/`claude-fable-5` | $8.26 | **$2.15** |

Every skill gets 2.5–6× cheaper per unit of benefit without a single new
measurement. For a report whose credibility rests on restraint, that is the wrong
direction to move on a tie.

The second reason is that **the driver rule is not well-defined on this data**.
Of the 20 separated cells, the "qualifying driver" is unambiguous in only 7:

- **5 cells have mixed up/down drivers** → no defensible single lift exists
  (`commit-work`/gpt, `documentation-and-adrs`/sonnet, `git-workflow`/gpt,
  `naming-analyzer`/sonnet, `requesting-code-review`/sonnet)
- **8 cells have 2–4 positive drivers** → which one? max flatters, mean is
  arbitrary, sum double-counts a cost paid once
- 7 cells have exactly one driver

TBD-1 was framed around "a pass justified by a **single** driver". That case is a
minority (7 of 20), and adopting it would require inventing a second rule for the
other 13. The aggregate needs no second rule.

### What changes on the page

**No number changes.** Three changes, all textual:

1. Headline → count what was measured, e.g. *"In 20 of 30 skill × substrate pairs
   at least one case cleared the effect floor with separated bands: 18 with an
   improving case (5 of them also with a regressing one), 2 with only a regressing
   case. 14 cleared the floor on aggregate and carry a price."*
2. The 6 driver-only cells get a **third render string** distinct from the noise
   string — `n/a (driver-only)` — with a legend line: *the aggregate did not clear
   the floor; named drivers did, and are listed under Verdict basis.*
3. The lift column's "(within noise)" annotation is aligned to the same rule as
   the ratio gate, so one label cannot mean two things in adjacent columns.

AC-2 currently pins `n/a (within noise)` for every floor-fail; adding a third
string is a **visible, versioned criterion change** — which is exactly the shape
spec 001 said resolving TBD-1 should take.

---

## Task 4 — Cost drivers: **both framings are wrong**

The receipt-2-era claim (Δcost tracks skill size) does not survive the matrix. The
proposed replacement (output-driven) does not survive it either.

Measured across all 30 cells:

| relationship | correlation |
|---|---|
| SKILL.md size ↔ $/1k | **+0.33** (weak) |
| Δ output tokens ↔ $/1k | **+0.33** (weak) |
| **Δ input tokens ↔ $/1k** | **+0.92** |

The input side dominates |Δcost| in **27 of 30** cells. The two cells in the
reconciliation question are both input-driven:

| cell | SKILL.md | Δ input | Δ output | $/1k |
|---|---|---|---|---|
| `code-review-and-quality`/sonnet | 5,117 tok | +6,922 (**+$20.76**) | +229 (+$3.44) | $24.20 |
| `requesting-code-review`/sonnet | 738 tok | +25,429 (**+$76.29**) | −474 (−$7.11) | $69.18 |

The 738-token skill costs 2.9× more because it pulled **25,429 extra input tokens**
into the call — 34× its own text — while its output actually *shrank* and **saved**
$7.11. So it is input-side, but the input is not the skill's text.

Two further facts the page should carry:

- **Δ input is behavioural, not textual.** Median |Δ input| is **1.5× the skill's
  own size**, ranging to 34×, and is **negative in 8 of 30 cells** (to −45,045 on
  `requesting-code-review`/fable). A skill that removes 45k input tokens while its
  text is 738 tokens has changed the *path the model takes*, not the prompt size.
- **The substrate's price is a first-order multiplier.** Same skill, near-identical
  token deltas, 3.3× rate difference:

  | skill | Δin sonnet | Δin fable | $ sonnet | $ fable |
  |---|---|---|---|---|
  | `git-workflow-and-versioning` | +4,956 | +4,954 | $13.88 | $46.42 (3.34×) |
  | `naming-analyzer` | +4,025 | +4,000 | $12.91 | $41.22 (3.19×) |
  | `writing-clearly-and-concisely` | +1,394 | +1,394 | $5.81 | $12.68 |

### Proposed general statement

> A skill's cost is set by how much it changes the **whole call's token
> footprint** — overwhelmingly on the input side (r = +0.92; input dominates in 27
> of 30 cells) — multiplied by the substrate's price per token. The skill's own
> length is a weak predictor (r = +0.33): a 738-token skill drew 25,429 extra input
> tokens on one substrate, while a 5,117-token skill drew 6,922. And the change is
> not always upward — in 8 of 30 cells the skill made the call *cheaper*. Read Δ
> tokens per substrate; do not infer cost from a skill's size.

### Surviving stale framing (required fix)

The Δ tokens legend reads: *"input (**its own text, prepended to every call**)"*.
That is the receipt-2 model, and it is false for 8 cells outright (negative) and
understated for most of the rest. It must be restated as the call's input delta,
of which the skill's text is one part.

---

## Task 5 — C2 semantics: negative cost-per-lift

Four cells render a negative price: `$-29` (`requesting-code-review`/fable),
`$-11` (`writing-plans`/fable), `$-9.4` (`requesting-code-review`/gpt), `$-4.2`
(`skill-creator`/sonnet). All four are the same real phenomenon: **the skill
improved quality and reduced cost.**

### Recommendation: render a string, never a number

`n/a` is wrong here — something good happened. Recommended render:

> **`saves $196.77/1k`**

with the lift already visible two columns to its left, and a legend line: *this
skill improved measured quality and reduced cost; there is no price per unit of
benefit to state.*

### Why

1. **The quotient has no interpretation.** "What one unit of benefit costs" is
   undefined when the benefit is free. The number is not wrong, it is not a price.
2. **Its ordering is inverted.** In the rest of the column, smaller is better. Among
   negatives, *more negative* is better — so `$-29` and `$-4.2` sort backwards
   against `$1.19` and `$8.26` in the same column, with no legend explaining the
   flip. This is the same failure `+0.00 /$/1k` had: arithmetically correct,
   read wrongly.
3. **It follows existing precedent.** `n/a (within noise)` and `n/a (skill
   regressed)` already establish the pattern: where the ratio has no valid
   interpretation, render a string. `value.costPerLiftPoint` already returns a
   rendered string precisely so a caller cannot bypass the rule.
4. **The current output is visibly unowned.** Negatives render at two significant
   figures (`$-9.4`, `$-4.2`) against two decimals for positives (`$6.78`) —
   the negative path was never designed, only reached.

AC-1's stated domain ($1–$500 per 1,000 calls) needs a **negative-cost carve-out**,
structurally identical to the v1.2 negative-*lift* carve-out: name the render in
the criterion so contract and code agree.

---

## Task 6 — Self-disclosure

### 6a. The 9.2× projection miss — **yes, disclose. Required.**

Not optional, because the page **already** states *"against the $40 guard"*
directly after *"metered-equivalent $192.79"*. As written, it reads as a
compliance statement while describing a 4.8× breach. Silence is not the status quo
here; the current text actively misleads.

> Draft: *"This run was projected at $20.89 and cost $192.79 metered-equivalent —
> 9.2× the projection, against a $40 guard that never fired because it checked the
> projection rather than accrued spend. Actual metered spend was $0 (subscription
> surfaces). The projection's token constants did not model the fixed CLI harness
> preamble; the guard is being rebuilt to check accrual before the next run."*

This also converts an embarrassment into the report's own thesis: a projection
built on assumed token constants missed by 9.2×, which is precisely why the report
argues tokens must be measured rather than estimated.

### 6b. The judge share — **yes, disclose. And correct a false claim first.**

The page states, as a general fact: *"**Grading costs more than generating** (n=5
judge calls per generation)."* `REPORT-STYLE.md` rule 6 states it the same way.
**The receipts contradict it:**

- In aggregate, grading cost **$87.57** against generation's **$105.22** — grading
  was **cheaper**, 45.4% of the total.
- Per case row: **$0.2085** grading vs **$0.2505** generating.
- It is true in **16 of 30 receipts** — every `claude-sonnet-5` and `gpt-5.6-sol`
  receipt — and false in all 10 `claude-fable-5` receipts, where generation at
  $10/$50 per MTok outruns the haiku judge.

So it is a **substrate-dependent** claim published as universal. Required fix.

The defensible disclosure is the one measured in **time**, which is dramatic and
correct:

> Draft: *"Measurement is the expensive half in wall-clock: judging consumed 18.26
> of the run's 20.47 compute-hours (**89%**), against 2.21 hours of generation. In
> dollars it was $87.57 of $192.79 (45%) — cheaper than generation in aggregate,
> though on the two lower-priced substrates the judge cost more than the work it
> graded. None of it enters any value figure."*

---

## Task 7 — Pre-publish checklist sweep

`specs/001-ratio-framing/tasks.md` carries **9 open items** (not 12 — A1, A2, B1
and B2 are closed above the checklist, and A3/B3/B4 appear both in the earlier
backlog and again as carried items, which likely accounts for the count).

| # | Item | Status |
|---|---|---|
| **C1** | generation half fails silently to zero on a missing case-row `usage` | **Carried — not a publish blocker.** Verified empirically: **420/420 case rows carry `usage`**, 0 non-ok statuses. The silent path was never taken, so no published figure is affected. Still a must-fix before the next run: it is unguarded and fails toward understatement. |
| **C2** | negative incremental cost renders a negative price | **MUST FIX.** Live on 4 cells. Semantics recommended in Task 5. |
| **C3** | `receipt.sh` pins HEAD, not the last code commit | **Carried.** Tooling outside this repo; affects evidence provenance, not any published number. |
| **C4** | "Completed" date is the run's start stamp | **MUST FIX.** Page says *Completed 2026-08-18*; `pricing_snapshot.frozen_at` on all 30 receipts is `2026-08-18T19:01:02.260Z`, which is the run's start. A one-word claim that is off by the run's full duration. |
| **C5** | wall-clock belongs in economics; no receipt attests it | **Carried, recommend adopting now.** I re-derived it independently: generation 2.21 h, judging 18.26 h, **20.47 h total compute**. It costs nothing to state and it carries the strongest finding in 6b. The receipt-schema half (a start/finish pair) can follow later. |
| **A3 / F2** | AC-4 tripwire harvests cost cells by shape | **Carried.** Gate-internal. Note the risk is not hypothetical: the pre-merge draft rendered a retired unit that this tripwire would not have harvested. |
| **B3 / F3** | `F3 bound` assertion re-implements `fmtUsd` | **Carried.** Gate-internal. Related to the negative-cell formatting inconsistency in Task 5 — worth doing when C2 lands. |
| **B4 / F4** | no-projection check matches two literal strings | **Carried.** Gate-internal. Note 6a *adds* a projection figure to the page deliberately; this assertion must be reconciled with that, not merely dropped. |
| **D1** | pinned-vs-current skill versions + observer-effect disclosures, with the "8 of 10 byte-identical" count re-verified **live** at publish | **MUST FIX, and unverifiable from my sources.** The claim is about the state of third-party repositories; nothing in the receipts or the page attests it. It must be re-checked against upstream at publish time, exactly as the item requires. |

---

## Required fixes before publish

1. **V-1/V-2/V-3** — rewrite the headline: 2 of the 20 are regression-only, 4 have
   a negative aggregate lift, and 14 (not 20) carry a price.
2. **V-4** — give the 6 driver-only cells a render distinct from `n/a (within
   noise)`, and align the lift column's "(within noise)" annotation to the same
   rule as the ratio gate.
3. **V-5** — add the `REPORT-STYLE`-mandated low-resolution note: 13 of 20
   separated cells, 10 of 14 priced cells, and 3 of the 4 single-driver priced
   cells rest on a point band.
4. **C2** — stop rendering negative prices (Task 5), and amend AC-1's domain.
5. **Task 4** — correct the Δ-tokens legend ("its own text, prepended to every
   call") and adopt the general statement.
6. **6a** — disclose the projection miss; the bare "against the $40 guard" cannot
   stand beside $192.79.
7. **6b** — correct "grading costs more than generating" (false in aggregate,
   true in 16/30), and disclose the 89% compute share. `REPORT-STYLE.md` rule 6
   needs the same correction.
8. **C4** — the run record's completion date.
9. **D1** — re-verify the upstream byte-identical count live at publish.

Also at promotion: the run record cites `receipts/report-005-draft/`, which must
become the published receipts path per `REPORT-STYLE.md` § Run record.

### Recommended, not blocking

- Adopt **C5** now (20.47 compute-hours) — it is measured, and it carries 6b.
- Reconcile the missing shared-chrome columns (value-per-token, deterministic
  post-checks, verdict label) with `REPORT-STYLE.md` § Table anatomy, **or** state
  the deviation in the report as that document requires. Currently the value report
  drops three mandated columns silently.
- Typography: negative token/latency deltas use U+2212 while lift Δ and the
  negative prices use ASCII hyphen.

## Not verifiable from the permitted sources

The "same 10 suites (Report #001 v1.2 rubrics)" provenance (receipts carry a
`suite_hash`, not a lineage); whether the frozen prices matched the vendors' real
2026-08-18 rates (the snapshot is internally consistent and self-describing, which
is all a receipt can attest); and every claim in D1.

---

**Bottom line.** The measurement is trustworthy — I could not break a single
number, and the driver machinery is exactly as strict as it claims. What needs
work is the sentence at the top of the page and three claims in the legend, all of
which currently say more than the receipts support. Fix those nine items and this
publishes.
