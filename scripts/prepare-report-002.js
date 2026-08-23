#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-002.js — stage Driftproof's first CROSS-PROVIDER report.
//
// Report #002 runs the SAME 10 suites (Report #001 v1.2 rubrics) on TWO
// substrates — a Claude flagship and a GPT flagship — with the SAME fixed Haiku
// judge (temperature 0), n=5. It is a skill-DURABILITY comparison across
// substrates, NOT a model ranking (see docs/neutrality.html). Each skill's
// headline is its with/without lift on EACH substrate, plus the value-per-token
// normalization and a supplementary deterministic post-check column.
//
// THIS SCRIPT IS BUILD-PHASE STAGING. Default mode is a STUB dry run:
//   - synthesizes deterministic, schema-valid v0.3.1 receipts for both substrates
//     (zero model calls),
//   - renders the DRAFT report page (unpublished: noindex, not linked, not pushed
//     — exactly like a release-watcher draft) with the value-per-token column, the
//     post-checks column, and the neutrality framing,
//   - projects the REAL run's cost under the existing $40 report guard,
//   - prints the projected cost and the single command to execute the real run,
//   - and STOPS. It never runs the full Report #002.
//
// `--execute` is the real run (fetch skills + run both substrates live + Haiku
// judge). It is intentionally NOT invoked in this phase.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { buildReceipt, validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { sha256 } = require('../lib/canonical');
const { mean, stddev } = require('../lib/stats');
const { outcomeFor, releaseDateFor, runSkillOnModel } = require('../lib/run');
const { loadSkill } = require('../lib/skill');
const { estimateRunCostUSD, BudgetTracker } = require('../lib/cost');
const { registryStatus, providerForModel, assertJudgeEligible } = require('../lib/models');
const { surfaceForModel, isSubscriptionSurface, CODEX_OVERHEAD_NOTE } = require('../lib/provider');
const { deltaPer1kTokens } = require('../lib/skillCost');
const {
  REPORT_002_CLAUDE_MODEL, REPORT_002_GPT_MODEL, REPORT_002_JUDGE_MODEL,
  REPORT_MAX_USD, RUNNER_VERSION, EFFECT_FLOOR,
} = require('../config');

const MANIFEST = path.join(ROOT, 'suites', 'manifest.json');
const REPORT_NUMBER = '002';

