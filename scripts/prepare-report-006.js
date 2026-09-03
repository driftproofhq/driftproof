#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-006.js — render Driftproof Report #006, a REVISION DRIFT report.
//
// The fifth report type, and the one that completes the set. #001 and #003 moved
// the model release, #002 the vendor surface, #004 the capability tier, #005 the
// axes and the price. Every one of them held the skill text fixed and moved
// something underneath it. This one inverts the design: same model, same
// provider, same surface, same suite, same fixed judge, same sampling — and the
// SKILL'S OWN TEXT moves, from the revision #005 pinned to the revision upstream
// ships today.
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN. scripts/run-report-006.js spends the
// study's basis and writes the receipts and the per-cell control records; this
// reads them. It makes no model call and no network call, so it is safe to
// re-run: the page is a pure function of the committed receipts.
//
// It deliberately calls `verdictForCell` from the runner rather than
// re-deriving a verdict of its own. The runner's verdict path is the one spec
// 009 gates (AC-6's control, AC-13's revision-pair preconditions, AC-7's floor);
// a second path here would be a second definition of what #006 measured, and two
// definitions drift. Same reason lib/revision.js owns the report type's
// LANGUAGE: the fairness sentence is the one a measurement project is most
// tempted to write in one direction only, so it is generated, not typed.
//
// Usage:
//   node scripts/prepare-report-006.js              # render docs/reports/006-draft/
//   node scripts/prepare-report-006.js --check      # render to a temp dir, diff, exit 1 on drift
//   node scripts/prepare-report-006.js --promote    # AFTER the draft rename: apply the staged #005 amendment

const fs = require('fs');
const path = require('path');
const { receiptLinksBlock } = require('./receipt-links.js');
const { CELLS, verdictForCell, freshReceiptFor } = require('./run-report-006.js');
const { revisionClass, fairnessSentence, scopingNote } = require('../lib/revision');
const { EFFECT_FLOOR } = require('../config');

const ROOT = path.join(__dirname, '..');
const R5 = path.join(ROOT, 'receipts', 'report-005');
const R6 = path.join(ROOT, 'receipts', 'report-006');
// The stability probe. An EXPLORATORY artifact, not a receipt — it carries
// `not_a_receipt: true` and is filed under the spec's evidence, never under
// receipts/, because it grades no skill and attests no verdict. It is committed
// so that every noise claim on this page resolves to a file a reader can open.
const PROBE = path.join(ROOT, 'specs', '009-revision-drift', 'evidence', 'probe-baseline-stability-20260828.json');
// The probe artifacts are this report's published evidence, not spec-internal
// working files: three claims on this page (the spread, the two modes, the
// retraction) resolve to them and to nothing else. They are therefore COPIED into
// the page's own evidence/ directory, which travels with the page when the publish
// sequence renames -draft/ away, and linked RELATIVELY so the links survive that
// rename. build-public.sh strips ^specs/ from the published tree, so the previous
// absolute specs/ links resolved on the dev tree and 404'd for a public reader
// (approval finding F-009-O). The specs/ copy above stays the renderer's source.
const PROBE_EVIDENCE = 'evidence/probe-baseline-stability-20260828.json';
const PROBE_DRAWS_EVIDENCE = 'evidence/probe-baseline-stability-20260828.draws.jsonl';
const PROBE_PROGRESS_EVIDENCE = 'evidence/probe-baseline-stability-20260828.progress.txt';

// The page is rendered to a *-draft/ path and stays there until the publish
// sequence renames it (DECISIONS, 2026-08-29). The rename is the whole switch:
// nothing in the bytes marks the draft state, so nothing has to be stripped.
const OUT_DIR = path.join(ROOT, 'docs', 'reports', '006-draft');
const P005 = path.join(ROOT, 'docs', 'reports', '005', 'index.html');

// The anchor #006 links back to. #005's fairness disclosure — the paragraph that
// flagged this exposure before anything had measured it — is an unanchored <li>,
// so the amendment gives it an id. That is chrome, not a figure: AC-9 requires
// #005's numbers to stay legible and unedited, and adding an anchor changes no
// number, no count and no verdict on that page.
const P005_ANCHOR = 'skill-versions-pinned';
const P005_ANCHOR_NEEDLE = '<li><strong>Skill versions are pinned, not current.</strong>';

