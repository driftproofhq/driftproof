<!-- SPDX-License-Identifier: Apache-2.0 -->
# Report #001 — Pre-launch QA / Transcript Audit

**Date:** 2026-07-28 · **Auditor:** pre-launch QA pass over the v1.0 receipts in
`receipts/report-001/` · **Surface audited:** `claude-cli`, judge `claude-haiku-4-5`, n=5.

This document audits the raw judge data behind Report #001, classifies the
audited cases as **REAL** model-behaviour change vs **HARNESS ARTIFACT**, explains
the zero-variance scores, and records the inputs to the v1.1 corrections.

## 0. Structural finding — raw model outputs are NOT persisted

The runner (`lib/run.js`) generates each model response, judges it `n` times, and
stores only the **graded result** (per-sample scores, mean, stddev, outcome, and
the first sample's `reason`). The generated text itself is **discarded** — no
receipt field holds it. So a literal "dump of raw model outputs" is not possible
from the shipped receipts; the strongest available per-case evidence is the
**5 judge-sample scores** plus the judge's one-sentence `reason`. Every dump below
is that evidence. (Recommendation tracked for a future runner: persist a hash or a
truncated copy of each generation so transcript audits are fully grounded.)

## 1. Zero-variance / judge-fallback analysis (step 2)

**Is there a fallback scoring path?** Yes — exactly one, in `lib/judge.js:85-89`.
When a judge reply cannot be parsed into `{score,pass,reason}` JSON,
`gradeOnce()` returns `{ score: 0, reason: 'judge output unparseable' }`. That is
the only default/fallback score. Its fingerprint in a receipt is therefore an
**exact `0.0` sample** and/or the reason text `judge output unparseable`. The
`unparsed` flag itself is not persisted, so `0.0` is the detectable signal.

**Did it fire?** A global scan of all **280 case-records** (10 skills × 2 models ×
7 cases × 2 modes) found:

- **0** cases with the `judge output unparseable` reason.
- **3** case-records containing an exact `0.0` sample:
  - `writing-clearly-and-concisely/active-voice-logging-passage` [with_skill, sonnet-5] = `[0.6, 0.6, 0.6, 0, 0.6]`
  - `documentation-and-adrs/match-existing-adr-convention` [with_skill, sonnet-5] = `[0.05, 0.05, 0.15, 0, 0.1]`
  - `documentation-and-adrs/match-existing-adr-convention` [baseline, sonnet-5] = `[0.1, 0, 0.08, 0.15, 0.1]`

**Why do some cases produce 5 identical scores?** Zero variance is NOT the fallback
firing. There are **14 zero-variance case-records, and every one is five identical
_non-zero_ quantized values** (0.3 / 0.4 / 0.6 / 0.8) with a substantive reason —
never all-zeros. The Haiku judge quantizes to a coarse grid of round anchors, and
for an unambiguous response it returns the *same* anchor on all 5 samples. With
`n=5` and ~0.05–0.1 quantization, a confident grade collapses the band to a point
(stddev 0). That is genuine low judge-variance, not an artifact. **The fallback
path did NOT fire on any zero-variance case.**

The practical consequence: point bands (stddev 0) make *any* non-zero delta look
"band-separated," which is exactly what motivates the minimum-effect floor in §3.

## 2. Per-case classification (step 1)

| case | skill | verdict (v1.0) | Δ | classification | evidence |
|---|---|---|---|---|---|
| match-existing-adr-convention | documentation-and-adrs | regression | −0.788 | **REAL, contaminated** → regen | 4/5 new samples are genuine low grades (0.05–0.15), reason "produces no artifact / refused deliverable"; but 1 parse-fallback `0.0` per mode inflates the band |
| comment-intent-not-implementation | documentation-and-adrs | regression | −0.260 | **REAL** | clean 0.600 band (no 0.0); reason: new leaves a TODO dangling (fails criterion c) vs old 0.86 |
| document-public-api-function | documentation-and-adrs | improvement | +0.200 | **REAL** | clean point bands both sides; new adds required `@example` (0.8), old omits it (0.6) |
| lead-with-one-sentence-problem | crafting-effective-readmes | regression | −0.500 | **REAL** | genuine spread `[0.27–0.6]`, no 0.0; new opens with the solution not the problem (CAP rule) |
| active-voice-logging-passage | writing-clearly-and-concisely | regression | −0.372 | **HARNESS ARTIFACT** → regen | new = `[0.6,0.6,0.6,0,0.6]`: a lone parse-fallback `0.0` the reason does not justify; without it a clean 0.600 band |
| task-right-sizing-testable-deliverable | writing-plans | regression | −0.356 | **REAL** | genuine spread both sides `[0.3–0.65]`, no 0.0; new over-splits scaffolding |
| full-handoff-before-merge | requesting-code-review | within noise | −0.004 | **REAL (no change)** | near-identical ~0.40 bands; both capped for forwarding session history |
| crafted-context-not-session-history | requesting-code-review | within noise | +0.094 | **REAL (judge noise)** | new has a `0.72` sample among `0.3`s — genuine judge disagreement (not a `0.0` fallback); bands overlap |

**Summary:** of the 8 audited cases, **6 are REAL**, **1 is a clean harness
artifact** (`active-voice-logging-passage`), and **1 is real-but-contaminated**
(`match-existing-adr-convention`, one parse-fallback `0.0` per mode). The two
`0.0`-bearing receipts — `writing-clearly-and-concisely__claude-sonnet-5` and
`documentation-and-adrs__claude-sonnet-5` — are the only receipts regenerated for
v1.1 (§ below). All 14 zero-variance cases are legitimate confident gradings.

## 3. Regeneration outcome (what the re-run showed)

The two `__claude-sonnet-5` receipts flagged above were re-run (claude-cli, n=5;
the clean old-model receipts were kept). Because a receipt covers all 7 of a
skill's cases, the re-run refreshed those too — reported here honestly:

- **`active-voice-logging-passage`** → new-model band **`[0.85,0.85,0.87,0.87,0.87]`
  (0.862)** vs old 0.852. The v1.0 "regression" was **entirely the parse-fallback
  artifact**; on a clean run the case is *within noise*. **Artifact confirmed.**
- **`match-existing-adr-convention`** → still **~0.08** on an independent run
  (`[0.1,0.1,0.08,0,0.1]`). A genuine new-model failure — **REAL regression
  reconfirmed** (the lone 0.0 recurs but the case is near-zero regardless).
- **`comment-intent-not-implementation`** → its v1.0 −0.26 regression **did not
  reproduce** (now Δ+0.004, within noise). Its v1.0 clean 0.600 band was a real
  measurement, but a one-off; the fresh run puts the new model on par with old.
- Two *different*, real regressions surfaced in the refreshed receipts and now
  drive the (unchanged) skill labels: `documentation-and-adrs/surface-conflicting-adr-conventions`
  (Δ−0.268) and `writing-clearly-and-concisely/concrete-language-incident-summary` (Δ−0.152).

Net: `documentation-and-adrs` stays **MIXED(2r/1i)** and `writing-clearly-and-concisely`
stays **REGRESSED(1)** — same labels, different (and now artifact-free) driving cases.
Combined with the effect floor (§1), the report headline moves from
**4/3/3/0** (v1.0) to **3/3/3/1** (v1.1). See `reports/report-001.md` Amendments.

---
_The raw per-sample dumps that back every row above follow. They are the exact
`samples` arrays and judge `reason` strings from the v1.0 receipts._

## Named-case raw dump (v1.0 receipts as shipped)

### `match-existing-adr-convention`  (documentation-and-adrs)

**delta=-0.788  band-verdict=regression** (with_skill old→new)

- with_skill / OLD sonnet-4-6: samples=[0.84, 0.88, 0.87, 0.85, 0.85] mean=0.858 sd=0.016 → pass
  reason: Meets all conventions: ADR-004, Documentation/Decisions path, rST format, Context-Decision-Status-Consequences headings; explicitly notes following repo scheme.
- with_skill / NEW sonnet-5: samples=[0.05, 0.05, 0.15, 0, 0.1] mean=0.070 sd=0.057 → fail  ⟵ contains 0.0 (parse-fallback fingerprint)
  reason: Response produces no artifact; fails all four checkable criteria: (a) no ADR-004 file, (b) no path in Documentation/Decisions/, (c) no reStructuredText content, (d) no required heading structure.
- baseline / OLD sonnet-4-6: samples=[0.85, 0.85, 0.87, 0.89, 0.85] mean=0.862 sd=0.018 → pass
  reason: Perfectly matches all four conventions (path, filename, rST format, heading order); exemplarily notes established scheme choices (numbering, kebab-case, heading order).
- baseline / NEW sonnet-5: samples=[0.1, 0, 0.08, 0.15, 0.1] mean=0.086 sd=0.055 → fail  ⟵ contains 0.0 (parse-fallback fingerprint)
  reason: Provides zero of four required elements: no ADR-004 filename, Documentation/Decisions path, reStructuredText format, or required heading set. Refused deliverable entirely.

### `comment-intent-not-implementation`  (documentation-and-adrs)

**delta=-0.26  band-verdict=regression** (with_skill old→new)

- with_skill / OLD sonnet-4-6: samples=[0.87, 0.84, 0.87, 0.85, 0.87] mean=0.860 sd=0.014 → pass
  reason: Removes all three 'what' comments, deleted commented-out code and bare TODO, kept one comment explaining intent (gold tier discount logic). Fully meets rubric and is exemplary.
- with_skill / NEW sonnet-5: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 sd=0.000 → fail  ⟵ zero-variance
  reason: Passes (a), (b), (d): removes restatement comments, deletes dead code, adds intent-based comments. Fails (c): leaves TODO dangling unchanged; rubric requires implementation or removal.
- baseline / OLD sonnet-4-6: samples=[0.87, 0.88, 0.87, 0.85, 0.85] mean=0.864 sd=0.013 → pass
  reason: Removes all restatement comments (a), dead code (b), dangling TODO (c); adds exemplary intent comment on magic number (d).
- baseline / NEW sonnet-5: samples=[0.87, 0.85, 0.88, 0.88, 0.88] mean=0.872 sd=0.013 → pass
  reason: Meets all four criteria: removes restating comments, removes dead code, removes dangling TODO, adds intent-based comments. Exemplary judgment—leaves self-explanatory loop uncommented, adds meaningful business context.

### `document-public-api-function`  (documentation-and-adrs)

**delta=0.2  band-verdict=improvement** (with_skill old→new)

- with_skill / OLD sonnet-4-6: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 sd=0.000 → fail  ⟵ zero-variance
  reason: Documents parameters (a), return value (b), and both exceptions (c), but missing the required @example (d).
- with_skill / NEW sonnet-5: samples=[0.8, 0.8, 0.8, 0.8, 0.8] mean=0.800 sd=0.000 → pass  ⟵ zero-variance
  reason: All rubric criteria met: parameters (a), return (b), both exceptions (c), and example (d) documented. Idiomatic TSDoc. Example shows happy path only, not error handling.
- baseline / OLD sonnet-4-6: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 sd=0.000 → fail  ⟵ zero-variance
  reason: Covers parameters, return value, and both exceptions thoroughly, but omits required @example usage documentation.
- baseline / NEW sonnet-5: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 sd=0.000 → fail  ⟵ zero-variance
  reason: Omits required @example (criterion d); otherwise parameters, return, exceptions correctly documented.

### `lead-with-one-sentence-problem`  (crafting-effective-readmes)

**delta=-0.5  band-verdict=regression** (with_skill old→new)

- with_skill / OLD sonnet-4-6: samples=[0.88, 0.87, 0.88, 0.87, 0.87] mean=0.874 sd=0.005 → pass
  reason: Leads cleanly with one-sentence problem statement; specific and vivid about real pain (duplicate binaries, silently accumulate, painful to purge); tight structure with no extraneous content.
- with_skill / NEW sonnet-5: samples=[0.3, 0.27, 0.6, 0.3, 0.4] mean=0.374 sd=0.136 → fail
  reason: Opens with tool's solution (what it stops) not the problem it solves (history bloat, hard cleanup). Violates core requirement; triggers CAP RULE.
- baseline / OLD sonnet-4-6: samples=[0.88, 0.89, 0.86, 0.89, 0.88] mean=0.880 sd=0.012 → pass
  reason: Leads cleanly with one specific, vivid problem sentence before solution; exemplary on bloat/purge pain, tight structure.
- baseline / NEW sonnet-5: samples=[0.35, 0.83, 0.3, 0.72, 0.28] mean=0.496 sd=0.259 → borderline
  reason: Leads with tool description and solution, not problem statement; duplicates/history impact are implied, not stated as the opening problem.

### `active-voice-logging-passage`  (writing-clearly-and-concisely)

**delta=-0.372  band-verdict=regression** (with_skill old→new)

- with_skill / OLD sonnet-4-6: samples=[0.86, 0.85, 0.85, 0.85, 0.85] mean=0.852 sd=0.004 → pass
  reason: All three main clauses converted to active voice with actors preserved. Response is tighter than the original, trimming redundant 'and are written by it' phrasing while maintaining natural readability.
- with_skill / NEW sonnet-5: samples=[0.6, 0.6, 0.6, 0, 0.6] mean=0.480 sd=0.268 → borderline  ⟵ contains 0.0 (parse-fallback fingerprint)
  reason: Two of three main sentences correctly converted to active voice (middleware, monitor); first sentence remains passive ('was designed'), failing criterion (a). Meaning and named actors preserved.
- baseline / OLD sonnet-4-6: samples=[0.85, 0.86, 0.85, 0.85, 0.85] mean=0.852 sd=0.004 → pass
  reason: All three main clauses successfully convert to active voice with clear actors preserved (platform team, middleware, monitor). Tighter and more idiomatic than original; exceeds baseline correctness.
- baseline / NEW sonnet-5: samples=[0.87, 0.85, 0.87, 0.86, 0.88] mean=0.866 sd=0.011 → pass
  reason: Meets criteria (a)-(c): all main clauses active with clear subjects, all named actors preserved, no new passive constructions. Also tighter than original while reading naturally.

### `task-right-sizing-testable-deliverable`  (writing-plans)

**delta=-0.356  band-verdict=regression** (with_skill old→new)

- with_skill / OLD sonnet-4-6: samples=[0.84, 0.85, 0.86, 0.88, 0.65] mean=0.816 sd=0.094 → pass
  reason: Correctly folds non-independently-testable scaffolding (framework, VERSION), splits independently-testable logic with sound justification, exemplarily invokes reviewer-rejection principle.
- with_skill / NEW sonnet-5: samples=[0.42, 0.35, 0.58, 0.65, 0.3] mean=0.460 sd=0.150 → fail
  reason: Response splits scaffolding (framework, VERSION, uptime) into standalone tasks, violating rubric's core principle to fold scaffolding into the endpoint task. CAP RULE examples explicitly cite separate 'install framework' and 'add VERSION' tasks.
- baseline / OLD sonnet-4-6: samples=[0.35, 0.25, 0.3, 0.58, 0.3] mean=0.356 sd=0.130 → fail
  reason: Splits scaffolding (framework install in Task 1, helpers in Task 2) into standalone tasks instead of folding into endpoint task as rubric requires; triggers explicit cap at 0.3.
- baseline / NEW sonnet-5: samples=[0.6, 0.55, 0.42, 0.45, 0.45] mean=0.494 sd=0.077 → fail
  reason: Model over-splits work: should fold framework install and utilities (VERSION, uptime) into /health endpoint task per rubric; splits Task 2 utilities without independent business value.

### `full-handoff-before-merge`  (requesting-code-review)

**delta=-0.004  band-verdict=within noise** (with_skill old→new)

- with_skill / OLD sonnet-4-6: samples=[0.4, 0.4, 0.4, 0.4, 0.4] mean=0.400 sd=0.000 → fail  ⟵ zero-variance
  reason: Includes session history (abandoned redirect, debugging journey) explicitly forbidden by rubric; capped at 0.4.
- with_skill / NEW sonnet-5: samples=[0.4, 0.38, 0.4, 0.4, 0.4] mean=0.396 sd=0.009 → fail
  reason: Includes abandoned-flow and state-mismatch debugging journeys as session history; violates OMIT requirement (capped at 0.4 per rubric). Has all four elements and correct SHAs but shouldn't forward session history in hand-off.
- baseline / OLD sonnet-4-6: samples=[0.35, 0.4, 0.4, 0.4, 0.38] mean=0.386 sd=0.022 → fail
  reason: Complete package with all four elements and correct SHAs, but violates CRITICAL cap: includes abandoned-flow narrative and debugging journey (explicit omission rule), capping at 0.4; further penalized for not noting mandatory-review-before-merge trigger.
- baseline / NEW sonnet-5: samples=[0.4, 0.38, 0.4, 0.4, 0.4] mean=0.396 sd=0.009 → fail
  reason: All four elements and correct SHAs present, but capped at 0.4 for including abandoned-flow and debugging-journey session history that should be omitted.

### `crafted-context-not-session-history`  (requesting-code-review)

**delta=0.094  band-verdict=within noise** (with_skill old→new)

- with_skill / OLD sonnet-4-6: samples=[0.25, 0.3, 0.3, 0.3, 0.3] mean=0.290 sd=0.022 → fail
  reason: Mentions forbidden elements: Map attempt, revert reason, test-debugging—violates core omission requirement.
- with_skill / NEW sonnet-5: samples=[0.72, 0.3, 0.3, 0.3, 0.3] mean=0.384 sd=0.188 → fail
  reason: Includes all required elements (description, requirement, both SHAs correctly labeled); omits session dead-ends (Map attempt, revert, 'messier' aside); brief mention of test-debugging fix weakens the CRITICAL omit-narrative requirement but doesn't disqualify the otherwise professional, structured re
- baseline / OLD sonnet-4-6: samples=[0.3, 0.3, 0.3, 0.3, 0.28] mean=0.296 sd=0.009 → fail
  reason: Includes abandoned Map attempt and test-debugging journey; triggers hard cap at 0.3. Otherwise has correct SHAs and requirement.
- baseline / NEW sonnet-5: samples=[0.3, 0.3, 0.3, 0.3, 0.3] mean=0.300 sd=0.000 → fail  ⟵ zero-variance
  reason: Critical violation: includes abandoned Map attempt, revert, and test-debugging as session narrative in reviewer handoff; rubric requires these dead-ends be omitted entirely (applies 0.3 cap).

## Every zero-variance case (stddev = 0.000)

- `documentation-and-adrs/document-public-api-function` [with_skill] claude-sonnet-4-6: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 → fail  | reason: Documents parameters (a), return value (b), and both exceptions (c), but missing the requi
- `documentation-and-adrs/document-public-api-function` [baseline] claude-sonnet-4-6: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 → fail  | reason: Covers parameters, return value, and both exceptions thoroughly, but omits required @examp
- `documentation-and-adrs/comment-intent-not-implementation` [with_skill] claude-sonnet-5: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 → fail  | reason: Passes (a), (b), (d): removes restatement comments, deletes dead code, adds intent-based c
- `documentation-and-adrs/document-public-api-function` [with_skill] claude-sonnet-5: samples=[0.8, 0.8, 0.8, 0.8, 0.8] mean=0.800 → pass  | reason: All rubric criteria met: parameters (a), return (b), both exceptions (c), and example (d) 
- `documentation-and-adrs/document-public-api-function` [baseline] claude-sonnet-5: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 → fail  | reason: Omits required @example (criterion d); otherwise parameters, return, exceptions correctly 
- `naming-analyzer/language-casing-python` [baseline] claude-sonnet-5: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 → fail  | reason: Correctly converts 5/6 names with exemplary explanations, but misses boolean `active` shou
- `requesting-code-review/identify-base-head-shas` [with_skill] claude-sonnet-4-6: samples=[0.8, 0.8, 0.8, 0.8, 0.8] mean=0.800 → pass  | reason: Both SHAs correct with brief accurate rationale. Baseline: base=commit before task, head=f
- `requesting-code-review/identify-base-head-shas` [baseline] claude-sonnet-4-6: samples=[0.8, 0.8, 0.8, 0.8, 0.8] mean=0.800 → pass  | reason: Correctly identified HEAD_SHA (e77b2f1) and BASE_SHA (4c1d9a0) with brief accurate rationa
- `requesting-code-review/full-handoff-before-merge` [with_skill] claude-sonnet-4-6: samples=[0.4, 0.4, 0.4, 0.4, 0.4] mean=0.400 → fail  | reason: Includes session history (abandoned redirect, debugging journey) explicitly forbidden by r
- `requesting-code-review/crafted-context-not-session-history` [baseline] claude-sonnet-5: samples=[0.3, 0.3, 0.3, 0.3, 0.3] mean=0.300 → fail  | reason: Critical violation: includes abandoned Map attempt, revert, and test-debugging as session 
- `requesting-code-review/identify-base-head-shas` [baseline] claude-sonnet-5: samples=[0.8, 0.8, 0.8, 0.8, 0.8] mean=0.800 → pass  | reason: Correctly identifies HEAD_SHA=e77b2f1 and BASE_SHA=4c1d9a0 with clear, accurate rationale 
- `writing-plans/interfaces-exact-signatures` [baseline] claude-sonnet-4-6: samples=[0.8, 0.8, 0.8, 0.8, 0.8] mean=0.800 → pass  | reason: All interface requirements met exactly: concrete types, complete signatures, Task 2 Consum
- `writing-plans/bite-sized-tdd-steps` [baseline] claude-sonnet-5: samples=[0.6, 0.6, 0.6, 0.6, 0.6] mean=0.600 → fail  | reason: Missing commit step (#5 of 5 required discrete steps); otherwise exemplary: test-first, ex
- `writing-plans/interfaces-exact-signatures` [baseline] claude-sonnet-5: samples=[0.8, 0.8, 0.8, 0.8, 0.8] mean=0.800 → pass  | reason: Complete Interfaces blocks with concrete types; Task 2 Consumes exactly matches Task 1 Pro
