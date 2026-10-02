// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 137 on the runner's path (AC-1 to AC-5, AC-10, AC-11): lib/provider.js's two
// CLI lanes in both capture modes, lib/run.js runSkillOnModel, lib/regrade.js regradeReceipt, and
// lib/stale.js staleReport's harness axis.
//
//   node --test tests/answer-capture-run.test.js
//
// THE MODEL DOUBLE is the one tests/gate.js uses for the CLI lanes: child_process.spawn replaced on
// the module object lib/provider.js calls it through, so nothing is spawned. The double records each
// call (file, argv, cwd, stdin) and answers in the CLI's JSON shape: a judge prompt (recognised by
// the words the judge template ends with, as lib/stub.js recognises one) with a fixed score, and a
// generation with the reply the test planted. In files capture it plays the CLI's side of the
// workspace: through the hop it prints the frame the wrapper would, with the nonce the plan carries;
// on the trusted path it writes the files into the directory it was started in. spawnSync is
// replaced too, before lib/run.js and lib/stale.js load, so the harness version read spawns
// nothing: it answers `--version` for each binary with the version the test set, or fails when the
// test says so, and records each call (AC-10, AC-11).
//
// Every test name starts with the criterion it checks; spec 137's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

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
          for (const [p, t] of files) { fs.mkdirSync(path.dirname(path.join(call.cwd, p)), { recursive: true }); fs.writeFileSync(path.join(call.cwd, p), t); }
        }
        c.stdout.end(out); c.stderr.end();
        setImmediate(() => c.emit('close', 0, null));
      });
    },
  };
  return c;
};
// What `claude --version` and `codex --version` printed on the prep box (1 Oct 2026); a test that
// needs a second version sets its own.
const VERSION_DEFAULT = { claude: '2.1.285 (Claude Code)\n', codex: 'codex-cli 0.146.0\n' };
const versionOut = { ...VERSION_DEFAULT };
let versionFails = false;
const versionCalls = [];
cp.spawnSync = (file, args) => {
  const all = [file, ...args];
  const bin = all[all.lastIndexOf('--version') - 1];
  versionCalls.push({ file, args: [...args], bin });
  if (versionFails) return { status: 1, stdout: '', stderr: 'no version today\n' };
  return { status: 0, stdout: versionOut[bin] || '', stderr: '' };
};

delete process.env.DRIFTPROOF_STUB;
delete process.env.DRIFTPROOF_EVAL_USER;
process.env.CLAUDE_PROVIDER = 'cli';
process.env.OPENAI_SURFACE = 'cli';
const provider = require('../lib/provider');
const { runSkillOnModel } = require('../lib/run');
const { regradeReceipt } = require('../lib/regrade');
const { validateReceipt, verifyReceiptHash, sealReceipt } = require('../lib/receipt');
const { receiptVerdict } = require('../lib/verdict');
const { staleReport } = require('../lib/stale');

const SYS = '---\nname: fx\n---\nWrite the ADR.';
const reset = () => {
  calls.length = 0; generate = () => 'ok'; leave = () => [];
  versionCalls.length = 0; Object.assign(versionOut, VERSION_DEFAULT); versionFails = false;
};
const afterLabel = (c) => c.args.slice(c.args.indexOf(provider.HOP_LABEL) + 1);

// ── AC-1 and AC-2: the lanes' argv and what each mode returns ─────────────────────────────────────