// The 2026-08-19 upstream check #006 cites. Tracked (see .gitignore's one
// exception) precisely so a published page's figure has a receipt in the repo.
// NAMED, NEVER LINKED: ^state/ is excluded from the published tree, so a link
// here would 404 for every public reader (F-009-O). The renderer reads no value
// out of this file — the page cites the scan, it does not render a figure from
// it — so there is nothing to excerpt into the published evidence.
const VERSION_CHECK = 'state/skill-version-check.json';
const BLOB = 'https://github.com/driftproofhq/driftproof/blob/main';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(3)}`);
const band = (b) => (b ? `${b.mean.toFixed(3)} ± ${(b.stddev || 0).toFixed(3)}` : 'n/a');

// What a cell actually cost, from the fresh receipt's own economics block — the
// same formula scripts/run-report-006.js uses to state the measured basis, so
// the projection and the actual are computed one way and are comparable.
function cellCostUSD(receipt) {
  const e = receipt.economics;
  if (!e) return null;
  const n = receipt.results.cases.filter((c) => c.mode === 'with_skill').length;
  return n * (e.with_skill.mean_cost_usd_per_call + e.baseline.mean_cost_usd_per_call)
    + e.judge_overhead.total_cost_usd;
}

function readCells() {
  return CELLS.map((cell) => {
    // Resolved through the runner's own resolver, which matches on the receipt's
    // attested skill.name/run.model_id rather than on a composed filename — see
    // F-009-J. A second path-composition here would be the same defect again.
    const freshPath = freshReceiptFor(cell, R6);
    if (!freshPath) throw new Error(`no fresh receipt for ${cell.slug} @ ${cell.model} in ${path.relative(ROOT, R6)} — run scripts/run-report-006.js first`);
    const fresh = JSON.parse(fs.readFileSync(freshPath, 'utf8'));
    const reused = JSON.parse(fs.readFileSync(path.join(R5, `${cell.slug}__${cell.model}.json`), 'utf8'));
    const r = verdictForCell(cell, freshPath);
    const measured = !r.pairProblem && !r.control.blocked;
    const classification = measured ? revisionClass(r.verdict) : 'NOT MEASURED';
    return {
      ...cell,
      fresh,
      reused,
      receiptPath: freshPath,
      result: r,
      measured,
      classification,
      perCase: measured ? r.verdict : [],
      pinnedDelta: reused.comparison.delta,
      currentDelta: fresh.comparison.delta,
      revisionDelta: measured ? Number((fresh.comparison.delta - reused.comparison.delta).toFixed(6)) : null,
      pinnedHash: reused.skill.content_hash,
      currentHash: fresh.skill.content_hash,
      costUSD: cellCostUSD(fresh),
      basisUSD: cellCostUSD(reused),
      fairness: measured
        ? fairnessSentence({
          slug: cell.slug,
          classification: revisionClass(r.verdict),
          report005Delta: reused.comparison.delta,
          measuredDelta: fresh.comparison.delta,
        })
        : null,
      scoping: scopingNote(cell.slug),
    };
  });
}

// ── the page ─────────────────────────────────────────────────────────────────

function headline(rows) {
  const measured = rows.filter((r) => r.measured);
  const improved = measured.filter((r) => r.classification === 'REVISION IMPROVED');
  const regressed = measured.filter((r) => r.classification === 'REVISION REGRESSED');
  const mixed = measured.filter((r) => r.classification === 'MIXED');
  const noise = measured.filter((r) => r.classification === 'WITHIN NOISE');
  const notMeasured = rows.filter((r) => !r.measured);
  const parts = [];
  if (improved.length) parts.push(`<strong>${improved.length}</strong> where the revision improved the skill`);
  if (regressed.length) parts.push(`<strong>${regressed.length}</strong> where it regressed`);
  if (mixed.length) parts.push(`<strong>${mixed.length}</strong> mixed`);
  if (noise.length) parts.push(`<strong>${noise.length}</strong> within noise`);
  if (notMeasured.length) parts.push(`<strong>${notMeasured.length}</strong> not measured`);
  const tail = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : (parts[0] || 'no cell returned a verdict');
  // The design's claim — "the substrate is the control, the text is the only
  // variable" — is a claim this report TESTED, through the AC-6 baseline arms.
  // Stating it as a standing premise is only honest where the controls passed.
  // Where they did not, the headline has to say what actually happened, because a
  // headline that recites the design while the evidence contradicts it is the
  // exact failure the control was built to prevent, moved up to the top of the page.
  if (!measured.length) {
    return `Three cells, one per skill upstream had revised since Report #005 pinned it, and <strong>none of the three returned a verdict</strong>. `
      + `Each was refused by its own baseline control: the no-skill arm, which contains no skill text and which a revision cannot touch, `
      + `failed to reproduce the arm #005 measured on the same model id, the same surface and the same suite. `
      + `A 120-call stability probe then explained the failure: <strong>the baseline measurement is a single draw from a wide distribution</strong>, `
      + `and generation-level noise — which this instrument never sampled — dominates judge-level noise, which it samples five times. `
      + `No substrate movement is needed to account for any of it. This report publishes that instead of a verdict it cannot support.`;
  }
  return `Three cells, one per skill upstream had revised since Report #005 pinned it: ${tail}. `
    + `The substrate is the control here — same model, same provider, same surface, same suite, same fixed judge — `
    + `and the skill's own text is the only variable under test.`;
}

