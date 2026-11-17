// SPDX-License-Identifier: Apache-2.0
'use strict';
process.env.DRIFTPROOF_STUB = '1';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const O = require('../scripts/offer');
const rules = require('../lib/rules-files');
const { sha256 } = require('../lib/canonical');
const roots = [];
const tmp = () => { const dir = fs.mkdtempSync('/var/tmp/offer821-'); roots.push(dir); return dir; };
test.after(() => { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); });
const read = f => JSON.parse(fs.readFileSync(f));
const issue = (paths, number = 1) => ({ number, state: 'OPEN', labels: ['offer-pack'], body: '### Repository link\nhttps://github.com/example/rules\n### Skill paths\n' + paths.join('\n') + '\n### Are you the author?\nYes' });
const names = rules.RULES_FILE_KINDS.filter(r => r.kind !== 'markdown').map(r => r.example.replace('*', 'style'));
test('821 identity and capacity: all shared kinds, mixed packs and one queue', () => {
  const paths = ['skills/alpha', ...names];
  assert.deepEqual(O.parseIssue(issue(paths)).skills, ['skills/alpha/SKILL.md', ...names]);
  for (const p of ['../CLAUDE.md', '.cursor/../rules/style.mdc', 'x//AGENTS.md']) assert.ok(O.parseIssue(issue([p])).problem, p);
  const mixed = Array.from({ length: 20 }, (_, i) => i % 2 ? 's' + i : 'r' + i + '/CLAUDE.md');
  assert.equal(O.parseIssue(issue(mixed)).problem, null);
  assert.ok(O.parseIssue(issue([...mixed, 'AGENTS.md'])).problem);
  const q = O.queueOf({ issues: Array.from({ length: 51 }, (_, i) => issue([i % 2 ? 'skills/alpha' : 'CLAUDE.md'], i + 1)), asOf: '2026-11-16' });
  assert.equal(q.requests[49].state, 'queued'); assert.equal(q.requests[50].state, 'refused'); assert.equal(q.count, 50);
});
async function fixture({ paths = [...names, 'skills/alpha'], extraFiles = {}, modes = {} } = {}) {
  const intake = await import('../scripts/offer-intake.mjs');
  const files = Object.fromEntries(names.map(n => [n, Buffer.from((rules.rulesFileKind(n).metadata ? '---\ndescription: Metadata only\n---\n' : '') + '# Rules\nWrite short sentences.\n')]));
  files['skills/alpha/SKILL.md'] = Buffer.from('---\nname: alpha\n---\nWrite short sentences.\n');
  files['run.js'] = Buffer.from('throw new Error("never run")');
  Object.assign(files, extraFiles);
  const fetchRepository = () => ({ dir: tmp(), commit: 'a'.repeat(40), blob: p => { assert.ok(files[p], p); return files[p]; }, tree: folder => Object.keys(files).filter(p => folder === '.' || p === folder || p.startsWith(folder + '/')).map(p => ({ path: p, type: 'blob', mode: modes[p] || '100644' })) });
  const iss = issue(paths);
  const entry = O.queueOf({ issues: [iss], asOf: '2026-11-16' }).requests[0];
  const dir = intake.pin({ requests: tmp(), entry, issue: iss, fetchRepository });
  const B = require('../specs/781-free-offer/build-plan.cjs');
  for (const src of read(path.join(B.bindingDir(dir), 'sources.json'))) {
    const file = path.join(B.bindingDir(dir), src.suite), suite = read(file);
    delete suite.drafted;
    for (const c of suite.cases) { c.prompt = 'Write a short greeting for ' + c.id; c.rubric = 'Award 1 for a short greeting.'; }
    fs.writeFileSync(file, JSON.stringify(suite));
  }
  const plan = intake.plan({ request: dir }), inputs = tmp();
  for (const a of plan.execution.attempts) fs.writeFileSync(path.join(inputs, a.attempt_id + '.md'), files[a.protocol.skill_path]);
  return { dir, plan, inputs, files };
}
test('821 pins, shared parser, sealed receipt and unchanged instrument; negative plants', async () => {
  const { dir, plan, inputs, files } = await fixture();
  const R = require('../specs/781-free-offer/run-campaign.cjs');
  const C = require('../specs/408-skill-measurements/campaign.cjs');
  const ctx = R.readPlan({ request: dir });
  assert.equal(plan.execution.attempts.length, (names.length + 1) * 2);
  assert.equal(plan.cap_usd, 50);
  assert.equal(R.preflight(ctx, inputs).problem, null);
  const { runSkillOnModel } = require('../lib/run');
  const { validateReceipt, sealReceipt } = require('../lib/receipt');
  const M = require('../scripts/build-measure');
  for (const a of plan.execution.attempts.filter(a => a.protocol.model === plan.models[0] && rules.isRulesFile(a.protocol.skill_path))) {
    const subject = C.loadSubject(ctx, a, inputs);
    const expected = rules.rulesFileText(a.protocol.skill_path, files[a.protocol.skill_path].toString());
    assert.equal(subject.unit, 'context_file'); assert.deepEqual(subject.rulesFile, expected);
    assert.equal(subject.contentHash, sha256(files[a.protocol.skill_path]));
    assert.equal(subject.skillMd.includes('Metadata only'), false);
    const result = await runSkillOnModel({ skill: subject, model: a.protocol.model, opts: { placebo: true, judgeModel: plan.judge, samples: 5, concurrency: 1, capture: 'text' } });
    assert.equal(validateReceipt(result.receipt).valid, true);
    assert.deepEqual(result.receipt.skill.rules_file, expected);
    const receiptFile = path.join(inputs, a.attempt_id + '.json'); fs.writeFileSync(receiptFile, JSON.stringify(result.receipt));
    const view = { root: '/', request: { request: 1, repository: 'example/rules', commit: 'a'.repeat(40) }, models: plan.models, skills: [{ skill: a.protocol.skill, skill_path: a.protocol.skill_path, measurable: true, boxes: plan.models.map(model => ({ model, receipt: receiptFile.slice(1) })) }] };
    const html = M.requestPage(view);
    const checkPage = h => { assert.ok(h.includes(a.protocol.skill_path)); assert.ok(h.includes(expected.limitation)); assert.equal((h.match(/class="offer-box"/g) || []).length, 2); };
    checkPage(html);
    assert.throws(() => checkPage(html.replace(/<div class="offer-box"/, '<div class="omitted-box"')));
    C.verifySubject(ctx, a, result.receipt);
    assert.throws(() => checkPage(html.replaceAll(expected.limitation, 'omitted')));
    assert.equal(M.skillRows(view)[0].id.unit, 'context_file');
    for (const mutate of [r => r.skill.rules_file.text += 'x', r => r.skill.rules_file.kind = 'markdown', r => r.skill.content_hash = '0'.repeat(64), r => r.skill.unit = 'skill']) {
      const planted = structuredClone(result.receipt); mutate(planted); sealReceipt(planted); assert.throws(() => C.verifySubject(ctx, a, planted));
    }
    const input = path.join(inputs, a.attempt_id + '.md'), bytes = fs.readFileSync(input);
    fs.appendFileSync(input, 'x'); assert.throws(() => C.loadSubject(ctx, a, inputs), { code: 'SKILL_BYTES' }); fs.writeFileSync(input, bytes);
  }
  const file = path.join(dir, 'plan.json'), original = fs.readFileSync(file);
  for (const mutate of [p => p.cap_usd++, p => p.arms--, p => p.execution.attempts.pop(), p => p.execution.attempts[0].protocol.skill_path = 'other/CLAUDE.md']) {
    const p = JSON.parse(original); mutate(p); fs.writeFileSync(file, JSON.stringify(p)); assert.throws(() => R.readPlan({ request: dir })); fs.writeFileSync(file, original);
  }
});

