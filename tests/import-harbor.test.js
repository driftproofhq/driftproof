// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 266 (issue 266): `driftproof import --from harbor`, spec 118 Layout B. Each criterion has a
// reader here that shares no code with lib/importers-harbor.js: the trial files are read again
// from disk and every figure is recomputed, and each reader is shown to fail a planted subject.
// The fixtures are real skill-placebo trials (tests/fixtures/harbor/skill-placebo/README.md);
// other negative inputs are copies of them, changed in a temporary directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const PROVE = path.join(ROOT, 'specs', '266-harbor-import', 'probes', 'prove.mjs');
const FIX = path.join(__dirname, 'fixtures', 'harbor');
const SP = path.join(FIX, 'skill-placebo');
const TRIALS = path.join(SP, 'trials');
const BASELINE = path.join(TRIALS, 'baseline');
const SKILL_ARMS = fs.readdirSync(TRIALS).filter((a) => a.startsWith('skill-')).sort();
const SAME_NAME = path.join(FIX, 'negative', 'same-name');
const AT = '2026-10-13T12:00:00.000Z';
const TOL = 1e-6;

const lib = () => require('../lib/importers-harbor');
const { RECEIPT_SCHEMA_VERSION, RUNNER_VERSION } = require('../config');
const { validateReceipt, verifyReceiptHash, sealReceipt, BAND_RULE } = require('../lib/receipt');
const { resolveCount } = require('../lib/counts');
const { registryStatus } = require('../lib/models');
const { inferProvider } = require('../lib/provider');

// ── the fixed texts (spec 266 AC-25), copied from the spec's table ──────────
const T = {
  pairing: 'the pairing is declared by the user: --with names the with-skill arm and --without the baseline; Harbor records neither',
  oneArm: 'one job is imported as the {arm} arm, declared by --arm; the other arm is empty and the comparison is null',
  keyOnly: 'scores are verifier_result.rewards.{key}, the only numeric reward key',
  keyNamed: 'scores are verifier_result.rewards.{key}, named by --reward',
  skillDeclared: 'skill.name is declared by --skill; Harbor records no skill name',
  skillUnknown: 'skill.name is unknown: Harbor records no skill name, and --skill was not given',
  agentDiffer: 'the arms\' settings (config without trial_name, trials_dir, job_id, task and source_trial; local paths compared by their sha256) differ at: {paths}',
  agentSame: 'the arms\' settings (config without trial_name, trials_dir, job_id, task and source_trial; local paths compared by their sha256) do not differ',
  exception: '{arm}: {n} trial(s) left out with exception type {type}',
  unfinished: '{arm}: {n} trial(s) left out with no finished_at time',
  noNumber: '{arm}: {n} trial(s) left out with no number under verifier_result.rewards.{key}',
  shares: 'the arms leave out different shares of their trials for an exception, no finished_at time or no reward (with-skill {count} of {count}, baseline {count} of {count}): the delta covers finished trials with a reward only, and a trial left out counts as neither a pass nor a failure',
  modelUsage: '{n} trial(s) record agent_result.model_usage under a model other than run.model_id; the economics count each trial\'s agent_result totals whole',
  emptyFolders: '{arm}: {n} trial folder(s) hold no result.json and were not read',
  jobLevel: '{n} job-level result.json file(s) were not read: no figure in this receipt comes from them',
  taskIds: '{n} task checksum(s) appear in both arms under different task_id values, so those tasks are not matched',
  labels: '{n} case(s) have a task name that is not a plain name; their label is left out',
  labelsDiffer: '{n} case(s) have trials that give different task names; their label is left out',
  noModel: 'no trial records a model: run.model_id is unknown',
  noDate: 'no trial records a started_at time: run.date_utc is null',
  economics: 'economics cover the matched cases only; a call is one trial, one agent episode that may make many model calls; n_input_tokens includes cached tokens; cost_usd is the agent\'s own estimate at list price',
  excludedCase: 'case "{id}" ({modes}): {reason}',
  noMatched: 'no usable matched case remains: the comparison is unavailable',
};
const DRAW = { exception: 'the trial raised {type} (exception_info); its reward is not read', unfinished: 'the trial records no finished_at time; its reward is not read', noNumber: 'the trial carries no number under verifier_result.rewards.{key}' };
const CASE_REASON = { missing: 'the arm has no measured result', allOut: 'every trial of this arm was left out; each is listed in excluded_draws', conflict: 'the admitted trials differ in verifier or timeout settings' };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SLOT = {
  arm: '(?:with-skill|baseline)',
  n: '[1-9][0-9]*',
  count: '(?:0|[1-9][0-9]*)',
  key: '[A-Za-z0-9_][A-Za-z0-9_-]{0,63}',
  type: '(?:[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*|unreadable)',
  paths: '(?:config\\.agent|(?:[A-Za-z0-9_][A-Za-z0-9_-]{0,63}|<key>)(?:\\.(?:[A-Za-z0-9_][A-Za-z0-9_-]{0,63}|<key>))*)(?:, (?:[A-Za-z0-9_][A-Za-z0-9_-]{0,63}|<key>)(?:\\.(?:[A-Za-z0-9_][A-Za-z0-9_-]{0,63}|<key>))*)*(?:, and [1-9][0-9]* more)?',
  id: 'task:[0-9a-f]{16}',
  modes: '(?:with_skill|baseline)(?:, (?:with_skill|baseline))?',
  reason: `(?:${Object.values(CASE_REASON).map(esc).join('|')})`,
};
const templateRe = (t) => new RegExp(`^${t.split(/(\{[a-z]+\})/).map((p) => (/^\{[a-z]+\}$/.test(p) ? SLOT[p.slice(1, -1)] : esc(p))).join('')}$`);
const NOTICE_RES = Object.values(T).map(templateRe);
const DRAW_RES = Object.values(DRAW).map(templateRe);
const fill = (t, slots) => t.replace(/\{([a-z]+)\}/g, (_, k) => String(slots[k]));
// A text whose one slot name recurs ({count}) takes its values in order.
const fillSeq = (t, name, values) => { let i = 0; return t.replace(new RegExp(`\\{${name}\\}`, 'g'), () => String(values[i++])); };

// ── the independent reader ──────────────────────────────────────────────────
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const caseId = (d) => 'task:' + sha256(JSON.stringify([sortKeys(d.task_id), d.task_checksum])).slice(0, 16);
const meanOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sdOf = (xs) => { if (xs.length < 2) return 0; const m = meanOf(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
const close = (a, b) => (a === null || b === null ? a === b : typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOL);
const ARM_LABEL = { with_skill: 'with-skill', baseline: 'baseline' };
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/;
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL = /^(?:~|file:\/\/|\/home\/|\/Users\/|\/root\/|[A-Za-z]:[\\/])/;

// A trial file sits one folder below a job, in the folder named for the trial (AC-22). The
// directory given is one job when one of its folders holds a trial result, else a folder of jobs.
// Nothing inside a trial folder is listed.
const dirsOf = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
function scanArm(dir) {
  const at = (...parts) => {
    const f = path.join(dir, ...parts, 'result.json');
    if (!fs.existsSync(f)) return null;
    const bytes = fs.readFileSync(f);
    return { rel: [...parts, 'result.json'].join('/'), folder: parts[parts.length - 1], bytes, doc: JSON.parse(bytes.toString('utf8')) };
  };
  const meta = { jobLevel: fs.existsSync(path.join(dir, 'result.json')) ? 1 : 0, empty: 0 };
  const top = dirsOf(dir).map((c) => ({ c, r: at(c) }));
  let trials;
  if (top.some((x) => x.r && typeof x.r.doc.trial_name === 'string')) {
    trials = top.filter((x) => x.r).map((x) => x.r);
    meta.empty = top.filter((x) => !x.r).length;
  } else {
    meta.jobLevel += top.filter((x) => x.r).length;
    trials = [];
    for (const { c } of top) for (const t of dirsOf(path.join(dir, c))) { const r = at(c, t); if (r) trials.push(r); else meta.empty++; }
  }
  return { trials: trials.sort((a, b) => byCodeUnit(a.rel, b.rel)), meta };
}
const readArm = (dir) => scanArm(dir).trials;

// A trial's settings (AC-23): its config without the fields that name the one trial, its job and
// its task; each local path stands as its own hash, so two paths stay two.
const PER_TRIAL = ['trial_name', 'trials_dir', 'job_id', 'task', 'source_trial'];
const normSettings = (v) => (Array.isArray(v) ? v.map(normSettings) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, normSettings(v[k])])) : typeof v === 'string' && LOCAL.test(v) ? `<local path ${sha256(v).slice(0, 12)}>` : v);
const settingsOf = (d) => { const c = d.config && typeof d.config === 'object' && !Array.isArray(d.config) ? { ...d.config } : d.config ?? null; if (c && typeof c === 'object') for (const k of PER_TRIAL) delete c[k]; return normSettings(c); };
const finished = (d) => typeof d.finished_at === 'string' && ISO.test(d.finished_at) && Number.isFinite(Date.parse(d.finished_at));
const seg = (k) => (/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(k) ? k : '<key>');
function diffPaths(a, b, p = '') {
  const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  // An absent object reads as an empty one, so the keys under it are named.
  if ((obj(a) || obj(b)) && (obj(a) || a === undefined) && (obj(b) || b === undefined)) {
    const x = a ?? {}; const y = b ?? {};
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => diffPaths(x[k], y[k], p ? `${p}.${seg(k)}` : seg(k)));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [p || 'config'];
}
const listPaths = (ps) => { const u = [...new Set(ps)].sort(byCodeUnit); return u.slice(0, 20).join(', ') + (u.length > 20 ? `, and ${u.length - 20} more` : ''); };

