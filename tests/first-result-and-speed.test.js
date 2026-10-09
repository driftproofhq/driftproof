// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 173: the "Up to date?" row reads the skill, model and judge from the receipt when
// no flag gives them (S-5), the small full run on offer after a quick run, and a few calls at once
// (item 24).
//
//   node --test tests/first-result-and-speed.test.js
//
// No model is called. A receipt here is a stub run's (DRIFTPROOF_STUB=1), made by this checkout's
// bin/driftproof in a folder under the system temp directory, removed after.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const MODEL = 'claude-haiku-4-5';
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec173-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^SOURCE_DATE_EPOCH$/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, DRIFTPROOF_STUB: '1', ...extra };
}
function skillIn(dir, name, cases) {
  const d = path.join(dir, name);
  fs.mkdirSync(path.join(d, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\nversion: 1.0.0\n---\n\n# ${name}\n\nAnswer in one short sentence.\n`);
  fs.writeFileSync(path.join(d, 'evals', 'evals.json'), JSON.stringify({ cases: Array.from({ length: cases }, (_, i) => ({ id: `c${i + 1}`, prompt: `Question ${i + 1}?`, rubric: 'One short sentence scores 0.80.' })) }));
  return d;
}
function stubRun(dir, skill, args) {
  const out = path.join(dir, `out-${made.length}-${Math.random().toString(36).slice(2, 8)}`);
  const r = spawnSync(process.execPath, [BIN, 'run', skill, '--models', MODEL, ...args, '--out', out], { cwd: dir, env: cleanEnv(), encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const files = fs.readdirSync(out).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1);
  return { out, file: path.join(out, files[0]), receipt: JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8')) };
}

// ── S-5 ──────────────────────────────────────────────────────────────────────────────────────────
test('S-5: with fromReceipt the skill, model and judge are the receipt\'s own, and named; without it they stay unknown', () => {
  const { staleReport } = require('../lib/stale');
  const dir = tmp();
  const { file } = stubRun(dir, skillIn(dir, 'fx', 1), ['--samples', '1']);
  const axis = (doc, a) => doc.receipts[0].axes.find((x) => x.axis === a);
  const own = staleReport([file], { fromReceipt: true, noHarnessCheck: true });
  for (const a of ['model', 'judge_model', 'skill', 'suite', 'rubric']) assert.equal(axis(own, a).effect, 'current', `${a}: ${axis(own, a).reason}`);
  assert.deepEqual([...own.receipts[0].taken].sort(), ['judge', 'model', 'skill']);
  const bare = staleReport([file], { noHarnessCheck: true });
  assert.equal(axis(bare, 'model').effect, 'unknown');
  assert.match(axis(bare, 'model').reason, /no --model given/);
  assert.match(axis(bare, 'skill').reason, /no --skill given/);
  assert.ok(!('taken' in bare.receipts[0]), 'driftproof stale\'s output gains no field');
  // A flag still wins.
  const other = staleReport([file], { fromReceipt: true, noHarnessCheck: true, model: 'claude-sonnet-5' });
  assert.equal(axis(other, 'model').effect, 'rerun');
  assert.deepEqual([...other.receipts[0].taken].sort(), ['judge', 'skill']);
});

test('S-5: an up-to-date row says which of the skill, model and judge it took from the receipt', () => {
  const { staleLine } = require('../lib/view');
  assert.equal(staleLine({ status: 'current', taken: ['model', 'judge', 'skill'], advisories: [] }).text, 'Up to date, by the stale check, taking the skill, model and judge from this receipt (no --skill, --model or --judge given).');
  assert.equal(staleLine({ status: 'current', taken: ['model'], advisories: [] }).text, 'Up to date, by the stale check, taking the model from this receipt (no --model given).');
  assert.equal(staleLine({ status: 'current', taken: ['judge', 'model'], advisories: [] }).text, 'Up to date, by the stale check, taking the model and judge from this receipt (no --model or --judge given).');
  assert.equal(staleLine({ status: 'current', advisories: [] }).text, 'Up to date, by the stale check.');
});

// ── the small full run, on offer ─────────────────────────────────────────────────────────────────
test('the offer: the calls at the fewest and the most draws, from projectCalls, and the time scaled by the calls', () => {
  const { fullRunOffer, fullRunLine, FULL } = require('../lib/firstrun');
  const { projectCalls } = require('../lib/run');
  const { SAMPLING } = require('../lib/sampling');
  const { DEFAULT_JUDGE_SAMPLES } = require('../config');
  const draw = { judge_sample_hashes: ['a', 'b'] };
  const receipt = {
    suite: { case_count: 7 },
    run: { generated_at: '2026-10-09T00:00:00.000Z', date_utc: '2026-10-09T00:01:00.000Z' },
    results: { cases: [{ id: 'c1', generation: { draws: [draw, draw, draw] } }, { id: 'c1', generation: { draws: [draw, draw, draw] } }] },
  };
  const o = fullRunOffer(receipt);
  assert.equal(o.tasks, FULL.maxCases, 'at most FULL.maxCases test tasks');
  assert.deepEqual(o.calls, [projectCalls(FULL.maxCases, DEFAULT_JUDGE_SAMPLES, SAMPLING.min), projectCalls(FULL.maxCases, DEFAULT_JUDGE_SAMPLES, SAMPLING.max)]);
  // Six draws of three calls each took a minute: 18 calls, so each call is 60000 / 18 ms.
  assert.deepEqual(o.ms, o.calls.map((n) => (60000 / 18) * n));
  const line = fullRunLine(o);
  assert.match(line, /^ {2}offer: /);
  assert.ok(line.includes(`makes ${o.calls[0]} to ${o.calls[1]} calls`), line);
  assert.ok(line.includes(`--concurrency ${FULL.concurrency}`), line);
  assert.match(line, /Too few test tasks to tell/);
  const none = fullRunOffer({ ...receipt, run: {} });
  assert.equal(none.ms, null, 'no start time, no time');
  assert.match(fullRunLine(none), /records no start time/);
});

test('driftproof view offers the full run after a quick run, and not once a newer full run is beside it', () => {
  const dir = tmp();
  const sk = skillIn(dir, 'fx', 2);
  const quick = stubRun(dir, sk, ['--quick']);
  const view = (folder) => spawnSync(process.execPath, [BIN, 'view', folder, '--out', path.join(dir, `v${Math.random().toString(36).slice(2, 8)}.html`), '--no-harness-check'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  const a = view(quick.out);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout.split('\n').filter((l) => /^ {2}offer: /.test(l)).length, 1, a.stdout);
  const full = spawnSync(process.execPath, [BIN, 'run', sk, '--models', MODEL, '--samples', '1', '--out', quick.out], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(full.status, 0, full.stderr);
  const b = view(quick.out);
  assert.equal(b.status, 0, b.stderr);
  assert.doesNotMatch(b.stdout, /^ {2}offer: /m);
});

test('start.md runs the full run at lib/firstrun.js FULL in place of the quick run, and the door takes --full', () => {
  const { FULL } = require('../lib/firstrun');
  const md = fs.readFileSync(path.join(ROOT, 'plugin', 'driftproof', 'commands', 'start.md'), 'utf8');
  const steps = JSON.parse(/```driftproof-steps\n([\s\S]*?)\n```/.exec(md)[1]);
  const full = steps.find((s) => s.op === 'cli' && s.when === 'full');
  const quick = steps.find((s) => s.op === 'cli' && s.unless === 'full');
  assert.ok(full && quick, 'a full step and a quick step');
  assert.ok(quick.args.includes('--quick') && !full.args.includes('--quick'));
  const val = (k) => full.args[full.args.indexOf(k) + 1];
  assert.equal(val('--max-cases'), String(FULL.maxCases));
  assert.equal(val('--concurrency'), String(FULL.concurrency));
  assert.ok(!full.args.includes('--samples'), 'the normal judge samples');
  assert.equal(full.args[full.args.length - 1], '--trusted-skill');
  assert.match(md.replace(/\s+/g, ' '), /Never give `--full` on your own/);
});

test('the door\'s start --full spawns the version probe, the full run and the view, through spec 028\'s fakes', () => {
  const root = tmp();
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  skillIn(work, 'my-skill', 2);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['xdg-open', 'open']) fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\n`, { mode: 0o755 });
  spawnSync('git', ['init', '-q'], { cwd: work });
  const log = path.join(root, 'spawns.ndjson');
  const env = cleanEnv({
    PATH: [bin, path.join(ROOT, 'specs', '028-claude-code-plugin', 'probes', 'bin'), path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    SPEC028_ROOT: ROOT, SPEC028_SPAWNLOG: log, GIT_CEILING_DIRECTORIES: root,
  });
  for (const k of Object.keys(env)) if (/^GIT_(?!CEILING)/.test(k)) delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'plugin', 'driftproof', 'lib', 'door.mjs'), 'start', 'my-skill', '--full'], { cwd: work, env, encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 0, r.stderr);
  const npx = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((s) => s.bin === 'npx').map((s) => s.argv.slice(1));
  assert.deepEqual(npx.map((v) => v[0]), ['--version', 'run', 'view']);
  const run = npx[1];
  assert.ok(!run.includes('--quick') && run.includes('--max-cases') && run.includes('--concurrency'), JSON.stringify(run));
});

test('a sheet in the words "Too few test tasks to tell" carries the note on what gives a clearer answer', () => {
  const { listReceipts, sealReceipt } = require('../lib/receipt');
  const { receiptVerdict } = require('../lib/verdict');
  const { acrossDraws } = require('../lib/sampling');
  const { plainOf } = require('../lib/plain');
  const { renderView } = require('../lib/view');
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(path.join(d, e.name));
    for (const x of listReceipts(d)) if (x.receipt) found.push(x.receipt);
  })(path.join(ROOT, 'receipts', 'report-013'));
  const r = structuredClone(found.find((x) => receiptVerdict(x).verdict === 'PASSED'));
  const CASES = [[0.3, 0.3], [0.6, 0.6], [0.72, 0.72]];
  const first = r.results.cases.filter((c) => c.id === r.results.cases[0].id);
  r.results.cases = CASES.flatMap(([w, b], i) => first.map((row) => {
    const c = structuredClone(row);
    const t0 = c.generation.draws[0];
    const x = c.mode === 'with_skill' ? w : b;
    const draws = [x, x, x].map((s, j) => ({ ...t0, draw_index: j, status: 'measured', samples: [s], judge_sample_hashes: (t0.judge_sample_hashes || []).slice(0, 1), mean: s, stddev: 0, truncated: false }));
    const a = acrossDraws(draws);
    c.id = `c${i + 1}`;
    c.generation = { ...c.generation, draws, n_drawn: a.n_drawn, n_measured: a.n_measured, n_unmeasured: a.n_unmeasured, mean: a.mean, sd: a.sd, judge_sd_mean: a.judge_sd_mean, variance_ratio: a.variance_ratio, variance_ratio_unavailable: a.variance_ratio_unavailable, n_truncated: 0 };
    if (typeof c.mean === 'number') c.mean = a.mean;
    if (typeof c.score === 'number') c.score = a.mean;
    return c;
  }));
  r.suite = { ...r.suite, case_count: CASES.length };
  r.comparison = { ...r.comparison, with_skill_score: 0.54, baseline_score: 0.54, delta: 0 };
  sealReceipt(r);
  assert.equal(plainOf(r).words, 'UNDERPOWERED_CASES');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'r.json'), JSON.stringify(r));
  const { html } = renderView(dir, { stale: { noHarnessCheck: true } });
  const note = /data-field="clearer" data-tasks="(\d+)">([^<]*)</.exec(html);
  assert.ok(note, 'the note is on the sheet');
  assert.equal(Number(note[1]), CASES.length);
  assert.match(note[2], /More test tasks give a clearer answer/);
});

// ── item 24: a few calls at once ─────────────────────────────────────────────────────────────────
test('drawsAtOnce takes the draws short of the minimum at once, one at a time past it, never more than --concurrency', () => {
  const { drawsAtOnce } = require('../lib/run');
  const { SAMPLING, nextAction } = require('../lib/sampling');
  const m = (x) => ({ status: 'measured', mean: x, stddev: 0, samples: [x] });
  const lost = { status: 'unmeasured', mean: null, stddev: null, samples: [] };
  assert.equal(drawsAtOnce([], 4), Math.min(4, SAMPLING.min));
  assert.equal(drawsAtOnce([], 1), 1);
  assert.equal(drawsAtOnce([m(0.5)], 4), Math.min(4, SAMPLING.min - 1));
  assert.equal(drawsAtOnce(Array.from({ length: SAMPLING.min }, (_, i) => m(i % 2 ? 0.2 : 0.8)), 4), 1, 'past the minimum the scores decide');
  // Every draw it takes at once is one the one-at-a-time rule takes, whatever the earlier ones return.
  const ALPHA = [m(0.2), m(0.8), lost];
  let lists = [[]];
  for (let len = 0; len < 6; len++) lists = lists.concat(lists.filter((l) => l.length === len).flatMap((l) => ALPHA.map((a) => [...l, a])));
  for (const D of lists) {
    if (nextAction(D).stop) continue;
    const k = drawsAtOnce(D, 4);
    let ext = [[]];
    for (let i = 1; i < k; i++) ext = ext.flatMap((e) => ALPHA.map((a) => [...e, a]));
    for (const E of ext) for (let j = 1; j < k; j++) assert.ok(!nextAction([...D, ...E.slice(0, j)]).stop, `${D.length} draws, ${k} at once, stopped after ${j}`);
  }
});

test('gradeSamples asks every sample at once and reads them in sample order', async () => {
  const provider = require('../lib/provider');
  const orig = provider.complete;
  const judgePath = require.resolve('../lib/judge');
  let inflight = 0; let most = 0; let i = 0; let script = [];
  provider.complete = async () => {
    const s = script[i++] || 'ok';
    inflight += 1; most = Math.max(most, inflight);
    await new Promise((r) => setTimeout(r, s === 'ok' ? 30 : 5));
    inflight -= 1;
    if (s === 'throw') { const e = new Error('timed out after retries'); e.code = 'TIMEOUT'; e.attempts = 2; throw e; }
    return { text: s === 'prose' ? 'adequate' : JSON.stringify({ score: 0.7, reason: 'r' }), usage: null, attempts: 1, stopReason: 'end_turn' };
  };
  delete require.cache[judgePath];
  try {
    const { gradeSamples } = require('../lib/judge');
    const grade = (s) => { i = 0; most = 0; script = s; return gradeSamples({ task: 't', response: 'r', rubric: 'x', model: MODEL, samples: s.length }); };
    const g = await grade(['ok', 'ok', 'ok', 'ok']);
    assert.equal(most, 4, 'every sample in flight together');
    assert.deepEqual(g.samples, [0.7, 0.7, 0.7, 0.7]);
    const u = await grade(['ok', 'prose', 'ok']);
    assert.equal(u.unmeasured, true);
    assert.equal(u.reason, 'judge output unparseable');
    assert.equal(u.sample_hashes.length, 3, 'every sample that answered is recorded');
    await assert.rejects(grade(['throw', 'prose']), (e) => e.phase === 'judge' && e.judgeAttempts === 3);
    const v = await grade(['prose', 'throw']);
    assert.equal(v.unmeasured, true, 'the first in sample order decides');
  } finally {
    provider.complete = orig;
    delete require.cache[judgePath];
  }
});

test('the stub at --concurrency 1 and 4 writes receipts identical apart from the timings', () => {
  const dir = tmp();
  const sk = skillIn(dir, 'fx', 3);
  const [a, b] = ['1', '4'].map((c) => stubRun(dir, sk, ['--samples', '2', '--concurrency', c]).receipt);
  const timeless = (r) => {
    const x = structuredClone(r);
    delete x.receipt_hash; delete x.run.generated_at; delete x.run.date_utc; delete x.run.pricing_snapshot.frozen_at;
    return x;
  };
  assert.deepEqual(timeless(b), timeless(a));
});

test('the progress line counts every call once when a task\'s draws run together', () => {
  const { createProgress } = require('../lib/progress');
  const { SAMPLING } = require('../lib/sampling');
  const samples = 2;
  const ev = [];
  const arm = (mode) => { for (let d = 0; d < SAMPLING.min; d++) ev.push({ case: 'c1', mode, phase: 'generate', draw: d }); };
  arm('with_skill');
  for (let d = SAMPLING.min - 1; d >= 0; d--) ev.push({ case: 'c1', mode: 'with_skill', phase: 'judge', draw: d });
  ev.push({ case: 'c1', mode: 'with_skill', phase: 'judged', draw: 1 }, { case: 'c1', mode: 'with_skill', phase: 'failed', draw: 0, reason: 'judge gave no score' });
  for (let d = 2; d < SAMPLING.min; d++) ev.push({ case: 'c1', mode: 'with_skill', phase: 'judged', draw: d });
  ev.push({ case: 'c1', mode: 'with_skill', phase: 'done', outcome: 'pass', score: 0.8, stddev: 0 });
  const lines = [];
  const p = createProgress({ cases: 1, samples, now: () => 0, write: (l) => lines.push(l) });
  for (const e of ev) p.onProgress(e);
  assert.equal(p.made(), SAMPLING.min * (1 + samples));
  assert.equal(lines.length, 2 * SAMPLING.min);
  const made = lines.map((l) => Number(/call (\d+) of/.exec(l)[1]));
  assert.deepEqual(made, [...made].sort((x, y) => x - y));
});

test('S-5: driftproof view with no flag reads no "no --model given" on its page', () => {
  const dir = tmp();
  const { out } = stubRun(dir, skillIn(dir, 'fx', 1), ['--samples', '1']);
  const page = path.join(dir, 'view.html');
  const r = spawnSync(process.execPath, [BIN, 'view', out, '--out', page, '--no-harness-check'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(page, 'utf8');
  const row = /data-field="stale" data-status="([^"]*)">([^<]*)</.exec(html);
  assert.ok(row, 'the page carries the row');
  assert.doesNotMatch(row[2], /no --(model|skill|judge) given/);
});
