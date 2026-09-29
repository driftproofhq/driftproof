// SPDX-License-Identifier: Apache-2.0
'use strict';

// Receipt counts (spec 043, receipt spec v0.8). Two counts describe how a receipt's data
// came to be, and they are kept apart because they measure different things (Report 006:
// generation spread ran 3 to 7 times judge spread on the same cases):
//
//   generations_per_arm           independent candidate generations
//   judge_samples_per_generation  judge samples taken of each generation
//
// A count sits at the narrowest scope that is honest about it: run.counts when it is
// the same for every case of every arm generated in this run, run.arms.<mode>.counts
// when it holds for one arm, results.cases[i].counts otherwise. An absent count is
// unknown, never 1 (agentskills discussion #544, comment 18409751, rule 1).

const KINDS = ['generations_per_arm', 'judge_samples_per_generation'];

// An arm that carries its own generated_at was generated in an earlier run. run.counts
// describes this run's generations, so an archived arm never inherits it.
function archived(receipt, mode) {
  const a = receipt.run && receipt.run.arms && receipt.run.arms[mode];
  return !!(a && a.generated_at);
}

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k) && Number.isInteger(o[k]);

// Where a reader looks, narrowest first.
const ORDER = ['case', 'arm', 'run'];
const SCOPES = {
  case: (r, c) => c.counts,
  arm: (r, c) => { const a = r.run && r.run.arms && r.run.arms[c.mode]; return a && a.counts; },
  run: (r) => r.run && r.run.counts,
};

// The count of `kind` for results.cases[index], or null when the receipt does not
// establish it. run.judge.samples is the run-scope judge count (R-5), read only where
// run.counts is silent and only for an arm generated in this run.
function resolveCount(receipt, index, kind) {
  if (!KINDS.includes(kind)) throw new Error(`unknown count kind: ${kind}`);
  const c = receipt.results.cases[index];
  for (const scope of ORDER) {
    const at = SCOPES[scope](receipt, c);
    if (has(at, kind)) return at[kind];
    if (scope === 'run' && kind === 'judge_samples_per_generation' && receipt.run && receipt.run.judge && Number.isInteger(receipt.run.judge.samples)) return receipt.run.judge.samples;
    if (scope === 'arm' && archived(receipt, c.mode)) return null;
  }
  return null;
}

// Which model generated an arm, and when: the arm's override, else the run's.
function resolveArm(receipt, mode) {
  const a = (receipt.run && receipt.run.arms && receipt.run.arms[mode]) || {};
  return {
    model_id: a.model_id || receipt.run.model_id,
    generated_at: a.generated_at || receipt.run.generated_at || null,
    archived: archived(receipt, mode),
  };
}

// Write counts at the narrowest honest scope (spec 043 AC-3). `perCase` is one entry per
// results.cases index: { index, counts: { <kind>: integer } } with a kind left out when
// the writer cannot establish it. Mutates and returns the receipt; call before sealing.
function placeCounts(receipt, perCase) {
  const cases = receipt.results.cases;
  const fresh = perCase.filter((p) => !archived(receipt, cases[p.index].mode));
  const put = (obj, kind, v) => { obj.counts = { ...(obj.counts || {}), [kind]: v }; };
  for (const kind of KINDS) {
    const entries = fresh.map((p) => ({ p, v: p.counts && Number.isInteger(p.counts[kind]) ? p.counts[kind] : null }));
    if (!entries.length) continue;
    const allKnown = entries.length === cases.filter((c) => !archived(receipt, c.mode)).length && entries.every((e) => e.v !== null);
    const values = new Set(entries.map((e) => e.v));
    if (allKnown && values.size === 1) { receipt.run.counts = { ...(receipt.run.counts || {}), [kind]: entries[0].v }; continue; }
    const byMode = new Map();
    for (const e of entries) { const m = cases[e.p.index].mode; if (!byMode.has(m)) byMode.set(m, []); byMode.get(m).push(e); }
    for (const [mode, es] of byMode) {
      const modeKnown = allKnown && es.length === cases.filter((c) => c.mode === mode).length;
      if (modeKnown && new Set(es.map((e) => e.v)).size === 1) {
        receipt.run.arms = receipt.run.arms || {};
        receipt.run.arms[mode] = receipt.run.arms[mode] || {};
        put(receipt.run.arms[mode], kind, es[0].v);
      } else {
        for (const e of es) if (e.v !== null) put(cases[e.p.index], kind, e.v);
      }
    }
  }
  return receipt;
}

// The judge-sample count, or null when the receipt does not establish one at run scope.
function judgeSamplesOrNull(receipt) {
  const j = receipt && receipt.run && receipt.run.judge;
  if (j && Number.isInteger(j.samples)) return j.samples;
  const c = receipt && receipt.run && receipt.run.counts;
  return has(c, 'judge_samples_per_generation') ? c.judge_samples_per_generation : null;
}

// v0.8 loader rule (spec 043 AC-2): the two spellings of the run's judge count agree.
function judgeCountsDisagree(receipt) {
  const j = receipt && receipt.run && receipt.run.judge;
  const c = receipt && receipt.run && receipt.run.counts;
  return !!(j && Number.isInteger(j.samples) && has(c, 'judge_samples_per_generation') && c.judge_samples_per_generation !== j.samples);
}

module.exports = { KINDS, ORDER, resolveCount, resolveArm, placeCounts, judgeSamplesOrNull, judgeCountsDisagree };
