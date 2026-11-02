// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runDoctor, formatDoctor } = require('../lib/doctor');
const { buildSpawnPlan, isolatedEnv, SUDO_BIN, evalUser } = require('../lib/provider');
const { invisibleShown } = require('../lib/names');

const USER = 'doctor-fixture';
const UID = 98765;
const HOME = path.join(os.tmpdir(), 'doctor-caller');
const IDS = ['node', 'ajv', 'eval-user', 'account', 'eval-home', 'environment', 'cli-versions', 'caller-home', 'sudo'];
const FIXES = ['README First run step 1', 'README First run step 1', 'README Isolation step 1', 'README Isolation step 1', 'README Isolation step 1', 'README Isolation step 5', 'README Isolation step 2', 'README Isolation steps 4 and 5', 'README Isolation step 3'];
const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const bad = (stderr = '', status = 1) => ({ status, stdout: '', stderr });
const isEnv = (args) => args.at(-1) === 'env' || (args.at(-2) === 'env' && args.at(-1) === '-0');
// The old reader receives the same observations with its requested newline framing.
// The corrected reader must explicitly request -0 through the shared hop plan.
const envReply = (args, entries) => {
  const separator = args.at(-1) === '-0' ? '\0' : '\n';
  return ok(entries.length ? entries.join(separator) + separator : '');
};

function fixture(overrides = {}) {
  const calls = [];
  const spawn = (file, args, opts) => {
    calls.push({ file, args, opts });
    const answer = overrides.reply && overrides.reply(file, args, opts);
    if (answer !== undefined) return answer;
    if (file === 'id') { assert.deepEqual(args, ['-u', USER]); return ok(`${UID}\n`); }
    assert.equal(file, SUDO_BIN);
    if (args.includes('--version') && args.length === 1) return ok('sudo fixture');
    // The README's step 5 replies: ls exits 2 when it cannot stat "$HOME/.".
    if (args.includes('LC_ALL=C') && args.includes('-d')) return bad("ls: cannot access 'fixture/.': Permission denied", 2);
    if (args.includes('LC_ALL=C')) return bad('ls: cannot open directory: Permission denied');
    if (args.at(-1) === 'true') return args[2] === 'root' ? bad('sudo: not allowed') : ok();
    if (isEnv(args)) return envReply(args, ['HOME=fixture', 'PATH=fixture', 'PWD=fixture', 'SHLVL=1', '_=env']);
    assert.equal(args.at(-1), '--version');
    assert.ok(['claude', 'codex'].includes(args.at(-2)));
    return ok('fixture version\n');
  };
  const options = {
    spawn, platform: 'linux', nodeVersion: '22.0.0', home: HOME,
    passwd: `${USER}:x:${UID}:${UID}::/:/bin/bash\n`,
    stat: (file) => { assert.equal(file, isolatedEnv(USER).HOME); return { uid: UID, mode: 0o40700, isDirectory: () => true }; },
    checkValidator: () => {}, registry: () => ({ models: [{ id: 'gpt-fixture', provider: 'openai' }] }),
    ...overrides.options,
  };
  const previous = process.env.DRIFTPROOF_EVAL_USER;
  process.env.DRIFTPROOF_EVAL_USER = overrides.user || USER;
  try { return { report: runDoctor(options), calls }; }
  finally {
    if (previous === undefined) delete process.env.DRIFTPROOF_EVAL_USER;
    else process.env.DRIFTPROOF_EVAL_USER = previous;
  }
}
const row = (report, id) => report.rows.find((r) => r.id === id);
function red(overrides, id) {
  const { report } = fixture(overrides);
  assert.equal(report.exitCode, 1);
  assert.equal(row(report, id).status, 'fail');
  assert.equal(row(report, id).fix, FIXES[IDS.indexOf(id)]);
  return report;
}

