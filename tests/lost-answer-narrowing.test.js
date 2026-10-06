// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 141 (AC-1 to AC-6, AC-8): the tools each capture mode leaves on, the files
// collector's reasons, an empty reply in files capture, and the narrowed lost-answer reading.
//
//   node --test tests/lost-answer-narrowing.test.js
//
// No model and no CLI is called. THE MODEL DOUBLE is spec 137's: child_process.spawn replaced on the
// module object lib/provider.js calls, recording each call and answering in the CLI's JSON shape (a
// judge prompt with a fixed score, a generation with the reply the test planted). In files capture
// it plays the CLI's side of the workspace: through the hop it prints the frame the wrapper would;
// on the trusted path it writes the files into the directory it was started in. spawnSync answers
// `--version` for the harness read and refuses every other call; the tests that run the hop's own
// wrapper for real under bash in AC-2 use the real function, kept as realSpawnSync, themselves.
//
// THE ORACLE FOR AC-1 is each surface's own tool list, recorded by the spec's
// probes/tool-lists.mjs into specs/141-lost-answer-narrowing/fixtures/cli-tool-lists.json, and the
// class of each name in fixtures/tool-classes.json, read from DRIFTPROOF_ARTIFACT_ROOT (default:
// this checkout), never from lib/. AC-6 reads the tracked transcripts and the spec's shape corpus
// from there too, so a gate can run these tests over a copy of the package.
//
// Every test name starts with the criterion it checks; spec 141's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const ARTIFACT_ROOT = process.env.DRIFTPROOF_ARTIFACT_ROOT || path.join(__dirname, '..');
const SPEC = path.join(ARTIFACT_ROOT, 'specs', '141-lost-answer-narrowing');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const NONCE = 'b'.repeat(32);
const tmp = (tag) => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `spec141-${tag}-`));

// ── the double ──────────────────────────────────────────────────────────────────────────────────
const calls = [];
let generate = () => 'ok';
let leave = () => [];
const JUDGE = /Return ONLY this JSON object/;
const cliJson = (result) => JSON.stringify({ type: 'result', result, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
const b64 = (s) => Buffer.from(s).toString('base64');
cp.spawn = (file, args, options) => {
  const call = { file, args: [...args], cwd: (options && options.cwd) || null, input: '' };
  calls.push(call);
  const c = new EventEmitter();
  c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => true;
  c.stdin = {
    write(d) { call.input += d; },
    on() {},
    end() {
      setImmediate(() => {
        const judge = JUDGE.test(call.input);
        call.judge = judge;
        const isCodex = call.args.includes('codex');
        let out = judge ? cliJson(JSON.stringify({ score: 0.8, pass: true, reason: 'double' }))
          : isCodex ? `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: generate(call) } })}\n${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })}\n`
            : cliJson(generate(call));
        const files = judge ? [] : leave(call);
        const wrapper = call.args.find((a) => / WORKSPACE/.test(a));
        if (wrapper) {
          const n = /WORKSPACE\\n' ([0-9a-f]{32})/.exec(wrapper)[1];
          out += `\n${n} WORKSPACE\n${files.map(([p, t]) => `${n} FILE ${b64(p)} ${Buffer.byteLength(t)}\n${b64(t)}\n`).join('')}${n} END\n`;
        } else if (call.cwd) {
          for (const [p, t, mode] of files) {
            const at = path.join(call.cwd, p);
            fs.mkdirSync(path.dirname(at), { recursive: true });
            fs.writeFileSync(at, t);
            if (mode != null) fs.chmodSync(at, mode);
          }
        }
        c.stdout.end(out); c.stderr.end();
        setImmediate(() => c.emit('close', 0, null));
      });
    },
  };
  return c;
};
const realSpawnSync = cp.spawnSync;
cp.spawnSync = (file, args) => {
  if ((args || []).includes('--version')) {
    const all = [file, ...args];
    const bin = all[all.lastIndexOf('--version') - 1];
    return { status: 0, stdout: bin === 'codex' ? 'codex-cli 0.146.0\n' : '2.1.285 (Claude Code)\n', stderr: '' };
  }
  // Nothing under test starts another process synchronously, so a call that is not the version read is
  // a fault in the test, and it is not forwarded to a real process (CodeQL js/command-line-injection).
  throw new Error(`the double answers --version only; spawnSync was called for ${String(file)}`);
};

delete process.env.DRIFTPROOF_STUB;
delete process.env.DRIFTPROOF_EVAL_USER;
process.env.CLAUDE_PROVIDER = 'cli';
process.env.OPENAI_SURFACE = 'cli';
const capture = require('../lib/capture');
const provider = require('../lib/provider');
const { runSkillOnModel } = require('../lib/run');
const { regradeReceipt } = require('../lib/regrade');
const { validateReceipt } = require('../lib/receipt');

const SYS = '---\nname: fx\n---\nAnswer the task.';
const reset = () => { calls.length = 0; generate = () => 'ok'; leave = () => []; };
const afterLabel = (c) => (c.args.includes(provider.HOP_LABEL) ? c.args.slice(c.args.indexOf(provider.HOP_LABEL) + 1) : [c.file, ...c.args]);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function skillOf() {
  const cases = [{ id: 'task-1', prompt: 'Do the task.', rubric: 'A complete answer.', pass_threshold: 0.7 }];
  return { name: 'fx-141', version: '1.0.0', contentHash: sha(SYS), skillMd: SYS, suite: { format: 'agentskills.io/evals', suiteHash: sha(JSON.stringify(cases)), caseCount: cases.length, cases } };
}
const armOf = (receipt, mode) => receipt.results.cases.find((c) => c.mode === mode);
const withSkill = (call) => call.args.includes('--append-system-prompt');
const drawsOf = (receipt) => receipt.results.cases.flatMap((c) => c.generation.draws);

// ── AC-1: the tools each mode leaves on, against each surface's own list ──────────────────────────

const LISTS = readJson(path.join(SPEC, 'fixtures', 'cli-tool-lists.json'));
const CLASSES = readJson(path.join(SPEC, 'fixtures', 'tool-classes.json'));
// The tools claude's own --help names as running commands or code, read from its --restricted text:
// the names inside "(... and the other code-running tools)".
function helpCodeRunners() {
  const m = /tools that run commands or code \(([^)]*)\)/.exec(LISTS.claude.help_restricted);
  if (!m) return [];
  return m[1].split(/,|\band\b/).map((s) => s.trim()).filter((s) => /^[A-Z][A-Za-z]*$/.test(s));
}
const writesOrRuns = (surface) => Object.entries(CLASSES[surface]).filter(([, v]) => v.class === 'write' || v.class === 'exec').map(([k]) => k);
// The claude tools a child has, read off its argv: --tools names the set when given, else every
// listed tool less --disallowedTools. MCP servers load unless --strict-mcp-config with no --mcp-config.
function claudeOn(argv) {
  const listed = [...LISTS.claude.init_tools, ...helpCodeRunners()];
  const val = (flag) => { const i = argv.indexOf(flag); return i < 0 ? null : String(argv[i + 1]).split(/[,\s]+/).filter(Boolean); };
  const tools = val('--tools');
  const on = tools ? (tools.includes('default') ? listed : tools) : listed.filter((t) => !(val('--disallowedTools') || []).includes(t));
  return { on, mcp: !(argv.includes('--strict-mcp-config') && !argv.includes('--mcp-config')) };
}
// The codex features a child has off, read off its argv's -c and --disable/--enable pairs, last wins.
function codexOff(argv) {
  const state = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i] === '-c' ? /^features\.([\w-]+)=(true|false)$/.exec(String(argv[i + 1])) : null;
    if (m) state[m[1]] = m[2] === 'false';
    if (argv[i] === '--disable') state[argv[i + 1]] = true;
    if (argv[i] === '--enable') state[argv[i + 1]] = false;
  }
  return { off: Object.keys(state).filter((k) => state[k]), mcpOff: argv.some((a, i) => argv[i - 1] === '-c' && /^mcp_servers\s*=\s*\{\s*\}$/.test(a)) };
}

