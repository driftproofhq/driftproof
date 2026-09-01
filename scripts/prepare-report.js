#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report.js — build a DRAFT drift report for a model pair.
//
// Invoked by scripts/release-watch.js when a new model appears (or by hand). It:
//   1. re-fetches the pinned skills (scripts/fetch-skills.js) unless --stub,
//   2. re-runs the Report-#001 suites on the pair (new vs its predecessor),
//      n=5, under the $25 trigger cap — trimming to the 6 highest-traffic skills
//      if the projection would exceed the cap (and noting the trim),
//   3. emits receipts to receipts/report-NNN-draft/,
//   4. builds a DRAFT page under docs/reports/NNN-draft/ (NOT linked from the
//      index, NOT pushed to the public tree),
//   5. writes a one-paragraph summary + verdict tally to reports/pending-publish.md
//      and, if ~/.moltbot exists, appends a note to ~/.driftproof-notify.
//
// NOTIFY, DON'T PUBLISH. Publishing is a manual step — see RUNBOOK.md.
//
// --stub STUBS the runner (no model calls) with deterministic synthetic
// receipts, so the whole pipeline is exercisable offline by the gate.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { buildReceipt, validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { buildDriftReport } = require('../lib/diff');
const { sha256 } = require('../lib/canonical');
const { mean, stddev } = require('../lib/stats');
const { outcomeFor, releaseDateFor, runSkillOnModel } = require('../lib/run');
const { loadSkill } = require('../lib/skill');
const { estimateRunCostUSD, BudgetTracker } = require('../lib/cost');
// Spec 016 AC-7: `estimateRunCostUSD` requires an explicit draw factor. v0.5 draws
// the generation up to SAMPLING.max times per arm, so a projection at one draw
// understates a real run by up to that factor — in the figure a human reads
// before authorising a paid run.
const { SAMPLING } = require('../lib/sampling');
const { registryStatus, providerForModel } = require('../lib/models');
const { surfaceForModel, CODEX_OVERHEAD_NOTE } = require('../lib/provider');
const { estimateTokens } = require('../lib/skillCost');
const { TRIGGER_MAX_USD, RUNNER_VERSION } = require('../config');

const MANIFEST = path.join(ROOT, 'suites', 'manifest.json');
const TRIM_KEEP = 6; // trim target when projection exceeds the cap

// Inputs (manifest, suites) always come from ROOT (read-only). Outputs (docs
// draft, draft receipts, pending-publish.md) go under `outRoot` — ROOT for real
// runs, a temp dir for the gate — so the pipeline is testable without polluting
// the repo. The notify file lives under `homeDir` (~ for real runs).
function outPaths(outRoot) {
  return {
    docsReports: path.join(outRoot, 'docs', 'reports'),
    pendingPublish: path.join(outRoot, 'reports', 'pending-publish.md'),
    receiptsRoot: path.join(outRoot, 'receipts'),
  };
}

function loadManifest() { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }

