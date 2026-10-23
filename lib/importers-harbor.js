// SPDX-License-Identifier: Apache-2.0
'use strict';

// Receipt interop: Harbor job directories (spec 266, spec 118 Layout B).
//
//   --with <dir> --without <dir>   two jobs (or two folders of jobs), declared by the user as the
//                                  with-skill arm and the baseline, into one two-arm receipt
//   <dir> --arm with-skill|baseline   one job as one arm
//
// What is read, and why it is trusted (AC-22): a trial's own result.json, at <job>/<trial>/
// result.json and nowhere else, its folder named for the trial. Harbor writes that file into the
// trial folder itself and gives the agent and the verifier their own subfolders of it, so nothing
// inside a trial folder is listed or read: a result.json a skill or a test script wrote under
// agent/ or verifier/ is never a trial here. The scores are recomputed from the trials' rewards;
// no figure of the source's own (a job's stats, a lift, a verdict) is read. Every notice and every
// reason written is one of the fixed texts below, its slots filled from the trials (AC-25).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RECEIPT_SCHEMA_VERSION, RUNNER_VERSION } = require('../config');
const { sealReceipt, comparisonOf } = require('./receipt');
const { mean, stddev, round } = require('./stats');
const { outcomeFor } = require('./run');
const { inferProvider } = require('./provider');
const { registryStatus } = require('./models');
const { placeCounts } = require('./counts');
const { IMPORT_METHOD, checkImportInput, importDiagnostic } = require('./importers');

const HARBOR_TOOLS = ['harbor'];
const MAX_ENTRIES = 10000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
// The fields of a trial's config that name the one trial, its job and its task (AC-23).
const PER_TRIAL = ['trial_name', 'trials_dir', 'job_id', 'task', 'source_trial'];
const ARM = { with_skill: 'with-skill', baseline: 'baseline' };
const MODES = ['with_skill', 'baseline'];

// Source text that may be copied (AC-14), and the shapes of the slots in the fixed texts.
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/;
const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,127}$/;
const KEY = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_PATH = /^(?:~|file:\/\/|\/home\/|\/Users\/|\/root\/|[A-Za-z]:[\\/])/;
const HOME_IN_TEXT = /~\/|\/home\/|\/Users\/|\/root\/|file:\/\//;

// The fixed texts (spec 266 AC-25).
const TEXT = {
  pairing: 'the pairing is declared by the user: --with names the with-skill arm and --without the baseline; Harbor records neither',
  oneArm: (arm) => `one job is imported as the ${arm} arm, declared by --arm; the other arm is empty and the comparison is null`,
  keyOnly: (key) => `scores are verifier_result.rewards.${key}, the only numeric reward key`,
  keyNamed: (key) => `scores are verifier_result.rewards.${key}, named by --reward`,
  skillDeclared: 'skill.name is declared by --skill; Harbor records no skill name',
  skillUnknown: 'skill.name is unknown: Harbor records no skill name, and --skill was not given',
  agentDiffer: (paths) => `the arms' settings (config without trial_name, trials_dir, job_id, task and source_trial; local paths compared by their sha256) differ at: ${paths}`,
  agentSame: 'the arms\' settings (config without trial_name, trials_dir, job_id, task and source_trial; local paths compared by their sha256) do not differ',
  exception: (arm, n, type) => `${arm}: ${n} trial(s) left out with exception type ${type}`,
  unfinished: (arm, n) => `${arm}: ${n} trial(s) left out with no finished_at time`,
  noNumber: (arm, n, key) => `${arm}: ${n} trial(s) left out with no number under verifier_result.rewards.${key}`,
  shares: (kw, mw, kb, mb) => `the arms leave out different shares of their trials for an exception, no finished_at time or no reward (with-skill ${kw} of ${mw}, baseline ${kb} of ${mb}): the delta covers finished trials with a reward only, and a trial left out counts as neither a pass nor a failure`,
  modelUsage: (n) => `${n} trial(s) record agent_result.model_usage under a model other than run.model_id; the economics count each trial's agent_result totals whole`,
  emptyFolders: (arm, n) => `${arm}: ${n} trial folder(s) hold no result.json and were not read`,
  jobLevel: (n) => `${n} job-level result.json file(s) were not read: no figure in this receipt comes from them`,
  taskIds: (n) => `${n} task checksum(s) appear in both arms under different task_id values, so those tasks are not matched`,
  labels: (n) => `${n} case(s) have a task name that is not a plain name; their label is left out`,
  labelsDiffer: (n) => `${n} case(s) have trials that give different task names; their label is left out`,
  noModel: 'no trial records a model: run.model_id is unknown',
  noDate: 'no trial records a started_at time: run.date_utc is null',
  economics: 'economics cover the matched cases only; a call is one trial, one agent episode that may make many model calls; n_input_tokens includes cached tokens; cost_usd is the agent\'s own estimate at list price',
  excludedCase: (id, modes, reason) => `case ${JSON.stringify(id)} (${modes.join(', ')}): ${reason}`,
  noMatched: 'no usable matched case remains: the comparison is unavailable',
  drawException: (type) => `the trial raised ${type} (exception_info); its reward is not read`,
  drawUnfinished: 'the trial records no finished_at time; its reward is not read',
  drawNoNumber: (key) => `the trial carries no number under verifier_result.rewards.${key}`,
  caseAllOut: 'every trial of this arm was left out; each is listed in excluded_draws',
  caseConflict: 'the admitted trials differ in verifier or timeout settings',
};

