# Skill or sugar pill, on Haiku? Twenty skills against a same-length placebo

Canonical: <https://driftproofhq.com/reports/018/>

## What did Report 018 find?

- **What we tested.** Twenty skills on Haiku 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5, the same model.
- **What we found.** 12 of 16 skills beat the fake on Haiku 5.5: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none. A skill that did not beat the fake is not shown to do no better than it.
- **The judge is the target's model.** The judge uses the same model as the target. Self-grading may favor its own model's answers.
- **Beating the fake is not beating no skill.** Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.
- **What it does not show.** It does not show how these skills do beyond three text tasks each, written by Driftproof for the twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Haiku 5.5 judged by Claude Haiku 5.5.

Report 018: Placebo comparison, claude-haiku-5-5

Type Placebo comparison report

What moved a same-length placebo text

Models `claude-haiku-5-5`

Headline 12 of 16 skills beat the fake on Haiku 5.5: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none.

Receipts [20 linked receipts](https://driftproofhq.com/reports/018/#receipts)

**Cite this**

```
@techreport{driftproof-018,
  title  = {Skill or sugar pill, on Haiku? Twenty skills against a same-length placebo},
  author = {Driftproof},
  year   = {2026},
  type   = {Placebo comparison report},
  note   = {claude-haiku-5-5},
  url    = {https://driftproofhq.com/reports/018/}
}
```

Report 018. Recorded on 2 Nov 2026. Answering model Claude Haiku 5.5; judge Claude Haiku 5.5.

Placebo comparison report. Twenty skills on Haiku 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5, the same model.

The judge uses the same model as the target. Self-grading may favor its own model's answers.

12 of 16 skills beat the fake on Haiku 5.5: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none. A skill that did not beat the fake is not shown to do no better than it.

Of the 16: ABOVE_PLACEBO 12, BELOW_PLACEBO 2, NO_DIFFERENCE 0, INCONCLUSIVE 0, UNDERPOWERED 2, NOT_MEASURED 0. Beat the fake means ABOVE_PLACEBO only.

Of the 16 skills counted: 12 beat the fake, 2 below the fake, 0 no difference, 0 inconclusive, 2 too few answers to tell, 0 not measured.

find-skills, agent-browser, hyperframes and hyperframes-registry are left out of these counts: their text tasks test the router's written response, not the delegated skill (Report 015 Amendment 1).

Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.

About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts.

The 16 skills the headline counts, by their placebo reading, counts only. In the reader's words, beat the fake is ABOVE_PLACEBO, below the fake is BELOW_PLACEBO, no difference is NO_DIFFERENCE, inconclusive is INCONCLUSIVE, too few answers to tell is UNDERPOWERED, not measured is NOT_MEASURED. The four routers are left out, as the headline leaves them out.

The skill: grill-me

```
---
name: grill-me
description: A relentless interview to sharpen a plan or design.
disable-model-invocation: true
---

Call the Skill tool with "grilling".
```

Its same-length placebo

```
The morning light settled slowly over the hills beyond the old market town. The museum displays a loom that weavers in the district used for linen and wool. 
```

This text ends with one space.

grill-me, the shortest skill counted in the headline (157 bytes), beside its placebo: the same length to the byte, rebuilt from the receipt's seed, length and corpus, with the SHA-256 the receipt seals. [Fake my file](https://driftproofhq.com/placebo/).

## Each skill

In the plan's order. Each row is one receipt, read by the receipt reader, with the judge's limitation beside it. Each opens on its summary line; open a row for its tasks, bands, notes and receipt.

**find-skills vercel-labs/skills Against the same-length placebo: beat the fake `ABOVE_PLACEBO` (a router, left out of the headline count) Against no skill: No verdict: delegated skill not tested.**

### find-skills vercel-labs/skills

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1). Left out of the headline count.

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- search (underpowered): with the skill 0.8 plus or minus 0; with the same-length placebo 0.8 plus or minus 0.05.
- missing (separated-up): with the skill 0.9 plus or minus 0.095743; with the same-length placebo 0.716667 plus or minus 0.028868.
- scope (underpowered): with the skill 0.85 plus or minus 0.057735; with the same-length placebo 0.866667 plus or minus 0.028868.

Against no skill: No verdict: delegated skill not tested.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `62dc3eb753192c43c0dbae28aae9f4a7a901f93316437a134864024ecb12ccc9`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**grill-me mattpocock/skills Against the same-length placebo: below the fake `BELOW_PLACEBO` Against no skill: The skill clearly helped: 0.710 with it and 0.710 without, on 3 test tasks.**

### grill-me mattpocock/skills

About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts.

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- plan (underpowered): with the skill 0.875 plus or minus 0.086603; with the same-length placebo 0.8 plus or minus 0.15.
- constraint (underpowered): with the skill 0.56875 plus or minus 0.155695; with the same-length placebo 0.7 plus or minus 0.057735.
- followup (separated-down): with the skill 0.6875 plus or minus 0.062915; with the same-length placebo 0.87 plus or minus 0.075829.

