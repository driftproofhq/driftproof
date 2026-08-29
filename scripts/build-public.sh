#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Build the clean single-commit publish tree for Driftproof and run all scans.
# Does NOT push. The push is a separate, explicit human act, and it stays that way.
#
# TRACKED, as of DECISIONS #25. This file lived untracked in a home directory for
# the project's whole life, with no history beyond hand-named `.bak-` copies —
# while `CONSTITUTION.md` named it FIRST in its automatically-T1 list. Approval
# finding A-F11: the one control in the publish path that nobody could review by
# diff or bisect was the one the constitution ranked highest. It has a history now.
#
# THE COMMIT MESSAGE IS REQUIRED AND IS NOT STORED HERE. It used to be a heredoc
# in this file. That message announced the v0.5.0 release, and was true for exactly
# one build; every build after it would have announced a release that was not
# happening (recorded as O-3: "now false, not merely stale"). A message written
# once and reused is a stale-claim generator, the same family of defect as a page
# hand-corrected while its generator keeps emitting the old text. Absence now fails
# loudly, before anything is altered.
#
# THE TARGET IS NOT TAKEN FROM THE ENVIRONMENT. It used to be: an earlier revision
# of this file read `DRIFTPROOF_PUBLIC_DIR` and passed it to `rm -rf`. Two approval
# runs broke that in three different ways, and the second run destroyed a simulated
# home directory twice, exit 0, success banner, no signal that anything was lost.
# An ambient variable is sticky, inherited and invisible at the call site, and the
# only reason it existed was to keep an absolute home path out of a tracked file —
# which a derived sibling default achieves without handing `rm -rf` an input nobody
# typed. The override is now a flag that must be typed on every invocation, and
# every path is resolved PHYSICALLY before it is compared. See DECISIONS #26.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: scripts/build-public.sh -m "<what this publish ships>" [-m "<paragraph>"...]
       scripts/build-public.sh -F <file>
       scripts/build-public.sh -m "..." --print-message   # resolve only, build nothing

  -m TEXT   commit message paragraph; repeat for more paragraphs, in order
  -F FILE   read the commit message from FILE ("-" for stdin)
  --public-dir PATH
            build somewhere other than the default sibling. For tests and
            sandboxes. Must be typed on the invocation; there is no environment
            override, and a path inside your home directory is refused.
  --waiver ID
            run against the publish target even though a NEXT-PUBLISH BLOCKER is
            open in DECISIONS.md. Permitted ONLY when that file records a
            "PUBLISH-WAIVER-ID: ID" line matching it exactly, character for
            character — the id is compared, never used as a pattern. There is no
            environment form, and there is no --force.
  --print-message
            print the resolved message and exit, without building anything
  -h        this help

The message is REQUIRED. It is not stored in this script and is never inherited
from the last publish: it describes THIS build, and nothing else can.

The default target is a `driftproof-public` directory beside the source tree.
This script DELETES its target with `rm -rf` before rebuilding it.
USAGE
}

MSG=""
MSG_FILE=""
PRINT_ONLY=0
PUB_ARG=""
PUB_EXPLICIT=0
WAIVER=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m) [ $# -ge 2 ] || { echo "build-public.sh: -m needs a message" >&2; exit 2; }
        if [ -n "$MSG" ]; then MSG="$MSG

$2"; else MSG="$2"; fi
        shift 2 ;;
    -F) [ $# -ge 2 ] || { echo "build-public.sh: -F needs a file" >&2; exit 2; }
        MSG_FILE="$2"; shift 2 ;;
    --public-dir) [ $# -ge 2 ] || { echo "build-public.sh: --public-dir needs a path" >&2; exit 2; }
        PUB_ARG="$2"; PUB_EXPLICIT=1; shift 2 ;;
    --waiver) [ $# -ge 2 ] || { echo "build-public.sh: --waiver needs a decision-entry id" >&2; exit 2; }
        WAIVER="$2"; shift 2 ;;
    --print-message) PRINT_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "build-public.sh: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -n "$MSG_FILE" ]; then
  if [ -n "$MSG" ]; then echo "build-public.sh: use -m or -F, not both" >&2; exit 2; fi
  if [ "$MSG_FILE" = "-" ]; then MSG="$(cat)"; else
    [ -r "$MSG_FILE" ] || { echo "build-public.sh: cannot read $MSG_FILE" >&2; exit 2; }
    MSG="$(cat "$MSG_FILE")"
  fi
