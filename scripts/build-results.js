#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/build-results.js: every published result in one file (spec 782, issue 782).
//
// ONE ROW PER ARM OF EVERY PUBLISHED RECEIPT, read from the sealed receipt and never from a page or a
// table somebody typed. A published measured receipt is one with a receipt page (spec 036); an imported
// one is listed in index-receipts/sources.json under skill-placebo or NVIDIA. The two sets are written to
// two files and never averaged together. Each figure is the value at its path in the receipt, and a value
// the receipt does not record is null, never worked out. Each row's label is its receipt page's, with the
// line under it, so a row carries its own caveat.
//
// NO ROW WITHOUT THE SEAL (AC-3). Every receipt is validated against its schema and its hash verified
// before any field is read, on every path: the build, --check, the export and the exported functions.
// The first failure refuses the whole build and nothing is written.
//
// A PACK IS RECORDED, NEVER TYPED (AC-7). The repository a skill came from is not in the receipt. It is
// read from the identity records below, each joined on a field the receipt seals. No record, no pack; two
// records that disagree refuse the build.
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN: no model call and no network call.
//
//   node scripts/build-results.js                     write the files and the datasheet page
//   node scripts/build-results.js --check             exit 1 naming any file that differs from a fresh build
//   node scripts/build-results.js --hf-export DIR     the Hugging Face shape, written to DIR outside the tree
//   ... [--root DIR]                                  read and write the tree at DIR
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';
const RAW = 'https://raw.githubusercontent.com/driftproofhq/driftproof/main';
const DATA_LICENCE = 'CC BY 4.0';
const DATA_LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const FILES = {
  measured: 'docs/data/driftproof-results.jsonl',
  measuredCsv: 'docs/data/driftproof-results.csv',
  imported: 'docs/data/driftproof-results-imported.jsonl',
  importedCsv: 'docs/data/driftproof-results-imported.csv',
  datasheet: 'docs/data/index.html',
};
const PAGE_REL = 'data/index.html';
const NOT_RECORDED = 'source not recorded';
const ARMS = ['with_skill', 'baseline'];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const refuse = (msg) => { throw Object.assign(new Error(`results: ${msg}`), { code: 'RESULTS_REFUSED' }); };
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const int = (x) => (Number.isInteger(x) ? x : null);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const at = (root, rel) => path.join(root, ...rel.split('/'));
const readJsonIf = (root, rel) => {
  const f = at(root, rel);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return refuse(`${rel} is not JSON`); }
};
const urlOf = (rel) => `${ORIGIN}/${rel.replace(/^docs\//, '')}`;

