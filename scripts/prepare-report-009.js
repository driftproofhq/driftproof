#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-009.js: render Driftproof Report 009, three skills from one
// plugin measured by Claude Code's native plugin eval and by Driftproof.
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN. Nothing here calls a model or the
// network. The runs were made elsewhere and delivered as two bundles, kept out of
// git under specs/000-governance/external-runs/ (spec 034 P-1); what a report may
// make public is copied, byte-identical, beside the page in evidence/. The page
// is a pure function of those files and of the bundle files it cites.
//
// PROMOTED, 2026-09-19, BY RE-RENDER (spec 039), the way Report 008 was: the draft
// state lived in the constants below and in the chrome this file writes (title,
// noindex, banner, footer, eyebrow). Those moved; the blocks that render the
// report's content did not. The three receipts are also copied, byte-identical, to
// receipts/report-009/, the one directory the TL;DR card, the receipt pages and the
// badges read; the page still links its own evidence copies.
//
// EVERY FIGURE IS A <data> ELEMENT THAT NAMES ITS FILE. `value` is the value as
// read, `data-src` the repository-relative file, `data-at` where in the file,
// `data-fn` how it is read, and `data-dp` the rounding the display shows. Spec
// 034's gate re-reads every one of them with its own reader, which shares no
// code with this file, and every block cites in visible text each file its
// figures come from. A numeral in the body outside a <data> element is a gate
// failure, so a figure cannot be typed into the prose.
//
// Usage:
//   node scripts/prepare-report-009.js            # render docs/reports/009/
//   node scripts/prepare-report-009.js --check    # re-render, exit 1 on drift
//   node scripts/prepare-report-009.js --page     # print to stdout, write nothing

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EFFECT_FLOOR } = require('../config');
const { applyHeadTags } = require('./build-head-tags');
const { renderReportPage } = require('./site-chrome');
// The data layer derives the TL;DR row, as prepare-report-008.js does.
const { reportRow } = require('./site-data.mjs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'reports', '009');
const PAGE_REL = 'reports/009/index.html';
const NUMBER = /reports\/(\d+)/.exec(PAGE_REL)[1];

// THE PUBLIC EVIDENCE LIVES BESIDE THE PAGE, FLAT (spec 034 A-034-2). The repository
// gate's draft guard admits, under a *-draft/ path, a page and the files directly in its
// evidence/ directory; spec 018 holds receipts/ unmoved on a branch. So each copied file
// is named <bundle>--<its path inside the bundle, with / written as -->, which the gate
// reverses to find the SHA256SUMS line that vouches for it.
const PUB = 'docs/reports/009/evidence';
const pubName = (bundle, rel) => `${PUB}/${bundle}--${rel.split('/').join('--')}`;
const pc = (rel) => pubName('three-skill-comparison', rel);
const pf = (rel) => pubName('three-skill-full-plugin', rel);
const BCMP = 'specs/000-governance/external-runs/three-skill-comparison';
const BFULL = 'specs/000-governance/external-runs/three-skill-full-plugin';

const SKILLS = ['code-review-and-quality', 'git-workflow-and-versioning', 'documentation-and-adrs'];
const RECEIPT_DATE = '2026-09-15';
// The git-workflow-and-versioning baseline generations in the bundle's call log: the
// three generation calls for that skill whose argv carries no system prompt. Spec
// 034's gate re-derives the set from the bundle's command.json files.
const GIT_BASELINE_CALLS = ['041', '045', '049'];
// Where the effect floor is read from: the runner source carried in the full-plugin bundle.
const FLOOR_SRC = 'specs/000-governance/external-runs/three-skill-full-plugin/driftproof-source/README.md';
const FLOOR_RE = '\\*\\*effect floor\\*\\* \\(([0-9.]+),';

// The native rubric for the git-workflow-and-versioning case, as the bundle carries it.
// aggregate-result.json records one PASS/FAIL vote per run against the WHOLE rubric and
// no verdict per criterion, so a reading about the first criterion alone has to go
// through the rubric's own scoring: its pass mark and the cap it applies when the subject
// line carries no conventional type prefix. Both numbers are read out of the rubric file
// rather than written here, for the same reason FLOOR_RE reads the floor from the bundle.
// (F-6 of specs/034-.../evidence/approval-20260916T032542Z.md.)
const GW_RUBRIC = `${BCMP}/inputs/native/git-workflow-and-versioning/evals/commit-message-conventional-type/graders/criteria.md`;
// Both groups are `[0-9]+\.[0-9]+`, NOT `[0-9.]+`. The cap sentence ends "cap at 0.3."
// and a greedy character class takes the full stop with it, so the page rendered "0.3."
// and the AC-5 oracle agreed, because the oracle resolves this same expression: a figure
// and its check reading one regex cannot disagree about it. The shape is spec 034 F-2's
// `name-vs-thing` class, found by reading the rendered sentence rather than the gate.
const RUBRIC_PASS_RE = 'PASS if its score is at least ([0-9]+\\.[0-9]+)';
const RUBRIC_CAP_RE = 'conventional type prefix, cap at ([0-9]+\\.[0-9]+)';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));

// Where a file is shown to a reader. A published copy is named by its path in
// the repository; a file only the bundle holds is named inside its bundle and
// marked as not published.
function shown(rel) {
  if (rel.startsWith(`${PUB}/`)) return `<code>${esc(rel)}</code>`;
  if (rel.startsWith('specs/000-governance/external-runs/')) {
    const inner = rel.slice('specs/000-governance/external-runs/'.length);
    return `<code>${esc(inner)}</code> <span class="muted">(in the bundle, not published; its sha256 is listed in the bundle's published <code>SHA256SUMS</code>)</span>`;
  }
  return `<code>${esc(rel)}</code>`;
}

