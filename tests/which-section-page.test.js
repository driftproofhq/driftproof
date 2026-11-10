// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 743: /which-section/, three skills with their longest section removed, read by compare.
// The oracle here is the test's own: it reads the manifest, the receipts and the differ, never the
// builder's rows, and every plant must read red against it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DIR = 'receipts/which-section';
const { readReceiptFile, verifyReceiptHash, validateReceipt, sealReceipt } = require('../lib/receipt');
const { renderCompareReport, compareHeadline } = require('../lib/compare');
const { suiteIdentity } = require('../lib/skill');
const { estimateTokens } = require('../lib/skillCost');
const { buildDriftReport } = require('../lib/diff');
const { mdText } = require('../lib/names');

// The six limits the page prints once, before the cards (issue 743's hard rules; A-743-4), in the test's own copy.
const LIMITS = [
  'drafted by Driftproof from the skill\'s own description',
  'sections that matter only together are not seen',
  'A shorter file is also a shorter file, so length moved too.',
  'This model, this judge (the model grading itself), this day.',
  'The two runs were sequential',
  'No clear difference is not proof the section does nothing.',
];
// Issue 758: the seventh sentence, counted from the page's own tasks.
const CHANCE = 'Across these nine tasks, chance alone can produce a difference like the ones below; this page does not say whether one came from the removal, from the time between the two runs or from chance.';
const AB_DEFINED = 'A = whole file, B = file without the section';
const BLOCK_HEADING = 'What compare prints for these two folders';
const SELF_GRADING = 'The judge is the same model that answered. A model grading its own answers may favour some kinds of answer.';
// The run was `compare skill-a skill-b`, so the page's lines name the two folders as the CLI does.
const foldersOf = (name) => ({ a: 'A (' + mdText(name) + ', the folder given first)', b: 'B (' + mdText(name) + ', the folder given second)' });
const lowerOf = (n) => n.b + ' scored clearly lower than ' + n.a;
const higherOf = (n) => n.b + ' scored clearly higher than ' + n.a;
const kindOf = (reading, n) => (reading === lowerOf(n) ? 'lower' : reading === higherOf(n) ? 'higher' : reading);
const PLAIN = { lower: 'scored lower on average', higher: 'scored higher on average', 'no clear difference': 'no clear difference', 'too few answers': 'too few answers' };

