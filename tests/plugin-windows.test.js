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
const BIN = path.join(ROOT, 'bin/driftproof');
const PIN = require('../plugin/driftproof/.claude-plugin/plugin.json').version;
// Spec 777: the door runs inside the runner and spawns this package's bin/driftproof with this Node, so no
// Windows npm lookup remains. Each spawn is routed to the recording cli below, as the argv the door gave it.

// Issue 649 and issue 663: `alias` models a Windows 8.3 short name, and the door's working directory
// is the alias's spelling. On win32 the alias is the temp directory's own: on the hosted runner
// os.tmpdir() sits under C:\Users\RUNNER~1, Node's JavaScript realpath keeps that spelling, and
// fs.realpathSync.native gives the long name. On other hosts the work folder lives under
// `runneradmin`, `RUNNER~1` is a link to it, and the child's fs.realpathSync and process.cwd keep the
// link's spelling, as the two behave on win32. `caseAlias` spells the long name in another case for
// the paths the door resolves from its working directory only, so git's root and the skill differ by
// case alone. The door passes the spelling given (`given`) to the runner and compares long names.
const WIN = process.platform === 'win32';
const TMP = fs.realpathSync(os.tmpdir());
const NO_ALIAS = WIN && fs.realpathSync.native(TMP) === TMP
  ? 'the temp directory ' + TMP + ' has no 8.3 alias on this host, so the alias rows cannot be observed here'
  : false;
const swapCase = (s) => s.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
function fixture(t, { version = PIN, exit = 0, layout = 'global', alias = false, caseAlias = false, platform = 'win32' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-windows-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The folder the alias stands for, the alias, and the long name in another case.
  let longHome = root, shortHome = root, caseHome = root;
  if (alias && WIN) {
    longHome = fs.realpathSync.native(root);
    assert.notEqual(longHome, shortHome, 'the temp directory has an 8.3 alias');
    caseHome = path.join(path.dirname(longHome), swapCase(path.basename(longHome)));
  } else if (alias) {
    longHome = path.join(root, 'runneradmin');
    shortHome = path.join(root, 'RUNNER~1');
    caseHome = path.join(root, 'RunnerAdmin');
    fs.mkdirSync(longHome);
    fs.symlinkSync('runneradmin', shortHome);
    fs.symlinkSync('runneradmin', caseHome);
  }
  const work = path.join(longHome, 'work & %PLUGIN_SENTINEL% !literal! (space)');
  const shortWork = path.join(shortHome, path.basename(work));
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
  const realPlatform = process.platform;
  fs.writeFileSync(preload, [
    "const cp = require('node:child_process');",
    "const native = cp.spawnSync;",
    "cp.spawnSync = (file, args, opts) => {",
    "  if (opts && opts.shell) throw new Error('a plugin spawn used a shell');",
    "  if (file === process.execPath && Array.isArray(args) && String(args[0]).split(require('node:path').sep).slice(-2).join('/') === 'bin/driftproof') return native(process.execPath, [" + JSON.stringify(cli) + ", 'driftproof@' + " + JSON.stringify(PIN) + "].concat(args.slice(1)), opts);",
    "  return native(file, args, opts);",
    "};",
    ...(alias ? [
      "const fs = require('node:fs'), path = require('node:path');",
      'const shortWork = ' + JSON.stringify(shortWork) + ', shortHome = ' + JSON.stringify(shortHome) + ';',
      'const longHome = ' + JSON.stringify(longHome) + ', caseHome = ' + JSON.stringify(caseHome) + ';',
      'const realNative = fs.realpathSync.native;',
      'const long = (p) => { const r = realNative(p); return ' + JSON.stringify(caseAlias) + " && String(p).startsWith(shortHome + path.sep) ? caseHome + r.slice(longHome.length) : r; };",
      // On win32 the system keeps the alias in the working directory and in fs.realpathSync itself;
      // only the case variant is modelled. Elsewhere the link stands in for both.
      ...(WIN ? ['fs.realpathSync.native = long;'] : [
        'fs.realpathSync = Object.assign((p) => path.resolve(String(p)), { native: long });',
        'process.cwd = () => shortWork;',
      ]),
    ] : []),
    "require('node:module').syncBuiltinESMExports();",
    // The platform the door reads. On a Windows host `linux` keeps every spawn as it is (the door
    // spawns no shell) and only turns the door's case folding off, which is what the posix half of
    // the case row observes.
    'Object.defineProperty(process, \'platform\', { value: ' + JSON.stringify(platform) + ' });',
  ].join('\n'));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|CREDENTIAL|^NODE_|^GIT_|^SPEC|^DRIFTPROOF_|^CLAUDE_|^ANTHROPIC_|^OPENAI_/i.test(key)) continue;
    env[key] = value;
  }
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = bin + path.delimiter + (env[pathKey] || '');
  Object.assign(env, { DRIFTPROOF_STUB: '1', PLUGIN_SENTINEL: 'expanded', GIT_CEILING_DIRECTORIES: root, TEMP: root, TMP: root });
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: work, env }).status, 0);
  const skillName = 'skill & %PLUGIN_SENTINEL% !literal! (space)';
  const skill = path.join(work, skillName);
  fs.mkdirSync(path.join(skill, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '# Local skill\n\nBe brief.\n');
  fs.writeFileSync(path.join(skill, 'evals/evals.json'), JSON.stringify({ cases: [{ id: 'one', prompt: 'Q?', rubric: 'R' }] }));
  // The door runs from `cwd`, the alias's spelling when there is one. `given` is the skill as that
  // folder spells it, which is the argument the runner receives (issue 663).
  const cwd = alias ? shortWork : work;
  const given = path.join(cwd, skillName);
  return {
    root, work, skill, skillName, cli, longHome, caseHome, cwd, given,
    run: args => spawnSync(process.execPath, ['--require', preload, BIN, 'door', '--pin', PIN, ...args], { cwd, env, encoding: 'utf8', timeout: 300000 }),
    calls: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [],
  };
}

