# commit-message-conventions — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the isolated eval-user hop)**
- **answer capture: text (Claude Code tools: Read, WebFetch and WebSearch only; the reply is the answer)**
- **run (UTC):** 2026-11-08T10:24:42.377Z
- **runner:** v0.27.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `7796e0efea330530…`
- **suite:** 10 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `cb3b424d6f7b12d4…`

## Headline

Fake tool calls: with the subject 0/30; without the subject 0/49.
with_skill **0.831 ± 0.080** vs baseline **0.482 ± 0.243**

skill lift **+0.349** (combined uncertainty ± 0.256)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `feat-basic` | with_skill | pass | 0.855 ± 0.001 | All requirements met: correct format, imperative mood, well-chosen scope, specific information-dense subject—exemplary. |
| `feat-basic` | baseline | fail | 0.213 ± 0.038 | Response violates core requirement: includes code fences, prose explanation, and multiple messages instead of ONLY a commit message. Subject also uses uppercase 'A' not lowercase. |
| `fix-with-body` | with_skill | pass | 0.871 ± 0.006 | Fully correct format with type 'fix', scope 'auth', imperative mood, proper blank line separator, and body naming concrete root cause. Exemplary. |
| `fix-with-body` | baseline | fail | 0.535 ± 0.042 | Response includes explanatory text beyond the commit message itself, violating the 'only a commit message' requirement; subject line incorrectly capitalized ('Fix' not 'fix'); body explains implementation details when should focus on root cause. |
| `breaking-change` | with_skill | pass | 0.884 ± 0.009 | Uses both '!' and 'BREAKING CHANGE:' footer describing the new minimum; subject is valid type, imperative, lowercase, under 72 chars, no period. Flawless but not exceptional. |
| `breaking-change` | baseline | pass | 0.787 ± 0.055 | Provided two messages and explanations instead of single message only. Content excellent (both breaking-change signals, new minimum specified), but violates format requirement. |
| `chore-vs-feat` | with_skill | fail | 0.643 ± 0.007 | Uses 'build' (partial-credit alternative) instead of ideal 'chore' type; otherwise well-formed with scope (deps), tool name, and version. |
| `chore-vs-feat` | baseline | borderline ⚠ | 0.760 ± 0.073 | Exemplary chore commit message with deps scope and version names, but violates 'only a commit message' by including alternatives and explanation text. |
| `perf-not-refactor` | with_skill | pass | 0.933 ± 0.006 | Correct type 'perf', imperative subject, good scope (layout), mechanism named (memoize), all formatting requirements met, exemplary. |
| `perf-not-refactor` | baseline | fail | 0.319 ± 0.136 | Missing required 'perf:' type prefix; response includes explanatory prose and provides multiple messages instead of one. |
| `build-type-selection` | with_skill | pass | 0.800 ± 0.000 | Correct type (build) and subject format, includes scope (deps), but generic 'bundler' name and missing version range context (v5→v6). |
| `build-type-selection` | baseline | fail | 0.161 ± 0.192 | Not a commit message; asks clarifying questions instead. Violates rubric's core requirement of providing a commit message. |
| `revert-format` | with_skill | pass | 0.808 ± 0.007 | Correct revert form with 'revert:' prefix, names the change, and includes exact 'This reverts commit 9f3c1a2.' line as required. |
| `revert-format` | baseline | fail | 0.251 ± 0.019 | Response violates 'ONLY commit message' requirement with extra explanatory text; commit format uses 'Revert' not 'revert:' (incorrect Conventional Commits form). |
| `footer-issue-ref` | with_skill | pass | 0.800 ± 0.000 | Meets baseline requirements: 'fix' type, correct 'Fixes #482' footer, scope present; lacks separate body paragraph for exemplary score. |
| `footer-issue-ref` | baseline | fail | 0.503 ± 0.142 | Extra explanation violates commit-only rule; 'Fix' should be lowercase 'fix'; 'Resolves' not in acceptable footer keywords (Closes/Fixes/Refs). |
| `long-body-wrap-72` | with_skill | pass | 0.812 ± 0.016 | Subject clean (fix, imperative, 65 chars). Body: 6 sentences covering race/trigger/fix/follow-up, all 15 lines ≤72 chars. Meets rubric fully. |
| `long-body-wrap-72` | baseline | pass | 0.801 ± 0.014 | Subject capitalization violates lowercase requirement; body excellent with 7 sentences and all ≤72 char lines. |
| `split-unrelated` | with_skill | pass | 0.899 ± 0.005 | Recognizes unrelated changes, advises separation with correct types (fix, refactor, docs), explicitly acknowledges split, provides requested single message. |
| `split-unrelated` | baseline | fail | 0.489 ± 0.186 | Provides well-formed messages but completely ignores the rubric's core insight: these are unrelated changes requiring separate commits with correct types (refactor, fix, docs). |
