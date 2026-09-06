// SPDX-License-Identifier: Apache-2.0
'use strict';

const { CHECK_MAX_PATTERN } = require('../config');

// Deterministic post-checks.
//
// A per-case eval suite may declare optional `checks[]`: structural / regex
// assertions on the model OUTPUT that either hold or don't — no LLM judgment.
// They run ALONGSIDE the sampled judge and are reported as a SEPARATE column.
//
// IMPORTANT (scope): post-checks are SUPPLEMENTARY EVIDENCE ONLY. They are NOT
// folded into the case `outcome` or the band-overlap drift verdict — a check is a
// cheap, unambiguous signal ("did the output contain a Conventional-Commits
// subject?") that corroborates or contradicts the judge, not a second grader. A
// suite author adds them where they are natural and in-text-groundable; they are
// never required.
//
// Supported kinds (kept small and unambiguous):
//   regex        — the pattern (with optional `flags`) matches the output
//   contains     — the output includes the literal `value` substring
//   not_contains — the output does NOT include the literal `value` substring
//   min_length   — the trimmed output is at least `value` characters long
//
// BOUNDED (spec 026 AC-13, audit A7). A suite's regex is third-party input
// compiled and run against model output, and JavaScript cannot time a regex
// out. A pattern longer than CHECK_MAX_PATTERN, or one carrying a nested
// quantifier of the (x+)+ family (a quantified group whose body ends in a
// quantifier: the shape that is exponential on every backtracking engine),
// is REFUSED: recorded pass: false with a reason that says so, never
// evaluated. The test is syntactic and narrow by design; it is not a general
// ReDoS detector, and the spec says so.
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}]\)\s*[+*]|\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)\s*[+*]/;
function refusedPattern(pattern) {
  const p = String(pattern == null ? '' : pattern);
  if (p.length > CHECK_MAX_PATTERN) return `refused: pattern of ${p.length} characters exceeds CHECK_MAX_PATTERN (${CHECK_MAX_PATTERN})`;
  if (NESTED_QUANTIFIER.test(p)) return 'refused: pattern carries a nested quantifier of the (x+)+ family, which is exponential to evaluate';
  return null;
}

function runOneCheck(check, output) {
  const text = String(output || '');
  switch (check && check.kind) {
    case 'regex': {
      let re;
      try { re = new RegExp(check.pattern, check.flags || ''); } catch (_e) { return false; }
      return re.test(text);
    }
    case 'contains': return text.includes(String(check.value));
    case 'not_contains': return !text.includes(String(check.value));
    case 'min_length': return text.trim().length >= Number(check.value || 0);
    default: return false;
  }
}

// Run every declared check against one output. Returns a compact result array
// [{ name, kind, pass }] suitable for the receipt (v0.3.1 optional per-case
// `checks`). Empty array when the case declares no checks.
function runChecks(output, checks) {
  if (!Array.isArray(checks) || !checks.length) return [];
  return checks.map((c) => {
    const reason = c && c.kind === 'regex' ? refusedPattern(c.pattern) : null;
    if (reason) return { name: String((c && c.name) || (c && c.kind) || 'check'), kind: c && c.kind, pass: false, reason };
    return {
      name: String((c && c.name) || (c && c.kind) || 'check'),
      kind: c && c.kind,
      pass: !!runOneCheck(c, output),
    };
  });
}

module.exports = { runChecks, runOneCheck, refusedPattern, NESTED_QUANTIFIER };