for (const layout of ['global', 'local']) test('Windows npm ' + layout + ' layout: run preserves argv and the pinned version without a shell', t => {
  const f = fixture(t, { layout });
  const r = f.run(['run', f.skillName, '--models', 'claude-haiku-4-5', '--samples', '2']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.calls(), [
    ['driftproof@' + PIN, '--version'],
    ['driftproof@' + PIN, 'run', f.given, '--models', 'claude-haiku-4-5', '--samples', '2', '--trusted-skill'],
  ]);
});
test('Windows init, guided start and page fallback use the same runner transport', t => {
  const f = fixture(t);
  const name = 'new & %PLUGIN_SENTINEL% !literal! (space)';
  const init = f.run(['init', name]);
  assert.equal(init.status, 0, init.stderr);
  assert.deepEqual(f.calls()[1], ['driftproof@' + PIN, 'init', path.join(f.cwd, name)]);
  const start = f.run(['start', f.skillName, '--models', 'claude-haiku-4-5']);
  assert.equal(start.status, 0, start.stderr);
  assert.deepEqual(f.calls().slice(2), [
    ['driftproof@' + PIN, '--version'],
    ['driftproof@' + PIN, 'run', f.given, '--models', 'claude-haiku-4-5', '--quick', '--trusted-skill'],
    ['driftproof@' + PIN, 'view', path.join(f.cwd, 'receipts'), '--out', path.join(f.cwd, 'driftproof-view.html')],
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
test('Windows: a runner that cannot be started fails closed before any work', t => {
  const f = fixture(t);
  fs.unlinkSync(f.cli);
  const r = f.run(['run', f.skillName]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /could not read the runner version/);
  assert.deepEqual(f.calls(), []);
});
// Issue 649: the containment check compares resolved long paths on both sides. Issue 663: the runner
// receives the spelling given, resolved against the working directory, with no alias, link or case
// rewritten. On win32 these rows run under the temp directory's real alias and skip, by name, on a
// host whose temp directory has none.
test('Windows 8.3 alias: a skill inside the repository runs, and the runner gets the spelling given', { skip: NO_ALIAS }, t => {
  const f = fixture(t, { alias: true });
  const r = f.run(['run', f.skillName, '--models', 'claude-haiku-4-5', '--samples', '2']);
  assert.equal(r.status, 0, r.stderr);
  const long = fs.realpathSync.native(f.given);
  assert.ok(long.startsWith(f.longHome + path.sep), 'the fixture resolves to the long name');
  assert.notEqual(long, f.given, 'the spelling given is an alias of the long name');
  assert.deepEqual(f.calls(), [
    ['driftproof@' + PIN, '--version'],
    ['driftproof@' + PIN, 'run', f.given, '--models', 'claude-haiku-4-5', '--samples', '2', '--trusted-skill'],
  ]);
  assert.match(r.stdout, /resolves inside this repository/);
});
test('Windows 8.3 alias: start, its draft, a tasks file and a receipts folder inside the repository are accepted as spelled', { skip: NO_ALIAS }, t => {
  const f = fixture(t, { alias: true });
  const draft = path.join(f.work, 'draft.json');
  fs.copyFileSync(path.join(f.skill, 'evals/evals.json'), draft);
  const start = f.run(['start', f.skillName, '--models', 'claude-haiku-4-5']);
  assert.equal(start.status, 0, start.stderr);
  assert.equal(f.calls()[1][1], 'run');
  assert.equal(f.calls()[1][2], f.given);
  fs.writeFileSync(path.join(f.work, 'CLAUDE.md'), '# Project rules\n\nBe brief.\n');
  const suite = f.run(['run', 'CLAUDE.md', '--suite', 'draft.json', '--models', 'claude-haiku-4-5']);
  assert.equal(suite.status, 0, suite.stderr);
  const rules = f.calls()[4];
  assert.equal(rules[1], 'run');
  assert.equal(rules[2], path.join(f.cwd, 'CLAUDE.md'));
  assert.equal(rules[rules.indexOf('--suite') + 1], path.join(f.cwd, 'draft.json'));
  // blind hands the runner its argument as typed (issue 623), so the folder is checked by its long
  // name and reaches view under the one spelling given.
  fs.mkdirSync(path.join(f.work, 'receipts'));
  const blind = f.run(['blind', 'receipts']);
  assert.doesNotMatch(blind.stderr, /resolves outside/);
  const view = f.calls().find((v) => v[1] === 'view');
  assert.ok(view, 'blind reached the runner');
  assert.equal(view[2], path.join(f.cwd, 'receipts'));
  assert.match(blind.stdout, new RegExp('resolved receipts-dir=' + path.join(f.cwd, 'receipts').replace(/[.*+?^${}()|[\]\\~&%!]/g, '\\$&')));
});
test('Windows 8.3 alias: a long name that differs only in case is inside on win32 and outside elsewhere', { skip: NO_ALIAS }, t => {
  const win = fixture(t, { alias: true, caseAlias: true });
  const r = win.run(['run', win.skillName, '--models', 'claude-haiku-4-5']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(win.calls()[1][2], win.given);
  const posix = fixture(t, { alias: true, caseAlias: true, platform: 'linux' });
  const refused = posix.run(['run', posix.skillName, '--models', 'claude-haiku-4-5']);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /resolves outside this repository/);
  assert.ok(refused.stderr.includes(posix.caseHome + path.sep), 'the refusal names the resolved long path, in the case it resolved to');
  assert.deepEqual(posix.calls(), []);
});
test('Windows 8.3 alias: a real outside path is still refused before the runner', { skip: NO_ALIAS }, t => {
  const f = fixture(t, { alias: true });
  const outside = path.join(f.root, 'outside', 'far');
  fs.mkdirSync(path.join(outside, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'SKILL.md'), '# Far\n\nBe brief.\n');
  fs.writeFileSync(path.join(outside, 'evals/evals.json'), JSON.stringify({ cases: [{ id: 'one', prompt: 'Q?', rubric: 'R' }] }));
  const r = f.run(['run', outside, '--models', 'claude-haiku-4-5']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /resolves outside this repository \(/);
  assert.deepEqual(f.calls(), []);
  const suite = path.join(f.root, 'outside', 'tasks.json');
  fs.copyFileSync(path.join(f.skill, 'evals/evals.json'), suite);
  fs.writeFileSync(path.join(f.work, 'CLAUDE.md'), '# Project rules\n\nBe brief.\n');
  const held = f.run(['run', 'CLAUDE.md', '--suite', suite, '--models', 'claude-haiku-4-5']);
  assert.equal(held.status, 2, held.stderr);
  assert.match(held.stderr, /the tasks file .* resolves outside this repository/);
  const blind = f.run(['blind', path.join(f.root, 'outside')]);
  assert.equal(blind.status, 2, blind.stderr);
  assert.match(blind.stderr, /receipts-dir: resolves outside this repository/);
  assert.deepEqual(f.calls(), []);
});
