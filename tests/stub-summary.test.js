// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 245. The Markdown summary beside a receipt the stub answered or graded.
// Subjects are summaries the real CLI wrote, read back from disk, and receipts
// rendered again by the Base and candidate renderers. No model is reached.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const SPEC = fs.readFileSync(path.join(ROOT, 'specs/245-stub-summary/spec.md'), 'utf8');
const BASE = /\*\*Base:\*\* .* at \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
delete process.env.DRIFTPROOF_STUB;
const made = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join('/var/tmp', 'stub245-'));
  made.push(d);
  return d;
};
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// The Base tree: the CLI, the library, config and schemas as they were at the Base.
const harness = tmp();
const baseRoot = path.join(harness, 'base');
fs.mkdirSync(baseRoot);
const tar = path.join(harness, 'base.tar');
execFileSync('git', ['archive', '--format=tar', '-o', tar, BASE, 'bin', 'lib', 'config.js', 'config', 'spec', 'package.json'], { cwd: ROOT });
execFileSync('tar', ['-xf', tar, '-C', baseRoot]);
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(baseRoot, 'node_modules'));
const candidate = require(path.join(ROOT, 'lib/run.js')).summarizeReceipt;
const baseline = require(path.join(baseRoot, 'lib/run.js')).summarizeReceipt;
const { judgeCodeRevision } = require(path.join(ROOT, 'lib/judge.js'));
const { sealReceipt } = require(path.join(ROOT, 'lib/receipt.js'));
const { WITHIN_NOISE } = require(path.join(ROOT, 'lib/stats.js'));

const preload = path.join(harness, 'preload.cjs');
fs.writeFileSync(preload, [
  "'use strict';",
  "const fs = require('node:fs');",
  'const root = process.env.STUB245_ROOT;',
  'const RealDate = Date;',
  'global.Date = class extends RealDate {',
  '  constructor(...a) { super(...(a.length ? a : [0])); }',
  '  static now() { return 0; }',
  '};',
  'const forbidden = (name) => { fs.appendFileSync(process.env.STUB245_TRACE, name + "\\n"); throw new Error("offline fixture refused model access"); };',
  'global.fetch = () => forbidden("fetch");',
  'for (const name of ["node:http", "node:https"]) {',
  '  const mod = require(name); mod.request = () => forbidden(name); mod.get = mod.request;',
  '}',
  'require("node:net").Socket.prototype.connect = () => forbidden("socket");',
  'const cp = require("node:child_process");',
  'for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {',
  '  const real = cp[name];',
  '  cp[name] = function(file, ...args) {',
  '    if (require("node:path").basename(String(file)) !== "git") return forbidden("process " + file);',
  '    return real.call(this, file, ...args);',
  '  };',
  '}',
  'const provider = require(root + "/lib/provider");',
  'const realComplete = provider.complete;',
  'const { stubComplete } = require(root + "/lib/stub");',
  'const { normalizeUsage } = require(root + "/lib/usage");',
  '// The stub answers under DRIFTPROOF_STUB=1; otherwise an offline model double does.',
  'provider.complete = async (a) => {',
  '  if (process.env.DRIFTPROOF_STUB === "1") return realComplete(a);',
  '  const s = stubComplete(a);',
  '  return { ...s, usage: normalizeUsage(s.usage), wall_ms: s.usage.wall_ms,',
  '    attempts: 1, answeredBy: "model", surface: "api", isolation: "none",',
  '    reportedModels: [provider.resolveModel(a.model)], stopReason: "end_turn" };',
  '};',
  '',
].join('\n'));

