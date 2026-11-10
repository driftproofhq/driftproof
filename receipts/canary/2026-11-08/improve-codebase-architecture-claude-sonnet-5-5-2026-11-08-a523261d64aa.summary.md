# improve-codebase-architecture — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T16:09:46.003Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `392c6e6a10d199b2…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `a523261d64aa70cc…`

## Headline

Fake tool calls: with the subject 0/9; without the subject 0/12; placebo 0/18.
with_skill **0.794 ± 0.079** vs baseline **0.698 ± 0.148**

skill lift **+0.097** (combined uncertainty ± 0.168)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `candidate` | with_skill | borderline ⚠ | 0.767 ± 0.029 | Meets criteria 1-3: it targets the validation area, names ValidateOrder as the forwarding layer, and explains via the deletion test that removal moves rather than adds complexity. Criterion 4 is weak: it names OrderRules' interface as the test surface but never argues why that seam survives the chan |
| `candidate` | baseline | fail | 0.530 ± 0.076 | Prioritizes validation area (criterion 1) and identifies the forwarding layer as candidate (criterion 2) and explains removal vs. deepening tradeoff (criterion 3 partly). Misses criterion 4: no public test seam is described. |
| `adr` | with_skill | pass | 0.883 ± 0.029 | Uses the Reservation term, identifies the conflict with the accepted ADR, and requires concrete evidence plus an ADR amendment before reopening; avoids a broad merge. Rubric criterion 4 is met by rejecting the merge, so the response fully satisfies all four and should be near 1.0, but it proposes co |
| `adr` | baseline | borderline ⚠ | 0.813 ± 0.075 | Uses the Reservation term, identifies the conflict with the accepted ADR, and rejects the merge without proposing one. It only partly meets requiring evidence: it asks for a superseding ADR but never demands supporting evidence. |
| `report` | with_skill | borderline ⚠ | 0.733 ± 0.029 | Meets criteria 1 (modules and friction named), 3 (benefits and before/after diagram), and 4 (asks which direction to take). Misses full credit on 2: the smaller interface is described only as 'a few operations', with no concrete proposal. |
| `report` | baseline | borderline ⚠ | 0.750 ± 0.000 | Names ShippingFacade and CarrierClient with concrete friction (pass-through ripple, delegation-only tests), proposes a narrower interface, and asks the user to choose direction. Benefits of the after-state are only implied, so criterion 3 is weakly met. |
## Same-length placebo

- **placebo:** 6000 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `a5943748fb9a9faf…`)
- case rule: at least one case scored above the same-length placebo, and none below
- aggregate, apart from the case rule: mean score with_skill 0.794, placebo 0.608, difference (with_skill minus placebo) +0.187, combined uncertainty ± 0.124
