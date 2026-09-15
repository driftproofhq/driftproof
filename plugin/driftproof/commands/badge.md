---
disable-model-invocation: true
description: Verify a Driftproof receipt with the pinned CLI, render its shields badge and README snippet, and state plainly which digests were not checked.
---

# /driftproof:badge

Render a badge from a receipt — and say what the badge does not prove.

## How to run it

Claude Code puts the plugin's installation directory into the line below when
it loads this command, so the path is already absolute: run the line as it reads,
with your own `<receipt.json>`.

    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" badge <receipt.json>

## What it will do, in order

1. Check the path against the shipped contract in `input-contract.json`, and
   require it to be a file that is already there.
2. Read the resolved runner version with `--version` and compare it against the
   minimum in `version-guard.json`.
3. Run the pinned CLI's `validate` on the receipt. **If that exits non-zero,
   nothing is rendered.** A receipt with one byte moved in its body fails here
   with `receipt_hash` named, because `receipt_hash` is computed over the whole
   receipt with that field removed.
4. If retained transcripts sit beside the receipt under
   `transcripts/<receipt_hash>/`, recompute each case's `generation_hash` from
   the retained generation text, and each of its `judge_sample_hashes` from the
   retained judge texts (`judge_outputs`), and refuse on any mismatch, naming
   the digest, the case and the mode. Every case that carries either digest
   must have a transcript listed in `index.json`, or the command refuses the
   same way. Only files inside `transcripts/<receipt_hash>/` are read: an
   `index.json` entry that is not a relative path, or that resolves outside that
   directory by name or through a symbolic link, is refused, naming the entry,
   before it is read.
5. Ask the pinned CLI for the shields JSON and print it byte-for-byte as the CLI
   produced it. This command does not compose it: reproduce it by running
   `npx driftproof@<pinned> badge <receipt>` yourself.
6. Print the README snippet, **derived from the JSON of step 5** by this rule and
   nothing else:

       "README snippet (shields.io endpoint, pointed at the badge JSON you commit):\n"
       + "  ![" + <the JSON's label> + "](https://img.shields.io/endpoint?url=https://YOUR-HOST/badge.json)\n"

   Its one variable input is the runner's own `label`; the rest is the
   placeholder you replace with the URL of the badge JSON you commit. It is
   presentation of the runner's output, not a second measurement, and with no
   JSON captured the command refuses rather than printing a constant.
7. Print what was **not** checked.

## Why step 7 exists, and why it is the point of this command

`receipt_hash` proves one thing: the receipt has not been altered since it was
sealed. It does not prove the receipt describes a run that happened, and it does
not bind the receipt to the evidence it summarises. The same edit followed by a
re-seal verifies cleanly. That is what integrity-since-sealing means, and it is
less than most readers of a green badge assume.

Two further digests sit in every receipt, one per case:

- `generation_hash` — the sha256 of the generation text that was graded.
- `judge_sample_hashes` — one hash per judge sample.

**Neither can be recomputed from a receipt handed over on its own**, because the
receipt does not carry the text either one digests. There is no transcript hash
in this tree at all — nothing that binds a receipt to a body of evidence as a
whole. Transcripts are kept only when the run passed `--keep-transcripts`, and
then only beside the receipt, outside it and outside its hash.

So this command states the limit every time it renders. Reporting those digests
as verified when the bytes behind them were never kept would be the one thing
standing between a fabricated receipt and a green badge, telling a comfortable
lie. When the transcripts are there, step 4 checks `generation_hash` and
`judge_sample_hashes` for real, and the statement says so with the number of
cases and judge texts it rechecked. When they are not there, the statement says
what the receipt records in `run.transcripts`. A receipt that records
`hashes-only` came from a run that kept only the digests. A receipt that records
`retained-local` came from a run that kept its transcripts where it ran, and the
statement says to put them beside the receipt.

## What it will not do

It renders. It changes nothing, and it does not tell you how to score better.

```driftproof-steps
[
  {"op": "validate", "inputs": ["receipt"]},
  {"op": "resolve-target", "input": "receipt", "inside_repo": false},
  {"op": "version-guard"},
  {"op": "cli", "args": ["validate", "@receipt"], "capture": true,
   "on_fail": "the pinned CLI refused this receipt, so nothing was rendered. The digest that failed is receipt_hash: the receipt has been altered since it was sealed."},
  {"op": "recheck-transcripts"},
  {"op": "cli", "args": ["badge", "@receipt"], "capture": true, "render": true,
   "on_fail": "the pinned CLI refused to render a badge for this receipt (receipt_hash did not verify)."},
  {"op": "readme-snippet", "from": "render"},
  {"op": "not-checked"}
]
```
