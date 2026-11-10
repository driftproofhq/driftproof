# hyperframes-cli — receipt summary

- **model:** `claude-sonnet-5-5`
- **surface:** claude-cli
- **answered by: model claude-sonnet-5-5 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T16:14:10.046Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `93bc719ae762f5f4…`
- **suite:** 3 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `710f3b25a1152f66…`

## Headline

Fake tool calls: with the subject 0/11; without the subject 0/12; placebo 0/14.
with_skill **0.933 ± 0.052** vs baseline **0.642 ± 0.155**

skill lift **+0.291** (combined uncertainty ± 0.164)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `loop` | with_skill | borderline ⚠ | 0.875 ± 0.144 | Meets criteria 1, 2 and 4: catalog search by the reveal, add/author before validation, and preview with render held for approval. Misses 3: it runs a separate `lint` before `check`, contradicting its own note that check reruns lint. |
| `loop` | baseline | borderline ⚠ | 0.733 ± 0.029 | Meets criteria 1, 2, and 4: it searches the registry for headline reveal, adds before validating, and stops at preview without rendering. It misses 3 by using lint as the validation gate rather than check. |
| `timeline` | with_skill | pass | 0.950 ± 0.050 | Recommends `timeline --json` (criterion 1), explicitly distinguishes absolute main-timeline times from local sub-composition times (criterion 2), and uses the `file` field to name the owner (criterion 3); it avoids claiming full-timeline inspection (criterion 4), though the response does reference ` |
| `timeline` | baseline | borderline ⚠ | 0.730 ± 0.057 | Meets criteria 2 (absolute-to-local time mapping), 3 (resolves clip to owning file via asset table), and 4 (makes no whole-timeline claim); misses criterion 1 because it never names `timeline --json`, saying the CLI is unknown. |
| `render` | with_skill | pass | 0.975 ± 0.050 | Meets all four criteria: calls screenshot/software mode a slow-path caution rather than failure, checks duration and fps against the composition, inspects decoded frames with zoomed detail, and states a file on disk doesn't certify pixels. |
| `render` | baseline | fail | 0.463 ± 0.111 | Meets criterion 1 (notes software rendering is slow, doesn't call the render failed) and criterion 4 (completed render isn't proof of correct pixels). Misses criterion 2, since duration and frame rate aren't checked, and criterion 3, since detailed-region inspection isn't specified. |
## Same-length placebo

- **placebo:** 25989 bytes, the skill text's length in bytes, from the revision 1 corpus, a fixed text chosen without reference to any task (sha256 `bd367119be1aa303…`)
- case rule: at least one case scored above the same-length placebo, and none below
- aggregate, apart from the case rule: mean score with_skill 0.933, placebo 0.674, difference (with_skill minus placebo) +0.259, combined uncertainty ± 0.090
