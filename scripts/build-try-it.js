#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {"href":"/try-it/","label":"Try it yourself"}
// Issue 726. The worksheet for a person who only has a chat window: freeze the task and the guide,
// collect answers with the instructions, with a same-length fake and with nothing, score them blind,
// read the result by the library's rule. The tasks embedded here are the suites' own bytes, bound as
// scripts/build-tasks.js binds them; the rule and the floor reach the page through
// lib/import-core/band.mjs, never typed; the fake is built in the browser from the person's bytes.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { suiteIdentity } = require('../lib/skill');
const S = require('./sugar-pill-page');
const { bindSuite } = require('./build-tasks');
const ROOT = path.join(__dirname, '..');
const REL = 'try-it/index.html';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const need = (ok, code) => { if (!ok) throw new Error(code); };

// The five sentences the island never touches. tests/try-it.test.js holds its own copy.
const CAVEATS = [
  "Your scores are one reader's, not a judge's.",
  'Three answers per arm is a first look, not a measurement.',
  'The fake is an unrelated passage about a market town, the same length as your instructions. Scoring above it can show at most that your words did more than this one unrelated text of the same length, on this task, on this day. It does not show that they beat every text of that length, or what the instructions would do in a different chat, model or day.',
  'Memory and hidden routing in your assistant were not controlled.',
  'Driftproof does it with several answers per arm, a judge model and a fake of the same length.',
];
// The one copy of this step: the island reads it from the static steps, as it reads the caveats.
const TURN_OFF = 'Before you collect answers, turn off what your app adds by itself: saved custom instructions, personalization, project instructions and memory. Keep them off until you have all nine answers. If they stay on, every answer gets them and the test cannot see a difference. Then paste the text by hand, where this page says to.';
// The page's first paragraph, so also its description: 155 characters at most (spec 133 AC-4).
const LEDE = 'Test your custom instructions, a saved prompt or a CLAUDE.md the way Driftproof does: freeze the task first, score blind, read the result by the rule.';

// Every measured skill's tasks, from the suite each report's receipt binds (SUITE_BINDING otherwise).
function skillsData(skills = S.skillsOf()) {
  return skills.map(s => {
    const suites = s.measurements.map(m => bindSuite(fs.readFileSync(path.join(ROOT, 'docs/skills/receipts/issue-408/suites/' + m.row.attempt.protocol.evals_sha256 + '.json')), m));
    need(suites.every(raw => JSON.stringify(raw) === JSON.stringify(suites[0])), 'SUITE_BINDING: reports disagree');
    const raw = suites[0];
    return { name: s.name, repository: s.repository, href: '/tasks/' + s.repository + '/' + s.name + '/', suite_hash: suiteIdentity(raw).suiteHash, tasks: raw.cases.map(c => ({ id: c.id, prompt: c.prompt, rubric: c.rubric })) };
  });
}

function steps() {
  return '<ol class="try-steps">'
    + '<li><strong>Freeze the task and the guide.</strong> Pick a task from the tests Driftproof published, or write a prompt and a four-point scoring guide. Paste the instructions you want to test in their own box, and the page builds a fake of the same length for them. Lock all three before any answer arrives.</li>'
    + '<li><strong>Collect answers.</strong> <span data-turn-off>' + TURN_OFF + '</span> Open a new chat for each answer, on the same model. Ask the prompt three times with your instructions in front of it, three times with the fake in their place, and three times with nothing added.</li>'
    + '<li><strong>Score blind.</strong> The page shuffles the nine answers and hides which were which. Score each one against the frozen guide, from 0 to 4.</li>'
    + '<li><strong>Read the result.</strong> Once every answer has a score, Reveal shows which answers had which text, and gives three readings by the same rule Driftproof uses for a skill.</li>'
    + '<li><strong>Keep it.</strong> Print the sheet or download it as a file. Nothing you type is sent anywhere. This browser keeps your unfinished worksheet until you clear it.</li>'
    + '</ol>';
}

function main(data) {
  const source = zlib.gzipSync(Buffer.from(JSON.stringify({ skills: data }))).toString('base64');
  return '<main class="try-page story">'
    + '<header class="try-intro"><h1>Try it yourself</h1>'
    + '<p class="lede">' + LEDE + '</p>'
    + '<p>You need a chat window and about 30 minutes: nine new chats, then nine scores. Nothing you type here is sent anywhere.</p></header>'
    + '<section class="try-sheet" data-island="try-it" data-tasks-source="' + source + '" aria-label="The worksheet">'
    + steps()
    + '<p>This worksheet needs JavaScript to shuffle and score. You can still read <a href="/tasks/">every task we gave a skill</a>, with its scoring guide, and try one in your own assistant.</p>'
    + '</section>'
    + '<aside class="try-caveats" aria-label="What this worksheet cannot tell you"><h2>Read this beside your result</h2><ul>' + CAVEATS.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>'
    + '<p><a href="/how-it-works/">How Driftproof does it, step by step</a></p></aside>'
    + '<details class="try-about"><summary>About this worksheet and your privacy</summary>'
    + '<p>The tasks and scoring guides offered here are the ones Driftproof published for each skill it tested, byte for byte, bound to the same test files its reports seal. Your own prompt and guide are yours alone.</p>'
    + '<p>The result is read by the rule the library uses: the average and the spread of each set of scores, two ranges that must sit fully apart, and a smallest gap that counts. Your 0 to 4 scores are read on the library’s 0 to 1 scale, so that gap keeps its meaning. The rule and the gap come from the library’s own module; this page types neither.</p>'
    + '<p>Nothing you type is sent anywhere, put in the address or kept in a cookie. This browser keeps your unfinished worksheet so a reload does not lose it: the task, the guide, the instructions, the model name and the answers, never your scores. The Clear everything button removes it. The site’s standard visit counter still counts the page view.</p>'
    + '<p>The fake is built in your browser, from the same pinned sentences and steps the runner uses. Your text sets its length and the order of its sentences, not its words, so it is the same length as your instructions, byte for byte, and it changes only when your text does.</p>'
    + '</details></main>';
}

function pageOf(data = skillsData()) {
  const { shell } = require('./build-site-pages');
  const { render } = require('./build-head-tags');
  need(data.length >= 1 && data.every(s => s.tasks.length >= 1), 'TASKS');
  return render(shell({ title: 'Try it yourself | Driftproof', description: LEDE, main: main(data), head: '<link rel="stylesheet" href="/try-it/style.css">\n' }), REL);
}
function check() { need(fs.existsSync(path.join(ROOT, 'docs', REL)) && fs.readFileSync(path.join(ROOT, 'docs', REL), 'utf8') === pageOf(), 'STALE: ' + REL); }
function write() { fs.mkdirSync(path.join(ROOT, 'docs/try-it'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'docs', REL), pageOf()); }
module.exports = { CAVEATS, skillsData, pageOf, check, write };
if (require.main === module) {
  try {
    need(process.argv.slice(2).every(a => a === '--check'), 'Unknown argument');
    (process.argv.includes('--check') ? check : write)();
    console.log('try it: page ' + (process.argv.includes('--check') ? 'matches its sources' : 'built from the bound suites'));
  } catch (e) { console.error('try it: refused: ' + e.message); process.exitCode = 1; }
}
