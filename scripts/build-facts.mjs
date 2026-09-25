#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/build-facts.mjs - the counts on "How this is built" (spec 037 AC-4).
//
// The page describes how this project is built and shows counts, never the records
// themselves. The records (specs/, DECISIONS.md, the approval records) stay in the
// source repository and never reach the public tree, so the counts are read here, in
// the source tree, and written to docs/data/build-facts.json with the rule each count
// is taken by. The page prints each value from that file and nothing else; spec 037's
// gate counts the records again with a reader of its own.
//
//   node scripts/build-facts.mjs          # write docs/data/build-facts.json
//   node scripts/build-facts.mjs --check  # exit 1 if it is stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'data', 'build-facts.json');
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

export function facts(at) {
  const sha = git('rev-parse', `${at}^{commit}`).trim();
  const files = git('ls-tree', '-r', '--name-only', sha).split('\n').filter(Boolean);
  const has = new Set(files);
  const rd = (p) => git('show', `${sha}:${p}`);
  const dirs = [...new Set(files.map((f) => (/^specs\/(\d{3}[a-z]?-[^/]+)\/spec\.md$/.exec(f) || [])[1]).filter(Boolean))].sort();
  const evidence = (d) => files.filter((f) => f.startsWith(`specs/${d}/evidence/`) && !f.slice(`specs/${d}/evidence/`.length).includes('/')).map((f) => f.slice(`specs/${d}/evidence/`.length));
  let criteria = 0; let amendments = 0; let gates = 0; let mutationLines = 0; let redRecords = 0; let approvals = 0; let held = 0; let rejected = 0;
  for (const d of dirs) {
    const spec = rd(`specs/${d}/spec.md`);
    criteria += (spec.match(/^### AC-\d+\b/gm) || []).length;
    amendments += (spec.match(/^### A-\d{3}[a-z]?-\d+\b/gm) || []).length;
    const gateFiles = ['gate.sh', 'gate.mjs'].filter((g) => has.has(`specs/${d}/${g}`));
    if (gateFiles.length) gates += 1;
    for (const g of gateFiles) mutationLines += (rd(`specs/${d}/${g}`).match(/^.*\bMUTATION\b.*$/gm) || []).length;
    const ev = evidence(d);
    redRecords += ev.filter((f) => /^red/i.test(f)).length;
    for (const f of ev.filter((x) => /^approval-.*\.md$/.test(x))) {
      approvals += 1;
      const t = rd(`specs/${d}/evidence/${f}`);
      const verdict = (/^verdict:\s*(\S+)/m.exec(t) || [])[1] || '';
      const blocking = Number((/^blocking_findings:\s*(\d+)/m.exec(t) || [])[1] || 0);
      if (verdict === 'rejected') rejected += 1;
      if (verdict === 'rejected' || blocking > 0) held += 1;
    }
  }
  const decisions = (rd('DECISIONS.md').match(/^## /gm) || []).length;
  const audits = files.filter((f) => /^specs\/000-governance\/external-audits\/[^/]+$/.test(f)).length;
  const date = git('show', '-s', '--format=%cs', sha).trim();
  const F = (value, how) => ({ value, how });
  return {
    at: sha,
    at_date: date,
    note: 'Counts read from the source repository\'s records, which do not reach the public tree. Each "how" is the rule the count is taken by.',
    facts: {
      specs: F(dirs.length, 'directories under specs/ named NNN-slug that carry a spec.md'),
      criteria: F(criteria, 'headings "### AC-<n>" across those spec.md files'),
      gates: F(gates, 'those directories that carry a gate.sh or gate.mjs'),
      mutation_lines: F(mutationLines, 'lines naming MUTATION in those gate files'),
      red_records: F(redRecords, 'files under specs/*/evidence/ whose name begins "red"'),
      approvals: F(approvals, 'files specs/*/evidence/approval-*.md'),
      held: F(held, 'approval records whose verdict is rejected or whose blocking_findings is above zero'),
      rejected: F(rejected, 'approval records whose verdict is rejected'),
      amendments: F(amendments, 'headings "### A-<spec>-<n>" across the spec.md files'),
      decisions: F(decisions, 'second-level headings in DECISIONS.md'),
      audits: F(audits, 'files under specs/000-governance/external-audits/'),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  const i = process.argv.indexOf('--at');
  const at = i > 0 ? process.argv[i + 1] : (cur ? JSON.parse(cur).at : null);
  if (!at) { console.error('usage: build-facts.mjs --at <sha> | --check'); process.exit(2); }
  const text = JSON.stringify(facts(at), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (cur !== text) { console.error('docs/data/build-facts.json is stale'); process.exit(1); }
    console.log('docs/data/build-facts.json matches the records');
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`wrote docs/data/build-facts.json`);
  }
}
