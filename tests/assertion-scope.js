// SPDX-License-Identifier: Apache-2.0
'use strict';

// Assertion scope — what a counting, matching or existence assertion is allowed
// to read, and the register of ways such an assertion has been narrower than the
// criterion it stood for.
//
// WHY THIS EXISTS. Four findings in four consecutive loops share one shape: the
// assertion passes for a reason adjacent to the property. A window instead of a
// file; stripped text instead of the document; a name instead of the thing; a
// call site's spelling instead of its behaviour. Each was caught by a person or
// a fork-context approval reading a run, never by the gate containing it, and
// the fourth reached the live site. DECISIONS (2026-08-29) recorded that a
// fourth crossing argues for changing how assertions are drafted rather than for
// a fourth patch.
//
// WHY IT IS DATA. `B-12` and DECISIONS #28 make the same argument from two
// directions: a rule that only a careful reader enforces is not a control, it is
// a note. The classes are enumerated here so a checker can read them, so a sixth
// class is an append, and so CONSTITUTION's quality bar can be held to naming
// nothing this register lacks.
//
// WHY IN tests/. `specs/` is excluded from the published tree and no workflow
// runs a spec gate, so a rule living only beside its spec is never executed by a
// build (finding F-010-H). The repo gate runs this one.
//
// Nothing here reads a network or a provider.

const fs = require('fs');
const path = require('path');

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// ── the register ────────────────────────────────────────────────────────────

const NARROWING_CLASSES = [
  {
    id: 'window-vs-file',
    statement: 'The assertion reads a character window around a landmark rather than the whole artifact.',
    instances: ['F-012-B'],
    drafting: 'Count or match over the whole artifact. Use a window only to locate a landmark whose PRESENCE is the property, never to bound what the count may see.',
    mutation: 'Plant the violation as far from the landmark as the artifact allows.',
  },
  {
    id: 'visible-vs-attribute',
    statement: 'The assertion reads stripped visible text, so a claim carried in an attribute is invisible to it.',
    instances: ['F-012-D'],
    drafting: 'Read attribute values as well as visible text — `content`, `alt`, `title`, `aria-label`. A meta description is published prose: it is what a search result and a link preview show.',
    mutation: 'Plant the violation in a `content` attribute.',
  },
  {
    id: 'name-vs-thing',
    statement: 'The assertion matches the spelling of an identifier, or a naming convention adjacent to the property, rather than the thing named.',
    instances: ['F-008-A', 'F-011-M', 'F-009-K'],
    drafting: 'Anchor to the observable. Where a static check is unavoidable, pin the SET of sites and require each to carry a named behavioural probe, so a new site is red until someone writes one.',
    mutation: 'Add a decoy that carries the name and does nothing.',
  },
  {
    id: 'neighbourhood-vs-behaviour',
    statement: 'The assertion reads source text near the behaviour — a call site, a literal, an exit code any failure produces — rather than the behaviour.',
    instances: ['F-011-P', 'G-4', 'G-5', 'F-008-C'],
    drafting: 'Run the shipped thing and read what it did. A mutation must require the SPECIFIC refusal to disappear, never merely a different exit code; a green-before guard must probe behaviour, not grep the literal the mutation removes.',
    mutation: 'Break the subject for an unrelated reason and require the probe to stay red.',
  },
  {
    id: 'absence-vs-unreadable',
    statement: 'A search reports absence because it could not read the artifact, not because the thing is missing. Indistinguishable, from the outside, from the property holding.',
    instances: ['tests/essay-grounding.js — four literal NUL sentinels, 2026-08-29'],
    drafting: 'Do not ship the hazard: a source escape gives the same byte at runtime with no literal NUL in the file, and the whole class goes away. Searching with `grep -a` is ADVICE here, not a checked rule, and deliberately so — whether a plain search goes blind depends on the installed tool (ugrep 7.8.4 on this host reports no-match on NUL-bearing content; GNU grep reports a match), so it is not a property of the artifact and no assertion can hold it. A convention that cannot be verified from the artifact is a note, not a control.',
    mutation: 'Plant the hazard BEFORE the needle: a match preceding it is found either way and proves nothing.',
  },
];

// ── scope readers ───────────────────────────────────────────────────────────

const ATTRS_CARRYING_PROSE = ['content', 'alt', 'title', 'aria-label'];