// Next report number by scanning docs/reports/ for NNN(-draft)? directories.
function nextReportNumber(docsReports) {
  let max = 0;
  if (fs.existsSync(docsReports)) {
    for (const name of fs.readdirSync(docsReports)) {
      const m = name.match(/^(\d{3})(?:-draft)?$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return String(max + 1).padStart(3, '0');
}

// ── stub receipt generation (no model calls) ─────────────────────────────────
function h(seed) { return sha256(String(seed)); }

// Deterministic synthetic samples for one (skill, model, mode). The new model
// regresses skills whose index is divisible by 3 (so a tally has all buckets).
function synthSamples(slug, idx, isNew, withSkill) {
  const base = withSkill ? 0.82 : 0.40;
  let center = base;
  if (isNew && withSkill && idx % 3 === 0) center = base - 0.20; // regression
  if (isNew && withSkill && idx % 3 === 1) center = base + 0.02; // within noise
  return [center, center, center, center, center].map((x) => Math.max(0, Math.min(1, x)));
}

function synthCase(slug, idx, model, mode, withSkill, isNew, caseId) {
  const samples = synthSamples(slug, idx, isNew, withSkill);
  const m = mean(samples), sd = stddev(samples);
  return {
    id: caseId, mode, outcome: outcomeFor(m, sd, 0.7), score: m, mean: m, stddev: sd, samples,
    generation_hash: h(`${slug}|${model}|${mode}|${caseId}|gen`),
    judge_sample_hashes: samples.map((_s, i) => h(`${slug}|${model}|${mode}|${caseId}|j${i}`)),
    threshold: 0.7, reason: 'synthetic (stub prepare-report)',
    judge: { model_id: 'claude-haiku-4-5', rubric_hash: h(`${slug}|${caseId}|rubric`) },
  };
}

function stubReceipt(skill, idx, model, isNew, nowIso) {
  const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', skill.slug, 'evals.json'), 'utf8'));
  const caseList = (suite.cases || suite.evals || []).map((c, i) => String(c.id || c.name || `case-${i + 1}`));
  const cases = [];
  for (const cid of caseList) {
    cases.push(synthCase(skill.slug, idx, model, 'with_skill', true, isNew, cid));
    cases.push(synthCase(skill.slug, idx, model, 'baseline', false, isNew, cid));
  }
  // Provider/surface are per-model (v0.3.1): a trigger may prepare a draft for a
  // new OpenAI model as well as a new Claude model, so the synthetic receipt must
  // carry the correct provider + disclosed surface, not a hardcoded claude-cli.
  const surface = surfaceForModel(model);
  return buildReceipt({
    skill: { name: skill.name || skill.slug, version: '0.0.0', contentHash: h(`${skill.slug}|content`), tokens: 1200 + (parseInt(h(skill.slug).slice(0, 4), 16) % 4000) },
    suite: { format: 'agentskills.io/evals', suiteHash: h(`${skill.slug}|suite`), caseCount: caseList.length },
    run: {
      model_id: model, model_release_date: releaseDateFor(model),
      provider: providerForModel(model), surface,
      surface_overhead_note: surface === 'openai-cli' ? CODEX_OVERHEAD_NOTE : undefined,
      runner_version: RUNNER_VERSION, date_utc: nowIso, registry: registryStatus(model), transcripts: 'hashes-only',
      judge: { samples: 5, temperature: null, sampling: 'surface-controlled', surface: 'claude-cli' },
    },
    cases, verificationLevel: 'TESTED',
  });
}

// ── live run of one pair (non-stub) ──────────────────────────────────────────
async function liveRunSkill(skill, model, budget, samples, nowIso) {
  const loaded = loadSkill(path.join(ROOT, '.skills-workdir', skill.slug));
  const { receipt } = await runSkillOnModel({
    skill: loaded, model,
    opts: { samples, judgeModel: 'claude-haiku-4-5', maxCalls: 500, concurrency: 4, budget, keepTranscripts: true, nowIso },
  });
  return receipt;
}

// ── report building ──────────────────────────────────────────────────────────
function skillVerdict(drift) {
  const reg = drift.perCase.filter((c) => c.verdict === 'regression').length;
  const imp = drift.perCase.filter((c) => c.verdict === 'improvement').length;
  const label = reg && imp ? 'MIXED' : reg ? `REGRESSED (${reg})` : imp ? `IMPROVED (${imp})` : 'WITHIN NOISE';
  return { label, reg, imp };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function draftHtml({ number, pair, rows, tally, trimmed, generatedUtc, crossFamily }) {
  const rowsHtml = rows.map((r) => `      <tr><td><code>${esc(r.slug)}</code></td><td>${esc(r.label)}</td><td>${r.cases}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof — Report #${number} (DRAFT)</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a></nav></header>
<main class="hero">
  <div class="card" style="border:2px solid var(--mixed);">
    <strong>⚠ DRAFT — not published.</strong> This report was auto-prepared by the release trigger when
    <code>${esc(pair.new)}</code> appeared. It is <em>not</em> linked from the index and has <em>not</em> been
    pushed to the public tree. A human must review and run the approve-and-publish sequence in
    <code>RUNBOOK.md</code> before this becomes a real report.
  </div>
  <h1>Report #${number} — <code>${esc(pair.new)}</code> vs <code>${esc(pair.old)}</code> ${crossFamily ? '(capability gap)' : ''}</h1>
  <p class="lede">Auto-prepared ${esc(generatedUtc)}. ${crossFamily ? 'No servable same-family predecessor existed, so this is an honest cross-family <strong>capability-gap</strong> comparison, not a like-for-like drift measurement.' : 'New model vs its family predecessor.'}</p>
  <p><strong>Verdict tally:</strong> ${tally.regressed} regressed · ${tally.improved} improved · ${tally.noise} within noise · ${tally.mixed} mixed (of ${rows.length} skills).</p>
  ${trimmed ? `<div class="card"><strong>Trimmed.</strong> The full projection exceeded the $${TRIGGER_MAX_USD} trigger cap, so this draft covers the ${TRIM_KEEP} highest-traffic skills only (proxy: manifest order — no per-skill traffic signal is available yet). Re-run without the cap to cover all skills before publishing.</div>` : ''}
  <table>
    <thead><tr><th>skill</th><th>verdict</th><th>cases</th></tr></thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  <p class="muted">Every verdict is re-derived from the receipts under <code>receipts/report-${number}-draft/</code>; nothing here is hand-entered.</p>
</main>
<footer class="site"><span>Driftproof · Apache-2.0</span><span>DRAFT</span></footer>
</body>
</html>
`;
}

function appendPending(pendingPath, entry) {
  fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
  let head = '';
  if (!fs.existsSync(pendingPath)) {
    head = '<!-- SPDX-License-Identifier: Apache-2.0 -->\n'
      + '# Pending-publish queue\n\n'
      + 'Auto-prepared draft reports awaiting human review + publish. Each entry is a\n'
      + 'notification, NOT a published report. To approve and publish one, follow the\n'
      + 'approve-and-publish sequence in [RUNBOOK.md](../RUNBOOK.md). Remove the entry\n'
      + 'once published.\n\n';
  }
  fs.appendFileSync(pendingPath, head + entry + '\n');
}

function notifyMoltbot(homeDir, summaryLine) {
  const moltbot = path.join(homeDir, '.moltbot');
  if (!fs.existsSync(moltbot)) return false;
  const notifyFile = path.join(homeDir, '.driftproof-notify');
  // Local file only — deliberately NOT posted to Moltbook.
  fs.appendFileSync(notifyFile, summaryLine + '\n');
  return true;
}

// Main entry. Returns a structured result (no process.exit) so the gate can call
// it directly with a stub. Never touches the public tree or the site index.
async function prepareReport(opts = {}) {
  const {
    newModel, oldModel, stub = false, now = null, maxUsd = TRIGGER_MAX_USD,
    crossFamily = false, notify = true, outRoot = ROOT, homeDir = os.homedir(),
  } = opts;
  if (!newModel || !oldModel) throw new Error('prepareReport requires newModel and oldModel');
  const nowIso = now || new Date().toISOString();
  const paths = outPaths(outRoot);
  const number = nextReportNumber(paths.docsReports);
  const pair = { new: newModel, old: oldModel };

  const manifest = loadManifest();
  let skills = manifest.skills.slice();

  // Cost projection across all skills × both models; trim to TRIM_KEEP if over cap.
  const nCasesTotal = skills.reduce((a, s) => {
    const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', s.slug, 'evals.json'), 'utf8'));
    return a + (suite.cases || suite.evals || []).length;
  }, 0);
  const proj = estimateRunCostUSD({ draws: SAMPLING.max, caseCount: nCasesTotal, samples: 5, models: [pair.new, pair.old], judgeModel: 'claude-haiku-4-5' });
  let trimmed = false;
  if (proj.totalUSD > maxUsd) { skills = skills.slice(0, TRIM_KEEP); trimmed = true; }

  // Emit receipts for the pair.
  const receiptsDir = path.join(paths.receiptsRoot, `report-${number}-draft`);
  fs.mkdirSync(receiptsDir, { recursive: true });
  const budget = stub ? null : new BudgetTracker(maxUsd);
  const rows = [];
  const tally = { regressed: 0, improved: 0, noise: 0, mixed: 0 };

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    let rNew, rOld;
    if (stub) {
      rNew = stubReceipt(s, i, pair.new, true, nowIso);
      rOld = stubReceipt(s, i, pair.old, false, nowIso);
    } else {
      rNew = await liveRunSkill(s, pair.new, budget, 5, nowIso);
      rOld = await liveRunSkill(s, pair.old, budget, 5, nowIso);
    }
    for (const r of [rNew, rOld]) {
      const v = validateReceipt(r);
      if (!(v.valid && verifyReceiptHash(r))) throw new Error(`invalid receipt for ${s.slug} (${r.run.model_id})`);
    }
    fs.writeFileSync(path.join(receiptsDir, `${s.slug}__${pair.new}.json`), JSON.stringify(rNew, null, 2));
    fs.writeFileSync(path.join(receiptsDir, `${s.slug}__${pair.old}.json`), JSON.stringify(rOld, null, 2));

    const drift = buildDriftReport(rOld, rNew, {});
    const { label, reg, imp } = skillVerdict(drift);
    if (reg && imp) tally.mixed++; else if (reg) tally.regressed++; else if (imp) tally.improved++; else tally.noise++;
    rows.push({ slug: s.slug, label, cases: rNew.suite.case_count });
  }

  // Build the DRAFT page (under -draft; never linked, never pushed).
  const draftDir = path.join(paths.docsReports, `${number}-draft`);
  fs.mkdirSync(draftDir, { recursive: true });
  fs.writeFileSync(path.join(draftDir, 'index.html'), draftHtml({ number, pair, rows, tally, trimmed, generatedUtc: nowIso, crossFamily }));

  // Notify (pending-publish.md + ~/.driftproof-notify), never publish.
  const summary = `Report #${number} DRAFT ready: ${pair.new} vs ${pair.old}${crossFamily ? ' (capability gap)' : ''}`
    + ` — ${tally.regressed} regressed / ${tally.improved} improved / ${tally.noise} noise / ${tally.mixed} mixed`
    + ` over ${rows.length} skills${trimmed ? ' (TRIMMED to ' + TRIM_KEEP + ')' : ''}.`;
  const entry = `## [${nowIso}] ${summary}\n\n`
    + `- Draft page: \`docs/reports/${number}-draft/index.html\` (noindex, NOT linked, NOT pushed)\n`
    + `- Receipts: \`receipts/report-${number}-draft/\`\n`
    + `- Pair: \`${pair.new}\` (new) vs \`${pair.old}\` (${crossFamily ? 'cross-family capability gap' : 'family predecessor'})\n`
    + `- To publish: follow RUNBOOK.md § "Approve and publish a drafted report".\n`;
  appendPending(paths.pendingPublish, entry);
  const notified = notify ? notifyMoltbot(homeDir, summary) : false;

  return { reportNumber: number, draftDir, receiptsDir, tally, rows, trimmed, crossFamily, pendingEntry: entry, summary, notifiedMoltbot: notified, publicTreeTouched: false };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2); const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) flags[k] = true; else { flags[k] = n; i++; }
    }
  }
  return flags;
}

