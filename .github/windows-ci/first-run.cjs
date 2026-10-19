// SPDX-License-Identifier: Apache-2.0
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const c = require('./common.cjs');
const { validateReceipt, verifyReceiptHash } = require('../../lib/receipt');
const { loadSkill, normalizeCases } = require('../../lib/skill');
const { QUICK, SMOKE_LINE } = require('../../lib/firstrun');
const { resolveCount } = require('../../lib/counts');
const HELP = [
  'start here: driftproof init <skill-dir> adds evals/evals.json, with 3 example test cases to replace with your own, to your skill folder.',
  'then: driftproof run <skill-dir> --quick for a first look: one test task, its answer with and without the skill, no verdict.',
  'then: driftproof run <skill-dir> to measure every test task; the receipt is written to ./receipts/.',
  "In Claude Code, the plugin's /driftproof:start drafts the test cases with you and runs the first look.",
  'Every command and option: driftproof --help',
].join('\n') + '\n';
const norm = (text) => String(text).replace(/\r\n/g, '\n');
const words = (text) => String(text).replace(/\s+/g, ' ').trim();
function assertHelp(result) {
  c.success(result, 'AC-12 help');
  assert.equal(norm(result.stdout), HELP, 'AC-12 help output');
  assert.equal(result.stderr, '', 'AC-12 help stderr');
}
function assertUnchanged(before, after) { c.assertUnchanged(before, after); }
function assertInit(result, files, { repeat = false } = {}) {
  c.success(result, 'AC-13 init');
  assert.equal(result.stderr, '', 'AC-13 init stderr');
  const names = ['.driftproofrc', 'SKILL.md', 'evals/evals.json'];
  assert.deepEqual(Object.keys(files).sort(), names, 'AC-13 init file set');
  for (const name of names) {
    assert.equal(typeof files[name], 'string'); assert.ok(files[name].length, 'AC-13 nonempty ' + name);
    const output = norm(result.stdout).replace(/\\/g, '/');
    const row = output.split('\n').find((line) => line.includes(name) && (repeat ? line.includes('(exists') : /^\s*\+ /.test(line)));
    assert.ok(row, 'AC-13 init reports ' + name);
  }
  const suite = JSON.parse(files['evals/evals.json']), rc = JSON.parse(files['.driftproofrc']);
  assert.equal(normalizeCases(suite).length, 3, 'AC-13 three valid examples');
  assert.equal(typeof suite.skill, 'string'); assert.ok(suite.skill.length);
  assert.ok(files['SKILL.md'].includes(suite.skill), 'AC-13 suite names the scaffolded skill');
  assert.ok(rc && typeof rc === 'object' && !Array.isArray(rc), 'AC-13 rc object');
  if (repeat) assert.match(result.stdout, /Nothing to create/);
}
function noClaim(text, surface) {
  assert.doesNotMatch(text, /\b(?:helped|hurt|passed|regressed|no_effect|no effect|no clear difference|underpowered|inconclusive|confidence|confident|significant|significance|p-value)\b/i,
    'AC-14 smoke ' + surface + ' contains a verdict or confidence claim');
}
function assertQuick(observation) {
  const { result, receipts, html, inputs } = observation;
  c.success(result, 'AC-14 quick');
  assert.equal(receipts.length, 1, 'AC-14 exactly one receipt');
  const r = receipts[0];
  assert.ok(validateReceipt(r).valid, 'AC-14 receipt schema');
  assert.ok(verifyReceiptHash(r), 'AC-14 receipt seal');
  assert.equal(r.run.runner_version, inputs.version, 'AC-14 runner identity');
  assert.equal(r.run.preset, 'quick', 'AC-14 quick preset');
  assert.equal(r.run.answered_by.kind, 'stub', 'AC-14 stub answers');
  assert.equal(r.run.surface, 'stub', 'AC-14 stub surface');
  assert.equal(r.verification_level, 'UNVERIFIED', 'AC-14 unverified');
  assert.equal(r.run.model_id, inputs.model, 'AC-14 model identity');
  assert.equal(r.skill.name, inputs.name, 'AC-14 skill identity');
  assert.equal(r.skill.content_hash, inputs.contentHash, 'AC-14 skill digest');
  assert.equal(r.suite.suite_hash, inputs.suiteHash, 'AC-14 suite digest');
  assert.equal(r.suite.case_count, inputs.cases.length, 'AC-14 full suite count');
  const ids = inputs.cases.slice(0, QUICK.maxCases).map((x) => x.id);
  const pairs = r.results.cases;
  assert.equal(pairs.length, ids.length * 2, 'AC-14 task arms');
  assert.equal(r.run.judge.samples, QUICK.samples, 'AC-14 judge samples');
  for (const id of ids) for (const mode of ['with_skill', 'baseline']) {
    const rows = pairs.filter((x) => x.id === id && x.mode === mode);
    assert.equal(rows.length, 1, 'AC-14 task identity and unique arm');
    const row = rows[0], index = pairs.indexOf(row), generation = row.generation;
    assert.equal(resolveCount(r, index, 'generations_per_arm'), QUICK.draws, 'AC-14 recorded draw count');
    assert.equal(resolveCount(r, index, 'judge_samples_per_generation'), QUICK.samples);
    assert.equal(generation.n_drawn, QUICK.draws); assert.equal(generation.n_measured, QUICK.draws);
    assert.equal(generation.n_unmeasured, 0); assert.equal(generation.draws.length, QUICK.draws);
    assert.deepEqual(generation.draws.map((x) => x.draw_index), Array.from({ length: QUICK.draws }, (_, i) => i));
    for (const draw of generation.draws) { assert.equal(draw.status, 'measured'); assert.equal(draw.samples.length, QUICK.samples); }
  }
  assert.ok(result.stdout.includes(SMOKE_LINE), 'AC-14 terminal smoke warning');
  assert.ok(html && html.length, 'AC-14 page nonempty');
  const visible = c.visibleHtml(html);
  assert.ok(visible.includes(SMOKE_LINE), 'AC-14 page smoke warning');
  noClaim(result.stdout + '\n' + result.stderr, 'terminal'); noClaim(visible, 'page');
  for (const value of [inputs.name, inputs.model, r.receipt_hash.slice(0, 12), r.run.date_utc]) {
    assert.ok(visible.includes(words(value)), 'AC-14 page identity ' + value);
  }
  assert.equal((html.match(/<article\b[^>]*data-state="SMOKE"/g) || []).length, 1, 'AC-14 one smoke sheet');
  for (const row of pairs) {
    const draw = row.generation.draws[0], answer = inputs.answers[draw.generation_hash];
    assert.equal(typeof answer, 'string', 'AC-14 first answer retained');
    assert.equal(c.sha256(Buffer.from(answer)), draw.generation_hash, 'AC-14 first answer seal');
    assert.ok(visible.includes(words(answer)), 'AC-14 page shows first answer');
    assert.ok(visible.includes('First look at test task ' + row.id + ':'), 'AC-14 page task identity');
  }
  const expectedCounts = QUICK.draws + ' with the skill, ' + QUICK.draws + ' without; the judge scored each answer ' + QUICK.samples + ' times';
  assert.ok(visible.includes(expectedCounts), 'AC-14 page answer counts');
  for (const score of [r.comparison.with_skill_score, r.comparison.baseline_score]) {
    assert.ok(Number.isFinite(score) && visible.includes(score.toFixed(3)), 'AC-14 page score');
  }
}
function inTemp(dir) { const rel = path.relative(os.tmpdir(), dir); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); }
function assertInvocationPlan(plan) {
  assert.equal(plan.stub, '1', 'AC-11 stub required'); assert.equal(plan.fresh, true, 'AC-11 fresh directories');
  assert.equal(plan.installedVersion, plan.version, 'AC-11 installed version');
  assert.equal(plan.version, require('../../package.json').version, 'AC-11 packed version');
  assert.ok(path.isAbsolute(plan.tarball) && inTemp(plan.tarball), 'AC-11 local temporary tarball');
  assert.ok(inTemp(plan.workDir) && inTemp(plan.cacheDir), 'AC-11 temporary working directory and cache');
  const outside = (dir) => { const rel = path.relative(c.ROOT, dir); return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel); };
  assert.equal(plan.checkout, c.ROOT, 'AC-11 checkout identity');
  assert.ok([plan.workDir, plan.cacheDir, plan.tarball].every(outside), 'AC-11 outside the checkout');
  assert.ok(plan.workDir.includes(' '), 'AC-11 directory with spaces');
  assert.equal(plan.commands.length, 3, 'AC-11 three installer commands');
  for (const command of plan.commands) {
    assert.equal(command.file, 'npx', 'AC-11 real npx');
    assert.deepEqual(command.args.slice(0, 4), ['--yes', '--ignore-scripts', '--package=' + plan.tarball, 'driftproof'], 'AC-11 same packed package');
    assert.equal(command.cwd, plan.workDir, 'AC-11 external cwd');
    assert.equal(command.env.DRIFTPROOF_STUB, '1');
    assert.equal(command.env.ANTHROPIC_BASE_URL, c.CLOSED); assert.equal(command.env.OPENAI_BASE_URL, c.CLOSED + '/v1');
    for (const key of Object.keys(command.env)) assert.doesNotMatch(key, /API_KEY|TOKEN|SECRET|CREDENTIAL/i, 'AC-11 credential');
  }
  assert.equal(plan.commands[0].args.length, 4, 'AC-11 no-argument help');
  assert.equal(plan.commands[1].args[4], 'init');
  assert.equal(plan.commands[2].args[4], 'run');
  assert.equal(plan.commands[1].args[5], plan.commands[2].args[5]);
  assert.ok(plan.commands[2].args.includes('--quick'));
}
function runFirst() {
  c.prepare(); const plant = c.plantArg(['help', 'init', 'quick']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows first run '));
  try {
    const workDir = path.join(root, 'work with spaces'), packDir = path.join(root, 'pack'), cacheDir = path.join(root, 'npm-cache');
    for (const dir of [workDir, packDir, cacheDir]) fs.mkdirSync(dir);
    const env = { ...c.cleanEnv(), npm_config_cache: cacheDir };
    const packed = c.npm('pack', ['--json', '--pack-destination', packDir], { env });
    c.success(packed, 'AC-11 pack');
    const records = JSON.parse(packed.stdout); assert.equal(records.length, 1, 'AC-11 one tarball');
    const record = records[0], version = require('../../package.json').version;
    assert.equal(record.version, version, 'AC-11 pack version');
    const tarball = path.join(packDir, record.filename), manifest = { ...c.readPacked(tarball), tarball, cacheDir };
    const recordFile = path.join(root, 'packed.json'); fs.writeFileSync(recordFile, JSON.stringify(manifest, null, 2) + '\n');
    const prefix = ['--yes', '--ignore-scripts', '--package=' + tarball];
    const verified = c.npx([...prefix, 'node', path.join(__dirname, 'common.cjs'), '--verify-installed', recordFile], { cwd: workDir, env });
    c.success(verified, 'AC-11 verify installed bytes before running');
    const installed = JSON.parse(fs.readFileSync(recordFile, 'utf8')).installed;
    function invoke(args) {
      assert.equal(c.sha256(fs.readFileSync(tarball)), manifest.sha256, 'AC-11 unchanged tarball digest');
      c.assertInstalled(manifest, installed);
      return c.npx([...prefix, 'driftproof', ...args], { cwd: workDir, env });
    }
    const v = invoke(['--version']); c.success(v, 'AC-11 installed --version');
    const skillDir = path.join(workDir, 'fixture-skill');
    // Model selection is from the shipped registry, independently of the receipt.
    const registry = require('../../config/models.json');
    const model = registry.models.find((entry) => entry.provider === 'anthropic' && entry.lifecycle !== 'retired')?.id;
    assert.ok(model, 'AC-14 registered model');
    const args = [[], ['init', 'fixture-skill'], ['run', 'fixture-skill', '--quick', '--keep-transcripts', '--models', model, '--out', 'receipts']];
    const plan = { tarball, version, installedVersion: v.stdout.trim(), stub: process.env.DRIFTPROOF_STUB,
      checkout: c.ROOT, workDir, cacheDir, fresh: true, commands: args.map((argv) => ({ file: 'npx', args: [...prefix, 'driftproof', ...argv], cwd: workDir, env })) };
    assertInvocationPlan(plan);
    const help = invoke(args[0]);
    // Real collection boundary: the mutation preserves execution, poisons only this output.
    if (plant === 'help') help.stdout = '';
    assertHelp(help);
    const init = invoke(args[1]), files = c.textFiles(skillDir);
    if (plant === 'init') delete files['SKILL.md'];
    assertInit(init, files);
    const before = c.snapshot(skillDir), again = invoke(args[1]);
    assertInit(again, c.textFiles(skillDir), { repeat: true }); assertUnchanged(before, c.snapshot(skillDir));
    const skill = loadSkill(skillDir);
    const quick = invoke(args[2]);
    const receiptFiles = fs.readdirSync(path.join(workDir, 'receipts')).filter((file) => file.endsWith('.json'));
    const receipts = receiptFiles.map((file) => JSON.parse(fs.readFileSync(path.join(workDir, 'receipts', file), 'utf8')));
    const view = invoke(['view', 'receipts', '--out', 'view.html']); c.success(view, 'AC-14 view');
    assert.equal(receipts.length, 1, 'AC-14 exactly one receipt');
    const answers = JSON.parse(fs.readFileSync(path.join(workDir, 'transcripts', receipts[0].receipt_hash, 'answers.json'), 'utf8')).answers;
    const inputs = { version, model, name: skill.name, contentHash: skill.contentHash, suiteHash: skill.suite.suiteHash, cases: skill.suite.cases, answers };
    if (plant === 'quick') quick.stdout += '\nHelped\n';
    assertQuick({ result: quick, receipts, html: fs.readFileSync(path.join(workDir, 'view.html'), 'utf8'), inputs });
    assertUnchanged(before, c.snapshot(skillDir)); c.assertInstalled(manifest, installed);
    // The lifecycle-rewrite plant affects only this fresh disposable installation.
    const bin = path.join(installed, 'bin/driftproof'), bytes = fs.readFileSync(bin);
    try { fs.appendFileSync(bin, '\n// lifecycle rewrite plant\n'); assert.throws(() => c.assertInstalled(manifest, installed), /packed bytes/); }
    finally { fs.writeFileSync(bin, bytes); }
    console.log('Windows first run: help, init, quick and view passed; tarball sha256 ' + manifest.sha256 + '; installed-byte plant rejected');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  if (!plant) {
    for (const [name, cause] of [['help', 'AC-12'], ['init', 'AC-13'], ['quick', 'AC-14']]) c.ownMutation(__filename, name, cause);
    console.log('Windows first run: help, init and quick executable-boundary mutations rejected');
  }
}
if (require.main === module) c.main(runFirst);
module.exports = { assertHelp, assertInit, assertUnchanged, assertQuick, assertInvocationPlan, runFirst };
