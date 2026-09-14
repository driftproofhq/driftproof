<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driftproof Report #001 — do skill verdicts hold across a model release?

> **v1.2** (2026-07-30) — supersedes v1.1. An in-text grounding policy was codified and applied across all 10 suites; imported rubric criteria in `git-workflow-and-versioning` and `commit-work` were amended and those two suites re-run. See [Amendments](#amendments).

**Model pair:** `claude-sonnet-5` (released 2026-06-30) vs `claude-sonnet-4-6` (released 2026-02-17)
**Judge:** `claude-haiku-4-5`, 5 samples/case, surface-controlled · **Surface:** claude-cli · **Skills:** 10

## Headline

**9 of 10 skills moved beyond noise** on this model pair (per-case bands do not overlap): 2 regressed, 3 improved, 4 mixed; 1 within noise. Across all cases: 9 regression(s), 8 improvement(s).

A verdict is claimed for a case **only** when BOTH conditions hold: (1) the two `with_skill` confidence bands (mean ± stddev over the judge samples) do not overlap, AND (2) the mean moved by at least the **effect floor of 0.05** (one judge-quantization step). Overlapping bands — or separated bands whose move is below the floor — are reported as *within noise* — never as drift. This is the whole point: the number is allowed to say "nothing moved."

## Per-skill summary

| skill | source | with_skill (old → new) | baseline (old → new) | verdict |
|---|---|---|---|---|
| `code-review-and-quality` | [addyosmani](https://github.com/addyosmani/agent-skills) · MIT | 0.869 ± 0.025 → 0.854 ± 0.031 | 0.824 → 0.836 | WITHIN NOISE ⚠bl |
| `git-workflow-and-versioning` | [addyosmani](https://github.com/addyosmani/agent-skills) · MIT | 0.868 ± 0.025 → 0.834 ± 0.104 | 0.788 → 0.859 | MIXED |
| `documentation-and-adrs` | [addyosmani](https://github.com/addyosmani/agent-skills) · MIT | 0.825 ± 0.100 → 0.706 ± 0.297 | 0.809 → 0.720 | MIXED ⚠bl |
| `commit-work` | [Softaworks](https://github.com/softaworks/agent-toolkit) · MIT | 0.825 ± 0.082 → 0.849 ± 0.028 | 0.818 → 0.766 | IMPROVED (1) ⚠bl |
| `writing-clearly-and-concisely` | [Softaworks](https://github.com/softaworks/agent-toolkit) · MIT | 0.864 ± 0.016 → 0.841 ± 0.064 | 0.839 → 0.813 | REGRESSED (1) ⚠bl |
| `crafting-effective-readmes` | [Softaworks](https://github.com/softaworks/agent-toolkit) · MIT | 0.870 ± 0.015 → 0.804 ± 0.192 | 0.849 → 0.811 | REGRESSED (2) ⚠bl |
| `naming-analyzer` | [Softaworks](https://github.com/softaworks/agent-toolkit) · MIT | 0.817 ± 0.077 → 0.839 ± 0.026 | 0.703 → 0.757 | MIXED ⚠bl |
| `requesting-code-review` | [Jesse Vincent (obra)](https://github.com/obra/superpowers) · MIT | 0.668 ± 0.249 → 0.719 ± 0.226 | 0.540 → 0.617 | IMPROVED (1) ⚠bl |
| `writing-plans` | [Jesse Vincent (obra)](https://github.com/obra/superpowers) · MIT | 0.811 ± 0.089 → 0.785 ± 0.145 | 0.576 → 0.675 | MIXED ⚠bl |
| `skill-creator` | [Anthropic, PBC](https://github.com/anthropics/skills) · Apache-2.0 | 0.842 ± 0.095 → 0.875 ± 0.012 | 0.828 → 0.774 | IMPROVED (1) ⚠bl |

### `code-review-and-quality` — Code Review and Quality

A five-axis code-review framework and severity-labeling discipline for assessing changes before merge.

- **Source:** [https://github.com/addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) @ `7829ffd90d` · **License:** MIT · **Author:** addyosmani
- **Verdict:** WITHIN NOISE
- **Receipts:** [`code-review-and-quality__claude-sonnet-4-6.json`](../receipts/report-001/code-review-and-quality__claude-sonnet-4-6.json) (old) · [`code-review-and-quality__claude-sonnet-5.json`](../receipts/report-001/code-review-and-quality__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/code-review-and-quality__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.869 ± 0.025 | 0.854 ± 0.031 |
| baseline (mean ± sd) | 0.824 ± 0.081 | 0.836 ± 0.051 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `severity-labeled-findings` | 0.908 ± 0.042 | 0.794 ± 0.091 | -0.114 | within noise |
| `security-axis-sql-injection` | 0.882 ± 0.008 | 0.858 ± 0.008 | -0.024 | within noise (below floor) |
| `commit-message-imperative-body` | 0.862 ± 0.013 | 0.856 ± 0.009 | -0.006 | within noise |
| `reject-clean-it-up-later` | 0.866 ± 0.015 | 0.868 ± 0.008 | +0.002 | within noise |
| `oversized-change-split` | 0.856 ± 0.015 | 0.860 ± 0.010 | +0.004 | within noise |
| `propose-structural-remedy` | 0.878 ± 0.019 | 0.896 ± 0.022 | +0.018 | within noise |
| `approve-when-improves-health` | 0.828 ± 0.028 | 0.848 ± 0.026 | +0.020 | within noise |

### `git-workflow-and-versioning` — Git Workflow and Versioning

Trunk-based git discipline, atomic commits, conventional commit types, and semantic-versioning / changelog conventions.

- **Source:** [https://github.com/addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) @ `7829ffd90d` · **License:** MIT · **Author:** addyosmani
- **Verdict:** MIXED
- **Receipts:** [`git-workflow-and-versioning__claude-sonnet-4-6.json`](../receipts/report-001/git-workflow-and-versioning__claude-sonnet-4-6.json) (old) · [`git-workflow-and-versioning__claude-sonnet-5.json`](../receipts/report-001/git-workflow-and-versioning__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/git-workflow-and-versioning__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.868 ± 0.025 | 0.834 ± 0.104 |
| baseline (mean ± sd) | 0.788 ± 0.194 | 0.859 ± 0.024 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `commit-message-conventional-type` | 0.856 ± 0.013 | 0.600 ± 0.000 | -0.256 | 🔻 regressed |
| `release-cut-version-tag-changelog` | 0.910 ± 0.017 | 0.888 ± 0.011 | -0.022 | within noise |
| `changelog-curated-by-impact` | 0.888 ± 0.029 | 0.876 ± 0.011 | -0.012 | within noise |
| `split-into-atomic-commits` | 0.868 ± 0.008 | 0.858 ± 0.011 | -0.010 | within noise |
| `semver-clean-bump` | 0.860 ± 0.012 | 0.856 ± 0.009 | -0.004 | within noise |
| `trunk-based-short-lived-branches` | 0.864 ± 0.023 | 0.868 ± 0.013 | +0.004 | within noise |
| `semver-hidden-breaking-change` | 0.832 ± 0.020 | 0.894 ± 0.022 | +0.062 | 🔼 improved |

### `documentation-and-adrs` — Documentation and ADRs

When and how to write Architecture Decision Records, inline comments, and API docs; document the why.

- **Source:** [https://github.com/addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) @ `7829ffd90d` · **License:** MIT · **Author:** addyosmani
- **Verdict:** MIXED
- **Receipts:** [`documentation-and-adrs__claude-sonnet-4-6.json`](../receipts/report-001/documentation-and-adrs__claude-sonnet-4-6.json) (old) · [`documentation-and-adrs__claude-sonnet-5.json`](../receipts/report-001/documentation-and-adrs__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/documentation-and-adrs__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.825 ± 0.100 | 0.706 ± 0.297 |
| baseline (mean ± sd) | 0.809 ± 0.100 | 0.720 ± 0.293 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `match-existing-adr-convention` | 0.858 ± 0.016 | 0.076 ± 0.043 | -0.782 | 🔻 regressed |
| `surface-conflicting-adr-conventions` | 0.850 ± 0.025 | 0.582 ± 0.149 | -0.268 | 🔻 regressed |
| `supersede-not-delete-old-adr` | 0.886 ± 0.013 | 0.876 ± 0.005 | -0.010 | within noise |
| `comment-intent-not-implementation` | 0.860 ± 0.014 | 0.864 ± 0.017 | +0.004 | within noise |
| `document-why-not-what-rewrite` | 0.860 ± 0.010 | 0.868 ± 0.013 | +0.008 | within noise |
| `adr-for-costly-to-reverse-decision` | 0.864 ± 0.018 | 0.876 ± 0.005 | +0.012 | within noise |
| `document-public-api-function` | 0.600 ± 0.000 | 0.800 ± 0.000 | +0.200 | 🔼 improved |

### `commit-work` — Commit Work

Producing high-quality git commits: staging discipline, logical splitting, Conventional Commits messages.

- **Source:** [https://github.com/softaworks/agent-toolkit](https://github.com/softaworks/agent-toolkit) @ `3027f20f31` · **License:** MIT · **Author:** Softaworks
- **Verdict:** IMPROVED (1)
- **Receipts:** [`commit-work__claude-sonnet-4-6.json`](../receipts/report-001/commit-work__claude-sonnet-4-6.json) (old) · [`commit-work__claude-sonnet-5.json`](../receipts/report-001/commit-work__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/commit-work__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.825 ± 0.082 | 0.849 ± 0.028 |
| baseline (mean ± sd) | 0.818 ± 0.063 | 0.766 ± 0.222 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `full-workflow-multi-concern-diff` | 0.906 ± 0.034 | 0.876 ± 0.011 | -0.030 | within noise |
| `patch-stage-mixed-single-file` | 0.872 ± 0.008 | 0.860 ± 0.010 | -0.012 | within noise |
| `review-cached-catch-secret-and-debug` | 0.852 ± 0.054 | 0.844 ± 0.092 | -0.008 | within noise |
| `split-dependency-bump-vs-behavior` | 0.872 ± 0.004 | 0.866 ± 0.015 | -0.006 | within noise |
| `split-feature-vs-refactor` | 0.852 ± 0.011 | 0.854 ± 0.011 | +0.002 | within noise |
| `conventional-commit-single-change` | 0.738 ± 0.069 | 0.790 ± 0.041 | +0.052 | within noise |
| `two-sentence-describability-test` | 0.682 ± 0.054 | 0.850 ± 0.023 | +0.168 | 🔼 improved |

### `writing-clearly-and-concisely` — Writing Clearly and Concisely

Strunk-style prose rules for docs, commit / error messages, reports, and UI text.

- **Source:** [https://github.com/softaworks/agent-toolkit](https://github.com/softaworks/agent-toolkit) @ `3027f20f31` · **License:** MIT · **Author:** Softaworks
- **Verdict:** REGRESSED (1)
- **Receipts:** [`writing-clearly-and-concisely__claude-sonnet-4-6.json`](../receipts/report-001/writing-clearly-and-concisely__claude-sonnet-4-6.json) (old) · [`writing-clearly-and-concisely__claude-sonnet-5.json`](../receipts/report-001/writing-clearly-and-concisely__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/writing-clearly-and-concisely__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.864 ± 0.016 | 0.841 ± 0.064 |
| baseline (mean ± sd) | 0.839 ± 0.044 | 0.813 ± 0.100 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `concrete-language-incident-summary` | 0.862 ± 0.022 | 0.710 ± 0.073 | -0.152 | 🔻 regressed |
| `emphatic-word-at-end` | 0.848 ± 0.023 | 0.806 ± 0.013 | -0.042 | within noise (below floor) |
| `tighten-puffy-release-note` | 0.874 ± 0.032 | 0.862 ± 0.022 | -0.012 | within noise |
| `positive-form-status-sentences` | 0.886 ± 0.038 | 0.884 ± 0.015 | -0.002 | within noise |
| `active-voice-logging-passage` | 0.852 ± 0.004 | 0.862 ± 0.011 | +0.010 | within noise |
| `omit-needless-words-cache-note` | 0.878 ± 0.033 | 0.894 ± 0.039 | +0.016 | within noise |
| `keep-related-words-together-modifiers` | 0.846 ± 0.011 | 0.872 ± 0.023 | +0.026 | within noise |

### `crafting-effective-readmes` — Crafting Effective READMEs

Audience-first README structure with mandatory sections and project-type templates.

- **Source:** [https://github.com/softaworks/agent-toolkit](https://github.com/softaworks/agent-toolkit) @ `3027f20f31` · **License:** MIT · **Author:** Softaworks
- **Verdict:** REGRESSED (2)
- **Receipts:** [`crafting-effective-readmes__claude-sonnet-4-6.json`](../receipts/report-001/crafting-effective-readmes__claude-sonnet-4-6.json) (old) · [`crafting-effective-readmes__claude-sonnet-5.json`](../receipts/report-001/crafting-effective-readmes__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/crafting-effective-readmes__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.870 ± 0.015 | 0.804 ± 0.192 |
| baseline (mean ± sd) | 0.849 ± 0.067 | 0.811 ± 0.144 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `lead-with-one-sentence-problem` | 0.874 ± 0.005 | 0.374 ± 0.136 | -0.500 | 🔻 regressed |
| `categorize-task-before-writing` | 0.868 ± 0.008 | 0.818 ± 0.034 | -0.050 | 🔻 regressed |
| `audience-config-folder-future-you` | 0.876 ± 0.015 | 0.870 ± 0.012 | -0.006 | within noise |
| `review-validate-against-project-files` | 0.888 ± 0.029 | 0.890 ± 0.024 | +0.002 | within noise |
| `three-mandatory-sections-cli-tool` | 0.872 ± 0.008 | 0.876 ± 0.013 | +0.004 | within noise |
| `audience-internal-service-runbook` | 0.872 ± 0.004 | 0.894 ± 0.028 | +0.022 | within noise |
| `oss-project-type-sections` | 0.840 ± 0.090 | 0.908 ± 0.041 | +0.068 | within noise |

### `naming-analyzer` — Naming Analyzer

Variable / function / class naming conventions and how to suggest clearer names.

- **Source:** [https://github.com/softaworks/agent-toolkit](https://github.com/softaworks/agent-toolkit) @ `3027f20f31` · **License:** MIT · **Author:** Softaworks
- **Verdict:** MIXED
- **Receipts:** [`naming-analyzer__claude-sonnet-4-6.json`](../receipts/report-001/naming-analyzer__claude-sonnet-4-6.json) (old) · [`naming-analyzer__claude-sonnet-5.json`](../receipts/report-001/naming-analyzer__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/naming-analyzer__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.817 ± 0.077 | 0.839 ± 0.026 |
| baseline (mean ± sd) | 0.703 ± 0.214 | 0.757 ± 0.141 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `go-acronym-casing` | 0.868 ± 0.016 | 0.814 ± 0.022 | -0.054 | 🔻 regressed |
| `constants-include-units-js` | 0.866 ± 0.011 | 0.814 ± 0.022 | -0.052 | 🔻 regressed |
| `vague-names-js` | 0.854 ± 0.045 | 0.816 ± 0.042 | -0.038 | within noise |
| `language-casing-python` | 0.886 ± 0.024 | 0.882 ± 0.013 | -0.004 | within noise |
| `misleading-name-mutation-js` | 0.828 ± 0.008 | 0.842 ± 0.004 | +0.014 | within noise (below floor) |
| `boolean-prefixes-js` | 0.720 ± 0.115 | 0.860 ± 0.010 | +0.140 | 🔼 improved |
| `abbreviations-wellknown-js` | 0.696 ± 0.099 | 0.846 ± 0.027 | +0.150 | 🔼 improved |

### `requesting-code-review` — Requesting Code Review

How to prepare and package a change for review: context, base/head SHAs, and severity triage of feedback.

- **Source:** [https://github.com/obra/superpowers](https://github.com/obra/superpowers) @ `3dcbd5c4b4` · **License:** MIT · **Author:** Jesse Vincent (obra)
- **Verdict:** IMPROVED (1)
- **Receipts:** [`requesting-code-review__claude-sonnet-4-6.json`](../receipts/report-001/requesting-code-review__claude-sonnet-4-6.json) (old) · [`requesting-code-review__claude-sonnet-5.json`](../receipts/report-001/requesting-code-review__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/requesting-code-review__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.668 ± 0.249 | 0.719 ± 0.226 |
| baseline (mean ± sd) | 0.540 ± 0.262 | 0.617 ± 0.200 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `request-package-basic` | 0.898 ± 0.030 | 0.866 ± 0.021 | -0.032 | within noise |
| `full-handoff-before-merge` | 0.400 ± 0.000 | 0.396 ± 0.009 | -0.004 | within noise |
| `mandatory-vs-optional-triggers` | 0.862 ± 0.013 | 0.864 ± 0.013 | +0.002 | within noise |
| `resist-simple-self-review` | 0.864 ± 0.009 | 0.882 ± 0.022 | +0.018 | within noise |
| `identify-base-head-shas` | 0.800 ± 0.000 | 0.824 ± 0.018 | +0.024 | within noise (below floor) |
| `crafted-context-not-session-history` | 0.290 ± 0.022 | 0.384 ± 0.188 | +0.094 | within noise |
| `triage-review-findings` | 0.560 ± 0.029 | 0.820 ± 0.109 | +0.260 | 🔼 improved |

### `writing-plans` — Writing Plans

How to author a concrete, self-contained implementation plan before coding.

- **Source:** [https://github.com/obra/superpowers](https://github.com/obra/superpowers) @ `3dcbd5c4b4` · **License:** MIT · **Author:** Jesse Vincent (obra)
- **Verdict:** MIXED
- **Receipts:** [`writing-plans__claude-sonnet-4-6.json`](../receipts/report-001/writing-plans__claude-sonnet-4-6.json) (old) · [`writing-plans__claude-sonnet-5.json`](../receipts/report-001/writing-plans__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/writing-plans__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.811 ± 0.089 | 0.785 ± 0.145 |
| baseline (mean ± sd) | 0.576 ± 0.230 | 0.675 ± 0.199 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `task-right-sizing-testable-deliverable` | 0.816 ± 0.094 | 0.460 ± 0.150 | -0.356 | 🔻 regressed |
| `self-review-spec-coverage` | 0.882 ± 0.011 | 0.844 ± 0.029 | -0.038 | within noise |
| `full-small-plan-header-and-tasks` | 0.882 ± 0.030 | 0.850 ± 0.041 | -0.032 | within noise |
| `bite-sized-tdd-steps` | 0.864 ± 0.013 | 0.876 ± 0.005 | +0.012 | within noise |
| `file-structure-by-responsibility` | 0.802 ± 0.004 | 0.826 ± 0.037 | +0.024 | within noise |
| `repair-placeholder-steps` | 0.802 ± 0.004 | 0.836 ± 0.035 | +0.034 | within noise |
| `interfaces-exact-signatures` | 0.626 ± 0.150 | 0.804 ± 0.009 | +0.178 | 🔼 improved |

### `skill-creator` — Skill Creator

Conventions for authoring a SKILL.md: description-as-trigger, progressive disclosure, instructional tone.

- **Source:** [https://github.com/anthropics/skills](https://github.com/anthropics/skills) @ `b29e7cf65e` · **License:** Apache-2.0 · **Author:** Anthropic, PBC
- **Verdict:** IMPROVED (1)
- **Receipts:** [`skill-creator__claude-sonnet-4-6.json`](../receipts/report-001/skill-creator__claude-sonnet-4-6.json) (old) · [`skill-creator__claude-sonnet-5.json`](../receipts/report-001/skill-creator__claude-sonnet-5.json) (new) · [drift](../receipts/report-001/skill-creator__drift.md)

| | `claude-sonnet-4-6` (old) | `claude-sonnet-5` (new) |
|---|---|---|
| with_skill (mean ± sd) | 0.842 ± 0.095 | 0.875 ± 0.012 |
| baseline (mean ± sd) | 0.828 ± 0.070 | 0.774 ± 0.115 |

| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |
|---|---|---|---|---|
| `restructure-oversized-skill` | 0.882 ± 0.018 | 0.854 ± 0.032 | -0.028 | within noise |
| `reframe-rigid-musts` | 0.876 ± 0.005 | 0.872 ± 0.004 | -0.004 | within noise |
| `domain-variant-organization` | 0.876 ± 0.015 | 0.872 ± 0.008 | -0.004 | within noise |
| `write-triggering-description` | 0.874 ± 0.013 | 0.874 ± 0.011 | +0.000 | within noise |
| `critique-and-fix-skillmd` | 0.890 ± 0.035 | 0.894 ± 0.025 | +0.004 | within noise |
| `output-format-template` | 0.868 ± 0.011 | 0.880 ± 0.012 | +0.012 | within noise |
| `draft-full-skillmd` | 0.628 ± 0.074 | 0.882 ± 0.022 | +0.254 | 🔼 improved |

## Methodology

- **Sampling.** Each (case, mode) generation is judged **5** times; the per-case band is mean ± sample stddev over those 5 judge scores. A regression/improvement is claimed only when two `with_skill` bands are fully separated (`mean_new + sd_new < mean_old − sd_old`, or symmetric).
- **Judge.** `claude-haiku-4-5`. Sampling mode: `surface-controlled`. On the `api` surface the judge is pinned to temperature 0; **this report ran on the `claude-cli` surface**, where sampling parameters are surface-controlled and cannot be pinned — the receipts record this honestly in `run.judge`. Judge variance is therefore real, which is exactly why verdicts require band separation rather than a raw score delta.
- **Text-only scoping.** Report #001 tests skills whose value shows up in **text** (review, commit, documentation, prose, naming, planning conventions). Skills that need code/binary execution (docx/pptx/pdf renderers, diagram/asset generators, browser/CLI tools) are out of scope — they need a sandboxed-execution harness, noted as future work. Each skill is supplied as its single `SKILL.md`; bundled reference files loaded on demand are out of scope, and skills whose value lives entirely in bundled files were excluded.
- **Suite authorship (disclosure).** *We wrote the eval suites*, one per skill, each case grounded in a claim documented in that skill's own `SKILL.md`. Suites are versioned in [`suites/`](../suites/). Rubrics anchor a fully-correct answer at 0.80 (higher only for exemplary work) so a competent `with_skill` run is not saturated and a regression can show. We do not commit third-party skill content: each `SKILL.md` is fetched at run time from its pinned commit and verified by sha256 (see [`suites/manifest.json`](../suites/manifest.json)).
- **Grounding policy (codified).** *Every gradable rubric criterion must trace to text present in the skill's `SKILL.md` at the pinned SHA. Criteria that import domain knowledge the skill does not state are not gradable, regardless of how standard that knowledge is. Claims may summarize; rubrics may not extrapolate.* Each case records a `grounding` reference to the `SKILL.md` text it tests; the gate requires it. v1.2 applied this policy across all 10 suites (sweep: [`reports/rubric-sweep.md`](../reports/rubric-sweep.md)) — see [Amendments](#amendments).
- **Baseline.** Same prompt, no `SKILL.md`. The lift (with_skill − baseline) is reported but the drift verdict is about the `with_skill` side across models, not the lift.

## Reproduce (three commands)

```bash
node scripts/fetch-skills.js                        # fetch pinned SKILL.md files (sha256-verified) into an untracked workdir
node scripts/run-report-001.js --concurrency 5     # run both models × with/baseline, emit receipts
node scripts/build-report-001.js                   # re-derive this report from the receipts
```

_Provider: `CLAUDE_PROVIDER=cli` (subscription) or `=api` (metered; needs `ANTHROPIC_API_KEY`). Receipts validate against the Driftproof receipt spec (v0.2; the two suites re-run in v1.2 are v0.3, a superset the loader also accepts); every verdict above is a function of the two `with_skill` bands in the receipts._

## Amendments

**v1.2** · 2026-07-30 — In-text grounding policy adopted and applied across all 10 suites. Headline: v1.1 read 3 regressed / 3 improved / 3 mixed / 1 within noise; v1.2 reads 2 regressed / 3 improved / 4 mixed / 1 within noise. This supersedes v1.1.

- `Policy adopted (codified, applied unilaterally).` `Every gradable rubric criterion must trace to text present in the skill's SKILL.md at the pinned SHA. Criteria that import domain knowledge the skill does not state are not gradable, regardless of how standard that knowledge is. Claims may summarize; rubrics may not extrapolate.` The grading standard does not depend on the audited party's tolerance. Full sweep of all 10 suites (70 cases): `reports/rubric-sweep.md`.
- `Criteria amended (2 of 10 suites; the other 8 were grounded and unchanged).` `git-workflow-and-versioning/semver-clean-bump` required "the highest-precedence bump governs when changes are combined / reset PATCH to 0" — a rule the SKILL.md never states (it defines only MAJOR/MINOR/PATCH). That criterion was removed; the case now grades only the stated MAJOR/MINOR/PATCH definitions. `commit-work` (all 7 cases) required a `specific` Conventional Commits type token (e.g. `chore(deps)` vs `feat`) and, in one case, a subject &lt;=72-chars / no-trailing-period / imperative-mood rule — none of which its SKILL.md states (it names Conventional Commits and shows the `type(scope): summary` shape but does not enumerate the type vocabulary). Type grading is now shape-only; the length/period/mood rule was removed. The logical-split, patch-staging, and secret/debug checks the SKILL.md `does` state remain fully graded.
- `Re-run.` Only the two amended suites were re-run (both models, n=5, claude-cli, transcripts retained); the amendment changes only those two `suite_hash`es. The `grounding` reference now recorded on every case is excluded from `suite_hash`, so annotating the other eight suites did not disturb their receipts.
- `Verdict changes (stated plainly, not softened).` The amended case `git-workflow-and-versioning/semver-clean-bump` flips `regression → within noise` (v1.1 Δ−0.054 on separated bands; v1.2 Δ−0.004). The v1.1 "regression" was driven by the imported precedence/reset criterion; grading only the MAJOR/MINOR/PATCH definitions the SKILL.md actually states, the new model shows no drift on this case. But re-running a suite re-rolls all seven of its cases (one receipt covers the whole suite), and the fresh n=5 measurement surfaced, on two `unamended`, well-grounded cases, a real regression and a real improvement: `commit-message-conventional-type` now regresses (Δ−0.256 — the new model wrote `feat:` instead of `fix:` for a bug fix; all five judge samples scored 0.60 with that same reason, transcript-verified) and `semver-hidden-breaking-change` now improves (Δ+0.062). Net, the skill moves `REGRESSED(1) → MIXED`. `commit-work` is unchanged at `IMPROVED(1)`: its driver (`two-sentence-describability-test`, Δ+0.168) held, and its amended cases (specific type token → shape, and the removed ≤72-char/no-period/imperative-mood rule) remain within noise. The other eight skills were not re-run and keep their v1.1 labels.

**v1.1** · 2026-07-28 — Pre-launch QA corrections. Net headline change: v1.0 read 4 regressed / 3 improved / 3 mixed / 0 within noise; v1.1 reads 3 regressed / 3 improved / 3 mixed / 1 within noise. Two causes, below.

- `(1) Minimum-effect floor of 0.05.` A case is now called regressed/improved only when its two with_skill bands do not overlap AND the mean moved ≥ 0.05 (one judge-quantization step) — band separation alone is no longer sufficient, because the judge quantizes to a coarse grid and a confident grade often collapses to a zero-width point band. This reclassified 3 hair-trigger cases (|Δ| 0.014–0.024) to “within noise (below effect floor)”: `code-review-and-quality/security-axis-sql-injection` (which flips that whole skill REGRESSED → WITHIN NOISE), `naming-analyzer/misleading-name-mutation-js` (MIXED 2r/3i → 2r/2i), and `requesting-code-review/identify-base-head-shas` (IMPROVED 2 → 1).
- `(2) Two artifact-contaminated receipts re-run.` A transcript audit found new-model bands containing a judge parse-fallback score of exactly 0.0 (an unparseable judge reply defaults to 0, per lib/judge.js). Both `__claude-sonnet-5` receipts were re-run on the same claude-cli surface, n=5 (old-model receipts, which were clean, were kept as-is): `writing-clearly-and-concisely` and `documentation-and-adrs`.
- `What the re-run showed.` `active-voice-logging-passage`’s v1.0 “regression” was `entirely` the artifact — the clean re-run scores 0.862 (vs old 0.852), i.e. within noise. `match-existing-adr-convention` reconfirmed as a genuine new-model failure (~0.08 again on an independent run). Because a receipt covers all 7 of a skill’s cases, re-running also refreshed the other cases honestly: `comment-intent-not-implementation`’s v1.0 regression did not reproduce (now within noise), while two `different`, real regressions surfaced — `documentation-and-adrs/surface-conflicting-adr-conventions` (Δ−0.268) and `writing-clearly-and-concisely/concrete-language-incident-summary` (Δ−0.152). Both skills keep their v1.0 labels (MIXED and REGRESSED-1 respectively); only the driving cases changed.
- Full per-case transcript evidence and REAL-vs-artifact classifications are in `reports/report-001-audit.md`.

