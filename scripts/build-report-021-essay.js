#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs = require('node:fs'), path = require('node:path');
const RC = require('./report-count'), {esc} = require('./site-chrome');
const ROOT = path.resolve(__dirname, '..');
const REL = 'docs/writing/three-releases/index.html';
const OPEN = '<!--driftproof:report-021-essay-->', CLOSE = '<!--/driftproof:report-021-essay-->';
function renderEssay(html, root = ROOT) {
  const rows = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/reports.json'), 'utf8')).reports;
  const sentence = rows.find(r => r.number.value === '021').verdict_line.value;
  const page = fs.readFileSync(path.join(root, 'docs/reports/021/index.html'), 'utf8');
  if (!require('./html-text').htmlToText(page, {collapse: true}).includes(sentence)) throw new Error('Report 021 essay sentence is absent from the approved page');
  const block = OPEN + '<p><a href="/reports/021/">Report #021</a>: ' + esc(sentence) + '</p>' + CLOSE;
  const anchor = '<!--/driftproof:campaign-essay-->';
  let out = String(html);
  if (out.includes(OPEN)) out = out.replace(new RegExp(OPEN + '[\\s\\S]*?' + CLOSE), block);
  else {
    if (!out.includes(anchor)) throw new Error('campaign essay insertion point missing');
    out = out.replace(anchor, anchor + '\n' + block);
  }
  const reports = RC.numberWord(RC.reportCount(root));
  const kinds = RC.numberWord(new Set(rows.map(r => r.type.value)).size);
  return out.replace(new RegExp('\\b(?:' + RC.NUMBER_WORD + ') reports in', 'gi'), reports[0].toUpperCase() + reports.slice(1) + ' reports in')
    .replace(new RegExp('What I take from (?:' + RC.NUMBER_WORD + ') reports'), 'What I take from ' + reports + ' reports')
    .replace(new RegExp('\\b(?:' + RC.NUMBER_WORD + ') report types\\b', 'g'), kinds + ' report types');
}
// A focused update keeps prior campaign entries intact when an older reader is unavailable.
function renderReadme(text, root = ROOT) {
  const rows = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/reports.json'), 'utf8')).reports;
  const newest = rows.slice().sort((a,b) => Number(b.number.value) - Number(a.number.value))[0];
  const sentence = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/report-summaries.json'), 'utf8')).reports['021'].points.find(p=>p.lead==='What we found.').text;
  const page = fs.readFileSync(path.join(root, 'docs/reports/021/index.html'), 'utf8');
  if (!require('./html-text').htmlToText(page, {collapse:true}).includes(sentence)) throw new Error('Report 021 README sentence is absent from the approved page');
  const counts = {reports:RC.numberWord(RC.reportCount(root)),kinds:RC.numberWord(new Set(rows.map(r=>r.type.value)).size),essay:RC.essayCount(fs.readFileSync(path.join(root, REL),'utf8'))};
  let out = RC.writeReadmeCounts(text, counts);
  out = out.replace(/the newest being [^.]+\./, 'the newest being ' + newest.type.value.replace(/ report$/, '').toLowerCase() + '.');
  const open='<!--driftproof:campaign-readme-->',close='<!--/driftproof:campaign-readme-->';
  const a=out.indexOf(open),b=out.indexOf(close);
  if(a<0||b<a)throw new Error('campaign README block missing');
  const entry='- **[Report #021](https://driftproofhq.com/reports/021/)**: *rules-file quality*. '+sentence;
  let block=out.slice(a+open.length,b);
  const existing=/^- \*\*\[Report #021\][^\n]*$/m;
  block=existing.test(block)?block.replace(existing,entry):block.replace(/\n?$/, '\n'+entry+'\n');
  return out.slice(0,a+open.length)+block+out.slice(b);
}
module.exports = {renderEssay, renderReadme, REL};
if (require.main === module) {
  const file = path.join(ROOT, REL), before = fs.readFileSync(file, 'utf8');
  const after = require('./build-head-tags').render(renderEssay(before), REL.slice(5));
  if (process.argv.includes('--check')) {
    if (before !== after) { console.error('Report 021 essay: stale'); process.exitCode = 1; }
    else console.log('Report 021 essay: approved sentence and report counts current');
  } else { fs.writeFileSync(file, after); console.log('Report 021 essay: built from the approved page and report catalogue'); }
}
