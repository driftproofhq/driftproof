// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 781 (spec 781): the free offer's one definition. The labels, their words, the line on every skill
// page and report, the forms, the request terms, the text-only rule and the queue. The site builders,
// the intake and the skill index read it from here, so a word changed here changes everywhere.
//
// THE READING IS lib/verdict.js's (spec 781 AC-1, AC-2). Every label is the mapping of placeboReading on
// the sealed receipt, per model; this file holds the table and no copy of the case rule. The verdict
// against no skill is lib/plain.js plainOf, the receipt reader's own words, as on Reports 017 and 018.
const { placeboReading, placeboLine } = require('../lib/verdict');
const { plainOf } = require('../lib/plain');
const { handsOffOnly } = require('./skill-handoff.js');

const OFFER = {
  repo: 'driftproofhq/driftproof',
  live: 'https://github.com/driftproofhq/driftproof/issues?q=is%3Aissue+label%3Aoffer',
  maxRequests: 50,
  maxSkills: 20,
  capUSD: 50,
  models: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
  judge: 'claude-haiku-5-5',
  taskIds: ['normal', 'edge', 'constraint'],
};
const KINDS = {
  pack: { label: 'offer-pack', template: 'measure-pack.yml', name: 'Measure a pack' },
  skill: { label: 'offer-skill', template: 'measure-skill.yml', name: 'Measure a skill' },
  challenge: { label: 'offer-challenge', template: 'challenge-result.yml', name: 'Challenge a result' },
};
const templateUrl = (kind) => `https://github.com/${OFFER.repo}/issues/new?template=${KINDS[kind].template}`;
// The fields each form asks, by its label, and the key the intake reads it into.
const FIELDS = {
  pack: { 'Repository link': 'repository', 'Skill paths': 'skills', 'Are you the author?': 'author' },
  skill: { 'Repository link': 'repository', 'Skill path': 'skills', 'Are you the author?': 'author' },
  challenge: {
    'Result page link': 'result_page', 'Repository link': 'repository', 'Skill path': 'skills',
    'Task 1': 'task1', 'How to score task 1': 'score1', 'Task 2': 'task2', 'How to score task 2': 'score2', 'Task 3': 'task3', 'How to score task 3': 'score3',
    'Are you the author?': 'author',
  },
};

// THE LINE (spec 781 AC-11): the same words on every skill page and report, from scripts/site-chrome.js.
const ASK = { text: "Want a skill measured, or think a result is wrong? It's free: ", link: 'how to ask', href: '/measure/' };
const askLine = () => `<p class="offer-ask">${ASK.text}<a href="${ASK.href}">${ASK.link}</a>.</p>`;
const asksOn = (rel) => /^skills\/(?:.+\/)?index\.html$/.test(rel) || rel === 'reports/index.html' || /^reports\/\d+\/index\.html$/.test(rel);

// THE LABELS (spec 781 AC-1). Maverick's reading rules of 10 Nov 2026, word for word.
const LABELS = { keep: 'Keep', delete: 'Delete candidate', cannot: 'Cannot tell', notMeasurable: 'Not measurable this way' };
const MAPPING = {
  ABOVE_PLACEBO: 'keep',
  BELOW_PLACEBO: 'delete', NO_DIFFERENCE: 'delete',
  INCONCLUSIVE: 'cannot', UNDERPOWERED: 'cannot', NOT_MEASURED: 'cannot',
};
const DEFINITIONS = {
  keep: 'On at least one task the skill scored above the placebo, and on none did it score below. Its words do something that the same amount of text does not.',
  delete: 'The skill did not beat the placebo on these tasks: it scored below it on at least one task (even if it scored above it on another), or no task differed by as much as the test can detect. That is a reason to try working without it. It is not proof the skill does nothing, because your own tasks may differ from ours.',
  cannot: 'The results were too uncertain to read either way, or the skill cannot be measured this way.',
};
const NOT_AUTHOR = 'Requested by someone who is not the author.';
const fail = (c, message = c) => { throw Object.assign(new Error(message), { code: c }); };

