#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-014.js: render Driftproof Report 014, Claude Haiku 5.5 on its release day, measured on
// the three skills and cases of Reports 009, 011 and 013, three runs.
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN. Nothing here calls a model or the network. The runs were made
// by the command file under specs/166-report-014-haiku-5-5/run/ (run.sh, driven by three-runs.sh and
// arm2.sh), three times over, and each run's receipts, sidecars and records are committed under that
// spec's evidence/r014-<stamp>/. What the report makes public is copied, byte-identical, beside the page
// in evidence/, each run's files in its own directory (run-1/, run-2/, run-3/) under the runner's own
// names, so each sidecar sits beside the receipt its `receipt` field names (spec 069 AC-2). The 18
// receipts and their summaries are also copied to receipts/report-014/run-<k>/, the one directory the
// card, the receipt pages and the badges read (spec 047 R-2).
//
// TWO ARMS ARE THIS REPORT'S, TWO ARE REPORT 013'S. Claude Haiku 5.5 and Claude Haiku 4.5 were run here,
// three times each. Claude Sonnet 5.5 and Claude Opus 5.5 are the comparison rows, and their receipts
// are Report 013's own (three runs on the same pinned Claude Code), read from the evidence that report
// published; nothing of theirs is copied again.
//
// THE READING IS EACH RECEIPT'S OWN: what the skill added to the model that answered, with the project's
// own verdict (lib/verdict.js receiptVerdict, the one the receipt pages and badges show). A skill
// "clearly helped" a model in a run when that verdict reads Clearly helped. The report counts those
// readings over the three runs, and pools no draws.
//
// EVERY FIGURE IS A <data> ELEMENT THAT NAMES ITS FILE, as in Reports 009, 011 and 013: `value` is the
// value as read, `data-src` the file or files (space-separated), `data-at` where, `data-fn` how,
// `data-dp` the rounding shown. A numeral in the body outside a <data> element is a gate failure.
//
// Usage:
//   node scripts/prepare-report-014.js            # render docs/reports/014/ and copy its evidence and receipts
//   node scripts/prepare-report-014.js --check    # exit 1 if the page or a copy drifted
//   node scripts/prepare-report-014.js --page     # print the page to stdout, write nothing

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EFFECT_FLOOR } = require('../config');
const { receiptVerdict } = require('../lib/verdict');
const { LABELS } = require('../lib/plain');
const { applyHeadTags } = require('./build-head-tags');
const { renderReportPage, slugOf } = require('./site-chrome');
const { reportRow } = require('./site-data.mjs');
const { humanModelName } = require('./model-names');
// A model's human name, from its id (spec 133's module); never typed here (spec 134 AC-1).
const HN = (id) => humanModelName(id);

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'reports', '014');
const PAGE_REL = 'reports/014/index.html';
const NUMBER = /reports\/(\d+)/.exec(PAGE_REL)[1];
const PUB = 'docs/reports/014/evidence';
const RECEIPTS = 'receipts/report-014';
const SPEC = 'specs/166-report-014-haiku-5-5';
const SNAP_NAME = 'docs-pricing-snapshot-2026-10-08.json';
const R13PUB = 'docs/reports/013/evidence';
const RELEASE_REC = `${SPEC}/evidence/release-date.json`;

const SKILLS = ['code-review-and-quality', 'git-workflow-and-versioning', 'documentation-and-adrs'];
const H55 = 'claude-haiku-5-5';
const H45 = 'claude-haiku-4-5-20251001';
const S55 = 'claude-sonnet-5-5';
const O55 = 'claude-opus-5-5';
const NEW_ARMS = [H55, H45];
const ARMS = [H55, H45, S55, O55];
const OLD = new Set([S55, O55]);
const RUNS = [1, 2, 3];
const NAME = Object.fromEntries(ARMS.map((id) => [id, HN(id)]));
const SKILL_NAME = { 'code-review-and-quality': 'code review', 'git-workflow-and-versioning': 'git workflow', 'documentation-and-adrs': 'documentation' };

// Read when first needed, never at load: a published tree carries no specs/.
let stampsCache = null;
function stamps() {
  if (stampsCache) return stampsCache;
  const dir = path.join(ROOT, SPEC, 'evidence');
  stampsCache = fs.readdirSync(dir).filter((n) => /^r014-\d{8}T\d{6}Z$/.test(n) && fs.statSync(path.join(dir, n)).isDirectory()).map((n) => n.slice(5)).sort();
  if (stampsCache.length !== 3) throw new Error(`${stampsCache.length} run directories under ${SPEC}/evidence, not three`);
  return stampsCache;
}
const RUN_DIR = (k) => `${SPEC}/evidence/r014-${stamps()[k - 1]}`;
// The receipt's file stem for one arm, skill and run: the runner names it with the day it ran.
const stemOf = (k, model, s) => {
  const d = path.join(ROOT, RUN_DIR(k), model, s, 'receipts');
  const names = fs.readdirSync(d).filter((n) => n.endsWith('.json') && !n.endsWith('.surface.json'));
  if (names.length !== 1) throw new Error(`${names.length} receipts in ${d}`);
  return names[0].slice(0, -'.json'.length);
};

