# R-2 behaviour outcomes (added 27 Oct 2026, before any job-1 result was read)

Maverick approved these on 27 Oct 2026. They are computed after the run from data each receipt already keeps
(final workspace snapshot, reported usage, transcript). The run, the primary score (hidden-test pass rate) and the
Sonnet secondary score are unchanged. Disclosed: before writing this, the controller had seen only draw counts
(every finished task/arm so far stopped at the minimum 3 draws), not scores.

For each model x file, compare with-file against placebo (main) and against no file, per draw, averaged per task first:

1. Code size: non-blank lines in the required solution file in the final snapshot (comment-only lines excluded).
2. Output tokens per generation, as reported by the CLI; also reported cost per generation.
3. Wrote tests: the final snapshot holds a model-created test file (under test/ or named *test*) with at least one assertion. Yes/no per draw.
4. Asked instead of acting: the final reply contains a question to the user and the required solution file is absent. Yes/no per draw.

Differences are reported with 95% intervals (bootstrap over tasks). A file "changed" a behaviour only if the interval excludes zero.
These are secondary outcomes, labelled as such; they never override the primary score.
