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

test('652-2: the homepage says of Windows what the README Platforms section says', () => {
  const platforms = /\*\*Platforms\.\*\*([\s\S]*?)\n\n/.exec(read('README.md'));
  assert.ok(platforms, 'README.md has a Platforms paragraph');
  const home = textOf((/<section id="quickstart"[\s\S]*?<\/section>/.exec(read('docs/index.html')) || [''])[0]);
  for (const s of [platforms[1].replace(/\s+/g, ' '), home]) {
    assert.doesNotMatch(s, /Windows is untested|CI matrix across Linux, macOS and Windows is planned/);
    assert.match(s, /Public Windows CI runs the package gate, a stubbed first run, selected core tests and the plugin's own compatibility and runner-launch tests\. These checks make no model calls and do not establish real-provider support\. On Windows the plugin needs Node, npm's bundled npx and Git for Windows on PATH\./);
  }
});

test("652-3: llms.txt, the homepage card and stats.json head Report 017 with its page's title", () => {
  const h1 = textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(read('docs/reports/017/index.html'))[1]);
  assert.equal(h1, 'Skill or sugar pill? Twenty skills against a same-length placebo');
  const llms = read('docs/llms.txt').split('\n').find((l) => l.includes('/reports/017/'));
  assert.ok(llms && llms.startsWith(`- [Report 017: ${h1}](`), llms);
  const stats = JSON.parse(read('docs/data/stats.json'));
  assert.equal(stats.latest_report_title.value, h1);
  const card = /<span data-stat="latest_report_title">([\s\S]*?)<\/span>/.exec(read('docs/index.html'));
  assert.ok(card, 'the homepage latest card names latest_report_title');
  assert.equal(textOf(card[1]), h1);
  assert.doesNotMatch(read('docs/index.html'), /data-stat="latest_report_what_moved"/);
  // Every other report's title read this way is what moved, so no other card moved.
  const { reportName } = require('../scripts/build-site-pages.js');
  for (const r of JSON.parse(read('docs/data/reports.json')).reports) if (r.number.value !== '017') assert.equal(reportName(r), r.what_moved.value, r.number.value);
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
  const summary = JSON.parse(read('docs/data/report-summaries.json')).reports['017'].points.find((p) => p.lead === 'What we found.').text;
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
