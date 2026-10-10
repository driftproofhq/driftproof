// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for issue 6 (spec 128 A-128-9): the view page's Answers row equals what the receipt
// records, on a receipt shaped like the 6 Oct 2026 smoke run (4 test tasks, 2 judge samples, 25
// answers with the skill and 14 without).
//
//   node --test tests/view-answers.test.js
//
// No model is called. The receipt is a stub quick run's (DRIFTPROOF_STUB=1), made by this checkout's
// bin/driftproof in a folder under the system temp directory, removed after, and reshaped to that run's
// draws: the sampling rule draws 3 to 10 answers per test task per arm, and the quick preset sets the
// judge samples only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sealReceipt } = require('../lib/receipt');
const { acrossDraws } = require('../lib/sampling');
const { placeCounts, resolveCount } = require('../lib/counts');
const { renderView } = require('../lib/view');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const MODEL = 'claude-haiku-4-5';
// The answers each test task drew per arm: 25 with the skill and 14 without, over 4 test tasks.
const DRAWS = { with_skill: [10, 3, 9, 3], baseline: [3, 3, 3, 5] };
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'issue6-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^SOURCE_DATE_EPOCH$/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, DRIFTPROOF_STUB: '1' };
}

// A stub quick run over a skill of four test tasks.
let quick = null;
function quickReceipt() {
  if (quick) return structuredClone(quick);
  const dir = tmp();
  const sk = path.join(dir, 'fx');
  fs.mkdirSync(path.join(sk, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: fx\nversion: 1.0.0\n---\n\n# fx\n\nAnswer in one short sentence.\n');
  fs.writeFileSync(path.join(sk, 'evals', 'evals.json'), JSON.stringify({ cases: [1, 2, 3, 4].map((i) => ({ id: `c${i}`, prompt: `Question ${i}?`, rubric: 'One short sentence scores 0.80.' })) }));
  const out = path.join(dir, 'out');
  const r = spawnSync(process.execPath, [BIN, 'run', sk, '--models', MODEL, '--quick', '--out', out], { cwd: dir, env: cleanEnv(), encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const files = fs.readdirSync(out).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1);
  quick = JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8'));
  return structuredClone(quick);
}

// Each test task's rows get DRAWS' answers, each scored by the judge as many times as the run took;
// `lost` names draws that are lost (unmeasured) as { mode, id, index }. The counts are placed again as
// lib/receipt.js places them, and the receipt is sealed.
function shaped(lost = []) {
  const r = quickReceipt();
  const judgeN = r.run.judge.samples;
  const ids = [...new Set(r.results.cases.map((c) => c.id))];
  r.results.cases = r.results.cases.map((row) => {
    const c = structuredClone(row);
    const t0 = c.generation.draws[0];
    const k = DRAWS[c.mode][ids.indexOf(c.id)];
    const draws = Array.from({ length: k }, (_, j) => {
      if (lost.some((x) => x.mode === c.mode && x.id === c.id && x.index === j)) {
        return { draw_index: j, generation_hash: null, status: 'unmeasured', reason: 'timeout', samples: [], mean: null, stddev: null, stop_reason: null, truncated: false, reported_model: null };
      }
      const s = 0.5 + ((j % 4) - 1.5) * 0.1;
      return { ...t0, draw_index: j, status: 'measured', samples: Array(judgeN).fill(s), judge_sample_hashes: (t0.judge_sample_hashes || []).slice(0, judgeN), mean: s, stddev: 0, truncated: false };
    });
    const a = acrossDraws(draws);
    c.generation = { ...c.generation, draws, n_drawn: a.n_drawn, n_measured: a.n_measured, n_unmeasured: a.n_unmeasured, mean: a.mean, sd: a.sd, judge_sd_mean: a.judge_sd_mean, variance_ratio: a.variance_ratio, variance_ratio_unavailable: a.variance_ratio_unavailable, n_truncated: 0 };
    c.mean = a.mean; c.score = a.mean; c.stddev = a.sd;
    delete c.counts;
    return c;
  });
  if (r.run.counts) delete r.run.counts;
  if (r.run.arms) {
    for (const m of Object.keys(r.run.arms)) { delete r.run.arms[m].counts; if (!Object.keys(r.run.arms[m]).length) delete r.run.arms[m]; }
    if (!Object.keys(r.run.arms).length) delete r.run.arms;
  }
  placeCounts(r, r.results.cases.map((c, index) => ({ index, counts: { generations_per_arm: c.generation.draws.length, judge_samples_per_generation: judgeN } })));
  return sealReceipt(r);
}

function answersRow(receipt) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'r.json'), JSON.stringify(receipt));
  const { html } = renderView(dir, { stale: { noHarnessCheck: true } });
  const m = /data-field="answers">([^<]*)</.exec(html);
  assert.ok(m, 'the sheet has an Answers row');
  return m[1];
}

// What the receipt records, read through lib/counts.js: per arm, the generations it drew less the ones
// its generation block records as unmeasured; the test tasks; the judge samples per generation.
function recorded(r) {
  const arm = (mode) => r.results.cases.reduce((t, c, i) => (c.mode === mode ? t + resolveCount(r, i, 'generations_per_arm') - c.generation.n_unmeasured : t), 0);
  const judge = [...new Set(r.results.cases.map((c, i) => resolveCount(r, i, 'judge_samples_per_generation')))];
  assert.equal(judge.length, 1, 'one judge count for every row');
  return { with: arm('with_skill'), without: arm('baseline'), tasks: new Set(r.results.cases.map((c) => c.id)).size, judge: judge[0] };
}

test('the receipt is shaped like the 6 Oct smoke run: a quick run, 4 test tasks, 2 judge samples in run.counts, 25 and 14 answers', () => {
  const r = shaped();
  assert.equal(r.run.preset, 'quick');
  assert.equal(r.run.counts.judge_samples_per_generation, 2);
  assert.deepEqual(recorded(r), { with: 25, without: 14, tasks: 4, judge: 2 });
});

test('the Answers row equals the receipt\'s counts, and says the judge samples are per answer, not per test task', () => {
  const r = shaped();
  const n = recorded(r);
  assert.equal(answersRow(r), `${n.with} with the skill, ${n.without} without, across ${n.tasks} test tasks; the judge scored each answer ${n.judge} times`);
});

test('a lost draw is not counted as an answer: the row reads the generations the receipt records less the unmeasured', () => {
  const r = shaped([{ mode: 'with_skill', id: 'c1', index: 4 }]);
  const n = recorded(r);
  assert.equal(n.with, 24);
  assert.equal(resolveCount(r, r.results.cases.findIndex((c) => c.mode === 'with_skill' && c.id === 'c1'), 'generations_per_arm'), 10, 'the lost draw is a generation the receipt records');
  assert.equal(answersRow(r), `${n.with} with the skill, ${n.without} without, across ${n.tasks} test tasks; the judge scored each answer ${n.judge} times`);
});
