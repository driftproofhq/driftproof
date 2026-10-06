// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for scripts/codeql-read.js and the files it reads, config/codeql.json and
// config/codeql-baseline.json (spec 148): the reader of the local CodeQL scan.
//
//   node --test tests/codeql-read.test.js
//
// The SARIF here is made by the test, in the shape CodeQL 2.27.1 writes (a run with tool.driver,
// invocations[0].executionSuccessful, artifacts, results with locations and a message). No CodeQL
// CLI runs and nothing is downloaded. Every test name starts with the criterion it checks; spec
// 148's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const cq = require('../scripts/codeql-read.js');

const REPO = path.join(__dirname, '..');
const READER = path.join(REPO, 'scripts', 'codeql-read.js');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'codeql-read-test-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

const result = (rule, file, line, message = 'm') => ({
  ruleId: rule,
  message: { text: message },
  locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: line, startColumn: 3 } } }],
});
const sarif = (results, over = {}) => ({
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'CodeQL', semanticVersion: '2.27.1' } },
    invocations: [{ executionSuccessful: true }],
    artifacts: [{ location: { uri: 'a.js' } }],
    results,
    ...over,
  }],
});
// A scanned directory with the given files, and the entry a baseline holds for a line of one.
function scanned(files) {
  const dir = tmp();
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
}
const entry = (alert, rule, file, text) => ({ alert, rule, file, line: 1, text_sha256: sha(text.trim()), reason: 'Used in tests' });

test('AC-8 results are listed by rule, then file, then line', () => {
  const doc = sarif([result('js/b', 'z.js', 1), result('js/a', 'y.js', 9), result('js/a', 'y.js', 2), result('js/a', 'x.js', 5)]);
  const dir = scanned({ 'x.js': '1\n2\n3\n4\n5\n', 'y.js': '1\n2\n3\n4\n5\n6\n7\n8\n9\n', 'z.js': '1\n' });
  try {
    const text = cq.listText(cq.resultsOf(doc, dir));
    assert.equal(text.split('\n').filter((l) => !l.startsWith(' ')).join('|'), 'js/a (3)|js/b (1)');
    assert.deepEqual(text.split('\n').map((l) => l.trim().split(/\s+/)[0]), ['js/a', 'x.js:5', 'y.js:2', 'y.js:9', 'js/b (1)'.split(' ')[0], 'z.js:1']);
  } finally { rm(dir); }
});

test('AC-8 a result is on the baseline by rule, file and line text, and the line number does not matter', () => {
  const dir = scanned({ 'a.js': 'x\n\n\nconst strip = (s) => s.replace(/<[^>]*>/g, "");\n' });
  try {
    const baseline = { entries: [entry(7, 'js/bad-tag-filter', 'a.js', 'const strip = (s) => s.replace(/<[^>]*>/g, "");')] };
    const c = cq.compare(cq.resultsOf(sarif([result('js/bad-tag-filter', 'a.js', 4)]), dir), baseline);
    assert.equal(c.new.length, 0);
    assert.equal(c.on_baseline.length, 1);
    assert.equal(c.on_baseline[0].alert, 7);
    assert.equal(c.gone.length, 0);
  } finally { rm(dir); }
});

test('AC-8 a result off the baseline is new: another rule, another file, or an edited line', () => {
  const dir = scanned({ 'a.js': 'the line\n', 'b.js': 'the line\n', 'c.js': 'the line, edited\n' });
  try {
    const baseline = { entries: [entry(1, 'js/r', 'a.js', 'the line')] };
    for (const [rule, file] of [['js/other', 'a.js'], ['js/r', 'b.js'], ['js/r', 'c.js']]) {
      const c = cq.compare(cq.resultsOf(sarif([result(rule, file, 1)]), dir), baseline);
      assert.equal(c.new.length, 1, `${rule} ${file}`);
      assert.equal(c.gone.length, 1);
    }
  } finally { rm(dir); }
});

