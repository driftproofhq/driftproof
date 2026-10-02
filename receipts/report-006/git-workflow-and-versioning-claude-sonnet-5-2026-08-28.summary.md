# git-workflow-and-versioning — receipt summary

- **model:** `claude-sonnet-5` (released 2026-06-30)
- **surface:** claude-cli
- **run (UTC):** 2026-08-28T20:06:24.952Z
- **runner:** v0.5.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `2ed0afa4e21f72ac…`
- **suite:** 7 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `d35e2fd6c01c55a8…`

## Headline

with_skill **0.787 ± 0.221** vs baseline **0.788 ± 0.220**

skill lift **-0.001** (combined uncertainty ± 0.312)

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `commit-message-conventional-type` | with_skill | pass | 0.858 ± 0.016 | Correct `fix:` type, specific subject. Body concisely explains user-facing impact (links expiring 1 hour vs 24 hours) and root cause (wrong unit); exemplary but not exceptional. |
| `commit-message-conventional-type` | baseline | pass | 0.852 ± 0.011 | Correct type prefix, specific subject, body explains consequence and root cause. Meets rubric fully and exemplary for clarity. |
| `semver-clean-bump` | with_skill | pass | 0.862 ± 0.013 | Response meets all baseline criteria (0.80): classifies parameter as MINOR, rules out MAJOR, proposes 2.4.0. Also exemplary (0.81-0.90 tier): correctly maps memory leak fix to PATCH definition, classifying both changes per SemVer. |
| `semver-clean-bump` | baseline | pass | 0.860 ± 0.010 | Exemplary response: correctly maps parameter addition to MINOR, memory leak to PATCH, and proposes 2.4.0; meets all rubric criteria. |
| `split-into-atomic-commits` | with_skill | pass | 0.878 ± 0.013 | All checklist items met: three commits, refactor isolated, formatting separate from behavior, tests with feature, correct conventional types. Exemplary: correctly orders refactor before feature with justification, explicitly cites revertability and git-blame concerns. |
| `split-into-atomic-commits` | baseline | pass | 0.876 ± 0.018 | Produces three separate commits with refactor/feature/formatting isolated; proper conventional types; refactor-before-feature order; explicitly names reviewability/revertability. |
| `changelog-curated-by-impact` | with_skill | pass | 0.882 ± 0.011 | All checkable criteria met: correct header, grouped categories, internal refactors omitted, proper categorization, user-impact phrasing. Exemplary Deprecated entry names replacement and signals removal timeline. |
| `changelog-curated-by-impact` | baseline | pass | 0.872 ± 0.022 | Correct header/format, entries properly categorized (Added/Fixed/Deprecated), internal refactors omitted, CSV import/timezone fix/deprecation with replacement correctly placed and phrased for user impact. |
| `trunk-based-short-lived-branches` | with_skill | pass | 0.872 ± 0.008 | Meets all three core criteria: advises against the three-week branch with concrete merge-risk/integration reasons, recommends short-lived 1-3 day branches, and proposes feature flags to keep main deployable. Additionally exemplary for explicitly reconciling the teammate's concern (half-done work vis |
| `trunk-based-short-lived-branches` | baseline | pass | 0.876 ± 0.005 | Clearly advises against long-lived branch (names divergence/conflict risk), recommends continuous small merges, proposes feature flags, and explicitly reconciles the teammate's valid concern with the solution. |
| `semver-hidden-breaking-change` | with_skill | fail | 0.286 ± 0.022 | Response correctly identifies breaking change and silent-truncation risk (criteria 1, 2, 4), but proposes 1.9.0 (MINOR) instead of required 2.0.0 (MAJOR), triggering hard cap at 0.3. Fatal mismatch on core requirement. |
| `semver-hidden-breaking-change` | baseline | fail | 0.290 ± 0.022 | Proposes 1.9.0 minor bump instead of required 2.0.0 major bump; explicitly rejects major classification despite identifying observable breaking behavior. |
| `release-cut-version-tag-changelog` | with_skill | pass | 0.872 ± 0.015 | Version 2.0.0 correct; annotated tag command proper; changelog categorized correctly with clear migration note; explicitly attributes major bump to breaking removal. |
| `release-cut-version-tag-changelog` | baseline | pass | 0.890 ± 0.017 | All criteria met: correct v2.0.0 version with explicit acknowledgment that breaking removal (not feature) drives MAJOR bump; annotated tag with message; changelog properly grouped with SSO/Added, CSV fix/Fixed, endpoint removal/Removed, plus clear migration note. |
