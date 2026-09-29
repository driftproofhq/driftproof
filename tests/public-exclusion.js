// SPDX-License-Identifier: Apache-2.0
'use strict';

// The public build leaves the architecture reviews out (spec 064 AC-5), read by tests/gate.js on every
// branch, because specs/ is not in the published tree. Each review branch keeps its working material
// under docs/reviews/, and EXCLUDE_RE in scripts/build-public.sh is what keeps it out of a publish.
//
// Read by behaviour, not through the pattern: a scratch source repository under `dir` tracks a
// docs/reviews/ file and a file that only resembles the path, the given build-public.sh builds it into
// a second directory under `dir`, and the built tree is read on disk and in its commit. The scratch
// tree carries a stub tests/gate.js, so the build's own verification step cannot run the repository
// gate again, and the build is told it is at depth 0, so it runs the same way standalone or under a
// real publish's verification.
//
// reviewsLeftOut({ script, dir, env, timeout }) returns { pass, detail } and never throws on a failed
// build: a failed build is a failed check. The caller removes `dir`.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LEFT_OUT = 'docs/reviews/2026-09-arch/REGISTER.md';
const SHIPS = 'docs/reviews.md';
const PLANTS = {
  'README.md': '# scratch source tree (the repository gate, spec 064)\n',
  'docs/index.html': '<!doctype html><title>scratch</title>\n',
  [LEFT_OUT]: 'planted review material\n',
  [SHIPS]: 'resembles the excluded path and ships\n',
  'tests/gate.js': '// stub: the scratch build verifies nothing\nprocess.exit(0);\n',
  '.gitignore': 'node_modules/\n',
};
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

function reviewsLeftOut({ script, dir, env = process.env, timeout = 150000 }) {
  const src = path.join(dir, 'src');
  const pub = path.join(dir, 'public');
  const e = { ...env, ...GIT_ID, DRIFTPROOF_BUILD_DEPTH: '0' };
  for (const k of Object.keys(e)) if (k.startsWith('DRIFTPROOF_') && k !== 'DRIFTPROOF_BUILD_DEPTH') delete e[k];
  const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { env: e, encoding: 'utf8', timeout });
  for (const [f, body] of Object.entries(PLANTS)) {
    fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true });
    fs.writeFileSync(path.join(src, f), body);
  }
  fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
  fs.copyFileSync(script, path.join(src, 'scripts', 'build-public.sh'));
  fs.mkdirSync(path.join(src, 'node_modules'), { recursive: true });
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'scratch source tree']]) {
    const r = git(src, args);
    if (r.status !== 0) return { pass: false, detail: { step: `git ${args[0]}`, rc: r.status, err: String(r.stderr).slice(0, 200) } };
  }
  const tracked = git(src, ['ls-files']).stdout.split('\n').filter(Boolean);
  const b = spawnSync('bash', [path.join(src, 'scripts', 'build-public.sh'),
    '-m', 'repository gate scratch build, not a publish', '--public-dir', pub],
  { cwd: src, env: e, encoding: 'utf8', timeout });
  const disk = fs.existsSync(pub) ? walk(pub) : [];
  const commit = fs.existsSync(path.join(pub, '.git')) ? git(pub, ['ls-files']).stdout.split('\n').filter(Boolean) : [];
  const leaked = [...new Set([...disk, ...commit].filter((f) => f.startsWith('docs/reviews/')))];
  const shipped = disk.includes(SHIPS) && commit.includes(SHIPS);
  const planted = tracked.includes(LEFT_OUT);
  return {
    pass: b.status === 0 && planted && leaked.length === 0 && shipped,
    detail: {
      rc: b.status, planted, leaked, shipped, built: disk.length,
      err: b.status === 0 ? '' : `${b.stderr || ''}`.split('\n').slice(-4).join(' | ').slice(0, 300),
    },
  };
}

module.exports = { reviewsLeftOut };
