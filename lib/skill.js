// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Files, sha256Canonical } = require('./canonical');
const { SUITE_FORMAT, SKILL_MAX_FILES, SKILL_MAX_BYTES, SKILL_MAX_DEPTH, SUITE_MAX_CASES, CASE_MAX_CHARS } = require('../config');

// Spec 165: the longest `origin` label a case may carry. A longer one is not carried.
const ORIGIN_MAX = 200;
// Spec 185 (R-1): the most criteria a case may list.
const CRITERIA_MAX = 50;

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

// Spec 062 (register row 5): A LINK IS REFUSED WHERE THE SKILL IS READ. Until this SKILL.md was
// read through a link, so a skill directory could make any file the operator can read into the
// system prompt, while the walk skipped links and content_hash covered none of the bytes used
// (the SHA-256 of empty input, unchanged when the target changed). A link is neither followed nor
// skipped: the skill is refused, naming it. The skill directory itself may be reached by a link;
// what is under it may not.
function linkRefusal(rel, base) {
  const e = new Error(`${rel} under ${base} is a symbolic link; a skill is read only from its own directory, so a link is refused rather than followed or skipped`);
  e.code = 'SKILL_LINK'; e.path = rel;
  return e;
}
// Every component from the skill directory down to `rel` is a plain entry, not a link. An absent
// component is left to the caller, whose own message names what is missing.
function assertNoLink(dir, rel) {
  let cur = dir;
  for (const part of rel.split('/')) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch (_e) { return; }
    if (st.isSymbolicLink()) throw linkRefusal(path.relative(dir, cur), dir);
  }
}

// Bounded (spec 026 AC-13): the walk stops at SKILL_MAX_DEPTH directories
// below the skill dir, SKILL_MAX_FILES bundled files, and SKILL_MAX_BYTES of
// them together, and throws naming the bound the moment one is passed, so a
// pathological tree is refused before its bytes are read into memory.
//
// `read` maps a path relative to the skill dir to bytes the caller has already read, so the hash
// covers those bytes and not a second read of the same path (spec 062: SKILL.md).
function walkFiles(dir, base = dir, acc = [], state = { bytes: 0 }, depth = 0, read = {}) {
  if (depth > SKILL_MAX_DEPTH) throw pastBound('SKILL_MAX_DEPTH', SKILL_MAX_DEPTH, depth, `directory depth under ${base}`);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      // A link under an ignored name is never read, so it is left as the name is; `evals` is
      // checked where the suite is read.
      if (IGNORE_DIRS.has(entry.name) || IGNORE_FILES.has(entry.name)) continue;
      throw linkRefusal(path.relative(base, path.join(dir, entry.name)), base);
    }
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walkFiles(path.join(dir, entry.name), base, acc, state, depth + 1, read);
    } else if (entry.isFile() && !IGNORE_FILES.has(entry.name)) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(base, abs);
      if (acc.length + 1 > SKILL_MAX_FILES) throw pastBound('SKILL_MAX_FILES', SKILL_MAX_FILES, acc.length + 1, `bundled files under ${base}`);
      const given = Object.hasOwn(read, rel) ? read[rel] : null;
      const size = given ? given.length : fs.statSync(abs).size;
      state.bytes += size;
      if (state.bytes > SKILL_MAX_BYTES) throw pastBound('SKILL_MAX_BYTES', SKILL_MAX_BYTES, state.bytes, `bundled bytes under ${base}`);
      acc.push({ path: rel, bytes: given || fs.readFileSync(abs) });
    }
  }
  return acc;
}

function loadSkill(skillDir) {
  const dir = path.resolve(skillDir);
  const skillMdPath = path.join(dir, 'SKILL.md');
  assertNoLink(dir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`no SKILL.md found in ${dir}`);
  }
  const skillMdBytes = fs.readFileSync(skillMdPath);
  const skillMd = skillMdBytes.toString('utf8');

  // Content hash over SKILL.md + every bundled file (evals/ excluded — the suite
  // is hashed separately so a suite edit doesn't masquerade as a skill change).
  // SKILL.md enters it as the bytes read above, the bytes the run is given.
  const files = walkFiles(dir, dir, [], { bytes: 0 }, 0, { 'SKILL.md': skillMdBytes });
  const contentHash = sha256Files(files);

  // Parse skill name/version from front-matter or the first H1; fall back to dir.
  const meta = parseSkillMeta(skillMd);
  const name = meta.name || path.basename(dir);
  const version = meta.version || '0.0.0';

  // Load the eval suite.
  const suitePath = path.join(dir, 'evals', 'evals.json');
  assertNoLink(dir, 'evals/evals.json');
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
// Spec 185 (R-7): a case's criteria grade it, so they are core and enter the hash; a case without
// criteria is hashed as before.
function suiteIdentity(suiteRaw) {
  const cases = normalizeCases(suiteRaw);
  const suiteHash = sha256Canonical(cases.map((c) => ({
    id: c.id, prompt: c.prompt, rubric: c.rubric, pass_threshold: c.pass_threshold,
    ...(c.criteria ? { criteria: c.criteria } : {}),
  })));
  return { cases, suiteHash };
}

