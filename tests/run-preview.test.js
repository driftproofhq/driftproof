// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin/driftproof');
const PRELOAD = path.join(__dirname, 'fixtures/preview-guard.cjs');
const { resolveModel, surfaceForModel, requestPlan, buildCodexArgs } = require('../lib/provider');
const { promptTemplateHash, criteriaTemplateHash } = require('../lib/judge');
const { estimateRunCostUSD } = require('../lib/cost');
const { termText } = require('../lib/names');
const { SAMPLING } = require('../lib/sampling');
const { QUICK } = require('../lib/firstrun');
const sections = ['what_is_sent', 'where', 'how_often', 'what_is_written_and_kept', 'what_this_preview_does_not_know'];
const headings = ['What is sent', 'Where', 'How often', 'What is written and kept', 'What this preview does not know'];
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));
function fixture({ context = false, hostile = false, rc } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'preview728-')); dirs.push(cwd);
  const first = hostile ? 'Keep calm ' + String.fromCharCode(27) + '[31m' : '# Plain café';
  const text = first + '\nAnswer briefly. This is private source text, not executable code.\n';
  const cases = [
    { id: 'second', prompt: 'Question α?', rubric: 'Reward a short answer.', pass_threshold: 0.7 },
    { id: 'first', prompt: 'Question β?', rubric: 'Additional grading context.', pass_threshold: 0.6,
      criteria: [{ id: 'clear', weight: 2, description: 'A clear answer.' }] },
  ];
  const name = hostile ? 'rules' + String.fromCharCode(0x202e) + '.md' : 'rules.md';
  const subject = path.join(cwd, context ? name : 'skill');
  const suite = context ? path.join(cwd, 'tasks.json') : path.join(subject, 'evals/evals.json');
  fs.mkdirSync(path.dirname(suite), { recursive: true });
  fs.writeFileSync(suite, JSON.stringify({ cases }));
  fs.writeFileSync(context ? subject : path.join(subject, 'SKILL.md'), text);
  if (!context) {
    fs.mkdirSync(path.join(subject, 'scripts'));
    fs.writeFileSync(path.join(subject, 'scripts', hostile ? 'bad' + String.fromCharCode(27) + '.js' : 'never.js'), "throw new Error('EXECUTED_SUBJECT');\n");
    fs.writeFileSync(path.join(subject, 'reference.txt'), 'Bundled, hashed, not sent.');
  }
  if (rc) fs.writeFileSync(path.join(cwd, '.driftproofrc'), JSON.stringify(rc));
  return { cwd, subject, text, cases, args: [subject, ...(context ? ['--suite', suite] : [])] };
}
function invoke(f, args = [], extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(CLAUDE_|OPENAI_|ANTHROPIC_|DRIFTPROOF_|PREVIEW_)|API_KEY|TOKEN|SECRET|NODE_OPTIONS/.test(k)) delete env[k];
  Object.assign(env, { TMPDIR: '/var/tmp', CLAUDE_PROVIDER: 'cli', OPENAI_SURFACE: 'cli', ...extra });
  return spawnSync(process.execPath, ['--require', PRELOAD, BIN, 'run', ...f.args, ...args], {
    cwd: f.cwd, env, encoding: 'utf8', timeout: 1800000,
  });
}
function preview(f, args = [], extra = {}) {
  const r = invoke(f, ['--preview', '--json', ...args], extra);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const p = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(p), sections);
  assert.equal(fs.existsSync(path.join(f.cwd, 'receipts')), false);
  assert.equal(fs.existsSync(path.join(f.cwd, 'transcripts')), false);
  return { p, r };
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function textOracle(p, f) {
  assert.equal(p.what_is_sent.system.bytes, Buffer.byteLength(f.text));
  assert.equal(p.what_is_sent.system.sha256, sha(f.text));
  assert.equal(p.what_is_sent.system.estimated_tokens, Math.ceil(f.text.length / 4));
  assert.equal(p.what_is_sent.system.first_line, termText(f.text.split('\n')[0]));
  assert.equal(p.what_is_sent.tasks.length, f.cases.length);
  f.cases.forEach((c, i) => {
    const t = p.what_is_sent.tasks[i];
    assert.equal(t.id, c.id);
    assert.equal(t.prompt_bytes, Buffer.byteLength(c.prompt));
    assert.equal(t.prompt_template_hash, c.criteria ? criteriaTemplateHash() : promptTemplateHash());
    assert.equal(t.pass_threshold, c.pass_threshold);
    if (c.criteria) assert.deepEqual(t.criteria, c.criteria);
    assert.equal(t.rubric, c.rubric);
  });
}
function countsOracle(p, { cases = 2, arms = 2, draws = SAMPLING.max, samples = require('../config').DEFAULT_JUDGE_SAMPLES, targets = ['haiku'], judge } = {}) {
  const h = p.how_often;
  assert.equal(h.judge_samples, samples);
  assert.equal(h.cases, cases); assert.equal(h.draws, draws); assert.equal(h.arms.length, arms);
  assert.equal(h.calls_per_model, cases * arms * draws * (1 + samples));
  assert.equal(h.total_calls, h.calls_per_model * targets.length);
  const total = targets.reduce((s, m) => s + estimateRunCostUSD({
    caseCount: cases, draws, samples, models: [resolveModel(m)], judgeModel: resolveModel(judge || m), arms,
  }).totalUSD, 0);
  assert.equal(h.estimated_usd, Math.round(total * 1e4) / 1e4);
  assert.equal(h.cost_label, 'metered-equivalent estimate');
}
function retentionOracle(p, kept = false) {
  const w = p.what_is_written_and_kept;
  assert.equal(w.transcripts, kept ? 'retained-local' : 'hashes-only');
  assert.ok(w.receipt_patterns.every(s => s.endsWith('-<date>-<hash12>.json')));
  assert.match(w.meaning, kept ? /answer/i : /hash/i);
  assert.match(w.upload, /no.*upload/i);
  assert.equal(p.what_this_preview_does_not_know.length, 3);
  assert.match(p.what_this_preview_does_not_know.join(' '), /CLI.*connect|claude.*connect/i);
  assert.match(p.what_this_preview_does_not_know.join(' '), /retention/);
  assert.match(p.what_this_preview_does_not_know.join(' '), /future.*flag.*rc/i);
}
test('AC-1,3,5,6: text and JSON show the same five sections, no model, network or writes', () => {
  const f = fixture(); const { p, r } = preview(f);
  textOracle(p, f); countsOracle(p); retentionOracle(p);
  assert.match(r.stderr, /PREVIEW_LOOKUPS 1/);
  assert.deepEqual(p.what_is_sent.bundled_files.sent, ['SKILL.md']);
  assert.deepEqual(p.what_is_sent.bundled_files.not_sent, ['reference.txt', 'scripts/never.js']);
  const human = invoke(f, ['--preview']);
  assert.equal(human.status, 0, human.stderr);
  let at = -1;
  for (const h of headings) { const next = human.stdout.indexOf(h); assert.ok(next > at, h); at = next; }
  assert.ok(human.stdout.includes(p.what_is_sent.system.sha256));
  for (const line of p.what_this_preview_does_not_know) assert.ok(human.stdout.includes(line));
  assert.match(human.stdout, /metered-equivalent estimate/);
  assert.match(human.stdout, /Context for the criteria: Additional grading context/);
});
test('AC-2: ordinary runner handoff matches preview including changed shared defaults, rc and flags', () => {
  for (const setup of [
    { rc: null, args: [], env: {} },
    { rc: null, args: [], env: { PREVIEW_DEFAULT: '7' } },
    { rc: { samples: 2, models: 'gpt', judge_model: 'haiku', max_cases: 1 }, args: [], env: {} },
    { rc: { samples: 2, max_cases: 1 }, args: ['--samples', '3', '--case', 'first', '--case', 'second', '--placebo'], env: {} },
    { rc: { samples: 7 }, args: ['--quick', '--case', 'first'], env: {} },
  ]) {
    const f = fixture({ rc: setup.rc });
    const { p } = preview(f, setup.args, setup.env);
    const r = invoke(f, [...setup.args, '--max-usd', '1000', '--max-calls', '10000'], setup.env);
    assert.equal(r.status, 0, r.stderr);
    const actual = JSON.parse(r.stdout.match(/RUN_INPUT (.+)/)[1]);
    assert.equal(p.how_often.judge_samples, actual.samples);
    assert.equal(p.how_often.draws, actual.draws);
    assert.equal(p.how_often.concurrency, actual.concurrency);
    assert.deepEqual(p.what_is_sent.tasks.map(c => c.id), actual.cases);
    assert.equal(p.where[0].model, actual.model);
    assert.equal(p.where[1].model, actual.judge);
    assert.equal(p.what_is_written_and_kept.transcripts, actual.keepTranscripts ? 'retained-local' : 'hashes-only');
    assert.equal(p.how_often.arms.length, actual.placebo ? 3 : 2);
  }
});
test('AC-4: both providers, mixed judge, key empty and nonempty, host stripping, trusted and absent accounts', () => {
  const f = fixture({ context: true });
  for (const [env, surface, host, model] of [
    [{ CLAUDE_PROVIDER: 'api' }, 'api', 'api.anthropic.com', 'haiku'],
    [{ OPENAI_SURFACE: 'api' }, 'openai-api', 'api.openai.com', 'gpt'],
    [{ OPENAI_SURFACE: '', OPENAI_API_KEY: 'synthetic-presence-marker' }, 'openai-api', 'api.openai.com', 'gpt'],
    [{ OPENAI_SURFACE: '', OPENAI_API_KEY: '' }, 'openai-cli', null, 'gpt'],
    [{ CLAUDE_PROVIDER: 'api', ANTHROPIC_BASE_URL: 'https://user:pw' + String.fromCharCode(64) + 'example.invalid/private?hidden=yes' }, 'api', 'example.invalid', 'haiku'],
  ]) {
    const { p, r } = preview(f, ['--models', model, '--judge-model', 'haiku'], env);
    assert.equal(p.where[0].surface, surface); assert.equal(p.where[0].api_host, host);
    assert.equal(p.where[0].provider, model === 'gpt' ? 'openai' : 'anthropic');
    assert.equal(p.where[0].spend, surface.endsWith('api') ? 'metered' : 'subscription');
    assert.doesNotMatch(r.stdout + r.stderr, /synthetic-presence-marker|user:pw|hidden=yes|\/private/);
    for (const e of p.where[0].environment) { assert.deepEqual(Object.keys(e), ['name', 'set']); assert.equal(typeof e.set, 'boolean'); }
  }
  const trusted = preview(f, ['--trusted-skill']); assert.equal(trusted.p.where[0].isolation.lane, 'trusted');
  assert.match(trusted.r.stderr, /PREVIEW_LOOKUPS 0/);
  const absent = preview(f, [], { PREVIEW_ACCOUNT: 'missing' });
  assert.equal(absent.p.where[0].isolation.exists, false);
  assert.equal(absent.p.where[0].isolation.account, 'driftproof-eval');
  assert.ok(absent.p.how_often.run_blockers.some(s => /account/.test(s)));
});
test('AC-3,5,6: placebo, multiple targets, kept answers, quick and output patterns', () => {
  const f = fixture();
  const { p } = preview(f, ['--placebo', '--models', 'haiku,gpt', '--judge-model', 'haiku', '--keep-transcripts', '--out', 'custom']);
  countsOracle(p, { arms: 3, targets: ['haiku', 'gpt'], judge: 'haiku' }); retentionOracle(p, true);
  assert.deepEqual(p.how_often.arms, ['with_skill', 'baseline', 'placebo']);
  assert.equal(p.what_is_sent.placebo.bytes, Buffer.byteLength(f.text));
  assert.ok(p.what_is_written_and_kept.receipt_patterns.every(s => s.startsWith('custom/')));
  const quick = preview(f, ['--quick']).p;
  countsOracle(quick, { cases: 1, draws: QUICK.draws, samples: QUICK.samples }); retentionOracle(quick, true);
  assert.match(quick.what_is_written_and_kept.answers, /quick/);
});
test('AC-7: hostile text and filenames are terminal escaped, JSON matches text', () => {
  for (const context of [true, false]) {
    const f = fixture({ context, hostile: true });
    const { p, r } = preview(f);
    textOracle(p, f);
    assert.ok(!r.stdout.includes(String.fromCharCode(27)));
    const h = invoke(f, ['--preview']);
    assert.equal(h.status, 0, h.stderr);
    assert.ok(!h.stdout.includes(String.fromCharCode(27)));
    assert.ok(h.stdout.includes(termText(f.text.split('\n')[0])));
    if (context) assert.equal(p.what_is_sent.subject, termText(path.basename(f.subject)));
    else assert.ok(p.what_is_sent.bundled_files.not_sent.includes(termText('scripts/bad' + String.fromCharCode(27) + '.js')));
  }
});
test('AC-7: unsupported capture and invalid flags refuse without execution', () => {
  const f = fixture();
  for (const args of [
    ['--preview', '--capture', 'repository'], ['--preview', '--capture', 'files'],
    ['--preview', '--resume', 'checkpoint'], ['--json'], ['--preview=false'],
    ['--preview', '--samples', 'bad'], ['--preview', '--models', 'nonexistent-model'],
  ]) {
    const r = invoke(f, args); assert.equal(r.status, 2, r.stderr);
    assert.doesNotMatch(r.stderr, /PREVIEW_FORBIDDEN/);
    assert.equal(fs.existsSync(path.join(f.cwd, 'receipts')), false);
  }
});
test('AC-7: control-character subject paths retain the run refusal', () => {
  const f = fixture({ context: true });
  const bad = path.join(f.cwd, 'rules' + String.fromCharCode(27) + '.md');
  fs.renameSync(f.subject, bad); f.args[0] = bad;
  const r = invoke(f, ['--preview']);
  assert.equal(r.status, 2); assert.match(r.stderr, /contains a control character/);
  assert.ok(!r.stderr.includes(String.fromCharCode(27)));
});
test('AC-1: actual forbidden operation plants read red with stub disabled', () => {
  const f = fixture();
  for (const plant of ['spawn', 'second-id', 'network', 'write', 'model']) {
    const r = invoke(f, ['--preview', '--json'], { PREVIEW_PLANT: plant });
    assert.notEqual(r.status, 0, plant); assert.match(r.stderr, /PREVIEW_FORBIDDEN/, plant);
  }
});
test('AC-2..6: independent oracles reject false facts from the preview path', () => {
  const f = fixture();
  for (const plant of ['samples', 'system-hash', 'task', 'template', 'calls', 'label', 'retention', 'limits']) {
    const { p } = preview(f, [], { PREVIEW_PLANT: plant });
    assert.throws(() => { textOracle(p, f); countsOracle(p); retentionOracle(p); }, undefined, plant);
  }
  for (const plant of ['surface', 'credential', 'url']) {
    const { p, r } = preview(f, [], {
      PREVIEW_PLANT: plant, CLAUDE_PROVIDER: 'api', OPENAI_API_KEY: 'synthetic-presence-marker',
      ANTHROPIC_BASE_URL: 'https://user:pw' + String.fromCharCode(64) + 'example.invalid/private?hidden=yes',
    });
    assert.throws(() => {
      assert.equal(p.where[0].surface, 'api');
      assert.equal(p.where[0].api_host, 'example.invalid');
      assert.doesNotMatch(r.stdout, /synthetic-presence-marker|user:pw|hidden=yes/);
    }, undefined, plant);
  }
});
test('AC-6: stub preview stays JSON and labels the configured routes inactive', () => {
  const f = fixture(); const { p, r } = preview(f, [], { DRIFTPROOF_STUB: '1' });
  assert.ok(r.stderr.startsWith('STUB RUN (DRIFTPROOF_STUB=1)'));
  assert.equal(p.how_often.estimated_usd, null);
  assert.equal(p.how_often.cost_note, 'No projected cost: no model will be called.');
  assert.equal(p.how_often.synthetic, true);
  assert.ok(p.where.every(w => w.active === false));
});

