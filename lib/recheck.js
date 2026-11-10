// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 723. The folder seals a local setup, not an author or a remote service.
// The existing runner owns execution, isolation, sampling and receipt writing.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const config = require('../config');
const { loadSubject, readRequired, parseSkillMeta, IGNORE_FILES } = require('./skill');
const { canonicalize, sha256 } = require('./canonical');
const provider = require('./provider');
const judge = require('./judge');
const runner = require('./run');
const { SAMPLING } = require('./sampling');
const { assertRegistered } = require('./models');
const { DEFAULT_CAPTURE, CAPTURE_MODES } = require('./capture');
const { BudgetTracker, estimateRunCostUSD } = require('./cost');
const { validateReceipt, verifyReceiptHash, readReceiptFile, fileSlug } = require('./receipt');
const { buildDriftReport } = require('./diff');
const { receiptAggregatesOnly } = require('./verdict');
const { isSmoke } = require('./smoke');
const { invisibleShown, shellArg } = require('./names');
const { CLAUSES } = require('./plain');
const { stubEnabled } = require('./stub');

const CAVEAT = 'A separation between dates cannot be attributed to the model, the harness or chance.';
// A-723-10: the closing words, and the limits on what a receipt folder can make history print.
const SEPARATED = 'The same tests read differently';
const NO_SEPARATION = 'No separation detected between dates; this is not evidence that nothing changed.';
const NOTHING_TO_COMPARE = 'Nothing to compare yet: no two results could be compared.';
const FIELD_MAX = 300;
const HISTORY_MAX_ROWS = 100;
// The differ's capital labels in the plain words of spec 742's mapping. The `differ` block keeps them as written.
const PLAIN_LABELS = [['NO SEPARATION DETECTED', 'No separation detected'], ['DRIFT', 'A separation detected, downward'],
  ['IMPROVED', 'A separation detected, upward'], ['MIXED', 'A separation detected both ways'],
  ['INCONCLUSIVE', 'Inconclusive'], ['NOT MEASURED', 'Not measured'], ['REFUSED', 'Refused']];
const NEW_FOLDER = "save a new recheck folder with recheck init --trusted-skill; this folder's readings stay comparable only with each other";
const IGNORED_RC = new Set(['max_cases', 'samples', 'judge_model', 'capture']);
const INIT_OPTIONS = new Set(['out', 'cwd', 'suite', 'models', 'samples', 'placebo', 'judge-model',
  'capture', 'timeout', 'max-cases', 'max-calls', 'max-usd', 'concurrency', 'trusted-skill']);
