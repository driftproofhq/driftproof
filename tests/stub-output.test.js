// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 236. Real CLI output and artefacts; no model access.
// Base and candidate share inputs, a clock and offline provider fixtures.
// Readers inspect both complete streams. Plants exercise those same readers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { validateReceipt, verifyReceiptHash, sealReceipt } = require('../lib/receipt');
const { WITHIN_NOISE } = require('../lib/stats');
const ROOT = path.resolve(__dirname, '..');
const SPEC = fs.readFileSync(path.join(ROOT, 'specs/236-stub-output/spec.md'), 'utf8');
const BASE = /\*\*Base:\*\* .* at \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
const made = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join('/var/tmp', 'stub236-'));
  made.push(d);
  return d;
};
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const harness = tmp();
const baseRoot = path.join(harness, 'base');
fs.mkdirSync(path.join(baseRoot, 'bin'), { recursive: true });
fs.writeFileSync(path.join(baseRoot, 'bin/driftproof'),
  execFileSync('git', ['show', BASE + ':bin/driftproof'], { cwd: ROOT }));
for (const name of ['lib', 'config.js']) fs.symlinkSync(path.join(ROOT, name), path.join(baseRoot, name));
// A-236-8 (issue 367): the quick scenarios read against the CLI at the Issue 367 hold, which made
// --quick a first look; every other scenario reads against the Base's CLI, as before.
const HOLD_367 = /\*\*Issue 367 hold:\*\* \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
const quickBaseRoot = path.join(harness, 'base-367');
fs.mkdirSync(path.join(quickBaseRoot, 'bin'), { recursive: true });
fs.writeFileSync(path.join(quickBaseRoot, 'bin/driftproof'),
  execFileSync('git', ['show', HOLD_367 + ':bin/driftproof'], { cwd: ROOT }));
for (const name of ['lib', 'config.js']) fs.symlinkSync(path.join(ROOT, name), path.join(quickBaseRoot, name));
const isQuick = (name) => name.endsWith('quick') || name === 'quick-rc';
const baseFor = (name) => (isQuick(name) ? quickBaseRoot : baseRoot);

const preload = path.join(harness, 'preload.cjs');
fs.writeFileSync(preload, [
  "'use strict';",
  "const fs = require('node:fs');",
  'const root = process.env.STUB236_ROOT;',
  '// A-236-3 (issue 285): spec 235\'s trigger, the entry lib/receipt.js resolves made absent.',
  'if (process.env.STUB236_PLANT === "missing-ajv") {',
  '  const Module = require("node:module"), resolve = Module._resolveFilename;',
  '  Module._resolveFilename = function(request, parent, ...args) {',
  '    if (request === "ajv/dist/2020" && parent && /[/\\\\]lib[/\\\\]receipt\\.js$/.test(parent.filename)) {',
  '      throw Object.assign(new Error("planted missing ajv entry"), { code: "MODULE_NOT_FOUND" });',
  '    }',
  '    return resolve.call(this, request, parent, ...args);',
  '  };',
  '}',
  'const RealDate = Date;',
  'global.Date = class extends RealDate {',
  '  constructor(...a) { super(...(a.length ? a : [0])); }',
  '  static now() { return 0; }',
  '};',
  'const append = (kind, value) => fs.appendFileSync(process.env.STUB236_TRACE, JSON.stringify({ kind, value }) + "\\n");',
  'for (const name of ["stdout", "stderr"]) {',
  '  const stream = process[name], write = stream.write;',
  '  stream.write = function(chunk, ...args) { append(name, String(chunk)); return write.call(this, chunk, ...args); };',
  '}',
  "const rawWriteSync = fs.writeSync;",
  "fs.writeSync = function(fd, data, ...args) {",
  "  if (fd === 1 || fd === 2) {",
  "    const value = typeof data === \"string\" ? data : Buffer.from(data).subarray(args[0] || 0, (args[0] || 0) + (args[1] === undefined ? data.length : args[1])).toString();",
  "    append(fd === 1 ? \"stdout\" : \"stderr\", value);",
  "  }",
  "  return rawWriteSync.call(this, fd, data, ...args);",
  "};",
  'const forbidden = (name) => { append("model", name); throw new Error("offline fixture refused model access"); };',
  'global.fetch = () => forbidden("fetch");',
  'for (const name of ["node:http", "node:https"]) {',
  '  const mod = require(name); mod.request = () => forbidden(name); mod.get = mod.request;',
  '}',
  'require("node:net").Socket.prototype.connect = () => forbidden("socket");',
  'const cp = require("node:child_process");',
  'for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {',
  '  const real = cp[name];',
  '  cp[name] = function(file, ...args) {',
  '    if (pathBase(file) !== "git") return forbidden("process " + pathBase(file));',
  '    return real.call(this, file, ...args);',
  '  };',
  '}',
  'function pathBase(file) { return require("node:path").basename(String(file)); }',
  '// Install guards before provider modules can capture transport functions.',
  'const provider = require(root + "/lib/provider");',
  'const realComplete = provider.complete;',
  'const { stubComplete } = require(root + "/lib/stub");',
  'const { normalizeUsage } = require(root + "/lib/usage");',
  'provider.complete = async (a) => {',
  '  append("synthetic", /Return ONLY this JSON object/.test(a.prompt) ? "judge" : "generation");',
  '  if (process.env.DRIFTPROOF_STUB === "1") {',
  '    const r = await realComplete(a);',
  '    append("stub-evidence", { reportedModels: r.reportedModels, answeredBy: r.answeredBy, surface: r.surface });',
  '    return r;',
  '  }',
  '  const s = stubComplete(a);',
  '  return { ...s, usage: normalizeUsage(s.usage), wall_ms: s.usage.wall_ms,',
  '    attempts: 1, answeredBy: "model", surface: "api", isolation: "none",',
  '    reportedModels: [provider.resolveModel(a.model)], stopReason: "end_turn" };',
  '};',
  "// Executable plants use the same interception as the real CLI subject.",
  "const plant = process.env.STUB236_PLANT;",
  "if ([\"partial-write\", \"summary-write\", \"sidecar-write\"].includes(plant)) {",
  "  const write = fs.writeFileSync;",
  "  fs.writeFileSync = function(file, ...args) {",
  "    if (plant === \"partial-write\" && String(file).includes(\"/receipts/\") && String(file).includes(\"claude-sonnet\") && String(file).endsWith(\".json\")) throw new Error(\"fixture disk failure\");",
  "    if (plant === \"summary-write\" && String(file).endsWith(\".summary.md\")) throw new Error(\"fixture metadata failure\");",
  "    if (plant === \"sidecar-write\" && String(file).endsWith(\".regrade.json\")) throw new Error(\"fixture metadata failure\");",
  "    return write.call(this, file, ...args);",
  "  };",
  "}",
  "if (plant === \"fd-1\" || plant === \"fd-2\") fs.writeSync(plant === \"fd-1\" ? 1 : 2, \"Heading\\n\");",
  "if ([\"fetch\", \"http\", \"https\", \"socket\", \"process\"].includes(plant)) {",
  "  try {",
  "    if (plant === \"fetch\") fetch(\"http://127.0.0.1:9\");",
  "    if (plant === \"http\") require(\"node:http\").request(\"http://127.0.0.1:9\");",
  "    if (plant === \"https\") require(\"node:https\").request(\"https://127.0.0.1:9\");",
  "    if (plant === \"socket\") new (require(\"node:net\").Socket)().connect(9, \"127.0.0.1\");",
  "    if (plant === \"process\") cp.spawnSync(\"claude\", [\"--version\"]);",
  "  } catch (e) { process.stderr.write(e.message + \"\\n\"); process.exit(7); }",
  "}",
  '',
].join('\n'));