// ---- the published set: published name -> the committed twin it is copied from ----
let publishedCache = null;
function evidenceSet() {
  if (publishedCache) return publishedCache;
  const m = new Map();
  for (const k of RUNS) {
    const RUN = RUN_DIR(k);
    for (const model of NEW_ARMS) {
      for (const s of SKILLS) {
        const stem = stemOf(k, model, s);
        const dir = `${RUN}/${model}/${s}`;
        m.set(`run-${k}/${stem}.json`, `${dir}/receipts/${stem}.json`);
        m.set(`run-${k}/${stem}.summary.md`, `${dir}/receipts/${stem}.summary.md`);
        m.set(`run-${k}/${stem}.surface.json`, `${dir}/receipts/${stem}.surface.json`);
        m.set(`run-${k}/${stem}.stdout.txt`, `${dir}/stdout.txt`);
      }
    }
    for (const f of ['run-record.json', 'registry.json', 'status.jsonl', 'driftproof-calls.SHA256SUMS']) m.set(`run-${k}/${f}`, `${RUN}/${f}`);
  }
  m.set('runs-log.txt', `${SPEC}/evidence/runs-log.txt`);
  m.set(SNAP_NAME, `${SPEC}/evidence/${SNAP_NAME}`);
  m.set('guard.py', `${SPEC}/run/guard.py`);
  // THE RELEASE DATE. No receipt carries it (`run.model_release_date` is null in all 18), so it is read
  // from the record saved beside the vendor's release notes, and the record is published here.
  m.set('release-date.json', RELEASE_REC);
  publishedCache = m;
  return m;
}
const pub = (name) => { if (!evidenceSet().has(name)) throw new Error(`not in the published set: ${name}`); return `${PUB}/${name}`; };
// A receipt's path for one arm in one run: this report's own copy, or Report 013's published one.
const R13STAMP = (k, model, s) => {
  const dir = path.join(ROOT, R13PUB, `run-${k}`);
  const names = fs.readdirSync(dir).filter((n) => n.startsWith(`${s}-${model}-`) && n.endsWith('.json') && !n.endsWith('.surface.json'));
  if (names.length !== 1) throw new Error(`${names.length} Report 013 receipts for ${model} ${s} run ${k}`);
  return names[0];
};
const REC = (k, model, s) => (OLD.has(model) ? `${R13PUB}/run-${k}/${R13STAMP(k, model, s)}` : pub(`run-${k}/${stemOf(k, model, s)}.json`));
const SUR = (k, model, s) => REC(k, model, s).replace(/\.json$/, '.surface.json');
const OUTF = (k, model, s) => pub(`run-${k}/${stemOf(k, model, s)}.stdout.txt`);
const STATUS = (k) => pub(`run-${k}/status.jsonl`);
const RECORD = (k) => pub(`run-${k}/run-record.json`);
const CALLSUMS = (k) => pub(`run-${k}/driftproof-calls.SHA256SUMS`);
const RUNSLOG = () => pub('runs-log.txt');
const SNAP = () => pub(SNAP_NAME);
const GUARD = () => pub('guard.py');
const R13RECORD = (k) => `${R13PUB}/run-${k}/run-record.json`;
// The receipt copies the card, the receipt pages and the badges read: receipt copy -> evidence twin.
function receiptCopies() {
  const m = new Map();
  for (const k of RUNS) for (const model of NEW_ARMS) for (const s of SKILLS) {
    const stem = stemOf(k, model, s);
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
  if (rel.startsWith(`${R13PUB}/`)) return `<a href="../013/evidence/${esc(rel.slice(R13PUB.length + 1))}"><code>${esc(rel)}</code></a>`;
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
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function srcsOf(html) {
  return [...new Set([...html.matchAll(/data-src="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))];
}
function cite(html) {
  return `<p class="muted cite">Read from: ${srcsOf(html).map(shown).join('; ')}.</p>`;
}
// Every block a heading opens carries its own citation (spec 125 AC-9), so each tile and each column
// cites the files its own figures read, and a block with no figure cites nothing.
function citeEach(html) {
  return html.replace(/(\n    <div(?: class="tile")?>\n)([\s\S]*?)(\n    <\/div>)/g, (m, open, inner, close) => (srcsOf(inner).length ? `${open}${inner}\n      ${cite(inner)}${close}` : m));
}

// ---- reading ----------------------------------------------------------------
const ARM = (r, mode) => r.results.cases.find((c) => c.mode === mode).generation;
function readAll() {
  const rec = {};
  for (const k of RUNS) for (const model of ARMS) for (const s of SKILLS) rec[`${k}/${model}/${s}`] = readJson(REC(k, model, s));
  return rec;
}
const R = (rec, k, model, s) => rec[`${k}/${model}/${s}`];

// THE RECEIPT'S OWN READING OF ITS LIFT, and the plain words the site gives each (lib/plain.js LABELS):
// the verdict token is the project's (lib/verdict.js receiptVerdict), the chip the reader sees its label.
const TOKENS = ['PASSED', 'NO_EFFECT', 'UNDERPOWERED', 'REGRESSED'];
const CHIP = { PASSED: 'is-higher', NO_EFFECT: 'is-none', UNDERPOWERED: 'is-few', REGRESSED: 'is-lower' };
function verdictOf(r) {
  const out = receiptVerdict(r);
  if (!TOKENS.includes(out.verdict)) throw new Error(`the project's verdict for a receipt reads ${out.verdict}, which this page has no label for`);
  return out.verdict;
}
function verdicts(rec) {
  const v = {};
  for (const k of RUNS) for (const m of ARMS) for (const s of SKILLS) v[`${k}/${m}/${s}`] = verdictOf(R(rec, k, m, s));
  return v;
}
const V = (v, k, m, s) => v[`${k}/${m}/${s}`];
const chipEl = (v, k, m, s) => D(LABELS[V(v, k, m, s)], V(v, k, m, s), REC(k, m, s), 'verdict', 'lift-verdict');
// How many of the three runs read PASSED for one model and skill.
const helped = (v, m, s) => RUNS.filter((k) => V(v, k, m, s) === 'PASSED').length;
const helpedEl = (v, m, s) => D(WORDS[helped(v, m, s)], helped(v, m, s), RUNS.map((k) => REC(k, m, s)), 'verdict=PASSED', 'tally', 'w');
// THE BUCKETS. A skill helps a model when it clearly helped it in at least two of the three runs. The
// reading of the two Haiku arms puts each skill in one of five places. A skill that helped Haiku 4.5 and not
// Haiku 5.5 "stopped" only when at least two of Haiku 5.5's runs measured something (no clear difference, or
// clearly hurt); when they mostly had too few answers to tell, the runs cannot say, and it is placed so
// (spec 035: too few answers is not a finding of no effect; the pull request review's F-1, 8 Oct 2026).
const MAJORITY = 2;
const helps = (v, m, s) => helped(v, m, s) >= MAJORITY;
function bucketOf(v, s) {
  const was = helps(v, H45, s); const now = helps(v, H55, s);
  const measuredNo = RUNS.filter((k) => ['NO_EFFECT', 'REGRESSED'].includes(V(v, k, H55, s))).length >= MAJORITY;
  return was && now ? 'still' : was && !now ? (measuredNo ? 'stopped' : 'unclear') : !was && now ? 'started' : 'never';
}
const listOf = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A mean shown with its band and draws.
function band(rel, r, mode, word = 'answers') {
  const x = ARM(r, mode);
  return `${D(n3(x.mean), x.mean, rel, `results.cases[mode=${mode}].generation.mean`, 'v', 3)} &plusmn; ${D(n3(x.sd), x.sd, rel, `results.cases[mode=${mode}].generation.sd`, 'v', 3)} <span class="muted">(${D(x.n_measured, x.n_measured, rel, `results.cases[mode=${mode}].generation.n_measured`)} ${word})</span>`;
}
const meanEl = (rel, r, mode) => D(n3(ARM(r, mode).mean), ARM(r, mode).mean, rel, `results.cases[mode=${mode}].generation.mean`, 'v', 3);
const liftEl = (rel, r) => D(sg3(r.comparison.delta), r.comparison.delta, rel, 'comparison.delta', 'signed', 3); // A figure shown with its sign.
const runEl = (k) => `run ${k}`;

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
const allNew = () => RUNS.flatMap((k) => NEW_ARMS.flatMap((m) => SKILLS.map((s) => REC(k, m, s))));
const surNew = () => RUNS.flatMap((k) => NEW_ARMS.flatMap((m) => SKILLS.map((s) => SUR(k, m, s))));
const allRows = () => RUNS.flatMap((k) => ARMS.flatMap((m) => SKILLS.map((s) => REC(k, m, s))));
const armRec = (model) => RUNS.flatMap((k) => SKILLS.map((s) => REC(k, model, s)));
const armSur = (model) => RUNS.flatMap((k) => SKILLS.map((s) => SUR(k, model, s)));

const dayMon = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}`; };
const RELEASE = () => pub('release-date.json');
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

// per_turn_effort_active over every generation call of one model, all three runs; one value or stop
const effortEl = (m) => {
  const files = armSur(m);
  const vals = [...new Set(files.flatMap((f) => readJson(f).calls.filter((c) => c.requested === m).map((c) => c.per_turn_effort_active)))];
  if (vals.length !== 1) throw new Error(`limits: ${m} does not carry one per_turn_effort_active value`);
  return D(vals[0] ? 'every call' : 'no call', vals[0], files, `calls[requested=${m}].per_turn_effort_active`, 'all-equal');
};

// ---- the page's blocks ------------------------------------------------------
// THE HEADLINE: the skills in their places, each with the counts that put it there. For a model a skill
// did not clearly help in every run, the other runs are counted by what they read, so "stopped helping"
// is never said of a result that could not tell (too few answers) as if it had found nothing.
const SAY = { NO_EFFECT: 'showed no clear difference', UNDERPOWERED: 'had too few answers to tell', REGRESSED: 'clearly hurt' };
function plainHeadline(rec, v) {
  const by = { still: [], stopped: [], unclear: [], started: [], never: [] };
  for (const s of SKILLS) by[bucketOf(v, s)].push(s);
  const count = (m, s, token) => RUNS.filter((k) => V(v, k, m, s) === token).length;
  const countEl = (m, s, token) => D(WORDS[count(m, s, token)], count(m, s, token), RUNS.map((k) => REC(k, m, s)), `verdict=${token}`, 'tally', 'w');
  // "two of three runs" plus, for the runs that were not clear help, what they read.
  const runs = (m, s) => {
    const rest = ['NO_EFFECT', 'UNDERPOWERED', 'REGRESSED'].filter((t) => count(m, s, t) > 0).map((t) => `${countEl(m, s, t)} ${SAY[t]}`);
    return `${countEl(m, s, 'PASSED')} of three runs${rest.length ? ` (${rest.join(', ')})` : ''}`;
  };
  const item = (s) => `<code>${s}</code>: clearly helped ${HN(H45)} in ${runs(H45, s)}, and ${HN(H55)} in ${runs(H55, s)}`;
  const sentence = (lead, ss) => (ss.length ? `${lead} ${ss.map(item).join('. ')}.` : '');
  const parts = [
    sentence(`Still help ${HN(H55)}.`, by.still),
    sentence('Stopped helping, as far as these runs can tell.', by.stopped),
    sentence(`Helped ${HN(H45)}; on ${HN(H55)} these runs had too few answers to tell.`, by.unclear),
    sentence(`Started helping ${HN(H55)}.`, by.started),
    sentence('Did not clearly help either model in two or more of the three runs.', by.never),
  ].filter(Boolean);
  const none = by.still.length ? '' : ` On ${HN(H55)} no skill clearly helped in two or more of the three runs.`;
  const html = `    <p class="big">${HN(H55)} on the three skills and cases of Reports 009, 011 and 013, beside ${HN(H45)}, each run three times.${none} ${parts.join(' ')}</p>
    <p>A skill counts as helping a model here when it clearly helped it in at least two of the three runs. Every figure below is read from a receipt or a file published beside it, and each block names its files. This report measures what a skill adds to each model on these cases. It makes no claim about any model&rsquo;s coding ability.</p>`;
  return `${html}\n    ${cite(html)}`;
}

function resultSection(rec, v) {
  const rows = SKILLS.flatMap((s) => ARMS.map((m) => `      <tr data-skill="${s}" data-model="${m}"><th scope="row">${SKILL_NAME[s]}</th><td>${NAME[m]}${OLD.has(m) ? ' <span class="muted">(Report 013)</span>' : ''}</td>${RUNS.map((k) => `<td><span class="chip ${CHIP[V(v, k, m, s)]}">${chipEl(v, k, m, s)}</span></td>`).join('')}<td>${helpedEl(v, m, s)} of three</td></tr>`));
  const F = floorText;
  const html = `  <section id="result">
  <h2>Which skills help ${HN(H55)}?</h2>
  <div class="headline">
${plainHeadline(rec, v)}
  </div>
  <table class="lift">
    <thead><tr><th scope="col">task</th><th scope="col">model</th><th scope="col">run 1</th><th scope="col">run 2</th><th scope="col">run 3</th><th scope="col">clearly helped</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
  <div class="cols3 key">
    <p><strong>Clearly helped</strong>: in that run the spread of the model&rsquo;s scores with the skill did not overlap its spread without it, and the averages were at least ${F()} apart.</p>
    <p><strong>No clear difference</strong>: there were enough answers to see a gap of ${F()}, and the spreads overlapped or the gap was smaller.</p>
    <p><strong>Too few answers to tell</strong>: the scores were too spread out, or too few, to see a gap of ${F()} either way. It does not mean the skill did nothing.</p>
  </div>
  ${cite(rows.join('\n') + F())}
  </section>`;
  return html;
}

function chartSection(rec) {
  // Each model's full name sits on its own line above its three rows. The lines are not labelled in the
  // drawing: a typed tick or a short name is a digit no file backs. The caption says in words where the
  // lines fall.
  const W = 380; const x0 = 8; const x1 = W - 16; const lo = 0.0; const hi = 1.0; const top = 40; const nameH = 18; const rowH = 16; const gapM = 12;
  const models = ARMS;
  const blockH = models.length * (nameH + 3 * rowH) + (models.length - 1) * gapM;
  const H = top + blockH + 12;
  const X = (x) => { if (x < lo || x > hi) throw new Error(`chart: ${x} is outside ${lo} to ${hi}`); return (x0 + ((x - lo) / (hi - lo)) * (x1 - x0)).toFixed(1); };
  const panels = SKILLS.map((s) => {
    const parts = [`<svg class="chart-panel" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="chart-${s}"><title id="chart-${s}">${cap1(SKILL_NAME[s])}: each model&rsquo;s average score in each run, without the skill and with it</title>`];
    parts.push(`<text class="panel-title" x="0" y="24">${cap1(SKILL_NAME[s])}</text>`);
    for (const t of [0.0, 0.25, 0.5, 0.75, 1.0]) {
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
  const caption = `<p class="caption">Under each model&rsquo;s name, one row per run, runs one to three from the top. The hollow dot is a model&rsquo;s average score without the skill, the filled dot its average with the skill, and the line between them is what the skill added. Each panel spans scores from zero at the left edge to one at the right. The two Claude Haiku rows were run for this report; the Claude Sonnet 5.5 and Claude Opus 5.5 rows are Report 013&rsquo;s.</p>`;
  const files = allRows();
  return `  <section id="every-run">
  <h2>What did each model score, without the skill and with it?</h2>
  <div class="chart-panels">
${panels.join('\n')}
  </div>
  ${caption}
  ${cite(`${caption} data-src="${files.join(' ')}"`)}
  </section>`;
}

function readingsTiles(rec, v) {
  const liftList = (m, s) => RUNS.map((k) => liftEl(REC(k, m, s), R(rec, k, m, s))).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const baseList = (m, s) => RUNS.map((k) => meanEl(REC(k, m, s), R(rec, k, m, s), 'baseline')).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const withList = (m, s) => RUNS.map((k) => meanEl(REC(k, m, s), R(rec, k, m, s), 'with_skill')).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const by = { still: [], stopped: [], unclear: [], started: [], never: [] };
  for (const s of SKILLS) by[bucketOf(v, s)].push(s);
  const place = (k) => (by[k].length ? by[k].map((s) => `<code>${s}</code>`).join(', ') : 'none');
  const flips = ARMS.flatMap((m) => SKILLS.map((s) => (new Set(RUNS.map((k) => V(v, k, m, s))).size > 1 ? { m, s } : null))).filter(Boolean);
  const flipFiles = flips.flatMap(({ m, s }) => RUNS.map((k) => REC(k, m, s)));
  const perModel = (m) => `${D(WORDS[SKILLS.flatMap((s) => RUNS.filter((k) => V(v, k, m, s) === 'PASSED')).length], SKILLS.flatMap((s) => RUNS.filter((k) => V(v, k, m, s) === 'PASSED')).length, armRec(m), 'verdict=PASSED', 'tally', 'w')} of ${D(WORDS[9], 9, armRec(m), 'results', 'count', 'w')}`;
  const modelList = (() => { const it = ARMS.map((m) => `${HN(m)} in ${perModel(m)}`); return `${it.slice(0, -1).join(', ')} and ${it[it.length - 1]}`; })();
  const html = `  <section id="what-the-runs-show">
  <h2>What do the runs show?</h2>
  <div class="cols2">
    <div class="tile">
      <h3>Which skills still help ${HN(H55)}?</h3>
      <p>Still help: ${place('still')}. Stopped helping, as far as these runs can tell: ${place('stopped')}. Helped ${HN(H45)}, too few answers to tell on ${HN(H55)}: ${place('unclear')}. Started helping: ${place('started')}. Did not clearly help either model in two or more of the three runs: ${place('never')}.</p>
      <p>A result that had too few answers to tell does not show that a skill stopped working. The two Claude Haiku arms also differ in more than the model: Claude Code applied its per-turn effort to ${effortEl(H55)} of ${HN(H55)} and to ${effortEl(H45)} of ${HN(H45)}.</p>
      ${SKILLS.map((s) => `<p><code>${s}</code>: ${HN(H55)} averaged ${baseList(H55, s)} without the skill and ${withList(H55, s)} with it, so the skill added ${liftList(H55, s)} across the three runs. ${HN(H45)} averaged ${baseList(H45, s)} without it and ${withList(H45, s)} with it, an addition of ${liftList(H45, s)}.</p>`).join('\n      ')}
    </div>
    <div class="tile">
      <h3>How often did the skills clearly help each model?</h3>
      <p>Out of nine results for each model (three tasks, three runs), the skills clearly helped ${modelList}. Claude Sonnet 5.5 and Claude Opus 5.5 are Report 013&rsquo;s receipts, not run again, and these counts set the four models side by side without ranking them.</p>
    </div>
    <div class="tile">
      <h3>Why run every test three times?</h3>
      <p>Repeat runs of the same test did not always agree: ${D(WORDS[flips.length], flips.length, flipFiles.length ? flipFiles : allRows(), 'differs', 'tally', 'w')} of the twelve model and task pairs changed reading between runs. Most of those changes were between clearly helped and too few answers to tell; only one pair, git workflow on ${HN(H55)}, read two answers that conflict, clearly helped in one run and no clear difference in another.</p>
    </div>
  </div>
  </section>`;
  return citeEach(html);
}

function limitsTiles(rec) {
  const A = allNew();
  const draws = allRows().flatMap((f) => readJson(f).results.cases.map((c) => c.generation.n_measured));
  const lo = Math.min(...draws); const hi = Math.max(...draws);
  const judge = rec[`1/${H55}/${SKILLS[0]}`].run.judge;
  const cliNow = readJson(SUR(1, H55, SKILLS[0])).claude_code.pinned_version;
  const r13day = readJson(REC(1, S55, SKILLS[0])).run.date_utc;
  const rows = readJson(RECORD(1)).registry.rows;
  const price = (id, f) => D(String(rows[id][f]), rows[id][f], RECORD(1), `registry.rows.${id}.${f}`);
  const capRe = 'if n >= ([0-9]+):';
  const cap = new RegExp(capRe).exec(readText(GUARD()))[1];
  const html = `  <section id="limits-and-differences">
  <h2>What are the limits, and what differs from Reports 009, 011 and 013?</h2>
  <div class="cols2">
    <div>
      <h3>What does this report not show?</h3>
      <p>Each skill was tested on one task only. Nothing here says how these skills do on other tasks, or how these models do at coding in general.</p>
      <p>Each arm drew between ${D(lo, lo, allRows(), 'results.cases[*].generation.n_measured', 'min')} and ${D(hi, hi, allRows(), 'results.cases[*].generation.n_measured', 'max')} answers in a run, and the grader scored every answer ${D(WORDS[judge.samples], judge.samples, allRows(), 'run.judge.samples', 'all-equal', 'w')} times. That is few answers. Where a result had too few answers to tell, the scores were too spread out, or too few, to see a gap of ${floorText()}.</p>
      <p>Every answer was scored by <code>${D(judge.model_id, judge.model_id, allRows(), 'run.judge.model_id', 'all-equal')}</code> as the grader, as in Reports 009, 011 and 013. Our other reports use a different grader, set by the <a href="/judge-policy/">judge policy</a>, so compare these scores with Reports 009, 011 and 013 only.</p>
      <p>A result reads one model&rsquo;s receipt: what the skill added to the model that answered, in that run. The page counts how many runs clearly helped each model and sets the counts side by side; it does not test whether one model&rsquo;s lift differs from another&rsquo;s.</p>
    </div>
    <div>
      <h3>What differs from the earlier reports?</h3>
      <p>${HN(H55)} came out on ${releaseEl()}, as the vendor&rsquo;s release notes date it (the record, <a href="evidence/release-date.json"><code>release-date.json</code></a>, is published beside this page). The first run began on ${run1StartEl()}.</p>
      <p>The model before it is ${HN(H45)}. Claude Sonnet 5.5 and Claude Opus 5.5 are Report 013&rsquo;s receipts, not run again: they ran on the same Claude Code, ${D(cliNow, cliNow, surNew().concat(armSur(S55), armSur(O55)), 'claude_code.pinned_version', 'all-equal')}, on ${D(dayMon(r13day), r13day, REC(1, S55, SKILLS[0]), 'run.date_utc', 'date')}.</p>
      <p>Every test ran three times. No model was given an effort or thinking setting. Claude Code applied its own per-turn effort in ${effortEl(H55)} of ${HN(H55)} and ${effortEl(H45)} of ${HN(H45)}.</p>
      <p>Prices come from the vendor&rsquo;s pricing page as saved on the day of the run: ${price(H55, 'input_price')} and ${price(H55, 'output_price')} dollars per million input and output tokens for ${HN(H55)} (the vendor&rsquo;s first rate, for the shorter prompts every call here used), and ${price(H45, 'input_price')} and ${price(H45, 'output_price')} for ${HN(H45)}. Prices change the estimated cost only, never a score.</p>
      <p>A safety limit allowed up to ${D(cap, cap, GUARD(), capRe, 're')} model calls per run directory. It was set for up to twelve skill runs, in case the comparison models were run again; each run made six.</p>
    </div>
  </div>
  </section>`;
  void A;
  return citeEach(html);
}

function departuresSection(rec) {
  const cliNow = readJson(SUR(1, H55, SKILLS[0])).claude_code.pinned_version;
  const rows = readJson(RECORD(1)).registry.rows;
  const MODELS = 'config/models.json';
  const price = (id, f) => D(String(rows[id][f]), rows[id][f], RECORD(1), `registry.rows.${id}.${f}`);
  const psrc = rec[`1/${H55}/${SKILLS[0]}`].run.pricing_snapshot.source;
  const html = `  <h2 id="departures">What departs from Report 013</h2>
  <div class="card">
    <ul>
      <li><strong>The same Claude Code.</strong> Every call of the two Claude Haiku arms ran on Claude Code <code>${D(cliNow, cliNow, surNew(), 'claude_code.pinned_version', 'all-equal')}</code>, the version Report 013 pinned, installed at the npm integrity the run record states. Each receipt has a sidecar, <code>&lt;receipt&gt;.surface.json</code>, bound to it by its <code>receipt_hash</code> and recording the version each of its calls reported.</li>
      <li><strong>The prices are this run&rsquo;s own.</strong> The runner&rsquo;s registry had no row for <code>${H55}</code>. This run used a copy of it with that row added at ${price(H55, 'input_price')} and ${price(H55, 'output_price')} dollars per million input and output tokens, and <code>${H45}</code> at ${price(H45, 'input_price')} and ${price(H45, 'output_price')}, each read from the vendor&rsquo;s pricing page on the day of the run (<code>${SNAP_NAME}</code>). The rows are this run&rsquo;s only; the product&rsquo;s registry, <code>${MODELS}</code>, does not carry <code>${H55}</code>, and each receipt&rsquo;s <code>pricing_snapshot.source</code> names that file, <code>${D(psrc, psrc, allNew(), 'run.pricing_snapshot.source', 'all-equal')}</code>, although its prices are this run&rsquo;s copy. Prices change the estimated cost below and no score.</li>
      <li><strong>Two comparison arms are Report 013&rsquo;s.</strong> <code>${S55}</code> and <code>${O55}</code> were not run again. Their rows are the receipts Report 013 published, run by run.</li>
    </ul>
  </div>`;
  return html.replace(/\n  <\/div>$/, `\n    ${cite(html)}\n  </div>`);
}

function setupSection(rec) {
  const floorRe = 'EFFECT_FLOOR = ([0-9]+\\.[0-9]+)';
  const floor = new RegExp(floorRe).exec(readText('config.js'))[1];
  if (Number(floor) !== EFFECT_FLOOR) throw new Error('config.js floor text and value disagree');
  const same = (at) => SKILLS.map((s) => {
    const files = ARMS.flatMap((m) => RUNS.map((k) => REC(k, m, s)));
    const val = at.split('.').reduce((o, k) => o[k], readJson(files[0]));
    return `<code>${esc(s)}</code> <code>${D(val.slice(0, 12), val, files, at, 'same-prefix')}</code>`;
  }).join(', ');
  const r0 = rec[`1/${H55}/${SKILLS[0]}`];
  const every = allRows();
  const tpl = r0.run.judge.prompt_template_hash;
  const html = `  <h2 id="setup">What stayed fixed</h2>
  <div class="card">
    <p><strong>The inputs are the earlier reports&rsquo;.</strong> The same SKILL.md bytes (<code>skill.content_hash</code>, the same in all of this report&rsquo;s receipts and Report 013&rsquo;s for each skill: ${same('skill.content_hash')}) and the same suites (<code>suite.suite_hash</code>: ${same('suite.suite_hash')}).</p>
    <p><strong>The runner is theirs.</strong> Driftproof runner <code>${D(r0.run.runner_version, r0.run.runner_version, every, 'run.runner_version', 'same')}</code> on the <code>${D(r0.run.surface, r0.run.surface, every, 'run.surface', 'all-equal')}</code> surface, with the flags their runs used: at most ${D('80', '80', OUTF(1, H55, SKILLS[0]), 'per-model cap: ([0-9]+)', 're')} calls and ${D('8.00', '8.00', OUTF(1, H55, SKILLS[0]), 'budget \\$([0-9]+\\.[0-9]+)', 're')} dollars of estimated spend per skill run. It puts the SKILL.md text in the prompt for the with-skill arm and gives the baseline arm the task alone, with no tools in either. It draws generations per arm until the spread settles or a maximum is reached, and the judge scores each draw against the case&rsquo;s rubric on a continuous 0 to 1 scale.</p>
    <p><strong>The judge is theirs.</strong> <code>${D(r0.run.judge.model_id, r0.run.judge.model_id, every, 'run.judge.model_id', 'same')}</code>, with the grading template <code>${D(tpl.slice(0, 12), tpl, every, 'run.judge.prompt_template_hash', 'same-prefix')}</code> in every receipt.</p>
    <p><strong>The reading.</strong> A case&rsquo;s band is its mean across draws plus or minus the sample standard deviation across draws: a descriptive spread with no coverage probability. A skill clearly helped when the with-skill band and the without-skill band do not overlap and the averages differ by at least the ${D(floor, floor, 'config.js', floorRe, 're')} effect floor. A case that does not separate is read under spec 035&rsquo;s rule: when the spreads and draws could not have resolved a shift of the floor&rsquo;s size, it reads too few answers to tell, and otherwise no clear difference. Neither is evidence that the skill does nothing.</p>
  </div>`;
  return html.replace('\n  </div>', `\n    ${cite(html)}\n  </div>`);
}

// The figures behind each reading: a row per skill, model and run.
function tableSection(rec, v) {
  const rows = [];
  for (const s of SKILLS) for (const m of ARMS) for (const k of RUNS) {
    const r = R(rec, k, m, s); const f = REC(k, m, s);
    rows.push(`      <tr><td><code>${esc(s)}</code></td><td>${NAME[m]}</td><td>${runEl(k)}</td><td>${band(f, r, 'baseline')}</td><td>${band(f, r, 'with_skill')}</td><td>${liftEl(f, r)}</td><td>${chipEl(v, k, m, s)}</td></tr>`);
  }
  const table = `  <h3 id="figures">Every run, without the skill and with it</h3>
  <table class="summary">
    <thead><tr><th scope="col">task</th><th scope="col">model</th><th scope="col">run</th><th scope="col">without the skill: average &plusmn; spread (answers)</th><th scope="col">with the skill: average &plusmn; spread (answers)</th><th scope="col">what the skill added</th><th scope="col">result</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>`;
  const cap = 'What the skill added is a model&rsquo;s average with the skill minus its average without it. The result is the receipt&rsquo;s own reading of that, as its receipt page shows it. Claude Sonnet 5.5 and Claude Opus 5.5 are Report 013&rsquo;s receipts, run by run.';
  return `${table}
  <p class="muted">${cap}</p>
  ${cite(rows.join('\n'))}`;
}

function runRecordSection(rec) {
  const A = allNew();
  const capRe = 'if n >= ([0-9]+):';
  const cap = new RegExp(capRe).exec(readText(GUARD()))[1];
  const tRe = 'timeout=([0-9]+)\\)';
  const tmo = new RegExp(tRe).exec(readText(GUARD()))[1];
  const runP = RUNS.map((k) => {
    const status = readJsonl(STATUS(k));
    const recJ = readJson(RECORD(k));
    const calls = callsOf(status, '*', '*');
    const unmeasured = NEW_ARMS.flatMap((m) => SKILLS.map((s) => REC(k, m, s))).flatMap((f) => readJson(f).results.cases.map((c) => c.generation.n_unmeasured)).reduce((x, y) => x + y, 0);
    const last = status[status.length - 1];
    return `      <li><strong>${runEl(k)}</strong>, <code>${D(recJ.stamp, recJ.stamp, RECORD(k), 'stamp')}</code>: ${D(WORDS[status.length], status.length, STATUS(k), '[*]', 'count', 'w')} status lines, each with exit status ${D('0', '0', STATUS(k), '[*].exit', 'all-equal')} and ${D(WORDS[1], 1, STATUS(k), '[*].receipts', 'all-equal', 'w')} receipt, the last at <code>${D(last.at, last.at, STATUS(k), `[skill=${last.skill}][model=${last.model}].at`)}</code>; ${D(calls, calls, STATUS(k), '*|*', 'calls')} calls; ${D(unmeasured, unmeasured, NEW_ARMS.flatMap((m) => SKILLS.map((s) => REC(k, m, s))), 'results.cases[*].generation.n_unmeasured', 'sum')} unmeasured draws.</li>`;
  }).join('\n');
  const inner = `    <p><strong>The runs.</strong> Each run went arm by arm, one skill at a time, <code>${SKILLS[0]}</code> first in each. The command file writes a status line after each skill run. The two arms of a run were started separately, <code>${H55}</code> first and <code>${H45}</code> beside it, into the same run directory, so a run&rsquo;s status lines are the two arms&rsquo; together. The runs overlapped in time: the <code>${H45}</code> arm of one run ran beside the <code>${H55}</code> arm of the next. Each receipt&rsquo;s <code>run.date_utc</code> is written by the runner and is not read here as a start or a finish.</p>
    <ul>
${runP}
    </ul>
    <p><strong>The caps.</strong> A guard in front of Claude Code allowed ${D(cap, cap, GUARD(), capRe, 're')} calls per run and ${D(tmo, tmo, GUARD(), tRe, 're')} seconds per call, and stops a run when a call reports any model other than the one it asked for; no run stopped.</p>
`;
  const rows = RUNS.flatMap((k) => NEW_ARMS.map((m) => {
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
  const outs = RUNS.flatMap((k) => NEW_ARMS.flatMap((m) => SKILLS.map((s) => OUTF(k, m, s))));
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
  return `  <h3 id="evidence">Published evidence</h3>
  <details class="card fold"><summary><strong>The files this report makes public.</strong> For each run, the six receipts with their summaries, surface sidecars and the runner&rsquo;s console output, the run record, its registry copy, the status lines and the sha256 of every raw call record; the log of the three runs; the pricing snapshot; the release date record; and the call guard. The pricing snapshot records the sha256 of the page it was read from; that page is not published. Claude Sonnet 5.5 and Claude Opus 5.5 are read from Report 013&rsquo;s evidence, which is published with that report.</summary>
    <ul>
${names.map((n) => { const f = `${PUB}/${n}`; return `      <li><a href="evidence/${esc(n)}"><code>${esc(f)}</code></a><br><span class="muted">sha256 <code>${D(sha256(evidenceSet().get(n)), sha256(evidenceSet().get(n)), f, '', 'sha256')}</code></span></li>`; }).join('\n')}
    </ul>
    <p class="muted">Validate a receipt with <code>npx driftproof validate &lt;file&gt;</code>. Each copy here is byte-identical to its twin under <code>${esc(SPEC)}/</code>, and each sidecar names the receipt it belongs to and that receipt&rsquo;s hash.</p>
  </details>`;
}

// THE RECEIPTS SECTION THE REPORT CARD LINKS (spec 021 AC-18). The receipts sit in three directories,
// one per run, so the card says "linked receipts" and links this page's own Receipts section, which has
// to list every one of them; site-chrome.js puts the anchor before the heading.
function receiptsBlock() {
  const copies = new Set(receiptCopies().keys());
  const items = RUNS.flatMap((k) => NEW_ARMS.flatMap((m) => SKILLS.map((s) => {
    const c = `${RECEIPTS}/run-${k}/${stemOf(k, m, s)}.json`;
    if (!copies.has(c)) throw new Error(`not a receipt copy: ${c}`);
    return `      <li><code>${esc(s)}</code>@<code>${esc(m)}</code> <span class="muted">(run ${k})</span>: <a href="https://github.com/driftproofhq/driftproof/blob/main/${esc(c)}"><code>${esc(c)}</code></a></li>`;
  })));
  return `  <h2>Receipts</h2>
  <details class="card fold" open><summary><strong>Every receipt this report rests on, each one resolvable.</strong> Six for each run, one per model and skill, the same bytes as the evidence copies above.</summary>
    <ul>
${items.join('\n')}
    </ul>
    <p class="muted">Validate any of them with <code>npx driftproof validate &lt;file&gt;</code>. The comparison rows are Report 013&rsquo;s receipts, listed on that report.</p>
  </details>`;
}

function evidenceFold(rec, v) {
  const h2to3 = (html) => html.replace(/<h2 id="([^"]+)">/g, '<h3 id="$1">').replace(/<\/h2>/g, '</h3>');
  return `  <h2 id="evidence-and-files">Evidence and files</h2>
  <details class="fold"><summary>How the runs were set up, in full: departures and what stayed fixed</summary>
${h2to3(departuresSection(rec))}

${h2to3(setupSection(rec))}
  </details>
  <details class="fold"><summary>The figures behind each reading: every run&rsquo;s averages, spreads and answers</summary>
${tableSection(rec, v)}
  </details>
  <details class="fold"><summary>The run record: calls, costs and integrity</summary>
${h2to3(runRecordSection(rec))}
  </details>
${evidenceBlock()}

${receiptsBlock()}`;
}

function buildPage(rec) {
  const v = verdicts(rec);
  const base = applyHeadTags(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof: Report 014, Claude Haiku 5.5 on release day</title>
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
<main class="report shaped">
  <h1>Report 014: Claude Haiku 5.5 on release day, three skills</h1>
  <p class="report-type">Release drift report<span class="muted">. It measures a new model on the same skills and tasks as earlier reports, beside the model before it, with Report 013&rsquo;s Claude Sonnet 5.5 and Claude Opus 5.5 receipts as context.</span></p>

${resultSection(rec, v)}

${chartSection(rec)}

${readingsTiles(rec, v)}

${limitsTiles(rec)}

${evidenceFold(rec, v)}

  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report 014 · Release drift report</span></footer>
</main>
</body>
</html>
`, PAGE_REL);
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
    if (!drift.length) { console.log('report 014: page, evidence and receipt copies match their files'); return 0; }
    console.error(`report 014: DRIFTED: ${drift.join(', ')}`);
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

module.exports = { SKILLS, ARMS, NEW_ARMS, PUB, RECEIPTS, SPEC, PAGE_REL, OUT_DIR, evidenceSet, receiptCopies, stamps, readAll, buildPage, verdicts, bucketOf, main, slugOf };
