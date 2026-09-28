# Independent test of the documentation-and-adrs issue draft

## Result

The draft's mixed pass/fail pattern did **not reproduce** in this controlled test. All five fresh evaluations passed all three expectations. One unchanged execution trace was graded five times (its original grading plus four replays); every grading passed all three expectations.

This does not disprove the draft author's observations. It does mean this independent test provides no evidence of verdict instability at this commit and model under the recorded settings.

## Setup

- Repository: addyosmani/agent-skills.
- Exact commit: `dc27a9c2e13721158157632de61b4106c6c2a2a1` (the draft's dc27a9c).
- Claude Code: 2.1.90 (Claude Code).
- Authentication: existing Claude subscription; no API key supplied.
- Generation and grading explicitly pinned to `claude-opus-5`; all 14 final modelUsage records confirm only this model. No fallback model supplied. Utility/subagent overrides also pinned to Opus 5.
- Exact command executed five times: `node scripts/run-evals.js --behavioral documentation-and-adrs`.
- Repository runner, skill, fixture, expectations and grading prompt unchanged.
- Wrapper saved the full stream, grader prompt, stderr and generated workspace before the runner removed it. For graders only, wrapper requested stream-json and returned the final text to the stock parser, enabling independent model verification.
- Wrapper excluded personal/project/local settings, disabled hooks/MCP/Chrome/auto-memory, restricted generator tools to the upstream allowlist, and disabled grader tools. This is a controlled reproduction, not a byte-for-byte reproduction of the draft author's ambient Claude setup. Generator permission mode remained upstream acceptEdits.
- Each CLI invocation had a $3 model-cost budget and a 420-second subprocess timeout; no budget or timeout was hit. Subscription usage is distinct from the CLI cost estimate.

## Fresh runs

| Run | Context/decision/alternatives/consequences | Trade-offs/rejected options | Timeless language | Score | Exit |
|---|---|---|---|---|---|
| 1 | PASS | PASS | PASS | 3/3 | 0 |
| 2 | PASS | PASS | PASS | 3/3 | 0 |
| 3 | PASS | PASS | PASS | 3/3 | 0 |
| 4 | PASS | PASS | PASS | 3/3 | 0 |
| 5 | PASS | PASS | PASS | 3/3 | 0 |

Each run produced an ADR on disk. Full ADRs are under `run-N/generation/workspace/docs/decisions/`. All generation and grading calls completed without permission denials.

## Fixed-trace grading control

The original run-1 grader input was replayed byte-for-byte four more times. Its SHA-256 is `cf36320a3fa16f4cdb0446ca487faff932a017d5c7fc9d1e44b21911288de590` in all five observations.

| Grading | Expectation 1 | Expectation 2 | Expectation 3 | Score |
|---|---|---|---|---|
| 1 | PASS | PASS | PASS | 3/3 |
| 2 | PASS | PASS | PASS | 3/3 |
| 3 | PASS | PASS | PASS | 3/3 |
| 4 | PASS | PASS | PASS | 3/3 |
| 5 | PASS | PASS | PASS | 3/3 |

This control covers one passing trace. It does not establish grader stability for every possible ADR or the draft's two reported failing outputs.

## What this says about the draft

The source-level observation remains correct: the eval requires "timeless language describing current state," while the skill does not explicitly define that requirement. A similar rule appears in references/definition-of-done.md. Its provenance and intended application to ADRs are not established merely by finding similar wording.

However, dates and historical ADR context are not inherently incompatible with timeless prose. All five generated ADRs satisfied the grader. In run 1, the grader explicitly accepted "needs to be validated with the reporting service before rollout" as follow-up/consequence wording rather than a violation. This shows why individual quoted phrases are insufficient to establish a contradiction without the complete document.

The five original grading files cited in the Downloads draft were not supplied or independently checked. Their reported model identities and 2-fail/3-pass sequence therefore remain the author's observations, not independently verified facts. Without those original executor traces, we cannot attribute their different outcomes to generation variation, grader variation, ambient configuration, or some combination.

Recommendation: frame a report as an underspecified ADR rubric and request clarification. Do not present an independently reproduced flaky-grader bug or a high-severity failure. If retaining the original five-run table, label it as the original experiment and disclose this independent 5/5 passing reproduction and 5/5 stable fixed-trace control.

## Evidence and checks

- `verified-results.json`: all outcomes, actual model identities, prompt hash and invocation metadata.
- `run-N/`: original stock grading files, runner stdout/stderr/exit codes, full model streams, effective commands, inputs and generated ADRs.
- `fixed-trace-grade-N/`: exact repeated inputs, full grader streams and results parsed by the repository's parseGrading function.
- `source/`: exact reviewed runner, test file, skill, rubric, fixture and repository instruction files.
- `run.py` and `claude-wrapper.py`: orchestration and capture instrumentation. These preserve the original machine's paths; adjust scratch paths before rerunning elsewhere.
- Upstream run-evals unit suite: 33 passed, 0 failed; logs retained.
- Source git status after testing: clean.

14 CLI invocations: five generators and nine graders. A CLI invocation may make multiple model requests; it is not a one-request count. No issues or PRs were posted, no plugin was installed into user scope, and no unrelated repository or user Claude settings were modified. The original Downloads issue draft was not edited. No files under ~/.claude were deleted. The owned scratch clone/wrapper directory was removed after retaining evidence.
