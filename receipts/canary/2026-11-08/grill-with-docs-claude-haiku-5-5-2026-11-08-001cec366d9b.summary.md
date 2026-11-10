# grill-with-docs — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T15:36:27.202Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `00a1109703301a20…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `001cec366d9b4f27…`

## Headline

Fake tool calls: with the subject 0/17; without the subject 0/16; placebo 0/14.
with_skill **0.923 ± 0.025** vs baseline **0.916 ± 0.043**

skill lift **+0.007** (combined uncertainty ± 0.049)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `decision` | with_skill | pass | 0.950 ± 0.100 | It names 'booking' as the ambiguous term, asks many open design questions, proposes Hold/Reservation glossary terms consistent with the facts, and frames undecided items as questions or proposals rather than accepted decisions. |
| `decision` | baseline | pass | 0.960 ± 0.065 | Identifies the overloaded term 'booking' (hold vs. confirmed reservation), asks unresolved design questions, proposes a Hold/Reservation glossary consistent with the facts, and frames undecided items as questions or recommendations rather than accepted decisions. |
| `adr` | with_skill | pass | 0.900 ± 0.100 | Records the tombstone decision, gives the audit-export rationale, flags retention as an open question, states the consequence of hard-deletion (broken references), and claims no files were written. |
| `adr` | baseline | borderline ⚠ | 0.875 ± 0.144 | Records the tombstone decision, gives the audit-export rationale, flags retention as an open question, and lists implications without claiming any files were written. |
| `revision` | with_skill | pass | 0.920 ± 0.110 | Met criteria 1 (asks about capacity and held inventory), 3 (status Proposed, not Accepted), and 4 (no silent replacement). Missed 2: the prior 10-minute accepted rule is never named as the decision still in force. |
| `revision` | baseline | pass | 0.914 ± 0.111 | Asks how much capacity is held at peak (criterion 1), keeps the 10-minute expiry identifiable as in effect (2), marks the change 'Proposed, not accepted' (3), and does not silently replace the existing decision (4). |
## Same-length placebo

- **placebo:** 247 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `e38aecf79460987c…`)
- case rule: Not enough draws to conclude at this effect floor
- aggregate, apart from the case rule: mean score with_skill 0.923, placebo 0.885, difference (with_skill minus placebo) +0.038, combined uncertainty ± 0.058
