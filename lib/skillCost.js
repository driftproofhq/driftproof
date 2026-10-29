// SPDX-License-Identifier: Apache-2.0
'use strict';

// Value-per-token axis.
//
// A skill is not free: its SKILL.md is prepended to every generation. Two figures live here.
//
// The estimate: a coarse `ceil(chars / 4)` proxy of the SKILL.md size, the standard rough rule for
// English text, NOT a model tokenizer (no tiktoken dependency; a consistent proxy, not a billing
// figure). Recorded as `skill.tokens`.
//
// The token cost (spec 077): what a skill cost per generation call on one receipt, read from that
// receipt alone and stated beside every verdict or lift on the surfaces spec 077 names. One predicate
// decides, for every surface, whether a cost is shown and in which words, so no surface words it its
// own way or decides on its own.

const { verifyReceiptHash } = require('./receipt');
const { receiptAggregatesOnly } = require('./verdict');
const { routerLimit } = require('./report-015-publication');

const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  const s = String(text || '');
  if (!s.length) return 0;
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

// Lift per 1,000 skill tokens: delta / (skillTokens / 1000). Null when the token count is unknown or
// zero. No verdict surface prints it (spec 077): a ratio over a banded quantity reads as a ranking.
function deltaPer1kTokens(delta, skillTokens) {
  if (typeof delta !== 'number' || !skillTokens || skillTokens <= 0) return null;
  return Math.round((delta / (skillTokens / 1000)) * 1e4) / 1e4;
}

// ── the token cost (spec 077) ─────────────────────────────────────────────────
// The limits (§ Terms). A count above COUNT_MAX is not readable; a receipt past the shape limits is
// refused. 50,000 usages of at most 1e8 tokens sum to at most 5e12, so every sum is exact.
const COUNT_MAX = 100000000;
const LIMITS = Object.freeze({ rows: 5000, draws: 500, usages: 50000 });
const PREFIX = 'skill token cost: ';
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `-${-n}` : '0');
const COST_TEXT = Object.freeze({
  measured: (i, o) => `${PREFIX}${signed(i)} input and ${signed(o)} output tokens per call against no skill (measured, grading excluded)`,
  estimated: (n, unit) => `${PREFIX}about +${n} input tokens per call, estimated from the ${unit === 'context_file' ? 'subject text' : 'SKILL.md'} length (not measured)`,
  simulated: `${PREFIX}simulated (stub run), no figure`,
  none: `${PREFIX}not measured`,
  unverified: `${PREFIX}not stated, the receipt's seal does not verify`,
  refused: `${PREFIX}not stated, the receipt's usage is outside the limits this reader holds`,
});

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const rowFailed = (c) => !!(c.case_status && c.case_status !== 'ok');
const countOk = (x) => Number.isSafeInteger(x) && x >= 0 && x <= COUNT_MAX;
const readable = (u) => isObj(u) && countOk(u.input_tokens) && countOk(u.output_tokens);
const inArm = (c) => !rowFailed(c) && (c.mode === 'with_skill' || c.mode === 'baseline');

// Renderers reject these shapes before reading any case or draw.
function caseShape(receipt) {
  const cases = isObj(receipt) && isObj(receipt.results) ? receipt.results.cases : undefined;
  return Array.isArray(cases) && cases.every((c) => isObj(c)
    && (c.generation === undefined || (isObj(c.generation)
      && (c.generation.draws === undefined || (Array.isArray(c.generation.draws) && c.generation.draws.every(isObj))))));
}
function assertReceiptShape(receipt) {
  if (!caseShape(receipt)) throw Object.assign(new Error('receipt refused: malformed case or draw shape'), { code: 'RECEIPT_SHAPE' });
}

// Exact half-up cents rounding of bounded integral token sums. The scaled sum
// is safe (at most 5e14). Use quotient and remainder before either division.
function tokenMeanCents(sum, count) {
  const scaled = sum * 100;
  if (!Number.isSafeInteger(scaled) || scaled < 0 || !Number.isSafeInteger(count) || count <= 0) return null;
  const remainder = scaled % count;
  return (scaled - remainder) / count + (2 * remainder >= count ? 1 : 0);
}

