// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 782 (specs/782-findable-results): the results files, the datasheet, each report's skills line and the
// Hugging Face export, read against the receipts by a reader that shares no code with scripts/build-results.js.
// The published set is the receipt pages under docs/r/; each figure is read from the receipt file at its path;
// each label from the receipt page; each pack from the identity record joined on a sealed field. Every
// invariant has a plant that reads RED. Fixture trees go in fresh scratch; nothing here writes into the tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { htmlToText } = require('../scripts/html-text.js');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';
const RAW = 'https://raw.githubusercontent.com/driftproofhq/driftproof/main';
const SCRIPT = path.join(ROOT, 'scripts', 'build-results.js');
const FILES = {
  measured: 'docs/data/driftproof-results.jsonl',
  measuredCsv: 'docs/data/driftproof-results.csv',
  imported: 'docs/data/driftproof-results-imported.jsonl',
  importedCsv: 'docs/data/driftproof-results-imported.csv',
  datasheet: 'docs/data/index.html',
};
const LICENCES = { driftproof: 'Apache-2.0', 'skill-placebo': 'MIT', nvidia: 'CC-BY-4.0' };
const NOT_RECORDED = 'source not recorded';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const readJsonIf = (root, rel) => (fs.existsSync(path.join(root, rel)) ? readJson(root, rel) : null);
const readRows = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const int = (x) => (Number.isInteger(x) ? x : null);
const clone = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', nbsp: ' ' };
const decodeOnce = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|rsquo|lsquo|ldquo|rdquo|middot|nbsp);/g, (_m, k) => ENT[k]);
const text = (html) => htmlToText(String(html), { decode: decodeOnce, collapse: true }).trim();
const scratch = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec782-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// ── the reader's own view of the published receipts ───────────────────────────────────────────────
// Every file under receipts/ outside a *-draft/ directory that parses and carries a receipt_hash, by hash.
function receiptCopies(root) {
  const out = new Map();
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (!/-draft$/.test(e.name)) walk(r); continue; }
      if (!e.name.endsWith('.json')) continue;
      let j; try { j = JSON.parse(fs.readFileSync(path.join(root, r), 'utf8')); } catch { continue; }
      if (!j || typeof j.receipt_hash !== 'string' || !j.results) continue;
      if (!out.has(j.receipt_hash)) out.set(j.receipt_hash, []);
      out.get(j.receipt_hash).push(r);
    }
  })('receipts');
  return out;
}
function draftHashes(root) {
  const out = new Set();
  (function walk(rel, inDraft) {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(r, inDraft || /-draft$/.test(e.name)); continue; }
      if (!inDraft || !e.name.endsWith('.json')) continue;
      try { const j = JSON.parse(fs.readFileSync(path.join(root, r), 'utf8')); if (j && j.receipt_hash) out.add(j.receipt_hash); } catch { /* not a receipt */ }
    }
  })('receipts', false);
  return out;
}
// The published set is the receipt pages (spec 036): one directory per receipt_hash.
const publishedHashes = (root) => new Set(fs.readdirSync(path.join(root, 'docs', 'r'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^[0-9a-f]{64}$/.test(e.name)).map((e) => e.name));

const armsOf = (r) => {
  const cases = (r.results && r.results.cases) || [];
  const agg = (r.results && r.results.aggregates) || {};
  return [...['with_skill', 'baseline'].filter((m) => agg[m] || cases.some((c) => c.mode === m)), ...(r.placebo ? ['placebo'] : [])];
};
// The arm's draws: each case row's recorded measured count, summed; null where any row records none.
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
function figuresOf(r, arm) {
  const agg = (arm === 'placebo' ? ((r.placebo || {}).aggregates || {}).placebo : ((r.results || {}).aggregates || {})[arm]) || {};
  const cmp = r.comparison || {};
  const out = { mean: num(agg.mean_score), band: num(agg.stddev), cases: int(agg.case_count), draws: drawsOf(r, arm), lift: num(cmp.delta), lift_band: num(cmp.delta_uncertainty) };
  if (arm === 'placebo') {
    const pc = (r.placebo || {}).comparison || {};
    out.placebo_lift = num(pc.delta);
    out.placebo_lift_band = num(pc.delta_uncertainty);
  }
  return out;
}
function pageWords(root, hash) {
  const html = fs.readFileSync(path.join(root, 'docs', 'r', hash, 'index.html'), 'utf8');
  const label = /<p class="receipt-label" data-field="label">([\s\S]*?)<\/p>/.exec(html);
  const line = /<p class="receipt-honest" data-field="honest">([\s\S]*?)<\/p>/.exec(html);
  return { label: label ? text(label[1]) : null, label_line: line ? text(line[1]) : null };
}
function reportsByHash(root) {
  const out = new Map();
  for (const row of readJson(root, 'docs/data/reports.json').reports) {
    for (const p of row.receipt_paths || []) {
      let j; try { j = readJson(root, p.value); } catch { continue; }
      if (!j || typeof j.receipt_hash !== 'string') continue;
      if (!out.has(j.receipt_hash)) out.set(j.receipt_hash, new Set());
      out.get(j.receipt_hash).add(String(row.number.value));
    }
  }
  return out;
}

// The identity records (spec § Identity records), each joined on a field the receipt seals.
function recordedPacks(root, copies) {
  const put = (m, k, v) => { if (!k || !v) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
  const bySuite = new Map(); const byFile = new Map(); const byAttempt = new Map(); const byText = new Map(); const byPath = new Map();
  for (const s of ((readJsonIf(root, 'suites/manifest.json') || {}).skills) || []) {
    const m = /github\.com\/([^/]+\/[^/.]+)/.exec(String(s.repo));
    put(bySuite, s.suite_hash, m && m[1]);
  }
  const p408 = readJsonIf(root, 'specs/408-skill-measurements/plan.json');
  for (const a of ((p408 && p408.execution && p408.execution.attempts) || [])) put(bySuite, (a.protocol || {}).suite_hash, (a.protocol || {}).repository);
  for (const e of ((readJsonIf(root, 'index-receipts/sources.json') || {}).receipts) || []) {
    if (e.source === 'driftproof' && e.identity) put(byFile, e.sha256, `${e.identity.owner}/${e.identity.repo}`);
  }
  for (const d of fs.readdirSync(path.join(root, 'receipts'))) {
    for (const row of ((readJsonIf(root, `receipts/${d}/plan.json`) || {}).rows) || []) put(byAttempt, row.attempt_id, row.repository);
  }
  for (const p of ((readJsonIf(root, 'receipts/report-016/manifest.json') || {}).picks) || []) put(byText, p.sha256, p.repository);
  for (const p of ((readJsonIf(root, 'receipts/canary/manifest.json') || {}).pairs) || []) for (const k of ['before', 'after']) put(byPath, p[k], p.repository);
  const out = new Map();
  for (const [h, rels] of copies) {
    const r = readJson(root, rels[0]);
    const found = new Set([...(bySuite.get((r.suite || {}).suite_hash) || []), ...(byText.get((r.skill || {}).content_hash) || [])]);
    for (const rel of rels) {
      for (const x of byFile.get(sha256(fs.readFileSync(path.join(root, rel)))) || []) found.add(x);
      for (const x of byAttempt.get(path.basename(rel, '.json')) || []) found.add(x);
      for (const x of byPath.get(rel) || []) found.add(x);
    }
    out.set(h, found);
  }
  return out;
}

function measuredContext(root = ROOT) {
  const copies = receiptCopies(root);
  const published = publishedHashes(root);
  const src = readJson(root, 'index-receipts/sources.json');
  return { root, copies, published, reports: reportsByHash(root), packs: recordedPacks(root, copies), drafts: draftHashes(root),
    licence: (src.sources.find((s) => s.id === 'driftproof') || {}).licence, receipt: (h) => readJson(root, copies.get(h)[0]) };
}
function expectedMeasured(ctx, h, arm) {
  const r = ctx.receipt(h);
  const packs = [...(ctx.packs.get(h) || [])];
  return {
    set: 'measured', source: 'driftproof', licence: ctx.licence,
    skill: r.skill.name, pack: packs.length === 1 ? packs[0] : null, model: r.run.model_id, surface: r.run.surface === undefined ? null : r.run.surface,
    date: String(r.run.date_utc).slice(0, 10), arm, ...figuresOf(r, arm), ...pageWords(ctx.root, h),
    reports: [...(ctx.reports.get(h) || [])].sort(), receipt_hash: h, page: `${ORIGIN}/r/${h}/`,
  };
}
// Every problem the reader finds in the measured rows, as text. Empty means the file holds the claim.
function measuredProblems(rows, ctx) {
  const problems = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.receipt_hash}|${row.arm}`;
    if (seen.has(key)) problems.push(`doubled: ${key}`);
    seen.add(key);
    if (!ctx.published.has(row.receipt_hash) || !ctx.copies.has(row.receipt_hash)) { problems.push(`not a published measured receipt: ${key}`); continue; }
    const r = ctx.receipt(row.receipt_hash);
    if (!armsOf(r).includes(row.arm)) { problems.push(`no such arm: ${key}`); continue; }
    if ((ctx.packs.get(row.receipt_hash) || new Set()).size > 1) problems.push(`records disagree on the pack: ${key}`);
    if (r.source_figures !== undefined || (r.run || {}).source !== undefined) problems.push(`an imported receipt in the measured file: ${key}`);
    const want = expectedMeasured(ctx, row.receipt_hash, row.arm);
    for (const [k, v] of Object.entries(want)) if (!same(row[k], v)) problems.push(`${key}: ${k} is ${JSON.stringify(row[k])}, the receipt's is ${JSON.stringify(v)}`);
    if (!ctx.copies.get(row.receipt_hash).includes(row.receipt_file)) problems.push(`${key}: receipt_file ${row.receipt_file} carries another hash`);
    if (row.receipt_url !== `${RAW}/${row.receipt_file}`) problems.push(`${key}: receipt_url is not the file's`);
  }
  for (const h of ctx.published) {
    if (!ctx.copies.has(h)) { problems.push(`a receipt page with no receipt: ${h}`); continue; }
    for (const arm of armsOf(ctx.receipt(h))) if (!seen.has(`${h}|${arm}`)) problems.push(`missing: ${h}|${arm}`);
  }
  return problems;
}