// ── the sealed receipts ──────────────────────────────────────────────────────────────────────────
function sealed(r, rel) {
  const v = validateReceipt(r);
  if (!v.valid) refuse(`${rel} is not valid against schema ${JSON.stringify(r && r.schema_version)}: ${(v.errors || []).slice(0, 2).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`);
  if (!verifyReceiptHash(r)) refuse(`${rel}: receipt_hash does not verify, so it is not read`);
  return r;
}
// Every receipt under receipts/ outside a *-draft/ directory, one per receipt_hash, the published copy of a
// skill measurement first (the rule scripts/build-receipt-pages.js publishes by). Each has a receipt page,
// and each receipt page a receipt, or the build refuses: the rows are the pages.
function measuredReceipts(root) {
  const all = [];
  (function walk(rel) {
    for (const e of fs.readdirSync(at(root, rel), { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (!/-draft$/.test(e.name)) walk(r); continue; }
      if (!e.name.endsWith('.json') || e.name.startsWith('_')) continue;
      const bytes = fs.readFileSync(at(root, r));
      let j; try { j = JSON.parse(bytes.toString('utf8')); } catch { continue; }
      if (!j || !j.results || !j.receipt_hash) continue;
      all.push({ rel: r, receipt: j, bytes });
    }
  })('receipts');
  const rank = (x) => (x.rel.includes('/skill-measurements/published/') ? 0 : 1);
  const seen = new Map();
  for (const x of [...all].sort((a, b) => rank(a) - rank(b) || cmp(a.rel, b.rel))) {
    sealed(x.receipt, x.rel);
    const old = seen.get(x.receipt.receipt_hash);
    if (!old) { seen.set(x.receipt.receipt_hash, { ...x, copies: [x.rel] }); continue; }
    if (JSON.stringify(old.receipt) !== JSON.stringify(x.receipt)) refuse(`${old.rel} and ${x.rel} carry one receipt_hash and differ`);
    old.copies.push(x.rel);
  }
  const pages = fs.existsSync(at(root, 'docs/r'))
    ? fs.readdirSync(at(root, 'docs/r'), { withFileTypes: true }).filter((e) => e.isDirectory() && /^[0-9a-f]{64}$/.test(e.name)).map((e) => e.name) : [];
  for (const h of seen.keys()) if (!pages.includes(h)) refuse(`receipt ${h.slice(0, 12)} has no receipt page: run node scripts/build-receipt-pages.js`);
  for (const h of pages) if (!seen.has(h)) refuse(`docs/r/${h.slice(0, 12)}/ has no receipt under receipts/`);
  return [...seen.values()].sort((a, b) => cmp(a.rel, b.rel));
}

function importedReceipts(root) {
  const src = readJsonIf(root, 'index-receipts/sources.json');
  if (!src || !Array.isArray(src.sources) || !Array.isArray(src.receipts)) refuse('index-receipts/sources.json names no sources and receipts');
  const licences = new Map(src.sources.map((s) => [s.id, s.licence]));
  const out = [];
  for (const e of src.receipts) {
    if (e.source === 'driftproof') continue;
    const bytes = fs.existsSync(at(root, e.file)) ? fs.readFileSync(at(root, e.file)) : refuse(`${e.file} is listed and missing`);
    if (sha256(bytes) !== e.sha256) refuse(`${e.file}: its sha256 is not the one sources.json records`);
    out.push({ rel: e.file, receipt: sealed(JSON.parse(bytes.toString('utf8')), e.file), bytes, entry: e });
  }
  return { licences, receipts: out.sort((a, b) => cmp(a.rel, b.rel)) };
}

// ── the identity records (spec 782 § Identity records) ───────────────────────────────────────────
function identityRecords(root) {
  const put = (m, k, v, from) => { if (!k || !v) return; if (!m.has(k)) m.set(k, []); m.get(k).push({ repo: v, from }); };
  const bySuite = new Map(); const byFile = new Map(); const byAttempt = new Map(); const byText = new Map(); const byPath = new Map();
  for (const s of ((readJsonIf(root, 'suites/manifest.json') || {}).skills) || []) {
    const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(String(s.repo || ''));
    put(bySuite, s.suite_hash, m && m[1], 'suites/manifest.json');
  }
  const p408 = readJsonIf(root, 'specs/408-skill-measurements/plan.json');
  for (const a of ((p408 && p408.execution && p408.execution.attempts) || [])) put(bySuite, (a.protocol || {}).suite_hash, (a.protocol || {}).repository, 'specs/408-skill-measurements/plan.json');
  for (const e of ((readJsonIf(root, 'index-receipts/sources.json') || {}).receipts) || []) {
    if (e.source === 'driftproof' && e.identity) put(byFile, e.sha256, `${e.identity.owner}/${e.identity.repo}`, 'index-receipts/sources.json');
  }
  // A campaign plan of this shape is found by its path, so a later report's needs no edit here (AC-14).
  for (const d of fs.readdirSync(at(root, 'receipts')).sort()) {
    const rel = `receipts/${d}/plan.json`;
    for (const row of ((readJsonIf(root, rel) || {}).rows) || []) put(byAttempt, row.attempt_id, row.repository, rel);
  }
  for (const p of ((readJsonIf(root, 'receipts/report-016/manifest.json') || {}).picks) || []) put(byText, p.sha256, p.repository, 'receipts/report-016/manifest.json');
  for (const p of ((readJsonIf(root, 'receipts/canary/manifest.json') || {}).pairs) || []) for (const k of ['before', 'after']) put(byPath, p[k], p.repository, 'receipts/canary/manifest.json');
  return (x) => {
    const r = x.receipt;
    const found = [...(bySuite.get((r.suite || {}).suite_hash) || []), ...(byText.get((r.skill || {}).content_hash) || [])];
    for (const rel of x.copies) {
      found.push(...(byFile.get(sha256(fs.readFileSync(at(root, rel)))) || []), ...(byAttempt.get(path.basename(rel, '.json')) || []), ...(byPath.get(rel) || []));
    }
    const repos = [...new Set(found.map((f) => f.repo))];
    if (repos.length > 1) refuse(`${x.rel}: the identity records name more than one pack (${found.map((f) => `${f.repo} in ${f.from}`).join(', ')})`);
    return repos[0] || null;
  };
}

// ── the rows ─────────────────────────────────────────────────────────────────────────────────────
const armsOf = (r) => {
  const cases = (r.results && r.results.cases) || [];
  const agg = (r.results && r.results.aggregates) || {};
  return [...ARMS.filter((m) => agg[m] || cases.some((c) => c.mode === m)), ...(r.placebo ? ['placebo'] : [])];
};
// The answers scored in an arm: each task row's recorded count, summed. A row that records none makes the
// arm's count unknown, never smaller.
function drawsOf(r, arm) {
  const rows = ((r.results && r.results.cases) || []).filter((c) => c.mode === arm);
  if (!rows.length) return null;
  let n = 0;
  for (const c of rows) {
    const k = c.generation ? int(c.generation.n_measured) : Array.isArray(c.samples) ? c.samples.length : null;
    if (k === null) return null;
    n += k;
  }
  return n;
}
function figures(r, arm) {
  const agg = (arm === 'placebo' ? ((r.placebo || {}).aggregates || {}).placebo : ((r.results || {}).aggregates || {})[arm]) || {};
  const c = r.comparison || {};
  const pc = arm === 'placebo' ? ((r.placebo || {}).comparison || {}) : {};
  return {
    mean: num(agg.mean_score), band: num(agg.stddev), cases: int(agg.case_count), draws: drawsOf(r, arm),
    lift: num(c.delta), lift_band: num(c.delta_uncertainty), placebo_lift: num(pc.delta), placebo_lift_band: num(pc.delta_uncertainty),
  };
}
// The words the receipt page prints: its label and the line under it (scripts/build-receipt-pages.js page()).
function pageWords(r) {
  const pages = require('./build-receipt-pages.js');
  const limit = require('../lib/report-015-publication').routerLimit(r);
  if (limit) return { label: limit.label, label_line: `${limit.reason} Report 015 Amendment 1.` };
  const v = require('../lib/verdict').receiptVerdict(r);
  return { label: pages.pageLabel(v), label_line: pages.honestLine(v) };
}
// The words spec 267's skill index uses for an imported row: NVIDIA's figures, read from that builder, or
// the plain label of a receipt below TESTED.
function importedWords(e, r) {
  const { plainOf, KEY } = require('../lib/plain');
  const line = `${KEY.REPORTED.charAt(0).toUpperCase()}${KEY.REPORTED.slice(1)}`;
  if (e.source !== 'nvidia') return { label: plainOf(r).label, label_line: line };
  const m = /\bNVLABEL: '((?:[^'\\]|\\.)*)'/.exec(fs.readFileSync(path.join(__dirname, 'build-skill-index.mjs'), 'utf8'));
  if (!m) refuse('scripts/build-skill-index.mjs carries no NVLABEL');
  return { label: m[1].replace(/\\'/g, "'"), label_line: line };
}
function reportsByHash(root) {
  const out = new Map();
  const doc = readJsonIf(root, 'docs/data/reports.json');
  for (const row of (doc && doc.reports) || []) {
    for (const p of row.receipt_paths || []) {
      const j = readJsonIf(root, typeof p === 'string' ? p : p.value);
      if (!j || typeof j.receipt_hash !== 'string') continue;
      if (!out.has(j.receipt_hash)) out.set(j.receipt_hash, new Set());
      out.get(j.receipt_hash).add(String(row.number.value));
    }
  }
  return out;
}

function load(root) {
  root = path.resolve(root);
  const measured = measuredReceipts(root);
  const imported = importedReceipts(root);
  const packOf = identityRecords(root);
  const reports = reportsByHash(root);
  for (const x of measured) {
    if (x.receipt.source_figures !== undefined || (x.receipt.run || {}).source !== undefined) refuse(`${x.rel} carries imported figures and is under receipts/`);
    x.pack = packOf(x);
    x.reports = [...(reports.get(x.receipt.receipt_hash) || [])].sort();
  }
  for (const x of imported.receipts) if (x.receipt.verification_level === 'TESTED') refuse(`${x.rel} is imported and TESTED`);
  return { root, measured, imported, reports };
}

function buildResults({ root = ROOT } = {}) {
  const ctx = load(root);
  const licence = ctx.imported.licences.get('driftproof');
  if (!licence) refuse('index-receipts/sources.json gives Driftproof no licence');
  const measured = ctx.measured.flatMap((x) => {
    const r = x.receipt;
    const words = pageWords(r);
    return armsOf(r).map((arm) => ({
      set: 'measured', source: 'driftproof', licence,
      skill: r.skill.name, pack: x.pack, model: r.run.model_id, surface: r.run.surface === undefined ? null : r.run.surface,
      date: String(r.run.date_utc).slice(0, 10), arm, ...figures(r, arm), ...words,
      reports: x.reports, receipt_hash: r.receipt_hash, page: `${ORIGIN}/r/${r.receipt_hash}/`,
      receipt_file: x.rel, receipt_url: `${RAW}/${x.rel}`,
    }));
  });
  const imported = ctx.imported.receipts.flatMap((x) => {
    const r = x.receipt; const e = x.entry; const id = e.identity || {};
    const words = importedWords(e, r);
    return armsOf(r).map((arm) => ({
      set: 'imported', source: e.source, licence: ctx.imported.licences.get(e.source) || refuse(`${e.source} has no licence`),
      skill: e.name, pack: `${id.owner}/${id.repo}`, model: r.run.model_id, surface: r.run.surface === undefined ? null : r.run.surface,
      date: String(r.run.date_utc).slice(0, 10), arm, ...figures(r, arm), ...words,
      reports: [], receipt_hash: r.receipt_hash, page: `${ORIGIN}/skills/${id.owner}/${id.repo}/${e.name}/`,
      receipt_file: x.rel, receipt_url: `${RAW}/${x.rel}`,
    }));
  });
  return { measured, imported };
}

// ── each report's skills (AC-11) ─────────────────────────────────────────────────────────────────
// Read once per tree: the site builders ask for every report on every page they render.
const loaded = new Map();
const loadOnce = (root) => { const k = path.resolve(root); if (!loaded.has(k)) loaded.set(k, load(k)); return loaded.get(k); };
// The skills a report's own receipts measured, grouped by pack: packs in code-unit order with an unknown
// pack last, names in code-unit order. Only a published, sealed receipt the report lists counts.
function reportSkillGroups({ root = ROOT, report } = {}) {
  const ctx = loadOnce(root);
  const groups = new Map();
  for (const x of ctx.measured) {
    if (!x.reports.includes(String(report))) continue;
    if (!groups.has(x.pack)) groups.set(x.pack, new Set());
    groups.get(x.pack).add(x.receipt.skill.name);
  }
  return [...groups].sort((a, b) => (a[0] === null) - (b[0] === null) || cmp(a[0], b[0])).map(([pack, s]) => ({ pack, skills: [...s].sort(cmp) }));
}
const listed = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const groupText = (g) => `${g.pack === null ? NOT_RECORDED : g.pack}: ${listed(g.skills)}`;
// "Skills measured: <pack>: <a>, <b> and <c>; <pack>: <d>." The empty string for a report with no receipts.
function skillsSentence(groups) {
  return groups.length ? `Skills measured: ${groups.map(groupText).join('; ')}.` : '';
}
// The same names, cut to fit a cap (spec 782 TBD-1 (a), Maverick's ruling of 11 Nov 2026): "<pack>: <skills>,
// on <models>.", whole names in order, "a, b and N more" where they do not fit, N exactly the names left
// out, and every model whole. `lead` comes first ("Report NNN: " where two reports would otherwise share
// one description, spec 133 AC-4). Null where even one name and the models do not fit.
function skillsDescription(groups, models, cap, lead = '') {
  const all = groups.flatMap((g) => g.skills.map((s) => ({ pack: g.pack, s })));
  const tail = `, on ${models}.`;
  for (let k = all.length; k >= 1; k--) {
    const kept = [];
    for (const x of all.slice(0, k)) {
      const g = kept.find((y) => y.pack === x.pack);
      if (g) g.skills.push(x.s); else kept.push({ pack: x.pack, skills: [x.s] });
    }
    const more = all.length - k;
    const head = kept.map((g, i) => (more && i === kept.length - 1
      ? `${g.pack === null ? NOT_RECORDED : g.pack}: ${g.skills.join(', ')} and ${more} more`
      : groupText(g))).join('; ');
    const out = `${lead}${head}${tail}`;
    if (out.length <= cap) return out;
  }
  return null;
}

// ── the files ────────────────────────────────────────────────────────────────────────────────────
const KEYS = ['set', 'source', 'licence', 'skill', 'pack', 'model', 'surface', 'date', 'arm', 'mean', 'band', 'cases', 'draws', 'lift', 'lift_band',
  'placebo_lift', 'placebo_lift_band', 'label', 'label_line', 'reports', 'receipt_hash', 'page', 'receipt_file', 'receipt_url'];
const ordered = (row) => Object.fromEntries(KEYS.map((k) => [k, row[k] === undefined ? null : row[k]]));
const jsonl = (rows) => rows.map((r) => JSON.stringify(ordered(r))).join('\n') + (rows.length ? '\n' : '');
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => [KEYS.join(','), ...rows.map((r) => KEYS.map((k) => csvCell(r[k])).join(','))].join('\n') + '\n';

// ── the datasheet: one set of words for the page and the dataset card ───────────────────────────
const TEXT = {
  title: 'Every Driftproof result in one file',
  // The page's opening paragraph, and so its description: the head builder draws it from here, as it
  // does on every page (spec 020 AC-14), and it fits in 155 characters, so it is never cut.
  opening: 'Every arm of every published Driftproof receipt as one row, in JSONL and CSV, with imported results apart, under CC BY 4.0.',
  lede: 'Each row is one arm of one published receipt: the skill and the repository it came from, the model, the average score of that arm with its band and its count of answers, the label its receipt page prints, the reports that list it, and its receipt hash and page. A script writes the rows from the sealed receipts. Nobody types them.',
  files: 'The files',
  measuredName: 'Measured by Driftproof',
  importedName: 'Imported from other projects',
  measuredWhat: 'Every arm of every receipt that has a page under /r/.',
  importedWhat: 'Every arm of the receipts the skill index imports from other projects.',
  apart: 'Do not average across the two files. A measured row is a score Driftproof measured. An imported row is a figure another project reported, which Driftproof reformatted or recomputed from that project\'s published files.',
  isHead: 'What a row is',
  is: [
    'One arm of one receipt: the answers with the skill, the answers without it, or the answers with a same-length placebo text where the receipt has one.',
    'Its figures are the values the receipt records, read at their paths. A value the receipt does not record is empty, never worked out.',
    'Its label and label_line are the words its receipt page prints, so each row carries its own caveat.',
  ],
  isNotHead: 'What a row is not',
  isNot: [
    'A row is not a ranking. It is one arm, on one model, on one date.',
    'No separation detected at this sample size is not evidence that nothing changed.',
    'Not enough draws is not a verdict either way.',
    'The arms of one receipt share their test tasks, so their rows are not independent of each other.',
    'A band is the sample standard deviation of the per-task averages: a descriptive spread with no coverage probability.',
    'No answer text and no judge transcript is in the files. Each row links its receipt page.',
  ],
  fieldsHead: 'The fields',
  fields: [
    ['set', 'measured or imported.'],
    ['source', 'driftproof, or the project an imported receipt came from.'],
    ['licence', 'the licence of the receipt\'s source.'],
    ['skill', 'the skill\'s name as the receipt records it.'],
    ['pack', 'the repository the skill came from, read from an identity record joined on a field the receipt seals; empty where no record names one.'],
    ['model, surface, date', 'the model that answered, the harness it ran on, and the day of the run.'],
    ['arm', 'with_skill, baseline or placebo.'],
    ['mean, band, cases', 'the arm\'s average score, the spread of its per-task averages, and its number of test tasks.'],
    ['draws', 'the answers scored in the arm, summed over its test tasks; empty where a task records no count.'],
    ['lift, lift_band', 'the receipt\'s average with the skill minus its average without, and the band the receipt records for that difference.'],
    ['placebo_lift, placebo_lift_band', 'on a placebo row, the receipt\'s average with the skill minus its average with the placebo, and its band.'],
    ['label, label_line', 'the label the receipt page prints and the line under it.'],
    ['reports', 'the reports that list the receipt; empty for a receipt no report lists.'],
    ['receipt_hash, page, receipt_file, receipt_url', 'the receipt\'s sealed hash, its page, and its file.'],
  ],
  licenceHead: 'Licence',
  citeHead: 'Cite as',
};

function datasetFacts(root, files) {
  const sources = (readJsonIf(root, 'index-receipts/sources.json') || {}).sources || [];
  const facts = ['measured', 'imported'].map((k) => {
    const bytes = files[FILES[k]];
    const rows = bytes.split('\n').filter(Boolean);
    return { key: k, rel: FILES[k], csv: FILES[`${k}Csv`], rows: rows.length, sha: sha256(Buffer.from(bytes, 'utf8')), dates: rows.map((l) => JSON.parse(l).date) };
  });
  const asOf = facts.flatMap((f) => f.dates).sort().pop() || null;
  const cite = `Driftproof results, as of ${asOf}. driftproofhq. ${facts.map((f) => `${urlOf(f.rel)} (${f.rows} rows, sha256 ${f.sha.slice(0, 12)})`).join(' and ')}. Licensed ${DATA_LICENCE}.`;
  const licences = sources.map((s) => `${s.licence} for ${s.id === 'driftproof' ? 'Driftproof\'s own receipts' : `${s.name}'s`}`);
  return { facts, asOf, cite, licences };
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function datasheetHtml(f) {
  const file = (x) => `<li><a href="/${x.rel.replace(/^docs\//, '')}">${esc(path.basename(x.rel))}</a> and <a href="/${x.csv.replace(/^docs\//, '')}">${esc(path.basename(x.csv))}</a>: ${esc(x.key === 'measured' ? TEXT.measuredName : TEXT.importedName)}, ${x.rows} rows. ${esc(x.key === 'measured' ? TEXT.measuredWhat : TEXT.importedWhat)}</li>`;
  const main = `<main class="screens">
<section class="screen is-text">
<h1>${esc(TEXT.title)}</h1>
<p>${esc(TEXT.opening)}</p>
<p>${esc(TEXT.lede)}</p>
<h2>${esc(TEXT.files)}</h2>
<ul>
${f.facts.map(file).join('\n')}
</ul>
<p>${esc(TEXT.apart)}</p>
<h2>${esc(TEXT.isHead)}</h2>
<ul>
${TEXT.is.map((s) => `<li>${esc(s)}</li>`).join('\n')}
</ul>
<h2>${esc(TEXT.isNotHead)}</h2>
<ul>
${TEXT.isNot.map((s) => `<li>${esc(s)}</li>`).join('\n')}
</ul>
<h2>${esc(TEXT.fieldsHead)}</h2>
<dl>
${TEXT.fields.map(([k, v]) => `<dt><code>${esc(k)}</code></dt><dd>${esc(v)}</dd>`).join('\n')}
</dl>
<h2>${esc(TEXT.licenceHead)}</h2>
<p>The files are licensed <a href="${DATA_LICENCE_URL}">${DATA_LICENCE}</a>. Each row also carries its source's own licence: ${esc(listed(f.licences))}.</p>
<h2>${esc(TEXT.citeHead)}</h2>
<p class="cite-as" id="cite-as">${esc(f.cite)}</p>
</section>
</main>`;
  const chrome = require('./site-chrome.js');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TEXT.title)} | Driftproof</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
${chrome.NAV}
${main}
${chrome.FOOTER}
</body>
</html>
`;
  return require('./build-head-tags.js').applyHeadTags(html, PAGE_REL);
}
// The dataset card for a later Hugging Face dataset: the datasheet's words, in Markdown.
function datasetCard(f) {
  return `---
license: cc-by-4.0
pretty_name: Driftproof results
configs:
- config_name: measured
  data_files: measured.jsonl
- config_name: imported
  data_files: imported.jsonl
---

# ${TEXT.title}

${TEXT.lede}

One row per receipt here: \`receipt_json\` holds the receipt file byte for byte. The per-arm files are at ${ORIGIN}/data/.

${TEXT.apart}

## ${TEXT.isNotHead}

${TEXT.isNot.map((s) => `- ${s}`).join('\n')}

## ${TEXT.licenceHead}

The data is licensed ${DATA_LICENCE} (${DATA_LICENCE_URL}). Each row also carries its source's own licence: ${listed(f.licences)}.

\`newer_models\` is read when the export runs, from the model registry committed with it: the models of the same family released after the run. It is not a field of the receipt.

## ${TEXT.citeHead}

${f.cite}
`;
}

function renderFiles({ root = ROOT } = {}) {
  const { measured, imported } = buildResults({ root });
  const files = {
    [FILES.measured]: jsonl(measured), [FILES.measuredCsv]: csv(measured),
    [FILES.imported]: jsonl(imported), [FILES.importedCsv]: csv(imported),
  };
  files[FILES.datasheet] = datasheetHtml(datasetFacts(root, files));
  return files;
}

// ── the Hugging Face export (AC-16): one row per receipt, receipt_json byte for byte ────────────
function hfExport({ root = ROOT, out }) {
  root = path.resolve(root);
  const dir = path.resolve(out);
  if (dir === root || dir.startsWith(`${root}${path.sep}`)) refuse(`the export directory ${dir} is inside the tree it reads; write it outside the tree`);
  const ctx = load(root);
  const { advisories } = require('../lib/stale');
  const base = (x, r) => ({ model: r.run.model_id, date: String(r.run.date_utc).slice(0, 10), judge_model: ((r.run || {}).judge || {}).model_id || null,
    lift: num((r.comparison || {}).delta), lift_band: num((r.comparison || {}).delta_uncertainty), verification_level: r.verification_level || null,
    schema_version: r.schema_version || null, receipt_hash: r.receipt_hash, newer_models: advisories(r).map((m) => m.model_id),
    receipt_file: x.rel, receipt_json: x.bytes.toString('utf8') });
  const licence = ctx.imported.licences.get('driftproof');
  const measured = ctx.measured.map((x) => ({ set: 'measured', source: 'driftproof', licence, skill: x.receipt.skill.name, pack: x.pack, label: pageWords(x.receipt).label,
    reports: x.reports, permalink: `${ORIGIN}/r/${x.receipt.receipt_hash}/`, ...base(x, x.receipt) }));
  const imported = ctx.imported.receipts.map((x) => {
    const id = x.entry.identity || {};
    return { set: 'imported', source: x.entry.source, licence: ctx.imported.licences.get(x.entry.source), skill: x.entry.name, pack: `${id.owner}/${id.repo}`,
      label: importedWords(x.entry, x.receipt).label, reports: [], permalink: `${ORIGIN}/skills/${id.owner}/${id.repo}/${x.entry.name}/`, ...base(x, x.receipt) };
  });
  const files = renderFiles({ root });
  const card = datasetCard(datasetFacts(root, files));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'measured.jsonl'), measured.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'imported.jsonl'), imported.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'README.md'), card);
  return { measured: measured.length, imported: imported.length, dir };
}

