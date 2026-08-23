<!-- SPDX-License-Identifier: Apache-2.0 -->
# Report style — shared chrome every Driftproof report inherits

Driftproof publishes more than one *type* of report, but they share one visual
and structural language so a reader who has read one can read any. This document
is the contract: a new report (`docs/reports/NNN/`) should carry every element
below, in this order, with the same meaning. Deviate only with a reason stated
in the report itself.

## Report types

Each report declares its type as a one-line eyebrow label (`<p class="report-type">`)
directly under the `<h1>` title:

| Type | Label | Question | What moves under the skill |
|------|-------|----------|----------------------------|
| Release drift | `Release drift report` | Does a skill's verdict hold when the model *version* changes? | model release (old vs new, same provider) |
| Substrate durability | `Substrate durability report` | Does a skill's benefit hold across a change of *substrate*? | a different model behind a different vendor surface |
| Capability gap | `Capability-gap report` | Does a skill's benefit hold on a *higher tier* of the same provider? | model tier (flagship vs frontier, one provider, same surface) — cross-family when the higher tier has no predecessor, and then the label must say so (NOT release drift) |
| Value | `Value report` | What does a skill *cost* to run — in money and in latency — alongside whether it helps? | nothing moves under the skill; the substrate is held across several models and the **axes** widen from one (accuracy) to three (accuracy, cost, latency) |

All use the same band-based, floor-gated verdict rule (below); they differ only
in what moves underneath the skill. Future types add a row here and a label —
they do not invent a new verdict rule without saying so.

A **value report** is the one type that adds axes rather than moving the
substrate, so it carries the extra presentation rules in the next section. Its
accuracy axis is the unchanged band rule: nothing about adding cost and latency
relaxes what it takes to claim a skill helped.

## Value-axis presentation rules (value reports)

These rules are encoded in `lib/value.js`, not just documented here, and the gate
asserts them. They exist because economics is exactly where a measurement project
is most tempted to overclaim.

1. **The three axes are always shown together.** Accuracy lift (with bands),
   Δ cost, and Δ latency appear side by side in the same table row. A cost number
   without its accuracy band invites "cheap therefore good"; an accuracy number
   without its cost invites the opposite. Neither is publishable alone.

2. **No composite value score. Anywhere. Ever.** The three axes have different
   units, different error bars, and different owners — a platform lead trading
   latency for accuracy and a finance owner trading dollars for accuracy are
   asking different questions. Collapsing them into one "value score" would
   manufacture a figure no reader could trace back to evidence, which is the same
   failure mode the band rule exists to prevent. The report presents the three
   and lets the reader weigh them.

