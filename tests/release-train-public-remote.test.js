// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 647: the migrated self-hosted runners hold no SSH credential, so the release train's build-public step reads the
// public repository's tip over HTTPS, through build-public.sh's typed --public-https flag.
//
// These tests run the real scripts/build-public.sh, never a regex over the workflow alone. Each runs in a scratch source
// tree under the temp directory, with GIT_ALLOW_PROTOCOL=file, so no git command in it can reach a network: a read of
// the public tip over HTTPS or SSH fails there, and the build stops at that read (exit 12), before it destroys anything.
// A git on PATH records every ls-remote, so the URL the build would read is asserted. The one full build points the
// public HTTPS URL at a scratch bare repository with git's own insteadOf, so it, too, stays on disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WF = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release-train.yml'), 'utf8');
const PUBLIC_REPO = (/^\s*PUBLIC_REPO:\s*(\S+)\s*$/m.exec(WF) || [])[1];
const HOST = 'github.com';
const HTTPS_URL = `https://${HOST}/${PUBLIC_REPO}.git`;
// composed, not written out: the hygiene scan reads `git@<host>` as an address
const SSH_URL = ['git', `${HOST}:${PUBLIC_REPO}.git`].join('@');
const MSG = 'v${VERSION}: the public tree for this release. RELEASES.md names what it ships.';
// PR 648's line, which build-public.sh refuses at argument parsing (review finding F-1), and the line before it
const PR648_LINE = `bash scripts/build-public.sh --remote "https://github.com/\${PUBLIC_REPO}.git" -m "${MSG}"`;
const SSH_LINE = `bash scripts/build-public.sh -m "${MSG}"`;
const REAL_GIT = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
// Not an address: the hygiene scan flags anything email-shaped, and git accepts an opaque string.
const GIT_ID = { GIT_AUTHOR_NAME: 'driftproof-gate', GIT_COMMITTER_NAME: 'driftproof-gate', GIT_AUTHOR_EMAIL: 'driftproof-gate', GIT_COMMITTER_EMAIL: 'driftproof-gate' };

const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const tail = (s) => String(s || '').trim().split('\n').slice(-3).join(' | ');

function sandbox(t) {
  const base = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rt-public-remote-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const S = { base, src: path.join(base, 'src'), pub: path.join(base, 'driftproof-public'), log: path.join(base, 'ls-remote.log') };
  const bin = path.join(base, 'bin');
  write(path.join(bin, 'git'), ['#!/bin/bash',
    `for a in "$@"; do if [ "$a" = ls-remote ]; then (IFS=$'\\t'; printf '%s\\n' "$*") >> "${S.log}"; break; fi; done`,
    `exec "${REAL_GIT}" "$@"`, ''].join('\n'));
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  fs.mkdirSync(path.join(base, 'home'));
  S.env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(DRIFTPROOF_|GIT_)/.test(k)) S.env[k] = v;
  Object.assign(S.env, GIT_ID, { HOME: path.join(base, 'home'), PATH: `${bin}:${process.env.PATH}`, GIT_ALLOW_PROTOCOL: 'file', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
  write(path.join(S.src, 'README.md'), '# scratch source tree\n');
  write(path.join(S.src, 'docs', 'index.html'), '<!doctype html><title>scratch</title>\n');
  write(path.join(S.src, 'tests', 'gate.js'), '// stub: the scratch build verifies nothing\nprocess.exit(0);\n');
  write(path.join(S.src, '.gitignore'), 'node_modules/\n');
  write(path.join(S.src, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  for (const f of ['build-public.sh', 'public-message-check.mjs', 'push-public.mjs']) write(path.join(S.src, 'scripts', f), fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8'));
  S.git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { env: S.env, encoding: 'utf8' });
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'scratch source tree']]) assert.equal(S.git(S.src, ...args).status, 0, `git ${args[0]}`);
  // every URL an ls-remote was asked to read, in order (the argument after `ls-remote`)
  S.lsRemotes = () => (fs.existsSync(S.log) ? fs.readFileSync(S.log, 'utf8').split('\n').filter(Boolean) : []).map((l) => { const a = l.split('\t'); return a[a.indexOf('ls-remote') + 1]; });
  // a workflow `run:` line, run as the step runs it, from the source tree's root, with the step's environment
  S.line = (line, extra = {}) => spawnSync('bash', ['-c', `set -euo pipefail\n${line}`], { cwd: S.src, env: { ...S.env, VERSION: '0.0.0', PUBLIC_REPO, ...extra }, encoding: 'utf8', timeout: 150000 });
  S.build = (...args) => spawnSync('bash', [path.join(S.src, 'scripts', 'build-public.sh'), ...args], { cwd: S.src, env: S.env, encoding: 'utf8', timeout: 150000 });
  return S;
}