Against no skill: The skill clearly helped: 0.710 with it and 0.710 without, on 3 test tasks.

0.710 with the skill and 0.710 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- plan (separated-up): with the skill 0.875 plus or minus 0.086603; without it 0.716667 plus or minus 0.028868.
- constraint (underpowered): with the skill 0.56875 plus or minus 0.155695; without it 0.564286 plus or minus 0.137581.
- followup (underpowered): with the skill 0.6875 plus or minus 0.062915; without it 0.85 plus or minus 0.104083.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `c5f6d257f7ed8cf90e179dc97a94245d5e61e023cb4b42339d70e9d77979665d`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**grill-with-docs mattpocock/skills Against the same-length placebo: too few answers to tell `UNDERPOWERED` Against no skill: Too few answers to tell: 0.870 with the skill and 0.865 without, but the scores varied too much to call it.**

### grill-with-docs mattpocock/skills

About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts.

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- decision (underpowered): with the skill 0.88 plus or minus 0.120416; with the same-length placebo 0.966667 plus or minus 0.028868.
- adr (underpowered): with the skill 0.9 plus or minus 0.05; with the same-length placebo 0.925 plus or minus 0.086603.
- revision (underpowered): with the skill 0.83 plus or minus 0.097468; with the same-length placebo 0.77 plus or minus 0.075829.

Against no skill: Too few answers to tell: 0.870 with the skill and 0.865 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case decision: the two arms' spreads sum to 0.236, at or above the 0.05 floor).

- decision (underpowered): with the skill 0.88 plus or minus 0.120416; without it 0.87 plus or minus 0.115109.
- adr (underpowered): with the skill 0.9 plus or minus 0.05; without it 0.9375 plus or minus 0.047871.
- revision (underpowered): with the skill 0.83 plus or minus 0.097468; without it 0.7875 plus or minus 0.085391.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `d10a6870927d28f0655df316c2cb95752667fdc6df93560c7ff4447538095ef6`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**agent-browser vercel-labs/agent-browser Against the same-length placebo: too few answers to tell `UNDERPOWERED` (a router, left out of the headline count) Against no skill: No verdict: delegated skill not tested.**

### agent-browser vercel-labs/agent-browser

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1). Left out of the headline count.

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- web (underpowered): with the skill 0.89 plus or minus 0.082158; with the same-length placebo 0.75 plus or minus 0.158114.
- desktop (underpowered): with the skill 0.7 plus or minus 0.05; with the same-length placebo 0.577778 plus or minus 0.203272.
- dashboard (underpowered): with the skill 0.725 plus or minus 0.15; with the same-length placebo 0.54 plus or minus 0.082158.

Against no skill: No verdict: delegated skill not tested.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `02dce995f39328ca851e2fc448150d32e07dbb573e9e3196f97c1b2ff6a65b09`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**improve-codebase-architecture mattpocock/skills Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly helped: 0.778 with it and 0.546 without, on 3 test tasks.**

### improve-codebase-architecture mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- candidate (separated-up): with the skill 0.725 plus or minus 0.05; with the same-length placebo 0.5375 plus or minus 0.118145.
- adr (underpowered): with the skill 0.741667 plus or minus 0.091742; with the same-length placebo 0.733333 plus or minus 0.028868.
- report (separated-up): with the skill 0.866667 plus or minus 0.028868; with the same-length placebo 0.466667 plus or minus 0.028868.

Against no skill: The skill clearly helped: 0.778 with it and 0.546 without, on 3 test tasks.

0.778 with the skill and 0.546 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- candidate (separated-up): with the skill 0.725 plus or minus 0.05; without it 0.5 plus or minus 0.05.
- adr (underpowered): with the skill 0.741667 plus or minus 0.091742; without it 0.666667 plus or minus 0.028868.
- report (separated-up): with the skill 0.866667 plus or minus 0.028868; without it 0.47 plus or minus 0.120416.

The placebo against no skill, shown here and not counted: PLACEBO_ABOVE_BASELINE

Receipt `c1c2abfd0a6ed0e40c98ab4e4eb970ff2e1b40fc67d5ab6c396bf583f5eafc13`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**tdd mattpocock/skills Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: Too few answers to tell: 0.974 with the skill and 0.956 without, but the scores varied too much to call it.**

