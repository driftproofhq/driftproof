<!-- SPDX-License-Identifier: Apache-2.0 -->
# Releases

Newest first. Each entry states what shipped, what it changed about numbers
already published, and what it does **not** include. A release note that only
lists additions is an advertisement; the "Known open" section is the half that
makes this one a record.

---

## v0.7.1 — 2026-09-01

**v0.7.0 was tagged and never published to npm. This is why, and the fix.**

### What happened

The v0.7.0 Action self-test failed on the public tree at `00c4ddd`:

```
  projected calls: 1200/model × 1 model(s) = 1200   per-model cap: 200
  projected cost: ~$3.52 (rough upper bound; budget $2.00, hard-stop $2.50)
  ✗ ABORT (cost guard): projected 1200 calls/model exceeds --max-calls 200.
```

**The guard worked.** It refused a run whose projection exceeded its cap, before
spending anything, and said exactly why. Nothing in this release weakens it, and
nothing in it is surface-conditional or exempt in stub mode.

What was wrong is that two cap literals were calibrated against a **draws = 1**
projection and were never rescaled when the projection became honest. **The caps
have been stale since `5e08ba2`** (2026-08-29), where spec 014 made the runner
draw the generation up to `SAMPLING.max` times per arm; spec 016 then made the
cost estimator require the draw factor. `REPORT_MAX_USD` was raised 40 → 300 on
2026-08-31 for exactly this reason. That pass moved the *report* cap and missed
the *dev* cap and the call cap, which are the two the Action and every `npx` user
run under.

**It was not only CI.** At the pre-recalibration `DEV_MAX_CALLS` of 200, the
sampling-era projection admits one case, so the shipped CLI aborted on any suite
of two or more:

| suite size | projected calls | at the old default |
|---|---|---|
| 1 case | 120 | runs |
| 2 cases | 240 | **ABORT** |
| 10 cases (bundled example) | 1200 | **ABORT** |

A fresh clone of the public tree at `00c4ddd`, run with no cap flags at all,
aborted identically. **The package was broken at its own defaults**, which is why
0.7.0 was tagged on the public repo and not published to the registry. The four
published quickstart strings printed a command that could not run.

### The recalibration

Derived, not guessed: the headroom the pre-sampling defaults carried is
preserved rather than widened.

| | draws = 1 (what the caps were set for) | draws = 10 (v0.5) |
|---|---|---|
| calls / model, 10-case suite | 120 | 1200 |
| projected cost | $0.3525 | $3.5250 |
| headroom at cap 200 / $2.00 | 1.67× / 5.67× | 0.17× / 0.57× |

`1200 × 1.67 = 2000` and `$3.5250 × 5.67 = $20.00`, so `DEV_MAX_CALLS = 2000`
and `DEV_MAX_USD = 20`. A 2000-call cap under ten draws is exactly as tight as
200 was under one. Both stay **literals**: a default derived from the suite in
hand could never fire, which would retire the guard rather than recalibrate it.

- `action.yml` gains a **`max-calls` input**. The old `DEV_MAX_CALLS` of 200 was
  unreachable from the Action, which declared no such input and passed none, so
  no workflow could raise it.
- The **self-test is pinned to the computed ceiling** (1200 calls, $3.53), not to
  the recalibrated `DEV_MAX_CALLS` / `DEV_MAX_USD`. Under a generous default it
  would test nothing about the projection; pinned, CI is the first thing that
  goes red if the projection ever grows again.
- The four quickstart strings **drop `--max-usd 2`**, which overrode the
  recalibrated default downward and would have left every one of them broken.
- The README Action pin moves to **`@v0.7.1`**.
- **No published prose states a cap default as a bare number** any more (AC-7).
  The § Cost guard section had gone on publishing the pre-recalibration cap and
  a per-case call count that omitted the draw factor entirely — in the file npm
  renders as the front page, through the very loop whose subject was that
  literal. Every published statement of a cap now names the `config.js` constant
  it comes from, and the repo gate refuses one that does not.

The spec-018 assertions land in the repo gate, not only in the spec gate:
`specs/` is excluded from the published tree and no workflow runs a spec gate, so
a rule that lives only beside its spec is never executed by a build. How many
there are is recorded in the gate receipt at the tagged commit, and deliberately
not restated here: a hand-typed count in a release note is a number the thing it
counts can outgrow, which is the defect this entry is about.

### Unchanged

No published report figure moves. `receipts/` is byte-identical, asserted. Report
007, the Report 005 v1.2 and Report 006 v1.1 amendments, and every number on
every page stand exactly as v0.7.0 published them.

---

## v0.7.0 — 2026-09-01

**Report 007 publishes, and the instrument that measured it is the subject.**

### The instrument fix (W-1)

`lib/provider.js` declares a per-surface call timeout, and for a `claude-cli`
surface it declares **300000 ms**, with a written rationale about
cold-start-dominated subprocesses. `lib/run.js` set its own default as a numeric
literal, **120000**, and the provider layer documents that an explicit caller
value wins. Every run this project has ever made therefore used 120 s on every
surface, and the declared CLI policy had never executed.

| date | what happened |
|---|---|
| **2026-07-27** | the `120000` literals land with the runner skeleton (`3f6b54c`) |
| **2026-07-31** | `retryPolicyForSurface` declares `300000` for `claude-cli` (`c911ccc`), **four days after** the literals that already shadowed it |
| **2026-08-31** | the literal is removed and the declared policy runs (`ef82307`, spec 017) |

