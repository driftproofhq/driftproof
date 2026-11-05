// SPDX-License-Identifier: Apache-2.0
//
// Issue 691: the cards on /noticed/, one at a time. Without this file the page shows every card,
// stacked; with it, Previous and Next and the left and right arrow keys flip through them, a line
// says which card is shown, and the shown card takes focus. Everything shown is already in the page,
// so flipping makes no request and stores nothing.
export function mount(el) {
  const cards = [...el.querySelectorAll('article[data-card]')];
  if (cards.length < 2) return;
  const button = (label, key) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset[key] = '';
    return b;
  };
  const navs = [];
  const nav = (live) => {
    const n = document.createElement('nav');
    n.className = 'deck-nav'; n.setAttribute('aria-label', 'Cards'); n.dataset.deckNav = '';
    const prev = button('Previous', 'deckPrev'), next = button('Next', 'deckNext');
    const count = document.createElement('p');
    count.className = 'deck-count'; count.dataset.deckCount = '';
    if (live) count.setAttribute('aria-live', 'polite');
    n.append(prev, count, next);
    prev.addEventListener('click', () => show(at - 1, true));
    next.addEventListener('click', () => show(at + 1, true));
    navs.push({ prev, next, count });
    return n;
  };
  let at = 0;
  const top = nav(true), bottom = nav(false);
  const show = (i, focus) => {
    if (i < 0 || i >= cards.length) return;
    at = i;
    cards.forEach((c, k) => { c.hidden = k !== i; });
    for (const n of navs) {
      n.count.textContent = 'Card ' + (i + 1) + ' of ' + cards.length;
      n.prev.disabled = i === 0;
      n.next.disabled = i === cards.length - 1;
    }
    const card = cards[i];
    // The turn: a class the stylesheet moves only inside its reduced-motion guard, removed a frame
    // later so the card settles; with less motion asked for the class changes nothing.
    card.classList.add('is-turning');
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('is-turning')));
    if (focus) {
      card.focus({ preventScroll: true });
      if (top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
    }
  };
  const hint = document.createElement('p');
  hint.className = 'deck-hint';
  hint.textContent = 'Flip with Previous and Next, or with the left and right arrow keys.';
  el.prepend(top, hint);
  el.append(bottom);
  el.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target && e.target.closest && e.target.closest('a, summary, input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowRight') { show(at + 1, true); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { show(at - 1, true); e.preventDefault(); }
  });
  el.classList.add('is-deck');
  show(0, false);
}
