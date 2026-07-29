#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Build Report #001 from the emitted receipts. Everything rendered here is
// RE-DERIVED from receipts/report-001/*.json via the same band rule the runner
// uses (lib/diff) — the report never invents a verdict the receipts don't
// support (the gate spot-checks this). Emits:
//   - reports/report-001.md            (markdown mirror)
//   - docs/reports/001/index.html      (static HTML report page; docs/ is the
//     GitHub Pages branch-deploy folder)

// Public repo base for absolute links from the served site to files that live
// outside docs/ (receipts, suites). Relative links can't reach them once
// GitHub Pages serves docs/ as the site root.
const REPO_BLOB = 'https://github.com/driftproofhq/driftproof/blob/main';

// Report edition. Bumped when the published verdicts change for a reason readers
// must be told about (see AMENDMENTS). Rendered as a visible banner on the page.
const REPORT_VERSION = 'v1.1';
const REPORT_VERSION_DATE = '2026-07-28';

// Plain-language change log, newest first. Each entry: { version, date, points[] }.
// Shown verbatim in the "Amendments" section so nothing is corrected silently.
const AMENDMENTS = [
  {
    version: 'v1.1', date: '2026-07-28',
    summary: 'Pre-launch QA corrections. Net headline change: v1.0 read 4 regressed / 3 improved / 3 mixed / 0 within noise; v1.1 reads 3 regressed / 3 improved / 3 mixed / 1 within noise. Two causes, below.',
    points: [
      '<strong>(1) Minimum-effect floor of 0.05.</strong> A case is now called regressed/improved only when its two with_skill bands do not overlap AND the mean moved ≥ 0.05 (one judge-quantization step) — band separation alone is no longer sufficient, because the judge quantizes to a coarse grid and a confident grade often collapses to a zero-width point band. This reclassified 3 hair-trigger cases (|Δ| 0.014–0.024) to “within noise (below effect floor)”: <code>code-review-and-quality/security-axis-sql-injection</code> (which flips that whole skill REGRESSED → WITHIN NOISE), <code>naming-analyzer/misleading-name-mutation-js</code> (MIXED 2r/3i → 2r/2i), and <code>requesting-code-review/identify-base-head-shas</code> (IMPROVED 2 → 1).',
      '<strong>(2) Two artifact-contaminated receipts re-run.</strong> A transcript audit found new-model bands containing a judge parse-fallback score of exactly 0.0 (an unparseable judge reply defaults to 0, per lib/judge.js). Both <code>__claude-sonnet-5</code> receipts were re-run on the same claude-cli surface, n=5 (old-model receipts, which were clean, were kept as-is): <code>writing-clearly-and-concisely</code> and <code>documentation-and-adrs</code>.',
      '<strong>What the re-run showed.</strong> <code>active-voice-logging-passage</code>’s v1.0 “regression” was <em>entirely</em> the artifact — the clean re-run scores 0.862 (vs old 0.852), i.e. within noise. <code>match-existing-adr-convention</code> reconfirmed as a genuine new-model failure (~0.08 again on an independent run). Because a receipt covers all 7 of a skill’s cases, re-running also refreshed the other cases honestly: <code>comment-intent-not-implementation</code>’s v1.0 regression did not reproduce (now within noise), while two <em>different</em>, real regressions surfaced — <code>documentation-and-adrs/surface-conflicting-adr-conventions</code> (Δ−0.268) and <code>writing-clearly-and-concisely/concrete-language-incident-summary</code> (Δ−0.152). Both skills keep their v1.0 labels (MIXED and REGRESSED-1 respectively); only the driving cases changed.',
      'Full per-case transcript evidence and REAL-vs-artifact classifications are in <code>reports/report-001-audit.md</code>.',
    ],
  },
];

const fs = require('fs');
const path = require('path');
const { buildDriftReport } = require('../lib/diff');

const ROOT = path.join(__dirname, '..');
// DP_RECEIPTS overrides the receipts dir (used for smoke-testing the generator
// against synthetic receipts before a real run exists).
const RECEIPTS = process.env.DP_RECEIPTS ? path.resolve(process.env.DP_RECEIPTS) : path.join(ROOT, 'receipts', 'report-001');

