// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 265 (issue 265): the independent reader of NVIDIA benchmark cards. It shares no code with
// lib/importers-nvidia.js: it parses the cards and benchmarks.json again on its own terms, builds the
// receipt each pair must get from the files alone, and reads a receipt against a checkout. The test
// (tests/import-nvidia.test.js) and the proving probe (specs/265-nvidia-cards-import/probes/prove.mjs)
// both read through it, so the probe's comparison is every leaf, as the test's is.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { RUNNER_VERSION } = require('../config');
const { BAND_RULE } = require('../lib/receipt');
const { registryStatus } = require('../lib/models');

// Characters the cards print, written as escapes so no line here carries them (spec 035 AC-9).
const EM = '\u2014'; const ARROW = '\u2192'; const PM = '\u00b1';
const REASON = 'aggregates only: the source carries no per-run scores for this case, so no band can be formed';
const METHOD = 'matched-measured-cases/1';
const REPO = 'NVIDIA/skills';
const UNKNOWN_FIELDS = 'skill.version, skill.content_hash, suite.suite_hash, run.harness.version, run.judge.model_id';

// The fixed texts (spec 265 AC-15), copied from the spec's table.
const T = {
  figures: 'figures are carried as printed in the card with sha256 {sha256}, in source_figures; Driftproof records the files it read and does not attest the author; aggregates only: the card gives one score per dimension and agent and no per-run scores, so no band can be formed and no verdict is read from this receipt',
  source: 'the source is recorded as {repo} at commit {commit}: the path and git blob sha1 of the card and of benchmarks.json are hashed into this receipt in source_figures.source, so each file can be checked against that commit',
  model: 'run.model_id is the model the card names for {agent}',
  noModel: 'the card names no model for {agent}: run.model_id is unknown',
  date: 'the card gives the evaluation date to the day: run.date_utc is the start of that day, source_figures.evaluation_date is the date as printed, and readers show the day alone',
  unit: 'the card prints uplift as a bare percent with no unit: each such row carries uplift_unit unstated, and no baseline is worked out',
  tokens: 'economics are the token totals of the card\'s All cases row for {agent}, as the source reports them; no cost, mean or call count is worked out from them',
  noTokens: 'the card has no token table: economics are unknown',
  noTokenRow: 'the card\'s token table has no All cases row for {agent}: economics are unknown',
  verdict: 'the card\'s own verdict, tier status, findings and recommendation are not carried',
  unknown: 'the card does not state {fields}: each is unknown or null',
};
const fill = (t, slots) => t.replace(/\{([a-z0-9]+)\}/g, (_, k) => String(slots[k]));

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gitSha1 = (b) => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clone = (x) => JSON.parse(JSON.stringify(x));
const num = (s) => { const n = Number(s); return Object.is(n, -0) ? 0 : n; };
const cellsOf = (l) => l.split('|').slice(1, -1).map((x) => x.trim());
const AGENT = { 'Claude Code': 'claude-code', Codex: 'codex' };

// The lines of one `## ` section, the heading excluded.
function section(L, heading) {
  const i = L.indexOf(heading);
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < L.length && !L[j].startsWith('## '); j++) out.push(L[j]);
  return out;
}

