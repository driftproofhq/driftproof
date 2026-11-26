# One Windsurf rules file, measured

Canonical: <https://driftproofhq.com/windsurf/>

Driftproof reads Windsurf rules files: .windsurfrules and .windsurf/rules/*.md.

Each rules file was given to the model as always-on text. The editors decide for themselves when to attach a rule, and they add their own instructions; we reproduce neither.

## What Report 021 found: the Honey rules. We could not show any help

Windsurf "Honey" rules (.windsurf/rules/honey.md in Green-PT/honey-for-devs, commit 6eb60f9), on general code tasks.

Share of attempts where every hidden test passed; 120 attempts per cell, less up to 3 lost. "Tasks scoring the same in every arm" counts tasks with an identical share under no file, the file, a same-length irrelevant text and same-length generic advice. Every one of those sat at 0% or at 100%.

| Model | No file | With file | Change, points (95% range) | Tasks scoring the same in every arm |
| --- | --- | --- | --- | --- |
| Haiku | 64.4% | 67.2% | +2.9 (−2.5 to +8.7) | 4 of 12 |
| Sonnet | 72.0% | 71.4% | −0.8 (−5.0 to +3.3) | 7 of 12 |

Ceiling caveat: many tasks gave the same result whatever the model was given, either always passing or never passing, so on those tasks no file could have shown a gain. "We could not show any help" is what these numbers support. They do not show that the files cannot help.

On the second measure, the share of hidden tests passed, one comparison cleared our bar. For Haiku, the Windsurf file scored +1.3 points over no file (+0.03 to +2.8). Generic advice of the same length, written from the topic alone, scored +1.1 (+0.04 to +2.4) on the same measure. So we cannot tie that gain to this file.

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
