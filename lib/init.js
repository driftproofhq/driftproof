// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('fs');
const path = require('path');

// `driftproof init <dir>` scaffolding.
//
// Produces a complete, runnable skill skeleton the way agentskills.io expects it:
//   <dir>/SKILL.md            — the skill instructions (a stub, if none exists)
//   <dir>/evals/evals.json    — an eval suite with 3 example cases, each rubric
//                               anchored at 0.80 (the scoring convention the
//                               example suite and Report #001 use)
//   <dir>/.driftproofrc       — per-project run defaults (budget, models, samples)
//
// NEVER overwrites an existing file — every write is guarded, and an existing
// path is reported as "skipped". Safe to re-run.

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
    samples: 5,
    max_usd: 2,
  };
}

// Write `content` to `file` only if it does not already exist. Records the path
// in `created` or `skipped`.
function writeIfAbsent(file, content, created, skipped) {
  if (fs.existsSync(file)) { skipped.push(file); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  created.push(file);
}

// Scaffold into `targetDir`. Returns { dir, created:[abs...], skipped:[abs...] }.
function scaffoldInit(targetDir) {
  const dir = path.resolve(targetDir);
  const skillName = path.basename(dir);
  const created = [];
  const skipped = [];

  writeIfAbsent(path.join(dir, 'SKILL.md'), skillTemplate(skillName), created, skipped);
  writeIfAbsent(
    path.join(dir, 'evals', 'evals.json'),
    JSON.stringify(evalsTemplate(skillName), null, 2) + '\n',
    created, skipped,
  );
  writeIfAbsent(
    path.join(dir, '.driftproofrc'),
    JSON.stringify(rcTemplate(), null, 2) + '\n',
    created, skipped,
  );

  return { dir, created, skipped };
}

module.exports = { scaffoldInit, evalsTemplate, skillTemplate, rcTemplate };