test('AC-7: escaping and capture refusal plants read red', () => {
  const f = fixture({ hostile: true });
  const { p } = preview(f, [], { PREVIEW_PLANT: 'escaping' });
  assert.throws(() => textOracle(p, f));
  const r = invoke(f, ['--preview', '--capture', 'repository'], { PREVIEW_PLANT: 'capture' });
  assert.throws(() => assert.equal(r.status, 2));
});

test('AC-6,7: stub JSON refusal announces first; run JSON is value-free before the subject', () => {
  const f = fixture();
  const refused = invoke(f, ['--json'], { DRIFTPROOF_STUB: '1' });
  assert.equal(refused.status, 2); assert.equal(refused.stdout, '');
  assert.ok(refused.stderr.startsWith('STUB RUN (DRIFTPROOF_STUB=1)'));
  const r = invoke({ ...f, args: ['--preview', '--json', ...f.args] });
  assert.equal(r.status, 0, r.stderr);
  textOracle(JSON.parse(r.stdout), f);
});

// Issue 756 (A-728-4, A-728-5).
const ADDRESS_REFUSAL = 'REFUSED (run): The configured API address has no valid HTTP host; no preview produced.';
test('AC-4,7 (A-728-4): an unusable API address refuses in one line with exit 2 and no URL', () => {
  const f = fixture({ context: true });
  for (const [env, model] of [
    [{ CLAUDE_PROVIDER: 'api', ANTHROPIC_BASE_URL: 'not a url private-marker' }, 'haiku'],
    [{ CLAUDE_PROVIDER: 'api', ANTHROPIC_BASE_URL: 'ftp://user:pw' + String.fromCharCode(64) + 'leaky.invalid/private-marker' }, 'haiku'],
    [{ OPENAI_SURFACE: 'api', OPENAI_BASE_URL: 'file:///private-marker' }, 'gpt'],
    [{ OPENAI_SURFACE: 'api', OPENAI_BASE_URL: '::not-parsable private-marker' }, 'gpt'],
  ]) for (const format of [[], ['--json']]) {
    const r = invoke(f, ['--preview', ...format, '--models', model], env);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '', 'no partial preview');
    assert.deepEqual(r.stderr.split('\n').filter(l => l && !l.startsWith('PREVIEW_LOOKUPS')), [ADDRESS_REFUSAL]);
    assert.doesNotMatch(r.stderr, /private-marker|leaky|user:pw|FATAL|\bat .*:\d+:\d+/);
  }
  const stubbed = invoke(f, ['--preview'], { DRIFTPROOF_STUB: '1', CLAUDE_PROVIDER: 'api', ANTHROPIC_BASE_URL: 'not a url' });
  assert.equal(stubbed.status, 2, stubbed.stderr);
  assert.ok(stubbed.stderr.includes('\n' + ADDRESS_REFUSAL + '\n'), stubbed.stderr);
  // Control: a CLI surface never reads the address, so this still previews.
  preview(f, [], { CLAUDE_PROVIDER: 'cli', ANTHROPIC_BASE_URL: 'not a url' });
});
test('AC-5 (A-728-5): a stub plan that would refuse on cost shows the limit it refers to', () => {
  const f = fixture();
  const refused = invoke(f, ['--preview', '--max-usd', '0.001'], { DRIFTPROOF_STUB: '1' });
  assert.equal(refused.status, 0, refused.stderr);
  assert.match(refused.stdout, /Run would refuse: The estimate exceeds --max-usd\./);
  assert.match(refused.stdout, /Estimated cost limit: \$0\.001\n/, 'the limit is shown as given, not rounded to nothing');
  assert.doesNotMatch(refused.stdout, /metered-equivalent estimate: \$/, 'still no projected cost');
  const fits = invoke(f, ['--preview', '--max-usd', '1000'], { DRIFTPROOF_STUB: '1' });
  assert.equal(fits.status, 0, fits.stderr);
  assert.doesNotMatch(fits.stdout, /Run would refuse|Estimated cost limit/, 'a plan with no refusal names no limit');
  const metered = invoke(f, ['--preview', '--max-usd', '20']);
  assert.match(metered.stdout, /Estimated cost limit: \$20\.00\n/, 'the ordinary line is unchanged');
});

