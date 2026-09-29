---
disable-model-invocation: true
description: Scaffold a Driftproof evaluation suite for a skill — SKILL.md and evals/evals.json — into a new directory, using the pinned CLI and nothing else.
---

# /driftproof:init

Scaffold a new skill's measurement suite in this repository.

This is a door onto the published Driftproof CLI. It runs
`driftproof init <dir>` at the version this plugin pins, and it does nothing
else: it creates no other file, fetches nothing, and reads nothing it was not
given. The CLI is the product and it runs on every surface Driftproof measures,
while the plugin is one install path for Claude Code users.

## How to run it

Run the door script the plugin ships. Claude Code puts the plugin's
installation directory into the line below when it loads this command, so the
path is already absolute: run the line as it reads, with your own `<dir>`.

    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" init <dir>

`<dir>` is where the new skill goes. It must not already exist — this command
scaffolds, and it will not write over something that is already there.

## What it will do, in order

1. Check `<dir>` against the shipped input contract in `input-contract.json`.
   A path carrying a control character is refused here, before anything runs.
2. Read the resolved runner version with `--version` and compare it against the
   minimum in `version-guard.json`. A runner older than that minimum is refused
   with both versions named. This probe writes nothing and spends nothing.
3. Run the pinned CLI's `init` once.

## What it will not do

It will not touch an existing skill. Everything it creates goes into the new
directory, and the scaffolded SKILL.md and evals/evals.json are yours to fill
in afterwards — by hand, or by asking Claude in the ordinary way. This command
has no opinion about their contents and offers none.

```driftproof-steps
[
  {"op": "validate", "inputs": ["skill-dir"], "target_exists": false},
  {"op": "resolve-target", "input": "skill-dir", "inside_repo": false},
  {"op": "version-guard"},
  {"op": "cli", "args": ["init", "@skill-dir"]},
  {"op": "say", "text": "scaffolded. Nothing outside that directory was written."}
]
```
