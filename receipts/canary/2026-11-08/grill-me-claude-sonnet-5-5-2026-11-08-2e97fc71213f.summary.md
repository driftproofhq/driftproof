# grill-me — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T16:04:45.679Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `732e5bc9f9cf2b78…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `2e97fc71213f3689…`

## Headline

Fake tool calls: with the subject 0/17; without the subject 0/14; placebo 0/13.
with_skill **0.709 ± 0.159** vs baseline **0.743 ± 0.126**

skill lift **-0.034** (combined uncertainty ± 0.203)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `plan` | with_skill | borderline ⚠ | 0.843 ± 0.106 | Meets duplicate billing as key risk (item 1), rollback/coexistence questions (items 4-6), and waits for answers before a final design. Misses criterion 3: it never explicitly separates supplied facts from assumed ones. |
| `plan` | baseline | borderline ⚠ | 0.792 ± 0.143 | Meets duplicate-billing risk (point 1) and asks about rollback and parallel/shadow running (point 2), and separates unknown facts from undecided items (point 3). Misses point 4: it presents a concrete recommended design, though labeled 'pending your answers'. |
| `constraint` | with_skill | fail | 0.533 ± 0.121 | Meets only the freshness/latency criterion (Q1-Q2). It probes whether the fixed DB constraint covers indexes and replicas, and asks about infrastructure that depends on that answer, while calling the questions 'each answerable on its own'. It gives no recommendation. |
| `constraint` | baseline | borderline ⚠ | 0.600 ± 0.191 | Meets criteria 1-3: respects the fixed database, asks freshness and latency targets, and avoids settled dependent implementation questions. Misses criterion 4 because it gives no recommendation, only questions. |
| `followup` | with_skill | borderline ⚠ | 0.750 ± 0.231 | Asks about channel first and defers provider choice (criteria 2 and 3 met), but it reopens the settled 24-hour rollback decision by offering reinterpretations and a new pre-send-hold design, and it proposes email as a provisional channel rather than purely waiting; criterion 4 is met since it claims |
| `followup` | baseline | borderline ⚠ | 0.838 ± 0.144 | Response keeps the settled weekly digest, opt-in audience, and 24-hour rollback without reopening them, asks about channel first, defers provider choice until channel is known, and does not claim agreement or start implementation. |
## Same-length placebo

- **placebo:** 157 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `51f45bc785df83cd…`)
- case rule: Not enough draws to conclude at this effect floor
- aggregate, apart from the case rule: mean score with_skill 0.709, placebo 0.783, difference (with_skill minus placebo) -0.075, combined uncertainty ± 0.244
