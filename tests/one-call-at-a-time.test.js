// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 177 (issue 104): at --concurrency 1 a run makes one model call at a time, and so
// does a regrade, which judges each archived answer once per sample; and --keep-transcripts keeps the
// last measured draw of each case and mode only.
//
//   node --test tests/one-call-at-a-time.test.js
//
// No model is called and nothing is spawned. lib/provider.js's `complete` is replaced by a counting fake
// BEFORE lib/judge.js and lib/run.js are loaded (each takes `complete` when it loads). SPEC177_ROOT names
// another copy of the code to load (the gate's Base and planted copies); by default it is this checkout.
// The one file written is a skill under the system temp directory, removed after.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RT = process.env.SPEC177_ROOT || path.join(__dirname, '..');
const R = (m) => require(path.join(RT, m));
const MODEL = 'claude-haiku-4-5';
const SAMPLES = 3;
process.env.DRIFTPROOF_STUB = '1';

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// The fake. Every fourth generation is empty, so some draws are unmeasured and the last draw of a task
// is not always its last measured one. Every judge call scores, so no draw is unmeasured by the judge.
// A judge prompt carries the answer, and every answer is its own, so the calls in flight for one judge
// prompt are one draw's samples in flight together.
const seen = { inflight: 0, most: 0, perDraw: new Map(), drawMost: 0, gen: 0, judge: 0, answers: {} };
const reset = () => Object.assign(seen, { inflight: 0, most: 0, perDraw: new Map(), drawMost: 0, gen: 0, judge: 0 });
const provider = R('lib/provider.js');
const { sha256 } = R('lib/canonical.js');
provider.complete = async ({ system, prompt }) => {
  const judge = /Return ONLY this JSON object/.test(String(prompt || ''));
  const n = judge ? ++seen.judge : ++seen.gen;
  seen.inflight += 1; seen.most = Math.max(seen.most, seen.inflight);
  if (judge) { seen.perDraw.set(prompt, (seen.perDraw.get(prompt) || 0) + 1); seen.drawMost = Math.max(seen.drawMost, seen.perDraw.get(prompt)); }
  try {
    await new Promise((r) => setTimeout(r, 10));
    let text;
    if (judge) text = JSON.stringify({ score: 0.8, pass: true, reason: `fake grade ${n}` });
    else {
      text = n % 4 === 0 ? '' : `fake answer ${n} ${system ? 'with' : 'without'} the skill`;
      if (text) seen.answers[sha256(text)] = text;
    }
    return { text, usage: { input_tokens: 10, output_tokens: 5 }, wall_ms: 10, attempts: 1, answeredBy: 'stub', surface: 'stub', reportedModels: null, stopReason: 'end_turn', isolation: 'none' };
  } finally {
    seen.inflight -= 1;
    if (judge) seen.perDraw.set(prompt, seen.perDraw.get(prompt) - 1);
  }
};
const { runSkillOnModel } = R('lib/run.js');
const { regradeReceipt } = R('lib/regrade.js');
const { loadSkill } = R('lib/skill.js');

function skill() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec177-'));
  made.push(d);
  const dir = path.join(d, 'fx');
  fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: fx\nversion: 1.0.0\n---\n\n# fx\n\nAnswer in one short sentence.\n');
  fs.writeFileSync(path.join(dir, 'evals', 'evals.json'), JSON.stringify({ cases: [1, 2].map((i) => ({ id: `c${i}`, prompt: `Question ${i}?`, rubric: 'One short sentence scores 0.80.' })) }));
  return loadSkill(dir);
}
const run = (sk, concurrency, extra = {}) => runSkillOnModel({ skill: sk, model: MODEL, opts: { samples: SAMPLES, concurrency, nowIso: '2026-10-09T00:00:00.000Z', ...extra } });
const graded = (receipt) => receipt.results.cases.flatMap((c) => c.generation.draws).filter((d) => d.generation_hash && d.truncated !== true).length;

test('AC-1 at --concurrency 1 a run has one call in flight at a time', async () => {
  reset();
  await run(skill(), 1);
  assert.ok(seen.judge > 0, 'the run made judge calls');
  assert.equal(seen.most, 1, `${seen.most} calls in flight at once at --concurrency 1`);
});

test('AC-1 a regrade has one call in flight at a time and judges each answer once per sample', async () => {
  const sk = skill();
  reset();
  const { receipt } = await run(sk, 1);
  const answers = { ...seen.answers };
  reset();
  await regradeReceipt({ receipt, skill: sk, answers, judgeModel: MODEL, samples: SAMPLES, opts: { trusted: true } });
  assert.equal(seen.gen, 0, 'the regrade made no generation call');
  assert.equal(seen.most, 1, `${seen.most} calls in flight at once in the regrade`);
  assert.equal(seen.judge, graded(receipt) * SAMPLES, `${seen.judge} judge calls for ${graded(receipt)} answers x ${SAMPLES} samples`);
});

test('AC-1 at --concurrency 4 a draw\'s judge samples are still in flight together', async () => {
  reset();
  await run(skill(), 4);
  assert.equal(seen.drawMost, SAMPLES, `${seen.drawMost} of a draw's ${SAMPLES} judge samples in flight at most`);
});

test('AC-2 --keep-transcripts keeps one transcript per case and mode, the last measured draw\'s', async () => {
  for (const concurrency of [1, 4]) {
    reset();
    const r = await run(skill(), concurrency, { keepTranscripts: true });
    const rows = r.receipt.results.cases;
    assert.equal(r.transcripts.length, rows.length, `--concurrency ${concurrency}: one transcript per case and mode`);
    let several = 0;
    for (const c of rows) {
      const measured = c.generation.draws.filter((d) => d.status === 'measured');
      if (measured.length > 1) several += 1;
      const t = r.transcripts.find((x) => x && x.id === c.id && x.mode === c.mode);
      assert.ok(t, `--concurrency ${concurrency}: ${c.id}/${c.mode} has a transcript`);
      assert.equal(sha256(t.generation), measured[measured.length - 1].generation_hash, `--concurrency ${concurrency}: ${c.id}/${c.mode}'s transcript is its last measured draw`);
      assert.equal(t.judge_outputs.length, SAMPLES);
    }
    assert.ok(several > 0, `--concurrency ${concurrency}: no task drew more than one measured draw, so first and last cannot be told apart`);
  }
});
