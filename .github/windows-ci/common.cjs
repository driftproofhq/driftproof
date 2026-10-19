// SPDX-License-Identifier: Apache-2.0
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { tokenize, htmlToText } = require('../../scripts/html-text');
const ROOT = path.resolve(__dirname, '../..');
const CLOSED = 'http://127.0.0.1:1';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function cleanEnv(given = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(given)) {
    if (/API_KEY|TOKEN|SECRET|CREDENTIAL|^ANTHROPIC_|^OPENAI_|^CLAUDE_|^DRIFTPROOF_|^SPEC\d|^NODE_OPTIONS$|^NODE_PATH$|^NODE_TEST_|^(?:HTTP|HTTPS|ALL)_PROXY$|^npm_config_(?!cache$)/i.test(key)) continue;
    env[key] = value;
  }
  return { ...env, DRIFTPROOF_STUB: '1', ANTHROPIC_BASE_URL: CLOSED, OPENAI_BASE_URL: CLOSED + '/v1', npm_config_ignore_scripts: 'true' };
}
function prepare() {
  assert.equal(process.env.DRIFTPROOF_STUB, '1', 'Windows assertions require DRIFTPROOF_STUB=1');
  const env = cleanEnv();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  endpointPlant();
}
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: ROOT, env: cleanEnv(), encoding: 'utf8', timeout: 1800000, ...options });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', ...(result.error ? { error: result.error.message } : {}) };
}
function success(result, name) {
  assert.equal(result.status, 0, name + ': ' + result.stderr + (result.error || ''));
}
function endpointAttempt(env = cleanEnv()) {
  return run(process.execPath, ['-e', "const http=require('node:http');const r=http.get(process.env.ANTHROPIC_BASE_URL,()=>{process.exitCode=0;});r.on('error',e=>{console.error(e.code);process.exitCode=1;});"], { env });
}
function endpointPlant() {
  const result = endpointAttempt();
  assert.notEqual(result.status, 0, 'closed provider endpoint accepted a request');
  assert.match(result.stderr, /ECONNREFUSED/, 'the provider request must fail at the closed local port');
}
let cli;
function npmCLI() {
  if (cli) return cli;
  for (const dir of [path.dirname(process.execPath), ...(process.env.PATH || process.env.Path || '').split(path.delimiter)]) {
    const candidates = [path.join(dir, 'node_modules/npm/bin/npm-cli.js')];
    for (const name of ['npm', 'npm.cmd']) {
      try {
        const real = fs.realpathSync(path.join(dir, name));
        if (real.endsWith('npm-cli.js')) candidates.push(real);
      } catch { /* try the next installed npm entry */ }
    }
    for (const candidate of candidates) if (fs.existsSync(candidate)) { cli = candidate; return cli; }
  }
  throw new Error('the runner has no npm CLI beside Node or on PATH');
}
function npmArguments(command, args) { return [command, '--ignore-scripts', ...args]; }
function npm(command, args, options) { return run(process.execPath, [npmCLI(), ...npmArguments(command, args)], options); }
function npx(args, options) { return run(process.execPath, [path.join(path.dirname(npmCLI()), 'npx-cli.js'), ...args], options); }
function snapshot(dir, skipDependencies = false) {
  const out = {};
  function walk(at) {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      if (skipDependencies && entry.name === 'node_modules') continue;
      const full = path.join(at, entry.name), relative = path.relative(dir, full).split(path.sep).join('/');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[relative] = sha256(fs.readFileSync(full));
      else throw new Error('snapshot refuses a non-plain entry: ' + relative);
    }
  }
  walk(dir); return out;
}
function textFiles(dir) {
  const result = {};
  for (const file of Object.keys(snapshot(dir))) result[file] = fs.readFileSync(path.join(dir, file), 'utf8');
  return result;
}
function assertUnchanged(before, after) { assert.deepEqual(after, before, 'existing bytes changed'); }
function readPacked(file) {
  const packed = fs.readFileSync(file), tar = zlib.gunzipSync(packed), files = {};
  let at = 0, extended = {}, longPath = null;
  const str = (buf) => buf.toString('utf8').replace(/\0.*$/s, '');
  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512);
    if (header.every((v) => v === 0)) break;
    const size = parseInt(str(header.subarray(124, 136)).trim() || '0', 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0, 'tar size');
    let name = str(header.subarray(0, 100));
    const prefix = str(header.subarray(345, 500)); if (prefix) name = prefix + '/' + name;
    const type = String.fromCharCode(header[156] || 48);
    const bytes = tar.subarray(at + 512, at + 512 + size);
    assert.equal(bytes.length, size, 'complete tar member');
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      extended = {};
      let offset = 0;
      while (offset < bytes.length) {
        const space = bytes.indexOf(32, offset), length = Number(bytes.subarray(offset, space).toString());
        assert.ok(length > 0 && offset + length <= bytes.length, 'pax length');
        const entry = bytes.subarray(space + 1, offset + length - 1).toString();
        const eq = entry.indexOf('='); extended[entry.slice(0, eq)] = entry.slice(eq + 1); offset += length;
      }
      continue;
    }
    if (type === 'L') { longPath = str(bytes); continue; }
    name = extended.path || longPath || name; extended = {}; longPath = null;
    if (type === '5') continue;
    assert.ok(type === '0' || type === '\0', 'packed entry is a plain file');
    assert.ok(name.startsWith('package/'), 'package member prefix');
    name = name.slice('package/'.length);
    assert.ok(name && !name.split('/').includes('..') && !name.startsWith('/') && !name.includes('\\'), 'safe package member');
    assert.ok(!Object.hasOwn(files, name), 'unique packed member');
    files[name] = sha256(bytes);
  }
  assert.ok(Object.keys(files).length, 'packed file inventory');
  return { sha256: sha256(packed), files };
}
function assertInstalled(manifest, dir) {
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/, 'recorded tarball sha256');
  assert.deepEqual(snapshot(dir, true), manifest.files, 'installed files differ from packed bytes');
}
function verifyFromNpx(recordFile) {
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  assert.equal(sha256(fs.readFileSync(record.tarball)), record.sha256, 'tarball digest changed');
  for (const dir of (process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    const shim = ['driftproof', 'driftproof.cmd'].some((name) => fs.existsSync(path.join(dir, name)));
    if (!shim) continue;
    const installed = path.resolve(dir, '../driftproof');
    assert.ok(path.relative(record.cacheDir, installed).split(path.sep)[0] !== '..', 'the installed package is in the fresh cache');
    assertInstalled(record, installed);
    record.installed = installed;
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2) + '\n');
    return;
  }
  throw new Error('npx did not expose its installed driftproof');
}
function plantArg(allowed) {
  if (process.argv.length === 2) return null;
  assert.equal(process.argv.length, 3, 'one mutation argument');
  const plant = process.argv[2].replace(/^--plant=/, '');
  assert.equal(process.argv[2], '--plant=' + plant);
  assert.ok(allowed.includes(plant), 'known executable-boundary mutation'); return plant;
}
function ownMutation(file, plant, cause) {
  const result = run(process.execPath, [file, '--plant=' + plant]);
  assert.notEqual(result.status, 0, 'executable accepted poisoned ' + plant + ' observation');
  assert.match(result.stderr, new RegExp(cause), 'executable failed at the collection-boundary assertion');
}
// Issue 420: extract text with the existing tokenizer. These strings are test
// observations, never sanitized HTML to render. Keep each reader's own spacing
// and entity policy, and keep script attributes in the resource check.
function visibleHtml(html) {
  return htmlToText(html, { skip: ['script', 'style'], tagText: ' ', commentText: ' ', collapse: true,
    decode: (text) => text.replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[0-9a-f]+);/gi, (entity) => {
      const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
      if (named[entity]) return named[entity];
      return String.fromCodePoint(parseInt(entity.slice(2, -1).replace(/^x/i, ''), entity[2].toLowerCase() === 'x' ? 16 : 10));
    }),
  });
}
function htmlOutsideScriptBodies(html) {
  let inside = false;
  let out = '';
  let consumed = 0;
  for (const token of tokenize(html)) {
    consumed += (token.type === 'text' ? token.text : token.raw).length;
    if (token.type === 'start' && token.name === 'script') inside = true;
    else if (token.type === 'end' && token.name === 'script') inside = false;
    if (token.type === 'text') {
      if (!inside) out += token.text;
    } else out += token.raw;
  }
  // The tokenizer drops an unfinished tag. Keep its source here so a resource
  // attribute in that tail cannot disappear from the assertion.
  return out + html.slice(consumed);
}
function documentationText(text) {
  return htmlToText(text, { collapse: true });
}

function main(fn) { Promise.resolve().then(fn).catch((error) => { console.error(error.message); process.exitCode = 1; }); }
if (require.main === module) main(() => { prepare(); assert.equal(process.argv[2], '--verify-installed'); verifyFromNpx(process.argv[3]); });
module.exports = { ROOT, CLOSED, sha256, cleanEnv, prepare, run, success, npmArguments, npm, npx, snapshot, textFiles,
  assertUnchanged, readPacked, assertInstalled, endpointAttempt, endpointPlant, plantArg, ownMutation, visibleHtml, htmlOutsideScriptBodies, documentationText, main };