### tdd mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- test (underpowered): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.966667 plus or minus 0.028868.
- coupling (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- agreement (separated-up): with the skill 0.94 plus or minus 0.054772; with the same-length placebo 0.758333 plus or minus 0.09704.

Against no skill: Too few answers to tell: 0.974 with the skill and 0.956 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case agreement: the two arms' spreads sum to 0.148, at or above the 0.05 floor).

- test (underpowered): with the skill 0.983333 plus or minus 0.028868; without it 1 plus or minus 0.
- coupling (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- agreement (underpowered): with the skill 0.94 plus or minus 0.054772; without it 0.866667 plus or minus 0.093095.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `d7f7ac521e64f6adf6147089300f3bbf1f0feeb57f45b63eddfb42396379dfd6`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**hyperframes-cli heygen-com/hyperframes Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly helped: 0.904 with it and 0.340 without, on 3 test tasks.**

### hyperframes-cli heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- loop (separated-up): with the skill 0.9375 plus or minus 0.075; with the same-length placebo 0.283333 plus or minus 0.15411.
- timeline (separated-up): with the skill 0.95 plus or minus 0.05; with the same-length placebo 0.57 plus or minus 0.115109.
- render (separated-up): with the skill 0.825 plus or minus 0.086603; with the same-length placebo 0.266667 plus or minus 0.028868.

Against no skill: The skill clearly helped: 0.904 with it and 0.340 without, on 3 test tasks.

0.904 with the skill and 0.340 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- loop (separated-up): with the skill 0.9375 plus or minus 0.075; without it 0.52 plus or minus 0.181353.
- timeline (separated-up): with the skill 0.95 plus or minus 0.05; without it 0.25 plus or minus 0.122474.
- render (separated-up): with the skill 0.825 plus or minus 0.086603; without it 0.25 plus or minus 0.05.

The placebo against no skill, shown here and not counted: PLACEBO_ABOVE_BASELINE

Receipt `0f244fae953a7bc2b45d8c43c8a89a2792fec792ab12d8d67072c58308c70d61`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**hyperframes heygen-com/hyperframes Against the same-length placebo: below the fake `BELOW_PLACEBO` (a router, left out of the headline count) Against no skill: No verdict: delegated skill not tested.**

### hyperframes heygen-com/hyperframes

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1). Left out of the headline count.

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- existing (separated-down): with the skill 0.4625 plus or minus 0.047871; with the same-length placebo 0.61 plus or minus 0.082158.
- usage (underpowered): with the skill 0.833333 plus or minus 0.08756; with the same-length placebo 0.691667 plus or minus 0.124164.
- port (separated-down): with the skill 0.875 plus or minus 0.086603; with the same-length placebo 1 plus or minus 0.

Against no skill: No verdict: delegated skill not tested.

The placebo against no skill, shown here and not counted: PLACEBO_ABOVE_BASELINE

Receipt `33390df9eb2f0a0dab9e2503b76ace3ec5c035a0f3c409420b730f28deed7852`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**setup-matt-pocock-skills mattpocock/skills Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly helped: 0.857 with it and 0.647 without, on 3 test tasks.**

### setup-matt-pocock-skills mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- local (separated-up): with the skill 0.908333 plus or minus 0.091742; with the same-length placebo 0.508333 plus or minus 0.08612.
- labels (separated-up): with the skill 0.83 plus or minus 0.164317; with the same-length placebo 0.575 plus or minus 0.086603.
- monorepo (separated-up): with the skill 0.833333 plus or minus 0.028868; with the same-length placebo 0.675 plus or minus 0.05.

Against no skill: The skill clearly helped: 0.857 with it and 0.647 without, on 3 test tasks.

0.857 with the skill and 0.647 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- local (separated-up): with the skill 0.908333 plus or minus 0.091742; without it 0.525 plus or minus 0.125357.
- labels (underpowered): with the skill 0.83 plus or minus 0.164317; without it 0.716667 plus or minus 0.028868.
- monorepo (separated-up): with the skill 0.833333 plus or minus 0.028868; without it 0.7 plus or minus 0.057735.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `38085c42377c6d290dae20572014efe3e9700024fd3bb83ecbda9be3bda316e7`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**handoff mattpocock/skills Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: Too few answers to tell: 0.818 with the skill and 0.758 without, but the scores varied too much to call it.**

### handoff mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- resume (underpowered): with the skill 0.725 plus or minus 0.05; with the same-length placebo 0.72 plus or minus 0.057009.
- privacy (underpowered): with the skill 0.828571 plus or minus 0.090633; with the same-length placebo 0.91 plus or minus 0.082158.
- destination (separated-up): with the skill 0.9 plus or minus 0.11547; with the same-length placebo 0.66 plus or minus 0.054772.

Against no skill: Too few answers to tell: 0.818 with the skill and 0.758 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case resume: the two arms' spreads sum to 0.079, at or above the 0.05 floor).

- resume (underpowered): with the skill 0.725 plus or minus 0.05; without it 0.733333 plus or minus 0.028868.
- privacy (underpowered): with the skill 0.828571 plus or minus 0.090633; without it 0.87 plus or minus 0.09083.
- destination (underpowered): with the skill 0.9 plus or minus 0.11547; without it 0.67 plus or minus 0.115109.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `255186420fbabfe851c85b70f7768dad055ecd29fedd0c98b473a9edd181fe57`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**frontend-design anthropics/skills Against the same-length placebo: below the fake `BELOW_PLACEBO` Against no skill: The skill clearly hurt: 0.883 with it and 0.865 without, on 3 test tasks.**

### frontend-design anthropics/skills

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- identity (separated-down): with the skill 0.9125 plus or minus 0.075; with the same-length placebo 1 plus or minus 0.
- brief (separated-up): with the skill 0.966667 plus or minus 0.028868; with the same-length placebo 0.483333 plus or minus 0.121106.
- content (underpowered): with the skill 0.77 plus or minus 0.15248; with the same-length placebo 0.766667 plus or minus 0.028868.

Against no skill: The skill clearly hurt: 0.883 with it and 0.865 without, on 3 test tasks.

0.883 with the skill and 0.865 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- identity (separated-down): with the skill 0.9125 plus or minus 0.075; without it 1 plus or minus 0.
- brief (underpowered): with the skill 0.966667 plus or minus 0.028868; without it 0.814286 plus or minus 0.177281.
- content (underpowered): with the skill 0.77 plus or minus 0.15248; without it 0.78 plus or minus 0.115109.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `c130a9fcadfdd7ee6cc75f3d3523f2fdb408721574caf5ac6d07032411adca55`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**reddit-automation flowkit-labs/skills Against the same-length placebo: too few answers to tell `UNDERPOWERED` Against no skill: Too few answers to tell: 0.770 with the skill and 0.794 without, but the scores varied too much to call it.**

### reddit-automation flowkit-labs/skills

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- rank (underpowered): with the skill 0.85 plus or minus 0.070711; with the same-length placebo 0.825 plus or minus 0.086603.
- reply (underpowered): with the skill 0.741667 plus or minus 0.080104; with the same-length placebo 0.783333 plus or minus 0.093095.
- rules (underpowered): with the skill 0.71875 plus or minus 0.151038; with the same-length placebo 0.725 plus or minus 0.05.

Against no skill: Too few answers to tell: 0.770 with the skill and 0.794 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case rank: the two arms' spreads sum to 0.121, at or above the 0.05 floor).

- rank (underpowered): with the skill 0.85 plus or minus 0.070711; without it 0.9 plus or minus 0.05.
- reply (underpowered): with the skill 0.741667 plus or minus 0.080104; without it 0.733333 plus or minus 0.028868.
- rules (underpowered): with the skill 0.71875 plus or minus 0.151038; without it 0.75 plus or minus 0.070711.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `be3706cb75cfc7cb8c8b82a708a0e9d2fec8398d38e443841f2d819fecbb2ac0`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**triage mattpocock/skills Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly helped: 0.854 with it and 0.624 without, on 3 test tasks.**

### triage mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- conflict (separated-up): with the skill 0.883333 plus or minus 0.08165; with the same-length placebo 0.616667 plus or minus 0.028868.
- evidence (underpowered): with the skill 0.8 plus or minus 0.061237; with the same-length placebo 0.775 plus or minus 0.05.
- ready (separated-up): with the skill 0.88 plus or minus 0.115109; with the same-length placebo 0.5 plus or minus 0.

Against no skill: The skill clearly helped: 0.854 with it and 0.624 without, on 3 test tasks.

0.854 with the skill and 0.624 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- conflict (underpowered): with the skill 0.883333 plus or minus 0.08165; without it 0.692857 plus or minus 0.136713.
- evidence (underpowered): with the skill 0.8 plus or minus 0.061237; without it 0.78 plus or minus 0.164317.
- ready (separated-up): with the skill 0.88 plus or minus 0.115109; without it 0.4 plus or minus 0.11547.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `6e3e4f32ce47371211e9c3b0972b8e969bd1fb43fa9637a46ae336dad04b3f97`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**prototype mattpocock/skills Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly helped: 0.740 with it and 0.342 without, on 3 test tasks.**

### prototype mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- logic (underpowered): with the skill 0.64375 plus or minus 0.184076; with the same-length placebo 0.391667 plus or minus 0.102062.
- ui (separated-up): with the skill 0.841667 plus or minus 0.139344; with the same-length placebo 0.09 plus or minus 0.108397.
- unclear (separated-up): with the skill 0.733333 plus or minus 0.028868; with the same-length placebo 0.4125 plus or minus 0.131498.

Against no skill: The skill clearly helped: 0.740 with it and 0.342 without, on 3 test tasks.

0.740 with the skill and 0.342 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- logic (separated-up): with the skill 0.64375 plus or minus 0.184076; without it 0.416667 plus or minus 0.028868.
- ui (separated-up): with the skill 0.841667 plus or minus 0.139344; without it 0.208333 plus or minus 0.131972.
- unclear (separated-up): with the skill 0.733333 plus or minus 0.028868; without it 0.4 plus or minus 0.05.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `40160d77f9e761754f7c41703fcadaf31424dd6d7c8fc0291991bb08c14d5fbb`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**media-use heygen-com/hyperframes Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly helped: 0.846 with it and 0.740 without, on 3 test tasks.**

### media-use heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- reuse (separated-up): with the skill 0.675 plus or minus 0.086603; with the same-length placebo 0.516667 plus or minus 0.028868.
- logo (underpowered): with the skill 0.8875 plus or minus 0.094648; with the same-length placebo 0.91 plus or minus 0.134164.
- grade (separated-up): with the skill 0.975 plus or minus 0.05; with the same-length placebo 0.83 plus or minus 0.083666.

Against no skill: The skill clearly helped: 0.846 with it and 0.740 without, on 3 test tasks.

0.846 with the skill and 0.740 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- reuse (underpowered): with the skill 0.675 plus or minus 0.086603; without it 0.5375 plus or minus 0.085391.
- logo (underpowered): with the skill 0.8875 plus or minus 0.094648; without it 0.8875 plus or minus 0.143614.
- grade (separated-up): with the skill 0.975 plus or minus 0.05; without it 0.79375 plus or minus 0.111604.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `2c37963a2ebaf2d367acf79e65d71090dd748c7fc852e8e1f603caef2f7f1af8`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**grilling mattpocock/skills Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly hurt: 0.569 with it and 0.542 without, on 3 test tasks.**

### grilling mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- frontier (underpowered): with the skill 0.75 plus or minus 0.234521; with the same-length placebo 0.75 plus or minus 0.
- settled (underpowered): with the skill 0.483333 plus or minus 0.028868; with the same-length placebo 0.52 plus or minus 0.103682.
- finish (separated-up): with the skill 0.475 plus or minus 0.108397; with the same-length placebo 0.1625 plus or minus 0.047871.

Against no skill: The skill clearly hurt: 0.569 with it and 0.542 without, on 3 test tasks.

0.569 with the skill and 0.542 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- frontier (underpowered): with the skill 0.75 plus or minus 0.234521; without it 0.68 plus or minus 0.075829.
- settled (separated-down): with the skill 0.483333 plus or minus 0.028868; without it 0.61 plus or minus 0.089443.
- finish (underpowered): with the skill 0.475 plus or minus 0.108397; without it 0.3375 plus or minus 0.094648.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `3e658346c86911686393b4cba84299311be780e63388ccf6084e8611bcddb960`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**hyperframes-animation heygen-com/hyperframes Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly helped: 0.764 with it and 0.522 without, on 3 test tasks.**

### hyperframes-animation heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- timeline (underpowered): with the skill 1 plus or minus 0; with the same-length placebo 0.907143 plus or minus 0.113389.
- runtime (separated-up): with the skill 0.414286 plus or minus 0.134519; with the same-length placebo 0.0375 plus or minus 0.047871.
- template (separated-up): with the skill 0.878571 plus or minus 0.11127; with the same-length placebo 0.533333 plus or minus 0.143759.

Against no skill: The skill clearly helped: 0.764 with it and 0.522 without, on 3 test tasks.

0.764 with the skill and 0.522 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- timeline (separated-up): with the skill 1 plus or minus 0; without it 0.78 plus or minus 0.171756.
- runtime (separated-up): with the skill 0.414286 plus or minus 0.134519; without it 0.175 plus or minus 0.086603.
- template (separated-up): with the skill 0.878571 plus or minus 0.11127; without it 0.6125 plus or minus 0.110868.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `29d5d823dda1a927be2dbc4269e7358cbab6a118e651f764935025c8bb5dad77`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**hyperframes-registry heygen-com/hyperframes Against the same-length placebo: beat the fake `ABOVE_PLACEBO` (a router, left out of the headline count) Against no skill: No verdict: delegated skill not tested.**

### hyperframes-registry heygen-com/hyperframes

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1). Left out of the headline count.

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- block (separated-up): with the skill 0.75 plus or minus 0.05; with the same-length placebo 0.35 plus or minus 0.108012.
- component (separated-up): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.05 plus or minus 0.05.
- search (separated-up): with the skill 0.95 plus or minus 0.057735; with the same-length placebo 0.333333 plus or minus 0.028868.