test('AC-8 entries are matched one to one, so two results on one line need two entries', () => {
  const dir = scanned({ 'a.js': 'the line\n' });
  try {
    const two = sarif([result('js/r', 'a.js', 1, '<script'), result('js/r', 'a.js', 1, '<!--')]);
    const one = { entries: [entry(1, 'js/r', 'a.js', 'the line')] };
    const both = { entries: [entry(1, 'js/r', 'a.js', 'the line'), entry(2, 'js/r', 'a.js', 'the line')] };
    assert.equal(cq.compare(cq.resultsOf(two, dir), one).new.length, 1);
    assert.equal(cq.compare(cq.resultsOf(two, dir), both).new.length, 0);
  } finally { rm(dir); }
});

test('AC-8 a baseline entry the scan no longer reads is gone, and does not make a result new', () => {
  const dir = scanned({ 'a.js': 'the line\n' });
  try {
    const baseline = { entries: [entry(1, 'js/r', 'a.js', 'the line'), entry(2, 'js/r', 'deleted.js', 'x')] };
    const c = cq.compare(cq.resultsOf(sarif([result('js/r', 'a.js', 1)]), dir), baseline);
    assert.deepEqual([c.new.length, c.on_baseline.length, c.gone.map((e) => e.alert)], [0, 1, [2]]);
  } finally { rm(dir); }
});

test('AC-8 a scan that cannot be read is refused, not read as clean', () => {
  const dir = tmp();
  const write = (name, doc) => { const f = path.join(dir, name); fs.writeFileSync(f, typeof doc === 'string' ? doc : JSON.stringify(doc)); return f; };
  try {
    assert.throws(() => cq.readSarif(write('a.sarif', 'not json')), /not JSON/);
    assert.throws(() => cq.readSarif(write('b.sarif', { ...sarif([]), version: '2.0.0' })), /not SARIF 2.1.0/);
    assert.throws(() => cq.readSarif(write('c.sarif', { version: '2.1.0', runs: [] })), /not SARIF 2.1.0/);
    assert.throws(() => cq.readSarif(write('d.sarif', sarif([], { tool: { driver: { name: 'Other' } } }))), /not made by CodeQL/);
    assert.throws(() => cq.readSarif(write('e.sarif', sarif([], { invocations: [{ executionSuccessful: false }] }))), /did not succeed/);
    assert.throws(() => cq.readSarif(write('f.sarif', sarif([], { invocations: [] }))), /did not succeed/);
    assert.throws(() => cq.readSarif(write('g.sarif', sarif([], { artifacts: [] }))), /extracted no file/);
    assert.throws(() => cq.readSarif(write('h.sarif', sarif([], { results: undefined }))), /no results array/);
    assert.equal(cq.readSarif(write('ok.sarif', sarif([]))).runs.length, 1);
    assert.throws(() => cq.resultsOf(sarif([result('js/r', '../outside.js', 1)]), dir), /outside the scanned directory/);
    assert.throws(() => cq.resultsOf(sarif([result('js/r', 'missing.js', 1)]), dir), /does not hold/);
    fs.writeFileSync(path.join(dir, 'short.js'), 'one line');
    assert.throws(() => cq.resultsOf(sarif([result('js/r', 'short.js', 40)]), dir), /past the file/);
  } finally { rm(dir); }
});