test('AC-1 every name in each surface\'s recorded tool list carries a class, and claude\'s help names its code-running tools', () => {
  assert.ok(LISTS.claude.init_tools.length >= 10 && LISTS.codex.features.length >= 10, 'the recorded lists are not there');
  const unclassed = [...LISTS.claude.init_tools.filter((t) => !CLASSES.claude[t]).map((t) => `claude ${t}`), ...LISTS.codex.features.filter((f) => !CLASSES.codex[f.name]).map((f) => `codex ${f.name}`)];
  assert.deepEqual(unclassed, []);
  const runners = helpCodeRunners();
  for (const t of ['Bash', 'PowerShell', 'REPL']) assert.ok(runners.includes(t), `claude --help does not name ${t}: ${runners.join(', ')}`);
});

// A-141-1 (F-8): a name classed none says why, in its own words or its group's, so R-2's fail-safe
// can be audited. A reason shared by several names is shared only by names codex's own list records
// as removed.
test('AC-1 every codex name classed none carries its own reason, or the reason of its recorded removed group', () => {
  const stage = Object.fromEntries(LISTS.codex.features.map((f) => [f.name, f.stage]));
  const none = Object.entries(CLASSES.codex).filter(([, v]) => v.class === 'none');
  assert.deepEqual(none.filter(([, v]) => !v.why || /^not a tool that writes a file or runs code$/.test(v.why)).map(([k]) => k), []);
  const by = {};
  for (const [k, v] of none) (by[v.why] = by[v.why] || []).push(k);
  const shared = Object.values(by).filter((ks) => ks.length > 1);
  assert.deepEqual(shared.flat().filter((k) => stage[k] !== 'removed'), [], 'a reason shared by names codex does not record as removed');
  // A default-on name codex's list does not describe is classed fail-safe: these five were the
  // pre-review's examples (F-8).
  for (const k of ['goals', 'tool_suggest', 'shell_snapshot']) assert.ok(['write', 'exec'].includes(CLASSES.codex[k].class), `${k} is not fail-safe`);
  for (const k of ['auth_elicitation', 'tool_call_mcp_elicitation']) assert.match(CLASSES.codex[k].why, /mcp_servers=\{\}/, `${k} does not say why it is none`);
});

test('AC-1 claude-cli text capture: no tool the surface lists as writing or running code is on, no MCP server, through the hop and trusted', async () => {
  const banned = [...writesOrRuns('claude'), ...helpCodeRunners()];
  for (const trusted of [false, true]) {
    reset();
    await provider.complete({ system: SYS, prompt: 'p', model: 'haiku', timeoutMs: 5000, trusted });
    const argv = afterLabel(calls[0]);
    assert.equal(argv[0], 'claude');
    const { on, mcp } = claudeOn(argv);
    assert.deepEqual(on.filter((t) => banned.includes(t)), [], `trusted=${trusted}: on ${on.join(',')}`);
    assert.ok(on.length > 0 && on.every((t) => (CLASSES.claude[t] || {}).class === 'read'), `trusted=${trusted}: a text-capture tool that is not a reader: ${on.join(',')}`);
    assert.equal(mcp, false, `trusted=${trusted}: MCP servers load`);
    assert.equal(argv[argv.length - 1], SYS, 'the SKILL.md is not the last argument');
    assert.equal(argv[argv.length - 2], '--append-system-prompt');
  }
});