Against no skill: No verdict: delegated skill not tested.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `d6a1349519982f7b868d0833c1d7d553796557f5d8e873ae40e11a31d2b2d95d`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**design-mobile-apps designed-by-ai/skills Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly helped: 0.761 with it and 0.647 without, on 3 test tasks.**

### design-mobile-apps designed-by-ai/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- response (underpowered): with the skill 0.75 plus or minus 0.070711; with the same-length placebo 0.72 plus or minus 0.168077.
- shots (underpowered): with the skill 0.82 plus or minus 0.115109; with the same-length placebo 0.675 plus or minus 0.086603.
- ids (separated-up): with the skill 0.7125 plus or minus 0.047871; with the same-length placebo 0.4 plus or minus 0.231455.

Against no skill: The skill clearly helped: 0.761 with it and 0.647 without, on 3 test tasks.

0.761 with the skill and 0.647 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- response (underpowered): with the skill 0.75 plus or minus 0.070711; without it 0.758333 plus or minus 0.09704.
- shots (underpowered): with the skill 0.82 plus or minus 0.115109; without it 0.733333 plus or minus 0.028868.
- ids (separated-up): with the skill 0.7125 plus or minus 0.047871; without it 0.45 plus or minus 0.05.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `3537eea8448e3369af25af6905504a8e887ba8ed6215728f37da34d05295b569`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

