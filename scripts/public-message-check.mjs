#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/public-message-check.mjs - a public commit message carries no private marker (spec 113).
//
// A public commit message is public. It comes from the release notes (-F) or from a summary the operator types (-m),
// never from the private log. This reads one message and lists what makes it private, in five kinds:
//   a spec number            `spec 113`, `spec #113`, `specs/113`, `113-some-slug`, `A-113-2`, and `048-driver`, the number and
//                            one-word slug of a directory of the source tree's `specs/` (so that `128-bit` is not refused)
//   a private SHA            a 7 to 40 hex token that is an object of the source repository
//   a home path              the home directory, or `/home/<name>`
//   a /var/tmp path
//   the private remote       a remote of the source repository other than `origin`, or the word `private`, or its URL
// The word `private` is refused wherever it is a whole word, including in prose; the operator rewords it.
// scripts/build-public.sh runs this before it destroys anything; scripts/push-public.mjs runs it again on the message
// of the commit it is about to push, so a commit made by hand is read too.
//
//   printf '%s\n' "$MSG" | node scripts/public-message-check.mjs [--repo <source tree>]
// exit 0 when the message carries none; exit 1 and one line per marker on stderr when it does.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const git = (repo, ...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
const isObject = (repo, tok) => { const r = git(repo, 'rev-parse', '--disambiguate=' + tok.toLowerCase()); return r.status === 0 && r.stdout.trim().length > 0; };
const slugsOf = (repo) => { try { return fs.readdirSync(path.join(repo, 'specs')).filter((n) => /^\d{3}-[a-z0-9][a-z0-9-]*$/i.test(n)); } catch { return []; } };
const remotesOf = (repo) => { const names = git(repo, 'remote').stdout.split('\n').filter((n) => n && n !== 'origin'); return { names, urls: names.map((n) => git(repo, 'remote', 'get-url', n).stdout.trim()).filter(Boolean) }; };

// Each kind is one statement on one line, so a gate can plant the absence of exactly one.
export function markersIn(message, { repo, home = process.env.HOME } = {}) {
  const found = [];
  const add = (kind, text) => found.push({ kind, text });
  const remotes = repo ? remotesOf(repo) : { names: [], urls: [] };
  for (const m of message.matchAll(/\bspecs?[ /_#-]*\d{3}\b|\b\d{3}-[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b|\b[A-Za-z]-\d{3}-\d+\b/gi)) add('spec number', m[0]); // marker:spec
  const slugs = repo ? slugsOf(repo) : [];
  if (slugs.length) for (const m of message.matchAll(new RegExp(`\\b(?:${slugs.map(esc).join('|')})\\b`, 'gi'))) add('spec number', m[0]); // marker:slug
  for (const m of message.matchAll(/\b[0-9a-f]{7,40}\b/gi)) if (repo && isObject(repo, m[0])) add('private SHA', m[0]); // marker:sha
  for (const m of message.matchAll(new RegExp(`/home/[\\w.-]+(?:/[^\\s]*)?${home && home.length > 1 ? '|' + esc(home) + '(?:/[^\\s]*)?' : ''}`, 'g'))) add('home path', m[0]); // marker:home
  for (const m of message.matchAll(/\/var\/tmp\b[^\s]*/g)) add('var/tmp path', m[0]); // marker:tmp
  for (const m of message.matchAll(new RegExp(`\\b(?:private|${remotes.names.map(esc).join('|') || 'private'})\\b`, 'gi'))) add('private remote', m[0]); // marker:remote
  for (const u of remotes.urls) if (message.includes(u)) add('private remote', u); // marker:remote
  return found;
}

export function refusalText(found) {
  return ['the message carries private markers:', ...found.map((f) => `  - ${f.kind}: ${JSON.stringify(f.text)}`), 'A public commit message is public: say what ships without them.'].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' && args[i + 1]) repo = path.resolve(args[++i]);
    else { console.error('usage: public-message-check.mjs [--repo <source tree>] < message'); process.exit(2); }
  }
  let message = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) message += chunk;
  const found = markersIn(message, { repo });
  if (found.length) { console.error(refusalText(found)); process.exit(1); }
}
