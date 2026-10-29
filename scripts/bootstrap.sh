#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Fresh-checkout setup. See RUNBOOK.md, Reproducible gate inputs (issue 476).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node - "$ROOT" "$@" <<'NODE'
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const [root, ...args] = process.argv.slice(2);
const check = args.length === 1 && args[0] === '--check';
const sha = (b, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(b).digest(encoding);
const fail = (message) => { throw Error(message); };
// Inventory paths never traverse a parent or a symlink. Private evidence may
// contain symlinks, but only links explicitly sealed in its link inventory.
function under(base, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.split('/').some(p => !p || p === '.' || p === '..') || path.isAbsolute(rel)) fail('unsafe inventory path');
  let at = base;
  for (const part of rel.split('/')) {
    at = path.join(at, part);
    if (fs.existsSync(at) && fs.lstatSync(at).isSymbolicLink()) fail('unsafe symlink in inventory path');
  }
  return at;
}
function bytes(file, expected, name) {
  let b;
  try { b = fs.readFileSync(file); } catch { fail(`${name}: missing or unreadable input; run bash scripts/bootstrap.sh to restore it`); }
  if (sha(b) !== expected) fail(`${name}: sha256 mismatch`);
  return b;
}
function inventory(input) {
  const b = bytes(under(root, input.inventory), input.sha256, input.id + ' inventory');
  const entries = input.format === 'responses'
    ? Object.entries(JSON.parse(b).responses).map(([rel, hash]) => ({ rel, hash }))
    : b.toString().split('\n').filter(Boolean).map(line => {
      const m = /^([a-f0-9]{64}) [ *](.+)$/.exec(line);
      if (!m) fail(`${input.id}: invalid checksum inventory`);
      return { rel: m[2].replace(/^\.\//, ''), hash: m[1] };
    });
  if (input.inventoryCopy) entries.push({ rel: input.inventoryCopy, hash: input.sha256, content: b });
  if (input.symlinks) {
    const links = bytes(under(root, input.symlinks.path), input.symlinks.sha256, input.id + ' link inventory');
    for (const line of links.toString().split('\n').filter(Boolean)) {
      const at = line.indexOf(' -> ');
      if (at < 1) fail(`${input.id}: invalid link inventory`);
      entries.push({ rel: line.slice(0, at), target: line.slice(at + 4) });
    }
  }
  if (!entries.length || new Set(entries.map(e => e.rel)).size !== entries.length) fail(`${input.id}: empty or duplicate inventory`);
  return entries;
}
function walk(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
  });
}
try {
  if (args.length && !check) fail('usage: bash scripts/bootstrap.sh [--check]');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bootstrap-inputs.json')));
  if (manifest.version !== 1 || !Array.isArray(manifest.inputs)) fail('unsupported input manifest');
  const archive = process.env.DRIFTPROOF_BOOTSTRAP_INPUTS;
  const restore = [];
  let count = 0;
  // Preflight every private byte before copying anything or installing packages.
  for (const input of manifest.inputs) {
    if (!input.id || !input.source || !input.version || !/^[a-f0-9]{64}$/.test(input.sha256)) fail('invalid input identity');
    if (input.kind === 'npm') continue;
    if (input.kind === 'lock') { bytes(under(root, input.path), input.sha256, input.id); continue; }
    const base = under(root, input.base);
    const entries = input.kind === 'file' ? [{ rel: input.path, hash: input.sha256 }] : inventory(input);
    const wanted = new Set(entries.map(e => e.rel));
    if (input.exact && walk(base).some(f => !wanted.has(f))) fail(`${input.id}: unlisted file in input tree`);
    for (const dir of input.directories || []) {
      const extra = walk(under(base, dir), dir).filter(f => !wanted.has(f) && !(input.ignore || []).includes(f));
      if (extra.length) fail(`${input.id}: unlisted file in ${dir}`);
    }
    for (const entry of entries) {
      const { rel, hash, target } = entry;
      if (hash && !/^[a-f0-9]{64}$/.test(hash)) fail(`${input.id}: invalid payload sha256`);
      // Check the parents separately, since a sealed symlink is allowed as a leaf.
      const leaf = target === undefined ? under(base, rel) : path.join(path.posix.dirname(rel) === '.' ? base : under(base, path.posix.dirname(rel)), path.posix.basename(rel));
      if (target !== undefined && (path.isAbsolute(target) || path.relative(base, path.resolve(path.dirname(leaf), target)).startsWith('..'))) fail(`${input.id}: unsafe link target`);
      const exists = fs.existsSync(leaf) || (() => { try { fs.lstatSync(leaf); return true; } catch { return false; } })();
      if (exists) {
        if (target === undefined) {
          if (!fs.lstatSync(leaf).isFile()) fail(`${input.id}: expected a regular file`);
          bytes(leaf, hash, input.id);
        } else if (!fs.lstatSync(leaf).isSymbolicLink() || fs.readlinkSync(leaf) !== target) fail(`${input.id}: link differs from inventory`);
      } else {
        if (check) fail(`${input.id}: missing local input; run bash scripts/bootstrap.sh with DRIFTPROOF_BOOTSTRAP_INPUTS`);
        if (target !== undefined) restore.push({ leaf, target });
        else if (entry.content) restore.push({ leaf, content: entry.content });
        else {
          if (!archive) fail(`${input.id}: private input unavailable. Source: ${input.source}. Set DRIFTPROOF_BOOTSTRAP_INPUTS to an archive root with repository-relative paths, then rerun bash scripts/bootstrap.sh`);
          const from = under(path.resolve(archive), `${input.base}/${rel}`);
          if (!fs.existsSync(from)) fail(`${input.id}: private input missing in restore root. Source: ${input.source}. Restore ${input.base}/${rel} and rerun bash scripts/bootstrap.sh`);
          bytes(from, hash, input.id);
          restore.push({ leaf, from, hash, id: input.id });
        }
      }
      count++;
    }
  }
  const state = under(root, 'state/bootstrap');
  const cache = under(root, 'state/bootstrap/npm');
  const tarballs = under(root, 'state/bootstrap/tarballs');
  const npmInputs = manifest.inputs.filter(i => i.kind === 'npm');
  if (check) {
    for (const input of npmInputs) bytes(under(tarballs, `ajv-${input.version}.tgz`), input.sha256, input.id);
    console.log(`bootstrap: verified ${count} private files and links; ${npmInputs.length} tarballs`);
    process.exit(0);
  }
  for (const entry of restore) {
    fs.mkdirSync(path.dirname(entry.leaf), { recursive: true, mode: 0o700 });
    if (entry.target !== undefined) fs.symlinkSync(entry.target, entry.leaf);
    else if (entry.content) fs.writeFileSync(entry.leaf, entry.content, { flag: 'wx', mode: 0o600 });
    else { fs.copyFileSync(entry.from, entry.leaf, fs.constants.COPYFILE_EXCL); fs.chmodSync(entry.leaf, 0o600); bytes(entry.leaf, entry.hash, entry.id); }
  }
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  fs.mkdirSync(tarballs, { recursive: true, mode: 0o700 });
  function npm(args) {
    const r = spawnSync('npm', [...args, '--registry', 'https://registry.npmjs.org'], {
      cwd: root, stdio: 'inherit', timeout: 1800000,
      env: { ...process.env, npm_config_cache: cache },
    });
    if (r.error || r.status !== 0) fail(`npm ${args[0]} failed; rerun bash scripts/bootstrap.sh`);
  }
  npm(['ci', '--include=dev']);
  for (const input of npmInputs) {
    // Populate registry metadata as well as content: a cached local tgz alone
    // cannot satisfy npm pack ajv@version --offline on a fresh cache.
    if (input.source !== `https://registry.npmjs.org/ajv/-/ajv-${input.version}.tgz`) fail(`${input.id}: unsupported registry source`);
    npm(['cache', 'add', `ajv@${input.version}`]);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-ajv-'));
    try {
      npm(['pack', `ajv@${input.version}`, '--offline', '--silent', '--pack-destination', scratch]);
      const file = path.join(scratch, `ajv-${input.version}.tgz`);
      const b = bytes(file, input.sha256, input.id);
      if ('sha512-' + sha(b, 'sha512', 'base64') !== input.integrity) fail(`${input.id}: sha512 mismatch`);
      fs.copyFileSync(file, path.join(tarballs, path.basename(file)));
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
  console.log(`bootstrap: ready; ${count} private files and links verified; ${npmInputs.length} offline ajv versions; npm ci completed`);
  const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
  const home = os.homedir();
  const value = cache.startsWith(home + path.sep) ? '~/' + quote(path.relative(home, cache)) : quote(cache);
  console.log('export npm_config_cache=' + value);
} catch (error) {
  // Do not echo absolute paths, archive contents or subprocess environments.
  console.error('bootstrap: ' + (error.code ? `${error.code}; restore the named inputs and rerun bash scripts/bootstrap.sh` : error.message));
  process.exitCode = 1;
}
NODE