function cellRow(r) {
  const cls = r.classification;
  const badge = cls === 'REVISION IMPROVED' ? '🔼' : cls === 'REVISION REGRESSED' ? '🔻' : cls === 'MIXED' ? '⇅' : cls === 'NOT MEASURED' ? '⃠' : '＝';
  const drivers = r.perCase.filter((c) => c.verdict === 'improvement' || c.verdict === 'regression');
  const L = [];
  L.push('      <tr>');
  L.push(`        <td><code>${esc(r.slug)}</code><br><span class="muted">${esc(r.model)}</span></td>`);
  L.push(`        <td><strong>${badge} ${esc(cls)}</strong><br><span class="muted">${esc(r.basis)}</span></td>`);
  L.push(`        <td>${fmt(r.pinnedDelta)}<br><span class="muted">pinned text · <code>${esc(r.pinnedHash.slice(0, 12))}…</code></span></td>`);
  L.push(`        <td>${fmt(r.currentDelta)}<br><span class="muted">current text · <code>${esc(r.currentHash.slice(0, 12))}…</code></span></td>`);
  L.push(`        <td>${r.measured ? fmt(r.revisionDelta) : 'n/a'}<br><span class="muted">${r.measured
    ? `${drivers.length} case(s) band-separated above the ${EFFECT_FLOOR} floor`
    : 'no verdict emitted'}</span></td>`);

  // The cell's own row carries its disclosures. A methodology footnote is read by
  // a different reader from the one looking at this row, and these are for the
  // reader looking at this row.
  const notes = [];
  notes.push(`<strong>Pre-registered:</strong> ${esc(r.prediction)}`);
  notes.push(`<strong>Outcome:</strong> ${esc(outcomeAgainstPrediction(r))}`);
  if (r.fairness) notes.push(`<strong>Amendment to Report #005:</strong> ${esc(r.fairness)}`);
  if (r.scoping) notes.push(`<strong>Scope of this cell:</strong> ${r.scoping.replace(/`([^`]+)`/g, (_m, c) => `<code>${esc(c)}</code>`)}`);
  if (!r.measured) {
    notes.push(`<strong>Not measured:</strong> ${esc(r.result.pairProblem
      ? `${r.result.pairProblem} differs between the reused and fresh receipts, which makes this pair a comparison other than a revision`
      : r.result.control.reason)}`);
  }
  L.push(`        <td class="notes">${notes.map((n) => `<p>${n}</p>`).join('')}</td>`);
  L.push('      </tr>');
  return L.join('\n');
}

// Whether the measurement matched what the spec said it would find, stated as a
// word rather than left for the reader to infer. A prediction recorded before a
// run and never scored afterwards is decoration.
function outcomeAgainstPrediction(r) {
  if (!r.measured) return 'the cell returned no verdict, so the prediction is neither confirmed nor refuted.';
  const predictedNull = /expect WITHIN NOISE|WITHIN NOISE —/i.test(r.prediction) || /^WITHIN NOISE/.test(r.prediction);
  const isNull = r.classification === 'WITHIN NOISE';
  if (predictedNull && isNull) return 'as predicted — the revision moved no case beyond its band and the effect floor.';
  if (predictedNull && !isNull) {
    return `NOT as predicted — this cell was pre-registered as a null and returned ${r.classification}. `
      + 'The spec says a non-null result in a cell whose revised bytes are inert by construction indicts the method rather than the skill; read it that way.';
  }
  if (!predictedNull && !isNull) return `as predicted — this was the cell pre-registered as the one with a plausible signal, and it returned ${r.classification}.`;
  return 'NOT as predicted — this cell was pre-registered as the one with a plausible signal and returned no measurable move.';
}

function verdictBasis(rows) {
  const items = rows.map((r) => {
    if (!r.measured) return `<li><code>${esc(r.slug)}</code> on <code>${esc(r.model)}</code> — <strong>NOT MEASURED.</strong> ${esc(r.result.pairProblem || r.result.control.reason)}</li>`;
    const drivers = r.perCase.filter((c) => c.verdict === 'improvement' || c.verdict === 'regression');
    if (!drivers.length) return `<li><code>${esc(r.slug)}</code> on <code>${esc(r.model)}</code> — no case cleared both the band separation and the ${EFFECT_FLOOR} floor.</li>`;
    const d = drivers.map((c) => `${c.verdict === 'improvement' ? '🔼' : '🔻'} <code>${esc(c.id)}</code> (${fmt(c.delta)}${(c.before && c.before.stddev === 0) || (c.after && c.after.stddev === 0) ? ' <strong>†point-band</strong>' : ''})`).join(', ');
    return `<li><code>${esc(r.slug)}</code> on <code>${esc(r.model)}</code> — ${d}</li>`;
  });
  return items.join('\n      ');
}

function perCaseTable(r) {
  if (!r.measured) return '';
  const rows = r.perCase.map((c) => {
    const flag = c.verdict === 'improvement' ? '🔼 improvement'
      : c.verdict === 'regression' ? '🔻 regression'
        : String(c.verdict).startsWith('within noise') ? esc(String(c.verdict)) : esc(String(c.verdict));
    return `        <tr><td><code>${esc(c.id)}</code></td><td>${band(c.before)}</td><td>${band(c.after)}</td><td>${fmt(c.delta)}</td><td>${flag}</td></tr>`;
  }).join('\n');
  return `    <h3><code>${esc(r.slug)}</code> on <code>${esc(r.model)}</code></h3>
    <table class="summary">
      <thead><tr><th>case</th><th>pinned text (mean ± sd)</th><th>current text (mean ± sd)</th><th>Δ</th><th>verdict</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>`;
}

function baselineControlBlock(rows) {
  return rows.map((r) => {
    const c = r.result.control;
    return `<li><code>${esc(r.slug)}</code> on <code>${esc(r.model)}</code> — <strong>${esc(c.verdict)}</strong>. `
      + `Aggregate baseline moved ${fmt(c.aggregate_baseline_delta)} between #005's receipt and this run`
      + `${c.moved_cases.length ? `; case(s) beyond the band and the ${c.floor} floor: ${c.moved_cases.map((x) => `<code>${esc(x)}</code>`).join(', ')}` : ' with no case beyond its band and the floor'}. `
      + `<span class="muted">${esc(c.reason)}</span></li>`;
  }).join('\n      ');
}