function env(root, trace, stub) {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^NODE_OPTIONS$|^SOURCE_DATE_EPOCH$|^STUB236_/.test(k)) continue;
    out[k] = v;
  }
  return { ...out, TMPDIR: '/var/tmp', NODE_NO_WARNINGS: '1', CLAUDE_PROVIDER: 'api', OPENAI_SURFACE: 'api',
    ...(stub ? { DRIFTPROOF_STUB: '1' } : {}),
    NODE_OPTIONS: '--require ' + preload, STUB236_ROOT: root, STUB236_TRACE: trace };
}
let next = 0;
function cli(root, work, args, stub = true, subscription = false, plant = null) {
  const trace = path.join(harness, 'trace-' + (++next) + '.jsonl');
  const r = spawnSync(process.execPath, [path.join(root, 'bin/driftproof'), ...args], {
    cwd: work, env: { ...env(root, trace, stub), ...(subscription ? { CLAUDE_PROVIDER: 'claude-cli' } : {}), ...(plant ? { STUB236_PLANT: plant } : {}) }, encoding: 'utf8',
    timeout: 1800000, maxBuffer: 32 << 20,
  });
  assert.ifError(r.error);
  assert.equal(r.signal, null);
  const events = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  for (const stream of ['stdout', 'stderr']) assert.equal(events.filter(e => e.kind === stream).map(e => e.value).join(''), r[stream], 'all descriptor bytes were observed on ' + stream);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, events };
}
const output = (r) => r.stdout + '\n' + r.stderr;
const inOrder = (r) => r.events.filter((e) => e.kind === 'stdout' || e.kind === 'stderr').map((e) => e.value).join('');
function first(r) {
  const line = inOrder(r).split('\n')[0];
  assert.match(line, /^\s*STUB RUN \(DRIFTPROOF_STUB=1\):/);
  assert.match(line, /UNVERIFIED/);
  assert.match(line, /nothing will answer|no model will be called/i);
  assert.match(line, /measure nothing|measures nothing|grade nothing/i);
}
function costs(r, admitted = true) {
  assert.doesNotMatch(output(r), /\$\s*[~]?\s*\d/, 'no projected spending amount');
  if (admitted) assert.match(output(r), /no projected cost: no model will be called/i);
}
function results(r, emitted = 1) {
  const text = output(r);
  assert.equal((text.match(/stub receipt measures nothing/gi) || []).length, emitted, 'completion claims equal emitted receipts');
  assert.doesNotMatch(text, /\b(?:skill\s+)?lift\s*(?:[:=]|\*\*)?\s*[+-]?\d|\bskill lift\b|\b(?:score|mean)\s*[:=]?\s*[+-]?\d|\b(?:with(?: the skill)?|without(?: the skill)?|base(?:line)?)\s*[:=(]?\s*[+-]?\d+\.\d|±\s*\d|\b(?:PASS|FAIL|BORDERLINE|PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE)\b/i);
  wording(r);
}
function calls(r) {
  assert.deepEqual(r.events.filter((e) => e.kind === 'model'), [], 'no model process or network attempt');
  const text = output(r);
  assert.doesNotMatch(text, /the model that wrote each answer also grades it/i, 'live self-judge attribution contradicts the stub');
  for (const line of text.split('\n')) {
    if (/\b(?:[1-9]\d*\s+(?:judge )?calls?\b|(?:model|judge) calls?\s*:\s*[1-9]\d*|projected calls:|progress: call\b)/i.test(line)) {
      assert.match(line, /\b(?:stub|synthetic)\b/i, 'unqualified model call count: ' + line);
    }
    if (/\b(?:model|judge)\b[^\n]*\b(?:generated|graded|wrote|grades)\b/i.test(line)) {
      assert.match(line, /\b(?:stub|synthetic)\b|no model (?:was|will be) called/i, 'positive model attribution: ' + line);
    }
  }
}
let lexicon = [];
test.before(async () => {
  const { LEXICON } = await import('../specs/031-artefact-claims/probes/bands.mjs');
  lexicon = LEXICON;
});
function wording(r) {
  const text = output(r).replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /\bconfiden(ce|t)\b|\bstatistically\b|\bsignifican(t|ce)\b/i, 'spec 035 confidence wording');
  for (const { cls, re } of lexicon) assert.equal(re.test(text), false, 'spec 031 lexicon: ' + cls);
}
function same(a, b) { assert.deepEqual(a, b); }
function planted(r, stream, text, prepend = false) {
  const copy = structuredClone(r);
  copy[stream] = prepend ? text + copy[stream] : copy[stream] + text;
  const event = { kind: stream, value: text };
  if (prepend) copy.events.unshift(event); else copy.events.push(event);
  return copy;
}
function written(dir) {
  const out = {};
  function walk(at, rel) {
    if (!fs.existsSync(at)) return;
    for (const ent of fs.readdirSync(at, { withFileTypes: true })) {
      const p = path.join(at, ent.name), key = path.posix.join(rel, ent.name);
      if (ent.isDirectory()) walk(p, key);
      else out[key] = fs.readFileSync(p, 'utf8');
    }
  }
  for (const name of ['receipts', 'transcripts', 'regraded']) walk(path.join(dir, name), name);
  return out;
}
function receiptIn(dir) {
  const files = fs.readdirSync(dir).filter((f) => /[0-9a-f]{12}\.json$/.test(f));
  assert.equal(files.length, 1);
  const file = path.join(dir, files[0]);
  return { file, receipt: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
function fixture() {
  const work = tmp();
  fs.mkdirSync(path.join(work, 'skill/evals'), { recursive: true });
  fs.writeFileSync(path.join(work, 'skill/SKILL.md'), '---\nname: stub236\nversion: 1.0.0\n---\n\n# Fixture\n\nAnswer in one sentence.\n');
  const cases = [{ id: 'c1', prompt: 'Name a primary colour.', rubric: 'One primary colour.', pass_threshold: 0.7 }];
  fs.writeFileSync(path.join(work, 'skill/evals/evals.json'), JSON.stringify({ cases }));
  fs.writeFileSync(path.join(work, 'revised.json'), JSON.stringify({ cases: [{ ...cases[0], rubric: 'Only one primary colour.' }] }));
  return work;
}
const RUN_ARGS = ['run', 'skill', '--models', 'haiku', '--samples', '2', '--trusted-skill', '--keep-transcripts', '--out', 'receipts'];
const ADMITTED = ['full', 'quick', 'multiple-model', 'judge-regrade', 'model-origin-regrade', 'quick-rc', 'subscription-full', 'subscription-quick', 'subscription-judge-regrade'];
const cache = new Map();
function scenario(root, name, stub = true) {
  const key = root + ':' + name + ':' + stub;
  if (cache.has(key)) return cache.get(key);
  const work = fixture();
  const subscription = name.startsWith('subscription-');
  let args = [...RUN_ARGS];
  if (name.endsWith('quick') || name === 'quick-rc') {
    args.splice(args.indexOf('--samples'), 2);
    args.push('--quick');
  }
  if (name === 'quick-rc') fs.writeFileSync(path.join(work, '.driftproofrc'), JSON.stringify({ samples: 3, concurrency: 2, max_cases: 2 }));
  if (name === 'multiple-model') args[args.indexOf('--models') + 1] = 'haiku,sonnet';
  let r = cli(root, work, args, name === 'model-origin-regrade' ? false : stub, subscription);
  assert.equal(r.status, 0, r.stderr);
  if (name.endsWith('regrade')) {
    const original = receiptIn(path.join(work, 'receipts'));
    const archive = path.join('transcripts', original.receipt.receipt_hash, 'answers.json');
    const rg = ['regrade', path.relative(work, original.file), '--skill', 'skill', '--answers', archive, '--trusted-skill', '--out', 'regraded'];
    if (name.endsWith('rubric-regrade')) rg.push('--rubric', 'revised.json');
    else rg.push('--judge-model', 'haiku');
    r = cli(root, work, rg, stub, subscription);
    assert.equal(r.status, 0, r.stderr);
  }
  const data = { r, work, artefacts: written(work) };
  cache.set(key, data);
  return data;
}

// A-236-1 (issue 245): `lib` is held at the commit that carries spec 245's lib/run.js change; every
// other path is still held at the Base.
const LIB_HOLD = /\*\*Lib hold:\*\* \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
// A-236-2 (issue 293): the hold reads the subjects spec 236 lists by path, not every file in `lib`.
const SUBJECTS = [.../\*\*Held subjects:\*\* (.+)/.exec(SPEC)[1].matchAll(/\x60([^\x60]+)\x60/g)].map((m) => m[1]);
// A-236-4 (issue 265): the subjects issue 265 moved, held at its commit.
const HOLD_265 = /\*\*Issue 265 hold:\*\* \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
const MOVED_265 = ['config.js', 'lib/regrade.js', 'lib/run.js', 'spec/receipt.schema.json', 'spec/receipt.v0.12.schema.json'];
// A-236-5 (issue 317): the subjects issue 317 moved, held at its commit; issue 265's other three stay at its.
const HOLD_317 = /\*\*Issue 317 hold:\*\* \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
const MOVED_317 = ['lib/regrade.js', 'spec/receipt.schema.json'];
// A-236-8 (issue 367): lib/run.js, moved for the quick preset's draw cap, held at issue 367's commit.
const MOVED_367 = ['lib/run.js'];
// A-236-10 (issue 388): lib/provider.js, moved for two refusal messages, held at issue 388's commit.
const HOLD_388 = /\*\*Issue 388 hold:\*\* \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
const MOVED_388 = ['lib/provider.js'];
// A-236-12 (issue 406): lib/provider.js, moved for the eval-user refusals, held at issue 406's commit in place of 388's.
const HOLD_406 = /\*\*Issue 406 hold:\*\* \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
const MOVED_406 = ['lib/provider.js'];
// A-236-13 (issue 408): the operator-selected registry is held byte for byte.
const HOLD_408 = /\*\*Issue 408 hold:\*\* \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
const MOVED_408 = ['config/models.json'];
// A-236-14 (issue 408): the optional reply observer's exact reviewed runner bytes.
const RUN_408_SHA = /\*\*Issue 408 runner sha256:\*\* \x60([0-9a-f]{64})\x60/.exec(SPEC)[1];
const run408Hash = (bytes) => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
function run408Changes(cwd) {
  try { return run408Hash(fs.readFileSync(path.join(cwd, 'lib/run.js'))) === RUN_408_SHA ? [] : ['lib/run.js']; }
  catch { return ['lib/run.js']; }
}

const AT_265 = MOVED_265.filter((f) => !MOVED_317.includes(f) && !MOVED_367.includes(f));
const subject = (file) => SUBJECTS.some((s) => (s.includes('*')
  ? new RegExp('^' + s.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$').test(file)
  : file === s || file.startsWith(s + '/')));
const gitIn = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const diffIn = (cwd, from, to, paths) => gitIn(cwd, ['diff', '--name-only', from, ...(to ? [to] : []), '--', ...paths]);
const holdReader = (paths) => assert.deepEqual(paths.filter(subject), [], 'only CLI wording may move');
// A-236-7 (issue 343): a release writes its version into config.js's one RUNNER_VERSION line and into
// package.json's version. config.js at `cwd` is a release bump of the hold when it is the hold's text with
// that one line set to package.json's version, and nothing else: any other byte, a second line, a value
// that is not package.json's, or no package.json is not a bump. A-236-9 (issue 382): each side is read by the
// shared normaliser in scripts/build-report-baselines.mjs, its tree's version from treeVersion and set aside
// by setAside, so config.js at `cwd` must be the hold's text but for the version its own tree carries.
const { treeVersion, setAside } = require(path.join(ROOT, 'scripts', 'build-report-baselines.mjs'));
function releaseBump(cwd, hold) {
  const here = (rel) => (fs.existsSync(path.join(cwd, rel)) ? fs.readFileSync(path.join(cwd, rel), 'utf8') : null);
  const there = (rel) => { try { return execFileSync('git', ['show', hold + ':' + rel], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  if (here('config.js') === null) return false;
  try {
    return setAside(here('config.js'), treeVersion(here)) === setAside(there('config.js'), treeVersion(there));
  } catch { return false; }
}
// The hold's path: the held subjects of the working tree at `cwd`, against the Lib hold and the Base.
// A-236-3 (issue 285): plants run this same path on a planted tree, not only holdReader.
function heldChanges(cwd) {
  const lib = SUBJECTS.filter((s) => s.startsWith('lib/'));
  const rest = SUBJECTS.filter((s) => !s.startsWith('lib/'));
  // A-236-2: each subject names a tracked file.
  for (const s of SUBJECTS) assert.ok(gitIn(cwd, ['ls-files', '--', s]).length > 0, 'held subject names no tracked file: ' + s);
  // A-236-4 (issue 265): the five subjects issue 265 moved are held at its commit, every other one as before.
  // A-236-5 (issue 317): of those, the two issue 317 moved are held at its commit.
  // A-236-10 (issue 388): lib/provider.js is read against its own hold, so it leaves the earlier reads too.
  // A-236-12 (issue 406): that hold is now the Issue 406 hold.
  const moved265 = (paths) => paths.filter((f) => !MOVED_265.includes(f) && !MOVED_388.includes(f) && !MOVED_408.includes(f));
  // A-236-7 (issue 343): config.js, held at the Issue 265 hold, may differ from it by a release bump alone.
  const at265 = () => diffIn(cwd, HOLD_265, null, AT_265).filter((f) => f !== 'config.js' || !releaseBump(cwd, HOLD_265));
  const changed = [...moved265(diffIn(cwd, LIB_HOLD, null, lib)), ...moved265(diffIn(cwd, BASE, null, rest)), ...at265(), ...diffIn(cwd, HOLD_317, null, MOVED_317), ...run408Changes(cwd), ...diffIn(cwd, HOLD_406, null, MOVED_406), ...diffIn(cwd, HOLD_408, null, MOVED_408)];
  // A-236-2: git's pathspec and this test's matcher agree on the subjects in this tree.
  assert.deepEqual(changed, [...moved265(diffIn(cwd, LIB_HOLD, null, ['lib'])), ...moved265(diffIn(cwd, BASE, null, ['spec', 'config.js', 'config'])), ...at265(), ...diffIn(cwd, HOLD_317, null, MOVED_317), ...run408Changes(cwd), ...diffIn(cwd, HOLD_406, null, MOVED_406), ...diffIn(cwd, HOLD_408, null, MOVED_408)].filter(subject));
  return changed;
}
test('AC-4/AC-5 exported runner, provider, schemas and config stay unchanged', () => {
  const git = (args) => gitIn(ROOT, args);
  const diff = (from, to, paths) => diffIn(ROOT, from, to, paths);
  // A-236-2: the runner, provider, schemas and config are all held.
  for (const file of ['lib/run.js', 'lib/regrade.js', 'lib/provider.js', 'lib/stub.js', 'spec/receipt.schema.json',
    'spec/receipt.v0.1.schema.json', 'spec/stale.v1.schema.json', 'config.js', 'config/models.json']) {
    assert.ok(subject(file), 'not a held subject: ' + file);
  }
  const reader = holdReader;
  reader(heldChanges(ROOT));
  assert.notEqual(run408Hash(execFileSync('git', ['show', HOLD_367 + ':lib/run.js'], { cwd: ROOT })), RUN_408_SHA, 'A-236-14: old runner bytes are not admitted');
  // A-236-4 (issue 265): between the earlier holds and issue 265's, exactly those five subjects moved, and
  // its hold is this tree's history; a planted sixth, or a change to one of the five after the hold, reads RED.
  const lib = SUBJECTS.filter((s) => s.startsWith('lib/'));
  const rest = SUBJECTS.filter((s) => !s.startsWith('lib/'));
  const held265 = (paths) => assert.deepEqual(paths, MOVED_265, 'only issue 265 moved these subjects');
  held265([...diff(LIB_HOLD, HOLD_265, lib), ...diff(BASE, HOLD_265, rest)].sort());
  execFileSync('git', ['merge-base', '--is-ancestor', HOLD_265, 'HEAD'], { cwd: ROOT });
  assert.throws(() => held265([...MOVED_265, 'lib/provider.js'].sort()), 'planted sixth subject move');
  assert.throws(() => assert.deepEqual(diff(HOLD_265 + '^', null, MOVED_265).filter(subject), []), 'a change to a moved subject after the hold');
  // A-236-5 (issue 317): between issue 265's hold and issue 317's, exactly those two subjects moved, and its
  // hold is this tree's history; a planted third, or a change to one of the two after the hold, reads RED.
  const held317 = (paths) => assert.deepEqual(paths, MOVED_317, 'only issue 317 moved these subjects');
  held317(diff(HOLD_265, HOLD_317, SUBJECTS).filter(subject).sort());
  execFileSync('git', ['merge-base', '--is-ancestor', HOLD_317, 'HEAD'], { cwd: ROOT });
  assert.throws(() => held317([...MOVED_317, 'lib/run.js'].sort()), 'planted third subject move');
  assert.throws(() => assert.deepEqual(diff(HOLD_317 + '^', null, MOVED_317).filter(subject), []), 'a change to a moved subject after the hold');
  // A-236-8 (issue 367): the Issue 367 hold's own commit moved exactly lib/run.js of the subjects, and
  // it is this tree's history; a planted second subject, or a change to it after the hold, reads RED.
  const held367 = (paths) => assert.deepEqual(paths, MOVED_367, 'only issue 367 moved these subjects');
  held367(diff(HOLD_367 + '^', HOLD_367, SUBJECTS).filter(subject).sort());
  execFileSync('git', ['merge-base', '--is-ancestor', HOLD_367, 'HEAD'], { cwd: ROOT });
  assert.throws(() => held367([...MOVED_367, 'lib/stub.js'].sort()), 'planted second subject move');
  assert.throws(() => assert.deepEqual(diff(HOLD_367 + '^', null, MOVED_367).filter(subject), []), 'a change to a moved subject after the hold');
  // A-236-10 (issue 388): the Issue 388 hold's own commit moved exactly lib/provider.js of the subjects, and
  // it is this tree's history; a planted second subject, or a change to it after the hold, reads RED.
  const held388 = (paths) => assert.deepEqual(paths, MOVED_388, 'only issue 388 moved these subjects');
  held388(diff(HOLD_388 + '^', HOLD_388, SUBJECTS).filter(subject).sort());
  execFileSync('git', ['merge-base', '--is-ancestor', HOLD_388, 'HEAD'], { cwd: ROOT });
  assert.throws(() => held388([...MOVED_388, 'lib/stub.js'].sort()), 'planted second subject move');
  assert.throws(() => assert.deepEqual(diff(HOLD_388 + '^', null, MOVED_388).filter(subject), []), 'a change to a moved subject after the hold');
  // A-236-12 (issue 406): the Issue 406 hold's own commit moved exactly lib/provider.js of the subjects, and
  // it is this tree's history; a planted second subject, or a change to it after the hold, reads RED.
  const held406 = (paths) => assert.deepEqual(paths, MOVED_406, 'only issue 406 moved these subjects');
  held406(diff(HOLD_406 + '^', HOLD_406, SUBJECTS).filter(subject).sort());
  execFileSync('git', ['merge-base', '--is-ancestor', HOLD_406, 'HEAD'], { cwd: ROOT });
  assert.throws(() => held406([...MOVED_406, 'lib/stub.js'].sort()), 'planted second subject move');
  assert.throws(() => assert.deepEqual(diff(HOLD_406 + '^', null, MOVED_406).filter(subject), []), 'a change to a moved subject after the hold');
  // A-236-13: only the registry moved; retain history and second-subject plants.
  const held408 = (paths) => assert.deepEqual(paths, MOVED_408, 'only issue 408 moved these subjects');
  held408(diff(HOLD_408 + '^', HOLD_408, SUBJECTS).filter(subject).sort());
  execFileSync('git', ['merge-base', '--is-ancestor', HOLD_408, 'HEAD'], { cwd: ROOT });
  assert.throws(() => held408([...MOVED_408, 'lib/stub.js'].sort()), /only issue 408 moved these subjects/);
  assert.throws(() => reader(diff(HOLD_408 + '^', null, MOVED_408)), /only CLI wording may move/);
  for (const file of ['lib/run.js', 'lib/regrade.js', 'lib/provider.js', 'spec/receipt.schema.json', 'config.js']) {
    assert.throws(() => reader([file]), 'planted source edit: ' + file);
  }
  for (const file of git(['ls-files', '--', ...SUBJECTS])) assert.throws(() => reader([file]), 'planted subject edit: ' + file);
  // A-236-2's plants: a new or changed file outside the subjects reads GREEN, and beside a subject edit RED.
  for (const file of ['lib/importers-harbor.js', 'lib/planted-new.js', 'lib/runner.js', 'spec/RECEIPT.md', 'bin/driftproof']) {
    reader([file]);
  }
  assert.throws(() => reader(['lib/importers-harbor.js', 'lib/stub.js']), 'a subject edit beside an outside file');
  // A-236-1: between the Base and the hold only issue 245's lib/run.js moved, and the hold is this tree's history.
  const held = (paths) => assert.deepEqual(paths, ['lib/run.js'], 'only issue 245 moved lib');
  held(diff(BASE, LIB_HOLD, ['lib']));
  execFileSync('git', ['merge-base', '--is-ancestor', LIB_HOLD, 'HEAD'], { cwd: ROOT });
  assert.throws(() => held(['lib/run.js', 'lib/regrade.js']), 'planted second lib move');
  // A-236-1's plant: a lib change after a held commit, read from the hold's parent, reads RED.
  assert.throws(() => reader(diff(LIB_HOLD + '^', null, ['lib'])), 'a lib change after the hold');
});

// A-236-3 (issue 285, F-2): the hold planted through its real path. A shared clone under /var/tmp
// checks out this commit's held trees; each plant edits that copy and runs heldChanges on it.
test('A-236-3 plants: the hold reads planted trees through its real path', () => {
  const box = tmp();
  const head = gitIn(ROOT, ['rev-parse', 'HEAD'])[0];
  execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', ROOT, box]);
  // A-236-7 (issue 343): package.json is checked out too, as the release bump reader reads it.
  const restore = () => { execFileSync('git', ['checkout', '--quiet', head, '--', 'lib', 'spec', 'config', 'config.js', 'package.json'], { cwd: box }); fs.copyFileSync(path.join(ROOT, 'lib/run.js'), path.join(box, 'lib/run.js')); };
  const edit = (file) => fs.appendFileSync(path.join(box, file), '\n');
  restore();
  holdReader(heldChanges(box));
  edit('lib/importers-harbor.js');
  edit('spec/RECEIPT.md');
  holdReader(heldChanges(box));
  edit('lib/stub.js');
  assert.throws(() => holdReader(heldChanges(box)), /only CLI wording may move/, 'a subject edit beside outside edits');
  const files = gitIn(box, ['ls-files', '--', ...SUBJECTS]);
  assert.ok(files.length >= 9);
  for (const file of files) {
    restore();
    edit(file);
    assert.throws(() => holdReader(heldChanges(box)), /only CLI wording may move/, 'planted subject edit: ' + file);
  }
  restore();
  fs.writeFileSync(path.join(box, 'spec/planted.schema.json'), '{}\n');
  execFileSync('git', ['add', 'spec/planted.schema.json'], { cwd: box });
  assert.throws(() => holdReader(heldChanges(box)), /only CLI wording may move/, 'a new tracked schema');
  restore();
  fs.writeFileSync(path.join(box, 'lib/run.js'), execFileSync('git', ['show', HOLD_367 + ':lib/run.js'], { cwd: ROOT }));
  assert.throws(() => holdReader(heldChanges(box)), /only CLI wording may move/, 'A-236-14: old runner bytes');
  restore(); fs.unlinkSync(path.join(box, 'lib/run.js'));
  assert.throws(() => holdReader(heldChanges(box)), /only CLI wording may move/, 'A-236-14: missing runner');
  // A-236-5: an edit to one of issue 317's two in the planted tree reads RED against its hold.
  for (const file of MOVED_317) {
    restore();
    edit(file);
    assert.deepEqual(heldChanges(box).filter((f) => f === file), [file], 'read against the Issue 317 hold: ' + file);
  }
  // A-236-8: an edit to lib/run.js in the planted tree reads RED against the Issue 367 hold.
  for (const file of MOVED_367) {
    restore();
    edit(file);
    assert.deepEqual(heldChanges(box).filter((f) => f === file), [file], 'read against the Issue 367 hold: ' + file);
  }
  // A-236-10, A-236-12: an edit to lib/provider.js in the planted tree reads RED against the Issue 406 hold.
  for (const file of [...MOVED_406, ...MOVED_408]) {
    restore();
    edit(file);
    assert.deepEqual(heldChanges(box).filter((f) => f === file), [file], 'read against its own issue hold: ' + file);
  }
});

// A-236-7 (issue 343): a release bump planted through the hold's real path. The bump is release-prepare's
// own edit, its anchors for config.js and package.json applied by its applyAnchors, to 9.9.9 (A-236-9, issue 382).
test('A-236-7 plants: a release bump reads GREEN, any other change to config.js beside it RED', async () => {
  const { BUMP_ANCHORS, applyAnchors } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'scripts/pipeline.mjs')).href);
  const box = tmp();
  const head = gitIn(ROOT, ['rev-parse', 'HEAD'])[0];
  execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', ROOT, box]);
  const restore = () => { execFileSync('git', ['checkout', '--quiet', head, '--', 'lib', 'spec', 'config', 'config.js', 'package.json'], { cwd: box }); fs.copyFileSync(path.join(ROOT, 'lib/run.js'), path.join(box, 'lib/run.js')); };
  const read = (file) => fs.readFileSync(path.join(box, file), 'utf8');
  const write = (file, text) => fs.writeFileSync(path.join(box, file), text);
  restore();
  const from = JSON.parse(read('package.json')).version;
  const next = '9.9.9';
  const bump = (files, version) => {
    const anchors = BUMP_ANCHORS.filter((a) => files.includes(a.file));
    assert.deepEqual([...new Set(anchors.map((a) => a.file))].sort(), [...files].sort(), 'release-prepare bumps ' + files.join(', '));
    const { out, problems } = applyAnchors(new Map(files.map((f) => [f, read(f)])), anchors, from, version);
    assert.deepEqual(problems, []);
    for (const [file, text] of out) write(file, text);
  };
  const red = (why) => assert.throws(() => holdReader(heldChanges(box)), /only CLI wording may move/, why);
  // The bump moves config.js, and the hold reads it GREEN.
  restore();
  bump(['config.js', 'package.json'], next);
  assert.ok(read('config.js').includes(`const RUNNER_VERSION = '${next}';`), 'the plant moved config.js');
  assert.ok(gitIn(box, ['diff', '--name-only', 'HEAD', '--', 'config.js']).length === 1, 'config.js differs from HEAD');
  holdReader(heldChanges(box));
  // Any other byte of config.js beside the bump reads RED.
  restore();
  bump(['config.js', 'package.json'], next);
  fs.appendFileSync(path.join(box, 'config.js'), '\n');
  red('a release bump with a blank line added to config.js');
  restore();
  bump(['config.js', 'package.json'], next);
  const schema = /^const RECEIPT_SCHEMA_VERSION = '([^']+)';$/m;
  assert.match(read('config.js'), schema);
  write('config.js', read('config.js').replace(schema, (line, v) => line.replace(v, v + '.1')));
  red('a release bump with another version in config.js moved');
  restore();
  bump(['config.js', 'package.json'], next);
  write('config.js', read('config.js') + `const RUNNER_VERSION = '${next}';\n`);
  red('a release bump with a second version line');
  // A version package.json does not carry is not the version a release writes.
  restore();
  bump(['config.js'], next);
  red('config.js bumped without package.json');
  restore();
  bump(['config.js'], next);
  bump(['package.json'], '9.9.8');
  red('config.js and package.json at two versions');
  restore();
  bump(['config.js', 'package.json'], next);
  fs.rmSync(path.join(box, 'package.json'));
  red('a bump with no package.json beside it');
  // The bump does not cover any other held subject.
  restore();
  bump(['config.js', 'package.json'], next);
  fs.appendFileSync(path.join(box, 'lib/stub.js'), '\n');
  red('a subject edit beside the bump');
});

for (const name of ADMITTED) {
  test('AC-1 first output: ' + name, () => first(scenario(ROOT, name).r));
  test('AC-2 no projected cost: ' + name, () => costs(scenario(ROOT, name).r));
  test('AC-3 measures nothing, no scores or outcomes: ' + name, () => {
    const s = scenario(ROOT, name);
    const dir = name.endsWith('regrade') ? 'regraded/' : 'receipts/';
    const emitted = Object.keys(s.artefacts).filter(f => f.startsWith(dir) && /[0-9a-f]{12}\.json$/.test(f)).length;
    assert.ok(emitted > 0);
    results(s.r, emitted);
  });
  test('AC-5 no model calls or misleading counts: ' + name, () => {
    const r = scenario(ROOT, name).r;
    assert.ok(r.events.some((e) => e.kind === 'synthetic'), 'real provider path exercised');
    calls(r);
  });
  test('AC-4 unchanged sealed artefacts and readers: ' + name, () => {
    const actual = scenario(ROOT, name);
    const base = scenario(baseFor(name), name);
    same(actual.artefacts, base.artefacts);
    const dir = name.endsWith('regrade') ? 'regraded' : 'receipts';
    for (const [file, bytes] of Object.entries(actual.artefacts)) {
      if (!file.startsWith(dir + '/') || !/[0-9a-f]{12}\.json$/.test(file)) continue;
      const receipt = JSON.parse(bytes);
      assert.equal(receipt.verification_level, 'UNVERIFIED');
      assert.equal(receipt.run.answered_by.kind, name === 'model-origin-regrade' ? 'model' : 'stub');
      assert.equal(receipt.run.surface, name === 'model-origin-regrade' ? 'api' : 'stub');
      assert.equal(receipt.run.judge.surface, 'stub');
      assert.equal(validateReceipt(receipt).valid, true);
      assert.equal(verifyReceiptHash(receipt), true);
      for (const command of ['validate', 'badge']) {
        const a = cli(ROOT, actual.work, [command, file]);
        const b = cli(baseFor(name), base.work, [command, file]);
        same({ status: a.status, stdout: a.stdout, stderr: a.stderr },
          { status: b.status, stdout: b.stdout, stderr: b.stderr });
        assert.doesNotMatch(output(a), /STUB RUN/);
        if (command === 'badge') assert.match(output(a), /not measured/i);
      }
    }
  });
}

for (const command of ['run', 'regrade']) {
  for (const [label, flags, status] of [
    ['call budget', ['--max-calls', '1'], 3],
    ['dollar budget', ['--max-usd', '0.0001'], 3],
    ['numeric input', ['--samples', '0'], 2],
    ['unknown flag', ['--not-a-flag'], 2],
  ]) {
    test('AC-1/AC-2 rejection: ' + command + ' ' + label, () => {
      const o = scenario(ROOT, 'full');
      const b = scenario(baseRoot, 'full');
      const args = command === 'run'
        ? ['run', 'skill', '--models', 'haiku', '--trusted-skill']
        : ['regrade', path.relative(o.work, receiptIn(path.join(o.work, 'receipts')).file),
          '--skill', 'skill', '--answers', path.join('transcripts', receiptIn(path.join(o.work, 'receipts')).receipt.receipt_hash, 'answers.json'),
          '--judge-model', 'haiku', '--trusted-skill'];
      const a = cli(ROOT, o.work, [...args, ...flags]);
      const before = cli(baseRoot, b.work, [...args, ...flags]);
      assert.equal(a.status, status, a.stderr);
      assert.equal(a.status, before.status);
      assert.equal(a.events.filter((e) => e.kind === 'synthetic').length, 0);
      calls(a);
      first(a);
      costs(a, false);
    });
  }
}

// A-236-3 (issue 285, F-1): AC-1's one exception is spec 235's dependency refusal, which runs
// before the stub statement. It is exactly that refusal: one stderr line, no stdout, exit 2, no work.
function dependencyRefusal(r) {
  assert.equal(r.status, 2, 'the dependency refusal exits 2');
  assert.equal(r.stdout, '', 'the dependency refusal writes nothing to stdout');
  assert.match(inOrder(r), /^ {2}✗ REFUSED \(ajv\): cannot resolve ajv\/dist\/2020\. [^\n]*\n$/, 'exactly the one refusal line');
  assert.equal(r.events.filter((e) => e.kind === 'synthetic').length, 0, 'no provider step');
  calls(r); costs(r, false); results(r, 0);
}
test('AC-1 names its one exception, spec 235\'s dependency refusal', () => {
  const ac1 = /### AC-1:[\s\S]*?\n- \*\*Rationale/.exec(SPEC)[0].replace(/\s+/g, ' ');
  assert.match(ac1, /One exception: spec 235's dependency refusal \(spec 138 RF-88\) runs before it\./);
});
for (const command of ['run', 'regrade']) {
  test('AC-1 exception: dependency refusal on ' + command, () => {
    const o = scenario(ROOT, 'full');
    const before = written(o.work);
    const original = receiptIn(path.join(o.work, 'receipts'));
    const args = command === 'run' ? RUN_ARGS
      : ['regrade', path.relative(o.work, original.file), '--skill', 'skill',
        '--answers', path.join('transcripts', original.receipt.receipt_hash, 'answers.json'),
        '--judge-model', 'haiku', '--trusted-skill', '--out', 'regraded'];
    const r = cli(ROOT, o.work, args, true, false, 'missing-ajv');
    dependencyRefusal(r);
    same(written(o.work), before);
    assert.throws(() => first(r), /STUB RUN/, 'the refusal precedes the stub statement');
    // Plants: anything beside or in place of that one line reads RED.
    const stub = 'STUB RUN (DRIFTPROOF_STUB=1): no model will be called; any emitted receipt will be UNVERIFIED and measure nothing.\n';
    for (const bad of [
      planted(r, 'stdout', 'Heading\n', true), planted(r, 'stdout', stub), planted(r, 'stderr', '\n', true),
      planted(r, 'stderr', 'note: rc ignored\n'), planted(r, 'stderr', 'projected cost: ~$1.06\n'),
      { ...r, status: 0 }, { ...r, events: [...r.events, { kind: 'synthetic', value: 'generation' }] },
    ]) assert.throws(() => dependencyRefusal(bad));
    const ordinary = 'error: unknown flag --not-a-flag\n';
    assert.throws(() => dependencyRefusal({ ...r, stderr: ordinary, events: [{ kind: 'stderr', value: ordinary }] }),
      'an ordinary refusal takes no exception');
  });
}

for (const name of ['full', 'quick', 'multiple-model', 'judge-regrade', 'rubric-regrade']) {
  test('AC-6 non-stub output and artefacts unchanged: ' + name, () => {
    const a = scenario(ROOT, name, false);
    const b = scenario(baseFor(name), name, false);
    same({ status: a.r.status, stdout: a.r.stdout, stderr: a.r.stderr, artefacts: a.artefacts },
      { status: b.r.status, stdout: b.r.stdout, stderr: b.r.stderr, artefacts: b.artefacts });
    assert.match(output(a.r), /projected cost: ~\$/);
    assert.doesNotMatch(output(a.r), /STUB RUN/);
    assert.deepEqual(a.r.events.filter((e) => e.kind === 'model'), []);
  });
}


for (const command of ['run', 'regrade']) {
  for (const [label, flags, status] of [
    ['call budget', ['--max-calls', '1'], 3],
    ['dollar budget', ['--max-usd', '0.0001'], 3],
    ['numeric input', ['--samples', '0'], 2],
    ['unknown flag', ['--not-a-flag'], 2],
  ]) {
    test('AC-6 non-stub rejection unchanged: ' + command + ' ' + label, () => {
      const o = scenario(ROOT, 'full', false);
      const b = scenario(baseRoot, 'full', false);
      const original = receiptIn(path.join(o.work, 'receipts'));
      const args = command === 'run'
        ? ['run', 'skill', '--models', 'haiku', '--trusted-skill']
        : ['regrade', path.relative(o.work, original.file),
          '--skill', 'skill', '--answers', path.join('transcripts', original.receipt.receipt_hash, 'answers.json'),
          '--judge-model', 'haiku', '--trusted-skill'];
      const a = cli(ROOT, o.work, [...args, ...flags], false);
      const before = cli(baseRoot, b.work, [...args, ...flags], false);
      same({ status: a.status, stdout: a.stdout, stderr: a.stderr },
        { status: before.status, stdout: before.stdout, stderr: before.stderr });
      assert.equal(a.status, status);
      assert.equal(a.events.filter((e) => e.kind === 'synthetic' || e.kind === 'model').length, 0);
    });
  }
}

// An independent clean subject keeps every plant readable before implementation.
const clean = {
  status: 0,
  stdout: 'STUB RUN (DRIFTPROOF_STUB=1): no model will be called; the receipt will be UNVERIFIED and measure nothing\nNo projected cost: no model will be called.\nStub receipt measures nothing.\n',
  stderr: '',
  events: [],
};
clean.events.push({ kind: 'stdout', value: clean.stdout });
test('plants: first-line reader rejects headings, blank lines and early stderr', () => {
  first(clean);
  for (const stream of ['stdout', 'stderr']) for (const text of ['Heading\n', '\n', 'note: rc ignored\n']) {
    assert.throws(() => first(planted(clean, stream, text, true)));
  }
});
test('plants: cost reader rejects dollar projections on either stream and refusals', () => {
  costs(clean);
  for (const stream of ['stdout', 'stderr']) {
    for (const text of ['projected cost: ~$1.06\n', 'ABORT: projected cost ~$1.06 exceeds the guard\n', 'actual metered spend: $0.00 (subscription; estimated-equivalent API cost)\n', 'Projected spend: $1.06\n']) {
      assert.throws(() => costs(planted(clean, stream, text), false));
    }
  }
  assert.throws(() => costs({ ...clean, stdout: clean.stdout.replace('No projected cost: no model will be called.\n', '') }));
});
test('plants: result reader rejects scores, lift, outcomes and quick bands on both streams', () => {
  results(clean);
  for (const stream of ['stdout', 'stderr']) for (const text of [
    'skill lift +0.430\n', 'c1 / with_skill: pass (0.85 ± 0.00)\n',
    'c1 / baseline: fail\n', 'score: 0.85\n', 'with the skill 0.850 ± 0.000 vs without 0.420 ± 0.000\n',
    'with the skill 0.850 ± n/a (1 case) vs without 0.420 ± n/a (1 case)\n',
    'Case c1: PASS; score 0.85; lift +0.43\n', '95% confidence the skill helps\n', 'We are confident the skill helps.\n', 'The effect is statistically significant.\n',
    // Issue 301: the lexicon plant is built from the declared literal (spec 031 AC-4).
    `The verdict is ${WITHIN_NOISE}.\n`,
  ]) assert.throws(() => results(planted(clean, stream, text)));
  assert.throws(() => results({ ...clean, stdout: clean.stdout.replace('Stub receipt measures nothing.\n', '') }));
});
test('plants: call reader rejects model attempts and unqualified synthetic counts', () => {
  calls(clean);
  const attempt = structuredClone(clean);
  attempt.events.push({ kind: 'model', value: 'request' });
  assert.throws(() => calls(attempt));
  for (const stream of ['stdout', 'stderr']) for (const text of [
    'receipt.json (18 calls)\n', 'receipt.json (12 judge calls)\n',
    'projected calls: 60\n', 'progress: call 1 of 18: generation done\n',
    'Model calls: 18\n', 'The model that wrote each answer also grades it.\n',
  ]) assert.throws(() => calls(planted(clean, stream, text)));
});
test('plants: artefact reader rejects resealed scores, identity, judge surface and summaries', () => {
  const a = scenario(ROOT, 'full').artefacts;
  const file = Object.keys(a).find((f) => /^receipts\/.*[0-9a-f]{12}\.json$/.test(f));
  assert.ok(file);
  for (const edit of [
    (r) => { r.results.cases[0].score = 0.01; },
    (r) => { r.run.answered_by.kind = 'model'; },
    (r) => { r.run.judge.surface = 'api'; },
  ]) {
    const r = JSON.parse(a[file]); edit(r); sealReceipt(r);
    assert.throws(() => same({ ...a, [file]: JSON.stringify(r, null, 2) }, a));
  }
  const summary = Object.keys(a).find((f) => f.endsWith('.summary.md'));
  assert.ok(summary);
  assert.throws(() => same({ ...a, [summary]: a[summary] + '\nChanged\n' }, a));
});
test('plants: non-stub equivalence reader rejects banner, cost, exit and artefact changes', () => {
  const a = scenario(ROOT, 'full', false);
  for (const b of [
    { ...a, r: { ...a.r, stdout: 'STUB RUN\n' + a.r.stdout } },
    { ...a, r: { ...a.r, stdout: a.r.stdout.replace('projected cost', 'different cost') } },
    { ...a, r: { ...a.r, status: 3 } },
    { ...a, artefacts: { ...a.artefacts, unexpected: 'changed' } },
  ]) assert.throws(() => same(b, a));
});

test('AC-4 genuine stub replies carry no fabricated serving evidence', () => {
  const r = scenario(ROOT, 'full').r;
  const observed = r.events.filter((e) => e.kind === 'stub-evidence');
  assert.ok(observed.length > 0);
  const reader = (value) => {
    assert.equal(value.answeredBy, 'stub');
    assert.equal(value.surface, 'stub');
    assert.equal(value.reportedModels, null);
  };
  for (const e of observed) reader(e.value);
  assert.throws(() => reader({ ...observed[0].value, reportedModels: ['fabricated-model'] }));
});
for (const subscription of [false, true]) {
  test('AC-1/AC-4 authentic rubric refusal: ' + (subscription ? 'subscription' : 'api'), () => {
    function refusal(root) {
      const o = scenario(root, 'full');
      const orig = receiptIn(path.join(o.work, 'receipts'));
      return { o, before: written(o.work), r: cli(root, o.work,
        ['regrade', path.relative(o.work, orig.file), '--skill', 'skill',
          '--answers', path.join('transcripts', orig.receipt.receipt_hash, 'answers.json'),
          '--rubric', 'revised.json', '--trusted-skill', '--out', 'regraded'], true, subscription) };
    }
    const a = refusal(ROOT), b = refusal(baseRoot);
    const reader = (r) => {
      assert.equal(r.status, 2);
      assert.match(output(r), /judge reported models do not establish its identity/);
      assert.equal(r.events.filter((e) => e.kind === 'synthetic').length, 0);
    };
    reader(a.r); reader(b.r);
    same(written(a.o.work), a.before);
    first(a.r); costs(a.r, false); results(a.r, 0); calls(a.r);
    assert.throws(() => reader({ ...a.r, status: 0 }));
  });
}
test('AC-1/AC-2/AC-3/AC-5 partial write failure after the first receipt', () => {
  const work = fixture();
  const args = [...RUN_ARGS];
  args[args.indexOf('--models') + 1] = 'haiku,sonnet';
  const r = cli(ROOT, work, args, true, false, 'partial-write');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /fixture disk failure/);
  const emitted = Object.keys(written(work)).filter((f) => /^receipts\/.*[0-9a-f]{12}\.json$/.test(f));
  assert.equal(emitted.length, 1);
  first(r); costs(r); results(r, emitted.length); calls(r);
});
test('AC-3 repeat-run collisions report no newly emitted measurement', () => {
  const o = scenario(ROOT, 'multiple-model');
  const before = written(o.work);
  const args = [...RUN_ARGS];
  args[args.indexOf('--models') + 1] = 'haiku,sonnet';
  const r = cli(ROOT, o.work, args);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exist/);
  same(written(o.work), before);
  first(r); costs(r); results(r, 0); calls(r);
});
for (const [plant, name] of [['fd-1', 'stdout'], ['fd-2', 'stderr']]) {
  test('executable plant: descriptor write is RED on AC-1: ' + name, () => {
    const r = cli(ROOT, fixture(), RUN_ARGS, true, false, plant);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r[name].startsWith('Heading\n'), 'real descriptor bytes precede the banner');
    assert.equal(inOrder(r).split('\n')[0], 'Heading');
    assert.throws(() => first(r), /STUB RUN/);
  });
}
for (const plant of ['fetch', 'http', 'https', 'socket', 'process']) {
  test('executable plant: blocked ' + plant + ' is RED on AC-5', () => {
    const r = cli(ROOT, fixture(), RUN_ARGS, true, false, plant);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /offline fixture refused model access/);
    const seen = r.events.filter((e) => e.kind === 'model');
    assert.equal(seen.length, 1, 'the attempted access itself was intercepted');
    assert.match(seen[0].value, plant === 'process' ? /process claude/ : new RegExp(plant));
    assert.throws(() => calls(r), /model process or network attempt/);
  });
}