function attributeText(src) {
  const out = [];
  for (const a of ATTRS_CARRYING_PROSE) {
    const re = new RegExp(`\\b${a}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'gi');
    for (const m of src.matchAll(re)) out.push(m[2] !== undefined ? m[2] : m[3]);
  }
  return out;
}

function visibleText(src) {
  return src
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');
}

// The document as an assertion is allowed to see it: what a reader reads, plus
// what a search engine, a link preview and a screen reader read. F-012-D shipped
// because the second half was not part of "the document".
function documentText(src) {
  return [visibleText(src)].concat(attributeText(src)).join(' · ').replace(/\s+/g, ' ');
}

// Every occurrence, over the whole text. Returns a list of violations; empty is
// the pass. One optional adjective is allowed between the number and the noun
// ("six published reports"), which a bare adjacency test refused (F-010-J).
function countClaims(text, noun, n) {
  const low = text.toLowerCase();
  const re = new RegExp(`\\b(${WORDS.join('|')})\\s+(?:[a-z-]+\\s+)?${noun.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  const bad = [];
  for (const m of low.matchAll(re)) {
    if (m[1] !== WORDS[n]) bad.push(`says "${m[0]}" where the repository has ${n}`);
  }
  return [...new Set(bad)];
}

// ── the published-tree scope ────────────────────────────────────────────────
//
// DERIVED FROM THE SHIPPING RULE, never hand-listed. AC-11's first draft scanned
// `README.md package.json docs/*.html docs/**/*.html`, which is a plausible list
// and not the scope its own criterion named — so `spec/RECEIPT.md` kept claiming
// receipts are "signed" while shipping to the public repo AND to npm, and the
// assertion written to close the window-vs-file class was itself an instance of
// it. The file set now comes from `EXCLUDE_RE` in the publish script, so it
// cannot drift from what actually ships.
function publishedFiles(root) {
  const { execFileSync } = require('child_process');
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const src = fs.readFileSync(path.join(root, 'scripts', 'build-public.sh'), 'utf8');
  const m = src.match(/EXCLUDE_RE='([^']+)'/) || src.match(/EXCLUDE_RE="([^"]+)"/);
  if (!m) throw new Error('cannot read EXCLUDE_RE out of scripts/build-public.sh');
  const exclude = new RegExp(m[1]);
  return tracked.filter((f) => !exclude.test(f));
}

// A FROZEN receipt schema is the record of what that version said. Correcting it
// would delete the evidence rather than the error, so it is exempt BY RULE —
// matched on the version-pinned name — and never by being left off a list.
const FROZEN_SCHEMA = /^spec\/receipt\.v\d+(\.\d+)*\.schema\.json$/;

// Sentences claiming a receipt is signed, over the whole published tree. Roadmap
// sections are where signing may appear, and a sentence that disclaims it in
// place ("not authenticity", "a promissory note") is the honest form.
function signedReceiptClaims(root) {
  const out = [];
  for (const rel of publishedFiles(root)) {
    if (FROZEN_SCHEMA.test(rel)) continue;
    if (!/\.(md|html|json|js|yml|yaml)$/.test(rel)) continue;
    let raw;
    try { raw = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    if (!/sign(ed|ing|ature)/i.test(raw)) continue;
    // THE SCANNER AND ITS CALLERS ARE SKIPPED BY RULE, not by a list: any file
    // that names this function is talking ABOUT the check. A scanner that
    // matches its own source reports a defect it introduced itself — the
    // self-matching grep of B-12, which this gate already committed once in
    // NFR-1 and would commit again here.
    if (raw.includes('signedReceiptClaims')) continue;
    const sections = /\.html$/.test(rel)
      ? raw.split(/<h[12][^>]*>/i).map((sec) => ({ head: sec.split(/<\/h[12]>/i)[0], body: sec }))
      : raw.split(/^#+ /m).map((sec) => ({ head: sec.split('\n')[0], body: sec }));
    for (const sec of sections) {
      if (/roadmap|not in this release|open question/i.test(sec.head)) continue;
      for (const mm of documentText(sec.body).matchAll(/[^.]*\bsign(ed|ing|ature)\b[^.]*\./gi)) {
        const sentence = mm[0];
        // A sentence that DENIES the property is the honest form, not a claim of
        // it: the correction itself has to be sayable in the shipped tree.
        if (/roadmap|planned|not yet|future|will be|signed up|promissory|not\s+authenticity|does not sign/i.test(sentence)) continue;
        if (/not\s+signed|hash-verified|rather than signed|not a signature|weaker property/i.test(sentence)) continue;
        if (/receipt/i.test(sentence)) out.push(`${rel}: ${sentence.trim().slice(0, 100)}`);
      }
    }
  }
  return out;
}

module.exports = { WORDS, NARROWING_CLASSES, ATTRS_CARRYING_PROSE, attributeText, visibleText, documentText, countClaims, publishedFiles, signedReceiptClaims, FROZEN_SCHEMA };