test('AC-1 text capture through the hop: the wrapper is unchanged and claude runs with every write tool off, the SKILL.md last', async () => {
  reset();
  const r = await provider.complete({ system: SYS, prompt: 'p', model: 'haiku', timeoutMs: 5000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, '/usr/bin/sudo');
  assert.equal(calls[0].args[calls[0].args.indexOf(provider.HOP_LABEL) - 1], provider.ISOLATED_WRAPPER);
  assert.deepEqual(afterLabel(calls[0]), ['claude', '-p', '--output-format', 'json', '--model', 'claude-haiku-4-5-20251001', '--disallowedTools', 'Bash,Edit,MultiEdit,NotebookEdit,Write,Task', '--append-system-prompt', SYS]);
  assert.equal(r.text, 'ok');
  assert.ok(!('workspace' in r));
});

test('AC-1 text capture on the trusted path and on codex: the same tools off, codex read-only', async () => {
  reset();
  await provider.complete({ prompt: 'p', model: 'haiku', timeoutMs: 5000, trusted: true });
  assert.equal(calls[0].file, 'claude');
  assert.equal(calls[0].cwd, null);
  assert.deepEqual(calls[0].args, ['-p', '--output-format', 'json', '--model', 'claude-haiku-4-5-20251001', '--disallowedTools', 'Bash,Edit,MultiEdit,NotebookEdit,Write,Task']);
  reset();
  await provider.complete({ prompt: 'p', model: 'gpt-5.6-sol', timeoutMs: 5000 });
  const a = afterLabel(calls[0]);
  assert.equal(a[0], 'codex');
  assert.equal(a[a.indexOf('-s') + 1], 'read-only');
  assert.deepEqual(provider.CODEX_EXEC_ARGS, ['exec', '--json', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral']);
});

test('AC-2 files capture through the hop: the wrapper collects, claude may edit with Bash and Task off, and the reply carries the workspace', async () => {
  reset();
  leave = () => [['docs/adr/0001.md', '# ADR 1\n']];
  const r = await provider.complete({ system: SYS, prompt: 'p', model: 'haiku', timeoutMs: 5000, capture: 'files' });
  const wrapper = calls[0].args[calls[0].args.indexOf(provider.HOP_LABEL) - 1];
  assert.notEqual(wrapper, provider.ISOLATED_WRAPPER);
  assert.ok(wrapper.endsWith('cd /; rm -rf "$d"; exit $r') && / WORKSPACE/.test(wrapper));
  assert.deepEqual(afterLabel(calls[0]).slice(5, 10), ['claude-haiku-4-5-20251001', '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash,Task']);
  assert.equal(r.text, 'ok');
  assert.deepEqual(r.workspace, [{ path: 'docs/adr/0001.md', bytes: 8, included: true, content: '# ADR 1\n' }]);
});

test('AC-2 files capture on the trusted path runs the CLI in a fresh directory, reads it, and removes it; codex writes its workspace', async () => {
  reset();
  leave = () => [['notes.md', 'hello\n']];
  const r = await provider.complete({ prompt: 'p', model: 'haiku', timeoutMs: 5000, trusted: true, capture: 'files' });
  assert.ok(calls[0].cwd && calls[0].cwd !== process.cwd());
  assert.ok(!fs.existsSync(calls[0].cwd), 'the directory was left');
  assert.deepEqual(r.workspace, [{ path: 'notes.md', bytes: 6, included: true, content: 'hello\n' }]);
  reset();
  await provider.complete({ prompt: 'p', model: 'gpt-5.6-sol', timeoutMs: 5000, capture: 'files' });
  const a = afterLabel(calls[0]);
  assert.equal(a[a.indexOf('-s') + 1], 'workspace-write');
});

test('AC-2 files capture on an api surface is refused before any call', async () => {
  reset();
  process.env.CLAUDE_PROVIDER = 'api';
  try {
    await assert.rejects(provider.complete({ prompt: 'p', model: 'haiku', timeoutMs: 5000, capture: 'files' }), { code: 'CAPTURE_SURFACE' });
    await assert.rejects(runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, capture: 'files' } }), { code: 'CAPTURE_SURFACE' });
    assert.equal(calls.length, 0);
  } finally { process.env.CLAUDE_PROVIDER = 'cli'; }
});

// ── AC-3 to AC-5: through runSkillOnModel ───────────────────────────────────────────────────────

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function skillOf() {
  const cases = [{ id: 'adr-1', prompt: 'Write an ADR choosing a database.', rubric: 'A complete ADR with context, decision and consequences.', pass_threshold: 0.7 }];
  return { name: 'fx-adr', version: '1.0.0', contentHash: sha(SYS), skillMd: SYS, suite: { format: 'agentskills.io/evals', suiteHash: sha(JSON.stringify(cases)), caseCount: cases.length, cases } };
}
const armOf = (receipt, mode) => receipt.results.cases.find((c) => c.mode === mode);
const withSkill = (call) => call.args.includes('--append-system-prompt');

