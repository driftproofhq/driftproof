#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {"href":"/sugar-pill/","label":"Skill or sugar pill?"}
// scripts/sugar-pill-page.js: /sugar-pill/, pick what you want help with and see what each skill did
// (spec 688).
//
// One card per skill Reports 017 and 018 measured, under a plain-word group chosen from what the
// skill's own description says it does. Each card shows, per model, the three ways side by side (the
// skill, the same-length fake, nothing), read from that skill's sealed receipt through the two
// reports' own readers (scripts/prepare-report-017.js and prepare-report-018.js readCampaign), with
// the receipt reader's words for the reading against the fake and against nothing (lib/plain.js,
// lib/verdict.js, spec 669's plain words), the caveats the report carries (docs/data/
// report-summaries.json), the report and the receipt. Nothing is counted, combined, averaged or
// ranked: skills are alphabetical within a group, and every numeral on the page sits in a data
// element naming the receipt it came from. scripts/build-site-pages.js wraps the <main> this writes
// in the site's shell; the island (docs/islands/sugar-pill.js) only filters what is already here.
//   node scripts/sugar-pill-page.js            write docs/sugar-pill/index.html
//   node scripts/sugar-pill-page.js --check    exit 1 if it differs from a fresh render
//   ... [--docs DIR]                           read or write DIR/sugar-pill/index.html
const fs = require('node:fs');
const path = require('node:path');
const P17 = require('./prepare-report-017.js');
const P18 = require('./prepare-report-018.js');
const skillHandoff = require('./skill-handoff.js');
const { plainOf, LABELS, KEY } = require('../lib/plain');
const { placeboReading, placeboLine, receiptVerdict, armOf, CASES_LINE } = require('../lib/verdict');
const { repositoryJudgeRelationship } = require('../lib/receipt');
const policy = require('../lib/report-015-publication');
const { sha256 } = require('../lib/canonical');
const { humanModelName } = require('./model-names');
const { annotateCampaignFigures } = require('./prepare-report-015');
const { htmlToText } = require('./html-text.js');

const ROOT = path.join(__dirname, '..');
const REL = 'sugar-pill/index.html';
const HREF = '/sugar-pill/';
// The twenty pinned SKILL.md texts, by Report 017 attempt id (spec 640 Terms). Not published; only
// each text's description reaches the page.
const SKILLS = path.join(ROOT, 'specs', '640-how-it-works', 'skills');
const SUMMARIES = 'docs/data/report-summaries.json';
const BLIND = 'reports/017/blind/index.html';
const PLACEBO_PAGE = 'placebo/index.html';
const HOW = 'how-it-works/index.html';
// The plain words for each placebo token, spec 669's (A-669-3).
const PLAIN = P18.PLAIN;
// The page's one plain sentence for each reading against the fake (A-688-1), said for a reader who
// does not read a rule; the reader's own token and line stay on the card in data attributes. The
// UNDERPOWERED reading has two, told apart by the reader's line naming the cases (CASES_LINE).
const FAKE_SENTENCE = {
  ABOVE_PLACEBO: 'On at least one task it scored above the fake, and on none below.',
  BELOW_PLACEBO: 'On at least one task it scored below the fake.',
  NO_DIFFERENCE: 'On no task did it score clearly above or below the fake, with enough answers to have seen a gap.',
  INCONCLUSIVE: 'Some answers were lost, so the comparison with the fake shows no direction.',
  UNDERPOWERED: 'There were too few answers, or they varied too much, to tell it from the fake.',
  UNDERPOWERED_CASES: 'The tasks scored too far apart from each other to tell it from the fake, and more answers are not expected to change that.',
  NOT_MEASURED: 'This run did not measure it against the fake.',
};
const fakeSentenceOf = (token, line) => FAKE_SENTENCE[token === 'UNDERPOWERED' && line.includes(CASES_LINE) ? 'UNDERPOWERED_CASES' : token];
// The sentence against nothing, shown after its label once: where it opens with the label and a
// colon, that clause comes off and the rest is shown, its first letter raised (A-688-1).
const shownSentence = (label, sentence) => (sentence.startsWith(`${label}:`) ? sentence.slice(label.length + 1).trim().replace(/^[a-z]/, (c) => c.toUpperCase()) : sentence);
const MODES = ['with_skill', 'placebo', 'baseline'];
const WAY = { with_skill: 'With the skill', placebo: 'With the fake', baseline: 'With nothing' };
const FINDING = 'What we found.';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function need(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
const n3 = (x) => Number(x).toFixed(3);
const fmtDate = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(d));
const cmpName = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());

