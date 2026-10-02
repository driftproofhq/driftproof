#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The "Comment on the pull request" step of action.yml (spec 128).
#
# ONE COMMENT, EDITED IN PLACE, THAT NEVER FAILS A RUN. The step runs before the
# enforcement step, action.yml gives it continue-on-error: true, and this script
# exits 0 on every path. When the comment cannot be posted (a fork's read-only
# token, no pull-requests: write, any API error, a pr-comment value that is not
# true or false), one ::notice says so, and the job's result is the one the
# enforcement step gives, unchanged.
#
# INPUT_PR_COMMENT, INPUT_SKILL_DIR, INPUT_MODELS, INPUT_FAIL_ON_REGRESSION,
# INPUT_FAIL_ON_UNDERPOWERED, DRIFTPROOF_RECEIPTS and GITHUB_TOKEN arrive through
# the step's env: block (spec 023). GITHUB_ACTION_PATH, GITHUB_EVENT_NAME,
# GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_SERVER_URL and
# GITHUB_RUN_ID are the default variables GitHub sets. Not `set -e`: nothing here
# may stop the job.
set -uo pipefail

# notice <message>: one ::notice annotation, its data escaped as a workflow command's must be.
notice() {
  local data="${1//'%'/'%25'}"
  data="${data//$'\r'/'%0D'}"
  data="${data//$'\n'/'%0A'}"
  printf '::notice title=Driftproof::%s\n' "$data"
}

# The input's declared default is true. GitHub always sets the variable from
# action.yml's env: block; only a caller outside GitHub leaves it unset.
: "${INPUT_PR_COMMENT=true}"
case "$INPUT_PR_COMMENT" in
  true) ;;
  false) echo "Driftproof: pr-comment is false; no pull request comment."; exit 0 ;;
  *) notice "The pull request comment was not posted: pr-comment takes true or false, and was given $(printf '%q' "$INPUT_PR_COMMENT"). The run's result is unchanged."; exit 0 ;;
esac

# Only a pull request has a conversation to comment on. Any other event makes no request.
case "${GITHUB_EVENT_NAME:-}" in
  pull_request|pull_request_target) ;;
  *) echo "Driftproof: not a pull request event (${GITHUB_EVENT_NAME:-none}); no pull request comment."; exit 0 ;;
esac

# action/comment.js writes its own ::notice on every way it cannot post, and exits
# 0; a non-zero exit means it could not run at all, and this is its one notice.
node "${GITHUB_ACTION_PATH:-.}/action/comment.js"
rc=$?
if [ "$rc" -ne 0 ]; then
  notice "The pull request comment was not posted: the comment script exited $rc. The run's result is unchanged."
fi
exit 0 # the comment never fails the run