// ── the stability probe ──────────────────────────────────────────────────────
// Why this section exists at all: the control proved the baselines did not
// reproduce, and it CANNOT say why. This report's first draft said "the substrate
// moved," which was an explanation invented to fit the shape of the failure. The
// probe replaced it with a measurement.
function probeSection() {
  if (!fs.existsSync(PROBE)) return '';
  const p = JSON.parse(fs.readFileSync(PROBE, 'utf8'));
  const calls = p.results.reduce((a, r) => a + r.draws.length * (1 + p.judge.samples), 0);

  const drawTable = (r) => {
    const ordered = [...r.rows].sort((a, b) => a.draw - b.draw);
    return `    <h4><code>${esc(r.label)}</code> on <code>${esc(r.model)}</code> — 10 draws</h4>
    <table class="summary">
      <thead><tr><th>draw</th><th>mean ± judge sd</th><th>judge samples</th><th>generation chars</th></tr></thead>
      <tbody>
${ordered.map((d) => `        <tr><td>${d.draw}${d.salvaged_from ? ' <span class="muted">(salvaged)</span>' : ''}</td><td>${d.mean.toFixed(3)} ± ${(d.stddev || 0).toFixed(3)}</td><td><code>${esc(JSON.stringify(d.samples))}</code></td><td>${d.generation_chars != null ? d.generation_chars : '<span class="muted">n/a</span>'}</td></tr>`).join('\n')}
      </tbody>
    </table>
    <p class="muted">Spread ${r.min.toFixed(3)}–${r.max.toFixed(3)}, mean ${r.mean.toFixed(3)}, across-draw sd ${r.stddev_across_draws.toFixed(3)}. Report #005's pinned value ${r.pinned_005.toFixed(3)} lies <strong>${r.containment_005.inRange ? 'inside' : 'outside'}</strong> this spread (z = ${r.containment_005.z.toFixed(2)}); this report's re-measured value ${r.tonight_declared.toFixed(3)} lies <strong>${r.containment_tonight.inRange ? 'inside' : 'outside'}</strong> it (z = ${r.containment_tonight.z.toFixed(2)}). Verdict rule <strong>(${esc(r.verdict.rule)})</strong>: ${esc(r.verdict.reads)}.</p>`;
  };

  return `  <h2 id="stability-probe">Why the baselines did not reproduce — a stability probe</h2>
  <div class="card">
    <p><strong>The control proves non-reproduction. It cannot say why.</strong> That distinction is the whole of this section. An earlier draft of this report asserted that the substrate had moved — an explanation invented to fit the shape of the failure, with nothing measuring it. This replaces that assertion with 120 model calls.</p>
    <p><strong>Design.</strong> Two of the six non-reproducing cases, <strong>10 fresh draws each</strong>, 5 judge samples per draw — ${calls} calls, <strong>$0 metered</strong> on the same subscription surface. Each draw is a <em>new generation</em> of the baseline arm, which carries no skill text. Same judge (<code>${esc(p.judge.model)}</code>, n=${p.judge.samples}), same surface (<code>claude-cli</code>), and the rubric hashes are asserted equal to the report's: <code>a953d281f6a9…</code> and <code>c17f2f214cec…</code>. Held in <a href="${PROBE_EVIDENCE}"><code>${PROBE_EVIDENCE}</code></a>, with per-draw rows in <a href="${PROBE_DRAWS_EVIDENCE}"><code>${PROBE_DRAWS_EVIDENCE}</code></a>. It is marked <code>not_a_receipt: true</code> and is <strong>exploratory</strong>: it grades no skill and attests no verdict.</p>
  </div>

${p.results.map(drawTable).join('\n')}

  <h3>Where the variance actually lives</h3>
  <table class="summary">
    <thead><tr><th>case</th><th>across-draw sd (generation)</th><th>mean within-draw sd (judge)</th><th>ratio</th></tr></thead>
    <tbody>
${p.results.map((r) => `      <tr><td><code>${esc(r.label)}</code></td><td>${r.stddev_across_draws.toFixed(3)}</td><td>${r.mean_judge_stddev_within_draw.toFixed(3)}</td><td><strong>${(r.stddev_across_draws / r.mean_judge_stddev_within_draw).toFixed(1)}×</strong></td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="muted">Generation-level noise dominates judge-level noise by 3.2× and 7.5×. Driftproof samples the <em>judge</em> five times and the <em>generation</em> once — so it has been putting its error bars on the smaller of the two sources. That is the finding, and it is about this instrument, not about any skill.</p>

  <div class="card">
    <strong>The explanation ladder, as it actually happened.</strong>
    <ol>
      <li><strong>"The substrate moved."</strong> The first reading, from the control alone. It fit every observation and rested on nothing.</li>
      <li><strong>"The scores are bimodal."</strong> After the first draws showed a low mode and a high mode, this looked like a clean two-state story.</li>
      <li><strong>"Case 1 is a broad continuous spread; case 2 is tight with a rare high mode."</strong> Where 20 draws actually land. Case 1 runs 0.300–0.808 with draws at 0.506, 0.626, 0.686, 0.690, 0.732, 0.734, 0.774 — not two modes, a spread. Case 2 sits between 0.214 and 0.300 in nine draws and jumped to 0.856 in one.</li>
    </ol>
    <p><strong>The probe session retracted its own claim mid-run.</strong> With eight tight draws on case 2 in hand, it computed this report's re-measured 0.852 as roughly <em>122 standard deviations</em> from the mean — a number that reads as impossible. Draw 9 then returned <strong>0.856</strong>, landing squarely on the high mode and demolishing that statistic. The "122 sigma" figure was an artifact of estimating a standard deviation from a sample that had not yet met the tail. It is recorded here because a retraction that leaves no trace is not a retraction; the draw-by-draw sequence is in <a href="${PROBE_PROGRESS_EVIDENCE}"><code>${PROBE_PROGRESS_EVIDENCE}</code></a>.</p>
  </div>

  <div class="card">
    <strong>What this does and does not license us to say.</strong>
    <ul>
      <li><strong>Neither number is authoritative at the tails.</strong> #005's pinned values and this report's re-measured values are <em>both</em> single draws from these spreads. Case 2 is the proof: #005's 0.282 is the <strong>modal</strong> value, and this report's 0.852 was the roughly <strong>1-in-10</strong> outcome. <strong>The fresh measurement can be the fluke.</strong> Nothing on this page presents a re-measured lift as a corrected value.</li>
      <li><strong>The honest-labeling caveat.</strong> Today's draws measure noise <em>now</em>. Ruling out luck for the gap between the two runs — 2026-08-18 to 2026-08-28, both receipt-attested — assumes the noise level did not itself change over that interval, and <strong>#005's one-generation-per-cell design cannot confirm that either way</strong>.</li>
      <li><strong>Rule (b) fired on both cases:</strong> generation-level noise explains every baseline gap examined. <em>No substrate movement is needed</em> to account for what the control saw. That is not the same as proving none occurred.</li>
      <li><strong>Two cases, not six.</strong> The other four non-reproducing cases were not probed. Their gaps are unexplained rather than explained.</li>
    </ul>
  </div>

  <div class="card">
    <strong>Prior work, and what is actually new here.</strong>
    <p>Sampling variance in LLM evaluation is established ground, not our discovery. Miller (2024), <a href="https://arxiv.org/abs/2411.00640">arXiv:2411.00640</a>, sets out resampling and error bars for exactly this class of measurement; <a href="https://arxiv.org/abs/2502.08943">arXiv:2502.08943</a> quantifies how badly single-sample evaluation understates variance in benchmark scores. Both describe what the probe re-derived the hard way.</p>
    <p><strong>What we claim is narrower and, as far as we can tell, unoccupied: applying it to agent-skill verification, and turning it on our own published numbers.</strong> The literature says single-draw benchmarks are unreliable. This report is a verification project discovering that its own receipts inherited the defect, publishing the draws that show it, and changing the receipt specification because of it — rather than leaving the finding as a caveat about someone else's work.</p>
  </div>
`;
}

function buildPage(rows, { nowIso }) {
  const totalCost = rows.reduce((a, r) => a + (r.costUSD || 0), 0);
  const totalBasis = rows.reduce((a, r) => a + (r.basisUSD || 0), 0);
  const anyNonNull = rows.some((r) => r.measured && r.classification !== 'WITHIN NOISE');
  const anyMeasured = rows.some((r) => r.measured);
  const runDate = rows[0] && rows[0].fresh.run.date_utc;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof — Report #006: what happens when the skill's own text moves?</title>

<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report">
  <h1>Report #006 — the skill text moves, the substrate holds still</h1>
  <p class="report-type">Revision drift report — a pinned skill revision against the revision upstream ships today, on a held substrate. The fifth report type: #001 and #003 moved the model release, #002 the vendor surface, #004 the capability tier, #005 the axes and the price. Here the skill's own text is the variable and everything underneath it is the control.</p>
  <div class="headline">
    <p class="big">${headline(rows)}</p>
    <p>Report #005 published a fairness disclosure saying that two of its ten pinned skills had already been revised upstream at the time it ran. This report is that disclosure <em>measured</em> rather than repeated. Where a revision improved a skill, #005's published figure understates the pack a reader can install today, and this report says so in the cell's own row and amends #005 rather than editing it. Where a cell lands within noise, the pin was still representative, and that is the finding — there is no salvage framing for a null.</p>
  </div>

  <div class="card">
    <strong>How to read a revision-drift cell — and what it does NOT mean.</strong>
    <ul>
      <li><strong>The comparison is text vs text, on one substrate.</strong> Each cell reuses #005's receipt as the <em>pinned-text</em> arm and runs a fresh <em>current-text</em> arm on the same model, provider, surface, suite and judge. The verdict rule is the one every Driftproof report shares and this one did not touch: a case counts only when its <code>with_skill</code> bands do not overlap <em>and</em> the mean moves at least ${EFFECT_FLOOR}.</li>
      <li><strong>The reused arm is a tested prediction, not an assumption.</strong> A receipt records <code>run.model_release_date</code> as null, so id equality alone cannot prove the substrate held still while the text moved — a provider that re-points a concrete id at a new snapshot is invisible to it. Every fresh run also emits a <em>baseline</em> arm, which contains no skill text and which the revision cannot touch by construction, so comparing it against #005's baseline re-measures exactly that, at no extra cost. A cell whose baselines do not reproduce is <strong>NOT MEASURED</strong>, and no verdict is published for it. The per-cell controls are below, and each one is a committed record, not a log line.</li>
      <li><strong>One substrate per skill, chosen by a rule stated in advance.</strong> The substrate where #005 measured that skill's largest effect — where a revision has the most room to show, and where a null is most informative. For <code>writing-plans</code> that rule picks <code>claude-fable-5</code> over <code>claude-sonnet-5</code> by <strong>one thousandth</strong> (+0.177 against +0.176), far inside its own band. That is a tie, not a choice: running the sonnet-5 cell instead would have been an equally defensible application of the same rule, and the reader is entitled to know it.</li>
      <li><strong>Not a claim that revisions are large.</strong> The report type's claim is that revision drift is <em>measurable and separable</em> from release drift. Two nulls and one signal is a result.</li>
      <li><strong>Not a quality judgement of the upstream maintainers.</strong> A revision that does not move this suite may be doing something this suite does not measure — and in one cell below, that is explicitly the case.</li>
    </ul>
  </div>

  <div class="card">
    <strong>Disclosure.</strong>
    <ul>
      <li><strong>What this run cost, and what the guard believed.</strong> The three fresh cell-arms were pre-registered at a measured basis of <strong>$${totalBasis.toFixed(2)}</strong>, recomputed from #005's own economics blocks for exactly these cells, and cost <strong>$${totalCost.toFixed(2)}</strong> metered-equivalent. The cost guard's own projection for the same calls was <strong>$2.4553</strong>: it is a fixed token table that does not model the fixed CLI harness preamble, so <code>--max-usd 2</code> per cell bounded <em>call volume</em>, not dollars. That under-projection is a standing property of <code>lib/cost.js</code>, visible because #005 finally measured the truth; it is filed, not fixed here. Actual metered spend was <strong>$0</strong> — these are subscription CLI surfaces, and the dollar figures are the if-it-had-been-metered equivalent, counted against the caps identically because subscription attention is not free.</li>
      <li><strong>The pinned arm was free, and that is a claim this report tests.</strong> Zero fresh pinned-text runs. The whole saving rests on the baseline-reproduction control above, which is why the control is reported per cell rather than summarised.</li>
      <li><strong>Only revised skills appear.</strong> The other seven skills #005 measured are byte-identical to their pins and have no revision to measure; running one would spend money to produce a tautology.</li>
      <li><strong>Third-party skill text is not committed.</strong> The current-text arm runs against an untracked workdir staged from the pinned raw URLs and verified by sha256 before the first model call. This repository records <code>repo_sha</code>, <code>raw_url</code> and <code>content_sha256</code> only.</li>
      <li><strong>Comparability metadata lags this report by one step.</strong> <code>suites/manifest.json</code>'s <code>comparable_reports</code> still lists #001–#005. Adding #006 before it had receipts would have put a comparability claim in the manifest for a report that had measured nothing; it is recorded as a known divergence and resolves at publish time.</li>
    </ul>
  </div>

  <h2>Per-cell verdicts</h2>
  <table class="summary">
    <thead>
      <tr><th>cell</th><th>revision verdict</th><th>#005 lift (pinned text)</th><th>#006 lift (current text)</th><th>Δ lift</th><th>what this cell says</th></tr>
    </thead>
    <tbody>
${rows.map(cellRow).join('\n')}
    </tbody>
  </table>
  <p class="muted">Per cell: the classification under the shared verdict rule; the with/without lift #005 measured on the text it had pinned; the lift this report measures on the current upstream text, on the same substrate and the same suite; and the change between them. The Δ lift column is the difference of two aggregate lifts and is shown for orientation — <strong>the verdict is decided per case on band separation and the ${EFFECT_FLOOR} floor, never on this column</strong>. Every number re-derives from the receipts under <code>receipts/report-006/</code> and <code>receipts/report-005/</code>; nothing is hand-entered.</p>

  <details class="card"><summary><strong>Verdict basis — the per-case drivers in each cell.</strong> A case drives a cell only when its <code>with_skill</code> bands under the pinned and current text do not overlap AND the mean moves at least ${EFFECT_FLOOR}. Cases marked <strong>†point-band</strong> rest on a zero-width band (all 5 judge samples identical).</summary>
    <ul>
      ${verdictBasis(rows)}
    </ul>
  </details>

  <details class="card"><summary><strong>The baseline-reproduction control, per cell.</strong> The check that makes the reused pinned arm honest: the fresh no-skill baseline re-measured against #005's, on the same rule as everything else.</summary>
    <ul>
      ${baselineControlBlock(rows)}
    </ul>
  </details>

  <h2>Per-case detail</h2>
${rows.map(perCaseTable).filter(Boolean).join('\n')}

${probeSection()}
  <h2>Run record</h2>
  <div class="card"><p>Current-text arms run <strong>${esc(String(runDate || '').replace('T', ' ').slice(0, 16))} UTC</strong>, receipt-attested. ${rows.length} fresh receipts (${rows.length} skills × 1 substrate each, with/without × n=5, judged by <code>claude-haiku-4-5</code>), ${rows.reduce((a, r) => a + r.fresh.results.cases.filter((c) => c.mode === 'with_skill').length * 12, 0)} model calls. Pinned-text arms reused from Report #005 at no cost. Surfaces: ${esc([...new Set(rows.map((r) => `${r.model} → ${r.fresh.run.surface}`))].join(', '))}. Metered spend <strong>$0</strong> (vendor subscription CLIs); metered-equivalent <strong>$${totalCost.toFixed(2)}</strong> against a pre-registered basis of <strong>$${totalBasis.toFixed(2)}</strong>. Verification level: <strong>${esc([...new Set(rows.map((r) => r.fresh.verification_level || 'TESTED'))].join(', '))}</strong>, the weakest among the receipts summed. Upstream revision scan: <code>${VERSION_CHECK}</code>, the 2026-08-19 record #005's disclosure was written from — cited by path and date, not linked: it is kept in the source repository and build-public.sh excludes it from the published tree.</p></div>

  <h2>Relation to Report #005</h2>
  <div class="card">
    <p>This report exists because <a href="../005/index.html#${P005_ANCHOR}">#005's fairness disclosure</a> named the exposure before anything had measured it: eight of ten skills were still byte-identical to their pins on 2026-08-19, and two were not. A third, <code>git-workflow-and-versioning</code>, was revised upstream <em>after</em> that check was made — #005's check was complete when it was made, and the timing is disclosed here rather than being allowed to look like an omission.</p>
    ${anyNonNull
    ? '<p>Because at least one cell returned a non-null verdict, Report #005 carries a versioned amendment note pointing forward to this report. #005\'s original figures are left legible and unedited: an amendment records what a later measurement showed, it does not correct a published page in place.</p>'
    : (anyMeasured
      ? '<p>Every measured cell landed within noise, so no #005 figure is amended by this report. The pins #005 measured were still representative of the packs upstream ships, and that is the finding — stated plainly, with no salvage framing.</p>'
      : '<p><strong>No cell in this report was measured, so nothing here amends a #005 figure — and nothing here confirms one either.</strong> A within-noise result would have said the pins were still representative. That is not what happened: every cell was refused by its own baseline control before a verdict existed, so this report has no evidence about the revisions in either direction.</p><p>It does raise a question about #005, and the probe above sharpens it without answering it. #005\'s per-cell lifts rest on baselines measured with <strong>one generation each</strong>, and two of those baselines are now shown to sit in spreads wide enough that a single draw does not pin them. <strong>This report\'s re-measured lifts are single draws from the same spreads and are not replacements for #005\'s figures.</strong> On <code>commit-message-conventional-type</code> the direction of the doubt actually runs toward this report: #005\'s 0.282 is the modal value across ten draws, and the 0.852 measured here was the roughly 1-in-10 outcome. The question of what #005\'s lifts would be under proper generation sampling is <strong>left open</strong>, because nothing run so far can close it.</p>')}
  </div>

  <h2>Amendments</h2>
  <div class="card">
    <p class="muted">v1.0 · ${esc(nowIso.slice(0, 10))} — First publication.</p>
  </div>

  <h2>Receipts</h2>
${receiptLinksBlock('006', { root: ROOT })}
  <p class="muted">Receipts are named as <code>bin/driftproof run</code> writes them, <code>&lt;slug&gt;-&lt;model&gt;-&lt;date&gt;.json</code>. Beside each one sits a <strong>control record</strong>, <code>&lt;same base&gt;.control.json</code>, holding that cell's baseline-reproduction result and its revision-pair preconditions — the persisted proof that no verdict was emitted past a failed control. A cell that passed its control would also carry a rendered drift report; <strong>none of the three did</strong>, and the absence of those files is itself the evidence. The pinned-text arm of every cell is a Report #005 receipt, linked from <a href="../005/index.html">that report's own receipts block</a>.</p>
  <details class="card"><summary><strong>The three control records.</strong> Each one names the cases whose no-skill baseline failed to reproduce, and is re-readable rather than logged.</summary>
    <ul>
${rows.map((r) => `      <li><code>${esc(r.slug)}</code> — <a href="${BLOB}/receipts/report-006/${esc(path.basename(r.receiptPath, '.json'))}.control.json">${esc(path.basename(r.receiptPath, '.json'))}.control.json</a></li>`).join('\n')}
    </ul>
  </details>

  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report #006 · Revision drift report</span></footer>
</main>
</body>
</html>
`;
}