// ── the page's own words (spec 688 § Terms, AC-3, AC-4, AC-11) ───────────────────────────────────
const TEXT = {
  h1: 'Skill or sugar pill?',
  title: 'Skill or sugar pill? Pick a skill, see what it did | Driftproof',
  // The first paragraph, which is also the page's description (scripts/build-head-tags.js).
  lede: '{skills} popular skills, each tested with the skill, with a same-length fake text and with nothing. Pick what you want help with and see what each did.',
  how: 'A skill is a short instruction file that tells an AI coding assistant how you want a job done. For each skill here, Driftproof gave a model {tasks} text tasks, and each task three ways: with the skill, with a fake text of exactly the same length made of unrelated sentences, and with nothing added. A judge model scored every answer. The fake is the sugar pill: it is there to show whether the skill\'s own words did something that any text of that length would not.',
  grouping: 'The groups below are a way in, not a finding: each skill sits under what its own description says it does, and skills are listed alphabetically within a group.',
  question: 'What do you want help with?',
  keyTitle: 'What the words mean',
  keyFake: 'Against the fake, each word stands for one reading of the receipt reader:',
  keyNone: 'Against nothing, the words are the receipt reader\'s too:',
  routerNote: ' (a router, left out of the headline count)',
  against: { fake: 'Against the fake:', none: 'Against nothing:' },
  caption: 'Each task\'s average score, three ways, from zero (nothing in the guide met) to one (everything met), with its spread. The bars draw the averages.',
  recorded: 'recorded',
  readReport: (n) => `Read Report ${n}`,
  receipt: 'See the receipt',
  blind: 'Can you tell which answer had the skill? Try a blind read',
  aboutTitle: 'Where this comes from',
  about: 'Every reading on this page is read from a sealed receipt by the same code that wrote the two reports, and every figure names the receipt it came from. Nothing here is combined, averaged across skills or put in order of result, and this page adds no verdict of its own: a skill that beat the fake on one model is not shown to help on another, and beating the fake is not beating no skill.',
  howLink: 'How Driftproof tests a skill, step by step',
  placeboLink: 'See the fake that would stand in for your own file',
  open: 'Show what it did',
};

// ── the groups: navigation, not a finding ────────────────────────────────────────────────────────
// Each measured skill is placed once, by what its own description says it does. The builder refuses
// a group that names a skill no report measured, a measured skill in no group, or one in two.
const GROUPS = [
  { id: 'group-planning', label: 'Thinking a plan through', skills: ['grill-me', 'grill-with-docs', 'grilling'] },
  { id: 'group-code', label: 'Writing and improving code', skills: ['tdd', 'improve-codebase-architecture'] },
  { id: 'group-work', label: 'Organising work and handing it over', skills: ['triage', 'setup-matt-pocock-skills', 'handoff'] },
  { id: 'group-design', label: 'Design and front-end', skills: ['frontend-design', 'design-mobile-apps', 'prototype'] },
  { id: 'group-video', label: 'Video, motion and media', skills: ['hyperframes', 'hyperframes-cli', 'hyperframes-core', 'hyperframes-animation', 'hyperframes-registry', 'media-use'] },
  { id: 'group-browse', label: 'Browsing the web and automating sites', skills: ['agent-browser', 'reddit-automation'] },
  { id: 'group-find', label: 'Finding skills', skills: ['find-skills'] },
];

