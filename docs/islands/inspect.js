// SPDX-License-Identifier: Apache-2.0
//
// Spec 725: the browser for the inspect scanner. The person pastes, chooses or drops a file; the
// published module reads it here, in the page, and this file shows its report: the text with every
// hidden character made visible, the places to look grouped by class, the counts, the cost estimate,
// the command that runs the same check, and the module's fixed closing sentence. Every rendering is
// textContent. Nothing is fetched, stored or put into the address. The prices and the class labels are
// read from the static page the builder wrote, so the page with and without script says the same.
import { scanInspect, inspectVisible, INSPECT_CLOSING, INSPECT_LIMITS, INSPECT_REFUSALS } from '../import-core/inspect.mjs';

const COMMAND = 'npx driftproof inspect <file>';
const NONE = 'These fixed text patterns found nothing to point out.';
const LINK = 'This page reads text you paste or drop; it does not follow links.';
const EMPTY = 'Paste or drop some text first.';
const ONE_FILE = 'Choose one file.';
// A refusal is the module's plain sentence for its code, the sentence the CLI prints; the code itself is not shown.
const refusal = (error) => INSPECT_REFUSALS[error && error.code] || INSPECT_REFUSALS.INSPECT_INPUT;
const PANEL_NAME = 'The text, with hidden characters shown';
// What a screen reader says for a code the module writes. A code stands for a hidden character, except the
// first letter of one word the module writes as a code to keep it off the page, which is not hidden (spec 725 A-725-4).
const CHARACTER_NAMES = {
  '0009': 'tab', '00AD': 'soft hyphen', '200B': 'zero-width space', '200C': 'zero-width non-joiner', '200D': 'zero-width joiner',
  '200E': 'left-to-right mark', '200F': 'right-to-left mark', '2028': 'line separator', '2029': 'paragraph separator',
  '202A': 'left-to-right embedding', '202B': 'right-to-left embedding', '202C': 'pop directional formatting',
  '202D': 'left-to-right override', '202E': 'right-to-left override', '2060': 'word joiner', '2066': 'left-to-right isolate',
  '2067': 'right-to-left isolate', '2068': 'first strong isolate', '2069': 'pop directional isolate', 'FEFF': 'byte order mark',
};
function codeName(hex) {
  const code = hex.toUpperCase().padStart(4, '0');
  if (code === '0073' || code === '0053') return 'character U+' + code;
  return 'hidden character U+' + code + (CHARACTER_NAMES[code] ? ', ' + CHARACTER_NAMES[code] : '');
}
// A hostile file can hold some 260,000 codes. Past this many in one report a code stays a plain code, visible
// and in place, so the page cannot be frozen by what it is reading.
const MARK_LIMIT = 20000;

const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
const marked = (tag, key, text) => { const el = node(tag, text); el.setAttribute('data-inspect-' + key, ''); return el; };
// The module's line convention: CRLF and LF delimit lines; a final delimiter adds no line.
function linesOf(text) {
  const out = [];
  for (let start = 0; start < text.length;) {
    const end = text.indexOf('\n', start), stop = end < 0 ? text.length : end;
    out.push(text.slice(start, end >= 0 && text[stop - 1] === '\r' ? stop - 1 : stop));
    start = stop + 1;
  }
  return out;
}
const isOneLink = (text) => /^https?:\/\/\S+$/i.test(text.trim());

