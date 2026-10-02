#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/model-names.js: the one place a registry id becomes a human model name (spec 133).
//
// THE RULE, STATED ONCE. Every page title, description and structured-data name that names a model
// takes it from here, never typed per page:
//
//   claude-<family>-<major>[-<minor>][-<yyyymmdd>]  ->  Claude <Family> <major>[.<minor>]
//       claude-sonnet-5-5 -> Claude Sonnet 5.5; claude-opus-5 -> Claude Opus 5;
//       claude-haiku-4-5-20251001 -> Claude Haiku 4.5 (a dated snapshot drops its date)
//   gpt-<version>[-<tier>]                          ->  GPT-<version>[ <Tier>]
//       gpt-5.6-sol -> GPT-5.6 Sol; gpt-5.5 -> GPT-5.5 (the registry's own comment writes the
//       tier this way: "GPT-5.6 Sol $5/$30", config/models.json _comment)
//
// THE SHORT FORM, the same rule less the maker's word: a Claude name drops its leading "Claude"
// (claude-sonnet-4-6 -> Sonnet 4.6); a GPT name is unchanged, since "GPT" is part of its version
// (gpt-5.6-sol -> GPT-5.6 Sol). Only the lower rungs of a receipt's title ladder use it (spec 133
// R-3), where the full name does not fit.
//
// An id that fits neither form THROWS: a name this rule cannot derive is a name somebody would have
// to guess, and a guessed model name on a public page is a claim with no receipt behind it.
//
//   node scripts/model-names.js <id>...      print each id's human name
const CLAUDE = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;
const GPT = /^gpt-(\d+(?:\.\d+)?)(?:-([a-z]+))?$/;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function humanModelName(id) {
  const s = String(id);
  let m = CLAUDE.exec(s);
  if (m) return `Claude ${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  m = GPT.exec(s);
  if (m) return `GPT-${m[1]}${m[2] ? ` ${cap(m[2])}` : ''}`;
  throw new Error(`no human name rule for the model id ${JSON.stringify(s)} (scripts/model-names.js)`);
}

function shortModelName(id) {
  return humanModelName(id).replace(/^Claude /, '');
}

// Anything shaped like a registry id, for the readers that must find none in a title or a
// description. Wider than the two forms above on purpose: an id the rule cannot name is still an id.
// Case-sensitive on purpose: an id is lower case and a name is not (gpt-5.6-sol, GPT-5.6 Sol).
const MODEL_ID_RE = /\b(?:claude|gpt)-[a-z0-9][a-z0-9.-]*[a-z0-9]\b/;

// The words a model name brings into a title, so a sentence-case reader can tell a proper noun from
// a capitalised common word: "Claude", "Sonnet", "GPT-5.6", "Sol".
function nameWords(ids) {
  return [...new Set(ids.flatMap((id) => humanModelName(id).split(' ')))];
}

module.exports = { humanModelName, shortModelName, MODEL_ID_RE, nameWords };

if (require.main === module) {
  for (const id of process.argv.slice(2)) process.stdout.write(`${id}\t${humanModelName(id)}\n`);
}
