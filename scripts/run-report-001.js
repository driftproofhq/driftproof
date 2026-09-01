#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Orchestrate the full Report #001 run: for every skill in the manifest, run the
// authored suite with_skill + baseline on BOTH models of the pair, emit v0.2
// receipts to receipts/report-001/, then diff old→new per skill. Writes an
// _index.json summarizing every per-case band verdict (the report generator and
// the gate both re-derive from the receipts, not from this cache).
//
// Published-run defaults: pair = claude-sonnet-5 (new) vs claude-sonnet-4-6
// (old); judge = claude-haiku-4-5, n=5. Provider is whatever CLAUDE_PROVIDER is
// (this report ran on `cli`, subscription, $0 metered).
//
// Usage:
//   node scripts/run-report-001.js [--only slug1,slug2] [--samples 5]
//        [--concurrency 5] [--max-cases N] [--new claude-sonnet-5] [--old claude-sonnet-4-6]
//        [--judge-model claude-haiku-4-5] [--out receipts/report-001]

const fs = require('fs');
const path = require('path');
const { loadSkill } = require('../lib/skill');
const { runSkillOnModel } = require('../lib/run');
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { buildDriftReport } = require('../lib/diff');
const { resolveModel, surfaceLabel } = require('../lib/provider');
const { estimateRunCostUSD, BudgetTracker } = require('../lib/cost');
// Spec 016 AC-7: `estimateRunCostUSD` requires an explicit draw factor. v0.5 draws
// the generation up to SAMPLING.max times per arm, so a projection at one draw
// understates a real run by up to that factor — in the figure a human reads
// before authorising a paid run.
const { SAMPLING } = require('../lib/sampling');