// The imported side: index-receipts/sources.json's skill-placebo and NVIDIA entries.
function importedContext(root = ROOT) {
  const src = readJson(root, 'index-receipts/sources.json');
  const licence = new Map(src.sources.map((s) => [s.id, s.licence]));
  const entries = new Map(src.receipts.filter((e) => e.source !== 'driftproof').map((e) => [readJson(root, e.file).receipt_hash, e]));
  return { root, entries, licence };
}
function importedProblems(rows, ctx) {
  const problems = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.receipt_hash}|${row.arm}`;
    if (seen.has(key)) problems.push(`doubled: ${key}`);
    seen.add(key);
    const e = ctx.entries.get(row.receipt_hash);
    if (!e) { problems.push(`not an imported receipt: ${key}`); continue; }
    const r = readJson(ctx.root, e.file);
    if (r.verification_level === 'TESTED') problems.push(`a TESTED receipt in the imported file: ${key}`);
    const id = e.identity || {};
    const name = id.path ? id.path.split('/').pop() : id.repo;
    const page = `skills/${id.owner}/${id.repo}/${name}/index.html`;
    if (!fs.existsSync(path.join(ctx.root, 'docs', page))) problems.push(`${key}: no skill index page ${page}`);
    const want = { set: 'imported', source: e.source, licence: ctx.licence.get(e.source), pack: `${id.owner}/${id.repo}`, skill: name, model: r.run.model_id,
      date: String(r.run.date_utc).slice(0, 10), arm: row.arm, ...figuresOf(r, row.arm), reports: [], receipt_hash: row.receipt_hash,
      receipt_file: e.file, page: `${ORIGIN}/${page.replace(/index\.html$/, '')}` };
    if (want.licence !== LICENCES[e.source]) problems.push(`${key}: sources.json gives ${e.source} the licence ${want.licence}`);
    for (const [k, v] of Object.entries(want)) if (!same(row[k], v)) problems.push(`${key}: ${k} is ${JSON.stringify(row[k])}, the receipt's is ${JSON.stringify(v)}`);
  }
  for (const [h, e] of ctx.entries) for (const arm of armsOf(readJson(ctx.root, e.file))) if (!seen.has(`${h}|${arm}`)) problems.push(`missing: ${h}|${arm}`);
  return problems;
}

