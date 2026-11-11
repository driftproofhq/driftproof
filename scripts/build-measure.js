#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {}
// Issue 781 (spec 781): /measure/, the free offer, and one page per published request under
// /measure/requests/NNN/. The offer page's words are Maverick's of 10 Nov 2026, with one change the code
// needs (spec 781, Inferences made). The queue is docs/data/offer-queue.json, which the intake writes from
// the issue list. A request page reads its campaign through the driver's publication rule and gives one
// reading box per skill and per model, each the label scripts/offer.js maps from the receipt's own
// placeboReading. The empty marker above makes scripts/build-site-pages.js run this builder with the others
// without adding the page to the reader-page list; the line on every skill page and report links it.
//   node scripts/build-measure.js [--check]
const fs = require('node:fs');
const path = require('node:path');
const O = require('./offer.js');
const { humanModelName } = require('./model-names');
const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const REL = 'measure/index.html';
const QUEUE = path.join(DOCS, 'data/offer-queue.json');
const REQUESTS = path.join(ROOT, 'specs/781-free-offer/requests');
const GITHUB = 'https://github.com/driftproofhq/driftproof';
// Text content escapes the three characters HTML needs; attributes escape quotes too.
const t = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const a = (s) => t(s).replace(/"/g, '&quot;');
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };

// The offer page's words (spec 781 AC-12): Maverick's wording of 10 Nov 2026. The one change: "A separate
// model scores every answer." reads "A separate grader, Claude Haiku 5.5, scores every answer.", because
// the judge is Haiku 5.5, which also answers.
const WORDS = {
  title: 'Which skills can you delete on Claude 5? | Driftproof',
  h1: "Send us your skills. We'll tell you which ones you can delete on Claude 5.",
  lede: "Claude 5 models do a lot without help. Some skills still earn their place. Others now do no better than a block of filler text of the same length. Send us a public skill pack, or a single skill, and we'll measure every skill and publish what we find. It's free.",
  description: 'Claude 5 models do a lot without help. Some skills still earn their place. Others now do no better than a block of filler text of the same length.',
  doHeading: 'What we do',
  doText: "For each skill we write three tasks from the skill's own text and its README: a normal case, an edge case and a constraint case. We run each task on Claude Haiku 5.5 and Claude Sonnet 5.5 three ways:",
  arms: ['with the skill;', 'with no skill;'],
  placebo: ['with a ', 'placebo', ': a text the same length as the skill that tells the model nothing useful.'],
  grader: 'A separate grader, Claude Haiku 5.5, scores every answer. The tasks are published with the result, so anyone can check them.',
  getHeading: 'What you get, per skill and per model',
  both: 'A skill can be a keep on one model and a delete candidate on the other. We show both.',
  textOnly: 'We measure text-only skills. A skill that routes to other skills or drives tools is marked "not measurable this way", because a text task can\'t show what it does.',
  askHeading: 'Three ways to ask',
  private: ['If the skill is private, email ', 'hello@driftproofhq.com', ' instead of opening a public request.'],
  termsHeading: 'The terms',
  terms: [
    'Free.',
    "Anyone can ask, not only the author. If you're not the author, the result page says so.",
    'We publish the result, whatever it says.',
    'Results come within three days of your request reaching the front of the queue. The queue is below.',
    'We re-run every result on the next Claude model.',
    'Open to the first 50 requests. A pack can hold up to 20 skills.',
  ],
  queueHeading: 'The queue',
  empty: 'No requests yet.',
};
const STATE = { queued: 'Queued', running: 'Running', published: 'Published', refused: 'Refused' };

function page({ title, description, rel, main }) {
  const { shell } = require('./build-site-pages');
  const { applyHeadTags } = require('./build-head-tags');
  return applyHeadTags(applyHeadTags(shell({ title, description, head: '', main }), rel), rel);
}

