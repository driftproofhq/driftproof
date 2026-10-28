// SPDX-License-Identifier: Apache-2.0
//
// docs/islands/grader-quiz.js - "which answer is correct?", on /invisible-space/.
//
// The page is complete before this runs: the task, both answers and the answer itself (inside a
// <details>) are static HTML, so with scripts off the reader still gets the whole story. Mounting
// adds two buttons to pick an answer, the verdict for that pick, and an X-ray switch.
//
// The X-ray covers the whole article, not only the quiz: the page's own text carries no-break
// spaces where a typesetter would put them ("28 October", "Haiku 5.5", one in the headline), and
// showing those beside the ones in the answers is the point the article makes. Each text node that
// holds U+00A0 is swapped for a span that shows the character as a chip; switching off puts the
// original text node back, byte for byte. Nothing is sent anywhere and nothing is stored.
const NBSP = '\u00a0';
// A word joiner either side of each chip keeps the words the no-break space held together on one line.
const WJ = '\u2060';

function nbspNodes(root) {
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.includes(NBSP) && !n.parentElement.closest('.grader-xray, script, style')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walk.nextNode()) out.push(walk.currentNode);
  return out;
}

function xrayOn(root) {
  let inCode = 0;
  let inText = 0;
  for (const node of nbspNodes(root)) {
    const wrap = document.createElement('span');
    wrap.className = 'xray-wrap';
    const n = node.nodeValue.split(NBSP).length - 1;
    if (node.parentElement.closest('pre')) inCode += n; else inText += n;
    const parts = node.nodeValue.split(NBSP);
    parts.forEach((part, i) => {
      if (i > 0) {
        const m = document.createElement('mark');
        m.className = 'grader-nbsp';
        m.title = 'U+00A0 NO-BREAK SPACE';
        m.textContent = 'NBSP';
        wrap.append(m);
      }
      wrap.append(document.createTextNode((i > 0 ? WJ : '') + part + (i < parts.length - 1 ? WJ : '')));
    });
    wrap.xrayOriginal = node;
    node.replaceWith(wrap);
  }
  return { inCode, inText };
}

function xrayOff(root) {
  for (const wrap of root.querySelectorAll('span.xray-wrap')) wrap.replaceWith(wrap.xrayOriginal);
}

const VERDICT = {
  a: '<p class="grader-verdict-head">Correct. A is the right answer.</p>'
    + '<p>Most of the Claude graders we tested got this wrong. X-ray is now on: the third test in each answer does not use ordinary spaces. They are no-break spaces, which the task says to refuse. A refuses them. B accepts them.</p>',
  b: '<p class="grader-verdict-head">B is wrong. Most of the Claude graders we tested passed it too.</p>'
    + '<p>X-ray is now on: the third test in each answer does not use ordinary spaces. They are no-break spaces, which the task says to refuse. A refuses them, so its test says False. B quietly accepts them. A only looked contradictory.</p>',
};

export function mount(el) {
  if (el.dataset.mounted) return;
  const main = el.closest('main') || document.body;
  const controls = el.querySelector('.grader-controls');
  const out = el.querySelector('.grader-verdict');
  const xray = el.querySelector('.grader-xray');
  const toggle = xray && xray.querySelector('input');
  const count = xray && xray.querySelector('.grader-xray-count');
  if (!controls || !out || !toggle) return;
  el.dataset.mounted = '1';

  const setXray = (on) => {
    toggle.checked = on;
    xrayOff(main);
    if (!on) { if (count) count.textContent = ''; main.classList.remove('is-xray'); return; }
    const found = xrayOn(main);
    main.classList.add('is-xray');
    if (count) {
      const total = found.inCode + found.inText;
      count.textContent = `${total} found: ${found.inCode} in the answers, ${found.inText} in this page's own text, including the headline.`;
    }
  };

  const pick = (choice) => {
    for (const b of controls.querySelectorAll('button[data-pick]')) b.setAttribute('aria-pressed', String(b.dataset.pick === choice));
    out.className = `grader-verdict ${choice === 'a' ? 'is-right' : 'is-wrong'}`;
    out.innerHTML = VERDICT[choice];
    out.hidden = false;
    setXray(true);
    const fallback = el.querySelector('details.grader-answer-key');
    if (fallback) fallback.hidden = true;
  };

  for (const b of controls.querySelectorAll('button[data-pick]')) b.addEventListener('click', () => pick(b.dataset.pick));
  toggle.addEventListener('change', () => setXray(toggle.checked));
  controls.hidden = false;
  xray.hidden = false;

}