// ── the skills line: "Skills measured: <pack>: <a>, <b> and <c>; <pack>: <d>." ─────────────────────
const splitNames = (s) => { const parts = s.split(', '); const last = parts.pop(); return [...parts, ...last.split(' and ')]; };
function parseSkills(line) {
  const m = /^Skills measured: (.+)\.$/.exec(String(line).trim());
  if (!m) return null;
  const out = new Map();
  for (const g of m[1].split('; ')) {
    const at = g.indexOf(': ');
    if (at < 0) return null;
    const pack = g.slice(0, at);
    out.set(pack === NOT_RECORDED ? null : pack, splitNames(g.slice(at + 2)).sort());
  }
  return out;
}
const listed = (ns) => (ns.length < 2 ? ns.join('') : `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);
const sentence = (groups) => `Skills measured: ${[...groups].map(([p, ns]) => `${p === null ? NOT_RECORDED : p}: ${listed(ns)}`).join('; ')}.`;
const groupsKey = (groups) => JSON.stringify([...groups].map(([p, ns]) => [p, [...ns].sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
// What each report measured: the skills of the receipts its row lists, each under the pack its rows carry.
function reportGroups(root, measuredRows) {
  const packOf = new Map(measuredRows.map((r) => [r.receipt_hash, r.pack]));
  const out = new Map();
  for (const row of readJson(root, 'docs/data/reports.json').reports) {
    const groups = new Map();
    for (const p of row.receipt_paths || []) {
      let j; try { j = readJson(root, p.value); } catch { continue; }
      if (!j || typeof j.receipt_hash !== 'string' || !j.skill) continue;
      const pack = packOf.has(j.receipt_hash) ? packOf.get(j.receipt_hash) : null;
      if (!groups.has(pack)) groups.set(pack, new Set());
      groups.get(pack).add(j.skill.name);
    }
    if (groups.size) out.set(String(row.number.value), new Map([...groups].map(([p, s]) => [p, [...s].sort()])));
  }
  return out;
}
const skillsLines = (html) => new Map([...String(html).matchAll(/<p class="report-skills" data-report="(\d+)">([\s\S]*?)<\/p>/g)].map((m) => [m[1], text(m[2])]));
function skillsProblems(lines, want, where) {
  const problems = [];
  for (const [n, groups] of want) {
    const line = lines.get(n);
    if (line === undefined) { problems.push(`${where}: Report ${n} has no skills line`); continue; }
    const got = parseSkills(line);
    if (!got) problems.push(`${where}: Report ${n}'s line does not parse: ${line}`);
    else if (groupsKey(got) !== groupsKey(groups)) problems.push(`${where}: Report ${n} names ${groupsKey(got)}, its receipts ${groupsKey(groups)}`);
  }
  for (const n of lines.keys()) if (!want.has(n)) problems.push(`${where}: Report ${n} names skills and has no receipts`);
  return problems;
}

// ── the committed files ──────────────────────────────────────────────────────────────────────────
let cached = null;
const committed = () => {
  if (!cached) cached = { measured: readRows(ROOT, FILES.measured), imported: readRows(ROOT, FILES.imported), mctx: measuredContext(ROOT), ictx: importedContext(ROOT) };
  return cached;
};
const pick = (rows, f) => { const i = rows.findIndex(f); assert.ok(i >= 0, 'the plant found no row to change'); return i; };

test('AC-782-1, 2, 4 to 9: every published measured arm is one row, equal to its receipt', () => {
  const { measured, mctx } = committed();
  assert.deepEqual(measuredProblems(measured, mctx).slice(0, 20), []);
});

test('AC-782-1 plants: a row missing, doubled, a draft or unpublished hash, a placebo arm dropped', () => {
  const { measured, mctx } = committed();
  const drop = clone(measured); drop.splice(0, 1);
  assert.ok(measuredProblems(drop, mctx).some((p) => p.startsWith('missing:')));
  const twice = clone(measured); twice.push(clone(measured[0]));
  assert.ok(measuredProblems(twice, mctx).some((p) => p.startsWith('doubled:')));
  const draft = [...mctx.drafts][0] || '0'.repeat(64);
  const extra = clone(measured); extra.push({ ...clone(measured[0]), receipt_hash: draft });
  assert.ok(measuredProblems(extra, mctx).some((p) => p.startsWith('not a published measured receipt:')));
  const noPlacebo = clone(measured); noPlacebo.splice(pick(noPlacebo, (r) => r.arm === 'placebo'), 1);
  assert.ok(measuredProblems(noPlacebo, mctx).some((p) => p.startsWith('missing:') && p.endsWith('|placebo')));
});

