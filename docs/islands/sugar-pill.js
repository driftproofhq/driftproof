// SPDX-License-Identifier: Apache-2.0
//
// Issue 688: the sugar pill page's picker (spec 688 AC-8, spec 020 AC-32, AC-34).
//
// The page is complete before this runs: every chip is a link to its group's heading and every
// skill's card is on the page, closed, with its readings inside. Mounted, this turns the chips into
// filter buttons, adds a search box that finds a skill by name, hides the cards a chip or a search
// does not match, opens the one card a search leaves, and marks a card live when it opens so the
// stylesheet can draw its bars in. It reads only the page: it makes no request, stores nothing and
// writes no address. Every word it writes is a label of its own, never a reading or a count.
export function mount(el) {
  if (el.dataset.mounted) return;
  const nav = el.querySelector('nav.pill-chips');
  const groups = [...el.querySelectorAll('section.pill-group')];
  const cards = [...el.querySelectorAll('details.pill-card')];
  if (!nav || !groups.length || !cards.length) return;
  const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  const chips = [{ id: '', label: 'All skills' }, ...[...nav.querySelectorAll('a[href^="#"]')].map((a) => ({ id: a.getAttribute('href').slice(1), label: a.textContent.trim() }))];
  let current = '';
  const bar = make('div', 'pill-chipbar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', nav.getAttribute('aria-label') || 'Groups');
  const buttons = chips.map((c) => {
    const b = make('button', '', c.label);
    b.type = 'button';
    b.dataset.group = c.id;
    b.addEventListener('click', () => { current = c.id; apply(); });
    return b;
  });
  bar.append(...buttons);

  const form = make('form', 'pill-search');
  form.setAttribute('role', 'search');
  form.addEventListener('submit', (e) => e.preventDefault());
  const label = make('label', '', 'Find a skill by name');
  const input = make('input');
  input.type = 'search'; input.name = 'skill'; input.autocomplete = 'off'; input.spellcheck = false;
  label.append(input);
  const status = make('p', 'pill-status');
  status.setAttribute('role', 'status');
  form.append(label, status);
  nav.replaceWith(bar);
  bar.after(form);

  // A card is live a frame after it opens, so the guarded transition in the stylesheet runs once.
  const live = (card) => {
    card.classList.remove('is-live');
    if (card.open) requestAnimationFrame(() => requestAnimationFrame(() => { if (card.open) card.classList.add('is-live'); }));
  };
  for (const card of cards) card.addEventListener('toggle', () => live(card));

  const apply = () => {
    const q = input.value.trim().toLowerCase();
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.group === current));
    const shown = [];
    for (const g of groups) {
      let any = false;
      for (const card of g.querySelectorAll('details.pill-card')) {
        const hit = (!current || g.id === current) && (!q || (card.dataset.skill || '').toLowerCase().includes(q));
        card.hidden = !hit;
        if (hit) { any = true; shown.push(card); }
      }
      g.hidden = !any;
    }
    if (q && shown.length === 1 && !shown[0].open) shown[0].open = true;
    const chip = chips.find((c) => c.id === current);
    status.textContent = shown.length === 0 ? 'No skill has that name. Try fewer letters, or pick a group.'
      : q ? `Skills whose name has "${q}"${current ? `, under ${chip.label}` : ''}.`
        : current ? `Showing ${chip.label}.` : 'Showing every skill. Pick a group, or type a name.';
  };
  input.addEventListener('input', apply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; apply(); } });

  // A link to one card (#skill-name) opens it. The address is read, never written.
  if (/^#skill-[\w-]+$/.test(location.hash)) {
    const target = el.querySelector(`details.pill-card${location.hash}`);
    if (target) target.open = true;
  }
  el.classList.add('is-mounted');
  el.dataset.mounted = 'true';
  apply();
}
