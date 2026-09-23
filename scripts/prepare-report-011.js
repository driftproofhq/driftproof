#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-011.js: render Driftproof Report 011 (DRAFT), Claude Opus 5.5 on
// release day, measured on the three skills and cases of Report 009.
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN. Nothing here calls a model or the network.
// The run was made by spec 042's command file (specs/042-opus-5-5-release-receipts/
// run/run.sh) and its receipts, sidecars and records are committed under that spec's
// evidence/. What the report makes public is copied, byte-identical, beside the page
// in evidence/, flat (the shape the repository gate's draft guard admits, spec 034
// A-034-2). The page is a pure function of those files and of the files it cites.
//
// THE VERDICTS ARE THE RUNNER'S OWN COMPARISON. Each is read from lib/diff.js
// buildDriftReport, the function `driftproof diff` runs, over the two receipts of the
// pair: band separation, the effect floor, and spec 035's underpowered rule. The
// committed `driftproof diff` outputs are published beside the page, and spec 042's
// gate re-derives every verdict with a reader that shares no code with this file.
//
// EVERY FIGURE IS A <data> ELEMENT THAT NAMES ITS FILE, as in Report 009: `value` is
// the value as read, `data-src` the file or files (space-separated), `data-at` where,
// `data-fn` how, `data-dp` the rounding shown. A numeral in the body outside a <data>
// element is a gate failure.
//
// Usage:
//   node scripts/prepare-report-011.js            # render docs/reports/011-draft/ and copy its evidence
//   node scripts/prepare-report-011.js --check    # exit 1 if the page or a copy drifted
//   node scripts/prepare-report-011.js --page     # print the page to stdout, write nothing

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EFFECT_FLOOR } = require('../config');
const { buildDriftReport } = require('../lib/diff');
// The runner's no-separation verdict value, taken from its own module rather than typed:
// spec 031 A-031-20 keeps that phrase off human-facing text, and this file is a published surface.
const { WITHIN_NOISE } = require('../lib/stats');
const { applyHeadTags } = require('./build-head-tags');
const { renderReportPage } = require('./site-chrome');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'reports', '011-draft');
const PAGE_REL = 'reports/011-draft/index.html';
const PUB = 'docs/reports/011-draft/evidence';
const SPEC = 'specs/042-opus-5-5-release-receipts';
const STAMP = '20260923T062806Z';
const RUN = `${SPEC}/evidence/opus-5-5-${STAMP}`;
const DIFFS = `${SPEC}/evidence/diff-20260923`;
const B009 = 'specs/000-governance/external-runs/three-skill-comparison';
const R9PUB = 'docs/reports/009/evidence';

const SKILLS = ['code-review-and-quality', 'git-workflow-and-versioning', 'documentation-and-adrs'];
const NEW = 'claude-opus-5-5';
const OLD = 'claude-opus-5';
const MODELS = [NEW, OLD];
const DATE = '2026-09-23';

// ---- the published set: published name -> the committed twin it is copied from ----
function publishedSet() {
  const m = new Map();
  for (const model of MODELS) {
    for (const s of SKILLS) {
      const stem = `${s}-${model}-${DATE}`;
      const dir = `${RUN}/${model}/${s}`;
      m.set(`${stem}.json`, `${dir}/receipts/${stem}.json`);
      m.set(`${stem}.summary.md`, `${dir}/receipts/${stem}.summary.md`);
      m.set(`${stem}.surface.json`, `${dir}/receipts/${stem}.surface.json`);
      m.set(`${stem}.stdout.txt`, `${dir}/stdout.txt`);
    }
  }
  for (const s of SKILLS) {
    m.set(`diff--model--${s}.md`, `${DIFFS}/model--${s}.md`);
    m.set(`diff--harness--${s}.md`, `${DIFFS}/harness--${s}.md`);
  }
  for (const f of ['run-record.json', 'registry.json', 'status.jsonl', 'driftproof-calls.SHA256SUMS', 'artefact-review-20260923.md']) {
    m.set(`run-${STAMP}--${f}`, `${RUN}/${f}`);
  }
  m.set('docs-pricing-snapshot-2026-09-23.json', `${SPEC}/evidence/docs-pricing-snapshot-2026-09-23.json`);
  m.set('guard.py', `${SPEC}/run/guard.py`);
  return m;
}
const PUBLISHED = publishedSet();
const pub = (name) => { if (!PUBLISHED.has(name)) throw new Error(`not in the published set: ${name}`); return `${PUB}/${name}`; };
const REC = (model, s) => pub(`${s}-${model}-${DATE}.json`);
const SUR = (model, s) => pub(`${s}-${model}-${DATE}.surface.json`);
const OUTF = (model, s) => pub(`${s}-${model}-${DATE}.stdout.txt`);
const DIFF = (kind, s) => pub(`diff--${kind}--${s}.md`);
const R9 = (s) => `${R9PUB}/three-skill-comparison--driftproof--${s}--receipts--${s}-claude-opus-5-2026-09-15.json`;
const STATUS = pub(`run-${STAMP}--status.jsonl`);
const RECORD = pub(`run-${STAMP}--run-record.json`);
const CALLSUMS = pub(`run-${STAMP}--driftproof-calls.SHA256SUMS`);
const REVIEW = pub(`run-${STAMP}--artefact-review-20260923.md`);
const GUARD = pub('guard.py');
const CALL = (n, f) => `${RUN}/driftproof-calls/${n}/${f}`;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));
const readJsonl = (rel) => readText(rel).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sha256 = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');

// Where a file is shown to a reader.
function shown(rel) {
  if (rel.startsWith(`${PUB}/`)) return `<a href="evidence/${esc(rel.slice(PUB.length + 1))}"><code>${esc(rel)}</code></a>`;
  if (rel.startsWith(`${R9PUB}/`)) return `<a href="../009/evidence/${esc(rel.slice(R9PUB.length + 1))}"><code>${esc(rel)}</code></a>`;
  if (rel.startsWith(`${RUN}/driftproof-calls/`)) {
    return `<code>${esc(rel.slice(RUN.length + 1))}</code> <span class="muted">(not published: a raw call record; its sha256 is in <code>${esc(CALLSUMS)}</code>)</span>`;
  }
  if (rel.startsWith(`${B009}/`)) {
    return `<code>three-skill-comparison/${esc(rel.slice(B009.length + 1))}</code> <span class="muted">(in Report 009&rsquo;s bundle, not published; its sha256 is in <code>${esc(R9PUB)}/three-skill-comparison--SHA256SUMS</code>)</span>`;
  }
  return `<code>${esc(rel)}</code>`;
}