fi

# THE REFUSAL, and it is deliberately the first thing that can stop the run — ahead
# of every path resolution and far ahead of `rm -rf "$PUB"`. A publish tool that
# validates its arguments after destroying the previous artifact has refused too
# late to matter.
if [ -z "${MSG//[[:space:]]/}" ]; then
  echo "build-public.sh: REFUSING — no commit message." >&2
  echo >&2
  echo "  This script carries no message of its own, by design. The one it used to" >&2
  echo "  carry announced a release on every build after that release had shipped." >&2
  echo "  Say what THIS build ships:" >&2
  echo >&2
  echo "    scripts/build-public.sh -m \"<what this publish ships>\"" >&2
  echo >&2
  exit 2
fi

if [ "$PRINT_ONLY" -eq 1 ]; then printf '%s\n' "$MSG"; exit 0; fi

# ── THE ENVIRONMENT THIS INHERITED IS NOT ALLOWED TO SELECT ANYTHING ─────────
#
# Backlog F-1, DECISIONS #27 clause 1, second sentence. #26 removed
# `DRIFTPROOF_PUBLIC_DIR` on the ground that an input nobody typed is the wrong
# thing to guard well — and the same change then handed the gate two ambient
# variables that chose WHICH ASSERTION IT RAN and supplied the value that
# assertion compared against. Set in a shell, they returned a green gate over a
# script that lies, at an unchanged assertion count, with nothing saying a weaker
# check had been substituted. A rule that is not applied to its author's own
# output is not yet a rule; this is #26 applied to #26.
#
# The primary fix is that the gate no longer reads them — it takes all three on
# argv, below. This is the belt on those suspenders: the family may not reach this
# script from a shell at all.
#
# BY PREFIX, NOT BY NAME. #27 asks for "any later assertion-selector of that
# family", which no list of today's names can cover. A list is also the instrument
# that has now failed three times here — twice on spec 005's message regex, and
# once on specs/006's NFR-1, which spot-checks two variables this script has never
# read and so passes for a reason unrelated to its property.
#
# DRIFTPROOF_BUILD_DEPTH IS EXEMPT, and the exemption is structural rather than a
# convenience. It counts process ancestry, so it must cross a process boundary —
# argv cannot carry it, because argv is written by the parent being counted. And
# it is safe exactly where the others are not: every value of it either refuses or
# leaves the run unchanged. There is no value that unlocks a path, which is why a
# stale one in a shell can cost a build and never a directory. #27 draws that line
# itself: a variable this script sets for its child is fine, a variable arriving
# from the operator's shell is a refusal.
#
# PLACED HERE: after argument validation, so the message rule stays the first
# thing that can stop the run (specs/006 AC-7c, applied rather than re-decided),
# and before target resolution, so that every refusal below is evaluated in an
# environment that has already been vetted. A guard read in an unvetted
# environment is a decision whose inputs were never checked. `--print-message`
# sits above this: it resolves argv, prints, and builds nothing, so it is not
# publish-mode in the sense #27 binds.
#
# Globbing off across the scan. A variable whose VALUE is `*` must not have this
# refusal enumerate the working directory instead of the offender — the same
# defect specs/006's marker parse fixed with `set -f`.
set -f
TAINTED=""
for _var in $(env | sed -n 's/^\(DRIFTPROOF_[A-Za-z0-9_]*\)=.*/\1/p'); do
  [ "$_var" = "DRIFTPROOF_BUILD_DEPTH" ] && continue
  TAINTED="$TAINTED $_var"
