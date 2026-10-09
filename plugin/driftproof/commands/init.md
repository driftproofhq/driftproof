---
disable-model-invocation: true
description: Lead a skill that exists into the guided first run (draft its test cases from the skill with the person, add them after a yes, run a quick first look and open the results page), or scaffold a Driftproof evaluation suite for a new skill, with the pinned CLI and nothing else.
---

# /driftproof:init

Set up a skill's measurement suite in this repository. For a skill the person already
has, that is the guided first run: draft test cases from the skill with them, add them
after their yes, and show a first result. For a new skill, it is a scaffold.

This is a door onto the published Driftproof CLI. It runs the CLI at the version this
plugin pins, and it does nothing else: it fetches nothing and reads nothing it was not
given. The CLI is the product and it runs on every surface Driftproof measures, while
the plugin is one install path for Claude Code users.

## How to run it

Run the door script the plugin ships. Claude Code puts the plugin's installation
directory into the lines below when it loads this command, so the path is already
absolute: run a line as it reads, with your own `<dir>` and draft.

    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" init <dir>
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" init <dir> --cases <draft> --confirm-write
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" init <dir> --confirm-write

`<dir>` is a skill folder that already holds its `SKILL.md`, or a folder that does not
exist yet. The first line on a folder that does not exist is the scaffold. The second
line is the guided first run. The third is the placeholder route, second to the guided
run. A folder that exists and has no `SKILL.md` is covered below.

## A skill that exists: the guided first run

A folder that holds a `SKILL.md` is a skill the person has. Do not scaffold it. Lead
into the guided first run, which is `/driftproof:start`'s: follow `start.md`'s steps 3 to
6 for this skill, with the second line above in place of its third.

