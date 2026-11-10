# hyperframes-cli — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T15:44:20.274Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `93bc719ae762f5f4…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `6682f47cf47425d1…`

## Headline

Fake tool calls: with the subject 0/12; without the subject 0/13; placebo 0/18.
with_skill **0.945 ± 0.018** vs baseline **0.417 ± 0.176**

skill lift **+0.528** (combined uncertainty ± 0.177)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `loop` | with_skill | pass | 0.960 ± 0.065 | Searches the catalog by the reveal, runs add/init/author before validation, makes check the final gate with no trailing lint, and stops at preview pending render approval. |
| `loop` | baseline | fail | 0.400 ± 0.108 | Meets criterion 1 (registry search by headline reveal) and criterion 4 (preview, then wait for render approval). Misses criterion 2, since it never names an add/author workflow, and criterion 3, since it uses lint/static validation rather than check as the final gate. |
| `timeline` | with_skill | pass | 0.950 ± 0.050 | Meets criteria 1 (uses timeline --json), 2 (clearly separates absolute absStart/absEnd from local range and computes local 4s), and 3 (identifies file as owner field); misses 4 only partially since it doesn't claim full inspection, so it is satisfied, but criterion 4 is met too, yet the response's ' |
| `timeline` | baseline | fail | 0.600 ± 0.134 | Met criteria 2 (absolute vs. local time mapping to 4s), 3 (locating the owning mount and scene file), and 4 (no claim of full timeline inspection); missed criterion 1 because it never mentions `timeline --json`. |
| `render` | with_skill | pass | 0.925 ± 0.087 | Meets criteria 1 (recognizes slow software-GPU screenshot path without claiming failure), 2 (checks duration and fps against composition), and 3 (inspects decoded frames with zoom into detailed regions); misses 4 partially since it does state 'nothing is verified' and gates on steps 2-4, but does no |
| `render` | baseline | fail | 0.250 ± 0.000 | Meets criterion 4 by stating a completed render is not proof of correctness, but misses criterion 1 (no slow-path recognition), criterion 2 (no duration or frame-rate check), and criterion 3 (no detailed-region inspection). |
## Same-length placebo

- **placebo:** 25989 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `bd367119be1aa303…`)
- case rule: at least one case scored above the same-length placebo, and none below
- aggregate, apart from the case rule: mean score with_skill 0.945, placebo 0.481, difference (with_skill minus placebo) +0.464, combined uncertainty ± 0.090