test('AC-1, AC-2, AC-4 all-pass double observes nine checks through bounded spawn and the real hop plan', () => {
  const { report, calls } = fixture();
  assert.equal(report.schema, 'driftproof.doctor/1');
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.rows.map((r) => r.id), IDS);
  assert.deepEqual(report.rows.map((r) => r.fix), FIXES);
  assert.ok(report.rows.every((r) => r.status === 'pass'));
  assert.ok(report.rows.every((r) => Object.keys(r).join(',') === 'id,status,message,fix'));
  for (const call of calls) {
    assert.equal(call.opts.shell, false);
    assert.ok(call.opts.timeout > 0 && call.opts.timeout <= 30000);
    assert.ok(call.opts.maxBuffer > 0 && call.opts.maxBuffer <= 1024 * 1024);
    assert.equal(call.opts.encoding, 'utf8');
  }
  for (const [bin, args] of [['env', ['-0']], ['claude', ['--version']], ['codex', ['--version']]]) {
    const plan = buildSpawnPlan({ bin, args, user: USER });
    const matching = calls.filter((c) => JSON.stringify(c.args) === JSON.stringify(plan.args));
    assert.equal(matching.length, 1);
    assert.equal(matching[0].file, plan.file);
    assert.deepEqual(matching[0].opts.env, {});
  }
  assert.ok(calls.some((c) => JSON.stringify(c.args) === JSON.stringify(['-n', '-u', USER, 'env', 'LC_ALL=C', 'ls', HOME])));
  assert.ok(calls.some((c) => JSON.stringify(c.args) === JSON.stringify(['-n', '-u', USER, 'env', 'LC_ALL=C', 'ls', '-d', `${HOME}/.`])));
  assert.equal(calls.length, 9, 'id, sudo version, three hops, home list and search reads, two sudo boundaries');
});

test('AC-1 Node follows package engines and ajv uses the installed validator by default', () => {
  const minimum = Number(require('../package.json').engines.node.slice(2));
  red({ options: { nodeVersion: `${minimum - 1}.0.0` } }, 'node');
  assert.equal(fixture({ options: { nodeVersion: `${minimum}.0.0`, checkValidator: undefined } }).report.exitCode, 0);
  red({ options: { checkValidator: () => { throw new Error('missing module'); } } }, 'ajv');
});

for (const [name, stat] of [
  ['home 755', { uid: UID, mode: 0o40755, isDirectory: () => true }],
  ['wrong owner', { uid: UID + 1, mode: 0o40700, isDirectory: () => true }],
  ['not a directory', { uid: UID, mode: 0o100700, isDirectory: () => false }],
  ['special mode bits', { uid: UID, mode: 0o44700, isDirectory: () => true }],
]) test(`AC-1 plant: ${name} reads RED`, () => red({ options: { stat: () => stat } }, 'eval-home'));
test('AC-1 unreadable home reads RED without printing error paths', () => {
  const report = red({ options: { stat: () => { throw new Error(HOME); } } }, 'eval-home');
  assert.ok(!JSON.stringify(report).includes(HOME));
});

for (const [label, reply] of [
  ['missing account', () => bad()], ['id unavailable', () => ({ error: { code: 'ENOENT' } })],
  ['root uid', () => ok('0\n')], ['invalid uid', () => ok('not a uid')],
]) test(`AC-2 ${label} reads RED and prevents hops`, () => {
  const overrides = { reply: (file) => file === 'id' ? reply() : undefined };
  red(overrides, 'account');
  assert.ok(fixture(overrides).calls.every((c) => c.file === 'id' || c.args.length === 1));
});

for (const user of ['root', os.userInfo().username, 'bad\u001bname']) {
  test(`AC-2 evalUser refusal is retained: ${invisibleShown(user)}`, () => {
    const report = red({ user }, 'eval-user');
    const prior = process.env.DRIFTPROOF_EVAL_USER;
    process.env.DRIFTPROOF_EVAL_USER = user;
    try {
      let message;
      try { evalUser({ passwd: '' }); } catch (e) { message = invisibleShown(e.message); }
      assert.equal(row(report, 'eval-user').message, message);
    } finally { if (prior === undefined) delete process.env.DRIFTPROOF_EVAL_USER; else process.env.DRIFTPROOF_EVAL_USER = prior; }
    assert.ok(fixture({ user }).calls.every((c) => c.args.length === 1));
  });
}
test('AC-2 passwd uid aliases of root and caller are refused', () => {
  for (const uid of [0, ...(process.getuid ? [process.getuid()] : [])]) {
    red({ options: { passwd: `${USER}:x:${uid}:${uid}::/:/bin/bash` } }, 'eval-user');
  }
});