// ── the AC-9 amendment on #005 ───────────────────────────────────────────────
// Constitution invariant 4: published reports are amended with a versioned
// record, never silently edited. Idempotent — re-running re-renders #006 and
// must not stack amendment notes on #005.
function amend005(rows, { nowIso, write = true }) {
  const anyNonNull = rows.some((r) => r.measured && r.classification !== 'WITHIN NOISE');
  // Three states, not two. "No amendment" because every cell measured a null is a
  // FINDING; "no amendment" because no cell was measured at all is an ABSENCE of
  // findings, and reporting the second in the words of the first would claim the
  // pins were confirmed representative by a study that established nothing.
  if (!rows.some((r) => r.measured)) return { applied: false, reason: 'NO CELL WAS MEASURED — every cell was refused by its baseline control, so this report establishes nothing about the revisions in either direction and has no standing to amend a #005 figure. The open question it does raise about #005 is a separate decision, not an amendment this run can write' };
  if (!anyNonNull) return { applied: false, reason: 'every measured cell landed within noise — there is no #005 figure to amend, and manufacturing an amendment for a null result would be the same laundering the fairness rule exists to prevent' };
  let html = fs.readFileSync(P005, 'utf8');
  // The idempotency needle must be a string the note ACTUALLY writes. It read
  // `reports/006`, which the note has never contained — its forward link is the
  // relative `../006/index.html` — so a second run fell through to the anchor
  // replace and threw on the already-consumed needle instead of returning here.
  // The link stays `../006/`, not `../006-draft/`: it is written into the
  // PUBLISHED #005 page, and by the time #005 carries it the publish sequence has
  // renamed the draft away (DECISIONS, 2026-08-29).
  if (html.includes(`id="${P005_ANCHOR}"`) && html.includes('../006/index.html')) {
    return { applied: false, reason: 'already amended' };
  }
  if (!html.includes(P005_ANCHOR_NEEDLE)) throw new Error('cannot find #005\'s fairness disclosure to anchor — refusing to guess');
  html = html.replace(P005_ANCHOR_NEEDLE, `<li id="${P005_ANCHOR}"><strong>Skill versions are pinned, not current.</strong>`);

  const amended = rows.filter((r) => r.measured && r.classification !== 'WITHIN NOISE');
  const note = `    <p><strong>v1.1 · ${nowIso.slice(0, 10)}</strong> — Amended by <a href="../006/index.html">Report #006</a>, which measured the upstream revisions this page&rsquo;s fairness disclosure flagged. `
    + `${amended.map((r) => `For <code>${esc(r.slug)}</code> on <code>${esc(r.model)}</code>, #006 measures the current upstream text at ${fmt(r.currentDelta)} against the ${fmt(r.pinnedDelta)} published here, so this page&rsquo;s figure ${r.classification === 'REVISION IMPROVED' ? 'understates' : r.classification === 'REVISION REGRESSED' ? 'overstates' : 'is qualified for'} the pack upstream ships today for that skill.`).join(' ')} `
    + `<strong>No figure on this page has been edited.</strong> Every number, count and verdict above is as published at v1.0.1 and re-derives from the same 30 receipts; the amendment records what a later measurement showed. This revision also gives the fairness disclosure above an anchor so #006 can link back to it — chrome, not a figure.</p>\n`;

  html = html.replace('  <h2>Amendments</h2>\n  <div class="card">\n', `  <h2>Amendments</h2>\n  <div class="card">\n${note}`);
  if (write) fs.writeFileSync(P005, html);
  return { applied: true, cells: amended.map((r) => r.slug) };
}

