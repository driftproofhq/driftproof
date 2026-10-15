// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 205, spec 188. No execution, receipt writing, clock or harness query.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual, types } = require('node:util');
const { loadSkill, suiteIdentity } = require('./skill');
const { SKILL_MAX_BYTES, DEFAULT_JUDGE_SAMPLES, EFFECT_FLOOR, POWER_Z } = require('../config');
const { assertRegistered } = require('./models');
const { projectCalls } = require('./run');
const { estimateRunCostUSD } = require('./cost');
const { SAMPLING, acrossDraws } = require('./sampling');
const { mean, stddev, round } = require('./stats');
const { validateReceipt, verifyReceiptHash, duplicateCaseRows } = require('./receipt');
const { resolveCount, resolveArm } = require('./counts');
const { judgeSettings, promptTemplateHash, caseRubricHash } = require('./judge');
const { suiteBand, bandDriver, underpoweredLine } = require('./verdict');
const { bandOf } = require('./reuse');

const PLAN_LIMITS = Object.freeze({ fileBytes: 16 * 1024 * 1024, depth: 64,
  receipts: 32, aggregateBytes: 64 * 1024 * 1024, nodes: 200000, records: 100000 });
function refuse(message) { throw Object.assign(new Error('plan refused: ' + message), { code: 'PLAN_REFUSED' }); }
const { receiptAggregatesOnly, AGGREGATES_ONLY_LINE } = require('./verdict');
const MARKED_PRIOR = `a receipt given as a prior carries the mark, ${AGGREGATES_ONLY_LINE}; a plan never turns printed figures into a spread`;
function positive(value, name) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) refuse(name + ' must be a positive safe integer');
  return value;
}
function planOptions(input = {}) {
  if (!input || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input) || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) refuse('options must be plain JSON');
  const keys = new Set(['skill','receipts','samples','draws','lift','model','judgeModel']);
  for (const key of Reflect.ownKeys(input)) {
    const desc = Object.getOwnPropertyDescriptor(input,key);
    if (desc.get || desc.set) refuse('option accessors are not allowed');
    if (!keys.has(key)) refuse('unknown plan option');
  }
  for (const role of ['model','judgeModel']) if (input[role] !== undefined && typeof input[role] !== 'string') refuse(role + ' must be a model string');
  const samples = positive(input.samples === undefined ? DEFAULT_JUDGE_SAMPLES : input.samples, 'samples');
  const draws = positive(input.draws === undefined ? SAMPLING.max : input.draws, 'draws');
  const lift = input.lift === undefined ? EFFECT_FLOOR : input.lift;
  if (typeof lift !== 'number' || !Number.isFinite(lift) || lift <= 0 || lift > 1) refuse('lift must be a finite number in (0, 1]');
  const model = assertRegistered(input.model === undefined ? 'haiku' : input.model, 'model');
  const judgeModel = assertRegistered(input.judgeModel === undefined ? model : input.judgeModel, 'judge model');
  return { samples, draws, lift, model, judgeModel };
}

