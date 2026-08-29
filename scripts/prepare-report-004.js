#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-004.js — stage Driftproof Report #004, a CAPABILITY-GAP report.
//
// Report #004 is NOT release drift: claude-fable-5 has NO family predecessor
// (registry family "fable" has one member), so this is a CROSS-FAMILY study of
// one provider's two tiers — claude-opus-5 (flagship) vs claude-fable-5
// (frontier). The headline question: does encoded expertise still lift output
// on the frontier tier — or do baselines catch up further (the ceremonial-skill
// thesis at the edge)?
//
// Verdict vocabulary follows Report #002's durability style adapted to one
// provider / two tiers: per skill, the with/without delta on EACH model with
// bands (per-case band separation + the 0.05 effect floor, same anti-cry-wolf
// rule), and the tier comparison as CONTEXT — absolute cross-tier scores are
// never a ranking. Labels: DURABLE / TIER-DEPENDENT / REGRESSES on <model> /
// NO EFFECT, with low-resolution point-band flags.
//
// This is a THIN WRAPPER over the shared libs (the #003 pattern):
//   - lib/run.runSkillOnModel does the sampled run + failed_timeout tolerance;
//   - per-model with/without direction is the #002 substrate-direction rule;
//   - checkpoint/resume + restore is the #002/#003 pattern (a completed
//     skill×model receipt is skipped on re-run; re-fire the same command to
//     resume after a throttle).
//
// Default is a STUB dry run (deterministic synthetic receipts, zero model
// calls). `--execute` fetches the pinned skills, LIGHT-smokes both models
// (ONE tiny completion each — 2 live calls total — aborting loudly if either
// is unservable), then runs all 10 suites on both models. NOTIFY, DON'T
// PUBLISH (see RUNBOOK.md).
//
// REGISTRY NOTE (flagged per the run instructions): claude-fable-5's registry
// `released` field was null (the entry pre-dated availability); it is now
// "2026-06-09" — verified from Anthropic's own announcements: launched
// 2026-06-09, export-controlled 2026-06-12→30, redeployed globally 2026-07-01.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { receiptLinksBlock } = require('./receipt-links.js');