// Everything a receipt from these directories must say, worked out from the trial files alone.
function oracle({ withJob = null, withoutJob = null, reward = null, skill = null, arm = null }) {
  const comparative = !!(withJob && withoutJob);
  const scans = { with_skill: withJob ? scanArm(withJob) : null, baseline: withoutJob ? scanArm(withoutJob) : null };
  const modesRead = ['with_skill', 'baseline'].filter((m) => scans[m]);
  const cases = new Map();
  const all = [];
  for (const mode of modesRead) {
    for (const t of scans[mode].trials) {
      all.push({ ...t, mode });
      const id = caseId(t.doc);
      if (!cases.has(id)) cases.set(id, { id, names: new Set(), with_skill: [], baseline: [] });
      const c = cases.get(id);
      c.names.add(t.doc.task_name);
      c[mode].push(t);
    }
  }
  const numericKeys = new Set();
  for (const t of all) if (!t.doc.exception_info) for (const [k, v] of Object.entries(t.doc.verifier_result?.rewards || {})) if (typeof v === 'number') numericKeys.add(k);
  const key = reward ?? [...numericKeys][0];
  const conditions = (d) => JSON.stringify([d.verifier_environment_mode ?? null, d.config?.timeout_multiplier ?? null, d.config?.agent_timeout_multiplier ?? null, d.config?.verifier_timeout_multiplier ?? null, d.config?.agent_setup_timeout_multiplier ?? null, d.config?.environment_build_timeout_multiplier ?? null, sortKeys(d.config?.verifier ?? null), d.config?.agent?.override_timeout_sec ?? null, d.config?.agent?.max_timeout_sec ?? null]);
  const typeOf = (d) => { const x = d.exception_info.exception_type; return typeof x === 'string' && x.length <= 128 && CLASS_NAME.test(x) ? x : 'unreadable'; };
  for (const c of cases.values()) {
    c.label = c.names.size === 1 && typeof [...c.names][0] === 'string' && PLAIN.test([...c.names][0]) ? [...c.names][0] : null;
    c.unplain = c.label === null && c.names.size === 1;
    const admittedAll = [];
    for (const mode of ['with_skill', 'baseline']) {
      const rows = c[mode];
      c[mode] = { read: rows.length, samples: [], excluded: [], admitted: [] };
      rows.forEach((t, i) => {
        const d = t.doc;
        if (d.exception_info) { c[mode].excluded.push({ draw_index: i + 1, reason: fill(DRAW.exception, { type: typeOf(d) }), kind: 'exception', type: typeOf(d) }); return; }
        if (!finished(d)) { c[mode].excluded.push({ draw_index: i + 1, reason: DRAW.unfinished, kind: 'unfinished' }); return; }
        const v = d.verifier_result?.rewards?.[key];
        if (typeof v !== 'number') { c[mode].excluded.push({ draw_index: i + 1, reason: fill(DRAW.noNumber, { key }), kind: 'noNumber' }); return; }
        c[mode].samples.push(v);
        c[mode].admitted.push(d);
        admittedAll.push(d);
      });
    }
    // AC-3: across both arms, or within the one arm of a one-arm import.
    c.conflict = new Set(admittedAll.map(conditions)).size > 1;
  }
  const ordered = [...cases.values()].sort((a, b) => byCodeUnit(a.label ?? '', b.label ?? '') || byCodeUnit(a.id, b.id));
  // Which cases leave the aggregates, in case order, with the arms and the reason lib/receipt.js gives.
  const excludedCases = [];
  for (const c of ordered) {
    const modes = comparative ? ['with_skill', 'baseline'] : modesRead.filter((m) => c[m].read > 0);
    const unusable = modes.filter((m) => c[m].samples.length === 0);
    if (unusable.length) {
      const reason = unusable.some((m) => c[m].read > 0) ? CASE_REASON.allOut : CASE_REASON.missing;
      excludedCases.push({ id: c.id, modes: unusable, reason });
    } else if (c.conflict) excludedCases.push({ id: c.id, modes, reason: CASE_REASON.conflict });
    c.matched = !excludedCases.some((e) => e.id === c.id);
  }
  const included = ordered.filter((c) => c.matched);
  const agg = (mode) => {
    const means = included.filter((c) => c[mode].samples.length).map((c) => meanOf(c[mode].samples));
    return { case_count: means.length, mean: means.length ? meanOf(means) : null, sd: means.length < 2 ? null : sdOf(means) };
  };
  const aw = agg('with_skill'); const ab = agg('baseline');
  const econ = (mode) => {
    const ds = included.flatMap((c) => c[mode].admitted);
    const m = (k) => { const xs = ds.map((d) => d.agent_result?.[k]).filter((x) => typeof x === 'number' && Number.isFinite(x)); return xs.length ? meanOf(xs) : null; };
    return { call_count: ds.length, mean_input_tokens: m('n_input_tokens'), mean_output_tokens: m('n_output_tokens'), mean_cost_usd_per_call: m('cost_usd') };
  };
  const triples = all.map((t) => [ARM_LABEL[t.mode], t.rel, sha256(t.bytes)]).sort((a, b) => byCodeUnit(`${a[0]}/${a[1]}`, `${b[0]}/${b[1]}`));
  const starts = all.map((t) => t.doc.started_at).filter((s) => typeof s === 'string' && ISO.test(s) && Number.isFinite(Date.parse(s)));
  const firstStart = starts.slice().sort((a, b) => Date.parse(a) - Date.parse(b) || byCodeUnit(a, b))[0] ?? null;
  const agents = new Set(all.map((t) => JSON.stringify([t.doc.agent_info.name, t.doc.agent_info.version])));
  const models = new Set(all.map((t) => t.doc.agent_info.model_info?.name ?? null));
  const providers = new Set(all.map((t) => t.doc.agent_info.model_info?.provider ?? null));
  const model = [...models][0] ?? 'unknown';
  const provider = model === 'unknown' ? 'unknown' : providers.size === 1 && ['anthropic', 'openai'].includes([...providers][0]) ? [...providers][0] : inferProvider(model);
  const delta = comparative && aw.case_count && ab.case_count ? aw.mean - ab.mean : null;

  // The notices, as a list the receipt's must equal.
  const notices = [];
  notices.push(comparative ? T.pairing : fill(T.oneArm, { arm: ARM_LABEL[modesRead[0]] }));
  notices.push(fill(reward ? T.keyNamed : T.keyOnly, { key }));
  notices.push(skill ? T.skillDeclared : T.skillUnknown);
  if (comparative) {
    const ps = diffPaths(settingsOf(scans.with_skill.trials[0].doc), settingsOf(scans.baseline.trials[0].doc));
    notices.push(ps.length ? fill(T.agentDiffer, { paths: listPaths(ps) }) : T.agentSame);
  }
  // Left-out trials by arm: by exception type, by no finished_at, by no reward.
  const leftOut = {};
  for (const mode of modesRead) {
    const types = new Map();
    let unfinished = 0; let none = 0;
    for (const c of ordered) for (const e of c[mode].excluded) { if (e.kind === 'exception') types.set(e.type, (types.get(e.type) || 0) + 1); else if (e.kind === 'unfinished') unfinished++; else none++; }
    leftOut[mode] = [...types.values()].reduce((a, b) => a + b, 0) + unfinished + none;
    for (const ty of [...types.keys()].sort(byCodeUnit)) notices.push(fill(T.exception, { arm: ARM_LABEL[mode], n: types.get(ty), type: ty }));
    if (unfinished) notices.push(fill(T.unfinished, { arm: ARM_LABEL[mode], n: unfinished }));
    if (none) notices.push(fill(T.noNumber, { arm: ARM_LABEL[mode], n: none, key }));
    if (scans[mode].meta.empty) notices.push(fill(T.emptyFolders, { arm: ARM_LABEL[mode], n: scans[mode].meta.empty }));
  }
  // AC-26: the shares differ when kw/mw is not kb/mb, compared as whole numbers.
  if (comparative) {
    const mw = scans.with_skill.trials.length; const mb = scans.baseline.trials.length;
    if (leftOut.with_skill * mb !== leftOut.baseline * mw) notices.push(fillSeq(T.shares, 'count', [leftOut.with_skill, mw, leftOut.baseline, mb]));
  }
  const jobLevel = modesRead.reduce((n, m) => n + scans[m].meta.jobLevel, 0);
  if (jobLevel) notices.push(fill(T.jobLevel, { n: jobLevel }));
  if (comparative) {
    // Only a checksum whose task_id values in the two arms share none is unmatched.
    const ids = (m) => { const by = new Map(); for (const t of scans[m].trials) { const k = t.doc.task_checksum; if (!by.has(k)) by.set(k, new Set()); by.get(k).add(JSON.stringify(sortKeys(t.doc.task_id))); } return by; };
    const w = ids('with_skill'); const b = ids('baseline');
    const n = [...w.keys()].filter((k) => b.has(k) && ![...w.get(k)].some((x) => b.get(k).has(x))).length;
    if (n) notices.push(fill(T.taskIds, { n }));
  }
  const unplain = ordered.filter((c) => c.unplain).length;
  if (unplain) notices.push(fill(T.labels, { n: unplain }));
  const differ = ordered.filter((c) => c.names.size > 1).length;
  if (differ) notices.push(fill(T.labelsDiffer, { n: differ }));
  const otherModel = all.filter((t) => { const u = t.doc.agent_result?.model_usage; return u && typeof u === 'object' && !Array.isArray(u) && Object.keys(u).some((k) => k !== model); }).length;
  if (otherModel) notices.push(fill(T.modelUsage, { n: otherModel }));
  if (model === 'unknown') notices.push(T.noModel);
  if (firstStart === null) notices.push(T.noDate);
  notices.push(T.economics);
  for (const e of excludedCases) notices.push(fill(T.excludedCase, { id: JSON.stringify(e.id).slice(1, -1), modes: e.modes.join(', '), reason: e.reason }));
  if (comparative && delta === null) notices.push(T.noMatched);

  return {
    comparative, skill, reward: key, cases: ordered, included, excludedCases,
    agg: { with_skill: aw, baseline: ab },
    delta,
    deltaUnc: comparative && aw.sd !== null && ab.sd !== null ? Math.sqrt(aw.sd ** 2 + ab.sd ** 2) : null,
    econ: { with_skill: econ('with_skill'), baseline: econ('baseline') },
    sidecars: triples.map(([a, p, s]) => ({ file: `${a}/${p}`, sha256: s })),
    sourceSha: sha256(JSON.stringify(triples)),
    dateUtc: firstStart,
    harness: agents.size === 1 ? JSON.parse([...agents][0]) : null,
    model, provider, notices, arm,
    trials: all,
    admittedInDelta: included.reduce((n, c) => n + c.with_skill.samples.length + c.baseline.samples.length, 0),
    // AC-26: per arm, the trial files read and the trials whose rewards enter the delta.
    perArm: Object.fromEntries(modesRead.map((m) => [m, { read: scans[m].trials.length, inDelta: included.reduce((n, c) => n + c[m].samples.length, 0) }])),
  };
}

