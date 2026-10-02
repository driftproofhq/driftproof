# Report 010: repeated ADR evaluations across two Claude Code configurations

Canonical: <https://driftproofhq.com/reports/010/>

## What did Report 010 find?

- **What we tested.** One skill’s own test (a model grades Claude Code’s decision record on three expectations), run ten times, same task, on claude-opus-5: five under each of two Claude Code setups.
- **What we found.** Eight passed and two failed, both under the first setup, where one command gave both results. Both failed one expectation, timeless language, which the skill’s instructions do not ask for.
- **The maintainer says the test is off, not the skill.** No change to the test is recorded.
- **What it doesn't show.** Ten runs of one task are not a pass rate. The setups differ in version, settings and chance, so neither is shown better.

Report 010: Instrument comparison, claude-opus-5

Type Instrument comparison report

What moved repeated ADR evaluations across two Claude Code configurations

Models `claude-opus-5`

Headline One skill’s behavioural eval from its own repository, run ten times with the same skill text, the same eval case and the same executor model, five times under each of two Claude Code configurations.

Receipts no receipts linked

**Cite this**

```
@techreport{driftproof-010,
  title  = {Report 010: repeated ADR evaluations across two Claude Code configurations},
  author = {Driftproof},
  year   = {2026},
  type   = {Instrument comparison report},
  note   = {claude-opus-5},
  url    = {https://driftproofhq.com/reports/010/}
}
```

Instrument comparison report

One skill’s behavioural eval from its own repository, run ten times with the same skill text, the same eval case and the same executor model, five times under each of two Claude Code configurations. Eight runs passed and two failed. Both failures fell on one expectation, and that expectation is a rule absent from the skill’s ADR instructions in `SKILL.md`.

Read from: `docs/reports/010/evidence/report-010-20260921--run-1--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-2--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-3--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-4--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-5--exit-code.txt`; `docs/reports/010/evidence/config-b--verified-results.json`; `docs/reports/010/evidence/report-010-20260921--run-1--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-2--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-3--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-4--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-5--results--documentation-and-adrs.eval-1.grading.json`.

## Limits, read these first

Ten runs in total, five per configuration. One eval case, one executor model, one skill. This is not a pass rate estimate for the skill, the harness or the model.

The two configurations differ in Claude Code version (2.1.278, recorded during the exploratory runs on the same box, against 2.1.90), in settings (a user settings file that sets the model, the terminal UI, the theme, two prompt suppressions and an auto-mode policy, and configures no hooks, no MCP servers and no auto-memory setting, against hooks, MCP and auto-memory off with the model pinned on both generator and grader), and in random draw. These experiments do not isolate what caused the variation between them.

Grader repeatability was tested on one passing transcript only: five gradings of one transcript from configuration B agreed on every expectation. The two failing transcripts from configuration A were not kept, because the harness does not save executor traces, so the grader’s reading of them cannot be replayed. Their failure reasons are the grader’s own evidence text.

