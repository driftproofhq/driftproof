// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { termText, invisibleShown } = require('./names');
const { estimateTokens } = require('./skillCost');
const { priceFor } = require('./cost');
const { loadRegistry } = require('./models');
const { SKILL_MAX_FILES, SKILL_MAX_BYTES, SKILL_MAX_DEPTH } = require('../config');
const { scanInspect, inspectVisible, inspectBound, inspectRefusal, INSPECT_LIMITS, INSPECT_CLOSING, INSPECT_REFUSALS } = require('./import-core/inspect.cjs');

const HELP = 'usage: driftproof inspect <file.md | skill-dir | -> [--json]\n' +
  'Read local instructions before installing them. Offline text findings are places to look.\n' +
  'Input text only: token and input cost estimates for 1,000 calls, using registered prices.\n' +
  'Skill directories list bundled file names and sizes; only SKILL.md is scanned.\n' +
  'Text limit: 2 MiB. Findings exit 0; invalid or over-bound input exits 2, with no report.\n' + INSPECT_CLOSING;
const localOnly = 'The command reads local files and stdin.';
function limit(name, n, max) {
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw inspectRefusal(name);
}
function identity(a, b) { return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode; }
function regular(st) { if (!st.isFile()) throw inspectRefusal('INSPECT_REGULAR_FILE'); }
function decode(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw inspectRefusal('INSPECT_UTF8'); }
}
function readChunks(fd, expected) {
  const chunks = [], buffer = Buffer.alloc(65536);
  let total = 0;
  while (true) {
    const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, INSPECT_LIMITS.INSPECT_MAX_BYTES + 1 - total), null);
    if (!n) break;
    total += n;
    if (!expected && total > INSPECT_LIMITS.INSPECT_MAX_BYTES) {
      // Retain no excess input. Discard at most another input limit so a finite
      // pipe producer can finish and read exit 2 instead of receiving EPIPE.
      let discarded = 0;
      while (discarded < INSPECT_LIMITS.INSPECT_MAX_BYTES) {
        const extra = fs.readSync(fd, buffer, 0, Math.min(buffer.length, INSPECT_LIMITS.INSPECT_MAX_BYTES - discarded), null);
        if (!extra) break;
        discarded += extra;
      }
    }
    inspectBound('INSPECT_MAX_BYTES', total);
    if (expected && total > expected.size) throw inspectRefusal('INSPECT_INPUT_CHANGED');
    // Check the bound before retaining a chunk, including the first excess byte.
    chunks.push(Buffer.from(buffer.subarray(0, n)));
  }
  if (expected) {
    const after = fs.fstatSync(fd);
    if (total !== expected.size || !identity(after, expected) || after.size !== expected.size || after.mtimeMs !== expected.mtimeMs || after.ctimeMs !== expected.ctimeMs) throw inspectRefusal('INSPECT_INPUT_CHANGED');
  }
  return decode(Buffer.concat(chunks, total));
}
function readFile(file) {
  const before = fs.lstatSync(file); regular(before);
  inspectBound('INSPECT_MAX_BYTES', before.size);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const actual = fs.fstatSync(fd); regular(actual);
    inspectBound('INSPECT_MAX_BYTES', actual.size);
    if (!identity(actual, before) || actual.size !== before.size) throw inspectRefusal('INSPECT_INPUT_CHANGED');
    return readChunks(fd, actual);
  } finally { fs.closeSync(fd); }
}
function readDirectory(dir) {
  const files = [], directories = [], entriesSeen = { count: 0, bytes: 0 };
  // Same ignored names as loadSkill. Nothing in these directories is claimed
  // as scanned. No eval suite is needed for this text-only reading.
  const ignoredDirs = new Set(['.git', 'node_modules', 'evals']);
  function unchanged() {
    for (const d of directories) {
      const st = fs.lstatSync(d.file);
      if (!st.isDirectory() || !identity(st, d.st) || st.mtimeMs !== d.st.mtimeMs || st.ctimeMs !== d.st.ctimeMs) throw inspectRefusal('INSPECT_INPUT_CHANGED');
    }
  }
  function walk(at, relative, depth) {
    limit('SKILL_MAX_DEPTH', depth, SKILL_MAX_DEPTH);
    const st = fs.lstatSync(at);
    if (!st.isDirectory()) throw inspectRefusal('INSPECT_DIRECTORY_LINK');
    directories.push({ file: at, st });
    const handle = fs.opendirSync(at);
    try {
      let entry;
      while ((entry = handle.readSync())) {
        inspectBound('INSPECT_DIRECTORY_ENTRIES', ++entriesSeen.count);
        if (entry.name === '.DS_Store' || ignoredDirs.has(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) continue;
        const file = path.join(at, entry.name), name = relative ? relative + '/' + entry.name : entry.name;
        const child = fs.lstatSync(file);
        if (child.isSymbolicLink()) throw inspectRefusal('INSPECT_DIRECTORY_LINK');
        if (child.isDirectory()) walk(file, name, depth + 1);
        else {
          regular(child);
          limit('SKILL_MAX_FILES', files.length + 1, SKILL_MAX_FILES);
          entriesSeen.bytes += child.size;
          limit('SKILL_MAX_BYTES', entriesSeen.bytes, SKILL_MAX_BYTES);
          files.push({ name, bytes: child.size, st: child });
        }
      }
    } finally { handle.closeSync(); }
    const after = fs.lstatSync(at);
    if (!after.isDirectory() || !identity(st, after) || st.mtimeMs !== after.mtimeMs || st.ctimeMs !== after.ctimeMs) throw inspectRefusal('INSPECT_INPUT_CHANGED');
  }
  walk(dir, '', 0);
  const skill = files.find(f => f.name === 'SKILL.md');
  if (!skill) throw inspectRefusal('INSPECT_SKILL_MD');
  unchanged();
  const text = readFile(path.join(dir, 'SKILL.md'));
  unchanged();
  // Refuse changes between discovery and reading. Bundled bytes are never opened.
  for (const f of files) {
    const st = fs.lstatSync(path.join(dir, f.name));
    if (!identity(st, f.st) || st.size !== f.bytes || st.mtimeMs !== f.st.mtimeMs || st.ctimeMs !== f.st.ctimeMs) throw inspectRefusal('INSPECT_INPUT_CHANGED');
  }
  files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { text, files: files.map(({ name, bytes }) => ({ name, bytes })) };
}
// A-724-8: the folder itself may be reached by a link, as run reads it. Resolve it once; the
// walk's lstat rules then refuse any link below it. A link to anything else is not a folder.
function linkedFolder(at, st) {
  if (!st.isSymbolicLink()) return null;
  try { const real = fs.realpathSync(at); return fs.lstatSync(real).isDirectory() ? real : null; }
  catch { return null; }
}
function inspectInput(operand) {
  if (typeof operand !== 'string' || !operand) throw inspectRefusal('INSPECT_OPERAND');
  if (/^[a-z][a-z0-9+.-]{1,31}:\/\//i.test(operand) || /^git@/i.test(operand)) throw new Error(localOnly);
  let input;
  if (operand === '-') input = { text: readChunks(0), files: [] };
  else {
    const at = path.resolve(operand), st = fs.lstatSync(at);
    const folder = st.isDirectory() ? at : linkedFolder(at, st);
    if (folder) input = readDirectory(folder);
    else {
      regular(st);
      if (!/\.md$/i.test(at)) throw inspectRefusal('INSPECT_MARKDOWN_FILE');
      input = { text: readFile(at), files: [] };
    }
  }
  const prices = loadRegistry().models.map(m => ({ model: m.id, input: priceFor(m.id).input }));
  const report = scanInspect(input.text, { files: input.files, prices });
  // Do not quietly disagree with the runner's token proxy if that changes later.
  if (report.stats.estimatedTokens !== estimateTokens(input.text)) throw inspectRefusal('INSPECT_TOKEN_ESTIMATE');
  return report;
}
// The scanner has already made every report string visible and doubled typed
// backslashes. termText would double each generated escape again (A-724-1), so
// this last pass only guards against a raw invisible character reaching the terminal.
function terminal(value) {
  if (typeof value === 'string') return invisibleShown(value);
  if (Array.isArray(value)) return value.map(terminal);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, terminal(v)]));
  return value;
}
function renderInspect(report, json = false) {
  const shown = terminal(report);
  let text;
  if (json) text = JSON.stringify(shown, null, 2);
  else {
    const s = shown.stats;
    const lines = ['Places to look in the supplied text.',
      `Input text only, estimate: ${s.lines} lines, ${s.bytes} bytes, ${s.estimatedTokens} tokens.`];
    for (const c of shown.costs) lines.push(`${c.model}: USD ${c.usdShown} per 1,000 calls (estimate, input text only).`);
    if (shown.files.length) {
      lines.push('Bundled file list, names and byte sizes only; contents were not scanned:');
      for (const f of shown.files) lines.push(`  ${f.name}: ${f.bytes} bytes`);
    }
    for (const f of shown.findings) lines.push(`Line ${f.line}, ${f.class}: ${f.message}${f.host ? ' Host: ' + f.host + '.' : ''}\n  ${f.excerpt}`);
    if (!shown.findings.length) lines.push('These fixed text patterns found nothing to point out.');
    lines.push(INSPECT_CLOSING);
    text = lines.join('\n');
  }
  inspectBound('INSPECT_OUTPUT', Buffer.byteLength(text) + 1);
  return text;
}
function inspectDiagnostic(error) {
  // Filesystem errors can carry absolute paths or input bytes. Emit only a
  // known error code, never their message. Each code has one plain sentence (A-724-7).
  const code = typeof error.code === 'string' && /^(?:INSPECT_|SKILL_MAX_)[A-Z0-9_]+$/.test(error.code) ? error.code : 'INSPECT_INPUT';
  const message = error.message === localOnly ? localOnly : (INSPECT_REFUSALS[code] || INSPECT_REFUSALS.INSPECT_INPUT) + ' (' + code + ')';
  return termText(inspectVisible(message));
}
function cmdInspect(args) {
  try {
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(HELP); return; }
    const operands = []; let json = false, endOptions = false;
    for (const arg of args) {
      if (!endOptions && arg === '--') { endOptions = true; continue; }
      if (!endOptions && arg === '--json' && !json) { json = true; continue; }
      if (!endOptions && arg !== '-' && arg.startsWith('-')) throw inspectRefusal('INSPECT_ARGUMENT');
      operands.push(arg);
    }
    if (operands.length !== 1) throw inspectRefusal('INSPECT_ARGUMENT');
    console.log(renderInspect(inspectInput(operands[0]), json));
  } catch (e) {
    console.error(e.code === 'INSPECT_ARGUMENT' ? 'usage: driftproof inspect <file.md | skill-dir | -> [--json]; invalid argument.' : inspectDiagnostic(e));
    process.exitCode = 2;
  }
}
module.exports = { cmdInspect, inspectInput, renderInspect, inspectDiagnostic };