done
TAINTED="${TAINTED# }"
set +f
if [ -n "$TAINTED" ]; then
  echo "build-public.sh: REFUSING — this script's own environment selects nothing." >&2
  echo >&2
  echo "  inherited from the invoking shell:" >&2
  for _var in $TAINTED; do echo "    $_var" >&2; done
  echo >&2
  echo "  What a gate asserts, and what it compares against, are passed on argv by" >&2
  echo "  this script — never picked up from a shell. A variable of this family" >&2
  echo "  arriving from outside can only be an attempt to choose the assertion, and" >&2
  echo "  a build that chose its own verification is not a verified build." >&2
  echo >&2
  echo "  Unset them and run again. DRIFTPROOF_BUILD_DEPTH is the one exception:" >&2
  echo "  it counts nesting, and no value of it permits anything." >&2
  exit 7
fi

# Composed rather than written out. `git@<host>` is email-shaped, and the blocking
# hygiene scan reads it as an address — backlog B-8 records two approval records
# rejected for exactly this. Splitting the host out is the scanner-safe form.
# Defined here rather than below the guard because the guard uses it: a non-empty
# target has to carry THIS remote to be recognisable as a tree this script built.
REMOTE_HOST="github.com"
REMOTE="git@${REMOTE_HOST}:driftproofhq/driftproof.git"

# Paths are derived, never hard-coded: this file is tracked now, and an absolute
# home path in a tracked file fails the blocking hygiene scan — as it should, since
# it also makes the tool work on exactly one machine. `pwd -P` rather than `pwd`,
# because bash's default is LOGICAL: it preserves a symlinked component instead of
# resolving it, and a comparison against an unresolved path is not a comparison
# between directories.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

# WHAT MAY BE DESTROYED, checked before anything is.
#
# History, because it is the whole justification for how blunt this is. Approval
# run 1 pointed the then-new environment override at the source tree with a
# perfectly valid message and emptied it. The fix guarded that with string
# comparisons; approval run 2 defeated the comparisons four ways — a trailing slash
# on `HOME`, a symlinked parent component, a `/.` suffix, and a target that was a
# regular file rather than a directory — destroying a simulated home directory and
# exiting 0 with a success banner in two of them. It also showed that the "does it
# look like a tree we built" shape check admitted the operator's real home
# directory, which has a `docs/` and a `README.md` and no `DECISIONS.md`.
#
# The response is not a fifth string comparison. It is: no ambient input, physical
# resolution before any comparison, and a shape check that requires a marker only
# this script produces.
refuse_target() {
  echo "build-public.sh: REFUSING — unsafe publish target." >&2
  echo "  target: $PUB" >&2
  echo "  $1" >&2
  echo >&2
  echo "  This script deletes its target with 'rm -rf' before rebuilding it." >&2
  echo "  It will only do that to a directory that does not exist, is empty, or" >&2
  echo "  is a publish tree it built before (a git repository whose origin is" >&2
  echo "  this project's)." >&2
  exit 3
}

# Physical resolution, leaf need not exist. `realpath -m` normalises `.`, `..`,
# repeated and trailing separators AND resolves symlinks in every existing
# component — which is exactly the set of spellings that defeated the string
# comparisons. If it is not available the script refuses rather than falling back
# to a weaker comparison: the fallback IS the defect.
command -v realpath >/dev/null 2>&1 || {
  echo "build-public.sh: REFUSING — no realpath(1) on this system." >&2
  echo "  The publish target is resolved physically before it is compared, and" >&2
  echo "  comparing unresolved paths is the defect that removed this fallback." >&2
  exit 3
}
resolve() { realpath -m -- "$1"; }

if [ "$PUB_EXPLICIT" -eq 1 ]; then PUB_RAW="$PUB_ARG"; else PUB_RAW="$(dirname "$SRC")/driftproof-public"; fi

