#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Install + enable the Driftproof release-watch systemd --user timer.
#
# Usage:  bash deploy/install-timer.sh
#
# Installs the unit + timer under the per-user systemd directory, reloads,
# enables the timer, and prints its status + next fire time. No root needed
# (systemd --user). Requires lingering to be enabled for the timer to fire while
# you are not logged in:  loginctl enable-linger "$USER"  (one-time, may need sudo).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

echo "== Driftproof release-watch timer install =="
echo "repo:      $REPO"
echo "unit dir:  $UNIT_DIR"

if [ "$REPO" != "$HOME/driftproof" ]; then
  echo "WARNING: the units use %h/driftproof but this repo is at $REPO."
  echo "         Either move/symlink the repo to \$HOME/driftproof, or edit the"
  echo "         WorkingDirectory/ExecStart paths in the copied unit before enabling."
fi

mkdir -p "$UNIT_DIR"
cp "$HERE/driftproof-release-watch.service" "$UNIT_DIR/"
cp "$HERE/driftproof-release-watch.timer" "$UNIT_DIR/"
# The models-cache refresher feeds release-watch its keyless diff surface; it fires
# ~1h earlier so the poll always sees a fresh snapshot.
cp "$HERE/driftproof-refresh-models-cache.service" "$UNIT_DIR/"
cp "$HERE/driftproof-refresh-models-cache.timer" "$UNIT_DIR/"

systemctl --user daemon-reload
systemctl --user enable --now driftproof-refresh-models-cache.timer
systemctl --user enable --now driftproof-release-watch.timer

echo
echo "== timer status =="
systemctl --user --no-pager status driftproof-refresh-models-cache.timer || true
systemctl --user --no-pager status driftproof-release-watch.timer || true
echo
echo "== next fires =="
systemctl --user list-timers driftproof-refresh-models-cache.timer driftproof-release-watch.timer --no-pager || true

echo
echo "NOTE: keyless by default — the refresher writes state/models-cache.json from a"
echo "      public no-auth surface and release-watch diffs it. To UPGRADE to a live"
echo "      keyed poll, add an ANTHROPIC_API_KEY line to \$HOME/.driftproof.env"
echo "      (variable name, then '=', then your key — standard env-file format)."
echo "      release-watch only makes a models-LIST call, never a model inference call."
echo "To run once now:  systemctl --user start driftproof-refresh-models-cache.service"
echo "                  systemctl --user start driftproof-release-watch.service"
echo "To watch logs:    journalctl --user -u driftproof-release-watch.service -n 50"