// The derivation table (AC-11). Every leaf of the receipt must match one rule; a leaf no rule
// covers is a problem. Each rule names where its value comes from.
function flatten(v, p = '', out = []) {
  if (Array.isArray(v)) { if (!v.length) out.push([p, v]); v.forEach((x, i) => flatten(x, `${p}[${i}]`, out)); return out; }
  if (v && typeof v === 'object') { const ks = Object.keys(v); if (!ks.length) out.push([p, v]); for (const k of ks) flatten(v[k], p ? `${p}.${k}` : k, out); return out; }
  out.push([p, v]);
  return out;
}
function trace(receipt, o) {
  const problems = [];
  const rows = receipt.results?.cases || [];
  const row = (p) => rows[Number(/^results\.cases\[(\d+)\]/.exec(p)[1])];
  const oc = (p) => { const r = row(p); return o.cases.find((c) => c.id === r.id); };
  const arm = (p) => { const r = row(p); const c = oc(p); return c && c[r.mode]; };
  const econArm = (p) => o.econ[/^economics\.(with_skill|baseline)/.exec(p)[1]];
  const aggArm = (p) => o.agg[/^results\.aggregates\.(with_skill|baseline)/.exec(p)[1]];
  const idx = (p, name) => Number(new RegExp(`${name}\\[(\\d+)\\]`).exec(p)[1]);
  const samplesOf = (mode) => rows.filter((r) => !mode || r.mode === mode).map((r) => (Array.isArray(r.samples) ? r.samples.length : 0));
  const R = [
    [/^schema_version$/, (v) => v === RECEIPT_SCHEMA_VERSION],
    [/^skill\.name$/, (v) => v === (o.skill ?? 'unknown')],
    [/^skill\.version$/, (v) => v === 'unknown'],
    [/^skill\.content_hash$/, (v) => v === null],
    [/^suite\.format$/, (v) => v === 'harbor/task'],
    [/^suite\.suite_hash$/, (v) => v === null],
    [/^suite\.case_count$/, (v) => v === o.cases.length],
    [/^run\.model_id$/, (v) => v === o.model],
    [/^run\.model_release_date$/, (v) => v === null],
    [/^run\.provider$/, (v) => v === o.provider],
    [/^run\.surface$/, (v) => v === 'external'],
    [/^run\.source$/, (v) => v === 'imported/harbor'],
    [/^run\.runner_version$/, (v) => v === RUNNER_VERSION],
    [/^run\.date_utc$/, (v) => v === o.dateUtc],
    [/^run\.registry$/, (v) => v === registryStatus(o.model)],
    [/^run\.transcripts$/, (v) => v === 'none'],
    [/^run\.judge\.temperature$/, (v) => v === null],
    [/^run\.judge\.sampling$/, (v) => v === 'external'],
    [/^run\.judge\.surface$/, (v) => v === 'external'],
    [/^run\.judge\.model_id$/, (v) => v === 'unknown'],
    [/^run\.judge\.prompt_template_hash$/, (v) => v === null],
    [/^run\.answered_by\.kind$/, (v) => v === 'external'],
    [/^run\.answered_by\.attested$/, (v) => v === false],
    [/^run\.answered_by\.(reported_model|reported_models)$/, (v) => v === null],
    [/^run\.answered_by\.isolation$/, (v) => v === 'none'],
    [/^run\.harness\.name$/, (v) => v === o.harness?.[0]],
    [/^run\.harness\.version$/, (v) => v === o.harness?.[1]],
    [/^run\.import\.tool$/, (v) => v === 'harbor'],
    [/^run\.import\.format$/, (v) => v === 'result.json'],
    [/^run\.import\.format_version$/, (v) => v === null],
    [/^run\.import\.source_sha256$/, (v) => v === o.sourceSha],
    [/^run\.import\.imported_at$/, (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)],
    [/^run\.import\.comparison_method$/, (v) => v === 'matched-measured-cases/1'],
    [/^run\.import\.sidecars\[(\d+)\]\.(file|sha256)$/, (v, p) => { const [, i, k] = /\[(\d+)\]\.(\w+)$/.exec(p); return o.sidecars[Number(i)]?.[k] === v; }],
    // AC-25: a notice is one of the fixed texts; the whole list is compared below.
    [/^run\.import\.notices\[\d+\]$/, (v) => typeof v === 'string' && NOTICE_RES.some((re) => re.test(v))],
    // AC-7: a count at run or arm scope holds for every row it covers.
    [/^run\.counts\.generations_per_arm$/, (v) => samplesOf(null).every((n) => n === v)],
    [/^run\.arms\.(with_skill|baseline)\.counts\.generations_per_arm$/, (v, p) => samplesOf(/arms\.(\w+)\./.exec(p)[1]).every((n) => n === v)],
    [/^results\.cases\[\d+\]\.id$/, (v, p) => !!oc(p)],
    [/^results\.cases\[\d+\]\.mode$/, (v, p) => ['with_skill', 'baseline'].includes(v) && !!arm(p) && arm(p).read > 0],
    [/^results\.cases\[\d+\]\.label$/, (v, p) => oc(p)?.label === v],
    [/^results\.cases\[\d+\]\.case_status$/, (v, p) => v === 'no_observations' && arm(p)?.samples.length === 0],
    [/^results\.cases\[\d+\]\.outcome$/, (v, p) => v === 'score' && arm(p)?.samples.length > 0],
    [/^results\.cases\[\d+\]\.(score|mean)$/, (v, p) => close(v, meanOf(arm(p).samples))],
    [/^results\.cases\[\d+\]\.stddev$/, (v, p) => close(v, sdOf(arm(p).samples))],
    [/^results\.cases\[\d+\]\.samples\[(\d+)\]$/, (v, p) => close(v, arm(p).samples[idx(p, 'samples')])],
    [/^results\.cases\[\d+\]\.samples$/, (v, p) => Array.isArray(v) && v.length === 0 && arm(p)?.samples.length === 0],
    [/^results\.cases\[\d+\]\.threshold$/, (v) => v === null],
    [/^results\.cases\[\d+\]\.judge\.model_id$/, (v) => v === 'unknown'],
    [/^results\.cases\[\d+\]\.judge\.rubric_hash$/, (v) => v === null],
    [/^results\.cases\[\d+\]\.counts\.generations_per_arm$/, (v, p) => v === arm(p).samples.length],
    // AC-7, AC-25: each left-out trial in its own place, its reason the fixed text.
    [/^results\.cases\[\d+\]\.excluded_draws\[\d+\]\.draw_index$/, (v, p) => arm(p).excluded[idx(p, 'excluded_draws')]?.draw_index === v],
    [/^results\.cases\[\d+\]\.excluded_draws\[\d+\]\.reason$/, (v, p) => DRAW_RES.some((re) => re.test(v)) && arm(p).excluded[idx(p, 'excluded_draws')]?.reason === v],
    [/^results\.aggregates\.band_rule$/, (v) => v === BAND_RULE],
    [/^results\.aggregates\.(with_skill|baseline)\.case_count$/, (v, p) => v === aggArm(p).case_count],
    [/^results\.aggregates\.(with_skill|baseline)\.(pass_count|borderline_count)$/, (v) => v === 0],
    [/^results\.aggregates\.(with_skill|baseline)\.mean_score$/, (v, p) => close(v, aggArm(p).mean)],
    [/^results\.aggregates\.(with_skill|baseline)\.stddev$/, (v, p) => close(v, aggArm(p).sd)],
    [/^results\.aggregates\.excluded_cases\[\d+\]\.id$/, (v, p) => o.excludedCases[idx(p, 'excluded_cases')]?.id === v],
    [/^results\.aggregates\.excluded_cases\[\d+\]\.modes\[\d+\]$/, (v, p) => o.excludedCases[idx(p, 'excluded_cases')]?.modes[idx(p, 'modes')] === v],
    [/^results\.aggregates\.excluded_cases\[\d+\]\.reason$/, (v, p) => o.excludedCases[idx(p, 'excluded_cases')]?.reason === v],
    [/^comparison\.with_skill_score$/, (v) => close(v, o.agg.with_skill.mean)],
    [/^comparison\.baseline_score$/, (v) => close(v, o.agg.baseline.mean)],
    [/^comparison\.delta$/, (v) => close(v, o.delta)],
    [/^comparison\.delta_uncertainty$/, (v) => close(v, o.deltaUnc)],
    [/^comparison\.delta_uncertainty_unavailable$/, (v) => v === (o.agg.with_skill.case_count === 0 || o.agg.baseline.case_count === 0 ? 'no_cases' : 'single_case') && o.deltaUnc === null],
    [/^verification_level$/, (v) => v === 'DECLARED'],
    [/^economics\.basis$/, (v) => v === 'source-list-price-estimate'],
    [/^economics\.(with_skill|baseline)\.call_count$/, (v, p) => v === econArm(p).call_count],
    [/^economics\.(with_skill|baseline)\.(mean_input_tokens|mean_output_tokens|mean_cost_usd_per_call)$/, (v, p) => close(v, econArm(p)[p.split('.').pop()])],
    [/^economics\.(with_skill|baseline)\.(median_wall_ms|wall_ms_p25|wall_ms_p75|wall_ms_iqr)$/, (v) => v === null],
    [/^economics\.skill_incremental_cost_usd_per_call$/, (v) => close(v, o.econ.with_skill.mean_cost_usd_per_call !== null && o.econ.baseline.mean_cost_usd_per_call !== null ? o.econ.with_skill.mean_cost_usd_per_call - o.econ.baseline.mean_cost_usd_per_call : null)],
    [/^economics\.skill_incremental_cost_usd_per_1k_calls$/, (v) => (v === null ? receipt.economics.skill_incremental_cost_usd_per_call === null : Math.abs(v - receipt.economics.skill_incremental_cost_usd_per_call * 1000) <= 1e-3)],
    [/^economics\.output_tokens_delta$/, (v) => (o.econ.with_skill.mean_output_tokens !== null && o.econ.baseline.mean_output_tokens !== null ? Math.abs(v - (o.econ.with_skill.mean_output_tokens - o.econ.baseline.mean_output_tokens)) <= 0.01 : v === null)],
    [/^economics\.median_wall_ms_delta$/, (v) => v === null],
    [/^economics\.judge_excluded$/, (v) => v === true],
    [/^receipt_hash$/, () => verifyReceiptHash(receipt)],
  ];
  for (const [p, v] of flatten(receipt)) {
    const rule = R.find(([re]) => re.test(p));
    if (!rule) { problems.push(`no rule derives ${p}`); continue; }
    let ok = false;
    try { ok = rule[1](v, p); } catch (_e) { ok = false; }
    if (!ok) problems.push(`${p} = ${JSON.stringify(v)} does not follow from the trial files`);
  }
  // Whole-receipt rules: every case and arm read has its row, in label-then-id order, with-skill first.
  const want = o.cases.flatMap((c) => ['with_skill', 'baseline'].filter((m) => c[m].read > 0).map((m) => `${c.id}|${m}`));
  const got = rows.map((r) => `${r.id}|${r.mode}`);
  if (JSON.stringify(want) !== JSON.stringify(got)) problems.push(`rows ${JSON.stringify(got)} are not the cases read, in order ${JSON.stringify(want)}`);
  // Every unmatched case is listed in excluded_cases; every count is samples length.
  const listed = receipt.results?.aggregates?.excluded_cases || [];
  if (listed.length !== o.excludedCases.length) problems.push(`${listed.length} cases in excluded_cases; the trial files leave out ${o.excludedCases.length}`);
  rows.forEach((r, i) => {
    const a = o.cases.find((c) => c.id === r.id)?.[r.mode];
    if (!a) return;
    const n = resolveCount(receipt, i, 'generations_per_arm');
    if (n !== a.samples.length) problems.push(`case ${r.id} ${r.mode}: generations_per_arm ${n} is not its ${a.samples.length} admitted trials`);
    if (n !== a.read - (r.excluded_draws || []).length) problems.push(`case ${r.id} ${r.mode}: ${n} draws are not ${a.read} trials minus the listed exclusions`);
    if (r.samples && r.samples.length !== n) problems.push(`case ${r.id} ${r.mode}: ${r.samples.length} samples for ${n} draws`);
    if ((r.excluded_draws || []).length !== a.excluded.length) problems.push(`case ${r.id} ${r.mode}: ${a.excluded.length} trials left out, ${(r.excluded_draws || []).length} listed`);
  });
  if ((receipt.run?.import?.sidecars || []).length !== o.sidecars.length) problems.push('the sidecars do not list every trial file read');
  // AC-25: the notices are the recomputed list, no more and no fewer.
  const gotNotices = (receipt.run?.import?.notices || []).slice().sort(byCodeUnit);
  const wantNotices = o.notices.slice().sort(byCodeUnit);
  if (JSON.stringify(gotNotices) !== JSON.stringify(wantNotices)) problems.push(`notices ${JSON.stringify(gotNotices)} are not ${JSON.stringify(wantNotices)}`);
  return problems;
}

// Text a receipt must never carry (AC-14): the source's local paths, read from the trial files.
function localPaths(receipt, o) {
  const text = JSON.stringify(receipt);
  const hits = [];
  for (const t of o.trials) {
    const d = t.doc;
    for (const s of [d.task_id?.path, d.trial_uri, d.config?.trials_dir, ...(d.config?.environment?.mounts || []).map((m) => m.source), d.exception_info?.exception_message, d.exception_info?.exception_traceback]) {
      if (typeof s === 'string' && s.length > 3 && text.includes(JSON.stringify(s).slice(1, -1))) hits.push(s);
    }
  }
  for (const re of [/~\//, /\/home\//, /\/Users\//, /file:\/\//]) if (re.test(text)) hits.push(String(re));
  return [...new Set(hits)];
}

// ── temporary copies ────────────────────────────────────────────────────────
const temps = [];
function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dp266-')); temps.push(d); return d; }
test.after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
// A copy of an arm, keeping only the job directories whose name ends with one of `tasks`.
function copyArm(src, tasks = null) {
  const dst = path.join(tmp(), path.basename(src));
  fs.mkdirSync(dst);
  for (const job of fs.readdirSync(src).sort().reverse()) {
    if (tasks && !tasks.some((t) => job.endsWith(`__${t}`))) continue;
    fs.cpSync(path.join(src, job), path.join(dst, job), { recursive: true });
  }
  return dst;
}
// Rewrite the trials of `dir` that `pick` selects (by doc and relative path) with `edit`.
function editTrials(dir, pick, edit, { raw = null } = {}) {
  let n = 0;
  for (const t of readArm(dir)) {
    if (!pick(t.doc, t.rel)) continue;
    const f = path.join(dir, ...t.rel.split('/'));
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    edit(doc);
    let text = JSON.stringify(doc, null, 4);
    if (raw) text = raw(text);
    fs.writeFileSync(f, text);
    n++;
  }
  assert.ok(n > 0, 'the plant changed no trial');
  return n;
}
const first = (task) => { let done = false; return (d) => { if (done || d.task_name !== task) return false; done = true; return true; }; };
const every = () => true;

function cli(args, { nodeArgs = [], out = null } = {}) {
  const dir = out || tmp();
  const r = spawnSync(process.execPath, [...nodeArgs, BIN, 'import', ...args, '--out', dir], { encoding: 'utf8', cwd: tmp(), env: { PATH: process.env.PATH, HOME: tmp(), TMPDIR: os.tmpdir() } });
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return { ...r, out: dir, files, receipt: files.length === 1 ? JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8')) : null };
}
// A refusal must be reached through the exported function and through the CLI (AC-13).
function refusedBoth(opts, args, pattern, { nodeArgs = [] } = {}) {
  const { importHarbor, HarborRefused } = lib();
  let message = null;
  assert.throws(() => importHarbor({ importedAt: AT, ...opts }), (e) => { message = e.message; return e instanceof HarborRefused && pattern.test(e.message); });
  const r = cli(args, { nodeArgs });
  assert.equal(r.status, 1, `the CLI exits 1 on a refusal: ${r.stderr}`);
  assert.match(r.stderr, pattern);
  assert.deepEqual(r.files, [], 'a refused import writes nothing');
  return { message, stderr: r.stderr };
}
const pairArgs = (w, b, more = []) => ['--from', 'harbor', '--with', w, '--without', b, ...more];
const importPair = (withJob, withoutJob, more = {}) => lib().importHarbor({ withJob, withoutJob, importedAt: AT, ...more }).receipt;
const strip = (r) => { const c = structuredClone(r); delete c.receipt_hash; delete c.run.import.imported_at; return c; };
const doctor = (r, fn) => { const c = structuredClone(r); fn(c); return c; };
const jobOf = (arm, task) => fs.readdirSync(arm).sort().find((j) => j.endsWith(`__${task}`));

// ── the fixtures are the source's bytes ─────────────────────────────────────
test('fixtures: every file is the pinned commit\'s blob, the licence is beside them, nine skill arms and a baseline', () => {
  const src = JSON.parse(fs.readFileSync(path.join(SP, 'SOURCES.json'), 'utf8'));
  assert.equal(src.license, 'MIT');
  for (const f of src.files) {
    const b = fs.readFileSync(path.join(SP, ...f.file.split('/')));
    const blob = crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
    assert.equal(blob, f.git_blob_sha1, `${f.file} is not the source's bytes`);
  }
  assert.ok(src.files.some((f) => f.file === 'LICENSE'));
  assert.equal(SKILL_ARMS.length, 9);
  const listed = new Set(src.files.map((f) => f.file));
  for (const a of ['baseline', ...SKILL_ARMS]) for (const t of readArm(path.join(TRIALS, a))) assert.ok(listed.has(`trials/${a}/${t.rel}`), `${a}/${t.rel} is not in SOURCES.json`);
  // Plant: a byte changed in a copy no longer matches its recorded blob.
  const f = src.files.find((x) => x.file.endsWith('result.json'));
  const b = Buffer.concat([fs.readFileSync(path.join(SP, ...f.file.split('/'))), Buffer.from(' ')]);
  assert.notEqual(crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'), f.git_blob_sha1);
});

// ── AC-7, AC-11, AC-19, AC-25: nine pairs, every value traced ───────────────
test('AC-7, AC-11, AC-19, AC-25: each of the nine skill arms with the baseline gives a valid two-arm receipt every value of which follows from the trials', () => {
  for (const a of SKILL_ARMS) {
    const withJob = path.join(TRIALS, a);
    const receipt = importPair(withJob, BASELINE);
    const v = validateReceipt(receipt);
    assert.ok(v.valid, `${a}: ${JSON.stringify(v.errors)}`);
    assert.ok(verifyReceiptHash(receipt), `${a}: the hash does not verify`);
    const o = oracle({ withJob, withoutJob: BASELINE });
    assert.deepEqual(trace(receipt, o), [], a);
    assert.ok(receipt.results.cases.some((c) => c.mode === 'with_skill') && receipt.results.cases.some((c) => c.mode === 'baseline'), `${a}: two arms`);
  }
});

test('AC-11: the derivation table fails a planted extra field, a changed value and a moved field', () => {
  const withJob = path.join(TRIALS, SKILL_ARMS[0]);
  const receipt = importPair(withJob, BASELINE);
  const o = oracle({ withJob, withoutJob: BASELINE });
  assert.deepEqual(trace(receipt, o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.run.import.lift = 0.2; }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.results.cases[0].samples[0] = 1 - r.results.cases[0].samples[0]; }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.run.source_delta = r.comparison.delta; delete r.comparison.delta; }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.run.date_utc = r.run.import.imported_at; }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.results.aggregates.band_rule = 'any band'; }), o), []);
});

