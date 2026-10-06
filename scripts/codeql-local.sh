#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# scripts/codeql-local.sh - the CodeQL scan GitHub runs on the public repository, run here first
# (spec 148), so a new alert stops the release before the public push.
#
#   scripts/codeql-local.sh install
#       Download the pinned CodeQL bundle (config/codeql.json) to its install directory, outside the
#       repository, and check its sha256 against the one recorded there. A download that differs is
#       deleted and the command fails; the unpacked launcher's sha256 is checked against the one recorded
#       too, and `scan` runs only a launcher that matches. Nothing here needs a token: the bundle is a public release asset.
#   scripts/codeql-local.sh scan [--tree DIR] [--rev SHA] [--out DIR] [--baseline FILE] [--keep]
#       Scan the tree the public build publishes (git ls-files less EXCLUDE_RE of scripts/build-public.sh)
#       with the query suite GitHub's default setup uses for JavaScript, write the SARIF to
#       <out>/results.sarif and the reader's summary to <out>/summary.json, and print the reader's
#       lines. --tree defaults to this checkout; --rev scans that commit of the tree instead of the
#       working copy; --out defaults to a new directory under /var/tmp/codeql-scan; --baseline defaults
#       to config/codeql-baseline.json beside this script; --keep leaves the database and the copy of the
#       tree under <out> (to join a new baseline: node scripts/codeql-read.js baseline).
#       Exit 0: no result off the baseline. 1: a result off the baseline. 2: the scan could not be
#       made or read (a missing CLI is 2, never 0).
#
# The scan never installs: `install` is its own command, run by a person or the build, so a sweep
# makes no download. The database and the copy of the tree are removed when the scan ends, unless
# --keep; the SARIF and the summary stay. The reader is scripts/codeql-read.js.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
READ=(node "$HERE/codeql-read.js")
pin() { "${READ[@]}" pin "$1"; }

cmd="${1:-}"; [ $# -gt 0 ] && shift
DIR="$(pin install_dir)"
VERSION="$(pin cli.version)"
ASSET="$(pin cli.asset)"
CLI="$DIR/cli-$VERSION/codeql/codeql"
ARCHIVE="$DIR/$ASSET"

archive_ok() { [ -f "$ARCHIVE" ] && [ "$(sha256sum "$ARCHIVE" | cut -d' ' -f1)" = "$(pin cli.sha256)" ]; }
# The launcher is the file the scan runs: its sha256 must be the one recorded beside the archive's,
# so a file put in its place by anything but `install` is not run.
cli_ok() { [ -x "$CLI" ] && [ "$(sha256sum "$CLI" | cut -d' ' -f1)" = "$(pin cli.launcher_sha256)" ] && [ "$("$CLI" version --format=terse 2>/dev/null)" = "$VERSION" ]; }

case "$cmd" in
  install)
    if cli_ok && archive_ok; then echo "codeql-local: CodeQL $VERSION is installed at $CLI (archive sha256 matches)"; exit 0; fi
    mkdir -p "$DIR"
    if ! archive_ok; then
      curl -fL --retry 3 -o "$ARCHIVE.part" "$(pin cli.url)"
      got="$(sha256sum "$ARCHIVE.part" | cut -d' ' -f1)"
      if [ "$got" != "$(pin cli.sha256)" ]; then
        rm -f "$ARCHIVE.part"
        echo "codeql-local: the download's sha256 is $got, not the recorded $(pin cli.sha256); deleted" >&2
        exit 2
      fi
      mv "$ARCHIVE.part" "$ARCHIVE"
    fi
    mkdir -p "$DIR/cli-$VERSION"
    tar --use-compress-program=unzstd -xf "$ARCHIVE" -C "$DIR/cli-$VERSION"
    cli_ok || { echo "codeql-local: $CLI is not the recorded launcher for version $VERSION after the unpack" >&2; exit 2; }
    echo "codeql-local: CodeQL $VERSION installed at $CLI"
    ;;
  scan)
    TREE="$ROOT"; REV=""; OUT=""; KEEP=0; BASELINE="$ROOT/config/codeql-baseline.json"
    while [ $# -gt 0 ]; do
      case "$1" in
        --tree) TREE="${2:?--tree needs a directory}"; shift ;;
        --rev) REV="${2:?--rev needs a commit}"; shift ;;
        --out) OUT="${2:?--out needs a directory}"; shift ;;
        --baseline) BASELINE="${2:?--baseline needs a file}"; shift ;;
        --keep) KEEP=1 ;;
        *) echo "codeql-local: unknown argument: $1" >&2; exit 2 ;;
      esac
      shift
    done
    cli_ok || { echo "codeql-local: CodeQL $VERSION is not installed at $CLI, or its launcher is not the recorded one; run scripts/codeql-local.sh install" >&2; exit 2; }
    [ -n "$OUT" ] || OUT="/var/tmp/codeql-scan/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$OUT"
    cleanup() { [ "$KEEP" = 1 ] || rm -rf "$OUT/db" "$OUT/src"; }
    trap cleanup EXIT
    "${READ[@]}" export "$TREE" "$OUT/src" ${REV:+--rev "$REV"} > "$OUT/export.log" \
      || { echo "codeql-local: the tree could not be exported (see $OUT/export.log)" >&2; exit 2; }
    export TMPDIR="${TMPDIR:-/var/tmp}"
    "$CLI" database create "$OUT/db" --language="$(pin language)" --source-root="$OUT/src" \
      --threads="$(pin threads)" --ram="$(pin ram_mb)" > "$OUT/create.log" 2>&1 \
      || { echo "codeql-local: database create failed (see $OUT/create.log)" >&2; exit 2; }
    "$CLI" database analyze "$OUT/db" "$(pin suite)" --format=sarif-latest --output="$OUT/results.sarif" \
      --sarif-category="/language:$(pin language)" --threads="$(pin threads)" --ram="$(pin ram_mb)" > "$OUT/analyze.log" 2>&1 \
      || { echo "codeql-local: database analyze failed (see $OUT/analyze.log)" >&2; exit 2; }
    rc=0
    "${READ[@]}" check "$OUT/results.sarif" --root "$OUT/src" --baseline "$BASELINE" --json "$OUT/summary.json" || rc=$?
    echo "SARIF: $OUT/results.sarif"
    exit "$rc"
    ;;
  *)
    echo "usage: scripts/codeql-local.sh install | scan [--tree DIR] [--rev SHA] [--out DIR] [--baseline FILE] [--keep]" >&2
    exit 2
    ;;
esac
