// SPDX-License-Identifier: Apache-2.0
//
// docs/islands/benchmark-gap.js - the benchmark gap calculator, as an island (spec 170, issue 50).
//
// The page is complete before this runs: the build writes the opening example into it (the preset,
// the two scores, the question count, the plain result and, behind "Show the statistics", the result
// card), with the same renderers this file calls, gap.js's CALC.render. So with no query string,
// mounting changes nothing a reader sees, and the first paint is the final one. A query string
// replaces the example.
//
// Since spec 174 (issue 63) nothing recalculates until a tab's "Check the gap" is pressed (or Enter
// typed in one of its fields). The preset fills the question count, whose field shows only for a
// custom benchmark. Each tab writes its plain result into its own area and its statistics into the
// expander.
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
  const field = (id) => document.getElementById(id);
  const tabs = QA('.gap-tab');
  const panels = { items: Q('#gap-panel-items'), runs: Q('#gap-panel-runs') };
  const stats = { items: field('gap-items-stats'), runs: field('gap-runs-stats') };
  const expander = document.querySelector('details.gap-stats');
  const itemsOut = el;
  const runsOut = Q('#gap-runs-out');
  const runFields = { aMean: 'gap-runs-a-mean', aSd: 'gap-runs-a-sd', aN: 'gap-runs-a-n', bMean: 'gap-runs-b-mean', bSd: 'gap-runs-b-sd', bN: 'gap-runs-b-n' };

  const renderItems = () => {
    const args = [field('gap-score-a').value, field('gap-score-b').value, field('gap-n').value];
    itemsOut.innerHTML = CALC.render.items(...args);
    stats.items.innerHTML = CALC.render.itemsStats(...args);
  };
  const renderRuns = () => {
    const f = Object.fromEntries(Object.entries(runFields).map(([k, id]) => [k, field(id).value]));
    runsOut.innerHTML = CALC.render.runs(f);
    stats.runs.innerHTML = CALC.render.runsStats(f);
  };

  function selectTab(name) {
    tabs.forEach((t) => { t.setAttribute('aria-selected', String(t.dataset.tab === name)); t.tabIndex = t.dataset.tab === name ? 0 : -1; });
    Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== name; });
    Object.entries(stats).forEach(([k, s]) => { s.hidden = k !== name; });
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

  // The preset fills N; the field shows only for a custom benchmark. A count no preset carries
  // selects custom.
  const preset = field('gap-preset');
  const showN = () => { field('gap-n-field').hidden = preset.value !== 'custom'; };
  const presetFor = (n) => ([...preset.options].some((o) => o.value === n && n !== '') ? n : 'custom');
  preset.addEventListener('change', () => {
    if (preset.value !== 'custom') field('gap-n').value = preset.value;
    showN();
  });

  const checkItems = () => { renderItems(); writeState(); };
  const checkRuns = () => { renderRuns(); writeState(); };
  const onEnter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };
  field('gap-items-check').addEventListener('click', checkItems);
  field('gap-runs-check').addEventListener('click', checkRuns);
  ['gap-score-a', 'gap-score-b', 'gap-n'].forEach((id) => field(id).addEventListener('keydown', onEnter(checkItems)));
  Object.values(runFields).forEach((id) => field(id).addEventListener('keydown', onEnter(checkRuns)));
  tabs.forEach((t) => t.addEventListener('click', () => { selectTab(t.dataset.tab); writeState(); }));

  // A preset card loads its pair into the items tab, checks it, and brings the calculator into view.
  for (const btn of document.querySelectorAll('.gap-load')) {
    btn.addEventListener('click', () => {
      selectTab('items');
      preset.value = presetFor(btn.dataset.n);
      field('gap-score-a').value = btn.dataset.a;
      field('gap-score-b').value = btn.dataset.b;
      field('gap-n').value = btn.dataset.n;
      showN();
      checkItems();
      root.scrollIntoView({ block: 'start' });
      field('gap-score-a').focus({ preventScroll: true });
    });
  }

  const copy = Q('#gap-copy-link');
  if (copy) copy.addEventListener('click', () => { const url = writeState(); navigator.clipboard?.writeText(location.origin + url); });

  // A link to a heading behind the expander (How this works, the contents rail) opens it first.
  const reveal = (id) => { const t = id && document.getElementById(id); if (expander && t && expander.contains(t)) expander.open = true; };
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href^="#"]'); if (a) reveal(decodeURIComponent(a.getAttribute('href').slice(1))); });
  reveal(decodeURIComponent(location.hash.slice(1)));

  // The address, read once: a query replaces the page's own example and shows its result.
  const q = new URLSearchParams(location.search);
  if (['mode', 'a', 'b', 'n'].some((k) => q.has(k))) {
    selectTab(q.get('mode') === 'runs' ? 'runs' : 'items');
    field('gap-score-a').value = q.get('a') || '';
    field('gap-score-b').value = q.get('b') || '';
    field('gap-n').value = q.get('n') || '';
    preset.value = presetFor(field('gap-n').value);
    showN();
    renderItems();
  }
  el.dataset.mounted = 'true';
}