test('AC-25: a notice or a reason outside the fixed texts, or a missing notice, fails the reader', () => {
  const withJob = path.join(TRIALS, 'skill-planning-with-files');
  const receipt = importPair(withJob, BASELINE);
  const o = oracle({ withJob, withoutJob: BASELINE });
  assert.deepEqual(trace(receipt, o), []);
  for (const n of receipt.run.import.notices) assert.ok(NOTICE_RES.some((re) => re.test(n)), `a notice outside the fixed texts: ${n}`);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.run.import.notices.push('source reports mean 0.99, cost 999'); }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.run.import.notices.push('the skill helps, with 95% confidence'); }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.run.import.notices.pop(); }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.results.cases.find((c) => c.excluded_draws).excluded_draws[0].reason = 'left out: the source scored it 1'; }), o), []);
  const pair = (() => { const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']); const b = copyArm(BASELINE, ['django__django-13512']); return [w, b]; })();
  const none = importPair(...pair);
  const on = oracle({ withJob: pair[0], withoutJob: pair[1] });
  assert.deepEqual(trace(none, on), []);
  assert.notDeepEqual(trace(doctor(none, (r) => { r.results.aggregates.excluded_cases[0].reason = 'the skill broke this task'; }), on), []);
});

test('AC-7: a count off by one at any scope, a sample dropped without a listing, or a draw index repeated fails the reader', () => {
  const withJob = path.join(TRIALS, 'skill-planning-with-files');
  const receipt = importPair(withJob, BASELINE);
  const o = oracle({ withJob, withoutJob: BASELINE });
  assert.deepEqual(trace(receipt, o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.results.cases.forEach((c) => { c.counts = { generations_per_arm: 3 }; }); delete r.run.counts; delete r.run.arms; }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { const c = r.results.cases.find((x) => x.samples && x.samples.length > 1); c.samples.pop(); }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.economics.with_skill.call_count += 1; }), o), []);
  // Run scope: every row carries its own true count, and the run-scope figure is wrong.
  const caveman = path.join(TRIALS, 'skill-caveman');
  const even = importPair(caveman, BASELINE);
  const oe = oracle({ withJob: caveman, withoutJob: BASELINE });
  assert.deepEqual(trace(even, oe), []);
  const n = even.results.cases[0].samples.length;
  assert.notDeepEqual(trace(doctor(even, (r) => { r.results.cases.forEach((c) => { c.counts = { generations_per_arm: c.samples.length }; }); r.run.counts = { generations_per_arm: n + 5 }; }), oe), []);
  assert.notDeepEqual(trace(doctor(even, (r) => { r.results.cases.forEach((c) => { c.counts = { generations_per_arm: c.samples.length }; }); r.run.arms = { baseline: { counts: { generations_per_arm: n + 5 } } }; }), oe), []);
  // Two trials of one case left out: the indexes 1 and 2, never 1 twice.
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug', 'django__django-13512']);
  const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  editTrials(b, (d) => d.task_name === 'application-debug', (d) => { d.verifier_result = null; });
  const two = importPair(w, b);
  const ot = oracle({ withJob: w, withoutJob: b });
  assert.deepEqual(trace(two, ot), []);
  const row = two.results.cases.find((c) => c.label === 'application-debug' && c.mode === 'baseline');
  assert.deepEqual(row.excluded_draws.map((e) => e.draw_index), [1, 2]);
  assert.notDeepEqual(trace(doctor(two, (r) => { r.results.cases.find((c) => c.label === 'application-debug' && c.mode === 'baseline').excluded_draws[1].draw_index = 1; }), ot), []);
});

test('AC-19: economics are the admitted trials\' agent_result means over the matched cases; a doctored mean fails the reader', () => {
  const withJob = path.join(TRIALS, 'skill-caveman');
  const receipt = importPair(withJob, BASELINE);
  const o = oracle({ withJob, withoutJob: BASELINE });
  for (const m of ['with_skill', 'baseline']) {
    assert.ok(typeof receipt.economics[m].mean_input_tokens === 'number');
    assert.ok(typeof receipt.economics[m].mean_cost_usd_per_call === 'number');
  }
  assert.ok(receipt.run.import.notices.includes(T.economics));
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.economics.baseline.mean_output_tokens += 1; }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.economics.with_skill.median_wall_ms = 1000; }), o), []);
});

test('AC-19: a task only the with-skill job ran adds nothing to the economics', () => {
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug', 'django__django-13512', 'django__django-15957']);
  const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  const receipt = importPair(w, b);
  const o = oracle({ withJob: w, withoutJob: b });
  assert.deepEqual(trace(receipt, o), []);
  const all = readArm(w).filter((t) => !t.doc.exception_info).map((t) => t.doc.agent_result.cost_usd);
  const matched = readArm(w).filter((t) => !t.doc.exception_info && t.doc.task_name !== 'django__django-15957').map((t) => t.doc.agent_result.cost_usd);
  assert.equal(receipt.economics.with_skill.call_count, matched.length);
  assert.ok(close(receipt.economics.with_skill.mean_cost_usd_per_call, meanOf(matched)));
  assert.ok(!close(meanOf(all), meanOf(matched)), 'the plant moves the all-trials mean');
  // Plant: the means taken over every admitted trial fail the reader.
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.economics.with_skill.call_count = all.length; r.economics.with_skill.mean_cost_usd_per_call = meanOf(all); }), o), []);
});

// ── AC-1: case identity ─────────────────────────────────────────────────────
test('AC-1: two tasks sharing a name never merge (hand-made negative case)', () => {
  const withJob = path.join(SAME_NAME, 'with'); const withoutJob = path.join(SAME_NAME, 'without');
  const receipt = importPair(withJob, withoutJob);
  const o = oracle({ withJob, withoutJob });
  assert.deepEqual(trace(receipt, o), []);
  const ids = new Set(receipt.results.cases.map((c) => c.id));
  assert.equal(ids.size, 2, 'two tasks, two cases');
  assert.ok(receipt.results.cases.every((c) => c.label === 'shared-name'));
  assert.equal(receipt.results.aggregates.with_skill.case_count, 1, 'only the task in both jobs is matched');
  assert.ok(close(receipt.comparison.delta, -1));
  // Plant: the same rows keyed by name read as one matched case with another delta.
  const merged = doctor(receipt, (r) => { r.results.cases.forEach((c) => { c.id = c.label; }); });
  assert.notDeepEqual(trace(merged, o), []);
});

test('AC-1: a changed checksum, or a changed task_id with the same checksum, is another task; the second is named in a notice', () => {
  for (const [edit, noticed] of [[(d) => { d.task_checksum = '0'.repeat(64); }, false], [(d) => { d.task_id = { path: 'tasks/elsewhere/application-debug' }; }, true]]) {
    const w = copyArm(path.join(TRIALS, 'skill-karpathy'), ['application-debug', 'django__django-13512']);
    const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
    editTrials(w, (d) => d.task_name === 'application-debug', edit);
    const receipt = importPair(w, b);
    assert.deepEqual(trace(receipt, oracle({ withJob: w, withoutJob: b })), []);
    assert.equal(new Set(receipt.results.cases.map((c) => c.id)).size, 3);
    assert.equal(receipt.results.aggregates.baseline.case_count, 1);
    assert.equal(receipt.run.import.notices.includes(fill(T.taskIds, { n: 1 })), noticed);
  }
});

test('AC-1: a checksum whose arms still share one task_id is matched and not counted in the notice', () => {
  const w = copyArm(path.join(TRIALS, 'skill-karpathy'), ['application-debug', 'django__django-13512']);
  const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  editTrials(w, first('application-debug'), (d) => { d.task_id = { path: 'tasks/elsewhere/application-debug' }; });
  const receipt = importPair(w, b);
  assert.deepEqual(trace(receipt, oracle({ withJob: w, withoutJob: b })), []);
  assert.equal(receipt.results.aggregates.baseline.case_count, 2, 'the task is still matched through the shared task_id');
  assert.ok(!receipt.run.import.notices.some((n) => templateRe(T.taskIds).test(n)), JSON.stringify(receipt.run.import.notices));
});

test('AC-1, AC-13: two case keys that give one id are refused through both paths', () => {
  // The sha256 forced to one value for every case key, in this process and in the CLI's.
  const preload = path.join(tmp(), 'collide.js');
  fs.writeFileSync(preload, `'use strict';
const crypto = require('node:crypto');
const real = crypto.createHash;
crypto.createHash = function (alg) {
  const h = real.call(crypto, alg); let head = null;
  const w = { update(d, e) { if (head === null) head = Buffer.isBuffer(d) ? '' : String(d); h.update(d, e); return w; }, digest(e) { return head && head.startsWith('[{') ? '0'.repeat(64) : h.digest(e); } };
  return w;
};
`);
  const w = copyArm(path.join(TRIALS, 'skill-karpathy'), ['application-debug', 'django__django-13512']);
  const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  const real = crypto.createHash;
  require(preload);
  const patched = crypto.createHash;
  crypto.createHash = real;
  const { importHarbor, HarborRefused } = lib();
  crypto.createHash = patched;
  try {
    assert.throws(() => importHarbor({ withJob: w, withoutJob: b, importedAt: AT }), (e) => e instanceof HarborRefused && /one case id/.test(e.message));
  } finally { crypto.createHash = real; }
  const r = cli(pairArgs(w, b), { nodeArgs: ['--require', preload] });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /one case id/);
  assert.deepEqual(r.files, []);
});

// ── AC-2: one harness, one model ────────────────────────────────────────────
test('AC-2: run.harness is the trials\' agent and version and run.model_id is claude-opus-5-5', () => {
  const receipt = importPair(path.join(TRIALS, 'skill-superpowers'), BASELINE);
  const versions = new Set([...readArm(path.join(TRIALS, 'skill-superpowers')), ...readArm(BASELINE)].map((t) => t.doc.agent_info.version));
  assert.equal(versions.size, 1);
  assert.deepEqual(receipt.run.harness, { name: 'claude-code', version: [...versions][0] });
  assert.equal(receipt.run.model_id, 'claude-opus-5-5');
  assert.equal(receipt.run.provider, 'anthropic');
});

test('AC-2, AC-13: a second harness version, a second model, or a missing model beside a named one is refused through both paths, naming both values', () => {
  const plants = [
    [(d) => { d.agent_info.version = '2.1.283'; }, /"claude-code 2\.1\.282" and "claude-code 2\.1\.283"/],
    [(d) => { d.agent_info.model_info.name = 'claude-sonnet-5-5'; }, /"claude-opus-5-5" and "claude-sonnet-5-5"/],
    [(d) => { d.agent_info.model_info = null; }, /"claude-opus-5-5" and none/],
  ];
  for (const [edit, pattern] of plants) {
    const w = copyArm(path.join(TRIALS, 'skill-ponytail'), ['application-debug']);
    const b = copyArm(BASELINE, ['application-debug']);
    editTrials(b, first('application-debug'), edit);
    refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), pattern);
  }
});

