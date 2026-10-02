# Driftproof for Claude Code

Driftproof measures whether an agent skill still helps. It runs the skill's test cases on a model with the skill and without it, grades the answers, and writes a dated receipt of the result.

This plugin adds three commands:

- `/driftproof:init <dir>` sets up a new skill folder with starter test cases.
- `/driftproof:run <skill-dir>` measures a skill in this repository and writes a receipt.
- `/driftproof:badge <receipt.json>` checks a receipt, prints a badge for your README, and says which parts of the receipt it did not check.

The plugin measures and never changes a skill. Driftproof itself is a command line tool, published on npm as `driftproof`. The CLI is the product, and it runs on every surface Driftproof measures, while the plugin is one install path for Claude Code users.

## What runs

Each command runs `npx driftproof@0.13.0`, the version this plugin is released with. It passes the arguments as a list, with no shell. The plugin holds no measuring code of its own.

## What it sends, and where

- Unless your project already has `driftproof@0.13.0` installed, `npx` asks the npm registry about that version each time a command runs, and downloads the package and its dependencies when your npm cache does not already hold them. npm may also check the registry for a newer npm.
- Apart from that, `/driftproof:init`, `/driftproof:badge` and the version check each command runs first use local files only. Driftproof makes no network call for them.
- `/driftproof:run` sends each test case, with and without your skill's `SKILL.md`, to the model through `claude -p`, Claude Code's own command line, so the calls go through your own Claude Code account. It removes `ANTHROPIC_API_KEY` from that call, so that key in your shell is not used.
- The same model grades each answer, and is sent the test case, the answer and its rubric to do it.
- Some settings change this. An OpenAI model named with `--models` goes to OpenAI through the `codex` command line, or to the OpenAI API with your `OPENAI_API_KEY`; `OPENAI_SURFACE` chooses which, and when it is not set the API is used whenever `OPENAI_API_KEY` is set. `OPENAI_BASE_URL`, or a model list named by `DRIFTPROOF_REGISTRY`, can point that call at another address, and the list can name another key variable. `CLAUDE_PROVIDER` set to `api` sends the calls to the Anthropic API, or to `ANTHROPIC_BASE_URL` if you set it, with your `ANTHROPIC_API_KEY`. A `judge_model` in a `.driftproofrc` in the folder you run from chooses the grader.
- Driftproof's own code makes no other network call: no telemetry, no update check, no upload. What `claude -p` and `codex` themselves connect to is up to them and your settings.
