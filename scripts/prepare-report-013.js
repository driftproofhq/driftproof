#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-013.js: render Driftproof Report 013, Claude Sonnet 5.5 the day after its release,
// measured on the three skills and cases of Reports 009 and 011, in three arms and three runs.
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN. Nothing here calls a model or the network. The runs
// were made by spec 121's command file (specs/121-report-013-sonnet-5-5/run/run.sh), three
// times over, and each run's receipts, sidecars and records are committed under that spec's
// evidence/r013-<stamp>/. What the report makes public is copied, byte-identical, beside the
// page in evidence/, each run's files in its own directory (run-1/, run-2/, run-3/) under the
// runner's own names, so each sidecar sits beside the receipt its `receipt` field names and
// lib/receipt.js reads it as a sidecar (spec 069 AC-2); the diffs and shared files are flat. The
// 27 receipts and their summaries are also copied to receipts/report-013/run-<k>/, the one
// directory the TL;DR card, the receipt pages and the badges read (spec 047 R-2).
//
// A RUN'S NUMBER IS ITS PLACE IN TIME. The three run directories are read from the spec's
// evidence and sorted by their stamps; run 1 is the earliest. evidence/runs-log.txt records the
// same order (it is the operator's runs.log, renamed because the tree ignores *.log), and the page cites it.
//
// THE VERDICTS ARE THE RUNNER'S OWN COMPARISON, as in Report 011: lib/diff.js
// buildDriftReport over the two receipts of a pair, the function `driftproof diff` runs. The
// 27 committed `driftproof diff` outputs are published beside the page, and spec 121's gate
// re-derives every verdict with a reader that shares no code with this file. Three runs
// together are read as the runner's reading in each run, counted; no receipt is pooled and no
// verdict is read across runs.
//
// EVERY FIGURE IS A <data> ELEMENT THAT NAMES ITS FILE, as in Reports 009 and 011: `value` is
// the value as read, `data-src` the file or files (space-separated), `data-at` where,
// `data-fn` how, `data-dp` the rounding shown. A numeral in the body outside a <data>
// element is a gate failure.
//
// Usage:
//   node scripts/prepare-report-013.js            # render docs/reports/013/ and copy its evidence and receipts
//   node scripts/prepare-report-013.js --check    # exit 1 if the page or a copy drifted
//   node scripts/prepare-report-013.js --page     # print the page to stdout, write nothing

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EFFECT_FLOOR } = require('../config');
// The runner's comparison of a pair, lib/diff.js buildDriftReport read to one token, shared with the
// report's opening (scripts/report-answers.js, spec 134 R-9).
const { pairVerdict } = require('./report-answers');
const { applyHeadTags } = require('./build-head-tags');
// slugOf is the contents rail's id for a heading's text (spec 125), read here so a question heading
// keeps the id the rail gave it as first published (spec 134, the operator's ruling on anchors).
const { renderReportPage, slugOf } = require('./site-chrome');
const { reportRow } = require('./site-data.mjs');
const { humanModelName } = require('./model-names');
// A model's human name, from its id (spec 133's module); never typed here (spec 134 AC-1).
const HN = (id) => humanModelName(id);

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'reports', '013');
const PAGE_REL = 'reports/013/index.html';
const NUMBER = /reports\/(\d+)/.exec(PAGE_REL)[1];
const PUB = 'docs/reports/013/evidence';
const RECEIPTS = 'receipts/report-013';
const SPEC = 'specs/121-report-013-sonnet-5-5';
const DIFFS = `${SPEC}/evidence/diff-20260929`;
const SNAP_NAME = 'docs-pricing-snapshot-2026-09-29.json';
const R11PUB = 'docs/reports/011/evidence';
const R11STAMP = '20260923T062806Z';
const RELEASE_REC = 'specs/125-site-wide-layout/evidence/release-date.json';
// Amendment two's record (spec 134): the day it was made and why, published beside the page.
const AMEND2_REC = 'specs/134-seo-answer-first-reports/report-013-amendment-2.json';
// Amendment three's record (spec 134 A-134-1): the runner's phrase amendment one left out.
const AMEND3_REC = 'specs/134-seo-answer-first-reports/report-013-amendment-3.json';

const SKILLS = ['code-review-and-quality', 'git-workflow-and-versioning', 'documentation-and-adrs'];
const S55 = 'claude-sonnet-5-5';
const S5 = 'claude-sonnet-5';
const O55 = 'claude-opus-5-5';
const ARMS = [S55, S5, O55];
const NAME = Object.fromEntries([S55, S5, O55].map((id) => [id, HN(id)]));
const DATE = '2026-09-29';
const R11DATE = '2026-09-23';
// The three comparisons: the first receipt of each pair is the runner's A, the second its B.
const KINDS = {
  upgrade: { a: S5, b: S55 },
  peer: { a: O55, b: S55 },
  harness: { a: 'r11', b: O55 },
};

// Read when first needed, never at load: a published tree carries no specs/.
let stampsCache = null;
function stamps() {
  if (stampsCache) return stampsCache;
  const dir = path.join(ROOT, SPEC, 'evidence');
  stampsCache = fs.readdirSync(dir).filter((n) => /^r013-\d{8}T\d{6}Z$/.test(n) && fs.statSync(path.join(dir, n)).isDirectory()).map((n) => n.slice(5)).sort();
  if (stampsCache.length !== 3) throw new Error(`${stampsCache.length} run directories under ${SPEC}/evidence, not three`);
  return stampsCache;
}
const RUNS = [1, 2, 3];
const RUN_DIR = (k) => `${SPEC}/evidence/r013-${stamps()[k - 1]}`;

