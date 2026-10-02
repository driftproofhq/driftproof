// SPDX-License-Identifier: Apache-2.0
'use strict';

// What a first run needs that a measurement does not (spec 138): the warning when a model grades its
// own answers.

const { resolveModel } = require('./provider');
const { canonicalModelId } = require('./usage');

// THE JUDGE IS THE TARGET (spec 138 R-9): compared on canonical ids, so a dated id and its undated
// form are one model. Ids that do not resolve are compared as given.
function canonical(id) {
  let r = id;
  try { r = resolveModel(id); } catch (_e) { r = id; }
  return canonicalModelId(r);
}
function selfJudged(target, judge) {
  return canonical(target) === canonical(judge);
}
function selfJudgeLines(target) {
  const m = canonical(target);
  return [
    `  ! WARNING: the judge is the target model, ${m}.`,
    '  !   The model that wrote each answer also grades it.',
    '  !   To grade with another model, pass --judge-model <id>, or set judge_model in the working directory\'s .driftproofrc.',
  ];
}

module.exports = { selfJudged, selfJudgeLines };
