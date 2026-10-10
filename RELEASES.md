<!-- SPDX-License-Identifier: Apache-2.0 -->
# Releases

Newest first. Each entry states what shipped, what it changed about numbers
already published, and what it does **not** include. A release note that only
lists additions is an advertisement; the "Known open" section is the half that
makes this one a record.

---

## v0.19.0 - 2026-10-10

### What's new

- **Every answer a run gets back is kept, and can be graded again under a revised rubric.** With
  `--keep-transcripts`, a run now writes every sampled answer to `answers.json`, not only the last
  measured draw of each case: answers the judge could not score, and answers from truncated or lost
  draws, are kept too. `driftproof regrade --rubric <evals.json>` grades those saved answers again
  under a revised rubric or pass threshold, with the original run's judge, judge sample count and
  judge template, and no new generation call. Anything else changed in the revised suite is refused
  before any call. The new receipt and its summary say it is a regrade, and name the original
  receipt and its run date, so a regraded result can be checked against the exact answers it graded.
- **A case can list weighted criteria, and the total is computed in code.** A case in
  `evals/evals.json` may list `criteria`, each with an `id`, a `weight` and a `description`. The judge
  decides each criterion met or not met with a one-sentence reason; the weighted total and each
  sample's pass are computed by the runner, and any score or pass the judge returns is ignored and
  recorded as ignored. A judge reply that does not decide every criterion exactly once leaves that
  draw unmeasured, with the reason, and is never scored. Each draw records the per-criterion
  decisions, and `--keep-transcripts` keeps the judge's raw reply beside them. `regrade --rubric` can
  revise a case's criteria. This changes how a criteria case's total is added up, not how the judge
  reads an answer.

- **Three published reports gain dated corrections, and one a corrected title.** Report 007's
  three judge-cost figures stay exactly as published, each now followed by a corrected total
  counted over every draw's own judge usage instead of only its last draw: $2.601445 is followed
  by $8.047195, $2.313420 by $7.634930, and $3.253265 by $13.737220. Reports 001 through 005, and
  007 and 008, each gain a note where their headline counts include receipts their own receipt
  pages mark Not measured; Report 006 is left alone, since its headline states no count to
  correct. Report 011's title is corrected from "Claude Opus 5.5 on release day, three skills" to
  "Claude Opus 5.5, the day after its release, three skills," since the run behind every figure on
  the page began the day after the model's actual release date. No published figure, verdict or
  badge changes; each correction is a dated line added beside what was already published.
- **The maintainer page catches up with GitHub.** The credit for the maintainer's fix to
  alibaba/skill-up (pull request #304) now links that project's v0.13.0 release notes, which
  credit the fix by name, in place of "merged, unreleased."
- **`driftproof view`'s answer count reads less ambiguously.** The Answers row now says the judge
  scored each answer N times, where the wording used to read in a way that could be misread as
  the whole suite being scored N times.

### What may change for you

- **Nothing in this release changes what an existing run, receipt or verdict reports.** A suite
  without criteria objects is hashed, graded and recorded exactly as on 0.18.0. A `criteria` field
  that is a string, a list of strings or an empty list is read as before.
- **`--keep-transcripts` writes more.** The transcripts directory now also holds `answers.json`,
  every answer of the run. When the receipt, its summary or that directory is already taken, a run
  writes nothing and exits non-zero.
  An archive written by an earlier version can still be read by `regrade --answers`, for the draws it
  holds.

### Known issues

- **Unpaired evals from `claude plugin eval` still pool into the aggregate.** Only the skill-creator
  importer excludes an eval scored in one arm only, or with mismatched expectation counts between
  arms, from the aggregates this release. The same mismatch in a `claude plugin eval` import can still
  skew the reported delta.
- **Cases from a skill that does not exist.** On the command line, `driftproof init <new folder>
  --cases <file> --drafted-from-skill` creates a stub `SKILL.md` and labels the suite and each case as
  drafted from the skill and approved by the user, though there was no skill to draft from. The
  plugin never takes this route.
- **A lost-answer reading still has edges.** A bare "Created `report.md`." beside a pleasantry, a
  reply that opens with a title, and some code names that end in a file extension can still be read the
  wrong way.
- **Backslashes in the stale summary.** A path or model id that holds a backslash shows it doubled in
  the stale summary's code cells.
- **`driftproof view` and a bad `capture` value.** A `.driftproofrc` in the working directory with
  `"capture": "both"` makes `view` list the receipt as not read, where `stale` and `run` exit 2.
- **One check clears at the publish.** The plugin's check that its package matches the published npm
  package can read only after 0.16.0 is on npm.

### Upgrade

- npm: `npx driftproof@0.19.0`. The Action: `driftproofhq/driftproof@v0.19.0`, and the stale Action
  `driftproofhq/driftproof/stale@v0.19.0`.
- Claude Code plugin: `claude plugin update driftproof@driftproofhq`. The plugin runs `npx
  driftproof@0.19.0`, and `/driftproof:start` needs a runner at 0.14.0 or later.
- Receipt spec is unchanged at v0.11. Receipts from earlier versions still validate. A criteria case
  adds `criteria_judgments` to a draw, which v0.11 declares open, so `schema_version` stays "0.11". A
  workflow that sets no new option and lists no criteria objects behaves as on 0.18.0.

### Engineering log

**`package.json` reads 0.19.0**, and `config.js`'s `RUNNER_VERSION` is held equal to it, the only
place the version is typed. The Action pins in `README.md` are `@v0.19.0`, and so is
`examples/workflows/driftproof-stale.yml`'s `stale@v0.19.0` pin. The plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.19.0, and so is the npx pin in
`plugin/driftproof/README.md`. `plugin/driftproof/version-guard.json` carries `minimum` 0.19.0 and
`resolved_by` `27984ad0`, the version bump commit; `start_minimum` stays 0.14.0, unmoved.
`package-lock.json` moves with them, and every report, methodology and site page's `index.html`,
`docs/data/page-dates.json` and the sitemap files move with the bump and the freeze that follows
it. **Not yet on npm** at the bump; a Published section is added here after the publish.

**Reports 001 to 005, 007, 008 and 011 are corrected without touching a published figure (issue 8,
PR 157, spec 161).** Report 007's three judge-cost figures were read from the last draw's judge
usage only; counted over the judge usage every draw records, each is larger ($8.047195,
$7.634930, $13.737220), and the page keeps its original figure with the corrected total directly
beneath it. Reports 001 to 005, 007 and 008 each gain a note where their headline counts include
receipts their own pages mark Not measured; Report 006 carries none, since its headline states no
count. Report 011's `<h1>` is corrected from "on release day" to "the day after its release" (the
vendor's news index dates the model's release 22 Sep 2026; the run behind every figure on the page
began 23 Sep). This is the first use of the correction rule CONSTITUTION.md now states in §
Decision policy (issue 132, PR 144, spec 181, catalogue row C-282): a public claim a defect leaves
unsupported is corrected by a dated amendment on the artefact itself, never waiting for the
matching code fix.

**The maintainer page's upstream credit for alibaba/skill-up moves from unreleased to shipped
(issue 152, PR 153, spec 169 A-169-3).** skill-up released v0.13.0 on 10 Oct 2026, crediting the
fix by name; the page's row now links that release note. A sibling amendment (issue 120, PR 165,
spec 169 A-169-4) separately tightens the page's own gate so a link to a release, tag, tree,
compare or archive page can no longer pass as "not a release" in a row still marked unreleased;
nothing on the page itself moved by that change.

**`driftproof view`'s Answers row names what it counts (issue 6, PR 147, spec 128).** It read
"...each scored N times," which could be read as the whole suite being scored N times; it now
reads "...the judge scored each answer N times." No number on the row moves.

**Every sampled answer kept, and `regrade --rubric` (issue 176, PR 182, spec 184).**
`run --keep-transcripts` kept the last measured draw of each case and mode only. It now also writes
`answers.json` (format `driftproof-answers/2`): every answer the run got back, keyed by its sha256,
with one row per draw naming its `generation_hash`, status and judge outputs. Answers are kept when
the judge failed, timed out or gave no valid score, and when the draw was truncated or lost; a draw
with no answer has none made up. `regrade --rubric <evals.json>` re-judges those answers with the
original's judge, sample count and judge template; the revised suite is read as written and may
differ only in each case's `rubric` and `pass_threshold` (a number in [0, 1]), and the regrade's
receipt carries the revised `suite_hash`, `run.grader_revision` and `run.judged_at`, with no
`run.generated_at`. Its summary prints `graded (UTC)` and names the original receipt, file and run
date. An independent review before the pull request found five faults (a files-capture draw whose
judge reply was invalid was hashed as the bare reply; the revised suite was compared after
normalisation; the summary read like a run; `--samples` and a moved judge template were accepted in
rubric mode; one refusal lived in the CLI only); each was fixed with a test that read red first
(A-184-1 to A-184-5).

**Per-criterion judgments (issue 179, PR 184, spec 185).** `lib/judge.js` asks for a decision per
criterion and reads it strictly; `lib/skill.js` validates the list when the suite loads (unique ids
matching `^[A-Za-z0-9_.-]{1,64}$`, weights finite and above 0 with a finite sum, non-empty
descriptions); `lib/run.js` and `lib/regrade.js` grade through the same code. Criteria enter
`suite_hash` and the case's `judge.rubric_hash`. Two independent reviews ran before the pull
request: the first's seven findings were fixed with tests that read red first (A-185-1 to A-185-7),
and the second found nothing blocking. `regrade --rubric` accepts revised criteria under the checks
a run applies, and refuses a case that changes shape (A-185-8). Non-blocking findings from the
reviews and from PR 182's and PR 184's approvals are owed in issue 183.

**The release build finishes a draft the action fails for its turn count (issue 26, PR 178).** The
v0.19.0 draft stopped at the action's turn cap after its notes were written and its pull request
opened. A new `ended` step in `build.yml` lets such a build finish when the action's own record ends
in a successful result and the pull request is open; any other failure parks as before. Release mode's
turn cap is 160.

**The auto-start trigger's live reads are tested on recorded responses (issue 168, PR 177, spec 183
A-183-2).** Each GitHub read the trigger makes can be served from a recorded response, and six plants,
one per read, each read red. Required before `AUTO_RELEASE` is set; it stays unset.

**A CodeQL alert in a test helper (issue 180, PR 181).** `tests/assertion-scope.js` escaped only the
dots of a version before building a regex (js/incomplete-sanitization); it now escapes every regex
metacharacter. The release sweep reads CodeQL, and this alert was its one new result.

**The rehearsal sweep's reds, gate baselines only (issue 185, PR 186).** A rehearsal sweep of
this release read four gates red that pin the README body (specs 126, 145 and 162): issue 8's README
change had been recorded in spec 020's baseline only. Specs 126 and 145 now read that change as a named
hunk, byte for byte (A-126-18, A-145-10, under spec 161's A-161-3). Spec 161 AC-8 read the release
bump's `npx driftproof@<version> validate` line on receipt pages as a moved page; it now allows that
line alone, with both versions read from `package.json` (A-161-3). Each change carries plants that read
red. No product file moved.

**The release train can start a release itself when the queue is quiet (issue 162, PRs 167 and
172, spec 183; DECISIONS C-273, PR 170).** Catalogue row C-273 named one way to start a release:
the operator's own comment. This adds a second, off by default: with the repository variable
`AUTO_RELEASE` set to `true`, an hourly job starts a release itself once an unreleased
`class:product` merge is waiting and the queue has gone quiet (no open `building` issue, no
`ready` pull request, `dev`'s head at least two hours old, no release or sweep already running),
and posts its reading on the pinned Release issue first. It stays off through this release; the
operator turns it on only after the public release reviewer is removed. None of this touches the
npm package, the Action or the plugin.

**Already shipped before this release's own cut (issue 134, PR 135; PR 133).** `release/v0.18.0`'s
own version bump and its RELEASES.md entry land on `dev` here; they carry no new change of their
own and are already described in the v0.18.0 entry below.

**Already shipped in 0.18.0, `dev`'s own history catching up (issue 134 continued, PRs 140 and
143, spec 180).** The auxiliary-model-attestation build (`attest()` reads the model that served
the main turn; the other ids are recorded on the draw as `auxiliary_calls`) and its two sibling
amendments to specs 032 and 035 land on `dev`'s own first-parent line only now; the behaviour
itself is already described in the v0.18.0 entry below and ships nothing new here.

**Gate and nightly hygiene, no product change (issues 7, 99, 100, 101, 114, 115, 119 and 123; PRs
139, 146, 150, 154, 156, 159, 163, 164 and 166).** None of these touch `lib/`, `bin/`, `action.yml`,
the plugin, a receipt or a published page. Each closes a gate that was reading a false signal or
missing a real one: spec 018's cap-word scanner stopped misreading "re-captured" and "captures" as
a cost-cap literal, the fault that had forced earlier release notes to be hand-reworded around it
(issue 137, PR 139); spec 022's isolation gate now reads the eval user's own `TMPDIR` instead of
assuming it matches the parent process's (PR 146); spec 144 gains gate coverage proving seven
hostile-text forms already render as inert text on every surface (PR 150); spec 173's gate now
reads the commits each of its own amendments actually carries, instead of only the commits between
its original Base and Tip (PR 154); spec 176 now names the real cause when a release sweep reads
CodeQL as unreadable, instead of a generic verdict line (PR 156); spec 035's claims-count scan now
re-runs itself instead of trusting a hardcoded figure (PR 159); spec 031's repository-gate coverage
of two report-correction entries is tightened, closing two findings owed from earlier approvals
(PRs 163 and 173); spec 177 records its own classification for an earlier amendment, moving no
reading (PR 164); and spec 026's rule against a second copy of a probe now reads three more probe
files that had drifted out of its sight (PR 166).

#### The 0.19.0 merge list

Twenty-eight merges since v0.18.0's source commit `ea2938f0`, oldest first:

- claude-cli auxiliary-model attestation, `dev`'s own copy (issue 134, PR 135): already shipped in
  0.18.0, above.
- release-pipeline false-red fix, spec 018's cap-word scanner (issue 137, PR 139): gate only,
  above.
- release/v0.18.0 merge back (PR 133): that release's version bump and its RELEASES.md entry land
  on `dev`; carries no new change of its own.
- claude-cli auxiliary-model attestation, the build (issue 134, PR 140, spec 180): already shipped
  in 0.18.0, above.
- claude-cli auxiliary-model attestation, sibling amendments to specs 032 and 035 (PR 143): already
  shipped in 0.18.0, above.
- the public-claim-correction rule, in CONSTITUTION.md (issue 132, PR 144, spec 181): the
  mechanism the report corrections below use.
- eval-user isolation gate, `TMPDIR` read inside the hop (issue 99, PR 146): gate only, above.
- `driftproof view`'s Answers row wording (issue 6, PR 147, spec 128): the judge-scored-per-answer
  wording.
- PR-comment escaping test coverage (issue 7, PR 150, spec 144): gate only, above.
- maintainer page, skill-up's fix now shipped (issue 152, PR 153, spec 169 A-169-3): the v0.13.0
  credit.
- spec 173's gate, reading each amendment's own commits (issue 100, PR 154): gate only, above.
- release-sweep CodeQL-unreadable cause naming (issue 101, PR 156, spec 176): gate only, above.
- Reports 001 to 005, 007, 008 and 011 corrected (issue 8, PR 157, spec 161): the dated notes and
  totals.
- spec 035's claims-count scan, re-run instead of trusted (issue 114, PR 159): gate only, above.
- spec 031's repository-gate coverage of a report-correction entry, tightened (issue 115, PR 163):
  gate only, above.
- spec 177's own classification, recorded (issue 119, PR 164): gate only, no reading moves.
- maintainer page's unreleased-row link check, tightened (issue 120, PR 165, spec 169 A-169-4):
  gate only, above.
- spec 026's no-second-probe-copy rule, three more files in its sight (issue 161, PR 166): gate
  only, above.
- the release train's own auto-start trigger (issue 162, PR 167, spec 183): the build.
- DECISIONS C-273, the auto-start trigger recorded (issue 162, PR 170): the catalogue row.
- the release train's auto-start trigger, a follow-up (issue 162, PR 172, spec 183): draft and
  label-release run on every start.
- spec 031's repository-gate coverage of a second report-correction entry, tightened (issue 123,
  PR 173): gate only, above.
- the auto-start trigger's live reads, tested on recorded responses (issue 168, PR 177, spec 183
  A-183-2): above.
- a release draft the action fails for its turn count, finished (issue 26, PR 178): above.
- the version-literal rule's regex escaping (issue 180, PR 181): above.
- every sampled answer kept, and `regrade --rubric` (issue 176, PR 182, spec 184): the first
  feature above.
- per-criterion judgments (issue 179, PR 184, spec 185): the second feature above.
- the rehearsal sweep's reds (issue 185, PR 186): gate baselines only, above.

---

## v0.18.0 - 2026-10-09

### What's new

- **Runs through Claude Code no longer stop on Claude Code's own helper calls.** Recent Claude Code
  versions can make a small call to another model of their own beside the one you asked for. Driftproof
  read that as the wrong model answering, stopped the run and wrote no receipt. A run now checks that
  the model you asked for answered the task itself, and records any other model Claude Code called in
  the receipt beside it. A run still stops when the model you asked for did not answer the task.
- **Report 008's reading of its biggest baseline move is corrected.** For one case, the report said a
  baseline score "fell 0.585 to 0.308." One of the draws behind that baseline number timed out and was
  never scored. Read at either end of the judge's scale, that missing score widens the baseline's range
  enough to overlap the new model's, so the fall does not hold up as a real change, and the drop is not
  evidence the score held steady either. The page's dated note and its plain-language summary both now
  say this; no figure, verdict or receipt reference on the page changes.
- **One more contributed fix is credited on the maintainer page.** A fix sent to another agent-skill
  evaluation project merged on 9 October 2026; the page lists it as merged and waiting on that
  project's own next release.

### What may change for you

- **A drift comparison no longer calls a case regressed or improved when the call rests on an answer
  the run could not score.** When a draw times out or otherwise cannot be judged, it is left out of
  that case's average, as before. Now, before a comparison calls a case regressed or improved, it also
  checks whether that call would still hold whatever score the missing answer could have gotten, from
  the bottom of the judge's scale to the top. When it would not hold, the comparison reads that case as
  inconclusive instead, names the missing draw, and says so; a report whose headline would otherwise be
  "drifted" or "improved" reads "inconclusive" when this is the only kind of case behind it. A
  comparison where nothing was missing reads exactly as before. No comparison already published
  changes; this changes what a comparison you run from here on can say.

### Known issues

- **Unpaired evals from `claude plugin eval` still pool into the aggregate.** Only the skill-creator
  importer excludes an eval scored in one arm only, or with mismatched expectation counts between
  arms, from the aggregates this release. The same mismatch in a `claude plugin eval` import can still
  skew the reported delta.
- **Cases from a skill that does not exist.** On the command line, `driftproof init <new folder>
  --cases <file> --drafted-from-skill` creates a stub `SKILL.md` and labels the suite and each case as
  drafted from the skill and approved by the user, though there was no skill to draft from. The
  plugin never takes this route.
- **A lost-answer reading still has edges.** A bare "Created `report.md`." beside a pleasantry, a
  reply that opens with a title, and some code names that end in a file extension can still be read the
  wrong way.
- **Backslashes in the stale summary.** A path or model id that holds a backslash shows it doubled in
  the stale summary's code cells.
- **`driftproof view` and a bad `capture` value.** A `.driftproofrc` in the working directory with
  `"capture": "both"` makes `view` list the receipt as not read, where `stale` and `run` exit 2.
- **One check clears at the publish.** The plugin's check that its package matches the published npm
  package can read only after 0.16.0 is on npm.

### Upgrade

- npm: `npx driftproof@0.18.0`. The Action: `driftproofhq/driftproof@v0.18.0`, and the stale Action
  `driftproofhq/driftproof/stale@v0.18.0`.
- Claude Code plugin: `claude plugin update driftproof@driftproofhq`. The plugin runs `npx
  driftproof@0.18.0`, and `/driftproof:start` needs a runner at 0.14.0 or later.
- Receipt spec is unchanged at v0.11. Receipts from earlier versions still validate. A workflow that
  does not set any new option behaves as on 0.17.0, except for the drift-comparison change listed
  under What may change for you.

### Engineering log

**`package.json` reads 0.18.0**, and `config.js`'s `RUNNER_VERSION` is held equal to it, the only
place the version is typed. The Action pins in `README.md` are `@v0.18.0`, and so is
`examples/workflows/driftproof-stale.yml`'s `stale@v0.18.0` pin. The plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.18.0, and so is the npx pin in
`plugin/driftproof/README.md`. `plugin/driftproof/version-guard.json` carries `minimum` 0.18.0 and
`resolved_by` 18945304, the version bump commit; `start_minimum` stays 0.14.0, unmoved since the
release that first shipped `init --cases` (DECISIONS C-278). `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut, because `runner_version` is
inside the canonical receipt that hash is taken over. `docs/data/stats.json` and every report,
methodology and site page's `index.html` move with it; `docs/data/page-dates.json` and the sitemap
files stay as they were, since no page's own content changed this time. **Not yet on npm** at the
bump; a Published section is added here after the publish. No comparison already published changes in
this release; what a comparison run from here on can say is in What may change for you.

**A drift verdict now holds against a case's own lost draws (issue 105, PR 113, spec 178).** Spec 119
already made a single receipt's own verdict hold whatever its lost draws would have scored; the
comparison between two receipts, `lib/diff.js`, was out of that spec's scope and read only the
surviving draws, so one timed-out draw could turn an overlap into a published "regression" with no
word about the loss. This spec has the comparison read each side's lost draws and keep a separation
only when it holds at every score they could have had; a separation that does not hold reads
`inconclusive`, names the case's lost and drawn counts on both sides, and the comparison's own header
gains a per-case measured-of-drawn column once any case lost a draw. The issue's own scan of every
tracked, published comparison found none whose verdict rests on a lost draw, so nothing already
published moves. A fresh-context review (PR 113's F-1) raised the change's own tier from T2 to T1,
since it can change what a verdict says; the fix loop closed that finding by writing the acceptance
criteria in EARS form and confirming the behaviour was already sound.

**Report 008's lost-draw correction, in two parts (issue 109, PR 112; issue 116, PR 122).** A private
outside audit dated 9 October 2026 found that the report's "baseline arm fell 0.585 to 0.308," its
widest reported baseline move, rests on a baseline draw that timed out. Bounded at either end of the
judge's scale, the case does not separate under the rule either way, so it is not the regression the
report's 2026-09-14 entry called it. PR 112 gives the full report page its dated v1.3 entry, under spec
031's claims discipline; PR 112 shipped in 0.17.0's public tree the same day, ahead of this release and
independent of it, because a public-claim correction does not wait for a code fix of the same defect
(DECISIONS C-282). PR 122 brings the site's plain-language summary of the same case into line with it.
Neither changes a figure, verdict token, table value or receipt reference on the page.

**Already shipped in 0.17.0, before its own cut (issues 104, 108, 117; PRs 111, 110, 118).** The same
9 October audit also found that `caseRule`'s effect-floor test compared an unrounded float delta
against the inclusive 0.05 floor, so ten of the twenty exact 0.05 steps read as below it; a receipt
with cases each regressing by exactly 0.05 could read PASSED. PR 110 (spec 035 A-035-11) rounds the
delta before the floor test; PR 118 (A-035-12) narrows the rounding to the floor test alone, so the
delta a receipt reports is unchanged, because spec 053 pins `receiptVerdict`'s output. Separately, the
0.17.0 release sweep read three gates red that were green at 0.16.0, each tracing to the same cause: a
run at `--concurrency 1`, and every regrade, now made its judge calls together instead of one at a
time, and `--keep-transcripts`' choice of which draw to keep moved out of the draw loop. PR 111 (issue
104, spec 177) moves both back for the one-at-a-time case and corrects the plugin README's claim about
what `/driftproof:start`'s small full run sends. All four pull requests were merged into `dev` and then
into `release/v0.17.0` before that release's own sweep passed and it published (`b0a95d71`,
`b468e65a`); they ship nothing new here and appear in this release's merge list only because `dev`'s
history runs through them.

**Pipeline and release-process fixes, none of them shipped in the npm package (issue 127, PR 130, spec
179).** A release sweep that the pipeline itself dispatched caused no `workflow_run` event (only a
person dispatching one does), so the release train could not read its result; the sweep now dispatches
the release train directly with the run's own id once it finishes, and the train waits on it through
the API. The release train's own bisect and the public-site build now install their npm dependencies
before they run, and the bisect's own git fetch authenticates through the job's token. None of this
touches `lib/`, the CLI, the Action or the plugin.

**Housekeeping (issue 124, PR 125; issue 128, PR 129).** Spec 025's evidence screenshots of the
maintainer and Report 008 pages are taken again after the pages above changed under them; no page
itself moves again. `DECISIONS.md` gains C-282 and C-283, recording the 9 October audit's priority
ruling and the tier correction it made to two approvals, in the catalogue.

**Already in 0.17.0's own notes, above (PR 102).** PR 102 is the `release/v0.17.0` branch's merge back
into `dev`, carrying that release's version bump and its RELEASES.md entry. It is already described in
the v0.17.0 entry below and adds nothing new here; it appears in this release's merge list only because
`dev`'s history runs through it.

#### The 0.18.0 merge list

Eleven merges since v0.17.0's source commit `c15a07e9`, oldest first:

- judge calls one at a time at `--concurrency 1` and in a regrade, and the plugin README's small-full-run
  claim (issue 104, PR 111): already shipped in 0.17.0, above.
- effect-floor rounding (issue 108, PR 110): already shipped in 0.17.0, above.
- Report 008 v1.3, the full page (issue 109, PR 112): already shipped in 0.17.0's public tree, above.
- effect-floor rounding narrowed to the floor test alone (issue 117, PR 118): already shipped in
  0.17.0, above.
- release/v0.17.0 merge back (PR 102): that release's version bump and its RELEASES.md entry land on
  `dev`; carries no new change of its own.
- maintainer page, one more upstream fix credited (issue 103, PR 107): the new table row.
- Report 008 v1.3, the plain-language summary (issue 116, PR 122): brought into line with the full
  page above.
- a drift verdict holds against a case's own lost draws (issue 105, PR 113): the `inconclusive` reading.
- claude-cli auxiliary model calls (issue 134, PR 135, spec 180): attest() reads the model that served
  the main turn; the other ids are recorded on the draw as auxiliary_calls.
- release train and sweep pipeline fixes (issue 127, PR 130): the dispatched-sweep read, the
  dependency installs, the bisect's authenticated fetch.
- spec 025's screenshots taken again after the maintainer and Report 008 changes (issue 124, PR 125): no page
  moves again.
- decisions catalogue rows C-282, C-283 (issue 128, PR 129): the 9 October audit's rulings recorded.

---

## v0.17.0 - 2026-10-09

### What's new

- **A page on how often quoted AI benchmark gaps hold up against each benchmark's own sampling
  noise.** `/leaderboard-noise/` is Maverick's own written analysis, not a Driftproof run: it checks
  162 quoted comparisons across six posts against each benchmark's own noise, using the same method
  the site's reports use, and finds 20 hold up. The page carries no receipt, badge or verdict stamp.
  It is linked from the nav, right after the gap calculator, and from a line under the homepage's
  hero.
- **The benchmark gap calculator reads at a glance.** Above the fold, pick a benchmark, type two
  scores and press "Check the gap": one plain verdict, how far ahead one score is, and one sentence
  built from the numbers. Everything the page said before is still there, behind a "Show the
  statistics" expander.

### What may change for you

- **The guided first run asks once before it writes anything.** Saying yes to the drafted test cases
  used to also, with no question asked of its own, create the `receipts/` folder and the results
  page. Now the one yes you give covers all of it, and nothing is written until you give it.
- **A drafted test case checks what your skill needs before it is written.** Drafting could hand you
  a case that needs a tool, a bundled file or an input the run never supplies, so it failed on the
  very first step. Drafting now reads what the skill needs first.
- **The results page reads your last run's skill, model and judge from the receipt.** On a first run,
  with no `--model`, `--skill` or `--judge` flag and no `.driftproofrc`, the "Up to date?" row used to
  read "Can't tell" even though the receipt itself names what ran. It now reads those three from the
  receipt and says so.
- **A full run with no quick run first now asks once, and every run goes faster.** Asking for the
  full run directly, with no quick run's receipt on hand, asks one question before anything runs,
  instead of running unasked or refusing outright. And within any run, a test case's repeat draws and
  a draw's judge samples now go out together rather than one at a time, so a run finishes sooner
  without changing its result.

### Known issues

- **Unpaired evals from `claude plugin eval` still pool into the aggregate.** Only the skill-creator
  importer excludes an eval scored in one arm only, or with mismatched expectation counts between
  arms, from the aggregates this release. The same mismatch in a `claude plugin eval` import can still
  skew the reported delta.
- **Cases from a skill that does not exist.** On the command line, `driftproof init <new folder>
  --cases <file> --drafted-from-skill` creates a stub `SKILL.md` and labels the suite and each case as
  drafted from the skill and approved by the user, though there was no skill to draft from. The
  plugin never takes this route.
- **A lost-answer reading still has edges.** A bare "Created `report.md`." beside a pleasantry, a
  reply that opens with a title, and some code names that end in a file extension can still be read the
  wrong way.
- **Backslashes in the stale summary.** A path or model id that holds a backslash shows it doubled in
  the stale summary's code cells.
- **`driftproof view` and a bad `capture` value.** A `.driftproofrc` in the working directory with
  `"capture": "both"` makes `view` list the receipt as not read, where `stale` and `run` exit 2.
- **One check clears at the publish.** The plugin's check that its package matches the published npm
  package can read only after 0.16.0 is on npm.

### Upgrade

- npm: `npx driftproof@0.17.0`. The Action: `driftproofhq/driftproof@v0.17.0`, and the stale Action
  `driftproofhq/driftproof/stale@v0.17.0`.
- Claude Code plugin: `claude plugin update driftproof@driftproofhq`. The plugin runs `npx
  driftproof@0.17.0`, and `/driftproof:start` needs a runner at 0.14.0 or later.
- Receipt spec is unchanged at v0.11. Receipts from earlier versions still validate. A workflow that
  does not set any new option behaves as on 0.16.0, except for the two confirmations and the receipt
  reading listed under What may change for you.

### Engineering log

**`package.json` reads 0.17.0**, and `config.js`'s `RUNNER_VERSION` is held equal to it, the only
place the version is typed. The Action pins in `README.md` are `@v0.17.0`, and so is
`examples/workflows/driftproof-stale.yml`'s `stale@v0.17.0` pin. The plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.17.0, and so is the npx pin in
`plugin/driftproof/README.md`. `plugin/driftproof/version-guard.json` carries `minimum` 0.17.0 and
`resolved_by` bd021e58, the version bump commit; `start_minimum` stays 0.14.0, unmoved since the
release that first shipped `init --cases` (DECISIONS C-278). `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut, because `runner_version` is
inside the canonical receipt that hash is taken over. `docs/data/stats.json`, `docs/index.html`,
`docs/data/page-dates.json`, `docs/sitemap.xml` and `docs/sitemap-receipts.xml` are regenerated by
their generators. **Not yet on npm** at the bump; a Published section is added here after the
publish. No published receipt, number or verdict changes in this release.

