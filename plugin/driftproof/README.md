# Driftproof for Claude Code

Driftproof measures whether an agent skill still helps. It runs the skill's test cases on a model with the skill and without it, grades the answers, and writes a dated receipt of the result.

This plugin adds four commands:

- `/driftproof:start` walks you through a first result: pick a skill, draft its test cases with Claude, run a quick smoke run, and open the results page.
- `/driftproof:init <dir>` on a skill you already have leads into the same guided first run: Claude drafts its test cases with you, aimed at outcomes you would check, adds them after you say yes, labelled as drafted from the skill and approved by you, and runs a quick first look. On a folder that does not exist yet it sets up a new skill with starter test cases to edit.
- `/driftproof:run <skill-dir>` on a skill with no test cases offers to draft them first. Otherwise it measures a skill in this repository, or, after you confirm the skill is yours, a skill inside the folder you run from where there is no git repository, and writes a receipt.
- `/driftproof:badge <receipt.json>` checks a receipt, prints a badge for your README, and says which parts of the receipt it did not check.

It measures and never changes a skill's instructions. The one file it adds is a new `evals/evals.json`, from `/driftproof:start` or `/driftproof:init`, to a skill that has none, after you say yes in the run. `SKILL.md` and every other file are as they were. Driftproof itself is a command line tool, published on npm as `driftproof`. The CLI is the product, and it runs on every surface Driftproof measures, while the plugin is one install path for Claude Code users.

## What runs

Each command runs `npx driftproof@0.16.0`, the version this plugin is released with. It passes the arguments as a list, with no shell. The plugin holds no measuring code of its own.

## What it sends, and where

- Unless your project already has `driftproof@0.16.0` installed, `npx` asks the npm registry about that version each time a command runs, and downloads the package and its dependencies when your npm cache does not already hold them. npm may also check the registry for a newer npm.
- Apart from that, `/driftproof:init`, `/driftproof:badge` and the version check each command runs first use local files only. Driftproof makes no network call for them.
- `/driftproof:run` sends each test case, with and without your skill's `SKILL.md`, to the model through `claude -p`, Claude Code's own command line, so the calls go through your own Claude Code account. It removes `ANTHROPIC_API_KEY` from that call, so that key in your shell is not used.
- The same model grades each answer, and is sent the test case, the answer and its rubric to do it.
- `/driftproof:start` sends what `/driftproof:run` sends, for the few test cases of a quick smoke run.
- Some settings change this. An OpenAI model named with `--models` goes to OpenAI through the `codex` command line, or to the OpenAI API with your `OPENAI_API_KEY`; `OPENAI_SURFACE` chooses which, and when it is not set the API is used whenever `OPENAI_API_KEY` is set. `OPENAI_BASE_URL`, or a model list named by `DRIFTPROOF_REGISTRY`, can point that call at another address, and the list can name another key variable. `CLAUDE_PROVIDER` set to `api` sends the calls to the Anthropic API, or to `ANTHROPIC_BASE_URL` if you set it, with your `ANTHROPIC_API_KEY`. A `judge_model` in a `.driftproofrc` in the folder you run from chooses the grader.
- Driftproof's own code makes no other network call: no telemetry, no update check, no upload. What `claude -p` and `codex` themselves connect to is up to them and your settings.
