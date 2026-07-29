// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Files, sha256Canonical } = require('./canonical');
const { SUITE_FORMAT } = require('../config');

// Load a skill directory and its eval suite.
//
// Expected layout (agentskills.io style):
//   <skill-dir>/SKILL.md              — the skill instructions (required)
//   <skill-dir>/evals/evals.json      — the eval suite (required)
//   <skill-dir>/**                    — any other bundled files contribute to
//                                       the content hash (references, scripts…)
//
// content_hash = sha256 over { SKILL.md, ...bundled files } in canonical (path-
// sorted) order, so the same skill on any machine yields the same hash and any
// edit to any bundled file changes it.

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'evals']);
const IGNORE_FILES = new Set(['.DS_Store']);

function walkFiles(dir, base = dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walkFiles(path.join(dir, entry.name), base, acc);
    } else if (entry.isFile() && !IGNORE_FILES.has(entry.name)) {
      const abs = path.join(dir, entry.name);
      acc.push({ path: path.relative(base, abs), bytes: fs.readFileSync(abs) });
    }
  }
  return acc;
}

function loadSkill(skillDir) {
  const dir = path.resolve(skillDir);
  const skillMdPath = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`no SKILL.md found in ${dir}`);
  }
  const skillMd = fs.readFileSync(skillMdPath, 'utf8');

  // Content hash over SKILL.md + every bundled file (evals/ excluded — the suite
  // is hashed separately so a suite edit doesn't masquerade as a skill change).
  const files = walkFiles(dir);
  const contentHash = sha256Files(files);

  // Parse skill name/version from front-matter or the first H1; fall back to dir.
  const meta = parseSkillMeta(skillMd);
  const name = meta.name || path.basename(dir);
  const version = meta.version || '0.0.0';

  // Load the eval suite.
  const suitePath = path.join(dir, 'evals', 'evals.json');
  if (!fs.existsSync(suitePath)) {
    throw new Error(`no evals/evals.json found in ${dir}`);
  }
  const suiteRaw = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
  const cases = normalizeCases(suiteRaw);
  const suiteHash = sha256Canonical(cases);

  return {
    dir,
    name,
    version,
    skillMd,
    contentHash,
    suite: {
      format: SUITE_FORMAT,
      suiteHash,
      caseCount: cases.length,
      cases,
    },
  };
}

// Pull name/version from a YAML-ish front-matter block, else from the H1 line.
function parseSkillMeta(md) {
  const meta = {};
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^\s*([A-Za-z_]+)\s*:\s*(.+?)\s*$/);
      if (m) meta[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  if (!meta.name) {
    const h1 = md.match(/^#\s+(.+)$/m);
    if (h1) meta.name = h1[1].trim();
  }
  return meta;
}

// Accept a few shapes of the agentskills.io eval suite and normalize each case
// to { id, prompt, rubric, pass_threshold }. `cases` may live at the top level
// or under a `cases`/`evals` key.
function normalizeCases(raw) {
  const list = Array.isArray(raw) ? raw
    : Array.isArray(raw.cases) ? raw.cases
      : Array.isArray(raw.evals) ? raw.evals
        : null;
  if (!list) throw new Error('evals.json must be an array or have a `cases`/`evals` array');
  return list.map((c, i) => {
    const id = String(c.id || c.name || `case-${i + 1}`);
    const prompt = c.prompt || c.input || c.task;
    const rubric = c.rubric || c.criteria || c.expected;
    if (!prompt) throw new Error(`case "${id}" is missing a prompt/input/task`);
    if (!rubric) throw new Error(`case "${id}" is missing a rubric/criteria/expected`);
    const threshold = typeof c.pass_threshold === 'number' ? c.pass_threshold
      : typeof c.threshold === 'number' ? c.threshold : 0.7;
    return { id, prompt: String(prompt), rubric: String(rubric), pass_threshold: threshold };
  });
}

module.exports = { loadSkill, normalizeCases, parseSkillMeta };
