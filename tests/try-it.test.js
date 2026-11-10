// SPDX-License-Identifier: Apache-2.0
// Issue 726: the Try it yourself worksheet. Issue 745: its same-length fake. Every reading here is
// independent of the island: the rule comes from lib/stats.js and config.js, the tasks from the suites
// through build-tasks's bindSuite, the fake from lib/placebo.js, the words from lib/plain.js, the
// reminder from scripts/build-spot-the-fake.js, and the caveat sentences from this file.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const stats = require('../lib/stats');
const config = require('../config');
const plain = require('../lib/plain');
const { sha256 } = require('../lib/canonical');
const { placeboFor, PLACEBO_OPENING } = require('../lib/placebo');
const { suiteIdentity } = require('../lib/skill');
const { htmlToText } = require('../scripts/html-text.js');
const PAGE = 'docs/try-it/index.html';
const OLD_CAVEAT = 'There is no same-length fake here, so this does not show that meaningful instructions beat any added text.';
// The third caveat as AC-16 first fixed it: one fake cannot show this (A-726-2).
const OVERCLAIM = 'The fake is the same length as your instructions and about a market town, so this shows whether your words did more than any text of that length; it does not show what the instructions would do in a different chat, model or day.';
// AC-21, as the static steps and the locked panel carry it.
const TURN_OFF = 'Before you collect answers, turn off what your app adds by itself: saved custom instructions, personalization, project instructions and memory. Keep them off until you have all nine answers. If they stay on, every answer gets them and the test cannot see a difference. Then paste the text by hand, where this page says to.';
const CAVEATS = [
  "Your scores are one reader's, not a judge's.",
  'Three answers per arm is a first look, not a measurement.',
  'The fake is an unrelated passage about a market town, the same length as your instructions. Scoring above it can show at most that your words did more than this one unrelated text of the same length, on this task, on this day. It does not show that they beat every text of that length, or what the instructions would do in a different chat, model or day.',
  'Memory and hidden routing in your assistant were not controlled.',
  'Driftproof does it with several answers per arm, a judge model and a fake of the same length.',
];
const ARMS = [['with', 'With the instructions', 'W'], ['fake', 'With the fake', 'F'], ['without', 'With nothing', 'N']];
const READINGS = [['with-without', 'with', 'without'], ['with-fake', 'with', 'fake'], ['fake-without', 'fake', 'without']];
const REMINDER = /const REMINDER = '([^']+)'/.exec(read('scripts/build-spot-the-fake.js'))[1];
const NO_FAKE = 'No fake was built';
const FORBIDDEN = /\bverdicts?\b|\breceipts?\b|\d\s?%|\bPASSED\b|\bNO_EFFECT\b|\bUNDERPOWERED\b|\bimprovement\b|\bregression\b/;
const band = () => import(pathToFileURL(path.join(root, 'lib/import-core/band.mjs')).href);
const digest = async bytes => new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
const encode = text => new TextEncoder().encode(text);
// The island `/placebo/` mounts, for the refusal words the module gives the worksheet.
let fakeIslandPromise;
const fakeIsland = () => fakeIslandPromise ||= import('data:text/javascript;base64,' + Buffer.from(read('docs/islands/placebo.js').replace("'../import-core/placebo.mjs'", JSON.stringify(pathToFileURL(path.join(root, 'docs/import-core/placebo.mjs')).href))).toString('base64'));