test('821 pinning rejects non-text and linked rules, keeps missing files and equal basenames distinct', async () => {
  const bad = [
    { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), reason: /UTF-8|NUL/ },
    { bytes: Buffer.from('# Rules\nRun this.\n'), mode: '100755', reason: /executable bit/ },
    { bytes: Buffer.from('other.md'), mode: '120000', reason: /not a regular file/ },
    { bytes: Buffer.from('---\ndescription: no closing block'), name: '.cursor/rules/bad.mdc', reason: /unclosed metadata/ },
  ];
  for (const row of bad) {
    const name = row.name || 'CLAUDE.md';
    const f = await fixture({ paths: [name], extraFiles: { [name]: row.bytes }, modes: { [name]: row.mode || '100644' } });
    const record = read(path.join(f.dir, 'request.json'));
    assert.equal(record.skills[0].measurable, false);
    assert.match(record.skills[0].reason, row.reason);
    assert.equal(f.plan.execution.attempts.length, 0);
  }
  const f = await fixture({ paths: ['a/CLAUDE.md', 'b/CLAUDE.md', 'missing/CLAUDE.md', 'missing/AGENTS.md'], extraFiles: { 'a/CLAUDE.md': Buffer.from('# A\nUse short words.\n'), 'b/CLAUDE.md': Buffer.from('# B\nUse short words.\n') } });
  const record = read(path.join(f.dir, 'request.json'));
  assert.equal(new Set(record.skills.map(s => s.skill)).size, 4);
  assert.deepEqual(record.skills.map(s => s.measurable), [true, true, false, false]);
  assert.equal(f.plan.execution.attempts.length, 4);
  const M = require('../scripts/build-measure');
  const view = { request: record, models: f.plan.models, skills: record.skills.map(s => ({ ...s, boxes: f.plan.models.map(model => ({ model, receipt: null })) })) };
  const html = M.requestPage(view);
  assert.equal((html.match(/class="offer-box"/g) || []).length, 8);
  for (const s of record.skills) assert.ok(html.includes(s.skill_path));
  assert.equal((html.match(/>Cannot tell</g) || []).length, 4);
  assert.equal((html.match(/>Not measurable this way</g) || []).length, 4);
});

