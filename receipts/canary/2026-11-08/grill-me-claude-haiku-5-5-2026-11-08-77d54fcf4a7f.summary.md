# grill-me — receipt summary

- **model:** `claude-haiku-5-5`
- **surface:** claude-cli
- **answered by: model claude-haiku-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T15:33:46.390Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `732e5bc9f9cf2b78…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `77d54fcf4a7f6d39…`

## Headline

Fake tool calls: with the subject 0/12; without the subject 0/15; placebo 0/12.
with_skill **0.775 ± 0.123** vs baseline **0.701 ± 0.119**

skill lift **+0.074** (combined uncertainty ± 0.171)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `plan` | with_skill | pass | 0.917 ± 0.029 | Meets duplicate billing as a key risk, rollback/coexistence (Q5), and waiting before a final design; distinguishes decisions from facts only implicitly (budget vs. inventory/idempotency questions), not explicitly. |
| `plan` | baseline | borderline ⚠ | 0.640 ± 0.114 | Meets duplicate-billing risk, rollback/coexistence questions, and distinguishes unknown facts (codebase, provider, budget definition). Misses criterion 4: its summary proposes a multi-step rollout design before the user answers. |
| `constraint` | with_skill | borderline ⚠ | 0.700 ± 0.050 | Meets criterion 2 (asks latency target and freshness) and criterion 3 (questions are independent), but misses 1 (never acknowledges the fixed database) and 4 (gives no recommendation). |
| `constraint` | baseline | fail | 0.625 ± 0.121 | Meets criteria 1-3: respects the fixed database, asks about latency and freshness targets, and avoids settled dependent questions. Misses criterion 4 because it gives no recommendation alongside its questions. |
| `followup` | with_skill | borderline ⚠ | 0.708 ± 0.169 | Defers provider choice until channel is known and claims no agreement or implementation (points 3-4), but reopens the agreed 24-hour rollback window and asks about rollback rather than channel first (points 1-2). |
| `followup` | baseline | borderline ⚠ | 0.838 ± 0.103 | Asks about the delivery channel first, defers provider questions until the channel is chosen, does not reopen the opt-in, weekly, or rollback decisions, and claims no agreement or implementation. |
## Same-length placebo

- **placebo:** 157 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `51f45bc785df83cd…`)
- case rule: at least one case scored below the same-length placebo
- aggregate, apart from the case rule: mean score with_skill 0.775, placebo 0.814, difference (with_skill minus placebo) -0.039, combined uncertainty ± 0.193
