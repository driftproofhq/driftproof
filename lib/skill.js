// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Files, sha256Canonical } = require('./canonical');
const { SUITE_FORMAT, SKILL_MAX_FILES, SKILL_MAX_BYTES, SKILL_MAX_DEPTH, SUITE_MAX_CASES, CASE_MAX_CHARS } = require('../config');

// A bound was exceeded: the error names the bound and the value (spec 026
// AC-13), so the refusal says what to change rather than that something is
// too big.
function pastBound(bound, limit, value, what) {
  const e = new Error(`${what}: ${value} exceeds ${bound} (${limit}); refusing to load`);
  e.code = 'INPUT_BOUND'; e.bound = bound; e.limit = limit; e.value = value;
  return e;
}

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

// Bounded (spec 026 AC-13): the walk stops at SKILL_MAX_DEPTH directories
// below the skill dir, SKILL_MAX_FILES bundled files, and SKILL_MAX_BYTES of
// them together, and throws naming the bound the moment one is passed, so a
// pathological tree is refused before its bytes are read into memory.
function walkFiles(dir, base = dir, acc = [], state = { bytes: 0 }, depth = 0) {
  if (depth > SKILL_MAX_DEPTH) throw pastBound('SKILL_MAX_DEPTH', SKILL_MAX_DEPTH, depth, `directory depth under ${base}`);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walkFiles(path.join(dir, entry.name), base, acc, state, depth + 1);
    } else if (entry.isFile() && !IGNORE_FILES.has(entry.name)) {
      const abs = path.join(dir, entry.name);
      if (acc.length + 1 > SKILL_MAX_FILES) throw pastBound('SKILL_MAX_FILES', SKILL_MAX_FILES, acc.length + 1, `bundled files under ${base}`);
      const size = fs.statSync(abs).size;
      state.bytes += size;
      if (state.bytes > SKILL_MAX_BYTES) throw pastBound('SKILL_MAX_BYTES', SKILL_MAX_BYTES, state.bytes, `bundled bytes under ${base}`);
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
  const { cases, suiteHash } = suiteIdentity(suiteRaw);

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

// A suite's normalised cases and its hash, as a receipt records them. suite_hash
// is over the CORE case fields only ({id, prompt, rubric, pass_threshold});
// optional annotations (checks, and the claim/grounding the gate reads straight
// from the raw suite) are excluded so adding them never disturbs a receipt's
// suite_hash. See spec/RECEIPT.md § suite. Exported for `driftproof stale
// --suite` (spec 053), so a suite file is hashed by the same code as a run.
function suiteIdentity(suiteRaw) {
  const cases = normalizeCases(suiteRaw);
  const suiteHash = sha256Canonical(cases.map((c) => ({
    id: c.id, prompt: c.prompt, rubric: c.rubric, pass_threshold: c.pass_threshold,
  })));
  return { cases, suiteHash };
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
  // Bounded (spec 026 AC-13): the case count, and each prompt and rubric.
  if (list.length > SUITE_MAX_CASES) throw pastBound('SUITE_MAX_CASES', SUITE_MAX_CASES, list.length, 'cases in the suite');
  // Spec 050 AC-1: normalized ids are unique. The receipt and every reader of it key a
  // case by this string, so two cases that share it are measured, paid for, and then
  // one is silently dropped from the verdict. Refused here, before any call. The
  // comparison is on the id as assigned, including a `case-<n>` given to an unnamed
  // case, which an explicit id can collide with.
  const firstAt = new Map();
  return list.map((c, i) => {
    const id = String(c.id || c.name || `case-${i + 1}`);
    if (firstAt.has(id)) {
      throw Object.assign(new Error(`case ids must be unique: cases ${firstAt.get(id)} and ${i + 1} both have the id ${JSON.stringify(id)}; rename one and run again`), { code: 'DUPLICATE_CASE_ID' });
    }
    firstAt.set(id, i + 1);
    const prompt = c.prompt || c.input || c.task;
    const rubric = c.rubric || c.criteria || c.expected;
    if (!prompt) throw new Error(`case "${id}" is missing a prompt/input/task`);
    if (!rubric) throw new Error(`case "${id}" is missing a rubric/criteria/expected`);
    if (String(prompt).length > CASE_MAX_CHARS) throw pastBound('CASE_MAX_CHARS', CASE_MAX_CHARS, String(prompt).length, `case "${id}" prompt characters`);
    if (String(rubric).length > CASE_MAX_CHARS) throw pastBound('CASE_MAX_CHARS', CASE_MAX_CHARS, String(rubric).length, `case "${id}" rubric characters`);
    const threshold = typeof c.pass_threshold === 'number' ? c.pass_threshold
      : typeof c.threshold === 'number' ? c.threshold : 0.7;
    const norm = { id, prompt: String(prompt), rubric: String(rubric), pass_threshold: threshold };
    // Optional deterministic post-checks (v0.3.1). Carried through for the runner
    // but EXCLUDED from suite_hash (see loadSkill) so they never disturb a receipt.
    if (Array.isArray(c.checks) && c.checks.length) norm.checks = c.checks;
    return norm;
  });
}

module.exports = { loadSkill, normalizeCases, parseSkillMeta, pastBound, suiteIdentity };