function env(root, trace, stub) {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^NODE_OPTIONS$|^SOURCE_DATE_EPOCH$|^STUB245_/.test(k)) continue;
    out[k] = v;
  }
  return { ...out, TMPDIR: '/var/tmp', NODE_NO_WARNINGS: '1', CLAUDE_PROVIDER: 'api', OPENAI_SURFACE: 'api',
    ...(stub ? { DRIFTPROOF_STUB: '1' } : {}),
    NODE_OPTIONS: '--require ' + preload, STUB245_ROOT: root, STUB245_TRACE: trace };
}
let next = 0;
function cli(root, work, args, stub) {
  const trace = path.join(harness, 'trace-' + (++next) + '.txt');
  const r = spawnSync(process.execPath, [path.join(root, 'bin/driftproof'), ...args], {
    cwd: work, env: env(root, trace, stub), encoding: 'utf8', timeout: 1800000, maxBuffer: 32 << 20,
  });
  assert.ifError(r.error);
  assert.equal(fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '', '', 'no model process or network attempt');
  return r;
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
const isReceiptFile = (f) => /[0-9a-f]{12}\.json$/.test(f);
function fixture() {
  const work = tmp();
  fs.mkdirSync(path.join(work, 'skill/evals'), { recursive: true });
  fs.writeFileSync(path.join(work, 'skill/SKILL.md'), '---\nname: stub245\nversion: 1.0.0\n---\n\n# Fixture\n\nAnswer in one sentence.\n');
  const cases = [{ id: 'c1', prompt: 'Name a primary colour.', rubric: 'One primary colour.', pass_threshold: 0.7 },
    { id: 'c2', prompt: 'Name a planet.', rubric: 'One planet.', pass_threshold: 0.7 }];
  fs.writeFileSync(path.join(work, 'skill/evals/evals.json'), JSON.stringify({ cases }));
  fs.writeFileSync(path.join(work, 'revised.json'), JSON.stringify({ cases: cases.map((c) => ({ ...c, rubric: 'Only ' + c.rubric.toLowerCase() })) }));
  return work;
}

// Every door that writes a summary. The origin is the run; a regrade names its judge.
const SCENARIOS = {
  'stub-run': { origin: 'stub' },
  'stub-quick': { origin: 'stub', quick: true },
  'stub-multiple-model': { origin: 'stub', models: 'haiku,sonnet' },
  'stub-judge-of-stub-answers': { origin: 'stub', regrade: 'stub' },
  'stub-judge-of-model-answers': { origin: 'model', regrade: 'stub' },
  'model-judge-of-stub-answers': { origin: 'stub', regrade: 'model' },
  'model-run': { origin: 'model' },
  'model-quick': { origin: 'model', quick: true },
  'model-multiple-model': { origin: 'model', models: 'haiku,sonnet' },
  'model-judge-of-model-answers': { origin: 'model', regrade: 'model' },
  'model-rubric-of-model-answers': { origin: 'model', regrade: 'rubric' },
  // Review item 2: a stub rubric regrade. Spec 236 AC-4: it refuses before any artefact, as the Base does.
  'stub-rubric-of-model-answers': { origin: 'model', regrade: 'stub-rubric', refuses: true },
  'stub-rubric-of-stub-answers': { origin: 'stub', regrade: 'stub-rubric', refuses: true },
};
const cache = new Map();
function scenario(root, name) {
  const key = root + ':' + name;
  if (cache.has(key)) return cache.get(key);
  const s = SCENARIOS[name];
  const rubric = s.regrade === 'rubric' || s.regrade === 'stub-rubric';
  const work = fixture();
  const args = ['run', 'skill', '--models', s.models || 'haiku', ...(s.quick ? ['--quick'] : ['--samples', '2']), '--trusted-skill', '--keep-transcripts', '--out', 'receipts'];
  let r = cli(root, work, args, s.origin === 'stub');
  assert.equal(r.status, 0, name + ': ' + r.stderr);
  let original = null;
  if (s.regrade) {
    const file = fs.readdirSync(path.join(work, 'receipts')).find(isReceiptFile);
    original = { file, receipt: JSON.parse(fs.readFileSync(path.join(work, 'receipts', file), 'utf8')) };
    const rg = ['regrade', path.join('receipts', file), '--skill', 'skill',
      '--answers', path.join('transcripts', original.receipt.receipt_hash, 'answers.json'), '--trusted-skill', '--out', 'regraded',
      ...(rubric ? ['--rubric', 'revised.json'] : ['--judge-model', 'haiku'])];
    r = cli(root, work, rg, s.regrade === 'stub' || s.regrade === 'stub-rubric');
    if (s.refuses) {
      const data = { work, artefacts: written(work), summaries: [], regrade: { status: r.status, stderr: r.stderr } };
      cache.set(key, data);
      return data;
    }
    assert.equal(r.status, 0, name + ': ' + r.stderr);
  }
  const artefacts = written(work);
  const dir = s.regrade ? 'regraded/' : 'receipts/';
  const summaries = Object.keys(artefacts).filter((f) => f.startsWith(dir) && isReceiptFile(f)).sort().map((f) => {
    const receipt = JSON.parse(artefacts[f]);
    const md = f.replace(/\.json$/, '.summary.md');
    assert.ok(md in artefacts, 'a summary beside ' + f);
    const opts = original ? { regradeOf: { receipt_hash: original.receipt.receipt_hash, file: original.file,
      date_utc: original.receipt.run.date_utc, kind: rubric ? 'rubric' : 'judge', judge: receipt.run.judge.model_id } } : {};
    return { file: f, receipt, text: artefacts[md], opts };
  });
  assert.ok(summaries.length > 0, name + ' wrote a receipt');
  const data = { work, artefacts, summaries };
  cache.set(key, data);
  return data;
}

// ── readers ─────────────────────────────────────────────────────────────────
const PREFIX = '> **STUB RUN (DRIFTPROOF_STUB=1):**';
const DONE = 'Stub receipt measures nothing.';
const NONE_SHOWN = 'No lift, score, band or case result is shown.';
const stubAnswered = (r) => ((r.run.answered_by || {}).kind === 'stub') || r.run.surface === 'stub';
const stubJudged = (r) => (r.run.judge || {}).surface === 'stub';
const isStub = (r) => stubAnswered(r) || stubJudged(r);
const count = (text, s) => text.split(s).length - 1;
// AC-8: a string a user chose is one code span; every reader reads the prose outside code spans.
const prose = (md) => md.replace(/`[^`\n]*`/g, '`c`');
function qualification(md) {
  const lines = md.split('\n');
  assert.match(lines[0], /^# /, 'the title comes first');
  return lines.slice(1).find((l) => l.trim()) || '';
}
function first(md) {
  const q = qualification(md);
  assert.ok(q.startsWith(PREFIX), 'the qualification is the first line after the title: ' + q);
  assert.match(q, /\bUNVERIFIED\b/, 'the qualification names UNVERIFIED');
  assert.ok(q.trimEnd().endsWith(DONE), 'the qualification ends with the completion sentence');
  assert.equal(count(prose(md), DONE), 1, 'the completion sentence appears once');
}
function unqualified(md) {
  assert.equal(md.includes('STUB RUN'), false, 'no stub qualification on an ordinary receipt');
  assert.equal(md.includes(DONE), false, 'no stub completion sentence on an ordinary receipt');
}
const STUB_ANSWERED_LINE = '- **answered by: the stub (DRIFTPROOF_STUB) wrote every answer; no model answered**';
const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function attribution(md, receipt, opts = {}) {
  const text = prose(md);
  const q = qualification(text);
  const lines = text.split('\n');
  const line = (head) => lines.find((l) => l.startsWith(head)) || '';
  assert.doesNotMatch(text, /nothing answered/i, 'no stub summary says nothing answered');
  if (stubAnswered(receipt)) {
    assert.match(q, /\bstub wrote every answer\b/i, 'says the stub wrote the answers');
    assert.equal(line('- **answered by:'), STUB_ANSWERED_LINE, 'the answered-by line says the stub wrote the answers');
    assert.doesNotMatch(text, /\ba model wrote\b/i, 'no model wrote stub answers');
  } else {
    assert.match(line('- **answered by:'), /^- \*\*answered by: model\b/, 'keeps the answered by: model line');
    assert.match(q, /\ba model wrote the saved answers\b/i, 'says a model wrote the answers');
    assert.doesNotMatch(text, /\bstub wrote\b|\bcanned\b/i, 'no stub-answer claim on model answers');
  }
  const rg = line('- **regrade:**');
  const kind = (opts.regradeOf || {}).kind;
  const judge = escape((opts.regradeOf || {}).judge);
  if (stubJudged(receipt)) {
    assert.match(q, /\bstub graded\b|\bevery grade\b/i, 'says the stub graded');
    assert.match(q, /\bno model graded\b|\bno model was called\b/i, 'says no model graded');
    assert.match(line('- **judge:**'), /^- \*\*judge:\*\* the stub \(DRIFTPROOF_STUB\), /, 'the judge line names the stub');
    for (const l of lines) {
      if (/\bgraded\b[^\n]*\bby the judge\b|\bjudge\b[^\n]*\bgraded\b/i.test(l)) assert.match(l, /\bstub\b/i, 'a model is said to have graded: ' + l);
    }
    if (receipt.run.regraded_from || kind) assert.match(rg, /\bstub\b/, 'the regrade line names the stub: ' + rg);
    if (kind === 'rubric') assert.match(rg, /, graded again by the stub under a revised rubric; /, 'the rubric regrade line: ' + rg);
    if (kind === 'judge') assert.match(rg, new RegExp(', graded again by the stub, not by the judge ' + judge + ' it was asked for; '), 'the judge regrade line: ' + rg);
  } else {
    assert.match(q, /\ba model graded\b/i, 'says a model graded');
    assert.doesNotMatch(line('- **judge:**'), /\bstub\b/i, 'the judge line names no stub on a receipt a model graded');
    if (kind === 'rubric') assert.match(rg, /, graded again under a revised rubric; /, 'the rubric regrade line: ' + rg);
    if (kind === 'judge') assert.match(rg, new RegExp(', graded again by the judge ' + judge + '; '), 'the judge regrade line: ' + rg);
  }
}
const RESULT_RES = [
  /\blift\b[^\n]*\d/i, /\bskill lift\b/i, /±/, /\bband rule\b/i, /^\s*\|/m, /^## Per-case/m,
  /\b(?:with_skill|baseline)\b[^\n]*\d/i, /\b(?:score|mean)\b[^\n]*\d/i,
  /\b(?:with(?: the skill)?|without(?: the skill)?|base(?:line)?)\s*[:=(]?\s*[+-]?\d+\.\d/i,
  /\b(?:pass|passed|passing|fail|failed|borderline|regressed|no effect|failed_unmeasured|failed_timeout)\b/i,
  /\b(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE|NOT MEASURED)\b/, /⚠/, /\boutcome\b/i,
];
// AC-4 (review item 1): every line of a stub summary, read as prose, is one of these shapes. A digit
// sits only where a shape places one: a date, a count of samples or cases, a temperature, a version.
const DATE = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z';
const JUDGE_ID = '[a-z][\\w.:/@-]*';
const SHAPES = [
  /^$/,
  /^# `c` receipt summary$/,
  /^> \*\*STUB RUN \(DRIFTPROOF_STUB=1\):\*\* [a-z][a-z ,;]*\. This receipt is UNVERIFIED\. Stub receipt measures nothing\.$/,
  /^- \*\*model:\*\* `c`(?: \(released \d{4}-\d{2}-\d{2}\))?$/,
  /^- \*\*surface:\*\* [a-z][a-z-]*$/,
  /^- \*\*answered by: (?:[^\d*]+|unrecorded \(pre-v0\.6 receipt\))\*\*$/,
  /^- \*\*answer capture: (?:[^\d*]+|unrecorded \(a receipt from before v0\.10\))\*\*$/,
  new RegExp('^- \\*\\*regrade:\\*\\* a regrade of the saved answers of receipt `c` \\(`c`, run ' + DATE + '\\), graded again (?:by the stub, not by the judge ' + JUDGE_ID + ' it was asked for|by the stub under a revised rubric|by the judge ' + JUDGE_ID + '|under a revised rubric); no answer was generated$'),
  new RegExp('^- \\*\\*graded \\(UTC\\):\\*\\* ' + DATE + '(?: \\(a regrade of answers generated earlier; no answer was generated\\))?$'),
  new RegExp('^- \\*\\*run \\(UTC\\):\\*\\* ' + DATE + '$'),
  /^- \*\*runner:\*\* v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/,
  /^- \*\*judge:\*\* the stub \(DRIFTPROOF_STUB\), (?:\d+|unknown) samples\/case; no model graded$/,
  /^- \*\*judge:\*\* (?:\d+|unknown) samples\/case, temperature (?:\d+(?:\.\d+)?|n\/a) \(`c`\)$/,
  /^- \*\*registry:\*\* [a-z][a-z-]* {3}\*\*transcripts:\*\* [a-z][a-z-]*$/,
  /^- \*\*skill content_hash:\*\* `c`$/,
  /^- \*\*suite:\*\* \d+ cases \(`c`\)$/,
  /^- \*\*verification:\*\* UNVERIFIED$/,
  /^- \*\*receipt_hash:\*\* `c`$/,
  /^## Headline$/,
  new RegExp('^' + escape(NONE_SHOWN) + '$'),
];
function noResults(md) {
  const text = prose(md);
  for (const l of text.split('\n')) assert.ok(SHAPES.some((re) => re.test(l)), 'a line outside the stub summary allow-list: ' + l);
  for (const re of RESULT_RES) assert.doesNotMatch(text, re, 'a result shown in a stub summary');
  assert.equal(count(text, NONE_SHOWN), 1, 'states once that no result is shown');
}
let lexicon = [];
test.before(async () => {
  const { LEXICON } = await import('../specs/031-artefact-claims/probes/bands.mjs');
  lexicon = LEXICON;
});
function wording(md) {
  const text = prose(md).replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /\bconfiden(ce|t)\b|\bstatistically\b|\bsignifican(t|ce)\b/i, 'spec 035 confidence wording');
  for (const { cls, re } of lexicon) assert.equal(re.test(text), false, 'spec 031 lexicon: ' + cls);
  // A-245-9 (issue 378): the em dash is no longer read.
}
function stubReader(md, receipt, opts = {}) { first(md); attribution(md, receipt, opts); noResults(md); wording(md); }

// ── AC-1 to AC-5: every stub door, every summary written ────────────────────
const REFUSING = Object.keys(SCENARIOS).filter((n) => SCENARIOS[n].refuses);
const STUB_NAMES = Object.keys(SCENARIOS).filter((n) => !SCENARIOS[n].refuses && (SCENARIOS[n].origin === 'stub' || SCENARIOS[n].regrade === 'stub'));
const MODEL_NAMES = Object.keys(SCENARIOS).filter((n) => !SCENARIOS[n].refuses && !STUB_NAMES.includes(n));
for (const name of STUB_NAMES) {
  test('AC-1 to AC-5 written stub summary: ' + name, () => {
    for (const s of scenario(ROOT, name).summaries) {
      assert.equal(isStub(s.receipt), true, s.file + ' is a stub receipt');
      stubReader(s.text, s.receipt, s.opts);
    }
  });
  test('AC-1 rendered from the sealed receipt with the switch unset: ' + name, () => {
    for (const s of scenario(ROOT, name).summaries) {
      assert.equal(process.env.DRIFTPROOF_STUB, undefined);
      const md = candidate(s.receipt, s.opts);
      assert.equal(md, s.text, 'the written summary is the renderer\'s');
      stubReader(md, s.receipt, s.opts);
    }
  });
  test('AC-3 rendered again as a judge regrade and as a rubric regrade: ' + name, () => {
    for (const s of scenario(ROOT, name).summaries) {
      for (const kind of ['judge', 'rubric']) {
        const opts = { regradeOf: { receipt_hash: s.receipt.receipt_hash, file: 'original.json', date_utc: s.receipt.run.date_utc, kind, judge: s.receipt.run.judge.model_id } };
        stubReader(candidate(s.receipt, opts), s.receipt, opts);
      }
    }
  });
  test('plant: the Base renderer reads RED: ' + name, () => {
    for (const s of scenario(ROOT, name).summaries) assert.throws(() => stubReader(baseline(s.receipt, s.opts), s.receipt, s.opts));
  });
}
for (const name of REFUSING) {
  test('AC-1 a stub rubric regrade refuses with exit 2 and writes no receipt or summary, as the Base does: ' + name, () => {
    for (const root of [ROOT, baseRoot]) {
      const a = scenario(root, name);
      assert.equal(a.regrade.status, 2, a.regrade.stderr);
      assert.deepEqual(Object.keys(a.artefacts).filter((f) => f.startsWith('regraded/')), []);
    }
  });
}

// Review item 8: the predicate plants are renderers, run through the real readers. The qualification
// goes after the title, the first line, and nowhere else (issue 335: cut at that line's end, not by a
// string replace that reads as one meant for every newline).
const qualify = (md) => {
  const end = md.indexOf('\n');
  if (end < 0) return md;
  return `${md.slice(0, end)}\n\n${PREFIX} x. UNVERIFIED. ${DONE}\n${md.slice(end + 1)}`;
};
const byAnswers = (r, o) => (((r.run.answered_by || {}).kind === 'stub') ? candidate(r, o) : baseline(r, o));
const byEnvironment = (r, o) => (process.env.DRIFTPROOF_STUB === '1' ? qualify(baseline(r, o)) : baseline(r, o));
test('plant: a renderer whose predicate is answered_by alone reads RED on the stub judge of model answers', () => {
  for (const s of scenario(ROOT, 'stub-judge-of-model-answers').summaries) assert.throws(() => stubReader(byAnswers(s.receipt, s.opts), s.receipt, s.opts));
});
test('plant: a renderer whose predicate is the environment reads RED, switch unset on stub receipts and set on an ordinary one', () => {
  for (const name of STUB_NAMES) for (const s of scenario(ROOT, name).summaries) assert.throws(() => stubReader(byEnvironment(s.receipt, s.opts), s.receipt, s.opts));
  const s = scenario(ROOT, 'model-run').summaries[0];
  process.env.DRIFTPROOF_STUB = '1';
  try { assert.throws(() => ordinary(s.receipt, s.opts, byEnvironment)); } finally { delete process.env.DRIFTPROOF_STUB; }
});

// ── AC-8: a string a user chose cannot speak ────────────────────────────────
const NAMES = ['pass-rate', 'lift-2 PASSED', 'a`b\nlift +0.9 PASSED'];
const FILES = ['lift +0.9 PASSED.json', 'x`y\n- lift +0.9 PASSED.json'];
test('AC-8 a skill name and a file name a user chose stay one code span on one line, and every reader passes', () => {
  for (const name of STUB_NAMES) for (const s of scenario(ROOT, name).summaries) {
    const lines = candidate(s.receipt, s.opts).split('\n').length;
    for (const skill of NAMES) for (const file of (s.opts.regradeOf ? FILES : [null])) {
      const r = structuredClone(s.receipt);
      r.skill.name = skill;
      const o = file ? { regradeOf: { ...s.opts.regradeOf, file } } : s.opts;
      const md = candidate(r, o);
      stubReader(md, r, o);
      assert.equal(md.split('\n').length, lines, 'one line each');
    }
  }
});

// ── AC-6: ordinary summaries are the Base's, byte for byte ──────────────────
function archive() {
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.json')) continue;
      let r; try { r = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      if (!r || typeof r.schema_version !== 'string' || !r.results || !Array.isArray(r.results.cases)) continue;
      found.push({ file: path.relative(ROOT, p), receipt: r });
    }
  })(path.join(ROOT, 'receipts'));
  return found.sort((a, b) => a.file.localeCompare(b.file));
}
function ordinary(receipt, opts, render = candidate) {
  const md = render(receipt, opts);
  assert.equal(md, baseline(receipt, opts), 'an ordinary summary moved');
  unqualified(md);
  return md;
}
test('AC-6 every tracked receipt renders as the Base renders it, plain and as a regrade, switch unset and set', () => {
  const all = archive();
  assert.ok(all.length > 0);
  for (const { file, receipt } of all) {
    assert.equal(isStub(receipt), false, file + ' is not a stub receipt');
    const regradeOf = { receipt_hash: receipt.receipt_hash, file: path.basename(file), date_utc: receipt.run.date_utc, kind: 'judge', judge: (receipt.run.judge || {}).model_id };
    for (const opts of [{}, { regradeOf }]) {
      ordinary(receipt, opts);
      process.env.DRIFTPROOF_STUB = '1';
      try { ordinary(receipt, opts); } finally { delete process.env.DRIFTPROOF_STUB; }
    }
  }
});
for (const name of MODEL_NAMES) {
  test('AC-6 written ordinary summary is the Base renderer\'s: ' + name, () => {
    for (const s of scenario(ROOT, name).summaries) {
      assert.equal(isStub(s.receipt), false);
      assert.equal(ordinary(s.receipt, s.opts), s.text);
    }
  });
}
// Review item 8: each plant is a renderer, run through the same reader over a written ordinary receipt.
test('plants: a renderer that changes one line or qualifies an ordinary receipt reads RED', () => {
  const s = scenario(ROOT, 'model-run').summaries[0];
  const changed = (r, o) => candidate(r, o).replace('\n## Headline', '\nChanged\n\n## Headline');
  const qualified = (r, o) => qualify(candidate(r, o));
  for (const render of [changed, qualified]) {
    assert.notEqual(render(s.receipt, s.opts), candidate(s.receipt, s.opts), 'the plant changes the rendering');
    assert.throws(() => ordinary(s.receipt, s.opts, render));
  }
});

