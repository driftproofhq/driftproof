<!-- SPDX-License-Identifier: Apache-2.0 -->
# Report 017 pre-registered outcomes

Report 017, "Skill or sugar pill?", is planned in this directory. This note fixes how its headline
is read before any paid run. plan.json records this file's sha256 and spec.md pins it. A changed
byte is a new plan, written before the run, never after it.

## What each receipt shows

Each of the 20 frozen attempts runs one skill of Report 015's plain list on claude-sonnet-5-5,
graded by claude-haiku-5-5, with three arms: the skill text, no skill, and a text of the skill's
length in bytes from the revision 1 fixed corpus (spec 440).

The report shows two readings for each receipt, each in lib/verdict.js's own words:

- the verdict: `receiptVerdict`, the skill against no skill, in the receipt reader's words;
- the placebo reading: `placeboLine(placeboReading(receipt))`, the skill against the same-length
  text.

The verdict shown is the Report 017 receipt's own. Report 015's verdicts are not put beside it as
if they were the same run. The verdict reads only the skill and no-skill arms, so the placebo
arm's replies move it in no way. No figure other than these readings and their counts enters the
headline.

## Which receipt is read

The report reads exactly one sealed receipt per attempt id. It is the receipt the campaign's
manifest chain records for that attempt, read through the campaign ledger. The first completed
receipt is the only one: an attempt with a sealed receipt is never run again, and a second receipt
for the same attempt id refuses the whole chain. No receipt is chosen after its results are seen.

An attempt without a receipt may be run again in a later invocation of the same frozen plan, at
most three runs in all, its earlier costs counted against the USD 400 cap. Every failure stays in
the ledger. A failure carries no reading, so running it again chooses nothing.

The campaign has one root directory. It keeps the plan and this note as first started and an
append-only log with one line per start. A second start with no prior chain is refused, and a
resume must continue the log's latest manifest. The report reads only the chain that ends at the
log's latest manifest, and refuses if the root holds any other manifest under this plan. A cost
correction may be added after a run and is never rewritten: each manifest records the corrections
in force when it started.

## Terms

"Beat the fake" means exactly one thing: the placebo reading is `ABOVE_PLACEBO`. In the reader's
words, "case rule: at least one case scored above the same-length placebo, and none below". The
case rule reads each of the three tasks by its draw bands, so this says no more than that, on at
least one of three tasks, the skill's band sat above the placebo's at the effect floor, and on none
below.

No other reading beats the fake. `BELOW_PLACEBO`, `NO_DIFFERENCE`, `INCONCLUSIVE`, `UNDERPOWERED`
and `NOT_MEASURED` do not. None of them shows that a skill does no better than the fake.

A missing receipt reads `NOT_MEASURED`: a failed, cancelled or budget-stopped attempt is counted
as not read, never as a result. A stub receipt also reads `NOT_MEASURED`.

## Who is counted

The four routers are find-skills, agent-browser, hyperframes and hyperframes-registry. They carry
Report 015 Amendment 1's qualification: their text tasks test the router's written response, not
the delegated skill. Their readings are shown with that qualification. They are left out of the
headline count, as Report 015 leaves them out of its verdict counts.

The headline counts the other 16 skills. N is 16.

## Tally shapes

A is the number of the 16 that read `ABOVE_PLACEBO`. U is the number that read `UNDERPOWERED`.
M is the number that read `NOT_MEASURED`. Exactly one shape applies, taken in this order:

1. `all`: A is 16.
2. `not_read`: M is 8 or more, half of N.
3. `many_underpowered`: U is 8 or more.
4. `none`: A is 0.
5. `some`: A is from 1 to 15.

`not_read` comes before `none`, so a campaign that read few receipts is never headlined as a
result. Every count is out of the same 16; none is out of the receipts that happened to be read.

## Headline templates

The headline is the line of the shape that applies, with its counts filled in. The `counts` line
and the `routers` line follow it, unchanged but for the counts. B, D and I are the numbers of the
16 that read `BELOW_PLACEBO`, `NO_DIFFERENCE` and `INCONCLUSIVE`.

```report-017-headlines
all: All {N} skills beat the fake: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none.
not_read: {M} of {N} skills were not measured against the same-length placebo, and {A} of {N} beat the fake by the case rule. A skill that was not measured has no result.
many_underpowered: {U} of {N} skills read UNDERPOWERED against the same-length placebo, and {A} of {N} beat the fake by the case rule. Each receipt's own line says whether more draws or more cases are needed. A skill that did not beat the fake is not shown to do no better than it.
none: None of the {N} skills beat the fake: none met the case rule (above the same-length placebo on at least one of three tasks and below it on none). A skill that did not beat the fake is not shown to do no better than it.
some: {A} of {N} skills beat the fake: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none. A skill that did not beat the fake is not shown to do no better than it.
counts: Of the {N}: ABOVE_PLACEBO {A}, BELOW_PLACEBO {B}, NO_DIFFERENCE {D}, INCONCLUSIVE {I}, UNDERPOWERED {U}, NOT_MEASURED {M}. Beat the fake means ABOVE_PLACEBO only.
routers: find-skills, agent-browser, hyperframes and hyperframes-registry are left out of these counts: their text tasks test the router's written response, not the delegated skill (Report 015 Amendment 1).
```

## Secondary reading: the placebo against no skill

Beside each skill, and never in the headline, the report shows a second reading: the same case
rule over the placebo's rows against the no-skill rows of the same receipt (`tally.cjs`
`secondaryReading`). Its tokens are `PLACEBO_ABOVE_BASELINE`, `PLACEBO_BELOW_BASELINE`,
`NO_DIFFERENCE`, `INCONCLUSIVE`, `UNDERPOWERED` and `NOT_MEASURED`. It is read only where the
placebo reading is read, and refused wherever that is refused. It is not counted, not subtracted
from the placebo reading, and not combined with it.

## Limits

The placebo text is not inert: on a task that supplies the facts its answer needs, a same-length
text about landscape and village life can pull an answer off them, so the fake can score below no
skill. The secondary reading shows where it did.

## What the report does not say

It does not say why a skill helps, that a skill and the fake are the same, or that the fake
carries no information about a task. It says nothing about a skill that was not run with the
placebo arm. It does not combine the 20 readings into one score.