test('821 door in process: exact form fields, no model work, no writes and hostile targets refused', () => {
  const vm = require('node:vm'), { createRequire } = require('node:module');
  const file = path.join(__dirname, '../lib/door.js'), realRequire = createRequire(file);
  const version = require('../config').RUNNER_VERSION, work = tmp();
  const drive = target => {
    const calls = [], output = [], module = { exports: {} };
    const spawnSync = (bin, args) => {
      calls.push({ bin, args });
      if (bin === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: work + '\n' };
      if (bin === 'git' && args.join(' ') === 'remote get-url origin') return { status: 0, stdout: 'https://github.com/example/rules.git\n' };
      if (bin === process.execPath && args.at(-1) === '--version') return { status: 0, stdout: version + '\n' };
      if (bin === 'xdg-open') return { status: 0 };
      assert.fail('Unexpected work: ' + bin + ' ' + args.join(' '));
    };
    const mock = { cwd: () => work, env: {}, platform: 'linux', execPath: process.execPath, stdout: { write: s => output.push(s) }, stderr: { write: s => output.push(s) }, exit: code => { throw Object.assign(new Error('door exit'), { exitCode: code }); } };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: id => id === 'child_process' ? { spawnSync } : realRequire(id), module, __dirname: path.dirname(file), process: mock, Buffer, URL, URLSearchParams, console });
    let exit = 0;
    try { module.exports.runDoor(['--pin', version, 'measure', target]); } catch (e) { if (e.exitCode === undefined) throw e; exit = e.exitCode; }
    return { calls, output: output.join(''), exit };
  };
  for (const rel of names) {
    const target = path.join(work, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, '# Rules\nBe brief.\n');
    const before = fs.readFileSync(target), result = drive(rel);
    assert.equal(result.exit, 0, result.output);
    const opened = result.calls.filter(c => c.bin === 'xdg-open');
    assert.equal(opened.length, 1);
    const url = new URL(opened[0].args[0]);
    assert.deepEqual(Object.fromEntries(url.searchParams), { template: 'measure-skill.yml', title: 'Measure a rules file: ' + path.basename(rel), repository: 'https://github.com/example/rules', skill: rel });
    assert.deepEqual(fs.readFileSync(target), before);
    assert.match(result.output, /nothing has been sent/);
  }
  const skill = path.join(work, 'skill');
  fs.mkdirSync(skill); fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: alpha\n---\nBe brief.\n');
  assert.equal(new URL(drive('skill').calls.find(c => c.bin === 'xdg-open').args[0]).searchParams.get('skill'), 'skill/SKILL.md');
  fs.unlinkSync(path.join(work, 'CLAUDE.md')); fs.symlinkSync(skill, path.join(work, 'CLAUDE.md'));
  fs.writeFileSync(path.join(work, 'unsupported.txt'), 'text');
  fs.mkdirSync(path.join(work, 'empty'));
  for (const target of ['CLAUDE.md', 'missing/AGENTS.md', 'unsupported.txt', 'empty', '../CLAUDE.md']) {
    const result = drive(target);
    assert.notEqual(result.exit, 0, target + ': ' + result.output);
    assert.equal(result.calls.some(c => c.bin === 'xdg-open'), false);
  }
});

