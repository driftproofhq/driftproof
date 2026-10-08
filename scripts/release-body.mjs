#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/release-body.mjs: print the user section of one release's entry in RELEASES.md, the text
// that becomes the GitHub release body.
//
//   node scripts/release-body.mjs <tag> [--file <RELEASES.md>]
//
// The entry is the section whose level-2 heading starts with the tag ("## v0.14.0 - 2026-10-06").
// Its user section runs from the first "### What's new" to the "### Engineering log" heading, so the
// engineering log never reaches the release body. An entry with no such section, or an empty one,
// is an error: a release is not published with a body that was not written for users.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function userSection(text, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`the tag ${JSON.stringify(tag)} is not vMAJOR.MINOR.PATCH`);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const starts = lines.reduce((a, l, i) => (l === `## ${tag}` || l.startsWith(`## ${tag} `) ? [...a, i] : a), []);
  if (starts.length === 0) throw new Error(`RELEASES.md has no section headed "## ${tag}"`);
  if (starts.length > 1) throw new Error(`RELEASES.md has ${starts.length} sections headed "## ${tag}"; it needs exactly one`);
  let end = lines.findIndex((l, i) => i > starts[0] && /^## /.test(l));
  if (end === -1) end = lines.length;
  const section = lines.slice(starts[0] + 1, end);
  const first = section.findIndex((l) => l === "### What's new");
  if (first === -1) throw new Error(`the ${tag} section has no "### What's new" heading: it has no user section`);
  let last = section.findIndex((l, i) => i > first && l === '### Engineering log');
  if (last === -1) last = section.length;
  const body = section.slice(first, last).join('\n').replace(/\n---\s*$/, '').trim();
  if (body === "### What's new" || body.split('\n').filter((l) => l.trim()).length < 2) throw new Error(`the ${tag} user section is empty`);
  return `${body}\n`;
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let file = path.join(root, 'RELEASES.md');
  let tag;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') file = path.resolve(argv[++i] ?? '');
    else if (!tag && !argv[i].startsWith('--')) tag = argv[i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!tag) throw new Error('usage: release-body.mjs <tag> [--file <RELEASES.md>]');
  process.stdout.write(userSection(fs.readFileSync(file, 'utf8'), tag));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`release-body: ${e.message}\n`); process.exit(2); }
}
