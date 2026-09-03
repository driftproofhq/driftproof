<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driftproof

**Your skill passed. On which model? On what date?**

A SKILL.md teaches an AI coding agent how you like things done. When a new model
ships, the same file can stop helping, or start hurting. Driftproof re-runs the
skill's tests on the new model and hands you a dated, hash-verified receipt
saying whether it still helps.

[![driftproof](https://img.shields.io/endpoint?url=https://driftproofhq.com/badges/commit-message-conventions.json)](https://driftproofhq.com)
&nbsp;— live badge for the bundled `commit-message-conventions` example, generated from its own receipt.

**[Quickstart](https://driftproofhq.com/#quickstart)** ·
**[Latest report](https://driftproofhq.com/reports/008/)** ·
[driftproofhq.com](https://driftproofhq.com)

Driftproof **consumes** the [`agentskills.io/evals`](https://agentskills.io) eval
format; it does not invent its own.

📊 **Eight published reports** (each re-derived from committed receipts, nothing
hand-entered), spanning six published report types, the newest being release
drift. All eight share one band-based, floor-gated verdict rule and
differ in what moves underneath the skill — or, in the value report, in which
axes are measured; or, in the instrument re-measurement, in the instrument itself:

- **[Report #001](https://driftproofhq.com/reports/001/)** — *release drift*: ten
  public agent skills across a current-vs-previous Sonnet release; 9 of 10 moved
  beyond noise. ([markdown](reports/report-001.md))
- **[Report #002](https://driftproofhq.com/reports/002/)** — *substrate
  durability*: the same suites across two vendors' CLIs (Claude vs Codex);
  3 durable, 4 substrate-dependent, 2 regressed, 1 no effect.
- **[Report #003](https://driftproofhq.com/reports/003/)** — *release drift*:
  `claude-opus-4-8` → `claude-opus-5`; 4 improved, 2 regressed, 4 within noise.
- **[Report #004](https://driftproofhq.com/reports/004/)** — *capability gap*:
  `claude-opus-5` (flagship) vs `claude-fable-5` (frontier tier);
  3 durable, 5 tier-dependent, 0 regressions, 2 no effect — encoded expertise
  survives the frontier tier.
- **[Report #005](https://driftproofhq.com/reports/005/)** — *value*: what a skill
  *costs* to run, on three axes (accuracy, cost, latency); the same ten suites on
  three substrates (`claude-sonnet-5`, `claude-fable-5`, `gpt-5.6-sol`) —
  14 of 30 cells cleared the floor on aggregate: 10 carry a price and 4 report a
  saving instead, having improved quality while reducing cost.
  *Three of those cells carry an amendment (v1.1, applied when Report #006
  published): their lifts rest on single-draw baselines since shown
  unstable. Cause-agnostic, no corrected figures offered, and the cost-driver and
  substrate-disagreement findings below are unaffected.*
- **[Report #006](https://driftproofhq.com/reports/006/)** — *revision drift*: the pinned skill revision against the one
  upstream ships today, on a held substrate. **The reuse premise was tested and
  refused: 3 of 3 cells returned no verdict**, each blocked by its own baseline
  control. A 120-call probe found generation-level sampling noise 3.2× and 7.5×
  larger than the judge-level noise this instrument actually samples — enough to
  account for every gap the controls saw without any other cause being
  established — and the receipt spec gains generation sampling as a result. **No
  cause is asserted**; the control proves non-reproduction and cannot say why.
  *The tally a refusal carries: 3 cells, 0 measured, 3 refused.*
- **[Report #007](https://driftproofhq.com/reports/007/)** — *instrument
  re-measurement*: the three cells Report #005 published for these skills, run
  again with the generation sampled adaptively instead of once and with the call
  timeout the surface policy declares. **No cell separates**: every lift is
  smaller than its own band, and the 21 cases read 3 improved, 0 regressed,
  18 no effect, 0 not measured. Five of six comparisons against the archive were
  **refused** on their baseline control. The instrument defect it reports is its
  own: a declared 300 s timeout had been shadowed by a `120000` literal since
  2026-07-27, and the truncated run it caused measured *less* variance than the
  clean re-run, which is the direction that flatters an instrument. Both runs are
  published, the broken one as evidence. Amends #005 to v1.2 and #006 to v1.1.
- **[Report #008](https://driftproofhq.com/reports/008/)** — *release drift*:
  two of Report #007's cells re-measured on `claude-fable-5-1` against
  `claude-fable-5`, with the skill `content_hash` and `suite_hash` asserted
  identical before the first call. **Both cells came back within noise**: the
  14 cases read 0 improved, 0 regressed, 14 within noise, 0 not measured. The
  first release pair in this project where both sides are generation-sampled
  receipts, which is what makes the delta attributable to the model rather than
  to the instrument. One case sits inside the verdict on the effect floor alone
  and the report names it.

✍️ The launch essay, **[Three model releases later: what actually happens to agent
skills](https://driftproofhq.com/writing/three-releases/)**, reads all eight reports
together: what moves underneath a skill, what the skill costs to run, and what a
corrected instrument did to three published results. Revised 2026-09-01; every
figure in it is gate-checked against the report page it cites.

## Why

A skill is usually tested **once**, against **one** model, and the verdict is
treated as permanent. But the substrate moves: models get updated, retired, and
replaced. A skill that measurably helped last quarter can quietly become a no-op —
or a net negative — the next time the model underneath it changes, and nobody
re-checks.

**Verdicts age because the substrate moves.** Driftproof exists to keep the
verdict current: cheap, repeatable, hash-stamped measurements bound to a specific
model version, so "does this skill still help?" has a dated, verifiable answer
instead of a stale one.

The hard part isn't running an eval once — it's making the number **credible
enough to act on**. An LLM judge is noisy, so a naive score can swing run to run
by more than the drift you're trying to detect. Driftproof's answer is to **sample
the judge and report confidence bands**, and to **only claim a regression when the
bands don't overlap**. A tool that cries wolf is worse than no tool.

**A verdict without a price is half an answer.** The same receipts price the
marginal cost of a skill firing, and Report #005 found the dominant cost driver is
not the skill's own text but the input it causes the model to pull in: across those
30 cells the input delta tracks cost at `r = +0.92` while the skill's own length
tracks it at only `r = +0.33`, and one 738-token skill drew 34× its own size in
extra input. Identical token deltas also price very differently across substrates —
the same skill at near-identical deltas costs 3.3× more on `claude-fable-5` than on
`claude-sonnet-5`, which is exactly their input-rate ratio in the frozen snapshot.

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

# 4. Run the suite. The shipped defaults (DEV_MAX_USD / DEV_MAX_CALLS in config.js)
#    refuse the run up front if the projection exceeds either; --max-usd and
#    --max-calls override them.
npx driftproof run my-skill --models claude-haiku-4-5

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

**What the band does not cover.** A verdict rests on **one generation draw per
arm**: the band is the spread of the *judge* re-scoring that single response, not
the spread of the model writing a different one. Report #006 measured the second
directly and found it larger — draw-to-draw spread up to **sd 0.186** on the 0–1
scale, against judge-level noise several times smaller. So treat a surprising
single-run verdict as **provisional and worth re-running** before you act on it.
Generation sampling lands in the next receipt spec; until it does, this is a
limit of the instrument, stated rather than implied.

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

# Interop: convert another tool's results into a DECLARED receipt (honest
# epistemics — no fabricated hashes, excluded from drift verdicts), and emit
# the minimal stable summary other tools can consume. See docs/interop.md.
npx driftproof import results.json --from agent-skills-eval   # or: skillgrade
npx driftproof export receipt.json --to summary-json
```

Receipts are an **open format** — the JSON Schema is served at its canonical id
([driftproofhq.com/spec/receipt.schema.json](https://driftproofhq.com/spec/receipt.schema.json)),
and any harness is encouraged to emit them. The interop contract (DECLARED vs
TESTED, import mappings, `summary-json`) is documented in
[`docs/interop.md`](docs/interop.md) and on
[the interop page](https://driftproofhq.com/interop.html).

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

Sampling multiplies calls on two axes, and the second one is easy to miss. Each
case costs `SAMPLING.max × (2 + 2 × samples)` model calls: two arms, each **drawn
up to `SAMPLING.max` times** (generation sampling, receipt spec v0.5), and every
draw judged `samples` times. Read at a single draw, that formula understates a run
by the whole draw factor — which is how the shipped caps came to sit a release
behind the estimator. Driftproof **projects the whole run up front, prints the
count, and refuses before spending anything** if the projection exceeds the
per-model call cap (`DEV_MAX_CALLS`) or the dollar budget (`DEV_MAX_USD`) — both
declared with their derivation in [`config.js`](config.js), both overridable with
`--max-calls` / `--max-usd`. The default model list is `haiku` only.

## Receipt anatomy

A receipt is the unit of evidence — one JSON document conforming to
[`spec/receipt.schema.json`](spec/receipt.schema.json) (human companion:
[`spec/RECEIPT.md`](spec/RECEIPT.md)). Abridged, with real shape:

```jsonc
{
  "schema_version": "0.5",
  "skill":  { "name": "commit-message-conventions", "version": "0.2.0",
              "content_hash": "…sha256 over SKILL.md + bundled files…" },
  "suite":  { "format": "agentskills.io/evals", "suite_hash": "…", "case_count": 10 },
  "run": {
    "model_id": "claude-haiku-4-5-20251001",
    "model_release_date": "2025-10-01",
    "provider": "anthropic",
    "surface": "claude-cli",
    "runner_version": "0.8.0",
    "date_utc": "2026-07-27T…Z",
    "registry": "registered",
    "transcripts": "hashes-only",
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
  // v0.4 economics, all derived and never composited into one score: "run.pricing_snapshot"
  // freezes the rates; each case carries "usage" and a separate "judge_usage"; "economics"
  // holds basis, surface, with_skill/baseline (call_count, mean_input_tokens,
  // mean_output_tokens, mean_cost_usd_per_call, median_wall_ms + p25/p75/IQR),
  // skill_incremental_cost_usd_per_call, skill_incremental_cost_usd_per_1k_calls,
  // output_tokens_delta, median_wall_ms_delta, judge_excluded (const true), judge_overhead.
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
- **`economics`** is *derived*, never a second measurement: the token delta is the
  durable fact, and the dollars are exactly those tokens at the rates frozen into
  `run.pricing_snapshot`, so a receipt keeps its meaning after a vendor reprices.
  Judge cost is recorded apart as `judge_usage` and excluded from every skill-value
  figure (`judge_excluded` is `const true`) — measuring the skill is our cost, not
  the skill's.
- **`receipt_hash`** is a self-hash for tamper-evidence (integrity, not yet a key
  signature — see the spec's open questions).

### Drift reports

`driftproof diff A.json B.json` compares the with-skill bands per case across two
receipts. The rule that keeps it honest: a **regression** (or improvement) is
claimed **only when the two bands do not overlap**. Overlapping bands are reported
as **within noise** and never counted as a regression.

## Verification in CI (GitHub Action + badge)

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
      - uses: driftproofhq/driftproof@v0.8.0
        with:
          skill-dir: skills/my-skill
          models: claude-haiku-4-5
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          # max-usd:   <n>    # override the dollar budget (default: DEV_MAX_USD in config.js)
          # max-calls: <n>    # override the per-model call cap (default: DEV_MAX_CALLS)
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
npx driftproof run skills/my-skill --models claude-haiku-4-5 --out receipts
npx driftproof badge receipts/*.json --out badges/my-skill.json
git add badges/my-skill.json && git commit -m "chore: driftproof badge"
```

```markdown
![driftproof](https://img.shields.io/endpoint?url=https://<your-site>/badges/my-skill.json)
```

The [badge at the top of this README](docs/badges/commit-message-conventions.json)
is the living demo: it is generated
from the `commit-message-conventions` example's own receipt and served from the
site, so it reflects a real dated run, not a hand-set color.

## Reports

Eight reports are published, spanning six report types. A report page lives at a
draft path — `docs/reports/NNN-draft/` — until the publish sequence renames it, and
`scripts/build-public.sh` excludes every `*-draft/` path from the published tree
(see the roll at the top of this README, and
[REPORT-STYLE.md](REPORT-STYLE.md) for the shared chrome every report inherits).
Each report and every verdict in it are **re-derived from the receipts** committed
under [`receipts/`](receipts/)
(`receipts/report-001/` … `receipts/report-006/`) — nothing is hand-entered.

Driftproof does **not** commit third-party skill content. Each `SKILL.md` is
fetched at run time from a pinned commit and verified by sha256 against
[`suites/manifest.json`](suites/manifest.json); we commit only the manifest, our
authored eval suites ([`suites/`](suites/)), the receipts, and the reports.
Reproduce Report #001 in three commands:

```bash
node scripts/fetch-skills.js                     # fetch pinned SKILL.md files (sha256-verified) → untracked workdir
node scripts/run-report-001.js --concurrency 5   # run both models × with/baseline, emit receipts
node scripts/build-report-001.js                 # re-derive the report from the receipts
```

Reports #002–#005 have their own runners
(`scripts/prepare-report-00N.js` — Report #005's is
[`scripts/prepare-report-005.js`](scripts/prepare-report-005.js)) following the
same fetch → run → re-derive shape.

**Model-release triggers are live**: `scripts/release-watch.js` (keyless — it
reads the public models registry) notices a new model release, re-runs the
receipts, and queues a draft report in `reports/pending-publish.md` for human
review — drift is caught at the release, not months later.

## Roadmap

- **A sandboxed-execution harness** for tool-execution skills (document
  renderers, diagram/asset generators) that Report #001 scopes out.
- **Signed receipts** — key signatures / attestation over the canonical form
  (today's `receipt_hash` is tamper-evidence, not authenticity).
- **More import mappings** — the interop wall (DECLARED vs TESTED) is built;
  adding a converter for another harness's results format is a small,
  well-marked PR (see [docs/interop.md](docs/interop.md)).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The gate (`npm run gate`) must stay green.

## License

[Apache-2.0](LICENSE).