// A stand-in subject for the renderer: the receipt's sealed name, unit, hash, token estimate and
// suite, and a text of exactly the manifest's byte count. No third-party byte is in the tree.
function standIn(receipt, bytes, suiteRaw) {
  const tokens = receipt.skill.tokens;
  let chars = null;
  for (let c = 4 * tokens; c > 4 * tokens - 4; c--) if (c <= bytes && bytes <= 2 * c) { chars = c; break; }
  assert.ok(chars !== null, 'a stand-in text exists for these bytes and tokens');
  const text = 'é'.repeat(bytes - chars) + 'a'.repeat(2 * chars - bytes);
  assert.equal(Buffer.byteLength(text), bytes); assert.equal(estimateTokens(text), tokens);
  const { cases, suiteHash } = suiteIdentity(suiteRaw);
  return { name: receipt.skill.name, unit: receipt.skill.unit, contentHash: receipt.skill.content_hash, skillMd: text, suite: { suiteHash, caseCount: cases.length, cases } };
}
function expectedRows(dir = path.join(ROOT, DIR)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return manifest.skills.map((s, i) => {
    const file = (side) => path.join(dir, s.skill, s[side].receipt);
    const receipts = { a: readReceiptFile(file('a')), b: readReceiptFile(file('b')) };
    for (const side of ['a', 'b']) { assert.ok(verifyReceiptHash(receipts[side]) && validateReceipt(receipts[side]).valid); assert.ok(s[side].receipt.includes(receipts[side].receipt_hash)); }
    const suiteRaw = JSON.parse(read(s.suite));
    const markdown = renderCompareReport(receipts.a, receipts.b, { a: standIn(receipts.a, s.a.bytes, suiteRaw), b: standIn(receipts.b, s.b.bytes, suiteRaw) }).markdown;
    assert.equal(markdown, fs.readFileSync(path.join(dir, s.skill, 'compare.md'), 'utf8'), s.skill + ': compare.md is the renderer\'s');
    const lines = markdown.split('\n');
    const start = lines.findIndex((l) => l.startsWith('Model: ')) + 2;
    const block = lines.slice(start, lines.indexOf('', start));
    const perTask = block.filter((l) => l.startsWith('- ')).map((l) => { const m = /^- (.+?): (.+)$/.exec(l); return { id: m[1], reading: m[2] }; });
    return { index: i, manifest: s, receipts, suiteRaw, markdown, block, perTask, names: foldersOf(receipts.a.skill.name), share: (Math.round(1000 * s.removed_bytes / s.a.bytes) / 10).toFixed(1), tokensRemoved: receipts.a.skill.tokens - receipts.b.skill.tokens };
  });
}
// The words a re-rendered reading must hold (issue 758), read from the rendered Markdown and the differ.
function wordsOracle(markdown, r) {
  assert.doesNotMatch(markdown, /upstream/i, 'B is never named upstream');
  assert.doesNotMatch(markdown, /REVISION (?:IMPROVED|REGRESSED)|MIXED:|NO SEPARATION DETECTED/, 'no revision-drift label');
  assert.doesNotMatch(markdown, /SAMPLING\.max|run\.runner_version|Draws ceiling/, 'no code identifier');
  assert.doesNotMatch(markdown, /the committed file|your edit|the whole file|the file without the section/, 'the names the CLI gives two folders, and no others');
  assert.doesNotMatch(markdown, /score ranges|scores? do not overlap/, 'the rule compares averages, not ranges');
  assert.ok(markdown.includes(SELF_GRADING), 'self-grading caveat');
  const perCase = buildDriftReport(r.receipts.a, r.receipts.b, { mode: 'revision' }).perCase;
  const ids = (verdict) => perCase.filter((x) => x.verdict === verdict).map((x) => x.id);
  const lower = ids('regression'), higher = ids('improvement');
  const on = (list) => (list.length === 1 ? 'the ' + list[0] + ' task' : 'the ' + list.slice(0, -1).join(', ') + ' and ' + list.at(-1) + ' tasks');
  const head = r.block.at(-1);
  for (const id of lower) assert.ok(markdown.includes('- ' + id + ': ' + lowerOf(r.names)), id + ' per-task line');
  for (const id of higher) assert.ok(markdown.includes('- ' + id + ': ' + higherOf(r.names)), id + ' per-task line');
  // The full measured reading ends on the headline the differ's own rows give.
  assert.equal(head, compareHeadline(perCase, r.names, mdText), 'the closing line is the headline of these rows');
  if (!lower.length && !higher.length) {
    assert.ok(head.startsWith('No separation was detected between ' + r.names.a + ' and ' + r.names.b), 'no separation');
    return;
  }
  assert.ok(head.startsWith(r.names.b + ' scored '), 'B is the subject');
  if (lower.length) assert.ok(head.includes('lower than ' + r.names.a + ' on ' + on(lower)), 'the lower tasks');
  if (higher.length) assert.ok(head.includes((lower.length ? 'and higher on ' : 'higher than ' + r.names.a + ' on ') + on(higher)), 'the higher tasks');
}
const at = (obj, dotted) => dotted.split('.').reduce((o, k) => { const m = /^(\w+)\[(\d+)\]$/.exec(k); return m ? o[m[1]][Number(m[2])] : o[k]; }, obj);