test('plants: completion reader rejects extra claims on un-emitted receipts', () => {
  assert.throws(() => results(clean, 0), /completion claims equal emitted receipts/);
  assert.throws(() => results(clean, 2), /completion claims equal emitted receipts/);
});

for (const [command, plant] of [['run', 'summary-write'], ['regrade', 'summary-write'], ['regrade', 'sidecar-write']]) {
  test('AC-3 metadata write failure after persisted JSON: ' + command + ' ' + plant, () => {
    const o = command === 'run' ? { work: fixture() } : scenario(ROOT, 'metadata-original-' + plant);
    const args = command === 'run' ? RUN_ARGS : (() => {
      const original = receiptIn(path.join(o.work, 'receipts'));
      return ['regrade', path.relative(o.work, original.file), '--skill', 'skill',
        '--answers', path.join('transcripts', original.receipt.receipt_hash, 'answers.json'),
        '--judge-model', 'haiku', '--trusted-skill', '--out', 'regraded'];
    })();
    const r = cli(ROOT, o.work, args, true, false, plant);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fixture metadata failure/);
    const dir = command === 'run' ? 'receipts' : 'regraded';
    const emitted = receiptIn(path.join(o.work, dir)).receipt;
    assert.equal(validateReceipt(emitted).valid, true);
    assert.equal(verifyReceiptHash(emitted), true);
    first(r); costs(r); results(r, 1); calls(r);
    const b = command === 'run' ? { work: fixture() } : scenario(baseRoot, 'metadata-original-' + plant);
    const bad = cli(baseRoot, b.work, args, true, false, plant);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /fixture metadata failure/);
    assert.equal(verifyReceiptHash(receiptIn(path.join(b.work, dir)).receipt), true);
    assert.throws(() => results(bad, 1), /completion claims equal emitted receipts/);
  });
}

