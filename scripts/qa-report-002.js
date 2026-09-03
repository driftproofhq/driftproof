// SPDX-License-Identifier: Apache-2.0
// One-shot QA dump for Report #002 real-run receipts. Findings only — reads the
// live draft receipts, writes reports/report-002-qa.md, echoes to stdout.
'use strict';
const fs = require('fs'), path = require('path');
const { EFFECT_FLOOR } = require('../config');
const { deltaPer1kTokens } = require('../lib/skillCost');
const { durabilityVerdict } = require('./prepare-report-002');

const DIR = 'receipts/report-002';
const CLAUDE = 'claude-sonnet-5', GPT = 'gpt-5.6-sol';
const FLOOR = EFFECT_FLOOR;

function load(slug, model) {
  const p = path.join(DIR, `${slug}__${model}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
// discover skills from files
const slugs = [...new Set(fs.readdirSync(DIR).filter(f => f.endsWith('.json'))
  .map(f => f.replace(/__(claude-sonnet-5|gpt-5\.6-sol)\.json$/, '')))].sort();

// Durability verdicts come from the report's own durabilityVerdict() (imported),
// so this QA dump re-derives exactly what the draft shows — no parallel rule.
const f3 = n => (n == null ? 'n/a' : (n >= 0 ? '+' : '') + n.toFixed(3));
const p3 = n => (n == null ? 'n/a' : n.toFixed(3));

const rows = [];
for (const slug of slugs) {
  const rC = load(slug, CLAUDE), rG = load(slug, GPT);
  const side = (r) => {
    if (!r) return null;
    const inc = r.run.status === 'incomplete';
    const a = r.results.aggregates;
    const d = r.comparison.delta;
    return {
      inc, failed: r.run.failed_case_count || 0, tokens: r.skill.tokens,
      wMean: a.with_skill.mean_score, wSd: a.with_skill.stddev,
      bMean: a.baseline.mean_score, bSd: a.baseline.stddev,
      delta: d, vpt: deltaPer1kTokens(d, r.skill.tokens),
      cases: r.results.cases, surface: r.run.surface,
    };
  };
  const C = side(rC), G = side(rG);
  const incomplete = (C && C.inc) || (G && G.inc);
  const dv = incomplete ? { label: 'NOT MEASURED', lowRes: false } : durabilityVerdict(rC, rG);
  rows.push({ slug, C, G, verdict: dv.label + (dv.lowRes ? ' † low-res' : '') });
}

const out = [];
const say = s => out.push(s);

say('# Report #002 — QA dump (findings only, no publishing)');
say('');
say(`Generated from live real-run receipts in \`${DIR}\`. Substrates: **${CLAUDE}** (claude-cli, anthropic) vs **${GPT}** (openai-cli, codex). Judge: claude-haiku-4-5. Effect floor: **${FLOOR}**.`);
say('');

// (a) verdict rule
say('## (a) Durability verdict rule — as implemented (Report #001-aligned)');
say('');
say('Source: `scripts/prepare-report-002.js` `durabilityVerdict()` + `substrateDirection()`; floor `config.EFFECT_FLOOR = ' + FLOOR + '`.');
say('');
say('Per substrate, the direction is the **tally of per-case verdicts** (NOT the aggregate mean delta). A case counts as improved/regressed only when BOTH:');
say('- its `with_skill` and `baseline` bands (mean ± stddev over the 5 judge samples) do **not** overlap, AND');
say('- `|with.mean − baseline.mean| ≥ 0.05` (the effect floor).');
say('');
say('This is the same anti-cry-wolf discipline as Report #001 (there the two bands are old-model vs new-model with_skill; here with_skill vs baseline within one substrate). The aggregate Δ is reported only as context. Per-substrate direction:');
say('- ≥1 regressed case, 0 improved → **hurt**; ≥1 improved, 0 regressed → **help**; both → **mixed**; neither → **flat**.');
say('');
say('A driving case (one that separates + clears the floor) whose with_skill or baseline band is **zero-width** (all 5 samples identical) marks the verdict **low-resolution: judge quantization** — the effect is a clean grid-step the floor still gates, but grid-limited. The verdict stands; it is flagged, not suppressed.');
say('');
say('Cross-substrate label from the (Claude, GPT) pair of directions:');
say('- either substrate purely **hurt** → `REGRESSES on <who>` (names Claude &/or GPT)');
say('- both **help** → `DURABLE`');
say('- both **flat** → `NO EFFECT`');
say('- otherwise (help/flat, or any `mixed` without a pure-hurt side) → `SUBSTRATE-DEPENDENT`');
say('- either receipt `run.status === "incomplete"` → **NOT MEASURED** (no band fabricated from a partial sample set; excluded from all four verdicts).');
say('');

// (b) per-skill table
say('## (b) Per-skill table — both substrates');
say('');
say('| Skill | tokens | Claude with ±sd | Claude base ±sd | Δ Claude | GPT with ±sd | GPT base ±sd | Δ GPT | Verdict |');
say('|---|--:|---|---|--:|---|---|--:|---|');
for (const r of rows) {
  const cw = r.C ? (r.C.inc ? 'INCOMPLETE' : `${p3(r.C.wMean)} ± ${p3(r.C.wSd)}`) : '—';
  const cb = r.C ? (r.C.inc ? '—' : `${p3(r.C.bMean)} ± ${p3(r.C.bSd)}`) : '—';
  const cd = r.C && !r.C.inc ? f3(r.C.delta) : '—';
  const gw = r.G ? (r.G.inc ? 'INCOMPLETE' : `${p3(r.G.wMean)} ± ${p3(r.G.wSd)}`) : '—';
  const gb = r.G ? (r.G.inc ? '—' : `${p3(r.G.bMean)} ± ${p3(r.G.bSd)}`) : '—';
  const gd = r.G && !r.G.inc ? f3(r.G.delta) : '—';
  say(`| \`${r.slug}\` | ${r.C ? r.C.tokens : (r.G ? r.G.tokens : '?')} | ${cw} | ${cb} | ${cd} | ${gw} | ${gb} | ${gd} | ${r.verdict} |`);
}
say('');

// (c) harness-suppression
say('## (c) Harness-suppression check (GPT / codex preamble)');
say('');
say('Hypothesis: the codex CLI\'s ~12–15k-token preamble could swamp the SKILL.md signal, making every GPT delta collapse to ~0 (a harness artifact), rather than reflecting real per-skill substrate behavior. Uniform near-zero GPT deltas = suspicious; a mix of real +/−/0 = substrate-real.');
say('');
say('| Skill | Δ GPT | |Δ|<floor? | Δ Claude (compare) | GPT base mean | Claude base mean |');
say('|---|--:|:--:|--:|--:|--:|');
let gptFlat = 0, gptMoved = 0;
const gBases = [], cBases = [];
for (const r of rows) {
  if (!r.G || r.G.inc || !r.C || r.C.inc) { say(`| \`${r.slug}\` | ${r.G && !r.G.inc ? f3(r.G.delta) : 'n/a'} | — | ${r.C && !r.C.inc ? f3(r.C.delta) : 'n/a'} | ${r.G && !r.G.inc ? p3(r.G.bMean) : 'n/a'} | ${r.C && !r.C.inc ? p3(r.C.bMean) : 'n/a'} |`); continue; }
  const flat = Math.abs(r.G.delta) < FLOOR;
  if (flat) gptFlat++; else gptMoved++;
  gBases.push(r.G.bMean); cBases.push(r.C.bMean);
  say(`| \`${r.slug}\` | ${f3(r.G.delta)} | ${flat ? 'YES' : 'no'} | ${f3(r.C.delta)} | ${p3(r.G.bMean)} | ${p3(r.C.bMean)} |`);
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
say('');
say(`GPT deltas: **${gptFlat} flat (|Δ|<${FLOOR}) / ${gptMoved} moved** (of ${gptFlat + gptMoved} measured pairs).`);
say(`Verdict on the pattern: **${gptMoved >= 2 ? 'MIXED — substrate-real signal present' : 'UNIFORM NEAR-ZERO — suspicious of preamble suppression'}** (${gptMoved} skills clear the floor on GPT${gptMoved ? '; suppression would force all to ~0' : ''}).`);
say(`Baseline levels: GPT mean baseline **${p3(mean(gBases))}** vs Claude mean baseline **${p3(mean(cBases))}** across ${gBases.length} skills. ${mean(gBases) < mean(cBases) - 0.03 ? 'GPT baselines run LOWER — more headroom for a skill to help, so flat GPT deltas are NOT explained by ceiling saturation.' : mean(gBases) > mean(cBases) + 0.03 ? 'GPT baselines run HIGHER — less headroom; flat GPT deltas may partly reflect ceiling.' : 'GPT and Claude baselines are comparable.'}`);
say('');

// (d) judge vs deterministic checks
say('## (d) Judge vs deterministic post-checks — disagreements (verbatim)');
say('');
say('A disagreement = a case that carries deterministic `checks[]` where the checks verdict (all-pass) diverges from the judge outcome (pass/borderline/fail). Judge outcome derives from mean score vs threshold.');
say('');
let disagreements = 0, checkedCases = 0;
const dlines = [];
for (const r of rows) {
  for (const side of ['C', 'G']) {
    const S = r[side]; if (!S) continue;
    const sub = side === 'C' ? CLAUDE : GPT;
    for (const c of S.cases) {
      if (!Array.isArray(c.checks) || !c.checks.length) continue;
      checkedCases++;
      const allPass = c.checks.every(k => k.pass);
      const judgePass = c.outcome === 'pass';
      if (allPass !== judgePass) {
        disagreements++;
        const failedChecks = c.checks.filter(k => !k.pass).map(k => `${k.name}[${k.kind}]`).join(', ') || '(all checks pass)';
        dlines.push(`- \`${r.slug}\` / ${sub} / \`${c.id}\` (${c.mode}): checks=${allPass ? 'ALL PASS' : 'FAIL: ' + failedChecks} · judge=**${c.outcome}** (score ${p3(c.score)}, thr ${p3(c.threshold)})`);
        dlines.push(`  - judge reason: ${JSON.stringify(c.reason || '').slice(0, 300)}`);
      }
    }
  }
}
say(`Cases carrying deterministic checks: **${checkedCases}**. Disagreements: **${disagreements}**.`);
say('');
for (const l of dlines) say(l);
if (!disagreements) say('_None — every checked case\'s judge outcome agrees with its deterministic checks._');
say('');

// (e) zero-variance & saturation
say('## (e) Zero-variance and saturation rows (Report #001 QA criteria)');
say('');
say('Report #001 QA criteria applied here:');
say('- **Effect floor 0.05** — a lift below one judge-quantization step is "no effect", never a pass (already gates every verdict above).');
say('- **Zero-width / point band** — all 5 judge samples identical (stddev 0): a confident grade collapsed to a zero-width band; band-separation alone would be misleading, floor still governs.');
say('- **Saturation / ceiling** — mean at/near 1.0 (≥0.95) or floor (≤0.05): little headroom, so a small delta is expected and not evidence of no skill value.');
say('');
say('**Zero-variance case-bands (stddev = 0 over 5 samples):**');
let zv = 0;
for (const r of rows) {
  for (const side of ['C', 'G']) {
    const S = r[side]; if (!S) continue;
    const sub = side === 'C' ? CLAUDE : GPT;
    for (const c of S.cases) {
      if (!Array.isArray(c.samples) || c.case_status === 'failed_timeout') continue;
      if (c.stddev === 0) { zv++; say(`- \`${r.slug}\` / ${sub} / \`${c.id}\` (${c.mode}): all samples = ${c.samples[0]} → point band at ${p3(c.mean)}`); }
    }
  }
}
if (!zv) say('- _none_');
say('');
say('**Saturation rows (aggregate mean ≥ 0.95 or ≤ 0.05):**');
let sat = 0;
for (const r of rows) {
  for (const side of ['C', 'G']) {
    const S = r[side]; if (!S || S.inc) continue;
    const sub = side === 'C' ? CLAUDE : GPT;
    for (const [lab, m] of [['with_skill', S.wMean], ['baseline', S.bMean]]) {
      if (m >= 0.95 || m <= 0.05) { sat++; say(`- \`${r.slug}\` / ${sub} / ${lab}: mean ${p3(m)} (${m >= 0.95 ? 'ceiling' : 'floor'})`); }
    }
  }
}
if (!sat) say('- _none at the 0.95/0.05 thresholds_');
say('');

// (f) value-per-token extremes
say('## (f) Value-per-token extremes');
say('');
say('VPT = delta per 1,000 skill tokens = `delta / (tokens/1000)` (lib/skillCost.js). Measured (skill × substrate) pairs only.');
say('');
const vpts = [];
for (const r of rows) {
  for (const side of ['C', 'G']) {
    const S = r[side]; if (!S || S.inc || S.vpt == null) continue;
    vpts.push({ slug: r.slug, sub: side === 'C' ? CLAUDE : GPT, vpt: S.vpt, delta: S.delta, tokens: S.tokens });
  }
}
vpts.sort((a, b) => b.vpt - a.vpt);
say('**Top 2 (best lift per token):**');
for (const v of vpts.slice(0, 2)) say(`- \`${v.slug}\` / ${v.sub}: VPT ${f3(v.vpt)} (Δ ${f3(v.delta)} over ${v.tokens} tok)`);
say('');
say('**Bottom 2 (worst lift per token):**');
for (const v of vpts.slice(-2).reverse()) say(`- \`${v.slug}\` / ${v.sub}: VPT ${f3(v.vpt)} (Δ ${f3(v.delta)} over ${v.tokens} tok)`);
say('');

const md = out.join('\n');
fs.writeFileSync('reports/report-002-qa.md', md);
console.log(md);
console.error('\n[written to reports/report-002-qa.md]');