// One figure. The caller passes the value it read and the display it wants; the
// element records both, and where the value came from.
function D(display, value, src, at, fn = 'v', dp = null) {
  return `<data value="${esc(value)}" data-src="${esc(src)}" data-at="${esc(at)}" data-fn="${esc(fn)}"${dp == null ? '' : ` data-dp="${dp}"`}>${esc(display)}</data>`;
}
const n3 = (v) => Number(v).toFixed(3);
const n2 = (v) => Number(v).toFixed(2);

// A block's visible citation: every file a <data> element inside it names.
function cite(html) {
  const files = [...new Set([...html.matchAll(/data-src="([^"]+)"/g)].map((m) => m[1]))];
  return `<p class="muted cite">Read from: ${files.map(shown).join('; ')}.</p>`;
}

function receiptRel(s) { return pc(`driftproof/${s}/receipts/${s}-claude-opus-5-${RECEIPT_DATE}.json`); }
function nativeRel(s) { return pc(`native/${s}/results/aggregate-result.json`); }
function traceRel(s) { return pc(`native-trace-pass/${s}/results/aggregate-result.json`); }

function readSkill(s) {
  const r = readJson(receiptRel(s));
  const n = readJson(nativeRel(s));
  const t = readJson(traceRel(s));
  const arm = (mode) => r.results.cases.find((c) => c.mode === mode);
  const w = arm('with_skill').generation;
  const b = arm('baseline').generation;
  const c = n.cases[0];
  const fired = (a) => a.graders.find((g) => g.name === 'skill-fired').passed === true;
  const separated = (w.mean - w.sd > b.mean + b.sd || b.mean - b.sd > w.mean + w.sd)
    && Math.abs(w.mean - b.mean) >= EFFECT_FLOOR;
  return {
    slug: s, r, n, t, w, b, c,
    nWithPass: c.arms.with.filter((a) => a.passed).length,
    nWithRuns: c.arms.with.length,
    nWithoutPass: c.arms.without.filter((a) => a.passed).length,
    nWithoutFail: c.arms.without.filter((a) => !a.passed).length,
    nWithoutRuns: c.arms.without.length,
    firedMain: c.arms.with.filter(fired).length,
    firedTrace: t.cases[0].arms.with.filter(fired).length,
    traceRuns: t.cases[0].arms.with.length,
    separated,
  };
}

// ---- the page's blocks -------------------------------------------------------

function headlineBlock(rows) {
  const R0 = receiptRel(rows[0].slug);
  const body = `    <p class="big">Three skills from one plugin, one case each, measured by Claude Code&rsquo;s native plugin eval and by Driftproof, with the same SKILL.md bytes, task prompts and rubrics. The two tools apply different treatments and grade differently, so this page reads their results side by side and does not rank them.</p>
    <p>Every figure below is read from a file in the two bundles the runs were delivered in, and each block names its files. The target model and the judge were <code>${D(rows[0].r.run.model_id, rows[0].r.run.model_id, R0, 'run.model_id')}</code> in both tools.</p>
    ${cite(`<x data-src="${R0}">`)}`;
  return body;
}

function limitsSection(rows) {
  const byS = Object.fromEntries(rows.map((x) => [x.slug, x]));
  const cr = byS['code-review-and-quality'];
  const gw = byS['git-workflow-and-versioning'];
  const da = byS['documentation-and-adrs'];
  const caseCounts = rows.map((x) => D(x.r.suite.case_count, x.r.suite.case_count, receiptRel(x.slug), 'suite.case_count')).join(', ');
  const drawsWith = rows.map((x) => D(x.w.n_drawn, x.w.n_drawn, receiptRel(x.slug), 'results.cases[mode=with_skill].generation.n_drawn')).join(', ');
  const drawsBase = rows.map((x) => D(x.b.n_drawn, x.b.n_drawn, receiptRel(x.slug), 'results.cases[mode=baseline].generation.n_drawn')).join(', ');
  const GN = nativeRel(gw.slug);
  const GR = receiptRel(gw.slug);
  const gwWithout = gw.c.arms.without;
  const passedSubjects = gwWithout.filter((a) => a.passed && a.graders.find((g) => g.name === 'criteria').evidence.includes('fix(auth):')).length;
  const gwVotes = gwWithout.flatMap((a) => a.graders.find((g) => g.name === 'criteria').judgeVotes);
  const gwVotesAll = gwVotes.length;
  const gwVotesPass = gwVotes.filter(Boolean).length;
  const gwRubric = readText(GW_RUBRIC);
  const rubricPass = new RegExp(RUBRIC_PASS_RE).exec(gwRubric)[1];
  const rubricCap = new RegExp(RUBRIC_CAP_RE).exec(gwRubric)[1];
  const gwReason = gw.r.results.cases.find((c) => c.mode === 'baseline').reason.split(',')[0];
  const html = `  <h2 id="limits">Limits, read these first</h2>
  <div class="card">
    <ul>
      <li><strong>One case per skill.</strong> Each Driftproof receipt carries a suite of ${caseCounts} case, in the order ${rows.map((x) => `<code>${esc(x.slug)}</code>`).join(', ')}, and each native run has ${rows.map((x) => D(x.n.aggregates.casesTotal, x.n.aggregates.casesTotal, nativeRel(x.slug), 'aggregates.casesTotal')).join(', ')}. Nothing on this page describes how any of the three skills behaves on any other task.</li>
      <li><strong>Three or four draws.</strong> Driftproof drew ${drawsWith} generations for the with-skill arm and ${drawsBase} for the baseline arm, in the same skill order. The native eval ran ${rows.map((x) => D(x.c.runsPerCase, x.c.runsPerCase, nativeRel(x.slug), 'cases[0].runsPerCase')).join(', ')} runs per arm, and a separate supplement ${rows.map((x) => D(x.traceRuns, x.traceRuns, traceRel(x.slug), 'cases[0].arms.with[*]', 'count')).join(', ')} run per arm.</li>
      <li><strong>No across-case uncertainty.</strong> With one case there is no spread across cases, and each receipt says so: its combined uncertainty on the delta is absent, recorded as ${rows.map((x) => `<code>${D(x.r.comparison.delta_uncertainty_unavailable, x.r.comparison.delta_uncertainty_unavailable, receiptRel(x.slug), 'comparison.delta_uncertainty_unavailable')}</code>`).join(', ')}. The spreads on this page are across generation draws of one case.</li>
      <li><strong>Different treatments, so absolute scores are not comparable.</strong> The native eval runs the plugin in a real Claude Code session, where the model can discover the skill and call tools, and grades each run pass or fail. Driftproof puts the SKILL.md text in the prompt with no tools and scores each draw on a continuous scale. A native score is a pass fraction and a Driftproof score is a mean judge rating; neither converts into the other, and this page compares each tool&rsquo;s arms only with that tool&rsquo;s other arm. The next section describes both treatments.</li>
      <li><strong>The two judges on the git-workflow-and-versioning baseline, a finding about judging.</strong> The native baseline passed ${D(gw.nWithoutPass, gw.nWithoutPass, GN, 'cases[0].arms.without[*].passed', 'count-true')} of ${D(gw.nWithoutRuns, gw.nWithoutRuns, GN, 'cases[0].arms.without[*]', 'count')} runs; Driftproof&rsquo;s baseline scored ${D(n3(gw.b.mean), gw.b.mean, GR, 'results.cases[mode=baseline].generation.mean', 'v', 3)} across ${D(gw.b.n_drawn, gw.b.n_drawn, GR, 'results.cases[mode=baseline].generation.n_drawn')} draws. The two judges were never given the same output, so these files cannot split that difference between judging and generation. What they show about judging is narrower. The rubric&rsquo;s first criterion asks that the subject line begin with <code>fix:</code>. What the file records is one verdict per run against the whole rubric, not a verdict per criterion: ${D(gwVotesAll, gwVotesAll, GN, 'cases[0].arms.without[*].graders[name=criteria].judgeVotes[*]', 'count')} judge votes across the three baseline runs, ${D(gwVotesPass, gwVotesPass, GN, 'cases[0].arms.without[*].graders[name=criteria].judgeVotes[*]', 'count-true')} of them PASS, unanimous within each run. The step from there toward that criterion runs through the rubric&rsquo;s own scoring, which passes at ${D(rubricPass, rubricPass, GW_RUBRIC, RUBRIC_PASS_RE, 're')} and caps the score at ${D(rubricCap, rubricCap, GW_RUBRIC, RUBRIC_CAP_RE, 're')} when the subject line carries no conventional type prefix. The native judge passed ${D(passedSubjects, passedSubjects, GN, 'cases[0].arms.without[passed=true][*].graders[name=criteria].evidence|fix(auth):', 'count-contains')} of its baseline outputs against the whole rubric, and both of those subject lines begin <code>fix(auth):</code>, a scoped form. A run the cap had touched could not have reached the pass mark, so what those two passes show is that the judge applied no conventional-type-prefix cap to either output. That is the whole of what they show. The cap is worded for a conventional type prefix in general, while the criterion above names <code>fix:</code>; the file records no verdict on that criterion, so whether the judge read the scoped form as meeting it is not something these files answer. The run it failed is the one whose subject line begins <code>Fix</code> with no type, which the cap would account for, though a whole-rubric fail does not on its own name the criterion that carried it. Driftproof&rsquo;s ${D('three', gw.b.n_drawn, GR, 'results.cases[mode=baseline].generation.n_drawn', 'v', 'w')} baseline generations each begin <code>Fix password-reset links expiring</code> with no type (bundle calls ${GIT_BASELINE_CALLS.map((c) => D(c, 'Fix password-reset links expiring', `${BCMP}/driftproof-calls/${c}/stdout.jsonl`, 'Fix password-reset links expiring', 'contains')).join(', ')}), and its judge gave the reason <q>${D(gwReason, gwReason, GR, gwReason, 'quote')}</q>. Whether the Driftproof judge reads a scoped prefix the way the native judge did is not something this run asked it.</li>
      <li><strong>A different judge from Driftproof&rsquo;s reports.</strong> Both tools judged with <code>${D(gw.r.run.judge.model_id, gw.r.run.judge.model_id, GR, 'run.judge.model_id')}</code> (native: <code>${D(gw.n.suite.judgeModel, gw.n.suite.judgeModel, GN, 'suite.judgeModel')}</code>). The <a href="/judge-policy/">judge policy</a> fixes the judge for the reports Driftproof publishes at a model these runs did not use. This report departs from that policy, and its figures are not comparable with Reports 001 to 008.</li>
      <li><strong>Verification levels.</strong> The three Driftproof receipts are <code>${D(cr.r.verification_level, cr.r.verification_level, receiptRel(cr.slug), 'verification_level')}</code>, <code>${D(gw.r.verification_level, gw.r.verification_level, GR, 'verification_level')}</code> and <code>${D(da.r.verification_level, da.r.verification_level, receiptRel(da.slug), 'verification_level')}</code>, each validating with its receipt hash verified. The native figures are the native tool&rsquo;s own output files as the bundle carries them; this project did not re-run them.</li>
    </ul>
${cite('<x ' + [...Object.values(byS)].map(() => '').join('') + ' data-src="' + [
    ...rows.map((x) => receiptRel(x.slug)), ...rows.map((x) => nativeRel(x.slug)), ...rows.map((x) => traceRel(x.slug)), ...GIT_BASELINE_CALLS.map((c) => `${BCMP}/driftproof-calls/${c}/stdout.jsonl`), GW_RUBRIC,
  ].join('" data-src="') + '">')}
  </div>`;
  return html;
}

function setupSection(rows) {
  const R0 = receiptRel(rows[0].slug);
  const N0 = nativeRel(rows[0].slug);
  const P = pc('protocol.md');
  const upstream = /commit ([0-9a-f]{40})/.exec(readText(P))[1];
  const c0 = rows[0].c;
  const votes = c0.arms.with[0].graders.find((g) => g.name === 'criteria').judgeVotes.length;
  const threshold = /PASS if its score is at least ([0-9.]+)/.exec(c0.graders.find((g) => g.name === 'criteria').graderMarkdown)[1];
  // The effect floor, read from the runner source the full-plugin bundle carries (the
  // receipts do not record it), and refused if it is not the floor this renderer's
  // separation reading uses: a figure from one file and a rule from another would be
  // two floors.
  const floorText = new RegExp(FLOOR_RE).exec(readText(FLOOR_SRC))[1];
  if (Number(floorText) !== EFFECT_FLOOR) throw new Error(`the bundle's runner README states an effect floor of ${floorText}, and config.js holds ${EFFECT_FLOOR}`);
  const body = `  <h2 id="setup">What each tool measures here</h2>
  <div class="card">
    <p><strong>The inputs are shared.</strong> Three skills from <code>addyosmani/agent-skills</code> at commit <code>${D(upstream, upstream, P, 'commit ([0-9a-f]{40})', 're')}</code>: ${rows.map((x) => `<code>${esc(x.slug)}</code>`).join(', ')}. The SKILL.md bytes, the task prompt and the rubric are the same in both tools&rsquo; inputs; spec 034 checks the SKILL.md bytes against the upstream commit and the prompt and rubric text between the two inputs directories.</p>
    <p><strong>The native eval</strong> is Claude Code <code>${D(rows[0].n.claudeVersion, rows[0].n.claudeVersion, N0, 'claudeVersion')}</code> running each skill as a single-skill plugin, in a with-plugin arm and a without-plugin arm (<code>${D(rows[0].n.suite.ablation, rows[0].n.suite.ablation, N0, 'suite.ablation')}</code>). Each run is a real session: the model sees the plugin, can discover the skill and call the Skill tool, and has up to ${D(c0.maxTurns, c0.maxTurns, N0, 'cases[0].maxTurns')} turns. A <code>criteria</code> grader applies the rubric with the judge and returns PASS when the rubric score is at least ${D(threshold, threshold, N0, 'PASS if its score is at least ([0-9.]+)', 're')}, taking ${D(votes, votes, N0, 'cases[0].arms.with[0].graders[name=criteria].judgeVotes', 'len')} judge votes per run. An arm&rsquo;s score is the fraction of its runs that passed. A second grader, <code>skill-fired</code>, records whether the Skill tool was called; it is diagnostic and is not part of the score (<code>scored</code> is <code>${D(String(c0.arms.with[0].graders.find((g) => g.name === 'skill-fired').scored), c0.arms.with[0].graders.find((g) => g.name === 'skill-fired').scored, N0, 'cases[0].arms.with[0].graders[name=skill-fired].scored')}</code>).</p>
    <p><strong>Driftproof</strong> is runner <code>${D(rows[0].r.run.runner_version, rows[0].r.run.runner_version, R0, 'run.runner_version')}</code> on the <code>${D(rows[0].r.run.surface, rows[0].r.run.surface, R0, 'run.surface')}</code> surface. It scores the skill text in the prompt: the with-skill arm receives the SKILL.md with the task, the baseline arm receives the task alone, and neither has tools. It draws several generations per arm and the judge scores each one ${D(rows[0].r.run.judge.samples, rows[0].r.run.judge.samples, R0, 'run.judge.samples')} times on a continuous 0 to 1 scale against the same rubric. An arm&rsquo;s band is the mean of its draw means plus or minus the sample standard deviation across draws: a descriptive spread with no coverage probability. Two arms separate under the rule when their bands do not overlap and their means differ by at least the ${D(floorText, floorText, FLOOR_SRC, FLOOR_RE, 're')} effect floor; otherwise no separation is detected at the sample size used, which is not evidence that nothing differs.</p>
    <p><strong>So the native judge and the Driftproof judge read the same rubric in two ways</strong>: the native grader turns it into pass or fail at ${D(threshold, threshold, N0, 'PASS if its score is at least ([0-9.]+)', 're')}, and Driftproof keeps the score.</p>
${cite(`<x data-src="${P}" data-src="${N0}" data-src="${R0}" data-src="${FLOOR_SRC}">`)}
  </div>`;
  return body;
}

function tableSection(rows) {
  const tr = rows.map((x) => {
    const N = nativeRel(x.slug); const T = traceRel(x.slug); const R = receiptRel(x.slug);
    return `      <tr><td><code>${esc(x.slug)}</code></td>`
      + `<td>${D(x.nWithPass, x.nWithPass, N, 'cases[0].arms.with[*].passed', 'count-true')} of ${D(x.nWithRuns, x.nWithRuns, N, 'cases[0].arms.with[*]', 'count')}</td>`
      + `<td>${D(x.nWithoutPass, x.nWithoutPass, N, 'cases[0].arms.without[*].passed', 'count-true')} of ${D(x.nWithoutRuns, x.nWithoutRuns, N, 'cases[0].arms.without[*]', 'count')}</td>`
      + `<td>${D(n2(x.c.aggregates.delta), x.c.aggregates.delta, N, 'cases[0].aggregates.delta', 'v', 2)}</td>`
      + `<td>${D(x.firedMain, x.firedMain, N, 'cases[0].arms.with[*].graders[name=skill-fired].passed', 'count-true')} of ${D(x.nWithRuns, x.nWithRuns, N, 'cases[0].arms.with[*]', 'count')}; ${D(x.firedTrace, x.firedTrace, T, 'cases[0].arms.with[*].graders[name=skill-fired].passed', 'count-true')} of ${D(x.traceRuns, x.traceRuns, T, 'cases[0].arms.with[*]', 'count')}</td>`
      + `<td>${D(n3(x.w.mean), x.w.mean, R, 'results.cases[mode=with_skill].generation.mean', 'v', 3)} &plusmn; ${D(n3(x.w.sd), x.w.sd, R, 'results.cases[mode=with_skill].generation.sd', 'v', 3)} <span class="muted">(${D(x.w.n_drawn, x.w.n_drawn, R, 'results.cases[mode=with_skill].generation.n_drawn')} draws)</span></td>`
      + `<td>${D(n3(x.b.mean), x.b.mean, R, 'results.cases[mode=baseline].generation.mean', 'v', 3)} &plusmn; ${D(n3(x.b.sd), x.b.sd, R, 'results.cases[mode=baseline].generation.sd', 'v', 3)} <span class="muted">(${D(x.b.n_drawn, x.b.n_drawn, R, 'results.cases[mode=baseline].generation.n_drawn')} draws)</span></td>`
      + `<td>${D(n3(x.r.comparison.delta), x.r.comparison.delta, R, 'comparison.delta', 'v', 3)}</td>`
      + `<td>${D(x.separated ? 'separated' : 'no separation detected', x.separated ? 'separated' : 'not-separated', R, 'results.cases', 'rule')}</td></tr>`;
  }).join('\n');
  const table = `  <h2 id="comparison">The text-only comparison</h2>
  <table class="summary">
    <thead><tr><th>skill</th><th>native with plugin, runs passed</th><th>native without, runs passed</th><th>native delta</th><th>native skill-fired: comparison; supplement</th><th>Driftproof with skill, mean &plusmn; sd across draws</th><th>Driftproof baseline, mean &plusmn; sd across draws</th><th>Driftproof delta</th><th>Driftproof arms under the rule</th></tr></thead>
    <tbody>
${tr}
    </tbody>
  </table>`;
  return `${table}
  <p class="muted">A native delta is the with-plugin pass fraction minus the without-plugin pass fraction. A Driftproof delta is the with-skill mean minus the baseline mean, shown as context; the rule column is what the rule reads. The two deltas are on different scales and are not compared with each other.</p>
  ${cite(tr)}`;
}

function claimsSection(rows) {
  const byS = Object.fromEntries(rows.map((x) => [x.slug, x]));
  const cr = byS['code-review-and-quality'];
  const da = byS['documentation-and-adrs'];
  const gw = byS['git-workflow-and-versioning'];
  const CRN = nativeRel(cr.slug); const CRR = receiptRel(cr.slug);
  const DAN = nativeRel(da.slug); const DAT = traceRel(da.slug); const DAR = receiptRel(da.slug);
  const GWR = receiptRel(gw.slug);
  const splitRun = da.c.arms.without.findIndex((a) => a.passed);
  const splitVotes = da.c.arms.without[splitRun].graders.find((g) => g.name === 'criteria').explanation.replace(/^judge votes: /, '');
  const c1 = `  <p class="claim" data-claim="1"><strong>1. On <code>code-review-and-quality</code> the native delta is ${D(n2(cr.c.aggregates.delta), cr.c.aggregates.delta, CRN, 'cases[0].aggregates.delta', 'v', 2)}, while Driftproof&rsquo;s arms ${D('separate under the rule', 'separated', CRR, 'results.cases', 'rule')} on that one task.</strong> Both native arms passed ${D(cr.nWithPass, cr.nWithPass, CRN, 'cases[0].arms.with[*].passed', 'count-true')} of ${D(cr.nWithRuns, cr.nWithRuns, CRN, 'cases[0].arms.with[*]', 'count')} runs. Driftproof&rsquo;s with-skill band runs from ${D(n3(cr.w.mean - cr.w.sd), cr.w.mean - cr.w.sd, CRR, 'results.cases[mode=with_skill].generation.mean|results.cases[mode=with_skill].generation.sd', 'sub', 3)} to ${D(n3(cr.w.mean + cr.w.sd), cr.w.mean + cr.w.sd, CRR, 'results.cases[mode=with_skill].generation.mean|results.cases[mode=with_skill].generation.sd', 'add', 3)} and its baseline band from ${D(n3(cr.b.mean - cr.b.sd), cr.b.mean - cr.b.sd, CRR, 'results.cases[mode=baseline].generation.mean|results.cases[mode=baseline].generation.sd', 'sub', 3)} to ${D(n3(cr.b.mean + cr.b.sd), cr.b.mean + cr.b.sd, CRR, 'results.cases[mode=baseline].generation.mean|results.cases[mode=baseline].generation.sd', 'add', 3)}, so they do not overlap, and the means differ by ${D(n3(cr.r.comparison.delta), cr.r.comparison.delta, CRR, 'comparison.delta', 'v', 3)}, at least the effect floor. This is a separation detected under the rule on one task, not proof that the skill moved the score. Neither tool&rsquo;s result is read against the other&rsquo;s.</p>`;
  const c2 = `  <p class="claim" data-claim="2"><strong>2. The native eval&rsquo;s largest delta, ${D(n2(da.c.aggregates.delta), da.c.aggregates.delta, DAN, 'cases[0].aggregates.delta', 'v', 2)} on <code>documentation-and-adrs</code>, is on a skill whose skill-fired grader reads ${D(da.firedMain, da.firedMain, DAN, 'cases[0].arms.with[*].graders[name=skill-fired].passed', 'count-true')} of ${D(da.nWithRuns, da.nWithRuns, DAN, 'cases[0].arms.with[*]', 'count')} and ${D(da.firedTrace, da.firedTrace, DAT, 'cases[0].arms.with[*].graders[name=skill-fired].passed', 'count-true')} of ${D(da.traceRuns, da.traceRuns, DAT, 'cases[0].arms.with[*]', 'count')}.</strong> The Skill tool was not called in the three with-plugin runs of the comparison or in the one-run supplement. The with-plugin arm passed ${D(da.nWithPass, da.nWithPass, DAN, 'cases[0].arms.with[*].passed', 'count-true')} of ${D(da.nWithRuns, da.nWithRuns, DAN, 'cases[0].arms.with[*]', 'count')} runs and the without-plugin arm ${D(da.nWithoutPass, da.nWithoutPass, DAN, 'cases[0].arms.without[*].passed', 'count-true')} of ${D(da.nWithoutRuns, da.nWithoutRuns, DAN, 'cases[0].arms.without[*]', 'count')}, so the delta is ${D(da.nWithoutFail, da.nWithoutFail, DAN, 'cases[0].arms.without[*].passed', 'count-false')} baseline failures in ${D(da.nWithoutRuns, da.nWithoutRuns, DAN, 'cases[0].arms.without[*]', 'count')} runs, and the one baseline run that passed did so on the judge votes <code>${D(splitVotes, splitVotes, DAN, `cases[0].arms.without[${splitRun}].graders[name=criteria].explanation`, 'suffix')}</code>. With three runs per arm each run moves a pass fraction by a third. These files do not show what produced the difference.</p>`;
  const rCR = cr.b.sd / cr.w.sd; const rDA = da.b.sd / da.w.sd;
  const c3 = `  <p class="claim" data-claim="3"><strong>3. With-skill spread is well below baseline spread on two of the three skills, offered as an observation to test.</strong> On <code>code-review-and-quality</code> the sd across draws is ${D(n3(cr.w.sd), cr.w.sd, CRR, 'results.cases[mode=with_skill].generation.sd', 'v', 3)} with the skill and ${D(n3(cr.b.sd), cr.b.sd, CRR, 'results.cases[mode=baseline].generation.sd', 'v', 3)} without, a ratio of ${D(rCR.toFixed(1), rCR, CRR, 'results.cases[mode=baseline].generation.sd|results.cases[mode=with_skill].generation.sd', 'ratio', 1)}; on <code>documentation-and-adrs</code> it is ${D(n3(da.w.sd), da.w.sd, DAR, 'results.cases[mode=with_skill].generation.sd', 'v', 3)} and ${D(n3(da.b.sd), da.b.sd, DAR, 'results.cases[mode=baseline].generation.sd', 'v', 3)}, a ratio of ${D(rDA.toFixed(1), rDA, DAR, 'results.cases[mode=baseline].generation.sd|results.cases[mode=with_skill].generation.sd', 'ratio', 1)}. On <code>git-workflow-and-versioning</code> the pattern does not appear: the baseline sd is ${D(n3(gw.b.sd), gw.b.sd, GWR, 'results.cases[mode=baseline].generation.sd', 'v', 3)}, with every one of its draw means at ${D(n3(gw.b.draws[0].mean), gw.b.draws[0].mean, GWR, 'results.cases[mode=baseline].generation.draws[*].mean', 'all-equal', 3)}, and the with-skill sd ${D(n3(gw.w.sd), gw.w.sd, GWR, 'results.cases[mode=with_skill].generation.sd', 'v', 3)}. Each figure is from one case and three or four draws, so this is a pattern to test on more cases and more draws, not a finding.</p>`;
  const all = [c1, c2, c3].join('\n');
  return `  <h3 id="three-readings">Three readings</h3>
${all}
  ${cite(all)}`;
}

function fullPluginSection() {
  const N = pf('native/results/aggregate-result.json');
  const V = `${BFULL}/verification.json`;
  const M = `${BFULL}/manual-inspection.json`;
  const FX = `${BFULL}/suite/documentation-and-adrs/fixture.sh`;
  const ADR = `${BFULL}/workspaces/documentation-and-adrs/with-3/cwd/Documentation/Decisions/ADR-003-Email-Outbox.rst`;
  const P = pf('protocol.md');
  const n = readJson(N); const v = readJson(V); const m = readJson(M);
  const sessions = n.cases.reduce((a, c) => a + c.arms.with.length + c.arms.without.length, 0);
  const withS = n.cases.reduce((a, c) => a + c.arms.with.length, 0);
  const withoutS = n.cases.reduce((a, c) => a + c.arms.without.length, 0);
  const withPass = n.cases.reduce((a, c) => a + c.arms.with.filter((x) => x.passed).length, 0);
  const withoutPass = n.cases.reduce((a, c) => a + c.arms.without.filter((x) => x.passed).length, 0);
  const verified = v.runs.filter((r) => r.passed === true).length;
  const hookWith = v.runs.filter((r) => r.arm === 'with' && r.hook_context_records > 0).length;
  const hookWithN = v.runs.filter((r) => r.arm === 'with').length;
  const hookWithout = v.runs.filter((r) => r.arm === 'without' && r.hook_context_records > 0).length;
  const hookWithoutN = v.runs.filter((r) => r.arm === 'without').length;
  const adrRun = v.runs.find((r) => r.case === 'documentation-and-adrs' && r.arm === 'with' && r.original_temp === m.notes[0].original_workspace);
  const checks = Object.values(adrRun.checks);
  const checksTrue = checks.filter(Boolean).length;
  const adrText = readText(ADR);
  const quote = 'Both have been observed in practice';
  const line = adrText.split('\n').findIndex((l) => l.includes(quote)) + 1;
  const adrAt = `runs[case=documentation-and-adrs][arm=with][run=${adrRun.run}].checks.*`;
  const runsPer = n.cases[0].runsPerCase;
  const body = `  <h2 id="full-plugin">A separate run: the full plugin on tool-using tasks, native only</h2>
  <div class="card">
    <p>The second bundle records a different run with different tasks, reported here on its own and as a native-only functional check. Its tasks are not the tasks above and its figures are not comparable with them. The whole plugin was installed, version <code>${D(n.suite.plugins[0].version, n.suite.plugins[0].version, N, 'suite.plugins[0].version')}</code>, including its default SessionStart hook, and each of three tasks asked for real tool use in a small repository: review a working-tree change and write <code>review.md</code>, make atomic Git commits, and write an ADR in the repository&rsquo;s reStructuredText convention. Each task ran ${D(runsPer, runsPer, N, 'cases[0].runsPerCase')} times per arm. The graders were deterministic checks with no model judge, and a separate verification script read each session&rsquo;s Git history and files afterwards.</p>
    <p><strong>Every session passed.</strong> ${D(withPass + withoutPass, withPass + withoutPass, N, 'cases[*].arms.*[*].passed', 'count-true')} of ${D(sessions, sessions, N, 'cases[*].arms.*[*]', 'count')} sessions passed the native graders, ${D(withPass, withPass, N, 'cases[*].arms.with[*].passed', 'count-true')} of ${D(withS, withS, N, 'cases[*].arms.with[*]', 'count')} with the plugin and ${D(withoutPass, withoutPass, N, 'cases[*].arms.without[*].passed', 'count-true')} of ${D(withoutS, withoutS, N, 'cases[*].arms.without[*]', 'count')} without, and ${D(verified, verified, V, 'runs[*].passed', 'count-true')} of ${D(v.runs.length, v.runs.length, V, 'runs[*]', 'count')} passed the post-session verification. These checks record no difference between the arms on these tasks, and they were written as coarse functional checks, not as a measure of how much a skill helps.</p>
    <p><strong>The plugin&rsquo;s hook context is in every with-plugin trace.</strong> The verification records SessionStart hook context in ${D(hookWith, hookWith, V, 'runs[arm=with][*].hook_context_records', 'count-nonzero')} of ${D(hookWithN, hookWithN, V, 'runs[arm=with][*]', 'count')} with-plugin sessions and in ${D(hookWithout, hookWithout, V, 'runs[arm=without][*].hook_context_records', 'count-nonzero')} of ${D(hookWithoutN, hookWithoutN, V, 'runs[arm=without][*]', 'count')} without.</p>
    <p><strong>One ADR passed every structural check while asserting a history the fixture never supplied.</strong> In with-plugin session ${D(adrRun.run, adrRun.run, V, `runs[case=documentation-and-adrs][arm=with][original_temp=${adrRun.original_temp}].run`)} of the ADR task the verification passed ${D(checksTrue, checksTrue, V, adrAt, 'count-true')} of ${D(checks.length, checks.length, V, adrAt, 'count')} checks, and the ADR it wrote says at line ${D(line, line, ADR, quote, 'line-of')}: <q>${D(`${quote} with in-request`, `${quote} with in-request`, ADR, `${quote} with in-request`, 'quote')} sends</q>. The decision brief the fixture writes into the repository states ${D('no such observation', 'absent', FX, 'observed', 'absent')}, and the bundle&rsquo;s manual inspection records: <q>${D(m.notes[0].observation.split('. ').slice(-1)[0].replace(/\.$/, ''), m.notes[0].observation.split('. ').slice(-1)[0].replace(/\.$/, ''), M, m.notes[0].observation.split('. ').slice(-1)[0].replace(/\.$/, ''), 'quote')}</q>.</p>
${cite(`<x data-src="${N}" data-src="${V}" data-src="${ADR}" data-src="${FX}" data-src="${M}" data-src="${P}">`)}
  </div>`;
  return body;
}

function runRecordSection(rows) {
  const N0 = nativeRel(rows[0].slug);
  const SC = pc('SHA256SUMS'); const SF = pf('SHA256SUMS');
  const lines = (rel) => readText(rel).split('\n').filter(Boolean).length;
  const nFull = readJson(`${pf('native/results/aggregate-result.json')}`);
  const inner = `    <p>The comparison ran on ${D(rows[0].r.run.date_utc.slice(0, 10), rows[0].r.run.date_utc, receiptRel(rows[0].slug), 'run.date_utc', 'date')} by each receipt&rsquo;s <code>run.date_utc</code> (${rows.map((x) => `<code>${D(x.r.run.date_utc, x.r.run.date_utc, receiptRel(x.slug), 'run.date_utc')}</code>`).join(', ')}) and each native result&rsquo;s <code>startedAt</code> (${rows.map((x) => `<code>${D(x.n.startedAt, x.n.startedAt, nativeRel(x.slug), 'startedAt')}</code>`).join(', ')}). Those are start times; neither file records a finish. The full-plugin run started at <code>${D(nFull.startedAt, nFull.startedAt, `${pf('native/results/aggregate-result.json')}`, 'startedAt')}</code> on Claude Code <code>${D(nFull.claudeVersion, nFull.claudeVersion, `${pf('native/results/aggregate-result.json')}`, 'claudeVersion')}</code>.</p>
    <p><strong>Integrity.</strong> Each bundle carries a <code>SHA256SUMS</code> list, ${D(lines(SC), lines(SC), SC, '', 'lines')} lines for the comparison and ${D(lines(SF), lines(SF), SF, '', 'lines')} for the full-plugin run, and every file each bundle holds matches its list. The three SKILL.md files in both bundles match the upstream commit named above byte for byte. The files published beside this report are copied from the bundles unchanged and match the same lists. Receipt hashes: ${rows.map((x) => `<code>${esc(x.slug)}</code> <code>${D(x.r.receipt_hash.slice(0, 16), x.r.receipt_hash, receiptRel(x.slug), 'receipt_hash', 'prefix')}</code>`).join(', ')}.</p>
`;
  const body = `  <h2 id="run-record">Run record</h2>
  <div class="card">
${inner}
${cite(inner)}
  </div>`;
  return body;
}

function evidenceBlock() {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  };
  walk(PUB);
  const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
  return `  <h2 id="evidence">Published evidence</h2>
  <details class="card" open><summary><strong>The files this report makes public.</strong> The three Driftproof receipts with their summaries, the native tool&rsquo;s aggregate results, each run&rsquo;s protocol, and each bundle&rsquo;s SHA-256 list.</summary>
    <ul>
${files.map((f) => `      <li><code>${esc(f)}</code><br><span class="muted">sha256 <code>${D(sha(f), sha(f), f, '', 'sha256')}</code></span></li>`).join('\n')}
    </ul>
    <p class="muted">Validate a receipt with <code>npx driftproof validate &lt;file&gt;</code>. Each published copy is named for its path inside its bundle, with each <code>/</code> written as <code>--</code>; its sha256 is the one its bundle&rsquo;s <code>SHA256SUMS</code> lists for that path.</p>
  </details>`;
}

// THE AMENDMENTS SECTION (spec 039 A-039-4). A published report is amended by a
// dated entry beneath the frozen record, never by editing it (invariant 4). It
// sits after the Run record and before the evidence list, where Report 008 keeps
// its own, so that `splitReportBody` returns the body byte-identical. The
// section is the one part of the body `splitReportBody` in site-chrome.js returns
// apart, and the only part spec 039 AC-2 does not hold to the approved draft.
// Its figures are <data> elements like every other figure, read from the same
// files the table and claim 2 read.
const AMENDMENT_1_DATE = '2026-09-23';
function amendmentsSection(rows) {
  const fired = rows.map((x) => {
    const N = nativeRel(x.slug); const T = traceRel(x.slug);
    return `on <code>${esc(x.slug)}</code> ${D(x.firedMain, x.firedMain, N, 'cases[0].arms.with[*].graders[name=skill-fired].passed', 'count-true')} of ${D(x.nWithRuns, x.nWithRuns, N, 'cases[0].arms.with[*]', 'count')} and ${D(x.firedTrace, x.firedTrace, T, 'cases[0].arms.with[*].graders[name=skill-fired].passed', 'count-true')} of ${D(x.traceRuns, x.traceRuns, T, 'cases[0].arms.with[*]', 'count')}`;
  });
  const list = `${fired.slice(0, -1).join(', ')}, and ${fired[fired.length - 1]}`;
  const body = `    <p><strong>Amendment 1 &middot; ${AMENDMENT_1_DATE}</strong>. <strong>This entry corrects how the page&rsquo;s description is read against its body; no earlier text is changed, and no figure, claim, table value or receipt reference changes.</strong> The page&rsquo;s description, the text of its <code>description</code> and <code>og:description</code> meta tags, is its headline cut short: <em>&ldquo;Three skills from one plugin, one case each, measured by Claude Code&rsquo;s native plugin eval and by Driftproof, with the same SKILL.md bytes, task prompts and&hellip;&rdquo;</em>. Read alone, it can be taken to say that the model in every run of both tools was given the same SKILL.md.</p>
    <p><strong>What the body says.</strong> The setup section says that the SKILL.md bytes, the task prompt and the rubric are the same in both tools&rsquo; inputs. Driftproof puts the SKILL.md text in the with-skill arm&rsquo;s prompt. The native eval&rsquo;s with-plugin arm gives the model the plugin, from which it can discover the skill and call the Skill tool, and the <code>skill-fired</code> grader records whether it was called. For the comparison&rsquo;s with-plugin runs and then the supplement&rsquo;s, it reads ${list}, as the table gives. On <code>documentation-and-adrs</code> the Skill tool was not called in any with-plugin run, as claim 2 says.</p>
    <p><strong>How to read this page.</strong> Wherever the page&rsquo;s description, its headline or its summary card says the two tools ran with the same SKILL.md bytes, task prompts and rubrics, read it as the setup section states it: the same bytes in both tools&rsquo; inputs. It does not say that the Skill tool was called in every native with-plugin run; the table&rsquo;s <code>skill-fired</code> column says, per skill, in how many it was. The description&rsquo;s closing <em>and&hellip;</em> reads as the headline&rsquo;s <em>and rubrics</em>. This page&rsquo;s description, headline and summary card keep the sentence as published.</p>
    ${cite(list)}`;
  return `  <h2 id="amendments">Amendments</h2>
  <div class="card">
${body}
  </div>`;
}

function buildPage(rows) {
  const base = applyHeadTags(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof: Report 009, three skills under two eval harnesses</title>
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report">
  <h1>Report 009: three skills under two eval harnesses</h1>
  <p class="report-type">Instrument comparison report<span class="muted">. Nothing moves under the skill, and the thing that differs is the harness that measures it. The page follows the shared chrome and states its own reading rules in its limits and setup sections.</span></p>
  <div class="headline">
${headlineBlock(rows)}
  </div>

${limitsSection(rows)}

${setupSection(rows)}

${tableSection(rows)}

${claimsSection(rows)}

${fullPluginSection()}

${runRecordSection(rows)}

${amendmentsSection(rows)}

${evidenceBlock()}

  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report 009 · Instrument comparison report</span></footer>
</main>
</body>
</html>
`, PAGE_REL);
  const row = reportRow(NUMBER, { pageRel: `docs/${PAGE_REL}`, html: base });
  return renderReportPage(base, PAGE_REL, [row]);
}

function readRows() { return SKILLS.map(readSkill); }

function main() {
  const args = process.argv.slice(2);
  const page = buildPage(readRows());
  const out = path.join(OUT_DIR, 'index.html');
  if (args.includes('--page')) { process.stdout.write(page); return 0; }
  if (args.includes('--check')) {
    const onDisk = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    if (onDisk === page) { console.log('report 009: page matches its files'); return 0; }
    console.error('report 009: page has DRIFTED from its files');
    process.exitCode = 1;
    return 1;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, page);
  console.log(`  wrote docs/${PAGE_REL}`);
  return 0;
}

if (require.main === module) main();

module.exports = { SKILLS, readRows, buildPage, main, OUT_DIR, PAGE_REL, NUMBER, PUB };
