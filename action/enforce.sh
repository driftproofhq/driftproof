#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The "Enforce verdict" step of action.yml (spec 023).
#
# DRIFTPROOF_VERDICT and DRIFTPROOF_DELTA arrive from ${{ steps.run.outputs.* }}
# through the step's env: block; INPUT_FAIL_ON_REGRESSION and INPUT_MODELS from
# ${{ inputs.* }} the same way. This is the audit's A6 chain's second site: a
# receipt's model_id used to be able to reach this shell as code.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env DRIFTPROOF_VERDICT DRIFTPROOF_DELTA DRIFTPROOF_RECEIPTS GITHUB_ACTION_PATH \
  INPUT_FAIL_ON_REGRESSION INPUT_MODELS
validate_verdict "$DRIFTPROOF_VERDICT"
validate_delta "$DRIFTPROOF_DELTA"
validate_bool fail-on-regression "$INPUT_FAIL_ON_REGRESSION"
validate_models "$INPUT_MODELS"

# SPEC 030 (AC-1, AC-2). The decision is taken over EVERY receipt the run
# produced, against every model that was requested, by the same reader the badge
# and the summary use. Until this, these lines were
#
#   echo "Driftproof verdict: $DRIFTPROOF_VERDICT (delta $DRIFTPROOF_DELTA)"
#   if [ "$INPUT_FAIL_ON_REGRESSION" = "true" ] && [ "$DRIFTPROOF_VERDICT" = "REGRESSED" ]; then
#     echo "::error title=Driftproof::Skill REGRESSED on $INPUT_MODELS (delta $DRIFTPROOF_DELTA)"
#
# - one receipt's verdict deciding a multi-model run, and a failure message
# naming INPUT_MODELS, the REQUESTED list, rather than the models that actually
# regressed. Both halves are the same defect: nothing here knew a run has more
# than one subject.
#
# DRIFTPROOF_RECEIPTS is the run step's receipts_dir output and reaches this
# shell as an ENVIRONMENT VARIABLE, like every other input (spec 023 A1/A6). No
# receipt-derived string is interpolated into a run: line, and the directory is
# passed to the reader as one argv element.
if [ ! -d "$DRIFTPROOF_RECEIPTS" ]; then
  echo "::error title=Driftproof::the receipts directory does not exist: $DRIFTPROOF_RECEIPTS" >&2
  exit 1
fi
node "$GITHUB_ACTION_PATH/bin/driftproof" decide "$DRIFTPROOF_RECEIPTS" \
  --models "$INPUT_MODELS" --enforce \
  --fail-on-regression "$INPUT_FAIL_ON_REGRESSION"
