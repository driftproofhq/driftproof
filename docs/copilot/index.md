# One GitHub Copilot instructions file, measured

Canonical: <https://driftproofhq.com/copilot/>

Driftproof reads Copilot instructions files: .github/copilot-instructions.md and .github/instructions/*.instructions.md.

Each rules file was given to the model as always-on text. The editors decide for themselves when to attach a rule, and they add their own instructions; we reproduce neither.

## What Report 021 found: a security instructions file. We could not show any help

GitHub Copilot security instructions (instructions/security-and-owasp.instructions.md in github/awesome-copilot, commit c835373), on security tasks.

Share of attempts where every hidden test passed; 120 attempts per cell, less up to 3 lost. "Tasks scoring the same in every arm" counts tasks with an identical share under no file, the file, a same-length irrelevant text and same-length generic advice. Every one of those sat at 0% or at 100%.

| Model | No file | With file | Change, points (95% range) | Tasks scoring the same in every arm |
| --- | --- | --- | --- | --- |
| Haiku | 55.8% | 63.0% | +7.1 (−4.5 to +23.0) | 6 of 12 |
| Sonnet | 60.0% | 60.8% | +0.8 (0.0 to +2.5) | 11 of 12 |

Ceiling caveat: many tasks gave the same result whatever the model was given, either always passing or never passing, so on those tasks no file could have shown a gain. For Sonnet on security, that was 11 of 12 tasks. "We could not show any help" is what these numbers support. They do not show that the files cannot help.

## Report 021's Jest result

[We gave Claude a Jest rules file from the awesome-cursorrules list and asked it to write tests for 12 small projects with bugs planted in them.](https://driftproofhq.com/reports/021/)

## Limits

- Not run inside Cursor, Copilot or Windsurf. Each rules file was given to the model as always-on text. The editors decide for themselves when to attach a rule, and they add their own instructions; we reproduce neither.
- Two Claude models only: Claude Haiku 5.5 and Claude Sonnet 5.5, through Claude Code. Other models may react differently.
- Single-turn tasks. One prompt per attempt, in a small starter project. There was no back-and-forth with a person.

## Measure your own

[Send us your file: it's free. Rules files are welcome too.](https://driftproofhq.com/measure/)

Or run it yourself: [Try it yourself.](https://driftproofhq.com/try-it/)

Full method, receipts and the offline check: [Report 021](https://driftproofhq.com/reports/021/)