// ── the skill's own description, from its pinned text ────────────────────────────────────────────
// The front matter's description, read whole: a one-line value, a quoted one, or a folded or literal
// block (">" or "|") whose indented lines are joined by spaces. Null when the text has none.
function descriptionOf(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return null;
  let v = lines[i].replace(/^description:\s*/, '');
  if (/^[>|]/.test(v)) {
    const out = [];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) out.push(lines[j].trim());
    v = out.join(' ');
  } else if (/^"[\s\S]*"\s*$/.test(v) || /^'[\s\S]*'\s*$/.test(v)) v = v.trim().slice(1, -1);
  return v.replace(/\s+/g, ' ').trim();
}

// ── the measurements: every row with a receipt, through the reports' own readers ─────────────────
// Each reader checks its receipts' seals and schemas, rebuilds their scores from the kept judge
// outputs, and binds the placebo line and the router flag to the libraries. The row's words here are
// read again from the receipt it names, so a word that is not the library's refuses (READING_BINDING).
let cachedCampaigns = null;
function campaigns() {
  if (cachedCampaigns) return cachedCampaigns;
  cachedCampaigns = {
    '017': P17.readCampaign({ campaignRoot: path.join(ROOT, P17.CAMPAIGN), handoff: [...skillHandoff.ATTEMPTS] }),
    '018': P18.readCampaign({ campaignRoot: path.join(ROOT, P18.CAMPAIGN) }),
  };
  return cachedCampaigns;
}
function measurementOf(report, row) {
  const r = row.receipt, pr = placeboReading(r), v = receiptVerdict(r), plain = plainOf(r);
  need(placeboLine(pr) === row.reading.placebo_line && pr.reading === row.reading.placebo && v.verdict === row.reading.verdict, 'READING_BINDING');
  need(!!policy.routerLimit(r) === row.router, 'ROUTER_RECEIPT_BINDING');
  const arm = (id, mode) => armOf(r.results.cases.find((c) => c.id === id && c.mode === mode));
  const tasks = v.cases.map((c) => ({ id: c.id, with_skill: arm(c.id, 'with_skill'), placebo: arm(c.id, 'placebo'), baseline: arm(c.id, 'baseline') }));
  need(tasks.length > 0, 'READING_BINDING');
  return {
    report, row, receipt: r, src: row.src, hash: r.receipt_hash, skill: row.skill, repository: row.repository,
    model: r.run.model_id, judge: r.run.judge.model_id, date: r.run.date_utc, router: row.router, handoffNote: row.handoffNote || null,
    placebo: pr.reading, line: row.reading.placebo_line, verdict: v.verdict, plain, tasks,
    textId: report === '017' ? row.attempt_id : row.panel_id, pin: row.attempt.protocol.skill_sha256,
  };
}
function measurements() {
  const c = campaigns();
  return Object.keys(c).flatMap((n) => c[n].rows.filter((r) => r.receipt).map((r) => measurementOf(n, r)));
}

// The skills: each measured skill once, with its description from the pinned text named by its
// Report 017 attempt id, refused unless the text's sha256 is every report's pin for it (SKILL_TEXT).
function skillsOf({ skillsDir = SKILLS } = {}) {
  const by = new Map();
  for (const m of measurements()) {
    const k = `${m.repository}/${m.skill}`;
    if (!by.has(k)) by.set(k, { name: m.skill, repository: m.repository, textId: null, measurements: [] });
    const s = by.get(k);
    s.measurements.push(m);
    if (m.report === '017') s.textId = m.textId;
  }
  const skills = [...by.values()].sort((a, b) => cmpName(a.name, b.name));
  for (const s of skills) {
    need(s.textId, 'SKILL_TEXT');
    const file = path.join(skillsDir, `${s.textId}.md`);
    need(fs.existsSync(file), 'SKILL_TEXT');
    const bytes = fs.readFileSync(file);
    need(s.measurements.every((m) => m.textId === s.textId && sha256(bytes) === m.pin), 'SKILL_TEXT');
    s.description = descriptionOf(bytes.toString('utf8'));
    need(s.description, 'SKILL_TEXT');
    s.measurements.sort((a, b) => a.report.localeCompare(b.report));
  }
  return skills;
}

