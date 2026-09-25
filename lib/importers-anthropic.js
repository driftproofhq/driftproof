// SPDX-License-Identifier: Apache-2.0
'use strict';

// Receipt interop: the two Anthropic formats (spec 049, receipt spec v0.9).
//
//   claude-plugin-eval  `claude plugin eval`'s aggregate-result.json (or its --json output),
//                       schemaVersion 1. The unit measured is a plugin.
//   skill-creator       skill-creator's benchmark.json, which skill-up also writes, with
//                       skill-up's result.json read from beside it when present.
//
// The rules every importer here keeps (docs/interop.md): no source field is invented, so an
// absent one is "unknown" or null and named in run.import.notices; the receipt is DECLARED,
// surface external, every hash null; the run date comes from the source and never from the
// clock, which is read once, into run.import.imported_at; cases are grouped by their identity
// in the source, never by a display name. Nothing the source carries as text (prompts,
// answers, grader evidence, local paths) is copied.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RECEIPT_SCHEMA_VERSION, RUNNER_VERSION } = require('../config');
const { sealReceipt, BAND_RULE, comparisonOf } = require('./receipt');
const { mean, stddev, round, aggregateBands } = require('./stats');
const { outcomeFor } = require('./run');
const { inferProvider } = require('./provider');
const { registryStatus } = require('./models');
const { placeCounts } = require('./counts');
const { median, quartiles } = require('./value');

const ANTHROPIC_TOOLS = ['claude-plugin-eval', 'skill-creator'];
const DOCUMENT_NAME = { 'claude-plugin-eval': 'aggregate-result.json', 'skill-creator': 'benchmark.json' };
const AGGREGATES_ONLY = 'aggregates only: the source carries no per-run scores for this case, so no band can be formed';

