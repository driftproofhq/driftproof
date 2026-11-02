// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 581: exercise the installed door with an npm layout on PATH. On other
// hosts only the platform and the Windows batch-launch failure are simulated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const DOOR = path.join(ROOT, 'plugin/driftproof/lib/door.mjs');
const PIN = require('../plugin/driftproof/.claude-plugin/plugin.json').version;

function fixture(t, { version = PIN, exit = 0, layout = 'global' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-windows-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const work = path.join(root, 'work & %PLUGIN_SENTINEL% !literal! (space)');
  const bin = path.join(root, 'npm & %PLUGIN_SENTINEL% !literal! (space)', ...(layout === 'local' ? ['node_modules', '.bin'] : []));
  const cli = path.resolve(bin, layout === 'local' ? '../npm/bin/npx-cli.js' : 'node_modules/npm/bin/npx-cli.js');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(path.join(bin, 'npx.cmd'), '@echo off\r\nexit /b 91\r\n');
  const log = path.join(root, 'argv.jsonl');
  fs.writeFileSync(cli, [
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    'fs.appendFileSync(' + JSON.stringify(log) + ', JSON.stringify(args) + "\\n");',
    'if (args[1] === "--version") console.log(' + JSON.stringify(version) + ');',
    'else process.exitCode = ' + exit + ';',
  ].join('\n'));
  const preload = path.join(root, 'platform.cjs');
  fs.writeFileSync(preload, [
    "const cp = require('node:child_process');",
    "const native = cp.spawnSync, windows = process.platform === 'win32';",
    "cp.spawnSync = (file, args, opts) => {",
    "  if (opts && opts.shell) throw new Error('a plugin spawn used a shell');",
    "  if (!windows && (file === 'npx' || /\\.cmd$/i.test(file))) return { status: null, error: { code: 'EINVAL' } };",
    "  return native(file, args, opts);",
    "};",
    "require('node:module').syncBuiltinESMExports();",
    "Object.defineProperty(process, 'platform', { value: 'win32' });",
  ].join('\n'));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|CREDENTIAL|^NODE_|^GIT_|^SPEC|^DRIFTPROOF_|^CLAUDE_|^ANTHROPIC_|^OPENAI_/i.test(key)) continue;
    env[key] = value;
  }
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = bin + path.delimiter + (env[pathKey] || '');
  Object.assign(env, { DRIFTPROOF_STUB: '1', PLUGIN_SENTINEL: 'expanded', GIT_CEILING_DIRECTORIES: root });
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: work, env }).status, 0);
  const skillName = 'skill & %PLUGIN_SENTINEL% !literal! (space)';
  const skill = path.join(work, skillName);
  fs.mkdirSync(path.join(skill, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '# Local skill\n\nBe brief.\n');
  fs.writeFileSync(path.join(skill, 'evals/evals.json'), JSON.stringify({ cases: [{ id: 'one', prompt: 'Q?', rubric: 'R' }] }));
  return {
    root, work, skill, skillName, cli,
    run: args => spawnSync(process.execPath, ['--require', preload, DOOR, ...args], { cwd: work, env, encoding: 'utf8', timeout: 300000 }),
    calls: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [],
  };
}

for (const layout of ['global', 'local']) test('Windows npm ' + layout + ' layout: run preserves argv and the pinned version without a shell', t => {
  const f = fixture(t, { layout });
  const r = f.run(['run', f.skillName, '--models', 'claude-haiku-4-5', '--samples', '2']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.calls(), [
    ['driftproof@' + PIN, '--version'],
    ['driftproof@' + PIN, 'run', fs.realpathSync(f.skill), '--models', 'claude-haiku-4-5', '--samples', '2', '--trusted-skill'],
  ]);
});
test('Windows init, guided start and page fallback use the same runner transport', t => {
  const f = fixture(t);
  const name = 'new & %PLUGIN_SENTINEL% !literal! (space)';
  const init = f.run(['init', name]);
  assert.equal(init.status, 0, init.stderr);
  assert.deepEqual(f.calls()[1], ['driftproof@' + PIN, 'init', path.join(f.work, name)]);
  const start = f.run(['start', f.skillName, '--models', 'claude-haiku-4-5']);
  assert.equal(start.status, 0, start.stderr);
  assert.deepEqual(f.calls().slice(2), [
    ['driftproof@' + PIN, '--version'],
    ['driftproof@' + PIN, 'run', fs.realpathSync(f.skill), '--models', 'claude-haiku-4-5', '--quick', '--trusted-skill'],
    ['driftproof@' + PIN, 'view', 'receipts', '--out', 'driftproof-view.html'],
  ]);
  assert.match(start.stdout, /open that file in a browser/);
});
test('Windows version refusal and runner failure preserve their exit behavior', t => {
  const old = fixture(t, { version: '0.0.1' });
  const refused = old.run(['run', old.skillName]);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /requires driftproof/);
  assert.deepEqual(old.calls(), [['driftproof@' + PIN, '--version']]);
  const bad = fixture(t, { exit: 17 });
  assert.equal(bad.run(['run', bad.skillName, '--models', 'claude-haiku-4-5']).status, 17);
});
test('Windows contract and consent refusals happen before the runner', t => {
  const f = fixture(t);
  for (const name of ['skill;payload', 'skill`payload', 'skill$(payload)']) {
    fs.mkdirSync(path.join(f.work, name));
    const r = f.run(['run', name]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /REFUSED: skill-dir:/);
  }
  const draft = path.join(f.root, 'draft.json');
  fs.copyFileSync(path.join(f.skill, 'evals/evals.json'), draft);
  fs.unlinkSync(path.join(f.skill, 'evals/evals.json'));
  const r = f.run(['start', f.skillName, '--cases', draft]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--confirm-write/);
  assert.deepEqual(f.calls(), []);
});
test('Windows missing npm entry point fails closed before the runner', t => {
  const f = fixture(t);
  fs.unlinkSync(f.cli);
  const r = f.run(['run', f.skillName]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /could not read the runner version/);
  assert.deepEqual(f.calls(), []);
});