// ---- the published set: published name -> the committed twin it is copied from ----
let publishedCache = null;
function evidenceSet() {
  if (publishedCache) return publishedCache;
  const m = new Map();
  for (const k of RUNS) {
    const RUN = RUN_DIR(k);
    for (const model of ARMS) {
      for (const s of SKILLS) {
        const stem = `${s}-${model}-${DATE}`;
        const dir = `${RUN}/${model}/${s}`;
        m.set(`run-${k}/${stem}.json`, `${dir}/receipts/${stem}.json`);
        m.set(`run-${k}/${stem}.summary.md`, `${dir}/receipts/${stem}.summary.md`);
        m.set(`run-${k}/${stem}.surface.json`, `${dir}/receipts/${stem}.surface.json`);
        m.set(`run-${k}/${stem}.stdout.txt`, `${dir}/stdout.txt`);
      }
    }
    for (const kind of Object.keys(KINDS)) for (const s of SKILLS) m.set(`diff--${kind}--run-${k}--${s}.md`, `${DIFFS}/${kind}--run-${k}--${s}.md`);
    for (const f of ['run-record.json', 'registry.json', 'status.jsonl', 'driftproof-calls.SHA256SUMS']) m.set(`run-${k}/${f}`, `${RUN}/${f}`);
  }
  m.set('runs-log.txt', `${SPEC}/evidence/runs-log.txt`);
  m.set(SNAP_NAME, `${SPEC}/evidence/${SNAP_NAME}`);
  m.set('guard.py', `${SPEC}/run/guard.py`);
  // THE RELEASE DATE (spec 125 C-1). No receipt carries it (`run.model_release_date` is null in all
  // 27), so it is read from the record spec 125 saved beside the vendor's announcement, and the
  // record is published here with the rest of the evidence.
  m.set('release-date.json', `${RELEASE_REC}`);
  m.set('amendment-2.json', AMEND2_REC);
  m.set('amendment-3.json', AMEND3_REC);
  if (fs.existsSync(path.join(ROOT, SPEC, 'evidence', 'vendor-pitch.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, SPEC, 'evidence', 'vendor-pitch.json'), 'utf8'));
    m.set('vendor-pitch.json', `${SPEC}/evidence/vendor-pitch.json`);
    m.set(p.kept_as, `${SPEC}/evidence/${p.kept_as}`);
  }
  publishedCache = m;
  return m;
}
const pub = (name) => { if (!evidenceSet().has(name)) throw new Error(`not in the published set: ${name}`); return `${PUB}/${name}`; };
const REC = (k, model, s) => (model === 'r11' ? R11(s) : pub(`run-${k}/${s}-${model}-${DATE}.json`));
const SUR = (k, model, s) => pub(`run-${k}/${s}-${model}-${DATE}.surface.json`);
const OUTF = (k, model, s) => pub(`run-${k}/${s}-${model}-${DATE}.stdout.txt`);
const DIFF = (kind, k, s) => pub(`diff--${kind}--run-${k}--${s}.md`);
const STATUS = (k) => pub(`run-${k}/status.jsonl`);
const RECORD = (k) => pub(`run-${k}/run-record.json`);
const CALLSUMS = (k) => pub(`run-${k}/driftproof-calls.SHA256SUMS`);
const RUNSLOG = () => pub('runs-log.txt');
const SNAP = () => pub(SNAP_NAME);
const GUARD = () => pub('guard.py');
const R11 = (s) => `${R11PUB}/${s}-${O55}-${R11DATE}.json`;
const R11SUR = (s) => `${R11PUB}/${s}-${O55}-${R11DATE}.surface.json`;
const R11RECORD = `${R11PUB}/run-${R11STAMP}--run-record.json`;
const R11GUARD = `${R11PUB}/guard.py`;
// The receipt copies the card, the receipt pages and the badges read: receipt copy -> evidence twin.
function receiptCopies() {
  const m = new Map();
  for (const k of RUNS) for (const model of ARMS) for (const s of SKILLS) {
    const stem = `${s}-${model}-${DATE}`;
    m.set(`${RECEIPTS}/run-${k}/${stem}.json`, `${RUN_DIR(k)}/${model}/${s}/receipts/${stem}.json`);
    m.set(`${RECEIPTS}/run-${k}/${stem}.summary.md`, `${RUN_DIR(k)}/${model}/${s}/receipts/${stem}.summary.md`);
  }
  return m;
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));
const readJsonl = (rel) => readText(rel).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sha256 = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');

// Where a file is shown to a reader.
function shown(rel) {
  if (rel.startsWith(`${PUB}/`)) return `<a href="evidence/${esc(rel.slice(PUB.length + 1))}"><code>${esc(rel)}</code></a>`;
  if (rel.startsWith(`${R11PUB}/`)) return `<a href="../011/evidence/${esc(rel.slice(R11PUB.length + 1))}"><code>${esc(rel)}</code></a>`;
  return `<code>${esc(rel)}</code>`;
}

function D(display, value, src, at, fn = 'v', dp = null) {
  const s = Array.isArray(src) ? src.join(' ') : src;
  return `<data value="${esc(value)}" data-src="${esc(s)}" data-at="${esc(at)}" data-fn="${esc(fn)}"${dp == null ? '' : ` data-dp="${dp}"`}>${esc(display)}</data>`;
}
const n3 = (v) => Number(v).toFixed(3);
const n2 = (v) => Number(v).toFixed(2);
const usd = (v) => Number(v).toFixed(2);
const sg3 = (v) => (v >= 0 ? '+' : '') + n3(v);
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
// A count in words, up to ninety-nine; anything else stops the build rather than print a wrong word.
function word(n) {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`no word for ${n}`);
  if (n < WORDS.length) return WORDS[n];
  if (n < 20) return ['eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'][n - 11];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${WORDS[n % 10]}` : '');
}

function srcsOf(html) {
  return [...new Set([...html.matchAll(/data-src="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))];
}
function cite(html) {
  return `<p class="muted cite">Read from: ${srcsOf(html).map(shown).join('; ')}.</p>`;
}
// Every block a heading opens carries its own citation (spec 125 AC-9, as spec 121 AC-5 reads a
// block: from one h2 or h3 to the next), so each tile and each column cites the files its own
// figures read, and a block with no figure cites nothing.
function citeEach(html) {
  return html.replace(/(\n    <div(?: class="tile")?>\n)([\s\S]*?)(\n    <\/div>)/g, (m, open, inner, close) => (srcsOf(inner).length ? `${open}${inner}\n      ${cite(inner)}${close}` : m));
}

// ---- reading ----------------------------------------------------------------
const ARM = (r, mode) => r.results.cases.find((c) => c.mode === mode).generation;
function readAll() {
  const rec = {};
  for (const k of RUNS) for (const model of ARMS) for (const s of SKILLS) rec[`${k}/${model}/${s}`] = readJson(REC(k, model, s));
  for (const s of SKILLS) rec[`r11/${s}`] = readJson(R11(s));
  return rec;
}
const R = (rec, k, model, s) => (model === 'r11' ? rec[`r11/${s}`] : rec[`${k}/${model}/${s}`]);

// The runner's own comparison, and the one label a reader sees for it (Report 011's four).
const LABEL = {
  'separated-up': 'separation detected, upward',
  'separated-down': 'separation detected, downward',
  'no-separation': 'no separation detected',
  underpowered: 'no separation detected; not enough draws to conclude at this effect floor',
};
// THE THREE PLAIN LABELS (spec 125 C-3), one per runner token, and the only words this page uses for
// a result: "too few answers to tell" is never shown as "no clear difference".
const PLAIN = {
  'separated-up': 'clearly higher',
  'separated-down': 'clearly lower',
  'no-separation': 'no clear difference',
  underpowered: 'too few answers to tell',
};
const CHIP = { 'separated-up': 'is-higher', 'separated-down': 'is-lower', 'no-separation': 'is-none', underpowered: 'is-few' };
// One definition of a clear difference for the body and its opening (spec 134 R-9).
const verdictOf = (a, b) => pairVerdict(a, b);
const pairFiles = (kind, k, s) => [REC(k, KINDS[kind].a, s), REC(k, KINDS[kind].b, s), DIFF(kind, k, s)];
function vEl(kind, k, s, v) {
  return D(PLAIN[v.token], v.token, pairFiles(kind, k, s), 'results.cases[mode=with_skill]', 'verdict');
}
// How many of the three runs read a token for one skill and comparison: the files are the three
// runs' pairs, each with its runner output, in run order.
function tallyEl(kind, s, v, token) {
  const n = RUNS.filter((k) => v[kind][k][s].token === token).length;
  return D(WORDS[n], n, RUNS.flatMap((k) => pairFiles(kind, k, s)), token, 'tally', 'w');
}
// How many readings of one comparison, over the named skills and the three runs, carry a token
// (`separated` is either direction). The files are the pairs, skill by skill, each in run order.
function tallyOver(kind, ss, v, token) {
  const n = ss.flatMap((s) => RUNS.map((k) => v[kind][k][s].token)).filter((t) => (token === 'separated' ? t.startsWith('separated') : t === token)).length;
  return D(WORDS[n], n, ss.flatMap((s) => RUNS.flatMap((k) => pairFiles(kind, k, s))), token, 'tally', 'w');
}
function verdicts(rec) {
  const v = {};
  for (const kind of Object.keys(KINDS)) {
    v[kind] = {};
    for (const k of RUNS) {
      v[kind][k] = {};
      for (const s of SKILLS) v[kind][k][s] = verdictOf(R(rec, k, KINDS[kind].a, s), R(rec, k, KINDS[kind].b, s));
    }
  }
  return v;
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
const all27 = () => RUNS.flatMap((k) => ARMS.flatMap((m) => SKILLS.map((s) => REC(k, m, s))));
const sur27 = () => RUNS.flatMap((k) => ARMS.flatMap((m) => SKILLS.map((s) => SUR(k, m, s))));
const armSur = (model) => RUNS.flatMap((k) => SKILLS.map((s) => SUR(k, model, s)));
const armRec = (model) => RUNS.flatMap((k) => SKILLS.map((s) => REC(k, model, s)));

// A mean shown with its band and draws.
function band(rel, r, mode, word = 'draws') {
  const x = ARM(r, mode);
  return `${D(n3(x.mean), x.mean, rel, `results.cases[mode=${mode}].generation.mean`, 'v', 3)} &plusmn; ${D(n3(x.sd), x.sd, rel, `results.cases[mode=${mode}].generation.sd`, 'v', 3)} <span class="muted">(${D(x.n_measured, x.n_measured, rel, `results.cases[mode=${mode}].generation.n_measured`)} ${word})</span>`;
}
const meanEl = (rel, r, mode) => D(n3(ARM(r, mode).mean), ARM(r, mode).mean, rel, `results.cases[mode=${mode}].generation.mean`, 'v', 3);
const liftEl = (rel, r) => D(sg3(r.comparison.delta), r.comparison.delta, rel, 'comparison.delta', 'signed', 3);
const runEl = (k) => `run ${k}`;

// ---- the page's blocks ------------------------------------------------------
function headlineBlock(rec, v) {
  const R0 = REC(1, S55, SKILLS[0]);
  const DA = SKILLS[2]; const two = [SKILLS[0], SKILLS[1]];
  const sepOf = (kind, s) => RUNS.filter((k) => v[kind][k][s].token.startsWith('separated')).length;
  if (sepOf('upgrade', DA) === 0 || two.some((s) => sepOf('upgrade', s) !== 0) || SKILLS.some((s) => sepOf('peer', s) !== 0)) throw new Error('headline: the pattern it states does not hold on these files');
  const T = (kind, ss, token) => tallyOver(kind, ss, v, token);
  const html = `    <p class="big">Claude Sonnet 5.5 on the three skills and cases of Reports 009 and 011, beside fresh Claude Sonnet 5 and Claude Opus 5.5 arms on one Claude Code version, each arm run three times. Read by the runner&rsquo;s own comparison of the with-skill arms, run by run: against Claude Sonnet 5, <code>${DA}</code> reads separation upward in ${T('upgrade', [DA], 'separated-up')} of three runs, and <code>${two[0]}</code> and <code>${two[1]}</code> read separation in ${T('upgrade', two, 'separated')} of six; against Claude Opus 5.5, the three skills read separation in ${T('peer', SKILLS, 'separated')} of nine.</p>
    <p>Every figure below is read from a receipt or a file published beside it, and each block names its files. The target model of the new arm is <code>${D(rec[`1/${S55}/${SKILLS[0]}`].run.model_id, rec[`1/${S55}/${SKILLS[0]}`].run.model_id, R0, 'run.model_id')}</code>, and every draw of every arm was judged by <code>${D(rec[`1/${S55}/${SKILLS[0]}`].run.judge.model_id, rec[`1/${S55}/${SKILLS[0]}`].run.judge.model_id, all27(), 'run.judge.model_id', 'all-equal')}</code>. This report measures what a skill adds to each model on these cases. It makes no claim about any model&rsquo;s coding ability.</p>`;
  return `${html}\n    ${cite(html)}`;
}

function limitsSection(rec) {
  const A = all27();
  const R0 = REC(1, S55, SKILLS[0]);
  const draws = A.flatMap((f) => readJson(f).results.cases.map((c) => c.generation.n_measured));
  const lo = Math.min(...draws); const hi = Math.max(...draws);
  const judge = rec[`1/${S55}/${SKILLS[0]}`].run.judge;
  const cr = SKILLS[0];
  const r11b = ARM(rec[`r11/${cr}`], 'baseline').mean;
  const r1b = ARM(rec[`1/${O55}/${cr}`], 'baseline').mean;
  const html = `  <h2 id="limits">Limits, read these first</h2>
  <div class="card">
    <ul>
      <li><strong>One case per skill.</strong> Each receipt carries a suite of ${SKILLS.map((s) => D(rec[`1/${S55}/${s}`].suite.case_count, rec[`1/${S55}/${s}`].suite.case_count, armRec(S55).filter((f) => f.includes(s)), 'suite.case_count', 'all-equal')).join(', ')} case, in the order ${SKILLS.map((s) => `<code>${esc(s)}</code>`).join(', ')}, the cases Reports 009 and 011 used. Nothing on this page describes how any of the three skills behaves on any other task, or how any of the three models behaves in general.</li>
      <li><strong>Few draws.</strong> Each arm drew between ${D(lo, lo, A, 'results.cases[*].generation.n_measured', 'min')} and ${D(hi, hi, A, 'results.cases[*].generation.n_measured', 'max')} generations, each judged ${D(judge.samples, judge.samples, A, 'run.judge.samples', 'all-equal')} times, and each case&rsquo;s band is the spread across its draws. With one case there is no spread across cases, and each receipt records its combined uncertainty on the lift as absent, <code>${D(rec[`1/${S55}/${SKILLS[0]}`].comparison.delta_uncertainty_unavailable, rec[`1/${S55}/${SKILLS[0]}`].comparison.delta_uncertainty_unavailable, A, 'comparison.delta_uncertainty_unavailable', 'all-equal')}</code>.</li>
      <li><strong>Three runs, and a verdict is read in one run at a time.</strong> Reports 009 and 011 ran each arm once. This report runs every arm three times, one after another, with the same script and settings, because one run&rsquo;s figure can move in the next: Report 011&rsquo;s Claude Opus 5.5 baseline on <code>${cr}</code> read ${D(n2(r11b), r11b, R11(cr), 'results.cases[mode=baseline].generation.mean', 'v', 2)}, and the same arm in this report&rsquo;s run 1 read ${D(n2(r1b), r1b, REC(1, O55, cr), 'results.cases[mode=baseline].generation.mean', 'v', 2)}. Each verdict below is the runner&rsquo;s comparison of two receipts from one run. Across the three runs the page counts those verdicts; it pools no draws and reads no verdict across runs.</li>
      <li><strong>The judge is not one of the three arms, and it is Report 009&rsquo;s.</strong> Every draw was judged by <code>${D(judge.model_id, judge.model_id, A, 'run.judge.model_id', 'all-equal')}</code>, as in Reports 009 and 011. It is not the judge the <a href="/judge-policy/">judge policy</a> fixes for Driftproof&rsquo;s reports, so these figures are comparable with Reports 009 and 011 and not with Reports 001 to 008.</li>
      <li><strong>A verdict reads the with-skill arms only.</strong> The runner&rsquo;s comparison of two receipts sets one receipt&rsquo;s with-skill band against the other&rsquo;s, per case. The second question is about lift, what the skill adds over the same model without it. The runner does not compare lifts, so the lifts are shown as context and no verdict on this page is read from them.</li>
      <li><strong>The harness check moves more than Claude Code.</strong> It sets Report 011&rsquo;s Claude Opus 5.5 receipts, one run on an older Claude Code, beside this report&rsquo;s three Claude Opus 5.5 runs. The date changed too, and every generation is a fresh draw, so a separation there could not be put down to the Claude Code version alone. Report 011&rsquo;s sidecars record no per-call effort state, so whether Claude Code applied a per-turn effort there, as it did in all of this report&rsquo;s Claude Opus 5.5 calls, is not known.</li>
      <li><strong>Verification levels.</strong> All ${D(A.length, A.length, A, 'verification_level', 'count')} receipts of this report are <code>${D(rec[`1/${S55}/${SKILLS[0]}`].verification_level, rec[`1/${S55}/${SKILLS[0]}`].verification_level, A, 'verification_level', 'all-equal')}</code>, each answered by a model the surface attested (<code>answered_by.kind</code> <code>${D(rec[`1/${S55}/${SKILLS[0]}`].run.answered_by.kind, rec[`1/${S55}/${SKILLS[0]}`].run.answered_by.kind, A, 'run.answered_by.kind', 'all-equal')}</code> in every one).</li>
    </ul>
  </div>`;
  return html.replace(/\n  <\/div>$/, `\n    ${cite(html)}\n  </div>`);
}

function departuresSection(rec) {
  const S0 = SUR(1, S55, SKILLS[0]);
  const cliNow = readJson(S0).claude_code.pinned_version;
  const cli11 = readJson(R11SUR(SKILLS[0])).claude_code.pinned_version;
  const cli9 = readJson(R11RECORD).surface_departure.run_record_cli;
  const recJ = readJson(RECORD(1));
  const rows = recJ.registry.rows;
  const effort = (m) => {
    const files = armSur(m);
    const vals = files.flatMap((f) => readJson(f).calls.filter((c) => c.requested === m).map((c) => c.per_turn_effort_active));
    const n = vals.length;
    return `<code>${esc(m)}</code> ${D(String(vals[0]), vals[0], files, `calls[requested=${m}].per_turn_effort_active`, 'all-equal')} in all ${D(n, n, files, `calls[requested=${m}]`, 'count')} of its generation calls across the three runs`;
  };
  const judgeId = rec[`1/${S55}/${SKILLS[0]}`].run.judge.model_id;
  const judgeFiles = sur27();
  const jv = judgeFiles.flatMap((f) => readJson(f).calls.filter((c) => c.requested === judgeId).map((c) => c.per_turn_effort_active));
  const foot = 'The previously scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur';
  const capRe = 'if n >= ([0-9]+):';
  const cap = new RegExp(capRe).exec(readText(GUARD()))[1];
  const cap11 = new RegExp(capRe).exec(readText(R11GUARD))[1];
  const pcRe = 'per-model cap: ([0-9]+)';
  const perSkill = new RegExp(pcRe).exec(readText(OUTF(1, S55, SKILLS[0])))[1];
  const price = (id, f) => D(String(rows[id][f]), rows[id][f], RECORD(1), `registry.rows.${id}.${f}`);
  const MODELS = 'config/models.json';
  const regRow = (id) => readJson(MODELS).models.find((x) => x.id === id);
  const regPrice = (id, f) => D(String(regRow(id)[f]), regRow(id)[f], MODELS, `models[id=${id}].${f}`);
  const psrc = rec[`1/${S55}/${SKILLS[0]}`].run.pricing_snapshot.source;
  const html = `  <h2 id="departures">What departs from Reports 009 and 011</h2>
  <div class="card">
    <ul>
      <li><strong>One Claude Code version for every arm.</strong> Every call of every arm ran on Claude Code <code>${D(cliNow, cliNow, sur27(), 'claude_code.pinned_version', 'all-equal')}</code>, installed at the npm integrity the run record states. Report 009 ran on <code>${D(cli9, cli9, R11RECORD, 'surface_departure.run_record_cli')}</code> and Report 011 on <code>${D(cli11, cli11, R11SUR(SKILLS[0]), 'claude_code.pinned_version')}</code>. The runner writes no Claude Code version into a receipt, and a receipt is sealed, so each receipt has a sidecar, <code>&lt;receipt&gt;.surface.json</code>, bound to it by its <code>receipt_hash</code> and recording the version each of its calls reported: <code>${D(cliNow, cliNow, sur27(), 'claude_code.versions_reported_by_calls[*]', 'all-equal')}</code> in all of them.</li>
      <li><strong>Effort and thinking at Claude Code&rsquo;s defaults.</strong> No arm was given an effort or thinking setting, as in Reports 009 and 011. Each call&rsquo;s first event records whether Claude Code applied a per-turn effort, and the sidecars carry it: ${ARMS.map(effort).join('; ')}. The judge&rsquo;s calls read ${D(String(jv[0]), jv[0], judgeFiles, `calls[requested=${judgeId}].per_turn_effort_active`, 'all-equal')}. So the arms ran on the same surface with each model&rsquo;s own default, and not at one effort.</li>
      <li><strong>The prices are this run&rsquo;s own.</strong> The runner&rsquo;s registry had no row for <code>${S55}</code>. This run used a copy of it with that row added at ${price(S55, 'input_price')} and ${price(S55, 'output_price')} dollars per million input and output tokens, <code>${S5}</code> at ${price(S5, 'input_price')} and ${price(S5, 'output_price')}, and <code>${O55}</code> at ${price(O55, 'input_price')} and ${price(O55, 'output_price')}, each read from the vendor&rsquo;s pricing page on the day of the run (<code>${SNAP_NAME}</code>). For <code>${S5}</code> the page&rsquo;s footnote reads <q>${D(foot, foot, SNAP(), foot, 'quote')}</q>. The rows are this run&rsquo;s only; the product&rsquo;s registry does not carry them. The runner&rsquo;s registry, <code>${MODELS}</code>, prices <code>${S5}</code> at ${regPrice(S5, 'input_price')} and ${regPrice(S5, 'output_price')}, and each receipt&rsquo;s <code>pricing_snapshot.source</code> names that file, <code>${D(psrc, psrc, all27(), 'run.pricing_snapshot.source', 'all-equal')}</code>, although its prices are this run&rsquo;s copy. Prices change the estimated cost below and no score.</li>
      <li><strong>A larger call cap across the run.</strong> A guard in front of Claude Code allowed ${D(cap, cap, GUARD(), capRe, 're')} calls per run, where Report 011&rsquo;s allowed ${D(cap11, cap11, R11GUARD, capRe, 're')}: nine skill runs where Report 011 ran six. Per skill run the runner&rsquo;s own cap stands at ${D(perSkill, perSkill, OUTF(1, S55, SKILLS[0]), pcRe, 're')} calls. The guard also stops a run when a call reports any model other than the one it asked for; no run stopped.</li>
    </ul>
  </div>`;
  return html.replace(/\n  <\/div>$/, `\n    ${cite(html)}\n  </div>`);
}

function setupSection(rec) {
  const floorRe = 'EFFECT_FLOOR = ([0-9]+\\.[0-9]+)';
  const floor = new RegExp(floorRe).exec(readText('config.js'))[1];
  if (Number(floor) !== EFFECT_FLOOR) throw new Error('config.js floor text and value disagree');
  const same = (at) => SKILLS.map((s) => {
    const files = [...RUNS.flatMap((k) => ARMS.map((m) => REC(k, m, s))), R11(s)];
    const val = at.split('.').reduce((o, k) => o[k], readJson(files[0]));
    return `<code>${esc(s)}</code> <code>${D(val.slice(0, 12), val, files, at, 'same-prefix')}</code>`;
  }).join(', ');
  const R0 = REC(1, S55, SKILLS[0]);
  const r0 = rec[`1/${S55}/${SKILLS[0]}`];
  const everyWith11 = [...all27(), R11(SKILLS[0])];
  const tpl = r0.run.judge.prompt_template_hash;
  const html = `  <h2 id="setup">What stayed fixed</h2>
  <div class="card">
    <p><strong>The inputs are Reports 009 and 011&rsquo;s.</strong> The same SKILL.md bytes (<code>skill.content_hash</code>, the same in all of this report&rsquo;s receipts and Report 011&rsquo;s for each skill: ${same('skill.content_hash')}) and the same suites (<code>suite.suite_hash</code>: ${same('suite.suite_hash')}).</p>
    <p><strong>The runner is theirs.</strong> Driftproof runner <code>${D(r0.run.runner_version, r0.run.runner_version, everyWith11, 'run.runner_version', 'same')}</code> on the <code>${D(r0.run.surface, r0.run.surface, all27(), 'run.surface', 'all-equal')}</code> surface, with the flags their runs used: at most ${D('80', '80', OUTF(1, S55, SKILLS[0]), 'per-model cap: ([0-9]+)', 're')} calls and ${D('8.00', '8.00', OUTF(1, S55, SKILLS[0]), 'budget \\$([0-9]+\\.[0-9]+)', 're')} dollars of estimated spend per skill run. It puts the SKILL.md text in the prompt for the with-skill arm and gives the baseline arm the task alone, with no tools in either. It draws generations per arm until the spread settles or a maximum is reached, and the judge scores each draw against the case&rsquo;s rubric on a continuous 0 to 1 scale.</p>
    <p><strong>The judge is theirs.</strong> <code>${D(r0.run.judge.model_id, r0.run.judge.model_id, everyWith11, 'run.judge.model_id', 'same')}</code>, with the grading template <code>${D(tpl.slice(0, 12), tpl, everyWith11, 'run.judge.prompt_template_hash', 'same-prefix')}</code> in every receipt.</p>
    <p><strong>The rule.</strong> A case&rsquo;s band is its mean across draws plus or minus the sample standard deviation across draws: a descriptive spread with no coverage probability. Two with-skill bands separate under the rule when they do not overlap and their means differ by at least the ${D(floor, floor, 'config.js', floorRe, 're')} effect floor. A case that does not separate is read under spec 035&rsquo;s rule: when the two arms&rsquo; spreads and draws could not have resolved a shift of the floor&rsquo;s size, it reads <q>not enough draws to conclude at this effect floor</q>, and otherwise <q>no separation detected</q>. Neither is evidence that nothing differs. The verdicts are the runner&rsquo;s: <code>driftproof diff</code> over each pair, whose outputs are published below.</p>
  </div>`;
  return html.replace('\n  </div>', `\n    ${cite(html)}\n  </div>`);
}

// One comparison as a table: a row per skill and run, then a row per skill for the three runs together.
function tableSection(kind, rec, v) {
  const { a, b } = KINDS[kind];
  const rows = [];
  for (const s of SKILLS) {
    for (const k of RUNS) {
      const ra = R(rec, k, a, s); const rb = R(rec, k, b, s);
      const fa = REC(k, a, s); const fb = REC(k, b, s);
      const d = ARM(rb, 'with_skill').mean - ARM(ra, 'with_skill').mean;
      rows.push(`      <tr><td><code>${esc(s)}</code></td><td>${runEl(k)}</td>`
        + `<td>${band(fa, ra, 'with_skill', 'answers')}</td>`
        + `<td>${band(fb, rb, 'with_skill', 'answers')}</td>`
        + `<td>${D(sg3(d), d, [fa, fb], 'results.cases[mode=with_skill].generation.mean', 'delta', 3)}</td>`
        + `<td>${vEl(kind, k, s, v[kind][k][s])}</td>`
        + `<td>${liftEl(fa, ra)}; ${liftEl(fb, rb)}</td></tr>`);
    }
    const fas = RUNS.map((k) => REC(k, a, s)); const fbs = RUNS.map((k) => REC(k, b, s));
    const W = 'results.cases[mode=with_skill].generation.mean';
    const range = (fs2) => `${D(n3(Math.min(...fs2.map((f) => ARM(readJson(f), 'with_skill').mean))), Math.min(...fs2.map((f) => ARM(readJson(f), 'with_skill').mean)), fs2, W, 'min', 3)} to ${D(n3(Math.max(...fs2.map((f) => ARM(readJson(f), 'with_skill').mean))), Math.max(...fs2.map((f) => ARM(readJson(f), 'with_skill').mean)), fs2, W, 'max', 3)}`;
    const lifts = (fs2) => `${D(sg3(Math.min(...fs2.map((f) => readJson(f).comparison.delta))), Math.min(...fs2.map((f) => readJson(f).comparison.delta)), fs2, 'comparison.delta', 'min', 3)} to ${D(sg3(Math.max(...fs2.map((f) => readJson(f).comparison.delta))), Math.max(...fs2.map((f) => readJson(f).comparison.delta)), fs2, 'comparison.delta', 'max', 3)}`;
    const tally = Object.keys(PLAIN).filter((t) => RUNS.some((k) => v[kind][k][s].token === t))
      .map((t) => `${PLAIN[t]} in ${tallyEl(kind, s, v, t)} of three`).join('; ');
    const aRange = kind === 'harness' ? `${meanEl(R11(s), rec[`r11/${s}`], 'with_skill')} <span class="muted">(one run)</span>` : range(fas);
    const aLift = kind === 'harness' ? liftEl(R11(s), rec[`r11/${s}`]) : lifts(fas);
    rows.push(`      <tr class="together"><td><code>${esc(s)}</code></td><td>the three runs</td>`
      + `<td>${aRange}</td><td>${range(fbs)}</td><td></td><td>${tally}</td><td>${aLift}; ${lifts(fbs)}</td></tr>`);
  }
  const head = {
    upgrade: { id: 'model', h: `${HN(S55)} against ${HN(S5)}, every run`, a: `${HN(S5)}, with the skill`, b: `${HN(S55)}, with the skill`, ctx: `${HN(S5)}; ${HN(S55)}` },
    peer: { id: 'peer', h: `${HN(S55)} against ${HN(O55)}, every run`, a: `${HN(O55)}, with the skill`, b: `${HN(S55)}, with the skill`, ctx: `${HN(O55)}; ${HN(S55)}` },
    harness: { id: 'harness', h: `${HN(O55)} against Report 011, every run`, a: 'Report 011, with the skill', b: 'this report, with the skill', ctx: 'Report 011; this report' },
  }[kind];
  const table = `  <h3 id="${head.id}">${head.h}</h3>
  <table class="summary">
    <thead><tr><th scope="col">task</th><th scope="col">run</th><th scope="col">${head.a}: average &plusmn; spread (answers)</th><th scope="col">${head.b}: average &plusmn; spread (answers)</th><th scope="col">gap with the skill</th><th scope="col">result</th><th scope="col">what the skill added (${head.ctx})</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>`;
  const cap = {
    upgrade: 'The gap with the skill is the second average minus the first, in the same run. The result compares the two with-skill spreads, as the key under the first table says; the gap and what the skill added are shown beside it and decide nothing. What the skill added is a model&rsquo;s average with the skill minus its average without it. The row for the three runs gives the lowest and highest figures across the runs, and counts the results.',
    peer: `The same columns, with Claude Opus 5.5 first. The result compares the with-skill scores only; what the skill added to each model is shown beside it and decides nothing. The vendor&rsquo;s list prices for the two models are under what differs.${kind === 'peer' ? pitchSentence() : ''}`,
    harness: 'The same columns, with Report 011&rsquo;s receipt first. Report 011 ran once, so its side of each row is the same receipt in all three runs. Report 011&rsquo;s receipts are published with that report and linked here, not copied.',
  }[kind];
  return `${table}
  <p class="muted">${cap}</p>
  ${cite(rows.join('\n') + cap)}`;
}

// The readings. Each sentence that states a pattern is checked here against the files first,
// and the render stops when the pattern does not hold, so a re-run cannot leave a stale sentence.
function readingsSection(rec, v) {
  const must = (ok, what) => { if (!ok) throw new Error(`readings: ${what} does not hold on these files`); };
  const CR = SKILLS[0]; const GW = SKILLS[1]; const DA = SKILLS[2];
  const tokens = (kind, s) => RUNS.map((k) => v[kind][k][s].token);
  const sep = (kind, s) => tokens(kind, s).filter((t) => t.startsWith('separated')).length;
  const lift = (k, m, s) => R(rec, k, m, s).comparison.delta;
  const base = (k, m, s) => ARM(R(rec, k, m, s), 'baseline').mean;
  const liftList = (m, s) => RUNS.map((k) => liftEl(REC(k, m, s), R(rec, k, m, s))).join(', ');
  const baseList = (m, s) => RUNS.map((k) => meanEl(REC(k, m, s), R(rec, k, m, s), 'baseline')).join(', ');

  // 1. The upgrade.
  must(RUNS.every((k) => SKILLS.every((s) => v.upgrade[k][s].token !== 'separated-down')), 'no downward separation in the upgrade');
  must(sep('upgrade', CR) === 0 && sep('upgrade', GW) === 0 && sep('upgrade', DA) >= 2, 'the upgrade pattern (none on two skills, upward on documentation in most runs)');
  must(RUNS.every((k) => lift(k, S55, CR) < lift(k, S5, CR) && base(k, S55, CR) > base(k, S5, CR)), 'Sonnet 5.5 lifts less on code review, from a higher baseline, in every run');
  const c1 = `  <p class="claim" data-claim="1"><strong>1. With the skill, Claude Sonnet 5.5 separates upward from Claude Sonnet 5 on <code>${DA}</code> in ${tallyEl('upgrade', DA, v, 'separated-up')} of three runs, and downward in ${tallyOver('upgrade', SKILLS, v, 'separated-down')} of nine readings.</strong> On <code>${CR}</code> and <code>${GW}</code> it detects separation in ${tallyOver('upgrade', [CR, GW], v, 'separated')} of six readings, and in ${tallyOver('upgrade', [CR, GW], v, 'underpowered')} of those six readings the draws could not have told. What the skill adds is another matter: on <code>${CR}</code> Claude Sonnet 5&rsquo;s lift is ${liftList(S5, CR)} across the runs and Claude Sonnet 5.5&rsquo;s ${liftList(S55, CR)}, because Claude Sonnet 5.5 without the skill already reads ${baseList(S55, CR)}, against Claude Sonnet 5&rsquo;s ${baseList(S5, CR)}. So on these cases the rule reads no downward separation in the upgrade, on any skill in any run, and on <code>${CR}</code> Claude Sonnet 5.5&rsquo;s lift is the smaller in every run, from a higher score without it. The runner&rsquo;s comparison of two receipts reads no lift, so that second part is context, not a verdict.</p>`;

  // 2. Sonnet 5.5 and Opus 5.5.
  must(SKILLS.every((s) => sep('peer', s) === 0), 'no separation between Sonnet 5.5 and Opus 5.5');
  must(RUNS.every((k) => lift(k, O55, GW) > lift(k, S55, GW) && base(k, O55, GW) < base(k, S55, GW)), 'Opus 5.5 lifts more on git workflow, from a lower baseline, in every run');
  must(RUNS.every((k) => lift(k, S55, DA) > 0 && lift(k, O55, DA) > 0), 'both arms lift on documentation in every run');
  const c2 = `  <p class="claim" data-claim="2"><strong>2. With the skill, the rule separates Claude Sonnet 5.5 from Claude Opus 5.5 in ${tallyOver('peer', SKILLS, v, 'separated')} of nine readings; the lifts differ where the baselines do.</strong> Of the nine readings, ${tallyOver('peer', SKILLS, v, 'underpowered')} are not enough draws to conclude at this effect floor. On <code>${GW}</code> Claude Opus 5.5&rsquo;s lift is ${liftList(O55, GW)} and Claude Sonnet 5.5&rsquo;s ${liftList(S55, GW)}; with the skill the rule detects separation in ${tallyOver('peer', [GW], v, 'separated')} of three runs, and without it Claude Opus 5.5 reads ${baseList(O55, GW)} where Claude Sonnet 5.5 reads ${baseList(S55, GW)}. On <code>${DA}</code> both lifts are above zero in every run: Claude Sonnet 5.5 by ${liftList(S55, DA)}, Claude Opus 5.5 by ${liftList(O55, DA)}. So on these cases the skill does not take Claude Sonnet 5.5 to a with-skill score the rule can tell apart from Claude Opus 5.5&rsquo;s, and how much it adds depends on where each model starts without it. The runner does not compare lifts, and none of this is a statement about either model&rsquo;s coding ability. Each receipt&rsquo;s own reading of its lift is on its receipt page; a lift is context here, and none is read as a gain.</p>`;

  // 3. The harness check.
  must(sep('harness', CR) === 0 && sep('harness', GW) === 0, 'no harness separation on code review or git workflow');
  must(RUNS.every((k) => v.harness[k][DA].token !== 'separated-down'), 'no downward harness separation on documentation');
  const r11da = ARM(rec[`r11/${DA}`], 'with_skill');
  const c3 = `  <p class="claim" data-claim="3"><strong>3. Claude Opus 5.5 on this report&rsquo;s Claude Code separates from Report 011&rsquo;s receipts upward on <code>${DA}</code> in some runs and not others.</strong> On <code>${DA}</code> the rule reads separation upward in ${tallyEl('harness', DA, v, 'separated-up')} of the three runs, against Report 011&rsquo;s single run, whose spread there was ${D(n3(r11da.sd), r11da.sd, R11(DA), 'results.cases[mode=with_skill].generation.sd', 'v', 3)}. On <code>${CR}</code> and <code>${GW}</code> it detects separation in ${tallyOver('harness', [CR, GW], v, 'separated')} of six readings. Report 011 is one run, and this report&rsquo;s own runs differ from each other, so this is a statement about these draws on two Claude Code versions and two dates, not about Claude Code.</p>`;

  // 4. Run to run.
  const flips = SKILLS.flatMap((s) => Object.keys(KINDS).map((kind) => new Set(tokens(kind, s)).size > 1 ? 1 : 0)).reduce((x, y) => x + y, 0);
  must(flips > 0, 'a reading that differs between runs');
  const o55b = RUNS.map((k) => base(k, O55, CR));
  const s5w = RUNS.map((k) => ARM(R(rec, k, S5, CR), 'with_skill'));
  const lowK = s5w.indexOf(s5w.reduce((x, y) => (y.mean < x.mean ? y : x)));
  must(s5w.every((x, i) => i === lowK || x.sd < s5w[lowK].sd), 'the lowest Sonnet 5 code-review run has the widest spread');
  const c4 = `  <p class="claim" data-claim="4"><strong>4. The runs differ from each other, which is why there are three.</strong> Of the nine skill and comparison pairs, ${D(WORDS[flips], flips, Object.keys(KINDS).flatMap((kind) => SKILLS.flatMap((s) => RUNS.flatMap((k) => pairFiles(kind, k, s)))), 'differs', 'tally', 'w')} read a different verdict in one run than in another. Claude Opus 5.5&rsquo;s baseline on <code>${CR}</code> read ${baseList(O55, CR)} across the three runs. Claude Sonnet 5&rsquo;s with-skill arm on the same skill read ${band(REC(lowK + 1, S5, CR), R(rec, lowK + 1, S5, CR), 'with_skill')} in ${runEl(lowK + 1)}, against ${RUNS.filter((k) => k !== lowK + 1).map((k) => band(REC(k, S5, CR), R(rec, k, S5, CR), 'with_skill')).join(' and ')} in the other two. A reading from one run of one case is one reading; the counts above say how often it came back.</p>`;
  const all = [c1, c2, c3, c4].join('\n');
  return `  <h2 id="readings">Four readings</h2>
${all}
  ${cite(all)}`;
}

function runRecordSection(rec) {
  const A = all27();
  const capRe = 'if n >= ([0-9]+):';
  const cap = new RegExp(capRe).exec(readText(GUARD()))[1];
  const tRe = 'timeout=([0-9]+)\\)';
  const tmo = new RegExp(tRe).exec(readText(GUARD()))[1];
  const runP = RUNS.map((k) => {
    const status = readJsonl(STATUS(k));
    const recJ = readJson(RECORD(k));
    const calls = callsOf(status, '*', '*');
    const unmeasured = ARMS.flatMap((m) => SKILLS.map((s) => REC(k, m, s))).flatMap((f) => readJson(f).results.cases.map((c) => c.generation.n_unmeasured)).reduce((x, y) => x + y, 0);
    const last = status[status.length - 1];
    return `      <li><strong>${runEl(k)}</strong>, <code>${D(recJ.stamp, recJ.stamp, RECORD(k), 'stamp')}</code>: ${D(WORDS[status.length], status.length, STATUS(k), '[*]', 'count', 'w')} status lines, each with exit status ${D('0', '0', STATUS(k), '[*].exit', 'all-equal')} and ${D(WORDS[1], 1, STATUS(k), '[*].receipts', 'all-equal', 'w')} receipt, the last at <code>${D(last.at, last.at, STATUS(k), `[skill=${last.skill}][model=${last.model}].at`)}</code>; ${D(calls, calls, STATUS(k), '*|*', 'calls')} calls; ${D(unmeasured, unmeasured, ARMS.flatMap((m) => SKILLS.map((s) => REC(k, m, s))), 'results.cases[*].generation.n_unmeasured', 'sum')} unmeasured draws.</li>`;
  }).join('\n');
  const rlog = 'three-runs.sh died waiting on the quiet marker, run 3 not started';
  const r3 = 'run 3 exit 0';
  const inner = `    <p><strong>The runs.</strong> Each run went arm by arm, <code>${S55}</code> first, then <code>${S5}</code>, then <code>${O55}</code>, one skill at a time, <code>${SKILLS[0]}</code> first in each. The command file writes a status line after each skill run. The three runs went one after another with the same script and settings. Their log records that the script driving the second and third stopped after the second, in its words <q>${D(rlog, rlog, RUNSLOG(), rlog, 'quote')}</q>, and that the third then ran, <q>${D(r3, r3, RUNSLOG(), r3, 'quote')}</q>. Each receipt&rsquo;s <code>run.date_utc</code> is written by the runner and is not read here as a start or a finish.</p>
    <ul>
${runP}
    </ul>
    <p><strong>The caps.</strong> A guard in front of Claude Code allowed ${D(cap, cap, GUARD(), capRe, 're')} calls per run and ${D(tmo, tmo, GUARD(), tRe, 're')} seconds per call.</p>
`;
  const rows = RUNS.flatMap((k) => ARMS.map((m) => {
    const status = readJsonl(STATUS(k));
    const files = SKILLS.map((s) => REC(k, m, s));
    const rs = SKILLS.map((s) => rec[`${k}/${m}/${s}`]);
    const t = (w) => rs.map((r) => costOf(r, w)).reduce((x, y) => x + y, 0);
    const calls = callsOf(status, m, '*');
    return `      <tr><td>${runEl(k)}</td><td><code>${esc(m)}</code></td>`
      + `<td>${D(calls, calls, STATUS(k), `${m}|*`, 'calls')}</td>`
      + `<td>${D(usd(t('generation')), t('generation'), files, 'generation', 'cost', 2)}</td>`
      + `<td>${D(usd(t('judge')), t('judge'), files, 'judge', 'cost', 2)}</td>`
      + `<td>${D(usd(t('all')), t('all'), files, 'all', 'cost', 2)}</td></tr>`;
  })).join('\n');
  const tot = (w) => A.map((f) => costOf(readJson(f), w)).reduce((x, y) => x + y, 0);
  const meteredRe = 'actual metered spend on claude-cli: \\$([0-9]+\\.[0-9]+)';
  const outs = RUNS.flatMap((k) => ARMS.flatMap((m) => SKILLS.map((s) => OUTF(k, m, s))));
  const metered = new RegExp(meteredRe).exec(readText(outs[0]))[1];
  if (outs.some((f) => (new RegExp(meteredRe).exec(readText(f)) || [])[1] !== metered)) throw new Error('run record: the metered spend differs across the console outputs');
  const cost = `    <p><strong>The cost.</strong> Metered spend, as the runner reports it, was ${D(metered, metered, outs, meteredRe, 're-all')} dollars in each skill run&rsquo;s console output: the <code>claude-cli</code> surface runs on a subscription. The estimated API-equivalent below is every draw&rsquo;s generation and judge token counts, as each receipt records them, at the prices each receipt froze, with cached input counted at the full input price, as the runner counts it.</p>`;
  const table = `  <table class="summary">
    <thead><tr><th scope="col">run</th><th scope="col">arm</th><th scope="col">calls</th><th scope="col">generation, estimated USD</th><th scope="col">judge, estimated USD</th><th scope="col">total, estimated USD</th></tr></thead>
    <tbody>
${rows}
      <tr><td colspan="3">all three runs</td><td>${D(usd(tot('generation')), tot('generation'), A, 'generation', 'cost', 2)}</td><td>${D(usd(tot('judge')), tot('judge'), A, 'judge', 'cost', 2)}</td><td>${D(usd(tot('all')), tot('all'), A, 'all', 'cost', 2)}</td></tr>
    </tbody>
  </table>`;
  const integ = `    <p><strong>Integrity.</strong> Each receipt validates with its receipt hash verified, and each sidecar names its receipt&rsquo;s hash. The raw call records carry the SKILL.md text and stay unpublished; each run&rsquo;s list of their sha256 is published.</p>`;
  const body = `${inner}${cost}\n${table}\n${integ}`;
  return `  <h2 id="run-record">Run record</h2>
  <div class="card">
${body}
    ${cite(body + RUNS.map((k) => ` data-src="${CALLSUMS(k)}"`).join(''))}
  </div>`;
}

function evidenceBlock() {
  const names = [...evidenceSet().keys()].sort();
  return `  <h2 id="evidence">Published evidence</h2>
  <details class="card" open><summary><strong>The files this report makes public.</strong> For each run, the nine receipts with their summaries, surface sidecars and the runner&rsquo;s console output, the run record, its registry copy, the status lines and the sha256 of every raw call record; the twenty-seven <code>driftproof diff</code> outputs the verdicts are read from; the log of the three runs; the pricing snapshot; and the call guard. The pricing snapshot records the sha256 of the page it was read from; that page is not published. Each sidecar&rsquo;s <code>surface_note</code> path is relative to the operator&rsquo;s run directory; the run record it names is <code>run-&lt;k&gt;/run-record.json</code> here.</summary>
    <ul>
${names.map((n) => { const f = `${PUB}/${n}`; return `      <li><a href="evidence/${esc(n)}"><code>${esc(f)}</code></a><br><span class="muted">sha256 <code>${D(sha256(evidenceSet().get(n)), sha256(evidenceSet().get(n)), f, '', 'sha256')}</code></span></li>`; }).join('\n')}
    </ul>
    <p class="muted">Report 011&rsquo;s three Claude Opus 5.5 receipts, the other side of the harness check, are published with that report: ${SKILLS.map((s) => `<a href="../011/evidence/${esc(R11(s).slice(R11PUB.length + 1))}"><code>${esc(s)}</code></a>`).join(', ')}. Validate a receipt with <code>npx driftproof validate &lt;file&gt;</code>. Each copy here is byte-identical to its twin under <code>${esc(SPEC)}/</code>, and each sidecar names the receipt it belongs to and that receipt&rsquo;s hash.</p>
  </details>`;
}

// THE RECEIPTS SECTION THE REPORT CARD LINKS (spec 021 AC-18). The receipts sit in three
// directories, one per run, so the card says "linked receipts" and links this page's own Receipts
// section, which has to list every one of them; site-chrome.js puts the anchor before the heading.
function receiptsBlock() {
  const copies = new Set(receiptCopies().keys());
  const items = RUNS.flatMap((k) => ARMS.flatMap((m) => SKILLS.map((s) => {
    const c = `${RECEIPTS}/run-${k}/${s}-${m}-${DATE}.json`;
    if (!copies.has(c)) throw new Error(`not a receipt copy: ${c}`);
    return `      <li><code>${esc(s)}</code>@<code>${esc(m)}</code> <span class="muted">(run ${k})</span>: <a href="https://github.com/driftproofhq/driftproof/blob/main/${esc(c)}"><code>${esc(c)}</code></a></li>`;
  })));
  return `  <h2>Receipts</h2>
  <details class="card" open><summary><strong>Every receipt this report rests on, each one resolvable.</strong> Nine for each run, one per model and skill, the same bytes as the evidence copies above.</summary>
    <ul>
${items.join('\n')}
    </ul>
    <p class="muted">Validate any of them with <code>npx driftproof validate &lt;file&gt;</code>, and reproduce a verdict with <code>npx driftproof diff &lt;first&gt; &lt;second&gt;</code> over two receipts of one run.</p>
  </details>`;
}

// THE VENDOR'S PITCH IS QUOTED ONLY WITH ITS SOURCE (a standing rule of the reports). The quote is rendered
// when a committed record names it: evidence/vendor-pitch.json, {"url", "fetched_at", "quote",
// "kept_as"}, with the page it was read from kept as the named file beside it; the probe finds the
// quote in that file. With no record the page quotes nothing and says so.
const PITCH = `${SPEC}/evidence/vendor-pitch.json`;
function pitchSentence() {
  if (!fs.existsSync(path.join(ROOT, PITCH))) return ' No vendor statement about these two models is committed with this report, so none is quoted, and nothing on this page tests one.';
  const p = readJson(PITCH);
  const kept = pub(p.kept_as);
  return ` The vendor&rsquo;s own statement, read on ${D(p.fetched_at, p.fetched_at, pub('vendor-pitch.json'), 'fetched_at')} from <a href="${esc(p.url)}">${esc(p.url)}</a>: <q>${D(p.quote, p.quote, kept, p.quote, 'quote')}</q>. This page tests no part of it: it reads what a skill adds, not coding ability.`;
}

// ── the page as a reader meets it (spec 125) ─────────────────────────────────
//
// THE FIRST SCREEN IS PLAIN, AND NOTHING IS LOST. Spec 125 rearranged this page for a reader who has
// never seen the instrument: the summary (the chrome's, under the title), one table with every
// comparison in every run, a chart, four short readings and the limits beside what differs. The full
// tables, the set-up, the run record and the files are folded at the bottom, and the first version's
// headline and readings are kept in the Amendments section as published. Every figure is still a
// <data> element naming its files, read from the same receipts.
const SKILL_NAME = { 'code-review-and-quality': 'code review', 'git-workflow-and-versioning': 'git workflow', 'documentation-and-adrs': 'documentation' };
const PAIRS = [
  ['upgrade', `${HN(S55)} against ${HN(S5)}`],
  ['peer', `${HN(S55)} against ${HN(O55)}`],
  ['harness', `${HN(O55)} against Report 011`],
];
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// THE HEADINGS STATE THE QUESTION THEY ANSWER (spec 134, amendment two). Each entry is the heading as
// first published and the question that replaced it; a model is named by scripts/model-names.js from
// its id. Amendment two lists every pair, so the first version's headings stay on the page.
const HEADINGS = {
  result: ['Every comparison, every run', () => 'How did each comparison come out, run by run?'],
  every: ['Every run, without the skill and with it', () => 'What did each model score, without the skill and with it?'],
  show: ['What the runs show', () => 'What do the runs show?'],
  upgrade: ['Sonnet 5.5 against Sonnet 5', () => `Did ${HN(S55)} score differently from ${HN(S5)}?`],
  peer: ['Sonnet 5.5 against Opus 5.5', () => `Did ${HN(S55)} score differently from ${HN(O55)}?`],
  harness: ['Opus 5.5 against Report 011', () => `Did ${HN(O55)} score as it did in Report 011?`],
  why: ['Why three runs', () => 'Why run every test three times?'],
  limits: ['Limits, and what differs from Reports 009 and 011', () => 'What are the limits, and what differs from Reports 009 and 011?'],
  lim: ['Limits', () => 'What does this report not show?'],
  differs: ['What differs', () => 'What differs from Reports 009 and 011?'],
};
const heading = (k) => HEADINGS[k][1]();
// THE QUESTION HEADINGS KEEP THEIR FIRST ANCHORS (the operator's ruling of 1 Oct 2026, "keep old
// anchors"). The contents rail gave each <h2> of the body an id from its text as first published
// (site-chrome.js slugOf, an id already taken on the page suffixed -2, -3 and so on). A question
// heading carries that id itself, so a link made before amendment two still lands, and the rail reads
// it rather than an id from the new text. Each id is derived here from the first wording, never typed.
function keepAnchors(html) {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  let out = html;
  for (const [was, now] of Object.values(HEADINGS)) {
    const tag = `<h2>${now()}</h2>`;
    if (!out.includes(tag)) continue;
    if (out.split(tag).length !== 2) throw new Error(`more than one heading reads ${now()}`);
    const base = slugOf(was);
    let id = base;
    for (let k = 2; ids.has(id); k++) id = `${base}-${k}`;
    ids.add(id);
    out = out.replace(tag, `<h2 id="${id}">${now()}</h2>`);
  }
  return out;
}
const RELEASE = () => pub('release-date.json');
const dayMon = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}`; };
function releaseEl() {
  const r = readJson(RELEASE());
  return D(dayMon(r.released_on), r.released_on, RELEASE(), 'released_on', 'date');
}
function run1StartEl() {
  const st = readJson(RECORD(1)).stamp;
  const iso = `${st.slice(0, 4)}-${st.slice(4, 6)}-${st.slice(6, 8)}`;
  return `${D(dayMon(iso), st, RECORD(1), 'stamp', 'date')} at ${D(`${st.slice(9, 11)}:${st.slice(11, 13)}`, st, RECORD(1), 'stamp', 'time')} UTC`;
}
const floorText = () => { const re = 'EFFECT_FLOOR = ([0-9]+\\.[0-9]+)'; const f = new RegExp(re).exec(readText('config.js'))[1]; if (Number(f) !== EFFECT_FLOOR) throw new Error('config.js floor text and value disagree'); return D(f, f, 'config.js', re, 're'); };
const tokensOf = (v, kind, s) => RUNS.map((k) => v[kind][k][s].token);
const changedPairs = (v) => PAIRS.flatMap(([kind, name]) => SKILLS.filter((s) => new Set(tokensOf(v, kind, s)).size > 1).map((s) => ({ kind, name, s })));

