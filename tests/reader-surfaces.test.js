// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 652: the reader surfaces after 0.26.0 state what the code and each other state. Each test
// reads a surface against its source: the plugin's command files, the README's Platforms section,
// Report 017's page, the campaign essay's counts, the summary's own sentence and RELEASES.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { htmlToText } = require('../scripts/html-text.js');
const { VERDICTS } = require('../lib/verdict');
const { LABELS } = require('../lib/plain');
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Issue 661: the text of a fragment by the tokenizer, never a tag-stripping pattern, each entity
// decoded once after the tags are gone (CodeQL js/double-escaping, js/incomplete-multi-character-sanitization).
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const textOf = (html) => htmlToText(html, { decode: (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ENTITIES[k]), collapse: true });
const numbers = (s) => String(s).match(/\d+/g) || [];

const commands = fs.readdirSync(path.join(ROOT, 'plugin/driftproof/commands')).filter((f) => f.endsWith('.md')).map((f) => `/driftproof:${f.slice(0, -3)}`).sort();
const named = (sentence) => (sentence.match(/\/driftproof:[a-z]+/g) || []).sort();

test('652-1: the README Install sentence and the homepage name every plugin command, and no other', () => {
  const readme = /That installs ([\s\S]*?)\.\n/.exec(read('README.md'));
  assert.ok(readme, 'README.md has a "That installs" sentence');
  assert.deepEqual(named(readme[1]), commands);
  const home = /<p>That installs ([\s\S]*?)\. The plugin/.exec(read('docs/index.html'));
  assert.ok(home, 'docs/index.html has a "That installs" sentence');
  assert.deepEqual(named(home[1]), commands);
  const builder = /<p>That installs ([\s\S]*?)\. The plugin/.exec(read('scripts/build-site-pages.js'));
  assert.ok(builder, 'scripts/build-site-pages.js carries the sentence');
  assert.deepEqual(named(builder[1]), commands);
});

