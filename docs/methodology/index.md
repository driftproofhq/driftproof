# How Driftproof measures a skill

Canonical: <https://driftproofhq.com/methodology/>

We run a skill's own test tasks with the skill and without it, score every answer several times, and call a change only when it is clearly bigger than the usual spread of the scores.

The full contract is the [receipt specification](https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md). This page is its plain companion; the precise method, in the specification's own terms, is folded at the bottom.

## With and without the skill

For each task in a skill's own test set, Driftproof asks the model twice: once with the skill's instructions loaded, and once with the task alone. The model answers each way several times.

A fixed grader, another model, scores every answer several times. So each task gets a spread of scores, not one fragile number. What the skill adds is the average with the skill minus the average without it.

In short

- One task, asked two ways: with the skill and without it.
- Several answers each way, each scored several times.
- What the skill adds: the average with it minus the average without it.

## When we call a change

When two runs of the same skill are compared, a task counts as better or worse only when both of these hold.

First

### The spreads are apart

Each side's spread is its average plus or minus the usual variation of its scores. If the two spreads overlap, we do not call a change.

Second

### The gap is big enough

The averages must differ by at least 0.05. The grader scores on a coarse grid of about 0.05 to 0.1, so 0.05 is about one step of it. A smaller gap is not called, even when the spreads are apart.

When a change is not called, a report says which of two things it saw. If the scores were so spread out that a gap of 0.05 could not show, or a side had only one answer, there were too few answers to tell. Otherwise the spreads overlapped or the gap was too small, and there was no clear difference. Neither means that nothing changed. A clear difference is what these tests saw, not proof that the skill itself changed.

## Extra checks, and what a skill costs

### Simple checks beside the grader

A task may also carry plain checks on the answer that simply pass or fail, with no model judging: for example, that a commit message starts with the expected kind of first line.

They sit beside the grader's scores as extra evidence. They never decide whether we call a change.

### What the skill adds per 1,000 tokens

A skill is not free: its instructions are sent with every answer. Adding 0.10 with 400 tokens of instructions is a different deal from adding 0.10 with 6,000.

So Driftproof gives what the skill adds both as it is and per 1,000 tokens of the skill. The token count is a rough estimate: the length in characters divided by four.

## Other models, and one grader for all

