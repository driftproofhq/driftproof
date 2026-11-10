#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The "Run suite and emit receipt" step of action.yml (spec 023).
#
# Inputs arrive as INPUT_SKILL_DIR, INPUT_MODELS, INPUT_MAX_USD, INPUT_MAX_CALLS,
# INPUT_SUITE, INPUT_PLACEBO, INPUT_FAIL_ON_REGRESSION, INPUT_FAIL_ON_UNDERPOWERED,
# set by the step's env: block from
# ${{ inputs.* }}.
# GITHUB_ACTION_PATH, RUNNER_TEMP and GITHUB_OUTPUT are the default variables
# GitHub sets for a composite action step. Each value is referenced only as a
# double-quoted variable and reaches bin/driftproof as one argv element.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env GITHUB_ACTION_PATH RUNNER_TEMP GITHUB_OUTPUT \
  INPUT_SKILL_DIR INPUT_MODELS INPUT_MAX_USD INPUT_MAX_CALLS INPUT_FAIL_ON_REGRESSION
# Spec 072: an unset INPUT_FAIL_ON_UNDERPOWERED reads as the input's declared default. GitHub
# always sets it from action.yml's env: block; only a caller outside GitHub leaves it unset.
: "${INPUT_FAIL_ON_UNDERPOWERED=false}"
# Optional Action defaults also apply to direct callers of this script.
: "${INPUT_SUITE=}"
: "${INPUT_PLACEBO=false}"
: "${INPUT_COMPARE_WITH_BASE=false}"

# Validated before anything is created or started (AC-3): a bad value fails
# here, with a message naming the input, before any model call is projected.
validate_skill_dir "$INPUT_SKILL_DIR"
validate_models "$INPUT_MODELS"
validate_max_usd "$INPUT_MAX_USD"
validate_max_calls "$INPUT_MAX_CALLS"
validate_bool fail-on-regression "$INPUT_FAIL_ON_REGRESSION"
validate_bool fail-on-underpowered "$INPUT_FAIL_ON_UNDERPOWERED"
validate_bool placebo "$INPUT_PLACEBO"
validate_bool compare-with-base "$INPUT_COMPARE_WITH_BASE"
if [ -n "$INPUT_SUITE" ]; then validate_suite "$INPUT_SUITE"; fi
COMPARE_ELIGIBLE=false
if [ "$INPUT_COMPARE_WITH_BASE" = true ] && [ "${GITHUB_EVENT_NAME:-}" = pull_request ] && [ -f "$INPUT_SKILL_DIR" ] && [ -n "$INPUT_SUITE" ]; then
  validate_base_ref "${GITHUB_BASE_REF:-}"
  COMPARE_ELIGIBLE=true
fi

# Issue 762 (EXT-8). With no key the CLI's isolation check would refuse and advise a flag this Action
# cannot pass. A pull request from a fork never receives secrets, so it reached that on every run.
# Checked after every input, so a bad input is still named, and before anything is created.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ "${DRIFTPROOF_STUB:-}" != 1 ]; then
  die "this Action needs an API key secret: set the api-key input from a repository secret. Pull requests from forks do not receive secrets, so they cannot be measured here."
fi

