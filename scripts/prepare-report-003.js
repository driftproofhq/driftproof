#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-003.js — stage Driftproof Report #003, a RELEASE DRIFT report.
//
// Report #003 is Report #001's TYPE: ONE provider, TWO model versions
// (claude-opus-4-8 → claude-opus-5). It runs the SAME 10 suites (Report #001 v1.2
// rubrics) on BOTH versions with the SAME fixed Haiku judge, n=5, and asks per
// skill: does the skill's with_skill benefit DRIFT between the versions? The
// per-skill verdict is REGRESSED / IMPROVED / MIXED / WITHIN NOISE under the exact
// anti-cry-wolf rule Report #001 + #002 use — a per-case with_skill band separation
// (non-overlapping bands, n=5) that also clears the 0.05 effect floor; low-resolution
// point bands are flagged, never suppressed.
//
// This is a THIN WRAPPER over the shared libs. It does NOT fork pipeline logic:
//   - lib/run.runSkillOnModel does the sampled run + failed_timeout tolerance
//     (a persistently-timing-out case → case_status failed_timeout, run.status
//     incomplete, excluded from aggregates — inherited, not reimplemented);
//   - lib/diff.buildDriftReport does the per-case band verdict (same as #001);
//   - the checkpoint/resume + restore pattern is the one prepare-report-002.js uses
//     (a completed skill×model receipt is skipped on re-run; a backed-up receipt is
//     restored). If the cli surface throttles, re-fire the same command — it resumes.
//
// Default is a STUB dry run (deterministic synthetic receipts, zero model calls) so
// the whole pipeline is exercisable offline. `--execute` is the real run: it fetches
// the pinned skills, SMOKE-tests that each model is servable via `claude -p -m`
// (1 case each — aborts before the expensive run if a model is unreachable), then
// runs all 10 suites on both versions. NOTIFY, DON'T PUBLISH (see RUNBOOK.md).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { receiptLinksBlock } = require('./receipt-links.js');

