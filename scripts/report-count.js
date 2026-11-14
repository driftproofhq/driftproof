// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/report-count.js - how many reports are published, said in words (issue 797).
//
// ONE SOURCE. The count is the length of docs/data/reports.json's report list, the list the README's
// roll and the reports index are read against (spec 126 AC-5). Each listed report must have its page
// at docs/reports/NNN/index.html, and no page may be missing from the list: a disagreement throws, so
// no builder prints a count the pages do not bear out. The numbering has a gap (there is no Report
// 012), so the newest number is not the count.
//
// The word is spelled for any count below a hundred, so the next report moves every count that reads
// it and breaks none (the lists this replaces stopped at eighteen).
//
// README_COUNTS names the README's count sentences outside its first screen, each by its own words, so
// a rewrite touches those sentences and never another "<word> reports" in the file. The first screen's
// "All <word> reports" link is scripts/build-readme-opening.mjs's, from docs/data/stats.json.
const fs = require('fs');
const path = require('path');

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numberWord(n) {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`no word for ${n}: a count is spelled from zero to ninety-nine`);
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}
const capital = (w) => w.charAt(0).toUpperCase() + w.slice(1);
// Every number word, longest first, so "twenty-one" wins over "twenty".
const NUMBER_WORD = Array.from({ length: 100 }, (_, i) => numberWord(i)).sort((a, b) => b.length - a.length).join('|');

function reportList(root) {
  const rows = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'data', 'reports.json'), 'utf8')).reports;
  const dir = path.join(root, 'docs', 'reports');
  const pages = fs.readdirSync(dir).filter((x) => /^\d+$/.test(x) && fs.existsSync(path.join(dir, x, 'index.html')));
  return listAgainstPages(rows.map((r) => String(r.number.value)), pages);
}
// The list, held to the pages: every listed report has a page and every page is listed.
function listAgainstPages(listed, pages) {
  const noPage = listed.filter((n) => !pages.includes(n));
  const unlisted = pages.filter((n) => !listed.includes(n));
  if (noPage.length || unlisted.length) throw new Error(`docs/data/reports.json and docs/reports/ disagree: listed without a page ${JSON.stringify(noPage)}, a page not listed ${JSON.stringify(unlisted)}`);
  return listed;
}
const reportCount = (root) => reportList(root).length;

// The README's count sentences below the first screen. `essay` is the launch essay's own count of the
// reports it reads, taken from the essay's text, so the README says the essay's number.
const README_COUNTS = [
  { what: 'the roll\'s opening sentence', re: new RegExp(`^(${NUMBER_WORD}) reports are published, spanning (${NUMBER_WORD}) report types`, 'mi'),
    write: (c) => `${capital(c.reports)} reports are published, spanning ${c.kinds} report types` },
  { what: 'the roll\'s heading line', re: new RegExp(`\\*\\*(${NUMBER_WORD}) published reports\\*\\*`, 'i'),
    write: (c) => `**${capital(c.reports)} published reports**` },
  { what: 'the roll\'s report types', re: new RegExp(`spanning (${NUMBER_WORD}) published report types`, 'i'),
    write: (c) => `spanning ${c.kinds} published report types` },
  { what: 'the launch essay\'s count', re: new RegExp(`reads all (${NUMBER_WORD}) reports`, 'i'),
    write: (c) => `reads all ${c.essay} reports` },
];
// counts: { reports, kinds, essay }, each a word. Throws when a sentence is not in the text, so a
// reworded README is a failure, not a silent skip.
function writeReadmeCounts(text, counts) {
  let out = String(text);
  for (const s of README_COUNTS) {
    if (!s.re.test(out)) throw new Error(`README.md carries no ${s.what} (${s.re.source.slice(0, 60)}...)`);
    out = out.replace(s.re, s.write(counts));
  }
  return out;
}
// The sentences whose count is not the one given: [] when every count is current.
function staleReadmeCounts(text, counts) {
  return README_COUNTS.filter((s) => { const m = s.re.exec(String(text)); return !m || m[0] !== s.write(counts); }).map((s) => s.what);
}
// The essay's own count: "<Word> reports in, here is what the records say."
function essayCount(essayHtml) {
  const m = new RegExp(`\\b(${NUMBER_WORD}) reports in, here is what the records say\\.`, 'i').exec(String(essayHtml));
  if (!m) throw new Error('the launch essay carries no "<word> reports in, here is what the records say." sentence');
  return m[1].toLowerCase();
}

module.exports = { numberWord, NUMBER_WORD, reportList, listAgainstPages, reportCount, README_COUNTS, writeReadmeCounts, staleReadmeCounts, essayCount };
