// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for lib/capture.js (spec 137 AC-2, AC-4, AC-5, AC-6): the two collectors, the judged
// answer, and the reading of an answer the judge would not have seen.
//
//   node --test tests/capture.test.js
//
// No model is called. The isolated collector is run for real: lib/provider.js filesWrapper, the
// hop's own wrapper with the collect step, under bash with a shell command standing in for the CLI
// (no sudo, no eval user). The real answers AC-6 reads are the tracked transcripts under specs/,
// listed by git from DRIFTPROOF_ARTIFACT_ROOT (default: this checkout), so a gate can run these tests
// over a copy of the package.
//
// Every test name starts with the criterion it checks; spec 137's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const capture = require('../lib/capture');
const provider = require('../lib/provider');

const ARTIFACT_ROOT = process.env.DRIFTPROOF_ARTIFACT_ROOT || path.join(__dirname, '..');
const NONCE = 'a'.repeat(32);
const tmp = (tag) => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `spec137-${tag}-`));

// ── AC-4 and AC-5: the reading, on planted answers ──────────────────────────────────────────────

const POINTS = [
  'I have written the ADR to `docs/adr/0001-use-postgres.md`.',
  'Created `CHANGELOG.md` with the entry.',
  '- \u2705 Saved to `out/report.md`',
  'The ADR is saved at docs/adr/0002.md.',
  'I added a guard in lib/auth.js.',
  'I saved it to notes.txt',
  'I will now write the file report.md',
  'I also created tests/foo.test.js',
  "I've written the review to ./review.md and the summary to SUMMARY.md.",
];
const NOT_POINTS = [
  'This matches the placeholder already added to `.env.example`.',
  'git add src/payments/stripe.js .env.example',
  'See https://example.com/a.md for details',
  'The bug was introduced in lib/foo.js line 3.',
  'In `lib/auth.js`, add input validation before the query.',
  'I wrote it in Node.js using the fs module, and the loop below shows how:',
  'feat(auth): add rate limiting',
];

test('AC-4 a claim that points at a file the answer does not include is a lost answer, naming the path', () => {
  for (const a of POINTS) {
    const l = capture.lostAnswer(a);
    assert.ok(l, `not read as lost: ${a}`);
    assert.equal(l.kind, 'points_at_file', a);
    assert.ok(l.paths.length >= 1 && l.paths.every((p) => l.reason.includes(p) || l.paths.length > 3), l.reason);
  }
  assert.deepEqual(capture.lostAnswer(POINTS[0]).paths, ['docs/adr/0001-use-postgres.md']);
  assert.deepEqual(capture.lostAnswer(POINTS[8]).paths, ['./review.md', 'SUMMARY.md']);
});

test('AC-4 a path that is not the child\'s own write claim is not a pointer', () => {
  for (const a of NOT_POINTS) assert.deepEqual(capture.pointedPaths(a), [], a);
});

test('AC-4 a pointed file the answer includes is seen, by its path, a suffix of it, or with ./', () => {
  const files = [{ path: 'docs/adr/0001-use-postgres.md', bytes: 7, included: true, content: '# ADR 1' }];
  for (const reply of ['I have written the ADR to `docs/adr/0001-use-postgres.md`.', 'Saved to ./docs/adr/0001-use-postgres.md', 'Created `0001-use-postgres.md`.']) {
    assert.equal(capture.lostAnswer(capture.judgedAnswer(reply, files), files), null, reply);
  }
  // A file named but not included (over a cap) is not seen.
  const skipped = [{ path: 'big.md', bytes: 999999, included: false, why: 'over the 65536-byte file cap' }];
  assert.equal(capture.lostAnswer(capture.judgedAnswer('I saved it to big.md', skipped), skipped).kind, 'points_at_file');
});

