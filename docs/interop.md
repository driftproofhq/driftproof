<!-- SPDX-License-Identifier: Apache-2.0 -->
# Receipt interop — importing from and exporting to neighboring eval tools

Driftproof receipts are an **open format**. This page documents how results from
neighboring agent-skill eval tools map onto receipts (`driftproof import`), and
the minimal stable summary other tools can consume without parsing full receipts
(`driftproof export --to summary-json`).

The machine-readable receipt contract is
[`spec/receipt.schema.json`](https://driftproofhq.com/spec/receipt.schema.json)
(JSON Schema draft 2020-12, spec v0.15); the human companion is
[`spec/RECEIPT.md`](https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md).

## The honesty rule that governs every import

Driftproof did **not** run, hash, or judge an imported result. So an imported
receipt is stamped with exactly what we know and nothing more:

| receipt field | imported value | why |
|---|---|---|
| `verification_level` | **`DECLARED`** — never `TESTED` | `TESTED` means *a Driftproof-controlled suite was executed and judged with sampled bands*. An import is the source tool's **declaration**, converted faithfully. Harbor declares no figure, so a Harbor import is recomputed by Driftproof from the trial files it read, and each trial left out is counted and listed (Source #5). |
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

New imported receipts seal `run.import.comparison_method: matched-measured-cases/1`. Both comparison arms use the same admitted case ids. A missing usable arm or conflicting reported grading basis leaves the case in `excluded_cases` with an exact notice. Its admitted samples and counts stay on record. No matched case means null comparison figures and a notice. Receipts without that marker keep their older calculation and recorded figures. Reported compatibility does not establish the same actual grader.

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
| per-eval `with_skill`/`without_skill` grading | one case per (eval, mode) | `mean` = fraction of assertions passed (or 1/0 from the eval-level pass when no assertions and an explicit boolean pass); `samples` = `[mean]` — the **one** grade their judge actually produced, never resampled; `stddev` = 0; `outcome` = pass/fail from an explicit eval verdict, else score; `threshold` = `null`. |
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
| a run's `error` not null | `excluded_draws`, with the error text, every local path in it replaced by `<local path>` | Kept out of the band: a usage-limit error scores about 0 and reads as a regression. `--count-errored-runs` retains valid errored scores and counts, but excludes their whole case from comparison and says why in `run.import.notices`. |
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

The comparison is paired by eval: an eval scored in one arm only, or whose runs carry different
`result.total` counts of expectations, keeps its rows but is left out of both arms' aggregates and
the delta, listed in `excluded_cases` and named in a notice.

## Source #5: Harbor job directories

[Harbor](https://github.com/harbor-framework/harbor) runs an agent on tasks and grades each trial
with the task's own tests. It writes one `result.json` per trial. Harbor has no with-skill and
without-skill mode, so the user declares the arms: one job run with the skill, one without.

```
driftproof import --from harbor --with jobs/with-skill --without jobs/baseline [--reward reward] [--skill NAME]
driftproof import jobs/baseline --from harbor --arm baseline
```

`--with` and `--without` each take one job, or a folder of jobs (skill-placebo runs one job per
trial). Given one job, `--arm` says which arm it is, `with-skill` by default; the other arm is
empty and the comparison is null, never a zero. The receipt is `DECLARED`.

### Which file is read, and why it is trusted

A trial file is a `result.json` at exactly one place: `<job>/<trial>/result.json`, in the folder
named for the trial (`trial_name`). Harbor writes that file into the trial folder itself and gives
the agent and the verifier their own subfolders of it, `agent/` and `verifier/`. So nothing inside
a trial folder is listed or read: a `result.json` a skill or a test script wrote under `agent/` or
`verifier/` is never taken for a trial. The importer cannot check from the files that the agent
had no write access to the trial folder itself; that rests on Harbor's layout. A trial folder
whose name is not its `trial_name` is refused. A job-level `result.json` (its `stats`) is never
read for any figure. A symbolic link where the importer would open or enter is refused.

### Field mapping (Harbor trial → receipt)

| source | receipt | rule |
|---|---|---|
| `task_id`, `task_checksum` | `results.cases[].id` | A case is one pair, `task:` and 16 hex of their sha256. Two tasks sharing a `task_name` stay two cases. The same checksum under a different `task_id` in the two arms is not matched, and a notice counts it. |
| `task_name` | `results.cases[].label` | Only when it is a plain name. It never keys a case. |
| `verifier_result.rewards.<key>` | one entry of `samples` | With one numeric key, that key; with several, `--reward` names it. A value outside 0 to 1, or not finite, is refused. No number under the key: listed in `excluded_draws`. |
| `exception_info` set | `excluded_draws`, with `exception_type` | Left out whatever its reward. The message and traceback are never copied. |
| `finished_at` not an ISO 8601 UTC time | `excluded_draws` | A trial with no exception whose `finished_at` is not an ISO 8601 UTC time is left out too, and a notice counts it by arm. Only finished trials with a reward enter the delta. |
| `step_results` set | nothing written | Multi-step trials are refused. |
| `agent_info.name`, `agent_info.version` | `run.harness` | One harness on every trial, or refused. |
| `agent_info.model_info.name` | `run.model_id` | One model on every trial, or refused; none recorded on any trial is `unknown`. A notice counts the trials whose `agent_result.model_usage` names another model. |
| `config`, without `trial_name`, `trials_dir`, `job_id`, `task` and `source_trial` | a notice | The trial's settings: `config.agent`, `config.environment`, `extra_instructions`, the timeout multipliers and the rest. They must be the same on every trial of an arm, or the import is refused. A local path is compared by its sha256, so two different paths stay different. A notice names each key that differs between the arms, never a value. |
| `verifier_environment_mode`, `config` timeouts and timeout multipliers, `config.verifier` | `excluded_cases` | A case whose admitted trials differ in these leaves the aggregates and the delta. In a one-arm import this holds within the arm. |
| `agent_result.n_input_tokens`, `n_output_tokens`, `cost_usd` | `economics`, basis `source-list-price-estimate` | Means over the trials in the delta only. One call is one trial: one agent episode that may make many model calls. `n_input_tokens` includes cached tokens. `cost_usd` is the agent's own estimate at list price. |
| `started_at` | `run.date_utc` | The earliest. |
| each trial file | `run.import.sidecars`, `run.import.source_sha256` | Each file's path in its job and sha256. The receipt's file name ends in the first 12 hex of `source_sha256`. |

The delta is recomputed from the rewards over the tasks both arms ran: a task one job ran, or a
task whose arms were graded under other settings, is listed in `excluded_cases`. The import prints
how many trials each arm left out. When the arms leave out different shares of their trials, a
notice says so: the delta covers finished trials with a reward only, and a trial left out counts as
neither a pass nor a failure. A trial file that repeats another apart from its id and name is
refused. Every notice is one of a fixed set of sentences (spec 266). Harbor records no skill name,
so `skill.name` is the `--skill` value, or `unknown`.

### skill-placebo, and the placebo arms

Spec 266 is proven on skill-placebo's published Harbor trials. Its METHOD.md compares each skill
with the one placebo of its bucket and defines no pooling of its five placebo arms. So there is no
pooled placebo comparison to reproduce, and none is imported: the importer takes no placebo
option. skill-placebo counts a timed-out trial as a failure; this importer leaves it out and lists it.

## Source #6: NVIDIA benchmark cards (NVIDIA/skills)

[NVIDIA/skills](https://github.com/NVIDIA/skills) publishes a benchmark card for each skill,
`skills/<skill>/BENCHMARK.md`, and an index of every card's results, `benchmarks.json`. The skills
and docs there are licensed CC BY 4.0. The cards give aggregates only: one score and one uplift per
dimension and agent, and no per-run score.

```
driftproof import <checkout> --from nvidia-cards --commit <sha> [--only <skill>[,<skill>]] [--out DIR] [--report FILE]
```

`<checkout>` is a git checkout of NVIDIA/skills, and `--commit` is its HEAD, given in full. The
import reads `benchmarks.json` and each `skills/<skill>/BENCHMARK.md`, nothing else, and refuses a
checkout whose files are not the commit's: each file's git blob sha1, computed from the bytes read,
must be the blob the commit holds at that path. Without `--only` every card is read, and a card
with no index row, or an index row with no card, is refused. `--only` reads the named skills, by
folder name.

One `DECLARED` receipt is written for each skill and agent that has results (`claude-code` or
`codex`). A skill in `skills_without_results`, and an agent column the card marks `Not available`
or `N/A` in every row, get no receipt and are named in the import report, which the command prints
and `--report` writes as JSON.

### What the receipt carries, and what it does not

The card's figures are carried as printed in `source_figures`, beside the mark
`uncertainty_unavailable: "aggregates_only"`, both inside the receipt's hash. Each row keeps the
cell as `printed` with its numbers read out of it. The recorded source is the repository, the
commit and each file's path and `git_blob_sha1`, so anyone can fetch that commit and check every
figure. Driftproof records the files and the commit it read; it does not attest the author.

The receipt's case rows carry no figure, its comparison is null, and its aggregates have no mean:
no verdict is read from it. `badge`, `decide`, `diff`, `view`, `export` and every report builder
read the mark where they read the verification level, and give the receipt no verdict word, no
band and no lift. NVIDIA's own verdict, tier status, findings and recommendation are not carried.

| card or index | receipt | rule |
|---|---|---|
| a results cell `B% → S% (+U points)` | a row: `score_pct` S, `baseline_pct` B, `uplift` U, `uplift_unit` `points` | Newer cards. A `±` sign is read only where U is zero. |
| a results cell `S% (+U%)` | a row: `score_pct` S, `uplift` U, `uplift_unit` `unstated`, `baseline_pct` null | Older cards print the uplift with no unit, so the unit stays `unstated` and no baseline is worked out. |
| a cell that prints a score and says the uplift is unavailable | a row: `score_pct` S, every other figure null | |
| the `- Agents:` line, or the `## Agents Used` list | `run.model_id`, `run.provider` | The id the card prints for the agent; `unknown`, with a notice, where it prints none. Never guessed from the date. |
| `- Evaluation date:` | `run.date_utc`, `source_figures.evaluation_date` | The card gives the day, so `run.date_utc` is the start of that day and readers show the day alone. The import time is `run.import.imported_at` only. |
| the token table's `All cases` row for the agent | `economics`, basis `source-reported`, and `source_figures.tokens` | The two totals as printed, separators removed. No mean, cost or call count is worked out. No row: economics are unknown, with a notice. |
| `benchmarks.json` `results` | checked, not copied | Every dimension's score and uplift must equal the card's cell, both ways, or the import is refused. |

Every cell, metadata line, agent entry and table header is read by a closed set of shapes; anything
else refuses the import, naming the skill, the agent and the cell, and writes nothing. Every notice
is one of a fixed set of sentences (spec 265).

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
- A summary kept in a receipt directory is named `<receipt base>.summary.json`,
  which `export --out <dir>` does; `badge <dir>` and `decide` skip it by that name
  and its `format`, and under any other name read it as a receipt and refuse it, exit 4.

## Emitting receipts from your own harness

Any harness can emit receipts directly — that is the point of an open format.
Validate against the schema (`driftproof validate <file>` or any JSON Schema
draft 2020-12 validator), and be honest about the level:

- Ran a with/without suite yourself with retained generation + judge hashes →
  you may claim **`TESTED`** (the schema will hold you to the evidence chain).
- Converting or asserting results you can't hash → **`DECLARED`**, surface
  `external`, omit the hashes. Exactly what `driftproof import` does.

Imports refuse documents or sidecars above 16 MiB, JSON depth above 32, more than 200000 nodes, arrays or objects above 10000 entries, or strings above 16384 characters. Directory discovery stops above depth 16 or 10000 entries. Case ids must be short nonempty strings or safe integers, and numeric and string spellings of one id cannot be mixed. Scores must be finite numbers in [0,1]. Recorded expectation identities and Format A scored-grader sets, weights and participation must agree across admitted runs. Unknown grading metadata stays unknown. Rejected draws are listed separately and do not enter samples or counts.