export function mount(el) {
  const prices = [...el.querySelectorAll('tr[data-model]')].map((tr) => ({ model: tr.dataset.model, name: tr.dataset.name, input: Number(tr.dataset.input) }));
  const classes = [...el.querySelectorAll('li[data-class]')].map((li) => ({ cls: li.dataset.class, label: li.dataset.label, plain: li.dataset.plain }));
  // Optional: the island is loaded from an unversioned path, so a cached older page may not carry the line.
  const planNote = el.querySelector('[data-inspect-plan]')?.textContent ?? '';
  const pickLabel = node('label', 'Choose a file');
  const input = marked('input', 'input'); input.type = 'file'; pickLabel.append(input);
  const drop = marked('div', 'drop', 'Drop a file here, or press Enter to choose one.');
  drop.className = 'drop-results-zone'; drop.tabIndex = 0; drop.setAttribute('role', 'button');
  const textLabel = node('label', 'Or paste the text');
  const text = marked('textarea', 'text'); text.rows = 10; text.spellcheck = false; textLabel.append(text);
  const button = marked('button', 'run', 'Inspect the text'); button.type = 'button';
  // The status is the only live region, and always rendered: the report itself would be read out line by line.
  const status = marked('p', 'status'); status.setAttribute('role', 'status');
  const output = marked('section', 'output'); output.className = 'inspect-output';
  const controls = node('div'); controls.className = 'inspect-controls';
  controls.append(pickLabel, drop, textLabel, button, status, output);
  const fallback = el.querySelector('[data-inspect-fallback]');
  if (fallback) fallback.replaceWith(controls); else el.prepend(controls);

  let version = 0, fileText = null, marksLeft = MARK_LIMIT;
  const say = (sentence) => { status.textContent = sentence; };
  const invalidate = () => { version++; output.replaceChildren(); say(''); };
  const notice = (sentence) => { output.replaceChildren(marked('p', 'notice', sentence)); say(sentence); };
  // The module's text, each code it wrote boxed and named. A doubled backslash is the file's own, so what follows
  // it is never a code. The name is on the mark, so the element's text stays the module's bytes.
  function appendMarked(target, shown) {
    let at = 0;
    for (const m of shown.matchAll(/\\\\|\\u\{([0-9a-f]+)\}/g)) {
      if (m[1] === undefined || marksLeft <= 0) continue;
      marksLeft--;
      if (m.index > at) target.append(shown.slice(at, m.index));
      const code = node('span', m[0]); code.className = 'inspect-escape'; code.setAttribute('role', 'img'); code.setAttribute('aria-label', codeName(m[1]));
      target.append(code);
      at = m.index + m[0].length;
    }
    if (at < shown.length) target.append(shown.slice(at));
  }

  function panelOf(source) {
    const pre = marked('pre', 'panel'); pre.className = 'inspect-panel';
    // It scrolls, and Safari does not make a scroll box focusable by itself.
    pre.tabIndex = 0; pre.setAttribute('role', 'region'); pre.setAttribute('aria-label', PANEL_NAME);
    const lines = linesOf(source);
    lines.forEach((line, i) => {
      const span = node('span'); appendMarked(span, inspectVisible(line)); span.className = 'inspect-line'; span.dataset.line = String(i + 1); span.tabIndex = -1;
      pre.append(span);
      if (i < lines.length - 1) pre.append('\n');
    });
    return pre;
  }
  function pointAt(pre, line) {
    const span = pre.querySelector('[data-line="' + line + '"]');
    if (!span) return;
    for (const s of pre.querySelectorAll('.is-pointed')) s.classList.remove('is-pointed');
    span.classList.add('is-pointed');
    span.scrollIntoView({ block: 'center' });
    span.focus();
  }
  // The findings by class, in the page's order, each with its plain label.
  const groupsOf = (report) => [...new Set([...classes.map((c) => c.cls), ...report.findings.map((f) => f.class)])]
    .map((cls) => ({ cls, known: classes.find((c) => c.cls === cls), rows: report.findings.filter((f) => f.class === cls) }))
    .filter((g) => g.rows.length);
  // One sentence for the status: how many places, of which kinds.
  function summaryOf(report) {
    const n = report.findings.length;
    if (!n) return 'Report ready below: nothing found by these fixed patterns; a clean reading is not a guarantee.';
    return 'Report ready below with ' + n + (n === 1 ? ' place' : ' places') + ' to look: ' + groupsOf(report).map((g) => (g.known ? g.known.label : 'Other') + ' ' + g.rows.length).join(', ') + '.';
  }
  function findingsOf(report, pre) {
    const box = marked('div', 'findings');
    if (!report.findings.length) { box.append(marked('p', 'none', NONE)); return box; }
    for (const { cls, known, rows } of groupsOf(report)) {
      const section = node('section'); section.setAttribute('data-inspect-class', cls);
      section.append(node('h3', known ? known.label : 'Other'), node('p', known ? known.plain : 'A place to look.'));
      const list = node('ol');
      for (const f of rows) {
        const li = marked('li', 'finding'); li.dataset.class = f.class; li.dataset.line = String(f.line);
        const go = marked('button', 'goto', 'Line ' + f.line); go.type = 'button';
        go.addEventListener('click', () => pointAt(pre, f.line));
        const excerpt = marked('span', 'excerpt'); appendMarked(excerpt, f.excerpt); excerpt.className = 'inspect-excerpt';
        li.append(go, ' ', excerpt, ' ', marked('span', 'message', f.message));
        if (f.host !== undefined) li.append(' ', marked('span', 'host', 'Host: ' + f.host + '.'));
        list.append(li);
      }
      section.append(list);
      box.append(section);
    }
    return box;
  }
  function countsOf(report) {
    const box = node('div');
    const dl = node('dl');
    for (const [label, key, value] of [['Lines', 'lines', report.stats.lines], ['Bytes', 'bytes', report.stats.bytes], ['Estimated tokens (estimate, input text only)', 'tokens', report.stats.estimatedTokens]]) {
      dl.append(node('dt', label), marked('dd', key, String(value)));
    }
    const table = node('table'); table.className = 'inspect-costs';
    table.append(node('caption', 'US dollars per 1,000 calls that each carry this text, at each model\'s input price'));
    const head = node('thead'), hr = node('tr');
    for (const h of ['Model', 'USD per 1,000 calls', 'What the figure is']) { const th = node('th', h); th.scope = 'col'; hr.append(th); }
    head.append(hr); table.append(head);
    const body = node('tbody');
    for (const c of report.costs) {
      const tr = marked('tr', 'cost'); tr.dataset.model = c.model;
      const th = node('th', (prices.find((p) => p.model === c.model) || {}).name || c.model); th.scope = 'row';
      tr.append(th, marked('td', 'usd', c.usdShown), node('td', c.label + ', ' + c.scope));
      body.append(tr);
    }
    table.append(body);
    // The wrap gives the caption the sheet to stand on: a table's own background paints only its grid.
    const wrap = node('div'); wrap.className = 'table-wrap'; wrap.append(table);
    box.append(dl, ...(planNote ? [marked('p', 'plan', planNote)] : []), wrap);
    return box;
  }
  function show(source) {
    if (source === '') return notice(EMPTY);
    marksLeft = MARK_LIMIT;
    let report, pre;
    try {
      report = scanInspect(source, { prices: prices.map((p) => ({ model: p.model, input: p.input })) });
      pre = panelOf(source);
    } catch (error) { return notice(refusal(error)); }
    // Pasted text only: a chosen or dropped file goes through the scanner, as the CLI reads it. A pasted
    // link gets the sentence alone only when the address is all the scanner found; anything more, such as
    // a hidden character, is shown as the CLI shows it, with the sentence beside it.
    const pastedLink = fileText === null && isOneLink(source);
    if (pastedLink && report.findings.every((f) => f.class === 'url')) return notice(LINK);
    const command = node('pre'); command.append(marked('code', 'command', COMMAND));
    output.replaceChildren(
      ...(pastedLink ? [marked('p', 'notice', LINK)] : []),
      node('h2', PANEL_NAME),
      node('p', 'Hidden characters are shown as codes in curly braces, as the command line shows them. Press Enter on a finding below to jump to its line.'),
      pre,
      node('h2', 'Places to look'), findingsOf(report, pre),
      node('h2', 'Counts and cost estimate'), countsOf(report),
      node('h2', 'Run the same check on your computer'), command,
      node('p', 'Put your file\'s path in place of <file>.'),
      marked('p', 'closing', INSPECT_CLOSING),
    );
    output.querySelector('[data-inspect-closing]').className = 'inspect-closing';
    say((pastedLink ? LINK + ' ' : '') + summaryOf(report));
  }
  function build() {
    const own = ++version;
    output.replaceChildren(node('p', 'Reading locally…'));
    const source = fileText === null ? text.value : fileText;
    if (own === version) show(source);
  }
  async function choose(files) {
    invalidate(); fileText = null; text.value = '';
    const own = version;
    try {
      if (files.length !== 1) return notice(ONE_FILE);
      // Refuse before reading, at the module's own bound.
      if (files[0].size > INSPECT_LIMITS.INSPECT_MAX_BYTES) return notice(INSPECT_REFUSALS.INSPECT_MAX_BYTES);
      const bytes = new Uint8Array(await files[0].arrayBuffer());
      if (own !== version) return;
      let decoded;
      try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { return notice(INSPECT_REFUSALS.INSPECT_UTF8); }
      // The textarea normalizes CRLF. Keep the file's own text until an input event.
      fileText = decoded; text.value = decoded;
      build();
    } catch (error) { if (own === version) notice(refusal(error)); }
  }
  text.addEventListener('input', () => { fileText = null; input.value = ''; invalidate(); });
  input.addEventListener('change', () => choose([...input.files]));
  button.addEventListener('click', build);
  drop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', (event) => event.preventDefault());
  drop.addEventListener('drop', (event) => { event.preventDefault(); choose([...event.dataTransfer.files]); });
  // A file dropped elsewhere on the page must not navigate away from it.
  el.addEventListener('dragover', (event) => event.preventDefault());
  el.addEventListener('drop', (event) => event.preventDefault());
}