**The guided first run, in two parts (specs 172, 173, PRs 62, 80, 98).** Spec 172's M-4 has drafting
read what the skill needs before it drafts a case, so a case the run cannot satisfy is not drafted in
the first place; its M-5 moves the person's one yes ahead of everything the guided run writes, not
only `evals/evals.json`, so a refusal before the first call leaves nothing behind, not even an empty
`receipts/`. Spec 173's S-5 has the results page's stale check take a first run's skill, model and
judge from the receipt itself when no flag and no `.driftproofrc` names them, in place of reading all
three as unknown; R-2 adds the small full run's offer after a quick run, with its calls and a time
estimate, run only on a clear yes; R-3 runs a task's draws and a draw's judge samples concurrently
rather than one at a time. A-173-2 (issue 92, PR 98) closes the one case R-2 left open: asked for
directly, with no quick run's receipt on hand, `--full` now asks one question at a terminal before it
runs, or has `start.md` ask it in the conversation where there is no terminal. A review follow-up
(issue 86, PR 91) also corrected a wording slip spec 172 introduced earlier in this same cycle: the
draft-inside-skill refusal named `start` where it should have named `init`; the wrong wording was
never released.

**The site (specs 171, 174, 175, PRs 81, 77, 85).** Spec 171 adds `/leaderboard-noise/`, Maverick's
own analysis of 162 quoted benchmark comparisons against each benchmark's own sampling noise, 20 of
which hold up, read with the 8 October score-type audit and the site's own interval method; it is
prose and data, not a Driftproof run, and carries no receipt or verdict. Spec 174 is the calculator's
plain-language pass: a "Check the gap" button, one plain verdict and the sentence it is built from
above the fold, with the existing intervals chart, formulas and edge cases moved behind a "Show the
statistics" expander; `gap.js`'s numeric core and `tests/benchmark-gap.test.js` are untouched. Spec
175 puts spec 171's page in the nav, right after the gap calculator, and moves its homepage line from
the stats section to directly under the hero. None of these three touch the runner, the CLI or a
published report's existing numbers.

**Review follow-ups and two CodeQL alerts (specs 148, 165, 171-174, PRs 79, 91).** Two dismissed
CodeQL results were fixed in code: `build-head-tags.js`'s `strip()` and `assertion-scope.js`'s
`visibleText()` (issue 78, PR 79). Spec 148's baseline then drops exactly those two entries, and
A-148-6 adds a check that an alert named fixed in code is off the baseline and its line is gone from
its file (issue 86, PR 91). The same pull request carries eleven other non-blocking findings from the
review of specs 171 through 174, tightening mutation coverage on the leaderboard-noise figure's
numerals and on the CodeQL baseline comparison, besides the `init` wording fix named above. None of
it loosens a criterion.

**Pipeline and release-process fixes, none of them shipped in the npm package (spec 176, PRs 97, 96,
and issues 73, 75, 83).** Spec 176 fixes two defects from the 0.16.0 release train: the freeze step's
git fetch now authenticates through the job's own token in place of exiting 128 (fix 1), and a red
sweep's bisect comment now names the gate and cause it reads from the sweep report's own
`result.json`, in place of "gate unknown" (fix 2); fix 3 (issue 94, PR 96) has the freeze step rewrite
`release-record.json` when the release branch took commits after the draft. `gate-map.json` is
re-derived so two previously failing pipeline tests pass (issue 75, PR 76). `release-record.json`'s
`tarball_integrity` for 0.16.0 is corrected to the hash of the tarball actually packed, recorded once
the npm publish made it checkable (issue 73, PR 74). `DECISIONS.md` gains C-280 and C-281, recording
two widenings from 0.16.0's own review (issue 60, spec 169, PR 67 finding F-4) in the catalogue,
operator-approved 9 Oct (issue 83, PR 84).

**Already in 0.16.0's own notes, above (PRs 68, 70, 72).** PR 70 and PR 72 are the 0.16.0 release
sweep's own fixes (issues 69 and 71), and PR 68 is the `release/v0.16.0` branch's merge back into
`dev`, carrying that release's version bump and its RELEASES.md entry. All three are already
described in the v0.16.0 entry below and add nothing new here; they appear in this release's merge
list only because `dev`'s history runs through them.

#### The 0.17.0 merge list

Sixteen merges since v0.16.0's source commit `f5588da9`, oldest first:

- release sweep fixes (issue 69, PR 70) and release sweep fix (issue 71, PR 72): already in 0.16.0's
  own notes below.
- release/v0.16.0 merge back (PR 68): that release's version bump and its RELEASES.md entry land on
  `dev`; carries no new change of its own.
- 0.16.0 tarball record fix (issue 73, PR 74): `release-record.json`'s `tarball_integrity` corrected
  to the packed tarball's actual hash.
- 172-first-run-drafting-and-consent (issue 54, PR 62): drafted cases the skill can run, and one yes
  before any file is written.
- gate-map re-derivation (issue 75, PR 76): two failing pipeline tests pass.
- CodeQL fix (issue 78, PR 79): `build-head-tags.js`'s `strip()` and `assertion-scope.js`'s
  `visibleText()`.
- 173-first-result-and-speed (issue 55, PR 80): a plain first result, a small full run on offer, and
  faster runs.
- 171-leaderboard-noise-page (issue 51, PR 81): the `/leaderboard-noise/` page.
- 174-calculator-plain-language (issue 63, PR 77): the Check button, the plain verdict, the statistics
  behind one expander.
- decisions catalogue rows C-280, C-281 (issue 83, PR 84): two 0.16.0 review widenings recorded in the
  catalogue, operator-approved.
- 175-leaderboard-noise-nav (issue 82, PR 85): the nav entry and the homepage line under the hero.
- review follow-ups (issue 86, PR 91): the CodeQL baseline prune, the `init` refusal wording, eleven
  non-blocking findings.
- 176-release-freeze-auth-and-red-cause, fix 3 (issue 94, PR 96): the freeze rewrites
  `release-record.json` when the release branch took commits after the draft.
- 173-first-result-and-speed, A-173-2 (issue 92, PR 98): a direct `--full` with no earlier quick run
  asks one confirmation.
- 176-release-freeze-auth-and-red-cause, fixes 1 and 2 (issue 95, PR 97): the freeze step
  authenticates its fetch, and a red sweep names its gate.

---

## v0.16.0 - 2026-10-08

### What's new

- **A new look across the whole site.** Reports, the methodology pages and the new benchmark gap
  calculator (below) now sit on a dark page shell, with their evidence shown on paper-colored cards.
  Navigation and the footer move to the same look. No report's published wording, data or plots
  changed. The page `driftproof view` writes takes the same look's heading size, page width and card
  shadow.
- **A calculator for benchmark gaps.** A new page lets you enter two benchmark scores and a question
  count and see whether the gap between them is bigger than the benchmark's own sampling noise, using
  the same formula the site's reports already use. A second tab reads a set of repeated runs the way
  Driftproof itself judges a lift: a mean plus or minus one standard deviation.
- **A new report: Claude Haiku 5.5 on release day.** Same test suite and method as the previous Haiku
  report, run against Claude Haiku 4.5, with Claude Sonnet 5.5 and Claude Opus 5.5 as comparison rows.
  On Claude Haiku 5.5, no skill clearly helped in most runs; the opening and the full tables are on the
  site.
- **A maintainer page, and smaller site updates.** The site names its maintainer on a new page, its
  list of fixes contributed to other evaluation tools is rewritten, the paper page carries a dated note
  on what has happened since publication, and four long page titles are shortened.

### What may change for you

- **Importing from skill-creator's benchmark format no longer reports a skewed lift.** When the
  source file scores an eval in one arm only, or with a different number of expectations between its
  two arms, the import now leaves that eval out of both arms' figures and the delta. Its rows stay in
  the receipt, listed as excluded with the reason. Earlier imports could report a delta pulled off by
  exactly this kind of mismatch.
- **A name, issue number or GH-reference inside a receipt no longer pings anyone or links an issue on
  GitHub.** The Action's pull request comment and job summary now put this text in a code span, so
  GitHub renders it as plain text instead of a mention or a link. See Known issues: this was measured
  against a model of how GitHub renders, not against GitHub itself.

### Known issues

- **Unpaired evals from `claude plugin eval` still pool into the aggregate.** Only the skill-creator
  importer excludes an eval scored in one arm only, or with mismatched expectation counts between
  arms, from the aggregates this release. The same mismatch in a `claude plugin eval` import can still
  skew the reported delta.
- **Cases from a skill that does not exist.** On the command line, `driftproof init <new folder>
  --cases <file> --drafted-from-skill` creates a stub `SKILL.md` and labels the suite and each case as
  drafted from the skill and approved by the user, though there was no skill to draft from. The
  plugin never takes this route.
- **A lost-answer reading still has edges.** A bare "Created `report.md`." beside a pleasantry, a
  reply that opens with a title, and some code names that end in a file extension can still be read the
  wrong way. They are named in the engineering log below.
- **Backslashes in the stale summary.** A path or model id that holds a backslash shows it doubled in
  the stale summary's code cells.
- **`driftproof view` and a bad `capture` value.** A `.driftproofrc` in the working directory with
  `"capture": "both"` makes `view` list the receipt as not read, where `stale` and `run` exit 2.
- **One check clears at the publish.** The plugin's check that its package matches the published npm
  package can read only after 0.16.0 is on npm.

### Upgrade

- npm: `npx driftproof@0.16.0`. The Action: `driftproofhq/driftproof@v0.16.0`, and the stale Action
  `driftproofhq/driftproof/stale@v0.16.0`.
- Claude Code plugin: `claude plugin update driftproof@driftproofhq`. The plugin runs `npx
  driftproof@0.16.0`, and `/driftproof:start` needs a runner at 0.14.0 or later.
- Receipt spec is unchanged at v0.11. Receipts from earlier versions still validate. A workflow that
  does not set any new option behaves as on 0.15.0, except for the two changes listed under What may
  change for you.

### Engineering log

**`package.json` reads 0.16.0**, and `config.js`'s `RUNNER_VERSION` is held equal to it, the only
place the version is typed. The Action pins in `README.md` are `@v0.16.0`, and so is
`examples/workflows/driftproof-stale.yml`'s `stale@v0.16.0` pin. The plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.16.0, and so is the npx pin in
`plugin/driftproof/README.md`. `plugin/driftproof/version-guard.json` carries `minimum` 0.16.0 and
`resolved_by` 203c91d7, the version bump commit; `start_minimum` stays 0.14.0, unmoved since the
release that first shipped `init --cases` (DECISIONS C-278). `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut, because `runner_version` is
inside the canonical receipt that hash is taken over. `docs/data/stats.json`, `docs/index.html`,
`docs/data/page-dates.json` and `docs/sitemap-receipts.xml` are regenerated by their generators.
**Not yet on npm** at the bump; a Published section is added here after the publish. No published
receipt, number or verdict changes in this release; the importer-pairing fix below changes how a
future `driftproof import --from skill-creator` run computes its own delta, not anything already on
the site.

**The site (specs 169, 170, 167, 166, PRs 67, 61, 46, 42).** Spec 170 is the restyle: the dark shell
and paper-colored evidence cards, folded in with spec 167's benchmark gap calculator (a page that
reads two scores and a question count against the benchmark's own sampling noise, and reads a set of
repeated runs by Driftproof's own band rule). Spec 169 replaces the upstream-fixes list with the
"Fixes merged into other evaluation tools" list, adds the `/maintainer/` page and the paper's
"Since publication" note, and shortens four page titles. Spec 166 is Report 014 (Claude Haiku 5.5),
run with the same suite and method as Report 013, Claude Sonnet 5.5 and Claude Opus 5.5 as comparison
rows, and a fresh-context claims review that found and fixed three blocking wordings before publish.
None of these four touch the runner, the CLI or a published report's existing numbers; the report
spend was about USD 41.5 estimated API-equivalent against the operator's USD 15 figure, because the
judge needed more draws on Haiku (PR 42).

**Two bug fixes, each closing a Known issue from 0.15.0 (specs 049, 144, PRs 64, 65).** Spec 049's
amendment pairs evals by (eval id) at import for the skill-creator format: an eval scored in one arm
only, or whose two arms disagree on their expectation count, is excluded from both arms' aggregates
and the delta, listed in `excluded_cases` with a notice. `claude plugin eval` imports are not covered
(see Known issues). Spec 144's amendment A-144-3 adds a pass after the existing markdown escaper that
puts any `@handle`, or a `#` or `GH-` before a digit, into a code span; `@org/team`, `owner/repo#2` and
email addresses are left whole. The fix is checked against spec 144's own model of GitHub's rendering,
over 16 hostile names, not against GitHub itself; a scratch comment to confirm it against GitHub is
still open for the operator (PR 65).

**The plugin self-test, red since 0.14.0 (issue 56 and its follow-ups, issue 20, PRs 57, 58, 66).** The
public repository's self-test calls `node tests/gate.js` without the source tree's `--scan-root .`,
which read the published-tree guards as failing rather than not applicable (PR 57, closes #56 and
#20); on driftproof-source, a depth-1 checkout hid the same guards' own read of the source tree's
history, fixed by fetching full history there only (PR 58). The public self-test's nested gate then
surfaced a real failure the probe's truncated output had hidden: the budget-guard check calling a
non-stub run without `--trusted-skill`, which the CLI's isolation preflight refused (exit 2, not the
expected exit 3) when the eval account does not exist on a GitHub-hosted runner. The probe now reports
the nested gate's failing lines, and the check passes `--trusted-skill` (PR 66).

**Gate reliability (specs 139, 029, and the shared `grep -q` fix, PRs 32, 38, 33).** Spec 139's AC-8
reads `start_minimum` as a bound against `RUNNER_VERSION`, not an equality, so a runner above the
recorded minimum no longer reads unreadable outside the one release that sets it (issue 30). Spec
029's sharded sweep now excuses a gate's nested write into any swept gate's own `evidence/` directory,
not only the shard that happened to run both gates together (issue 37). Across specs 005, 006, 007,
008, 009, 011, 012, 013, 023 and 024, a `printf "%s" "$out" | grep -q PATTERN` pipeline under
`pipefail` could read red on a SIGPIPE race under sweep load though the pattern was present; the fix
drops `-q` and pipes to `/dev/null`, and the repository gate now fails the idiom on sight (issue 31).
None of these three loosen an assertion, a pattern or a criterion.

**Pipeline and workflow changes, none of them shipped in the npm package (specs 168, and issues 43,
48, 52, PRs 59, 44, 49, 53).** `release.yml`'s header comment is corrected, its registry-wait retries
up to 20 times at 30 seconds and warns rather than fails when a version has not yet propagated, and it
compares rather than overwrites an existing GitHub release (spec 168, issue 40). The build, review and
fix-on-red workflows' turn cap for product and T1/T2 work moves from 40 to 120, by the operator's
ruling of 8 Oct 2026; class:internal builds stay at 60 (issue 43, Decision C-32 updated). The build and
release-train workflows use the repository's `ANTHROPIC_API_KEY` secret when it is set and the
subscription token otherwise, with the credential used named in the run log, never its value (issue
52). Most of driftproof-source's GitHub-hosted jobs move to the box's self-hosted runners, except the
action self-test (hostile inputs by design) and the public-push job (holds the push token); about 576
of 612 measured Actions minutes move off the hosted quota (issue 48).

**The release sweep's reds (issue 69, PR 70).** The first sweep on the release branch read eight gates
red, all from merges in this release. `CLAUDE.md` went over spec 048's word limit and off spec 162's
pin after spec 170's one added line; five filler words are trimmed and A-162-4 moves the pin. Spec
119's page record predated Report 014's pages and the restyle; it is re-recorded by its own probe
(A-119-7), and no verdict, state or badge moved. `lib/view-tokens.js` takes the restyle's three changed
tokens, as spec 128 requires. Spec 169's scope check read later merges as its own and now reads its
own range (A-169-1). `scripts/nightly.mjs` copied a later spec's ignored inputs into a sweep of an
older commit, where they read as untracked and the emitter refused; it now copies an input only where
the swept tree ignores it too, and spec 148's M-29 plants the nightly under test (A-148-5). The second
sweep read no gate red and one new CodeQL result, in a test line of issue 41's that built a hostile
name's escaped form with a regex replace; the test now builds the same strings character by character
(issue 71, PR 72). None of these loosens a criterion, and the CodeQL baseline is unchanged.

#### The 0.16.0 merge list

Eighteen merges since v0.15.0's source commit `dc2008fd`, oldest first (the nineteenth, `4ab6f0d5`,
is the `release/v0.15.0` branch merged back into `dev` and carries no change of its own):

- 139 (amendment, issue 30): AC-8 reads `start_minimum` as a bound, not an equality.
- 005/006/007/008/009/011/012/013/023/024 (gate fix, issue 31): the `pipefail`/`grep -q` race.
- 029-scanner-loop (amendment, issue 37): the sharded sweep's nested-write join.
- 166-report-014-haiku-5-5 (issue 34): Report 014, Claude Haiku 5.5 on release day.
- turn caps (issue 43): 40 becomes 120 for builds, reviews and fixes.
- 167-benchmark-gap-calculator (issue 39): the benchmark gap calculator page.
- self-hosted runners (issue 48): hosted Actions jobs move to the box, except two.
- build credential fallback (issue 52): `ANTHROPIC_API_KEY` when set, the subscription token otherwise.
- plugin self-test fix (issue 56, 20): the public self-test's gate call matches the repository gate's.
- plugin self-test fix, follow-up (issue 56): full-history checkout on driftproof-source.
- 168-release-yml-cleanup (issue 40): the header comment, the registry-wait retries, the release compare.
- 170-site-restyle (issue 50): the dark shell and paper evidence cards, with the benchmark calculator folded in.
- 049-anthropic-formats-importer (amendment, issue 11): unpaired or unequally graded evals excluded from the aggregates.
- 144-pr-comment-escaping (amendment, issue 41): mentions and issue references put into code spans.
- plugin self-test fix (issue 56): the published tree's own gate no longer needs the box's eval account.
- 169-site-update (issue 60): upstream credits, the maintainer page, the paper's status note, four shortened titles.
- release sweep fixes (issue 69): `CLAUDE.md` re-pinned, spec 119's page record, the view's tokens, spec 169's range, the nightly's input copy.
- release sweep fix (issue 71): issue 41's test line rewritten so CodeQL reads no incomplete escaper.

**Out of 0.16.0.** The `claude plugin eval` import format's own unpaired-eval pooling (named but not
fixed alongside spec 049, see Known issues). The scratch-comment confirmation of spec 144's fix against
GitHub itself, left open for the operator.

---

## v0.15.0 - 2026-10-07

### What's new

This release is internal pipeline work, with no user-facing change. It ships no new feature,
command, flag or Action input. Every change in it builds this project's own release pipeline,
fixes defects in its internal gates and tests, or clears long-standing red gate rows. `driftproof run`, `decide`, `stale` and
`view`, the Action and the plugin all behave exactly as they did on 0.14.0.

### What may change for you

- **The receipt spec document now says what driftproof actually does.**
  `spec/RECEIPT.md` said "v0.4 receipts remain producible and readable." That stopped
  being true once v0.5 shipped: driftproof emits receipts at the current schema version
  only, and an older version stays readable, checked against its own schema. The
  sentence now says so. The methodology page carries the same correction. Neither page
  changes what a receipt validates against or what any tool does; both now describe it
  correctly.
- **The interoperability page's schema version is generated, not typed.** `docs/interop.md`
  named the receipt spec as "v0.4" after the schema had moved to v0.11. The page now
  takes that number from `spec/receipt.schema.json`'s `schema_version` on every site
  build, so it reads v0.11 today and cannot name a stale version again.

### Known issues

- **Cases from a skill that does not exist.** On the command line, `driftproof init <new folder>
  --cases <file> --drafted-from-skill` creates a stub `SKILL.md` and labels the suite and each case as
  drafted from the skill and approved by the user, though there was no skill to draft from. The
  plugin never takes this route.
- **A lost-answer reading still has edges.** A bare "Created `report.md`." beside a pleasantry, a
  reply that opens with a title, and some code names that end in a file extension can still be read the
  wrong way. They are named in the engineering log below.
- **Mentions and issue references still fire.** Measured on GitHub on 6 Oct 2026: in a comment, an
  escaped `@name` still renders as a user mention, and an escaped `#1` or `GH-1` still renders as an issue
  link. HTML, Markdown links, bare URLs and character references render as plain text. The fix is planned
  for the next release.
- **Backslashes in the stale summary.** A path or model id that holds a backslash shows it doubled in
  the stale summary's code cells.
- **`driftproof view` and a bad `capture` value.** A `.driftproofrc` in the working directory with
  `"capture": "both"` makes `view` list the receipt as not read, where `stale` and `run` exit 2.
- **One check clears at the publish.** The plugin's check that its package matches the published npm
  package can read only after 0.15.0 is on npm.

### Upgrade

- npm: `npx driftproof@0.15.0`. The Action: `driftproofhq/driftproof@v0.15.0`, and the stale Action
  `driftproofhq/driftproof/stale@v0.15.0`.
- Claude Code plugin: `claude plugin update driftproof@driftproofhq`. The plugin runs `npx
  driftproof@0.15.0`, and `/driftproof:start` needs a runner at 0.14.0 or later.
- Receipt spec is unchanged at v0.11. Receipts from earlier versions still validate. A workflow that
  does not set any new option behaves as on 0.14.0, except for the two documentation corrections above.

### Engineering log

**`package.json` reads 0.15.0**, and `config.js`'s `RUNNER_VERSION` is held equal to it, the only
place the version is typed. The Action pins in `README.md` are `@v0.15.0`, and so is
`examples/workflows/driftproof-stale.yml`'s `stale@v0.15.0` pin. The plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.15.0, and so is the npx pin in
`plugin/driftproof/README.md`. `plugin/driftproof/version-guard.json` carries `minimum` 0.15.0 and
`resolved_by` 6dec3675, the version bump commit; `start_minimum` stays 0.14.0, because it is written
once, at the release that first ships `init --cases`, and is never moved after (issue 14, DECISIONS
C-278). `package-lock.json` moves with them, and `tests/fixtures/export-summary.snapshot.json`'s
`receipt_hash` is re-cut, because `runner_version` is inside the canonical receipt that hash is taken
over. `docs/data/stats.json`, `docs/index.html`, `docs/sitemap.xml`, `docs/sitemap-pages.xml` and
`docs/sitemap-receipts.xml` are regenerated by their generators. **Not yet on npm** at the bump; a
Published section is added here after the publish.