test('821 mixed request runs and publishes through the existing campaign with stub receipts only', async () => {
  const { dir, inputs, plan } = await fixture({ paths: ['.cursor/rules/style.mdc', 'skills/alpha'] });
  const R = require('../specs/781-free-offer/run-campaign.cjs');
  const C = require('../specs/408-skill-measurements/campaign.cjs');
  assert.ok(Object.hasOwn(plan.runner_hashes, 'lib/rules-files.js'), 'the parser is frozen with the runner');
  const evalHome = tmp();
  fs.mkdirSync(path.join(evalHome, '.claude'));
  fs.writeFileSync(path.join(evalHome, '.claude/settings.json'), JSON.stringify({ permissions: { deny: ['Read', 'WebFetch', 'WebSearch'] }, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, autoMemoryEnabled: false, disableClaudeAiConnectors: true }));
  const campaignRoot = tmp();
  const m = await R.runCampaign({ request: dir, inputs, campaignRoot, evalHome });
  assert.equal(m.stub, true);
  assert.equal(m.outcomes.filter(o => o.status === 'receipt').length, 4, JSON.stringify(m.outcomes.map(o => o.reason)));
  const root = path.resolve(__dirname, '..');
  const reader = { head: () => null, isAncestor: () => true, show: (_head, file) => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : null };
  const view = R.view({ request: dir, campaignRoot, reader, root: '/' });
  const M = require('../scripts/build-measure'), html = M.requestPage(view);
  assert.equal((html.match(/class="offer-box"/g) || []).length, 4);
  const ctx = R.readPlan({ request: dir });
  for (const a of plan.execution.attempts) {
    const s = view.skills.find(s => s.skill === a.protocol.skill), box = s.boxes.find(b => b.model === a.protocol.model);
    assert.ok(box.receipt);
    C.verifySubject(ctx, a, read('/' + box.receipt));
  }
  const s = view.skills.find(s => rules.isRulesFile(s.skill_path)), box = s.boxes[0];
  const file = '/' + box.receipt, original = fs.readFileSync(file), receipt = JSON.parse(original);
  receipt.skill.rules_file.text += 'Altered';
  require('../lib/receipt').sealReceipt(receipt);
  fs.writeFileSync(file, JSON.stringify(receipt));
  assert.throws(() => R.view({ request: dir, campaignRoot, reader, root: '/' }), 'publication refuses a changed rules receipt');
  fs.writeFileSync(file, original);
});

