// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 149, spec 182. Literal expectations, an exhaustive independent oracle,
// product library and CLI, and plants that must be seen by the same assertions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'specs/182-skill-carries-its-test/fixtures');
const BIN = path.join(ROOT, 'bin/driftproof');
const GUARD = path.join(FIX, 'guard.cjs');
const corpus = JSON.parse(fs.readFileSync(path.join(FIX, 'corpus.json'), 'utf8'));
const plants = JSON.parse(fs.readFileSync(path.join(FIX, 'plants.json'), 'utf8'));
const TEMP = fs.mkdtempSync('/var/tmp/issue149-red-');
let serial = 0;
test.after(() => fs.rmSync(TEMP, { recursive: true, force: true }));
const fresh = () => { const p = path.join(TEMP, String(++serial)); fs.mkdirSync(p); return p; };
const put = (dir, rel, text) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
function subject(s) {
  const dir = fresh();
  for (const [rel, text] of Object.entries(s.files)) put(dir, rel, text);
  const raw = s.shape === 'array' ? s.cases : { [s.shape || 'cases']: s.cases };
  put(dir, 'evals/evals.json', JSON.stringify(raw));
  return dir;
}
function product(dir) {
  const lib = require('../lib/overlap');
  assert.equal(typeof lib.overlapSkill, 'function', 'AC-7: overlapSkill is the public library door');
  return lib.overlapSkill(dir);
}
const expected = (s) => ({ skill: 'specimen', cases: structuredClone(s.expected) });
const measure = (report, want, id) => assert.deepEqual(report, want, id + ': exact report over the whole case list');
function oracleTokens(text) {
  return [...text.matchAll(/[\p{L}\p{M}\p{Nd}]+/gu)].map((m) => ({
    word: m[0].normalize('NFC').toLowerCase(),
    line: 1 + (text.slice(0, m.index).match(/\r\n|\r|\n/g) || []).length,
  }));
}
// Exhaustive enumeration, no dynamic-programming matcher or product import.
function exhaustive(prompt, files, id) {
  const words = oracleTokens(prompt).map((x) => x.word);
  const paths = Object.keys(files).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  for (let length = words.length; length > 0; length--) {
    for (const file of paths) {
      const tokens = oracleTokens(files[file]);
      for (let at = 0; at + length <= tokens.length; at++) {
        for (let start = 0; start + length <= words.length; start++) {
          if (words.slice(start, start + length).every((w, k) => tokens[at + k].word === w)) {
            return { id, prompt_words: words.length, longest_words: length, match: { file, line: tokens[at].line, prompt_start: start, words: words.slice(start, start + length) } };
          }
        }
      }
    }
  }
  return { id, prompt_words: words.length, longest_words: 0, match: null };
}
for (const s of corpus) test(s.ac + ' product: ' + s.name, () => measure(product(subject(s)), expected(s), s.ac));

test('AC-3 product: exhaustive maxima over short repeated-word inputs', () => {
  // Enumerate the entire binary vocabulary through length three, then compare
  // every prompt with every file subject. Inputs stay below loader bounds.
  const strings = ['a', 'b', 'a a', 'a b', 'b a', 'b b', 'a a a', 'a a b', 'a b a', 'a b b', 'b a a', 'b a b', 'b b a', 'b b b'];
  const s = { files: { 'SKILL.md': '# specimen\n', 'ref.txt': '' }, cases: strings.map((prompt, i) => ({ id: 'c' + i, prompt, rubric: 'Words.' })) };
  const dir = subject(s);
  for (const text of strings) {
    put(dir, 'ref.txt', text);
    s.files['ref.txt'] = text;
    const want = { skill: 'specimen', cases: strings.map((prompt, i) => exhaustive(prompt, s.files, 'c' + i)) };
    measure(product(dir), want, 'AC-3');
  }
});