test('AC-782-2 plants: a mean edited, a band filled where none is recorded, draws off by one', () => {
  const { measured, mctx } = committed();
  const mean = clone(measured); mean[pick(mean, (r) => typeof r.mean === 'number')].mean += 0.001;
  assert.ok(measuredProblems(mean, mctx).some((p) => /: mean is /.test(p)));
  const band = clone(measured); band[pick(band, (r) => r.band === null)].band = 0.1;
  assert.ok(measuredProblems(band, mctx).some((p) => /: band is /.test(p)));
  const draws = clone(measured); draws[pick(draws, (r) => Number.isInteger(r.draws))].draws += 1;
  assert.ok(measuredProblems(draws, mctx).some((p) => /: draws is /.test(p)));
});

test('AC-782-4 plants: a label swapped, a no-separation row without its line', () => {
  const { measured, mctx } = committed();
  const label = clone(measured); const i = pick(label, (r) => r.label === 'No separation detected');
  label[i].label = 'Passing';
  assert.ok(measuredProblems(label, mctx).some((p) => /: label is /.test(p)));
  const line = clone(measured); line[i].label_line = null;
  assert.ok(measuredProblems(line, mctx).some((p) => /: label_line is /.test(p)));
  assert.match(measured[i].label_line, /not evidence that nothing changed/);
});

test('AC-782-5, 6, 7, 8 plants: a skill renamed, a dead page, a report moved, a typed pack, an imported row', () => {
  const { measured, imported, mctx } = committed();
  const skill = clone(measured); skill[0].skill = 'not-a-skill';
  assert.ok(measuredProblems(skill, mctx).some((p) => /: skill is /.test(p)));
  const page = clone(measured); page[0].page = `${ORIGIN}/r/${'f'.repeat(64)}/`;
  assert.ok(measuredProblems(page, mctx).some((p) => /: page is /.test(p)));
  const both = clone(measured); const j = pick(both, (r) => same(r.reports, ['007', '008']));
  both[j].reports = ['007'];
  assert.ok(measuredProblems(both, mctx).some((p) => /: reports is /.test(p)));
  const canary = clone(measured); canary[pick(canary, (r) => r.receipt_file.startsWith('receipts/canary/'))].reports = ['018'];
  assert.ok(measuredProblems(canary, mctx).some((p) => /: reports is /.test(p)));
  const pack = clone(measured); pack[pick(pack, (r) => r.pack !== null)].pack = 'someone/else';
  assert.ok(measuredProblems(pack, mctx).some((p) => /: pack is /.test(p)));
  const moved = clone(measured); moved.push({ ...clone(imported.find((r) => r.source === 'nvidia')), set: 'measured' });
  assert.ok(measuredProblems(moved, mctx).some((p) => p.startsWith('not a published measured receipt:')));
  const relabelled = clone(measured); relabelled[0].set = 'imported';
  assert.ok(measuredProblems(relabelled, mctx).some((p) => /: set is /.test(p)));
});

test('AC-782-8, 9: every imported arm is one row in its own file, with its source and licence', () => {
  const { imported, ictx } = committed();
  assert.deepEqual(importedProblems(imported, ictx).slice(0, 20), []);
  const licence = clone(imported); licence[pick(licence, (r) => r.source === 'nvidia')].licence = 'Apache-2.0';
  assert.ok(importedProblems(licence, ictx).some((p) => /: licence is /.test(p)));
  const mean = clone(imported); mean[pick(mean, (r) => typeof r.mean === 'number')].mean += 0.001;
  assert.ok(importedProblems(mean, ictx).some((p) => /: mean is /.test(p)));
  const drop = clone(imported); drop.pop();
  assert.ok(importedProblems(drop, ictx).some((p) => p.startsWith('missing:')));
});

// A CSV beside each JSONL: the same rows in the same order, null as an empty cell, a list joined by ";".
function parseCsv(s) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const cellOf = (v) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : String(v));
for (const [jsonl, csv] of [[FILES.measured, FILES.measuredCsv], [FILES.imported, FILES.importedCsv]]) {
  test(`AC-782-12: ${csv} holds the rows of ${jsonl}`, () => {
    const rows = readRows(ROOT, jsonl);
    const table = parseCsv(fs.readFileSync(path.join(ROOT, csv), 'utf8'));
    const head = table[0];
    assert.deepEqual(head, Object.keys(rows[0]));
    assert.equal(table.length - 1, rows.length);
    rows.forEach((r, i) => assert.deepEqual(table[i + 1], head.map((k) => cellOf(r[k])), `row ${i + 1}`));
  });
}