function loadManifest() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', 'manifest.json'), 'utf8')); }
function readReceipt(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function b(mean, sd) { return `${mean.toFixed(3)} ± ${(sd || 0).toFixed(3)}`; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Compact per-skill verdict label from per-case band verdicts.
function skillVerdict(perCase) {
  const reg = perCase.filter((c) => c.verdict === 'regression').length;
  const imp = perCase.filter((c) => c.verdict === 'improvement').length;
  if (reg && imp) return { label: 'MIXED', klass: 'mixed', reg, imp };
  if (reg) return { label: `REGRESSED (${reg})`, klass: 'regressed', reg, imp };
  if (imp) return { label: `IMPROVED (${imp})`, klass: 'improved', reg, imp };
  return { label: 'WITHIN NOISE', klass: 'noise', reg, imp };
}

function collect() {
  const manifest = loadManifest();
  const skills = [];
  let pairNew, pairOld, judge, surface, samples, newDate, oldDate;

  for (const s of manifest.skills) {
    const newP = path.join(RECEIPTS, `${s.slug}__${manifest.model_pair.new}.json`);
    const oldP = path.join(RECEIPTS, `${s.slug}__${manifest.model_pair.old}.json`);
    if (!fs.existsSync(newP) || !fs.existsSync(oldP)) continue;
    const rNew = readReceipt(newP), rOld = readReceipt(oldP);
    const drift = buildDriftReport(rOld, rNew, { labelA: 'old', labelB: 'new' });
    pairNew = rNew.run.model_id; pairOld = rOld.run.model_id;
    newDate = rNew.run.model_release_date; oldDate = rOld.run.model_release_date;
    judge = (rNew.run.judge || {}).samples ? rNew.run.judge : { samples: 1 };
    surface = rNew.run.surface; samples = (rNew.run.judge || {}).samples || 1;

    // Borderline: any per-case outcome flagged borderline in either receipt.
    const borderline = [...rNew.results.cases, ...rOld.results.cases].filter((c) => c.outcome === 'borderline').length;

    skills.push({
      meta: s,
      new: rNew, old: rOld, drift,
      verdict: skillVerdict(drift.perCase),
      borderline,
      newWith: rNew.results.aggregates.with_skill,
      oldWith: rOld.results.aggregates.with_skill,
      newBase: rNew.results.aggregates.baseline,
      oldBase: rOld.results.aggregates.baseline,
      newFiles: { receipt: `${s.slug}__${manifest.model_pair.new}.json` },
      oldFiles: { receipt: `${s.slug}__${manifest.model_pair.old}.json` },
      driftFile: `${s.slug}__drift.md`,
    });
  }

  const totals = {
    count: skills.length,
    regressed: skills.filter((x) => x.verdict.reg && !x.verdict.imp).length,
    improved: skills.filter((x) => x.verdict.imp && !x.verdict.reg).length,
    mixed: skills.filter((x) => x.verdict.reg && x.verdict.imp).length,
    noise: skills.filter((x) => !x.verdict.reg && !x.verdict.imp).length,
    movedCases: skills.reduce((a, x) => a + x.verdict.reg + x.verdict.imp, 0),
    regCases: skills.reduce((a, x) => a + x.verdict.reg, 0),
    impCases: skills.reduce((a, x) => a + x.verdict.imp, 0),
  };
  return { manifest, skills, totals, pair: { new: pairNew, old: pairOld, newDate, oldDate }, judge, surface, samples };
}

// ── Markdown ──────────────────────────────────────────────────────────────
function renderMarkdown(d) {
  const L = [];
  const movedSkills = d.totals.regressed + d.totals.improved + d.totals.mixed;
  L.push('<!-- SPDX-License-Identifier: Apache-2.0 -->');
  L.push('# Driftproof Report #001 — do skill verdicts hold across a model release?');
  L.push('');
  L.push(`> **${REPORT_VERSION}** (${REPORT_VERSION_DATE}) — supersedes v1.0 after a pre-launch QA pass: a 0.05 effect floor was added and two artifact-contaminated receipts were re-run. See [Amendments](#amendments).`);
  L.push('');
  L.push(`**Model pair:** \`${d.pair.new}\`${d.pair.newDate ? ` (released ${d.pair.newDate})` : ''} vs \`${d.pair.old}\`${d.pair.oldDate ? ` (released ${d.pair.oldDate})` : ''}`);
  L.push(`**Judge:** \`${d.judge.model_id || d.manifest.judge_model}\`, ${d.samples} samples/case, ${d.judge.sampling || 'surface-controlled'} · **Surface:** ${d.surface} · **Skills:** ${d.totals.count}`);
  L.push('');
  L.push('## Headline');
  L.push('');
  L.push(`**${movedSkills} of ${d.totals.count} skills moved beyond noise** on this model pair (per-case bands do not overlap): ` +
    `${d.totals.regressed} regressed, ${d.totals.improved} improved, ${d.totals.mixed} mixed; ${d.totals.noise} within noise. ` +
    `Across all cases: ${d.totals.regCases} regression(s), ${d.totals.impCases} improvement(s).`);
  L.push('');
  L.push('A verdict is claimed for a case **only** when BOTH conditions hold: (1) the two `with_skill` confidence bands (mean ± stddev over the judge samples) do not overlap, AND (2) the mean moved by at least the **effect floor of 0.05** (one judge-quantization step). Overlapping bands — or separated bands whose move is below the floor — are reported as *within noise* — never as drift. This is the whole point: the number is allowed to say "nothing moved."');
  L.push('');
  L.push('## Per-skill summary');
  L.push('');
  L.push('| skill | source | with_skill (old → new) | baseline (old → new) | verdict |');
  L.push('|---|---|---|---|---|');
  for (const s of d.skills) {
    L.push(`| \`${s.meta.slug}\` | [${s.meta.author}](${s.meta.repo}) · ${s.meta.license} | ${b(s.oldWith.mean_score, s.oldWith.stddev)} → ${b(s.newWith.mean_score, s.newWith.stddev)} | ${s.oldBase.mean_score.toFixed(3)} → ${s.newBase.mean_score.toFixed(3)} | ${s.verdict.label}${s.borderline ? ' ⚠bl' : ''} |`);
  }
  L.push('');
  for (const s of d.skills) {
    L.push(`### \`${s.meta.slug}\` — ${s.meta.name}`);
    L.push('');
    L.push(`${s.meta.description}`);
    L.push('');
    L.push(`- **Source:** [${s.meta.repo}](${s.meta.repo}) @ \`${s.meta.repo_sha.slice(0, 10)}\` · **License:** ${s.meta.license} · **Author:** ${s.meta.author}`);
    L.push(`- **Verdict:** ${s.verdict.label}`);
    L.push(`- **Receipts:** [\`${s.oldFiles.receipt}\`](../receipts/report-001/${s.oldFiles.receipt}) (old) · [\`${s.newFiles.receipt}\`](../receipts/report-001/${s.newFiles.receipt}) (new) · [drift](../receipts/report-001/${s.driftFile})`);
    L.push('');
    L.push(`| | \`${d.pair.old}\` (old) | \`${d.pair.new}\` (new) |`);
    L.push('|---|---|---|');
    L.push(`| with_skill (mean ± sd) | ${b(s.oldWith.mean_score, s.oldWith.stddev)} | ${b(s.newWith.mean_score, s.newWith.stddev)} |`);
    L.push(`| baseline (mean ± sd) | ${b(s.oldBase.mean_score, s.oldBase.stddev)} | ${b(s.newBase.mean_score, s.newBase.stddev)} |`);
    L.push('');
    L.push('| case | old (mean ± sd) | new (mean ± sd) | Δ | verdict |');
    L.push('|---|---|---|---|---|');
    for (const c of s.drift.perCase) {
      const v = c.verdict === 'regression' ? '🔻 regressed' : c.verdict === 'improvement' ? '🔼 improved' : c.verdict === 'within noise (below effect floor)' ? 'within noise (below floor)' : 'within noise';
      L.push(`| \`${c.id}\` | ${c.before ? b(c.before.mean, c.before.stddev) : 'n/a'} | ${c.after ? b(c.after.mean, c.after.stddev) : 'n/a'} | ${c.delta == null ? 'n/a' : (c.delta >= 0 ? '+' : '') + c.delta.toFixed(3)} | ${v} |`);
    }
    L.push('');
  }
  L.push(methodologyMd(d));
  L.push('');
  L.push('## Amendments');
  L.push('');
  for (const a of AMENDMENTS) {
    L.push(`**${a.version}** · ${a.date} — ${a.summary}`);
    L.push('');
    for (const p of a.points) L.push(`- ${p.replace(/<\/?(strong|code|em)>/g, '`').replace(/``/g, '')}`);
    L.push('');
  }
  return L.join('\n') + '\n';
}

function methodologyMd(d) {
  return [
    '## Methodology',
    '',
    `- **Sampling.** Each (case, mode) generation is judged **${d.samples}** times; the per-case band is mean ± sample stddev over those ${d.samples} judge scores. A regression/improvement is claimed only when two \`with_skill\` bands are fully separated (\`mean_new + sd_new < mean_old − sd_old\`, or symmetric).`,
    `- **Judge.** \`${d.judge.model_id || d.manifest.judge_model}\`. Sampling mode: \`${d.judge.sampling || 'surface-controlled'}\`. On the \`api\` surface the judge is pinned to temperature 0; **this report ran on the \`${d.surface}\` surface**, where sampling parameters are surface-controlled and cannot be pinned — the receipts record this honestly in \`run.judge\`. Judge variance is therefore real, which is exactly why verdicts require band separation rather than a raw score delta.`,
    '- **Text-only scoping.** Report #001 tests skills whose value shows up in **text** (review, commit, documentation, prose, naming, planning conventions). Skills that need code/binary execution (docx/pptx/pdf renderers, diagram/asset generators, browser/CLI tools) are out of scope — they need a sandboxed-execution harness, noted as future work. Each skill is supplied as its single `SKILL.md`; bundled reference files loaded on demand are out of scope, and skills whose value lives entirely in bundled files were excluded.',
    '- **Suite authorship (disclosure).** *We wrote the eval suites*, one per skill, each case grounded in a claim documented in that skill\'s own `SKILL.md`. Suites are versioned in [`suites/`](../suites/). Rubrics anchor a fully-correct answer at 0.80 (higher only for exemplary work) so a competent `with_skill` run is not saturated and a regression can show. We do not commit third-party skill content: each `SKILL.md` is fetched at run time from its pinned commit and verified by sha256 (see [`suites/manifest.json`](../suites/manifest.json)).',
    '- **Baseline.** Same prompt, no `SKILL.md`. The lift (with_skill − baseline) is reported but the drift verdict is about the `with_skill` side across models, not the lift.',
    '',
    '## Reproduce (three commands)',
    '',
    '```bash',
    'node scripts/fetch-skills.js                        # fetch pinned SKILL.md files (sha256-verified) into an untracked workdir',
    `node scripts/run-report-001.js --concurrency 5     # run both models × with/baseline, emit v0.2 receipts`,
    'node scripts/build-report-001.js                   # re-derive this report from the receipts',
    '```',
    '',
    '_Provider: `CLAUDE_PROVIDER=cli` (subscription) or `=api` (metered; needs `ANTHROPIC_API_KEY`). Receipts validate against receipt spec v0.2; every verdict above is a function of the two `with_skill` bands in the receipts._',
  ].join('\n');
}

// ── HTML ──────────────────────────────────────────────────────────────────
function renderHtml(d) {
  const movedSkills = d.totals.regressed + d.totals.improved + d.totals.mixed;
  const rows = d.skills.map((s) => `      <tr>
        <td><code>${esc(s.meta.slug)}</code></td>
        <td><a href="${esc(s.meta.repo)}">${esc(s.meta.author)}</a> · ${esc(s.meta.license)}</td>
        <td>${b(s.oldWith.mean_score, s.oldWith.stddev)} → ${b(s.newWith.mean_score, s.newWith.stddev)}</td>
        <td>${s.oldBase.mean_score.toFixed(3)} → ${s.newBase.mean_score.toFixed(3)}</td>
        <td><span class="v v-${s.verdict.klass}">${esc(s.verdict.label)}</span></td>
      </tr>`).join('\n');

  const sections = d.skills.map((s) => {
    const caseRows = s.drift.perCase.map((c) => {
      const cls = c.verdict === 'regression' ? 'v-regressed' : c.verdict === 'improvement' ? 'v-improved' : 'v-noise';
      const label = c.verdict === 'regression' ? 'regressed' : c.verdict === 'improvement' ? 'improved' : c.verdict === 'within noise (below effect floor)' ? 'within noise (below floor)' : 'within noise';
      return `        <tr><td><code>${esc(c.id)}</code></td><td>${c.before ? b(c.before.mean, c.before.stddev) : 'n/a'}</td><td>${c.after ? b(c.after.mean, c.after.stddev) : 'n/a'}</td><td>${c.delta == null ? 'n/a' : (c.delta >= 0 ? '+' : '') + c.delta.toFixed(3)}</td><td><span class="v ${cls}">${label}</span></td></tr>`;
    }).join('\n');
    return `    <section class="skill" id="${esc(s.meta.slug)}">
      <h3><code>${esc(s.meta.slug)}</code> — ${esc(s.meta.name)} <span class="v v-${s.verdict.klass}">${esc(s.verdict.label)}</span></h3>
      <p>${esc(s.meta.description)}</p>
      <p class="src">Source: <a href="${esc(s.meta.repo)}">${esc(s.meta.repo)}</a> @ <code>${esc(s.meta.repo_sha.slice(0, 10))}</code> · License: ${esc(s.meta.license)} · Author: ${esc(s.meta.author)}<br>
      Receipts: <a href="${REPO_BLOB}/receipts/report-001/${esc(s.oldFiles.receipt)}">old</a> · <a href="${REPO_BLOB}/receipts/report-001/${esc(s.newFiles.receipt)}">new</a> · <a href="${REPO_BLOB}/receipts/report-001/${esc(s.driftFile)}">drift</a></p>
      <table class="agg"><thead><tr><th></th><th><code>${esc(d.pair.old)}</code> (old)</th><th><code>${esc(d.pair.new)}</code> (new)</th></tr></thead>
      <tbody>
        <tr><td>with_skill (mean ± sd)</td><td>${b(s.oldWith.mean_score, s.oldWith.stddev)}</td><td>${b(s.newWith.mean_score, s.newWith.stddev)}</td></tr>
        <tr><td>baseline (mean ± sd)</td><td>${b(s.oldBase.mean_score, s.oldBase.stddev)}</td><td>${b(s.newBase.mean_score, s.newBase.stddev)}</td></tr>
      </tbody></table>
      <table class="cases"><thead><tr><th>case</th><th>old (mean ± sd)</th><th>new (mean ± sd)</th><th>Δ</th><th>verdict</th></tr></thead>
      <tbody>
${caseRows}
      </tbody></table>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof Report #001</title>
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="https://github.com/driftproofhq/driftproof">GitHub</a></nav></header>
<main class="report">
  <h1>Report #001 — do skill verdicts hold across a model release?</h1>
  <p class="version-note" style="margin:0 0 1rem;padding:.5rem .75rem;border-left:3px solid #62C7EF;background:rgba(98,199,239,.08);font-size:.95rem"><strong>${esc(REPORT_VERSION)}</strong> (${esc(REPORT_VERSION_DATE)}) — this edition supersedes v1.0 after a pre-launch QA pass. A 0.05 effect floor was added and two artifact-contaminated receipts were re-run; see <a href="#amendments">Amendments</a>.</p>
  <p class="pair"><strong>Model pair:</strong> <code>${esc(d.pair.new)}</code>${d.pair.newDate ? ` (released ${esc(d.pair.newDate)})` : ''} vs <code>${esc(d.pair.old)}</code>${d.pair.oldDate ? ` (released ${esc(d.pair.oldDate)})` : ''}<br>
  <strong>Judge:</strong> <code>${esc(d.judge.model_id || d.manifest.judge_model)}</code>, ${d.samples} samples/case (${esc(d.judge.sampling || 'surface-controlled')}) · <strong>Surface:</strong> ${esc(d.surface)} · <strong>Skills:</strong> ${d.totals.count}</p>

  <div class="headline">
    <p class="big"><strong>${movedSkills} of ${d.totals.count} skills moved beyond noise</strong> on this model pair.</p>
    <p>${d.totals.regressed} regressed · ${d.totals.improved} improved · ${d.totals.mixed} mixed · ${d.totals.noise} within noise — across ${d.totals.regCases} case regression(s) and ${d.totals.impCases} case improvement(s). A verdict is claimed only when BOTH (1) two <code>with_skill</code> bands (mean ± stddev over judge samples) do <em>not</em> overlap AND (2) the mean moves at least the <strong>0.05 effect floor</strong>; bands that overlap, or separate by less than the floor, are reported as <em>within noise</em>, never as drift.</p>
  </div>

  <h2>Per-skill summary</h2>
  <table class="summary"><thead><tr><th>skill</th><th>source</th><th>with_skill (old → new)</th><th>baseline (old → new)</th><th>verdict</th></tr></thead>
  <tbody>
${rows}
  </tbody></table>

${sections}

  <h2>Methodology</h2>
  <ul class="method">
    <li><strong>Sampling &amp; effect floor.</strong> Each (case, mode) generation is judged ${d.samples} times; the per-case band is mean ± sample stddev over those scores. A regression/improvement is claimed only when two <code>with_skill</code> bands are fully separated <em>and</em> the mean moved by at least the <strong>0.05 effect floor</strong>. The floor exists because the judge quantizes to a coarse ~0.05–0.1 grid, so a confident grade often collapses to a zero-width “point band”; without the floor, two point bands one quantum apart (e.g. 0.60 vs 0.64) would read as a verdict despite no meaningful change.</li>
    <li><strong>Judge.</strong> <code>${esc(d.judge.model_id || d.manifest.judge_model)}</code>, sampling mode <code>${esc(d.judge.sampling || 'surface-controlled')}</code>. On the <code>api</code> surface the judge is pinned to temperature 0; this report ran on the <code>${esc(d.surface)}</code> surface, where sampling is surface-controlled and cannot be pinned (recorded honestly in <code>run.judge</code>). That residual judge variance is exactly why verdicts require band separation, not a raw delta.</li>
    <li><strong>Text-only scoping.</strong> Report #001 tests skills whose value shows up in text (review, commit, documentation, prose, naming, planning). Tool-execution skills (document renderers, diagram/asset generators, browser/CLI tools) are out of scope — future work, needing a sandboxed-execution harness. Each skill is supplied as its single <code>SKILL.md</code>; bundled reference files are out of scope, and skills whose value lives entirely in bundled files were excluded.</li>
    <li><strong>Suite authorship (disclosure).</strong> <em>We wrote the eval suites</em>, one per skill, each case grounded in a claim documented in that skill's own <code>SKILL.md</code>. Rubrics anchor a fully-correct answer at 0.80 so a competent run is not saturated and a regression can show. Third-party skill content is not committed: each <code>SKILL.md</code> is fetched at run time from its pinned commit and sha256-verified.</li>
    <li><strong>Baseline.</strong> Same prompt, no <code>SKILL.md</code>.</li>
  </ul>

  <h2>Reproduce</h2>
  <pre><code>node scripts/fetch-skills.js
node scripts/run-report-001.js --concurrency 5
node scripts/build-report-001.js</code></pre>

  <h2 id="amendments">Amendments</h2>
  ${AMENDMENTS.map((a) => `<div class="amendment">
    <p><strong>${esc(a.version)}</strong> · ${esc(a.date)} — ${esc(a.summary)}</p>
    <ul>
${a.points.map((p) => `      <li>${p}</li>`).join('\n')}
    </ul>
  </div>`).join('\n')}

  <p class="foot">Receipts validate against Driftproof receipt spec v0.2. Every verdict above is a function of the two <code>with_skill</code> bands recorded in the receipts. Verdicts age because the substrate moves — that is the phenomenon this report measures.</p>
</main>
<footer class="site"><p>Driftproof · Apache-2.0 · <a href="https://github.com/driftproofhq/driftproof">github.com/driftproofhq/driftproof</a></p></footer>
</body>
</html>
`;
}

function main() {
  if (!fs.existsSync(RECEIPTS)) { console.error(`no receipts at ${RECEIPTS}; run scripts/run-report-001.js first`); process.exit(1); }
  const d = collect();
  if (!d.skills.length) { console.error('no complete skill receipt pairs found'); process.exit(1); }

  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports', 'report-001.md'), renderMarkdown(d));

  const htmlDir = path.join(ROOT, 'docs', 'reports', '001');
  fs.mkdirSync(htmlDir, { recursive: true });
  fs.writeFileSync(path.join(htmlDir, 'index.html'), renderHtml(d));

  console.log(`Report #001 built: ${d.skills.length} skills, ${d.totals.regressed} regressed / ${d.totals.improved} improved / ${d.totals.mixed} mixed / ${d.totals.noise} within noise.`);
  console.log('  → reports/report-001.md');
  console.log('  → docs/reports/001/index.html');
}

main();
