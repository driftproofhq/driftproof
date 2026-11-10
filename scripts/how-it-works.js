// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 640 (spec 640): /how-it-works/, how Driftproof tests a skill, in five screens, with one real
// Report 017 skill. Every figure, prompt, answer, reason and reading on the page is read here from
// that skill's sealed receipt, its kept answers and its published suite, and checked first; the
// words for a reading are lib/plain.js's and lib/verdict.js's, never typed. The island
// (docs/islands/how-it-works.js) only shows one screen at a time; without it all five are stacked.
// scripts/build-site-pages.js renders the page; its --check reads it current.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const P17 = require('./prepare-report-017.js');
const { reconstruct } = require('../specs/408-skill-measurements/reconstruct.cjs');
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { plainOf, KEY, LABELS } = require('../lib/plain');
const { placeboLine, placeboReading, receiptVerdict, armOf, PLACEBO_WORDS, UNDERPOWERED_LINE } = require('../lib/verdict');
const { suiteIdentity } = require('../lib/skill');
const { promptTemplateHash } = require('../lib/judge');
const { extractJsonObject } = require('../lib/json');
const { SAMPLING } = require('../lib/sampling');
const { EFFECT_FLOOR } = require('../config');
const policy = require('../lib/report-015-publication');
const { humanModelName } = require('./model-names');
const { esc } = require('./site-chrome.js');
const { htmlToText } = require('./html-text.js');

const ROOT = path.join(__dirname, '..');
const REL = 'how-it-works/index.html';
const H1 = 'How Driftproof tests a skill, step by step';
const TITLE = H1 + ' | Driftproof';
// The opening paragraph, which is also the page's description (scripts/build-head-tags.js).
const LEDE = "How Driftproof tests a skill in five steps, with one real example from Report 017: the task, three answers, the judge's scores and the reading.";
// The twenty SKILL.md texts the plan pins, by attempt id (spec 640 Terms). Not published.
const SKILLS = path.join(ROOT, 'specs', '640-how-it-works', 'skills');
const MODES = ['with_skill', 'placebo', 'baseline'];
const WAY = { with_skill: 'With the skill', placebo: 'With the placebo', baseline: 'With no skill text added' };
// Every task in a Report 015 suite opens with this sentence (spec 408); the scope line says so (AC-17).
const NO_TOOLS = 'Do not use tools, access the network, write files, run commands or install anything.';
// One task's case-rule state in the site's plain words (spec 125 C-3), as scripts/prepare-report-013.js
// PLAIN holds them; that builder does not export them, so the test holds the two equal.
const STATE_WORDS = {
  'separated-up': 'clearly higher',
  'separated-down': 'clearly lower',
  'not-separated': 'no clear difference',
  underpowered: 'too few answers to tell',
  inconclusive: 'inconclusive',
};

const sha = (b) => createHash('sha256').update(b).digest('hex');
function need(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
const n3 = (x) => x.toFixed(3);
const fmtDate = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(d));
const bodyOf = (text) => String(text).replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

// A HAND-OFF (spec 640 Terms): after the front matter, the body is only one or more instructions to
// call the Skill tool. TODO(issue 642): use the shared function issue 642 adds once it is on dev.
function isHandoff(text) {
  const lines = bodyOf(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => /^Call the Skill tool\b.*\.$/.test(l));
}

// THE EXAMPLE RULE (spec 640 AC-1): the counted skills with a receipt, less the hand-offs, through
// Report 017's own panel rule, which orders by the placebo block's skill_bytes and checks the pinned
// text and its rebuilt placebo against the receipt. It reads text and length, never a score.
function pickOf(campaign, { skillsDir = SKILLS, limit = policy.routerLimit } = {}) {
  const kept = campaign.rows.filter((r) => !r.router && r.receipt).filter((r) => {
    const file = path.join(skillsDir, r.attempt_id + '.md');
    need(fs.existsSync(file), 'HOW_SKILL_TEXT');
    const bytes = fs.readFileSync(file);
    need(sha(bytes) === r.attempt.protocol.skill_sha256, 'HOW_SKILL_TEXT');
    return !isHandoff(bytes.toString('utf8'));
  });
  const panel = P17.panelOf(kept, skillsDir);
  need(!panel.row.router && !limit(panel.row.receipt), 'HOW_EXAMPLE_ROUTER');
  return panel;
}