const ROOT = path.join(__dirname, '..');
const { buildReceipt, validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { sha256 } = require('../lib/canonical');
const { mean, stddev, bandVerdict } = require('../lib/stats');
const { outcomeFor, releaseDateFor, runSkillOnModel, projectCalls } = require('../lib/run');
const { loadSkill } = require('../lib/skill');
const { estimateRunCostUSD, BudgetTracker } = require('../lib/cost');
const { registryStatus, providerForModel } = require('../lib/models');
const { complete, surfaceForModel, isSubscriptionSurface } = require('../lib/provider');
const {
  REPORT_004_BASE_MODEL, REPORT_004_FRONTIER_MODEL, REPORT_004_JUDGE_MODEL,
  REPORT_MAX_USD, RUNNER_VERSION, EFFECT_FLOOR,
} = require('../config');

const MANIFEST = path.join(ROOT, 'suites', 'manifest.json');
const REPORT_NUMBER = '004';
const FABLE_RELEASE_NOTE = 'claude-fable-5 registry released field updated null → 2026-06-09 for this report (verified from Anthropic announcements; launched 2026-06-09, export-control pause 06-12→30, redeployed 2026-07-01).';

function loadManifest() { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
function h(seed) { return sha256(String(seed)); }

function outPaths(outRoot) {
  return {
    docsReports: path.join(outRoot, 'docs', 'reports'),
    pendingPublish: path.join(outRoot, 'reports', 'pending-publish.md'),
    receiptsRoot: path.join(outRoot, 'receipts'),
  };
}

function disclosedSurface(model) {
  return process.env.ANTHROPIC_API_KEY ? 'api' : 'claude-cli';
}

// ── stub receipt generation (deterministic, zero model calls) ─────────────────
function synthSkillTokens(slug) { return 300 + (parseInt(h(slug).slice(0, 6), 16) % 5700); }

// Stub design encodes the report's QUESTION so the dry run exercises every
// verdict bucket: on the frontier model some baselines CATCH UP (lift collapses
// → NO EFFECT / TIER-DEPENDENT), some skills still lift (DURABLE), one hurts.
function synthSamples(idx, ci, isFrontier, withSkill) {
  const spread = (c, pointBand) => (pointBand
    ? [c, c, c, c, c]
    : [c - 0.02, c - 0.01, c, c + 0.01, c + 0.02]).map((x) => Math.max(0, Math.min(1, x)));
  const k = idx % 4; // per-skill scenario: 0=durable 1=catch-up 2=hurt-on-frontier 3=no-effect
  if (!withSkill) {
    if (!isFrontier) return spread(0.42, false);
    return spread(k === 1 ? 0.80 : 0.55, false); // catch-up: frontier baseline jumps
  }
  if (!isFrontier) return spread(k === 3 ? 0.44 : 0.84, (idx + ci) % 5 === 0);
  const center = k === 0 ? 0.86 : k === 1 ? 0.82 : k === 2 ? 0.40 : 0.57; // k=3: within floor of its 0.55 baseline → flat/flat → NO EFFECT
  return spread(center, (idx + ci) % 5 === 0);
}

function synthCase(slug, idx, ci, model, isFrontier, mode, withSkill, caseId) {
  const samples = synthSamples(idx, ci, isFrontier, withSkill);
  const m = mean(samples), sd = stddev(samples);
  return {
    id: caseId, mode, outcome: outcomeFor(m, sd, 0.7), score: m, mean: m, stddev: sd, samples,
    generation_hash: h(`${slug}|${model}|${mode}|${caseId}|gen`),
    judge_sample_hashes: samples.map((_s, i) => h(`${slug}|${model}|${mode}|${caseId}|j${i}`)),
    threshold: 0.7, reason: 'synthetic (stub prepare-report-004)',
    judge: { model_id: REPORT_004_JUDGE_MODEL, rubric_hash: h(`${slug}|${caseId}|rubric`) },
  };
}

function stubReceipt(skill, idx, model, isFrontier, nowIso) {
  const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', skill.slug, 'evals.json'), 'utf8'));
  const caseList = (suite.cases || suite.evals || []).map((c, i) => String(c.id || c.name || `case-${i + 1}`));
  const cases = [];
  caseList.forEach((cid, ci) => {
    cases.push(synthCase(skill.slug, idx, ci, model, isFrontier, 'with_skill', true, cid));
    cases.push(synthCase(skill.slug, idx, ci, model, isFrontier, 'baseline', false, cid));
  });
  const surface = disclosedSurface(model);
  return buildReceipt({
    skill: { name: skill.name || skill.slug, version: '0.0.0', contentHash: h(`${skill.slug}|content`), tokens: synthSkillTokens(skill.slug) },
    suite: { format: 'agentskills.io/evals', suiteHash: h(`${skill.slug}|suite`), caseCount: caseList.length },
    run: {
      model_id: model, model_release_date: releaseDateFor(model),
      provider: providerForModel(model), surface,
      runner_version: RUNNER_VERSION, date_utc: nowIso, registry: registryStatus(model), transcripts: 'hashes-only',
      judge: { samples: 5, temperature: null, sampling: 'surface-controlled', surface: disclosedSurface(REPORT_004_JUDGE_MODEL) },
    },
    cases, verificationLevel: 'TESTED',
  });
}

// ── live run of one (skill, model) — used only under --execute ────────────────
async function liveRunSkill(skill, model, budget, nowIso) {
  const loaded = loadSkill(path.join(ROOT, '.skills-workdir', skill.slug));
  // Ops seams inherited from #003: DRIFTPROOF_TIMEOUT_MS (run-wide, e.g. 900000),
  // DRIFTPROOF_CASE_TIMEOUT_MS (JSON per-case), DRIFTPROOF_CONCURRENCY (default 4).
  const envTimeout = process.env.DRIFTPROOF_TIMEOUT_MS ? Number(process.env.DRIFTPROOF_TIMEOUT_MS) : undefined;
  const envCaseTimeout = process.env.DRIFTPROOF_CASE_TIMEOUT_MS ? JSON.parse(process.env.DRIFTPROOF_CASE_TIMEOUT_MS) : undefined;
  const envConcurrency = process.env.DRIFTPROOF_CONCURRENCY ? Number(process.env.DRIFTPROOF_CONCURRENCY) : 4;
  const { receipt } = await runSkillOnModel({
    skill: loaded, model,
    opts: {
      samples: 5, judgeModel: REPORT_004_JUDGE_MODEL, maxCalls: 500, concurrency: envConcurrency, budget, keepTranscripts: true, nowIso,
      ...(envTimeout ? { timeoutMs: envTimeout } : {}),
      ...(envCaseTimeout ? { caseTimeoutMs: envCaseTimeout } : {}),
    },
  });
  return receipt;
}

// ── verdict (Report #002 durability rule, one provider / two tiers) ───────────
// Per model: the with/without direction from per-case band separation + the
// effect floor (a case counts only when its with_skill and baseline bands do
// NOT overlap AND |Δmean| ≥ EFFECT_FLOOR). Point-band drivers flag low-res.
function tierDirection(receipt) {
  const by = {};
  for (const c of receipt.results.cases) {
    if (c.case_status === 'failed_timeout') continue;
    (by[c.id] = by[c.id] || {})[c.mode] = c;
  }
  let reg = 0, imp = 0, lowRes = false;
  const drivers = [];
  for (const id of Object.keys(by)) {
    const w = by[id].with_skill, b = by[id].baseline;
    if (!w || !b) continue;
    const dmean = w.mean - b.mean;
    // Overlap test via the shared geometry: 'within noise' = bands touch/overlap.
    if (bandVerdict(b.mean, b.stddev, w.mean, w.stddev) === 'within noise' || Math.abs(dmean) < EFFECT_FLOOR) continue;
    const pointBand = w.stddev === 0 || b.stddev === 0;
    if (pointBand) lowRes = true;
    if (dmean < 0) reg++; else imp++;
    drivers.push({ id, dir: dmean < 0 ? 'hurts' : 'lifts', dmean, pointBand });
  }
  const dir = (reg && imp) ? 'mixed' : reg ? 'hurt' : imp ? 'help' : 'flat';
  return { dir, reg, imp, drivers, lowRes };
}

// Capability-gap verdict from the two per-tier directions. Same shape as #002's
// durabilityVerdict with model names instead of provider names.
function capabilityVerdict(rBase, rFrontier) {
  const B = tierDirection(rBase), F = tierDirection(rFrontier);
  const pureHurt = [B.dir === 'hurt' ? REPORT_004_BASE_MODEL : null, F.dir === 'hurt' ? REPORT_004_FRONTIER_MODEL : null].filter(Boolean);
  let base;
  if (pureHurt.length) base = { label: `REGRESSES on ${pureHurt.join(' & ')}`, cls: 'v-regressed' };
  else if (B.dir === 'help' && F.dir === 'help') base = { label: 'DURABLE', cls: 'v-improved' };
  else if (B.dir === 'flat' && F.dir === 'flat') base = { label: 'NO EFFECT', cls: 'v-noise' };
  else base = { label: 'TIER-DEPENDENT', cls: 'v-mixed' };
  const lowRes = B.lowRes || F.lowRes;
  return { ...base, base: B, frontier: F, lowRes };
}

// ── draft page (capability-gap chrome, series style) ──────────────────────────
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtDelta(n) { return n == null ? 'n/a' : (n >= 0 ? '+' : '') + n.toFixed(3); }
function band(m, sd) { return `${m.toFixed(3)} ± ${sd.toFixed(3)}`; }

function draftHtml({ rows, models, surface, projection, stub, tally, notMeasured, runRecord }) {
  const col = (c) => (c.incomplete
    ? '<span class="muted">not measured</span>'
    : `${band(c.withMean, c.withSd)} <span class="muted">base ${c.baseMean.toFixed(3)} · Δ ${fmtDelta(c.delta)}</span>`);
  const verdictCol = (r) => (r.incomplete
    ? '<span class="v v-noise">NOT MEASURED</span>'
    : `<span class="v ${r.verdict.cls}">${esc(r.verdict.label)}</span>${r.verdict.lowRes ? ' <span class="muted" title="a driving case rests on a zero-width judge point band">†&nbsp;low-res</span>' : ''}`);
  const rowsHtml = rows.map((r) => `      <tr>
        <td><code>${esc(r.slug)}</code></td>
        <td>${r.incomplete ? '—' : col(r.base)}</td>
        <td>${r.incomplete ? '—' : col(r.frontier)}</td>
        <td>${r.incomplete ? '—' : fmtDelta(r.liftShift)}</td>
        <td>${verdictCol(r)}</td>
      </tr>`).join('\n');

  const driverLine = (r) => {
    const fmtD = (m, D) => (D.drivers.length ? `${esc(m)}: ${D.drivers.map((d) => `${d.dir === 'hurts' ? '🔻' : '🔼'} <code>${esc(d.id)}</code> (Δ${fmtDelta(d.dmean)})${d.pointBand ? ' <strong>†point-band</strong>' : ''}`).join(', ')}` : '');
    const parts = [fmtD(models.base, r.verdict.base), fmtD(models.frontier, r.verdict.frontier)].filter(Boolean);
    return parts.length ? `<li><code>${esc(r.slug)}</code> — ${parts.join(' · ')}</li>` : '';
  };
  const basisRows = rows.filter((r) => !r.incomplete && (r.verdict.base.drivers.length || r.verdict.frontier.drivers.length));
  const basisHtml = basisRows.length
    ? `<details class="card"><summary><strong>Verdict basis — the per-case with/without drivers on each tier.</strong> A case drives a verdict only when its <code>with_skill</code> and <code>baseline</code> bands (mean ± stddev, n=5) do not overlap AND the mean moves ≥ ${EFFECT_FLOOR}. Cases marked <strong>†point-band</strong> rest on a zero-width band (all 5 judge samples identical).</summary><ul>${basisRows.map(driverLine).join('')}</ul></details>`
    : '';
  const lowResRows = rows.filter((r) => !r.incomplete && r.verdict.lowRes);
  const lowResHtml = lowResRows.length
    ? `<div class="card"><strong>Low-resolution: judge quantization (${lowResRows.length}).</strong> These verdicts rest — in whole or in part — on a zero-width judge point band (all 5 samples identical). The verdict stands; its confidence is grid-limited: ${lowResRows.map((r) => `<code>${esc(r.slug)}</code> → ${esc(r.verdict.label)}`).join('; ')}.</div>`
    : '';
  const notMeasuredHtml = notMeasured.length
    ? `<div class="card"><strong>Not measured (${notMeasured.length}).</strong> Incomplete receipt on at least one tier (cases <code>failed_timeout</code>, excluded from aggregates); no verdict is fabricated: ${notMeasured.map((n) => `<code>${esc(n.slug)}</code> on <code>${esc(n.model)}</code> (${n.failed})`).join('; ')}. Re-run to complete.</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof — Report #004 (DRAFT)</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report">
  <div class="card" style="border:2px solid var(--mixed);">
    <strong>⚠ DRAFT — not published.</strong> ${stub ? 'This is a <strong>stub dry run</strong>: the receipts are deterministic synthetic placeholders (zero model calls) proving the pipeline end to end. ' : ''}It is <em>not</em> linked from the index and has <em>not</em> been pushed to the public tree. A human must review and run the approve-and-publish sequence in <code>RUNBOOK.md</code> before this becomes a real report.
  </div>
  <h1>Report #004 — does encoded expertise still lift output on the frontier tier?</h1>
  <p class="report-type">Capability-gap report — cross-family, one provider, two tiers. NOT release drift: <code>${esc(models.frontier)}</code> has no family predecessor.</p>
  <div class="headline">
    <p class="big"><strong>${tally.durable} durable · ${tally.dependent} tier-dependent · ${tally.regressed} regresses · ${tally.noeffect} no effect</strong>${tally.not_measured ? ` · ${tally.not_measured} not measured` : ''} — over ${rows.length} skills.</p>
    <p>The same 10 suites (Report #001 v1.2 rubrics) and the same fixed judge (<code>${esc(REPORT_004_JUDGE_MODEL)}</code>, n=5) run on one provider's two tiers: <code>${esc(models.base)}</code> (flagship) and <code>${esc(models.frontier)}</code> (frontier). Per skill, the verdict rests on the <strong>with/without-skill delta on EACH tier</strong> — per-case band separation plus the ${EFFECT_FLOOR} effect floor, the same anti-cry-wolf rule the whole series uses. The cross-tier comparison is <em>context, never a ranking</em>. The question this report asks is whether the frontier tier's <em>baselines catch up</em> — whether skills that earn their keep on the flagship become ceremonial at the edge.</p>
  </div>

  <p class="src"><strong>Surface (disclosed):</strong> both tiers → <code>${esc(surface)}</code>${isSubscriptionSurface(surface) ? ' (subscription — <code>claude -p -m</code>; metered spend $0, the $ figure is the estimated metered-equivalent)' : ' (metered API)'}. Same surface, same fixed judge, same suites on both tiers — only the model changes.</p>

  <h2>Per-skill capability gap</h2>
  <table class="summary">
    <thead><tr>
      <th>skill</th>
      <th>${esc(models.base)} with (± band, baseline, Δ lift)</th>
      <th>${esc(models.frontier)} with (± band, baseline, Δ lift)</th>
      <th>lift shift (frontier − flagship)</th>
      <th>verdict</th>
    </tr></thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  <p class="muted">Columns: each tier's <code>with_skill</code> band (mean ± stddev over 5 judge samples) with its no-skill baseline and lift Δ; the <em>lift shift</em> (how much the skill's benefit changed moving flagship → frontier, context only); and the capability-gap <strong>verdict</strong> from the per-case with/without drivers on each tier. A shrinking lift with a RISING baseline means the model caught up — not that the skill decayed. Every number is re-derived from the receipts under <code>receipts/report-${REPORT_NUMBER}/</code>; nothing is hand-entered.</p>
  ${basisHtml}
  ${lowResHtml}
  ${notMeasuredHtml}

  <h2>Run record</h2>
  <div class="card">
    <p>${runRecord}</p>
    <p class="muted">Registry note: ${esc(FABLE_RELEASE_NOTE)}</p>
  </div>
${receiptLinksBlock(REPORT_NUMBER, { root: ROOT })}
  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report #${REPORT_NUMBER} · DRAFT</span></footer>
</main>
</body>
</html>
`;
}

function appendPending(pendingPath, entry) {
  fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
  let head = '';
  if (!fs.existsSync(pendingPath)) {
    head = '<!-- SPDX-License-Identifier: Apache-2.0 -->\n# Pending-publish queue\n\n'
      + 'Auto-prepared / staged draft reports awaiting human review + publish. Each entry\n'
      + 'is a notification, NOT a published report. To approve and publish one, follow the\n'
      + 'approve-and-publish sequence in [RUNBOOK.md](../RUNBOOK.md). Remove the entry once\n'
      + 'published.\n\n';
  }
  fs.appendFileSync(pendingPath, head + entry + '\n');
}

// ── LIGHT smoke: ONE tiny completion per model (2 live calls total) ───────────
// Deliberately lighter than #003's smoke (which cost ~12 calls): the haiku judge
// was proven servable by Reports #001–#003 on this box, so the only open question
// is whether each TARGET model answers via `claude -p -m`. One trivial completion
// each answers it; abort loudly before the expensive run if either fails.
async function smokeTest() {
  const out = [];
  for (const model of [REPORT_004_BASE_MODEL, REPORT_004_FRONTIER_MODEL]) {
    const t0 = Date.now();
    const res = await complete({ system: null, prompt: 'Reply with exactly: ok', model, maxTokens: 16 });
    const text = (res && (res.text || res.completion || '')).toString().trim();
    if (!text) throw new Error(`smoke: ${model} returned an empty completion (not servable via ${surfaceForModel(model)})`);
    out.push({ model, surface: res.surface, ms: Date.now() - t0, reply: text.slice(0, 40) });
    console.log(`  ✓ smoke: ${model} servable via ${res.surface} (${((Date.now() - t0) / 1000).toFixed(1)}s, reply "${text.slice(0, 40)}")`);
  }
  return out;
}

// ── main entry (structured return; no process.exit so the gate can call it) ────
async function prepareReport004(opts = {}) {
  const stub = opts.execute ? false : true;
  const nowIso = opts.now || new Date().toISOString();
  const outRoot = opts.outRoot || ROOT;
  const maxUsd = opts.maxUsd != null ? opts.maxUsd : REPORT_MAX_USD;
  const models = { base: REPORT_004_BASE_MODEL, frontier: REPORT_004_FRONTIER_MODEL };
  const paths = outPaths(outRoot);
  const surface = disclosedSurface(models.frontier);

  const manifest = loadManifest();
  const skills = manifest.skills.slice();

  const nCasesTotal = skills.reduce((a, s) => {
    const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', s.slug, 'evals.json'), 'utf8'));
    return a + (suite.cases || suite.evals || []).length;
  }, 0);
  const projection = estimateRunCostUSD({ caseCount: nCasesTotal, samples: 5, models: [models.base, models.frontier], judgeModel: REPORT_004_JUDGE_MODEL });
  const overGuard = projection.totalUSD > maxUsd;
  const projectedCalls = projectCalls(nCasesTotal, 5) * 2;

  // CHECKPOINT / RESUME (the #002/#003 pattern). Default RESUMES; --fresh wipes.
  const fresh = !!opts.fresh;
  const resume = !fresh;
  const draftDir = path.join(paths.docsReports, `${REPORT_NUMBER}-draft`);
  const receiptsDir = path.join(paths.receiptsRoot, `report-${REPORT_NUMBER}-draft`);
  if (fresh) { fs.rmSync(draftDir, { recursive: true, force: true }); fs.rmSync(receiptsDir, { recursive: true, force: true }); }
  fs.mkdirSync(draftDir, { recursive: true });
  fs.mkdirSync(receiptsDir, { recursive: true });

  const restoreFrom = opts.restoreFrom !== undefined ? opts.restoreFrom : path.join(os.homedir(), 'report-004-partial-receipts');
  let restored = 0;
  if (resume && restoreFrom && fs.existsSync(restoreFrom)) {
    for (const f of fs.readdirSync(restoreFrom).filter((x) => x.endsWith('.json'))) {
      const dst = path.join(receiptsDir, f);
      if (fs.existsSync(dst)) continue;
      try { const r = JSON.parse(fs.readFileSync(path.join(restoreFrom, f), 'utf8')); if (validateReceipt(r).valid && verifyReceiptHash(r)) { fs.copyFileSync(path.join(restoreFrom, f), dst); restored++; } } catch (_e) { /* skip */ }
    }
  }

  const budget = stub ? null : new BudgetTracker(maxUsd);
  const rows = [];
  const tally = { durable: 0, dependent: 0, regressed: 0, noeffect: 0, not_measured: 0, low_res: 0 };
  const notMeasured = [];
  let skipped = 0;

  const existingValid = (slug, model) => {
    const p = path.join(receiptsDir, `${slug}__${model}.json`);
    if (!fs.existsSync(p)) return null;
    try { const r = JSON.parse(fs.readFileSync(p, 'utf8')); if (r.run && r.run.status === 'incomplete') return null; if (validateReceipt(r).valid && verifyReceiptHash(r)) return r; } catch (_e) { /* re-run */ }
    return null;
  };
  const runOne = async (s, i, model, isFrontier) => {
    if (resume) { const ex = existingValid(s.slug, model); if (ex) { skipped++; return ex; } }
    const r = stub ? stubReceipt(s, i, model, isFrontier, nowIso) : await liveRunSkill(s, model, budget, nowIso);
    const v = validateReceipt(r);
    if (!(v.valid && verifyReceiptHash(r))) throw new Error(`invalid receipt for ${s.slug} (${r.run.model_id}): ${JSON.stringify(v.errors)}`);
    fs.writeFileSync(path.join(receiptsDir, `${s.slug}__${model}.json`), JSON.stringify(r, null, 2));
    return r;
  };

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const rBase = await runOne(s, i, models.base, false);
    const rFrontier = await runOne(s, i, models.frontier, true);

    const bInc = rBase.run.status === 'incomplete';
    const fInc = rFrontier.run.status === 'incomplete';
    if (bInc) notMeasured.push({ slug: s.slug, model: models.base, failed: rBase.run.failed_case_count || 0 });
    if (fInc) notMeasured.push({ slug: s.slug, model: models.frontier, failed: rFrontier.run.failed_case_count || 0 });
    if (bInc || fInc) {
      tally.not_measured++;
      rows.push({ slug: s.slug, incomplete: true });
      continue;
    }

    const v = capabilityVerdict(rBase, rFrontier);
    if (v.label === 'DURABLE') tally.durable++;
    else if (v.label.startsWith('REGRESSES')) tally.regressed++;
    else if (v.label === 'NO EFFECT') tally.noeffect++;
    else tally.dependent++;
    if (v.lowRes) tally.low_res++;

    const dB = rBase.comparison.delta, dF = rFrontier.comparison.delta;
    rows.push({
      slug: s.slug, incomplete: false, verdict: v,
      base: { withMean: rBase.results.aggregates.with_skill.mean_score, withSd: rBase.results.aggregates.with_skill.stddev, baseMean: rBase.results.aggregates.baseline.mean_score, delta: dB },
      frontier: { withMean: rFrontier.results.aggregates.with_skill.mean_score, withSd: rFrontier.results.aggregates.with_skill.stddev, baseMean: rFrontier.results.aggregates.baseline.mean_score, delta: dF },
      liftShift: Math.round((dF - dB) * 1e6) / 1e6,
    });
  }

  const receiptCount = fs.readdirSync(receiptsDir).filter((f) => f.endsWith('.json')).length;
  const runRecord = stub
    ? `STUB dry run — ${receiptCount} synthetic receipts, zero model calls. Projected real-run cost ~$${projection.totalUSD.toFixed(2)} (guard $${maxUsd}).`
    : `Completed ${nowIso.slice(0, 10)} on the <code>${esc(surface)}</code> surface — ${receiptCount} receipts (${skills.length} skills × 2 tiers, with/without × n=5, judged by <code>${esc(REPORT_004_JUDGE_MODEL)}</code>). ${isSubscriptionSurface(surface) ? `Metered spend <strong>$0</strong> (vendor subscription CLI); estimated metered-equivalent <strong>~$${projection.totalUSD.toFixed(2)}</strong>, under the $${maxUsd} guard.` : `Metered spend ~$${projection.totalUSD.toFixed(2)} (under the $${maxUsd} guard).`}${notMeasured.length ? ` ${notMeasured.length} (skill × tier) receipt(s) incomplete (failed_timeout) and excluded from verdicts — re-run to complete.` : ' All receipts complete.'} ${resume ? `[resume: ${restored} restored, ${skipped} skipped]` : '[fresh]'}`;

  fs.writeFileSync(path.join(draftDir, 'index.html'), draftHtml({ rows, models, surface, projection, stub, tally, notMeasured, runRecord }));

  const nmNote = notMeasured.length ? ` ${tally.not_measured} NOT MEASURED (${notMeasured.length} incomplete receipt(s)).` : '';
  const summary = `Report #${REPORT_NUMBER} ${stub ? 'STUB DRAFT staged' : 'DRAFT ready'}: ${models.base} vs ${models.frontier} (capability gap, NOT release drift)`
    + ` — ${tally.durable} durable / ${tally.dependent} tier-dependent / ${tally.regressed} regresses / ${tally.noeffect} no effect`
    + ` over ${rows.length} skills.${nmNote}${tally.low_res ? ` ${tally.low_res} low-res.` : ''}`
    + `${resume ? ` [resume: ${restored} restored, ${skipped} skipped]` : ' [fresh]'}`
    + ` ${stub ? `Projected real-run cost ~$${projection.totalUSD.toFixed(2)}` : `Est. metered-equiv ~$${projection.totalUSD.toFixed(2)}`} (guard $${maxUsd}).`;
  const goCommand = `node scripts/prepare-report-004.js --execute --max-usd ${maxUsd}`;
  const entry = `## [${nowIso}] ${summary}\n\n`
    + `- Draft page: \`docs/reports/${REPORT_NUMBER}-draft/index.html\` (noindex, NOT linked, NOT pushed)\n`
    + `- Receipts: \`receipts/report-${REPORT_NUMBER}-draft/\` (${stub ? 'stub/synthetic' : 'live'})\n`
    + `- Pair: \`${models.base}\` (flagship) vs \`${models.frontier}\` (frontier tier — cross-family, no predecessor); judge \`${REPORT_004_JUDGE_MODEL}\`; surface \`${surface}\`\n`
    + `- Registry note: ${FABLE_RELEASE_NOTE}\n`
    + (notMeasured.length ? `- NOT MEASURED (excluded from verdicts): ${notMeasured.map((n) => `${n.slug}/${n.model} (${n.failed} failed)`).join(', ')}\n` : '')
    + (stub ? `- To run the real report: \`${goCommand}\`, then ` : '- To publish: ')
    + `follow RUNBOOK.md § "Approve and publish a drafted report".\n`;
  appendPending(paths.pendingPublish, entry);

  return {
    reportNumber: REPORT_NUMBER, draftDir, receiptsDir, rows, tally, projection, projectedCalls, overGuard,
    surface, models, summary, goCommand, stub, publicTreeTouched: false, resume, fresh, restored, skipped, notMeasured,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) flags[k] = true; else { flags[k] = n; i++; } }
  }
  return flags;
}

