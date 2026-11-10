// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 729: fixtures never call a model. Plants exercise the same output and
// refusal readers as the positive cases, without changing the working tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const Module = require('node:module');
const F = require('../specs/440-placebo-arm/fixtures');
const { renderSheet, writeSheet } = require('../lib/sheet');
const R = require('../lib/receipt');
const { plainOf } = require('../lib/plain');
const V = require('../lib/verdict');
const { bandOf } = require('../lib/reuse');
const { suiteIdentity } = require('../lib/skill');
const { readSuite } = require('../lib/blind');
const ROOT = path.resolve(__dirname, '..');
const dirs = [];
const tmp = () => { const d = fs.mkdtempSync('/var/tmp/spec729-'); dirs.push(d); return d; };
test.after(() => { F.cleanup(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const decode = value => value.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const field = (html, name) => { const m = new RegExp('data-field="' + name + '"[^>]*>([\\s\\S]*?)</').exec(html); assert.ok(m, name); return decode(m[1]); };
const LIMITS = [
  'This result covers these tasks, this judge and this day.',
  'A judge is a model.',
  'No clear difference is not proof of no effect.',
  "A receipt's hash shows integrity since sealing, not who ran it or that a model ran.",
];
const SAME = "The judge uses the same model as the target. Self-grading may favor its own model's answers.";
const headings = ['The question', 'What we gave the AI', 'What we compared', 'What we found', 'What it cost', 'What this does not show', 'The record', 'Check it yourself'];
let fixture;
async function sample() {
  if (!fixture) fixture = await F.run(F.plans(require('../config').EFFECT_FLOOR).above);
  return structuredClone(fixture.receipt);
}
const save = (dir, name, r) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(r)); return p; };
function cli(args, cwd = ROOT) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^NODE_OPTIONS$/.test(k)));
  return spawnSync(process.execPath, [path.join(ROOT, 'bin/driftproof'), 'sheet', ...args], { cwd, env: { ...env, DRIFTPROOF_STUB: '1' }, encoding: 'utf8', timeout: 1800000 });
}
function load(deps) {
  const filename = path.join(ROOT, 'lib/sheet.js');
  const m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const real = m.require.bind(m); m.require = id => Object.hasOwn(deps, id) ? deps[id] : real(id);
  m._compile(fs.readFileSync(filename, 'utf8'), filename); return m.exports;
}
// Issue 756 (A-729-3): placeboReading's reading in the sheet's plain words, held here apart from the sheet.
const AGAINST = 'Against a same-length placebo: ';
const NOT_READ = 'Not read against the placebo: ';
const PLACEBO_LIMIT = 'Scoring above the placebo is not the same as scoring above no file.';
function placeboWords(r) {
  if (r.reading === 'NOT_MEASURED') {
    if (r.notMeasured.includes('placebo_unverified')) return NOT_READ + 'its record could not be checked.';
    if (r.notMeasured.includes('placebo_cases_differ')) return NOT_READ + 'these tasks could not be paired with it: ' + r.excluded.map(e => e.id).join(', ') + '.';
    return NOT_READ + 'this result was not measured.';
  }
  if (r.reading === 'UNDERPOWERED') return AGAINST + (V.casesDisagree(r.drawsNeeded) ? 'too few test tasks to tell.' : 'too few answers to tell.');
  return AGAINST + ({ ABOVE_PLACEBO: 'at least one task scored above it, and none below.', BELOW_PLACEBO: 'at least one task scored below it.', INCONCLUSIVE: 'inconclusive; it shows no direction.', NO_DIFFERENCE: 'no clear difference on any task.' })[r.reading];
}
function finding(html, r) {
  const p = plainOf(r);
  assert.equal(field(html, 'label'), p.label);
  assert.equal(field(html, 'sentence'), p.sentence);
  if (p.detail) assert.equal(field(html, 'detail'), p.detail);
  if (r.placebo) {
    assert.equal(field(html, 'placebo'), placeboWords(V.placeboReading(r)));
    assert.doesNotMatch(field(html, 'placebo'), /case rule|placebo_|_placebo|NOT_MEASURED|effect floor/);
  }
  if (['UNDERPOWERED', 'INCONCLUSIVE'].includes(p.state)) {
    assert.doesNotMatch(field(html, 'label') + ' ' + field(html, 'sentence'), /helped|hurt|improved|worsened|no clear difference|no effect/i);
  }
}
function limits(html, same = true) {
  const block = /<section[^>]*id="limits"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1];
  assert.ok(block, 'fixed limits section');
  for (const line of LIMITS) assert.ok(block.includes(esc(line)), line);
  assert.equal(block.includes(esc(SAME)), same);
}
function inert(html) {
  for (const token of require('../scripts/html-text').tokenize(html).filter(t => t.type === 'start')) {
    assert.ok(!['script', 'iframe', 'img', 'link', 'object', 'embed', 'base'].includes(token.name), token.name);
    for (const [name] of token.attrs) assert.ok(!name.startsWith('on') && name !== 'src', name);
  }
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] || '';
  assert.doesNotMatch(css, /@import|url\(/i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /driftproof:tokens/);
}