// The groups over the skills: every skill in exactly one, every named skill measured, alphabetical
// within each (GROUP_COVERAGE otherwise).
function groupSkills(skills, groups = GROUPS) {
  const names = new Map(skills.map((s) => [s.name, s]));
  const placed = new Map();
  const out = groups.map((g) => {
    const members = g.skills.map((n) => {
      need(names.has(n) && !placed.has(n), 'GROUP_COVERAGE');
      placed.set(n, g.id);
      return names.get(n);
    });
    return { ...g, members: members.sort((a, b) => cmpName(a.name, b.name)) };
  });
  need(skills.every((s) => placed.has(s.name)), 'GROUP_COVERAGE');
  return out;
}

// The caveats a report carries: its summary row's points but the finding (CAVEAT_BINDING).
function caveatsOf(report, root = ROOT) {
  const row = JSON.parse(fs.readFileSync(path.join(root, SUMMARIES), 'utf8')).reports[report];
  need(row && Array.isArray(row.points), 'CAVEAT_BINDING');
  const points = row.points.filter((p) => p.lead !== FINDING);
  const leads = points.map((p) => p.lead);
  need(leads.includes('Beating the fake is not beating no skill.') && leads.includes('What it does not show.') && leads.includes('What we tested.'), 'CAVEAT_BINDING');
  if (report === '018') {
    const lim = points.find((p) => p.lead === 'The judge is the target\'s model.');
    need(lim && lim.text === repositoryJudgeRelationship('claude-haiku-5-5', 'claude-haiku-5-5').limitation, 'CAVEAT_BINDING');
  }
  return points;
}