function plainHeadline(rec, v) {
  const DA = SKILLS[2];
  const peerSep = SKILLS.flatMap((s) => tokensOf(v, 'peer', s)).filter((t) => t.startsWith('separated')).length;
  if (peerSep !== 0 || tokensOf(v, 'upgrade', DA).filter((t) => t === 'separated-up').length < 2) throw new Error('headline: the pattern it states does not hold on these files');
  const nine = D(WORDS[9], 9, SKILLS.flatMap((s) => RUNS.flatMap((k) => pairFiles('peer', k, s))), 'results', 'count', 'w');
  const html = `    <p class="big">With the skill, Claude Sonnet 5.5 was never clearly higher or lower than Claude Opus 5.5 in ${nine} results, and ${tallyOver('peer', SKILLS, v, 'underpowered')} of them had too few answers to tell. It scored clearly higher than Claude Sonnet 5 on documentation in ${tallyEl('upgrade', DA, v, 'separated-up')} of three runs.</p>`;
  return html;
}

function resultSection(rec, v) {
  const rows = PAIRS.flatMap(([kind, name]) => SKILLS.map((s) => `      <tr data-pair="${kind}" data-skill="${s}"><th scope="row">${name}</th><td>${SKILL_NAME[s]}</td>${RUNS.map((k) => `<td><span class="chip ${CHIP[v[kind][k][s].token]}">${vEl(kind, k, s, v[kind][k][s])}</span></td>`).join('')}</tr>`));
  const changed = changedPairs(v);
  const onlyUN = changed.filter((c) => tokensOf(v, c.kind, c.s).every((t) => t === 'underpowered' || t === 'no-separation'));
  const files = (cs) => cs.flatMap((c) => RUNS.flatMap((k) => pairFiles(c.kind, k, c.s)));
  const byPair = PAIRS.map(([kind, name]) => ({ name, ss: changed.filter((c) => c.kind === kind).map((c) => SKILL_NAME[c.s]) })).filter((x) => x.ss.length);
  const list = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const named = byPair.map((x) => `${x.name} on ${list(x.ss)}`);
  const namedText = named.length > 1 ? `${named.slice(0, -1).join('; ')}; and ${named[named.length - 1]}` : named[0];
  const onlyNamed = PAIRS.map(([kind, name]) => ({ name, ss: onlyUN.filter((c) => c.kind === kind).map((c) => SKILL_NAME[c.s]) })).filter((x) => x.ss.length).map((x) => `${x.name} on ${list(x.ss)}`);
  const onlyText = onlyNamed.length > 1 ? `${onlyNamed.slice(0, -1).join('; ')}; and ${onlyNamed[onlyNamed.length - 1]}` : onlyNamed[0];
  const F = floorText;
  const html = `  <section id="result">
  <h2>${heading('result')}</h2>
  <div class="headline">
${plainHeadline(rec, v)}
  </div>
  <table class="comparisons">
    <thead><tr><th scope="col">comparison, with the skill</th><th scope="col">task</th><th scope="col">run 1</th><th scope="col">run 2</th><th scope="col">run 3</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
  <p class="changed">The nine comparisons are three tasks times three pairings. ${D(cap1(WORDS[changed.length]), changed.length, files(changed), 'differs', 'tally', 'w')} of the nine comparisons did not give the same result in every repeat: ${namedText}. ${D(cap1(WORDS[onlyUN.length]), onlyUN.length, files(onlyUN), 'differs-between-too-few-and-no-clear-difference', 'tally', 'w')} of those ${WORDS[changed.length]} changed only between &ldquo;too few answers to tell&rdquo; and &ldquo;no clear difference&rdquo;: ${onlyText}.</p>
  <div class="cols3 key">
    <p><strong>Clearly higher</strong> (or lower): in that run the spread of scores for the two models did not overlap, and their averages were at least ${F()} apart. A model&rsquo;s spread is its average plus or minus the usual variation of its answers&rsquo; scores.</p>
    <p><strong>No clear difference</strong>: there were enough answers to see a gap of ${F()}, and the spreads overlapped or the gap was smaller.</p>
    <p><strong>Too few answers to tell</strong>: the scores were too spread out, or too few, to see a gap of ${F()} either way. It does not mean the models scored the same.</p>
  </div>
  ${cite(rows.join('\n') + F())}
  </section>`;
  return html;
}

