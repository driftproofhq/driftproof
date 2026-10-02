// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for lib/firstrun.js (spec 138 AC-7): the warning when the judge is the target.
//
//   node --test tests/firstrun.test.js
//
// No spawn. The model ids are the registry's, checked registered before a test reads them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fr = require('../lib/firstrun');
const { registryStatus } = require('../lib/models');

const TARGET = 'claude-haiku-4-5';
const DATED = 'claude-haiku-4-5-20251001';
const OTHER = 'claude-sonnet-5';

test('the judge is the target on canonical ids, a dated id and its undated form one model', () => {
  for (const id of [TARGET, DATED, OTHER]) assert.equal(registryStatus(id), 'registered', `${id} is in the registry`);
  assert.equal(fr.selfJudged(TARGET, TARGET), true);
  assert.equal(fr.selfJudged(TARGET, DATED), true);
  assert.equal(fr.selfJudged(TARGET, OTHER), false);
  const lines = fr.selfJudgeLines(DATED);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /WARNING: the judge is the target model, claude-haiku-4-5\./);
  assert.ok(lines.join('\n').includes('--judge-model'));
  // Lane 103's finding 2: the plugin refuses --judge-model, so the line also names the plugin user's way.
  assert.match(lines[2], /set judge_model in the working directory's \.driftproofrc\./);
});
