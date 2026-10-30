// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 538: a text observation, never a claim that a tool ran.
const OUTCOME = 'fake_tool_call';
const REASON = 'fake tool call: the reply ends in tool-call markup written as text';
const WARNING = "Comparison unreliable: at least 5% of an arm's replies ended in fake tool calls.";
const ROOT = /^<(function_calls|invoke|tool_call|function_call)(?=[\s>])[^<>]*>/;
function textFakeToolCall(answer, mode) {
  if (mode !== 'text' || typeof answer !== 'string') return null;
  const lines = answer.trimEnd().split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const f = /^(\x60{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const open = ROOT.exec(line);
    if (!open) continue;
    const tail = lines.slice(i).join('\n').trim();
    // Complete outer call, or an interrupted call ending at an XML tag.
    if (new RegExp('</' + open[1] + '>\\s*$').test(tail)
      || (!tail.includes('</' + open[1] + '>') && /<(?:\/?(?:function_calls|invoke|tool_call|function_call|parameter))\b[^<>]*>\s*$/.test(tail))) {
      return { kind: OUTCOME, reason: REASON };
    }
  }
  return null;
}
function fakeToolCallCounts(receipt) {
  if (receipt?.run?.capture?.mode !== 'text') return null;
  const counts = {};
  for (const c of receipt?.results?.cases || []) {
    if (!['with_skill', 'baseline', 'placebo'].includes(c.mode)) continue;
    const arm = counts[c.mode] ||= { count: 0, draws: 0 };
    for (const d of c.generation?.draws || []) {
      arm.draws++;
      if (d.capture_outcome === OUTCOME) arm.count++;
    }
  }
  return counts;
}
function fakeToolCallWarning(receipt) {
  const counts = fakeToolCallCounts(receipt);
  return counts && Object.values(counts).some(a => a.draws > 0 && a.count * 20 >= a.draws) ? WARNING : null;
}
function fakeToolCallLines(receipt) {
  // Historical receipts have no recorded count, not a known zero.
  if (!receipt?.results?.fake_tool_calls) return [];
  const counts = fakeToolCallCounts(receipt);
  if (!counts) return [];
  const stub = receipt.run?.surface === 'stub' || receipt.run?.answered_by?.kind === 'stub' || receipt.run?.judge?.surface === 'stub';
  if (stub && Object.values(counts).every(a => a.count === 0)) return [];
  const names = { with_skill: 'with the subject', baseline: 'without the subject', placebo: 'placebo' };
  const lines = ['Fake tool calls: ' + Object.entries(counts).map(([m,a]) => names[m] + ' ' + a.count + '/' + a.draws).join('; ') + '.'];
  const warning = fakeToolCallWarning(receipt);
  if (warning) lines.unshift(warning);
  return lines;
}
function fakeToolCallProblem(receipt) {
  const counts = fakeToolCallCounts(receipt);
  const stored = receipt?.results?.fake_tool_calls;
  const cases = receipt?.results?.cases || [];
  const marked = cases.some(c => c.generation?.draws?.some(d => d.capture_outcome === OUTCOME));
  if (!counts && (stored !== undefined || marked)) return 'Fake tool calls belong only to text capture.';
  if (!counts) return null;
  if (stored !== undefined || marked || (receipt.schema_version === '0.16' && receipt.generation_sampled === true)) {
    if (require('./canonical').canonicalize(stored ?? null) !== require('./canonical').canonicalize(counts)) return 'Fake tool call counts differ from the recorded draws.';
  }
  for (const c of cases) {
    const draws = c.generation?.draws || [];
    if (!draws.some(d => d.capture_outcome === OUTCOME)) continue;
    for (const d of draws.filter(d => d.capture_outcome === OUTCOME)) {
      if (d.status !== 'unmeasured' || d.mean !== null || d.stddev !== null || !Array.isArray(d.samples) || d.samples.length
        || d.judge_sample_hashes?.length || d.judge_sample_evidence?.length || d.judge_usage
        || !/^[a-f0-9]{64}$/.test(d.generation_hash || '') || d.reason !== REASON) return 'A fake tool call must be an unjudged, unmeasured answer with its hash and reason.';
    }
    const actual = require('./sampling').acrossDraws(draws);
    for (const k of ['n_drawn', 'n_measured', 'n_unmeasured', 'mean']) {
      if (c.generation[k] !== actual[k]) return 'A fake tool call changed the arm count or mean.';
    }
    if (actual.n_measured && c.mean !== actual.mean) return 'The case mean includes a fake tool call.';
    if (!actual.n_measured && c.case_status !== 'failed_unmeasured') return 'An all-fake arm cannot be measured.';
  }
  return null;
}
module.exports = { textFakeToolCall, fakeToolCallCounts, fakeToolCallWarning, fakeToolCallLines, fakeToolCallProblem };
