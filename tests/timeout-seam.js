#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 489: when preloaded by its CLI tests, observe the provider boundary.
if (process.env.SPEC489_CALLS) {
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 489: observe the real CLI's provider boundary without sending a request.
// Loaded before bin/driftproof, only in a child explicitly running the offline stub.
const fs = require('node:fs');
if (process.env.DRIFTPROOF_STUB !== '1' || !process.env.SPEC489_CALLS) {
  throw new Error('issue 489 observer requires the offline stub and a scratch call file');
}
const provider = require('../lib/provider');
const original = provider.complete;
provider.complete = (args) => {
  const judge = /Return ONLY this JSON object/.test(String(args.prompt || ''));
  const actual = { ...args };
  // Deliberately broken forwarding, used to prove the same call oracle reads RED.
  if (process.env.SPEC489_PLANT === (judge ? 'drop-judge' : 'drop-generation')) {
    actual.timeoutMs = provider.retryPolicyForSurface(provider.surfaceForModel(args.model)).timeoutMs;
  }
  fs.appendFileSync(process.env.SPEC489_CALLS, JSON.stringify({
    phase: judge ? 'judge' : 'generation',
    model: args.model,
    surface: provider.surfaceForModel(args.model),
    timeoutMs: actual.timeoutMs,
    arm: judge ? null : args.system ? 'with_skill' : 'baseline',
  }) + '\n');
  return original(actual);
};

} else {
// Recording seam for spec 017 AC-1: drives lib/run.js's runSkillOnModel
// end-to-end under DRIFTPROOF_STUB=1 and prints, as JSON, the `timeoutMs`
// every provider `complete()` call actually received — bucketed by
// generation vs judge — so tests/gate.js can assert the VALUE THAT REACHED
// THE PROVIDER, not the declared policy text.
//
// SHIPS: this file lives under tests/, which build-public.sh publishes (only
// tests/gate-results.json is excluded), so it runs identically in both the
// source and the published tree. It is invoked as a subprocess (not required
// in-process) purely so tests/gate.js — synchronous throughout — never has to
// await a promise at its top level.
//
// Zero-spend: refuses to run unless DRIFTPROOF_STUB=1 is already set by the
// caller, and the wrapped `complete()` forwards to the REAL complete(), which
// under the stub short-circuits before any network or subprocess use of the
// timeout value.

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

if (process.env.DRIFTPROOF_STUB !== '1') fail('DRIFTPROOF_STUB is not set — refusing to drive a run that could reach a live provider');

const model = process.argv[2];
const judgeModel = process.argv[3];
if (!model || !judgeModel) fail('usage: timeout-seam.js <model> <judgeModel>');

function seamFixtureSkill() {
  return {
    name: 'gate-timeout-seam',
    version: '0.0.0',
    skillMd: '# probe\nsynthetic skill for the AC-1 timeout recording seam (tests/gate.js). Not a real skill.',
    contentHash: 'seam-fixture-content-hash',
    suite: {
      format: 'agentskills.io/evals',
      suiteHash: 'seam-fixture-suite-hash',
      caseCount: 1,
      cases: [{ id: 'seam-case-1', prompt: 'Say hello.', rubric: 'The response says hello.', pass_threshold: 0.5 }],
    },
  };
}

async function main() {
  const providerPath = require.resolve('../lib/provider');
  const providerMod = require(providerPath);
  const realComplete = providerMod.complete;
  const observed = [];
  providerMod.complete = (args) => {
    const isJudge = /Return ONLY this JSON object/.test(String((args && args.prompt) || ''));
    observed.push({ timeoutMs: args && args.timeoutMs, kind: isJudge ? 'judge' : 'gen' });
    return realComplete(args);
  };

  const { runSkillOnModel } = require('../lib/run');
  await runSkillOnModel({
    skill: seamFixtureSkill(),
    model,
    opts: { judgeModel, samples: 1, maxCases: 1, maxCalls: 200, concurrency: 1 },
  });
  process.stdout.write(JSON.stringify({ observed }));
}

main().catch((e) => fail(`FAIL: ${(e && e.stack) || e}`));

}