// ── /measure/ (AC-12, AC-16) ──
function queueSection(q) {
  const rows = q.requests.map((r) => {
    const what = r.kind === 'challenge' ? `a result on ${r.result_page || 'a skill page'}` : `${r.repository || 'a repository'}${r.skills ? `, ${r.skills.length} ${r.skills.length === 1 ? 'skill' : 'skills'}` : ''}`;
    const state = r.state === 'queued' ? `Queued, position ${r.position}` : r.state === 'refused' ? `Refused: ${t(r.reason)}` : r.state === 'published' ? `<a href="${a(r.page)}">Published</a>` : STATE[r.state];
    return `<tr data-request="${r.request}" data-state="${a(r.state)}"${r.state === 'queued' ? ` data-position="${r.position}"` : ''}><td><a href="${a(r.url || `${GITHUB}/issues/${r.issue}`)}">${r.request}</a></td><td>${t((O.KINDS[r.kind] || {}).name || 'Request')}</td><td>${t(what)}</td><td>${state}</td></tr>`;
  }).join('');
  return `<section class="offer-queue" data-queue><p data-count="${q.count}" data-limit="${q.limit}">${q.count} of ${q.limit} requests so far.</p>`
    + `<p>As of <time data-as-of datetime="${a(q.as_of)}">${t(q.as_of)}</time>. <a href="${a(O.OFFER.live)}">The live list on GitHub</a> may be newer.</p>`
    + (q.requests.length ? `<table class="offer-queue-table"><caption>Every request so far, in order</caption><thead><tr><th scope="col">Request</th><th scope="col">Kind</th><th scope="col">What</th><th scope="col">State</th></tr></thead><tbody>${rows}</tbody></table>` : `<p>${t(WORDS.empty)}</p>`)
    + '</section>';
}
function measurePage({ queue }) {
  const form = (k) => `<a href="${a(O.templateUrl(k))}"><em>${t(O.KINDS[k].name)}</em></a>`;
  const main = '<main class="offer-page">'
    + `<h1>${t(WORDS.h1)}</h1><p class="lede">${t(WORDS.lede)}</p>`
    + `<h2 id="what-we-do">${t(WORDS.doHeading)}</h2><p>${t(WORDS.doText)}</p>`
    + `<ul>${WORDS.arms.map((x) => `<li>${t(x)}</li>`).join('')}<li>${t(WORDS.placebo[0])}<strong>${t(WORDS.placebo[1])}</strong>${t(WORDS.placebo[2])}</li></ul>`
    + `<p>${t(WORDS.grader)}</p>`
    + `<h2 id="what-you-get">${t(WORDS.getHeading)}</h2>`
    + `<ul class="offer-labels">${['keep', 'delete', 'cannot'].map((k) => `<li><strong>${t(O.LABELS[k])}.</strong> ${t(O.DEFINITIONS[k])}</li>`).join('')}</ul>`
    + `<p>${t(WORDS.both)}</p><p>${t(WORDS.textOnly)}</p>`
    + `<h2 id="three-ways-to-ask">${t(WORDS.askHeading)}</h2><ol class="offer-ways">`
    + `<li><strong>A pack</strong> (up to 20 skills): open a ${form('pack')} request with the repository link.</li>`
    + `<li><strong>One skill:</strong> open a ${form('skill')} request.</li>`
    + `<li><strong>Challenge a result:</strong> if you think we tested your skill unfairly, open a ${form('challenge')} request with your own three tasks. We re-run with your tasks and publish both results side by side.</li></ol>`
    + `<p>${t(WORDS.private[0])}<a href="mailto:${WORDS.private[1]}">${t(WORDS.private[1])}</a>${t(WORDS.private[2])}</p>`
    + `<h2 id="the-terms">${t(WORDS.termsHeading)}</h2><ul class="offer-terms">${WORDS.terms.map((x) => `<li>${t(x)}</li>`).join('')}</ul>`
    + `<h2 id="the-queue">${t(WORDS.queueHeading)}</h2>${queueSection(queue)}`
    + '</main>';
  need(WORDS.description.length >= 50 && WORDS.description.length <= 160 && WORDS.lede.startsWith(WORDS.description), 'DESCRIPTION');
  return page({ title: WORDS.title, description: WORDS.description, rel: REL, main });
}

