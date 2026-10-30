<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driftproof receipt, spec v0.16

A **receipt** is a **hash-verified**, dated record of running one agent skill's eval suite
**with** and **without** the skill on one model version, with the judge **sampled**
so every score carries a band: a descriptive spread, the mean plus or minus one
sample standard deviation, with no coverage probability. Receipts are the unit of evidence
Driftproof produces; diffing two receipts across model releases yields a **drift
report**.

The machine-readable contract is [`receipt.schema.json`](./receipt.schema.json)
(JSON Schema, draft 2020-12). This document is the human companion. Where they
disagree, the schema wins.

**Versioning.** The current schema is v0.16
([`receipt.schema.json`](./receipt.schema.json)). Prior schemas are kept frozen as
[`receipt.v0.15.schema.json`](./receipt.v0.15.schema.json),
[`receipt.placebo.schema.json`](./receipt.placebo.schema.json) (v0.14),
[`receipt.v0.13.schema.json`](./receipt.v0.13.schema.json),
[`receipt.v0.12.schema.json`](./receipt.v0.12.schema.json),
[`receipt.v0.11.schema.json`](./receipt.v0.11.schema.json),
[`receipt.v0.10.schema.json`](./receipt.v0.10.schema.json),
[`receipt.v0.9.schema.json`](./receipt.v0.9.schema.json),
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
reports, which the gate asserts on each run. v0.15 is not additive for a writer: it requires
`skill.unit` and `run.delivery`, so a v0.14 or v0.13 receipt restamped `"0.15"` does not validate,
and both are frozen (see *What v0.15 adds*). v0.13 is additive for a reader: it adds optional
fields, so a v0.12 receipt restamped `"0.13"` validates; v0.12 is frozen because its version
constant refuses anything else (see *What v0.13 adds*). v0.12 was additive over v0.11 in the same
way (see *What v0.12 adds*). v0.11 was additive over v0.10 in the same
way: it adds one optional field, and v0.10 is frozen for the same reason (see *What v0.11 adds*).
v0.10 was additive over v0.9
in the same way: it adds two optional fields (see *What v0.10 adds*). v0.9 was additive in the
same way: it adds optional fields and widens three values, so a v0.8 receipt restamped `"0.9"` validates;
v0.8 is frozen because its version constant refuses anything else (see *What v0.9 adds*).
v0.8 was additive over v0.7 in the same way (see *What v0.8 adds*).

## Explicit per-call timeout

Issue 489 adds optional `run.timeout_ms` to the current v0.15 schema.
`driftproof run --timeout <seconds>` applies a positive integer number of
seconds to each generation and judge attempt, on every surface. The maximum
is 2147478 seconds, within Node's timer bound including CLI cleanup grace. Each retry receives the same
limit; retry counts and backoff stay unchanged. The setting works with
`--quick` and does not change its sampling or UNVERIFIED level.

The receipt seals the explicit setting in milliseconds. It records a
configured limit, not elapsed time or a deadline for the whole run. It does
not guarantee that remote work stops when the local timeout fires. A stub
records the requested setting without making a model call.

Without the flag, surface defaults and the receipt's shape stay unchanged.
An absent field means no explicit uniform setting is recorded; a reader
cannot infer a default from it. Older receipts and imports omit it. Library
callers with an explicit supported `opts.timeoutMs` record it when every
selected case uses it. Per-case overrides retain their precedence; a varying
run omits the uniform record. A regrade does not carry this original-run
setting into its new operation. Frozen versioned schemas remain unchanged.

## Auxiliary calls on claude-cli

Spec 180 (issue 134). Claude Code can make a call of its own on another model, such as a Haiku call,
and name that model in the reply's `modelUsage` beside the model the run asked for. The runner reads
which model served the main turn, never only which models were named. With `want` the canonical form
of the requested id (a trailing `-YYYYMMDD` is not part of it):

1. `want` is not among the ids named: the run stops with `SUBSTRATE_MISMATCH`.
2. The result message names its serving model (a top-level `model`) and it is another: the run stops.
3. Every id named is `want`: attested, as before.
4. The result names `want` as its serving model: attested.
5. Otherwise `want` must carry more than half of the output tokens the reply counts per id, ids summed
   by canonical form. A tie, or no count at all, stops the run.

A stop happens before the next call, and no receipt is written. Its message names the id that
answered, the requested id and which rule fired.

**Every other id is recorded.** On an attested reply each id that is not `want` is an auxiliary call.
The draw records it in **`auxiliary_calls`**
(`results.cases[].generation.draws[].auxiliary_calls`): a list of `{phase, model, input_tokens,
output_tokens}`. `phase` is `generation` or `judge`, `model` is the id as the
surface named it, `input_tokens` is total input with cache, as the usage block is normalized, and
`output_tokens` is what that id generated. Generation entries come first, then each judge sample's. The
field is absent when there was none. A regrade keeps the generation entries and records its own judge
entries. `run.answered_by.reported_models` still carries every canonical id named.

The field is optional and sits on a draw object, which v0.11 declares open (`additionalProperties`
true). The schema did not change for it and `schema_version` stayed `"0.11"`, so a receipt with no
auxiliary call is the same bytes as before. (v0.12 keeps the draw open; it moves the version for
other fields, see *What v0.12 adds*.)

**The Claude Code version** is in `run.harness` `{name: "claude-code", version}`, read from `claude
--version` as generation begins (see *What v0.10 adds*).

**The range the claude-cli lane is verified on.** Published reports ran on Claude Code 2.1.272 (Report
009), 2.1.280 (Report 011) and 2.1.284 (Reports 013 and 014), each read from the report's own page. A
check on 9 Oct 2026 ran on 2.1.295 and its replies named only the requested model. The two-id reply
reported on 2.1.295 is covered by fixtures in `tests/substrate-auxiliary.test.js`, not by a live call.

## Criteria cases

Spec 185 (issue 179). A case in `evals/evals.json` may list **`criteria`**, entries of `{ id, weight,
description }`. Ids are unique within the case, each 1 to 64 of A-Z, a-z, 0-9, underscore, dot and
hyphen. Weights are numbers greater than 0, and their sum is finite. Descriptions are not empty. A case
lists at most 50 criteria. A bad list is refused when the suite loads, before any call, with
`BAD_CRITERIA`. A description is at most `CASE_MAX_CHARS` characters, the bound a prompt and a rubric
have, and one longer is refused with `INPUT_BOUND`, naming the bound, as they are. A case with criteria
needs no rubric; a rubric it has is shown to the judge as context.

A `criteria` list is read as criteria only when it holds objects. A `criteria` that is a string or
a list of strings takes the path it took before spec 185: it is the rubric text when the case has no
rubric, and is not read when it has one, with the same hashes as before. An empty list is not read
when the case has a rubric; a case with an empty list and no rubric is refused, as a case with no
rubric is (issue 196). A list that mixes objects with other entries is refused.

**The judge decides, and the code adds up.** For a criteria case the judge is asked to decide each
criterion, `met` or `not_met`, with a one-sentence reason, and to give no total. The weighted total is
computed in code: the weights of the criteria decided `met` over the sum of all the weights, rounded to
six places. So is the pass: the total at or above `pass_threshold`. Any key in the reply that is not
read is recorded as ignored: a top-level key other than `judgments`, such as `score` or `pass`, by its
name, and a key inside an entry other than `id`, `decision` and `reason` as `judgments[<id>].<key>`.

**A sample's pass is not the case outcome.** The pass above is per sample. The case outcome comes from
the draws by the rule every case uses: the mean and its standard deviation against the threshold. That
rule reads a band that touches the threshold as borderline,
so a mean exactly at the threshold reads borderline. Three of four equal weights met at a threshold of
0.75 gives every sample a pass, and the case reads borderline, not pass.

