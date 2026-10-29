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
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
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

// A-236-18 (issue 469, C-315): delivered preservation holds and their plants retired.
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
  test('AC-4 sealed stub identity and readers: ' + name, () => {
    const actual = scenario(ROOT, name);
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
        assert.equal(a.status, 0, a.stderr);
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
      const args = command === 'run'
        ? ['run', 'skill', '--models', 'haiku', '--trusted-skill']
        : ['regrade', path.relative(o.work, receiptIn(path.join(o.work, 'receipts')).file),
          '--skill', 'skill', '--answers', path.join('transcripts', receiptIn(path.join(o.work, 'receipts')).receipt.receipt_hash, 'answers.json'),
          '--judge-model', 'haiku', '--trusted-skill'];
      const a = cli(ROOT, o.work, [...args, ...flags]);
      assert.equal(a.status, status, a.stderr);
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
  test('AC-6 non-stub output has no stub attribution: ' + name, () => {
    const a = scenario(ROOT, name, false);
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
    test('AC-6 non-stub rejection status and no calls: ' + command + ' ' + label, () => {
      const o = scenario(ROOT, 'full', false);
      const original = receiptIn(path.join(o.work, 'receipts'));
      const args = command === 'run'
        ? ['run', 'skill', '--models', 'haiku', '--trusted-skill']
        : ['regrade', path.relative(o.work, original.file),
          '--skill', 'skill', '--answers', path.join('transcripts', original.receipt.receipt_hash, 'answers.json'),
          '--judge-model', 'haiku', '--trusted-skill'];
      const a = cli(ROOT, o.work, [...args, ...flags], false);
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
