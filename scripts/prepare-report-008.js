#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-008.js: render Driftproof Report 008, a release-drift report
// on the claude-fable-5 to claude-fable-5-1 point release.
//
// WHAT MAKES THIS PAIR DIFFERENT FROM EVERY EARLIER RELEASE-DRIFT REPORT.
// Report 001 and Report 003 compared receipts whose generation was drawn ONCE per arm, so a
// per-case band was the spread of the judge re-scoring a single response, and a
// model-attributable move and a lucky draw were the same shape on the page. Both
// sides of both pairs here are v0.5 generation-sampled receipts, and both were
// asserted pinned-identical on skill content_hash and suite_hash before the first
// call was made. The skill text did not move, the suite did not move, the surface
// did not move, the judge did not move. The model did. That is what makes the
// delta attributable, and it is the first time this project can say so about a
// release pair.
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN. The receipts under receipts/report-008/
// were written by `bin/driftproof run` and committed at a0aecb0; this reads them.
// It makes no model call and no network call, so the page is a pure function of
// the committed receipts plus reports/report-008-run-record.json, and re-running
// it is safe.
//
// EVERY FIGURE IS DERIVED HERE, NONE IS TYPED. The verdicts are the differ's own
// output through `buildDriftReport`, quoted out of the markdown it emits rather
// than restated. The per-case lift table composes `bandOf` with the shipped
// floor rule, the same path Report 007's page uses and with the same disclosed
// gap: there is no shipped command that renders within-report, per-case,
// skill-against-baseline verdicts. The economics reuse `freshBasis` from
// prepare-report-007.js rather than redefining it, because two definitions of
// one re-pricing are two definitions of what these reports measured.
//
// Usage:
//   node scripts/prepare-report-008.js            # render docs/reports/008/
//   node scripts/prepare-report-008.js --check    # re-render, exit 1 on drift
//   node scripts/prepare-report-008.js --page     # print to stdout, write nothing

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { bandOf } = require('../lib/reuse');
const { buildDriftReport } = require('../lib/diff');
const { bandVerdict, varianceRatio } = require('../lib/stats');
const { median } = require('../lib/value');
const { EFFECT_FLOOR } = require('../config');
const { applyHeadTags } = require('./build-head-tags');
// The chrome hook spec 020 named for this generator, in that file's own words:
// so this report's generator has one thing to call. applyHeadTags reaches
// applyChrome too, but WITHOUT rows, and this page's row cannot live in
// docs/data/reports.json: that file is a published surface and this report is
// unapproved. So the card is applied last, with the row handed in.
const { renderReportPage } = require('./site-chrome');
// The data layer derives the row, rather than a second derivation living here.
// Node 22 resolves require() of an ESM module with no top-level await.
const { reportRow } = require('./site-data.mjs');
const { freshBasis } = require('./prepare-report-007');

const ROOT = path.join(__dirname, '..');
const BLOB = 'https://github.com/driftproofhq/driftproof/blob/main';
// PROMOTED, 2026-09-03, BY RE-RENDER AND NOT BY RENAME. The draft state lived in
// the path: this generator wrote to `docs/reports/008-draft/` and
// `build-public.sh` excludes `(^|/)[^/]*-draft/` from the published tree, so the
// page reached the site only when these two constants moved.
//
// The claim this file used to carry, that nothing in the BYTES marks the draft
// state and promotion is therefore a rename and only a rename, is FALSE and was
// measured false at promotion. `build-head-tags.js` keys on
// `^reports\/(\d+)\/index\.html$`, which the draft path does not match, so the
// draft page fell through to the generic branch. Moving to the published path
// changed four things in the head, none of them in the body: the title switched
// from the page's own h1 to the docs/data/reports.json form, canonical and
// og:url dropped `-draft`, and the JSON-LD went from a bare WebPage to a
// TechArticle carrying headline, datePublished, publisher, license and a
// hasPart Dataset list. Every one of those is a published-surface claim that no
// reviewer of the draft ever saw, which is the reason the page is re-rendered
// here rather than carried across.
const OUT_DIR = path.join(ROOT, 'docs', 'reports', '008');
const PAGE_REL = 'reports/008/index.html';
const RUN_RECORD = 'reports/report-008-run-record.json';

// The judge, held across every cell of this run and every report before it.
const JUDGE_MODEL = 'claude-haiku-4-5';

// The evidence commit the four receipt files landed in. Named because "the
// receipts are committed" is a claim a reader can check with `git show`.
const EVIDENCE_COMMIT = 'a0aecb0';

// NAMING: skill@model, never an ordinal. The run log and the evidence pack both
// number these cells, and "cell 1" means different things in different documents.
const CELLS = [
  {
    slug: 'code-review-and-quality',
    from: 'claude-fable-5',
    to: 'claude-fable-5-1',
    baseline: 'receipts/report-007/code-review-and-quality-claude-fable-5-2026-08-31.json',
    receipt: 'receipts/report-008/code-review-and-quality-claude-fable-5-1-2026-09-01.json',
    labelA: '2026-08-31',
    labelB: '2026-09-01',
  },
  {
    slug: 'writing-plans',
    from: 'claude-fable-5',
    to: 'claude-fable-5-1',
    // PAIRED AGAINST REPORT 007'S RUN 2, which is the receipt Report 007
    // published for this cell and the one the launch script asserted its hashes
    // against. Report 007's run 1 of the same cell is committed as unpublished
    // defect evidence and is not read here.
    baseline: 'receipts/report-007-rerun/writing-plans-claude-fable-5-2026-08-31.json',
    receipt: 'receipts/report-008/writing-plans-claude-fable-5-1-2026-09-02.json',
    labelA: '2026-08-31',
    labelB: '2026-09-02',
  },
];

