<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driftproof runbook

Operational procedures. Two things live here: how the **release trigger** works,
and the exact **approve-and-publish** sequence for a drafted report (the trigger
never publishes on its own — that is deliberate).

## The release trigger (what runs unattended)

`scripts/release-watch.js`, fired daily by a systemd `--user` timer
(`deploy/driftproof-release-watch.timer`):

1. Enumerates the currently-served models. **Keyless by default:** with no
   `ANTHROPIC_API_KEY` it diffs the models cache (`state/models-cache.json`, see
   below); with a key it upgrades to a live `GET /v1/models` list call (**never** a
   model inference call). OpenAI ids are diffed from the same cache keyless, or a
   live keyed poll when `OPENAI_API_KEY` is set — **never** via codex.
2. Diffs the served ids against the model registry (`config/models.json`) and the
   seen-models state file (`state/seen-models.json`).
3. On a **new** id: appends it to the registry (`released` = first-seen date,
   `auto_added: true`), then runs `scripts/prepare-report.js` for the pair
   (new vs its family predecessor, else a cross-family "capability gap" pairing).
4. `prepare-report.js` re-fetches the pinned skills, re-runs the Report-#001
   suites on the pair (n=5, under `TRIGGER_MAX_USD` from [`config.js`](config.js)
   — trimming to the highest-traffic skills if the projection is over cap), emits receipts to
   `receipts/report-NNN-draft/`, builds a **DRAFT** page under
   `docs/reports/NNN-draft/`, and writes a summary + verdict tally to
   `reports/pending-publish.md`. If `~/.moltbot` exists it also appends a line to
   `~/.driftproof-notify` (a local file — **never** posted to Moltbook).

**It does not publish.** The draft is `noindex`, is **not** linked from the site
index, and is **not** pushed to the public tree. Idempotency: a model already in
`state/seen-models.json` never re-triggers; a *failed* prepare run is retried no
more than once per day.

**Timer state, 2026-09-03: DISABLED, and not to be re-enabled by a code change.**
The release watcher runs `prepareReport`, which runs the evaluated skills on the
cli surfaces. It now does so through the eval-user hop (below) like every other
caller. Re-enabling the timer is a separate human decision, gated on one clean
**isolated three-cell run** of a report suite through the hop, verified by hand
against the canary check in `specs/022-eval-user-isolation/gate.sh`. Until then
`systemctl --user list-timers` should show only the models-cache refresher.

### Install / operate the timer

```sh
bash deploy/install-timer.sh                 # install + enable the --user timer
systemctl --user list-timers driftproof-release-watch.timer   # confirm next fire
systemctl --user start driftproof-release-watch.service        # run once now
journalctl --user -u driftproof-release-watch.service -n 50    # logs
```

A live keyed poll (the optional upgrade) needs a key in `~/.driftproof.env` — add a
single line naming the `ANTHROPIC_API_KEY` variable, then `=`, then your key
(standard env-file format). The poll only makes a models-LIST call, never a model
inference call. Without a key the watcher runs keyless off the cache (below) — it
is never fatal.

Dry-run / mock (no key, no writes):

```sh
node scripts/release-watch.js --dry-run --models-file <mock.json>
```

### The eval user (operator prerequisite for every cli run)

Since spec 022 every `claude` / `codex` spawn on the cli surfaces runs as a
dedicated unprivileged user through `sudo`, from an empty environment. The code
never creates that user, edits sudoers, or logs a CLI in; the operator does, once:

1. Create the user with a mode-700 home and no supplementary groups:
   `sudo useradd -m -s /bin/bash driftproof-eval && sudo chmod 700 /home/driftproof-eval`
   (the name is configurable with `DRIFTPROOF_EVAL_USER`; it must match
   `^[a-z_][a-z0-9_-]{0,31}$`).
2. As that user, install `claude` and `codex` under `~/.local/bin` and log each
   one in (`claude` device flow, `codex login --device-auth`). Their session
   files then live in that user's home, unreadable to yours and vice versa.
3. Grant the operator account `NOPASSWD` as that user only, in
   `/etc/sudoers.d/driftproof-eval`:
   `ec2-user ALL=(driftproof-eval) NOPASSWD: ALL` (substitute the operator name).