3. **Ratio framings are floor-gated, and priced per unit of benefit.** The
   cost-per-benefit cell renders **dollars per 0.01 lift** — what one unit of
   measured benefit costs — and **only** where the accuracy lift cleared the 0.05
   effect floor with separated bands. Otherwise it reads exactly
   **`n/a (within noise)`**, never a number: dividing a noise-level lift by a real
   cost produces a precise-looking figure with nothing under it, and precision is
   what readers trust. Enforced by `value.costPerLiftPoint`, which returns a
   rendered string (never a bare number) so a caller cannot bypass the rule by
   formatting it themselves.

   **Four states, one price.** A floor-clearing positive lift is priced. A cell
   whose per-case *drivers* cleared the floor while its **aggregate** did not
   reads `n/a (driver-only)` — not the noise string, because the evidence exists
   and the Verdict basis names it; the aggregate stays the denominator, since the
   cost is paid on every case and the benefit must be averaged over those same
   cases (DECISIONS #9). A cell with no separated driver at all reads
   `n/a (within noise)`. A skill that improved quality *and* reduced cost states
   the saving, never a negative price: there is no cost per unit of benefit when
   the benefit is free, and a negative price sorts backwards against every other
   cell in the column.

   The unit direction is deliberate. The first version of this rule used *lift per
   dollar per 1,000 calls*, which was arithmetically correct and practically
   useless: real incremental costs are $24–70 per 1,000 calls against lifts of
   0.03–0.6, so every cell rendered `+0.00` — reading as "no benefit per dollar"
   beside a case that had moved +0.636. Cost-per-benefit stays in human range, and
   cannot collapse toward zero as costs rise. A cell whose leading value is zero
   while the floor gate passed is a **gate failure** (`value.isZeroLooking`), so
   the class of defect cannot silently return. A floor-clearing *negative* lift
   prices nothing — it reads `n/a (skill regressed)`.

4. **Latency always carries its disclosure.** Every latency figure is marked
   *"observed on subscription CLI surface, indicative"*. Wall-clock on a
   subscription CLI includes cold starts and the vendor's own harness; it is a
   real observation of what a user of that surface experiences, not a benchmark
   of the model's serving latency, and the page must not let it read as one.

5. **Read the incremental columns, not the absolute ones.** Both CLI surfaces
   prepend a large fixed harness preamble (observed ~25k input tokens on
   `claude-cli`, ~11k on `codex`) that we do not control. It inflates absolute
   per-call cost, but it is *identical in both arms*, so it cancels in every Δ
   figure. The disclosure box says this in words; the table leads with Δ.

6. **The judge is measurement overhead, never skill cost.** Those tokens are
   recorded separately as `judge_usage`, are excluded from every value figure by
   construction (`economics.judge_excluded` is `const: true` in the schema), and
   are disclosed as their own line so the reader can see what measurement cost.

   **State the overhead in time, and condition the dollar claim.** This document
   used to assert that grading a case costs more than running it. Report #005's
   receipts do not support that as a general fact: grading cost $87.57 against
   generation's $105.22 — *cheaper* in aggregate — and it held in 16 of 30
   receipts, every one of them on a lower-priced substrate, and in none of the
   `claude-fable-5` receipts. It is substrate-dependent and must be written that
   way. The claim that is true across the run is the wall-clock one: judging
   consumed 89% of compute hours. Report the compute share, report the dollar
   share, and name the substrates when saying grading cost more.

7. **Prices are frozen at run time.** Every dollar figure is computed from the
   receipt's own `run.pricing_snapshot`, never from the live registry, so a
   published report does not silently change meaning when a vendor cuts prices.
   On subscription surfaces the basis is stated as **metered-equivalent** (actual
   metered spend is $0).

## The shared verdict rule (anti-cry-wolf)

Every number is a **band**: mean ± stddev over `n = 5` judge samples (fixed judge,
temp 0). A directional claim (improved / regressed / drift) is made **only** when
two bands do **not** overlap **and** the mean moves at least the **0.05 effect
floor** (`config.EFFECT_FLOOR`). Overlapping bands, or a sub-floor move, are
"within noise" — never a verdict. This restraint is the point; it is identical
across report types (in a release-drift report the two bands are old-model vs
new-model `with_skill`; in a substrate-durability report they are `with_skill`
vs `baseline` within one substrate).

## Table anatomy (column order)

The per-skill summary table reads left to right in this fixed order:

1. **skill** — slug.
2. **per-substrate band + Δ lift** — one column per model/substrate: the
   `with_skill` band and its lift Δ vs the comparison band. **Δ is shown as
   context only** — the verdict does not rest on it.
3. **value-per-token** — Δ per 1,000 SKILL.md tokens (`lib/skillCost.js`); a skill
   is not free, so lift is also reported normalized by its cost.
4. **deterministic post-checks** — passed/total, reported *alongside* the judge
   and **never folded into the verdict**. Authored only where a mechanical
   assertion is groundable in the SKILL.md text; a `—` means *no checks defined*,
   not checks failed.
5. **verdict** — the composed label. A `† low-res` mark flags a verdict whose
   supporting case rests on a zero-width judge point band (see below).

A short caption under the table restates that the verdict rests on per-case band
separation, not the aggregate Δ. Where a report composes per-case directions into
a multi-valued label (e.g. the durability labels), it carries a **"How the label
is composed"** legend stating the precedence explicitly, with a worked example.

## Verdict basis (drivers)

A collapsible **Verdict basis** section (`<details class="card">`) lists, per
skill × substrate, the exact cases that *drove* the verdict — those that
separated and cleared the floor — with each case's Δ and an improved/regressed
marker. Cases on a zero-width band are marked `†point-band`. The report claims no
verdict a reader cannot trace to a named case here.

## Low-resolution note (judge quantization)

Any verdict supported — in whole or in part — by a **zero-width point band** (all
5 judge samples identical) is flagged **"low-resolution: judge quantization."**
The judge grades on a coarse grid, so a zero-width band is a clean grid-step
effect the floor still gates, but one whose finer structure the judge cannot
resolve. **The verdict stands; it is flagged, not suppressed.** The note lists
each affected verdict and the point-band case behind it.

## Run record

A factual **Run record** section (not a projection) states: the run's **start**,
labelled as receipt-attested (`run.date_utc` is written once at run entry and is
identical across a run's receipts — it is not a completion date, and Report #005
presented it as one until spec 002 AC-9); a **finish** only if one can be
produced, explicitly labelled derived, since receipts carry per-call `wall_ms` but
no finish stamp and any elapsed figure also depends on the run's concurrency,
which is a launch parameter rather than receipt evidence; that it ran in resumed
segments if so; that all receipts are
complete (N skills × M substrates); the disclosed surfaces and the resulting
metered spend (subscription CLIs = `$0`, with the estimated metered-equivalent
under the run's guard); any case that needed an extended timeout (recorded in its
receipt); and the receipts path (`receipts/report-NNN/`). Every number on the
page is re-derived from those receipts.

## Draft → publish chrome

While drafting, a report lives at `docs/reports/NNN-draft/` (gitignored), carries
a `noindex` meta tag and a "DRAFT — not published" banner, and is queued in
`reports/pending-publish.md`. On approval it is promoted out of `-draft` (see
[RUNBOOK.md](RUNBOOK.md) § "Approve and publish a drafted report"): the draft
markers are removed, the title drops "(DRAFT)", the footer reads "Report #NNN",
and it is linked from the index nav and the "Latest report" section.