// Count raw JSON values before parsing, including fields normalization discards.
// Structural paths identify generation and judge arrays. Escaped keys decode
// before comparison, so a spelling such as \u0064raws cannot bypass the bound.
function jsonBounds(text, totals = { nodes: 0, records: 0 }) {
  const stack = [];
  const startValue = () => {
    if (++totals.nodes > PLAN_LIMITS.nodes) refuse('raw JSON nodes exceed aggregate bound');
    const parent = stack.at(-1);
    if (!parent) return [];
    if (parent.recordArray && ++totals.records > PLAN_LIMITS.records) refuse('aggregate raw generation and judge records exceed bound');
    if (parent.type === 'array') return [...parent.path, '*'];
    const p = [...parent.path, parent.key];
    parent.state = 'comma';
    return p;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i], parent = stack.at(-1);
    if (/\s/.test(c)) continue;
    if (c === ':') { if (parent) parent.state = 'value'; continue; }
    if (c === ',') { if (parent && parent.type === 'object') parent.state = 'key'; continue; }
    if (c === '}' || c === ']') { stack.pop(); continue; }
    if (c === '"') {
      const begin = i;
      while (++i < text.length) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
      if (parent && parent.type === 'object' && parent.state === 'key') {
        // The longest structural key has 10 letters, or 60 escaped bytes.
        parent.key = i-begin <= 64 ? JSON.parse(text.slice(begin,i+1)) : '';
        parent.state = 'colon';
      } else startValue();
      continue;
    }
    if (c === '[' || c === '{') {
      const p = startValue(), name = p.join('/');
      if (stack.length + 1 > PLAN_LIMITS.depth) refuse('JSON depth exceeds bound ' + PLAN_LIMITS.depth);
      stack.push({ type:c === '[' ? 'array' : 'object', state:'key', path:p,
        recordArray:c === '[' && (name === 'results/cases/*/generation/draws' || name === 'results/cases/*/generation/draws/*/samples') });
      continue;
    }
    startValue();
    while (i+1 < text.length && !/[\s,\]}]/.test(text[i+1])) i++;
  }
}
function fileSize(file, limit) {
  const st = fs.lstatSync(file);
  if (!st.isFile()) refuse('input must be a regular file, not a link or stream');
  if (st.size > limit) refuse('file bytes exceed bound ' + limit);
  return st.size;
}
function boundedRead(file, limit = PLAN_LIMITS.fileBytes) {
  fileSize(file, limit);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) refuse('input must be a regular file');
    if (st.size > limit) refuse('file bytes exceed bound ' + limit);
    // One extra byte detects growth after fstat without allocating an unbounded buffer.
    const data = Buffer.alloc(st.size + 1);
    let n = 0, got;
    while (n < data.length && (got = fs.readSync(fd, data, n, data.length - n, null)) > 0) n += got;
    if (n > st.size) refuse('file size changed during bounded read');
    return data.subarray(0, n);
  } finally { fs.closeSync(fd); }
}
function loadPlanSkill(dir) {
  if (typeof dir !== 'string' || !dir || /[\x00-\x1f\x7f]/.test(dir)) refuse('skill directory is missing or invalid');
  let bundledBytes = 0;
  return loadSkill(dir, { readFile(file, encoding) {
    const suite = path.relative(path.resolve(dir), file) === path.join('evals', 'evals.json');
    const bytes = boundedRead(file, suite ? PLAN_LIMITS.fileBytes : SKILL_MAX_BYTES - bundledBytes);
    if (!suite) bundledBytes += bytes.length;
    if (!encoding) return bytes;
    const text = bytes.toString(encoding);
    if (suite) jsonBounds(text);
    return text;
  } });
}
function readPlanReceipts(files) {
  if (!Array.isArray(files) || files.length > PLAN_LIMITS.receipts) refuse('receipt count exceeds bound ' + PLAN_LIMITS.receipts);
  let bytes = 0;
  for (const file of files) {
    if (typeof file !== 'string' || !file) refuse('--from needs a receipt file');
    bytes += fileSize(file, PLAN_LIMITS.fileBytes);
    if (bytes > PLAN_LIMITS.aggregateBytes) refuse('aggregate receipt bytes exceed bound ' + PLAN_LIMITS.aggregateBytes);
  }
  let actualBytes = 0;
  const totals = { nodes: 0, records: 0 };
  return files.map((file) => {
    const raw = boundedRead(file);
    actualBytes += raw.length;
    if (actualBytes > PLAN_LIMITS.aggregateBytes) refuse('aggregate receipt bytes exceed bound ' + PLAN_LIMITS.aggregateBytes);
    const text = raw.toString('utf8');
    let parsed;
    try { jsonBounds(text, totals); parsed = JSON.parse(text); } catch (e) {
      if (e.code === 'PLAN_REFUSED') throw e;
      refuse('invalid receipt JSON');
    }
    // Spec 265 AC-48: a marked receipt is refused as it is read.
    if (receiptAggregatesOnly(parsed)) refuse(MARKED_PRIOR);
    return parsed;
  });
}