// ── readers hold their plants ───────────────────────────────────────────────
// Clean subjects written to the claim: each plant must read RED on them.
const CLEAN = {
  receipt: { run: { answered_by: { kind: 'model' }, surface: 'api', judge: { surface: 'stub' }, regraded_from: {} } },
  opts: { regradeOf: { kind: 'judge', judge: 'claude-haiku-4-5' } },
  text: [
    '# `s` receipt summary', '',
    PREFIX + ' a model wrote the saved answers and the stub gave every grade; no model graded them. This receipt is UNVERIFIED. ' + DONE, '',
    '- **model:** `claude-haiku-4-5`', '- **surface:** api', '- **answered by: model `claude-haiku-4-5` (attested by the surface; no spawn (api surface))**',
    '- **regrade:** a regrade of the saved answers of receipt `0123456789abcdef…` (`x.json`, run 1970-01-01T00:00:00.000Z), graded again by the stub, not by the judge claude-haiku-4-5 it was asked for; no answer was generated',
    '- **graded (UTC):** 1970-01-01T00:00:00.000Z', '- **judge:** the stub (DRIFTPROOF_STUB), 2 samples/case; no model graded',
    '- **suite:** 2 cases (`agentskills.io/evals`)', '- **verification:** UNVERIFIED', '', '## Headline', '', NONE_SHOWN, '',
  ].join('\n'),
};
const CLEAN_STUB = {
  receipt: { run: { answered_by: { kind: 'stub' }, surface: 'stub', judge: { surface: 'stub' } } },
  text: [
    '# `s` receipt summary', '',
    PREFIX + ' the stub wrote every answer and gave every grade; no model was called. This receipt is UNVERIFIED. ' + DONE, '',
    '- **model:** `claude-haiku-4-5`', '- **surface:** stub', STUB_ANSWERED_LINE, '- **run (UTC):** 1970-01-01T00:00:00.000Z',
    '- **judge:** the stub (DRIFTPROOF_STUB), 2 samples/case; no model graded', '- **verification:** UNVERIFIED', '', '## Headline', '', NONE_SHOWN, '',
  ].join('\n'),
};
test('plants: the first-line reader', () => {
  first(CLEAN.text);
  const lines = CLEAN.text.split('\n');
  const q = lines[2];
  for (const bad of [
    CLEAN.text.replace(q + '\n', '') + q + '\n',
    CLEAN.text.replace(DONE, ''),
    CLEAN.text + DONE + '\n',
    CLEAN.text.replace('This receipt is UNVERIFIED. ', ''),
    CLEAN.text.replace('\n\n' + PREFIX, '\n\n## Headline\n\n' + PREFIX),
  ]) assert.throws(() => first(bad));
});
test('plants: the attribution reader', () => {
  attribution(CLEAN.text, CLEAN.receipt, CLEAN.opts);
  attribution(CLEAN_STUB.text, CLEAN_STUB.receipt);
  for (const bad of [
    CLEAN.text + 'nothing answered\n',
    CLEAN.text.replace('graded again by the stub, not by the judge', 'graded again by the judge'),
    CLEAN.text + 'Note: the stub wrote every answer.\n',
    CLEAN.text.replace('no model graded them', 'a model graded them'),
    // Review item 5: the Base judge line on a stub-judged receipt.
    CLEAN.text.replace('- **judge:** the stub (DRIFTPROOF_STUB), 2 samples/case; no model graded', '- **judge:** 2 samples/case, temperature 0 (api-temperature-0)'),
  ]) assert.throws(() => attribution(bad, CLEAN.receipt, CLEAN.opts));
  assert.throws(() => attribution(CLEAN.text, CLEAN_STUB.receipt), 'a model-answered qualification on a stub-answered receipt');
  // Review item 2: the judge regrade wording read as a rubric regrade.
  assert.throws(() => attribution(CLEAN.text, CLEAN.receipt, { regradeOf: { kind: 'rubric' } }));
  // Review item 4: the Base answered-by line beside "the stub wrote every answer".
  assert.throws(() => attribution(CLEAN_STUB.text.replace(STUB_ANSWERED_LINE, '- **answered by: stub (DRIFTPROOF_STUB) — nothing answered; this run measured nothing (UNVERIFIED)**'), CLEAN_STUB.receipt));
});
test('plants: the no-results reader', () => {
  noResults(CLEAN.text);
  noResults(CLEAN_STUB.text);
  for (const text of [
    'skill lift **+0.430** (combined uncertainty ± 0.120)\n', 'with_skill **0.850 ± n/a (1 case)** vs baseline **0.420 ± n/a (1 case)**\n',
    '| `c1` | with_skill | pass | 0.850 ± 0.000 | ok |\n', 'Case c1: PASS; score 0.85; lift +0.43\n', 'outcome borderline\n',
    "band rule: each arm's band is the sample stddev of its per-case means\n", 'Verdict: UNDERPOWERED\n', '## Per-case (mean ± stddev over 2 judge samples)\n',
    // Review item 1: bare numbers with no keyword beside them.
    'with the skill **0.850** vs without **0.420**\n', '+0.430 (2 of 2 cases)\n',
    // Review item 6: the banners that qualify numbers no longer printed.
    '> **SMOKE RUN** (--quick): A smoke run cannot produce a verdict. This receipt is UNVERIFIED and records run.preset "quick"; its numbers show the run worked, not whether the skill helps.\n',
    '> ⏱ **INCOMPLETE** — 1 case(s) had an arm that could not be measured and are EXCLUDED from the aggregates below, BOTH arms together; this receipt must not be used to compute a drift/durability verdict.\n',
    '> ✂ **2 draw(s) truncated** at the output cap: each is unmeasured and excluded from every band below.\n',
  ]) assert.throws(() => noResults(CLEAN.text + text));
  // Review item 1: a number in a header line.
  assert.throws(() => noResults(CLEAN.text.replace('- **surface:** api', '- **surface:** api 0.850 vs 0.420')));
  assert.throws(() => noResults(CLEAN.text.replace(NONE_SHOWN, '')));
});
test('plants: the wording reader', () => {
  wording(CLEAN.text);
  // Issue 301: the lexicon plant is built from the declared literal (spec 031 AC-4).
  // A-245-9 (issue 378): the three em dash plants are retired with the em dash reading.
  for (const bad of [CLEAN.text + `The change is ${WITHIN_NOISE}.\n`, CLEAN.text + '95% confidence the skill helps.\n']) assert.throws(() => wording(bad));
});
test('plants: a bare file name and a line break let through read RED (AC-8)', () => {
  stubReader(CLEAN.text, CLEAN.receipt, CLEAN.opts);
  for (const bad of [
    CLEAN.text.replace('(`x.json`,', '(lift +0.9 PASSED.json,'),
    CLEAN.text.replace('(`x.json`,', '(`x`y\n- lift +0.9 PASSED.json`,'),
  ]) assert.throws(() => stubReader(bad, CLEAN.receipt, CLEAN.opts));
});