4. Verify the boundary by hand before the first run:
   `H=/home/driftproof-eval; sudo -n -u driftproof-eval /usr/bin/env -i HOME=$H PATH=$H/.local/bin:/usr/bin:/bin bash -lc 'env; claude --version; codex --version'`
   must list no variable from your shell, and a probe such as
   `node -e "require('./lib/provider').complete({prompt:'Reply PONG',model:'haiku'}).then(r=>console.log(r.text))"`
   must return through the hop.
5. Run the spec gate live: `bash specs/022-eval-user-isolation/gate.sh`. It plants
   a secret in your environment and a file under your home, runs a fixture skill
   that tries to read both, and asserts neither reaches a transcript, receipt or
   judge input; it then runs the same fixture with `--trusted-skill` and requires
   that check to go red. Two runs on the haiku lane, one case each.

`--trusted-skill` is for a skill you authored yourself, on a machine with no eval
user, and for nothing else.

### Keyless enumeration (the models-cache refresher)

This box runs **keyless by design** (no vendor API key). Since the vendors' own
models-LIST endpoints require a key, a second daily timer supplies the diff surface:

`scripts/refresh-models-cache.js` (`deploy/driftproof-refresh-models-cache.timer`,
fires ~23:00 UTC — about an hour **before** release-watch) reads a **public,
no-auth** enumeration surface — OpenRouter's `GET /api/v1/models` — keeps the
`anthropic/*` and `openai/*` entries, maps each to its native id (strip the vendor
prefix + billing suffix; Anthropic version dots → dashes, e.g.
`anthropic/claude-opus-4.8` → `claude-opus-4-8`; OpenAI keeps its dots), and writes
`state/models-cache.json` = `{ fetched_at, source, ids[] }`. release-watch diffs
that cache an hour later. The refresher is **never fatal**: a fetch/parse failure —
or an empty result — keeps the existing cache and exits 0, so a transient blip
never wipes the surface or blocks the poll.

> **Disclosure — detection latency.** Keyless detection keys off a third-party
> aggregator (OpenRouter), whose catalog can lag a vendor's own announcement by
> hours. That lag is accepted: the watcher only prepares a *draft* for human review,
> so a few hours' delay costs nothing. A keyed poll (add `ANTHROPIC_API_KEY`) removes
> the aggregator from the path if you ever want first-party immediacy.

**Adopting a broader surface — baseline first.** The aggregator lists far more ids
than the curated registry (historical models like `gpt-4o`/`o1`, plus `-fast`/`-pro`
serving variants). To avoid drafting a report for every one of them the first time,
baseline the current snapshot so only ids appearing in a *later* snapshot fire:

```sh
node scripts/refresh-models-cache.js                     # write the cache
node scripts/release-watch.js --dry-run --models-cache state/models-cache.json \
     --state-dir /tmp/bf --no-notify                     # review new-vs-registry
node scripts/release-watch.js --seed-only                # baseline: mark all seen, trigger nothing
```

After `--seed-only`, a genuinely-new release (an id absent from the previous
snapshot) triggers exactly one draft, as normal.

## `TMPDIR` on this box: why it is `/var/tmp`, and where it is set

**`/tmp` here is a 1.9 GB tmpfs; `/var/tmp` is on the 40 GB root filesystem.** A spec gate
keeps a full copy of the tree, `.git` included, for every arm until it exits, so a few
running against `/tmp` fill it. On the release evening of 2026-09-13 (step 7c5) `/tmp` was
90% full, and the first runs of specs 007 and 008 died with *No space left on device*.
**Those runs measured the disk, not the gates**, and are cited nowhere.

**The fix is `TMPDIR`, not a gate edit.** Every spec gate, `scripts/build-public.sh` and the
repository gate honour it, so one variable moves all of them and no gate script is touched.
It is set, as of 2026-09-16, in two places, because neither covers the other:

```sh
# ~/.bashrc, for every interactive and login shell (a comment there says why)
export TMPDIR=/var/tmp

# the tmux server, so panes started in an existing session inherit it
tmux set-environment -g TMPDIR /var/tmp        # new sessions
tmux set-environment -t work TMPDIR /var/tmp   # the work session
```