// The reading, from the library alone. Scores are guide scores 0 to 4, or null for "cannot score".
function expectedState(withScores, withoutScores) {
  const arm = xs => xs.filter(x => Number.isFinite(x)).map(x => x / 4);
  const w = arm(withScores), o = arm(withoutScores);
  if (w.length < 3 || o.length < 3) return { state: 'too_few', w, o };
  const a = stats.aggregateBands(o.map(m => ({ mean: m }))), b = stats.aggregateBands(w.map(m => ({ mean: m })));
  const v = stats.bandVerdict(a.mean, a.stddev, b.mean, b.stddev);
  const state = v !== stats.WITHIN_NOISE && Math.abs(b.mean - a.mean) >= config.EFFECT_FLOOR ? 'separated' : 'overlapping';
  return { state, w, o, a, b };
}
const two = x => (x * 4).toFixed(2);
// AC-24: WCAG contrast from two #rrggbb tokens, and the token a field's edge is painted in.
const tokens = Object.fromEntries([...read('docs/tokens.css').matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/gm)].map(m => [m[1], m[2]]));
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminance = hex => { const [r, g, b] = channels(hex).map(c => c / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// AC-23: where focus stood the moment Lock's click handler had run its synchronous part.
const watchLock = page => page.evaluate(() => { const l = document.querySelector('[data-lock]'); l.addEventListener('click', () => { window.afterLock = { onTurnOff: document.activeElement.hasAttribute('data-turn-off'), lockDisabled: l.disabled }; }); });
const lockFocusOracle = r => assert.deepEqual(r, { onTurnOff: true, lockDisabled: true }, 'focus moves to the turn-off step before Lock disables itself');
const fieldEdgeToken = css => { const m = /\.try-page :is\(select, textarea, input\) \{[^}]*border-color: var\((--[a-z0-9-]+)\)/.exec(css); assert.ok(m, 'a field edge is declared'); return m[1]; };
const fieldEdgeOracle = css => { const edge = fieldEdgeToken(css); for (const ground of ['--surface', '--desk', '--sheet']) { const ratio = contrast(tokens[edge], tokens[ground]); assert.ok(ratio >= 3, edge + ' on ' + ground + ': ' + ratio.toFixed(2) + ':1'); } };

function payload(html) {
  const m = /data-tasks-source="([A-Za-z0-9+/=]+)"/.exec(html);
  assert.ok(m, 'embedded tasks exist');
  return JSON.parse(zlib.gunzipSync(Buffer.from(m[1], 'base64')).toString('utf8'));
}
// The tasks as the suites hold them, bound as scripts/build-tasks.js binds them.
function expectedSkills() {
  const S = require('../scripts/sugar-pill-page'), B = require('../scripts/build-tasks');
  return S.skillsOf().map(s => {
    const suites = s.measurements.map(m => B.bindSuite(fs.readFileSync(path.join(root, 'docs/skills/receipts/issue-408/suites/' + m.row.attempt.protocol.evals_sha256 + '.json')), m));
    for (const raw of suites) assert.equal(JSON.stringify(raw), JSON.stringify(suites[0]));
    return { name: s.name, repository: s.repository, href: '/tasks/' + s.repository + '/' + s.name + '/', suite_hash: suiteIdentity(suites[0]).suiteHash, tasks: suites[0].cases.map(c => ({ id: c.id, prompt: c.prompt, rubric: c.rubric })) };
  });
}
function tasksOracle(data) { assert.deepEqual(data, { skills: expectedSkills() }); }
function floorOracle(text) { assert.ok(!text.includes(String(config.EFFECT_FLOOR)), 'the floor is typed'); }
function caveatOracle(html) {
  const aside = /<aside class="try-caveats"[\s\S]*?<\/aside>/.exec(html);
  assert.ok(aside, 'the caveat block exists');
  // A plain-word marker (spec 689) wraps one word of a sentence; the word comes back as written.
  const text = aside[0].replace(/<!--driftproof:term--><a [^>]*>([^<]*)<\/a><!--\/driftproof:term-->/g, '$1').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  for (const s of CAVEATS) assert.ok(text.includes(s), 'caveat present: ' + s);
  assert.ok(!text.includes(OLD_CAVEAT), 'the old sentence is gone');
  assert.ok(!text.includes(OVERCLAIM) && !/any text of that length/i.test(text), 'one fake is not any text of that length');
  assert.ok(aside[0].includes('href="/how-it-works/"'));
}
function resultOracle(text) { assert.doesNotMatch(text, FORBIDDEN); assert.doesNotMatch(text, /the fake won/i); }
// The frame the reports' placebo line opens with, read from lib/plain.js with this fake's byte count, in the page's one word for it.
function sugarFrame(bytes) { const t = plain.placeboText({ placebo: { bytes } }, { line: '@@', with: 0, placebo: 0 }); assert.ok(t.includes('a same-length placebo'), 'the reports open with these words'); return t.slice(0, t.indexOf('@@')).replace('a same-length placebo', 'the same-length fake'); }
// A fixed sentence serves three pairs of arms, so it names none of them (A-726-2).
function armFreeOracle(s) { assert.doesNotMatch(s, /\bthe instructions\b|\bthe fake\b/, 'a fixed sentence names an arm: ' + s); }

test('the band module equals the library: floor, bands, rule and words', async () => {
  const M = await band();
  assert.equal(M.EFFECT_FLOOR, config.EFFECT_FLOOR);
  assert.equal(M.MIN_PER_ARM, 3);
  const grid = Array.from({ length: 21 }, (_, i) => i / 20);
  for (const a of grid) for (const b of grid) for (const ha of [0, 0.1, 0.3]) for (const hb of [0, 0.05, 0.25]) {
    const lib = stats.bandVerdict(a, ha, b, hb);
    assert.equal(M.bandVerdict(a, ha, b, hb), lib === stats.WITHIN_NOISE ? M.NOT_SEPARATED : lib);
  }
  assert.notEqual(M.NOT_SEPARATED, stats.WITHIN_NOISE, 'the module names the not-separated value without the lexicon');
  let seed = 726;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(rnd() * 6), xs = Array.from({ length: n }, () => Math.floor(rnd() * 5) / 4);
    assert.deepEqual(M.aggregateBands(xs.map(m => ({ mean: m }))), stats.aggregateBands(xs.map(m => ({ mean: m }))));
    const k = Math.floor(rnd() * 6), ys = Array.from({ length: k }, () => Math.floor(rnd() * 5) / 4);
    const r = M.readArms(xs, ys), e = expectedState(xs.map(x => x * 4), ys.map(y => y * 4));
    assert.equal(r.state, e.state, JSON.stringify({ xs, ys }));
    if (e.state !== 'too_few') { assert.equal(r.with.mean, e.b.mean); assert.equal(r.with.stddev, e.b.stddev); assert.equal(r.without.mean, e.a.mean); assert.equal(r.without.stddev, e.a.stddev); }
    assert.equal(r.with.n, xs.length); assert.equal(r.without.n, ys.length);
  }
  assert.deepEqual(Object.keys(M.SENTENCES).sort(), ['overlapping', 'separated', 'too_few']);
  assert.ok(M.SENTENCES.too_few.startsWith(plain.LABELS.UNDERPOWERED), 'too few opens with the plain label');
  const clause = plain.KEY.PASSED.slice(plain.KEY.PASSED.indexOf('the two ranges of scores'), plain.KEY.PASSED.indexOf(String(config.EFFECT_FLOOR))).trim();
  assert.ok(clause.length > 40 && M.SENTENCES.separated.includes(clause), 'separated carries the key clause: ' + clause);
  assert.ok(M.SENTENCES.overlapping.endsWith('This does not mean the two sets are the same.'), 'overlap is not evidence of sameness');
  for (const s of Object.values(M.SENTENCES)) armFreeOracle(s);
  assert.throws(() => armFreeOracle('Overlapping at this sample size. This does not mean the instructions did nothing.'), 'the sentence that named the wrong arm reads red');
  assert.match(plain.KEY.UNDERPOWERED, /does not mean the skill does nothing/);
  for (const s of Object.values(M.SENTENCES)) resultOracle(s);
  // Plant: a module copy with another floor reads red against config.js.
  const scratch = fs.mkdtempSync('/var/tmp/try-it-band-726-');
  fs.copyFileSync(path.join(root, 'lib/import-core/math.mjs'), path.join(scratch, 'math.mjs'));
  const src = read('lib/import-core/band.mjs');
  const planted = src.replace(/EFFECT_FLOOR = [0-9.]+/, 'EFFECT_FLOOR = ' + (config.EFFECT_FLOOR + 0.01));
  assert.notEqual(planted, src);
  fs.writeFileSync(path.join(scratch, 'band.mjs'), planted);
  const P = await import(pathToFileURL(path.join(scratch, 'band.mjs')).href);
  assert.throws(() => assert.equal(P.EFFECT_FLOOR, config.EFFECT_FLOOR));
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, ['scripts/build-import-core.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(root, 'docs/import-core/band.mjs')));
});

test('the page embeds the suites\' own tasks, the fixed caveats and no typed floor; plants read red', async () => {
  const html = read(PAGE), data = payload(html);
  tasksOracle(data);
  assert.ok(data.skills.length >= 20 && data.skills.every(s => s.tasks.length >= 1));
  const bad = structuredClone(data); bad.skills[0].tasks[0].prompt += 'x';
  assert.throws(() => tasksOracle(bad), 'one prompt byte reads red');
  const B = require('../scripts/build-try-it');
  const S = require('../scripts/sugar-pill-page');
  const altered = structuredClone(S.skillsOf()[0]); altered.measurements[0].receipt.suite.suite_hash = '0'.repeat(64);
  assert.throws(() => B.skillsData([altered]), 'a receipt whose suite hash is altered refuses the builder');
  B.check();
  assert.ok(/^\/\/ Site builder: \{"href":"\/try-it\/","label":"Try it yourself"\}$/m.test(read('scripts/build-try-it.js')));
  const mainHtml = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
  const visible = mainHtml.replace(/data-tasks-source="[^"]*"/, '').replace(/<[^>]+>/g, ' ');
  floorOracle(visible);
  assert.throws(() => floorOracle(visible + ' the floor is ' + config.EFFECT_FLOOR), 'a typed floor reads red');
  floorOracle(read('docs/islands/try-it.js'));
  caveatOracle(html);
  assert.throws(() => caveatOracle(html.replace(CAVEATS[3], '')), 'a missing caveat reads red');
  // AC-16: the caveat block changes by one sentence; the old sentence is gone from the whole page.
  const plainHtml = html.replace(/<!--driftproof:term--><a [^>]*>([^<]*)<\/a><!--\/driftproof:term-->/g, '$1').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.ok(!mainHtml.includes(OLD_CAVEAT) && !plainHtml.includes(OLD_CAVEAT), 'the old sentence is still on the page');
  assert.throws(() => caveatOracle(plainHtml.replace(CAVEATS[2], OLD_CAVEAT)), 'the old sentence in the new one\'s place reads red');
  assert.throws(() => caveatOracle(plainHtml.replace(/(<aside class="try-caveats"[^>]*>)/, '$1<p>' + OLD_CAVEAT + '</p>')), 'the old sentence beside the new one reads red');
  assert.ok(!mainHtml.includes('not part of this page yet'), 'the About section no longer says the fake is not here');
  // A-726-2: the overclaim sentence reads red, in the caveat block and anywhere on the page.
  assert.ok(!plainHtml.includes(OVERCLAIM), 'the overclaim sentence is still on the page');
  assert.throws(() => caveatOracle(plainHtml.replace(CAVEATS[2], OVERCLAIM)), 'the overclaim sentence reads red');
  // AC-21: a page without the turn-off step reads red.
  const turnOffOracle = text => assert.ok(text.includes(TURN_OFF), 'the turn-off step is on the page');
  turnOffOracle(htmlToText(plainHtml));
  assert.throws(() => turnOffOracle(htmlToText(plainHtml).replace(TURN_OFF, '')), 'a page without the turn-off step reads red');
  // AC-22: what the page asks and what it keeps.
  const asksOracle = text => { assert.ok(!/a few minutes/.test(text), 'the old estimate'); assert.ok(text.includes('about 30 minutes: nine new chats, then nine scores'), 'the estimate'); };
  asksOracle(visible);
  assert.throws(() => asksOracle(visible + ' a few minutes'), 'the old estimate reads red');
  const lede = /<p class="lede">([^<]*)<\/p>/.exec(mainHtml)[1];
  const ledeOracle = t => { for (const w of ['custom instructions', 'saved prompt', 'CLAUDE.md']) assert.ok(t.includes(w), 'the lede names ' + w); };
  ledeOracle(lede);
  assert.throws(() => ledeOracle('Test your own instructions the way Driftproof does.'), 'a lede without custom instructions reads red');
  const keepsOracle = text => { assert.ok(!text.includes('Nothing is stored or sent'), 'stored and not stored'); assert.ok(text.includes('Nothing you type is sent anywhere'), 'nothing is sent'); assert.ok(text.includes('This browser keeps your unfinished worksheet') && text.includes('the task, the guide, the instructions, the model name and the answers, never your scores'), 'what stays in this browser'); };
  keepsOracle(visible);
  assert.throws(() => keepsOracle(visible + ' Nothing is stored or sent'), 'a page saying nothing is stored reads red');
  // A-726-2: one word for this text.
  const oneWordOracle = text => assert.doesNotMatch(text, /placebo/i, 'one word for the reader');
  oneWordOracle(visible);
  assert.throws(() => oneWordOracle(visible + ' a placebo'), 'the other word reads red');
  // The static fallback: the steps in words and the link to the tasks, inside the mount.
  const mount = /<section[^>]*data-island="try-it"[\s\S]*?<\/section>/.exec(html)[0];
  assert.ok((mount.match(/<li\b/g) || []).length >= 5 && mount.includes('<ol class="try-steps"') && mount.includes('href="/tasks/"'));
  assert.ok(mount.includes('nine answers') && !mount.includes('six answers'), 'the fallback counts the nine answers');
  // Discovery through the marker.
  assert.ok(require('../scripts/reader-pages').pages().some(p => p.href === '/try-it/' && p.label === 'Try it yourself'));
  for (const file of ['docs/llms.txt', 'docs/llms-full.txt', 'docs/sitemap-pages.xml', 'README.md', 'docs/index.html', 'docs/reports/018/index.html']) assert.ok(read(file).includes('/try-it/'), file + ' lists the page');
  assert.ok(Object.hasOwn(JSON.parse(read('docs/data/page-dates.json')).dates, 'try-it/index.html'), 'page dates carry the page');
  const home = read('docs/index.html'), hero = home.slice(home.indexOf('id="hero"'), home.indexOf('</section>', home.indexOf('id="hero"')));
  assert.ok(hero.includes('href="/try-it/"'), 'a home door links the page');
  assert.equal(require('../scripts/build-head-tags').render(html, 'try-it/index.html'), html, 'the head tags are a fixed point');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]).sort();
  assert.deepEqual(scripts, ['/copy-button.js', '/islands/loader.js', 'https://static.cloudflareinsights.com/beacon.min.js']);
  assert.ok(!/animation|transition/.test(read('docs/try-it/style.css')), 'no motion to guard');
  // AC-24: a field's edge reaches 3:1 from the tokens; a field edge under 3:1 reads red.
  const pageCss = read('docs/try-it/style.css');
  fieldEdgeOracle(pageCss);
  assert.throws(() => fieldEdgeOracle(pageCss.replace(/(\.try-page :is\(select, textarea, input\) \{[^}]*border-color: var\()--[a-z0-9-]+/, '$1--border-strong')), /--border-strong on --surface: 2\.15:1/, 'a field edge under 3:1 reads red');
  // AC-19, AC-20: the island sends nothing and moves nothing. AC-11: it builds the fake through the module.
  const island = read('docs/islands/try-it.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(island, /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\.cookie\s*=/, 'the island sends nothing');
  assert.doesNotMatch(island, /\.animate\(|requestAnimationFrame|transition/, 'the island moves nothing');
  assert.match(island, /from '\.\/placebo\.js'/, 'the fake comes from the island /placebo/ uses');
  assert.doesNotMatch(island, /\b(?:prev|next)\.disabled\b/, 'the deck buttons never disable themselves');
  assert.throws(() => assert.doesNotMatch(island + ' fetch(url)', /\bfetch\b/), 'a fetch in the island reads red');
  const { HtmlValidate } = require('html-validate');
  const report = await new HtmlValidate(JSON.parse(read('.htmlvalidate.json'))).validateString(html);
  assert.ok(report.valid, JSON.stringify(report.results.flatMap(r => r.messages)));
});

test('the module\'s refusal words are the worksheet\'s, for every text it refuses', async () => {
  const { buildFake } = await fakeIsland();
  const refused = async bytes => { try { await buildFake(bytes, 'context', digest); } catch (e) { return e.message; } throw new Error('not refused'); };
  // Not UTF-8 cannot be pasted into a text box, so the module is asked directly.
  assert.match(await refused(new Uint8Array([255])), /not UTF-8/);
  assert.match(await refused(encode('a\0b')), /NUL/);
  assert.match(await refused(encode(' \n​')), /no letter or digit/);
  assert.match(await refused(encode('x'.repeat(262145))), /more than/);
  // The runner's fake is the module's: the same bytes in context mode give the same hash.
  const text = 'Always answer in plain words.\n字', bytes = encode(text), got = await buildFake(bytes, 'context', digest);
  const want = placeboFor({ skillText: text, seed: sha256(Buffer.from(bytes)) });
  assert.deepEqual({ text: got.text, bytes: got.bytes, sha256: got.sha256, seed: got.seed }, { text: want.text, bytes: want.bytes, sha256: want.sha256, seed: want.seed });
});

test('phone and desktop: frozen first, three arms, blind scoring, the library\'s readings, the record, privacy', { timeout: 600000 }, async () => {
  const http = require('node:http');
  const { chromium } = require('playwright');
  const M = await band();
  const { buildFake } = await fakeIsland();
  const shots = fs.mkdtempSync('/var/tmp/try-it-shots-726-');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'); let file = path.join(root, 'docs', decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, 'docs') + path.sep)) { res.writeHead(403).end(); return; }
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const skills = expectedSkills(), first = skills[0], task = first.tasks[0];
  const hostile = '<img src=x onerror=alert(1)> <script>alert(1)</script> [go](javascript:alert(1)) &lt;svg onload=alert(1)&gt;';
  const own = { prompt: 'Explain to a new colleague why a plan needs a rollback step. Keep it under two hundred words.', guide: 'Give one point for each criterion met. 1. Names what can go wrong without a rollback. 2. Gives one concrete example. 3. Stays under the word limit. 4. Ends with a recommendation.', instructions: 'Always answer in plain words. Open with the one-sentence answer. Then give one example.' };
  const want = placeboFor({ skillText: own.instructions, seed: sha256(Buffer.from(own.instructions)) });
  // Each pasted answer carries a token: W with the instructions, F with the fake, N with nothing.
  const scenarios = [
    // Desktop, tight bands: two readings separated, one overlapping, hostile text in two arms.
    { width: 1280, answers: { with: ['# Heading\n\ntoken-W1 **bold** answer. ' + hostile, 'token-W2 A second answer.\n\n- one\n- two', 'token-W3 Third answer.'], fake: ['token-F1 ' + hostile, 'token-F2 another', 'token-F3 last'], without: ['token-N1 plain answer', 'token-N2 another', 'token-N3 last'] }, scores: { W1: 4, W2: 4, W3: 3, F1: 2, F2: 1, F3: 2, N1: 1, N2: 2, N3: 1 } },
    // Phone, the fake's arm short by one scored answer: the readings it is in read too few; the other reads.
    { width: 390, answers: { with: ['token-W1 one', 'token-W2 two', 'token-W3 three'], fake: ['token-F1 one', 'token-F2 two', 'token-F3 three'], without: ['token-N1 one', 'token-N2 two', 'token-N3 three'] }, scores: { W1: 3, W2: 2, W3: 3, F1: 3, F2: 'none', F3: 2, N1: 3, N2: 2, N3: 2 } },
    // Phone, two arms short: every reading reads too few and no figure is shown.
    { width: 390, answers: { with: ['token-W1 one', 'token-W2 two', 'token-W3 three'], fake: ['token-F1 one', 'token-F2 two', 'token-F3 three'], without: ['token-N1 one', 'token-N2 two', 'token-N3 three'] }, scores: { W1: 3, W2: 'none', W3: 3, F1: 3, F2: 'none', F3: 2, N1: 3, N2: 2, N3: 2 } },
  ];
  const givenOf = sc => Object.fromEntries(ARMS.map(([arm, , t]) => [arm, [1, 2, 3].map(i => sc.scores[t + i] === 'none' ? null : sc.scores[t + i])]));
  // The readings the page showed, against the library's on the nine scores given.
  const readingOracle = (shown, given) => { assert.deepEqual(Object.keys(shown), READINGS.map(r => r[0]), 'three readings, in the fixed order'); for (const [id, a, b] of READINGS) assert.equal(shown[id], M.SENTENCES[expectedState(given[a], given[b]).state], id); };
  const floorShown = text => { const m = /The floor is ([0-9.]+) on/.exec(text); assert.ok(m, 'the floor is stated'); assert.equal(m[1], String(config.EFFECT_FLOOR)); };
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const sc of scenarios) {
      const { width } = sc;
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
      await context.route('https://**/*', r => r.abort());
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
      await page.goto(origin + '/try-it/'); await page.waitForSelector('#try-task');
      let loaded = requests.length;
      // AC-26: one status element, present and empty from the start, never hidden, holding no button.
      const statusOracle = () => page.evaluate(() => { const s = document.querySelector('[data-announce]'); if (!s) throw new Error('no status element'); if (s.getAttribute('role') !== 'status') throw new Error('not a status element'); if (s.hidden || getComputedStyle(s).display === 'none') throw new Error('the status element starts hidden'); if (s.querySelector('button')) throw new Error('a button in the live region'); return s.textContent; });
      assert.equal(await statusOracle(), '', 'the status element starts empty');
      await page.evaluate(() => { document.querySelector('[data-announce]').hidden = true; });
      await assert.rejects(statusOracle(), /starts hidden/, 'a status element that starts hidden reads red');
      await page.evaluate(() => { document.querySelector('[data-announce]').hidden = false; });
      assert.equal(await page.locator('[data-task-ask]').getAttribute('role'), null, 'the ask is not a live region that starts hidden');
      assert.equal(await page.locator('[data-fake-refusal]').getAttribute('role'), null, 'the refusal is not a live region that starts hidden');
      const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert.equal(await fits(), true, 'fits ' + width);
      // Plant: a wide element reads red.
      await page.evaluate(() => { const d = document.createElement('div'); d.id = 'plant-wide'; d.style.width = '3000px'; d.style.height = '1px'; document.querySelector('main').appendChild(d); });
      assert.equal(await fits(), false); await page.evaluate(() => document.getElementById('plant-wide').remove());
      // The one renderer, by identity (spec 702 AC-4).
      assert.equal(await page.evaluate(async () => (await import('/islands/try-it.js')).renderAnswer === (await import('/islands/can-you-tell.js')).renderAnswer), true);
      // AC-1: a picked task fills the exact bytes, read-only; own texts are editable.
      await page.selectOption('#try-task', first.repository + '/' + first.name + '#' + task.id);
      assert.equal(await page.inputValue('#try-prompt'), task.prompt); assert.equal(await page.inputValue('#try-guide'), task.rubric);
      assert.equal(await page.locator('#try-prompt').evaluate(e => e.readOnly), true);
      assert.equal(await page.locator('[data-lock]').isDisabled(), true, 'lock needs instructions');
      await page.selectOption('#try-task', '');
      assert.equal(await page.locator('#try-prompt').evaluate(e => e.readOnly), false);
      // AC-24: the edge Chromium paints on each kind of field is the token the static check read.
      const edges = await page.evaluate(() => ['#try-task', '#try-prompt', '#try-model'].map(s => getComputedStyle(document.querySelector(s)).borderTopColor));
      assert.deepEqual(edges, new Array(3).fill('rgb(' + channels(tokens[fieldEdgeToken(read('docs/try-it/style.css'))]).join(', ') + ')'));
      if (width === 1280) {
        // AC-25: the arrow keys over typed text keep the text; only an explicit choice replaces it.
        await page.fill('#try-prompt', 'My own prompt'); await page.fill('#try-guide', 'My own guide');
        const keptOracle = async () => { assert.equal(await page.inputValue('#try-prompt'), 'My own prompt'); assert.equal(await page.inputValue('#try-guide'), 'My own guide'); };
        await page.evaluate(() => { window.statusWrites = 0; new MutationObserver(m => { window.statusWrites += m.length; }).observe(document.querySelector('[data-announce]'), { childList: true, characterData: true, subtree: true }); });
        await page.locator('#try-task').focus();
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
        assert.notEqual(await page.inputValue('#try-task'), '', 'the arrow keys moved the list');
        await keptOracle();
        assert.equal(await page.locator('[data-task-ask]').isVisible(), true, 'the page asks before replacing');
        // AC-26: the ask is said through the status element, once, however many keys were pressed.
        assert.equal(await statusOracle(), await page.locator('[data-task-ask] p').innerText(), 'the status element says the ask');
        const writesOracle = n => assert.equal(n, 1, 'the ask is announced once');
        writesOracle(await page.evaluate(() => window.statusWrites));
        assert.throws(() => writesOracle(3), 'a message written again on every arrow key reads red');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('driftproof-try-it')).task), '', 'arrowing stores no task');
        await page.locator('[data-task-keep]').focus(); await page.keyboard.press('Enter');
        await keptOracle();
        assert.equal(await page.inputValue('#try-task'), '', 'keeping returns the list');
        assert.equal(await page.locator('[data-task-ask]').isVisible(), false);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'try-task', 'keeping hands focus to the list');
        assert.equal(await statusOracle(), '', 'the status element empties when the ask closes');
        // The plant: the explicit choice replaces the text, and the same oracle then reads red.
        await page.keyboard.press('ArrowDown');
        await page.locator('[data-task-replace]').focus(); await page.keyboard.press('Enter');
        assert.equal(await page.inputValue('#try-prompt'), task.prompt, 'an explicit choice fills the task');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'try-task', 'replacing hands focus to the list');
        await assert.rejects(keptOracle(), 'text replaced reads red against the kept-text oracle');
        await page.selectOption('#try-task', '');
        assert.equal(await page.inputValue('#try-prompt'), '', 'leaving a published task clears only its own text');
      }
      await page.fill('#try-prompt', own.prompt); await page.fill('#try-guide', own.guide); await page.fill('#try-model', 'Test model');
      if (width === 1280) {
        // AC-8: the unfinished worksheet survives a reload, under one key.
        await page.reload(); await page.waitForSelector('#try-task');
        loaded = requests.length;
        assert.equal(await page.inputValue('#try-prompt'), own.prompt);
        assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ['driftproof-try-it']);
      }
      assert.equal(await page.locator('[data-lock]').isDisabled(), true);
      await page.fill('#try-instructions', own.instructions);
      assert.equal(await page.locator('[data-lock]').isDisabled(), false);
      assert.equal(await page.locator('[data-answer="with-1"]').isVisible(), false, 'no paste box before the lock');
      // AC-11: the fake is built from these bytes and shown beside the instructions' byte count.
      await page.waitForFunction(() => document.querySelector('[data-fake-bytes]').textContent !== '');
      assert.equal(await page.locator('[data-fake-panel]').isVisible(), true);
      assert.equal(await page.locator('[data-fake-bytes]').innerText(), String(want.bytes));
      assert.equal(await page.locator('[data-fake-instructions-bytes]').innerText(), String(Buffer.byteLength(own.instructions)));
      assert.equal(await page.locator('[data-fake-opening]').innerText(), want.text.slice(0, PLACEBO_OPENING.length));
      await page.evaluate(() => { window.copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.copied.push(t); } }, configurable: true }); });
      await watchLock(page);
      await page.locator('[data-lock]').focus(); await page.keyboard.press('Enter');
      await page.waitForSelector('[data-copy="with"]'); await page.waitForSelector('[data-copy="fake"]');
      // AC-23: focus is on the turn-off step before Lock disables, and the next Tab reaches the copy buttons.
      lockFocusOracle(await page.evaluate(() => window.afterLock));
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-copy')), 'with', 'the next Tab reaches the first copy button');
      for (const id of ['#try-prompt', '#try-guide', '#try-instructions']) assert.equal(await page.locator(id).isDisabled(), true, id + ' is locked');
      await page.locator('[data-copy="with"]').click(); await page.locator('[data-copy="fake"]').click(); await page.locator('[data-copy="without"]').click();
      const copied = await page.evaluate(() => window.copied);
      assert.deepEqual(copied, [own.instructions + '\n\n' + own.prompt, want.text + '\n\n' + own.prompt, own.prompt]);
      // AC-11's oracle: the fake is placeboFor's for the same bytes, by hash and by length. Plant below.
      const fakeOracle = text => { assert.equal(sha256(Buffer.from(text)), want.sha256, 'the fake is the runner\'s fake'); assert.equal(Buffer.byteLength(text), Buffer.byteLength(own.instructions), 'the fake is the same length'); };
      const copiedFake = copied[1].slice(0, -('\n\n' + own.prompt).length);
      fakeOracle(copiedFake);
      assert.throws(() => fakeOracle(copiedFake.replace(/^./, 'X')), 'a fake that differs from placeboFor reads red');
      // AC-21: above the copy buttons and every paste box, before any answer is collected.
      const turnOffAbove = () => page.evaluate(() => { const t = document.querySelector('[data-turn-off]'); const before = s => !!(t.compareDocumentPosition(document.querySelector(s)) & Node.DOCUMENT_POSITION_FOLLOWING); return before('[data-copy="with"]') && before('[data-answer="with-1"]'); });
      assert.equal(await page.locator('[data-turn-off]').innerText(), TURN_OFF);
      assert.equal(await turnOffAbove(), true);
      await page.evaluate(() => { const t = document.querySelector('[data-turn-off]'); t.parentNode.append(t); });
      assert.equal(await turnOffAbove(), false, 'the step placed after the copy buttons reads red');
      await page.evaluate(() => { const t = document.querySelector('[data-turn-off]'), c = document.querySelector('.try-copies'); c.parentNode.insertBefore(t, c); });
      const hash = sha256(own.instructions);
      assert.ok(hash.startsWith((await page.locator('[data-hash]').innerText()).replace(/\W.*$/, '')), 'the shown hash is the instructions hash');
      // Step 2: nine boxes, each labelled new chat, same model.
      assert.equal(await page.locator('textarea[data-answer]').count(), 9);
      for (const [arm, armLabel] of ARMS) for (const i of [1, 2, 3]) {
        const label = await page.locator('label[for="try-answer-' + arm + '-' + i + '"]').innerText();
        assert.ok(label.startsWith(armLabel + ', answer ' + i), label);
        assert.match(label, /new chat, same model/i); assert.ok(label.includes('Test model'));
        await page.fill('[data-answer="' + arm + '-' + i + '"]', sc.answers[arm][i - 1]);
      }
      if (width === 390) {
        const boxes = await page.locator('textarea[data-answer]').evaluateAll(es => es.map(e => e.getBoundingClientRect().left));
        assert.ok(boxes.length === 9 && boxes.every(x => Math.abs(x - boxes[0]) < 2), 'the nine paste boxes stack at 390');
      }
      // AC-17: the draft carries the nine answers, restored on a reload, and never a score.
      const storedAnswers = () => page.evaluate(() => JSON.parse(localStorage.getItem('driftproof-try-it')).answers);
      assert.deepEqual(await storedAnswers(), sc.answers, 'the stored draft carries the nine answers');
      // AC-22: the draft holds what the page says it keeps, and nothing else.
      const storedOracle = ks => assert.deepEqual(ks.slice().sort(), ['answers', 'guide', 'instructions', 'locked', 'model', 'prompt', 'task'], 'the stored fields are the ones the page names');
      const storedFields = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('driftproof-try-it'))));
      storedOracle(storedFields);
      assert.throws(() => storedOracle(storedFields.concat('scores')), 'a stored field the page does not name reads red');
      if (width === 1280) {
        await page.reload(); await page.waitForSelector('[data-copy="fake"]');
        loaded = requests.length;
        assert.equal(await page.inputValue('[data-answer="fake-2"]'), sc.answers.fake[1], 'a reload restores the answers');
        assert.equal(await page.locator('[data-fake-bytes]').innerText(), String(want.bytes), 'a reload rebuilds the fake');
      }
      assert.ok(!(await page.evaluate(() => localStorage.getItem('driftproof-try-it'))).includes('"scores"'), 'scores are never stored');
      // Focus order: task, answers, then Reveal, in document order.
      assert.equal(await page.evaluate(() => { const o = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); const t = document.querySelector('#try-task'), a = document.querySelector('[data-answer="without-3"]'), r = document.querySelector('[data-reveal]'); return o(t, a) && o(a, r); }), true);
      await page.locator('[data-start]').click(); await page.waitForSelector('[data-deck]:not([hidden])');
      // AC-2, AC-12: blind. No arm label visible, none in the deck.
      const blindOracle = () => page.evaluate(() => {
        const deck = document.querySelector('[data-deck]'), armWords = /\bwith(?:out)? the instructions\b|\bwith the fake\b|\bwith nothing\b/i;
        if (armWords.test(deck.textContent) || armWords.test(deck.outerHTML)) throw new Error('arm label in the deck');
        for (const e of deck.querySelectorAll('*')) for (const a of e.attributes) if (/^(with|without|fake)$/i.test(a.value) || /arm/i.test(a.name)) throw new Error('arm in the deck markup');
        for (const e of document.querySelectorAll('body *')) { if (e.children.length) continue; if (armWords.test(e.textContent) && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden') throw new Error('arm label visible: ' + e.textContent.slice(0, 60)); }
        return true;
      });
      assert.equal(await blindOracle(), true);
      await page.evaluate(() => { const p = document.createElement('p'); p.id = 'plant-arm'; p.textContent = 'With the fake'; document.querySelector('[data-deck]').appendChild(p); });
      await assert.rejects(blindOracle(), /arm label/); await page.evaluate(() => document.getElementById('plant-arm').remove());
      assert.equal(await page.locator('[data-reveal]').isDisabled(), true);
      assert.match(await page.locator('[data-progress]').innerText(), /^Answer 1 of 9$/);
      assert.equal(await page.locator('[data-guide]').innerText(), own.guide, 'the frozen guide sits beside the answer');
      const heights = await page.locator('button[data-score]').evaluateAll(es => es.map(e => e.getBoundingClientRect().height));
      assert.equal(heights.length, 6); for (const h of heights) assert.ok(h >= 44, 'score button ' + h + 'px');
      // AC-23: a control that has focus never disables itself, and focus stays on it.
      const focusKept = sel => page.evaluate(s => { const b = document.querySelector(s), a = document.activeElement; if (b.disabled) throw new Error('the focused control disabled itself: ' + s); if (a !== b) throw new Error('focus left ' + s + ', now on ' + a.tagName); return true; }, sel);
      const progressIs = async n => assert.equal(await page.locator('[data-progress]').innerText(), 'Answer ' + n + ' of 9');
      // Score every answer by its token, through the keyboard. The deck's order is the island's shuffle.
      const order = [];
      for (let k = 0; k < 9; k++) {
        const text = await page.locator('[data-pane]').innerText();
        const token = /token-([WFN]\d)/.exec(text)[1]; order.push(token);
        if ((token === 'W1' || token === 'F1') && width === 1280) {
          const safe = await page.evaluate(() => { const p = document.querySelector('[data-pane]'); return { bad: p.querySelectorAll('a,img,script,svg').length, strong: p.querySelectorAll('strong').length, h: p.querySelectorAll('h4').length, text: p.textContent }; });
          assert.equal(safe.bad, 0); assert.ok(safe.text.includes('<img src=x onerror=alert(1)>') && safe.text.includes('&lt;svg onload=alert(1)&gt;'));
          if (token === 'W1') assert.ok(safe.strong >= 1 && safe.h >= 1);
          const paneOracle = () => page.evaluate(() => { if (document.querySelector('[data-pane]').querySelectorAll('a,img,script').length) throw new Error('markup in an answer'); return true; });
          await page.evaluate(() => { const i = document.createElement('img'); i.id = 'plant-img'; document.querySelector('[data-pane]').appendChild(i); });
          await assert.rejects(paneOracle(), /markup/); await page.evaluate(() => document.getElementById('plant-img').remove());
        }
        const score = sc.scores[token];
        const button = page.locator('button[data-score="' + score + '"]');
        await button.focus(); await page.keyboard.press(k % 2 ? 'Enter' : 'Space');
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        if (k < 8) { assert.equal(await page.locator('[data-reveal]').isDisabled(), true, 'reveal waits for every score'); await page.locator('[data-next]').focus(); await page.keyboard.press('Enter'); assert.match(await page.locator('[data-progress]').innerText(), new RegExp('^Answer ' + (k + 2) + ' of 9$')); await focusKept('[data-next]'); }
      }
      assert.equal(new Set(order).size, 9);
      // The ends of the deck, by keyboard with no refocus between presses: unavailable, focused, and still.
      await page.locator('[data-next]').focus();
      assert.equal(await page.locator('[data-next]').getAttribute('aria-disabled'), 'true');
      await page.keyboard.press('Enter'); await progressIs(9); await focusKept('[data-next]');
      await page.locator('[data-prev]').focus();
      assert.equal(await page.locator('[data-prev]').getAttribute('aria-disabled'), 'false');
      for (let n = 8; n >= 1; n--) { await page.keyboard.press('Enter'); await progressIs(n); await focusKept('[data-prev]'); }
      assert.equal(await page.locator('[data-prev]').getAttribute('aria-disabled'), 'true');
      await page.keyboard.press('Enter'); await progressIs(1); await focusKept('[data-prev]');
      await page.evaluate(() => { document.querySelector('[data-prev]').disabled = true; });
      await assert.rejects(focusKept('[data-prev]'), /disabled itself|focus left/, 'a focused control that disables itself reads red');
      await page.evaluate(() => { document.querySelector('[data-prev]').disabled = false; });
      assert.equal(await page.locator('[data-reveal]').isDisabled(), false);
      await page.screenshot({ path: path.join(shots, 'deck-' + width + '.png') });
      await page.locator('[data-reveal]').focus(); await page.keyboard.press('Enter'); await page.waitForSelector('[data-result]:not([hidden])');
      await page.waitForFunction(() => document.activeElement === document.querySelector('[data-result] h2'));
      // AC-13: each reading is the library's reading of the nine scores given, in the fixed order.
      const given = givenOf(sc);
      const shown = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-reading]')].map(e => [e.getAttribute('data-reading'), e.querySelector('[data-sentence]').textContent])));
      readingOracle(shown, given);
      const state = id => { const [, a, b] = READINGS.find(r => r[0] === id); return expectedState(given[a], given[b]).state; };
      const open = READINGS.map(r => r[0]).find(id => state(id) !== 'too_few');
      assert.throws(() => readingOracle({ ...shown, 'with-fake': M.SENTENCES[shown['with-fake'] === M.SENTENCES.separated ? 'overlapping' : 'separated'] }, given), 'a reading that differs from the rule reads red');
      // AC-14: a reading shown as read with two answers in an arm reads red.
      if (open) { const [, a] = READINGS.find(r => r[0] === open); assert.throws(() => readingOracle(shown, { ...given, [a]: given[a].slice(0, 2) }), 'a reading with two answers in an arm reads red'); }
      const result = await page.locator('[data-result]').innerText();
      resultOracle(result);
      assert.throws(() => resultOracle(result + ' verdict')); assert.throws(() => resultOracle(result + ' a 20% lift')); assert.throws(() => resultOracle(result + ' the fake won'));
      // AC-15: the fourth sentence and the reminder.
      const sugar = await page.locator('[data-sugar]').innerText();
      const sugarOracle = text => assert.equal(text, sugarFrame(want.bytes) + M.SENTENCES[state('with-fake')]);
      sugarOracle(sugar);
      assert.throws(() => sugarOracle(sugar.replace('same-length fake', 'same-length placebo')), 'the other word for the fake reads red');
      // A-726-2: the reminder speaks only to instructions that scored clearly above the fake.
      const againstFake = expectedState(given.with, given.fake), beatFake = againstFake.state === 'separated' && againstFake.b.mean > againstFake.a.mean;
      const reminderOracle = (text, shows) => assert.equal(text.includes(REMINDER), shows, 'the reminder is carried where it speaks');
      reminderOracle(result, beatFake);
      assert.equal(await page.locator('[data-reminder]').isVisible(), beatFake);
      assert.throws(() => reminderOracle(beatFake ? result.replaceAll(REMINDER, '') : result + REMINDER, beatFake), 'the reminder missing, or shown where it does not speak, reads red');
      // A-726-2: one word for the reader, in everything the page now shows.
      assert.doesNotMatch(await page.locator('main').innerText(), /placebo/i, 'one word for the reader');
      // AC-14: figures only for arms in a reading that is not too few, read from the library.
      const figures = await page.locator('[data-figures]').innerText().catch(() => '');
      const shownArms = new Set(READINGS.filter(([id]) => state(id) !== 'too_few').flatMap(([, a, b]) => [a, b]));
      if (!shownArms.size) { assert.equal(await page.locator('[data-figures]:not([hidden])').count(), 0, 'too few shows no figure'); assert.equal(figures.trim(), ''); }
      else {
        for (const [arm, armLabel] of ARMS) {
          if (!shownArms.has(arm)) { assert.ok(!figures.includes(armLabel + ':'), arm + ' has no figure'); continue; }
          const xs = given[arm].filter(x => Number.isFinite(x)).map(x => x / 4), b = stats.aggregateBands(xs.map(m => ({ mean: m })));
          assert.ok(figures.includes(armLabel + ': average ' + two(b.mean) + ' of 4, spread ' + two(b.stddev) + ', from ' + xs.length + ' scored answers.'), arm + ' figures: ' + figures);
        }
        for (const [id, a, b] of READINGS) if (state(id) === 'separated') {
          const lower = arm => ARMS.find(x => x[0] === arm)[1].toLowerCase();
          const e = expectedState(given[a], given[b]);
          assert.ok(figures.includes('The set ' + lower(a) + ' sat ' + (e.b.mean > e.a.mean ? 'higher' : 'lower') + ' than the set ' + lower(b) + '.'), figures);
        }
        // Plant: a floor on the page that differs from config.js.
        floorShown(figures);
        assert.throws(() => floorShown(figures.replace('The floor is ' + config.EFFECT_FLOOR, 'The floor is ' + (config.EFFECT_FLOOR + 0.01))), 'a floor on the page that differs from config.js reads red');
      }
      // The mapping and the record list every score by arm exactly as given.
      const mapping = await page.locator('[data-mapping] li').allInnerTexts();
      assert.equal(mapping.length, 9);
      const tokenOf = { 'With the instructions': 'W', 'With the fake': 'F', 'With nothing': 'N' };
      mapping.forEach((line, k) => {
        const m = /^Answer (\d): (With the instructions|With the fake|With nothing), answer (\d)\. Score: (\d|cannot score)/.exec(line); assert.ok(m, line);
        const token = tokenOf[m[2]] + m[3]; assert.equal(token, order[k]); assert.equal(m[4], String(sc.scores[token]).replace('none', 'cannot score'));
      });
      const recordScores = await page.locator('[data-record-scores]').innerText();
      const list = xs => xs.map(x => x === null ? 'cannot score' : String(x)).join(', ');
      for (const [arm, armLabel] of ARMS) assert.ok(recordScores.includes(armLabel + ': ' + list(given[arm])), recordScores);
      assert.throws(() => assert.ok(recordScores.includes('With the instructions: ' + list([given.with[0] === 0 ? 1 : 0, given.with[1], given.with[2]]))), 'a record score that differs reads red');
      assert.equal(await page.locator('[data-record-hash]').innerText(), hash);
      assert.equal(await page.locator('[data-record-model]').innerText(), 'Test model');
      assert.match(await page.locator('[data-record-date]').innerText(), /^\d{4}-\d{2}-\d{2}$/);
      // AC-17: the record keeps the fake and the three readings.
      assert.equal(await page.locator('[data-record-fake-bytes]').innerText(), String(want.bytes));
      assert.equal(await page.locator('[data-record-fake-hash]').innerText(), want.sha256);
      const record = await page.locator('[data-record]').innerText();
      assert.ok(record.includes(own.prompt) && record.includes(own.guide));
      for (const id of READINGS.map(r => r[0])) assert.ok(record.includes(shown[id]), 'record carries ' + id);
      assert.ok(record.includes(sugar), 'record carries the fourth sentence');
      reminderOracle(record, beatFake);
      // AC-6, AC-16: the caveats stay beside the result, in print and in the download.
      for (const s of CAVEATS) assert.ok(await page.locator('.try-caveats').innerText().then(t => t.includes(s)), s);
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('[data-record]').isVisible(), true); assert.equal(await page.locator('.try-caveats').isVisible(), true);
      for (const sel of ['#try-task', '[data-deck]', '[data-reveal]', '[data-download]']) assert.equal(await page.locator(sel).isVisible(), false, sel + ' hidden in print');
      await page.emulateMedia({ media: 'screen' });
      // AC-20: no sideways scroll with the result and the full hashes on screen.
      assert.equal(await fits(), true, 'fits ' + width + ' after Reveal');
      await page.screenshot({ path: path.join(shots, 'result-' + width + '.png') });
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-download]').click()]);
      assert.match(download.suggestedFilename(), /^driftproof-try-it-\d{4}-\d{2}-\d{2}\.md$/);
      const md = fs.readFileSync(await download.path(), 'utf8');
      const downloadOracle = text => { for (const s of CAVEATS) assert.ok(text.includes(s), 'download carries: ' + s); for (const s of [own.prompt, own.guide, hash, want.sha256, String(want.bytes) + ' bytes', 'Test model', sugar, ...(beatFake ? [REMINDER] : []), ...Object.values(shown), ...ARMS.map(([arm, armLabel]) => armLabel + ': ' + list(given[arm]))]) assert.ok(text.includes(s), 'download carries: ' + s.slice(0, 40)); };
      // AC-17: no two lines run together when the Markdown is rendered: each is a list item or its own paragraph.
      const linesOracle = text => { const a = text.split('\n'), run = a.findIndex((l, i) => l && a[i + 1] && !(l.startsWith('- ') && a[i + 1].startsWith('- '))); assert.equal(run, -1, 'lines run together: ' + a.slice(run, run + 2).join(' / ')); };
      linesOracle(md);
      assert.throws(() => linesOracle(md.replace(/^- Your instructions against the fake/m, 'Your instructions against the fake')), 'a download whose lines run together reads red');
      downloadOracle(md); assert.throws(() => downloadOracle(md.replace(CAVEATS[2], ''))); assert.throws(() => downloadOracle(md.replace(want.sha256, '')), 'a download missing the fake\'s hash reads red');
      // AC-8, AC-19: nothing left the page.
      assert.equal(await page.evaluate(() => location.search + location.hash), '');
      assert.equal(await page.evaluate(() => document.cookie), '');
      assert.ok(requests.every(u => u.startsWith(origin + '/') || u.startsWith('https://static.cloudflareinsights.com/')), requests.filter(u => !u.startsWith(origin)).join(' '));
      const requestsOracle = urls => { for (const u of urls) { if (u.startsWith('blob:')) continue; const p = new URL(u); assert.equal(p.search, '', 'a later request has no query: ' + u); assert.ok(p.origin === origin && /\.(woff2|svg|css|m?js|png|ico)$/.test(p.pathname), 'a later request is a static asset: ' + u); } };
      requestsOracle(requests.slice(loaded));
      assert.throws(() => requestsOracle(requests.slice(loaded).concat(origin + '/leak?x=1')), 'a planted request reads red');
      const keys = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
      const storageOracle = ks => { assert.ok(ks.every(k => k === 'driftproof-try-it'), 'storage beyond the draft: ' + ks); };
      storageOracle(keys); assert.throws(() => storageOracle(keys.concat('scores')));
      assert.ok(!(await page.evaluate(() => localStorage.getItem('driftproof-try-it') || '')).includes('"scores"'), 'scores are never stored');
      await page.locator('[data-clear]').click();
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.equal(await page.inputValue('#try-prompt'), ''); assert.equal(await page.locator('[data-result]:not([hidden])').count(), 0);
      assert.equal(await page.inputValue('#try-instructions'), ''); assert.equal(await page.locator('[data-fake-panel]').isVisible(), false, 'clear empties the fake');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // AC-18: a text the module refuses shows the module's words and leaves the two-arm worksheet.
    const paste = (page, text) => page.evaluate(v => { const t = document.querySelector('#try-instructions'); t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); }, text);
    const refusedWords = async text => { try { await buildFake(encode(text), 'context', digest); } catch (e) { return e.message; } throw new Error('not refused'); };
    for (const [i, text] of ['a\0b', '!!! ???', 'x'.repeat(262145)].entries()) {
      // A fresh context per text: a locked draft would freeze the next page's fields.
      const refusing2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      await refusing2.route('https://**/*', r => r.abort());
      const page = await refusing2.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + '/try-it/'); await page.waitForSelector('#try-task');
      await page.fill('#try-prompt', own.prompt); await page.fill('#try-guide', own.guide);
      await paste(page, text);
      const words = await refusedWords(text);
      await page.waitForFunction(() => document.querySelector('[data-fake-refusal]').textContent !== '');
      const refusalOracle = shown => assert.equal(shown, words);
      refusalOracle(await page.locator('[data-fake-refusal]').innerText());
      assert.throws(() => refusalOracle(words + ' more'), 'refusal words that differ read red');
      assert.equal(await page.locator('[data-announce]').textContent(), words, 'the status element says the refusal');
      assert.equal(await page.locator('[data-fake-panel]').isVisible(), false, 'no fake is offered under a refusal');
      assert.equal(await page.locator('[data-lock]').isDisabled(), false, 'the two-arm worksheet stays usable');
      await page.locator('[data-lock]').click(); await page.waitForSelector('[data-copy="with"]');
      const noThirdButton = async () => assert.equal(await page.locator('[data-copy="fake"]').isVisible(), false, 'no third copy button');
      await noThirdButton();
      await page.evaluate(() => { document.querySelector('[data-copy="fake"]').hidden = false; });
      await assert.rejects(noThirdButton(), 'a third copy button offered under a refusal reads red');
      await page.evaluate(() => { document.querySelector('[data-copy="fake"]').hidden = true; });
      assert.equal(await page.locator('[data-answer="fake-1"]').isVisible(), false, 'no fake boxes');
      assert.equal(await page.locator('[data-turn-off]').innerText(), TURN_OFF.replace('all nine answers', 'all six answers'), 'the step counts the answers this worksheet collects');
      if (i === 0) {
        // The whole two-arm flow, once: six answers, one reading, no fake anywhere in the result.
        for (const [arm, t] of [['with', 'W'], ['without', 'N']]) for (const k of [1, 2, 3]) await page.fill('[data-answer="' + arm + '-' + k + '"]', 'token-' + t + k + ' answer');
        await page.locator('[data-start]').click(); await page.waitForSelector('[data-deck]:not([hidden])');
        assert.match(await page.locator('[data-progress]').innerText(), /^Answer 1 of 6$/);
        const scores = { W1: 4, W2: 4, W3: 3, N1: 1, N2: 2, N3: 1 };
        for (let k = 0; k < 6; k++) { const token = /token-([WN]\d)/.exec(await page.locator('[data-pane]').innerText())[1]; await page.locator('button[data-score="' + scores[token] + '"]').click(); if (k < 5) await page.locator('[data-next]').click(); }
        await page.locator('[data-reveal]').click(); await page.waitForSelector('[data-result]:not([hidden])');
        const ids = await page.evaluate(() => [...document.querySelectorAll('[data-reading]')].map(e => e.getAttribute('data-reading')));
        assert.deepEqual(ids, ['with-without'], 'one reading');
        assert.equal(await page.locator('[data-reading="with-without"] [data-sentence]').innerText(), M.SENTENCES.separated);
        assert.equal(await page.locator('[data-sugar]').isVisible(), false); assert.equal(await page.locator('[data-reminder]').isVisible(), false);
        assert.ok((await page.locator('[data-record-fake]').innerText()).includes(NO_FAKE), 'the record says no fake was built');
        assert.equal(await page.locator('[data-record-fake-hash]').count(), 0);
        const result = await page.locator('[data-result]').innerText();
        resultOracle(result);
        assert.ok(!result.includes(words), 'the refusal words stay in Step 1');
      }
      assert.deepEqual(errors, []);
      await refusing2.close();
    }

    // Plants through the page itself: a served corpus and a served floor read red against the library.
    const quickRun = async (page, sc) => {
      await page.goto(origin + '/try-it/'); await page.waitForSelector('#try-task');
      await page.evaluate(() => { window.copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.copied.push(t); } }, configurable: true }); });
      await page.fill('#try-prompt', own.prompt); await page.fill('#try-guide', own.guide); await page.fill('#try-instructions', own.instructions);
      await page.locator('[data-lock]').click(); await page.waitForSelector('[data-copy="fake"]');
      for (const [arm] of ARMS) for (const i of [1, 2, 3]) await page.fill('[data-answer="' + arm + '-' + i + '"]', sc.answers[arm][i - 1]);
      await page.locator('[data-start]').click(); await page.waitForSelector('[data-deck]:not([hidden])');
      for (let k = 0; k < 9; k++) { const token = /token-([WFN]\d)/.exec(await page.locator('[data-pane]').innerText())[1]; await page.locator('button[data-score="' + sc.scores[token] + '"]').click(); if (k < 8) await page.locator('[data-next]').click(); }
      await page.locator('[data-reveal]').click(); await page.waitForSelector('[data-result]:not([hidden])');
    };
    // AC-23's plant, through the page: an island whose Lock disables itself with focus on it reads red.
    const lockCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await lockCtx.route('https://**/*', r => r.abort());
    const islandSource = read('docs/islands/try-it.js'), plantedIsland = islandSource.replace('locked.hidden = false; turnOff.focus();', '');
    assert.notEqual(plantedIsland, islandSource, 'the plant applies');
    await lockCtx.route('**/islands/try-it.js', r => r.fulfill({ contentType: 'text/javascript', body: plantedIsland }));
    const lockPage = await lockCtx.newPage();
    await lockPage.goto(origin + '/try-it/'); await lockPage.waitForSelector('#try-task');
    await lockPage.fill('#try-prompt', own.prompt); await lockPage.fill('#try-guide', own.guide); await lockPage.fill('#try-instructions', own.instructions);
    await watchLock(lockPage);
    await lockPage.locator('[data-lock]').focus(); await lockPage.keyboard.press('Enter'); await lockPage.waitForSelector('[data-copy="with"]');
    const plantedLock = await lockPage.evaluate(() => window.afterLock);
    assert.throws(() => lockFocusOracle(plantedLock), 'a Lock that disables itself with focus on it reads red');
    await lockPage.close(); await lockCtx.close();
    // A-726-2: the case the review named. The instructions score clearly below the fake, so no reminder.
    const below = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await below.route('https://**/*', r => r.abort());
    const belowPage = await below.newPage();
    await quickRun(belowPage, { ...scenarios[0], scores: { W1: 1, W2: 1, W3: 2, F1: 4, F2: 4, F3: 3, N1: 1, N2: 2, N3: 1 } });
    assert.equal(await belowPage.locator('[data-reading="with-fake"] [data-sentence]').innerText(), M.SENTENCES.separated);
    assert.equal(await belowPage.locator('[data-reminder]').isVisible(), false, 'no reminder where the instructions sat below the fake');
    assert.ok(!(await belowPage.locator('[data-record]').innerText()).includes(REMINDER), 'the record follows');
    await belowPage.close(); await below.close();
    const planted = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await planted.route('https://**/*', r => r.abort());
    await planted.route('**/import-core/placebo.mjs', r => r.fulfill({ contentType: 'text/javascript', body: read('docs/import-core/placebo.mjs').replace('The morning light settled', 'The evening light settled') }));
    const corpusPage = await planted.newPage();
    await quickRun(corpusPage, scenarios[0]);
    await corpusPage.locator('[data-copy="fake"]').click();
    const servedFake = (await corpusPage.evaluate(() => window.copied)).slice(-1)[0].slice(0, -('\n\n' + own.prompt).length);
    assert.notEqual(sha256(Buffer.from(servedFake)), want.sha256, 'a fake built from another corpus differs from placeboFor, so AC-11\'s oracle reads it red');
    await corpusPage.close(); await planted.close();
    const plantedFloor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await plantedFloor.route('https://**/*', r => r.abort());
    await plantedFloor.route('**/import-core/band.mjs', r => r.fulfill({ contentType: 'text/javascript', body: read('docs/import-core/band.mjs').replace(/EFFECT_FLOOR = [0-9.]+/, 'EFFECT_FLOOR = 0.9') }));
    const floorPage = await plantedFloor.newPage();
    await quickRun(floorPage, scenarios[0]);
    const floorShownReadings = await floorPage.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-reading]')].map(e => [e.getAttribute('data-reading'), e.querySelector('[data-sentence]').textContent])));
    assert.throws(() => readingOracle(floorShownReadings, givenOf(scenarios[0])), 'a floor on the page that differs from config.js reads red through the page');
    const plantedFigures = await floorPage.locator('[data-figures]').innerText().catch(() => '');
    assert.throws(() => floorShown(plantedFigures), 'the figures state the planted floor, not config.js');
    await floorPage.close(); await plantedFloor.close();

    // A browser that refuses storage still runs the page.
    const refusing = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await refusing.route('https://**/*', r => r.abort());
    await refusing.addInitScript(() => { const s = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('refused'); }; void s; });
    const p2 = await refusing.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
    await p2.goto(origin + '/try-it/'); await p2.waitForSelector('#try-task');
    await p2.fill('#try-prompt', 'a'); await p2.fill('#try-guide', 'b'); await p2.fill('#try-instructions', 'c');
    assert.equal(await p2.locator('[data-lock]').isDisabled(), false); await p2.locator('[data-lock]').click(); await p2.waitForSelector('[data-copy="with"]');
    assert.deepEqual(e2, []); await refusing.close();
    // Without JavaScript the steps and the link to the tasks read.
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const fallback = await nojs.newPage(); await fallback.goto(origin + '/try-it/');
    assert.equal(await fallback.locator('ol.try-steps li').count() >= 5, true);
    assert.equal(await fallback.locator('[data-island="try-it"] a[href="/tasks/"]').count(), 1);
    assert.equal(await fallback.locator('#try-task').count(), 0);
    assert.ok((await fallback.locator('[data-island="try-it"]').innerText()).includes(TURN_OFF), 'the static steps carry the turn-off step');
    await nojs.close();
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
  console.log('Try it screenshots: ' + shots);
});