// ── a request page (AC-1, AC-3, AC-4, AC-10, AC-13, AC-14, AC-15) ──
const relOf = (n) => `measure/requests/${O.pad(n)}/index.html`;
// One box: a model, the label, the placebo reading's own line and the verdict against no skill in the
// receipt reader's words. `data-field` keeps the plain-word cards out of words a reader reads back.
function box({ skill, model, receipt, root, notMeasurable = false, reason = null, column = null }) {
  const r = O.readingOf(receipt ? JSON.parse(fs.readFileSync(path.join(root, receipt), 'utf8')) : null, { notMeasurable, reason });
  const lines = notMeasurable
    ? [`<p class="offer-why">${t(reason)}</p>`]
    : receipt
      ? [`<p class="offer-why">Against the placebo: ${t(r.placebo_line)}.</p>`, `<p class="offer-against">Against no skill: ${t(r.against_no_skill)}</p>`, `<p class="offer-receipt"><a href="${a(`${GITHUB}/blob/main/${receipt}`)}">The receipt</a></p>`]
      : [`<p class="offer-why">${t(r.reason)}</p>`];
  return `<div class="offer-box" data-field="reading"${column ? ` data-column="${column}"` : ''} data-skill="${a(skill)}" data-model="${a(model)}" data-reading="${r.reading}" data-receipt="${a(receipt || '')}"${notMeasurable ? ' data-not-measurable="true"' : ''}>`
    + `<p class="offer-model">${t(humanModelName(model))}</p><p class="offer-label">${t(r.label)}</p>${lines.join('')}</div>`;
}
const boxesOf = (s, root, column = null) => s.boxes.map((b) => ({ model: b.model, key: s.measurable ? O.readingOf(b.receipt ? JSON.parse(fs.readFileSync(path.join(root, b.receipt), 'utf8')) : null).key : 'notMeasurable', html: box({ skill: s.skill, model: b.model, receipt: b.receipt, root, notMeasurable: !s.measurable, reason: s.reason, column }) }));
function tasks(s) {
  if (!s.suite) return '';
  const who = s.suite.author === 'requester' ? 'The requester wrote these tasks. Driftproof did not edit them.' : "Driftproof wrote these tasks from the skill's own text and its README.";
  return `<details class="offer-tasks"><summary>The three tasks</summary><p>${t(who)}</p><ol>${s.suite.cases.map((c) => `<li data-task="${a(c.id)}"><p>${t(c.prompt)}</p><p>How it is scored: ${t(c.rubric)}</p></li>`).join('')}</ol></details>`;
}
function headlineHtml(skills, models, root) {
  const h = O.headline(skills.map((s) => ({ skill: s.skill, boxes: boxesOf(s, root) })), models);
  const noun = h.total === 1 ? 'is a delete candidate' : 'are delete candidates';
  const per = models.map((m) => { const c = h.per[m]; return `<li data-model="${a(m)}" data-keep="${c.keep}" data-delete="${c.delete}" data-cannot="${c.cannot}" data-not-measurable="${c.notMeasurable}">On ${t(humanModelName(m))}: ${c.keep} keep, ${c.delete} delete ${c.delete === 1 ? 'candidate' : 'candidates'}, ${c.cannot} cannot tell, ${c.notMeasurable} not measurable this way.</li>`; }).join('');
  return `<section class="offer-headline"><p class="offer-both" data-both="${h.both}" data-total="${h.total}">${h.both} of ${h.total} ${noun} on both models.</p><ul>${per}</ul></section>`;
}
function requestPage(view, { root = view.root || ROOT } = {}) {
  const r = view.request, n = O.pad(r.request), challenge = r.kind === 'challenge';
  const models = view.models.map((m) => humanModelName(m)).join(' and ');
  const lede = challenge
    ? `Request ${n} of the free offer: a result re-run on the requester's own three tasks, on ${models}, beside the result it challenges.`
    : `Request ${n} of the free offer: ${r.repository}, every skill measured on ${models} against no skill and a same-length placebo.`;
  const body = [`<h1>Request ${n}: ${t(r.repository)}</h1>`, `<p class="lede">${t(lede)}</p>`];
  if (r.author === false) body.push(`<p class="offer-not-author">${t(O.NOT_AUTHOR)}</p>`);
  body.push(`<p>Asked in <a href="${a(r.url || `${GITHUB}/issues/${r.issue}`)}">issue ${r.issue}</a>. The skills were read at commit <code>${t(r.commit)}</code>. Each label is read per model from the receipt's placebo reading; what the labels mean is on <a href="/measure/#what-you-get">the offer page</a>.</p>`);
  for (const [m, limit] of Object.entries(view.judge_relationships || {})) if (limit) body.push(`<p>For ${t(humanModelName(m))}: ${t(limit)}</p>`);
  if (!challenge) body.push(headlineHtml(view.skills, view.models, root));
  for (const s of view.skills) {
    body.push(`<section class="offer-skill" id="skill-${a(s.skill)}"><h2>${t(s.skill)}</h2>`);
    if (challenge) {
      const orig = view.original && view.original.skills && view.original.skills.find((x) => x.skill === s.skill);
      const mine = boxesOf(s, root, 'challenge'), theirs = orig ? boxesOf(orig, root, 'original') : [];
      body.push(`<p>Our result is on <a href="${a(view.original.href)}">${t(view.original.href)}</a>. Beside it, the same skill on the requester's tasks.</p>`);
      for (const m of view.models) {
        const o = theirs.find((x) => x.model === m), c = mine.find((x) => x.model === m);
        body.push(`<div class="offer-pair" data-model="${a(m)}">${o ? o.html : `<p class="offer-original-link">Our tasks: <a href="${a(view.original.href)}">the published result</a></p>`}${c.html}</div>`);
      }
      if (orig) body.push(tasks(orig));
    } else body.push(`<div class="offer-boxes">${boxesOf(s, root).map((b) => b.html).join('')}</div>`);
    body.push(tasks(s), '</section>');
  }
  const main = `<main class="offer-request">${body.join('')}</main>`;
  return page({ title: `Request ${n}: ${r.repository} | Driftproof`, description: lede, rel: relOf(r.request), main });
}

