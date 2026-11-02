// SPDX-License-Identifier: Apache-2.0
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const {
  evalUser, evalUserExists, isolatedEnv, buildSpawnPlan, SUDO_BIN, ISOLATED_ENV_ALLOWLIST,
} = require('./provider');
const { invisibleShown } = require('./names');

const CHECKS = [
  ['node', 'README First run step 1'],
  ['ajv', 'README First run step 1'],
  ['eval-user', 'README Isolation step 1'],
  ['account', 'README Isolation step 1'],
  ['eval-home', 'README Isolation step 1'],
  ['environment', 'README Isolation step 5'],
  ['cli-versions', 'README Isolation step 2'],
  ['caller-home', 'README Isolation steps 4 and 5'],
  ['sudo', 'README Isolation step 3'],
];
// Login profiles may add ordinary variables and exported Bash functions.
const CREDENTIAL_NAME = /_KEY$|TOKEN|SECRET|^ANTHROPIC_|^OPENAI_|^CLAUDE_|^AWS_|^GH_|^GITHUB_/i;
const succeeded = (r) => !r.error && !r.signal && r.status === 0;
const denied = (r) => !r.error && !r.signal && r.status === 1;

function checkValidator() {
  // Same resolver as bin/driftproof's checkReceiptValidator, plus module loading.
  require(require('./receipt').resolveReceiptValidator());
}