# SPEC 050 (AC-5). A directory made for THIS invocation, after every input has been
# validated, so a refused input still creates nothing. Until this it was the fixed
# "$RUNNER_TEMP/driftproof-receipts", shared by every Driftproof step in a job: the
# second step's decision read the first step's receipts, and a skill that regressed
# was reported with another skill's pass (an outside correctness audit, finding 2;
# spec 030's F-1). Its basename names the artifact, so two invocations upload two.
OUT="$(mktemp -d "$RUNNER_TEMP/driftproof-receipts.XXXXXX")"
# SPEC 069 (spec 062's F-3). The run starts in an EMPTY directory made for this
# invocation, not in the checkout. The CLI reads the working directory's
# .driftproofrc, and the checkout's root is pull-request content, so a pull
# request could add a root rc setting max_cases, samples or judge_model and
# narrow the run that measures it. From here no working-directory rc is read;
# spec 062 already ignores those three keys in the skill directory's rc. The
# skill directory is made absolute first, so it is the one the input named.
case "$INPUT_SKILL_DIR" in
  /*) SKILL_DIR="$INPUT_SKILL_DIR" ;;
  *) SKILL_DIR="$PWD/$INPUT_SKILL_DIR" ;;
esac
# Resolve before changing to the isolated run directory, as for SKILL_DIR.
EXTRA_ARGS=()
if [ -n "$INPUT_SUITE" ]; then
  case "$INPUT_SUITE" in
    /*) SUITE="$INPUT_SUITE" ;;
    *) SUITE="$PWD/$INPUT_SUITE" ;;
  esac
  EXTRA_ARGS+=(--suite "$SUITE")
fi
if [ "$INPUT_PLACEBO" = true ]; then EXTRA_ARGS+=(--placebo); fi
RUN_CWD="$(mktemp -d "$RUNNER_TEMP/driftproof-cwd.XXXXXX")"
BASE_TMP=''
COMPARE_READING=''
# Issue 762 (EXT-4). The base is fetched into this ref, and the step leaves the checkout as it found it.
BASE_REF=refs/driftproof/base
SHALLOW_SAVED=''
restore_checkout() {
  [ -n "$BASE_TMP" ] || return 0
  git update-ref -d "$BASE_REF" >/dev/null 2>&1 || true
  if [ -f "$SHALLOW_SAVED" ]; then cp -- "$SHALLOW_SAVED" "$(git rev-parse --git-path shallow)" || true; fi
}
trap 'restore_checkout; rm -rf -- "$RUN_CWD" "$BASE_TMP"' EXIT
# Only a file with explicit tasks can use the revision comparison.
COMPARE=false
if [ "$INPUT_COMPARE_WITH_BASE" = true ]; then
  if [ "$COMPARE_ELIGIBLE" != true ]; then
    printf '%s\n' '::notice title=Driftproof::Base comparison needs a pull request, a Markdown rules file and a suite. Running the new file only.'
  else
    BASE_TMP="$(mktemp -d "$RUNNER_TEMP/driftproof-base.XXXXXX")"
    REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    FILE_ROOT="$(git -C "$(dirname "$SKILL_DIR")" rev-parse --show-toplevel 2>/dev/null || true)"
    if [ -z "$REPO_ROOT" ] || [ "$FILE_ROOT" != "$REPO_ROOT" ]; then
      printf '%s\n' '::notice title=Driftproof::The rules file is outside this checkout. Running the new file only.'
    else
      BASE_PREFIX="$(git -C "$(dirname "$SKILL_DIR")" rev-parse --show-prefix)"
      BASE_PATH="$BASE_PREFIX$(basename "$SKILL_DIR")"
      # --depth would make a full-history checkout shallow, so it is passed only to a checkout that
      # already is. There it can still cut history at the base tip, so the shallow file is put back.
      # --refmap= keeps git from also moving origin/<base>.
      DEPTH_ARGS=()
      if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
        DEPTH_ARGS=(--depth=1)
        SHALLOW_SAVED="$BASE_TMP/shallow"
        cp -- "$(git rev-parse --git-path shallow)" "$SHALLOW_SAVED"
      fi
      if ! git fetch --no-tags --no-write-fetch-head --refmap= "${DEPTH_ARGS[@]}" origin "+refs/heads/$GITHUB_BASE_REF:$BASE_REF" >/dev/null 2>&1; then
        printf '%s\n' '::notice title=Driftproof::The base branch could not be fetched. Running the new file only.'
      elif ! git --literal-pathspecs ls-tree "$BASE_REF" -- "$BASE_PATH" | grep -qE '^100(644|755) blob '; then
        printf '%s\n' '::notice title=Driftproof::The base branch has no regular rules file at this path. Running the new file only.'
      elif ! git show "$BASE_REF:$BASE_PATH" > "$BASE_TMP/base.md" 2>/dev/null; then
        printf '%s\n' '::notice title=Driftproof::The base branch has no version of this rules file. Running the new file only.'
      elif cmp -s -- "$BASE_TMP/base.md" "$SKILL_DIR"; then
        printf '%s\n' '::notice title=Driftproof::The old and new rules have the same bytes. Running the new file only.'
      else
        COMPARE=true
      fi
      # The base is read, so the checkout goes back now, before the long run. A runner's cancel can
      # end this step before the EXIT trap runs; the trap is only the backstop for the fetch itself.
      restore_checkout
    fi
  fi
fi

# A key selects the metered Messages API; without one the run uses the
# default cli surface (or the offline stub when DRIFTPROOF_STUB=1).
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then export CLAUDE_PROVIDER=api; fi
fence_begin
if [ "$COMPARE" = true ]; then
  if ! ( cd "$RUN_CWD" && node "$GITHUB_ACTION_PATH/bin/driftproof" compare "$BASE_TMP/base.md" "$SKILL_DIR" \
    --models "$INPUT_MODELS" --max-usd "$INPUT_MAX_USD" \
    --max-calls "$INPUT_MAX_CALLS" --out "$OUT" "${EXTRA_ARGS[@]}" ); then
    fence_end
    die "run: driftproof compare refused or failed; see the CLI diagnostic above"
  fi
  fence_end
  # Keep both versions in the artifact. Existing decision readers read only
  # the root directory, which must contain the new version's receipts alone.
  mkdir "$OUT/base"
  for base_receipt in "$OUT"/compare-A-*.json; do
    mv -- "$base_receipt" "$OUT/base/"
  done
  COMPARE_READING="$(node - "$OUT/compare.md" <<'NODE_COMPARE'
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const headlines = [];
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith('These tasks, this judge, this day:')) continue;
  let j = i - 1;
  while (j >= 0 && !lines[j].trim()) j--;
  if (j < 0) throw new Error('Comparison headline is missing');
  headlines.push(lines[j]);
}
if (!headlines.length) throw new Error('Comparison caveat is missing');
process.stdout.write(headlines.join(' '));
NODE_COMPARE
)"
else
  if ! ( cd "$RUN_CWD" && node "$GITHUB_ACTION_PATH/bin/driftproof" run "$SKILL_DIR" \
  --models "$INPUT_MODELS" --max-usd "$INPUT_MAX_USD" \
  --max-calls "$INPUT_MAX_CALLS" --out "$OUT" "${EXTRA_ARGS[@]}" ); then
    fence_end
    die "run: driftproof run refused or failed; see the CLI diagnostic above"
  fi
  fence_end
fi
# An omitted step output resolves to empty in the declared composite output.
# Keep the default shell output keys unchanged for existing local callers.
if [ "$INPUT_COMPARE_WITH_BASE" = true ]; then gh_output compare_reading "$COMPARE_READING"; fi
# SPEC 030 (AC-1). The decision is taken over EVERY receipt this run produced,
# and the receipt DIRECTORY is what reaches the enforcement step. Until this,
# the line below was
#
#   RECEIPT="$(ls "$OUT"/*.json | grep -v '\.summary\.' | grep -v 'badge\.json' | head -1)"
#
# and everything downstream read that one file. Receipts are named
# <skill>-<model>-<date>.json, so `ls` ordered them by model id and the model
# that decided the job was whichever one sorted first: a regression on
# claude-sonnet-5 beside a pass on claude-haiku-4-5 exited 0 with a brightgreen
# badge. `driftproof decide` reads the set against the models that were asked
# for, so a model with no receipt is a row, not an omission (AC-2).
gh_output receipts_dir "$OUT"
gh_output artifact_name "$(basename "$OUT")"
# Outputs: every entry in the heredoc form with a random delimiter, from the
# shell helper and from the decision writer alike (spec 023 AC-4). A model_id
# carrying a line break makes the writer throw, which fails this step under
# set -e with nothing appended.
node "$GITHUB_ACTION_PATH/bin/driftproof" decide "$OUT" --models "$INPUT_MODELS" \
  --github-output >> "$GITHUB_OUTPUT"
# The badge over the set: the worst decision, naming the model it came from
# (AC-3). badge.json lands in the same directory, and is excluded from the
# receipt set by the reader rather than by a grep here.
node "$GITHUB_ACTION_PATH/bin/driftproof" decide "$OUT" --models "$INPUT_MODELS" \
  --badge "$OUT/badge.json"
# One row per requested model, on the job summary (AC-4). GITHUB_STEP_SUMMARY is
# set by GitHub for every step; when it is absent (a local run of these bytes)
# the table is simply not written, and nothing else changes.
# SPEC 128 (AC-11). The summary opens with the plain sentence, and its last clause
# says whether the job fails, so the call passes the two fail-on inputs the
# enforcement step passes: the sentence and the exit are read by one rule.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  node "$GITHUB_ACTION_PATH/bin/driftproof" decide "$OUT" --models "$INPUT_MODELS" \
    --summary "$GITHUB_STEP_SUMMARY" \
    --fail-on-regression "$INPUT_FAIL_ON_REGRESSION" --fail-on-underpowered "$INPUT_FAIL_ON_UNDERPOWERED"
fi
