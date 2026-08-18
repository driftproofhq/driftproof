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
   suites on the pair (n=5, under the $25 trigger cap — trimming to the 6
   highest-traffic skills if the projection is over cap), emits receipts to
   `receipts/report-NNN-draft/`, builds a **DRAFT** page under
   `docs/reports/NNN-draft/`, and writes a summary + verdict tally to
   `reports/pending-publish.md`. If `~/.moltbot` exists it also appends a line to
   `~/.driftproof-notify` (a local file — **never** posted to Moltbook).

**It does not publish.** The draft is `noindex`, is **not** linked from the site
index, and is **not** pushed to the public tree. Idempotency: a model already in
`state/seen-models.json` never re-triggers; a *failed* prepare run is retried no
more than once per day.

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

## Approve and publish a drafted report

Run this **by hand** after reviewing a queued draft in
`reports/pending-publish.md`. Replace `NNN` with the report number.

1. **Review the draft.** Open `docs/reports/NNN-draft/index.html`; read the
   receipts under `receipts/report-NNN-draft/`; sanity-check the verdict tally
   against the receipts. If the draft was trimmed (over-cap), re-run
   `prepare-report.js` without the cap to cover all skills before publishing:
   ```sh
   node scripts/prepare-report.js --new <newModel> --old <oldModel> --max-usd 40
   ```

2. **Promote out of `-draft`.** Draft dirs are gitignored (untracked), so use
   `mv` + `git add`, not `git mv`. Renaming off the `-draft` suffix un-ignores
   them, so `git add` then tracks them normally:
   ```sh
   mv docs/reports/NNN-draft docs/reports/NNN
   mv receipts/report-NNN-draft receipts/report-NNN
   git add docs/reports/NNN receipts/report-NNN
   ```
   Edit `docs/reports/NNN/index.html`: remove the `noindex` meta tag and the
   "DRAFT — not published" banner, and fix the two `../../` relative links if the
   depth changed (it does not — draft and final are both `docs/reports/NNN/`).

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

6. **Build the clean public tree and run the full gate on it.** The launch helper
   lives in your home directory (not tracked):
   ```sh
   bash ~/build-public.sh          # rebuilds ~/driftproof-public + runs the gate on it
   ```
   The gate (confidentiality + credential-format + hygiene scans, all blocking)
   must be **green on the published tree** before pushing.

7. **Push the public tree.**
   ```sh
   cd ~/driftproof-public && git push -u origin main --force
   ```

8. **curl-verify the live page.**
   ```sh
   curl -sSI https://driftproofhq.com/reports/NNN/index.html | head -1   # expect: HTTP/2 200
   curl -s  https://driftproofhq.com/reports/NNN/index.html | grep -o 'Report #NNN'
   ```

Only after step 8 returns `200` is the report published.

## Rollback

- **Bad draft:** delete `docs/reports/NNN-draft/` and `receipts/report-NNN-draft/`
  and remove the `reports/pending-publish.md` entry. Nothing was published, so
  there is nothing to revert on the public tree.
- **Bad publish:** revert the promotion commit on `main`, re-run
  `~/build-public.sh`, and force-push the public tree again.
- **Bad registry auto-add:** remove the `auto_added` entry from
  `config/models.json` and its id from `state/seen-models.json`.