test('AC-4 file markers the reply writes itself neither hide a line nor include a file', () => {
  // Text capture: the runner collected nothing, so the whole answer is the reply.
  const wrapped = '--- file: x.md (18 bytes) ---\nI saved it to x.md\n--- end of file: x.md ---';
  assert.deepEqual(capture.lostAnswer(wrapped, []).paths, ['x.md']);
  // A-137-4: a first-person claim, since spec 141 R-6 reads a bare claim beside lines of the reply's
  // own as a change list. The markers still include nothing.
  assert.deepEqual(capture.lostAnswer('I saved it to a.md\n\n--- file: a.md (2 bytes) ---\nhi\n--- end of file: a.md ---', []).paths, ['a.md']);
  // Files capture: the reply is what precedes the runner's own blocks, read by byte count, so a
  // marker inside the reply, or inside a file, is text.
  const inner = '--- end of file: a.md ---\nI saved b.md';
  const files = [{ path: 'a.md', bytes: Buffer.byteLength(inner), included: true, content: inner }, { path: 'c.bin', bytes: 4, included: false, why: 'not text' }];
  const reply = 'Done.\n--- file: b.md (1 bytes) ---\nx\n--- end of file: b.md ---\nI saved it to b.md';
  const answer = capture.judgedAnswer(reply, files);
  assert.equal(capture.replyOf(answer, files), reply);
  assert.deepEqual(capture.lostAnswer(answer, files).paths, ['b.md']);
  // A regrade reads the draw's captured_files, which keep no content and no reason: the same reply.
  const listed = files.map((f) => ({ path: f.path, bytes: f.bytes, included: f.included }));
  assert.equal(capture.replyOf(answer, listed), reply);
  assert.equal(capture.lostAnswer(capture.judgedAnswer('I saved it to a.md', files), files), null);
  // An answer that does not end in the runner's blocks cannot be read, and is lost.
  assert.equal(capture.lostAnswer(reply, files).kind, 'unreadable');
});

test('AC-4 a pointing line followed by the file\'s content inline is not lost', () => {
  const F = '```';
  const shown = [
    `I'll create \`docs/adr/0001-use-postgres.md\` with the following content:\n\n${F}markdown\n# ADR 1\n\nUse Postgres.\n${F}`,
    `I've updated \`src/app.js\` as follows:\n\n${F}js\nmodule.exports = 1;\n${F}`,
    `Created \`notes.md\`:\n\n${F}\n- a\n${F}`,
    'I saved it to notes.txt:\n~~~\nhello\n~~~',
  ];
  for (const a of shown) assert.equal(capture.lostAnswer(a), null, a);
  // A fence that opens after the pointing line, and before the next one, shows its file; one above
  // it shows the file only when the claim refers back to it (spec 141 A-141-1, recorded at A-137-5).
  assert.equal(capture.lostAnswer(`${F}\nhello\n${F}\nI saved this to notes.md.`), null);
  assert.deepEqual(capture.lostAnswer(`${F}\nhello\n${F}\nI saved the notes to notes.md.`).paths, ['notes.md']);
  assert.deepEqual(capture.lostAnswer(`Created \`a.md\`:\n${F}\nA\n${F}\nI also saved notes to b.md.`).paths, ['b.md']);
  assert.deepEqual(capture.lostAnswer(`Created \`a.md\`.\nI also saved notes to b.md:\n${F}\nB\n${F}`).paths, ['a.md']);
});

test('AC-5 an answer that only describes work is a lost answer; one that carries content is not', () => {
  const only = [
    "I've drafted the ADR and the changelog entry as requested.\n\nLet me know if you want changes.",
    '## Summary\n\nI\'ve updated the README and fixed the typo.\nDone.',
    '- I created the migration\n- I updated the model\n- I added tests\n\nWould you like me to run them?',
    "I'll write the commit message now.",
  ];
  for (const a of only) assert.equal((capture.lostAnswer(a) || {}).kind, 'describes_work', a);
  const content = [
    "I've written the commit message:\n\n```\nfeat: add x\n```",
    'feat(auth): add rate limiting\n\nAdds a limiter so brute-force attempts are slowed.',
    "I've reviewed the code. The main issue is the unchecked input on line 4.",
    'Here is the ADR:\n\n# ADR 1\n\nContext: we need a database.',
  ];
  for (const a of content) assert.equal(capture.lostAnswer(a), null, a);
  // With a file included, a reply that describes it is not lost: the judge sees the file.
  const files = [{ path: 'adr.md', bytes: 3, included: true, content: 'ADR' }];
  assert.equal(capture.lostAnswer(capture.judgedAnswer("I've drafted the ADR.", files), files), null);
});

// ── AC-6: the reading on real answers ───────────────────────────────────────────────────────────