test('AC-1 openai-cli text capture: every codex feature classed write or exec is off, the sandbox is read-only, and no MCP server', async () => {
  reset();
  await provider.complete({ system: SYS, prompt: 'p', model: 'gpt-5.6-sol', timeoutMs: 5000 });
  const argv = afterLabel(calls[0]);
  assert.equal(argv[0], 'codex');
  assert.equal(argv[argv.indexOf('-s') + 1], 'read-only');
  const { off, mcpOff } = codexOff(argv);
  const left = writesOrRuns('codex').filter((f) => !off.includes(f));
  assert.deepEqual(left, [], `codex features left on: ${left.join(', ')}`);
  assert.equal(mcpOff, true, 'codex MCP servers load');
  assert.equal(argv[argv.length - 1], '-');
});

test('AC-1 claude-cli files capture: the file tools are on and no tool that runs code', async () => {
  const runners = [...Object.entries(CLASSES.claude).filter(([, v]) => v.class === 'exec').map(([k]) => k), ...helpCodeRunners()];
  for (const trusted of [false, true]) {
    reset();
    await provider.complete({ system: SYS, prompt: 'p', model: 'haiku', timeoutMs: 5000, trusted, capture: 'files' });
    const argv = afterLabel(calls[0]);
    const { on, mcp } = claudeOn(argv);
    assert.ok(on.includes('Write') && on.includes('Edit'), `trusted=${trusted}: no file tool: ${on.join(',')}`);
    assert.deepEqual(on.filter((t) => runners.includes(t)), [], `trusted=${trusted}`);
    assert.equal(mcp, false, `trusted=${trusted}: MCP servers load`);
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'acceptEdits');
  }
});

// ── AC-2: the collectors name every file, each with its own reason ────────────────────────────────

const { files: CAP_FILES, fileBytes: CAP_BYTES } = capture.WORKSPACE_LIMITS;
const SMALL = 48; // with the five planted below: 53 files, three past the count cap
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
function plantWorkspace(dir) {
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'a.md'), '# A\n\nThe answer.\n');
  fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0x41, 0, 0x42]));
  fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(CAP_BYTES + 1));
  fs.writeFileSync(path.join(dir, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  fs.writeFileSync(path.join(dir, 'locked.txt'), 'secret\n');
  fs.chmodSync(path.join(dir, 'locked.txt'), 0o000);
  for (let i = 0; i < SMALL; i++) fs.writeFileSync(path.join(dir, `z${String(i).padStart(3, '0')}.txt`), `${i}\n`);
}
const strip = (list) => list.map((f) => ({ path: f.path, bytes: f.bytes, included: f.included, why: f.why || null }));
function checkReasons(list, who) {
  const by = Object.fromEntries(list.map((f) => [f.path, f]));
  assert.equal(list.length, 5 + SMALL, `${who}: every file is named`);
  assert.equal(by['docs/a.md'].included, true, who);
  assert.equal(by['big.txt'].included, false, who);
  assert.match(by['big.txt'].why, new RegExp(`^truncated: ${CAP_BYTES + 1} bytes, over the ${CAP_BYTES}-byte file cap`), who);
  assert.equal(by['b.bin'].why, 'not text: binary (holds a NUL byte)', who);
  assert.equal(by['latin1.txt'].why, 'not text: not valid UTF-8', who);
  if (!asRoot) assert.equal(by['locked.txt'].why, 'unreadable: permission denied', who);
  const past = list.slice(CAP_FILES);
  assert.equal(past.length, 5 + SMALL - CAP_FILES, who);
  for (const f of past) assert.match(f.why, new RegExp(`^over the ${CAP_FILES}-file cap`), `${who}: ${f.path}`);
  for (const f of list) if (!f.included) assert.ok(f.why && f.why.length > 0, `${who}: ${f.path} has no reason`);
}

test('AC-2 the trusted collector names every file, each one not included with its own reason', () => {
  const dir = tmp('ws');
  try {
    plantWorkspace(dir);
    checkReasons(capture.collectWorkspace(dir), 'trusted');
  } finally { fs.chmodSync(path.join(dir, 'locked.txt'), 0o600); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('AC-2 the hop\'s collector, run for real, names the same files with the same reasons', { skip: realSpawnSync('bash', ['-c', 'command -v setsid && command -v base64 && command -v stat'], { encoding: 'utf8' }).status !== 0 && 'setsid, base64 or stat is not on this box' }, () => {
  const script = [
    'mkdir -p docs', 'printf "# A\\n\\nThe answer.\\n" > docs/a.md', 'printf "A\\000B" > b.bin',
    `head -c ${CAP_BYTES + 1} /dev/zero | tr "\\000" x > big.txt`, 'printf "caf\\351\\n" > latin1.txt',
    'printf "secret\\n" > locked.txt', 'chmod 000 locked.txt',
    `i=0; while [ $i -lt ${SMALL} ]; do printf "%d\\n" $i > "z$(printf %03d $i).txt"; i=$((i+1)); done`,
    'printf "{\\"type\\":\\"result\\",\\"result\\":\\"done\\"}"',
  ].join('; ');
  const r = realSpawnSync('bash', ['-c', provider.filesWrapper(NONCE), provider.HOP_LABEL, 'sh', '-c', script], { encoding: 'utf8', input: '', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || os.tmpdir() } });
  assert.equal(r.status, 0, r.stderr);
  const w = capture.parseWorkspace(r.stdout, NONCE);
  assert.ok(Array.isArray(w.files), 'the frame was not read');
  checkReasons(w.files, 'hop');
  const dir = tmp('ws2');
  try {
    plantWorkspace(dir);
    assert.deepEqual(strip(w.files), strip(capture.collectWorkspace(dir)));
  } finally { fs.chmodSync(path.join(dir, 'locked.txt'), 0o600); fs.rmSync(dir, { recursive: true, force: true }); }
});

// A-141-1 (F-5): a directory the collector may not list or enter is named, its path ending in "/",
// with the permission reason, by both collectors alike. The wrapper's rm cannot remove such a
// directory, so the planted CLI prints its working directory and the test removes that one.
test('AC-2 a directory the collector cannot read is named with its reason, by the trusted collector and by the hop\'s', { skip: asRoot && 'root reads every directory' }, () => {
  const want = [
    { path: 'keep/a.md', bytes: 2, included: true, why: null },
    { path: 'noexec/', bytes: 0, included: false, why: 'unreadable: permission denied' },
    { path: 'out.md', bytes: 3, included: true, why: null },
    { path: 'out/', bytes: 0, included: false, why: 'unreadable: permission denied' },
  ];
  const dir = tmp('dirs');
  let hopDir = null;
  const open = (root) => realSpawnSync('chmod', ['-R', 'u+rwX', root]);
  try {
    for (const d of ['out', 'keep', 'noexec']) fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, 'out', 'answer.md'), 'hi');
    fs.writeFileSync(path.join(dir, 'keep', 'a.md'), 'ok');
    fs.writeFileSync(path.join(dir, 'noexec', 'b.md'), 'x');
    fs.writeFileSync(path.join(dir, 'out.md'), 'top');
    fs.chmodSync(path.join(dir, 'out'), 0o000);
    fs.chmodSync(path.join(dir, 'noexec'), 0o600);
    assert.deepEqual(strip(capture.collectWorkspace(dir)), want, 'trusted');
    const script = 'mkdir -p out keep noexec; printf hi > out/answer.md; printf ok > keep/a.md; printf x > noexec/b.md; printf top > out.md; chmod 000 out; chmod 600 noexec; pwd >&2; printf "{\\"type\\":\\"result\\",\\"result\\":\\"\\"}"';
    const r = realSpawnSync('bash', ['-c', provider.filesWrapper(NONCE), provider.HOP_LABEL, 'sh', '-c', script], { encoding: 'utf8', input: '', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || os.tmpdir() } });
    hopDir = (/^\/\S*\/driftproof-eval\.[A-Za-z0-9]+$/m.exec(r.stderr) || [null])[0];
    const w = capture.parseWorkspace(r.stdout, NONCE);
    assert.ok(Array.isArray(w.files), 'the frame was not read');
    assert.deepEqual(strip(w.files), want, 'hop');
  } finally {
    open(dir); fs.rmSync(dir, { recursive: true, force: true });
    if (hopDir && fs.existsSync(hopDir)) { open(hopDir); fs.rmSync(hopDir, { recursive: true, force: true }); }
  }
});