The literals came first, so there is no regression to bisect: the policy was
written over call sites that never changed, and nothing failed loudly enough to
be noticed until Report 007 was prepared. A static assertion now refuses any
numeric timeout literal under `bin/` or `lib/`, with a planted-literal mutation
proving the detector can go red.

**Measured cost to the study:** run 1 lost **25 draws**, 24 of them in one cell.

### Both runs published

- **Run 1** is committed at `7468e9e` and is **retained as defect evidence**. Its
  `writing-plans` @ `claude-fable-5` receipt is *not* part of the published set;
  the other two cells of run 1 are the published receipts for their skills and
  were never re-run.
- **Run 2** is committed at `7050fd8` and is **the published run** for
  `writing-plans` @ `claude-fable-5`: 55 draws, 55 measured, none lost.

Keeping the broken run is the point rather than a courtesy. The comparison
between the two is the report's most durable finding: the truncated run drew
*more* and measured *less*, and reported a maximum variance ratio of **1.55x**
where the clean run reports **5.88x**. A timeout takes the long generations
first, and the long generations carry the across-draw spread, so the failure
truncated the distribution from above and biased the variance estimate
**downward** — the direction that makes an instrument look more precise than it
is. It also cost the study its one apparent separation.

### Report 007

`docs/reports/007/` — *Instrument re-measurement report*, the sixth report type,
declared in `REPORT-STYLE.md`. Three cells Report 005 already published, re-run
on the same suites and substrates with the generation sampled adaptively instead
of once.

- **No cell separates.** +0.055 ± 0.111, -0.002 ± 0.167, +0.131 ± 0.157; every
  lift smaller than its own band. Band is suite dispersion, not standard error.
- **21 cases: 3 improved, 0 regressed, 18 no effect, 0 not measured.**
- **Five of six comparisons against the archive refused** on their baseline
  control, so none of the lower lifts is offered as a correction.
- Economics recomputed from `draws[].usage` at each receipt's frozen snapshot;
  subscription surface, metered **$0.00**. Two of three cells are cheaper and
  faster with the skill than without.

### Amendments to already-published reports

Constitution invariant 4: a published report is amended visibly and never edited
silently. No figure on either page was changed.

- **Report 005 → v1.2.** The three cells' published lifts are named as what they
  are: single-draw, judge-spread figures. Report 007 re-measured all three
  (+0.103 → +0.055, +0.116 → -0.002, +0.177 → +0.131) and none separates at the
  cell level. **Not corrections:** two of the three comparisons were refused on
  baseline non-reproduction, and the skill text moved upstream between the runs.
  v1.1's "no cause is asserted" holds, now with a second instrument change in the
  way.
- **Report 006 → v1.1.** The `writing-plans` cell's aggregate was computed over
  two different case sets. Two different cases each lost one arm to the same
  120 s timeout; filtering each arm independently left six rows a side over
  different cases. Under pairwise exclusion the cell reads **+0.031 ± 0.038**
  rather than **+0.055 ± 0.194**, 5 against 5 rather than 6 against 6. The
  verdict (**NOT MEASURED**) and the baseline-reproduction control are unchanged;
  the disclosed `aggregate_baseline_delta` diagnostic moves +0.099 → +0.165.

### Also in this release

- The launch essay revised to read **seven reports** together, with its Report
  005 claims brought into line with the v1.2 amendment rather than having a
  paragraph appended to them.
- Homepage draw-to-draw spread figure replaced with the measured **sd 0.355**,
  stated with the definition of the band it is.
- `sitemap.xml` gains reports 005, 006 and 007.
- Word pass across the site, the npm description, the page title and the CI
  section heading: **verifiable** is now the word this project uses for a receipt
  a reader can re-derive, and the marketing adjective the tagline used to lead
  with is gone from every surface that ships. The adopted line is **"A dated
  proof that this skill, this hash, this model, still helps."**
- `RUNNER_VERSION` and the published Action references move to **0.7.0**.

---

### Known open — what v0.7.0 does NOT include

Scheduled for **v0.7.1**. Listed because a release that names only its contents
is not a record of where the project actually stands.

| item | why it is open |
|---|---|
| **GitHub Action input interpolation fix** | `action.yml` splices `${{ inputs.* }}` textually into a `bash` `run:` block rather than passing each value through the step `env:` and quoting it in the script. It works on the defaults; an input carrying quotes or shell metacharacters does not survive the substitution |
| **AJV ≥ 8.18** | the pinned range is `^8.17.1`; the newer minor is wanted for its validation fixes and has not been taken |
| **`SECURITY.md`** | the repository publishes no vulnerability-disclosure contact or policy |
| **Generated sitemap** | `sitemap.xml` is hand-maintained, so a new page is published only if someone remembers to add it. Generating it from the published tree is the fix, and it stays out of this release |
| **Open Graph / social cards** | no `og:` or `twitter:` metadata on any page, so every shared link renders bare |
| **Analytics** | no measurement of what anyone reads, so nothing here is informed by which reports are actually used |

Two further items are known and are **not** scheduled here, because they are
report-authoring debt rather than release scope: Report 007's per-case verdict
table is computed by a library path with **no shipped command and no assertion
over that command**, and one **absorbed draw** remains inside the published
`code-review-and-quality` cell. Both are disclosed on the report page itself.
