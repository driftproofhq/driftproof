// SPDX-License-Identifier: Apache-2.0
//
// docs/islands/benchmark-gap.js - the benchmark gap calculator, as an island (spec 170, issue 50).
//
// The page is complete before this runs: the build writes the opening example into it (the preset,
// the two scores, the question count and the result card), with the same renderer this file calls,
// gap.js's CALC.render. So with no query string, mounting changes nothing a reader sees, and the
// first paint is the final one. A query string replaces the example; every keystroke after that
// re-renders the tab it is typed in.
//
// The loader imports this module after the page has parsed, so nothing here waits for a load event.
// gap.js is a plain script that also serves tests/benchmark-gap.test.js through require; imported as
// a module it cannot export, so it hands its CALC to the page as globalThis.driftproofGap.
import '/benchmark-gap/gap.js';

export function mount(el) {
  const CALC = globalThis.driftproofGap;
  if (!CALC || !CALC.render || el.dataset.mounted) return;
  const root = el.closest('.gap-tool') || document;
  const Q = (sel) => root.querySelector(sel);
  const QA = (sel) => [...root.querySelectorAll(sel)];
  const field = (id) => Q(`#${id}`);
  const tabs = QA('.gap-tab');
  const panels = { items: Q('#gap-panel-items'), runs: Q('#gap-panel-runs') };
  const itemsOut = el;
  const runsOut = Q('#gap-runs-out');
  const runFields = { aMean: 'gap-runs-a-mean', aSd: 'gap-runs-a-sd', aN: 'gap-runs-a-n', bMean: 'gap-runs-b-mean', bSd: 'gap-runs-b-sd', bN: 'gap-runs-b-n' };

  const renderItems = () => { itemsOut.innerHTML = CALC.render.items(field('gap-score-a').value, field('gap-score-b').value, field('gap-n').value); };
  const renderRuns = () => { runsOut.innerHTML = CALC.render.runs(Object.fromEntries(Object.entries(runFields).map(([k, id]) => [k, field(id).value]))); };

  function selectTab(name) {
    tabs.forEach((t) => { t.setAttribute('aria-selected', String(t.dataset.tab === name)); t.tabIndex = t.dataset.tab === name ? 0 : -1; });
    Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== name; });
  }
  const mode = () => (Q('.gap-tab[aria-selected="true"]') || {}).dataset?.tab || 'items';
  function writeState() {
    const p = new URLSearchParams();
    if (mode() === 'runs') p.set('mode', 'runs');
    for (const [k, id] of [['a', 'gap-score-a'], ['b', 'gap-score-b'], ['n', 'gap-n']]) if (field(id).value !== '') p.set(k, field(id).value);
    const url = `${location.pathname}${p.toString() ? `?${p}` : ''}`;
    history.replaceState(null, '', url);
    return url;
  }

  tabs.forEach((t) => t.addEventListener('click', () => { selectTab(t.dataset.tab); writeState(); }));
  field('gap-preset').addEventListener('change', () => {
    if (field('gap-preset').value) field('gap-n').value = field('gap-preset').value;
    renderItems(); writeState();
  });
  ['gap-score-a', 'gap-score-b', 'gap-n'].forEach((id) => field(id).addEventListener('input', () => { renderItems(); writeState(); }));
  Object.values(runFields).forEach((id) => field(id).addEventListener('input', renderRuns));

  // A preset card loads its pair into the items tab and brings the calculator into view.
  for (const btn of document.querySelectorAll('.gap-load')) {
    btn.addEventListener('click', () => {
      selectTab('items');
      field('gap-preset').value = btn.dataset.n;
      field('gap-score-a').value = btn.dataset.a;
      field('gap-score-b').value = btn.dataset.b;
      field('gap-n').value = btn.dataset.n;
      renderItems(); writeState();
      root.scrollIntoView({ block: 'start' });
      field('gap-score-a').focus({ preventScroll: true });
    });
  }

  const copy = Q('#gap-copy-link');
  if (copy) copy.addEventListener('click', () => { const url = writeState(); navigator.clipboard?.writeText(location.origin + url); });

  // The address, read once: a query replaces the page's own example.
  const q = new URLSearchParams(location.search);
  if (['mode', 'a', 'b', 'n'].some((k) => q.has(k))) {
    selectTab(q.get('mode') === 'runs' ? 'runs' : 'items');
    field('gap-preset').value = '';
    field('gap-score-a').value = q.get('a') || '';
    field('gap-score-b').value = q.get('b') || '';
    field('gap-n').value = q.get('n') || '';
    renderItems();
  }
  el.dataset.mounted = 'true';
}
