# improve-codebase-architecture — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T15:40:10.555Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `392c6e6a10d199b2…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `16c69348adf10f32…`

## Headline

Fake tool calls: with the subject 0/19; without the subject 0/16; placebo 0/20.
with_skill **0.831 ± 0.061** vs baseline **0.616 ± 0.155**

skill lift **+0.214** (combined uncertainty ± 0.166)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `candidate` | with_skill | borderline ⚠ | 0.769 ± 0.110 | Meets prioritizing validation, identifying the forwarding layer, and explaining that removal only removes a hop. Test seam is named as OrderRules, but it never explicitly argues why the seam survives the change. |
| `candidate` | baseline | fail | 0.557 ± 0.117 | Met criteria 1 (prioritizes the validation area) and 2 (identifies ValidateOrder as the forwarding-layer candidate). Missed 3, since it never states whether removal concentrates or merely moves complexity, and missed 4, since it names no test seam and doesn't explain why one survives. |
| `adr` | with_skill | borderline ⚠ | 0.890 ± 0.152 | Uses the Reservation term, explicitly flags the accepted ADR conflict, requires concrete friction evidence before reopening, and proposes no broad merge; all four criteria met. |
| `adr` | baseline | borderline ⚠ | 0.792 ± 0.146 | Uses the Reservation term, identifies the conflict with the accepted ADR, requires a superseding ADR with justification before reversing, and does not propose a merge for fewer modules. |
| `report` | with_skill | pass | 0.833 ± 0.082 | Names modules and friction (criterion 1), proposes a narrower interface (2), and gives benefits plus before/after (3), but ends with decision questions, not an explicit ask to choose a direction, so criterion 4 is only partly met; the rubric is also scored all-or-nothing per criterion, so 0.5 is the |
| `report` | baseline | fail | 0.500 ± 0.050 | Meets criterion 1 by naming ShippingFacade, CarrierClient and the shallow-exposure friction, and criterion 4 by framing open decisions without claiming completion. Misses criterion 2 (only vague hiding directions, no concrete smaller interface) and criterion 3 (no benefits or before/after of the cha |
## Same-length placebo

- **placebo:** 6000 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `a5943748fb9a9faf…`)
- case rule: at least one case scored above the same-length placebo, and none below
- aggregate, apart from the case rule: mean score with_skill 0.831, placebo 0.613, difference (with_skill minus placebo) +0.218, combined uncertainty ± 0.110