for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', 'CLAUDE_CONFIG_DIR', 'OTHER_KEY', 'MYTOKEN', 'MY_SECRET_VALUE', 'AWS_REGION', 'GH_HOST', 'GITHUB_ACTION', 'my_secret', 'aws_region', 'gh_host']) {
  test(`AC-3 plant: ${invisibleShown(name)} reads RED; values never print`, () => {
    const sentinel = 'doctor-private-sentinel';
    const report = red({ reply: (_f, a) => isEnv(a) ? envReply(a, ['HOME=x', 'PATH=y', `${name}=${sentinel}`]) : undefined }, 'environment');
    for (const output of [JSON.stringify(report), formatDoctor(report)]) {
      assert.ok(!output.includes(sentinel));
      assert.ok(!output.includes('\u001b'));
    }
    assert.ok(row(report, 'environment').message.includes(invisibleShown(name)));
  });
}
for (const [label, entries] of [
  ['empty', []], ['missing PATH', ['HOME=x']], ['malformed entry', ['HOME=x', 'PATH=y', 'private-malformed-sentinel']],
]) test('AC-3 environment ' + label + ' reads RED', () => {
  const report = red({ reply: (_f, a) => isEnv(a) ? envReply(a, entries) : undefined }, 'environment');
  assert.ok(!JSON.stringify(report).includes('private-malformed-sentinel'));
  assert.ok(!formatDoctor(report).includes('private-malformed-sentinel'));
});
for (const [label, result] of [
  ['failed hop', bad('hostile diagnostic')], ['timeout', { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }],
  ['unterminated output', ok('HOME=x\0PATH=y')],
]) test('AC-3 environment ' + label + ' reads RED', () => red({ reply: (_f, a) => isEnv(a) ? result : undefined }, 'environment'));

// Shape observed by the operator on Amazon Linux, with synthetic values only.
const AMAZON_ENV = [
  ...['HOME', 'PATH', 'HISTCONTROL', 'HISTSIZE', 'HOSTNAME', 'LANG', 'LESSOPEN',
    'LOGNAME', 'MAIL', 'OLDPWD', 'PWD', 'SHLVL', 'SYSTEMD_COLORS', 'S_COLORS',
    'USER', '_', 'which_declare', 'LS_COLORS', 'XDG_DATA_DIRS', 'UNEXPECTED',
    'BAD\u001bNAME'].map((name) => name + '=private-login-sentinel'),
  'BASH_FUNC_which%%=() {\n ( alias; eval "' + '$' + '{which_declare}" ) | /usr/bin/which --read-functions "' + '$' + '@";\n}',
  // Neither apparent entries nor nested function braces in a value are names.
  'BASH_FUNC_example%%=() {\n if true; then { echo private-function-sentinel; }; fi;\n' + ['ANTHROPIC_API_KEY', 'private-body-sentinel'].join('=') + '\n}',
  'MULTILINE=private-value-sentinel\nAWS_REGION=private-continuation-sentinel',
];
test('A-611-1 Amazon Linux multiline exported functions and ordinary login names pass without exposing values', () => {
  const { report, calls } = fixture({ reply: (_f, a) => isEnv(a) ? envReply(a, AMAZON_ENV) : undefined });
  assert.equal(report.exitCode, 0);
  assert.equal(row(report, 'environment').status, 'pass');
  assert.ok(calls.some(c => c.args.at(-2) === 'env' && c.args.at(-1) === '-0'));
  assert.ok(row(report, 'environment').message.includes('BASH_FUNC_which%%'));
  assert.ok(row(report, 'environment').message.includes(invisibleShown('BAD\u001bNAME')));
  for (const output of [JSON.stringify(report), formatDoctor(report)]) {
    assert.ok(!/private-.*sentinel/.test(output));
    assert.ok(!output.includes('ANTHROPIC_API_KEY'));
    assert.ok(!output.includes('AWS_REGION'));
    assert.ok(!output.includes('\u001b'));
  }
});
test('A-611-1 the same Amazon Linux environment plus ANTHROPIC_API_KEY fails without printing its value', () => {
  const report = red({ reply: (_f, a) => isEnv(a) ? envReply(a, [...AMAZON_ENV, ['ANTHROPIC_API_KEY', 'private-key-sentinel'].join('=')]) : undefined }, 'environment');
  assert.ok(row(report, 'environment').message.includes('ANTHROPIC_API_KEY'));
  for (const output of [JSON.stringify(report), formatDoctor(report)]) assert.ok(!/private-.*sentinel/.test(output));
});