// ── the STAGED #005 amendment, applied at promote time ───────────────────────
// Approval finding F-009-S. This text was committed straight into
// docs/reports/005/index.html, headed 'STAGED, TAKES EFFECT ON PUBLISH … is not
// live'. EXCLUDE_RE strips *-draft/, ^specs/ and ^state/ — it does not strip a
// published report page, so the note would have ridden the first build-public.sh
// after merge, for any reason at all, and published a sentence calling itself not
// live while live, with two forward links to ../006/index.html that 404 while #006
// sits behind the draft exclusion. F-009-M's mechanism, on a file F-009-M's fix
// did not move.
//
// So the text lives under specs/, which the publish strips, and is applied HERE,
// after the draft rename. The ordering is the guarantee: --promote refuses until
// docs/reports/006/index.html exists, so the forward links cannot go live pointing
// at a directory that does not.
const STAGED_005 = path.join(ROOT, 'specs', '009-revision-drift', 'evidence', 'amendment-005-v1.1.html');

function applyStagedAmendment005({ nowIso, write = true } = {}) {
  const published006 = path.join(ROOT, 'docs', 'reports', '006', 'index.html');
  if (!fs.existsSync(published006)) {
    return { applied: false, reason: `#006 is not published yet — ${path.relative(ROOT, published006)} does not exist, so the amendment's two forward links to ../006/index.html would 404. Rename the draft first: that is step one of the guarded publish` };
  }
  if (!fs.existsSync(STAGED_005)) return { applied: false, reason: `no staged amendment at ${path.relative(ROOT, STAGED_005)}` };
  let html = fs.readFileSync(P005, 'utf8');
  // Already applied is SUCCESS, not refusal: a promote sequence that is re-run,
  // or resumed after a later step failed, must not fail on the step that is done.
  if (html.includes('<strong>v1.1 &middot;')) return { applied: false, already: true, reason: 'already applied' };

  // The comment header explains the staging and must not publish with the text.
  const fragment = fs.readFileSync(STAGED_005, 'utf8')
    .replace(/<!--[\s\S]*?-->\n?/, '')
    .replace(/\{\{DATE\}\}/g, nowIso.slice(0, 10))
    .trimEnd();

  if (!html.includes(P005_ANCHOR_NEEDLE) && !html.includes(`id="${P005_ANCHOR}"`)) {
    throw new Error('cannot find #005\'s fairness disclosure to anchor — refusing to guess');
  }
  if (html.includes(P005_ANCHOR_NEEDLE)) {
    html = html.replace(P005_ANCHOR_NEEDLE, `<li id="${P005_ANCHOR}"><strong>Skill versions are pinned, not current.</strong>`);
  }
  html = html.replace('  <h2>Amendments</h2>\n  <div class="card">\n', `  <h2>Amendments</h2>\n  <div class="card">\n${fragment}\n`);
  if (write) fs.writeFileSync(P005, html);
  return { applied: true };
}

