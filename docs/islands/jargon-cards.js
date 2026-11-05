// SPDX-License-Identifier: Apache-2.0
//
// Spec 689: the plain-word cards. Without this file every marker on the page is a link to its glossary
// entry, and the note under the page says so. With it, a tap, a click or keyboard focus on a marker opens a
// small card beside the word, with the entry's name, its plain line and the link; Escape or a tap elsewhere
// closes it and focus goes back to the word. Everything the card says is already on the marker (data-name,
// data-plain, href): this file reads the page and nothing else, sends nothing and stores nothing.
const CARD = 'jargon-card';
const SHEET_WIDTH = 640;
const GAP = 8;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

export function mount(root) {
  const marks = [...document.querySelectorAll('a.term[data-plain]')];
  if (!marks.length) return;
  const note = root.querySelector('.jargon-note');
  if (note) note.textContent = 'Tap or click a word with a dotted line for a note in plain words.';

  // One card, moved next to whichever marker opened it, so Tab goes from the word into the card. The top
  // layer (popover) keeps it clear of any tilted or clipped ancestor; a browser without it gets a fixed box.
  const card = el('span', CARD);
  card.setAttribute('role', 'dialog');
  card.id = 'jargon-card';
  const eyebrow = el('span', 'jargon-card-eyebrow', 'In plain words');
  const title = el('strong', 'jargon-card-title'); title.id = 'jargon-card-title';
  const body = el('span', 'jargon-card-text'); body.id = 'jargon-card-text';
  const links = el('span', 'jargon-card-links');
  const more = el('a', 'jargon-card-more', 'Read the glossary entry');
  const close = el('button', 'jargon-card-close', 'Close'); close.type = 'button';
  links.append(more, close);
  card.append(eyebrow, title, body, links);
  card.setAttribute('aria-labelledby', title.id);
  const popover = typeof card.showPopover === 'function';
  if (popover) card.setAttribute('popover', 'manual');
  let open = null;
  let openedAt = 0;
  let restoring = false;

  const place = () => {
    if (!open) return;
    const sheet = window.innerWidth < SHEET_WIDTH;
    card.classList.toggle('is-sheet', sheet);
    if (sheet) { card.style.left = ''; card.style.top = ''; return; }
    const r = open.getBoundingClientRect();
    const w = card.offsetWidth; const h = card.offsetHeight;
    const left = Math.max(GAP, Math.min(r.left, window.innerWidth - w - GAP));
    let top = r.bottom + GAP;
    if (top + h > window.innerHeight - GAP) top = Math.max(GAP, r.top - h - GAP);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  };
  const show = (mark) => {
    if (open === mark) return;
    if (open) hide(false);
    open = mark;
    openedAt = performance.now();
    title.textContent = mark.dataset.name;
    body.textContent = mark.dataset.plain;
    more.href = mark.getAttribute('href');
    mark.after(card);
    mark.setAttribute('aria-expanded', 'true');
    mark.setAttribute('aria-describedby', body.id);
    if (popover) card.showPopover(); else card.classList.add('is-open');
    place();
  };
  const hide = (refocus) => {
    if (!open) return;
    const mark = open;
    open = null;
    if (popover) { try { card.hidePopover(); } catch { /* already hidden */ } } else card.classList.remove('is-open');
    card.remove();
    mark.setAttribute('aria-expanded', 'false');
    mark.removeAttribute('aria-describedby');
    // Focus goes back to the word without reopening the card: the focus handler sees the flag.
    if (refocus) { restoring = true; mark.focus({ preventScroll: true }); restoring = false; }
  };

  for (const mark of marks) {
    mark.setAttribute('aria-expanded', 'false');
    mark.setAttribute('aria-haspopup', 'dialog');
    // A tap or a click toggles the card instead of leaving the page; the glossary stays one link away,
    // inside the card. Focus opens it without taking focus, so a keyboard reader hears the word first.
    // A press focuses the link before its click arrives, so a card the same press has just opened stays
    // open; a later click on the open word closes it.
    mark.addEventListener('click', (e) => {
      e.preventDefault();
      if (open === mark && performance.now() - openedAt > 500) hide(true); else show(mark);
    });
    mark.addEventListener('focus', () => { if (!restoring) show(mark); });
  }
  close.addEventListener('click', () => hide(true));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    hide(true);
  });
  // Focus that leaves both the word and its card closes the card; a pointer down anywhere else does too.
  document.addEventListener('focusin', (e) => { if (open && e.target !== open && !card.contains(e.target)) hide(false); });
  document.addEventListener('pointerdown', (e) => { if (open && e.target !== open && !open.contains(e.target) && !card.contains(e.target)) hide(false); }, true);
  let frame = 0;
  const replace = () => { if (!open || frame) return; frame = requestAnimationFrame(() => { frame = 0; place(); }); };
  window.addEventListener('scroll', replace, { passive: true });
  window.addEventListener('resize', replace);
}