test('AC-5 no sudo skips checks 6 to 9', () => {
  const { report, calls } = fixture({ reply: (f) => f === SUDO_BIN ? { error: { code: 'ENOENT' } } : undefined });
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.rows.slice(5).map((r) => r.status), ['skip', 'skip', 'skip', 'skip']);
  assert.ok(report.rows.slice(5).every((r) => /sudo.*not available/i.test(r.message)));
  assert.equal(calls.length, 2);
});
test('AC-5 sudo refusing is RED, not skipped or mistaken for home permission denial', () => {
  const overrides = { reply: (f, a) => f === SUDO_BIN && a.length > 1 ? bad('sudo: Permission denied') : undefined };
  for (const id of ['environment', 'cli-versions', 'caller-home', 'sudo']) red(overrides, id);
});
test('A-611-1 caller root sudo warns separately and leaves the eval sudo row passing with exit 0', () => {
  const { report } = fixture({ reply: (_f, a) => a[2] === 'root' ? ok() : undefined });
  assert.equal(report.exitCode, 0);
  assert.equal(row(report, 'sudo').status, 'pass');
  assert.deepEqual(report.rows.slice(0, 9).map(r => r.id), IDS);
  assert.equal(report.rows.length, 10);
  assert.equal(row(report, 'root-sudo').status, 'warn');
  assert.match(row(report, 'root-sudo').message, /caller.*root.*without a password/);
  assert.equal(row(report, 'root-sudo').fix, FIXES[8]);
  assert.match(formatDoctor(report), /warn root-sudo:/);
  assert.equal(JSON.parse(JSON.stringify(report)).rows.at(-1).status, 'warn');
});
test('A-611-1 an inconclusive root sudo probe warns without failing the eval lane', () => {
  for (const result of [{ status: null, error: { code: 'ETIMEDOUT' } }, bad('cannot check', 2)]) {
    const { report } = fixture({ reply: (_f, a) => a[2] === 'root' ? result : undefined });
    assert.equal(report.exitCode, 0);
    assert.equal(row(report, 'sudo').status, 'pass');
    assert.equal(row(report, 'root-sudo').status, 'warn');
    assert.match(row(report, 'root-sudo').message, /could not check/);
  }
});
test('A-611-1 real failures still exit 1 alongside the caller root warning', () => {
  for (const [failed, reply] of [
    ['sudo', (_f, a) => a[2] === USER && a.at(-1) === 'true' ? bad('sudo refusing') : undefined],
    ['environment', (_f, a) => isEnv(a) ? envReply(a, [...AMAZON_ENV, ['ANTHROPIC_API_KEY', 'private-key-sentinel'].join('=')]) : undefined],
  ]) {
    const report = red({ reply: (f, a) => a[2] === 'root' ? ok() : reply(f, a) }, failed);
    assert.equal(row(report, 'root-sudo').status, 'warn');
    assert.ok(!JSON.stringify(report).includes('private-key-sentinel'));
  }
});
for (const result of [ok('files'), bad('No such file or directory'), bad('sudo: Permission denied'), { status: null, error: { code: 'EACCES' } }]) {
  test('AC-1 caller home requires an ls Permission denied response', () => red({ reply: (_f, a) => a.includes('LC_ALL=C') ? result : undefined }, 'caller-home'));
}
// A-611-2: a home of mode 0711 or 0701, or an ACL granting search without read,
// refuses the listing but lets the eval user open any file whose path it knows.
for (const [label, result] of [
  ['searchable but not listable (0711)', ok(`${HOME}/.\n`)], ['search probe missing', bad('ls: No such file or directory', 2)],
  ['search probe sudo refusal', bad('sudo: a password is required')], ['search probe timeout', { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }],
]) test(`A-611-2 plant: caller home ${label} reads RED without printing the home path`, () => {
  const report = red({ reply: (_f, a) => a.includes('LC_ALL=C') && a.includes('-d') ? result : undefined }, 'caller-home');
  assert.match(row(report, 'caller-home').message, /search/);
  for (const output of [JSON.stringify(report), formatDoctor(report)]) assert.ok(!output.includes(HOME));
});
test('AC-5 missing codex warns only with no registered OpenAI model', () => {
  const reply = (_f, a) => a.at(-2) === 'codex' ? bad('not found', 127) : undefined;
  red({ reply }, 'cli-versions');
  const { report } = fixture({ reply, options: { registry: () => ({ models: [{ id: 'claude-fixture' }] }) } });
  assert.equal(report.exitCode, 0);
  assert.equal(row(report, 'cli-versions').status, 'warn');
  red({ reply, options: { registry: () => ({ models: [{ id: 'gpt-fixture' }] }) } }, 'cli-versions');
  red({ reply, options: { registry: () => { throw new Error('unreadable'); } } }, 'cli-versions');
});
for (const bin of ['claude', 'codex']) {
  for (const result of [bad('not working'), ok(''), { error: { code: 'ETIMEDOUT' }, status: null }]) {
    test(`AC-1 ${bin} must actually answer its version read`, () => red({ reply: (_f, a) => a.at(-2) === bin ? result : undefined }, 'cli-versions'));
  }
}
test('AC-3 child diagnostics and versions never leak into either rendering', () => {
  const secret = 'doctor-private-sentinel';
  for (const reply of [() => { throw new Error(secret); }, (_f, a) => a.at(-2) === 'codex' ? ok(secret) : undefined]) {
    const { report } = fixture({ reply });
    for (const output of [formatDoctor(report), JSON.stringify(report)]) assert.ok(!output.includes(secret));
  }
  const report = fixture().report;
  assert.ok(!formatDoctor(report).includes(HOME));
  assert.ok(!formatDoctor(report).includes(isolatedEnv(USER).HOME));
});