test('AC-2, AC-3: each finding and detail comes from the existing readers', async () => {
  const plans = F.plans(require('../config').EFFECT_FLOOR);
  const receipts = [];
  for (const name of ['above', 'below', 'flat', 'wideBand', 'inconclusive']) receipts.push((await F.run(plans[name])).receipt);
  const under = await F.run({ c1: { S: [0.2, 0.8, 0.5], B: [0.2, 0.8, 0.5], P: [0.2, 0.8, 0.5] } });
  receipts.push(under.receipt);
  assert.ok(receipts.some(r => plainOf(r).state === 'UNDERPOWERED'));
  assert.ok(receipts.some(r => plainOf(r).state === 'INCONCLUSIVE'));
  const stub = await sample(); stub.verification_level = 'UNVERIFIED'; stub.run.surface = 'stub'; stub.run.answered_by.kind = 'stub'; receipts.push(R.sealReceipt(stub));
  for (const r of receipts) {
    assert.equal(R.validateReceipt(r).valid, true);
    const before = JSON.stringify(r), { html } = renderSheet(r);
    finding(html, r); limits(html); inert(html);
    assert.equal(JSON.stringify(r), before, 'rendering never changes or seals the input');
  }
});

test('AC-2, AC-3 plants: changed finding, direction, missing or edited limit read red', async () => {
  const r = (await F.run({ c1: { S: [0.2, 0.8], B: [0.2, 0.8], P: [0.2, 0.8] } })).receipt;
  assert.equal(plainOf(r).state, 'UNDERPOWERED');
  const { html } = renderSheet(r); finding(html, r); limits(html);
  for (const replacement of ['A different finding.', 'The file helped.']) assert.throws(() => finding(html.replace(esc(plainOf(r).sentence), replacement), r), assert.AssertionError);
  for (const line of LIMITS) for (const replacement of ['', 'This proves all workflows work.']) assert.throws(() => limits(html.replace(esc(line), replacement)), assert.AssertionError);
});

test('AC-2, AC-3 (A-729-3): the placebo line is plain, and its limit comes only with a placebo', async () => {
  const plans = F.plans(require('../config').EFFECT_FLOOR);
  const block = html => /<section[^>]*id="limits"[^>]*>([\s\S]*?)<\/section>/.exec(html)[1];
  const seen = new Set();
  for (const name of ['above', 'below', 'flat', 'inconclusive']) {
    const r = (await F.run(plans[name])).receipt, { html } = renderSheet(r);
    seen.add(V.placeboReading(r).reading); finding(html, r);
    assert.ok(block(html).includes(esc(PLACEBO_LIMIT)), name);
  }
  assert.ok(seen.has('ABOVE_PLACEBO') && seen.has('BELOW_PLACEBO'), [...seen].join(' '));
  const broken = await sample(); broken.placebo.sha256 = '0'.repeat(64);
  const unchecked = R.sealReceipt(broken), bad = renderSheet(unchecked).html;
  assert.equal(field(bad, 'placebo'), NOT_READ + 'its record could not be checked.'); finding(bad, unchecked);
  const unpaired = (await F.run(plans.placeboLost)).receipt, reading = V.placeboReading(unpaired);
  assert.ok(reading.notMeasured.includes('placebo_cases_differ'), JSON.stringify(reading));
  const left = renderSheet(unpaired).html; finding(left, unpaired);
  assert.equal(field(left, 'placebo'), NOT_READ + 'these tasks could not be paired with it: c1.');
  const none = (await F.run(plans.above, { placebo: false })).receipt, plain = renderSheet(none).html;
  assert.doesNotMatch(plain, /data-field="placebo"/); assert.ok(!block(plain).includes(esc(PLACEBO_LIMIT)), 'no placebo, no limit');
  const r = await sample(), { html } = renderSheet(r);
  assert.throws(() => finding(html.replace(esc(placeboWords(V.placeboReading(r))), 'case rule: a different reading'), r), assert.AssertionError);
});

