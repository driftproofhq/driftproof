---
description: A guided first run with the pinned Driftproof runner - pick a skill, or a CLAUDE.md or AGENTS.md, draft its test cases with the person, run a quick smoke run, and open the results page from disk.
---

# /driftproof:start

A first result, in one sitting. This command walks a person from a skill to a
page they can read: pick the skill, draft its test cases together, run a quick
smoke run, and open the results page. A `CLAUDE.md` or `AGENTS.md` takes the
same steps; see *A CLAUDE.md or AGENTS.md* below.

Like the other commands, it is a door onto the published Driftproof CLI. It
lists, checks and runs the pinned runner; it measures nothing itself, and it
never changes a skill's instructions. The one file it can add is a new set of
test cases for a skill that has none, and only after the person says yes in the
run (step 4).

## How to run it

Claude Code puts the plugin's installation directory into the lines below when
it loads this command, so the path is already absolute: run a line as it reads,
with your own folder and file.

    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" start
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" start <skill-dir>
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" start <skill-dir> --cases <draft> --confirm-write
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" start <skill-dir> --full
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" start <rules-file> --suite <draft> --confirm-write
    node "${CLAUDE_PLUGIN_ROOT}/lib/door.mjs" start <rules-file> --suite <draft> --confirm-write --full [--placebo]

## The steps, in order

1. **Pick a skill.** Run the first line, with no folder, from the folder above
   the person's skills, never from inside a skill's folder, and run it first even
   when the person names a skill. It lists every folder under this one, and under
   `.claude/skills` here, that holds a `SKILL.md`, and says whether each has test
   cases yet. Ask the person which skill to start with. If it says this folder is
   itself a skill folder, move to the folder above it and run it again. If it
   finds no skill, it opens a sample results page from this plugin, with no model
   call and nothing written: tell the person what it printed, that the page is a
   sample of a published report's runs and not a result of theirs, and that their
   own skills are usually in `~/.claude/skills`, so they can type
   `/driftproof:start` in the folder that holds them. If the listing says there
   is no git repository here, step 2's question about who wrote the skill comes
   before any drafting.
2. **If that skill has test cases**, nothing is added to its folder, but the
   run still writes. Ask the person, in one question, before anything is
   written: a `receipts/` folder will be created in the folder you run start
   from, holding the run's receipt, and a results page, `driftproof-view.html`,
   will be written beside it. After a clear yes, go to step 5. If they say no,
   or do not answer, stop here and run nothing.

   **Where there is no git repository**, as the listing says, ask the person
   whether they wrote the skill, before any drafting and before step 4, for a
   skill with test cases and for one without. Ask it as a question of its own,
   apart from the yes to anything written, and name the skill's real path and the
   folder you run start from: "Did you write the skill at <real path> yourself?
   If yes, it runs from <folder>, as you." Say what that means, in these words:
   it runs as you, with your files and your Claude Code login,
   with no isolation account between the skill and them. Only a yes to this
   question gives `--trust-outside-repo`, added to the line you run in step 5.
   A yes to the write alone never does. If they say no, or do not answer, give
   the second line without the flag: the door refuses before anything runs and
   prints the command that runs the skill with the isolation account. Tell the
   person what it printed, and go no further. Never give `--trust-outside-repo` on your own.