test('AC-3 every receipt the runner writes records its capture mode, and validates', async () => {
  for (const mode of ['text', 'files']) {
    reset();
    generate = () => 'Here is the ADR:\n\n# ADR 1\n\nContext: we need a database.';
    const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true, ...(mode === 'files' ? { capture: mode } : {}) } });
    assert.deepEqual(receipt.run.capture, { mode });
    const v = validateReceipt(receipt);
    assert.ok(v.valid, JSON.stringify(v.errors));
    assert.equal(v.version, require('../config').RECEIPT_SCHEMA_VERSION);
    assert.ok(verifyReceiptHash(receipt));
  }
});

// The schema versioning (spec/RECEIPT.md): v0.9 is frozen as the Base's current schema but for its
// $id, and every tracked receipt validates as it did at the Base. The Base is read from spec 137's
// own Base line, and its schema and package files from git in DRIFTPROOF_ARTIFACT_ROOT, as the
// AC-6 test lists the tracked transcripts.
const ARTIFACT_ROOT = process.env.DRIFTPROOF_ARTIFACT_ROOT || path.join(__dirname, '..');
function spec137Base() {
  const md = fs.readFileSync(path.join(ARTIFACT_ROOT, 'specs', '137-answer-capture-honest-verdicts', 'spec.md'), 'utf8');
  const m = /^\*\*Base:\*\* `dev` at `([0-9a-f]{40})`/m.exec(md);
  assert.ok(m, 'spec 137 has no Base line');
  return m[1];
}
function trackedReceipts() {
  const out = [];
  for (const f of cp.execFileSync('git', ['-C', ARTIFACT_ROOT, 'ls-files', '-z', '--', '*.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)) {
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(ARTIFACT_ROOT, f), 'utf8')); } catch { continue; }
    if (r && r.results && Array.isArray(r.results.cases) && r.receipt_hash) out.push({ f, r });
  }
  return out;
}