An eval may legitimately check quality a skill never spells out. That the rule is absent from `SKILL.md` is a question for the maintainer, filed as [issue #591](https://github.com/addyosmani/agent-skills/issues/591), not a defect.

Configuration A’s raw evidence was produced on the Driftproof build box and is published below, each file in full or, where it carries a local path or third-party skill text, by its sha256; it was not independently verified by the second party.

No Driftproof measurement was taken for this report. No Driftproof judge ran, and there are no Driftproof receipts and so no verification level: every figure on this page is read from the upstream harness’s own output files; configuration A’s run logs, run matrices, run script and user settings file; a Claude Code cache file written during the exploratory runs; the skill and reference files in the upstream repository; the second party’s bundle; the raw set’s checksum list, `raw-SHA256SUMS`; Report 009’s published page and evidence; or this report’s GitHub check record. Report 009 appears as background only. Its figures were judged by claude-opus-5 under that report’s declared departure from judge policy and carry Report 009’s limits.

Read from: `docs/reports/010/evidence/report-010-20260921--run-1--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-2--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-3--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-4--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-5--exit-code.txt`; `docs/reports/010/evidence/config-b--verified-results.json`; `report-010-20260921/fix-runs/run-2/tmp/claude-1000/cache-break-state-297d8716-050b-44d7-92e6-c369de44dd7e.json` (in the raw set, not published; its sha256 is in `raw-SHA256SUMS`); `docs/reports/010/evidence/config-b--environment.json`; `report-010-20260921/settings.json.before` (in the raw set, not published; its sha256 is in `raw-SHA256SUMS`); `docs/reports/010/evidence/github-check-20260921T172411Z.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--documentation-and-adrs--receipts--documentation-and-adrs-claude-opus-5-2026-09-15.json`.

## Background: what Report 009 measured for this skill

[Report 009](https://driftproofhq.com/reports/009/) measured `documentation-and-adrs` (with the same `SKILL.md` bytes as here, at commit `be4e44a`) on a different task: improving the comments in a JavaScript file. It used a minimal single-skill plugin under Claude Code’s native plugin eval, and the skill text in the prompt under Driftproof. The native eval read 1.000 with the skill against 0.333 without, with the skill’s tool never called; Driftproof read 0.822 against 0.532. Report 009’s own reading is narrower: its traces show the Skill tool was not called in any with-plugin run, and its files do not show what produced the difference.

Those figures measure different things from the ones below (native pass fractions, Driftproof judge ratings, and here fractions of expectations passed), on a different task. They are not a third arm of this experiment.

Read from: `docs/reports/009/evidence/three-skill-comparison--protocol.md`; `docs/reports/009/evidence/three-skill-comparison--native--documentation-and-adrs--results--aggregate-result.json`; `docs/reports/009/evidence/three-skill-comparison--driftproof--documentation-and-adrs--receipts--documentation-and-adrs-claude-opus-5-2026-09-15.json`; `docs/reports/009/index.html`.

## The instrument

The skill, fixture and harness are published in the `addyosmani/agent-skills` repository. The harness, `scripts/run-evals.js --behavioral`, runs one headless Claude Code session for this skill against a fixture (`evals/fixtures/documentation-and-adrs/decision-context.md`), asks for an ADR, and has a model grade the transcript against three written expectations. It prints a pass rate and exits 0 or 1. It has no built-in repetition, no spread estimate and no explicit inconclusive or underpowered verdict. Each invocation uses one executor draw and returns a binary process outcome unless execution or parsing fails.

The skill was at commit `dc27a9c` for all ten runs. The executor model was claude-opus-5 in every run.

Read from: `docs/reports/010/evidence/report-010-20260921--run-1--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-2--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-1--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--matrix.md`; `docs/reports/010/evidence/report-010-20260921--run-3--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-4--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-5--exit-code.txt`; `docs/reports/010/evidence/config-b--verified-results.json`; `docs/reports/010/evidence/report-010-20260921--run-2--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-3--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-4--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-5--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--run-1--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--run-2--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--run-3--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--run-4--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--run-5--documentation-and-adrs.eval-1.grading.json`.

## Provenance and disclosure

Configuration A was run by `mavericksea-ai`, who had previously contributed two merged changes to the repository’s behavioural-evaluation harness. [PR #576](https://github.com/addyosmani/agent-skills/pull/576) binds grader results to declared expectations, replaces grader-paraphrased expectation text with the canonical wording and derives `pass_rate` from the validated results. [PR #587](https://github.com/addyosmani/agent-skills/pull/587) clears the result slot before each run and records the executor model and timestamp. Both changes are present in the harness used here and affect how this report’s evidence is validated or recorded.

The `executor_model` field shown in this report comes from [#587](https://github.com/addyosmani/agent-skills/pull/587). Its result-slot clearing also prevents a rejected or interrupted run from leaving an earlier successful grading file in place. The malformed grader response in the exploratory experiment was rejected by the parser; [#587](https://github.com/addyosmani/agent-skills/pull/587) establishes that no stale successful result survived beside it.

The same account also contributed [PR #578](https://github.com/addyosmani/agent-skills/pull/578), which fixed an unrelated `simplify-ignore` hook and has no bearing on this experiment. [Release 0.6.10](https://github.com/addyosmani/agent-skills/releases/tag/0.6.10) credited `mavericksea-ai` for [#576](https://github.com/addyosmani/agent-skills/pull/576) and [#578](https://github.com/addyosmani/agent-skills/pull/578); [#587](https://github.com/addyosmani/agent-skills/pull/587) merged later. [Issue #591](https://github.com/addyosmani/agent-skills/issues/591), asking whether the timeless-language rule is meant to apply to ADRs, was filed by the same account and was open and unanswered when checked at `2026-09-21T17:24:11Z`.

Read from: `docs/reports/010/evidence/github-check-20260921T172411Z.json`.

## Results

Configuration A: Driftproof build box, Claude Code 2.1.278 (recorded during the exploratory runs on the same box), the user settings file described under Limits, with the model selected through `settings.json`.

| Run | Expectation 1 | Expectation 2 | Expectation 3 | pass_rate | Exit |
| --- | --- | --- | --- | --- | --- |
| 1 | pass | pass | fail | 0.67 | 1 |
| 2 | pass | pass | pass | 1.00 | 0 |
| 3 | pass | pass | fail | 0.67 | 1 |
| 4 | pass | pass | pass | 1.00 | 0 |
| 5 | pass | pass | pass | 1.00 | 0 |

Read from: `report-010-20260921/fix-runs/run-2/tmp/claude-1000/cache-break-state-297d8716-050b-44d7-92e6-c369de44dd7e.json` (in the raw set, not published; its sha256 is in `raw-SHA256SUMS`); `docs/reports/010/evidence/report-010-20260921--run-1--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-1--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-2--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-2--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-3--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-3--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-4--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-4--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-5--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-5--exit-code.txt`.

Configuration B: a separate rerun performed by a second party on a second machine, Claude Code 2.1.90, `--model claude-opus-5` on generator and grader, hooks, MCP and auto-memory off, grader tools off.

| Run | Expectation 1 | Expectation 2 | Expectation 3 | pass_rate | Exit |
| --- | --- | --- | --- | --- | --- |
| 1 to 5 | pass | pass | pass | 1.00 | 0 |

Configuration B also replayed one grader input byte for byte four more times; all five gradings agreed on every expectation.

Read from: `docs/reports/010/evidence/config-b--environment.json`; `docs/reports/010/evidence/config-b--verified-results.json`.

The expectations: (1) the ADR states context, decision, alternatives and consequences distinctly; (2) trade-offs and rejected options are recorded, not just the winning choice; (3) the document is written in timeless language describing current state. Across the ten runs, 1 and 2 passed 10 of 10 and 3 passed 8 of 10. With three expectations in the case, one failed expectation makes the entire run fail.

The aggregate 8-of-10 figure is a descriptive tally only. It is not a pooled pass-rate estimate, and the 3-of-5 versus 5-of-5 outcomes do not establish that configuration B is better than configuration A.

Read from: `docs/reports/010/evidence/report-010-20260921--run-1--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-1--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-2--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-3--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-4--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-5--exit-code.txt`; `docs/reports/010/evidence/config-b--verified-results.json`; `docs/reports/010/evidence/report-010-20260921--run-2--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-3--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-4--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-5--results--documentation-and-adrs.eval-1.grading.json`.

## Three readings

**The single draw is the verdict.** Under configuration A the same command at the same commit returned exit 0 three times and exit 1 twice. A CI job that ran once would have reported whichever it happened to get, and nothing in the printed number marks it as one draw of several.

**The expectation that moved is absent from the skill’s ADR instructions.** `SKILL.md` does not ask for timeless language. The wording comes from the repository’s `references/definition-of-done.md`, which is about documentation in general, and the skill describes an ADR as a dated record with a status lifecycle. The grader’s evidence on the two failing runs cited wording such as “currently” and “before cutover”. Whether the rule should apply to ADRs is the maintainer’s call, and [#591](https://github.com/addyosmani/agent-skills/issues/591) asks it.

**Configuration is part of the record.** The observed runs included both passing and failing verdicts; these experiments do not isolate what caused that variation. Version, settings and random draw all differ between the two sets. A single run under either configuration does not establish what a repeat will return. What the record supports is narrower: under configuration A one command at one commit returned both verdicts, so a single run’s verdict is one draw under one configuration.

Read from: `docs/reports/010/evidence/report-010-20260921--run-1--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-2--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-3--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-4--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-5--exit-code.txt`; `report-010-20260921/run-1/tree/skills/documentation-and-adrs/SKILL.md` (in the raw set, not published; its sha256 is in `raw-SHA256SUMS`); `report-010-20260921/run-1/tree/references/definition-of-done.md` (in the raw set, not published; its sha256 is in `raw-SHA256SUMS`); `docs/reports/010/evidence/report-010-20260921--run-3--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-1--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/github-check-20260921T172411Z.json`.

## A separate exploratory experiment: replacing the expectation

Separately from the ten runs above, a branch was prepared (not proposed, because deleting a quality check needs the maintainer’s reading of the rule first) that replaces expectation 3 with a rule the skill does state: the ADR records a status and a date. Five runs under configuration A with that replacement: four graded (runs 1, 2, 3 and 5), all three expectations passed in each. Run 4 failed because the grader returned invalid JSON (one opening brace missing); the harness’s parser rejected it, retained the raw response and exited 1. These five runs are exploratory, on a modified case, and are not part of the ten-run result.

Read from: `docs/reports/010/evidence/report-010-20260921--run-1--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-2--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-3--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-4--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--run-5--exit-code.txt`; `docs/reports/010/evidence/config-b--verified-results.json`; `docs/reports/010/evidence/report-010-20260921--run-1--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-1--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-2--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-3--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-4--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-5--exit-code.txt`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-1--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-2--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-3--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-4--results--documentation-and-adrs.eval-1.grading.raw.txt`; `docs/reports/010/evidence/report-010-20260921--fix-runs--run-5--results--documentation-and-adrs.eval-1.grading.json`.

## Run record

**Configuration A** ran by the run script’s log: run 1 `2026-09-21T14:52:41Z` to `2026-09-21T14:53:23Z`, graded at `2026-09-21T14:53:23.182Z`; run 2 `2026-09-21T14:53:23Z` to `2026-09-21T14:54:05Z`, graded at `2026-09-21T14:54:05.167Z`; run 3 `2026-09-21T14:54:05Z` to `2026-09-21T14:54:43Z`, graded at `2026-09-21T14:54:43.083Z`; run 4 `2026-09-21T14:54:43Z` to `2026-09-21T14:55:24Z`, graded at `2026-09-21T14:55:24.509Z`; run 5 `2026-09-21T14:55:24Z` to `2026-09-21T14:56:03Z`, graded at `2026-09-21T14:56:03.532Z`. The model setting was restored at `2026-09-21T14:56:03Z`, and the settings file’s sha256 after the runs equals its sha256 before (`b94ed5a491f8dbfc`; the two sha256 files carry a local path and are not published). The harness and the run script do not record the Claude Code version: 2.1.278 is the `sdk.buildVersion` a session cache file recorded during the exploratory runs on the same box. The executor model as recorded per run: claude-opus-5, claude-opus-5, claude-opus-5, claude-opus-5, claude-opus-5. The grader model is recorded as `unknown` in every grading file, because the harness does not record it.

**Configuration B** is the bundle `addy-adr-confirmation.zip`, sha256 `920043f4025625f66bce2c3aea88f9a851f0c0e8efae011541a1e22ae0d4cd16`. Its `environment.json` records commit `dc27a9c2e13721158157632de61b4106c6c2a2a1`, Claude Code `2.1.90 (Claude Code)` and model `claude-opus-5`, with this isolation: “User/project/local settings excluded; hooks, MCP, Chrome, auto-memory disabled; generator tools match upstream allowlist; grader tools disabled. No fallback. Both model and utility/subagent model overrides pinned to Opus 5.” Grading timestamps: run 1 `2026-09-21T15:08:32.804Z`, run 2 `2026-09-21T15:09:17.806Z`, run 3 `2026-09-21T15:10:00.088Z`, run 4 `2026-09-21T15:10:44.007Z`, run 5 `2026-09-21T15:11:26.302Z`. The executor model as recorded per run: claude-opus-5, claude-opus-5, claude-opus-5, claude-opus-5, claude-opus-5. The grader model is confirmed `claude-opus-5` from the streams: `verified-results.json` records that model at the start of every one of its 14 CLI invocations, graders included.

**Commits.** `dc27a9c2e13721158157632de61b4106c6c2a2a1` for this report, and `be4e44a` for Report 009. `SKILL.md` has the same bytes at both: sha256 `87ae44a0c7bb3eefc2131a9d11caabcc14e4d8dcb27d66a3a675551ee2ce1671` in Report 009’s `SHA256SUMS`, `87ae44a0c7bb3eefc2131a9d11caabcc14e4d8dcb27d66a3a675551ee2ce1671` in configuration B’s `environment.json`, and `87ae44a0c7bb3eefc2131a9d11caabcc14e4d8dcb27d66a3a675551ee2ce1671` for the copy configuration A ran.

**The exploratory runs** ran at `adfeacb954c3fbb2ca026222a7d7f179bf8d9c8e` from `2026-09-21T15:11:18Z` to `2026-09-21T15:14:24Z`.

**Provenance.** The pull request descriptions, the release 0.6.10 wording and issue #591’s state were read from GitHub’s API at `2026-09-21T17:24:11Z`: the issue was `open` with 0 comments.

Read from: `docs/reports/010/evidence/report-010-20260921--run-1--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--log.txt`; `docs/reports/010/evidence/report-010-20260921--run-2--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-3--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-4--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-5--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/raw-SHA256SUMS`; `report-010-20260921/fix-runs/run-2/tmp/claude-1000/cache-break-state-297d8716-050b-44d7-92e6-c369de44dd7e.json` (in the raw set, not published; its sha256 is in `raw-SHA256SUMS`); `docs/reports/010/evidence/config-b--environment.json`; `docs/reports/010/evidence/config-b--run-1--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--run-2--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--run-3--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--run-4--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--run-5--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/config-b--verified-results.json`; `docs/reports/009/evidence/three-skill-comparison--protocol.md`; `docs/reports/009/evidence/three-skill-comparison--SHA256SUMS`; `report-010-20260921/fix-runs/run-all.sh` (in the raw set, not published; its sha256 is in `raw-SHA256SUMS`); `docs/reports/010/evidence/report-010-20260921--fix-runs--log.txt`; `docs/reports/010/evidence/github-check-20260921T172411Z.json`.

## Published evidence

****The files this report makes public.** The ten runs’ grading files and exit codes and the run logs, the exploratory runs’ files including the retained raw grader response, the configuration B bundle’s results, environment and report, the GitHub check record, and the list of every raw file with its sha256.**

- `docs/reports/010/evidence/config-b--environment.json`
  sha256 `24c40e1b5c00e748d35d10fd74b3401c8eb522e34e9a1ce5e79cadd6861f65db`
- `docs/reports/010/evidence/config-b--fixed-trace-grade-2--grading.json`
  sha256 `d29b7467b0269a84bfa0d6389c5e8e72e0c002cb44526a9f5a55c5f58c67cb3c`
- `docs/reports/010/evidence/config-b--fixed-trace-grade-3--grading.json`
  sha256 `8a93a04f128fefcd273c3ef11467e7bdc64eb8e91a572808d20598c58747d09b`
- `docs/reports/010/evidence/config-b--fixed-trace-grade-4--grading.json`
  sha256 `363c40c6f7888a7dd84fb1b4b3227a113a2f520da0849e338eb108086447d0b6`
- `docs/reports/010/evidence/config-b--fixed-trace-grade-5--grading.json`
  sha256 `da79b20ca3ab12cc0f2529dad300c6d202661214fee7b076a0cf41de85cd66e5`
- `docs/reports/010/evidence/config-b--report.md`
  sha256 `70b579a887d4c5444cab6d8738b582701d2a458bdac6710364c237c1c4380459`
- `docs/reports/010/evidence/config-b--run-1--documentation-and-adrs.eval-1.grading.json`
  sha256 `3c5dca3e51b8d2bb08814de73ab06077af4ecc0cd31e5d0716eafee73477661b`
- `docs/reports/010/evidence/config-b--run-1--runner-status.json`
  sha256 `d0d5553e18d2e79dedcec30d42cca3d3abcf00f7c4762f8d3ecd602f02db18ed`
- `docs/reports/010/evidence/config-b--run-2--documentation-and-adrs.eval-1.grading.json`
  sha256 `c8e7ad0cc08d5fd01a56488c1e22c7e1440b2e2eb952397f1fd7c02a703352ee`
- `docs/reports/010/evidence/config-b--run-2--runner-status.json`
  sha256 `d0d5553e18d2e79dedcec30d42cca3d3abcf00f7c4762f8d3ecd602f02db18ed`
- `docs/reports/010/evidence/config-b--run-3--documentation-and-adrs.eval-1.grading.json`
  sha256 `3e5052e5749114da3a83193a2254a372e84aea770491b83a57f9fe433854ee42`
- `docs/reports/010/evidence/config-b--run-3--runner-status.json`
  sha256 `d0d5553e18d2e79dedcec30d42cca3d3abcf00f7c4762f8d3ecd602f02db18ed`
- `docs/reports/010/evidence/config-b--run-4--documentation-and-adrs.eval-1.grading.json`
  sha256 `d8a35cbad75412a838d851dbebc73d83bfc7cd21db002621b6cebf9f1e3940ce`
- `docs/reports/010/evidence/config-b--run-4--runner-status.json`
  sha256 `d0d5553e18d2e79dedcec30d42cca3d3abcf00f7c4762f8d3ecd602f02db18ed`
- `docs/reports/010/evidence/config-b--run-5--documentation-and-adrs.eval-1.grading.json`
  sha256 `698fccf6cf3f2f55c923d273f5be718588e4304f94c51c7c41fac6e13036b5fb`
- `docs/reports/010/evidence/config-b--run-5--runner-status.json`
  sha256 `d0d5553e18d2e79dedcec30d42cca3d3abcf00f7c4762f8d3ecd602f02db18ed`
- `docs/reports/010/evidence/config-b--verified-results.json`
  sha256 `b8a61c72312a4425e73356cf233bf3394cb9220427f9eeba94d8ae608e4a8f2f`
- `docs/reports/010/evidence/github-check-20260921T172411Z.json`
  sha256 `7a04529e30678486f2233291679f2dcabde0219dd9771104f0f1fc536ddc3f82`
- `docs/reports/010/evidence/github-check-20260923T040657Z.json`
  sha256 `243a1279bc30c9d90b6f36b9390492c432210d344a50357271c608cc24c5c294`
- `docs/reports/010/evidence/github-check-20260923T045104Z.json`
  sha256 `6777f1ea2ec7efa7219b6a373a9dd4870d47d07cf8a58f16320e9e1380ed9f55`
- `docs/reports/010/evidence/raw-SHA256SUMS`
  sha256 `ed0bc48d58b216a7de5e5ab3f39b455f078092789e08d8fe809f7999778601f8`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--log.txt`
  sha256 `ff8e48ace4606d18f0cc9169b0220544d4f8310b860d816d577efa3baee600f7`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--matrix.md`
  sha256 `2cc615aff5d04792b0e6b3abc6281eb91971a0d1510bbbe740d8aa3bfdba0099`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-1--exit-code.txt`
  sha256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-1--results--documentation-and-adrs.eval-1.grading.json`
  sha256 `b1e0a0daf2bbfd8a8e680c3aa8a1ae87d93a5065a6a7673aaaaa4bb9f08aa7d0`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-2--exit-code.txt`
  sha256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-2--results--documentation-and-adrs.eval-1.grading.json`
  sha256 `90fe93f3b73875b2c69e6a6827ac765719420872355f7cf6f191753d143265bf`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-3--exit-code.txt`
  sha256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-3--results--documentation-and-adrs.eval-1.grading.json`
  sha256 `17bd2c7993eae852399bfab7f17307ceab383d46a0226d4f51b252ccbf1ba34c`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-4--exit-code.txt`
  sha256 `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-4--results--documentation-and-adrs.eval-1.grading.raw.txt`
  sha256 `9c041839f352dc0b4958df6d6aebd8d4e903984894bd133f5c2d2a034b1c9daf`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-5--exit-code.txt`
  sha256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`
- `docs/reports/010/evidence/report-010-20260921--fix-runs--run-5--results--documentation-and-adrs.eval-1.grading.json`
  sha256 `747300b71990cdc53952e6e15c97403edc6bc7a658ba767a3a7e01b696889f71`
- `docs/reports/010/evidence/report-010-20260921--log.txt`
  sha256 `a1876ebd8bf2f46ba7491de9587225f33d5884e53832d154561c7f34a3970a64`
- `docs/reports/010/evidence/report-010-20260921--matrix.md`
  sha256 `73b9bf7c782e2b8cf96ea525d740ad2b8b275fb71f891c00537d8054176d1fde`
- `docs/reports/010/evidence/report-010-20260921--run-1--exit-code.txt`
  sha256 `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865`
- `docs/reports/010/evidence/report-010-20260921--run-1--results--documentation-and-adrs.eval-1.grading.json`
  sha256 `607944163990aa6a0c128871ed0dd271506d56f744a5d1490e249fe93920765b`
- `docs/reports/010/evidence/report-010-20260921--run-2--exit-code.txt`
  sha256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`
- `docs/reports/010/evidence/report-010-20260921--run-2--results--documentation-and-adrs.eval-1.grading.json`
  sha256 `6c5a0387c42c723d4f3db43ac233e846ddc698df861be08c1c2df1aeac627a8a`
- `docs/reports/010/evidence/report-010-20260921--run-3--exit-code.txt`
  sha256 `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865`
- `docs/reports/010/evidence/report-010-20260921--run-3--results--documentation-and-adrs.eval-1.grading.json`
  sha256 `5d0902f705b9bce77a63a0a9008fdf2a9ebe1447ba8c09f90638eeec2a72e5a3`
- `docs/reports/010/evidence/report-010-20260921--run-4--exit-code.txt`
  sha256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`
- `docs/reports/010/evidence/report-010-20260921--run-4--results--documentation-and-adrs.eval-1.grading.json`
  sha256 `07e033432f3f56575959f2b36d6caaf796f7c1d12dd40014b8fe085ed7ddb3e1`
- `docs/reports/010/evidence/report-010-20260921--run-5--exit-code.txt`
  sha256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`
- `docs/reports/010/evidence/report-010-20260921--run-5--results--documentation-and-adrs.eval-1.grading.json`
  sha256 `fab1b85142029fce41c0d96a2239b76e8abad302c4ac808e548afec1384d8e22`

The configuration B bundle, `addy-adr-confirmation.zip`, is not published as a file, because it carries third-party skill text: sha256 `920043f4025625f66bce2c3aea88f9a851f0c0e8efae011541a1e22ae0d4cd16`. `raw-SHA256SUMS` lists all 2176 files of the raw set with their sha256, the unpublished ones included. Issue: [`https://github.com/addyosmani/agent-skills/issues/591`](https://github.com/addyosmani/agent-skills/issues/591).

Each published copy is named for its path inside its set, with each `/` written as `--`; its sha256 is the one `raw-SHA256SUMS` lists for that path.

## Amendments

### Amendment 1, 2026-09-23

This amendment adds to the record above and changes none of its sentences, figures or tables, though it reads a sentence of the second reading more narrowly below. The headline’s Read-from line now also cites the five configuration A grading files the headline’s new expectation tie reads, and the evidence list names the new check records. It records the maintainer’s answer on issue #591, sets out how that sentence of the second reading is read, and ties counts in the text above to the files they are read from.

**The answer on issue #591.** The record above says the issue was open and unanswered when checked at `2026-09-21T17:24:11Z`. That stays as published, and it was true at that check. Read again from GitHub’s API at `2026-09-23T04:06:57Z`, [issue #591](https://github.com/addyosmani/agent-skills/issues/591) was `open` with two comments. The first was posted at `2026-09-22T08:02:35Z` by another contributor. The second is the maintainer’s answer, posted by `addyosmani`, whose association with the repository GitHub records as `OWNER`, at `2026-09-23T04:01:57Z`, and [quoted here in full](https://github.com/addyosmani/agent-skills/issues/591#issuecomment-5788786108):

> Good catch, and I think the eval is the thing that's off here, not the skill. An ADR is deliberately a dated record with a status lifecycle, so timeless-language-describing-current-state (a general-docs rule from definition-of-done.md) doesn't cleanly apply to it, and grading against a requirement the skill never states leaves the judge guessing. I'd fix it by dropping or reshaping that third expectation in evals/cases/documentation-and-adrs.json rather than bending the skill to match. Want to put up that change? Happy to take it.

This page reports what the maintainer wrote. It does not report a change to the eval and records none. The runs, the exploratory runs and the readings above are unchanged.

**The second reading, as amended.** The second reading above says the wording of the expectation that moved “comes from” the repository’s `references/definition-of-done.md`. Read it as: a similar rule appears in that file. It shares the phrases “timeless language” and “current state” with the expectation, not its wording, and the files do not show where the expectation’s wording was taken from, and the second party’s report says that provenance is “not established merely by finding similar wording”. The maintainer’s answer calls the rule “a general-docs rule from definition-of-done.md”. That is the maintainer’s reading, quoted as such, and it does not by itself establish where the expectation’s wording was taken from.

**Counts tied.** The counts the text above gave as words without naming a file now name their files, as every other figure on this page does: the merged changes to the harness, the expectation both failures fell on, the failing transcripts that were not kept, the settings file’s sha256 files and the runs the evidence list names. The transcript and the grader input configuration B replayed stay words: its results record the replayed prompt as identical, under a single sha256, and count no transcripts. No sentence of the text changes.

Read from: `docs/reports/010/evidence/report-010-20260921--run-1--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-2--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-3--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-4--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/report-010-20260921--run-5--results--documentation-and-adrs.eval-1.grading.json`; `docs/reports/010/evidence/github-check-20260923T040657Z.json`; `docs/reports/010/evidence/github-check-20260921T172411Z.json`; `docs/reports/010/evidence/config-b--report.md`.

**The outcome so far.** Read again at `2026-09-23T04:51:04Z`: [PR #598](https://github.com/addyosmani/agent-skills/pull/598), “fix(evals): grade the ADR's status and date, not timeless language”, was opened at `2026-09-23T04:14:47Z` by `mavericksea-ai`, the same account that filed issue #591 and ran configuration A, with a body that says “Per the reading in #591 (the eval is off, not the skill)”, and is `open` with `merged: false`; the same account [replied on the issue](https://github.com/addyosmani/agent-skills/issues/591#issuecomment-5788945229) at `2026-09-23T04:16:12Z`.

Read from: `docs/reports/010/evidence/github-check-20260923T045104Z.json`.

### Amendment 2, 2026-09-26

This amendment renames configuration B’s published copies and changes no sentence, figure or table above. Each copy’s name began with the name of configuration B’s bundle and now begins with `config-b`. The rest of each name is unchanged, and so are each file’s bytes and its sha256. Every path on this page that gave these copies, in the text, the evidence list and the amendment above, now gives the new names.

The evidence list’s note says each published copy is named for its path inside its set. For configuration B, read `config-b` where the set’s name stood. Each copy’s sha256 is still the sha256 `raw-SHA256SUMS` lists for its path inside the bundle, which keeps its name.

Each path, the old name first and the new name after it:

- `docs/reports/010/evidence/addy-adr-confirmation--environment.json` is now `docs/reports/010/evidence/config-b--environment.json`
- `docs/reports/010/evidence/addy-adr-confirmation--fixed-trace-grade-2--grading.json` is now `docs/reports/010/evidence/config-b--fixed-trace-grade-2--grading.json`
- `docs/reports/010/evidence/addy-adr-confirmation--fixed-trace-grade-3--grading.json` is now `docs/reports/010/evidence/config-b--fixed-trace-grade-3--grading.json`
- `docs/reports/010/evidence/addy-adr-confirmation--fixed-trace-grade-4--grading.json` is now `docs/reports/010/evidence/config-b--fixed-trace-grade-4--grading.json`
- `docs/reports/010/evidence/addy-adr-confirmation--fixed-trace-grade-5--grading.json` is now `docs/reports/010/evidence/config-b--fixed-trace-grade-5--grading.json`
- `docs/reports/010/evidence/addy-adr-confirmation--report.md` is now `docs/reports/010/evidence/config-b--report.md`
- `docs/reports/010/evidence/addy-adr-confirmation--run-1--documentation-and-adrs.eval-1.grading.json` is now `docs/reports/010/evidence/config-b--run-1--documentation-and-adrs.eval-1.grading.json`
- `docs/reports/010/evidence/addy-adr-confirmation--run-1--runner-status.json` is now `docs/reports/010/evidence/config-b--run-1--runner-status.json`
- `docs/reports/010/evidence/addy-adr-confirmation--run-2--documentation-and-adrs.eval-1.grading.json` is now `docs/reports/010/evidence/config-b--run-2--documentation-and-adrs.eval-1.grading.json`
- `docs/reports/010/evidence/addy-adr-confirmation--run-2--runner-status.json` is now `docs/reports/010/evidence/config-b--run-2--runner-status.json`
- `docs/reports/010/evidence/addy-adr-confirmation--run-3--documentation-and-adrs.eval-1.grading.json` is now `docs/reports/010/evidence/config-b--run-3--documentation-and-adrs.eval-1.grading.json`
- `docs/reports/010/evidence/addy-adr-confirmation--run-3--runner-status.json` is now `docs/reports/010/evidence/config-b--run-3--runner-status.json`
- `docs/reports/010/evidence/addy-adr-confirmation--run-4--documentation-and-adrs.eval-1.grading.json` is now `docs/reports/010/evidence/config-b--run-4--documentation-and-adrs.eval-1.grading.json`
- `docs/reports/010/evidence/addy-adr-confirmation--run-4--runner-status.json` is now `docs/reports/010/evidence/config-b--run-4--runner-status.json`
- `docs/reports/010/evidence/addy-adr-confirmation--run-5--documentation-and-adrs.eval-1.grading.json` is now `docs/reports/010/evidence/config-b--run-5--documentation-and-adrs.eval-1.grading.json`
- `docs/reports/010/evidence/addy-adr-confirmation--run-5--runner-status.json` is now `docs/reports/010/evidence/config-b--run-5--runner-status.json`
- `docs/reports/010/evidence/addy-adr-confirmation--verified-results.json` is now `docs/reports/010/evidence/config-b--verified-results.json`

## Cite this

```
@techreport{driftproof-010,
  title  = {Report 010: repeated ADR evaluations across two Claude Code configurations},
  author = {Driftproof},
  year   = {2026},
  type   = {Instrument comparison report},
  note   = {claude-opus-5},
  url    = {https://driftproofhq.com/reports/010/}
}
```
