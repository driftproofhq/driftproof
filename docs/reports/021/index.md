# One line in a Jest rules file made Claude's tests miss bugs

Canonical: <https://driftproofhq.com/reports/021/>

## What did Report 021 find?

- **What we tested.** We gave Claude a Jest rules file from the awesome-cursorrules list and asked it to write tests for 12 small projects with bugs planted in them.
- **What we found.** With the file, Sonnet's tests caught every planted bug in 2.5% of attempts against 65.8% with no file (share of attempts that caught every bug), and caught 9.5 points fewer of the planted bugs, 85.3% against 94.8% (share of planted bugs caught).
- **What the comparison means.** Each rules file was given to the model as always-on text. The editors decide for themselves when to attach a rule, and they add their own instructions; we reproduce neither.
- **Re-running models.** Re-running the models needs the runner, which arrives with a later release.

Report 021: Rules-file quality, claude-haiku-5-5, claude-sonnet-5-5

Type Rules-file quality report

What moved One line in a Jest rules file made Claude's tests miss bugs

Models `claude-haiku-5-5` `claude-sonnet-5-5`

Headline We gave Claude a Jest rules file from the awesome-cursorrules list and asked it to write tests for 12 small projects with bugs planted in them.

Verdict With the file, Sonnet's tests caught every planted bug in 2.5% of attempts against 65.8% with no file (share of attempts that caught every bug), and caught 9.5 points fewer of the planted bugs, 85.3% against 94.8% (share of planted bugs caught).

