// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { sealReceipt } = require('./receipt');
const { inferProvider } = require('./provider');
const { registryStatus } = require('./models');
const sha256 = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
const { readImportBytes } = require('./importers');
const { createAnthropicCore, ANTHROPIC_TOOLS, DOCUMENT_NAME, ImportRefused } = require('./import-core/anthropic.cjs');
const refuse = msg => { throw new ImportRefused(msg); };
const core = createAnthropicCore({ ...config, inferProvider, registryStatus, sha256 });
// Spec 049 NFR-3, A-049-19 (issue 637): the core reads a home directory by its usual roots (/home,
// /Users, /root and their mounts). The importing account's own home is read here as it is, wherever
// it sits: a service account's home under /var/lib is a home directory too. The browser has none.
const { namesAccountHome } = require('./account-home');
function findDocument(p, from) {
  const name = DOCUMENT_NAME[from];
  if (!name) refuse(`unknown import source "${from}"`);
  let st;
  try { st = fs.statSync(p); } catch (_e) { refuse(`no such file or directory: ${p}`); }
  if (st.isFile()) return p;
  const found = [];
  let visited = 0;
  const walk = (d, depth = 0) => {
    if (depth > 16) refuse('import directory depth limit exceeded');
    const entries = [];
    const directory = fs.opendirSync(d);
    try {
      let entry;
      while ((entry = directory.readSync()) !== null) {
        if (++visited > 10000) refuse('import directory entry limit exceeded');
        entries.push(entry);
      }
    } finally { directory.closeSync(); }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(f, depth + 1);
      else if (e.isFile() && e.name === name) found.push(f);
    }
  };
  walk(p);
  if (found.length === 1) return found[0];
  if (!found.length) refuse(`no ${name} under ${p}: --from ${from} imports one ${name}`);
  refuse(`${found.length} files named ${name} under ${p}; import one at a time:\n  ${found.map((f) => path.relative(p, f)).join('\n  ')}`);
}

function dateFromDirName(file) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/.exec(path.basename(path.dirname(file)));
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[5] ? `.${m[5]}` : ''}Z` : null;
}

function importAnthropic(p, { from, importedAt, countErroredRuns = false } = {}) {
  if (!ANTHROPIC_TOOLS.includes(from)) refuse('unknown import source "' + from + '"');
  try {
    const file = findDocument(p, from);
    const bytes = readImportBytes(file);
    // Main-document refusal precedes any companion read, as before.
    const complete = core.prepare(bytes, { from, importedAt, countErroredRuns, directoryDate: dateFromDirName(file) });
    const result = path.join(path.dirname(file), 'result.json');
    const resultBytes = from === 'skill-creator' && fs.existsSync(result) ? readImportBytes(result) : null;
    const receipt = complete(resultBytes);
    if (namesAccountHome(JSON.stringify(receipt))) refuse('the receipt would carry a home-directory path copied from the source; nothing is written (spec 049 NFR-3)');
    return { receipt: sealReceipt(receipt), file };
  } catch (e) { if (e instanceof ImportRefused) throw e; refuse(e.message); }
}
module.exports = { importAnthropic, findDocument, ANTHROPIC_TOOLS, DOCUMENT_NAME, ImportRefused };