**This is the first release run by the new GitHub pipeline (DECISIONS C-272 to C-277).** The pipeline
itself (workflows, `scripts/pipeline.mjs`, the gate map, `CLAUDE.md`, the DECISIONS catalogue and
`release.yml`) merged at `6cf50c9d` (`decisions(pipeline)` `337c0d6d`; approvals of specs 162 and 048
at `d372b695`; spec 028's A-028-54/A-028-55 and spec 000-governance carry no approval, ruled internal
tooling). The release train starts only on the operator's comment "release" on issue 10 or the Digest
discussion, answers on the same thread, and reads its baseline from `release-record.json`'s
`source_commit`; there is no schedule (`cf33f9d`, decisions `780e568`/`1e151e0`). A called workflow
inherits its caller's event, so nothing that calls the build is push-triggered (`0975381`).
`release-prepare` writes the version bump, the derived pages and `release-record.json` by script,
verified by an oracle that reproduces the 0.14.0 release commit; the model that drafts this file writes
only the notes, and pushes use the job token (`79d79c5`). Its freeze stage re-cuts the baselines a
version bump forces, run after the notes are pushed and proved by the same oracle (`60c7c7b`, C-276).
`PYTHONUSERBASE` now points at the real home before `HOME` is isolated, so Pillow can draw the receipt
cards (`8ac202c`). Builds and fixes run on `claude-sonnet-5` whatever their class, to hold weekly usage
under its limit (`53154fd`); a build that stops before it finishes pushes its edits as a wip commit and
the retry resumes from them (`d77ae37`); class:internal builds get 60 turns, product and release stay
40 (`f5ba1f8`); Claude-action jobs run with an isolated `HOME` (`0063ddd`); `QUEUE_ONLY` limits the queue to named issues (`46d8006`).
On the review side: the review and fix-on-red workflows allow the claude bot (`a23fa7c`); the approve
job reads checks and statuses and waits for the gates check of its own commit (`e92edae`); the review
workflow hands the reviewer the gates check in a file (`d606bb3`); a planned list over 15 gates goes to
the sharded sweep (`1eda6f0`); the sweep's matrix output is only `include`, since a top-level `gates`
key made GitHub create no shard job (`67766bc`); a pull request's own gates run only the gate commands
its issue names, plus the repository gate, and the full sweep runs only inside the release train
(`a38c978`); fix-on-red reacts only to a failed gates check (`0d531a2`).

**The fourteen long-standing red gate rows named in the 6 Oct program close in one staging batch**
(`ffd97d5d`, `decisions(part1)` `d368867`), each approval approved-with-findings, 0 blocking, in a
fresh context: specs 002, 004 (the readability amendment), 005, 006, 007, 008, 011, 013, 014, 015, 016,
017, 048 and 162. Spec 014's row is a loosening of `spec/RECEIPT.md`, recorded as the one documentation
correction under What may change for you (DECISIONS C-3). A red held by its own named, unexpired cause
(a publish-bound hold) now reads as expected, not new and not green (`3b2bfbe`).

**The release train could not read GREEN until issues 14, 15 and 16 merged (DECISIONS C-277).**
start_minimum's set-state check moves from an equality to a bound in the shipped tests and in specs
138, 139, 140 and 165, so a later patch's `RUNNER_VERSION` no longer reads them UNREADABLE (issue 14,
PR 18; the companion fix to the probes of specs 139, 140 and 165, issue 17, PR 25; DECISIONS C-278); a
held UNREADABLE row with its own unexpired hold reads held-red rather than a new red (issue 15, PR 21;
DECISIONS C-279); spec 027's gate declares its own 50-minute timeout, so a declared limit only ever
widens the flat sweep limit, never shortens it (issue 16, PR 24). Two more fixes landed in the same
window: spec 011's call-site reader widens to `.mjs`/`.cjs` files and spec 038's probe gains a link
reader at both its call sites (issue 2, PR 3); and the repository gate now fails a gate or probe that
types the current release version on a code line, except the files the freeze table names, with a
mutation arm and a comment-line arm (issue 23, PR 27, DECISIONS C-276).

#### Known open

- The lost-answer edges named above (spec 141's F-1 to F-6, carried from the 0.14.0 approval of
  `db299e41`) are unchanged this release.
- Spec 144's mention and issue-reference rendering (F-1, approval `b7dc95f2`) is unchanged; its fix is
  planned for the next release.
- Spec 028's NFR-7 is held red again, this time by a named cause: `spec/RECEIPT.md` differs from the
  published 0.14.0 by the row 7 correction this release makes, which 0.14.0 does not carry. It clears at
  the next publish.

---

## v0.14.0 - 2026-10-06

### What's new

- **Start from a skill you already have.** In Claude Code, `/driftproof:init` or `/driftproof:run` on a
  skill that already exists now offers the first-run path: Claude drafts test cases from the skill with
  you, adds them to the skill's folder only after you say yes, runs a quick first look, and opens a
  results page from disk. `/driftproof:start` is the same path under its own name: with no folder it
  lists the skills it finds and whether each has test cases. The README's Quickstart now leads with
  this path, and the scaffold for a new skill is the second path.
- **A quick first run.** `driftproof run <skill> --quick` runs a short smoke test: 2 judge samples, 4
  calls at a time and at most 5 test cases. Its receipt says it cannot produce a verdict, and its output
  prints no lift and no result word. Use it to see that the setup works; run without `--quick` for a
  result you can rely on.
- **Add test cases to a skill that exists.** `/driftproof:init` can add one new file, `evals/evals.json`,
  to a skill folder, only after you say yes. It never changes your `SKILL.md` or any other file in the
  folder.
- **Run a skill you wrote outside a git repository.** `/driftproof:run` takes `--trust-outside-repo`,
  which you give once you confirm you wrote the skill. A missing isolation account now gets one plain
  message that names this route.
- **Fewer real answers are thrown out as lost.** A draw is now counted as lost only when its reply
  points at a file the judge was not shown. File lists in commit or pull request text, answers inside a
  fenced block and first-person advice are no longer read as lost answers. In `--capture files` mode, a
  model that writes its answer to a file and replies with nothing is graded on the file, and in text
  mode the tools that can write files or run code are off.
- **Clearer words when the cases disagree.** When the test cases disagree so much that more draws
  would not settle the result, the result now says "More cases, not more draws, are needed to conclude
  at this effect floor". "Not enough draws" is kept for the case where more draws would help.
- **Safer pull request comments and job summaries.** The Action's comment and summary, and the stale
  Action's summary and issue, now escape HTML, Markdown links and URLs in every string that comes from a
  receipt or a folder, so a case id or file name that holds them reads as the characters it is. Mentions
  and issue references are not covered yet: see Known issues.
- **The stale check reads the capture mode.** `driftproof stale` treats the capture mode (text or
  files) as one more thing that can make a receipt out of date, beside the model, the skill and the
  harness.
- **Better docs.** The README now explains how to read what a run prints, what `--capture` changes and
  what `/driftproof:run` takes. `driftproof view` labels a receipt from before the `answered_by` field
  existed as "Recorded before answered_by existed", where it said "Not measured".
- **Dependency and code scanning fixes.** The lockfile's `fast-uri` is 3.1.8, and the CodeQL alerts
  open at the cut are fixed in code.
- **Published reports gain dated notes.** Reports 001 to 005, 007 and 008 each gain a dated note, and
  Report 007 gains three dated corrections to its judge cost figures. No published number is changed.

### What may change for you

- **`/driftproof:init` on a skill that already exists, with no flags, now refuses and writes
  nothing.** It exits with 2 and says it would add `evals/evals.json` to the skill, and that it adds a
  file to a skill folder only with your yes. To add drafted test cases to a skill that exists, give the
  drafted cases with `--cases <file>` and your yes with `--confirm-write`:
  `/driftproof:init <skill folder> --cases <file> --confirm-write`. `--confirm-write` alone adds
  placeholder example cases, and `--cases` without it is refused. A skill that already has test cases
  gets its quick run through `/driftproof:start <skill folder>`, which runs them and adds nothing.
  The command line's `driftproof init <folder>` on a folder that holds a `SKILL.md` adds
  `evals/evals.json` only, never your `SKILL.md`, and no longer writes a `.driftproofrc` there.
- **The stale check now says "advisory" for a receipt with no capture field.** Every receipt made
  before receipt spec 0.10 has none. A scheduled stale Action on such a receipt now reads advisory
  (exit 3) where it read current, and with `strict` it reads stale and opens an issue. To clear it, run
  again: a receipt from this release records its capture mode.
- **The README's Quickstart link has a new anchor.** The heading is now "Quickstart: receipt for your
  own skill", so a link that ends `#quickstart--receipt-for-your-own-skill-in-10-minutes` needs
  `#quickstart-receipt-for-your-own-skill`. The published 0.13.0 page keeps the old anchor.
- **Some words on the view page, the pull request comment and the job summary change.** For a receipt
  from before `answered_by` existed, the label moves from "Not measured" to "Recorded before
  answered_by existed". 129 of the 262 receipts in this repository are in that state, and no verdict
  moves. The site's receipt pages still say "Not measured" for them. Three receipt pages that show a
  one-case verdict now say it is for one case, on one test task.
- **Receipts written by this release are receipt spec v0.11.** v0.11 adds an optional `run.preset`,
  `"quick"` on a smoke run's receipt, and such a receipt cannot read as a measured result. v0.10 is
  frozen as `spec/receipt.v0.10.schema.json`, and every earlier receipt still validates against its
  own version.
- **No published receipt, number or verdict changes.** Reports 001 to 005, 007 and 008 gain a dated note,
  Report 009's opening gains one line, and Report 007's three judge cost figures are left as published,
  with a dated correction under each. No receipt file changes.

### Known issues

- **Cases from a skill that does not exist.** On the command line, `driftproof init <new folder>
  --cases <file> --drafted-from-skill` creates a stub `SKILL.md` and labels the suite and each case as
  drafted from the skill and approved by the user, though there was no skill to draft from. The
  plugin never takes this route.
- **A lost-answer reading still has edges.** A bare "Created `report.md`." beside a pleasantry, a
  reply that opens with a title, and some code names that end in a file extension can still be read the
  wrong way. They are named in the engineering log below.
- **Mentions and issue references still fire.** Measured on GitHub on 6 Oct 2026: in a comment, an
  escaped `@name` still renders as a user mention, and an escaped `#1` or `GH-1` still renders as an issue
  link. HTML, Markdown links, bare URLs and character references render as plain text. The fix is planned
  for the next release.
- **Backslashes in the stale summary.** A path or model id that holds a backslash shows it doubled in
  the stale summary's code cells.
- **`driftproof view` and a bad `capture` value.** A `.driftproofrc` in the working directory with
  `"capture": "both"` makes `view` list the receipt as not read, where `stale` and `run` exit 2.
- **One check clears at the publish.** The plugin's check that its package matches the published npm
  package can read only after 0.14.0 is on npm.

### Upgrade

- npm: `npx driftproof@0.14.0`. The Action: `driftproofhq/driftproof@v0.14.0`, and the stale Action
  `driftproofhq/driftproof/stale@v0.14.0`.
- Claude Code plugin: `claude plugin update driftproof@driftproofhq`. The plugin runs `npx
  driftproof@0.14.0`, and `/driftproof:start` needs a runner at that version or later.
- Receipts from earlier versions still validate. A workflow that does not set the new options behaves
  as on 0.13.0, except for the changes listed under What may change for you.

### Engineering log

**`package.json` reads 0.14.0**, and `config.js`'s `RUNNER_VERSION` is held equal to it, and is the
only place the version is typed. The Action pins in `README.md` and `docs/index.html` are `@v0.14.0`,
`README.md` and `examples/workflows/driftproof-stale.yml` pin `stale@v0.14.0`, the plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.14.0, and so is the npx pin in
`plugin/driftproof/README.md`. `plugin/driftproof/version-guard.json` carries `minimum` 0.14.0,
`start_minimum` 0.14.0 (null before this release; `/driftproof:start` refuses on a runner below it),
and `resolved_by` b0c11fa3, derived with `git log -1 -S "RUNNER_VERSION = '0.14.0'" -- config.js`.
`package-lock.json` moves with them by `npm version` offline, only its two version fields.
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut by script before the bump,
because `runner_version` is inside the canonical receipt that hash is taken over. The receipt pages'
`npx driftproof@<version> validate` command names 0.14.0 (158 pages, `scripts/build-receipt-pages.js`).
`docs/data/stats.json`, `docs/index.html` and `docs/sitemap.xml` are regenerated by their generators.
**Not yet on npm** at the bump; a Published section is added here after the publish.

The re-freezes the bump forced, each by the sibling's next amendment, none checking less: spec 139's
A-139-9 (AC-8, AC-11, DR-43f and `tests/start.test.js` read the set `start_minimum`, and the null and
above-runner states still read as refusals), spec 020's amendment 98 (the README body baseline, by
script), spec 026's A-026-35 (AC-17's RUNNER_VERSION) and the captures of specs 025 and 037 re-taken under
the browser lock. The gate figures are in the `evidence(0.14.0)` commit that follows.

#### The 0.14.0 spec list

Twenty merges, read from `git log --first-parent --format=%s main..97cd6fc0 | grep '^merge(spec '`, oldest first:

- 141-lost-answer-narrowing: a draw counts as lost only when its reply truly points at a file the judge was not shown, and a model that writes its answer to a file is graded on that file.
- 142-public-claims-patch: the site's public claims name where they come from, and the published site carries no internal path or name.
- 143-cases-not-draws: when the cases disagree, the words say more cases are needed, not more draws.
- 144-pr-comment-escaping: the pull request comment and the job summary escape every string a receipt supplies.
- 148-codeql-zero-and-local-scan: the CodeQL alerts are fixed in code, and a local scan in the release sweep stops the release on the next new one.
- 147-fast-uri-3-1-8: the lockfile's fast-uri moves to 3.1.8.
- 145-user-docs-and-view-label: the README explains the run options, and the view page labels a receipt recorded before answered_by existed.
- 139-quick-and-guided-first-run: a quick smoke run (`--quick`) and a guided first run in the plugin (`/driftproof:start`).
- 146-stale-capture-axis: stale reads the capture mode as an axis beside model, skill and harness.
- 140-init-existing-and-trusted-outside-git: init adds test cases to a skill that exists after a yes, and the trusted lane runs outside a git repository after a confirmation.
- 161-report-corrections-interim: dated notes on Reports 001 to 005, 007 and 008, and three corrected judge cost lines on Report 007.
- 162-nightly-reds-3-oct: four reds of the 3 Oct nightly are fixed by their specs' next amendments.
- 129-visual-checks-before-approval: a layout or visual spec runs its browser checks in the build and every fix round, and its approval reads their current results.

- 068-integrator-intake-digest-budget: the integrator's intake, digest and budget guard.

- 109-driver-refuses-owed-rulings: the driver refuses to merge on a ruling the approval leaves owed.
- 163-codeql-four-new-alerts: the four new CodeQL alerts of the 3 Oct 2026 scan are fixed in code.
- 164-approval-path-tilde: the driver reads the approval record it stored in its ~ form.
- 115-approval-cites-own-commit-receipt: approval sessions read `private`, and an approval cites the receipt of its own commit.
- 113-public-history-fast-forward: the public repository keeps its history, and each public push is one fast-forward commit.
- 165-first-receipt-from-existing-skill: a first receipt from an existing skill, led from `/driftproof:init` and `/driftproof:run`.

**Out of 0.14.0.** Spec 120 and every later spec go to the next release. Spec 114 (the integrator
inherits chain rules) stays parked, with its open defects. Spec 136 (release automation) is not built.

#### What each change reads from

- **The first-run path (165, 139, 140).** `plugin/driftproof/lib/door.mjs` and
  `plugin/driftproof/commands/{init,start,run}.md`. The door's refusal on a skill that exists with no
  flags reads *init would put evals/evals.json into the skill at <dir>, as the one new file <dir>/evals/evals.json,
  and adds a file to a skill folder only with the person's yes ... Nothing was written and nothing was
  spawned.* The flags are `--cases`, `--confirm-write` and, for the CLI, `--drafted-from-skill`
  (`bin/driftproof`, `lib/init.js`). The `--quick` preset is `lib/firstrun.js` `QUICK`: samples 2,
  concurrency 4, max cases 5.
- **Lost answers and capture (141).** `lib/capture.js`; spec 141's R-1 to R-12.
- **Words (143).** `lib/verdict.js` `CASES_LINE`. The one published-receipt census read 206
  published receipts with 0 state moves and 0 wording moves
  (`specs/143-cases-not-draws/evidence/wording-moves.json`). `action.yml`'s `fail-on-underpowered`
  description names both lines.
- **Escaping (144).** `lib/decision.js` and `lib/plain.js`; the stale Action's summary and issue.
- **Stale (146).** `lib/stale.js`, `spec/stale.v1.schema.json` (the axis `capture`), `stale/run.mjs`.
- **View label (145).** `lib/plain.js` `LABELS.PRE_ANSWERED_BY`. The words-that-change table is
  `specs/145-user-docs-and-view-label/PACKET.md` § Words that change: 129 of 262 receipts move
  `NOT_MEASURED -> PRE_ANSWERED_BY`, 0 verdicts or routes move.
- **Public claims (142).** The builders and data files; three receipt pages gain one line, "This verdict
  is for one case, on one test task; it does not show how the skill does on other tasks."; Report 009's
  opening gains one line naming the plugin eval's results.
- **Reports (161).** `docs/reports/001`, `002`, `003`, `004`, `005`, `007` and `008` each gain a dated note under the
  headline ("Note, 2026-10-03") and a dated entry under Amendments; Report 007 gains three dated
  corrections under its judge cost figures ($8.047195, $7.634930 and $13.737220, against the published
  $2.601445, $2.313420 and $3.253265); the published figures are unchanged. The `git diff main..97cd6fc0
  -- docs/reports receipts docs/r` shows no changed receipt file, and its only removed lines are the
  `dateModified` fields.
- **Dependency and scanning (147, 148, 163).** `package-lock.json`'s `fast-uri` is 3.1.8. The release
  sweep runs the local CodeQL scan, and a new alert stops the release.
- **Receipt spec v0.11 (139).** `spec/RECEIPT.md`, `spec/receipt.schema.json`,
  `spec/receipt.v0.10.schema.json` (new, the freeze).

#### The real run of the first-receipt path

Spec 165's probe ran for real on 2026-10-05: start 19:34:37Z, end 19:53:22Z, elapsed 1125 seconds,
exit 0, receipt `commit-message-conventions-claude-haiku-4-5-quick-2026-10-05-6e79249ef0ec.json`
(log `/var/tmp/driftproof-165-real.log`, 159 calls, a smoke run that printed no verdict). It makes no new
public claim beyond what spec 165 ships.

#### Known open

- Spec 165, from its approval of `1bb5e9c8`: F-1 AC-6's element is read from a comment; F-2 AC-5 and
  NFR-4 have subjects with no plant; F-3 the label is written on a new scaffold (the user section's
  first known issue); F-4 `spectrace` reads two orphan ids.
- Spec 141's F-1 to F-6, each non-blocking (approval of `db299e41`): F-1 a bare claim or a Changes list
  beside one status or pleasantry line reads judged; F-2 a code name whose last segment is a document
  extension or `env` still reads as a file pointer; F-3 a reply that opens with an ADR title reads as a
  commit subject; F-4 and F-5 test scope; F-6 the wording of a long first file name in a reason.
- Spec 144's F-1 to F-4 (approval of `b7dc95f2`): F-1 measured on GitHub on 6 Oct 2026 (a scratch
  comment, rendered through the API, then deleted): a backslash-escaped `@name` still renders as a
  mention and escaped `#1` and `GH-1` still render as issue links (fail); HTML, Markdown links, bare URLs
  and character references render as plain text (pass). The next release's 144 amendment wraps
  mention-like and reference-like strings in code spans and is measured on GitHub before it is claimed; F-2 and F-3
  traceability and plan text; F-4 the stale summary's code cells double a backslash.
- Spec 146's F-1 to F-8 (approval of `8edc0d82`), each non-blocking; F-8 is that `driftproof view` lists
  a receipt as not read under a working-directory `.driftproofrc` with `"capture": "both"`, where `stale`
  and `run` exit 2.
- Spec 136's F-1 to F-4 are not in this release, because 136 is not.
- Spec 028 NFR-7 reads red until 0.14.0 is on npm, because it compares this checkout with
  `npm pack driftproof@0.14.0`. It is re-run after the publish, never before.

#### Not in this release

Specs 120 onward, spec 114 (parked) and spec 136 (not built), as listed above. A Published section is
added after the publish.

### Published

**`driftproof@0.14.0` is on npm**, published 2026-10-06 at 03:48:45 UTC, `latest`, and its `gitHead`
is `d56665c`, the published repository's commit that the `v0.14.0` tag points at, built from source
commit `1ccbb72f`. The registry records its tarball's shasum as `1af08cd3274f7545c097382dac2b624502b29a6d`
and its integrity as
`sha512-9kFwZFy9spF4pElUXalU/mMky+yFYJJI0qwNRr07p9kUYzOD1jkHeekkxd+47tBuVV/RvnGaZVPZeb2Nayqc9g==`, and
`dist-tags` reads `{"latest":"0.14.0"}`. A clean-directory `npx -y driftproof@0.14.0 --version` prints
`0.14.0`.
**The published repository's `main` and `release` branches** are at `d56665c`, one fast-forward commit
on `b88f391` (spec 113), and the `v0.14.0` tag (object `6863c97`) points at it. The `release` branch is
the one the plugin directory tracks.
**The GitHub release `v0.14.0`** was published at 04:02:58 UTC. Its body states the measured result of
the escape check.
**GitHub Pages deployed** `d56665c`: deployment `6875275531` (`github-pages`) reached `success` at
03:55:09 UTC, and the live homepage carries the `@v0.14.0` pin.
**The notes were narrowed before the publish.** Spec 144 F-1 was measured on GitHub on 6 Oct 2026: an
escaped `@name` still renders as a mention and escaped `#1` and `GH-1` still render as issue links;
HTML, Markdown links, bare URLs and character references render as plain text. This file and the
release body were changed at `1ccbb72f`. The gates that read this file re-ran green there, the
repository gate read 668/668 on a clean tree, and the public tree was rebuilt (647/647). The first
build, `3c01213`, was never pushed.
**Release-bump allowances.** Four gate changes made after the release sweep are accepted as bounded
release-bump allowances, not as tightenings: A-125-19, A-126-16, A-145-8 and A-146-4. Each lets only
the version strings the release bump writes move; each string is found once in the Base, and both
versions are read from the two `config.js` files. The next release reuses them.
Read after the publish at the source commit `1ccbb72f`, spec 031's gate reads **9 GREEN**, its AC-1 and
AC-2 green through `npx driftproof@0.14.0`. Spec 028's reads **20/21 pass, 1 fail**: NFR-7 still fails,
now because its shim substitutes `config/codeql.json` and `config/codeql-baseline.json`, which spec 148
added and which `package.json`'s `files` leaves out of the package. The package is as intended; the
gate's reading is corrected by an amendment in the next release.
Evidence: `specs/000-governance/evidence/post-publish-0.14.0.txt`.

---

## v0.13.0 - 2026-10-02