class HarborRefused extends Error {
  constructor(message) { super(importDiagnostic(message)); }
}
const refuse = (msg) => { throw new HarborRefused(msg); };
// A source value in a refusal: JSON-quoted, cut to 80 characters (AC-14).
const shown = (v) => (v === null || v === undefined ? 'none' : JSON.stringify(String(v).slice(0, 80)));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : isObject(v) ? Object.fromEntries(Object.keys(v).sort(byCodeUnit).map((k) => [k, sortKeys(v[k])])) : v);
const num = (x) => typeof x === 'number' && Number.isFinite(x);

// ── reading the trial files (AC-15, AC-22) ──────────────────────────────────
// One listing, sorted by name in UTF-16 code unit order, so the system's order never matters.
function listing(dir, budget, shownDir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { refuse(`${shownDir} cannot be listed`); }
  budget.entries += entries.length;
  if (budget.entries > MAX_ENTRIES) refuse(`the import lists more than ${MAX_ENTRIES} directory entries (limit)`);
  return entries.map((e) => ({ name: e.name, link: e.isSymbolicLink(), dir: e.isDirectory(), file: e.isFile() })).sort((a, b) => byCodeUnit(a.name, b.name));
}
// A result.json the importer would open: none, or a regular file. A link there is refused.
function resultAt(dir, shownFile) {
  let st;
  try { st = fs.lstatSync(path.join(dir, 'result.json')); } catch (_e) { return null; }
  if (st.isSymbolicLink()) refuse(`${shownFile} is a symbolic link; links are not followed`);
  if (!st.isFile()) refuse(`${shownFile} is not a regular file`);
  return { file: path.join(dir, 'result.json'), size: st.size };
}
// Sizes are added before a level's files are read, so an import over the total is refused unread.
function addSizes(found, budget) {
  for (const f of found) budget.bytes += f.size;
  if (budget.bytes > MAX_TOTAL_BYTES) refuse('the trial files of this import are larger than 64 MiB in total (limit)');
}
// Read once: the bytes hashed are the bytes parsed (AC-10). The file is opened without following a
// link, and the bytes actually read are added up, so a file swapped or grown after its check is
// still caught (AC-15).
function readBounded(file, rel, budget) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (e) { refuse(e && e.code === 'ELOOP' ? `${rel} is a symbolic link; links are not followed` : `${rel} cannot be opened`); }
  try {
    if (!fs.fstatSync(fd).isFile()) refuse(`${rel} is not a regular file`);
    const limit = Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - budget.read);
    const chunks = [];
    let n = 0;
    while (n <= limit) {
      const buf = Buffer.allocUnsafe(Math.min(1 << 20, limit + 1 - n));
      const got = fs.readSync(fd, buf, 0, buf.length, null);
      if (!got) break;
      chunks.push(buf.subarray(0, got));
      n += got;
    }
    if (n > MAX_FILE_BYTES) refuse(`${rel} is larger than 16 MiB (limit)`);
    budget.read += n;
    if (budget.read > MAX_TOTAL_BYTES) refuse('the trial files of this import are larger than 64 MiB in total (limit)');
    return Buffer.concat(chunks, n);
  } finally { fs.closeSync(fd); }
}
function parse(f, rel, budget) {
  const bytes = readBounded(f.file, rel, budget);
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch (_e) { refuse(`${rel} is not JSON`); }
  try { checkImportInput(doc); } catch (e) { refuse(`${rel}: ${e.message}`); }
  return { bytes, doc };
}
const isTrialDoc = (d) => isObject(d) && typeof d.trial_name === 'string';
const isJobDoc = (d) => isObject(d) && !Object.hasOwn(d, 'trial_name') && isObject(d.stats);