function runDoctor({
  spawn = cp.spawnSync, platform = process.platform, nodeVersion = process.versions.node,
  home = os.homedir(), passwd, stat = fs.statSync, checkValidator: validator = checkValidator,
  registry = () => require('./models').loadRegistry(),
} = {}) {
  const rows = [];
  const add = (index, status, message, id = CHECKS[index][0]) => rows.push({
    id, status, message: invisibleShown(message), fix: CHECKS[index][1],
  });
  const finish = (exitCode = rows.some((r) => r.status === 'fail') ? 1 : 0) => ({
    schema: 'driftproof.doctor/1', rows, exitCode,
  });
  if (platform === 'win32') {
    CHECKS.forEach((_c, i) => add(i, 'skip', 'the isolated lane is not available on Windows'));
    return finish(2);
  }

  // Every process, including evalUserExists, passes through this bounded seam.
  // Never return a child's diagnostic or output value to the renderer.
  const run = (file, args, options = {}) => {
    try {
      return spawn(file, args, {
        ...options, encoding: 'utf8', shell: false, timeout: 30000,
        killSignal: 'SIGTERM', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      }) || { error: { code: 'NO_RESULT' } };
    } catch (_e) { return { error: { code: 'SPAWN_FAILED' } }; }
  };
  const engines = require('../package.json').engines.node;
  const minimum = /^>=(\d+)$/.exec(engines);
  const major = /^(\d+)\./.exec(nodeVersion);
  const nodeOk = !!minimum && !!major && Number(major[1]) >= Number(minimum[1]);
  add(0, nodeOk ? 'pass' : 'fail', `Node ${engines} ${nodeOk ? 'available' : 'required'}`);
  try { validator(); add(1, 'pass', 'ajv loads'); }
  catch (_e) { add(1, 'fail', 'ajv cannot load; reinstall the package dependencies'); }

  let user;
  try {
    user = evalUser(passwd === undefined ? {} : { passwd });
    add(2, 'pass', `eval user ${user} is a dedicated account name`);
  } catch (e) {
    add(2, 'fail', e.message);
  }
  let uid;
  let accountOk = false;
  if (user) {
    const exists = evalUserExists(user, { spawn: (file, args, options) => {
      const r = run(file, args, options);
      const value = String(r.stdout || '').trim();
      if (succeeded(r) && /^\d+$/.test(value)) uid = Number(value);
      return r;
    } });
    accountOk = exists === true && Number.isSafeInteger(uid) && uid > 0
      && !(typeof process.getuid === 'function' && uid === process.getuid());
    add(3, accountOk ? 'pass' : 'fail', accountOk ? `account ${user} exists` :
      exists === false ? `account ${user} does not exist` : 'cannot verify a dedicated unprivileged account uid');
  } else add(3, 'skip', 'eval user is invalid');

  if (accountOk) {
    try {
      const info = stat(isolatedEnv(user).HOME);
      const valid = info.isDirectory() && info.uid === uid && (info.mode & 0o7777) === 0o700;
      add(4, valid ? 'pass' : 'fail', valid ? `~ for ${user} is owned by it and mode 700` : `~ for ${user} must be a directory owned by it with mode 700`);
    } catch (_e) { add(4, 'fail', `cannot inspect ~ for ${user}; check its ownership and mode 700`); }
  } else add(4, 'skip', 'eval account could not be verified');

  const sudo = run(SUDO_BIN, ['--version'], { env: {} });
  if (sudo.error && sudo.error.code === 'ENOENT') {
    for (let i = 5; i < CHECKS.length; i++) add(i, 'skip', 'sudo is not available; install sudo before checking the hop');
    return finish();
  }
  if (!accountOk) {
    for (let i = 5; i < CHECKS.length; i++) add(i, 'skip', 'eval account could not be verified');
    return finish();
  }
  const hop = (bin, args) => {
    const plan = buildSpawnPlan({ bin, args, user });
    return run(plan.file, plan.args, { env: plan.env });
  };
  const environment = hop('env', ['-0']);
  if (!succeeded(environment)) add(5, 'fail', 'the isolated environment hop failed');
  else {
    const names = [];
    const output = String(environment.stdout || '');
    // env -0 preserves entry boundaries even when a value is a multiline Bash
    // function or contains text resembling another environment assignment.
    const terminated = output.endsWith('\0');
    let malformed = !terminated;
    for (const entry of terminated ? output.slice(0, -1).split('\0') : []) {
      const equals = entry.indexOf('=');
      if (equals <= 0) { malformed = true; continue; }
      names.push(entry.slice(0, equals));
    }
    const unexpected = names.filter((name) => CREDENTIAL_NAME.test(name));
    const missing = ISOLATED_ENV_ALLOWLIST.filter((name) => !names.includes(name));
    const valid = !malformed && !unexpected.length && !missing.length;
    // Show only names. Never echo values or malformed entries.
    add(5, valid ? 'pass' : 'fail', [
      valid ? 'environment names' : 'unexpected or incomplete environment names',
      [...new Set(names)].sort().join(', ') || '(none)',
      ...(missing.length ? [`missing ${missing.join(', ')}`] : []),
      ...(malformed ? ['malformed environment output'] : []),
    ].join(': '));
  }

  const claude = hop('claude', ['--version']);
  const codex = hop('codex', ['--version']);
  const answered = (r) => succeeded(r) && String(r.stdout || '').trim().length > 0;
  let optionalCodex = false;
  if (!codex.error && !codex.signal && codex.status === 127) {
    try {
      const models = registry().models;
      optionalCodex = Array.isArray(models) && !models.some((m) =>
        (m.provider || require('./models').inferProviderFromId(m.id)) === 'openai');
    } catch (_e) { /* An unreadable registry cannot justify an optional CLI. */ }
  }
  add(6, !answered(claude) || (!answered(codex) && !optionalCodex) ? 'fail' : optionalCodex ? 'warn' : 'pass',
    `claude --version ${answered(claude) ? 'answered' : 'failed'}; codex --version ${answered(codex) ? 'answered' : optionalCodex ? 'missing (no OpenAI model registered)' : 'failed'}; version replies do not check login`);

  // README step 5 reads both: a home of mode 0711, or an ACL granting search
  // without read, refuses the listing but still opens files by known path.
  const lsDenied = (args) => {
    const caller = run(SUDO_BIN, ['-n', '-u', user, 'env', 'LC_ALL=C', 'ls', ...args], { env: {} });
    const closed = denied(caller) || (!caller.error && !caller.signal && caller.status === 2);
    return closed && /^ls:.*Permission denied\s*$/m.test(String(caller.stderr || ''))
      && !/^sudo:/m.test(String(caller.stderr || ''));
  };
  // Concatenated, not path.join, which would drop the trailing dot.
  const listDenied = lsDenied([home]);
  const searchDenied = lsDenied(['-d', `${home}/.`]);
  const open = [...(listDenied ? [] : ['lists']), ...(searchDenied ? [] : ['searches'])];
  add(7, open.length ? 'fail' : 'pass', open.length ? `could not confirm Permission denied when the eval user ${open.join(' and ')} ~` : '~ cannot be listed or searched by the eval user (Permission denied)');

  const evalTrue = run(SUDO_BIN, ['-n', '-u', user, 'true'], { env: {} });
  const rootTrue = run(SUDO_BIN, ['-n', '-u', 'root', 'true'], { env: {} });
  const sudoOk = succeeded(evalTrue);
  add(8, sudoOk ? 'pass' : 'fail', `sudo as ${user} ${sudoOk ? 'succeeded' : 'failed'}`);
  if (succeeded(rootTrue)) {
    add(8, 'warn', 'caller can also become root without a password', 'root-sudo');
  } else if (!denied(rootTrue)) {
    add(8, 'warn', 'could not check whether caller can become root without a password', 'root-sudo');
  }
  return finish();
}

function formatDoctor(report) {
  return report.rows.map((r) => `${r.status} ${r.id}: ${r.message} (${r.fix})`).join('\n');
}

module.exports = { runDoctor, formatDoctor };
