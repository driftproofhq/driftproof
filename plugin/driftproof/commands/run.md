---
disable-model-invocation: true
description: Measure a skill in this repository, or, after the person confirms the skill is theirs, in a folder with no git repository, against a model with the pinned Driftproof runner, on the trusted lane, and print the receipt it wrote. A skill with no test cases is offered a draft first.
---

# /driftproof:run

Measure a skill that lives in this repository and write a receipt. Where there is no git
repository and the person confirmed the skill is theirs, it measures a skill inside the
folder you run from instead.

This is a door onto the published Driftproof CLI. It builds one argument vector
and hands it to the pinned runner. It bundles no runner, reimplements no
measurement, and holds no copy of the receipt shape. The receipt it produces is
byte-for-byte the receipt `driftproof run` would have produced from the same
arguments, but for the fields that move on every run.

## How to run it

Claude Code puts the plugin's installation directory into the lines below when
it loads this command, so the path is already absolute: run a line as it reads,
with your own `<skill-dir>` and any values you chose.

    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" run <skill-dir>
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" run <skill-dir> --models a,b --max-calls <n> --max-usd <n>
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" run <skill-dir> --samples <n> --concurrency <n> --max-cases <n>
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" run <skill-dir> --quick
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" run <skill-dir> --trust-outside-repo

With no `--models`, the run uses the cheapest registered model in the runner's
own registry, resolved by reading it. The model id is deliberately not written
into this file: a literal here would go stale the day the registry moves.

With no `--max-calls` and no `--max-usd`, neither flag is passed at all, so the
runner's own defaults apply and there is exactly one place those numbers live.

`--samples`, `--concurrency` and `--max-cases` are passed to the runner as you
give them, after the same check the runner makes of them: each must be a
positive whole number with no leading zero. With none of them, the runner's own
defaults apply.

`--quick` is a smoke run: few judge samples, a few cases at once, and at most a
handful of cases, set by the runner itself, so it is refused beside any of the
three above. It shows that the skill and its test cases run. **A smoke run
cannot produce a verdict**: its receipt says so, and every reader of it says
so.

`--trust-outside-repo` is for a skill in a folder that is not in a git
repository, and only after the person has said the skill is theirs; see *the
trusted lane* below. It takes no value.

Those are the only flags this command takes. **Anything else is refused, not
ignored.** A door that quietly dropped a flag would let you ask for one judge
sample, get five, and read a receipt recording five with nothing to say your
argument had been discarded. For everything else the runner offers, call the
CLI directly, so that what you asked for is what runs.

While it runs, the runner prints a line each time a call finishes, with the
calls made, how many there can be in all, and about how long is left. When the
model grading the answers is the model that wrote them, it prints a warning
before the first call. It is, unless the working directory's `.driftproofrc`
sets `judge_model`.

## A skill with no test cases

A skill that holds a `SKILL.md` and no `evals/evals.json` has nothing to measure, and
the runner stops with its own message. Before it does, this command says the skill has
no test cases and that a draft is on offer. **Ask the person.** Tell them the skill has
no test cases yet, and offer to draft the test cases with the person from the skill
itself: that is `/driftproof:start`, which drafts them with Claude, adds one new file,
`evals/evals.json`, only after a yes, and runs a quick first look. Take the guided steps
only after a yes, and follow `/driftproof:start`'s steps, never a shortcut of your own.
Nothing is written by this command, and never give `--confirm-write` here.

If the person declines, or does not answer, stop there. The runner has already ended
with its own message, the folder is exactly as it was, and nothing is written.

## What it will do, in order

1. Check every input you gave against the shipped contract in
   `input-contract.json` — the same rules the Action uses, held identical to
   `action/lib.sh` by the spec's gate. **This happens before anything is
   spawned.** A model list, a cap or a path carrying a quote, a semicolon, a
   command substitution, a backtick or a newline is refused here, named, and
   nothing runs. No value you supply is ever composed into a shell string;
   there is no shell anywhere in this path.
