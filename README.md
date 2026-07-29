<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driftproof

**Continuous, model-version-bound verification of agent skills.**

[![driftproof](https://img.shields.io/endpoint?url=https://driftproofhq.com/badges/commit-message-conventions.json)](https://driftproofhq.com)
&nbsp;— live badge for the bundled `commit-message-conventions` example, generated from its own receipt.

Driftproof is an open **receipt spec** plus a **runner** that measures whether an
agent skill actually helps — by running the skill's eval suite **with** and
**without** the skill on a named model version, judging each case several times to
get a confidence band, and emitting a signed, dated **receipt**. Diff two receipts
across model releases and you get a **drift report**.

Driftproof **consumes** the [`agentskills.io/evals`](https://agentskills.io) eval
format; it does not invent its own.

📊 **[Report #001](docs/reports/001/index.html)** ([markdown](reports/report-001.md))
— ten public agent skills, run across a current-vs-previous Sonnet release with
sampled, band-based verdicts.

## Why

A skill is usually tested **once**, against **one** model, and the verdict is
treated as permanent. But the substrate moves: models get updated, retired, and
replaced. A skill that measurably helped last quarter can quietly become a no-op —
or a net negative — the next time the model underneath it changes, and nobody
re-checks.

**Verdicts age because the substrate moves.** Driftproof exists to keep the
verdict current: cheap, repeatable, hash-stamped measurements bound to a specific
model version, so "does this skill still help?" has a dated, reproducible answer
instead of a stale one.

The hard part isn't running an eval once — it's making the number **credible
enough to act on**. An LLM judge is noisy, so a naive score can swing run to run
by more than the drift you're trying to detect. Driftproof's answer is to **sample
the judge and report confidence bands**, and to **only claim a regression when the
bands don't overlap**. A tool that cries wolf is worse than no tool.

## Quickstart — receipt for your own skill in ~10 minutes

You need Node ≥ 22 and an `ANTHROPIC_API_KEY`.

```bash
# 1. Scaffold a skill skeleton: SKILL.md + evals/evals.json (3 example cases) + .driftproofrc
npx driftproof init my-skill

# 2. Edit the 3 example cases in my-skill/evals/evals.json so each one is grounded
#    in a claim your SKILL.md makes. Every rubric is anchored at 0.80 = "fully correct".

# 3. Point the runner at the metered API (scanner-safe: never commit a key)
export CLAUDE_PROVIDER=api
read -rsp "Anthropic API key: " ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY

# 4. Run the suite with a hard $2 budget (the run is refused up front if it would exceed it)
npx driftproof run my-skill --models claude-haiku-4-5 --max-usd 2

# 5. Read the receipt + human summary written to ./receipts/
cat receipts/*.summary.md
```

**Reading the result.** The **verdict** answers "does the skill still help on this
model?" — `PASSED` when the with-skill score beats the baseline by at least the
effect floor, `NO_EFFECT` when it doesn't, `REGRESSED` when the skill hurts. Each
case is judged several times, so it carries a **band** (`mean ± stddev`) instead of
one fragile number, and a case is only ever called regressed/improved when its two
bands don't overlap. The **effect floor** (0.05, one judge quantization step) is the
minimum real move required before a change counts as more than noise — band
separation *plus* a floor-sized delta, never either alone.

### Install

```bash
npx driftproof <cmd>        # no install — always the published version
npm install -g driftproof   # or install the CLI globally
```

The only runtime dependency is `ajv` (schema validation); `@anthropic-ai/sdk` is
optional and pulled in only for `CLAUDE_PROVIDER=api`. The CLI resolves its spec,
schema, and model registry from inside the package, so it runs the same from a
global/npx install as it does in a checkout.

### Other commands

```bash
# Diff two receipts across a model release into a drift report (markdown)
npx driftproof diff receiptA.json receiptB.json --out drift.md

# Validate a receipt against the schema + verify its self-hash
npx driftproof validate receipt.json

# Emit a shields.io badge from a receipt (see "Badge", below)
npx driftproof badge receipt.json --out badges/my-skill.json
```

A skill directory is expected to look like:

```
my-skill/
  SKILL.md              # the skill instructions (required)
  evals/evals.json      # agentskills.io/evals suite (required)
  .driftproofrc         # optional per-project run defaults (models, samples, max_usd)
  ...                   # any bundled files (contribute to content_hash)
```

Writing a suite that measures fairly is its own craft — see
**[AUTHORING.md](AUTHORING.md)** ([site](https://driftproofhq.com/authoring.html)).

### Providers

| `CLAUDE_PROVIDER` | surface | notes |
|---|---|---|
| `cli` *(default)* | `claude-cli` | Spawns `claude -p` with `ANTHROPIC_API_KEY` **stripped** from the child env, so dev runs use your local subscription session. Sampling params are surface-controlled. |
| `api` | `api` | Uses the Anthropic Messages API; requires `ANTHROPIC_API_KEY` and `@anthropic-ai/sdk`. Judge calls are pinned to temperature 0 for determinism where the surface allows it. |

The surface and judge settings used are recorded in every receipt.

### Cost guard

Sampling multiplies calls. Each case costs `2 + 2 × samples` model calls
(two generations, each judged `samples` times) — 12 calls per case at the default
`--samples 5`. Driftproof **projects the whole run up front, prints the count, and
refuses before spending anything** if it would exceed `--max-calls` (default 200).
The default model list is `haiku` only.

## Receipt anatomy

A receipt is the unit of evidence — one JSON document conforming to
[`spec/receipt.schema.json`](spec/receipt.schema.json) (human companion:
[`spec/RECEIPT.md`](spec/RECEIPT.md)). Abridged, with real shape:

```jsonc
{
  "schema_version": "0.2",
  "skill":  { "name": "commit-message-conventions", "version": "0.2.0",
              "content_hash": "…sha256 over SKILL.md + bundled files…" },
  "suite":  { "format": "agentskills.io/evals", "suite_hash": "…", "case_count": 10 },
  "run": {
    "model_id": "claude-haiku-4-5-20251001",
    "model_release_date": "2025-10-01",
    "surface": "claude-cli",
    "runner_version": "0.2.0",
    "date_utc": "2026-07-27T…Z",
    "judge": { "samples": 5, "temperature": null, "sampling": "surface-controlled",
               "surface": "claude-cli" }
  },
  "results": {
    "cases": [
      { "id": "perf-not-refactor", "mode": "with_skill",
        "outcome": "pass", "score": 0.86, "mean": 0.86, "stddev": 0.05,
        "samples": [0.9, 0.8, 0.85, 0.9, 0.85],
        "judge": { "model_id": "claude-haiku-4-5-20251001", "rubric_hash": "…" } }
      // …one entry per (case, mode); baseline entries too…
    ],
    "aggregates": {
      "with_skill": { "case_count": 10, "pass_count": 7, "borderline_count": 1,
                      "mean_score": 0.81, "stddev": 0.02 },
      "baseline":   { "case_count": 10, "pass_count": 1, "mean_score": 0.42, "stddev": 0.03 }
    }
  },
  "comparison": { "with_skill_score": 0.81, "baseline_score": 0.42,
                  "delta": 0.39, "delta_uncertainty": 0.036 },
  "verification_level": "TESTED",
  "receipt_hash": "…sha256 of the canonical receipt with this field removed…"
}
```

Key ideas:

- **`content_hash` / `suite_hash`** are computed over a canonical JSON form, so the
  same skill and suite hash identically on any machine — receipts are comparable.
- **Per-case `samples` / `mean` / `stddev`** give each case a confidence band. An
  `outcome` of **`borderline`** means the pass threshold sits *inside* the band —
  the run can't confidently call it pass or fail.
- **`delta_uncertainty`** is the combined band on the with-skill-vs-baseline lift.
- **`verification_level`** uses the community lattice: `UNVERIFIED` / `DECLARED` /
  `TESTED` (Driftproof emits `TESTED`). `FORMAL` is reserved.
- **`receipt_hash`** is a self-hash for tamper-evidence (integrity, not yet a key
  signature — see the spec's open questions).

### Drift reports

`driftproof diff A.json B.json` compares the with-skill bands per case across two
receipts. The rule that keeps it honest: a **regression** (or improvement) is
claimed **only when the two bands do not overlap**. Overlapping bands are reported
as **within noise** and never counted as a regression.

## Continuous verification in CI (GitHub Action + badge)

Wire drift detection into a repo so the skill is re-checked on every push and when
the model underneath it changes.

```yaml
# .github/workflows/driftproof.yml
name: driftproof
on: [push, workflow_dispatch]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: driftproofhq/driftproof@v0.3.0
        with:
          skill-dir: skills/my-skill
          models: claude-haiku-4-5
          max-usd: '2'
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          # fail-on-regression: 'true'   # (default) fail the job if the skill REGRESSED
```

The action runs the suite, uploads the receipt as a build artifact, and exposes
`verdict` (`PASSED` / `NO_EFFECT` / `REGRESSED`) and `delta` as step outputs. It
fails the job on `REGRESSED` unless you set `fail-on-regression: 'false'`. For a
free CI dry-run with **zero model calls**, set `DRIFTPROOF_STUB=1` in the job env —
the runner returns canned receipts so the wiring can be tested without spend (this
is exactly how the action's own [self-test](.github/workflows/action-selftest.yml)
runs).

### Badge

`driftproof badge <receipt>` emits a [shields.io endpoint](https://shields.io/badges/endpoint-badge)
JSON object. Commit it somewhere public and point a shields endpoint URL at it:

```bash
npx driftproof run skills/my-skill --models claude-haiku-4-5 --max-usd 2 --out receipts
npx driftproof badge receipts/*.json --out badges/my-skill.json
git add badges/my-skill.json && git commit -m "chore: driftproof badge"
```

```markdown
![driftproof](https://img.shields.io/endpoint?url=https://<your-site>/badges/my-skill.json)
```

The [badge at the top of this README](badges/) is the living demo: it is generated
from the `commit-message-conventions` example's own receipt and served from the
site, so it reflects a real dated run, not a hand-set color.

## Reports

**[Report #001](reports/report-001.md)** diffs ten public, text-representable
agent skills across a Sonnet model pair. The report and every verdict in it are
**re-derived from the receipts** in [`receipts/report-001/`](receipts/report-001/) —
nothing is hand-entered.

Driftproof does **not** commit third-party skill content. Each `SKILL.md` is
fetched at run time from a pinned commit and verified by sha256 against
[`suites/manifest.json`](suites/manifest.json); we commit only the manifest, our
authored eval suites ([`suites/`](suites/)), the receipts, and the report.
Reproduce it in three commands:

```bash
node scripts/fetch-skills.js                     # fetch pinned SKILL.md files (sha256-verified) → untracked workdir
node scripts/run-report-001.js --concurrency 5   # run both models × with/baseline, emit v0.2 receipts
node scripts/build-report-001.js                 # re-derive the report from the receipts
```

## Roadmap

- **Monthly drift reports** for a curated set of public skills, published under
  `reports/` and at driftproofhq.com.
- **Model-release triggers** — re-run receipts automatically when a new model
  version ships, so drift is caught at the release, not months later.
- **A sandboxed-execution harness** for tool-execution skills (document
  renderers, diagram/asset generators) that Report #001 scopes out.
- **Signed receipts** — key signatures / attestation over the canonical form.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The gate (`npm run gate`) must stay green.

## License

[Apache-2.0](LICENSE).
