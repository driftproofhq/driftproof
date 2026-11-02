---
disable-model-invocation: true
description: Open the pinned Driftproof runner's results page and leave the blind reading to the person.
---

# /driftproof:blind

Open the paired reading from local receipts. This is a door onto the published
CLI. It measures nothing itself.

## How to run it

Claude Code substitutes the plugin's installation directory in these lines.
Run one from the person's repository, with their receipts directory if named.

    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" blind
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" blind <receipts-dir>

The default directory is `receipts`. The command takes one directory and no
flags. It checks the path against `input-contract.json`, requires an existing
directory inside this repository on its real path, then reads the pinned
runner's `--version` against the minimum in `version-guard.json`. It runs
`view <receipts-dir> --out driftproof-view.html` and opens that file from disk.
A failed version check or view stops before the opener.

## Leave the reading to the person

Tell the person the **Blind read** block is theirs alone. Do not read the page source or the person's picks.
Do not inspect the retained answers, hidden labels or browser storage to do the
reading for them. Ask them to come back after Reveal and share what the page
says. Wait for them before discussing the result.

After they return, say what the page says, in the words they share, including
its honesty line. Ask them to share that line if it is missing. Do not infer a
verdict from their picks or turn their preferences into a measured result. A
smoke run cannot produce a verdict.

If there is no Blind read block, ask what the page says and explain that reason.
If it gives no reason, say that this page does not offer the block and that you
cannot tell why from what they shared. The runner may not yet support it, or
the receipts may lack the retained answers it needs. Offer the two ways to make
a run for the reading: `/driftproof:run <file> --suite <tasks> --placebo --keep-transcripts`,
or `/driftproof:start`. Do not promise a block from a runner that lacks it, and
do not start another run until the person chooses it.

```driftproof-steps
[
  {"op": "validate", "inputs": ["receipts-dir"]},
  {"op": "resolve-target", "input": "receipts-dir", "inside_repo": true},
  {"op": "version-guard"},
  {"op": "cli", "args": ["view", "@receipts-dir", "--out", "driftproof-view.html"]},
  {"op": "open-view", "file": "driftproof-view.html"}
]
```