function labelOf(reading, notMeasurable = false) {
  if (!Object.hasOwn(MAPPING, reading)) fail('READING_UNKNOWN', `READING_UNKNOWN: ${reading}`);
  return notMeasurable ? 'notMeasurable' : MAPPING[reading];
}
// One box's reading, per model. A skill with no sealed receipt reads NOT_MEASURED, and so Cannot tell:
// it is shown, never left out (AC-13). A skill the intake marked not measurable runs no attempt.
function readingOf(receipt, { notMeasurable = false, reason = null } = {}) {
  if (notMeasurable) return { reading: 'NOT_MEASURED', key: 'notMeasurable', label: LABELS.notMeasurable, reason, placebo_line: null, against_no_skill: null };
  if (!receipt) return { reading: 'NOT_MEASURED', key: 'cannot', label: LABELS.cannot, reason: 'No sealed result for this model.', placebo_line: null, against_no_skill: null };
  const r = placeboReading(receipt), key = labelOf(r.reading);
  return { reading: r.reading, key, label: LABELS[key], reason: null, placebo_line: placeboLine(r), against_no_skill: plainOf(receipt).sentence };
}
// The pack's headline, per model and never merged (AC-3). skills: [{ skill, boxes: [{ model, key }] }]
function headline(skills, models) {
  const per = Object.fromEntries(models.map((m) => [m, { keep: 0, delete: 0, cannot: 0, notMeasurable: 0 }]));
  for (const s of skills) for (const b of s.boxes) per[b.model][b.key]++;
  const both = skills.filter((s) => models.every((m) => s.boxes.some((b) => b.model === m && b.key === 'delete'))).length;
  return { total: skills.length, both, per };
}

