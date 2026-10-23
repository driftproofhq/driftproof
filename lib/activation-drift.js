// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 437: a separate, declared, count-only receipt. No provider or routing path.
const fs = require('node:fs');
const path = require('node:path');
const { canonicalize } = require('./canonical');
const { sealReceipt, verifyReceiptHash, validateReceipt } = require('./receipt');
const { resolveCount } = require('./counts');
const { IMPORT_METHOD } = require('./importers');

const MiB = 1024 * 1024;
const RECEIPT_LIMITS = { bytes: 16 * MiB, nodes: 200000, depth: 32 };
const CONTEXT_LIMITS = { bytes: MiB, nodes: 50000, depth: 32 };
const ENVELOPE_LIMITS = { bytes: 48 * MiB, nodes: 1000000, depth: 40 };
const POLICY = { method: 'recorded-fired-rate/1', minimum_runs: 20 };
const LIMITATIONS = [
  'Declared external evidence; fixed setup is operator-declared.',
  'Recorded firing rates do not establish persistence, cause or answer quality.',
];
const HASH = /^[a-f0-9]{64}$/;
const refuse = reason => { throw new Error(reason); };
const own = (x, k) => Object.hasOwn(x, k);
const sorted = xs => [...xs].sort();
const copy = x => JSON.parse(canonicalize(x));