// A-236-11 (issue 381): spec 301's two readings of its approval's F-2 and F-3, moved here with their
// plants when spec 301 was deleted. Each runs the real CLI in a copy of the tree, under the stub, with no
// provider credential; a plant is applied to the copy's bin/driftproof and must be read RED for its reason.
const STATEMENT_301 = /^STUB RUN \(DRIFTPROOF_STUB=1\):.*UNVERIFIED.*measure nothing/;
const JUDGE_301 = 'claude-haiku-4-5';
const CAP_301 = '0.0001';
const tree301 = (plants = []) => {
  const d = tmp();
  for (const rel of ['bin', 'lib', 'spec', 'examples', 'config', 'config.js', 'package.json']) {
    fs.cpSync(path.join(ROOT, rel), path.join(d, rel), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(d, 'node_modules'));
  for (const [rel, from, to] of plants) {
    const p = path.join(d, rel);
    const src = fs.readFileSync(p, 'utf8');
    assert.equal(src.split(from).length - 1, 1, `the plant's anchor occurs once in ${rel}: ${from.slice(0, 80)}`);
    fs.writeFileSync(p, src.split(from).join(to));
  }
  return d;
};
const cli301 = (dir, args, cwd) => {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^NODE_OPTIONS$/.test(k)) continue;
    env[k] = v;
  }
  const r = spawnSync(process.execPath, [path.join(dir, 'bin', 'driftproof'), ...args], {
    cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 32 << 20,
    env: { ...env, DRIFTPROOF_STUB: '1', CLAUDE_PROVIDER: 'stub', NODE_NO_WARNINGS: '1' },
  });
  if (r.error) throw r.error;
  return r;
};
const receipts301 = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /[0-9a-f]{12}\.json$/.test(f)) : []);

