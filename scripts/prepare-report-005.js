#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-005.js — stage Driftproof Report #005, a VALUE report.
//
// Report #005 is the fourth report type in the series, and the first that widens
// the AXES rather than moving the substrate. Reports #001–#004 all asked one
// question — does the skill still help? — while something changed underneath it
// (a model version, a vendor surface, a capability tier). #005 holds the question
// and asks the other half a reader needs before acting:
//
//     What does this skill COST to run — in money and in latency —
//     alongside whether it helps?
//
// Three axes, shown together, never combined:
//   1. accuracy lift  — with/without bands, the SAME floor-gated rule as #001–#004
//   2. Δ tokens       — the tokens the skill adds per call (the durable cost fact),
//                       with metered-equivalent dollars per 1,000 calls DERIVED
//                       beneath at the receipt's frozen rates
//   3. Δ latency      — median wall-clock the skill adds, surface-disclosed
//
// There is deliberately NO composite value score, and ratio framings render only
// where the lift cleared the effect floor (else "n/a (within noise)"). Those
// rules live in lib/value.js and REPORT-STYLE.md § "Value-axis presentation
// rules"; this script renders them, it does not re-decide them.
//
// This is a THIN WRAPPER over the shared libs, exactly like #003/#004:
//   - lib/run.runSkillOnModel does the sampled run, the failed_timeout tolerance,
//     the v0.4 usage capture, the frozen pricing snapshot and the economics block;
//   - checkpoint/resume + restore is the #002/#003/#004 pattern (a completed
//     skill×model receipt is skipped on re-run — re-fire the same command after a
//     throttle and it continues where it stopped);
//   - the accuracy verdict is #004's tierDirection rule, unchanged.
//
// Default is a STUB dry run (deterministic synthetic receipts, zero model calls).
// `--execute` fetches the pinned skills, LIGHT-smokes all three substrates (one
// tiny completion each), then runs 10 suites × 3 substrates. NOTIFY, DON'T
// PUBLISH (see RUNBOOK.md).

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
// OPEN-QUESTION-2 (spec 015). The projection printed here is the number a human
// reads when deciding to authorise a paid run, and `projectCalls`'s `draws`
// argument defaults to 1 for backward compatibility — so before this import the
// figure understated a v0.5 run by up to SAMPLING.max times. The runner's own
// cost guard has always projected the maximum; this makes the human-facing
// number agree with it.
const { SAMPLING } = require('../lib/sampling');
const { loadSkill } = require('../lib/skill');
const { estimateRunCostUSD, BudgetTracker } = require('../lib/cost');
const { registryStatus, providerForModel, priceForModel, assertJudgeEligible } = require('../lib/models');
const { complete, surfaceForModel, isSubscriptionSurface, isMeteredSurface, CODEX_OVERHEAD_NOTE } = require('../lib/provider');
const { stubUsage } = require('../lib/stub');
const {
  buildPricingSnapshot, computeEconomics, costPerLiftPoint, runTotalFromReceipts, runWallClockFromReceipts,
  LATENCY_DISCLOSURE, NOISE_CELL, DRIVER_ONLY_CELL, CACHE_PRICING_NOTE,
} = require('../lib/value');
const { REPORT_005_MODELS, REPORT_005_JUDGE_MODEL, REPORT_MAX_USD, RUNNER_VERSION, EFFECT_FLOOR } = require('../config');

const MANIFEST = path.join(ROOT, 'suites', 'manifest.json');
const REPORT_NUMBER = '005';

// C-F3 (approval 2026-08-19T08:22Z). The projection the run itself produced, on
// the day, pinned here as a RECORDED VALUE rather than recomputed.
//
// Why a constant and not a live call: `estimateRunCostUSD` reads the `lib/cost`
// token constants, and DECISIONS #8/#11 commit spec #006 to replacing them with
// preamble-aware ones. After that, a re-render of #005 would print a different
// projection and a different multiple while still claiming to describe the run of
// 2026-08-18 — restating history. Freezing the mechanism was approval A-F3; this
// closes C-F3, which found the mechanism had no caller, so the natural re-render
// silently dropped it.
//
// Provenance: the `reports/pending-publish.md` entry written by the run at
// ba6eff4 records `Est. metered-equiv ~$20.89`. No receipt attests a projection —
// a receipt records what a call cost, not what was estimated before it — so this
// constant IS the record, and it is labelled as such on the page.
const PROJECTION_AT_RUN_USD = 20.89;

// The acknowledgment this report type owes. Kept exactly this plain — it names a
// question that changed the work, and nothing more.
const ACKNOWLEDGMENT =
  'The value axes in this report type were prompted by a question from a former colleague: '
  + 'why not show what a skill costs to run, not just whether it helps.';