// Iterative traversal before recursive canonicalization, hash or schema reads.
// Count the exact JSON bytes without constructing the full serialized envelope.
function bounded(value, limits) {
  const stack = [[value, 0, false]], ancestors = new Set();
  let nodes = 0, bytes = 0;
  const size = v => Buffer.byteLength(JSON.stringify(v));
  while (stack.length) {
    const [v, depth, leaving] = stack.pop();
    if (leaving) { ancestors.delete(v); continue; }
    if (++nodes > limits.nodes || depth > limits.depth) refuse('activation JSON node or depth limit exceeded');
    if (v !== null && typeof v === 'object') {
      if (ancestors.has(v)) refuse('activation JSON cycle refused');
      const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
      if (!array && proto !== Object.prototype && proto !== null) refuse('activation input must contain plain JSON objects');
      const keys = Object.keys(v);
      if (keys.length > 10000 || (array && (v.length > 10000 || keys.length !== v.length))) refuse('activation JSON container limit exceeded');
      ancestors.add(v); stack.push([v, depth, true]); bytes += 2 + Math.max(0, keys.length - 1);
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i], d = Object.getOwnPropertyDescriptor(v, key);
        if (!d || !own(d, 'value')) refuse('activation JSON accessor refused');
        if (array && key !== String(i)) refuse('activation JSON array properties refused');
        if (key.length > 16384) refuse('activation JSON text limit exceeded');
        if (!array) bytes += size(key) + 1;
        stack.push([d.value, depth + 1, false]);
      }
    } else {
      if (typeof v === 'string' && v.length > 16384) refuse('activation JSON text limit exceeded');
      if (!(v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) refuse('activation input must contain finite JSON values');
      bytes += size(v);
    }
    if (bytes > limits.bytes) refuse('activation JSON byte limit exceeded');
  }
}
function keys(value, wanted, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || sorted(Object.keys(value)).join(',') !== sorted(wanted).join(',')) refuse('invalid ' + name + ' fields');
}
function known(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && value.trim().toLowerCase() !== 'unknown'; }
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) refuse('a valid UTC date is required');
  const t = Date.parse(value);
  const normalized = value.includes('.') ? value.replace(/\.(\d+)Z$/, (_, f) => '.' + f.padEnd(3, '0') + 'Z') : value.replace(/Z$/, '.000Z');
  if (!Number.isFinite(t) || new Date(t).toISOString() !== normalized) refuse('a valid UTC calendar date is required');
  return t;
}
function inputRows(receipt) {
  if (!receipt || !HASH.test(receipt.receipt_hash || '') || !verifyReceiptHash(receipt)) refuse('input receipt_hash does not verify');
  if (!validateReceipt(receipt).valid) refuse('input receipt does not validate against its schema');
  const imp = receipt.run.import;
  if (receipt.verification_level !== 'DECLARED' || receipt.run.surface !== 'external' || receipt.run.answered_by?.kind !== 'external' || receipt.run.source !== 'imported/claude-plugin-eval' || imp?.tool !== 'claude-plugin-eval' || imp.comparison_method !== IMPORT_METHOD) refuse('a declared external claude-plugin-eval receipt with the current comparison method is required');
  if (!HASH.test(imp.source_sha256 || '')) refuse('input source hash is required');
  if ((imp.notices || []).some(n => /--count-errored-runs/.test(n))) refuse('retained errored runs cannot be compared for activation');
  if (receipt.skill.unit !== 'plugin' || !known(receipt.skill.name) || !known(receipt.skill.version)) refuse('known plugin name, version and unit are required');
  if (!known(receipt.run.model_id) || receipt.run.harness?.name !== 'claude-code' || !known(receipt.run.harness.version)) refuse('known model and claude-code runtime are required');
  instant(receipt.run.date_utc);
  const rows = new Map(), pairs = new Set();
  for (const [i, row] of receipt.results.cases.entries()) {
    const pair = JSON.stringify([row.id, row.mode]);
    if (pairs.has(pair)) refuse('duplicate input case row'); pairs.add(pair);
    if (row.mode !== 'with_skill') continue;
    if (!known(row.id)) refuse('a bounded case identity is required');
    const admitted = row.samples?.length || 0, recorded = resolveCount(receipt, i, 'generations_per_arm');
    if (recorded !== null && recorded !== admitted) refuse('admitted sample and generation counts disagree');
    const indicators = new Map();
    for (const a of row.activation || []) {
      if (!known(a.indicator) || indicators.has(a.indicator)) refuse('invalid or duplicate activation indicator');
      if (!Number.isSafeInteger(a.fired) || !Number.isSafeInteger(a.runs) || a.fired < 0 || a.runs < a.fired || a.runs > admitted) refuse('invalid activation observation counts');
      indicators.set(a.indicator, a);
    }
    const excluded = row.excluded_draws || [];
    if (new Set(excluded.map(d => d.draw_index)).size !== excluded.length) refuse('duplicate excluded draw');
    rows.set(row.id, { admitted, excluded: excluded.length, indicators });
  }
  return rows;
}
function inventoryOf(context, before, after) {
  if (!Array.isArray(context.inventory) || !context.inventory.length || context.inventory.length > 1000) refuse('a bounded declared case and indicator inventory is required');
  const seen = new Set(); let count = 0;
  const inventory = context.inventory.map(item => {
    keys(item, ['id', 'indicators'], 'inventory case');
    if (!known(item.id) || seen.has(item.id) || !Array.isArray(item.indicators) || !item.indicators.length || item.indicators.length > 100) refuse('invalid or duplicate inventory case');
    seen.add(item.id);
    if (item.indicators.some(x => !known(x)) || new Set(item.indicators).size !== item.indicators.length) refuse('invalid or duplicate inventory indicator');
    count += item.indicators.length;
    return { id: item.id, indicators: sorted(item.indicators) };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (count > 10000 || canonicalize(sorted(seen)) !== canonicalize(sorted(before.keys())) || canonicalize(sorted(seen)) !== canonicalize(sorted(after.keys()))) refuse('inventory must cover both full case sets');
  for (const item of inventory) for (const side of [before, after]) {
    for (const name of side.get(item.id).indicators.keys()) if (!item.indicators.includes(name)) refuse('observed indicator is absent from the declared inventory');
  }
  return inventory;
}
function observation(row, indicator) {
  const a = row.indicators.get(indicator), runs = a?.runs || 0;
  return { fired: runs ? a.fired : null, runs, rate: runs ? a.fired / runs : null,
    admitted_runs: row.admitted, unobserved_runs: row.admitted - runs, excluded_runs: row.excluded };
}
function buildActivationDrift(input) {
  bounded(input, ENVELOPE_LIMITS);
  keys(input, ['before', 'after', 'context', 'issuedAt'], 'activation request');
  const { before, after, context, issuedAt } = input;
  bounded(before, RECEIPT_LIMITS); bounded(after, RECEIPT_LIMITS); bounded(context, CONTEXT_LIMITS);
  keys(context, ['axis', 'before', 'after', 'inventory'], 'activation context');
  for (const side of ['before', 'after']) {
    keys(context[side], ['receipt_hash', 'plugin_sha256', 'suite_sha256', 'environment_sha256'], 'context binding');
    if (context[side].receipt_hash !== input[side].receipt_hash) refuse('context receipt binding does not match');
    for (const name of ['plugin_sha256', 'suite_sha256', 'environment_sha256']) {
      const x = context[side][name];
      if (typeof x !== 'string' || !HASH.test(x) || /^0+$/.test(x) || x !== context.before[name]) refuse('fixed subject and setup fingerprints must be known and equal');
    }
  }
  const a = inputRows(before), b = inputRows(after);
  for (const key of ['name', 'version', 'unit']) if (before.skill[key] !== after.skill[key]) refuse('plugin identity changed');
  const inventory = inventoryOf(context, a, b);
  const sameModel = before.run.model_id === after.run.model_id, sameRuntime = before.run.harness.version === after.run.harness.version;
  if (!(context.axis === 'model' && !sameModel && sameRuntime) && !(context.axis === 'runtime' && sameModel && !sameRuntime)) refuse('exactly the declared model or runtime version axis must change');
  if (!(instant(before.run.date_utc) < instant(after.run.date_utc)) || instant(issuedAt) < instant(after.run.date_utc)) refuse('source chronology and issue date must agree');
  const rows = inventory.flatMap(item => item.indicators.map(indicator => {
    const first = observation(a.get(item.id), indicator), second = observation(b.get(item.id), indicator);
    const sufficiency = !first.runs || !second.runs ? 'unobserved' : Math.min(first.runs, second.runs) < POLICY.minimum_runs ? 'too_few_runs' : 'recorded_comparison';
    return { id: item.id, indicator, before: first, after: second,
      delta_percentage_points: first.rate === null || second.rate === null ? null : 100 * (second.rate - first.rate), sufficiency,
      message: sufficiency === 'unobserved' ? 'No activation observation on one or both versions.' : sufficiency === 'too_few_runs' ? 'Too few recorded runs for this reporting policy.' : 'Recorded comparison only.' };
  }));
  const result = { kind: 'activation-drift', schema_version: '1.0', verification_level: 'DECLARED', issued_at: issuedAt,
    context: { ...copy(context), inventory }, evidence: { before: copy(before), after: copy(after) },
    policy: { ...POLICY }, rows, limitations: [...LIMITATIONS] };
  bounded(result, ENVELOPE_LIMITS);
  return sealReceipt(result);
}
function checked(receipt) {
  bounded(receipt, ENVELOPE_LIMITS);
  // The builder repeats bounds for each embedded input before any hash read.
  const rebuilt = buildActivationDrift({ before: receipt.evidence?.before, after: receipt.evidence?.after, context: receipt.context, issuedAt: receipt.issued_at });
  if (canonicalize(receipt) !== canonicalize(rebuilt)) refuse('activation receipt hash, invariants or derived fields do not verify');
  return rebuilt;
}
function display(value) {
  const json = JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return '<code>' + Array.from(json, c => '&#x' + c.codePointAt(0).toString(16) + ';').join('') + '</code>';
}
function artifactName(receipt) { return 'activation-drift-' + receipt.receipt_hash + '.json'; }
function renderActivationDrift(receipt) {
  const r = checked(receipt), name = artifactName(r), skill = r.evidence.before.skill;
  const lines = ['# Activation drift receipt', '', 'Plugin name: ' + display(skill.name), 'Plugin version: ' + display(skill.version), 'Plugin unit: ' + display(skill.unit),
    'Receipt hash: ' + r.receipt_hash, 'JSON artefact: [' + name + '](' + name + ')', 'Issued at: ' + r.issued_at, 'Axis: ' + r.context.axis];
  for (const [key, label] of [['before', 'Before'], ['after', 'After']]) {
    const run = r.evidence[key].run;
    lines.push(label + ' model: ' + display(run.model_id), label + ' runtime: ' + display(run.harness.version), label + ' run date: ' + run.date_utc);
  }
  lines.push('', ...r.limitations, 'Reporting policy: at least 20 observed runs per version; descriptive comparison only.');
  r.rows.forEach((row, index) => {
    lines.push('', '## Observation ' + (index + 1), 'Case: ' + display(row.id), 'Indicator: ' + display(row.indicator));
    for (const [key, label] of [['before', 'Before'], ['after', 'After']]) {
      const a = row[key];
      lines.push(label + ' fired/runs: ' + (a.fired === null ? 'unknown' : a.fired) + '/' + a.runs,
        label + ' rate: ' + (a.rate === null ? 'unknown' : (100 * a.rate).toFixed(2) + '%'),
        label + ' admitted runs: ' + a.admitted_runs, label + ' unobserved runs: ' + a.unobserved_runs, label + ' excluded runs: ' + a.excluded_runs);
    }
    lines.push('Change (percentage points): ' + (row.delta_percentage_points === null ? 'unknown' : row.delta_percentage_points.toFixed(2)), 'Reading: ' + row.message);
  });
  return lines.join('\n') + '\n';
}
function serializeActivationDrift(receipt) { return canonicalize(checked(receipt)) + '\n'; }
function readActivationInput(file, kind = 'receipt') {
  const limits = kind === 'context' ? CONTEXT_LIMITS : kind === 'envelope' ? ENVELOPE_LIMITS : RECEIPT_LIMITS;
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.size > limits.bytes) refuse('activation input must be a bounded regular file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limits.bytes) refuse('activation input must be a bounded regular file');
    const buffer = Buffer.alloc(limits.bytes + 1); let n = 0, got;
    while (n < buffer.length && (got = fs.readSync(fd, buffer, n, buffer.length - n, null)) > 0) n += got;
    if (n > limits.bytes) refuse('activation file byte limit exceeded');
    const data = JSON.parse(buffer.subarray(0, n).toString('utf8'));
    bounded(data, limits); return data;
  } finally { fs.closeSync(fd); }
}
function writeActivationDrift(receipt, directory) {
  // Complete validation and serialization precede all output filesystem writes.
  const json = serializeActivationDrift(receipt), summary = renderActivationDrift(receipt);
  const name = artifactName(receipt), names = [name, name.replace(/\.json$/, '.summary.md')];
  const created = [], descriptors = [];
  fs.mkdirSync(directory, { recursive: true });
  try {
    for (const name of names) {
      const file = path.join(directory, name), fd = fs.openSync(file, 'wx');
      created.push(file); descriptors.push(fd);
    }
    fs.writeFileSync(descriptors[0], json, 'utf8'); fs.writeFileSync(descriptors[1], summary, 'utf8');
    for (const fd of descriptors) fs.closeSync(fd);
    descriptors.length = 0;
    return names;
  } catch (error) {
    for (const fd of descriptors) { try { fs.closeSync(fd); } catch (_) { /* already closed */ } }
    for (const file of created) fs.unlinkSync(file);
    throw error;
  }
}
module.exports = { buildActivationDrift, renderActivationDrift, serializeActivationDrift, readActivationInput, writeActivationDrift };