// F-2: a stub regrade refused by the dollar guard names the cap as passed and the planned synthetic calls,
// the draws the planner judges times the samples; it quotes no dollar amount and writes no receipt.
const readRegrade301 = (dir) => {
  const work = tmp();
  const skill = path.join(dir, 'examples', 'commit-message-conventions');
  const run = cli301(dir, ['run', skill, '--models', JUDGE_301, '--max-cases', '2', '--samples', '1', '--trusted-skill', '--keep-transcripts', '--out', 'receipts'], work);
  if (run.status !== 0) return [`the stub run that makes the receipt to regrade exited ${run.status}: ${run.stderr.slice(-300)}`];
  const file = path.join(work, 'receipts', receipts301(path.join(work, 'receipts'))[0]);
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  const answersFile = path.join('transcripts', receipt.receipt_hash, 'answers.json');
  const { readAnswers, drawsToJudge } = require('../lib/regrade.js');
  const planned = drawsToJudge(receipt, readAnswers(path.join(work, answersFile)).answers).length * 1;
  const r = cli301(dir, ['regrade', file, '--skill', skill, '--answers', answersFile, '--judge-model', JUDGE_301, '--samples', '1', '--trusted-skill', '--max-usd', CAP_301, '--out', 'regraded'], work);
  const out = r.stdout + r.stderr;
  const problems = [];
  if (r.status !== 3) problems.push(`expected the cost guard's exit 3, got ${r.status}`);
  const line = out.split('\n').find((l) => /ABORT \(cost guard\)/.test(l) && /--max-usd/.test(l));
  if (!line) problems.push('no dollar cost-guard refusal');
  else {
    const cap = /exceeds --max-usd ([0-9][0-9.e-]*?)(?=[:;,\s]|$)/.exec(line);
    if (!cap) problems.push(`the regrade refusal does not name the cap: ${line.trim()}`);
    else if (Number(cap[1]) !== Number(CAP_301)) problems.push(`the regrade refusal names cap ${cap[1]}, not the ${CAP_301} that was passed`);
    const calls = /\b([0-9]+) synthetic calls planned\b/.exec(line);
    if (!calls) problems.push(`the regrade refusal does not name the planned synthetic calls: ${line.trim()}`);
    else if (Number(calls[1]) !== planned) problems.push(`the regrade refusal names ${calls[1]} planned calls where the plan judges ${planned}`);
  }
  if (/\$\s*~?\s*[0-9]/.test(out)) problems.push('the stub regrade quotes a dollar amount');
  if (receipts301(path.join(work, 'regraded')).length) problems.push('the refused regrade still wrote a receipt');
  if (planned < 1) problems.push('the plan judges no draw, so the count reads nothing');
  return problems;
};