class ImportRefused extends Error {}
const refuse = (msg) => { throw new ImportRefused(msg); };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Source text copied into a receipt (a run's error) can name local files: a home directory, a
// scratch directory, a user's project. Every local path is replaced before it is written (spec 049
// NFR-3, approval F-1 twice): a file: URL, a drive path with either slash, and an absolute or
// home-relative path wherever it starts, a colon before it included; an apostrophe followed by a
// word character is part of the path (A-052-2). Web URLs are set aside first
// and put back, so they are the one thing a slash-led run is not redacted inside. A path that starts
// right after a quote runs to the same quote, or to the end of the text, spaces and line breaks
// included (spec 052 AC-1 and A-052-1, spec 049 approval F-1 a third time): Node quotes the paths it
// prints, a profile folder can have a space in it, and a run error can be a stack of several lines.
const WEB_URL = /\b(?:https?|wss?|ftp):\/\/[^\s"'`<>]+/gi;
const PATH_START = /^(?:file:\/\/|[A-Za-z]:[\\/]|~?\/)/;
// A quoted path closes at the next same quote that is not inside a name (followed by a word
// character, as in O'Brien, A-052-2), across line breaks, unless that quote itself opens a
// path: then this one ends at its own line break (A-052-1, approval F-1: an unclosed quote in one
// stack line must not pair with the quote that opens the next line's path). With no such quote, the
// path runs to the end of the text.
function redactQuoted(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const q = s[i];
    if ((q === "'" || q === '"' || q === '`') && PATH_START.test(s.slice(i + 1))) {
      // A same quote followed by a word character is inside a name (O'Brien), not a closing quote,
      // unless it opens a path of its own (A-052-2).
      let k = s.indexOf(q, i + 1);
      while (k >= 0 && /\w/.test(s[k + 1] || '') && !PATH_START.test(s.slice(k + 1))) k = s.indexOf(q, k + 1);
      if (k < 0) { out += `${q}<local path>`; i = s.length; continue; }
      if (!PATH_START.test(s.slice(k + 1))) { out += `${q}<local path>${q}`; i = k + 1; continue; }
      const nl = s.indexOf('\n', i + 1);
      const end = nl >= 0 && nl < k ? nl : k;
      out += `${q}<local path>`; i = end; continue;
    }
    out += q; i++;
  }
  return out;
}
const LOCAL_PATHS = [
  /\bfile:\/\/(?:[^\s"'`<>]|'(?=\w))*/gi,
  /(?<![\w])[A-Za-z]:[\\/](?:[^\s"'`<>]|'(?=\w))*/g,
  /(?<![\w.~-])~?\/(?:[^\s"'`<>]|'(?=\w))*[^\s"'`<>.,;:)\]]/g,
];
function redactPaths(s) {
  const urls = [];
  let out = String(s).replace(WEB_URL, (u) => { urls.push(u); return `\u0000${urls.length - 1}\u0000`; });
  out = redactQuoted(out);
  for (const re of LOCAL_PATHS) out = out.replace(re, '<local path>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, n) => urls[Number(n)]);
}
// The last word on NFR-3: a receipt that still names a home directory is not written. A home
// directory is read wherever it sits in a path, not only at its start (spec 052 AC-2, spec 049
// approval F-2): /var/home and /usr/home, /mnt/c/Users and /System/Volumes/Data/Users, /var/root;
// a profile root after a drive or a WSL drive mount in either case; and home, Users or root between
// backslashes (a \\wsl$ share, a UNC path). The receipt is read as JSON, so a backslash is doubled.
// Web URLs are set aside first, as the redaction does.
const HOME_PATHS = [
  /\/(?:home|Users)\/[^/\s"]+/,
  /\/root\//,
  /(?:[A-Za-z]:|\/mnt\/[A-Za-z])[\\/]+(?:users|documents and settings)[\\/]/i,
  /\\(?:home|users|root)\\+[^\\\s"]/i,
];
const namesHome = (text) => { const t = String(text).replace(WEB_URL, ''); return HOME_PATHS.some((re) => re.test(t)); };
const num = (x) => typeof x === 'number' && Number.isFinite(x);

// ── finding the document ─────────────────────────────────────────────────────
// A file is the document. A directory is searched, all the way down, for the one file the
// format needs; none, or more than one, is a refusal that names what was found.
function findDocument(p, from) {
  const name = DOCUMENT_NAME[from];
  if (!name) refuse(`unknown import source "${from}"`);
  let st;
  try { st = fs.statSync(p); } catch (_e) { refuse(`no such file or directory: ${p}`); }
  if (st.isFile()) return p;
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(f);
      else if (e.isFile() && e.name === name) found.push(f);
    }
  };
  walk(p);
  if (found.length === 1) return found[0];
  if (!found.length) refuse(`no ${name} under ${p}: --from ${from} imports one ${name}`);
  refuse(`${found.length} files named ${name} under ${p}; import one at a time:\n  ${found.map((f) => path.relative(p, f)).join('\n  ')}`);
}

// ── shared pieces ────────────────────────────────────────────────────────────
// One case row from its measured draws. `threshold` is the source's pass threshold, or null.
function measuredRow(id, mode, scores, threshold, judgeModel) {
  const m = round(mean(scores));
  const sd = round(stddev(scores));
  return { id, mode, outcome: outcomeFor(m, sd, threshold), score: m, mean: m, stddev: sd, samples: scores.map((s) => round(s)), threshold, judge: { model_id: judgeModel, rubric_hash: null } };
}
function unobservedRow(id, mode) { return { id, mode, case_status: 'no_observations' }; }

function aggregateMode(rows) {
  const band = aggregateBands(rows.map((c) => ({ mean: c.mean, stddev: c.stddev || 0, n: c.samples.length })));
  return {
    case_count: rows.length,
    pass_count: rows.filter((c) => c.outcome === 'pass').length,
    borderline_count: rows.filter((c) => c.outcome === 'borderline').length,
    mean_score: band.mean,
    stddev: band.stddev,
  };
}

// Economics per arm, from what the source reports per run. `costs` are the source's own
// estimates (Format A) or absent (Format B); `wallMs` and `tokens` as reported.
function armEconomics({ n, costs = [], wallMs = [], tokens = null }) {
  const q = quartiles(wallMs);
  const out = {
    call_count: n,
    mean_input_tokens: null,
    mean_output_tokens: null,
    mean_cost_usd_per_call: costs.length ? round(mean(costs)) : null,
    median_wall_ms: median(wallMs),
    wall_ms_p25: q.p25,
    wall_ms_p75: q.p75,
    wall_ms_iqr: q.iqr,
  };
  if (tokens) out.mean_total_tokens = tokens.length ? round(mean(tokens), 2) : null;
  return out;
}
function economicsBlock(basis, w, b) {
  const inc = w.mean_cost_usd_per_call != null && b.mean_cost_usd_per_call != null ? round(w.mean_cost_usd_per_call - b.mean_cost_usd_per_call) : null;
  return {
    basis,
    with_skill: w,
    baseline: b,
    skill_incremental_cost_usd_per_call: inc,
    skill_incremental_cost_usd_per_1k_calls: inc == null ? null : round(inc * 1000),
    output_tokens_delta: null,
    median_wall_ms_delta: w.median_wall_ms != null && b.median_wall_ms != null ? round(w.median_wall_ms - b.median_wall_ms, 2) : null,
    judge_excluded: true,
  };
}

// The receipt shell. `rows` are results.cases in order; `perCase` the counts each row's
// source establishes; `excludedReasons` the reason per excluded row index.
function assemble({ tool, format, formatVersion, sourceBytes, sidecars, importedAt, notices, skill, suite, modelId, judgeModel, dateUtc, harness, rows, perCase, excludedReasons, economics }) {
  const measured = rows.filter((c) => !c.case_status);
  const aggW = aggregateMode(measured.filter((c) => c.mode === 'with_skill'));
  const aggB = aggregateMode(measured.filter((c) => c.mode === 'baseline'));
  const excluded = rows.map((c, i) => [c, i]).filter(([c]) => c.case_status).map(([c, i]) => ({ id: c.id, modes: [c.mode], reason: excludedReasons[i] }));
  const imp = { tool, format, format_version: formatVersion, source_sha256: sha256(sourceBytes), imported_at: importedAt };
  if (sidecars.length) imp.sidecars = sidecars;
  if (notices.length) imp.notices = notices;
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    skill: { name: skill.name, version: skill.version, content_hash: null, unit: skill.unit },
    suite: { format: suite.format, suite_hash: null, case_count: suite.caseCount },
    run: {
      model_id: modelId,
      model_release_date: null,
      provider: modelId === 'unknown' ? 'unknown' : inferProvider(modelId),
      surface: 'external',
      source: `imported/${tool}`,
      runner_version: RUNNER_VERSION,
      date_utc: dateUtc,
      registry: registryStatus(modelId),
      transcripts: 'none',
      judge: { temperature: null, sampling: 'external', surface: 'external', model_id: judgeModel, prompt_template_hash: null },
      answered_by: { kind: 'external', attested: false, reported_model: null, reported_models: null, isolation: 'none' },
      ...(harness ? { harness } : {}),
      import: imp,
    },
    results: {
      cases: rows,
      aggregates: { with_skill: aggW, baseline: aggB, band_rule: BAND_RULE, ...(excluded.length ? { excluded_cases: excluded } : {}) },
    },
    comparison: comparisonOf(aggW, aggB),
    verification_level: 'DECLARED',
    economics,
    receipt_hash: '',
  };
  placeCounts(receipt, perCase);
  if (namesHome(JSON.stringify(receipt))) refuse('the receipt would carry a home-directory path copied from the source; nothing is written (spec 049 NFR-3)');
  return sealReceipt(receipt);
}

// ── Format A: claude plugin eval ─────────────────────────────────────────────
// The results directory's name, `2026-09-10T17-02-11-482Z`, is a UTC time.
function dateFromDirName(file) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/.exec(path.basename(path.dirname(file)));
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[5] ? `.${m[5]}` : ''}Z` : null;
}

function importPluginEval(file, bytes, { importedAt, countErroredRuns = false }) {
  let d;
  try { d = JSON.parse(bytes.toString('utf8')); } catch (e) { refuse(`not JSON: ${e.message}`); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) refuse('expected a claude plugin eval result object');
  if (d.schemaVersion !== 1) refuse(`claude plugin eval schemaVersion ${JSON.stringify(d.schemaVersion)} is not supported (this importer reads schemaVersion 1)`);
  if (d.partial === true) refuse(`the document is partial, and a partial run is not imported: ${d.partialReason == null ? 'the source gives no partialReason' : String(d.partialReason)}`);
  if (!Array.isArray(d.cases)) refuse('the document carries no cases[]');
  const names = d.cases.map((c) => (c && typeof c.name === 'string' ? c.name : null));
  if (names.some((n) => n === null)) refuse('a case carries no name');
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup !== undefined) refuse(`two cases share the name ${JSON.stringify(dup)}; cases are never merged`);

  const suite = d.suite || {};
  const notices = [];
  const modelId = typeof suite.modelOverride === 'string' && suite.modelOverride ? suite.modelOverride : 'unknown';
  if (modelId === 'unknown') notices.push('the source records no model under test (suite.modelOverride is absent): run.model_id is unknown, never Claude Code\'s default');
  const judgeModel = typeof suite.judgeModel === 'string' && suite.judgeModel ? suite.judgeModel : 'unknown';
  if (judgeModel === 'unknown') notices.push('the source records no judge model (suite.judgeModel is absent); its default judge is a small fast model, so run.judge.model_id is unknown');
  let dateUtc = typeof d.startedAt === 'string' ? d.startedAt : null;
  if (!dateUtc) {
    dateUtc = dateFromDirName(file);
    notices.push(dateUtc ? 'run.date_utc is read from the results directory\'s name (the document carries no startedAt)' : 'the source carries no run date (no startedAt, and the directory name is not a results timestamp): run.date_utc is null');
  }
  const plugins = Array.isArray(suite.plugins) ? suite.plugins : [];
  const plugin = plugins.length === 1 ? plugins[0] : null;
  if (!plugin) notices.push(`the suite loads ${plugins.length} plugins, not one: skill.name and skill.version are unknown`);
  const harness = { name: 'claude-code', version: typeof d.claudeVersion === 'string' ? d.claudeVersion : null };
  if (harness.version === null) notices.push('the source records no claudeVersion: run.harness.version is null');
  const threshold = num(suite.threshold) ? suite.threshold : null;
  const twoArm = suite.ablation !== 'none';
  let erroredCounted = 0;

  const rows = [];
  const perCase = [];
  const excludedReasons = {};
  const econ = { with_skill: { n: 0, costs: [], wallMs: [] }, baseline: { n: 0, costs: [], wallMs: [] } };
  for (const c of d.cases) {
    const arms = c.arms && typeof c.arms === 'object' ? c.arms : null;
    const hasRuns = !!arms && (Array.isArray(arms.with) || Array.isArray(arms.without));
    const skillGraders = (Array.isArray(c.graders) ? c.graders : []).filter((g) => g && g.type === 'tool_used' && g.config && g.config.tool === 'Skill').map((g) => g.name);
    for (const [key, mode] of [['with', 'with_skill'], ['without', 'baseline']]) {
      if (mode === 'baseline' && !(hasRuns ? Array.isArray(arms.without) : twoArm)) continue;
      const idx = rows.length;
      if (!hasRuns) {
        rows.push(unobservedRow(c.name, mode));
        excludedReasons[idx] = AGGREGATES_ONLY;
        continue;
      }
      const runs = Array.isArray(arms[key]) ? arms[key] : [];
      const measured = [];
      const excludedDraws = [];
      runs.forEach((r, i) => {
        const at = i + 1;
        if (r && r.error != null && !countErroredRuns) { excludedDraws.push({ draw_index: at, reason: `the source recorded an error for this run: ${redactPaths(r.error).slice(0, 300)}` }); return; }
        if (r && r.skippedPaidGraders === true) { excludedDraws.push({ draw_index: at, reason: 'the source skipped this run\'s paid graders (skippedPaidGraders: true), so its score omits them' }); return; }
        if (!r || !num(r.score)) { excludedDraws.push({ draw_index: at, reason: 'the source gives this run no numeric score' }); return; }
        if (r.error != null) erroredCounted++;
        measured.push(r);
      });
      perCase.push({ index: idx, counts: { generations_per_arm: measured.length } });
      if (!measured.length) {
        const row = unobservedRow(c.name, mode);
        if (excludedDraws.length) row.excluded_draws = excludedDraws;
        rows.push(row);
        excludedReasons[idx] = runs.length ? 'every run of this arm was kept out; each is listed in excluded_draws' : 'the source lists no runs for this arm';
        continue;
      }
      const row = measuredRow(c.name, mode, measured.map((r) => r.score), threshold, judgeModel);
      if (excludedDraws.length) row.excluded_draws = excludedDraws;
      // Activation: an unscored tool_used Skill grader says whether the skill fired. It is
      // recorded beside the score and never enters it (the run's score already excludes it).
      if (mode === 'with_skill') {
        const activation = [];
        for (const name of skillGraders) {
          const seen = measured.map((r) => (Array.isArray(r.graders) ? r.graders.find((g) => g && g.name === name) : null)).filter((g) => g && g.scored === false);
          if (seen.length) activation.push({ indicator: name, fired: seen.filter((g) => g.passed === true).length, runs: seen.length });
        }
        if (activation.length) row.activation = activation;
      }
      rows.push(row);
      econ[mode].n += measured.length;
      for (const r of measured) {
        if (num(r.costUsd)) econ[mode].costs.push(r.costUsd);
        if (num(r.durationSeconds)) econ[mode].wallMs.push(Math.round(r.durationSeconds * 1000));
      }
    }
  }
  if (erroredCounted) notices.push(`${erroredCounted} errored run(s) are counted as measured draws (--count-errored-runs)`);
  return assemble({
    tool: 'claude-plugin-eval', format: 'aggregate-result.json', formatVersion: d.schemaVersion, sourceBytes: bytes, sidecars: [], importedAt, notices,
    skill: { name: plugin && typeof plugin.name === 'string' ? plugin.name : 'unknown', version: plugin && typeof plugin.version === 'string' ? plugin.version : 'unknown', unit: 'plugin' },
    suite: { format: 'claude-plugin-eval/aggregate-result.json', caseCount: d.cases.length },
    modelId, judgeModel, dateUtc, harness, rows, perCase, excludedReasons,
    economics: economicsBlock('source-list-price-estimate', armEconomics(econ.with_skill), armEconomics(econ.baseline)),
  });
}

// ── Format B: benchmark.json (skill-creator, skill-up) ───────────────────────
const CONFIGURATIONS = { with_skill: 'with_skill', without_skill: 'baseline' };

// skill-up's result.json names the model it forwarded (applied_configuration.model) and,
// only when the agent reported one, the model observed. Observed first.
function modelFromResult(res) {
  const oc = res && res.observed_configuration;
  if (oc && typeof oc.model === 'string' && oc.model) return { model: oc.model, from: 'observed_configuration.model' };
  const per = (Array.isArray(res && res.case_results) ? res.case_results : []).map((c) => c && c.observed_model);
  if (per.length && per.every((m) => typeof m === 'string' && m && m === per[0])) return { model: per[0], from: 'case_results[].observed_model' };
  const ac = res && res.applied_configuration;
  if (ac && typeof ac.model === 'string' && ac.model) return { model: ac.model, from: 'applied_configuration.model' };
  return null;
}

function importBenchmark(file, bytes, { importedAt }) {
  let d;
  try { d = JSON.parse(bytes.toString('utf8')); } catch (e) { refuse(`not JSON: ${e.message}`); }
  if (!d || typeof d !== 'object' || !d.metadata || typeof d.metadata !== 'object') refuse('expected a benchmark.json with metadata');
  const meta = d.metadata;
  const runs = Array.isArray(d.runs) ? d.runs : [];
  const notices = [];
  const groups = new Map();
  const labels = new Map();
  const seen = new Set();
  for (const r of runs) {
    if (!r || (typeof r.eval_id !== 'number' && typeof r.eval_id !== 'string')) refuse('a runs[] row carries no eval_id');
    const mode = CONFIGURATIONS[r.configuration];
    if (!mode) refuse(`configuration ${JSON.stringify(r.configuration)} is neither with_skill nor without_skill`);
    const id = String(r.eval_id);
    const key = `${id}\u0000${r.configuration}\u0000${r.run_number}`;
    if (seen.has(key)) refuse(`two rows share eval_id ${id}, configuration ${r.configuration} and run_number ${r.run_number}; rows are never merged`);
    seen.add(key);
    if (!groups.has(id)) groups.set(id, { with_skill: [], baseline: [] });
    groups.get(id)[mode].push(r);
    if (typeof r.eval_name === 'string' && !labels.has(id)) labels.set(id, r.eval_name);
  }
  // Evals the metadata names with no row are aggregates only.
  const declared = (Array.isArray(meta.evals_run) ? meta.evals_run : []).map(String);
  const ids = [...new Set([...groups.keys(), ...declared])];
  const hasBaseline = runs.some((r) => r.configuration === 'without_skill') || !!(d.run_summary && d.run_summary.without_skill);

  // The model, from the document or the result.json beside it.
  const sidecars = [];
  let modelId = typeof meta.executor_model === 'string' && meta.executor_model ? meta.executor_model : null;
  let harness = null;
  const resultFile = path.join(path.dirname(file), 'result.json');
  let res = null;
  if (fs.existsSync(resultFile)) {
    const rb = fs.readFileSync(resultFile);
    try { res = JSON.parse(rb.toString('utf8')); sidecars.push({ file: 'result.json', sha256: sha256(rb) }); } catch (_e) { notices.push('result.json beside the document does not parse and is not read'); }
  }
  if (!modelId) {
    const found = res && modelFromResult(res);
    if (found) {
      modelId = found.model;
      notices.push(found.from === 'applied_configuration.model'
        ? 'run.model_id is the model skill-up forwarded to the agent (result.json applied_configuration.model); the agent reported none, so it is not an observation'
        : `run.model_id is read from result.json ${found.from}`);
    } else {
      modelId = 'unknown';
      notices.push(res ? 'neither benchmark.json nor result.json records the model: run.model_id is unknown' : 'benchmark.json records no executor_model and no result.json is beside it: run.model_id is unknown');
    }
  }
  if (res && typeof res.engine_name === 'string' && res.engine_name) {
    const v = res.observed_configuration && typeof res.observed_configuration.version === 'string' ? res.observed_configuration.version : null;
    harness = { name: res.engine_name, version: v };
  }
  // No cited benchmark.json format records the grader's model (skill-up's grading.json carries
  // expectations and a summary only), and analyzer_model is not the grader, so the judge is unknown.
  const judgeModel = 'unknown';
  notices.push('benchmark.json records no grader model: run.judge.model_id is unknown (analyzer_model is not the grader and is not read)');
  const dateUtc = typeof meta.timestamp === 'string' && meta.timestamp ? meta.timestamp : null;
  if (!dateUtc) notices.push('benchmark.json carries no metadata.timestamp: run.date_utc is null');

  const rows = [];
  const perCase = [];
  const excludedReasons = {};
  const econ = { with_skill: { n: 0, wallMs: [], tokens: [] }, baseline: { n: 0, wallMs: [], tokens: [] } };
  const observed = new Set();
  for (const id of ids) {
    const g = groups.get(id);
    for (const mode of ['with_skill', 'baseline']) {
      if (mode === 'baseline' && !hasBaseline) continue;
      const idx = rows.length;
      const rs = g ? g[mode].slice().sort((a, b) => Number(a.run_number) - Number(b.run_number)) : [];
      const scored = rs.filter((r) => r.result && num(r.result.pass_rate));
      if (!g) {
        rows.push(unobservedRow(id, mode));
        excludedReasons[idx] = AGGREGATES_ONLY;
        continue;
      }
      perCase.push({ index: idx, counts: { generations_per_arm: scored.length } });
      observed.add(scored.length);
      const row = scored.length ? measuredRow(id, mode, scored.map((r) => r.result.pass_rate), null, judgeModel) : unobservedRow(id, mode);
      if (labels.has(id)) row.label = labels.get(id);
      const dropped = rs.filter((r) => !scored.includes(r)).map((r) => ({ draw_index: Number(r.run_number), reason: 'the source gives this run no numeric pass_rate' }));
      if (dropped.length) row.excluded_draws = dropped;
      rows.push(row);
      if (!scored.length) { excludedReasons[idx] = 'the source lists no scored run for this arm'; continue; }
      econ[mode].n += scored.length;
      for (const r of scored) {
        if (num(r.result.time_seconds)) econ[mode].wallMs.push(Math.round(r.result.time_seconds * 1000));
        if (num(r.result.tokens)) econ[mode].tokens.push(r.result.tokens);
      }
    }
  }
  if (num(meta.runs_per_configuration) && [...observed].some((n) => n !== meta.runs_per_configuration)) {
    notices.push(`metadata.runs_per_configuration declares ${meta.runs_per_configuration}; the rows carry ${[...observed].sort().join(', ')} per configuration, and the rows are what is recorded`);
  }
  return assemble({
    tool: 'skill-creator', format: 'benchmark.json', formatVersion: null, sourceBytes: bytes, sidecars, importedAt, notices,
    skill: { name: typeof meta.skill_name === 'string' && meta.skill_name ? meta.skill_name : 'unknown', version: 'unknown', unit: 'skill' },
    suite: { format: 'skill-creator/benchmark.json', caseCount: ids.length },
    modelId, judgeModel, dateUtc, harness, rows, perCase, excludedReasons,
    economics: economicsBlock('source-reported', armEconomics(econ.with_skill), armEconomics(econ.baseline)),
  });
}

// Import one document. `p` is the file or directory the user named.
function importAnthropic(p, { from, importedAt, countErroredRuns = false } = {}) {
  if (!ANTHROPIC_TOOLS.includes(from)) refuse(`unknown import source "${from}"`);
  const file = findDocument(p, from);
  const bytes = fs.readFileSync(file);
  const receipt = from === 'claude-plugin-eval'
    ? importPluginEval(file, bytes, { importedAt, countErroredRuns })
    : importBenchmark(file, bytes, { importedAt });
  return { receipt, file };
}

module.exports = { importAnthropic, findDocument, ANTHROPIC_TOOLS, DOCUMENT_NAME, ImportRefused };
