// SPDX-License-Identifier: Apache-2.0
'use strict';

// PUBLIC-PATH CHANGE probe. Builds a scratch source tree that tracks every pipeline file the public
// tree must not carry, plus the files it must carry, runs the real scripts/build-public.sh on it into
// a second directory, and reads the built tree on disk and in its commit. Nothing outside the scratch
// directory is touched and no gate runs: the scratch tree carries a stub tests/gate.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'build-public.sh');

const OUT = [
  ...['sweep', 'gates', 'nightly', 'build', 'review', 'fix-on-red', 'merge-on-green', 'queue', 'release-train', 'digest', 'labels']
    .map((n) => `.github/workflows/${n}.yml`),
  '.github/prompts/build.md',
  '.github/prompts/nested/review.md',
  '.github/ISSUE_TEMPLATE/spec.yml',
  'scripts/pipeline.mjs',
  'scripts/sweep-shards.mjs',
  'scripts/runner-setup.sh',
  'specs/000-governance/gate-map.json',
  'tests/pipeline.test.js',
  // a test does not ship without its subject: scripts/sweep-shards.mjs is out, so its test is too
  'tests/sweep-shards.test.js',
  // its subjects, build.yml and release-train.yml, are out, so it is too (spec 176)
  'tests/release-freeze-and-cause.test.js',
  'CLAUDE.md',
  'DECISIONS.md',
];
const IN = [
  '.github/workflows/release.yml',
  // release.yml reads it in the release commit, so the public tree carries it
  'release-record.json',
  '.github/workflows/action-selftest.yml',
  '.github/workflows/plugin-selftest.yml',
  'scripts/release-body.mjs',
  'scripts/indexnow.mjs',
  'tests/release-body.test.js',
  // names that resemble an excluded one and must still ship
  '.github/workflows/release-notes.yml',
  '.github/ISSUE_TEMPLATE/bug.yml',
  'scripts/pipeline-helper.mjs',
];

// Not an address: the hygiene scan flags anything email-shaped, and git accepts an opaque string.
const GIT_ID = {
  GIT_AUTHOR_NAME: 'driftproof-gate', GIT_COMMITTER_NAME: 'driftproof-gate',
  GIT_AUTHOR_EMAIL: 'driftproof-gate', GIT_COMMITTER_EMAIL: 'driftproof-gate',
};

function walk(root, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (!rel && (d.name === '.git' || d.name === 'node_modules')) continue;
    if (d.isDirectory()) out.push(...walk(root, r)); else out.push(r);
  }
  return out;
}

test('the public build leaves out every pipeline file and ships release.yml', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'pipe-exclusion-'));
  try {
    const src = path.join(dir, 'src');
    const pub = path.join(dir, 'public');
    const e = { ...process.env, ...GIT_ID, DRIFTPROOF_BUILD_DEPTH: '0' };
    for (const k of Object.keys(e)) if (k.startsWith('DRIFTPROOF_') && k !== 'DRIFTPROOF_BUILD_DEPTH') delete e[k];
    const plants = {
      'README.md': '# scratch source tree\n',
      'docs/index.html': '<!doctype html><title>scratch</title>\n',
      'tests/gate.js': '// stub: the scratch build verifies nothing\nprocess.exit(0);\n',
      '.gitignore': 'node_modules/\n',
    };
    for (const f of [...OUT, ...IN]) plants[f] = `planted ${f}\n`;
    for (const [f, body] of Object.entries(plants)) {
      fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true });
      fs.writeFileSync(path.join(src, f), body);
    }
    fs.copyFileSync(SCRIPT, path.join(src, 'scripts', 'build-public.sh'));
    fs.mkdirSync(path.join(src, 'node_modules'), { recursive: true });
    const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { env: e, encoding: 'utf8' });
    for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'scratch source tree']]) {
      assert.strictEqual(git(src, args).status, 0, `git ${args[0]}`);
    }
    const tracked = git(src, ['ls-files']).stdout.split('\n').filter(Boolean);
    for (const f of [...OUT, ...IN]) assert.ok(tracked.includes(f), `planted and tracked: ${f}`);

    const b = spawnSync('bash', [path.join(src, 'scripts', 'build-public.sh'), '-m', 'scratch build, not a publish', '--public-dir', pub],
      { cwd: src, env: e, encoding: 'utf8', timeout: 150000 });
    assert.strictEqual(b.status, 0, `build exit: ${String(b.stderr).split('\n').slice(-4).join(' | ')}`);

    const disk = walk(pub);
    const commit = git(pub, ['ls-files']).stdout.split('\n').filter(Boolean);
    for (const f of OUT) {
      assert.ok(!disk.includes(f), `${f} must be absent on disk`);
      assert.ok(!commit.includes(f), `${f} must be absent from the commit`);
    }
    for (const f of IN) {
      assert.ok(disk.includes(f), `${f} must be present on disk`);
      assert.ok(commit.includes(f), `${f} must be present in the commit`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