Receipts [12 receipts on Zenodo](https://doi.org/10.5281/zenodo.24519141)

**Cite this**

```
@techreport{driftproof-021,
  title  = {One line in a Jest rules file made Claude's tests miss bugs},
  author = {Driftproof},
  year   = {2026},
  type   = {Rules-file quality report},
  note   = {claude-haiku-5-5, claude-sonnet-5-5},
  url    = {https://driftproofhq.com/reports/021/}
}
```

Rules-file quality report

We gave Claude a Jest rules file from the awesome-cursorrules list and asked it to write tests for 12 small projects with bugs planted in them. With the file, Sonnet's tests caught every planted bug in **2.5%** of attempts against **65.8%** with no file (share of attempts that caught every bug), and caught 9.5 points fewer of the planted bugs, **85.3%** against **94.8%** (share of planted bugs caught). One line in the file asks for 3 to 5 tests per file. When we removed just that line and ran again, the drop went away for Sonnet on both measures, and for Haiku on the share of attempts that caught every bug.

Each task plants 20 bugs, so 120 attempts face 2,400 planted bugs. A bug counts as caught when the model's tests pass on the correct code and fail on the bugged copy. Haiku figures include 5 attempts re-run after the test setup lost them (see Limits). [Tests written](https://github.com/driftproofhq/driftproof/blob/main/scripts/analyze-report-021.js#L71): `test()` and `it()` calls (with their `.each`, `.only` and `.skip` forms) in the test files the model added, counted in its finished project; a call inside a loop or a `test.each` table counts once. Every starter project already had 19 tests, which no attempt changed and which are not counted.

| Jest tasks, 120 attempts per cell | Sonnet, no file | Sonnet, with file | Haiku, no file | Haiku, with file |
| --- | --- | --- | --- | --- |
| Share of attempts that caught every bug | 65.8% (79) | 2.5% (3) | 33.3% (40) | 5.0% (6) |
| Share of planted bugs caught | 94.8% | 85.3% | 92.7% | 83.9% |
| Tests written per attempt (median) | 31 | 10 | 35 | 7 |

The two measures tell one story at different scales. Most single bugs are still caught with the file (the share of planted bugs caught falls by 9.5 points for Sonnet and 8.8 for Haiku). But a test file with fewer tests almost always misses at least one, so the share of attempts that caught every bug collapses.

## Limits

- **Single-turn tasks.** One prompt per attempt, in a small starter project. There was no back-and-forth with a person.
- **Not run inside Cursor, Copilot or Windsurf.** Each rules file was given to the model as always-on text. The editors decide for themselves when to attach a rule, and they add their own instructions; we reproduce neither.
- **Two Claude models only:** Claude Haiku 5.5 and Claude Sonnet 5.5, through Claude Code. Other models may react differently.
- **One judge:** Claude Opus 5.5, one score per attempt, for qualities tests cannot check. No number on this page rests on the judge.
- **12 tasks per topic**, 10 attempts per task and arm.
- **Who wrote and checked the tasks.** An OpenAI Codex agent (gpt-6-astra) wrote the tasks, hidden tests, reference solutions and planted bugs from the four topics alone, without seeing any rules file. Separate Claude review agents checked them blind. A fairness review then went through every failing check against real attempts, and fixed or removed unfair ones. Machine checks confirmed that every reference solution passes its hidden tests and that every planted bug can be caught.
- **Lost and re-run attempts.** The test setup lost 31 of 4,560 attempts (crashes, out-of-memory kills, one timeout). In the Jest comparison, all 11 lost attempts were re-run once, after their original runs, and all completed. In the other three topics, the 20 lost attempts were not re-run, and those shares are over the attempts that completed (at most 3 lost per arm). Counting every lost attempt as a failure changes no conclusion.
- **Two pauses.** The full run paused twice on a usage limit (20 Nov for about 25 minutes, and 21 to 23 Nov). Each run resumed from its saved progress.
- **The re-run comparison mixes date and run order.** The original runs did each task's 10 attempts per arm as one block. The removal run interleaved the arms on a later day. So a gap between them could come from either.

## What removing the line showed

We ran the Jest tasks again on one day with three versions side by side: the file without that one line, the full file, and no file. Everything else stayed the same: the tasks, the planted bugs, the test setup, the models and the judge.

Tests written are counted as in the first table: tests the model added, not the starter's 19.

| Removal run, 120 attempts per cell | Without the line | Full file | No file |
| --- | --- | --- | --- |
| **Sonnet** |  |  |  |
| Share of attempts that caught every bug | 69.2% (83) | 8.3% (10) | 64.2% (77) |
| Share of planted bugs caught | 95.1% | 86.3% | 97.1% |
| Tests written per attempt (median) | 41 | 10 | 30 |
| **Haiku** |  |  |  |
| Share of attempts that caught every bug | 43.3% (52) | 8.3% (10) | 34.2% (41) |
| Share of planted bugs caught | 92.1% | 86.7% | 93.6% |
| Tests written per attempt (median) | 46 | 10 | 36 |

How far it goes, measure by measure. Each change below is in percentage points, with its 95% range (resampling the 12 tasks):

- **Sonnet, both measures: clear.** Removing the line raised the share of attempts that caught every bug by 60.8 points (46.7 to 75.0), and the share of planted bugs caught by 8.8 points (5.0 to 12.8).
- **Haiku, share of attempts that caught every bug: clear.** It rose by 35.0 points (19.2 to 51.7).
- **Haiku, share of planted bugs caught: not shown.** It rose by 5.4 points, but the range runs from −1.3 to +10.0 and includes zero.

Without the line, we could not tell the file apart from no file. Against no file on the same day, the differences were +5.0 points (Sonnet) and +9.2 points (Haiku) on the share of attempts that caught every bug, and −2.0 and −1.5 points on the share of planted bugs caught. Every one of those ranges includes zero. So the rest of the file neither helped nor hurt in a way we could detect.

On the second day, no file gave nearly the same results: on the share of attempts that caught every bug, 64.2% against 65.8% for Sonnet and 34.2% against 33.3% for Haiku. The full file stayed far below no file but scored a little higher than in the original run: Sonnet's share of attempts that caught every bug was 8.3% against 2.5% (+5.8 points, 1.7 to 10.0), and Haiku's share of planted bugs caught was 86.7% against 83.9% (+2.8 points, 0.9 to 5.0).

## The file, and what the line does

The file is `rules/jest-unit-testing-cursorrules-prompt-file.mdc` in the [awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) list on GitHub. It last changed on 13 May 2026 (commit `4467ad4`). We used its text without the 5-line header (the `description`, `globs` and `alwaysApply` lines and their fences), which Cursor reads as settings rather than instructions. The line we removed is item 8:

> `**8** **Test Quantity**: Limit to 3-5 focused tests per file for maintainability`

The line does what it says. It limits the number of tests to keep a test file maintainable, which is a fair goal. Each task asked for one test file, so the line applied directly. With the full file, the models wrote a median of 7 (Haiku) and 10 (Sonnet) tests in the main run, and 10 each in the removal run. With no file, they wrote 30 to 36. What nobody could see without measuring is the cost. Fewer tests left more planted bugs uncaught, and far fewer attempts caught every one.

In Cursor this file is set to attach automatically when a matching file is in context. We gave it as always-on text in every attempt, so we measured the text, not Cursor's choice of when to use it.

## The other three files: we could not show any help

We measured three more files the same way, each on its own topic. The main measure here is the share of attempts where every hidden test passed. None of the files showed a gain over no file on that measure.

Share of attempts where every hidden test passed; 120 attempts per cell, less up to 3 lost. "Tasks scoring the same in every arm" counts tasks with an identical share under no file, the file, a same-length irrelevant text and same-length generic advice. Every one of those sat at 0% or at 100%.

| File, topic | Model | No file | With file | Change, points (95% range) | Tasks scoring the same in every arm |
| --- | --- | --- | --- | --- | --- |
| GitHub Copilot security instructions, security | Haiku | 55.8% | 63.0% | +7.1 (−4.5 to +23.0) | 6 of 12 |
| GitHub Copilot security instructions, security | Sonnet | 60.0% | 60.8% | +0.8 (0.0 to +2.5) | 11 of 12 |
| Windsurf "Honey" rules, general code | Haiku | 64.4% | 67.2% | +2.9 (−2.5 to +8.7) | 4 of 12 |
| Windsurf "Honey" rules, general code | Sonnet | 72.0% | 71.4% | −0.8 (−5.0 to +3.3) | 7 of 12 |
| Cursor Python FastAPI rules, FastAPI | Haiku | 88.1% | 85.0% | −3.3 (−8.3 to 0.0) | 5 of 12 |
| Cursor Python FastAPI rules, FastAPI | Sonnet | 93.3% | 95.8% | +2.1 (−5.4 to +10.8) | 6 of 12 |

**Ceiling caveat:** many tasks gave the same result whatever the model was given, either always passing or never passing, so on those tasks no file could have shown a gain. For Sonnet on security, that was 11 of 12 tasks. "We could not show any help" is what these numbers support. They do not show that the files cannot help.

On the second measure, the share of hidden tests passed, one comparison cleared our bar. For Haiku, the Windsurf file scored +1.3 points over no file (+0.03 to +2.8). Generic advice of the same length, written from the topic alone, scored +1.1 (+0.04 to +2.4) on the same measure. So we cannot tie that gain to this file.

## How we measured

- **Tasks.** 12 per topic, chosen from a pool of 68 by a rule fixed before any run: keep the tasks where no file scored closest to half. Each task is a small starter project of 4 to 10 files with a short, realistic prompt. Jest tasks ask for one test file covering a module; the other topics ask for code that hidden tests check for practices a careful engineer would follow unprompted.
- **Arms.** No file; the rules file; a same-length irrelevant text (a placebo); and same-length generic advice on the topic, written without seeing the file.
- **Attempts.** 10 per task and arm, per model, fresh each time.
- **Measures.** Main: the share of attempts where every hidden test passed (for Jest: where every planted bug was caught). Second: the share of hidden tests passed (for Jest: the share of planted bugs caught). Both were fixed before the run.
- **Ranges.** 95% ranges from 4,000 resamples of the 12 tasks, pairing each task's arms (seed 501). They are pointwise: with this many comparisons, an occasional range will clear zero by chance.
- **Cost.** At list prices the calls would cost about USD 1,721 (USD 1,485 for the study and USD 236 for the removal run).

## What you cannot reproduce yet

- Re-running the models needs the runner, which arrives with a later release.
- Model output varies between runs. A re-run should land within the ranges, not repeat each attempt.
- The models are fixed versions: `claude-haiku-5-5` and `claude-sonnet-5-5`, with `claude-opus-5-5` as judge. They can be retired, and service behaviour can change.
- The test environment is a 444 MB pinned image (digest `5509c354…`, Claude Code 2.1.287). A rebuild may not match byte for byte.
- It needs Linux with sandboxing and a dedicated user.
- The judge also varies, though no number on this page rests on it.
- Re-running the calibration that chose the 12 tasks is a separate, paid exercise. The selection itself can be checked from the data.

## Check it yourself

The twelve receipts are on Zenodo: [10.5281/zenodo.24519141](https://doi.org/10.5281/zenodo.24519141).

The [report folder](https://github.com/driftproofhq/driftproof/tree/main/receipts/report-021) contains the manifest with hashes, the three analysis outputs, the frozen task suite and the five rules texts. The Jest text is `c8c5f92e…`; without the line it is `c3bffb31…`.

From a checkout of the public repository, download the twelve files and run the offline script. It refuses any file whose hash does not match. It also checks the JSON hash after decompression and the receipt hash, and refuses missing or extra files.

```
mkdir -p report-021-receipts
curl --fail --location 'https://zenodo.org/records/24519141/files/main-fastapi-haiku.json.gz?download=1' --output report-021-receipts/main-fastapi-haiku.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/main-fastapi-sonnet.json.gz?download=1' --output report-021-receipts/main-fastapi-sonnet.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/main-jest-haiku.json.gz?download=1' --output report-021-receipts/main-jest-haiku.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/main-jest-sonnet.json.gz?download=1' --output report-021-receipts/main-jest-sonnet.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/main-security-haiku.json.gz?download=1' --output report-021-receipts/main-security-haiku.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/main-security-sonnet.json.gz?download=1' --output report-021-receipts/main-security-sonnet.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/main-utilities-haiku.json.gz?download=1' --output report-021-receipts/main-utilities-haiku.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/main-utilities-sonnet.json.gz?download=1' --output report-021-receipts/main-utilities-sonnet.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/removal-jest-haiku.json.gz?download=1' --output report-021-receipts/removal-jest-haiku.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/removal-jest-sonnet.json.gz?download=1' --output report-021-receipts/removal-jest-sonnet.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/rerun-jest-haiku.json.gz?download=1' --output report-021-receipts/rerun-jest-haiku.json.gz
curl --fail --location 'https://zenodo.org/records/24519141/files/rerun-jest-sonnet.json.gz?download=1' --output report-021-receipts/rerun-jest-sonnet.json.gz
npm i --no-save @babel/parser@7.29.14
node scripts/analyze-report-021.js --receipts report-021-receipts --check
```

## Run record

- Main run: 20 to 23 Nov 2026 (UTC). 8 runs (4 files × 2 models), all complete.
- Removal run: 24 Nov 2026 (UTC), 2 runs, all complete. Re-runs of lost attempts: 24 Nov, 22:07 to 22:29 UTC.
- Rules texts as fetched for the study. Jest and FastAPI: awesome-cursorrules, last changed 13 May 2026. Security: `instructions/security-and-owasp.instructions.md` in github/awesome-copilot, commit `c835373` (2 Sep 2026). Honey: `.windsurf/rules/honey.md` in Green-PT/honey-for-devs, commit `6eb60f9` (18 Oct 2026). Front-matter headers were removed in each case.

Report #021. Driftproof measures whether a rules file or skill changes what a model does.
