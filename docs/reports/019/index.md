# Skill or sugar pill, on Fable 5.2? Twenty skills against a same-length placebo

Canonical: <https://driftproofhq.com/reports/019/>

## What did Report 019 find?

- **What we tested.** Twenty skills on Claude Fable 5.2, three tasks each, with the skill, with no skill and with a same-length fake.
- **What we found.** Of the 20 skills, 10 beat the fake, 4 did not beat it, and for 6 we can't tell yet. Not beating the fake does not show a skill is useless.
- **How it was graded.** Another model judged the fourteen. The six run with tools on were graded on what Claude Code did, by a check written before the run.
- **What it doesn't show.** Beating the fake is not beating no skill. It does not show how these skills do beyond three tasks each, or how Fable 5.2 compares with other models.

Report 019: Placebo comparison, claude-fable-5-2

Type Placebo comparison report

What moved a same-length placebo text

Models `claude-fable-5-2`

Headline 10 of 20 skills beat the fake on Fable 5.2: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none.

Receipts [32 linked receipts](https://driftproofhq.com/reports/019/#receipts)

**Cite this**

```
@techreport{driftproof-019,
  title  = {Skill or sugar pill, on Fable 5.2? Twenty skills against a same-length placebo},
  author = {Driftproof},
  year   = {2026},
  type   = {Placebo comparison report},
  note   = {claude-fable-5-2},
  url    = {https://driftproofhq.com/reports/019/}
}
```

## Did these 20 skills beat a same-length fake?

10 beat it. 4 did not beat it (1 scored below it, 3 showed no clear difference). For 6 we can't tell yet.

On Claude Fable 5.2, three tasks per skill. Another model judged the answers of the fourteen; the six run with tools on were graded on what Claude Code did, by a check written before the run.

The skill The fake No skill Beat the fake Did not beat the fake Can't tell yet

| Skill | Average score | With the skill | With the fake | With no skill |
| --- | --- | --- | --- | --- |
| Beat the fake 10 |  |  |  |  |
| [improve-codebase-architecture](https://driftproofhq.com/reports/019/#skill-improve-codebase-architecture) |  | 0.826 | 0.714 | 0.790 |
| [tdd](https://driftproofhq.com/reports/019/#skill-tdd) |  | 1.000 | 0.917 | 0.981 |
| [hyperframes-cli](https://driftproofhq.com/reports/019/#skill-hyperframes-cli) |  | 0.963 | 0.692 | 0.738 |
| [handoff](https://driftproofhq.com/reports/019/#skill-handoff) |  | 0.875 | 0.828 | 0.833 |
| [triage](https://driftproofhq.com/reports/019/#skill-triage) |  | 0.989 | 0.735 | 0.711 |
| [prototype](https://driftproofhq.com/reports/019/#skill-prototype) |  | 0.897 | 0.418 | 0.448 |
| [grilling](https://driftproofhq.com/reports/019/#skill-grilling) |  | 0.872 | 0.808 | 0.817 |
| [hyperframes-animation](https://driftproofhq.com/reports/019/#skill-hyperframes-animation) |  | 0.872 | 0.544 | 0.640 |
| [design-mobile-apps](https://driftproofhq.com/reports/019/#skill-design-mobile-apps) |  | 0.917 | 0.847 | 0.820 |
| [hyperframes-core](https://driftproofhq.com/reports/019/#skill-hyperframes-core) |  | 0.917 | 0.661 | 0.658 |
| Did not beat the fake 4 1 scored below it, 3 showed no clear difference |  |  |  |  |
| [reddit-automation](https://driftproofhq.com/reports/019/#skill-reddit-automation) |  | 0.806 | 0.939 | 0.958 |
| [grill-with-docs](https://driftproofhq.com/reports/019/#skill-grill-with-docs) tools on |  | 1.000 | 1.000 | 0.833 |
| [agent-browser](https://driftproofhq.com/reports/019/#skill-agent-browser) tools on |  | 1.000 | 1.000 | 1.000 |
| [hyperframes](https://driftproofhq.com/reports/019/#skill-hyperframes) tools on |  | 1.000 | 1.000 | 1.000 |
| Can't tell yet 6 |  |  |  |  |
| [setup-matt-pocock-skills](https://driftproofhq.com/reports/019/#skill-setup-matt-pocock-skills) |  | 0.917 | 0.911 | 0.907 |
| [frontend-design](https://driftproofhq.com/reports/019/#skill-frontend-design) |  | 0.945 | 0.958 | 0.980 |
| [media-use](https://driftproofhq.com/reports/019/#skill-media-use) |  | 0.981 | 0.901 | 0.942 |
| [find-skills](https://driftproofhq.com/reports/019/#skill-find-skills) tools on |  | 0.926 | 0.944 | 0.926 |
| [grill-me](https://driftproofhq.com/reports/019/#skill-grill-me) tools on |  | 0.986 | 1.000 | 1.000 |
| [hyperframes-registry](https://driftproofhq.com/reports/019/#skill-hyperframes-registry) tools on |  | 0.852 | 0.852 | 0.889 |

Each mark is an average over all of a skill's tasks. The verdict is decided task by task, so a mark can point the other way.

## Each skill

Open a skill for its tasks, its scores and its receipt.

### Beat the fake

**improve-codebase-architecture mattpocock/skills Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: too few answers to tell.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### improve-codebase-architecture mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- candidate (separated-up): with the skill 0.728571 plus or minus 0.090633; with the same-length placebo 0.4875 plus or minus 0.047871.
- adr (underpowered): with the skill 1 plus or minus 0; with the same-length placebo 0.9375 plus or minus 0.075.
- report (underpowered): with the skill 0.75 plus or minus 0; with the same-length placebo 0.716667 plus or minus 0.028868.

Against no skill: Too few answers to tell: 0.826 with the skill and 0.790 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case candidate: the two arms' spreads sum to 0.141, at or above the 0.05 floor).

- candidate (underpowered): with the skill 0.728571 plus or minus 0.090633; without it 0.75 plus or minus 0.05.
- adr (underpowered): with the skill 1 plus or minus 0; without it 0.92 plus or minus 0.115109.
- report (underpowered): with the skill 0.75 plus or minus 0; without it 0.7 plus or minus 0.079057.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `c44af9665c99f35e673fe83c158205785c7743bc13cddba2289ab17170341c83`

**tdd mattpocock/skills Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: too few answers to tell.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### tdd mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- test (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- coupling (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- agreement (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.75 plus or minus 0.

Against no skill: Too few answers to tell: 1.000 with the skill and 0.981 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case agreement: the two arms' spreads sum to 0.102, at or above the 0.05 floor).

- test (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- coupling (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- agreement (underpowered): with the skill 1 plus or minus 0; without it 0.941667 plus or minus 0.102062.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `383f4db201b9416ec333a321d25f324dcb07fd22b024a2189fb80591bffad092`

**hyperframes-cli heygen-com/hyperframes Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: clearly helped.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### hyperframes-cli heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- loop (separated-up): with the skill 0.89 plus or minus 0.108397; with the same-length placebo 0.625 plus or minus 0.103682.
- timeline (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.75 plus or minus 0.
- render (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.7 plus or minus 0.114018.

Against no skill: The skill clearly helped: 0.963 with it and 0.738 without, on 3 test tasks.

0.963 with the skill and 0.738 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- loop (separated-up): with the skill 0.89 plus or minus 0.108397; without it 0.733333 plus or minus 0.028868.
- timeline (separated-up): with the skill 1 plus or minus 0; without it 0.75 plus or minus 0.
- render (separated-up): with the skill 1 plus or minus 0; without it 0.73 plus or minus 0.057009.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `f68117a83f4e32cc4844353587b188f1b4cb61e6862f9a103cf0f5b25330158a`

**handoff mattpocock/skills Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: clearly helped.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### handoff mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- resume (not-separated): with the skill 0.75 plus or minus 0; with the same-length placebo 0.75 plus or minus 0.
- privacy (underpowered): with the skill 0.875 plus or minus 0.144338; with the same-length placebo 0.983333 plus or minus 0.028868.
- destination (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.75 plus or minus 0.

Against no skill: The skill clearly helped: 0.875 with it and 0.833 without, on 3 test tasks.

0.875 with the skill and 0.833 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- resume (not-separated): with the skill 0.75 plus or minus 0; without it 0.75 plus or minus 0.
- privacy (underpowered): with the skill 0.875 plus or minus 0.144338; without it 1 plus or minus 0.
- destination (separated-up): with the skill 1 plus or minus 0; without it 0.75 plus or minus 0.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `d2a21cc18ae1423f3cfb6f033cc56ec25b457421004829e3f5c67c8d6eeb33df`

**triage mattpocock/skills Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: clearly helped.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### triage mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- conflict (underpowered): with the skill 1 plus or minus 0; with the same-length placebo 0.885714 plus or minus 0.128174.
- evidence (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- ready (separated-up): with the skill 0.966667 plus or minus 0.028868; with the same-length placebo 0.32 plus or minus 0.067082.

Against no skill: The skill clearly helped: 0.989 with it and 0.711 without, on 3 test tasks.

0.989 with the skill and 0.711 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- conflict (separated-up): with the skill 1 plus or minus 0; without it 0.733333 plus or minus 0.028868.
- evidence (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- ready (separated-up): with the skill 0.966667 plus or minus 0.028868; without it 0.4 plus or minus 0.108012.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `6ee5ccb7d05d791a9e90f5ece0fcd8bffd092a0f837ea76dc33287dc1cd16d01`

**prototype mattpocock/skills Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: clearly helped.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### prototype mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- logic (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.525 plus or minus 0.05.
- ui (separated-up): with the skill 0.93 plus or minus 0.057009; with the same-length placebo 0.33 plus or minus 0.175357.
- unclear (separated-up): with the skill 0.7625 plus or minus 0.131498; with the same-length placebo 0.4 plus or minus 0.094868.

Against no skill: The skill clearly helped: 0.897 with it and 0.448 without, on 3 test tasks.

0.897 with the skill and 0.448 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- logic (separated-up): with the skill 1 plus or minus 0; without it 0.5 plus or minus 0.
- ui (separated-up): with the skill 0.93 plus or minus 0.057009; without it 0.492857 plus or minus 0.171825.
- unclear (separated-up): with the skill 0.7625 plus or minus 0.131498; without it 0.35 plus or minus 0.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `e8e18fbaec9a403354b12b1761968687e8213bbf57350def1a6164eccf6226aa`

**grilling mattpocock/skills Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: clearly helped.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### grilling mattpocock/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- frontier (separated-up): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 0.75 plus or minus 0.
- settled (underpowered): with the skill 0.9 plus or minus 0.106066; with the same-length placebo 0.925 plus or minus 0.093541.
- finish (underpowered): with the skill 0.733333 plus or minus 0.028868; with the same-length placebo 0.75 plus or minus 0.

Against no skill: The skill clearly helped: 0.872 with it and 0.817 without, on 3 test tasks.

0.872 with the skill and 0.817 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- frontier (separated-up): with the skill 0.983333 plus or minus 0.028868; without it 0.75 plus or minus 0.
- settled (underpowered): with the skill 0.9 plus or minus 0.106066; without it 1 plus or minus 0.
- finish (underpowered): with the skill 0.733333 plus or minus 0.028868; without it 0.7 plus or minus 0.05.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `3400122dda9e97243aa7457a193e9514fe2a9bd8ada484ad00898d9e34f14b1a`

**hyperframes-animation heygen-com/hyperframes Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: clearly helped.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### hyperframes-animation heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- timeline (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- runtime (separated-up): with the skill 0.616667 plus or minus 0.028868; with the same-length placebo 0.033333 plus or minus 0.028868.
- template (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.6 plus or minus 0.11547.

Against no skill: The skill clearly helped: 0.872 with it and 0.640 without, on 3 test tasks.

0.872 with the skill and 0.640 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- timeline (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- runtime (separated-up): with the skill 0.616667 plus or minus 0.028868; without it 0.295 plus or minus 0.146154.
- template (separated-up): with the skill 1 plus or minus 0; without it 0.625 plus or minus 0.144338.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `cb7fee140bf69efb5bd73549a8d01f49394e817be92b7ffe84885d6e72297cfe`

**design-mobile-apps designed-by-ai/skills Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: clearly helped.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### design-mobile-apps designed-by-ai/skills

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- response (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.95 plus or minus 0.
- shots (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.825 plus or minus 0.095743.
- ids (underpowered): with the skill 0.75 plus or minus 0; with the same-length placebo 0.766667 plus or minus 0.028868.

Against no skill: The skill clearly helped: 0.917 with it and 0.820 without, on 3 test tasks.

0.917 with the skill and 0.820 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- response (separated-up): with the skill 1 plus or minus 0; without it 0.891667 plus or minus 0.073598.
- shots (separated-up): with the skill 1 plus or minus 0; without it 0.78 plus or minus 0.097468.
- ids (underpowered): with the skill 0.75 plus or minus 0; without it 0.7875 plus or minus 0.047871.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `ee86c450b8a7c2d805f600b88fdc4e1f8ef83b6bcf9798c5a86ffbd09ce29b97`

**hyperframes-core heygen-com/hyperframes Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: clearly helped.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### hyperframes-core heygen-com/hyperframes

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- root (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- transform (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.75 plus or minus 0.
- exit (separated-up): with the skill 0.75 plus or minus 0; with the same-length placebo 0.233333 plus or minus 0.028868.

Against no skill: The skill clearly helped: 0.917 with it and 0.658 without, on 3 test tasks.

0.917 with the skill and 0.658 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- root (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- transform (separated-up): with the skill 1 plus or minus 0; without it 0.725 plus or minus 0.05.
- exit (separated-up): with the skill 0.75 plus or minus 0; without it 0.25 plus or minus 0.141421.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `e3ee1e3bd056d398f04c8610b9067a0fd5af11dafdd9cb04cba1d740da547193`

### Did not beat the fake

**reddit-automation flowkit-labs/skills Did not beat the fake Scored below the fake on at least one task. Compared with no skill: clearly hurt.**

Label: Delete candidate Against the same-length placebo: below the fake `BELOW_PLACEBO`

### reddit-automation flowkit-labs/skills

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- rank (separated-down): with the skill 0.78 plus or minus 0.067082; with the same-length placebo 1 plus or minus 0.
- reply (underpowered): with the skill 0.7625 plus or minus 0.062915; with the same-length placebo 0.816667 plus or minus 0.143759.
- rules (underpowered): with the skill 0.875 plus or minus 0.144338; with the same-length placebo 1 plus or minus 0.

Against no skill: The skill clearly hurt: 0.806 with it and 0.958 without, on 3 test tasks.

0.806 with the skill and 0.958 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- rank (separated-down): with the skill 0.78 plus or minus 0.067082; without it 0.983333 plus or minus 0.028868.
- reply (underpowered): with the skill 0.7625 plus or minus 0.062915; without it 0.89 plus or minus 0.151658.
- rules (underpowered): with the skill 0.875 plus or minus 0.144338; without it 1 plus or minus 0.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `ecc1cb963a360697df5142934d4390b53ae7bcc091303a8d0c6ad56555757ebe`

**grill-with-docs mattpocock/skills tools on Did not beat the fake No task differed from the fake by enough to count. Compared with no skill: clearly helped.**

Label: Delete candidate Against the same-length placebo: no difference `NO_DIFFERENCE`

### grill-with-docs mattpocock/skills

Graded on the end state: each draw's score is its task's check, written before any call. The judge's grade of the reply is secondary and enters no reading.

Against the same-length placebo: case rule: no case differed from the same-length placebo at this effect floor

- gd-booking (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- gd-cart-order (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- gd-account-user (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.

Against no skill: The skill clearly helped: 1.000 with it and 0.833 without, on 3 test tasks.

1.000 with the skill and 0.833 without; on at least one of the 3 test tasks, the two ranges of scores (the average plus or minus one spread) did not overlap, and the gap was at least 0.05.

- gd-booking (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- gd-cart-order (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- gd-account-user (separated-up): with the skill 1 plus or minus 0; without it 0.5 plus or minus 0.

Draws with a Skill call to grilling: 9 of 9 with the skill, 6 of 9 with no skill, 9 of 9 with the placebo.

Recorded cost USD 31.97 over 27 generations, judging included.

Receipt `bb52fbbc6320aa3fc879ccaad9dcdc64f1680eb4ff4777fd4804f678efe9d2eb`

**agent-browser vercel-labs/agent-browser tools on Did not beat the fake No task differed from the fake by enough to count. Compared with no skill: no clear difference.**

Label: Delete candidate Against the same-length placebo: no difference `NO_DIFFERENCE`

### agent-browser vercel-labs/agent-browser

Graded on the end state: each draw's score is its task's check, written before any call. The judge's grade of the reply is secondary and enters no reading.

Against the same-length placebo: case rule: no case differed from the same-length placebo at this effect floor

- ab-ticket (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- ab-status (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- ab-note (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.

Against no skill: No clear difference: 1.000 with the skill and 1.000 without, with enough answers to have seen a gap of 0.05.

there were enough answers to have seen a gap of 0.05, and none of the 3 test tasks showed one.

- ab-ticket (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- ab-status (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- ab-note (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.

Recorded cost USD 79.80 over 27 generations, judging included.

Receipt `0b714814822b461a0fcc7bdb0f7e6ea45e195cc20977c10357596cfde49f3aa6`

**hyperframes heygen-com/hyperframes tools on Did not beat the fake No task differed from the fake by enough to count. Compared with no skill: no clear difference.**

Label: Delete candidate Against the same-length placebo: no difference `NO_DIFFERENCE`

### hyperframes heygen-com/hyperframes

Graded on the end state: each draw's score is its task's check, written before any call. The judge's grade of the reply is secondary and enters no reading.

Against the same-length placebo: case rule: no case differed from the same-length placebo at this effect floor

- hf-title (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- hf-logo (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- hf-caption (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.

Against no skill: No clear difference: 1.000 with the skill and 1.000 without, with enough answers to have seen a gap of 0.05.

there were enough answers to have seen a gap of 0.05, and none of the 3 test tasks showed one.

- hf-title (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- hf-logo (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- hf-caption (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.

Recorded cost USD 41.57 over 27 generations, judging included.

Receipt `2c4cb0f1a92b8c3e0c17849062ac709d62717436355b3bf25c07c81118c12f2e`

### Can't tell yet

**setup-matt-pocock-skills mattpocock/skills Can't tell yet Not enough answers to tell it from the fake. Compared with no skill: too few answers to tell.**

Label: Cannot tell Against the same-length placebo: not enough draws `UNDERPOWERED`

### setup-matt-pocock-skills mattpocock/skills

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- local (underpowered): with the skill 1 plus or minus 0; with the same-length placebo 0.983333 plus or minus 0.028868.
- labels (not-separated): with the skill 0.75 plus or minus 0; with the same-length placebo 0.75 plus or minus 0.
- monorepo (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.

Against no skill: Too few answers to tell: 0.917 with the skill and 0.907 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case monorepo: the two arms' spreads sum to 0.095, at or above the 0.05 floor).

- local (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- labels (underpowered): with the skill 0.75 plus or minus 0; without it 0.783333 plus or minus 0.028868.
- monorepo (underpowered): with the skill 1 plus or minus 0; without it 0.9375 plus or minus 0.094648.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `2b2e2930934e39b9ce3013b2b963adb1f886f24a14e0f3678eb52bb1eb219706`

**frontend-design anthropics/skills Can't tell yet Not enough answers to tell it from the fake. Compared with no skill: too few answers to tell.**

Label: Cannot tell Against the same-length placebo: not enough draws `UNDERPOWERED`

### frontend-design anthropics/skills

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- identity (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- brief (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- content (underpowered): with the skill 0.835714 plus or minus 0.114434; with the same-length placebo 0.875 plus or minus 0.112916.

Against no skill: Too few answers to tell: 0.945 with the skill and 0.980 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case content: the two arms' spreads sum to 0.169, at or above the 0.05 floor).

- identity (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- brief (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- content (underpowered): with the skill 0.835714 plus or minus 0.114434; without it 0.94 plus or minus 0.054772.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `03d93027ab744923fb42141d774614a030ab85728ab26e7b650a3b2c86a0c281`

**media-use heygen-com/hyperframes Can't tell yet Not enough answers to tell it from the fake. Compared with no skill: too few answers to tell.**

Label: Cannot tell Against the same-length placebo: not enough draws `UNDERPOWERED`

### media-use heygen-com/hyperframes

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- reuse (underpowered): with the skill 0.941667 plus or minus 0.102062; with the same-length placebo 0.7375 plus or minus 0.103078.
- logo (underpowered): with the skill 1 plus or minus 0; with the same-length placebo 0.966667 plus or minus 0.08165.
- grade (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.

Against no skill: Too few answers to tell: 0.981 with the skill and 0.942 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case reuse: the two arms' spreads sum to 0.131, at or above the 0.05 floor).

- reuse (underpowered): with the skill 0.941667 plus or minus 0.102062; without it 0.883333 plus or minus 0.028868.
- logo (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- grade (underpowered): with the skill 1 plus or minus 0; without it 0.941667 plus or minus 0.102062.

The placebo against no skill, shown here and not counted: PLACEBO_BELOW_BASELINE

Receipt `593f226fd71b4f3ada583bd7dbb755a6a5e2ebd44c81274b763aa5ce5485df22`

**find-skills vercel-labs/skills tools on Can't tell yet Not enough answers to tell it from the fake. Compared with no skill: too few answers to tell.**

Label: Cannot tell Against the same-length placebo: not enough draws `UNDERPOWERED`

### find-skills vercel-labs/skills

Graded on the end state: each draw's score is its task's check, written before any call. The judge's grade of the reply is secondary and enters no reading.

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- fs-changelog (underpowered): with the skill 0.777778 plus or minus 0.172133; with the same-length placebo 0.833333 plus or minus 0.19245.
- fs-pdf (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- fs-none (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.

Against no skill: Too few answers to tell: 0.926 with the skill and 0.926 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case fs-changelog: the two arms' spreads sum to 0.344, at or above the 0.05 floor).

- fs-changelog (underpowered): with the skill 0.777778 plus or minus 0.172133; without it 0.777778 plus or minus 0.172133.
- fs-pdf (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- fs-none (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.

Recorded cost USD 116.14 over 34 generations, judging included.

Receipt `745ed6e2dc62f204c0ccafd7b57e545027926fdf0486e61d633e3552a67854bc`

**grill-me mattpocock/skills tools on Can't tell yet Not enough answers to tell it from the fake. Compared with no skill: too few answers to tell.**

Label: Cannot tell Against the same-length placebo: not enough draws `UNDERPOWERED`

### grill-me mattpocock/skills

Graded on the end state: each draw's score is its task's check, written before any call. The judge's grade of the reply is secondary and enters no reading.

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- gm-report-app (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- gm-search-cache (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- gm-split-users (underpowered): with the skill 0.958333 plus or minus 0.102062; with the same-length placebo 1 plus or minus 0.

Against no skill: Too few answers to tell: 0.986 with the skill and 1.000 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case gm-split-users: the two arms' spreads sum to 0.102, at or above the 0.05 floor).

- gm-report-app (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- gm-search-cache (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- gm-split-users (underpowered): with the skill 0.958333 plus or minus 0.102062; without it 1 plus or minus 0.

Draws with a Skill call to grilling: 12 of 12 with the skill, 9 of 9 with no skill, 9 of 9 with the placebo.

Recorded cost USD 27.86 over 30 generations, judging included.

Receipt `b18ad267e07543695d8d1ca295187f051991fd065ba80d2e7707de5d4717042d`

**hyperframes-registry heygen-com/hyperframes tools on Can't tell yet Not enough answers to tell it from the fake. Compared with no skill: too few answers to tell.**

Label: Cannot tell Against the same-length placebo: not enough draws `UNDERPOWERED`

### hyperframes-registry heygen-com/hyperframes

Graded on the end state: each draw's score is its task's check, written before any call. The judge's grade of the reply is secondary and enters no reading.

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- hr-screen (underpowered): with the skill 0.888889 plus or minus 0.272166; with the same-length placebo 1 plus or minus 0.
- hr-grain (underpowered): with the skill 1 plus or minus 0; with the same-length placebo 0.888889 plus or minus 0.272166.
- hr-chart (not-separated): with the skill 0.666667 plus or minus 0; with the same-length placebo 0.666667 plus or minus 0.

Against no skill: Too few answers to tell: 0.852 with the skill and 0.889 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case hr-screen: the two arms' spreads sum to 0.272, at or above the 0.05 floor).

- hr-screen (underpowered): with the skill 0.888889 plus or minus 0.272166; without it 1 plus or minus 0.
- hr-grain (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- hr-chart (not-separated): with the skill 0.666667 plus or minus 0; without it 0.666667 plus or minus 0.

Recorded cost USD 282.40 over 33 generations, judging included.

Receipt `78dfbfddb6ffd4d2ad88cf2fa09b12bb175cbb3d285ec09172ffb080417e4708`

## Keep in mind

- The six skills marked tools on ran with tools on and were graded on what Claude Code did, not on its reply. That is not the same test as the other fourteen.
- Beating the fake is not the same as beating no skill. Each skill's details show both.
- Can't tell yet means there was not enough evidence to call it. It does not mean the skill had no effect.
- This is one model, Claude Fable 5.2, and three tasks per skill. It says nothing about other models or other tasks.

## Report 020: Fable 5.2 against Fable 5.1 on three skills

Three skills, each run on both models with the skill loaded. On Claude Fable 5.2, compared with Claude Fable 5.1:

- code-review-and-quality: scored higher on Fable 5.2.
- git-workflow-and-versioning: no clear difference.
- documentation-and-adrs: scored lower on Fable 5.2.

**The table, how it was run and its limits**

Its own section, outside the twenty-skill headline. Three of Addy Osmani's skills, one case each, run fresh on Claude Fable 5.2 and Claude Fable 5.1, with the skill and without it, judged by claude-haiku-5-5 at five samples. Each verdict reads the two with-skill arms against each other, in Report 011's labels; upward means Fable 5.2 scored above Fable 5.1.

No effort setting was passed: Fable 5.2 ran at its default, medium, and Fable 5.1 at its default, high. The table reads the two models as users get them, not at the same effort.

Report 020's judge differs from Report 011's, so Report 020's figures are not set beside Report 011's as if comparable.

| Skill | Fable 5.1, with the skill | Fable 5.2, with the skill | Verdict | Without the skill, context only (Fable 5.1; Fable 5.2) |
| --- | --- | --- | --- | --- |
| code-review-and-quality | 0.63 ± 0.13, 5 draws | 0.83 ± 0.03, 3 draws | separation detected, upward | 0.21 ± 0.00, 3 draws; 0.62 ± 0.07, 5 draws |
| git-workflow-and-versioning | 0.84 ± 0.01, 3 draws | 0.82 ± 0.02, 3 draws | no separation detected | 0.84 ± 0.01, 3 draws; 0.30 ± 0.00, 3 draws |
| documentation-and-adrs | 0.75 ± 0.03, 3 draws | 0.50 ± 0.08, 4 draws | separation detected, downward | 0.58 ± 0.14, 7 draws; 0.39 ± 0.05, 3 draws |

The means without the skill are context; no verdict is read from them.

### Limits

One case per skill. Nothing in the report describes how any of the three skills behaves on any other task, or how Fable 5.2 behaves in general.

Few draws. Each arm draws between 3 and 10 generations, and each case's band is the spread across its draws. With one case there is no spread across cases.

The judge is not Report 011's. The figures are comparable within Report 020 only.

The two models ran at their own default effort, medium and high.

It does not say which model is better at these skills in general, why a verdict reads as it does, or that no separation means the two models score alike. It does not compare any figure with Report 011 or with Reports 017, 018 or 019.

**How we testedThe headline as fixed before the run, the full method, the judge, the price, the run record and the limits.**

Placebo comparison report. Twenty skills on Fable 5.2, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5: fourteen graded on the reply, and six run with tools on and graded on what Claude Code left.

Report 019. Recorded on 11 Nov 2026. Answering model Claude Fable 5.2; judge Claude Haiku 5.5.

### The headline, as fixed before the run

Of the 14 skills graded on the reply, 10 beat the fake on Fable 5.2.

Of the 6 skills graded on the end state with tools on, 0 beat the fake on Fable 5.2.

10 of 20 skills beat the fake on Fable 5.2: by the case rule, each scored above the same-length placebo on at least one of three tasks and below it on none. A skill that did not beat the fake is not shown to do no better than it.

Of the 20 skills counted: 10 beat the fake, 1 below the fake, 3 no difference, 0 inconclusive, 6 not enough draws, 0 not measured.

Of the 20: ABOVE_PLACEBO 10, BELOW_PLACEBO 1, NO_DIFFERENCE 3, INCONCLUSIVE 0, UNDERPOWERED 6, NOT_MEASURED 0. Beat the fake means ABOVE_PLACEBO only.

In plain labels: of the fourteen, Keep 10, Delete candidate 1, Cannot tell 3; of the six, Keep 0, Delete candidate 3, Cannot tell 3.

Six of these skills hand work to other skills or tools, so they ran with tools on, after the other fourteen, and each was scored on what Claude Code ended up doing.

The note fixed before the text-only run counted these six differently; Maverick's ruling of 11 Nov 2026 counts them by their tools-on reading.

The six are scored on the end state; the fourteen on the reply. The two are not the same test.

Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.

The judge is claude-haiku-5-5 at five samples, a different model from the target. For the six, its grade of the reply is a secondary score and enters no reading.

No effort setting was passed, so claude-fable-5-2 ran at its catalog default, medium.

### The six, with tools on

What was installed, the same in every version of a skill: the called skills (grilling, domain-modeling and hyperframes-core), the command-line tools (git, npm and agent-browser), Chrome 155.0.8059.79, and local copies of the skills registry, an npm registry, the HyperFrames registry and a web app, each served on the draw's own loopback. There was no live internet: each draw's network was none or its own loopback. The router or pointer text was the only difference between the versions: the skill's text, no text, or a same-length placebo. The grade was the end state Claude Code left: files, installed skills, commands, app state and Skill calls, read by a check written before any call. The judge's grade of the reply was secondary and entered no reading.

Every version scored at or near the top on most tasks, so there was little room for a difference: 45 of 54 task means, one per task and version, were 0.9 or above.

Every version of the two pointer skills called grilling, because it was installed in all of them. Draws with a grilling call: grill-me 12 of 12 with the skill, 9 of 9 with no skill, 9 of 9 with the placebo; grill-with-docs 9 of 9 with the skill, 6 of 9 with no skill, 9 of 9 with the placebo.

Tools-on runs cost more than planned for 3 of the six. The plan projected USD 2.19 a generation and USD 0.01 a judged draw, from Report 016's 75th percentile at the Fable 5.2 estimate. Recorded cost a generation, judging included: find-skills USD 3.42, grill-me USD 0.93, grill-with-docs USD 1.18, agent-browser USD 2.96, hyperframes USD 1.54, hyperframes-registry USD 8.56. hyperframes-registry's first attempt stopped at its ceiling of USD 148.96 after USD 160.57 and was run again under a raised cap, with a ceiling of USD 662.08; both attempts' costs are counted.

### The same six as text-only receipts

Published and linked as context. They enter no count and no headline line.

**find-skills vercel-labs/skills (text-only, not counted) Did not beat the fake Scored below the fake on at least one task. Compared with no skill: no verdict, delegated skill not tested.**

Label: Delete candidate Against the same-length placebo: below the fake `BELOW_PLACEBO`

### find-skills vercel-labs/skills

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1).

Graded on the reply, with tools off. The tools-on reading above is the one counted.

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- search (separated-down): with the skill 0.733333 plus or minus 0.028868; with the same-length placebo 1 plus or minus 0.
- missing (underpowered): with the skill 0.97 plus or minus 0.067082; with the same-length placebo 1 plus or minus 0.
- scope (underpowered): with the skill 0.983333 plus or minus 0.028868; with the same-length placebo 1 plus or minus 0.

Against no skill: No verdict: delegated skill not tested.

The placebo against no skill, shown here and not counted: NO_DIFFERENCE

Receipt `3c132baf43df44ed15adbed42569afd59b606bf997dc80528ef8080c94758bb5`

**grill-me mattpocock/skills (text-only, not counted) Can't tell yet Not enough answers to tell it from the fake. Compared with no skill: too few answers to tell.**

Label: Cannot tell Against the same-length placebo: not enough draws `UNDERPOWERED`

### grill-me mattpocock/skills

About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts.

Graded on the reply, with tools off. The tools-on reading above is the one counted.

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- plan (underpowered): with the skill 0.683333 plus or minus 0.196638; with the same-length placebo 0.633333 plus or minus 0.10328.
- constraint (underpowered): with the skill 0.6 plus or minus 0.106066; with the same-length placebo 0.483333 plus or minus 0.160208.
- followup (underpowered): with the skill 0.9375 plus or minus 0.047871; with the same-length placebo 0.883333 plus or minus 0.028868.

Against no skill: Too few answers to tell: 0.740 with the skill and 0.717 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case plan: the two arms' spreads sum to 0.343, at or above the 0.05 floor).

- plan (underpowered): with the skill 0.683333 plus or minus 0.196638; without it 0.685714 plus or minus 0.146385.
- constraint (underpowered): with the skill 0.6 plus or minus 0.106066; without it 0.516667 plus or minus 0.028868.
- followup (underpowered): with the skill 0.9375 plus or minus 0.047871; without it 0.95 plus or minus 0.05.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `f76798ed009f4f5811dd935ffd1c215ad6675f6e3336c3a79ce1c0cd2e08aa4d`

**grill-with-docs mattpocock/skills (text-only, not counted) Can't tell yet Not enough answers to tell it from the fake. Compared with no skill: too few answers to tell.**

Label: Cannot tell Against the same-length placebo: not enough draws `UNDERPOWERED`

### grill-with-docs mattpocock/skills

About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in the pre-registered counts.

Graded on the reply, with tools off. The tools-on reading above is the one counted.

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- decision (underpowered): with the skill 0.95 plus or minus 0.057735; with the same-length placebo 0.93 plus or minus 0.097468.
- adr (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- revision (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.

Against no skill: Too few answers to tell: 0.983 with the skill and 0.976 without, but the scores varied too much to call it.

Not enough draws to conclude at this effect floor. Draws needed: no draw count at these spreads (case decision: the two arms' spreads sum to 0.148, at or above the 0.05 floor).

- decision (underpowered): with the skill 0.95 plus or minus 0.057735; without it 0.928571 plus or minus 0.090633.
- adr (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.
- revision (not-separated): with the skill 1 plus or minus 0; without it 1 plus or minus 0.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `adc67d2d503f41826a483cd7dbce047dfead9a30ab09a34acdb36e7bdad30b2f`

**agent-browser vercel-labs/agent-browser (text-only, not counted) Did not beat the fake Scored below the fake on at least one task. Compared with no skill: no verdict, delegated skill not tested.**

Label: Delete candidate Against the same-length placebo: below the fake `BELOW_PLACEBO`

### agent-browser vercel-labs/agent-browser

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1).

Graded on the reply, with tools off. The tools-on reading above is the one counted.

Against the same-length placebo: case rule: at least one case scored below the same-length placebo

- web (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- desktop (separated-down): with the skill 0.733333 plus or minus 0.028868; with the same-length placebo 0.92 plus or minus 0.09083.
- dashboard (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.65 plus or minus 0.1.

Against no skill: No verdict: delegated skill not tested.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `86257def619b1db544acda4b26b243fdb6ff419a7648936c22c4736bc54c8197`

**hyperframes heygen-com/hyperframes (text-only, not counted) Can't tell yet Not enough answers to tell it from the fake. Compared with no skill: no verdict, delegated skill not tested.**

Label: Cannot tell Against the same-length placebo: not enough draws `UNDERPOWERED`

### hyperframes heygen-com/hyperframes

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1).

Graded on the reply, with tools off. The tools-on reading above is the one counted.

Against the same-length placebo: case rule: Not enough draws to conclude at this effect floor

- existing (underpowered): with the skill 0.75 plus or minus 0; with the same-length placebo 0.8 plus or minus 0.093541.
- usage (not-separated): with the skill 1 plus or minus 0; with the same-length placebo 1 plus or minus 0.
- port (underpowered): with the skill 0.875 plus or minus 0.144338; with the same-length placebo 1 plus or minus 0.

Against no skill: No verdict: delegated skill not tested.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `d82a78f5d986f1822f98d56ad2f55370cdc51b3aad135d0f0bda156c6b319f38`

**hyperframes-registry heygen-com/hyperframes (text-only, not counted) Beat the fake Scored above the fake on at least one task, and below it on none. Compared with no skill: no verdict, delegated skill not tested.**

Label: Keep Against the same-length placebo: beat the fake `ABOVE_PLACEBO`

### hyperframes-registry heygen-com/hyperframes

These text tasks test the router's written response, not the delegated skill. [Report 015 Amendment 1](https://driftproofhq.com/reports/015/#amendment-1).

Graded on the reply, with tools off. The tools-on reading above is the one counted.

Against the same-length placebo: case rule: at least one case scored above the same-length placebo, and none below

- block (separated-up): with the skill 0.85 plus or minus 0.05; with the same-length placebo 0.483333 plus or minus 0.028868.
- component (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.8375 plus or minus 0.118145.
- search (separated-up): with the skill 1 plus or minus 0; with the same-length placebo 0.516667 plus or minus 0.028868.

Against no skill: No verdict: delegated skill not tested.

The placebo against no skill, shown here and not counted: UNDERPOWERED

Receipt `64045ab20a9d60331a66f90956f3f7f8b1361fb4881bf101c7d272b8e448291e`

### Method

These sections are the pre-registered notes, as fixed before each run: plan (a)'s for the text-only twenty, then spec 786's for the six with tools on.

**What each receipt shows**

Each of the 20 frozen attempts runs one skill of Report 017's frozen roster, the same pinned skill bytes and the same committed three-task suite, on claude-fable-5-2, graded by claude-haiku-5-5, with three arms: the skill text, no skill, and a text of the skill's length in bytes from the revision 1 fixed corpus (spec 440). The runner is Driftproof 0.28.0 and the CLI is Claude Code 2.1.311, on the claude-cli subscription surface.

The report shows two readings for each receipt, each in lib/verdict.js's own words:

- the verdict: `receiptVerdict`, the skill against no skill, in the receipt reader's words;
- the placebo reading: `placeboLine(placeboReading(receipt))`, the skill against the same-length text.

The verdict shown is the Report 019 receipt's own. The verdict reads only the skill and no-skill arms, so the placebo arm's replies move it in no way. No figure other than these readings and their counts enters the headline.

**The judge**

The judge is claude-haiku-5-5, the judge the judge policy fixes for the reports Driftproof publishes: "That judge is fixed at claude-haiku-5-5 and changed only rarely" (/judge-policy/). Reports 017 and 018 were graded by the same judge. No judge policy or registry entry moves for this plan.

The judge is a different model from the target. lib/receipt.js records no same-model limitation for this pair, and the plan pins that as `judge_relationship`. The report says nothing about judge accuracy.

**The effort setting**

No effort setting is passed, so the catalog default for claude-fable-5-2, medium, applies. That is the default a user of the CLI gets. The report says so beside the readings, and does not present them as the model at its highest effort.

**The price**

claude-fable-5-2 has no published price in this repository. Every cost figure of this report prices its calls at an estimate, USD 10 input and USD 50 output per million tokens, the most expensive known tier, and says so where it is shown. Metered spend on the subscription surface is USD 0.

**Report 019 stands alone**

The page and every Report 019 claim show no Report 017 or Report 018 reading, verdict, count or figure. One methods sentence names the design and what changed: Report 017's same-length placebo design, the same twenty skills, suites and placebo corpus, with claude-fable-5-2 answering, graded by the same fixed judge, on runner 0.28.0. The judge policy holds that "results scored by different graders are not compared directly"; here the grader is the same, and the target and runner are not, so the report compares nothing across reports: it does not subtract one reading from another, does not count skills that moved, and does not say which model a skill helps more.

**Which receipt is read**

The report reads exactly one sealed receipt per attempt id. It is the receipt the campaign's manifest chain records for that attempt, read through the campaign ledger. The first completed receipt is the only one: an attempt with a sealed receipt is never run again, and a second receipt for the same attempt id refuses the whole chain. No receipt is chosen after its results are seen.

An attempt without a receipt may be run again in a later invocation of the same frozen plan, at most three runs in all, its earlier costs counted against the USD 375 cap. Every failure stays in the ledger. A failure carries no reading, so running it again chooses nothing.

The campaign has one root directory. It keeps the plan and this note as first started and an append-only log with one line per start. A second start with no prior chain is refused, and a resume must continue the log's latest manifest. The report reads only the chain that ends at the log's latest manifest, and refuses if the root holds any other manifest under this plan. A cost correction may be added after a run and is never rewritten: each manifest records the corrections in force when it started.

**Terms**

"Beat the fake" means exactly one thing: the placebo reading is `ABOVE_PLACEBO`. In the reader's words, "case rule: at least one case scored above the same-length placebo, and none below". The case rule reads each of the three tasks by its draw bands, so this says no more than that, on at least one of three tasks, the skill's band sat above the placebo's at the effect floor, and on none below.

No other reading beats the fake. `BELOW_PLACEBO`, `NO_DIFFERENCE`, `INCONCLUSIVE`, `UNDERPOWERED` and `NOT_MEASURED` do not. None of them shows that a skill does no better than the fake.

A missing receipt reads `NOT_MEASURED`: a failed, cancelled or budget-stopped attempt is counted as not read, never as a result. A stub receipt also reads `NOT_MEASURED`.

**Secondary reading: the placebo against no skill**

Beside each skill, and never in the headline, the report shows a second reading: the same case rule over the placebo's rows against the no-skill rows of the same receipt (spec 613's `tally.cjs` `secondaryReading`). Its tokens are `PLACEBO_ABOVE_BASELINE`, `PLACEBO_BELOW_BASELINE`, `NO_DIFFERENCE`, `INCONCLUSIVE`, `UNDERPOWERED` and `NOT_MEASURED`. It is read only where the placebo reading is read, and refused wherever that is refused. It is not counted, not subtracted from the placebo reading, and not combined with it.

**With tools on: what runs**

Six skills from Report 019's roster: grill-me, grill-with-docs, find-skills, hyperframes-registry, agent-browser and hyperframes. Each runs on claude-fable-5-2 through Claude Code 2.1.311 in the repository lane's tools-on mode, with Report 019's pinned skill bytes. No effort setting is passed, so the catalog default for claude-fable-5-2, medium, applies.

Each attempt has three tasks and three arms: the skill as system text, no system text, and a same-length placebo from Report 019's corpus. Every arm of an attempt gets the same installed world: the called skills, the pinned command-line tools and hashed local fixtures on the draw's own loopback. Nothing reaches the internet. Each arm draws at least 3 and at most 6 times per task, by the runner's sampling rule.

**With tools on: how a draw is scored**

The primary score of a draw is its task's check, frozen in the plan by sha256. The check reads what Claude Code ended up doing: files, tool calls, Skill calls and the fixtures' state. For the two pointer skills it also reads the form of the reply: numbered questions, each with a recommended answer. No check credits an action from the reply's words.

The secondary score is the fixed judge's grade of the reply and its captured files: claude-haiku-5-5 at five samples, as the judge policy fixes it ("That judge is fixed at claude-haiku-5-5 and changed only rarely"). The secondary score never enters a verdict.

A draw whose end state cannot be read is not measured. It is never scored 0.

**With tools on: the readings**

Each skill's verdict and placebo reading are lib/verdict.js's own, read over the primary scores in its own words. Only `ABOVE_PLACEBO` beats the fake. An attempt without a verified receipt reads "not measured".

### Limits

The placebo text is not inert: on a task that supplies the facts its answer needs, a same-length text about landscape and village life can pull an answer off them, so the fake can score below no skill. The secondary reading shows where it did.

The projection in plan.json reprices Reports 017 and 018's recorded tokens at the claude-fable-5-2 estimate for generation and at Haiku 5.5 rates for judging. Fable 5.2 may answer at another length and draw another number of times, so the projection is a planning assumption, not a bound. The cap and each attempt's ceiling are the bounds.

It does not say why a skill helps, that a skill and the fake are the same, or that the fake carries no information about a task. It says nothing about a skill that was not run with the placebo arm. It does not combine the 20 readings into one score. It does not say how Fable 5.2, Sonnet 5.5 and Haiku 5.5 compare: no reading, verdict or count of Reports 015, 017 or 018 appears on the page or in any Report 019 claim.

- Three tasks per skill, and at most six draws per arm.
- The six are scored on the end state; the fourteen on the reply. The two are not the same test.
- The tools-on attempts run from the source branch at the commit their campaign records, not from a release. The receipt's runner version is the one config.js records at that commit.
- The cost is priced at an estimate for claude-fable-5-2, USD 10 and USD 50 per million tokens.

The placebo corpus was chosen without reference to any task, so a placebo text can still bear on a task by chance.

Unkeyed seals and retained outputs permit checking internal consistency; they do not authenticate an origin.

### Run record

Spend, read from the records. Report 019 text-only USD 140.06: USD 135.55 in the chain read here and USD 4.52 in stopped chains recorded in `specs/783-fable-5-2-scope/chains.json`. With tools on USD 790.31: USD 740.32 in the campaign manifest, the stopped attempt included, and USD 49.99 in smoke runs recorded in `specs/786-tools-on-routers/freeze.json`. Report 020 USD 10.03. Recorded costs are API-equivalent estimates, not a subscription invoice, with claude-fable-5-2 priced at an estimate of USD 10 input and USD 50 output per million tokens. Metered spend on the subscription surface was USD 0.

The text-only twenty: plan SHA-256 `e557c3b4a5849ccfff353352a55c28742becdb5cb51be68fe9b06d0ebb7171ce`, pre-registered note SHA-256 `76e1913b0ae3bec0f91ef72b72685922af2906e977320d35a595b77161676a94`, run at `17cdf896f7cf7fab190f663d247051321f0c6b3f`, runner 0.28.0, Claude Code 2.1.311.

1. `receipts/report-019/campaign-001/manifest.json`, SHA-256 `d8556d35959da7e3e884571f0377d45b8e2cae7eba06a11c24ff33fbd0ff6b11`
2. `receipts/report-019/campaign-002/manifest.json`, SHA-256 `3ae34883ab2858618db65e0325cff9f87f044c60381c81446827eeb998b043cf`
3. `receipts/report-019/campaign-003/manifest.json`, SHA-256 `5c4d439a3a1dd26354cd9c490d300f88adc862916e984f0db230b42487604bda`

The six with tools on: plan SHA-256 `f7968ae3753384d767b70873bc3f646857abc8afdc8c077483645d66f36808e0`, pre-registered note SHA-256 `25f0f51911413fc75ceca2020db64a5afc0cbaec4fef7f7e42dbdfc7f9af6f74`, manifest `receipts/report-019-tools-on/manifest.json`, SHA-256 `d06a8f03b59752815559e074f9ebd51f6e9424e7784750f2eb4a8bf6e39c0659`. Each attempt ran from the source branch at the commit its start records, runner 0.28.0, Claude Code 2.1.311:

1. commit `46beb63c22adae7ff5b735649695e21fd27be2d2`, plan SHA-256 `f77e92a516922e374457431cfc46f2240288e8094998b0b7f24fbee83aa5b3a1`
2. commit `7be8f9bdf0a1990c2858b3e39b9322110102289e`, plan SHA-256 `a311cf94cf1c7b3dce6a2ea9d420315d4267270086a001e5f48311f58d198145`
3. commit `7be8f9bdf0a1990c2858b3e39b9322110102289e`, plan SHA-256 `a311cf94cf1c7b3dce6a2ea9d420315d4267270086a001e5f48311f58d198145`
4. commit `2a6f9dc5d611fc61727d2faee907c64be5b83e15`, plan SHA-256 `c618cf2f86ed03769dcea43f15bf99e1856e673c1ddb62f91995f3f3e16bfeaa`
5. commit `2a6f9dc5d611fc61727d2faee907c64be5b83e15`, plan SHA-256 `c618cf2f86ed03769dcea43f15bf99e1856e673c1ddb62f91995f3f3e16bfeaa`
6. commit `4229a9db7969601e38c5b32e253e8af132a170bf`, plan SHA-256 `f7968ae3753384d767b70873bc3f646857abc8afdc8c077483645d66f36808e0`

Report 020: plan SHA-256 `40d30de73cafa2dbac9ae0303401f43d8ff50c4a55f2369ba4283f528d85e445`.

1. `receipts/report-020/campaign-001/manifest.json`, SHA-256 `38a0cb2b90ffeac399cd5e9deb358473ee0816af217dadc74ec56cde6b3157d0`, commit `8550f3b03c52052e2c5a681d570a20107b58480e`

The retained answers of handoff's text-only receipt show the eval account's home directory as `~/` in 5 answers. The reader restores the original from the account name and checks it against the hash the receipt seals.

Read and built by:

- `scripts/prepare-report-019.js`, SHA-256 `b493a739bc93d18c71fe6def89661b28b1c7ab7658927460be4049257d9c5e51`
- `scripts/report-019-reader.js`, SHA-256 `7764c59353736dca5f74d4d8265d2b1fb1e126e17fb0a95185e176b980a91d16`
- `scripts/answer-redaction.js`, SHA-256 `d17de4ffeb1e120a7ad6df063d2016fd93f8d937095545abe9c5dfb9fa4f086c`
- `specs/783-fable-5-2-scope/placebo/run-campaign.cjs`, SHA-256 `22dcd101c6319ec07fe5091d950e63bbe7fd6e749e2b6e728d21f530fb2c3a2c`
- `specs/783-fable-5-2-scope/boundary/run-campaign.cjs`, SHA-256 `0fba7b1e86a5f8dc002448d40141fb26c66765d0bac463cb8f0a00380ce3d5ff`
- `specs/613-placebo-skills-report/run-campaign.cjs`, SHA-256 `db070608736eb9401fb8acf6a15cf800deeefbd706b18a92383242ef6609af6a`
- `specs/613-placebo-skills-report/tally.cjs`, SHA-256 `a7d334796f32591a9488baa2286e3ba9462305ff6a92b8b2f0c7695a96a415dd`
- `specs/408-skill-measurements/ledger.cjs`, SHA-256 `263a3d3423feea70aaf90074a58bcaf48d4ddb8b0eea262ec634450b17b63aae`
- `specs/786-tools-on-routers/world.cjs`, SHA-256 `e94047b18e0919ab60fde49503bca828af893bf33d0e36522ba7191775e9d9aa`
- `lib/verdict.js`, SHA-256 `c09edd5e1a8c62c43fa0e0d1f1a268d5d6076e474846e2cf9247a1f0e35b5b6e`
- `lib/plain.js`, SHA-256 `46f471b1487460b6101680f0b4c1191e358611020f326898e37f0e420011dbb9`
- `lib/receipt.js`, SHA-256 `15af7a7c568cce78ed97c3625adaee79da513d2ca71fc6743492446b97bbaba5`
- `scripts/offer.js`, SHA-256 `a920697a907038dc809a99ddd590b664bb7edd88f5d622cc78c3162689f7e995`

## Receipts

- [improve-codebase-architecture, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-001/c62698b9ae89a64d7c90bd052726325b73d11d27ecbbddc35be0a1d98d34a78d.json)
- [tdd, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-001/5bd5206842618e0932b9563c7518e70fc69d45cd06818720938b6d7361707314.json)
- [hyperframes-cli, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-001/21bc2b519cedb7608732d7bd499b2387d59769ab985d6b8d17a3456eb6a583b1.json)
- [setup-matt-pocock-skills, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-002/626a69e42b5fcd2be71477eac03e0c4e76d50cb04546a37b9fdfe70d36254b9a.json)
- [handoff, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-002/ae8e878d5e2a63d8f6ef6983e88a6e2fd77b516e808d24baa667d20da2ab31ca.json)
- [frontend-design, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-002/c82df3adc8a7631ba87488a4db3771fefe958ef48217537f1f30dfff68b38a0c.json)
- [reddit-automation, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-002/2f03edf233b827a82579511775036d487d3b9369d3eda3ec3204e7748e488945.json)
- [triage, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-002/726192d0f1cc5ec8f23fd84ca9c54c06ec79005355c192aa74a6cbaff8e85088.json)
- [prototype, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-002/45da1a35ef2ccc8e9825f27a36b518d6606e425fb0d3cac14d2e6400860cb9f0.json)
- [media-use, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-002/2ad5ec754dda3fd3d782558c383f4218a73ad1a8199095662f3398978522fccf.json)
- [grilling, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-002/85f03bc4fc2e3a9c751b7984e6afd7cfc9a3168203741e689b22dac4f501a7ad.json)
- [hyperframes-animation, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-002/9be630ae7a35a78f2534c1e29755b35db4bf2ef23372300414d0137e98b8a0a2.json)
- [design-mobile-apps, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-003/304abd48d0125d6586f0aa1e76392e0a6d7ac31495d5fe0f18466b0a6cf32729.json)
- [hyperframes-core, graded on the reply](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-003/caabb99bb2edfc08a914793db13685b381c0f91c46a66de76d560d816741177e.json)
- [find-skills, with tools on](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019-tools-on/00a638a7812a8e67e34beb8336fe7725066c55ed0302c075cdb31de2ea133527.json)
- [grill-me, with tools on](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019-tools-on/13c239e5d407d0993a99a1b8ffbcbcaf7be88b5affda7ba801c57d01045307ae.json)
- [grill-with-docs, with tools on](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019-tools-on/79902cd64985d7bf40da5b020aa4ac7b6a63c5af1f1def8fbd27ccd184f898e6.json)
- [agent-browser, with tools on](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019-tools-on/e81b52eb344484fc121a225d61651db11b832f9b0d4a1dfe7818cc54f88bcc81.json)
- [hyperframes, with tools on](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019-tools-on/e449f0682d83d2d3fd8413e224b0de22796fa0d4484a8c31ddbb788c2c0ea5c7.json)
- [hyperframes-registry, with tools on](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019-tools-on/550e8212d6d04662ee0048bf0f49e98bf8a29814da53e04f5c915c8cd35d13db.json)
- [find-skills, text-only context](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-001/cc2b7a60f5aa0f2f279458644e20a36e6f76cad22e7aeca003a987156d423e52.json)
- [grill-me, text-only context](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-001/465872f444707e1bc6136ecf7d7d88dbe03530fc423ae0051a86a3851b27c450.json)
- [grill-with-docs, text-only context](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-001/f4d05d9dd07199470fddf7dd53bb4d164674bdc1aec602b7b14ad898e3c37bbb.json)
- [agent-browser, text-only context](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-001/d9aaeaf27d327f8379f96eb2d7e7f8e92e73f03f0ddd76b00c4b67dfa95d4ce3.json)
- [hyperframes, text-only context](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-001/119f0c818fa4bdc55098a40f3558ec9e34a15902f9c6fafa31fe097b0bc90b59.json)
- [hyperframes-registry, text-only context](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-019/campaign-003/c4bb25a00a5c878056440f80de2eea236401c46d77d325c54ed0bb8660a5273f.json)
- [Report 020, code-review-and-quality-claude-fable-5-2-2026-11-10-ecd030219862](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-020/campaign-001/330ae95e80d0b092b116e062686848a53dc968d1a4a1aa33f253290e28766115/receipts/code-review-and-quality-claude-fable-5-2-2026-11-10-ecd030219862.json)
- [Report 020, git-workflow-and-versioning-claude-fable-5-2-2026-11-10-f36e3107e67a](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-020/campaign-001/7d3326436dde46f8089c22962dae75f0bb48b3ac522771626ca0a43faa1ac538/receipts/git-workflow-and-versioning-claude-fable-5-2-2026-11-10-f36e3107e67a.json)
- [Report 020, documentation-and-adrs-claude-fable-5-2-2026-11-10-dca693a087ec](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-020/campaign-001/fd0aa79a49701c6f88757b2ba0ebfde9d55d5d5b61043e1b13c3afb87e81628f/receipts/documentation-and-adrs-claude-fable-5-2-2026-11-10-dca693a087ec.json)
- [Report 020, code-review-and-quality-claude-fable-5-1-2026-11-10-79216e2ce275](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-020/campaign-001/b6bbc3a6a2336de8b58654b92bb9fbfc210b4f5701f082f7ec6287d352f06cc4/receipts/code-review-and-quality-claude-fable-5-1-2026-11-10-79216e2ce275.json)
- [Report 020, git-workflow-and-versioning-claude-fable-5-1-2026-11-10-67e3d1e37b65](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-020/campaign-001/af5fe40411697d788d1c9ac2f1fdbab046c0dff2f8581d18571d7c1fbe287eb8/receipts/git-workflow-and-versioning-claude-fable-5-1-2026-11-10-67e3d1e37b65.json)
- [Report 020, documentation-and-adrs-claude-fable-5-1-2026-11-10-e54efd3b4c03](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-020/campaign-001/aae8d5c9cf08078a6e6283ee335d68937b3af162ebfcdb88a5fb1655a47279da/receipts/documentation-and-adrs-claude-fable-5-1-2026-11-10-e54efd3b4c03.json)