test('AC-6 no tracked real answer reads as lost', () => {
  const listed = execFileSync('git', ['-C', ARTIFACT_ROOT, 'ls-files', '-z', '--', 'specs/031-artefact-claims/evidence/transcripts'], { encoding: 'utf8' })
    .split('\0').filter((f) => f.endsWith('.json') && !f.endsWith('index.json'));
  const answers = listed.map((f) => JSON.parse(fs.readFileSync(path.join(ARTIFACT_ROOT, f), 'utf8'))).filter((o) => typeof o.generation === 'string');
  assert.ok(answers.length >= 20, `expected the tracked transcripts, read ${answers.length}`);
  const lost = answers.filter((o) => capture.lostAnswer(o.generation)).map((o) => `${o.id}/${o.mode}`);
  assert.deepEqual(lost, []);
});

// The same answers line by line, before R-4's fence rule. A fence follows a tracked code review's
// "placeholder already added to `.env.example`", so the whole answer reads the same with or without
// the claim check; its line read alone is what tells them apart.
test('AC-6 no line of a tracked real answer points at a file, whether or not a fence follows it', () => {
  const listed = execFileSync('git', ['-C', ARTIFACT_ROOT, 'ls-files', '-z', '--', 'specs/031-artefact-claims/evidence/transcripts'], { encoding: 'utf8' })
    .split('\0').filter((f) => f.endsWith('.json') && !f.endsWith('index.json'));
  const answers = listed.map((f) => JSON.parse(fs.readFileSync(path.join(ARTIFACT_ROOT, f), 'utf8'))).filter((o) => typeof o.generation === 'string');
  assert.ok(answers.length >= 20, `expected the tracked transcripts, read ${answers.length}`);
  const pointing = answers.map((o) => [`${o.id}/${o.mode}`, capture.pointedPaths(o.generation)]).filter(([, p]) => p.length);
  assert.deepEqual(pointing, []);
});

// Three lines copied from real report 013 answers, which live in git-ignored call bundles (run 2
// calls 053 and 165, run 3 call 053, under specs/121-*/evidence/*/driftproof-calls): a WRITE word
// that opens the line, a clause end, then a code name in backticks after "to".
test('AC-6 three real report 013 answer lines that name code after a clause end are not pointers', () => {
  const real = [
    '- **Added comments on the non-obvious behavior.** The function mutates its arguments, and the gold discount applies to `cart.total` without recomputing it from the subtotals. That second point is a likely source of bugs.',
    '- Added one comment that explains a non-obvious fact: the discount is applied to `cart.total` rather than derived from the `item.subtotal` values just computed, which could otherwise look like a bug or inconsistency.',
    "- **Added one comment explaining the non-obvious part**: the 10% gold discount is applied to `cart.total`, which is not recomputed from the item subtotals here. That is a likely source of bugs, so it's worth flagging.",
  ];
  for (const l of real) assert.equal(capture.lostAnswer(l), null, l);
});

// ── AC-1 and AC-2: the modes' arguments, and the judged answer ──────────────────────────────────

test('AC-1 text capture: claude runs with every write tool off, codex read-only, and the reply is the answer byte for byte', () => {
  assert.equal(capture.DEFAULT_CAPTURE, 'text');
  const a = capture.claudeCaptureArgs('text');
  // A-137-4: spec 141 R-1's allow list, which holds every write tool off by construction.
  assert.deepEqual(a, ['--tools', 'Read,WebFetch,WebSearch', '--strict-mcp-config']);
  assert.equal(capture.codexSandbox('text'), 'read-only');
  const reply = 'feat: x\n\nbody';
  assert.equal(capture.judgedAnswer(reply, []), reply);
  assert.equal(capture.judgedAnswer(reply, null), reply);
  assert.throws(() => capture.claudeCaptureArgs('both'), { code: 'CAPTURE_MODE' });
});