test('AC-782-9, 10: the datasheet states CC BY 4.0, the warning, and a cite-as line naming these bytes', () => {
  const html = fs.readFileSync(path.join(ROOT, FILES.datasheet), 'utf8');
  const body = text(html);
  assert.match(body, /CC BY 4\.0/);
  assert.match(html, /href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/);
  assert.match(body, /Do not average/);
  assert.match(body, /not evidence that nothing changed/);
  const cite = /<p class="cite-as" id="cite-as">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(cite, 'no cite-as line');
  const line = text(cite[1]);
  const dates = [];
  for (const rel of [FILES.measured, FILES.imported]) {
    const bytes = fs.readFileSync(path.join(ROOT, rel));
    const rows = readRows(ROOT, rel);
    dates.push(...rows.map((r) => r.date));
    assert.ok(line.includes(`${ORIGIN}/${rel.replace(/^docs\//, '')}`), `the line names no URL for ${rel}`);
    assert.ok(line.includes(`${rows.length} rows`), `the line does not count ${rel}`);
    assert.ok(line.includes(`sha256 ${sha256(bytes).slice(0, 12)}`), `the line names other bytes than ${rel}`);
  }
  assert.ok(line.includes(`as of ${dates.sort().at(-1)}`), 'the as-of date is not the newest row');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const ds = ld.find((x) => x['@type'] === 'Dataset');
  assert.ok(ds && ds.license === 'https://creativecommons.org/licenses/by/4.0/', 'no Dataset with the licence');
  assert.deepEqual(ds.distribution.map((d) => d.contentUrl).sort(), Object.values(FILES).filter((f) => /\.(jsonl|csv)$/.test(f)).map((f) => `${ORIGIN}/${f.replace(/^docs\//, '')}`).sort());
});

test('AC-782-10 plant: a row removed after the line was written no longer matches it', () => {
  const html = fs.readFileSync(path.join(ROOT, FILES.datasheet), 'utf8');
  const line = text(/<p class="cite-as" id="cite-as">([\s\S]*?)<\/p>/.exec(html)[1]);
  const kept = fs.readFileSync(path.join(ROOT, FILES.measured), 'utf8').split('\n').filter(Boolean).slice(1);
  const bytes = Buffer.from(`${kept.join('\n')}\n`);
  assert.ok(!line.includes(`${kept.length} rows`) || !line.includes(`sha256 ${sha256(bytes).slice(0, 12)}`));
});

// ── AC-11: each report names its own receipts' skills, on every surface ──────────────────────────
const reportPage = (n) => fs.readFileSync(path.join(ROOT, 'docs', 'reports', n, 'index.html'), 'utf8');
test('AC-782-11: the reports index and each report page name exactly the skills and packs its receipts measured', () => {
  const want = reportGroups(ROOT, committed().measured);
  assert.ok(want.size >= 16, `only ${want.size} reports with receipts`);
  assert.deepEqual(skillsProblems(skillsLines(fs.readFileSync(path.join(ROOT, 'docs', 'reports', 'index.html'), 'utf8')), want, 'reports index'), []);
  for (const n of want.keys()) assert.deepEqual(skillsProblems(new Map([...skillsLines(reportPage(n))].filter(([k]) => k === n)), new Map([[n, want.get(n)]]), `docs/reports/${n}/`), []);
});

test('AC-782-11 plants: a skill the report did not measure, a skill left out', () => {
  const want = reportGroups(ROOT, committed().measured);
  const lines = skillsLines(fs.readFileSync(path.join(ROOT, 'docs', 'reports', 'index.html'), 'utf8'));
  const plus = new Map(want.get('009')); plus.set('someone/else', ['not-measured']);
  const added = new Map(lines); added.set('009', sentence(plus));
  assert.ok(skillsProblems(added, want, 'plant').some((p) => p.includes('Report 009 names')));
  const minus = new Map(want.get('018'));
  const [pack, names] = [...minus].find(([, ns]) => ns.length > 1);
  minus.set(pack, names.slice(0, -1));
  const dropped = new Map(lines); dropped.set('018', sentence(minus));
  assert.ok(skillsProblems(dropped, want, 'plant').some((p) => p.includes('Report 018 names')), `the drop from ${pack} was not caught`);
  assert.deepEqual(skillsProblems(new Map([['009', sentence(want.get('009'))]]), new Map([['009', want.get('009')]]), 'serializer'), []);
});

