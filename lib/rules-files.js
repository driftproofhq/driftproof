// SPDX-License-Identifier: Apache-2.0
'use strict';

const path = require('node:path');
const fs = require('node:fs');
// This is the one kind list. action/lib.sh reads the literal pattern rows without
// starting Node. Keep patterns valid in both JavaScript and Bash extended regex.
const RULES_FILE_KINDS = Object.freeze([
  { kind: 'claude', pattern: '(^|/)CLAUDE[.]md$', directory: '', example: 'CLAUDE.md', metadata: false },
  { kind: 'agents', pattern: '(^|/)AGENTS[.]md$', directory: '', example: 'AGENTS.md', metadata: false },
  { kind: 'cursor', pattern: '(^|/)[.]cursor/rules/[^/]+[.]mdc$', directory: '.cursor/rules', example: '.cursor/rules/*.mdc', metadata: true },
  { kind: 'cursor_legacy', pattern: '(^|/)[.]cursorrules$', directory: '', example: '.cursorrules', metadata: false },
  { kind: 'copilot', pattern: '(^|/)[.]github/copilot-instructions[.]md$', directory: '.github', example: '.github/copilot-instructions.md', metadata: false },
  { kind: 'copilot_scoped', pattern: '(^|/)[.]github/instructions/[^/]+[.]instructions[.]md$', directory: '.github/instructions', example: '.github/instructions/*.instructions.md', metadata: true },
  { kind: 'windsurf_legacy', pattern: '(^|/)[.]windsurfrules$', directory: '', example: '.windsurfrules', metadata: false },
  { kind: 'windsurf', pattern: '(^|/)[.]windsurf/rules/[^/]+[.]md$', directory: '.windsurf/rules', example: '.windsurf/rules/*.md', metadata: true },
  { kind: 'markdown', pattern: '[.][mM][dD]$', directory: null, example: '*.md', metadata: false },
  { kind: 'markdown', pattern: '[.][mM][aA][rR][kK][dD][oO][wW][nN]$', directory: null, example: '*.markdown', metadata: false },
].map(Object.freeze));
const RULES_LIMITATION = "Measured as always-on text. The editor's system prompt and rule selection are not reproduced.";
const RULES_FILE_NAMES = RULES_FILE_KINDS.filter(x => x.kind !== 'markdown').map(x => x.example).join(', ');
function rulesFileKind(file) {
  const name = String(file).split(path.sep).join('/');
  return RULES_FILE_KINDS.find(x => new RegExp(x.pattern).test(name)) || null;
}
function isRulesFile(file) { const kind = rulesFileKind(file); return !!kind && kind.kind !== 'markdown'; }
function isContextFile(file) { return rulesFileKind(file) !== null; }
function rulesFileText(file, sourceText) {
  const kind = rulesFileKind(file);
  if (!kind) throw Object.assign(new Error('Not a supported rules or Markdown file'), { code: 'SUBJECT_TYPE' });
  let text = sourceText;
  if (kind.metadata && /^\ufeff?---[ \t]*\r?\n/.test(text)) {
    const block = /^\ufeff?---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m.exec(text);
    if (!block) throw Object.assign(new Error('The rules file has an unclosed metadata block; close it before measuring'), { code: 'SUBJECT_METADATA' });
    text = text.slice(block[0].length);
  }
  return { kind: kind.kind, text, mode: 'always_on', limitation: RULES_LIMITATION };
}
// Every runner entry checks the same snapshot that will be sealed.
function assertRulesSubject(subject) {
  if (subject.unit !== 'context_file') return;
  const source = subject.sourceText;
  const expected = typeof source === 'string' ? rulesFileText(subject.file || subject.name, source) : null;
  if (!expected || !require('node:util').isDeepStrictEqual(expected, subject.rulesFile)
    || expected.text !== subject.skillMd || require('node:crypto').createHash('sha256').update(source).digest('hex') !== subject.contentHash)
    throw Object.assign(new Error('The rules file snapshot differs from the text or hash to be sent; load the file again'), { code: 'SUBJECT_SNAPSHOT' });
}
// Preserve the identifying suffix when copying a file into private scratch.
function rulesFileCopyPath(file) {
  const kind = rulesFileKind(file);
  return path.join(kind?.directory || '', path.basename(file));
}
function discoverRulesFiles(root) {
  const found = new Set();
  for (const directory of new Set(RULES_FILE_KINDS.filter(x => x.directory !== null).map(x => x.directory))) {
    let cur = root, linked = false;
    for (const part of directory.split('/').filter(Boolean)) {
      cur = path.join(cur, part);
      try { if (!fs.lstatSync(cur).isDirectory()) linked = true; } catch { linked = true; }
    }
    if (linked) continue;
    let entries; try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const rel = path.join(directory, entry.name);
      if (entry.isFile() && isRulesFile(rel)) found.add(rel);
    }
  }
  return [...found].sort();
}
module.exports = { assertRulesSubject, RULES_FILE_KINDS, RULES_FILE_NAMES, RULES_LIMITATION, rulesFileKind, isRulesFile, isContextFile, rulesFileText, rulesFileCopyPath, discoverRulesFiles };
