// SPDX-License-Identifier: Apache-2.0
// Issue 726. The Try it yourself worksheet. Which answer came from which set lives in this module's
// memory until Reveal; no arm reaches the scoring deck's text or attributes before then. Pasted
// answers render through the one escaped Markdown renderer the site's answer pages share. The rule
// and the floor are the library's, imported, never typed. Nothing is sent; the one localStorage key
// keeps an unfinished worksheet and never a score. Issue 745. The third arm is the same-length fake,
// built from the person's own bytes by the module /placebo/ and the runner share, never typed or
// edited; a text the module refuses shows its own words and leaves the two-arm worksheet.
import { renderAnswer } from './can-you-tell.js';
import { buildFake } from './placebo.js';
import { PLACEBO_OPENING } from '../import-core/placebo.mjs';
import { EFFECT_FLOOR, MIN_PER_ARM, readArms, SENTENCES } from '../import-core/band.mjs';
export { renderAnswer };

const KEY = 'driftproof-try-it';
const ARMS = [['with', 'With the instructions'], ['fake', 'With the fake'], ['without', 'With nothing']];
// The readings, in the fixed order: id, the arm read, the arm it is read against, the title.
const READINGS = [['with-without', 'with', 'without', 'Your instructions against nothing'], ['with-fake', 'with', 'fake', 'Your instructions against the fake'], ['fake-without', 'fake', 'without', 'The fake against nothing']];
// The words /spot-the-fake/ carries over Reports 017 and 018, verbatim.
const REMINDER = 'Beating the fake is not beating nothing.';
const NO_FAKE = 'No fake was built, so there is no reading against it.';
const ASK = 'You have typed your own prompt or guide. Choosing this task would replace them.';
const COUNT = 3;
const SCALE = 4;
const blank = () => ['', '', ''];
const fresh = () => ({ task: '', prompt: '', guide: '', instructions: '', model: '', answers: { with: blank(), fake: blank(), without: blank() }, locked: false });

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') node.textContent = v; else if (k === 'hidden') node.hidden = !!v; else node.setAttribute(k, v); }
  for (const c of children) node.append(c);
  return node;
}
const random = n => { const b = new Uint32Array(1), limit = Math.floor(4294967296 / n) * n; do { crypto.getRandomValues(b); } while (b[0] >= limit); return b[0] % n; };
function shuffle(items) { const out = items.slice(); for (let i = out.length - 1; i > 0; i--) { const j = random(i + 1); [out[i], out[j]] = [out[j], out[i]]; } return out; }
async function sha256Hex(text) {
  if (!crypto.subtle) return 'unavailable in this browser';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function load() { try { const raw = localStorage.getItem(KEY); const d = raw ? JSON.parse(raw) : null; return d && typeof d === 'object' ? { ...fresh(), ...d, answers: Object.fromEntries(ARMS.map(([arm]) => [arm, (d.answers && d.answers[arm]) || blank()])) } : fresh(); } catch { return fresh(); } }
function save(draft) { try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* a browser that refuses storage still runs the page */ } }
function forget() { try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ } }
const two = x => (x * SCALE).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

