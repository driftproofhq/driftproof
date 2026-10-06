// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('fs');
const path = require('path');
const { parseSkillMeta, normalizeCases } = require('./skill');

// `driftproof init <dir>` scaffolding.
//
// Produces a complete, runnable skill skeleton the way agentskills.io expects it:
//   <dir>/SKILL.md            — the skill instructions (a stub, if none exists)
//   <dir>/evals/evals.json    — an eval suite with 3 example cases, each rubric
//                               anchored at 0.80 (the scoring convention the
//                               example suite and Report #001 use)
//   <dir>/.driftproofrc       - per-project run defaults (budget, models). No samples,
//                               max_cases or judge_model: a skill directory's rc may not
//                               set them, and `run` ignores them there (spec 062).
//
// NEVER overwrites an existing file — every write is guarded, and an existing
// path is reported as "skipped". Safe to re-run. On a folder that holds a SKILL.md only the
// suite is added (spec 139).
//
// Spec 139 (R-6, R-13): on a folder that already holds a SKILL.md it adds the suite, one new file,
// and nothing else: no rc written, though an rc already there is reported skipped like any file left
// as it was, and it never opens SKILL.md for writing (the operator's ruling on the guided run's
// write, 2 Oct 2026). Each write is exclusive (`wx`), so a name already taken, a link
// included, dangling or not, is left as it is and reported skipped: `fs.existsSync` follows a link,
// so a dangling SKILL.md read as absent and the write went through it. The suite takes the name
// SKILL.md gives. `cases`, when given, is the suite's cases instead of the three examples, read by
// the suite loader's own rules (lib/skill.js normalizeCases); the caller refuses it when a suite
// already exists, because it would be dropped.

// JSON carries no comments, so guidance rides in `_`-prefixed keys. The runner's
// suite loader (lib/skill.js normalizeCases) reads only id/prompt/rubric/
// pass_threshold and ignores everything else, so these keys are inert at run time
// and exist purely to guide the author editing the file.
function evalsTemplate(skillName) {
  return {
    skill: skillName,
    version: '0.1.0',
    format: 'agentskills.io/evals',
    _guidance: [
      'Each case must be grounded in a claim your SKILL.md actually makes.',
      'Aim for graded difficulty: a good skill should land with_skill ~0.7-0.9, not 1.0 (saturation hides drift).',
      "Anchor every rubric at 0.80 = 'fully correct'; reserve 0.81-1.00 for exemplary work only, and cap clear errors low.",
      'The baseline is the SAME prompt with no SKILL.md — so a case only measures the skill if the skill is what makes it pass.',
      'See AUTHORING.md (https://driftproofhq.com/authoring.html) for the full fair-suite guide.',
    ],
    cases: [
      {
        id: 'example-core-claim',
        _comment: 'Replace with a case that exercises the MAIN thing your skill teaches. The prompt should be answerable badly without the skill and well with it.',
        prompt: 'Describe the task here — a realistic request a user would make that your skill is meant to help with.',
        rubric: "State exactly what a good response must do, drawn from your SKILL.md. SCORING ANCHOR (apply strictly): a fully correct, idiomatic response scores 0.80; award 0.81-0.90 only if it is ALSO exemplary; 0.91-1.00 only if flawless and exceptional (rare). Subtract ~0.2 for each concrete error the skill is supposed to prevent.",
        pass_threshold: 0.7,
      },
      {
        id: 'example-common-mistake',
        _comment: 'Target a specific mistake your skill is supposed to prevent. The baseline (no skill) should fall into the trap; the skill should avoid it.',
        prompt: 'Describe a task where the obvious answer is wrong in a way your skill corrects.',
        rubric: "Identify the specific correct behaviour your skill mandates here. SCORING ANCHOR (apply strictly): if the response makes the mistake the skill exists to prevent, cap at 0.3; a correct response scores 0.80; 0.81-1.00 only if exemplary. Subtract ~0.2 per additional error.",
        pass_threshold: 0.7,
      },
      {
        id: 'example-edge-case',
        _comment: 'A harder edge case with real headroom, so the suite is not saturated. Keep it fair: no undocumented expectations, no gotchas the SKILL.md never mentions.',
        prompt: 'Describe an edge case your skill handles that a naive answer would get subtly wrong.',
        rubric: "Name the subtle requirement here, grounded in a claim the SKILL.md makes. SCORING ANCHOR (apply strictly): a correct handling scores 0.80; 0.81-1.00 only if additionally flawless and exceptional; cap a response that misses the edge case at 0.5.",
        pass_threshold: 0.7,
      },
    ],
  };
}