test('AC-2 a hop frame line without the unreadable field reads as before, and P and U read as unreadable', () => {
  const frame = (lines) => `{"result":"x"}\n${NONCE} WORKSPACE\n${lines}${NONCE} END\n`;
  assert.deepEqual(capture.parseWorkspace(frame(`${NONCE} FILE ${b64('a.md')} 2\n${b64('hi')}\n`), NONCE).files, [{ path: 'a.md', bytes: 2, included: true, content: 'hi' }]);
  const p = capture.parseWorkspace(frame(`${NONCE} FILE ${b64('a.md')} 2 P\n\n${NONCE} FILE ${b64('b.md')} 3 U\n\n`), NONCE).files;
  assert.deepEqual(strip(p), [{ path: 'a.md', bytes: 2, included: false, why: 'unreadable: permission denied' }, { path: 'b.md', bytes: 3, included: false, why: 'unreadable: read error' }]);
  assert.equal(capture.parseWorkspace(frame(`${NONCE} FILE ${b64('a.md')} 2 X\n\n`), NONCE).files, null);
});

test('AC-2 the judged answer and the draw\'s captured_files name every file the collector named', async () => {
  reset();
  generate = () => 'The answer is in answer.md.';
  leave = () => [['answer.md', '# Answer\n\nUse Postgres.\n'], ['big.log', 'y'.repeat(CAP_BYTES + 5)], ['locked.md', 'no\n', 0o000]];
  const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true, capture: 'files' } });
  const d = drawsOf(receipt).find((x) => x.status === 'measured');
  assert.ok(d, 'no draw was judged');
  assert.deepEqual(d.captured_files.map((f) => f.path), ['answer.md', 'big.log', 'locked.md']);
  const judged = calls.filter((c) => c.judge);
  assert.ok(judged.length >= 1);
  for (const c of judged) {
    assert.match(c.input, /Use Postgres\./);
    assert.match(c.input, new RegExp(`--- file: big\\.log \\(${CAP_BYTES + 5} bytes, not included: truncated: ${CAP_BYTES + 5} bytes, over the ${CAP_BYTES}-byte file cap`));
    if (!asRoot) assert.match(c.input, /--- file: locked\.md \(3 bytes, not included: unreadable: permission denied\) ---/);
  }
  assert.ok(validateReceipt(receipt).valid, JSON.stringify(validateReceipt(receipt).errors));
});

// ── AC-3: an empty reply in files capture is graded on the file ───────────────────────────────────