function chartSection(rec) {
  // Each model's full name sits on its own line above its three rows, and the lines are not
  // labelled in the drawing: a typed tick or a short name is a digit no file backs (spec 125 AC-9,
  // A-125-4). The caption says in words where the lines fall.
  const W = 380; const x0 = 8; const x1 = W - 16; const lo = 0.4; const hi = 1.0; const top = 40; const nameH = 18; const rowH = 16; const gapM = 12;
  const models = [S5, S55, O55];
  const blockH = models.length * (nameH + 3 * rowH) + (models.length - 1) * gapM;
  const H = top + blockH + 12;
  const X = (x) => { if (x < lo || x > hi) throw new Error(`chart: ${x} is outside ${lo} to ${hi}`); return (x0 + ((x - lo) / (hi - lo)) * (x1 - x0)).toFixed(1); };
  const panels = SKILLS.map((s) => {
    const parts = [`<svg class="chart-panel" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="chart-${s}"><title id="chart-${s}">${cap1(SKILL_NAME[s])}: each model&rsquo;s average score in each run, without the skill and with it</title>`];
    parts.push(`<text class="panel-title" x="0" y="24">${cap1(SKILL_NAME[s])}</text>`);
    for (const t of [0.4, 0.6, 0.8, 1.0]) {
      parts.push(`<line class="grat" x1="${X(t)}" y1="${top - 8}" x2="${X(t)}" y2="${top + blockH + 6}"/>`);
    }
    let y = top;
    for (const m of models) {
      parts.push(`<text class="model" x="0" y="${(y + nameH - 5).toFixed(1)}">${NAME[m]}</text>`);
      y += nameH;
      RUNS.forEach((k, i) => {
        const r = R(rec, k, m, s);
        const a = ARM(r, 'baseline').mean; const b = ARM(r, 'with_skill').mean;
        const yy = (y + i * rowH + rowH / 2).toFixed(1);
        parts.push(`<line class="${b < a ? 'loss' : 'gain'}" x1="${X(a)}" y1="${yy}" x2="${X(b)}" y2="${yy}"/><circle class="without" cx="${X(a)}" cy="${yy}" r="4.5"/><circle class="with" cx="${X(b)}" cy="${yy}" r="4.5"/>`);
      });
      y += 3 * rowH + gapM;
    }
    parts.push('</svg>');
    return `    <figure class="chart-cell">${parts.join('')}</figure>`;
  });
  const caption = `<p class="caption">Under each model&rsquo;s name, one row per run, runs one to three from the top. The hollow dot is a model&rsquo;s average score without the skill, the filled dot its average with the skill, and the line between them what the skill added in that run (red where the score went down). Scores run from zero to one. The faint lines mark four tenths at the left, then six and eight tenths, and a full score at the right. Each dot is the average over the model&rsquo;s answers in that run, each answer scored three times by the grader. The positions are read from the ${D(word(all27().length), all27().length, all27(), 'results.cases[mode=*].generation.mean', 'count', 'w')} receipts listed at the bottom of the page.</p>`;
  return `  <section id="every-run">
  <h2>${heading('every')}</h2>
  <div class="chart-panels">
${panels.join('\n')}
  </div>
  ${caption}
  ${cite(caption)}
  </section>`;
}