async function main() {
  const f = parseArgs(process.argv.slice(2));
  if (!f.new || !f.old) {
    console.error('usage: prepare-report.js --new <model> --old <model> [--stub] [--cross-family] [--max-usd N] [--now ISO]');
    process.exit(2);
  }
  // Non-stub run fetches the pinned skills first.
  if (!f.stub) {
    try { execFileSync('node', [path.join(__dirname, 'fetch-skills.js')], { cwd: ROOT, stdio: 'inherit' }); }
    catch (e) { console.error('fetch-skills failed:', e.message); process.exit(1); }
  }
  const res = await prepareReport({
    newModel: f.new, oldModel: f.old, stub: !!f.stub, crossFamily: !!f['cross-family'],
    maxUsd: f['max-usd'] ? parseFloat(f['max-usd']) : TRIGGER_MAX_USD, now: f.now || null,
  });
  console.log(res.summary);
  console.log(`draft: ${path.relative(ROOT, res.draftDir)}/index.html`);
  console.log(`pending-publish.md updated${res.notifiedMoltbot ? ' + ~/.driftproof-notify appended' : ''}.`);
  console.log('NOT published — see RUNBOOK.md to approve.');
}

if (require.main === module) main().catch((e) => { console.error('FATAL', e && (e.stack || e.message)); process.exit(1); });

module.exports = { prepareReport, nextReportNumber, TRIM_KEEP };
