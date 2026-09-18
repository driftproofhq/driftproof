# Session economy

Every session in this repo follows these rules:

1. Long commands (`gate.sh --final`, sweeps, builds, screenshot writes) are started once and waited on with a single blocking call. Never poll, tail, or re-check progress, and never launch a waiter or monitor task for them.
2. Read a file once per session; do not re-read files already in context. Read specific line ranges rather than whole files when the location is known.
3. Report with `git diff --stat` and the summary line of a gate, not full diffs or full logs, unless a finding requires the exact lines.
4. No restating of the constitution, checklist, or spec text in replies; cite the section instead.
5. Replies end with what changed, the commit, and what is left, in under fifteen lines.
6. Mechanical passes (evidence commits, pushes, re-baseline runs, screenshot rewrites, release-note edits) do not need extended thinking; only findings and design decisions do.
7. No background subagents for approvals; approvals run in their own session.