// Issue 756 (A-728-6). The oracle is what the run passes: the answers call names text capture and the
// judge call leaves it to the default, as lib/judge.js does.
const TRUSTED_TOOLS = "The model's tools run as you, with your files and network.";
const runTools = (capture) => {
  const a = requestPlan({ surface: 'claude-cli', system: 's', prompt: 'p', model: 'haiku', trusted: true, ...(capture ? { capture } : {}) }).spawn.args;
  return a[a.indexOf('--tools') + 1].split(',');
};
const runSandbox = () => { const a = buildCodexArgs({}); return a[a.indexOf('-s') + 1]; };
function toolsOracle(p) {
  for (const w of p.where) {
    const expected = w.surface === 'claude-cli' ? runTools(w.role === 'answers' ? 'text' : undefined) : w.surface === 'openai-cli' ? null : [];
    assert.deepEqual(w.tools, expected, w.role + ' tools on ' + w.surface);
    assert.equal(w.sandbox, w.surface === 'openai-cli' ? runSandbox() : null);
    assert.equal(w.tools_note, w.isolation.lane === 'trusted' ? TRUSTED_TOOLS : null);
  }
}
test('AC-4 (A-728-6): each role lists the tools the run passes, in JSON and text', () => {
  const f = fixture({ context: true });
  for (const [args, env, line] of [
    [[], {}, () => runTools('text').join(', ')],
    [['--models', 'gpt'], {}, () => 'none named; codex runs in its ' + runSandbox() + ' sandbox'],
    [[], { CLAUDE_PROVIDER: 'api' }, () => 'none'],
    [['--models', 'gpt'], { OPENAI_SURFACE: 'api' }, () => 'none'],
  ]) {
    const { p } = preview(f, args, env); toolsOracle(p);
    const human = invoke(f, ['--preview', ...args], env);
    assert.equal(human.status, 0, human.stderr);
    assert.equal(human.stdout.split('    Tools: ' + line() + '\n').length - 1, p.where.length, human.stdout);
  }
});
test('AC-4 (A-728-6): the trusted-lane sentence appears on that lane and no other', () => {
  const f = fixture({ context: true });
  const count = (s) => s.split(TRUSTED_TOOLS).length - 1;
  const trusted = preview(f, ['--trusted-skill']).p; toolsOracle(trusted);
  assert.ok(trusted.where.every(w => w.tools_note === TRUSTED_TOOLS));
  assert.equal(count(invoke(f, ['--preview', '--trusted-skill']).stdout), trusted.where.length);
  for (const [args, env] of [[[], {}], [['--trusted-skill'], { DRIFTPROOF_STUB: '1' }], [['--trusted-skill'], { CLAUDE_PROVIDER: 'api' }]]) {
    const { p } = preview(f, args, env); toolsOracle(p);
    assert.ok(p.where.every(w => w.tools_note === null), JSON.stringify(args));
    assert.equal(count(invoke(f, ['--preview', ...args], env).stdout), 0, JSON.stringify(args));
  }
});
test('AC-4 (A-728-6): plants: a list that differs from the run or a sentence off its lane reads red; no second copy', () => {
  const f = fixture({ context: true });
  for (const plant of ['tools', 'tools-note']) assert.throws(() => toolsOracle(preview(f, [], { PREVIEW_PLANT: plant }).p), assert.AssertionError, plant);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'lib/preview.js'), 'utf8'), /WebFetch|WebSearch/, 'the preview holds no copy of the tool names');
});