1. **Draft the test cases from the skill, with the person.** Read the skill's
   `SKILL.md`, its front matter's `allowed-tools`, any other files it bundles, and any
   input it asks the person to supply. A run grants only Read, WebFetch and WebSearch,
   in an empty directory with none of the skill's other files and nothing the person
   would otherwise type in: draft three to five test cases, each aimed at an outcome a
   user of the skill would check, that carry everything they need inside the prompt
   itself, never a tool, a bundled file or an input a run does not supply. An `id`, a
   `prompt` a real user might send, and a `rubric` that says what the answer must contain
   or do, scored so that a fully correct answer is 0.80. A rubric states what a person
   could look for in the answer, and is not a restatement of what the skill says. If the
   skill names a tool, a bundled file or an input a run cannot supply, say so to the
   person in one line (for example "this skill uses Bash; a Driftproof run grants Read,
   WebFetch and WebSearch"), and draft around it rather than drafting a case that would
   fail on setup. Show the drafts, take the person's changes, and agree on the set. Then
   hold the set, as `{"cases": [...]}`, in this conversation, or save it to a file under
   the system temp directory (never the folder you run from, and never the skill's
   folder or a folder inside it) until the person says yes in the next step. Run from the
   folder above the skill.
2. **Ask once, before anything is written.** Name the skill and its folder, and tell the
   person, in one question, everything this run will create: one new file,
   `<dir>/evals/evals.json` (give its full path), added from the draft, with nothing else
   in the folder touched, `SKILL.md` included; a `receipts/` folder created in the folder
   you run from, holding the run's receipt; and a results page, `driftproof-view.html`,
   written beside it. Tell them the suite file labels itself and each case as drafted
   from the skill and approved by the user. Show the cases and ask whether to go ahead.
   Only a clear yes in this conversation counts, and it is the one yes for everything
   this run writes: nothing in step 3 asks again. If they say no, or do not answer, stop
   and give no flag: the door refuses without `--confirm-write`, and nothing is written.
   Never give the flag on your own.
3. **Run it.** After the yes, give the second line, with the draft and
   `--confirm-write`. It adds the cases as the skill's test cases, runs a quick run on
   the trusted lane, writes the results page and opens it. If the skill already has test
   cases, this command is not the way to their quick run: the first line is refused for
   a skill that exists, and `/driftproof:start <dir>` runs them and adds nothing.
4. **Say what the page says**, in the page's own words. A quick run is a first look: **a
   smoke run cannot produce a verdict**, and the page says so. For a result that can,
   run `/driftproof:run` on the skill without `--quick`.

The door takes the skill from the folder you run from, inside a git repository, as
`/driftproof:start` does, and refuses with the reason when it cannot; its refusal may
name `/driftproof:run <skill> --trust-outside-repo`, which is `/driftproof:run`'s to take
after it asks. A runner older than `start_minimum` in `version-guard.json` is refused
with both versions named, before anything is written.

The placeholder route is for a person who would rather write the cases by hand. For it,
**ask the person first**: name the skill and its folder, tell them that one new file,
`<dir>/evals/evals.json` (give its full path), will hold three placeholder example cases
for them to replace, that nothing else in the folder is touched, `SKILL.md` included,
and ask whether to go ahead. Only a clear yes in this conversation counts. After a yes,
give the third line, with `--confirm-write`. Never give the flag on your own. The door
says before it runs that it will add the file if none is there, and after it runs
whether the file was added or nothing was. Tell the person which it said.

## A new skill: the scaffold

A folder that does not exist is a new skill. Before running the first line, ask the
person, in one question, before anything is written: name the folder (give its full
path) and the three files it will create there, `SKILL.md`, `evals/evals.json` (three
example cases) and `.driftproofrc`, and ask whether to go ahead. Only a clear yes in
this conversation counts. If they say no, or do not answer, stop and run nothing. The
door takes no flag for this route: the yes is asked for here, in words, and the door
refuses `--confirm-write`, `--cases` and `--models` there. It writes nothing outside
that folder, and will not write over something that is already there.

A folder that exists and holds no `SKILL.md` is not a skill folder yet, and it is not a
new folder either: this command is for a folder that does not exist, or a skill that
does. Do not point it at one, and do not give `--confirm-write` for it. The door does
not refuse the first line there (it never did), so say so to the person and ask them to
name a new folder instead.

## What it will do, in order

1. Check `<dir>` against the shipped input contract in `input-contract.json`. A path
   carrying a control character is refused here, before anything runs.
2. For a skill folder that exists with a draft, take the steps of `/driftproof:start`:
   the checks, the version guard, the new file, the quick run and the page. A draft or
   a model given anywhere else is refused.
3. For a skill folder that exists without a draft, require the person's yes
   (`--confirm-write`). The door refuses before anything is spawned or written when it
   has none, whether or not the skill already has a suite. A skill that already has a
   suite reaches its quick run through `/driftproof:start`, and not through this
   command without a flag.
4. Read the resolved runner version with `--version` and compare it against the minimum
   in `version-guard.json`. A runner older than that minimum is refused with both
   versions named. For a skill folder that exists the runner must also be one that adds
   only the test cases there, which `version-guard.json` records as `start_minimum`.
   This probe writes nothing and spends nothing.
5. Run the pinned CLI's `init` once.

## What it will not do

It measures and never changes a skill's instructions. In a skill folder that exists,
`SKILL.md` is left exactly as it was, nothing is overwritten, and the one file it adds
is a new `evals/evals.json`, only where none is there. In a new folder, everything it
creates goes into that folder. The cases it adds are the person's to change afterwards,
by hand or by asking Claude in the ordinary way. This command has no opinion about how
to make a score better and offers none.

```driftproof-steps
[
  {"op": "validate", "inputs": ["skill-dir"], "target_exists": false},
  {"op": "guided-existing"},
  {"op": "resolve-target", "input": "skill-dir", "inside_repo": false},
  {"op": "confirm-add"},
  {"op": "version-guard", "minimum": "start_minimum", "only_adding": true},
  {"op": "cli", "args": ["init", "@skill-dir"]},
  {"op": "report-add"},
  {"op": "say", "text": "scaffolded. Nothing outside that directory was written.", "only_new": true}
]
```