[ -n "${PUB_RAW//[[:space:]]/}" ] || { PUB="$PUB_RAW"; refuse_target "the target is empty"; }
PUB="$(resolve "$PUB_RAW")"
# An unset or empty HOME must not turn the home rules into no-ops by comparing
# against the empty string. A path nothing can equal is the safe stand-in.
if [ -n "${HOME:-}" ]; then HOME_R="$(resolve "$HOME")"; else HOME_R="/nonexistent-home-$$"; fi

# Ordered so that the rule that fires is the rule that names the reason. An
# approval finding recorded the cost of getting this wrong: `/` was being refused
# by the shape check, so the rule written for `/` had never been tested. Each
# reason string below is distinct, and the gate asserts the specific one.
case "$PUB" in
  /) refuse_target "that is the filesystem root" ;;
esac
if [ "$PUB" = "$SRC" ]; then
  refuse_target "that is the source tree — the build would delete what it is building from"
fi
case "$PUB" in
  "$SRC"/*) refuse_target "that is inside the source tree — the build would delete what it is building from" ;;
esac
case "$SRC" in
  "$PUB"/*) refuse_target "the source tree is inside it — the build would delete its own source" ;;
esac
if [ "$PUB" = "$HOME_R" ]; then
  refuse_target "that is your home directory"
fi
case "$HOME_R" in
  "$PUB"/*) refuse_target "your home directory is inside it" ;;
esac
# An explicit --public-dir is somebody's typed input, and the things people keep
# under their home directory are the things `rm -rf` must never reach. The DEFAULT
# target is a sibling of the source tree and is exempt: it is derived by this
# script from its own location, it is not input, and it is where the publish tree
# has always lived.
if [ "$PUB_EXPLICIT" -eq 1 ]; then
  case "$PUB" in
    "$HOME_R"/*) refuse_target "an explicit --public-dir may not point inside your home directory" ;;
  esac
fi
# A target that exists and is not a directory was destroyed with no check at all by
# the previous revision: the whole shape check hung off `[ -d "$PUB" ]`, so a
# regular file skipped every content test there was.
if [ -e "$PUB" ] && [ ! -d "$PUB" ]; then
  refuse_target "the target exists and is not a directory"
fi
# A target that already holds something must be a tree THIS script built. The
# previous revision tested for a published SHAPE — `docs/` and `README.md` present,
# `DECISIONS.md` and `specs/` absent — and an approval run pointed out that the
# operator's home directory satisfies it, along with a great many ordinary project
# directories. The marker is now the origin remote this script itself sets, which
# is not a shape anyone else's directory happens to have.
looks_like_ours() {
  [ -d "$PUB/.git" ] || return 1
  [ -f "$PUB/README.md" ] || return 1
  [ -d "$PUB/docs" ] || return 1
  if [ -e "$PUB/DECISIONS.md" ] || [ -d "$PUB/specs" ]; then return 1; fi
  local origin
  origin="$(git -C "$PUB" remote get-url origin 2>/dev/null)" || return 1
  [ "$origin" = "$REMOTE" ] || return 1
  return 0
}
if [ -d "$PUB" ] && [ -n "$(ls -A "$PUB" 2>/dev/null)" ]; then
  if ! looks_like_ours; then
    refuse_target "it is not empty and is not a publish tree this script built"
  fi
fi

# Paths that must NEVER reach the public tree: internal build logs, the
# pending-publish queue, and any *-draft/ directory. A sitting unreviewed draft
# must never ride along with an unrelated publish, so drafts are excluded
# unconditionally here (belt) — they are also gitignored (suspenders), and the
# gate asserts the published tree carries no *-draft/ path.
#
# The week- alternative carries the same `[^/]*` tail as its phase- sibling. It
# did not until 2026-08-24, so `reports/week-3-cost.md` never matched and shipped
# to the public repository carrying dollar figures (approval finding G-F1,
# DECISIONS #22). The repo gate now asserts this exclusion against the published
# tree rather than leaving it to this regex alone: a regex-only guard fails
# silently, which is precisely how that file got out.
#
# The spec-anchored governance files (CONSTITUTION.md, DECISIONS.md, specs/) are
# excluded for the same reason as the week-*/phase-* reports: they are working
# documents, not products. A decision log records strategy, rejected options and
# risk posture; the confidentiality scan only catches deny-listed TERMS, and can
# never know that a document is internal by nature. Publishing a curated public
# constitution later remains open — but as a deliberate feature, not as a side
# effect of a denylist that happens not to mention them. See DECISIONS.md #1.
# `^state/` — spec 007 tracked state/skill-version-check.json so the repository can
# reproduce a page it publishes (backlog C-3). Tracking it made it eligible for the
# published tree, which would have changed the published artifact as a side effect
# of a reproducibility fix. Whether that snapshot SHOULD ship as the receipt for the
# page's upstream-check sentence is a real question and a separate decision — filed
# as backlog G-3, taken deliberately or not at all.
EXCLUDE_RE='^reports/(week-[0-9][^/]*|phase-[0-9][^/]*)\.md$|^tests/gate-results\.json$|(^|/)[^/]*-draft/|^reports/pending-publish\.md$|^reports/interop-outreach\.md$|^(CONSTITUTION|DECISIONS)\.md$|^specs/|^state/'

