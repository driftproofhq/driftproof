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

Both use the same band-based, floor-gated verdict rule (below); they differ only
in what moves underneath the skill. Future types add a row here and a label —
they do not invent a new verdict rule without saying so.

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

A factual **Run record** section (not a projection) states: the date the run
completed and that it ran in resumed segments if so; that all receipts are
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
