// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the gate needs to run the same rows on Linux and Windows (spec 312).
//
// This is the one file under tests/ that reads the platform. The gate itself
// never does: a platform branch anywhere else could skip a row without saying so.
// On win32 exactly two rows read not applicable, each by name and with a cause:
// the bash-driven probes of scripts/build-public.sh, the publish tool that runs
// on the Linux box alone. Every other row runs on every platform.

const { execFileSync } = require('child_process');

// The rows that read not applicable on win32, by name. Nothing else may.
const POSIX_ONLY_ROWS = [
  'publish script: the bash-driven probes of scripts/build-public.sh',
  'publish unblock: the nested-repository refusal of scripts/build-public.sh (AC-9)',
];

function posixOnlyCause(platform = process.platform) {
  return platform === 'win32'
    ? 'scripts/build-public.sh is the publish tool and runs on the Linux box alone; '
      + 'its probes test POSIX path resolution, the home-directory refusal and rm -rf ordering (spec 312)'
    : null;
}

// On win32: records the named row not applicable, once, and returns true, so the
// caller skips that row's probes. Elsewhere: records nothing and returns false.
const recorded = new WeakMap();
function skipPosixOnly(gate, name, platform = process.platform) {
  if (!POSIX_ONLY_ROWS.includes(name)) throw new Error(`skipPosixOnly: "${name}" is not a POSIX-only row`);
  const cause = posixOnlyCause(platform);
  if (cause === null) return false;
  const seen = recorded.get(gate) || new Set();
  if (seen.has(name)) throw new Error(`skipPosixOnly: "${name}" is already recorded`);
  seen.add(name);
  recorded.set(gate, seen);
  gate.notApplicable(name, cause);
  return true;
}

// npm is npm.cmd on Windows, which Node spawns only through a shell. Under
// cmd.exe an argument with a space is quoted, and one carrying % or " is refused:
// cmd.exe would expand the first and split on the second.
function npmInvocation(args, platform = process.platform) {
  for (const a of args) {
    if (/[%"]/.test(a)) throw new Error(`npm argument carries % or ", which cmd.exe would expand or split: ${a}`);
  }
  if (platform !== 'win32') return { file: 'npm', args: [...args], shell: false };
  return { file: 'npm', args: args.map((a) => (/[\s&|<>^()]/.test(a) ? `"${a}"` : a)), shell: true };
}

function runNpm(args, opts = {}) {
  const inv = npmInvocation(args);
  return execFileSync(inv.file, inv.args, { ...opts, shell: inv.shell });
}

// Every git call in a scratch repository the gate makes carries this, so a
// checkout there writes the bytes it committed on every platform. Git for
// Windows sets core.autocrlf=true system-wide.
const SCRATCH_GIT = ['-c', 'core.autocrlf=false'];

module.exports = { POSIX_ONLY_ROWS, posixOnlyCause, skipPosixOnly, npmInvocation, runNpm, SCRATCH_GIT };