test('AC-8 the command line exits 0 for nothing new, 1 for a result off the baseline, 2 for a scan it cannot read', () => {
  const dir = scanned({ 'a.js': 'the line\n' });
  try {
    const bl = path.join(dir, 'baseline.json');
    fs.writeFileSync(bl, JSON.stringify({ entries: [entry(1, 'js/r', 'a.js', 'the line')] }));
    const run = (doc, extra = []) => {
      const f = path.join(dir, 'r.sarif');
      fs.writeFileSync(f, typeof doc === 'string' ? doc : JSON.stringify(doc));
      return spawnSync(process.execPath, [READER, 'check', f, '--root', dir, '--baseline', bl, '--json', path.join(dir, 's.json'), ...extra], { encoding: 'utf8' });
    };
    const clean = run(sarif([result('js/r', 'a.js', 1)]));
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 's.json'), 'utf8')).state, 'clean');
    const fresh = run(sarif([result('js/r', 'a.js', 1), result('js/new', 'a.js', 1, 'a new one')]));
    assert.equal(fresh.status, 1);
    assert.match(fresh.stdout, /1 new/);
    assert.match(fresh.stdout, /js\/new a\.js:1/);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, 's.json'), 'utf8'));
    assert.deepEqual([summary.state, summary.total, summary.on_baseline, summary.new.length], ['new', 2, 1, 1]);
    assert.equal(run('{').status, 2);
    assert.equal(run(sarif([], { invocations: [{ executionSuccessful: false }] })).status, 2);
    const noRoot = spawnSync(process.execPath, [READER, 'check', path.join(dir, 'r.sarif'), '--baseline', bl], { encoding: 'utf8' });
    assert.equal(noRoot.status, 2);
    assert.equal(spawnSync(process.execPath, [READER], { encoding: 'utf8' }).status, 2);
  } finally { rm(dir); }
});

test('AC-9 the sweep reads a scan into a verdict and lines: new is RED, not read is ERROR, clean and not run decide nothing', () => {
  const summary = (o) => ({ state: 'clean', total: 11, on_baseline: 11, gone: [], new: [], extracted_files: 312, tool: '2.27.1', ...o });
  const clean = { state: 'clean', summary: summary({}) };
  const fresh = { state: 'new', summary: summary({ total: 13, on_baseline: 11, new: [{ rule: 'js/a', file: 'x.js', line: 3 }, { rule: 'js/b', file: 'y.js', line: 9 }] }) };
  assert.equal(cq.sweepVerdict(clean), null);
  assert.equal(cq.sweepVerdict(fresh), 'RED');
  assert.equal(cq.sweepVerdict({ state: 'unreadable', why: 'x' }), 'ERROR');
  assert.equal(cq.sweepVerdict({ state: 'not-run', why: 'x' }), null);
  assert.deepEqual(cq.sweepLines(clean), ['CodeQL (local scan, default suite, CLI 2.27.1, 312 files): 11 results, 11 on the baseline, 0 new.']);
  const lines = cq.sweepLines(fresh);
  assert.equal(lines[0], 'CodeQL (local scan, default suite, CLI 2.27.1, 312 files): 13 results, 11 on the baseline, 2 new.');
  assert.deepEqual(lines.slice(1), ['  - js/a x.js:3', '  - js/b y.js:9']);
  assert.deepEqual(cq.sweepLines({ state: 'unreadable', why: 'the CLI is not installed' }), ['CodeQL (local scan): NOT READ, the CLI is not installed.']);
  assert.deepEqual(cq.sweepLines({ state: 'not-run', why: 'a partial sweep' }), ['CodeQL (local scan): not run, a partial sweep.']);
  const many = { state: 'new', summary: summary({ new: Array.from({ length: 8 }, (_, i) => ({ rule: 'js/r', file: 'f.js', line: i + 1 })) }) };
  assert.equal(cq.sweepLines(many, 5).length, 7);
  assert.match(cq.sweepLines(many, 5)[6], /and 3 more/);
  assert.match(cq.sweepLines({ state: 'clean', summary: summary({ gone: [{ alert: 1 }] }) })[0], /1 baseline entries no longer read/);
});

const RECORD = [
  'Fixed in 0.13.0: #10 lib/decision.js:375 (spec 111).',
  '',
  'Dismiss as "Used in tests":',
  '- #16 tests/a.js:31',
  '- #14 tests/gate.js:6651',
  '- #13 tests/gate.js:3875',
  '',
  'Dismiss as "False positive" (build-time text extraction, with escaped output):',
  '- #11 scripts/x.js:131',
  '',
  'Dismiss as "Won\'t fix" (internal, not shipped):',
  '- #1 scripts/r.mjs:126',
  '- #2 scripts/r.mjs:128',
].join('\n');

