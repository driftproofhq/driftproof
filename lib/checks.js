// SPDX-License-Identifier: Apache-2.0
'use strict';

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
  return checks.map((c) => ({
    name: String((c && c.name) || (c && c.kind) || 'check'),
    kind: c && c.kind,
    pass: !!runOneCheck(c, output),
  }));
}

module.exports = { runChecks, runOneCheck };