# RECURSION BOUND, structural rather than a timeout, and a BACKSTOP rather than
# the primary mechanism. This script's last act is to run the repo gate against the
# tree it just built, and that gate builds a tree of its own to check that the
# commit carries the message it was given. The gate does not do that when it is the
# verification step of a build — it reads the message off the build it is verifying
# instead — so in normal operation nothing nests. This is what catches it if that
# ever stops being true. An approval run measured the cost of no bound at all: 39
# nested sandboxes and ~640 MB of /tmp, and it established that a timeout does not
# bound recursion, because `execFileSync` signals the direct child only and the
# grandchild it already spawned survives.
#
# Placed HERE, immediately before the first destructive act, so that every refusal
# above behaves identically at every nesting level: a gate running inside a build
# still exercises the real target refusals and still gets exit 3, not this.
#
# A stale value in a shell can only make this script REFUSE, never destroy
# anything. That is the difference between this variable and the target variable
# that was removed.
BUILD_DEPTH="${DRIFTPROOF_BUILD_DEPTH:-0}"
case "$BUILD_DEPTH" in
  ''|*[!0-9]*) BUILD_DEPTH=2 ;;
esac
if [ "$BUILD_DEPTH" -ge 2 ]; then
  echo "build-public.sh: REFUSING — nested build." >&2
  echo "  DRIFTPROOF_BUILD_DEPTH=$BUILD_DEPTH" >&2
  echo "  A build is already running the gate that invoked this one, and that gate" >&2
  echo "  started another build. Building here would recurse without bound. If no" >&2
  echo "  build is in progress, a stale value is set in this shell:" >&2
  echo "  unset DRIFTPROOF_BUILD_DEPTH." >&2
  exit 4
fi