function readingsTiles(rec, v) {
  const must = (ok, what) => { if (!ok) throw new Error(`readings: ${what} does not hold on these files`); };
  const CR = SKILLS[0]; const GW = SKILLS[1]; const DA = SKILLS[2];
  const liftList = (m, s) => RUNS.map((k) => liftEl(REC(k, m, s), R(rec, k, m, s))).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const baseList = (m, s) => RUNS.map((k) => meanEl(REC(k, m, s), R(rec, k, m, s), 'baseline')).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const sdList = (m, s, mode) => RUNS.map((k) => D(n3(ARM(R(rec, k, m, s), mode).sd), ARM(R(rec, k, m, s), mode).sd, REC(k, m, s), `results.cases[mode=${mode}].generation.sd`, 'v', 3)).join(', ').replace(/, ([^,]*)$/, ' and $1');
  must([CR, GW].every((s) => tokensOf(v, 'upgrade', s).every((t) => !t.startsWith('separated'))), 'no clear gap on code review or git workflow in the upgrade');
  must(SKILLS.every((s) => tokensOf(v, 'peer', s).every((t) => !t.startsWith('separated'))), 'no clear gap between Sonnet 5.5 and Opus 5.5');
  must([CR, GW].every((s) => tokensOf(v, 'harness', s).every((t) => t === 'underpowered')), 'too few answers on code review and git workflow in the harness check');
  must(tokensOf(v, 'harness', DA).every((t) => t === 'separated-up' || t === 'underpowered'), 'the harness check on documentation is higher or too few');
  const cliNow = readJson(SUR(1, S55, SKILLS[0])).claude_code.pinned_version;
  const cli11 = readJson(R11SUR(SKILLS[0])).claude_code.pinned_version;
  const html = `  <section id="what-the-runs-show">
  <h2>${heading('show')}</h2>
  <div class="cols2">
    <div class="tile">
      <h3>${heading('upgrade')}</h3>
      <p>With the skill loaded, Claude Sonnet 5.5 scored clearly higher than Claude Sonnet 5 on documentation in ${tallyEl('upgrade', DA, v, 'separated-up')} of three runs. On code review and git workflow it was never clearly higher or lower: each run gave no clear difference or too few answers to tell.</p>
      <p>On code review, the skill moved Claude Sonnet 5.5&rsquo;s average by ${liftList(S55, CR)} in the three runs; without the skill it averaged ${baseList(S55, CR)}. For Claude Sonnet 5 the skill moved it by ${liftList(S5, CR)}. These figures are context, not a verdict.</p>
    </div>
    <div class="tile">
      <h3>${heading('peer')}</h3>
      <p>With the skill loaded, Claude Sonnet 5.5 was never clearly higher or lower than Claude Opus 5.5, on any task in any run. Of those nine results, ${tallyOver('peer', SKILLS, v, 'no-separation')} showed no clear difference and in ${tallyOver('peer', SKILLS, v, 'underpowered')} there were too few answers to tell.</p>
      <p>Without the skill, on git workflow, Claude Opus 5.5 averaged ${baseList(O55, GW)}, its answers varying widely (spreads of ${sdList(O55, GW, 'baseline')}), and Claude Sonnet 5.5 averaged ${baseList(S55, GW)} (spreads of ${sdList(S55, GW, 'baseline')}). No test compared the two without the skill, so these averages are context, not a result.</p>
    </div>
    <div class="tile">
      <h3>${heading('harness')}</h3>
      <p>With the skill loaded, Claude Opus 5.5 scored clearly higher on documentation than in Report 011 in ${tallyEl('harness', DA, v, 'separated-up')} of three runs; the other run had too few answers to tell. On code review and git workflow every run had too few answers to tell.</p>
      <p>Report 011 was a single run, on an older Claude Code (${D(cli11, cli11, R11SUR(SKILLS[0]), 'claude_code.pinned_version')} against ${D(cliNow, cliNow, sur27(), 'claude_code.pinned_version', 'all-equal')}) and on a different day. Every answer in both reports was newly written by the model, so run-to-run variation alone can move a score. That is part of why this difference cannot be put down to Claude Code.</p>
    </div>
    <div class="tile">
      <h3>${heading('why')}</h3>
      <p>Repeat runs of the same test did not always agree: ${D(WORDS[changedPairs(v).length], changedPairs(v).length, Object.keys(KINDS).flatMap((kind) => SKILLS.flatMap((s) => RUNS.flatMap((k) => pairFiles(kind, k, s)))), 'differs', 'tally', 'w')} of the nine comparisons gave a different result in one run than in another.</p>
      <p>Claude Opus 5.5&rsquo;s score on code review without the skill was ${baseList(O55, CR)} across the three runs. One run alone could have told a different story.</p>
    </div>
  </div>
  </section>`;
  return citeEach(html);
}