// F-3: a value given to a no-value flag under the stub exits 2 with nothing on stdout, and stderr's first
// line is the STUB RUN statement, before the refusal naming the flag.
const readFlags301 = (dir) => {
  const work = tmp();
  const skill = path.join(dir, 'examples', 'commit-message-conventions');
  const problems = [];
  for (const [flag, args] of [
    ['trusted-skill', ['run', skill, '--trusted-skill=false']],
    ['keep-transcripts', ['run', skill, '--keep-transcripts=false']],
    ['trusted-skill', ['run', skill, '--trusted-skill', 'false']],
    ['trusted-skill', ['regrade', 'r.json', '--skill', skill, '--answers', 'r.json', '--judge-model', JUDGE_301, '--trusted-skill=false']],
  ]) {
    const r = cli301(dir, args, work);
    const said = `${args[0]} ${args.slice(-2).join(' ')}`;
    if (r.status !== 2) problems.push(`${said}: exit ${r.status}, not 2`);
    if (r.stdout !== '') problems.push(`${said}: stdout is not empty`);
    const lines = r.stderr.split('\n').filter((l) => l.trim());
    if (!lines.length || !STATEMENT_301.test(lines[0].trim())) problems.push(`${said}: the first line written is not the stub statement`);
    if (lines.findIndex((l) => /REFUSED/.test(l) && l.includes(`--${flag}`)) < 1) problems.push(`${said}: no refusal naming --${flag} after the statement`);
  }
  if (receipts301(path.join(work, 'receipts')).length) problems.push('a refused run wrote a receipt');
  return problems;
};

