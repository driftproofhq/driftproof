---
disable-model-invocation: true
description: Measure a skill in this repository against a model with the pinned Driftproof runner, on the trusted lane, and print the receipt it wrote.
---

# /driftproof:run

Measure a skill that lives in this repository and write a receipt.

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

With no `--models`, the run uses the cheapest registered model in the runner's
own registry, resolved by reading it. The model id is deliberately not written
into this file: a literal here would go stale the day the registry moves.

With no `--max-calls` and no `--max-usd`, neither flag is passed at all, so the
runner's own defaults apply and there is exactly one place those numbers live.

Those three are the only flags this command takes. **Anything else is refused,
not ignored.** A door that quietly dropped a flag would let you ask for one
judge sample, get five, and read a receipt recording five with nothing to say
your argument had been discarded. For everything else the runner offers, call
the CLI directly, so that what you asked for is what runs.

## What it will do, in order

1. Check every input you gave against the shipped contract in
   `input-contract.json` — the same rules the Action uses, held identical to
   `action/lib.sh` by the spec's gate. **This happens before anything is
   spawned.** A model list, a cap or a path carrying a quote, a semicolon, a
   command substitution, a backtick or a newline is refused here, named, and
   nothing runs. No value you supply is ever composed into a shell string;
   there is no shell anywhere in this path.
2. Resolve the skill directory to its real path and require it to be inside
   this repository. See *the trusted lane* below.
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
resolves outside and is refused.

Outside the repository, or with no git repository at all, this command refuses
and prints the invocation that runs with the isolation account instead, without
`--trusted-skill`. It does not quietly weaken the boundary, and it does not
swallow the runner's own message about a missing isolation account: that
refusal is the CLI's to give.

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

It measures. It never changes what it measured, and it has no opinion about how
to make a score better.

```driftproof-steps
[
  {"op": "validate", "inputs": ["skill-dir", "models", "max-calls", "max-usd"]},
  {"op": "resolve-target", "input": "skill-dir", "inside_repo": true},
  {"op": "state-trusted"},
  {"op": "version-guard"},
  {"op": "resolve-model"},
  {"op": "cli", "args": [
    "run", "@skill-dir",
    {"emit": ["--models", "@models"]},
    {"when": "max-calls", "emit": ["--max-calls", "@max-calls"]},
    {"when": "max-usd", "emit": ["--max-usd", "@max-usd"]},
    "--trusted-skill"
  ]}
]
```