function limitsTiles(rec) {
  const A = all27();
  const draws = A.flatMap((f) => readJson(f).results.cases.map((c) => c.generation.n_measured));
  const lo = Math.min(...draws); const hi = Math.max(...draws);
  const judge = rec[`1/${S55}/${SKILLS[0]}`].run.judge;
  const cliNow = readJson(SUR(1, S55, SKILLS[0])).claude_code.pinned_version;
  const cli11 = readJson(R11SUR(SKILLS[0])).claude_code.pinned_version;
  const cli9 = readJson(R11RECORD).surface_departure.run_record_cli;
  const rows = readJson(RECORD(1)).registry.rows;
  const price = (id, f) => D(String(rows[id][f]), rows[id][f], RECORD(1), `registry.rows.${id}.${f}`);
  const capRe = 'if n >= ([0-9]+):';
  const cap = new RegExp(capRe).exec(readText(GUARD()))[1];
  const cap11 = new RegExp(capRe).exec(readText(R11GUARD))[1];
  const snap = readJson(SNAP());
  // per_turn_effort_active over every generation call of one model, all three runs; one value or stop
  const effortEl = (m) => {
    const files = armSur(m);
    const vals = [...new Set(files.flatMap((f) => readJson(f).calls.filter((c) => c.requested === m).map((c) => c.per_turn_effort_active)))];
    if (vals.length !== 1) throw new Error(`limits: ${m} does not carry one per_turn_effort_active value`);
    return D(vals[0] ? 'every call' : 'no call', vals[0], files, `calls[requested=${m}].per_turn_effort_active`, 'all-equal');
  };
  if (!(effortEl(S55).includes('value="true"') && effortEl(O55).includes('value="true"') && effortEl(S5).includes('value="false"'))) throw new Error('limits: the per-turn effort pattern the text states does not hold');
  const html = `  <section id="limits-and-differences">
  <h2>${heading('limits')}</h2>
  <div class="cols2">
    <div>
      <h3>${heading('lim')}</h3>
      <p>Each skill was tested on one task only. Nothing here says how these skills do on other tasks, or how these models do at coding in general.</p>
      <p>Each model answered each task between ${D(lo, lo, A, 'results.cases[*].generation.n_measured', 'min')} and ${D(hi, hi, A, 'results.cases[*].generation.n_measured', 'max')} times per run, and the grader scored every answer ${D(WORDS[judge.samples], judge.samples, A, 'run.judge.samples', 'all-equal', 'w')} times. That is few answers. Where a result had too few answers to tell, the scores were too spread out, or too few, to see a gap of ${floorText()}.</p>
      <p>Every answer was scored by <code>${D(judge.model_id, judge.model_id, A, 'run.judge.model_id', 'all-equal')}</code> as the grader, as in Reports 009 and 011. Our other reports use a different grader, set by the <a href="/judge-policy/">judge policy</a>, so compare these scores with Reports 009 and 011 only.</p>
    </div>
    <div>
      <h3>${heading('differs')}</h3>
      <p>Claude Sonnet 5.5 came out on ${releaseEl()}, as the vendor&rsquo;s announcement dates it (its record, <a href="evidence/release-date.json"><code>release-date.json</code></a>, is published beside this page). The first run began on ${run1StartEl()}, the next day.</p>
      <p>Every test ran three times instead of once. All three models ran on the same Claude Code, version ${D(cliNow, cliNow, sur27(), 'claude_code.pinned_version', 'all-equal')}; Report 009 used ${D(cli9, cli9, R11RECORD, 'surface_departure.run_record_cli')} and Report 011 used ${D(cli11, cli11, R11SUR(SKILLS[0]), 'claude_code.pinned_version')}. No model was given an effort or thinking setting. Claude Code applied its own per-turn effort in ${effortEl(S55)} of Claude Sonnet 5.5 and ${effortEl(O55)} of Claude Opus 5.5, and in ${effortEl(S5)} of Claude Sonnet 5.</p>
      <p>Prices come from the vendor&rsquo;s pricing page as saved on the day of the run: ${price(S55, 'input_price')} and ${price(S55, 'output_price')} dollars per million input and output tokens for both Sonnet models, and ${price(O55, 'input_price')} and ${price(O55, 'output_price')} for Claude Opus 5.5. Prices change the estimated cost only, never a score.</p>
      <p>A safety limit allowed up to ${D(cap, cap, GUARD(), capRe, 're')} model calls per run, where Report 011 allowed ${D(cap11, cap11, R11GUARD, capRe, 're')}, because this report runs nine tests per run instead of six.</p>
    </div>
  </div>
  </section>`;
  void snap;
  if (rows[S5].input_price !== rows[S55].input_price || rows[S5].output_price !== rows[S55].output_price) throw new Error('limits: the two Sonnet models are not priced alike');
  return citeEach(html);
}