function loadManifest() { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
function h(seed) { return sha256(String(seed)); }

function outPaths(outRoot) {
  return {
    docsReports: path.join(outRoot, 'docs', 'reports'),
    pendingPublish: path.join(outRoot, 'reports', 'pending-publish.md'),
    receiptsRoot: path.join(outRoot, 'receipts'),
  };
}

// ── stub receipt generation (deterministic, zero model calls) ─────────────────
function synthSkillTokens(slug) { return 300 + (parseInt(h(slug).slice(0, 6), 16) % 5700); }

// The stub encodes the report's QUESTION so a dry run exercises every cell the
// value table can render: skills that lift on all substrates, skills whose lift
// is within noise (→ the ratio cell must read "n/a (within noise)"), and a spread
// of output lengths so Δcost and Δlatency are non-trivial.
function synthSamples(idx, ci, mIdx, withSkill) {
  const spread = (c, pointBand) => (pointBand
    ? [c, c, c, c, c]
    : [c - 0.02, c - 0.01, c, c + 0.01, c + 0.02]).map((x) => Math.max(0, Math.min(1, x)));
  const k = idx % 3; // 0 = lifts everywhere, 1 = lifts on some substrates, 2 = ceremonial
  if (!withSkill) return spread(k === 2 ? 0.82 : 0.45 + 0.05 * mIdx, false);
  if (k === 0) return spread(0.86, (idx + ci) % 5 === 0);
  if (k === 1) return spread(mIdx === 0 ? 0.84 : 0.52 + 0.05 * mIdx, (idx + ci) % 7 === 0);
  return spread(0.83, false); // ceremonial: baseline already ~0.82 → within noise
}

function synthCase(slug, idx, ci, model, mIdx, mode, withSkill, caseId, prompt, skillMd) {
  const samples = synthSamples(idx, ci, mIdx, withSkill);
  const m = mean(samples), sd = stddev(samples);
  // Synthetic-but-shaped usage: the same fixed harness preamble in both arms
  // (so it cancels in Δ, as on the real surfaces), plus the with-skill arm's
  // extra SKILL.md input and its longer, slower output.
  const usage = stubUsage({ kind: 'gen', system: withSkill ? skillMd : undefined, prompt });
  const judgeUsage = stubUsage({ kind: 'judge', prompt });
  return {
    id: caseId, mode, outcome: outcomeFor(m, sd, 0.7), score: m, mean: m, stddev: sd, samples,
    generation_hash: h(`${slug}|${model}|${mode}|${caseId}|gen`),
    judge_sample_hashes: samples.map((_s, i) => h(`${slug}|${model}|${mode}|${caseId}|j${i}`)),
    threshold: 0.7, reason: 'synthetic (stub prepare-report-005)',
    judge: { model_id: REPORT_005_JUDGE_MODEL, rubric_hash: h(`${slug}|${caseId}|rubric`) },
    usage: { ...usage, wall_ms: usage.wall_ms + ci * 120 + mIdx * 300 },
    judge_usage: { ...judgeUsage, input_tokens: judgeUsage.input_tokens * 5, output_tokens: judgeUsage.output_tokens * 5, wall_ms: judgeUsage.wall_ms * 5 },
  };
}

function stubReceipt(skill, idx, model, mIdx, nowIso) {
  const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', skill.slug, 'evals.json'), 'utf8'));
  const rawCases = (suite.cases || suite.evals || []);
  const skillMd = 'x'.repeat(synthSkillTokens(skill.slug) * 4); // token proxy: 4 chars/token
  const cases = [];
  rawCases.forEach((c, ci) => {
    const cid = String(c.id || c.name || `case-${ci + 1}`);
    const prompt = String(c.prompt || cid);
    cases.push(synthCase(skill.slug, idx, ci, model, mIdx, 'with_skill', true, cid, prompt, skillMd));
    cases.push(synthCase(skill.slug, idx, ci, model, mIdx, 'baseline', false, cid, prompt, skillMd));
  });
  const surface = surfaceForModel(model);
  const pricingSnapshot = buildPricingSnapshot({ models: [model, REPORT_005_JUDGE_MODEL], lookup: priceForModel, nowIso });
  const economics = computeEconomics({
    cases, modelId: model, judgeModelId: REPORT_005_JUDGE_MODEL,
    pricingSnapshot, surface, meteredSurface: isMeteredSurface(surface),
  });
  return buildReceipt({
    skill: { name: skill.name || skill.slug, version: '0.0.0', contentHash: h(`${skill.slug}|content`), tokens: synthSkillTokens(skill.slug) },
    suite: { format: 'agentskills.io/evals', suiteHash: h(`${skill.slug}|suite`), caseCount: rawCases.length },
    run: {
      model_id: model, model_release_date: releaseDateFor(model),
      provider: providerForModel(model), surface,
      surface_overhead_note: surface === 'openai-cli' ? CODEX_OVERHEAD_NOTE : undefined,
      runner_version: RUNNER_VERSION, date_utc: nowIso, registry: registryStatus(model), transcripts: 'hashes-only',
      judge: { samples: 5, temperature: null, sampling: 'surface-controlled', surface: surfaceForModel(REPORT_005_JUDGE_MODEL) },
      pricing_snapshot: pricingSnapshot,
    },
    cases, economics, verificationLevel: 'TESTED',
  });
}

// ── live run of one (skill, model) — used only under --execute ────────────────
async function liveRunSkill(skill, model, budget, nowIso) {
  const loaded = loadSkill(path.join(ROOT, '.skills-workdir', skill.slug));
  // Ops seams inherited from #003/#004: DRIFTPROOF_TIMEOUT_MS (run-wide),
  // DRIFTPROOF_CASE_TIMEOUT_MS (JSON per-case), DRIFTPROOF_CONCURRENCY.
  const envTimeout = process.env.DRIFTPROOF_TIMEOUT_MS ? Number(process.env.DRIFTPROOF_TIMEOUT_MS) : undefined;
  const envCaseTimeout = process.env.DRIFTPROOF_CASE_TIMEOUT_MS ? JSON.parse(process.env.DRIFTPROOF_CASE_TIMEOUT_MS) : undefined;
  const envConcurrency = process.env.DRIFTPROOF_CONCURRENCY ? Number(process.env.DRIFTPROOF_CONCURRENCY) : 2;
  const { receipt } = await runSkillOnModel({
    skill: loaded, model,
    opts: {
      samples: 5, judgeModel: REPORT_005_JUDGE_MODEL, maxCalls: 500, concurrency: envConcurrency,
      budget, keepTranscripts: true, nowIso,
      ...(envTimeout ? { timeoutMs: envTimeout } : {}),
      ...(envCaseTimeout ? { caseTimeoutMs: envCaseTimeout } : {}),
    },
  });
  return receipt;
}

// ── accuracy axis (unchanged from #004 — adding axes does not relax the rule) ─
function skillDirection(receipt) {
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
    if (bandVerdict(b.mean, b.stddev, w.mean, w.stddev) === 'within noise' || Math.abs(dmean) < EFFECT_FLOOR) continue;
    const pointBand = w.stddev === 0 || b.stddev === 0;
    if (pointBand) lowRes = true;
    if (dmean < 0) reg++; else imp++;
    drivers.push({ id, dir: dmean < 0 ? 'hurts' : 'lifts', dmean, pointBand });
  }
  const dir = (reg && imp) ? 'mixed' : reg ? 'hurt' : imp ? 'help' : 'flat';
  // `separated` is what gates every ratio cell: at least one case cleared the
  // floor with non-overlapping bands. It is the SAME evidence the verdict uses.
  return { dir, reg, imp, drivers, lowRes, separated: drivers.length > 0 };
}

// ── draft page (value-report chrome, series style) ────────────────────────────
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtDelta(n, digits = 3) { return n == null ? 'n/a' : (n >= 0 ? '+' : '') + Number(n).toFixed(digits); }
function band(m, sd) { return `${m.toFixed(3)} ± ${sd.toFixed(3)}`; }
// Adaptive precision: a legitimate but small dollar figure must never DISPLAY as
// $0.00, or a true near-zero cost becomes indistinguishable from a rendering bug
// (and trips the zero-looking tripwire on honest data). Below a cent, show two
// significant figures instead of rounding to nothing.
function fmtUsd(n, digits = 2) {
  if (n == null) return 'n/a';
  const v = Math.abs(Number(n));
  const sign = Number(n) < 0 ? '−' : '';
  if (v > 0 && v < 0.01) return `${sign}$${Number(v.toPrecision(2))}`;
  return `${sign}$${v.toFixed(digits)}`;
}
function fmtMs(n) { return n == null ? 'n/a' : `${n >= 0 ? '+' : '−'}${Math.abs(Number(n) / 1000).toFixed(2)}s`; }
function fmtTok(n) { return n == null ? 'n/a' : `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(Number(n))).toLocaleString('en-US')}`; }