test('AC-2: a trial whose model_usage names a model other than run.model_id is counted in a notice', () => {
  const w = copyArm(path.join(TRIALS, 'skill-ponytail'), ['application-debug', 'django__django-13512']);
  const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  const clean = importPair(w, b);
  assert.ok(!clean.run.import.notices.some((n) => n.includes('model_usage')), 'the fixtures name one model');
  editTrials(w, first('application-debug'), (d) => { d.agent_result.model_usage['claude-haiku-5-5'] = { n_input_tokens: 10, n_cache_tokens: 0, n_output_tokens: 5, cost_usd: 0.01 }; });
  const receipt = importPair(w, b);
  assert.deepEqual(trace(receipt, oracle({ withJob: w, withoutJob: b })), []);
  assert.ok(receipt.run.import.notices.includes(fill(T.modelUsage, { n: 1 })), JSON.stringify(receipt.run.import.notices));
  assert.ok(!JSON.stringify(receipt).includes('claude-haiku-5-5'), 'the other model\'s name is not copied');
});

// ── AC-3: one grading rule ──────────────────────────────────────────────────
test('AC-3: several numeric reward keys need --reward; an absent --reward key is refused; the key chosen is a notice', () => {
  const w = copyArm(path.join(TRIALS, 'skill-mattpocock'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  editTrials(b, first('application-debug'), (d) => { d.verifier_result.rewards.partial = 0.5; });
  refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), /partial/);
  refusedBoth({ withJob: w, withoutJob: b, reward: 'absent' }, pairArgs(w, b, ['--reward', 'absent']), /absent/);
  const receipt = importPair(w, b, { reward: 'reward' });
  assert.deepEqual(trace(receipt, oracle({ withJob: w, withoutJob: b, reward: 'reward' })), []);
  assert.ok(receipt.run.import.notices.includes(fill(T.keyNamed, { key: 'reward' })), 'the reward key is a notice');
});

test('AC-3: a case whose admitted trials differ in verifier mode or timeouts leaves both aggregates', () => {
  const edits = [
    // verifier_environment_mode is not a setting (AC-23), so one trial may differ.
    [first('application-debug'), (d) => { d.verifier_environment_mode = 'separate'; }],
    // The config fields are settings, so they are changed on the whole arm (AC-23).
    [every, (d) => { d.config.timeout_multiplier = 2.0; }],
    [every, (d) => { d.config.verifier = { ...d.config.verifier, override_timeout_sec: 60 }; }],
    [every, (d) => { d.config.agent.override_timeout_sec = 3600; }],
    [every, (d) => { d.config.agent.max_timeout_sec = 3600; }],
    [every, (d) => { d.config.agent_setup_timeout_multiplier = 4.0; }],
    [every, (d) => { d.config.environment_build_timeout_multiplier = 3.0; }],
  ];
  for (const [pick, edit] of edits) {
    const w = copyArm(path.join(TRIALS, 'skill-i-have-adhd'), ['application-debug', 'django__django-13512']);
    const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
    editTrials(w, pick, edit);
    const receipt = importPair(w, b);
    const o = oracle({ withJob: w, withoutJob: b });
    assert.deepEqual(trace(receipt, o), []);
    const id = o.cases.find((c) => c.label === 'application-debug').id;
    const ex = receipt.results.aggregates.excluded_cases.find((e) => e.id === id);
    assert.ok(ex && ex.modes.length === 2 && ex.reason === CASE_REASON.conflict, 'both arms are left out, for that reason');
    assert.ok(receipt.results.cases.filter((c) => c.id === id).length === 2, 'the rows stay in results.cases');
  }
});

test('AC-3, AC-16: in a one-arm import a case whose trials differ in verifier mode leaves the arm\'s aggregate', () => {
  const j = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  editTrials(j, first('application-debug'), (d) => { d.verifier_environment_mode = 'separate'; });
  const receipt = lib().importHarbor({ job: j, arm: 'baseline', importedAt: AT }).receipt;
  assert.ok(validateReceipt(receipt).valid, JSON.stringify(validateReceipt(receipt).errors));
  const o = oracle({ withoutJob: j, arm: 'baseline' });
  assert.deepEqual(trace(receipt, o), []);
  const id = o.cases.find((c) => c.label === 'application-debug').id;
  const ex = (receipt.results.aggregates.excluded_cases || []).find((e) => e.id === id);
  assert.ok(ex && ex.reason === CASE_REASON.conflict && JSON.stringify(ex.modes) === '["baseline"]', JSON.stringify(receipt.results.aggregates));
  assert.equal(receipt.results.aggregates.baseline.case_count, 1);
});

// ── AC-4: reward range ──────────────────────────────────────────────────────
test('AC-4: a reward outside 0 to 1, or not finite, is refused naming the trial and the value, never its absolute path', () => {
  for (const [edit, raw, pattern] of [
    [(d) => { d.verifier_result.rewards.reward = 1.5; }, null, /1\.5/],
    [(d) => { d.verifier_result.rewards.reward = -0.1; }, null, /-0\.1/],
    [(d) => { d.verifier_result.rewards.reward = 7; }, (t) => t.replace('"reward": 7', '"reward": 1e400'), /Infinity|1e400|finite/],
  ]) {
    const w = copyArm(path.join(TRIALS, 'skill-agent-skills'), ['application-debug']);
    const b = copyArm(BASELINE, ['application-debug']);
    editTrials(b, first('application-debug'), edit, { raw });
    const { message, stderr } = refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), pattern);
    assert.match(stderr, /baseline\/b0\d-\d{4}__claude-code__baseline__application-debug\/application-debug__\w+\/result\.json/, 'the refusal names the trial by its job-relative path');
    for (const text of [message, stderr]) assert.ok(!text.includes(path.dirname(b)) && !text.includes(os.tmpdir()), 'the refusal names no absolute path');
  }
});

test('AC-4: a reward that is not a number, or no verifier result, is left out and listed', () => {
  for (const edit of [(d) => { d.verifier_result.rewards.reward = '1'; }, (d) => { d.verifier_result = null; }]) {
    const w = copyArm(path.join(TRIALS, 'skill-agent-skills'), ['application-debug', 'django__django-13512']);
    const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
    editTrials(b, first('application-debug'), edit);
    const receipt = importPair(w, b);
    const o = oracle({ withJob: w, withoutJob: b });
    assert.deepEqual(trace(receipt, o), []);
    const row = receipt.results.cases.find((c) => c.label === 'application-debug' && c.mode === 'baseline');
    assert.equal(row.excluded_draws.length, 1);
    assert.equal(row.samples.length, 1);
  }
});

// ── AC-5: exceptions ────────────────────────────────────────────────────────
test('AC-5: the AgentTimeoutError trial is left out whatever its reward, listed with its type, and counted in a notice', () => {
  const withJob = path.join(TRIALS, 'skill-planning-with-files');
  const timedOut = readArm(withJob).find((t) => t.doc.exception_info);
  assert.ok(timedOut, 'the fixture holds the source\'s timeout trial');
  assert.equal(timedOut.doc.exception_info.exception_type, 'AgentTimeoutError');
  assert.equal(timedOut.doc.verifier_result.rewards.reward, 1);
  const receipt = importPair(withJob, BASELINE);
  const o = oracle({ withJob, withoutJob: BASELINE });
  assert.deepEqual(trace(receipt, o), []);
  const id = caseId(timedOut.doc);
  const row = receipt.results.cases.find((c) => c.id === id && c.mode === 'with_skill');
  assert.equal(row.samples.length, 1);
  assert.equal(row.excluded_draws[0].reason, fill(DRAW.exception, { type: 'AgentTimeoutError' }));
  assert.ok(receipt.run.import.notices.includes(fill(T.exception, { arm: 'with-skill', n: 1, type: 'AgentTimeoutError' })));
  assert.ok(!JSON.stringify(receipt).includes(timedOut.doc.exception_info.exception_message.slice(0, 40)), 'the message is never copied');
  // Plants: the timed-out reward put back into the samples; the type removed from the listing.
  assert.notDeepEqual(trace(doctor(receipt, (r) => { const c = r.results.cases.find((x) => x.id === id && x.mode === 'with_skill'); c.samples.push(1); delete c.excluded_draws; }), o), []);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.results.cases.find((x) => x.id === id && x.mode === 'with_skill').excluded_draws[0].reason = 'left out'; }), o), []);
});

test('AC-5, AC-14: an exception type that is not a dotted class name is written as unreadable, never copied', () => {
  // The planted home path is joined at run time, so the tree never carries one.
  const home = ['', 'home', 'someone', 'x.py'].join('/');
  for (const type of [home, '9Error']) {
    const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug', 'django__django-13512']);
    const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
    editTrials(w, first('application-debug'), (d) => { d.exception_info = { exception_type: type, exception_message: 'boom at ~/work/x', exception_traceback: `File "${home}"`, occurred_at: '2026-09-30T00:00:00Z' }; });
    const receipt = importPair(w, b);
    const o = oracle({ withJob: w, withoutJob: b });
    assert.deepEqual(trace(receipt, o), []);
    assert.deepEqual(localPaths(receipt, o), []);
    assert.ok(receipt.run.import.notices.includes(fill(T.exception, { arm: 'with-skill', n: 1, type: 'unreadable' })), type);
    assert.ok(!JSON.stringify(receipt).includes(type), `${type} is never copied`);
  }
});

test('AC-5: a trial with no finished_at time is left out whatever its reward, listed and counted', () => {
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug', 'django__django-13512']);
  const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  editTrials(w, first('application-debug'), (d) => { d.finished_at = null; d.verifier_result = { rewards: { reward: 1 } }; });
  const receipt = importPair(w, b);
  const o = oracle({ withJob: w, withoutJob: b });
  assert.deepEqual(trace(receipt, o), []);
  const row = receipt.results.cases.find((c) => c.label === 'application-debug' && c.mode === 'with_skill');
  assert.equal(row.samples.length, 1);
  assert.deepEqual(row.excluded_draws.map((e) => e.reason), [DRAW.unfinished]);
  assert.ok(receipt.run.import.notices.includes(fill(T.unfinished, { arm: 'with-skill', n: 1 })));
});

// ── AC-6: multi-step trials ─────────────────────────────────────────────────
test('AC-6: a trial with step_results is refused and nothing is written', () => {
  const w = copyArm(path.join(TRIALS, 'skill-compound-engineering'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  editTrials(w, first('application-debug'), (d) => { d.step_results = []; });
  refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), /step_results/);
});

// ── AC-8: nothing copied from the source's figures ──────────────────────────
test('AC-8: a job-level result.json is not read for any figure, a notice says so, and its figures appear nowhere', () => {
  const w = copyArm(path.join(TRIALS, 'skill-karpathy'));
  const b = copyArm(BASELINE);
  const clean = importPair(w, b);
  const job = jobOf(b, 'application-debug');
  fs.writeFileSync(path.join(b, job, 'result.json'), JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', started_at: '2026-09-29T00:00:00Z', finished_at: null, n_total_trials: 1, stats: { n_completed_trials: 1, n_errored_trials: 0, evals: { 'claude-code__claude-opus-5-5__x': { n_trials: 1, metrics: [{ mean: 0.987654 }], reward_stats: { reward: { 1: ['a'] } } } }, cost_usd: 98765.4321 } }, null, 4));
  const planted = importPair(w, b);
  for (const k of ['results', 'comparison', 'economics', 'suite', 'skill']) assert.deepEqual(planted[k], clean[k], k);
  assert.deepEqual(planted.run.counts, clean.run.counts);
  assert.ok(planted.run.import.notices.includes(fill(T.jobLevel, { n: 1 })));
  assert.deepEqual(trace(planted, oracle({ withJob: w, withoutJob: b })), []);
  const text = JSON.stringify(planted);
  for (const figure of ['0.987654', '98765.4321']) assert.ok(!text.includes(figure), `${figure} appears in the receipt`);
});

// ── AC-9: a band where the draws allow one ──────────────────────────────────
test('AC-9: two or more matched cases carry a band; one gives single_case; none gives no_cases', () => {
  const full = importPair(path.join(TRIALS, 'skill-caveman'), BASELINE);
  assert.equal(typeof full.comparison.delta_uncertainty, 'number');
  const w1 = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const b1 = copyArm(BASELINE, ['application-debug']);
  const one = importPair(w1, b1);
  assert.equal(one.comparison.delta_uncertainty, null);
  assert.equal(one.comparison.delta_uncertainty_unavailable, 'single_case');
  assert.deepEqual(trace(one, oracle({ withJob: w1, withoutJob: b1 })), []);
  const w0 = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const b0 = copyArm(BASELINE, ['django__django-13512']);
  const none = importPair(w0, b0);
  assert.equal(none.comparison.delta, null);
  assert.equal(none.comparison.delta_uncertainty_unavailable, 'no_cases');
  assert.deepEqual(trace(none, oracle({ withJob: w0, withoutJob: b0 })), []);
  assert.equal(none.economics.with_skill.call_count, 0);
  assert.equal(none.economics.with_skill.mean_cost_usd_per_call, null);
  // Plant: a band written where one matched case allows none.
  assert.notDeepEqual(trace(doctor(one, (r) => { r.comparison.delta_uncertainty = 0; delete r.comparison.delta_uncertainty_unavailable; }), oracle({ withJob: w1, withoutJob: b1 })), []);
});

// ── AC-10: provenance sealed ────────────────────────────────────────────────
test('AC-10: sidecars and source_sha256 cover every trial file read; one byte changes the hash; a removed sidecar fails', () => {
  const w = copyArm(path.join(TRIALS, 'skill-mattpocock'));
  const b = copyArm(BASELINE);
  const receipt = importPair(w, b);
  const o = oracle({ withJob: w, withoutJob: b });
  assert.deepEqual(receipt.run.import.sidecars, o.sidecars);
  assert.equal(receipt.run.import.source_sha256, o.sourceSha);
  assert.ok(receipt.run.import.notices.includes(T.pairing), 'the pairing is declared in a notice');
  const t = readArm(b)[0];
  fs.appendFileSync(path.join(b, ...t.rel.split('/')), ' ');
  const moved = importPair(w, b);
  assert.notEqual(moved.run.import.source_sha256, receipt.run.import.source_sha256);
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.run.import.sidecars.pop(); }), o), []);
  const resealed = sealReceipt(doctor(receipt, (r) => { r.run.import.notices[0] = 'changed'; r.receipt_hash = ''; }));
  assert.notEqual(resealed.receipt_hash, receipt.receipt_hash, 'the notices are inside the hash');
});