// One card, read on its own terms (spec § Source and fixtures, AC-4, AC-9, AC-27).
function parseCard(text) {
  const L = text.split('\n');
  const newer = L.includes('## Evaluation Metadata');
  const metaLines = section(L, newer ? '## Evaluation Metadata' : '## Evaluation Summary') || [];
  const line = (re) => { for (const l of metaLines) { const m = re.exec(l); if (m) return m[1]; } return null; };
  const count = (re) => { const v = line(re); return v === null ? null : Number(v); };
  const meta = {
    skill: line(/^- Skill: `([^`]+)`$/),
    evaluation_date: line(/^- Evaluation date: (\d{4}-\d{2}-\d{2})$/),
    evaluator_version: line(/^- Evaluator version: `([^`]+)`$/),
    environment: line(/^- Environment: `([^`]+)`$/),
    dataset_digest: line(/^- Dataset digest: `([^`]+)`(?: \([^()]+\))?$/),
    tasks: count(/^- (?:Tasks|Dataset): (\d+) evaluation tasks/),
    attempts_per_task: count(/^- Attempts per task: (\d+)$/),
  };
  // The model each agent ran: the newer card's `- Agents:` line, or the older card's list.
  const models = {};
  if (newer) {
    const a = line(/^- Agents: (.*)$/);
    if (a !== null) for (const part of a.split(', ')) { const m = /^(Claude Code|Codex) \(`([^`]+)`\)$/.exec(part); if (m) models[AGENT[m[1]]] = m[2]; }
  } else {
    for (const l of section(L, '## Agents Used') || []) { const m = /^- (Claude Code|Codex) \(`([^`]+)`\)$/.exec(l); if (m) models[AGENT[m[1]]] = m[2]; }
  }
  // The results table: the first table under its heading, before the next heading.
  const under = section(L, newer ? '## Results at a Glance' : '## Results') || [];
  const hi = under.findIndex((l) => l.startsWith('|'));
  let table = null;
  if (hi >= 0) {
    const H = cellsOf(under[hi]);
    const hasNum = H[1] === 'Num';
    const agents = H.slice(hasNum ? 2 : 1).map((h) => (/^(?:Claude Code|`claude-code`)/.test(h) ? 'claude-code' : /^(?:Codex|`codex`)/.test(h) ? 'codex' : null));
    const rows = [];
    for (let j = hi + 2; j < under.length && under[j].startsWith('|'); j++) {
      const c = cellsOf(under[j]);
      rows.push({ dimension: c[0], num: hasNum ? c[1] : null, cells: Object.fromEntries(agents.map((a, k) => [a, c[(hasNum ? 2 : 1) + k]])) });
    }
    table = { agents, rows };
  }
  const tokenLines = section(L, '## Token Usage');
  const tokens = {};
  for (const l of tokenLines || []) {
    if (!l.startsWith('|')) continue;
    const c = cellsOf(l);
    if (c[1] === 'All cases' && (c[0] === 'claude-code' || c[0] === 'codex')) tokens[c[0]] = { with_skill: c[2], without_skill: c[3], delta: c[4], change: c[5], coverage: c[6] };
  }
  return { newer, meta, models, table, hasTokenTable: tokenLines !== null, tokens };
}

// A card cell, by the closed set of shapes in AC-3. `none` is a cell with no figure; undefined is no shape.
const NUM = '(\\d+(?:\\.\\d+)?)';
const SHAPES = {
  points: new RegExp(`^${NUM}% ${ARROW} ${NUM}% \\(([+\\-${PM}])${NUM} points\\)$`),
  unavailable: new RegExp(`^${NUM}% ${EM} baseline ran, but no comparable score was available; uplift unavailable$`),
  bare: new RegExp(`^${NUM}% \\(([+-])${NUM}%\\)$`),
};
function figuresOf(cell, newer) {
  let m;
  if (cell === 'Not available' || cell === 'N/A') return 'none';
  if (newer && (m = SHAPES.points.exec(cell))) {
    if (m[3] === PM && num(m[4]) !== 0) return undefined;
    return { score_pct: num(m[2]), baseline_pct: num(m[1]), uplift: m[3] === '-' ? num(-Number(m[4])) : m[3] === PM ? 0 : num(m[4]), uplift_unit: 'points' };
  }
  if (newer && (m = SHAPES.unavailable.exec(cell))) return { score_pct: num(m[1]), baseline_pct: null, uplift: null, uplift_unit: null };
  if (!newer && (m = SHAPES.bare.exec(cell))) return { score_pct: num(m[1]), baseline_pct: null, uplift: m[2] === '-' ? num(-Number(m[3])) : num(m[3]), uplift_unit: 'unstated' };
  return undefined;
}

const providerOf = (id) => { const segs = id.split('/'); return segs.includes('anthropic') ? 'anthropic' : segs.includes('openai') ? 'openai' : 'unknown'; };
const totalOf = (s) => Number(s.replace(/,/g, ''));
const cardRel = (cd) => `skills/${cd}/BENCHMARK.md`;

