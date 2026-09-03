#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-007.js — render Driftproof Report 007, the first report whose
// subject is the INSTRUMENT rather than a substrate.
//
// #001 and #003 moved the model release, #002 the vendor surface, #004 the
// capability tier, #005 the axes and the price, #006 the skill's own text. This
// one moves none of them. It re-measures three cells Report 005 already
// published, on the same suites and the same substrates, with the generation
// sampled n times per arm instead of once, and with a call timeout that finally
// executes the policy the code declared.
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN. The receipts under receipts/report-007/
// and receipts/report-007-rerun/ were written by `bin/driftproof run` and are
// committed; this reads them. It makes no model call and no network call, so it
// is safe to re-run: the page is a pure function of the committed receipts.
//
// EVERY FIGURE IS DERIVED HERE, NONE IS TYPED. The per-case verdicts come from
// the shipped rule functions (`bandOf` from lib/reuse.js, `verdictWithFloor`
// from lib/diff.js); the cell aggregates come from the receipts' own
// `results.aggregates` and `comparison`; the economics come from
// `computeEconomics` in lib/value.js over each receipt's own frozen pricing
// snapshot; the archive refusals come from `baselineReproduces` and the shipped
// REFUSAL_REASONS strings. A second definition here would be a second definition
// of what Report 007 measured, and two definitions drift.
//
// Usage:
//   node scripts/prepare-report-007.js            # render docs/reports/007/ and apply the amendments
//   node scripts/prepare-report-007.js --check    # re-render, compare, exit 1 on drift from the receipts
//   node scripts/prepare-report-007.js --page     # print the page to stdout, write nothing

const fs = require('fs');
const path = require('path');
const { bandOf, baselineReproduces, REFUSAL_REASONS } = require('../lib/reuse');
const { buildDriftReport, revisionPairProblem } = require('../lib/diff');
const { bandVerdict, varianceRatio } = require('../lib/stats');
const { computeEconomics, dollarsTraceable, median } = require('../lib/value');
const { EFFECT_FLOOR } = require('../config');
const { applyHeadTags } = require('./build-head-tags');
// The template chrome hook (spec 020 A3). applyHeadTags calls it too, so this is
// belt and braces rather than a second pass: it makes the contract visible at
// the call site, and it is idempotent.
const { renderReportPage } = require('./site-chrome');

const ROOT = path.join(__dirname, '..');
const BLOB = 'https://github.com/driftproofhq/driftproof/blob/main';

// PROMOTED at v0.7.0. The page was rendered to `007-draft/` and force-added
// while it was unreviewed; the publish sequence renames it (DECISIONS,
// 2026-08-29), and the rename is the whole switch because nothing in the bytes
// ever marked the draft state. It is now a normally tracked, published path.
const OUT_DIR = path.join(ROOT, 'docs', 'reports', '007');
const P005 = path.join(ROOT, 'docs', 'reports', '005', 'index.html');
const P006 = path.join(ROOT, 'docs', 'reports', '006', 'index.html');
const HOME = path.join(ROOT, 'docs', 'index.html');

// The judge, held across every cell and every report. Named here because the
// economics block prices its overhead separately and a reader is owed the id.
const JUDGE_MODEL = 'claude-haiku-4-5';

// NAMING: skill@model, everywhere. The prep material and the run logs number
// these cells differently ("cell 1/2/3" means two different things depending on
// which document you are holding), so the report never uses an ordinal as a name.
const CELLS = [
  {
    slug: 'code-review-and-quality',
    model: 'claude-fable-5',
    receipt: 'receipts/report-007/code-review-and-quality-claude-fable-5-2026-08-31.json',
    run: 1,
    archive005: 'receipts/report-005/code-review-and-quality__claude-fable-5.json',
    archive006: 'receipts/report-006/code-review-and-quality-claude-fable-5-2026-08-28.json',
  },
  {
    slug: 'git-workflow-and-versioning',
    model: 'claude-sonnet-5',
    receipt: 'receipts/report-007/git-workflow-and-versioning-claude-sonnet-5-2026-08-31.json',
    run: 1,
    archive005: 'receipts/report-005/git-workflow-and-versioning__claude-sonnet-5.json',
    archive006: 'receipts/report-006/git-workflow-and-versioning-claude-sonnet-5-2026-08-28.json',
  },
  {
    slug: 'writing-plans',
    model: 'claude-fable-5',
    receipt: 'receipts/report-007-rerun/writing-plans-claude-fable-5-2026-08-31.json',
    run: 2,
    // Run 1 of this cell is committed as DEFECT EVIDENCE and is not published.
    // It is read here so the report can state what a truncated run measured,
    // beside what a complete one measured.
    evidence: 'receipts/report-007/writing-plans-claude-fable-5-2026-08-31.json',
    archive005: 'receipts/report-005/writing-plans__claude-fable-5.json',
    archive006: 'receipts/report-006/writing-plans-claude-fable-5-2026-08-28.json',
  },
];

// The two commits the run receipts landed in. Named, because "both runs are
// published" is a claim a reader can check with `git show`, and an unnamed
// commit is a claim they cannot.
const RUN1_COMMIT = '7468e9e';
const RUN2_COMMIT = '7050fd8';

// The date v1.1 was filed onto this page. A CONSTANT, not `nowIso`: this page is
// byte-compared against what its receipts render, and a render-time date would
// make the page a function of the clock as well as of the receipts. The filing
// date is a fact about the amendment, so it is declared once and asserted.
const AMEND_V11_DATE = '2026-09-02';