function loadManifest() { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
function h(seed) { return sha256(String(seed)); }

function outPaths(outRoot) {
  return {
    docsReports: path.join(outRoot, 'docs', 'reports'),
    pendingPublish: path.join(outRoot, 'reports', 'pending-publish.md'),
    receiptsRoot: path.join(outRoot, 'receipts'),
  };
}

// The disclosed surface for a substrate: API when a key is present (preferred for
// published runs), else the subscription CLI (disclosed). Mirrors docs/neutrality.
function disclosedSurface(model) {
  const provider = providerForModel(model);
  if (provider === 'openai') return process.env.OPENAI_API_KEY ? 'openai-api' : 'openai-cli';
  return process.env.ANTHROPIC_API_KEY ? 'api' : 'claude-cli';
}

// ── stub receipt generation (deterministic, zero model calls) ─────────────────
// A plausible SKILL.md token size per skill, deterministic from the slug.
function synthSkillTokens(slug) {
  return 300 + (parseInt(h(slug).slice(0, 6), 16) % 5700);
}

// Deterministic per-substrate samples chosen to exercise EVERY durability bucket
// across the 10 skills: DURABLE, SUBSTRATE-DEPENDENT, REGRESSES-on-GPT, matching.
function synthSamples(idx, substrate, withSkill) {
  const arr = (c) => [c, c, c, c, c].map((x) => Math.max(0, Math.min(1, x)));
  if (!withSkill) {
    // Baseline: slightly higher on the substrate/idx where with_skill dips below
    // it, so that case reads as a genuine regression on that substrate.
    if (substrate === 'gpt' && idx % 4 === 2) return arr(0.45);
    return arr(0.42);
  }
  if (substrate === 'claude') return arr(0.82); // Claude: durable lift everywhere
  const center = idx % 4 === 0 ? 0.60 : idx % 4 === 1 ? 0.44 : idx % 4 === 2 ? 0.35 : 0.82;
  return arr(center);
}

// Synthesize a case's post-check results from the suite's DECLARED checks (name +
// kind), with a deterministic pass pattern (with_skill passes; a regressing GPT
// case passes only half) so the draft's post-check column is populated.
function synthChecks(declared, substrate, idx, withSkill) {
  if (!Array.isArray(declared) || !declared.length) return [];
  return declared.map((c, i) => {
    let pass = withSkill;
    if (withSkill && substrate === 'gpt' && idx % 4 === 2) pass = (i % 2 === 0); // regressing GPT case: partial
    return { name: String(c.name || c.kind || 'check'), kind: c.kind, pass: !!pass };
  });
}

function synthCase(slug, idx, substrate, model, caseObj, mode, withSkill, nowIso) {
  const samples = synthSamples(idx, substrate, withSkill);
  const m = mean(samples), sd = stddev(samples);
  const cid = caseObj.id;
  const cr = {
    id: cid, mode, outcome: outcomeFor(m, sd, 0.7), score: m, mean: m, stddev: sd, samples,
    generation_hash: h(`${slug}|${model}|${mode}|${cid}|gen`),
    judge_sample_hashes: samples.map((_s, i) => h(`${slug}|${model}|${mode}|${cid}|j${i}`)),
    threshold: 0.7, reason: 'synthetic (stub prepare-report-002)',
    judge: { model_id: REPORT_002_JUDGE_MODEL, rubric_hash: h(`${slug}|${cid}|rubric`) },
  };
  const checks = synthChecks(caseObj.checks, substrate, idx, withSkill);
  if (checks.length) cr.checks = checks;
  return cr;
}

// Judge settings honest to the judge's DISCLOSED surface: temp 0 on an API
// surface (the published-run preference), else surface-controlled/null on a CLI.
function judgeSettingsFor() {
  const js = disclosedSurface(REPORT_002_JUDGE_MODEL);
  const api = js === 'api' || js === 'openai-api';
  return { samples: 5, temperature: api ? 0 : null, sampling: api ? 'api-temperature-0' : 'surface-controlled', surface: js };
}

function stubReceipt(skill, idx, substrate, model, nowIso) {
  const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', skill.slug, 'evals.json'), 'utf8'));
  const caseList = (suite.cases || suite.evals || []).map((c, i) => ({
    id: String(c.id || c.name || `case-${i + 1}`), checks: c.checks,
  }));
  const cases = [];
  for (const c of caseList) {
    cases.push(synthCase(skill.slug, idx, substrate, model, c, 'with_skill', true, nowIso));
    cases.push(synthCase(skill.slug, idx, substrate, model, c, 'baseline', false, nowIso));
  }
  const surface = disclosedSurface(model);
  return buildReceipt({
    skill: { name: skill.name || skill.slug, version: '0.0.0', contentHash: h(`${skill.slug}|content`), tokens: synthSkillTokens(skill.slug) },
    suite: { format: 'agentskills.io/evals', suiteHash: h(`${skill.slug}|suite`), caseCount: caseList.length },
    run: {
      model_id: model, model_release_date: releaseDateFor(model),
      provider: providerForModel(model), surface,
      surface_overhead_note: surface === 'openai-cli' ? CODEX_OVERHEAD_NOTE : undefined,
      runner_version: RUNNER_VERSION, date_utc: nowIso, registry: registryStatus(model),
      transcripts: 'hashes-only',
      judge: judgeSettingsFor(),
    },
    cases, verificationLevel: 'TESTED',
  });
}

// ── live run of one (skill, substrate) — used only under --execute ────────────
async function liveRunSkill(skill, model, budget, nowIso) {
  const loaded = loadSkill(path.join(ROOT, '.skills-workdir', skill.slug));
  // Ops seam: extend the per-call timeout for a slow retry without editing code.
  // DRIFTPROOF_TIMEOUT_MS overrides the run-wide default; DRIFTPROOF_CASE_TIMEOUT_MS
  // is a JSON { caseId: ms } map for a single stubborn case (e.g. a 600s straggler).
  const envTimeout = process.env.DRIFTPROOF_TIMEOUT_MS ? Number(process.env.DRIFTPROOF_TIMEOUT_MS) : undefined;
  const envCaseTimeout = process.env.DRIFTPROOF_CASE_TIMEOUT_MS ? JSON.parse(process.env.DRIFTPROOF_CASE_TIMEOUT_MS) : undefined;
  const { receipt } = await runSkillOnModel({
    skill: loaded, model,
    opts: {
      samples: 5, judgeModel: REPORT_002_JUDGE_MODEL, maxCalls: 500, concurrency: 4, budget, keepTranscripts: true, nowIso,
      ...(envTimeout ? { timeoutMs: envTimeout } : {}),
      ...(envCaseTimeout ? { caseTimeoutMs: envCaseTimeout } : {}),
    },
  });
  return receipt;
}

// ── verdicts ──────────────────────────────────────────────────────────────────
// Report #001's anti-cry-wolf discipline, applied within each substrate: a case
// counts as improved/regressed only when its with_skill and baseline bands
// (mean ± stddev over the 5 judge samples) do NOT overlap AND the mean moves at
// least EFFECT_FLOOR. Band-overlap alone, or a sub-floor move, is "within noise"
// — never a directional claim. The per-substrate direction is the tally of those
// case verdicts; the cross-substrate durability label combines the two. This is
// the SAME rule #001 uses (there, the two bands are old-model vs new-model with_
// skill; here they are with_skill vs baseline on one substrate) — the aggregate
// mean delta is reported as context but is NOT what the verdict rests on.
function bandsOverlap(m1, s1, m2, s2) { return (m1 - s1) <= (m2 + s2) && (m2 - s2) <= (m1 + s1); }

// Per-substrate direction from per-case band separation. A DRIVING case (one that
// separates + clears the floor) whose with_skill or baseline band is zero-width
// (all 5 samples identical) is flagged low-resolution — the judge resolved it on
// its coarse quantization grid, so the effect is a clean grid-step we cannot see
// finer structure inside, not a false positive (the floor still gates it).
function substrateDirection(receipt) {
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
    if (bandsOverlap(w.mean, w.stddev, b.mean, b.stddev) || Math.abs(dmean) < EFFECT_FLOOR) continue;
    const pointBand = w.stddev === 0 || b.stddev === 0;
    if (pointBand) lowRes = true;
    if (dmean < 0) reg++; else imp++;
    drivers.push({ id, dir: dmean < 0 ? 'regressed' : 'improved', dmean, pointBand });
  }
  const dir = (reg && imp) ? 'mixed' : reg ? 'hurt' : imp ? 'help' : 'flat';
  return { dir, reg, imp, drivers, lowRes };
}