const REGRADE_ANCHOR_301 = 'stub plan exceeds --max-usd ${maxUsd}: ${plan.calls} synthetic calls planned; no model will be called.`';
const PARSE_ANCHOR_301 = 'parseArgs(rest, stubDoor ? () => console.error(STUB_STATEMENT) : null)';

test('A-236-11 (spec 301 F-2): the stub regrade refusal names the cap and the planned synthetic calls, read back', () => {
  assert.deepEqual(readRegrade301(tree301()), []);
});

test('A-236-11 (spec 301 F-2) plants: issue 236\'s regrade refusal and one naming a call more than planned each read RED', () => {
  const old = readRegrade301(tree301([['bin/driftproof', '`\\n  ✗ ABORT (cost guard): ' + REGRADE_ANCHOR_301,
    "'\\n  ✗ ABORT (cost guard): stub plan exceeds --max-usd; no model will be called.'"]]));
  assert.ok(old.some((p) => /does not name the cap/.test(p)), old.join('; '));
  const more = readRegrade301(tree301([['bin/driftproof', REGRADE_ANCHOR_301, REGRADE_ANCHOR_301.replace('${plan.calls}', '${plan.calls + 1}')]]));
  assert.ok(more.some((p) => /planned calls where the plan judges/.test(p)), more.join('; '));
});

test('A-236-11 (spec 301 F-3): a refused no-value flag writes the stub statement first, on stderr, and nothing on stdout', () => {
  assert.deepEqual(readFlags301(tree301()), []);
});

test('A-236-11 (spec 301 F-3) plants: the statement left out, and on stdout before parsing, each read RED', () => {
  const none = readFlags301(tree301([['bin/driftproof', PARSE_ANCHOR_301, 'parseArgs(rest, null)']]));
  assert.ok(none.some((p) => /first line written is not the stub statement/.test(p)), none.join('; '));
  const out = readFlags301(tree301([['bin/driftproof', PARSE_ANCHOR_301, '(stubDoor && console.log(STUB_STATEMENT), parseArgs(rest, null))']]));
  assert.ok(out.some((p) => /stdout is not empty/.test(p)), out.join('; '));
});