test('AC-3 the frozen v0.9 schema is the Base\'s but for $id, and every tracked receipt validates as it did at the Base', async () => {
  const base = spec137Base();
  const git = (...a) => cp.execFileSync('git', ['-C', ARTIFACT_ROOT, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // The frozen copy, line for line, but the $id line.
  const was = git('show', `${base}:spec/receipt.schema.json`).split('\n');
  const frozen = fs.readFileSync(path.join(__dirname, '..', 'spec', 'receipt.v0.9.schema.json'), 'utf8').split('\n');
  assert.equal(frozen.length, was.length);
  const differ = frozen.map((l, i) => (l === was[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(differ.map((i) => /^\s*"\$id":/.test(frozen[i]) && /^\s*"\$id":/.test(was[i])), differ.map(() => true), `lines other than $id differ: ${differ.map((i) => i + 1).join(', ')}`);
  assert.equal(differ.length, 1, 'the $id did not change');
  assert.equal(JSON.parse(frozen.join('\n')).$id, 'https://driftproofhq.com/spec/receipt.v0.9.schema.json');

  // A v0.10 receipt the runner writes, taken back to v0.9 without its new field, validates at v0.9;
  // with run.capture kept, v0.9 refuses it; restamped 0.10, it validates again.
  reset();
  generate = () => 'Here is the ADR:\n\n# ADR 1\n\nContext: we need a database.';
  const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true } });
  const v09 = JSON.parse(JSON.stringify(receipt));
  v09.schema_version = '0.9';
  assert.equal(validateReceipt(v09).valid, false, 'a v0.9 receipt carrying run.capture validated');
  delete v09.run.capture;
  const ok09 = validateReceipt(v09);
  assert.ok(ok09.valid && ok09.version === '0.9', JSON.stringify(ok09.errors));
  const ok10 = validateReceipt({ ...v09, schema_version: '0.10' });
  assert.ok(ok10.valid, JSON.stringify(ok10.errors));

  // Every tracked receipt: its validity here, and at the Base's own package files.
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'spec137-base-'));
  try {
    cp.execFileSync('bash', ['-c', 'git -C "$1" archive --format=tar "$2" lib spec config config.js package.json | tar -x -C "$3"', '_', ARTIFACT_ROOT, base, dir]);
    let modules = null;
    try { modules = path.dirname(path.dirname(require.resolve('ajv/package.json'))); } catch { /* NODE_PATH serves both */ }
    if (modules) fs.symlinkSync(modules, path.join(dir, 'node_modules'));
    const atBase = require(path.join(dir, 'lib', 'receipt.js')).validateReceipt;
    const list = trackedReceipts();
    assert.ok(list.length >= 200, `expected the tracked receipts, read ${list.length}`);
    const moved = list.filter(({ r }) => validateReceipt(r).valid !== atBase(r).valid).map(({ f }) => f);
    assert.deepEqual(moved, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('AC-4 a reply that points at a file it does not include is a lost draw, never judged, in text capture', async () => {
  reset();
  generate = (call) => (withSkill(call) ? 'I have written the ADR to `docs/adr/0001-use-postgres.md`.' : 'Here is the ADR:\n\n# ADR 1\n\nContext: we need a database.');
  const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true } });
  const ws = armOf(receipt, 'with_skill');
  assert.equal(ws.case_status, 'failed_unmeasured');
  assert.ok(ws.generation.draws.length >= 1 && ws.generation.draws.every((d) => d.status === 'unmeasured' && /points at a file the judge was not shown \(docs\/adr\/0001-use-postgres\.md\)/.test(d.reason)));
  assert.equal(calls.filter((c) => c.judge && /docs\/adr\/0001-use-postgres\.md/.test(c.input)).length, 0, 'a lost answer reached the judge');
  assert.equal(armOf(receipt, 'baseline').generation.n_measured >= 1, true);
  assert.equal(receiptVerdict(receipt).verdict, 'NOT_MEASURED');
  assert.ok(validateReceipt(receipt).valid);
});

test('AC-4 in files capture the same reply is judged with the file it wrote, and the draw lists the file', async () => {
  reset();
  generate = (call) => (withSkill(call) ? 'I have written the ADR to `docs/adr/0001-use-postgres.md`.' : 'Here is the ADR:\n\n# ADR 1\n\nContext: we need a database.');
  leave = (call) => (withSkill(call) ? [['docs/adr/0001-use-postgres.md', '# ADR 1\n\nUse Postgres.\n']] : []);
  const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true, capture: 'files' } });
  const ws = armOf(receipt, 'with_skill');
  assert.equal(ws.case_status || 'ok', 'ok');
  assert.ok(ws.generation.draws.every((d) => d.status === 'measured'));
  assert.deepEqual(ws.generation.draws[0].captured_files, [{ path: 'docs/adr/0001-use-postgres.md', bytes: 23, included: true }]);
  const judged = calls.filter((c) => c.judge && /docs\/adr\/0001-use-postgres\.md/.test(c.input));
  assert.ok(judged.length >= 1 && judged.every((c) => /Use Postgres\./.test(c.input)), 'the judge did not see the file');
  assert.ok(validateReceipt(receipt).valid, JSON.stringify(validateReceipt(receipt).errors));
});

test('AC-4 a files-capture draw whose workspace could not be collected is lost', async () => {
  reset();
  generate = () => 'Here is the ADR:\n\n# ADR 1';
  const realSpawn = cp.spawn;
  // The hop path, its frame cut off: the double prints the reply and no frame.
  cp.spawn = (file, args, options) => realSpawn(file, args.map((a) => (/ WORKSPACE/.test(a) ? a.replace(/ WORKSPACE/g, ' W0RKSPACE') : a)), options);
  try {
    const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, capture: 'files' } });
    for (const mode of ['with_skill', 'baseline']) {
      assert.ok(armOf(receipt, mode).generation.draws.every((d) => d.status === 'unmeasured' && /could not be collected/.test(d.reason)), mode);
    }
  } finally { cp.spawn = realSpawn; }
});

test('AC-5 a reply that only describes work is a lost draw, never judged', async () => {
  reset();
  generate = (call) => (withSkill(call) ? "I've drafted the ADR with a context, a decision and the consequences.\n\nLet me know if you want changes." : 'Here is the ADR:\n\n# ADR 1\n\nContext: we need a database.');
  const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true } });
  const ws = armOf(receipt, 'with_skill');
  assert.ok(ws.generation.draws.every((d) => d.status === 'unmeasured' && /only describes work/.test(d.reason)));
  assert.equal(calls.filter((c) => c.judge && /drafted the ADR/.test(c.input)).length, 0);
});