`tmux set-environment` reaches only shells started **after** it runs; a pane already open
keeps the environment it was launched with, so check `echo $TMPDIR` in a long-lived pane
rather than assuming.

**Not a directory inside `$HOME`.** `build-public.sh` refuses a target there, so `~/tmp` is
not an option; `/var/tmp` is the directory outside the home directory on the root filesystem.

**Scratch accumulates and nothing prunes it.** Gates write `$TMPDIR/specNNN-gate-results-<UTC
stamp>.json` on every run and spec 026 keeps a whole sandbox per red run. Nothing reads a
previous run's file, so the dated ones are safe to delete **except** where a committed
evidence record names one: `specs/026-receipt-integrity/evidence/red/gate026-*.txt` ends with
*scratch kept at /var/tmp/...*, and several `evidence/gate-final-*.txt` cite their results
file by name under `<TMPDIR>`. Before deleting, collect what is cited and subtract it:

```sh
for r in $(git for-each-ref --format='%(refname:short)' refs/heads); do
  git grep -h -oE '(spec[0-9]+-gate-results-[0-9TZ]+\.json|spec026-gate-[0-9TZ]+\.[A-Za-z0-9]{4})' "$r"
done | sort -u > /var/tmp/cited.txt     # then delete the dated entries NOT in that list
```

Cleared on 2026-09-16: 110 dated entries, about 99 MB, keeping the 25 a committed record
names. The undated mktemp leftovers (`dp018-skill-*`, `spec021-nfr-*`, `specNNN-probe-*`,
about 300 directories) were left, because a name with no stamp says nothing about whether
its run is finished.

## The rendering harness (what is installed on the box, and how to reinstall it)

`scripts/render-check.mjs` opens every published page in Chromium and measures it.
`specs/025-design-pass/gate.mjs --final` runs it; a plain run skips every measured
assertion by name. It is a **dev-only** dependency: nothing in the shipped package
imports Playwright, and `dependencies`, `optionalDependencies` and `files` are
untouched.

### Installed on this box, 2026-09-04

```sh
npm install --save-dev playwright     # playwright ^1.62.1, 2 packages
npx playwright install chromium       # Chrome Headless Shell 151.0.7922.34
```

Downloaded to `~/.cache/ms-playwright/chromium_headless_shell-1234`, about 115 MB.
The cache is **outside the repository** and outside every publish tree.

> **`--with-deps` does not work here, and does not need to.** Amazon Linux 2023
> has no `apt-get`, and Playwright's dependency installer only knows Debian and
> Ubuntu: it prints *"your OS is not officially supported by Playwright;
> installing dependencies for ubuntu24.04-x64 as a fallback"* and then fails with
> `sh: line 1: apt-get: command not found`. **No system package was installed.**
> The headless shell launches and renders on the libraries AL2023 already carries,
> which was verified before anything was built on top of it.

### Reinstalling

```sh
cd <the worktree> && npm ci                 # or: npm install --save-dev playwright
npx playwright install chromium             # re-downloads the browser only
node -e "require('playwright').chromium.launch().then(b=>b.close()).then(()=>console.log('ok'))"
```

If that last line does not print `ok`, the gate's measured assertions are the ones
to read: they fail loudly with the launch error rather than falling back to a
structural check. **Do not add a structural fallback.** The whole reason the
harness exists is that the structural versions of those assertions were green on
a site whose every section was clamped to 672 pixels.

### A worktree needs a real `node_modules`

`scripts/build-public.sh` refuses a tree whose `node_modules` is a symbolic link,
and it is right to: `cp -r` reproduces a link as a link, the publish target's
ignore rule names a **directory**, so the link is tracked and the blob git stores
is an absolute path in a tree about to become public. In a `git worktree`, copy
it: `cp -r ~/driftproof/node_modules <worktree>/node_modules`.

## Merge a spec branch to `dev`

**Run the precondition check first. Every time.**

