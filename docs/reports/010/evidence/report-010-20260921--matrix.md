# Report 010: documentation-and-adrs behavioural eval, five runs

agent-skills commit: dc27a9c2e13721158157632de61b4106c6c2a2a1 (origin/main, 2026-09-21)
Command per run: node scripts/run-evals.js --behavioral documentation-and-adrs
Default model setting during runs: claude-opus-5 (restored to "opus[1m]" at 2026-09-21T14:56:03Z; sha256 matches pre-run)

| Run | pass_rate | passed/total | exit | verdict | executor_model (resolved) | grader_model (as recorded) | timestamp |
|---|---|---|---|---|---|---|---|
| 1 | 0.667 | 2/3 | 1 | FAIL | claude-opus-5 | unknown | 2026-09-21T14:53:23.182Z |
| 2 | 1.000 | 3/3 | 0 | PASS | claude-opus-5 | unknown | 2026-09-21T14:54:05.167Z |
| 3 | 0.667 | 2/3 | 1 | FAIL | claude-opus-5 | unknown | 2026-09-21T14:54:43.083Z |
| 4 | 1.000 | 3/3 | 0 | PASS | claude-opus-5 | unknown | 2026-09-21T14:55:24.509Z |
| 5 | 1.000 | 3/3 | 0 | PASS | claude-opus-5 | unknown | 2026-09-21T14:56:03.532Z |

| Expectation | R1 | R2 | R3 | R4 | R5 | passes |
|---|---|---|---|---|---|---|
| 1. The ADR states context, decision, alternatives, and consequences distinctly | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 |
| 2. Trade-offs and rejected options are recorded, not just the winning choice | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 |
| 3. The document is written in timeless language describing current state | ✗ | ✓ | ✗ | ✓ | ✓ | 3/5 |

Mean pass_rate 0.867; eval verdict 3 PASS / 2 FAIL.
