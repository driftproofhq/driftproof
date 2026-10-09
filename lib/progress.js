// SPDX-License-Identifier: Apache-2.0
'use strict';

// Progress per call, with the time left (spec 138 R-1).
//
// IT READS WHAT THE RUNNER ALREADY SAYS. lib/run.js calls onProgress before each generation
// (`generate`), before a draw's judge calls (`judge`), on a draw that failed (`failed`) and when an
// arm is done (`done`). The step an event follows has finished, so each event settles the step
// before it: a generation is one call, and a draw's judge calls finish together, `samples` of them,
// as one step. The runner's draw loop is not touched.
//
// SPEC 173: A TASK'S DRAWS MAY RUN TOGETHER (up to --concurrency), so each draw's step is kept on its
// own, by its draw index. The runner says `judged` when a draw's judge calls are done, which settles
// them; a stream that never says it (an older runner's, one draw at a time) settles them on the next
// draw's `generate` or the arm's `done`, as before.
//
// THE TIME LEFT IS A RANGE, NEVER ONE FIGURE. Every arm draws at least SAMPLING.min times and at most
// SAMPLING.max (lib/sampling.js), and which it will be is not known until it stops. So the calls
// still to make run from the fewest (when every call answers) to the most, and the time left is the
// time per call so far times each. An arm whose every draw failed sends no `done`, and stays in
// the most until the run ends. A call that timed out is counted as made: it took its time. The receipt's call count
// leaves it out, so on a run with timeouts the two differ.
//
// PURE BUT FOR `now` AND `write`, which the caller passes, so a test drives it with a fake clock.

const { SAMPLING } = require('./sampling');

function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// `cases` is the number of cases the run will measure; each has two arms, each arm one task.
function createProgress({ cases, samples, now = Date.now, write = (l) => process.stderr.write(`${l}\n`), min = SAMPLING.min, max = SAMPLING.max }) {
  const perDraw = 1 + samples;
  const tasks = new Map();
  const nTasks = cases * 2;
  let made = 0;
  let started = null;

  const taskOf = (p) => {
    const key = `${p.case}\u0000${p.mode}`;
    if (!tasks.has(key)) tasks.set(key, { drawsEnded: 0, pending: new Map(), done: false });
    return tasks.get(key);
  };

  // The calls still to make, fewest and most, over every arm: the arms not begun, and for each arm
  // begun, its draws' unfinished steps and the draws it may still take.
  function remaining() {
    let lo = 0; let hi = 0;
    for (const t of tasks.values()) {
      if (t.done) continue;
      const begun = t.drawsEnded + t.pending.size;
      let inFlightHi = 0;
      for (const s of t.pending.values()) inFlightHi += s === 'gen' ? perDraw : samples;
      // The fewest counts every call answering, so a draw begun finishes its judge calls too.
      const inFlightLo = inFlightHi;
      lo += inFlightLo + Math.max(0, min - begun) * perDraw;
      hi += inFlightHi + Math.max(0, max - begun) * perDraw;
    }
    const unbegun = Math.max(0, nTasks - tasks.size);
    lo += unbegun * min * perDraw;
    hi += unbegun * max * perDraw;
    return { lo, hi };
  }

  function line(p, step, n) {
    const { lo, hi } = remaining();
    const elapsed = now() - started;
    // A line is written only when a step has finished, so `made` is never zero here.
    const left = `about ${duration((elapsed / made) * lo)} to ${duration((elapsed / made) * hi)} left`;
    const what = step === 'gen' ? 'generation' : `${n} judge call${n === 1 ? '' : 's'}`;
    write(`  progress: call ${made} of ${made + lo} to ${made + hi} · ${duration(elapsed)} elapsed · ${left} · ${p.case} / ${p.mode} draw ${(p.draw == null ? 0 : p.draw) + 1}: ${what} done`);
  }

  // Settle the step the event follows, note the step it begins, then say where the run is. The new
  // step is noted before the line is written, so the calls still to make count it once.
  function onProgress(p) {
    if (!p || !p.case || !p.mode) return;
    if (started === null) started = now();
    const t = taskOf(p);
    const d = p.draw == null ? 0 : p.draw;
    const settled = [];
    const settleJudge = (k) => {
      made += samples;
      settled.push({ step: 'judge', n: samples, draw: k });
      t.pending.delete(k);
      t.drawsEnded += 1;
    };
    const step = t.pending.get(d);
    if (step === 'gen' && (p.phase === 'judge' || p.phase === 'failed')) {
      made += 1;
      settled.push({ step: 'gen', n: 1, draw: d });
      t.pending.delete(d);
      if (p.phase === 'failed') t.drawsEnded += 1;
    } else if (step === 'judge' && (p.phase === 'judged' || p.phase === 'failed')) settleJudge(d);
    // A stream that never says `judged`: the next draw's generation, or the arm's end, settles every
    // earlier draw's judge calls still open.
    if (p.phase === 'generate' || p.phase === 'done') {
      for (const [k, s] of [...t.pending]) if (s === 'judge' && (p.phase === 'done' || k < d)) settleJudge(k);
    }
    if (p.phase === 'generate') t.pending.set(d, 'gen');
    if (p.phase === 'judge') t.pending.set(d, 'judge');
    if (p.phase === 'done') t.done = true;
    for (const s of settled) line({ case: p.case, mode: p.mode, draw: s.draw }, s.step, s.n);
  }

  return { onProgress, made: () => made, remaining };
}

module.exports = { createProgress, duration };