test('AC-8 the dismissals record is read for each alert, its category and its note', () => {
  const d = cq.readDismissals(RECORD);
  assert.equal(d.length, 6);
  assert.deepEqual(d[0], { alert: 16, file: 'tests/a.js', line_was: 31, dismissal: 'Used in tests', note: null });
  assert.deepEqual(d[3], { alert: 11, file: 'scripts/x.js', line_was: 131, dismissal: 'False positive', note: 'build-time text extraction, with escaped output' });
  assert.equal(d[5].note, 'internal, not shipped');
  assert.equal(cq.readDismissals('Fixed in 0.13.0: #10 lib/decision.js:375.\n- #5 not/under/a/heading.js:1\n').length, 0);
});

test('AC-8 the baseline is joined from a scan and the record: a file that moved is matched in order, with the reason given', () => {
  const lines = (n, at) => Array.from({ length: n }, (_, i) => (at.includes(i + 1) ? `flagged ${i + 1}` : `plain ${i + 1}`)).join('\n');
  const dir = scanned({
    'tests/a.js': lines(40, [31]),
    'tests/gate.js': lines(7000, [3875, 6651]),
    'scripts/x.js': lines(140, [132]),
    'scripts/r.mjs': lines(170, [158, 160]),
    'lib/q.js': lines(5, [2]),
  });
  try {
    const doc = sarif([
      result('js/one', 'tests/a.js', 31), result('js/two', 'tests/gate.js', 3875), result('js/two', 'tests/gate.js', 6651),
      result('js/three', 'scripts/x.js', 132), result('js/four', 'scripts/r.mjs', 158), result('js/four', 'scripts/r.mjs', 160),
    ]);
    const b = cq.buildBaseline(doc, dir, RECORD, { source: '~/record.md' });
    assert.equal(b.entries.length, 6);
    assert.deepEqual(b.entries.map((e) => e.alert), [1, 2, 11, 13, 14, 16]);
    const e1 = b.entries[0];
    assert.deepEqual([e1.rule, e1.file, e1.line, e1.line_was, e1.reason], ['js/four', 'scripts/r.mjs', 158, 126, "Won't fix: internal, not shipped"]);
    assert.equal(b.entries[1].line, 160);
    assert.equal(b.entries.find((e) => e.alert === 11).reason, 'False positive: build-time text extraction, with escaped output');
    assert.equal(b.entries.find((e) => e.alert === 16).reason, 'Used in tests');
    assert.equal(b.entries.find((e) => e.alert === 13).line, 3875);
    assert.equal(b.entries.find((e) => e.alert === 13).text_sha256, sha('flagged 3875'));
    assert.deepEqual([b.source, b.scan.results, b.scan.results_off_the_record], ['~/record.md', 6, 0]);
    // the same scan, set against the baseline it made, has nothing new
    const c = cq.compare(cq.resultsOf(doc, dir), b);
    assert.deepEqual([c.new.length, c.on_baseline.length, c.gone.length], [0, 6, 0]);
    // a seventh result in the scan is off the record
    const more = cq.buildBaseline(sarif([...doc.runs[0].results, result('js/five', 'lib/q.js', 2)]), dir, RECORD, { source: 's' });
    assert.equal(more.scan.results_off_the_record, 1);
    // a count that does not agree is refused
    assert.throws(() => cq.buildBaseline(sarif(doc.runs[0].results.slice(1)), dir, RECORD, { source: 's' }), /tests\/a\.js: the record dismisses 1 alert\(s\) and the scan reads 0/);
    assert.throws(() => cq.buildBaseline(doc, dir, 'nothing dismissed here', { source: 's' }), /lists no dismissed alert/);
  } finally { rm(dir); }
});

