// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 690: every task name on Reports 017 and 018 opens the task's prompt and rubric, the kept
// answers for one try at a time, and the judge's scores and reasons as the receipt seals them. Every
// oracle here reads the receipt, the answers file and the suites itself, or asks the report builders
// that own the campaign chains, never the notes builder it checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { sha256 } = require('../lib/canonical');
const { suiteIdentity } = require('../lib/skill');
const { scoreOf } = require('../lib/judge');
const { extractJsonObject } = require('../lib/json');
const policy = require('../lib/report-015-publication');
const { htmlToText } = require('../scripts/html-text.js');
const { splitReportBody } = require('../scripts/site-chrome.js');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const SUITES = path.join(ROOT, 'specs/408-skill-measurements/suites');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'judge-notes-690-'));
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const read = (rel) => fs.readFileSync(path.join(DOCS, rel), 'utf8');
const code = (c) => (e) => e.code === c;
const ENT = { '&#39;': '\'', '&#x27;': '\'', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const decode = (s) => s.replace(/&#39;|&#x27;|&quot;|&lt;|&gt;|&amp;/g, (m) => ENT[m]);
const textOf = (html) => htmlToText(html, { skip: ['script', 'style', 'noscript'], decode, collapse: true });
const REPORTS = ['017', '018'];
const ARMS = ['with_skill', 'placebo', 'baseline'];
const LABELS = { with_skill: 'With the skill', placebo: 'With the fake text', baseline: 'With nothing' };
// Words no panel may show (spec 690 AC-8): internal tokens, arm keys, field names, rule-engine states.
const CODES = /[A-Z]{2,}_[A-Z_]+|\bwith_skill\b|\bbaseline\b|\bdraw_index\b|\bgeneration_hash\b|\bseparated-(?:up|down)\b|\bunderpowered\b|\binconclusive\b|\bcase rule\b/;
// Spec 031's confidence lexicon and the ranking words the panel may not add (AC-7).
const LEXICON = /\b(?:confiden\w*|significan\w*|likely|probabl\w*|prove[sn]?|proof|ratio|ranking|ranked|winners?|best|worst|percent)\b|%/i;

function builder() {
  const file = path.join(ROOT, 'scripts/build-judge-notes.js');
  assert.ok(fs.existsSync(file), 'scripts/build-judge-notes.js is not built yet');
  return require(file);
}
function reportBuilder(n) { return require(path.join(ROOT, 'scripts/prepare-report-' + n + '.js')); }
// The rows each report's own chain owns, read through the builder that owns the chain.
const rowsCache = {};
function rowsOf(n) {
  // Report 017's page reads the hand-off note for the attempts scripts/skill-handoff.js names, as its
  // builder's command line does; Report 018's reads them from its plan.
  if (!rowsCache[n]) { const R = reportBuilder(n); rowsCache[n] = R.readCampaign({ campaignRoot: path.join(ROOT, R.CAMPAIGN), ...(n === '017' ? { handoff: [...require('../scripts/skill-handoff').ATTEMPTS] } : {}) }).rows; }
  return rowsCache[n];
}
// The suite whose recomputed hash is the receipt's, found here by scanning every file.
function suiteFileFor(receipt, dir = SUITES) {
  const hits = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).filter((f) => {
    try { return suiteIdentity(json(path.join(dir, f))).suiteHash === receipt.suite.suite_hash; } catch { return false; }
  });
  assert.equal(hits.length, 1, 'one suite hashes to the receipt\'s');
  return path.join(dir, hits[0]);
}
function notesDir(n) { return path.join(DOCS, 'reports', n, 'notes'); }
function dataOf(n, attempt) { return json(path.join(notesDir(n), attempt + '.json')); }
// Every number in a data file, with the key it sits under.
function numbersIn(x, key, out = []) {
  if (typeof x === 'number') out.push({ key, value: x });
  else if (Array.isArray(x)) x.forEach((v) => numbersIn(v, key, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) numbersIn(v, k, out);
  return out;
}

test('AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7: every committed data file is the receipt, its answers and its suite, with the caveats', () => {
  const B = builder();
  for (const n of REPORTS) {
    const R = reportBuilder(n); const rows = rowsOf(n);
    const withReceipt = rows.filter((r) => r.receipt);
    assert.deepEqual(fs.readdirSync(notesDir(n)).sort(), withReceipt.map((r) => r.attempt_id + '.json').sort(), 'one data file per row with a receipt, and no other');
    for (const row of withReceipt) {
      const receipt = json(path.join(ROOT, row.src)); const answers = json(path.join(ROOT, row.src.replace(/\.json$/, '-answers.json')));
      assert.equal(answers.receipt_hash, receipt.receipt_hash, 'AC-1: the answers file names its receipt');
      const data = dataOf(n, row.attempt_id);
      assert.equal(data.format, 'driftproof-judge-notes/1');
      assert.deepEqual([data.report, data.attempt_id, data.receipt_hash, data.skill, data.repository], [n, row.attempt_id, receipt.receipt_hash, row.skill, row.repository]);
      assert.equal(data.receipt_page, fs.existsSync(path.join(DOCS, 'r', receipt.receipt_hash, 'index.html')) ? '/r/' + receipt.receipt_hash + '/' : null);
      assert.equal(data.receipt_file, 'https://github.com/driftproofhq/driftproof/blob/main/' + row.src);
      assert.equal(data.answers_file, 'https://github.com/driftproofhq/driftproof/blob/main/' + row.src.replace(/\.json$/, '-answers.json'));
      assert.deepEqual(data.arms, ARMS.map((key) => ({ key, label: LABELS[key] })));
      assert.equal(data.judge_samples, receipt.run.judge.samples);
      // AC-4: the exam paper is the suite's, found by its hash.
      const suiteFile = suiteFileFor(receipt); const suite = json(suiteFile);
      assert.equal(data.suite_file, 'https://github.com/driftproofhq/driftproof/blob/main/' + path.relative(ROOT, suiteFile).split(path.sep).join('/'));
      assert.deepEqual(data.tasks.map((t) => t.id), suite.cases.map((c) => c.id), 'the tasks in the suite\'s order');
      data.tasks.forEach((t, i) => {
        const c = suite.cases[i];
        assert.deepEqual([t.number, t.of, t.prompt, t.rubric, t.pass_threshold], [i + 1, suite.cases.length, c.prompt, c.rubric, c.pass_threshold], 'the prompt, rubric and threshold, whole');
        // AC-5: tries one to the largest index any arm drew, each arm's entry its draw or null.
        const cases = ARMS.map((mode) => receipt.results.cases.find((x) => x.id === t.id && x.mode === mode));
        const most = Math.max(...cases.map((x) => Math.max(...x.generation.draws.map((d) => d.draw_index)))) + 1;
        assert.deepEqual(t.tries.map((x) => x.try), Array.from({ length: most }, (_, k) => k + 1), 'tries numbered as drawn');
        ARMS.forEach((mode, a) => {
          const draws = cases[a].generation.draws;
          assert.equal(t.tries.filter((x) => x[mode] !== null).length, draws.length, 'as many entries as draws for ' + mode);
          for (const d of draws) {
            const entry = t.tries[d.draw_index][mode]; assert.ok(entry, 'try ' + (d.draw_index + 1) + ' of ' + mode);
            // AC-2: the sealed answer, in its own arm.
            assert.equal(sha256(entry.answer), d.generation_hash, 'AC-2: the answer hashes to the draw\'s generation_hash');
            // AC-3: every retained judge output, parsed as the runner parses it.
            const kept = answers.draws.find((x) => x.id === t.id && x.mode === mode && x.draw_index === d.draw_index);
            assert.equal(entry.notes.length, d.judge_sample_hashes.length, 'one note per retained output');
            assert.equal(kept.judge_outputs.length, d.judge_sample_hashes.length);
            kept.judge_outputs.forEach((out, k) => {
              assert.equal(sha256(out), d.judge_sample_hashes[k], 'the output is the one the receipt seals');
              const parsed = extractJsonObject(out);
              assert.deepEqual(entry.notes[k], { score: scoreOf(parsed), pass: typeof parsed.pass === 'boolean' ? parsed.pass : null, reason: typeof parsed.reason === 'string' ? parsed.reason : null });
              assert.equal(entry.notes[k].score, d.samples[k], 'the score is the recorded sample');
            });
            assert.equal(entry.average, d.mean, 'the average is the receipt\'s');
          }
        });
      });
      // AC-6: the caveats, verbatim from the builders' own strings.
      const want = [R.CAVEAT, B.MODEL_WORDS, B.taskCountLine(suite.cases.length)];
      if (n === '018') want.unshift(R.LIMITATION);
      if (row.handoffNote) want.push(row.handoffNote);
      if (row.router) want.push(B.routerLine());
      assert.deepEqual(data.caveats, want, 'the caveats of ' + n + ' ' + row.skill);
      // AC-7: no number but a score, an average, the threshold, a try number or a count.
      const allowed = new Set(['score', 'average', 'pass_threshold', 'try', 'number', 'of', 'judge_samples']);
      for (const { key } of numbersIn(data, '')) assert.ok(allowed.has(key), 'a number under ' + key);
    }
  }
});

test('AC-1, AC-2, AC-3, AC-4: the builder refuses another receipt\'s answers, an edited answer, an edited judge output and a changed prompt, and never picks a suite by name', () => {
  const B = builder();
  const row = rowsOf('018').find((r) => r.receipt && !r.router);
  const receipt = json(path.join(ROOT, row.src)); const answers = json(path.join(ROOT, row.src.replace(/\.json$/, '-answers.json')));
  const suite = B.suiteFor(receipt, SUITES);
  const control = B.notesOf({ number: '018', row, answers, suite });
  assert.equal(control.attempt_id, row.attempt_id);
  const edited = (fn) => { const a = structuredClone(answers); fn(a); return a; };
  assert.throws(() => B.notesOf({ number: '018', row, answers: edited((a) => { a.receipt_hash = 'f'.repeat(64); }), suite }), code('ANSWERS_BINDING'));
  const key = Object.keys(answers.answers)[0];
  assert.throws(() => B.notesOf({ number: '018', row, answers: edited((a) => { a.answers[key] += ' '; }), suite }), code('ANSWER_BINDING'));
  assert.throws(() => B.notesOf({ number: '018', row, answers: edited((a) => { a.draws[0].judge_outputs[0] = a.draws[0].judge_outputs[0].replace('"score"', '"score" '); }), suite }), code('JUDGE_BINDING'));
  assert.throws(() => B.notesOf({ number: '018', row, answers: edited((a) => { a.draws[0].judge_outputs.pop(); }), suite }), code('JUDGE_BINDING'));
  // The suite by its hash: renamed, the same prompts; one character moved, refused.
  const dir = fs.mkdtempSync(path.join(scratch, 'suites-')); const own = suiteFileFor(receipt);
  fs.copyFileSync(own, path.join(dir, 'zz-renamed.json'));
  const renamed = B.suiteFor(receipt, dir);
  assert.deepEqual(renamed.cases.map((c) => c.prompt), json(own).cases.map((c) => c.prompt));
  const changed = json(own); changed.cases[0].prompt += '.';
  fs.writeFileSync(path.join(dir, 'zz-renamed.json'), JSON.stringify(changed));
  assert.throws(() => B.suiteFor(receipt, dir), code('SUITE_BINDING'));
});

test('AC-2, AC-3, AC-5, AC-6, AC-7, AC-9: --check reproduces every data file and refuses a swapped arm, a typed number, a dropped note, a dropped try, a missing caveat and one byte', () => {
  const B = builder();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-judge-notes.js'), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /judge notes: .* match/);
  const out = path.join(scratch, 'out');
  const files = B.write({ out });
  assert.ok(files.length > 30 && files.every((f) => /\/docs\/reports\/01[78]\/notes\/[a-f0-9]{64}\.json$/.test(f.file.replace(out, '/docs'))), 'only data files under reports/<NNN>/notes/');
  assert.doesNotThrow(() => B.check({ out }), 'control: the files just written pass');
  const file = files.find((f) => f.file.includes('/018/')).file; const text = fs.readFileSync(file, 'utf8');
  const plants = [
    ['the skill\'s and the fake\'s answers swapped', (d) => { const t = d.tasks[0].tries[0]; [t.with_skill, t.placebo] = [t.placebo, t.with_skill]; }],
    ['a score typed one step up', (d) => { const m = d.tasks[0].tries[0].with_skill.notes[0]; m.score = m.score === 1 ? 0.75 : m.score + 0.25; }],
    ['an average typed', (d) => { d.tasks[0].tries[0].with_skill.average = 0.5; }],
    ['a note dropped', (d) => { d.tasks[0].tries[0].with_skill.notes.pop(); }],
    ['a try dropped', (d) => { d.tasks[0].tries.pop(); }],
    ['a caveat removed', (d) => { d.caveats.shift(); }],
    ['a reason cut short', (d) => { const m = d.tasks[0].tries[0].placebo.notes[0]; m.reason = m.reason.slice(0, -1); }],
  ];
  for (const [what, edit] of plants) {
    const d = JSON.parse(text); edit(d); const planted = JSON.stringify(d, null, 1) + '\n';
    assert.notEqual(planted, text, what + ' is planted');
    fs.writeFileSync(file, planted);
    assert.throws(() => B.check({ out }), code('JUDGE_NOTES_DRIFT'), what);
  }
  fs.writeFileSync(file, text.slice(0, -1) + ' \n');
  assert.throws(() => B.check({ out }), code('JUDGE_NOTES_DRIFT'), 'one byte');
  fs.writeFileSync(file, text);
  assert.doesNotThrow(() => B.check({ out }));
});

test('AC-9, AC-11: each row with a receipt carries one mount naming its own data file, the pages keep the site\'s scripts, and every builder is current', () => {
  for (const n of REPORTS) {
    const html = read('reports/' + n + '/index.html');
    const srcs = [...html.matchAll(/<script[^>]*\ssrc=['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
    assert.deepEqual(srcs, ['/copy-button.js', '/islands/loader.js', 'https://static.cloudflareinsights.com/beacon.min.js'], 'AC-9: no new script source');
    assert.ok(!/<script(?![^>]*\ssrc=)(?![^>]*application\/ld\+json)/.test(html), 'no inline script');
    for (const row of rowsOf(n)) {
      const m = new RegExp('<section class="placebo-result[^"]*" data-attempt="' + row.attempt_id + '"[\\s\\S]*?</section>').exec(html);
      assert.ok(m, 'the row of ' + row.skill);
      const mounts = [...m[0].matchAll(/<div class="judge-notes" data-island="judge-notes" data-notes-src="([^"]+)">([\s\S]*?)<\/div>/g)];
      if (!row.receipt) { assert.equal(mounts.length, 0, 'no opener on a row without a receipt'); continue; }
      assert.equal(mounts.length, 1, 'one mount on ' + row.skill);
      assert.equal(mounts[0][1], '/reports/' + n + '/notes/' + row.attempt_id + '.json');
      assert.ok(fs.existsSync(path.join(DOCS, mounts[0][1].slice(1))), 'its data file exists');
      const fallback = textOf(mounts[0][2]);
      assert.match(fallback, /^[^<]*JavaScript/);
      assert.doesNotMatch(fallback, /\d/, 'no numeral in the fallback');
      assert.doesNotMatch(mounts[0][2], /<(?!\/?p\b)/, 'the fallback is one paragraph, with no link: a receipt link would be counted as a receipt of the report');
    }
    const { amendments } = splitReportBody(html);
    const k = n === '017' ? 4 : 2;
    const checkAmendment = value => {
      const entries = value.match(new RegExp('<section id="amendment-' + k + '">[\\s\\S]*?</section>', 'g')) || [];
      assert.equal(entries.length, 1, 'exactly one notes amendment on ' + n);
      assert.match(entries[0], new RegExp('^<section id="amendment-' + k + '"><h3>Amendment ' + k + ', 4 Nov 2026</h3><p>Added, under each task of every row with a receipt, a way to open that task(?:\'|&#39;)s prompt and rubric, the kept answers with the skill, with the fake text and with nothing, and the judge(?:\'|&#39;)s scores and reasons for one try at a time\\. Counts, readings and receipts are unchanged\\.</p></section>$'), 'the dated entry on ' + n);
    };
    checkAmendment(amendments);
    const entry = amendments.match(new RegExp('<section id="amendment-' + k + '">[\\s\\S]*?</section>'))[0];
    for (const changed of ['', entry.replace('4 Nov 2026', '3 Nov 2026'), entry.replace('unchanged', 'changed'), entry + entry]) {
      assert.throws(() => checkAmendment(amendments.replace(entry, () => changed)), 'missing, edited or duplicate notes entry is red');
    }
  }
  for (const g of ['scripts/prepare-report-017.js', 'scripts/prepare-report-018.js', 'scripts/build-report-baselines.mjs', 'scripts/build-markdown.js', 'scripts/build-head-tags.js']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, g), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
    assert.equal(r.status, 0, g + ': ' + r.stdout + r.stderr);
  }
});

test('AC-3, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10: Chromium opens a task, reads one try at a time in plain words, sends nothing, and works at 390 px by keyboard', { timeout: 1800000 }, async () => {
  const { chromium } = require('playwright');
  const shots = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'judge-notes-690-shots-'));
  const server = http.createServer((req, res) => {
    let file = path.resolve(DOCS, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(DOCS + path.sep)) return res.writeHead(403).end();
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    for (const n of REPORTS) {
      const row = rowsOf(n).find((r) => r.receipt && !r.router);
      const data = dataOf(n, row.attempt_id);
      for (const [width, height] of [[1280, 800], [390, 844]]) {
        const context = await browser.newContext({ viewport: { width, height } });
        const requests = [];
        await context.route('**/*', async (route) => {
          requests.push(route.request().url());
          if (new URL(route.request().url()).hostname === '127.0.0.1') await route.continue(); else await route.abort();
        });
        // AC-10: the island asks for smooth scrolling only when motion is not reduced.
        await context.addInitScript(() => { window.__scrolls = []; Element.prototype.scrollIntoView = function (o) { window.__scrolls.push(o && o.behavior); }; });
        const page = await context.newPage();
        await page.goto(origin + '/reports/' + n + '/', { waitUntil: 'networkidle' });
        const section = page.locator('section.placebo-result[data-attempt="' + row.attempt_id + '"]');
        const mount = section.locator('.judge-notes');
        await mount.locator('button.judge-open').first().waitFor({ state: 'attached' });
        if (n === '018') await section.locator(':scope > details.placebo-row > summary').click();
        assert.equal(await section.locator('details.send-preview[open]').count(), 0, 'opening the result leaves the share preview closed');
        const state = () => page.evaluate(() => ({ url: location.href, cookie: document.cookie, local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
        const before = await state();
        // AC-11: the task names in the row's lists are openers, and the mount lists them.
        const ids = data.tasks.map((t) => t.id);
        assert.deepEqual(await mount.locator('button.judge-open').evaluateAll((bs) => bs.map((b) => b.textContent)), ids, 'the mount lists every task');
        assert.deepEqual(await section.locator('ul.placebo-tasks button.judge-open').evaluateAll((bs) => bs.map((b) => b.textContent)), ids, 'each task name in the list is an opener');
        const opener = section.locator('ul.placebo-tasks button.judge-open').first();
        await mount.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(shots, 'judge-notes-row-' + n + '-' + width + '.png'), fullPage: false });
        await opener.click();
        const panel = section.locator('section.judge-panel');
        await panel.waitFor({ state: 'visible' });
        const task = data.tasks[0];
        assert.equal(await panel.locator('h4.judge-title').textContent(), 'Task 1 of ' + data.tasks.length + ': ' + task.id);
        assert.equal(await page.evaluate(() => document.activeElement.className), 'judge-title', 'focus moves to the panel');
        assert.equal(await panel.locator('.judge-prompt').textContent(), task.prompt, 'the prompt, whole');
        // The rubric, whole: the scoring instruction, its numbered criteria and the provenance sentence
        // are the rubric's own text in another order, every word kept.
        const rubric = await panel.locator('.judge-rubric').evaluate((e) => ({ ps: [...e.querySelectorAll(':scope > p')].map((p) => [p.className, p.textContent]), items: [...e.querySelectorAll(':scope > ol > li')].map((li) => li.textContent) }));
        const collapse = (s) => s.replace(/\s+/g, ' ').trim();
        const shown = rubric.ps.length === 1 && !rubric.items.length ? rubric.ps[0][1]
          : [rubric.ps.find((p) => p[0] === 'judge-rubric-source')?.[1] || '', rubric.ps.find((p) => p[0] === 'judge-rubric-scoring')[1], ...rubric.items.map((t, i) => (i + 1) + '. ' + t)].join(' ');
        assert.equal(collapse(shown), collapse(task.rubric), 'the rubric, whole');
        if (rubric.items.length) assert.ok(rubric.items.length >= 2 && rubric.ps[0][0] === 'judge-rubric-scoring', 'the criteria read as a list, the scoring instruction first');
        const tryOf = async (k) => {
          const t = task.tries[k];
          assert.equal(await panel.locator('.judge-try').textContent(), 'Try ' + (k + 1) + ' of ' + task.tries.length);
          for (const arm of ARMS) {
            const box = panel.locator('article.judge-arm[data-arm="' + arm + '"]');
            assert.equal(await box.locator(':scope > h5').textContent(), LABELS[arm]);
            if (!t[arm]) { assert.match(await box.locator('.judge-none').textContent(), /no try/); continue; }
            // A-690-1: formatting changes markup, never the sealed source or arm.
            const expected = await page.evaluate(async source => {
              const { renderAnswer } = await import('/islands/can-you-tell.js');
              const node = document.createElement('div'); node.innerHTML = renderAnswer(source); return node.innerHTML;
            }, t[arm].answer);
            assert.equal(await box.locator('.judge-answer').innerHTML(), expected, 'the whole formatted answer is in its own arm');
            assert.deepEqual(await box.locator('ol.judge-marks .judge-reason').evaluateAll((es) => es.map((e) => e.textContent)), t[arm].notes.map((m) => m.reason), 'every reason, whole');
            assert.deepEqual(await box.locator('ol.judge-marks .judge-score').evaluateAll((es) => es.map((e) => e.textContent)), t[arm].notes.map((m) => 'Score ' + m.score));
            assert.ok((await box.locator('.judge-average').textContent()).includes(String(t[arm].average)), 'the receipt\'s average');
          }
        };
        await tryOf(0);
        assert.equal(await panel.locator('button.judge-prev').isDisabled(), true, 'opens at the first try');
        // The panel as a reader first sees it, from its heading.
        await page.evaluate((y) => window.scrollTo(0, y), await panel.evaluate((e) => e.getBoundingClientRect().top + window.scrollY - 16));
        await page.screenshot({ path: path.join(shots, 'judge-notes-' + n + '-' + width + '.png'), fullPage: false });
        await page.evaluate((y) => window.scrollTo(0, y), await panel.locator('.judge-arms').evaluate((e) => e.getBoundingClientRect().top + window.scrollY - 16));
        await page.screenshot({ path: path.join(shots, 'judge-notes-arms-' + n + '-' + width + '.png'), fullPage: false });
        await panel.locator('button.judge-next').click();
        await tryOf(1);
        await panel.locator('button.judge-prev').click();
        await tryOf(0);
        // AC-6: every caveat, and the links.
        assert.deepEqual(await panel.locator('ul.judge-caveats li').evaluateAll((es) => es.map((e) => e.textContent)), data.caveats);
        const links = await panel.locator('p.judge-links a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
        assert.deepEqual(links, [...(data.receipt_page ? [['The receipt\'s page', data.receipt_page]] : []), ['The receipt', data.receipt_file], ['Its kept answers', data.answers_file], ['The task suite', data.suite_file]]);
        // AC-8: plain words; AC-7: no word of the panel's own that ranks or weighs.
        const visible = await panel.innerText();
        assert.doesNotMatch(visible.replace(/Score [\d.]+/g, ''), CODES, 'no internal token in the panel');
        const own = await panel.evaluate((e) => { const c = e.cloneNode(true); c.querySelectorAll('.judge-answer, .judge-reason, .judge-prompt, .judge-rubric, .judge-caveats').forEach((x) => x.remove()); return c.textContent; });
        assert.doesNotMatch(own, LEXICON, 'the panel\'s own words weigh nothing');
        // A long answer is clipped only with a visible control, and shows whole on it.
        const clippedArms = panel.locator('article.judge-arm').filter({ has: page.locator('.judge-answer.is-clipped') });
        if (await clippedArms.count()) {
          // Pinned to its arm: a locator on "the first clipped arm" would move to the next one once this one opens.
          const arm = panel.locator('article.judge-arm[data-arm="' + await clippedArms.first().getAttribute('data-arm') + '"]');
          const answer = arm.locator('.judge-answer'); const more = arm.locator('button.judge-more');
          assert.equal(await more.textContent(), 'Show all'); assert.equal(await more.getAttribute('aria-expanded'), 'false');
          assert.equal(await answer.evaluate((e) => getComputedStyle(e).overflowY), 'hidden', 'clipped by style, the whole text in the page');
          await more.click();
          assert.equal(await more.textContent(), 'Show less'); assert.equal(await more.getAttribute('aria-expanded'), 'true');
          assert.equal(await answer.evaluate((e) => e.classList.contains('is-clipped')), false, 'the answer is no longer clipped');
          assert.equal(await answer.evaluate((e) => e.scrollHeight <= e.clientHeight + 1), true, 'the whole answer shows');
        }
        // AC-10: layout at this width, nothing sideways, the scroll request honours reduced motion.
        const boxes = await panel.locator('article.judge-arm').evaluateAll((es) => es.map((e) => e.getBoundingClientRect()).map((b) => ({ x: b.x, y: b.y, w: b.width })));
        if (width === 1280) assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 2 && boxes[1].x > boxes[0].x + boxes[0].w - 2, 'side by side');
        else assert.ok(boxes[1].y > boxes[0].y && boxes[2].y > boxes[1].y && Math.abs(boxes[0].x - boxes[1].x) < 2, 'stacked');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
        assert.deepEqual(await page.evaluate(() => window.__scrolls), ['smooth'], 'smooth scrolling when motion is not reduced');
        // AC-10: Escape closes and returns focus to the opener.
        await page.keyboard.press('Escape');
        assert.equal(await panel.count(), 0, 'Escape closes');
        assert.equal(await opener.evaluate((e) => document.activeElement === e), true, 'focus returns to the opener');
        await mount.locator('button.judge-open').nth(1).click();
        assert.equal(await panel.locator('h4.judge-title').textContent(), 'Task 2 of ' + data.tasks.length + ': ' + data.tasks[1].id, 'another task opens in the same panel');
        await panel.locator('button.judge-close').click();
        assert.equal(await panel.count(), 0, 'Close closes');
        // AC-9: nothing left the host, and nothing was stored.
        const others = requests.filter((u) => new URL(u).hostname !== '127.0.0.1');
        assert.deepEqual(others.filter((u) => !/cloudflareinsights/.test(u)), [], 'no request to another host but the site\'s own beacon');
        assert.deepEqual(await state(), before, 'no cookie, storage or address change');
        assert.ok(requests.some((u) => u === origin + '/reports/' + n + '/notes/' + row.attempt_id + '.json'), 'the row\'s own data file was fetched');
        await context.close();
      }
      // Reduced motion: the scroll request is plain.
      const reduced = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      await reduced.addInitScript(() => { window.__scrolls = []; Element.prototype.scrollIntoView = function (o) { window.__scrolls.push(o && o.behavior); }; });
      const rp = await reduced.newPage();
      await rp.goto(origin + '/reports/' + n + '/', { waitUntil: 'networkidle' });
      const rs = rp.locator('section.placebo-result[data-attempt="' + row.attempt_id + '"]');
      if (n === '018') await rs.locator(':scope > details.placebo-row > summary').click();
      await rs.locator('.judge-notes button.judge-open').first().click();
      await rs.locator('section.judge-panel').waitFor({ state: 'visible' });
      assert.deepEqual(await rp.evaluate(() => window.__scrolls), ['auto'], 'no smooth scroll under reduced motion');
      await reduced.close();
      // Without script: the fallback paragraph alone, no opener.
      const off = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
      const op = await off.newPage();
      await op.goto(origin + '/reports/' + n + '/', { waitUntil: 'networkidle' });
      const om = op.locator('section.placebo-result[data-attempt="' + row.attempt_id + '"] .judge-notes');
      assert.equal(await om.locator('button').count(), 0);
      assert.match(await om.textContent(), /JavaScript/);
      await off.close();
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  console.log('screenshots: ' + shots);
});
