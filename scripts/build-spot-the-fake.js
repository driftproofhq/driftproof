#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {"href":"/spot-the-fake/","label":"Which bar is the fake?"}
// Issue 692: fixed, score-independent rounds from the published report readers.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { readCases, placeboReading } = require('../lib/verdict');
const { bandOf } = require('../lib/reuse');
const { suiteIdentity } = require('../lib/skill');
const { humanModelName } = require('./model-names');
const { esc } = require('./site-chrome');
const { applyHeadTags } = require('./build-head-tags');
const ROOT = path.resolve(__dirname, '..');
const REL = 'spot-the-fake/index.html';
const TITLE = 'Which bar is the fake?';
const DESCRIPTION = 'One task. Three score ranges. Can you spot the same-length fake? Pick a bar, reveal the labels, and read the receipt.';
const REMINDER = 'Beating the fake is not beating nothing.';
const sha = x => createHash('sha256').update(x).digest('hex');
const need = (ok, code) => { if (!ok) throw new Error(code); };
const order = (items, key) => items.slice().sort((a, b) => sha(key(a)).localeCompare(sha(key(b))));
let cached;
function sources() {
  if (cached) return cached;
  const readers = ['017', '018'].map(report => ({ report, reader: require('./prepare-report-' + report) }));
  const campaigns = readers.map(({ report, reader }) => ({ report, campaign: reader.readCampaign({ campaignRoot: path.join(ROOT, reader.CAMPAIGN) }) }));
  const handoffs = campaigns[1].campaign.rows.filter(r => r.handoff);
  cached = campaigns.flatMap(({ report, campaign }) => campaign.rows
    .filter(row => row.receipt && !row.router && !handoffs.some(h => h.skill === row.skill && h.repository === row.repository))
    .map(row => ({ report, row })));
  return cached;
}
// Ten skills per report, then a fixed shuffle across the two reports. Never read results here.
function select(inputs) {
  const selected = ['017', '018'].flatMap(report => {
    const rows = inputs.filter(s => s.report === report);
    need(rows.length >= 10, 'ROUND_COUNT');
    return order(rows, s => '692:skill:' + report + ':' + s.row.attempt_id).slice(0, 10);
  });
  return order(selected, s => '692:round:' + s.report + ':' + s.row.attempt_id);
}
function roundOf({ report, row, suiteBytes }) {
  const r = row.receipt;
  need(validateReceipt(r).valid && verifyReceiptHash(r), 'RECEIPT_SEAL');
  need(r.verification_level === 'TESTED', 'RECEIPT_LEVEL');
  const suiteSource = 'docs/skills/receipts/issue-408/suites/' + row.attempt.protocol.evals_sha256 + '.json';
  const bytes = suiteBytes || fs.readFileSync(path.join(ROOT, suiteSource));
  need(sha(bytes) === row.attempt.protocol.evals_sha256, 'SUITE_FILE');
  const suite = JSON.parse(bytes.toString('utf8'));
  need(suiteIdentity(suite).suiteHash === r.suite.suite_hash && suite.cases.length === r.suite.case_count && suite.cases.length === 3, 'SUITE_BINDING');
  const key = report + ':' + row.attempt_id;
  const task = order(suite.cases, c => '692:task:' + key + ':' + c.id)[0];
  const fake = placeboReading(r).cases.find(c => c.id === task.id);
  const none = readCases(r).find(c => c.id === task.id);
  need(fake && none, 'TASK_READING');
  const arms = order(['with_skill', 'placebo', 'baseline'], mode => '692:arm:' + key + ':' + mode).map(mode => {
    const rows = r.results.cases.filter(c => c.id === task.id && c.mode === mode);
    need(rows.length === 1, 'TASK_ARMS');
    const arm = bandOf(rows[0]);
    need(arm && Number.isFinite(arm.mean) && Number.isFinite(arm.sd), 'TASK_RANGE');
    return { mode, mean: arm.mean, sd: arm.sd, lo: Math.max(0, arm.lo), hi: Math.min(1, arm.hi) };
  });
  const limitation = report === '018' ? row.limitation : '';
  need(report !== '018' || limitation, 'JUDGE_LIMITATION');
  need(fs.existsSync(path.join(ROOT, 'docs/r', r.receipt_hash, 'index.html')), 'RECEIPT_PAGE');
  return { key, report, skill: row.skill, task: task.id, prompt: task.prompt,
    source: row.src, receipt: '/r/' + r.receipt_hash + '/', suiteSource, suiteFileHash: sha(bytes),
    taskCount: suite.cases.length, model: r.run.model_id, modelName: humanModelName(r.run.model_id),
    judgeName: humanModelName(r.run.judge.model_id), arms,
    readings: { fake: fake.state, none: none.state }, reminder: REMINDER, limitation,
    scope: 'Only three text tasks per skill, written by Driftproof. No tools or files. These readings describe these runs only.' };
}
function build() {
  const data = { rounds: select(sources()).map(roundOf) };
  const raw = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + TITLE + ' | Driftproof</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/spot-the-fake/style.css"></head><body>'
    + '<main class="fake-page"><header class="fake-intro"><p class="fake-eyebrow">A little game about AI skills</p><h1>Which bar is <br>the fake?</h1>'
    + '<p class="lede">' + DESCRIPTION + '</p><p class="fake-how">An AI answered with a skill, with unrelated text of the same length, and with no skill text. The labels are hidden. <strong>Tap the bar you think is the fake.</strong></p></header>'
    + '<section class="fake-game" aria-label="Spot the fake" data-island="spot-the-fake" data-game="' + esc(JSON.stringify(data)) + '">'
    + '<p>The game needs JavaScript. Read the tasks and their readings in <a href="/reports/017/">Report 017</a> and <a href="/reports/018/">Report 018</a>.</p></section>'
    + '<aside class="fake-note"><h2>A guess is not a verdict.</h2><p>This game moves no verdict and says nothing about a skill beyond these readings. Your tally stays on this screen. It is never stored or sent.</p>'
    + '<p>Each bar is the average plus or minus one spread across repeated answers, clipped to the score scale. The dot is the average. A wider bar means more variation, not more certainty.</p>'
    + '<p>These are existing receipts, with no new model run. The rounds are a fixed shuffle, chosen without looking at scores. Reports <a href="/reports/017/">017</a> and <a href="/reports/018/">018</a> keep the full context.</p></aside></main></body></html>\n';
  return applyHeadTags(applyHeadTags(raw, REL), REL);
}
function check(file = path.join(ROOT, 'docs', REL)) {
  need(fs.existsSync(file) && fs.readFileSync(file, 'utf8') === build(), 'GAME_PAGE_DRIFT');
}
function main() {
  const html = build(), file = path.join(ROOT, 'docs', REL);
  if (process.argv.includes('--check')) {
    check(file);
    console.log('spot the fake: page matches 20 receipt-derived rounds');
  } else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html); console.log('spot the fake: wrote 20 receipt-derived rounds'); }
}
module.exports = { sources, select, roundOf, build, check, REL };
if (require.main === module) try { main(); } catch (e) { console.error('spot the fake: refused: ' + e.message); process.exitCode = 1; }
