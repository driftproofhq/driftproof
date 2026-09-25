<!-- SPDX-License-Identifier: Apache-2.0 -->
# Receipt interop — importing from and exporting to neighboring eval tools

Driftproof receipts are an **open format**. This page documents how results from
neighboring agent-skill eval tools map onto receipts (`driftproof import`), and
the minimal stable summary other tools can consume without parsing full receipts
(`driftproof export --to summary-json`).

The machine-readable receipt contract is
[`spec/receipt.schema.json`](https://driftproofhq.com/spec/receipt.schema.json)
(JSON Schema draft 2020-12, spec v0.4); the human companion is
[`spec/RECEIPT.md`](https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md).

## The honesty rule that governs every import

Driftproof did **not** run, hash, or judge an imported result. So an imported
receipt is stamped with exactly what we know and nothing more:

| receipt field | imported value | why |
|---|---|---|
| `verification_level` | **`DECLARED`** — never `TESTED` | `TESTED` means *a Driftproof-controlled suite was executed and judged with sampled bands*. An import is the source tool's **declaration**, converted faithfully. |
| `run.surface` | **`external`** | The run happened on someone else's harness. |
| `run.source` | **`imported/<tool>`** | Provenance of the conversion. |
| `generation_hash`, `judge_sample_hashes` | **omitted** | We never saw the raw generations; hashes are **never fabricated**. |
| `skill.content_hash`, `suite.suite_hash` | **`null`** | We never saw the skill/suite bytes. |
| `run.transcripts` | **`none`** | Nothing was retained, not even hashes. |

Two structural consequences, both enforced in code and asserted in the gate:

1. **Imported receipts are excluded from drift-verdict computation.** `driftproof
   diff` refuses to claim regression/improvement verdicts unless **both** receipts
   are `TESTED`; anything below reports **NOT MEASURED**. A DECLARED receipt is a
   faithful record, not band-verified evidence.
2. **The schema's `TESTED` tightening.** The v0.3.1 schema (interop-additive
   revision) requires the full evidence chain — content/suite hashes, per-case
   generation + judge-sample hashes, a non-`external` surface — **whenever
   `verification_level` is `TESTED`**. The relaxations below apply only to
   receipts that honestly say they are `DECLARED`/`UNVERIFIED`. No previously
   issued receipt is invalidated (the revision is additive).

## Source #1 — `agent-skills-eval` (darkrishabh/agent-skills-eval, MIT)

A TypeScript test runner for **agentskills.io-style skills** — the *same suite
lineage as Driftproof* (`evals/evals.json` with `id`, `prompt`,
`expected_output`, `assertions[]`). It runs each eval `with_skill` and
`without_skill` (config `baseline: true`), grades with an LLM judge
**per-assertion, binary pass/fail**, and writes an artifact workspace:

```
agent-skills-workspace/iteration-1/
├── meta.json            # run metadata: timestamp, config, models
├── benchmark.json       # rolled-up pass/fail per skill + eval
├── <eval-id>/with_skill/     # output, timing.json, grading.json (per-assertion pass/fail + reasoning)
├── <eval-id>/without_skill/  # same, skill stripped
└── report/index.html
```

Config fields that matter for the mapping: `target` (model evaluated), `judge`
(grading model), `baseline` (enables the without-skill runs).

### Field mapping (agent-skills-eval → receipt)

`driftproof import <file> --from agent-skills-eval` reads a single rolled-up
results JSON (the benchmark artifact with per-eval, per-mode grading):

| agent-skills-eval | receipt | notes |
|---|---|---|
| `skill_name` | `skill.name` | `skill.version` = declared version if present, else `"unknown"`. |
| suite (agentskills.io evals) | `suite.format` = `"agentskills.io/evals"` | Same suite lineage; `suite_hash` = `null` (bytes not seen), `case_count` = number of evals. |
| `target` | `run.model_id` | Provider inferred from the id (`gpt-*`/`o<n>` → openai, else anthropic); registry looked up as usual. |
| `judge` | per-case `judge.model_id` + `run.judge` | Binary per assertion → `sampling: "external"`, `temperature: null`, and **no** `run.judge.samples` and no `counts`: the benchmark format defines no count of either kind, so none is written until it does (receipt v0.8, spec 043). `rubric_hash: null` (rubric bytes not seen). |
| per-eval `with_skill`/`without_skill` grading | one case per (eval, mode) | `mean` = fraction of assertions passed (or 1/0 from the eval-level pass when no assertions); `samples` = `[mean]` — the **one** grade their judge actually produced, never resampled; `stddev` = 0; `outcome` = pass/fail from their grading; `threshold` = `null`. |
| rolled-up pass rates | `results.aggregates` + `comparison` | Recomputed from the converted cases; `delta` = with-skill mean − baseline mean. Single-sample: `diff` already flags "no bands". |
| `timestamp` | `run.date_utc` | Else the import time. |