test('AC-1: both entry points refuse a broken hash or schema, exit 4 and write nothing', async () => {
  const r = await sample(), dir = tmp();
  for (const bad of [{ ...r, receipt_hash: '0'.repeat(64) }, R.sealReceipt({ ...r, schema_version: 'unknown' })]) {
    assert.throws(() => renderSheet(bad), e => e.exitCode === 4);
    const file = save(dir, 'bad.json', bad), out = path.join(dir, 'out.html');
    assert.throws(() => writeSheet(file, { out }), e => e.exitCode === 4);
    const got = cli([file, '--out', out]); assert.equal(got.status, 4, got.stderr); assert.equal(fs.existsSync(out), false);
    fs.writeFileSync(out, 'preserve this file');
    assert.equal(cli([file, '--out', out]).status, 4); assert.equal(fs.readFileSync(out, 'utf8'), 'preserve this file'); fs.unlinkSync(out);
  }
  const broken = { ...r, receipt_hash: '0'.repeat(64) };
  const planted = load({ './receipt': { ...R, verifyReceiptHash: () => true } });
  assert.throws(() => assert.throws(() => planted.renderSheet(broken), e => e.exitCode === 4), assert.AssertionError, 'hash bypass fails the refusal reader');
});

test('AC-4, AC-5: only matching, explicitly supplied task text appears, fully escaped', async () => {
  const prompt = 'Private task <img src=x onerror="bad()"> & </pre><script>bad()</script>\nKeep this line.';
  const plan = { private: { S: [0.8], B: [0.3], P: [0.3], prompt, criteria: [{ id: 'safe', weight: 2, description: 'Private guide <b>verbatim</b> & full.' }] } };
  const f = await F.run(plan), r = f.receipt;
  const suite = readSuite(path.join(f.skill.dir, 'evals/evals.json'));
  const dir = tmp(), file = save(dir, 'r.json', r), supplied = save(dir, 'suite.json', suite.raw);
  const matched = renderSheet(r, { suite });
  assert.ok(matched.html.includes(esc(prompt)));
  assert.ok(matched.html.includes(esc(plan.private.criteria[0].description)));
  assert.ok(matched.html.includes('Weight: 2')); inert(matched.html);
  assert.doesNotMatch(renderSheet(r).html, /Private task|Private guide/);
  const raw = structuredClone(suite.raw); raw.cases[0].prompt = 'Private mismatched task';
  const mismatched = { ...suite, raw, suiteHash: r.suite.suite_hash };
  const result = renderSheet(r, { suite: mismatched });
  assert.doesNotMatch(result.html, /Private mismatched task|Private guide/);
  assert.match(result.warning, /suite.*hash/); assert.match(result.html, /identified by hash only/);
  const out = path.join(dir, 'out.html');
  const ok = cli([file, '--suite', supplied, '--out', out]); assert.equal(ok.status, 0, ok.stderr); assert.ok(fs.readFileSync(out, 'utf8').includes(esc(prompt)));
  save(dir, 'suite.json', raw);
  const bad = cli([file, '--suite', supplied, '--out', out]); assert.equal(bad.status, 0, bad.stderr); assert.match(bad.stderr, /suite.json/); assert.doesNotMatch(fs.readFileSync(out, 'utf8'), /Private mismatched task|Private guide/);
  const planted = load({ './skill': { ...require('../lib/skill'), suiteIdentity: raw => ({ ...suiteIdentity(raw), suiteHash: r.suite.suite_hash }) } });
  assert.throws(() => assert.doesNotMatch(planted.renderSheet(r, { suite: mismatched }).html, /Private mismatched task/), assert.AssertionError);
  assert.throws(() => inert(matched.html.replace(esc(prompt), prompt)), assert.AssertionError);
  assert.throws(() => inert(matched.html.replace('</body>', '<script>bad()</script></body>')), assert.AssertionError);
});