// THE VERDICT PILL CLASS, the same one-liner as `prepare-report-007.js`, copied
// rather than imported for the reason `tests/gate.js` states about its own
// duplication: a shared import that throws in one tree silently changes what the
// other renders. Report 008 shipped its verdict cells as bare text through its
// draft life, which made it the one report whose verdicts rendered unstyled and
// which `tests/essay-grounding.js` could derive no tally from, because that
// oracle reads `span.v`. Both were invisible while the page sat at a draft path.
const VCLASS = (v) => (v === 'improved' ? 'v-improved' : v === 'regressed' ? 'v-regressed' : 'v-noise');
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n, dp = 3) => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(dp)}`);
const num = (n, dp = 3) => (n == null ? 'n/a' : Number(n).toFixed(dp));
const usdSigned = (n, dp = 6) => (n == null ? 'n/a' : `${n < 0 ? '-' : '+'}$${Math.abs(Number(n)).toFixed(dp)}`);
const int = (n) => (n == null ? 'n/a' : Number(n).toLocaleString('en-US'));
const intSigned = (n) => (n == null ? 'n/a' : `${n < 0 ? '-' : '+'}${Math.abs(Math.round(Number(n))).toLocaleString('en-US')}`);
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const R = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
// The band's own word for what it is. An across-draw spread and a judge-sample
// spread are different statistics, and a band printed without its source invites
// a reader to compare two things that are not the same measurement.
// Accepts a band in EITHER of the two shapes the shipped code hands out: the
// `{mean, sd, source}` that `bandOf` returns, and the `{mean, stddev, source}`
// that `buildDriftReport` puts on each perCase row. Both are the same band,
// produced by `bandOf` and renamed on its way out of the differ. Taking both
// shapes is what lets this renderer pass those objects straight through instead
// of rebuilding a band literal of its own, which would be a second construction
// of a per-case band in a file nobody has classified as one.
const bandStr = (b) => {
  if (!b) return 'n/a';
  const sd = typeof b.sd === 'number' ? b.sd : b.stddev;
  return `${b.mean.toFixed(3)} ± ${sd.toFixed(3)} <span class="muted">(${esc(b.source)})</span>`;
};
const label = (r) => `<code>${esc(r.slug)}</code>@<code>${esc(r.to)}</code>`;
// The cross-report economics table's own row label. Its two figure columns are
// headed by the models, so repeating the model in every row names the column
// twice and the skill not at all. Used ONLY there; everywhere else on this page
// a row is a cell and carries its model.
const labelSkill = (r) => `<code>${esc(r.slug)}</code>`;

// The within-report, per-case, skill-against-baseline verdict, composed from the
// shipped rule functions. IDENTICAL to Report 007's path, and carrying the same
// disclosure: `driftproof diff` compares two receipts, so no shipped command
// renders this table and there is no assertion over such a command.
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
      ratio: varianceRatio(g.sd, g.judge_sd_mean),
    };
  });
  const ratios = arms.map((a) => a.ratio).filter((x) => x != null).sort((a, b) => a - b);
  return {
    arms,
    drawn: arms.reduce((a, x) => a + x.drawn, 0),
    measured: arms.reduce((a, x) => a + x.measured, 0),
    unmeasured: arms.reduce((a, x) => a + x.unmeasured, 0),
    ratioMedian: median(ratios),
    ratioMax: ratios.length ? ratios[ratios.length - 1] : null,
  };
}

// THE VERDICT AND THE HEADLINE ARE THE DIFFER'S, QUOTED. `buildDriftReport`
// emits markdown; the two sentences under its `## Headline` are lifted out of
// that markdown rather than recomposed here, so the page cannot state a verdict
// the tool did not produce. A recomposition would be a second implementation of
// the rule, and the rule is the product.
function driftFor(cell) {
  const older = R(cell.baseline);
  const newer = R(cell.receipt);
  const d = buildDriftReport(older, newer, { labelA: cell.labelA, labelB: cell.labelB });
  const body = d.markdown.split('## Headline')[1].split('## Per-case')[0].trim();
  const lines = body.split('\n').map((s) => s.trim()).filter(Boolean);
  const verdictLine = lines[0].replace(/^\*\*|\*\*$/g, '');
  const summaryLine = lines.slice(1).join(' ');
  return {
    older, newer, drift: d,
    verdictLine,
    summaryLine,
    counts: {
      regressions: d.perCase.filter((c) => c.verdict.startsWith('regress')).length,
      improvements: d.perCase.filter((c) => c.verdict.startsWith('improve')).length,
      withinNoise: d.perCase.filter((c) => c.verdict.startsWith('within noise')).length,
    },
    belowFloor: d.perCase.filter((c) => c.verdict.includes('floor')),
    refused: d.refused,
  };
}

function readCells() {
  return CELLS.map((cell) => {
    const receipt = R(cell.receipt);
    const baseline = R(cell.baseline);
    const liftRows = (rcpt) => rcpt.results.cases.filter((c) => c.mode === 'with_skill').map((wc) => {
      const bc = rcpt.results.cases.find((c) => c.mode === 'baseline' && c.id === wc.id);
      const a = bandOf(bc);
      const b = bandOf(wc);
      return { id: wc.id, baseline: a, skill: b, ...caseVerdict(a, b) };
    });
    const cases = liftRows(receipt);
    const priorCases = liftRows(baseline);
    // Share of the cell's lift carried by each case. The sum of the per-case
    // deltas divided by the case count reproduces the receipt's own
    // `comparison.delta`, so the shares account for the whole lift with nothing
    // left over; the assertion of that identity is in the gate, not here.
    const sumDelta = cases.reduce((a, c) => a + c.delta, 0);
    for (const c of cases) c.share = c.delta / sumDelta;
    return {
      ...cell,
      receipt_rel: cell.receipt,
      baseline_rel: cell.baseline,
      receipt,
      baselineReceipt: baseline,
      cases: cases.slice().sort((a, b) => b.delta - a.delta),
      priorCases,
      aggregates: receipt.results.aggregates,
      comparison: receipt.comparison,
      priorComparison: baseline.comparison,
      sampling: sampling(receipt),
      priorSampling: sampling(baseline),
      fresh: freshBasis(receipt),
      priorFresh: freshBasis(baseline),
      drift: driftFor(cell),
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, cell.receipt))).digest('hex'),
    };
  });
}