test('AC-782-11: JSON-LD about, llms.txt, llms-full.txt and the feed carry each report\'s line', () => {
  const want = reportGroups(ROOT, committed().measured);
  const llms = fs.readFileSync(path.join(ROOT, 'docs', 'llms.txt'), 'utf8').split('\n');
  const full = fs.readFileSync(path.join(ROOT, 'docs', 'llms-full.txt'), 'utf8').split('\n');
  const feed = fs.readFileSync(path.join(ROOT, 'docs', 'feed.xml'), 'utf8');
  for (const [n, groups] of want) {
    const line = skillsLines(reportPage(n)).get(n);
    const ld = [...reportPage(n).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((x) => x['@type'] === 'TechArticle');
    const about = new Map();
    for (const a of (ld && ld.about) || []) {
      assert.equal(a['@type'], 'SoftwareSourceCode');
      const pack = a.codeRepository ? a.codeRepository.replace(/^https:\/\/github\.com\//, '') : null;
      if (!about.has(pack)) about.set(pack, []);
      about.get(pack).push(a.name);
    }
    assert.equal(groupsKey(about), groupsKey(groups), `Report ${n}: JSON-LD about`);
    // Each file's entry for the report: the list line that opens with its link and its title. A bare
    // "[Report NNN](...)" link inside a copied page is that page's text, not the entry.
    for (const [where, lines] of [['llms.txt', llms], ['llms-full.txt', full]]) {
      const entries = lines.filter((x) => x.startsWith(`- [Report ${n}: `) && x.includes(`(${ORIGIN}/reports/${n}/)`));
      assert.ok(entries.length > 0 && entries.every((l) => l.includes(line)), `${where}: Report ${n}'s entry does not carry its skills line`);
    }
    const entry = [...feed.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((m) => m[0]).find((e) => e.includes(`<id>${ORIGIN}/reports/${n}/</id>`));
    assert.ok(entry && decodeOnce(entry).includes(line), `feed.xml: Report ${n}'s entry does not carry its skills line`);
  }
});

// TBD-1, option (a) (Maverick, 11 Nov 2026): the description names the packs and skills, whole names,
// "and N more", then the models. "Report NNN: " leads it only where another report's would be the same.
function descriptionProblems(desc, groups, n = null) {
  if (desc.length > 155) return [`${desc.length} characters`];
  const at = desc.lastIndexOf(', on ');
  if (at < 0 || !desc.endsWith('.')) return [`no models: ${desc}`];
  let head = desc.slice(0, at);
  const lead = /^Report (\d+): /.exec(head);
  if (lead) {
    if (n !== null && lead[1] !== n) return [`leads with Report ${lead[1]}`];
    head = head.slice(lead[0].length);
  }
  const more = / and (\d+) more$/.exec(head);
  if (more) head = head.slice(0, more.index);
  const named = [];
  for (const g of head.split('; ')) {
    const i = g.indexOf(': ');
    const pack = g.slice(0, i) === NOT_RECORDED ? null : g.slice(0, i);
    for (const s of splitNames(g.slice(i + 2))) {
      if (!(groups.get(pack) || []).includes(s)) return [`names ${pack}: ${s}, which the report did not measure`];
      named.push(s);
    }
  }
  const total = [...groups.values()].reduce((a, ns) => a + ns.length, 0);
  if (named.length + (more ? Number(more[1]) : 0) !== total) return [`names ${named.length}${more ? ` and ${more[1]} more` : ''} of ${total}`];
  return [];
}
// Each report's description and og:description, read by the reader above; and every model its row names,
// each by its human name, so a report titled past 60 still names all of them (C-117).
test('AC-782-11 (TBD-1 (a)): each report\'s description names its skills, whole, with an exact count of the rest, and every model', () => {
  const want = reportGroups(ROOT, committed().measured);
  const { humanModelName } = require('../scripts/model-names.js');
  const rows = readJson(ROOT, 'docs/data/reports.json').reports;
  const seen = new Map();
  for (const [n, groups] of want) {
    const page = reportPage(n);
    const m = /<meta name="description" content="([^"]*)">/.exec(page);
    const og = /<meta property="og:description" content="([^"]*)">/.exec(page);
    assert.ok(m && og && og[1] === m[1], `Report ${n}: no description, or og:description differs`);
    const desc = decodeOnce(m[1]);
    assert.deepEqual(descriptionProblems(desc, groups, n), [], `Report ${n}`);
    for (const id of rows.find((r) => r.number.value === n).model_ids) assert.ok(desc.includes(`${humanModelName(id.value)}`), `Report ${n} does not name ${id.value}`);
    assert.ok(!seen.has(desc), `Reports ${seen.get(desc)} and ${n} share a description`);
    seen.set(desc, n);
  }
  const g = want.get('018');
  const [pack, names] = [...g].find(([, ns]) => ns.length > 0);
  assert.ok(descriptionProblems(`${pack === null ? NOT_RECORDED : pack}: ${names[0]} and 3 more, on Claude Haiku 5.5.`, g).length > 0, 'a plant with a wrong count reads clean');
  assert.ok(descriptionProblems(`${pack === null ? NOT_RECORDED : pack}: not-measured, on Claude Haiku 5.5.`, g).length > 0, 'a plant naming an unmeasured skill reads clean');
  assert.ok(descriptionProblems(`Report 017: ${pack === null ? NOT_RECORDED : pack}: ${names[0]} and ${[...g.values()].flat().length - 1} more, on Claude Haiku 5.5.`, g, '018').length > 0, 'a plant leading with another report reads clean');
});

test('AC-782-15: the reports index and every report page link the files and the datasheet', () => {
  const links = ['/data/driftproof-results.jsonl', '/data/driftproof-results.csv', '/data/'];
  const has = (html) => links.every((l) => html.includes(`href="${l}"`));
  assert.ok(has(fs.readFileSync(path.join(ROOT, 'docs', 'reports', 'index.html'), 'utf8')), 'the reports index');
  const dirs = fs.readdirSync(path.join(ROOT, 'docs', 'reports')).filter((d) => /^\d+$/.test(d));
  for (const n of dirs) assert.ok(has(reportPage(n)), `Report ${n}`);
  assert.ok(!has(reportPage(dirs[0]).split('href="/data/driftproof-results.jsonl"').join('')), 'a plant with the link removed reads clean');
});

// AC-18: CITATION.cff carries the files as one data reference, read by spec 127's CFF reader, against the
// datasheet the reference names: its title, its licence and the measured file it links.
function citationProblems(cffText) {
  const html = fs.readFileSync(path.join(ROOT, FILES.datasheet), 'utf8');
  const h1 = text((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1] || '');
  const refs = cffText.doc.references;
  if (!Array.isArray(refs) || refs.length !== 1) return [`references is ${JSON.stringify(refs)}, not one entry`];
  const r = refs[0];
  const want = { type: 'data', title: h1, authors: [{ name: 'driftproofhq' }], url: `${ORIGIN}/data/`, 'repository-artifact': `${ORIGIN}/data/driftproof-results.jsonl`, license: 'CC-BY-4.0' };
  const problems = Object.entries(want).filter(([k, v]) => !same(r[k], v)).map(([k, v]) => `references[0].${k} is ${JSON.stringify(r[k])}, not ${JSON.stringify(v)}`);
  for (const k of Object.keys(r)) if (!(k in want)) problems.push(`references[0].${k} is a key the datasheet does not give`);
  if (!/CC BY 4\.0/.test(text(html))) problems.push('the datasheet does not state CC BY 4.0');
  return problems;
}
test('AC-782-18: CITATION.cff cites the results files as one data reference, under the datasheet\'s licence', async () => {
  const { readCff } = await import('../specs/127-paper-page-and-citation/probes/cff.mjs');
  const raw = fs.readFileSync(path.join(ROOT, 'CITATION.cff'), 'utf8');
  assert.deepEqual(citationProblems(readCff(raw)), []);
  assert.ok(citationProblems(readCff(raw.replace('license: CC-BY-4.0', 'license: CC0-1.0'))).length > 0, 'a plant with another licence reads clean');
  assert.ok(citationProblems(readCff(raw.replace('driftproof-results.jsonl"', 'other.jsonl"'))).length > 0, 'a plant with another file reads clean');
});