// The page oracle: reads the DOM, compares every card with the manifest, the receipts and the differ.
async function oracle(page, rows) {
  const got = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('main [data-skill]')].map((c) => ({
      skill: c.dataset.skill, heading: c.querySelector('[data-quote="heading"]')?.textContent,
      headline: c.querySelector('.section-headline')?.textContent || '',
      headlineOwn: (() => { const h = c.querySelector('.section-headline')?.cloneNode(true); if (!h) return ''; h.querySelectorAll('[data-quote]').forEach((x) => x.remove()); return h.textContent; })(),
      lines: c.querySelector('.reading-lines')?.textContent, refusal: c.querySelector('.section-refusal')?.textContent || null,
      names: c.querySelector('.section-names')?.textContent || null,
      namesAbove: c.querySelector('.section-names')?.nextElementSibling?.textContent || null,
      text: c.textContent,
      tasks: [...c.querySelectorAll('.section-tasks li')].map((li) => ({ text: li.textContent, href: li.querySelector('a')?.getAttribute('href') || null })),
      data: [...c.querySelectorAll('data')].map((d) => ({ text: d.textContent, src: d.dataset.src, at: d.dataset.at, fn: d.dataset.fn })),
    }));
    const main = document.querySelector('main');
    const m = main.cloneNode(true);
    m.querySelectorAll('data, code, pre, [data-quote], .model-name').forEach((x) => x.remove());
    const own = m.textContent.replace(/Report 0(?:17|18)/g, '');
    const limitsAt = [...main.children].findIndex((e) => e.id === 'limits');
    const firstCard = [...main.children].findIndex((e) => e.matches('[data-skill]'));
    return { cards, own, whole: main.textContent, limits: [...document.querySelectorAll('.page-caveats li')].map((x) => x.textContent), limitsFirst: limitsAt >= 0 && limitsAt < firstCard, count: document.querySelector('.pairs-complete')?.textContent || '' };
  });
  assert.equal(got.cards.length, rows.length);
  assert.doesNotMatch(got.own, /\d/, 'unbound number');
  assert.doesNotMatch(got.own, /\b(delete|useless)\b/i, 'no advice to cut');
  assert.doesNotMatch(got.own, /Nothing else changed|read passing|upstream|SAMPLING\.max|run\.runner_version|exact lines compare printed|score ranges|scores? do not overlap/i, 'no claim the run did not hold and no internal code');
  assert.ok(got.limitsFirst, 'the limits come before the first card');
  for (const limit of [...LIMITS, CHANCE]) {
    assert.ok(got.limits.some((x) => x.includes(limit)), 'limit: ' + limit);
    assert.equal(got.whole.split(limit).length - 1, 1, 'printed once: ' + limit);
  }
  const sources = new Map();
  const source = (src) => { if (!sources.has(src)) sources.set(src, JSON.parse(read(src))); return sources.get(src); };
  got.cards.forEach((c, i) => {
    const r = rows[i];
    assert.equal(c.skill, r.manifest.skill);
    assert.equal(c.heading, '#'.repeat(r.manifest.removed.level) + ' ' + r.manifest.removed.heading);
    for (const d of c.data) {
      assert.ok(d.src === DIR + '/manifest.json' || d.src.startsWith(DIR + '/' + r.manifest.skill + '/compare-'), 'figure source ' + d.src);
      const v = at(source(d.src), d.at);
      assert.equal(d.text, d.fn === 'date' ? String(v).slice(0, 10) : String(v), d.src + ' ' + d.at);
    }
    const texts = c.data.map((d) => d.text);
    for (const want of [r.manifest.b.sha256, r.manifest.a.sha256, String(r.manifest.a.bytes), String(r.manifest.b.bytes), String(r.manifest.removed_bytes), r.share, String(r.tokensRemoved), r.receipts.a.receipt_hash, r.receipts.b.receipt_hash]) assert.ok(texts.includes(want), 'bound figure ' + want);
    assert.equal(c.refusal, null);
    assert.equal(c.lines, r.block.join('\n'));
    assert.equal(c.names, AB_DEFINED, 'A and B are defined');
    assert.equal(c.namesAbove, BLOCK_HEADING, 'directly above the lines compare prints');
    assert.doesNotMatch(c.lines, /score ranges|scores? do not overlap|the committed file|your edit/, 'the block carries the true wording');
    assert.doesNotMatch(c.headlineOwn, /\b(?:left|lowered|raised|made|gave|because|caused)\b/i, 'what was detected, never a cause');
    assert.match(c.headlineOwn, /^With\b/, 'the headline opens on the removal as a condition');
    for (const hash of [r.manifest.a.subject_sha256, r.manifest.b.subject_sha256]) assert.ok(!c.text.includes(hash), 'one sha256 per file');
    for (const t of r.perTask) {
      const plain = PLAIN[kindOf(t.reading, r.names)];
      assert.ok(plain, t.reading);
      assert.ok(c.headline.includes(plain), t.id + ' ' + plain);
      if (plain.startsWith('scored')) assert.ok(c.headline.includes(t.id));
      const li = c.tasks.find((x) => x.text.startsWith(t.id));
      assert.ok(li && li.text.includes(plain), 'task line ' + t.id);
      const taskPage = 'docs/tasks/' + r.manifest.repository + '/' + r.manifest.skill + '/index.html';
      if (fs.existsSync(path.join(ROOT, taskPage)) && read(taskPage).includes('id="' + t.id + '"')) assert.equal(li.href, '/tasks/' + r.manifest.repository + '/' + r.manifest.skill + '/#' + t.id);
    }
    for (const word of [PLAIN.lower, PLAIN.higher]) if (c.headline.includes(word)) assert.ok(r.perTask.some((t) => PLAIN[kindOf(t.reading, r.names)] === word), 'headline word ' + word + ' has a task');
  });
  assert.match(got.count, /three of three/i);
}

test('fixed words: the plain map and the caveats are the builder\'s', () => {
  const B = require('../scripts/build-which-section');
  for (const [k, v] of Object.entries(PLAIN)) assert.ok(B.READING_WORDS[k].includes(v), k);
  assert.equal(Object.keys(B.READING_WORDS).length, 4);
  assert.equal(B.CAVEATS.length, 6);
  for (const limit of LIMITS) assert.ok(B.CAVEATS.some((c) => c.includes(limit)), limit);
  for (const text of [...B.CAVEATS, ...Object.values(B.WORDS)]) { assert.doesNotMatch(text, /—/); assert.doesNotMatch(text, /\b(delete|useless)\b/i); }
});