test('AC-4 a regrade reads the answer the same way: a pointing answer is a lost draw and no judge call is made for it', async () => {
  reset();
  // A distinct answer per draw, so each draw has its own generation_hash.
  const texts = new Map();
  let k = 0;
  generate = () => { k += 1; const t = `Here is ADR ${k}:\n\nContext: we need a database.`; texts.set(crypto.createHash('sha256').update(t).digest('hex'), t); return t; };
  const skill = skillOf();
  const { receipt } = await runSkillOnModel({ skill, model: 'haiku', opts: { samples: 2, trusted: true } });
  const answers = {};
  const draws = receipt.results.cases.flatMap((c) => c.generation.draws);
  for (const d of draws) answers[d.generation_hash] = texts.get(d.generation_hash);
  const planted = draws[0].generation_hash;
  answers[planted] = 'I saved the ADR to adr.md.';
  reset();
  const out = await regradeReceipt({ receipt, skill, answers, judgeModel: 'haiku', samples: 2, opts: { trusted: true } });
  const lost = out.receipt.results.cases.flatMap((c) => c.generation.draws).filter((d) => d.generation_hash === planted);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].status, 'unmeasured');
  assert.match(lost[0].reason, /points at a file the judge was not shown \(adr\.md\)/);
  assert.equal(calls.filter((c) => c.judge && /adr\.md/.test(c.input)).length, 0);
  assert.equal(calls.filter((c) => c.judge).length, (draws.length - 1) * 2);
  assert.deepEqual(out.receipt.run.capture, { mode: 'text' });
});

test('AC-4 a regrade of a files-capture receipt reads each draw with its captured_files, and keeps them for the next regrade', async () => {
  reset();
  const said = 'I have written the ADR to `docs/adr/0001-use-postgres.md`.';
  const file = '# ADR 1\n\nUse Postgres.\n';
  const plain = 'Here is the ADR:\n\n# ADR 1\n\nContext: we need a database.';
  generate = (call) => (withSkill(call) ? said : plain);
  leave = (call) => (withSkill(call) ? [['docs/adr/0001-use-postgres.md', file]] : []);
  const skill = skillOf();
  const { receipt } = await runSkillOnModel({ skill, model: 'haiku', opts: { samples: 2, trusted: true, capture: 'files' } });
  const ws = [{ path: 'docs/adr/0001-use-postgres.md', bytes: Buffer.byteLength(file), included: true, content: file }];
  const answers = {};
  for (const t of [require('../lib/capture').judgedAnswer(said, ws), plain]) answers[sha(t)] = t;
  const drawsOf = (r) => r.results.cases.flatMap((c) => c.generation.draws);
  assert.ok(drawsOf(receipt).every((d) => answers[d.generation_hash] !== undefined), 'an answer was not rebuilt');
  let r = receipt;
  for (const pass of [1, 2]) {
    reset();
    r = (await regradeReceipt({ receipt: r, skill, answers, judgeModel: 'haiku', samples: 2, opts: { trusted: true } })).receipt;
    const listed = drawsOf(r).filter((d) => d.captured_files);
    assert.ok(listed.length >= 1 && listed.every((d) => d.status === 'measured'), `regrade ${pass} lost a draw whose file was collected`);
    assert.deepEqual(listed[0].captured_files, [{ path: 'docs/adr/0001-use-postgres.md', bytes: Buffer.byteLength(file), included: true }]);
    assert.ok(validateReceipt(r).valid, JSON.stringify(validateReceipt(r).errors));
  }
});

