# commit-message-conventions — receipt summary

- **model:** `claude-haiku-4-5-20251001` (released 2025-10-01)
- **surface:** claude-cli
- **answered by: model claude-haiku-4-5-20251001 (attested by the surface; the isolated eval-user hop)**
- **run (UTC):** 2026-09-17T03:10:52.633Z
- **runner:** v0.11.0
- **judge:** 5 samples/case, temperature n/a (surface-controlled)
- **registry:** registered   **transcripts:** hashes-only
- **skill content_hash:** `7796e0efea330530…`
- **suite:** 10 cases (agentskills.io/evals)
- **verification:** TESTED
- **receipt_hash:** `fad883d1018d3a4b…`

## Headline

with_skill **0.822 ± 0.108** vs baseline **0.434 ± 0.188**

skill lift **+0.389** (combined uncertainty ± 0.217)

band rule: each arm's band is the sample stddev of its per-case means — per arm: the sample standard deviation (n-1) of the per-case means across the included cases; the comparison band is the quadrature sum of the two arms; null where an arm has fewer than two included cases

## Per-case (mean ± stddev over 5 judge samples)

| case | mode | outcome | mean ± stddev | judge reason |
|---|---|---|---|---|
| `feat-basic` | with_skill | fail | 0.610 ± 0.010 | Violates format requirement by including code fence; Conventional Commits format otherwise correct. |
| `feat-basic` | baseline | fail | 0.212 ± 0.043 | Response includes prose and code fences (violates 'ONLY a commit message'). Commit message lacks type/scope and uses capital 'A' instead of lowercase, violating Conventional Commits format requirements. |
| `fix-with-body` | with_skill | pass | 0.875 ± 0.010 | Perfect structure, type/scope/imperative/length correct, concrete root cause named ('check compared against issuance time instead of current time'). Minor: second sentence leans slightly toward 'how' rather than pure cause-explanation. |
| `fix-with-body` | baseline | fail | 0.535 ± 0.015 | Response violates 'only a commit message' (includes explanatory wrapper); subject lines capitalize 'fix'; conventional commit format not followed; body quality decent. |
| `breaking-change` | with_skill | pass | 0.917 ± 0.022 | Uses both '!' marker and 'BREAKING CHANGE:' footer with clear description. Subject is valid type, imperative, lowercase, no period, under 72 chars. |
| `breaking-change` | baseline | borderline ⚠ | 0.736 ± 0.099 | Commit message uses both '!' marker and 'BREAKING CHANGE:' footer describing Node.js 18 minimum; subject line is flawless (40 chars, valid type, imperative, lowercase, no period). Response violates 'only a commit message' requirement by including explanatory text. |
| `chore-vs-feat` | with_skill | fail | 0.643 ± 0.003 | Type 'build' (cap 0.65) instead of correct 'chore'. Includes ideal scope (deps), tool, version. |
| `chore-vs-feat` | baseline | fail | 0.477 ± 0.221 | Missing required commit type prefix (chore/build); response includes explanation when asked for message only. |
| `perf-not-refactor` | with_skill | pass | 0.929 ± 0.006 | Type 'perf' correct. Exemplary: imperative subject names mechanism (memoize), good scope (render), clear performance intent, under 72 chars. |
| `perf-not-refactor` | baseline | fail | 0.397 ± 0.120 | Violates format requirement by including explanation text beyond commit message; capitalization error: 'Memoize' should be lowercase 'memoize'. |
| `build-type-selection` | with_skill | pass | 0.821 ± 0.020 | Uses correct 'build' type with proper subject format; includes scope (bundler); names bundler and versions (v5→v6) in body. Exemplary. |
| `build-type-selection` | baseline | fail | 0.135 ± 0.108 | Response includes explanatory text and placeholder template, not a standalone commit message; missing required 'build' type prefix; uses [bundler-name] placeholder instead of concrete bundler name. |
| `revert-format` | with_skill | pass | 0.843 ± 0.019 | Correct revert form with proper prefix, named change, and exact 'This reverts commit 9f3c1a2.' line. Flawless but standard. |
| `revert-format` | baseline | fail | 0.261 ± 0.019 | Response provides multiple options instead of single message; subject lines lack required 'revert:' prefix from Conventional Commits format. |
| `footer-issue-ref` | with_skill | pass | 0.863 ± 0.073 | Correct fix-type, scope, imperative, and Fixes footer, but no explanatory body for exemplary rating. |
| `footer-issue-ref` | baseline | fail | 0.529 ± 0.082 | Response provides multiple options with explanatory text, violating 'only a commit message' requirement. Subject starts with capital 'Fix' instead of lowercase 'fix'. Issue footer format is correct. |
| `long-body-wrap-72` | with_skill | pass | 0.849 ± 0.034 | All body lines ≤72 chars, clean subject, exactly 6 sentences covering race/trigger/fix/follow-up as required. |
| `long-body-wrap-72` | baseline | fail | 0.627 ± 0.023 | Subject capitalization error ('Fix' should be 'fix'), response includes explanatory text violating 'only a commit message' requirement, but body excellently meets content and line-length criteria. |
| `split-unrelated` | with_skill | pass | 0.873 ± 0.069 | Advises separate commits, correctly identifies all three change types (fix, refactor, docs), and explicitly acknowledges the unrelated nature of the changes. |
| `split-unrelated` | baseline | fail | 0.428 ± 0.044 | Model provided a well-formed message but failed to advise separation. A skilled response should recognize these are unrelated changes (fix/refactor/docs) requiring separate commits. |