```sh
node scripts/merge-check.js specs/NNN-slug        # refuses unless an approval names HEAD
git checkout dev && git merge --no-ff spec/NNN-slug -m "merge(spec NNN): ... — approved at <SHA>"
```

`merge-check.js` exits non-zero unless `specs/NNN-slug/evidence/` holds an approval
record whose `commit:` field is exactly the branch tip, whose `tree:` was clean,
whose verdict is not rejected, and which carries **`blocking_findings: 0`** (or
`none`). A record missing that field is refused rather than assumed clean: order
is not substance, and an `approved-with-findings` verdict with something blocking
still outstanding is not a mergeable approval. It has no `--force`: if it
refuses, the fix is another approval run naming the current tip, not a flag.

Post-approval fixes are the trap. Resolving findings moves the tip, and the
approval that cleared the old tip does **not** cover the new one — this is how
DECISIONS #12 happened, with a blocking finding's fix merging on the strength of
the approval that raised it. DECISIONS #6's convergence rule lets *non-blocking*
findings ride to backlog and merge; it has never covered a blocking one.

## Approve and publish a drafted report

Run this **by hand** after reviewing a queued draft in
`reports/pending-publish.md`. Replace `NNN` with the report number.

1. **Review the draft.** Open `docs/reports/NNN-draft/index.html`; read the
   receipts under `receipts/report-NNN-draft/`; sanity-check the verdict tally
   against the receipts. If the draft was trimmed (over-cap), re-run
   `prepare-report.js` under the full report budget — `REPORT_MAX_USD`, not the
   trigger cap it was drafted under — to cover all skills before publishing:
   ```sh
   node scripts/prepare-report.js --new <newModel> --old <oldModel> \
     --max-usd "$(node -p 'require("./config").REPORT_MAX_USD')"
   ```

