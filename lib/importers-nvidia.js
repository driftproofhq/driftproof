// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const config = require('../config');
const {sealReceipt, receiptBaseName} = require('./receipt');
const {registryStatus} = require('./models');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const blobSha1 = b => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const {createNvidiaCore, NVIDIA_TOOLS, NvidiaRefused, REPO, MAX_CARD_BYTES, MAX_INDEX_BYTES, HEX40, ISO_UTC, PLAIN, shown, byCodeUnit} = require('./import-core/nvidia.cjs');
const refuse = msg => { throw new NvidiaRefused(msg); };
const {readIndex, parseCard, cardReceipts} = createNvidiaCore({...config, registryStatus, sha256, receiptBaseName});
// ── the checkout (AC-24) ────────────────────────────────────────────────────
// git, with no GIT_ variable of the caller's environment, and only to read: rev-parse and ls-tree.
function gitRead(dir, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync('git', ['-C', dir, '-c', 'core.fsmonitor=false', '--no-optional-locks', ...args], { env, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.error) refuse('git cannot be run: the checkout\'s commit is read with git rev-parse and git ls-tree');
  return r;
}
// The commit's blobs under benchmarks.json and skills/: path -> { mode, type, sha }.
function commitTree(dir, commit) {
  const r = gitRead(dir, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', 'benchmarks.json', 'skills']);
  if (r.status !== 0) refuse(`git ls-tree cannot read commit ${commit}`);
  const tree = new Map();
  for (const ent of r.stdout.toString('utf8').split('\0')) {
    if (!ent) continue;
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40})\t([\s\S]*)$/.exec(ent);
    if (!m) refuse('git ls-tree printed a line of no shape');
    tree.set(m[4], { mode: m[1], type: m[2], sha: m[3] });
  }
  return tree;
}
function checkout(dir, commit) {
  if (commit === undefined || commit === null || commit === true) refuse('--commit <sha> is required: the commit of the checkout read, which is its HEAD');
  if (typeof commit !== 'string' || !HEX40.test(commit)) refuse(`--commit ${shown(commit)} is not a full commit id (40 lowercase hex characters)`);
  if (typeof dir !== 'string' || !dir) refuse('give the NVIDIA/skills checkout to read');
  let st;
  try { st = fs.lstatSync(dir); } catch (_e) { refuse('the path given names no file or directory'); }
  if (st.isSymbolicLink()) refuse('the path given is a symbolic link; links are not followed');
  if (!st.isDirectory()) refuse('the path given is not a directory');
  const top = gitRead(dir, ['rev-parse', '--show-toplevel']);
  let real; let topReal;
  try { real = fs.realpathSync(dir); topReal = top.status === 0 ? fs.realpathSync(top.stdout.toString('utf8').trim()) : null; } catch (_e) { topReal = null; }
  if (top.status !== 0 || real !== topReal) refuse('the path given is not the top of a git work tree: give the checkout of NVIDIA/skills itself');
  const head = gitRead(dir, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const headSha = head.status === 0 ? head.stdout.toString('utf8').trim() : null;
  if (headSha !== commit) refuse(`--commit ${commit} is not the checkout's HEAD (${headSha === null ? 'none' : headSha})`);
  return commitTree(dir, commit);
}

// One file of the checkout, read once (AC-11, AC-19): every folder on the way read with lstat, the
// file opened without following a link, its bytes bounded, and its blob sha1 the commit's (AC-24).
function readSource(dir, rel, limit, limitText, tree, commit, { optional = false } = {}) {
  const parts = rel.split('/');
  let at = dir;
  for (let i = 0; i < parts.length; i++) {
    at = path.join(at, parts[i]);
    const shownAt = parts.slice(0, i + 1).join('/');
    let st;
    try { st = fs.lstatSync(at); } catch (_e) { if (optional) return null; refuse(`${shownAt}: no such ${i === parts.length - 1 ? 'file' : 'folder'} in the checkout`); }
    if (st.isSymbolicLink()) refuse(`${shownAt} is a symbolic link; links are not followed`);
    if (i < parts.length - 1 ? !st.isDirectory() : !st.isFile()) refuse(`${shownAt} is not a regular ${i < parts.length - 1 ? 'folder' : 'file'}`);
  }
  let fd;
  try { fd = fs.openSync(at, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (e) { refuse(e && e.code === 'ELOOP' ? `${rel} is a symbolic link; links are not followed` : `${rel} cannot be opened`); }
  let bytes;
  try {
    if (!fs.fstatSync(fd).isFile()) refuse(`${rel} is not a regular file`);
    const chunks = [];
    let n = 0;
    while (n <= limit) {
      const buf = Buffer.allocUnsafe(Math.min(1 << 20, limit + 1 - n));
      const got = fs.readSync(fd, buf, 0, buf.length, null);
      if (!got) break;
      chunks.push(buf.subarray(0, got));
      n += got;
    }
    if (n > limit) refuse(`${rel} is larger than ${limitText} (limit)`);
    bytes = Buffer.concat(chunks, n);
  } finally { fs.closeSync(fd); }
  const t = tree.get(rel);
  if (!t || t.type !== 'blob' || !/^100(?:644|755)$/.test(t.mode)) refuse(`${rel} is not a regular file in commit ${commit}: a file the commit does not hold is not read`);
  if (t.sha !== blobSha1(bytes)) refuse(`${rel} is not the file commit ${commit} holds (its git blob sha1 differs): the checkout was changed after its commit`);
  return bytes;
}

// ── the import ──────────────────────────────────────────────────────────────
function importNvidiaCards(dir, { commit, only = null, importedAt = null } = {}) {
  try {
    return build(dir, { commit, only, importedAt });
  } catch (e) {
    if (e instanceof NvidiaRefused) throw e;
    refuse(e && e.message ? e.message : String(e));
  }
}

function build(dir, { commit, only, importedAt }) {
  if (importedAt !== null && (typeof importedAt !== 'string' || !ISO_UTC.test(importedAt))) refuse(`the import time ${shown(importedAt)} is not an ISO 8601 UTC time`);
  if (only !== null && (!Array.isArray(only) || !only.length || only.some((s) => typeof s !== 'string'))) refuse('--only takes one or more skills, by catalog_dir');
  for (const s of only || []) if (!PLAIN.test(s)) refuse(`--only ${shown(s)} is not a plain name`);
  const tree = checkout(dir, commit);
  const benchBytes = readSource(dir, 'benchmarks.json', MAX_INDEX_BYTES, '16 MiB', tree, commit);
  const index = readIndex(benchBytes);
  let names;
  if (only) {
    names = [...new Set(only)].sort(byCodeUnit);
    for (const cd of names) if (!index.skills.has(cd)) refuse(`--only ${cd}: benchmarks.json has no skills row for it`);
  } else {
    // A whole import: every skills row has a card, and every card a skills row (AC-2).
    let entries;
    try { entries = fs.readdirSync(path.join(dir, 'skills'), { withFileTypes: true }); } catch (_e) { refuse('skills/: no such folder in the checkout'); }
    const cards = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) refuse(`skills/${e.name} is a symbolic link; links are not followed`);
      if (!e.isDirectory()) continue;
      let st = null;
      try { st = fs.lstatSync(path.join(dir, 'skills', e.name, 'BENCHMARK.md')); } catch (_e) { st = null; }
      if (st) cards.push(e.name);
    }
    cards.sort(byCodeUnit);
    const rows = [...index.skills.keys()].sort(byCodeUnit);
    const noCard = rows.filter((cd) => !cards.includes(cd));
    const noRow = cards.filter((cd) => !index.skills.has(cd));
    if (noCard.length || noRow.length) refuse(`the checkout and benchmarks.json disagree: ${noCard.length} skills rows have no card (${noCard.slice(0, 3).join(', ')}), and ${noRow.length} cards have no skills row (${noRow.slice(0, 3).join(', ')})`);
    names = rows;
  }

  const benchBlob = blobSha1(benchBytes);
  const receipts = [];
  const report = {
    repo: REPO,
    commit,
    benchmarks_sha256: sha256(benchBytes),
    skills_read: 0,
    skills_with_results: 0,
    skills_without_results: [],
    pairs_with_results: 0,
    receipts_written: 0,
    pairs_without_results: [],
    receipts_by_model: {},
    receipts_unit_unstated: 0,
    economics_unknown: [],
  };
  const names_ = new Map();
  for (const cd of names) {
    const rel = `skills/${cd}/BENCHMARK.md`;
    const cardBytes = readSource(dir, rel, MAX_CARD_BYTES, '1 MiB', tree, commit);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(cardBytes); } catch (_e) { refuse(`${rel} is not UTF-8`); }
    if (text.includes('\r')) refuse(`${rel} holds a carriage return: only cards with line feeds are read`);
    const card = parseCard(cd, text);
    const results = index.results.get(cd) || [];
    report.skills_read++;
    if (results.length) report.skills_with_results++; else report.skills_without_results.push(cd);
    const got = cardReceipts({ cd, card, row: index.skills.get(cd), results, cardBytes, benchBytes, cardBlob: blobSha1(cardBytes), benchBlob, commit, importedAt });
    for (const x of got.receipts) sealReceipt(x.receipt);
    report.pairs_without_results.push(...got.without);
    for (const x of got.receipts) {
      // Two receipts of one import never share a file (AC-28).
      if (names_.has(x.name)) refuse(`two receipts of this import would share the file name ${x.name}.json (${names_.get(x.name)} and ${cd} ${x.agent}): the cards are the same bytes`);
      names_.set(x.name, `${cd} ${x.agent}`);
      report.pairs_with_results++;
      report.receipts_written++;
      const id = x.receipt.run.model_id;
      report.receipts_by_model[id] = (report.receipts_by_model[id] || 0) + 1;
      if (x.unstated) report.receipts_unit_unstated++;
      if (!x.economics) report.economics_unknown.push({ skill: cd, agent: x.agent });
      receipts.push({ skill: x.skill, agent: x.agent, receipt: x.receipt, name: x.name });
    }
  }
  return { receipts, report };
}


module.exports = { importNvidiaCards, NVIDIA_TOOLS, NvidiaRefused };