function amendmentsBlock(rec, v) {
  const r = readJson(RELEASE());
  const old = 'Report 013: Claude Sonnet 5.5 on release day, three skills, three runs';
  const firstReadings = readingsSection(rec, v).replace('<h2 id="readings">Four readings</h2>', '<h4 id="readings">Four readings</h4>');
  return `  <h2 id="amendments">Amendments</h2>
  <div class="card">
    <h3 id="amendment-1">Amendment one: a new title, and the page rearranged for readers</h3>
    <p class="muted">Made on ${D(dayMon(r.read_at), r.read_at, RELEASE(), 'read_at', 'date')}, the day its source was saved.</p>
    <p><strong>The title.</strong> This report was first published as <q>${old}</q>. The vendor&rsquo;s announcement dates Claude Sonnet 5.5 ${releaseEl()}, and the first run began on ${run1StartEl()}. So the runs were made the day after its release, and the title now says so: <q>Report 013: Claude Sonnet 5.5, the day after its release</q>. The announcement&rsquo;s record is published beside this page as <a href="evidence/release-date.json"><code>release-date.json</code></a>, which is new in the published files.</p>
    <p><strong>The page.</strong> The page now opens with a short summary and one table of every comparison in every run, then a chart, four short readings, and the limits beside what differs. The full tables, the set-up, the run record and the files are folded at the bottom. No receipt, figure, file or result changed, and every figure is read from the same files. The results carry three plain labels in place of the runner&rsquo;s four phrases: clearly higher or lower (<q>separation detected, upward</q> or <q>downward</q>), no clear difference (<q>no separation detected</q>), and too few answers to tell (<q>not enough draws to conclude at this effect floor</q>). The first version&rsquo;s headline and four readings are kept below, as published.</p>
    ${cite(` data-src="${RELEASE()}"${releaseEl()}${run1StartEl()}`)}
    <details class="as-published"><summary>The first version&rsquo;s headline and four readings, as published</summary>
  <div class="headline">
${headlineBlock(rec, v)}
  </div>
${firstReadings}
    </details>
  </div>`;
}