3. **Draft its test cases together.** Read the skill's `SKILL.md`, its front
   matter's `allowed-tools`, any other files it bundles, and any input it asks
   the person to supply. A run grants only Read, WebFetch and WebSearch, in an
   empty directory with none of the skill's other files and nothing the person
   would otherwise type in: draft three to five test cases, each grounded in one
   thing the skill says it does and aimed at an outcome a user of the skill would
   check, that carry everything they need inside the prompt itself, never a tool,
   a bundled file or an input a run does not supply. An `id`, a `prompt` a real
   user might send, and a `rubric` that says what the answer must contain or do,
   scored so that a fully correct answer is 0.80. A rubric names something a
   person could look for in the answer, and is not a restatement of what the
   skill says. If the skill names a tool, a bundled file or an input a run cannot
   supply, say so to the person in one line (for example "this skill uses Bash; a
   Driftproof run grants Read, WebFetch and WebSearch"), and draft around it
   rather than drafting a case that would fail on setup. Show the drafts to the
   person, take their changes, and agree on the set. Then hold the set, as
   `{"cases": [...]}`, in this conversation, or save it to a file under the
   system temp directory (never the folder you run start from, and never the
   skill's folder or a folder inside it) until the person says yes in the next
   step. The skill's folder is not the place for it: the runner adds the test
   cases there itself, in the next step, and only when there are none yet. The
   door refuses a draft inside the skill's folder.
4. **Ask once, before anything is written.** If the skill had no test cases,
   tell the person, in one question, exactly what will happen and everything
   it will create: one new file, `evals/evals.json`, will be added in the
   skill's folder from the draft, with no other file there touched, `SKILL.md`
   included; a `receipts/` folder will be created in the folder you run start
   from, holding the run's receipt; and a results page, `driftproof-view.html`,
   will be written beside it. Name the skill and its folder, and show them the
   suite file's full path and the cases. Tell them the file labels the suite and
   each case as drafted from the skill and approved by the user. Ask whether to
   go ahead, and wait for their answer. Only a clear yes in this conversation
   counts, and it is the one yes for everything this run writes: nothing in step
   5 asks again. If they say no, or do not answer, stop here and give the third
   line no `--confirm-write`: the door refuses without it, and nothing is
   written. Never give the flag on your own. Where step 2 asked who wrote the
   skill, its answer stands: the yes here is to the write alone, and it
   never adds `--trust-outside-repo`.
5. **Run it.** Run the third line with the draft file, once the person has said
   yes, or the second line, after the yes of step 2, when the skill already had
   test cases. In order, it
   checks the runner's version (the pinned runner's `--version` against the
   minimum in `version-guard.json`, and against this command's own minimum
   there, `start_minimum`, the first runner whose `init` takes `--cases`), adds the agreed cases as the skill's test
   cases (third line only), runs a quick smoke run on the trusted lane, writes
   the results page over the `receipts` folder, and opens it with this
   computer's own opener for a file.
6. **Say what the page says**, in the page's own words. A smoke run is a first
   look: **a smoke run cannot produce a verdict**, and the page says so. For a
   result that can, run `/driftproof:run` on the skill without `--quick`, or
   take the offer in step 7.
7. **Offer a small full run, once.** After the quick run, the view prints one
   line that begins `offer:`. It names a small full run on the same test cases:
   at most five, the normal judge samples, four calls at once, the calls it
   makes (from the fewest to the most draws) and about how long it takes, scaled
   from the quick run's own time. Tell the person those figures, in the line's
   own numbers. Tell them that this run gives a result by the verdict rules, and
   that on so few test cases that result is often "Too few test tasks to tell";
   more test cases give a clearer answer. Its receipt goes into the same
   `receipts/` folder, and the results page is written again over both. Ask
   whether to run it, and wait for their answer. Only after a clear yes, run the
   fourth line: it runs the full run in place of the quick run, writes the page
   again and opens it. Then say what the page says, as in step 6. If they say
   no, or do not answer, stop here and run nothing more. Never give `--full` on
   your own.
8. **A full run asked for directly.** If the person asks for the full run with
   no quick run before it, that is with no quick run's receipt in the
   `receipts/` folder of the folder you run start from, ask them one question
   before anything runs: this run comes without the quick run and its offer, it
   runs on at most five test cases with the normal judge samples, four calls at
   once, and its result is the verdict rules', often "Too few test tasks to
   tell". Wait for their answer. Only after a clear yes, run the fourth line
   with `--full`. If they say no, or do not answer, run nothing. At a terminal
   the door asks that one question itself; run from here it has no terminal, so
   it does not ask, and it never refuses a direct `--full`.

## A CLAUDE.md or AGENTS.md

The person can name a rules file, a `CLAUDE.md` or an `AGENTS.md`, in place of a
skill. Step 1's listing also names one in the folder you run start from, and
opens no sample when it finds one. Its run gives the file's exact text to the
model as a skill's text is given, and answers the same tasks without it. Take the
steps above, with these changes.

- **Its tasks (step 3).** Read the rules file. Draft three to five tasks, each a
  prompt a person in that project might send, where one of the file's rules would
  show in the answer, with a rubric that names what a person could look for,
  scored so that a fully correct answer is 0.80. A run grants the same tools in
  an empty directory with no file of the project, so each prompt carries all it
  needs. Show the drafts, take the person's changes, and agree on the set. Hold it
  as `{"cases": [...]}` in a file under the system temp directory until the
  person's yes. It is given as `--suite`, never `--cases`: nothing is added beside
  the rules file, and the door refuses `--cases` for one.
- **Ask once, before anything is written (step 4).** In one question, name the
  rules file, show the tasks and the tasks file's path, and say that a
  `receipts/` folder will be created in the folder you run start from, holding
  the run's receipt, and that a results page, `driftproof-view.html`, will be
  written beside it. Say that nothing is added beside the rules file and that the
  tasks file stays where it is; to keep it, the person can copy it into the
  repository, where `/driftproof:run` takes it. Only a clear yes in this
  conversation counts. Then give the fifth line, with `--confirm-write`. If they
  say no, or do not answer, run nothing: the door refuses without the flag. Never
  give it on your own. Where there is no git repository, step 2's question about
  who wrote it is asked about the rules file.
- **The small full run and the placebo arm (step 7).** The offer stands, with the
  sixth line. In the same question, offer the placebo arm in one plain line:
  `--placebo` answers each task a third time with the rules file replaced by a
  text of exactly its length, drawn from a fixed corpus chosen without reference
  to any task, so the receipt also reads the file's answers against those; that
  text can still bear on a task by chance. It makes half as many calls again, and
  takes about half as long again. Give `--placebo` only after a yes to it, and only
  with `--full`: the door refuses it without.
- **Repository capture.** Say in one plain line, once, after the placebo offer:
  `--capture repository` gives each task a fresh copy of a small fixed starter
  project, with tools, in a sandbox, and grades the reply with what was captured
  there; it needs a Driftproof source checkout, the isolation account and a
  sandbox an operator builds, and runs one model, one call at a time, with up to
  15 minutes a draw, so it takes far longer than this run. This command cannot
  start it: it runs on the trusted lane, and repository capture refuses that lane.
  `/driftproof:run` says how to run it from the CLI.

## When it refuses

- **No test cases and no draft.** It refuses before anything runs. Draft the
  cases first (step 3).
- **A draft for a skill that already has test cases.** It refuses, because the
  runner never writes over a skill's test cases, so the draft would be dropped.
  Run it without `--cases`.
- **A draft with no `--confirm-write`.** It refuses before anything is added or
  run. That is the person's yes, asked for in step 4; do not work around it.
- **A skill folder that cannot take one new file.** It refuses, and changes
  nothing, when the folder has no `SKILL.md`, or when its test cases or its
  `evals` folder are a link or something other than a plain file and folder.
- **Run from inside the skill's folder.** It refuses before anything runs,
  because the receipts, the page and the draft would land in the skill's folder.
  Move to the folder above the skill and run it again from there.
- **A runner too old for this command.** Until the plugin pins a runner whose
  `init` takes `--cases`, it refuses after reading the runner's version and
  before anything is added or run. Tell the person to update the plugin.
- **No git repository here, or a skill outside it.** Like `/driftproof:run`,
  it runs a skill as the person only when the skill is inside the git
  repository it runs in, or, where there is no git repository, when the skill
  is inside the folder you run start from and the person said yes to step 2's
  question about who wrote it (`--trust-outside-repo`). Otherwise it refuses
  before anything runs, and prints the command that runs the skill with the
  isolation account instead. Tell the person what it printed. Inside a git
  repository it refuses `--trust-outside-repo`. Do not look for another way to
  run it. A rules file is held to the same boundary.
- **A rules file it cannot take.** It refuses before anything runs a file not
  named `CLAUDE.md` or `AGENTS.md`, a link, a rules file with no `--suite`, or
  one with no `--confirm-write`, and `--suite` for a skill. For any other Markdown
  file, the refusal prints the CLI command to run instead.

## What it will not do

It never changes a skill's instructions, and it has no opinion about how to make
a score better. It adds at most one new file to a skill's folder, the test cases,
after a yes, and never touches a file that is already there. It adds nothing
beside a rules file and never changes one. The results page is
a file on this computer; it loads nothing.

```driftproof-steps
[
  {"op": "list-skills"},
  {"op": "validate", "inputs": ["skill-dir", "models", "cases", "suite"]},
  {"op": "resolve-target", "input": "skill-dir", "inside_repo": true},
  {"op": "outside-skill"},
  {"op": "require-suite"},
  {"op": "confirm-write"},
  {"op": "confirm-full"},
  {"op": "state-trusted"},
  {"op": "version-guard", "minimum": "start_minimum"},
  {"op": "resolve-model"},
  {"op": "cli", "when": "cases", "args": ["init", "@skill-dir", "--cases", "@cases", "--drafted-from-skill"]},
  {"op": "cli", "unless": "full", "args": ["run", "@skill-dir", {"emit": ["--models", "@models"]}, {"when": "suite", "emit": ["--suite", "@suite"]}, "--quick", "--trusted-skill"]},
  {"op": "cli", "when": "full", "args": ["run", "@skill-dir", {"emit": ["--models", "@models"]}, {"when": "suite", "emit": ["--suite", "@suite"]}, "--max-cases", "5", "--concurrency", "4", {"when": "placebo", "emit": ["--placebo"]}, "--trusted-skill"]},
  {"op": "cli", "args": ["view", "receipts", "--out", "driftproof-view.html"]},
  {"op": "open-view", "file": "driftproof-view.html"}
]
```