// ── AC-7: the sealed artefacts hold, and the revision move is recorded ──────
function normalized(data) {
  const labels = new Map();
  for (const [f, bytes] of Object.entries(data.artefacts)) {
    if (!isReceiptFile(f)) continue;
    const r = JSON.parse(bytes);
    labels.set(r.receipt_hash, f.split('/')[0] + ':' + r.run.model_id + ':' + (r.run.regraded_from ? 'regrade' : 'run'));
    labels.set(r.run.judge.code_revision, 'REVISION');
  }
  const swap = (s) => {
    for (const [h, label] of labels) {
      if (label === 'REVISION') { s = s.split(h).join('<REVISION>'); continue; }
      for (const n of [64, 16, 12]) s = s.split(h.slice(0, n)).join('<' + label + '>');
    }
    return s;
  };
  // A transcript file holds the receipt hash, so its own sha256 (which a regrade sidecar records)
  // moves with the revision. It is labelled by its normalized path: a sidecar naming another file reads RED.
  for (const [f, bytes] of Object.entries(data.artefacts)) {
    if (f.startsWith('transcripts/')) labels.set(crypto.createHash('sha256').update(bytes).digest('hex'), 'sha256 of ' + swap(f));
  }
  const out = {};
  for (const [f, bytes] of Object.entries(data.artefacts)) {
    if (f.endsWith('.summary.md')) continue;
    out[swap(f)] = swap(bytes);
  }
  return out;
}
// A-245-2 (issue 265): receipt v0.13 moves every receipt's schema_version from the Base's 0.12 to 0.13. A
// candidate receipt must carry 0.13 once, as its schema_version line; that one line is read back as 0.12, and
// every other byte is compared as before. Any other value, or the line twice, reads RED.
const SCHEMA_265 = { from: '0.12', to: '0.13' };
const schemaLine = (v) => `{\n  "schema_version": "${v}",\n`;
// A-245-10 (issue 438): receipt v0.15 moves every receipt's schema_version from 0.13 to 0.15 and adds two
// lines, skill.unit and run.delivery. A candidate receipt must carry 0.15 once, as its schema_version line,
// and each of the two lines once, at a skill run's values; the version is read back as 0.13 and the two
// lines are taken out, and every other byte is compared as before. Any other value, a line missing or a
// line twice, reads RED. Issue 265's reading then runs on the result, as before.
const SCHEMA_438 = { from: '0.13', to: '0.15' };
const SUBJECT_438 = ['    "unit": "skill",\n', '    "delivery": "injected",\n'];
function atSubjectSchema(data) {
  const artefacts = {};
  for (const [f, bytes] of Object.entries(data.artefacts)) {
    if (!isReceiptFile(f)) { artefacts[f] = bytes; continue; }
    assert.ok(bytes.startsWith(schemaLine(SCHEMA_438.to)), 'the receipt carries schema_version ' + SCHEMA_438.to + ': ' + f);
    let out = schemaLine(SCHEMA_438.from) + bytes.slice(schemaLine(SCHEMA_438.to).length);
    for (const line of SUBJECT_438) {
      assert.equal(out.split(line).length, 2, 'the receipt carries ' + line.trim() + ' once: ' + f);
      out = out.replace(line, '');
    }
    artefacts[f] = out;
  }
  return { ...data, artefacts };
}
function atBaseSchema(given) {
  const data = atSubjectSchema(given);
  const artefacts = {};
  for (const [f, bytes] of Object.entries(data.artefacts)) {
    if (!isReceiptFile(f)) { artefacts[f] = bytes; continue; }
    assert.ok(bytes.startsWith(schemaLine(SCHEMA_265.to)), 'the receipt carries schema_version ' + SCHEMA_265.to + ': ' + f);
    assert.equal(bytes.split('"schema_version"').length, 2, 'the receipt carries one schema_version: ' + f);
    artefacts[f] = schemaLine(SCHEMA_265.from) + bytes.slice(schemaLine(SCHEMA_265.to).length);
  }
  return { ...data, artefacts };
}
// A-245-3 (issue 317): spec 317 makes every receipt's economics.judge_overhead count every judged draw,
// with two counts and a longer note, where the Base tree counted one draw per case row. A candidate
// receipt must carry the block once, equal to spec 317's reading of its own draws (its reading.js, never
// lib/value.js) and with both counts; that block is read back as the one the Base tree's lib/value.js
// computes over the same rows, and every other byte is compared as before.
const reading317 = require(path.join(ROOT, 'specs/317-judge-cost-draws/reading.js'));
const JUDGE_BLOCK = /( *)"judge_overhead": (\{[^{}]*\})/g;
function atBaseJudge(data) {
  const baseValue = require(path.join(baseRoot, 'lib/value.js'));
  const artefacts = {};
  for (const [f, bytes] of Object.entries(data.artefacts)) {
    if (!isReceiptFile(f)) { artefacts[f] = bytes; continue; }
    const r = JSON.parse(bytes);
    const blocks = [...bytes.matchAll(JUDGE_BLOCK)];
    assert.equal(blocks.length, 1, 'the receipt carries one judge_overhead: ' + f);
    const [whole, indent, text] = blocks[0];
    const got = JSON.parse(text);
    const id = r.run.judge.model_id;
    const want = reading317.expected(r.results.cases, reading317.priceOf(r, id), reading317.captureOf(r));
    assert.deepEqual(reading317.differences(got, want), [], 'the judge overhead is spec 317\'s reading of the receipt\'s draws: ' + f);
    assert.ok(Number.isInteger(got.judged_draws_counted) && Number.isInteger(got.judged_draws_missing_usage), 'the receipt records both counts: ' + f);
    const was = baseValue.computeEconomics({ cases: r.results.cases, modelId: r.run.model_id, judgeModelId: id, pricingSnapshot: r.run.pricing_snapshot, surface: r.run.surface, meteredSurface: false }).judge_overhead;
    artefacts[f] = bytes.replace(whole, `${indent}"judge_overhead": ${JSON.stringify(was, null, 2).split('\n').join('\n' + indent)}`);
  }
  return { ...data, artefacts };
}
// A-245-5 (issue 343): a release writes its version into config.js's RUNNER_VERSION and package.json's
// version, and every receipt records the tool version as runner_version. A tree's version is the one both
// files carry; they must agree. A candidate artefact must record its tree's version at every runner_version,
// each is read back as the Base tree's, and every other byte is compared as before. Any other value reads RED.
// A-245-8 (issue 382): the tree's version and the setting aside are the shared normaliser's, treeVersion and
// setAside in scripts/build-report-baselines.mjs; this reader keeps its own check of each runner_version.
const { treeVersion, setAside, README_VERSION } = require(path.join(ROOT, 'scripts', 'build-report-baselines.mjs'));
function versionOf(root) {
  return treeVersion((rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null));
}
const RUNNER_FIELD = /("runner_version":\s*)"([^"]*)"/g;
function atBaseRelease(data, root = ROOT, base = baseRoot) {
  const from = versionOf(base), to = versionOf(root);
  const artefacts = {};
  for (const [f, bytes] of Object.entries(data.artefacts)) {
    for (const [, , value] of bytes.matchAll(RUNNER_FIELD)) assert.equal(value, to, 'the artefact records its tree\'s version ' + to + ': ' + f);
    artefacts[f] = setAside(bytes, to).split(README_VERSION).join(from);
  }
  return { ...data, artefacts };
}
test('plants: a release bump reads GREEN, any other version or byte beside it RED (A-245-5)', async () => {
  // The bumped tree: this tree's CLI, library, config and schemas, with release-prepare's own edit, its
  // anchors for config.js and package.json applied by its applyAnchors, to 9.9.9 (A-245-8, issue 382).
  const { BUMP_ANCHORS, applyAnchors } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'scripts/pipeline.mjs')).href);
  const bumped = path.join(harness, 'bumped');
  if (!fs.existsSync(bumped)) {
    for (const p of ['bin', 'lib', 'config.js', 'config', 'spec', 'package.json']) fs.cpSync(path.join(ROOT, p), path.join(bumped, p), { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(bumped, 'node_modules'));
  }
  const from = versionOf(ROOT);
  const next = '9.9.9';
  const files = ['config.js', 'package.json'];
  const anchors = BUMP_ANCHORS.filter((a) => files.includes(a.file));
  assert.deepEqual([...new Set(anchors.map((a) => a.file))].sort(), files, 'release-prepare bumps config.js and package.json');
  const { out, problems } = applyAnchors(new Map(files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])), anchors, from, next);
  assert.deepEqual(problems, []);
  for (const [f, text] of out) fs.writeFileSync(path.join(bumped, f), text);
  assert.equal(versionOf(bumped), next);
  for (const name of ['stub-run', 'stub-judge-of-model-answers']) {
    const a = scenario(bumped, name), b = scenario(baseRoot, name);
    const receipts = Object.keys(a.artefacts).filter(isReceiptFile);
    assert.ok(receipts.length > 0 && receipts.every((f) => a.artefacts[f].includes(`"runner_version": "${next}"`)), 'the bumped tree records ' + next + ': ' + name);
    // GREEN: the bump is the one move, read back as the Base's version.
    assert.deepEqual(normalized(atBaseJudge(atBaseSchema(atBaseRelease(a, bumped)))), normalized(b));
    // RED: a receipt that records another version than its tree's.
    const file = receipts[0];
    for (const other of [versionOf(baseRoot), '9.9.8', next + '-rc.1']) {
      const bad = a.artefacts[file].replace(`"runner_version": "${next}"`, `"runner_version": "${other}"`);
      assert.notEqual(bad, a.artefacts[file], 'the plant changed the receipt');
      assert.throws(() => atBaseRelease({ ...a, artefacts: { ...a.artefacts, [file]: bad } }, bumped), /records its tree's version/);
    }
    // RED: one changed byte beside the bump, another version string among them.
    for (const bad of [
      a.artefacts[file].replace('"generation_sampled": true', '"generation_sampled": false'),
      a.artefacts[file].replace('"version": "1.0.0"', '"version": "1.0.1"'),
    ]) {
      assert.notEqual(bad, a.artefacts[file], 'the plant changed the receipt');
      const moved = { ...a, artefacts: { ...a.artefacts, [file]: bad } };
      assert.throws(() => assert.deepEqual(normalized(atBaseJudge(atBaseSchema(atBaseRelease(moved, bumped)))), normalized(b)));
    }
  }
  // A-245-8 (issue 382): a quick scenario of the bumped tree reads GREEN against the Issue 367 hold (A-245-7).
  const quick = Object.keys(SCENARIOS).find((n) => SCENARIOS[n].quick);
  // A-245-10 (issue 438): with issue 438's reading first, as every quick scenario takes it.
  assert.deepEqual(normalized(atSubjectSchema(atBaseRelease(scenario(bumped, quick), bumped, holdTree()))), normalized(scenario(holdTree(), quick)));
  // RED: a tree whose config.js and package.json carry two versions writes no release's version.
  const half = path.join(harness, 'half');
  fs.mkdirSync(half, { recursive: true });
  fs.writeFileSync(path.join(half, 'config.js'), out.get('config.js'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(half, 'package.json'));
  assert.throws(() => atBaseRelease(scenario(bumped, 'stub-run'), half), /carry one version/);
  fs.writeFileSync(path.join(half, 'config.js'), out.get('config.js') + `const RUNNER_VERSION = '${next}';\n`);
  fs.writeFileSync(path.join(half, 'package.json'), out.get('package.json'));
  assert.throws(() => atBaseRelease(scenario(bumped, 'stub-run'), half), /carries one RUNNER_VERSION/);
});
test('plants: the judge overhead reader rejects another figure and a block without its counts (A-245-3)', () => {
  const a = scenario(ROOT, 'stub-run');
  const file = Object.keys(a.artefacts).find(isReceiptFile);
  atBaseJudge(a);
  const r = JSON.parse(a.artefacts[file]);
  const jo = r.economics.judge_overhead;
  for (const bad of [
    a.artefacts[file].replace(`"total_cost_usd": ${jo.total_cost_usd}`, `"total_cost_usd": ${jo.total_cost_usd + 0.000002}`),
    a.artefacts[file].replace(`"judged_draws_counted": ${jo.judged_draws_counted}`, `"judged_draws_counted": ${jo.judged_draws_counted - 1}`),
    a.artefacts[file].replace(/,\n *"judged_draws_counted": \d+,\n *"judged_draws_missing_usage": \d+/, ''),
  ]) {
    assert.notEqual(bad, a.artefacts[file], 'the plant changed the receipt');
    assert.throws(() => atBaseJudge({ ...a, artefacts: { ...a.artefacts, [file]: bad } }));
  }
  // A changed byte beside the moved block still reads RED against the Base.
  const b = scenario(baseRoot, 'stub-run');
  const moved = { ...a, artefacts: { ...a.artefacts, [file]: a.artefacts[file].replace('"judge_excluded": true', '"judge_excluded": false') } };
  assert.notEqual(moved.artefacts[file], a.artefacts[file], 'the plant changed the receipt');
  assert.throws(() => assert.deepEqual(normalized(atBaseJudge(atBaseSchema(atBaseRelease(moved)))), normalized(b)));
});
test('A-245-2: the Base emits schema_version 0.12 and this tree 0.15 (A-245-10), read from each tree\'s config.js', () => {
  assert.equal(require(path.join(baseRoot, 'config.js')).RECEIPT_SCHEMA_VERSION, SCHEMA_265.from);
  assert.equal(require(path.join(ROOT, 'config.js')).RECEIPT_SCHEMA_VERSION, SCHEMA_438.to);
});
test('plants: the schema reader rejects another schema_version, a second one, and a missing or other subject line (A-245-2, A-245-10)', () => {
  const a = scenario(ROOT, 'stub-run');
  const file = Object.keys(a.artefacts).find(isReceiptFile);
  atBaseSchema(a);
  for (const bad of [
    a.artefacts[file].replace(schemaLine(SCHEMA_438.to), schemaLine(SCHEMA_265.to)),
    a.artefacts[file].replace(schemaLine(SCHEMA_438.to), schemaLine('0.14')),
    a.artefacts[file].replace('\n}', ',\n  "schema_version": "0.15"\n}'),
    a.artefacts[file].replace(SUBJECT_438[0], ''),
    a.artefacts[file].replace(SUBJECT_438[1], '    "delivery": "installed",\n'),
  ]) {
    assert.notEqual(bad, a.artefacts[file], 'the plant changed the receipt');
    assert.throws(() => atBaseSchema({ ...a, artefacts: { ...a.artefacts, [file]: bad } }));
  }
  // A changed byte beside the moved line still reads RED against the Base.
  const b = scenario(baseRoot, 'stub-run');
  const moved = { ...a, artefacts: { ...a.artefacts, [file]: a.artefacts[file].replace('"generation_sampled": true', '"generation_sampled": false') } };
  assert.throws(() => assert.deepEqual(normalized(atBaseJudge(atBaseSchema(atBaseRelease(moved)))), normalized(b)));
});
// A-245-6 (issue 367): issue 367 made --quick a first look (one case, two draws per arm, answers kept),
// so the two quick scenarios read against the tree at the Issue 367 hold, which must be this tree's
// history; every other scenario reads against the Base tree, as before. A-245-7 (issue 372): each
// runner_version is read with A-245-5's reading, back as the hold tree's version.
const HOLD_367 = /\*\*Issue 367 hold:\*\* \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
let holdRoot = null;
function holdTree() {
  if (holdRoot) return holdRoot;
  execFileSync('git', ['merge-base', '--is-ancestor', HOLD_367, 'HEAD'], { cwd: ROOT });
  holdRoot = path.join(harness, 'hold-367');
  fs.mkdirSync(holdRoot);
  const holdTar = path.join(harness, 'hold-367.tar');
  execFileSync('git', ['archive', '--format=tar', '-o', holdTar, HOLD_367, 'bin', 'lib', 'config.js', 'config', 'spec', 'package.json'], { cwd: ROOT });
  execFileSync('tar', ['-xf', holdTar, '-C', holdRoot]);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(holdRoot, 'node_modules'));
  return holdRoot;
}
for (const name of Object.keys(SCENARIOS).filter((n) => SCENARIOS[n].quick)) {
  test('AC-7 (A-245-6) quick receipts, transcripts and sidecars equal the Issue 367 hold\'s apart from the revision: ' + name, () => {
    const a = scenario(ROOT, name), h = scenario(holdTree(), name);
    // A-245-10 (issue 438): the hold writes 0.13, so only issue 438's reading runs before the comparison.
    assert.deepEqual(normalized(atSubjectSchema(atBaseRelease(a, ROOT, holdTree()))), normalized(h));
    for (const s of a.summaries) assert.equal(s.receipt.run.judge.code_revision, judgeCodeRevision(ROOT));
    // Plant: a resealed receipt byte after the hold reads RED.
    const file = a.summaries[0].file;
    const moved = { ...a, artefacts: { ...a.artefacts, [file]: a.artefacts[file].replace('"preset": "quick"', '"preset": "quick", "planted": 1') } };
    assert.throws(() => assert.deepEqual(normalized(atSubjectSchema(atBaseRelease(moved, ROOT, holdTree()))), normalized(h)));
  });
}
for (const name of Object.keys(SCENARIOS).filter((n) => !SCENARIOS[n].quick)) {
  test('AC-7 receipts, transcripts and sidecars equal the Base tree\'s apart from the revision: ' + name, () => {
    const a = scenario(ROOT, name), b = scenario(baseRoot, name);
    assert.deepEqual(normalized(atBaseJudge(atBaseSchema(atBaseRelease(a)))), normalized(b));
    for (const s of a.summaries) assert.equal(s.receipt.run.judge.code_revision, judgeCodeRevision(ROOT));
    for (const s of b.summaries) assert.equal(s.receipt.run.judge.code_revision, judgeCodeRevision(baseRoot));
  });
}
test('plants: the artefact reader rejects a resealed score, identity and judge surface', () => {
  const a = scenario(ROOT, 'stub-judge-of-model-answers');
  const file = a.summaries[0].file;
  for (const edit of [
    (r) => { r.results.cases[0].score = 0.01; },
    (r) => { r.run.answered_by.kind = 'stub'; },
    (r) => { r.run.judge.surface = 'api'; },
  ]) {
    const r = JSON.parse(a.artefacts[file]); edit(r); sealReceipt(r);
    const changed = { ...a, artefacts: { ...a.artefacts, [file]: JSON.stringify(r, null, 2) } };
    assert.throws(() => assert.deepEqual(normalized(changed), normalized(a)));
  }
  // A sidecar that records another answers file's sha256.
  const sidecar = Object.keys(a.artefacts).find((f) => f.endsWith('.regrade.json'));
  const answers = Object.keys(a.artefacts).find((f) => f.startsWith('transcripts/') && f.endsWith('/answers.json'));
  const sha = crypto.createHash('sha256').update(a.artefacts[answers]).digest('hex');
  assert.ok(a.artefacts[sidecar].includes(sha), 'the sidecar records the answers file sha256');
  const other = { ...a, artefacts: { ...a.artefacts, [sidecar]: a.artefacts[sidecar].split(sha).join('0'.repeat(64)) } };
  assert.throws(() => assert.deepEqual(normalized(other), normalized(a)));
});
function amendment(text, baseRevision, newRevision) {
  const m = /^### A-026-\d+[^\n]*issue 245[^\n]*\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/m.exec(text);
  assert.ok(m, 'spec 026 carries an amendment naming issue 245');
  const revisions = [...new Set(m[1].match(/judge-code-[0-9a-f]{16}/g) || [])];
  assert.ok(revisions.includes(baseRevision), 'the amendment names the Base revision ' + baseRevision);
  assert.ok(revisions.includes(newRevision), 'the amendment names the new revision ' + newRevision);
  assert.deepEqual(revisions.sort(), [baseRevision, newRevision].sort(), 'the amendment names no other revision');
}
// A-245-1 (issue 288): the new revision is the Change commit's, read by that tree's own judgeCodeRevision.
const CHANGE = /\*\*Change:\*\* \x60([0-9a-f]{40})\x60/.exec(SPEC)[1];
function changeRevision() {
  execFileSync('git', ['merge-base', '--is-ancestor', CHANGE, 'HEAD'], { cwd: ROOT });
  const dir = path.join(harness, 'change');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    const t = path.join(harness, 'change.tar');
    execFileSync('git', ['archive', '--format=tar', '-o', t, CHANGE, 'bin', 'lib', 'config.js', 'config', 'spec', 'package.json'], { cwd: ROOT });
    execFileSync('tar', ['-xf', t, '-C', dir]);
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  }
  return require(path.join(dir, 'lib/judge.js')).judgeCodeRevision(dir);
}
test('AC-7 spec 026 records the judge code revision move', () => {
  amendment(fs.readFileSync(path.join(ROOT, 'specs/026-receipt-integrity/spec.md'), 'utf8'), judgeCodeRevision(baseRoot), changeRevision());
});
test('plants: the amendment reader rejects another revision and a third revision (A-245-1)', () => {
  const base = judgeCodeRevision(baseRoot), change = changeRevision();
  assert.notEqual(change, base);
  const good = '### A-026-99: Stub summaries (issue 245)\n\nThe revision moves from ' + base + ' to ' + change + '.\n';
  amendment(good, base, change);
  assert.throws(() => amendment(good.replace(change, 'judge-code-0123456789abcdef'), base, change));
  assert.throws(() => amendment(good.replace(change + '.', change + ', then judge-code-0123456789abcdef.'), base, change));
});
test('plants: the amendment reader rejects a missing amendment and a missing revision', () => {
  const base = judgeCodeRevision(baseRoot), change = changeRevision();
  const good = '### A-026-99: Stub summaries (issue 245)\n\nThe revision moves from ' + base + ' to ' + change + '.\n';
  amendment(good, base, change);
  assert.throws(() => amendment('', base, change));
  assert.throws(() => amendment(good.replace(change, 'the new one'), base, change));
  assert.throws(() => amendment(good.replace(base, 'the old one'), base, change));
});
