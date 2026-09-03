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

OUT="$RUNNER_TEMP/driftproof-receipts"
mkdir -p "$OUT"
# A key selects the metered Messages API; without one the run uses the
# default cli surface (or the offline stub when DRIFTPROOF_STUB=1).
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then export CLAUDE_PROVIDER=api; fi
node "$GITHUB_ACTION_PATH/bin/driftproof" run "$INPUT_SKILL_DIR" \
  --models "$INPUT_MODELS" --max-usd "$INPUT_MAX_USD" \
  --max-calls "$INPUT_MAX_CALLS" --out "$OUT"
RECEIPT="$(ls "$OUT"/*.json | grep -v '\.summary\.' | head -1)"
# Outputs: every entry in the heredoc form with a random delimiter, from the
# shell helper and from the badge writer alike (AC-4). A model_id carrying a
# line break makes the writer throw, which fails this step under set -e with
# nothing appended.
gh_output receipt "$RECEIPT"
node "$GITHUB_ACTION_PATH/bin/driftproof" badge "$RECEIPT" --github-output >> "$GITHUB_OUTPUT"
node "$GITHUB_ACTION_PATH/bin/driftproof" badge "$RECEIPT" --out "$OUT/badge.json"