const FILE = '# ADR 1\n\nContext: we need a database.\n\nDecision: Postgres.\n';
test('AC-3 an empty reply with the answer in a file is judged on the file, through the hop and trusted', async () => {
  for (const trusted of [false, true]) {
    reset();
    generate = () => '';
    leave = () => [['adr.md', FILE]];
    const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted, capture: 'files' } });
    const draws = drawsOf(receipt);
    assert.ok(draws.length >= 2 && draws.every((d) => d.status === 'measured'), `trusted=${trusted}: ${JSON.stringify(draws.map((d) => d.reason || d.status))}`);
    assert.deepEqual(draws[0].captured_files, [{ path: 'adr.md', bytes: Buffer.byteLength(FILE), included: true }]);
    const judged = calls.filter((c) => c.judge);
    assert.ok(judged.length >= 2 && judged.every((c) => c.input.includes('Decision: Postgres.')), `trusted=${trusted}: the judge did not see the file`);
  }
});

test('AC-3 a reply that only points at the file it left is judged with the file', async () => {
  reset();
  generate = () => 'I wrote the ADR to adr.md.';
  leave = () => [['adr.md', FILE]];
  const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true, capture: 'files' } });
  assert.ok(drawsOf(receipt).every((d) => d.status === 'measured'));
  assert.ok(calls.filter((c) => c.judge).every((c) => c.input.includes('Decision: Postgres.')));
});

// A-141-1 (F-3): the files the collector named stay on the draw, in captured_files, and the reason
// it had at the Base gains their names and reasons (R-11: words only).
const EMPTY = 'empty generation (the surface returned no text)';
test('AC-3 an empty reply with no file the judge could be shown is lost as at the Base, never judged, and keeps the files it named', async () => {
  const huge = `; the workspace held no file the judge could be shown (huge.md: truncated: ${CAP_BYTES + 1} bytes, over the ${CAP_BYTES}-byte file cap; not shown)`;
  for (const [files, reason, named] of [[[], EMPTY, undefined], [[['huge.md', 'z'.repeat(CAP_BYTES + 1)]], `${EMPTY}${huge}`, [{ path: 'huge.md', bytes: CAP_BYTES + 1, included: false }]]]) {
    reset();
    generate = () => '';
    leave = () => files;
    const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true, capture: 'files' } });
    assert.ok(drawsOf(receipt).every((d) => d.status === 'unmeasured' && d.reason === reason), JSON.stringify(drawsOf(receipt).map((d) => d.reason)));
    for (const d of drawsOf(receipt)) assert.deepEqual(d.captured_files, named);
    assert.equal(calls.filter((c) => c.judge).length, 0);
    assert.ok(validateReceipt(receipt).valid, JSON.stringify(validateReceipt(receipt).errors));
  }
  // Four not shown: the first three with their reasons as fit the 200 characters, then "and more".
  reset();
  generate = () => '';
  leave = () => [['a.bin', '\u0000'], ['b.bin', '\u0000'], ['c.bin', '\u0000'], ['d.bin', '\u0000']];
  const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true, capture: 'files' } });
  const d = drawsOf(receipt)[0];
  assert.equal(d.reason, `${EMPTY}; the workspace held no file the judge could be shown (a.bin: not text: binary (holds a NUL byte), b.bin: not text: binary (holds a NUL byte), and more)`);
  assert.deepEqual(d.captured_files.map((f) => f.path), ['a.bin', 'b.bin', 'c.bin', 'd.bin']);
});

test('AC-3 a regrade judges an empty-reply draw again on its files', async () => {
  reset();
  generate = () => '';
  leave = () => [['adr.md', FILE]];
  const skill = skillOf();
  const { receipt } = await runSkillOnModel({ skill, model: 'haiku', opts: { samples: 2, trusted: true, capture: 'files' } });
  const answers = {};
  for (const d of drawsOf(receipt)) answers[d.generation_hash] = capture.judgedAnswer('', [{ path: 'adr.md', bytes: Buffer.byteLength(FILE), included: true, content: FILE }]);
  reset();
  const out = await regradeReceipt({ receipt, skill, answers, judgeModel: 'haiku', samples: 2, opts: { trusted: true } });
  assert.ok(drawsOf(out.receipt).every((d) => d.status === 'measured'));
  assert.equal(calls.filter((c) => c.judge && c.input.includes('Decision: Postgres.')).length, drawsOf(receipt).length * 2);
});

// ── AC-4: the planted pointers and non-pointers, one test per shape ────────────────────────────────

const F = '```';
const PROSE = 'The outage began at 09:12 UTC when the connection pool on the primary database filled after a deploy doubled the number of workers. Requests queued for up to forty seconds, and the health check failed the region over at 09:31. Rolling back cleared the queue by 09:40.';
const judged = (a, files) => assert.equal(capture.lostAnswer(a, files), null, `read as lost: ${JSON.stringify(a)} -> ${JSON.stringify(capture.lostAnswer(a, files))}`);
const lostAt = (a, paths) => {
  const l = capture.lostAnswer(a);
  assert.ok(l && l.kind === 'points_at_file', `not read as pointing: ${JSON.stringify(a)}`);
  assert.deepEqual(l.paths, paths, a);
};

test('AC-4 a commit body or PR description that lists the files it changed is judged; a bare claim alone is lost', () => {
  judged('feat(payments): add Stripe checkout\n\n- Added `src/payments/stripe.js` with the client\n- Updated `README.md` with the new env var');
  judged('## Summary\n\nAdds Stripe checkout behind a flag.\n\n## Changes\n\n- Added `src/payments/stripe.js`\n- Updated `docs/payments.md`');
  judged('fix(auth): reject expired refresh tokens\n\nAdded a check in lib/auth.js before the token is renewed.');
  // A-141-1: a list R-6 alone judges, with no commit subject and no Changes label above it.
  judged('This adds Stripe checkout behind a flag.\n\n- Added `src/payments/stripe.js`\n- Updated `docs/payments.md`');
  lostAt('Created `CHANGELOG.md` with the entry.', ['CHANGELOG.md']);
  lostAt('- ✅ Saved to `out/report.md`\n\nLet me know if you want changes.', ['out/report.md']);
  // A DESCRIBE line is not an answer of its own.
  lostAt('Created `CHANGELOG.md` with the entry.\nIt lists the three fixes.', ['CHANGELOG.md']);
});