> **Assumed-shape disclosure.** agent-skills-eval documents its artifact *layout*
> and *semantics* (README) but not a frozen JSON schema for `benchmark.json`. The
> converter accepts the documented semantics under the field names shown in our
> checked-in fixture
> (`tests/fixtures/interop-agent-skills-eval.json`) — authored from the README —
> and that fixture **is** the compatibility contract until the upstream schema is
> confirmed. The outreach issue asks the maintainer to confirm the shape or (better)
> emit receipts natively.

## Source #2 — `skillgrade` (mgechev/skillgrade, MIT)

"Unit tests for your agent skills": drives a real agent CLI (claude / gemini /
codex) through **tasks** defined in `eval.yaml`, **N trials per task** (`--smoke`
5, `--reliable` 15, `--regression` 30), each trial graded by weighted
**deterministic graders** (a command emitting `{score, details, checks[]}`) and/or
**LLM-rubric graders** (`grader_model`); final per-trial reward =
`Σ(grader_score × weight) / Σ weight`, on a 0.0–1.0 scale, compared against a
`threshold` (default 0.8) in `--ci` mode. Results persist to
`$TMPDIR/skillgrade/<skill-name>/results/` (or `--output=DIR`).

Two structural differences from a Driftproof run:

- **No baseline mode.** skillgrade measures *whether the agent discovers and uses
  the skill*, not with-vs-without lift. There is nothing honest to put in
  `baseline`, so the imported receipt carries an **empty baseline aggregate**
  (`case_count: 0`) and **`comparison.baseline_score`/`delta`/`delta_uncertainty`
  = `null`** — never a fabricated 0-baseline that would inflate a fake delta.
- **Trials are real repeated runs.** Per-trial rewards are genuine independent
  observations, so they map onto `samples[]` honestly — with the caveat noted in
  the receipt mapping that they are *trial rewards* (generation + grading
  variance), not judge resamples of one generation.

### Field mapping (skillgrade → receipt)

`driftproof import <file> --from skillgrade`:

