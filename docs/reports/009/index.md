# Report 009: three skills under two eval harnesses

Canonical: <https://driftproofhq.com/reports/009/>

## What did Report 009 find?

- On [15 Sep 2026, Claude Opus 5 with the `code-review-and-quality` skill scored 0.918 on average, and 0.783 without it, over one test task](https://driftproofhq.com/r/4e3e1dddda5592ac7a54864995a19e33ea8d50ed72330a64cbcc9ee4c30b8f4f/): the skill clearly helped.
- On [15 Sep 2026, Claude Opus 5 with the `documentation-and-adrs` skill scored 0.822 on average, and 0.532 without it, over one test task](https://driftproofhq.com/r/3f52ddb6b849ee54d1ea4e137f7f797a3f6b58f8f38f05ee8442a6a48321f50b/): the skill clearly helped.
- On [15 Sep 2026, Claude Opus 5 with the `git-workflow-and-versioning` skill scored 0.862 on average, and 0.300 without it, over one test task](https://driftproofhq.com/r/2df794c7f2539a9ce4701a03997b667c90cef8c2136a77eabf39313df5b7af33/): the skill clearly helped.
- On 15 Sep 2026, in the plugin eval built into Claude Code, with Claude Opus 5, [`code-review-and-quality` passed 3 of 3 runs with the plugin and 3 of 3 without it, on one test task](https://driftproofhq.com/reports/009/evidence/three-skill-comparison--native--code-review-and-quality--results--aggregate-result.json); [`documentation-and-adrs` passed 3 of 3 runs with the plugin and 1 of 3 without it, on one test task](https://driftproofhq.com/reports/009/evidence/three-skill-comparison--native--documentation-and-adrs--results--aggregate-result.json); and [`git-workflow-and-versioning` passed 3 of 3 runs with the plugin and 2 of 3 without it, on one test task](https://driftproofhq.com/reports/009/evidence/three-skill-comparison--native--git-workflow-and-versioning--results--aggregate-result.json).
- On [15 Sep 2026, Claude Opus 5 with the `code-review-and-quality` skill was tested on one test task](https://driftproofhq.com/r/4e3e1dddda5592ac7a54864995a19e33ea8d50ed72330a64cbcc9ee4c30b8f4f/): it does not show how the skill does on other tasks, or with another grader.

Report 009: Instrument comparison, claude-opus-5

Type Instrument comparison report

What moved three skills under two eval harnesses

Models `claude-opus-5`

Headline Three skills from one plugin, one case each, measured by Claude Code’s native plugin eval and by Driftproof, with the same SKILL.md bytes, task prompts and rubrics.

Receipts [3 receipts](https://github.com/driftproofhq/driftproof/tree/main/receipts/report-009/)

**Cite this**

```
@techreport{driftproof-009,
  title  = {Report 009: three skills under two eval harnesses},
  author = {Driftproof},
  year   = {2026},
  type   = {Instrument comparison report},
  note   = {claude-opus-5},
  url    = {https://driftproofhq.com/reports/009/}
}
```

Instrument comparison report. Nothing moves under the skill, and the thing that differs is the harness that measures it. The page follows the shared chrome and states its own reading rules in its limits and setup sections.

Three skills from one plugin, one case each, measured by Claude Code’s native plugin eval and by Driftproof, with the same SKILL.md bytes, task prompts and rubrics. The two tools apply different treatments and grade differently, so this page reads their results side by side and does not rank them.

Every figure below is read from a file in the two bundles the runs were delivered in, and each block names its files. The target model and the judge were `claude-opus-5` in both tools.

Read from: `docs/reports/009/evidence/three-skill-comparison--driftproof--code-review-and-quality--receipts--code-review-and-quality-claude-opus-5-2026-09-15.json`.

## Limits, read these first

- **One case per skill.** Each Driftproof receipt carries a suite of 1, 1, 1 case, in the order `code-review-and-quality`, `git-workflow-and-versioning`, `documentation-and-adrs`, and each native run has 1, 1, 1. Nothing on this page describes how any of the three skills behaves on any other task.
- **Three or four draws.** Driftproof drew 3, 3, 3 generations for the with-skill arm and 4, 3, 4 for the baseline arm, in the same skill order. The native eval ran 3, 3, 3 runs per arm, and a separate supplement 1, 1, 1 run per arm.
- **No across-case uncertainty.** With one case there is no spread across cases, and each receipt says so: its combined uncertainty on the delta is absent, recorded as `single_case`, `single_case`, `single_case`. The spreads on this page are across generation draws of one case.
- **Different treatments, so absolute scores are not comparable.** The native eval runs the plugin in a real Claude Code session, where the model can discover the skill and call tools, and grades each run pass or fail. Driftproof puts the SKILL.md text in the prompt with no tools and scores each draw on a continuous scale. A native score is a pass fraction and a Driftproof score is a mean judge rating; neither converts into the other, and this page compares each tool’s arms only with that tool’s other arm. The next section describes both treatments.
- **The two judges on the git-workflow-and-versioning baseline, a finding about judging.** The native baseline passed 2 of 3 runs; Driftproof’s baseline scored 0.300 across 3 draws. The two judges were never given the same output, so these files cannot split that difference between judging and generation. What they show about judging is narrower. The rubric’s first criterion asks that the subject line begin with `fix:`. What the file records is one verdict per run against the whole rubric, not a verdict per criterion: 9 judge votes across the three baseline runs, 6 of them PASS, unanimous within each run. The step from there toward that criterion runs through the rubric’s own scoring, which passes at 0.7 and caps the score at 0.3 when the subject line carries no conventional type prefix. The native judge passed 2 of its baseline outputs against the whole rubric, and both of those subject lines begin `fix(auth):`, a scoped form. A run the cap had touched could not have reached the pass mark, so what those two passes show is that the judge applied no conventional-type-prefix cap to either output. That is the whole of what they show. The cap is worded for a conventional type prefix in general, while the criterion above names `fix:`; the file records no verdict on that criterion, so whether the judge read the scoped form as meeting it is not something these files answer. The run it failed is the one whose subject line begins `Fix` with no type, which the cap would account for, though a whole-rubric fail does not on its own name the criterion that carried it. Driftproof’s three baseline generations each begin `Fix password-reset links expiring` with no type (bundle calls 041, 045, 049), and its judge gave the reason “Subject lacks the conventional `fix:` prefix”. Whether the Driftproof judge reads a scoped prefix the way the native judge did is not something this run asked it.
- **A different judge from Driftproof’s reports.** Both tools judged with `claude-opus-5` (native: `claude-opus-5`). The [judge policy](https://driftproofhq.com/judge-policy/) fixes the judge for the reports Driftproof publishes at a model these runs did not use. This report departs from that policy, and its figures are not comparable with Reports 001 to 008.
- **Verification levels.** The three Driftproof receipts are `TESTED`, `TESTED` and `TESTED`, each validating with its receipt hash verified. The native figures are the native tool’s own output files as the bundle carries them; this project did not re-run them.

Read from: `docs/reports/009/evidence/three-skill-comparison--driftproof--code-review-and-quality--receipts--code-review-and-quality-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--git-workflow-and-versioning--receipts--git-workflow-and-versioning-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--documentation-and-adrs--receipts--documentation-and-adrs-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--native--code-review-and-quality--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native--git-workflow-and-versioning--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native--documentation-and-adrs--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--code-review-and-quality--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--git-workflow-and-versioning--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--documentation-and-adrs--results--aggregate-result.json`; `three-skill-comparison/driftproof-calls/041/stdout.jsonl` (in the bundle, not published; its sha256 is listed in the bundle's published `SHA256SUMS`); `three-skill-comparison/driftproof-calls/045/stdout.jsonl` (in the bundle, not published; its sha256 is listed in the bundle's published `SHA256SUMS`); `three-skill-comparison/driftproof-calls/049/stdout.jsonl` (in the bundle, not published; its sha256 is listed in the bundle's published `SHA256SUMS`); `three-skill-comparison/inputs/native/git-workflow-and-versioning/evals/commit-message-conventional-type/graders/criteria.md` (in the bundle, not published; its sha256 is listed in the bundle's published `SHA256SUMS`).

## What each tool measures here

**The inputs are shared.** Three skills from `addyosmani/agent-skills` at commit `be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39`: `code-review-and-quality`, `git-workflow-and-versioning`, `documentation-and-adrs`. The SKILL.md bytes, the task prompt and the rubric are the same in both tools’ inputs; spec 034 checks the SKILL.md bytes against the upstream commit and the prompt and rubric text between the two inputs directories.

**The native eval** is Claude Code `2.1.272` running each skill as a single-skill plugin, in a with-plugin arm and a without-plugin arm (`with-without`). Each run is a real session: the model sees the plugin, can discover the skill and call the Skill tool, and has up to 5 turns. A `criteria` grader applies the rubric with the judge and returns PASS when the rubric score is at least 0.7, taking 3 judge votes per run. An arm’s score is the fraction of its runs that passed. A second grader, `skill-fired`, records whether the Skill tool was called; it is diagnostic and is not part of the score (`scored` is `false`).

**Driftproof** is runner `0.10.1` on the `claude-cli` surface. It scores the skill text in the prompt: the with-skill arm receives the SKILL.md with the task, the baseline arm receives the task alone, and neither has tools. It draws several generations per arm and the judge scores each one 3 times on a continuous 0 to 1 scale against the same rubric. An arm’s band is the mean of its draw means plus or minus the sample standard deviation across draws: a descriptive spread with no coverage probability. Two arms separate under the rule when their bands do not overlap and their means differ by at least the 0.05 effect floor; otherwise no separation is detected at the sample size used, which is not evidence that nothing differs.

**So the native judge and the Driftproof judge read the same rubric in two ways**: the native grader turns it into pass or fail at 0.7, and Driftproof keeps the score.

Read from: `docs/reports/009/evidence/three-skill-comparison--protocol.md`; `docs/reports/009/evidence/three-skill-comparison--native--code-review-and-quality--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--code-review-and-quality--receipts--code-review-and-quality-claude-opus-5-2026-09-15.json`; `three-skill-full-plugin/driftproof-source/README.md` (in the bundle, not published; its sha256 is listed in the bundle's published `SHA256SUMS`).

## The text-only comparison

| skill | native with plugin, runs passed | native without, runs passed | native delta | native skill-fired: comparison; supplement | Driftproof with skill, mean ± sd across draws | Driftproof baseline, mean ± sd across draws | Driftproof delta | Driftproof arms under the rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `code-review-and-quality` | 3 of 3 | 3 of 3 | 0.00 | 3 of 3; 1 of 1 | 0.918 ± 0.010 (3 draws) | 0.783 ± 0.094 (4 draws) | 0.134 | separated |
| `git-workflow-and-versioning` | 3 of 3 | 2 of 3 | 0.33 | 3 of 3; 1 of 1 | 0.862 ± 0.007 (3 draws) | 0.300 ± 0.000 (3 draws) | 0.562 | separated |
| `documentation-and-adrs` | 3 of 3 | 1 of 3 | 0.67 | 0 of 3; 0 of 1 | 0.822 ± 0.017 (3 draws) | 0.532 ± 0.093 (4 draws) | 0.291 | separated |

A native delta is the with-plugin pass fraction minus the without-plugin pass fraction. A Driftproof delta is the with-skill mean minus the baseline mean, shown as context; the rule column is what the rule reads. The two deltas are on different scales and are not compared with each other.

Read from: `docs/reports/009/evidence/three-skill-comparison--native--code-review-and-quality--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--code-review-and-quality--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--code-review-and-quality--receipts--code-review-and-quality-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--native--git-workflow-and-versioning--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--git-workflow-and-versioning--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--git-workflow-and-versioning--receipts--git-workflow-and-versioning-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--native--documentation-and-adrs--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--documentation-and-adrs--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--documentation-and-adrs--receipts--documentation-and-adrs-claude-opus-5-2026-09-15.json`.

### Three readings

**1. On `code-review-and-quality` the native delta is 0.00, while Driftproof’s arms separate under the rule on that one task.** Both native arms passed 3 of 3 runs. Driftproof’s with-skill band runs from 0.908 to 0.928 and its baseline band from 0.689 to 0.878, so they do not overlap, and the means differ by 0.134, at least the effect floor. This is a separation detected under the rule on one task, not proof that the skill moved the score. Neither tool’s result is read against the other’s.

**2. The native eval’s largest delta, 0.67 on `documentation-and-adrs`, is on a skill whose skill-fired grader reads 0 of 3 and 0 of 1.** The Skill tool was not called in the three with-plugin runs of the comparison or in the one-run supplement. The with-plugin arm passed 3 of 3 runs and the without-plugin arm 1 of 3, so the delta is 2 baseline failures in 3 runs, and the one baseline run that passed did so on the judge votes `FAIL PASS PASS`. With three runs per arm each run moves a pass fraction by a third. These files do not show what produced the difference.

**3. With-skill spread is well below baseline spread on two of the three skills, offered as an observation to test.** On `code-review-and-quality` the sd across draws is 0.010 with the skill and 0.094 without, a ratio of 9.3; on `documentation-and-adrs` it is 0.017 and 0.093, a ratio of 5.5. On `git-workflow-and-versioning` the pattern does not appear: the baseline sd is 0.000, with every one of its draw means at 0.300, and the with-skill sd 0.007. Each figure is from one case and three or four draws, so this is a pattern to test on more cases and more draws, not a finding.

Read from: `docs/reports/009/evidence/three-skill-comparison--native--code-review-and-quality--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--code-review-and-quality--receipts--code-review-and-quality-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--native--documentation-and-adrs--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--documentation-and-adrs--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--documentation-and-adrs--receipts--documentation-and-adrs-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--git-workflow-and-versioning--receipts--git-workflow-and-versioning-claude-opus-5-2026-09-15.json`.

## A separate run: the full plugin on tool-using tasks, native only

The second bundle records a different run with different tasks, reported here on its own and as a native-only functional check. Its tasks are not the tasks above and its figures are not comparable with them. The whole plugin was installed, version `0.6.9`, including its default SessionStart hook, and each of three tasks asked for real tool use in a small repository: review a working-tree change and write `review.md`, make atomic Git commits, and write an ADR in the repository’s reStructuredText convention. Each task ran 3 times per arm. The graders were deterministic checks with no model judge, and a separate verification script read each session’s Git history and files afterwards.

**Every session passed.** 18 of 18 sessions passed the native graders, 9 of 9 with the plugin and 9 of 9 without, and 18 of 18 passed the post-session verification. These checks record no difference between the arms on these tasks, and they were written as coarse functional checks, not as a measure of how much a skill helps.

**The plugin’s hook context is in every with-plugin trace.** The verification records SessionStart hook context in 9 of 9 with-plugin sessions and in 0 of 9 without.

**One ADR passed every structural check while asserting a history the fixture never supplied.** In with-plugin session 3 of the ADR task the verification passed 10 of 10 checks, and the ADR it wrote says at line 18: “Both have been observed in practice with in-request sends”. The decision brief the fixture writes into the repository states no such observation, and the bundle’s manual inspection records: “Structural and stated design checks do not validate this assertion”.

Read from: `docs/reports/009/evidence/three-skill-full-plugin--native--results--aggregate-result.json`; `three-skill-full-plugin/verification.json` (in the bundle, not published; its sha256 is listed in the bundle's published `SHA256SUMS`); `three-skill-full-plugin/workspaces/documentation-and-adrs/with-3/cwd/Documentation/Decisions/ADR-003-Email-Outbox.rst` (in the bundle, not published; its sha256 is listed in the bundle's published `SHA256SUMS`); `three-skill-full-plugin/suite/documentation-and-adrs/fixture.sh` (in the bundle, not published; its sha256 is listed in the bundle's published `SHA256SUMS`); `three-skill-full-plugin/manual-inspection.json` (in the bundle, not published; its sha256 is listed in the bundle's published `SHA256SUMS`); `docs/reports/009/evidence/three-skill-full-plugin--protocol.md`.

## Run record

The comparison ran on 2026-09-15 by each receipt’s `run.date_utc` (`2026-09-15T16:04:34.736Z`, `2026-09-15T16:06:45.501Z`, `2026-09-15T16:11:24.010Z`) and each native result’s `startedAt` (`2026-09-15T15:57:22.219Z`, `2026-09-15T16:01:49.644Z`, `2026-09-15T16:04:35.426Z`). Those are start times; neither file records a finish. The full-plugin run started at `2026-09-15T17:26:26.349Z` on Claude Code `2.1.272`.

**Integrity.** Each bundle carries a `SHA256SUMS` list, 544 lines for the comparison and 1046 for the full-plugin run, and every file each bundle holds matches its list. The three SKILL.md files in both bundles match the upstream commit named above byte for byte. The files published beside this report are copied from the bundles unchanged and match the same lists. Receipt hashes: `code-review-and-quality` `4e3e1dddda5592ac`, `git-workflow-and-versioning` `2df794c7f2539a9c`, `documentation-and-adrs` `3f52ddb6b849ee54`.

Read from: `docs/reports/009/evidence/three-skill-comparison--driftproof--code-review-and-quality--receipts--code-review-and-quality-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--git-workflow-and-versioning--receipts--git-workflow-and-versioning-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--documentation-and-adrs--receipts--documentation-and-adrs-claude-opus-5-2026-09-15.json`; `docs/reports/009/evidence/three-skill-comparison--native--code-review-and-quality--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native--git-workflow-and-versioning--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native--documentation-and-adrs--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-full-plugin--native--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--SHA256SUMS`; `docs/reports/009/evidence/three-skill-full-plugin--SHA256SUMS`.

## Amendments

**Amendment 1 · 2026-09-23**. **This entry corrects how the page’s description is read against its body; no earlier text is changed, and no figure, claim, table value or receipt reference changes.** The page’s description, the text of its `description` and `og:description` meta tags, is its headline cut short: *“Three skills from one plugin, one case each, measured by Claude Code’s native plugin eval and by Driftproof, with the same SKILL.md bytes, task prompts and…”*. Read alone, it can be taken to say that the model in every run of both tools was given the same SKILL.md.

**What the body says.** The setup section says that the SKILL.md bytes, the task prompt and the rubric are the same in both tools’ inputs. Driftproof puts the SKILL.md text in the with-skill arm’s prompt. The native eval’s with-plugin arm gives the model the plugin, from which it can discover the skill and call the Skill tool, and the `skill-fired` grader records whether it was called. For the comparison’s with-plugin runs and then the supplement’s, it reads on `code-review-and-quality` 3 of 3 and 1 of 1, on `git-workflow-and-versioning` 3 of 3 and 1 of 1, and on `documentation-and-adrs` 0 of 3 and 0 of 1, as the table gives. On `documentation-and-adrs` the Skill tool was not called in any with-plugin run, as claim 2 says.

**How to read this page.** Wherever the page’s description, its headline or its summary card says the two tools ran with the same SKILL.md bytes, task prompts and rubrics, read it as the setup section states it: the same bytes in both tools’ inputs. It does not say that the Skill tool was called in every native with-plugin run; the table’s `skill-fired` column says, per skill, in how many it was. The description’s closing *and…* reads as the headline’s *and rubrics*. This page’s description, headline and summary card keep the sentence as published.

Read from: `docs/reports/009/evidence/three-skill-comparison--native--code-review-and-quality--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--code-review-and-quality--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native--git-workflow-and-versioning--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--git-workflow-and-versioning--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native--documentation-and-adrs--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--documentation-and-adrs--results--aggregate-result.json`.

## Published evidence

****The files this report makes public.** The three Driftproof receipts with their summaries, the native tool’s aggregate results, each run’s protocol, and each bundle’s SHA-256 list.**

- `docs/reports/009/evidence/three-skill-comparison--driftproof--code-review-and-quality--receipts--code-review-and-quality-claude-opus-5-2026-09-15.json`
  sha256 `d1bb74a3eb622f88ebf59127a8c73f85738c55d46ca7e03a7e496f67aecefb4b`
- `docs/reports/009/evidence/three-skill-comparison--driftproof--code-review-and-quality--receipts--code-review-and-quality-claude-opus-5-2026-09-15.summary.md`
  sha256 `9d94db94e9fd7cf6538a8e917ecb92a7960cada229c105e5b8901592c1cc2e10`
- `docs/reports/009/evidence/three-skill-comparison--driftproof--documentation-and-adrs--receipts--documentation-and-adrs-claude-opus-5-2026-09-15.json`
  sha256 `1c01c263df99efcfb5d449681d12c042433246f1b2efa007b98b3c46bab65461`
- `docs/reports/009/evidence/three-skill-comparison--driftproof--documentation-and-adrs--receipts--documentation-and-adrs-claude-opus-5-2026-09-15.summary.md`
  sha256 `e5658146fa2b31fbaa33b1ec4814d73d0f08f270f2965222eaf177731008f8f5`
- `docs/reports/009/evidence/three-skill-comparison--driftproof--git-workflow-and-versioning--receipts--git-workflow-and-versioning-claude-opus-5-2026-09-15.json`
  sha256 `002b43de78002c70f40de71639d069e7fb858987bd06817e3029f9013f2c15d2`
- `docs/reports/009/evidence/three-skill-comparison--driftproof--git-workflow-and-versioning--receipts--git-workflow-and-versioning-claude-opus-5-2026-09-15.summary.md`
  sha256 `e9e86932681ee8a78e24eb1d5bf59af24daf7a1a2a4f6096d220c03e59fed679`
- `docs/reports/009/evidence/three-skill-comparison--native--code-review-and-quality--results--aggregate-result.json`
  sha256 `74de0467df225b9ea0c2d5b295cae5e623d7d31c2504dac69472d3e9e615a651`
- `docs/reports/009/evidence/three-skill-comparison--native--documentation-and-adrs--results--aggregate-result.json`
  sha256 `f1db5994e4404c71410cf16c8c3830876627b8fa3e2a1faef334888aab1455aa`
- `docs/reports/009/evidence/three-skill-comparison--native--git-workflow-and-versioning--results--aggregate-result.json`
  sha256 `99e10ac9657e5946cf0a8b84053d34655e4af2c9a84071ad8e64384a32a696ec`
- `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--code-review-and-quality--results--aggregate-result.json`
  sha256 `ad1a0829aa14bf7f0936e5e28d808a101cb4b611c7bf07e6a75416e550fba135`
- `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--documentation-and-adrs--results--aggregate-result.json`
  sha256 `849056f4e7a58c8c844d4710530fef278b71e435e228e4f1839218de7d044ae9`
- `docs/reports/009/evidence/three-skill-comparison--native-trace-pass--git-workflow-and-versioning--results--aggregate-result.json`
  sha256 `1d2d6906a09a6b531dba71a490f65d1a405feb40e731416bdcc8bf60e6d980c4`
- `docs/reports/009/evidence/three-skill-comparison--protocol.md`
  sha256 `bf91c11004cd7627713f3924dec7641eb78dceece48a22a96f64419a19a2fa33`
- `docs/reports/009/evidence/three-skill-comparison--SHA256SUMS`
  sha256 `56339468a1ad8d9a067ee932699ca29d175e478b840bd5522253ca7c87511bb2`
- `docs/reports/009/evidence/three-skill-full-plugin--native--results--aggregate-result.json`
  sha256 `fa354cda4fb9e2f1de5f05419203af3f5b86987bc867af05795dde8d0c184939`
- `docs/reports/009/evidence/three-skill-full-plugin--protocol.md`
  sha256 `0a5134cd9c4231ab151ac39b171e41e6a6b6568b64da31a8373dca79edc7328e`
- `docs/reports/009/evidence/three-skill-full-plugin--SHA256SUMS`
  sha256 `0410efb665fac5728d31a5352859f07493ef9dcd394dbe6db6ac18f07e382a19`

Validate a receipt with `npx driftproof validate <file>`. Each published copy is named for its path inside its bundle, with each `/` written as `--`; its sha256 is the one its bundle’s `SHA256SUMS` lists for that path.
