// SPDX-License-Identifier: Apache-2.0
//
// Issue 640: the walk-through, one screen at a time. Without this file the page shows all five
// screens stacked; with it, Next and Back move between them and the new screen's heading takes focus.
// Everything shown is already in the page, so stepping makes no request and stores nothing.
export function mount(el) {
  const steps = [...el.querySelectorAll('section[data-step]')];
  if (steps.length < 2) return;
  const button = (label, key) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset[key] = '';
    return b;
  };
  const nav = document.createElement('nav');
  nav.className = 'how-nav'; nav.setAttribute('aria-label', 'Steps'); nav.dataset.howNav = '';
  const back = button('Back', 'howBack'), next = button('Next', 'howNext');
  const count = document.createElement('p');
  count.className = 'how-count'; count.dataset.howCount = ''; count.setAttribute('aria-live', 'polite');
  nav.append(back, count, next);
  el.append(nav);
  let at = 0;
  const show = (i, focus) => {
    at = i;
    steps.forEach((s, k) => { s.hidden = k !== i; });
    count.textContent = `Step ${i + 1} of ${steps.length}`;
    back.disabled = i === 0;
    next.disabled = i === steps.length - 1;
    if (focus) {
      const heading = steps[i].querySelector('h2');
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start' });
    }
  };
  back.addEventListener('click', () => show(at - 1, true));
  next.addEventListener('click', () => show(at + 1, true));
  // A link to a screen or its heading elsewhere on the page (the "On this page" list) opens that
  // screen. The default is prevented, so the address keeps no fragment and no view is counted again.
  for (const a of document.querySelectorAll('a[href^="#step-"]')) {
    const target = a.getAttribute('href').slice(1);
    const i = steps.findIndex((s) => s.id === target || s.querySelector('h2').id === target);
    if (i >= 0) a.addEventListener('click', (e) => { e.preventDefault(); show(i, true); });
  }
  el.classList.add('is-stepped');
  show(0, false);
}
