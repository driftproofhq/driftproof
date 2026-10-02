# Agent skill regression testing

Canonical: <https://driftproofhq.com/agent-skill-regression-testing/>

## Does a SKILL.md still help after upgrading Claude?

With the skill loaded, Claude Sonnet 5.5 scored clearly higher than Claude Sonnet 5 on documentation in two of three runs. On code review and git workflow it was never clearly higher or lower: each run gave no clear difference or too few answers to tell. ([Report 013](https://driftproofhq.com/reports/013/): Claude Opus 5.5, Claude Sonnet 5 and Claude Sonnet 5.5)

On code review, the skill moved Claude Sonnet 5.5’s average by [+0.009](https://driftproofhq.com/reports/013/#what-the-runs-show), [+0.051](https://driftproofhq.com/reports/013/#what-the-runs-show) and [+0.034](https://driftproofhq.com/reports/013/#what-the-runs-show) in the three runs; without the skill it averaged [0.878](https://driftproofhq.com/reports/013/#what-the-runs-show), [0.849](https://driftproofhq.com/reports/013/#what-the-runs-show) and [0.861](https://driftproofhq.com/reports/013/#what-the-runs-show). For Claude Sonnet 5 the skill moved it by [+0.302](https://driftproofhq.com/reports/013/#what-the-runs-show), [+0.207](https://driftproofhq.com/reports/013/#what-the-runs-show) and [+0.085](https://driftproofhq.com/reports/013/#what-the-runs-show). These figures are context, not a verdict. Each skill was tested on one task only. Nothing here says how these skills do on other tasks, or how these models do at coding in general. ([Report 013](https://driftproofhq.com/reports/013/): Claude Opus 5.5, Claude Sonnet 5 and Claude Sonnet 5.5)

## How do I compare an agent skill across model releases?

Diffing two receipts yields a per-case verdict. A verdict reads the with-skill arms only. The runner’s comparison of two receipts sets one receipt’s with-skill band against the other’s, per case. ([Report 011](https://driftproofhq.com/reports/011/): Claude Opus 5 and Claude Opus 5.5)

A receipt records what produced its numbers: the model, the tools, the skill and the tasks by their content, and the grader with its instructions. The stale command compares those with what would run today and says what has moved.

Claude Opus 5.5 on the three skills and cases of [Report 009](https://driftproofhq.com/reports/009/), one case each, beside a fresh Claude Opus 5 arm on the same harness. Between the two models, the rule detects no separation on any of the three skills, and on two of them the draws could not have told. None of this is evidence that the two models score these skills alike. On two skills the two models’ baselines sit further apart than their with-skill scores, and no verdict here reads them. ([Report 011](https://driftproofhq.com/reports/011/): Claude Opus 5 and Claude Opus 5.5)

For scale, from our own runs: [Report 009](https://driftproofhq.com/reports/009/) ran on Claude Code [2.1.272](https://driftproofhq.com/methodology/#receipts-are-an-open-format-precise) on [15](https://driftproofhq.com/methodology/#receipts-are-an-open-format-precise) September, and on [23](https://driftproofhq.com/methodology/#receipts-are-an-open-format-precise) September [Report 011](https://driftproofhq.com/reports/011/) needed [2.1.280](https://driftproofhq.com/methodology/#receipts-are-an-open-format-precise) or newer.

This report runs every arm three times, one after another, with the same script and settings, because one run’s figure can move in the next: [Report 011](https://driftproofhq.com/reports/011/)’s Claude Opus 5.5 baseline on code-review-and-quality read [0.68](https://driftproofhq.com/reports/013/#limits), and the same arm in this report’s run [1](https://driftproofhq.com/reports/013/#limits) read [0.83](https://driftproofhq.com/reports/013/#limits). All three models ran on the same Claude Code, version [2.1.284](https://driftproofhq.com/reports/013/#limits-and-what-differs-from-reports-009-and-011); [Report 009](https://driftproofhq.com/reports/009/) used [2.1.272](https://driftproofhq.com/reports/013/#limits-and-what-differs-from-reports-009-and-011) and [Report 011](https://driftproofhq.com/reports/011/) used [2.1.280](https://driftproofhq.com/reports/013/#limits-and-what-differs-from-reports-009-and-011). ([Report 013](https://driftproofhq.com/reports/013/): Claude Opus 5.5, Claude Sonnet 5 and Claude Sonnet 5.5)

## More answers

- [What is Driftproof?](https://driftproofhq.com/what-is-driftproof/)
- [How to tell whether a skill improved output](https://driftproofhq.com/agent-skill-evaluation/)
- [What each evaluation tool measures](https://driftproofhq.com/compare/)
- [The paper](https://driftproofhq.com/paper/)