# ── THE COMMIT IDENTITY IS RESOLVED BEFORE ANYTHING IS DESTROYED ─────────────
#
# E-F1, DECISIONS #27 clause 4. `git commit` below ran with whatever identity was
# ambient, and it runs INSIDE the freshly `git init`-ed publish tree — so a
# `user.email` local to the SOURCE repository never applied to it. On a box with
# no identity the commit failed AFTER `rm -rf` had already run, leaving the
# operator with a destroyed target and no publish. Everything else here that can
# refuse, refuses before the destructive act; this could not, because nothing
# checked it.
#
# `user.useConfigOnly=true` is the load-bearing part, not decoration. Without it
# git INVENTS an identity from the machine — on the box this was written on,
# `git var` happily returns `EC2 Default User <ec2-user@ip-…compute.internal>`
# and the commit succeeds. That is worse than the failure it hides: the build
# host and its internal hostname are exactly what this project's own blocking
# hygiene scan bans, and they would be stamped into the author field of a commit
# that is force-pushed to the public repository. So the rule is not "some
# identity resolves" but "an identity was CONFIGURED" — env vars or git config,
# never guessed from the hostname.
#
# Probed in a temp directory rather than in $SRC, because the check has to see
# what the publish tree will see, and the publish tree is not this repository.
IDENT_PROBE="$(mktemp -d 2>/dev/null)" || {
  echo "build-public.sh: REFUSING — cannot create a temp directory to resolve the commit identity." >&2
  exit 6
}
IDENT="$(git -C "$IDENT_PROBE" -c user.useConfigOnly=true var GIT_COMMITTER_IDENT 2>/dev/null)" || IDENT=""
rmdir "$IDENT_PROBE" 2>/dev/null || true
if [ -z "$IDENT" ]; then
  echo "build-public.sh: REFUSING — no commit identity." >&2
  echo >&2
  echo "  The publish tree is a fresh repository, so a user.name/user.email set" >&2
  echo "  LOCALLY in this checkout does not apply to its commit. Nothing global" >&2
  echo "  is configured and no GIT_AUTHOR_*/GIT_COMMITTER_* is set, so git would" >&2
  echo "  either fail after the target had already been deleted, or invent an" >&2
  echo "  identity from this machine's hostname and stamp it into a public commit." >&2
  echo >&2
  echo "  Configure one, e.g.:" >&2
  echo "    git config --global user.name  \"<name>\"" >&2
  echo "    git config --global user.email \"<address>\"" >&2
  echo >&2
  exit 6
fi

# THE NEXT-PUBLISH BLOCKER GUARD, and it is the last thing that can stop the run.
#
# DECISIONS #27 declared F-1..F-4 and E-F1 NEXT-PUBLISH BLOCKERS and queued the
# mechanism that would enforce them. The next publish arrived first and nothing
# stopped it, because the rule existed only as prose in DECISIONS.md and in a
# backlog: nothing read it, because nothing could. #28 records that incident. A
# control only a careful reader enforces is not a control, it is a note — the same
# argument #26 made about inputs nobody typed, applied to rules nobody parses.
#
# PLACED HERE, with the depth check and before `rm -rf`, rather than at the top.
# The message rule is deliberately the first thing that can stop the run, and the
# target rules each name their own reason; a guard ahead of them would take those
# refusals over, and every one of their assertions would pass for the wrong
# reason. What matters is that it runs before anything is destroyed, and it does.
#
# IT BINDS THE PUBLISH TARGET — the derived default sibling. An explicit
# --public-dir is documented above as being for tests and sandboxes, and one
# pointing inside your home directory is already refused, so the real publish tree
# is reachable ONLY by the default path this guards. That scope is a bound, not a
# convenience, and specs/006's AC-6 asserts the bound rather than assuming it.
#
# AN ABSENT DECISIONS.md PROCEEDS, by decision recorded in #28. The published tree
# excludes that file, so failing closed here would refuse every build made from a
# published tree. #28's "Revisit if" names this as the case to reopen.
#
# THE WAIVER IS ARGV-ONLY. #26 removed an ambient input to `rm -rf` on the ground
# that an input nobody typed is the wrong thing to guard well; F-1 observes that
# the same change then introduced ambient assertion selectors without offering
# that analysis. This is that analysis applied here: no environment form exists.
DECISIONS_LOG="$SRC/DECISIONS.md"
OPEN_IDS=""
WAIVER_RECORDED=0