async function main() {
  const f = parseArgs(process.argv.slice(2));
  const execute = !!f.execute;
  const smokeOnly = !!f.smoke;
  const nowIso = f.now || new Date().toISOString();
  const maxUsd = f['max-usd'] ? parseFloat(f['max-usd']) : REPORT_MAX_USD;

  if (execute || smokeOnly) {
    try { execFileSync('node', [path.join(__dirname, 'fetch-skills.js')], { cwd: ROOT, stdio: 'inherit' }); }
    catch (e) { console.error('fetch-skills failed:', e.message); process.exit(1); }

    // Projection FIRST.
    const proj = estimateRunCostUSD({ caseCount: 70, samples: 5, models: [REPORT_004_BASE_MODEL, REPORT_004_FRONTIER_MODEL], judgeModel: REPORT_004_JUDGE_MODEL });
    console.log(`\nPROJECTED full-run cost: ~$${proj.totalUSD.toFixed(2)} (guard $${maxUsd})  [${proj.perModel.map((p) => `${p.model} ~$${p.usd.toFixed(2)}`).join(', ')}]`);
    console.log(`PROJECTED live calls: ~${projectCalls(70, 5) * 2} for the full run (2 tiers × 10 suites × 70 cases × (2 gens + 2×5 judge)) + 2 for the light smoke.`);
    if (proj.totalUSD > maxUsd) { console.error(`  ⚠ projection EXCEEDS the $${maxUsd} guard — aborting. Raise --max-usd or trim.`); process.exit(3); }

    console.log(`\nSMOKE preflight (light — one tiny completion per tier, 2 calls total):`);
    try { await smokeTest(); }
    catch (e) { console.error(`\nSMOKE FAILED — aborting before the full run: ${e && (e.message || e)}`); process.exit(1); }
    console.log('SMOKE passed. Starting the full run…\n');
    if (smokeOnly) { console.log('--smoke only: stopping after preflight (no full run).'); return; }
  }

  const res = await prepareReport004({
    execute, fresh: !!f.fresh, restoreFrom: f['restore-from'] || undefined,
    maxUsd, now: nowIso, outRoot: f['out-root'] || undefined,
  });
  console.log(res.summary);
  console.log(`draft: ${path.relative(ROOT, res.draftDir)}/index.html`);
  console.log(`receipts: ${path.relative(ROOT, res.receiptsDir)}/  (${res.stub ? 'STUB — synthetic' : 'live'})`);
  if (res.resume) console.log(`resume: ${res.restored} restored from backup, ${res.skipped} completed pair(s) skipped.`);
  if (res.notMeasured && res.notMeasured.length) {
    console.log(`\n⏱ NOT MEASURED (${res.notMeasured.length} incomplete receipt(s), excluded from verdicts):`);
    for (const n of res.notMeasured) console.log(`    ${n.slug} / ${n.model} — ${n.failed} case(s) failed_timeout`);
    console.log('    Re-run the same command to retry only these (completed pairs are skipped).');
  }
  if (res.stub) {
    console.log(`\nThis was a STUB dry run — NO model was called. To execute the real Report #004:\n\n    ${res.goCommand}\n`);
    console.log('Then review the draft and follow RUNBOOK.md § "Approve and publish a drafted report".');
  } else {
    console.log('\nNOT published — review the draft + QA (reports/report-004-qa.md, later session), then follow RUNBOOK.md to approve.');
  }
}

if (require.main === module) main().catch((e) => { console.error('FATAL', e && (e.stack || e.message)); process.exit(1); });

module.exports = { prepareReport004, capabilityVerdict, tierDirection, draftHtml, disclosedSurface, smokeTest, REPORT_NUMBER, FABLE_RELEASE_NOTE };
