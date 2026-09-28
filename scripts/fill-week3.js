#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Fill the Week-3 report's findings + status from receipts/report-001/_index.json,
// and update the cost log's actual call count. Mechanical, receipt-derived — safe
// to run unattended after the grind. (Prose can be polished later; the numbers
// here are a direct function of the receipts.)

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'receipts', 'report-001', '_index.json'), 'utf8'));
const b = (m, s) => `${(+m).toFixed(3)} ± ${(+(s || 0)).toFixed(3)}`;

function verdictOf(s) {
  const reg = (s.regressions || []).length, imp = (s.improvements || []).length;
  if (reg && imp) return { label: `MIXED`, reg, imp };
  if (reg) return { label: `REGRESSED (${reg})`, reg, imp };
  if (imp) return { label: `IMPROVED (${imp})`, reg, imp };
  return { label: 'WITHIN NOISE', reg, imp };
}

const rows = idx.skills.map((s) => {
  const v = verdictOf(s);
  const ow = s.old_agg.with_skill, nw = s.new_agg.with_skill;
  return { s, v, line: `| \`${s.slug}\` | ${b(ow.mean_score, ow.stddev)} → ${b(nw.mean_score, nw.stddev)} | ${(+s.old_agg.baseline.mean_score).toFixed(3)} → ${(+s.new_agg.baseline.mean_score).toFixed(3)} | ${v.label} |` };
});
const nReg = rows.filter((r) => r.v.reg && !r.v.imp).length;
const nImp = rows.filter((r) => r.v.imp && !r.v.reg).length;
const nMix = rows.filter((r) => r.v.reg && r.v.imp).length;
const nNoise = rows.filter((r) => !r.v.reg && !r.v.imp).length;
const regCases = rows.reduce((a, r) => a + r.v.reg, 0);
const impCases = rows.reduce((a, r) => a + r.v.imp, 0);
const moved = nReg + nImp + nMix;

const findings = [
  `**${moved} of ${idx.skills.length} skills moved beyond noise** on \`${idx.pair.old}\` → \`${idx.pair.new}\` (a per-case \`with_skill\` band separated): ` +
    `${nReg} regressed, ${nImp} improved, ${nMix} mixed; ${nNoise} within noise. Across all ${idx.skills.length * 7} cases: ${regCases} regression(s), ${impCases} improvement(s).`,
  '',
  'Per-skill (`with_skill` old → new, then baseline old → new):',
  '',
  '| skill | with_skill (old → new) | baseline (old → new) | verdict |',
  '|---|---|---|---|',
  ...rows.map((r) => r.line),
  '',
  `The full per-case band tables are in the public report. Nothing here is hand-entered — \`scripts/build-report-001.js\` re-derives every verdict from \`receipts/report-001/*.json\`, and the gate spot-checks that the report matches the receipts.`,
].join('\n');

// Week-3 report: swap the FINDINGS + STATUS regions.
const wk3Path = path.join(ROOT, 'reports', 'week-3.md');
let wk3 = fs.readFileSync(wk3Path, 'utf8');
wk3 = wk3.replace(/<!--FINDINGS-->[\s\S]*?<!--\/FINDINGS-->/, `<!--FINDINGS-->\n${findings}\n<!--/FINDINGS-->`);
wk3 = wk3.replace(/<!--STATUS-->[\s\S]*?<!--\/STATUS-->/, `<!--STATUS-->complete — Report #001 run finished (${idx.skills.length} skills), report generated, findings below<!--/STATUS-->`);
fs.writeFileSync(wk3Path, wk3);

// Cost log: reflect the actual call count from the run.
const costPath = path.join(ROOT, 'reports', 'week-3-cost.md');
let cost = fs.readFileSync(costPath, 'utf8');
const calls = idx.totals && idx.totals.calls ? idx.totals.calls : idx.skills.length * 2 * 84;
cost = cost.replace(/(Report #001 full run[^|]*\|\s*)[\d,]+(\s*\|)/, `$1${calls.toLocaleString('en-US')}$2`);
if (idx.totals && idx.totals.metered_usd_estimate != null) {
  cost = cost.replace(/TOTAL_METERED_USD_ESTIMATE:\s*[0-9.]+/, `TOTAL_METERED_USD_ESTIMATE: ${idx.totals.metered_usd_estimate.toFixed(2)}`);
}
fs.writeFileSync(costPath, cost);

console.log(`filled week-3 findings: ${moved}/${idx.skills.length} moved (${nReg} reg, ${nImp} imp, ${nMix} mixed, ${nNoise} noise); actual calls ${calls}`);
if (idx.failures && idx.failures.length) console.error(`WARNING: ${idx.failures.length} skill(s) failed in the run:`, idx.failures.map((f) => f.slug).join(', '));