// Every receipt the import must write for these skills, and the report, worked out from the files
// alone. `commit` is the checkout's HEAD; `only` null reads every skills row.
function oracle(dir, only, { importedAt, commit }) {
  const benchBytes = fs.readFileSync(path.join(dir, 'benchmarks.json'));
  const bench = JSON.parse(benchBytes.toString('utf8'));
  const out = [];
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
  const names = [...(only || bench.skills.map((s) => s.catalog_dir))].sort(byCodeUnit);
  for (const cd of names) {
    const row = bench.skills.find((s) => s.catalog_dir === cd);
    const cardBytes = fs.readFileSync(path.join(dir, cardRel(cd)));
    const card = parseCard(cardBytes.toString('utf8'));
    report.skills_read++;
    const results = bench.results.filter((r) => r.catalog_dir === cd);
    if (!results.length) report.skills_without_results.push(cd); else report.skills_with_results++;
    const agents = card.table ? card.table.agents : [];
    for (const agent of agents) {
      const rs = results.filter((r) => r.agent === agent);
      if (!rs.length) { report.pairs_without_results.push({ skill: cd, agent }); continue; }
      report.pairs_with_results++;
      const rows = card.table.rows.map((r) => {
        const f = figuresOf(r.cells[agent], card.newer);
        return { dimension: r.dimension, printed: r.cells[agent], score_pct: f.score_pct, baseline_pct: f.baseline_pct, uplift: f.uplift, uplift_unit: f.uplift_unit, tasks: r.num === null ? null : Number(r.num) };
      });
      const dims = card.table.rows.map((r) => r.dimension).filter((d) => d !== 'Overall');
      const cases = dims.flatMap((d) => ['with_skill', 'baseline'].map((mode) => ({ id: `dimension:${d.toLowerCase()}`, mode, label: d, case_status: 'no_observations' })));
      const model = Object.hasOwn(card.models, agent) ? card.models[agent] : null;
      const modelId = model === null ? 'unknown' : model;
      const unstated = rows.some((r) => r.uplift_unit === 'unstated');
      const tok = card.tokens[agent] || null;
      const sourceSha = sha256(cardBytes);
      const notices = [fill(T.figures, { sha256: sourceSha }), fill(T.source, { repo: REPO, commit }), model === null ? fill(T.noModel, { agent }) : fill(T.model, { agent }), T.date];
      if (unstated) notices.push(T.unit);
      notices.push(tok ? fill(T.tokens, { agent }) : card.hasTokenTable ? fill(T.noTokenRow, { agent }) : T.noTokens, T.verdict, fill(T.unknown, { fields: UNKNOWN_FIELDS }));
      const receipt = {
        schema_version: '0.13',
        skill: { name: card.meta.skill, version: 'unknown', content_hash: null },
        suite: { format: 'nvidia/benchmark-card', suite_hash: null, case_count: dims.length },
        run: {
          model_id: modelId,
          model_release_date: null,
          provider: model === null ? 'unknown' : providerOf(model),
          surface: 'external',
          source: 'imported/nvidia-cards',
          runner_version: RUNNER_VERSION,
          date_utc: `${card.meta.evaluation_date}T00:00:00Z`,
          registry: registryStatus(modelId),
          transcripts: 'none',
          judge: { temperature: null, sampling: 'external', surface: 'external', model_id: 'unknown', prompt_template_hash: null },
          answered_by: { kind: 'external', attested: false, reported_model: null, reported_models: null, isolation: 'none' },
          harness: { name: agent, version: null },
          import: { tool: 'nvidia-cards', format: 'BENCHMARK.md', format_version: null, source_sha256: sourceSha, imported_at: importedAt, comparison_method: METHOD, sidecars: [{ file: 'benchmarks.json', sha256: sha256(benchBytes) }], notices },
        },
        results: {
          cases,
          aggregates: {
            with_skill: { case_count: 0, pass_count: 0, borderline_count: 0, mean_score: null, stddev: null },
            baseline: { case_count: 0, pass_count: 0, borderline_count: 0, mean_score: null, stddev: null },
            band_rule: BAND_RULE,
            excluded_cases: dims.map((d) => ({ id: `dimension:${d.toLowerCase()}`, modes: ['with_skill', 'baseline'], reason: REASON })),
          },
        },
        comparison: { with_skill_score: null, baseline_score: null, delta: null, delta_uncertainty: null, delta_uncertainty_unavailable: 'no_cases' },
        verification_level: 'DECLARED',
        uncertainty_unavailable: 'aggregates_only',
        source_figures: {
          agent,
          skill: card.meta.skill,
          evaluation_date: card.meta.evaluation_date,
          evaluator_version: card.meta.evaluator_version,
          environment: card.meta.environment,
          dataset_digest: card.meta.dataset_digest,
          tasks: card.meta.tasks,
          attempts_per_task: card.meta.attempts_per_task,
          source: { repo: REPO, commit, files: [{ path: cardRel(cd), git_blob_sha1: gitSha1(cardBytes) }, { path: 'benchmarks.json', git_blob_sha1: gitSha1(benchBytes) }] },
          rows,
          tokens: tok,
        },
      };
      if (tok) receipt.economics = { basis: 'source-reported', with_skill: { total_tokens: totalOf(tok.with_skill) }, baseline: { total_tokens: totalOf(tok.without_skill) }, judge_excluded: true };
      else report.economics_unknown.push({ skill: cd, agent });
      report.receipts_written++;
      report.receipts_by_model[modelId] = (report.receipts_by_model[modelId] || 0) + 1;
      if (unstated) report.receipts_unit_unstated++;
      out.push({ skill: cd, agent, receipt, card, results: rs, row });
    }
  }
  return { receipts: out, report };
}