**`package.json` reads 0.13.0**, and `config.js`'s `RUNNER_VERSION` is held equal to it.
The Action pins in `README.md` and `docs/index.html` are `@v0.13.0`, the plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.13.0, and so is the `minimum` in
`plugin/driftproof/version-guard.json`; `examples/workflows/driftproof-stale.yml` pins `stale@v0.13.0`. `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut because
`runner_version` is inside the canonical receipt that hash is taken over. The receipt pages'
`npx driftproof@<version> validate` command names 0.13.0. **Not yet on npm** at the bump; a
Published section is added here after the publish.

This is a minor release because it adds two options, a command, three Action inputs, three options
to the plugin's run, and receipt spec v0.10. Receipts written by 0.13.0 are receipt spec v0.10;
0.12.1's were v0.9. v0.10 adds two optional fields, so a v0.9 receipt restamped `0.10` validates.
v0.9 is frozen as `spec/receipt.v0.9.schema.json`, and every earlier receipt still validates
against its own version.

### What changed

- **You can now fail the job when a verdict cannot resolve (spec 072).** `driftproof decide` takes
  `--fail-on-underpowered true|false`, and the Action takes the input `fail-on-underpowered`. The
  default is `false`, so a workflow that does not set it behaves as on 0.12.1: these decisions warn
  and do not fail the job. Set it to `true` and the job fails on each decision that measured and did
  not resolve:
  - every `UNDERPOWERED` decision: *Not enough draws to conclude at this effect floor*;
  - an `INCONCLUSIVE` decision whose reading rests on lost draws, that is, one that does not hold
    for every score its lost draws could have had (spec 119's rule).

  Each such model fails the job with one `::error` that names it. For an underpowered model the
  line says how many draws per arm it would need, or that no draw count would resolve it at its
  spreads, or, when draws were lost, which ones and that no count is given. For an inconclusive
  model it names the lost draws. An `INCONCLUSIVE` run that did not complete, and `NOT_MEASURED`,
  still do not fail the job on their own. `decide` refuses any value other than `true` or `false`
  with exit 2, naming the flag, before it reads a receipt. `README.md` § What fails the job says
  the same, and its verdict table now lists `UNDERPOWERED`.
- **The lockfile's `fast-uri` is 3.1.7 (spec 123).** `package-lock.json` locked `fast-uri` 3.1.6,
  which two High advisories cover: GHSA-qw65-cvwx-89v3 (versions `>= 3.0.0, < 3.1.7`) and
  GHSA-58mr-gqgx-xq4g (in the 3.x line, `3.1.6` only), both first patched in 3.1.7
  (`specs/123-fast-uri-lockfile-3-1-7/evidence/advisories-20260930T004402Z.json`). The Action
  installs with `npm ci` from this lockfile, so from `@v0.13.0` Action users install 3.1.7. npm
  consumers do not get the lockfile, and a fresh `npm install driftproof` already resolved a
  patched `fast-uri`. `npm audit --package-lock-only --omit=dev` read high 1 at spec 123's Base and
  0 of every severity at the new lock. Neither advisory is reachable from receipt data in
  Driftproof's use, for receipt schema versions 0.1 to 0.9: spec 123's AC-5 installed as the Action
  does and counted `fast-uri` calls while validating every tracked receipt: 1008 calls on the
  receipts as committed, and 0 on the same receipts salted with the advisories' hostile forms
  (`specs/123-fast-uri-lockfile-3-1-7/evidence/reach-20260930T011653Z.json`).

- **You can read results without a terminal (spec 128).** `driftproof view <receipts-dir>` writes
  one HTML page from a folder of receipts, `driftproof-view.html` unless `--out FILE` names another.
  For each skill and model the page shows the result in plain words, the band plot, a timeline when
  there are several receipts, and whether each receipt is up to date by the stale check. `view`
  takes the stale check's options: `--skill`, `--suite`, `--model`, `--judge`, `--harness-version`
  and `--no-harness-check`. The page opens from disk and loads nothing. The command makes no model
  call and no network request. It refuses with exit 2, and writes nothing, when the directory is
  missing or holds no receipts, when it is given a flag it does not take, a flag without its value
  or a second positional, and when `--out` names an existing file it did not write.

- **On a pull request, the Action posts the result as one comment (spec 128).** The Action takes two
  new inputs: `pr-comment`, default `'true'`, and `github-token`, default the job's own token. On a
  `pull_request` or `pull_request_target` event it posts one comment with the result in plain words.
  On each later run with a bot's token, as the default token is, it finds that comment among the
  pull request's first 1,000 comments and edits it, so a pull request holds one comment per skill
  directory. The comment needs a token that holds `pull-requests: write`, which a job grants under
  `permissions:`. Without it, as with a fork's read-only token or on any error from the GitHub API,
  the Action writes one notice, posts nothing, and the run's result is unchanged. The comment step
  runs before the enforcement step with `continue-on-error: true`, and the enforcement step's exit
  is the same with it as without it. Set `pr-comment: false` to turn it off; the step then makes no
  request. On any other event it makes no request.

- **The job summary opens with the result in plain words (spec 128).** `decide --summary` now
  writes one line under its heading, above the table: the model with the lowest result, that result
  in plain words, and whether the run fails the job. It reads the same fail-on inputs as the
  enforcement step; the Action passes both. Spec 128 leaves the table and the lines after it as
  they were. An `UNDERPOWERED` row keeps *Not enough draws to conclude at this effect floor* in the
  table. On the `view` page that line is the detail under the result's sentence; in the comment it
  is the why line under the result's label.

- **A name with a backslash keeps the job summary's columns (spec 111).** `decide --summary` now
  escapes a cell's backslashes before its pipes. On 0.12.1 a model id, a receipt file name or a
  reason that carried `\|` came out as `\\|`. A markdown reader that lets a backslash escape any
  character read that pipe as a column break, so the row gained a column and its decision moved out
  of the Decision column. A reader that escapes only `\|` kept the columns and lost the backslash.
  Now each such row keeps the header's columns and its decision in the Decision column under both
  readings, and a receipt file name or a reason reads back as itself. Spec 111 moves no byte of a
  summary whose names carry no backslash. This is the fix for CodeQL alert #10.

- **The staleness check's summary keeps its columns for a name with a backslash too (spec 132).**
  The stale Action's `cell()` now escapes a backslash before a pipe, as spec 111 does for
  `decide --summary`. On `stale@v0.12.1` an error text that carried `\|` split its row into seven
  cells against the header's six, under a reader that lets a backslash escape any character. A
  trailing backslash before a closing quote was dropped, so the Not current cell did not show the
  name as written. Now each such row keeps the header's columns, and each name reads back as itself.
  The same `cell()` writes the Axis, Effect and Why columns of the issue the Action keeps open. A
  summary whose texts carry no backslash is the same bytes as before. The fix ships in the stale
  Action, `driftproofhq/driftproof/stale@v0.13.0`; the npm package does not carry `stale/`. This is
  the fix for CodeQL alert #17.

- **Two site generators escape quotes in attributes (spec 132).** The homepage generator now
  escapes `'` in the playground's single-quoted `data-cases` attribute. Report 001's generator now
  escapes `"` and `'` in its `esc()`. No value either generator writes today holds a quote. Each of
  the 14 pages the site generator writes is the same bytes with the change as before it. Report
  001's generator writes the same bytes too, and no published page moves. This is the fix for CodeQL
  alerts #9, #6, #7 and #8.

- **The plugin's directory listing (spec 131).** `plugin.json` gains a display name, `Driftproof`,
  and an icon, `favicon.svg`, which is the site's favicon byte for byte. Its description, and both
  descriptions in `.claude-plugin/marketplace.json`, now read "Driftproof (driftproofhq): open-source
  agent skill evaluation and regression testing across model releases". Five keywords are added:
  `skills`, `evaluation`, `testing`, `claude-code` and `regression`. The plugin gains a README that
  lists its three commands, says that each runs `npx driftproof@0.13.0` with no shell, and says what
  it sends and where. Spec 131 changes none of the plugin's commands, its version or its version
  guard; spec 138 changes its run command (below).

- **The README opens in plain words, with the plugin install and the latest finding (spec 126).**
  Its title is now "Driftproof (driftproofhq): open-source agent skill evaluation and regression
  testing across model releases". It opens with "Does your AI coding skill really help, and does the
  help survive a new model?", then says what a skill is and that Driftproof tells you whether the
  skill "clearly helps, clearly hurts, makes no clear difference, or whether there were too few
  answers to tell". The Claude Code plugin install now comes first, under "Try it in Claude Code, no
  API key", and stays in `### Install` too. A "Latest finding" line names and links the newest
  report, gives its date, and quotes the first sentence of the "What we found." point in that
  report's row of `docs/data/report-summaries.json`: today Report 013, 29 Sep 2026.
  `scripts/build-readme-opening.mjs` writes the opening from `docs/data/readme-opening.json`, with
  the newest report and its date read from `docs/data/stats.json`. A screenshot of the page
  `npx driftproof view` makes from Report 013's receipts follows the badge, loaded from the site.

- **The README's report list sits under Reports, and its release-watch paragraph says what runs
  (spec 126).** The opening links "All twelve reports" to `## Reports`, where every report entry
  now sits, in order and unchanged. The sentence "Model-release triggers are live" is gone. The
  paragraph now opens "Model releases are watched daily; reports are published by hand.": a daily
  timer runs `scripts/release-watch.js`, which queues each new generative model for review; a draft
  report runs the tests and calls the models only once a model is registered and its run fits the
  cost limit; registering a model and publishing a report are done by hand. The README is the npm
  package's page; no other file the npm package ships changes in spec 126.

- **The site takes a new layout, and the reports gain plain summaries (spec 125).** Every page but
  the homepage takes a new layout, with rails beside its content: most pages take a wide track
  filled by columns, and the frozen bodies of Reports 001 to 011 and the essay "What happens to
  agent skills when the model changes" keep a reading-width column. A page with two or more
  sections gets an "On this page" contents rail that stays in view at 1440 and 1920 pixels wide and
  is hidden at 390. A report page also gets a facts rail at 1600 and wider: its type, models,
  receipts and date, and its grader and how it ran where its receipts record them. Each of the 12
  published reports gained a plain summary of 4 or 5 points, 90 to 120 words, from "What we
  tested." to "What it doesn't show.". Ten still open with it; Reports 009 and 013 now open with
  sentences read from their receipts (spec 134, below). The summaries are in
  `docs/data/report-summaries.json`, where each point names its sources. The bodies of Reports 001
  to 011 are unchanged. Methodology, Neutrality, Interop, Authoring, Judge policy and Findings open
  with plain sections and keep their earlier text in one closed fold. The Glossary keeps its words.
  By the operator's ruling, the summaries, Report 013's page and these Docs pages say "too few
  answers to tell" where spec 035's line reads *Not enough draws to conclude at this effect floor*.
  Frozen report bodies keep their own words.

- **Report 013 is retitled and rearranged (spec 125).** It is now "Report 013: Claude Sonnet 5.5,
  the day after its release". It was first published as "Report 013: Claude Sonnet 5.5 on release
  day, three skills, three runs". The vendor's announcement dates Claude Sonnet 5.5 28 Sep 2026, and
  the first run began on 29 Sep 2026. The page now opens with its summary and one table of every
  comparison in every run. Its Amendment one records the new title and the new arrangement, and says
  that no receipt, figure, file or result changed.

- **Reports 009 and 013 now open with sentences read from their receipts (spec 134).** Each
  sentence names the day, the model by its name, the skill and a figure, and links the receipt it
  is read from. Report 009 opens with four: three give a skill's average with the skill and without
  it, over its test tasks, and say what that means; the last says what the report does not show.
  Report 013 was run three times, so it opens with one sentence per comparison. Each says in how
  many runs the two models differed clearly, and in how many of the rest there were too few answers
  to tell. A fold under each sentence lists every receipt it counts. The sentence on Claude Opus 5.5
  against Report 011 names both Claude Code versions, 2.1.284 and 2.1.280, read from the run
  records, and says the date changed too. The other ten reports keep spec 125's summary: Reports 001
  to 008 record no answering model in their receipts, Report 010 links no receipt, and Report 011's
  body compares two receipts within one run. Every report's summary is now headed "What did Report
  NNN find?". No receipt, figure or verdict changed.

- **Report 013's headings state their questions, and two amendments record the changes (spec 134).**
  Amendment two, made on 1 Oct 2026, lists each of the ten section headings as first published
  beside the question it now asks, such as "Why run every test three times?". A link made to a
  section before the change still lands on it. Amendment three, made the same day, says that
  Amendment one's list of the runner's phrases left out "below effect floor". The page labels that
  result no clear difference, as it labels "no separation detected", unless there were too few
  answers to tell. Amendment one is not changed, because a published amendment only grows. Neither
  amendment changes a receipt, figure or result.

- **The site's width fixes (spec 130).** The reading measure is set in em, `--w-read: 26.5em`, about
  68 characters a line in the body face. Spec 125's `50ch` ran small text to 73 to 79 characters a
  line. On wide screens, short blocks on Report 013, the reports index, Methodology, the Glossary and
  receipt pages share their row, from 900 or 1180 pixels wide by block. The Glossary and the essay
  "What happens to agent skills when the model changes" gain the "On this page" rail. No page's
  words or figures change, and the homepage is unchanged. With these fixes, spec 125's gate
  `--final` read 43 of 43 green on spec 130's branch, its captures at 390, 1440 and 1920 among them.

- **The paper page and its citation (spec 127).** The site has a new page, `/paper/`, for "Reported,
  Not Measured: An Empirical Study of Measurement Defects in LLM and Agent Evaluation Tools", by
  driftproofhq, Version 1, 30 September 2026, a preprint, not peer reviewed. It links the Zenodo
  record and the PDF on Zenodo, gives the DOI for this version, 10.5281/zenodo.23050796, and for all
  versions, 10.5281/zenodo.23050795, and links `defects.csv` and `defects.json` on the same record,
  the paper's Appendix A.1 as data. It carries a plain citation, a BibTeX entry and Google Scholar's
  citation tags. The site nav links it, and the sitemap lists it. The repository gains a root
  `CITATION.cff` whose preferred citation is the paper, by the version DOI.

- **Page titles, descriptions and structured data (spec 133).** `package.json`'s `description`,
  which npm shows for the package, now reads "Driftproof (driftproofhq): open-source agent skill
  evaluation and regression testing across model releases", as the plugin and the README do. The
  site's builders now write every page's title and description. They name a model by its name, so
  `claude-sonnet-5-5` reads "Claude Sonnet 5.5". Titles end "| Driftproof", and descriptions are at
  most 155 characters. A receipt page's title no longer begins "Receipt:", and no two receipt pages
  now share a title; before, 136 of the 158 did. Report 013's title is its headline, by the
  operator's ruling. Every page carries Organization structured data that links the project's
  GitHub, DEV, npm and SkillsLLM profiles. The homepage adds SoftwareApplication, at version 0.13.0,
  and each report page a TechArticle.

- **A sitemap index, a receipts index and an IndexNow key (spec 133).** `/sitemap.xml` is now an
  index of `/sitemap-pages.xml` and `/sitemap-receipts.xml`, and each page's date there is the last
  commit that changed its words. A new page, `/r/`, lists every receipt page, and every page's
  footer links it. The not-found page and `/subscribed/` are marked `noindex`. The site publishes an
  IndexNow key file, and `scripts/indexnow.mjs` sends the pages a range of commits changed only when
  given `--send`; its gate ran it against a local stub only. Lighthouse 13.5.0, on mobile, scored
  SEO 1 on the homepage, Report 013, one receipt page and the paper page, on the site as spec 133
  merged it.

- **Four pages answer common questions (spec 135).** `/what-is-driftproof/` is "What is
  Driftproof?", `/agent-skill-evaluation/` is "Agent skill evaluation",
  `/agent-skill-regression-testing/` is "Agent skill regression testing", and `/compare/` is "What
  each evaluation tool measures". Each paragraph on the evaluation and regression testing pages is
  quoted word for word from text the site already publishes, followed by the report it came from
  and the models that report ran. Each number on the four pages is a link to its source. Those two
  pages carry FAQPage structured data. The
  homepage and the reports index gain a list linking the four pages, and every page's footer links
  them. Lighthouse 13.5.0, on mobile, scored SEO 1 on the four and on the paper page, on the site as
  spec 135 merged it.

- **`/compare/` sets out what five evaluation tools measure, from each tool's own docs or code
  (spec 135).** The tools are claude plugin eval (Claude Code), alibaba/skill-up, NVIDIA
  SkillEvaluator, agent-skills-eval and Driftproof, across seven rows from "What it measures" to
  "Licence". Each cell links the sources its words rest on, and each link gives the day that source
  was read. Eight cells read "Not shown": the page says such a cell could not be confirmed from that
  tool's own docs or code, and that this does not mean the tool lacks it. The page says that no
  tool is placed above another. Driftproof's cells link `README.md` and `spec/RECEIPT.md` at the
  `v0.13.0` tag.

- **The paper page opens with a question, and the launch essay is retitled (spec 135).** Before
  its abstract, the paper page now asks "Can an LLM evaluator report a score for something it did
  not measure?" and answers from the abstract's own sentences. Its head gains ScholarlyArticle
  structured data, and Dataset structured data for `defects.csv` and `defects.json` on the Zenodo
  record. The essay that launched as "Three model releases later: what actually happens to agent
  skills" is now "What happens to agent skills when the model changes". Its byline says so. Its
  address, `/writing/three-releases/`, does not change, and neither does its text below the byline.

- **Ten pages gain a Markdown copy, and the site gains `llms-full.txt` (spec 135).** The four new
  pages, Methodology, the paper page and Reports 009, 010, 011 and 013 each have an `index.md`
  beside the page, linked from its head as `rel="alternate"` with type `text/markdown`. In
  `llms.txt`, each report line now gives the first sentence of that report's "What we found."
  summary point and the report's models by their names, and "Method and definitions" lists the four
  new pages and the paper. `/llms-full.txt` carries the full Markdown of the four pages, the paper
  and Methodology, then one line per report. No report body is carried.

- **None of the site changes touches the npm package's code, the Action or the plugin** (specs 125,
  127, 130, 133, 134 and 135). Spec 125 also rewrites Report 013's entry in the repository README,
  which npm packs with the package. Spec 133 sets `package.json`'s description, above.

- **The judge now grades what the model produced (spec 137).** On the two command-line surfaces,
  `claude-cli` and `openai-cli`, the model answers as an agent with tools. On 0.12.1 it ran with its
  harness's default tools in a working directory removed after the call, and only its final message
  reached the judge, so a model that wrote its answer to a file and said so was graded on what it
  said. `driftproof run` now takes `--capture text|files`, or `capture` in the working directory's
  `.driftproofrc`. A skill directory's `capture` is ignored and named, as its `samples` and
  `judge_model` are. In `text`, the default, the model runs with its file-writing tools off: claude
  with `--disallowedTools Bash,Edit,MultiEdit,NotebookEdit,Write,Task`, codex with `-s read-only`
  as before. Its reply is the graded answer, byte for byte. In `files` the model may write files in
  a fresh working directory of its own, with Bash and Task still off for claude, and its reply is
  graded with the files it left there, each in a block that names its path and size. A link is
  never collected. A file is included whole when it is text of at most 65536 bytes, among the first
  50 in path order, within 262144 bytes together; files the limits leave out are named in the
  answer as not included, up to the 51st (see Known open). When the directory cannot be read back,
  the draw is lost. An api surface has no tools, so `--capture files` there is refused with exit 2
  before any call. Every receipt a run writes records the mode in `run.capture`, each `files` draw lists its
  files in `captured_files`, and `run` prints the mode before its projection and after the receipt.

- **An answer the judge was not shown is a lost draw, never a score (spec 137).** Before any judge
  call, the runner reads each answer by pattern, with no model call. A reply whose own claim says it
  wrote, saved or created a file and names its path is a lost draw when the answer neither includes
  that file nor shows it in a fenced block after that line; the reason names up to three paths. A
  reply that includes no file and has no fenced block, every line of which only describes work, says
  it is done or offers more ("Let me know ..."), is a lost draw too. `driftproof regrade` reads each answer the
  same way before its judge calls, and keeps lost a draw the run lost because its working directory
  could not be read back. A lost draw is recorded unmeasured with its reason, so spec 119's rule reads
  the case: a result that does not hold for every score the lost draw could have had does not stand,
  and an arm that loses every draw is `failed_unmeasured`. None of the 28 tracked real answers in
  spec 031's transcripts reads as lost. Known open lists the shapes the reading gets wrong.

- **A wide band over several cases reads *Not enough draws to conclude at this effect floor* (spec
  137).** On 0.12.1 a receipt in which no case separated and none was underpowered read `NO_EFFECT`
  whatever its comparison band: a receipt of 3 cases, 3 draws an arm and 2 judge samples a draw read
  `NO_EFFECT` beside a band of plus or minus 0.305941. Now, where two or more cases were kept, the
  reader computes the comparison band over them by the band rule every receipt states, each arm's
  sample sd of the per-case means added in quadrature, widened where a case lost draws by the most
  its mean could move at any score of those draws. A band at or above the 0.05 effect floor reads
  `UNDERPOWERED`, *Not enough draws to conclude at this effect floor*, with no draw count, because
  more draws do not narrow a spread between cases. The badge's draws text reads "no count at this
  band", and the plain sentence ends "but the test tasks scored too far apart from each other to call
  it". A one-case receipt forms no band and reads as before. The reader applies the rule to every
  receipt it reads, whatever its schema version.

- **No published report's numbers or verdict changed (spec 137).** Before the rule changed, the
  build read every published receipt with the new reader and the old one: 206 receipts under
  `receipts/` and `docs/reports/`, 0 refused, and 0 whose verdict, message, colour or draws needed
  moves. They read as before: 36 `PASSED`, 44 `UNDERPOWERED`, 6 `NO_EFFECT` and 120 `NOT_MEASURED`.
  No published receipt reads `NO_EFFECT` over two or more cases, so the band rung reaches none of
  them: the six that read `NO_EFFECT`, all in Report 013, keep one case each. That is also why "0
  of 206 move" says little about the rung itself; spec 137's AC-7 reads the rung. Spec 137 changes
  no receipt and no report page.

- **Receipt spec v0.10 (spec 137).** `spec/RECEIPT.md` and `spec/receipt.schema.json` are v0.10, and
  the site serves the same schema. v0.10 adds two optional fields: `run.capture` `{mode}`, written
  by every run, and a draw's `captured_files` `{path, bytes, included}`, written in `files` capture
  only. v0.9 is frozen as `spec/receipt.v0.9.schema.json`, the v0.9 schema byte for byte but its
  `$id`. The README's sample receipt and the interop page now say v0.10.

- **A regrade keeps the harness version (spec 137).** Since 0.12.0, `driftproof run` has recorded the
  harness in `run.harness` on the command-line surfaces: `claude-code` on `claude-cli` and `codex` on
  `openai-cli`, each with the version its own binary printed, read through the run's spawn plan.
  Spec 137 holds that on each surface in both capture modes. `driftproof regrade` now carries the
  original's `run.harness` and `run.capture`, because the answers it grades came from that harness.
  On 0.12.1 a regraded receipt carried no harness, so `driftproof stale` read its harness as
  unknown and the receipt could never read current. `spec/RECEIPT.md` now says the runner writes
  `run.harness`; until v0.10 it said no Driftproof run did.

- **The methodology page explains the change (spec 137).** Methodology gains two paragraphs. "A wide
  band over several cases" states the band rung as the reader applies it. "Which answer is graded"
  explains the two capture modes, `captured_files`, the lost answer, and `run.harness`. The page's
  Markdown copy and `llms-full.txt` carry the same text. Nothing under `docs/findings/` changes:
  the findings entry for this defect is not in this release (below).

- **A warning when the judge is the target (spec 138).** When a run's judge for a model is that
  model, compared on canonical ids so that a dated id and its undated form are one model,
  `driftproof run` prints three lines on stderr before any call:

  ```
    ! WARNING: the judge is the target model, <model>.
    !   The model that wrote each answer also grades it.
    !   To grade with another model, pass --judge-model <id>, or set judge_model in the working directory's .driftproofrc.
  ```

  It does so whether the judge was named with `--judge-model`, set by `judge_model` in the working
  directory's `.driftproofrc`, or left to the default, which is the target. `driftproof regrade`
  prints the same lines when its `--judge-model` is the model whose answers it grades.
  `/driftproof:run` passes the warning through. The plugin takes no `--judge-model`, so there the
  working directory's `.driftproofrc` chooses another judge. The receipt already records both
  models, so no field is added, and the `judge:` line on stdout is unchanged.

- **Progress per call, with the time left (spec 138).** `driftproof run` now prints a line on stderr
  each time a generation finishes, and each time a draw's judge calls finish:
  `progress: call <n> of <fewest> to <most> · <time> elapsed · about <time> to <time> left ·
  <case> / <arm> draw <n>: <what> done`. The fewest is the run's calls in all when every call
  answers, and the most is the most it can make; each arm draws at least 3 times and at most 10. The
  time left is the time per call so far times the fewest and the most calls still to make. A call
  that timed out counts as made, because it took its time; the receipt's call count leaves it out,
  so on a run with timeouts the two differ. Nothing is added to stdout or the receipt. `regrade`
  prints no progress line.

- **`/driftproof:run` takes `--samples`, `--concurrency` and `--max-cases` (spec 138).** The plugin's
  run command passes each to the runner as given, after the check the runner makes of it: a positive
  whole number with no leading zero. A value that fails is refused with exit 2, naming the flag,
  before anything is spawned, and over the spec's set of test values the plugin refuses exactly the
  values the CLI refuses. Every other flag it does not take, `--judge-model` among them, is still
  refused. The plugin's three commands now also refuse a second folder or receipt, where they ran
  on the first and dropped the rest. Every refusal in spec 138's census, 69 for the CLI and 44 for
  the plugin, still refuses with its exit status and its words.

### What you may see differently

- With `fail-on-underpowered` unset or `false`, every line the enforcement step writes for a
  verdict is the one 0.12.1 wrote for that verdict. Spec 137 can change the verdict itself (below).
- `decide` now refuses a flag it does not declare with exit 2, where 0.12.1 ignored it. A misspelt
  fail-on flag is refused rather than run with its default. Apart from spec 137's band rung
  (below), this is the one change to `decide` a caller who never passes the new flag can see.

- If you pin this action, move your pin to `@v0.13.0` to get the option and the new lockfile in CI.
- If your workflow runs the Action on pull requests and does not set `pr-comment`, it now posts a
  comment, or, without `pull-requests: write`, writes one notice. Set `pr-comment: false` to post
  nothing.

- A `github-token` that is a person's token posts a new comment on each run. The comment is found
  again only when a bot wrote it, and the default token is a bot's.

- The job summary has one more line, above the table.

- A model id with a backslash shows the backslash doubled in the job summary's Model cell. The cell
  is a code span, which takes no backslash escapes; no model id in the registry carries one.

- If you pin the staleness check, move your pin to `stale@v0.13.0` to get spec 132's fix. A
  staleness summary whose texts carry no backslash reads as before.

- Search results and link previews for report and receipt pages name models, not model ids.

- On `claude-cli` and `openai-cli`, `driftproof run` now runs the model with its file-writing tools
  off unless you pass `--capture files`. The Action takes no capture input, so it runs `text`. A
  skill whose model writes its answer to a file and says so now loses that draw in `text`; run it
  with `--capture files`. A `capture` key in a skill directory's `.driftproofrc` is ignored, and
  the run names it.

- An answer that points at a file the judge was not shown, or only describes work, is now a lost
  draw with its reason, where 0.12.1 graded it. A case with lost draws is read by spec 119's rule,
  so a result can read `INCONCLUSIVE` or `UNDERPOWERED` where the same answers read otherwise on
  0.12.1, and an arm that loses every draw is `failed_unmeasured`.

- A receipt of two or more cases that read `NO_EFFECT` on 0.12.1 reads `UNDERPOWERED` when its
  comparison band is at or above the floor, and this holds for receipts already written. With
  `fail-on-underpowered: true` such a receipt now fails the job; unset or `false`, it warns as any
  underpowered decision does. No published receipt is of this kind (above).

- `driftproof run` prints the capture mode before its projection and after the receipt, and a
  receipt's summary prints it too when the receipt records one.

- `driftproof run` writes progress lines, and `run` and `regrade` write the judge warning, on
  stderr; spec 138 adds nothing to stdout. A run with no `--judge-model` and no `judge_model` in the working
  directory's `.driftproofrc` is judged by the target, so it prints the warning. The Action passes
  no judge, so every Action run prints it, and an Action log gains a progress line per generation
  and per draw's judge calls. No option silences the progress lines.

- `/driftproof:run`, `/driftproof:init` and `/driftproof:badge` refuse a second folder or receipt
  with exit 2, where they ran on the first.

### What this release does not include

- Spec 124, npm audit in the release sweep, is not in this release.

- Spec 073, keep the answers, is not in this release.
- Spec 074, the site pass and the related-work page, is not in this release.
- Spec 108, judge injection, is not in this release.
- Spec 112, CodeQL hygiene, is not in this release. Spec 132 covers its scope.

- The findings page entry for the answer-capture defect, spec 137's fourth priority, is not in this
  release. It goes in the next.

- Spec 139, the quick run and the guided first run, is not in this release. It goes next.
- Spec 140, init into an existing skill and the trusted lane outside a git repository, is not in
  this release. It goes first after it.

### Known open

- **The README's commented workflow line names the underpowered decision only.** The input also
  fails an `INCONCLUSIVE` decision that rests on lost draws, as § What fails the job and
  `action.yml` say (spec 072, finding F-3, carried).
- **With `fail-on-underpowered` false, the enforcement step's `::warning` renders a lost-draws
  case id as the receipt holds it**, from spec 119 (spec 072, carried).
- **The pull request comment prints a refused row's reason as it is.** For an ambiguous receipt
  that reason carries the id of each case with duplicate rows, so a case id holding a mention or a
  markdown link renders live in a comment posted with the Action's token (spec 128, approval
  finding F-1, carried).

