// SPDX-License-Identifier: Apache-2.0
'use strict';

// Receipt interop: NVIDIA/skills benchmark cards (spec 265, spec 117).
//
//   driftproof import <dir> --from nvidia-cards --commit <sha> [--only <skill>[,<skill>]]
//
// What is read, and why it is trusted: a git checkout of NVIDIA/skills, at the commit given by
// --commit, which must be the checkout's HEAD. Two kinds of file are read, benchmarks.json and
// skills/<catalog_dir>/BENCHMARK.md, each once, and each file's git blob sha1, computed from the
// bytes read, must be the blob the commit holds at that path. The receipt records the repository,
// the commit and each file's path and blob sha1, so a reader can check every figure against that
// commit; Driftproof records the files it read and does not attest who wrote them.
//
// The source gives aggregates only: one score and one uplift per dimension and agent, no per-run
// score. So each receipt carries the card's figures as printed in source_figures, beside the mark
// uncertainty_unavailable "aggregates_only", and its case rows carry no figure: no band, spread or
// verdict can be read from it. Every card cell, metadata line, agent entry, table header and token
// cell is read by a closed set of shapes; anything else refuses the import. Every notice is one of
// the fixed texts below, its slots filled from the card or the checkout (spec 265 AC-15).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { RECEIPT_SCHEMA_VERSION, RUNNER_VERSION } = require('../config');
const { sealReceipt, comparisonOf, receiptBaseName } = require('./receipt');
const { registryStatus } = require('./models');
const { IMPORT_METHOD, checkImportInput, importDiagnostic } = require('./importers');

const NVIDIA_TOOLS = ['nvidia-cards'];
const REPO = 'NVIDIA/skills';
const AGENTS = ['claude-code', 'codex'];
const AGENT_OF = { 'Claude Code': 'claude-code', Codex: 'codex' };
const MAX_CARD_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_CELL = 200;

// Characters the cards print, written as escapes (spec 265 AC-22).
const EM = '\u2014';
const ARROW = '\u2192';
const PM = '\u00b1';

// Source text that may be copied (AC-19).
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MODEL_ID = /^[A-Za-z0-9._:@+/-]{1,128}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const HOME_IN_TEXT = /~\/|\/home\/|\/Users\/|\/root\/|file:\/\//;

// The card's metadata lines, each a closed shape (AC-4). The label is what a line starts with.
const META = {
  'Skill': /^- Skill: `([A-Za-z0-9][A-Za-z0-9._-]{0,127})`$/,
  'Evaluation date': /^- Evaluation date: (\d{4}-\d{2}-\d{2})$/,
  'Evaluator version': /^- Evaluator version: `([^`]{1,200})`$/,
  'Environment': /^- Environment: `([^`]{1,200})`$/,
  'Dataset digest': /^- Dataset digest: `([^`]{1,200})`(?: \([^()]{1,200}\))?$/,
  'Tasks': /^- Tasks: (\d{1,9}) evaluation tasks(?: \([^()]{1,200}\))?$/,
  'Dataset': /^- Dataset: (\d{1,9}) evaluation tasks$/,
  'Attempts per task': /^- Attempts per task: (\d{1,9})$/,
  'Agents': /^- Agents: (.+)$/,
};
const META_LABEL = new RegExp(`^- (${Object.keys(META).join('|')}):`);

// A card cell, by the closed set of shapes (AC-3). NUM is a number as the card writes it.
const NUM = '(\\d{1,9}(?:\\.\\d{1,9})?)';
const CELL = {
  points: new RegExp(`^${NUM}% ${ARROW} ${NUM}% \\(([+\\-${PM}])${NUM} points\\)$`),
  unavailable: new RegExp(`^${NUM}% ${EM} baseline ran, but no comparable score was available; uplift unavailable$`),
  bare: new RegExp(`^${NUM}% \\(([+-])${NUM}%\\)$`),
};
const NO_FIGURE = ['Not available', 'N/A'];

// The token table (AC-12).
const TOKEN_HEADER = ['Agent', 'Dataset case', 'With skill', 'Without skill', 'Delta', 'Change', 'Coverage'];
const TOKEN_AGENTS = [...AGENTS, 'ALL AGENTS'];
const TOKEN_CELL = {
  with_skill: { label: 'With skill', re: /^\d{1,3}(?:,\d{3})*$/ },
  without_skill: { label: 'Without skill', re: /^\d{1,3}(?:,\d{3})*$/ },
  delta: { label: 'Delta', re: /^(?:[+-]\d{1,3}(?:,\d{3})*|N\/A)$/ },
  change: { label: 'Change', re: /^(?:[+-]\d{1,9}\.\d{1,9}%|N\/A)$/ },
  coverage: { label: 'Coverage', re: /^skill \d{1,9}\/\d{1,9}; base \d{1,9}\/\d{1,9}$/ },
};

const REASON = 'aggregates only: the source carries no per-run scores for this case, so no band can be formed';
const UNKNOWN_FIELDS = 'skill.version, skill.content_hash, suite.suite_hash, run.harness.version, run.judge.model_id';

// The fixed texts (spec 265 AC-15).
const TEXT = {
  figures: (sha) => `figures are carried as printed in the card with sha256 ${sha}, in source_figures; Driftproof records the files it read and does not attest the author; aggregates only: the card gives one score per dimension and agent and no per-run scores, so no band can be formed and no verdict is read from this receipt`,
  source: (commit) => `the source is recorded as ${REPO} at commit ${commit}: the path and git blob sha1 of the card and of benchmarks.json are hashed into this receipt in source_figures.source, so each file can be checked against that commit`,
  model: (agent) => `run.model_id is the model the card names for ${agent}`,
  noModel: (agent) => `the card names no model for ${agent}: run.model_id is unknown`,
  date: 'the card gives the evaluation date to the day: run.date_utc is the start of that day, source_figures.evaluation_date is the date as printed, and readers show the day alone',
  unit: 'the card prints uplift as a bare percent with no unit: each such row carries uplift_unit unstated, and no baseline is worked out',
  tokens: (agent) => `economics are the token totals of the card's All cases row for ${agent}, as the source reports them; no cost, mean or call count is worked out from them`,
  noTokens: 'the card has no token table: economics are unknown',
  noTokenRow: (agent) => `the card's token table has no All cases row for ${agent}: economics are unknown`,
  verdict: 'the card\'s own verdict, tier status, findings and recommendation are not carried',
  unknown: `the card does not state ${UNKNOWN_FIELDS}: each is unknown or null`,
};