// The blind read's skill (spec 638's rule), when its page is in the tree.
function blindSkill(root = ROOT) {
  if (!fs.existsSync(path.join(root, 'docs', BLIND))) return null;
  return require('./build-report-017-blind.js').skillOf(campaigns()['017'].rows, path.join(ROOT, P17.PANEL)).row.skill;
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────
// A recorded figure, in a data element naming the receipt it was read from (AC-1, AC-3).
const fig = (v, src) => `<data value="${esc(v)}" data-src="${esc(src)}" data-at="recorded evidence" data-fn="receipt readers" data-dp="exact">${esc(n3(v))}</data>`;
const lib = (s, tag = 'span', attrs = '') => `<${tag} data-quote="library"${attrs}>${esc(s)}</${tag}>`;
// A report's own sentence with its figures in data elements naming the page they are read from: a
// date or a decimal, never a number that is part of a name ("Report 015's", "Sonnet 5.5" stays as
// the name reads), so the sentence's words are untouched.
const annotateSentence = (escaped, src) => escaped.replace(/(^|[\s(])(\d{4}-\d{2}-\d{2}|\d+\.\d+)(?=[\s.,;:)]|$)/g, (m, before, n) => `${before}<data value="${n}" data-src="${esc(src)}" data-at="recorded evidence" data-fn="receipt readers" data-dp="exact">${n}</data>`);
const endStop = (s) => (/[.!?]$/.test(s) ? '' : '.');
// Typography for a quoted text (A-688-2): a literal "..." is set as the ellipsis character. The words
// are unchanged; spec 020 AC-42 reads three full stops in a row as a doubled full stop.
const typography = (s) => String(s).replace(/\.{3}/g, '…');

function cellHTML(mode, a, src) {
  if (!a) return `<td data-arm="${mode}" data-way="${WAY[mode]}">no band</td>`;
  const pct = (x) => Math.max(0, Math.min(100, x * 100));
  const w = pct(a.mean), lo = pct(a.mean - a.sd), hi = pct(a.mean + a.sd);
  const bar = `<svg class="pill-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><title>${esc(`${n3(a.mean)} plus or minus ${n3(a.sd)}`)}</title><rect class="pill-bar-fill pill-arm-${mode.replace('_', '-')}" x="0" y="2" width="${w.toFixed(1)}" height="6"/><rect class="pill-bar-spread" x="${lo.toFixed(1)}" y="4.5" width="${(hi - lo).toFixed(1)}" height="1"/></svg>`;
  return `<td data-arm="${mode}" data-way="${WAY[mode]}"><span class="pill-figure">${fig(a.mean, src)}<small class="pill-spread">±${fig(a.sd, src)}</small></span>${bar}</td>`;
}
function waysHTML(m) {
  const head = `<thead><tr><th scope="col">Task</th>${MODES.map((mode) => `<th scope="col">${WAY[mode]}</th>`).join('')}</tr></thead>`;
  // A task id is text someone else wrote: quoted, as the descriptions are.
  const body = m.tasks.map((t) => `<tr data-task="${esc(t.id)}"><th scope="row" data-quote="text">${esc(t.id)}</th>${MODES.map((mode) => cellHTML(mode, t[mode], m.src)).join('')}</tr>`).join('');
  return `<table class="pill-ways"><caption>${esc(TEXT.caption)}</caption>${head}<tbody>${body}</tbody></table>`;
}
function measureHTML(m, caveats, blind) {
  need(Object.hasOwn(PLAIN, m.placebo), 'READING_UNKNOWN');
  need(fs.existsSync(path.join(ROOT, 'docs', 'r', m.hash, 'index.html')), 'RECEIPT_PAGE');
  need(fs.existsSync(path.join(ROOT, 'docs', 'reports', m.report, 'index.html')), 'REPORT_PAGE');
  const model = humanModelName(m.model);
  const when = `<p class="pill-when">Report ${esc(m.report)}, ${TEXT.recorded} <time datetime="${esc(m.date.slice(0, 10))}">${esc(fmtDate(m.date))}</time>.</p>`;
  const sentence = fakeSentenceOf(m.placebo, m.line);
  need(sentence, 'READING_UNKNOWN');
  const fake = `<p class="pill-reading pill-fake" data-reading="${esc(m.placebo)}" data-line="${esc(m.line)}"><span class="pill-label">${TEXT.against.fake}</span> <strong>${esc(PLAIN[m.placebo])}</strong>${m.router ? esc(TEXT.routerNote) : ''}. <span class="pill-line">${esc(sentence)}</span></p>`;
  const none = m.router
    ? `<p class="pill-reading pill-none"><span class="pill-label">${TEXT.against.none}</span> <strong><a href="/r/${m.hash}/">${esc(policy.LABEL)}</a></strong>. ${esc(policy.REASON)} <a href="${policy.AMENDMENT}">Report 015 Amendment 1</a>.</p>`
    : `<p class="pill-reading pill-none" data-verdict="${esc(m.verdict)}" data-sentence="${esc(m.plain.sentence)}"><span class="pill-label">${TEXT.against.none}</span> ${lib(m.plain.label, 'strong')}. ${annotateCampaignFigures(lib(shownSentence(m.plain.label, m.plain.sentence)), m.src)}</p>`;
  const handoff = m.handoffNote ? `<p class="pill-handoff">${lib(m.handoffNote)}</p>` : '';
  // The report's own words, quoted as the library's lines are.
  const list = `<ul class="pill-caveats">${caveats.map((p) => `<li data-lead="${esc(p.lead)}"><strong>${esc(p.lead)}</strong> <span data-quote="library">${annotateSentence(esc(p.text), `docs/reports/${m.report}/index.html`)}</span></li>`).join('')}</ul>`;
  const links = `<p class="pill-links"><a href="/reports/${esc(m.report)}/">${esc(TEXT.readReport(m.report))}</a> · <a href="/r/${esc(m.hash)}/">${esc(TEXT.receipt)}</a>${blind === m.skill && m.report === '017' ? ` · <a class="pill-blind" href="/${BLIND.replace(/index\.html$/, '')}">${esc(TEXT.blind)}</a>` : ''}</p>`;
  return `<section class="pill-measure" data-report="${esc(m.report)}" data-receipt="${esc(m.hash)}" data-model="${esc(m.model)}" data-router="${m.router}">
<h3>On ${esc(model)}</h3>
${when}
${waysHTML(m)}
${fake}
${none}
${handoff}${list}
${links}
</section>`;
}
function cardHTML(skill, caveats, blind) {
  const summary = `<summary><span class="pill-name">${esc(skill.name)}</span><span class="pill-repo">${esc(skill.repository)}</span><span class="pill-desc" data-quote="text">${esc(typography(skill.description))}</span><span class="pill-open" aria-hidden="true">${esc(TEXT.open)}</span></summary>`;
  const models = skill.measurements.map((m) => measureHTML(m, caveats[m.report], blind)).join('\n');
  return `<li><details class="pill-card card" id="skill-${esc(skill.name)}" data-skill="${esc(skill.name)}" data-repository="${esc(skill.repository)}">${summary}<div class="pill-body"><p><a href="/tasks/${esc(skill.repository)}/${esc(skill.name)}/">Read and try the exact tasks</a></p><div class="pill-models">
${models}
</div></div></details></li>`;
}
// The key: one entry per word the page shows, each the library's own line for it.
function keyHTML(all) {
  const fakeTokens = [...new Set(all.map((m) => m.placebo))].sort((a, b) => Object.keys(PLAIN).indexOf(a) - Object.keys(PLAIN).indexOf(b));
  const fake = fakeTokens.map((tok) => {
    const sentences = [...new Set(all.filter((m) => m.placebo === tok).map((m) => fakeSentenceOf(m.placebo, m.line)))];
    return `<dt><strong>${esc(PLAIN[tok])}</strong></dt><dd>${sentences.map(esc).join('<br>')}</dd>`;
  }).join('');
  const words = [...new Set(all.filter((m) => !m.router).map((m) => m.plain.words || m.plain.state))].filter((w) => LABELS[w] && KEY[w]);
  const none = words.map((w) => `<dt>${lib(LABELS[w], 'strong')}</dt><dd>${annotateCampaignFigures(lib(KEY[w]), 'config.js')}</dd>`).join('')
    // Issue 711: spec 435 reads the router label only in a block that also gives its reason and the amendment link.
    + (all.some((m) => m.router) ? `<dt><strong>No verdict, for a router</strong></dt><dd>The receipt reads ${esc(policy.LABEL)}. ${esc(policy.REASON)} <a href="${policy.AMENDMENT}">Report 015 Amendment 1</a>.</dd>` : '');
  return `<details class="pill-key"><summary>${esc(TEXT.keyTitle)}</summary>
<p>${esc(TEXT.keyFake)}</p>
<dl>${fake}</dl>
<p>${esc(TEXT.keyNone)}</p>
<dl>${none}</dl>
</details>`;
}
function aboutHTML(all, root) {
  const reports = [...new Set(all.map((m) => m.report))].sort().map((n) => {
    const ms = all.filter((m) => m.report === n);
    const models = [...new Set(ms.map((m) => humanModelName(m.model)))].join(', '), judges = [...new Set(ms.map((m) => humanModelName(m.judge)))].join(', ');
    return `<a href="/reports/${esc(n)}/">Report ${esc(n)}</a> (${esc(models)}, judged by ${esc(judges)})`;
  });
  const more = [
    fs.existsSync(path.join(root, 'docs', HOW)) ? `<a href="/${HOW.replace(/index\.html$/, '')}">${esc(TEXT.howLink)}</a>.` : '',
    fs.existsSync(path.join(root, 'docs', PLACEBO_PAGE)) ? `<a href="/${PLACEBO_PAGE.replace(/index\.html$/, '')}">${esc(TEXT.placeboLink)}</a>.` : '',
  ].filter(Boolean).join(' ');
  return `<section class="pill-about"><h2>${esc(TEXT.aboutTitle)}</h2>
<p>The two reports are ${reports.join(' and ')}. ${esc(TEXT.about)}</p>
${more ? `<p>${more}</p>\n` : ''}</section>`;
}

// ── the page's own checks (AC-3, AC-11) ──────────────────────────────────────────────────────────
const decode = (s) => s.replace(/&(lt|gt|quot|#39|amp);/g, (m, k) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[k]);
const textOf = (h) => htmlToText(h, { skip: ['script', 'style'], skipText: ' ', tagText: ' ', commentText: ' ', decode, collapse: true }).replace(/\s+([.,;:!?])/g, '$1').trim();
// A quoted element is replaced by a placeholder word, so the punctuation around it stays where it was.
const without = (h, kind) => h.replace(/<(\w+)\b[^>]*\bdata-quote="([a-z]+)"[^>]*>[\s\S]*?<\/\1>/g, (m, tag, k) => (k === kind ? ' quoted ' : m));
// Every numeral outside a data element, a time element, a bar's own drawing, a token, a quoted
// description, a human model name, a report number or the amendment's number is a typed figure.
function typedFigures(main, modelIds) {
  let h = main.replace(/<data\b[^>]*>[\s\S]*?<\/data>/g, ' ').replace(/<time\b[^>]*>[\s\S]*?<\/time>/g, ' ').replace(/<svg\b[\s\S]*?<\/svg>/g, ' ').replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, ' ');
  h = without(h, 'text');
  let t = textOf(h);
  for (const id of modelIds) t = t.split(humanModelName(id)).join(' ');
  t = t.replace(/\bReport 0\d\d\b/g, ' ').replace(/\bAmendment 1\b/g, ' ');
  return [...t.matchAll(/\S*\d\S*/g)].map((x) => x[0]);
}
const FORBIDDEN = [/\bconfidence[ -]bands?\b/i, /\bwithin[ -](?:the\s+)?(?:judge['’]s\s+)?noise\b/i, /\bmeasure the same\b/i, /\bsignificant/i, /\bstatistically\b/i, /\bproves?\b/i, /\bconfidence\b/i, /\bby more than chance\b/i, /\bbest skill\b/i, /\bthe best\b/i, /\branke?d?\b/i, /\branking\b/i, /\bwinner\b/i, /\bleaderboard\b/i];
function assertPage(main, all) {
  const typed = typedFigures(main, new Set(all.map((m) => m.model)));
  if (typed.length) throw Object.assign(new Error(`NO_TYPED_FIGURE: ${typed.slice(0, 5).join(', ')}`), { code: 'NO_TYPED_FIGURE' });
  // Spec 020 AC-42's reading, over the whole visible text, quotes included (A-688-2): a quoted text
  // that carries a doubled full stop or a spaced hyphen refuses the page rather than shipping it red.
  const whole = textOf(main.replace(/<svg\b[\s\S]*?<\/svg>/g, ' '));
  const bad = /.{0,40}(?:\.\.| - ).{0,40}/.exec(whole);
  if (bad) throw Object.assign(new Error(`PAGE_TEXT: ${bad[0]}`), { code: 'PAGE_TEXT' });
  const own = textOf(without(without(main.replace(/<svg\b[\s\S]*?<\/svg>/g, ' '), 'text'), 'library'));
  const word = FORBIDDEN.find((re) => re.test(own));
  if (word) throw Object.assign(new Error(`PAGE_WORDS: ${word} in "${new RegExp(`.{0,40}${word.source}.{0,40}`, 'i').exec(own)[0]}"`), { code: 'PAGE_WORDS' });
  need(TEXT.lede.length >= 50 && TEXT.lede.length <= 155, 'DESCRIPTION');
  return main;
}

// Counts are derived from the same skill and task sets the cards display.
function introOf(skills) {
  const word = n => ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'][n] || String(n);
  const counts = [...new Set(skills.flatMap(s => s.measurements.map(m => m.tasks.length)))];
  need(counts.length === 1, 'TASK_COUNTS');
  const count = word(skills.length);
  return { lede: TEXT.lede.replace('{skills}', count[0].toUpperCase()+count.slice(1)), how: TEXT.how.replace('{tasks}', word(counts[0])) };
}

// ── the <main> ───────────────────────────────────────────────────────────────────────────────────
function pageMain({ skillsDir, root = ROOT } = {}) {
  const skills = skillsOf({ skillsDir });
  const all = skills.flatMap((s) => s.measurements);
  const groups = groupSkills(skills);
  const intro = introOf(skills);
  const caveats = Object.fromEntries([...new Set(all.map((m) => m.report))].map((n) => [n, caveatsOf(n, root)]));
  const blind = blindSkill(root);
  const chips = `<nav class="pill-chips" aria-label="${esc(TEXT.question)}">${groups.map((g) => `<a href="#${esc(g.id)}">${esc(g.label)}</a>`).join('\n')}</nav>`;
  const sections = groups.map((g) => `<section class="pill-group" id="${esc(g.id)}"><h2>${esc(g.label)}</h2>
<ul class="pill-skills">
${g.members.map((s) => cardHTML(s, caveats, blind)).join('\n')}
</ul>
</section>`).join('\n');
  const main = `<main class="pill-page">
<h1>${esc(TEXT.h1)}</h1>
<p class="lede">${esc(intro.lede)}</p>
<p class="pill-how">${esc(intro.how)}</p>
${keyHTML(all)}
<div class="pill-picker" data-island="sugar-pill">
<p class="pill-grouping" data-grouping-note>${esc(TEXT.grouping)}</p>
${chips}
${sections}
</div>
${aboutHTML(all, root)}
</main>`;
  return assertPage(main, all);
}

// The page (spec 688): scripts/build-site-pages.js's shell around the main.
function page(shell) {
  return shell({ title: TEXT.title, description: introOf(skillsOf()).lede, main: pageMain(), head: '<link rel="stylesheet" href="/sugar-pill/style.css">\n' });
}

// THE PAGE AS PUBLISHED: build-site-pages.js's shell around pageMain, with the head builder's tags, so
// this file's own write and check produce the bytes the site builder does.
function renderPage() {
  const { TARGETS } = require('./build-site-pages.js');
  return require('./build-head-tags.js').render(TARGETS[REL](), REL);
}
function main(argv) {
  let check = false, docs = path.join(ROOT, 'docs');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--docs' && argv[i + 1] && !argv[i + 1].startsWith('--')) docs = path.resolve(argv[++i]);
    else { console.error(`sugar-pill: unknown argument ${JSON.stringify(argv[i])}`); return 2; }
  }
  const file = path.join(docs, REL);
  let html;
  try { html = renderPage(); } catch (e) { console.error(`sugar-pill: refused: ${e.code || e.message}`); return 1; }
  if (check) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current !== html) { console.error(`sugar-pill: ${file} is ${current === null ? 'missing' : 'stale'} - run: node scripts/sugar-pill-page.js`); return 1; }
    console.log(`sugar-pill: ${REL} matches a fresh render from the receipts`);
    return 0;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  console.log(`sugar-pill: ${REL} written`);
  return 0;
}

module.exports = { introOf, REL, HREF, TEXT, GROUPS, PLAIN, FAKE_SENTENCE, fakeSentenceOf, shownSentence, typography, descriptionOf, measurements, skillsOf, groupSkills, caveatsOf, blindSkill, typedFigures, pageMain, page, renderPage, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
