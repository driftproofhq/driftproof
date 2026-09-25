<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driftproof receipt, spec v0.9

A **receipt** is a **hash-verified**, dated record of running one agent skill's eval suite
**with** and **without** the skill on one model version, with the judge **sampled**
so every score carries a band: a descriptive spread, the mean plus or minus one
sample standard deviation, with no coverage probability. Receipts are the unit of evidence
Driftproof produces; diffing two receipts across model releases yields a **drift
report**.

The machine-readable contract is [`receipt.schema.json`](./receipt.schema.json)
(JSON Schema, draft 2020-12). This document is the human companion. Where they
disagree, the schema wins.

**Versioning.** The current schema is v0.9
([`receipt.schema.json`](./receipt.schema.json)). Prior schemas are kept frozen as
[`receipt.v0.8.schema.json`](./receipt.v0.8.schema.json),
[`receipt.v0.7.schema.json`](./receipt.v0.7.schema.json),
[`receipt.v0.6.schema.json`](./receipt.v0.6.schema.json),
[`receipt.v0.5.schema.json`](./receipt.v0.5.schema.json),
[`receipt.v0.4.schema.json`](./receipt.v0.4.schema.json),
[`receipt.v0.3.1.schema.json`](./receipt.v0.3.1.schema.json),
[`receipt.v0.3.schema.json`](./receipt.v0.3.schema.json),
[`receipt.v0.2.schema.json`](./receipt.v0.2.schema.json) and
[`receipt.v0.1.schema.json`](./receipt.v0.1.schema.json); the validator picks the
schema by the receipt's own `schema_version`, so every earlier receipt still loads and
validates against its own frozen schema, including every receipt behind the published
reports, which the gate asserts on each run. v0.9 is additive for a reader: it adds
optional fields and widens three values, so a v0.8 receipt restamped `"0.9"` validates;
v0.8 is frozen because its version constant refuses anything else (see *What v0.9 adds*).
v0.8 was additive over v0.7 in the same way (see *What v0.8 adds*).

## What v0.9 adds: an imported receipt says what produced it

Spec 049, the importers for the two Anthropic formats: `claude plugin eval`'s
`aggregate-result.json` (`--from claude-plugin-eval`) and skill-creator's `benchmark.json`,
which skill-up also writes (`--from skill-creator`). The field mappings are in
[`docs/interop.md`](../docs/interop.md). Every field below is optional, and none is written
by a Driftproof run.

- **`run.harness`** `{name, version}`: the agent harness that produced the answers, as the
  source names it (`claude-code` and `claudeVersion` for a plugin eval; skill-up's engine and
  its observed CLI version). `version` is null when the source does not record it.
- **`run.import`** `{tool, format, format_version, source_sha256, imported_at}`: the document
  the receipt came from, its own version field as written (null when it has none), the sha256
  of its bytes, and when the import ran. `imported_at` is the only place the import time
  appears; the run date comes from the source. Two optional lists: `sidecars` (other files
  read beside the document, by name and sha256, such as skill-up's `result.json`) and
  `notices` (one sentence per thing the source did not establish, such as an unknown model or a
  date read from a directory name, and per choice a reader must know, such as errored runs
  counted).
- **`skill.unit`**: `"skill"`, or `"plugin"` when a plugin was measured whole, every skill it
  carries loaded at once (a plugin eval). Absent means a skill.
- **`results.cases[].activation`**: a list of `{indicator, fired, runs}`, one per unscored
  skill-invocation indicator the source ran (a `tool_used: Skill` grader with `scored: false`):
  in how many of the case's measured runs the skill fired. It is never part of a score, band
  or comparison. On 15 Sep 2026 a native eval scored a skill +0.67 while this indicator read 0
  of 3: the skill never fired.
- **`results.cases[].excluded_draws`**: runs the source recorded for the case and arm that are
  kept out of its samples, each `{draw_index, reason}` (a run with an error, a run whose paid
  graders were skipped).
- **`results.cases[].label`**: the source's display name for a case (`eval_name`). Cases are
  identified by `id`, never by label.
- **`economics.<arm>.mean_total_tokens`**, and two `economics.basis` values:
  `source-list-price-estimate` (the source tool's own cost estimate at list price, not a
  Driftproof figure) and `source-reported` (tokens and time as the source reports them, no
  cost).
- **Three widenings**, each for an imported receipt: `run.provider` may be `unknown` (the
  source records no model); `run.date_utc` may be null, only on an `external` receipt whose
  source records no date; and an absent model is `run.model_id` `"unknown"`, never a harness's
  default.

Imported receipts stay DECLARED with surface `external`, every hash null, and `diff` keeps
refusing them.

## What v0.8 adds: counts that say what they count, and a generation clock

Spec 043, from agentskills discussion #544 (comments 18348575, 18409751, 18409986,
18530980 and 18531185). Until v0.8 `run.judge.samples` was required, so a receipt had no
way to say a count was unknown, and the two importers wrote one anyway: agent-skills-eval
wrote `1` whatever the source said, and skillgrade wrote its largest trial count, which is
a count of generations, into the judge-sample field.

