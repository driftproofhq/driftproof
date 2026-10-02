// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for lib/progress.js (spec 138 AC-1): a line per finished call or judge batch, the
// calls made, the fewest and the most, and the time left as a range.
//
//   node --test tests/progress.test.js
//
// The events are the ones lib/run.js sends, in its order, with a fake clock. The bounds are read
// from lib/sampling.js SAMPLING, never typed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { SAMPLING } = require('../lib/sampling');
const { createProgress, duration } = require('../lib/progress');

// One arm's events for `draws` measured draws, as runSkillOnModel sends them.
function armEvents(id, mode, draws) {
  const ev = [];
  for (let d = 0; d < draws; d++) {
    ev.push({ case: id, mode, phase: 'generate', draw: d });
    ev.push({ case: id, mode, phase: 'judge', draw: d, samples: 2 });
  }
  ev.push({ case: id, mode, phase: 'done', outcome: 'pass', score: 0.8, stddev: 0 });
  return ev;
}
function drive(events, { cases, samples, step = 1000 }) {
  let t = 0;
  const lines = [];
  const p = createProgress({ cases, samples, now: () => t, write: (l) => lines.push(l) });
  for (const e of events) { t += step; p.onProgress(e); }
  return { lines, p };
}
const parse = (l) => {
  const m = /progress: call (\d+) of (\d+) to (\d+) · (\S+(?: \S+)?) elapsed · about (.+?) to (.+?) left · (.+)$/.exec(l);
  assert.ok(m, `a progress line in the expected shape: ${l}`);
  return { made: +m[1], fewest: +m[2], most: +m[3], what: m[7] };
};

test('one line per generation and per judge batch, and the calls made add up', () => {
  const samples = 2;
  const draws = SAMPLING.min;
  const ev = [...armEvents('c1', 'with_skill', draws), ...armEvents('c1', 'baseline', draws)];
  const { lines, p } = drive(ev, { cases: 1, samples });
  assert.equal(lines.length, 2 * draws * 2, 'two lines a draw, two arms');
  const last = parse(lines[lines.length - 1]);
  assert.equal(last.made, 2 * draws * (1 + samples));
  assert.equal(p.made(), last.made);
  assert.deepEqual(p.remaining(), { lo: 0, hi: 0 }, 'nothing left once both arms are done');
});

test('the first line ranges from SAMPLING.min to SAMPLING.max draws per arm', () => {
  const samples = 2;
  const { lines } = drive(armEvents('c1', 'with_skill', 1), { cases: 1, samples });
  const first = parse(lines[0]);
  assert.equal(first.made, 1);
  assert.equal(first.fewest, 2 * SAMPLING.min * (1 + samples), 'the fewest: every arm at the minimum');
  assert.equal(first.most, 2 * SAMPLING.max * (1 + samples), 'the most: every arm at the maximum');
  assert.ok(first.fewest < first.most, 'a range, never one figure');
  assert.match(lines[0], /c1 \/ with_skill draw 1: generation done$/);
  assert.match(lines[1], /c1 \/ with_skill draw 1: 2 judge calls done$/);
});

test('the time left is the time per call so far times the fewest and the most still to make', () => {
  const samples = 2;
  let t = 0;
  const lines = [];
  const p = createProgress({ cases: 1, samples, now: () => t, write: (l) => lines.push(l) });
  p.onProgress({ case: 'c1', mode: 'with_skill', phase: 'generate', draw: 0 });
  t = 10000; // ten seconds for the first call
  p.onProgress({ case: 'c1', mode: 'with_skill', phase: 'judge', draw: 0 });
  const { lo, hi } = p.remaining();
  assert.ok(lines[0].includes(`about ${duration(10000 * lo)} to ${duration(10000 * hi)} left`), lines[0]);
  assert.ok(lines[0].includes('10s elapsed'), lines[0]);
});

test('a failed generation settles one call and ends its draw; a failed judge batch settles the batch', () => {
  const samples = 3;
  const ev = [
    { case: 'c1', mode: 'baseline', phase: 'generate', draw: 0 },
    { case: 'c1', mode: 'baseline', phase: 'failed', draw: 0, reason: 'empty generation' },
    { case: 'c1', mode: 'baseline', phase: 'generate', draw: 1 },
    { case: 'c1', mode: 'baseline', phase: 'judge', draw: 1 },
    { case: 'c1', mode: 'baseline', phase: 'failed', draw: 1, reason: 'judge gave no score' },
  ];
  const { lines, p } = drive(ev, { cases: 1, samples });
  assert.equal(lines.length, 3);
  assert.equal(p.made(), 1 + 1 + samples);
  assert.match(lines[0], /draw 1: generation done$/);
  assert.match(lines[2], /draw 2: 3 judge calls done$/);
});

test('concurrent arms interleave and each is counted on its own', () => {
  const samples = 2;
  const a = armEvents('c1', 'with_skill', SAMPLING.min);
  const b = armEvents('c1', 'baseline', SAMPLING.min);
  const ev = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) ev.push(a[i]); if (b[i]) ev.push(b[i]); }
  const { lines, p } = drive(ev, { cases: 1, samples });
  const made = lines.map((l) => parse(l).made);
  assert.deepEqual(made, [...made].sort((x, y) => x - y), 'the calls made never go down');
  assert.equal(p.made(), 2 * SAMPLING.min * (1 + samples));
});

test('under concurrency the calls made plus the fewest still to make is the fewest in all, on every line', () => {
  const samples = 2;
  const arms = [['c1', 'with_skill'], ['c1', 'baseline'], ['c2', 'with_skill'], ['c2', 'baseline']].map(([c, m]) => armEvents(c, m, SAMPLING.min));
  const ev = [];
  for (let i = 0; i < Math.max(...arms.map((a) => a.length)); i++) for (const a of arms) if (a[i]) ev.push(a[i]);
  const { lines } = drive(ev, { cases: 2, samples });
  const parsed = lines.map(parse);
  for (const [i, p] of parsed.entries()) {
    assert.equal(p.fewest, 4 * SAMPLING.min * (1 + samples), lines[i]);
    assert.ok(p.most >= p.fewest, lines[i]);
    if (i) assert.ok(p.most <= parsed[i - 1].most, 'the most only tightens as arms finish');
  }
  assert.equal(parsed[0].most, 4 * SAMPLING.max * (1 + samples));
  assert.equal(parsed[parsed.length - 1].most, parsed[parsed.length - 1].made, 'once every arm is done, the most is what was made');
});

test('durations read as seconds, minutes and hours', () => {
  assert.equal(duration(0), '0s');
  assert.equal(duration(59000), '59s');
  assert.equal(duration(61000), '1m 01s');
  assert.equal(duration(3600000 + 120000), '1h 02m');
});
