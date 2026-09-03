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
require_env DRIFTPROOF_VERDICT DRIFTPROOF_DELTA INPUT_FAIL_ON_REGRESSION INPUT_MODELS
validate_verdict "$DRIFTPROOF_VERDICT"
validate_delta "$DRIFTPROOF_DELTA"
validate_bool fail-on-regression "$INPUT_FAIL_ON_REGRESSION"
validate_models "$INPUT_MODELS"

echo "Driftproof verdict: $DRIFTPROOF_VERDICT (delta $DRIFTPROOF_DELTA)"
if [ "$INPUT_FAIL_ON_REGRESSION" = "true" ] && [ "$DRIFTPROOF_VERDICT" = "REGRESSED" ]; then
  echo "::error title=Driftproof::Skill REGRESSED on $INPUT_MODELS (delta $DRIFTPROOF_DELTA)"
  exit 1
fi