const ROOT = path.join(__dirname, '..');
const TRANSCRIPTS_DIR = path.join(ROOT, 'transcripts');

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// Write retained transcripts for one receipt to transcripts/<receipt_hash>/ —
// same layout as bin/driftproof (gitignored; raw model text never committed).
function writeTranscripts(receipt, transcripts) {
  const dir = path.join(TRANSCRIPTS_DIR, receipt.receipt_hash);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { receipt_hash: receipt.receipt_hash, model_id: receipt.run.model_id, date_utc: receipt.run.date_utc, entries: [] };
  for (const t of transcripts) {
    if (!t) continue;
    const base = `${slug(t.id)}-${t.mode}`;
    fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ id: t.id, mode: t.mode, generation: t.generation, judge_outputs: t.judge_outputs }, null, 2));
    manifest.entries.push(`${base}.json`);
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', 'manifest.json'), 'utf8'));
  const workdir = path.join(ROOT, '.skills-workdir');
  const outDir = path.resolve(flags.out || path.join(ROOT, 'receipts', 'report-001'));
  fs.mkdirSync(outDir, { recursive: true });

  const newModel = flags.new || manifest.model_pair.new;   // claude-sonnet-5
  const oldModel = flags.old || manifest.model_pair.old;   // claude-sonnet-4-6
  const judgeModel = flags['judge-model'] || manifest.judge_model; // claude-haiku-4-5
  const samples = flags.samples ? parseInt(flags.samples, 10) : 5;
  const concurrency = flags.concurrency ? parseInt(flags.concurrency, 10) : 5;
  // spec 017 AC-1 / approval-20260831T143513Z non-blocking finding 3(c): a
  // literal default HERE outranked the declared per-surface policy exactly
  // like W-1's site in lib/run.js did, forcing 300s onto an api surface whose
  // policy declares 120s. `undefined` when the operator did not pass --timeout,
  // matching scripts/prepare-report-00*.js's own `DRIFTPROOF_TIMEOUT_MS`
  // pattern — only an explicit operator input reaches opts.timeoutMs, which is
  // exactly the case AC-1's "unless" clause admits.
  const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) : undefined;
  const maxCases = flags['max-cases'] ? parseInt(flags['max-cases'], 10) : null;
  const only = flags.only ? new Set(String(flags.only).split(',').map((s) => s.trim())) : null;
  const keepTranscripts = !!flags['keep-transcripts'];
  const maxUsd = flags['max-usd'] ? parseFloat(flags['max-usd']) : Infinity;

  const surface = surfaceLabel();
  let skills = manifest.skills.filter((s) => !only || only.has(s.slug));

  console.log(`\nDriftproof Report #001 run`);
  console.log(`  pair: ${newModel} (new) vs ${oldModel} (old)   judge: ${judgeModel} n=${samples}`);
  console.log(`  surface: ${surface}   concurrency: ${concurrency}   skills: ${skills.length}${maxCases ? `   max-cases: ${maxCases}` : ''}${keepTranscripts ? '   transcripts: retained-local' : ''}\n`);

  // Up-front cost projection across ALL selected skills. HARD CAP: refuse the
  // whole run BEFORE any model call if the projection exceeds --max-usd (on the
  // cli surface the metered spend is $0, but the estimated-equivalent is counted
  // identically so subscription usage is never treated as free).
  let projTotal = 0;
  for (const s of skills) {
    const sd = path.join(workdir, s.slug);
    if (!fs.existsSync(path.join(sd, 'SKILL.md')) || !fs.existsSync(path.join(sd, 'evals', 'evals.json'))) continue;
    const sk = loadSkill(sd);
    const nC = maxCases ? Math.min(maxCases, sk.suite.caseCount) : sk.suite.caseCount;
    projTotal += estimateRunCostUSD({ draws: SAMPLING.max, caseCount: nC, samples, models: [newModel, oldModel], judgeModel }).totalUSD;
  }
  console.log(`  projected metered-equivalent cost: ~$${projTotal.toFixed(2)}   cap: ${maxUsd === Infinity ? '(none)' : '$' + maxUsd.toFixed(2)}`);
  if (projTotal > maxUsd) {
    console.error(`\nABORT (cost guard): projected ~$${projTotal.toFixed(2)} exceeds --max-usd $${maxUsd.toFixed(2)}. No model call made. Reduce scope or raise the cap.`);
    process.exit(3);
  }
  const budget = maxUsd === Infinity ? null : new BudgetTracker(maxUsd);

  const index = { report: 'report-001', generated_note: 'derive verdicts from receipts, not this cache', pair: { new: resolveModel(newModel), old: resolveModel(oldModel) }, judge_model: resolveModel(judgeModel), samples, surface, skills: [] };
  let totalCalls = 0;
  let totalUsd = 0;
  const failures = [];

  for (const s of skills) {
    const skillDir = path.join(workdir, s.slug);
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) { console.error(`  ! ${s.slug}: no fetched SKILL.md (run scripts/fetch-skills.js) — skipping`); continue; }
    if (!fs.existsSync(path.join(skillDir, 'evals', 'evals.json'))) { console.error(`  ! ${s.slug}: no staged suite — skipping`); continue; }

    try {
    const skill = loadSkill(skillDir);
    const nCases = maxCases ? Math.min(maxCases, skill.suite.caseCount) : skill.suite.caseCount;
    const est = estimateRunCostUSD({ draws: SAMPLING.max, caseCount: nCases, samples, models: [newModel, oldModel], judgeModel });
    console.log(`── ${s.slug}  (${nCases} cases, ~$${est.totalUSD.toFixed(2)} metered est) ──`);

    const receiptByRole = {};
    for (const [role, modelId] of [['new', newModel], ['old', oldModel]]) {
      const t0 = Date.now();
      const { receipt, calls, transcripts } = await runSkillOnModel({
        skill, model: modelId,
        opts: { samples, judgeModel, concurrency, maxCases, maxCalls: 500, keepTranscripts, budget, ...(timeoutMs != null ? { timeoutMs } : {}) },
      });
      totalCalls += calls;
      const v = validateReceipt(receipt);
      if (!v.valid) { console.error(`    ✗ ${role} receipt INVALID`, JSON.stringify(v.errors).slice(0, 300)); process.exit(1); }
      if (!verifyReceiptHash(receipt)) { console.error(`    ✗ ${role} receipt_hash mismatch`); process.exit(1); }
      const base = `${s.slug}__${resolveModel(modelId)}`;
      fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify(receipt, null, 2));
      if (keepTranscripts && transcripts) { const td = writeTranscripts(receipt, transcripts); console.log(`      transcripts (retained-local) → ${path.relative(process.cwd(), td)}/`); }
      receiptByRole[role] = receipt;
      const aw = receipt.results.aggregates.with_skill, ab = receipt.results.aggregates.baseline;
      console.log(`    ${role} ${resolveModel(modelId)}: with ${aw.mean_score.toFixed(3)}±${aw.stddev.toFixed(3)}  base ${ab.mean_score.toFixed(3)}  (${calls} calls, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    totalUsd += est.totalUSD;

    // Drift: old → new (A = old, B = new), so a regression = new below old.
    const drift = buildDriftReport(receiptByRole.old, receiptByRole.new, { labelA: `old ${resolveModel(oldModel)}`, labelB: `new ${resolveModel(newModel)}` });
    fs.writeFileSync(path.join(outDir, `${s.slug}__drift.md`), drift.markdown);
    const headline = drift.markdown.split('**')[1] || '';
    console.log(`    drift: ${headline}\n`);

    index.skills.push({
      slug: s.slug,
      name: skill.name,
      content_hash: skill.contentHash,
      suite_hash: skill.suite.suiteHash,
      case_count: skill.suite.caseCount,
      receipts: { new: `${s.slug}__${resolveModel(newModel)}.json`, old: `${s.slug}__${resolveModel(oldModel)}.json` },
      new_agg: receiptByRole.new.results.aggregates,
      old_agg: receiptByRole.old.results.aggregates,
      headline,
      per_case: drift.perCase.map((c) => ({ id: c.id, before: c.before, after: c.after, delta: c.delta, verdict: c.verdict })),
      regressions: drift.regressions.map((r) => r.id),
      improvements: drift.perCase.filter((c) => c.verdict === 'improvement').map((c) => c.id),
    });
    } catch (e) {
      console.error(`    ✗ ${s.slug} FAILED: ${e && (e.message || e)} — continuing with remaining skills`);
      failures.push({ slug: s.slug, error: String(e && (e.message || e)) });
    }
  }

  index.failures = failures;
  index.totals = { calls: totalCalls, metered_usd_estimate: Math.round(totalUsd * 100) / 100, surface, actual_metered_usd: surface === 'api' ? Math.round(totalUsd * 100) / 100 : 0, failed: failures.length };
  fs.writeFileSync(path.join(outDir, '_index.json'), JSON.stringify(index, null, 2));
  console.log(`Done. ${index.skills.length} skill(s). Total calls: ${totalCalls}. Metered est: ~$${totalUsd.toFixed(2)} (actual on ${surface}: $${index.totals.actual_metered_usd.toFixed(2)}).`);
  console.log(`Receipts + _index.json → ${path.relative(process.cwd(), outDir)}/`);
}

main().catch((e) => { console.error('FATAL', e && (e.stack || e.message || e)); process.exit(2); });