// ── AC-12: the same import twice ────────────────────────────────────────────
test('AC-12: importing twice, from a copy at another path, or with every listing reversed gives the same receipt apart from the import time', () => {
  const { importHarbor } = lib();
  const withJob = path.join(TRIALS, 'skill-ponytail');
  const a = importHarbor({ withJob, withoutJob: BASELINE, importedAt: AT }).receipt;
  const b = importHarbor({ withJob, withoutJob: BASELINE, importedAt: '2027-01-01T00:00:00.000Z' }).receipt;
  assert.deepEqual(strip(a), strip(b));
  const c = importHarbor({ withJob: copyArm(withJob), withoutJob: copyArm(BASELINE), importedAt: AT }).receipt;
  assert.deepEqual(strip(c), strip(a));
  // The system's listing order is not the importer's: every listing it asks for comes back reversed.
  const realReaddir = fs.readdirSync;
  let reversed = 0;
  fs.readdirSync = function (...args) { const out = realReaddir.apply(fs, args); reversed++; return out.slice().reverse(); };
  let d;
  try { d = importHarbor({ withJob, withoutJob: BASELINE, importedAt: AT }).receipt; } finally { fs.readdirSync = realReaddir; }
  assert.ok(reversed > 0, 'the importer lists through fs.readdirSync, so the plant reached it');
  assert.deepEqual(strip(d), strip(a));
  const r1 = cli(pairArgs(withJob, BASELINE));
  const r2 = cli(pairArgs(withJob, BASELINE));
  assert.equal(r1.status, 0, r1.stderr);
  assert.deepEqual(r1.files, r2.files);
  assert.deepEqual(strip(r1.receipt), strip(r2.receipt));
  assert.deepEqual(strip(r1.receipt), strip(a));
  // Plants: an absolute path in the receipt; the rows in another order.
  const o = oracle({ withJob, withoutJob: BASELINE });
  assert.ok(localPaths(doctor(a, (r) => { r.run.import.notices.push(`read ${withJob}`); }), o).length > 0);
  assert.notDeepEqual(trace(doctor(a, (r) => { r.results.cases.reverse(); }), o), []);
});

test('AC-12: draw indexes follow path order where it is not listing order, and an importer without its path sort fails the reader', () => {
  // Jobs x and x-1: listed by name, x comes first; by path, "x-1/" comes first ("-" before "/").
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const b = path.join(tmp(), 'baseline');
  fs.mkdirSync(b);
  const jobs = fs.readdirSync(BASELINE).filter((j) => j.endsWith('__application-debug')).sort();
  fs.cpSync(path.join(BASELINE, jobs[0]), path.join(b, 'x'), { recursive: true });
  fs.cpSync(path.join(BASELINE, jobs[1]), path.join(b, 'x-1'), { recursive: true });
  editTrials(b, (_d, rel) => rel.startsWith('x-1/'), (d) => { d.exception_info = { exception_type: 'AgentTimeoutError', exception_message: 'm', exception_traceback: 't', occurred_at: d.started_at }; });
  const o = oracle({ withJob: w, withoutJob: b });
  const receipt = importPair(w, b);
  assert.deepEqual(trace(receipt, o), []);
  assert.deepEqual(receipt.results.cases.find((c) => c.mode === 'baseline').excluded_draws.map((e) => e.draw_index), [1], 'the trial in x-1 is draw 1');
  // Plant: a copy of the importer with its one path sort removed, its requires made absolute.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'importers-harbor.js'), 'utf8');
  const SORT = '  trials.sort((a, b) => byCodeUnit(a.rel, b.rel));\n';
  assert.equal(src.split(SORT).length, 2, 'the importer puts each arm\'s trials in path order in one place');
  const mutant = path.join(tmp(), 'importers-harbor-unsorted.js');
  fs.writeFileSync(mutant, src.replace(SORT, '').replace(/require\('\.\.\/config'\)/, `require(${JSON.stringify(path.join(ROOT, 'config'))})`).replace(/require\('\.\/([a-z-]+)'\)/g, (_, m) => `require(${JSON.stringify(path.join(ROOT, 'lib', m))})`));
  const unsorted = require(mutant).importHarbor({ withJob: w, withoutJob: b, importedAt: AT }).receipt;
  assert.notDeepEqual(trace(unsorted, o), [], 'without the path sort the draw indexes follow listing order');
});

// ── AC-13: no path skips a check ────────────────────────────────────────────
test('AC-13: the module exports only importHarbor, opposedToPublished, HARBOR_TOOLS and HarborRefused', () => {
  assert.deepEqual(Object.keys(lib()).sort(), ['HARBOR_TOOLS', 'HarborRefused', 'importHarbor', 'opposedToPublished']);
  assert.deepEqual(lib().HARBOR_TOOLS, ['harbor']);
});

// ── AC-14: local paths are never copied; source text is bounded ─────────────
test('AC-14: no task path, trial uri, mount, exception text or home path reaches a receipt', () => {
  for (const a of SKILL_ARMS) {
    const withJob = path.join(TRIALS, a);
    const receipt = importPair(withJob, BASELINE);
    assert.deepEqual(localPaths(receipt, oracle({ withJob, withoutJob: BASELINE })), [], a);
  }
  const withJob = path.join(SAME_NAME, 'with'); const withoutJob = path.join(SAME_NAME, 'without');
  const receipt = importPair(withJob, withoutJob);
  const o = oracle({ withJob, withoutJob });
  assert.deepEqual(localPaths(receipt, o), []);
  // Plant: the fixture's task path written into a label.
  const doc = readArm(withJob)[0].doc;
  assert.notDeepEqual(localPaths(doctor(receipt, (r) => { r.results.cases[0].label = doc.trial_uri; }), o), []);
});

test('AC-14: a task name that is not a plain name is left out of the label with a notice; a model id with control characters is refused, escaped', () => {
  const home = ['', 'home', 'someone', 'task'].join('/');
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug', 'django__django-13512']);
  const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  for (const dir of [w, b]) editTrials(dir, (d) => d.task_name === 'application-debug', (d) => { d.task_name = home; });
  const receipt = importPair(w, b);
  const o = oracle({ withJob: w, withoutJob: b });
  assert.deepEqual(trace(receipt, o), []);
  assert.deepEqual(localPaths(receipt, o), []);
  assert.ok(receipt.run.import.notices.includes(fill(T.labels, { n: 1 })));
  // Plant (issue 292): one arm's trials of a task give another plain name; the label is left
  // out with the notice for different names, not the one for a name that is not plain.
  const w3 = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug', 'django__django-13512']);
  const b3 = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  editTrials(w3, (d) => d.task_name === 'application-debug', (d) => { d.task_name = 'application-debug-renamed'; });
  const renamed = importPair(w3, b3);
  assert.deepEqual(trace(renamed, oracle({ withJob: w3, withoutJob: b3 })), []);
  assert.ok(renamed.run.import.notices.includes(fill(T.labelsDiffer, { n: 1 })));
  assert.ok(!renamed.run.import.notices.includes(fill(T.labels, { n: 1 })));
  assert.equal(renamed.results.cases.filter((c) => c.label === undefined).length, 2, 'the case\'s two rows carry no label');
  const w2 = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const b2 = copyArm(BASELINE, ['application-debug']);
  for (const dir of [w2, b2]) editTrials(dir, every, (d) => { d.agent_info.model_info.name = 'claude\u0001x\ny'; });
  const { message, stderr } = refusedBoth({ withJob: w2, withoutJob: b2 }, pairArgs(w2, b2), /model id/);
  for (const text of [message, stderr.trimEnd()]) {
    assert.ok(text.includes('\\u0001') && text.includes('\\n'), 'the control characters are shown escaped');
    assert.ok(!text.includes('\u0001') && !text.includes('x\ny'), 'no raw control character is printed');
  }
});

test('AC-14: a folder name in a trial\'s path that is not a plain name is refused, shown escaped', () => {
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  const job = fs.readdirSync(b).sort()[0];
  fs.renameSync(path.join(b, job), path.join(b, 'job ~\u0007'));
  const { message, stderr } = refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), /folder name/);
  for (const text of [message, stderr]) assert.ok(text.includes('\\u0007') && !text.includes('\u0007'), 'the bell character is shown escaped');
});

// ── AC-15: two different jobs, and the input limits ─────────────────────────
test('AC-15: one directory twice, one trial in both jobs, an empty directory, a stray result.json and a link are refused', () => {
  const w = copyArm(path.join(TRIALS, 'skill-superpowers'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  refusedBoth({ withJob: w, withoutJob: w }, pairArgs(w, w), /same/);
  const shared = copyArm(BASELINE, ['application-debug']);
  const job = fs.readdirSync(w)[0];
  fs.cpSync(path.join(w, job), path.join(shared, job), { recursive: true });
  refusedBoth({ withJob: w, withoutJob: shared }, pairArgs(w, shared), /twice|both/);
  const empty = tmp();
  refusedBoth({ withJob: w, withoutJob: empty }, pairArgs(w, empty), /no trial/);
  const stray = copyArm(BASELINE, ['application-debug']);
  fs.mkdirSync(path.join(stray, 'notes'));
  fs.writeFileSync(path.join(stray, 'notes', 'result.json'), '{"hello": 1}');
  refusedBoth({ withJob: w, withoutJob: stray }, pairArgs(w, stray), /notes/);
  const linked = path.join(tmp(), 'linked');
  fs.symlinkSync(b, linked);
  refusedBoth({ withJob: w, withoutJob: linked }, pairArgs(w, linked), /link/);
  const inner = copyArm(BASELINE, ['application-debug']);
  fs.symlinkSync(path.join(w, job), path.join(inner, 'extra'));
  refusedBoth({ withJob: w, withoutJob: inner }, pairArgs(w, inner), /link/);
});

test('AC-15: a copy of a trial with a new id, or a new id, trial name and folder, is refused through both paths', () => {
  for (const rename of [false, true]) {
    const w = copyArm(path.join(TRIALS, 'skill-superpowers'), ['application-debug']);
    const b = copyArm(BASELINE, ['application-debug']);
    const t = readArm(b)[0];
    const [job, trial] = t.rel.split('/');
    const newTrial = rename ? `${trial}copy` : trial;
    const dst = path.join(b, `${job}-copy`, newTrial);
    fs.mkdirSync(dst, { recursive: true });
    const d = JSON.parse(fs.readFileSync(path.join(b, ...t.rel.split('/')), 'utf8'));
    d.id = '88888888-8888-4888-8888-888888888888';
    if (rename) { d.trial_name = newTrial; d.config.trial_name = newTrial; d.trial_uri = `${d.trial_uri}copy`; d.config.trials_dir = `${d.config.trials_dir}-copy`; d.config.job_id = '77777777-7777-4777-8777-777777777777'; }
    fs.writeFileSync(path.join(dst, 'result.json'), JSON.stringify(d));
    refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), /repeats|twice/);
  }
});

