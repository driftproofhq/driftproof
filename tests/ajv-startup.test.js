// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'spec235-test-'));
const RUNTIME = path.join(TMP, 'package space\nline');
fs.mkdirSync(RUNTIME);
for (const dir of ['bin', 'lib', 'spec', 'config']) {
  fs.cpSync(path.join(ROOT, dir), path.join(RUNTIME, dir), { recursive: true });
}
for (const file of ['config.js', 'package.json']) {
  fs.copyFileSync(path.join(ROOT, file), path.join(RUNTIME, file));
}
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(RUNTIME, 'node_modules'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const HOOK = path.join(ROOT, 'tests', 'fixtures', 'ajv-startup-audit.cjs');
let counter = 0;
function invoke(argv, { cwd, block = true, mode = block ? 'missing' : 'installed',
  evalCode = null, runtime = RUNTIME, watch = [], guard = false, timeout = 1800000,
  extraEnv = {}, fixed = false } = {}) {
  const audit = path.join(TMP, 'audit-' + (++counter));
  fs.writeFileSync(audit, '');
  const args = ['--require', HOOK, ...(evalCode === null ? [path.join(runtime, 'bin', 'driftproof'), ...argv] : ['-e', evalCode])];
  const r = spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', timeout, maxBuffer: 8 << 20,
    env: { PATH: process.env.PATH, TMPDIR: TMP, DRIFTPROOF_STUB: '1',
      SPEC235_MODE: mode, SPEC235_RUNTIME: runtime, SPEC235_GUARD: guard ? '1' : '0',
      SPEC235_FIXED: fixed ? '1' : '0',
      SPEC235_WATCH: JSON.stringify([cwd, path.join(runtime, 'config', 'models.json'), ...watch]),
      SPEC235_AUDIT: audit, ...extraEnv },
  });
  assert.ifError(r.error);
  return { ...r, events: fs.readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

function work() {
  const cwd = fs.mkdtempSync(path.join(TMP, 'work-'));
  const skill = path.join(cwd, 'skill');
  fs.mkdirSync(path.join(skill, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: fx\nversion: 1.0.0\n---\n\n# Fixture\n\nAnswer in one short sentence.\n');
  fs.writeFileSync(path.join(skill, 'evals', 'evals.json'), JSON.stringify({ cases: [
    { id: 'one', prompt: 'Say hello.', rubric: 'A greeting scores 0.8.' },
    { id: 'two', prompt: 'Say goodbye.', rubric: 'A farewell scores 0.8.' },
  ] }));
  return { cwd, skill };
}
function snapshot(dir) {
  const out = {};
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { out[path.relative(dir, p) + '/'] = null; walk(p); }
      else out[path.relative(dir, p)] = fs.readFileSync(p).toString('base64');
    }
  }
  walk(dir);
  return out;
}
function refusal(r, runtime = RUNTIME) {
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, '', 'stdout was written before refusal');
  assert.match(r.stderr, /^[^\r\n]+\n$/, 'refusal must be exactly one stderr line');
  assert.match(r.stderr, /\bajv\b/);
  assert.match(r.stderr, /npm install/);
  const home = os.homedir();
  const root = runtime === home ? '~' : runtime.startsWith(home + path.sep) ? '~' + runtime.slice(home.length) : runtime;
  const display = root.length > 2048 ? root.slice(0, 1000) + ' [middle omitted] ' + root.slice(-1000) : root;
  const escaped = JSON.stringify(display).replace(/[\u007f-\u009f\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  assert.ok(r.stderr.includes(escaped), 'refusal must name the escaped package root');
  assert.match(r.stderr, /display only/);
  assert.match(r.stderr, /directory containing this installation's bin\/driftproof/);
  assert.ok(r.stderr.length <= 12500, 'diagnostic exceeds its bound');
  assert.doesNotMatch(r.stderr.slice(0, -1), /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  assert.doesNotMatch(r.stderr, /\bcd\s/);
  assert.doesNotMatch(r.stderr, /FATAL|Error:|\bat .+:\d+/);
  assert.deepEqual(r.events, [{ kind: 'ajv', request: 'ajv/dist/2020', parent: path.join(runtime, 'lib', 'receipt.js') }], 'must probe the exact entry from receipt.js before any input or model work');
}

// Inputs deliberately absent: the startup check must beat input reads and errors on every path.
const COMMANDS = {
  run: (w) => ['run', w.skill, '--quick', '--out', path.join(w.cwd, 'out')],
  regrade: (w) => ['regrade', path.join(w.cwd, 'missing.json'), '--skill', w.skill],
  import: (w) => ['import', path.join(w.cwd, 'missing.json'), '--from', 'skill-creator'],
  validate: (w) => ['validate', path.join(w.cwd, 'missing.json')],
  badge: (w) => ['badge', path.join(w.cwd, 'missing.json')],
  'badge directory': (w) => ['badge', w.cwd],
  decide: (w) => ['decide', w.cwd, '--models', 'claude-haiku-4-5'],
  diff: (w) => ['diff', path.join(w.cwd, 'a.json'), path.join(w.cwd, 'b.json')],
  export: (w) => ['export', path.join(w.cwd, 'missing.json')],
  stale: (w) => ['stale', w.cwd, '--no-harness-check'],
  view: (w) => ['view', w.cwd, '--out', path.join(w.cwd, 'view.html')],
};
for (const [name, argv] of Object.entries(COMMANDS)) {
  test('AC-1/AC-3 missing ajv refuses ' + name + ' before work, with one repair line', () => {
    const w = work();
    const before = snapshot(w.cwd);
    const r = invoke(argv(w), w);
    assert.deepEqual(snapshot(w.cwd), before, 'a refused command changed its inputs or outputs');
    refusal(r);
    const again = invoke(argv(w), w);
    assert.equal(again.stderr, r.stderr, 'identical refusal inputs must yield identical output');
    assert.deepEqual(again.events, r.events);
  });
}

test('AC-2/AC-5 the audit observes installed-dependency calls; missing ajv spends none on valid run and regrade inputs', () => {
  const w = work();
  const out = path.join(w.cwd, 'receipts');
  const argv = ['run', w.skill, '--quick', '--keep-transcripts', '--out', out];
  const control = invoke(argv, { ...w, block: false });
  assert.equal(control.status, 0, control.stderr);
  assert.ok(control.events.some((e) => e.kind === 'model'), 'provider audit missed the control calls');
  const files = fs.readdirSync(out).filter((f) => f.endsWith('.json') && !/\.(summary|regrade)\.json$/.test(f));
  assert.equal(files.length, 1);
  const file = path.join(out, files[0]);
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
  assert.equal(validateReceipt(receipt).valid, true);
  assert.equal(verifyReceiptHash(receipt), true);
  const installedRegrade = invoke(['regrade', file, '--skill', w.skill, '--answers',
    path.join(w.cwd, 'transcripts', receipt.receipt_hash, 'answers.json'),
    '--judge-model', receipt.run.judge.model_id, '--out', path.join(w.cwd, 'control-regrade')], { ...w, block: false });
  assert.equal(installedRegrade.status, 0, installedRegrade.stderr);
  assert.ok(installedRegrade.events.some((e) => e.kind === 'model'), 'provider audit missed the regrade control calls');
  const before = snapshot(w.cwd);
  const absentRun = invoke(['run', w.skill, '--quick', '--out', path.join(w.cwd, 'refused-run')], w);
  const absentRegrade = invoke(['regrade', file, '--skill', w.skill, '--answers',
    path.join(w.cwd, 'transcripts', receipt.receipt_hash, 'answers.json'),
    '--judge-model', receipt.run.judge.model_id, '--out', path.join(w.cwd, 'refused-regrade')], w);
  assert.deepEqual(snapshot(w.cwd), before);
  refusal(absentRun);
  refusal(absentRegrade);
});

test('AC-4 hash-only library use never resolves ajv', () => {
  const w = work();
  const code = 'const assert = require("node:assert/strict"); const r = require(' +
    JSON.stringify(path.join(RUNTIME, 'lib', 'receipt.js')) +
    '); const doc = { fixture: "hash only" }; const hash = r.computeReceiptHash(doc); r.sealReceipt(doc); assert.equal(doc.receipt_hash, hash); assert.equal(r.verifyReceiptHash(doc), true);';
  const r = invoke([], { ...w, evalCode: code });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.events, []);
});

for (const name of ['help', 'version', 'init', 'overlap']) {
  test('AC-5 ' + name + ' works without ajv', () => {
    const w = work();
    const argv = name === 'init' ? ['init', path.join(w.cwd, 'new-skill')] :
      name === 'overlap' ? ['overlap', w.skill] : [name];
    const r = invoke(argv, w);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.events.some((e) => e.kind === 'ajv'), false, 'exempt command resolved ajv');
  });
}

test('AC-6 the census trigger refuses and disabling its site makes the row red', async () => {
  const censusTmp = path.join(TMP, 'census');
  fs.mkdirSync(censusTmp);
  const previous = process.env.SPEC138_TMP;
  process.env.SPEC138_TMP = censusTmp;
  try {
    const census = await import(path.join(ROOT, 'specs', '138-first-run', 'probes', 'census.mjs'));
    const row = census.ROWS['RF-88'];
    assert.ok(row, 'spec 138 is missing RF-88');
    const spec = fs.readFileSync(path.join(ROOT, 'specs', '138-first-run', 'spec.md'), 'utf8');
    assert.match(spec, /^\| RF-88 \|.+\| 2 \|.+ajv.+$/m);
    const matches = (out) => out.r.exit === 2 && out.r.stdout === '' &&
      /^[^\r\n]+\n$/.test(out.r.stderr) &&
      /REFUSED/.test(out.r.stderr) && /\bajv\b/.test(out.r.stderr) &&
      /npm install/.test(out.r.stderr) && out.wrote.length === 0;
    assert.equal(matches(row.run({ rt: { dir: ROOT } })), true, 'RF-88 does not reach its refusal');
    const plant = census.sitePlant(row.file, row.anchor);
    assert.ok(plant.from && !plant.from.includes('\u0000'), 'the site anchor is unreadable');
    assert.notEqual(plant.to, plant.from, 'the site plant disables nothing');
    const mutant = path.join(TMP, 'census-mutant');
    fs.cpSync(RUNTIME, mutant, { recursive: true, dereference: false });
    const target = path.join(mutant, plant.file);
    const source = fs.readFileSync(target, 'utf8');
    assert.equal(source.split(plant.from).length, 2, 'the plant must anchor exactly once');
    fs.writeFileSync(target, source.replace(plant.from, plant.to));
    const parsed = spawnSync(process.execPath, ['--check', path.join(mutant, 'bin', 'driftproof')], { encoding: 'utf8', timeout: 1800000 });
    assert.equal(parsed.status, 0, parsed.stderr);
    const disabled = row.run({ rt: { dir: mutant } });
    assert.equal(disabled.r.dependencyProbed, true, 'mutant did not reach the dependency probe');
    assert.equal(disabled.r.error, null, 'mutant failed to execute');
    assert.match(disabled.r.stderr, /FATAL Error: receipt validation requires the .ajv. package/);
    const w = work();
    const installed = invoke(['run', w.skill, '--quick', '--out', path.join(w.cwd, 'out')], { ...w, runtime: mutant, block: false });
    assert.equal(installed.status, 0, installed.stderr);
    assert.ok(installed.events.some((e) => e.kind === 'model'), 'mutant installed control did not dispatch');
    assert.equal(matches(disabled), false, 'disabled refusal still reads green');
  } finally {
    if (previous === undefined) delete process.env.SPEC138_TMP;
    else process.env.SPEC138_TMP = previous;
  }
});

for (const name of ['run', 'regrade', 'import', 'validate', 'badge', 'decide', 'diff', 'export', 'stale', 'view']) {
  for (const rest of [[], ['--strict=false']]) {
    test('A-235-1 dependency refusal precedes argument validation: ' + name + ' ' + rest.join(' '), () => {
      const w = work();
      refusal(invoke([name, ...rest], w));
    });
  }
}

test('A-235-2 contrasting resolver contexts require the receipt entry, not bare ajv or cwd', () => {
  const w = work();
  const argv = ['run', w.skill, '--quick', '--out', path.join(w.cwd, 'out')];
  // All other contexts, and bare ajv, resolve through the real installed package.
  refusal(invoke(argv, { ...w, mode: 'entry-missing' }));
  // The entry is present even though the package's bare entry is not.
  const present = invoke(argv, { ...w, mode: 'bare-missing' });
  assert.equal(present.status, 0, present.stderr);
  assert.ok(present.events.some((e) => e.kind === 'model'));
  assert.equal(present.events.some((e) => e.kind === 'ajv' && e.request === 'ajv'), false);
});

test('A-235-3 transitive loading failure is explicitly outside the resolution guarantee', () => {
  const w = work();
  const r = invoke(['run', w.skill, '--quick', '--out', path.join(w.cwd, 'out')], { ...w, mode: 'transitive-missing' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /FATAL/);
  assert.ok(r.events.some((e) => e.kind === 'model'), 'this fixture must reach model dispatch before lazy loading');
  assert.ok(r.events.some((e) => e.kind === 'load-failed'));
});

function copyRuntime(dir) {
  fs.cpSync(RUNTIME, dir, { recursive: true, verbatimSymlinks: true });
  return dir;
}
test('A-235-4 hostile package paths remain display text, single-line and bounded', () => {
  const roots = [
    path.join(TMP, 'package $() ' + String.fromCharCode(96) + 'x' + String.fromCharCode(96) + ' "quotes"\r\n\t\u0001\u007f\u0085\u009b\u2028\u2029 end'),
    path.join(TMP, ...Array(23).fill('long-' + 'a'.repeat(90)), 'package-end'),
  ];
  for (const root of roots) {
    fs.mkdirSync(root, { recursive: true });
    copyRuntime(root);
    const w = work();
    const r = invoke(['validate'], { ...w, runtime: root });
    refusal(r, root);
    assert.ok(r.stderr.includes('package'), 'location information was lost');
    if (root.length > 2048) {
      assert.match(r.stderr, /\[middle omitted\]/);
      assert.ok(r.stderr.includes('package-end'));
    }
  }
});

test('A-235-5 audit detects external, configuration, Buffer, URL and promise reads before touching hostile input', () => {
  const w = work();
  const external = fs.mkdtempSync(path.join(TMP, 'external-'));
  const poison = path.join(external, 'hostile');
  // A stream with no end. The audit rejects access before the filesystem reads it.
  fs.symlinkSync('/dev/zero', poison);
  for (const code of [
    'require("node:fs").readFileSync(' + JSON.stringify(poison) + ')',
    'require("node:fs").readFileSync(Buffer.from(' + JSON.stringify(poison) + '))',
    'require("node:fs").readFileSync(require("node:url").pathToFileURL(' + JSON.stringify(poison) + '))',
    'require("node:fs").promises.readFile(require("node:url").pathToFileURL(' + JSON.stringify(poison) + '))',
    'require("node:fs").promises.open(Buffer.from(' + JSON.stringify(poison) + '))',
  ]) {
    const r = invoke([], { ...w, evalCode: code, watch: [external], guard: true, timeout: 2000 });
    assert.equal(r.status, 1);
    assert.ok(r.events.some((e) => e.kind === 'work'), 'audit missed its planted read');
    assert.match(r.stderr, /planted input access stopped before reading/);
  }
  const r = invoke(['run', external, '--quick'], { ...w, watch: [external], guard: true,
    timeout: 2000, extraEnv: { DRIFTPROOF_REGISTRY: poison } });
  refusal(r);
});

// Compare every byte, including receipt_hash, under the same fixed clock and stub inputs.
// Only the two production files in this issue's scope are replaced with baseline bytes.
const BASE = 'b7b4d009276515dfeed57d28392cc5aca1cfbfe3';
function baselineRuntime() {
  const dir = copyRuntime(path.join(TMP, 'baseline'));
  for (const file of ['bin/driftproof', 'lib/receipt.js']) {
    fs.writeFileSync(path.join(dir, file), execFileSync('git', ['show', BASE + ':' + file], { cwd: ROOT, timeout: 1800000 }));
  }
  // A-235-9: the Base's schema table is replaced by today's, so the Base validator holds every receipt
  // version today's runtime writes. The table is the only part of the Base's lib/receipt.js that changes.
  const table = (source) => {
    const found = source.match(/^const SCHEMA_FILES = \{\n[\s\S]*?^\};$/gm);
    assert.equal(found && found.length, 1, 'lib/receipt.js holds exactly one schema table');
    return found[0];
  };
  const file = path.join(dir, 'lib', 'receipt.js');
  const base = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, base.replace(table(base), () => table(fs.readFileSync(path.join(ROOT, 'lib', 'receipt.js'), 'utf8'))));
  return dir;
}
function fixedReceipt(w, runtime, outName) {
  const out = path.join(w.cwd, outName);
  const r = invoke(['run', w.skill, '--quick', '--out', out], { ...w, runtime, block: false, fixed: true });
  assert.equal(r.status, 0, r.stderr);
  const files = fs.readdirSync(out).filter((f) => f.endsWith('.json') && !/\.(summary|regrade)\.json$/.test(f));
  assert.equal(files.length, 1);
  return fs.readFileSync(path.join(out, files[0]), 'utf8');
}
test('A-235-6 installed receipt bytes match the baseline; a resealed score mutation is detected', () => {
  const w = work();
  const expected = fixedReceipt(w, baselineRuntime(), 'baseline-out');
  const actual = fixedReceipt(w, RUNTIME, 'candidate-out');
  assert.equal(actual, expected, 'the dependency check changed receipt semantics');
  const mutant = copyRuntime(path.join(TMP, 'score-mutant'));
  const file = path.join(mutant, 'lib', 'receipt.js');
  const source = fs.readFileSync(file, 'utf8');
  const anchor = 'function sealReceipt(receipt) {';
  assert.equal(source.split(anchor).length, 2);
  fs.writeFileSync(file, source.replace(anchor, anchor + '\n  if (receipt.results) receipt.results.aggregates.with_skill.mean_score += 0.01;'));
  const changed = fixedReceipt(w, mutant, 'mutant-out');
  const doc = JSON.parse(changed);
  const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
  assert.equal(validateReceipt(doc).valid, true, 'the mutant must remain schema-valid');
  assert.equal(verifyReceiptHash(doc), true, 'the mutant must be resealed');
  assert.notEqual(changed, expected, 'a resealed score mutation survived the byte comparison');
});