export async function mount(root) {
  const bytes = Uint8Array.from(atob(root.getAttribute('data-tasks-source')), c => c.charCodeAt(0));
  const data = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  root.removeAttribute('data-tasks-source');
  const caveats = [...document.querySelectorAll('.try-caveats li')].map(li => li.textContent);
  const turnOffWords = root.querySelector('[data-turn-off]').textContent;
  let draft = load();
  let order = [], scores = [], current = 0, revealed = false, hash = '';
  let fake = null, fakeRun = 0;
  // One status element, in the page from the start: a live region that starts hidden is not reliably announced.
  const announce = el('p', { class: 'try-announce', 'data-announce': '', role: 'status' });
  const say = words => { if (announce.textContent !== words) announce.textContent = words; };

  // ── step 1: freeze ─────────────────────────────────────────────────────────
  const taskSelect = el('select', { id: 'try-task' }, [el('option', { value: '', text: 'Write my own prompt and guide' })]);
  for (const s of data.skills) {
    const group = el('optgroup', { label: s.name + ' (' + s.repository + ')' });
    for (const t of s.tasks) group.append(el('option', { value: s.repository + '/' + s.name + '#' + t.id, text: s.name + ': ' + t.id }));
    taskSelect.append(group);
  }
  const taskLink = el('p', { class: 'try-fine', 'data-task-link': '' });
  const taskReplace = el('button', { type: 'button', 'data-task-replace': '', text: 'Replace my text with this task' });
  const taskKeep = el('button', { type: 'button', 'data-task-keep': '', text: 'Keep my text' });
  const taskAsk = el('div', { class: 'try-ask', 'data-task-ask': '', hidden: true }, [el('p', { text: ASK }), el('div', { class: 'try-actions' }, [taskReplace, taskKeep])]);
  const prompt = el('textarea', { id: 'try-prompt', rows: '6' });
  const guide = el('textarea', { id: 'try-guide', rows: '6' });
  const instructions = el('textarea', { id: 'try-instructions', rows: '6' });
  const model = el('input', { id: 'try-model', type: 'text', autocomplete: 'off' });
  const fakeInstructionsBytes = el('span', { 'data-fake-instructions-bytes': '' });
  const fakeBytes = el('span', { 'data-fake-bytes': '' });
  const fakeOpening = el('q', { 'data-fake-opening': '' });
  const fakePanel = el('div', { class: 'try-fake', 'data-fake-panel': '', hidden: true }, [
    el('h3', { text: 'The fake, built for your instructions' }),
    el('p', {}, ['Your instructions: ', fakeInstructionsBytes, ' bytes. The fake: ', fakeBytes, ' bytes, the same length: an unrelated passage about a market town.']),
    el('p', {}, ['It opens: ', fakeOpening]),
  ]);
  const fakeRefusal = el('p', { class: 'try-fine', 'data-fake-refusal': '', hidden: true });
  const lock = el('button', { type: 'button', 'data-lock': '', text: 'Lock the task, the guide and the instructions' });
  const hashOut = el('code', { 'data-hash': '' });
  const copyStatus = el('p', { role: 'status', 'data-copy-status': '' });
  const textWith = el('pre'), textFake = el('pre'), textWithout = el('pre');
  const copyFake = el('button', { type: 'button', 'data-copy': 'fake', text: 'Copy the prompt with the fake', hidden: true });
  const fakeTexts = el('div', { hidden: true }, [el('h3', { text: 'With the fake' }), textFake]);
  const turnOff = el('p', { class: 'try-turn-off', 'data-turn-off': '', tabindex: '-1', text: turnOffWords });
  const locked = el('div', { class: 'try-locked', 'data-locked': '', hidden: true }, [
    el('p', { text: 'Locked for this session. ' }, [document.createTextNode('Instructions hash: '), hashOut]),
    turnOff,
    el('div', { class: 'try-copies' }, [el('button', { type: 'button', 'data-copy': 'with', text: 'Copy the prompt with the instructions' }), copyFake, el('button', { type: 'button', 'data-copy': 'without', text: 'Copy the prompt with nothing added' })]),
    copyStatus,
    el('details', { class: 'try-texts' }, [el('summary', { text: 'Show the exact texts' }), el('h3', { text: 'With the instructions' }), textWith, fakeTexts, el('h3', { text: 'With nothing' }), textWithout]),
    el('p', { class: 'try-fine', text: 'Paste each text into a new chat on the same model, three times each. Copy the whole answer back here.' }),
  ]);
  const step1 = el('section', { class: 'try-step', 'data-step': '1' }, [
    el('h2', { text: 'Step 1. Freeze the task and the guide' }),
    el('p', { text: 'Fix what you will ask and how you will score it before any answer exists. A guide written after the answers is fitted to them.' }),
    el('label', { for: 'try-task', text: 'Pick a task Driftproof published, or write your own' }), taskSelect, taskLink, taskAsk,
    el('label', { for: 'try-prompt', text: 'The prompt' }), prompt,
    el('label', { for: 'try-guide', text: 'The scoring guide: four points, one per criterion' }), guide,
    el('label', { for: 'try-instructions', text: 'The instructions you are testing' }), instructions,
    el('p', { class: 'try-fine', text: 'A prompt you reuse, a custom instruction, a CLAUDE.md. One set of answers gets a fake of the same length in their place, and one set gets nothing. The task stays the same.' }),
    fakePanel, fakeRefusal,
    el('label', { for: 'try-model', text: 'The model, as your assistant names it' }), model,
    lock, locked,
  ]);

  // ── step 2: collect ────────────────────────────────────────────────────────
  const boxes = {}, modelNames = [];
  const sets = ARMS.map(([arm, label]) => {
    const set = el('div', { class: 'try-set' }, [el('h3', { text: label })]);
    boxes[arm] = [];
    for (let i = 1; i <= COUNT; i++) {
      const id = 'try-answer-' + arm + '-' + i, name = el('span', { 'data-model-name': '' }); modelNames.push(name);
      const box = el('textarea', { id, 'data-answer': arm + '-' + i, rows: '5' });
      boxes[arm].push(box);
      set.append(el('label', { for: id }, [document.createTextNode(label + ', answer ' + i + '. New chat, same model: '), name, document.createTextNode('.')]), box);
    }
    return set;
  });
  const fakeSet = sets[ARMS.findIndex(([arm]) => arm === 'fake')];
  const step2Title = el('h2', { text: 'Step 2. Collect nine answers' });
  const start = el('button', { type: 'button', 'data-start': '', text: 'Score the answers blind' });
  const startNote = el('p', { class: 'try-fine', 'data-start-note': '', text: 'Fewer than three answers in a set reads as too few to tell.' });
  const step2 = el('section', { class: 'try-step', 'data-step': '2', hidden: true }, [
    step2Title,
    el('p', { text: 'Open a new chat for every answer, on the same model, so no answer remembers another. Paste each whole answer into its box.' }),
    el('div', { class: 'try-arms' }, sets), start, startNote,
  ]);

  // ── step 3: score blind ────────────────────────────────────────────────────
  const progress = el('p', { 'data-progress': '', 'aria-live': 'polite' });
  const pane = el('div', { class: 'try-answer', 'data-pane': '', tabindex: '0', 'aria-label': 'The answer' });
  const guideOut = el('pre', { class: 'try-guide', 'data-guide': '' });
  const scoreButtons = [0, 1, 2, 3, 4].map(n => el('button', { type: 'button', 'data-score': String(n), 'aria-pressed': 'false', 'aria-label': 'Score ' + n + ' of ' + SCALE, text: String(n) }));
  const noneButton = el('button', { type: 'button', 'data-score': 'none', 'aria-pressed': 'false', text: 'Cannot score' });
  const prev = el('button', { type: 'button', 'data-prev': '', text: 'Previous' });
  const next = el('button', { type: 'button', 'data-next': '', text: 'Next answer' });
  const reveal = el('button', { type: 'button', class: 'try-reveal', 'data-reveal': '', text: 'Reveal' });
  const status = el('p', { 'data-status': '', role: 'status' });
  const deck = el('section', { class: 'try-step', 'data-step': '3', 'data-deck': '', hidden: true }, [
    el('h2', { text: 'Step 3. Score each answer blind' }),
    el('p', { text: 'The answers are shuffled. Read one, score it against the guide, move on. You can change a score until Reveal.' }),
    progress,
    el('div', { class: 'try-deck-grid' }, [
      el('div', {}, [el('h3', { text: 'The answer' }), pane, el('div', { class: 'try-scores', role: 'group', 'aria-label': 'Score this answer from 0 to 4' }, [...scoreButtons, noneButton])]),
      el('aside', {}, [el('h3', { text: 'The scoring guide' }), guideOut]),
    ]),
    el('div', { class: 'try-actions' }, [prev, next, reveal]), status,
  ]);

  // ── step 4: the readings ───────────────────────────────────────────────────
  const readingsBox = el('div', { class: 'try-readings', 'data-readings': '' });
  const sugar = el('p', { class: 'try-sugar', 'data-sugar': '', hidden: true });
  const reminder = el('p', { class: 'try-reminder', 'data-reminder': '', hidden: true, text: REMINDER });
  const figures = el('ul', { class: 'try-figures', 'data-figures': '', hidden: true });
  const mapping = el('ol', { class: 'try-mapping', 'data-mapping': '' });
  const rec = { date: el('span', { 'data-record-date': '' }), model: el('span', { 'data-record-model': '' }), prompt: el('pre', { 'data-record-prompt': '' }), guide: el('pre', { 'data-record-guide': '' }), hash: el('code', { 'data-record-hash': '' }), fake: el('p', { 'data-record-fake': '' }), scores: el('p', { 'data-record-scores': '' }), readings: el('div', { 'data-record-readings': '' }), sugar: el('p', { 'data-record-sugar': '', hidden: true }), reminder: el('p', { 'data-record-reminder': '', hidden: true, text: REMINDER }), figures: el('p', { 'data-record-figures': '' }) };
  const record = el('section', { class: 'try-record', 'data-record': '', 'aria-label': 'Your worksheet' }, [
    el('h3', { text: 'Your worksheet' }),
    el('p', {}, [document.createTextNode('Date: '), rec.date, document.createTextNode('. Model as typed: '), rec.model, document.createTextNode('.')]),
    el('h4', { text: 'The task' }), rec.prompt,
    el('h4', { text: 'The scoring guide' }), rec.guide,
    el('p', {}, [document.createTextNode('Instructions hash (sha256): '), rec.hash]), rec.fake,
    el('h4', { text: 'Scores by set' }), rec.scores,
    el('h4', { text: 'The readings' }), rec.readings, rec.sugar, rec.reminder, rec.figures,
    el('p', { class: 'try-fine', text: 'Read it beside the five limits printed below.' }),
  ]);
  const download = el('button', { type: 'button', 'data-download': '', text: 'Download as a Markdown file' });
  const print = el('button', { type: 'button', 'data-print': '', text: 'Print this sheet' });
  const result = el('section', { class: 'try-step', 'data-step': '4', 'data-result': '', hidden: true }, [
    el('h2', { text: 'Step 4. The readings' }), readingsBox, sugar, reminder, figures,
    el('h3', { text: 'Which was which' }), mapping, record,
    el('div', { class: 'try-actions' }, [download, print]),
  ]);
  const clear = el('button', { type: 'button', 'data-clear': '', text: 'Clear everything' });
  root.replaceChildren(announce, el('div', { class: 'try-bar' }, [clear]), step1, step2, deck, result);

  // ── behaviour ──────────────────────────────────────────────────────────────
  const taskOf = value => { const m = /^(.+)#([^#]+)$/.exec(value); if (!m) return null; const s = data.skills.find(x => x.repository + '/' + x.name === m[1]); const t = s && s.tasks.find(x => x.id === m[2]); return t ? { skill: s, task: t } : null; };
  const canLock = () => !!(prompt.value.trim() && guide.value.trim() && instructions.value.trim());
  const inPlay = () => ARMS.filter(([arm]) => arm !== 'fake' || fake);
  const armLabel = arm => ARMS.find(([a]) => a === arm)[1];
  const copyTexts = { with: () => draft.instructions + '\n\n' + draft.prompt, fake: () => fake.text + '\n\n' + draft.prompt, without: () => draft.prompt };
  const copyDone = { with: 'Copied the prompt with the instructions.', fake: 'Copied the prompt with the fake.', without: 'Copied the prompt with nothing added.' };
  function syncModel() { for (const n of modelNames) n.textContent = draft.model.trim() || 'not named'; }
  function syncLock() {
    lock.disabled = draft.locked || !canLock();
    for (const field of [prompt, guide, instructions, model]) field.disabled = draft.locked;
    taskSelect.disabled = draft.locked;
    locked.hidden = !draft.locked; step2.hidden = !draft.locked;
    if (draft.locked) { taskAsk.hidden = true; say(''); taskSelect.value = draft.task; textWith.textContent = copyTexts.with(); textWithout.textContent = copyTexts.without(); if (fake) textFake.textContent = copyTexts.fake(); }
  }
  function syncTask() {
    const picked = taskOf(draft.task);
    prompt.readOnly = !!picked; guide.readOnly = !!picked;
    taskLink.replaceChildren();
    if (picked) { taskLink.append('This task and its guide are the published ones. ', el('a', { href: picked.skill.href + '#' + picked.task.id, text: 'Read it on the tasks page' }), '.'); }
  }
  function showFake(refusal) {
    fakePanel.hidden = !fake; copyFake.hidden = !fake; fakeTexts.hidden = !fake; fakeSet.hidden = !fake;
    fakeInstructionsBytes.textContent = fake ? String(new TextEncoder().encode(draft.instructions).byteLength) : '';
    fakeBytes.textContent = fake ? String(fake.bytes) : '';
    fakeOpening.textContent = fake ? fake.text.slice(0, PLACEBO_OPENING.length) : '';
    fakeRefusal.hidden = !refusal;
    if (fakeRefusal.textContent !== refusal) { fakeRefusal.textContent = refusal; say(refusal); }
    step2Title.textContent = 'Step 2. Collect ' + (fake ? 'nine' : 'six') + ' answers';
    turnOff.textContent = fake ? turnOffWords : turnOffWords.replace('all nine answers', 'all six answers');
    if (draft.locked) syncLock();
  }
  // The fake is rebuilt from the instructions as they stand, never stored: a later build wins over a slower earlier one.
  async function rebuildFake() {
    const run = ++fakeRun, text = draft.instructions;
    let built = null, refusal = '';
    if (text) { try { built = await buildFake(new TextEncoder().encode(text), 'context'); } catch (error) { refusal = error.message; } }
    if (run !== fakeRun) return;
    fake = built; showFake(refusal);
  }
  function fill() {
    taskAsk.hidden = true; say(''); taskSelect.value = draft.task; prompt.value = draft.prompt; guide.value = draft.guide; instructions.value = draft.instructions; model.value = draft.model;
    for (const [arm] of ARMS) boxes[arm].forEach((b, i) => { b.value = draft.answers[arm][i] || ''; });
    syncTask(); syncModel(); syncLock();
  }
  function applyTask(value) {
    draft.task = value; const picked = taskOf(value);
    if (picked) { draft.prompt = picked.task.prompt; draft.guide = picked.task.rubric; } else { draft.prompt = ''; draft.guide = ''; }
    fill(); save(draft);
  }
  // A closed list fires change on every arrow key on Windows and Linux, so text the person typed is
  // never replaced here: the page asks, and only the explicit button replaces it.
  taskSelect.addEventListener('change', () => {
    if (!taskOf(draft.task) && (draft.prompt.trim() || draft.guide.trim())) { taskAsk.hidden = !taskSelect.value; say(taskSelect.value ? ASK : ''); return; }
    applyTask(taskSelect.value);
  });
  taskReplace.addEventListener('click', () => { applyTask(taskSelect.value); taskSelect.focus({ preventScroll: true }); });
  taskKeep.addEventListener('click', () => { fill(); taskSelect.focus({ preventScroll: true }); });
  for (const [field, key] of [[prompt, 'prompt'], [guide, 'guide'], [instructions, 'instructions'], [model, 'model']]) field.addEventListener('input', () => { draft[key] = field.value; if (key === 'model') syncModel(); if (key === 'instructions') rebuildFake(); syncLock(); save(draft); });
  for (const [arm] of ARMS) boxes[arm].forEach((b, i) => b.addEventListener('input', () => { draft.answers[arm][i] = b.value; save(draft); }));
  lock.addEventListener('click', async () => {
    if (!canLock()) return;
    // Focus moves to the turn-off step before Lock disables itself, so it is heard and the next Tab reaches the copy buttons.
    locked.hidden = false; turnOff.focus();
    draft.locked = true; save(draft); syncLock();
    hash = await sha256Hex(draft.instructions); hashOut.textContent = hash.slice(0, 12) + (hash.length > 12 ? '…' : '');
    await rebuildFake();
  });
  for (const button of locked.querySelectorAll('[data-copy]')) button.addEventListener('click', async e => {
    e.stopPropagation();
    const arm = button.dataset.copy;
    try { await navigator.clipboard.writeText(copyTexts[arm]()); copyStatus.textContent = copyDone[arm]; }
    catch { copyStatus.textContent = 'Copy is unavailable. Open the exact texts below, select one and copy it yourself.'; locked.querySelector('details').open = true; }
  });

  function draw() {
    const item = order[current];
    progress.textContent = 'Answer ' + (current + 1) + ' of ' + order.length;
    pane.innerHTML = renderAnswer(item.text); pane.scrollTop = 0;
    for (const b of [...scoreButtons, noneButton]) b.setAttribute('aria-pressed', String(scores[current] === b.dataset.score));
    // Marked unavailable, never disabled: a focused button that disables itself drops keyboard focus.
    prev.setAttribute('aria-disabled', String(current === 0)); next.setAttribute('aria-disabled', String(current >= order.length - 1));
    const done = scores.filter(s => s !== undefined).length;
    reveal.disabled = revealed || done < order.length;
    status.textContent = revealed ? 'Revealed. Scroll down for the reading.' : done + ' of ' + order.length + ' scored.' + (done < order.length ? ' Reveal opens when every answer has a score.' : ' Reveal when you are ready.');
  }
  start.addEventListener('click', () => {
    const items = [];
    for (const [arm] of inPlay()) draft.answers[arm].forEach((text, i) => { if (text.trim()) items.push({ arm, index: i + 1, text }); });
    if (!items.length) { startNote.textContent = 'Paste at least one answer first.'; return; }
    order = shuffle(items); scores = new Array(order.length); current = 0; revealed = false;
    guideOut.textContent = draft.guide;
    step1.hidden = true; step2.hidden = true; deck.hidden = false; result.hidden = true;
    draw(); pane.focus({ preventScroll: true });
  });
  for (const b of [...scoreButtons, noneButton]) b.addEventListener('click', () => { if (revealed) return; scores[current] = b.dataset.score; draw(); });
  prev.addEventListener('click', () => { if (current > 0) { current--; draw(); } });
  next.addEventListener('click', () => { if (current < order.length - 1) { current++; draw(); } });

  const scoreWord = s => (s === 'none' ? 'cannot score' : s);
  function byArm(arm) { return [1, 2, 3].map(i => { const k = order.findIndex(o => o.arm === arm && o.index === i); return k < 0 ? null : scores[k]; }).filter(s => s !== null); }
  // Figures per arm for each arm in a reading that is not too few; a direction per separated reading.
  function figureLines(read) {
    const open = read.filter(({ r }) => r.state !== 'too_few');
    if (!open.length) return [];
    const perArm = new Map();
    for (const { a, b, r } of open) { perArm.set(a, r.with); perArm.set(b, r.without); }
    const lines = ARMS.filter(([arm]) => perArm.has(arm)).map(([arm, label]) => { const f = perArm.get(arm); return label + ': average ' + two(f.mean) + ' of ' + SCALE + ', spread ' + two(f.stddev) + ', from ' + f.n + ' scored answers.'; });
    for (const { a, b, r } of open) if (r.direction) lines.push('The set ' + armLabel(a).toLowerCase() + ' sat ' + r.direction + ' than the set ' + armLabel(b).toLowerCase() + '.');
    lines.push('The floor is ' + EFFECT_FLOOR + ' on the library’s 0 to 1 scale, which is ' + (EFFECT_FLOOR * SCALE) + ' of a point on this guide. Your 0 to ' + SCALE + ' scores were read divided by ' + SCALE + '.');
    return lines;
  }
  reveal.addEventListener('click', () => {
    if (revealed || scores.some(s => s === undefined)) return;
    revealed = true; draw();
    const numeric = arm => byArm(arm).filter(s => s !== 'none').map(s => Number(s) / SCALE);
    const playing = new Set(inPlay().map(([arm]) => arm));
    const read = READINGS.filter(([, a, b]) => playing.has(a) && playing.has(b)).map(([id, a, b, title]) => ({ id, a, b, title, r: readArms(numeric(a), numeric(b), EFFECT_FLOOR, MIN_PER_ARM) }));
    const lines = figureLines(read);
    const readingLines = read.map(({ title, r }) => title + ': ' + SENTENCES[r.state]);
    const againstFake = read.find(({ id }) => id === 'with-fake');
    const sugarText = againstFake ? 'Against the same-length fake (' + fake.bytes + ' bytes): ' + SENTENCES[againstFake.r.state] : '';
    // The reminder speaks to instructions that scored clearly above the fake, and to no other result.
    const beatFake = !!againstFake && againstFake.r.state === 'separated' && againstFake.r.direction === 'higher';
    readingsBox.replaceChildren(...read.map(({ id, title, r }) => el('div', { class: 'try-reading', 'data-reading': id }, [el('h3', { text: title }), el('p', { class: 'try-sentence', 'data-sentence': '', text: SENTENCES[r.state] })])));
    sugar.textContent = sugarText; sugar.hidden = !sugarText; reminder.hidden = !beatFake;
    figures.replaceChildren(...lines.map(t => el('li', { text: t }))); figures.hidden = !lines.length;
    mapping.replaceChildren(...order.map((o, k) => el('li', { text: 'Answer ' + (k + 1) + ': ' + armLabel(o.arm) + ', answer ' + o.index + '. Score: ' + scoreWord(scores[k]) + (scores[k] === 'none' ? '' : ' of ' + SCALE) + '.' })));
    const scoreLines = inPlay().map(([arm, label]) => label + ': ' + byArm(arm).map(scoreWord).join(', '));
    rec.date.textContent = today(); rec.model.textContent = draft.model.trim() || 'not named';
    rec.prompt.textContent = draft.prompt; rec.guide.textContent = draft.guide; rec.hash.textContent = hash || 'unavailable';
    if (fake) rec.fake.replaceChildren('The fake: ', el('span', { 'data-record-fake-bytes': '', text: String(fake.bytes) }), ' bytes. Fake hash (sha256): ', el('code', { 'data-record-fake-hash': '', text: fake.sha256 }), '.');
    else rec.fake.textContent = NO_FAKE;
    rec.scores.replaceChildren(...scoreLines.flatMap((line, i) => (i ? [el('br'), line] : [line])));
    rec.readings.replaceChildren(...readingLines.map(t => el('p', { text: t })));
    rec.sugar.textContent = sugarText; rec.sugar.hidden = !sugarText; rec.reminder.hidden = !beatFake;
    rec.figures.textContent = lines.join(' ');
    result.hidden = false; step1.hidden = false; step2.hidden = false;
    result.querySelector('h2').focus({ preventScroll: true }); result.scrollIntoView({ block: 'start' });
    const fakeLine = fake ? 'The fake: ' + fake.bytes + ' bytes. Fake hash (sha256): ' + fake.sha256 : NO_FAKE;
    download.onclick = () => {
      const md = ['# Driftproof worksheet: Try it yourself', '', '- Date: ' + today(), '- Model as typed: ' + (draft.model.trim() || 'not named'), '', '## The task', '', draft.prompt, '', '## The scoring guide', '', draft.guide, '', '- Instructions hash (sha256): ' + (hash || 'unavailable'), '- ' + fakeLine, '', '## Scores by set', '', ...scoreLines.map(t => '- ' + t), '', '## The readings', '', ...readingLines.map(t => '- ' + t), ...(sugarText ? ['', sugarText] : []), ...(beatFake ? ['', REMINDER] : []), ...(lines.length ? [''] : []), ...lines.map(t => '- ' + t), '', '## Read this beside the result', '', ...caveats.map(c => '- ' + c), '', 'Made on https://driftproofhq.com/try-it/ . Nothing was sent anywhere; this file was written by your own browser.', ''].join('\n');
      const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
      const a = el('a', { href: url, download: 'driftproof-try-it-' + today() + '.md' }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  });
  result.querySelector('h2').tabIndex = -1;
  print.addEventListener('click', () => window.print());
  clear.addEventListener('click', () => {
    forget(); draft = fresh(); order = []; scores = []; current = 0; revealed = false; hash = '';
    hashOut.textContent = ''; copyStatus.textContent = ''; startNote.textContent = 'Fewer than three answers in a set reads as too few to tell.';
    deck.hidden = true; result.hidden = true; step1.hidden = false; fill(); rebuildFake(); taskSelect.focus({ preventScroll: true });
  });
  fill();
  if (draft.instructions) await rebuildFake();
  if (draft.locked) { hash = await sha256Hex(draft.instructions); hashOut.textContent = hash.slice(0, 12) + '…'; }
}
