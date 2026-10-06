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
const provider = require('../lib/provider');
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
  // The plugin refuses --judge-model, so the line also names the plugin user's way.
  assert.match(lines[2], /set judge_model in the working directory's \.driftproofrc\./);
});

// Spec 140 (R-3): the isolation account, asked of a run that needs it.
test('evalUserExists reads id -u: 0 is an account, anything else is none, no id to ask is null', () => {
  const asked = [];
  const spawn = (status, error) => (cmd, args) => { asked.push([cmd, ...args]); return { status, error }; };
  assert.equal(provider.evalUserExists('someone', { spawn: spawn(0) }), true);
  assert.equal(provider.evalUserExists('someone', { spawn: spawn(1) }), false);
  assert.equal(provider.evalUserExists('someone', { spawn: spawn(null, new Error('ENOENT')) }), null);
  assert.deepEqual(asked[0], ['id', '-u', 'someone']);
});

test('isolationPreflight refuses only a run that needs the account and has none, in one line', () => {
  const base = { surfaces: ['claude-cli'], trusted: false, stub: false, user: 'driftproof-nouser', exists: false };
  const why = fr.isolationPreflight(base);
  assert.ok(why && !why.includes('\n'), 'one line');
  assert.ok(why.includes('driftproof-nouser') && why.includes('--trusted-skill'));
  assert.equal(fr.isolationPreflight({ ...base, trusted: true }), null);
  assert.equal(fr.isolationPreflight({ ...base, stub: true }), null);
  assert.equal(fr.isolationPreflight({ ...base, surfaces: [] }), null);
  assert.equal(fr.isolationPreflight({ ...base, exists: true }), null);
  assert.equal(fr.isolationPreflight({ ...base, exists: null }), null, 'no id to ask: the hop answers');
});