**hyperframes-core heygen-com/hyperframes Against the same-length placebo: beat the fake `ABOVE_PLACEBO` Against no skill: The skill clearly helped: 0.890 with it and 0.579 without, on 3 test tasks.**

### hyperframes-core heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- root (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.933333 plus or minus 0.028868.
- transform (separated-up): with the skill 0.9375 plus or minus 0.047871; with the same-length placebo 0.7375 plus or minus 0.062915.
- exit (separated-up): with the skill 0.733333 plus or minus 0.028868; with the same-length placebo 0.171429 plus or minus 0.167971.

Against no skill: The skill clearly helped: 0.890 with it and 0.579 without, on 3 test tasks.

0.890 with the skill and 0.579 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- root (separated-up): with the skill 1 plus or minus 0; without it 0.7625 plus or minus 0.075.
- transform (separated-up): with the skill 0.9375 plus or minus 0.047871; without it 0.75 plus or minus 0.
- exit (separated-up): with the skill 0.733333 plus or minus 0.028868; without it 0.225 plus or minus 0.086603.

The placebo against no skill, shown here and not counted: PLACEBO_ABOVE_BASELINE

Receipt `0d793c26e9706e2a40d37f7c109f2c8250ce87114f9cdf0eb6173c95060c63ef`

The judge uses the same model as the target. Self-grading may favor its own model's answers.