// The trial files of one arm. `dir` is one job (its folders hold trial results) or a folder of
// jobs; nothing inside a trial folder is listed.
function readArm(dir, mode, budget, flag) {
  const arm = ARM[mode];
  let st;
  try { st = fs.lstatSync(dir); } catch (_e) { refuse(`${flag} names no file or directory`); }
  if (st.isSymbolicLink()) refuse(`${flag} is a symbolic link; links are not followed`);
  if (!st.isDirectory()) refuse(`${flag} is not a directory`);
  const meta = { jobLevel: 0, empty: 0 };
  const top = listing(dir, budget, `${arm}/`);
  for (const e of top) if (e.link && (e.name === 'result.json' || !e.file)) refuse(`${arm}/${e.name} is a symbolic link; links are not followed`);
  // The directory's own result.json can only be a job's.
  const own = resultAt(dir, `${arm}/result.json`);
  if (own) {
    addSizes([own], budget);
    if (!isJobDoc(parse(own, `${arm}/result.json`, budget).doc)) refuse(`${arm}/result.json is not a job result: give the job, or the folder of jobs, the trial is in`);
    meta.jobLevel++;
  }
  const level = top.filter((e) => e.dir && !e.link).map((e) => ({ name: e.name, found: resultAt(path.join(dir, e.name), `${arm}/${e.name}/result.json`) }));
  addSizes(level.filter((x) => x.found).map((x) => x.found), budget);
  const read = level.filter((x) => x.found).map((x) => ({ ...x, rel: `${x.name}/result.json`, ...parse(x.found, `${arm}/${x.name}/result.json`, budget) }));
  for (const r of read) if (!isTrialDoc(r.doc) && !isJobDoc(r.doc)) refuse(`${arm}/${r.rel} is neither a Harbor trial result nor a job result`);
  const trialsHere = read.filter((r) => isTrialDoc(r.doc));
  let trials;
  if (trialsHere.length) {
    // One job: its folders are trial folders.
    if (trialsHere.length !== read.length) refuse(`${arm}/ holds both trial results and job results one folder down; give one job, or one folder of jobs`);
    trials = trialsHere.map((r) => ({ rel: r.rel, folder: r.name, bytes: r.bytes, doc: r.doc }));
    meta.empty = level.filter((x) => !x.found).length;
  } else {
    // A folder of jobs: each job's folders are trial folders.
    meta.jobLevel += read.length;
    const found = [];
    for (const job of level) {
      const inner = listing(path.join(dir, job.name), budget, `${arm}/${job.name}/`);
      for (const e of inner) if (e.link && (e.name === 'result.json' || !e.file)) refuse(`${arm}/${job.name}/${e.name} is a symbolic link; links are not followed`);
      for (const e of inner.filter((x) => x.dir && !x.link)) {
        const f = resultAt(path.join(dir, job.name, e.name), `${arm}/${job.name}/${e.name}/result.json`);
        if (f) found.push({ f, folder: e.name, rel: `${job.name}/${e.name}/result.json` }); else meta.empty++;
      }
    }
    addSizes(found.map((x) => x.f), budget);
    trials = found.map((x) => ({ rel: x.rel, folder: x.folder, ...parse(x.f, `${arm}/${x.rel}`, budget) }));
    for (const t of trials) if (!isTrialDoc(t.doc)) refuse(`${arm}/${t.rel} is not a Harbor trial result`);
  }
  if (!trials.length) refuse(`${flag} holds no trial result.json (a trial file is <job>/<trial>/result.json)`);
  for (const t of trials) {
    const d = t.doc;
    const where = `${arm}/${t.rel}`;
    // The trial's path is copied into run.import.sidecars, so each folder in it is a plain name.
    for (const s of t.rel.split('/').slice(0, -1)) if (!PLAIN.test(s)) refuse(`${arm}/: the folder name ${shown(s)} is not a plain name`);
    if (d.trial_name !== t.folder || (isObject(d.config) && Object.hasOwn(d.config, 'trial_name') && d.config.trial_name !== t.folder)) refuse(`${where}: its folder is not named for its trial (trial_name ${shown(d.trial_name)})`);
    if (d.step_results !== null && d.step_results !== undefined) refuse(`${where} has step_results: multi-step trials are not imported`);
    if (!isObject(d.task_id) || typeof d.task_checksum !== 'string' || !d.task_checksum) refuse(`${where} carries no task_id object and task_checksum`);
    if (typeof d.id !== 'string' || !d.id) refuse(`${where} carries no trial id`);
    if (!isObject(d.agent_info)) refuse(`${where} carries no agent_info`);
    t.mode = mode;
    t.where = where;
  }
  // The one place an arm's trials are put in path order (AC-12); every later order follows from it.
  trials.sort((a, b) => byCodeUnit(a.rel, b.rel));
  return { trials, meta };
}

