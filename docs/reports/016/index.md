# Popular rules files vs. a placebo: most made Claude write more

Canonical: <https://driftproofhq.com/reports/016/>

Report 016 · 7 rules files · 2 models · 2,646 coding runs · outcomes chosen 27 Oct, before any score was read

## What did Report 016 find?

- **What we tested.** These small tasks test injected instructions on two Claude models, not harder work or native project loading.
- **What we found.** On Haiku, six made it write more than the fakes did; Sonnet was mixed. None made code clearly longer.
- **What it does not show.** We counted what changed, not whether the extra writing helped.

Report 016: Rules-file behaviour, claude-haiku-5-5, claude-sonnet-5-5

Type Rules-file behaviour report

What moved Popular rules files vs. a placebo: most made Claude write more

Models `claude-haiku-5-5` `claude-sonnet-5-5`

Headline We gave Claude seven popular rules files and same-length fakes.

Receipts [14 linked receipts](https://driftproofhq.com/reports/016/#receipts)

**Cite this**

```
@techreport{driftproof-016,
  title  = {Popular rules files vs. a placebo: most made Claude write more},
  author = {Driftproof},
  year   = {2026},
  type   = {Rules-file behaviour report},
  note   = {claude-haiku-5-5, claude-sonnet-5-5},
  url    = {https://driftproofhq.com/reports/016/}
}
```

We gave Claude seven popular rules files and same-length fakes. On Haiku, six made it write more than the fakes did; Sonnet was mixed. None made code clearly longer.

Driftproof · 2026-10-28

Rules-file behaviour report

These small tasks test injected instructions on two Claude models, not harder work or native project loading.

[See what changed ↓](https://driftproofhq.com/reports/016/#rules)

The fileIts fake**352** bytes

```
## Approach
- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.
```

became

```
The morning light settled slowly over the hills beyond the old market town. The ferry crosses the sound twice a day when the weather is calm enough. On clear nights the stars over the moor are bright enough to cast faint shadows. The museum displays a loom that weavers in the district used for linen and wool.

Fishing boats leave before dawn and retu
```

```

```

File

Fake

The shortest of the files, drona23/claude-token-efficient (352 bytes), becoming its fake: same length to the byte, about hills, a ferry and fishing boats, with nothing about code.

## A rules file is a note an AI coding assistant reads before it starts work.

We picked the seven most-starred files the rule picked: four CLAUDE.md, and the only three AGENTS.md files in the search that met the rule.

- **222,760**andrej-karpathy-skillsCLAUDE.md
- **174,414**ponytailAGENTS.md
- **23,078**vibe-coding-cnCLAUDE.md
- **21,200**learn-harness-engineering CLAUDECLAUDE.md
- **21,200**learn-harness-engineering AGENTSAGENTS.md
- **6,110**claude-token-efficientCLAUDE.md
- **2,306**fable-methodAGENTS.md

Repository stars on 2026-10-23. The Karpathy-named file was not written by Andrej Karpathy. This was a capped search, not a census of GitHub.

## Then we ran Claude 2,646 times.

Claude Haiku 5.5 and Sonnet 5.5 each did 20 small coding tasks three ways: with nothing, with the file, with its fake. [Hidden tests](https://driftproofhq.com/invisible-space/) checked the code. 2,646 real Claude Code runs in all.

**Nothing**

No added file

**The file**

Injected instructions

```
## Approach
- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.
```

**Its fake**

Irrelevant prose, equal bytes

The morning light settled slowly over the hills beyond the old market town. The ferry crosses the sound twice a day when the weather is calm enough. On clear nights the stars over the moor are bright enough to cast faint shadows. The museum displays a loom that weavers in the district used for linen and wool. Fishing boats leave before dawn and retu

## First surprise: the code was already right.

Both models passed nearly every hidden test, with or without a file. In 246 of 266 task-and-job pairs, every measured run in every arm was perfect. A file can’t fix code that isn’t broken.

**246**of 266 tested task-and-job pairs

Solid squares: perfect in every measured run in every arm. Hollow squares: something slipped. All task-level pass rates and lost draws remain in appendix A.

3 exceptions, each one task with few runs: ponytail helped Sonnet on utc-day-python; two Haiku cells separated only because the fake’s runs all failed. Appendix A retains the reader’s refusals and exact cases.

## On Haiku, 6 of 7 files made Claude write more.

Between 13% and 40% more than with the fake file. Only ponytail, which asks for the least new code, didn’t clearly change it.

The fake / The file. Mean output tokens per task.

andrej-karpathy-skills+13%

vibe-coding-cn+29%

learn-harness-engineering CLAUDE+20%

claude-token-efficient+20%

ponytailCan’t tell (-5%)

learn-harness-engineering AGENTS+24%

fable-method+40%

09,000

“Write” means recorded output tokens across the session, including code saved to files. Each bar compares the file with its same-length fake, with a 95% interval. The recorded usage fields do not establish whether output tokens include thinking tokens.

## On Sonnet, it went both ways.

3 files made Sonnet write more, 2 made it write less, and 2 showed no clear change.

The fake / The file. Mean output tokens per task.

andrej-karpathy-skills-6%

vibe-coding-cn+32%

learn-harness-engineering CLAUDECan’t tell (+7%)

claude-token-efficient+11%

ponytail-24%

learn-harness-engineering AGENTSCan’t tell (+2%)

fable-method+14%

03,000

“Write” means recorded output tokens across the session, including code saved to files. Each bar compares the file with its same-length fake, with a 95% interval. The recorded usage fields do not establish whether output tokens include thinking tokens.

## The two files that ask for less code got it.

No file made the code clearly longer. The two that cut it on both models are the two that ask for it: ponytail and the Karpathy-named file. A pattern, not proof.

**andrej-karpathy-skills**
Haiku
22.8 → 20.5 lines

**ponytail**
Haiku
22.8 → 17.1 lines

**andrej-karpathy-skills**
Sonnet
24.4 → 20.4 lines

**ponytail**
Sonnet
22.2 → 14.8 lines

Mean lines in the solution file, fake vs file. Shapes are drawn; counts are measured. The Karpathy-named file on Sonnet is shorter than with the fake, but not clearly shorter than with no file.

## Same file, different model, opposite result.

The Karpathy-named file made Haiku write more and Sonnet less. A rules file doesn’t have one effect. It has one per model, so test it on yours.

**+13%**Haiku669.6 output tokens; interval 315.3 to 1,046.4

**-6%**Sonnet-134.8 output tokens; interval -254.0 to -27.0

Named after Andrej Karpathy; he didn’t write it. Sonnet’s drop is clear against the fake, not against no file.

## Two templates sent Claude hunting for files that weren’t there.

They tell Claude to start each session by reading a progress log and running a setup script. Our test project had neither. Claude went looking in 252 of 263 runs.

*Recorded setup lookups, counted once per run*

```
pwd && ls -la /workspace && ls -la /workspace/src 2>/dev/null; cat /workspace/claude-progress.md 2>/dev/null; cat /workspace/feature_list.json 2>/dev/null; cat /workspace/init.sh 2>/dev/null
```

**252 of 263**went looking

No lookup was observed with the other files. 2 file-arm runs have incomplete tool evidence. We can’t say how much of the extra writing this explains. Copying a template copies its assumptions.

## What this doesn’t show

- **Harder work.** These 20 tasks were small, and the code was already right.
- **Your setup.** Each file was added to Claude’s instructions, not loaded from a project folder.
- **Other models.** Only Claude Haiku 5.5 and Sonnet 5.5. No Opus.
- **Whether it was worth it.** We counted what changed, not whether the extra writing helped.

## What each file asks for, and what changed

Each file’s own words beside what changed against its fake. “Can’t tell” means the 95% interval includes zero, not “no effect”.

**What each file asks for, and what changed**Against its same-length fake. “Can’t tell” means the interval includes zero.

| File | Its own words | Haiku output | Haiku code | Sonnet output | Sonnet code |
| --- | --- | --- | --- | --- | --- |
| **andrej-karpathy-skills**CLAUDE.md | “Minimum code that solves the problem. Nothing speculative.” | 13% more | fewer | 6% fewer | fewer |
| **vibe-coding-cn**CLAUDE.md | 启用「ultrathink」深度思考 “Enable ‘ultrathink’ deep thinking” (machine-translated) | 29% more | Can't tell | 32% more | Can't tell |
| **learn-harness-engineering CLAUDE**CLAUDE.md | “Prioritize reliable completion, continuity across sessions, and explicit verification over speed.” | 20% more | Can't tell | Can't tell | fewer |
| **claude-token-efficient**CLAUDE.md | “Thorough in reasoning, concise in output.” | 20% more | Can't tell | 11% more | Can't tell |
| **ponytail**AGENTS.md | “You solve the whole problem with the least new code.” | Can't tell | fewer | 24% fewer | fewer |
| **learn-harness-engineering AGENTS**AGENTS.md | “The goal is not to maximize raw code output.” | 24% more | Can't tell | Can't tell | fewer |
| **fable-method**AGENTS.md | “the quality lives in the structure, the evidence, and the honesty” | 40% more | Can't tell | 14% more | Can't tell |

Output means recorded output tokens; code means nonblank, noncomment solution lines. Two-sided paired task bootstrap intervals. The same analysis builds this page and its share images.

**Both templates.** The progress log and setup script they expect were absent.

**Karpathy-named file.** Its Haiku correctness receipt is incomplete; the behaviour analysis uses only eligible measured tasks.

**vibe-coding-cn.** The quote above keeps the original Chinese and a literal machine translation.

**Tests and asking.** No clear change in assertion-bearing test files was detected. Asking is unavailable where no solution exists because the evidence bundle has no hash-verified final reply. Missing solutions are reported separately.

## Want your rules file tested?

Open an [issue](https://github.com/driftproofhq/driftproof/issues/new) or a [discussion](https://github.com/driftproofhq/driftproof/discussions) with a public CLAUDE.md or AGENTS.md. We pick which files to run and can’t run them all. Every file we run gets published with its receipt.

## Check it yourself

Each of the 14 jobs has a JSON receipt sealed by its own SHA-256. The files are pinned by commit and hash, and each fake can be rebuilt from its seed. Seals check consistency; they do not authenticate the origin.

[Download the offline analysis script](https://github.com/driftproofhq/driftproof/blob/v0.24.0/scripts/analyze-report-016.js) · [Evidence manifest](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/manifest.json?raw=1) · [Hash-bound workspace snapshots](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/snapshots.jsonl) · [Download the table image](https://driftproofhq.com/reports/016/table.png)

```
node scripts/analyze-report-016.js --out analysis.json
```

Run from the [Driftproof 0.24.0 source checkout](https://github.com/driftproofhq/driftproof/tree/v0.24.0). This reads the published receipts and snapshots without model calls. These runs used unreleased source. Appendix E lists each runner commit. The sandboxed hidden-test setup needs an operator setup.

**How we ran it**

File, no-file and placebo arms share the frozen tasks, starter workspace, runtime image and sampling rules within each job. Instructions were injected into Claude Code. The placebo matches bytes, not input tokens or meaning. TypeScript is judge-only and excluded from the correctness ceiling; eligible TypeScript draws remain in behaviour summaries.

Behaviour uses equal task weights after averaging eligible draws within each arm. A task must have observations in all arms for that metric. Missing values stay missing. Paired task differences use 4000 bootstrap samples with fixed seed 501. Percentage intervals divide by the comparator’s fixed task mean. Zero-touching intervals mean no clear change. These are exploratory comparisons without multiple-comparison adjustment.

Lines exclude blank lines and language comments in the required solution file. Tests require a new or changed test file containing an assertion, compared by hash with the starter. Asking requires a question in the final reply and no solution; absence alone is not asking.

[Outcomes note: outcomes chosen 27 Oct, before any score was read](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/outcomes-note.md)

```
SHA-256 9ea1330142b80a69650c38e541fff304633baefcc071a1fb9638de0ba226e2d5
```

Selection used the fixed popularity rule and a capped API search. Only three AGENTS.md files met it. Maverick approved these seven on 23 Oct. The surviving notes reconstruct the query and disclose incomplete or truncated tree reads; this is not an exhaustive GitHub ranking.

[Selection notes and search limits](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/selection-notes.md)

**Prior work**

Others have tested context files. [Gloaguen et al., Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) found that they do not generally improve task success and raise inference cost by over 20%. [Khatri’s context-injection study](https://arxiv.org/abs/2607.27250) found no measurable correctness change across 288 runs on 17 real tasks. This report adds a same-length placebo, popular third-party files people copy, and behaviour outcomes chosen before scoring.

Both abstracts were checked against their source for this build. Author responses can be added as dated amendments after outreach.

**Appendix A: correctness, every task and every reader result**

| File | Model | Task | Nothing: pass rate / measured / lost | File: pass rate / measured / lost | Fake: pass rate / measured / lost | Perfect in all measured arms |
| --- | --- | --- | --- | --- | --- | --- |
| claude-1 | Haiku | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | utc-day-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Haiku | binary-search-js | 80.0% / 10 / 0 | 50.0% / 4 / 0 | 50.0% / 6 / 0 | no |
| claude-1 | Haiku | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | utc-day-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Haiku | binary-search-js | 0.0% / 3 / 0 | 50.0% / 4 / 0 | 50.0% / 4 / 0 | no |
| claude-2 | Haiku | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | retry-js | 100.0% / 3 / 0 | 95.8% / 6 / 0 | 100.0% / 3 / 0 | no |
| claude-3 | Haiku | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | sql-parameters-python | 100.0% / 3 / 0 | 90.0% / 10 / 0 | 100.0% / 3 / 0 | no |
| claude-3 | Haiku | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | utc-day-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Haiku | binary-search-js | 70.0% / 10 / 0 | 90.0% / 10 / 0 | 0.0% / 3 / 0 | no |
| claude-3 | Haiku | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | retry-js | 95.8% / 6 / 0 | 87.5% / 4 / 0 | 87.5% / 4 / 0 | no |
| claude-4 | Haiku | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | utc-day-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Haiku | binary-search-js | 50.0% / 4 / 0 | 50.0% / 4 / 0 | 0.0% / 3 / 0 | no |
| claude-4 | Haiku | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | retry-js | 95.8% / 6 / 0 | 100.0% / 3 / 0 | 87.5% / 6 / 0 | no |
| agents-1 | Haiku | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | utc-day-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Haiku | binary-search-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 0.0% / 3 / 0 | no |
| agents-1 | Haiku | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 91.7% / 6 / 0 | no |
| agents-2 | Haiku | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | utc-day-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Haiku | binary-search-js | 55.6% / 9 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | no |
| agents-2 | Haiku | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 91.7% / 6 / 0 | no |
| agents-3 | Haiku | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | utc-day-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Haiku | binary-search-js | 50.0% / 4 / 0 | 100.0% / 3 / 0 | 50.0% / 4 / 0 | no |
| agents-3 | Haiku | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | utc-day-python | 75.0% / 3 / 0 | 75.0% / 3 / 0 | 75.0% / 3 / 0 | no |
| claude-1 | Sonnet | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | binary-search-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-1 | Sonnet | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | utc-day-python | 75.0% / 3 / 0 | 87.5% / 4 / 0 | 87.5% / 4 / 0 | no |
| claude-2 | Sonnet | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | binary-search-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-2 | Sonnet | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | utc-day-python | 75.0% / 3 / 0 | 75.0% / 3 / 0 | 75.0% / 3 / 0 | no |
| claude-3 | Sonnet | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | binary-search-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-3 | Sonnet | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 1 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | utc-day-python | 79.2% / 6 / 0 | 75.0% / 3 / 0 | 75.0% / 3 / 0 | no |
| claude-4 | Sonnet | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | binary-search-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| claude-4 | Sonnet | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | deep-merge-js | 100.0% / 3 / 1 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | utc-day-python | 75.0% / 3 / 0 | 95.8% / 6 / 0 | 75.0% / 3 / 0 | no |
| agents-1 | Sonnet | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | binary-search-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-1 | Sonnet | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | utc-day-python | 75.0% / 3 / 0 | 75.0% / 3 / 0 | 75.0% / 3 / 0 | no |
| agents-2 | Sonnet | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | binary-search-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-2 | Sonnet | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | stable-dedup-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | parse-integer-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | merge-intervals-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | ttl-cache-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | bounded-map-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | retry-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | topological-sort-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | sql-parameters-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | csv-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | pagination-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | deep-merge-js | 100.0% / 3 / 0 | 100.0% / 3 / 1 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | money-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | utc-day-python | 75.0% / 3 / 0 | 79.2% / 6 / 0 | 75.0% / 3 / 0 | no |
| agents-3 | Sonnet | utf8-stream-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | version-order-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | event-emitter-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | latest-row-sql | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | binary-search-js | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |
| agents-3 | Sonnet | safe-path-python | 100.0% / 3 / 0 | 100.0% / 3 / 0 | 100.0% / 3 / 0 | yes |

| File | Model | Against nothing | Against fake | Separated vs nothing | Separated vs fake |
| --- | --- | --- | --- | --- | --- |
| claude-1 | Haiku | NOT_MEASURED | NOT_MEASURED | none | none |
| claude-2 | Haiku | UNDERPOWERED | UNDERPOWERED | none | none |
| claude-3 | Haiku | UNDERPOWERED | ABOVE_PLACEBO | none | binary-search-js: separated-up |
| claude-4 | Haiku | UNDERPOWERED | UNDERPOWERED | none | none |
| agents-1 | Haiku | UNDERPOWERED | ABOVE_PLACEBO | none | binary-search-js: separated-up |
| agents-2 | Haiku | UNDERPOWERED | UNDERPOWERED | none | none |
| agents-3 | Haiku | UNDERPOWERED | UNDERPOWERED | none | none |
| claude-1 | Sonnet | UNDERPOWERED | UNDERPOWERED | none | none |
| claude-2 | Sonnet | UNDERPOWERED | UNDERPOWERED | none | none |
| claude-3 | Sonnet | UNDERPOWERED | UNDERPOWERED | none | none |
| claude-4 | Sonnet | UNDERPOWERED | UNDERPOWERED | none | none |
| agents-1 | Sonnet | PASSED | ABOVE_PLACEBO | utc-day-python: separated-up | utc-day-python: separated-up |
| agents-2 | Sonnet | UNDERPOWERED | UNDERPOWERED | none | none |
| agents-3 | Sonnet | UNDERPOWERED | UNDERPOWERED | none | none |

The full library readings, including underpowered cases, lost-draw refusals and draw requirements, are in the analysis output. “Not measured” for the incomplete Haiku Karpathy-named job is retained.

**Appendix B: behaviour and paired intervals**

File-to-fake output comparisons: 6 haiku increases · 1 haiku unclear · 3 sonnet increases · 2 sonnet decreases · 2 sonnet unclear. These are behaviour changes, not correctness verdicts.

| File | Model | Metric | Tasks | Nothing | File | Fake | File minus fake (95% interval) | File minus nothing (95% interval) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude-1 | Haiku | out | 19 | 5,471.856 | 5,955.566 | 5,285.956 | 669.610 (315.289, 1,046.439) | 483.710 (215.823, 769.596) |
| claude-1 | Haiku | loc | 19 | 23.719 | 20.544 | 22.754 | -2.211 (-4.439, -0.404) | -3.175 (-6.211, -0.912) |
| claude-1 | Haiku | tests | 19 | 0.937 | 0.921 | 0.921 | 0.000 (0.000, 0.000) | -0.016 (-0.047, 0.000) |
| claude-1 | Haiku | missing_solution | 19 | 0.011 | 0.026 | 0.026 | 0.000 (0.000, 0.000) | 0.016 (0.000, 0.047) |
| claude-1 | Haiku | tool_calls | 19 | 6.100 | 6.548 | 6.246 | 0.303 (-0.232, 0.934) | 0.448 (-0.086, 0.965) |
| claude-2 | Haiku | out | 20 | 5,334.700 | 6,808.908 | 5,290.404 | 1,518.504 (964.617, 2,154.100) | 1,474.208 (982.392, 1,988.542) |
| claude-2 | Haiku | loc | 19 | 22.825 | 21.316 | 22.456 | -1.140 (-3.947, 1.018) | -1.509 (-4.877, 1.158) |
| claude-2 | Haiku | tests | 20 | 0.900 | 0.925 | 0.925 | 0.000 (0.000, 0.000) | 0.025 (0.000, 0.075) |
| claude-2 | Haiku | missing_solution | 20 | 0.050 | 0.025 | 0.025 | 0.000 (0.000, 0.000) | -0.025 (-0.075, 0.000) |
| claude-2 | Haiku | tool_calls | 20 | 6.192 | 6.608 | 6.583 | 0.025 (-0.367, 0.458) | 0.417 (-0.133, 1.008) |
| claude-3 | Haiku | out | 20 | 5,556.903 | 6,738.274 | 5,593.123 | 1,145.151 (694.150, 1,578.681) | 1,181.371 (683.700, 1,765.696) |
| claude-3 | Haiku | loc | 19 | 23.070 | 22.851 | 23.758 | -0.907 (-3.035, 0.449) | -0.219 (-2.596, 1.544) |
| claude-3 | Haiku | tests | 20 | 0.935 | 0.957 | 0.900 | 0.057 (-0.010, 0.168) | 0.022 (-0.010, 0.065) |
| claude-3 | Haiku | missing_solution | 20 | 0.015 | 0.010 | 0.050 | -0.040 (-0.135, 0.015) | -0.005 (-0.030, 0.015) |
| claude-3 | Haiku | tool_calls | 20 | 6.277 | 7.705 | 6.233 | 1.472 (0.822, 2.317) | 1.428 (0.883, 2.015) |
| claude-4 | Haiku | out | 20 | 5,674.008 | 6,371.648 | 5,295.071 | 1,076.578 (411.875, 1,860.942) | 697.640 (127.507, 1,286.940) |
| claude-4 | Haiku | loc | 19 | 22.982 | 23.476 | 22.864 | 0.612 (-1.982, 2.672) | 0.494 (-1.246, 2.488) |
| claude-4 | Haiku | tests | 20 | 0.925 | 0.925 | 0.900 | 0.025 (0.000, 0.075) | 0.000 (0.000, 0.000) |
| claude-4 | Haiku | missing_solution | 20 | 0.025 | 0.025 | 0.050 | -0.025 (-0.075, 0.000) | 0.000 (0.000, 0.000) |
| claude-4 | Haiku | tool_calls | 20 | 6.542 | 7.298 | 6.350 | 0.948 (0.132, 1.853) | 0.757 (0.175, 1.382) |
| agents-1 | Haiku | out | 20 | 5,651.529 | 5,061.567 | 5,330.992 | -269.425 (-645.842, 143.967) | -589.963 (-1,088.800, -94.529) |
| agents-1 | Haiku | loc | 19 | 22.189 | 17.070 | 22.772 | -5.702 (-9.614, -3.105) | -5.118 (-8.526, -3.035) |
| agents-1 | Haiku | tests | 20 | 0.950 | 0.950 | 0.900 | 0.050 (0.000, 0.150) | 0.000 (0.000, 0.000) |
| agents-1 | Haiku | missing_solution | 20 | 0.000 | 0.000 | 0.050 | -0.050 (-0.150, 0.000) | 0.000 (0.000, 0.000) |
| agents-1 | Haiku | tool_calls | 20 | 6.225 | 6.167 | 6.017 | 0.150 (-0.433, 1.000) | -0.058 (-0.383, 0.300) |
| agents-2 | Haiku | out | 20 | 5,486.671 | 6,672.983 | 5,396.975 | 1,276.008 (727.675, 1,848.233) | 1,186.313 (705.733, 1,757.396) |
| agents-2 | Haiku | loc | 20 | 21.891 | 22.350 | 21.475 | 0.875 (-0.858, 3.308) | 0.459 (-1.741, 3.117) |
| agents-2 | Haiku | tests | 20 | 0.928 | 0.950 | 0.950 | -0.000 (-0.050, 0.050) | 0.022 (-0.033, 0.089) |
| agents-2 | Haiku | missing_solution | 20 | 0.022 | 0.000 | 0.000 | 0.000 (0.000, 0.000) | -0.022 (-0.067, 0.000) |
| agents-2 | Haiku | tool_calls | 20 | 6.347 | 6.917 | 6.733 | 0.183 (-0.350, 0.667) | 0.569 (-0.017, 1.192) |
| agents-3 | Haiku | out | 20 | 5,597.329 | 7,756.333 | 5,526.208 | 2,230.125 (1,597.025, 2,960.075) | 2,159.004 (1,555.450, 2,836.612) |
| agents-3 | Haiku | loc | 20 | 21.792 | 21.850 | 21.888 | -0.038 (-1.108, 1.229) | 0.058 (-1.017, 1.417) |
| agents-3 | Haiku | tests | 20 | 0.925 | 0.950 | 0.925 | 0.025 (0.000, 0.075) | 0.025 (0.000, 0.075) |
| agents-3 | Haiku | missing_solution | 20 | 0.025 | 0.000 | 0.025 | -0.025 (-0.075, 0.000) | -0.025 (-0.075, 0.000) |
| agents-3 | Haiku | tool_calls | 20 | 6.446 | 8.050 | 6.392 | 1.658 (1.038, 2.308) | 1.604 (0.900, 2.304) |
| claude-1 | Sonnet | out | 20 | 2,085.050 | 2,034.300 | 2,169.117 | -134.817 (-254.000, -27.000) | -50.750 (-163.733, 61.517) |
| claude-1 | Sonnet | loc | 20 | 21.317 | 20.433 | 24.367 | -3.933 (-7.600, -1.567) | -0.883 (-2.200, 0.750) |
| claude-1 | Sonnet | tests | 20 | 0.950 | 0.950 | 0.950 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| claude-1 | Sonnet | missing_solution | 20 | 0.000 | 0.000 | 0.000 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| claude-1 | Sonnet | tool_calls | 20 | 3.250 | 2.900 | 3.583 | -0.683 (-1.183, -0.217) | -0.350 (-0.700, 0.000) |
| claude-2 | Sonnet | out | 20 | 2,094.283 | 2,768.825 | 2,096.696 | 672.129 (482.550, 872.029) | 674.542 (505.608, 861.633) |
| claude-2 | Sonnet | loc | 20 | 22.300 | 21.054 | 21.167 | -0.113 (-1.904, 2.017) | -1.246 (-3.679, 1.254) |
| claude-2 | Sonnet | tests | 20 | 0.950 | 0.950 | 0.950 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| claude-2 | Sonnet | missing_solution | 20 | 0.000 | 0.000 | 0.000 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| claude-2 | Sonnet | tool_calls | 20 | 3.283 | 4.171 | 3.250 | 0.921 (0.429, 1.404) | 0.888 (0.433, 1.358) |
| claude-3 | Sonnet | out | 20 | 2,081.033 | 2,330.550 | 2,178.483 | 152.067 (-43.400, 343.950) | 249.517 (120.783, 389.333) |
| claude-3 | Sonnet | loc | 20 | 21.450 | 21.117 | 22.783 | -1.667 (-3.067, -0.517) | -0.333 (-1.267, 0.683) |
| claude-3 | Sonnet | tests | 20 | 0.950 | 0.983 | 0.950 | 0.033 (0.000, 0.100) | 0.033 (0.000, 0.100) |
| claude-3 | Sonnet | missing_solution | 20 | 0.000 | 0.000 | 0.000 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| claude-3 | Sonnet | tool_calls | 20 | 3.067 | 4.133 | 3.383 | 0.750 (0.250, 1.267) | 1.067 (0.583, 1.617) |
| claude-4 | Sonnet | out | 20 | 2,185.350 | 2,382.200 | 2,151.167 | 231.033 (78.850, 433.883) | 196.850 (11.133, 412.867) |
| claude-4 | Sonnet | loc | 20 | 22.042 | 24.117 | 21.683 | 2.433 (-0.283, 6.083) | 2.075 (-0.167, 5.450) |
| claude-4 | Sonnet | tests | 20 | 0.950 | 0.950 | 0.950 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| claude-4 | Sonnet | missing_solution | 20 | 0.000 | 0.000 | 0.000 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| claude-4 | Sonnet | tool_calls | 20 | 3.392 | 3.917 | 3.450 | 0.467 (-0.017, 0.950) | 0.525 (-0.083, 1.150) |
| agents-1 | Sonnet | out | 20 | 2,126.117 | 1,648.421 | 2,160.475 | -512.054 (-662.750, -378.433) | -477.696 (-595.996, -358.029) |
| agents-1 | Sonnet | loc | 20 | 22.150 | 14.850 | 22.158 | -7.308 (-10.375, -4.742) | -7.300 (-10.100, -4.850) |
| agents-1 | Sonnet | tests | 20 | 0.950 | 0.950 | 0.950 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| agents-1 | Sonnet | missing_solution | 20 | 0.000 | 0.000 | 0.000 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| agents-1 | Sonnet | tool_calls | 20 | 3.350 | 3.021 | 3.604 | -0.583 (-0.950, -0.217) | -0.329 (-0.721, 0.050) |
| agents-2 | Sonnet | out | 20 | 2,130.037 | 2,221.450 | 2,179.650 | 41.800 (-91.833, 175.800) | 91.413 (-68.933, 227.567) |
| agents-2 | Sonnet | loc | 20 | 22.725 | 20.733 | 23.533 | -2.800 (-6.217, -0.283) | -1.992 (-5.717, 0.892) |
| agents-2 | Sonnet | tests | 20 | 0.950 | 0.983 | 0.950 | 0.033 (0.000, 0.100) | 0.033 (0.000, 0.100) |
| agents-2 | Sonnet | missing_solution | 20 | 0.000 | 0.000 | 0.000 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| agents-2 | Sonnet | tool_calls | 20 | 3.504 | 4.067 | 3.350 | 0.717 (0.283, 1.200) | 0.562 (0.125, 1.042) |
| agents-3 | Sonnet | out | 20 | 2,133.767 | 2,407.533 | 2,110.408 | 297.125 (168.083, 433.475) | 273.767 (111.450, 432.067) |
| agents-3 | Sonnet | loc | 20 | 22.133 | 22.642 | 21.492 | 1.150 (-0.533, 3.600) | 0.508 (-0.825, 2.025) |
| agents-3 | Sonnet | tests | 20 | 0.950 | 0.950 | 0.950 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| agents-3 | Sonnet | missing_solution | 20 | 0.000 | 0.000 | 0.000 | 0.000 (0.000, 0.000) | 0.000 (0.000, 0.000) |
| agents-3 | Sonnet | tool_calls | 20 | 3.200 | 3.817 | 3.479 | 0.338 (0.025, 0.683) | 0.617 (0.233, 0.967) |

Tests and missing solutions are task means of binary draw outcomes. The published analysis includes the exact task IDs, eligible and missing draw counts, excluded tasks, and unrounded intervals for each metric.

**Appendix C: losses and setup searches**

Of 2,646 drawn runs, 58 had a primary or secondary loss: 3 primary execution failures, 32 judge-only primary losses, and 23 secondary-only losses. A draw with both losses is counted once. These losses do not establish their cause.

| File | Model | Execution | Judge-only primary | Secondary-only | All affected | Baseline setup lookups / all / unknown | File setup lookups / all / unknown | Placebo setup lookups / all / unknown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude-1 | Haiku | 0 | 4 | 2 | 6 | 0 / 67 / 0 | 0 / 63 / 0 | 0 / 63 / 0 |
| claude-2 | Haiku | 0 | 2 | 0 | 2 | 0 / 63 / 0 | 0 / 62 / 0 | 0 / 62 / 0 |
| claude-3 | Haiku | 0 | 3 | 4 | 7 | 0 / 70 / 0 | 75 / 79 / 0 | 0 / 62 / 0 |
| claude-4 | Haiku | 0 | 0 | 1 | 1 | 0 / 64 / 0 | 0 / 64 / 0 | 0 / 61 / 0 |
| agents-1 | Haiku | 0 | 3 | 1 | 4 | 0 / 66 / 0 | 0 / 61 / 0 | 0 / 63 / 0 |
| agents-2 | Haiku | 0 | 4 | 2 | 6 | 0 / 68 / 0 | 55 / 62 / 0 | 0 / 64 / 0 |
| agents-3 | Haiku | 0 | 2 | 2 | 4 | 0 / 63 / 0 | 0 / 60 / 0 | 0 / 66 / 0 |
| claude-1 | Sonnet | 0 | 4 | 3 | 7 | 0 / 62 / 0 | 0 / 60 / 0 | 0 / 62 / 0 |
| claude-2 | Sonnet | 0 | 1 | 0 | 1 | 0 / 60 / 0 | 0 / 62 / 0 | 0 / 62 / 0 |
| claude-3 | Sonnet | 0 | 1 | 1 | 2 | 0 / 60 / 0 | 61 / 61 / 0 | 0 / 60 / 0 |
| claude-4 | Sonnet | 1 | 4 | 1 | 6 | 0 / 67 / 0 | 0 / 61 / 1 | 0 / 60 / 0 |
| agents-1 | Sonnet | 1 | 1 | 5 | 7 | 0 / 61 / 1 | 0 / 65 / 0 | 0 / 61 / 0 |
| agents-2 | Sonnet | 0 | 2 | 0 | 2 | 0 / 61 / 0 | 61 / 61 / 0 | 0 / 61 / 0 |
| agents-3 | Sonnet | 1 | 1 | 1 | 3 | 0 / 60 / 0 | 0 / 64 / 1 | 0 / 62 / 0 |

Setup searches count actual Bash, Read, Glob or Grep inputs for the named progress, feature, setup and handoff files or git log, including git with a working-directory option. Descriptions and tool-result text do not count. Lost runs with complete tool evidence remain in the denominator; incomplete tool evidence is unknown.

**Appendix D: receipts and pinned subjects**

- [claude-1 · Haiku · receipt-1d569adc36a7.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-1d569adc36a7.json)
  `1d569adc36a72c710a18330004bddaa39219d0476be7f919cb04d2d11c429800`
- [claude-2 · Haiku · receipt-8ecb8f08cd5c.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-8ecb8f08cd5c.json)
  `8ecb8f08cd5c10b3e637e98da9ce5fab29c28ab9b65d990c9a83cc656e912c50`
- [claude-3 · Haiku · receipt-33347ab84e29.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-33347ab84e29.json)
  `33347ab84e2987b5a8eff08919573f943e7788563ef802e1997f66c814043c9c`
- [claude-4 · Haiku · receipt-15f01115639f.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-15f01115639f.json)
  `15f01115639fb829d9f66449c416a62fe9cf663bab8c6d141f6ab6ce906a3175`
- [agents-1 · Haiku · receipt-bda8cc0a153c.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-bda8cc0a153c.json)
  `bda8cc0a153c77f8e39c1139b9b0133d7e96f340a3060aef7d3bdc063af20b3f`
- [agents-2 · Haiku · receipt-7cceeac774f0.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-7cceeac774f0.json)
  `7cceeac774f096b912334df8d14c780b47f075fb8cba07d8f6ec891f7dd466ef`
- [agents-3 · Haiku · receipt-c3ad5d7cc338.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-c3ad5d7cc338.json)
  `c3ad5d7cc338e5f3a650bcd7c23ee6621749aa531eaa379fdc899eff3c808bd8`
- [claude-1 · Sonnet · receipt-abbbf0c5e42e.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-abbbf0c5e42e.json)
  `abbbf0c5e42ecbf92e392786e9aaa4b690f9714289f08be29347f6331af18fd4`
- [claude-2 · Sonnet · receipt-f7a9a35d353a.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-f7a9a35d353a.json)
  `f7a9a35d353a48789be738ab93356d8af9dbd290ef596a20eb5f639e66746fbf`
- [claude-3 · Sonnet · receipt-bf3f1267aee0.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-bf3f1267aee0.json)
  `bf3f1267aee035bce977d799b4c66ed64a6d13521ab01ed903b9b6218c4ed1ad`
- [claude-4 · Sonnet · receipt-d1d24d545bb8.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-d1d24d545bb8.json)
  `d1d24d545bb81c87b41bf8fec7c7f372e45621301dbcf2f18ea0327719df925b`
- [agents-1 · Sonnet · receipt-3f4e17a1a3e0.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-3f4e17a1a3e0.json)
  `3f4e17a1a3e0b69d1b7e421b2a8c85de913f4d1cf244720eada82e82a05869f0`
- [agents-2 · Sonnet · receipt-705fa4fe5409.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-705fa4fe5409.json)
  `705fa4fe54097f89ba5cba204346b9dbef82629546f3f941148fd85a349baa37`
- [agents-3 · Sonnet · receipt-fb8788547a36.json](https://github.com/driftproofhq/driftproof/blob/main/receipts/report-016/receipt-fb8788547a36.json)
  `fb8788547a368a2ab90e57f2e9f7c662f78a1d834ab76a11b9d2b703a0eb6bad`

| File | Pinned source | Stars | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| claude-1 | [multica-ai/andrej-karpathy-skills/CLAUDE.md](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/CLAUDE.md) | 222,760 | 2357 | 694a2d721e41c385f3db492838c23299826df5ba9809e3b0721aac70021e196a |
| claude-2 | [2025Emma/vibe-coding-cn/i18n/zh/prompts/system_prompts/CLAUDE.md/10/CLAUDE.md](https://github.com/2025Emma/vibe-coding-cn/blob/9b42dd10ddf3fff58f8c7a4d347175db107d7bf9/i18n/zh/prompts/system_prompts/CLAUDE.md/10/CLAUDE.md) | 23,078 | 21217 | 12dc0451a147a87a93e43de16535c0d956f66e838014067307b10d2619507422 |
| claude-3 | [walkinglabs/learn-harness-engineering/docs/en/resources/templates/CLAUDE.md](https://github.com/walkinglabs/learn-harness-engineering/blob/a9342ff471f2c0e60be0c08b9f4a7c502df4e442/docs/en/resources/templates/CLAUDE.md) | 21,200 | 1408 | d1730a3ba184aa9f0b12c25aebdba89712dac5009bc0b1b44b4d355dff40355a |
| claude-4 | [drona23/claude-token-efficient/CLAUDE.md](https://github.com/drona23/claude-token-efficient/blob/0d30a6db75af983b8ababf585f28faefdfc87895/CLAUDE.md) | 6,110 | 352 | 6656125f2b4f777d9cb4149b2acc3b0281aab4e8d8ebdd4ddcdb1ae9274e8253 |
| agents-1 | [DietrichGebert/ponytail/AGENTS.md](https://github.com/DietrichGebert/ponytail/blob/09c434ab73ca43761c5d8b0c5d341926c2fba710/AGENTS.md) | 174,414 | 2721 | b98b15e1d683ee205e124b52b8d330128593f4a87b545cf8185e2712cd1bb25f |
| agents-2 | [walkinglabs/learn-harness-engineering/docs/en/resources/templates/AGENTS.md](https://github.com/walkinglabs/learn-harness-engineering/blob/a9342ff471f2c0e60be0c08b9f4a7c502df4e442/docs/en/resources/templates/AGENTS.md) | 21,200 | 1949 | 42d2ed896cc6db9e459d9f59e2e39af2ceba664a40f092544f1b34678a90aa58 |
| agents-3 | [Sahir619/fable-method/AGENTS.md](https://github.com/Sahir619/fable-method/blob/9924067e82bd48cf3b0426378db93238bfb33e9b/AGENTS.md) | 2,306 | 16486 | 8237d3aea88700d5ec3051adc2a0641a9fe68ddca9e96dbef6c1fc6473c86b3c |

**Appendix E: execution conditions and usage**

Execution settings come from the sealed receipts. Runner commits come from the checkpoint evidence they seal. A common model name alone is not a comparison contract. The manifest records the expected settings, task rows and capture context. Each original receipt seals its own values. No cross-model causal comparison is claimed.

| File | Model | Runner source | Harness | Call limits | Judge | Suite / freeze | Runtime / starter / environment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude-1 | Haiku | Driftproof source at commit `c74110f89a62f0b9192b9c38c177859c4365e475`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| claude-2 | Haiku | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| claude-3 | Haiku | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| claude-4 | Haiku | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| agents-1 | Haiku | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| agents-2 | Haiku | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| agents-3 | Haiku | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| claude-1 | Sonnet | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| claude-2 | Sonnet | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| claude-3 | Sonnet | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| claude-4 | Sonnet | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| agents-1 | Sonnet | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| agents-2 | Sonnet | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |
| agents-3 | Sonnet | Driftproof source at commit `ff3b5671926842cf5bd0c087291df91b1843f759`, released in 0.24.0 | {"name":"claude-code","version":"2.1.287"} | {"max_output_tokens":16384,"max_turns":32,"timeout_ms":300000} | claude-sonnet-5-5 | d60f94bb204643e335239404dae412d482588514d658380734dcaf027793b67f / 3ee521dbd58c525e4f4cb3aa0ecf05a6f21c21884a28afd6456032198b101698 | 650ea8175b6eaaf14056b150162e9b6698253d14ed86b1c3aa9e4618cbf73b5d / 47ea2419cc901bac7e89253ca7735db211aff5248d748cb6892fc88f6c53856c / a8d2649ffddaffda72d559f070b4d21d4d25781ffd1c4f5415e1780f85c9984e |

The recorded usage fields do not establish whether output tokens include thinking tokens. Usage fields: cached_tokens, input_tokens, output_tokens, wall_ms.