## Method

These sections are the pre-registered note, as the campaign first stored it.

### What each receipt shows

Each of the 20 frozen attempts runs one skill of Report 017's frozen roster, the same pinned skill bytes and the same committed three-task suite, on claude-haiku-5-5, graded by claude-haiku-5-5, with three arms: the skill text, no skill, and a text of the skill's length in bytes from the revision 1 fixed corpus (spec 440).

The report shows two readings for each receipt, each in lib/verdict.js's own words:

- the verdict: `receiptVerdict`, the skill against no skill, in the receipt reader's words;
- the placebo reading: `placeboLine(placeboReading(receipt))`, the skill against the same-length text.

The verdict shown is the Report 018 receipt's own. The verdict reads only the skill and no-skill arms, so the placebo arm's replies move it in no way. No figure other than these readings and their counts enters the headline.

### The judge

The judge is claude-haiku-5-5, the judge the judge policy fixes for the reports Driftproof publishes: "That judge is fixed at claude-haiku-5-5 and changed only rarely" (/judge-policy/). Report 017 was graded by the same judge. No judge policy or registry entry moves for this plan.

The target is also claude-haiku-5-5, the same-model relationship Report 016's Sonnet receipts sealed. A text-capture receipt carries no `run.judge.relationship` field, so the plan carries the limitation instead: plan.json pins it as `judge_relationship`, derived by lib/receipt.js from the frozen target and judge, and the publication reader attaches it to every row. The page says it before any reading and with every reading, in the receipt reader's own words: "The judge uses the same model as the target. Self-grading may favor its own model's answers." It says nothing about judge accuracy.

### Report 018 stands alone

The page and every Report 018 claim show no Report 017 or Report 015 reading, verdict, count or figure. One methods sentence names the design and what changed: Report 017's same-length placebo design, the same twenty skills, suites and placebo corpus, with claude-haiku-5-5 answering in place of claude-sonnet-5-5, graded by the same fixed judge. The judge policy holds that "results scored by different graders are not compared directly"; here the grader is the same, and the target is not, so the report compares nothing across the two reports: it does not subtract one reading from another, does not count skills that moved, and does not say which model a skill helps more.

### Which receipt is read

The report reads exactly one sealed receipt per attempt id. It is the receipt the campaign's manifest chain records for that attempt, read through the campaign ledger. The first completed receipt is the only one: an attempt with a sealed receipt is never run again, and a second receipt for the same attempt id refuses the whole chain. No receipt is chosen after its results are seen.

An attempt without a receipt may be run again in a later invocation of the same frozen plan, at most three runs in all, its earlier costs counted against the USD 30 cap. Every failure stays in the ledger. A failure carries no reading, so running it again chooses nothing.

The campaign has one root directory. It keeps the plan and this note as first started and an append-only log with one line per start. A second start with no prior chain is refused, and a resume must continue the log's latest manifest. The report reads only the chain that ends at the log's latest manifest, and refuses if the root holds any other manifest under this plan. A cost correction may be added after a run and is never rewritten: each manifest records the corrections in force when it started.

### Terms

"Beat the fake" means exactly one thing: the placebo reading is `ABOVE_PLACEBO`. In the reader's words, "case rule: at least one case scored above the same-length placebo, and none below". The case rule reads each of the three tasks by its draw bands, so this says no more than that, on at least one of three tasks, the skill's band sat above the placebo's at the effect floor, and on none below.