- **The job summary's lead prints the lowest result's scores without its verification level.** The
  comment states the level on its last line (spec 128, approval finding F-4, carried).

- **The `view` page's lede says "None showed the skill clearly hurting." whenever nothing regressed
  and anything was measured**, including a page where every result is `UNDERPOWERED` (spec 128,
  approval finding F-3, carried).

- **The `view` page labels the 120 tracked receipts that record no `answered_by` "Not measured".**
  Whether that label is right is open for the operator (spec 128, Q3).

- **The job summary's cell escaper passes a lone carriage return through.** A receipt file name with
  a carriage return not followed by a line feed ends the summary row mid-cell, and its tail becomes
  an extra row. The real row's Decision column holds. This was so before spec 111 (spec 111,
  finding F-1, carried).

- **The staleness check's summary still splits a row on a receipt path that holds a pipe.** Its
  `code()` escapes neither `|` nor `\`, and spec 132 did not change it (spec 132, other finding).

- **Nobody has yet checked that the README's in-page links work on npm's package page:** `#install`,
  `#reports` and the Quickstart link. npm's page could not be read from the build box (spec 126,
  carried).

- **`/data/profiles.json` names internal working paths and lane numbers in its `source` fields,
  and the site publishes it** (spec 133, finding F-1, carried).

- **A receipt page's heading still shows the model id, and so do the titles of the homepage's band
  plots** (spec 133, a follow-up for the operator).

- **Report 009's new opening reads Driftproof's receipts only.** Report 009 compares two eval
  harnesses, and the other harness's pass counts, which its earlier summary carried, are no longer
  in the opening. Whether a report that compares instruments opens on one harness's receipts is
  for the operator to rule (spec 134, finding F-2, carried).

- **Report 013's opening says "differed clearly" and does not say which way.** Today every clear
  difference it counts is the runner's `improvement`, so nothing is hidden (spec 134, finding F-3,
  carried).

- **The compare page's Driftproof cells link the `v0.13.0` tag at fixed lines of `README.md` and
  `spec/RECEIPT.md`.** No gate re-reads those lines after spec 135, so they hold only if the tag is
  cut on a tree where those lines still say what the cells quote (spec 135, finding F-1, carried).
  One of them no longer does: spec 137 added 50 lines near the top of `spec/RECEIPT.md`, so the
  link to its line 150, quoted for *Not enough draws to conclude at this effect floor*, now lands
  on other text. The quoted line is now line 200.

- **Driftproof's own "What it measures" cell on `/compare/` reads "Not shown".** The README line it
  was read from was rewritten by spec 126 before this page shipped (spec 135, open).

- **`/what-is-driftproof/` lists four merged upstream fixes, where the paper's defect table has
  five.** NVIDIA #154 is left out because its item also names issue #153, which the research could
  not confirm (spec 135, open for the operator).

- **Five NVIDIA SkillEvaluator figures on `/compare/` link their cell's lead source, but the lines
  quoted from it do not carry them:** 0.0, 1.0, +0.05 and -0.10, and the 3 of "Tier 3" (spec 135,
  open for the operator).

- **`llms.txt` still says "the six kinds of report".** The site lists seven (spec 135, open).

- **From 1180 pixels wide, Report 013's visual order differs from its markup order.** The count that
  changed sits beside the headline, above the table, while the markup keeps it after the table. The
  body is frozen, so the stylesheet alone places it (spec 130, open).

- **Report 011's headline still says "on release day".** Its page title, set by spec 133, names
  its models instead (spec 125, out of scope, on the list of follow-ups).

- **The lost-answer reading loses some answers the judge is shown whole, with a reason that is not
  true of them.** A commit body or pull request description that lists "Added `src/payments/stripe.js`"
  reads as pointing at a file, and so does the same text inside a fenced block, or after a fenced
  code answer. A reply of first-person advice, such as "I'd add an index on user_id before changing
  the query.", reads as only describing work. No score becomes a wrong score: a draw that should
  have been measured is lost, and where a skill teaches such a shape the loss falls on one arm. The
  approval owes an operator ruling on these shapes, or a narrower reading, before a release ships
  the reading (spec 137, approval finding F-1, carried).

- **Some pointers are not seen.** "I've written the ADR to docs/adr/0001.md." spelled with a
  typographic apostrophe, and a file name wrapped in bold markers, are graded. In `text` capture
  the write tools are off, so this is what 0.12.1 did with them (spec 137, approval finding F-2,
  carried).

- **"File-writing tools off" holds for the six tools named.** The claude CLI on the build box,
  2.1.285, also lists PowerShell and REPL among its tools that run commands or code, and the list
  does not name them (spec 137, approval finding F-3, carried).

- **In `files` capture, a working directory of more than 51 files names only the 51st as not
  included, and a file the collector cannot read is named as over the size limit** (spec 137,
  approval finding F-4, carried).

- **In `files` capture, an empty reply is lost before the working directory is read**, so a model
  that leaves its answer in a file and replies nothing is not graded on the file (spec 137, approval
  finding F-8, carried).

- **A wide-band receipt's badge reads "not enough draws", though more draws do not narrow a spread
  between cases.** The words are spec 035's, which the spec requires; the operator may rule on them.
  Of the 121 published multi-case receipts that record a comparison band, 20 record one under the
  0.05 floor, so for most suites shaped like those a `NO_EFFECT` result is now out of reach (spec
  137, approval finding F-5, carried).

- **A one-case receipt that reads `NO_EFFECT` forms no band and reads as before.** Reading it
  `UNDERPOWERED` too would move Report 013's six published receipts, so it is the operator's (spec
  137, Q1).

- **Two misreadings found before the build stand:** a summary written to a file and given in prose after
  the pointing line still reads as lost, and a claim and a code name in one clause still read as a
  pointer (spec 137, open).

- **No receipt from a real run has been read in either capture mode.** Every test of the capture
  modes, the collectors and `run.harness` ran under a test double; a run on each command-line
  surface, through the eval user, needs a subscription run (spec 137, open).

- **`driftproof stale` has no capture axis.** A receipt graded in one capture mode, or before v0.10
  with the harness's default tools, reads current beside a `text` run when its other axes match
  (spec 137, out of scope, a follow-up).

- **The plugin keeps the last of a repeated flag**, such as `--samples 2 --samples 5`, without a
  word, though its own rule says a flag is refused, never ignored. The CLI does the same, and this
  was the plugin's behaviour for its first three flags too (spec 138, approval finding N-3,
  carried).

- **The README does not yet describe `--capture`, the progress lines, the judge warning or the
  plugin's three new run flags.** `driftproof --help` describes the first three, the methodology
  page the capture modes, and the plugin's run command its flags (specs 137 and 138, carried).

- **v0.12.1's known-open `fast-uri` line is closed by this release.**
- Everything v0.12.1 lists as open, carried, except that line.

### CodeQL alerts

On 1 Oct 2026, code scanning on the public repository listed 17 open alerts.

- **Fixed in this release:** #10, `lib/decision.js:375`, by spec 111; and #17,
  `stale/run.mjs:164`, #9, `scripts/build-site-pages.js:235`, and #6, #7 and #8,
  `scripts/build-report-001.js:240`, `252` and `255`, by spec 132 (above). Each alert closes when
  code scanning reads the pushed fix.

- **The operator dismissed eleven alerts**, each with its reason:
  - Used in tests: #16, `tests/interop-page.js:31`; #14, `tests/gate.js:6651`; #13,
    `tests/gate.js:3875`; #5, `tests/assertion-scope.js:106`; #4, `tests/essay-grounding.js:29`.

  - False positive, build-time text extraction from our own HTML, with escaped output: #11,
    `scripts/build-head-tags.js:131`; #12, `scripts/prepare-report-006.js:506`; #3,
    `scripts/site-data.mjs:47`.

  - Won't fix, internal and not shipped: #15, `scripts/drive.mjs:408`; #1,
    `scripts/render-check.mjs:126`; #2, `scripts/render-check.mjs:128`.

- None of the eleven is in the npm package, which ships `bin/`, `lib/`, `spec/`, `config.js` and
  `config/models.json` only.

### Published

**`driftproof@0.13.0` is on npm**, published 2026-10-02 at 01:53:00 UTC, `latest`, and its
`gitHead` is `b88f391`, the published repository's commit that the `v0.13.0` tag points at,
built from source commit `3c3ef0d1`. The registry records its version as `0.13.0`, its publish time
as `2026-10-02T01:53:00.602Z`, its tarball's shasum as `19336c07f04800d0c355ae596b2683744af45140` and its integrity as
`sha512-neyysVdd+FUVEjU4Uo/+xAoWWQ3/yTWTU1oOlI5SGcqNA5nqsjOLkbhfUupfgaIqq/1YoBr/NCMiU9DrhShhEw==`, and `dist-tags` reads `{"latest":"0.13.0"}`. A clean-directory
`npx -y driftproof@0.13.0 --version` prints `0.13.0`.
**The published repository's `main` and `release` branches** are at `b88f391`, and the `v0.13.0` tag (object `7b25564`) points at it.
The `release` branch is the one the plugin directory tracks, and the directory now serves v0.13.0.
**The GitHub release `v0.13.0`** was published at 02:13:24 UTC with a short user-facing body written by the operator.
**GitHub Pages deployed** `b88f391`: deployment `6799446234` (`github-pages`) reached `success` at 01:56:05 UTC,
and the live homepage carries the `@v0.13.0` pin.
Read after the publish at the source commit `3c3ef0d1`, spec 028's gate reads **21/21 pass, 0 fail**, its NFR-7
green against the published tarball, and spec 031's reads **9 GREEN**, its AC-1 and AC-2 green through
`npx driftproof@0.13.0`. The build's own published-tree gate read 647/647 passed, 0 failed.
Google indexing was requested and the Bing URL submission made for eight key URLs, and `sitemap.xml` was resubmitted, by the operator.
Evidence: `specs/000-governance/evidence/post-publish-0.13.0.txt`.

---

## v0.12.1 - 2026-09-29

**`package.json` reads 0.12.1**, and `config.js`'s `RUNNER_VERSION` is held equal to it.
The Action pins in `README.md` and `docs/index.html` are `@v0.12.1`, the plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.12.1, and so is the `minimum` in
`plugin/driftproof/version-guard.json`; `examples/workflows/driftproof-stale.yml` pins `stale@v0.12.1`. `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut because
`runner_version` is inside the canonical receipt that hash is taken over. The receipt pages'
`npx driftproof@<version> validate` command names 0.12.1. **Not yet on npm** at the bump; a
Published section is added here after the publish.

Receipts written by 0.12.1 are receipt spec v0.9, as 0.12.0's were. This release makes no receipt
schema change, and every earlier receipt still validates against its own version.

### What changed

- **A verdict holds whatever the lost draws would have scored (spec 119).** A lost draw is one the
  runner recorded but could not measure, for example a judge timeout. On 0.12.0 a case that lost
  some of its draws was read from the draws that were measured, so losing the lowest with-skill
  draws could make a pass, and losing the highest could make a regression. On 0.12.1 each reading
  that rests on a case with lost draws is checked at every score those draws could have had, from
  the bottom of the judge's score scale to the top:
  - A case that separated up counts toward a pass only if it separates up at every such score.
    Otherwise it reads `inconclusive`.
  - A case that separated down counts as a regression only if it separates down at every such
    score. Otherwise it reads `inconclusive`, and that case alone no longer makes `decide --enforce`
    fail; another case or another requested model can still.
  - A case with no separation keeps that reading only if it holds at every such score. Otherwise it
    reads underpowered: *Not enough draws to conclude at this effect floor*. An underpowered case
    with lost draws carries no draws-needed count.
  - The receipt as a whole: when a case's pass holds, the receipt reads `PASSED` only if the check
    finds that no other case's lost draws could, at some score, make that case separate down;
    otherwise it reads `INCONCLUSIVE`, decision state `inconclusive`. The check errs towards
    `INCONCLUSIVE`: it can withhold a pass that would in fact hold. A case whose regression holds
    makes the receipt `REGRESSED` whatever the other cases lost.
  - Where the verdict is shown, a verdict of `INCONCLUSIVE`, or `UNDERPOWERED` with an
    underpowered case that lost draws, names the lost draws: `decide` and its `--summary`,
    `--enforce` and `--github-output` forms, `badge` and its `--github-output` and `--svg` forms,
    and the receipt page. The full line names the case, each arm's lost and drawn counts, and each
    reason the lost draws record; the badge message carries the short form, `<k> draw(s) lost`.
    `--github-output` writes one more key, `lost_draws`, only when there is such a reason.

### What you may see differently

- A receipt with no lost draw is read as on 0.12.0. Every receipt tracked in this repository, and
  every receipt page the site builds, reads the same verdict as at 0.12.0 (spec 119, AC-5).
- A pass that relied on lost draws now reads `inconclusive`. A regression that relied on them reads
  `inconclusive` too, so `decide --enforce` exits 0 where it exited 1. Either way the lines beside
  the verdict name the lost draws.
- A new run scores every draw afresh, and a case that loses no draw is read without this check. A
  new run can lose draws too.
- A no-effect reading with a lost draw in a kept case now reads `UNDERPOWERED`: with the runner's
  limit of 10 draws an arm, some score always breaks it (spec 119, A-119-1).
- If you pin this action, move your pin to `@v0.12.1` to get this rule in CI.

### What this release does not include

- Spec 072, fail on underpowered, is not in this release.
- Spec 111, the summary cell backslash, is not in this release.
- Spec 073, keep the answers, is not in this release.
- Spec 074, the site pass and the related-work page, is not in this release.
- Spec 108, judge injection, is not in this release.

### Known open

- **Which cases an `INCONCLUSIVE` reason names is stated three ways in spec 119, and the short form
  can undercount a receipt's lost draws.** The verdict, the decision state and the exit are right;
  the reason can name a case whose lost draws are not why, and leave out one whose count was
  withheld (spec 119, finding F-1, carried).
- **The receipt page's `INCONCLUSIVE` sentence** says a separation is not shown to hold. When the
  reason is another case's lost draws, the separation does hold, and what is not shown is that the
  other case cannot separate down. No tracked receipt reads `INCONCLUSIVE`, so no published page
  carries the sentence today (spec 119, finding F-2, carried).
- **`decide --github-output` writes `draws_needed` as `none` when the count is withheld for lost
  draws**, and `action.yml` documents `none` as a different claim. `action.yml` does not declare the
  `lost_draws` output (spec 119, finding F-3 and Q2, carried).
- **`README.md` and `spec/RECEIPT.md` do not describe `INCONCLUSIVE` as a verdict for lost draws.**
  `README.md` names `INCONCLUSIVE` only for a run that did not complete or carries no numeric delta,
  and `spec/RECEIPT.md` does not name it (spec 119, Q4, proposed as its own item).
- **`driftproof export` writes the verdict without naming the lost draws** (`lib/export.js`, not
  changed by spec 119).
- **`package-lock.json` locks `fast-uri` 3.1.6**, which two High advisories cover
  (GHSA-qw65-cvwx-89v3 and GHSA-58mr-gqgx-xq4g, fixed in 3.1.7). A fresh `npm install driftproof`
  resolves 3.1.7, because npm consumers do not get this lockfile. The Action installs with `npm ci`
  from it, so the Action at `@v0.12.1` installs 3.1.6. Spec 123 moves the lockfile to 3.1.7 for the
  next release (found after the publish, by Dependabot).
- Everything v0.12.0 lists as open, carried.

### Published

**`driftproof@0.12.1` is on npm**, published 2026-09-29 at 16:05:33 UTC, `latest`, and its
`gitHead` is `771b30f`, the published repository's commit that the `v0.12.1` tag points at,
built from source commit `eb3cd09f`. The registry records its version as `0.12.1`, its publish time
as `2026-09-29T16:05:33.823Z`, its tarball's shasum as `c35b45394c737aa1371d273077a494edc378ff8f` and its integrity as
`sha512-zHIHK4blHvLCNGpQDsOQVTbKACvhqe/n+/32HhW9lidiehPf2CwZMqHb+YAv/t441eW670P7Sh6ppuHDwql/dw==`, and `dist-tags` reads `{"latest":"0.12.1"}`. A clean-directory
`npx -y driftproof@0.12.1 --version` prints `0.12.1`.
**The GitHub release `v0.12.1`** was published at 16:06:12 UTC as Latest, with this entry's text as its notes.
**GitHub Pages deployed** the published repository's `main`, `f952e21`: the 0.12.1 build with Report 013
added, built from source commit `0ec0e0fc`, with the package files, `package.json`, the Action and the plugin
identical to the tagged commit. Deployment `6739317293` (`github-pages`) reached `success` at 15:58:51 UTC,
and the live homepage carries the `@v0.12.1` pin. A depth-1 clone of the tag, with `npm ci --omit=dev` and
then `node tests/gate.js --scan-root .`, reads **641/641 passed, 0 failed, 1 not applicable**. The one not
applicable is the approval-record rule, which reads a merge range from `main`, and a tag-only clone has no
`main`. Read after the publish at the source commit `eb3cd09f`, with `main` pinned as the nightly pins it,
spec 028's gate reads **21/21 pass, 0 fail**, its NFR-7 green against the published tarball, and spec 031's
reads **9 GREEN**, its AC-1 and AC-2 green through `npx driftproof@0.12.1`. The build's own published-tree
gate read 642/642 passed, 0 failed.
Evidence: `specs/000-governance/evidence/post-publish-0.12.1.txt`.

---

## v0.12.0 - 2026-09-28

**`package.json` reads 0.12.0**, and `config.js`'s `RUNNER_VERSION` is held equal to it.
The Action pins in `README.md` and `docs/index.html` are `@v0.12.0`, the plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.12.0, and so is the `minimum` in
`plugin/driftproof/version-guard.json`. `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut because
`runner_version` is inside the canonical receipt that hash is taken over. The receipt pages'
`npx driftproof@<version> validate` command names 0.12.0. **Not yet on npm** at the bump; a
Published section is added here after the publish.

Receipts written by 0.12.0 are receipt spec v0.9, as 0.11.3's were. Every earlier receipt still
validates against its own version.

### What changed

- **The deciding path fails closed: six false passes closed (spec 062).** Each was reproduced by the
  architecture review at `dbad69e` and is a row of spec 062's gate, red at its Base and green after.
  - A run with one unmeasured case no longer hides a measured regression: for a TESTED receipt
    answered by a model, `decide` reads `regression` whenever a case separated down, and `--enforce`
    exits 1. A receipt with no readable
    case decides `not measured` and its model stays in the set, where before it left the set and
    `badge <dir>` rendered the other model's state.
  - A receipt whose `schema_version` is not a known version (`"constructor"` among them, or absent)
    is invalid, and `validate` exits 1. `badge` and `decide` now validate a receipt as well as check
    its hash, so such a receipt no longer renders a badge or passes `decide --enforce`.
  - A second run on the same day keeps both receipts. `run` names a receipt with the first 12
    characters of its `receipt_hash` after the date, and never writes over an existing file.
    `decide` and `badge <dir>` read receipts only, and an unreadable receipt for a model whose file
    name differs from its id is named unreadable, not absent.
  - A skill directory's `.driftproofrc` no longer sets `max_cases`, `samples` or `judge_model`. A
    receipt that ran fewer cases than its suite has no verdict: `decide` reads it `inconclusive`, or
    `regression` if a case separated down, and the single-receipt `badge` does not give it the
    verdict the full run would carry.
  - A `SKILL.md`, `evals/evals.json`, `evals` directory or bundled file that is a symbolic link is
    refused, naming the path, and `run` writes no receipt. `content_hash` covers the `SKILL.md`
    bytes that were read.
  - A `.driftproofrc` that does not parse is refused with exit 2, naming the file. A flag given as
    `--name=value` is read as `--name value` is, for every command, where 0.11.3 ignored it and the
    run took its spending limit from elsewhere. An empty or misspelt flag makes `run` and `regrade`
    exit 2, naming it, and they refuse any flag they do not take.
- **A pull request's rc does not set the run, and a stripped receipt is still refused (spec 069).**
  The Action starts the run in an empty working directory, so a pull request can no longer narrow the
  run that measures it, and `max_cases`, `samples` and `judge_model` take their defaults. No
  `.driftproofrc` at the repository root is read, and one that does not parse no longer refuses the
  run, except when the skill directory is the repository root (`skill-dir: .`; under Known open
  below). A sealed receipt with `results` removed is refused by `badge <dir>` and `decide`, exit 4,
  naming it, as in 0.11.3: a change on the way to this release had dropped it, and spec 069 restored
  the refusal.
- **A flag that takes no value is never set by a value, in any spelling (spec 106).**
  `run <skill> --trusted-skill false` ran in the same-user lane; it is now refused with exit 2, as
  `--trusted-skill=false` also is from this release (spec 062; 0.11.3 ignored that form). The same holds for every flag that takes no value, on every
  command, for `true`, `false`, `yes`, `no`, `on`, `off`, `1` and `0`, in lower case, upper case or capitalised.
  `--keep-transcripts`, `--github-output` and `--enforce` never take the next argument as a value, so
  `decide <dir> --enforce false` no longer enforces. `run` and `regrade` refuse a positional they do
  not take, naming it, before any skill, receipt or rc is read.
- **A summary kept beside its receipt is read as a summary (spec 107).** After spec 069's rule, on the way
  to this release (0.11.3 was not affected), a summary written by `driftproof export --to summary-json`
  in a receipt directory made `badge <dir>` and `decide` exit 4 and call it tampered. A file whose name
  ends in `.summary.json` and that has the summary `format` is now skipped; one under such a name that
  carries `receipt_hash` or `results` without that shape is refused. `export --out <dir>` writes the
  summary as `<receipt base>.summary.json`, where it failed on the write before. The
  interop page and `export`'s usage line (`--out FILE|DIR`) state the rule.
- **The staleness check as a GitHub Action (spec 057).** `driftproofhq/driftproof/stale@v0.12.0` runs
  `driftproof stale` on a schedule in your repository and keeps one issue, labelled
  `driftproof-stale` by default, listing each receipt that needs a rerun or a regrade and the command
  to run next. It fails the job on an error, or on stale only with `fail-on-stale: 'true'`. It makes
  no model call. `examples/workflows/driftproof-stale.yml` is a weekly workflow with `contents: read`
  and `issues: write`. The `v0.11.3` tag carries no `stale/`, so this is the first version it can be
  pinned at.
- **The receipt pages' verify block (spec 063)** says that `validate` shows a file is unchanged since
  it was sealed, and not who made or sealed it. Its command pins the package version.
- **Report 010, Amendment 2 (spec 063).** Configuration B's published files are renamed from
  `addy-adr-confirmation--*` to `config-b--*`, and every path to them on the page moves with them.
  The amendment lists each old and new path, and each renamed file's bytes are unchanged.
- **The rest is this repository's own tooling** (specs 059, 060, 061, 062b, 064, 065, 066, 067,
  070, 083 and 116): gates, the nightly sweep and the merge queue. `scripts/build-public.sh` now keeps
  `docs/reviews/` out of the public tree (spec 064). None of it is in the npm package.

### What you must do

- **If you pin this action, move your pin.** If a Driftproof check has been green on 0.11.3 or
  earlier, and its run had an unmeasured case, ran fewer cases than its suite, or read a
  `.driftproofrc` from the checkout, re-run it on this version before relying on it.
- If a workflow reads a receipt by the name `<skill>-<model>-<date>.json`, read the directory
  instead: the name now ends with the first 12 characters of the receipt's `receipt_hash`.
- If your Action run relied on a `.driftproofrc` in the repository or the skill directory for
  `max_cases`, `samples` or `judge_model`, it now runs with their defaults. On the command line, set
  them by flag or in the working directory's rc.
- If a script passes `true`, `false`, `yes`, `no`, `on`, `off`, `1` or `0` after a flag that takes no
  value (`--trusted-skill false`, `--enforce true`), remove it: 0.12.0 refuses it with exit 2 on every
  command. `run` and `regrade` also refuse a second positional, with exit 2.
- If you keep summaries beside receipts, give each a name ending in `.summary.json`, as
  `export --out <dir>` does (`<receipt base>.summary.json`). Under a name without that ending,
  `badge <dir>` and `decide` refuse it, since a summary carries its receipt's `receipt_hash`.

### What this release does not include

- Spec 119, verdict bounds for lost draws, is not in this release.
- Spec 072, fail on underpowered, is not in this release.
- Spec 111, the summary cell backslash, is not in this release.
- Spec 073, keep the answers, is not in this release.
- Spec 074, the site pass and the related-work page, is not in this release.
- Spec 108, judge injection, is not in this release.
- **No signing.** The verify block now says what `validate` does not show; receipts stay
  self-sealed (spec 063, out of scope).

### Known open

- **With `skill-dir: .`, the repository root's rc is the skill directory's rc**, so the Action reads
  it, and one that does not parse refuses the run, while the README says no root rc key is read
  (spec 069, finding F-1, carried).
- **`scripts/build-receipt-pages.js` does not validate the receipts it renders** (spec 062, out of
  scope, owed).
- **The interop page states the summary naming rule narrowly**: it names `<receipt base>.summary.json`,
  while `badge <dir>` and `decide` skip any file whose name ends in `.summary.json` and that has the
  summary shape (spec 107).
- Everything the findings page lists as open, carried from v0.11.3.

### Published

**`driftproof@0.12.0` is on npm**, published 2026-09-28 at 16:58:22 UTC, `latest`, and its
`gitHead` is `cce4ac4`, the published repository's commit that the `v0.12.0` tag points at,
built from source commit `2b5e1470`. The registry records its version as `0.12.0`, its publish time
as `2026-09-28T16:58:22.109Z`, its tarball's shasum as `332c17a56e423cd65fe74e9b0b6337a7eebc2ce4` and its integrity as
`sha512-xhZzeLm4/cGGS1Y8Tby9EJZb2QYsXYootX/JQiS9qlMLcqDQkOEVOvhfdiGIIjDMC1DGQkyQeriffFiRvYS4DQ==`, and `dist-tags` reads `{"latest":"0.12.0"}`. A clean-directory
`npx -y driftproof@0.12.0 --version` prints `0.12.0`.
**The GitHub release `v0.12.0`** was published at 17:02:07 UTC as Latest, with this entry's text as its notes.
**GitHub Pages deployed that commit**: deployment `6715481987` (`github-pages`, sha `cce4ac4`)
reached `success` at 16:48:14 UTC, and the live homepage carries the `@v0.12.0` pin. A depth-1
clone of that tag, with `npm ci --omit=dev` and then `node tests/gate.js --scan-root .`, reads
**641/641 passed, 0 failed, 1 not applicable**. The one not applicable is the approval-record rule, which reads a merge
range from `main`, and a tag-only clone has no `main`. Read after the publish at the source commit
`2b5e1470`, with `main` pinned as the nightly pins it, spec 028's gate reads **21/21 pass, 0 fail**, its NFR-7 green
against the published tarball, and spec 031's reads **9 GREEN**, its AC-1 and AC-2 green through
`npx driftproof@0.12.0`. The build's own published-tree gate read 642/642 passed, 0 failed.
Evidence: `specs/000-governance/evidence/post-publish-0.12.0.txt`.

