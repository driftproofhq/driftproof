<!-- SPDX-License-Identifier: Apache-2.0 -->
# Report 020 pre-registered outcomes

Report 020 is the release boundary for Addy Osmani's code-review-and-quality,
git-workflow-and-versioning and documentation-and-adrs on Claude Fable 5.2. This note fixes how its
verdicts are read and worded before any paid run. plan.json records this file's sha256 and spec.md
pins it. A changed byte is a new plan, written before the run, never after it.

## What is run

Six runs of the runner's own `driftproof run`: claude-fable-5-2 and claude-fable-5-1, each on the
three skills, with Report 011's SKILL.md bytes and its one case per skill. Both sides are fresh
runs under one runner, Driftproof 0.28.0, one CLI, Claude Code 2.1.311 on the claude-cli
subscription surface and the isolated eval-user lane, one judge, claude-haiku-5-5 at 5 samples, and
one draw rule, 3 to 10 draws per arm. Each run has two arms: the skill text, and no skill.

The plan lists every committed receipt answered by claude-fable-5-1 on these skills, and the fields
where each differs from this design. One exists, Report 008's on code-review-and-quality; it has the
same SKILL.md bytes but another suite, runner, judge record and CLI. None matches on everything but
the model, so the Fable 5.1 side is a re-run.

## The model table, and only that

For each skill the table sets the claude-fable-5-1 receipt beside the claude-fable-5-2 receipt. The
verdict is lib/diff.js buildDriftReport over the pair, the comparison `driftproof diff` runs, read on
the with-skill arms only: band separation, the effect floor, and spec 035's underpowered rule. Each
verdict is shown in one of Report 011's four labels, with each arm's mean, spread and draw count:

- separation detected, upward
- separation detected, downward
- no separation detected
- no separation detected; not enough draws to conclude at this effect floor

A pair missing a receipt reads "not measured", never a verdict. The baseline means and the lifts are
shown as context; no verdict is read from them, however far apart they are.

No harness table is planned. It would need Report 011's judge, and this boundary asks only how Fable
5.2 reads against Fable 5.1.

## The judge

The judge is claude-haiku-5-5, the judge the judge policy fixes: "That judge is fixed at
claude-haiku-5-5 and changed only rarely" (/judge-policy/). It is a different model from both
targets.

Report 020's judge differs from Report 011's, so Report 020's figures are not set beside Report 011's
as if comparable. Report 011 was graded by claude-opus-5 at 3 samples. The judge policy holds that
"results scored by different graders are not compared directly". Report 020 shows no Report 011
reading, verdict or figure, beyond one methods sentence naming the skills and cases it shares.

## The effort setting

No effort setting is passed, so each model runs at the default a user of the CLI gets. The catalog
gives claude-fable-5-2 medium and claude-fable-5-1 high. The two models ran at their own defaults,
and the report says so beside every verdict: the table reads two models as users get them, not the
same effort.

## The price

claude-fable-5-2 has no published price in this repository. Its calls are priced at an estimate,
USD 10 input and USD 50 output per million tokens, the most expensive known tier, and every cost
figure says so. claude-fable-5-1 is priced at its registered rate, the same figures. Metered spend on
the subscription surface is USD 0.

## Which receipt is read

One verified receipt per run, the one the campaign's manifest chain records. A run with a verified
receipt is never run again; a run without one may be run again in a later start of the same frozen
plan, at most three runs in all, every failure kept in the chain. No receipt is chosen after its
results are seen.

## Limits

One case per skill. Nothing in the report describes how any of the three skills behaves on any
other task, or how Fable 5.2 behaves in general.

Few draws. Each arm draws between 3 and 10 generations, and each case's band is the spread across
its draws. With one case there is no spread across cases.

The judge is not Report 011's. The figures are comparable within Report 020 only.

The two models ran at their own default effort, medium and high.

## What the report does not say

It does not say which model is better at these skills in general, why a verdict reads as it does, or
that no separation means the two models score alike. It does not compare any figure with Report 011
or with Reports 017, 018 or 019.