// ── the generator, run on fixture trees ──────────────────────────────────────────────────────────
const FIX = 'receipts/report-009/code-review-and-quality-claude-opus-5-2026-09-15.json';
// One real sealed receipt, its page and a report row, in a fresh tree under another report number.
function fixtureTree(t, { report = '019', receipt } = {}) {
  const dir = scratch(t);
  const r = receipt || readJson(ROOT, FIX);
  const rel = `receipts/report-${report}/${path.basename(FIX)}`;
  const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
  write(rel, receipt ? `${JSON.stringify(r, null, 2)}\n` : fs.readFileSync(path.join(ROOT, FIX)));
  const pageRel = `docs/r/${r.receipt_hash}/index.html`;
  const realPage = path.join(ROOT, 'docs', 'r', readJson(ROOT, FIX).receipt_hash, 'index.html');
  write(pageRel, fs.readFileSync(realPage));
  const row = clone(readJson(ROOT, 'docs/data/reports.json').reports.find((x) => x.number.value === '009'));
  row.number.value = report;
  row.receipt_paths = [{ value: rel, from: `docs/reports/${report}/index.html` }];
  write('docs/data/reports.json', `${JSON.stringify({ reports: [row] }, null, 2)}\n`);
  const src = readJson(ROOT, 'index-receipts/sources.json');
  write('index-receipts/sources.json', `${JSON.stringify({ ...src, receipts: [] }, null, 2)}\n`);
  return { dir, rel, hash: r.receipt_hash, write };
}
const run = (args, opts = {}) => spawnSync(process.execPath, [...(opts.pre || []), SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, TMPDIR: process.env.TMPDIR || os.tmpdir() }, timeout: 300000 });
const lib = () => require(SCRIPT);
const listTree = (dir) => { const out = []; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else out.push(path.relative(dir, p)); } })(dir); return out.sort(); };

test('AC-782-3: a receipt changed after sealing, or invalid against its schema, refuses every call path and writes nothing', (t) => {
  const { computeReceiptHash } = require('../lib/receipt.js');
  const tampered = readJson(ROOT, FIX); tampered.comparison.delta += 0.001;
  const invalid = readJson(ROOT, FIX); invalid.verification_level = 'NOT_A_LEVEL'; invalid.receipt_hash = computeReceiptHash(invalid);
  for (const [what, receipt] of [['tampered', tampered], ['invalid', invalid]]) {
    const fx = fixtureTree(t, { receipt });
    const before = listTree(fx.dir);
    assert.throws(() => lib().buildResults({ root: fx.dir }), (e) => e.code === 'RESULTS_REFUSED', `${what}: buildResults`);
    for (const args of [['--root', fx.dir], ['--root', fx.dir, '--check'], ['--root', fx.dir, '--hf-export', scratch(t)]]) {
      const res = run(args);
      assert.notEqual(res.status, 0, `${what}: ${args.join(' ')} exits 0`);
    }
    assert.deepEqual(listTree(fx.dir), before, `${what}: a refused build wrote a file`);
  }
});

test('AC-782-7: two identity records that disagree on a pack refuse the build', (t) => {
  const fx = fixtureTree(t);
  const r = readJson(fx.dir, fx.rel);
  fx.write('suites/manifest.json', JSON.stringify({ skills: [{ repo: 'https://github.com/one/pack', suite_hash: r.suite.suite_hash }] }));
  fx.write('specs/408-skill-measurements/plan.json', JSON.stringify({ execution: { attempts: [{ protocol: { repository: 'other/pack', suite_hash: r.suite.suite_hash } }] } }));
  assert.throws(() => lib().buildResults({ root: fx.dir }), (e) => e.code === 'RESULTS_REFUSED' && /pack/.test(e.message));
  fx.write('specs/408-skill-measurements/plan.json', JSON.stringify({ execution: { attempts: [] } }));
  assert.equal(lib().buildResults({ root: fx.dir }).measured[0].pack, 'one/pack');
});

test('AC-782-12: --check passes a fresh build and names a hand-edited file', (t) => {
  const fx = fixtureTree(t);
  assert.equal(run(['--root', fx.dir]).status, 0);
  assert.equal(run(['--root', fx.dir, '--check']).status, 0);
  const f = path.join(fx.dir, FILES.measured);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/"mean":0\./, '"mean":1.'));
  const res = run(['--root', fx.dir, '--check']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /driftproof-results\.jsonl/);
});

test('AC-782-12: the committed files are what a fresh build writes', () => {
  const res = run(['--check']);
  assert.equal(res.status, 0, res.stderr);
});