No other reading beats the fake. `BELOW_PLACEBO`, `NO_DIFFERENCE`, `INCONCLUSIVE`, `UNDERPOWERED` and `NOT_MEASURED` do not. None of them shows that a skill does no better than the fake.

A missing receipt reads `NOT_MEASURED`: a failed, cancelled or budget-stopped attempt is counted as not read, never as a result. A stub receipt also reads `NOT_MEASURED`.

### Who is counted

The four routers are find-skills, agent-browser, hyperframes and hyperframes-registry. They carry Report 015 Amendment 1's qualification: their text tasks test the router's written response, not the delegated skill. Their readings are shown with that qualification. They are left out of the headline count, as Report 015 and Report 017 leave them out.

The headline counts the other 16 skills. N is 16.

### The hand-off skills

grill-me and grill-with-docs each have a whole text that only calls another skill, by the rule of `scripts/skill-handoff.js` (issue 642, Report 017 Amendment 1). These text tasks forbid tools, so each of their readings reflects that one-line hand-off, not the skill it calls. Both stay in the 16, as Maverick's ruling of 2 Nov 2026 kept them in Report 017's counts. The report shows the hand-off note in each of their rows and after the headline caveat, in that rule's words. The note carries no count and no verdict word.

The plan names the two attempts and the rule. The builder refuses a named text that does not pass the rule or whose bytes are not the attempt's pin. Before any call, the preflight applies the rule to all 20 supplied texts, and refuses unless the texts that pass it are exactly these two: a third hand-off skill, or one of these two no longer handing off, is a new plan, not a run.

### The secondary reading

Beside each skill, and never in the headline, the report shows a second reading: the same case rule over the placebo's rows against the no-skill rows of the same receipt (spec 613's `tally.cjs` `secondaryReading`). Its tokens are `PLACEBO_ABOVE_BASELINE`, `PLACEBO_BELOW_BASELINE`, `NO_DIFFERENCE`, `INCONCLUSIVE`, `UNDERPOWERED` and `NOT_MEASURED`. It is read only where the placebo reading is read, and refused wherever that is refused. It is not counted, not subtracted from the placebo reading, and not combined with it.

## Limits

It does not show how these skills do beyond three text tasks each, written by Driftproof for the twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Haiku 5.5 judged by Claude Haiku 5.5.

Three text-only tasks. Driftproof wrote the suite from the pinned skill description and README. These are not author-supplied tests. External tools, generated media and deployed services were not tested.

The eval account's configuration was read and found clean before and after each run, not during it.

For find-skills, agent-browser, hyperframes and hyperframes-registry: This tests the router's written response; it does not test the delegated skill.

The judge is the target's model. Self-grading may favor its own model's answers, in every arm alike; the report shows the limitation and claims nothing about judge accuracy.

The placebo text is not inert: on a task that supplies the facts its answer needs, a same-length text about landscape and village life can pull an answer off them, so the fake can score below no skill. The secondary reading shows where it did.

The projection in plan.json reprices Report 017's recorded tokens at Haiku 5.5 rates for generation and judging. Haiku 5.5 may answer at another length and draw another number of times, so the projection is a planning assumption, not a bound. The cap and each attempt's ceiling are the bounds.

It does not say why a skill helps, that a skill and the fake are the same, or that the fake carries no information about a task. It says nothing about a skill that was not run with the placebo arm. It does not combine the 20 readings into one score. It does not say how Haiku 5.5 and Sonnet 5.5 compare: no reading, verdict or count of Report 017 or Report 015 appears on the page or in any Report 018 claim.

The placebo corpus was chosen without reference to any task, so a placebo text can still bear on a task by chance.

Unkeyed seals and retained outputs permit checking internal consistency; they do not authenticate an origin.

## Run record

One campaign root, `receipts/report-018`, read from the latest manifest its log names. 20 of 20 attempts have a sealed receipt; every other attempt is a recorded failure and reads NOT_MEASURED. The earliest receipt date is 2026-11-02 and the latest 2026-11-02. No finish time is inferred.

The surface was claude-cli. Recorded spend across the chain: USD 5.210104. Recorded costs are API-equivalent estimates, not a subscription invoice.

1. `receipts/report-018/campaign-1/manifest.json`, SHA-256 `6e4e2b4b15908c482d91ec5d46ff7c03ef258a471e98e934e5d518df3e8c2bd4`
2. `receipts/report-018/campaign-2/manifest.json`, SHA-256 `c2451ea80e20cc433c3a891f5b1408fccd005d6df373cd6b1508172cc77145dc`
3. `receipts/report-018/campaign-3/manifest.json`, SHA-256 `31bf40beeac30b0bfd156e71ead17f8fd5719a016bb3176aefc04124d83bf5be`

Plan SHA-256 `5aff61a014ddfca16def8bc4097201677cb1132fa174c879e71c30279294c4c7`. Pre-registered note SHA-256 `4f55a80e3311558d22652072f8c91e02a7ba5d51d7c01330329df0dfc12197d3`.

Read and built by:

