# git-workflow-and-versioning — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **run (UTC):** 2026-08-31T05:42:11.959Z
- **runner:** v0.6.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `2ed0afa4e21f72ac…`
- **suite:** 7 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `abec2aed0bc78b80…`

## Headline

with_skill **0.824 ± 0.122** vs baseline **0.826 ± 0.115**

skill lift **-0.002** (combined uncertainty ± 0.167)

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.863 ± 0.004 | Exemplary response. Correct conventional type (fix:), specific subject, body concisely explains both user-facing consequence (expired after ~1 hour not 24) and root cause (wrong time unit conversion), enabling maintainer action. |
| `commit-message-conventional-type` | baseline | pass | 0.861 ± 0.011 | Correct `fix:` type, specific subject line, and body clearly explains both user-facing consequence (1-hour vs 24-hour expiry) and root cause (wrong time unit). |
| `semver-clean-bump` | with_skill | pass | 0.867 ± 0.011 | Correctly classifies optional parameter as MINOR, rules out MAJOR, proposes 2.4.0, and exemplarily maps memory-leak fix to PATCH definition. |
| `semver-clean-bump` | baseline | pass | 0.869 ± 0.004 | Correctly classifies optional parameter as MINOR, memory leak fix as PATCH, rules out MAJOR, proposes 2.4.0 with sound justification. |
| `split-into-atomic-commits` | with_skill | pass | 0.863 ± 0.012 | Three separate, well-ordered commits with correct conventional prefixes. Refactor isolated; formatting separate; feature+tests grouped. Explicitly justifies with reviewability/revertability and orders refactor before dependent feature. |
| `split-into-atomic-commits` | baseline | pass | 0.870 ± 0.018 | All checkpoints met: 3+ commits, refactor isolated, formatting separate, feature+tests grouped, proper conventional types. Shows exemplary ordering awareness and explicit reviewability/revertability rationales. |
| `changelog-curated-by-impact` | with_skill | pass | 0.872 ± 0.007 | All criteria met: correct header, grouped by category, internal changes omitted, entries properly categorized with replacement endpoint clearly signaled and migration window specified (4.0.0), user-impact phrasing throughout. |
| `changelog-curated-by-impact` | baseline | pass | 0.867 ± 0.002 | All rubric criteria met: version/date header present, entries grouped by category (Added/Deprecated/Fixed), internal refactors and chore omitted, entries correctly categorized, user-impact phrasing throughout. Deprecated entry exemplary: names replacement endpoint and signals migration path clearly. |
| `trunk-based-short-lived-branches` | with_skill | pass | 0.865 ± 0.004 | Opposes long-lived branch with concrete reasons (drift, merge risk, huge diff); recommends 1-3d short-lived branches; proposes feature flags to keep main deployable and reconciles the teammate's concern clearly. |
| `trunk-based-short-lived-branches` | baseline | pass | 0.858 ± 0.009 | Hits all three checkable criteria: opposes long-lived branch with divergence/merge-risk rationale, recommends short-lived daily–few-day merges, and explicitly proposes feature flags. Doesn't explicitly acknowledge the teammate's concern (main seeing half-done work) before reconciling it, so stops sh |
| `semver-hidden-breaking-change` | with_skill | borderline ⚠ | 0.548 ± 0.298 | Correctly identifies breaking change from silent truncation, but proposes 1.9.0 (minor) instead of required 2.0.0 (MAJOR); capped per rubric for proposing minor bump. |
| `semver-hidden-breaking-change` | baseline | borderline ⚠ | 0.567 ± 0.355 | Correctly rejects patch, identifies silent-truncation breaking change, proposes 2.0.0, ties reasoning to observable behavior (not diff size), and suggests migration path. |
| `release-cut-version-tag-changelog` | with_skill | pass | 0.890 ± 0.005 | Version 2.0.0 correct; explicitly attributes MAJOR bump to breaking removal (not feature); annotated tag with push command; changelog properly categorized with migration note in Removed. |
| `release-cut-version-tag-changelog` | baseline | pass | 0.888 ± 0.012 | Meets all checkable criteria; exemplary—clearly attributes major bump to breaking removal (not feature) and provides clear migration note in Removed section. Tag command correct with helpful push included. |
