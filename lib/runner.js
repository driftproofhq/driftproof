// SPDX-License-Identifier: Apache-2.0
'use strict';

// The run / compare / report-delta / exit-nonzero engine.
//
// PORTED (then fully genericized) from a private behavioral-gate spec. The
// original drove a browser against a product and asserted product-specific
// journeys; ALL of that (endpoints, tenant probes, chrome tokens, journeys) was
// stripped. What remains is the reusable core:
//   - a Gate collects named checks grouped by "section"
//   - each check records { section, name, pass, detail }
//   - summarize() prints a PASS/FAIL line per check and a headline count
//   - toExitCode() gives 0 on all-pass, 1 on any failure
// Scanned clean against the confidentiality deny-list.

// A single collector for one gate run.
class Gate {
  constructor(title = 'gate') {
    this.title = title;
    this.results = [];
    this._section = '?';
  }

  // Start a new named section; subsequent checks are grouped under it.
  section(name) {
    this._section = name;
    return this;
  }

  // Record an assertion. `pass` is coerced to boolean; `detail` is any JSON-able
  // context printed only when the check fails.
  check(name, pass, detail = null) {
    const rec = { section: this._section, name, pass: !!pass, detail: pass ? null : detail };
    this.results.push(rec);
    const tag = rec.pass ? 'PASS' : 'FAIL';
    const suffix = rec.pass ? '' : `  -- ${safeJson(detail)}`;
    // eslint-disable-next-line no-console
    console.log(`  [${tag}] ${name}${suffix}`);
    return rec.pass;
  }

  // Convenience: assert deep equality of two JSON-able values.
  checkEqual(name, actual, expected) {
    const pass = safeJson(actual) === safeJson(expected);
    return this.check(name, pass, { actual, expected });
  }

  get passed() { return this.results.filter((r) => r.pass).length; }
  get failed() { return this.results.filter((r) => !r.pass); }
  get total() { return this.results.length; }

  // Print the headline and per-failure detail. Returns the summary object.
  summarize() {
    const failed = this.failed;
    // eslint-disable-next-line no-console
    console.log(`\n=== ${this.title.toUpperCase()} RESULT: ${this.passed}/${this.total} passed, ${failed.length} failed ===`);
    for (const f of failed) {
      // eslint-disable-next-line no-console
      console.log(`  FAIL [${f.section}] ${f.name}: ${safeJson(f.detail)}`);
    }
    return { title: this.title, total: this.total, passed: this.passed, failed: failed.length, results: this.results };
  }

  toExitCode() {
    return this.failed.length === 0 ? 0 : 1;
  }
}

// Compute the per-item delta between a "before" and "after" map of numeric
// scores, keyed by id. Returns entries with { id, before, after, delta,
// regressed } sorted worst-regression-first. This is the generic report-delta
// primitive the drift report builds on.
function reportDelta(beforeById, afterById, { regressionEpsilon = 0.0 } = {}) {
  const ids = new Set([...Object.keys(beforeById || {}), ...Object.keys(afterById || {})]);
  const rows = [];
  for (const id of ids) {
    const before = num(beforeById && beforeById[id]);
    const after = num(afterById && afterById[id]);
    const delta = (after == null || before == null) ? null : round(after - before);
    const regressed = delta != null && delta < -regressionEpsilon;
    rows.push({ id, before, after, delta, regressed });
  }
  rows.sort((a, b) => {
    // Regressions first, then by magnitude of drop.
    const da = a.delta == null ? 0 : a.delta;
    const db = b.delta == null ? 0 : b.delta;
    return da - db;
  });
  return rows;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : (v == null ? null : Number(v));
}
function round(n) { return Math.round(n * 1e6) / 1e6; }
function safeJson(v) {
  try { return JSON.stringify(v); } catch (_e) { return String(v); }
}

module.exports = { Gate, reportDelta };