test('AC-4 a fenced answer followed by a Changes list naming the file is judged', () => {
  judged(`${F}js\nexport const total = (cart) => cart.items.reduce((s, i) => s + i.price, 0);\n${F}\n\nChanges:\n- Updated \`src/cart.js\``);
  judged(`Here is the fix:\n\n${F}diff\n- a\n+ b\n${F}\n\n- Modified lib/auth.js`);
  judged(`${F}js\nexport const total = (cart) => cart.items.reduce((s, i) => s + i.price, 0);\n${F}\n\n- Updated \`src/cart.js\``);
});

// A-141-1 (F-1 item 4): spec 137's plant "```hello``` I saved this to notes.md." refers back to the
// fence above it, so the file's content is in the answer and it reads judged; a fence the claim does
// not refer back to still does not show the file.
test('AC-4 lines inside a fence are never pointing claims; a fence above a first-person pointer shows its file only when the claim refers back to it', () => {
  judged(`Release notes:\n\n${F}markdown\n## 1.4.0\n\n- Added \`src/limits.js\`\n- Updated docs/limits.md\n${F}`);
  judged(`${F}\nfeat(auth): add rate limiting\n\nI added a limiter in lib/limit.js and wrote the docs to docs/limit.md.\n${F}`);
  judged(`~~~\nI saved it to notes.md\n~~~`);
  judged(`${F}\nhello\n${F}\nI saved this to notes.md.`);
  lostAt(`${F}\nhello\n${F}\nI saved the notes to notes.md.`, ['notes.md']);
  lostAt(`${F}\nnpm install\n${F}\nI've written the full guide to GUIDE.md.`, ['GUIDE.md']);
  lostAt(`Created \`a.md\`.\nI also saved notes to b.md:\n${F}\nB\n${F}`, ['a.md']);
});

// A-141-1 (F-1): the reply's own answer above a pointing line of any kind shows its file. Three of
// these read judged at the Base, which did not read the typographic apostrophe, and lost at 6dae8b9e.
const FN = `${F}js\nexport function total(cart) {\n  return cart.items.reduce((s, i) => s + i.price, 0);\n}\n${F}`;
test('AC-4 a pointing line below the reply\'s own answer is judged: a fence it refers back to, 200 characters of prose, a Changes list, a commit body; below a short line or an unrelated fence it is lost', () => {
  judged(`Here is the function:\n\n${FN}\n\nI've saved this to \`src/cart.js\`.`);
  judged(`Here is the function:\n\n${FN}\n\nI’ve saved this to \`src/cart.js\`.`);
  judged(`${FN}\n\nChanges:\n- I updated \`src/cart.js\``);
  judged('Add Stripe checkout\n\nWe added `src/payments/stripe.js` and updated `README.md` with the STRIPE_KEY variable.');
  judged(`## Incident summary\n\n${PROSE}\n\nI’ve also saved this summary to \`SUMMARY.md\`.`);
  judged('## Summary\nAdds Stripe checkout behind a flag so staging can try it first.\n\n## Changes\n- I’ve added `src/payments/stripe.js`\n- I’ve updated `docs/payments.md`');
  judged(`${PROSE} I've saved this summary to SUMMARY.md.`);
  lostAt('The main issue is the unchecked input.\n\nI saved the review to review.md.', ['review.md']);
  lostAt('Here is the ADR.\n\nI wrote it to docs/adr/0001.md.', ['docs/adr/0001.md']);
  lostAt('Changes:\n- I saved the review to review.md', ['review.md']);
  lostAt(`${FN}\n\nI've written the tests to \`src/cart.test.js\`.`, ['src/cart.test.js']);
});

test('AC-4 first-person advice is an answer, not a description of work', () => {
  judged("I'd add an index on user_id before changing the query.");
  judged('I would add a retry with backoff around the fetch, and I would make the timeout a setting.');
  judged('I’d refactor the parser into two functions and add a test for the empty input.');
  judged('I recommend adding a unique constraint on email.');
  assert.equal((capture.lostAnswer("I've drafted the ADR and the changelog entry as requested.\n\nLet me know if you want changes.") || {}).kind, 'describes_work');
  assert.equal((capture.lostAnswer("I'll write the commit message now.") || {}).kind, 'describes_work');
});

test('AC-4 a summary written to a file and then given in prose is judged; a pointer followed by a description is lost', () => {
  judged(`I've written the summary to SUMMARY.md. Here it is:\n\n${PROSE}`);
  judged(`I saved the summary to summary.md.\n\n- ${PROSE.split('. ').join('.\n- ')}`);
  // A-141-1 (F-2): the summary on the pointing line itself, after its clause, and a WORK line with it.
  judged(`I wrote the full summary to \`SUMMARY.md\`. In short: ${PROSE}`);
  judged(`I have drafted the summary. In short: ${PROSE}`);
  lostAt('I wrote the full summary to `SUMMARY.md`. In short: the pool filled.', ['SUMMARY.md']);
  lostAt("I've written the ADR to docs/adr/0001.md.\n\nIt covers the context, the decision and the consequences.", ['docs/adr/0001.md']);
  lostAt("I've written the ADR to docs/adr/0001.md. It has:\n- Context\n- Decision\n- Consequences", ['docs/adr/0001.md']);
  lostAt('I saved the review to review.md.\n\nThe main issue is the unchecked input.', ['review.md']);
});