2. Resolve the skill directory to its real path and require it to be inside
   this repository, or, where there is no git repository and the person
   confirmed it with `--trust-outside-repo`, to be a skill inside that folder, on its real path. See
   *the trusted lane* below.
3. Read the resolved runner version with `--version` and compare it against the
   minimum in `version-guard.json`, refusing an older runner with both versions
   named.
4. Resolve the default model, if you did not name one.
5. Run the pinned CLI once, with `--trusted-skill`.

## The trusted lane, and why the boundary is the repository

The run passes `--trusted-skill`, which means the runner measures the skill as
you, in your checkout, with no isolation hop. That flag is a claim that a person
looked at the skill and owns it. It is available only for a skill that resolves
inside this repository, on its real path — a symlink pointing out of the tree
resolves outside and is refused. Where the person confirmed it with
`--trust-outside-repo` and there is no git repository, it is available only for
a skill inside the folder you run from, on its real path: a skill elsewhere on
the machine, and a link in that folder pointing out of it, are refused, flag or
not.

Outside the repository this command refuses and prints the invocation that runs
with the isolation account instead, without `--trusted-skill`. It does not
quietly weaken the boundary, and it does not swallow the runner's own message
about a missing isolation account: that refusal is the CLI's to give.

With no git repository at all there is no boundary to stand in for the claim, so
the person makes it. Without `--trust-outside-repo` the command refuses, with one
message that gives the isolated invocation, says whether this machine has the
isolation account, and offers that flag.
**Before you pass `--trust-outside-repo`, ask the person**, in these words or
close to them, with the skill's real path and the folder you run from filled in
(the refusal prints both):
*"There is no git repository here, so I cannot tell this skill is yours. Did you
write the skill at <real path> yourself? If yes, it will run from <folder>, as
you, with your files and your Claude Code login."*
Pass the flag only after a yes, and never on your own judgement.
The command never asks on its own: it reads nothing from its input, so a yes
typed there does nothing. Inside a git repository the flag is refused, and where
git cannot say whether there is a repository the command refuses, flag or not.

## What it depends on that nobody has promised

This command spends your Claude Code subscription, not an API key. It works
because the runner's `claude` lane spawns `claude -p` and that child reaches the
subscription surface when it is started from **inside a Claude Code session**,
with `ANTHROPIC_API_KEY` deleted from the child environment rather than
required. Measured here on Claude Code **2.1.263**, re-measured on this tree
rather than carried over from an earlier session.

That behaviour is **not documented** and is not a contract. The session sets
CLAUDE_CODE_CHILD_SESSION and a set of CLAUDE_CODE_ variables, and the runner's
trusted branch copies the environment wholesale; nothing in that set refuses the
child today. If a future version does, the failure looks like a `claude -p`
child exiting non-zero with an authentication message, and every case in the run
becomes an unmeasured draw. The fix then is to run the CLI directly with an API
key on the `api` surface, which is a metered path and a different bill.

## What it will not do

It measures and never changes a skill's instructions. It never changes what it
measured, and it has no opinion about how to make a score better.

```driftproof-steps
[
  {"op": "validate", "inputs": ["skill-dir", "models", "max-calls", "max-usd", "samples", "concurrency", "max-cases"]},
  {"op": "resolve-target", "input": "skill-dir", "inside_repo": true},
  {"op": "offer-draft"},
  {"op": "state-trusted"},
  {"op": "version-guard"},
  {"op": "resolve-model"},
  {"op": "cli", "args": [
    "run", "@skill-dir",
    {"emit": ["--models", "@models"]},
    {"when": "max-calls", "emit": ["--max-calls", "@max-calls"]},
    {"when": "max-usd", "emit": ["--max-usd", "@max-usd"]},
    {"when": "samples", "emit": ["--samples", "@samples"]},
    {"when": "concurrency", "emit": ["--concurrency", "@concurrency"]},
    {"when": "max-cases", "emit": ["--max-cases", "@max-cases"]},
    {"when": "quick", "emit": ["--quick"]},
    "--trusted-skill"
  ]}
]
```