// The setting's source (spec.md Q2). A skill directory is the skill's own content, so its rc may
// not pick the mode that judges it: `capture` there is dropped and named, as max_cases is. The
// working directory's rc, or the flag, sets it. Read through the CLI on a stub run: nothing
// answers, no CLI is spawned, and the receipt is written under a temp directory.
test('AC-1 a skill directory\'s .driftproofrc cannot switch capture to files; the working directory\'s can', () => {
  const work = tmp('rc');
  try {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME || work, TMPDIR: process.env.TMPDIR || os.tmpdir(), DRIFTPROOF_STUB: '1' };
    if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;
    const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'driftproof'), ...args], { cwd: work, env, encoding: 'utf8', timeout: 120000 });
    const modeIn = (out) => {
      const got = fs.readdirSync(path.join(work, out)).filter((f) => f.endsWith('.json'));
      assert.equal(got.length, 1, `receipts in ${out}: ${got.join(', ')}`);
      return JSON.parse(fs.readFileSync(path.join(work, out, got[0]), 'utf8')).run.capture;
    };
    assert.equal(cli('init', 'sk').status, 0);
    const rcPath = path.join(work, 'sk', '.driftproofrc');
    fs.writeFileSync(rcPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(rcPath, 'utf8')), capture: 'files' }));
    const a = cli('run', 'sk', '--out', 'out-skill');
    assert.equal(a.status, 0, a.stderr.slice(-400));
    assert.match(a.stdout, /answer capture: text/);
    assert.match(a.stderr, /sets [^\n]*capture[^\n]*; ignored/);
    assert.deepEqual(modeIn('out-skill'), { mode: 'text' });
    fs.writeFileSync(path.join(work, '.driftproofrc'), JSON.stringify({ capture: 'files' }));
    const b = cli('run', 'sk', '--out', 'out-work');
    assert.equal(b.status, 0, b.stderr.slice(-400));
    assert.match(b.stdout, /answer capture: files/);
    assert.deepEqual(modeIn('out-work'), { mode: 'files' });
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('AC-2 files capture: claude may edit with Bash and Task off, codex writes its workspace, and each file is a block', () => {
  // A-137-4: spec 141 R-1's allow list; Bash and Task stay off, with every other tool that runs code.
  assert.deepEqual(capture.claudeCaptureArgs('files'), ['--permission-mode', 'acceptEdits', '--tools', 'Read,Write,Edit,NotebookEdit,WebFetch,WebSearch', '--strict-mcp-config']);
  assert.equal(capture.codexSandbox('files'), 'workspace-write');
  const files = [{ path: 'a.md', bytes: 2, included: true, content: 'hi' }, { path: 'b.bin', bytes: 4, included: false, why: 'not text' }];
  assert.equal(capture.judgedAnswer('done', files), 'done\n\n--- file: a.md (2 bytes) ---\nhi\n--- end of file: a.md ---\n\n--- file: b.bin (4 bytes, not included: not text) ---');
  assert.equal(capture.replyOf(capture.judgedAnswer('done', files), files), 'done');
  assert.equal(capture.replyOf(capture.judgedAnswer('', files), files), '');
});

// A planted workspace: text files in a nested directory, a binary, an oversized file, a link to a
// file outside the workspace and one to a directory, and more files than the cap.
function plantWorkspace(dir, outside) {
  fs.mkdirSync(path.join(dir, 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'adr', '0001.md'), '# ADR 1\n\nUse Postgres.\n');
  fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(capture.WORKSPACE_LIMITS.fileBytes + 1));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'not the child\'s\n');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
  fs.symlinkSync(outside, path.join(dir, 'linkdir'));
  for (let i = 0; i < capture.WORKSPACE_LIMITS.files; i++) fs.writeFileSync(path.join(dir, `z${String(i).padStart(3, '0')}.txt`), `${i}\n`);
}