test('821 admission cannot be bypassed by a hand-written request record or frozen plan', async () => {
  const { dir, plan } = await fixture({ paths: ['CLAUDE.md'] });
  const B = require('../specs/781-free-offer/build-plan.cjs'), R = require('../specs/781-free-offer/run-campaign.cjs');
  const recordFile = path.join(dir, 'request.json'), planFile = path.join(dir, 'plan.json');
  const originalRecord = fs.readFileSync(recordFile), originalPlan = fs.readFileSync(planFile);
  for (const kind of ['request51', 'pack21']) {
    const record = JSON.parse(originalRecord), planted = structuredClone(plan);
    if (kind === 'request51') {
      record.request = planted.request = 51;
      for (const [i, a] of planted.execution.attempts.entries()) {
        a.protocol.request = 51; a.attempt_id = sha256(JSON.stringify(a.protocol)); planted.rows[i].attempt_id = a.attempt_id;
      }
    } else {
      while (record.skills.length < 21) record.skills.push({ skill: 'missing-' + record.skills.length, skill_path: 'missing-' + record.skills.length + '/CLAUDE.md', measurable: false, reason: 'No file.' });
      planted.not_measurable = record.skills.filter(s => !s.measurable).map(s => ({ skill: s.skill, skill_path: s.skill_path, reason: s.reason }));
    }
    fs.writeFileSync(recordFile, JSON.stringify(record)); fs.writeFileSync(planFile, JSON.stringify(planted));
    assert.throws(() => R.readPlan({ request: dir }), kind);
    assert.throws(() => B.buildPlan({ request: dir }), kind);
    fs.writeFileSync(recordFile, originalRecord); fs.writeFileSync(planFile, originalPlan);
  }
});

test('821 shared paid-result verifier checks both comparisons for rules and skills without model calls', async () => {
  const { dir, inputs, plan } = await fixture({ paths: ['.cursor/rules/style.mdc', 'skills/alpha'] });
  const R = require('../specs/781-free-offer/run-campaign.cjs');
  const C = require('../specs/408-skill-measurements/campaign.cjs');
  const S = require('../specs/613-placebo-skills-report/run-campaign.cjs');
  const ctx = R.readPlan({ request: dir }), evalHome = tmp();
  fs.mkdirSync(path.join(evalHome, '.claude'));
  fs.writeFileSync(path.join(evalHome, '.claude/settings.json'), JSON.stringify(ctx.plan.execution.effective_environment?.allowlist?.['.claude/settings.json'] || { permissions: { deny: ['Read', 'WebFetch', 'WebSearch'] }, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, autoMemoryEnabled: false, disableClaudeAiConnectors: true }));
  const audit = { ...require('../specs/408-skill-measurements/eval-audit.cjs').auditDirectory(evalHome, {}, []), isolation: 'eval-user', checked_at: new Date().toISOString() };
  for (const a of plan.execution.attempts.filter(a => a.protocol.model === plan.models[0])) {
    const subject = C.loadSubject(ctx, a, inputs);
    const result = await require('../lib/run').runSkillOnModel({ skill: subject, model: a.protocol.model, opts: { placebo: true, judgeModel: plan.judge, samples: 5, concurrency: 1, capture: 'text', keepTranscripts: true } });
    // Synthetic model-shaped evidence stays in this temporary fixture.
    const r = result.receipt;
    r.verification_level = 'TESTED'; r.run.surface = 'claude-cli';
    r.run.harness = { name: 'claude', version: 'synthetic-fixture' };
    r.run.answered_by = { kind: 'model', attested: true, reported_model: a.protocol.model, reported_models: [a.protocol.model], isolation: 'eval-user' };
    r.run.judge.surface = 'claude-cli'; r.run.judge.harness = { name: 'claude', version: 'synthetic-fixture' };
    r.run.judge.isolation = 'eval-user'; r.run.judge.reported_models = [a.protocol.judge];
    r.run.judge.endpoint.resolved_by = 'cli';
    for (const c of r.results.cases) for (const d of c.generation.draws) d.reported_model = a.protocol.model;
    const record = C.annotate(ctx, a, result, audit);
    const verified = S.verifyPlaceboOutcome(ctx, a, record.receipt, record.answers);
    assert.equal(verified.skill.generations, 18);
    assert.equal(verified.placebo.generations, 18);
    const planted = structuredClone(record.receipt);
    planted.skill.content_hash = '0'.repeat(64);
    require('../lib/receipt').sealReceipt(planted);
    assert.throws(() => S.verifyPlaceboOutcome(ctx, a, planted, { ...record.answers, receipt_hash: planted.receipt_hash }));
  }
});
