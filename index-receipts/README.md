<!-- SPDX-License-Identifier: Apache-2.0 -->
# The skill index's receipts

These are the files the "Worth installing?" pages at `/skills/` read (spec 267). `sources.json` lists every receipt with its sha256, and `scripts/build-skill-index.mjs` refuses a build when any listed file differs from it, or when a receipt it should list is left out.

## The three sources

- **Driftproof**: driftproofhq/driftproof, licence Apache-2.0. Its receipts are not copied here: `sources.json` lists them where they are published, under `receipts/report-009/`, `receipts/report-011/`, `receipts/report-013/` and `receipts/report-014/`, every receipt of the three skills Report 009's protocol names. Report 010 has no receipt, so it gives no row. Each skill's repository, path and commit are read from Report 009's protocol and spec 034's upstream record.
- **skill-placebo**: simonether/skill-placebo at commit `caeb74c060f5c9523d101abc926b5a309f85d693`, licence MIT. `skill-placebo/LICENSE` is its licence text. `skill-placebo/claude-code.json` is its published verdicts file, `results/main/claude-code.json` at that commit. `skill-placebo/skills.lock.json` is its install record at that commit: each arm's repository and pinned commit. The other nine files are Driftproof's recomputation of its main run, one receipt per skill arm, each against the run's baseline arm.
- **NVIDIA**: NVIDIA/skills at commit `14a98ae278cec7e867695189d0f4003c08e4f765`, licence CC-BY-4.0 (CC BY 4.0). `nvidia/LICENSE` is the licence text, the file `LICENSE-CC-BY-4.0` at that commit. The other files are receipts of the benchmark cards at that commit, one per skill and agent, each carrying the card's figures as printed.

## Checking a copy against its commit

Each copied file's git blob sha1 is in `sources.json` or in the receipt itself, and the tests recompute it from the bytes here. That the blob sits at its path in the pinned commit is not checked offline. To check it, run `git ls-tree <commit> <path>` on a clone of the source at that commit, or read the same listing from the GitHub tree API:

- skill-placebo: `git ls-tree caeb74c060f5c9523d101abc926b5a309f85d693 LICENSE skills.lock.json results/main/claude-code.json` reads `8a0faaf55107efbdfa395f4d0bf220214a028ee6`, `0514fc3fd1692c2a163f431d590b73f147fa73c1` and `dc51fac40180b6ad707023dc4f8021e3c2cdc1dd`.
- NVIDIA: `git ls-tree 14a98ae278cec7e867695189d0f4003c08e4f765 LICENSE-CC-BY-4.0` reads `b0de5b1eb94213e92ad03b131684bae483db2bd9`. Each receipt's `source_figures.source.files` names its card and `benchmarks.json` with their blob sha1s at that commit.

## How the receipts were made

Imports are commands someone runs, never a scheduled job.

- skill-placebo, on a clone at its commit, once per arm of `skills.lock.json`: `driftproof import --from harbor --with results/main/claude-code/trials/skill-<id> --without results/main/claude-code/trials/baseline --skill <repository name> --out index-receipts/skill-placebo`. That is the source's main run of 450 trials, the one its verdicts file reads (blocks 0 and 1). The later block under `appendix-block2/` is not in its verdicts and is not imported.
- NVIDIA, on a checkout at its commit: `driftproof import <checkout> --from nvidia-cards --commit 14a98ae278cec7e867695189d0f4003c08e4f765 --out <dir>`, which writes 759 receipts of 386 skills. The two receipts of `ambient-healthcare-agent-with-nemotron-voice-agent` are not copied here: its name fits no page title of 60 characters, so by the operator's ruling of 14 Oct 2026 (spec 267 TBD-1) it would refuse the build. The other 757 are copied as written.

Then `sources.json` lists each file with its sha256, and `node scripts/build-skill-index.mjs` builds `docs/skills/`.