// The shape and the limits, read before anything is summed.
function withinLimits(receipt) {
  if (!caseShape(receipt)) return false;
  const cases = receipt.results.cases;
  if (cases.length > LIMITS.rows) return false;
  let usages = 0;
  for (const c of cases) {
    if (!isObj(c)) return false;
    const g = c.generation;
    const draws = isObj(g) && Object.hasOwn(g, 'draws') ? g.draws : undefined;
    if (draws !== undefined && (!Array.isArray(draws) || draws.length > LIMITS.draws || !draws.every(isObj))) return false;
    if (inArm(c)) {
      const eligible = eligibleUsages(c);
      for (const u of eligible) {
        if (u == null) continue;
        if (!isObj(u)) return false;
        for (const k of ['input_tokens', 'output_tokens']) if (u[k] != null && !countOk(u[k])) return false;
      }
      usages += eligible.length;
    }
  }
  return usages <= LIMITS.usages;
}

// One row's eligible usages, each present or not: one per measured draw, or the row's own when it has
// no draws array. Judge usage is never one.
function eligibleUsages(row) {
  const g = row.generation;
  if (isObj(g) && Array.isArray(g.draws)) return g.draws.filter((d) => d.status === 'measured').map((d) => d.usage);
  return [row.usage];
}

// One arm's figure: the mean input and output tokens over its eligible usages, each rounded to two
// places (as economics records a mean) and then to a whole token. Null when the arm has no eligible
// usage, or any one is missing or unreadable: nothing is averaged over the rest.
function armFigure(cases, mode) {
  const us = cases.filter((c) => c.mode === mode && !rowFailed(c)).flatMap(eligibleUsages);
  if (!us.length || !us.every(readable)) return null;
  const mean = (k) => {
    const sum = us.reduce((a, u) => a + u[k], 0);
    if (!Number.isSafeInteger(sum)) return null;
    const cents = tokenMeanCents(sum, us.length);
    if (cents === null) return null;
    const remainder = cents % 100;
    return (cents - remainder) / 100 + (remainder >= 50 ? 1 : 0);
  };
  const input = mean('input_tokens');
  const output = mean('output_tokens');
  return input === null || output === null ? null : { input, output };
}

function sealed(receipt) {
  try { return verifyReceiptHash(receipt); } catch { return false; }
}

// The one predicate (spec 077 § The reading). The first rule that applies decides.
//   -> { kind, shown, input, output, text, figure }
function skillTokenCost(receipt) {
  const out = (kind, shown, input, output, text) => ({ kind, shown, input, output, text, figure: text.slice(PREFIX.length) });
  if (!isObj(receipt) || !sealed(receipt)) return out('unverified', true, null, null, COST_TEXT.unverified);
  const run = isObj(receipt.run) ? receipt.run : {};
  const answered = isObj(run.answered_by) ? run.answered_by.kind : undefined;
  const judged = isObj(run.judge) ? run.judge.surface : undefined;
  if (run.surface === 'stub' || answered === 'stub' || judged === 'stub') return out('simulated', true, null, null, COST_TEXT.simulated);
  if (receiptAggregatesOnly(receipt)) return out('aggregates-only', false, null, null, '');
  let limited;
  try { limited = !!routerLimit(receipt); } catch { return out('refused', true, null, null, COST_TEXT.refused); }
  if (limited) return out('no-verdict', false, null, null, '');
  if (!withinLimits(receipt)) return out('refused', true, null, null, COST_TEXT.refused);
  if (answered === 'model') {
    const w = armFigure(receipt.results.cases, 'with_skill');
    const b = armFigure(receipt.results.cases, 'baseline');
    if (w && b) {
      const i = w.input - b.input;
      const o = w.output - b.output;
      return out('measured', true, i, o, COST_TEXT.measured(i, o));
    }
  }
  const t = isObj(receipt.skill) ? receipt.skill.tokens : undefined;
  if (Number.isSafeInteger(t) && t >= 1 && t <= COUNT_MAX) return out('estimated', true, t, null, COST_TEXT.estimated(t, receipt.skill.unit));
  return out('none', true, null, null, COST_TEXT.none);
}

// A sentence that starts a paragraph or a field.
const costSentence = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

module.exports = {
  estimateTokens, deltaPer1kTokens, CHARS_PER_TOKEN,
  skillTokenCost, costSentence, COST_TEXT, COUNT_MAX, LIMITS, tokenMeanCents, assertReceiptShape,
};