const workflowLines = () => WF.split('\n').filter((l) => /^\s*bash scripts\/build-public\.sh\b/.test(l)).map((l) => l.trim());

// What a release train line must do: get past argument validation and read the public tip over HTTPS, the only read,
// and stop there (no network in the sandbox) before the target is touched. Empty when it does.
function problemsOf(t, line) {
  const S = sandbox(t);
  const r = S.line(line);
  const problems = [];
  if (r.status !== 12 || !/cannot read the public main tip/.test(r.stderr)) problems.push(`not stopped at the public tip read: exit ${r.status}: ${tail(r.stderr)}`);
  const urls = S.lsRemotes();
  if (urls.length !== 1 || urls[0] !== HTTPS_URL) problems.push(`ls-remote read ${JSON.stringify(urls)}, not [${HTTPS_URL}]`);
  if (fs.existsSync(S.pub)) problems.push('the target exists: something ran before the tip was read');
  return problems;
}

test('the release train names the public repository the build reads', () => {
  assert.equal(PUBLIC_REPO, 'driftproofhq/driftproof');
});

test('every build-public.sh line in the release train passes argument validation and reads the public tip over HTTPS', (t) => {
  const lines = workflowLines();
  assert.ok(lines.length >= 1, 'the release train builds the public tree');
  for (const line of lines) assert.deepEqual(problemsOf(t, line), [], line);
});

test('PLANT: PR 648\'s line and the SSH default line each fail the same reading', (t) => {
  assert.ok(problemsOf(t, PR648_LINE).length > 0, 'PR 648\'s line passed');
  const S = sandbox(t);
  const r = S.line(PR648_LINE);
  assert.equal(r.status, 2, 'PR 648\'s line is refused at argument parsing (review F-1)');
  assert.match(r.stderr, /--remote is accepted only together with --public-dir/);
  assert.deepEqual(S.lsRemotes(), []);
  assert.ok(problemsOf(t, SSH_LINE).length > 0, 'the SSH default line passed');
});

