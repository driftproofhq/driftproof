# Report 010 fix runs: documentation-and-adrs at adfeacb (fix/adr-eval-unstable-expectation)

| Run | pass_rate | exit | executor_model | grader_model | timestamp |
|---|---|---|---|---|---|
| 1 | 1.000 (3/3) | 0 | claude-opus-5 | unknown | 2026-09-21T15:11:56.407Z |
| 2 | 1.000 (3/3) | 0 | claude-opus-5 | unknown | 2026-09-21T15:12:31.538Z |
| 3 | 1.000 (3/3) | 0 | claude-opus-5 | unknown | 2026-09-21T15:13:10.584Z |
| 4 | none: grader output rejected (malformed JSON), raw saved | 1 | not recorded (no grading.json) | - | - |
| 5 | 1.000 (3/3) | 0 | claude-opus-5 | unknown | 2026-09-21T15:14:24.100Z |

| Expectation | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| 1. context, decision, alternatives, consequences distinct | ✓ | ✓ | ✓ | n/a | ✓ |
| 2. trade-offs and rejected options recorded | ✓ | ✓ | ✓ | n/a | ✓ |
| 3. status (Proposed/Accepted/Superseded/Deprecated) and a date | ✓ | ✓ | ✓ | n/a | ✓ |