test('AC-4 a claim and a code name in one clause is judged; a real file name in one clause is still a pointer', () => {
  // Each beside a line of answer, as the real report 013 lines were: alone, a line that only reports
  // work reads describes_work by spec 137 R-5, which this spec does not change.
  judged('The total goes negative when a refund exceeds the cart.\n\nI added a guard to `cart.total` so it is never negative.');
  judged("The lookup failed on trailing spaces.\n\nI've updated `user.email` handling so it is trimmed before the lookup.");
  judged('Requests time out under load.\n\nI updated `config.timeout` to 30 seconds.');
  lostAt("I've updated `config.json` with the new timeout.", ['config.json']);
  lostAt('I added the placeholder to `.env.example`.', ['.env.example']);
  lostAt('I added a guard in lib/auth.js.', ['lib/auth.js']);
});

test('AC-4 a typographic apostrophe or double quote is read as a plain one', () => {
  lostAt('I’ve written the ADR to docs/adr/0001.md.', ['docs/adr/0001.md']);
  // A-141-1 (F-6)
  lostAt('I’ve saved it as “review.md”.\nThe top issue is the unbounded retry in the client.', ['review.md']);
  lostAt('I’ll write the review to review.md.', ['review.md']);
  lostAt('We’ve saved the plan to `plan.md`.', ['plan.md']);
});

test('AC-4 a file name in bold or other emphasis is a pointer; an underscore inside a name is not emphasis', () => {
  lostAt('I created **ADR-0001.md** with the decision.', ['ADR-0001.md']);
  lostAt('I saved the review as **`review.md`**.', ['review.md']);
  lostAt('I wrote it to *notes.md*.', ['notes.md']);
  lostAt('I wrote it to __notes.md__.', ['notes.md']);
  lostAt('I wrote it to _notes.md_.', ['notes.md']);
  lostAt('I saved it to my_file_name.md', ['my_file_name.md']);
});

// A-141-1 (F-7): a bold label that carries a WRITE word points at the files after it, or listed
// under it, as a bare claim: lost alone, a change list beside an answer of the reply's own.
test('AC-4 a bold label with a WRITE word is a pointer at the files after it or listed under it', () => {
  lostAt('**Created:** `docs/adr/0001.md`', ['docs/adr/0001.md']);
  lostAt('**Files created:**\n- `docs/adr/0001.md`', ['docs/adr/0001.md']);
  lostAt('**Files written**:\n\n- `docs/adr/0001.md`\n- `docs/adr/0002.md`', ['docs/adr/0001.md', 'docs/adr/0002.md']);
  judged(`Here is the ADR:\n\n${F}markdown\n# ADR 1\n\nUse Postgres.\n${F}\n\n**Files created:**\n- \`docs/adr/0001.md\``);
  judged('**Context:** the service reads `config.json` at start.\n\nThe fix is to read it once and cache it.');
});

// Spec 137's planted pointers (its tests/capture.test.js), each still lost with its path.
test('AC-4 every pointer spec 137 planted is still lost with its path', () => {
  const POINTS = [
    ['I have written the ADR to `docs/adr/0001-use-postgres.md`.', ['docs/adr/0001-use-postgres.md']],
    ['Created `CHANGELOG.md` with the entry.', ['CHANGELOG.md']],
    ['- ✅ Saved to `out/report.md`', ['out/report.md']],
    ['The ADR is saved at docs/adr/0002.md.', ['docs/adr/0002.md']],
    ['I added a guard in lib/auth.js.', ['lib/auth.js']],
    ['I saved it to notes.txt', ['notes.txt']],
    ['I will now write the file report.md', ['report.md']],
    ['I also created tests/foo.test.js', ['tests/foo.test.js']],
    ["I've written the review to ./review.md and the summary to SUMMARY.md.", ['./review.md', 'SUMMARY.md']],
  ];
  for (const [a, p] of POINTS) lostAt(a, p);
});

// ── AC-5: the reading in a run and a regrade ───────────────────────────────────────────────────

const RUN_SHAPES = [
  ['judged', 'feat(payments): add Stripe checkout\n\n- Added `src/payments/stripe.js` with the client'],
  ['judged', `${F}\nI saved it to notes.md\n${F}`],
  ['judged', "I'd add an index on user_id before changing the query."],
  ['judged', `I've written the summary to SUMMARY.md. Here it is:\n\n${PROSE}`],
  ['judged', 'The total goes negative when a refund exceeds the cart.\n\nI added a guard to `cart.total` so it is never negative.'],
  ['lost', 'I’ve written the ADR to docs/adr/0001.md.'],
  ['lost', 'I created **ADR-0001.md** with the decision.'],
  // A-141-1
  ['judged', `Here is the function:\n\n${FN}\n\nI’ve saved this to \`src/cart.js\`.`],
  ['judged', `I wrote the full summary to \`SUMMARY.md\`. In short: ${PROSE}`],
  ['lost', 'I’ve saved it as “review.md”.\nThe top issue is the unbounded retry in the client.'],
  ['lost', '**Files created:**\n- `docs/adr/0001.md`'],
];
test('AC-5 in a run, a judged shape is judged once per sample and a lost one makes no judge call; a regrade reads them the same', async () => {
  for (const [want, reply] of RUN_SHAPES) {
    reset();
    generate = (call) => (withSkill(call) ? reply : 'Here is the answer: use Postgres.');
    const skill = skillOf();
    const { receipt } = await runSkillOnModel({ skill, model: 'haiku', opts: { samples: 2, trusted: true } });
    const ws = armOf(receipt, 'with_skill').generation.draws;
    const mine = calls.filter((c) => c.judge && c.input.includes(reply.slice(0, 30)));
    if (want === 'judged') {
      assert.ok(ws.every((d) => d.status === 'measured'), `${reply}: ${JSON.stringify(ws.map((d) => d.reason))}`);
      assert.equal(mine.length, ws.length * 2, reply);
    } else {
      assert.ok(ws.every((d) => d.status === 'unmeasured' && /points at a file/.test(d.reason)), reply);
      assert.equal(mine.length, 0, reply);
    }
    if (want !== 'judged') continue;
    const answers = {};
    for (const d of drawsOf(receipt)) answers[d.generation_hash] = armOf(receipt, 'with_skill').generation.draws.includes(d) ? reply : 'Here is the answer: use Postgres.';
    reset();
    const out = await regradeReceipt({ receipt, skill, answers, judgeModel: 'haiku', samples: 2, opts: { trusted: true } });
    assert.ok(armOf(out.receipt, 'with_skill').generation.draws.every((d) => d.status === 'measured'), `regrade: ${reply}`);
  }
});