function skillTemplate(skillName) {
  return `---
name: ${skillName}
version: 0.1.0
description: One line describing what this skill teaches an agent to do.
---

# ${skillName}

Replace this stub with your skill's instructions. A skill is the guidance you
would give an agent so it follows your conventions — the more concrete and
checkable the claims, the better a suite can measure whether the model still
honours them.

## Rules

1. State the first rule your skill enforces.
2. State the second.
3. Keep each rule specific enough that an eval case can check it.

## Notes

Every case in \`evals/evals.json\` should be grounded in a rule above. If a case
tests something this file never says, the suite is unfair — see AUTHORING.md.
`;
}

function rcTemplate() {
  return {
    _comment: 'Per-project driftproof defaults. CLI flags override these. See `driftproof help`.',
    models: 'claude-haiku-4-5',
    max_usd: 2,
  };
}

// Write `content` to `file` only if nothing has its name. Records the path in `created` or
// `skipped`. Exclusive: a link of that name, dangling or not, is a name taken.
function taken(file) {
  try { fs.lstatSync(file); return true; } catch (_e) { return false; }
}
// A folder inside the skill on the way to a file that is a link would carry the write somewhere
// else, as lib/skill.js refuses to read through one (spec 062, register row 5); such a file is
// skipped, never written. Only folders below the skill's own are read: the path to it is the
// person's.
function linkOnPath(root, file) {
  const parts = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean);
  let cur = root;
  return parts.some((p) => { cur = path.join(cur, p); try { return fs.lstatSync(cur).isSymbolicLink(); } catch (_e) { return false; } });
}
function writeIfAbsent(file, content, created, skipped, root = path.dirname(file)) {
  if (taken(file) || linkOnPath(root, file)) { skipped.push(file); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, content, { flag: 'wx' }); } catch (e) {
    if (e && e.code === 'EEXIST') { skipped.push(file); return; }
    throw e;
  }
  created.push(file);
}

// The name an existing SKILL.md gives, read only from a regular file: a link is not followed.
function existingSkillName(dir) {
  const p = path.join(dir, 'SKILL.md');
  let st;
  try { st = fs.lstatSync(p); } catch (_e) { return null; }
  if (!st.isFile()) return null;
  return parseSkillMeta(fs.readFileSync(p, 'utf8')).name || null;
}

// Spec 165: the label a suite carries when its cases were drafted from the skill and the person
// approved them. `--drafted-from-skill` is that claim, made by whoever runs init; the plugin's door
// gives it only after the person's yes in the run.
const DRAFTED_LABEL = 'drafted from the skill and approved by the user';

// A suite from given cases: the loader's own reading of them, under the template's header. `drafted`
// puts the label on the suite and on every case.
function suiteFromCases(skillName, raw, { drafted = false } = {}) {
  const t = evalsTemplate(skillName);
  const cases = normalizeCases(raw).map((c) => (drafted ? { ...c, origin: DRAFTED_LABEL } : c));
  return { skill: t.skill, version: t.version, format: t.format, ...(drafted ? { origin: DRAFTED_LABEL } : {}), _guidance: t._guidance, cases };
}

// Scaffold into `targetDir`. Returns { dir, created:[abs...], skipped:[abs...], existingSkill }.
// `cases` (optional) is the parsed content of a cases file; it is read before anything is written,
// so cases the loader refuses write nothing.
function scaffoldInit(targetDir, { cases = null, drafted = false } = {}) {
  const dir = path.resolve(targetDir);
  const hadSkill = taken(path.join(dir, 'SKILL.md'));
  const skillName = existingSkillName(dir) || path.basename(dir);
  const suite = cases === null ? evalsTemplate(skillName) : suiteFromCases(skillName, cases, { drafted });
  const created = [];
  const skipped = [];

  writeIfAbsent(path.join(dir, 'SKILL.md'), skillTemplate(skillName), created, skipped, dir);
  writeIfAbsent(
    path.join(dir, 'evals', 'evals.json'),
    JSON.stringify(suite, null, 2) + '\n',
    created, skipped, dir,
  );
  // The rc is a scaffold's: a skill that exists gets the suite and no other file (R-6). An rc
  // already there is still a file init leaves untouched, so it is reported skipped as at the Base.
  if (!hadSkill) writeIfAbsent(path.join(dir, '.driftproofrc'), JSON.stringify(rcTemplate(), null, 2) + '\n', created, skipped, dir);
  else if (taken(path.join(dir, '.driftproofrc'))) skipped.push(path.join(dir, '.driftproofrc'));

  return { dir, created, skipped, existingSkill: hadSkill };
}

module.exports = { scaffoldInit, evalsTemplate, skillTemplate, rcTemplate, suiteFromCases };