function main(argv = process.argv.slice(2)) {
  // PROMOTE APPLIES, IT DOES NOT RENDER. By the time this runs the page has been
  // renamed out of -draft/, so rendering here would recreate the draft directory
  // the promote just retired — and re-render a published page from receipts as a
  // side effect of amending a different one.
  if (argv.includes('--promote')) {
    const st = applyStagedAmendment005({ nowIso: new Date().toISOString() });
    console.log(st.applied
      ? '  applied the staged #005 Amendment v1.1 from specs/009-revision-drift/evidence/'
      : `  staged #005 amendment NOT applied — ${st.reason}`);
    process.exit(st.applied || st.already ? 0 : 1);
  }

  const rows = readCells();
  const nowIso = new Date().toISOString();
  const html = buildPage(rows, { nowIso });

  if (argv.includes('--check')) {
    const existing = fs.existsSync(path.join(OUT_DIR, 'index.html')) ? fs.readFileSync(path.join(OUT_DIR, 'index.html'), 'utf8') : null;
    // The date line is the one field a re-render moves, so --check compares
    // everything else: a page that drifted from its receipts is the failure.
    const strip = (s) => (s || '').replace(/v1\.0 · \d{4}-\d{2}-\d{2}/, 'v1.0 · <date>');
    const same = strip(existing) === strip(html);
    console.log(same ? '  page matches the receipts' : '  ✗ page has drifted from the receipts');
    process.exit(same ? 0 : 1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
  console.log(`  wrote ${path.relative(ROOT, path.join(OUT_DIR, 'index.html'))}`);
  for (const r of rows) {
    console.log(`    ${r.slug} @ ${r.model}: ${r.classification}  (#005 ${fmt(r.pinnedDelta)} → #006 ${fmt(r.currentDelta)}, Δ ${fmt(r.revisionDelta)})`);
  }
  const a = amend005(rows, { nowIso });
  console.log(a.applied ? `  amended docs/reports/005/index.html (v1.1) for: ${a.cells.join(', ')}` : `  #005 not amended — ${a.reason}`);

}

if (require.main === module) main();
module.exports = { readCells, buildPage, amend005, applyStagedAmendment005, cellCostUSD, outcomeAgainstPrediction, main };