**A reply that does not decide every criterion is unmeasured.** Every criterion must appear exactly
once with an allowed decision and its reason. A missing, duplicate, unknown or malformed entry, or a
decision outside the set, makes the judge sample unmeasured, and its draw with it, with a reason naming
the fault. It is never scored. An entry whose reason is left out, empty or blank is malformed too,
naming the criterion: a reason is required, not only read when present. A reason must hold a letter or a
digit, in any script, that is not a default-ignorable code point; one of only white space, punctuation,
marks, or zero-width, format or filler characters is no reason, and is malformed the same way.

**What is recorded.** A measured draw of a criteria case carries **`criteria_judgments`**
(`results.cases[].generation.draws[].criteria_judgments`): one entry per judge sample, in sample order,
each `{ total, pass, judgments, ignored }`. `judgments` is `{ id, decision }` per criterion, in the
suite's order, and `total` is the sample's entry in `samples`. Under `--keep-transcripts` the retained
record of the case also carries **`criteria_samples`**, one per sample, `{ raw, judgments, total, pass,
ignored }`, with each judgment's reason beside the judge's raw reply. `raw` is the text whose sha256 is
the sample's entry in `judge_sample_hashes`. Every draw of a criteria case that the judge answered,
measured or not, also carries **`criteria_template_hash`**: the sha256 of the criteria template with
nothing of any case in it (the criteria system text, and the prompt rendered with fixed text for the
task, the answer, the context and one criterion). A draw of a case without criteria carries none. A run
with a criteria case records the same hash once as `run.judge.criteria_template_hash` (receipt v0.12).

**What a regrade keeps.** A regrade records `criteria_judgments` the same way. Regrade has
no `--keep-transcripts`, so a regraded criteria draw keeps each sample's decisions, total, pass,
ignored keys and hash, and not the per-criterion reasons or the raw replies.

**A rubric regrade of a criteria case.** `regrade --rubric` may revise its criteria: descriptions,
weights, criteria added or removed. The revised list is held to the checks a run applies, before any
call. The case is graded per criterion under the revised list, its `criteria_judgments` are recorded,
and its rubric hash and the sidecar's changed cases name the change. A case may not change shape, from
criteria objects to a rubric alone or back. The criteria template may not change either: the original's
`run.judge.criteria_template_hash`, and each judged draw's `criteria_template_hash` in its criteria
cases, must be this runner's, and another, or none, is refused before any call. The run's record is
compared even when every draw of a criteria case timed out and so records none. See *A rubric regrade*
under § Transcripts.

**Identity.** The criteria enter `suite_hash`, so an edit to any id, weight or description moves it.
They enter the case's `judge.rubric_hash` and a regrade's `grader_revision.rubric_hashes` as the
criteria prompt renders them for this case, with fixed text in place of the task and the answer, so
a change to how a criterion is shown to the judge moves the hash too. A suite with no criteria case is
hashed, graded and recorded as before, byte for byte. The fields sit on a draw object, which v0.11
declares open, so they did not change the schema and `schema_version` stayed `"0.11"`. (v0.12 keeps the
draw open; it moves the version for other fields, see *What v0.12 adds*.)

**Receipts made by 0.19.0.** A criteria case row of a receipt made by 0.19.0 carries the earlier form
of the rubric hash, which covered the criteria template with no criterion line in it, and its draws
carry no `criteria_template_hash`. `driftproof stale` does not read such a case as current: its rubric
axis says the receipt records the hash in the form 0.19.0 wrote for a criteria case, which did not
cover how each criterion line is rendered, so this runner's form differs for the same criteria, and a
regrade records the current form. `regrade --rubric` refuses such a receipt, naming the missing
`criteria_template_hash`; a judge regrade, without `--rubric`, reads it as before.

**What this does not claim.** Computing the total in code fixes the arithmetic, not the judge's reading
of an answer: a judge can still decide a criterion wrongly. How accurately a judge reads answers is a
separate validation question. Nothing here says criteria make grading more accurate or show that a
skill is better. What they add is a record of each decision behind a score, which a reader can audit.

## Plain judge regrade

A plain judge regrade refuses anonymous judge replies; no receipt is written. Each returned sample must report the requested judge identity. A mixed-model reply must explicitly name the requested judge as serving the reply. Reported ids preserve dates when supplied. The stub exception records UNVERIFIED. An UNVERIFIED original stays UNVERIFIED. Reported identity comes from the reply and does not authenticate provider identity or measure grading accuracy.

Every returned sample is checked, including invalid scores and replies beside a timeout.
A refusal exits 5 before writing a receipt, summary or sidecar. The stub exception requires both
the configured stub surface and every returned reply to name that surface. A false stub label refuses.
For a single-model reply, the reported id suffices. Token share alone does not identify the serving
judge of a mixed-model reply. The serving id must match the requested judge and a reported id by
canonical model. Aggregate judge ids are unique and sorted in JavaScript lexical order.

Each newly judged draw seals `judge_sample_evidence` in returned-sample order. Each record has
`sample_index`, `output_sha256`, `reported_models` (including auxiliary ids and duplicates),
`served_model` (null if absent), `answered_by` and `surface`. Its output hash equals that sample's
`judge_sample_hashes` entry. The evidence is retained for invalid scores and returned replies beside
a timeout too. Carried draws stay unchanged. This optional evidence uses the draw's extensible shape.
The receipt hash seals the correspondence; it cannot authenticate an identity a surface reported.

Plain regrades count endpoint attempts through the runner's attempt callback, independently of
returned attempt metadata. Retries and timeouts count. A stub makes no endpoint attempt.
Logical calls count requested samples separately. Requests inside a CLI remain outside the count.

Answers archives are limited to 16777216 bytes before parsing, including legacy directory totals and
files that grow while read. Direct answers allow 4096 entries, 1048576 UTF-8 bytes per answer and
16777216 total text bytes. Keys must be 64 lowercase hexadecimal characters. Legacy directories allow
4096 JSON files. Identity evidence allows 128 ids of at most 256 UTF-8 bytes each, using ASCII letters,
digits, dot, underscore or hyphen. Blank, malformed and non-string ids refuse. The serving id follows
the same rule. Input bounds refuse before calling the judge; reply bounds refuse before copying or
interpolating identity. Bound diagnostics omit hostile input. These limits cover answers and identity
entering regrade, not provider transport buffering or receipt and suite size.

## What v0.16 adds: fake tool calls in text capture

Issue 538. Sampled text receipts seal `results.fake_tool_calls`: one entry per
scheduled arm, including placebo, with `count` and `draws`. The denominator is
all attempted draws across the arm's cases, including failed cases. Each fake
reply records `capture_outcome: "fake_tool_call"`, status `unmeasured`, its answer
hash and reason, no samples and null mean and standard deviation. It never reaches
the judge or enters the scored mean. Counts must match the draw records.

At 5% or more in any arm, the headline says: "Comparison unreliable: at least 5%
of an arm's replies ended in fake tool calls." The CLI uses the same sentence.
The comparison cannot receive a positive or negative measured verdict. Regrades
apply the same detection before planning or making judge calls. This rule does
not change repository or files capture. Old receipts keep their own schema;
[`receipt.v0.15.schema.json`](./receipt.v0.15.schema.json) freezes v0.15 byte for byte.
Old receipts do not imply a zero count.

## What v0.15 adds: what the subject was, and how the run was configured to deliver it

Issue 438 (spec 438). Every receipt from v0.15 on names its subject's kind in `skill.unit` and the
delivery its run was configured with in `run.delivery`. Both are required and both are inside
`receipt_hash`. Every writer moves to v0.15, the runner, a regrade, every importer, and a run with
`--placebo`; v0.14 is frozen as `receipt.placebo.schema.json` and v0.13 as
`receipt.v0.13.schema.json`, byte for byte.

**Kind.** `skill.unit` is `skill`, `plugin` or `context_file`. A context file is any Markdown file,
such as a CLAUDE.md, an AGENTS.md or a shared rules file, given to `driftproof run FILE --suite
FILE` in place of a skill directory. It is run on the injection path as a skill is: its exact bytes
are the with-skill system text, `skill.content_hash` is their sha256 (the value `sha256sum FILE`
prints), `skill.name` is the file's base name, and everything else about the run is a skill run's.
A file that is a link, is not UTF-8, holds a NUL or holds no letter or digit is refused before any
call, and so is one past what the run's surface can carry: one argument of the spawned command on
claude-cli, 32,000,000 bytes of request body on the API.

