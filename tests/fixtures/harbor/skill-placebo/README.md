<!-- SPDX-License-Identifier: Apache-2.0 -->
# skill-placebo trials (fixture subset)

These files are copied byte for byte from
[simonether/skill-placebo](https://github.com/simonether/skill-placebo) at commit
`caeb74c060f5c9523d101abc926b5a309f85d693`. That repository is MIT licensed. Its licence
is in `LICENSE` beside this file, as the licence requires.

What is here:

- `trials/<arm>/<job>/<trial>/result.json`: Harbor trial results from the Claude Code
  main run, for the baseline arm and the nine skill arms, on three tasks:
  `application-debug`, `django__django-13512` and `django__django-15957`. Two trials per
  task and arm, 60 files.
- `claude-code.json`: the source's own published per-skill comparison
  (`results/main/claude-code.json`). The importer never reads it. Spec 266's tests read
  it to check the opposite-direction listing.
- `SOURCES.json`: each file's path in the source and its git blob sha1 at that commit,
  as the GitHub tree API reported it. The tests recompute each sha1 from the bytes here.

The trials were picked by arm and task only, never by result. Nothing in them is
edited. The source scrubbed its own local paths to `~` before it published them.

Driftproof spec: `specs/266-harbor-import/spec.md`.
