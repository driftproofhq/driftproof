#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Rebuild receipts/report-001/{<slug>__drift.md, _index.json} from the CURRENT
// receipts using the current (floor-aware) lib/diff. Used after regenerating a
// subset of receipts and/or after a verdict-rule change (effect floor), so every
// derived artifact is consistent with the receipts and the diff logic. Keeps
// _index.totals (call counts) — regeneration re-rolled scores, not case counts.

const fs = require('fs');
const path = require('path');
const { buildDriftReport } = require('../lib/diff');
const { resolveModel } = require('../lib/provider');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'receipts', 'report-001');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', 'manifest.json'), 'utf8'));
const NEW = resolveModel(manifest.model_pair.new);
const OLD = resolveModel(manifest.model_pair.old);

const prevIndex = JSON.parse(fs.readFileSync(path.join(DIR, '_index.json'), 'utf8'));
const index = { ...prevIndex, skills: [] };

for (const s of manifest.skills) {
  const nP = path.join(DIR, `${s.slug}__${NEW}.json`);
  const oP = path.join(DIR, `${s.slug}__${OLD}.json`);
  if (!fs.existsSync(nP) || !fs.existsSync(oP)) { console.error(`skip ${s.slug}: missing receipt`); continue; }
  const rNew = JSON.parse(fs.readFileSync(nP, 'utf8'));
  const rOld = JSON.parse(fs.readFileSync(oP, 'utf8'));
  const drift = buildDriftReport(rOld, rNew, { labelA: `old ${OLD}`, labelB: `new ${NEW}` });
  fs.writeFileSync(path.join(DIR, `${s.slug}__drift.md`), drift.markdown);
  const headline = drift.markdown.split('**')[1] || '';
  index.skills.push({
    slug: s.slug,
    name: rNew.skill.name,
    content_hash: rNew.skill.content_hash,
    suite_hash: rNew.suite.suite_hash,
    case_count: rNew.suite.case_count,
    receipts: { new: `${s.slug}__${NEW}.json`, old: `${s.slug}__${OLD}.json` },
    new_agg: rNew.results.aggregates,
    old_agg: rOld.results.aggregates,
    headline,
    per_case: drift.perCase.map((c) => ({ id: c.id, before: c.before, after: c.after, delta: c.delta, verdict: c.verdict })),
    regressions: drift.perCase.filter((c) => c.verdict === 'regression').map((c) => c.id),
    improvements: drift.perCase.filter((c) => c.verdict === 'improvement').map((c) => c.id),
  });
}
fs.writeFileSync(path.join(DIR, '_index.json'), JSON.stringify(index, null, 2));
const reg = index.skills.filter((s) => s.regressions.length && !s.improvements.length).length;
const imp = index.skills.filter((s) => s.improvements.length && !s.regressions.length).length;
const mix = index.skills.filter((s) => s.regressions.length && s.improvements.length).length;
const noise = index.skills.filter((s) => !s.regressions.length && !s.improvements.length).length;
console.log(`rebuilt _index + drift for ${index.skills.length} skills: ${reg} reg / ${imp} imp / ${mix} mixed / ${noise} noise`);
