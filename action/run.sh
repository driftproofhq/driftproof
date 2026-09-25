#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The "Run suite and emit receipt" step of action.yml (spec 023).
#
# Inputs arrive as INPUT_SKILL_DIR, INPUT_MODELS, INPUT_MAX_USD, INPUT_MAX_CALLS,
# INPUT_FAIL_ON_REGRESSION, set by the step's env: block from ${{ inputs.* }}.
# GITHUB_ACTION_PATH, RUNNER_TEMP and GITHUB_OUTPUT are the default variables
# GitHub sets for a composite action step. Each value is referenced only as a
# double-quoted variable and reaches bin/driftproof as one argv element.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env GITHUB_ACTION_PATH RUNNER_TEMP GITHUB_OUTPUT \
  INPUT_SKILL_DIR INPUT_MODELS INPUT_MAX_USD INPUT_MAX_CALLS INPUT_FAIL_ON_REGRESSION

# Validated before anything is created or started (AC-3): a bad value fails
# here, with a message naming the input, before any model call is projected.
validate_skill_dir "$INPUT_SKILL_DIR"
validate_models "$INPUT_MODELS"
validate_max_usd "$INPUT_MAX_USD"
validate_max_calls "$INPUT_MAX_CALLS"
validate_bool fail-on-regression "$INPUT_FAIL_ON_REGRESSION"

# SPEC 050 (AC-5). A directory made for THIS invocation, after every input has been
# validated, so a refused input still creates nothing. Until this it was the fixed
# "$RUNNER_TEMP/driftproof-receipts", shared by every Driftproof step in a job: the
# second step's decision read the first step's receipts, and a skill that regressed
# was reported with another skill's pass (an outside correctness audit, finding 2;
# spec 030's F-1). Its basename names the artifact, so two invocations upload two.
OUT="$(mktemp -d "$RUNNER_TEMP/driftproof-receipts.XXXXXX")"
# A key selects the metered Messages API; without one the run uses the
# default cli surface (or the offline stub when DRIFTPROOF_STUB=1).
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then export CLAUDE_PROVIDER=api; fi
node "$GITHUB_ACTION_PATH/bin/driftproof" run "$INPUT_SKILL_DIR" \
  --models "$INPUT_MODELS" --max-usd "$INPUT_MAX_USD" \
  --max-calls "$INPUT_MAX_CALLS" --out "$OUT"
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
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  node "$GITHUB_ACTION_PATH/bin/driftproof" decide "$OUT" --models "$INPUT_MODELS" \
    --summary "$GITHUB_STEP_SUMMARY"
fi