// ── the trials' settings (AC-23) ────────────────────────────────────────────
// A local path stands as its own hash, so two different paths stay two settings.
const normSettings = (v) => (Array.isArray(v) ? v.map(normSettings) : isObject(v) ? Object.fromEntries(Object.keys(v).sort(byCodeUnit).map((k) => [k, normSettings(v[k])])) : typeof v === 'string' && LOCAL_PATH.test(v) ? `<local path ${sha256(v).slice(0, 12)}>` : v);
const keySeg = (k) => (KEY.test(k) ? k : '<key>');
function diffPaths(a, b, at = '') {
  if ((isObject(a) || isObject(b)) && (isObject(a) || a === undefined) && (isObject(b) || b === undefined)) {
    const x = a ?? {}; const y = b ?? {};
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => diffPaths(x[k], y[k], at ? `${at}.${keySeg(k)}` : keySeg(k)));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [at || 'config'];
}
function pathList(ps) {
  const u = [...new Set(ps)].sort(byCodeUnit);
  return u.slice(0, 20).join(', ') + (u.length > 20 ? `, and ${u.length - 20} more` : '');
}
const settingsOf = (t) => {
  const c = t.doc.config;
  if (!isObject(c)) return normSettings(c ?? null);
  return normSettings(Object.fromEntries(Object.entries(c).filter(([k]) => !PER_TRIAL.includes(k))));
};
function armSettings(trials, mode) {
  const firstSeen = settingsOf(trials[0]);
  const paths = trials.slice(1).flatMap((t) => diffPaths(firstSeen, settingsOf(t)));
  if (paths.length) refuse(`the ${ARM[mode]} arm's trials differ in their settings (config) at: ${pathList(paths)}`);
  return firstSeen;
}

// The settings a case's admitted trials must share (AC-3).
function gradingSettings(d) {
  const c = isObject(d.config) ? d.config : {};
  const a = isObject(c.agent) ? c.agent : {};
  return JSON.stringify([d.verifier_environment_mode ?? null, c.timeout_multiplier ?? null, c.agent_timeout_multiplier ?? null, c.verifier_timeout_multiplier ?? null, c.agent_setup_timeout_multiplier ?? null, c.environment_build_timeout_multiplier ?? null, sortKeys(c.verifier ?? null), a.override_timeout_sec ?? null, a.max_timeout_sec ?? null]);
}
// A trial's identity removed, the rest hashed: two files equal under it are one trial (AC-15).
function fingerprint(d) {
  const rest = Object.fromEntries(Object.entries(d).filter(([k]) => !['id', 'trial_name', 'trial_uri'].includes(k)));
  if (isObject(rest.config)) rest.config = Object.fromEntries(Object.entries(rest.config).filter(([k]) => !['trial_name', 'trials_dir', 'job_id'].includes(k)));
  return sha256(JSON.stringify(sortKeys(rest)));
}
const finishedAt = (d) => typeof d.finished_at === 'string' && ISO_UTC.test(d.finished_at) && Number.isFinite(Date.parse(d.finished_at));
const exceptionType = (info) => { const x = isObject(info) ? info.exception_type : null; return typeof x === 'string' && x.length <= 128 && CLASS_NAME.test(x) ? x : 'unreadable'; };

// ── the import ──────────────────────────────────────────────────────────────
// Two arms ({ withJob, withoutJob }) or one ({ job, arm }). `importedAt` is the one clock reading.
function importHarbor({ withJob = null, withoutJob = null, job = null, arm = null, reward = null, skill = null, importedAt = null } = {}) {
  try {
    return build({ withJob, withoutJob, job, arm, reward, skill, importedAt });
  } catch (e) {
    if (e instanceof HarborRefused) throw e;
    refuse(e && e.message ? e.message : String(e));
  }
}