| skillgrade | receipt | notes |
|---|---|---|
| `skill` (name) | `skill.name` | `version` `"unknown"` unless present. |
| `eval.yaml` tasks | `suite.format` = `"skillgrade/eval.yaml"` | Not agentskills.io; the format string says so. `suite_hash` `null`; `case_count` = task count. |
| `agent` (claude / gemini / codex) | `run.model_id` | skillgrade names an **agent CLI**, not a model id — imported verbatim (or the results' `model` field when present); expect `registry: "unregistered"`. |
| `grader_model` | per-case `judge.model_id` + `run.judge` | **No** `samples`: the format defines no judge-sample count, and a trial count is a generation count (receipt v0.8, spec 043). `sampling: "external"`, `temperature: null`, `rubric_hash: null`. |
| per-task trials | one `with_skill` case per task | Trial counts are written as `generations_per_arm`: once in `run.counts` when every task has the same non-zero number, else per case. A task whose `trials` is `[]` is a `no_observations` case with `samples: []` and `generations_per_arm: 0`; a task with no `trials` field is a `no_observations` case with no count. Both are excluded from aggregates and named in `excluded_cases`. `samples` = the per-trial rewards; `mean`/`stddev` computed from them (a real cross-trial band); `threshold` = the task/defaults threshold; `outcome` = the same rule Driftproof uses (pass / fail / **borderline** when the threshold sits inside `mean ± stddev`). |
| *(no baseline)* | `aggregates.baseline.case_count: 0`; `comparison.*` `null` | See above — nothing is fabricated. |

> **Assumed-shape disclosure.** skillgrade documents its grader output JSON,
> `eval.yaml`, scoring formula, and results directory — but not a frozen schema
> for the persisted results file. The converter's contract is the checked-in
> fixture (`tests/fixtures/interop-skillgrade.json`), authored from the
> documented semantics; the outreach issue asks the maintainer to confirm or emit
> receipts natively.

## Source #3: `claude plugin eval` (Claude Code 2.1.269 and later)

`claude plugin eval` runs a plugin's eval cases with the plugin loaded and, by default, again
without it, and writes `aggregate-result.json` under `evals/results/<timestamp>/` (or the same
document to `--json <path>`). The unit measured is the **plugin**: every skill it carries is
loaded at once. Spec 049 reads `schemaVersion` 1, the field names below taken from real runs
(Claude Code 2.1.272 and 2.1.281). Anthropic adds fields without renaming them, so fields not
listed here are ignored.

```
driftproof import evals/results/2026-09-10T17-02-11-482Z/ --from claude-plugin-eval
driftproof import results.json --from claude-plugin-eval [--count-errored-runs]
```

Given a directory, the importer finds the one `aggregate-result.json` under it and refuses none
or several, naming what it found. The receipt's file name ends in the first twelve hex of the document's sha256,
so several documents imported into one directory never overwrite each other.

### Field mapping (claude plugin eval → receipt)

| source | receipt | rule |
|---|---|---|
| `schemaVersion` | `run.import.format_version` | Must be `1`; any other value is refused, naming it. |
| `partial` true | nothing written | Refused, quoting `partialReason`. |
| `cases[].name` | `results.cases[].id` | Two cases with one name are refused, never merged. |
| `arms.with[]` | the `with_skill` case | One run is one generation draw. |
| `arms.without[]` | the `baseline` case | Absent (`--ablation none`): an empty baseline aggregate and a null comparison, never a zero. |
| a run's `score` | one entry of `samples` | The weighted fraction of graders the run passed, an `llm` grader passing on 2 of 3 judge votes. `mean`, `stddev` and the outcome are computed from the draws by the rule a Driftproof run uses, with `suite.threshold` as the threshold. No judge-sample count is written. |
| a run's `error` not null | `excluded_draws`, with the error text, every local path in it replaced by `<local path>` | Kept out of the band: a usage-limit error scores about 0 and reads as a regression. `--count-errored-runs` puts them back, and says so in `run.import.notices`. |
| a run's `aborted` | kept, measured | A mock `expect: abort` is a behaviour failure the suite author defined. |
| a run's `skippedPaidGraders` true | `excluded_draws` | Its score omits the paid graders. |
| a grader with `scored` false, `type` `tool_used` on the `Skill` tool | `results.cases[].activation` `{indicator, fired, runs}` | Whether the skill fired: `runs` counts the case's measured with-plugin runs whose result carries the indicator, and `fired` those where it passed. Never part of a score. In a two-arm run every `tool_used: Skill` grader and every `arm: with-only` grader is `scored: false`, and the run's `score` already excludes it. |
| `cases[].aggregates` (`score`, `delta`) | not copied | Recomputed from the draws. A case with `aggregates` and no runs is listed with `case_status: "no_observations"` and the reason *aggregates only*, and kept out of every figure. |
| `claudeVersion` | `run.harness` `{name: "claude-code", version}` | |
| `suite.modelOverride` | `run.model_id` | Present when `--model` was passed. Otherwise `unknown`, never Claude Code's default, with a notice. |
| `suite.judgeModel` | `run.judge.model_id` | Otherwise `unknown`, with a notice that the source's default judge is a small fast model. |
| `costUsd`, `durationSeconds` per run | `economics`, basis `source-list-price-estimate` | The source's own estimate, labelled as such. `judgeCostUsd` is never used. |
| `startedAt` | `run.date_utc` | Else the results directory's name; else null, with a notice. The import time is only ever `run.import.imported_at`. |
| `suite.plugins` (exactly one) | `skill.name`, `skill.version`, `skill.unit: "plugin"` | Otherwise `unknown`, with a notice. |
| `threshold` | each case's `threshold` | |

`generations_per_arm` is written at run or arm scope only when every case has the same number of
measured runs there, and per case otherwise. Every hash is null: the plugin's bytes were not
hashed.

## Source #4: skill-creator `benchmark.json` (and skill-up)

skill-creator's benchmark mode writes `benchmark.json`, and Alibaba's skill-up writes the same
document, one per iteration, with a `result.json` beside it. skill-up stamps
`runs_per_configuration: 1` in every document it writes; `--iteration 3` writes three documents,
and each is imported as its own receipt.

```
driftproof import benchmarks/2026-01-15T10-30-00Z/benchmark.json --from skill-creator
driftproof import my-skill-workspace/iteration-1/ --from skill-creator
```

### Field mapping (benchmark.json → receipt)

| source | receipt | rule |
|---|---|---|
| `metadata.skill_name` | `skill.name`, `skill.unit: "skill"` | |
| `metadata.timestamp` | `run.date_utc` | Else null, with a notice. |
| `metadata.executor_model` | `run.model_id` | skill-up's document has no model field: the importer reads `result.json` beside it, `observed_configuration.model` first, then each case's `observed_model` when they agree, then `applied_configuration.model` (the model skill-up forwarded, which is not an observation, said so in a notice); else `unknown`. |
| `runs[]` grouped by (`eval_id`, `configuration`) | one case per group: `id` from `eval_id`, `label` from `eval_name` | `with_skill` is the with-skill arm and `without_skill` the baseline; any other `configuration` is refused, and so are two rows sharing (`eval_id`, `configuration`, `run_number`). Two evals sharing an `eval_name` stay two cases. |
| `runs[].result.pass_rate` | one entry of `samples` | One `run_number` is one draw. |
| `metadata.runs_per_configuration` | a notice, when it disagrees with the rows | `generations_per_arm` comes from the rows; a declared count never overrides them. |
| `runs[].result.tokens`, `time_seconds` | `economics.<arm>.mean_total_tokens`, `median_wall_ms`, basis `source-reported` | Tokens are one total, so no cost is computed. |
| `expectations` | not stored | Their counts are in `pass_rate`. |
| `run_summary`, its delta strings | not copied | A document with `run_summary` and no `runs[]` row for an eval lists that eval with the reason *aggregates only*. |
| `analyzer_model` | not used | It is not the grader. `run.judge.model_id` is `unknown`, with a notice: no cited format records the grader's model, and skill-up's `grading.json` carries expectations and a summary only. |
| `result.json` | `run.import.sidecars`, `run.harness` | Its sha256 is recorded; skill-up's `engine_name` and observed CLI version are the harness. |

## The lightweight interchange: `driftproof export --to summary-json`

Full receipts carry the whole evidence chain. Most consumers only want the
verdict. `driftproof export <receipt.json> --to summary-json [--report-url URL]`
emits a **minimal, stable, flat** summary — the recommended way for dashboards,
badges, and other eval tools to consume Driftproof output without a receipt
parser:

```json
{
  "format": "driftproof/summary",
  "format_version": "1",
  "skill": { "name": "commit-message-conventions", "version": "0.2.0" },
  "model": { "id": "claude-opus-5", "provider": "anthropic", "surface": "claude-cli" },
  "run_date_utc": "2026-08-11T00:00:00.000Z",
  "scores": {
    "with_skill": { "mean": 0.81, "stddev": 0.02 },
    "baseline": { "mean": 0.42, "stddev": 0.03 }
  },
  "delta": 0.39,
  "delta_uncertainty": 0.036,
  "verdict": "PASSED",
  "verification_level": "TESTED",
  "source": "driftproof",
  "judge": { "model_id": "claude-haiku-4-5-20251001", "samples": 5 },
  "receipt_hash": "…64 hex…",
  "report_url": null,
  "spec": "https://driftproofhq.com/spec/receipt.schema.json"
}
```

Contract:

- **`format`/`format_version` gate compatibility.** `"driftproof/summary"` v`"1"`
  keys are frozen; additions bump `format_version`.
- `verdict` is the single-receipt verdict (`PASSED` / `NO_EFFECT` / `REGRESSED`
  through the 0.05 effect floor) — or **`NOT_MEASURED`** when the receipt is
  below `TESTED` or carries no delta (e.g. a skillgrade import with no baseline).
- `scores.baseline` is `null` when no baseline mode was run; `delta`/
  `delta_uncertainty` are `null` in the same case.
- `judge.samples` is `null` when the receipt does not establish a judge-sample count
  (receipt v0.8, spec 043): an imported receipt never does, because neither source format
  defines one. The key is unchanged; before v0.8 the exporter wrote `1` in its place.
- `receipt_hash` links the summary back to the full receipt; `report_url` is set
  when the exporter is told where the receipt's report lives (`--report-url`),
  else `null`.
- Output is deterministic for a given receipt (stable key order, no timestamps
  added at export time) — snapshot-tested in the gate.

## Emitting receipts from your own harness

Any harness can emit receipts directly — that is the point of an open format.
Validate against the schema (`driftproof validate <file>` or any JSON Schema
draft 2020-12 validator), and be honest about the level:

- Ran a with/without suite yourself with retained generation + judge hashes →
  you may claim **`TESTED`** (the schema will hold you to the evidence chain).
- Converting or asserting results you can't hash → **`DECLARED`**, surface
  `external`, omit the hashes. Exactly what `driftproof import` does.