// Results under /skills/ (the comment of 10 Nov 18:03, "Pages"): each published request's boxes, one row
// per skill and per model, for scripts/build-skill-index.mjs to place on the skill's own page.
function skillRows(view, { root = view.root || ROOT } = {}) {
  const [owner, repo] = view.request.repository.split('/');
  return view.skills.filter((s) => s.measurable && view.request.kind !== 'challenge').flatMap((s) => boxesOf(s, root).map((b) => ({
    id: { owner, repo, name: s.skill, path: s.skill_path.replace(/\/?SKILL\.md$/, ''), unit: 'skill', page: `${owner}/${repo}/${s.skill}` },
    row: { ...(() => { const f = s.boxes.find((x) => x.model === b.model).receipt; const r = f ? JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')) : null; return { file: f || '', hash: r ? r.receipt_hash : 'none', date: r ? r.run.date_utc : undefined }; })(), source: 'driftproof', srcName: 'Driftproof', evidence: 'measured', freshness: 'unknown', model: b.model, label: O.LABELS[b.key], summary: O.LABELS[b.key], markup: `${b.html}<p><a href="/${relOf(view.request.request).replace(/index\.html$/, '')}">Request ${O.pad(view.request.request)} of the free offer</a></p>` },
  })));
}

// The published requests, each read through the driver's publication rule.
function views(root = ROOT) {
  const requests = path.join(root, path.relative(ROOT, REQUESTS));
  if (!fs.existsSync(requests)) return [];
  const R = require('../specs/781-free-offer/run-campaign.cjs');
  const dirOf = (n) => path.join(requests, O.pad(n));
  const recordOf = (n) => JSON.parse(fs.readFileSync(path.join(dirOf(n), 'request.json'), 'utf8'));
  const args = (n) => ({ request: dirOf(n), campaignRoot: path.join(root, recordOf(n).campaign_root) });
  return fs.readdirSync(requests).filter((d) => /^\d{3}$/.test(d)).sort().map(Number).filter((n) => recordOf(n).state === 'published')
    .map((n) => R.view({ root, ...args(n), requests: (m) => args(m) }));
}
function outputs(opts = {}) {
  const out = path.resolve(opts.out || DOCS);
  const queue = opts.queue || JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  return [{ file: path.join(out, REL), text: measurePage({ queue }) }, ...views().map((v) => ({ file: path.join(out, relOf(v.request.request)), text: requestPage(v) }))];
}
function write(opts = {}) {
  const files = outputs(opts);
  for (const f of files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text); }
  return files;
}
function check(opts = {}) {
  const files = outputs(opts);
  for (const f of files) need(fs.existsSync(f.file) && fs.readFileSync(f.file, 'utf8') === f.text, 'MEASURE_PAGE_DRIFT');
  return files;
}
function main(argv = process.argv.slice(2)) {
  for (const x of argv) need(x === '--check', 'ARGUMENT');
  const isCheck = argv.includes('--check');
  const files = (isCheck ? check : write)();
  const q = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  console.log(`measure: the offer page and ${files.length - 1} request pages ${isCheck ? 'match' : 'written from'} the queue and the published campaigns; ${q.count} of ${q.limit} requests, as of ${q.as_of}`);
}
module.exports = { REL, WORDS, measurePage, requestPage, skillRows, views, outputs, write, check, main, box };
if (require.main === module) try { main(); } catch (e) { console.error('measure: refused: ' + (e.code || e.message)); process.exitCode = 1; }