test('AC-2 the trusted collector takes regular files in byte order, within the caps, and never follows a link', () => {
  const dir = tmp('ws'); const outside = tmp('out');
  try {
    plantWorkspace(dir, outside);
    const files = capture.collectWorkspace(dir);
    const paths = files.map((f) => f.path);
    assert.ok(!paths.some((p) => p.startsWith('link')), 'a link was collected');
    assert.ok(!files.some((f) => f.included && /not the child/.test(f.content)), 'a link was followed');
    // A-137-4: every regular file is named (spec 141 R-3): the three planted and the cap's count.
    assert.equal(files.length, capture.WORKSPACE_LIMITS.files + 3);
    assert.deepEqual(paths.slice(0, 3), ['b.bin', 'big.txt', 'docs/adr/0001.md']);
    const by = Object.fromEntries(files.map((f) => [f.path, f]));
    assert.equal(by['docs/adr/0001.md'].included, true);
    assert.equal(by['b.bin'].why, 'not text: binary (holds a NUL byte)');
    assert.match(by['big.txt'].why, /file cap/);
    assert.match(files[files.length - 1].why, /-file cap/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

// The hop's wrapper with its collect step, run as this user with `sh -c <script>` as the CLI: the
// script plants the workspace in the wrapper's fresh directory and prints a CLI reply.
function runFilesWrapper(script) {
  const wrapper = provider.filesWrapper(NONCE);
  const r = spawnSync('bash', ['-c', wrapper, provider.HOP_LABEL, 'sh', '-c', script], { encoding: 'utf8', input: '', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || os.tmpdir() } });
  return r;
}

test('AC-2 the isolated collector, run for real, frames the same files the trusted collector reads, and removes its directory', { skip: spawnSync('bash', ['-c', 'command -v setsid && command -v base64 && command -v stat'], { encoding: 'utf8' }).status !== 0 && 'setsid, base64 or stat is not on this box' }, () => {
  const outside = tmp('out');
  try {
    // The planted tree, written by the stand-in CLI inside the wrapper's own directory; pwd is
    // printed so the test can see the directory is gone after.
    const q = (s) => `'${s.replace(/'/g, "'\\''")}'`;
    const script = [
      'mkdir -p docs/adr', 'printf "# ADR 1\\n\\nUse Postgres.\\n" > docs/adr/0001.md', 'printf "\\000\\001\\002\\003" > b.bin',
      `head -c ${capture.WORKSPACE_LIMITS.fileBytes + 1} /dev/zero | tr "\\000" x > big.txt`,
      `ln -s ${q(path.join(outside, 'secret.txt'))} link.txt`, `ln -s ${q(outside)} linkdir`,
      `i=0; while [ $i -lt ${capture.WORKSPACE_LIMITS.files} ]; do printf "%d\\n" $i > "z$(printf %03d $i).txt"; i=$((i+1)); done`,
      'printf "{\\"type\\":\\"result\\",\\"result\\":\\"saved to docs/adr/0001.md\\",\\"cwd\\":\\"%s\\"}" "$(pwd)"',
    ].join('; ');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'not the child\'s\n');
    const r = runFilesWrapper(script);
    assert.equal(r.status, 0, r.stderr);
    const w = capture.parseWorkspace(r.stdout, NONCE);
    assert.ok(Array.isArray(w.files), 'the frame was not read');
    const reply = JSON.parse(w.stdout);
    assert.equal(reply.result, 'saved to docs/adr/0001.md');
    assert.ok(!fs.existsSync(reply.cwd), 'the wrapper left its directory');
    // The same tree, planted here, read by the trusted collector: the two lists agree.
    const dir = tmp('ws');
    try {
      plantWorkspace(dir, tmp('out2'));
      const strip = (fs2) => fs2.map((f) => ({ path: f.path, bytes: f.bytes, included: f.included, why: f.why || null }));
      assert.deepEqual(strip(w.files), strip(capture.collectWorkspace(dir)));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    assert.equal(capture.lostAnswer(capture.judgedAnswer(reply.result, w.files), w.files), null);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});

test('AC-2 a frame that is absent, unended or malformed is no workspace, never an empty one', () => {
  assert.equal(capture.parseWorkspace('{"result":"x"}', NONCE).files, null);
  // Cut off after a file's content, as a stream ends when the wrapper is killed: no END line.
  assert.equal(capture.parseWorkspace(`{"result":"x"}\n${NONCE} WORKSPACE\n${NONCE} FILE YS5tZA== 2\naGk=`, NONCE).files, null);
  assert.equal(capture.parseWorkspace(`{"result":"x"}\n${NONCE} WORKSPACE\nnot a frame line\n${NONCE} END\n`, NONCE).files, null);
  const ok = capture.parseWorkspace(`{"result":"x"}\n${NONCE} WORKSPACE\n${NONCE} FILE YS5tZA== 2\naGk=\n${NONCE} END\n`, NONCE);
  assert.equal(ok.stdout, '{"result":"x"}');
  assert.deepEqual(ok.files, [{ path: 'a.md', bytes: 2, included: true, content: 'hi' }]);
  // A frame the reply itself carries before the wrapper's own is not the one read.
  const forged = `${NONCE} WORKSPACE\n${NONCE} FILE YS5tZA== 2\naGk=\n${NONCE} END\n`;
  assert.deepEqual(capture.parseWorkspace(`{"result":"${forged.replace(/\n/g, '\\n')}"}\n${NONCE} WORKSPACE\n${NONCE} END\n`, NONCE).files, []);
});