test('AC-4: rubric aliases and multiline guides stay verbatim; only run task ids appear', async () => {
  const r = await sample();
  const raw = { evals: [{ name: 'c1', input: 'Line one.\n  Line two.', expected: 'Guide one.\n  Guide two.' }, { id: 'not-run', task: 'Private unused task', criteria: 'Unused guide' }] };
  r.suite.suite_hash = suiteIdentity(raw).suiteHash;
  const html = renderSheet(R.sealReceipt(r), { suite: { raw, file: 'evals.json' } }).html;
  assert.ok(html.includes(esc(raw.evals[0].input))); assert.ok(html.includes(esc(raw.evals[0].expected)));
  assert.doesNotMatch(html, /Private unused task|Unused guide/);
});

test('AC-2: aggregates-only carries its line and no bands, including the band plant', () => {
  const src = path.join(ROOT, 'tests/fixtures/nvidia/skills-source');
  const names = fs.readdirSync(path.join(src, 'skills'));
  const r = R.sealReceipt(require('./nvidia-reader').oracle(src, names, { commit: '1'.repeat(40), importedAt: '2026-11-08T00:00:00Z' }).receipts[0].receipt);
  assert.equal(R.validateReceipt(r).valid, true);
  const { html } = renderSheet(r); assert.ok(html.includes(esc(V.AGGREGATES_ONLY_LINE)));
  const noBands = x => assert.doesNotMatch(x, /data-field="bands"| ± /);
  noBands(html); assert.throws(() => noBands(html.replace('</main>', '<table data-field="bands">0.5 ± 0.1</table></main>')), assert.AssertionError);
});

test('AC-6: identity, counts, bands and economics equal the sealed record', async () => {
  const r = await sample(), { html } = renderSheet(r);
  for (const [name, value] of Object.entries({ 'receipt-hash': r.receipt_hash, 'subject-hash': r.skill.content_hash, date: r.run.date_utc, model: r.run.model_id, judge: r.run.judge.model_id, runner: r.run.runner_version, surface: r.run.surface, verification: r.verification_level })) assert.equal(field(html, name), String(value));
  for (const mode of ['with_skill', 'baseline', 'placebo']) {
    const rows = r.results.cases.filter(c => c.mode === mode);
    const drawn = rows.reduce((s, c) => s + c.generation.n_drawn, 0);
    const measured = rows.reduce((s, c) => s + c.generation.n_measured, 0);
    assert.equal(field(html, 'draws-' + mode), drawn + ' drawn; ' + measured + ' measured');
    for (const row of rows.filter(c => c.mode !== 'placebo')) { const b = bandOf(row); assert.ok(html.includes(b.mean.toFixed(3) + ' ± ' + b.sd.toFixed(3))); }
  }
  assert.equal(field(html, 'cost-basis'), r.economics.basis);
  for (const mode of ['with_skill', 'baseline']) {
    for (const key of ['call_count', 'mean_input_tokens', 'mean_output_tokens', 'mean_cost_usd_per_call']) assert.equal(field(html, 'cost-' + mode + '-' + key), String(r.economics[mode][key]));
  }
  assert.match(html, /Grading excluded/);
  const oracle = x => assert.equal(field(x, 'draws-with_skill'), field(html, 'draws-with_skill'));
  assert.throws(() => oracle(html.replace(/(data-field="draws-with_skill">)[^<]*/, '$1999 drawn; 999 measured')), assert.AssertionError);
});