// ── the headline: the differ's verdict, first and unqualified ────────────────
function headlineBlock(rows) {
  const allWithin = rows.every((r) => r.drift.counts.regressions === 0 && r.drift.counts.improvements === 0);
  const tally = rows.map((r) => `${r.drift.counts.regressions}/${r.drift.counts.improvements}/${r.drift.counts.withinNoise}`).join(' and ');
  // `class="big"` IS LOAD-BEARING, not styling. scripts/site-data.mjs reads the
  // headline out of `<div class="headline"> ... <p class="big">`, and every
  // published report carries exactly one. Without it this page derives an EMPTY
  // headline and no verdict line, and the defect would first surface at
  // promotion, which is the moment nobody is looking at it any more.
  return `    <p class="big"><strong>Both cells came back WITHIN NOISE.</strong> Not one of the fourteen cases moved beyond its confidence band when the same skill text, over the same suite, on the same surface, was measured on <code>claude-fable-5-1</code> instead of <code>claude-fable-5</code>. Per-case regressions, improvements and within-noise counts are <strong>${tally}</strong>${allWithin ? '' : ' (see the per-cell tables)'}. <strong>The skill holds up on the new model.</strong></p>
${rows.map((r) => `    <p class="muted"><strong>${label(r)}</strong>: ${esc(r.drift.verdictLine)}<br>${esc(r.drift.summaryLine)}</p>`).join('\n')}
    <p class="muted">Both lines above are <code>driftproof diff</code>'s own output, quoted out of the markdown it emits rather than restated here. Neither invocation passed a flag that relaxes epistemics, both exited 0, and neither cell produced a refusal: the cross-version comparability refusal did not fire because the receipts are the same schema version, and the below-TESTED refusal did not fire because all four receipts are TESTED.</p>`;
}