// ── the published tree ───────────────────────────────────────────────────────────────────────
function repoWith(files, exclude) {
  const dir = tmp();
  const git = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'dev');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'build-public.sh'), `#!/usr/bin/env bash\nEXCLUDE_RE='${exclude}'\n`);
  for (const [f, t] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), t);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'one');
  return { dir, git };
}
const EXCLUDE = '^(CLAUDE|DECISIONS)\\.md$|^specs/|^state/|(^|/)[^/]*-draft/';

test('AC-1 the scanned tree is what the public build publishes: git ls-files less EXCLUDE_RE, read from the build script', () => {
  const { dir } = repoWith({ 'a.js': '1', 'lib/b.js': '2', 'CLAUDE.md': 'x', 'specs/001/spec.md': 'x', 'state/s.json': '{}', 'docs/reports-draft/p.html': 'x', 'docs/p.html': 'y' }, EXCLUDE);
  try {
    assert.deepEqual(cq.publishedFiles(dir).sort(), ['a.js', 'docs/p.html', 'lib/b.js', 'scripts/build-public.sh']);
    // the same list as grep -E, which is how the build script itself applies the pattern
    const listed = spawnSync('bash', ['-c', 'git ls-files | grep -vE "$1"', '_', EXCLUDE], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    assert.deepEqual(cq.publishedFiles(dir).sort(), listed.sort());
  } finally { rm(dir); }
});

test('AC-1 a scan of a commit reads that commit, never the working copy, and the build script of that commit', () => {
  const { dir, git } = repoWith({ 'a.js': 'committed', 'drop/x.js': 'x' }, EXCLUDE);
  const dest = tmp();
  try {
    const rev = git('rev-parse', 'HEAD').stdout.trim();
    fs.writeFileSync(path.join(dir, 'a.js'), 'edited after');
    fs.writeFileSync(path.join(dir, 'scripts', 'build-public.sh'), "EXCLUDE_RE='^drop/'\n");
    assert.deepEqual(cq.publishedFiles(dir, rev).sort(), ['a.js', 'drop/x.js', 'scripts/build-public.sh']);
    assert.deepEqual(cq.publishedFiles(dir).sort(), ['a.js', 'scripts/build-public.sh']);
    cq.exportPublished(dir, dest, rev);
    assert.equal(fs.readFileSync(path.join(dest, 'a.js'), 'utf8'), 'committed');
    assert.equal(fs.existsSync(path.join(dest, 'specs')), false);
  } finally { rm(dir); rm(dest); }
});

test('AC-1 an export of the working copy carries the files and a symlink as a link', () => {
  const { dir } = repoWith({ 'a.js': 'one', 'sub/b.js': 'two' }, EXCLUDE);
  const dest = tmp();
  try {
    fs.symlinkSync('a.js', path.join(dir, 'link.js'));
    spawnSync('git', ['-C', dir, 'add', 'link.js']);
    const files = cq.exportPublished(dir, dest);
    assert.ok(files.includes('link.js') && files.includes('sub/b.js'));
    assert.equal(fs.readFileSync(path.join(dest, 'sub', 'b.js'), 'utf8'), 'two');
    assert.equal(fs.lstatSync(path.join(dest, 'link.js')).isSymbolicLink(), true);
    assert.throws(() => cq.publishPattern('no pattern here'), /cannot read EXCLUDE_RE/);
  } finally { rm(dir); rm(dest); }
});

test('AC-1 the build script in this repository carries an EXCLUDE_RE the reader can use, and keeps specs out', () => {
  const re = cq.publishPattern(fs.readFileSync(path.join(REPO, 'scripts', 'build-public.sh'), 'utf8'));
  assert.equal(re.test('specs/148-codeql-zero-and-local-scan/spec.md'), true);
  assert.equal(re.test('scripts/codeql-read.js'), false);
  assert.equal(re.test('tests/answer-capture-run.test.js'), false);
});

// ── the files that pin and record ────────────────────────────────────────────────────────────
test('AC-1 config/codeql.json pins a version, a checksum and the default suite for JavaScript', () => {
  const pin = JSON.parse(fs.readFileSync(path.join(REPO, 'config', 'codeql.json'), 'utf8'));
  assert.match(pin.cli.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pin.cli.bundle, `codeql-bundle-v${pin.cli.version}`);
  assert.match(pin.cli.sha256, /^[0-9a-f]{64}$/);
  assert.match(pin.cli.launcher_sha256, /^[0-9a-f]{64}$/);
  assert.equal(pin.cli.url, `https://github.com/github/codeql-action/releases/download/${pin.cli.bundle}/${pin.cli.asset}`);
  assert.equal(pin.suite, 'codeql/javascript-queries:codeql-suites/javascript-code-scanning.qls');
  assert.equal(pin.suite_source.name, 'default');
  assert.match(pin.suite_source.page, /^https:\/\/docs\.github\.com\//);
  assert.ok(!pin.install_dir.startsWith(REPO), 'the CLI is installed outside the repository');
  assert.equal(cq.pinOf('cli.version'), pin.cli.version);
  assert.throws(() => cq.pinOf('cli.nothing'), /no field cli\.nothing/);
});

test('AC-1 the scan runs only the launcher whose sha256 the pin records', () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    for (const f of ['scripts/codeql-local.sh', 'scripts/codeql-read.js']) fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
    const launcher = '#!/bin/sh\necho 2.27.1\n';
    const pin = JSON.parse(fs.readFileSync(path.join(REPO, 'config', 'codeql.json'), 'utf8'));
    const cli = path.join(dir, 'install', `cli-${pin.cli.version}`, 'codeql');
    fs.mkdirSync(cli, { recursive: true });
    fs.writeFileSync(path.join(cli, 'codeql'), launcher, { mode: 0o755 });
    const scan = (recorded) => {
      fs.writeFileSync(path.join(dir, 'config', 'codeql.json'), JSON.stringify({ ...pin, install_dir: path.join(dir, 'install'), cli: { ...pin.cli, launcher_sha256: recorded } }));
      return spawnSync('bash', [path.join(dir, 'scripts', 'codeql-local.sh'), 'scan', '--tree', path.join(dir, 'no-such-tree'), '--out', path.join(dir, 'out')], { encoding: 'utf8' });
    };
    const other = scan(sha('some other launcher'));
    assert.equal(other.status, 2);
    assert.match(other.stderr, /launcher is not the recorded one/);
    // The recorded hash lets the scan on to its next step, which fails here for want of a tree.
    const same = scan(sha(launcher));
    assert.equal(same.status, 2);
    assert.doesNotMatch(same.stderr, /launcher is not the recorded one/);
    assert.match(same.stderr, /could not be exported/);
  } finally { rm(dir); }
});

test('AC-8 config/codeql-baseline.json lists each dismissed alert once, with a rule, a file, a line hash and a reason', () => {
  const b = JSON.parse(fs.readFileSync(path.join(REPO, 'config', 'codeql-baseline.json'), 'utf8'));
  assert.ok(b.entries.length > 0);
  assert.equal(new Set(b.entries.map((e) => e.alert)).size, b.entries.length);
  for (const e of b.entries) {
    assert.match(e.rule, /^js\//);
    assert.match(e.text_sha256, /^[0-9a-f]{64}$/);
    assert.ok(e.file && Number.isInteger(e.line) && Number.isInteger(e.line_was), JSON.stringify(e));
    assert.match(e.dismissal, /^(Used in tests|False positive|Won't fix)$/);
    assert.ok(e.reason.startsWith(e.dismissal), e.reason);
  }
  assert.equal(b.scan.results_off_the_record, 0);
  assert.ok(b.source && !b.source.includes('/'), 'the source names the record in words, with no path');
});
