// SPDX-License-Identifier: Apache-2.0
// All evidence is embedded by the builder. Only choices and their tally live here.
const WORDS = {
  'separated-up': 'the skill scored clearly higher.',
  'separated-down': 'the skill scored clearly lower.',
  'not-separated': 'no clear difference detected at this sample size.',
  underpowered: 'too few answers to tell.',
  inconclusive: 'inconclusive on the lost answers.',
};
const LABELS = { with_skill: 'With the skill', placebo: 'With the fake', baseline: 'With nothing' };
const n3 = n => n.toFixed(3);
function element(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function strip(arm) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 300 34'); svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => { const el = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); svg.append(el); };
  const x = n => 8 + n * 284;
  add('line', { x1: 8, x2: 292, y1: 17, y2: 17, class: 'fake-track' });
  for (const value of [0, .25, .5, .75, 1]) add('line', { x1: x(value), x2: x(value), y1: 12, y2: 22, class: 'fake-tick' });
  add('line', { x1: x(arm.lo), x2: x(arm.hi), y1: 17, y2: 17, class: 'fake-range' });
  add('circle', { cx: x(arm.mean), cy: 17, r: 5, class: 'fake-mean' });
  return svg;
}
export function mount(el) {
  const data = JSON.parse(el.getAttribute('data-game'));
  let index = 0, correct = 0, picked = false;
  const live = element('p', '', { class: 'fake-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const screen = element('div', null);
  el.replaceChildren(screen, live);
  function finish() {
    const title = element('h2', 'You spotted ' + correct + ' of ' + data.rounds.length + '.', { 'data-tally': '', tabindex: '-1' });
    const restart = element('button', 'Play again', { type: 'button', class: 'fake-next', 'data-restart': '' });
    restart.addEventListener('click', () => { index = 0; correct = 0; show(true); });
    screen.replaceChildren(element('p', 'Labels revealed', { class: 'fake-eyebrow' }), title,
      element('p', 'The fake can be hard to spot. A high score alone does not tell you what helped.'),
      element('p', 'This is your tally for this visit, not a score for any skill. No verdict moved.'), restart,
      element('a', 'Explore the reports →', { href: '/reports/', class: 'fake-explore' }));
    screen.className = 'fake-finish'; live.textContent = title.textContent; title.focus();
  }
  function show(focus = false) {
    if (index === data.rounds.length) { finish(); return; }
    const round = data.rounds[index]; picked = false; screen.className = ''; live.textContent = '';
    const progress = element('p', 'Round ' + (index + 1) + ' of ' + data.rounds.length, { 'data-progress': '', class: 'fake-progress' });
    const progressBar = element('progress', null, { max: data.rounds.length, value: index, 'aria-label': 'Rounds completed' });
    const top = element('div', null, { class: 'fake-game-top' }); top.append(progress, progressBar);
    const title = element('h2', round.skill.replaceAll('-', ' '), { 'data-task-title': '', tabindex: '-1' });
    const context = element('p', 'Report ' + round.report + ' · ' + round.modelName, { class: 'fake-context' });
    const task = element('div', null, { class: 'fake-task' });
    // Mark an excerpt as an opening; the full task remains verbatim in the disclosure.
    const prompt = round.prompt.replace(/^Do not use tools, access the network, write files, run commands or install anything. Answer only in text using the supplied facts\.\s*/, '');
    const opening = prompt.length > 175 ? prompt.slice(0, prompt.lastIndexOf(' ', 175)) + '…' : prompt;
    task.append(element('p', 'Task opening', { class: 'fake-kicker' }), element('p', opening));
    const details = element('details', null, { class: 'fake-full-task' });
    details.append(element('summary', 'Read the full task'), element('p', round.prompt)); task.append(details);
    const choices = element('div', null, { class: 'fake-choices', role: 'group', 'aria-label': 'Which bar is the fake?' });
    const axis = element('p', null, { class: 'fake-axis', 'aria-hidden': 'true' });
    axis.append(element('span', '0 · lower score'), element('span', '1 · higher score'));
    const reveal = element('section', null, { 'data-reveal': '', class: 'fake-reveal', hidden: '' });
    const feedback = element('h3', '', { 'data-feedback': '' });
    const fake = element('p', 'Against the fake: ' + WORDS[round.readings.fake], { 'data-fake-state': '', 'data-state': round.readings.fake });
    const none = element('p', 'Against nothing: ' + WORDS[round.readings.none], { 'data-none-state': '', 'data-state': round.readings.none });
    const receipt = element('a', 'Read this receipt ↗', { href: round.receipt, 'data-receipt': '', target: '_blank', rel: 'noopener' });
    const next = element('button', index === data.rounds.length - 1 ? 'See my tally →' : 'Next round →', { type: 'button', 'data-next': '', class: 'fake-next' });
    next.addEventListener('click', () => { if (!picked) return; index += 1; show(true); });
    reveal.append(feedback, fake, none, element('p', round.reminder, { class: 'fake-reminder' }), receipt, next);
    round.arms.forEach((arm, i) => {
      const name = 'Bar ' + String.fromCharCode(65 + i);
      const button = element('button', null, { type: 'button', 'data-choice': '', class: 'fake-choice', 'aria-label': name + ', average ' + n3(arm.mean) + ', spread ' + n3(arm.sd) + '. Pick as the fake.' });
      const label = element('span', name, { class: 'fake-bar-label' });
      button.append(label, strip(arm), element('span', 'Pick', { class: 'fake-pick-label', 'aria-hidden': 'true' }));
      button.addEventListener('click', () => {
        if (picked) return;
        picked = true;
        if (arm.mode === 'placebo') correct += 1;
        [...choices.children].forEach((choice, j) => {
          const a = round.arms[j]; choice.setAttribute('aria-disabled', 'true'); choice.setAttribute('data-mode', a.mode);
          choice.querySelector('.fake-bar-label').textContent = LABELS[a.mode];
          choice.querySelector('.fake-pick-label').textContent = a.mode === 'placebo' ? 'The fake' : j === i ? 'Your pick' : '';
          choice.setAttribute('aria-label', LABELS[a.mode] + ', average ' + n3(a.mean) + ', spread ' + n3(a.sd) + (j === i ? '. Your pick.' : '.'));
          choice.append(element('span', n3(a.mean) + ' ± ' + n3(a.sd), { class: 'fake-numbers' }));
        });
        feedback.textContent = arm.mode === 'placebo' ? 'You spotted it!' : 'Surprise. The fake was bar ' + String.fromCharCode(65 + round.arms.findIndex(a => a.mode === 'placebo')) + '.';
        reveal.hidden = false;
        live.textContent = feedback.textContent + ' ' + fake.textContent + ' ' + none.textContent + ' ' + round.reminder;

      });
      choices.append(button);
    });
    const scope = element('p', round.scope, { 'data-scope': '', class: 'fake-scope' });
    const limitation = element('p', round.limitation || 'Scored by ' + round.judgeName + ', a separate model.', { 'data-limitation': '', class: 'fake-limitation' });
    screen.replaceChildren(top, context, title, task, axis, choices, reveal, limitation, scope);
    if (focus) { title.focus({ preventScroll: true }); title.scrollIntoView({ block: 'center', behavior: 'instant' }); }
  }
  show();
}