// THE TEXT-ONLY RULE (spec 781 AC-5, A-781-1). A skill is text-only when nothing in its folder runs
// (the controller's ruling of 10 Nov 2026 on Maverick's term). Not measurable this way: Report 015's
// routers by name, Report 017's hand-off rule, a tools key in the front matter, or a file in the skill's
// folder that runs: one with an executable bit, one whose first line starts "#!", one in a program or
// script language by its extension, or one that is not plain text (not valid UTF-8, or holding a NUL)
// unless its leading bytes are an image's or a PDF's. Every other UTF-8 file is text: Markdown, JSON, YAML,
// CSV, TOML, XML, HTML, evals/evals.json. The public reason names the file by its path in the folder and
// its actual cause.
// files: [{ path, mode, bytes }], each path relative to the skill's folder, bytes a Buffer.
// Report 015's routers are spec 613's list, required when the rule runs: scripts/site-chrome.js loads this
// file for the line, and the public tree, which carries no specs/, must load it too.
const routers = () => require('../specs/613-placebo-skills-report/protocol.cjs').ROUTERS;
const SCRIPT_EXT = new Set(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'tsx', 'jsx', 'py', 'pyw', 'sh', 'bash', 'zsh', 'ksh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'vbs', 'rb', 'php', 'pl', 'pm', 'lua', 'r', 'tcl', 'awk']);
const PROGRAM_EXT = new Set(['go', 'rs', 'java', 'kt', 'kts', 'scala', 'cs', 'swift', 'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'm', 'dart', 'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'jar', 'class', 'o', 'a', 'pyc', 'msi', 'com']);
const NOT_TEXT = 'so a text task cannot show what it does.';
const UTF8 = new TextDecoder('utf-8', { fatal: true });
// An image or a PDF does not run (A-781-1, the controller's correction of 10 Nov 2026). It is known by its
// leading bytes, never by its name, so a script renamed .png is still read as what it is.
const at = (b, off, sig) => b.length >= off + sig.length && sig.every((x, i) => b[off + i] === x);
const ascii = (s) => [...Buffer.from(s, 'latin1')];
const ASSETS = [
  (b) => at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG
  (b) => at(b, 0, [0xff, 0xd8, 0xff]), // JPEG
  (b) => at(b, 0, ascii('GIF87a')) || at(b, 0, ascii('GIF89a')), // GIF
  (b) => at(b, 0, ascii('RIFF')) && at(b, 8, ascii('WEBP')), // WebP
  (b) => at(b, 0, [0x00, 0x00, 0x01, 0x00]), // ICO
  (b) => at(b, 0, ascii('BM')), // BMP
  (b) => at(b, 4, ascii('ftyp')) && (at(b, 8, ascii('avif')) || at(b, 8, ascii('avis'))), // AVIF
  (b) => at(b, 0, ascii('%PDF-')), // PDF
];
const isAsset = (b) => ASSETS.some((sig) => sig(b));
// Why a file runs, or null when it is text.
function runs(f) {
  if (f.mode === '100755') return 'has an executable bit';
  const ext = (/\.([^./]+)$/.exec(f.path) || [, ''])[1].toLowerCase();
  if (SCRIPT_EXT.has(ext)) return 'is a script';
  if (PROGRAM_EXT.has(ext)) return 'is a program';
  if (f.bytes) {
    let s = null;
    if (!f.bytes.includes(0)) try { s = UTF8.decode(f.bytes); } catch { s = null; }
    // Not plain text: an image or a PDF by its signature is an asset that does not run; anything else is not.
    if (s === null) return isAsset(f.bytes) ? null : 'is not plain text';
    if (s.replace(/^﻿/, '').startsWith('#!')) return 'is a script';
  }
  return null;
}
function textOnly({ name, text, files = [] }) {
  if (routers().includes(name)) return { measurable: false, reason: `It routes to other skills, ${NOT_TEXT}` };
  if (handsOffOnly(text)) return { measurable: false, reason: `It only hands off to another skill, ${NOT_TEXT}` };
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (front && /^(?:allowed-tools|tools)\s*:/m.test(front[1])) return { measurable: false, reason: `Its front matter grants tools, ${NOT_TEXT}` };
  for (const f of files) {
    if (f.path === '.git' || f.path.startsWith('.git/')) continue;
    const why = runs(f);
    if (why) return { measurable: false, reason: `Its folder holds ${f.path}, which ${why}, ${NOT_TEXT}` };
  }
  return { measurable: true, reason: null };
}

// ── the forms, read (NFR-1: untrusted text, read by heading, nothing evaluated) ──
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/;
const RESULT_RE = /^(?:https:\/\/driftproofhq\.com)?\/(?:skills\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)|measure\/requests\/(\d{3}))\/?$/;
const kindOf = (issue) => Object.keys(KINDS).find((k) => (issue.labels || []).some((l) => (l.name || l) === KINDS[k].label)) || null;
function fieldsOf(body) {
  const out = {};
  const parts = String(body || '').replace(/\r\n/g, '\n').split(/^### +(.+?)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const v = parts[i + 1].trim();
    out[parts[i].trim()] = v === '_No response_' ? '' : v;
  }
  return out;
}
function skillPath(line) {
  const p = line.trim().replace(/^`|`$/g, '').replace(/^\.?\/+/, '').replace(/\/+$/, '');
  // The repository's root, written `.`, `./` or `/`, holds the skill at SKILL.md (F-1).
  const full = p === '' || p === '.' ? 'SKILL.md' : /(?:^|\/)SKILL\.md$/.test(p) ? p : `${p}/SKILL.md`;
  return full.split('/').every((s) => SEGMENT.test(s) && s !== '..') ? full : null;
}
// -> { kind, repository, skills, skill, result_page, tasks, author, problem }
function parseIssue(issue) {
  const kind = kindOf(issue);
  const f = fieldsOf(issue.body), out = { kind, author: null, problem: null };
  const no = (why) => ({ ...out, problem: why });
  if (!kind) return no('The request carries no offer label.');
  const a = (f['Are you the author?'] || '').trim();
  out.author = a === 'Yes' ? true : a === 'No' ? false : null;
  if (out.author === null) return no('The form does not say whether you are the author.');
  if (kind === 'challenge') {
    if (!RESULT_RE.test((f['Result page link'] || '').trim())) return no('The result page link is not a Driftproof skill or request page.');
    out.result_page = (f['Result page link'] || '').trim().replace(/^https:\/\/driftproofhq\.com/, '');
    out.tasks = [1, 2, 3].map((n) => ({ prompt: (f[`Task ${n}`] || '').trim(), rubric: (f[`How to score task ${n}`] || '').trim() }));
    if (out.tasks.some((t) => !t.prompt || !t.rubric)) return no('A challenge needs three tasks, each with how to score it.');
  }
  const repo = REPO_RE.exec((f['Repository link'] || '').trim());
  if (!repo) return no('The repository link is not a public GitHub repository link.');
  out.repository = `${repo[1]}/${repo[2]}`;
  const lines = (f['Skill paths'] || f['Skill path'] || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return no('The form names no skill path.');
  if (kind !== 'pack' && lines.length !== 1) return no('This request names one skill path.');
  if (lines.length > OFFER.maxSkills) return no(`A pack can hold up to ${OFFER.maxSkills} skills; this one lists ${lines.length}.`);
  out.skills = lines.map(skillPath);
  if (out.skills.some((s) => !s)) return no('A skill path is not a plain path in the repository.');
  if (new Set(out.skills).size !== out.skills.length) return no('A skill path is listed twice.');
  return out;
}

// ── the queue (spec 781 AC-9, AC-16) ──
// issues: the issue list the controller exported. previous: the last queue, whose numbers are kept.
// records: request number -> { state } from the request directories (running or published).
const pad = (n) => String(n).padStart(3, '0');
const pageOf = (n) => `/measure/requests/${pad(n)}/`;
function queueOf({ issues, previous = null, records = {}, asOf }) {
  const prev = new Map(((previous && previous.requests) || []).map((r) => [r.issue, r]));
  let next = Math.max(0, ...[...prev.values()].map((r) => r.request));
  const offer = issues.filter((i) => kindOf(i)).sort((a, b) => a.number - b.number);
  const requests = [];
  for (const i of offer) {
    const old = prev.get(i.number);
    const open = String(i.state).toUpperCase() === 'OPEN';
    if (!old && !open) continue;
    const request = old ? old.request : ++next;
    const p = parseIssue(i);
    const e = { request, issue: i.number, url: i.url, kind: p.kind, author: p.author };
    if (p.repository) e.repository = p.repository;
    if (p.skills) e.skills = p.skills;
    if (p.kind === 'challenge' && !p.problem) e.result_page = p.result_page;
    const rec = records[request];
    if (rec && rec.state === 'published') { e.state = 'published'; e.page = pageOf(request); }
    else if (rec) e.state = 'running';
    else if (request > OFFER.maxRequests) { e.state = 'refused'; e.reason = `The offer is open to the first ${OFFER.maxRequests} requests; this is request ${request}.`; }
    else if (p.problem) { e.state = 'refused'; e.reason = p.problem; }
    else if (!open) { e.state = 'refused'; e.reason = 'The request was closed before it ran.'; }
    else e.state = 'queued';
    requests.push(e);
  }
  for (const r of prev.values()) if (!requests.some((x) => x.request === r.request)) requests.push(r);
  requests.sort((a, b) => a.request - b.request);
  let position = 0;
  for (const r of requests) { delete r.position; if (r.state === 'queued') r.position = ++position; }
  return { as_of: asOf, live: OFFER.live, limit: OFFER.maxRequests, count: Math.min(OFFER.maxRequests, requests.length), requests };
}

// The comments the controller posts (AC-17): received, queued, published with its link, refused with
// its reason. Prepared only; nothing here posts.
const ORIGIN = 'https://driftproofhq.com';
function commentsFor(previous, next) {
  const prev = new Map(((previous && previous.requests) || []).map((r) => [r.issue, r]));
  const out = [];
  const say = (r, kind, body) => out.push({ issue: r.issue, request: r.request, kind, body });
  for (const r of next.requests) {
    const old = prev.get(r.issue);
    if (!old) say(r, 'received', `Thank you. This is request ${r.request} of the free offer. The queue is on ${ORIGIN}/measure/.`);
    if (old && old.state === r.state) continue;
    if (r.state === 'queued' && !old) say(r, 'queued', `Request ${r.request} is number ${r.position} in the queue. Results come within three days of it reaching the front.`);
    if (r.state === 'refused') say(r, 'refused', `We cannot take request ${r.request}. ${r.reason}`);
    if (r.state === 'published') say(r, 'published', `The result of request ${r.request} is published: ${ORIGIN}${r.page}`);
  }
  return out;
}

module.exports = {
  OFFER, KINDS, FIELDS, templateUrl, ASK, askLine, asksOn,
  LABELS, MAPPING, DEFINITIONS, NOT_AUTHOR, labelOf, readingOf, headline,
  textOnly, fieldsOf, parseIssue, queueOf, commentsFor, pageOf, pad,
};