// Pull name/version from a YAML-ish front-matter block, else from the H1 line.
//
// Spec 172 (M-4): the key pattern carries a hyphen, so a front-matter key such as `allowed-tools`
// (the agentskills.io key naming the tools a skill is written to use) is read rather than skipped;
// the guided drafting steps read it from here, so a run cannot meet a tool a skill needs is said
// from the file and not from a free reading of it.
function parseSkillMeta(md) {
  const meta = {};
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/);
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
// to { id, prompt, rubric, pass_threshold }, with `criteria` when the case lists
// them (spec 185). `cases` may live at the top level or under a `cases`/`evals` key.
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
    // Spec 185 (R-1): a list under `criteria` with an object in it is the case's criteria, and the case
    // needs no rubric. A-185-2: anything else there (a string, an empty list, a list of strings) takes
    // the path it took before spec 185, the same rubric text and the same hashes; criteriaOf refuses a
    // list that mixes objects with other entries.
    const listed = listsCriteria(c);
    const rubric = listed ? (c.rubric || c.expected || '') : (c.rubric || c.criteria || c.expected);
    if (!prompt) throw new Error(`case "${id}" is missing a prompt/input/task`);
    if (!rubric && !listed) throw new Error(`case "${id}" is missing a rubric/criteria/expected`);
    if (String(prompt).length > CASE_MAX_CHARS) throw pastBound('CASE_MAX_CHARS', CASE_MAX_CHARS, String(prompt).length, `case "${id}" prompt characters`);
    if (String(rubric).length > CASE_MAX_CHARS) throw pastBound('CASE_MAX_CHARS', CASE_MAX_CHARS, String(rubric).length, `case "${id}" rubric characters`);
    const threshold = typeof c.pass_threshold === 'number' ? c.pass_threshold
      : typeof c.threshold === 'number' ? c.threshold : 0.7;
    const norm = { id, prompt: String(prompt), rubric: String(rubric), pass_threshold: threshold };
    if (listed) norm.criteria = criteriaOf(c.criteria, id);
    // Optional deterministic post-checks (v0.3.1). Carried through for the runner
    // but EXCLUDED from suite_hash (see loadSkill) so they never disturb a receipt.
    if (Array.isArray(c.checks) && c.checks.length) norm.checks = c.checks;
    // Spec 165: where a case came from, in words (`driftproof init --cases FILE --drafted-from-skill`
    // writes it). Carried through and EXCLUDED from suite_hash, as `checks` is, so a label never
    // disturbs a receipt; no receipt records it. Kept only as a short string.
    if (typeof c.origin === 'string' && c.origin.length <= ORIGIN_MAX) norm.origin = c.origin;
    return norm;
  });
}

// Spec 185 (R-1): a case's criteria, each { id, weight, description } and nothing else, or a refusal
// naming the case and the entry, before any call. Ids are unique and match CRITERION_ID (A-185-4: an
// id is printed into the judge prompt as a line of its own, so it carries no newline and no length that
// could forge one), weights are finite numbers above 0 whose sum is finite too (A-185-1), descriptions
// are non-empty and bounded as a rubric is.
const CRITERION_ID = /^[A-Za-z0-9_.-]{1,64}$/;
function isEntry(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
// Whether a case as written lists criteria (A-185-2): a `criteria` list with an object in it. The one
// reading of the shape, for the loader and for a rubric regrade's comparison (A-185-8).
function listsCriteria(c) {
  return !!c && Array.isArray(c.criteria) && c.criteria.some(isEntry);
}
function criteriaOf(list, caseId) {
  const refuse = (why) => Object.assign(new Error(`case ${JSON.stringify(caseId)} criteria: ${why}; fix the suite and run again`), { code: 'BAD_CRITERIA' });
  if (list.length > CRITERIA_MAX) throw refuse(`${list.length} criteria exceed the most a case may list (${CRITERIA_MAX})`);
  const seen = new Set();
  const out = list.map((x, i) => {
    const at = `entry ${i + 1}`;
    if (!isEntry(x)) throw refuse(`${at} is not an object, in a list whose other entries are`);
    if (typeof x.id !== 'string' || !x.id) throw refuse(`${at} has no id`);
    if (!CRITERION_ID.test(x.id)) throw refuse(`${at} has the id ${JSON.stringify(x.id.length > 80 ? `${x.id.slice(0, 80)}...` : x.id)}; an id is 1 to 64 of A-Z, a-z, 0-9, underscore, dot and hyphen`);
    if (seen.has(x.id)) throw refuse(`${at} repeats the id ${JSON.stringify(x.id)}`);
    seen.add(x.id);
    if (typeof x.weight !== 'number' || !Number.isFinite(x.weight) || !(x.weight > 0)) throw refuse(`${at} (${JSON.stringify(x.id)}) has weight ${JSON.stringify(x.weight)}; a weight is a number greater than 0`);
    if (typeof x.description !== 'string' || !x.description.trim()) throw refuse(`${at} (${JSON.stringify(x.id)}) has no description`);
    if (x.description.length > CASE_MAX_CHARS) throw pastBound('CASE_MAX_CHARS', CASE_MAX_CHARS, x.description.length, `case "${caseId}" criterion ${JSON.stringify(x.id)} description characters`);
    return { id: x.id, weight: x.weight, description: x.description };
  });
  const sum = out.reduce((a, x) => a + x.weight, 0);
  if (!Number.isFinite(sum)) throw refuse(`the weights sum to ${sum}, past the largest finite number, so no total could be computed`);
  return out;
}

module.exports = { loadSkill, normalizeCases, parseSkillMeta, pastBound, suiteIdentity, criteriaOf, listsCriteria };