function draftHtml({ rows, models, surfaces, projection, stub, tally, notMeasured, runRecord, nowIso, pricingFrozenAt, wallClock, money, costFacts, skillCheck, maxUsd, judgeFacts, priceSpread, projectionAtRun, projectionUSD, receiptsLabel, published }) {
  const cell = (c) => {
    if (!c) return '<td colspan="4" class="muted">not measured</td>';
    // ONE predicate, both columns. Before spec 002 this annotated on `separated`
    // alone while the ratio cell gated on separated AND the aggregate floor, so
    // the same label meant two different things in adjacent columns and six cells
    // read "within noise" beside their own named drivers (QA V-4).
    const liftMark = !c.separated ? ' <em>(within noise)</em>'
      : (c.aggregateClears ? '' : ' <em>(driver-only)</em>');
    const liftStr = `${band(c.withMean, c.withSd)}<br><span class="muted">base ${c.baseMean.toFixed(3)} · Δ ${fmtDelta(c.lift)}${liftMark}</span>`;
    // TOKENS LEAD. Tokens are what the skill actually consumed and they do not
    // change when a vendor reprices; the dollar figure beneath is a derived,
    // dated view of exactly these numbers at the receipt's frozen rates.
    const tokenStr = `${fmtTok(c.inputDelta)} in · ${fmtTok(c.outputDelta)} out`
      + `<br><span class="muted">derived: ${fmtUsd(c.costPer1k)}/1k calls</span>`;
    return `<td>${liftStr}</td>`
      + `<td>${tokenStr}</td>`
      + `<td>${fmtMs(c.latencyDelta)}</td>`
      + `<td>${c.ratio}</td>`;
  };
  const rowsHtml = rows.map((r) => `      <tr>
        <td><code>${esc(r.slug)}</code></td>
${models.map((m) => `        ${cell(r.byModel[m])}`).join('\n')}
      </tr>`).join('\n');

  const headModels = models.map((m) => `      <th colspan="4">${esc(m)}</th>`).join('\n');
  const headAxes = models.map(() => '      <th>lift (band)</th><th>Δ tokens (cost)</th><th>Δ latency</th><th>cost / benefit</th>').join('\n');

  const driverLine = (r) => {
    const parts = models.map((m) => {
      const d = r.byModel[m];
      if (!d || !d.drivers.length) return '';
      return `${esc(m)}: ${d.drivers.map((x) => `${x.dir === 'hurts' ? '🔻' : '🔼'} <code>${esc(x.id)}</code> (Δ${fmtDelta(x.dmean)})${x.pointBand ? ' <strong>†point-band</strong>' : ''}`).join(', ')}`;
    }).filter(Boolean);
    return parts.length ? `<li><code>${esc(r.slug)}</code> — ${parts.join(' · ')}</li>` : '';
  };
  const basisRows = rows.filter((r) => models.some((m) => r.byModel[m] && r.byModel[m].drivers.length));
  const basisHtml = basisRows.length
    ? `<details class="card"><summary><strong>Verdict basis — the per-case with/without drivers on each substrate.</strong> A case drives the accuracy axis only when its <code>with_skill</code> and <code>baseline</code> bands (mean ± stddev, n=5) do not overlap AND the mean moves ≥ ${EFFECT_FLOOR}. Cases marked <strong>†point-band</strong> rest on a zero-width band (all 5 judge samples identical).</summary><ul>${basisRows.map(driverLine).join('')}</ul></details>`
    : '';
  // AC-3 — REPORT-STYLE § "Low-resolution note (judge quantization)". The verdict
  // stands; it is flagged, not suppressed. Before spec 002 the page carried the
  // †point-band marks but never the note, so a reader could not see that most
  // priced cells rest partly on a zero-width band (QA V-5).
  const lowResCells = [];
  for (const r of rows) for (const m of models) {
    const d = r.byModel[m];
    if (d && d.lowRes) lowResCells.push({ slug: r.slug, model: m, priced: d.priced, drivers: d.drivers.filter((x) => x.pointBand) });
  }
  const lowResHtml = lowResCells.length
    ? `<details class="card" id="low-res"><summary><strong>Low-resolution: judge quantization — ${lowResCells.length} of ${tally.measured} cells.</strong> ${lowResCells.filter((c) => c.priced).length} of the ${tally.priced} priced cells are among them. A zero-width point band means all 5 judge samples landed identically: the judge grades on a coarse grid, so the effect is a clean grid step the floor still gates, but one whose finer structure the judge cannot resolve. <em>The verdict stands; it is flagged, not suppressed.</em></summary><ul>${lowResCells.map((c) => `<li><code>${esc(c.slug)}</code> on <code>${esc(c.model)}</code>${c.priced ? ' <strong>(priced)</strong>' : ''} — ${c.drivers.map((x) => `<code>${esc(x.id)}</code> (Δ${fmtDelta(x.dmean)})`).join(', ')}</li>`).join('')}</ul></details>`
    : '';
  const notMeasuredHtml = notMeasured.length
    ? `<div class="card"><strong>Not measured (${notMeasured.length}).</strong> Incomplete receipt (cases <code>failed_timeout</code>, excluded from aggregates); no figure is fabricated: ${notMeasured.map((n) => `<code>${esc(n.slug)}</code> on <code>${esc(n.model)}</code> (${n.failed})`).join('; ')}. Re-run to complete.</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${published ? 'Driftproof — Report #005: what does a skill cost to run?' : 'Driftproof — Report #005 (DRAFT)'}</title>
${published ? '' : '<meta name="robots" content="noindex">'}
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report">
${published ? '' : `  <div class="card" style="border:2px solid var(--mixed);">
    <strong>⚠ DRAFT — not published.</strong> ${stub ? 'This is a <strong>stub dry run</strong>: the receipts are deterministic synthetic placeholders (zero model calls) proving the pipeline end to end. ' : ''}It is <em>not</em> linked from the index and has <em>not</em> been pushed to the public tree. A human must review and run the approve-and-publish sequence in <code>RUNBOOK.md</code> before this becomes a real report.
  </div>
`}  <h1>Report #005 — what does a skill cost to run?</h1>
  <p class="report-type">Value report — three axes (accuracy, cost, latency), held across ${models.length} substrates. The substrate does not move under the skill here; the <em>axes</em> widen.</p>
  <div class="headline">
    <p class="big">In <strong>${tally.reportable} of ${tally.measured} skill × substrate pairs</strong> at least one case cleared the effect floor with separated bands: <strong>${tally.improving}</strong> with an improving case${tally.mixed ? ` (${tally.mixed} of them also with a regressing one)` : ''}, <strong>${tally.regression_only}</strong> with only a regressing case. <strong>${tally.priced}</strong> cleared the floor on aggregate: ${tally.priced - tally.saving} carry a price and ${tally.saving} report a saving instead, having improved quality while <em>reducing</em> cost.${tally.not_measured ? ` · ${tally.not_measured} not measured` : ''}</p>
    <p>Reports #001–#004 asked whether a skill still helps while something moved underneath it. This one holds that question and adds the half a reader needs before acting: <strong>what the skill costs to run</strong>, in money and in wall-clock. The same 10 suites (Report #001 v1.2 rubrics) and the same fixed judge (<code>${esc(REPORT_005_JUDGE_MODEL)}</code>, n=5) run on ${models.length} substrates; each row shows the accuracy lift with its bands, what the skill does to the call's token cost per 1,000 calls (which is not always upward), and what it does to latency.</p>
  </div>

  <div class="card">
    <strong>How to read the three axes — and what they do NOT mean.</strong>
    <ul>
      <li><strong>Accuracy lift (band).</strong> <code>with_skill</code> mean ± stddev over 5 judge samples, against the no-skill baseline on the same substrate. A lift is only called real when a per-case band separation clears the ${EFFECT_FLOOR} effect floor — the same anti-cry-wolf rule as every earlier report. <em>Not</em> a model ranking: the comparison is always with-skill vs without-skill <em>within</em> one substrate.</li>
      <li><strong>Δ tokens (cost).</strong> The change in the <em>whole call's</em> token footprint with the skill loaded — input and output. The skill's own text is one part of the input delta and usually the smaller part: across these ${tally.measured} cells the input delta tracks cost at <strong>r = ${costFacts.corr_input}</strong> while the skill's own length tracks it at only <strong>r = ${costFacts.corr_size}</strong>, and one ${costFacts.small_skill_tokens.toLocaleString('en-US')}-token skill drew <strong>${costFacts.max_input_multiple}× its own size</strong> in extra input. What moves the number is how the skill changes the path the model takes, multiplied by the substrate's price per token — ${priceSpread && priceSpread.multiple ? `the same skill at near-identical token deltas costs <strong>${priceSpread.multiple.toFixed(1)}×</strong> more on <code>${esc(priceSpread.highModel)}</code> than on <code>${esc(priceSpread.lowModel)}</code>, which is exactly their input-rate ratio in the frozen snapshot` : 'substrates priced further apart cost proportionally more at identical token deltas'} — the rates differ, not the behaviour. The change is not always upward: in ${costFacts.cheaper_cells} of ${tally.measured} cells the skill made the call <em>cheaper</em>, and in ${costFacts.negative_input_cells} it pulled in <em>less input</em> — not the same set, since a skill can read less and still write more. This is the durable cost fact: it is what the skill actually consumed, and it does not change when a vendor reprices. The dollar figure beneath is a <em>derived</em> view of exactly these tokens at the rates frozen into the receipt. <em>Not</em> a bill: on subscription surfaces actual metered spend is $0 and the dollars are metered-equivalent. <em>Not</em> a total cost of ownership — it is the skill's marginal cost, the number that changes when you adopt it. Output length is <em>not</em> a quality signal in either direction; longer is not better.</li>
      <li><strong>Δ latency.</strong> Median wall-clock added, ${esc(LATENCY_DISCLOSURE)}. <em>Not</em> a serving-latency benchmark: it includes CLI cold starts and the vendor's own harness, so it describes what a user of that surface experiences, not the model's speed.</li>
      <li><strong>Cost / benefit.</strong> What one unit of measured benefit costs — dollars per 0.01 lift, derived from the two columns to its left. <strong>The denominator is the cell's aggregate lift, not the lift of the single case that drove it.</strong> The cost is paid on every case in the suite, so the benefit it buys must be averaged over those same cases; pricing a whole-suite cost against one case's lift would mix populations and read 2.5–6× cheaper than the measurement supports. Four states, and only one of them is a price: a floor-clearing positive lift is priced; a cell whose <em>drivers</em> cleared the floor while its aggregate did not reads <code>${esc(DRIVER_ONLY_CELL)}</code>, with those drivers named under Verdict basis; a cell with no separated driver at all reads <code>${esc(NOISE_CELL)}</code>; and a skill that measurably hurt prices nothing. Where a skill improved quality <em>and</em> reduced cost, the cell states the saving instead of a price — there is no cost per unit of benefit when the benefit is free.</li>
      <li><strong>There is no composite score.</strong> The three axes have different units, different error bars, and different owners. Collapsing them into one number would manufacture a figure no reader could trace to evidence, so the report shows the three and leaves the weighing to you.</li>
    </ul>
  </div>

  <div class="card">
    <strong>Disclosure.</strong>
    <ul>
      <li><strong>Tokens are the measurement; dollars are derived.</strong> The cost column leads with the <em>token</em> delta — what the skill actually consumed, which does not change when a vendor reprices. The dollar figure beneath it is a derived view of exactly those tokens at the rates frozen into the receipt, and every one of them re-derives as <code>(input/1e6 × input_rate) + (output/1e6 × output_rate)</code>.</li>
      <li><strong>Pricing snapshot.</strong> Metered-equivalent, computed from each receipt's own frozen <code>run.pricing_snapshot</code>${pricingFrozenAt ? ` — <strong>priced as frozen ${esc(String(pricingFrozenAt).slice(0, 10))}</strong>` : ''} (registry prices at run time) — never from the live registry, so these numbers do not change meaning when a vendor changes prices. ${esc(CACHE_PRICING_NOTE)}</li>
      <li><strong>Surfaces.</strong> ${surfaces.map((s) => `<code>${esc(s.model)}</code> → <code>${esc(s.surface)}</code>${isSubscriptionSurface(s.surface) ? ' (subscription; metered spend $0)' : ' (metered API)'}`).join('; ')}. Disclosed per the neutrality policy.</li>
      <li><strong>The judge is excluded — and measurement is the expensive half in time.</strong> Judging consumed <strong>${wallClock.judge_hours} of the run's ${wallClock.total_hours} compute hours (${wallClock.judge_share_pct}%)</strong>, against ${wallClock.generation_hours} hours of generation (n=5 judge calls per generation). In dollars it was ${fmtUsd(money.display.judge_usd)} of ${fmtUsd(money.display.total_usd)} — <em>cheaper</em> than generation in aggregate. It cost more than the work it graded on ${judgeFacts.heavier.length ? judgeFacts.heavier.map((x) => `<code>${esc(x.model)}</code> (judge ${fmtUsd(x.judge)} vs generation ${fmtUsd(x.gen)}, ${x.marginPct != null ? `${x.marginPct.toFixed(1)}% more` : 'margin n/a'}, in ${x.judgeHeavier} of its ${x.receipts} receipts)`).join(' and ') : 'no substrate'}, and ${judgeFacts.receiptsJudgeHeavier} of ${tally.measured} receipts overall — so "grading costs more" is substrate-dependent, and on ${judgeFacts.thinnest ? `<code>${esc(judgeFacts.thinnest.model)}</code>` : 'the closest substrate'} the margin is thin enough that a small pricing move would flip it. Judge tokens are recorded separately on every receipt as <code>judge_usage</code> and enter <em>no</em> value figure — the receipt schema pins <code>economics.judge_excluded</code> to <code>true</code>. That spend is ours, for measuring; it is not a cost of running the skill.</li>
      <li><strong>What this run cost us, and what the guard did.</strong> The run was projected at <strong>${fmtUsd(projectionUSD)}</strong>${projectionAtRun != null ? ' <span class="muted">(the figure produced at run time, frozen here — the token constants behind it are being replaced, and a later re-render must not silently restate what was projected on the day)</span>' : ''} and cost <strong>${fmtUsd(money.display.total_usd)}</strong> metered-equivalent — <strong>${(money.total_usd / projectionUSD).toFixed(1)}×</strong> the projection — against a ${fmtUsd(maxUsd)} guard that never fired, because it checked the projection rather than accrued spend. Actual metered spend was $0 (subscription surfaces), so nothing was billed. The projection's token constants did not model the fixed CLI harness preamble; the guard is being rebuilt to check accrual before the next run. We publish the measured figure, not the estimate: it is the same argument this report makes about skills, applied to us.</li>
      <li><strong>Skill versions are pinned, not current.</strong> Every skill was measured at the commit pinned in <code>suites/manifest.json</code>. Checked against upstream on ${esc(String(skillCheck.checked_at).slice(0, 10))}: <strong>${skillCheck.identical} of ${skillCheck.total} are still byte-identical</strong>${skillCheck.revised.length ? `; ${skillCheck.revised.map((x) => `<code>${esc(x)}</code>`).join(' and ')} ${skillCheck.revised.length > 1 ? 'have' : 'has'} been revised upstream` : ''}. No upstream revision responds to a Driftproof finding — no commit message or diff references this project. The influence has run the other way: a maintainer's fairness audit produced our in-text grounding policy, amended 2 of 10 suites, and changed a published verdict (Report #001 v1.2).</li>
      <li><strong>Ratios are floor-gated.</strong> The cost-per-benefit cell prices one <em>unit of measured benefit</em> — dollars per 0.01 lift. Where a lift did not clear the effect floor, it reads <code>${esc(NOISE_CELL)}</code> rather than a number: dividing noise by a real cost produces a precise-looking figure with nothing under it.</li>
    </ul>
  </div>

  <h2>Per-skill economics</h2>
  <table class="summary">
    <thead>
      <tr><th rowspan="2">skill</th>
${headModels}
      </tr>
      <tr>
${headAxes}
      </tr>
    </thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  <p class="muted">Per substrate: the <code>with_skill</code> band with its baseline and lift Δ; the <strong>token</strong> delta the skill adds (input and output), with the derived dollar cost per 1,000 calls beneath it; the median latency delta; and the cost per unit of measured benefit (dollars per 0.01 lift), which renders only where the <em>aggregate</em> lift cleared the floor — cells whose drivers cleared it while the aggregate did not read <code>${esc(DRIVER_ONLY_CELL)}</code> and are listed under Verdict basis. Every number is re-derived from the receipts under <code>${esc(receiptsLabel)}</code>; nothing is hand-entered. <em>Deviation from the shared table anatomy, stated as REPORT-STYLE requires:</em> a value report replaces the value-per-token, post-checks and composed-verdict columns with the three axes and the cost/benefit cell — the accuracy verdict lives in Verdict basis, per-case, rather than as a composed label.</p>
  ${basisHtml}
  ${lowResHtml}
  ${notMeasuredHtml}

  <h2>Run record</h2>
  <div class="card"><p>${runRecord}</p></div>
${published ? `
  <h2>Amendments</h2>
  <div class="card">
    <p><strong>v1.0.1 · 2026-08-19</strong> — Publication-chrome correction. No measured value changed: every figure, count and verdict on this page is identical to v1.0, and all 30 receipts are unchanged. At first publication the page&rsquo;s <code>&lt;title&gt;</code> element and its footer both still carried the draft marker. The publication switch removed the <code>noindex</code> robots tag and the draft banner, but was never applied to those two places, so a page that was published in every other respect still announced itself as unpublished in the browser tab. Both are now rendered from the same switch, and the repo gate asserts the property rather than the two known places: no published report page may carry that marker anywhere, checked across every published report, so the defect cannot recur silently on a later one.</p>
    <p class="muted">v1.0 · 2026-08-19 — First publication.</p>
  </div>` : ''}
${receiptLinksBlock(REPORT_NUMBER, { label: receiptsLabel, root: ROOT })}
  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report #${REPORT_NUMBER}${published ? ' · Value report' : ' · DRAFT'}</span></footer>
  <p class="muted">${esc(ACKNOWLEDGMENT)}</p>
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
  // UPSERT, not append. Verifying a draft means re-rendering it, and every
  // re-render used to add another identical queue entry — so checking the work
  // dirtied a tracked file and the queue grew a duplicate per verification
  // (approval A-F1). One report, one entry: an existing entry for this report
  // number is replaced in place.
  const marker = `Report #${REPORT_NUMBER} `;
  if (fs.existsSync(pendingPath)) {
    const current = fs.readFileSync(pendingPath, 'utf8');
    const blocks = current.split(/(?=^## \[)/m);
    const kept = blocks.filter((b) => !(b.startsWith('## [') && b.includes(marker)));
    fs.writeFileSync(pendingPath, kept.join('').replace(/\n*$/, '\n\n') + entry + '\n');
    return;
  }
  fs.appendFileSync(pendingPath, head + entry + '\n');
}

// ── LIGHT smoke: ONE tiny completion per substrate (3 live calls total) ───────
// Same shape as #004's light smoke, extended to the third substrate. Verifies
// each model is servable AND that its surface reports usage — a value report
// whose surfaces returned no token counts would be worthless, so it aborts loudly.
async function smokeTest(models) {
  const out = [];
  for (const model of models) {
    const t0 = Date.now();
    const res = await complete({ system: null, prompt: 'Reply with exactly: ok', model, maxTokens: 16 });
    const text = (res && (res.text || '')).toString().trim();
    if (!text) throw new Error(`smoke: ${model} returned an empty completion (not servable via ${surfaceForModel(model)})`);
    const u = res.usage || {};
    const usageOk = u.input_tokens != null && u.output_tokens != null;
    if (!usageOk) throw new Error(`smoke: ${model} (${res.surface}) returned NO usage — a value report cannot be run on a surface that does not report tokens`);
    out.push({ model, surface: res.surface, ms: Date.now() - t0, usage: u, reply: text.slice(0, 40) });
    console.log(`  ✓ smoke: ${model} servable via ${res.surface} (${((Date.now() - t0) / 1000).toFixed(1)}s) — usage in=${u.input_tokens} out=${u.output_tokens} cached=${u.cached_tokens == null ? 'n/a' : u.cached_tokens} wall=${u.wall_ms}ms`);
  }
  return out;
}

// ── main entry (structured return; no process.exit so the gate can call it) ────
async function prepareReport005(opts = {}) {
  const renderOnly = !!opts.renderOnly;
  // E-F6. The PUBLISHED page is rendered, not hand-edited. RUNBOOK used to say
  // "remove the noindex meta tag and the DRAFT banner" by hand, which meant the
  // published artifact was a hand-derived copy of the one that passed QA, no
  // command could reproduce it, and the gate's byte-identity check could not
  // survive promotion. `--published` renders it directly: same figures, same
  // code path, published chrome.
  const published = !!opts.published;
  const stub = (opts.execute || renderOnly) ? false : true;
  const nowIso = opts.now || new Date().toISOString();
  const outRoot = opts.outRoot || ROOT;
  const maxUsd = opts.maxUsd != null ? opts.maxUsd : REPORT_MAX_USD;
  const models = (opts.models || REPORT_005_MODELS).slice();
  const paths = outPaths(outRoot);

  // Fixed-judge policy: a value report spans providers, so assert the judge is
  // the pinned eligible one before anything runs.
  assertJudgeEligible(REPORT_005_JUDGE_MODEL);

  const manifest = loadManifest();
  const skills = manifest.skills.slice();
  const surfaces = models.map((m) => ({ model: m, surface: surfaceForModel(m) }));

  const nCasesTotal = skills.reduce((a, s) => {
    const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', s.slug, 'evals.json'), 'utf8'));
    return a + (suite.cases || suite.evals || []).length;
  }, 0);
  const projection = estimateRunCostUSD({ draws: SAMPLING.max, caseCount: nCasesTotal, samples: 5, models, judgeModel: REPORT_005_JUDGE_MODEL });
  const overGuard = projection.totalUSD > maxUsd;
  const projectedCalls = projectCalls(nCasesTotal, 5, SAMPLING.max) * models.length;

  // CHECKPOINT / RESUME (the #002/#003/#004 pattern). Default RESUMES; --fresh wipes.
  const fresh = !!opts.fresh;
  const resume = !fresh;
  const draftDir = path.join(paths.docsReports, published ? REPORT_NUMBER : `${REPORT_NUMBER}-draft`);
  // Receipts are read from wherever they actually are. Promotion re-renders
  // BEFORE the move (RUNBOOK), so this is normally still `-draft`; after the move
  // it is the published directory. Either way the renderer reads the real files
  // rather than assuming a stage.
  const promotedReceipts = path.join(paths.receiptsRoot, `report-${REPORT_NUMBER}`);
  const receiptsDir = fs.existsSync(promotedReceipts)
    ? promotedReceipts
    : path.join(paths.receiptsRoot, `report-${REPORT_NUMBER}-draft`);
  // E-F4. REFUSE BEFORE DESTROYING. `--render-only --fresh` used to reach the
  // wipe first and the refusal second: it deleted the draft page and all 30
  // receipts — untracked at the time, and unreproducible short of a ~2,500-call
  // re-run — and only then said it would not generate them. A refusal that fires
  // after the destruction is not a refusal.
  //
  // The two flags are contradictory by construction: `--fresh` means "discard
  // what is there and rebuild it", `--render-only` means "render what is there
  // and never build anything". There is no coherent reading of both.
  if (renderOnly && fresh) {
    throw new Error('--render-only cannot be combined with --fresh: --fresh discards the receipts and --render-only '
      + 'cannot regenerate them, so together they would destroy the run and then refuse to rebuild it. '
      + 'Nothing has been deleted.');
  }
  if (fresh) { fs.rmSync(draftDir, { recursive: true, force: true }); fs.rmSync(receiptsDir, { recursive: true, force: true }); }
  fs.mkdirSync(draftDir, { recursive: true });
  fs.mkdirSync(receiptsDir, { recursive: true });

  const restoreFrom = opts.restoreFrom !== undefined ? opts.restoreFrom : path.join(os.homedir(), 'report-005-partial-receipts');
  let restored = 0;
  if (resume && restoreFrom && fs.existsSync(restoreFrom)) {
    for (const f of fs.readdirSync(restoreFrom).filter((x) => x.endsWith('.json'))) {
      const dst = path.join(receiptsDir, f);
      if (fs.existsSync(dst)) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(restoreFrom, f), 'utf8'));
        if (validateReceipt(r).valid && verifyReceiptHash(r)) { fs.copyFileSync(path.join(restoreFrom, f), dst); restored++; }
      } catch (_e) { /* skip */ }
    }
  }

  const budget = stub ? null : new BudgetTracker(maxUsd);
  const rows = [];
  const tally = { measured: 0, reportable: 0, within_noise: 0, not_measured: 0, low_res: 0,
    // AC-1: "reportable" alone said too much. A separated cell may be separated by
    // a REGRESSION, and a separated cell may still fail the floor on aggregate, so
    // the headline states three counts instead of one.
    improving: 0, regression_only: 0, mixed: 0, priced: 0, saving: 0 };
  const notMeasured = [];
  let skipped = 0;
  // The date the prices behind every dollar figure were frozen. Stated on the
  // page so a dollar figure is always read as a dated, derived view.
  let pricingFrozenAt = null;
  // Kept so the run total can be derived from measured receipts (F1) rather than
  // from the projection.
  const collectedReceipts = [];

  const existingValid = (slug, model) => {
    const p = path.join(receiptsDir, `${slug}__${model}.json`);
    if (!fs.existsSync(p)) return null;
    try {
      const r = JSON.parse(fs.readFileSync(p, 'utf8'));
      // An INCOMPLETE receipt is not a completed pair — resume must re-run it
      // (the #002 resume bug: a straggler could never be retried).
      if (r.run && r.run.status === 'incomplete') return null;
      if (validateReceipt(r).valid && verifyReceiptHash(r)) return r;
    } catch (_e) { /* re-run */ }
    return null;
  };
  const runOne = async (s, i, model, mIdx) => {
    if (resume) { const ex = existingValid(s.slug, model); if (ex) { skipped++; return ex; } }
    // D-F1. `--render-only` re-renders a report from receipts that already exist
    // and must never be able to start a run. The old promotion path could: the
    // RUNBOOK printed a `--execute` command AFTER the receipts had been moved out
    // of `-draft`, so nothing was skipped, and re-rendering a finished report
    // silently became a 2,523-call re-run against a guard that checks the
    // projection and therefore never fires. Refusing is the only safe answer —
    // a missing receipt in this mode is an operator error, not work to be done.
    if (renderOnly) {
      throw new Error(`--render-only: no valid receipt for ${s.slug} (${model}) in ${path.relative(outRoot, receiptsDir)}/. `
        + 'Re-render reads receipts, it never produces them. Run this BEFORE moving the receipts out of -draft '
        + '(RUNBOOK step 2); if they are genuinely missing, this is not a re-render.');
    }
    const r = stub ? stubReceipt(s, i, model, mIdx, nowIso) : await liveRunSkill(s, model, budget, nowIso);
    const v = validateReceipt(r);
    if (!(v.valid && verifyReceiptHash(r))) throw new Error(`invalid receipt for ${s.slug} (${r.run.model_id}): ${JSON.stringify(v.errors)}`);
    fs.writeFileSync(path.join(receiptsDir, `${s.slug}__${model}.json`), JSON.stringify(r, null, 2));
    return r;
  };

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const byModel = {};
    for (let mIdx = 0; mIdx < models.length; mIdx++) {
      const model = models[mIdx];
      const r = await runOne(s, i, model, mIdx);
      if (r.run.status === 'incomplete') {
        notMeasured.push({ slug: s.slug, model, failed: r.run.failed_case_count || 0 });
        tally.not_measured++;
        byModel[model] = null;
        continue;
      }
      const dir = skillDirection(r);
      const econ = r.economics || {};
      const snap = (r.run || {}).pricing_snapshot || null;
      if (snap && snap.frozen_at && !pricingFrozenAt) pricingFrozenAt = snap.frozen_at;
      collectedReceipts.push(r);
      const lift = r.comparison.delta;
      const costPer1k = econ.skill_incremental_cost_usd_per_1k_calls;
      tally.measured++;
      if (dir.separated) {
        tally.reportable++;
        if (dir.imp > 0) tally.improving++; else tally.regression_only++;
        if (dir.imp > 0 && dir.reg > 0) tally.mixed++;
        if (lift >= EFFECT_FLOOR) {
          tally.priced++;
          // A floor-clearing cell at negative cost reports a saving, not a price
          // (approval B-F2): the headline said 14 "carry a price" while the legend
          // said 4 of them carry a saving.
          if (Number(costPer1k) < 0) tally.saving++;
        }
      } else tally.within_noise++;
      if (dir.lowRes) tally.low_res++;
      byModel[model] = {
        withMean: r.results.aggregates.with_skill.mean_score,
        withSd: r.results.aggregates.with_skill.stddev,
        baseMean: r.results.aggregates.baseline.mean_score,
        lift,
        separated: dir.separated,
        drivers: dir.drivers,
        lowRes: dir.lowRes,
        costPer1k,
        outputDelta: econ.output_tokens_delta,
        // Derived at render time from the two arms, NOT stored on the receipt:
        // economics is additionalProperties:false, and receipts already written
        // by this run would lack a new field. See spec 001 NFR-2.
        inputDelta: ((econ.with_skill || {}).mean_input_tokens == null || (econ.baseline || {}).mean_input_tokens == null)
          ? null : Math.round(((econ.with_skill.mean_input_tokens - econ.baseline.mean_input_tokens)) * 100) / 100,
        latencyDelta: econ.median_wall_ms_delta,
        // The ONLY ratio on the page, and it goes through the floor-gated
        // renderer — a within-noise lift can never become a number here.
        ratio: costPerLiftPoint({ lift, separated: dir.separated, incrementalCostPer1kCalls: costPer1k }),
        // The ratio gate's own predicate, exposed so the lift column cannot drift
        // away from it (AC-2). `separated` is per-case evidence; this is whether
        // the AGGREGATE — the ratio's denominator, per AC-4 — cleared the floor.
        aggregateClears: dir.separated && Math.abs(lift) >= EFFECT_FLOOR,
        // (approval F3) A floor-clearing NEGATIVE aggregate clears the floor but
        // buys nothing — it renders `n/a (skill regressed)`. `priced` is the
        // narrower predicate: only a cell that actually carries a price or a
        // saving. No such regression exists in the #005 data; the two predicates
        // are separated now so the next dataset cannot make them disagree.
        priced: dir.separated && lift >= EFFECT_FLOOR,
      };
    }
    rows.push({ slug: s.slug, byModel });
  }

  // AC-6 — the cost-framing claims are DERIVED here, not written as prose, so a
  // later run cannot leave the page asserting a relation the data stopped having.
  const costFacts = (() => {
    const pts = collectedReceipts.map((r) => {
      const e = r.economics || {};
      const w = e.with_skill || {}, b = e.baseline || {};
      return {
        tok: (r.skill || {}).tokens,
        din: (w.mean_input_tokens == null || b.mean_input_tokens == null) ? null : w.mean_input_tokens - b.mean_input_tokens,
        usd: e.skill_incremental_cost_usd_per_1k_calls,
      };
    }).filter((x) => x.tok != null && x.din != null && x.usd != null);
    const corr = (a, b) => {
      if (a.length < 2) return null;
      const ma = a.reduce((s2, x) => s2 + x, 0) / a.length, mb = b.reduce((s2, x) => s2 + x, 0) / b.length;
      const num = a.reduce((s2, x, i) => s2 + (x - ma) * (b[i] - mb), 0);
      const den = Math.sqrt(a.reduce((s2, x) => s2 + (x - ma) ** 2, 0) * b.reduce((s2, x) => s2 + (x - mb) ** 2, 0));
      return den ? num / den : null;
    };
    const usd = pts.map((x) => x.usd);
    const fmtR = (v) => (v == null ? 'n/a' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`);
    const positives = pts.filter((x) => x.din > 0 && x.tok > 0);
    let best = null;
    for (const x of positives) if (!best || x.din / x.tok > best.din / best.tok) best = x;
    return {
      corr_input: fmtR(corr(pts.map((x) => x.din), usd)),
      corr_size: fmtR(corr(pts.map((x) => x.tok), usd)),
      max_input_multiple: best ? Math.round(best.din / best.tok) : null,
      small_skill_tokens: best ? best.tok : null,
      // Two different counts, and the page conflated them (approval B-F1). Input
      // falling is not cost falling: writing-plans/gpt-5.6-sol is Δin −253 with
      // Δout +826 and renders +$23.53/1k on the same page.
      negative_input_cells: pts.filter((x) => x.din < 0).length,
      cheaper_cells: pts.filter((x) => x.usd < 0).length,
    };
  })();

  // AC-7 — measurement overhead in TIME, measured from the receipts' own wall_ms.
  const wallClock = runWallClockFromReceipts(collectedReceipts);

  // AC-7 (approval F1) — WHICH substrates did the judge outcost, and by how much.
  // This was hardcoded as "the two lower-priced substrates", which the criterion
  // requires to be NAMED and which a re-render on other data would leave asserting
  // a relation the receipts no longer carry. Derived per substrate, and reported
  // with its margin: on claude-sonnet-5 it is a 1.5% margin, which is not the same
  // claim as a comfortable one.
  const judgeFacts = (() => {
    const per = new Map();
    for (const r of collectedReceipts) {
      const m = (r.run || {}).model_id, e = r.economics || {};
      if (!m) continue;
      const g = ['with_skill', 'baseline'].reduce((sum, arm) => sum + ((e[arm] || {}).mean_cost_usd_per_call || 0) * ((e[arm] || {}).call_count || 0), 0);
      const j = ((e.judge_overhead || {}).total_cost_usd) || 0;
      const acc = per.get(m) || { model: m, gen: 0, judge: 0, receipts: 0, judgeHeavier: 0 };
      acc.gen += g; acc.judge += j; acc.receipts++; if (j > g) acc.judgeHeavier++;
      per.set(m, acc);
    }
    const all = [...per.values()];
    const heavier = all.filter((x) => x.judge > x.gen)
      .map((x) => ({ ...x, marginPct: x.gen > 0 ? (100 * (x.judge - x.gen)) / x.gen : null }));
    // The thinnest margin is the one worth naming as fragile, and it is found by
    // COMPARING margins — naming heavier[0] was right only by accident of receipt
    // ordering (approval A-F2).
    const thinnest = heavier.length
      ? heavier.reduce((a, b) => ((a.marginPct == null ? Infinity : a.marginPct) <= (b.marginPct == null ? Infinity : b.marginPct) ? a : b))
      : null;
    return { per: all, heavier, thinnest, receiptsJudgeHeavier: all.reduce((n, x) => n + x.judgeHeavier, 0) };
  })();

  // AC-6 (approval F6) — the substrate-price multiplier was prose ("about 3.3×").
  // Derived from the frozen snapshots so it cannot drift from the rates that
  // actually priced the run.
  const priceSpread = (() => {
    const rates = new Map();
    for (const r of collectedReceipts) {
      const m = (r.run || {}).model_id;
      const snap = (((r.run || {}).pricing_snapshot || {}).models || {})[m];
      if (m && snap && Number.isFinite(Number(snap.input_per_mtok))) rates.set(m, Number(snap.input_per_mtok));
    }
    if (rates.size < 2) return null;
    const sorted = [...rates.entries()].sort((a, b) => a[1] - b[1]);
    const [lowModel, low] = sorted[0], [highModel, high] = sorted[sorted.length - 1];
    return { lowModel, highModel, multiple: low > 0 ? high / low : null };
  })();

  // AC-10 — the pinned-vs-current count is read from the live-check record, never
  // written as prose. Absent record renders as unverified, which fails the gate:
  // unverifiable means unpublishable, not assumed-true.
  const skillCheck = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'skill-version-check.json'), 'utf8')); }
    catch (_e) { return { checked_at: null, total: null, identical: null, revised: [], unverified: ['record missing'] }; }
  })();

  const receiptCount = fs.readdirSync(receiptsDir).filter((f) => f.endsWith('.json')).length;
  const surfaceList = surfaces.map((s) => `${s.model} → ${s.surface}`).join(', ');
  // F1: the run total is DERIVED FROM THE RECEIPTS at their own frozen rates —
  // never from the up-front projection, which prices assumed token constants at
  // today's registry and would make the page's own disclosure false.
  const runTotal = runTotalFromReceipts(collectedReceipts);
  // The three printed figures are the EXACT display triple: total is the sum of
  // the printed components, so the arithmetic a reader can do on the page holds.
  // The verification level is stated, not implied (CONSTITUTION invariant 1).
  const d = runTotal.display || {};
  const totalStr = runTotal.traceable
    ? `<strong>${fmtUsd(d.total_usd)}</strong> <span class="muted">(${fmtUsd(d.generation_usd)} generation + ${fmtUsd(d.judge_usd)} judge measurement, derived from the receipts at their frozen rates; verification level <strong>${esc(runTotal.verification_level)}</strong>, the weakest among the ${runTotal.receipts_counted} receipts summed)</span>`
    : '<span class="muted">not derivable — one or more receipts carry no frozen pricing</span>';
  // AC-9 — the run's start is the ONE timing fact a receipt attests: `date_utc` is
  // written once at entry and is identical across every receipt of the run. It is
  // not a completion date, and the page said "Completed <that date>" until spec
  // 002. Receipts carry per-call wall_ms but no finish stamp, so any finish is
  // derived — from measured compute divided by the run's concurrency, which is a
  // launch parameter and is named as such.
  const runStarts = new Set(collectedReceipts.map((r) => (r.run || {}).date_utc).filter(Boolean));
  const runStart = runStarts.size === 1 ? [...runStarts][0] : null;
  const concurrency = opts.runConcurrency != null ? Number(opts.runConcurrency) : null;
  const derivedFinish = (runStart && concurrency > 0 && wallClock.measured)
    ? new Date(Date.parse(runStart) + (wallClock.total_hours / concurrency) * 3.6e6).toISOString()
    : null;
  // C-F3: the freeze must survive the NATURAL invocation, not depend on a caller
  // remembering a flag. Any render that reused a receipt is a render of the
  // ORIGINAL run, so the run-time projection is the pinned record; a genuinely
  // fresh run projects its own cost, and that live figure IS the run-time
  // projection, so it stays null and no freeze label renders.
  //
  // D-F3: the trigger also required `restored === 0`, which meant restoring the
  // 30 receipts from a partial-run directory — still a re-render of the same run
  // — silently dropped the freeze. `skipped > 0` alone is stricter and correct.
  const rerenderOfRecordedRun = !stub && skipped > 0;
  const projectionAtRun = opts.projectionAtRun != null ? Number(opts.projectionAtRun)
    : (rerenderOfRecordedRun ? PROJECTION_AT_RUN_USD : null);
  // D-F2: ONE source of truth. The freeze used to reach only the disclosure
  // paragraph, while the run record and the queue entry carried their own
  // hardcoded copies of the same figure — so the page could say "$99.99 … 1.9×"
  // three paragraphs above "it checked the $20.89 projection", with the gate
  // green. Everything that states the projection reads this.
  const projectionUSD = projectionAtRun != null ? projectionAtRun : projection.totalUSD;

  const timingStr = runStart
    ? `Run started <strong>${esc(runStart.slice(0, 16).replace('T', ' '))} UTC</strong> — receipt-attested, identical on all ${receiptCount} receipts. `
      + `Compute: <strong>${wallClock.total_hours} h</strong> (${wallClock.generation_hours} h generation over ${wallClock.generation_calls} calls, ${wallClock.judge_hours} h judging over ${wallClock.judged_rows} case rows). `
      + (derivedFinish
        ? `At the run's concurrency of ${concurrency} that is ≈${(wallClock.total_hours / concurrency).toFixed(1)} h elapsed, a <strong>derived</strong> finish of ≈${esc(derivedFinish.slice(0, 16).replace('T', ' '))} UTC — derived, not attested: a receipt records per-call wall-clock, not a run finish, and concurrency is a launch parameter rather than receipt evidence.`
        : 'No finish time is claimed: a receipt records per-call wall-clock, not a run finish, so a finish would be derived rather than attested.')
    : 'Run start not attested — the receipts disagree about their run stamp.';
  const runRecord = stub
    ? `STUB dry run — ${receiptCount} synthetic receipts, zero model calls. Metered-equivalent of the synthetic run: ${totalStr}. The figures are synthetic; the derivation is real.`
    : `${timingStr} ${receiptCount} receipts (${skills.length} skills × ${models.length} substrates, with/without × n=5, judged by <code>${esc(REPORT_005_JUDGE_MODEL)}</code>). Surfaces: ${esc(surfaceList)}. ${surfaces.every((s) => isSubscriptionSurface(s.surface)) ? `Metered spend <strong>$0</strong> (vendor subscription CLIs); metered-equivalent ${totalStr}` : `Metered spend ${totalStr}`}. The $${maxUsd} guard did not fire: it checked the $${projectionUSD.toFixed(2)} projection, not accrued spend — see the disclosure above.${notMeasured.length ? ` ${notMeasured.length} receipt(s) incomplete (failed_timeout) and excluded — re-run to complete.` : ' All receipts complete.'} ${resume ? `[resume: ${restored} restored, ${skipped} skipped]` : '[fresh]'}`;

  fs.writeFileSync(path.join(draftDir, 'index.html'), draftHtml({
    rows, models, surfaces, projection, stub, tally, notMeasured, runRecord, nowIso, pricingFrozenAt,
    wallClock, money: runTotal, costFacts, skillCheck, maxUsd, judgeFacts, priceSpread,
    // Frozen at the value the run itself projected (approval A-F3); absent for a
    // fresh run, where the live projection IS the run-time projection.
    projectionAtRun: projectionAtRun,
    projectionUSD,
    // The receipts path RENDERED. Defaults to the directory actually read, so a
    // draft says `-draft` truthfully; promotion passes the published path, since
    // the receipts move under it (approval B-F4). Never inferred from `stub`.
    receiptsLabel: opts.receiptsLabel
      || (published ? `receipts/report-${REPORT_NUMBER}/` : `${path.relative(outRoot, receiptsDir)}/`.replace(/\\/g, '/')),
    published,
  }));

  const summary = `Report #${REPORT_NUMBER} ${stub ? 'STUB DRAFT staged' : 'DRAFT ready'}: VALUE report over ${models.length} substrates (${models.join(', ')})`
    // C-F5: the queue entry is what a human reads at RUNBOOK step 1, so it must
    // not carry the framing AC-1 retired. "Reportable lift" said too much: a
    // separated cell may be separated by a REGRESSION, and may still fail the
    // floor on aggregate. Same three counts as the headline, same split.
    + ` — ${tally.measured} measured: ${tally.reportable} separated by at least one case`
    + ` (${tally.improving} with an improving one, ${tally.regression_only} with only a regressing one),`
    + ` ${tally.priced} clearing the floor on aggregate (${tally.priced - tally.saving} carry a price, ${tally.saving} report a saving),`
    + ` ${tally.within_noise} within noise.`
    + `${tally.not_measured ? ` ${tally.not_measured} NOT MEASURED.` : ''}${tally.low_res ? ` ${tally.low_res} low-res.` : ''}`
    + `${resume ? ` [resume: ${restored} restored, ${skipped} skipped]` : ' [fresh]'}`
    + ` ${stub ? `Projected real-run cost ~$${projectionUSD.toFixed(2)}` : `Est. metered-equiv ~$${projectionUSD.toFixed(2)}`} (guard $${maxUsd}).`;
  const goCommand = `node scripts/prepare-report-005.js --execute --max-usd ${maxUsd}`;
  const entry = `## [${nowIso}] ${summary}\n\n`
    + `- Draft page: \`docs/reports/${REPORT_NUMBER}-draft/index.html\` (noindex, NOT linked, NOT pushed)\n`
    + `- Receipts: \`receipts/report-${REPORT_NUMBER}-draft/\` (${stub ? 'stub/synthetic' : 'live'})\n`
    + `- Type: VALUE report — three axes (accuracy lift / Δcost / Δlatency), shown together, never combined\n`
    + `- Substrates: ${surfaceList}; judge \`${REPORT_005_JUDGE_MODEL}\` (n=5)\n`
    + (notMeasured.length ? `- NOT MEASURED: ${notMeasured.map((n) => `${n.slug}/${n.model} (${n.failed} failed)`).join(', ')}\n` : '')
    + (stub ? `- To run the real report: \`${goCommand}\`, then ` : '- To publish: ')
    + `follow RUNBOOK.md § "Approve and publish a drafted report".\n`;
  // A published render is not a queue notification. The queue exists to tell a
  // human a draft is waiting; re-adding an entry while publishing would undo
  // RUNBOOK step 5 on every re-render.
  if (!published) appendPending(paths.pendingPublish, entry);

  return {
    reportNumber: REPORT_NUMBER, draftDir, receiptsDir, rows, tally, projection, projectedCalls, overGuard,
    models, surfaces, summary, goCommand, stub, publicTreeTouched: false, resume, fresh, restored, skipped, notMeasured,
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
  // D-F1. The promotion re-render is its OWN invocation, and it is the one the
  // RUNBOOK pins. `--execute` cannot be that command: it fetches skills over the
  // network and runs a live smoke preflight before it reaches the renderer, so
  // "this makes no model calls" was false of the command even when it was true of
  // the function underneath. `--render-only` skips the preflight entirely and
  // refuses rather than generating anything (see runOne).
  const renderOnly = !!f['render-only'];
  const published = !!f.published;
  if (renderOnly && (execute || smokeOnly)) {
    console.error('--render-only cannot be combined with --execute or --smoke: it exists precisely to avoid that path.');
    process.exit(2);
  }
  if (renderOnly && f.fresh) {
    console.error('--render-only cannot be combined with --fresh: --fresh discards the receipts and --render-only cannot '
      + 'regenerate them. Nothing has been deleted.');
    process.exit(2);
  }
  const nowIso = f.now || new Date().toISOString();
  const maxUsd = f['max-usd'] ? parseFloat(f['max-usd']) : REPORT_MAX_USD;
  const models = f.models ? String(f.models).split(',').map((s) => s.trim()).filter(Boolean) : REPORT_005_MODELS;

  if (!renderOnly && (execute || smokeOnly)) {
    try { execFileSync('node', [path.join(__dirname, 'fetch-skills.js')], { cwd: ROOT, stdio: 'inherit' }); }
    catch (e) { console.error('fetch-skills failed:', e.message); process.exit(1); }

    // Projection FIRST — always printed before anything is spent.
    const proj = estimateRunCostUSD({ draws: SAMPLING.max, caseCount: 70, samples: 5, models, judgeModel: REPORT_005_JUDGE_MODEL });
    console.log(`\nPROJECTED full-run cost: ~$${proj.totalUSD.toFixed(2)} (guard $${maxUsd})  [${proj.perModel.map((p) => `${p.model} ~$${p.usd.toFixed(2)}`).join(', ')}]`);
    console.log(`PROJECTED live calls: ~${projectCalls(70, 5, SAMPLING.max) * models.length} for the full run (${models.length} substrates × 10 suites × 70 cases × (${SAMPLING.max} draws × (2 gens + 2×5 judge))) + ${models.length} for the light smoke.`);
    if (proj.totalUSD > maxUsd) { console.error(`  ⚠ projection EXCEEDS the $${maxUsd} guard — aborting. Raise --max-usd or trim.`); process.exit(3); }

    console.log(`\nSMOKE preflight (light — one tiny completion per substrate, ${models.length} calls total; also asserts each surface REPORTS USAGE):`);
    try { await smokeTest(models); }
    catch (e) { console.error(`\nSMOKE FAILED — aborting before the full run: ${e && (e.message || e)}`); process.exit(1); }
    console.log('SMOKE passed. Starting the full run…\n');
    if (smokeOnly) { console.log('--smoke only: stopping after preflight (no full run).'); return; }
  }

  const res = await prepareReport005({
    execute, renderOnly, published, fresh: !!f.fresh,
    // A re-render must not import receipts from anywhere: it renders what is
    // already there. `--restore-from` is a run-resume affordance.
    restoreFrom: renderOnly ? null : (f['restore-from'] || undefined),
    maxUsd, now: nowIso, outRoot: f['out-root'] || undefined, models,
    // Promotion re-render (RUNBOOK § "Approve and publish", step 2). The receipts
    // move out of `-draft`, so the rendered path must move with them; the
    // projection must NOT be recomputed at that moment (C-F3).
    receiptsLabel: typeof f['receipts-label'] === 'string' ? f['receipts-label'] : undefined,
    // The run's concurrency is a LAUNCH parameter, not receipt evidence, and the
    // page's derived finish is computed from it. Without a flag no documented
    // command could reproduce the approved page: promotion would silently drop
    // the derived-finish sentence. Approval run 4 raised this as an observation
    // alongside D-F1; it is the same defect — the shipped invocation not being
    // able to produce the shipped artifact.
    runConcurrency: f['run-concurrency'] !== undefined && f['run-concurrency'] !== true
      ? Number(f['run-concurrency']) : undefined,
    projectionAtRun: f['projection-at-run'] !== undefined && f['projection-at-run'] !== true
      ? Number(f['projection-at-run']) : undefined,
  });
  console.log(res.summary);
  console.log(`draft: ${path.relative(ROOT, res.draftDir)}/index.html`);
  console.log(`receipts: ${path.relative(ROOT, res.receiptsDir)}/  (${res.stub ? 'STUB — synthetic' : 'live'})`);
  if (res.resume) console.log(`resume: ${res.restored} restored from backup, ${res.skipped} completed pair(s) skipped.`);
  if (res.notMeasured && res.notMeasured.length) {
    console.log(`\n⏱ NOT MEASURED (${res.notMeasured.length} incomplete receipt(s), excluded):`);
    for (const n of res.notMeasured) console.log(`    ${n.slug} / ${n.model} — ${n.failed} case(s) failed_timeout`);
    console.log('    Re-run the same command to retry only these (completed pairs are skipped).');
  }
  if (res.stub) {
    console.log(`\nThis was a STUB dry run — NO model was called. To execute the real Report #005:\n\n    ${res.goCommand}\n`);
    console.log('Then review the draft and follow RUNBOOK.md § "Approve and publish a drafted report".');
  } else {
    console.log('\nNOT published — review the draft + write the QA record, then follow RUNBOOK.md to approve.');
  }
}

if (require.main === module) main().catch((e) => { console.error('FATAL', e && (e.stack || e.message)); process.exit(1); });

module.exports = { prepareReport005, skillDirection, draftHtml, smokeTest, REPORT_NUMBER, ACKNOWLEDGMENT };
