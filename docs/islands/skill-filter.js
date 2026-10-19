// SPDX-License-Identifier: Apache-2.0
//
// docs/islands/skill-filter.js - the filters of the skill index's list page, as an island (spec 267
// AC-12, spec 020 AC-32).
//
// The page is complete before this runs: the build writes every entry into the list, so with
// JavaScript off a reader sees them all, and the mount point's own paragraph is its static fallback
// (spec 020 AC-34). Mounted, this adds three selects to the mount point, before the list that follows
// it, by source, by evidence state and by freshness, and hides each entry whose data-source,
// data-evidence or data-freshness holds no value a select asks for. It reads only those
// attributes, which the build writes from each entry's rows; it adds no word of its own about a
// skill, and it converts no date.
const FILTERS = [
  ['source', 'Source', [['driftproof', 'Driftproof'], ['skill-placebo', 'skill-placebo'], ['nvidia', 'NVIDIA']]],
  ['evidence', 'Evidence', [['measured', 'Measured by Driftproof'], ['recomputed', 'Recomputed from published trials'], ['aggregates-only', 'NVIDIA\'s figures']]],
  ['freshness', 'Freshness', [['newer', 'Newer models since'], ['no-newer', 'No newer model listed'], ['unknown', 'Freshness unknown']]],
];

export function mount(el) {
  const list = el.nextElementSibling;
  if (el.dataset.mounted || !list || !list.matches('ul.skill-list')) return;
  el.dataset.mounted = 'true';
  const entries = [...list.querySelectorAll('li.skill-entry')];
  const form = document.createElement('form');
  form.className = 'skill-filters';
  form.setAttribute('role', 'search');
  const selects = FILTERS.map(([key, label, options]) => {
    const wrap = document.createElement('label');
    wrap.textContent = `${label} `;
    const select = document.createElement('select');
    select.name = key;
    for (const [value, text] of [['', 'Any'], ...options]) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      select.append(o);
    }
    wrap.append(select);
    form.append(wrap, ' ');
    return select;
  });
  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'Find a skill or repository';
  const search = document.createElement('input'); search.type = 'search'; search.name = 'skill';
  searchLabel.append(search); form.prepend(searchLabel);
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Clear filters';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  form.append(reset, status);
  const apply = () => {
    for (const li of entries) {
      li.hidden = !(li.dataset.page || '').toLowerCase().includes(search.value.trim().toLowerCase()) || !selects.every((s) => !s.value || (li.dataset[s.name] || '').split(' ').includes(s.value));
    }
    status.textContent = entries.some(li => !li.hidden) ? '' : 'No skills match these filters.';
  };
  search.addEventListener('input', apply);
  reset.addEventListener('click', () => { search.value = ''; selects.forEach(s => { s.value = ''; }); apply(); });
  form.addEventListener('change', apply);
  form.addEventListener('submit', (e) => e.preventDefault());
  el.append(form);
}
