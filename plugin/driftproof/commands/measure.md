---
disable-model-invocation: true
description: Open Driftproof's free Measure a skill request form on GitHub, filled in with the skill or rules file you name. Nothing is sent unless you submit the form yourself.
---

# /driftproof:measure

Ask Driftproof to measure a skill or rules file for free on the newest Claude models and publish
the result. This command opens the request form, filled in with the skill you name.
It sends nothing: you read the form on GitHub and submit it, or close it.

## How to run it

Form in use: npx.

Run the line exactly as it reads, with your own arguments. Do not drop its `cd` or its `--prefix`, and do not add anything before it. Starting npm in the plugin's own folder is what keeps a package or a program planted in the project from running, and these words are all that holds it. Two gaps remain in this form: a program in a parent folder's `node_modules/.bin` can run before the runner, and the line you run can be altered. The installed form is the safer alternative, because npm starts nothing and the first of those gaps closes. If a person has installed this version of the runner, each line can be written instead in the installed form:

    driftproof door --pin 0.31.0 measure <path>

If the runner prints `unknown command: door`, it is older than this plugin. Tell the person to install the version the line names.
Claude Code puts the plugin's installation directory into the line below when
it loads this command, so the path is already absolute: run the line as it reads,
with your own `<path>`, a skill folder or a supported rules file.

    (cd "${CLAUDE_PLUGIN_ROOT}" && npx --prefix "${CLAUDE_PLUGIN_ROOT}" driftproof@0.31.0 door --pin 0.31.0 --from "$OLDPWD" measure <path>)

If the person gave no path, use the skill or rules file they just ran. If there is none, ask
which one they mean.

## What it will do, in order

1. Check the file or folder against the runner's contract in `input-contract.json`.
2. Read the resolved runner version with `--version` and compare it against the
   minimum in `version-guard.json`.
3. Read the skill's name from its `SKILL.md`, its path in this repository, and
   the repository's address when `origin` is on github.com. Only the owner and
   the repository name are taken from `origin`. A folder with no `SKILL.md` is
   refused, and nothing is opened. A supported rules file needs no SKILL.md:
   the form carries its exact path. The supported kinds come from the runner,
   including Claude, Codex, Cursor, Copilot and Windsurf rules files.
4. Print the form's link and open it in the browser with this computer's own
   opener. Where there is no opener, it prints the link to open by hand.

Tell the person what the runner printed: which fields are filled in, which are
blank, and that nothing has been sent. Then stop. Do not ask them to submit it.

## What it sends

Nothing. The command makes no network call of its own. The browser loads
GitHub's form with the filled-in fields in the link, and a request exists only
if the person submits the form. If the file is private, it should not be
submitted: the form says what to do instead.

## What it will not do

It never changes a skill's instructions, and it writes no file.
