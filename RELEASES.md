<!-- SPDX-License-Identifier: Apache-2.0 -->
# Releases

Newest first. Each entry states what shipped, what it changed about numbers
already published, and what it does **not** include. A release note that only
lists additions is an advertisement; the "Known open" section is the half that
makes this one a record.

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