// ── AC-6: the corpus ────────────────────────────────────────────────────────────────────────────

function trackedAnswers() {
  const listed = cp.execFileSync('git', ['-C', ARTIFACT_ROOT, 'ls-files', '-z', '--', 'specs/031-artefact-claims/evidence/transcripts'], { encoding: 'utf8' })
    .split('\0').filter((f) => f.endsWith('.json') && !f.endsWith('index.json'));
  return listed.map((f) => readJson(path.join(ARTIFACT_ROOT, f))).filter((o) => typeof o.generation === 'string');
}
test('AC-6 no tracked real answer reads as lost, whole or line by line', () => {
  const answers = trackedAnswers();
  assert.ok(answers.length >= 20, `expected the tracked transcripts, read ${answers.length}`);
  assert.deepEqual(answers.filter((o) => capture.lostAnswer(o.generation)).map((o) => `${o.id}/${o.mode}`), []);
  assert.deepEqual(answers.map((o) => [`${o.id}/${o.mode}`, capture.pointedPaths(o.generation)]).filter(([, p]) => p.length), []);
});

const CORPUS = readJson(path.join(SPEC, 'fixtures', 'answer-shapes.json')).answers;
const SHAPES = ['commit-or-pr-list', 'fenced-block', 'first-person-advice', 'summary-in-prose', 'code-name', 'typographic-apostrophe', 'emphasis', 'answer-above', 'bold-label'];
test('AC-6 the shape corpus carries every shape, each with its source', () => {
  for (const s of SHAPES) assert.ok(CORPUS.some((a) => a.shape === s), `no corpus answer of shape ${s}`);
  for (const s of ['commit-or-pr-list', 'fenced-block', 'first-person-advice', 'summary-in-prose', 'code-name', 'answer-above']) assert.ok(CORPUS.some((a) => a.shape === s && a.expect === 'judged'), `no judged answer of shape ${s}`);
  for (const s of ['typographic-apostrophe', 'emphasis', 'answer-above', 'bold-label']) assert.ok(CORPUS.some((a) => a.shape === s && a.expect === 'lost'), `no lost answer of shape ${s}`);
  assert.ok(CORPUS.every((a) => a.source && a.id && (a.expect === 'judged' || (a.expect === 'lost' && a.kind))));
});
for (const s of SHAPES) {
  test(`AC-6 the shape corpus reads as expected: ${s}`, () => {
    // A lost answer is read as its kind and, when it points, its paths: an unwrapped bold file name
    // that falls to describes_work is not the pointer the corpus planted.
    const reads = (a) => { const l = capture.lostAnswer(a.answer); return l === null ? 'judged' : JSON.stringify([l.kind, l.paths || null]); };
    const wants = (a) => (a.expect === 'judged' ? 'judged' : JSON.stringify([a.kind, a.paths || null]));
    const wrong = CORPUS.filter((a) => a.shape === s).filter((a) => reads(a) !== wants(a)).map((a) => `${a.id} (expected ${wants(a)}, read ${reads(a)})`);
    assert.deepEqual(wrong, []);
  });
}

// ── AC-8: the methodology page says what the code does ───────────────────────────────────────────

test('AC-8 the methodology page names the text-capture tools, the caps and each rule as the code holds them', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'methodology', 'index.html'), 'utf8');
  const m = /<p id="judged-answer">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(m, 'no #judged-answer paragraph');
  const p = m[1];
  const named = [...p.matchAll(/<code>([A-Za-z]+)<\/code>/g)].map((x) => x[1]).filter((t) => LISTS.claude.init_tools.includes(t) || helpCodeRunners().includes(t));
  const code = [...new Set([...capture.CLAUDE_TEXT_TOOLS, ...capture.CLAUDE_FILES_TOOLS])].sort();
  assert.deepEqual([...new Set(named)].sort(), code, 'the page names other tools than the code holds');
  const { files, fileBytes, totalBytes } = capture.WORKSPACE_LIMITS;
  for (const n of [files, fileBytes, totalBytes]) assert.ok(p.includes(String(n)), `the page does not give the cap ${n}`);
  for (const phrase of ['PowerShell', 'REPL', 'MCP', 'every feature', 'named with its reason', 'replies with nothing', 'inside a fenced block', 'lists the files it changed', 'in prose', 'code name', 'typographic apostrophe', 'bold', 'advice',
    // A-141-1
    'cannot be read', 'its files are still listed', 'on the pointing line itself', 'below the reply\'s own answer', 'refers back', 'Changes list', 'commit message', 'quote mark', 'bold label']) {
    assert.ok(p.includes(phrase), `the page does not say: ${phrase}`);
  }
});