// Issue 757 (spec 687 A-687-4): the README keeps the full Windows sentence; the home page says the same
// limits in plain words and links the details. An overclaim planted on the home line reads red.
const homeWindowsHits = (quickstart) => {
  const hits = [], t = textOf(quickstart);
  if (/Windows is untested|CI matrix across Linux, macOS and Windows is planned/.test(t)) hits.push('a retired Windows sentence');
  if (!/On Windows the plugin also needs Node, npm's npx and Git for Windows on PATH, and Windows has only been checked without calling a model\./.test(t)) hits.push('the Windows limits in plain words');
  if (!quickstart.includes('<a href="/findings/">')) hits.push('no link to the findings page');
  if (/Windows is supported|works on Windows/i.test(t)) hits.push('a Windows overclaim');
  return hits;
};
test('652-2: the homepage says of Windows what the README Platforms section says', () => {
  const platforms = /\*\*Platforms\.\*\*([\s\S]*?)\n\n/.exec(read('README.md'));
  assert.ok(platforms, 'README.md has a Platforms paragraph');
  const readme = platforms[1].replace(/\s+/g, ' ');
  assert.doesNotMatch(readme, /Windows is untested|CI matrix across Linux, macOS and Windows is planned/);
  assert.match(readme, /Public Windows CI runs the package gate, a stubbed first run, selected core tests and the plugin's own compatibility and runner-launch tests\. These checks make no model calls and do not establish real-provider support\. On Windows the plugin needs Node, npm's bundled npx and Git for Windows on PATH\./);
  const quickstart = (/<section id="quickstart"[\s\S]*?<\/section>/.exec(read('docs/index.html')) || [''])[0];
  assert.deepEqual(homeWindowsHits(quickstart), []);
  assert.notDeepEqual(homeWindowsHits(quickstart.replace('</section>', '<p>Windows is supported.</p></section>')), [], 'plant: a Windows overclaim');
});

// Issue 756 (A-652-1): the newest report, read where scripts/site-data.mjs reads it, the highest
// numbered directory under docs/reports. The home page card and docs/data/stats.json come from that
// reading, so a new report moves these checks with it and they never name a report that was replaced.
const newestReport = () => fs.readdirSync(path.join(ROOT, 'docs/reports'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name).sort().at(-1);
const pageTitle = (n) => textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(read(`docs/reports/${n}/index.html`))[1]);

test("652-3: llms.txt, the homepage card and stats.json head the newest report with its page's title", () => {
  // Report 017 keeps its own title and llms line, newest or not.
  const h017 = pageTitle('017');
  assert.equal(h017, 'Skill or sugar pill? Twenty skills against a same-length placebo');
  const line017 = read('docs/llms.txt').split('\n').find((l) => l.includes('/reports/017/'));
  assert.ok(line017 && line017.startsWith(`- [Report 017: ${h017}](`), line017);
  const newest = newestReport(), h1 = pageTitle(newest);
  const llms = read('docs/llms.txt').split('\n').find((l) => l.includes(`/reports/${newest}/`));
  assert.ok(llms && llms.startsWith(`- [Report ${newest}: ${h1}](`), llms);
  const stats = JSON.parse(read('docs/data/stats.json'));
  assert.equal(stats.latest_report_number.value, newest);
  assert.equal(stats.latest_report_title.value, h1);
  const card = /<span data-stat="latest_report_title">([\s\S]*?)<\/span>/.exec(read('docs/index.html'));
  assert.ok(card, 'the homepage latest card names latest_report_title');
  assert.equal(textOf(card[1]), h1);
  assert.doesNotMatch(read('docs/index.html'), /data-stat="latest_report_what_moved"/);
  const reports = JSON.parse(read('docs/data/reports.json')).reports;
  // Plant: a title left on an earlier report, the way these checks went stale, reads red.
  const earlier = reports.map((r) => r.number.value).filter((n) => n !== newest).sort().at(-1);
  assert.throws(() => assert.equal(pageTitle(earlier), h1), assert.AssertionError, 'plant: an earlier report title');
  // Every other report's title read this way is what moved, so no other card moved. A page that
  // states what moved apart from its title carries data-what-moved, and must then differ.
  const { reportName } = require('../scripts/build-site-pages.js');
  for (const r of reports) (read(`docs/reports/${r.number.value}/index.html`).includes('data-what-moved') ? assert.notEqual : assert.equal)(reportName(r), r.what_moved.value, r.number.value);
});

test('652-4: the README Report 017 entry says its readings in plain words, with the counts the essay carries', () => {
  const entry = /^- \*\*\[Report #017\][^\n]*/m.exec(read('README.md'));
  assert.ok(entry, 'README.md has the Report #017 entry');
  assert.doesNotMatch(entry[0], /ABOVE_PLACEBO|BELOW_PLACEBO|NO_DIFFERENCE|INCONCLUSIVE|UNDERPOWERED|NOT_MEASURED|by the case rule/);
  const essay = /<p><a href="\/reports\/017\/">Report #017<\/a>[\s\S]*?<\/p>/.exec(read('docs/writing/three-releases/index.html'));
  assert.ok(essay, 'the essay carries the Report #017 paragraph');
  const readings = (s) => { const m = /Of the (\d+) skills it counts, the placebo readings are ([^.]*)\./.exec(s); assert.ok(m, s); return numbers(`${m[1]} ${m[2]}`); };
  assert.deepEqual(readings(entry[0]), readings(textOf(essay[0])));
  assert.match(entry[0], /11 above the placebo · 3 below the placebo/);
  // Issue 661: the UNDERPOWERED, INCONCLUSIVE and NOT_MEASURED counts take the verdict library's word
  // for each state (the badge's words), not spec 128's per-receipt label "too few answers to tell",
  // which spec 435's census reads as one of Report 015's counts (the 0.26.1 sweep's CONTRADICTORY_COUNT).
  assert.match(entry[0], new RegExp(`\\d+ ${VERDICTS.INCONCLUSIVE.word} · \\d+ ${VERDICTS.UNDERPOWERED.word} · \\d+ ${VERDICTS.NOT_MEASURED.word}\\.`));
  const R435 = require('../specs/435-report-015-router-amendment/reader.cjs');
  const items = R435.evidence(ROOT);
  assert.doesNotThrow(() => R435.assertions(entry[0], items), 'spec 435 reads no Report 015 count in the Report 017 entry');
  const relabelled = entry[0].replace(new RegExp(`(\\d+) ${VERDICTS.UNDERPOWERED.word}`), `$1 ${LABELS.UNDERPOWERED.toLowerCase()}`);
  assert.notEqual(relabelled, entry[0]);
  assert.throws(() => R435.assertions(relabelled, items), (e) => e.code === 'CONTRADICTORY_COUNT', 'plant: the per-receipt label on a Report 017 count reads as a Report 015 count');
});

test("652-5: the README opening's latest finding says the case rule in plain words and keeps the summary's figures", () => {
  const opening = read('README.md').split('Driftproof **consumes**')[0];
  const finding = /\*\*Latest finding\*\*[\s\S]*?\n\n/.exec(opening);
  assert.ok(finding, 'the opening carries the latest finding');
  const line = finding[0].replace(/\s+/g, ' ');
  assert.doesNotMatch(line, /by the case rule/);
  assert.match(line, /read one task at a time/);
  const newest = newestReport();
  assert.ok(line.includes(`[Report ${newest}]`), line);
  const summary = JSON.parse(read('docs/data/report-summaries.json')).reports[newest].points.find((p) => p.lead === 'What we found.').text;
  const after = /\d{1,2} \w{3} \d{4}: ([\s\S]*)$/.exec(line);
  assert.ok(after, line);
  assert.deepEqual(numbers(after[1]), numbers(summary.split(/(?<=[.!?])\s+(?=[A-Z])/)[0]));
  assert.match(summary, /by the case rule/, "the report page's own words are the summary's, unchanged");
});

test('652-6: RELEASES.md v0.26.0 carries a dated correction line and its user section still reads', () => {
  const section = /## v0\.26\.0[\s\S]*?(?=\n## )/.exec(read('RELEASES.md'))[0];
  assert.match(section, /^- Correction, 2 Nov 2026 \(issue 652\): the blind read shows the pairs in receipt order, not shuffled; only which answer of a pair sits first is random\. `driftproof doctor` runs most of the README's isolation checks, not all of them; the manual check is stricter on the environment\.$/m);
  assert.match(section, /one pair at a time in a shuffled order/, 'the published entry is not rewritten');
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/release-body.mjs'), 'v0.26.0'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Correction, 2 Nov 2026/);
});

// ── Issue 757 (spec 687 A-687-4 and its siblings): a door for people who use chat apps, and plain words on
// the home page, how-it-works, the glossary, the fake and the lookup. Each row reads the built page and
// carries a plant; the counts are recomputed here from the sealed receipts, apart from the builder.
const { placeboReading } = require('../lib/verdict');
const { projectCalls } = require('../lib/run');
const { SAMPLING } = require('../lib/sampling');
const { DEFAULT_JUDGE_SAMPLES } = require('../config');
const homeHtml = () => read('docs/index.html');
const sectionOf = (h, id) => (new RegExp(`<section id="${id}"[\\s\\S]*?</section>`).exec(h) || [''])[0];
const once = (h, from, to) => { assert.equal(h.split(from).length, 2, `plant anchor once: ${from.slice(0, 60)}`); return h.replace(from, to); };
const statIn = (h, key) => { const m = new RegExp(`<span data-stat="${key}">([^<]*)</span>`).exec(h); return m ? m[1] : null; };
const NODE_MAJOR = /\d+/.exec(JSON.parse(read('package.json')).engines.node)[0];

function chatHits(h) {
  const hero = sectionOf(h, 'hero'), hits = [];
  const door = (/<article class="door door-chat">[\s\S]*?<\/article>/.exec(hero) || [''])[0];
  if (!door) return ['no chat door in the hero'];
  if (textOf((/<p class="door-title">([\s\S]*?)<\/p>/.exec(door) || [])[1] || '') !== 'I use ChatGPT or Claude in the browser') hits.push('the door title');
  for (const [href, label] of [['/try-it/', 'Do my custom instructions do anything?'], ['/inspect/', 'Is a file someone sent me safe to paste in?'], ['/did-it-change/', 'Did the AI change lately?']]) if (!door.includes(`<a href="${href}">${label}</a>`)) hits.push(`no link ${href} in the reader's words`);
  for (const line of ['No install, about thirty minutes.', 'No terminal needed for these three.']) if (!textOf(door).includes(line)) hits.push(`the door lacks "${line}"`);
  const sub = textOf((/<p class="hero-sub">([\s\S]*?)<\/p>/.exec(hero) || [])[1] || '');
  if (!sub.includes('The same test works on custom instructions, saved prompts and CLAUDE.md files.')) hits.push('the lede line');
  if (!sub.includes('Every result is a dated receipt with its own page; anyone with a terminal can verify the file.')) hits.push('the verify sentence');
  if (/anyone can check/.test(sub)) hits.push('the old verify sentence');
  if (!textOf(sectionOf(h, 'audience')).includes('People who use AI chat apps')) hits.push("Who it's for");
  return hits;
}
test('757-1: the chat door, its three links, the lede line and the verify sentence', () => {
  const h = homeHtml();
  assert.deepEqual(chatHits(h), []);
  assert.notDeepEqual(chatHits(h.replace(/<article class="door door-chat">[\s\S]*?<\/article>\n?/, '')), [], 'plant: a home page without the chat door');
  assert.notDeepEqual(chatHits(once(h, 'anyone with a terminal can verify the file', 'anyone can check')), [], 'plant: the old verify sentence');
});

function installHits(h) {
  const q = sectionOf(h, 'quickstart'), t = textOf(q), hits = [];
  const first = textOf((/<h2>[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/.exec(q) || [])[1] || '');
  if (first !== `You need Claude Code, Node.js ${NODE_MAJOR} or newer, and your project in a git repository. You do not need an API key: runs use your Claude Code plan's usage.`) hits.push(`the section does not open with what you need: ${first.slice(0, 60)}`);
  if (!q.includes(`<code>Node.js ${NODE_MAJOR}</code>`)) hits.push("the Node version is not package.json's, in code");
  for (const old of ['realpath', 'publishing helper', 'Public Windows CI']) if (t.includes(old)) hits.push(`still says ${old}`);
  if (!t.includes('Tested on Linux and macOS.')) hits.push('the plain platform line');
  const calls = projectCalls(1, DEFAULT_JUDGE_SAMPLES, SAMPLING.max, 2);
  if (statIn(q, 'max_calls_per_task') !== String(calls)) hits.push(`the usage figure is not ${calls}`);
  if (!t.includes(`A full run can take up to ${calls} model calls for each test task from your plan's usage.`)) hits.push('the usage line');
  if (!t.includes('Compare and recheck need a git repository, and compare takes a CLAUDE.md or AGENTS.md.')) hits.push('the compare and recheck line');
  if (!t.includes('/driftproof:start works on a CLAUDE.md or AGENTS.md too.')) hits.push('start on a rules file');
  return hits;
}
function ciHits(h) {
  const c = textOf(sectionOf(h, 'ci'));
  return [['the plan', /A Claude Pro or Max plan cannot be used in CI/], ['the key', /the Action needs an API key, billed per call/], ['max-usd', /set max-usd/], ['compare-with-base', /compare-with-base/]].filter(([, re]) => !re.test(c)).map(([w]) => w);
}
test('757-2: the install section opens with what you need, and CI says what a plan cannot do', () => {
  const h = homeHtml();
  assert.deepEqual(installHits(h), []);
  assert.deepEqual(ciHits(h), []);
  assert.notDeepEqual(installHits(once(h, 'Tested on Linux and macOS.', 'In an outside retest on macOS the shipped gate failed only in the publishing helper.')), [], 'plant: the old platform words');
  assert.notDeepEqual(installHits(once(h, `<span data-stat="max_calls_per_task">${projectCalls(1, DEFAULT_JUDGE_SAMPLES, SAMPLING.max, 2)}</span>`, '60')), [], 'plant: a typed usage figure');
  assert.notDeepEqual(ciHits(once(h, 'A Claude Pro or Max plan cannot be used in CI', 'A plan can be used in CI')), [], 'plant: the plan sentence gone');
  assert.ok(JSON.parse(read('docs/data/stats.json')).max_calls_per_task, 'stats.json carries the usage figure');
});

function foundOracle() {
  const n = JSON.parse(read('docs/data/stats.json')).latest_report_number.value;
  const P = require(`../scripts/prepare-report-${n}.js`);
  const c = P.readCampaign({ campaignRoot: path.join(ROOT, P.CAMPAIGN) });
  const counted = c.rows.filter((r) => !r.router);
  return { counted: counted.length, above: counted.filter((r) => r.receipt && placeboReading(r.receipt).reading === 'ABOVE_PLACEBO').length };
}
function foundHits(h, oracle) {
  const m = /<li><b data-stat="latest_point_(\d+)_lead">What we found\.<\/b>([\s\S]*?)<\/li>/.exec(sectionOf(h, 'hero'));
  if (!m) return ['no What we found item'];
  const hits = [], item = m[2], t = textOf(item);
  if (statIn(item, 'latest_found_above') !== String(oracle.above)) hits.push('the count above the fake is not bound to the receipts');
  if (statIn(item, 'latest_found_counted') !== String(oracle.counted)) hits.push('the counted total is not bound to the receipts');
  if (!t.startsWith(`${oracle.above} of ${oracle.counted} skills scored above the fake on at least one task and below it on none.`)) hits.push(`does not lead with the finding: ${t.slice(0, 80)}`);
  if (!item.includes(`data-plain-of="latest_point_${m[1]}_text"`)) hits.push('the plain caveat is not bound to its point');
  if (!t.endsWith('Not beating the fake does not show a skill is useless.')) hits.push('the plain caveat is missing');
  if (/is not shown to do no better/.test(t)) hits.push('the double negative');
  return hits;
}
test('757-3: What we found leads with counts from the receipts, then the caveat in plain words', async () => {
  const h = homeHtml(), oracle = foundOracle(), S = JSON.parse(read('docs/data/stats.json'));
  assert.deepEqual(foundHits(h, oracle), []);
  assert.equal(S.latest_found_above.value, oracle.above);
  assert.equal(S.latest_found_counted.value, oracle.counted);
  const D = await import('../scripts/site-data.mjs');
  const page = read(`docs/reports/${S.latest_report_number.value}/index.html`);
  assert.throws(() => D.latestFoundFields(S.latest_report_number.value, page, { publication: { tally: { A: oracle.above - 1, N: oracle.counted } } }), /receipts give/, 'plant: receipts that disagree with the printed tally refuse the build');
  assert.notDeepEqual(foundHits(once(h, `<span data-stat="latest_found_above">${oracle.above}</span>`, String(oracle.above)), oracle), [], 'plant: a typed figure');
  assert.notDeepEqual(foundHits(h, { ...oracle, above: oracle.above + 1 }), [], 'plant: a count the receipts do not give');
  assert.notDeepEqual(foundHits(once(h, 'Not beating the fake does not show a skill is useless.', 'A skill that did not beat the fake is not shown to do no better than it.'), oracle), [], 'plant: the double negative');
  const hero = sectionOf(h, 'hero');
  assert.ok(!hero.includes('The judge uses the same model as the target.'), 'the repeated judge sentence is gone from the card');
  assert.ok(hero.includes('Self-grading may favor its own model'), "the judge point's remaining sentence stays");
});

function statesHits(h) {
  const { LABELS: PAGE, CASES_PAGE } = require('../scripts/build-receipt-pages.js');
  const s = sectionOf(h, 'states'), hits = [];
  for (const k of ['PASSED', 'REGRESSED', 'NO_EFFECT', 'UNDERPOWERED']) if (!s.includes(`<li><strong>${LABELS[k]}.</strong> <small class="receipt-term">Receipt label: ${PAGE[k][0]}.</small>`)) hits.push(k);
  if (!s.includes(`<li><strong>${LABELS.UNDERPOWERED_CASES}.</strong> <small class="receipt-term">Receipt label: ${CASES_PAGE[0]}.</small>`)) hits.push('UNDERPOWERED_CASES');
  if (!s.includes(`<li><strong>${LABELS.NOT_MEASURED}.</strong>`)) hits.push('NOT_MEASURED');
  return hits;
}
test('757-4: What a receipt can say leads with the plain labels, the receipt label in small type', () => {
  const h = homeHtml();
  assert.deepEqual(statesHits(h), []);
  assert.notDeepEqual(statesHits(once(h, `<li><strong>${LABELS.PASSED}.</strong>`, '<li><strong>Passing.</strong>')), [], 'plant: the technical name leading again');
});

function howHits(h) {
  const t = textOf(h);
  return [
    [/separate judge/i.test(t), 'says separate judge'],
    [!t.includes('3. A judge model scores each answer'), 'the step 3 heading'],
    [!t.includes('In your own plugin runs the same model answers and grades by default, and Driftproof prints a warning.'), 'the same-model line'],
    [!t.includes('Start today, run again later; it cannot compare with last month unless you saved then.'), 'the recheck sentence'],
    [!t.includes('A difference between dates says something changed, not what: the model, Claude Code, the grader, Driftproof itself, or chance.'), 'the dates sentence'],
    [!h.includes('<code>/driftproof:compare CLAUDE.md --suite tasks.json</code>'), 'the plugin form'],
    [!t.includes(`You need Claude Code, Node.js ${NODE_MAJOR} or newer, and your project in a git repository.`), 'the prerequisites'],
    [t.lastIndexOf('What you need') < t.lastIndexOf('Did your edit help?'), 'the page does not end on what you need'],
  ].filter(([bad]) => bad).map(([, w]) => w);
}
test('757-5: how it works gives one account of the judge and ends on what you need', () => {
  const h = read('docs/how-it-works/index.html');
  assert.deepEqual(howHits(h), []);
  assert.notDeepEqual(howHits(h.replace('3. A judge model scores each answer', '3. A separate judge scores each answer')), [], 'plant: a separate judge');
});

function glossaryHits(h) {
  const hits = [];
  for (const id of ['term-judge-sample', 'term-capture', 'term-harness', 'term-test-task', 'term-spread', 'term-seal']) if (!new RegExp(`<dt id="${id}">[\\s\\S]*?<p class="term-plain">`).test(h)) hits.push(`no entry ${id}`);
  const t = textOf(h);
  if (/a moved result cannot come from a changed grader/.test(t)) hits.push('the old judge guarantee');
  if (!/Within one report the grader stays fixed/.test(t) || !/Between dates the grader's model or Driftproof's scoring code can change, and each receipt records both/.test(t)) hits.push('the judge entry');
  if (/One grader now scores both\./.test(t)) hits.push('crossed judging without its setup');
  if (!/In R-2, Sonnet 5\.5 now judges both targets/.test(t)) hits.push('crossed judging does not name R-2');
  return hits;
}
test('757-6: the glossary says what the judge entry can promise and defines the six words', () => {
  const h = read('docs/glossary/index.html');
  assert.deepEqual(glossaryHits(h), []);
  assert.notDeepEqual(glossaryHits(once(h, '<dt id="term-seal">', '<dt id="term-seal-planted">')), [], 'plant: an entry missing');
  assert.notDeepEqual(glossaryHits(h.replace('Within one report the grader stays fixed', 'One fixed grader scores every answer')), [], 'plant: the old judge words');
});

const FAKE_LABEL = "See your file's fake";
const fakeLabels = (h) => [...h.matchAll(/<a href="\/placebo\/">([\s\S]*?)<\/a>/g)].map((m) => textOf(m[1]));
function fakeLabelHits(pages) { return pages.flatMap(([name, h]) => { const all = fakeLabels(h); return (all.length ? all : ['(none)']).filter((l) => l !== FAKE_LABEL).map((l) => `${name}: "${l}"`); }); }
function fakePageHits(h, island) {
  const hits = [], t = textOf(h);
  if (!/<p class="lede">This is the decoy Driftproof tests in place of your text, the "sugar pill"\./.test(h.replace(/&quot;/g, '"'))) hits.push('the opening');
  for (const m of ['A CLAUDE.md, AGENTS.md or custom instructions', 'A skill (SKILL.md only)']) { if (!t.includes(m)) hits.push(`the page does not name ${m}`); if (!island.includes(m)) hits.push(`the island does not name ${m}`); }
  const details = (/<details><summary>Details<\/summary>([\s\S]*?)<\/details>/.exec(h) || [])[1] || '';
  if (!/seed/.test(details) || !/UTF-8/.test(details)) hits.push('the seed and UTF-8 detail is not in the Details box');
  if (!/<a href="\/try-it\/">Try it yourself<\/a>/.test((/<main[\s\S]*<\/main>/.exec(h) || [''])[0])) hits.push('no next step to Try it yourself');
  return hits;
}
test('757-7: the fake has one link label and its page speaks plainly', () => {
  const pages = [['home', homeHtml()], ['noticed', read('docs/noticed/index.html')]];
  assert.deepEqual(fakeLabelHits(pages), []);
  const [, home] = pages[0];
  assert.notDeepEqual(fakeLabelHits([['home', home.replace(`<a href="/placebo/">${FAKE_LABEL}</a>`, '<a href="/placebo/">Fake my file</a>')]]), [], 'plant: two link labels');
  const h = read('docs/placebo/index.html'), island = read('docs/islands/placebo.js');
  assert.deepEqual(fakePageHits(h, island), []);
  assert.notDeepEqual(fakePageHits(once(h, '<p class="lede">This is the decoy', '<p class="lede">Paste your file'), island), [], 'plant: the opening gone');
  assert.notDeepEqual(fakePageHits(h, island.replaceAll('A skill (SKILL.md only)', 'Skill: SKILL.md alone')), [], 'plant: the old mode name');
  assert.notDeepEqual(fakePageHits(h.replace('<a href="/try-it/">Try it yourself</a>', ''), island), [], 'plant: no next step');
});

// Spec 315 A-315-9 (issue 787): the words moved to F-2 and Q-1 with the Measure a skill form.
test('757-8: the lookup says the public request needs a GitHub account', () => {
  const h = read('docs/skill-lookup/index.html'), island = read('docs/islands/skill-lookup.js');
  const hits = (page, script) => [!textOf(page).includes('A public request needs a GitHub account.'), !script.includes("'Ask us to measure it (needs a GitHub account)'")].filter(Boolean);
  assert.deepEqual(hits(h, island), []);
  assert.notDeepEqual(hits(h.replace(' A public request needs a GitHub account.', ''), island), [], 'plant: the page without the words');
  assert.notDeepEqual(hits(h, island.replace(' (needs a GitHub account)', '')), [], 'plant: the summary without the words');
});