# READING A LIST OUT OF A LINE MEANS SPLITTING IT, and an unquoted split is
# subject to pathname expansion: a log line reading `NEXT-PUBLISH-BLOCKER-OPEN: *`
# would have the refusal name every entry in the working directory rather than the
# blocker. Globbing is off across the parse — the only place a split is wanted —
# and back on before anything else runs. Every use of the parsed ids downstream is
# quoted.
set -f
if [ -f "$DECISIONS_LOG" ]; then
  # Line-anchored at column 0. The markers are documented inside an HTML comment
  # in #28 itself, indented, and a parser that read its own instructions as state
  # would refuse forever on the strength of its own documentation.
  DECLARED="$(grep -E '^NEXT-PUBLISH-BLOCKER-OPEN:' "$DECISIONS_LOG" | sed 's/^NEXT-PUBLISH-BLOCKER-OPEN://' | tr ',' ' ' || true)"
  CLEARED="$(grep -E '^NEXT-PUBLISH-BLOCKER-CLEARED:' "$DECISIONS_LOG" | sed 's/^NEXT-PUBLISH-BLOCKER-CLEARED://' | tr ',' ' ' || true)"
  for _id in $DECLARED; do
    _is_cleared=0
    for _c in $CLEARED; do [ "$_id" = "$_c" ] && _is_cleared=1 && break; done
    [ "$_is_cleared" -eq 0 ] && OPEN_IDS="$OPEN_IDS $_id"
  done
  OPEN_IDS="${OPEN_IDS# }"

  # THE WAIVER IS COMPARED AS A FIXED STRING, never used as a pattern. It is
  # operator input, and interpolating it into an ERE made `--waiver '.*'` match
  # any recorded line — accepted as "recorded" while naming no recorded id, which
  # is precisely the --force flag with a longer name this check exists to refuse.
  # Each recorded line is reduced to its id and compared with `=`, so a waiver
  # matches itself and nothing else, metacharacters included.
  while IFS= read -r _line; do
    [ -n "$_line" ] || continue
    _rid="$(printf '%s' "$_line" | sed 's/^PUBLISH-WAIVER-ID:[[:space:]]*//; s/[[:space:]]*$//')"
    [ -n "$WAIVER" ] && [ "$_rid" = "$WAIVER" ] && WAIVER_RECORDED=1
  done <<< "$(grep -E '^PUBLISH-WAIVER-ID:' "$DECISIONS_LOG" || true)"
fi
set +f

# A named waiver must be RECORDED, whether or not anything is open — and whether
# or not the log exists. An absent log records nothing, so it records no waiver
# either; this refusal used to sit inside the file test and was skipped there,
# accepting an id nobody had written down. The absent-log case still PROCEEDS when
# no waiver is named (#28); what it cannot do is honour one.
if [ -n "$WAIVER" ] && [ "$WAIVER_RECORDED" -eq 0 ]; then
  echo "build-public.sh: REFUSING — that waiver is not recorded." >&2
  echo "  --waiver $WAIVER" >&2
  echo >&2
  echo "  A waiver is permitted only when DECISIONS.md carries a line reading" >&2
  echo "    PUBLISH-WAIVER-ID: $WAIVER" >&2
  echo "  matching it exactly, character for character. Record the decision first," >&2
  echo "  in the log, where it can be read later." >&2
  exit 5
fi

if [ -n "$OPEN_IDS" ] && [ "$PUB_EXPLICIT" -eq 0 ]; then
  if [ -n "$WAIVER" ]; then
    echo "build-public.sh: proceeding under recorded waiver $WAIVER" >&2
    echo "  still open: $OPEN_IDS" >&2
    echo >&2
  else
    echo "build-public.sh: REFUSING — a NEXT-PUBLISH BLOCKER is open." >&2
    echo >&2
    echo "  open: $OPEN_IDS" >&2
    echo >&2
    echo "  These are recorded in DECISIONS.md and enumerated with their closing" >&2
    echo "  conditions in specs/002-qa-required-fixes/backlog.md. A blocker holds" >&2
    echo "  the next run of this script against the publish target — that is what" >&2
    echo "  it is for. Close them, or record a waiver in DECISIONS.md as" >&2
    echo "    PUBLISH-WAIVER-ID: <id>" >&2
    echo "  and re-run with --waiver <id>. There is no environment form." >&2
    echo >&2
    exit 5
  fi
fi