// AMENDMENT TWO (spec 134). Its own card after amendment one, so the section as first recorded stays
// its byte prefix (spec 020 AC-21 reads the Amendments section as grown, never rewritten). Its markup
// is amendment one's, a bare card (spec 025 AC-10 counts three kinds of card), and it stays the bytes
// this branch first recorded for it (A-134-2): the wide track's two columns are set in tokens.css by
// the card's heading, never by a class or a wrapper here.
function amendmentTwo() {
  const a = readJson(pub('amendment-2.json'));
  const pairs = Object.values(HEADINGS).map(([was, now]) => `      <li><q>${was}</q> now reads <q>${now()}</q></li>`);
  return `  <div class="card">
    <h3 id="amendment-2">Amendment two: headings that state their questions</h3>
    <p class="muted">Made on ${D(dayMon(a.made_on), a.made_on, pub('amendment-2.json'), 'made_on', 'date')}.</p>
    <p>Each section heading of the report body above its Amendments now states the question the section answers. No receipt, figure or result changed, and no sentence of the report body. A link made to a section before this amendment still lands on it. This amendment&rsquo;s record is added to the evidence below. The headings as first published, and what each now reads:</p>
    <ul>
${pairs.join('\n')}
    </ul>
    ${cite(` data-src="${pub('amendment-2.json')}"`)}
  </div>`;
}

// AMENDMENT THREE (spec 134 A-134-1; spec 125's approval finding F-7). Amendment one lists the
// runner's phrases that the three plain labels replace, and leaves one out: the label the runner's
// table gives a pair whose spreads part by less than the effect floor. Amendment one is not edited, as
// a published amendment only grows (spec 020 AC-21), so this one names it. The phrases are read from
// the runner's own source (lib/diff.js, its per-case table), never typed here, and the count from
// amendment one's own list with the phrase added. It is appended after amendment two in the markup
// amendments one and two use, a bare card (A-134-2).
function runnerLabel(constName) {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'diff.js'), 'utf8');
  const m = new RegExp(`r\\.verdict === ${constName} \\? '([^']+)'`).exec(src);
  if (!m) throw new Error(`amendment three: lib/diff.js gives no table label for ${constName}`);
  return m[1];
}
function amendmentThree(rec, v) {
  const a = readJson(pub('amendment-3.json'));
  const floor = runnerLabel('WITHIN_NOISE_FLOOR');
  const noise = runnerLabel('WITHIN_NOISE');
  const one = /in place of the runner&rsquo;s (\w+) phrases: ([\s\S]*?)\. The first version/.exec(amendmentsBlock(rec, v));
  if (!one) throw new Error('amendment three: amendment one names no list of the runner\'s phrases');
  const listed = [...one[2].matchAll(/<q>([^<]*)<\/q>/g)].map((m) => m[1]);
  if (word(listed.length) !== one[1]) throw new Error(`amendment three: amendment one says ${one[1]} phrases and quotes ${listed.length}`);
  if (listed.includes(floor)) throw new Error(`amendment three: amendment one already names "${floor}"`);
  if (!listed.includes(noise)) throw new Error(`amendment three: amendment one does not name "${noise}"`);
  return `  <div class="card">
    <h3 id="amendment-3">Amendment three: the runner&rsquo;s phrase that amendment one left out</h3>
    <p class="muted">Made on ${D(dayMon(a.made_on), a.made_on, pub('amendment-3.json'), 'made_on', 'date')}.</p>
    <p>Amendment one says the plain labels replace the runner&rsquo;s ${one[1]} phrases. The runner has ${word(listed.length + 1)}: the list leaves out <q>${floor}</q>. This page labels that result no clear difference, as it labels <q>${noise}</q>, unless there were too few answers to tell.</p>
    <p>Amendment one is not changed, because a published amendment only grows. No receipt, figure, label or result changed. This amendment&rsquo;s record is added to the evidence below.</p>
    ${cite(` data-src="${pub('amendment-3.json')}"`)}
  </div>`;
}

function evidenceFold(rec, v) {
  const h2to3 = (html) => html.replace(/<h2 id="([^"]+)">/g, '<h3 id="$1">').replace(/<\/h2>/g, '</h3>');
  return `  <h2 id="evidence-and-files">Evidence and files</h2>
  <details class="fold"><summary>How the runs were set up, in full: limits, departures and what stayed fixed, as first published</summary>
${h2to3(limitsSection(rec))}

${h2to3(departuresSection(rec))}

${h2to3(setupSection(rec))}
  </details>
  <details class="fold"><summary>The figures behind each comparison: every run&rsquo;s averages, spreads and answers</summary>
${tableSection('upgrade', rec, v)}

${tableSection('peer', rec, v)}

${tableSection('harness', rec, v)}
  </details>
  <details class="fold"><summary>The run record: calls, costs and integrity</summary>
${h2to3(runRecordSection(rec))}
  </details>
${evidenceBlock().replace('<h2 id="evidence">Published evidence</h2>', '<h3 id="evidence">Published evidence</h3>').replace('<details class="card" open>', '<details class="card fold">')}

${receiptsBlock().replace('<details class="card" open>', '<details class="card fold">')}`;
}

function buildPage(rec) {
  const v = verdicts(rec);
  const base = applyHeadTags(keepAnchors(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof: Report 013, Claude Sonnet 5.5, the day after its release</title>
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report shaped">
  <h1>Report 013: Claude Sonnet 5.5, the day after its release</h1>
  <p class="report-type">Release drift report<span class="muted">. It measures a new model on the same skills and tasks. Beside that, it sets two current models side by side, and runs one model again, on a later day and a newer Claude Code, beside its Report 011 run.</span></p>

${resultSection(rec, v)}

${chartSection(rec)}

${readingsTiles(rec, v)}

${limitsTiles(rec)}

${amendmentsBlock(rec, v)}

${amendmentTwo()}

${amendmentThree(rec, v)}

${evidenceFold(rec, v)}

  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report 013 · Release drift report</span></footer>
</main>
</body>
</html>
`), PAGE_REL);
  const row = reportRow(NUMBER, { pageRel: `docs/${PAGE_REL}`, html: base });
  return renderReportPage(base, PAGE_REL, [row]);
}

function main() {
  const args = process.argv.slice(2);
  const out = path.join(OUT_DIR, 'index.html');
  if (args.includes('--page')) { process.stdout.write(buildPage(readAll())); return 0; }
  if (args.includes('--check')) {
    const drift = [];
    const page = buildPage(readAll());
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== page) drift.push('index.html');
    for (const [n, src] of evidenceSet()) {
      if (!fs.existsSync(path.join(ROOT, PUB, n)) || sha256(`${PUB}/${n}`) !== sha256(src)) drift.push(n);
    }
    const extra = fs.existsSync(path.join(ROOT, PUB)) ? fs.readdirSync(path.join(ROOT, PUB), { recursive: true }).map((n) => n.split(path.sep).join('/')).filter((n) => !fs.statSync(path.join(ROOT, PUB, n)).isDirectory() && !evidenceSet().has(n)) : [];
    for (const n of extra) drift.push(`${n} (not in the set)`);
    for (const [c, src] of receiptCopies()) {
      if (!fs.existsSync(path.join(ROOT, c)) || sha256(c) !== sha256(src)) drift.push(c);
    }
    if (!drift.length) { console.log('report 013: page, evidence and receipt copies match their files'); return 0; }
    console.error(`report 013: DRIFTED: ${drift.join(', ')}`);
    process.exitCode = 1;
    return 1;
  }
  // Writing copies the evidence and the receipts first: the page reads the copies.
  fs.mkdirSync(path.join(ROOT, PUB), { recursive: true });
  for (const [n, src] of evidenceSet()) {
    fs.mkdirSync(path.dirname(path.join(ROOT, PUB, n)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, src), path.join(ROOT, PUB, n));
  }
  for (const [c, src] of receiptCopies()) {
    fs.mkdirSync(path.dirname(path.join(ROOT, c)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, src), path.join(ROOT, c));
  }
  const page = buildPage(readAll());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, page);
  console.log(`  wrote docs/${PAGE_REL}, ${evidenceSet().size} evidence files and ${receiptCopies().size} receipt copies`);
  return 0;
}

if (require.main === module) main();

module.exports = { SKILLS, ARMS, KINDS, PUB, RECEIPTS, SPEC, PAGE_REL, OUT_DIR, evidenceSet, receiptCopies, stamps, readAll, buildPage, verdicts, LABEL, main };
