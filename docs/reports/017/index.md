# Skill or sugar pill? Twenty skills against a same-length placebo

Canonical: <https://driftproofhq.com/reports/017/>

## What did Report 017 find?

- **What we tested.** Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5.
- **What we found.** On Claude Sonnet 5.5, 11 of 16 skills beat the fake: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none. A skill that did not beat the fake is not shown to do no better than it.
- **Beating the fake is not beating no skill.** Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.
- **What it does not show.** It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5.

Report 017: Placebo comparison, claude-sonnet-5-5

Type Placebo comparison report

What moved a same-length placebo text

Models `claude-sonnet-5-5`

Headline On Claude Sonnet 5.5, 11 of 16 skills beat the fake: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none.

Receipts [20 linked receipts](https://driftproofhq.com/reports/017/#receipts)

**Cite this**

```
@techreport{driftproof-017,
  title  = {Skill or sugar pill? Twenty skills against a same-length placebo},
  author = {Driftproof},
  year   = {2026},
  type   = {Placebo comparison report},
  note   = {claude-sonnet-5-5},
  url    = {https://driftproofhq.com/reports/017/}
}
```

Report 017. Recorded on 1 Nov 2026. Answering model Claude Sonnet 5.5; judge Claude Haiku 5.5.

Placebo comparison report. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5.

On Claude Sonnet 5.5, 11 of 16 skills beat the fake: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none. A skill that did not beat the fake is not shown to do no better than it.

Of the 16: ABOVE_PLACEBO 11, BELOW_PLACEBO 3, NO_DIFFERENCE 0, INCONCLUSIVE 0, UNDERPOWERED 2, NOT_MEASURED 0. Beat the fake means ABOVE_PLACEBO only.

find-skills, agent-browser, hyperframes and hyperframes-registry are left out of these counts: their text tasks test the router's written response, not the delegated skill (Report 015 Amendment 1).

Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.

About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts.

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

[Can you tell which answer had the skill? Try a blind read of handoff's kept answers](https://driftproofhq.com/reports/017/blind/).

## Each skill

In Report 015's order. Each row is one receipt, read by the receipt reader.

### find-skills vercel-labs/skills

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1). Left out of the headline count.

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- search (separated-down): with the skill 0.75 plus or minus 0.05; with the same-length placebo 0.9125 plus or minus 0.075.
- missing (underpowered): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.9 plus or minus 0.11547.
- scope (underpowered): with the skill 0.85 plus or minus 0.070711; with the same-length placebo 0.95 plus or minus 0.05.

Against no skill: No verdict: delegated skill not tested.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: No verdict: delegated skill not tested. [Report 015 receipt](https://driftproofhq.com/r/e2403573b7370d33e8b7d18f8287d7a90abe1ed18feb1cab482baa909f0b7b67/)

Receipt `1dba083778de982f27fcbfa8e3bde3fc03c91802316ba58a2137deae5ef23c30`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-1dba083778de982f.1a5c532b.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, find-skills (vercel-labs/skills), Report 017, 2026-11-01. On at least one task it scored below the fake. Against no skill: No verdict: delegated skill not tested. These text tasks test the router's written response, not the delegated skill. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/1dba083778de982f27fcbfa8e3bde3fc03c91802316ba58a2137deae5ef23c30/

[Why a router gets no verdict: Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1)

Keep this whole message together so the limits travel with the result.

### grill-me mattpocock/skills

About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts.

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- plan (underpowered): with the skill 0.866667 plus or minus 0.132916; with the same-length placebo 0.791667 plus or minus 0.106849.
- constraint (underpowered): with the skill 0.466667 plus or minus 0.028868; with the same-length placebo 0.58 plus or minus 0.109545.
- followup (underpowered): with the skill 0.7 plus or minus 0.122474; with the same-length placebo 0.841667 plus or minus 0.08612.

Against no skill: The skill clearly hurt: 0.678 with it and 0.749 without, on 3 test tasks.

0.678 with the skill and 0.749 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- plan (underpowered): with the skill 0.866667 plus or minus 0.132916; without it 0.785714 plus or minus 0.131385.
- constraint (underpowered): with the skill 0.466667 plus or minus 0.028868; without it 0.58125 plus or minus 0.116305.
- followup (separated-down): with the skill 0.7 plus or minus 0.122474; without it 0.88 plus or minus 0.057009.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Too few answers to tell. [Report 015 receipt](https://driftproofhq.com/r/0088086baf03cabea487b4555ba4c30ffee50e9e9eb831d856b7b3bb84f43aa5/)

Receipt `ad5aacbe99af3e9356543dc4efe0760dfcf7300aae59a5e173369eaa136e4e96`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-ad5aacbe99af3e93.c7a9ab8e.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, grill-me (mattpocock/skills), Report 017, 2026-11-01. There were too few answers, or they varied too much, to tell it from the fake. Against no skill: The skill clearly hurt: 0.678 with it and 0.749 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts. Receipt: https://driftproofhq.com/r/ad5aacbe99af3e9356543dc4efe0760dfcf7300aae59a5e173369eaa136e4e96/

Keep this whole message together so the limits travel with the result.

### grill-with-docs mattpocock/skills

About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts.

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- decision (separated-down): with the skill 0.75 plus or minus 0; with the same-length placebo 0.9375 plus or minus 0.075.
- adr (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- revision (underpowered): with the skill 0.966667 plus or minus 0.028868; with the same-length placebo 0.8875 plus or minus 0.085391.

Against no skill: The skill clearly hurt: 0.906 with it and 0.922 without, on 3 test tasks.

0.906 with the skill and 0.922 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- decision (separated-down): with the skill 0.75 plus or minus 0; without it 0.91 plus or minus 0.082158.
- adr (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- revision (underpowered): with the skill 0.966667 plus or minus 0.028868; without it 0.857143 plus or minus 0.093223.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly hurt. [Report 015 receipt](https://driftproofhq.com/r/8ff7ff4aa7543fbb0deb23ee464666f7e83b3ec9ec034ba4f46cfcce71b2a8fc/)

Receipt `09e0d9f8092405058e0bde94b23385ca6599266cb018f965edbe4dddedd0ab5b`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-09e0d9f809240505.5c3d08d3.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, grill-with-docs (mattpocock/skills), Report 017, 2026-11-01. On at least one task it scored below the fake. Against no skill: The skill clearly hurt: 0.906 with it and 0.922 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts. Receipt: https://driftproofhq.com/r/09e0d9f8092405058e0bde94b23385ca6599266cb018f965edbe4dddedd0ab5b/

Keep this whole message together so the limits travel with the result.

### agent-browser vercel-labs/agent-browser

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1). Left out of the headline count.

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- web (underpowered): with the skill 0.93 plus or minus 0.057009; with the same-length placebo 0.9 plus or minus 0.070711.
- desktop (underpowered): with the skill 0.821429 plus or minus 0.099403; with the same-length placebo 0.7375 plus or minus 0.047871.
- dashboard (separated-up): with the skill 0.816667 plus or minus 0.028868; with the same-length placebo 0.65 plus or minus 0.108012.

Against no skill: No verdict: delegated skill not tested.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: No verdict: delegated skill not tested. [Report 015 receipt](https://driftproofhq.com/r/f4bce7c9f27d9cfc6add44c9eb1bd239d2d6c55d8131ff95a432eaa8458c47c6/)

Receipt `5c56836a4ec21cb3cda2ad5552f4b4bb53876b72e5a512def9b632a948488a3e`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-5c56836a4ec21cb3.0c028534.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, agent-browser (vercel-labs/agent-browser), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: No verdict: delegated skill not tested. These text tasks test the router's written response, not the delegated skill. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/5c56836a4ec21cb3cda2ad5552f4b4bb53876b72e5a512def9b632a948488a3e/

[Why a router gets no verdict: Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1)

Keep this whole message together so the limits travel with the result.

### improve-codebase-architecture mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- candidate (underpowered): with the skill 0.7 plus or minus 0.061237; with the same-length placebo 0.583333 plus or minus 0.112546.
- adr (separated-up): with the skill 0.95 plus or minus 0; with the same-length placebo 0.7375 plus or minus 0.047871.
- report (separated-up): with the skill 0.7 plus or minus 0; with the same-length placebo 0.616667 plus or minus 0.028868.

Against no skill: The skill clearly helped: 0.783 with it and 0.704 without, on 3 test tasks.

0.783 with the skill and 0.704 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- candidate (underpowered): with the skill 0.7 plus or minus 0.061237; without it 0.6125 plus or minus 0.085391.
- adr (separated-up): with the skill 0.95 plus or minus 0; without it 0.75 plus or minus 0.070711.
- report (underpowered): with the skill 0.7 plus or minus 0; without it 0.75 plus or minus 0.05.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Too few answers to tell. [Report 015 receipt](https://driftproofhq.com/r/63f198b3d801d7a5d008195273b96aad18638c7a45b9e4de71a995525357f82e/)

Receipt `4fba7a9b04033dee6c13a9c615ff264cc2175f10958c0a5ba1ed2aa19d4ad401`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-4fba7a9b04033dee.ee6f51fa.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, improve-codebase-architecture (mattpocock/skills), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped: 0.783 with it and 0.704 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/4fba7a9b04033dee6c13a9c615ff264cc2175f10958c0a5ba1ed2aa19d4ad401/

Keep this whole message together so the limits travel with the result.

### tdd mattpocock/skills

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- test (underpowered): with the skill 1 plus or minus 0; with the same-length placebo 0.983333 plus or minus 0.028868.
- coupling (underpowered): with the skill 1 plus or minus 0; with the same-length placebo 0.983333 plus or minus 0.028868.
- agreement (underpowered): with the skill 0.966667 plus or minus 0.028868; with the same-length placebo 0.95 plus or minus 0.05.

Against no skill: Too few answers to tell: 0.989 with the skill and 0.972 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case agreement: the two arms' spreads sum to 0.058, at or above the 0.05 floor).

- test (underpowered): with the skill 1 plus or minus 0; without it 0.983333 plus or minus 0.028868.
- coupling (underpowered): with the skill 1 plus or minus 0; without it 0.966667 plus or minus 0.028868.
- agreement (underpowered): with the skill 0.966667 plus or minus 0.028868; without it 0.966667 plus or minus 0.028868.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Too few answers to tell. [Report 015 receipt](https://driftproofhq.com/r/b3cd3ced76180ed975ee3b80073889f2f469a350295428e05f4c73e83127a6b8/)

Receipt `8a54b710d73e61ff14ffb7a027676a17b57a5d8077fa08b578b37e307e16a816`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-8a54b710d73e61ff.64017d1e.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, tdd (mattpocock/skills), Report 017, 2026-11-01. There were too few answers, or they varied too much, to tell it from the fake. Against no skill: Too few answers to tell: 0.989 with the skill and 0.972 without, but the scores varied too much to call it. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/8a54b710d73e61ff14ffb7a027676a17b57a5d8077fa08b578b37e307e16a816/

Keep this whole message together so the limits travel with the result.

### hyperframes-cli heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- loop (separated-up): with the skill 0.95 plus or minus 0.05; with the same-length placebo 0.75 plus or minus 0.
- timeline (separated-up): with the skill 0.908333 plus or minus 0.066458; with the same-length placebo 0.428571 plus or minus 0.11127.
- render (separated-up): with the skill 0.9 plus or minus 0; with the same-length placebo 0.528571 plus or minus 0.13496.

Against no skill: The skill clearly helped: 0.919 with it and 0.592 without, on 3 test tasks.

0.919 with the skill and 0.592 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- loop (separated-up): with the skill 0.95 plus or minus 0.05; without it 0.7 plus or minus 0.05.
- timeline (separated-up): with the skill 0.908333 plus or minus 0.066458; without it 0.592857 plus or minus 0.133631.
- render (separated-up): with the skill 0.9 plus or minus 0; without it 0.483333 plus or minus 0.028868.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/643d86919b8b34178b4a0336afa7835ea0e42e061d2265a2898c2c0301063b99/)

Receipt `bd80739ac0b870b4c7be48caf2c2423dbb691bc504314835722e6f7db64a6789`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-bd80739ac0b870b4.3cbd763f.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, hyperframes-cli (heygen-com/hyperframes), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped: 0.919 with it and 0.592 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/bd80739ac0b870b4c7be48caf2c2423dbb691bc504314835722e6f7db64a6789/

Keep this whole message together so the limits travel with the result.

### hyperframes heygen-com/hyperframes

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1). Left out of the headline count.

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- existing (separated-up): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.71 plus or minus 0.054772.
- usage (separated-up): with the skill 0.89 plus or minus 0.074162; with the same-length placebo 0.65 plus or minus 0.158114.
- port (underpowered): with the skill 0.958333 plus or minus 0.080104; with the same-length placebo 0.93 plus or minus 0.057009.

Against no skill: No verdict: delegated skill not tested.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: No verdict: delegated skill not tested. [Report 015 receipt](https://driftproofhq.com/r/0aba83f8316912473981b79d945c81c443f47de415bdac61098b5dac642afdde/)

Receipt `d517dfd71ab89a0dedf89f58b5913b0ef6f2c8eba3778f5c30100ece3d4c533f`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-d517dfd71ab89a0d.ead711ae.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, hyperframes (heygen-com/hyperframes), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: No verdict: delegated skill not tested. These text tasks test the router's written response, not the delegated skill. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/d517dfd71ab89a0dedf89f58b5913b0ef6f2c8eba3778f5c30100ece3d4c533f/

[Why a router gets no verdict: Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1)

Keep this whole message together so the limits travel with the result.

### setup-matt-pocock-skills mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- local (separated-up): with the skill 0.93 plus or minus 0.057009; with the same-length placebo 0.65 plus or minus 0.1.
- labels (underpowered): with the skill 0.8 plus or minus 0.119024; with the same-length placebo 0.642857 plus or minus 0.136713.
- monorepo (underpowered): with the skill 0.95 plus or minus 0.05; with the same-length placebo 0.835714 plus or minus 0.098802.

Against no skill: The skill clearly helped: 0.893 with it and 0.671 without, on 3 test tasks.

0.893 with the skill and 0.671 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- local (separated-up): with the skill 0.93 plus or minus 0.057009; without it 0.591667 plus or minus 0.08612.
- labels (underpowered): with the skill 0.8 plus or minus 0.119024; without it 0.671429 plus or minus 0.121988.
- monorepo (underpowered): with the skill 0.95 plus or minus 0.05; without it 0.75 plus or minus 0.192354.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/6983aa785fcd5d04730835a4a3b24ad45d0692ce4b95521bddaf31150a8e1f86/)

Receipt `176b26bcac810bddb1878dc76b1503232d7ccc6bff62c8e8fb022180f3487c78`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-176b26bcac810bdd.1d25a28a.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, setup-matt-pocock-skills (mattpocock/skills), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped: 0.893 with it and 0.671 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/176b26bcac810bddb1878dc76b1503232d7ccc6bff62c8e8fb022180f3487c78/

Keep this whole message together so the limits travel with the result.

### handoff mattpocock/skills

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- resume (not-separated): with the skill 0.75 plus or minus 0; with the same-length placebo 0.75 plus or minus 0.
- privacy (separated-down): with the skill 0.7375 plus or minus 0.047871; with the same-length placebo 0.95 plus or minus 0.070711.
- destination (underpowered): with the skill 0.81 plus or minus 0.143178; with the same-length placebo 0.733333 plus or minus 0.093095.

Against no skill: The skill clearly hurt: 0.766 with it and 0.804 without, on 3 test tasks.

0.766 with the skill and 0.804 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- resume (underpowered): with the skill 0.75 plus or minus 0; without it 0.733333 plus or minus 0.028868.
- privacy (separated-down): with the skill 0.7375 plus or minus 0.047871; without it 0.93 plus or minus 0.075829.
- destination (underpowered): with the skill 0.81 plus or minus 0.143178; without it 0.75 plus or minus 0.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/4a48502d6e950adac2c40f49b84d5d1f7c3863aa8724cfb3aeb4603f7b3b70d9/)

Receipt `c99347fd5003d4ce8f8af82defa7c3480943b1d348dc35c73845f59cf9776258`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-c99347fd5003d4ce.a3857863.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, handoff (mattpocock/skills), Report 017, 2026-11-01. On at least one task it scored below the fake. Against no skill: The skill clearly hurt: 0.766 with it and 0.804 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/c99347fd5003d4ce8f8af82defa7c3480943b1d348dc35c73845f59cf9776258/

Keep this whole message together so the limits travel with the result.

### frontend-design anthropics/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- identity (underpowered): with the skill 1 plus or minus 0; with the same-length placebo 0.983333 plus or minus 0.028868.
- brief (separated-up): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.866667 plus or minus 0.028868.
- content (underpowered): with the skill 0.82 plus or minus 0.09083; with the same-length placebo 0.8 plus or minus 0.108012.

Against no skill: Too few answers to tell: 0.934 with the skill and 0.936 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case content: the two arms' spreads sum to 0.177, at or above the 0.05 floor).

- identity (underpowered): with the skill 1 plus or minus 0; without it 0.983333 plus or minus 0.028868.
- brief (underpowered): with the skill 0.983333 plus or minus 0.028868; without it 0.95 plus or minus 0.
- content (underpowered): with the skill 0.82 plus or minus 0.09083; without it 0.875 plus or minus 0.086603.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Too few answers to tell. [Report 015 receipt](https://driftproofhq.com/r/05a14c53c635688d45acf8c62836a7d47ded2c60e9b78c4a7edef3a5e5329854/)

Receipt `0868c96e9921658415dfbc23245185d69a3b867f1af4a146f0adb0d0c75cd007`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-0868c96e99216584.ff5c07e7.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, frontend-design (anthropics/skills), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: Too few answers to tell: 0.934 with the skill and 0.936 without, but the scores varied too much to call it. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/0868c96e9921658415dfbc23245185d69a3b867f1af4a146f0adb0d0c75cd007/

Keep this whole message together so the limits travel with the result.

### reddit-automation flowkit-labs/skills

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- rank (separated-down): with the skill 0.766667 plus or minus 0.028868; with the same-length placebo 0.883333 plus or minus 0.08756.
- reply (underpowered): with the skill 0.766667 plus or minus 0.028868; with the same-length placebo 0.7875 plus or minus 0.075.
- rules (separated-down): with the skill 0.6875 plus or minus 0.062915; with the same-length placebo 0.85 plus or minus 0.057735.

Against no skill: The skill clearly hurt: 0.740 with it and 0.810 without, on 3 test tasks.

0.740 with the skill and 0.810 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- rank (underpowered): with the skill 0.766667 plus or minus 0.028868; without it 0.858333 plus or minus 0.102062.
- reply (underpowered): with the skill 0.766667 plus or minus 0.028868; without it 0.7875 plus or minus 0.047871.
- rules (separated-down): with the skill 0.6875 plus or minus 0.062915; without it 0.783333 plus or minus 0.028868.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly hurt. [Report 015 receipt](https://driftproofhq.com/r/bdbb7f978fdd9d4da60bf9d8dba76159cdc7f37b946f3735ff31acecc5ba4b3a/)

Receipt `634c8503a6289ce2d01baf865a4baaca5d3fe1a3d78dc16f971b86db1fa56d87`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-634c8503a6289ce2.c2c41f14.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, reddit-automation (flowkit-labs/skills), Report 017, 2026-11-01. On at least one task it scored below the fake. Against no skill: The skill clearly hurt: 0.740 with it and 0.810 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/634c8503a6289ce2d01baf865a4baaca5d3fe1a3d78dc16f971b86db1fa56d87/

Keep this whole message together so the limits travel with the result.

### triage mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- conflict (separated-up): with the skill 0.8875 plus or minus 0.075; with the same-length placebo 0.633333 plus or minus 0.028868.
- evidence (underpowered): with the skill 0.933333 plus or minus 0.028868; with the same-length placebo 0.966667 plus or minus 0.028868.
- ready (separated-up): with the skill 0.875 plus or minus 0.086603; with the same-length placebo 0.483333 plus or minus 0.028868.

Against no skill: The skill clearly helped: 0.899 with it and 0.631 without, on 3 test tasks.

0.899 with the skill and 0.631 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- conflict (separated-up): with the skill 0.8875 plus or minus 0.075; without it 0.5875 plus or minus 0.118145.
- evidence (underpowered): with the skill 0.933333 plus or minus 0.028868; without it 0.8375 plus or minus 0.094648.
- ready (separated-up): with the skill 0.875 plus or minus 0.086603; without it 0.466667 plus or minus 0.028868.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: PLACEBO_ABOVE_BASELINE

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/d31b2f40eced27b77786d4fa004f3a8cac901918bb82fbf199588a3aa3b5716e/)

Receipt `89b67ed69a5a7368214cac086f1ef50b57e19c4644af33d71f456663ead117e8`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-89b67ed69a5a7368.c7e611f1.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, triage (mattpocock/skills), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped: 0.899 with it and 0.631 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/89b67ed69a5a7368214cac086f1ef50b57e19c4644af33d71f456663ead117e8/

Keep this whole message together so the limits travel with the result.

### prototype mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- logic (separated-up): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.275 plus or minus 0.189077.
- ui (separated-up): with the skill 0.916667 plus or minus 0.028868; with the same-length placebo 0.6 plus or minus 0.
- unclear (separated-up): with the skill 0.7625 plus or minus 0.062915; with the same-length placebo 0.45 plus or minus 0.070711.

Against no skill: The skill clearly helped: 0.887 with it and 0.401 without, on 3 test tasks.

0.887 with the skill and 0.401 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- logic (separated-up): with the skill 0.983333 plus or minus 0.028868; without it 0.233333 plus or minus 0.163299.
- ui (separated-up): with the skill 0.916667 plus or minus 0.028868; without it 0.51875 plus or minus 0.212027.
- unclear (separated-up): with the skill 0.7625 plus or minus 0.062915; without it 0.45 plus or minus 0.05.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/cb33a80a2e7db6d3d612b4ea17dcd7648b245fe68eb6adc08989983b6e2a98db/)

Receipt `2026a8968d1a5ae85d33c02e634987021b04edd9ba568a9e1d2436f56621ab89`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-2026a8968d1a5ae8.46b7c4ca.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, prototype (mattpocock/skills), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped: 0.887 with it and 0.401 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/2026a8968d1a5ae85d33c02e634987021b04edd9ba568a9e1d2436f56621ab89/

Keep this whole message together so the limits travel with the result.

### media-use heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- reuse (separated-up): with the skill 0.85 plus or minus 0.11547; with the same-length placebo 0.6 plus or minus 0.05.
- logo (underpowered): with the skill 0.94 plus or minus 0.082158; with the same-length placebo 0.85 plus or minus 0.086603.
- grade (underpowered): with the skill 0.9 plus or minus 0; with the same-length placebo 0.92 plus or minus 0.083666.

Against no skill: The skill clearly helped: 0.897 with it and 0.769 without, on 3 test tasks.

0.897 with the skill and 0.769 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- reuse (separated-up): with the skill 0.85 plus or minus 0.11547; without it 0.607143 plus or minus 0.113389.
- logo (underpowered): with the skill 0.94 plus or minus 0.082158; without it 0.81 plus or minus 0.119373.
- grade (underpowered): with the skill 0.9 plus or minus 0; without it 0.89 plus or minus 0.074162.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/65231f29050580d7e14324c7aff5bfc053844d5c11093958713393e98283c26c/)

Receipt `9b55433e219fb065e304806bceea6aee214d3b3fb55eaa11244eef5ef5533586`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-9b55433e219fb065.3ffe509c.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, media-use (heygen-com/hyperframes), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped: 0.897 with it and 0.769 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/9b55433e219fb065e304806bceea6aee214d3b3fb55eaa11244eef5ef5533586/

Keep this whole message together so the limits travel with the result.

### grilling mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- frontier (separated-up): with the skill 0.8375 plus or minus 0.062915; with the same-length placebo 0.733333 plus or minus 0.028868.
- settled (separated-up): with the skill 0.7 plus or minus 0.05; with the same-length placebo 0.583333 plus or minus 0.028868.
- finish (underpowered): with the skill 0.433333 plus or minus 0.08165; with the same-length placebo 0.3125 plus or minus 0.047871.

Against no skill: The skill clearly helped on 1 of 3 test tasks: the frontier task decided it. Over all 3, the averages were 0.657 with it and 0.670 without.

0.657 with the skill and 0.670 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- frontier (separated-up): with the skill 0.8375 plus or minus 0.062915; without it 0.75 plus or minus 0.
- settled (underpowered): with the skill 0.7 plus or minus 0.05; without it 0.7 plus or minus 0.089443.
- finish (underpowered): with the skill 0.433333 plus or minus 0.08165; without it 0.56 plus or minus 0.124499.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/a270d6454735f29e9dae390c064d7e3efd1500cb1e8a3c96dcd3a3900f697e35/)

Receipt `667515dbf9bc6f239ba757bf64e0f301488eb7dfe30d2ce1bbb6c3231890a6e3`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-667515dbf9bc6f23.675c8c81.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, grilling (mattpocock/skills), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped on 1 of 3 test tasks: the frontier task decided it. Over all 3, the averages were 0.657 with it and 0.670 without. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/667515dbf9bc6f239ba757bf64e0f301488eb7dfe30d2ce1bbb6c3231890a6e3/

Keep this whole message together so the limits travel with the result.

### hyperframes-animation heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- timeline (separated-up): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.828571 plus or minus 0.118523.
- runtime (separated-up): with the skill 0.7 plus or minus 0.093541; with the same-length placebo 0.1375 plus or minus 0.085391.
- template (separated-up): with the skill 0.933333 plus or minus 0.028868; with the same-length placebo 0.6 plus or minus 0.05.

Against no skill: The skill clearly helped: 0.872 with it and 0.556 without, on 3 test tasks.

0.872 with the skill and 0.556 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- timeline (underpowered): with the skill 0.983333 plus or minus 0.028868; without it 0.84 plus or minus 0.124499.
- runtime (separated-up): with the skill 0.7 plus or minus 0.093541; without it 0.266667 plus or minus 0.132916.
- template (separated-up): with the skill 0.933333 plus or minus 0.028868; without it 0.5625 plus or minus 0.075.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/b9f499c15c4f83c9a4e1171e88681271c6d6d2cc8637bac97659c5c05a6ab0ce/)

Receipt `932a427a39bc105f634287f8af286d9ff5c6f58665aa3d719321ca00efaa8a4b`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-932a427a39bc105f.ff2bc7f0.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, hyperframes-animation (heygen-com/hyperframes), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped: 0.872 with it and 0.556 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/932a427a39bc105f634287f8af286d9ff5c6f58665aa3d719321ca00efaa8a4b/

Keep this whole message together so the limits travel with the result.

### hyperframes-registry heygen-com/hyperframes

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1). Left out of the headline count.

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- block (separated-up): with the skill 0.9 plus or minus 0.070711; with the same-length placebo 0.5 plus or minus 0.
- component (separated-up): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.294444 plus or minus 0.200693.
- search (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.4875 plus or minus 0.085391.

Against no skill: No verdict: delegated skill not tested.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: PLACEBO_ABOVE_BASELINE

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: No verdict: delegated skill not tested. [Report 015 receipt](https://driftproofhq.com/r/ff6bb0a23b2b250c71181de274ba684ac5706558cd3214e08acc637823290029/)

Receipt `5fc27143c0cb1bc36e6915a4f162edec66f29a89168e7c75c02ccd251248d2bf`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-5fc27143c0cb1bc3.a3537ca1.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, hyperframes-registry (heygen-com/hyperframes), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: No verdict: delegated skill not tested. These text tasks test the router's written response, not the delegated skill. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/5fc27143c0cb1bc36e6915a4f162edec66f29a89168e7c75c02ccd251248d2bf/

[Why a router gets no verdict: Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1)

Keep this whole message together so the limits travel with the result.

### design-mobile-apps designed-by-ai/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- response (underpowered): with the skill 0.85 plus or minus 0.173205; with the same-length placebo 0.683333 plus or minus 0.08165.
- shots (separated-up): with the skill 0.92 plus or minus 0.075829; with the same-length placebo 0.683333 plus or minus 0.028868.
- ids (underpowered): with the skill 0.7 plus or minus 0; with the same-length placebo 0.6125 plus or minus 0.103078.

Against no skill: The skill clearly helped: 0.823 with it and 0.739 without, on 3 test tasks.

0.823 with the skill and 0.739 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- response (underpowered): with the skill 0.85 plus or minus 0.173205; without it 0.766667 plus or minus 0.121106.
- shots (separated-up): with the skill 0.92 plus or minus 0.075829; without it 0.733333 plus or minus 0.028868.
- ids (underpowered): with the skill 0.7 plus or minus 0; without it 0.716667 plus or minus 0.028868.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/ea6c4a25fbedb8012f5ad2eb94eebdc68a77247a3183f9696d53d6c8940fd273/)

Receipt `9fa7bc62d8703ea066da8b40f0b3adc7c51a153f524155767b5c9e24f4042c1e`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-9fa7bc62d8703ea0.ec82294e.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, design-mobile-apps (designed-by-ai/skills), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped: 0.823 with it and 0.739 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/9fa7bc62d8703ea066da8b40f0b3adc7c51a153f524155767b5c9e24f4042c1e/

Keep this whole message together so the limits travel with the result.

### hyperframes-core heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- root (underpowered): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.93 plus or minus 0.067082.
- transform (separated-up): with the skill 0.95 plus or minus 0.05; with the same-length placebo 0.75 plus or minus 0.
- exit (separated-up): with the skill 0.81 plus or minus 0.089443; with the same-length placebo 0.366667 plus or minus 0.028868.

Against no skill: The skill clearly helped: 0.914 with it and 0.651 without, on 3 test tasks.

0.914 with the skill and 0.651 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- root (underpowered): with the skill 0.983333 plus or minus 0.028868; without it 0.9125 plus or minus 0.118145.
- transform (separated-up): with the skill 0.95 plus or minus 0.05; without it 0.7 plus or minus 0.05.
- exit (separated-up): with the skill 0.81 plus or minus 0.089443; without it 0.34 plus or minus 0.155724.

See the question and the judge's notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge's scores and reasons, one try at a time. Without it, the kept answers sit beside this row's receipt in the repository, under Receipts at the end of the report.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Context only, not this measurement: Report 015 read this skill in a separate, earlier run on 2026-10-18: Clearly helped. [Report 015 receipt](https://driftproofhq.com/r/4be11a73543e9b0a137bee99dbe5f25beaa7f69e5103b45865862654fec3e8ec/)

Receipt `7c7564b040f77c1bb69904c78545d55c1d8dc08b8661b3ef5c9522c0de9a6245`

**Preview and copy this result**

The finding, with its limits

[View card image](https://driftproofhq.com/cards/receipt-7c7564b040f77c1b.b25910c6.png)

On Claude Sonnet 5.5, judged by Claude Haiku 5.5, hyperframes-core (heygen-com/hyperframes), Report 017, 2026-11-01. On at least one task it scored above the fake, and on none below. Against no skill: The skill clearly helped: 0.914 with it and 0.651 without, on 3 test tasks. Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5. Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings. It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5. Receipt: https://driftproofhq.com/r/7c7564b040f77c1bb69904c78545d55c1d8dc08b8661b3ef5c9522c0de9a6245/

Keep this whole message together so the limits travel with the result.

## Method

These sections are the pre-registered note, as the campaign first stored it.

### What each receipt shows

Each of the 20 frozen attempts runs one skill of Report 015's plain list on claude-sonnet-5-5, graded by claude-haiku-5-5, with three arms: the skill text, no skill, and a text of the skill's length in bytes from the revision 1 fixed corpus (spec 440).

The report shows two readings for each receipt, each in lib/verdict.js's own words:

- the verdict: `receiptVerdict`, the skill against no skill, in the receipt reader's words;
- the placebo reading: `placeboLine(placeboReading(receipt))`, the skill against the same-length text.

The verdict shown is the Report 017 receipt's own. Report 015's verdicts are not put beside it as if they were the same run. The verdict reads only the skill and no-skill arms, so the placebo arm's replies move it in no way. No figure other than these readings and their counts enters the headline.

### Which receipt is read

The report reads exactly one sealed receipt per attempt id. It is the receipt the campaign's manifest chain records for that attempt, read through the campaign ledger. The first completed receipt is the only one: an attempt with a sealed receipt is never run again, and a second receipt for the same attempt id refuses the whole chain. No receipt is chosen after its results are seen.

An attempt without a receipt may be run again in a later invocation of the same frozen plan, at most three runs in all, its earlier costs counted against the USD 400 cap. Every failure stays in the ledger. A failure carries no reading, so running it again chooses nothing.

The campaign has one root directory. It keeps the plan and this note as first started and an append-only log with one line per start. A second start with no prior chain is refused, and a resume must continue the log's latest manifest. The report reads only the chain that ends at the log's latest manifest, and refuses if the root holds any other manifest under this plan. A cost correction may be added after a run and is never rewritten: each manifest records the corrections in force when it started.

### Terms

"Beat the fake" means exactly one thing: the placebo reading is `ABOVE_PLACEBO`. In the reader's words, "case rule: at least one case scored above the same-length placebo, and none below". The case rule reads each of the three tasks by its draw bands, so this says no more than that, on at least one of three tasks, the skill's band sat above the placebo's at the effect floor, and on none below.

No other reading beats the fake. `BELOW_PLACEBO`, `NO_DIFFERENCE`, `INCONCLUSIVE`, `UNDERPOWERED` and `NOT_MEASURED` do not. None of them shows that a skill does no better than the fake.

A missing receipt reads `NOT_MEASURED`: a failed, cancelled or budget-stopped attempt is counted as not read, never as a result. A stub receipt also reads `NOT_MEASURED`.

### Who is counted

The four routers are find-skills, agent-browser, hyperframes and hyperframes-registry. They carry Report 015 Amendment 1's qualification: their text tasks test the router's written response, not the delegated skill. Their readings are shown with that qualification. They are left out of the headline count, as Report 015 leaves them out of its verdict counts.

The headline counts the other 16 skills. N is 16.

### The secondary reading

Beside each skill, and never in the headline, the report shows a second reading: the same case rule over the placebo's rows against the no-skill rows of the same receipt (`tally.cjs` `secondaryReading`). Its tokens are `PLACEBO_ABOVE_BASELINE`, `PLACEBO_BELOW_BASELINE`, `NO_DIFFERENCE`, `INCONCLUSIVE`, `UNDERPOWERED` and `NOT_MEASURED`. It is read only where the placebo reading is read, and refused wherever that is refused. It is not counted, not subtracted from the placebo reading, and not combined with it.

## Limits

It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of 2026-10-17, on Claude Sonnet 5.5 judged by Claude Haiku 5.5.

Three text-only tasks. Driftproof wrote the suite from the pinned skill description and README. These are not author-supplied tests. External tools, generated media and deployed services were not tested.

The eval account's configuration was read and found clean before and after each run, not during it.

For find-skills, agent-browser, hyperframes and hyperframes-registry: This tests the router's written response; it does not test the delegated skill.

The placebo text is not inert: on a task that supplies the facts its answer needs, a same-length text about landscape and village life can pull an answer off them, so the fake can score below no skill. The secondary reading shows where it did.

It does not say why a skill helps, that a skill and the fake are the same, or that the fake carries no information about a task. It says nothing about a skill that was not run with the placebo arm. It does not combine the 20 readings into one score.

The placebo corpus was chosen without reference to any task, so a placebo text can still bear on a task by chance.

Unkeyed seals and retained outputs permit checking internal consistency; they do not authenticate an origin.

## Run record

One campaign root, `receipts/report-017c`, read from the latest manifest its log names. 20 of 20 attempts have a sealed receipt; every other attempt is a recorded failure and reads NOT_MEASURED. The earliest receipt date is 2026-11-01 and the latest 2026-11-01. No finish time is inferred.

The surface was claude-cli. Recorded spend across the chain: USD 22.712233. Recorded costs are API-equivalent estimates, not a subscription invoice.

1. `receipts/report-017c/campaign-1/manifest.json`, SHA-256 `b87f0c7ca4f22d4c2278e71c35c400d06f01356f16b3faca5e627ac4b953e318`

Plan SHA-256 `3f008b21d542b85b90a5e37c60672c62788b9742319ca1f1fde8c906c419f3f4`. Pre-registered note SHA-256 `404b6629b6a7e0e376e10f15926392ddfa6fdf011c4df5dfd5eac9786dcd6c84`.

Read and built by:

- `scripts/prepare-report-017.js`, SHA-256 `b61c1f00f86bb5b38d869324da697ea8dad5cd61b41a8b6597a0391b75a992a3`
- `specs/613-placebo-skills-report/publication.cjs`, SHA-256 `fba3577194bab75b0ac4c993b4567008c418e17178ef4399e560a71ff2754050`
- `specs/613-placebo-skills-report/tally.cjs`, SHA-256 `a7d334796f32591a9488baa2286e3ba9462305ff6a92b8b2f0c7695a96a415dd`
- `specs/613-placebo-skills-report/run-campaign.cjs`, SHA-256 `db070608736eb9401fb8acf6a15cf800deeefbd706b18a92383242ef6609af6a`
- `specs/408-skill-measurements/ledger.cjs`, SHA-256 `263a3d3423feea70aaf90074a58bcaf48d4ddb8b0eea262ec634450b17b63aae`
- `specs/408-skill-measurements/reconstruct.cjs`, SHA-256 `f64871c647c3482a0d05e6a2308a05192b5934816097978ece34d553a360f2dd`
- `lib/verdict.js`, SHA-256 `c09edd5e1a8c62c43fa0e0d1f1a268d5d6076e474846e2cf9247a1f0e35b5b6e`
- `lib/plain.js`, SHA-256 `46f471b1487460b6101680f0b4c1191e358611020f326898e37f0e420011dbb9`
- `lib/placebo.js`, SHA-256 `f9511bdbb9928f615017addebfa305b1f7b27c544cc5dbd377e668d661be26a0`
- `lib/receipt.js`, SHA-256 `15af7a7c568cce78ed97c3625adaee79da513d2ca71fc6743492446b97bbaba5`
- `scripts/skill-handoff.js`, SHA-256 `261c15ba3c979f74bf69d4a6f7e192f8458a0b9635b7a17effd8e7cf1d53fda2`

## Amendments

### Amendment 1, 2 Nov 2026

Added a note after the headline and in the rows for grill-me and grill-with-docs. The whole text of each skill only calls another skill, and these text tasks forbid tools. Counts, readings and receipts are unchanged.

### Amendment 2, 2 Nov 2026

Added a link, after the opening panel, to a blind read of handoff's kept answers. Counts, readings and receipts are unchanged.

### Amendment 3, 3 Nov 2026

Reworded the line against no skill in the rows where the overall averages with and without the skill do not point the verdict's way: it names the task that decided it and gives the averages over all the tasks. The verdict is decided per task, so those averages can sit equal or point the other way. Counts, readings and receipts are unchanged.

### Amendment 4, 4 Nov 2026

Added, under each task of every row with a receipt, a way to open that task's prompt and rubric, the kept answers with the skill, with the fake text and with nothing, and the judge's scores and reasons for one try at a time. Counts, readings and receipts are unchanged.

### Amendment 5, 4 Nov 2026

Added Send this result to each row, with a fixed message that keeps its reading, model, judge, report, caveats and receipt together. A router row also links Report 015 Amendment 1, which says why a router gets no verdict. Counts, readings and receipts are unchanged.

## Receipts

- [find-skills on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/89e4135ba715fdcd8a1c966d04b371fa9ec97f97c1d3f0ad20a35173052c112c.json)
- [grill-me on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/9ad7ac527a21f178392b4ae9d146922b7ad58ee6ca8dcef4f8d5172f95cdb027.json)
- [grill-with-docs on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/bfc0fd31bf2c53d679e22d467a049c6f8a5e2209265a755d14c5d2ca68a1ef02.json)
- [agent-browser on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/a48c0a427ed6c47df40680e4c6f57aad8e89b9d80a5673c04a6384c2f16c23f9.json)
- [improve-codebase-architecture on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/95d64cad7267275a0b44ec0d34324121590d1f55dff9e34ccd09b722214164e2.json)
- [tdd on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/5b5214d520f0c5ba96d4f97e379bf12e096d7ffabf2c0bdd8db1983edfebade8.json)
- [hyperframes-cli on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/f5ae440882dd7c62585dfab749f5a8995c082176c2a63877a8487f1df570aba6.json)
- [hyperframes on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/79e7654ca55b6f0fcf3b532adb9509f8a155683543314a600ca99379f042238c.json)
- [setup-matt-pocock-skills on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/bc5ec12a6870b996beb276f1f680e26be3028563f754675d8a75fbf84767c474.json)
- [handoff on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/335148930bb21ee4a130cc0964044930eb0c9f845dc4c35d918dd876343c4bed.json)
- [frontend-design on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/9edec01658bd1dd3181739e2133b892dd7036c5bb275aba29f8e3a2cfbcf529a.json)
- [reddit-automation on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/0960909c6068a7174c8e22ce9840e5d92ad1c3d7251cc71261d9dea7d26488a6.json)
- [triage on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/fd659efbeefcd5620d0e01d67cb4ff7c16218e6f1ab680952df8180bfb42fd9c.json)
- [prototype on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/ac1962e75ff73f58d89fc1dc2259ec6474c61082a1ddc3c7f1fbb78325f0cee9.json)
- [media-use on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/f2bb2e6fbec8d45ddbf0d7070b0c00672fbd1428dc4c6a9e4ff9d7929e477708.json)
- [grilling on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/9c065800c643bb92c5767d90cedff42cfefdc2e4baab94b92759188eb2f34451.json)
- [hyperframes-animation on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/2678081717e971ae9102908ef780fcb282210918d793658026c720f0fafdc860.json)
- [hyperframes-registry on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/2d178c3a805b32af419bc6abb16d1197ba54ef6a9c07bc102fed0daa903b367e.json)
- [design-mobile-apps on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/91292198c479ada88c866ab5038b12522204cbe9bf681e9a9a2f4d81ee628432.json)
- [hyperframes-core on Claude Sonnet 5.5](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-017c/campaign-1/fd401f5c7ca07816d619eb38523b7b618c904ad05587f5b1a675e2a32baee2c1.json)
