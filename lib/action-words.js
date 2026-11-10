// SPDX-License-Identifier: Apache-2.0
'use strict';

// The job summary's first line and the pull request comment, as the Action writes them (spec 128
// AC-11 and AC-12, issue 762).
//
// THE WORDS ARE lib/plain.js's. Its summaryLead and commentMarkdown remain the one definition of both
// surfaces, and this module adds two things around them. A case id comes from the pull request's
// suite, so both surfaces read receipts whose ids have been through spec 144's escaper (EXT-2). And
// the comment's Why line follows the rule the sentence follows (EXT-1): where the averages do not
// point the verdict's way, they are not given as the reason.
//
// WHY THIS IS NOT IN lib/plain.js. Reports 017 and 018 print that file's SHA-256, so a changed byte
// there changes two published pages. The controller's ruling of 9 Nov 2026 holds those pages as they
// are until the operator rules on the wording of the "Clearly helped" family. The report builders call
// plainOf, which this module does not touch.

const fs = require('fs');
const os = require('os');
const path = require('path');
const plain = require('./plain');
const { readCases } = require('./verdict');
const { listReceipts } = require('./receipt');
const { mdText } = require('./names');

// A receipt as the two surfaces read it. A row's id and a placebo exclusion's id are the same text, so
// the two are escaped alike and still pair. mdText shows a line break as visible text first, so two
// ids that differ only by one stay two ids.
function escapedReceipt(receipt) {
  const out = structuredClone(receipt);
  for (const c of (out.results && out.results.cases) || []) c.id = mdText(c.id);
  const left = out.placebo && out.placebo.aggregates && out.placebo.aggregates.excluded_cases;
  for (const e of left || []) e.id = mdText(e.id);
  return out;
}

// lib/plain.js reads a decision's receipts from a directory, so its two surfaces are given a directory
// of the escaped receipts, under the same file names, for the length of one call.
function withEscapedReceipts(dir, read) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-words-'));
  try {
    const byFile = new Map();
    for (const { file, receipt } of listReceipts(dir)) {
      if (!receipt) continue;
      const name = path.basename(file);
      const escaped = escapedReceipt(receipt);
      byFile.set(name, escaped);
      fs.writeFileSync(path.join(scratch, name), JSON.stringify(escaped));
    }
    return read(scratch, byFile);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// lib/plain.js's sentence for a separated verdict whose averages do not point its way. Its last two
// clauses are taken as they stand, so each still has one wording. The match is anchored at the end,
// where only fixed words and figures stand, so an id holding these words cannot move it.
const NAMED = /^The skill clearly \w+ on \d+ of (\d+ test tasks?): (the .* decided it\.) (Over all \d+, the averages were \S+ with it and \S+ without\.)$/su;
const UNNAMED = /^The skill clearly \w+ on at least one of (\d+ test tasks?)\.$/u;
const RANGES = /(two ranges of scores .*)\.$/u;

// Why, for the comment. A case rule reads each task on its own, so the line counts every task whose
// ranges did not overlap, either way, and says how many went each way. Any other state keeps its line.
function whyLine(result, receipt) {
  const named = NAMED.exec(result.sentence);
  if (named) {
    const states = readCases(receipt).map((c) => c.state);
    const up = states.filter((s) => s === 'separated-up').length;
    const down = states.filter((s) => s === 'separated-down').length;
    const ways = [up && `${up} higher`, down && `${down} lower`].filter(Boolean).join(', ');
    return `on ${up + down} of ${named[1]}, the ${RANGES.exec(result.why)[1]} (${ways} with the skill): ${named[2]} ${named[3]}`;
  }
  const unnamed = UNNAMED.exec(result.sentence);
  return unnamed ? `on at least one of ${unnamed[1]}, the ${RANGES.exec(result.why)[1]}.` : result.why;
}

function summaryLead(d, dir, opts = {}) {
  return withEscapedReceipts(dir, (escaped) => plain.summaryLead(d, escaped, opts));
}

function commentMarkdown(d, dir, opts = {}) {
  return withEscapedReceipts(dir, (escaped, byFile) => {
    const body = plain.commentMarkdown(d, escaped, opts);
    const worst = d.rows.find((r) => r.state === d.worst);
    if (!worst) return body;
    const receipt = worst.file ? byFile.get(worst.file) || null : null;
    const result = plain.plainOfRow(worst, receipt);
    const why = whyLine(result, receipt);
    if (why === result.why) return body;
    const lines = body.split('\n');
    lines[lines.findIndex((l) => l.startsWith('Why: '))] = `Why: ${why}`;
    return lines.join('\n');
  });
}

module.exports = { summaryLead, commentMarkdown };
