# Agent skill evaluation

Canonical: <https://driftproofhq.com/agent-skill-evaluation/>

## How can I tell whether an agent skill actually improved output?

We run a skill's own test tasks with the skill and without it, score every answer several times, and call a change only when it is clearly bigger than the usual spread of the scores. What the skill adds is the average with the skill minus the average without it.

Each side's spread is its average plus or minus the usual variation of its scores. If the two spreads overlap, we do not call a change. The averages must differ by at least [0.05](https://driftproofhq.com/methodology/#the-drift-verdict-rule-anti-false-positive). The grader scores on a coarse grid of about [0.05](https://driftproofhq.com/methodology/#the-drift-verdict-rule-anti-false-positive) to [0.1](https://driftproofhq.com/methodology/#the-drift-verdict-rule-anti-false-positive), so [0.05](https://driftproofhq.com/methodology/#the-drift-verdict-rule-anti-false-positive) is about one step of it. A smaller gap is not called, even when the spreads are apart.

A skill's own tests passing is one answer. Driftproof asks two more: whether the scores with the skill and without it separate beyond their spread, and whether that held when the model changed. A clear difference is what these tests saw, not proof that the skill itself changed.

A task may also carry plain checks on the answer that simply pass or fail, with no model judging: for example, that a commit message starts with the expected kind of first line. They sit beside the grader's scores as extra evidence. They never decide whether we call a change.

## How should I handle variance in agent evaluations?

A fixed grader, another model, scores every answer several times. So each task gets a spread of scores, not one fragile number. Each arm is generated at least three times, and more until the across-draw spread settles.

Every report published before [Report 007](https://driftproofhq.com/reports/007/) used a single generation per arm, judged several times, so its bands measured the judge and not the model. [Report 006](https://driftproofhq.com/reports/006/)'s probe measured generation noise at [3.2×](https://driftproofhq.com/methodology/#where-a-band-comes-from) and [7.5×](https://driftproofhq.com/methodology/#where-a-band-comes-from) the judge noise on the two cases it probed, ten draws each.

Repeat runs of the same test did not always agree: five of the nine comparisons gave a different result in one run than in another. Claude Opus 5.5’s score on code review without the skill was [0.831](https://driftproofhq.com/reports/013/#what-the-runs-show), [0.857](https://driftproofhq.com/reports/013/#what-the-runs-show) and [0.713](https://driftproofhq.com/reports/013/#what-the-runs-show) across the three runs. One run alone could have told a different story. ([Report 013](https://driftproofhq.com/reports/013/): Claude Opus 5.5, Claude Sonnet 5 and Claude Sonnet 5.5)

When a change is not called, a report says which of two things it saw. If the scores were so spread out that a gap of [0.05](https://driftproofhq.com/methodology/#the-drift-verdict-rule-anti-false-positive) could not show, or a side had only one answer, there were too few answers to tell. Otherwise the spreads overlapped or the gap was too small, and there was no clear difference. Neither means that nothing changed.

A case the rule does not separate is also asked whether it could have been separated. Its resolution is the two arms' spreads added together, plus two standard errors of the difference between their means; when that reaches the [0.05](https://driftproofhq.com/methodology/#the-drift-verdict-rule-anti-false-positive-precise) floor, or when an arm has a single draw, the case is underpowered, and a receipt with no separated case and an underpowered one reads UNDERPOWERED, in words: Not enough draws to conclude at this effect floor. The badge, the Action and the comparison report print the draws per arm that would have been needed with the spreads held, or say that no draw count reaches the floor when the spreads alone do, because more draws narrow the standard error and not the spread.

## More answers

- [What is Driftproof?](https://driftproofhq.com/what-is-driftproof/)
- [Does a skill still help after a model upgrade?](https://driftproofhq.com/agent-skill-regression-testing/)
- [What each evaluation tool measures](https://driftproofhq.com/compare/)
- [The paper](https://driftproofhq.com/paper/)