test('A-743-4: each reading is re-rendered from its sealed receipts and names the two files', () => {
  const rows = expectedRows();
  for (const r of rows) {
    wordsOracle(r.markdown, r);
    assert.throws(() => wordsOracle(r.markdown + '\nB is lower under the current upstream text.', r), /upstream/, 'naming B upstream reads red');
    assert.throws(() => wordsOracle(r.markdown.replace(SELF_GRADING, ''), r), /self-grading/, 'a reading without the caveat reads red');
    assert.throws(() => wordsOracle(r.markdown + '\nDraws ceiling: 10, from SAMPLING.max.', r), /code identifier/, 'a code identifier reads red');
    assert.throws(() => wordsOracle(r.markdown + '\nA (the whole file)', r), /the names the CLI gives/, 'a name the CLI would not print reads red');
    assert.throws(() => wordsOracle(r.markdown + '\nThe two score ranges do not overlap.', r), /averages, not ranges/, 'the false rule wording reads red');
    // These are the lines the CLI prints for two folders: the same renderer, given only what the CLI gives it.
    assert.ok(r.markdown.includes(r.names.a) && r.markdown.includes(r.names.b), 'the folder names');
  }
});

test('A-743-4: the build reads the runner version each receipt sealed, never the package version', () => {
  const dir = fs.mkdtempSync('/var/tmp/which-section-743-');
  const preload = path.join(dir, 'package-version.cjs');
  fs.writeFileSync(preload, 'require(' + JSON.stringify(path.join(ROOT, 'config.js')) + ").RUNNER_VERSION = '0.28.0';\n");
  const seen = spawnSync(process.execPath, ['--require', preload, '-p', 'require(' + JSON.stringify(path.join(ROOT, 'config.js')) + ').RUNNER_VERSION'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(seen.stdout.trim(), '0.28.0', 'the plant really moves the package version');
  const code = 'const B = require(' + JSON.stringify(path.join(ROOT, 'scripts/build-which-section.js')) + '); const rows = B.readRows(); B.check(); console.log(JSON.stringify(rows.map((r) => r.markdown)));';
  const moved = spawnSync(process.execPath, ['--require', preload, '-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(moved.status, 0, moved.stdout + moved.stderr);
  // Nothing about the reading moves with the package: every line, the limit's version included.
  assert.deepEqual(JSON.parse(moved.stdout), expectedRows().map((r) => r.markdown));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('manifest, receipts and compare.md bind each other; the page is current and discovered', () => {
  const B = require('../scripts/build-which-section');
  const rows = expectedRows();
  assert.equal(rows.length, 3);
  const manifest = JSON.parse(read(DIR + '/manifest.json'));
  const sources = JSON.parse(read('specs/408-skill-measurements/sources.json'));
  const plan = JSON.parse(read('receipts/report-018/plan.json'));
  for (const r of rows) {
    const s = r.manifest;
    assert.equal(s.a.bytes - s.removed_bytes, s.b.bytes);
    assert.equal(s.removed_share_percent, Number(r.share));
    assert.equal(s.removed_tokens_estimate, r.tokensRemoved);
    const src = sources.find((x) => x.skill === s.skill && x.repository === s.repository);
    assert.equal(src.skill_sha256, s.skill_sha256); assert.equal(src.commit, s.commit); assert.equal(s.a.sha256, s.skill_sha256);
    const suiteRaw = JSON.parse(read(s.suite));
    assert.equal(suiteRaw.skill_sha256, s.skill_sha256);
    const row = plan.rows.find((x) => x.skill === s.skill);
    assert.equal(row.attempt_id, s.report_018_attempt_id); assert.equal(row.router, false);
    const campaign = JSON.parse(read('receipts/report-018/campaign-3/' + row.attempt_id + '.json'));
    assert.equal(campaign.skill.content_hash, r.receipts.a.skill.content_hash);
    assert.equal(require('../lib/verdict').receiptVerdict(campaign).verdict, 'PASSED');
    assert.equal(s.a.subject_sha256, r.receipts.a.skill.content_hash); assert.equal(s.b.subject_sha256, r.receipts.b.skill.content_hash);
    for (const side of ['a', 'b']) assert.equal(r.receipts[side].suite.suite_hash, plan.execution.attempts.find((a) => a.attempt_id === row.attempt_id).protocol.suite_hash);
  }
  assert.ok(manifest.selection_rule.length > 40 && manifest.removal_rule.length > 40);
  for (const f of B.outputs()) assert.equal(fs.readFileSync(f.file, 'utf8'), f.text, 'current: ' + f.file);
  const R = require('../scripts/reader-pages');
  assert.ok(R.pages().some((p) => p.href === '/which-section/' && p.label === 'Which section did the work?'));
  for (const file of ['docs/llms.txt', 'docs/llms-full.txt', 'docs/sitemap-pages.xml', 'README.md', 'docs/index.html']) assert.ok(read(file).includes('/which-section/'), file);
  assert.ok(read('docs/data/page-dates.json').includes('which-section/index.html'));
});

test('builder refusals: a receipt whose hash fails, a manifest off by one byte, a router, a changed compare.md', () => {
  const B = require('../scripts/build-which-section');
  const copy = () => { const dir = fs.mkdtempSync('/var/tmp/which-section-743-'); fs.cpSync(path.join(ROOT, DIR), dir, { recursive: true }); return dir; };
  const manifestOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const writeManifest = (dir, m) => fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  assert.equal(B.readRows().length, 3);
  { const dir = copy(); const m = manifestOf(dir); const f = path.join(dir, m.skills[0].skill, m.skills[0].a.receipt);
    const r = JSON.parse(fs.readFileSync(f, 'utf8')); r.results.cases[0].score = Number(r.results.cases[0].score) + 0.01; fs.writeFileSync(f, JSON.stringify(r, null, 2) + '\n');
    assert.throws(() => B.readRows({ dir }), /RECEIPT/); }
  { const dir = copy(); const m = manifestOf(dir); m.skills[1].b.bytes += 1; writeManifest(dir, m); assert.throws(() => B.readRows({ dir }), /BYTES/); }
  { const dir = copy(); const m = manifestOf(dir); m.skills[1].removed_bytes -= 1; m.skills[1].a.bytes -= 1; writeManifest(dir, m); assert.throws(() => B.readRows({ dir }), /READING|BYTES|SHARE/); }
  { const dir = copy(); const m = manifestOf(dir); m.skills[2].report_018_attempt_id = '31e236a9103896b1905877ed0e997042a18ec615b8dee14676beedbda441e389'; writeManifest(dir, m); assert.throws(() => B.readRows({ dir }), /SELECTION/); }
  { const dir = copy(); const m = manifestOf(dir); m.skills[0].skill_sha256 = m.skills[0].skill_sha256.replace(/^./, (c) => (c === '0' ? '1' : '0')); writeManifest(dir, m); assert.throws(() => B.readRows({ dir }), /SOURCE|SUITE/); }
  { const dir = copy(); const m = manifestOf(dir); m.skills[0].b.sha256 = m.skills[0].b.sha256.replace(/^./, (c) => (c === '0' ? '1' : '0')); writeManifest(dir, m); assert.throws(() => B.readRows({ dir }), /REMOVAL/); }
  { const dir = copy(); const m = manifestOf(dir); const f = path.join(dir, m.skills[0].skill, 'compare.md'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('too few answers', 'too few answer')); assert.throws(() => B.readRows({ dir }), /READING/); }
  // A sealed version no record knows reads unknown, so it cannot pass as the committed reading.
  { const dir = copy(); const m = manifestOf(dir); const s = m.skills[0];
    for (const side of ['a', 'b']) { const f = path.join(dir, s.skill, s[side].receipt); const r = JSON.parse(fs.readFileSync(f, 'utf8')); r.run.runner_version = '0.0.1'; sealReceipt(r); fs.unlinkSync(f);
      s[side].receipt = 'compare-' + side.toUpperCase() + '-' + r.receipt_hash + '.json'; fs.writeFileSync(path.join(dir, s.skill, s[side].receipt), JSON.stringify(r, null, 2) + '\n'); }
    writeManifest(dir, m); assert.throws(() => B.readRows({ dir }), /READING/); }
  // A pair the renderer refuses is shown as its refusal sentence, and the page says two of three.
  { const dir = copy(); const m = manifestOf(dir); const s = m.skills[2]; const f = path.join(dir, s.skill, s.b.receipt);
    const r = JSON.parse(fs.readFileSync(f, 'utf8')); r.run.timeout_ms = r.run.timeout_ms + 1000; sealReceipt(r); fs.unlinkSync(f);
    s.b.receipt = 'compare-B-' + r.receipt_hash + '.json'; fs.writeFileSync(path.join(dir, s.skill, s.b.receipt), JSON.stringify(r, null, 2) + '\n'); writeManifest(dir, m);
    const { rows, html } = B.pageOf({ dir });
    assert.match(rows[2].refusal, /timeout settings differ/);
    assert.ok(html.includes('Effective timeout settings differ; no comparison reading.'));
    assert.match(html, /two of three/i);
    assert.equal(rows[2].block, null); }
  // A hostile heading is text, never markup.
  { const dir = copy(); const m = manifestOf(dir); m.skills[0].removed.heading = '<img src=x onerror=alert(1)> delete'; writeManifest(dir, m);
    const { html } = B.pageOf({ dir }); assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; delete')); assert.ok(!html.includes('<img src=x')); }
});

test('receipt pages: the title ladder ends in the short content hash and the archive stays unique', () => {
  const P = require('../scripts/build-receipt-pages');
  const all = P.receipts();
  const titles = P.receiptTitles(all);
  assert.equal(new Set(titles.values()).size, titles.size, 'one title per receipt');
  const rows = expectedRows();
  for (const r of rows) for (const side of ['a', 'b']) {
    const t = titles.get(r.receipts[side].receipt_hash);
    // A-743-2: the whole file says where it was published; the reduced file is told apart by the hash of its text.
    if (side === 'a') assert.ok(t && t.endsWith(', section comparison | Driftproof'), 'the whole file names its place: ' + t);
    else assert.ok(t && t.includes(r.receipts[side].skill.content_hash.slice(0, 12)), 'the reduced file carries the short content hash: ' + t);
    const rungs = P.titleRungs({ rel: DIR + '/' + r.manifest.skill + '/' + r.manifest[side].receipt, receipt: r.receipts[side] });
    assert.ok(!rungs.includes(r.receipts[side].skill.name + ' on Claude Haiku 5.5 | Driftproof'), 'a section comparison takes no bare rung');
    assert.ok(rungs.at(-1).includes(r.receipts[side].skill.content_hash.slice(0, 12)));
    assert.equal(rungs[0], r.receipts[side].skill.name + ' on Claude Haiku 5.5, ' + r.receipts[side].run.date_utc.slice(0, 10) + ' | Driftproof', 'earlier rungs unchanged');
    assert.equal(rungs.at(-1), r.receipts[side].skill.name + ' on Haiku 5.5, ' + r.receipts[side].run.date_utc.slice(0, 10) + ', ' + r.receipts[side].skill.content_hash.slice(0, 12) + ' | Driftproof');
  }
  const twin = { rel: 'receipts/scratch/twin.json', receipt: rows[0].receipts.a };
  assert.throws(() => P.receiptTitles([twin, { ...twin, rel: 'receipts/scratch/other.json' }]), /every title rung/);
});

// Spec 743 A-743-3: docs/tokens.css loads after this page's stylesheet, so at equal specificity a shared
// rule beats the page's own. A rule here may not lead with a class the shared stylesheets also select.
const selectorsOf = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[a-z-]+[^{;]*\{/g, '').replace(/\{[^{}]*\}/g, ';').replace(/\}/g, ';').split(/[;,]/).map((x) => x.trim()).filter(Boolean);
function classClashes(pageCss, sharedCss) {
  const shared = new Set(selectorsOf(sharedCss).flatMap((s) => [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])));
  return selectorsOf(pageCss).filter((s) => { const lead = /^\.([a-zA-Z][\w-]*)/.exec(s); return lead && shared.has(lead[1]); });
}
test('AC-9: a rule of this page\'s stylesheet does not lead with a class the shared stylesheets select', () => {
  const page = read('docs/which-section/style.css'), shared = read('docs/tokens.css') + '\n' + read('docs/style.css');
  assert.deepEqual(classClashes(page, shared), []);
  assert.deepEqual(classClashes(page + '\n.section-eyebrow { color: red; }', shared), ['.section-eyebrow'], 'plant: the home page\'s class reads red');
});

// Spec 743 AC-11 and A-743-1: the removal rule as the manifest words it, built here from those words
// alone. A heading line starts with one to six # characters and a space, outside a fenced code block;
// the first level-one heading is the title and is not measured.
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function headingLines(bytes) {
  const out = []; let fence = null;
  for (let at = 0; at < bytes.length;) {
    const nl = bytes.indexOf(10, at), next = nl < 0 ? bytes.length : nl + 1;
    const line = bytes.subarray(at, next).toString('utf8').replace(/\r?\n$/, '');
    const marks = /^(`{3,}|~{3,})/.exec(line);
    if (fence) { if (marks && marks[1][0] === fence[0] && marks[1].length >= fence.length && line.trim() === marks[1]) fence = null; }
    else if (marks) fence = marks[1];
    else { const h = /^(#{1,6}) +(.*)$/.exec(line); if (h) out.push({ level: h[1].length, heading: h[2].trim(), start: at }); }
    at = next;
  }
  return out;
}
function largest(bytes, ends) {
  const lines = headingLines(bytes), title = lines.find((h) => h.level === 1);
  return lines.filter((h) => h !== title).map((h) => {
    const next = lines.slice(lines.indexOf(h) + 1).find((n) => ends(n, h)), end = next ? next.start : bytes.length;
    return { ...h, end, bytes: end - h.start };
  }).sort((a, b) => b.bytes - a.bytes)[0];
}
const ANY_LEVEL = () => true, SAME_OR_HIGHER = (next, h) => next.level <= h.level;
const without = (bytes, s) => Buffer.concat([bytes.subarray(0, s.start), bytes.subarray(s.end)]);
function readsTheRunRule(rule, note) {
  assert.match(rule, /next heading line of any level/, 'the rule is the any-level measure');
  assert.doesNotMatch(rule, /same or (a )?higher/, 'the rule is not the other measure');
  assert.match(note, /--list-sections/);
  assert.match(note, /next heading of the same or a higher level/, 'the note says how --list-sections measures');
  assert.match(note, /any-level measure/, 'the note says the cards used the any-level measure');
}

test('AC-11: the manifest and the page state the rule the run applied and name --list-sections as different', () => {
  const { htmlToText } = require('../scripts/html-text.js');
  const manifest = JSON.parse(read(DIR + '/manifest.json')), html = read('docs/which-section/index.html');
  readsTheRunRule(manifest.removal_rule, manifest.list_sections_note || '');
  const text = htmlToText(html.slice(html.indexOf('id="rules"'), html.indexOf('id="skills"')), { collapse: true });
  const split = text.indexOf('This is not how the');
  const rule = text.slice(0, split), note = text.slice(split);
  readsTheRunRule(rule, note);
  for (const [name, surface] of [['manifest', read(DIR + '/manifest.json')], ['page', html], ['llms', read('docs/llms.txt')]]) assert.doesNotMatch(surface, /longest section/i, name);
  assert.throws(() => readsTheRunRule(rule.replace('of any level', 'of the same or a higher level'), note), undefined, 'plant: the old rule reads red');
  assert.throws(() => readsTheRunRule(rule, note.replace('any-level measure', 'measure')), undefined, 'plant: a note that does not name the measure reads red');
  assert.throws(() => readsTheRunRule(rule, ''), undefined, 'plant: a page without the note reads red');
});

// The third-party bytes are not in the tree, so this row reads them from the directory SPEC743_PINNED names.
const PINNED = process.env.SPEC743_PINNED;
test('AC-11 plant: the stated rule on each pinned file gives the card\'s heading, bytes and reduced-file sha256', { skip: PINNED && fs.existsSync(PINNED) ? false : 'set SPEC743_PINNED to a directory holding <skill>/SKILL.md, the pinned third-party files, which are not committed' }, () => {
  const { listSections, removeSection } = require('../lib/compare');
  const html = read('docs/which-section/index.html');
  let missed = 0;
  for (const s of JSON.parse(read(DIR + '/manifest.json')).skills) {
    const a = fs.readFileSync(path.join(PINNED, s.skill, 'SKILL.md'));
    assert.equal(sha(a), s.a.sha256, s.skill + ': these are the pinned bytes');
    const stated = largest(a, ANY_LEVEL), reduced = without(a, stated);
    assert.equal(stated.heading, s.removed.heading); assert.equal(stated.level, s.removed.level); assert.equal(stated.bytes, s.removed_bytes);
    assert.equal(sha(reduced), s.b.sha256, s.skill + ': the stated rule reproduces the card');
    assert.ok(html.includes('>' + s.b.sha256 + '</data>'), s.skill + ': the card shows that hash');
    assert.ok(removeSection(a, s.removed.heading).bytes.equals(reduced), s.skill + ': naming the heading to --without-section gives the same file');
    const other = largest(a, SAME_OR_HIGHER);
    const listed = listSections(a).filter((x) => x.level > 1).sort((x, y) => y.bytes - x.bytes)[0];
    assert.equal(listed.heading, other.heading, s.skill + ': the other measure is the one --list-sections prints');
    if (sha(without(a, other)) !== s.b.sha256) { missed++; assert.equal(other.heading, 'Process', s.skill); }
  }
  assert.equal(missed, 2, 'plant: the same-or-higher measure misses the card on two of the three files, as the page says');
});

test('browser: the page oracle, its plants, HTML validity, keyboard, motion, scripts and both widths', { timeout: 300000 }, async () => {
  const { chromium } = require('playwright');
  const { HtmlValidate } = require('html-validate');
  const rows = expectedRows();
  const html = read('docs/which-section/index.html');
  const report = await new HtmlValidate(JSON.parse(read('.htmlvalidate.json'))).validateString(html);
  assert.ok(report.valid, JSON.stringify(report.results.flatMap((r) => r.messages)));
  assert.ok(html.includes('data-island="jargon-cards"'), 'plain-word cards mount');
  assert.ok(html.includes('href="/which-section/"'), 'the footer lists the page');
  for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.match(m[1], /\/islands\/loader\.js|\/copy-button\.js|cloudflareinsights\.com/, m[1]);
  const shots = fs.mkdtempSync('/var/tmp/which-section-shots-743-');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.includes('..')) { res.writeHead(400).end(); return; }
    const file = path.join(ROOT, 'docs', pathname, pathname.endsWith('/') ? 'index.html' : '');
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.route('https://**/*', (r) => r.abort());
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(origin + '/which-section/'); await page.evaluate(() => document.fonts.ready);
      await oracle(page, rows);
      const repo = await page.locator('[data-skill] p[data-quote="name"]').first().evaluate((e) => { const s = getComputedStyle(e), muted = getComputedStyle(e.closest('[data-skill]').querySelector('.section-facts dt')); return { style: s.fontStyle, family: s.fontFamily, color: s.color, muted: muted.color }; });
      assert.equal(repo.style, 'normal', 'the repository name does not take the home page eyebrow'); assert.match(repo.family, /Courier/); assert.equal(repo.color, repo.muted, 'the repository name is in the card\'s muted ink');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'fits ' + width);
      const motion = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => { const s = getComputedStyle(e); return s.animationName !== 'none' || s.transitionDuration.split(',').some((d) => parseFloat(d) > 0); }).length);
      assert.equal(motion, 0, 'no motion under prefers-reduced-motion');
      for (const a of await page.locator('main a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
        const dest = a.split('#')[0]; assert.ok(fs.existsSync(path.join(ROOT, 'docs', dest, dest.endsWith('/') ? 'index.html' : '')), a);
      }
      // Every link in main is reached by Tab, and the focused link shows an outline.
      const links = await page.locator('main a[href]').count();
      const reached = new Set(); let outlined = false;
      for (let i = 0; i < links + 200 && reached.size < links; i++) {
        await page.keyboard.press('Tab');
        const got = await page.evaluate(() => { const e = document.activeElement; if (!e || !e.closest('main') || e.tagName !== 'A') return null; const s = getComputedStyle(e); return { href: e.getAttribute('href'), outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 }; });
        if (got) { reached.add(got.href); outlined = outlined || got.outline; }
      }
      assert.equal(reached.size, links, 'every link reached by Tab at ' + width); assert.ok(outlined, 'focus outline');
      if (width === 390) {
        const clean = await page.locator('main').innerHTML();
        const plants = {
          'b-hash': () => { const d = [...document.querySelectorAll('[data-skill] data')].find((x) => /\.b\.sha256$/.test(x.dataset.at)); d.textContent = d.textContent.replace(/^./, (c) => (c === '0' ? '1' : '0')); },
          'task-line': () => { const p = document.querySelector('.reading-lines'); p.textContent = p.textContent.replace('too few answers', 'too few answer'); },
          'direction': () => { const h = document.querySelector('.section-headline'); h.textContent = h.textContent.replace('scored lower', 'scored higher'); },
          'caveat': () => { [...document.querySelectorAll('.page-caveats li')].find((li) => li.textContent.includes('length moved too')).remove(); },
          'limit-twice': () => { const li = [...document.querySelectorAll('.page-caveats li')].find((x) => x.textContent.includes('length moved too')); document.querySelector('[data-skill]').append(li.cloneNode(true)); },
          'chance': () => { [...document.querySelectorAll('.page-caveats li')].find((li) => li.textContent.includes('chance alone')).remove(); },
          'no-names': () => { document.querySelector('.section-names').remove(); },
          'upstream': () => { const p = document.querySelector('.reading-lines'); p.textContent += ' under the current upstream text'; },
          'false-range': () => { const p = document.querySelector('.reading-lines'); p.textContent += ' (the two score ranges do not overlap)'; },
          'causal': () => { const h = document.querySelector('.section-headline'); h.textContent = h.textContent.replace(/^With .* removed, /, 'Removing the section left '); },
          'nothing-else': () => { document.querySelector('main').append(' Nothing else changed.'); },
          'second-hash': () => { const c = document.createElement('code'); c.textContent = '392c6e6a10d199b2c6d895cd6ee91f0934292e3cf0c71279e79bce94cae04418'; document.querySelector('[data-skill]').append(c); },
          'advice': () => { document.querySelector('.section-headline').append(' Delete this section.'); },
          'number': () => { document.querySelector('main').append(' 93'); },
          'bytes': () => { const d = [...document.querySelectorAll('[data-skill] data')].find((x) => /\.a\.bytes$/.test(x.dataset.at)); d.textContent = String(Number(d.textContent) + 1); },
        };
        for (const [name, plant] of Object.entries(plants)) {
          await page.locator('main').evaluate((m, h) => { m.innerHTML = h; }, clean);
          await page.evaluate(plant);
          await assert.rejects(() => oracle(page, rows), undefined, name + ' must read red');
        }
        await page.locator('main').evaluate((m, h) => { m.innerHTML = h; }, clean);
        await oracle(page, rows);
      }
      await page.screenshot({ path: path.join(shots, 'which-section-' + width + '.png'), fullPage: false });
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
  console.log('Which-section screenshots: ' + shots);
});
