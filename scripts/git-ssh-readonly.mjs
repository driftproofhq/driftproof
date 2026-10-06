#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/git-ssh-readonly.mjs - git's SSH command for an approval session: read-only access to the
// remote (spec 115). `scripts/drive.mjs` sets it as GIT_SSH_COMMAND and core.sshCommand, with
// GIT_SSH_VARIANT=ssh, in an approval session over an SSH remote, in place of the push guard's
// `/bin/false`. git runs it as `ssh [-o SendEnv=GIT_PROTOCOL] [-p port] [-4|-6] host <command>`.
//
// It lets through exactly one remote command, `git-upload-pack '<path>'` (ls-remote, fetch, clone),
// on one host and path, and then runs the real ssh (`$DRIVE_REAL_SSH`, default `ssh`) with the arguments it
// was given. The host and path are pinned by `$DRIVE_SSH_ALLOW`, a JSON list of `{host, path}` the driver sets
// from the URLs of the one remote it reads; with none set, or no entry that matches, nothing passes.
// Everything else exits 1 with a line that begins `git-ssh-readonly: refused`: `git-receive-pack`
// (push, push --dry-run), any other command, a command with anything after the quoted path, a
// second argument before it, and any ssh option outside the short list git passes (an option can run
// a local command, `-o ProxyCommand=...`, or name another config, `-F`). Fail closed: an argument
// this file does not know is refused, not passed.
import { spawn } from 'node:child_process';

const FLAGS = new Set(['-4', '-6', '-T', '-x', '-q']);
// git quotes the path in single quotes, an embedded quote as '\''; the whole command is this and nothing else
const ALLOWED = /^git-upload-pack '(?:[^']|'\\'')*'$/;

function refuse(why) {
  process.stderr.write(`git-ssh-readonly: refused: ${why} (an approval session may run git-upload-pack and nothing else; spec 115)\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
let i = 0;
let host = null;
for (; i < args.length; i++) {
  const a = args[i];
  if (FLAGS.has(a)) continue;
  if (a === '-p') { if (!/^\d+$/.test(args[i + 1] || '')) refuse('a -p without a port number'); i++; continue; }
  if (a === '-o') { if (args[i + 1] !== 'SendEnv=GIT_PROTOCOL') refuse(`the ssh option ${JSON.stringify(args[i + 1] || '')}`); i++; continue; }
  if (a === '--') { host = args[i + 1]; i += 2; break; }
  if (a.startsWith('-')) refuse(`the ssh option ${a}`);
  host = a; i++; break;
}
if (host == null || host.startsWith('-')) refuse('no host');
const rest = args.slice(i);
if (rest.length !== 1) refuse(`${rest.length} arguments after the host, not one command`);
if (!ALLOWED.test(rest[0])) refuse(`the remote command ${JSON.stringify(rest[0].split(/\s/)[0])}`);
let pinned = [];
try { pinned = JSON.parse(process.env.DRIVE_SSH_ALLOW || '[]'); } catch { refuse('an unreadable DRIVE_SSH_ALLOW'); }
const target = rest[0].replace(/^\S+ '/, '').slice(0, -1).replace(/'\\''/g, "'");
if (!Array.isArray(pinned) || !pinned.some((t) => t && t.host === host && t.path === target)) refuse(`the host ${JSON.stringify(host)} and path ${JSON.stringify(target)}, which are not the one remote this session may read`);

const child = spawn(process.env.DRIVE_REAL_SSH || 'ssh', args, { stdio: 'inherit' });
child.on('error', (e) => { process.stderr.write(`git-ssh-readonly: cannot run ssh: ${e.message}\n`); process.exit(255); });
child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 255); });