test('AC-782-13: the build and the export run with the network refused', (t) => {
  const dir = scratch(t);
  const block = path.join(dir, 'block.cjs');
  fs.writeFileSync(block, [
    "'use strict';",
    "const deny = (what) => function blocked() { throw new Error('NETWORK_BLOCKED ' + what); };",
    "for (const [m, ks] of [['net', ['connect', 'createConnection']], ['tls', ['connect']], ['http', ['request', 'get']], ['https', ['request', 'get']], ['http2', ['connect']], ['dns', ['lookup', 'resolve', 'resolve4', 'resolve6']]]) { const mod = require(m); for (const k of ks) mod[k] = deny(m + '.' + k); }",
    "require('net').Socket.prototype.connect = deny('net.Socket.connect');",
    "globalThis.fetch = deny('fetch');",
  ].join('\n'));
  const plant = spawnSync(process.execPath, ['-r', block, '-e', "fetch('https://example.com')"], { encoding: 'utf8' });
  assert.notEqual(plant.status, 0);
  assert.match(plant.stderr, /NETWORK_BLOCKED fetch/);
  const fx = fixtureTree(t);
  const res = run(['--root', fx.dir], { pre: ['-r', block] });
  assert.equal(res.status, 0, res.stderr);
  const out = scratch(t);
  const hf = run(['--hf-export', out], { pre: ['-r', block] });
  assert.equal(hf.status, 0, hf.stderr);
});

test('AC-782-14: a report published later enters the rows and the names from its receipts alone', (t) => {
  const fx = fixtureTree(t, { report: '019' });
  const built = lib().buildResults({ root: fx.dir });
  assert.ok(built.measured.length > 0 && built.measured.every((r) => same(r.reports, ['019'])));
  const groups = lib().reportSkillGroups({ root: fx.dir, report: '019' });
  assert.deepEqual(groups.flatMap((g) => g.skills), [readJson(fx.dir, fx.rel).skill.name]);
  assert.match(lib().skillsSentence(groups), /^Skills measured: .*code-review-and-quality\.$/);
  assert.notEqual(lib().skillsSentence([]), lib().skillsSentence(groups), 'a plant with the report left out reads the same');
});

// ── AC-16: the Hugging Face export ───────────────────────────────────────────────────────────────
function hfProblems(out, root = ROOT) {
  const problems = [];
  const mctx = measuredContext(root);
  const ictx = importedContext(root);
  const measured = readRows(out, 'measured.jsonl');
  const imported = readRows(out, 'imported.jsonl');
  const pageOf = (url) => path.join(root, 'docs', url.replace(`${ORIGIN}/`, ''), 'index.html');
  if (new Set(measured.map((r) => r.receipt_hash)).size !== measured.length) problems.push('a measured receipt twice');
  if (measured.length !== mctx.published.size) problems.push(`${measured.length} measured rows, ${mctx.published.size} published receipts`);
  if (imported.length !== ictx.entries.size) problems.push(`${imported.length} imported rows, ${ictx.entries.size} in sources.json`);
  for (const r of measured) {
    if (!mctx.published.has(r.receipt_hash)) problems.push(`not published: ${r.receipt_hash}`);
    const bytes = fs.existsSync(path.join(root, String(r.receipt_file))) ? fs.readFileSync(path.join(root, r.receipt_file)) : null;
    if (!bytes || sha256(Buffer.from(r.receipt_json, 'utf8')) !== sha256(bytes)) problems.push(`receipt_json is not ${r.receipt_file} byte for byte`);
    if (JSON.parse(r.receipt_json).source_figures !== undefined) problems.push(`a measured row carries source_figures: ${r.receipt_hash}`);
    if (!fs.existsSync(pageOf(r.permalink))) problems.push(`the permalink ${r.permalink} has no page`);
  }
  for (const r of imported) {
    const e = ictx.entries.get(r.receipt_hash);
    if (!e) { problems.push(`not imported: ${r.receipt_hash}`); continue; }
    if (sha256(Buffer.from(r.receipt_json, 'utf8')) !== e.sha256) problems.push(`receipt_json is not ${e.file} as sources.json records it`);
    if (JSON.parse(r.receipt_json).verification_level === 'TESTED') problems.push(`an imported row is TESTED: ${r.receipt_hash}`);
    if (!fs.existsSync(pageOf(r.permalink))) problems.push(`the permalink ${r.permalink} has no page`);
  }
  const card = fs.readFileSync(path.join(out, 'README.md'), 'utf8');
  if (!/^---\n[\s\S]*?\blicense: cc-by-4\.0\b[\s\S]*?\n---\n/.test(card)) problems.push('the dataset card states no cc-by-4.0 licence');
  return problems;
}
test('AC-782-16: the export writes one row per receipt, each receipt_json byte for byte, and a card', (t) => {
  const out = scratch(t);
  const res = run(['--hf-export', out]);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(hfProblems(out).slice(0, 20), []);
  const rows = readRows(out, 'measured.jsonl');
  const edit = (file, f) => { const copy = scratch(t); for (const n of fs.readdirSync(out)) fs.copyFileSync(path.join(out, n), path.join(copy, n)); const rs = readRows(copy, file); f(rs); fs.writeFileSync(path.join(copy, file), rs.map((x) => JSON.stringify(x)).join('\n') + '\n'); return copy; };
  assert.ok(hfProblems(edit('measured.jsonl', (rs) => { rs[0].receipt_json = rs[0].receipt_json.replace(/\n$/, '') + ' \n'; })).some((p) => p.includes('byte for byte')));
  assert.ok(hfProblems(edit('measured.jsonl', (rs) => { rs[0].permalink = `${ORIGIN}/r/${'0'.repeat(64)}/`; })).some((p) => p.includes('has no page')));
  assert.ok(hfProblems(edit('imported.jsonl', (rs) => { rs.pop(); })).some((p) => p.includes('imported rows')));
  assert.ok(rows.length > 0);
});

test('AC-782-16: the export refuses a directory inside the tree it reads', (t) => {
  const fx = fixtureTree(t);
  const inside = path.join(fx.dir, 'hf-out');
  const res = run(['--root', fx.dir, '--hf-export', inside]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /inside the tree/, 'the refusal does not say why');
  assert.ok(!fs.existsSync(inside), 'the refused export wrote its directory');
});
