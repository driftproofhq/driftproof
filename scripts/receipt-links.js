#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// The receipts block that every published report page carries (DECISIONS #20:
// "receipts are linked, not named").
//
// ONE implementation, used by two callers that must not disagree: each
// scripts/prepare-report-*.js renders it into the page it generates, and
// scripts/apply-receipt-links.js splices it into the pages of reports whose
// generators have no --published render path (#002, #003, #004). That shared
// origin is the point. #003's page said receipts/report-003/ while its generator
// still emitted report-003-draft/, because the page was hand-corrected after
// promotion and the source of truth was not — and #004, which nobody hand-
// corrected, shipped a pointer into a directory that does not exist.
//
// The list is derived from the DIRECTORY, never from a literal. A hardcoded list
// is right on the day it is written and silently wrong afterwards, which is the
// enumeration failure backlog B-9 records one level up.
const fs = require('fs');
const path = require('path');

const BLOB = 'https://github.com/driftproofhq/driftproof/blob/main';

// `slug__model.json` -> { slug, model }. Receipts have carried this shape since
// #001; a file that does not match is surfaced rather than skipped, because a
// receipt silently dropped from this block is exactly the defect it exists to end.
// A second convention exists in this repo and was not represented here: reports
// whose arms are produced by `bin/driftproof run` land as
// `<slug>-<model>-<YYYY-MM-DD>.json`, because that is what the CLI names its own
// output. #001–#005 never hit it — their generators build receipts in-process and
// write the `slug__model.json` form directly — so the first report to shell out
// to the CLI (#006) produced a directory this function threw on.
//
// The name alone does not split: `code-review-and-quality-claude-fable-5-...`
// has hyphens in both halves, and any rule for choosing the boundary is a guess.
// It does not have to be a guess. A receipt CARRIES `skill.name` and
// `run.model_id` as attested, hash-covered fields, so the file is read rather
// than parsed. The filename becomes an opaque handle, which is what it always
// should have been.
//
// The `slug__model.json` fast path is unchanged and is tried first, so every
// existing report renders byte-identically and does not pay a file read.
function parseReceiptName(file, dir = null) {
  const m = /^(.+?)__(.+)\.json$/.exec(file);
  if (m) return { slug: m[1], model: m[2] };
  if (!dir || !/-\d{4}-\d{2}-\d{2}\.json$/.test(file)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!r || !r.skill || !r.run || !r.skill.name || !r.run.model_id) return null;
    return { slug: r.skill.name, model: r.run.model_id };
  } catch (e) {
    return null;
  }
}

// `label` is the path the page CLAIMS (`receipts/report-005/`), and the directory
// read is resolved separately — promoted if it exists, draft otherwise, the same
// resolution scripts/prepare-report-005.js already does. Keeping them separate is
// deliberate: a draft renders draft links, a published page renders published
// ones, and neither can inherit the other's path by accident. The two failure
// modes this closes are #004's page pointing into a directory that was moved out
// from under it, and a page whose prose label and whose links disagree.
function resolveReceiptsDir(reportNumber, root) {
  const promoted = path.join(root, 'receipts', `report-${reportNumber}`);
  const draft = path.join(root, 'receipts', `report-${reportNumber}-draft`);
  if (fs.existsSync(promoted)) return promoted;
  if (fs.existsSync(draft)) return draft;
  throw new Error(`no receipts directory for report-${reportNumber} (looked for report-${reportNumber} and report-${reportNumber}-draft)`);
}

function receiptLinksBlock(reportNumber, opts = {}) {
  const root = opts.root || path.join(__dirname, '..');
  const label = (opts.label || `receipts/report-${reportNumber}/`).replace(/\/+$/, '');
  const dir = opts.dir || resolveReceiptsDir(reportNumber, root);
  // Sidecars are named, not guessed at. `_index.json` is an index OF receipts and
  // `*.control.json` (spec 009, AC-6) is a cell's baseline-reproduction record —
  // both sit beside receipts and neither IS one. They are excluded by an explicit
  // rule so an unrecognised file still reaches the throw below: a receipt silently
  // dropped from this block is exactly the defect this function exists to end, and
  // a permissive skip would reintroduce it.
  const isSidecar = (f) => f === '_index.json' || f.endsWith('.control.json');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !isSidecar(f)).sort();
  if (!files.length) throw new Error(`no receipts under ${dir} — refusing to render an empty receipts block`);

  const bySlug = new Map();
  const unparsed = [];
  for (const f of files) {
    const p = parseReceiptName(f, dir);
    if (!p) { unparsed.push(f); continue; }
    if (!bySlug.has(p.slug)) bySlug.set(p.slug, []);
    bySlug.get(p.slug).push({ file: f, model: p.model });
  }
  if (unparsed.length) throw new Error(`receipts that match neither slug__model.json nor a readable <slug>-<model>-<date>.json: ${unparsed.join(', ')}`);

  const rows = [...bySlug.entries()].map(([slug, rs]) => {
    const links = rs.map((r) => `<a href="${BLOB}/${label}/${r.file}">${r.model}</a>`).join(' \u00b7 ');
    return `      <li><code>${slug}</code> \u2014 ${links}</li>`;
  });

  return [
    '  <h2>Receipts</h2>',
    `  <details class="card"><summary><strong>All ${files.length} receipts for this report, each one resolvable.</strong> `
      + 'Every number on this page re-derives from these files. They are the evidence, not a description of it \u2014 '
      + 'open any one and check it against the table above.</summary>',
    '    <ul>',
    ...rows,
    '    </ul>',
    `    <p class="muted">Directory: <a href="${BLOB.replace('/blob/', '/tree/')}/${label}">`
      + `<code>${label}/</code></a>. Validate any of them with `
      + '<code>npx driftproof validate &lt;file&gt;</code>.</p>',
    '  </details>',
  ].join('\n');
}

module.exports = { receiptLinksBlock, parseReceiptName, resolveReceiptsDir, BLOB };