// A check of a trial file's size or kind that the file no longer matches when it is read: every
// lstat of a result.json follows links and reports 100 bytes (AC-15).
const RACE = `'use strict';
const fs = require('node:fs');
const real = fs.lstatSync;
fs.lstatSync = function (p, ...rest) {
  if (!String(p).endsWith('result.json')) return real.call(fs, p, ...rest);
  const s = fs.statSync(p, ...rest);
  return new Proxy(s, { get: (t, k) => (k === 'size' ? 100 : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
};
`;
function raced(opts, args, pattern) {
  const preload = path.join(tmp(), 'race.js');
  fs.writeFileSync(preload, RACE);
  const real = fs.lstatSync;
  require(preload);
  try {
    const { importHarbor, HarborRefused } = lib();
    assert.throws(() => importHarbor({ importedAt: AT, ...opts }), (e) => e instanceof HarborRefused && pattern.test(e.message));
  } finally { fs.lstatSync = real; }
  const r = cli(args, { nodeArgs: ['--require', preload] });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, pattern);
  assert.deepEqual(r.files, []);
}

test('AC-15: trial files that grow after their size was taken are counted as read, through both paths', () => {
  const w = copyArm(path.join(TRIALS, 'skill-superpowers'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  // Five 15 MiB trials, each a real trial with its own id, name and times, padded with spaces.
  const src = readArm(w)[0].doc;
  for (let i = 0; i < 5; i++) {
    const name = `big__${i}`;
    const d = structuredClone(src);
    d.id = `00000000-0000-4000-8000-00000000000${i}`;
    d.trial_name = name; d.config.trial_name = name;
    d.started_at = `2026-09-30T00:00:0${i}.000000Z`;
    const dir = path.join(w, `zz-big-${i}`, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(d) + ' '.repeat(15 * 1024 * 1024));
  }
  raced({ withJob: w, withoutJob: b }, pairArgs(w, b), /64 MiB/);
});

test('AC-15: a trial file swapped for a link after it was checked is refused when opened, through both paths', () => {
  const w = copyArm(path.join(TRIALS, 'skill-superpowers'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  const t = readArm(b)[0];
  const f = path.join(b, ...t.rel.split('/'));
  const elsewhere = path.join(tmp(), 'result.json');
  fs.renameSync(f, elsewhere);
  fs.symlinkSync(elsewhere, f);
  raced({ withJob: w, withoutJob: b }, pairArgs(w, b), /link/);
});

test('AC-15: a file above 16 MiB is refused', () => {
  const w = copyArm(path.join(TRIALS, 'skill-superpowers'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  editTrials(b, first('application-debug'), (d) => { d.padding = 'x'.repeat(16000); }, { raw: (t) => t + ' '.repeat(16 * 1024 * 1024) });
  refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), /limit/);
});

test('AC-15: more than 64 MiB of trial files in one import is refused before they are read', () => {
  const w = copyArm(path.join(TRIALS, 'skill-superpowers'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  // Five sparse files of 15 MiB each: under the per-file limit, over the total, and never read.
  for (let i = 0; i < 5; i++) {
    const d = path.join(w, `zz-big-${i}`, `big__${i}`);
    fs.mkdirSync(d, { recursive: true });
    const fd = fs.openSync(path.join(d, 'result.json'), 'w');
    fs.ftruncateSync(fd, 15 * 1024 * 1024);
    fs.closeSync(fd);
  }
  refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), /64 MiB/);
});

// ── AC-16: one arm ──────────────────────────────────────────────────────────
test('AC-16: one job imports as one arm, with no fabricated other arm; a bad --arm or a mixed form is refused, exit 2', () => {
  const { importHarbor } = lib();
  const one = importHarbor({ job: BASELINE, arm: 'baseline', importedAt: AT }).receipt;
  assert.ok(validateReceipt(one).valid);
  assert.ok(one.results.cases.every((c) => c.mode === 'baseline'));
  assert.equal(one.results.aggregates.with_skill.case_count, 0);
  assert.equal(one.comparison.delta, null);
  assert.equal(one.comparison.with_skill_score, null);
  assert.deepEqual(trace(one, oracle({ withoutJob: BASELINE, arm: 'baseline' })), []);
  const def = cli(['--from', 'harbor', path.join(TRIALS, 'skill-caveman')]);
  assert.equal(def.status, 0, def.stderr);
  assert.ok(def.receipt.results.cases.every((c) => c.mode === 'with_skill'), '--arm defaults to with-skill');
  assert.equal(def.receipt.comparison.baseline_score, null);
  assert.deepEqual(trace(def.receipt, oracle({ withJob: path.join(TRIALS, 'skill-caveman'), arm: 'with_skill' })), []);
  for (const args of [['--from', 'harbor', BASELINE, '--arm', 'placebo'], ['--from', 'harbor', BASELINE, '--with', BASELINE, '--without', BASELINE], ['--from', 'harbor', '--with', BASELINE, '--without', BASELINE, '--arm', 'baseline'], ['--from', 'harbor', '--with', BASELINE]]) {
    const r = cli(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.deepEqual(r.files, []);
  }
});

// ── AC-17: opposite directions are listed, read from the band ───────────────
test('AC-17: opposedToPublished reads the band and matches an independent reading of the nine receipts against the published verdicts', () => {
  const { opposedToPublished } = lib();
  const published = JSON.parse(fs.readFileSync(path.join(SP, 'claude-code.json'), 'utf8')).comparisons;
  const dir = (v) => (v === 'beats placebo' ? 'up' : v === 'worse than placebo' ? 'down' : 'none');
  const ourDir = (d, u) => (d === null || u === null || Math.abs(d) <= u ? 'none' : d > 0 ? 'up' : 'down');
  let seen = 0;
  for (const a of SKILL_ARMS) {
    const withJob = path.join(TRIALS, a);
    const verdict = published[a.replace(/^skill-/, '')].verdict;
    const receipt = importPair(withJob, BASELINE);
    const o = oracle({ withJob, withoutJob: BASELINE });
    const ours = ourDir(o.delta, o.deltaUnc);
    const theirs = dir(verdict);
    const got = opposedToPublished(receipt, verdict);
    assert.equal(got.receipt_direction, ours, a);
    assert.equal(got.published_direction, theirs, a);
    assert.equal(got.opposite, ours !== 'none' && theirs !== 'none' && ours !== theirs, a);
    seen++;
  }
  assert.equal(seen, 9);
  // Plants on one receipt: a small delta inside a wide band points nowhere; a delta outside a
  // narrow band points, and its flip turns the listing over. Each is counted, so each ran.
  const base = importPair(path.join(TRIALS, 'skill-caveman'), BASELINE);
  const set = (d, u) => doctor(base, (r) => { r.comparison.delta = d; r.comparison.delta_uncertainty = u; });
  let ran = 0;
  assert.deepEqual(opposedToPublished(set(0.03, 0.4), 'worse than placebo'), { receipt_direction: 'none', published_direction: 'down', opposite: false }); ran++;
  assert.deepEqual(opposedToPublished(set(0.4, 0.4), 'worse than placebo').receipt_direction, 'none', 'the band\'s edge points nowhere'); ran++;
  assert.deepEqual(opposedToPublished(set(0.5, null), 'worse than placebo').receipt_direction, 'none', 'no band, no direction'); ran++;
  const up = opposedToPublished(set(0.5, 0.1), 'worse than placebo');
  assert.deepEqual(up, { receipt_direction: 'up', published_direction: 'down', opposite: true }); ran++;
  const flipped = opposedToPublished(set(-0.5, 0.1), 'worse than placebo');
  assert.deepEqual(flipped, { receipt_direction: 'down', published_direction: 'down', opposite: false });
  assert.notEqual(flipped.opposite, up.opposite); ran++;
  assert.equal(ran, 5, 'every plant ran');
});

test('AC-17, AC-18: the proving run\'s report lists each skill and states the comparison, the timeout rule and the placebo rule', () => {
  const report = path.join(tmp(), 'report.md');
  const r = spawnSync(process.execPath, [PROVE, TRIALS, path.join(SP, 'claude-code.json'), report], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(report, 'utf8');
  for (const a of SKILL_ARMS) assert.match(text, new RegExp(`\\b${a.replace(/^skill-/, '')}\\b`));
  assert.match(text, /against a placebo on cost and pass rate/);
  assert.match(text, /against no skill on reward/);
  assert.match(text, /counts a timed-out trial as a failure/);
  assert.match(text, /leaves it out/);
  assert.match(text, /no placebo comparison is imported/i);
  assert.match(text, /Opposite directions/);
  // A-266-1 (issue 378): the em dash is no longer read.
});

// ── AC-18, AC-21: the docs ──────────────────────────────────────────────────
function harborSection() {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'interop.md'), 'utf8');
  const m = /^## Source #\d+: Harbor\b[\s\S]*?(?=^## )/m.exec(md);
  return m ? m[0] : null;
}
test('AC-18, AC-21, AC-22: docs/interop.md has a Harbor section with the commands, the rules, the trust in the trial file\'s place and the placebo sentence', () => {
  const s = harborSection();
  assert.ok(s, 'docs/interop.md has no "## Source #n: Harbor" section');
  assert.match(s, /driftproof import --from harbor --with \S+ --without \S+/);
  assert.match(s, /driftproof import \S+ --from harbor --arm (with-skill|baseline)/);
  for (const re of [/task_checksum/, /task_id/, /--reward/, /exception_info/, /step_results/, /agent_info\.version/, /model_info\.name/, /includes cached/i, /METHOD\.md/, /pool/i, /placebo/i, /DECLARED/, /agent\//, /verifier\//, /cannot check/, /one trial/, /config\.agent/, /source_sha256|sha256/, /finished_at/, /extra_instructions/, /model_usage/, /different shares/]) assert.match(s, re);
  // A-266-1 (issue 378): the em dash is no longer read.
});

test('AC-18: the importer takes no placebo option; an unknown flag is refused, exit 2', () => {
  const r = cli([...pairArgs(path.join(TRIALS, 'skill-caveman'), BASELINE), '--placebo', path.join(TRIALS, 'skill-caveman')]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--placebo/);
  assert.deepEqual(r.files, []);
});

test('AC-21: the interop page carries an import line for --from harbor (spec 052 AC-4)', () => {
  const { checkInteropPage } = require('./interop-page');
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'interop', 'index.html'), 'utf8');
  const r = checkInteropPage({ html, current: '0', frozen: [], tools: ['harbor'] });
  assert.deepEqual(r.problems.filter((p) => /harbor/.test(p)), []);
});

// ── AC-20: the skill's name ─────────────────────────────────────────────────
test('AC-20: skill.name is the --skill declaration with a notice, else unknown with a notice; a --skill that is not a plain name is refused', () => {
  const withJob = path.join(TRIALS, 'skill-caveman');
  const named = importPair(withJob, BASELINE, { skill: 'caveman' });
  assert.equal(named.skill.name, 'caveman');
  assert.ok(named.run.import.notices.includes(T.skillDeclared));
  assert.deepEqual(trace(named, oracle({ withJob, withoutJob: BASELINE, skill: 'caveman' })), []);
  const bare = importPair(withJob, BASELINE);
  assert.equal(bare.skill.name, 'unknown');
  assert.ok(bare.run.import.notices.includes(T.skillUnknown));
  const r = cli(pairArgs(withJob, BASELINE, ['--skill', 'caveman']));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.receipt.skill.name, 'caveman');
  refusedBoth({ withJob, withoutJob: BASELINE, skill: '../x' }, pairArgs(withJob, BASELINE, ['--skill', '../x']), /--skill/);
  // Plant: a name with neither a declaration nor the source behind it.
  assert.notDeepEqual(trace(doctor(bare, (r2) => { r2.skill.name = 'caveman'; }), oracle({ withJob, withoutJob: BASELINE })), []);
});

// ── AC-22: which file is a trial ────────────────────────────────────────────
// A trial written by a skill: reward 1, a new id, the task's id and checksum.
function fakeTrial(from, trialName) {
  const d = JSON.parse(fs.readFileSync(from, 'utf8'));
  d.id = '99999999-9999-4999-8999-999999999999';
  d.trial_name = trialName;
  if (d.config) d.config.trial_name = trialName;
  d.exception_info = null;
  d.verifier_result = { rewards: { reward: 1 } };
  return JSON.stringify(d, null, 4);
}
test('AC-22: a fake trial under a trial\'s agent/ folder is never read, in a folder of jobs or in one job', () => {
  // A folder of jobs: <arm>/<job>/<trial>/agent/x/result.json.
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug', 'django__django-13512']);
  const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  const clean = importPair(w, b);
  for (const t of readArm(b).filter((x) => x.doc.task_name === 'application-debug')) {
    const trialDir = path.join(b, ...t.rel.split('/').slice(0, -1));
    fs.mkdirSync(path.join(trialDir, 'agent', 'x'), { recursive: true });
    fs.writeFileSync(path.join(trialDir, 'agent', 'x', 'result.json'), fakeTrial(path.join(b, ...t.rel.split('/')), 'x'));
    // A test script's own result.json in verifier/, and a link in the agent's logs.
    fs.mkdirSync(path.join(trialDir, 'verifier'), { recursive: true });
    fs.writeFileSync(path.join(trialDir, 'verifier', 'result.json'), '{"hello": 1}');
    fs.symlinkSync(path.join(os.tmpdir(), 'nowhere'), path.join(trialDir, 'agent', 'link'));
  }
  const planted = importPair(w, b);
  assert.deepEqual(strip(planted), strip(clean), 'nothing under agent/ or verifier/ is read');
  assert.deepEqual(trace(planted, oracle({ withJob: w, withoutJob: b })), []);
  // One job: <job>/<trial>/agent/result.json, its trial_name "agent".
  const wj = path.join(tmp(), 'with-job'); const bj = path.join(tmp(), 'without-job');
  fs.cpSync(path.join(TRIALS, 'skill-caveman', jobOf(path.join(TRIALS, 'skill-caveman'), 'application-debug')), wj, { recursive: true });
  fs.cpSync(path.join(BASELINE, jobOf(BASELINE, 'application-debug')), bj, { recursive: true });
  const cleanJob = importPair(wj, bj);
  assert.equal(cleanJob.run.import.sidecars.length, 2, 'one job: one trial file in each arm');
  const trial = fs.readdirSync(bj)[0];
  fs.mkdirSync(path.join(bj, trial, 'agent'));
  fs.writeFileSync(path.join(bj, trial, 'agent', 'result.json'), fakeTrial(path.join(bj, trial, 'result.json'), 'agent'));
  const plantedJob = importPair(wj, bj);
  assert.deepEqual(strip(plantedJob), strip(cleanJob));
  assert.deepEqual(trace(plantedJob, oracle({ withJob: wj, withoutJob: bj })), []);
});

test('AC-22: a trial folder not named for its trial is refused through both paths', () => {
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  const t = readArm(b)[0];
  const [job, trial] = t.rel.split('/');
  fs.renameSync(path.join(b, job, trial), path.join(b, job, 'renamed'));
  refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), /folder/);
});

test('AC-22: a trial folder with no result.json is counted in a notice and not read', () => {
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug', 'django__django-13512']);
  const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  fs.mkdirSync(path.join(b, jobOf(b, 'application-debug'), 'application-debug__unfinished', 'agent'), { recursive: true });
  const receipt = importPair(w, b);
  assert.deepEqual(trace(receipt, oracle({ withJob: w, withoutJob: b })), []);
  assert.ok(receipt.run.import.notices.includes(fill(T.emptyFolders, { arm: 'baseline', n: 1 })));
});

// ── AC-23: the agent's settings ─────────────────────────────────────────────
test('AC-23: an arm whose trials differ in their agent settings is refused, naming the key and never the value', () => {
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  editTrials(w, first('application-debug'), (d) => { d.config.agent.kwargs.reasoning_effort = 'xhigh'; });
  const { message, stderr } = refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), /with-skill[^\n]*kwargs\.reasoning_effort/);
  for (const text of [message, stderr]) assert.ok(!text.includes('xhigh'), 'no value is named');
  // Two skills in one arm.
  const mixed = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const ponytail = path.join(TRIALS, 'skill-ponytail');
  const job = jobOf(ponytail, 'django__django-13512');
  fs.cpSync(path.join(ponytail, job), path.join(mixed, job), { recursive: true });
  refusedBoth({ withJob: mixed, withoutJob: b }, pairArgs(mixed, b), /env\.CLAUDE_CODE_PLUGIN_DIRS/);
});

