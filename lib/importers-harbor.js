// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { sealReceipt } = require('./receipt');
const { inferProvider } = require('./provider');
const { registryStatus } = require('./models');
const sha256 = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
const {checkImportInput} = require('./importers');
const { createHarborCore, opposedToPublished, HARBOR_TOOLS, HarborRefused, MAX_ENTRIES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, ARM, MODES, PLAIN, KEY, byCodeUnit, isObject, shown } = require('./import-core/harbor.cjs');
const refuse = msg => { throw new HarborRefused(msg); };
const core = createHarborCore({...config, inferProvider, registryStatus, sha256});
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

  const result = core.analyze({ arms, comparative, oneMode, reward, skill, importedAt });
  sealReceipt(result.receipt);
  return result;
}
module.exports = { importHarbor, opposedToPublished, HARBOR_TOOLS, HarborRefused };
