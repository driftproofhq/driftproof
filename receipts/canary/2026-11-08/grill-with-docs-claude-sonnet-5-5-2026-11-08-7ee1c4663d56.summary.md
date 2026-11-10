# grill-with-docs — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T16:06:57.519Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `00a1109703301a20…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `7ee1c4663d563e5f…`

## Headline

Fake tool calls: with the subject 0/10; without the subject 0/10; placebo 0/13.
with_skill **0.892 ± 0.128** vs baseline **0.986 ± 0.013**

skill lift **-0.094** (combined uncertainty ± 0.129)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `decision` | with_skill | borderline ⚠ | 0.750 ± 0.000 | Meets criteria 1-3: flags 'booking' as ambiguous, asks unresolved questions, and proposes a Hold/Reservation glossary consistent with the facts. Misses criterion 4: ADR 0001 records the unaccepted Hold/Reservation split as a 'Decision'. |
| `decision` | baseline | pass | 0.983 ± 0.029 | Identifies the overloaded term 'booking', asks many unresolved design questions, proposes a hold/reservation glossary consistent with the facts, and keeps undecided items (e.g., configurability, expiry mechanics) as open questions rather than accepted decisions. |
| `adr` | with_skill | pass | 1.000 ± 0.000 | Records the tombstone decision, explains the audit-export rationale, leaves retention as an open question, and lists consequences without claiming any files were written. |
| `adr` | baseline | pass | 1.000 ± 0.000 | Records the tombstone decision, explains the audit-export rationale (dangling references), flags retention as an open question, and includes consequences without claiming any files were written. |
| `revision` | with_skill | pass | 0.925 ± 0.096 | Q2 asks about capacity contention from abandoned holds; the 10-minute note is kept in force, the change is marked Proposed and undecided, and nothing silently replaces the prior decision. |
| `revision` | baseline | pass | 0.975 ± 0.050 | Met all four criteria: raises capacity contention and asks for quantification, names the 10-minute rule as current, marks the 30-minute proposal as not accepted, and keeps the existing rule in force. |
## Same-length placebo

- **placebo:** 247 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `e38aecf79460987c…`)
- case rule: at least one case scored below the same-length placebo
- aggregate, apart from the case rule: mean score with_skill 0.892, placebo 0.967, difference (with_skill minus placebo) -0.076, combined uncertainty ± 0.132