The same tasks and the same grader run for every model we test; only the model answering changes. Every receipt records which model answered, and through which service. Claude Code can make a call of its own on another model; the receipt records that call and its tokens beside the answer, and a run stops when another model gave the answer ([the receipt specification](https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md#auxiliary-calls-on-claude-cli)).

Because one grader from one model family scores every answer, a report comparing model families leads with what the skill adds to each model. That reduces a grader's taste for its own family's writing, but does not remove it, and no report has measured how much is left. Raw scores across families are background, never a ranking. The [neutrality page](https://driftproofhq.com/neutrality/) has the full policy.

## Receipts are an open format

A receipt is the file behind every published number. Its format is public and any tool may write one; Driftproof also converts results from neighbouring test tools (see [interop](https://driftproofhq.com/interop/)).

A receipt records what produced its numbers: the model, the tools, the skill and the tasks by their content, and the grader with its instructions. The `stale` command compares those with what would run today and says what has moved. With `--keep-transcripts` a run keeps every answer it was returned, each with the grader's replies to it. Those answers can be graded again under a revised rubric, or a task's revised criteria, by the same grader and with no new answer drawn, and that regrade writes a receipt of its own that names the original ([the receipt specification](https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md#transcripts-v03)).

The method in one sentence

Score every answer several times, call a change only when it is clearly bigger than the spread and big enough to matter, keep simple checks on the side, count the cost in tokens, and hold everything fixed except the model.

## The precise method

The folded sections are the method as the receipt specification states it, in the terms reports and receipts use. They say what the sections above say, precisely.

**The precise method, in the receipt specification's own terms**

### The core: with vs without, sampled, banded

For each eval case, Driftproof runs the model **with** the skill (SKILL.md supplied) and **without** it (bare baseline). Each response is graded by the fixed judge **several times** (n = 5), so a case carries a *mean ± stddev* band, not one fragile number. The skill's **lift (delta)** is the with-skill mean minus the baseline mean.

### The drift verdict rule (anti-false-positive)

Diffing two receipts yields a per-case verdict. A case counts as **regressed** or **improved** only when **both** conditions hold:

- **Band separation.** The two `with_skill` bands do *not* overlap. A band is a descriptive spread: the mean plus or minus one sample standard deviation of the case's scores, with no coverage probability.

## Where a band comes from

Each arm is generated at least three times, and more until the across-draw spread settles. Each generation is scored by the fixed judge. A band is the mean and the spread of the per-case score across those draws. Every report published before Report 007 used a single generation per arm, judged several times, so its bands measured the judge and not the model. Report 006's probe measured generation noise at 3.2× and 7.5× the judge noise on the two cases it probed, ten draws each. Report 007 re-measured Report 005's cells under the corrected instrument. Every table since Report 007 labels each band's source as legacy or generation.

**Effect floor.** The mean also moves by at least **0.05**, about one judge quantization step. A separated but tiny move is not called a regression or an improvement, and the per-case table labels it *below effect floor*. The comparison's summary line counts those cases apart from the cases with no separation detected, under the same label. Where bands touch or overlap, or a move is below the floor, the report says *no separation detected at this sample size*: never drift, and never that nothing changed. A separation is a separation detected under this rule, not proof that the skill moved. A tool that cries wolf on judge noise is worse than useless, so band separation **plus** a real-sized delta, not either alone, is what triggers a verdict. The judge is deliberately fixed and cheap; see the [judge policy](https://driftproofhq.com/judge-policy/).

**Not enough draws.** A case the rule does not separate is also asked whether it could have been separated. Its resolution is the two arms' spreads added together, plus two standard errors of the difference between their means; when that reaches the 0.05 floor, or when an arm has a single draw, the case is *underpowered*, and a receipt with no separated case and an underpowered one reads `UNDERPOWERED`, in words: *Not enough draws to conclude at this effect floor*. The badge, the Action and the comparison report print the draws per arm that would have been needed with the spreads held, or say that no draw count reaches the floor when the spreads alone do, because more draws narrow the standard error and not the spread. The single-receipt badge reads passing or regressed only when a case separated under the rule. The rule is R-1 to R-6 of the receipt specification.

**A wide band over several cases.** A receipt in which two or more cases read no separation, and none is underpowered on its own, is asked the same question once more, over the receipt as a whole. Its comparison band, each arm's spread of its per-case means added in quadrature, must be under the 0.05 floor. When it reaches the floor the receipt reads `UNDERPOWERED`, with no draw count, and says what makes the band wide. Each case's mean moves a little from draw to draw, and more draws shrink that part; how far the cases sit apart, no number of draws changes. With the draw-to-draw part taken out of each arm, a band still at or above the floor is the cases disagreeing, and the receipt says *More cases, not more draws, are needed to conclude at this effect floor*. A band under it is draw spread, which more draws are expected to narrow, and the receipt says *Not enough draws to conclude at this effect floor*. Where a case lost draws, its band is widened by the most its mean could move at any score those draws could have had, and the receipt says not enough draws. It says the same where an arm measured one draw, or records no spread across its draws (`generation.sd`): the draw-to-draw part cannot be read from it. A one-case receipt forms no such band and reads as before. The reader applies this rule to every receipt it reads, whatever its schema version.

**Lost draws in a diff.** A draw the runner could not measure, such as one that timed out, is recorded on the receipt as unmeasured and left out of its arm's mean and spread. So when two receipts are diffed, a case that separated on its measured draws counts as regressed or improved only when it separates at every score either side's lost draws could have had, from the worst score of the judge's scale to the best. When it does not, the diff reads the case *inconclusive*. Each case that lost draws is named, with each side's lost and drawn counts and the reasons the receipt records, and the per-case table then gives every case's measured and drawn counts.

**Which answer is graded.** On the two command-line surfaces the model answers as an agent with tools. From receipt v0.10 on, the receipt says which answer the grader saw, in `run.capture`. By default, `text`, the agent has no tool that writes a file or runs code, and its reply is the graded answer. On Claude Code it keeps only the tools that read, `Read`, `WebFetch` and `WebSearch`, named in an allow list, so every other tool is off, PowerShell and REPL included, and so is any tool a later version adds; no MCP server is loaded. On Codex the sandbox is read-only and every feature its own feature list names that writes a file or runs code is turned off, the shell among them, with no MCP server. With `--capture files` it may write files in a fresh working directory of its own, with the file tools `Write`, `Edit` and `NotebookEdit` added on Claude Code and still no tool that runs code; on Codex the sandbox lets it write in that directory, with its features as they are. Every file it leaves there is named in the graded answer with its path and size, and so is a directory there that cannot be read, with its reason; the first 50 files are read: each is graded with its reply when it is UTF-8 text of at most 65536 bytes, up to 262144 bytes together. Any other file is named with its reason: past the 50-file cap, truncated (its size and the cap), unreadable (permission denied, or a read error), binary, not valid UTF-8, changed while it was read, or past the total cap. Each draw lists them in `captured_files`. A model that writes its answer to a file and replies with nothing is graded on the file. When it replies with nothing and no file it left can be shown, the draw is lost, its files are still listed, and its reason names them with theirs. When the directory could not be read back, the draw is lost, and a regrade keeps it lost. Before any grading call, a reply that points at a file the answer does not include, or that only describes work it did, is a lost draw with its reason and is never given a score. A draw is lost only when it truly points at a file the grader was not shown, or holds no answer. So a line inside a fenced block is never read as the model pointing at a file; a commit body or pull request description that lists the files it changed is graded; a pointing line followed by a fenced block, or by at least 200 characters of the reply's own prose, shows its file, so a summary written to a file and then given in prose is graded on the prose, and prose on the pointing line itself counts; a pointing line below the reply's own answer shows its file too: at least 200 characters of prose above it, a fenced block above it that the line refers back to ("I saved this to ..."), a Changes list under the answer, or the body of a commit message; a code name such as `cart.total` is not a file name; first-person advice such as "I'd add an index" is an answer, not a report of work. A typographic apostrophe or quote mark reads as a plain one, and a file name in bold or other emphasis, or after a bold label such as **Created:**, reads as a file name. On these two surfaces the runner also records the harness in `run.harness`: its name and the version its own binary printed when the run began, never a typed value. A regrade keeps the original's mode and harness, because the answers it grades came from that harness, so `driftproof stale` still reads the version the answers were made with.

**A smoke run gives no verdict.** `driftproof run --quick` checks that a skill and its test tasks run, with 2 judge samples, concurrency 4 and at most 5 cases. That is too few answers and too few test tasks to give a verdict, and the receipt says so. From receipt v0.11 on, a quick run records `run.preset` as `quick` and reads `UNVERIFIED` whatever answered it, and the schema refuses a receipt that names a preset and reads `TESTED`. Every reader of a verdict refuses a receipt below `TESTED`, so the badge, the Action's decision and the comparison report give a smoke receipt none. The comparison report counts a receipt that names a preset as below `TESTED` whatever level it carries, so a smoke receipt restamped `TESTED` and sealed again is refused as an honest one is, and the report names that side as a smoke run. The Action's decision writes its lift as n/a in its summary and in its workflow output, and the badge writes it as n/a in its workflow output. The comparison report, the badge's JSON and the exported summary keep the lift, with its plus or minus sign, as context, as they do for every receipt below `TESTED`. The plain words and the results page label it *Smoke run, no verdict*: a smoke run cannot produce a verdict, and a run without `--quick` can.

A comparison report's headline says *no separation detected* when no case separated under the rule, and names the direction of each separation it detected. A comparison report names the band source of each receipt beside its bands, legacy or generation, and its legend describes only the sources that appear on the page. It prints the sentence that the two receipts' bands come from different sources, and that a per-case comparison across them is not like for like, only when the two sources differ. Two receipts whose bands share a source are compared without that sentence.

### Deterministic post-checks (supplementary column)

A suite case may declare optional `checks[]` - structural or regex assertions on the model output that simply hold or don't, with no LLM judgment (e.g. "the output contains a Conventional-Commits subject line", "the output mentions the 429 status the task described"). These run **alongside** the judge and are reported as a **separate column**.

**Post-checks are supplementary evidence only.** They are *not* folded into the case outcome or the band-overlap verdict - they corroborate or contradict the judge with a cheap, unambiguous signal, they do not replace it. Authors add them where they are natural and in-text-groundable; they are never required, and a suite without them is unaffected. Each result is recorded in the receipt as `{ name, kind, pass }` (spec v0.3.1).

A case may also list weighted criteria in place of a free-text rubric. The grader then decides each criterion, met or not met, and the weighted total and the pass are computed in code, never taken from the grader; a reply that does not decide every criterion is not measured ([the receipt specification](https://github.com/driftproofhq/driftproof/blob/main/spec/RECEIPT.md#criteria-cases)). That pass is per sample: the case outcome still comes from the mean and spread of its scores against the threshold, as for every case, so a mean exactly at the threshold reads borderline. This fixes the arithmetic, not the grader's reading of an answer. Each criterion's id, weight and description enter the case's rubric hash in the receipt, with the criteria template, so an edit to any of them moves that hash.

### The value-per-token axis

A skill is not free: its SKILL.md is prepended to every generation. A +0.10 lift for 400 skill tokens is a very different proposition from +0.10 for 6,000. So Driftproof reports each skill's lift **both raw and normalized per 1,000 skill tokens**: `delta ÷ (skill_tokens ÷ 1000)`.

**Method.** `skill_tokens` is a coarse `ceil(chars ÷ 4)` estimate of the SKILL.md size - the standard rough proxy for English text, *not* a model tokenizer (no `tiktoken` dependency). It is a consistent yardstick for comparing skills to one another, not a billing figure, and it is recorded in the receipt (`skill.tokens`, spec v0.3.1). Value-per-token surfaces the skills that earn their context budget.

### Providers, surfaces, and neutrality

Driftproof's provider layer is **two-axis**: provider (anthropic / openai) × surface (api / cli), i.e. four concrete lanes. The same suites and the same fixed judge run across providers; only the target model varies. Every receipt records the `provider` and `surface` it ran on, the API surface is preferred for published runs, and a subscription CLI surface is disclosed whenever used.

Because one Claude-family judge grades every provider's output, a cross-provider report leads with the with/without **delta** - which reduces judge style-affinity but does not remove it - and treats absolute cross-provider scores as context, never a ranking. Report #002 additionally holds the surface *type* constant: both substrates run on the vendor's own first-party subscription CLI (`claude -p` and `codex exec`), with each surface's harness overhead disclosed (Codex prepends a fixed ~12–15k-token preamble; `claude -p` a smaller first-party context). The full policy is on the [neutrality page](https://driftproofhq.com/neutrality/).

### Related work

[Skill Drift Is Contract Violation](https://arxiv.org/abs/2605.10990) (Fan et al., arXiv:2605.10990) treats skill decay as a violation of environment contracts - external services and APIs moving under a skill - and repairs against them; that environmental axis is complementary to the substrate axis measured here (the model itself moving under a skill). The verification levels our receipts carry (`UNVERIFIED` / `DECLARED` / `TESTED` / `FORMAL`) follow the lattice introduced in [Skills as Verifiable Artifacts](https://arxiv.org/abs/2605.00424) (Metere, arXiv:2605.00424), whose companion, [Methods for Formal Verification of Agent Skills](https://arxiv.org/abs/2605.23951) (arXiv:2605.23951), works toward the `FORMAL` level our schema still marks reserved.

### Receipts are an open format

The receipt is not proprietary: the JSON Schema is served at its canonical id ([`/spec/receipt.schema.json`](https://driftproofhq.com/spec/receipt.schema.json)), and a receipt validates against the schema its own `schema_version` names. Driftproof writes receipts at the current schema version only, and a receipt at an older version stays readable, checked against its own; any harness is encouraged to emit receipts, and working converters import results from neighboring eval tools - with the **DECLARED vs TESTED** distinction enforced structurally (imported declarations are recorded faithfully but never earn drift verdicts). The schema, the import mappings, and the minimal `summary-json` interchange are on the [interop page](https://driftproofhq.com/interop/). A receipt at the current schema says what its counts count: generations per arm and judge samples per generation are separate fields, written only at the scope the data establishes, and an imported receipt carries neither unless its source format defines one. Where a count is not established the differ and the export say it is unknown; they do not read it as a single sample. An imported receipt at the current schema also names what produced it: the harness and its version, the document it was converted from with that document's sha256, and each thing the source did not record, which stays unknown rather than taking a default. Where the source ran a skill-fired indicator, as `claude plugin eval` does, the receipt records how often the skill fired beside the score and never inside it, and runs the source recorded an error for are kept out of the figures and listed with the error.

A receipt also records what produced its numbers, as far as its schema version allows: the model, the harness, the capture mode, the skill's and the suite's content hashes, the judge, the judge's prompt template and each case's rubric hash. `driftproof stale` compares those with what would run today and says, for each arm, whether the result still stands, needs the arm run again, or needs only its saved answers graded again. A change to the skill leaves the baseline arm standing, since that arm contains no skill text. A new major or minor version of the harness means running again; a patch release of the same harness is reported as an advisory. A different capture mode also means running again, because a different answer would be graded. For scale, from our own runs: [Report 009](https://driftproofhq.com/reports/009/) ran on Claude Code 2.1.272 on 15 September, and on 23 September [Report 011](https://driftproofhq.com/reports/011/) needed 2.1.280 or newer. Anything a receipt does not record is reported as unknown, never as current.

Sample the judge, band the scores, require separation *and* a real-sized effect, add cheap deterministic checks on the side, normalize lift by the tokens it costs, and hold everything constant except the model. That is the method.