2. **Promote: render published, retire the draft, move the receipts. One step.**

   The receipts path on the page is *rendered*, not hand-edited, and it defaults
   to the directory actually read, so a draft truthfully says `-draft`. Promotion
   moves the receipts, so the page has to be re-rendered with the published path
   first. This is the pinned command for Report #005; run it from the repo root
   while the receipts are **still** under `-draft`:

   ```sh
   node scripts/prepare-report-005.js --render-only --published \
        --receipts-label 'receipts/report-005/' \
        --run-concurrency 2
   ```

   `--run-concurrency 2` is the concurrency the run was launched at. It is a
   launch parameter, not receipt evidence, and the page's *derived* finish time is
   computed from it — so omitting it silently drops that sentence and the promoted
   page stops matching the approved one. The gate asserts byte-for-byte
   reproduction in both states, but not of the same artifact: once the report is
   **published** it asserts that this command reproduces the published page that
   ships; while it is still a **draft** — the state you are in while reading this
   — it asserts that the same command *minus* `--published` reproduces the
   approved draft, and checks this published form for chrome, the moved receipts
   label and the frozen figures instead (approval finding F-F9).

   `--render-only` re-renders from the receipts that already exist. It **makes no
   model calls**: it does not fetch skills, does not run the smoke preflight, and
   refuses outright — rather than generating anything — if any pair's receipt is
   missing. It cannot be combined with `--execute`, `--smoke` or `--fresh`.

   Then, **in the same step**, retire the draft and move the receipts:

   ```sh
   rm -rf docs/reports/005-draft
   mv receipts/report-005-draft receipts/report-005
   git add -A docs/reports/005 receipts/report-005 receipts/report-005-draft
   ```

   > **The render and these three commands are ONE step.** Between them the page
   > names a receipts directory that does not exist yet. The gate fails that
   > half-done state deliberately, with a message saying so. Do not stop in the
   > middle.

   Report #005's receipts are **tracked** — they are the report's entire
   evidentiary basis and cannot be regenerated without a full re-run — so git
   records the move as a rename and the promotion is reviewable as a diff. The
   `.gitignore` rule hiding `*-draft/` still applies to future drafts, and
   `scripts/build-public.sh` excludes every `*-draft/` path from the published tree.

   > **No hand-editing.** The `noindex` tag, the DRAFT banner and the receipts path
   > are all *rendered*: `--published` omits the first two and moves the third. The
   > spec gate executes the pinned command and requires it to reproduce the page
   > that ships byte-for-byte, so a hand-edited page fails the gate rather than
   > shipping (approval E-F6/E-F7).

   > **Do not promote with `--execute`.** That path fetches skills over the
   > network and runs a live smoke preflight before it reaches the renderer, and
   > if the receipts have already been moved it will not skip anything — it will
   > start a full ~2,500-call re-run, against a guard that checks the *projection*
   > and so never fires (DECISIONS #8, and the finding that produced #13).

   The spec gate executes this exact command, in a temporary root, with the
   provider poisoned so any model call throws, and asserts that no call is made,
   that the frozen run-time projection ($20.89) and its label survive, and that
   the rendered receipts path moved. It reads only the page. `--published`
   deliberately writes no queue entry at all, so the agreement between the run
   record and the queue entry is a **separate** library assertion and is not part
   of what this executed command proves (approval finding F-F9). Per **DECISIONS
   #13** the guard runs the shipped invocation, not an analog of it.

3. **Link it from the index.** Edit `docs/index.html`: add
   `<a href="reports/NNN/index.html">Report #NNN</a>` to the header nav and update
   the "Latest report" call-to-action.

4. **Clear the queue.** Remove this report's entry from
   `reports/pending-publish.md`.

5. **Commit on `dev`, then merge to `main`** (GitHub Pages serves `main` `/docs`):
   ```sh
   git add -A && git commit -m "report NNN: publish <newModel> vs <oldModel>"
   git checkout main && git merge dev && git checkout dev
   ```

6. **Build the clean public tree and run the full gate on it.** The message is
   **required** and describes THIS build. The script carries none of its own: the
   one it used to carry announced the v0.5.0 release and would have announced it
   on every build since (DECISIONS #25).
   ```sh
   bash scripts/build-public.sh -m "<what this publish ships>"
   ```
   Repeat `-m` for further paragraphs, or use `-F <file>` for a long message.
   Invoked with no message it refuses, before it alters anything. Check what you
   are about to claim before you claim it:
   ```sh
   bash scripts/build-public.sh -m "<message>" --print-message   # resolve only, build nothing
   ```
   The gate (confidentiality + credential-format + hygiene scans, all blocking)
   must be **green on the published tree** before pushing.

7. **Push the public tree.**
   ```sh
   cd ~/driftproof-public && git push -u origin main --force
   ```
   Then **confirm a Pages deployment exists for the pushed commit** and that it
   reached `success`. A push that Pages never deployed leaves the live site on the
   previous tree, and step 8 can still read `200` from the old one.
   ```sh
   SHA=$(git -C ~/driftproof-public rev-parse HEAD)
   curl -s "https://api.github.com/repos/driftproofhq/driftproof/deployments?sha=$SHA&environment=github-pages"   # expect one deployment
   curl -s "https://api.github.com/repos/driftproofhq/driftproof/deployments/<id>/statuses" | grep -m1 '"state"'   # expect: "success"
   ```

8. **curl-verify the live page.**
   ```sh
   curl -sSI https://driftproofhq.com/reports/NNN/index.html | head -1   # expect: HTTP/2 200
   curl -s  https://driftproofhq.com/reports/NNN/index.html | grep -o 'Report #NNN'
   ```

Only after step 8 returns `200` is the report published.

## Publish to npm

The npm package and the public git tree are **two separate releases of the same
tree**, and they are published by two different commands. This section documents
the npm one. It is a manual step by design: the box holds no npm token, so a
publish always involves a human at a terminal.

**Where a publish runs, and where credentials live.** The gating happens on the
box — build the public tree, run the gate, push, tag — and the **publish itself
runs from the operator's own machine**. The box never holds npm credentials.
This was already the intent; it is written down because it was not being met:
`~/.npmrc` on the box carried a stale `_authToken` that failed `E401`, which is
worse than no token at all, because a credential that exists is a credential that
can be revived, copied or leak, while buying nothing — an expired token cannot
publish. The token was removed and the file deleted on 2026-08-23. If a publish
ever needs to run from the box, `npm login` for that publish and remove the
credential afterwards; do not leave one resident.

The practical consequence for whoever is holding the runbook: the version to
publish must already be pushed and tagged before you leave the box, because the
operator's machine publishes from a `git clone` at the tag or from a tree it
trusts, and it has no way to re-derive the gate result.

### Preconditions

1. **Publish from the built public tree** — `~/driftproof-public` (or a fresh
   `git clone` of the public repo at the tag). Never from the dev tree: the
   public tree is the exact, gate-verified content that was pushed, and
   publishing from anywhere else can ship state that was never audited.
2. **The gate is green on that tree.** `bash scripts/build-public.sh -m "<what
   this publish ships>"` rebuilds it and
   runs the full gate against it (`DRIFTPROOF_SCAN_ROOT`), including the
   **`npm pack` whitelist** section — which asserts the tarball is
   whitelist-exact, deny-list clean, and credential-format clean. That section
   is what makes the tarball's contents a gated artifact rather than a trusted one.
3. **Versions agree.** `package.json` `version` must equal `RUNNER_VERSION` in
   `config.js`. Every receipt records the engine that produced it, so a runner
   whose behaviour or receipt shape changed must not publish under a version
   another engine already used. Bump when receipt-emission semantics change, not
   merely when files change.
4. **The git tag is pushed first.** `uses: driftproofhq/driftproof@vX.Y.Z` in the
   Action resolves from the tag, not from npm, so the tag must exist before (or
   with) the release. The README and `docs/index.html` both reference that tag —
   update them in the same publish.

### The command sequence

```sh
cd ~/driftproof-public
npm whoami                      # must return the account that owns the package
npm publish --access public     # unscoped + public; --access public is belt-and-suspenders
```

npm 2FA is enabled for writes, so `publish` answers with `EOTP` and needs a
one-time code appended:

```sh
npm publish --access public --otp=<6-digit-code>
```

> **The OTP expires in ~30 seconds and is single-use.** Type the command with a
> freshly-rotated code already inline and run it in one go; a code fetched, then
> pasted through an intermediate step, will usually have expired by the time the
> request lands.

**If `publish` returns `E404` on the PUT** (`'driftproof@X.Y.Z' is not in this
registry`) while the package plainly exists: that is **stale or absent auth**, not
a missing package — npm reports an unauthenticated publish as 404 rather than 401.
Confirm with `npm whoami` (an expired token errors `E401`/`ENEEDAUTH`), then:

```sh
npm login                       # web flow: prints a URL to approve in a browser
```

and re-run the publish.

### Post-publish verification

```sh
npm view driftproof version                       # expect the version just published
npm view driftproof dist-tags                     # expect: { latest: 'X.Y.Z' }
cd "$(mktemp -d)" && npx -y driftproof@X.Y.Z --version   # clean-dir pull, expect X.Y.Z
```

The clean-directory `npx` check is the one that matters: it proves what a stranger
actually receives, which is the only claim the README makes about npm.

### Release the Claude Code plugin (after npm, never before)

The plugin under `plugin/driftproof/` is a door onto the published runner. Its
manifest `version` **pins the npm version it wraps** — one number, not two —
so the two move together and there is no state in which the plugin claims a
runner that is not on the registry.

The order matters and it is one-way:

```sh
# 1. npm first. The plugin's commands resolve driftproof@<plugin version>, so a
#    plugin released ahead of npm points every install at a version that is not
#    there yet.
# 2. Then bump plugin/driftproof/.claude-plugin/plugin.json "version" to the
#    version just published, so the plugin version and the npm version match.
# 3. Then move the registry, both copies together. The plugin ships its own
#    config/models.json because an installed plugin has no repository to read
#    one from, and spec 028's NFR-6 requires the two to have the same sha256.
#    The models-cache refresher writes the repository copy in place and knows
#    nothing about the plugin's, so this is the step where they are squared up.
cp config/models.json plugin/driftproof/config/models.json
sha256sum config/models.json plugin/driftproof/config/models.json   # expect two identical digests
# 4. Then re-run the spec gate, which asserts that pin and that digest against
#    the tree.
bash specs/028-claude-code-plugin/gate.sh
# 5. The marketplace manifest at .claude-plugin/marketplace.json needs no edit:
#    it names the plugin by source path, not by version.
claude plugin validate .claude-plugin/marketplace.json --strict
claude plugin validate plugin/driftproof --strict
```

**Why the copy is a release step and not a build step.** The two registries are
one file in two places, and nothing generates one from the other: the plugin's
copy is tracked, shipped, and read by the door at run time on an adopter's
machine. NFR-6 takes the gate red the moment their bytes differ — that is the
detection, and it fires on any tree, not only at release. Step 3 is the
*remedy* that red sends you to, which is what this step was missing when spec
028's approval of 2026-09-10 recorded finding N-1: NFR-6 named a release step
where the two are moved together, and the step said nothing about the plugin's
copy. Do not fix a red here by editing the gate.

Adopters do not get the new version until they run `claude plugin update`. A
plugin already installed keeps running the version it has, which is why the
reversibility line in spec 028's classification says *minutes for the tree, not
reversible for an installed adopter*. Treat a plugin release as public the
moment it is pushed.

The version guard is the other half of this. `plugin/driftproof/version-guard.json`
carries the minimum runner version the commands accept; each one reads
`--version` from the pinned CLI and refuses an older runner, naming both
versions. Raise that minimum only when a command actually depends on something a
newer runner introduced.

> **TBD — npm rollback.** Pulling or deprecating a bad npm release has never been
> exercised here, so no procedure is recorded rather than a guessed one. The git
> rollbacks below do **not** cover npm: a published version cannot be replaced in
> place, only superseded by a higher version or deprecated. Write this section the
> first time it is genuinely needed.

### Record the publish, then rebuild the public tree a second time

The build in step 7 ran **before** the publish, so its tree cannot carry the publish's
own facts — the npm timestamp, the `gitHead` match, the GitHub release, the Pages
deployment, the clean-runner gate on the tag, the sibling gates re-run against the
published tarball. Those are read after the publish (post-publish verification,
above, widened to the full set BACKLOG § 2 step 3 and step 8 ask for) and written into
`RELEASES.md`'s `### Published` section on `dev`, alongside a
`specs/000-governance/evidence/post-publish-<version>.txt` record of how each was
read. That commit is pushed to `private` like any other.

**The public tree is then rebuilt from that `dev` tip and diffed against the tree
already live**, to confirm the only thing that moved is the documentation of the
publish, not the shipped content:

```sh
git -C ~/driftproof-public ls-tree -r --full-tree HEAD > /tmp/before.txt   # the tree already live, before the rebuild
bash scripts/build-public.sh -m "docs vX.Y.Z: RELEASES.md records the publish; no code, site or package content changes, built from source commit $(git rev-parse HEAD)"
git -C ~/driftproof-public ls-tree -r --full-tree HEAD > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt   # expect exactly one line: RELEASES.md's blob
```

`RELEASES.md` is excluded from nothing — `EXCLUDE_RE` does not name it — so it
ships in the public tree and in the npm tarball, same as every release before it.
A second file changing here is a sign that something in the built tree moved between
the two builds for a reason that has nothing to do with recording the publish, and is
worth stopping on before the push.

**Then push**, main only — this is a second, unrelated push, so it does not carry
`--tags` and does not retag: the tag stays on the release's own source commit (the
build in step 7), never on this documentation-only rebuild.

```sh
cd ~/driftproof-public && git push origin main --force-with-lease=main:<the sha ls-tree read before the rebuild>
```

## Rollback

- **Bad draft:** delete `docs/reports/NNN-draft/` and `receipts/report-NNN-draft/`
  and remove the `reports/pending-publish.md` entry. Nothing was published, so
  there is nothing to revert on the public tree.
- **Bad publish:** revert the promotion commit on `main`, re-run
  `bash scripts/build-public.sh -m "revert <what went wrong>"`, and force-push the
  public tree again. Say in the message that this build is a revert — a rollback
  that ships under a message describing the thing it is rolling back is how the
  public history stops matching what happened.
- **Bad registry auto-add:** remove the `auto_added` entry from
  `config/models.json` and its id from `state/seen-models.json`.