const ROOT = path.join(__dirname, '..');
const { buildReceipt, validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { buildDriftReport } = require('../lib/diff');
const { sha256 } = require('../lib/canonical');
const { mean, stddev } = require('../lib/stats');
const { outcomeFor, releaseDateFor, runSkillOnModel, projectCalls } = require('../lib/run');
const { loadSkill } = require('../lib/skill');
const { estimateRunCostUSD, BudgetTracker } = require('../lib/cost');
const { registryStatus, providerForModel } = require('../lib/models');
const { surfaceForModel, isSubscriptionSurface } = require('../lib/provider');
const {
  REPORT_003_NEW_MODEL, REPORT_003_OLD_MODEL, REPORT_003_JUDGE_MODEL,
  REPORT_MAX_USD, RUNNER_VERSION, EFFECT_FLOOR,
} = require('../config');

const MANIFEST = path.join(ROOT, 'suites', 'manifest.json');
const REPORT_NUMBER = '003';

function loadManifest() { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
function h(seed) { return sha256(String(seed)); }

function outPaths(outRoot) {
  return {
    docsReports: path.join(outRoot, 'docs', 'reports'),
    pendingPublish: path.join(outRoot, 'reports', 'pending-publish.md'),
    receiptsRoot: path.join(outRoot, 'receipts'),
  };
}

// The disclosed surface for a model: metered API when a key is present (preferred
// for published runs), else the subscription CLI (disclosed). Keyless box → claude-cli.
function disclosedSurface(model) {
  return process.env.ANTHROPIC_API_KEY ? 'api' : 'claude-cli';
}

// ── stub receipt generation (deterministic, zero model calls) ─────────────────
function synthSkillTokens(slug) { return 300 + (parseInt(h(slug).slice(0, 6), 16) % 5700); }

// with_skill centers chosen so the NEW model drifts per (skill, case): some cases
// regress, some improve, most hold — so a skill's verdict lands across all buckets
// (REGRESSED / IMPROVED / MIXED / WITHIN NOISE) over the 10 suites. Baseline ~0.40.
function synthSamples(idx, ci, isNew, withSkill) {
  const spread = (c, pointBand) => (pointBand
    ? [c, c, c, c, c]
    : [c - 0.02, c - 0.01, c, c + 0.01, c + 0.02]).map((x) => Math.max(0, Math.min(1, x)));
  if (!withSkill) return spread(0.40, false);
  if (!isNew) return spread(0.82, (idx + ci) % 5 === 0); // old model with_skill baseline-of-comparison
  const k = (idx * 7 + ci) % 4;
  const center = k === 0 ? 0.60 : k === 1 ? 0.90 : 0.82; // regress / improve / hold
  return spread(center, (idx + ci) % 5 === 0); // some drivers rest on a zero-width point band
}

function synthCase(slug, idx, ci, model, isNew, mode, withSkill, caseId, nowIso) {
  const samples = synthSamples(idx, ci, isNew, withSkill);
  const m = mean(samples), sd = stddev(samples);
  return {
    id: caseId, mode, outcome: outcomeFor(m, sd, 0.7), score: m, mean: m, stddev: sd, samples,
    generation_hash: h(`${slug}|${model}|${mode}|${caseId}|gen`),
    judge_sample_hashes: samples.map((_s, i) => h(`${slug}|${model}|${mode}|${caseId}|j${i}`)),
    threshold: 0.7, reason: 'synthetic (stub prepare-report-003)',
    judge: { model_id: REPORT_003_JUDGE_MODEL, rubric_hash: h(`${slug}|${caseId}|rubric`) },
  };
}

function stubReceipt(skill, idx, model, isNew, nowIso) {
  const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', skill.slug, 'evals.json'), 'utf8'));
  const caseList = (suite.cases || suite.evals || []).map((c, i) => String(c.id || c.name || `case-${i + 1}`));
  const cases = [];
  caseList.forEach((cid, ci) => {
    cases.push(synthCase(skill.slug, idx, ci, model, isNew, 'with_skill', true, cid, nowIso));
    cases.push(synthCase(skill.slug, idx, ci, model, isNew, 'baseline', false, cid, nowIso));
  });
  const surface = disclosedSurface(model);
  return buildReceipt({
    skill: { name: skill.name || skill.slug, version: '0.0.0', contentHash: h(`${skill.slug}|content`), tokens: synthSkillTokens(skill.slug) },
    suite: { format: 'agentskills.io/evals', suiteHash: h(`${skill.slug}|suite`), caseCount: caseList.length },
    run: {
      model_id: model, model_release_date: releaseDateFor(model),
      provider: providerForModel(model), surface,
      runner_version: RUNNER_VERSION, date_utc: nowIso, registry: registryStatus(model), transcripts: 'hashes-only',
      judge: { samples: 5, temperature: null, sampling: 'surface-controlled', surface: disclosedSurface(REPORT_003_JUDGE_MODEL) },
    },
    cases, verificationLevel: 'TESTED',
  });
}

// ── live run of one (skill, model) — used only under --execute ────────────────
async function liveRunSkill(skill, model, budget, nowIso) {
  const loaded = loadSkill(path.join(ROOT, '.skills-workdir', skill.slug));
  // Ops seam (same as #002): extend the per-call / per-case timeout for a slow retry
  // without a code edit — DRIFTPROOF_TIMEOUT_MS (run-wide), DRIFTPROOF_CASE_TIMEOUT_MS
  // (JSON { caseId: ms } for a single stubborn straggler).
  const envTimeout = process.env.DRIFTPROOF_TIMEOUT_MS ? Number(process.env.DRIFTPROOF_TIMEOUT_MS) : undefined;
  const envCaseTimeout = process.env.DRIFTPROOF_CASE_TIMEOUT_MS ? JSON.parse(process.env.DRIFTPROOF_CASE_TIMEOUT_MS) : undefined;
  // Ops seam: lower the concurrency on a RAM-tight box so concurrent claude
  // subprocesses don't contend into a timeout (or an OOM). Default 4.
  const envConcurrency = process.env.DRIFTPROOF_CONCURRENCY ? Number(process.env.DRIFTPROOF_CONCURRENCY) : 4;
  const { receipt } = await runSkillOnModel({
    skill: loaded, model,
    opts: {
      samples: 5, judgeModel: REPORT_003_JUDGE_MODEL, maxCalls: 500, concurrency: envConcurrency, budget, keepTranscripts: true, nowIso,
      ...(envTimeout ? { timeoutMs: envTimeout } : {}),
      ...(envCaseTimeout ? { caseTimeoutMs: envCaseTimeout } : {}),
    },
  });
  return receipt;
}

// ── verdict (Report #001 release-drift rule, via lib/diff) ────────────────────
// Compare the two versions' with_skill bands per case. A case drives the verdict
// only when its bands do not overlap AND |Δmean| ≥ EFFECT_FLOOR (buildDriftReport
// enforces both). Point bands (zero-width on either side) among the drivers flag
// the skill low-resolution — the judge resolved it on its coarse grid.
function driftVerdict(rOld, rNew) {
  const drift = buildDriftReport(rOld, rNew, { labelA: 'old', labelB: 'new' });
  const reg = drift.perCase.filter((c) => c.verdict === 'regression');
  const imp = drift.perCase.filter((c) => c.verdict === 'improvement');
  const label = reg.length && imp.length ? 'MIXED'
    : reg.length ? `REGRESSED (${reg.length})`
      : imp.length ? `IMPROVED (${imp.length})` : 'WITHIN NOISE';
  const cls = reg.length && imp.length ? 'v-mixed'
    : reg.length ? 'v-regressed' : imp.length ? 'v-improved' : 'v-noise';
  const drivers = [...reg, ...imp].map((c) => ({
    id: c.id, dir: c.verdict === 'regression' ? 'regressed' : 'improved', delta: c.delta,
    pointBand: (c.before && c.before.stddev === 0) || (c.after && c.after.stddev === 0),
    before: c.before, after: c.after,
  }));
  const lowRes = drivers.some((d) => d.pointBand);
  return { label, cls, reg: reg.length, imp: imp.length, drivers, lowRes, headlineDelta: drift.headlineDelta, perCase: drift.perCase };
}

// ── draft page (Report #001 release-drift chrome) ─────────────────────────────
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtDelta(n) { return n == null ? 'n/a' : (n >= 0 ? '+' : '') + n.toFixed(3); }
function band(m, sd) { return `${m.toFixed(3)} ± ${sd.toFixed(3)}`; }

function draftHtml({ rows, pair, surface, generatedUtc, projection, stub, tally, notMeasured, runRecord }) {
  const withCol = (r) => (r.incomplete
    ? '<span class="muted">not measured</span>'
    : `${band(r.oldWith.mean, r.oldWith.stddev)} → ${band(r.newWith.mean, r.newWith.stddev)} <span class="muted">Δ ${fmtDelta(r.headlineDelta)}</span>`);
  const baseCol = (r) => (r.incomplete ? '—' : `${r.oldBase.toFixed(3)} → ${r.newBase.toFixed(3)}`);
  const verdictCol = (r) => (r.incomplete
    ? '<span class="v v-noise">NOT MEASURED</span>'
    : `<span class="v ${r.cls}">${esc(r.label)}</span>${r.lowRes ? ' <span class="muted" title="a driving case rests on a zero-width judge point band">†&nbsp;low-res</span>' : ''}`);
  const rowsHtml = rows.map((r) => `      <tr>
        <td><code>${esc(r.slug)}</code></td>
        <td>${withCol(r)}</td>
        <td>${baseCol(r)}</td>
        <td>${verdictCol(r)}</td>
      </tr>`).join('\n');

  const driverLine = (r) => (r.drivers && r.drivers.length)
    ? `<li><code>${esc(r.slug)}</code>: ${r.drivers.map((d) => `${d.dir === 'regressed' ? '🔻' : '🔼'} <code>${esc(d.id)}</code> (${band(d.before.mean, d.before.stddev)} → ${band(d.after.mean, d.after.stddev)}, Δ${fmtDelta(d.delta)})${d.pointBand ? ' <strong>†point-band</strong>' : ''}`).join(', ')}</li>`
    : '';
  const basisRows = rows.filter((r) => !r.incomplete && r.drivers && r.drivers.length);
  const basisHtml = basisRows.length
    ? `<details class="card"><summary><strong>Verdict basis — the per-case band-separated drivers behind each label.</strong> A case drives a verdict only when its two <code>with_skill</code> bands (old vs new, mean ± stddev, n=5) do not overlap AND the mean moves ≥ ${EFFECT_FLOOR}. Cases marked <strong>†point-band</strong> rest on a zero-width band (all 5 judge samples identical) — see the low-resolution note.</summary><ul>${basisRows.map(driverLine).join('')}</ul></details>`
    : '';
  const lowResRows = rows.filter((r) => r.lowRes);
  const lowResHtml = lowResRows.length
    ? `<div class="card"><strong>Low-resolution: judge quantization (${lowResRows.length}).</strong> These verdicts are supported — in whole or in part — by a case whose old or new <code>with_skill</code> band is <em>zero-width</em>: all 5 judge samples returned the identical score. The judge grades on a coarse quantization grid, so a zero-width band is a clean grid-step effect the ${EFFECT_FLOOR} floor still gates, but one whose finer structure the judge cannot resolve. The verdict stands; its confidence is grid-limited: ${lowResRows.map((r) => `<code>${esc(r.slug)}</code> → ${esc(r.label)} (${r.drivers.filter((d) => d.pointBand).map((d) => `<code>${esc(d.id)}</code>`).join(', ')})`).join('; ')}.</div>`
    : '';
  const notMeasuredHtml = notMeasured.length
    ? `<div class="card"><strong>Not measured (${notMeasured.length}).</strong> These skills have an <em>incomplete</em> receipt on at least one version — one or more cases timed out after retries (recorded <code>failed_timeout</code>, excluded from the aggregates). They are NOT given a drift verdict (no band is fabricated from a partial sample set): ${notMeasured.map((n) => `<code>${esc(n.slug)}</code> on <code>${esc(n.model)}</code> (${n.failed} case${n.failed === 1 ? '' : 's'})`).join('; ')}. Re-run to complete them.</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof — Report #003 (DRAFT)</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report">
  <div class="card" style="border:2px solid var(--mixed);">
    <strong>⚠ DRAFT — not published.</strong> ${stub ? 'This is a <strong>stub dry run</strong>: the receipts are deterministic synthetic placeholders (zero model calls) proving the pipeline end to end. ' : ''}It is <em>not</em> linked from the index and has <em>not</em> been pushed to the public tree. A human must review and run the approve-and-publish sequence in <code>RUNBOOK.md</code> before this becomes a real report.
  </div>
  <h1>Report #003 — do skill verdicts hold across a model release?</h1>
  <p class="report-type">Release drift report</p>
  <div class="headline">
    <p class="big"><strong>${tally.regressed} regressed · ${tally.improved} improved · ${tally.mixed} mixed · ${tally.noise} within noise</strong>${tally.not_measured ? ` · ${tally.not_measured} not measured` : ''} — over ${rows.length} skills.</p>
    <p>The same 10 suites (Report #001 v1.2 rubrics) and the same fixed judge (<code>${esc(REPORT_003_JUDGE_MODEL)}</code>, n=5) run on two versions of one model: <code>${esc(pair.old)}</code> (older) → <code>${esc(pair.new)}</code> (newer). Per skill, the verdict compares the two versions' <code>with_skill</code> bands per case; a regression/improvement is claimed only when BOTH (1) the two bands (mean ± stddev over the 5 judge samples) do <em>not</em> overlap AND (2) the mean moves at least the <strong>${EFFECT_FLOOR} effect floor</strong>. Bands that overlap, or separate by less than the floor, are <em>within noise</em> — never drift. See the <a href="../../methodology.html">methodology</a>.</p>
  </div>

  <p class="src"><strong>Surface (disclosed):</strong> both versions → <code>${esc(surface)}</code>${isSubscriptionSurface(surface) ? ' (subscription — <code>claude -p -m</code>; metered spend $0, the $ figure is the estimated metered-equivalent)' : ' (metered API)'}. Same surface, same fixed judge, same suites for both columns — the only thing that moves is the model version, which is the point.</p>

  <h2>Per-skill drift</h2>
  <table class="summary">
    <thead><tr>
      <th>skill</th>
      <th>with_skill (old → new)</th>
      <th>baseline (old → new)</th>
      <th>verdict</th>
    </tr></thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  <p class="muted">Columns: each skill's <code>with_skill</code> band (mean ± stddev over 5 judge samples) on the old version → the new version, with the aggregate Δ shown as <em>context</em>; the baseline (no-skill) mean old → new; and the drift <strong>verdict</strong>. The verdict does <strong>not</strong> rest on the aggregate Δ — following Report&nbsp;#001's anti-cry-wolf discipline it is the tally of <em>per-case</em> band-separated verdicts that clear the ${EFFECT_FLOOR} floor. A <span class="muted">†&nbsp;low-res</span> mark means a driving case rests on a zero-width judge point band. Every number is re-derived from the receipts under <code>receipts/report-${REPORT_NUMBER}/</code>; nothing here is hand-entered.</p>
  ${basisHtml}
  ${lowResHtml}
  ${notMeasuredHtml}

  <h2>Run record</h2>
  <div class="card">
    <p>${runRecord}</p>
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

// ── smoke: is each model servable via `claude -p -m`? (1 case each, live) ──────
// Runs the FIRST suite's first case on both versions with the real runner (2 gens
// + judge each). Throws if a model is unreachable / unauthenticated / not served,
// so --execute aborts BEFORE the full run instead of failing 840 calls deep.
async function smokeTest(nowIso) {
  const manifest = loadManifest();
  const s = manifest.skills[0];
  const loaded = loadSkill(path.join(ROOT, '.skills-workdir', s.slug));
  const out = [];
  for (const model of [REPORT_003_OLD_MODEL, REPORT_003_NEW_MODEL]) {
    const { receipt, calls } = await runSkillOnModel({
      skill: loaded, model,
      opts: { samples: 2, maxCases: 1, judgeModel: REPORT_003_JUDGE_MODEL, maxCalls: 50, concurrency: 2, nowIso },
    });
    const ok = validateReceipt(receipt).valid && verifyReceiptHash(receipt) && receipt.run.status !== 'incomplete';
    if (!ok) throw new Error(`smoke: ${model} produced an invalid/incomplete receipt (not servable via ${surfaceForModel(model)})`);
    out.push({ model, surface: receipt.run.surface, calls, withMean: receipt.results.aggregates.with_skill.mean_score });
    console.log(`  ✓ smoke: ${model} servable via ${receipt.run.surface} (${calls} calls, with_skill mean ${receipt.results.aggregates.with_skill.mean_score.toFixed(3)})`);
  }
  return out;
}

// ── main entry (structured return; no process.exit so the gate can call it) ────
async function prepareReport003(opts = {}) {
  const stub = opts.execute ? false : true;
  const nowIso = opts.now || new Date().toISOString();
  const outRoot = opts.outRoot || ROOT;
  const maxUsd = opts.maxUsd != null ? opts.maxUsd : REPORT_MAX_USD;
  const pair = { new: REPORT_003_NEW_MODEL, old: REPORT_003_OLD_MODEL };
  const paths = outPaths(outRoot);
  const surface = disclosedSurface(pair.new);

  const manifest = loadManifest();
  const skills = manifest.skills.slice();

  // Cost projection for the REAL run under the existing guard (printed by the CLI).
  const nCasesTotal = skills.reduce((a, s) => {
    const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', s.slug, 'evals.json'), 'utf8'));
    return a + (suite.cases || suite.evals || []).length;
  }, 0);
  const projection = estimateRunCostUSD({ caseCount: nCasesTotal, samples: 5, models: [pair.new, pair.old], judgeModel: REPORT_003_JUDGE_MODEL });
  const overGuard = projection.totalUSD > maxUsd;
  const projectedCalls = projectCalls(nCasesTotal, 5) * 2; // both versions

  // CHECKPOINT / RESUME (same pattern as #002). Default RESUMES: existing valid
  // draft receipts are kept, completed (skill × version) pairs are skipped; --fresh
  // restores the wipe.
  const fresh = !!opts.fresh;
  const resume = !fresh;
  const draftDir = path.join(paths.docsReports, `${REPORT_NUMBER}-draft`);
  const receiptsDir = path.join(paths.receiptsRoot, `report-${REPORT_NUMBER}-draft`);
  if (fresh) { fs.rmSync(draftDir, { recursive: true, force: true }); fs.rmSync(receiptsDir, { recursive: true, force: true }); }
  fs.mkdirSync(draftDir, { recursive: true });
  fs.mkdirSync(receiptsDir, { recursive: true });

  // Restore backed-up receipts from a run that died mid-way (only valid, self-
  // verifying, complete ones) so a resume reuses them instead of re-running.
  const restoreFrom = opts.restoreFrom !== undefined ? opts.restoreFrom : path.join(os.homedir(), 'report-003-partial-receipts');
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
  const tally = { regressed: 0, improved: 0, mixed: 0, noise: 0, not_measured: 0, low_res: 0 };
  const notMeasured = [];
  let skipped = 0;

  // An existing valid+complete receipt for (skill, model), or null (needs a run).
  const existingValid = (slug, model) => {
    const p = path.join(receiptsDir, `${slug}__${model}.json`);
    if (!fs.existsSync(p)) return null;
    try { const r = JSON.parse(fs.readFileSync(p, 'utf8')); if (r.run && r.run.status === 'incomplete') return null; if (validateReceipt(r).valid && verifyReceiptHash(r)) return r; } catch (_e) { /* re-run */ }
    return null;
  };
  const runOne = async (s, i, model, isNew) => {
    if (resume) { const ex = existingValid(s.slug, model); if (ex) { skipped++; return ex; } }
    const r = stub ? stubReceipt(s, i, model, isNew, nowIso) : await liveRunSkill(s, model, budget, nowIso);
    const v = validateReceipt(r);
    if (!(v.valid && verifyReceiptHash(r))) throw new Error(`invalid receipt for ${s.slug} (${r.run.model_id}): ${JSON.stringify(v.errors)}`);
    fs.writeFileSync(path.join(receiptsDir, `${s.slug}__${model}.json`), JSON.stringify(r, null, 2));
    return r;
  };

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const rOld = await runOne(s, i, pair.old, false);
    const rNew = await runOne(s, i, pair.new, true);

    const oInc = rOld.run.status === 'incomplete';
    const nInc = rNew.run.status === 'incomplete';
    if (oInc) notMeasured.push({ slug: s.slug, model: pair.old, failed: rOld.run.failed_case_count || 0 });
    if (nInc) notMeasured.push({ slug: s.slug, model: pair.new, failed: rNew.run.failed_case_count || 0 });

    if (oInc || nInc) {
      tally.not_measured++;
      rows.push({ slug: s.slug, incomplete: true });
      continue;
    }

    const v = driftVerdict(rOld, rNew);
    if (v.reg && v.imp) tally.mixed++; else if (v.reg) tally.regressed++; else if (v.imp) tally.improved++; else tally.noise++;
    if (v.lowRes) tally.low_res++;
    rows.push({
      slug: s.slug, incomplete: false,
      oldWith: { mean: rOld.results.aggregates.with_skill.mean_score, stddev: rOld.results.aggregates.with_skill.stddev },
      newWith: { mean: rNew.results.aggregates.with_skill.mean_score, stddev: rNew.results.aggregates.with_skill.stddev },
      oldBase: rOld.results.aggregates.baseline.mean_score, newBase: rNew.results.aggregates.baseline.mean_score,
      headlineDelta: v.headlineDelta, label: v.label, cls: v.cls, lowRes: v.lowRes, drivers: v.drivers,
    });
  }

  // Run record — factual, derived from what actually happened.
  const receiptCount = fs.readdirSync(receiptsDir).filter((f) => f.endsWith('.json')).length;
  const runRecord = stub
    ? `STUB dry run — ${receiptCount} synthetic receipts, zero model calls. Projected real-run cost ~$${projection.totalUSD.toFixed(2)} (guard $${maxUsd}).`
    : `Completed ${nowIso.slice(0, 10)} on the <code>${esc(surface)}</code> surface — ${receiptCount} receipts (${skills.length} skills × 2 versions, with/without × n=5, judged by <code>${esc(REPORT_003_JUDGE_MODEL)}</code>). ${isSubscriptionSurface(surface) ? `Metered spend <strong>$0</strong> (vendor subscription CLI); estimated metered-equivalent <strong>~$${projection.totalUSD.toFixed(2)}</strong>, under the $${maxUsd} guard.` : `Metered spend ~$${projection.totalUSD.toFixed(2)} (under the $${maxUsd} guard).`}${notMeasured.length ? ` ${notMeasured.length} (skill × version) receipt(s) incomplete (failed_timeout) and excluded from verdicts — re-run to complete.` : ' All receipts complete.'} ${resume ? `[resume: ${restored} restored, ${skipped} skipped]` : '[fresh]'}`;

  fs.writeFileSync(path.join(draftDir, 'index.html'), draftHtml({ rows, pair, surface, generatedUtc: nowIso, projection, stub, tally, notMeasured, runRecord }));

  const nmNote = notMeasured.length ? ` ${tally.not_measured} NOT MEASURED (${notMeasured.length} incomplete receipt(s)).` : '';
  const summary = `Report #${REPORT_NUMBER} ${stub ? 'STUB DRAFT staged' : 'DRAFT ready'}: ${pair.new} vs ${pair.old} (release drift)`
    + ` — ${tally.regressed} regressed / ${tally.improved} improved / ${tally.mixed} mixed / ${tally.noise} within noise`
    + ` over ${rows.length} skills.${nmNote}${tally.low_res ? ` ${tally.low_res} low-res.` : ''}`
    + `${resume ? ` [resume: ${restored} restored, ${skipped} skipped]` : ' [fresh]'}`
    + ` ${stub ? `Projected real-run cost ~$${projection.totalUSD.toFixed(2)}` : `Est. metered-equiv ~$${projection.totalUSD.toFixed(2)}`} (guard $${maxUsd}).`;
  const goCommand = `node scripts/prepare-report-003.js --execute --max-usd ${maxUsd}`;
  const entry = `## [${nowIso}] ${summary}\n\n`
    + `- Draft page: \`docs/reports/${REPORT_NUMBER}-draft/index.html\` (noindex, NOT linked, NOT pushed)\n`
    + `- Receipts: \`receipts/report-${REPORT_NUMBER}-draft/\` (${stub ? 'stub/synthetic' : 'live'})\n`
    + `- Pair: \`${pair.new}\` (new) vs \`${pair.old}\` (family predecessor); judge \`${REPORT_003_JUDGE_MODEL}\`; surface \`${surface}\`\n`
    + (notMeasured.length ? `- NOT MEASURED (excluded from verdicts): ${notMeasured.map((n) => `${n.slug}/${n.model} (${n.failed} failed)`).join(', ')}\n` : '')
    + (stub ? `- To run the real report: \`${goCommand}\`, then ` : '- To publish: ')
    + `follow RUNBOOK.md § "Approve and publish a drafted report".\n`;
  appendPending(paths.pendingPublish, entry);

  return {
    reportNumber: REPORT_NUMBER, draftDir, receiptsDir, rows, tally, projection, projectedCalls, overGuard,
    surface, pair, summary, goCommand, stub, publicTreeTouched: false, resume, fresh, restored, skipped, notMeasured,
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
    // Real run (or smoke): fetch the pinned skills first (like prepare-report-002.js).
    try { execFileSync('node', [path.join(__dirname, 'fetch-skills.js')], { cwd: ROOT, stdio: 'inherit' }); }
    catch (e) { console.error('fetch-skills failed:', e.message); process.exit(1); }

    // Projection FIRST.
    const proj = estimateRunCostUSD({ caseCount: 70, samples: 5, models: [REPORT_003_NEW_MODEL, REPORT_003_OLD_MODEL], judgeModel: REPORT_003_JUDGE_MODEL });
    console.log(`\nPROJECTED full-run cost: ~$${proj.totalUSD.toFixed(2)} (guard $${maxUsd})  [${proj.perModel.map((p) => `${p.model} ~$${p.usd.toFixed(2)}`).join(', ')}]`);
    console.log(`PROJECTED live calls: ~${projectCalls(70, 5) * 2} for the full run (2 versions × 10 suites × 70 cases × (2 gens + 2×5 judge)) + ~12 for the smoke.`);
    if (proj.totalUSD > maxUsd) { console.error(`  ⚠ projection EXCEEDS the $${maxUsd} guard — aborting. Raise --max-usd or trim.`); process.exit(3); }

    // SMOKE preflight — verify each version is servable via `claude -p -m`.
    console.log(`\nSMOKE preflight — verifying both versions are servable via claude -p -m:`);
    try { await smokeTest(nowIso); }
    catch (e) { console.error(`\nSMOKE FAILED — aborting before the full run: ${e && (e.message || e)}`); process.exit(1); }
    console.log('SMOKE passed. Starting the full run…\n');
    if (smokeOnly) { console.log('--smoke only: stopping after preflight (no full run).'); return; }
  }

  const res = await prepareReport003({
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
    console.log(`\nThis was a STUB dry run — NO model was called. To execute the real Report #003:\n\n    ${res.goCommand}\n`);
    console.log('Then review the draft and follow RUNBOOK.md § "Approve and publish a drafted report".');
  } else {
    console.log('\nNOT published — review the draft + QA, then follow RUNBOOK.md to approve.');
  }
}

if (require.main === module) main().catch((e) => { console.error('FATAL', e && (e.stack || e.message)); process.exit(1); });

module.exports = { prepareReport003, driftVerdict, draftHtml, disclosedSurface, smokeTest, REPORT_NUMBER };