// THE ONE REFERENCE CITATION.cff CARRIES FOR THE FILES (spec 782; spec 127 A-127-8 holds the file to it).
// No date and no hash, so it does not go stale as receipts are added: the cite-as line names the bytes.
const CITATION_REFERENCE = {
  type: 'data', title: TEXT.title, authors: [{ name: 'driftproofhq' }],
  url: `${ORIGIN}/data/`, 'repository-artifact': urlOf(FILES.measured), license: 'CC-BY-4.0',
};

module.exports = { CITATION_REFERENCE, buildResults, renderFiles, hfExport, reportSkillGroups, skillsSentence, skillsDescription, datasetFacts, TEXT, FILES, KEYS, NOT_RECORDED, DATA_LICENCE, DATA_LICENCE_URL };

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1]; };
  const root = path.resolve(arg('--root') || ROOT);
  try {
    if (argv.includes('--hf-export')) {
      const out = arg('--hf-export');
      if (!out) refuse('--hf-export needs a directory');
      const r = hfExport({ root, out });
      console.log(`results export: ${r.measured} measured and ${r.imported} imported receipts written to ${r.dir}`);
      return 0;
    }
    const files = renderFiles({ root });
    if (argv.includes('--check')) {
      const stale = Object.entries(files).filter(([rel, body]) => !fs.existsSync(at(root, rel)) || fs.readFileSync(at(root, rel), 'utf8') !== body).map(([rel]) => rel);
      if (stale.length) { console.error(`results: stale - run: node scripts/build-results.js\n  ${stale.join('\n  ')}`); return 1; }
      console.log(`results: ${Object.keys(files).length} files match a fresh build from the receipts`);
      return 0;
    }
    for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(at(root, rel)), { recursive: true }); fs.writeFileSync(at(root, rel), body); }
    console.log(`results: ${Object.keys(files).length} files written`);
    return 0;
  } catch (e) {
    if (e.code !== 'RESULTS_REFUSED') throw e;
    console.error(e.message);
    return 2;
  }
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