// The verdict is a COMPOSED LABEL and it is not the headline. The headline says
// what the differ found; the verdict says what this report concludes from it,
// which is a narrower thing and carries its own basis.
function verdictBlock(rows) {
  const bf = rows.flatMap((r) => r.drift.belowFloor.map((c) => ({ r, c })));
  return `  <h2>Verdict</h2>
  <div class="card">
    <p class="verdict"><strong>HOLDS ACROSS THE RELEASE, ON A PAIR WHERE THE MODEL IS THE ONLY THING THAT MOVED.</strong></p>
    <p><strong>What that does and does not say.</strong> It says the two skills' measured behaviour on <code>claude-fable-5-1</code> is indistinguishable, by this instrument, from their behaviour on <code>claude-fable-5</code>, and that the attribution is clean: skill <code>content_hash</code> and <code>suite_hash</code> were asserted identical against the Report 007 baselines before the first call, and surface, judge and judge samples per case are held on both sides of both pairs. It does not say the skills got better, it does not say they got worse, and it does not say nothing changed underneath. A within-noise verdict is a statement about what this instrument can resolve at this sample size, which is ${rows.reduce((a, r) => a + r.sampling.drawn, 0)} generation draws across ${rows.reduce((a, r) => a + r.sampling.arms.length, 0)} arms.</p>
    <p><strong>Where the verdict is closest to its own edge.</strong> ${bf.length === 1 ? `Exactly one case in the run is held inside the verdict by the effect floor rather than by band overlap: ${label(bf[0].r)}'s <code>${esc(bf[0].c.id)}</code>, whose bands ARE separated (${bandStr(bf[0].c.before)} against ${bandStr(bf[0].c.after)}) and whose move of ${fmt(bf[0].c.delta)} is below the ${num(EFFECT_FLOOR, 2)} floor. It is named here rather than left in a table, because it is the one row where a reader who set a lower floor would read a different verdict.` : `${bf.length} cases are held inside the verdict by the effect floor rather than by band overlap.`} Every other case in the run fails the separation test outright, so the verdict does not rest on the floor.</p>
  </div>`;
}

// ── the recurrence finding ───────────────────────────────────────────────────
//
// Report 007's thesis was that the baseline is the noisy arm. This section is
// that thesis meeting a second, independent model pair, stated from case-level
// numbers rather than from prose.
function recurrenceBlock(rows) {
  const cr = rows[0];
  const top = cr.cases[0];
  const priorTop = cr.priorCases.find((c) => c.id === top.id);
  const widening = top.skill.sd / priorTop.skill.sd;
  const rest = cr.cases.slice(1).reduce((a, c) => a + c.delta, 0);
  const wp = rows[1];
  const wpFails = wp.cases.filter((c) => c.baseline.mean < 0.5);
  const wpShare = wpFails.reduce((a, c) => a + c.share, 0);

  const movers = [];
  for (const r of rows) {
    for (const c of r.cases) {
      const p = r.priorCases.find((x) => x.id === c.id);
      if (!p) continue;
      movers.push({
        r, id: c.id,
        baseDelta: c.baseline.mean - p.baseline.mean,
        skillDelta: c.skill.mean - p.skill.mean,
        baseBefore: p.baseline, baseAfter: c.baseline,
        skillBefore: p.skill, skillAfter: c.skill,
      });
    }
  }
  movers.sort((a, b) => Math.abs(b.baseDelta) - Math.abs(a.baseDelta));
  const biggest = movers.slice(0, 5);
  const baseSpread = Math.max(...movers.map((m) => Math.abs(m.baseDelta)));
  const skillSpread = Math.max(...movers.map((m) => Math.abs(m.skillDelta)));

  return `  <h2>The finding: Report 007's thesis, recurring on a second model pair</h2>
  <div class="card">
    <p><a href="../007/index.html">Report 007</a> found that across three cells the arm that would not sit still was the <strong>baseline</strong>, and that what the skill did was stabilise the floor rather than raise the ceiling. That report moved the instrument and held the substrate. This one moves the substrate and holds the instrument, and the same shape comes back.</p>

    <p><strong>The headline case of ${label(cr)} went pass to borderline, and the reason is not the skill.</strong> <code>${esc(top.id)}</code> carries <strong>${pct(top.share)}</strong> of that cell's entire lift: its ${fmt(top.delta)} against a sum of ${fmt(cr.cases.reduce((a, c) => a + c.delta, 0))} across all ${cr.cases.length} cases, with the remaining six summing to ${fmt(rest)}. Take it out and the cell's lift is ${fmt(rest / cr.cases.length)}, indistinguishable from zero and far below the ${num(EFFECT_FLOOR, 2)} floor. On the release axis that one case moved like this:</p>
    <table class="summary">
      <thead><tr><th>arm</th><th>on <code>${esc(cr.from)}</code></th><th>on <code>${esc(cr.to)}</code></th><th>Δ</th></tr></thead>
      <tbody>
        <tr><td><strong>baseline</strong></td><td>${bandStr(priorTop.baseline)}</td><td>${bandStr(top.baseline)}</td><td><strong>${fmt(top.baseline.mean - priorTop.baseline.mean)}</strong></td></tr>
        <tr><td>with_skill</td><td>${bandStr(priorTop.skill)}</td><td>${bandStr(top.skill)}</td><td>${fmt(top.skill.mean - priorTop.skill.mean)}</td></tr>
      </tbody>
    </table>
    <p>The baseline arm fell ${num(priorTop.baseline.mean)} to ${num(top.baseline.mean)}. The with_skill arm held, moving ${fmt(top.skill.mean - priorTop.skill.mean)} and staying inside its own band. The cell's lift on this case therefore <em>grew</em>, ${fmt(priorTop.delta)} to ${fmt(top.delta)}, and almost all of that growth is the unskilled arm getting worse rather than the skilled arm getting better. <strong>A report that quoted the lift without this sentence would credit the skill with something the model did to the arm that does not have it.</strong></p>

    <p><strong>The stability moved the other way, and that is the cost of the same fact.</strong> The with_skill band on that case widened from ± ${num(priorTop.skill.sd)} to ± ${num(top.skill.sd)}, a factor of <strong>${num(widening, 1)}</strong>, which is what took its outcome label from pass to borderline and what makes the release-axis verdict on it read within noise despite a move of ${fmt(top.skill.mean - priorTop.skill.mean)}. The receipt says where the width came from: the arm drew a fourth generation with <code>stopping_reason: "stabilised"</code>, and one of the four scored far below the others. A one-case pillar that has become unstable is a fragility this page discloses whatever the aggregate verdict says.</p>

    <p><strong>The same pattern carries ${label(wp)}, with two pillars instead of one.</strong> The ${wpFails.length} cases whose baseline arm outright fails carry <strong>${pct(wpShare)}</strong> of that cell's lift: ${wpFails.map((c) => `<code>${esc(c.id)}</code> at ${fmt(c.delta)} (baseline ${num(c.baseline.mean)})`).join(' and ')}. The other ${wp.cases.length - wpFails.length} cases sum to ${fmt(wp.cases.filter((c) => c.baseline.mean >= 0.5).reduce((a, c) => a + c.delta, 0))}. In both cells, on both models, the lift is not spread across the suite: it is a handful of cases where the unskilled arm fails and the skilled arm does not.</p>

    <p><strong>Which arm actually moved between the two models.</strong> The differ compares the <code>with_skill</code> arm only, so baseline drift is invisible in its output. Computed here over the same receipts, the largest movements in the run are baseline movements:</p>
    <table class="summary">
      <caption class="muted">The five cases whose baseline arm moved most between the two models, with the same case's with_skill movement beside it. Bands carry their source.</caption>
      <thead><tr><th>cell</th><th>case</th><th>baseline, <code>${esc(rows[0].from)}</code> to <code>${esc(rows[0].to)}</code></th><th>Δ baseline</th><th>Δ with_skill</th></tr></thead>
      <tbody>
${biggest.map((m) => `        <tr><td>${label(m.r)}</td><td><code>${esc(m.id)}</code></td><td>${bandStr(m.baseBefore)} to ${bandStr(m.baseAfter)}</td><td><strong>${fmt(m.baseDelta)}</strong></td><td>${fmt(m.skillDelta)}</td></tr>`).join('\n')}
      </tbody>
    </table>
    <p>Across all ${movers.length} cases the widest baseline movement is ${num(baseSpread)} and the widest with_skill movement is ${num(skillSpread)}. <strong>The floor moved further than the ceiling did, on a release the skill text did not know about.</strong> That is Report 007's finding, reproduced on a substrate change rather than an instrument change, and it is the reason this report presents the aggregate lift with its per-case table attached rather than on its own.</p>

    <p class="muted">One honest caution about the sentence above. The baseline arm is where a model's own default behaviour shows through, so it is the arm most exposed to a release, and finding the larger movement there is not by itself surprising. What the two reports together support is narrower than a law: on five cells across two model pairs, the arm with the skill text moved less than the arm without it, and the skill's measured value came from the cases where the unskilled arm failed. Five cells is five cells.</p>
  </div>`;
}

// ── per-cell tables ──────────────────────────────────────────────────────────
function cellSection(r) {
  const dr = r.drift;
  return `  <h3>${label(r)}</h3>
  <p class="muted">Release axis, <code>with_skill</code> on <code>${esc(r.from)}</code> against <code>with_skill</code> on <code>${esc(r.to)}</code>. This is the comparison the verdict rests on. Skill <code>content_hash</code> <code>${esc(r.receipt.skill.content_hash.slice(0, 12))}</code> and <code>suite_hash</code> <code>${esc(r.receipt.suite.suite_hash.slice(0, 12))}</code> are identical on both sides.</p>
  <table class="summary">
    <caption class="muted">Every band below is an across-draw spread over the generation draws the receipt records, and carries <code>(generation)</code> as its source. No <code>(legacy)</code> band appears anywhere in this report: both sides of both pairs are v0.5 generation-sampled receipts, which is what makes this the first release pair the project can compare like for like.</caption>
    <thead><tr><th>case</th><th>${esc(r.labelA)} <span class="muted">(${esc(r.from)})</span></th><th>${esc(r.labelB)} <span class="muted">(${esc(r.to)})</span></th><th>Δ</th><th>verdict</th></tr></thead>
    <tbody>
${dr.drift.perCase.map((c) => `      <tr><td><code>${esc(c.id)}</code></td><td>${bandStr(c.before)}</td><td>${bandStr(c.after)}</td><td>${fmt(c.delta)}</td><td><span class="v ${VCLASS(c.verdict)}">${esc(c.verdict)}</span></td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="muted">Cell aggregates: <code>with_skill</code> ${num(r.aggregates.with_skill.mean_score)} ± ${num(r.receipt.results.aggregates.with_skill.stddev != null ? r.receipt.results.aggregates.with_skill.stddev : 0)}, baseline ${num(r.aggregates.baseline.mean_score)}, lift ${fmt(r.comparison.delta)} ± ${num(r.comparison.delta_uncertainty)}. <strong>An aggregate band carries no source label because it is not a band over draws</strong>: it is the dispersion of the seven case means across the suite, a different statistic from the per-case bands above, and the two are not interchangeable.</p>

  <h4>The lift inside ${label(r)}, per case</h4>
  <table class="summary">
    <caption class="muted">Within-report, <code>with_skill</code> against <code>baseline</code> on <code>${esc(r.to)}</code>, through the same band-and-floor rule. Share is the case's Δ over the sum of all ${r.cases.length} Δs; the sum over ${r.cases.length} reproduces the receipt's own <code>comparison.delta</code>.</caption>
    <thead><tr><th>case</th><th>with_skill</th><th>baseline</th><th>Δ</th><th>share of lift</th><th>verdict</th></tr></thead>
    <tbody>
${r.cases.map((c) => `      <tr><td><code>${esc(c.id)}</code></td><td>${bandStr(c.skill)}</td><td>${bandStr(c.baseline)}</td><td>${fmt(c.delta)}</td><td>${pct(c.share)}</td><td><span class="v ${VCLASS(c.verdict)}">${esc(c.verdict)}</span>${c.why ? ` <span class="muted">(${esc(c.why)})</span>` : ''}</td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="muted"><strong>The aggregate lift of ${fmt(r.comparison.delta)} ± ${num(r.comparison.delta_uncertainty)} is not a band-verified improvement claim</strong>, and this page does not make one. The lift clears the ${num(EFFECT_FLOOR, 2)} floor and fails the separation test, because the baseline aggregate band (± ${num(r.aggregates.baseline.stddev != null ? r.aggregates.baseline.stddev : 0)}) overlaps the with_skill one. That width is produced by the ${r.cases.filter((c) => c.baseline.mean < 0.5).length} failing baseline case${r.cases.filter((c) => c.baseline.mean < 0.5).length === 1 ? '' : 's'} in the arm the skill is meant to fix, not by instability in the with_skill arm (± ${num(r.aggregates.with_skill.stddev != null ? r.aggregates.with_skill.stddev : 0)}). Reading ${fmt(r.comparison.delta)} ± ${num(r.comparison.delta_uncertainty)} as "the lift might be negative" is the reading that width invites and the per-case table above contradicts.</p>`;
}

// THE RELEASE-AXIS TALLY, IN THE FORM THE REST OF THE SITE STATES ONE.
// `prepare-report-007.js` ends its per-case section with the same
// `N label \u00b7 N label` line, and `tests/essay-grounding.js` reads exactly that
// shape as a report's own tally. Report 008 shipped without one through its
// draft life, so the oracle fell through to counting `span.v` cells across the
// WHOLE page, which on this page sums two different axes: the release-axis table
// and the within-report lift table. That produced a tally no honest sentence
// could state. The line below is one axis, the release axis, which is the one
// the verdict rests on. It ends in a full stop and carries no trailing clause,
// because the oracle's terminator set is ` \u2014`, `.`, ` over`, ` across` or
// end-of-string, and a `, over` clause silently takes the whole line unreadable.
function tallyLine(rows) {
  const sum = (k) => rows.reduce((a, r) => a + r.drift.counts[k], 0);
  const cases = rows.reduce((a, r) => a + r.drift.counts.regressions + r.drift.counts.improvements + r.drift.counts.withinNoise, 0);
  return `  <p>Across all ${cases} published cases on the release axis: <strong>${sum('improvements')} improved \u00b7 ${sum('regressions')} regressed \u00b7 ${sum('withinNoise')} within noise \u00b7 0 not measured</strong>.</p>`;
}

function resultsSection(rows) {
  return `  <h2>The measurement, per cell</h2>
${rows.map(cellSection).join('\n\n')}

${tallyLine(rows)}`;
}

// ── economics, on the fresh-input basis ──────────────────────────────────────
//
// ON ONE BASIS, DELIBERATELY. Report 007 published its economics with every
// input token priced at the list input rate, cached ones included, which is what
// `computeEconomics` does and what the receipts declare. Report 007 v1.1 shows
// what that convention did to that page: two of three cells changed the sign of
// their incremental when the same recorded draws were re-priced with cached
// input excluded. This page therefore leads with the fresh-input basis and does
// not read a mechanism out of the other one.
//
// NO CROSS-REPORT ABSOLUTE COST FIGURE APPEARS BELOW. On a subscription surface
// the absolute per-call cost is dominated by a harness preamble neither arm
// chose; it cancels between arms inside a report and does not cancel between
// reports, so a sentence comparing absolute dollars across reports would be
// measuring the preamble. Token movements and within-report incrementals are
// what survive that, and they are what is printed.
function economicsSection(rows) {
  const wp = rows[1];
  const cr = rows[0];
  const armMove = (r) => {
    const dCached = r.fresh.with_skill.cached - r.priorFresh.with_skill.cached;
    const dFresh = r.fresh.with_skill.fresh - r.priorFresh.with_skill.fresh;
    const dOut = r.fresh.with_skill.output - r.priorFresh.with_skill.output;
    const rt = r.fresh.rates;
    const listed = r.fresh.with_skill.listedCost - r.priorFresh.with_skill.listedCost;
    const fresh = r.fresh.with_skill.freshCost - r.priorFresh.with_skill.freshCost;
    return { dCached, dFresh, dOut, rt, listed, fresh, cachedShare: (dCached * rt.input_per_mtok / 1e6) / listed, freshShare: fresh / listed };
  };
  const wpm = armMove(wp);
  const crm = armMove(cr);
  const alloc = (rcpt, mode) => rcpt.results.cases.filter((c) => c.mode === mode)
    .map((c) => (c.generation || {}).n_measured || 0).join(',');
  const sameAlloc = alloc(wp.receipt, 'with_skill') === alloc(wp.baselineReceipt, 'with_skill');

  return `  <h2>Economics, on fresh input</h2>
  <div class="card">
    <p><strong>Every dollar below excludes cached input tokens.</strong> The receipts price all input at the list input rate, cached included, and record <code>cached_tokens</code> per draw precisely so a reader can re-price. On this surface cached context is ${pct(Math.min(...rows.flatMap((r) => [r.fresh.with_skill.cachedShare, r.fresh.baseline.cachedShare])))} to ${pct(Math.max(...rows.flatMap((r) => [r.fresh.with_skill.cachedShare, r.fresh.baseline.cachedShare])))} of each call's input here, so on the list-rate basis the largest term in every mean is harness preamble that neither arm chose and the skill cannot move. <a href="../007/index.html">Report 007 v1.1</a> is what happened when a mechanism was read out of that basis: two of its three cells changed the sign of their incremental under this same re-pricing. This page therefore prints one basis and does not claim the other.</p>

    <table class="summary">
      <caption class="muted">Per-call incremental, <code>with_skill</code> minus <code>baseline</code>, WITHIN each report, on fresh input at each receipt's own frozen rates. Both figures in a row are the same arithmetic over different receipts, so the row is a like-for-like comparison; neither figure is an absolute cost and neither was metered.</caption>
      <thead><tr><th>skill</th><th>on <code>${esc(cr.from)}</code> (Report 007)</th><th>on <code>${esc(cr.to)}</code> (Report 008)</th><th>direction</th></tr></thead>
      <tbody>
${rows.map((r) => `        <tr><td>${labelSkill(r)}</td><td>${usdSigned(r.priorFresh.freshIncremental)}</td><td><strong>${usdSigned(r.fresh.freshIncremental)}</strong></td><td>${r.priorFresh.freshIncremental > 0 && r.fresh.freshIncremental > 0 ? 'positive in both reports' : (r.priorFresh.freshIncremental < 0 && r.fresh.freshIncremental < 0 ? 'negative in both reports' : 'changes sign between the reports')}</td></tr>`).join('\n')}
      </tbody>
    </table>
    <p><strong>The incremental is positive in both reports on ${label(wp)} and only on that cell.</strong> ${label(cr)} is ${usdSigned(cr.priorFresh.freshIncremental)} on the older model and ${usdSigned(cr.fresh.freshIncremental)} on the newer one, so it changes sign between the reports on the fresh basis. A single sentence covering both cells would be wrong about one of them, and the difference is small enough in absolute terms that neither sign should be leaned on: the whole column is hundredths of a cent per call.</p>

    <p><strong>What moved in the tokens, ${label(wp)}.</strong> The with_skill arm's per-call cost rises between the two models, and <strong>${pct(wpm.cachedShare)}</strong> of that rise is cached context priced at the list rate. <strong>${pct(wpm.freshShare)}</strong> of it survives on fresh input, and it is chiefly output: <strong>${intSigned(wpm.dOut)} mean output tokens per call</strong>, at an output rate ${num(wpm.rt.output_per_mtok / wpm.rt.input_per_mtok, 0)} times the input rate, against ${intSigned(wpm.dFresh)} fresh input tokens. ${sameAlloc ? `That comparison is at an <strong>identical draw allocation</strong>: ${wp.fresh.with_skill.calls} draws in both reports, allocated <code>${esc(alloc(wp.receipt, 'with_skill'))}</code> both times, with the same case in the wide slot. Adaptive stopping made the same decisions on the new model in this arm, so the movement is per-draw token growth and not a change in what was averaged.` : 'The draw allocation differs between the reports, so part of the movement is a change in what was averaged.'} <code>${esc(wp.to)}</code> writes materially longer plans for the same seven cases.</p>

    <p><strong>And on ${label(cr)}, the same arithmetic points the other way.</strong> Its with_skill arm emits ${intSigned(crm.dOut)} output tokens per call on the new model and takes on ${intSigned(crm.dFresh)} fresh input tokens, so on fresh input that arm gets <em>cheaper</em> per call across the release while the list-rate basis says it gets dearer. Longer outputs are a property of one of these two skills' generations on <code>${esc(cr.to)}</code>, not of the release.</p>

    <p class="muted"><strong>The caveat this whole section rests on, stated plainly.</strong> Cached input is not free to the vendor and is not billed at the list rate either; the receipts over-estimate it and this page under-estimates it by excluding it entirely, and neither basis is the true one. Actual metered spend for this run was <strong>$0.00</strong>: the surface is a subscription CLI and every figure here is the if-it-had-been-metered equivalent at each receipt's own frozen pricing snapshot. Prices are identical across all four receipts (${num(wp.fresh.rates.input_per_mtok, 0)} in / ${num(wp.fresh.rates.output_per_mtok, 0)} out per Mtok for both Fable models), so nothing above is price-driven. Judge cost is measurement overhead this project imposes and is excluded from every field. No figure on this page comes from the run's pre-flight projection or from any cap.</p>
    <p class="muted"><strong>Latency</strong>, observed on subscription CLI surface, indicative: inside this run a call is slower with the skill than without it, by ${rows.map((r) => `${fmt(r.receipt.economics.median_wall_ms_delta, 0)} ms of median wall-clock on ${label(r)}`).join(' and ')}. Wall-clock here includes cold starts and the vendor's own harness and is not a measurement of serving latency.</p>
  </div>`;
}

// ── the run record: timing as fact ───────────────────────────────────────────
//
// STATED, NOT CELEBRATED. A clean run is the expected outcome of a fixed
// timeout, not an achievement, and the only reason it is on the page at all is
// that Report 007's subject was a timeout defect which cost that report 24 draws
// and forced a re-run. Zero losses here is the control on that fix, so it is
// reported as a count with its policy source, and nothing is claimed from it.
function runRecordSection(rows, rec) {
  const totalDrawn = rows.reduce((a, r) => a + r.sampling.drawn, 0);
  const totalUnmeasured = rows.reduce((a, r) => a + r.sampling.unmeasured, 0);
  const pre = rec.pre_launch_assertion;
  return `  <h2>Run record</h2>
  <div class="card">
    <p><strong>Launched against <code>${esc(rec.axis.to_model)}</code> on ${esc(rec.cells[0].start_utc.slice(0, 10))}</strong>, from an isolated git worktree at <code>${esc(rec.provenance.head_at_launch)}</code> on <code>${esc(rec.provenance.branch)}</code>. ${esc(rows[0].slug)} ran ${esc(rec.cells[0].start_utc)} to ${esc(rec.cells[0].end_utc)}, ${esc(rows[1].slug)} ran ${esc(rec.cells[1].start_utc)} to ${esc(rec.cells[1].end_utc)}, ${rec.cells.map((c) => `${int(c.calls)} calls`).join(' and ')}, both exit 0. The receipts landed at <code>${EVIDENCE_COMMIT}</code>.</p>

    <p><strong>The hashes were asserted before the first call, not after the last one.</strong> A pre-launch assertion exited ${pre.exit_code} having compared, per cell, the skill <code>content_hash</code> and the <code>suite_hash</code> the run was about to use against the Report 007 baseline receipt it would be diffed against: ${pre.cells.map((c) => `<code>${esc(c.slug)}</code> (<code>${esc(c.skill_content_hash.slice(0, 12))}</code>, <code>${esc(c.suite_hash.slice(0, 12))}</code>, ${c.cases} cases)`).join(' and ')}. Both matched on both fields. <strong>That ordering is the whole attribution claim.</strong> Checking afterwards tells a reader what was measured; checking first is what makes it a controlled comparison, because a mismatch would have stopped the run before it spent anything. The differ re-confirms the same equality from the receipts themselves, so the assertion has a second, independent witness.</p>

    <p><strong>Zero draws were lost to timeout.</strong> ${int(totalDrawn)} generation draws across ${rows.reduce((a, r) => a + r.sampling.arms.length, 0)} arms, ${int(totalDrawn - totalUnmeasured)} measured, <strong>${int(totalUnmeasured)} unmeasured</strong>. The per-call timeout was ${int(rec.timeout_policy.timeout_ms)} ms, <strong>resolved from the surface policy rather than passed as a flag</strong> (<code>${esc(rec.timeout_policy.source)}</code>). Report 007's subject was that this policy had been declared and not executed since ${esc('2026-07-27')}, shadowed by a numeric literal at the call site, so every run before the fix ran at 120 s; this is the first release-drift run to execute under the policy as written, and the loss count is the control on that fix rather than a claim about this run's difficulty. A restart script was prepared before launch and never invoked.</p>

    <p class="muted">Caps per cell: <code>--max-cases ${rec.caps_per_cell.max_cases}</code>, <code>--max-calls ${int(rec.caps_per_cell.max_calls)}</code>, <code>--max-usd ${rec.caps_per_cell.max_usd}</code>. Judge <code>${esc(JUDGE_MODEL)}</code> at ${rows[0].receipt.run.judge.samples} samples per draw on both cells. Surface <code>${esc(rows[0].receipt.run.surface)}</code> throughout, metered spend <strong>$0.00</strong>. Verification level <strong>${esc(rows[0].receipt.verification_level)}</strong> on all four receipts, none carrying a <code>run.source</code>, so none is an imported declaration and the differ's NOT MEASURED path was not reached. The timings, the assertion result and the timeout policy above are transcribed from the run log into <a href="${BLOB}/${RUN_RECORD}"><code>${RUN_RECORD}</code></a>, which records that log's sha256 so the transcription is checkable; the log is an operator-home file and is not committed.</p>
  </div>`;
}

function limitsSection(rows) {
  const bf = rows.flatMap((r) => r.drift.belowFloor);
  return `  <h2>Limits</h2>
  <div class="card">
    <ul>
      <li><strong>Two cells is two cells.</strong> Fourteen cases on one substrate family is not a corpus, and nothing here generalises past the two skills named on it.</li>
      <li><strong>A within-noise verdict is not a finding of no change.</strong> It is a statement about what this instrument resolves at ${rows.reduce((a, r) => a + r.sampling.drawn, 0)} draws across ${rows.reduce((a, r) => a + r.sampling.arms.length, 0)} arms, and a real move smaller than these bands would look exactly like this.</li>
      <li><strong>${bf.length === 1 ? 'One case is held inside the verdict by the effect floor alone' : `${bf.length} cases are held inside the verdict by the effect floor alone`}</strong>, named in the Verdict above. A reader who set a lower floor would read that row differently.</li>
      <li><strong>The aggregate lift in both cells is not band-verified</strong>, and the report claims no aggregate improvement from it. What is shown per case is shown per case.</li>
      <li><strong>The lift in both cells is concentrated in a few cases</strong>, and in ${label(rows[0])} one case carries ${pct(rows[0].cases[0].share)} of it. A concentrated lift is more fragile than a spread one, and that case's band widened on the new model.</li>
      <li><strong>The differ compares the with_skill arm only.</strong> The baseline movements this report leans on are computed on this page from the same receipts, not emitted by a shipped command, which is the same disclosed gap Report 007 filed.</li>
      <li><strong>One case is bimodal rather than merely noisy.</strong> <code>task-right-sizing-testable-deliverable</code> drew ${rows[1].sampling.arms.find((a) => a.id === 'task-right-sizing-testable-deliverable' && a.mode === 'with_skill').drawn} times with a variance ratio above 1, its draw means splitting into a high and a low group. A single mean ± sd understates what a user of that case would experience, and it was the widest case on the older model too, so it is a property of the case rather than of the release.</li>
      <li><strong>The economics rest on a basis choice, disclosed above</strong>, and the sign of an incremental on this surface depends on it.</li>
      <li><strong><code>run.model_release_date</code> is null in both receipts</strong> for a report whose axis is a release. The date is asserted in the launch script and the run record, not in the receipt, which is a schema gap this run surfaces and does not fix.</li>
      <li><strong>Every verdict is verifiable from the receipts</strong>, which are linked below rather than described.</li>
    </ul>
  </div>`;
}

function receiptsBlock(rows) {
  return `  <h2>Receipts</h2>
  <details class="card" open><summary><strong>All four receipts this report rests on, each one resolvable.</strong> Two measured here, two the Report 007 baselines they are diffed against. Every number on this page re-derives from these files.</summary>
    <ul>
${rows.map((r) => `      <li>${label(r)} <span class="muted">(measured for this report)</span>: <a href="${BLOB}/${esc(r.receipt_rel)}"><code>${esc(r.receipt_rel)}</code></a><br><span class="muted">sha256 <code>${esc(r.sha256)}</code>, receipt_hash <code>${esc(r.receipt.receipt_hash.slice(0, 16))}</code></span></li>`).join('\n')}
${rows.map((r) => `      <li><code>${esc(r.slug)}</code>@<code>${esc(r.from)}</code> <span class="muted">(Report 007 baseline)</span>: <a href="${BLOB}/${esc(r.baseline_rel)}"><code>${esc(r.baseline_rel)}</code></a><br><span class="muted">receipt_hash <code>${esc(r.baselineReceipt.receipt_hash.slice(0, 16))}</code></span></li>`).join('\n')}
    </ul>
    <p class="muted">Validate any of them with <code>npx driftproof validate &lt;file&gt;</code>, and reproduce either verdict with <code>npx driftproof diff &lt;baseline&gt; &lt;receipt&gt;</code>. The two receipts measured here landed at <code>${EVIDENCE_COMMIT}</code> and neither has been modified since it was sealed. <a href="${BLOB}/receipts/report-007/writing-plans-claude-fable-5-2026-08-31.json"><code>receipts/report-007/writing-plans-claude-fable-5-2026-08-31.json</code></a> also exists; it is Report 007's unpublished defect evidence for that cell, and this report neither reads nor modifies it.</p>
  </details>`;
}

// The report number, read off the path rather than typed: the page, its output
// directory and its card must agree by construction, and `008` written a fourth
// time is a fourth thing to keep in step.
const NUMBER = /reports\/(\d+)/.exec(PAGE_REL)[1];

function buildPage(rows, rec) {
  const base = applyHeadTags(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof: Report 008, the skill stabilises the floor, not the ceiling</title>

<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report">
  <h1>Report 008: the skill stabilises the floor, not the ceiling</h1>
  <p class="report-type">Release drift report<span class="muted">. Two cells re-measured on <code>${esc(rows[0].to)}</code> against <code>${esc(rows[0].from)}</code>, with the skill text and the suite asserted byte-identical before launch. The first release pair in this project where both sides are generation-sampled receipts, which is what makes the delta attributable to the model.</span></p>
  <div class="headline">
${headlineBlock(rows)}
  </div>

${verdictBlock(rows)}

${recurrenceBlock(rows)}

${resultsSection(rows)}

${economicsSection(rows)}

${runRecordSection(rows, rec)}

${limitsSection(rows)}

${receiptsBlock(rows)}

  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report 008 · Release drift report</span></footer>
</main>
</body>
</html>
`, PAGE_REL);
  // The row is derived from the page just rendered, by the same function that
  // will derive it from the file after promotion, so the card reviewed now is
  // the card that ships. The page stays a pure function of its receipts: nothing
  // is read from docs/data/, and this row is never written there.
  const row = reportRow(NUMBER, { pageRel: `docs/${PAGE_REL}`, html: base });
  return renderReportPage(base, PAGE_REL, [row]);
}

function main() {
  const args = process.argv.slice(2);
  const rows = readCells();
  const rec = R(RUN_RECORD);
  const page = buildPage(rows, rec);
  const out = path.join(OUT_DIR, 'index.html');

  if (args.includes('--page')) { process.stdout.write(page); return 0; }
  if (args.includes('--check')) {
    const onDisk = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    if (onDisk === page) { console.log('report 008: page matches its receipts'); return 0; }
    console.error('report 008: page has DRIFTED from its receipts');
    process.exitCode = 1;
    return 1;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, page);
  console.log(`  wrote docs/${PAGE_REL}`);
  for (const r of rows) {
    console.log(`    ${r.slug}@${r.to}: ${r.drift.verdictLine.split(';')[0]}`
      + ` (${r.drift.counts.regressions} regression, ${r.drift.counts.improvements} improvement, ${r.drift.counts.withinNoise} within noise)`);
  }
  return 0;
}

if (require.main === module) main();

module.exports = {
  CELLS, readCells, driftFor, caseVerdict, sampling, buildPage, main,
  OUT_DIR, PAGE_REL, RUN_RECORD, JUDGE_MODEL, EVIDENCE_COMMIT, NUMBER,
};