class NvidiaRefused extends Error {
  constructor(message) { super(importDiagnostic(message)); }
}
const refuse = (msg) => { throw new NvidiaRefused(msg); };
// A source value in a refusal: JSON-quoted, cut to 80 characters (AC-3).
const shown = (v) => (v === null || v === undefined ? 'none' : JSON.stringify(String(v).slice(0, 80)));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const blobSha1 = (b) => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (s) => { const n = Number(s); return Object.is(n, -0) ? 0 : n; };
const cellsOf = (l) => l.split('|').slice(1, -1).map((x) => x.trim());
const same = (a, b) => Object.is(a === -0 ? 0 : a, b === -0 ? 0 : b);

// ── the checkout (AC-24) ────────────────────────────────────────────────────
// git, with no GIT_ variable of the caller's environment, and only to read: rev-parse and ls-tree.
function gitRead(dir, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync('git', ['-C', dir, '-c', 'core.fsmonitor=false', '--no-optional-locks', ...args], { env, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.error) refuse('git cannot be run: the checkout\'s commit is read with git rev-parse and git ls-tree');
  return r;
}
// The commit's blobs under benchmarks.json and skills/: path -> { mode, type, sha }.
function commitTree(dir, commit) {
  const r = gitRead(dir, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', 'benchmarks.json', 'skills']);
  if (r.status !== 0) refuse(`git ls-tree cannot read commit ${commit}`);
  const tree = new Map();
  for (const ent of r.stdout.toString('utf8').split('\0')) {
    if (!ent) continue;
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40})\t([\s\S]*)$/.exec(ent);
    if (!m) refuse('git ls-tree printed a line of no shape');
    tree.set(m[4], { mode: m[1], type: m[2], sha: m[3] });
  }
  return tree;
}
function checkout(dir, commit) {
  if (commit === undefined || commit === null || commit === true) refuse('--commit <sha> is required: the commit of the checkout read, which is its HEAD');
  if (typeof commit !== 'string' || !HEX40.test(commit)) refuse(`--commit ${shown(commit)} is not a full commit id (40 lowercase hex characters)`);
  if (typeof dir !== 'string' || !dir) refuse('give the NVIDIA/skills checkout to read');
  let st;
  try { st = fs.lstatSync(dir); } catch (_e) { refuse('the path given names no file or directory'); }
  if (st.isSymbolicLink()) refuse('the path given is a symbolic link; links are not followed');
  if (!st.isDirectory()) refuse('the path given is not a directory');
  const top = gitRead(dir, ['rev-parse', '--show-toplevel']);
  let real; let topReal;
  try { real = fs.realpathSync(dir); topReal = top.status === 0 ? fs.realpathSync(top.stdout.toString('utf8').trim()) : null; } catch (_e) { topReal = null; }
  if (top.status !== 0 || real !== topReal) refuse('the path given is not the top of a git work tree: give the checkout of NVIDIA/skills itself');
  const head = gitRead(dir, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const headSha = head.status === 0 ? head.stdout.toString('utf8').trim() : null;
  if (headSha !== commit) refuse(`--commit ${commit} is not the checkout's HEAD (${headSha === null ? 'none' : headSha})`);
  return commitTree(dir, commit);
}

// One file of the checkout, read once (AC-11, AC-19): every folder on the way read with lstat, the
// file opened without following a link, its bytes bounded, and its blob sha1 the commit's (AC-24).
function readSource(dir, rel, limit, limitText, tree, commit, { optional = false } = {}) {
  const parts = rel.split('/');
  let at = dir;
  for (let i = 0; i < parts.length; i++) {
    at = path.join(at, parts[i]);
    const shownAt = parts.slice(0, i + 1).join('/');
    let st;
    try { st = fs.lstatSync(at); } catch (_e) { if (optional) return null; refuse(`${shownAt}: no such ${i === parts.length - 1 ? 'file' : 'folder'} in the checkout`); }
    if (st.isSymbolicLink()) refuse(`${shownAt} is a symbolic link; links are not followed`);
    if (i < parts.length - 1 ? !st.isDirectory() : !st.isFile()) refuse(`${shownAt} is not a regular ${i < parts.length - 1 ? 'folder' : 'file'}`);
  }
  let fd;
  try { fd = fs.openSync(at, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (e) { refuse(e && e.code === 'ELOOP' ? `${rel} is a symbolic link; links are not followed` : `${rel} cannot be opened`); }
  let bytes;
  try {
    if (!fs.fstatSync(fd).isFile()) refuse(`${rel} is not a regular file`);
    const chunks = [];
    let n = 0;
    while (n <= limit) {
      const buf = Buffer.allocUnsafe(Math.min(1 << 20, limit + 1 - n));
      const got = fs.readSync(fd, buf, 0, buf.length, null);
      if (!got) break;
      chunks.push(buf.subarray(0, got));
      n += got;
    }
    if (n > limit) refuse(`${rel} is larger than ${limitText} (limit)`);
    bytes = Buffer.concat(chunks, n);
  } finally { fs.closeSync(fd); }
  const t = tree.get(rel);
  if (!t || t.type !== 'blob' || !/^100(?:644|755)$/.test(t.mode)) refuse(`${rel} is not a regular file in commit ${commit}: a file the commit does not hold is not read`);
  if (t.sha !== blobSha1(bytes)) refuse(`${rel} is not the file commit ${commit} holds (its git blob sha1 differs): the checkout was changed after its commit`);
  return bytes;
}

// ── benchmarks.json (AC-2, AC-25) ───────────────────────────────────────────
function readIndex(bytes) {
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch (_e) { refuse('benchmarks.json is not JSON'); }
  try { checkImportInput(doc); } catch (e) { refuse(`benchmarks.json: ${e.message}`); }
  if (!isObject(doc)) refuse('benchmarks.json is not an object');
  if (doc.schema_version !== 2) refuse(`benchmarks.json schema_version ${shown(doc.schema_version)} is not 2`);
  for (const k of ['skills', 'results', 'skills_without_results']) if (!Array.isArray(doc[k])) refuse(`benchmarks.json carries no ${k} list`);
  if (doc.skill_count !== doc.skills.length) refuse(`benchmarks.json skill_count ${shown(doc.skill_count)} does not equal its ${doc.skills.length} skills`);
  if (doc.result_row_count !== doc.results.length) refuse(`benchmarks.json result_row_count ${shown(doc.result_row_count)} does not equal its ${doc.results.length} results`);
  const skills = new Map();
  for (const s of doc.skills) {
    if (!isObject(s) || typeof s.catalog_dir !== 'string' || !PLAIN.test(s.catalog_dir)) refuse(`benchmarks.json: a skills row's catalog_dir ${shown(isObject(s) ? s.catalog_dir : s)} is not a plain name`);
    if (skills.has(s.catalog_dir)) refuse(`benchmarks.json: ${s.catalog_dir} has two skills rows`);
    for (const a of Array.isArray(s.agents) ? s.agents : []) if (!AGENTS.includes(a)) refuse(`benchmarks.json: ${s.catalog_dir}'s agents name ${shown(a)}, which is neither claude-code nor codex`);
    skills.set(s.catalog_dir, s);
  }
  const results = new Map();
  for (const r of doc.results) {
    if (!isObject(r) || typeof r.catalog_dir !== 'string' || !skills.has(r.catalog_dir)) refuse(`benchmarks.json: a results row names ${shown(isObject(r) ? r.catalog_dir : r)}, which has no skills row`);
    if (!AGENTS.includes(r.agent)) refuse(`benchmarks.json: a results row of ${r.catalog_dir} names the agent ${shown(r.agent)}, which is neither claude-code nor codex`);
    if (typeof r.dimension !== 'string' || !r.dimension || r.dimension.length > MAX_CELL) refuse(`benchmarks.json: a results row of ${r.catalog_dir} has no dimension`);
    if (typeof r.score_pct !== 'number' || !Number.isFinite(r.score_pct)) refuse(`benchmarks.json: ${r.catalog_dir} ${r.agent} ${r.dimension}: score_pct ${shown(r.score_pct)} is not a number`);
    if (r.uplift_pct !== null && (typeof r.uplift_pct !== 'number' || !Number.isFinite(r.uplift_pct))) refuse(`benchmarks.json: ${r.catalog_dir} ${r.agent} ${r.dimension}: uplift_pct ${shown(r.uplift_pct)} is neither a number nor null`);
    if (r.num !== null && r.num !== undefined && !Number.isInteger(r.num)) refuse(`benchmarks.json: ${r.catalog_dir} ${r.agent} ${r.dimension}: num ${shown(r.num)} is neither a count nor null`);
    if (!results.has(r.catalog_dir)) results.set(r.catalog_dir, []);
    results.get(r.catalog_dir).push(r);
  }
  const without = new Set();
  for (const cd of doc.skills_without_results) {
    if (typeof cd !== 'string' || !skills.has(cd)) refuse(`benchmarks.json: skills_without_results names ${shown(cd)}, which has no skills row`);
    without.add(cd);
  }
  for (const [cd, s] of skills) {
    const has = results.has(cd);
    if (s.has_results !== has || without.has(cd) === has) refuse(`benchmarks.json: ${cd}'s has_results, its place in skills_without_results and its results rows disagree`);
  }
  return { skills, results };
}

// ── one card (AC-3, AC-4, AC-9, AC-12, AC-25 to AC-27) ──────────────────────
function section(L, heading) {
  const i = L.indexOf(heading);
  if (i < 0) return null;
  if (L.indexOf(heading, i + 1) >= 0) return { twice: true, lines: [] };
  const lines = [];
  for (let j = i + 1; j < L.length && !L[j].startsWith('## '); j++) lines.push(L[j]);
  return { twice: false, lines };
}
function modelOf(cd, id) {
  if (id.length > 128 || !MODEL_ID.test(id) || id.includes('//') || id.startsWith('/') || id.split('/').some((s) => s === '.' || s === '..')) refuse(`${cd}: the model id ${shown(id)} is not a plain model id`);
  return id;
}
function parseCard(cd, text) {
  const L = text.split('\n');
  const newer = L.includes('## Evaluation Metadata');
  const older = L.includes('## Evaluation Summary');
  if (newer === older) refuse(`${cd}: the card is ${newer ? 'both' : 'neither'} of the two card formats (## Evaluation Metadata, ## Evaluation Summary)`);
  const metaSec = section(L, newer ? '## Evaluation Metadata' : '## Evaluation Summary');
  if (metaSec.twice) refuse(`${cd}: the card prints its metadata heading twice`);
  const meta = {};
  for (const l of metaSec.lines) {
    const lm = META_LABEL.exec(l);
    if (!lm) continue;
    const label = lm[1];
    if (label === 'Agents' && !newer) continue;
    const m = META[label].exec(l);
    if (!m) refuse(`${cd}: the card's ${label} line matches no shape: ${shown(l)}`);
    if (Object.hasOwn(meta, label)) refuse(`${cd}: the card prints its ${label} line twice`);
    meta[label] = m[1];
  }
  if (!Object.hasOwn(meta, 'Skill')) refuse(`${cd}: the card prints no Skill line`);
  if (!Object.hasOwn(meta, 'Evaluation date')) refuse(`${cd}: the card prints no evaluation date`);
  const day = meta['Evaluation date'];
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) refuse(`${cd}: the evaluation date ${shown(day)} is not a calendar day`);
  if (Object.hasOwn(meta, 'Tasks') && Object.hasOwn(meta, 'Dataset')) refuse(`${cd}: the card prints both a Tasks and a Dataset line`);
  const count = (k) => (Object.hasOwn(meta, k) ? Number(meta[k]) : null);

  // The model each agent ran: the newer card's Agents line, or the older card's list (AC-9).
  const models = {};
  const named = new Set();
  const take = (agent, id, where) => {
    if (named.has(agent)) refuse(`${cd}: ${where} names ${agent} twice`);
    named.add(agent);
    if (id !== null) models[agent] = modelOf(cd, id);
  };
  if (newer) {
    if (Object.hasOwn(meta, 'Agents')) {
      for (const part of meta.Agents.split(', ')) {
        const m = /^(Claude Code|Codex) \(`([^`]+)`\)$/.exec(part);
        if (!m) refuse(`${cd}: an agent entry on the Agents line matches no shape: ${shown(part)}`);
        take(AGENT_OF[m[1]], m[2], 'the Agents line');
      }
    }
  } else {
    const used = section(L, '## Agents Used');
    if (used && used.twice) refuse(`${cd}: the card prints ## Agents Used twice`);
    for (const l of used ? used.lines : []) {
      if (!l.trim()) continue;
      let m;
      if ((m = /^- `(claude-code|codex)`$/.exec(l))) take(m[1], null, '## Agents Used');
      else if ((m = /^- (Claude Code|Codex) \(`([^`]+)`\)$/.exec(l))) take(AGENT_OF[m[1]], m[2], '## Agents Used');
      else if (l !== '- Tier 3 agent details were not available in this report.') refuse(`${cd}: an ## Agents Used agent entry matches no shape: ${shown(l)}`);
    }
  }

  // The results table: the first table under its heading, before the next heading (AC-27).
  const resSec = section(L, newer ? '## Results at a Glance' : '## Results');
  if (resSec && resSec.twice) refuse(`${cd}: the card prints its results heading twice`);
  let table = null;
  const under = resSec ? resSec.lines : [];
  const hi = under.findIndex((l) => l.startsWith('|'));
  if (hi >= 0) {
    const H = cellsOf(under[hi]);
    const first = newer ? ['Measure'] : ['Dimension', 'Num'];
    for (let k = 0; k < first.length; k++) if (H[k] !== first[k]) refuse(`${cd}: the results table header cell ${shown(H[k])} matches no shape`);
    const agents = [];
    for (const h of H.slice(first.length)) {
      let m; let agent = null;
      if (newer && (m = new RegExp(`^(Claude Code|Codex) \\(Baseline ${ARROW} Skill Uplift\\)$`).exec(h))) agent = AGENT_OF[m[1]];
      else if (!newer && (m = /^`(claude-code|codex)`$/.exec(h))) agent = m[1];
      else if (!newer && (m = /^(Claude Code|Codex) \(`([^`]+)`\)$/.exec(h))) {
        agent = AGENT_OF[m[1]];
        const id = modelOf(cd, m[2]);
        if (models[agent] !== id) refuse(`${cd}: the results table names ${shown(id)} for ${agent}, and ## Agents Used names ${shown(models[agent] === undefined ? null : models[agent])}`);
      }
      if (!agent) refuse(`${cd}: the results table header cell ${shown(h)} matches no shape`);
      if (agents.includes(agent)) refuse(`${cd}: the results table has two ${agent} columns`);
      agents.push(agent);
    }
    if (!agents.length) refuse(`${cd}: the results table names no agent`);
    if (!/^\|(?:\s*:?-+:?\s*\|)+$/.test(under[hi + 1] || '') || cellsOf(under[hi + 1]).length !== H.length) refuse(`${cd}: the results table has no separator line under its header`);
    const rows = [];
    for (let j = hi + 2; j < under.length && under[j].startsWith('|'); j++) {
      const c = cellsOf(under[j]);
      if (c.length !== H.length) refuse(`${cd}: a results table row has ${c.length} cells, its header ${H.length}`);
      for (const x of c) if (x.length > MAX_CELL) refuse(`${cd}: a results table cell is longer than ${MAX_CELL} characters`);
      if (!c[0]) refuse(`${cd}: a results table row names no dimension`);
      let rowNum = null;
      if (!newer) {
        if (/^\d{1,9}$/.test(c[1])) rowNum = Number(c[1]);
        else if (c[1] !== 'N/A') refuse(`${cd}: the Num cell ${shown(c[1])} of ${shown(c[0])} matches no shape`);
      }
      rows.push({ dimension: c[0], num: rowNum, cells: Object.fromEntries(agents.map((a, k) => [a, c[first.length + k]])) });
    }
    if (!rows.length) refuse(`${cd}: the results table has no rows`);
    table = { agents, rows };
  }

  // The token table's All cases rows (AC-12, AC-25).
  const tokSec = section(L, '## Token Usage');
  if (tokSec && tokSec.twice) refuse(`${cd}: the card prints ## Token Usage twice`);
  const tokens = {};
  if (tokSec) {
    const tl = tokSec.lines.filter((l) => l.startsWith('|'));
    if (tl.length && JSON.stringify(cellsOf(tl[0])) !== JSON.stringify(TOKEN_HEADER)) refuse(`${cd}: the token table header matches no shape`);
    for (const l of tl.slice(2)) {
      const c = cellsOf(l);
      if (c.length !== TOKEN_HEADER.length) refuse(`${cd}: a token table row has ${c.length} cells, its header ${TOKEN_HEADER.length}`);
      if (!TOKEN_AGENTS.includes(c[0])) refuse(`${cd}: the token table names the agent ${shown(c[0])}, which is neither claude-code nor codex`);
      if (c[1] !== 'All cases' || !AGENTS.includes(c[0])) continue;
      if (Object.hasOwn(tokens, c[0])) refuse(`${cd} ${c[0]}: the token table has two All cases rows`);
      const row = { with_skill: c[2], without_skill: c[3], delta: c[4], change: c[5], coverage: c[6] };
      for (const [k, { label, re }] of Object.entries(TOKEN_CELL)) if (row[k].length > MAX_CELL || !re.test(row[k])) refuse(`${cd} ${c[0]}: the token table's All cases ${label} cell ${shown(row[k])} matches no shape`);
      tokens[c[0]] = row;
    }
  }
  return {
    newer,
    meta: {
      skill: meta.Skill,
      evaluation_date: day,
      evaluator_version: Object.hasOwn(meta, 'Evaluator version') ? meta['Evaluator version'] : null,
      environment: Object.hasOwn(meta, 'Environment') ? meta.Environment : null,
      dataset_digest: Object.hasOwn(meta, 'Dataset digest') ? meta['Dataset digest'] : null,
      tasks: Object.hasOwn(meta, 'Tasks') ? count('Tasks') : count('Dataset'),
      attempts_per_task: count('Attempts per task'),
    },
    models,
    table,
    hasTokenTable: !!tokSec,
    tokens,
  };
}

// A cell's figures (AC-3): 'none' for a cell that prints none, null for a cell of no shape.
function figuresOf(cell, newer) {
  let m;
  if (NO_FIGURE.includes(cell)) return 'none';
  if (newer && (m = CELL.points.exec(cell))) {
    if (m[3] === PM && num(m[4]) !== 0) return null;
    return { score_pct: num(m[2]), baseline_pct: num(m[1]), uplift: m[3] === PM ? 0 : num((m[3] === '-' ? '-' : '') + m[4]), uplift_unit: 'points' };
  }
  if (newer && (m = CELL.unavailable.exec(cell))) return { score_pct: num(m[1]), baseline_pct: null, uplift: null, uplift_unit: null };
  if (!newer && (m = CELL.bare.exec(cell))) return { score_pct: num(m[1]), baseline_pct: null, uplift: num((m[2] === '-' ? '-' : '') + m[3]), uplift_unit: 'unstated' };
  return null;
}
const caseId = (d) => `dimension:${d.toLowerCase()}`;
const providerOf = (id) => { const segs = id.split('/'); return segs.includes('anthropic') ? 'anthropic' : segs.includes('openai') ? 'openai' : 'unknown'; };

// The receipts of one card's pairs with results, checked against its index rows (AC-1, AC-4, AC-26).
function cardReceipts({ cd, card, row, results, cardBytes, benchBytes, cardBlob, benchBlob, commit, importedAt }) {
  const m = card.meta;
  const agree = (field, onCard, inIndex) => { if (!same(onCard, inIndex)) refuse(`${cd}: ${field} on the card is ${shown(onCard)} and in benchmarks.json ${shown(inIndex)}`); };
  agree('skill', m.skill, row.skill);
  agree('evaluation_date', m.evaluation_date, row.evaluation_date);
  for (const k of ['evaluator_version', 'environment', 'dataset_digest', 'tasks', 'attempts_per_task']) if (m[k] !== null) agree(k, m[k], row[k]);
  const byAgent = new Map(AGENTS.map((a) => [a, results.filter((r) => r.agent === a)]));
  const columns = card.table ? card.table.agents : [];
  for (const [a, rs] of byAgent) if (rs.length && !columns.includes(a)) refuse(`${cd}: the pair ${a} has results in benchmarks.json and no column in the card's results table`);
  if (!card.table) return { receipts: [], without: [] };
  // One case id per dimension on the card (AC-26).
  const ids = new Set();
  for (const r of card.table.rows) {
    const id = r.dimension === 'Overall' ? 'Overall' : caseId(r.dimension);
    if (ids.has(id)) refuse(`${cd}: two card rows give the case id ${shown(id)}`);
    ids.add(id);
  }
  const dims = card.table.rows.map((r) => r.dimension).filter((d) => d !== 'Overall');
  const out = [];
  const without = [];
  for (const agent of columns) {
    const rs = byAgent.get(agent);
    const figs = card.table.rows.map((r) => {
      const f = figuresOf(r.cells[agent], card.newer);
      if (f === null) refuse(`${cd} ${agent} ${r.dimension}: the cell ${shown(r.cells[agent])} matches no shape`);
      return f;
    });
    const none = figs.filter((f) => f === 'none').length;
    if (none === figs.length) {
      if (rs.length) refuse(`${cd} ${agent}: the column prints no figure and benchmarks.json has results rows for the pair`);
      without.push({ skill: cd, agent });
      continue;
    }
    if (none) refuse(`${cd} ${agent}: the column prints figures in some rows and Not available or N/A in others`);
    if (!rs.length) refuse(`${cd} ${agent}: the column prints figures and benchmarks.json has no results rows for the pair`);
    // The card's dimensions and the pair's results, one to one (AC-26).
    const byDim = new Map();
    for (const r of rs) { if (byDim.has(r.dimension)) refuse(`${cd} ${agent}: benchmarks.json has two results rows for ${shown(r.dimension)}`); byDim.set(r.dimension, r); }
    for (const d of dims) if (!byDim.has(d)) refuse(`${cd} ${agent}: the card's dimension ${shown(d)} has no results row`);
    for (const d of byDim.keys()) if (!dims.includes(d)) refuse(`${cd} ${agent}: benchmarks.json's dimension ${shown(d)} is not on the card`);
    const rows = card.table.rows.map((r, i) => {
      const f = figs[i];
      const x = { dimension: r.dimension, printed: r.cells[agent], score_pct: f.score_pct, baseline_pct: f.baseline_pct, uplift: f.uplift, uplift_unit: f.uplift_unit, tasks: r.num };
      if (r.dimension !== 'Overall') {
        const b = byDim.get(r.dimension);
        if (!same(x.score_pct, b.score_pct)) refuse(`${cd} ${agent} ${r.dimension}: score_pct on the card is ${shown(x.score_pct)} and in benchmarks.json ${shown(b.score_pct)}`);
        if (!same(x.uplift, b.uplift_pct)) refuse(`${cd} ${agent} ${r.dimension}: uplift on the card is ${shown(x.uplift)} and uplift_pct in benchmarks.json ${shown(b.uplift_pct)}`);
        if (!card.newer && !same(x.tasks, b.num === undefined ? null : b.num)) refuse(`${cd} ${agent} ${r.dimension}: Num on the card is ${shown(x.tasks)} and num in benchmarks.json ${shown(b.num)}`);
      }
      return x;
    });
    const model = Object.hasOwn(card.models, agent) ? card.models[agent] : null;
    const modelId = model === null ? 'unknown' : model;
    const unstated = rows.some((x) => x.uplift_unit === 'unstated');
    const tok = Object.hasOwn(card.tokens, agent) ? card.tokens[agent] : null;
    const sourceSha = sha256(cardBytes);
    const notices = [TEXT.figures(sourceSha), TEXT.source(commit), model === null ? TEXT.noModel(agent) : TEXT.model(agent), TEXT.date];
    if (unstated) notices.push(TEXT.unit);
    notices.push(tok ? TEXT.tokens(agent) : card.hasTokenTable ? TEXT.noTokenRow(agent) : TEXT.noTokens, TEXT.verdict, TEXT.unknown);
    // Two rows per dimension, neither carrying a figure; the shared calculation leaves each out of
    // both arms with spec 049's reason, so the comparison is null (AC-8).
    const cases = dims.flatMap((d) => ['with_skill', 'baseline'].map((mode) => ({ id: caseId(d), mode, label: d, case_status: 'no_observations' })));
    const calculated = comparisonOf(cases, { reasons: Object.fromEntries(cases.map((_, i) => [i, REASON])) });
    const receipt = {
      schema_version: RECEIPT_SCHEMA_VERSION,
      // v0.15 (spec 438): a skill, and a delivery the card does not record, so none is invented.
      skill: { name: m.skill, version: 'unknown', content_hash: null, unit: 'skill' },
      suite: { format: 'nvidia/benchmark-card', suite_hash: null, case_count: dims.length },
      run: {
        model_id: modelId,
        model_release_date: null,
        provider: model === null ? 'unknown' : providerOf(model),
        surface: 'external',
        delivery: 'unknown',
        source: 'imported/nvidia-cards',
        runner_version: RUNNER_VERSION,
        date_utc: `${m.evaluation_date}T00:00:00Z`,
        registry: registryStatus(modelId),
        transcripts: 'none',
        judge: { temperature: null, sampling: 'external', surface: 'external', model_id: 'unknown', prompt_template_hash: null },
        answered_by: { kind: 'external', attested: false, reported_model: null, reported_models: null, isolation: 'none' },
        harness: { name: agent, version: null },
        import: { tool: 'nvidia-cards', format: 'BENCHMARK.md', format_version: null, source_sha256: sourceSha, imported_at: importedAt, comparison_method: IMPORT_METHOD, sidecars: [{ file: 'benchmarks.json', sha256: sha256(benchBytes) }], notices },
      },
      results: { cases, aggregates: calculated.aggregates },
      comparison: calculated.comparison,
      verification_level: 'DECLARED',
      uncertainty_unavailable: 'aggregates_only',
      source_figures: {
        agent,
        skill: m.skill,
        evaluation_date: m.evaluation_date,
        evaluator_version: m.evaluator_version,
        environment: m.environment,
        dataset_digest: m.dataset_digest,
        tasks: m.tasks,
        attempts_per_task: m.attempts_per_task,
        source: { repo: REPO, commit, files: [{ path: `skills/${cd}/BENCHMARK.md`, git_blob_sha1: cardBlob }, { path: 'benchmarks.json', git_blob_sha1: benchBlob }] },
        rows,
        tokens: tok,
      },
      receipt_hash: '',
    };
    if (tok) receipt.economics = { basis: 'source-reported', with_skill: { total_tokens: Number(tok.with_skill.replace(/,/g, '')) }, baseline: { total_tokens: Number(tok.without_skill.replace(/,/g, '')) }, judge_excluded: true };
    if (HOME_IN_TEXT.test(JSON.stringify(receipt))) refuse(`${cd} ${agent}: the receipt would carry a local path copied from the card; nothing is written`);
    sealReceipt(receipt);
    const name = receiptBaseName({ skill: receipt.skill.name, model: modelId, tag: `imported-nvidia-cards-${agent}`, date: m.evaluation_date, hash: sourceSha });
    out.push({ skill: cd, agent, receipt, name, unstated, economics: !!tok });
  }
  return { receipts: out, without };
}

// ── the import ──────────────────────────────────────────────────────────────
function importNvidiaCards(dir, { commit, only = null, importedAt = null } = {}) {
  try {
    return build(dir, { commit, only, importedAt });
  } catch (e) {
    if (e instanceof NvidiaRefused) throw e;
    refuse(e && e.message ? e.message : String(e));
  }
}

function build(dir, { commit, only, importedAt }) {
  if (importedAt !== null && (typeof importedAt !== 'string' || !ISO_UTC.test(importedAt))) refuse(`the import time ${shown(importedAt)} is not an ISO 8601 UTC time`);
  if (only !== null && (!Array.isArray(only) || !only.length || only.some((s) => typeof s !== 'string'))) refuse('--only takes one or more skills, by catalog_dir');
  for (const s of only || []) if (!PLAIN.test(s)) refuse(`--only ${shown(s)} is not a plain name`);
  const tree = checkout(dir, commit);
  const benchBytes = readSource(dir, 'benchmarks.json', MAX_INDEX_BYTES, '16 MiB', tree, commit);
  const index = readIndex(benchBytes);
  let names;
  if (only) {
    names = [...new Set(only)].sort(byCodeUnit);
    for (const cd of names) if (!index.skills.has(cd)) refuse(`--only ${cd}: benchmarks.json has no skills row for it`);
  } else {
    // A whole import: every skills row has a card, and every card a skills row (AC-2).
    let entries;
    try { entries = fs.readdirSync(path.join(dir, 'skills'), { withFileTypes: true }); } catch (_e) { refuse('skills/: no such folder in the checkout'); }
    const cards = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) refuse(`skills/${e.name} is a symbolic link; links are not followed`);
      if (!e.isDirectory()) continue;
      let st = null;
      try { st = fs.lstatSync(path.join(dir, 'skills', e.name, 'BENCHMARK.md')); } catch (_e) { st = null; }
      if (st) cards.push(e.name);
    }
    cards.sort(byCodeUnit);
    const rows = [...index.skills.keys()].sort(byCodeUnit);
    const noCard = rows.filter((cd) => !cards.includes(cd));
    const noRow = cards.filter((cd) => !index.skills.has(cd));
    if (noCard.length || noRow.length) refuse(`the checkout and benchmarks.json disagree: ${noCard.length} skills rows have no card (${noCard.slice(0, 3).join(', ')}), and ${noRow.length} cards have no skills row (${noRow.slice(0, 3).join(', ')})`);
    names = rows;
  }

  const benchBlob = blobSha1(benchBytes);
  const receipts = [];
  const report = {
    repo: REPO,
    commit,
    benchmarks_sha256: sha256(benchBytes),
    skills_read: 0,
    skills_with_results: 0,
    skills_without_results: [],
    pairs_with_results: 0,
    receipts_written: 0,
    pairs_without_results: [],
    receipts_by_model: {},
    receipts_unit_unstated: 0,
    economics_unknown: [],
  };
  const names_ = new Map();
  for (const cd of names) {
    const rel = `skills/${cd}/BENCHMARK.md`;
    const cardBytes = readSource(dir, rel, MAX_CARD_BYTES, '1 MiB', tree, commit);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(cardBytes); } catch (_e) { refuse(`${rel} is not UTF-8`); }
    if (text.includes('\r')) refuse(`${rel} holds a carriage return: only cards with line feeds are read`);
    const card = parseCard(cd, text);
    const results = index.results.get(cd) || [];
    report.skills_read++;
    if (results.length) report.skills_with_results++; else report.skills_without_results.push(cd);
    const got = cardReceipts({ cd, card, row: index.skills.get(cd), results, cardBytes, benchBytes, cardBlob: blobSha1(cardBytes), benchBlob, commit, importedAt });
    report.pairs_without_results.push(...got.without);
    for (const x of got.receipts) {
      // Two receipts of one import never share a file (AC-28).
      if (names_.has(x.name)) refuse(`two receipts of this import would share the file name ${x.name}.json (${names_.get(x.name)} and ${cd} ${x.agent}): the cards are the same bytes`);
      names_.set(x.name, `${cd} ${x.agent}`);
      report.pairs_with_results++;
      report.receipts_written++;
      const id = x.receipt.run.model_id;
      report.receipts_by_model[id] = (report.receipts_by_model[id] || 0) + 1;
      if (x.unstated) report.receipts_unit_unstated++;
      if (!x.economics) report.economics_unknown.push({ skill: cd, agent: x.agent });
      receipts.push({ skill: x.skill, agent: x.agent, receipt: x.receipt, name: x.name });
    }
  }
  return { receipts, report };
}

module.exports = { importNvidiaCards, NVIDIA_TOOLS, NvidiaRefused };