- `scripts/prepare-report-018.js`, SHA-256 `a6bf9f594c81e0f4236c991ab652c6b8516878814ec94b1e1ddf6c8398b27809`
- `specs/655-report-018-plan/run-campaign.cjs`, SHA-256 `0e76a3d994e0d16ef956fd40af659231b1d799e5950cc854e9657164620cd94f`
- `specs/655-report-018-plan/protocol.cjs`, SHA-256 `d0753f55970aca3dc3743665fca624fc183530a2a5f580cff2b7b9cd4f38763e`
- `specs/613-placebo-skills-report/run-campaign.cjs`, SHA-256 `db070608736eb9401fb8acf6a15cf800deeefbd706b18a92383242ef6609af6a`
- `specs/613-placebo-skills-report/tally.cjs`, SHA-256 `a7d334796f32591a9488baa2286e3ba9462305ff6a92b8b2f0c7695a96a415dd`
- `specs/408-skill-measurements/ledger.cjs`, SHA-256 `263a3d3423feea70aaf90074a58bcaf48d4ddb8b0eea262ec634450b17b63aae`
- `specs/408-skill-measurements/reconstruct.cjs`, SHA-256 `f64871c647c3482a0d05e6a2308a05192b5934816097978ece34d553a360f2dd`
- `lib/verdict.js`, SHA-256 `336cacca9ab4f80797de2ad12da8b393984843863f37e6839929aa8d44859ce8`
- `lib/plain.js`, SHA-256 `5b7ea12440dd78212128dabe28c33f7fabc97d06756080e233c1f95547732fb2`
- `lib/placebo.js`, SHA-256 `f9511bdbb9928f615017addebfa305b1f7b27c544cc5dbd377e668d661be26a0`
- `lib/receipt.js`, SHA-256 `6f4d56e9be11dd8dea52810d458d4c84b3eb188359f834e3bc771f2f3f8605d8`
- `scripts/skill-handoff.js`, SHA-256 `261c15ba3c979f74bf69d4a6f7e192f8458a0b9635b7a17effd8e7cf1d53fda2`

## Receipts

- [find-skills on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/31e236a9103896b1905877ed0e997042a18ec615b8dee14676beedbda441e389.json)
- [grill-me on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/15f184740eeb8f5b8a59bbca38b7874ef631c46764ad7082f0d8b9920d7503fb.json)
- [grill-with-docs on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/6824deb80c68dc4468abbb5632513899800efd9b1e354b98e3c6a1237390fc96.json)
- [agent-browser on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/a0249d04c527d224090444faa7fc00f860683be12e2caf9e1d873b043fbbe37b.json)
- [improve-codebase-architecture on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/b82af8993f7de808d929929f51237c199fed5b77070457ad5063862817bd3c15.json)
- [tdd on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/01a1a4d088c9eadbc2517089778a286cf77017e9a868d4d0c250fd33f6bb08a4.json)
- [hyperframes-cli on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/1460f2fbadb049e68e4b07c2a0628f83ebd89ff596b1dcf7f30a8d6b7bd35e33.json)
- [hyperframes on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/42a1bfdbfcf756ded6e04980d5c32e534346f195e7207c460b8dbd1d6c354479.json)
- [setup-matt-pocock-skills on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/631cae5f531ab2ae0285bbc99e8ca42b2694abc79d0e1cd5626101a93b6dea0f.json)
- [handoff on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/535870454c90a44c05d5a0b2920d9f3895dd4a6f7513ea82c0f89387087d9786.json)
- [frontend-design on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/9ab2dca4053dd9795f27a7aff1270acf30494f31e1cf2b294f11e9650adcd98d.json)
- [reddit-automation on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/c7bc4e48be8fd9fd6f1cf966096fc6b415e7dfbd57d9c017f0bc9d8032c678f2.json)
- [triage on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/90573a77432fb1791c87bfd06bc8c4836deb8f3c412531f6daf2013b7ff94459.json)
- [prototype on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/b0b2f8a1ac34754b4496340afafaee588c18fb54fb89ec6b2f577a26db672fd6.json)
- [media-use on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/df0981cc067afdab06c17e35cd97b32dc3bfae5fb2e5cc5d88cf027138a865ae.json)
- [grilling on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/6911cfc88cf2c6e8ef619b12fa5c82af02bc4eb5c303230bf30cba2eb9551fc8.json)
- [hyperframes-animation on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/45a1959df0f15f4d75eb60384627c13e3dd96701be4b624260dbe9f4e77d3c03.json)
- [hyperframes-registry on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/be23053e8d31b8d8e3341ededefdab4521da7e2f717b5e993dd17dd1afceb7a5.json)
- [design-mobile-apps on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/ce33fb8bbfc2428ea3bb4f7c0cb98b7ff656045901c6465ed4099c795c8c102e.json)
- [hyperframes-core on Claude Haiku 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-018/campaign-3/7d49184622855ca5fb40c0581fd05c178c88eacd2c4abc9dea8c3d15b6ca7005.json)
