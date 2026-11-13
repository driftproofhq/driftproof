# Driftproof for Claude Code

Type `/driftproof:start` in the folder that holds your skills or your CLAUDE.md.

Driftproof measures whether a skill or a rules file helps. It runs its test cases on a model with it and without it, grades the answers, and writes a dated receipt of the result.

This plugin adds eight commands:

- `/driftproof:start` walks you through a first result: pick a skill, draft its test cases with Claude, run a quick smoke run, and open the results page.
- `/driftproof:init <dir>` on a skill you already have leads into the same guided first run: Claude drafts its test cases with you, aimed at outcomes you would check, adds them after you say yes, labelled as drafted from the skill and approved by you, and runs a quick first look. On a folder that does not exist yet it sets up a new skill with starter test cases to edit.
- `/driftproof:run <skill-dir>` on a skill with no test cases offers to draft them first. Otherwise it measures a skill in this repository, or, after you confirm the skill is yours, a skill inside the folder you run from where there is no git repository, and writes a receipt.
- `/driftproof:blind [<receipts-dir>]` opens the results page from local receipts, leaving the Blind read block, when available, to you until Reveal. Use `--keep-transcripts` with `/driftproof:run` to keep answers for later reading.
- `/driftproof:compare <rules-file> --suite <tasks>` asks whether your edit helped on those tasks, using the committed file against your working copy, or another rules file named with `--against`. It shows the runner's reading and caveat unchanged.
- `/driftproof:inspect <file-or-skill-dir>` shows the runner's local text report without running the content; a clean reading is not a guarantee.
- `/driftproof:recheck <skill-dir-or-rules-file>` saves a skill's or rules file's tests and settings the first time, and nothing runs. On each later use it runs those saved tests after you say yes, and shows the runner's dated reading unchanged. `/driftproof:recheck history` shows every dated reading so far. A recheck compares with its first run, so "since last month" works only if you ran a recheck last month.
- `/driftproof:badge <receipt.json>` checks a receipt, prints a badge for your README, and says which parts of the receipt it did not check.

Both `/driftproof:start` and `/driftproof:init` can also start from a mistake the AI made: you give a short, sanitised excerpt of the task it got wrong and say what a good answer must and must not contain, Claude drafts one test from that and two of the same kind on other subjects, and after you say yes they are saved labelled as drafted from a failure you described and approved. Before anything runs, the door refuses a draft that carries an email, a home folder path on Linux or macOS or a credential-shaped string, anywhere in the draft, and names what to remove.

It measures and never changes a skill's instructions. The one file it adds is a new `evals/evals.json`, from `/driftproof:start` or `/driftproof:init`, to a skill that has none, after you say yes in the run. `SKILL.md` and every other file are as they were. Driftproof itself is a command line tool, published on npm as `driftproof`. The CLI is the product, and it runs on every surface Driftproof measures, while the plugin is one install path for Claude Code users.

## What runs

Each command file gives the exact line Claude runs, and says which of the two forms it uses. The line starts the runner this plugin is released with and names that version, and the runner refuses to act if it is not that version. The plugin holds no measuring code of its own.

The commands use the npx form by default, so a first run has no extra install step. When Claude runs the line as written, npm starts in this plugin's own folder, so a package or a settings file planted in your project is not read, and a program in your project's `node_modules/.bin` is not run.

Two gaps remain, and words cannot close them. A program in a parent folder's `node_modules/.bin` can run before the runner. The line Claude runs can be altered, and nothing checks it first. The runner's own check comes after npm has started it, so it stops neither.

The installed form is the safer alternative. Install this version of the runner with npm and use the installed line each command file gives. npm then starts nothing, so the first gap closes. The line Claude runs can still be altered in either form.

## What it sends, and where

- In the npx form, npm asks the registry about the version each time a command runs, and downloads the package and its dependencies when your npm cache does not already hold them. npm may also check the registry for a newer npm.
- Apart from that, `/driftproof:init`, `/driftproof:inspect`, `/driftproof:badge`, the first use of `/driftproof:recheck`, `/driftproof:recheck history` and the version check each command runs first use local files only. Driftproof makes no network call for them.
- `/driftproof:run` sends each test case, with and without your skill's `SKILL.md`, to the model through `claude -p`, Claude Code's own command line, so the calls go through your own Claude Code account. That call does not use a provider key set in your shell.
- `/driftproof:compare` sends each version of the rules and the same tasks through the runner's configured model and grader, as the CLI does. Both versions run as you, on your own command line login for the model (Claude Code, or Codex for an OpenAI command line model), on the terms `/driftproof:run` uses: both files inside this repository, or after you confirm they are yours. `--placebo` adds a third arm for each version. It writes receipts and `compare.md` under `receipts/compare-<date>/`. Its private temporary copy of the committed file is removed after the run.
- A later use of `/driftproof:recheck` asks you first, naming the model and the call limit, then sends the saved tests, with and without the saved copy of the subject, through the runner's saved model and grader, on your own plan or model account. For a folder this command saved, those tests run as you, on your own command line login for the model (Claude Code, or Codex for an OpenAI command line model). That is allowed only on `/driftproof:run`'s terms: the subject is inside this repository, or you confirm again, each time, that it is yours. A saved folder never allows it by itself, and one the CLI saved without `--trusted-skill` still runs through the isolation account. The first use saves a copy of the subject, its tests and its settings under `recheck/<name>/` at the root of your repository, and each run adds a dated receipt there.
- The same model grades each answer, and is sent the test case, the answer and its rubric to do it.
- `/driftproof:start` sends what `/driftproof:run` sends, for the few test cases of a quick smoke run, or for at most five test cases in the small full run it offers.
- Some settings of the runner change where these calls go. They live in the runner's own documentation and on the site, not in this plugin.
- `driftproof import --from nvidia-cards` runs `git rev-parse` and `git ls-tree` in the checkout you name, to read its commit. If that checkout is a partial clone that lacks the commit's trees, `git ls-tree` fetches them from the clone's remote.
- Driftproof's own code makes no other network call: no telemetry, no update check, no upload. What `claude -p` and `codex` themselves connect to is up to them and your settings.

Each command checks that the runner is new enough before it starts the runner for any work, and says so if it is not.