function build({ withJob, withoutJob, job, arm, reward, skill, importedAt }) {
  const comparative = !job;
  if (comparative && (!withJob || !withoutJob)) refuse('--with and --without are both required');
  if (!comparative && (withJob || withoutJob)) refuse('give --with and --without, or one job with --arm, not both');
  const oneMode = arm === 'baseline' ? 'baseline' : arm === null || arm === 'with-skill' || arm === 'with_skill' ? 'with_skill' : refuse(`--arm ${shown(arm)} is neither with-skill nor baseline`);
  if (reward !== null && (typeof reward !== 'string' || !KEY.test(reward))) refuse(`--reward ${shown(reward)} is not a plain key`);
  if (skill !== null && (typeof skill !== 'string' || !PLAIN.test(skill))) refuse(`--skill ${shown(skill)} is not a plain name`);
  const dirs = comparative ? { with_skill: withJob, baseline: withoutJob } : { [oneMode]: job };
  const modes = MODES.filter((m) => dirs[m]);
  if (comparative) {
    let a; let b;
    try { a = fs.realpathSync(withJob); b = fs.realpathSync(withoutJob); } catch (_e) { a = null; b = null; }
    if (a !== null && a === b) refuse('--with and --without name the same directory: a job paired with itself reads as no lift');
  }

  // Read both arms.
  const budget = { entries: 0, bytes: 0, read: 0 };
  const arms = {};
  for (const m of modes) arms[m] = readArm(dirs[m], m, budget, comparative ? (m === 'with_skill' ? '--with' : '--without') : 'the job');
  const all = modes.flatMap((m) => arms[m].trials);
  const ids = new Set();
  const prints = new Map();
  for (const t of all) {
    if (ids.has(t.doc.id)) refuse(`trial id ${shown(t.doc.id)} is read twice (${t.where}): one trial is in both jobs, or twice in one`);
    ids.add(t.doc.id);
    const fp = fingerprint(t.doc);
    if (prints.has(fp)) refuse(`${t.where} repeats ${prints.get(fp)} apart from its id and name: one trial is counted once`);
    prints.set(fp, t.where);
  }
  const settings = {};
  for (const m of modes) settings[m] = armSettings(arms[m].trials, m);

  // One harness and one model (AC-2).
  const harnesses = [...new Set(all.map((t) => `${t.doc.agent_info.name} ${t.doc.agent_info.version}`))].sort(byCodeUnit);
  if (harnesses.length > 1) refuse(`the trials name more than one harness: ${harnesses.slice(0, 4).map(shown).join(' and ')}`);
  const name = all[0].doc.agent_info.name; const version = all[0].doc.agent_info.version;
  if (typeof name !== 'string' || !PLAIN_ID.test(name) || name.includes('//')) refuse(`the harness name ${shown(name)} is not a plain name`);
  if (typeof version !== 'string' || !PLAIN_ID.test(version) || version.includes('//')) refuse(`the harness version ${shown(version)} is not a plain version`);
  const modelOf = (t) => (isObject(t.doc.agent_info.model_info) && t.doc.agent_info.model_info.name != null ? t.doc.agent_info.model_info.name : null);
  const models = [...new Set(all.map(modelOf))].sort((a, b) => (a === null) - (b === null) || byCodeUnit(String(a), String(b)));
  if (models.length > 1) refuse(`the trials name more than one model: ${models.slice(0, 4).map(shown).join(' and ')}`);
  const recordedModel = models[0];
  if (recordedModel !== null && (typeof recordedModel !== 'string' || !PLAIN_ID.test(recordedModel) || recordedModel.includes('//'))) refuse(`the model id ${shown(recordedModel)} is not a plain model id`);
  const modelId = recordedModel === null ? 'unknown' : recordedModel;
  const providers = new Set(all.map((t) => (isObject(t.doc.agent_info.model_info) ? t.doc.agent_info.model_info.provider ?? null : null)));
  const provider = modelId === 'unknown' ? 'unknown' : providers.size === 1 && ['anthropic', 'openai'].includes([...providers][0]) ? [...providers][0] : inferProvider(modelId);

  // One reward key (AC-3).
  const numericKeys = new Set();
  for (const t of all) {
    if (t.doc.exception_info) continue;
    const rw = isObject(t.doc.verifier_result) && isObject(t.doc.verifier_result.rewards) ? t.doc.verifier_result.rewards : {};
    for (const [k, v] of Object.entries(rw)) if (typeof v === 'number') numericKeys.add(k);
  }
  const keys = [...numericKeys].sort(byCodeUnit);
  let key;
  if (reward !== null) {
    if (!numericKeys.has(reward)) refuse(`no trial carries a number under verifier_result.rewards.${reward}; the numeric keys are: ${keys.length ? keys.slice(0, 10).map(shown).join(', ') : 'none'}`);
    key = reward;
  } else if (keys.length === 1) key = keys[0];
  else if (!keys.length) refuse('no trial without an exception carries a numeric reward');
  else refuse(`the trials carry several numeric reward keys (${keys.slice(0, 10).map(shown).join(', ')}); name one with --reward`);
  if (!KEY.test(key)) refuse(`the reward key ${shown(key)} is not a plain key`);

  // Cases: task_id and task_checksum, never the name (AC-1).
  const cases = new Map();
  for (const t of all) {
    const caseKey = JSON.stringify([sortKeys(t.doc.task_id), t.doc.task_checksum]);
    const id = 'task:' + sha256(caseKey).slice(0, 16);
    if (!cases.has(id)) cases.set(id, { id, key: caseKey, names: new Set(), with_skill: [], baseline: [] });
    const c = cases.get(id);
    if (c.key !== caseKey) refuse(`two different tasks give one case id (${id}); nothing is merged`);
    c.names.add(t.doc.task_name);
    c[t.mode].push(t);
  }
  let unplain = 0; let namesDiffer = 0;
  for (const c of cases.values()) {
    const only = c.names.size === 1 ? [...c.names][0] : null;
    c.label = typeof only === 'string' && PLAIN.test(only) ? only : null;
    if (c.label === null && c.names.size === 1) unplain++;
    if (c.names.size > 1) namesDiffer++;
  }
  const ordered = [...cases.values()].sort((a, b) => byCodeUnit(a.label ?? '', b.label ?? '') || byCodeUnit(a.id, b.id));

  // Trials into samples, in path order within each case and arm (AC-4, AC-5): each arm's trials
  // are in path order already (readArm), and a case keeps their order.
  const leftOut = { with_skill: { types: new Map(), unfinished: 0, noNumber: 0 }, baseline: { types: new Map(), unfinished: 0, noNumber: 0 } };
  for (const c of ordered) {
    const admittedAll = [];
    for (const m of MODES) {
      const ts = c[m];
      const arm = { read: ts.length, samples: [], admitted: [], excluded: [] };
      ts.forEach((t, i) => {
        const d = t.doc;
        if (d.exception_info) {
          const type = exceptionType(d.exception_info);
          arm.excluded.push({ draw_index: i + 1, reason: TEXT.drawException(type) });
          leftOut[m].types.set(type, (leftOut[m].types.get(type) || 0) + 1);
          return;
        }
        const v = isObject(d.verifier_result) && isObject(d.verifier_result.rewards) ? d.verifier_result.rewards[key] : undefined;
        if (typeof v === 'number' && (!Number.isFinite(v) || v < 0 || v > 1)) refuse(`${t.where}: reward ${String(v)} under verifier_result.rewards.${key} is not a finite number from 0 to 1`);
        if (!finishedAt(d)) {
          arm.excluded.push({ draw_index: i + 1, reason: TEXT.drawUnfinished });
          leftOut[m].unfinished++;
          return;
        }
        if (typeof v !== 'number') {
          arm.excluded.push({ draw_index: i + 1, reason: TEXT.drawNoNumber(key) });
          leftOut[m].noNumber++;
          return;
        }
        arm.samples.push(v);
        arm.admitted.push(d);
        admittedAll.push(d);
      });
      c[m] = arm;
    }
    // AC-3: across both arms, or within the one arm of a one-arm import.
    c.conflict = new Set(admittedAll.map(gradingSettings)).size > 1;
  }

  // Rows, and the cases that leave the aggregates.
  const rows = [];
  const perCase = [];
  const reasons = {};
  const conflicts = new Map();
  for (const c of ordered) {
    if (c.conflict) conflicts.set(c.id, { modes: comparative ? ['with_skill', 'baseline'] : [oneMode], reason: TEXT.caseConflict });
    for (const m of MODES) {
      const a = c[m];
      if (!a.read) continue;
      const index = rows.length;
      let row;
      if (a.samples.length) {
        const mu = round(mean(a.samples));
        const sd = round(stddev(a.samples));
        row = { id: c.id, mode: m, outcome: outcomeFor(mu, sd, null), score: mu, mean: mu, stddev: sd, samples: a.samples.map((s) => round(s)), threshold: null, judge: { model_id: 'unknown', rubric_hash: null } };
      } else {
        row = { id: c.id, mode: m, case_status: 'no_observations' };
        reasons[index] = TEXT.caseAllOut;
      }
      if (c.label !== null) row.label = c.label;
      if (a.excluded.length) row.excluded_draws = a.excluded.map(({ draw_index, reason }) => ({ draw_index, reason }));
      rows.push(row);
      perCase.push({ index, counts: { generations_per_arm: a.samples.length } });
    }
  }
  let calculated;
  if (comparative) calculated = comparisonOf(rows, { comparative, conflicts, reasons });
  else {
    // lib/receipt.js leaves a conflicting case out of two arms only, so a one-arm import leaves its
    // conflicting cases out here and lists them in case order (AC-3).
    const kept = rows.map((r, i) => [r, i]).filter(([r]) => !conflicts.has(r.id));
    const keptReasons = {};
    kept.forEach(([, i], j) => { if (reasons[i]) keptReasons[j] = reasons[i]; });
    calculated = comparisonOf(kept.map(([r]) => r), { comparative, reasons: keptReasons });
    const caseIndex = new Map(ordered.map((c, i) => [c.id, i]));
    const listed = [...(calculated.aggregates.excluded_cases || []), ...[...conflicts].map(([id, x]) => ({ id, modes: x.modes, reason: x.reason }))];
    listed.sort((a, b) => caseIndex.get(a.id) - caseIndex.get(b.id));
    if (listed.length) calculated.aggregates.excluded_cases = listed;
  }
  const excluded = calculated.aggregates.excluded_cases || [];
  const out = new Set(excluded.map((e) => e.id));
  const matched = ordered.filter((c) => !out.has(c.id));

  // Economics over the matched cases' admitted trials only (AC-19).
  const econ = (m) => {
    const ds = matched.flatMap((c) => c[m].admitted);
    const meanOf = (k) => { const xs = ds.map((d) => (isObject(d.agent_result) ? d.agent_result[k] : undefined)).filter(num); return xs.length ? round(mean(xs)) : null; };
    return { call_count: ds.length, mean_input_tokens: meanOf('n_input_tokens'), mean_output_tokens: meanOf('n_output_tokens'), mean_cost_usd_per_call: meanOf('cost_usd'), median_wall_ms: null, wall_ms_p25: null, wall_ms_p75: null, wall_ms_iqr: null };
  };
  const w = econ('with_skill'); const b = econ('baseline');
  const inc = w.mean_cost_usd_per_call !== null && b.mean_cost_usd_per_call !== null ? round(w.mean_cost_usd_per_call - b.mean_cost_usd_per_call) : null;
  const economics = {
    basis: 'source-list-price-estimate',
    with_skill: w,
    baseline: b,
    skill_incremental_cost_usd_per_call: inc,
    skill_incremental_cost_usd_per_1k_calls: inc === null ? null : round(inc * 1000),
    output_tokens_delta: w.mean_output_tokens !== null && b.mean_output_tokens !== null ? round(w.mean_output_tokens - b.mean_output_tokens, 2) : null,
    median_wall_ms_delta: null,
    judge_excluded: true,
  };

  // The run's date: the earliest started_at written as an ISO 8601 UTC time (AC-11).
  const starts = all.map((t) => t.doc.started_at).filter((s) => typeof s === 'string' && ISO_UTC.test(s) && Number.isFinite(Date.parse(s)));
  const dateUtc = starts.sort((x, y) => Date.parse(x) - Date.parse(y) || byCodeUnit(x, y))[0] ?? null;

  // Provenance (AC-10).
  const triples = all.map((t) => [ARM[t.mode], t.rel, sha256(t.bytes)]).sort((x, y) => byCodeUnit(`${x[0]}/${x[1]}`, `${y[0]}/${y[1]}`));
  const sidecars = triples.map(([a, p, s]) => ({ file: `${a}/${p}`, sha256: s }));

  // The notices, each a fixed text (AC-25).
  const notices = [];
  notices.push(comparative ? TEXT.pairing : TEXT.oneArm(ARM[oneMode]));
  notices.push(reward !== null ? TEXT.keyNamed(key) : TEXT.keyOnly(key));
  notices.push(skill !== null ? TEXT.skillDeclared : TEXT.skillUnknown);
  if (comparative) {
    const ps = diffPaths(settings.with_skill, settings.baseline);
    notices.push(ps.length ? TEXT.agentDiffer(pathList(ps)) : TEXT.agentSame);
  }
  const leftOutCount = (m) => [...leftOut[m].types.values()].reduce((a, b) => a + b, 0) + leftOut[m].unfinished + leftOut[m].noNumber;
  for (const m of modes) {
    for (const type of [...leftOut[m].types.keys()].sort(byCodeUnit)) notices.push(TEXT.exception(ARM[m], leftOut[m].types.get(type), type));
    if (leftOut[m].unfinished) notices.push(TEXT.unfinished(ARM[m], leftOut[m].unfinished));
    if (leftOut[m].noNumber) notices.push(TEXT.noNumber(ARM[m], leftOut[m].noNumber, key));
    if (arms[m].meta.empty) notices.push(TEXT.emptyFolders(ARM[m], arms[m].meta.empty));
  }
  // AC-26: the arms' left-out shares, compared as whole numbers (kw * mb against kb * mw).
  if (comparative) {
    const kw = leftOutCount('with_skill'); const mw = arms.with_skill.trials.length;
    const kb = leftOutCount('baseline'); const mb = arms.baseline.trials.length;
    if (kw * mb !== kb * mw) notices.push(TEXT.shares(kw, mw, kb, mb));
  }
  const jobLevel = modes.reduce((n, m) => n + arms[m].meta.jobLevel, 0);
  if (jobLevel) notices.push(TEXT.jobLevel(jobLevel));
  if (comparative) {
    const byChecksum = (m) => {
      const by = new Map();
      for (const t of arms[m].trials) {
        if (!by.has(t.doc.task_checksum)) by.set(t.doc.task_checksum, new Set());
        by.get(t.doc.task_checksum).add(JSON.stringify(sortKeys(t.doc.task_id)));
      }
      return by;
    };
    // A checksum is unmatched only when its task_id values in the two arms share none (AC-1).
    const bw = byChecksum('with_skill'); const bb = byChecksum('baseline');
    const n = [...bw.keys()].filter((k) => bb.has(k) && ![...bw.get(k)].some((x) => bb.get(k).has(x))).length;
    if (n) notices.push(TEXT.taskIds(n));
  }
  if (unplain) notices.push(TEXT.labels(unplain));
  if (namesDiffer) notices.push(TEXT.labelsDiffer(namesDiffer));
  const otherModel = all.filter((t) => isObject(t.doc.agent_result) && isObject(t.doc.agent_result.model_usage) && Object.keys(t.doc.agent_result.model_usage).some((k) => k !== modelId)).length;
  if (otherModel) notices.push(TEXT.modelUsage(otherModel));
  if (modelId === 'unknown') notices.push(TEXT.noModel);
  if (dateUtc === null) notices.push(TEXT.noDate);
  notices.push(TEXT.economics);
  for (const e of excluded) notices.push(TEXT.excludedCase(e.id, e.modes, e.reason));
  if (comparative && calculated.comparison.delta === null) notices.push(TEXT.noMatched);

  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    // v0.15 (spec 438): a skill, and a delivery the trials do not record, so none is invented.
    skill: { name: skill !== null ? skill : 'unknown', version: 'unknown', content_hash: null, unit: 'skill' },
    suite: { format: 'harbor/task', suite_hash: null, case_count: ordered.length },
    run: {
      model_id: modelId,
      model_release_date: null,
      provider,
      surface: 'external',
      delivery: 'unknown',
      source: 'imported/harbor',
      runner_version: RUNNER_VERSION,
      date_utc: dateUtc,
      registry: registryStatus(modelId),
      transcripts: 'none',
      judge: { temperature: null, sampling: 'external', surface: 'external', model_id: 'unknown', prompt_template_hash: null },
      answered_by: { kind: 'external', attested: false, reported_model: null, reported_models: null, isolation: 'none' },
      harness: { name, version },
      import: { tool: 'harbor', format: 'result.json', format_version: null, source_sha256: sha256(JSON.stringify(triples)), imported_at: importedAt, comparison_method: IMPORT_METHOD, sidecars, notices },
    },
    results: { cases: rows, aggregates: calculated.aggregates },
    comparison: calculated.comparison,
    verification_level: 'DECLARED',
    economics,
    receipt_hash: '',
  };
  placeCounts(receipt, perCase);
  if (HOME_IN_TEXT.test(JSON.stringify(receipt))) refuse('the receipt would carry a local path copied from the source; nothing is written');
  sealReceipt(receipt);
  // AC-26: per arm read, the trial files read and the trials whose rewards enter the delta.
  const perArm = Object.fromEntries(modes.map((m) => [m, { read: arms[m].trials.length, inDelta: matched.reduce((n, c) => n + c[m].samples.length, 0) }]));
  const inDelta = modes.reduce((n, m) => n + perArm[m].inDelta, 0);
  return { receipt, counts: { read: all.length, inDelta, arms: perArm } };
}

// The direction a receipt's delta points, read from its band (AC-17), against a published verdict.
function opposedToPublished(receipt, verdict) {
  const c = receipt && isObject(receipt.comparison) ? receipt.comparison : {};
  const d = c.delta; const u = c.delta_uncertainty;
  const receiptDirection = num(d) && num(u) && Math.abs(d) > u ? (d > 0 ? 'up' : 'down') : 'none';
  const publishedDirection = verdict === 'beats placebo' ? 'up' : verdict === 'worse than placebo' ? 'down' : 'none';
  return { receipt_direction: receiptDirection, published_direction: publishedDirection, opposite: receiptDirection !== 'none' && publishedDirection !== 'none' && receiptDirection !== publishedDirection };
}

module.exports = { importHarbor, opposedToPublished, HARBOR_TOOLS, HarborRefused };