// Every leaf, both ways (AC-13): the paths at which two values differ.
function leafDiff(a, b, p = '') {
  const obj = (x) => x !== null && typeof x === 'object';
  if (obj(a) && obj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => leafDiff(a[k], b[k], p ? `${p}.${k}` : k));
  }
  return Object.is(a, b) ? [] : [p || '(root)'];
}
const strip = (r) => { const x = clone(r); delete x.receipt_hash; return x; };
function problems(receipt, expected) { return leafDiff(strip(receipt), expected); }

// git, as the reader runs it: the caller's GIT_ variables removed, reads only.
function git(dir, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return spawnSync('git', ['-C', dir, ...args], { env, maxBuffer: 256 * 1024 * 1024 });
}
function headOf(dir) {
  const r = git(dir, ['rev-parse', 'HEAD']);
  return r.status === 0 ? r.stdout.toString('utf8').trim() : null;
}
// Every blob of a commit under these paths: path -> { mode, sha }.
function treeOf(dir, commit, paths = ['benchmarks.json', 'skills']) {
  const r = git(dir, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...paths]);
  if (r.status !== 0) return null;
  const map = new Map();
  for (const ent of r.stdout.toString('utf8').split('\0').filter(Boolean)) {
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40})\t(.*)$/s.exec(ent);
    if (m) map.set(m[4], { mode: m[1], type: m[2], sha: m[3] });
  }
  return map;
}

// AC-24: a receipt read against a checkout on its own. Each recorded file is read at the recorded
// commit with `git show`, its blob sha1 checked, the card parsed again and every figure compared.
function checkAgainst(receipt, dir) {
  const out = [];
  const src = receipt && receipt.source_figures && receipt.source_figures.source;
  if (!src || src.repo !== REPO || !/^[0-9a-f]{40}$/.test(String(src.commit)) || !Array.isArray(src.files) || src.files.length !== 2) return ['no recorded source'];
  const bytes = {};
  for (const f of src.files) {
    const r = git(dir, ['show', `${src.commit}:${f.path}`]);
    if (r.status !== 0) { out.push(`${f.path} is not in commit ${src.commit}`); continue; }
    if (gitSha1(r.stdout) !== f.git_blob_sha1) out.push(`${f.path}: the recorded blob sha1 is not the commit's`);
    bytes[f.path] = r.stdout;
  }
  if (out.length) return out;
  const cardPath = src.files[0].path;
  const cd = cardPath.split('/')[1];
  const card = parseCard(bytes[cardPath].toString('utf8'));
  const bench = JSON.parse(bytes['benchmarks.json'].toString('utf8'));
  const sf = receipt.source_figures;
  if (sha256(bytes[cardPath]) !== receipt.run.import.source_sha256) out.push('source_sha256 is not the card\'s');
  const agent = sf.agent;
  if (!card.table || !card.table.agents.includes(agent)) return [...out, `the card has no column for ${agent}`];
  const want = card.table.rows;
  if (!Array.isArray(sf.rows) || sf.rows.length !== want.length) out.push('rows: not one per card row');
  (sf.rows || []).forEach((r, i) => {
    const w = want[i];
    if (!w) return;
    const f = figuresOf(w.cells[agent], card.newer);
    if (r.dimension !== w.dimension || r.printed !== w.cells[agent]) out.push(`rows[${i}]: not the card's cell`);
    if (!f || f === 'none') { out.push(`rows[${i}]: the card cell has no figure`); return; }
    for (const k of ['score_pct', 'baseline_pct', 'uplift', 'uplift_unit']) if (!Object.is(r[k], f[k])) out.push(`rows[${i}].${k}`);
    if (w.dimension !== 'Overall') {
      const b = bench.results.find((x) => x.catalog_dir === cd && x.agent === agent && x.dimension === w.dimension);
      if (!b || !Object.is(b.score_pct, r.score_pct) || !Object.is(b.uplift_pct, r.uplift)) out.push(`rows[${i}] against benchmarks.json`);
    }
  });
  return out;
}

