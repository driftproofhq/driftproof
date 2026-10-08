# What is Driftproof?

Canonical: <https://driftproofhq.com/what-is-driftproof/>

Driftproof (driftproofhq): open-source agent skill evaluation and regression testing across model releases. It runs a skill's own tests with the skill and without it, scores every answer several times, and calls a change only when it is clearly bigger than the usual spread. Each result is a dated, hash-verified receipt.

## What it measures

For each task in a skill's own test set, Driftproof asks the model twice: once with the skill's instructions loaded, and once with the task alone. The model answers each way several times. What the skill adds is the average with the skill minus the average without it.

A receipt records what produced its numbers: the model, the tools, the skill and the tasks by their content, and the grader with its instructions. The stale command compares those with what would run today and says what has moved.

## What it does not measure

A clear difference is what these tests saw, not proof that the skill itself changed. Raw scores across companies are background, never a ranking.

Any constant style preference the judge holds toward a provider is present in both the with-skill and the baseline run for that provider, so taking the difference reduces it, though it is not cancelled.

## How it differs from a skill's own tests and from other eval tools

A skill's own tests passing is one answer. Driftproof asks two more: whether the scores with the skill and without it separate beyond their spread, and whether that held when the model changed.

What each other tool measures, and whether it compares a task with the skill and without it, as its own docs say. The full table: [What each evaluation tool measures](https://driftproofhq.com/compare/).

- **claude plugin eval (Claude Code)**. What it measures: How reliably a plugin (including a skill shipped as a plugin) leads Claude to the right outcome on eval cases, and what it contributes against a no-plugin baseline ([source, read 30 September 2026](https://code.claude.com/docs/en/plugin-evals)). With and without the skill: Yes, by default: a with-plugin arm and a no-plugin arm, reported as WITH, W/OUT and delta; --ablation none turns it off ([source, read 30 September 2026](https://code.claude.com/docs/en/plugin-evals)).
- **alibaba/skill-up**. What it measures: A Skill's behaviour across declarative cases (response, tool calls and workspace changes), optionally compared with and without the Skill; it also evaluates agents and workspaces without a Skill ([source, read 30 September 2026](https://github.com/alibaba/skill-up/blob/7f1ff9b8e2d7c654728de526867f2f7e7b78ea51/README.md#L54); [source, read 30 September 2026](https://github.com/alibaba/skill-up/blob/7f1ff9b8e2d7c654728de526867f2f7e7b78ea51/README.md#L52)). With and without the skill: Yes, opt-in: benchmark mode (benchmark.enabled: true or --baseline) runs each case with_skill and without_skill and reports the delta; disabled by default ([source, read 30 September 2026](https://github.com/alibaba/skill-up/blob/7f1ff9b8e2d7c654728de526867f2f7e7b78ea51/docs/guide/writing-evals.md#L865); [source, read 30 September 2026](https://github.com/alibaba/skill-up/blob/7f1ff9b8e2d7c654728de526867f2f7e7b78ea51/docs/guide/writing-evals.md#L879)).
- **NVIDIA SkillEvaluator**. What it measures: Three tiers: static validation (safety, well-formedness), deduplication (repeated or overlapping guidance), and live evaluation of whether the skill helps a real agent, reported on five dimensions (security, correctness, discoverability, effectiveness, efficiency) ([source, read 30 September 2026](https://github.com/NVIDIA/SkillEvaluator/blob/d0157411fe6c6eb949f832983bf671dfd1b9c701/README.md#L14-L15); [source, read 30 September 2026](https://github.com/NVIDIA/SkillEvaluator/blob/d0157411fe6c6eb949f832983bf671dfd1b9c701/docs/tier3-live-evaluation.mdx#L7-L8); [source, read 2 October 2026](https://github.com/NVIDIA/SkillEvaluator/blob/d0157411fe6c6eb949f832983bf671dfd1b9c701/README.md#L29); [source, read 2 October 2026](https://github.com/NVIDIA/SkillEvaluator/blob/d0157411fe6c6eb949f832983bf671dfd1b9c701/docs/reports.mdx#L246-L247)). With and without the skill: Yes, by default in Tier [3](https://github.com/NVIDIA/SkillEvaluator/blob/d0157411fe6c6eb949f832983bf671dfd1b9c701/docs/tier3-live-evaluation.mdx#L7): a with-skill arm and a baseline arm in a sandbox; --skip-baseline removes the baseline and the lift ([source, read 30 September 2026](https://github.com/NVIDIA/SkillEvaluator/blob/d0157411fe6c6eb949f832983bf671dfd1b9c701/docs/tier3-live-evaluation.mdx#L17-L20); [source, read 2 October 2026](https://github.com/NVIDIA/SkillEvaluator/blob/d0157411fe6c6eb949f832983bf671dfd1b9c701/docs/tier3-live-evaluation.mdx#L7)).
- **agent-skills-eval**. What it measures: Whether a SKILL.md makes a model better at the task on the skill's evals/evals.json prompts, judged against declared assertions ([source, read 30 September 2026](https://github.com/darkrishabh/agent-skills-eval/blob/f10ae2b3c93055cadd82c02a3b7fe4cfbd9a4645/README.md#L11)). With and without the skill: Yes, opt-in: --baseline (config baseline: true) runs each eval with_skill and without_skill; the default is false ([source, read 30 September 2026](https://github.com/darkrishabh/agent-skills-eval/blob/f10ae2b3c93055cadd82c02a3b7fe4cfbd9a4645/README.md#L118); [source, read 30 September 2026](https://github.com/darkrishabh/agent-skills-eval/blob/f10ae2b3c93055cadd82c02a3b7fe4cfbd9a4645/README.md#L173)).

## The published evidence

Every published report, newest first.

- [Report 014](https://driftproofhq.com/reports/014/): Claude Haiku 5.5 on release day, three skills
- [Report 013](https://driftproofhq.com/reports/013/): Claude Sonnet 5.5, the day after its release
- [Report 011](https://driftproofhq.com/reports/011/): Claude Opus 5.5 on release day, three skills
- [Report 010](https://driftproofhq.com/reports/010/): repeated ADR evaluations across two Claude Code configurations
- [Report 009](https://driftproofhq.com/reports/009/): three skills under two eval harnesses
- [Report 008](https://driftproofhq.com/reports/008/): the skill stabilises the floor, not the ceiling
- [Report 007](https://driftproofhq.com/reports/007/): the baseline is the noisy arm
- [Report 006](https://driftproofhq.com/reports/006/): the skill text moves, the substrate holds still
- [Report 005](https://driftproofhq.com/reports/005/): what does a skill cost to run?
- [Report 004](https://driftproofhq.com/reports/004/): does encoded expertise still lift output on the frontier tier?
- [Report 003](https://driftproofhq.com/reports/003/): do skill verdicts hold across a model release?
- [Report 002](https://driftproofhq.com/reports/002/): does a skill's benefit hold across substrates?
- [Report 001](https://driftproofhq.com/reports/001/): do skill verdicts hold across a model release?

## The paper

[Reported, Not Measured: An Empirical Study of Measurement Defects in LLM and Agent Evaluation Tools](https://driftproofhq.com/paper/). Preprint, not peer reviewed. DOI [10.5281/zenodo.23050796](https://doi.org/10.5281/zenodo.23050796).

## The software

- [github.com/driftproofhq/driftproof](https://github.com/driftproofhq/driftproof)
- [www.npmjs.com/package/driftproof](https://www.npmjs.com/package/driftproof)

## Upstream fixes and independent mentions

Fixes merged upstream, each a row of the paper's defect table:

- [addyosmani/agent-skills pull request #576](https://github.com/addyosmani/agent-skills/pull/576). Grader results validated by count and arithmetic, never bound to expectation ids. Merged by the repository owner on [17 September 2026](https://github.com/addyosmani/agent-skills/pull/576).
- [addyosmani/agent-skills pull request #587](https://github.com/addyosmani/agent-skills/pull/587). Prior run's .grading.json survives a rejected grading; no run identity recorded. Merged by the repository owner on [20 September 2026](https://github.com/addyosmani/agent-skills/pull/587).
- [addyosmani/agent-skills issue #591](https://github.com/addyosmani/agent-skills/issues/591) and [addyosmani/agent-skills pull request #598](https://github.com/addyosmani/agent-skills/pull/598). ADR eval's third expectation not in SKILL.md; verdict flips at one commit. Merged by the repository owner on [26 September 2026](https://github.com/addyosmani/agent-skills/pull/598).
- [addyosmani/agent-skills issue #599](https://github.com/addyosmani/agent-skills/issues/599) and [addyosmani/agent-skills pull request #600](https://github.com/addyosmani/agent-skills/pull/600). Floor guard passes on untracked suppressions, deleted tests and raised maximums; [7](https://zenodo.org/records/23050796/files/defects.csv) of [14](https://zenodo.org/records/23050796/files/defects.csv) cases fail. Merged by the repository owner on [26 September 2026](https://github.com/addyosmani/agent-skills/pull/600).

Mentions by people outside the project:

- [JeanJeanLeM/GhostFrame pull request #3](https://github.com/JeanJeanLeM/GhostFrame/pull/3). The repository owner opened it on [28 September 2026](https://github.com/JeanJeanLeM/GhostFrame/pull/3); it cites a Driftproof DEV post as its source.
- [addyosmani/agent-skills issue #433](https://github.com/addyosmani/agent-skills/issues/433#issuecomment-5443755555). A repository collaborator mentioned Driftproof in a comment on [27 August 2026](https://github.com/addyosmani/agent-skills/issues/433#issuecomment-5443755555).
- [addyosmani/agent-skills issue #433](https://github.com/addyosmani/agent-skills/issues/433#issuecomment-5454447746). A repository collaborator mentioned Driftproof in a comment on [28 August 2026](https://github.com/addyosmani/agent-skills/issues/433#issuecomment-5454447746).

## The name

This Driftproof, the project at driftproofhq, is unrelated to other projects that use the name.

## More answers

- [How to tell whether a skill improved output](https://driftproofhq.com/agent-skill-evaluation/)
- [Does a skill still help after a model upgrade?](https://driftproofhq.com/agent-skill-regression-testing/)
- [What each evaluation tool measures](https://driftproofhq.com/compare/)
- [The paper](https://driftproofhq.com/paper/)
