# commit-message-conventions — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the isolated eval-user hop)**
- **run (UTC):** 2026-09-16T21:10:44.563Z
- **runner:** v0.10.2
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `7796e0efea330530…`
- **suite:** 10 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `3aa8fda29e073f42…`

## Headline

with_skill **0.820 ± 0.093** vs baseline **0.379 ± 0.158**

skill lift **+0.441** (combined uncertainty ± 0.183)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `feat-basic` | with_skill | borderline ⚠ | 0.657 ± 0.095 | Message is perfectly formatted per Conventional Commits, but code fence wrapper violates the 'ONLY commit message' requirement (−0.20). |
| `feat-basic` | baseline | fail | 0.219 ± 0.047 | Response violates core requirements: includes extensive prose/explanation when only a commit message is required; wraps message in code fence; lacks Conventional Commits format (no 'feat(<scope>):' prefix). |
| `fix-with-body` | with_skill | pass | 0.861 ± 0.008 | Correct type/scope/format, body names concrete root cause (comparison vs issue time not current time), no errors. |
| `fix-with-body` | baseline | fail | 0.560 ± 0.050 | Response includes extra explanatory text (violates 'only a commit message' requirement); capitalization error ('Fix:' should be 'fix:' per rubric's lowercase requirement); body is strong but format violations are critical. |
| `breaking-change` | with_skill | pass | 0.894 ± 0.037 | Uses both '!' marker and 'BREAKING CHANGE:' footer describing new minimum. Subject line: valid type, imperative, lowercase, no period, 33/72 chars. Flawless and exemplary. |
| `breaking-change` | baseline | fail | 0.436 ± 0.187 | Response violates 'only a commit message' requirement with explanatory prose; uses 'BREAKING:' prefix instead of required '!' marker or 'BREAKING CHANGE:' footer; invalid type. |
| `chore-vs-feat` | with_skill | fail | 0.646 ± 0.007 | Uses 'build' type (capped 0.65) instead of ideal 'chore'; has scope and tool name, omits old version 8.50. |
| `chore-vs-feat` | baseline | borderline ⚠ | 0.464 ± 0.243 | Response includes prose (should be only commit message); missing type prefix (chore/build); subject capitalization error (Bump should be bump); missing ideal (deps) scope. |
| `perf-not-refactor` | with_skill | pass | 0.895 ± 0.041 | Type 'perf' correct, imperative mood, proper formatting, mechanism named ('memoize'), good scope ('layout calculation'), performance benefit clear, 67/72 chars. |
| `perf-not-refactor` | baseline | fail | 0.283 ± 0.035 | No type prefix shown (must be 'perf:'); caps at 0.4. Also provides two messages when rubric requires one; first subject exceeds 72 chars. |
| `build-type-selection` | with_skill | pass | 0.800 ± 0.018 | Type 'build' with correct subject (imperative, lowercase, no period, <=72 chars) meets baseline. Lacks exemplary scope (deps) and specific bundler name or version range (v5→v6). |
| `build-type-selection` | baseline | fail | 0.079 ± 0.062 | Response is questions and templates, not a commit message. Rubric requires only a commit message with specific type, subject format, and constraints. |
| `revert-format` | with_skill | pass | 0.855 ± 0.022 | Uses correct revert form, proper 'revert:' prefix, names change clearly, includes exact 'This reverts commit 9f3c1a2.' line. Meets all rubric requirements but not exceptional. |
| `revert-format` | baseline | fail | 0.284 ± 0.030 | Fails core requirements: uses 'Revert' (capital) not 'revert:' prefix; response includes multiple options and explanations instead of ONLY the commit message. Hash and body line are correct. |
| `footer-issue-ref` | with_skill | pass | 0.876 ± 0.071 | All requirements met: 'fix' type, imperative mood, lowercase, subject ≤72 chars, explanatory body, scope included, correctly-formatted 'Fixes #482' footer on its own line. Exemplary. |
| `footer-issue-ref` | baseline | fail | 0.505 ± 0.092 | Response provides multiple commit options instead of only one message; both examples capitalize 'Fix' instead of lowercase 'fix'; footer uses 'Resolves' not in rubric's listed examples. |
| `long-body-wrap-72` | with_skill | pass | 0.856 ± 0.026 | Subject valid (type/imperative/lowercase/<=72). Body: 8 sentences covering race/trigger/fix/follow-up. All body lines <=72 chars verified. Thorough explanation with concrete thread scenario. Meets rubric excellence threshold. |
| `long-body-wrap-72` | baseline | fail | 0.551 ± 0.026 | Subject line exceeds 72-character limit (78 chars); body is thorough with all lines ≤72; includes extraneous explanation. |
| `split-unrelated` | with_skill | borderline ⚠ | 0.863 ± 0.164 | Advises separate commits with correct types (fix, refactor, docs) for all three changes; recognizes unrelated nature through separation principle. |
| `split-unrelated` | baseline | fail | 0.407 ± 0.012 | Response provides a well-formed, typed message acknowledging the split changes, but fails the core requirement: it does not advise separate commits and actively argues against separation. |