// The figures of one receipt against its card and benchmarks.json on disk, field by field (AC-3,
// AC-4, AC-5, AC-8).
function figureProblems(receipt, dir) {
  const out = [];
  const cd = fs.readdirSync(path.join(dir, 'skills')).find((d) => { try { return sha256(fs.readFileSync(path.join(dir, cardRel(d)))) === receipt.run.import.source_sha256; } catch { return false; } });
  if (!cd) return ['no card has the receipt\'s source_sha256'];
  const card = parseCard(fs.readFileSync(path.join(dir, cardRel(cd)), 'utf8'));
  const bench = JSON.parse(fs.readFileSync(path.join(dir, 'benchmarks.json'), 'utf8'));
  const sf = receipt.source_figures || {};
  const agent = sf.agent;
  if (!card.table || !card.table.agents.includes(agent)) return [`the card has no column for ${agent}`];
  const want = card.table.rows;
  if (!Array.isArray(sf.rows) || sf.rows.length !== want.length) out.push('rows: not one per card row');
  (sf.rows || []).forEach((r, i) => {
    const w = want[i];
    if (!w) return;
    if (r.dimension !== w.dimension) out.push(`rows[${i}].dimension`);
    if (r.printed !== w.cells[agent]) out.push(`rows[${i}].printed`);
    const f = figuresOf(w.cells[agent], card.newer);
    if (!f || f === 'none') { out.push(`rows[${i}]: the card cell has no figure`); return; }
    for (const k of ['score_pct', 'baseline_pct', 'uplift', 'uplift_unit']) if (!Object.is(r[k], f[k])) out.push(`rows[${i}].${k}`);
    if (!Object.is(r.tasks, w.num === null ? null : Number(w.num))) out.push(`rows[${i}].tasks`);
    if (w.dimension !== 'Overall') {
      const b = bench.results.find((x) => x.catalog_dir === cd && x.agent === agent && x.dimension === w.dimension);
      if (!b) out.push(`rows[${i}]: no benchmarks.json row`);
      else {
        if (!Object.is(r.score_pct, b.score_pct)) out.push(`rows[${i}].score_pct against benchmarks.json`);
        if (!Object.is(r.uplift, b.uplift_pct)) out.push(`rows[${i}].uplift against benchmarks.json`);
      }
    }
  });
  // No baseline, ratio or spread anywhere but where the card prints one (AC-5, AC-8).
  const printedBaselines = new Set(want.map((w) => figuresOf(w.cells[agent], card.newer)).filter((f) => f && f !== 'none' && f.baseline_pct !== null).map((f) => f.baseline_pct));
  for (const r of sf.rows || []) if (r.baseline_pct !== null && !printedBaselines.has(r.baseline_pct)) out.push(`a baseline the card does not print: ${r.baseline_pct}`);
  for (const c of receipt.results.cases) for (const k of ['score', 'mean', 'stddev', 'samples', 'threshold', 'outcome', 'counts']) if (Object.hasOwn(c, k)) out.push(`results.cases ${c.id} ${c.mode} carries ${k}`);
  if (receipt.run.counts || receipt.run.arms) out.push('a count is written');
  for (const k of ['with_skill_score', 'baseline_score', 'delta', 'delta_uncertainty']) if (receipt.comparison[k] !== null) out.push(`comparison.${k} is not null`);
  return out;
}

// The numbers a card prints for one agent, as strings (AC-29).
function printedNumbers(receipt) {
  const set = new Set();
  for (const r of (receipt.source_figures || {}).rows || []) for (const m of String(r.printed).matchAll(/\d+(?:\.\d+)?/g)) set.add(String(num(m[0])));
  return set;
}

module.exports = {
  EM, ARROW, PM, REASON, METHOD, REPO, UNKNOWN_FIELDS, T, fill, sha256, gitSha1, byCodeUnit, clone, cellsOf,
  parseCard, figuresOf, oracle, leafDiff, strip, problems, git, headOf, treeOf, checkAgainst, figureProblems, printedNumbers, cardRel,
};