---

## v0.11.3 - 2026-09-25

**`package.json` reads 0.11.3**, and `config.js`'s `RUNNER_VERSION` is held equal to it.
The Action pins in `README.md` and `docs/index.html` are `@v0.11.3`, the plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.11.3, and so is the `minimum` in
`plugin/driftproof/version-guard.json`. `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut because
`runner_version` is inside the canonical receipt that hash is taken over. **Not yet on
npm** at the bump; the Published section below records the publish.

Receipts written by 0.11.3 are receipt spec v0.9. Every earlier receipt still validates against its own
version.

### What changed

- **Fewer false passes.** A suite with two cases of the same id is refused before any call.
  A receipt with two rows for one case and arm is refused by `validate`, `badge`, `export` and `decide`.
  The Action fails a job whose receipts give two answers for one model, naming the files. Each Action
  invocation now writes and uploads its own receipts, so one job can run it more than once. The
  artifact is no longer named `driftproof-receipt`: its name is the step output `artifact_name`.
- **Import Anthropic's eval results.** `driftproof import --from claude-plugin-eval` reads
  the `aggregate-result.json` that `claude plugin eval` writes. `--from skill-creator` reads
  skill-creator's `benchmark.json`, which skill-up also writes. The receipts are DECLARED. They record
  the harness, the source document and its sha256, and whether the skill fired, beside the score and
  never inside it.
- **Regrade.** `driftproof regrade <receipt> --skill <dir> --answers <file> --judge-model
  <id>` grades a receipt's saved answers again with another judge, without generating them again.
  Because a normal run does not keep the answers yet, it works today only where the answers were kept
  beside the receipt, as they were for Report 011's Amendment 1.
- **What's stale.** `driftproof stale receipts/*.json` compares what each receipt recorded
  (model, harness, skill, suite, judge, grading template, rubrics) with what would run today. For each
  arm it says whether the result still stands, needs a rerun, or needs only a regrade, and prints the
  command to run next. Anything a receipt does not record is reported unknown, never current. A patch
  release of the harness is an advisory. A rubric edit reruns both arms, because receipts do not yet
  record a hash per case prompt. Exit 0 current, 1 stale, 3 unknown or advisory, 2 error; `--strict`
  turns 3 into 1. `--json` prints `driftproof.stale/1`, whose schema is served at
  `/spec/stale.v1.schema.json`. `driftproof run` now records the harness and its version in each
  receipt.
- **Import redaction.** Local paths in text an import copies are redacted whole: quoted paths
  with spaces, paths across line breaks, and names with an apostrophe, though the part of a quoted path
  after an apostrophe followed by a space can still appear, while the home folder and user name are
  always redacted. An import that would still name a home folder anywhere in a path (`/var/home`,
  `/mnt/c/Users`, a network share) is refused and writes nothing.
- **Model registry.** `claude-opus-5-5` is registered (released 2026-09-22, US$4 and US$20
  per million input and output tokens), so a run on it is priced as itself, not at the most expensive
  tier. `claude-opus-5` and `claude-opus-4-8` gain their release dates.
- **Receipt spec v0.8 and v0.9.** v0.8: a count the source did not record stays
  absent, never 1; generation and judge-sample counts are kept apart; a re-judge records when it ran.
  v0.9: an imported receipt says what produced it. Both only add fields.
- **The interop page** names receipt spec v0.9 and all four import formats.
- **Report 011, Amendment 1 (the site).** Report 011's answers were graded again with Claude Opus 5.5 as
  the judge. No verdict changed, and 50 of 51 answers stayed on the same side of the pass line. One
  crossed: Claude Opus 5's baseline on `code-review-and-quality`, 0.827 to 0.633. The report above the
  amendment is unchanged.

### What you must do

- If a workflow downloads the Action's artifact by the name `driftproof-receipt`, read the name from the
  step output `artifact_name` instead.
- If a suite has two cases with the same id, give them distinct ids. 0.11.3 refuses the suite before
  any call.


### Published

**`driftproof@0.11.3` is on npm**, published 2026-09-25 at 09:14:19 UTC, `latest`, and its
`gitHead` is `2159f66`, the published repository's commit that the `v0.11.3` tag points at,
built from source commit `1e10949`. The registry records its version as `0.11.3`, its publish time
as `2026-09-25T09:14:19.218Z`, its tarball's shasum as `8ef70f9eefc6e47f4a47221a234d38700233db03` and its integrity as
`sha512-IuwtdiGcsFwf/p9Xt9v12qkuoHvYU/RSvljYgNhiKmLME3A0qNvTX5ic/GmCw3nLm2B/5EAqfzxGxhmT3/mxng==`, and `dist-tags` reads `{"latest":"0.11.3"}`. A clean-directory
`npx -y driftproof@0.11.3 --version` prints `0.11.3`.
**GitHub Pages deployed that commit**: deployment `6657416890` (`github-pages`, sha `2159f66`)
reached `success` at 09:08:51 UTC, and the live homepage carries the `@v0.11.3` pin. A depth-1
clone of that tag, with `npm ci --omit=dev` and then `node tests/gate.js --scan-root .`, reads
**631/631 passed, 0 failed, 1 not applicable**. The one not applicable is the approval-record rule, which reads a merge
range from `main`, and a tag-only clone has no `main`. The tree is left clean. Read after the publish
at source `dev` `1e10949`, spec 028's gate reads **21/21 pass, 0 fail**, its NFR-7 green against the published
tarball, and spec 031's reads **9 GREEN**, its AC-1 and AC-2 green through `npx driftproof@0.11.3`. The
build's own published-tree gate read 632/632 passed, 0 failed over 1,359 tracked files.
Unlike 0.11.2's, this clean-runner read ran with the network available and this box's `HOME`.
Evidence: `specs/000-governance/evidence/post-publish-0.11.3.txt`.

---

## Site push: Report 011 - 2026-09-23

Spec 047, merged to the source `dev` at `509b514d`. **The site moved and the package did not.** No
version change, no npm publish and no tag: `package.json` reads 0.11.2, `config.js`'s
`RUNNER_VERSION` is held equal to it, and the Action pins stay `@v0.11.2`. Nothing under `lib/`,
`bin/`, `spec/`, `config.js`, `config/models.json` or `package.json` differs from v0.11.2, so the
tarball is the one v0.11.2 published. The public tree is built from the source commit that carries
this line (`DECISIONS.md`, 2026-09-23, the site-only push).

**No verdict, receipt field or published figure changes.** Reports 001 to 010 and the receipt spec
are as they were. The one report added is the eleventh.

### What shipped

- **Report 011, published.** *Claude Opus 5.5 on release day, three skills* moves out of `-draft`
  to `/reports/011/`, is indexed on the reports page, the homepage, the sitemap, the feed and
  `llms.txt`, and gets a receipt page for each of its six receipts. The page's `<main>` is the draft
  spec 042 approved, with only the draft chrome removed. Read by the runner's own comparison, its
  release drift table reads 1 with no separation detected and 2 with not enough draws to conclude.
  Every draw was judged with `claude-opus-5`, which departs from the judge policy.
- **The launch essay and the README** gain a paragraph and a roll entry on Report 011, with the
  judge caveat, and their counts move to eleven reports.
- **The homepage's latest card** names the field its title prints, because Report 011's title is
  the first latest-report title with a numeral in it.

### What this release does not include

- **No package change.** A bump would have named a change the package does not have.
- **`claude-opus-5-5` is not added to the model registry.** Nothing on the page or its receipt pages
  reads it.
- **No fresh-context QA of the new prose** (Known open).

### Known open

- **The promotion's new text has no fresh-context QA record**: the essay paragraph, the README roll
  entry and the TL;DR card. The report's own text was read by spec 042's QA, which found no required
  fixes.
- Everything the findings page lists as open, carried from v0.11.2.

---

## v0.11.2 - 2026-09-23

**`package.json` reads 0.11.2**, and `config.js`'s `RUNNER_VERSION` is held equal to it.
The Action pins in `README.md` and `docs/index.html` are `@v0.11.2`, the plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.11.2, and so is the `minimum` in
`plugin/driftproof/version-guard.json`. `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut because
`runner_version` is inside the canonical receipt that hash is taken over. **Not yet on
npm** at the bump; the Published section below records the publish.

**No verdict, receipt field or published figure changes.** The receipt spec stays at v0.7.
The files the npm package carries that differ from 0.11.1 are `package.json` (the ajv floor,
below, and the version), `config.js` (`RUNNER_VERSION`) and one line of `spec/RECEIPT.md`. No
file under `lib/` or `bin/` changes. Everything else in this release is the site, or the
repository's own gates.

### What this release contains

- **The ajv floor moves to `^8.18.0` (spec 046).** This closes the v0.7.0 known-open row
  "AJV >= 8.18". The lock already resolved 8.20.0, so no installed byte moved in this
  repository. What moves is the lowest ajv a consumer's install may resolve, from 8.17.1 to
  8.18.0. Every committed receipt validates under 8.18.0 and 8.20.0 as it does under 8.17.1.
- **`spec/RECEIPT.md` names the version a producer emits.** Its coexistence rule said v0.6,
  while its own heading, `config.js`'s `RECEIPT_SCHEMA_VERSION` and the schema's
  `schema_version` said v0.7. It now says v0.7. The methodology page names the current
  receipt spec beside the schema's canonical id, in the interop page's words.
- **Report 009 Amendment 1 (spec 039).** A versioned Amendments section before the evidence
  list gives one reading rule for the page's description, ties every figure to its file as a
  `<data>` element, and changes no earlier text.
- **Report 010 Amendment 1 (spec 041).** It closes O-2 to O-6 of the report's second QA, which
  were open at its publication, and records the maintainer's answer on issue 591 and PR 598
  from GET-only check records published beside the page. Its second fresh-context
  QA reads NO REQUIRED FIXES.
- **The interop page's schema line** names receipt spec v0.7 where it read v0.4, the interop
  fields as the v0.3.1 additive revision, and the frozen prior schemas as v0.1 to v0.6.

### What this release does not include

- **No re-run of the example receipt.** The homepage's receipt is the one re-run on the 0.11
  code (`DECISIONS.md`, 2026-09-16); no receipt-emission semantics changed since.
- **Report 011 is not published by this release.** Its draft and renderer are in the source
  tree, and `scripts/build-public.sh` excludes the draft.

### Published

**`driftproof@0.11.2` is on npm**, published 2026-09-23 at 14:30:47 UTC, `latest`, and its
`gitHead` is `5a9946c`, the published repository's commit that the `v0.11.2` tag points at,
built from source commit `b514ffd`. The GitHub release `v0.11.2` was published at 14:30:06 UTC.
**GitHub Pages deployed that commit**: deployment `6615432212` (`github-pages`, sha `5a9946c`)
reached `success` at 13:41:04 UTC, and the live homepage carries the `@v0.11.2` pin. A depth-1
clone of that tag, set up as the plugin self-test workflow sets it up (`npm ci --omit=dev`, then
`node tests/gate.js --scan-root .`, then both manifests parsed), with the network cut, an empty
`HOME` and the source trees hidden, reads **620/620, 0 failed, 1 not applicable**. The one not
applicable is the approval-record rule, which reads a merge range from `main`, and a tag-only clone
has no `main`. Every step exits 0 and the tree is left clean. Read after the publish at source
`main` `88244f6`, spec 028's gate reads **21/21**, its NFR-7 green against the published tarball,
and spec 031's reads **9 GREEN**, its AC-1 and AC-2 green through `npx driftproof@0.11.2`. The
build's own published-tree gate read 621/621 over 1,209 tracked files, and the repository gate at
the release commit read 636/636 with 4 not applicable.
Evidence: `specs/000-governance/evidence/post-publish-0.11.2.txt`.

**This release went out with spec 012's AC-7 red, and spec 023's and spec 026's accepted reds.**
The release sweep at `c50ad3aa` was run in full and its reds each have a recorded cause
(`specs/000-governance/evidence/sweep-0112-c50ad3a.txt`). Two reds on `dev` that predated the
release were fixed before `main` moved: the repository gate's probe-copies rule and spec 046's AC-4.
Spec 012's AC-7 reads Report 011's tracked draft, which its promotion removes (`DECISIONS.md`,
2026-09-23).

### Known open

- **Spec 028's NFR-7, re-run after the publish, reads green** against the published tarball
  (Published, above). The pre-publish red it carried while `package.json` was ahead of 0.11.1 is
  cleared.
- **Spec 028 still owes the amendment spec 046's entry names:** NFR-7 to read a declared unpublished
  pin as a state rather than a red. It is owed to spec 028's next loop (`DECISIONS.md`, 2026-09-23).
- Everything the findings page lists as open, carried from v0.11.1.

---

## Site push: Report 010 - 2026-09-22

Spec 041, merged to the source `dev` at `213cdf65`. **The site moved and the package did not.**
No version change, no npm publish and no tag: `package.json` reads 0.11.1, `config.js`'s
`RUNNER_VERSION` is held equal to it, and the Action pins stay `@v0.11.1`. Nothing under `lib/`,
`bin/`, `spec/`, `config.js`, `config/models.json` or `package.json` differs from v0.11.1, so the
tarball is the one v0.11.1 published. The public tree is built from the source commit that
carries this line (`DECISIONS.md`, 2026-09-22, the site-only push).

**No verdict, receipt field or published figure changes.** Reports 001 to 009 and the receipt
spec are as they were. The one report added is the tenth.

### What shipped

- **Report 010, published.** *Repeated ADR evaluations across two Claude Code configurations*
  goes live at `/reports/010/`, indexed on the reports page, the homepage, the sitemap, the feed
  and `llms.txt`, with a report card. It is the first report with **no Driftproof receipts**: its
  figures are the upstream harness's own output files and the other sources its Limits name, each
  a `<data>` element naming its file, listed by sha256 in `raw-SHA256SUMS` and published beside the
  page where the blocking scans pass them unchanged. The page states that it has no verification
  level, and why. Its TL;DR card reads `no receipts linked`, set as prose.
- **The launch essay and the README** move to ten reports, and say that Report 010 is read from the
  upstream harness's output rather than from receipts.

### What this release does not include

- **No package change.** A bump would have named a change the package does not have.
- **No Driftproof measurement of Report 010's experiment**, and so no receipts and no receipt pages
  for it.

### Known open

- **Five findings of Report 010's second fresh-context QA are open at publication** (O-2 to O-6):
  one sentence attributing the definition-of-done wording, and four counts that are right but are not
  tied to a `<data>` element. The operator deferred them to Report 010 Amendment 1. No QA record for
  the report reads NO REQUIRED FIXES.
- Everything the findings page lists as open, carried from v0.11.1.

---

## Site push: Report 009 - 2026-09-20

Spec 039, merged to the source `dev` at `66b61c50`. **The site moved and the package did not.**
No version change, no npm publish and no tag: `package.json` reads 0.11.1, `config.js`'s
`RUNNER_VERSION` is held equal to it, and the Action pins stay `@v0.11.1`. Nothing under `lib/`,
`bin/`, `spec/`, `config.js`, `config/models.json` or `package.json` differs from v0.11.1, so the
tarball is the one v0.11.1 published. This is the first public push without a version
(`DECISIONS.md`, 2026-09-20).

**No verdict, receipt field or published figure changes.** Reports 001 to 008 and the receipt
spec are as they were. The one report added is the ninth.

### What shipped

- **Report 009, published.** *Three skills under two eval harnesses* moves out of `-draft` to
  `/reports/009/`, is indexed on the reports page, the homepage, the sitemap, the feed and
  `llms.txt`, and gets a receipt page for each of its three receipts. The page's `<main>` is the
  approved draft's, with the eyebrow's type the one sentence that changes. On its own table,
  Driftproof's arms read 3 separated and 0 with no separation detected under the rule.
- **A seventh report type, Instrument comparison** (`REPORT-STYLE.md`): the same skills measured
  by two instruments on pinned inputs, stating what each can and cannot establish rather than
  ranking them. The report does not put the other instrument's results through Driftproof's rule.
- **The judge policy, stated.** Published reports keep the `claude-haiku-4-5` pin. In the
  installed tool the judge follows the user's configuration, and the receipt records which judge
  ran. Report 009 departs from the policy and says so in its own limits; that is unchanged.
- **The launch essay and the README** gain a paragraph and a roll entry on Report 009, and their
  counts move to nine reports and seven types. The paragraph carries the report's non-comparability
  caveat.
- **One line on How this is built**, naming two pull requests merged into
  `addyosmani/agent-skills` (`pull/576`, `pull/578`) and one issue raised there (`issues/569`).

### What this release does not include

- **No package change.** A bump would have named a change the package does not have.
- **No re-run of any measurement.** Report 009's numbers are the ones spec 034 approved.
- **No fresh-context QA of the new prose** (Known open).

### Known open

- **The promotion's new text has no fresh-context QA record**: the TL;DR card, the essay
  paragraph, the README roll entry, the type row, the judge-policy sentence and the How this is
  built line. The report's own numbers and framing were re-derived by spec 034's QA sessions; the
  text added around it was not. The spec 039 approval carries this as F-3, non-blocking for the
  merge.
- Everything the findings page lists as open, carried from v0.11.1.

---

## v0.11.1 - 2026-09-18

**`package.json` reads 0.11.1**, and `config.js`'s `RUNNER_VERSION` is held equal to it.
The Action pins in `README.md` and `docs/index.html` are `@v0.11.1`, the plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.11.1, and so is the `minimum` in
`plugin/driftproof/version-guard.json`. `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut because
`runner_version` is inside the canonical receipt that hash is taken over. **Not yet on
npm** at the bump; the Published section below will record the publish.

**No verdict, receipt field or published figure changes.** The receipt spec stays at v0.7.
The one file the npm package carries that differs from 0.11.0 is `lib/hygiene.js` (below).
Everything else in this release is the site, or the repository's own gates.

### What this release contains

- **The site's visual pass (spec 038).** The site keeps its words and changes how it looks.
  Pages are set on a paper ground with a faint texture, records sit on receipt stock, and the
  verdict stamp is tilted slightly, with no animation. Headings are set in Newsreader, body text
  in Alegreya Sans and code in Courier Prime, all self-hosted. The band plot is drawn in ink,
  with a graticule, tabular numerals and each arm's mean printed on its band. The plots on the
  homepage receipt card, every receipt page, the report cards and the methodology page's floor
  figure are inlined into the page instead of loaded as images, so they take the page's fonts.
  Each one is the generated file's own bytes and keeps the accessible name its image had. The
  playground draws the same plot, and the share cards follow the new palette. No copy changes,
  no script is added, and the sitemap's URL set is unchanged. It was approved with findings on
  `9a11045` (`specs/038-site-visual-pass/evidence/approval-20260918T062500Z.md`), and the two
  findings on its own gate were closed on `dev` under A-038-8.
- **Two site fixes from spec 025 (A-025-21).** The homepage hero's Range row prints each value to
  three decimals, matching the delta display, so it stays on one line. `stats.json` keeps the
  receipt's full precision. The render check now clicks the playground's own "point" toggle to
  read the point outline, rather than relying on the default view's data to draw one.
- **The hygiene scan reads a PNG's text, not its pixels (spec 038 A-038-5, A-038-7).**
  `lib/hygiene.js` scans a PNG as every chunk except `IDAT`, and reads compressed text chunks in
  the encoding they carry text in. It fails closed on bytes after `IEND` and on a truncated file.
  A pattern that appears only in compressed pixel data no longer reads as a disclosure. A name
  rendered into a screenshot is pixels, and no byte scan sees that, before or after this change.
  The repository gate and `scripts/merge-check.js` both call it.
- **The repository's scope checks read a merged spec on `dev` (spec 037 A-037-7).** A shared
  helper, `specs/037-site-redesign/probes/range.mjs`, resolves a spec's range from the merge that
  brought its Tip in. Specs 034, 036, 037 and 038 read their NFR-1 through it (A-034-6, A-036-9,
  A-038-9). This is repository process, and the published tree does not carry it.
- **Report 009's draft (spec 034 A-034-7).** The draft page is re-rendered from its renderer and
  picks up spec 038's `<head>`. Its body did not change. The QA-order check reads the Tip's own
  history. The draft is not published.
- **The v0.11.0 record.** The v0.11.0 entry's Published section and the Pages deployment it
  records, written after that publish, are part of this tree.

### Published

**`driftproof@0.11.1` is on npm**, published 2026-09-18 at 07:56:17 UTC, `latest`, and its
`gitHead` is `8f5879a`, the published repository's commit that the `v0.11.1` tag points at,
built from source commit `4ef3ad3`. The GitHub release `v0.11.1` was published at 08:01:30 UTC.
**GitHub Pages deployed that commit**: deployment `6520010097` (`github-pages`, sha `8f5879a`,
Actions run #39) reached `success` at 07:52:12 UTC, and the live homepage carries the `@v0.11.1`
pin and spec 038's font preloads. A depth-1 clone of that tag, set up as the plugin self-test
workflow sets it up (`npm ci --omit=dev`, then `node tests/gate.js --scan-root .`, then both
manifests parsed), with the network cut, an empty `HOME` and the source trees hidden, reads
**613/613, 0 failed, 1 not applicable**. The one not applicable is the approval-record rule, which
reads a merge range from `main`, and a tag-only clone has no `main`. Every step exits 0 and the tree
is left clean. Read after the publish at source `main` `04a540f`, spec 028's gate reads **21/21**,
its NFR-7 green against the published tarball, and spec 031's reads **9 GREEN**, its AC-1 and AC-2
green through `npx driftproof@0.11.1`. The build's own published-tree gate read 614/614 over 1,117
tracked files, and the repository gate at the release commit read 625/625 with 4 not applicable.
Evidence: `specs/000-governance/evidence/post-publish-0.11.1.txt`.

**This release went out with three sibling spec gates red, for reasons that predate it.** The
sibling sweep at the release commit was run in full (`specs/000-governance/evidence/sweep-0111-71a7160.txt`),
and the two re-freezes the bump forced were made before `main` moved: spec 020 amendment 60 and
spec 026 A-026-14. Spec 030, spec 026's AC-16 and spec 033 stay red. Each is a gate-side red that
reads the same at 0.11.0's code, and each is owed as its own fix loop, recorded in `DECISIONS.md`
on 2026-09-18.

**No community plugin catalog entry was found.** Neither `anthropics/claude-plugins-community`
(`main` at `a727be1`, last committed 2026-08-24, before the plugin existed) nor
`anthropics/claude-plugins-official` (`1aa8f02`) lists `driftproof`, and
`claude.com/plugins/driftproof` returns 404. The plugin installs from this repository's own
marketplace manifest.

### Known open

- **Spec 028's NFR-7, re-run after the publish, reads green** against the published tarball
  (Published, above). The pre-publish red it carried while `lib/hygiene.js` was ahead of 0.11.0
  (A-028-43) is cleared.
- **The re-freezes the bump forced are done**: spec 020 amendment 60 and spec 026 A-026-14, both
  before `main` moved. Spec 030, spec 026's AC-16 and spec 033 stay red for reasons that predate
  this release, each owed as its own fix loop under its own log (`DECISIONS.md`, 2026-09-18).
- Everything the findings page lists as open, carried from v0.11.0.

---

## v0.11.0 - 2026-09-17

**`package.json` reads 0.11.0**, and `config.js`'s `RUNNER_VERSION` is held equal to it.
The Action pins in `README.md` and `docs/index.html` are `@v0.11.0`, the plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.11.0, and so is the `minimum` in
`plugin/driftproof/version-guard.json`. `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut because
`runner_version` is inside the canonical receipt that hash is taken over. **Not yet on
npm** at the bump; the Published section below records the publish.

The UNDERPOWERED verdict (spec 035). A receipt that could not have resolved the effect
floor at the draws it took now says so, instead of saying NO_EFFECT, which reads as a
measured absence. The rule is R-1 to R-6 with a new named constant `POWER_Z` (2) in
`config.js`, and the **receipt spec bumps to v0.7**, which adds no field: readers derive
the verdict, and v0.6 is frozen rather than widened.

### Behaviour changes, read these before upgrading

- **A job that used to fail can now pass (the fail-open direction).** `decisionState`
  no longer reads the aggregate delta. Before this release, `delta <= -0.05` was a
  `regression` and failed the job. Now the state comes from the receipt verdict, so a
  receipt whose aggregate delta clears the floor **downward with no case separated**
  reads `no detected effect`, or `underpowered` where the rule finds it so, and the job
  no longer fails. If your gate relied on the aggregate delta alone to catch a
  regression, it no longer does. No archived receipt moves out of `REGRESSED` by this,
  so the exposure is to receipts generated from here on. (F-2 of spec 035's approval
  record; spec 035 § *Why `Z = 2` and why the spread enters*.)
- **A job that used to pass can now fail to report success (the tightening direction).**
  A workflow that passed on an aggregate lift with **no case separated** now reads
  `UNDERPOWERED`, which is in `NEVER_SUCCESS` and never renders as success.
- **All 120 receipts archived before this release now badge `NOT_MEASURED`.** The
  verdict rule refuses a receipt whose `answered_by` block is **absent**, not only one
  stating a kind other than `model`. This is the fail-safe reading and is word for word
  what `decisionState` has applied since spec 030, so the badge and the Action stop
  answering differently about one receipt. The site's old example receipt (2026-07-27)
  renders `not measured on claude-haiku-4-5`, lightgrey, where it rendered `passing`,
  brightgreen, so the site no longer uses it as the example (below).
- **Published report figures do not move.** The differ's per-case verdict *values* are
  unchanged and the new state rides beside them, so Reports 006 to 008 rebuild
  byte-identical.

### What else this release contains

- **The badge and the receipt page (spec 036).** An `UNDERPOWERED` or `NOT_MEASURED`
  badge prints the draws taken against the draws needed, not a lift. The receipt page
  says which refusal fired, and a receipt with no readable case reads `NOT_MEASURED`,
  never `NO_EFFECT`.
- **The homepage and *How this is built* (spec 037).** The homepage opens on the question
  a skill's own tests leave open, whether the gap it makes is real or noise and whether it
  held on the last model release. The Claude Code plugin is the first install path, and
  `npx` and the GitHub Action sit under a CI heading. The first screen links the findings
  page and a receipt page, and the receipt card's verdict is read from that receipt. A new
  *How this is built* page in the Docs menu describes the method, with counts taken at a
  named commit. The hero plot's accessible title carries the verdict word only, and the
  receipt page carries the sentence under it (A-037-4).
- **A fresh example receipt, and the site artefacts that were stale now agree with it.**
  `receipts/commit-message-conventions-claude-haiku-4-5-20251001-2026-09-17.json` was run
  on this release after the bump: `runner_version` 0.11.0, `claude-cli` through the
  isolated eval user, `answered_by.kind` `model`, `TESTED`, receipt schema 0.7, 462 calls,
  lift +0.389 ± 0.217, verdict `PASSED`. The README badge, the homepage card, its plot,
  `docs/data/stats.json` and the CI badge's alt text all read from it. Re-cut from this
  receipt, the badge JSON is byte-identical (`passing on claude-haiku-4-5`, brightgreen),
  so the site's accent token does not move and no design decision was needed. A pre-build
  run of the same suite on 2026-09-16, before the bump, recorded `runner_version` 0.10.2
  and also read `PASSED` (+0.441 ± 0.183); it stays in the archive. This clears the
  stale-artefacts item that was open on this entry (spec 035 F-3).

### Published

**`driftproof@0.11.0` is on npm**, published 2026-09-17 at 03:29:55 UTC, `latest`, and its
`gitHead` is `2c6a747`, the published repository's commit that the `v0.11.0` tag points at,
built from source commit `d8ed364`. The GitHub release `v0.11.0` was published at 03:34:28
UTC. **GitHub Pages deployed that commit**: deployment `6495160487` (`github-pages`, sha
`2c6a747`) reached `success` at 03:45:54 UTC, and the live homepage carries the `@v0.11.0` pin and
the 0.11.0 example receipt, whose page and badge JSON both serve. A depth-1 clone of that tag, set up
as the plugin self-test workflow sets it up (`npm ci
--omit=dev`, then `node tests/gate.js --scan-root .`, then both manifests parsed), with the
network cut, an empty `HOME` and the source trees hidden, reads **613/613, 0 failed, 1 not
applicable**. The one not applicable is the approval-record rule, which reads a merge range from
`main`, and a tag-only clone has no `main`. Every step exits 0 and the tree is left clean. Read
after the publish at `d8ed364`, spec 028's gate reads **21/21**, its NFR-7 green against the
published tarball, and spec 031's reads **9 GREEN**, its AC-1 and AC-2 green through `npx
driftproof@0.11.0`. The build's own published-tree gate read 614/614 over 1,111 tracked files, and
the repository gate at `d8ed364` read 625/625 with 4 not applicable. Evidence:
`specs/000-governance/evidence/post-publish-0.11.0.txt`.

**This release went out on the repository gate and the published-tree gate alone.** The sibling
spec gates and the re-freezes the bump forces were not run before `main` moved. That is a deliberate
deviation, recorded in `DECISIONS.md` on 2026-09-17 with the partial figures and what the
post-release loop owes.

**No community plugin catalog entry was found.** Neither `anthropics/claude-plugins-community`
(`main` at `a727be1`, last committed 2026-08-24, before the plugin existed) nor
`anthropics/claude-plugins-official` (`ea0a38e`) lists `driftproof`, and
`claude.com/plugins/driftproof` returns 404. So no catalog pin could be read against this release.
The plugin installs from this repository's own marketplace manifest.

### Known open

- Everything the findings page lists as open, carried from v0.10.2.

---

## v0.10.2 - 2026-09-15

A fix release for the badge, the judge and the differ's wording. **If you render a
Driftproof badge, or pin the Action or the plugin at 0.10.1, update.** Plugin users
get the badge fixes only after `claude plugin update`.

Two external audits of 0.10.1, an end-to-end retest and a reliability audit, found
the badge and judge defects; the site's findings page (`docs/findings/`) records both
audits, what this release fixes, and what it does not. **`package.json` reads
0.10.2**, and `config.js`'s `RUNNER_VERSION` is held equal to it. The Action pins in
`README.md` and `docs/index.html` are `@v0.10.2`, the plugin's pin in
`plugin/driftproof/.claude-plugin/plugin.json` is 0.10.2, and so is the `minimum` in
`plugin/driftproof/version-guard.json`, whose `resolved_by` names the commit that set
it. `package-lock.json` moves with them, and
`tests/fixtures/export-summary.snapshot.json`'s `receipt_hash` is re-cut, because
`runner_version` is inside the canonical receipt that hash is taken over. The receipt
spec is unchanged at **v0.6**.

### What this release contains

- **The badge rechecks retained judge output.** On 0.10.1 `/driftproof:badge`
  rechecked each retained generation text against its receipt and nothing else, so a
  receipt whose retained judge output had been edited still rendered a passing badge.
  It now refuses a receipt when any retained judge text no longer digests to the
  `judge_sample_hashes` the receipt carries (spec 031).
- **The badge says what it checked.** Its statement no longer says judge text is not
  retained when the transcripts beside the receipt hold it (spec 031).
- **The comparison caveat prints only when it is true.** `driftproof diff` printed
  that a comparison was not like for like whenever either receipt's band carried a
  source label, which every v0.4 and v0.5 band does. It now prints only when the two
  receipts' band sources differ (spec 031).
- **The band wording.** A band is the mean plus or minus one standard deviation, a
  descriptive spread and not a confidence interval. `driftproof diff`, the README and
  the site now state a separation as detected under the rule and a non-separation as
  none detected at the sample size used. The diff's headline and per-case labels read
  differently; the verdict values underneath them, and every machine-facing token, are
  unchanged. Twelve published records carry a versioned amendment for the old wording
  (spec 031).
- **A judge score that is not a number is refused.** On 0.10.1 a judge reply that
  parsed with a score of `null`, `false`, `""` or `[]` was measured as 0, and `true` as
  1. Such a reply is now refused the way an unparseable reply is, and no score is
  recorded from it (spec 032).
- **The badge reads transcripts only from inside the transcripts directory.** It
  refuses an `index.json` entry, or an `index.json`, that resolves outside it (spec
  032).
- **The site** gains the findings page, a platform statement on the homepage and in
  the README, and a scope sentence on the judge policy: the fixed judge governs the
  reports Driftproof publishes, and a receipt records its own judge in `run.judge`
  (spec 033).

### Published

**`driftproof@0.10.2` is on npm**, published 2026-09-15 at 18:12:27 UTC, and its
`gitHead` is `95ae35e`, the published repository's commit that the `v0.10.2` tag
points at, built from source commit `a683f5a`. A depth-1 clone of that tag, set up
as the plugin self-test workflow sets it up (`npm ci --omit=dev`, then
`node tests/gate.js --scan-root .`, then both manifests parsed), with the network
cut and an empty `HOME`, reads **611/611, 0 failed, 1 not applicable**. The one not
applicable is the approval-record rule, which reads a merge range from `main`, and a
tag-only clone has no `main`. Every step exits 0. Read after the publish, spec 028's
gate reads 21/21, its NFR-7 green against the published tarball, and spec 031's reads
9 GREEN, its AC-1 and AC-2 green through `npx driftproof@0.10.2`.

### Known open

Everything the findings page lists as open: the statistical results of the reliability
audit, the single-receipt badge's use of the effect floor alone, `TESTED` on a receipt
with `attested` false or an incomplete run, the `--trusted-skill` flag, and Windows,
which is untested. The underpowered-verdict rule is decided and is the next spec.

---

## v0.10.1 - 2026-09-13

A fix release for the Claude Code plugin. **If you installed the plugin at 0.10.0,
update it.** No version published before this one carries either fix.

Both defects were found by an external audit of the published v0.10.0 plugin,
received 2026-09-13. Nothing else in the runner, the receipt or the Action changed:
since the v0.10.0 tag, the three plugin command files are the only shipped files
that changed, apart from the version strings this release moves and
`docs/sitemap.xml`, whose homepage `lastmod` moved from 2026-09-12 to 2026-09-13.
**`package.json` reads 0.10.1**, and `config.js`'s `RUNNER_VERSION` is held equal
to it. The Action pins in `README.md` and `docs/index.html` are `@v0.10.1`, and the
plugin's pin in `plugin/driftproof/.claude-plugin/plugin.json` is 0.10.1. So is the
`minimum` in `plugin/driftproof/version-guard.json`, whose `resolved_by` names the
commit that set it. `tests/fixtures/export-summary.snapshot.json`'s `receipt_hash`
is re-cut, because `runner_version` is inside the canonical receipt that hash is
taken over. The receipt spec is unchanged at **v0.6**.

### What this release contains

- **The plugin's commands now find their own script reliably.** On 0.10.0 each
  command told Claude to run the door script at a literal `<plugin-root>`
  placeholder, and to fill in the plugin's location itself. Claude Code does not
  substitute that placeholder, so the path a command ran from was whatever the
  model wrote there. Each command now names the script through
  `${CLAUDE_PLUGIN_ROOT}`, the path variable Claude Code substitutes into a
  command's text before the model reads it. The line the model runs already
  carries the plugin's real directory.
- **Claude no longer fires a Driftproof command on its own judgement.** On 0.10.0
  none of the three commands set `disable-model-invocation`, so Claude could
  invoke any of them when a request looked like a match for its description.
  `/driftproof:run` spends your Claude Code subscription. All three now carry
  `disable-model-invocation: true`, and each runs only when you type it. That
  includes `/driftproof:init`, which writes a new directory, and
  `/driftproof:badge`. Both fetch and run the pinned CLI from npm, the same as
  `run`.

Spec 028's gate now holds both properties in every command file (A-028-37), with
standing arms that go red against the command files as they shipped in 0.10.0.

---

## v0.10.0 - 2026-09-12

The release that carries two merged loops: **spec 028** (the Claude Code plugin)
and **spec 030** (the Action's decision integrity). **`package.json` reads 0.10.0**,
`config.js`'s `RUNNER_VERSION` is held equal to it by the repository gate, the
Action pins in `README.md` and `docs/index.html` are `@v0.10.0` with it, and the
plugin's own pin — `plugin/driftproof/.claude-plugin/plugin.json` and the
`minimum` in `plugin/driftproof/version-guard.json` — moves in the same commit.
A fourth file moves with the version and is not documentation:
`tests/fixtures/export-summary.snapshot.json` records the `receipt_hash` a built
receipt has, and `runner_version` is inside the canonical receipt that hash is
taken over — so the snapshot is re-cut, that one string and nothing else, in its
own commit before the bump. The v0.7.2 entry below states the same coupling for
the same reason. The receipt spec is unchanged at **v0.6**. **`driftproof@0.10.0`
is published to npm**, and it is the version the plugin pin names. **The git tag
is cut at the source commit whose gates were read green at that commit.** The
Action pin `@v0.10.0` resolves once the published repository carries the tag,
which it does not yet as this entry is written.

### What this release contains

- **Spec 030 — the Action decided a multi-model run from one receipt.** On
  v0.9.0 and earlier, a run given more than one model in `inputs.models`
  produced one receipt per model and decided the job from exactly one of them:
  the one whose filename sorted first, which is a property of the model id and
  not of the run. The decision is now taken over every receipt a run produced, a
  receipt count below the requested model count fails closed, and `decide`
  verifies every receipt in the set before anything is written.
- **Spec 028 — the Claude Code plugin.** Three commands onto the CLI (scaffold a
  suite, measure a skill, render a badge), each reading the resolved runner
  version before any invocation that spends and refusing below the shipped
  minimum. The plugin's version is the npm version its commands invoke.
- **The publish path stopped shipping a subset.** `scripts/build-public.sh`
  force-adds exactly what it copied and reads its own copy manifest back against
  `git ls-files`, refusing at exit 10 rather than publishing a tree that does not
  carry what the build put in it.
- **`BACKLOG.md` joins the governance exclusion** (`152bc83`, 2026-09-12): the
  queue is out of the published tree in `EXCLUDE_RE` and in the blocking by-name
  assertion, the way `CONSTITUTION.md` and `DECISIONS.md` already were.

### Resolved before the tag

This entry first listed three items as open. Each was resolved before the tag,
and each is kept here with the commit that resolved it, not deleted.

- **Spec 028's NFR-7 was 20/21 until the publish, and is green.** It compares this
  checkout's `lib/`, `bin/`, `config/` and `package.json` byte for byte against
  `npm pack driftproof@<the plugin pin>`, so it could clear only once 0.10.0 was on
  npm. Run against the published tarball, it read PASS (the run recorded at
  `2e92389`), and the discharge is recorded at `a1c36aa`.
- **The version guard's `resolved_by` names `ec6c069`**, the commit that set
  `RUNNER_VERSION` to the minimum, `0.10.0`. It was set at `a7e0751`. It had named
  `d19a195`, the merge that moved `RUNNER_VERSION` to 0.9.0. Spec 028's AC-5 could
  not be satisfied by any value after the bump, and it was amended first, at
  `b094309`, so that it reads the anchor against the commit under test. At
  `877e04a` it was amended again, so that it refuses rather than passes when it
  cannot find the commit that set the version.
- **Spec 020's `README.md` body freeze was re-cut, by script, at `cbc01b1`.** The
  bump had edited the README's sample receipt and its Action pin. Spec 021's read
  of that freeze needed no change of its own: it reads spec 020's recorded digest,
  and it went green when that digest was re-cut.

### Known open

- **This entry states what the release contains; it is not yet the release
  note.** The paragraph spec 030's `PACKET.md` § 8 holds ready — the multi-model
  headline and the sentence telling anyone pinned to v0.9.0 to move their pin —
  is copied in verbatim at the release-notes step, which has not run.

---

## v0.9.0 - 2026-09-06

The release that carries four merged loops: **spec 026** (receipt integrity),
**spec 025** (the site design pass), **spec 021** (the gate and tooling carry)
and **spec 027** (the confidentiality scan's classifier). **`package.json` reads
0.9.0**, the Action pins in `README.md` and `docs/index.html` are `@v0.9.0` with
it, and the receipt spec moves to **v0.6** with v0.5 frozen at
`spec/receipt.v0.5.schema.json`. RUNBOOK precondition 3: receipt-emission
semantics change, in six places. **The npm publish and the git tag are
not made here**; they are the operator's steps after approval, in the RUNBOOK's
order, and the pin above resolves to nothing until the tag exists.

### Read this first: four ways this can break a script that worked on 0.8.1

Each of these used to complete and write a receipt. Each now stops. If you run
Driftproof in CI, read this section before you bump the pin.

- **A budget or cap flag that is not a number is refused, at exit 2, naming the
  input and the value.** `--max-calls`, `--max-usd`, `--samples`, `--max-cases`
  and `--concurrency`, and the same keys in a `.driftproofrc`. On 0.8.1
  `--max-calls abc` parsed to NaN, both guards were `>` comparisons that are
  false against NaN, the banner printed the NaN, and the run completed and
  wrote a receipt that carried no trace of the absent cap. If a pipeline has
  been passing an empty variable or a templated string that did not expand, the
  job stopped silently doing what it said; it will now stop loudly.
- **A model id the registry does not carry is refused before the first call**,
  at exit 2, naming the id and the absolute path of the registry it consulted
  (`DRIFTPROOF_REGISTRY` when set, otherwise the packaged `config/models.json`).
  `--models`, `--judge-model` and the rc, after alias resolution. On 0.8.1
  `--models 'haiku;id'` ran to completion, recorded `registry: unregistered` as
  a disclosure, read `TESTED`, and badged as passing on an id that is not a
  model. `registry: "unregistered"` survives in the schema for **imported**
  receipts only, where the model field is another tool's word. There is no
  opt-out flag, deliberately.
- **A run that measured nothing no longer reads as a run.** A suite with no
  cases is refused at exit 2 before any call and writes no receipt at all. An
  empty generation, and a judge reply with no parseable score, are now
  *unmeasured* draws with a reason rather than a hashed empty string and a
  zero; an arm whose every draw is unmeasured is `case_status:
  failed_unmeasured`; a receipt containing one is `incomplete`, and an
  incomplete receipt carries no verdict — `driftproof badge` renders `not
  measured` and `driftproof diff` computes nothing across it. On 0.8.1 all
  three wrote `TESTED` and badged `no effect`.
- **The receipt schema is v0.6**, and `badge`, `diff` and `export` verify
  `receipt_hash` before they read a receipt rather than warning and proceeding.
  A tool that consumes Driftproof receipts should read `spec/RECEIPT.md` again;
  v0.5 stays readable at `spec/receipt.v0.5.schema.json`. A stub run
  (`DRIFTPROOF_STUB=1`) is also no longer a pass: it records
  `verification_level: UNVERIFIED`, `run.surface: stub`,
  `run.answered_by.kind: stub`, and verdicts `NOT_MEASURED`.

### Spec 026 — a receipt now says what answered it

Six findings, each a way the 0.8.1 runner wrote a receipt that read as more than
it was. Two of them are in the list above; here is the set.

- **F1** — a stub run recorded the real surface name and `TESTED` while the text
  was canned. The schema now refuses `TESTED` on a stub receipt, and the
  Action's self-test asserts exactly that.
- **F2** — an empty generation was judged and scored, a judge reply with no
  score became a zero, and a suite with no cases wrote a receipt.
- **F3** — the summary's band was a different statistic from the row's, and for
  one case it printed a zero band. `results.aggregates.band_rule` states the
  formula, and a band the formula cannot form is null, never 0.
- **F4** — a generation cut at the output cap was judged as complete. Every draw
  records `stop_reason` and `truncated`; a truncated draw is unmeasured and
  never judged, and `n_truncated` is counted.
- **F5** — a non-numeric cap parsed to NaN and the guards compared against it.
- **F6** — an unregistered model id ran to completion.
- **F7**, found by the review rather than by the brief — the shipped badge
  rendered a receipt whose hash does not verify, and `diff` and `export` warned
  and carried on.

Also: the surface's echo is read on every lane and attested on canonical ids, so
a different model fails closed; `run.judge.model_id` and `prompt_template_hash`
say which judge ran, and `diff` verdicts nothing across two of them; the skill
loader and the post-checks are bounded.

### Spec 025 — the site, measured in a browser instead of read out of a stylesheet

The design pass re-cut every page: two self-hosted subsetted families
(**19,600 bytes** of font, `specs/025-design-pass/PACKET.md`), one file holding
every design value, one receipt template, one report card shape, a header that
collapses to a wordmark and one disclosure, and a description per report.

The part worth reading is why it needed a second pass. A single rule —
`main { max-width: 720px }` — was clamping every section on the site to 672
pixels at a desktop viewport, and **every structural assertion was green the
whole time**, because a rule that exists and a rule that wins are different
facts and only a layout engine knows which is which. The gate now serves the
built tree over loopback and opens all 20 sitemap pages in Chromium at two
viewports (`scripts/render-check.mjs`), and three defects fell out that no
source scan could see: a receipt card that rendered on the wrong ground while
its stylesheet said white; two published pages that scrolled sideways on a
phone, because a sha256 is 64 unbreakable characters and Report 008 carries two
of them in prose; and the contrast harness reading a translucent background as
solid. Contrast is now measured over **727** real foreground/background pairs
the browser produces and nobody curates, worst pair **4.71:1** against a 4.5
bound (`specs/025-design-pass/evidence/gate-details-final.json`).

Nothing on the site changed what it says. The scope rule of that loop was an
allowlist of copy changes written before the work, held in both directions:
every page's rendered text equals its text at the base transformed by exactly
the recorded passages, and every recorded passage applies
(`specs/025-design-pass/copy-changes.md`).

### The two you cannot see

**Spec 021 — the carry list, and six controls that were lying about their
scope.** Six assertions in the site gate measured *what one loop's migration
did* and were named as *properties of the site*. Each had been red since well
before this release — on the 019b rebase, on Report 008's promotion, on v0.8.0,
on v0.8.1 and on `main` itself — and a reader who learns to skip a red is being
trained to skip a control. Five were re-scoped to the range their own spec
records; the sixth could not be, because it is the only mechanical enforcement
of the constitution's report-immutability rule and the design pass was about to
re-cut every generated file, so it became a **content freeze**: a report's body
outside its Amendments section must match a tracked digest, Amendments may only
grow, chrome may change freely. The freeze is itself asserted against the
manifest at the merge base, so "edit the body, update the digest, commit both"
is red rather than green. The same loop split the spec 020 carry list into a
tooling lane and a design lane, **58** items tagged 15 / 31 / 12 (`DECISIONS.md`,
2026-09-03, *The carry list is partitioned into two lanes*).

**Spec 027 — the confidentiality scan classifies before it scans.** The blocking
deny-list scan used to read every file in the tree as UTF-8. A lossy decode is
not a reading of a file, it is a different string: one committed screenshot
decoded, at one compression offset, into a deny-listed acronym that `grep` does
not find in the file, and it held the source gate red. Every file is now
classified first and **no class is a skip** — text is scanned as before; a
recognised binary is scanned over the regions of its format that can carry text
(a PNG's text chunks, inflated, and not its pixel data; a woff2's name table,
and not its outlines); and **a file matching no recognised signature takes the
gate red**, naming the file and the reason. Skipping binaries by extension, and
skipping anything that fails a UTF-8 round trip, were both rejected: they are
the one shape a confidentiality control must never acquire, a file it stops
looking at. At the 027 merge that walk was 947 files — 925 text, 17 png, 5
woff2, **0 unrecognised, 0 hits** (`DECISIONS.md`, 2026-09-05, *Spec 027
merged*).

### What it changes about numbers already published

Nothing. Every archived receipt validates against its own frozen schema and
re-derives by its own rule; `badge`, `export` and `diff` over the archive are
identical to 0.8.1's, except that the two incomplete receipts (reports 006 and
007) now badge `not measured`, which is what they are. No report body moved.

### The gates behind this release

Every figure below is the confirmation run recorded at
`specs/026-receipt-integrity/evidence/merge-gates-20260906T095315Z.txt`, on
`dev` = `main`, and each is re-run unchanged at the version bump and preserved
whole under `specs/026-receipt-integrity/evidence/release-v0.9.0/`.

| gate | result |
| --- | --- |
| spec 026 | 81/81 |
| repo gate, source tree | 616/616 |
| repo gate, published tree | 602/602, source-only delta 14 |
| spec 026 nested merged-tree run | 79/79 |
| spec 020 | 173/173 assertions |
| spec 021 | 58/58 |
| spec 025 `--final` | 113/113 |
| spec 027 | 61/61 |
| specs 022, 023 and 024 | one, three and one accepted red |

The five accepted reds are version and byte freezes pinned to bases this
release has spent — spec 022 AC-8, spec 023 AC-6 and AC-7, spec 024 AC-8. They
are named rather than fixed, and the loop that re-scopes them is in the list
below.

### Known open

- **The methodology page owes a pass.** Spec 026 moved `lib/diff.js` three
  times, `spec/RECEIPT.md` twice and `spec/receipt.schema.json` once, and
  touched neither `docs/methodology/index.html` nor the glossary in
  `scripts/build-site-pages.js`. The trigger to name in that pass is the receipt
  schema's move to v0.6; the differ's judge comparison and the band rule moved
  with it. This is a real documentation gap on work that has already merged, and
  it is the guard that found it rather than a reader.
- **Five accepted reds across specs 022, 023 and 024**, each a freeze pinned to
  a base this release spent. The durable fix is a tooling loop that re-scopes
  them; it is not scheduled.
- **Seven non-blocking findings from spec 026's approval**, carried by name and
  none fixed: one misfiled table row, four assertion scopes narrower than the
  criteria they serve, one undeclared character-class translation, and one stale
  version line (`DECISIONS.md`, 2026-09-06, *Spec 026 merged*).
- **Two merge-base reads that go vacuous rather than red** when `main` equals
  `HEAD`, at `specs/020-site-relaunch/gate.mjs:1159` and
  `specs/021-gate-and-tooling-carry/probes/bodyfreeze.mjs:125`. Measured, not
  fixed.
- **The lossy-decode class is latent in three other blocking scans** that still
  read every file as UTF-8 — the rename scan, the hygiene scan, and the
  credential-format scan. Measured over every non-UTF-8 file in the tree, none
  produces a hit, so this is exposure and not damage.
- **The published tree's source-only assertion delta is 14 against a stated
  allowance of 5.** Inherited from Report 008's promotion, measured on both
  trees, carried since spec 027.
- **An approval still cannot see a merge-unstable assertion.** Four times now,
  an assertion correct on its branch went red the moment `main` absorbed it,
  because approval runs the spec gate on the branch and nothing runs it on a
  merged tree. The carried fix is a merge-simulated run inside the approval
  step.
- `--keep-transcripts` retains the last measured draw of each case and mode
  only; earlier draws' hashes are checkable against nothing on disk. Stated,
  not moved.
- Consolidating the input contract into one shared module (028's decision 1).

---

## v0.8.1 - 2026-09-03

Spec 023, on the branch `spec/023-action-input-hardening` from `c5e5454`.
**`package.json` reads 0.8.1**, and the Action pins in `README.md` and
`docs/index.html` are `@v0.8.1` with it; the pin on the page is derived from
`package.json` through `stats.json`, not typed. The change that earns a patch
version is `action.yml`: it hardens a surface published on the Marketplace, so
the tag adopters are told to use has to move to a commit that carries the fix.
**The npm publish and the git tag are still a separate human step**, and this
entry is written before both, after approval.

### What shipped

- **The Action's inputs are data, not shell.** `action.yml` used to substitute
  `${{ inputs.skill-dir }}`, `${{ inputs.models }}`, `${{ inputs.max-usd }}`
  and `${{ inputs.max-calls }}` straight into an inline `run:` script, and the
  enforce step did the same with `${{ steps.run.outputs.verdict }}`,
  `${{ steps.run.outputs.delta }}`, `${{ inputs.fail-on-regression }}` and
  `${{ inputs.models }}`. GitHub replaces an expression with its text before
  bash parses the script, so a value carrying a quote, a semicolon, `$(...)`, a
  backtick or a newline ran on the runner as a command (audit finding A1,
  High, confirmed by two external audits and the hand audit of 2026-09-03).
  Every input now crosses into the shell as an environment variable set by the
  step's `env:` block, `INPUT_SKILL_DIR` and so on, and the step bodies live in
  `action/run.sh` and `action/enforce.sh`, which reference those variables only
  double-quoted. No `run:` line in `action.yml` or the self-test workflow
  contains an expression. The spec gate executes the real scripts with a
  payload carrying all five characters in each input and asserts nothing runs;
  its mutation executes the v0.8.0 step from git with the same payload and
  watches four marker files appear.
- **The refusal is proved on a real GitHub runner, in public** (spec 024).
  Spec 023's payload tests live under `specs/`, which the public build
  excludes, so the self-test workflow that ships used to prove only that the
  environment-variable plumbing works end to end. It now passes one hostile
  value, carrying a double quote, a semicolon, `$(...)`, a backtick and a
  newline, through each of the five inputs of the real `action.yml` on the
  runner, and fails the job unless every one is refused before anything ran:
  no marker file from the payload, no receipts directory, every step outcome
  `failure`, and the `::error` line naming each input from the shipped script
  under the same mapping. A control step pastes the payload into a script the
  way v0.8.0 did and requires four markers to appear first, so the mechanism
  is shown live before it is relied on. A directory named with the same
  characters then runs as data (verdict PASSED), and a receipt whose model id
  carries a newline is shown to add nothing to `$GITHUB_OUTPUT` through
  `badge --github-output`. The benign run is the run on that hostile-looking
  directory: the action runs to success exactly once per job, because
  `action.yml` uploads its receipt under one fixed artifact name and
  `actions/upload-artifact` v4 refuses a second upload of a name on the run
  (spec 024 v1.1, after the first approval was rejected for exactly that).
  Everything runs under `DRIFTPROOF_STUB=1`: no key, no spend. The spec's
  gate builds the public tree with `build-public.sh`, executes the workflow's
  own blocks against it under the shell options the runner uses, walks the
  whole job step by step with the composite's upload modelled on the pinned
  action's contract, and executes the blocks against the v0.8.0 action from
  git, where the workflow's assertion goes red on the marker. v0.8.1
  therefore publishes with real-runner hostile-input proof, not
  plumbing-only proof. No version bump: nothing about a receipt or the npm
  artifact moved, and the tag did not exist yet.
- **Inputs are validated before use.** `models` must be comma-separated model
  ids over `[A-Za-z0-9._-]`; `max-usd` a positive decimal; `max-calls` a
  positive integer; `fail-on-regression` exactly `true` or `false`; `skill-dir`
  an existing directory with no control character. Anything else fails the
  step with `::error title=Driftproof::<input>: ...` before a directory is
  created or a model call is projected. A run at the declared defaults is
  unchanged.
- **`$GITHUB_OUTPUT` entries are heredocs with a random delimiter, and a line
  break is refused.** `lib/verdict.js` wrote `message=<word> on <model_id>` as a
  bare `name=value` line, and `model_id` is any string a receipt carries: a
  `.driftproofrc` in a skill directory sets it, and a newline in it appended a
  second, attacker-chosen output entry that the enforce step then interpolated
  into its shell (A6, High when chained with A1). The writer now emits
  `name<<ghadelim_<32 hex>` blocks with a delimiter drawn from
  `crypto.randomBytes` for every entry, and throws before writing anything if a
  value carries `\r` or `\n`; the shell writes the `receipt` entry the same
  way. Inside the Action the chain needed the rc to win over `--models`, which
  it never does because the Action always passes the flag; the writer is fixed
  regardless, because `driftproof badge --github-output` is also a command an
  adopter can put in their own workflow.
- **Full-SHA pins and a fail-closed install** (A9, Low). `actions/checkout`,
  `actions/setup-node` and `actions/upload-artifact` are pinned to the commits
  their `v4` tags resolved to on 2026-09-03, with the release in a comment. The
  install step no longer falls back from `npm ci` to `npm install` when the
  lockfile disagrees with the manifest.
- **`RUNNER_VERSION` moves to 0.8.1**, RUNBOOK precondition 3, held by the repo
  gate. It is stamped into `runner_version` on every receipt written from here
  on, so it reached the sample receipt in `README.md` and
  `tests/fixtures/export-summary.snapshot.json`, whose `receipt_hash` is a hash
  over a receipt that carries the field; only those two fields of the snapshot
  moved, checked field by field before re-pinning.

### What did not change

What `driftproof run` measures. `bin/driftproof`, every measurement module in
`lib/`, the receipt schema and the model registry are byte-identical to
`c5e5454`, `config.js` differs on the `RUNNER_VERSION` line alone, and the
verdict rule and the badge JSON are compared to base by execution. A receipt
from 0.8.1 differs from one from 0.8.0 in the version stamp and therefore in
its hash, and in nothing else.

### The gates, re-run rather than remembered

Spec 023 **24/24**, no live layer, no spend. Repo gate on source: see the
spec's `tasks.md` for the count at the approved commit; two existing
assertions were reversed rather than weakened (the one that asserted the
`${{ inputs.max-usd }}` interpolation reaches the CLI, and the one that matched
`verdict=PASSED` in the writer's output) and a mirror section was added, so
the count went up. Spec 020's site gate fires its version-freeze criterion on
this bump exactly as it fired on v0.8.0; recorded in the spec-021 carry list,
not fixed here.

### What did not ship

- **The npm publish and the `v0.8.1` tag.** The version is bumped here; nothing
  is published or tagged. Until the tag is pushed, `@v0.8.1` does not resolve,
  and `@v0.8.0` on the Marketplace still carries the interpolation.
- **The push to the public tree.**
- **The other audit groups.** S3 skill-dir input validation (including the
  model-id charset at the receipt, N12, which is the root the writer now
  refuses at the edge), S4 to S9, and the spec-021 carry list, unchanged.

### Known open

The spec-021 carry list in `specs/020-site-relaunch/tasks.md`, plus one more
firing of its F-R5 shape on this bump, recorded there under spec 023.

---

## v0.8.0 — 2026-09-03

Spec 019b, merged at `dfcd863` on the approval record naming `771df91`, plus the
Report 008 promotion on top of it. **`package.json` reads 0.8.0**, and the Action
pins in `README.md` and `docs/index.html` are `@v0.8.0` with it; the pin on the
page is derived from `package.json` through `stats.json`, not typed. The change
that earns a minor version is `config/models.json`, which ships inside the
package. **The npm publish and the git tag are still a separate human step**, and
this entry is written before both.

### What shipped

- **`claude-fable-5-1` registered, with its price bound to a dated snapshot.**
  The registry row carries input 10 and output 50, and
  `specs/019b-fable-5-1-registration/evidence/docs-pricing-snapshot-2026-09-01.json`
  is the file it is asserted against, field by field, by the spec gate. **The
  registration moves no projection and the spec says so**: `DEFAULT_PRICE` in
  `lib/models.js` already priced an unregistered id at the same 10/50, so the
  projection a cost guard produces is unchanged. What changes is that a receipt
  now stamps `registry: "registered"` instead of falling back, and that the price
  has a dated, named source rather than a default. `claude-fable-5` is retained at
  unchanged prices, annotated `lifecycle: "legacy"`.
- **Report 008, release drift, `claude-fable-5-1` against `claude-fable-5`.**
  Two cells, 14 cases, and the tally on the release axis is **0 improved · 0
  regressed · 14 within noise · 0 not measured**. Both cells came back within
  noise. The skill `content_hash` and `suite_hash` were asserted identical on
  both sides before the first call, and it is the first release pair in this
  project where both sides are generation-sampled receipts, which is what makes
  the delta attributable to the model rather than to the instrument. One case is
  held inside the verdict by the effect floor rather than by band overlap, and
  the page names it rather than leaving it in a table.
- **Report 007 v1.1, an economics amendment.** Twenty-eight inserted lines, zero
  deleted: the v1.1 notice, the table re-priced on the fresh-input basis, and the
  retraction of a mechanism sentence that rested on an uncontrolled basis. No
  published figure above the block is edited, which is what the block claims and
  what the diff shows.
- **`RUNNER_VERSION` moves to 0.8.0**, which is RUNBOOK precondition 3 and which
  the repo gate asserts rather than the release note claiming it. It is stamped
  into `runner_version` on every receipt written from here on, so it reached two
  further places that are checked: the sample receipt in `README.md`, and
  `tests/fixtures/export-summary.snapshot.json`, whose `receipt_hash` is a hash
  over a receipt that carries the field. **Only that one field of the snapshot
  moved**, verified field by field before it was re-pinned; the interchange shape
  the fixture exists to freeze is untouched. Worth writing down: a fixture
  described as a frozen v1 contract carries a value that changes on every version
  bump, so "frozen" is true of its shape and not of its bytes.

### What the promotion changed, which was supposed to change nothing

Three places in this repository asserted that Report 008's draft state lived in
its path alone, that nothing in the page bytes marked it, and that promotion was
therefore a rename that re-checked nothing. All three were measured wrong at
promotion, and the correction is the most useful thing in this release.

- **The head is not path-independent.** `build-head-tags.js` keys report pages on
  `^reports/(\d+)/index\.html$`, which `008-draft/` does not match. Losing the
  suffix changed the title from the page's own `<h1>` to the `reports.json` form,
  dropped `-draft` from canonical and `og:url`, and replaced a bare `WebPage`
  JSON-LD with a `TechArticle` carrying headline, `datePublished`, publisher,
  license and a `hasPart` Dataset list. The draft was reviewed without the
  structured data it now ships. The page is re-rendered from its receipts, not
  carried across, and the three stale comments are corrected in place.
- **Report 008 rendered its verdicts as bare text.** Every other report wraps a
  verdict cell in the styled `.v` pill; 008 did not, so it was the one report
  whose verdicts rendered unstyled and the one `tests/essay-grounding.js` could
  derive no tally from, since that oracle reads `span.v`. Both were invisible
  while the page sat at a path every site-wide check skipped.
- **The tally the oracle then derived was incoherent**, summing the release-axis
  table and the within-report lift table into one figure, with a parenthesised
  label its own regex cannot match in prose. The page now states its release-axis
  tally in the form the rest of the site uses.
- **`README.md`'s latest-report link was left on 007** while `stats.json` had
  moved to 008. Caught by AC-30's derived-opening check, which composes that
  block rather than pattern-matching it.

### The gates, re-run rather than remembered

Spec 019b **8/8**. Repo gate **566/566** on source. Spec 020 site gate
**163/168** with `--final` and **160/165** without, the same five failures in
both: AC-21, AC-30, AC-31, AC-35 and NFR-5. All five are one class, recorded as
F-R1, F-R4 and F-R5 in the spec-021 carry list: migration-diff assertions written
to fence spec 020's own loop, evaluated on every later branch as if they were
evergreen site invariants. Each fires on this release's legitimate changes and on
nothing else. **AC-31 is the clearest case of the shape**: it asserts "the version
is unchanged: this loop does not publish", which was true of the loop it was
written for and is the opposite of what this release does.
No probe reached a provider in the promotion or in any gate run above.

### What did not ship

- **The npm publish and the `v0.8.0` tag.** The version is bumped here; nothing
  is published or tagged. A pin that names a tag which does not exist yet is the
  defect DECISIONS recorded for `v0.6.0`, and the RUNBOOK's precondition is that
  the tag is pushed first. Until it is, `@v0.8.0` does not resolve.
- **The push to the public tree.**
- **Any fix to the findings below.** They are carried, not resolved.

### Known open

**1. From the 019b approval**, `evidence/approval-20260903T023152Z.md`, verdict
approved-with-findings, none blocking. Its F1 and F6 are resolved; five are not:

- **F2** — `spec.md` declares base `3ce57d3`; the real merge-base is `77816f7`.
- **F3** — AC-3's receipt-reference clause matches on the filename, not on the
  receipt body. The clause is decorative; AC-3's stated criteria are genuinely
  asserted.
- **F4** — the AC-2 and AC-5 mutation controls re-implement the comparison they
  plant against instead of driving the asserted one. The planted violations are
  caught by a copy of the logic, not by the logic.
- **F5** — AC-4's assertion reads `lib/cost.js` alone while the claim it guards
  names all of `lib/`. The claim is true today and the gate would not redden if
  it stopped being.
- **F7** — AC-2 is a DECLARED-level snapshot recorded in the same session as the
  registry row, so it proves two files agree, not that either matches the vendor.
  Mitigated here only because the registered price equals `DEFAULT_PRICE`.

**2. From the supplementary examination**,
`evidence/examination-20260903T024546Z.md`. Its E3 is closed by the gate receipt
that pins `4a3115e`; three remain:

- **E1** — the 165/168 site-gate figure is a `--final` figure; a plain run is
  162/165. Cite the flag wherever the count is cited.
- **E2** — NFR-5's offender set is five paths, not four: the assertion filters on
  `^(receipts|reports)/`, so the run record is in scope alongside the receipts.
- **E4** — `e9feab1` changed `site-chrome.js` and `site-data.mjs`, the data layer
  for every report page, from a single-feature branch. Verified harmless in fact
  rather than assumed: every page re-derives identically. The blast radius was
  the whole site.

**3. The spec-021 carry list**, recorded in
`specs/020-site-relaunch/tasks.md` under the 019b rebase heading:

- **F-W1** — `scripts/release-watch.js` writes `auto_added` rows into the tracked
  `config/models.json` of the dev worktree. It has dirtied a gate run once and
  blocked a rebase once.
- **F-W2** — the row it wrote priced `claude-fable-5-1` at 5/25 against the docs
  snapshot's 10/50, and dated the release two days later. The disagreeing source
  is unidentified, which is why no auto-added row should be trusted until it is.
- **F-R1** — AC-21, AC-35 and NFR-5 are migration-diff assertions evaluated as
  evergreen invariants. They will fire on every future report-publishing branch.
- **F-R2** — the TL;DR card counts every receipt the page links and points that
  count at one directory. Report 007 ships the mismatch; Report 008 widens it.
- **F-R3** — `.gitignore` line 42 matches `specs/*/gate-results.json`, so a gate
  receipt written where the gate writes it cannot be committed, and a run leaves
  no artifact behind it.
- **F-R4** — AC-30's second half freezes `README.md` against spec 020's base and
  is the fourth instance of F-R1, found by this release tripping it. **AC-30's
  first half is not carried**: it caught a real staleness here and must not be
  retired alongside the freeze.
- **F-R5** — AC-31's second assertion, *the version is unchanged: this loop does
  not publish*, compares `package.json` to spec 020's base. It is a statement
  about that loop's own scope, frozen as though it were a site invariant, so it
  reddens on any later release that bumps a version. It fires here because the
  version bump to 0.8.0 is the point of the release. **Dispositioned, not
  silenced**: AC-31's first assertion, the mandated keyword list in order, is
  unaffected and still passes.

**4. One governance limit, recorded on the approval itself.** Finding A1 of
`evidence/approval-20260903T030227Z.md`: the approval session's own identifier
appears on the `Claude-Session` trailer of two commits in the merged range,
`e9feab1` and `4a3115e`. The build context was cleared, so no transcript was
available to the approval, but identity isolation did not hold for those two.
Neither rests on that session alone — both sit inside the thirteen examined by a
different session, and across the whole range every commit touching anything
outside `specs/*/evidence/` carries an examination or approval written by a
session other than its author.

### Amendments

**v0.8.0, amendment 1** · 2026-09-14. This amendment corrects how this entry's within-noise wording is read; the entry is left as written, no figure changes, and the release it describes is unchanged. The entry says Report 008's tally was *"0 improved · 0 regressed · 14 within noise · 0 not measured"*, that *"Both cells came back within noise"*, and that *"One case is held inside the verdict by the effect floor"*. The tally counts the with_skill arm's fourteen cases across the release. None of them was separated under the rule at the sample size used: no separation detected, which is not evidence of equivalence and not evidence that nothing changed. The one case the floor keeps in has bands that do not overlap and a move below the 0.05 effect floor, so it is not separated under the rule. Across the same release one baseline case, severity-labeled-findings, separated under the rule, which is not proof that the baseline changed. The entry's *attributable to the model rather than to the instrument* reads past a runner version that also changed, from 0.6.0 to 0.7.2. Filed under the wording rules of the repository's spec 031, amendment A-031-20.

---

## Site relaunch — 2026-09-02

Spec 020, merged at `eeafcc8`. **No version change and no npm publish.** Nothing
under `lib/`, `bin/` or `config/` moved and `package.json` stays at 0.7.2; the
two fields of it that did change are the keyword list and `html-validate`, the
first devDependency this repository has carried.

This finishes the sentence v0.7.2 started. That release stopped maintaining an
index by hand and derived the sitemap instead. This one does the same thing to
the pages themselves: the site was a set of hand-written HTML files that each
restated the project's own numbers, and it is now a template plus a data layer,
with every number read out of the receipt it comes from.

### What shipped

- **A brand kit.** The glyph in its three states — separated, overlapping,
  refused — favicons, an apple-touch icon, and `docs/tokens.css` as the single
  place a colour or a type scale is declared.
- **A data layer.** `scripts/site-data.mjs` derives `docs/data/reports.json`,
  `stats.json` and `sources.json` from the receipts, and `scripts/band-plot.mjs`
  draws one band plot per measured cell — 121 of them, committed. No page states
  a figure it does not read from this layer.
- **A rendered site.** `scripts/build-site-pages.js` renders ten pages from that
  data. `--check` re-renders them and fails if what is on disk differs, so a
  hand-edit to a generated page is now detectable rather than merely discouraged;
  that check runs on every gate invocation, not only the final one.
- **Injected chrome on the report pages.** `scripts/site-chrome.js` adds the
  TL;DR block, nav, footer and script tags to the seven published reports, with
  the bodies asserted byte-identical to their base outside the injected fences.
- **Metadata on all 23 published pages.** Titles, descriptions, canonical links,
  OG and Twitter card tags, eight content-addressed per-report cards, and JSON-LD
  — each derived from the page's own content by `scripts/build-head-tags.js`,
  none hand-written.
- **Indexability.** A `/reports/` index, `robots.txt` (a 404 on the live site
  until now), `feed.xml`, a 404 page, clean document paths with redirect stubs
  the sitemap resolves, and `llms.txt` — deferred by v0.7.2 for being a stale
  hand-written draft, delivered here as a generated file.
- **Two new pages**, `/glossary/` and `/report-types/`.
- **Measurement and subscribe slots driven by config.** Where
  `docs/site.config.json` sets a token, the template renders the analytics
  beacon, a verification meta tag or the email form; where a field is unset it
  renders nothing at all, with no placeholder left behind.
- **Progressive enhancement.** An island loader and the band playground, with
  every page's content readable with JavaScript off.
- **The gate grew with the site.** Spec gate 168/168 (`--final`). Repo gate
  555/555 on source, re-run on the merged tree, and 550/550 on a published tree
  of 439 tracked files; source-only delta 5 of an allowed 5, unchanged.
- **$0.00.** No probe in this loop reached a provider.

### What did not ship

- **Re-punctuation of four documentation pages.** `methodology`, `interop`,
  `judge-policy` and `authoring` carry about fifty spaced hyphens between them.
  This loop moved them to clean paths and did not rewrite them; AC-42 defers
  them, and the deferral is bounded by an assertion rather than by this sentence.
- **Two `&mdash;` entities** on one line of
  `docs/writing/three-releases/index.html`, a file this branch never touched.
- **The body of `README.md` below its opening block**, frozen byte-for-byte
  against the branch base by AC-30. It still writes `Report #001` through
  `Report #007`.
- **The publish.** This entry is written before the publish, not after it, and
  the loop pushed nothing to the public tree.

### Known open

Four groups, none of them a live violation on this tree. Each is a control that
protects less than its wording claims, an amendment proposed and not applied, or
an operational defect recorded rather than fixed.

**1. The spec-021 carry list**, recorded in full under "Carried to spec-021 (gate
hygiene)" in `specs/020-site-relaunch/tasks.md` and not restated here: F-1, F-2,
F-3 and F-15 from the third approval; F-D and F-E from the record that rejected
the fifth-pass packet; F-B from the fourth; the 27 control gaps filed as
recorded-not-blocking by `evidence/approval-20260902T103530Z.md`, less the three
the sixth pass closed (AC-36, AC-37's from-scratch clause, and the AC-9 and AC-13
backstops); and the gate's own header, which claims it was red on every criterion
when it was committed and was measured green on three.

**2. The five findings from the sixth approval**,
`evidence/approval-20260902T113400Z.md`, verdict approved-with-findings, none
blocking:

- **F-020-1** — the repository's traceability tool cannot run on this spec at
  all. It requires `gate.sh` and `### AC-n` headings; 020 ships `gate.mjs` and
  writes `**AC-n.**`, and is the only one of nineteen specs without a `gate.sh`.
  Closure was re-derived by hand: 43 criteria, every one carrying a task and at
  least one assertion, no orphan on either side.
- **F-020-2** — AC-39's newest publish-build log was produced before the tree it
  attests to was pinned, and names no commit, so the assertion cannot see the
  gap. The substance was re-derived on the pinned tree by the approving session.
- **F-020-3** — AC-21 states byte-identity outside the injected chrome but
  windows its comparison to `<main>`. Three of the five fences on a report page —
  `nav`, `foot`, `scripts` — fall outside that window and are never compared to
  the base.
- **F-020-4** — two of AC-23's named `llms.txt` link targets, the methodology
  page and `spec/RECEIPT.md`, have no assertion. Both are present today.
- **F-020-5** — the classification's data-sensitivity row reads "no PII" while
  the shipped subscribe form posts a visitor's email address to a third party,
  with no privacy line beside the field. The tier is unaffected; the row the tier
  was read from is wrong.

**3. The `receipt.sh` amendment**, proposed in DECISIONS on 2026-09-02 and
deliberately not applied from inside a loop running under it: the writer should
JSON-escape the description it interpolates, and the results line it parses
should not be delimited by a character an assertion name may legally contain.
Two receipts committed in this loop report a green gate and are not parseable
JSON, and nothing noticed, because nothing reads a receipt back.

**4. Release watcher wrote to the shared checkout.** At 2026-09-02 00:14:55 the
`driftproof-release-watch` timer ran with `WorkingDirectory` `~/driftproof`, the
main checkout, and appended a `claude-fable-5-1` row to `config/models.json` with
auto-discovered prices of 5 input and 25 output, half the hand-verified values
registered by `spec/019b` in `4ecd0a8`. It then failed its cost guard (projected
840 calls against a cap of 500), recorded the attempt as failed in
`state/trigger-attempts.json`, and left the tracked file modified and uncommitted
in a checkout the spec-020 merge was about to use. The write was preserved as
`~/scratch/models-json-release-watch-20260902T0014.diff` and `config/models.json`
was restored to the tracked version before merge; nothing from it shipped.
Carried to spec-021: the watcher runs in its own worktree or writes to a staging
file, never a tracked file in the main checkout; and its default price for an
unregistered model must not under-estimate, so it uses the highest known tier or
refuses to append.

---

## v0.7.2 — 2026-09-01

**Docs-only. Nothing under `lib/` or `bin/` changed**, and the gate asserts that
rather than the release note claiming it.

One precision, because "docs-only" is a claim about behaviour and not quite about
the file set. Moving `package.json` to 0.7.2 drags three files with it, each by a
rule older than this release: `config.js`'s `RUNNER_VERSION` must equal the
package version, the sample receipt in `README.md` must carry that same
`runner_version`, and `tests/fixtures/export-summary.snapshot.json` records the
`receipt_hash` a built receipt has — which moves when `runner_version` moves.
`config.js` is a runtime constant, not documentation. Nothing else about what the
runner does changed, and `scripts/prepare-report-007.js` gained one call so that
its page still renders as a pure function of its receipts.

The instrument has been sound for five weeks and invisible for the same five
weeks. The site published with no analytics of any kind, no link-preview card,
and a `docs/sitemap.xml` maintained by hand that had already lost two reports —
it listed 11 URLs for a 13-page site, Search Console confirmed the 11, and
nothing failed. That last sentence is the whole argument for this release: an
index nobody derives is state that drifts with nothing watching it, which is the
failure this project exists to name.

### What shipped

- **Analytics.** Cloudflare Web Analytics, as the dashboard's own JS beacon,
  exactly once and last in `<head>` on every published page. **This is the first
  third-party script on the site.** Until now every page was static HTML plus one
  stylesheet, and the only third-party request anywhere was the shields.io badge
  on the home page; from this release every page makes a third-party request on
  every view. It sets no cookies, so no consent banner is required. The snippet is
  pasted rather than injected because the origin is GitHub Pages and the zone is
  not proxied — Cloudflare's automatic injection is a proxy-layer feature and this
  site's DNS is grey-cloud, so it was never available.
- **An OG card.** One static `docs/og.png`, 1200×630, opaque, under 22 KB,
  regenerated by `scripts/build-og-card.py` and committed. No figure is on it:
  an image cannot be gate-checked, so a count baked into one is a published
  number with nothing watching it.
- **Card tags.** `og:title`, `og:description`, `og:image`, `og:url` and
  `twitter:card` on all fourteen published pages, each derived from that page's
  own `<title>`, `<h1>` or headline paragraph by
  `scripts/build-head-tags.js` — never hand-written.
- **A generated sitemap.** `scripts/build-sitemap.js` derives the URL set from
  every `.html` under `docs/` that `build-public.sh`'s own `EXCLUDE_RE`
  publishes, with `lastmod` read from `git log`. The gate asserts **set equality
  in both directions**: one direction is how #005 and #006 went missing, because
  a sitemap listing 11 of 13 pages is a subset and a subset check passes.

### What did not ship

- **`llms.txt`.** The request scoped it to a drafted file in an audit note's
  §C; §C carries no such draft. One exists elsewhere in that document, predates
  Report #007, names six reports, and would put a stale index on the site — the
  same defect as the hand-maintained sitemap, one layer out and worse, because a
  model reading a stale index has no crawler to notice the gap. It is carried
  forward as a generator plus a bidirectional assertion, which is how the sitemap
  landed here.

### Known open

`docs/robots.txt` is still a 404 on the live site. `rel="canonical"` tags,
`schema.org` `Dataset` JSON-LD and per-page `<meta name="description">` for the
six report pages that lack one are drafted and unshipped. None of them was in
this release's scope, and none is blocked by anything in it.

The `lastmod` on all fourteen entries reads `2026-09-01`, because the head-tag
pass touched all fourteen files. That is accurate rather than informative; it
self-corrects the next time one page changes alone.

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

### Amendments

**v0.7.0, amendment 1** · 2026-09-15. This amendment corrects how this entry's band wording is read; no earlier text is changed, no figure changes, and the release it describes is unchanged. A case is separated under the rule when its two bands do not overlap and its mean moved by at least the 0.05 effect floor. The entry's *18 no effect* counts cases that were not separated under the rule at the sample size used: no separation detected, which is not evidence of equivalence and not evidence that the skill had no effect. Its *No cell separates*, *every lift smaller than its own band*, *none separates at the cell level* and *one apparent separation* compare a lift with its lift band, the two arms' suite dispersions combined in quadrature, which is not the separation rule: at case level 3 of Report 007's 21 cases separated under the rule, which is not proof, and the one apparent separation, run 1's lift outside its band, was not a separation under the rule. The five comparisons *refused on their baseline control* are four refused *on baseline non-reproduction* and one refused on a baseline with no measured draws. The four rest on baseline bands that did not overlap, a test with no floor, and against Report 006 two of the cases counted moved by less than the floor; such a refusal reads a separation detected, or bands that do not overlap, which is not proof that a baseline changed. The *sd 0.355* the entry gives for the homepage is Report 007's baseline band on semver-hidden-breaking-change, the sample standard deviation of that case's draw means. *single-draw, judge-spread figures*, said of Report 005's lifts, reads as lifts whose bands are the same quadrature of suite dispersions, over per-case means that each come from a single generation. Each band is a descriptive spread, not a confidence interval, with no coverage probability. Filed under the wording rules of the repository's spec 031, amendment A-031-20.