**Delivery.** `run.delivery` is one of three values.

- `injected`: the runner puts the subject text into each with-skill request it builds. On the API
  it is the system prompt; on claude-cli it is appended to the harness's system prompt; on codex it
  goes before the task on standard input. Every runner version has been configured so.
- `installed`: a harness loaded the subject itself from where it was installed, and Driftproof put
  none of its text in a request. Only an import says this: the claude plugin eval.
- `unknown`: an imported source that does not say how its subject reached the model. Every other
  importer writes it, as no source field is invented.

The field records the configured delivery, not that a request was sent: a stub run sends none, and
a run whose every with-skill request failed completed none. A context file's summary says which,
from the with-skill draws whose answers came back. A TESTED receipt is `injected`, and its unit is
`skill` or `context_file`. `run.model_id` holds no line break.

**An older receipt** reads by one rule (`lib/receipt.js` `kindOf` and `deliveryOf`), never marked
recorded: an absent unit is a skill (v0.9's rule); a receipt an importer wrote is `installed` when
the claude plugin eval wrote it and `unknown` otherwise; every other receipt was written by the
runner and is `injected`. A reader that shows a derived value marks it `(derived)`.

**Readers.** `diff` forms per-case verdicts only across subjects of known, equal kind and known,
equal delivery, and otherwise names each side's two values. `stale` and `triage` read both in the
`skill` axis: a kind or a delivery that is unknown, or differs from today's, means reuse of the
with-skill answers is not established. A regrade keeps the original's kind and delivery, and
refuses a receipt that is not a skill injected.

## The placebo arm (v0.14)

Issue 440 (spec 440). `driftproof run --placebo` answers every case a third time, with a placebo in
the skill text's place. The placebo is a text of exactly the skill text's length in UTF-8 bytes,
drawn from a fixed corpus of sentences about landscape, weather and village life, chosen without
reference to any task. A case can still ask about something the corpus mentions, so the placebo is
not shown to carry no information about a task. It is the only length measure; the receipt records
token estimates as figures beside it.

Under spec 440, a run without `--placebo` wrote v0.13, byte for byte as before, and a run with it
wrote v0.14, which validates against `spec/receipt.placebo.schema.json`: v0.13 with these additions.
From v0.15 (issue 438) every run writes v0.15, a run with `--placebo` included, which carries the
same additions under the same rules; v0.14 is frozen and still read (see *What v0.15 adds*).

- Rows with `mode` `placebo` in `results.cases`, recorded like the other two arms. The placebo arm is
  graded by the same judge, samples, template, rubric, criteria and checks, and draws by the same
  sampling rule. No other block of the receipt reads its rows: `results.aggregates`, `comparison`,
  `economics` (but for the judge overhead, which counts every judged draw) and the verdict are what
  they would be without it.
- A top-level `placebo` block, inside `receipt_hash`: `revision`, `length_measure` (`utf8_bytes`),
  `skill_bytes`, `bytes`, `seed` (the receipt's `skill.content_hash`), `corpus` (the revision's
  sentences), `corpus_hash`, `sha256` (of the placebo text), two token estimates, and `aggregates` and
  `comparison` over the paired cases. A receipt carries the block exactly when it carries a placebo
  row.

A reader rebuilds the placebo from `bytes`, `seed` and `corpus`, and checks its hash, the corpus hash
against the pinned hash of the revision, and the figures against the rows. The text is the corpus's
first sentence, then the others in an order drawn from a sha256 chain seeded by the revision and the
seed, a blank line after every fourth sentence, cut to `bytes`. A revision's corpus never changes. Every
bound is checked before anything is built: `bytes` from 1 to 262,144, at most 64 sentences of at most
160 printable ASCII characters.

**The placebo reading** (`lib/verdict.js` `placeboReading`) is given beside the verdict, never in its
place. It is the verdict's own case rule applied to the with-skill arm against the placebo arm, on the
cases the verdict reads. The summary says it in these words:

| reading | the words |
|---|---|
| `ABOVE_PLACEBO` | case rule: at least one case scored above the same-length placebo, and none below |
| `BELOW_PLACEBO` | case rule: at least one case scored below the same-length placebo |
| `INCONCLUSIVE` | case rule: inconclusive against the same-length placebo |
| `UNDERPOWERED` | case rule: then the verdict's plain line for that state |
| `NO_DIFFERENCE` | case rule: no case differed from the same-length placebo at this effect floor |
| `NOT_MEASURED` | not measured against the placebo, with every route that fired |

The case rule reads cases one by one, and the aggregate difference of means can point the other way:
one case at 0.60 against 0.50 and nine at 0.46 against 0.50 read `ABOVE_PLACEBO` with an aggregate
difference of -0.026. So the summary gives the aggregate on its own line, labelled as apart from the
case rule. The reading is `NOT_MEASURED` wherever the verdict is, with no placebo arm
(`no_placebo`), when the block does not check from the receipt (`placebo_unverified`), and when a case
the verdict reads has no paired placebo result (`placebo_cases_differ`). It compares two arms and
says nothing about why a skill helps. A receipt with a placebo arm is not regraded.

## What v0.13 adds: figures a source printed, and the mark that reads no verdict from them

Issue 265 (spec 265). An import from a source that publishes aggregates only, one score and one
uplift per dimension and agent with no per-run score, has figures to carry and nothing a band can be
formed from. v0.13 adds two optional top-level fields for such a receipt, both inside
`receipt_hash`, and one optional economics figure. A v0.12 receipt restamped `"0.13"` validates,
and v0.12 is frozen as [`receipt.v0.12.schema.json`](./receipt.v0.12.schema.json).

- **`uncertainty_unavailable`**: the mark, one value, `aggregates_only`. The source gives aggregates
  only, so no band, spread or verdict can be formed. A receipt carrying the mark reads no verdict: every
  reader in the repository reads the mark where it reads `verification_level`
  (`lib/verdict.js` `receiptAggregatesOnly`), and `receiptVerdict` reads it as `NOT_MEASURED` by its own
  route, `aggregates_only`.
- **`source_figures`**: the figures as the source printed them for the receipt's agent: the agent, the
  skill, the evaluation date as printed (to the day), the evaluator version, environment, dataset
  digest, task count and attempts per task where printed, one row per row of the results table
  (`dimension`, the cell as `printed`, `score_pct`, `baseline_pct` only where the cell prints one,
  `uplift`, `uplift_unit` and `tasks`), and the token row as printed. `uplift_unit` is `points`
  where the cell says points and `unstated` where it prints a bare percent; no baseline is worked out
  from an unstated unit.
- **`source_figures.source`**: `{ repo, commit, files }`, the repository, the commit read (the
  checkout's HEAD, given by `--commit`), and each file read with its `path` and `git_blob_sha1`, the
  card first and `benchmarks.json` second. Each blob sha1 is computed from the bytes read and equals
  the blob the commit holds at that path, so a reader can fetch that commit and check every figure.
  `receipt_hash` is a hash of the receipt's own fields: it shows the receipt was not edited after it
  was hashed, not who wrote the source. Driftproof records the files and the commit it read; it
  does not attest the author.
- **`economics.<arm>.total_tokens`**: a token total the source reports for the arm, with basis
  `source-reported`. No mean, cost or call count is worked out from it.

The schema holds the mark to its meaning: `source_figures` needs the mark; a receipt carrying the
mark is not `TESTED`, its comparison is null with `delta_uncertainty_unavailable: "no_cases"`, its
case rows carry a `case_status` other than `ok` and no score, mean, spread, samples or counts, its
aggregates carry no mean or spread, and `run.counts` is absent. The NVIDIA importer that writes these
receipts is described in [`docs/interop.md`](../docs/interop.md).

## What v0.12 adds: the judge's setting, and a regrade's evidence sealed

Issue 196. A regrade grades a receipt's saved answers again, and its receipt is the evidence that
it did. v0.12 records what the judge graded in, and seals what a regrade did inside the regraded
receipt's own hash. Every field is optional, so a v0.11 receipt restamped `"0.12"` validates, and
v0.11 is frozen as [`receipt.v0.11.schema.json`](./receipt.v0.11.schema.json).

**The judge's setting, on every run.** `run.judge` adds these fields, each read before any call but
the last, which is read from the judge's replies:

- **`harness`**: `{ name, version }` of what the judge ran on: `claude-code` or `codex` with the
  version its binary printed, read through the judge's own spawn path; `api` with a null version on an
  api surface; `none` on the stub. On a CLI surface the CLI's own instructions are part of what the
  judge reads, so its version is part of the judge.
- **`isolation`**: the judge's spawn path. `eval-user` is the isolated hop; `same-user` is
  `--trusted-skill`, where the judge runs with the operator's working directory, files and
  environment; `none` is an api surface or the stub.
- **`endpoint`**: `{ custom, sha256, resolved_by, routing }`, the route the judge's call takes, resolved
  by the code that makes the call (`lib/provider.js` `callRoute`), and never the address.
  - On an api surface, `resolved_by` is `runner`: `sha256` is of the address the call is sent to, the
    address of the Anthropic client the call is made with (the SDK's reading of `ANTHROPIC_BASE_URL`,
    else its default), or for an OpenAI judge `OPENAI_BASE_URL`, else the registry's
    `providers.openai.base_url`, else the public default. `custom` is true when it is not the default.
  - On a CLI surface, `resolved_by` is `cli`: `sha256` is of the `ANTHROPIC_BASE_URL`, or for codex the
    `OPENAI_BASE_URL`, in the environment the spawn plan hands the CLI, null when it hands none, and
    `custom` says which. The CLI resolves its own address from that environment and its own settings.
  - On the stub, `resolved_by` is `none` and nothing is recorded: no call is made.
  - `routing` names `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_VERTEX_BASE_URL`,
    `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` and `HTTPS_PROXY`, each `{ set, sha256 }`: set or
    not in the environment the call is made in, and the sha256 of its value. On an api surface that is
    this process's environment; with `--trusted-skill` it is the operator's, which the spawn plan hands
    the CLI; behind the hop it is `HOME` and `PATH` only, so every variable reads not set. The hop
    then runs a login shell as the eval user, which reads that user's shell profile, and what the
    profile sets is not recorded (see below).
  - Each hash is an unsalted sha256, so an address or a value that can be guessed can be recovered from
    it by hashing the guess. Only the hash is recorded.
- **`code_revision`**: the revision of the code on the judging path, `lib/judge.js`
  `JUDGE_CODE_REVISION`. It is derived when the runner loads from these files, each hashed whole:
  `config.js`, `lib/canonical.js`, `lib/capture.js`, `lib/json.js`, `lib/judge.js`, `lib/provider.js`,
  `lib/regrade.js`, `lib/run.js`, `lib/sampling.js`, `lib/stats.js` and `lib/usage.js`. They hold how a
  judge's reply is extracted, parsed, read and scored, how its calls are made and retried, how draws are
  sampled, and which answers reach the judge. A one-character change to any of them moves it. It is
  `judge-code-` and 16 hex of the sha256 over one line per file, its path and the sha256 of its bytes.
- **`criteria_template_hash`**, when a case of the run lists criteria: the criteria template the run's
  criteria cases were graded on (see *Criteria cases*), recorded once.
- **`reported_models`**: the ids the judge's replies named for the judge's own model, as named, so a
  dated snapshot stays dated, sorted; null when no reply named one or any answered sample lacked an
  identity (the stub, and codex, name none).

A rubric regrade compares each of these with its own and refuses a difference, naming the field and how
to match it; an original that records one not at all is refused by name. An original with null, empty
or invalid reported model ids is refused before any call. Each answered judge sample must establish
its own identity; an anonymous reply stops a rubric regrade even if other replies name the expected
model. The first five are compared
before any call. `reported_models` is compared as the regrade's judge answers: a draw whose judge names
an id the original's did not stops the regrade there, and once every call is made the two lists must be
the same; either way it stops with a substrate mismatch, writes no receipt and says the calls made. A
regrade records its own judge's setting, never the original's. `runner_version` is not compared, and a
judge regrade, another judge on purpose, compares none of them.

**Not recorded and not compared.** These can change what the judge reads or where its call goes, and
the receipt holds none of them, so a rubric regrade cannot show they are the original's:

- a CLI judge's own settings files: `~/.claude/settings.json`, project settings, and any `CLAUDE.md`
  file the claude CLI reads, and codex's `~/.codex/config.toml`;
- behind the hop, the eval user's shell profile, which the hop's login shell reads, and anything it
  sets, its environment variables among them;
- any routing variable but the five above: `https_proxy` in lower case, `HTTP_PROXY`, `NO_PROXY`, cloud
  region and credential variables, and the address a CLI resolves from its own settings;
- the network the call crosses: name resolution, a system proxy, and the service behind the address;
- the model behind an id that names no date, beyond what `reported_models` records.

**A regrade's evidence, sealed inside its hash.** A regraded receipt carries two objects, together
and only with `run.judged_at`:

- **`run.regraded_from`**: the original's `receipt_hash`, `runner_version` and `run_date_utc` (its
  `run.date_utc`);
  **`answers_sha256`**, the sha256 of the canonical JSON of the `answers` object the regrade read,
  which a reader recomputes from the archive's `answers`; in a rubric regrade
  **`rubric_revision_sha256`**, the sha256 of the revised suite file's bytes; and `judge`, the
  original's `run.judge` block as it recorded it.
- **`run.regrade`**: `mode`, `judge` (another judge, spec 044) or `rubric` (spec 184); `draws`,
  `{ graded, carried }`, the draws that reached the judge and the rest (no answer to grade, or a lost
  answer); **`judge_calls`** and **`judge_attempts`**, equal counts of endpoint attempts, including
  retries, failed attempts and timeouts; **`judge_logical_calls`**, the logical judge calls started
  (one sample, possibly several attempts), including calls that failed or timed out; and in a rubric
  regrade **`cases_changed`**, each case changed with its grading fields. The numeric call cap
  (`regradeReceipt` defaults to `DEV_MAX_CALLS` from `config.js`) is enforced before each endpoint
  attempt, as well as against the initial projection. A stop reports
  the attempts already made. A CLI attempt is one CLI invocation; requests the CLI makes internally
  are not visible to the runner and are not counted.

**A case row's checks.** A regrade runs no deterministic check. A row whose original carried checks
gets **`checks_regrade`** `{ carried, generation_hash, reason }`: `carried` true when the row's
`generation_hash` is the original row's, the answer the checks were run on, and the row carries the
original's `checks`; `carried` false otherwise, with no `checks` on the row, and the reason says why.
`generation_hash` is the original row's.

An edit to any of these breaks the regraded receipt's `receipt_hash`. The `.regrade.json` sidecar is a
readable copy that names the receipt, and the lineage is the receipt's alone. It holds `format`;
`receipt_hash`, the regraded receipt's own, which names it; `generated_at_basis`, which generation time
the regrade carried; `draws`, `calls`, `attempts` and `logical_calls`, the counts the receipt seals,
repeated to read; and
`judge_reported_models`, the canonical ids the regrade's judge named. `bin/driftproof` adds `answers`:
the answers file's name, its own sha256 and the draws graded. In a rubric regrade it holds
`rubric_revision`: the revised file's name and sha256, the original and revised suite hashes, each case
changed and a note. Of the receipt's own keys it carries only `receipt_hash`, and nothing in it is
sealed: an edit to the sidecar breaks no hash.

A completed generation keeps its retained-answer hash when its judge times out, so the answer can
be regraded. Timeout reasons are fixed text and contain none of the provider error's message.
A regrade writes no file at all when the receipt it built fails its schema or its hash does not verify.

## What v0.11 adds: a smoke run says so

Spec 139, the first run. `driftproof run --quick` is a smoke run, a first look: one test task
(the first in the suite, and no other), 2 draws per arm and 2 judge samples per answer, four calls
at once, run to see that the skill and that task run and to show the task's two answers side by side
(A-139-17). Each arm records `n_planned` 2 and stops with `max_reached` at its second draw. It
takes too few answers to give a verdict, and its receipt says so. A smoke run cannot produce a
verdict.

- **`run.preset`**: `"quick"` on a smoke run's receipt; absent on every other run. The one
  value is `"quick"`.
- **A receipt that names a preset is below `TESTED`.** The runner stamps it `UNVERIFIED`
  whatever answered it, and the schema refuses one that reads `TESTED` (the second control,
  as a stub run is held to `UNVERIFIED` since v0.6). Every reader of a verdict already
  refuses a receipt below `TESTED`: the badge reads *not measured*, `decide` reads the model
  `not measured`, a drift report computes no verdict, and the plain words say *Smoke run, no
  verdict*. A smoke run cannot produce a verdict.

## What v0.10 adds: the receipt says which answer was judged

Spec 137. On the two CLI surfaces the child is an agent with tools. Until v0.10 it ran with its
harness's default tools in a working directory removed after the call, and only its final message
reached the judge, so a child that wrote its answer to a file and said so was scored on what it
said. Both fields below are optional. `run.capture` is written by every run, and a regrade carries
it when the original records it. A draw's `captured_files` is written only in files capture.

- **`run.capture`** `{mode}`: `text` or `files`. `text`, the default: on a CLI surface the child
  ran with its file-writing tools off (claude: `--disallowedTools
  Bash,Edit,MultiEdit,NotebookEdit,Write,Task`; codex: `-s read-only`), and its reply is the
  judged answer. `files` (`--capture files`): the child could write files in its own fresh working
  directory (claude: `--permission-mode acceptEdits`, Bash and Task off; codex:
  `-s workspace-write`), and the regular files it left there, never a link, were collected and
  judged with its reply, each in a block naming its path and size. An api surface has no tools,
  and a run there in `files` is refused before any call. A regrade carries the original's mode.
- **`results.cases[].generation.draws[].captured_files`**: in `files`, each file the draw left, in
  byte order of path: `{path, bytes, included}`. A file is included whole when it is text of at
  most 65536 bytes, among the first 50, within 262144 bytes together; any other is named in the
  judged answer as not included, with the reason.

**A lost answer.** Before any judge call, the runner and `driftproof regrade` read each answer for
two things, by pattern and never by a model: a reply that points at a file the answer does not
include (it says it wrote, saved or created a file, and names its path), and, when no file is
included, a reply that only describes work it did. Either is an unmeasured draw with its reason,
never a score, so the lost-draw bound of spec 119 reads the case. `generation_hash` is taken over
the judged answer, which in `text` is the reply byte for byte.

**The band rung.** The reader that ships with v0.10 adds one rule to R-5 (*What v0.7 adds*):
where R-5 reads `NO_EFFECT` over two or more cases, the comparison band over those cases, each
arm's sample sd of the per-case means summed in quadrature (the band rule every receipt states),
must be under `F`. A band at or above it reads `UNDERPOWERED`, with no draw count. Where a case lost
draws, the band is widened by the most its arm's mean could move at any score of those draws. A
one-case receipt forms no band and reads as before.

**Cases or draws (spec 143).** The reader then says what makes the band wide, from the receipt's own
numbers. Per arm, the sample variance of the per-case means holds the cases sitting apart and each
case's mean moving from draw to draw; the second is expected to be the mean over the cases of
`s^2 / n` (a case's sample sd across its draws, squared, over its measured draws), and more draws
shrink it. Taken out of each arm (never below zero) and summed in quadrature, what is left is the
band no number of draws narrows. At or above `F`, the cases disagree, and the state reads **More
cases, not more draws, are needed to conclude at this effect floor**, its badge word *more cases
needed*. Under `F`, more draws are expected to narrow the band, and the state reads the plain line below. The split
is read only when every kept arm measured two or more draws, lost none and records its
`generation.sd`; otherwise the plain line stands. An arm with no recorded `generation.sd` has no
draw share on the receipt to take out, so a reader does not take one from its draws. The verdict is
`UNDERPOWERED` either way.

**The harness a run used.** `run.harness` `{name, version}` keeps its v0.9 shape, and v0.10 adds no
field for it. *What v0.9 adds* says no Driftproof run writes it; since spec 053 the runner does.
On `claude-cli` it is `claude-code`, on `openai-cli` `codex`, each with the version that
`claude --version` or `codex --version` printed, read through the run's own spawn plan as
generation begins, so it is the binary that answered. On an api surface it is `api` with a null version, and
a stub run writes none. A version that could not be read is null, and the run prints why. A
regrade carries the original's `run.harness`, because the answers it judges came from that
harness. `driftproof stale` compares the recorded name and version; a receipt that records none
reads its harness as unknown.

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
carries the plain line: **Not enough draws to conclude at this effect floor.** Where
the band rung reads the cases disagreeing (*What v0.10 adds*, cases or draws), it
carries the cases line in its place. The Action also publishes `draws_needed`. UNDERPOWERED is a statement about the instrument
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
  decides it, and at this revision that is **v0.15**.
- **A reader validates against the receipt's own `schema_version`**, never
  against the newest schema it happens to have. `validateReceipt()` selects the
  schema by that field, which is why a v0.1 receipt from the first report still
  validates today.
- **The producer emits the current version only. Older receipts remain
  readable.** A v0.4 receipt can no longer be produced, and `validateReceipt()`
  still validates one against the v0.4 schema. v0.4 moved from the
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

**Harness overhead.** Both arms use the same CLI harness configuration. Its
token contribution need not cancel across different tool trajectories.

## What the judge overhead counts (issue 317)

`economics.judge_overhead` says what grading cost. It is measurement overhead, excluded from every
value figure above.

- **`total_cost_usd`**: the cost, at the judge model's price in `run.pricing_snapshot`, of the judge
  usage recorded on every draw sent to the judge, each draw counted once. A draw is sent to the judge
  when it carries an answer the judge can grade (a `generation_hash`, `truncated` not `true`, and in
  files capture its `captured_files`) and it was scored, carries `judge_sample_hashes` or
  `judge_usage`, or records that its judge call timed out. A failed row's draws count as any other's.
  A row with no draws, v0.4 and earlier, is read from its own `judge_usage`, failed rows out. A draw
  a regrade could not grade is copied whole from the original, the original judge's usage with it,
  and is not counted. The figure is null when nothing was priced, never 0.
- **What a draw's usage holds.** A draw's `judge_usage` is the sum of the usage its answered judge
  samples reported, including answered parse retries. Transport retries without usage, samples that failed without a reply, and samples that reported no usage are
  not in it, though each was a call. Frozen API rates price that reported usage;
  subscription dollar figures are estimates, not a bill or a billing floor.
- **`case_rows_measured`**: the case rows that contributed judge usage to the total.
- **`judged_draws_counted`**: the judge usage records summed into the total, one per draw sent to the
  judge (one per row with no draws).
- **`judged_draws_missing_usage`**: the draws sent to the judge that carry no readable judge usage,
  and the rows with no draws and none. A usage is readable when it has an input or output token count
  and every count it has is a finite number of at least 0. These add nothing to the total, and no
  count is imputed. When the judge model has no price in the snapshot, nothing is counted, the total
  is null and `note` says so.
- **Rounding.** Each counted draw's cost is rounded to six decimal places, the rounded costs are
  summed in receipt order, and the sum is rounded to six places. A reader who sums unrounded costs
  can differ in the sixth place.

**Correction, 2026-10-14 (issue 317).** A receipt with draws written before this change counts one draw
per case row: its `judge_overhead` read only the row's `judge_usage`, a copy of one draw's, and it
records no `judged_draws_counted`. Its total over every draw re-derives from `draws[].judge_usage` at
its frozen judge price, by the rule above. Those receipts' bytes are hashed and are not changed; this
note is their correction. A receipt that records `judged_draws_counted` counts every draw.

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

### `schema_version` (string, required): `"0.15"`.

### `skill` (object, required)
| field | type | notes |
|---|---|---|
| `name` | string | From SKILL.md front-matter or its H1. **v0.15:** for a context file, the file's base name. |
| `version` | string | Skill's declared version. |
| `content_hash` | sha256 hex | Over `SKILL.md` + every bundled file (the `evals/` dir is **excluded** — hashed separately as `suite_hash`), path + content, path-sorted. **v0.15:** for a context file, the sha256 of the file's bytes. |
| `unit` | `"skill"` \| `"plugin"` \| `"context_file"` | **v0.9**, optional; **v0.15**, required, and `"context_file"` added. `"plugin"` when a plugin was measured whole (a `claude plugin eval` import). See *What v0.15 adds*. |
| `tokens` | integer | **v0.3.1, optional.** Estimated SKILL.md token size (coarse `chars/4` proxy) for the value-per-token axis. |

### `suite` (object, required)
| field | type | notes |
|---|---|---|
| `format` | string | Always `"agentskills.io/evals"`. |
| `suite_hash` | sha256 hex | Over the canonicalized normalized case list (`{id, prompt, rubric, pass_threshold}`, and `criteria` on a case that lists them; see *Criteria cases*). |
| `case_count` | integer | Cases in the suite (before any `--max-cases` cap). |

### `run` (object, required)
| field | type | notes |
|---|---|---|
| `model_id` | string | Canonical model id run on. |
| `model_release_date` | ISO date or `null` | Release date **if known**, else `null`. |
| `provider` | `"anthropic"` \| `"openai"` \| `"unknown"` | **v0.3.1.** The two-axis provider (registry `provider`, else inferred from the id). **v0.9:** `"unknown"` on an imported receipt whose source records no model. |
| `surface` | `"api"` \| `"claude-cli"` \| `"openai-api"` \| `"openai-cli"` | `api` = Anthropic Messages API; `claude-cli` = spawned `claude -p` (subscription); `openai-api` = Chat-Completions-compatible API (base_url configurable); `openai-cli` = Codex subscription (`codex exec`). |
| `delivery` | `"injected"` \| `"installed"` \| `"unknown"` | **v0.15**, required. The delivery the run was configured with. See *What v0.15 adds*. |
| `surface_overhead_note` | string | **v0.3.1, optional.** On `openai-cli`: the fixed Codex base-instruction preamble (~12–15k input tokens/call) the harness prepends and does not control. |
| `runner_version` | string | Runner version, for reproducibility. |
| `date_utc` | ISO 8601 UTC | As `lib/run.js` writes it: when the run's calls finished if the CLI stamps it, or the stamp a caller passes, which for a batch is one stamp shared by every receipt in the batch. For when generation began, read `generated_at` (v0.8). Before v0.8 this row said *when the run finished*, which was true of the CLI and not of a batch. **v0.9:** null only on an `external` receipt whose source records no date. |
| `registry` | `"registered"` \| `"unregistered"` | **v0.3.** Whether `model_id` resolved in the model registry (`config/models.json`). **v0.6:** `"unregistered"` is import-only; the runner refuses an unregistered id before any call (spec 026 AC-10). |
| `transcripts` | `"retained-local"` \| `"hashes-only"` | **v0.3.** Whether the raw generations + judge outputs were retained on disk (see § Transcripts). |
| `judge` | object | `{ samples, temperature, sampling, surface }`, see below. `samples` is optional from v0.8: absent means unknown. |
| `generated_at` | ISO 8601 UTC | **v0.8**, optional. When generation began, stamped before the first generation call. |
| `judged_at`, `grader_revision` | ISO 8601 UTC, object | **v0.8**, optional, together or not at all: a re-judge of frozen outputs, and the grading definition it applied. |
| `counts`, `arms` | object | **v0.8**, optional. See *What v0.8 adds*. |
| `harness`, `import` | object | **v0.9**, optional, imported receipts. See *What v0.9 adds*. `harness` is also written by every run on a CLI or api surface and carried by a regrade; see *What v0.10 adds*. |
| `capture` | object | **v0.10**, optional, written by every run and carried by a regrade when the original records it: `{mode}`, `text` or `files`, which answer was judged. See *What v0.10 adds*. |
| `timeout_ms` | integer | Optional (issue 489). Explicit uniform per-call setting, in milliseconds, from 1 through 2147478647. Applies to each generation and judge attempt in the original run. See *Explicit per-call timeout*. |
| `preset` | `"quick"` | **v0.11**, optional. A smoke run (`--quick`); such a receipt is below `TESTED`. See *What v0.11 adds*. |
| `regraded_from`, `regrade` | object | **v0.12**, optional, together and only with `judged_at`: a regrade's lineage and what it did, sealed inside the receipt's hash. See *What v0.12 adds*. |

**`run.judge`** records how grading was done: `samples` (judge calls per case),
`temperature` (a number when the surface lets us set it — the `api` surface pins
**0** — else `null`), `sampling` (`"api-temperature-0"` or `"surface-controlled"`),
and `surface`. Determinism where the surface allows: on `api` the judge is pinned
to temperature 0; on `claude-cli` sampling params are surface-controlled and the
receipt says so. **v0.12:** and `harness`, `isolation`, `endpoint`, `code_revision`,
`criteria_template_hash` and `reported_models`, the judge's setting (see *What v0.12 adds*).

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
  | `checks_regrade` | object | **v0.12, optional**, on a regrade's row whose original carried checks: whether the original's check results were carried to this row's answer, and why. See *What v0.12 adds*. |
  | `judge` | object | `{ model_id, rubric_hash }`: who graded and a hash binding the grade to the exact rubric + judge system prompt. A criteria case's hash also binds its criteria and their template (see *Criteria cases*). |
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
**FORMAL** *(reserved / unimplemented; the schema rejects it)*. **v0.11:** a smoke run's receipt
(`run.preset` present) is **UNVERIFIED**, and the schema refuses it at **TESTED**.

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
generations and judge outputs are written to `transcripts/<receipt_hash>/`, and
the receipt records `transcripts: "retained-local"`. Without the flag the receipt
records `transcripts: "hashes-only"` and only the hashes are kept.

**Every answer (spec 184).** `answers.json` in that directory holds every answer
the run was returned, in the form `regrade --answers` reads:
`{"format": "driftproof-answers/2", "receipt_hash", "model_id", "answers":
{"<sha256>": "<text>"}, "draws": [...]}`. `draws` has one row for each draw of
each case and mode, in receipt order: `id`, `mode`, `draw_index`, the receipt's
`generation_hash` and `status`, `answer_sha256` (the sha256 of the text kept,
null when no answer came back) and `judge_outputs` (the judge replies that came
back for that draw). An answer is kept when the judge gave no valid score, timed
out or failed, and when the draw was truncated or lost. A draw whose generation
timed out, or came back empty, has no answer, and none is made up for it. Draws
that returned the same text share one `answers` entry and stay separate rows. So
the draw-level hashes of earlier draws are checkable against `answers.json`.

**The per-case files.** One JSON per case and mode, listed in `index.json`, keeps
what earlier versions kept: the runner retains the last measured draw of each case
and mode only in these files, so the per-case top-level hashes (which are that
draw's) can be re-derived from them. Two case ids that make one file name get two
names, and no file in the directory is written over.

**An archive written before spec 184** has the per-case files and no
`answers.json`. `regrade --answers <dir>` reads it as what it holds, the last
measured draw of each case and mode; every other draw has no answer there, and the
regrade refuses each one by name.

**A rubric regrade (spec 184).** `driftproof regrade --rubric <evals.json>` grades
a receipt's saved answers again under a revised rubric, with the original's judge,
judge sample count and judge template, and no generation call. The revised suite may
differ from the original only in each case's `rubric` and `pass_threshold`, and, in a
case that lists criteria objects, its `criteria` (spec 185), read as written (a
threshold must be a number in [0, 1]; a revised criteria list is held to the checks a
run applies, and a case may not change shape between criteria objects and a rubric
alone); anything else is refused before any call. The
new receipt carries the revised `suite.suite_hash`, `run.grader_revision` with the
revised rubric hashes, `run.judged_at`, the original's archived arms and no
`run.generated_at`: it is a re-judge of answers generated earlier, not a run. Its
evidence is sealed inside its hash (receipt v0.12, see *What v0.12 adds*):
`run.regraded_from` names the original receipt, the runner version that made it and
its run date, the answers by their canonical sha256, the revised file by its sha256
and the original's judge block, and `run.regrade` the draws graded and carried, the
judge calls made and each case changed. Its `.regrade.json` is a readable copy that
names the receipt by its hash and adds `rubric_revision` (the revised file's name,
the original and revised suite hashes, and each case changed); *What v0.12 adds*
lists what it holds. Its summary names the original
receipt and its run date, and gives its own `date_utc` as the grading time, not a
run date. The original receipt is not written over.

**The judge's recorded setting.** A rubric regrade compares the original's
`run.judge` `{ model_id, surface, sampling, temperature, samples,
prompt_template_hash, harness, isolation, endpoint, code_revision,
criteria_template_hash, reported_models }` with its own, and refuses a judge whose
recorded setting differs. The model id is compared as recorded, aliases expanded and
no date stripped. The surface, and with it the sampling and temperature, comes from
the environment (`CLAUDE_PROVIDER`, `OPENAI_SURFACE`, `DRIFTPROOF_STUB`); the
harness is the judge surface's, its version read from the binary; the isolation is
the spawn path (`--trusted-skill` or the hop); the endpoint is the address the call
uses and the routing variables it is handed, by their sha256; the code revision is
the runner's; and `reported_models` are the dated ids the judge answered as (see
*What v0.12 adds*, which also lists what is not recorded and so not compared). Every
field but `reported_models` is compared before any call, and a difference is
refused, naming each field and the setting that matches it, such as
`CLAUDE_PROVIDER=api`; `reported_models` is compared as the judge answers, and a
difference stops the regrade with no receipt written. An original that records any
of these not at all is refused by name. Every judged draw of a criteria case must
also record this runner's `criteria_template_hash`. A judge regrade, without
`--rubric`, grades with another judge on purpose and compares none of them.

**What a regrade counts, and what it does not run.** A draw reaches the judge only
when it has an answer and that answer is not lost (see *A lost answer* under § What
v0.10 adds). The plan and its guards, `--max-calls` and `--max-usd`, project the
calls of those draws, and the sidecar's `draws` and `answers.graded` and the
receipt's `run.regrade.draws` count them; a lost draw kept with its
`generation_hash` is carried and never charged. The judge calls recorded, in the
sidecar's `calls` and the receipt's `run.regrade.judge_calls`, are the attempts the
judge made, a timed-out call's among them, so they equal the projection unless a
call was retried. The judge sample count is a whole number of 1 or more, in both
modes, or the regrade is refused before any call. `regradeReceipt` takes a call cap,
`DEV_MAX_CALLS` unless its caller names one, which must be a whole number of 1 or
more, and refuses a projection past it before any call; a budget hard-stop or a
substrate mismatch after calls were made says the calls made. A draw whose judge
call timed out records the runner's fixed words as its reason, never the error's
message. A
regrade, by judge or by rubric, runs no deterministic check: a check's definition
is in no hash the receipt records. A row carries the original's `checks` results
only when its answer is the one they were run on, and `checks_regrade` says whether
they were carried. `regradeReceipt` itself runs every check `planRegrade` runs,
holds the suites it is handed to the files they were read from, and refuses before
any call.

The transcript directory is **gitignored by default**: raw model text is never
committed. The default for trigger-initiated runs is `retained-local` (disk is
cheap, audits are not). To verify a retained receipt: re-hash each transcript file
and compare against the receipt's `generation_hash` / `judge_sample_hashes`.

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

## Imported comparison method (issue 13)

New imported receipts carry optional `run.import.comparison_method: matched-measured-cases/1`.
Its hash seals this marker with the source hash, samples, counts, exclusions and notices.
Both comparison arms use the same admitted case ids. A missing usable arm, an error override,
or conflicting recorded grading evidence excludes the case, while admitted samples stay
on record. Each excluded id appears once, with affected modes and an exact notice.
No matched case means null scores, delta and band, with `no_cases` and an explanation.
The marker establishes compatibility of reported evidence, not the same actual grader.
Receipts without the marker keep their recorded figures and their older calculation.

A legacy in-process importer called without `importedAt` records `run.import.imported_at: null`
when the source already supplies its run date. If the run date is absent, the importer records
the clock used for the fallback date. The CLI supplies its import clock. An unknown import time
never copies the source run date. Null import time is admitted only for a marked legacy
calculation. An unmarked import still requires its original timestamp field.

### Issue 490: repository capture and resumable runs

`run.capture.mode: "repository"` adds the starter manifest and hash, available
tools, generation limits, resource bounds, isolation policy, implementation
contract hash, runtime image digest and effective environment hash. It describes
the captured text subset. It does not assert that every repository byte was
judged, that tools were called, or that commands reported as passing did pass.

Each generation draw carries `delivery`, `collection` and
`repository_files`. Delivery retains validated tool events and observed counts.
Incomplete evidence has null totals. The file records preserve inclusion,
change, type, mode, byte count and included-content hash. The existing
generation hash binds the retained answer, including its character annotation.
When judging occurs, these are the exact answer bytes supplied.
Request and transcript hashes bind the observed request and stream.

`run.resume` records whether the run resumed, the count of finished draws loaded
from its checkpoint, and each segment's start, end and reason.
`run.execution` separates dispatch intents, confirmed launches and uncertain
attempts. `exact_launches` is null when any attempt remains uncertain.
`checkpoint_evidence_hash` seals the binding, draw evidence, attempt ledger and
segments. A stub labels its execution evidence simulated.

Checkpoint publication orders file fsync, rename and directory fsync. Responses,
large answers and retained final output use immutable hash-named artifacts.
The finalizing checkpoint contains the exact final receipt bytes. Recovery
publishes those same bytes and marks completion without calls. Preserve the
whole output directory for inspection and resume.

Repository regrade is refused. A comparison cannot treat different or invalid
repository contracts as an unchanged measurement. Verdict and UNDERPOWERED
rules remain unchanged. R-2 now uses Sonnet for both targets; crossed grading
is historical. Sonnet self-grading is disclosed.

### Repository diagnostic scope and attempt accounting (issue 490, 27 October 2026)

New repository receipts carry optional run.scope with kind, task_ids and
expected_arms. A diagnostic also carries draws_per_arm, requires quick and
UNVERIFIED, and has no comparison. Its summary distinguishes selected tasks
from the full suite count. Missing scheduled measurements remain incomplete.
Comparison scope retains both required comparison arms and any scheduled placebo.
Historical receipts without this field retain their existing reading.

run.accounting records basis subscription-accounting, attempts, reported_cost_usd,
unknown_cost_attempts, interrupted_attempts, tool_errors and stops. Each stop
names its attempt, phase, code and bounded redacted detail. Costs are the sum
of reported amounts; unknown amounts are counted separately, never assumed zero.
They are not API charges or subscription quota. Tool errors count observed error
results across attempted calls, including interrupted calls. Checkpoint attempts
retain the underlying values across resume. The receipt hash binds these fields.

Separate judge-control artifacts have kind judge-controls and are not comparative
receipts. They grade fixed authored answers, retain individual scores and reasons,
remain UNVERIFIED and count their calls separately from the smoke's 60 generations.

### Repository character annotation (issue 490, A-490-11)

Historical v1 repository receipts seal run.capture.answer_annotation with version
repository-codepoints/1 and contract_hash. Absence identifies the historical
unannotated contract. The original reply-plus-files remains an unchanged UTF-8
prefix. An appended ASCII inventory records its byte length and SHA-256, then
LF-based one-indexed lines, escaped renderings and scalar-column/codepoint pairs
for every non-ASCII character and ASCII control, including LF, CR, tab and DEL.
Literal backslashes are doubled; actual characters use backslash-u-braces.
The inventory hash is included in the complete judged answer. generation_hash,
answers archives, saved checkpoints and every judge request bind that complete
answer. rubric_hash and prompt_template_hash bind the annotation policy.
Missing or modified inventory refuses repository judging before dispatch.

The caps in lib/capture.js refuse oversized input or annotated answers without
truncation. Controls use the identical annotation and retain source_answer_sha256,
judged_answer, answer_sha256, annotation_sha256 and rubric_hash. These additions
never replace historical grades or alter text/files grading semantics. The shared
judge code revision advances, so provenance can distinguish the implementation.

### Character facts panel (issue 490, A-490-12)

repository-codepoints/2 retains the original UTF-8 prefix and full inventory.
It adds an ASCII panel of affected lines and positioned character identities,
with names for whitespace, zero-width characters and fullwidth digits. Characters
without a specific name in the pinned table keep their U+ identity and a generic
label. CR/LF remain in the inventory but do not fill the compact panel.

The panel and panel_sha256 are appended inside the exact judged answer. Both
rubric and criteria prompts put that same validated panel before MODEL RESPONSE
TO GRADE. The answer and checkpoint hashes bind its bytes; rubric and template
identities bind its version, rendering policy and character-name table hash.
Missing or modified panels refuse dispatch. Annotation limits still apply.

The current schema reads both v1 and v2 descriptors. Historical v1 receipts keep
their original meaning and hashes. New admission requires v2; old source-bound
checkpoints cannot resume under the new grader. Text/files grading is unchanged.
The shared judge code revision advances to identify the changed implementation.

## Repository judge relationship (issue 490)

New repository runs seal run.judge.relationship beside the requested and reported
judge identity. same_model compares canonical target and judge IDs;
comparison_scope is within-model; limitation is null for different IDs or
"The judge uses the same model as the target. Self-grading may favor its own
model's answers." for matching IDs. This describes configured identity, not
proof of model execution or unbiased judgment. Existing stub and UNVERIFIED
rules still apply. Validation refuses inconsistent relationship fields.
Historical receipts may omit the field and are not rewritten.

Maverick's A-490-14 ruling fixes Sonnet 5.5 as judge for both R-2 targets. The new
R-2 driver requires this disclosure. Its report compares baseline, with-file and
placebo within one target model, all graded by the same judge, and carries the
Sonnet self-grading limitation. It does not claim independent judges or rank
the target models against each other. Generic judge selection remains explicit.


### Execution-primary R-2 contract (issue 490)

The production library accepts an explicit, validated executionSuite option on
a repository run. The current 0.15 schema accepts its optional run.scoring
contract. Existing receipts without that marker retain their original meanings.
The active suite carries an execution_freeze marker. Its loader retains that
binding, and a run without the matching complete execution bundle refuses. The
smoke and full-run drivers select the bundle and require current live evidence.
Two reviewed execution smokes remain necessary to admit an R-2 batch. The old
text freeze remains available as evals-text-v1.json with its original hashes.

run.scoring names execution-primary-v1, the complete freeze root, component
hashes for prompts, rubrics, hidden tests, references and broken versions, and
the primary and judge-only case ids. Runtime and resource identities remain in
run.capture. Every completed generation exports a complete quiescent snapshot.
The checkpoint saves the raw generation before publishing the snapshot, then
runs the frozen hidden tests in a separate confined scope before the judge.

An executable draw seals snapshot_hash and execution: named test outcomes,
passed/total/pass_rate, hidden-test and test-name hashes, freeze and runtime
identities, scope, deadline, evidence kind and execution_hash. Its primary and
mean are the pass rate. samples contains one execution observation and stddev
is zero; execution_primary labels the unavailable generation/judge variance
ratio. Across-draw means and spread drive primary statistics and stopping.
Actual judge output hashes remain in judge_sample_hashes. Their count need not
equal the single primary observation. secondary separately records the real
judge samples, mean, spread, reason, status and matching output hashes. Case
secondary records counts and the mean/spread across measured secondary draws.

TypeScript has score_basis=judge-only, primary=null and no execution result.
Its existing judge score drives its own sampling. Its three rows remain in a
full 60-row receipt but stay outside the 19-case execution aggregate. All other
rows have score_basis=hidden-tests. Main aggregates and comparisons use only
those execution rows. No weighted blend is calculated.

Missing code/export scores zero with a reason. Test errors and timeouts are
labelled failures. Harness or confinement failures pause with retained local
attempt evidence. run.local_execution records those attempts separately from
subscription calls. Resume reuses saved phases; failed local phases may receive
a disclosed new local attempt, but completed failed tests are never rescued.

A malformed or timed-out secondary grade remains unmeasured without erasing
valid execution. run.secondary_complete is false and smoke admission refuses.
Missing required primary or judge-only evidence preserves INCOMPLETE; wide
primary intervals preserve UNDERPOWERED. Summaries and report data disclose
Sonnet self-grading, observed Unicode misreadings and the false positive on
contradictory tests. Secondary grades do not certify implementation correctness.
The strict JSON rule is unchanged. Legacy regrade refuses this new contract.
No historical grade is replaced. A receipt hash authenticates no execution.

For the full R-2 run only, the audit may continue with disclosed draw losses.
Primary or secondary unmeasured scores and incomplete delivery are grouped by
draw, with every audit reason retained. Scores and sealed INCOMPLETE status stay
unchanged. The controller reviews each loss before publication. A conflicting
reported model, runtime or sandbox failure, missing required test execution,
integrity failure or interrupted attempt still fails the job. Primary-unmeasured
draws above 1% of all generation draws also fail it; judge-only TypeScript and
secondary-only losses stay outside that numerator. Smoke audits remain strict.
Completed sample replies are retained without repair or replacement;
undispatched or interrupted samples may have no saved reply.

Resume normally requires identical measurement source and runner commit. The
pinned full-run orchestration exception admits only the listed historical
measurement commits with unchanged measurement source and inputs. It does not
admit measurement-source changes.

Issue 490 activation keeps aggregate exclusions scoped to their comparisons.
A failed diagnostic placebo appears in placebo.aggregates.excluded_cases. It
does not enter the baseline/with-file aggregate. The scheduled-scope failure
count still covers every arm and keeps the receipt INCOMPLETE.

### Judge parse retries (optional v0.15 fields, issue 500)

Future runs and regrades retry a judge sample once if its reply cannot be parsed.
The retry uses the same input, model and settings. A score of zero is valid and
does not trigger a retry. Empty replies, output-cap truncation and invalid scores
keep their existing unmeasured handling. Generation calls are unchanged.

Each job records `run.judge.parse_retries` and `parse_recoveries`. The second
counts retries that yielded a valid sample score; another failed sample can
still leave that draw unmeasured. Absent fields mean unrecorded. A regrade
counts only its own retries, even when it carries an old draw unchanged.

A draw's `judge_parse_retries` records each retried sample by `sample_index`.
Its `attempts` contains the first reply and the retry, each with `output_sha256`,
`usage`, endpoint `attempts` and `cost_usd`. A timeout without a reply has null
hash, usage and cost. Cost uses the receipt's frozen judge price and is a
list-price estimate, not a bill. Both answered attempts contribute to the
draw's judge usage and measurement overhead. These records and counts are
inside `receipt_hash`. Existing receipts and report 016 keep their bytes.
