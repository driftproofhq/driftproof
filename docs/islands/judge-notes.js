// SPDX-License-Identifier: Apache-2.0
// Issue 690 (spec 690): the question and the judge's notes behind every task score. Mounted on the
// div.judge-notes of a Report 017 or 018 row. It turns each task name in the row's task lists into an
// opener, lists the openers in the mount, and on the first open fetches the row's own data file (built
// by scripts/build-judge-notes.js) from this origin. The panel shows the task's prompt and rubric, then
// one try at a time, starting at the first: the kept answer with the skill, with the fake text and
// with nothing, each with every score and reason the judge gave. Answers use the shared escaped Markdown renderer; other strings use
// textContent; nothing is stored and nothing leaves the page but the one file fetch.
import { renderAnswer } from './can-you-tell.js';
export { renderAnswer } from './can-you-tell.js';
const CLIP = 1200;
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
const button = (cls, text) => { const b = node('button', cls, text); b.type = 'button'; return b; };
const safeHref = (href) => (typeof href === 'string' && (/^https:\/\/github\.com\/driftproofhq\//.test(href) || /^\/r\/[a-f0-9]{64}\/$/.test(href)) ? href : null);
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// The rubric, whole, in reading order for a person: the scoring instruction and its numbered
// criteria first, then the provenance sentence the judge also read (source, commit and hashes),
// smaller. A rubric of another shape is shown as one paragraph. No word is dropped either way.
const SCORING = 'Score only the written answer.';
function rubricParts(rubric) {
  const at = rubric.indexOf(SCORING);
  if (at < 0) return null;
  const source = rubric.slice(0, at).trim(), scoring = rubric.slice(at).trim();
  // A criterion starts with its number, a full stop and a word ("1. Identify"); "from 0 to 1." is not one.
  const first = /\s(?=1\. [A-Za-z])/.exec(scoring);
  if (!first) return { source, intro: scoring, items: [] };
  const items = scoring.slice(first.index + 1).split(/\s(?=\d+\. [A-Za-z])/).map((s, i) => { const m = /^(\d+)\. ([\s\S]*)$/.exec(s); return m && Number(m[1]) === i + 1 ? m[2] : null; });
  if (items.some((x) => x === null)) return { source, intro: scoring, items: [] };
  return { source, intro: scoring.slice(0, first.index), items };
}
function rubricOf(rubric) {
  const box = node('div', 'judge-rubric'), parts = rubricParts(rubric);
  if (!parts) { box.appendChild(node('p', '', rubric)); return box; }
  box.appendChild(node('p', 'judge-rubric-scoring', parts.intro));
  if (parts.items.length) { const ol = node('ol', 'judge-rubric-items'); for (const it of parts.items) ol.appendChild(node('li', '', it)); box.appendChild(ol); }
  if (parts.source) box.appendChild(node('p', 'judge-rubric-source', parts.source));
  return box;
}

export function mount(el) {
  const src = el.getAttribute('data-notes-src');
  if (!/^\/reports\/\d{3}\/notes\/[a-f0-9]{64}\.json$/.test(src || '')) return;
  const row = el.closest('.placebo-result') || el.parentElement;
  const fallback = el.firstElementChild;
  const ids = [];
  // Each task name in the row's lists becomes an opener; the lists keep their words.
  for (const li of row.querySelectorAll('ul.placebo-tasks li[data-task], ul.verdict-tasks li[data-task]')) {
    const id = li.getAttribute('data-task'), first = li.firstChild;
    if (!id || !first || first.nodeType !== Node.TEXT_NODE || !first.textContent.startsWith(id)) continue;
    if (!ids.includes(id)) ids.push(id);
    first.textContent = first.textContent.slice(id.length);
    const b = button('judge-open', id); b.setAttribute('data-task', id);
    li.insertBefore(b, first);
  }
  if (!ids.length) return;
  const lead = node('p', 'judge-notes-lead', 'See the question and the judge\'s notes: ');
  for (const id of ids) { const b = button('judge-open', id); b.setAttribute('data-task', id); lead.appendChild(b); }
  const status = node('p', 'judge-status'); status.setAttribute('aria-live', 'polite');
  const holder = node('div', 'judge-holder');
  el.replaceChildren(lead, status, holder);
  let loading = null, data = null, opener = null;
  const load = () => loading || (loading = fetch(src, { credentials: 'omit' }).then((r) => { if (!r.ok) throw new Error('status ' + r.status); return r.json(); })
    .then((d) => { if (!d || d.format !== 'driftproof-judge-notes/1' || !Array.isArray(d.tasks)) throw new Error('not a notes file'); data = d; return d; }));
  const close = () => { holder.replaceChildren(); if (opener) opener.focus(); };
  row.addEventListener('click', (ev) => {
    const b = ev.target.closest('button.judge-open');
    if (!b || !row.contains(b)) return;
    opener = b; status.textContent = 'Opening the notes.';
    load().then((d) => { status.textContent = ''; open(d, d.tasks.findIndex((t) => t.id === b.getAttribute('data-task'))); })
      .catch(() => { status.textContent = 'The notes could not be loaded. The kept answers sit beside the receipt in the repository.'; if (fallback) status.appendChild(fallback.cloneNode(true)); });
  });

  function open(d, index) {
    const task = d.tasks[index];
    if (!task) return;
    const id = 'judge-title-' + (row.getAttribute('data-attempt') || '').slice(0, 12) + '-' + index;
    const panel = node('section', 'judge-panel'); panel.setAttribute('aria-labelledby', id);
    const head = node('div', 'judge-head');
    const title = node('h4', 'judge-title', 'Task ' + task.number + ' of ' + task.of + ': ' + task.id); title.id = id; title.tabIndex = -1;
    const closeButton = button('judge-close', 'Close'); closeButton.addEventListener('click', close);
    head.append(title, closeButton);
    const meta = node('p', 'judge-meta', 'Answered by ' + d.model + ' and scored by ' + d.judge + ', on ' + d.date + '. The judge read the rubric below and scored each answer ' + d.judge_samples + ' times. The pass line for this task is ' + task.pass_threshold + '.');
    const arms = node('div', 'judge-arms'), tryLabel = node('span', 'judge-try');
    const prev = button('judge-prev', 'Previous'), next = button('judge-next', 'Next');
    const stepper = node('div', 'judge-stepper'); stepper.append(prev, tryLabel, next);
    let at = 0;
    const show = (k) => {
      at = k; const t = task.tries[k];
      tryLabel.textContent = 'Try ' + t.try + ' of ' + task.tries.length;
      prev.disabled = k === 0; next.disabled = k >= task.tries.length - 1;
      arms.replaceChildren(...d.arms.map((arm) => armOf(arm, t[arm.key], d)));
    };
    prev.addEventListener('click', () => { if (at > 0) show(at - 1); });
    next.addEventListener('click', () => { if (at < task.tries.length - 1) show(at + 1); });
    const caveats = node('ul', 'judge-caveats');
    for (const c of d.caveats) caveats.appendChild(node('li', '', c));
    const links = node('p', 'judge-links');
    for (const [text, href] of [['The receipt\'s page', d.receipt_page], ['The receipt', d.receipt_file], ['Its kept answers', d.answers_file], ['The task suite', d.suite_file]]) {
      const h = safeHref(href); if (!h) continue;
      if (links.childNodes.length) links.appendChild(document.createTextNode(' · '));
      const a = node('a', '', text); a.setAttribute('href', h); links.appendChild(a);
    }
    panel.append(head, meta,
      node('h5', '', 'The question the model was given'), node('p', 'judge-prompt', task.prompt),
      node('h5', '', 'How the judge was told to score it'), rubricOf(task.rubric),
      node('h5', '', 'The answers, one try at a time'), stepper,
      node('p', 'judge-stepper-note', 'Each try is a fresh answer to the same question. Tries are shown in the order they were drawn, starting with the first.'),
      arms, node('h5', '', 'Read this with the report\'s caveats'), caveats, links);
    panel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); close(); } });
    show(0);
    holder.replaceChildren(panel);
    title.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  }

  function armOf(arm, entry, d) {
    const box = node('article', 'judge-arm'); box.setAttribute('data-arm', arm.key);
    box.appendChild(node('h5', '', arm.label));
    if (!entry) { box.appendChild(node('p', 'judge-none', 'This arm has no try with this number: the run drew fewer tries for it.')); return box; }
    const answer = node('div', 'judge-answer');
    answer.innerHTML = renderAnswer(entry.answer);
    box.appendChild(answer);
    if (entry.answer.length > CLIP) {
      answer.classList.add('is-clipped');
      const more = button('judge-more', 'Show all'); more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => { const open = answer.classList.toggle('is-clipped'); more.textContent = open ? 'Show all' : 'Show less'; more.setAttribute('aria-expanded', open ? 'false' : 'true'); });
      box.appendChild(more);
    }
    box.appendChild(node('p', 'judge-average', 'The judge scored this answer ' + entry.notes.length + ' times. The receipt records their average as ' + entry.average + '.'));
    const marks = node('ol', 'judge-marks');
    for (const m of entry.notes) {
      const li = node('li');
      li.appendChild(node('span', 'judge-score', 'Score ' + m.score));
      if (m.pass === true) li.appendChild(node('span', 'judge-pass', ', met the bar'));
      else if (m.pass === false) li.appendChild(node('span', 'judge-pass', ', did not meet the bar'));
      li.appendChild(document.createTextNode(': '));
      li.appendChild(node('span', 'judge-reason', m.reason === null ? 'The judge gave no reason.' : m.reason));
      marks.appendChild(li);
    }
    box.appendChild(marks);
    return box;
  }
}