# ── the dependency directory must BE a directory (spec 011 AC-1, blocker P-1) ──
#
# `cp -r` below reproduces a SYMLINK as a symlink — measured, GNU coreutils 8.32.
# In the publish target `.gitignore`'s `node_modules/` is a DIRECTORY pattern and
# does not match a link, so `git add -A` tracks it and the blob git stores is the
# link's target: an absolute path under the operator's home, in a tree about to
# become a public repository. The published-tree gate returned 432/432 on exactly
# that tree, because every hygiene pattern reads file CONTENTS and a symlink has
# none unless something dereferences it.
#
# PLACED HERE, immediately above the first destructive act, rather than in the
# early ladder. The early placement was measured and rejected: the repo gate's own
# publish sandboxes build a source tree with no `node_modules`, so an early guard
# converts their expected exits 3/4/5/6 into 8 and takes the repo gate to 449/463.
# Here the refusal still precedes `rm -rf`, which is what the blocker requires.
#
# `[ -d ]` follows links, so the link test comes first — otherwise a symlink to a
# real directory passes the very check that exists to catch it.
if [ -L "$SRC/node_modules" ] || [ ! -d "$SRC/node_modules" ]; then
  if [ -L "$SRC/node_modules" ]; then shape="a symbolic link"
  elif [ -e "$SRC/node_modules" ]; then shape="not a directory"
  else shape="absent"; fi
  echo "build-public.sh: REFUSING — the dependency directory node_modules is $shape." >&2
  echo "  at: $SRC/node_modules" >&2
  echo >&2
  echo "  This script copies that directory into the publish target with 'cp -r'," >&2
  echo "  which reproduces a link as a link. The target's ignore rule names a" >&2
  echo "  DIRECTORY, so a link is not ignored, is tracked, and the blob git stores" >&2
  echo "  is its target — an absolute path, in a tree about to become public." >&2
  echo "  Build from a tree whose node_modules is a real directory." >&2
  echo >&2
  exit 8
fi

rm -rf "$PUB"
mkdir -p "$PUB"

# Copy exactly the git-tracked product files, minus the exclude list.
cd "$SRC"
git ls-files | grep -vE "$EXCLUDE_RE" | while read -r f; do
  mkdir -p "$PUB/$(dirname "$f")"
  cp "$f" "$PUB/$f"
done

# node_modules (for running the gate/ajv) — copied, not committed (gitignored).
cp -r "$SRC/node_modules" "$PUB/node_modules"

cd "$PUB"
git init -q -b main
git add -A
printf '%s\n' "$MSG" | git commit -q -F -
git remote add origin "$REMOTE"

echo "=== publish tree built at $PUB ==="
echo "tracked files:"; git ls-files | wc -l
echo
echo "=== commit message (as given, not as remembered) ==="
git log -1 --pretty=%B | sed 's/^/  /'
echo "=== running gate on the PUBLISHED tree (scans included) ==="
# The gate is told ON ARGV that it is a VERIFICATION run over a tree this build
# just made, and is given the message this build was invoked with. It checks the
# message on the commit it is verifying against that, rather than building a tree
# of its own, which is the reason nothing recurses.
#
# WHAT THIS FORM IS AND IS NOT (F-1). It inspects the REAL ARTIFACT rather than a
# probe, and that is the whole of its advantage. It is NOT the stronger check: the
# reference and the subject both come from this run of this script, so a script
# that lies in both places passes. The standalone form — build with a nonce and
# read the message back — is what holds the class, it runs everywhere else, and
# merge-check requires it. The earlier claim that this form was stronger was true
# about which artifact is inspected and false about detection power.
#
# The three selectors go on argv because an environment nobody typed must not
# choose which assertion runs; the refusal above is the other half of that rule.
# DRIFTPROOF_BUILD_DEPTH stays in the environment because it counts ancestry, and
# it is the only DRIFTPROOF_ name this script sets for its child.
DRIFTPROOF_BUILD_DEPTH="$((BUILD_DEPTH + 1))" node tests/gate.js \
  --publish-verify --publish-message "$MSG" --scan-root "$PUB"
