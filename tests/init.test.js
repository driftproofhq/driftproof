// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for lib/init.js and `driftproof init` (spec 139 AC-5): a suite added to a skill that
// exists, its SKILL.md never written, a link never written through, and --cases.
//
//   node --test tests/init.test.js
//
// Every folder is made under the system temp directory and removed. The CLI is spawned with no
// credential and makes no model call: init calls none.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { scaffoldInit } = require('../lib/init');
const { normalizeCases, parseSkillMeta } = require('../lib/skill');
const { escapeRegExp } = require('../scripts/html-text');

const BIN = path.join(__dirname, '..', 'bin', 'driftproof');
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec139-init-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const stat = (p) => { const s = fs.lstatSync(p); return { ino: s.ino, mtimeMs: s.mtimeMs, size: s.size }; };
function tree(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (e.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(p)}`;
      else if (e.isDirectory()) walk(p);
      else out[rel] = fs.readFileSync(p, 'utf8');
    }
  })(dir);
  return out;
}
const cli = (args, cwd) => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/API_KEY|TOKEN|SECRET/.test(k)) delete env[k];
  return spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8' });
};
const SKILL = '---\nname: fx-existing\nversion: 1.2.3\ndescription: an existing skill\n---\n\n# fx-existing\n\nDo the thing.\n';
function existingSkill() {
  const root = tmp();
  const dir = path.join(root, 'folder-name');
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), SKILL);
  fs.writeFileSync(path.join(dir, 'notes', 'extra.md'), 'kept\n');
  return { root, dir };
}

test('on a skill that exists, init adds the suite and no other file, and leaves SKILL.md as it was', () => {
  const { dir } = existingSkill();
  const before = stat(path.join(dir, 'SKILL.md'));
  const r = scaffoldInit(dir);
  assert.equal(r.existingSkill, true);
  assert.deepEqual(r.created.map((f) => path.relative(dir, f)), [path.join('evals', 'evals.json')], 'the suite alone: no rc beside it');
  assert.deepEqual(r.skipped.map((f) => path.relative(dir, f)), ['SKILL.md']);
  assert.equal(fs.existsSync(path.join(dir, '.driftproofrc')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), SKILL);
  assert.deepEqual(stat(path.join(dir, 'SKILL.md')), before, 'same inode, size and modification time');
  const suite = JSON.parse(fs.readFileSync(path.join(dir, 'evals', 'evals.json'), 'utf8'));
  assert.equal(suite.skill, 'fx-existing', 'the name SKILL.md gives, not the folder');
  assert.equal(fs.readFileSync(path.join(dir, 'notes', 'extra.md'), 'utf8'), 'kept\n');
});

const RC = '{"max_usd": 9}\n';
const SUITE = '{"skill":"fx-existing","cases":[]}\n';

test('on a skill that exists, every file init leaves untouched is reported skipped: SKILL.md, the suite and the rc', () => {
  const { dir } = existingSkill();
  fs.mkdirSync(path.join(dir, 'evals'));
  fs.writeFileSync(path.join(dir, 'evals', 'evals.json'), SUITE);
  fs.writeFileSync(path.join(dir, '.driftproofrc'), RC);
  const before = tree(dir);
  const r = scaffoldInit(dir);
  assert.deepEqual(r.created, [], 'nothing written');
  assert.deepEqual(r.skipped.map((f) => path.relative(dir, f)).sort(), ['.driftproofrc', 'SKILL.md', path.join('evals', 'evals.json')]);
  assert.deepEqual(tree(dir), before, 'every file by bytes, and no new one');
});

test('on a skill that exists with an rc and no suite, the suite is the one new file and the rc is reported skipped, untouched', () => {
  const { dir } = existingSkill();
  fs.writeFileSync(path.join(dir, '.driftproofrc'), RC);
  const rcBefore = stat(path.join(dir, '.driftproofrc'));
  const r = scaffoldInit(dir);
  assert.deepEqual(r.created.map((f) => path.relative(dir, f)), [path.join('evals', 'evals.json')]);
  assert.deepEqual(r.skipped.map((f) => path.relative(dir, f)).sort(), ['.driftproofrc', 'SKILL.md']);
  assert.equal(fs.readFileSync(path.join(dir, '.driftproofrc'), 'utf8'), RC);
  assert.deepEqual(stat(path.join(dir, '.driftproofrc')), rcBefore, 'same inode, size and modification time');
});

test('an rc that is a link, dangling or not, on a skill that exists is reported skipped and not written through', () => {
  const { root, dir } = existingSkill();
  const target = path.join(root, 'nowhere-rc');
  fs.symlinkSync(target, path.join(dir, '.driftproofrc'));
  const r = scaffoldInit(dir);
  assert.equal(fs.existsSync(target), false);
  assert.ok(r.skipped.some((f) => f.endsWith('.driftproofrc')));
  assert.deepEqual(r.created.map((f) => path.relative(dir, f)), [path.join('evals', 'evals.json')]);
});

test('the CLI: init run again on a skill it scaffolded says all three files were left untouched, and writes nothing', () => {
  const root = tmp();
  const dir = path.join(root, 'again');
  assert.equal(cli(['init', dir], root).status, 0);
  const before = tree(dir);
  const r = cli(['init', dir], root);
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['SKILL.md', 'evals/evals.json', '.driftproofrc']) {
    assert.match(r.stdout, new RegExp(`· .*${escapeRegExp(f)} \\(exists`), `${f} reported as left untouched`);
  }
  assert.match(r.stdout, /Nothing to create/);
  assert.deepEqual(tree(dir), before);
});

test('the CLI: init on a skill that exists with an rc reports the rc as skipped and adds the suite only', () => {
  const { root, dir } = existingSkill();
  fs.writeFileSync(path.join(dir, '.driftproofrc'), RC);
  const r = cli(['init', dir], root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /· .*\.driftproofrc \(exists/);
  assert.match(r.stdout, /\+ .*evals[\\/]evals\.json/);
  assert.equal(fs.readFileSync(path.join(dir, '.driftproofrc'), 'utf8'), RC);
  assert.deepEqual(Object.keys(tree(dir)).sort(), ['.driftproofrc', 'SKILL.md', path.join('evals', 'evals.json'), path.join('notes', 'extra.md')]);
});

test('a SKILL.md that is a link, dangling or not, is never written through', () => {
  const root = tmp();
  const dangling = path.join(root, 'dangling');
  fs.mkdirSync(dangling);
  const target = path.join(root, 'nowhere.md');
  fs.symlinkSync(target, path.join(dangling, 'SKILL.md'));
  const r1 = scaffoldInit(dangling);
  assert.equal(fs.existsSync(target), false, 'the dangling link was not written through');
  assert.ok(r1.skipped.some((f) => f.endsWith('SKILL.md')));

  const linked = path.join(root, 'linked');
  fs.mkdirSync(linked);
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, 'outside\n');
  fs.symlinkSync(outside, path.join(linked, 'SKILL.md'));
  scaffoldInit(linked);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside\n');
});

test('a suite folder that is a link is not written through', () => {
  const { root, dir } = existingSkill();
  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(dir, 'evals'));
  const r = scaffoldInit(dir);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  assert.ok(r.skipped.some((f) => f.endsWith(path.join('evals', 'evals.json'))));
});

test('--cases is the suite, read by the loader own rules, and a bad set writes nothing', () => {
  const root = tmp();
  const dir = path.join(root, 'new-skill');
  const cases = { cases: [{ id: 'a', prompt: 'do a', rubric: 'did a; 0.80 when right' }, { id: 'b', prompt: 'do b', rubric: 'did b', pass_threshold: 0.6 }] };
  scaffoldInit(dir, { cases });
  const suite = JSON.parse(fs.readFileSync(path.join(dir, 'evals', 'evals.json'), 'utf8'));
  assert.deepEqual(suite.cases, normalizeCases(cases));
  const bad = path.join(root, 'bad-skill');
  assert.throws(() => scaffoldInit(bad, { cases: { cases: [{ id: 'a', prompt: 'p' }] } }), /missing a rubric/);
  assert.equal(fs.existsSync(bad), false, 'nothing written for cases the loader refuses');
});

test('the CLI: init on a skill that exists says SKILL.md was left as it was', () => {
  const { root, dir } = existingSkill();
  const r = cli(['init', dir], root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SKILL\.md was left as it was/);
  assert.doesNotMatch(r.stdout, /Edit .*SKILL\.md/);
  assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), SKILL);
});

test('the CLI refuses --cases beside a suite, bad cases, --cases with no file and a flag init does not take, writing nothing', () => {
  const { root, dir } = existingSkill();
  const draft = path.join(root, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'a', prompt: 'p', rubric: 'r' }] }));
  assert.equal(cli(['init', dir], root).status, 0);
  const before = tree(dir);
  const r1 = cli(['init', dir, '--cases', draft], root);
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /REFUSED \(init\): .*already has evals\/evals\.json/);
  assert.deepEqual(tree(dir), before);

  const fresh = path.join(root, 'fresh');
  const badDraft = path.join(root, 'bad.json');
  fs.writeFileSync(badDraft, JSON.stringify({ cases: [{ id: 'a', prompt: 'p' }] }));
  const r2 = cli(['init', fresh, '--cases', badDraft], root);
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /REFUSED \(init\): the cases in .* missing a rubric/);
  assert.equal(fs.existsSync(fresh), false);

  const r3 = cli(['init', fresh, '--cases'], root);
  assert.equal(r3.status, 2);
  assert.match(r3.stderr, /--cases needs a file/);

  const r4 = cli(['init', fresh, '--models', 'x'], root);
  assert.equal(r4.status, 2);
  assert.match(r4.stderr, /REFUSED \(init\): unknown flag --models/);
  assert.equal(fs.existsSync(fresh), false);

  const r5 = cli(['init', fresh, '--cases', draft], root);
  assert.equal(r5.status, 0, r5.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fresh, 'evals', 'evals.json'), 'utf8')).cases[0].id, 'a');
});

test('the CLI refuses init on a skill whose evals is a file, writing nothing (F-9)', () => {
  const { root, dir } = existingSkill();
  fs.writeFileSync(path.join(dir, 'evals'), 'not a folder\n');
  const before = tree(dir);
  const r = cli(['init', dir], root);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /REFUSED \(init\): .*evals is there and is not a folder/);
  assert.doesNotMatch(r.stderr, /EEXIST|at .*\.js:\d+/);
  assert.deepEqual(tree(dir), before);
});

// Spec 165: the label on cases a person approved after they were drafted from the skill.
test('drafted cases carry the label on the suite and on every case; the loader keeps it and does not hash it', () => {
  const { suiteIdentity } = require('../lib/skill');
  const root = tmp();
  const cases = { cases: [{ id: 'a', prompt: 'do a', rubric: 'did a; 0.80 when right' }, { id: 'b', prompt: 'do b', rubric: 'did b' }] };
  const dir = path.join(root, 'new-skill');
  scaffoldInit(dir, { cases, drafted: true });
  const suite = JSON.parse(fs.readFileSync(path.join(dir, 'evals', 'evals.json'), 'utf8'));
  assert.equal(typeof suite.origin, 'string');
  assert.ok(suite.cases.every((c) => c.origin === suite.origin));
  const kept = suiteIdentity(suite);
  assert.ok(kept.cases.every((c) => c.origin === suite.origin), 'the loader keeps the label');
  assert.equal(kept.suiteHash, suiteIdentity(cases).suiteHash, 'the label is not in suite_hash');
  const plain = path.join(root, 'plain-skill');
  scaffoldInit(plain, { cases });
  assert.doesNotMatch(fs.readFileSync(path.join(plain, 'evals', 'evals.json'), 'utf8'), /origin/);
  const long = normalizeCases({ cases: [{ id: 'a', prompt: 'p', rubric: 'r', origin: 'x'.repeat(201) }, { id: 'b', prompt: 'p', rubric: 'r', origin: 7 }] });
  assert.ok(long.every((c) => !('origin' in c)), 'a label that is not a short string is not carried');
});

// Spec 172 (M-4): a hyphenated front-matter key, such as the agentskills.io `allowed-tools`, is
// read; the guided drafting steps read it from here to say which of a skill's needs a run cannot
// meet, so that line comes from the file, not from a free reading of it.
test('parseSkillMeta reads a hyphenated front-matter key', () => {
  const meta = parseSkillMeta('---\nname: fx\nallowed-tools: Bash, Read\n---\n\n# fx\n');
  assert.equal(meta['allowed-tools'], 'Bash, Read');
  assert.equal(meta.name, 'fx');
});

test('the CLI: --drafted-from-skill labels the cases, and is refused with no --cases, writing nothing', () => {
  const { root, dir } = existingSkill();
  const draft = path.join(root, 'cases-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ cases: [{ id: 'a', prompt: 'p', rubric: 'r' }] }));
  const before = tree(dir);
  const refused = cli(['init', dir, '--drafted-from-skill'], root);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--drafted-from-skill labels the cases given with --cases/);
  assert.deepEqual(tree(dir), before);
  const r = cli(['init', dir, '--cases', draft, '--drafted-from-skill'], root);
  assert.equal(r.status, 0, r.stderr);
  const suite = JSON.parse(fs.readFileSync(path.join(dir, 'evals', 'evals.json'), 'utf8'));
  assert.match(suite.origin, /drafted from the skill and approved by the user/);
  assert.equal(suite.cases[0].origin, suite.origin);
});