test('AC-4 a regrade keeps a draw lost for an uncollected workspace lost, and makes no judge call for it', async () => {
  reset();
  const reply = 'Here is the ADR:\n\n# ADR 1';
  generate = () => reply;
  const realSpawn = cp.spawn;
  // The run of the test above: the hop path, its frame cut off, so no workspace is collected.
  cp.spawn = (file, args, options) => realSpawn(file, args.map((a) => (/ WORKSPACE/.test(a) ? a.replace(/ WORKSPACE/g, ' W0RKSPACE') : a)), options);
  let receipt;
  try {
    ({ receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, capture: 'files' } }));
  } finally { cp.spawn = realSpawn; }
  const drawsOf = (r) => r.results.cases.flatMap((c) => c.generation.draws);
  assert.ok(drawsOf(receipt).every((d) => d.status === 'unmeasured' && /could not be collected/.test(d.reason) && !d.captured_files));
  // The reply is on hand, so nothing but the lost collection keeps the draw from the judge.
  const answers = { [sha(reply)]: reply };
  reset();
  const out = await regradeReceipt({ receipt, skill: skillOf(), answers, judgeModel: 'haiku', samples: 2, opts: { trusted: true } });
  assert.ok(drawsOf(out.receipt).length >= 2 && drawsOf(out.receipt).every((d) => d.status === 'unmeasured' && /could not be collected/.test(d.reason)), 'a regrade scored a draw whose workspace was never collected');
  assert.equal(calls.filter((c) => c.judge).length, 0, 'a regrade judged an answer the run never saw whole');
  assert.deepEqual(out.receipt.run.capture, { mode: 'files' });
  assert.equal(receiptVerdict(out.receipt).verdict, 'NOT_MEASURED');
});

// ── AC-10 and AC-11: the harness version (priority 5) ───────────────────────────────────────────

const ADR = 'Here is the ADR:\n\n# ADR 1\n\nContext: we need a database.';
const versionArgv = (c) => [c.file, ...c.args];
const afterHop = (c) => c.args.slice(c.args.indexOf(provider.HOP_LABEL) - 1);

test('AC-10 claude-cli through the hop records claude-code and the version claude --version printed, read through the run\'s spawn plan, in text and files capture', async () => {
  for (const [mode, printed, want] of [['text', '2.1.285 (Claude Code)\n', '2.1.285'], ['files', '2.1.290 (Claude Code)\n', '2.1.290']]) {
    reset();
    versionOut.claude = printed;
    generate = () => ADR;
    const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, ...(mode === 'files' ? { capture: mode } : {}) } });
    assert.equal(receipt.run.surface, 'claude-cli');
    assert.deepEqual(receipt.run.harness, { name: 'claude-code', version: want }, mode);
    assert.equal(versionCalls.length, 1, mode);
    assert.equal(versionCalls[0].file, '/usr/bin/sudo', mode);
    assert.deepEqual(afterHop(versionCalls[0]), [provider.ISOLATED_WRAPPER, provider.HOP_LABEL, 'claude', '--version'], mode);
    assert.ok(validateReceipt(receipt).valid, JSON.stringify(validateReceipt(receipt).errors));
    assert.ok(verifyReceiptHash(receipt));
  }
});

test('AC-10 claude-cli on the trusted path reads claude --version itself and records what it printed', async () => {
  reset();
  versionOut.claude = '2.1.291 (Claude Code)\n';
  generate = () => ADR;
  const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true } });
  assert.deepEqual(receipt.run.harness, { name: 'claude-code', version: '2.1.291' });
  assert.deepEqual(versionCalls.map(versionArgv), [['claude', '--version']]);
});

test('AC-10 openai-cli through the hop records codex and the version codex --version printed, in text and files capture', async () => {
  for (const [mode, printed, want] of [['text', 'codex-cli 0.146.0\n', '0.146.0'], ['files', 'codex-cli 0.147.1\n', '0.147.1']]) {
    reset();
    versionOut.codex = printed;
    generate = () => ADR;
    const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'gpt-5.6-sol', opts: { samples: 2, judgeModel: 'haiku', ...(mode === 'files' ? { capture: mode } : {}) } });
    assert.equal(receipt.run.surface, 'openai-cli');
    assert.deepEqual(receipt.run.harness, { name: 'codex', version: want }, mode);
    assert.equal(versionCalls.length, 1, mode);
    assert.equal(versionCalls[0].file, '/usr/bin/sudo', mode);
    assert.deepEqual(afterHop(versionCalls[0]), [provider.ISOLATED_WRAPPER, provider.HOP_LABEL, 'codex', '--version'], mode);
    assert.ok(validateReceipt(receipt).valid, JSON.stringify(validateReceipt(receipt).errors));
  }
});

