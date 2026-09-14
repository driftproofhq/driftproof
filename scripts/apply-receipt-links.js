#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Splice the shared receipts block (scripts/receipt-links.js) into an already
// published report page.
//
// WHY THIS EXISTS, since a one-off that edits a published page is exactly the
// kind of tool that should have to justify itself: scripts/prepare-report-002.js,
// -003.js and -004.js have no `--published` / `--render-only` path. Only -005.js
// does. So for those three reports there is no way to re-render the published
// page from its generator without an --execute run, which fetches skills over the
// network and issues real model calls. This writes the SAME block the generator
// now renders, from the SAME function, so the page and its source of truth agree
// rather than merely resembling each other. #005 is NOT handled here: it goes
// through RUNBOOK's pinned command, because its page is held byte-for-byte.
//
// Idempotent: an existing block is replaced, never duplicated.
//
//   node scripts/apply-receipt-links.js 002 003 004        # write
//   node scripts/apply-receipt-links.js --check 002 003 004 # verify only, exit 1 on drift
const fs = require('fs');
const path = require('path');
const { receiptLinksBlock } = require('./receipt-links.js');

const ROOT = path.join(__dirname, '..');
const START = '  <h2>Receipts</h2>';
const FOOTER = '  <footer class="site">';

function apply(reportNumber, { check = false } = {}) {
  const page = path.join(ROOT, 'docs', 'reports', reportNumber, 'index.html');
  if (!fs.existsSync(page)) throw new Error(`no published page at docs/reports/${reportNumber}/index.html`);
  const html = fs.readFileSync(page, 'utf8');
  const block = receiptLinksBlock(reportNumber, { root: ROOT });

  const footIdx = html.indexOf(FOOTER);
  if (footIdx === -1) throw new Error(`docs/reports/${reportNumber}/index.html has no site footer to anchor against`);

  const startIdx = html.indexOf(START);
  let next;
  if (startIdx !== -1 && startIdx < footIdx) {
    next = html.slice(0, startIdx) + block + '\n' + html.slice(footIdx);
  } else {
    next = html.slice(0, footIdx) + block + '\n' + html.slice(footIdx);
  }

  if (next === html) return { reportNumber, changed: false };
  if (check) {
    throw new Error(`docs/reports/${reportNumber}/index.html does not carry the block this repo would render for it`);
  }
  fs.writeFileSync(page, next);
  return { reportNumber, changed: true, links: (block.match(/<a href="https/g) || []).length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const nums = args.filter((a) => /^[0-9]+$/.test(a));
  if (!nums.length) { console.error('usage: apply-receipt-links.js [--check] <report-number>...'); process.exit(1); }
  for (const n of nums) {
    const r = apply(n, { check });
    console.log(`report-${n}: ${r.changed ? `block written (${r.links} links)` : 'already current'}`);
  }
}

module.exports = { apply };