// Bound parsed library inputs before canonical hashing, schema recursion or cloning.
// Reject accessors without evaluating them. Aliases count again, as JSON serializes them.
function boundObject(value, totals = { nodes: 0, bytes: 0 }, limit = PLAN_LIMITS.fileBytes) {
  let bytes = 0;
  const active = new Set(), stack = [{ value, depth: 0 }];
  const add = (n) => {
    bytes += n; totals.bytes += n;
    if (bytes > limit || totals.bytes > PLAN_LIMITS.aggregateBytes) refuse('JSON bytes exceed per-input or aggregate bound');
  };
  while (stack.length) {
    const item = stack.pop(), v = item.value;
    if (item.exit) { active.delete(v); continue; }
    if (++totals.nodes > PLAN_LIMITS.nodes) refuse('JSON nodes exceed aggregate bound');
    if (typeof v === 'string') {
      if (v.length > limit) refuse('JSON string bytes exceed bound');
      add(Buffer.byteLength(JSON.stringify(v))); continue;
    }
    if (v === null || typeof v === 'boolean' || typeof v === 'number') {
      if (typeof v === 'number' && !Number.isFinite(v)) refuse('JSON number must be finite');
      add(String(v).length); continue;
    }
    // loadSkill's optional fields can be undefined; JSON leaves these out.
    if (v === undefined) continue;
    if (typeof v !== 'object' || types.isProxy(v)) refuse('input must be plain JSON');
    if (item.depth >= PLAN_LIMITS.depth) refuse('JSON depth exceeds bound');
    if (active.has(v)) refuse('JSON cycle is not allowed');
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) refuse('input must be plain JSON');
    if (Array.isArray(v) && v.length > PLAN_LIMITS.nodes) refuse('JSON nodes exceed bound');
    active.add(v); stack.push({ value: v, exit: true }); add(2);
    for (const key of Reflect.ownKeys(v)) {
      if (key === 'length' && Array.isArray(v)) continue;
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (d.get || d.set) refuse('JSON accessors are not allowed');
      if (!d.enumerable) continue;
      if (typeof key !== 'string') refuse('input must be plain JSON');
      if (key.length > limit) refuse('JSON key bytes exceed bound');
      add(Buffer.byteLength(JSON.stringify(key)) + 2);
      stack.push({ value: d.value, depth: item.depth + 1 });
      if (stack.length > PLAN_LIMITS.nodes) refuse('JSON nodes exceed bound');
    }
  }
}
function boundedInputs(skill, receipts) {
  if (!Array.isArray(receipts) || receipts.length > PLAN_LIMITS.receipts) refuse('receipt count exceeds bound');
  boundObject(skill, undefined, SKILL_MAX_BYTES + PLAN_LIMITS.fileBytes);
  const totals = { nodes: 0, bytes: 0 };
  let records = 0;
  for (const r of receipts) {
    boundObject(r, totals);
    for (const c of (r && r.results && r.results.cases) || []) {
      const ds = c.generation && c.generation.draws;
      if (Array.isArray(ds)) {
        records += ds.length;
        for (const d of ds) records += Array.isArray(d.samples) ? d.samples.length : 0;
      }
      if (records > PLAN_LIMITS.records) refuse('aggregate generation and judge records exceed bound');
    }
  }
}