- **`run.judge.samples` is optional** (#544 comments 18409751 rule 1, 18530980). Absent means unknown, never 1. Every reader in the
  tree that shows it (the differ, `export --format summary-json`, the receipt summary)
  says *unknown* or writes `null`.
- **Two counts, kept apart** (18348488, 18348575, 18530980). `generations_per_arm` (independent candidate generations;
  0 only where a source establishes zero) and `judge_samples_per_generation` (at least 1),
  each optional, in a `counts` object. When both `run.judge.samples` and
  `run.counts.judge_samples_per_generation` are present the loader refuses a receipt
  where they differ.
- **The narrowest honest scope** (18530980). `run.counts` when a count is the same for every case of
  every arm generated in this run; `run.arms.<mode>.counts` when it holds for one arm;
  `results.cases[].counts` otherwise, and only for the cases where it is known. A reader
  takes the narrowest scope present (`lib/counts.js` `resolveCount`). Nothing writes a
  maximum, minimum or mean of differing counts as a count.
- **Archived arms** (18348488, 18348575, 18409751 rule 2). `run.arms.<mode>` may carry an arm's own `model_id`, `generated_at`
  and `counts`. An arm with its own `generated_at` was generated in an earlier run: it
  never inherits `run.counts`, and with no `counts` of its own its counts are unknown.
- **Clocks** (18409751 rule 2, 18409986, 18530980). `run.generated_at` is stamped by the runner before its first generation
  call. `run.judged_at` and `run.grader_revision` (the judge template hash and the rubric
  hashes) appear together, and only on a re-judge. `date_utc` keeps its value; its
  description now says what the code writes (the row below).
- **`no_observations`** (18530980, and the operator's answer A-3 in spec 043). A case the source supplied no observation for is listed with
  `case_status: "no_observations"`, contributes no figure, is excluded from every
  aggregate and is named in `excluded_cases`. An imported task whose trials list is empty
  carries `samples: []` and `generations_per_arm: 0`; a task with no trials field carries
  neither, because its count is unknown.
- **The importers** (18530857, 18530980; the positive control of 18531185 is read on a native receipt and on uniform skillgrade trials). agent-skills-eval writes no count of either kind: its benchmark
  format defines neither. skillgrade writes no judge-sample count (its format defines
  none) and writes its trial counts as generation counts at the narrowest honest scope.
  Both stay `DECLARED` and `external`, and skillgrade's rewards are kept exactly as
  supplied.
- **The runner.** A native receipt carries the judge-sample count it was asked for and
  each case's generation count as the draws it recorded, placed by the same rule.

## What v0.7 adds: a receipt that could not resolve the effect floor says so

Spec 035. Until v0.7 a receipt whose with_skill and baseline bands did not separate
was read as NO_EFFECT, and the single-receipt badge read only the aggregate delta
against the effect floor. The 0.10.1 reliability audit measured that badge labelling
34.56% of binary-null receipts passing. v0.7 reads every receipt per case, from its
own fields, by six rules. For one case, arm `w` is with_skill and arm `b` is baseline;
`m`, `s` and `n` are an arm's `generation.mean`, `generation.sd` and
`generation.n_measured` (a receipt without a `generation` block has one draw per arm,
`n = 1`, and its judge-sample band); `F` is `EFFECT_FLOOR` (0.05) and `Z` is `POWER_Z`
(2), both in `config.js`.

- **R-1, separation.** The bands do not overlap (`m_w - s_w > m_b + s_b` or the
  reverse; touching is overlap) and `|m_w - m_b| >= F`.
- **R-2, resolution.** With both `n >= 2`: `r = s_w + s_b + Z * sqrt(s_w^2/n_w + s_b^2/n_b)`.
- **R-3, underpowered.** A case that does not separate is underpowered when an arm has
  `n < 2`, or when `r >= F`.
- **R-4, draws needed.** If `s_w + s_b >= F`, no draw count reaches the floor at these
  spreads, because more draws narrow the standard error and not the spread; otherwise
  `floor(Z^2 * (s_w^2 + s_b^2) / (F - s_w - s_b)^2) + 1` per arm, at least 2, with the
  spreads held; with an arm at `n < 2`, at least 2 per arm to measure a spread.
- **R-5, the receipt verdict.** A receipt below `TESTED`, incomplete, or with no numeric
  delta is `NOT_MEASURED`, as before. Otherwise `REGRESSED` when any case separated
  downward, else `PASSED` when any separated upward, else `UNDERPOWERED` when any case is
  underpowered, else `NO_EFFECT`.
- **R-6, the differ.** Per case, over two receipts' with_skill arms, R-1 to R-4 apply;
  the differ's per-case verdict value is unchanged, and an underpowered case carries
  `power: { state: "underpowered", drawsNeeded, reason }` beside it.

**The token.** `UNDERPOWERED` is a machine-facing verdict value on `driftproof badge
--github-output`, the Action's `verdict` output, and `lib/verdict.js` `VERDICTS`; its
decision state is `underpowered`, ordered after `not measured` and before `no detected
effect`, and it never renders as success. Every surface that renders it in words
carries the plain line: **Not enough draws to conclude at this effect floor.** The
Action also publishes `draws_needed`. UNDERPOWERED is a statement about the instrument
at this receipt's spreads and draws; it is not evidence that the skill has an effect.

## What v0.6 adds: the receipt says what answered it

Spec 026 (receipt integrity). Six ways the v0.5 runner wrote a receipt that read
as more than it was, each closed by a field the receipt now carries and the
schema now requires:

- **`run.answered_by`** `{ kind, attested, reported_model, reported_models,
  isolation }`. `kind` is `model` (a model surface answered), `stub` (the
  canned stub answered and nothing was measured) or `external` (another tool's
  harness answered; the receipt was imported). `attested` is true only when the
  surface echoed a model id for every draw and it matched the requested
  canonical id; `reported_model` and `reported_models` are what it echoed
  (null when nothing). `isolation` names the spawn path: `eval-user`,
  `same-user` (`--trusted-skill`) or `none`. A stub run also records
  `run.surface: "stub"` and `run.judge.surface: "stub"`, and the schema refuses
  `TESTED` unless `answered_by.kind` is `model`: a stub receipt is
  `UNVERIFIED` by schema, not only by the runner.
- **`run.judge.model_id`** and **`run.judge.prompt_template_hash`**: which
  judge ran, and a sha256 over the grading template with its three slots empty.
  A different template is a different judge; `diff` names the field and
  computes no verdict across one. The template hash is null only on an
  imported receipt.
- **`stop_reason`** and **`truncated`** on every draw, and
  **`generation.n_truncated`** per case and arm. A draw cut at the output cap
  is unmeasured and never judged; a partial answer scored as a whole one was
  the v0.5 shape.
- **`case_status: "failed_unmeasured"`**: every draw of the arm was unmeasured
  for a reason that is not a timeout (an empty generation, a judge output with
  no score, a truncated draw). Recorded without fabricated samples or hashes
  exactly as `failed_timeout` is, and excluded pairwise. An absent output is
  not a measurement; a zero is.
- **`results.aggregates.band_rule`**: the formula the aggregate band is derived
  by, stated on the receipt so a reader recomputes it from `results.cases`.
- **Bands the formula cannot form are null, never `0`.** An arm's `stddev` is
  null only when its `case_count` is below 2 (the schema refuses a null on a
  two-case arm); `comparison.delta_uncertainty` is null only beside
  `delta_uncertainty_unavailable: "single_case"` or `"no_cases"`, and
  `mean_score` and the comparison are null only under `no_cases`.

A v0.5 receipt carries none of these, so the validator refuses one restamped
`"0.6"`; v0.5 stays frozen at `receipt.v0.5.schema.json` and every archived
receipt validates against the version it names.

## What v0.5 adds: the generation is sampled too

Until v0.5 a verdict rested on **one generation draw per arm**. The band a
receipt carried was the *judge* re-scoring that single response — not the spread
of the model writing a different one. Report #006 measured the second directly
and found it larger: across-draw **sd 0.186** and **sd 0.183**, against
judge-level noise several times smaller. Every figure this instrument published
was error-barred on the smaller of the two noise sources.

v0.5 samples the other axis. Each case and arm carries a `generation` block:

- `draws[]` — **every draw, listed**, each with its own `generation_hash`, its
  own nested judge `samples`, and its own `mean` and `stddev`. An aggregate a
  reader cannot re-derive is not evidence; the list is what makes it evidence.
- `mean`, `sd` — across draws.
- `judge_sd_mean` — the mean of the per-draw judge stddevs.
- `variance_ratio` — `sd / judge_sd_mean`: how much larger the generation-level
  spread is than the judge-level spread. **`null` when the judge sd is zero**,
  never a division result: an infinity reads as "infinitely noisier" when what
  happened is that the ratio is undefined.
- `variance_ratio_unavailable` — **which null it is**, and it is present whenever
  the ratio is null. One of `single_judge_sample`, `judge_sd_zero`,
  `no_measured_draws`, `judge_samples_unknown`. Each names what was *observed*
  and none names a cause.
- `n_planned`, `n_drawn`, `n_measured`, `n_unmeasured`, `stopping_reason` — the
  sampling policy **as applied**, so an adaptive run says why it stopped.

**What `--samples 1` costs.** The ratio is generation-sd over mean judge-sd, and
with **one judge sample per draw the per-draw judge spread is zero by
construction** — so the number v0.5 exists to produce cannot be formed at `k=1`.
`k=1` remains legal and the run still emits a receipt; the ratio is `null` and
`variance_ratio_unavailable` reads **`single_judge_sample`**, which is a
different statement from `judge_sd_zero` ("the judge agreed with itself perfectly
across two or more samples"). Before this field the two nulls were the same null.
Documented sampling is `--samples 5`, the default, and a run whose ratio you
intend to publish must use at least 2.

## The `generation_sampled` capability flag

A receipt that carries across-draw statistics **must declare
`generation_sampled: true` at the top level**, and a receipt that declares it
**must carry at least one case with a `generation` block AND must carry
`suite.canary`**. All three directions are enforced by the schema, so neither a
producer nor a third-party emitter can claim the capability without the evidence,
or carry the evidence without saying so.

**Both blocks, not one.** The exposure this closes named two things v0.5 adds —
the draw set and the per-suite canary — and binding only the first left a receipt
able to claim conformance while carrying half of it. A receipt that declares the
capability has, by construction, run a suite of ours, so it has a canary to
record.

**Absent means legacy.** A v0.5 receipt that ran no generation sampling — an
imported `DECLARED` receipt, for instance — omits the field and stays valid, and
every v0.4-and-earlier receipt is unaffected and unmodified. That is the whole
reason the requirement is bound to the DECLARATION rather than to
`verification_level`: binding it to the level would have invalidated hand-built
fixtures across the archive that never ran a generation, which is a different
change from the one this flag makes.

**The judge nests inside the draw.** Pooling k×n scores into one list per case is
exactly what makes generation noise read as judge noise, and it is the defect
Report #006 exists to name.

**A timed-out draw is `unmeasured`, never zero.** It carries no score and is
excluded from every mean, sd and ratio. A zero asserts a measurement; a timeout
is the absence of one, and filling it with zero invents a regression nobody
observed. The schema enforces this: a draw with `status: "unmeasured"` may not
carry a numeric `mean`.

## Which schema validates which receipt (the coexistence rule)

- **A producer emits the current version.** `config.js` `RECEIPT_SCHEMA_VERSION`
  decides it, and at this revision that is **v0.9**.
- **A reader validates against the receipt's own `schema_version`**, never
  against the newest schema it happens to have. `validateReceipt()` selects the
  schema by that field, which is why a v0.1 receipt from the first report still
  validates today.
- **v0.4 receipts remain producible and readable.** v0.4 moved from the
  unversioned filename to `spec/receipt.v0.4.schema.json` when v0.5 took the
  current pointer; the number still resolves to the schema it meant. Nothing in
  the archive is retroactively invalidated, and the frozen v0.1, v0.2, v0.3 and
  v0.3.1 schemas are byte-for-byte unchanged.
- **A v0.4 reader meeting a v0.5 receipt** finds every field it knows, and the
  ones it does not know are additive. `mean`, `score` and `stddev` on a case now
  describe the **draw set** rather than one arbitrary draw, so an older reader
  reads the aggregate rather than whichever draw happened to be last;
  `generation_hash`, `samples` and `judge_sample_hashes` continue to describe the
  last measured draw, which is what they have always described. Older readers
  that ignore unknown fields therefore stay correct rather than silently wrong.

## Suite canary

`suite.canary` is a GUID derived from the suite's identity and its case ids —
stable for a suite, distinct across suites, and requiring no registry. It exists
so a suite that has leaked into training data is **detectable** in a corpus. It
is a detection aid and not a control: it cannot prevent a leak, and its absence
proves nothing.

## What changed in v0.4 (economics — what a skill costs to run)

Reports #001–#004 could say whether a skill still helps. They could not say what
it costs, because the two CLI surfaces we run on were reporting token usage that
the runner discarded. v0.4 captures it and derives the economics from it.

- **`results.cases[].usage`** — the GENERATION call's usage for that (case, mode)
  row: `{ input_tokens, output_tokens, cached_tokens, wall_ms }`. `input_tokens`
  is normalized to the TOTAL input including any cached portion, because the
  surfaces disagree natively (`claude -p` reports it excluding cache; `codex`
  includes it). `cached_tokens` is `null` — never `0` — where a surface does not
  report it. `wall_ms` is measured by the runner around the successful attempt,
  so it means the same thing on every lane.
- **`results.cases[].judge_usage`** — the summed usage of the N judge calls that
  graded that row. This is **measurement overhead we impose, not a cost of
  running the skill**, and it is excluded from every derived value figure. The
  schema pins `economics.judge_excluded` to `const: true`, so a receipt cannot
  claim otherwise.
- **`run.pricing_snapshot`** — the registry prices **frozen at run time** for the
  models this run touched. Every derived dollar figure is computed from this
  snapshot and never from the live registry, so a published receipt does not
  silently change meaning when a vendor cuts prices later.
- **`economics`** — the derived block: per-arm mean cost per call, mean input and
  output tokens, median `wall_ms` with its interquartile range; and the deltas
  that matter — `skill_incremental_cost_usd_per_call`,
  `skill_incremental_cost_usd_per_1k_calls`, `output_tokens_delta`,
  `median_wall_ms_delta`. `basis` states `metered` or `metered-equivalent`
  (subscription surfaces, where actual metered spend is $0).

**Three axes, never combined.** Accuracy lift, cost, and latency are recorded and
reported separately. There is deliberately no composite "value score": the axes
have different units, different error bars, and different owners, so collapsing
them would manufacture a number no reader could trace back to evidence. The
presentation rules that follow from this — ratio framings gated on the effect
floor, latency always carrying its disclosure — are in
[`REPORT-STYLE.md`](../REPORT-STYLE.md) § "Value-axis presentation rules".

**Read the incremental figures, not the absolute ones.** Both CLI surfaces
prepend a large fixed harness preamble we do not control (observed ~25k input
tokens on `claude-cli`, ~11k on `codex`). It inflates absolute per-call cost, but
it is identical in the with-skill and baseline arms, so it cancels in every Δ.

## Interop-additive revision (Phase 7 — receipts as an open format)

The v0.3.1 schema gained an **additive interop revision** so receipts can be
**imported** from neighboring eval tools with honest epistemics (see
[`docs/interop.md`](../docs/interop.md) and the site's `/interop.html`):

- `run.surface` and `run.judge.surface` gain **`"external"`** (the run happened
  on another tool's harness); `run.transcripts` gains **`"none"`** (nothing
  retained, not even hashes — only honest on an import).
- New optional **`run.source`** — provenance of a converted receipt, e.g.
  `"imported/agent-skills-eval"` or `"imported/skillgrade"`.
- `skill.content_hash`, `suite.suite_hash`, and per-case `judge.rubric_hash` may
  be **`null`**, per-case `generation_hash`/`judge_sample_hashes` may be
  **omitted**, and `comparison.baseline_score`/`delta`/`delta_uncertainty` may be
  **`null`** (a source tool with no baseline mode) — hashes and baselines are
  **never fabricated**. `suite.format` may name a non-agentskills format (e.g.
  `"skillgrade/eval.yaml"`).
- **The TESTED tightening** (a top-level schema conditional) makes every one of
  those relaxations available **only below `TESTED`**: a receipt claiming
  `verification_level: "TESTED"` must still carry the full evidence chain —
  content/suite hashes, per-case generation + judge-sample hashes, a
  non-`external` surface, numeric comparison — exactly as before. No previously
  issued receipt is invalidated, and `TESTED` keeps its meaning.
- Structural consequence, enforced in code: **drift verdicts require `TESTED`
  on both sides** — `diff` reports **NOT MEASURED** against a `DECLARED`
  (imported) receipt, and a `DECLARED` receipt's badge reads *not measured*.

## What changed from v0.3 (multi-provider — spec v0.3.1)

- **`run.provider`** (required) — the two-axis provider the target model ran on:
  `"anthropic"` or `"openai"` (from the registry `provider`, else inferred from the
  id). Driftproof is now two-provider: the same suites and the same fixed judge,
  run on Claude and GPT substrates.
- **`run.surface`** gains the OpenAI lanes: the enum is now
  `"api" | "claude-cli" | "openai-api" | "openai-cli"`. `openai-api` = a
  Chat-Completions-compatible API (base_url configurable); `openai-cli` = the Codex
  subscription surface (`codex exec`). `run.judge.surface` accepts the same set.
- **`run.surface_overhead_note`** (optional) — present on the `openai-cli` surface:
  states the fixed Codex base-instruction preamble (~12–15k input tokens per call)
  that the harness prepends and does not control. The model id is set by us via
  `-m` (it is not echoed in the Codex JSONL stream).
- **Per-case `checks[]`** (optional) — deterministic post-check results, each
  `{ name, kind, pass }` with `kind ∈ regex | contains | not_contains | min_length`.
  Structural/regex assertions run on the model output **alongside** the judge and
  reported as a **separate column** — **supplementary evidence only, never folded
  into the `outcome`/band verdict.**
- **`skill.tokens`** (optional) — the estimated token size of the skill's SKILL.md
  (a coarse `chars/4` proxy, not a model tokenizer), used for the **value-per-token**
  axis: `delta` per 1k skill tokens. Method documented on the methodology page.
- **Per-case `case_status`** (optional; default `"ok"`) — `"failed_timeout"` marks a
  case whose model/judge call persistently timed out after retries. Such a case is
  **recorded WITHOUT fabricated samples/hashes** and is **excluded from the
  aggregates** — a band is never invented from a case that did not complete. When
  any case failed, the run is stamped **`run.status: "incomplete"`** (+
  `run.failed_case_count`), and a drift/durability report **must exclude an
  incomplete receipt from verdicts** (listing it honestly as "not measured").
- These are additive; a v0.3 or earlier receipt reads unchanged against its own
  frozen schema.

## Design goals

- **Reproducible.** Every hash is over a *canonical* JSON form (object keys sorted
  at every level, no insignificant whitespace), so the same inputs produce the
  same hashes on any machine.
- **Credible.** An LLM judge is noisy. v0.2 samples the judge N times per case and
  records the distribution, so a receipt carries a *band*, not a single fragile
  number — and drift reports only claim a regression when bands don't overlap.
- **Tamper-evident (lite).** The `receipt_hash` is a self-hash: recompute over the
  receipt with `receipt_hash` removed and compare. A hand-edit breaks it. This is
  integrity, **not** authenticity — v0.3 does not sign with a key (see open
  questions; "signed" is a promissory note until then).
- **Consumes, doesn't invent.** The eval suite format is `agentskills.io/evals`.

## What changed from v0.2 (transcript auditability + provenance)

- **Per-case `generation_hash`** — sha256 (hex) of the raw model generation that
  was judged for that (case, mode). Binds the graded case to the exact text.
- **Per-case `judge_sample_hashes[]`** — sha256 (hex) of each raw judge output,
  one per judge sample (same length as `samples`). A reader can check every score
  a verdict rests on against a retained transcript.
- **`run.transcripts`** — `"retained-local"` when the raw generations + judge
  outputs were also written to `transcripts/<receipt-id>/` (under
  `--keep-transcripts`), else `"hashes-only"` (the default — only the hashes).
- **`run.registry`** — `"registered"` when `model_id` resolved in the model
  registry (`config/models.json`); `"unregistered"` is import-only since v0.6, the runner refuses it (spec 026 AC-10):
  a run of ours refuses an id the registry does not carry before any call,
  naming the registry path, so no receipt we write says it; an imported
  receipt may, its model field being another tool's word (before v0.6 the
  run was not refused;
  cost was estimated with a conservative default price).
- These four fields are **required** in a v0.3 receipt. Everything else is
  unchanged from v0.2.

## What changed from v0.1

- Per-case: added `mean`, `stddev`, `samples[]`; `outcome` gains **`borderline`**.
- `run`: added a required `judge` block (samples, temperature, sampling, surface).
- Aggregates: added `stddev` (the run-to-run band) and `borderline_count`.
- `comparison`: added `delta_uncertainty`.
- Added optional top-level `editorial_reviews[]`.
- `score` is retained as an alias of `mean` so v0.1 readers keep working.

## Fields

### `schema_version` (string, required): `"0.9"`.

### `skill` (object, required)
| field | type | notes |
|---|---|---|
| `name` | string | From SKILL.md front-matter or its H1. |
| `version` | string | Skill's declared version. |
| `content_hash` | sha256 hex | Over `SKILL.md` + every bundled file (the `evals/` dir is **excluded** — hashed separately as `suite_hash`), path + content, path-sorted. |
| `unit` | `"skill"` \| `"plugin"` | **v0.9**, optional. `"plugin"` when a plugin was measured whole (a `claude plugin eval` import). |
| `tokens` | integer | **v0.3.1, optional.** Estimated SKILL.md token size (coarse `chars/4` proxy) for the value-per-token axis. |

### `suite` (object, required)
| field | type | notes |
|---|---|---|
| `format` | string | Always `"agentskills.io/evals"`. |
| `suite_hash` | sha256 hex | Over the canonicalized normalized case list (`{id, prompt, rubric, pass_threshold}`). |
| `case_count` | integer | Cases in the suite (before any `--max-cases` cap). |

### `run` (object, required)
| field | type | notes |
|---|---|---|
| `model_id` | string | Canonical model id run on. |
| `model_release_date` | ISO date or `null` | Release date **if known**, else `null`. |
| `provider` | `"anthropic"` \| `"openai"` \| `"unknown"` | **v0.3.1.** The two-axis provider (registry `provider`, else inferred from the id). **v0.9:** `"unknown"` on an imported receipt whose source records no model. |
| `surface` | `"api"` \| `"claude-cli"` \| `"openai-api"` \| `"openai-cli"` | `api` = Anthropic Messages API; `claude-cli` = spawned `claude -p` (subscription); `openai-api` = Chat-Completions-compatible API (base_url configurable); `openai-cli` = Codex subscription (`codex exec`). |
| `surface_overhead_note` | string | **v0.3.1, optional.** On `openai-cli`: the fixed Codex base-instruction preamble (~12–15k input tokens/call) the harness prepends and does not control. |
| `runner_version` | string | Runner version, for reproducibility. |
| `date_utc` | ISO 8601 UTC | As `lib/run.js` writes it: when the run's calls finished if the CLI stamps it, or the stamp a caller passes, which for a batch is one stamp shared by every receipt in the batch. For when generation began, read `generated_at` (v0.8). Before v0.8 this row said *when the run finished*, which was true of the CLI and not of a batch. **v0.9:** null only on an `external` receipt whose source records no date. |
| `registry` | `"registered"` \| `"unregistered"` | **v0.3.** Whether `model_id` resolved in the model registry (`config/models.json`). **v0.6:** `"unregistered"` is import-only; the runner refuses an unregistered id before any call (spec 026 AC-10). |
| `transcripts` | `"retained-local"` \| `"hashes-only"` | **v0.3.** Whether the raw generations + judge outputs were retained on disk (see § Transcripts). |
| `judge` | object | `{ samples, temperature, sampling, surface }`, see below. `samples` is optional from v0.8: absent means unknown. |
| `generated_at` | ISO 8601 UTC | **v0.8**, optional. When generation began, stamped before the first generation call. |
| `judged_at`, `grader_revision` | ISO 8601 UTC, object | **v0.8**, optional, together or not at all: a re-judge of frozen outputs, and the grading definition it applied. |
| `counts`, `arms` | object | **v0.8**, optional. See *What v0.8 adds*. |
| `harness`, `import` | object | **v0.9**, optional, imported receipts. See *What v0.9 adds*. |

**`run.judge`** records how grading was done: `samples` (judge calls per case),
`temperature` (a number when the surface lets us set it — the `api` surface pins
**0** — else `null`), `sampling` (`"api-temperature-0"` or `"surface-controlled"`),
and `surface`. Determinism where the surface allows: on `api` the judge is pinned
to temperature 0; on `claude-cli` sampling params are surface-controlled and the
receipt says so.

### `results` (object, required)
- **`cases`** — one entry **per (case, mode)**; every case appears twice
  (`with_skill` and `baseline`):
  | field | type | notes |
  |---|---|---|
  | `id` | string | Eval case id. |
  | `mode` | `"with_skill"` \| `"baseline"` | Whether SKILL.md was supplied. |
  | `outcome` | `"pass"` \| `"fail"` \| `"borderline"` \| `"score"` | **`borderline`** = the threshold lies within `mean ± stddev` (the run can't confidently call it). `score` = un-thresholded case. |
  | `mean` | number 0–1 | Mean of the judge samples. |
  | `stddev` | number ≥ 0 | Sample stddev of the judge samples — the raw per-case band half-width used by the borderline rule and per-case drift. |
  | `samples` | number[] | The individual judge scores. |
  | `generation_hash` | sha256 hex | **v0.3.** sha256 of the raw model generation that was judged for this (case, mode). |
  | `judge_sample_hashes` | sha256 hex[] | **v0.3.** sha256 of each raw judge output, one per sample (same length as `samples`). |
  | `score` | number 0–1 | Alias of `mean` (kept for v0.1 readers). |
  | `threshold` | number or `null` | The case's pass threshold (or `null`). |
  | `reason` | string | One-line judge rationale (optional). |
  | `checks` | array | **v0.3.1, optional.** Deterministic post-check results, each `{ name, kind, pass }` (`kind ∈ regex/contains/not_contains/min_length`). Run alongside the judge; a **separate column**, **not** folded into `outcome`/the band verdict. |
  | `judge` | object | `{ model_id, rubric_hash }` — who graded and a hash binding the grade to the exact rubric + judge system prompt. |
  | `activation`, `excluded_draws`, `label` | array, array, string | **v0.9**, optional, imported receipts. Whether the skill fired (never a score), the runs kept out of `samples` with their reasons, and the source's display name. See *What v0.9 adds*. |
- **`aggregates`** — `{ with_skill, baseline }`, each
  `{ case_count, pass_count, borderline_count?, mean_score, stddev }`. Here
  `stddev` is the **suite dispersion**: the stddev of the per-case means across
  the suite (a conventional "mean ± stddev across items"). It is a reported
  summary stat — the drift **headline verdict is driven by the per-case
  band-overlap verdicts**, not by a separate test on this aggregate band. (Using
  the standard error of the mean here instead would shrink with sampling and make
  the headline cry wolf on trivial moves — precisely what this design avoids.)

### `comparison` (object, required)
| field | type | notes |
|---|---|---|
| `with_skill_score` | number 0–1 | Aggregate with-skill mean. |
| `baseline_score` | number 0–1 | Aggregate baseline mean. |
| `delta` | number −1–1 | The skill's measured lift. |
| `delta_uncertainty` | number ≥ 0 | Combined band on the delta (quadrature sum of the two aggregate bands). |

### `verification_level` (string, required)
Community lattice: **UNVERIFIED** (bare claim) · **DECLARED** (author asserts, no
run) · **TESTED** (a suite was executed and judged — what Driftproof emits) ·
**FORMAL** *(reserved / unimplemented; the schema rejects it)*.

### `editorial_reviews` (array, optional)
Pointers to external one-shot reviews of the skill, each `{ url, source, date }`.
**Context only — not verification evidence.** A one-shot editorial verdict and a
dated, model-bound receipt are different things; this field lets a receipt link
the former without conflating it with the latter.

### `receipt_hash` (sha256 hex, required)
sha256 over the canonical receipt JSON **with `receipt_hash` removed**.

## Transcripts (v0.3)

Every generation and every judge sample is hashed into the receipt
(`generation_hash`, `judge_sample_hashes[]`), so a verdict is always checkable
*in principle*. `--keep-transcripts` makes it checkable *in practice*: the raw
generations and judge outputs are written to `transcripts/<receipt_hash>/` (one
JSON per case+mode, plus an `index.json`), and the receipt records
`transcripts: "retained-local"`. Without the flag the receipt records
`transcripts: "hashes-only"` and only the hashes are kept. **What is retained
is the last measured draw of each case and mode only**: the runner keeps one
transcript per case and mode and overwrites it on every draw, so the per-case
top-level hashes (which are that draw's) can be re-derived from disk, and the
draw-level hashes of earlier draws are checkable against nothing the runner
wrote (spec 026, stated as the bound rather than moved). The transcript
directory is **gitignored by default** — raw model text is never committed. The
default for trigger-initiated runs is `retained-local` (disk is cheap, audits are
not). To verify a retained receipt: re-hash each transcript file and compare
against the receipt's `generation_hash` / `judge_sample_hashes`.

## Drift verdict (how `diff` reads two receipts)

For each case, Driftproof compares the two `with_skill` bands (`mean ± stddev`).
A verdict requires **two** conditions — band separation **and** a minimum effect:

1. **Band separation** (geometry):
   - **regression** — `meanB + stddevB < meanA − stddevA` (B's band is entirely below A's)
   - **improvement** — `meanB − stddevB > meanA + stddevA`
   - otherwise no separation is detected (the bands touch or overlap), and a report
     labels the case *no separation detected*; the verdict value the differ records
     is unchanged pending the verdict-rule spec
2. **Minimum effect floor** — `|meanB − meanA| ≥ EFFECT_FLOOR` (default **0.05**, see
   `config.js`). A regression/improvement from step 1 whose mean moved by *less*
   than the floor keeps a verdict value of its own, labelled *below effect floor*: a
   separation was detected, and it is too small to call.

**Why the floor.** The LLM judge quantizes scores to a coarse ~0.05–0.1 grid, so a
confident grade frequently has `stddev 0` — a zero-width "point band." Two point
bands one quantum apart (e.g. `0.60` vs `0.64`) are technically non-overlapping yet
represent no meaningful behaviour change. The floor stops that statistically-real-
but-practically-trivial move from being reported as drift. `0.05` ≈ one judge
quantization step; the comparison is inclusive (a move of exactly 0.05 counts).

A regression is claimed **only** when both conditions hold. The **headline verdict
summarizes the per-case verdicts** (e.g. "DRIFT: separation detected under the rule
on 2 cases, downward", or "NO SEPARATION DETECTED" when no case separated under the
rule at the sample size used, which is not evidence that nothing changed); it does
not run a separate, tighter
test on the aggregate mean. This is the anti-false-positive core: band separation
**plus a real-sized delta**, not either alone, is what triggers a verdict.

## Example (abridged)

```json
{
  "schema_version": "0.3",
  "skill": { "name": "commit-message-conventions", "version": "0.2.0", "content_hash": "…64 hex…" },
  "suite": { "format": "agentskills.io/evals", "suite_hash": "…64 hex…", "case_count": 10 },
  "run": {
    "model_id": "claude-haiku-4-5-20251001", "model_release_date": "2025-10-01",
    "surface": "claude-cli", "runner_version": "0.3.0", "date_utc": "2026-07-27T09:15:00.000Z",
    "registry": "registered", "transcripts": "hashes-only",
    "judge": { "samples": 5, "temperature": null, "sampling": "surface-controlled", "surface": "claude-cli" }
  },
  "results": {
    "cases": [
      { "id": "perf-not-refactor", "mode": "with_skill", "outcome": "pass",
        "score": 0.86, "mean": 0.86, "stddev": 0.05, "samples": [0.9,0.8,0.85,0.9,0.85],
        "generation_hash": "…64 hex…", "judge_sample_hashes": ["…64 hex…","…","…","…","…"],
        "threshold": 0.7, "judge": { "model_id": "claude-haiku-4-5-20251001", "rubric_hash": "…64 hex…" } }
    ],
    "aggregates": {
      "with_skill": { "case_count": 10, "pass_count": 7, "borderline_count": 1, "mean_score": 0.81, "stddev": 0.02 },
      "baseline":   { "case_count": 10, "pass_count": 1, "mean_score": 0.42, "stddev": 0.03 }
    }
  },
  "comparison": { "with_skill_score": 0.81, "baseline_score": 0.42, "delta": 0.39, "delta_uncertainty": 0.036 },
  "verification_level": "TESTED",
  "receipt_hash": "…64 hex…"
}
```

## Open questions (v0.3)

1. **"Signed" is really "self-hashed".** `receipt_hash` is integrity, not
   authenticity — anyone can recompute it after an edit. A key signature (Ed25519
   over the canonical form, or in-toto/sigstore attestation) is the natural next
   step and the main thing standing between v0.2 and a receipt a third party can
   *trust*, not just *read*.
2. **Sampling captures judge variance, not generation variance.** v0.2 samples the
   judge N times on a **single** generated response per (case, mode). That
   quantifies judge noise — the dominant, cheapest-to-measure source — but a fresh
   generation each run would vary too. Bands may therefore be tighter than true
   run-to-run spread. Sampling generations (and separating the two variance
   components) is a candidate for v0.3.
3. **Two different "bands" coexist.** Per-case `stddev` is judge-sample spread
   (drives borderline + per-case drift); aggregate `stddev` is suite dispersion
   (a summary stat). Neither is a true run-to-run confidence interval — building
   one would need repeated full runs (generation + judge), which v0.2 does not do
   (see #2). The headline sidesteps this by summarizing per-case verdicts rather
   than testing the aggregate band.
4. **`model_release_date` provenance is unverified** (small built-in table + a date
   parsed from the model id). Should cite a source or be omitted.
5. **`outcome: "score"` overlaps the numeric `score`/`mean`.** Mild redundancy,
   kept so thresholded and un-thresholded suites both round-trip.
6. **No environment fingerprint** beyond `runner_version` — fine while the runner
   is the only producer; matters once third parties emit receipts.
7. **Baseline construction is fixed** ("same prompt, no SKILL.md"). Skills that
   assume tools/context a bare baseline never had can show inflated lift; a future
   spec may need to declare the baseline condition.
8. **`editorial_reviews` scope.** Deliberately marked context-only; if it starts
   being treated as evidence, it will need its own trust rules.