test('AC-6: missing economics and harness never turn into zero; other judge is disclosed', async () => {
  const r = await sample(); delete r.economics; delete r.run.harness; r.run.judge.model_id = 'a-different-judge';
  const { html } = renderSheet(R.sealReceipt(r));
  assert.match(html, /data-field="cost"[^>]*>not recorded</);
  assert.equal(field(html, 'harness'), 'not recorded'); limits(html, false);
});

test('AC-7, AC-8: fixed heading order, validation command, conditional link, paths and safe overwrite', async () => {
  const r = await sample(), dir = tmp(), file = save(dir, 'result.json', r);
  const got = cli(['result.json'], dir); assert.equal(got.status, 0, got.stderr);
  const out = path.join(dir, 'result.sheet.html'); assert.ok(got.stdout.includes('result.sheet.html'));
  const html = fs.readFileSync(out, 'utf8');
  assert.deepEqual([...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].slice(0, 8).map(m => m[1]), headings);
  assert.equal(field(html, 'validate'), 'driftproof validate result.json');
  assert.ok(html.includes('https://driftproofhq.com/r/' + r.receipt_hash + '/')); assert.match(html, /If this receipt is published/);
  assert.equal(cli([file, '--out', out]).status, 0);
  assert.equal(fs.readFileSync(out, 'utf8'), html, 'deterministic rendering');
  assert.equal(cli([file, '--out', file]).status, 2); assert.equal(JSON.parse(fs.readFileSync(file)).receipt_hash, r.receipt_hash);
  const unrelated = path.join(dir, 'other.html'); fs.writeFileSync(unrelated, 'keep');
  assert.equal(cli([file, '--out', unrelated]).status, 2); assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep');
  const link = path.join(dir, 'linked.html'); fs.symlinkSync(out, link); assert.equal(cli([file, '--out', link]).status, 2);
  for (const args of [[], [file, file], [file, '--wat'], [file, '--out'], [file, '--suite'], [file, '--out', out, '--out', out]]) assert.equal(cli(args).status, 2, args.join(' '));
  assert.equal(cli(['--help']).status, 0);
});

test('AC-5, AC-7: browser opens offline; page 1 holds result and limits on A4 and Letter, long text continues', async () => {
  const r = await sample(), raw = { cases: [{ id: 'c1', prompt: 'Long task line.\n'.repeat(220), rubric: 'Full scoring guide.\n'.repeat(150) }] };
  r.suite.suite_hash = suiteIdentity(raw).suiteHash;
  const { html } = renderSheet(R.sealReceipt(r), { suite: { raw, file: 'evals.json' } });
  assert.ok(html.includes(esc(raw.cases[0].prompt))); assert.ok(html.includes(esc(raw.cases[0].rubric)));
  const dir = tmp(), file = path.join(dir, 'sheet.html'); fs.writeFileSync(file, html);
  const { chromium } = require('playwright'); const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(); await context.setOffline(true);
    const requests = [], errors = [];
    context.on('request', q => { if (q.url() !== pathToFileURL(file).href) requests.push(q.url()); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
    await page.goto(pathToFileURL(file).href);
    assert.equal(await page.locator('script').count(), 0); assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    await page.emulateMedia({ media: 'print' });
    for (const [format, width, usable] of [['A4', 718, 1031], ['Letter', 740, 968]]) {
      await page.setViewportSize({ width, height: 1200 });
      const positions = await page.evaluate(() => ({ summary: document.querySelector('[data-page="summary"]').getBoundingClientRect().height, result: document.querySelector('[data-field="sentence"]').getBoundingClientRect().bottom, limits: document.querySelector('#limits').getBoundingClientRect().bottom }));
      assert.ok(positions.summary <= usable, JSON.stringify({ format, ...positions }));
      assert.ok(positions.result <= usable && positions.limits <= usable);
      const pdf = await page.pdf({ format, printBackground: true });
      assert.ok([...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)].length > 2, 'full appendix spans extra pages');
      fs.writeFileSync(path.join(dir, format + '.pdf'), pdf);
    }
  } finally { await browser.close(); }
});

test('AC-8: command is discoverable in help and the results-reading documentation', () => {
  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin/driftproof'), '--help'], { encoding: 'utf8', timeout: 1800000 });
  assert.match(help.stdout, /sheet <receipt.json>/);
  assert.match(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), /driftproof sheet receipt.json/);
  assert.match(fs.readFileSync(path.join(ROOT, 'docs/methodology/index.html'), 'utf8'), /driftproof sheet/);
});