// An answer's opening: at most `max` characters, cut back to the end of a word, and past any trailing
// token with no letter or digit (a list marker the cut left alone).
function excerptOf(text, max = 240) {
  const chars = [...String(text)];
  let cut = chars.slice(0, max).join('');
  if (chars.length > max && !/\s/.test(chars[max])) { const at = cut.search(/\s\S*$/); if (at > 0) cut = cut.slice(0, at); }
  return cut.replace(/(?:\s+[^\p{L}\p{N}\s]+)+\s*$/u, '').trimEnd();
}
// A text's first sentence, from its start to its first full stop, at most 240 characters.
function firstSentence(text) {
  const s = String(text).trimStart(), m = /^[\s\S]*?[.!?](?=\s|$)/.exec(s);
  return excerptOf(m ? m[0] : s);
}
// The guide's numbered points, verbatim from the task's rubric, and the weight it gives each.
const GUIDE_AT = 'sum to a score from 0 to 1.';
function guideOf(rubric) {
  const at = rubric.indexOf(GUIDE_AT), weight = /Award ([0-9.]+) for each/.exec(rubric);
  need(at >= 0 && weight, 'HOW_PROMPT_BINDING');
  const points = rubric.slice(at + GUIDE_AT.length).split(/\s*\b\d\.\s+/).map((s) => s.trim()).filter(Boolean);
  need(points.length > 0, 'HOW_PROMPT_BINDING');
  return { weight: weight[1], points };
}
// Markdown marks rendered as plain text (spec 640 AC-4): headings and emphasis lose their marks, a
// list item reads as a bullet, a rule line is dropped. The raw opening is kept in data-raw.
function plainMarkdown(raw) {
  const inline = (s) => esc(s.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1').replace(/\*\*|`/g, ''));
  return raw.split(/\n\s*\n/).map((block) => block.split('\n')
    .filter((l) => !/^\s*(?:-{3,}|\*{3,})\s*$/.test(l))
    .map((l) => inline(l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '• ')))
    .filter((l) => l.trim()).join('<br>')).filter(Boolean).map((p) => `<p>${p}</p>`).join('');
}
// Spec 020 AC-42's reading of a page's text: no doubled full stop, no spaced hyphen. A quoted text
// that carries one is refused, never changed (spec 640 AC-14). Read by the tokenizer of
// scripts/html-text.js (issue 661, CodeQL js/bad-tag-filter): a script or style element is dropped
// whole, whatever the letter case of its tags or the white space in its end tag; a ">" inside a
// quoted attribute stays inside its tag; every tag or comment leaves a space; and each entity is
// decoded once, after the tags are gone.
const ENTITIES = { lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' };
const decodeOnce = (s) => s.replace(/&(lt|gt|quot|#39|amp);/g, (m, k) => ENTITIES[k]);
function textOf(h) {
  return htmlToText(h, { skip: ['script', 'style'], skipText: ' ', tagText: ' ', commentText: ' ', decode: decodeOnce, collapse: true })
    .replace(/\s+([.,;:!?])/g, '$1').replace(/\(\s+/g, '(');
}
function assertPageText(h) { need(!/\.\.| - /.test(textOf(h)), 'HOW_PAGE_TEXT'); return h; }

let cached = null;
const campaignOf = () => (cached ||= P17.readCampaign({ campaignRoot: path.join(ROOT, P17.CAMPAIGN) }));
const suiteRel = (q) => `docs/skills/receipts/issue-408/suites/${q.evals_sha256}.json`;

// The example, read and checked (spec 640 AC-1 to AC-6, AC-16, AC-17). The options are the tests'
// plants: another campaign, answers, suite bytes, skill texts or router limit.
function exampleOf({ campaign, skillsDir, answers, suiteBytes, limit } = {}) {
  const c = campaign || campaignOf();
  const panel = pickOf(c, { skillsDir, limit });
  const row = panel.row, r = row.receipt, q = row.attempt.protocol;
  need(verifyReceiptHash(r), 'RECEIPT_SEAL');
  const ids = [...new Set(r.results.cases.map((x) => x.id))];
  need(ids.length > 0 && ids.every((id) => MODES.every((m) => r.results.cases.filter((x) => x.id === id && x.mode === m).length === 1)), 'HOW_ARMS');
  need(r.run.judge.model_id !== r.run.model_id, 'HOW_JUDGE_SEPARATE');
  need(r.run.judge.prompt_template_hash === promptTemplateHash(), 'HOW_JUDGE_TEMPLATE');
  need(validateReceipt(r).valid, 'RECEIPT_SCHEMA');
  const answersRel = row.src.replace(/\.json$/, '-answers.json');
  const kept = answers || JSON.parse(fs.readFileSync(path.join(ROOT, answersRel), 'utf8'));
  need(kept.receipt_hash === r.receipt_hash, 'HOW_ANSWER_BINDING');
  reconstruct(r, kept);
  const bytes = suiteBytes || fs.readFileSync(path.join(ROOT, suiteRel(q)));
  need(sha(bytes) === q.evals_sha256, 'HOW_PROMPT_BINDING');
  const suite = JSON.parse(bytes.toString('utf8'));
  need(suiteIdentity(suite).suiteHash === r.suite.suite_hash, 'HOW_PROMPT_BINDING');
  need(suite.author === 'Driftproof' && suite.cases.length === r.suite.case_count && suite.cases.every((x) => x.prompt.startsWith(NO_TOOLS)), 'HOW_SCOPE');
  const task = suite.cases.find((x) => ids.includes(x.id));
  const caseRow = (id, mode) => r.results.cases.find((x) => x.id === id && x.mode === mode);
  // Each way's first draw on the first task, whatever it scored, with its sealed answer and reason.
  const ways = MODES.map((mode) => {
    const rowOf = caseRow(task.id, mode), d = rowOf.generation.draws.find((x) => x.draw_index === 0);
    need(d && typeof d.generation_hash === 'string', 'HOW_ANSWER_BINDING');
    const full = kept.answers[d.generation_hash];
    need(typeof full === 'string' && sha(full) === d.generation_hash, 'HOW_ANSWER_BINDING');
    const ev = kept.draws.find((x) => x.id === task.id && x.mode === mode && x.draw_index === 0);
    need(ev && ev.generation_hash === d.generation_hash && ev.judge_outputs.length === d.judge_sample_hashes.length
      && ev.judge_outputs.every((o, i) => sha(o) === d.judge_sample_hashes[i]), 'HOW_ANSWER_BINDING');
    const reason = extractJsonObject(ev.judge_outputs[0]).reason;
    need(typeof reason === 'string' && reason.trim().length > 0, 'HOW_ANSWER_BINDING');
    return { mode, draws: rowOf.generation.draws.length, draw: d, length: [...full].length, excerpt: excerptOf(full), reason };
  });
  // Each task, the skill against each other way, from this receipt's rows (spec 640 AC-16).
  const v = receiptVerdict(r), pr = placeboReading(r);
  const tasks = v.cases.map((x) => {
    const p = pr.cases.find((y) => y.id === x.id);
    need(p && STATE_WORDS[x.state] && STATE_WORDS[p.state], 'HOW_ARMS');
    return { id: x.id, skill: armOf(caseRow(x.id, 'with_skill')), none: armOf(caseRow(x.id, 'baseline')), placebo: armOf(caseRow(x.id, 'placebo')), none_state: x.state, placebo_state: p.state };
  });
  const deciding = (cases, reading, up, down) => (reading === up ? cases.filter((x) => x.state === 'separated-up') : reading === down ? cases.filter((x) => x.state === 'separated-down') : []).map((x) => x.id);
  return {
    row, receipt: r, answersRel, suiteRel: suiteRel(q), suite, task, guide: guideOf(task.rubric), ways, tasks,
    skillOpening: firstSentence(bodyOf(panel.text)), placeboOpening: firstSentence(panel.fake),
    plain: plainOf(r), placeboLine: placeboLine(pr),
    deciding: { verdict: deciding(v.cases, v.verdict, 'PASSED', 'REGRESSED'), placebo: deciding(pr.cases, pr.reading, 'ABOVE_PLACEBO', 'BELOW_PLACEBO') },
  };
}

// A read figure, in a data element naming the file it came from (spec 640 AC-6).
const fig = (value, src, name, shown = value) => `<data value="${esc(value)}" data-src="${esc(src)}"${name ? ` data-fig="${name}"` : ''}>${esc(shown)}</data>`;
const lib = (s, tag = 'span') => `<${tag} data-quote="library">${esc(s)}</${tag}>`;
const quote = (s, tag = 'blockquote', attrs = '') => `<${tag} class="how-quote" data-quote="text"${attrs}>${esc(s)}</${tag}>`;
const joinAnd = (xs) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function stepsHTML(ex) {
  const r = ex.receipt, src = ex.row.src, q = ex.row.attempt.protocol;
  const model = humanModelName(r.run.model_id), judge = humanModelName(r.run.judge.model_id);
  const skill = esc(ex.row.skill), date = fig(r.run.date_utc.slice(0, 10), src, 'date', fmtDate(r.run.date_utc));
  const count = fig(r.suite.case_count, src, 'tasks');
  const step = (n, title, body) => `<section class="how-step" id="step-${n}" data-step="${n}" aria-labelledby="step-${n}-title">\n<h2 id="step-${n}-title" tabindex="-1">${n}. ${esc(title)}</h2>\n${body}\n</section>`;
  const one = step(1, 'One task, three ways', [
    `<p>Driftproof gives an AI model a task Driftproof wrote to test the skill, in three ways. Here is a real task, for the ${skill} skill:</p>`,
    quote(ex.task.prompt, 'blockquote', ' data-prompt'),
  ].join('\n'));
  const two = step(2, 'With the skill, a placebo, or no skill text', [
    '<p>One way with the skill, one with a placebo, one with no skill text added.</p>',
    '<p data-term="placebo">A placebo is a text exactly as long as the skill, built from sentences chosen without looking at any task.</p>',
    `<p>The skill is ${fig(r.placebo.skill_bytes, src, 'skill-bytes')} bytes long and its placebo ${fig(r.placebo.bytes, src, 'placebo-bytes')}, about a byte per letter. Each text's first sentence (the skill's header lines are left out):</p>`,
    `<div class="how-pair"><div><p class="how-label">The skill</p>${quote(ex.skillOpening)}</div><div><p class="how-label">The placebo</p>${quote(ex.placeboOpening)}</div></div>`,
    `<p><a href="https://github.com/${esc(q.repository)}/blob/${esc(q.commit)}/${esc(q.skill_path)}">Read the whole skill</a>, at the version tested. The whole placebo text is not shown on this page.</p>`,
  ].join('\n'));
  const answer = (w) => `<article class="how-answer" data-arm="${w.mode}">
<h3>${esc(WAY[w.mode])}</h3>
<p class="how-meta">Its opening, of ${fig(w.length, ex.answersRel)} characters:</p>
<div class="how-excerpt" data-excerpt data-quote="text" data-raw="${esc(w.excerpt)}">${plainMarkdown(w.excerpt)}</div>
<p>The judge scored it ${fig(w.draw.samples.length, src)} times: ${w.draw.samples.map((s) => fig(s, src)).join(', ')}; average ${fig(w.draw.mean, src)}.</p>
<p>One of its reasons: ${quote(w.reason, 'q')}</p>
</article>`;
  const three = step(3, 'A judge model scores each answer', [
    `<p data-term="judge">The judge is an AI model, here ${esc(judge)}, that scores each answer against a guide written for the task.</p>`,
    '<p>In your own plugin runs the same model answers and grades by default, and Driftproof prints a warning.</p>',
    '<p data-term="score">A score runs from 0, no point of the guide met, to 1, every point met.</p>',
    `<p>The answers came from ${esc(model)}. The judge gets the task, one answer and the guide, and is not told which way the answer was made; an answer can still show which way it was made.</p>`,
    `<p>This task's guide gives ${fig(ex.guide.weight, ex.suiteRel)} for each point met:</p>`,
    `<ol class="how-guide" data-guide data-quote="text">${ex.guide.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`,
    '<p>The first answer each way, shown as plain text:</p>',
    `<div class="how-answers">\n${ex.ways.map(answer).join('\n')}\n</div>`,
  ].join('\n'));
  const p = ex.plain, drawsOf = (m) => fig(ex.ways.find((w) => w.mode === m).draws, src, 'draws-' + m);
  const own = p.state !== 'PASSED' && KEY[p.state] ? `<p><strong>${esc(p.label)}</strong> means: ${lib(KEY[p.state])}</p>` : '';
  // The deciding tasks with their own figures (review fix 1, M1): the library's why line gives the
  // overall averages, which can sit closer than the floor; the task that decided it is read here.
  const decided = (which, against, other, otherWords) => {
    const ids = ex.deciding[which];
    if (!ids.length) return '';
    const figures = ids.map((id) => {
      const t = ex.tasks.find((x) => x.id === id);
      return `${ids.length > 1 ? `${esc(id)}, ` : ''}${fig(t.skill.mean, src, null, n3(t.skill.mean))} with the skill, ${fig(t[other].mean, src, null, n3(t[other].mean))} ${otherWords}`;
    }).join('; ');
    return `<p data-deciding="${which}" data-tasks="${esc(ids.join(' '))}">Against ${against}, the ${esc(joinAnd(ids))} task${ids.length > 1 ? 's' : ''} decided it: ${figures}.</p>`;
  };
  const taskLine = (t) => `<li data-task="${esc(t.id)}"><strong>${esc(t.id)}</strong>: ${fig(t.skill.mean, src, null, n3(t.skill.mean))}. No skill text, ${fig(t.none.mean, src, null, n3(t.none.mean))}: ${esc(STATE_WORDS[t.none_state])}. Placebo, ${fig(t.placebo.mean, src, null, n3(t.placebo.mean))}: ${esc(STATE_WORDS[t.placebo_state])}.</li>`;
  const four = step(4, 'Repeat, then read the case rule', [
    `<p data-term="draw">Each way answers the task at least ${fig(SAMPLING.min, 'config.js', 'sampling-min')} times and at most ${fig(SAMPLING.max, 'config.js', 'sampling-max')}, stopping once the scores settle, and each answer is called a draw.</p>`,
    `<p>On this task there were ${drawsOf('with_skill')} draws with the skill, ${drawsOf('placebo')} with the placebo and ${drawsOf('baseline')} with no skill text, and the judge scored each draw ${fig(r.run.judge.samples, src, 'judge-samples')} times.</p>`,
    '<p data-term="spread">The spread is how much the scores of repeated draws differ.</p>',
    `<p data-term="case-rule effect-floor">The case rule reads each case, meaning each task, on its own, and the effect floor, ${fig(EFFECT_FLOOR, 'config.js', 'effect-floor')}, is the smallest gap it counts.</p>`,
    `<p><strong>${esc(LABELS.PASSED)}</strong> means: ${lib(KEY.PASSED)}</p>`,
    own,
    // receiptVerdict's ladder reads a task separated downward before any other rung.
    `<p>If any task is ${esc(STATE_WORDS['separated-down'])}, the reading is ${esc(LABELS.REGRESSED)}, whatever the others show.</p>`,
    `<p><strong>Above the placebo</strong> means: ${lib(PLACEBO_WORDS.ABOVE_PLACEBO)}.</p>`,
    `<p><strong>Below the placebo</strong> means: the same case rule, measured against the placebo instead of no skill text: a task ${esc(STATE_WORDS['separated-down'])}.</p>`,
    `<div class="how-reading" data-reading>`,
    `<p class="how-label">What the ${skill} skill read</p>`,
    `<p>Against no skill text added: ${lib(p.label, 'strong')}. ${lib(p.sentence)} ${lib(p.why)}</p>`,
    `<p>Against the placebo: ${lib(ex.placeboLine)}.</p>`,
    decided('verdict', 'no skill text added', 'none', 'without'),
    decided('placebo', 'the placebo', 'placebo', 'with the placebo'),
    "<p>Task by task, the skill's average first:</p>",
    `<ul class="how-tasks">${ex.tasks.map(taskLine).join('')}</ul>`,
    '</div>',
    `<p class="how-scope" data-scope>Scope: ${count} tasks, written by Driftproof; answers in text only, with tools forbidden; ${esc(model)} answering, ${esc(judge)} judging; ${date}.</p>`,
  ].filter(Boolean).join('\n'));
  const five = step(5, 'What a result does not tell you', [
    '<ul class="how-limits">',
    `<li>It covers only these ${count} tasks, ${esc(model)} answering and ${esc(judge)} judging, on ${esc(fmtDate(r.run.date_utc))}.</li>`,
    `<li><strong>${esc(LABELS.UNDERPOWERED)}</strong>, which the case rule writes as ${lib(UNDERPOWERED_LINE, 'q')}, means ${lib(KEY.UNDERPOWERED)}</li>`,
    '<li>Beating the placebo does not mean beating no skill text.</li>',
    '<li>A placebo text can still bear on a task by chance.</li>',
    '<li>The judge is an AI reading a guide, not a person.</li>',
    '<li>A reading under the rule is not proof.</li>',
    '</ul>',
    '<p data-term="receipt">Each reading comes from a receipt, a sealed record whose fingerprint stops matching if any figure in it changes.</p>',
    `<p>Check it: <a href="/r/${esc(r.receipt_hash)}/">the receipt's page</a>, <a href="https://github.com/driftproofhq/driftproof/blob/main/${esc(src)}">its file</a>, <a href="https://github.com/driftproofhq/driftproof/blob/main/${esc(ex.answersRel)}">the kept answers</a>, <a href="/${esc(ex.suiteRel.slice('docs/'.length))}">the tasks and guides</a>, and <a href="/reports/017/">Report 017</a>.</p>`,
  ].join('\n'));
  return [one, two, three, four, five].join('\n');
}

// The page (spec 640): the shell of scripts/build-site-pages.js around the five screens.
function page(shell) {
  const ex = exampleOf();
  const headTags = require('./build-head-tags.js');
  const beacon = !!headTags.beaconFor(headTags.siteConfig().cloudflare_analytics_token);
  const nodeMajor = /\d+/.exec(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.node)[0];
  const main = `<main class="how-page">
<h1>${esc(H1)}</h1>
<p class="lede">${esc(LEDE)}</p>
<div class="how-steps" data-island="how-it-works" data-attempt="${ex.row.attempt_id}">
${stepsHTML(ex)}
</div>
<p class="how-why">Why this skill: it is the shortest skill counted in Report 017 that does more than hand the work to another skill. It was chosen by its length, not by its results.</p>
${beacon ? '<p class="muted">Like every page on this site, this one counts a visit with Cloudflare Web Analytics. Moving between the screens makes no further request.</p>\n' : ''}<p>Before testing your own text, add <code>--preview</code> to <code>driftproof run</code> to see what it would send and keep, where it would send it, and its estimated calls and cost, without calling a model or writing run files.</p>
<p>To save your own tests for later, use <code>driftproof recheck init</code>, then <code>recheck run</code> and <code>recheck history</code>. Start today, run again later; it cannot compare with last month unless you saved then. A difference between dates says something changed, not what: the model, Claude Code, the grader, Driftproof itself, or chance.</p>
<section aria-labelledby="compare-versions">
<h2 id="compare-versions">Did your edit help?</h2>
<p>Run <code>driftproof compare before.md after.md --suite tasks.json</code> to test two versions on the same tasks. It saves two records and a plain reading in <code>receipts/compare.md</code>. Use <code>--placebo</code> to add a length control, or <code>--out DIR</code> to choose another folder.</p>
<p>The reading shows each file's length and fingerprint. The runs are sequential. A difference on these tasks is not proof, and no clear difference is not proof the versions are the same.</p>
<p>In Claude Code, <code>/driftproof:compare CLAUDE.md --suite tasks.json</code> compares your edited file with its last commit on the same tasks.</p>
</section>
<section aria-labelledby="what-you-need">
<h2 id="what-you-need">What you need</h2>
<p>You need Claude Code, <code>Node.js ${nodeMajor}</code> or newer, and your project in a git repository. You do not need an API key: runs use your Claude Code plan's usage. In Claude Code, compare and recheck need a git repository, and compare takes a <code>CLAUDE.md</code> or <code>AGENTS.md</code>. <a href="/#quickstart">Install in Claude Code</a>.</p>
</section>
</main>`;
  assertPageText(main);
  return shell({ title: TITLE, description: LEDE, main, head: '<link rel="stylesheet" href="/how-it-works/style.css">\n' });
}

module.exports = { REL, TITLE, H1, SKILLS, STATE_WORDS, isHandoff, pickOf, excerptOf, firstSentence, plainMarkdown, textOf, assertPageText, exampleOf, page };