function timestamp(value) {
  if (typeof value !== 'string') refuse('timestamp needs a valid explicitly zoned date');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) refuse('timestamp needs a valid explicitly zoned date');
  const [, ys, ms, ds, hs, mins, secs, , zone] = m;
  const [y, month, day, h, minute, sec] = [ys, ms, ds, hs, mins, secs].map(Number);
  const days = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31,30,31,30,31,31,30,31,30,31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || h > 23 || minute > 59 || sec > 59) refuse('invalid calendar timestamp');
  if (zone !== 'Z' && (Number(zone.slice(1,3)) > 23 || Number(zone.slice(4)) > 59)) refuse('invalid timestamp zone');
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) refuse('invalid timestamp');
  return instant;
}
function chronology(r) {
  timestamp(r.run.date_utc);
  for (const key of ['generated_at','judged_at']) if (r.run[key] != null) timestamp(r.run[key]);
  for (const a of Object.values(r.run.arms || {})) if (a.generated_at != null) timestamp(a.generated_at);
  return [timestamp(r.run.generated_at ?? r.run.date_utc), timestamp(r.run.judged_at ?? r.run.date_utc), r.receipt_hash];
}
function later(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function same(actual, expected, field) {
  if (!isDeepStrictEqual(actual, expected)) refuse('incompatible or inconsistent ' + field);
}
function receiptRows(r, skill, options, lane) {
  if (!verifyReceiptHash(r)) refuse('receipt_hash does not verify');
  const schema = validateReceipt(r);
  if (!schema.valid) refuse('invalid receipt schema: ' + JSON.stringify(schema.errors[0] || {}));
  if (duplicateCaseRows(r).length) refuse('duplicate case rows');
  same(r.skill.content_hash, skill.contentHash, 'skill content hash');
  same(r.suite.suite_hash, skill.suite.suiteHash, 'suite hash');
  same(r.suite.case_count, skill.suite.caseCount, 'suite count');
  same(r.run.model_id, options.model, 'model');
  const j = r.run.judge;
  if (!j) refuse('missing judge provenance');
  const settings = judgeSettings(options.samples, options.judgeModel);
  same(j.model_id, options.judgeModel, 'judge model');
  same(j.prompt_template_hash, promptTemplateHash(), 'judge template');
  same(j.temperature, settings.temperature, 'judge temperature');
  same(j.sampling, settings.sampling, 'judge sampling');
  same(r.run.capture && r.run.capture.mode, 'text', 'capture');
  const synthetic = r.run.answered_by && r.run.answered_by.kind === 'stub';
  if (synthetic) {
    same(r.run.surface, 'stub', 'synthetic generation surface');
    same(j.surface, 'stub', 'synthetic judge surface');
    if (r.run.harness != null) refuse('synthetic harness provenance');
  } else {
    same(r.run.answered_by && r.run.answered_by.kind, 'model', 'model provenance');
    if (!r.run.surface || !j.surface || !r.run.harness || !r.run.harness.name || !r.run.answered_by.isolation) refuse('missing surface harness isolation provenance');
    if (/cli/.test(r.run.surface) && !r.run.harness.version) refuse('missing harness version provenance');
    same(j.surface, settings.surface, 'judge surface');
    if (!j.harness || !j.harness.name || !j.isolation) refuse('missing judge harness isolation provenance');
    if (/cli/.test(j.surface) && !j.harness.version) refuse('missing judge harness version provenance');
  }
  const provenance = { synthetic, surface: r.run.surface, judgeSurface: j.surface,
    harness: r.run.harness || null, isolation: r.run.answered_by && r.run.answered_by.isolation,
    judgeHarness: j.harness || null, judgeIsolation: j.isolation ?? null };
  if (lane.value) same(provenance, lane.value, 'surface harness isolation provenance');
  else lane.value = provenance;
  const current = new Map(skill.suite.cases.map(c => [c.id, c])), rows = new Map();
  r.results.cases.forEach((c, index) => {
    const original = current.get(c.id);
    if (!original) refuse('receipt case is outside current suite');
    same(resolveArm(r,c.mode).model_id, options.model, 'arm model');
    const caseGrade = (required) => {
      if (required || Object.hasOwn(c,'threshold')) same(c.threshold, original.pass_threshold, 'threshold');
      if (required || Object.hasOwn(c,'judge')) {
        same(c.judge && c.judge.model_id, options.judgeModel, 'case judge model');
        same(c.judge && c.judge.rubric_hash, caseRubricHash(original), 'case rubric');
      }
    };
    const recordedBand = c.generation ? bandOf(c) : null;
    const row = { original: c, eligible: false, n: null,
      sd:recordedBand ? recordedBand.sd : null, mean:recordedBand ? recordedBand.mean : null };
    const g = c.generation;
    if (g) {
      if (!Array.isArray(g.draws)) refuse('generation draws are missing');
      const judgeN = resolveCount(r,index,'judge_samples_per_generation');
      same(judgeN, j.samples, 'judge sample count');
      g.draws.forEach((d, i) => {
        same(d.draw_index, i, 'draw index: unique complete ordered indices required');
        if (d.status === 'measured') {
          same(d.samples.length, judgeN, 'draw judge sample count');
          same(d.mean, round(mean(d.samples)), 'draw mean');
          same(d.stddev, round(stddev(d.samples)), 'draw sample spread');
        }
      });
      const a = acrossDraws(g.draws);
      for (const k of Object.keys(a)) same(g[k], a[k], 'generation summary ' + k);
      same(resolveCount(r,index,'generations_per_arm'), a.n_drawn, 'resolved drawn count');
      if (a.n_measured) {
        caseGrade(true);
        same(c.mean, a.mean, 'case mean'); same(c.score, a.mean, 'case score'); same(c.stddev, a.sd, 'case spread');
      } else {
        if (!c.case_status || c.case_status === 'ok') refuse('case with no measured draws must be failed');
        caseGrade(false);
        for (const [key, expected] of [['mean',null],['score',null],['stddev',a.sd]]) if (Object.hasOwn(c,key)) same(c[key],expected,'failed case summary ' + key);
      }
      if (g.n_truncated !== undefined) same(g.n_truncated, g.draws.filter(d => d.truncated).length, 'truncated count');
      const checkedBand = bandOf(c);
      Object.assign(row, { n: a.n_measured, sd: checkedBand ? checkedBand.sd : null, mean: checkedBand ? checkedBand.mean : null,
        eligible: a.n_unmeasured === 0 && a.n_measured >= 2 && (!c.case_status || c.case_status === 'ok') });
    }
    if (!g) caseGrade(!c.case_status || c.case_status === 'ok');
    const pair = rows.get(c.id) || {}; pair[c.mode] = row; rows.set(c.id,pair);
  });
  return { rows, order: chronology(r), hash: r.receipt_hash, samples: j.samples, synthetic };
}

const resolutionAt = (w, b, n) => w + b + POWER_Z * Math.sqrt((w*w + b*b) / n);
// Binary search the actual floating-point reading, rather than trusting algebra
// at a strict boundary. It also bounds work for near-irreducible spreads.
function minimumDraws(w, b, lift) {
  if (lift < EFFECT_FLOOR || w + b >= lift) return { n: null, reason: 'spread' };
  if (!(resolutionAt(w,b,Number.MAX_SAFE_INTEGER) < lift)) return { n: null, reason: 'unrepresentable' };
  let lo = 2, hi = Number.MAX_SAFE_INTEGER;
  while (lo < hi) {
    const mid = lo + Math.floor((hi-lo)/2);
    if (resolutionAt(w,b,mid) < lift) hi = mid;
    else lo = mid+1;
  }
  if (!Number.isSafeInteger(lo) || !(resolutionAt(w,b,lo) < lift) || (lo > 2 && resolutionAt(w,b,lo-1) < lift)) return {n:null,reason:'unrepresentable'};
  return { n: lo, reason: 'draws' };
}
function unknown(id, reason, evidence = null, pair = null) {
  return { id, state:'unknown', reason, resolution:null, limitingLift:null, drawsNeeded:null,
    evidenceHash:evidence ? evidence.hash : null, evidenceSamples:evidence ? evidence.samples : null,
    arms:pair ? {with_skill:{n:pair.with_skill.n,sd:null},baseline:{n:pair.baseline.n,sd:null}} : null };
}
function planSkill(input) {
  if (!input || typeof input !== 'object') refuse('missing skill input');
  // Spec 265 AC-48: printed figures are never a prior; refused before anything else is read.
  for (const r of Array.isArray(input.receipts) ? input.receipts : []) if (receiptAggregatesOnly(r)) refuse(MARKED_PRIOR);
  const options = planOptions(input), { skill } = input, receipts = input.receipts === undefined ? [] : input.receipts;
  boundedInputs(skill, receipts);
  if (!skill || !skill.suite || !skill.suite.cases || !skill.contentHash) refuse('missing skill or suite identity');
  const identity = suiteIdentity({ cases: skill.suite.cases });
  same(skill.suite.suiteHash,identity.suiteHash,'suite identity');
  same(skill.suite.caseCount,identity.cases.length,'suite case count');
  if (!identity.cases.length) refuse('empty suite has no cases');
  for (const c of identity.cases) if (!Number.isFinite(c.pass_threshold) || c.pass_threshold < 0 || c.pass_threshold > 1) refuse('invalid case threshold');
  const caseCount = skill.suite.caseCount;
  const calls = projectCalls(caseCount,options.samples,options.draws);
  if (!Number.isSafeInteger(calls)) refuse('projected call total is not a safe representable integer');
  const cost = structuredClone(estimateRunCostUSD({ caseCount, ...options, models:[options.model] }));
  if (![cost.totalUSD,cost.genUSD,cost.judgeUSD,...cost.perModel.map(p=>p.usd)].every(Number.isFinite)) refuse('cost is not finite');
  const lane = {}, evidence = receipts.map(r => receiptRows(r,skill,options,lane));
  const selectedRows = [];
  const cases = identity.cases.map(c => {
    let selected = null;
    for (const e of evidence) {
      const pair = e.rows.get(c.id);
      if (pair && pair.with_skill && pair.baseline && (!selected || later(e.order,selected.order))) selected = e;
    }
    if (!selected) return unknown(c.id,'no paired generation evidence');
    const pair = selected.rows.get(c.id), w = pair.with_skill, b = pair.baseline;
    if (!w.eligible || !b.eligible) return unknown(c.id,'missing spread: lost, single or legacy draws',selected,pair);
    if (options.draws < 2) return unknown(c.id,'one planned draw cannot establish spread',selected,pair);
    selectedRows.push(w.original,b.original);
    const resolution = resolutionAt(w.sd,b.sd,options.draws);
    const target = minimumDraws(w.sd,b.sd,options.lift);
    return { id:c.id, state:options.lift < EFFECT_FLOOR ? 'unsupported' : resolution >= options.lift ? 'underpowered' : 'resolved',
      reason:options.lift < EFFECT_FLOOR ? 'below_floor' : target.reason, resolution,
      limitingLift:Math.max(EFFECT_FLOOR,resolution), drawsNeeded:target.n,
      evidenceHash:selected.hash, evidenceSamples:selected.samples,
      arms:{ with_skill:{n:w.n,sd:w.sd}, baseline:{n:b.n,sd:b.sd} } };
  });
  const complete = cases.every(c=>c.state !== 'unknown');
  const observed = complete ? suiteBand({results:{cases:selectedRows}},identity.cases) : null;
  // As in the verdict ladder, a case limitation blocks the suite-band rung.
  const suiteLimited = cases.every(c=>c.state === 'resolved') && observed && observed.value >= options.lift;
  const suite = { state:!complete ? 'unknown' : suiteLimited ? 'underpowered' : 'resolved',
    band:observed ? observed.value : null, between:observed ? observed.between : null,
    driver:observed ? bandDriver(observed) : null,
    reason:suiteLimited ? 'suite_band' : null, drawsNeeded:null };
  const state = !complete ? 'unknown' : options.lift < EFFECT_FLOOR ? 'unsupported'
    : cases.some(c=>c.state==='underpowered') || suite.state==='underpowered' ? 'underpowered' : 'resolved';
  const drawsNeeded = complete && options.lift >= EFFECT_FLOOR && suite.state !== 'underpowered' && cases.every(c=>c.drawsNeeded !== null)
    ? Math.max(...cases.map(c=>c.drawsNeeded)) : null;
  return { ...options, caseCount, calls, cost, cases, suite, state, drawsNeeded,
    evidenceKind:!evidence.length ? 'none' : evidence[0].synthetic ? 'synthetic' : 'model',
    provenance:lane.value || null, resolution:complete ? Math.max(...cases.map(c=>c.resolution)) : null };
}

function formatPlan(p) {
  const lines = ['driftproof plan: offline conditional planning',
    `Model ${p.model}; judge ${p.judgeModel}; full suite ${p.caseCount} cases.`,
    `Generation draws per case per arm: ${p.draws}; judge samples per answer: ${p.samples}.`,
    `Requested planning lift ${p.lift}; unchanged verdict effect floor ${EFFECT_FLOOR}.`,
    `Projected calls: ${p.calls} under this policy. Default draws use the runner's adaptive ceiling ${SAMPLING.max}.`,
    `Rough token-assumption USD estimate: $${p.cost.totalUSD.toFixed(4)} (generation $${p.cost.genUSD.toFixed(4)}, judge $${p.cost.judgeUSD.toFixed(4)}). Actual charges can exceed it.`,
    `Fixed tokens per call (input/output): skill generation ${p.cost.assumptions.tokens.gen_with_skill.input}/${p.cost.assumptions.tokens.gen_with_skill.output}, baseline ${p.cost.assumptions.tokens.gen_baseline.input}/${p.cost.assumptions.tokens.gen_baseline.output}, judge ${p.cost.assumptions.tokens.judge.input}/${p.cost.assumptions.tokens.judge.output}.`,
    'Registry API equivalent pricing, not an invoice or subscription billing prediction. Retries and auxiliary calls are excluded.',
    'Spreads held, including when judge samples change. Power is conditional on those measured generation spreads.',
    'Recorded provenance must still hold: surfaces, harness version, isolation and grading identity. This cannot certify currentness offline.',
    'Draw targets are hypothetical; the runner may stop before them, including targets within its adaptive ceiling.',
    'Writes no receipt and moves no verdict. A plan asserts no verdict and promises no next-run result.'];
  if (p.evidenceKind === 'synthetic') lines.push('Synthetic stub evidence only. These figures do not measure model power.');
  if (p.provenance) lines.push('Recorded provenance: ' + JSON.stringify(p.provenance));
  if (p.lift < EFFECT_FLOOR) lines.push('Unsupported request: the planning lift is below the unchanged verdict effect floor. No number of draws changes that rule.');
  for (const c of p.cases) {
    const source = c.evidenceHash ? ` Evidence ${c.evidenceHash}; original judge samples ${c.evidenceSamples}.` : '';
    if (c.state === 'unknown') {
      lines.push(`Case ${JSON.stringify(c.id)}: unknown power (${c.reason}).`+source);
      if (c.arms) lines.push(`  Measured draws with skill ${c.arms.with_skill.n ?? 'unknown'}; baseline ${c.arms.baseline.n ?? 'unknown'}.`);
      continue;
    }
    lines.push(`Case ${JSON.stringify(c.id)}: ${c.state}; resolution ${c.resolution}; limiting lift ${c.limitingLift}.`+source);
    lines.push(`  Measured draws with skill ${c.arms.with_skill.n}, sd ${c.arms.with_skill.sd}; baseline ${c.arms.baseline.n}, sd ${c.arms.baseline.sd}.`);
    if (c.drawsNeeded !== null) lines.push(`  Hypothetical strict minimum generation draws per arm: ${c.drawsNeeded}.` + (c.drawsNeeded > SAMPLING.max ? ' Unavailable beyond the current run policy ceiling.' : ''));
    else lines.push('  No numeric draw target: ' + c.reason + '.');
  }
  if (p.suite.band !== null) lines.push(`Observed full-suite band ${p.suite.band}; between-case part ${p.suite.between}; driver ${p.suite.driver}. This uses original evidence counts, not the planned draws. No numeric suite draw or additional-case target.`);
  // Wording reads the unchanged verdict floor, even at another planning lift.
  const caseLimited = p.cases.some(c=>c.resolution !== null && c.resolution >= EFFECT_FLOOR);
  const suiteLimited = !caseLimited && p.suite.band !== null && p.suite.band >= EFFECT_FLOOR;
  if (caseLimited || suiteLimited) {
    lines.push('Under the unchanged verdict rule: ' + underpoweredLine(suiteLimited ? {reason:p.suite.reason || 'suite_band',driver:p.suite.driver} : null) + '.');
    lines.push('This is a conditional resolution limitation with spreads held, not a verdict about the skill.');
  }
  if (p.cases.some(c=>c.state==='unknown')) {
    lines.push('Power cannot be judged until spread is measured. Measure it cheaply with a real smoke run:');
    lines.push(`driftproof run <skill-dir> --quick --models ${p.model} --judge-model ${p.judgeModel}`);
    lines.push(`driftproof plan <skill-dir> --model ${p.model} --judge-model ${p.judgeModel} --from <receipt.json>`);
  }
  return lines.join('\n') + '\n';
}
module.exports = { PLAN_LIMITS, loadPlanSkill, readPlanReceipts, planOptions, planSkill, formatPlan };