function mutate(s, kind) {
  const report = expected(s);
  const hit = report.cases.find((x) => x.match);
  const zero = report.cases.find((x) => !x.match);
  switch (kind) {
    case 'omit-bundle': hit.longest_words = 0; hit.match = null; break;
    case 'include-ignored': zero.longest_words = 5; zero.match = { file: 'evals/evals.json', line: 1, prompt_start: 0, words: ['needle', 'hidden', 'inside', 'suite', 'only'] }; break;
    case 'undercount': hit.longest_words--; hit.match.words.pop(); break;
    case 'bridge-gap': case 'join-files': hit.longest_words = 4; hit.match.words = ['alpha', 'beta', 'gamma', 'delta']; break;
    case 'first-hit': hit.longest_words = 2; hit.match.words = ['alpha', 'beta']; hit.match.line = 2; break;
    case 'wrong-line': hit.match.line++; break;
    case 'wrong-file': hit.match.file = 'z.txt'; hit.match.line = 1; break;
    case 'wrong-start': hit.match.prompt_start = 4; break;
    case 'drop-zero': report.cases.splice(report.cases.indexOf(zero), 1); break;
    case 'duplicate': report.cases.push(structuredClone(hit)); break;
    case 'zero-location': zero.match = { file: 'SKILL.md', line: 1, prompt_start: 0, words: [] }; break;
    case 'denominator': hit.prompt_words--; break;
    case 'nondeterministic': report.time = 'changed'; break;
    case 'verdict': report.verdict = 'passing'; break;
    default: throw new Error('Unknown plant ' + kind);
  }
  return report;
}
for (const p of plants) test(p.ac + ' plant seen: ' + p.id, () => {
  const s = corpus.find((x) => x.name === p.scenario);
  assert.ok(s, p.id + ': fixture exists');
  assert.throws(() => measure(mutate(s, p.mutation), expected(s), p.ac), (e) => e instanceof assert.AssertionError && e.message.includes(p.ac), p.id + ': the criterion must see its violation');
});
function safeEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^NODE_OPTIONS$/.test(key)) env[key] = value;
  return { ...env, TMPDIR: '/var/tmp', ...extra };
}
function child(args, cwd, extra = {}) {
  const input = args[0] === BIN && args[1] === 'overlap' ? args[2] : extra.SPEC182_INPUT;
  const r = spawnSync(process.execPath, ['--require', GUARD, ...args], { cwd, env: safeEnv({ SPEC182_INPUT: input || '', ...extra }), stdio: ['ignore', 'pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 1800000, maxBuffer: 16 * 1024 * 1024 });
  r.attempts = r.output && r.output[3] || '';
  return r;
}
function snapshot(dir) {
  const rows = [];
  function visit(here) {
    for (const name of fs.readdirSync(here).sort()) {
      const p = path.join(here, name);
      const st = fs.lstatSync(p);
      const rel = path.relative(dir, p);
      rows.push([rel, st.mode, st.isSymbolicLink() ? fs.readlinkSync(p) : st.isDirectory() ? 'directory' : crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]);
      if (st.isDirectory()) visit(p);
    }
  }
  visit(dir);
  return rows;
}
function validCli(r, want) {
  assert.equal(r.error, undefined, 'AC-6: child completed');
  assert.equal(r.status, 0, 'AC-6: CLI success: ' + r.stderr);
  assert.equal(r.stderr, '', 'AC-6: no forbidden operation or other stderr');
  assert.equal(r.attempts, '', 'AC-15: no forbidden attempts, including caught ones');
  assert.equal(r.stdout, JSON.stringify(want, null, 2) + '\n', 'AC-5: complete JSON report');
}
test('AC-5/AC-6 product: real CLI, repeatability, alternate cwd/provider, no receipt read, no writes', () => {
  const s = corpus[0];
  const dir = subject(s);
  const work = fresh();
  const other = fresh();
  put(work, 'receipts/existing.json', 'deliberately invalid receipt\n');
  put(work, '.driftproofrc', 'deliberately invalid rc\n');
  const before = snapshot(TEMP);
  const one = child([BIN, 'overlap', dir], work, { CLAUDE_PROVIDER: 'api' });
  const two = child([BIN, 'overlap', dir], other, { CLAUDE_PROVIDER: 'cli' });
  assert.deepEqual(snapshot(TEMP), before, 'AC-6: the full input and working tree is byte-identical');
  validCli(one, expected(s));
  validCli(two, expected(s));
  assert.equal(one.stdout, two.stdout, 'AC-6: repeated reports match byte for byte');
});
test('AC-6 product: repeated library reads have no effect on the input or cwd', () => {
  const dir = subject(corpus[0]);
  const before = snapshot(TEMP);
  const one = product(dir);
  const two = product(dir);
  assert.deepEqual(snapshot(TEMP), before, 'AC-6: library did not write');
  measure(one, expected(corpus[0]), 'AC-6');
  measure(two, one, 'AC-6');
});
const operations = [
  ['P-6b', 'receipt-read', "require('node:fs').readFileSync('receipts/existing.json')"],
  ['P-6c', 'write', "require('node:fs').writeFileSync('planted.txt', 'plant')"],
  ['P-6d', 'subprocess', "require('node:child_process').spawnSync(process.execPath, ['-e', '0'])"],
  ['P-6e', 'network', "require('node:https').get('https://example.invalid')"],
  ['P-6f', 'provider', 'require(' + JSON.stringify(path.join(ROOT, 'lib/provider.js')) + ').complete({})'],
];
for (const [id, kind, code] of operations) test('AC-6 plant seen: ' + id, () => {
  const work = fresh();
  put(work, 'receipts/existing.json', 'unchanged');
  const before = snapshot(work);
  const r = child(['-e', code], work);
  assert.notEqual(r.status, 0, id + ': forbidden operation must fail');
  assert.ok(r.stderr.includes('OVERLAP_GUARD: ' + kind), id + ': independent guard saw this operation');
  assert.deepEqual(snapshot(work), before, id + ': the guard stopped the side effect');
});
function rejectedCli(r, reason) {
  assert.equal(r.error, undefined, 'AC-7: child completed');
  assert.equal(r.status, 2, 'AC-7: refusal exits 2');
  assert.equal(r.stdout, '', 'AC-7: refusal emits no report');
  assert.match(r.stderr, reason, 'AC-7: refusal names its reason');
}
const invalid = [
  { name: 'missing skill', setup: (d) => fs.unlinkSync(path.join(d, 'SKILL.md')), reason: /SKILL\.md/ },
  { name: 'missing suite', setup: (d) => fs.unlinkSync(path.join(d, 'evals/evals.json')), reason: /evals\/evals\.json/ },
  { name: 'malformed suite', setup: (d) => put(d, 'evals/evals.json', '{'), reason: /JSON|Unexpected|property/i },
  { name: 'duplicate case id', setup: (d) => put(d, 'evals/evals.json', JSON.stringify({ cases: [{ id: 'same', prompt: 'a', rubric: 'r' }, { id: 'same', prompt: 'b', rubric: 'r' }] })), reason: /unique|same/, code: 'DUPLICATE_CASE_ID' },
  { name: 'missing prompt', setup: (d) => put(d, 'evals/evals.json', JSON.stringify([{ rubric: 'r' }])), reason: /prompt/ },
  { name: 'linked skill', setup: (d) => { put(d, 'instructions.txt', '# specimen'); fs.unlinkSync(path.join(d, 'SKILL.md')); fs.symlinkSync('instructions.txt', path.join(d, 'SKILL.md')); }, reason: /symbolic link/, code: 'SKILL_LINK' },
  { name: 'linked bundled file', setup: (d) => fs.symlinkSync('SKILL.md', path.join(d, 'linked.txt')), reason: /symbolic link/, code: 'SKILL_LINK' },
  { name: 'linked suite', setup: (d) => { put(d, 'suite.txt', '[]'); fs.unlinkSync(path.join(d, 'evals/evals.json')); fs.symlinkSync('../suite.txt', path.join(d, 'evals/evals.json')); }, reason: /symbolic link/, code: 'SKILL_LINK' },
  { name: 'file bound', setup: (d) => { const { SKILL_MAX_FILES } = require('../config'); for (let i = 0; i < SKILL_MAX_FILES; i++) put(d, 'many/f' + i, ''); }, reason: /SKILL_MAX_FILES/, code: 'INPUT_BOUND' },
  { name: 'depth bound', setup: (d) => { const { SKILL_MAX_DEPTH } = require('../config'); put(d, 'deep/'.repeat(SKILL_MAX_DEPTH + 1) + 'file', ''); }, reason: /SKILL_MAX_DEPTH/, code: 'INPUT_BOUND' },
  { name: 'byte bound', setup: (d) => { const { SKILL_MAX_BYTES } = require('../config'); put(d, 'large.txt', Buffer.alloc(SKILL_MAX_BYTES + 1)); }, reason: /SKILL_MAX_BYTES/, code: 'INPUT_BOUND' },
  { name: 'case bound', setup: (d) => { const { SUITE_MAX_CASES } = require('../config'); put(d, 'evals/evals.json', JSON.stringify(Array.from({ length: SUITE_MAX_CASES + 1 }, (_, i) => ({ id: 'c' + i, prompt: 'a', rubric: 'r' })))); }, reason: /SUITE_MAX_CASES/, code: 'INPUT_BOUND' },
  { name: 'prompt bound', setup: (d) => { const { CASE_MAX_CHARS } = require('../config'); put(d, 'evals/evals.json', JSON.stringify([{ prompt: 'x'.repeat(CASE_MAX_CHARS + 1), rubric: 'r' }])); }, reason: /CASE_MAX_CHARS/, code: 'INPUT_BOUND' },
];
for (const s of invalid) {
  test('AC-7 product: library and CLI refuse ' + s.name, () => {
    const d = subject({ files: { 'SKILL.md': '# specimen\n' }, cases: [{ id: 'valid', prompt: 'a', rubric: 'r' }] });
    s.setup(d);
    const { loadSkill } = require('../lib/skill');
    let reference;
    try { loadSkill(d); } catch (e) { reference = e; }
    assert.ok(reference, 'AC-7: existing loader refuses this subject');
    assert.throws(() => product(d), (e) => e.message === reference.message && e.code === reference.code, 'AC-7: overlap preserves the loader refusal');
    rejectedCli(child([BIN, 'overlap', d], fresh()), s.reason);
  });
  test('AC-7 plant seen: P-7 zero report instead of ' + s.name + ' refusal', () => {
    assert.throws(() => rejectedCli({ status: 0, stdout: JSON.stringify({ skill: 'specimen', cases: [] }), stderr: '' }, s.reason), (e) => e instanceof assert.AssertionError && e.message.includes('AC-7'));
  });
}
const badArgs = [[], ['one', 'two'], ['--max-cases', '1'], ['--out', 'report.json'], ['--json'], ['--unexpected']];
for (const args of badArgs) test('AC-7 product: reject arguments ' + JSON.stringify(args), () => rejectedCli(child([BIN, 'overlap', ...args], fresh()), /usage|argument|flag|takes/i));

function docsOracle(text) {
  const start = text.search(/^## (?:Skill prompt overlap|Check skill prompt overlap)\s*$/m);
  assert.ok(start >= 0, 'AC-8: command has its own documented section');
  const remainder = text.slice(start);
  const end = remainder.slice(3).search(/^## /m);
  const section = end < 0 ? remainder : remainder.slice(0, end + 3);
  for (const want of [/driftproof overlap <skill-dir>/, /longest/i, /consecutive/i, /Unicode/i, /case.insensitive|lowercase/i, /punctuation/i, /NFC/, /evals\//, /bundled/i, /file/i, /line/i, /offline/i, /receipt/i, /verdict/i, /does not prove|cannot prove/i]) assert.match(section, want, 'AC-8: comparison, scope, location and limits are documented');
  assert.doesNotMatch(section, /(?:proves?|guarantees?) (?:that )?(?:there is )?no (?:leakage|contamination)|(?:zero|no) overlap means (?:no leakage|clean)/i, 'AC-8: no unsupported inference');
}
const docControl = '## Skill prompt overlap\n\ndriftproof overlap <skill-dir> reports the longest consecutive words in bundled files outside evals/, with file and line. Unicode words use NFC and lowercase. Punctuation separates words. It runs offline, reads no receipt and moves no verdict. It cannot prove absence of leakage.\n';
test('AC-8 product: README documents the comparison and its limits', () => {
  const text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'); docsOracle(text);
  reviewedSurface(readmeSection(text), wording.readme);
});
test('AC-8 product: help exposes the new CLI command and its purpose', () => {
  const r = child([BIN, 'help'], fresh());
  assert.equal(r.status, 0);
  assert.match(r.stdout, /driftproof overlap <skill-dir>/, 'AC-8: help names the command');
  const start = r.stdout.indexOf(wording.help.split('\n')[0]);
  const end = r.stdout.indexOf('\n  driftproof ', start + 1);
  reviewedSurface(r.stdout.slice(start, end < 0 ? undefined : end + 1), wording.help);
  assert.match(r.stdout, /overlap[^\n]*(?:offline|consecutive)|(?:offline|consecutive)[^\n]*overlap/i, 'AC-8: help names the text measurement');
});
test('AC-8 plant seen: P-8a command documentation removed', () => {
  docsOracle(docControl);
  assert.throws(() => docsOracle('## Unrelated\n'), (e) => e instanceof assert.AssertionError && e.message.includes('AC-8'));
});
test('AC-8 plant seen: P-8b zero proves no leakage', () => assert.throws(() => docsOracle(docControl + 'Zero overlap proves no leakage.\n'), (e) => e instanceof assert.AssertionError && e.message.includes('AC-8')));

for (const s of corpus) test(s.ac + ' product CLI: ' + s.name, () => {
  const dir = subject(s);
  validCli(child([BIN, 'overlap', dir], fresh()), expected(s));
});
test('AC-6 product: direct library path under the independent guards', () => {
  const s = corpus[0];
  const dir = subject(s);
  const work = fresh();
  put(work, 'receipts/existing.json', 'deliberately invalid receipt');
  const before = snapshot(TEMP);
  const library = path.join(ROOT, 'lib/overlap.js');
  const code = 'const report = require(' + JSON.stringify(library) + ').overlapSkill(' + JSON.stringify(dir) + '); process.stdout.write(JSON.stringify(report, null, 2) + "\\n");';
  const r = child(['-e', code], work, { SPEC182_INPUT: dir });
  assert.deepEqual(snapshot(TEMP), before, 'AC-6: direct library path leaves inputs byte-identical');
  validCli(r, expected(s));
});
test('AC-1 product: a bundled binary file is searched rather than skipped by extension', () => {
  const s = { files: { 'SKILL.md': '# specimen\n' }, cases: [{ id: 'binary', prompt: 'walnut copper pear', rubric: 'Words.' }] };
  const dir = subject(s);
  put(dir, 'ref.bin', Buffer.concat([Buffer.from([0xff, 0x00]), Buffer.from('walnut copper pear'), Buffer.from([0x00, 0xfe])]));
  measure(product(dir), { skill: 'specimen', cases: [{ id: 'binary', prompt_words: 3, longest_words: 3, match: { file: 'ref.bin', line: 1, prompt_start: 0, words: ['walnut', 'copper', 'pear'] } }] }, 'AC-1');
});
test('AC-5 product: the loader array suite shape uses the same complete rows', () => {
  const s = structuredClone(corpus.find((x) => x.name === 'suite normalization'));
  s.shape = 'array';
  measure(product(subject(s)), expected(s), 'AC-5');
});

for (const s of corpus) test(s.ac + ' fixture control: literal report agrees with the exhaustive oracle for ' + s.name, () => {
  const files = s.name === 'scope' ? { 'SKILL.md': s.files['SKILL.md'], 'scripts/deep/hint.js': s.files['scripts/deep/hint.js'] } : s.files;
  const independentlyRead = s.cases.map((c, i) => exhaustive(c.prompt || c.input || c.task, files, s.expected[i].id));
  measure({ skill: 'specimen', cases: independentlyRead }, expected(s), s.ac);
});
test('AC-1 product: a link to the outer skill directory is accepted as run accepts it', () => {
  const s = corpus[0];
  const dir = subject(s);
  const outside = fresh();
  const alias = path.join(outside, 'alias');
  fs.symlinkSync(dir, alias);
  measure(product(alias), expected(s), 'AC-1');
  validCli(child([BIN, 'overlap', alias], fresh()), expected(s));
});
test('AC-1 product: links under ignored names are not searched or followed', () => {
  const s = { files: { 'SKILL.md': '# specimen\n' }, cases: [{ id: 'ignored', prompt: 'walnut copper pear', rubric: 'Words.' }] };
  const dir = subject(s);
  const external = fresh();
  put(external, 'prompt.txt', 'walnut copper pear');
  fs.symlinkSync(external, path.join(dir, '.git'));
  fs.symlinkSync(external, path.join(dir, 'node_modules'));
  fs.symlinkSync(path.join(external, 'prompt.txt'), path.join(dir, '.DS_Store'));
  measure(product(dir), { skill: 'specimen', cases: [{ id: 'ignored', prompt_words: 3, longest_words: 0, match: null }] }, 'AC-1');
});


// A-182-1: findings are checked independently at their causes.
const wording = JSON.parse(fs.readFileSync(path.join(FIX, 'wording.json'), 'utf8'));
function readmeSection(text) {
  const start = text.indexOf('## Skill prompt overlap\n');
  assert.ok(start >= 0, 'AC-16: reviewed section exists');
  const end = text.indexOf('\n## ', start + 3);
  return text.slice(start, end < 0 ? undefined : end).trim() + '\n';
}
function reviewedSurface(text, want) {
  assert.equal(text.trim(), want.trim(), 'AC-16: every sentence is semantically reviewed; no contamination, lift or confidence inference');
}
for (const [id, sentence] of [
  ['P-16a', 'Zero overlap certifies a clean suite.'],
  ['P-16b', 'This overlap explains the measured lift.'],
  ['P-16c', 'The result gives high confidence.'],
]) for (const surface of ['readme', 'help']) test('AC-16 plant seen: ' + id + ' ' + surface, () => {
  reviewedSurface(wording[surface], wording[surface]);
  assert.throws(() => reviewedSurface(wording[surface] + sentence, wording[surface]), /AC-16/);
});

test('AC-9 product: bundled receipt bytes, invoked from inside the skill', () => {
  const d = subject({ files: { 'SKILL.md': '# specimen\n', 'receipts/run.json': 'alpha beta' }, cases: [{ id: 'c', prompt: 'alpha beta', rubric: 'r' }] });
  const want = { skill: 'specimen', cases: [{ id: 'c', prompt_words: 2, longest_words: 2, match: { file: 'receipts/run.json', line: 1, prompt_start: 0, words: ['alpha', 'beta'] } }] };
  measure(product(d), want, 'AC-9'); validCli(child([BIN, 'overlap', d], d), want);
  assert.throws(() => measure({ skill: 'specimen', cases: [{ id: 'c', prompt_words: 2, longest_words: 0, match: null }] }, want, 'P-9'), /P-9/);
});

for (const [id, kind, code] of operations) for (const door of ['library', 'CLI']) test('AC-15 caught-attempt plant seen: ' + id + ' ' + door, () => {
  const d = subject(corpus[0]); const work = fresh(); put(work, 'receipts/existing.json', 'unchanged');
  const before = snapshot(TEMP);
  const args = door === 'CLI' ? [BIN, 'overlap', d] : ['-e', 'process.stdout.write(JSON.stringify(require(' + JSON.stringify(path.join(ROOT, 'lib/overlap.js')) + ').overlapSkill(' + JSON.stringify(d) + '), null, 2) + "\\n")'];
  const r = child(args, work, { SPEC182_INPUT: d, SPEC182_PLANT: code });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, JSON.stringify(expected(corpus[0]), null, 2) + '\n');
  assert.equal(r.attempts, kind + '\n', 'P-15: attempt survives a caught exception');
  assert.throws(() => validCli(r, expected(corpus[0])), /AC-15/);
  assert.deepEqual(snapshot(TEMP), before, 'AC-15: no side effects');
});

test('AC-12 product and plant: unnamed outer aliases retain loader identity', () => {
  const d = subject({ files: { 'SKILL.md': 'instructions\n' }, cases: [{ id: 'c', prompt: 'instructions', rubric: 'r' }] });
  const work = fresh(); const one = path.join(work, 'one'); const two = path.join(work, 'two');
  fs.symlinkSync(d, one); fs.symlinkSync(d, two);
  const a = product(one), b = product(two);
  assert.equal(a.skill, 'one'); assert.equal(b.skill, 'two'); assert.deepEqual(a.cases, b.cases);
  measure(product(one), a, 'AC-12'); measure(product(two), b, 'AC-12');
  validCli(child([BIN, 'overlap', one], fresh()), a); validCli(child([BIN, 'overlap', two], fresh()), b);
  assert.throws(() => measure({ ...b, skill: a.skill }, b, 'P-12'), /P-12/);
});

const decoding = [
  ['BOM', Buffer.from([0xef,0xbb,0xbf,0x61,0x6c,0x70,0x68,0x61,0x0d,0x0a,0x62,0x65,0x74,0x61]), ['alpha','beta'], 1],
  ['malformed', Buffer.from([0xff,0x0a,0x61,0x6c,0x70,0x68,0x61,0xc3,0x28,0x62,0x65,0x74,0x61]), ['alpha','beta'], 2],
  ['UTF-16', Buffer.from([0xff,0xfe,0x61,0,0x6c,0,0x70,0,0x68,0,0x61,0,0x20,0,0x62,0,0x65,0,0x74,0,0x61,0]), [], null],
];
for (const [name, bytes, words, line] of decoding) test('AC-13 product and literal plant: ' + name, () => {
  const d = subject({ files: { 'SKILL.md': '# specimen\n' }, cases: [{ id: 'c', prompt: 'alpha beta', rubric: 'r' }] }); put(d, 'bytes.bin', bytes);
  const row = { id: 'c', prompt_words: 2, longest_words: words.length, match: words.length ? { file: 'bytes.bin', line, prompt_start: 0, words } : null };
  const want = { skill: 'specimen', cases: [row] };
  measure(product(d), want, 'AC-13'); validCli(child([BIN, 'overlap', d], fresh()), want);
  const bad = structuredClone(want); bad.cases[0].longest_words = name === 'UTF-16' ? 2 : 1;
  assert.throws(() => measure(bad, want, 'P-13'), /P-13/);
});

function safeRefusal(r) {
  rejectedCli(r, /.+/);
  assert.equal(r.stderr.split('\n').length, 2, 'AC-14: exactly one stderr line');
  assert.doesNotMatch(r.stderr.slice(0,-1), /[\x00-\x1f\x7f-\x9f\u2028\u2029]/, 'AC-14: controls escaped');
  assert.ok(r.stderr.length <= 12320, 'AC-14: bounded before JSON escaping');
  const prefix = 'overlap refused: ';
  assert.ok(r.stderr.startsWith(prefix), 'AC-14: refusal reason is JSON encoded');
  const reason = JSON.parse(r.stderr.slice(prefix.length, -1));
  assert.equal(typeof reason, 'string', 'AC-14: decoded reason is text');
  assert.ok(reason.length <= 2048, 'AC-14: decoded reason is at most 2,048 characters');
}
for (const kind of ['id', 'path']) test('AC-14 product and hostile ' + kind + ' plant', () => {
  const hostile = '\n\x1b[31m forged\r\u2028\u2029' + 'x'.repeat(kind === 'id' ? 5000 : 20);
  const d = kind === 'id' ? subject({ files: { 'SKILL.md': '# specimen\n' }, cases: [{ id: hostile, rubric: 'r' }] }) : path.join(fresh(), hostile);
  const r = child([BIN, 'overlap', d], fresh()); safeRefusal(r);
  assert.throws(() => safeRefusal({ status: 2, stdout: '', stderr: 'refused ' + hostile + '\n' }), /AC-14/);
});

// A-182-4, PR 230 F-1: remove the real CLI bound under the same guards.
test('AC-14 plant seen: P-14c removes the refusal reason slice', () => {
  const hostile = '\n\x1b[31m forged\r\u2028\u2029' + 'x'.repeat(5000);
  const d = subject({ files: { 'SKILL.md': '# specimen\n' }, cases: [{ id: hostile, rubric: 'r' }] });
  const original = child([BIN, 'overlap', d], fresh());
  safeRefusal(original);
  const code = 'const fs=require("node:fs"),Module=require("node:module"),path=require("node:path"),file=' + JSON.stringify(BIN) + ';'
    + 'const source=fs.readFileSync(file,"utf8"),needle="String(e && e.message || e).slice(0, 2048)";'
    + 'require("node:assert/strict").equal(source.split(needle).length,2,"P-14c: exactly one refusal bound is mutated");'
    + 'const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));'
    + 'process.argv=[process.execPath,file,"overlap",' + JSON.stringify(d) + '];'
    + 'm._compile(source.replace(needle,"String(e && e.message || e)"),file);';
  const unbounded = child(['-e', code], fresh(), { SPEC182_INPUT: d });
  rejectedCli(unbounded, /missing a prompt/);
  assert.equal(unbounded.attempts, '', 'P-14c: no forbidden attempts');
  const reason = JSON.parse(unbounded.stderr.slice('overlap refused: '.length, -1));
  assert.ok(reason.length > 2048, 'P-14c: the real unbounded reason exceeds the ceiling');
  assert.equal(JSON.parse(original.stderr.slice('overlap refused: '.length, -1)), reason.slice(0, 2048), 'AC-14: the whole reason is bounded before escaping');
  assert.throws(() => safeRefusal(unbounded), { code: 'ERR_ASSERTION', message: 'AC-14: decoded reason is at most 2,048 characters' }, 'P-14c: removing the real bound reads RED');
});

// Load a source mutation without changing any tracked bytes.
function sourceModule(rel, transform) {
  const Module = require('node:module'); const file = path.join(ROOT, rel);
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  const source = fs.readFileSync(file, 'utf8'), changed = transform(source);
  assert.notEqual(changed, source, 'plant changed its named cause'); m._compile(changed, file); return m.exports;
}
const requiredSubjects = [
  ['P-10a', 'SKILL.md', 'bytes'], ['P-10b', 'evals/evals.json', 'bytes'],
  ['P-10c', 'SKILL.md', 'FIFO'], ['P-10d', 'evals/evals.json', 'FIFO'],
];
for (const [id, rel, kind] of requiredSubjects) test('AC-10 product and pre-read plant: ' + id, () => {
  const d = subject({ files: { 'SKILL.md': '# specimen\n' }, cases: [{ prompt: 'a', rubric: 'r' }] });
  const at = path.join(d, rel); fs.unlinkSync(at);
  if (kind === 'FIFO') { const r = spawnSync('mkfifo', [at], { timeout: 1000 }); assert.equal(r.status, 0); }
  else {
    const size = require('../config').SKILL_MAX_BYTES + 1;
    if (rel === 'evals/evals.json') {
      const bytes = Buffer.alloc(size, 32); const prefix = '{"padding":"'; const suffix = '","cases":[{"prompt":"a","rubric":"r"}]}';
      bytes.write(prefix); bytes.write(suffix, size - Buffer.byteLength(suffix)); fs.writeFileSync(at, bytes);
    } else { const fd = fs.openSync(at, 'w'); fs.ftruncateSync(fd, size); fs.closeSync(fd); }
  }
  const code = kind === 'FIFO' ? 'INPUT_TYPE' : 'INPUT_BOUND';
  const { loadSkill } = require('../lib/skill');
  const probe = spawnSync(process.execPath, ['-e', 'try { require(' + JSON.stringify(path.join(ROOT,'lib/skill.js')) + ').loadSkill(' + JSON.stringify(d) + '); process.exit(1); } catch(e) { console.log(e.code); }'], { timeout:1000, encoding:'utf8' });
  assert.equal(probe.error, undefined, 'AC-10: required-file refusal is bounded');
  assert.equal(probe.stdout.trim(), code, 'AC-10: shared loader refusal');
  assert.throws(() => product(d), (e) => e.code === code, 'AC-10: library refusal');
  rejectedCli(child([BIN, 'overlap', d], fresh()), new RegExp(kind === 'FIFO' ? 'regular' : rel === 'SKILL.md' ? 'SKILL_MAX_BYTES' : 'SUITE_MAX_BYTES'));
  const bad = sourceModule('lib/skill.js', (s) => s.replace(/assertRequired\(st, rel, limit, bound\);/g, '/* P-10: pre-read checks omitted */'));
  const real = fs.readSync; let attempted = false;
  fs.readSync = function(fd, ...args) { if (fs.readlinkSync('/proc/self/fd/' + fd) === at) { attempted = true; throw new Error('P-10: forbidden required read'); } return real.call(this, fd, ...args); };
  try { assert.throws(() => bad.loadSkill(d)); } finally { fs.readSync = real; }
  assert.equal(attempted, true, id + ': independent observer sees the bypass before bytes are read');
});

test('AC-17 product and locale comparator plant: non-ASCII tied paths', () => {
  const files = { 'SKILL.md': '# specimen\n', 'z.txt': 'alpha beta', 'ä.txt': 'alpha beta' };
  const d = subject({ files, cases: [{ id: 'c', prompt: 'alpha beta', rubric: 'r' }] });
  const want = { skill: 'specimen', cases: [exhaustive('alpha beta', files, 'c')] };
  assert.equal(want.cases[0].match.file, 'z.txt'); measure(product(d), want, 'AC-17');
  validCli(child([BIN, 'overlap', d], fresh()), want);
  const bad = sourceModule('lib/overlap.js', (s) => s.replace('Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))', 'a.path.localeCompare(b.path)'));
  assert.throws(() => measure(bad.overlapSkill(d), want, 'P-17'), /P-17/);
});

function upperSubject() {
  const prompt = ('q'.repeat(31) + ' ').repeat(1999) + 'q'.repeat(1567);
  assert.equal(prompt.length, 65535);
  return subject({ files: { 'SKILL.md': '# specimen\n', 'words.txt': ('a'.repeat(127) + ' ').repeat(249999) }, cases: Array.from({length:500}, (_,i) => ({ id: 'c'+i, prompt, rubric:'r' })) });
}
for (const door of ['library', 'CLI']) test('AC-11 product: upper-bound resource subject ' + door, () => {
  const d = upperSubject(); const work = fresh();
  const resource = path.join(work, 'resource.cjs');
  put(work, 'resource.cjs', 'process.on("exit", () => { require("node:fs").writeSync(4, String(process.resourceUsage().maxRSS)); });');
  const args = door === 'CLI' ? [BIN, 'overlap', d] : ['-e', 'process.stdout.write(JSON.stringify(require(' + JSON.stringify(path.join(ROOT,'lib/overlap.js')) + ').overlapSkill(' + JSON.stringify(d) + ')))'];
  const r = spawnSync(process.execPath, ['--require', resource, ...args], { env: safeEnv(), cwd: work, stdio:['ignore','pipe','pipe','ignore','pipe'], encoding:'utf8', timeout:30000, maxBuffer:16*1024*1024 });
  assert.equal(r.error, undefined, 'AC-11: finishes within 30 seconds'); assert.equal(r.status,0,r.stderr);
  assert.ok(Number(r.output[4]) < 512*1024, 'AC-11: RSS below 512 MiB');
  const report = JSON.parse(r.stdout); assert.equal(report.cases.length,500);
  assert.ok(report.cases.every(c => c.prompt_words === 2000 && c.longest_words === 0 && c.match === null));
});
for (const [id, target] of [['P-11a','bundle'],['P-11b','prompts']]) test('AC-11 product and word-bound plant: ' + id, () => {
  const d = target === 'bundle' ? subject({files:{'SKILL.md':'# specimen\n','words.txt':'a '.repeat(250000)},cases:[{prompt:'a',rubric:'r'}]}) : upperSubject();
  if (target === 'prompts') { const suite=JSON.parse(fs.readFileSync(path.join(d,'evals/evals.json'),'utf8')); suite.cases[0].prompt='q '.repeat(32767); put(d,'evals/evals.json',JSON.stringify(suite)); }
  const globalLimit = target === 'bundle' ? 250000 : 1000000;
  const readBound = e => {
    assert.equal(e.code, 'INPUT_BOUND'); assert.match(e.bound, /OVERLAP_MAX/);
    assert.equal(e.limit, globalLimit, 'AC-11: refusal names the global word limit');
    assert.equal(e.value, globalLimit + 1, 'AC-11: refusal names the actual total compared so far');
    return true;
  };
  assert.throws(() => product(d), readBound);
  // A-182-4, PR 230 F-2: mutate the product's reported allowance.
  const wrongLimit = sourceModule('lib/overlap.js', s => target === 'bundle'
    ? s.replace('pastBound(bound, limit + offset,', 'pastBound(bound, limit,')
    : s.replace('for (const c of skill.suite.cases) {', 'for (const c of skill.suite.cases) { const remaining = OVERLAP_MAX_PROMPT_WORDS - promptWords;')
      .replace("pastBound('OVERLAP_MAX_PROMPT_WORDS', OVERLAP_MAX_PROMPT_WORDS, promptWords,", "pastBound('OVERLAP_MAX_PROMPT_WORDS', remaining, promptWords,"));
  assert.throws(() => assert.throws(() => wrongLimit.overlapSkill(d), readBound), { code: 'ERR_ASSERTION', message: /AC-11: refusal names the global word limit/ }, id + ': reporting the remaining allowance reads RED');
  rejectedCli(child([BIN,'overlap',d],fresh()), /OVERLAP_MAX/);
  const bad=sourceModule('lib/overlap.js', s => s.replace(target === 'bundle' ? 'const OVERLAP_MAX_BUNDLE_WORDS = 250000;' : 'const OVERLAP_MAX_PROMPT_WORDS = 1000000;', target === 'bundle' ? 'const OVERLAP_MAX_BUNDLE_WORDS = Infinity;' : 'const OVERLAP_MAX_PROMPT_WORDS = Infinity;'));
  assert.doesNotThrow(() => bad.overlapSkill(d));
});
test('AC-11 plant seen: P-11c quadratic comparison fails the resource oracle', () => {
  const d = upperSubject();
  const code = 'const Module=require("node:module"),fs=require("node:fs"),file='+JSON.stringify(path.join(ROOT,'lib/overlap.js'))+'; const m=new Module(file); m.filename=file; m.paths=Module._nodeModulePaths(require("node:path").dirname(file)); const source=fs.readFileSync(file,"utf8"); const needle="function compare(prompt, tokens, states, id) {"; if(!source.includes(needle))process.exit(3); m._compile(source.replace(needle,needle+" let planted=0; for(const a of tokens) for(const b of prompt) if(a.word===b.word) planted++; if(planted<0)throw Error(planted);"),file); console.log(m.exports.overlapSkill('+JSON.stringify(d)+'));';
  const r=spawnSync(process.execPath,['-e',code],{timeout:30000,encoding:'utf8'});
  assert.equal(r.error && r.error.code,'ETIMEDOUT','P-11c: the same operational bound sees the mutated product matcher');
});

test('AC-13 decoding mutation seen: P-13 auto-detects UTF-16', () => {
  const d=subject({files:{'SKILL.md':'# specimen\n'},cases:[{id:'c',prompt:'alpha beta',rubric:'r'}]});
  put(d,'utf16.bin',decoding[2][1]); const want={skill:'specimen',cases:[{id:'c',prompt_words:2,longest_words:0,match:null}]};
  const bad=sourceModule('lib/overlap.js',s=>s.replace("f.bytes.toString('utf8')","f.bytes.toString(f.bytes[0] === 255 && f.bytes[1] === 254 ? 'utf16le' : 'utf8')"));
  assert.throws(()=>measure(bad.overlapSkill(d),want,'P-13'),/P-13/);
});

test('AC-10 accepted bytes: snapshot and legacy reading yield identical loader hashes', () => {
  const d = subject(corpus[0]); const { loadSkill } = require('../lib/skill');
  const legacy = sourceModule('lib/skill.js', s => s
    .replace("readRequired(skillMdPath, 'SKILL.md', SKILL_MAX_BYTES, 'SKILL_MAX_BYTES', readFile)",'fs.readFileSync(skillMdPath)')
    .replace("readRequired(suitePath, 'evals/evals.json', SUITE_MAX_BYTES, 'SUITE_MAX_BYTES', readFile && ((file) => readFile(file, 'utf8')))",'fs.readFileSync(suitePath)'));
  assert.deepEqual(loadSkill(d), legacy.loadSkill(d), 'AC-10: accepted identity and hashes stay unchanged');
  const loaded=loadSkill(d,{includeFiles:true});
  assert.equal(require('../lib/canonical').sha256Files(loaded.files),loaded.contentHash,'AC-1: exposed bytes are exactly the hashed snapshot');
});

// A-182-2: dev's visible-text refusals and issue 149's read bounds coexist.
for (const field of ['prompt', 'rubric', 'description']) {
  for (const [label, value] of [['blank', ''], ['whitespace', ' \t\r\n'], ['invisible', '\u200b\u2060'], ['combining invisible', '\u034f'], ['punctuation', '!!!']]) {
    test('AC-18 product and P-18 plant: ' + field + ' ' + label, () => {
      const c = { id: 'visible-input', prompt: 'alpha', rubric: 'Words.' };
      if (field === 'description') {
        delete c.rubric;
        c.criteria = [{ id: 'visible', weight: 1, description: value }];
      } else c[field] = value;
      const d = subject({ files: { 'SKILL.md': '# specimen\n' }, cases: [c] });
      const { loadSkill } = require('../lib/skill');
      const reason = field === 'description' ? /no description/ : new RegExp('missing a ' + field);
      const refused = load => assert.throws(() => load(d), reason, 'AC-18: the invalid field is refused');
      refused(loadSkill);
      refused(product);
      rejectedCli(child([BIN, 'overlap', d], fresh()), reason);
      const bad = sourceModule('lib/skill.js', s => s.replace(/^function hasText\(s\) {[\s\S]*?^}/m, 'function hasText(s) { return true; }'));
      if (label === 'blank') {
        // Empty fields are also refused by the original presence checks.
        const presence = sourceModule('lib/skill.js', s => s
          .replace('!prompt || !hasText(prompt)', 'false')
          .replace('(!rubric || !hasText(rubric)) && !listed', 'false')
          .replace("typeof x.description !== 'string' || !hasText(x.description)", 'false'));
        assert.throws(() => refused(presence.loadSkill), assert.AssertionError, 'P-18: bypass reads RED');
      } else assert.throws(() => refused(bad.loadSkill), assert.AssertionError, 'P-18: bypass reads RED');
    });
  }
}

// A-182-3: exercise the shared census without running a sibling gate or suite.
let overlapCensus;
async function censusForOverlap() {
  if (!overlapCensus) {
    const tmp = fresh();
    for (const n of [138, 139, 140, 165]) process.env['SPEC' + n + '_TMP'] = tmp;
    overlapCensus = await import('../specs/165-first-receipt-from-existing-skill/probes/census.mjs');
  }
  return overlapCensus;
}
const overlapRefusalIds = ['RF-86', 'RF-86b', 'RF-86c', 'RF-86d', 'RF-87', 'RF-87b', 'RF-87c'];
function overlapCensusTable() {
  return new Map(fs.readFileSync(path.join(ROOT, 'specs/165-first-receipt-from-existing-skill/spec.md'), 'utf8')
    .split('\n').flatMap(line => {
      const m = /^\| (RF-\d+[a-z]?) \| ([^|]+) \| (.+) \| (\d+) \| (.+) \|$/.exec(line);
      return m ? [[m[1], { exit: Number(m[4]), words: [...m[5].matchAll(/`([^`]+)`/g)].map(x => x[1]) }]] : [];
    }));
}
function censusRefusalOracle(result, spec) {
  assert.equal(result.r.exit, spec.exit, 'census refusal exit');
  assert.equal(result.r.stdout, '', 'census refusal has no report');
  assert.doesNotMatch(result.r.stderr, /^FATAL/m, 'a crash is not a refusal');
  for (const word of spec.words) assert.ok(result.r.stderr.includes(word), 'census refusal words: ' + word);
  assert.deepEqual(result.wrote, [], 'census refusal writes nothing');
}
function overlapSiteOracle(census, rows) {
  const text = fs.readFileSync(BIN, 'utf8');
  const start = text.split('\n').findIndex(line => line === 'function cmdOverlap(args) {') + 1;
  const end = text.split('\n').findIndex(line => line === 'async function main() {') + 1;
  const sites = census.siteLines(census.BIN, text).filter(site => site.line >= start && site.line < end);
  assert.equal(sites.length, 2, 'both overlap refusing exits are counted');
  const blocks = Object.values(rows).filter(row => row.file === census.BIN)
    .map(row => census.anchorBlock(row.file, text, row.anchor));
  for (const id of overlapRefusalIds) assert.ok(rows[id], id + ' is present in the census');
  for (const site of sites) assert.ok(blocks.some(block => block && block.from <= site.line && site.line <= block.to), 'overlap refusing exit is covered: ' + site.line);
}
test('AC-19 product and P-19b plants: both overlap refusal sites are in the shared census', async () => {
  const census = await censusForOverlap();
  overlapSiteOracle(census, census.ROWS);
  for (const anchor of new Set(overlapRefusalIds.map(id => census.ROWS[id].anchor))) {
    const missing = Object.fromEntries(Object.entries(census.ROWS).filter(([, row]) => row.anchor !== anchor));
    assert.throws(() => overlapSiteOracle(census, missing), assert.AssertionError, 'P-19b: removing a site from the census reads RED');
  }
});
test('AC-19 product and P-19a plants: each overlap census trigger refuses and each disabled message reads RED', async () => {
  const census = await censusForOverlap();
  const { TREE, runtime } = await import('../specs/165-first-receipt-from-existing-skill/probes/rt.mjs');
  const table = overlapCensusTable();
  const mutants = new Map();
  for (const id of overlapRefusalIds) {
    const row = census.ROWS_165[id];
    assert.ok(row, id + ' has its own trigger');
    assert.ok(table.has(id), id + ' has recorded exit and words');
    censusRefusalOracle(row.run({ rt: TREE }), table.get(id));
    if (!mutants.has(row.anchor)) {
      const mutation = census.sitePlant(row.file, row.anchor);
      const rt = runtime('issue149-census', [{ name: 'P-19a ' + id, ...mutation }]);
      assert.ok(rt.planted.every(p => p.planted), 'P-19a must be planted');
      mutants.set(row.anchor, rt);
    }
    assert.throws(() => censusRefusalOracle(row.run({ rt: mutants.get(row.anchor) }), table.get(id)), assert.AssertionError, 'P-19a: ' + id + ' reads RED');
  }
});
test('AC-20 product and P-20 plant: the published-content baseline is generated from this tree', async () => {
  const { build } = await import('../scripts/build-report-baselines.mjs');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs/020-site-relaunch/baselines/report-bodies.json'), 'utf8'));
  const want = build();
  assert.deepEqual(manifest, want, 'AC-20: the whole manifest matches its generator');
  const wrong = structuredClone(manifest);
  wrong.readme_body_sha256 = '0'.repeat(64);
  assert.throws(() => assert.deepEqual(wrong, want), assert.AssertionError, 'P-20: a stale README digest reads RED');
});