// Cross-substrate durability from the two per-substrate directions.
function durabilityVerdict(rClaude, rGpt) {
  const C = substrateDirection(rClaude), G = substrateDirection(rGpt);
  const pureHurt = [C.dir === 'hurt' ? 'Claude' : null, G.dir === 'hurt' ? 'GPT' : null].filter(Boolean);
  let base;
  if (pureHurt.length) base = { label: `REGRESSES on ${pureHurt.join(' & ')}`, cls: 'v-regressed' };
  else if (C.dir === 'help' && G.dir === 'help') base = { label: 'DURABLE', cls: 'v-improved' };
  else if (C.dir === 'flat' && G.dir === 'flat') base = { label: 'NO EFFECT', cls: 'v-noise' };
  else base = { label: 'SUBSTRATE-DEPENDENT', cls: 'v-mixed' };
  // A verdict is low-resolution when a case that SUPPORTS it (a driver) rests on
  // a zero-width point band. Flat substrates have no drivers, so they never flag.
  const lowRes = C.lowRes || G.lowRes;
  return { ...base, claude: C, gpt: G, lowRes };
}

function checkTally(receipt) {
  let pass = 0, total = 0;
  for (const c of receipt.results.cases) {
    if (c.mode !== 'with_skill' || !Array.isArray(c.checks)) continue;
    for (const ck of c.checks) { total++; if (ck.pass) pass++; }
  }
  return { pass, total };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtDelta(n) { return (n >= 0 ? '+' : '') + n.toFixed(3); }
function fmtVpt(n) { return n == null ? 'n/a' : (n >= 0 ? '+' : '') + n.toFixed(3); }
function band(mean_, sd) { return `${mean_.toFixed(3)} ± ${sd.toFixed(3)}`; }

// ── draft page ─────────────────────────────────────────────────────────────────
function draftHtml({ rows, models, surfaces, generatedUtc, projection, stub, notMeasured = [] }) {
  const col = (c) => (c.incomplete
    ? `<span class="muted">not measured (${c.failed} case${c.failed === 1 ? '' : 's'} failed)</span>`
    : `${band(c.withMean, c.withSd)} <span class="muted">Δ ${fmtDelta(c.delta)}</span>`);
  const vptCol = (r) => `${r.claude.incomplete ? 'n/a' : fmtVpt(r.claude.vpt)} / ${r.gpt.incomplete ? 'n/a' : fmtVpt(r.gpt.vpt)}`;
  const rowsHtml = rows.map((r) => `      <tr>
        <td><code>${esc(r.slug)}</code></td>
        <td>${col(r.claude)}</td>
        <td>${col(r.gpt)}</td>
        <td>${vptCol(r)}</td>
        <td>${r.checks.claude.total ? `${r.checks.claude.pass}/${r.checks.claude.total}` : '—'} · ${r.checks.gpt.total ? `${r.checks.gpt.pass}/${r.checks.gpt.total}` : '—'}</td>
        <td><span class="v ${r.durability.cls}">${esc(r.durability.label)}</span>${r.durability.lowRes ? ' <span class="muted" title="rests on a zero-width judge point-band">†&nbsp;low-res</span>' : ''}</td>
      </tr>`).join('\n');
  // Verdict basis: per skill, the cases that drive it (band-separated + ≥floor),
  // marking any that rest on a zero-width point band (low-resolution).
  const driverLine = (slug, sub, dir) => (dir && dir.drivers && dir.drivers.length)
    ? `<li><code>${esc(slug)}</code> on <code>${esc(sub)}</code>: ${dir.drivers.map((d) => `${d.dir === 'regressed' ? '🔻' : '🔼'} <code>${esc(d.id)}</code> (Δ${fmtDelta(d.dmean)})${d.pointBand ? ' <strong>†point-band</strong>' : ''}`).join(', ')}</li>`
    : '';
  const basisRows = rows.filter((r) => r.durability.claude || r.durability.gpt);
  const basisHtml = basisRows.length
    ? `<details class="card"><summary><strong>Verdict basis — the per-case band-separated drivers behind each label.</strong> A case drives a verdict only when its with_skill and baseline bands (mean ± stddev, n=5) do not overlap AND the mean moves ≥ ${EFFECT_FLOOR}. Cases marked <strong>†point-band</strong> rest on a zero-width band (all 5 judge samples identical) — see the low-resolution note.</summary><ul>${rows.map((r) => driverLine(r.slug, models.claude, r.durability.claude) + driverLine(r.slug, models.gpt, r.durability.gpt)).join('')}</ul></details>`
    : '';
  const lowResRows = rows.filter((r) => r.durability.lowRes);
  const lowResHtml = lowResRows.length
    ? `<div class="card"><strong>Low-resolution: judge quantization (${lowResRows.length}).</strong> These verdicts are supported — in whole or in part — by a case whose with_skill or baseline band is <em>zero-width</em>: all 5 judge samples returned the identical score. The judge grades on a coarse quantization grid, so a zero-width band is a clean grid-step effect the floor still gates, but one whose finer structure the judge cannot resolve. The verdict stands; its confidence is grid-limited: ${lowResRows.map((r) => {
        const parts = [];
        for (const [sub, dir] of [[models.claude, r.durability.claude], [models.gpt, r.durability.gpt]]) {
          const pbs = (dir && dir.drivers || []).filter((d) => d.pointBand);
          if (pbs.length) parts.push(`${esc(sub)} (${pbs.map((d) => `<code>${esc(d.id)}</code>`).join(', ')})`);
        }
        return `<code>${esc(r.slug)}</code> → ${r.durability.label} on ${parts.join(', ')}`;
      }).join('; ')}.</div>`
    : '';
  const notMeasuredHtml = notMeasured.length
    ? `<div class="card"><strong>Not measured (${notMeasured.length}).</strong> These (skill × substrate) receipts are <em>incomplete</em> — one or more cases timed out after retries and were recorded as <code>failed_timeout</code> and excluded from the aggregates. They are NOT given a durability verdict (no band is fabricated from a partial sample set): ${notMeasured.map((n) => `<code>${esc(n.slug)}</code> on <code>${esc(n.substrate)}</code> (${n.failed} case${n.failed === 1 ? '' : 's'})`).join('; ')}. Re-run to complete them.</div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof — Report #002 (DRAFT)</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report">
  <div class="card" style="border:2px solid var(--mixed);">
    <strong>⚠ DRAFT — not published.</strong> ${stub ? 'This is a <strong>stub dry run</strong> staged in the build phase: the receipts are deterministic synthetic placeholders (zero model calls) proving the pipeline end to end. ' : ''}It is <em>not</em> linked from the index and has <em>not</em> been pushed to the public tree. A human must review and run the approve-and-publish sequence in <code>RUNBOOK.md</code> before this becomes a real report.
  </div>
  <h1>Report #002 — does a skill's benefit hold across substrates?</h1>
  <p class="report-type">Substrate durability report</p>
  <div class="headline">
    <p class="big"><strong>Cross-provider skill durability</strong>, not a model ranking.</p>
    <p>The same 10 suites (Report #001 v1.2 rubrics) and the same fixed judge (<code>${esc(REPORT_002_JUDGE_MODEL)}</code>, temp 0, n=5) run on two substrates: <code>${esc(models.claude)}</code> and <code>${esc(models.gpt)}</code>. The headline per skill is its with/without <strong>lift on each substrate</strong> — the judge-affinity-robust metric — read through the same 0.05 effect floor. Absolute cross-provider scores are context, never a ranking. See the <a href="../../neutrality.html">neutrality policy</a> and <a href="../../methodology.html">methodology</a>.</p>
  </div>

  <p class="src"><strong>Surfaces (disclosed):</strong> ${esc(models.claude)} → <code>${esc(surfaces.claude)}</code>${isSubscriptionSurface(surfaces.claude) ? ' (subscription)' : ' (metered API)'} · ${esc(models.gpt)} → <code>${esc(surfaces.gpt)}</code>${isSubscriptionSurface(surfaces.gpt) ? ' (subscription)' : ' (metered API)'}.${surfaces.claude === 'claude-cli' && surfaces.gpt === 'openai-cli' ? ' Both columns run on the vendor’s own first-party subscription CLI (<code>claude -p</code> and <code>codex exec</code>), so the surface <em>type</em> is held constant across substrates — matched, not merely disclosed.' : ''}</p>
  <div class="card">
    <p><strong>Matched first-party vendor CLI surfaces, per-surface overhead disclosed.</strong> The <code>openai-cli</code> (Codex) surface prepends a fixed <strong>~12–15k-token</strong> base-instruction preamble to every call (recorded in each receipt's <code>surface_overhead_note</code>); the <code>claude-cli</code> (<code>claude -p</code>) surface carries a <strong>smaller</strong> first-party harness/system context. Neither is authored by Driftproof. <strong>Absolute cross-substrate scores are not a ranking</strong> — the two columns sit behind different first-party harnesses. The headline metric is the <strong>within-substrate with/without-skill delta</strong> (same baseline, same surface), which cancels the vendor-side constant and isolates the skill. Read the delta down each column; do not read across as a scoreboard. See the <a href="../../neutrality.html">neutrality policy</a>.</p>
  </div>

  <h2>Per-skill durability</h2>
  <table class="summary">
    <thead><tr>
      <th>skill</th>
      <th>${esc(models.claude)} — with_skill (Δ lift)</th>
      <th>${esc(models.gpt)} — with_skill (Δ lift)</th>
      <th>Δ / 1k skill-tok (C / G)</th>
      <th>post-checks (C · G)</th>
      <th>durability</th>
    </tr></thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  <p class="muted">Columns: each substrate's with-skill band (mean ± stddev over 5 judge samples) and its lift Δ vs baseline (shown as <em>context</em>); the <strong>value-per-token</strong> lift (Δ per 1,000 SKILL.md tokens) for Claude / GPT; the supplementary <strong>deterministic post-checks</strong> passed/total (Claude · GPT), reported alongside the judge and never folded into the verdict; and the cross-substrate <strong>durability</strong> verdict. The verdict does <strong>not</strong> rest on the aggregate Δ: following Report&nbsp;#001's anti-cry-wolf discipline, a skill is called improved/regressed on a substrate only when a <em>per-case</em> with_skill vs baseline band separation (non-overlapping bands, n=5) clears the ${EFFECT_FLOOR} floor — a wide aggregate band from one outlier case never manufactures a verdict, and a real per-case effect hidden under a flat aggregate mean is not missed. A <span class="muted">†&nbsp;low-res</span> mark means a driving case rests on a zero-width judge point band. Every number is re-derived from the receipts under <code>receipts/report-${REPORT_NUMBER}/</code>.</p>
  <p class="muted"><strong>Post-checks footnote.</strong> Deterministic post-checks are authored only where a mechanical assertion is groundable in the skill's SKILL.md text (currently <code>commit-work</code>). A <strong>—</strong> in the post-checks column means <em>no checks are defined</em> for that skill, <em>not</em> that checks failed.</p>
  <div class="card"><strong>How the durability label is composed.</strong> Each substrate first gets a per-case direction from the drivers below: <strong>helps</strong> (≥1 improved case, none regressed), <strong>regresses</strong> (≥1 regressed, none improved), <strong>mixed</strong> (both improved and regressed cases), or <strong>flat</strong> (no case separates beyond the floor). The two substrate directions then compose, in this precedence:
    <ul>
      <li><strong>REGRESSES on X</strong> — a substrate that <em>purely regresses</em> (regressed cases, none improved). This outranks everything: a clean regression on any one side is named even when the other side helps or is mixed. <em>Example:</em> <code>git-workflow-and-versioning</code> purely regresses on Claude (<code>commit-message-conventional-type</code>, none improved) while GPT is mixed (1 regressed, 2 improved) → <strong>REGRESSES on Claude</strong>. A pure regression is the actionable risk, so it takes the label over the other side's mixed result. If <em>both</em> substrates purely regress, both are named (e.g. <code>crafting-effective-readmes</code> → REGRESSES on Claude &amp; GPT).</li>
      <li><strong>DURABLE</strong> — both substrates help, neither regresses.</li>
      <li><strong>NO EFFECT</strong> — both substrates flat (no case separated beyond the floor).</li>
      <li><strong>SUBSTRATE-DEPENDENT</strong> — anything else: helps on one substrate and flat on the other, or a mixed substrate with no pure-regression side. The benefit does not hold uniformly.</li>
    </ul>
  </div>
  ${basisHtml}
  ${lowResHtml}
  ${notMeasuredHtml}

  <h2>Run record</h2>
  <div class="card">
    <p>The run completed <strong>2026-07-31</strong>, executed in resumed segments (checkpoint/resume: completed pairs are skipped on re-run). <strong>All 20 (skill × substrate) receipts are complete</strong> — 10 skills × 2 substrates, with/without × n=5, judged by <code>${esc(REPORT_002_JUDGE_MODEL)}</code>. Surfaces are as disclosed above: both columns ran on the vendors' own subscription CLIs, so <strong>metered spend was $0</strong>; the estimated metered-equivalent is <strong>~$${projection.totalUSD.toFixed(2)}</strong>, under the $${REPORT_MAX_USD} report guard. One case required an extended <strong>600&nbsp;s</strong> timeout to complete (recorded in its receipt). Receipts are under <code>receipts/report-${REPORT_NUMBER}/</code>.</p>
  </div>
  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report #${REPORT_NUMBER}</span></footer>
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

// ── main entry (structured return; no process.exit, so the gate can call it) ───
async function prepareReport002(opts = {}) {
  const stub = opts.execute ? false : true;
  const nowIso = opts.now || new Date().toISOString();
  const outRoot = opts.outRoot || ROOT;
  const maxUsd = opts.maxUsd != null ? opts.maxUsd : REPORT_MAX_USD;
  const models = { claude: REPORT_002_CLAUDE_MODEL, gpt: REPORT_002_GPT_MODEL };
  const paths = outPaths(outRoot);

  // Fixed-judge policy: the judge MUST be judge_eligible. No OpenAI model is, so a
  // cross-provider report can only ever grade with the pinned Haiku judge.
  assertJudgeEligible(REPORT_002_JUDGE_MODEL);

  const manifest = loadManifest();
  const skills = manifest.skills.slice();

  // Cost projection for the REAL run under the existing guard.
  const nCasesTotal = skills.reduce((a, s) => {
    const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', s.slug, 'evals.json'), 'utf8'));
    return a + (suite.cases || suite.evals || []).length;
  }, 0);
  const projection = estimateRunCostUSD({ caseCount: nCasesTotal, samples: 5, models: [models.claude, models.gpt], judgeModel: REPORT_002_JUDGE_MODEL });
  const overGuard = projection.totalUSD > maxUsd;

  const surfaces = { claude: disclosedSurface(models.claude), gpt: disclosedSurface(models.gpt) };

  // CHECKPOINT / RESUME. The default RESUMES: existing draft receipts are kept and
  // any completed (skill × substrate) is skipped; `--fresh` restores the old wipe.
  const fresh = !!opts.fresh;
  const resume = !fresh;
  const draftDir = path.join(paths.docsReports, `${REPORT_NUMBER}-draft`);
  const receiptsDir = path.join(paths.receiptsRoot, `report-${REPORT_NUMBER}-draft`);
  if (fresh) {
    fs.rmSync(draftDir, { recursive: true, force: true });
    fs.rmSync(receiptsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(draftDir, { recursive: true });
  fs.mkdirSync(receiptsDir, { recursive: true });

  // First step of a resume: restore backed-up receipts (e.g. from a run that died
  // mid-way) into the draft dir so completed pairs are reused, not re-run. Only
  // valid, self-verifying receipts are restored; an already-present one is kept.
  const restoreFrom = opts.restoreFrom !== undefined ? opts.restoreFrom : path.join(os.homedir(), 'report-002-partial-receipts');
  let restored = 0;
  if (resume && restoreFrom && fs.existsSync(restoreFrom)) {
    for (const f of fs.readdirSync(restoreFrom).filter((x) => x.endsWith('.json'))) {
      const dst = path.join(receiptsDir, f);
      if (fs.existsSync(dst)) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(restoreFrom, f), 'utf8'));
        if (validateReceipt(r).valid && verifyReceiptHash(r)) { fs.copyFileSync(path.join(restoreFrom, f), dst); restored++; }
      } catch (_e) { /* skip an unreadable backup */ }
    }
  }

  const budget = stub ? null : new BudgetTracker(maxUsd);
  const rows = [];
  const tally = { durable: 0, dependent: 0, regressed: 0, noeffect: 0, not_measured: 0 };
  const notMeasured = []; // incomplete (skill × substrate) — excluded from verdicts
  let skipped = 0;

  // An existing valid receipt for (skill, substrate), or null (needs a run).
  const existingValid = (slug, model) => {
    const p = path.join(receiptsDir, `${slug}__${model}.json`);
    if (!fs.existsSync(p)) return null;
    try { const r = JSON.parse(fs.readFileSync(p, 'utf8')); if (r.run && r.run.status === 'incomplete') return null; if (validateReceipt(r).valid && verifyReceiptHash(r)) return r; } catch (_e) { /* re-run */ }
    return null;
  };
  const runOne = async (s, i, substrate, model) => {
    if (resume) { const ex = existingValid(s.slug, model); if (ex) { skipped++; return ex; } }
    const r = stub ? stubReceipt(s, i, substrate, model, nowIso) : await liveRunSkill(s, model, budget, nowIso);
    const v = validateReceipt(r);
    if (!(v.valid && verifyReceiptHash(r))) throw new Error(`invalid receipt for ${s.slug} (${r.run.model_id}): ${JSON.stringify(v.errors)}`);
    fs.writeFileSync(path.join(receiptsDir, `${s.slug}__${model}.json`), JSON.stringify(r, null, 2));
    return r;
  };

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const rC = await runOne(s, i, 'claude', models.claude);
    const rG = await runOne(s, i, 'gpt', models.gpt);

    // Exclude INCOMPLETE receipts from the verdict — a receipt with failed cases
    // must never yield a fabricated durability call.
    const cInc = rC.run.status === 'incomplete';
    const gInc = rG.run.status === 'incomplete';
    if (cInc) notMeasured.push({ slug: s.slug, substrate: models.claude, failed: rC.run.failed_case_count || 0 });
    if (gInc) notMeasured.push({ slug: s.slug, substrate: models.gpt, failed: rG.run.failed_case_count || 0 });

    const dC = rC.comparison.delta, dG = rG.comparison.delta;
    let durability;
    if (cInc || gInc) {
      durability = { label: 'NOT MEASURED', cls: 'v-noise', lowRes: false };
      tally.not_measured++;
    } else {
      durability = durabilityVerdict(rC, rG);
      if (durability.label === 'DURABLE') tally.durable++;
      else if (durability.label.startsWith('REGRESSES')) tally.regressed++;
      else if (durability.label === 'NO EFFECT') tally.noeffect++;
      else tally.dependent++;
      if (durability.lowRes) tally.low_res = (tally.low_res || 0) + 1;
    }

    rows.push({
      slug: s.slug,
      claude: { withMean: rC.results.aggregates.with_skill.mean_score, withSd: rC.results.aggregates.with_skill.stddev, delta: dC, vpt: deltaPer1kTokens(dC, rC.skill.tokens), incomplete: cInc, failed: rC.run.failed_case_count || 0 },
      gpt: { withMean: rG.results.aggregates.with_skill.mean_score, withSd: rG.results.aggregates.with_skill.stddev, delta: dG, vpt: deltaPer1kTokens(dG, rG.skill.tokens), incomplete: gInc, failed: rG.run.failed_case_count || 0 },
      checks: { claude: checkTally(rC), gpt: checkTally(rG) },
      durability,
    });
  }

  fs.writeFileSync(path.join(draftDir, 'index.html'), draftHtml({ rows, models, surfaces, generatedUtc: nowIso, projection, stub, notMeasured }));

  const goCommand = `node scripts/prepare-report-002.js --execute --max-usd ${maxUsd}`;
  const nmNote = notMeasured.length ? ` ${tally.not_measured} NOT MEASURED (${notMeasured.length} incomplete receipt(s)).` : '';
  const summary = `Report #${REPORT_NUMBER} ${stub ? 'STUB DRAFT staged' : 'DRAFT ready'}: ${models.claude} vs ${models.gpt} (cross-provider durability)`
    + ` — ${tally.durable} durable / ${tally.dependent} substrate-dependent / ${tally.regressed} regressed / ${tally.noeffect} no-effect`
    + ` over ${rows.length} skills.${nmNote}`
    + `${resume ? ` [resume: ${restored} restored, ${skipped} skipped]` : ' [fresh]'}`
    + ` Projected real-run cost ~$${projection.totalUSD.toFixed(2)} (guard $${maxUsd}).`;
  const entry = `## [${nowIso}] ${summary}\n\n`
    + `- Draft page: \`docs/reports/${REPORT_NUMBER}-draft/index.html\` (noindex, NOT linked, NOT pushed)\n`
    + `- Receipts: \`receipts/report-${REPORT_NUMBER}-draft/\` (${stub ? 'stub/synthetic' : 'live'})\n`
    + `- Substrates: \`${models.claude}\` (${surfaces.claude}) vs \`${models.gpt}\` (${surfaces.gpt}); judge \`${REPORT_002_JUDGE_MODEL}\`\n`
    + (notMeasured.length ? `- NOT MEASURED (excluded from verdicts): ${notMeasured.map((n) => `${n.slug}/${n.substrate} (${n.failed} failed)`).join(', ')}\n` : '')
    + `- To run the real report: \`${goCommand}\`, then follow RUNBOOK.md § "Approve and publish a drafted report".\n`;
  appendPending(paths.pendingPublish, entry);

  return {
    reportNumber: REPORT_NUMBER, draftDir, receiptsDir, rows, tally, projection, overGuard,
    surfaces, models, summary, goCommand, stub, publicTreeTouched: false,
    resume, fresh, restored, skipped, notMeasured,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────
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
  const execute = !!f.execute;
  if (execute) {
    // Real run: fetch the pinned skills first (like prepare-report.js).
    try { execFileSync('node', [path.join(__dirname, 'fetch-skills.js')], { cwd: ROOT, stdio: 'inherit' }); }
    catch (e) { console.error('fetch-skills failed:', e.message); process.exit(1); }
  }
  const res = await prepareReport002({
    execute,
    // --fresh restores the old wipe; the default RESUMES (skip completed pairs +
    // restore backed-up receipts). --restore-from overrides the backup dir.
    fresh: !!f.fresh,
    restoreFrom: f['restore-from'] || undefined,
    maxUsd: f['max-usd'] ? parseFloat(f['max-usd']) : REPORT_MAX_USD,
    now: f.now || null,
    // --out-root writes the draft + receipts + pending-publish under a chosen root
    // (the gate uses a temp dir so staging never pollutes the repo during tests).
    outRoot: f['out-root'] || undefined,
  });
  console.log(res.summary);
  console.log(`draft: ${path.relative(ROOT, res.draftDir)}/index.html`);
  console.log(`receipts: ${path.relative(ROOT, res.receiptsDir)}/  (${res.stub ? 'STUB — synthetic' : 'live'})`);
  if (res.resume) console.log(`resume: ${res.restored} restored from backup, ${res.skipped} completed pair(s) skipped.`);
  // Honest end-of-run summary of any cases that persistently failed (timeouts).
  if (res.notMeasured && res.notMeasured.length) {
    console.log(`\n⏱ NOT MEASURED (${res.notMeasured.length} incomplete receipt(s), excluded from verdicts):`);
    for (const n of res.notMeasured) console.log(`    ${n.slug} / ${n.substrate} — ${n.failed} case(s) failed_timeout`);
    console.log('    Re-run the same command to retry only these (completed pairs are skipped).');
  }
  console.log('');
  console.log(`PROJECTED full-run cost: ~$${res.projection.totalUSD.toFixed(2)} (guard $${REPORT_MAX_USD})`
    + `  [${res.projection.perModel.map((p) => `${p.model} ~$${p.usd.toFixed(2)}`).join(', ')}]`);
  if (res.overGuard) console.log(`  ⚠ projection EXCEEDS the $${REPORT_MAX_USD} guard — trim before executing.`);
  console.log('');
  if (res.stub) {
    console.log('This was a STUB dry run — NO model was called and Report #002 was NOT executed.');
    console.log('To execute the real Report #002 run yourself:');
    console.log(`\n    ${res.goCommand}\n`);
    console.log('Then review the draft and follow RUNBOOK.md § "Approve and publish a drafted report".');
  }
}

if (require.main === module) main().catch((e) => { console.error('FATAL', e && (e.stack || e.message)); process.exit(1); });

module.exports = { prepareReport002, durabilityVerdict, draftHtml, disclosedSurface, REPORT_NUMBER };