test('AC-23: two local plugin paths in one arm are two settings, refused naming the key and never the path', () => {
  const plants = [
    [(d, i) => { d.config.agent.env.CLAUDE_CODE_PLUGIN_DIRS = i ? '~/skills/ponytail' : '~/skills/caveman'; }, /with-skill[^\n]*agent\.env\.CLAUDE_CODE_PLUGIN_DIRS/],
    [(d, i) => { d.config.agent.skills = [i ? '~/skills/ponytail' : '~/skills/caveman']; }, /with-skill[^\n]*agent\.skills/],
  ];
  for (const [edit, pattern] of plants) {
    const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug', 'django__django-13512']);
    const b = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
    let i = 0;
    editTrials(w, every, (d) => { edit(d, i++ % 2); });
    const { message, stderr } = refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), pattern);
    for (const text of [message, stderr]) assert.ok(!text.includes('skills/'), 'no path is named');
  }
});

test('AC-23: any setting outside config.agent that differs within an arm is refused; one-arm imports too', () => {
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  editTrials(w, first('application-debug'), (d) => { d.config.extra_instructions = ['use the planted hint']; });
  const { message, stderr } = refusedBoth({ withJob: w, withoutJob: b }, pairArgs(w, b), /with-skill[^\n]*extra_instructions/);
  for (const text of [message, stderr]) assert.ok(!text.includes('planted hint'), 'no value is named');
  // One arm: one trial's timeout multiplier changed.
  const j = copyArm(BASELINE, ['application-debug', 'django__django-13512']);
  editTrials(j, first('application-debug'), (d) => { d.config.timeout_multiplier = 2.0; });
  const { importHarbor, HarborRefused } = lib();
  assert.throws(() => importHarbor({ job: j, arm: 'baseline', importedAt: AT }), (e) => e instanceof HarborRefused && /baseline[^\n]*timeout_multiplier/.test(e.message));
  const r = cli(['--from', 'harbor', j, '--arm', 'baseline']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /timeout_multiplier/);
  assert.deepEqual(r.files, []);
});

test('AC-23: a notice names each setting that differs between the arms, local paths and settings outside config.agent included, without values', () => {
  const caveman = importPair(path.join(TRIALS, 'skill-caveman'), BASELINE);
  assert.ok(caveman.run.import.notices.includes(fill(T.agentDiffer, { paths: 'agent.env.CLAUDE_CODE_PLUGIN_DIRS' })), JSON.stringify(caveman.run.import.notices));
  assert.ok(!caveman.run.import.notices.some((n) => n.includes('/opt/plugins')), 'no value is named');
  const w = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const b = copyArm(BASELINE, ['application-debug']);
  editTrials(w, every, (d) => { d.config.agent.kwargs.reasoning_effort = 'high'; });
  const effort = importPair(w, b);
  assert.ok(effort.run.import.notices.includes(fill(T.agentDiffer, { paths: 'agent.env.CLAUDE_CODE_PLUGIN_DIRS, agent.kwargs.reasoning_effort' })), JSON.stringify(effort.run.import.notices));
  assert.deepEqual(trace(effort, oracle({ withJob: w, withoutJob: b })), []);
  const same = importPair(path.join(SAME_NAME, 'with'), path.join(SAME_NAME, 'without'));
  assert.ok(same.run.import.notices.includes(T.agentSame));
  // One local path per arm: the with-skill arm's skill against the baseline's placebo.
  const wl = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const bl = copyArm(BASELINE, ['application-debug']);
  editTrials(wl, every, (d) => { d.config.agent.env = { CLAUDE_CODE_PLUGIN_DIRS: '~/skills/caveman' }; });
  editTrials(bl, every, (d) => { d.config.agent.env = { CLAUDE_CODE_PLUGIN_DIRS: '~/skills/placebo' }; });
  const local = importPair(wl, bl);
  assert.ok(local.run.import.notices.includes(fill(T.agentDiffer, { paths: 'agent.env.CLAUDE_CODE_PLUGIN_DIRS' })), JSON.stringify(local.run.import.notices));
  assert.deepEqual(trace(local, oracle({ withJob: wl, withoutJob: bl })), []);
  assert.deepEqual(localPaths(local, oracle({ withJob: wl, withoutJob: bl })), []);
  // Instructions and resources outside config.agent, set on the whole with-skill arm.
  const wx = copyArm(path.join(TRIALS, 'skill-caveman'), ['application-debug']);
  const bx = copyArm(BASELINE, ['application-debug']);
  editTrials(wx, every, (d) => { d.config.extra_instructions = ['use the planted hint']; d.config.environment.override_cpus = 16; });
  const extra = importPair(wx, bx);
  assert.ok(extra.run.import.notices.includes(fill(T.agentDiffer, { paths: 'agent.env.CLAUDE_CODE_PLUGIN_DIRS, environment.override_cpus, extra_instructions' })), JSON.stringify(extra.run.import.notices));
  assert.ok(!JSON.stringify(extra).includes('planted hint'), 'no value is copied');
  assert.deepEqual(trace(extra, oracle({ withJob: wx, withoutJob: bx })), []);
});

// ── AC-24: one receipt file per source ──────────────────────────────────────
test('AC-24: two pairs imported into one --out on the same day give two files, named by their source hash', () => {
  const out = tmp();
  const r1 = cli(pairArgs(path.join(TRIALS, 'skill-caveman'), BASELINE), { out });
  const r2 = cli(pairArgs(path.join(TRIALS, 'skill-ponytail'), BASELINE), { out });
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r2.status, 0, r2.stderr);
  const files = fs.readdirSync(out).sort();
  assert.equal(files.length, 2, `two pairs, two files: ${files.join(', ')}`);
  for (const f of files) {
    const receipt = JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
    assert.ok(f.endsWith(`-${receipt.run.import.source_sha256.slice(0, 12)}.json`), f);
  }
});

// ── AC-26: the printed lines ────────────────────────────────────────────────
test('AC-26: the CLI prints the recomputed counts and never calls a Harbor import the source\'s declaration', () => {
  const withJob = path.join(TRIALS, 'skill-planning-with-files');
  const r = cli(pairArgs(withJob, BASELINE));
  assert.equal(r.status, 0, r.stderr);
  const o = oracle({ withJob, withoutJob: BASELINE });
  const m = o.sidecars.length; const n = o.admittedInDelta;
  assert.ok(n < m, 'the plant has a left-out trial');
  const { with_skill: pw, baseline: pb } = o.perArm;
  assert.equal(pw.read + pb.read, m);
  assert.ok(r.stdout.includes(`  verification_level: DECLARED (source imported/harbor): recomputed by Driftproof from ${n} of ${m} trial files read; ${m - n} left out (with-skill ${pw.read - pw.inDelta} of ${pw.read}, baseline ${pb.read - pb.inDelta} of ${pb.read}; see notices).`), r.stdout);
  assert.doesNotMatch(r.stdout, /converted faithfully/);
  for (const notice of o.notices) assert.ok(r.stdout.includes(`  notice: ${notice}`), notice);
  // One arm: only the arm read is counted.
  const one = cli(['--from', 'harbor', BASELINE, '--arm', 'baseline']);
  assert.equal(one.status, 0, one.stderr);
  const oo = oracle({ withoutJob: BASELINE, arm: 'baseline' });
  const ob = oo.perArm.baseline;
  assert.ok(one.stdout.includes(`recomputed by Driftproof from ${oo.admittedInDelta} of ${ob.read} trial files read; ${ob.read - oo.admittedInDelta} left out (baseline ${ob.read - ob.inDelta} of ${ob.read}; see notices).`), one.stdout);
});

test('AC-26: a notice says the delta covers finished trials only when the arms leave out different shares', () => {
  // planning-with-files: one trial of six left out (AgentTimeoutError) against none.
  const withJob = path.join(TRIALS, 'skill-planning-with-files');
  const receipt = importPair(withJob, BASELINE);
  const o = oracle({ withJob, withoutJob: BASELINE });
  assert.deepEqual(trace(receipt, o), []);
  const want = fillSeq(T.shares, 'count', [1, readArm(withJob).length, 0, readArm(BASELINE).length]);
  assert.ok(receipt.run.import.notices.includes(want), JSON.stringify(receipt.run.import.notices));
  // Plant: the notice removed fails the reader.
  assert.notDeepEqual(trace(doctor(receipt, (r) => { r.run.import.notices = r.run.import.notices.filter((x) => x !== want); }), o), []);
  // The same share in both arms: one of six each, no notice.
  const b = copyArm(BASELINE);
  editTrials(b, first('application-debug'), (d) => { d.exception_info = { exception_type: 'AgentTimeoutError', exception_message: 'm', exception_traceback: 't', occurred_at: d.started_at }; });
  assert.equal(readArm(b).length, readArm(withJob).length);
  const even = importPair(withJob, b);
  assert.deepEqual(trace(even, oracle({ withJob, withoutJob: b })), []);
  assert.ok(!even.run.import.notices.some((x) => templateRe(T.shares).test(x)), JSON.stringify(even.run.import.notices));
});