function refuse(message, code = 'RECHECK_REFUSED') {
  throw Object.assign(new Error('recheck refused: ' + message), { code });
}
function same(a, b) { return canonicalize(a) === canonicalize(b); }
function localPath(rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /[\\:\x00-\x1f\x7f]/.test(rel)
      || rel.split('/').some(p => !p || p === '.' || p === '..')) refuse('a saved path is not folder-relative');
  return rel;
}
function capped(value) {
  const text = String(value);
  if (text.length <= FIELD_MAX) return text;
  const end = text.charCodeAt(FIELD_MAX - 1);
  return text.slice(0, end >= 0xd800 && end <= 0xdbff ? FIELD_MAX - 1 : FIELD_MAX) + ' [cut, ' + text.length + ' characters in all]';
}
const shownName = value => invisibleShown(capped(value));
function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
}
function plainDir(dir) {
  const st = lstatOrNull(dir);
  if (!st) refuse('the folder ' + shownName(path.basename(dir)) + ' does not exist');
  if (!st.isDirectory() || st.isSymbolicLink()) refuse('a folder is missing or is a symbolic link');
}
// A-723-10: a refusal says what happened in words, never a raw Node error or a whole path.
const ABSOLUTE_PATH = /(?<![^\s'"(=])(?:\/[^\s'"():,]+)+\/?|(?<![^\s'"(=])[A-Za-z]:\\[^\s'"():,]+/g;
function refusalWords(e) {
  const leaf = p => path.basename(String(p).replace(/\\/g, '/').replace(/\/+$/, ''));
  if (e && typeof e.syscall === 'string') {
    const name = e.path ? shownName(leaf(e.path)) : 'a file';
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return name + ' does not exist';
    if (e.code === 'EEXIST') return name + ' already exists';
    if (e.code === 'EACCES' || e.code === 'EPERM') return 'permission was refused for ' + name;
    return name + ' could not be read or written (' + e.code + ')';
  }
  return String(e && e.message).replace(ABSOLUTE_PATH, leaf);
}
// The path as it would be with its folders made, so a link above a new folder is read where it leads.
function realOfNew(p) {
  let head = p; const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(head), ...tail); } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      const up = path.dirname(head);
      if (up === head) return p;
      tail.unshift(path.basename(head)); head = up;
    }
  }
}
function insideFolder(p, folder) {
  const rel = path.relative(folder, p);
  return !rel || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
const savedNameOk = name => typeof name === 'string' && name.length > 0 && name.length <= 255 && !/[\x00-\x1f\x7f]/.test(name);
function within(root, rel) {
  localPath(rel);
  let current = root;
  plainDir(current);
  const parts = rel.split('/');
  for (const part of parts.slice(0, -1)) { current = path.join(current, part); plainDir(current); }
  return path.join(root, rel);
}
function bounded(file, bound = config.SKILL_MAX_BYTES) {
  return readRequired(file, path.basename(file), bound, 'SKILL_MAX_BYTES');
}
function json(file) {
  try { return JSON.parse(bounded(file).toString('utf8')); }
  catch (e) { refuse(path.basename(file) + ' is unreadable (' + e.code + ')'); }
}
function privateManifest(manifest) {
  const text = JSON.stringify(manifest);
  // The allowlist holds no raw environment or credential values. Route values are hashes.
  if (require('./hygiene').scanContent('recheck.json', text).length || text.includes('@'))
    refuse('saved settings or filenames contain private data; use non-sensitive names');
}
function numeric(value, name, decimal = false) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !(decimal ? /^[0-9]+(\.[0-9]+)?$/ : /^[1-9][0-9]*$/).test(text))
    refuse(name + ' needs a positive ' + (decimal ? 'number' : 'integer'));
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || (!decimal && !Number.isSafeInteger(n))) refuse(name + ' is outside its supported range');
  return n;
}
function resolveSettings(subject, options) {
  for (const key of Object.keys(options)) if (!INIT_OPTIONS.has(key)) refuse('unknown init option ' + key);
  const cwd = path.resolve(options.cwd || process.cwd());
  const isDir = fs.statSync(subject).isDirectory();
  const rc = Object.create(null), origins = Object.create(null);
  const loadRc = (dir, source, ignored = new Set()) => {
    const file = path.join(dir, '.driftproofrc');
    if (!fs.existsSync(file)) return;
    const values = json(file);
    if (!values || typeof values !== 'object' || Array.isArray(values)) refuse('.driftproofrc must be an object');
    for (const [key, value] of Object.entries(values)) if (!ignored.has(key)) { rc[key] = value; origins[key] = source; }
  };
  if (!isDir || path.resolve(subject) !== cwd) loadRc(cwd, 'working-directory');
  if (isDir) loadRc(subject, 'subject', IGNORED_RC);
  const sources = {};
  const pick = (flag, key, fallback) => {
    const fromFlag = Object.hasOwn(options, flag);
    const fromRc = rc[key] !== undefined && rc[key] !== null;
    sources[key] = fromFlag ? 'flag' : fromRc ? origins[key] : 'default';
    return fromFlag ? options[flag] : fromRc ? rc[key] : fallback;
  };
  const rawModels = pick('models', 'models', 'haiku');
  if (typeof rawModels !== 'string' || !/^[A-Za-z0-9._-]+(,[A-Za-z0-9._-]+)*$/.test(rawModels))
    refuse('models needs a comma-separated list of model ids');
  const models = rawModels.split(',').map(provider.resolveModel);
  if (!models.length || new Set(models).size !== models.length) refuse('models must be distinct');
  const judgeChoice = pick('judge-model', 'judge_model', null);
  if (judgeChoice !== null && (typeof judgeChoice !== 'string' || !/^[A-Za-z0-9._-]+$/.test(judgeChoice))) refuse('judge-model needs a model id');
  const judges = models.map(m => judgeChoice ? provider.resolveModel(judgeChoice) : m);
  for (const m of [...models, ...judges]) assertRegistered(m, 'model');
  const samples = numeric(pick('samples', 'samples', config.DEFAULT_JUDGE_SAMPLES), 'samples');
  const maxCases = pick('max-cases', 'max_cases', null);
  const settings = {
    models, judge_models: judges, samples, draws_cap: SAMPLING.max,
    capture: pick('capture', 'capture', DEFAULT_CAPTURE),
    placebo: options.placebo === true,
    // A-723-7: only the flag sets the lane, so no configuration file can claim a subject is the person's own.
    trusted: options['trusted-skill'] === true,
    max_cases: maxCases === null ? null : numeric(maxCases, 'max-cases'),
    max_calls: numeric(pick('max-calls', 'max_calls', config.DEV_MAX_CALLS), 'max-calls'),
    max_usd: numeric(pick('max-usd', 'max_usd', config.DEV_MAX_USD), 'max-usd', true),
    concurrency: numeric(pick('concurrency', 'concurrency', 1), 'concurrency'),
  };
  if (Object.hasOwn(options, 'placebo') && typeof options.placebo !== 'boolean') refuse('placebo is a flag without a value');
  if (Object.hasOwn(options, 'trusted-skill') && typeof options['trusted-skill'] !== 'boolean') refuse('trusted-skill is a flag without a value');
  if (!CAPTURE_MODES.includes(settings.capture)) refuse('capture needs ' + CAPTURE_MODES.join(', '));
  const timeout = Object.hasOwn(options, 'timeout') ? numeric(options.timeout, 'timeout') * 1000 : null;
  if (timeout !== null && (!Number.isSafeInteger(timeout) || timeout > 2147478647)) refuse('timeout exceeds the supported timer range');
  const timeFor = m => runner.resolveCallTimeoutMs(provider.surfaceForModel(m), timeout === null ? { capture: settings.capture } : { timeoutMs: timeout });
  settings.timeout = { explicit_ms: timeout, generation_ms: Object.fromEntries(models.map(m => [m, timeFor(m)])),
    judge_ms: Object.fromEntries(judges.map(m => [m, timeFor(m)])) };
  Object.assign(sources, { draws_cap: 'default', placebo: Object.hasOwn(options, 'placebo') ? 'flag' : 'default',
    trusted: Object.hasOwn(options, 'trusted-skill') ? 'flag' : 'default',
    timeout: timeout === null ? 'default' : 'flag' });
  return { settings, sources };
}
function procedureFor(settings) {
  // A-723-7: a folder saved with no such key is on the isolated lane, as it always was.
  const trusted = settings.trusted === true;
  const lane = model => provider.isSubscriptionSurface(provider.surfaceForModel(model)) ? (trusted ? 'same-user' : 'eval-user') : 'none';
  const route = model => {
    const r = provider.callRoute(model, { trusted });
    return { resolved_by: r.resolvedBy, custom: r.custom, sha256: r.url ? sha256(r.url) : null,
      routing: Object.fromEntries(provider.ROUTING_VARIABLES.map(key => [key,
        r.routing[key] === undefined ? { set: false, sha256: null } : { set: true, sha256: sha256(String(r.routing[key])) }])) };
  };
  return {
    sampling: { ...SAMPLING },
    // Templates and parsers can change without a model id changing.
    judge_template: judge.promptTemplateHash(), criteria_template: judge.criteriaTemplateHash(),
    judge_code: judge.JUDGE_CODE_REVISION,
    targets: settings.models.map((model, i) => {
      const judgeModel = settings.judge_models[i];
      const opts = settings.timeout.explicit_ms === null ? { capture: settings.capture } : { timeoutMs: settings.timeout.explicit_ms };
      return { model, surface: provider.surfaceForModel(model), route: route(model),
        generation_timeout_ms: runner.resolveCallTimeoutMs(provider.surfaceForModel(model), opts),
        judge_model: judgeModel, judge_settings: judge.judgeSettings(settings.samples, judgeModel),
        judge_route: route(judgeModel), judge_timeout_ms: runner.resolveCallTimeoutMs(provider.surfaceForModel(judgeModel), opts),
        isolation: lane(model), judge_isolation: lane(judgeModel) };
    }),
  };
}
function writeNew(file, bytes) {
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
}
function initRecheck(subject, options = {}) {
  if (typeof subject !== 'string' || /[\x00-\x1f\x7f]/.test(subject)) refuse('give one subject path without control characters');
  const cwd = path.resolve(options.cwd || process.cwd());
  const input = path.resolve(cwd, subject);
  const out = path.resolve(cwd, options.out || 'recheck');
  if (fs.existsSync(out) || (() => { try { fs.lstatSync(out); return true; } catch (e) { if (e.code !== 'ENOENT') throw e; return false; } })())
    refuse('the output folder already exists; choose a new folder');
  const copied = new Map();
  const capture = file => {
    const abs = path.resolve(file);
    if (!copied.has(abs)) copied.set(abs, bounded(abs));
    return copied.get(abs);
  };
  const suiteInput = options.suite === undefined ? undefined : path.resolve(cwd, String(options.suite));
  const skill = loadSubject(input, { suite: suiteInput, readFile: capture });
  if (!skill.suite.caseCount) refuse('the suite has no cases');
  // A-723-10: inside the skill, the saved folder would become bundled content and change its hash.
  if (skill.unit === 'skill' && insideFolder(realOfNew(out), fs.realpathSync(input))) refuse('the output folder is inside the skill, which would change its content hash; choose a folder outside it');
  if (!lstatOrNull(path.dirname(out))) refuse('the folder that would hold ' + shownName(path.basename(out)) + ' does not exist; create it first or choose another --out');
  const { settings, sources } = resolveSettings(input, { ...options, cwd });
  if (settings.capture === 'repository' && settings.trusted) refuse('repository capture requires the isolated lane, so --trusted-skill cannot be saved with it');
  if (settings.capture === 'repository' && (settings.models.length !== 1 || settings.concurrency !== 1))
    refuse('repository capture requires one model and concurrency 1');
  if (settings.capture === 'files' && !stubEnabled() && settings.models.some(m => provider.isMeteredSurface(provider.surfaceForModel(m))))
    refuse('capture files needs a CLI surface, because this surface has no tools and no working directory; every saved run would refuse, so nothing was saved');
  const context = skill.unit === 'context_file';
  // A-723-10: the copy sits in a folder called subject, so a name read from the folder is kept here.
  const subjectName = !context && !parseSkillMeta(skill.skillMd).name ? skill.name : undefined;
  if (subjectName !== undefined && !savedNameOk(subjectName)) refuse('the skill folder name cannot be saved; rename the folder');
  const subjectPath = context ? 'subject/' + path.basename(input) : 'subject';
  const suitePath = context ? 'suite.json' : 'subject/evals/evals.json';
  const files = [];
  for (const [file, bytes] of copied) {
    const rel = context ? (file === input ? subjectPath : suitePath) : 'subject/' + path.relative(input, file).split(path.sep).join('/');
    localPath(rel); files.push({ path: rel, sha256: sha256(bytes), bytes });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    version: 1, subject: { kind: skill.unit, path: subjectPath, ...(subjectName === undefined ? {} : { name: subjectName }) }, suite: { path: suitePath },
    files: files.map(({ path: p, sha256: hash }) => ({ path: p, sha256: hash })),
    settings, sources, procedure: procedureFor(settings),
  };
  privateManifest(manifest);
  // All validation precedes the exclusive mkdir. An existing destination is never reused.
  fs.mkdirSync(out, { mode: 0o700 });
  try {
    for (const f of files) {
      const dest = path.join(out, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 }); writeNew(dest, f.bytes);
    }
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    writeNew(path.join(out, 'recheck.json'), bytes);
    writeNew(path.join(out, 'recheck.sha256'), sha256(bytes) + '\n');
    fs.mkdirSync(path.join(out, 'receipts'), { mode: 0o700 });
  } catch (e) { fs.rmSync(out, { recursive: true, force: true }); throw e; }
  return manifest;
}
function inventory(root, rel = '', found = [], depth = 0, state = { entries: 0 }) {
  if (depth > config.SKILL_MAX_DEPTH + 1) refuse('the saved folder exceeds the directory depth bound');
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    // A-723-10: the names the loader ignores, such as a Finder .DS_Store, are never saved and never read.
    if (IGNORE_FILES.has(e.name)) continue;
    if (++state.entries > (config.SKILL_MAX_FILES + 2) * (config.SKILL_MAX_DEPTH + 2))
      refuse('the saved folder exceeds the entry bound');
    const name = rel ? rel + '/' + e.name : e.name;
    if (e.isSymbolicLink()) refuse('a saved entry is a symbolic link');
    if (e.isDirectory()) inventory(root, name, found, depth + 1, state);
    else if (e.isFile()) found.push(name);
    else refuse('a saved entry is not a regular file');
  }
  return found.sort();
}
function openFrozen(folder) {
  const root = path.resolve(folder); plainDir(root);
  const bytes = bounded(within(root, 'recheck.json'));
  const seal = bounded(within(root, 'recheck.sha256'), 256).toString('utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(seal) || sha256(bytes) !== seal) refuse('recheck.json changed or its seal is invalid');
  let m; try { m = JSON.parse(bytes); } catch (_) { refuse('recheck.json is not JSON'); }
  if (!m || m.version !== 1 || !['skill', 'context_file'].includes(m.subject?.kind)
      || !Array.isArray(m.files) || !m.files.length || m.files.length > config.SKILL_MAX_FILES + 2
      || !m.settings || !m.procedure || (m.subject.name !== undefined && !savedNameOk(m.subject.name))) refuse('the saved configuration is not supported');
  privateManifest(m);
  localPath(m.subject.path); localPath(m.suite.path);
  if (m.subject.path !== 'subject' && !(m.subject.kind === 'context_file' && m.subject.path.startsWith('subject/')))
    refuse('the saved subject must be inside subject/');
  if (m.suite.path !== (m.subject.kind === 'skill' ? 'subject/evals/evals.json' : 'suite.json'))
    refuse('the suite path is not supported');
  const expected = m.files.map(f => localPath(f.path)).sort();
  if (new Set(expected).size !== expected.length) refuse('the saved file list has duplicate paths');
  if (expected.some(p => !p.startsWith('subject/') && p !== m.suite.path)) refuse('a copied path is outside the saved inputs');
  const actual = inventory(root, 'subject');
  if (m.subject.kind === 'context_file') actual.push('suite.json');
  if (!same(actual.sort(), expected)) {
    const added = actual.find(p => !expected.includes(p)), lost = expected.find(p => !actual.includes(p));
    refuse('the copied file set changed: ' + shownName(added !== undefined ? added : lost) + (added !== undefined ? ' was added' : ' is missing'));
  }
  const buffers = new Map();
  for (const f of m.files) {
    const data = bounded(within(root, f.path));
    if (sha256(data) !== f.sha256) refuse('a copied file changed: ' + invisibleShown(f.path));
    buffers.set(f.path, data);
  }
  return { root, manifest: m, buffers };
}
// A-723-10: a difference this environment caused names what moved, because restoring it keeps the
// folder's readings comparable. Anything else is a change in the installed procedure.
function procedureProblem(saved, current) {
  const restore = '; restore that setting, or initialize a new folder';
  const targets = saved && Array.isArray(saved.targets) ? saved.targets : [];
  for (const [i, now] of current.targets.entries()) {
    const was = targets[i];
    if (!was) break;
    if (!same(was.surface, now.surface)) return 'model ' + shownName(now.model) + ' was saved on the ' + shownName(was.surface) + ' surface and this environment reaches it on ' + shownName(now.surface) + restore;
    if (!same(was.judge_settings?.surface, now.judge_settings.surface)) return 'judge ' + shownName(now.judge_model) + ' was saved on the ' + shownName(was.judge_settings?.surface) + ' surface and this environment reaches it on ' + shownName(now.judge_settings.surface) + restore;
    for (const [who, a, b] of [['model', was.route, now.route], ['judge', was.judge_route, now.judge_route]]) {
      if (same(a, b)) continue;
      const moved = Object.keys(b.routing).filter(k => !same(a?.routing?.[k], b.routing[k]));
      return 'the ' + who + ' route changed since this folder was saved (' + (moved.length ? moved.join(', ') : 'its address') + ')' + restore;
    }
  }
  return 'the installed sampling or judge procedure changed; initialize a new folder';
}
function validateSettings(m) {
  const s = m.settings;
  if (!Array.isArray(s.models) || !s.models.length || !Array.isArray(s.judge_models) || s.models.length !== s.judge_models.length)
    refuse('the saved model list is invalid');
  for (const id of [...s.models, ...s.judge_models]) {
    assertRegistered(id, 'model');
    if (provider.resolveModel(id) !== id) refuse('a saved model id now resolves differently');
  }
  for (const k of ['samples', 'draws_cap', 'max_calls', 'concurrency']) numeric(s[k], k);
  numeric(s.max_usd, 'max-usd', true);
  if (s.max_cases !== null) numeric(s.max_cases, 'max-cases');
  if (!CAPTURE_MODES.includes(s.capture) || typeof s.placebo !== 'boolean' || !s.timeout || (s.trusted !== undefined && typeof s.trusted !== 'boolean')) refuse('the saved run settings are invalid');
  if (s.timeout.explicit_ms !== null && (!Number.isSafeInteger(s.timeout.explicit_ms) || s.timeout.explicit_ms < 1 || s.timeout.explicit_ms > 2147478647))
    refuse('the saved timeout is invalid');
  const current = procedureFor(s);
  if (s.draws_cap !== SAMPLING.max || !same(m.procedure, current)) refuse(procedureProblem(m.procedure, current));
  for (const t of current.targets) {
    if (s.timeout.generation_ms[t.model] !== t.generation_timeout_ms || s.timeout.judge_ms[t.judge_model] !== t.judge_timeout_ms)
      refuse('the saved timeout no longer matches the runner');
  }
}
function snapshot(frozen) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-recheck-'));
  try {
    for (const [rel, bytes] of frozen.buffers) {
      const dest = path.join(temp, rel); fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 }); writeNew(dest, bytes);
    }
    const m = frozen.manifest;
    const skill = loadSubject(path.join(temp, m.subject.path), {
      ...(m.subject.kind === 'context_file' ? { suite: path.join(temp, m.suite.path) } : {}),
      readFile: file => {
        const rel = path.relative(temp, file).split(path.sep).join('/');
        if (!frozen.buffers.has(rel)) refuse('an unsealed input reached the runner');
        return frozen.buffers.get(rel);
      },
    });
    return { temp, skill: m.subject.name === undefined ? skill : { ...skill, name: m.subject.name } };
  } catch (e) { fs.rmSync(temp, { recursive: true, force: true }); throw e; }
}
async function runRecheck(folder, { trustedSkill = false, onSavedLane = null } = {}) {
  const frozen = openFrozen(folder), m = frozen.manifest, s = m.settings;
  validateSettings(m);
  const trusted = s.trusted === true;
  // A-723-8: the person gives trust for each run, so a folder never carries it, and the flag never moves a lane.
  if (trusted && trustedSkill !== true) refuse('the folder was saved to run on your own CLI; pass --trusted-skill if this file is yours');
  if (!trusted && trustedSkill === true) refuse('this folder was saved without --trusted-skill: the lane would change, so the readings could not compare. To run on your own CLI, ' + NEW_FOLDER);
  // A-723-10: one line before any call, as run and compare, naming what works for a folder on this lane.
  if (!trusted && !stubEnabled() && [...s.models, ...s.judge_models].some(model => provider.isSubscriptionSurface(provider.surfaceForModel(model)))) {
    const user = provider.evalUser();
    if (provider.evalUserExists(user) === false) refuse('this folder runs through the isolation account ' + user + ', and there is no such account on this machine; nothing run, no receipt written. If you wrote this subject yourself, ' + NEW_FOLDER + '. If you did not, set up the account first (the Isolation section of the README says what it needs).');
  }
  const dir = within(frozen.root, 'receipts');
  // A-723-10: git drops an empty folder, so a fresh clone has none.
  if (!lstatOrNull(dir)) fs.mkdirSync(dir, { mode: 0o700 });
  plainDir(dir);
  const initialDir = fs.statSync(dir);
  const { temp, skill } = snapshot(frozen);
  try {
    const cases = s.max_cases ? skill.suite.cases.slice(0, s.max_cases) : skill.suite.cases;
    if (!cases.length) refuse('the saved suite has no cases');
    for (const model of s.models) runner.assertSubjectFits({ skill, cases, modelId: model, trusted, capture: s.capture });
    const calls = runner.projectCalls(cases.length, s.samples, s.draws_cap, s.placebo ? 3 : 2);
    if (calls > s.max_calls) refuse('cost guard: ' + calls + ' calls/model exceed max-calls ' + s.max_calls, 'COST_GUARD');
    const estimates = s.models.map((model, i) => estimateRunCostUSD({
      caseCount: cases.length, samples: s.samples, models: [model], judgeModel: s.judge_models[i],
      draws: s.draws_cap, arms: s.placebo ? 3 : 2,
    }));
    const total = Math.round(estimates.reduce((n, x) => n + x.totalUSD, 0) * 1e4) / 1e4;
    if (total > s.max_usd) refuse('cost guard: plan exceeds max-usd ' + s.max_usd + '; ' + calls * s.models.length + ' calls planned', 'COST_GUARD');
    const budget = new BudgetTracker(s.max_usd);
    const saved = [];
    // A-723-7: as run says it, before the first call, so a same-user run of a saved folder is never silent.
    if (onSavedLane && m.procedure.targets.some(t => t.isolation === 'same-user' || t.judge_isolation === 'same-user')) onSavedLane();
    for (const [i, model] of s.models.entries()) {
      // Read-only revalidation before each model. Execution uses the private snapshot.
      openFrozen(folder);
      plainDir(dir);
      const nowDir = fs.statSync(dir);
      if (initialDir.dev !== nowDir.dev || initialDir.ino !== nowDir.ino) refuse('the receipt folder changed');
      const { receipt } = await runner.runSkillOnModel({ skill, model, opts: {
        judgeModel: s.judge_models[i], samples: s.samples, maxCases: s.max_cases,
        maxCalls: s.max_calls, concurrency: s.concurrency, budget, trusted,
        keepTranscripts: false, capture: s.capture, ...(s.placebo ? { placebo: true } : {}),
        ...(s.timeout.explicit_ms === null ? {} : { timeoutMs: s.timeout.explicit_ms }),
        ...(s.capture === 'repository' ? { checkpointDir: path.join(temp, 'checkpoint-' + i) } : {}),
      } });
      if (!verifyReceiptHash(receipt) || !validateReceipt(receipt).valid) refuse('the runner returned an invalid receipt');
      plainDir(dir);
      const finalDir = fs.statSync(dir);
      if (initialDir.dev !== finalDir.dev || initialDir.ino !== finalDir.ino) refuse('the receipt folder changed');
      const name = fileSlug(model) + '-' + receipt.run.date_utc.replace(/[:.]/g, '-') + '-' + crypto.randomUUID() + '.json';
      writeNew(path.join(dir, name), JSON.stringify(receipt, null, 2) + '\n');
      saved.push({ file: name, receipt });
    }
    return saved;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

function identityProblem(a, b) {
  const known = (x, y, label, allowNull = false) => {
    if (x === undefined || y === undefined || (!allowNull && (x === null || y === null))) return label + ' not recorded';
    return same(x, y) ? null : label + ' differs';
  };
  for (const [label, x, y] of [
    ['subject', a.skill.content_hash, b.skill.content_hash], ['subject kind', a.skill.unit, b.skill.unit],
    ['suite', a.suite.suite_hash, b.suite.suite_hash], ['delivery', a.run.delivery, b.run.delivery],
    ['capture', a.run.capture, b.run.capture], ['surface', a.run.surface, b.run.surface],
    // A-723-7: the lane that answered. A judge on an API surface records none on either lane, so its isolation cannot stand in.
    ['answering lane', a.run.answered_by?.isolation, b.run.answered_by?.isolation],
  ]) { const problem = known(x, y, label); if (problem) return problem; }
  for (const key of ['model_id', 'surface', 'temperature', 'sampling', 'samples', 'prompt_template_hash', 'code_revision', 'isolation', 'endpoint', 'harness']) {
    const problem = known(a.run.judge?.[key], b.run.judge?.[key], 'judge ' + key, key === 'temperature');
    if (problem) return problem;
  }
  for (const r of [a, b]) {
    if (r.run.judge.surface.endsWith('-cli') && !r.run.judge.harness?.version) return 'judge harness version not recorded';
  }
  // Hidden tests may supply the primary score while the model judge stays the same.
  if (!same(a.run.scoring || null, b.run.scoring || null)) return 'scoring procedure differs';
  const rows = r => r.results.cases.map(c => ({
    id: c.id, mode: c.mode, model: c.judge?.model_id, rubric: c.judge?.rubric_hash,
    criteria_template: c.criteria_template_hash || null,
    draw_templates: [...new Set((c.generation?.draws || []).map(d => d.criteria_template_hash || null))].sort(),
  })).sort((x, y) => (x.id + '\0' + x.mode).localeCompare(y.id + '\0' + y.mode));
  const ar = rows(a), br = rows(b);
  if (ar.some(c => !c.model || !c.rubric) || br.some(c => !c.model || !c.rubric)) return 'per-task judge not recorded';
  if (!same(ar, br)) return 'tasks, arms or per-task grading differs';
  if (!same(a.run.judge.criteria_template_hash || null, b.run.judge.criteria_template_hash || null)) return 'judge criteria template differs';
  return null;
}
function checkedEntry(entry) {
  const r = entry.receipt;
  let problem = entry.error || null;
  if (!problem) {
    try {
      if (!verifyReceiptHash(r)) problem = 'receipt hash is invalid';
      else if (!validateReceipt(r).valid) problem = 'receipt schema is invalid';
    } catch (_) { problem = 'receipt is unreadable'; }
  }
  return { ...entry, valid: !problem, problem };
}
function plainHeadline(headline) {
  for (const [label, plain] of PLAIN_LABELS) {
    const m = new RegExp('^' + label + '\\s*:\\s*').exec(headline);
    if (m) return plain + ': ' + headline.slice(m[0].length);
  }
  return headline;
}
function comparison(a, b) {
  let result;
  try {
    const d = buildDriftReport(a.receipt, b.receipt, { mode: 'release' });
    const head = /## Headline\s+\*\*([\s\S]*?)\*\*/.exec(d.markdown);
    result = { headline: (head ? head[1] : 'not measured').replace(/\u2014/g, ':'),
      per_case: d.perCase, refused: d.refused, refusal_reason: d.refusal_reason };
  } catch (e) {
    return { reading: 'not measured: ' + e.message, differ: { error: e.message, code: e.code || null }, separated: false, eligible: false };
  }
  if (result.refused || result.per_case.some(c => ['not measured', 'refused'].includes(c.verdict))) {
    return { reading: plainHeadline(result.headline), differ: result, separated: false, eligible: false };
  }
  const problem = identityProblem(a.receipt, b.receipt);
  if (problem) return { reading: 'not measured: ' + problem, differ: result, separated: false, eligible: false };
  const separated = result.per_case.filter(c => ['regression', 'improvement'].includes(c.verdict));
  const lost = result.per_case.filter(c => c.lost);
  const reading = separated.length
    ? 'separated on task ' + separated.map(c => c.id).join(', ') + (lost.length ? '; ' + plainHeadline(result.headline) : '')
    : result.per_case.some(c => c.verdict === 'inconclusive') ? plainHeadline(result.headline) : 'no separation detected';
  return { reading, differ: result, separated: separated.length > 0, eligible: true };
}
function buildRecheckHistory(entries) {
  const dateOf = entry => String((entry.valid && entry.receipt.run.date_utc) || '\uffff');
  const checked = entries.map(checkedEntry).sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || a.file.localeCompare(b.file));
  const previous = new Map(), first = new Map();
  let separated = false, measured = false;
  const rows = checked.map(entry => {
    // A-723-10: a receipt that fails its checks is untrusted text, so nothing inside it is read or printed.
    if (!entry.valid) return { file: entry.file, date_utc: null, model_id: null, harness: null, runner_version: null, judge: null, surface: null, bands: null,
      previous: null, first: null, status: 'not measured: ' + entry.problem };
    const r = entry.receipt, run = r.run;
    const key = typeof run.model_id === 'string' ? run.model_id : null;
    const prev = key && previous.has(key) ? comparison(previous.get(key), entry) : null;
    const initial = key && first.has(key) ? comparison(first.get(key), entry) : null;
    for (const c of [prev, initial]) if (c) { separated ||= c.separated; measured ||= c.eligible; }
    if (key) { previous.set(key, entry); if (!first.has(key)) first.set(key, entry); }
    const marked = receiptAggregatesOnly(r);
    const unmeasured = marked || run.status === 'incomplete' || r.verification_level !== 'TESTED' || isSmoke(r);
    const aggregates = !marked ? r.results.aggregates : null;
    const band = arm => aggregates?.[arm] ? { mean: aggregates[arm].mean_score ?? null, sd: aggregates[arm].stddev ?? null } : null;
    return {
      file: entry.file, date_utc: run.date_utc || null, model_id: key, harness: run.harness || null,
      runner_version: run.runner_version || null, judge: run.judge || null, surface: run.surface || null,
      bands: aggregates ? { with_skill: band('with_skill'), baseline: band('baseline') } : null,
      previous: prev, first: initial, status: unmeasured ? 'not measured: ' + (run.status === 'incomplete' ? CLAUSES.incomplete : marked ? CLAUSES.aggregates_only : isSmoke(r) ? CLAUSES.smoke : CLAUSES.below_tested) : 'recorded',
    };
  });
  // A-723-9: an entry with no readable model joins no chain, so a comparison above may have skipped it. Only a
  // receipt's own content names its model: a file name is not read as one.
  const unread = rows.filter(row => row.model_id === null).length;
  const unreadable_note = unread ? unread + ' receipt file' + (unread === 1 ? '' : 's') + ' here could not be read or failed '
    + (unread === 1 ? 'its check, so it' : 'their checks, so they') + ' joined no comparison, and a comparison above may have skipped ' + (unread === 1 ? 'it' : 'them') + '.' : null;
  return { rows, unreadable_note, list_cut: null, conclusion: separated ? SEPARATED : measured ? NO_SEPARATION : NOTHING_TO_COMPARE,
    caveat: CAVEAT, comparison_status: measured ? 'comparisons recorded' : 'no comparison could be measured', view_command: null };
}
function historyRecheck(folder) {
  const root = path.resolve(folder); plainDir(root);
  const dir = within(root, 'receipts');
  // A-723-10: git drops an empty folder, so no receipts folder is an empty history.
  const there = lstatOrNull(dir);
  if (there) plainDir(dir);
  const names = there ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort() : [];
  const entries = names.slice(-HISTORY_MAX_ROWS).map(file => {
    try { return { file, receipt: readReceiptFile(path.join(dir, file)) }; }
    catch (_) { return { file, error: 'receipt is unreadable' }; }
  });
  const history = buildRecheckHistory(entries);
  if (names.length > HISTORY_MAX_ROWS) history.list_cut = 'The list was cut: only the last ' + HISTORY_MAX_ROWS + ' of ' + names.length + ' receipt files by name were read, so the first reading shown may not be the first saved.';
  history.view_command = 'driftproof view ' + shellArg(path.join(folder, 'receipts'));
  return history;
}
// A-723-10: --json cuts each string as the text does, and writes what a screen would hide as JSON escapes.
function historyJson(history) {
  return JSON.stringify(history, (key, value) => (typeof value === 'string' ? capped(value) : value), 2)
    .replace(/[\u007f-\u009f\p{Zl}\p{Zp}]|\p{Default_Ignorable_Code_Point}/gu, c => Array.from({ length: c.length }, (_, i) => '\\u' + c.charCodeAt(i).toString(16).padStart(4, '0')).join(''));
}
function formatRecheckHistory(history) {
  const shown = value => value == null ? 'not recorded' : shownName(value);
  const band = b => b && b.mean !== null ? shown(b.mean) + ' +/- ' + shown(b.sd) : 'not measured';
  const lines = history.rows.map(row => row.model_id === null ? shown(row.file) + ' | ' + shown(row.status) : [
    shown(row.date_utc), 'model ' + shown(row.model_id),
    row.harness ? 'harness ' + shown(row.harness.name) + ' ' + shown(row.harness.version) : 'harness not recorded',
    'runner ' + shown(row.runner_version), 'judge ' + shown(row.judge?.model_id),
    'surface ' + shown(row.surface) + ', judge surface ' + shown(row.judge?.surface),
    'with ' + band(row.bands?.with_skill) + ', without ' + band(row.bands?.baseline),
    shown(row.status), 'previous: ' + shown(row.previous?.reading || 'no comparison'),
    'first: ' + shown(row.first?.reading || 'no comparison'),
  ].join(' | '));
  if (history.unreadable_note) lines.push(history.unreadable_note);
  if (history.list_cut) lines.push(history.list_cut);
  if (history.view_command) lines.push(history.view_command);
  lines.push(history.comparison_status, history.caveat, history.conclusion);
  return lines.join('\n');
}
module.exports = { initRecheck, runRecheck, historyRecheck, buildRecheckHistory, formatRecheckHistory, historyJson, refusalWords, HISTORY_MAX_ROWS };
