# Two Cursor rules files, measured

Canonical: <https://driftproofhq.com/cursor/>

Driftproof reads Cursor rules files: .cursor/rules/*.mdc and .cursorrules.

Each rules file was given to the model as always-on text. The editors decide for themselves when to attach a rule, and they add their own instructions; we reproduce neither.

## What Report 021 found: a Jest rules file

We gave Claude a Jest rules file from the awesome-cursorrules list and asked it to write tests for 12 small projects with bugs planted in them. With the file, Sonnet's tests caught every planted bug in 2.5% of attempts against 65.8% with no file (share of attempts that caught every bug), and caught 9.5 points fewer of the planted bugs, 85.3% against 94.8% (share of planted bugs caught). One line in the file asks for 3 to 5 tests per file. When we removed just that line and ran again, the drop went away for Sonnet on both measures, and for Haiku on the share of attempts that caught every bug.

| Jest tasks, 120 attempts per cell | Sonnet, no file | Sonnet, with file | Haiku, no file | Haiku, with file |
| --- | --- | --- | --- | --- |
| Share of attempts that caught every bug | 65.8% (79) | 2.5% (3) | 33.3% (40) | 5.0% (6) |
| Share of planted bugs caught | 94.8% | 85.3% | 92.7% | 83.9% |
| Tests written per attempt (median) | 31 | 10 | 35 | 7 |

In Cursor this file is set to attach automatically when a matching file is in context. We gave it as always-on text in every attempt, so we measured the text, not Cursor's choice of when to use it.

## A FastAPI rules file: we could not show any help

Cursor Python FastAPI rules, on FastAPI tasks.

Share of attempts where every hidden test passed; 120 attempts per cell, less up to 3 lost. "Tasks scoring the same in every arm" counts tasks with an identical share under no file, the file, a same-length irrelevant text and same-length generic advice. Every one of those sat at 0% or at 100%.

| Model | No file | With file | Change, points (95% range) | Tasks scoring the same in every arm |
| --- | --- | --- | --- | --- |
| Haiku | 88.1% | 85.0% | −3.3 (−8.3 to 0.0) | 5 of 12 |
| Sonnet | 93.3% | 95.8% | +2.1 (−5.4 to +10.8) | 6 of 12 |

Ceiling caveat: many tasks gave the same result whatever the model was given, either always passing or never passing, so on those tasks no file could have shown a gain. "We could not show any help" is what these numbers support. They do not show that the files cannot help.

## Limits

- Not run inside Cursor, Copilot or Windsurf. Each rules file was given to the model as always-on text. The editors decide for themselves when to attach a rule, and they add their own instructions; we reproduce neither.
- Two Claude models only: Claude Haiku 5.5 and Claude Sonnet 5.5, through Claude Code. Other models may react differently.
- Single-turn tasks. One prompt per attempt, in a small starter project. There was no back-and-forth with a person.

## Measure your own

[Send us your file: it's free. Rules files are welcome too.](https://driftproofhq.com/measure/)

Or run it yourself: [Try it yourself.](https://driftproofhq.com/try-it/)

Full method, receipts and the offline check: [Report 021](https://driftproofhq.com/reports/021/)