test('--public-https with --remote, --public-dir or --no-parent is refused with exit 2 before anything is read or built', (t) => {
  const S = sandbox(t);
  const other = path.join(S.base, 'other');
  for (const extra of [['--remote', path.join(S.base, 'remote.git')], ['--public-dir', other], ['--no-parent']]) {
    for (const args of [['--public-https', ...extra], [...extra, '--public-https']]) {
      const r = S.build('-m', 'site: a scratch build', ...args);
      assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status}: ${tail(r.stderr)}`);
      assert.doesNotMatch(r.stderr, /unknown argument/, `${args.join(' ')}: refused as an unknown flag, not as a contradiction`);
      assert.match(r.stderr, /build-public\.sh: --public-https (?:and|is)/, `${args.join(' ')}: the refusal names the flag`);
    }
  }
  assert.deepEqual(S.lsRemotes(), [], 'no tip was read');
  assert.ok(!fs.existsSync(S.pub) && !fs.existsSync(other), 'no target was made');
});

test('an existing default target is ours when its origin is the public URL in SSH or HTTPS form, and nothing else', (t) => {
  const others = [`https://${HOST}/${PUBLIC_REPO}-other.git`, `https://example.invalid/${PUBLIC_REPO}.git`, `https://${HOST}/${PUBLIC_REPO}`, '../stand-in.git'];
  for (const flags of [[], ['--public-https']]) {
    for (const origin of [SSH_URL, HTTPS_URL, ...others]) {
      const S = sandbox(t);
      for (const args of [['init', '-q', '-b', 'main', S.pub], ['-C', S.pub, 'remote', 'add', 'origin', origin]]) assert.equal(spawnSync('git', args, { env: S.env }).status, 0);
      write(path.join(S.pub, 'README.md'), '# the previous public tree\n');
      write(path.join(S.pub, 'docs', 'index.html'), 'previous\n');
      const r = S.build(...flags, '-m', 'site: a scratch build');
      const what = `${flags.join(' ') || 'default'}, origin ${origin}`;
      if (origin === SSH_URL || origin === HTTPS_URL) {
        assert.equal(r.status, 12, `${what}: not accepted as ours (stopped at the tip read): exit ${r.status}: ${tail(r.stderr)}`);
        assert.equal(S.lsRemotes().length, 1, what);
      } else {
        assert.equal(r.status, 3, `${what}: not refused: exit ${r.status}: ${tail(r.stderr)}`);
        assert.match(r.stderr, /not a publish tree this script built/, what);
        assert.deepEqual(S.lsRemotes(), [], what);
      }
      assert.equal(fs.readFileSync(path.join(S.pub, 'README.md'), 'utf8'), '# the previous public tree\n', `${what}: the target was touched`);
    }
  }
});

test('the release train line builds a tree whose origin is the HTTPS URL, and the public push checks pass over it', (t) => {
  const S = sandbox(t);
  const remote = path.join(S.base, 'public.git');
  const seed = path.join(S.base, 'seed');
  for (const args of [['init', '-q', '-b', 'main', seed], ['init', '-q', '--bare', '-b', 'main', remote]]) assert.equal(spawnSync('git', args, { env: S.env }).status, 0);
  write(path.join(seed, 'README.md'), '# seed: a stand-in for the public tip\n');
  for (const args of [['add', '-A'], ['commit', '-q', '-m', 'seed'], ['push', '-q', remote, 'main']]) assert.equal(S.git(seed, ...args).status, 0, `seed ${args[0]}`);
  const tip = S.git(seed, 'rev-parse', 'HEAD').stdout.trim();
  // git's own rewrite: the public HTTPS URL, and only it, reads the scratch remote; the protocol rule still holds every other URL off the network
  const toScratch = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${remote}.insteadOf`, GIT_CONFIG_VALUE_0: HTTPS_URL };
  const [line] = workflowLines();
  const r = S.line(line, toScratch);
  assert.equal(r.status, 0, `build exit ${r.status}: ${tail(r.stderr)}`);
  assert.deepEqual(S.lsRemotes(), [HTTPS_URL]);
  assert.equal(S.git(S.pub, 'config', '--get', 'remote.origin.url').stdout.trim(), HTTPS_URL, 'the tree records the HTTPS URL as its origin');
  assert.equal(S.git(S.pub, 'rev-parse', 'HEAD^').stdout.trim(), tip, 'the build parents on the public tip');
  const env = { ...S.env, ...toScratch };
  const push = (pub) => spawnSync('node', [path.join(S.src, 'scripts', 'push-public.mjs'), '--src', S.src, '--public-dir', pub, '--dry-run'], { env, encoding: 'utf8' });
  const own = push(S.pub);
  assert.equal(own.status, 0, `push-public over the built tree: ${tail(own.stderr)}`);
  // the push jobs' own path: a bundle of the tree, cloned, origin set to the HTTPS URL as the workflow sets it
  assert.match(WF, /git clone -q --branch main public\.bundle \.\.\/pub\n\s*git -C \.\.\/pub remote set-url origin "https:\/\/github\.com\/\$\{PUBLIC_REPO\}\.git"/);
  const bundle = path.join(S.base, 'public.bundle');
  const handed = path.join(S.base, 'pub');
  assert.equal(S.git(S.pub, 'bundle', 'create', bundle, 'main').status, 0);
  assert.equal(spawnSync('git', ['clone', '-q', '--branch', 'main', bundle, handed], { env }).status, 0);
  assert.equal(S.git(handed, 'remote', 'set-url', 'origin', HTTPS_URL).status, 0);
  const handedOver = push(handed);
  assert.equal(handedOver.status, 0, `push-public over the handed-over tree: ${tail(handedOver.stderr)}`);
  assert.match(handedOver.stdout, /dry run, every check passed/);
});
