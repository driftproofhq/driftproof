#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/push-public.mjs - the one place a public push is made (spec 113).
//
// The public repository keeps its history, so a push is a plain fast-forward: the commit in the public tree
// (built by scripts/build-public.sh) has the public main tip as its only parent, and the push moves main onto it.
// This step reads the tip from the remote at push time, never from memory, and refuses, naming both tips in full,
// when the commit is not a child of it (the remote moved, or the commit was built over another tip, or it is a root
// commit). It reads the message of the commit once more for private markers (scripts/public-message-check.mjs), so a
// commit made by hand is read too, and it holds every path of the commit's tree against the names the build keeps out
// (EXCLUDE_RE, read out of scripts/build-public.sh). There is no force option of any kind here, no `+` refspec and no `--tags`: a tag is
// pushed by its own `git push <remote> refs/tags/<tag>`.
//
//   node scripts/push-public.mjs [--public-dir <public tree>] [--remote <name-or-url>] [--src <source tree>] [--dry-run]
// exit 0: pushed (or, with --dry-run, every check passed and nothing was pushed). exit 1: refused, nothing was pushed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { markersIn, refusalText } from './public-message-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let src = path.resolve(HERE, '..');
let pubArg = null;
let remote = 'origin';
let dry = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--public-dir' && args[i + 1]) pubArg = args[++i];
  else if (args[i] === '--remote' && args[i + 1]) remote = args[++i];
  else if (args[i] === '--src' && args[i + 1]) src = path.resolve(args[++i]);
  else if (args[i] === '--dry-run') dry = true;
  else { console.error('usage: push-public.mjs [--public-dir <public tree>] [--remote <name-or-url>] [--src <source tree>] [--dry-run]'); process.exit(2); }
}
const pub = path.resolve(pubArg || path.join(path.dirname(src), 'driftproof-public'));

const git = (...a) => spawnSync('git', ['-C', pub, ...a], { encoding: 'utf8' });
const out = (...a) => git(...a).stdout.trim();
const refuse = (...lines) => { console.error(['push-public.mjs: REFUSING, nothing was pushed.', ...lines.map((l) => `  ${l}`)].join('\n')); process.exit(1); };

if (!fs.existsSync(path.join(pub, '.git'))) refuse(`${pub} is not a git repository.`);
const real = (p) => fs.realpathSync(p);
if (real(pub) === real(src)) refuse('the public tree is the source tree.');
if (out('symbolic-ref', '-q', 'HEAD') !== 'refs/heads/main') refuse('the public tree is not on main.');
// A pushed commit is permanent, so the names the build keeps out are read out of the build itself, the way scripts/indexnow.mjs reads them,
// and every path of the commit's tree is held against them: a tree made by hand is read as the build's is.
let excludeRe = null;
try { const m = fs.readFileSync(path.join(src, 'scripts', 'build-public.sh'), 'utf8').match(/EXCLUDE_RE='([^']+)'/); excludeRe = m ? new RegExp(m[1]) : null; } catch { /* refused below */ }
if (!excludeRe) refuse(`cannot read EXCLUDE_RE out of ${path.join(src, 'scripts', 'build-public.sh')}: the commit's tree cannot be checked.`); // spec113:refuse-nomatcher
const excluded = git('ls-tree', '-r', '-z', '--name-only', 'HEAD').stdout.split('\0').filter((f) => f && excludeRe.test(f));
if (excluded.length) refuse(`the commit carries ${excluded.length} path(s) the public build keeps out, so it is not a public tree: ${excluded.slice(0, 5).join(', ')}${excluded.length > 5 ? ', ...' : ''}`); // spec113:refuse-excluded

const [head, ...parents] = out('rev-list', '--parents', '-n1', 'HEAD').split(' ');
const ls = git('ls-remote', remote, 'refs/heads/main');
const line = ls.stdout.split('\n').find((l) => /\srefs\/heads\/main$/.test(l));
const tip = line ? line.split(/\s/)[0] : '';
if (ls.status !== 0 || !/^[0-9a-f]{40}$/.test(tip)) refuse(`the remote's main could not be read: ${(ls.stderr || 'it lists no main').trim().split('\n')[0]}`); // spec113:refuse-unreadable
if (parents.length === 0) refuse(`commit ${head} has no parent: a root commit is never pushed.`, `remote main: ${tip}`); // spec113:refuse-root
if (parents.length > 1) refuse(`commit ${head} has ${parents.length} parents: a public push is one commit on the tip.`, `remote main: ${tip}`, ...parents.map((x, i) => `parent ${i + 1}:      ${x}`)); // spec113:refuse-multi
if (parents[0] !== tip) refuse(`commit ${head} is not a fast-forward of the remote's main.`, `remote main:    ${tip}`, `commit parent:  ${parents[0]}`, 'The remote moved since the build, or the build parented on another tip. Build again.'); // spec113:refuse-ff

let markers = [];
markers = markersIn(out('log', '-1', '--format=%B'), { repo: src }); // spec113:check-message
if (markers.length) refuse(...refusalText(markers).split('\n'));

if (dry) { console.log(`push-public.mjs: dry run, every check passed: ${head} on ${tip}, nothing pushed.`); process.exit(0); }
const push = spawnSync('git', ['-C', pub, 'push', remote, 'HEAD:refs/heads/main'], { encoding: 'utf8' }); // spec113:push
process.stderr.write(push.stderr || '');
if (push.status !== 0) { console.error(`push-public.mjs: the push failed (exit ${push.status}); the remote was not moved by this step.`); process.exit(1); }
console.log(`push-public.mjs: pushed ${head}, a fast-forward of ${tip}.`);
