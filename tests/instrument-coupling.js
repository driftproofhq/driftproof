// SPDX-License-Identifier: Apache-2.0
'use strict';

// The instrument/documentation coupling — ONE definition of what an instrument
// file is, what a documentation source is, and when a commit moves the first
// without the second.
//
// WHY IT EXISTS. The instrument moved at Report 006 and the methodology page did
// not move with it for three reports. Spec 025 AC-22 was written to close that
// gap, and its rationale says how: "It is closed by a check that fires the next
// time the instrument moves, which is why this criterion is evergreen by design."
//
// WHY IT LIVES HERE AND NOT IN A SPEC GATE (A-025-14). CONSTITUTION.md, at the
// rule added in 1a335b0, says an evergreen property belongs in the gate that runs
// on every branch, because a claim about the tree as it stands must not be pinned
// to a range: pinned, it stops noticing the tree it exists to guard. A spec gate
// measures a closed range and stops. This is the first application of that rule.
//
// AND WHY IT COULD NOT SIMPLY STAY OPEN WHERE IT WAS. The rule is PER-COMMIT: it
// requires one commit to move an instrument file and a documentation source
// together. Commits are immutable, so a violation inside a fixed-base range can
// never be answered — documenting the instrument tomorrow does not repair the
// commit that moved it yesterday, and the criterion would be red forever after
// its first real hit. Measured forward from a recorded anchor instead, it fires,
// it can be answered, and it goes back to green.
//
// Nothing here reads a network, a provider or the environment. It is a pure
// function over a commit list; the callers do the git.

// The key set spec 025 AC-22 names, widened to the effect floor by A-025-11.
// `config.js` also carries the spend caps and budgets, which no documentation
// page explains and which must not fire the coupling, so its key is a file AND a
// pattern over that commit's diff of it.
const INSTRUMENT = [
  { file: 'lib/reuse.js' },
  { file: 'lib/diff.js' },
  { file: 'spec/RECEIPT.md' },
  { file: 'spec/receipt.schema.json' },
  { file: 'config.js', diff: /^[+-]\s*(const\s+)?EFFECT_FLOOR\b/m, what: 'EFFECT_FLOOR' },
];

const DOC_SOURCES = ['docs/methodology/index.html', 'scripts/build-site-pages.js'];

// A commit is { sha, files: [path], diffs: { path: text } }. `diffs` is read only
// for the keys that carry a pattern, so a caller need not fetch diffs it will not
// be asked for. Returns one message per offending commit, naming the instrument
// file and the documentation pages that would have satisfied it.
function docsLag(commits) {
  const out = [];
  for (const c of commits) {
    const hit = INSTRUMENT.filter((k) => c.files.includes(k.file)
      && (!k.diff || k.diff.test((c.diffs || {})[k.file] || '')));
    if (!hit.length) continue;
    if (!c.files.some((f) => DOC_SOURCES.includes(f))) {
      const name = hit[0].what ? `${hit[0].file} (${hit[0].what})` : hit[0].file;
      out.push(`${c.sha.slice(0, 8)} changes ${name} and no documentation source (${DOC_SOURCES[0]} or the glossary in ${DOC_SOURCES[1]})`);
    }
  }
  return out;
}

module.exports = { INSTRUMENT, DOC_SOURCES, docsLag };