// W-1's three dates, each one a commit in this repository's history.
const W1 = {
  literal: '2026-07-27',   // 3f6b54c — the runner skeleton, carrying `|| 120000`
  policy: '2026-07-31',    // c911ccc — retryPolicyForSurface declares 300000 for cli
  fixed: '2026-08-31',     // ef82307 — spec 017 AC-1/AC-2
};

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n, dp = 3) => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(dp)}`);
const num = (n, dp = 3) => (n == null ? 'n/a' : Number(n).toFixed(dp));
const usd = (n, dp = 6) => (n == null ? 'n/a' : `${n < 0 ? '-' : ''}$${Math.abs(Number(n)).toFixed(dp)}`);
// Signed, for an incremental column where the sign IS the finding: a bare
// `$0.012264` beside a `-$0.110884` reads as an absolute, not as a delta.
const usdSigned = (n, dp = 6) => (n == null ? 'n/a' : `${n < 0 ? '-' : '+'}$${Math.abs(Number(n)).toFixed(dp)}`);
const intSigned = (n, dp = 2) => (n == null ? 'n/a' : `${n < 0 ? '-' : '+'}${Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const int = (n) => (n == null ? 'n/a' : Number(n).toLocaleString('en-US'));
const R = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const bandStr = (b) => (b ? `${b.mean.toFixed(3)} ± ${b.sd.toFixed(3)} <span class="muted">(${b.source})</span>` : 'n/a');

// The per-case verdict, through the shipped rule and nothing else.
//
// WHY THIS CALLS THE RULE FUNCTIONS RATHER THAN A COMMAND. `driftproof diff`
// compares TWO RECEIPTS. There is no shipped command that renders within-report,
// per-case, skill-versus-baseline verdicts: the receipt carries one aggregate
// `comparison.delta`, and lib/verdict.js reads that aggregate through the effect
// floor with no band test at all. So this path composes `bandOf` and the floor
// rule directly. It re-derives no arithmetic of its own, but it is a path with no
// command behind it, and the page says so in its own disclosures.
function caseVerdict(baselineBand, skillBand) {
  const delta = skillBand.mean - baselineBand.mean;
  const raw = bandVerdict(baselineBand.mean, baselineBand.sd, skillBand.mean, skillBand.sd);
  if ((raw === 'improvement' || raw === 'regression') && Math.abs(delta) < EFFECT_FLOOR) {
    return { delta, verdict: 'no effect', why: 'below floor' };
  }
  if (raw === 'improvement') return { delta, verdict: 'improved', why: null };
  if (raw === 'regression') return { delta, verdict: 'regressed', why: null };
  return { delta, verdict: 'no effect', why: 'bands overlap' };
}

// Draw census, settle and variance, read off the generation blocks the receipt
// records. `variance_ratio` is recomputed through the shipped `varianceRatio` so
// the page's ratio and the receipt's field cannot disagree silently.
function sampling(receipt) {
  const arms = receipt.results.cases.map((c) => {
    const g = c.generation || {};
    return {
      id: c.id,
      mode: c.mode,
      drawn: g.n_drawn || 0,
      measured: g.n_measured || 0,
      unmeasured: g.n_unmeasured || 0,
      stop: g.stopping_reason || null,
      sd: typeof g.sd === 'number' ? g.sd : null,
      judgeSd: typeof g.judge_sd_mean === 'number' ? g.judge_sd_mean : null,
      ratio: varianceRatio(g.sd, g.judge_sd_mean),
      ratioUnavailable: g.variance_ratio_unavailable || null,
    };
  });
  const ratios = arms.map((a) => a.ratio).filter((x) => x != null).sort((a, b) => a - b);
  return {
    arms,
    drawn: arms.reduce((a, x) => a + x.drawn, 0),
    measured: arms.reduce((a, x) => a + x.measured, 0),
    unmeasured: arms.reduce((a, x) => a + x.unmeasured, 0),
    atMinimum: arms.filter((a) => a.stop === 'min_reached').length,
    needingExtra: arms.filter((a) => a.stop && a.stop !== 'min_reached').length,
    ratios,
    ratioMin: ratios.length ? ratios[0] : null,
    // THE SHIPPED MEDIAN, not a second convention. lib/value.js's median averages
    // the two middle values on an even count; a report that picked the upper one
    // instead would print a figure no function in this repository computes.
    ratioMedian: median(ratios),
    ratioMax: ratios.length ? ratios[ratios.length - 1] : null,
    ratioAboveOne: ratios.filter((x) => x > 1).length,
  };
}

function economicsFor(receipt) {
  const e = computeEconomics({
    cases: receipt.results.cases,
    modelId: receipt.run.model_id,
    judgeModelId: JUDGE_MODEL,
    pricingSnapshot: receipt.run.pricing_snapshot,
    surface: receipt.run.surface,
    meteredSurface: false,
  });
  const rates = receipt.run.pricing_snapshot.models[receipt.run.model_id];
  const trace = dollarsTraceable({
    arms: { with_skill: e.with_skill, baseline: e.baseline },
    rates,
    incrementalPer1kCalls: e.skill_incremental_cost_usd_per_1k_calls,
  });
  // Whether the receipt's OWN recorded block reproduces under recomputation, or
  // whether it was sealed null by the W-2 defect. Stated on the table, per cell,
  // because "recomputed" and "as recorded" are different provenances and a
  // reader is owed which one they are reading.
  const rec = receipt.economics || null;
  const recordedNull = !rec || rec.with_skill.call_count === 0;
  const reproduces = !recordedNull
    && rec.with_skill.mean_cost_usd_per_call === e.with_skill.mean_cost_usd_per_call
    && rec.baseline.mean_cost_usd_per_call === e.baseline.mean_cost_usd_per_call
    && rec.skill_incremental_cost_usd_per_1k_calls === e.skill_incremental_cost_usd_per_1k_calls;
  return { e, rates, trace, recordedNull, reproduces };
}

function readCells() {
  return CELLS.map((cell) => {
    const receipt = R(cell.receipt);
    const withArm = receipt.results.cases.filter((c) => c.mode === 'with_skill');
    const cases = withArm.map((wc) => {
      const bc = receipt.results.cases.find((c) => c.mode === 'baseline' && c.id === wc.id);
      const a = bandOf(bc);
      const b = bandOf(wc);
      return { id: wc.id, baseline: a, skill: b, ...caseVerdict(a, b) };
    });
    return {
      ...cell,
      receipt_rel: cell.receipt,
      receipt,
      cases,
      aggregates: receipt.results.aggregates,
      comparison: receipt.comparison,
      sampling: sampling(receipt),
      econ: economicsFor(receipt),
      evidenceReceipt: cell.evidence ? R(cell.evidence) : null,
      evidenceSampling: cell.evidence ? sampling(R(cell.evidence)) : null,
      sha256: require('crypto').createHash('sha256')
        .update(fs.readFileSync(path.join(ROOT, cell.receipt))).digest('hex'),
    };
  });
}

const label = (r) => `<code>${esc(r.slug)}</code>@<code>${esc(r.model)}</code>`;

// ── the archive comparisons ─────────────────────────────────────────────────
//
// Six pairs: each cell against its Report 005 receipt and against its Report 006
// receipt. Every reason string below is the tool's own, produced here by calling
// the same functions `driftproof diff` calls. None is transcribed.
function archiveRows(rows) {
  const out = [];
  for (const r of rows) {
    for (const [archive, relPath] of [['005', r.archive005], ['006', r.archive006]]) {
      const older = R(relPath);
      const pair = revisionPairProblem(older, r.receipt);
      if (pair === 'skill.content_hash') {
        out.push({
          cell: r,
          archive,
          mode: 'revision',
          refused: true,
          key: 'same_content_hash',
          reason: 'the two receipts carry the SAME skill.content_hash: there is no revision between them to measure. Compare these two with the default release mode, or supply a pair that differs only in skill.content_hash.',
          cases: [],
          olderDelta: older.comparison.delta,
          olderBand: older.comparison.delta_uncertainty,
        });
        continue;
      }
      const pre = baselineReproduces(older, r.receipt);
      if (!pre.ok) {
        out.push({
          cell: r,
          archive,
          mode: pair ? 'release' : 'revision',
          refused: true,
          key: pre.key,
          reason: REFUSAL_REASONS[pre.key](pre),
          cases: pre.cases || [],
          olderDelta: older.comparison.delta,
          olderBand: older.comparison.delta_uncertainty,
        });
        continue;
      }
      const rep = buildDriftReport(older, r.receipt, {
        labelA: String(older.run.date_utc || '').slice(0, 10),
        labelB: String(r.receipt.run.date_utc || '').slice(0, 10),
        mode: pair ? 'release' : 'revision',
      });
      const md = rep.markdown.split('\n');
      const i = md.findIndex((l) => l.startsWith('## Headline'));
      out.push({
        cell: r,
        archive,
        mode: pair ? 'release' : 'revision',
        refused: false,
        key: null,
        headline: md.slice(i + 1).filter(Boolean)[0].replace(/^\*\*|\*\*$/g, ''),
        detail: md.slice(i + 1).filter(Boolean)[1],
        cases: [],
        olderDelta: older.comparison.delta,
        olderBand: older.comparison.delta_uncertainty,
      });
    }
  }
  return out;
}

// The 006 pairs refuse in revision mode on the content hash, so the comparison a
// reader would actually run is the release-mode one. Rendered as the pair it is:
// the mode that refuses first, and then the mode that renders.
function archive006Release(rows) {
  return rows.map((r) => {
    const older = R(r.archive006);
    const pre = baselineReproduces(older, r.receipt);
    return {
      cell: r,
      refused: !pre.ok,
      key: pre.key || null,
      reason: pre.ok ? null : REFUSAL_REASONS[pre.key](pre),
      cases: pre.cases || [],
    };
  });
}


// ── the page ─────────────────────────────────────────────────────────────────

const VCLASS = (v) => (v === 'improved' ? 'v-improved' : v === 'regressed' ? 'v-regressed' : 'v-noise');

function perCaseTable(r) {
  const tally = ['improved', 'regressed', 'no effect']
    .map((v) => `${r.cases.filter((c) => c.verdict === v).length} ${v}`).join(' · ');
  return `  <h3>${label(r)} <span class="muted">(run ${r.run})</span></h3>
  <table class="summary">
    <thead><tr><th>case</th><th>baseline band</th><th>with_skill band</th><th>&Delta;</th><th>verdict</th></tr></thead>
    <tbody>
${r.cases.map((c) => `      <tr><td><code>${esc(c.id)}</code></td><td>${bandStr(c.baseline)}</td><td>${bandStr(c.skill)}</td><td>${fmt(c.delta)}</td><td><span class="v ${VCLASS(c.verdict)}">${esc(c.verdict)}</span>${c.why ? ` <span class="muted">(${esc(c.why)})</span>` : ''}</td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="muted">${tally} · 0 not measured.</p>`;
}

function tallyOf(rows, v) {
  return rows.reduce((a, r) => a + r.cases.filter((c) => c.verdict === v).length, 0);
}

function headlineBlock(rows) {
  const cases = rows.reduce((a, r) => a + r.cases.length, 0);
  const lifts = rows.map((r) => `${fmt(r.comparison.delta)} ± ${num(r.comparison.delta_uncertainty)} on ${label(r)}`).join(', ');
  return `    <p class="big">Three skills re-measured under generation sampling, with a corrected instrument. <strong>At the cell level no effect separates from noise:</strong> each of the three lifts is smaller than its own band (${lifts}). Per case across all ${cases}: <strong>${tallyOf(rows, 'improved')} improved · ${tallyOf(rows, 'regressed')} regressed · ${tallyOf(rows, 'no effect')} no effect · 0 not measured</strong>.</p>
    <p>The cell band is <strong>suite dispersion</strong>: the sample standard deviation of the per-case means across a suite's seven cases, with the two arms' dispersions combined in quadrature. It is <strong>not</strong> the standard error of the mean, and the difference decides this page. A standard error shrinks as cases and draws are added, which makes a headline hypersensitive and turns trivial movement into an apparent result; <code>aggregateBands()</code> in <code>lib/stats.js</code> records that rationale beside the code that computes it.</p>
    <p>Report 005 published lifts of ${rows.map((r) => fmt(R(r.archive005).comparison.delta)).join(', ')} for these same three cells, each measured against a baseline arm generated <strong>once</strong>. All three are lower here. None of the three is a correction: two of the three archive comparisons were <strong>refused</strong> before any verdict was formed, and the skill text changed upstream between the two runs on every cell. What this report establishes is about the instrument, not about the skills.</p>`;
}

function methodAndResult(rows) {
  const draws = rows.reduce((a, r) => a + r.sampling.drawn, 0);
  const measured = rows.reduce((a, r) => a + r.sampling.measured, 0);
  const cases = rows.reduce((a, r) => a + r.cases.length, 0);
  const wp = rows.find((r) => r.slug === 'writing-plans');
  const cse = (id) => wp.cases.find((c) => c.id === id);
  return `  <div class="card">
    <strong>What this report measures, and what it does not.</strong>
    <ul>
      <li><strong>Surface.</strong> The surface is <code>claude-cli</code> with local machine context, one box, held constant across all cells and all reports.</li>
      <li><strong>Scope.</strong> The instrument measures skill text in context on the <code>append-system-prompt</code> surface. Out of scope: routing via <code>description:</code>, progressive disclosure, and tool execution.</li>
      <li><strong>What moved.</strong> Nothing underneath the skill. Same suites, same substrates, same fixed judge (<code>${esc(JUDGE_MODEL)}</code>, five samples per draw) as Report 005. The instrument moved instead: receipt spec v0.5 samples the <em>generation</em> adaptively, a minimum of three draws per arm and more until the across-draw spread settles, and a call now gets the timeout its surface policy declares.</li>
      <li><strong>The set.</strong> Three cells, ${cases} cases, <strong>${draws} draws</strong>, ${measured} measured. Every verdict below is verifiable from the four receipts linked at the foot of this page: three published, one retained as defect evidence.</li>
    </ul>
  </div>

  <h2>The set</h2>
  <table class="summary">
    <thead><tr><th>cell</th><th>run</th><th>receipt</th><th>sha256 of file</th><th><code>receipt_hash</code></th></tr></thead>
    <tbody>
${rows.map((r) => `      <tr><td>${label(r)}</td><td>run ${r.run}</td><td><a href="${BLOB}/${esc(r.receipt_rel)}"><code>${esc(path.basename(r.receipt_rel))}</code></a></td><td><code>${esc(r.sha256.slice(0, 16))}…</code></td><td><code>${esc(r.receipt.receipt_hash.slice(0, 16))}…</code></td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="muted">All three are <code>schema_version</code> 0.5, <code>generation_sampled: true</code>, verification level <strong>TESTED</strong>, surface <code>claude-cli</code>, provider <code>anthropic</code>. ${label(wp)} is <strong>run 2</strong>, and the next section is why. The other two cells were never re-run.</p>

  <h2>Result: no cell separates</h2>
  <table class="summary">
    <thead><tr><th>cell</th><th>with_skill (mean ± band)</th><th>baseline (mean ± band)</th><th>lift</th><th>lift band</th><th>separates?</th></tr></thead>
    <tbody>
${rows.map((r) => `      <tr><td>${label(r)}</td><td>${num(r.aggregates.with_skill.mean_score)} ± ${num(r.aggregates.with_skill.stddev)}</td><td>${num(r.aggregates.baseline.mean_score)} ± ${num(r.aggregates.baseline.stddev)}</td><td><strong>${fmt(r.comparison.delta)}</strong></td><td>± ${num(r.comparison.delta_uncertainty)}</td><td><span class="v v-noise">no</span></td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="muted">Every band above is suite dispersion. All three cells are paired 7 against 7 with an empty exclusion list, so <code>run.failed_case_count</code> is absent from all three published receipts: that field appears only when a case was excluded from the aggregate.</p>

  <h2>Per-case verdicts</h2>
  <p>A case counts only when the two bands do not overlap <strong>and</strong> the mean moves at least ${EFFECT_FLOOR}. Every band below carries its provenance: <code>(generation)</code> is an across-draw spread over n generation draws, which is what receipt spec v0.5 records, and it is a different statistic from the judge-sample spread earlier receipts carried.</p>
${rows.map(perCaseTable).join('\n')}
  <p><strong>${tallyOf(rows, 'improved')} improved · ${tallyOf(rows, 'regressed')} regressed · ${tallyOf(rows, 'no effect')} no effect · 0 not measured</strong>, over ${cases} published cases.</p>

  <div class="card">
    <p><strong>Two of the eighteen are the ones a reader will argue with.</strong> <code>bite-sized-tdd-steps</code> lifts ${fmt(cse('bite-sized-tdd-steps').delta)} and <code>interfaces-exact-signatures</code> lifts ${fmt(cse('interfaces-exact-signatures').delta)}, each more than twice the ${EFFECT_FLOOR} floor, and each reads no effect. The reason sits on the same row: their baseline bands are ± ${num(cse('bite-sized-tdd-steps').baseline.sd)} and ± ${num(cse('interfaces-exact-signatures').baseline.sd)}. <strong>A lift twice the effect floor is not a finding when the baseline it is measured against will not sit still.</strong> Exactly one of the eighteen fails on the floor rather than on overlap: <code>self-review-spec-coverage</code>, at ${fmt(cse('self-review-spec-coverage').delta)}.</p>
  </div>`;
}

// ── the instrument story ─────────────────────────────────────────────────────
//
// W-1. Reported here rather than filed quietly, because it changed what a
// completed study measured and because the direction of the bias is the part a
// reader cannot guess.
function instrumentSection(rows) {
  const wp = rows.find((r) => r.slug === 'writing-plans');
  const ev = wp.evidenceReceipt;
  const evs = wp.evidenceSampling;
  const clean = wp.sampling;
  const lost = rows.reduce((a, r) => a + r.sampling.unmeasured, 0);
  const run1Lost = rows.reduce((a, r) => a + (r.run === 1 ? r.sampling.unmeasured : 0), 0) + evs.unmeasured;
  return `  <h2>The instrument, and what it cost this study</h2>
  <div class="card">
    <p><strong>A declared 300 s timeout had never executed.</strong> <code>lib/provider.js</code> declares a per-surface retry policy, and for a <code>claude-cli</code> surface it declares <strong>300000 ms</strong>, with a written rationale about cold-start-dominated subprocesses. <code>lib/run.js</code> then set its own default as a numeric literal, <strong>120000</strong>, and the provider layer documents that an explicit caller value wins. So every run this project has ever made used 120 s on every surface, and the CLI policy was dead text from the day it was written.</p>
    <p>The dates are the uncomfortable part. The literals landed on <strong>${W1.literal}</strong> with the runner skeleton. The policy that they shadowed was written on <strong>${W1.policy}</strong>, <strong>four days later</strong>, and read as authoritative from then on. Nothing failed, nothing logged, and no gate reached it until preparing this report did. It was fixed on <strong>${W1.fixed}</strong>.</p>
    <p><strong>Run 1 lost ${run1Lost} draws to it</strong>, ${evs.unmeasured} of them in ${label(wp)}. Every loss carries the same recorded reason, and the string names the number: <code>provider(claude-cli) timed out after 120000ms</code>. Run 2 re-ran that one cell under the corrected timeout and measured <strong>${clean.measured} of ${clean.drawn}</strong>, with nothing lost.</p>
    <p><strong>Both runs are published.</strong> Run 1's three receipts are committed at <code>${RUN1_COMMIT}</code> and run 2's at <code>${RUN2_COMMIT}</code>. Run 1's ${label(wp)} receipt is retained as <strong>defect evidence</strong> and is not part of the published set; the other two cells of run 1 are the published receipts for their skills, and were never re-run.</p>
  </div>

  <h3>What the broken run measured, beside what the clean one measured</h3>
  <table class="summary">
    <thead><tr><th></th><th>run 1 (truncated at 120 s)</th><th>run 2 (300 s, clean)</th></tr></thead>
    <tbody>
      <tr><td>draws</td><td>${evs.drawn} drawn, ${evs.measured} measured, <strong>${evs.unmeasured} lost</strong></td><td>${clean.drawn} drawn, ${clean.measured} measured, <strong>0 lost</strong></td></tr>
      <tr><td>mean draws per arm</td><td>${num(evs.drawn / evs.arms.length, 2)}</td><td>${num(clean.drawn / clean.arms.length, 2)}</td></tr>
      <tr><td>arms with a variance ratio</td><td>${evs.ratios.length} of ${evs.arms.length}</td><td>${clean.ratios.length} of ${clean.arms.length}</td></tr>
      <tr><td>maximum variance ratio</td><td><strong>${num(evs.ratioMax, 2)}&times;</strong></td><td><strong>${num(clean.ratioMax, 2)}&times;</strong></td></tr>
      <tr><td>arms above 1&times;</td><td><strong>${evs.ratioAboveOne} of ${evs.ratios.length}</strong></td><td><strong>${clean.ratioAboveOne} of ${clean.ratios.length}</strong></td></tr>
      <tr><td>cell lift</td><td>${fmt(ev.comparison.delta)} ± ${num(ev.comparison.delta_uncertainty)}</td><td>${fmt(wp.comparison.delta)} ± ${num(wp.comparison.delta_uncertainty)}</td></tr>
      <tr><td>pairing</td><td>${ev.results.aggregates.with_skill.case_count} against ${ev.results.aggregates.baseline.case_count}, unpaired</td><td>${wp.aggregates.with_skill.case_count} against ${wp.aggregates.baseline.case_count}, paired</td></tr>
    </tbody>
  </table>

  <div class="card">
    <p><strong>The truncated run drew more, measured less, and looked calmer.</strong> ${evs.drawn} draws against ${clean.drawn}, ${num(evs.drawn / evs.arms.length, 2)} per arm against ${num(clean.drawn / clean.arms.length, 2)}, and a maximum variance ratio of <strong>${num(evs.ratioMax, 2)}&times;</strong> where the clean run reports <strong>${num(clean.ratioMax, 2)}&times;</strong>. ${evs.ratioAboveOne} of ${evs.ratios.length} arms sat above 1&times; in run 1; ${clean.ratioAboveOne} of ${clean.ratios.length} do in run 2.</p>
    <p>The mechanism is the ordering. A 120 s ceiling removes the <em>long</em> generations first, and the long scattered generations are the ones carrying the across-draw spread. So the timeout did not merely lose data at random: <strong>it truncated the distribution from above, and biased the variance estimate downward.</strong> That is the direction that makes an instrument look more precise than it is. <strong>Silent truncation flatters stability.</strong></p>
    <p>It also cost this study its one apparent result. Run 1's ${label(wp)} lift of ${fmt(ev.comparison.delta)} ± ${num(ev.comparison.delta_uncertainty)} sat outside its own band by about a thousandth: the only separation anywhere in Report 007. Run 2's ${fmt(wp.comparison.delta)} ± ${num(wp.comparison.delta_uncertainty)} does not. Run 1 reported three improvements out of six measurable cases and could not measure the seventh at all; run 2, with every draw measured, reports two out of seven, and the case run 1 lost, <code>full-small-plan-header-and-tasks</code>, turns out to carry the largest case lift in the whole study at ${fmt(wp.cases.find((c) => c.id === 'full-small-plan-header-and-tasks').delta)}. <strong>The one result the study appeared to have was an artifact of the draws it lost.</strong></p>
    <p class="muted">One arm of run 1 lost every draw it took, so its variance ratio is <code>null</code> with <code>variance_ratio_unavailable: "no_measured_draws"</code> rather than a fabricated zero. That is why run 1 reports ${evs.ratios.length} ratios over ${evs.arms.length} arms and run 2 reports ${clean.ratios.length}.</p>
  </div>`;
}

// ── against the archive ──────────────────────────────────────────────────────
function archiveSection(rows) {
  const pairs = archiveRows(rows);
  const p005 = pairs.filter((p) => p.archive === '005');
  const p006 = pairs.filter((p) => p.archive === '006');
  const rel = archive006Release(rows);

  const mapRow = (r) => {
    const older = R(r.archive005);
    const p = p005.find((x) => x.cell.slug === r.slug);
    const why = p.refused
      ? `<br><span class="muted">baseline did not reproduce: ${p.cases.map((c) => `<code>${esc(c.id)}</code>`).join(', ')}</span>`
      : '<br><span class="muted">precondition passed; 0 regressions, 0 improvements, 7 within noise</span>';
    return `      <tr>
        <td>${label(r)}</td>
        <td><strong>${fmt(older.comparison.delta)}</strong> ± ${num(older.comparison.delta_uncertainty)} <span class="muted">(legacy)</span></td>
        <td><strong>${fmt(r.comparison.delta)}</strong> ± ${num(r.comparison.delta_uncertainty)} <span class="muted">(generation)</span></td>
        <td>${p.refused ? '<span class="v v-noise">REFUSED</span>' : '<span class="v v-noise">WITHIN NOISE</span>'}${why}</td>
      </tr>`;
  };

  const refusalItem = (p) => `      <li><strong>${label(p.cell)}</strong>, Report ${p.archive} to Report 007, <code>--mode ${p.mode}</code>: <span class="muted">${esc(p.reason)}</span>${p.cases.length ? ` <span class="muted">Non-overlapping case(s): ${p.cases.map((c) => `<code>${esc(c.id)}</code> (${num(c.observed)} against ${num(c.expected)})`).join(', ')}.</span>` : ''}</li>`;

  return `  <h2>Against Report 005</h2>
  <table class="summary">
    <thead><tr><th>cell</th><th>Report 005 lift and band</th><th>Report 007 lift and band</th><th>differ verdict, 005 to 007</th></tr></thead>
    <tbody>
${rows.map(mapRow).join('\n')}
    </tbody>
  </table>
  <p class="muted"><strong>Band provenance, which the tool does not print on this row and which the report therefore supplies.</strong> Both columns are <code>comparison.delta_uncertainty</code>, the two arms' suite dispersions combined in quadrature, but they are built from different per-case statistics. The Report 005 column rests on <strong>legacy</strong> bands: a judge-sample spread over a single generation, which is what receipt spec v0.4 and earlier recorded. The Report 007 column rests on <strong>generation</strong> bands: an across-draw spread. <strong>They are different statistics, and the comparison is not like for like.</strong> It is also the only comparison the older receipt admits.</p>

  <h3>Five of six comparisons refuse</h3>
  <p>Six comparisons were run, one per cell against each of the two archives. <strong>Five of the six refused, and every refusal is a precondition failure rather than a computed result:</strong> four on baseline non-reproduction, one on a baseline with no measured draws. A refusal is an outcome this instrument publishes, not an error it recovers from. The reason strings below are the ones the tool emits.</p>

  <h4>Against Report 005, <code>--mode revision</code></h4>
  <ul>
${p005.map((p) => (p.refused ? refusalItem(p) : `      <li><strong>${label(p.cell)}</strong>: <strong>the precondition passed.</strong> This is the one comparison of the six that produced a verdict, and it is quoted in full below.</li>`)).join('\n')}
  </ul>

  <h4>Against Report 006, <code>--mode release</code></h4>
  <ul>
${rel.map((x) => `      <li><strong>${label(x.cell)}</strong>: <span class="muted">${esc(x.reason)}</span>${x.cases.length ? ` <span class="muted">Non-overlapping case(s): ${x.cases.map((c) => `<code>${esc(c.id)}</code> (${num(c.observed)} against ${num(c.expected)})`).join(', ')}.</span>` : ''}</li>`).join('\n')}
  </ul>
  <p class="muted"><strong>Why release mode and not revision.</strong> All three Report 006 pairs refuse in revision mode before any comparison is attempted, on a different precondition: <span class="muted">${esc(p006[0].reason)}</span> Release is therefore the only mode these three pairs admit, and it is the mode the list above reports.</p>

  <p class="muted"><strong>Two of these refusals deserve a second sentence.</strong> On ${label(rows[1])} against Report 005, <em>two</em> cases moved beyond their bands, and the rendered reason names only the first: <code>baselineReproduces</code> returns <code>bad[0]</code> into the message while carrying the full list in <code>cases</code>, so the refusal a reader sees understates how many cases moved. It is true and incomplete, and it is filed. On ${label(rows[2])} against Report 006 the refusal is structural rather than empirical: Report 006's own receipt lost two arms to the same 120 s timeout, so a case on the Report 007 side has no band to compare against and the control returns <code>baseline_unmeasured</code>. <strong>Report 006's timeout losses are what stop Report 007 from comparing against it.</strong></p>

  <div class="card">
    <p><strong>The one comparison that passed its precondition.</strong> ${label(rows[2])}, Report 005 to Report 007, <code>--mode revision</code>: <strong>${esc(p005.find((p) => !p.refused).headline)}</strong></p>
    <p class="muted">${esc(p005.find((p) => !p.refused).detail)}</p>
    <p>So on the one cell where the control held, a lift of ${fmt(R(rows[2].archive005).comparison.delta)} and a lift of ${fmt(rows[2].comparison.delta)} are <strong>the same measurement</strong> as far as this instrument can tell. That is the honest reading of the mapping table above, and it is why none of the three lower lifts is presented as a correction.</p>
  </div>

  <p><strong>What the mapping shows, and what it cannot.</strong> Every lift fell and every band narrowed. All three Report 005 lifts sat inside their own bands too, so nothing here reverses a separated finding. The direction is consistent: Report 005's single-draw baselines were ${rows.map((r) => num(R(r.archive005).comparison.baseline_score)).join(', ')}, and Report 007's multi-draw baselines are ${rows.map((r) => num(r.comparison.baseline_score)).join(', ')}, higher on two of the three. <strong>A baseline generated once was, on this evidence, a low estimate, and the lift measured against it was correspondingly high.</strong> That is a claim about the instrument. It is not a claim about the skills, and this report cannot make one: two of the three comparisons never got past their control, and the skill text differs between the two runs on all three cells.</p>

  <p class="muted">Why the two band types are different statistics, and why an instrument that samples one of them is not measuring the other: a variance decomposition that partitions benchmark score variance into scenario, generation, judge and residual components is given by <em>CyclicJudge</em>, <a href="https://arxiv.org/abs/2603.01865">arXiv:2603.01865</a>. Driftproof sampled the judge five times and the generation once until receipt spec v0.5, which is to say it had been putting its error bars on one component and reading them as the whole. <em>Second-Order Response Laws for LLM Judges</em>, <a href="https://arxiv.org/abs/2608.16253">arXiv:2608.16253</a>, which cites CyclicJudge for that decomposition, goes on to the estimator: it shows that a plug-in estimate of prompt instability is <strong>biased upward</strong> at finite repeat budgets, because it confounds within-prompt noise with between-prompt variation, and derives an unbiased estimator from the difference between within- and across-prompt agreement. Report 007 does not apply that correction, and says so in its limits.</p>`;
}

// ── fresh-input re-pricing (Report 007 v1.1) ─────────────────────────────────
//
// The economics tables above price EVERY input token at the list input rate,
// cached ones included, exactly as `computeEconomics` does and as the caption
// says. That is the receipt's own convention and it is not wrong; it is a
// convention, and on a CLI surface where 90% or more of each call's input is
// cached harness context it is the convention that carries the incremental
// column. This function re-prices the SAME recorded draws with cached input
// excluded, so a reader can see which signs are properties of the skill and
// which are properties of the pricing convention.
//
// It re-derives nothing: `cached_tokens` is recorded per draw precisely so a
// reader can do this, and `economics.notes.cache_pricing` says so. Draw
// selection matches lib/value.js `generationUsages` (measured draws only), so
// the cached-inclusive figures it returns reproduce the published table.
function freshBasis(receipt) {
  const rates = receipt.run.pricing_snapshot.models[receipt.run.model_id];
  const usagesOf = (mode) => receipt.results.cases
    .filter((c) => c.case_status !== 'failed_timeout' && c.mode === mode)
    .flatMap((c) => {
      const g = c.generation || {};
      if (Array.isArray(g.draws)) return g.draws.filter((d) => d && d.status === 'measured' && d.usage).map((d) => d.usage);
      return c.usage ? [c.usage] : [];
    });
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const arm = (mode) => {
    const us = usagesOf(mode);
    const input = mean(us.map((u) => u.input_tokens));
    const cached = mean(us.map((u) => Number(u.cached_tokens) || 0));
    const output = mean(us.map((u) => u.output_tokens));
    const fresh = input - cached;
    return {
      calls: us.length,
      input,
      cached,
      fresh,
      output,
      cachedShare: cached / input,
      listedCost: (input * rates.input_per_mtok + output * rates.output_per_mtok) / 1e6,
      freshCost: (fresh * rates.input_per_mtok + output * rates.output_per_mtok) / 1e6,
    };
  };
  const w = arm('with_skill');
  const b = arm('baseline');

  // The mix control. The per-call means above weight a case by how many draws
  // adaptive stopping happened to give it, and the two arms did not stop in the
  // same places. This weights every case equally in both arms instead, which is
  // the comparison the suite was written to support. It exists to answer one
  // question only: does a sign below belong to the draw allocation?
  const ids = [...new Set(receipt.results.cases.map((c) => c.id))];
  const perCase = (mode, pick) => {
    const vals = ids.map((id) => {
      const c = receipt.results.cases.find((x) => x.id === id && x.mode === mode);
      if (!c) return null;
      const g = c.generation || {};
      const us = Array.isArray(g.draws)
        ? g.draws.filter((d) => d && d.status === 'measured' && d.usage).map((d) => d.usage)
        : (c.usage ? [c.usage] : []);
      return us.length ? mean(us.map(pick)) : null;
    }).filter((x) => x != null);
    return mean(vals);
  };
  const balanced = (mode) => {
    const fresh = perCase(mode, (u) => u.input_tokens - (Number(u.cached_tokens) || 0));
    const output = perCase(mode, (u) => u.output_tokens);
    return (fresh * rates.input_per_mtok + output * rates.output_per_mtok) / 1e6;
  };

  return {
    rates,
    with_skill: w,
    baseline: b,
    listedIncremental: w.listedCost - b.listedCost,
    freshIncremental: w.freshCost - b.freshCost,
    balancedFreshIncremental: balanced('with_skill') - balanced('baseline'),
    inputDelta: w.input - b.input,
    freshDelta: w.fresh - b.fresh,
    cachedDelta: w.cached - b.cached,
    outputDelta: w.output - b.output,
  };
}

// ── economics ────────────────────────────────────────────────────────────────
function economicsSection(rows) {
  const cheaper = rows.filter((r) => r.econ.e.skill_incremental_cost_usd_per_1k_calls < 0);
  const dearer = rows.filter((r) => r.econ.e.skill_incremental_cost_usd_per_1k_calls > 0);
  const faster = rows.filter((r) => r.econ.e.median_wall_ms_delta < 0);

  const armRow = (arm, a, rates) => `      <tr><td>${arm}</td><td>${a.call_count}</td><td>${int(a.mean_input_tokens)}</td><td>${int(a.mean_output_tokens)}</td><td>${usd(a.mean_cost_usd_per_call)}</td><td>${int(a.median_wall_ms)} ms</td><td>${int(a.wall_ms_p25)} / ${int(a.wall_ms_p75)}</td></tr>`;

  const cellTable = (r) => {
    const { e, rates, trace, recordedNull } = r.econ;
    return `  <h3>${label(r)}</h3>
  <table class="summary">
    <caption class="muted"><strong>Basis.</strong> Subscription <code>claude-cli</code> surface; metered spend <strong>$0.00</strong>. Every dollar is a metered-equivalent derived at build time from <code>draws[].usage</code> at this receipt's own frozen snapshot (input $${rates.input_per_mtok} / Mtok, output $${rates.output_per_mtok} / Mtok, frozen ${esc(String(r.receipt.run.pricing_snapshot.frozen_at))}). Read the incremental row, not the absolute ones. Judge cost is measurement overhead this project imposes and is excluded from every field.</caption>
    <thead><tr><th>arm</th><th>calls</th><th>mean input tok</th><th>mean output tok</th><th>$ / call</th><th>median wall</th><th>p25 / p75</th></tr></thead>
    <tbody>
${armRow('with_skill', e.with_skill, rates)}
${armRow('baseline', e.baseline, rates)}
      <tr><td><strong>incremental</strong></td><td>n/a</td><td><strong>${intSigned(e.with_skill.mean_input_tokens - e.baseline.mean_input_tokens)}</strong></td><td><strong>${intSigned(e.output_tokens_delta)}</strong></td><td><strong>${usdSigned(e.skill_incremental_cost_usd_per_call)}</strong> <span class="muted">(${usdSigned(e.skill_incremental_cost_usd_per_1k_calls, 3)} per 1k calls)</span></td><td><strong>${fmt(e.median_wall_ms_delta, 1)} ms</strong></td><td>n/a</td></tr>
    </tbody>
  </table>
  <p class="muted">Judge overhead, excluded: ${usd(e.judge_overhead.total_cost_usd)} over ${e.judge_overhead.case_rows_measured} case rows. Dollars re-derive from the recorded tokens and the frozen rates: <code>dollarsTraceable</code> returns <code>${esc(JSON.stringify(trace))}</code>. Source block: <strong>${recordedNull ? 'the receipt\'s recorded economics block is null; this table is a recomputation from the same committed receipt' : 'present and verified, and the recomputation matches it field for field across both arms and the incremental'}</strong>.</p>`;
  };

  return `  <h2>Economics</h2>
  <p>No figure in this section comes from a projection. <code>estimateRunCostUSD</code>, the projection path, was not called. Each table is computed at build time from the draws the receipt records, priced at the snapshot the receipt froze at run time.</p>
${rows.map(cellTable).join('\n')}

  <div class="card">
    <p><strong>${cheaper.length} of ${rows.length} cells are cheaper with the skill than without it</strong>, at ${cheaper.map((r) => `${usdSigned(r.econ.e.skill_incremental_cost_usd_per_1k_calls, 3)} per thousand calls on ${label(r)}`).join(' and ')}. The mechanism is visible in the tokens rather than asserted: mean input falls by ${cheaper.map((r) => int(Math.abs(Math.round(r.econ.e.with_skill.mean_input_tokens - r.econ.e.baseline.mean_input_tokens)))).join(' and ')} tokens per call, which is the baseline's sprawl becoming unnecessary. ${dearer.length === 1 ? `The one cell that costs more, ${label(dearer[0])}, costs <strong>${usdSigned(dearer[0].econ.e.skill_incremental_cost_usd_per_1k_calls, 3)} per thousand calls</strong>, and it is also the cell with no measured benefit at all: a lift of ${fmt(dearer[0].comparison.delta)} and zero improved cases.` : ''} Latency falls in ${faster.length} of ${rows.length}.</p>
    <p><strong>A caution the tables carry and a reader should not skip: call counts are draw counts, and draw counts differ per arm.</strong> ${label(rows[2])}'s baseline drew ${rows[2].econ.e.baseline.call_count} calls against with_skill's ${rows[2].econ.e.with_skill.call_count}, because the baseline was unstable enough to keep drawing. Per-call means are therefore computed over differently sized draw sets in the two arms. That is correct, since a draw is a call and each measured draw contributes one usage row, but it means the cost delta and the score delta are averages over unequal n, and a reader who assumes matched n will misread both.</p>
    <p class="muted">Two mechanical notes on the absolute columns. A CLI call carries a fixed harness preamble of roughly 25k input tokens that is identical in both arms and cancels in the delta, which is why the incremental row is the one to read. Cached input tokens are costed at the list input rate, which over-estimates; <code>cached_tokens</code> is recorded per call so a reader can recompute on other assumptions.</p>
  </div>`;
}

// ── disclosures ──────────────────────────────────────────────────────────────
function disclosureSection(rows) {
  const cr = rows.find((r) => r.slug === 'code-review-and-quality');
  const absorbed = cr.sampling.arms.find((a) => a.unmeasured > 0);
  const sev = cr.cases.find((c) => c.id === absorbed.id);
  return `  <h2>Disclosures</h2>
  <div class="card">
    <p><strong>The published set is not fully clean, and one absorbed draw sits inside it.</strong> ${label(cr)}'s <code>${esc(absorbed.id)}</code> baseline arm drew ${absorbed.drawn} and measured ${absorbed.measured}: one generation call was lost to the 120 s timeout, and the band for that arm was computed from the ${absorbed.measured} that survived. It produced no <code>failed_timeout</code>, no exclusion and no <code>failed_case_count</code>, because ${absorbed.measured} measured draws is a legal draw set. That is silent absorption, and it is the same failure mode this report's instrument section describes, sitting in a cell this report publishes. It is one draw of ${rows.reduce((a, r) => a + r.sampling.drawn, 0)} and it does not move the verdict, which reads ${sev.verdict} at ${fmt(sev.delta)} on a wide baseline band either way. But "run 2 fixed it" is true of ${label(rows[2])} only. The other two cells were never re-run, and this one still carries the absorbed draw.</p>
    <p><strong>Run 1's receipts were sealed with null economics, and the reader was fixed after the sealing.</strong> Both run-1 receipts record <code>call_count: 0</code> and <code>null</code> in every arm field. <code>generationUsages</code> read only the case-level <code>usage</code>, and a v0.5 receipt puts usage on the draws, so the arm figures came out empty while the draws carried complete usage the whole time. The judge block was never affected, because <code>judge_usage</code> stayed at case level, and that asymmetry is what located the defect. The economics tables above are recomputed from the same committed receipts through the corrected <code>armEconomics</code>, with <strong>no re-run and no edit to any receipt</strong>. ${label(rows[2])}'s run-2 receipt was sealed after the fix, and its recorded block reproduces field for field under recomputation, which is the control on the other two.</p>
    <p><strong>The per-case table above is computed by a path with no command behind it.</strong> <code>driftproof diff</code> compares two receipts. There is no shipped command that renders within-report, per-case, skill-against-baseline verdicts: a receipt carries one aggregate <code>comparison.delta</code>, and <code>lib/verdict.js</code> reads that aggregate through the effect floor with no band test at all. This page therefore calls the shipped rule functions directly, <code>bandOf</code> from <code>lib/reuse.js</code> and the band-and-floor rule from <code>lib/diff.js</code>, over each receipt's own case rows. No number is re-derived by hand, but the headline per-case table has no command a reader can run to get it, and no assertion over that command. It is filed as a gap in the tool, disclosed here rather than after someone notices.</p>
    <p><strong>Surface.</strong> The surface is <code>claude-cli</code> with local machine context, one box, held constant across all cells and all reports.</p>
    <p><strong>Scope.</strong> The instrument measures skill text in context on the <code>append-system-prompt</code> surface. Out of scope: routing via <code>description:</code>, progressive disclosure, and tool execution.</p>
  </div>`;
}

// ── observations: variance asymmetry and time to settle ─────────────────────
//
// STATED AS OBSERVATIONS, NOT FINDINGS. Nothing below cleared a band-separation
// test, because none of it was put to one. The two papers cited are why we
// looked, not what we confirmed.
function observationSection(rows) {
  const wp = rows.find((r) => r.slug === 'writing-plans');
  const asym = (r) => r.cases.map((c) => {
    const b = r.sampling.arms.find((a) => a.id === c.id && a.mode === 'baseline');
    const w = r.sampling.arms.find((a) => a.id === c.id && a.mode === 'with_skill');
    return { id: c.id, b: b.sd, w: w.sd, ratio: w.sd === 0 ? null : b.sd / w.sd };
  });
  const wide = (r) => asym(r).filter((x) => x.ratio != null && x.ratio > 1).length;
  const maxRatio = (r) => Math.max(...asym(r).map((x) => x.ratio || 0));

  return `  <h2>Two observations, offered as observations</h2>
  <p>Neither of the two sections below is a finding. Nothing in them was put to a band-separation test, and this report claims no verdict from them. They are stated because they are the most legible things in the clean run, and because leaving them out would be a choice about what a reader gets to see.</p>

  <h3>Time to settle</h3>
  <p>Draws are adaptive: a minimum of three per arm, and more until the across-draw spread settles. <code>stopping_reason</code> reads <code>min_reached</code> when three sufficed and <code>stabilised</code> when the arm needed more.</p>
  <table class="summary">
    <thead><tr><th>cell</th><th>arms</th><th>settled at the 3-draw minimum</th><th>needed extra draws</th><th>total drawn</th><th>mean draws / arm</th></tr></thead>
    <tbody>
${rows.map((r) => `      <tr><td>${label(r)} <span class="muted">(run ${r.run})</span></td><td>${r.sampling.arms.length}</td><td>${r.sampling.atMinimum}</td><td>${r.sampling.needingExtra}</td><td>${r.sampling.drawn}</td><td>${num(r.sampling.drawn / r.sampling.arms.length, 2)}</td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="muted">The arms that needed extra draws are, with two exceptions, <strong>baseline</strong> arms. In ${label(wp)} five of the six unstable arms are baselines. The with-skill arm settles at the minimum almost everywhere; the baseline is what will not sit still.</p>

  <h3>Variance asymmetry</h3>
  <p>The ratio below is an arm's across-draw spread over its mean judge-sample spread, the <code>variance_ratio</code> the receipt records. Above 1&times; means generation-level noise exceeds judge-level noise: the axis this instrument sampled once, against the axis it sampled five times.</p>
  <table class="summary">
    <thead><tr><th>cell</th><th>arms with a ratio</th><th>min</th><th>median</th><th>max</th><th>arms above 1&times;</th></tr></thead>
    <tbody>
${rows.map((r) => `      <tr><td>${label(r)} <span class="muted">(run ${r.run})</span></td><td>${r.sampling.ratios.length}</td><td>${num(r.sampling.ratioMin, 2)}&times;</td><td>${num(r.sampling.ratioMedian, 2)}&times;</td><td><strong>${num(r.sampling.ratioMax, 2)}&times;</strong></td><td>${r.sampling.ratioAboveOne} of ${r.sampling.ratios.length}</td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="muted">The distribution is not symmetric and the median misleads on its own: most arms are quiet at generation level and a few are extremely loud. ${label(rows[1])}'s <code>semver-hidden-breaking-change</code> runs ${num(rows[1].sampling.arms.find((a) => a.id === 'semver-hidden-breaking-change' && a.mode === 'baseline').ratio, 2)}&times; on baseline and ${num(rows[1].sampling.arms.find((a) => a.id === 'semver-hidden-breaking-change' && a.mode === 'with_skill').ratio, 2)}&times; on with_skill, one case supplying most of that cell's dispersion. Medians here are <code>median()</code> from <code>lib/value.js</code>, which averages the two middle values on an even count.</p>

  <h4>Baseline spread against with-skill spread, ${label(wp)} run 2</h4>
  <table class="summary">
    <thead><tr><th>case</th><th>baseline sd</th><th>with_skill sd</th><th>ratio</th></tr></thead>
    <tbody>
${asym(wp).map((x) => `      <tr><td><code>${esc(x.id)}</code></td><td>${num(x.b, 4)}</td><td>${num(x.w, 4)}</td><td>${x.ratio == null ? 'n/a' : `${x.ratio > 1 ? '<strong>' : ''}${num(x.ratio, 2)}&times;${x.ratio > 1 ? '</strong>' : ''}`}</td></tr>`).join('\n')}
    </tbody>
  </table>
  <div class="card">
    <p><strong>${wide(wp)} of the seven cases have a baseline wider than the with-skill arm</strong>, three of them by more than nineteen times. ${label(rows[0])} shows the same shape more weakly (${wide(rows[0])} of seven wider, maximum ${num(maxRatio(rows[0]), 2)}&times;) and ${label(rows[1])} weakly again (${wide(rows[1])} of seven, maximum ${num(maxRatio(rows[1]), 2)}&times;).</p>
    <p>What the shape suggests, without this report having tested it, is that the skill's most visible effect on this corpus is on consistency rather than on the mean. That would also explain why so few cases separate: a wide baseline band is precisely what prevents a real mean difference from clearing an overlap test. <strong>This is a hypothesis the design of Report 007 cannot settle.</strong> A mean-difference test is not an instrument for a variance-reduction effect, and nothing here was pre-registered as a variance claim, so the shape is recorded and left open.</p>
    <p class="muted"><strong>Why we looked, not what we confirmed.</strong> Two lines of prior work motivated these two tables and neither is evidence for them. Prompt rankings are unstable under ordinary evaluation variability, and ranking by a lower confidence bound rather than by a point estimate is a documented response: <em>On the Stability of Prompt Ranking in Large Language Model Evaluation</em>, <a href="https://arxiv.org/abs/2606.24381">arXiv:2606.24381</a>. A wide baseline band is exactly the condition under which that selection rule matters, and Driftproof does not currently apply one. The variance-component framing above is <em>CyclicJudge</em>, <a href="https://arxiv.org/abs/2603.01865">arXiv:2603.01865</a>, cited again here for the same decomposition.</p>
  </div>`;
}

// ── related work ─────────────────────────────────────────────────────────────
//
// EVERY IDENTIFIER BELOW WAS RESOLVED AND ITS ABSTRACT READ BEFORE IT WAS
// WRITTEN HERE (Report #004's methodology precedent). A fourth work was carried
// through the authoring prep with no identifier on file: an intervention whose
// measurable effect is variance reduction rather than mean improvement. No
// resolvable arXiv identifier was found for it, so it is DROPPED rather than
// cited from memory, and the observation section above stands without it.
function relatedWork() {
  return `  <h2>Related work</h2>
  <table class="summary">
    <thead><tr><th>work</th><th>identifier</th><th>cited for</th></tr></thead>
    <tbody>
      <tr>
        <td><em>CyclicJudge: Mitigating Judge Bias Efficiently in LLM-based Evaluation</em><br><span class="muted">2026-03-02</span></td>
        <td><a href="https://arxiv.org/abs/2603.01865">arXiv:2603.01865</a></td>
        <td>The variance decomposition that partitions benchmark score variance into scenario, generation, judge and residual components. It is why a judge-sample band and an across-draw band are different statistics, and why an instrument that samples one of them is not measuring the other.</td>
      </tr>
      <tr>
        <td><em>Second-Order Response Laws for LLM Judges: Debiased Estimation of Prompt Instability</em><br><span class="muted">2026-08-17</span></td>
        <td><a href="https://arxiv.org/abs/2608.16253">arXiv:2608.16253</a></td>
        <td>The estimator, rather than the decomposition. It formalises the split between sampling noise within a prompt and systematic difference across prompts as a second-order response law, and shows that the usual plug-in measure of prompt instability is <strong>biased upward at finite repeat budgets</strong> because it confounds the two; unbiased estimators follow from the difference between within- and across-prompt agreement. It cites CyclicJudge for the variance decomposition. Cited here as the nearest published treatment of the small-repeat-budget estimator problem this report's three-to-six draws per arm sit inside, and as a bias pointing the <em>opposite</em> way from the truncation bias measured above. <strong>This report applies no such correction.</strong></td>
      </tr>
      <tr>
        <td><em>On the Stability of Prompt Ranking in Large Language Model Evaluation</em><br><span class="muted">2026-06-23</span></td>
        <td><a href="https://arxiv.org/abs/2606.24381">arXiv:2606.24381</a></td>
        <td>A stability-aware selection rule based on a lower confidence bound, which accounts for performance and variance together instead of ranking on a point estimate. The selection rule a wide baseline band should force, and one this instrument does not yet apply.</td>
      </tr>
      <tr>
        <td><em>WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution</em><br><span class="muted">2026-08-27</span></td>
        <td><a href="https://arxiv.org/abs/2608.27454">arXiv:2608.27454</a></td>
        <td>Prior art on skills as retrievable text carried in context, and on skills transferring across models and families. The boundary this report's scope sentence draws sits inside that picture: Driftproof measures the text in context and does not measure routing, progressive disclosure or tool execution.</td>
      </tr>
    </tbody>
  </table>
  <p class="muted">Each identifier above was resolved and its abstract read before publication, on the precedent Report 004's methodology section set. One further work carried through this report's authoring material had no identifier on file and none was found; it is dropped rather than cited, and no claim on this page rests on it.</p>`;
}

// ── limits ───────────────────────────────────────────────────────────────────
function limitsSection(rows) {
  return `  <h2>Limits</h2>
  <div class="card">
    <ul>
      <li><strong>This report has not corrected Report 005.</strong> Two of the three archive comparisons were refused on baseline non-reproduction, so for those two cells nothing here is comparable to what that page published.</li>
      <li><strong>The skill text changed between the two runs on all three cells.</strong> Every 005-to-007 pair differs in <code>skill.content_hash</code>, so even the one comparison that passed its control is a revision pair and not a straight re-measurement of the same text.</li>
      <li><strong>The across-draw bands are small-budget estimates, uncorrected.</strong> Three to six draws per arm is a finite repeat budget, and the literature cited below shows estimators in this regime carry bias whose direction depends on what is being estimated. No debiasing is applied on this page; the bands are the plain sample spreads the receipts record.</li>
      <li><strong>Cost means are over unequal n.</strong> Draw counts differ per arm, so a cell's two per-call means are averages over differently sized call sets.</li>
      <li><strong>One absorbed draw remains in the published set</strong>, in ${label(rows[0])}, disclosed above.</li>
      <li><strong>The judge remains single-model</strong> (<code>${esc(JUDGE_MODEL)}</code>, five samples), and judge affinity is not measured here.</li>
      <li><strong>Three cells is three cells.</strong> Twenty-one cases on two substrates is not a corpus, and nothing on this page generalises past the skills named on it.</li>
      <li><strong>Every verdict is verifiable from the receipts</strong>, which are linked below rather than described.</li>
    </ul>
  </div>`;
}

// ── Report 007 v1.1, filed onto this page ────────────────────────────────────
//
// Constitution invariant 4: a published report is amended visibly, never edited
// silently. The economics TABLES above are left exactly as they were, because
// every figure in them re-derives from the committed receipts through
// `computeEconomics` and none of them is withdrawn. What is qualified is the
// two PROSE sentences that read a mechanism out of those tables.
//
// The block renders inside a `<h2>Amendments</h2>` card with the same markup
// Reports 005 and 006 carry, so a later amendment prepends into it the way
// `amend005` and `amend006` prepend into theirs.
function amendment007(rows) {
  const f = rows.map((r) => ({ r, f: freshBasis(r.receipt) }));
  const cr = f[0]; const gw = f[1]; const wp = f[2];
  const cheaperFresh = f.filter((x) => x.f.freshIncremental < 0);
  const dearerFresh = f.filter((x) => x.f.freshIncremental > 0);
  const flipped = f.filter((x) => x.f.listedIncremental * x.f.freshIncremental < 0);
  const pct = (x) => `${(100 * x).toFixed(1)}%`;
  const drawMix = (x) => {
    const ids = [...new Set(x.r.receipt.results.cases.map((c) => c.id))];
    const counts = (mode) => ids.map((id) => {
      const c = x.r.receipt.results.cases.find((y) => y.id === id && y.mode === mode);
      const g = (c && c.generation) || {};
      return Array.isArray(g.draws) ? g.draws.filter((d) => d.status === 'measured').length : (c ? 1 : 0);
    }).join(',');
    return `${x.f.with_skill.calls} draws with the skill against ${x.f.baseline.calls} without, allocated ${counts('with_skill')} against ${counts('baseline')}`;
  };
  const line = (x) => `      <tr><td>${label(x.r)}</td><td>${usdSigned(x.f.listedIncremental)}</td><td><strong>${usdSigned(x.f.freshIncremental)}</strong></td><td>${x.f.listedIncremental * x.f.freshIncremental < 0 ? '<strong>sign does not survive</strong>' : 'sign survives'}</td><td>${usdSigned(x.f.balancedFreshIncremental)}</td></tr>`;

  return `  <h2>Amendments</h2>
  <div class="card">
    <p><strong>v1.1 &middot; ${AMEND_V11_DATE}</strong>. <strong>Two sentences in this page's economics section read a mechanism out of a basis this page did not control for, and are qualified here.</strong> They are quoted rather than paraphrased. The first: <em>&ldquo;2 of 3 cells are cheaper with the skill than without it.&rdquo;</em> The second: <em>&ldquo;The mechanism is visible in the tokens rather than asserted: mean input falls by ${int(Math.abs(Math.round(cr.f.inputDelta)))} and ${int(Math.abs(Math.round(wp.f.inputDelta)))} tokens per call, which is the baseline's sprawl becoming unnecessary.&rdquo;</em> Both figures are correct as arithmetic over the receipts. Neither sentence is a safe reading of them.</p>

    <p><strong>What the basis actually was.</strong> The incremental column is one per-call mean minus another, and the two means are taken over call sets that differ in size and in composition: ${drawMix(cr)} on ${label(cr.r)}; ${drawMix(gw)} on ${label(gw.r)}; ${drawMix(wp)} on ${label(wp.r)}. Adaptive stopping chose those allocations per arm, so the two arms of a cell are averages over different case mixes. On top of that, every input token in both means is priced at the list input rate, cached tokens included, which is what the tables' own caption says and what <code>computeEconomics</code> does. On this surface cached context runs ${pct(Math.min(...f.map((x) => Math.min(x.f.with_skill.cachedShare, x.f.baseline.cachedShare))))} to ${pct(Math.max(...f.map((x) => Math.max(x.f.with_skill.cachedShare, x.f.baseline.cachedShare))))} of each call's input. The largest term in each mean is therefore harness context that neither arm chose and that the skill cannot move, priced at full rate, and the difference of two such means over unequal call sets is what the headline sentence read a mechanism out of. This page's Limits already stated the first half of that, <em>&ldquo;Cost means are over unequal n&rdquo;</em>; what it did not state is that the headline sentence rested on it.</p>

    <p><strong>The same draws, re-priced with cached input excluded.</strong> Nothing is re-run and no receipt is touched: <code>cached_tokens</code> is recorded per draw so that a reader can do exactly this, and the receipts say so in <code>economics.notes.cache_pricing</code>. Fresh input means input minus cached, at the same frozen rates, over the same measured draws.</p>
    <table class="summary">
      <caption class="muted">Per-call incremental, with skill minus without, on two bases over one set of recorded draws. The last column weights every case equally in both arms instead of weighting it by how many draws adaptive stopping gave it, and is the control on whether a sign belongs to the draw allocation.</caption>
      <thead><tr><th>cell</th><th>as published (cached at list rate)</th><th>fresh input only</th><th>on the fresh basis</th><th>fresh, case-balanced</th></tr></thead>
      <tbody>
${f.map(line).join('\n')}
      </tbody>
    </table>

    <p><strong>${flipped.length} of the ${f.length} cells change sign</strong>, and they are not the ones the sentence would lead a reader to expect. On the fresh basis the cheaper cells are ${cheaperFresh.map((x) => label(x.r)).join(' and ')}, and the dearer one is ${dearerFresh.map((x) => label(x.r)).join(' and ')}. The count of two survives; the identities do not. ${label(wp.r)}, named in the sentence as one of the two cheaper cells at ${usdSigned(wp.f.listedIncremental)} per call, is ${usdSigned(wp.f.freshIncremental)} on fresh input, the dearest of the three. ${label(gw.r)}, named as the one cell that costs more, is ${usdSigned(gw.f.freshIncremental)}, cheaper. Only ${label(cr.r)} keeps its sign, and its magnitude falls to ${pct(Math.abs(cr.f.freshIncremental / cr.f.listedIncremental))} of the published figure.</p>

    <p><strong>The mechanism claim is retracted as written.</strong> &ldquo;The baseline's sprawl becoming unnecessary&rdquo; was offered as the explanation of an input-token fall, and the fall is not in the tokens the model generated. Of the ${int(Math.abs(Math.round(cr.f.inputDelta)))}-token fall on ${label(cr.r)}, ${int(Math.abs(Math.round(cr.f.cachedDelta)))} tokens, ${pct(Math.abs(cr.f.cachedDelta / cr.f.inputDelta))}, are cached; of the ${int(Math.abs(Math.round(wp.f.inputDelta)))}-token fall on ${label(wp.r)}, ${int(Math.abs(Math.round(wp.f.cachedDelta)))} tokens, ${pct(Math.abs(wp.f.cachedDelta / wp.f.inputDelta))}, are cached. On fresh input the two falls are ${int(Math.abs(Math.round(cr.f.freshDelta)))} and ${int(Math.abs(Math.round(wp.f.freshDelta)))} tokens per call. A skill's text cannot make a harness preamble shorter, and an arm without the skill prepended consuming more input than the arm with it is a fact about cache warmth and call ordering, not about sprawl.</p>

    <p><strong>What survives, restated to its actual axis.</strong> On the fresh basis every cell's incremental is carried by <strong>output</strong> length, not input. ${label(cr.r)} is cheaper because the skilled arm emits ${int(Math.abs(Math.round(cr.f.outputDelta)))} fewer output tokens per call, worth ${usdSigned(cr.f.outputDelta * cr.f.rates.output_per_mtok / 1e6)} against ${usdSigned(cr.f.freshDelta * cr.f.rates.input_per_mtok / 1e6)} from fresh input. ${label(gw.r)} is cheaper on the same axis, ${usdSigned(gw.f.outputDelta * gw.f.rates.output_per_mtok / 1e6)} from ${int(Math.abs(Math.round(gw.f.outputDelta)))} fewer output tokens. ${label(wp.r)} is dearer on that axis for the same reason in reverse: ${intSigned(wp.f.outputDelta, 0)} output tokens per call, worth ${usdSigned(wp.f.outputDelta * wp.f.rates.output_per_mtok / 1e6)}, which more than repays its fresh-input fall. So the defensible sentence is narrower than the published one and points somewhere else: <strong>where this skill changes cost at all, it changes it by changing how much the model writes, and the direction is not the same in every cell.</strong> Two cells shorter, one cell longer, on differences that are small in absolute terms and were never metered.</p>

    <p><strong>Neither basis is the true one, and that is the point.</strong> Cached input is billed below list rate on metered surfaces and at nothing at all here, where the metered spend is <strong>$0.00</strong>; pricing it at list is an over-estimate the receipts declare, and excluding it entirely is an under-estimate. The published tables use the first, this amendment adds the second, and the honest statement is that the sign of this metric on this surface is a property of which one a reader picks. That is a fact about the measurement and not about the skill, and it should have been on the page before a mechanism was asserted from either.</p>

    <p><strong>No figure above has been edited and no table is withdrawn.</strong> Every number in the economics tables re-derives from the committed receipts through <code>computeEconomics</code> at each receipt's own frozen snapshot, and the receipts are byte-unchanged. The two bases are computed from the same recorded fields, so this amendment adds a column beside the published one rather than replacing it. Filed by Report 008, which found the same two sentences waiting to be written about a second model pair and did not write them.</p>
  </div>`;
}

function receiptsBlock(rows) {
  const ev = rows.find((r) => r.evidence);
  return `  <h2>Receipts</h2>
  <details class="card" open><summary><strong>All four receipts for this report, each one resolvable.</strong> Every number on this page re-derives from these files. They are the evidence, not a description of it: open any one and check it against a table above.</summary>
    <ul>
${rows.map((r) => `      <li>${label(r)} <span class="muted">(run ${r.run}, published)</span>: <a href="${BLOB}/${esc(r.receipt_rel)}"><code>${esc(r.receipt_rel)}</code></a></li>`).join('\n')}
      <li>${label(ev)} <span class="muted">(run 1, defect evidence, NOT published)</span>: <a href="${BLOB}/${esc(ev.evidence)}"><code>${esc(ev.evidence)}</code></a></li>
    </ul>
    <p class="muted">Directories: <a href="https://github.com/driftproofhq/driftproof/tree/main/receipts/report-007"><code>receipts/report-007/</code></a> and <a href="https://github.com/driftproofhq/driftproof/tree/main/receipts/report-007-rerun"><code>receipts/report-007-rerun/</code></a>. Validate any of them with <code>npx driftproof validate &lt;file&gt;</code>. Run 1 landed at <code>${RUN1_COMMIT}</code> and run 2 at <code>${RUN2_COMMIT}</code>; no receipt has been modified since it was sealed.</p>
  </details>`;
}

function buildPage(rows, { nowIso }) {
  // The card tags and the analytics beacon come from the ONE generator that
  // writes them everywhere else (spec 019a). Emitted by the switch that renders
  // the page, not patched into the file afterwards, so this page stays a pure
  // function of its receipts and the gate's byte-identity assertion holds.
  return applyHeadTags(renderReportPage(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof: Report 007, the baseline is the noisy arm</title>

<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report">
  <h1>Report 007: the baseline is the noisy arm</h1>
  <p class="report-type">Instrument re-measurement report<span class="muted">. Three cells Report 005 already published, re-run on the same suites and the same substrates with the generation sampled n times per arm instead of once. Nothing under the skill moves. The instrument does.</span></p>
  <div class="headline">
${headlineBlock(rows)}
  </div>

${methodAndResult(rows)}

${instrumentSection(rows)}

${archiveSection(rows)}

${economicsSection(rows)}

${disclosureSection(rows)}

${observationSection(rows)}

${relatedWork()}

${limitsSection(rows)}

${amendment007(rows)}

  <h2>Amendments filed by this report</h2>
  <div class="card">
    <p><strong><a href="../005/index.html">Report 005</a> to v1.2.</strong> The three cells' published lifts are named as single-draw, judge-spread figures, re-measured here with no cell-level separation. No figure on that page is edited.</p>
    <p><strong><a href="../006/index.html">Report 006</a> to v1.1.</strong> That page's <code>writing-plans</code> cell is corrected under pairwise exclusion, from ${fmt(amend006Figures().before.delta)} to ${fmt(amend006Figures().after.delta)}, and its ${amend006Figures().beforeCounts} aggregate is restated as the ${amend006Figures().afterCounts} it should have been. The cell's verdict does not change and its baseline-reproduction control does not move.</p>
    <p class="muted">Both amendments are versioned records appended to the pages they concern. Constitution invariant 4: a published report is amended visibly, never edited silently.</p>
  </div>

  <h2>Run record</h2>
  <div class="card"><p>Run 1: ${rows.filter((r) => r.run === 1).length} published cells plus one evidence cell, ${esc(String(rows[0].receipt.run.date_utc).replace('T', ' ').slice(0, 16))} UTC, committed at <code>${RUN1_COMMIT}</code>. Run 2: ${label(rows[2])} re-run under the corrected timeout, ${esc(String(rows[2].receipt.run.date_utc).replace('T', ' ').slice(0, 16))} UTC, committed at <code>${RUN2_COMMIT}</code>. Published set: ${rows.reduce((a, r) => a + r.sampling.drawn, 0)} draws, ${rows.reduce((a, r) => a + r.sampling.measured, 0)} measured, ${rows.reduce((a, r) => a + r.sampling.unmeasured, 0)} absorbed. Judge <code>${esc(JUDGE_MODEL)}</code> at five samples per draw. Surfaces: ${esc([...new Set(rows.map((r) => `${r.model} to ${r.receipt.run.surface}`))].join(', '))}. Metered spend <strong>$0.00</strong> on vendor subscription CLIs; every dollar on this page is the if-it-had-been-metered equivalent at each receipt's own frozen snapshot. Verification level <strong>TESTED</strong> on all four receipts.</p></div>

${receiptsBlock(rows)}

  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report 007 · Instrument re-measurement report</span></footer>
</main>
</body>
</html>
`, 'reports/007/index.html'), 'reports/007/index.html');
}

// ── amendments ───────────────────────────────────────────────────────────────
//
// Constitution invariant 4: a published report is amended with a versioned
// record, never silently edited. All three writers below are IDEMPOTENT: this
// script re-renders the page on every run, and a re-render must not stack a
// second amendment block on a page that already carries one.

// The Report 006 correction, computed once and read by two callers: the page's
// amendment summary and the amendment block written onto Report 006 itself. Two
// computations of the same correction would be two definitions of it.
let _a6cache = null;
function amend006Figures() {
  if (_a6cache) return _a6cache;
  const { buildReceipt } = require('../lib/receipt');
  const archived = R('receipts/report-006/writing-plans-claude-fable-5-2026-08-28.json');
  const rebuilt = buildReceipt({
    skill: { name: archived.skill.name, version: archived.skill.version, contentHash: archived.skill.content_hash, tokens: archived.skill.tokens },
    suite: { format: archived.suite.format, suiteHash: archived.suite.suite_hash, caseCount: archived.suite.case_count, canary: archived.suite.canary },
    run: archived.run,
    cases: archived.results.cases,
    economics: archived.economics || null,
    verificationLevel: archived.verification_level,
  });
  const a = archived.results.aggregates;
  const b = rebuilt.results.aggregates;
  _a6cache = {
    archived,
    rebuilt,
    a,
    b,
    before: archived.comparison,
    after: rebuilt.comparison,
    beforeCounts: `${a.with_skill.case_count} against ${a.baseline.case_count}`,
    afterCounts: `${b.with_skill.case_count} against ${b.baseline.case_count}`,
  };
  return _a6cache;
}

// Report 006 v1.1. The correction, with its figures rebuilt through the CURRENT
// buildReceipt over the archived receipt's own case rows. The receipt on disk is
// never touched: it is read, its cases are passed through the fixed aggregate
// path, and the two results are printed side by side.
function amend006({ nowIso, write = true } = {}) {
  let html = fs.readFileSync(P006, 'utf8');
  const NEEDLE006 = "cell's aggregate was computed over two different case sets";
  if (html.includes(NEEDLE006) || /<strong>v1\.1\s*(?:&middot;|\u00b7)/.test(html)) {
    return { applied: false, already: true, reason: 'already amended' };
  }

  const { archived, rebuilt, a, b } = amend006Figures();
  const control = R('receipts/report-006/writing-plans-claude-fable-5-2026-08-28.control.json');
  const base005 = R('receipts/report-005/writing-plans__claude-fable-5.json').results.aggregates.baseline.mean_score;
  const abdBefore = control.control.aggregate_baseline_delta;
  const abdAfter = Number((b.baseline.mean_score - base005).toFixed(6));
  const excluded = b.excluded_cases.map((x) => `<code>${esc(x.id)}</code> (${esc(x.modes.join(', '))})`).join(' and ');

  const note = `    <p><strong>v1.1 &middot; ${nowIso.slice(0, 10)}</strong>. <strong>The <code>writing-plans</code> cell's aggregate was computed over two different case sets, and is corrected here.</strong> This page publishes that cell at <strong>${fmt(archived.comparison.delta)}</strong>. Under correct pairing it is <strong>${fmt(rebuilt.comparison.delta)}</strong>, and its band moves from ± ${num(archived.comparison.delta_uncertainty)} to ± ${num(rebuilt.comparison.delta_uncertainty)}.</p>
    <p><strong>The mechanism, because the counts hid it.</strong> The two arms were reported as ${a.with_skill.case_count} against ${a.baseline.case_count}, which looks paired and is not: <strong>two different cases each lost one arm</strong> to the same 120 s call timeout, ${excluded}. Filtering each arm's failures independently left six rows on each side over <em>different</em> case sets, so the aggregate subtracted a mean of one set of cases from a mean of another. Excluding a case from <em>both</em> arms when either arm is unmeasured gives ${b.with_skill.case_count} against ${b.baseline.case_count}, genuinely paired. The counts matching at ${a.with_skill.case_count} against ${a.baseline.case_count} was a coincidence, which is why nothing on this page or in the receipt suggested anything was wrong. <code>run.failed_case_count</code> reads ${archived.run.failed_case_count} before and after; what the receipt did not carry was the list, and <code>excluded_cases</code> now names it.</p>
    <p><strong>The band moves further than the lift does:</strong> ± ${num(archived.comparison.delta_uncertainty)} to ± ${num(rebuilt.comparison.delta_uncertainty)}, a fivefold narrowing, because the two cases that dropped out were the two widest. The corrected lift of ${fmt(rebuilt.comparison.delta)} against ± ${num(rebuilt.comparison.delta_uncertainty)} is still inside its own band, narrowly, as ${fmt(archived.comparison.delta)} against ± ${num(archived.comparison.delta_uncertainty)} was comfortably.</p>
    <p><strong>The verdict does not change, and neither does the control.</strong> This cell's classification stays <strong>NOT MEASURED</strong>. The baseline-reproduction control that produced it is driven by <em>per-case</em> movement, and it is recorded in a separate control record whose per-case table pairwise exclusion does not touch: <code>moved_cases</code> is still <code>${control.control.moved_cases.map(esc).join('</code>, <code>')}</code>, two cases past the band and the ${control.control.floor} floor, and the reason string is unchanged. Exclusion changes aggregates only, and <code>results.cases</code> is left intact, so no per-case comparison moves.</p>
    <p><strong>One disclosed diagnostic inside the control block does move, and is stated rather than left to be found.</strong> <code>aggregate_baseline_delta</code> is computed over the baseline arm's aggregate, and that aggregate goes from ${num(a.baseline.mean_score)} over ${a.baseline.case_count} cases to ${num(b.baseline.mean_score)} over ${b.baseline.case_count}. The figure therefore moves from <strong>${fmt(abdBefore)}</strong> to <strong>${fmt(abdAfter)}</strong>. It is a diagnostic and not the verdict basis, since the reason string counts cases rather than reading the aggregate, but it is a published-adjacent number that this correction touches, and leaving it unmentioned would be the same omission in miniature.</p>
    <p><strong>No figure on this page has been edited</strong>, and the archived receipt is byte-unchanged. The corrected figures above are rebuilt from that receipt's own case rows through the current aggregate path. Filed by Report 007, which measured the timeout that caused both losses.</p>\n`;

  html = html.replace('  <h2>Amendments</h2>\n  <div class="card">\n', `  <h2>Amendments</h2>\n  <div class="card">\n${note}`);
  if (write) fs.writeFileSync(P006, html);
  return { applied: true, before: archived.comparison.delta, after: rebuilt.comparison.delta };
}

// Report 005 v1.2. EXTENDS v1.1, does not replace it: v1.1 said these three
// baselines were single draws from wide distributions and asserted no cause.
// v1.2 reports what a multi-draw re-measurement found and holds the same line
// on cause, now with a second instrument change in the way.
function amend005(rows, { nowIso, write = true } = {}) {
  let html = fs.readFileSync(P005, 'utf8');
  const NEEDLE005 = 'The three cells v1.1 flagged have been re-measured';
  if (html.includes(NEEDLE005) || /<strong>v1\.2\s*(?:&middot;|\u00b7)/.test(html)) {
    return { applied: false, already: true, reason: 'already amended' };
  }
  if (!/<strong>v1\.1\s*(?:&middot;|\u00b7)/.test(html)) throw new Error('Report 005 does not carry v1.1 — refusing to file v1.2 out of order');

  const mapping = rows.map((r) => {
    const older = R(r.archive005);
    return `<code>${esc(r.slug)}</code> on <code>${esc(r.model)}</code> ${fmt(older.comparison.delta)} to ${fmt(r.comparison.delta)}`;
  }).join('; ');

  const note = `    <p><strong>v1.2 &middot; ${nowIso.slice(0, 10)}</strong>. <strong>The three cells v1.1 flagged have been re-measured, and their published lifts are named here as what they are: single-draw, judge-spread figures.</strong> Each of the three lifts on this page rests on one generation per arm, and its band is the spread of the judge re-scoring that single response. <a href="../007/index.html">Report 007</a> re-ran all three cells with the generation sampled adaptively, three draws per arm minimum and more until the across-draw spread settled, and found lower lifts in every one: ${mapping}. <strong>At the cell level none of the three separates from its own band.</strong></p>
    <p><strong>These are not corrections, and Report 007 does not present them as such.</strong> Two of the three comparisons were <strong>refused</strong> before any verdict was formed, by the same baseline-reproduction control that refused every cell of Report 006: the no-skill arm did not reproduce the arm this page measured. On the third, <code>writing-plans</code> on <code>claude-fable-5</code>, the control passed and the comparison rendered <strong>WITHIN NOISE</strong>, which says the two measurements are the same as far as the instrument can tell. All three cells also changed <code>skill.content_hash</code> upstream between the two runs, so none of the pairs is a straight re-measurement of the same text.</p>
    <p><strong>v1.1's "no cause is asserted" holds, for the same reason and one more.</strong> Sampling noise accounts for the observations without needing a cause; whether anything else also changed is not established either way. Report 007 adds a second, independent instrument change to the same gap: a declared 300 s call timeout on this surface had never executed, because a numeric literal at the call site shadowed it from 2026-07-27 onward. Every run behind this page used 120 s. The question stays open.</p>
    <p><strong>What this qualifies on the page above, in that page's own words.</strong> Two sentences already published here are the ones this amendment bears on, and they are quoted rather than paraphrased. The first is the cost-per-benefit rule: <em>&ldquo;The denominator is the cell&rsquo;s aggregate lift, not the lift of the single case that drove it. The cost is paid on every case in the suite, so the benefit it buys must be averaged over those same cases; pricing a whole-suite cost against one case&rsquo;s lift would mix populations and read 2.5&ndash;6&times; cheaper than the measurement supports.&rdquo;</em> Every <code>$ per 0.01 lift</code> figure on this page divides by a cell's aggregate lift, and two of those denominators are the lifts under revision here. The band this page prints beside each cell is the <strong>with_skill</strong> band, not the lift band, and the two are different quantities: where this page reads <code>0.889 ± 0.023</code> the receipt's <code>delta_uncertainty</code> is 0.216857. Nothing above has been swapped for anything else.</p>
    <p>The second is this page's own fairness disclosure: <em>&ldquo;Checked against upstream on 2026-08-19: 8 of 10 are still byte-identical; <code>code-review-and-quality</code> and <code>writing-plans</code> have been revised upstream.&rdquo;</em> That sentence is why the 005 to 007 comparison is a <strong>revision</strong> pair on all three cells rather than a re-measurement of the same text, and why v1.2 cannot present Report 007's lower lifts as this page's figures measured again.</p>
    <p><strong>Unaffected, and unchanged from v1.1.</strong> The cost-driver correlation, the substrate-disagreement result and the three-axis presentation do not rest on single-cell baselines and are not qualified here. <strong>No figure on this page has been edited</strong>; every number, count and verdict above is as published and re-derives from the same 30 receipts.</p>\n`;

  html = html.replace('  <h2>Amendments</h2>\n  <div class="card">\n', `  <h2>Amendments</h2>\n  <div class="card">\n${note}`);
  if (write) fs.writeFileSync(P005, html);
  return { applied: true };
}

// The homepage figure. The site's front page told a reader that draw-to-draw
// spread reaches sd 0.186, which was Report 006's probe measured over two cases.
// The published Report 007 receipts measure it across 42 arms, and the largest
// is larger. The band definition goes beside the figure, because the whole point
// of the sentence is that two different bands are being compared.
function homepageFigure(rows) {
  let best = null;
  for (const r of rows) {
    for (const a of r.sampling.arms) {
      if (a.sd != null && (!best || a.sd > best.sd)) best = { ...a, slug: r.slug, model: r.model };
    }
  }
  return best;
}

function amendHomepage(rows, { write = true } = {}) {
  const best = homepageFigure(rows);
  let html = fs.readFileSync(HOME, 'utf8');
  const NEEDLE = '<p><strong>What the band does not cover.</strong>';
  if (!html.includes(NEEDLE)) {
    return { applied: false, already: html.includes('across-draw spread'), reason: 'the homepage paragraph this replaces is not present' };
  }
  const start = html.indexOf(NEEDLE);
  const end = html.indexOf('</p>', start) + 4;
  const replacement = `<p><strong>What the band covers, and which band it is.</strong> A legacy verdict rests on <strong>one generation draw per arm</strong>, so its band is the spread of the <em>judge</em> re-scoring that single response, not the spread of the model writing a different one. <a href="reports/006/index.html">Report #006</a> measured the second directly and found it larger. Receipt spec v0.5 samples the generation too, and a v0.5 per-case band is the <strong>across-draw spread</strong>: the sample standard deviation of the per-draw means, over n draws of that arm. Measured that way, draw-to-draw spread reaches <strong>sd ${best.sd.toFixed(3)}</strong> on the 0&#8211;1 scale, on the <code>${esc(best.id)}</code> ${esc(best.mode)} arm of <code>${esc(best.slug)}</code> at <code>${esc(best.model)}</code>. The two are different statistics, a band now carries which one it is, and a surprising single-draw verdict is <strong>provisional and worth re-running</strong>.</p>`;
  html = html.slice(0, start) + replacement + html.slice(end);
  if (write) fs.writeFileSync(HOME, html);
  return { applied: true, sd: best.sd, arm: `${best.slug}@${best.model} ${best.id}/${best.mode}` };
}

// ── main ─────────────────────────────────────────────────────────────────────

function main(argv = process.argv.slice(2)) {
  const rows = readCells();
  const nowIso = new Date().toISOString();
  const html = buildPage(rows, { nowIso });

  if (argv.includes('--page')) { process.stdout.write(html); return 0; }

  if (argv.includes('--check')) {
    const at = path.join(OUT_DIR, 'index.html');
    const existing = fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : null;
    const same = existing === html;
    console.log(same ? '  page matches the receipts' : '  ✗ page has drifted from the receipts');
    if (!same) process.exitCode = 1;
    return same ? 0 : 1;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
  console.log(`  wrote ${path.relative(ROOT, path.join(OUT_DIR, 'index.html'))}`);
  for (const r of rows) {
    console.log(`    ${r.slug}@${r.model}: ${fmt(r.comparison.delta)} ± ${num(r.comparison.delta_uncertainty)}  `
      + `(${r.cases.filter((c) => c.verdict === 'improved').length} improved, ${r.cases.filter((c) => c.verdict === 'regressed').length} regressed, ${r.cases.filter((c) => c.verdict === 'no effect').length} no effect)`);
  }
  const a6 = amend006({ nowIso });
  console.log(a6.applied ? `  amended docs/reports/006/index.html (v1.1): ${fmt(a6.before)} to ${fmt(a6.after)}` : `  #006 not amended: ${a6.reason}`);
  const a5 = amend005(rows, { nowIso });
  console.log(a5.applied ? '  amended docs/reports/005/index.html (v1.2)' : `  #005 not amended: ${a5.reason}`);
  const ah = amendHomepage(rows);
  console.log(ah.applied ? `  amended docs/index.html: draw-to-draw spread now sd ${ah.sd.toFixed(3)} (${ah.arm})` : `  homepage not amended: ${ah.reason}`);
  return 0;
}

if (require.main === module) main();

module.exports = {
  CELLS, readCells, archiveRows, archive006Release, sampling, economicsFor, caseVerdict,
  buildPage, perCaseTable, freshBasis, amendment007, amend005, amend006, amend006Figures, amendHomepage, homepageFigure, main,
  OUT_DIR, P005, P006, HOME, W1, RUN1_COMMIT, RUN2_COMMIT, JUDGE_MODEL, AMEND_V11_DATE,
};