test('AC-5 Windows reports not applicable without any probe', () => {
  const unreachable = () => { assert.fail('Windows probed the machine'); };
  const report = runDoctor({ platform: 'win32', spawn: unreachable, stat: unreachable, checkValidator: unreachable, registry: unreachable });
  assert.equal(report.exitCode, 2);
  assert.match(formatDoctor(report), /the isolated lane is not available on Windows/);
  assert.equal(report.rows.length, 9);
  assert.ok(report.rows.every((r) => r.status === 'skip'));
});
test('AC-6 stable reports and matching text rows', () => {
  const a = fixture().report;
  assert.deepEqual(a, fixture().report);
  assert.deepEqual(Object.keys(a), ['schema', 'rows', 'exitCode']);
  const lines = formatDoctor(a).split('\n');
  assert.equal(lines.length, 9);
  a.rows.forEach((r, i) => { for (const s of [r.id, r.status, r.message, r.fix]) assert.ok(lines[i].includes(s)); });
});

const BIN = path.resolve(__dirname, '../bin/driftproof');
function cli(args, extra = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, DRIFTPROOF_STUB: '1' }, encoding: 'utf8', timeout: 30000, ...extra });
}
for (const args of [['extra'], ['--json', 'out.json'], ['--json=false'], ['--out', 'out.json'], ['--unknown'], ['--json', '--json']]) {
  test(`AC-6 CLI refuses doctor arguments ${args.join(' ')}`, () => {
    const r = cli(['doctor', ...args]);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /doctor/);
  });
}
test('AC-6 CLI dispatch and JSON rendering on Windows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cli-'));
  try {
    const preload = path.join(dir, 'platform.cjs');
    fs.writeFileSync(preload, "Object.defineProperty(process, 'platform', { value: 'win32' });\nrequire('node:child_process').spawnSync = () => { throw new Error('unexpected probe'); };\n");
    for (const json of [false, true]) {
      const r = spawnSync(process.execPath, ['--require', preload, BIN, 'doctor', ...(json ? ['--json'] : [])], { encoding: 'utf8', timeout: 30000, env: { ...process.env, DRIFTPROOF_STUB: '1' } });
      assert.equal(r.status, 2);
      assert.equal(r.stderr, '');
      if (json) assert.deepEqual(JSON.parse(r.stdout), runDoctor({ platform: 'win32' }));
      else assert.equal(r.stdout.trimEnd(), formatDoctor(runDoctor({ platform: 'win32' })));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('AC-6 help and README offer doctor and retain the manual commands', () => {
  assert.match(cli(['--help']).stdout, /driftproof doctor \[--json\]/);
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const first = readme.split('## First run')[1].split('\n## ')[0];
  const isolation = readme.split('### Isolation (the cli surfaces)')[1].split('\n### ')[0];
  assert.match(first, /driftproof doctor/);
  assert.match(isolation, /5\. Check[\s\S]*or run `driftproof doctor`/);
  assert.match(isolation, /credential-shaped variable names[\s\S]*manual check is the stricter one/);
  for (const command of ['claude --version; codex --version', 'env LC_ALL=C ls "$HOME"', 'env LC_ALL=C ls -d "$HOME/."']) assert.ok(isolation.includes(command));
});