function D(display, value, src, at, fn = 'v', dp = null) {
  const s = Array.isArray(src) ? src.join(' ') : src;
  return `<data value="${esc(value)}" data-src="${esc(s)}" data-at="${esc(at)}" data-fn="${esc(fn)}"${dp == null ? '' : ` data-dp="${dp}"`}>${esc(display)}</data>`;
}
const n3 = (v) => Number(v).toFixed(3);
const n2 = (v) => Number(v).toFixed(2);
const usd = (v) => Number(v).toFixed(2);
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function srcsOf(html) {
  return [...new Set([...html.matchAll(/data-src="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))];
}
function cite(html) {
  return `<p class="muted cite">Read from: ${srcsOf(html).map(shown).join('; ')}.</p>`;
}

// ---- reading ----------------------------------------------------------------
const ARM = (r, mode) => r.results.cases.find((c) => c.mode === mode).generation;
function readAll() {
  const rec = {};
  for (const model of MODELS) for (const s of SKILLS) rec[`${model}/${s}`] = readJson(REC(model, s));
  for (const s of SKILLS) rec[`r9/${s}`] = readJson(R9(s));
  return rec;
}

// The runner's own comparison, and the one label a reader sees for it.
const LABEL = {
  'separated-up': 'separation detected, upward',
  'separated-down': 'separation detected, downward',
  'no-separation': 'no separation detected',
  underpowered: 'no separation detected; not enough draws to conclude at this effect floor',
};
function verdictOf(a, b) {
  const rep = buildDriftReport(a, b, { labelA: 'A', labelB: 'B' });
  if (rep.refused || rep.perCase.length !== 1) throw new Error('the runner refused the pair or read other than one case');
  const c = rep.perCase[0];
  const token = c.verdict === 'improvement' ? 'separated-up'
    : c.verdict === 'regression' ? 'separated-down'
      : c.power && c.power.state === 'underpowered' ? 'underpowered'
        : String(c.verdict).startsWith(WITHIN_NOISE) ? 'no-separation' : null;
  if (!token) throw new Error(`the runner read ${c.verdict}, which this page has no label for`);
  return { token, delta: c.delta, power: c.power };
}
function vEl(aRel, bRel, diffRel, v) {
  return D(LABEL[v.token], v.token, [aRel, bRel, diffRel], 'results.cases[mode=with_skill]', 'verdict');
}

// Cost at each receipt's own frozen prices, over every draw's usage and judge usage.
function costOf(r, which) {
  const ps = r.run.pricing_snapshot.models;
  const g = ps[r.run.model_id]; const j = ps[r.run.judge.model_id];
  let gen = 0; let jud = 0;
  for (const c of r.results.cases) {
    for (const d of c.generation.draws) {
      gen += (d.usage.input_tokens * g.input_per_mtok + d.usage.output_tokens * g.output_per_mtok) / 1e6;
      jud += (d.judge_usage.input_tokens * j.input_per_mtok + d.judge_usage.output_tokens * j.output_per_mtok) / 1e6;
    }
  }
  return which === 'generation' ? gen : which === 'judge' ? jud : gen + jud;
}
function callsOf(status, model, s) {
  const rows = status.filter((x) => (model === '*' || x.model === model) && (s === '*' || x.skill === s));
  return rows.reduce((n, x) => { const [a, b] = x.calls.split('-').map(Number); return n + (b - a + 1); }, 0);
}

// ---- the page's blocks ------------------------------------------------------
function headlineBlock(rec, v) {
  const R = REC(NEW, SKILLS[0]);
  const html = `    <p class="big">Claude Opus 5.5 on the three skills and cases of Report 009, one case each, beside a fresh Claude Opus 5 arm on the same harness. Read by the runner&rsquo;s own comparison of the with-skill arms, ${SKILLS.map((s) => `<code>${esc(s)}</code> reads ${vEl(REC(OLD, s), REC(NEW, s), DIFF('model', s), v.model[s])}`).join(', ')}. Separately, Claude Opus 5 re-run on the newer Claude Code against Report 009&rsquo;s own receipts: ${SKILLS.map((s) => `<code>${esc(s)}</code> reads ${vEl(R9(s), REC(OLD, s), DIFF('harness', s), v.harness[s])}`).join(', ')}.</p>
    <p>Every figure below is read from a receipt or a file published beside it, and each block names its files. The target model of the new arm is <code>${D(rec[`${NEW}/${SKILLS[0]}`].run.model_id, rec[`${NEW}/${SKILLS[0]}`].run.model_id, R, 'run.model_id')}</code>, and every draw of every arm was judged by <code>${D(rec[`${NEW}/${SKILLS[0]}`].run.judge.model_id, rec[`${NEW}/${SKILLS[0]}`].run.judge.model_id, R, 'run.judge.model_id')}</code>.</p>`;
  return `${html}\n    ${cite(html)}`;
}

function limitsSection(rec) {
  const all6 = MODELS.flatMap((m) => SKILLS.map((s) => REC(m, s)));
  const R0 = REC(NEW, SKILLS[0]);
  const S0 = SUR(NEW, SKILLS[0]);
  const draws = all6.flatMap((f) => readJson(f).results.cases.map((c) => c.generation.n_measured));
  const lo = Math.min(...draws); const hi = Math.max(...draws);
  const refusal = 'version 2.1.280 or newer is required';
  const cliNow = readJson(S0).claude_code.pinned_version;
  const R9W = R9(SKILLS[0]);
  const verRe = 'claude-code-darwin-arm64/claude",\\s*"--version"\\s*\\],\\s*"exit": 0,\\s*"stdout": "([0-9]+\\.[0-9]+\\.[0-9]+) ';
  const platRe = 'claude-code-(darwin-arm64)/claude';
  const VP = `${B009}/version-preflight.json`;
  const verThen = new RegExp(verRe).exec(readText(VP))[1];
  const platThen = new RegExp(platRe).exec(readText(VP))[1];
  const platNowRe = 'claude-code-(linux-x64)/claude';
  const platNow = new RegExp(platNowRe).exec(readText(CALL('001', 'command.json')))[1];
  const judge = rec[`${NEW}/${SKILLS[0]}`].run.judge;
  const callFiles = readText(CALLSUMS).split('\n').filter((l) => /\/command\.json$/.test(l)).length;
  const html = `  <h2 id="limits">Limits, read these first</h2>
  <div class="card">
    <ul>
      <li><strong>One case per skill.</strong> Each receipt carries a suite of ${SKILLS.map((s) => D(rec[`${NEW}/${s}`].suite.case_count, rec[`${NEW}/${s}`].suite.case_count, REC(NEW, s), 'suite.case_count')).join(', ')} case, in the order ${SKILLS.map((s) => `<code>${esc(s)}</code>`).join(', ')}, the cases Report 009 used. Nothing on this page describes how any of the three skills behaves on any other task, or how Claude Opus 5.5 behaves in general.</li>
      <li><strong>Few draws.</strong> Each arm drew between ${D(lo, lo, all6, 'results.cases[*].generation.n_measured', 'min')} and ${D(hi, hi, all6, 'results.cases[*].generation.n_measured', 'max')} generations, each judged ${D(judge.samples, judge.samples, R0, 'run.judge.samples')} times, and each case&rsquo;s band is the spread across its draws. With one case there is no spread across cases, and each receipt records its combined uncertainty on the lift as absent, <code>${D(rec[`${NEW}/${SKILLS[0]}`].comparison.delta_uncertainty_unavailable, rec[`${NEW}/${SKILLS[0]}`].comparison.delta_uncertainty_unavailable, R0, 'comparison.delta_uncertainty_unavailable')}</code>.</li>
      <li><strong>Not Report 009&rsquo;s harness, for either arm.</strong> Report 009 ran on Claude Code <code>${D(verThen, verThen, VP, verRe, 're')}</code>. That version cannot call this model: an earlier start of this run stopped at its first call with the API&rsquo;s answer <q>${D(refusal, refusal, RECORD, refusal, 'quote')}</q>, and produced no receipt. Both arms of this run therefore used Claude Code <code>${D(cliNow, cliNow, S0, 'claude_code.pinned_version')}</code>, and each receipt&rsquo;s sidecar records the version every one of its calls reported (see Run record). The first table holds that harness fixed and moves the model. It is not Report 009&rsquo;s harness, so neither table puts a Claude Opus 5.5 figure beside a Report 009 figure.</li>
      <li><strong>The harness comparison moves more than Claude Code.</strong> The second table sets Report 009&rsquo;s Claude Opus 5 receipts beside this run&rsquo;s Claude Opus 5 receipts. Between them the Claude Code version changed, and so did the host: Report 009&rsquo;s Claude Code binary was the <code>${D(platThen, platThen, VP, platRe, 're')}</code> build, and this run&rsquo;s the <code>${D(platNow, platNow, CALL('001', 'command.json'), platNowRe, 're')}</code> build. So did the date, and every generation is a fresh draw. The runner, the judge, the grading template, the SKILL.md bytes, the cases, the draw rule and the caps are the same (see Setup). A separation in that table could not be put down to the Claude Code version alone.</li>
      <li><strong>The judge is one of the two models compared.</strong> Every draw in both tables was judged by <code>${D(judge.model_id, judge.model_id, R0, 'run.judge.model_id')}</code>, Report 009&rsquo;s judge, which is also the model of the older arm. This report does not measure whether that judge scores its own model&rsquo;s text differently from another model&rsquo;s. It is also not the judge the <a href="/judge-policy/">judge policy</a> fixes for Driftproof&rsquo;s reports, the departure Report 009 made, so these figures are comparable with Report 009 and not with Reports 001 to 008.</li>
      <li><strong>No reasoning effort was set.</strong> None of the ${D(callFiles, callFiles, CALLSUMS, 'effort', 'absent-in-calls')} raw call records&rsquo; argv carries an effort setting, the guard adds none (${D('guard.py', 'absent', GUARD, 'effort', 'absent')}), and no receipt records one (${D('none recorded', 'absent', all6, 'effort', 'absent')}). Whatever each model&rsquo;s default was on this surface applied. The tables read as the same surface with a different model, not as the same effort.</li>
      <li><strong>A verdict reads the with-skill arms only.</strong> The runner&rsquo;s comparison of two receipts sets one receipt&rsquo;s with-skill band against the other&rsquo;s, per case. The baseline and lift columns are context: no verdict on this page is read from them, however far apart they are.</li>
      <li><strong>Verification levels.</strong> All six receipts of this run are ${MODELS.flatMap((m) => SKILLS.map((s) => `<code>${D(rec[`${m}/${s}`].verification_level, rec[`${m}/${s}`].verification_level, REC(m, s), 'verification_level')}</code>`)).join(', ')}, each answered by a model the surface attested (<code>answered_by.kind</code> ${MODELS.flatMap((m) => SKILLS.map((s) => `<code>${D(rec[`${m}/${s}`].run.answered_by.kind, rec[`${m}/${s}`].run.answered_by.kind, REC(m, s), 'run.answered_by.kind')}</code>`)).join(', ')}).</li>
    </ul>
  </div>`;
  return html.replace(/\n  <\/div>$/, `\n    ${cite(html)}\n  </div>`);
}

function setupSection(rec) {
  const R0 = REC(NEW, SKILLS[0]);
  const floorRe = 'EFFECT_FLOOR = ([0-9]+\\.[0-9]+)';
  const floor = new RegExp(floorRe).exec(readText('config.js'))[1];
  if (Number(floor) !== EFFECT_FLOOR) throw new Error('config.js floor text and value disagree');
  const same = (key, at) => SKILLS.map((s) => {
    const files = [REC(NEW, s), REC(OLD, s), R9(s)];
    const v = readJson(files[0]); const val = at.split('.').reduce((o, k) => o[k], v);
    return `<code>${esc(s)}</code> <code>${D(val.slice(0, 12), val, files, at, 'same-prefix')}</code>`;
  }).join(', ');
  const tpl = rec[`${NEW}/${SKILLS[0]}`].run.judge.prompt_template_hash;
  const html = `  <h2 id="setup">What stayed fixed and what moved</h2>
  <div class="card">
    <p><strong>The inputs are Report 009&rsquo;s.</strong> The same SKILL.md bytes (<code>skill.content_hash</code>, the same in this run&rsquo;s two receipts and Report 009&rsquo;s for each skill: ${same('content_hash', 'skill.content_hash')}) and the same suites (<code>suite.suite_hash</code>: ${same('suite_hash', 'suite.suite_hash')}).</p>
    <p><strong>The runner is Report 009&rsquo;s.</strong> Driftproof runner <code>${D(rec[`${NEW}/${SKILLS[0]}`].run.runner_version, rec[`${NEW}/${SKILLS[0]}`].run.runner_version, [R0, REC(OLD, SKILLS[0]), R9(SKILLS[0])], 'run.runner_version', 'same')}</code> on the <code>${D(rec[`${NEW}/${SKILLS[0]}`].run.surface, rec[`${NEW}/${SKILLS[0]}`].run.surface, R0, 'run.surface')}</code> surface, with the flags Report 009&rsquo;s run used: at most ${D('80', '80', OUTF(NEW, SKILLS[0]), 'per-model cap: ([0-9]+)', 're')} calls and ${D('8.00', '8.00', OUTF(NEW, SKILLS[0]), 'budget \\$([0-9]+\\.[0-9]+)', 're')} dollars of estimated spend per skill run. It puts the SKILL.md text in the prompt for the with-skill arm and gives the baseline arm the task alone, with no tools in either. It draws generations per arm until the spread settles or a maximum is reached, and the judge scores each draw against the case&rsquo;s rubric on a continuous 0 to 1 scale.</p>
    <p><strong>The judge is Report 009&rsquo;s.</strong> <code>${D(rec[`${NEW}/${SKILLS[0]}`].run.judge.model_id, rec[`${NEW}/${SKILLS[0]}`].run.judge.model_id, [R0, REC(OLD, SKILLS[0]), R9(SKILLS[0])], 'run.judge.model_id', 'same')}</code>, with the grading template <code>${D(tpl.slice(0, 12), tpl, [R0, REC(OLD, SKILLS[0]), R9(SKILLS[0])], 'run.judge.prompt_template_hash', 'same-prefix')}</code> in all three.</p>
    <p><strong>The rule.</strong> A case&rsquo;s band is its mean across draws plus or minus the sample standard deviation across draws: a descriptive spread with no coverage probability. Two with-skill bands separate under the rule when they do not overlap and their means differ by at least the ${D(floor, floor, 'config.js', floorRe, 're')} effect floor. A case that does not separate is read under spec 035&rsquo;s rule: when the two arms&rsquo; spreads and draws could not have resolved a shift of the floor&rsquo;s size, it reads <q>not enough draws to conclude at this effect floor</q>, and otherwise <q>no separation detected</q>. Neither is evidence that nothing differs. The verdicts are the runner&rsquo;s: <code>driftproof diff</code> over each pair, whose outputs are published below.</p>
  </div>`;
  return html.replace('\n  </div>', `\n    ${cite(html)}\n  </div>`);
}

function reviewSection(rec) {
  const g = (m, s, mode) => ARM(rec[`${m}/${s}`], mode);
  const GW = REC(NEW, 'git-workflow-and-versioning'); const CR = REC(NEW, 'code-review-and-quality'); const DA = REC(NEW, 'documentation-and-adrs');
  const GW5 = REC(OLD, 'git-workflow-and-versioning');
  const gwb = g(NEW, 'git-workflow-and-versioning', 'baseline');
  const crb = g(NEW, 'code-review-and-quality', 'baseline');
  const daw = g(NEW, 'documentation-and-adrs', 'with_skill');
  const old = g(OLD, 'git-workflow-and-versioning', 'baseline');
  const endTurn = (rel, mode) => D(WORDS[ARM(readJson(rel), mode).draws.filter((d) => d.stop_reason === 'end_turn' && d.truncated === false && d.status === 'measured').length],
    ARM(readJson(rel), mode).draws.filter((d) => d.stop_reason === 'end_turn' && d.truncated === false && d.status === 'measured').length,
    rel, `results.cases[mode=${mode}].generation.draws[stop_reason=end_turn][truncated=false][status=measured]`, 'count', 'w');
  const drawMeans = (rel, mode) => ARM(readJson(rel), mode).draws.map((d, i) => D(n3(d.mean), d.mean, rel, `results.cases[mode=${mode}].generation.draws[${i}].mean`, 'v', 3)).join(', ');
  const cap = 'if the subject line does not use a conventional type prefix, cap at 0.3';
  const capV = '0.3';
  const gwReason = rec[`${NEW}/git-workflow-and-versioning`].results.cases.find((c) => c.mode === 'baseline').reason;
  const q = (rel, text) => D(text, text, rel, text, 'quote');
  const zero = old.draws.findIndex((d) => d.mean === 0);
  const html = `  <h2 id="low-figures">The low figures, read before the verdicts</h2>
  <div class="card">
    <p>Three figures on this run read low, and a low figure can be an instrument defect rather than an answer: a truncated generation, a refusal, a tool error, a timeout or a judge reply that did not parse. Report 007&rsquo;s timeout defect is the precedent. Each draw behind these three figures was read, in the receipt and in the raw call record, before any verdict was written. <strong>None is an artefact, and no cell is excluded.</strong> The review is published as <code>${esc(REVIEW.slice(PUB.length + 1))}</code>.</p>
    <ul>
      <li><strong>Claude Opus 5.5 without the skill on <code>git-workflow-and-versioning</code>, ${D(n3(gwb.mean), gwb.mean, GW, 'results.cases[mode=baseline].generation.mean', 'v', 3)}.</strong> Draws that ended their turn, untruncated and measured: ${endTurn(GW, 'baseline')} of ${D(WORDS[gwb.n_measured], gwb.n_measured, GW, 'results.cases[mode=baseline].generation.n_measured', 'v', 'w')}. Every judge sample reads ${D(capV, capV, GW, 'results.cases[mode=baseline].generation.draws[*].samples[*]', 'all-equal')}. Each draw is a complete commit message whose subject line begins <code>${q(CALL('041', 'stdout.jsonl'), 'Fix password-reset links')}</code> with no conventional type prefix, and the rubric reads <q>${q(CALL('042', 'prompt.txt'), cap)}</q>. The judge&rsquo;s reason: <q>${q(GW, gwReason)}</q> A real answer, judged low.</li>
      <li><strong>Claude Opus 5.5 without the skill on <code>code-review-and-quality</code>, ${D(n3(crb.mean), crb.mean, CR, 'results.cases[mode=baseline].generation.mean', 'v', 3)}.</strong> Draws that ended their turn, untruncated and measured: ${endTurn(CR, 'baseline')} of ${D(WORDS[crb.n_measured], crb.n_measured, CR, 'results.cases[mode=baseline].generation.n_measured', 'v', 'w')}, with draw means ${drawMeans(CR, 'baseline')}. The two low draws are complete reviews that label the leaked key and the logged customer data <code>Critical</code> and put the other findings under category headings, <code>${q(CALL('017', 'stdout.jsonl'), 'Correctness')}</code> among them, with no severity label; the judge says so, for example <q>${q(CALL('019', 'stdout.jsonl'), 'are categories, not severity labels')}</q>. A real answer, judged low, with the spread between draws.</li>
      <li><strong>Claude Opus 5.5 with the skill on <code>documentation-and-adrs</code>, ${D(n3(daw.mean), daw.mean, DA, 'results.cases[mode=with_skill].generation.mean', 'v', 3)}.</strong> Draws that ended their turn, untruncated and measured: ${endTurn(DA, 'with_skill')} of ${D(WORDS[daw.n_measured], daw.n_measured, DA, 'results.cases[mode=with_skill].generation.n_measured', 'v', 'w')}, with draw means ${drawMeans(DA, 'with_skill')}. Each is a complete revised function. The low draws keep the expired-coupon <code>TODO</code> reworded rather than resolving or removing it, which the judge reads as a miss, for example <q>${q(CALL('056', 'stdout.jsonl'), 'left a reworded but still-bare TODO')}</q>. A real answer, judged low.</li>
    </ul>
    <p><strong>One more draw, outside the three.</strong> In Claude Opus 5&rsquo;s baseline on <code>git-workflow-and-versioning</code>, draw ${D(WORDS[zero + 1], zero + 1, GW5, 'results.cases[mode=baseline].generation.draws[*].mean', 'first-zero-1', 'w')} of ${D(WORDS[old.n_measured], old.n_measured, GW5, 'results.cases[mode=baseline].generation.n_measured', 'v', 'w')} scored ${D(n2(old.draws[zero].mean), old.draws[zero].mean, GW5, `results.cases[mode=baseline].generation.draws[${zero}].mean`, 'v', 2)}. The surface gives the model no tools, and the model wrote a <code>${q(CALL('133', 'stdout.jsonl'), 'Glob')}</code> invocation out as text, followed by the words <q>${q(CALL('133', 'stdout.jsonl'), 'No files found.')}</q>, and gave no commit message. The judge scored that absence. It ended its turn, was not truncated, ran no tool and parsed, so it is the model&rsquo;s own output and it is not excluded. It sits in a baseline arm, which no verdict here reads.</p>
  </div>`;
  return html.replace(/\n  <\/div>$/, `\n    ${cite(html)}\n  </div>`);
}

function tableSection(kind, rec, v) {
  const pairs = SKILLS.map((s) => (kind === 'model'
    ? { s, a: REC(OLD, s), b: REC(NEW, s), ra: rec[`${OLD}/${s}`], rb: rec[`${NEW}/${s}`] }
    : { s, a: R9(s), b: REC(OLD, s), ra: rec[`r9/${s}`], rb: rec[`${OLD}/${s}`] }));
  const band = (rel, r, mode) => {
    const x = ARM(r, mode);
    return `${D(n3(x.mean), x.mean, rel, `results.cases[mode=${mode}].generation.mean`, 'v', 3)} &plusmn; ${D(n3(x.sd), x.sd, rel, `results.cases[mode=${mode}].generation.sd`, 'v', 3)} <span class="muted">(${D(x.n_measured, x.n_measured, rel, `results.cases[mode=${mode}].generation.n_measured`)} draws)</span>`;
  };
  const tr = pairs.map((p) => {
    const vv = v[kind][p.s];
    const d = ARM(p.rb, 'with_skill').mean - ARM(p.ra, 'with_skill').mean;
    return `      <tr><td><code>${esc(p.s)}</code></td>`
      + `<td>${band(p.a, p.ra, 'with_skill')}</td>`
      + `<td>${band(p.b, p.rb, 'with_skill')}</td>`
      + `<td>${D((d >= 0 ? '+' : '') + n3(d), d, [p.a, p.b], 'results.cases[mode=with_skill].generation.mean', 'delta', 3)}</td>`
      + `<td>${vEl(p.a, p.b, DIFF(kind, p.s), vv)}</td>`
      + `<td>${D(n3(ARM(p.ra, 'baseline').mean), ARM(p.ra, 'baseline').mean, p.a, 'results.cases[mode=baseline].generation.mean', 'v', 3)}; ${D(n3(ARM(p.rb, 'baseline').mean), ARM(p.rb, 'baseline').mean, p.b, 'results.cases[mode=baseline].generation.mean', 'v', 3)}</td>`
      + `<td>${D((p.ra.comparison.delta >= 0 ? '+' : '') + n3(p.ra.comparison.delta), p.ra.comparison.delta, p.a, 'comparison.delta', 'signed', 3)}; ${D((p.rb.comparison.delta >= 0 ? '+' : '') + n3(p.rb.comparison.delta), p.rb.comparison.delta, p.b, 'comparison.delta', 'signed', 3)}</td></tr>`;
  }).join('\n');
  const head = kind === 'model'
    ? { id: 'model', h: 'The model: Claude Opus 5.5 against Claude Opus 5, both on this run&rsquo;s harness', a: 'Claude Opus 5, with skill', b: 'Claude Opus 5.5, with skill', ctx: 'Claude Opus 5; Claude Opus 5.5' }
    : { id: 'harness', h: 'The harness: Claude Opus 5 in Report 009 against Claude Opus 5 in this run', a: 'Report 009, with skill', b: 'this run, with skill', ctx: 'Report 009; this run' };
  const table = `  <h2 id="${head.id}">${head.h}</h2>
  <table class="summary">
    <thead><tr><th scope="col">skill</th><th scope="col">${head.a}, mean &plusmn; sd across draws</th><th scope="col">${head.b}, mean &plusmn; sd across draws</th><th scope="col">with-skill delta</th><th scope="col">under the rule</th><th scope="col">baseline mean (${head.ctx}), context</th><th scope="col">lift (${head.ctx}), context</th></tr></thead>
    <tbody>
${tr}
    </tbody>
  </table>`;
  const cap = kind === 'model'
    ? 'The with-skill delta is the second with-skill mean minus the first. The rule column is the runner&rsquo;s comparison of the two with-skill bands; the delta, the baseline means and the lifts are shown as context, and no verdict is read from them. A lift is a receipt&rsquo;s with-skill mean minus its baseline mean.'
    : 'The same columns, with Report 009&rsquo;s receipt first. Report 009&rsquo;s receipts are published with that report and linked here, not copied.';
  return `${table}
  <p class="muted">${cap}</p>
  ${cite(tr + pairs.map((p) => `data-src="${DIFF(kind, p.s)}"`).join(' '))}`;
}

function readingsSection(rec, v) {
  const m = v.model; const h = v.harness;
  const pd = (a, b, mode = 'with_skill') => D(((b.mean - a.mean) >= 0 ? '+' : '') + n3(b.mean - a.mean), b.mean - a.mean, [a.rel, b.rel], `results.cases[mode=${mode}].generation.mean`, 'delta', 3);
  const arm = (rel, mode) => ({ rel, ...ARM(readJson(rel), mode) });
  const DA = 'documentation-and-adrs'; const GW = 'git-workflow-and-versioning'; const CR = 'code-review-and-quality';
  const daO = arm(REC(OLD, DA), 'with_skill'); const daN = arm(REC(NEW, DA), 'with_skill');
  const gwO = arm(REC(OLD, GW), 'with_skill'); const gwN = arm(REC(NEW, GW), 'with_skill');
  const crO = arm(REC(OLD, CR), 'with_skill'); const crN = arm(REC(NEW, CR), 'with_skill');
  const need = m[GW].power && m[GW].power.drawsNeeded;
  const c1 = `  <p class="claim" data-claim="1"><strong>1. Between the two models, the rule detects no separation on any of the three skills, and on two of them the draws could not have told.</strong> On <code>${CR}</code> the with-skill means differ by ${pd(crO, crN)} and the rule reads ${vEl(REC(OLD, CR), REC(NEW, CR), DIFF('model', CR), m[CR])}. On <code>${GW}</code> they differ by ${pd(gwO, gwN)}; at these spreads the runner puts the draws that would have been needed at ${D(need, need, [REC(OLD, GW), REC(NEW, GW)], 'results.cases[mode=with_skill].generation', 'draws-needed')} per arm, against the ${D(Math.min(gwO.n_measured, gwN.n_measured), Math.min(gwO.n_measured, gwN.n_measured), [REC(OLD, GW), REC(NEW, GW)], 'results.cases[mode=with_skill].generation.n_measured', 'min')} drawn. On <code>${DA}</code> the move is the largest of the three, ${pd(daO, daN)}, and the two spreads sum to ${D(n3(daO.sd + daN.sd), daO.sd + daN.sd, [REC(OLD, DA), REC(NEW, DA)], 'results.cases[mode=with_skill].generation.sd', 'sum', 3)}, which is at or above the floor, so no draw count at these spreads resolves it. None of this is evidence that the two models score these skills alike.</p>`;
  const r9 = (s) => arm(R9(s), 'with_skill');
  const daR = r9(DA);
  const c2 = `  <p class="claim" data-claim="2"><strong>2. Claude Opus 5 on this run&rsquo;s harness separates from its Report 009 receipts on no skill.</strong> The with-skill means move by ${SKILLS.map((s) => `${pd(r9(s), arm(REC(OLD, s), 'with_skill'))} on <code>${s}</code>`).join(', ')}. The rule reads no separation detected on the first two, and on <code>${DA}</code>, where this run&rsquo;s spread is ${D(n3(daO.sd), daO.sd, REC(OLD, DA), 'results.cases[mode=with_skill].generation.sd', 'v', 3)} against Report 009&rsquo;s ${D(n3(daR.sd), daR.sd, R9(DA), 'results.cases[mode=with_skill].generation.sd', 'v', 3)}, ${vEl(R9(DA), REC(OLD, DA), DIFF('harness', DA), h[DA])}. This is a statement about these draws on two harnesses and two hosts, not about Claude Code.</p>`;
  const bO = arm(REC(OLD, GW), 'baseline'); const bN = arm(REC(NEW, GW), 'baseline');
  const cbO = arm(REC(OLD, CR), 'baseline'); const cbN = arm(REC(NEW, CR), 'baseline');
  const c3 = `  <p class="claim" data-claim="3"><strong>3. On two skills the two models&rsquo; baselines sit further apart than their with-skill scores, and no verdict here reads them.</strong> Without the skill, <code>${GW}</code> reads ${D(n3(bO.mean), bO.mean, REC(OLD, GW), 'results.cases[mode=baseline].generation.mean', 'v', 3)} for Claude Opus 5 and ${D(n3(bN.mean), bN.mean, REC(NEW, GW), 'results.cases[mode=baseline].generation.mean', 'v', 3)} for Claude Opus 5.5, and <code>${CR}</code> ${D(n3(cbO.mean), cbO.mean, REC(OLD, CR), 'results.cases[mode=baseline].generation.mean', 'v', 3)} and ${D(n3(cbN.mean), cbN.mean, REC(NEW, CR), 'results.cases[mode=baseline].generation.mean', 'v', 3)}. On those two skills the lifts therefore differ more than the with-skill scores do; on <code>${DA}</code> the two baselines read ${D(n3(arm(REC(OLD, DA), 'baseline').mean), arm(REC(OLD, DA), 'baseline').mean, REC(OLD, DA), 'results.cases[mode=baseline].generation.mean', 'v', 3)} and ${D(n3(arm(REC(NEW, DA), 'baseline').mean), arm(REC(NEW, DA), 'baseline').mean, REC(NEW, DA), 'results.cases[mode=baseline].generation.mean', 'v', 3)}. The runner&rsquo;s comparison of two receipts does not read baseline arms, so this is offered as an observation to test on more cases, not as a finding; the section on the low figures says what those draws are.</p>`;
  const all = [c1, c2, c3].join('\n');
  return `  <h2 id="readings">Three readings</h2>
${all}
  ${cite(all)}`;
}

function runRecordSection(rec) {
  const status = readJsonl(STATUS);
  const all6 = MODELS.flatMap((m) => SKILLS.map((s) => REC(m, s)));
  const rows = MODELS.flatMap((m) => SKILLS.map((s) => {
    const r = rec[`${m}/${s}`]; const R = REC(m, s); const S = SUR(m, s);
    const sc = readJson(S);
    const calls = callsOf(status, m, s);
    return `      <tr><td><code>${esc(m)}</code></td><td><code>${esc(s)}</code></td>`
      + `<td>${D(calls, calls, STATUS, `${m}|${s}`, 'calls')}</td>`
      + `<td><code>${D(sc.claude_code.versions_reported_by_calls[0], sc.claude_code.versions_reported_by_calls[0], S, 'claude_code.versions_reported_by_calls[*]', 'all-equal')}</code></td>`
      + `<td>${D(usd(costOf(r, 'generation')), costOf(r, 'generation'), R, 'generation', 'cost', 2)}</td>`
      + `<td>${D(usd(costOf(r, 'judge')), costOf(r, 'judge'), R, 'judge', 'cost', 2)}</td>`
      + `<td>${D(usd(costOf(r, 'all')), costOf(r, 'all'), R, 'all', 'cost', 2)}</td></tr>`;
  })).join('\n');
  const tot = (w) => MODELS.flatMap((m) => SKILLS.map((s) => costOf(rec[`${m}/${s}`], w))).reduce((a, b) => a + b, 0);
  const totalCalls = callsOf(status, '*', '*');
  const unmeasured = all6.flatMap((f) => readJson(f).results.cases.map((c) => c.generation.n_unmeasured)).reduce((a, b) => a + b, 0);
  const capRe = 'if n >= ([0-9]+):';
  const cap = new RegExp(capRe).exec(readText(GUARD))[1];
  const tRe = 'timeout=([0-9]+)\\)';
  const tmo = new RegExp(tRe).exec(readText(GUARD))[1];
  const recJ = readJson(RECORD);
  const reg = recJ.registry.added_row;
  const metered = new RegExp('actual metered spend on claude-cli: \\$([0-9]+\\.[0-9]+)').exec(readText(OUTF(NEW, SKILLS[0])))[1];
  const S0 = SUR(NEW, SKILLS[0]);
  const inner = `    <p><strong>The run.</strong> Run <code>${D(recJ.stamp, recJ.stamp, RECORD, 'stamp')}</code>, one skill at a time, the Claude Opus 5.5 arm first and then the Claude Opus 5 arm, <code>code-review-and-quality</code> first in each. The command file writes a status line after each skill run; there are ${D(WORDS[status.length], status.length, STATUS, '[*]', 'count', 'w')}, each with exit status ${D('0', '0', STATUS, '[*].exit', 'all-equal')} and ${D(WORDS[1], 1, STATUS, '[*].receipts', 'all-equal', 'w')} receipt, the last at <code>${D(status[status.length - 1].at, status[status.length - 1].at, STATUS, `[skill=${status[status.length - 1].skill}][model=${status[status.length - 1].model}].at`)}</code>. Each receipt&rsquo;s <code>run.date_utc</code> is written by the runner and is not read here as a start or a finish.</p>
    <p><strong>The caps.</strong> Per skill run, the runner&rsquo;s own caps, as in Report 009 (see Setup). Across the whole run, a guard in front of Claude Code allows ${D(cap, cap, GUARD, capRe, 're')} calls in all and ${D(tmo, tmo, GUARD, tRe, 're')} seconds per call. The run used ${D(totalCalls, totalCalls, STATUS, '*|*', 'calls')} calls, and the six receipts record ${D(unmeasured, unmeasured, all6, 'results.cases[*].generation.n_unmeasured', 'sum')} unmeasured draws.</p>
    <p><strong>The harness.</strong> Claude Code <code>${D(readJson(S0).claude_code.pinned_version, readJson(S0).claude_code.pinned_version, S0, 'claude_code.pinned_version')}</code>, installed at the npm integrity the run record states, with runner <code>${D(rec[`${NEW}/${SKILLS[0]}`].run.runner_version, rec[`${NEW}/${SKILLS[0]}`].run.runner_version, REC(NEW, SKILLS[0]), 'run.runner_version')}</code> at Report 009&rsquo;s integrity. The runner writes no Claude Code version into a receipt, and a receipt is sealed, so each receipt has a sidecar, <code>&lt;receipt&gt;.surface.json</code>, bound to it by its <code>receipt_hash</code> and recording the version each of its calls reported; the table gives it.</p>
    <p><strong>The price.</strong> The runner&rsquo;s registry had no row for <code>${D(reg.id, reg.id, RECORD, 'registry.added_row.id')}</code>, so this run used a copy of it with one row added, at ${D(String(reg.input_price), reg.input_price, RECORD, 'registry.added_row.input_price')} and ${D(String(reg.output_price), reg.output_price, RECORD, 'registry.added_row.output_price')} dollars per million input and output tokens, read from the vendor&rsquo;s pricing page on the day of the run (<code>docs-pricing-snapshot-2026-09-23.json</code>). The row is this run&rsquo;s only; the product&rsquo;s registry does not carry it.</p>
    <p><strong>The cost.</strong> Metered spend was ${D(metered, metered, OUTF(NEW, SKILLS[0]), 'actual metered spend on claude-cli: \\$([0-9]+\\.[0-9]+)', 're')} dollars: the <code>claude-cli</code> surface runs on a subscription. The estimated API-equivalent below is every draw&rsquo;s generation and judge token counts, as each receipt records them, at the prices each receipt froze, with cached input counted at the full input price, as the runner counts it.</p>
`;
  const table = `  <table class="summary">
    <thead><tr><th scope="col">arm</th><th scope="col">skill</th><th scope="col">calls</th><th scope="col">Claude Code reported by every call</th><th scope="col">generation, estimated USD</th><th scope="col">judge, estimated USD</th><th scope="col">total, estimated USD</th></tr></thead>
    <tbody>
${rows}
      <tr><td colspan="4">all six</td><td>${D(usd(tot('generation')), tot('generation'), all6, 'generation', 'cost', 2)}</td><td>${D(usd(tot('judge')), tot('judge'), all6, 'judge', 'cost', 2)}</td><td>${D(usd(tot('all')), tot('all'), all6, 'all', 'cost', 2)}</td></tr>
    </tbody>
  </table>`;
  const integ = `    <p><strong>Integrity.</strong> Receipt hashes: ${MODELS.flatMap((m) => SKILLS.map((s) => `<code>${esc(m)}</code> <code>${esc(s)}</code> <code>${D(rec[`${m}/${s}`].receipt_hash.slice(0, 16), rec[`${m}/${s}`].receipt_hash, REC(m, s), 'receipt_hash', 'prefix')}</code>`)).join(', ')}. Each validates with its receipt hash verified. The raw call records carry the SKILL.md text and stay unpublished; their sha256 are published.</p>`;
  const body = `${inner}${table}\n${integ}`;
  return `  <h2 id="run-record">Run record</h2>
  <div class="card">
${body}
    ${cite(body + ` data-src="${CALLSUMS}"`)}
  </div>`;
}

function evidenceBlock() {
  const names = [...PUBLISHED.keys()].sort();
  return `  <h2 id="evidence">Published evidence</h2>
  <details class="card" open><summary><strong>The files this report makes public.</strong> The six receipts with their summaries, surface sidecars and the runner&rsquo;s console output; the six <code>driftproof diff</code> outputs the verdicts are read from; the run record, its registry copy, the status lines, the review of the low figures and the sha256 of every raw call record; the pricing snapshot; and the call guard.</summary>
    <ul>
${names.map((n) => { const f = `${PUB}/${n}`; return `      <li><a href="evidence/${esc(n)}"><code>${esc(f)}</code></a><br><span class="muted">sha256 <code>${D(sha256(PUBLISHED.get(n)), sha256(PUBLISHED.get(n)), f, '', 'sha256')}</code></span></li>`; }).join('\n')}
    </ul>
    <p class="muted">Report 009&rsquo;s three receipts, the other side of the second table, are published with that report: ${SKILLS.map((s) => `<a href="../009/evidence/${esc(R9(s).slice(R9PUB.length + 1))}"><code>${esc(s)}</code></a>`).join(', ')}. Validate a receipt with <code>npx driftproof validate &lt;file&gt;</code>. Each copy here is byte-identical to its twin under <code>${esc(SPEC)}/</code>, and each sidecar names the receipt it belongs to and that receipt&rsquo;s hash.</p>
  </details>`;
}

function verdicts(rec) {
  const v = { model: {}, harness: {} };
  for (const s of SKILLS) {
    v.model[s] = verdictOf(rec[`${OLD}/${s}`], rec[`${NEW}/${s}`]);
    v.harness[s] = verdictOf(rec[`r9/${s}`], rec[`${OLD}/${s}`]);
  }
  return v;
}

function draftBanner() {
  return `  <div class="card draft-banner">
    <strong>DRAFT, not published.</strong> This page is not linked from the report index and has not been built into the public tree. It stops at approval-ready: a fresh-context QA and a separate approval read it before any publish sequence in <code>RUNBOOK.md</code> is run.
  </div>`;
}

function buildPage(rec) {
  const v = verdicts(rec);
  const base = applyHeadTags(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof: Report 011 (DRAFT), Claude Opus 5.5 on release day</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report">
${draftBanner()}
  <h1>Report 011: Claude Opus 5.5 on release day, three skills</h1>
  <p class="report-type">Release drift report<span class="muted">. The first table is the type&rsquo;s question: the model moves under the skill and the harness stays fixed. The second holds the model and moves the harness, which the type does not describe; the limits say how it is read.</span></p>
  <div class="headline">
${headlineBlock(rec, v)}
  </div>

${limitsSection(rec)}

${setupSection(rec)}

${reviewSection(rec)}

${tableSection('model', rec, v)}

${tableSection('harness', rec, v)}

${readingsSection(rec, v)}

${runRecordSection(rec)}

${evidenceBlock()}

  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report 011 · DRAFT</span></footer>
</main>
</body>
</html>
`, PAGE_REL);
  return renderReportPage(base, PAGE_REL, []);
}

function main() {
  const args = process.argv.slice(2);
  const page = buildPage(readAll());
  const out = path.join(OUT_DIR, 'index.html');
  if (args.includes('--page')) { process.stdout.write(page); return 0; }
  if (args.includes('--check')) {
    const drift = [];
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== page) drift.push('index.html');
    for (const [n, src] of PUBLISHED) {
      const p = path.join(ROOT, PUB, n);
      if (!fs.existsSync(p) || sha256(`${PUB}/${n}`) !== sha256(src)) drift.push(n);
    }
    if (!drift.length) { console.log('report 011: page and evidence match their files'); return 0; }
    console.error(`report 011: DRIFTED: ${drift.join(', ')}`);
    process.exitCode = 1;
    return 1;
  }
  fs.mkdirSync(path.join(ROOT, PUB), { recursive: true });
  for (const [n, src] of PUBLISHED) fs.copyFileSync(path.join(ROOT, src), path.join(ROOT, PUB, n));
  fs.writeFileSync(out, page);
  console.log(`  wrote docs/${PAGE_REL} and ${PUBLISHED.size} evidence files`);
  return 0;
}

if (require.main === module) main();

module.exports = { SKILLS, MODELS, PUB, PUBLISHED, PAGE_REL, OUT_DIR, readAll, buildPage, verdicts, LABEL, main };