// Issue 756 (A-728-7). Stub runs, with no guard, show the line the real run prints.
const said = (r) => r.stderr.split('\n').filter(l => l && !l.startsWith('PREVIEW_LOOKUPS'));
const NO_LEAK = /FATAL|\bat .*:\d+:\d+|https?:|example\.invalid|someone|private/;
function bare(f, args, preload) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(CLAUDE_|OPENAI_|ANTHROPIC_|DRIFTPROOF_|PREVIEW_)|API_KEY|TOKEN|SECRET|NODE_OPTIONS/.test(k)) delete env[k];
  Object.assign(env, { TMPDIR: '/var/tmp', CLAUDE_PROVIDER: 'api', DRIFTPROOF_STUB: '1' });
  return spawnSync(process.execPath, [...(preload ? ['--require', preload] : []), BIN, 'run', ...f.args, ...args], { cwd: f.cwd, env, encoding: 'utf8', timeout: 1800000 });
}
const runArgs = (f) => ['--placebo', '--samples', '1', '--max-usd', '1000', '--max-calls', '100000', '--out', path.join(f.cwd, 'run-out')];
function sameAsTheRun(f, preload, line) {
  const previewed = bare(f, ['--placebo', '--preview'], preload), ran = bare(f, runArgs(f), preload);
  assert.equal(previewed.status, 2, previewed.stderr); assert.equal(ran.status, 2, ran.stderr + ran.stdout);
  assert.equal(previewed.stdout, '');
  assert.match(said(ran).at(-1), line);
  assert.equal(said(previewed).at(-1), said(ran).at(-1), 'the line the run prints');
}
test('AC-7 (A-728-7): an over-size placebo preview refuses in one line, exit 2, as the run does', () => {
  const f = fixture({ context: true });
  let big = '# Big rules\n', i = 0;
  while (Buffer.byteLength(big) < 300000) big += 'Rule ' + (i++) + ': prefer small focused functions with clear names.\n';
  fs.writeFileSync(f.subject, big);
  const line = /^ {2}✗ REFUSED \(PLACEBO_TOO_LONG\): placebo: the skill text is \d+ bytes, more than the \d+ a placebo may be; nothing run, no receipt written$/;
  for (const format of [[], ['--json']]) {
    const r = invoke(f, ['--preview', '--placebo', ...format], { CLAUDE_PROVIDER: 'api' });
    assert.equal(r.status, 2, r.stderr); assert.equal(r.stdout, '');
    assert.equal(said(r).length, 1, r.stderr); assert.match(said(r)[0], line); assert.doesNotMatch(r.stderr, NO_LEAK);
  }
  sameAsTheRun(f, null, line);
});
test('AC-7 (A-728-7): an overlapping placebo refuses with the run\'s code and words', () => {
  const f = fixture({ context: true }), preload = path.join(f.cwd, 'overlap.cjs');
  fs.writeFileSync(preload, 'require(' + JSON.stringify(path.join(ROOT, 'lib/placebo')) + ").sharedRun = () => 'six planted words in a row';\n");
  sameAsTheRun(f, preload, /^ {2}✗ REFUSED \(PLACEBO_OVERLAP\): placebo: the placebo shares the words "six planted words in a row" with the skill text/);
});
test('AC-7 (A-728-7): any other failure building or showing a preview is one line naming no path or address', () => {
  const f = fixture({ context: true });
  for (const [plant, code] of [['crash', ''], ['crash-code', ' (ENOENT)'], ['render-crash', '']]) {
    const r = invoke(f, ['--preview'], { PREVIEW_PLANT: plant });
    assert.equal(r.status, 2, plant + ': ' + r.stderr); assert.equal(r.stdout, '', plant);
    assert.deepEqual(said(r), ['REFUSED (run): The preview could not be built' + code + '; no preview produced.'], plant);
    assert.doesNotMatch(r.stderr, NO_LEAK, plant);
  }
});
