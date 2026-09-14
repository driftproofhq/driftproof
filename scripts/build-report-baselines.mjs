#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/build-report-baselines.mjs — the published-content baseline.
//
//   node scripts/build-report-baselines.mjs           # write the manifest
//   node scripts/build-report-baselines.mjs --check   # exit 1 if it is stale
//
// WHAT THIS IS FOR. CONSTITUTION invariant 4: a published report is amended with
// a versioned record, never silently edited. Spec 020 held that by comparing
// every report page against its own base commit. That worked for one loop and
// then measured every later branch, and it could not survive a design pass that
// re-cuts every generated file under docs/.
//
// The reference is a tracked digest instead. Three properties follow, and none
// of them holds for a git ref:
//
//   - It is never vacuous. Run on `main`, a ref-based comparison resolves to
//     HEAD and passes without reading anything.
//   - It is CONTENT, not a path. Fonts, tokens, cards, plots and every scrap of
//     chrome may be rebuilt; the body is what is frozen.
//   - Changing a published body costs an explicit edit to this file, in the same
//     commit, which a reviewer sees.
//
// That last property is also this file's danger: a manifest a body edit can
// update is an escape hatch. The gate closes it by requiring any changed
// `body_sha256` to come with a GROWN Amendments section whose previously
// recorded prefix still digests. The only way to change a published body is to
// amend it, which is what the invariant says.
//
// The extraction is NOT defined here. It is `splitReportBody` in
// scripts/site-chrome.js, the module that writes the chrome this strips.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = require(path.join(ROOT, 'scripts', 'site-chrome.js'));

const OUT = path.join(ROOT, 'specs', '020-site-relaunch', 'baselines', 'report-bodies.json');
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// The README's derived opening moves with every promotion: the latest-report
// link and the counts are supposed to follow stats.json. Everything below the
// anchor is the body, and the body is what is frozen. The anchor is the same one
// spec 020's AC-30 already splits on.
export const README_ANCHOR = 'Driftproof **consumes**';

export function reportNumbers() {
  const dir = path.join(ROOT, 'docs', 'reports');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => /^\d+$/.test(n) && fs.existsSync(path.join(dir, n, 'index.html')))
    .sort();
}

export function build() {
  const reports = {};
  for (const n of reportNumbers()) {
    const html = fs.readFileSync(path.join(ROOT, 'docs', 'reports', n, 'index.html'), 'utf8');
    const { body, amendments } = chrome.splitReportBody(html);
    reports[n] = {
      body_sha256: sha256(body),
      // Byte length and digest together are a PREFIX check: the current section
      // truncated to this length must still digest to this value. That is what
      // "may only grow" means when the check is mechanical, and it is why a
      // length-preserving reword of an existing amendment cannot pass.
      amendments_bytes: Buffer.byteLength(amendments, 'utf8'),
      amendments_sha256: amendments === '' ? '' : sha256(amendments),
    };
  }
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const i = readme.indexOf(README_ANCHOR);
  return {
    _what: 'Published-content baselines. Regenerate with scripts/build-report-baselines.mjs. A change to any body_sha256 here is only legal alongside a grown Amendments section on the same report; specs/020-site-relaunch/gate.mjs AC-21 enforces that against the merge base.',
    reports,
    readme_body_sha256: i < 0 ? '' : sha256(readme.slice(i)),
  };
}

const text = () => `${JSON.stringify(build(), null, 2)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const want = text();
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (have === want) { console.log(`baselines current: ${reportNumbers().length} report(s)`); process.exit(0); }
    console.log(have === null ? `STALE: ${path.relative(ROOT, OUT)} does not exist` : `STALE: ${path.relative(ROOT, OUT)} does not match the tree`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, want);
  console.log(`wrote ${path.relative(ROOT, OUT)} — ${reportNumbers().length} report(s)`);
}