test('AC-4 edge: browser preserves leading newlines and carriage returns in full task text', async () => {
  const r = await sample();
  const raw = { cases: [{ id: 'c1', prompt: '\nFirst line.\r\nSecond line.', rubric: '\nGuide starts here.\r\nKeep this line.' }] };
  r.suite.suite_hash = suiteIdentity(raw).suiteHash;
  const { html } = renderSheet(R.sealReceipt(r), { suite: { raw, file: 'evals.json' } });
  const { chromium } = require('playwright'), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent(html);
    assert.equal(await page.locator('[data-field="prompt"]').textContent(), raw.cases[0].prompt);
    assert.equal(await page.locator('[data-field="rubric"]').textContent(), raw.cases[0].rubric);
  } finally { await browser.close(); }
});

test('AC-2 edge: absent arms and simulated costs cannot read as measured comparisons or spend', async () => {
  const missing = await sample(); missing.results.cases = missing.results.cases.filter(c => c.mode !== 'baseline');
  require('./receipt-versions').recount(missing);
  assert.equal(R.validateReceipt(R.sealReceipt(missing)).valid, true);
  const a = renderSheet(R.sealReceipt(missing)).html;
  assert.match(a, /With nothing: not recorded/);
  const stub = await sample(); stub.verification_level = 'UNVERIFIED'; stub.run.surface = 'stub'; stub.run.answered_by.kind = 'stub';
  const b = renderSheet(R.sealReceipt(stub)).html;
  assert.match(field(b, 'cost'), /simulated/);
  assert.doesNotMatch(b, /data-field="cost-with_skill-mean_cost_usd_per_call"/);
  const unknown = await sample(); unknown.run.model_id = 'unknown'; unknown.run.judge.model_id = 'unknown';
  limits(renderSheet(R.sealReceipt(unknown)).html, false);
});

test('AC-6 edge: task-scoped judge counts and lost answers remain separate', async () => {
  const r = await sample(); delete r.run.judge.samples;
  if (r.run.counts) { delete r.run.counts.judge_samples_per_generation; if (!Object.keys(r.run.counts).length) delete r.run.counts; }
  for (const row of r.results.cases) row.counts = { ...row.counts, judge_samples_per_generation: 2 };
  const sealed = R.sealReceipt(r); assert.equal(R.validateReceipt(sealed).valid, true);
  const html = renderSheet(sealed).html;
  assert.equal(field(html, 'judge-samples'), 'not recorded');
  for (let i = 0; i < r.results.cases.length; i++) assert.equal(field(html, 'judge-samples-row-' + i), '2');
  const lost = (await F.run(F.plans(require('../config').EFFECT_FLOOR).inconclusive)).receipt;
  const rows = lost.results.cases.filter(c => c.mode === 'with_skill');
  const drawn = rows.flatMap(c => c.generation.draws).length;
  const measured = rows.flatMap(c => c.generation.draws).filter(d => d.status === 'measured').length;
  assert.ok(drawn > measured);
  assert.equal(field(renderSheet(lost).html, 'draws-with_skill'), drawn + ' drawn; ' + measured + ' measured');
});

test('AC-8 edge: validation travels with the receipt filename, never local directories or option syntax', async () => {
  const r = await sample(), dir = tmp(), file = save(dir, '-result.json', r);
  const out = path.join(dir, 'send', 'result.html');
  const got = cli([file, '--out', out]); assert.equal(got.status, 0, got.stderr);
  const html = fs.readFileSync(out, 'utf8');
  assert.equal(field(html, 'validate'), 'driftproof validate ./-result.json');
  assert.match(html, /Keep the receipt beside this sheet/);
  const hostile = await sample(); hostile.skill.name = '<img src=x onerror=bad()>' + String.fromCodePoint(0x202e);
  const output = renderSheet(R.sealReceipt(hostile)).html;
  inert(output); assert.equal(field(output, 'subject-name'), require('../lib/names').invisibleShown(hostile.skill.name));
});