test('AC-10 a version read that fails records a null version on each CLI surface, and the run completes', async () => {
  for (const [model, name, extra] of [['haiku', 'claude-code', {}], ['gpt-5.6-sol', 'codex', { judgeModel: 'haiku' }]]) {
    reset();
    versionFails = true;
    generate = () => ADR;
    const { receipt } = await runSkillOnModel({ skill: skillOf(), model, opts: { samples: 2, ...extra } });
    assert.deepEqual(receipt.run.harness, { name, version: null }, model);
    assert.ok(receipt.results.cases.some((c) => c.generation.n_measured >= 1), model);
    assert.ok(validateReceipt(receipt).valid, JSON.stringify(validateReceipt(receipt).errors));
  }
});

test('AC-11 a regrade carries the original\'s run.harness without reading a version, and none when the original has none', async () => {
  reset();
  versionOut.claude = '2.1.291 (Claude Code)\n';
  const texts = new Map();
  let k = 0;
  generate = () => { k += 1; const t = `Here is ADR ${k}:\n\nContext: we need a database.`; texts.set(sha(t), t); return t; };
  const skill = skillOf();
  const { receipt } = await runSkillOnModel({ skill, model: 'haiku', opts: { samples: 2, trusted: true } });
  assert.deepEqual(receipt.run.harness, { name: 'claude-code', version: '2.1.291' });
  const answers = {};
  for (const d of receipt.results.cases.flatMap((c) => c.generation.draws)) answers[d.generation_hash] = texts.get(d.generation_hash);
  reset();
  versionOut.claude = '2.1.299 (Claude Code)\n';
  const out = await regradeReceipt({ receipt, skill, answers, judgeModel: 'haiku', samples: 2, opts: { trusted: true } });
  assert.deepEqual(out.receipt.run.harness, { name: 'claude-code', version: '2.1.291' });
  assert.equal(versionCalls.length, 0, 'a regrade read a version instead of carrying the original\'s');
  assert.ok(validateReceipt(out.receipt).valid, JSON.stringify(validateReceipt(out.receipt).errors));
  assert.ok(verifyReceiptHash(out.receipt));
  const bare = JSON.parse(JSON.stringify(receipt));
  delete bare.run.harness;
  sealReceipt(bare);
  const outBare = await regradeReceipt({ receipt: bare, skill, answers, judgeModel: 'haiku', samples: 2, opts: { trusted: true } });
  assert.ok(!('harness' in outBare.receipt.run), JSON.stringify(outBare.receipt.run.harness));
  assert.ok(validateReceipt(outBare.receipt).valid);
});

test('AC-11 stale reads the recorded harness version first, and falls back to the surface\'s harness only when none is recorded', async () => {
  reset();
  generate = () => ADR;
  const { receipt } = await runSkillOnModel({ skill: skillOf(), model: 'haiku', opts: { samples: 2, trusted: true } });
  assert.deepEqual(receipt.run.harness, { name: 'claude-code', version: '2.1.285' });
  const bare = JSON.parse(JSON.stringify(receipt));
  delete bare.run.harness;
  sealReceipt(bare);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec137-stale-'));
  try {
    const file = path.join(dir, 'recorded.json');
    const bareFile = path.join(dir, 'unrecorded.json');
    fs.writeFileSync(file, JSON.stringify(receipt));
    fs.writeFileSync(bareFile, JSON.stringify(bare));
    const harnessAxis = (f) => {
      const one = staleReport([f]).receipts[0];
      assert.ok(!one.error, one.error);
      return one.axes.find((a) => a.axis === 'harness');
    };
    for (const [today, effect] of [['2.1.285', 'current'], ['2.1.290', 'advisory'], ['2.2.0', 'rerun']]) {
      versionCalls.length = 0;
      versionOut.claude = `${today} (Claude Code)\n`;
      const a = harnessAxis(file);
      assert.equal(a.recorded, 'claude-code 2.1.285', today);
      assert.equal(a.current, `claude-code ${today}`, today);
      assert.equal(a.effect, effect, today);
      assert.deepEqual(versionCalls.map(versionArgv), [['claude', '--version']], today);
    }
    const b = harnessAxis(bareFile);
    assert.equal(b.recorded, null);
    assert.equal(b.current, 'claude-code 2.2.0');
    assert.equal(b.effect, 'unknown');
    assert.match(b.reason, /the receipt records no harness/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
