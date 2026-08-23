<!-- SPDX-License-Identifier: Apache-2.0 -->
# Receipt interop — importing from and exporting to neighboring eval tools

Driftproof receipts are an **open format**. This page documents how results from
neighboring agent-skill eval tools map onto receipts (`driftproof import`), and
the minimal stable summary other tools can consume without parsing full receipts
(`driftproof export --to summary-json`).

The machine-readable receipt contract is
[`spec/receipt.schema.json`](https://driftproofhq.com/spec/receipt.schema.json)
(JSON Schema draft 2020-12, spec v0.3.1); the human companion is
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
| `judge` | per-case `judge.model_id` + `run.judge` | Their judge grades once, binary per assertion → `run.judge.samples: 1`, `sampling: "external"`, `temperature: null`. `rubric_hash: null` (rubric bytes not seen). |
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
| `grader_model` | per-case `judge.model_id` + `run.judge` | `samples` = trial count, `sampling: "external"`, `temperature: null`, `rubric_hash: null`. |
| per-task trials | one `with_skill` case per task | `samples` = the per-trial rewards; `mean`/`stddev` computed from them (a real cross-trial band); `threshold` = the task/defaults threshold; `outcome` = the same rule Driftproof uses (pass / fail / **borderline** when the threshold sits inside `mean ± stddev`). |
| *(no baseline)* | `aggregates.baseline.case_count: 0`; `comparison.*` `null` | See above — nothing is fabricated. |

> **Assumed-shape disclosure.** skillgrade documents its grader output JSON,
> `eval.yaml`, scoring formula, and results directory — but not a frozen schema
> for the persisted results file. The converter's contract is the checked-in
> fixture (`tests/fixtures/interop-skillgrade.json`), authored from the
> documented semantics; the outreach issue asks the maintainer to confirm or emit
> receipts natively.

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
