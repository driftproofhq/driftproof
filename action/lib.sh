#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Shared by action/run.sh and action/enforce.sh (spec 023). Sourced, not run.
#
# Every value these scripts use arrives as an ENVIRONMENT VARIABLE set by the
# step's env: block in action.yml. Nothing in a run: line is substituted by the
# Actions expression engine, so a value is data by the time bash sees it.

# die <message>: one ::error annotation, exit 1. Nothing runs after it.
die() {
  printf '::error title=Driftproof::%s\n' "$1"
  exit 1
}

# require_env NAME...: every named variable must be set (it may be empty; the
# validators decide what an empty value means).
require_env() {
  local n
  for n in "$@"; do
    [ "${!n+set}" = set ] || die "$n is not set; the step's env: block must map it"
  done
}

# gh_output <name> <value>: one $GITHUB_OUTPUT entry in GitHub's multiline form
# with a random delimiter, the same shape lib/verdict.js writes (spec 023
# AC-4). A value carrying a line break is refused, never written.
gh_output() {
  local name="$1" value="$2" delim
  case "$value" in
    *$'\n'*|*$'\r'*) die "refusing to write \$GITHUB_OUTPUT: the value of $name contains a line break" ;;
  esac
  delim="ghadelim_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  printf '%s<<%s\n%s\n%s\n' "$name" "$delim" "$value" "$delim" >> "$GITHUB_OUTPUT"
}

# ── validators (spec 023 AC-3) ───────────────────────────────────────────────
# Each takes the raw value and dies with a ::error naming the input. Patterns
# are anchored extended regular expressions held in variables; bash's [[ =~ ]]
# matches the WHOLE string (no REG_NEWLINE), so a value carrying a newline
# cannot satisfy a class that excludes it, and `$` is the end of the value, not
# the end of a line.
RE_MODELS='^[A-Za-z0-9._-]+(,[A-Za-z0-9._-]+)*$'
RE_USD='^[0-9]+(\.[0-9]+)?$'
RE_ZERO='^0+(\.0+)?$'
RE_CALLS='^[1-9][0-9]*$'
# SPEC 030 (AC-4). The verdict the enforcement step validates is the word
# `driftproof decide --github-output` published, and that vocabulary is DEFINED
# in lib/decision.js's VERDICT_WORD - one word per decision state, all six.
# Until this, the list here was the pre-030 four:
#
#   RE_VERDICT='^(PASSED|NO_EFFECT|REGRESSED|NOT_MEASURED)$'
#
# so a run whose worst state was `inconclusive` or `refused` died HERE, at
# validate_verdict, with `got INCONCLUSIVE` - before enforce.sh reached the
# decision that carries AC-4's warning and AC-2's naming of the models with no
# receipt. The failure direction was fail-closed, and it made two criteria
# unreachable on the shipped path. Worst first, the order lib/decision.js's
# STATE_ORDER declares. specs/030 `probes/summary.mjs verdict-vocabulary` holds
# the two lists identical in both directions, so a seventh state cannot ship
# without a word here and a word here cannot outlive its state.
# Spec 035 adds UNDERPOWERED, in STATE_ORDER's place between NOT_MEASURED and NO_EFFECT.
RE_VERDICT='^(REGRESSED|REFUSED|INCONCLUSIVE|NOT_MEASURED|UNDERPOWERED|NO_EFFECT|PASSED)$'
RE_DELTA='^-?[0-9]+(\.[0-9]+)?$'
RE_CNTRL='[[:cntrl:]]'

shown() { printf '%q' "$1"; }   # one line, shell-quoted, for the message

validate_models() {
  [[ "$1" =~ $RE_MODELS ]] || die "models: expected a comma-separated list of model ids (letters, digits, . _ -), got $(shown "$1")"
}
validate_max_usd() {
  [[ "$1" =~ $RE_USD ]] || die "max-usd: expected a positive decimal number such as 20 or 3.53, got $(shown "$1")"
  [[ "$1" =~ $RE_ZERO ]] && die "max-usd: must be greater than zero, got $(shown "$1")"
  return 0
}
validate_max_calls() {
  [[ "$1" =~ $RE_CALLS ]] || die "max-calls: expected a positive integer with no leading zero, got $(shown "$1")"
}
validate_bool() {  # validate_bool <input-name> <value>
  [ "$2" = true ] || [ "$2" = false ] || die "$1: expected true or false, got $(shown "$2")"
}
validate_skill_dir() {
  [ -n "$1" ] || die "skill-dir: must not be empty"
  [[ "$1" =~ $RE_CNTRL ]] && die "skill-dir: contains a control character, got $(shown "$1")"
  [ -d "$1" ] || die "skill-dir: not a directory: $(shown "$1")"
  return 0
}
# The words the message names are read out of RE_VERDICT rather than typed
# beside it: the list that drifted was a second copy of this one.
verdict_words() {
  local w="${RE_VERDICT#^\(}"; w="${w%\)$}"; printf '%s' "${w//|/, }"
}
validate_verdict() {
  [[ "$1" =~ $RE_VERDICT ]] || die "verdict: expected one of $(verdict_words), got $(shown "$1")"
}
validate_delta() {
  [[ "$1" =~ $RE_DELTA ]] || die "delta: expected a decimal number, got $(shown "$1")"
}
