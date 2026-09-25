#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# scripts/browser-lock.sh - the browser lock, taken around browser gates only (spec 051;
# CONSTITUTION § Proportional oversight, clause 6).
#
# Two takers, one mechanism:
#
#   the sweep     bash scripts/browser-lock.sh run --gate <spec> --by sweep -- bash specs/<spec>/gate.sh ...
#   a gate alone  . "$(dirname "$0")/../../scripts/browser-lock.sh" && browser_lock_self "$0" "$@"
#
# `run` logs `wait`, takes the lock with flock, logs `acquired`, runs the command in its own process
# group with the lock's descriptor closed (a server the command leaves behind cannot keep the lock)
# and a holder marker `<lock>:<pid>` exported, logs `released`, and exits with the command's status.
# Stopped by TERM, INT or HUP, it stops the command's whole group first and logs `released-on-signal`. It exits 75 when
# the lock is not acquired within the wait, having logged `timeout`.
#
# `browser_lock_self`, sourced by a browser gate, returns at once when the marker names a process
# that is an ancestor of the gate (the sweep holds the lock for it), and otherwise re-runs the gate
# under `run`. A marker naming anything else - a dead process, a sibling, another lock - is ignored,
# so a leaked variable cannot switch the lock off.
#
# Environment: DP_BROWSER_LOCK (default ~/.driftproof-browser.lock), DP_BROWSER_LOCK_LOG
# (default the lock's path plus .log), DP_BROWSER_LOCK_WAIT (seconds, default 3600),
# DP_LOCK_OWNER (the label written into the log, default the parent's pid).
# Each log line is one JSON object: t, event, pid, owner, gate, by, lock.

browser_lock_path() { printf '%s' "${DP_BROWSER_LOCK:-$HOME/.driftproof-browser.lock}"; }
browser_lock_log_path() { printf '%s' "${DP_BROWSER_LOCK_LOG:-$(browser_lock_path).log}"; }
browser_lock_clean() { printf '%s' "$1" | tr -c 'A-Za-z0-9._:/-' '_'; }

browser_lock_log() {  # event gate by
  printf '{"t":"%s","event":"%s","pid":%s,"owner":"%s","gate":"%s","by":"%s","lock":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$1" "$$" "$(browser_lock_clean "${DP_LOCK_OWNER:-pid $PPID}")" \
    "$(browser_lock_clean "$2")" "$(browser_lock_clean "$3")" "$(browser_lock_clean "$(browser_lock_path)")" >> "$(browser_lock_log_path)"
}

# True when DP_BROWSER_LOCK_HELD names this lock and a process that is this shell or one of
# its ancestors.
browser_lock_held_by_ancestor() {
  local m="${DP_BROWSER_LOCK_HELD:-}" lock mlock mpid p n
  [ -n "$m" ] || return 1
  lock="$(browser_lock_path)"
  mlock="${m%:*}"; mpid="${m##*:}"
  [ "$mlock" = "$lock" ] || return 1
  case "$mpid" in ''|*[!0-9]*) return 1 ;; esac
  p=$$; n=0
  while [ "$p" -gt 1 ] && [ "$n" -lt 64 ]; do
    [ "$p" = "$mpid" ] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
    [ -n "$p" ] || return 1
    n=$((n + 1))
  done
  return 1
}

browser_lock_self() {  # "$0" "$@" of the gate
  local gate_file="$1" gate
  shift
  browser_lock_held_by_ancestor && return 0
  gate="$(basename "$(cd "$(dirname "$gate_file")" && pwd)")"
  exec bash "${BASH_SOURCE[0]}" run --gate "$gate" --by gate -- bash "$gate_file" "$@"
}

browser_lock_run() {
  local gate="" by="gate" lock wait rc
  while [ $# -gt 0 ]; do
    case "$1" in
      --gate) gate="$2"; shift 2 ;;
      --owner) DP_LOCK_OWNER="$2"; export DP_LOCK_OWNER; shift 2 ;;
      --by) by="$2"; shift 2 ;;
      --) shift; break ;;
      *) echo "browser-lock.sh: unknown argument $1" >&2; return 2 ;;
    esac
  done
  [ $# -gt 0 ] || { echo "browser-lock.sh: run needs a command after --" >&2; return 2; }
  lock="$(browser_lock_path)"
  wait="${DP_BROWSER_LOCK_WAIT:-3600}"
  mkdir -p "$(dirname "$lock")" "$(dirname "$(browser_lock_log_path)")"
  browser_lock_log wait "$gate" "$by"
  exec 9>>"$lock"
  if ! flock -w "$wait" 9; then
    browser_lock_log timeout "$gate" "$by"
    echo "browser-lock.sh: $lock not acquired within ${wait}s for $gate" >&2
    exec 9>&-
    return 75
  fi
  browser_lock_log acquired "$gate" "$by"
  # The command runs in its own process group, so a signal that stops this helper (a sweep's
  # timeout sends SIGTERM here and nowhere else) is forwarded to the whole gate, browser included,
  # and the release is logged only once the gate is gone (spec 051 A-051-1, F-3).
  DP_BROWSER_LOCK_HELD="$lock:$$" setsid "$@" 9>&- &
  BROWSER_LOCK_CHILD=$!
  BROWSER_LOCK_GATE="$gate"; BROWSER_LOCK_BY="$by"
  trap 'browser_lock_stop' TERM INT HUP
  wait "$BROWSER_LOCK_CHILD"
  rc=$?
  trap - TERM INT HUP
  browser_lock_log released "$gate" "$by"
  flock -u 9
  exec 9>&-
  return "$rc"
}

browser_lock_stop() {
  kill -TERM -- "-$BROWSER_LOCK_CHILD" 2>/dev/null || kill -TERM "$BROWSER_LOCK_CHILD" 2>/dev/null
  local n=0
  while kill -0 "$BROWSER_LOCK_CHILD" 2>/dev/null && [ "$n" -lt 50 ]; do sleep 0.1; n=$((n + 1)); done
  kill -KILL -- "-$BROWSER_LOCK_CHILD" 2>/dev/null
  wait "$BROWSER_LOCK_CHILD" 2>/dev/null
  browser_lock_log released-on-signal "$BROWSER_LOCK_GATE" "$BROWSER_LOCK_BY"
  flock -u 9
  exit 143
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    run) shift; browser_lock_run "$@"; exit $? ;;
    *) echo "usage: bash scripts/browser-lock.sh run [--gate <name>] [--owner <label>] [--by sweep|gate] -- <command...>" >&2; exit 2 ;;
  esac
fi
