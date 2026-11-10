// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 689 (spec 689): plain-word cards for jargon on every reader page. Each row reads the built pages and
// the glossary with its own reader of the element stack, so no row takes the builder's word for where a
// marker may stand. The browser rows render a page in Chromium from node_modules and write their screenshots
// under TMPDIR (/var/tmp), never into the tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { tokenize, htmlToText, attrOf } = require('../scripts/html-text.js');
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const scratch = (name) => fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', name));
const text = (h) => htmlToText(h, { collapse: true });
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// A plant on a copy of the page: the anchor must be there once, so a moved anchor reads as a failed plant.
const plant = (h, from, to) => { assert.equal(h.split(from).length, 2, `plant anchor once: ${String(from).slice(0, 60)}`); return h.replace(from, () => to); };
const GLOSSARY = 'docs/glossary/index.html';
const SAMPLE = 'docs/reports/018/index.html';
const TERM_OPEN = '<!--driftproof:term-->';
const TERM_CLOSE = '<!--/driftproof:term-->';
const MARKER_RE = /<!--driftproof:term--><a class="term"[^>]*>([^<]*)<\/a><!--\/driftproof:term-->/g;

// ── the published page set, as build-head-tags.js and build-public.sh define it ──────────────────
function pages() {
  const { pageFiles } = require('../scripts/build-head-tags.js');
  return pageFiles().map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
}
const isReaderPage = (h) => h.includes('<main') && h.includes('</main>') && !/<meta http-equiv="refresh"/.test(h);

// ── the glossary, read by the test ────────────────────────────────────────────────────────────────
function glossaryEntries(h = read(GLOSSARY)) {
  const out = new Map();
  for (const m of h.matchAll(/<dt id="(term-[a-z0-9-]+)">([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
    const plain = /<p class="term-plain">([\s\S]*?)<\/p>/.exec(m[3]);
    out.set(m[1], { name: text(m[2]), plain: plain ? text(plain[1]) : null, dd: m[3] });
  }
  return out;
}

// ── machine-read text: the spec's list, read as an element stack ─────────────────────────────────
const SKIP_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button', 'summary', 'label', 'code', 'pre', 'kbd', 'samp', 'var', 'script', 'style', 'template', 'textarea', 'select', 'option', 'svg', 'math', 'title', 'table', 'th', 'dt', 'dfn', 'abbr', 'cite', 'q', 'data', 'time', 'mark', 'nav', 'header', 'footer', 'form', 'input']);
const SKIP_CLASSES = new Set(['receipt', 'report-card', 'plain-summary', 'tldr-cite', 'copy-cta', 'report-type', 'headline-caveat', 'handoff-note', 'skill-entry']);
const SKIP_ATTRS = ['data-stat', 'data-field', 'data-quote', 'data-copy'];
const classesOf = (tok) => String(attrOf(tok, 'class') || '').split(/\s+/).filter(Boolean);
const isMarker = (tok) => tok.type === 'start' && tok.name === 'a' && classesOf(tok).includes('term');
const skips = (tok) => SKIP_TAGS.has(tok.name) || classesOf(tok).some((c) => SKIP_CLASSES.has(c)) || SKIP_ATTRS.some((a) => attrOf(tok, a) !== null);
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// The issue's ten words and their forms, each to the entry the test expects to explain it. The builder may
// mark more entries; these ten are the oracle for "the first use".
const WORDS = [
  ['term-placebo-arm', /(?<=^|\s)(?:[Pp]lacebo arms?|[Pp]lacebos?)(?=\s|$)/g],
  ['term-judge', /(?<=^|\s)(?:[Jj]udges?|[Gg]raders?)(?=\s|$)/g],
  ['term-receipt', /(?<=^|\s)[Rr]eceipts?(?=\s|$)/g],
  ['term-draw', /(?<=^|\s)[Dd]raws?(?=\s|$)/g],
  ['term-band', /(?<=^|\s)[Bb]ands?(?=\s|$)/g],
  ['term-separated', /(?<=^|\s)(?:[Ss]eparated|[Ss]eparation)(?=\s|$)/g],
  ['term-router', /(?<=^|\s)[Rr]outers?(?=\s|$)/g],
  ['term-baseline', /(?<=^|\s)[Bb]aselines?(?=\s|$)/g],
  ['term-case-rule', /(?<=^|\s)[Cc]ase rules?(?=\s|$)/g],
  ['term-skill', /(?<=^|\s)(?:AI skills?|[Ss]kills?)(?=\s|$)/g],
];
// Walk a page: every marker with its context, and every prose use of the ten words, in order.
function readPage(h) {
  const a = h.indexOf('<main'); const b = h.lastIndexOf('</main>');
  const markers = []; const events = []; const problems = [];
  if (a < 0 || b < 0) return { markers, events, problems: ['no <main>'] };
  const ids = new Set([...h.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const stack = [];
  let pos = 0;
  for (const t of tokenize(h)) {
    const at = pos; pos += t.type === 'text' ? t.text.length : t.raw.length;
    const inMain = at >= a && at < b;
    if (t.type === 'start') {
      if (P_CLOSERS.has(t.name)) { const i = stack.map((x) => x.name).lastIndexOf('p'); if (i >= 0) stack.length = i; }
      // An item closes an open item only inside the same list (issue 716).
      const inList = (items, lists) => { const at = stack.map((x) => x.name); const i = Math.max(...items.map((n) => at.lastIndexOf(n))); return i > Math.max(...lists.map((n) => at.lastIndexOf(n))) ? i : -1; };
      if (t.name === 'li') { const i = inList(['li'], ['ul', 'ol', 'menu']); if (i >= 0) stack.length = i; }
      if (t.name === 'dt' || t.name === 'dd') { const i = inList(['dt', 'dd'], ['dl']); if (i >= 0) stack.length = i; }
      if (isMarker(t)) {
        const id = attrOf(t, 'data-entry');
        const outer = stack.filter(skips).map((x) => x.name + (attrOf(x, 'class') ? `.${attrOf(x, 'class')}` : ''));
        markers.push({ id, name: decode(attrOf(t, 'data-name') || ''), plain: decode(attrOf(t, 'data-plain') || ''), href: attrOf(t, 'href'), at, inMain, outer, word: null });
        if (!inMain) problems.push(`a marker outside <main> at ${at}`);
        if (outer.length) problems.push(`a marker for ${id} inside machine-read text: ${outer.join(' > ')}`);
        if (ids.has(id)) problems.push(`a marker for ${id} on a page that carries that id`);
        if (!/^\s*$/.test(h.slice(at - TERM_OPEN.length, at)) && h.slice(at - TERM_OPEN.length, at) !== TERM_OPEN) problems.push(`a marker for ${id} without its opening fence`);
      }
      if (!VOID.has(t.name) && !t.selfClosing) stack.push(t);
      continue;
    }
    if (t.type === 'end') { const i = stack.map((x) => x.name).lastIndexOf(t.name); if (i >= 0) stack.length = i; continue; }
    if (t.type !== 'text' || !inMain) continue;
    const top = stack[stack.length - 1];
    if (top && isMarker(top)) {
      const m = markers[markers.length - 1];
      if (m) { m.word = t.text; events.push({ id: m.id, kind: 'marked', at, word: t.text }); }
      continue;
    }
    if (stack.some(skips)) continue;
    for (const [id, re] of WORDS) for (const x of t.text.matchAll(re)) events.push({ id, kind: 'plain', at: at + x.index, word: x[0] });
  }
  // One marker per entry; the first prose use of a word is the marked one; no later use is marked.
  const byId = new Map();
  for (const e of events.sort((x, y) => x.at - y.at)) { if (!byId.has(e.id)) byId.set(e.id, []); byId.get(e.id).push(e); }
  for (const [id, es] of byId) {
    const marked = es.filter((e) => e.kind === 'marked');
    if (marked.length > 1) problems.push(`${id}: ${marked.length} markers on one page`);
    if (marked.length && es[0].kind !== 'marked') problems.push(`${id}: a plain use ("${es[0].word}") comes before its marker`);
    if (!marked.length && WORDS.some(([w]) => w === id) && !ids.has(id)) problems.push(`${id}: the first use ("${es[0].word}") is not marked`);
  }
  return { markers, events, problems };
}
function readAgainstGlossary(markers, glossary) {
  const hits = [];
  for (const m of markers) {
    const g = glossary.get(m.id);
    if (!g) { hits.push(`${m.id}: no glossary entry`); continue; }
    if (!g.plain) { hits.push(`${m.id}: the entry has no plain line`); continue; }
    if (m.plain !== g.plain) hits.push(`${m.id}: the card says "${m.plain.slice(0, 50)}", the glossary "${g.plain.slice(0, 50)}"`);
    if (m.href !== `/glossary/#${m.id}`) hits.push(`${m.id}: href ${m.href}`);
    if (m.name !== g.name) hits.push(`${m.id}: the card is titled "${m.name}", the entry "${g.name}"`);
  }
  return hits;
}
const firstMarker = (h) => { const m = new RegExp(MARKER_RE.source).exec(h); assert.ok(m, 'a marker to plant on'); return m; };

// ── the rows ──────────────────────────────────────────────────────────────────────────────────────
test('AC-1 one source: every card on every page says what the glossary entry says', () => {
  const glossary = glossaryEntries();
  assert.ok(glossary.size >= 20, `glossary entries: ${glossary.size}`);
  for (const [id, g] of glossary) assert.ok(g.plain, `${id} has a plain line`);
  const bad = [];
  let total = 0;
  for (const rel of pages()) {
    const h = read(rel);
    if (!isReaderPage(h)) continue;
    const { markers } = readPage(h);
    total += markers.length;
    for (const x of readAgainstGlossary(markers, glossary)) bad.push(`${rel}: ${x}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(total > 100, `markers across the site: ${total}`);
  // Plants: a card's words changed; the glossary's plain line changed under the pages.
  const h = read(SAMPLE);
  const m = firstMarker(h);
  const changed = h.replace(m[0], m[0].replace(/data-plain="/, 'data-plain="Planted. '));
  assert.ok(readAgainstGlossary(readPage(changed).markers, glossary).some((x) => /the card says "Planted/.test(x)), 'a changed card reads red');
  const id = /data-entry="([^"]+)"/.exec(m[0])[1];
  const gl = read(GLOSSARY);
  const line = new RegExp(`(<dt id="${id}">[\\s\\S]*?<p class="term-plain">)`).exec(gl);
  assert.ok(line, 'the entry to plant on');
  const moved = glossaryEntries(gl.replace(line[0], `${line[0]}Planted. `));
  assert.ok(readAgainstGlossary(readPage(h).markers, moved).some((x) => /the glossary "Planted/.test(x)), 'a moved glossary line reads red against the pages');
});

test('AC-2 the first use, in prose only, one marker per entry, on every reader page', () => {
  const bad = [];
  let readerPages = 0;
  for (const rel of pages()) {
    const h = read(rel);
    if (!isReaderPage(h)) continue;
    readerPages += 1;
    for (const p of readPage(h).problems) bad.push(`${rel}: ${p}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(readerPages > 300, `reader pages: ${readerPages}`);
  assert.deepEqual(readPage(read(GLOSSARY)).markers, [], 'the glossary carries no marker');
  // Plants on a copy of the sample page.
  const h = read(SAMPLE);
  const m = firstMarker(h);
  assert.ok(readPage(h.replace(m[0], `${m[0]} ${m[0]}`)).problems.some((x) => /2 markers on one page/.test(x)), 'a second marker for the same entry reads red');
  assert.ok(readPage(h.replace(m[0], `<code>${m[0]}</code>`)).problems.some((x) => /inside machine-read text: code/.test(x)), 'a marker inside code reads red');
  assert.ok(readPage(h.replace(m[0], `<a href="/">${m[0]}</a>`)).problems.some((x) => /inside machine-read text: a/.test(x)), 'a marker inside a link reads red');
  // After the answer-first summary, which is machine-read as a whole (.plain-summary).
  const h2 = /<h2\b[^>]*>/.exec(h.slice(h.indexOf('<!--/driftproof:tldr-->')));
  assert.ok(h2, 'an h2 in main');
  const inHeading = h.replace(m[0], m[1]).replace(h2[0], `${h2[0]}${m[0]} `);
  assert.ok(readPage(inHeading).problems.some((x) => /inside machine-read text: h2/.test(x)), 'a marker inside a heading reads red');
  // An earlier prose use left plain: the marked word put, plain, right after the page's <h1>, before the marker.
  const h1End = h.indexOf('</h1>', h.indexOf('<main')) + 5;
  assert.ok(h1End > 4 && h1End < m.index, 'an h1 before the first marker');
  const earlier = `${h.slice(0, h1End)}${m[1]} ${h.slice(h1End)}`;
  assert.ok(readPage(earlier).problems.some((x) => /comes before its marker/.test(x)), 'an earlier plain use reads red');
});

test('AC-3 by rule, in the shared step: a synthetic page, every href, the script set, the island and its mount', () => {
  const headTags = require('../scripts/build-head-tags.js');
  const synthetic = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>A new page</title>\n</head>\n<body>\n<main class="screens">\n<section class="screen"><h1>A new page about a placebo</h1>\n<p>The judge scores each answer against a guide, and the placebo is a text of the same length. The judge never sees the placebo text.</p></section>\n</main>\n</body>\n</html>\n';
  const out = headTags.applyHeadTags(synthetic, 'new-page/index.html');
  const r = readPage(out);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.markers.map((m) => [m.id, m.word]), [['term-judge', 'judge'], ['term-placebo-arm', 'placebo']]);
  assert.equal((out.match(/data-island="jargon-cards"/g) || []).length, 1, 'one mount');
  assert.match(out, /<!--driftproof:cards--><div class="jargon-cards" data-island="jargon-cards"><p class="jargon-note">[^<]+<\/p><\/div><!--\/driftproof:cards-->/);
  assert.ok(out.indexOf('<!--driftproof:cards-->') > out.lastIndexOf('</main>') && out.indexOf('<!--driftproof:cards-->') < out.indexOf('<!--driftproof:foot-->'), 'the mount sits after <main> and before the footer');
  const glossary = glossaryEntries();
  const bad = [];
  const scripts = new Set();
  for (const rel of pages()) {
    const h = read(rel);
    for (const m of h.matchAll(/<script\b[^>]*\bsrc=['"]([^'"]+)['"]/g)) scripts.add(m[1]);
    if (!isReaderPage(h)) { if (h.includes('jargon-cards')) bad.push(`${rel}: a stub carries the mount`); continue; }
    const { markers } = readPage(h);
    for (const m of markers) if (!glossary.has(m.id) || m.href !== `/glossary/#${m.id}`) bad.push(`${rel}: ${m.id} -> ${m.href}`);
    const mounts = (h.match(/data-island="jargon-cards"/g) || []).length;
    if (markers.length && mounts !== 1) bad.push(`${rel}: ${markers.length} markers and ${mounts} mounts`);
    if (!markers.length && mounts) bad.push(`${rel}: a mount with no marker`);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual([...scripts].sort(), ['/copy-button.js', '/islands/loader.js', 'https://static.cloudflareinsights.com/beacon.min.js']);
  const island = read('docs/islands/jargon-cards.js');
  assert.ok(!/^\s*import\s/m.test(island) && !/\brequire\s*\(/.test(island), 'the island imports nothing');
  assert.match(island, /export function mount\(/);
  assert.doesNotMatch(island, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie|navigator\.sendBeacon/, 'the island makes no request and stores nothing');
  // Plants: an id the glossary lacks; a page whose markers were unwrapped is stale.
  const h = read(SAMPLE);
  const m = firstMarker(h);
  const dangling = h.replace(m[0], m[0].replace(/data-entry="[^"]+"/, 'data-entry="term-planted"').replace(/href="[^"]+"/, 'href="/glossary/#term-planted"'));
  assert.ok(readAgainstGlossary(readPage(dangling).markers, glossary).some((x) => /no glossary entry/.test(x)), 'a dangling entry reads red');
  const unwrapped = h.replace(new RegExp(MARKER_RE.source, 'g'), '$1');
  assert.notEqual(unwrapped, h);
  assert.equal(headTags.render(unwrapped, 'reports/018/index.html'), h, 'the unwrapped copy renders back to the committed page');
  assert.notEqual(headTags.render(unwrapped, 'reports/018/index.html'), unwrapped, 'so the unwrapped copy is stale');
});

test('AC-4 no frozen body or Markdown copy moves, and the step is idempotent', () => {
  const chrome = require('../scripts/site-chrome.js');
  const baselines = JSON.parse(read('specs/020-site-relaunch/baselines/report-bodies.json')).reports;
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const bad = [];
  for (const [n, rec] of Object.entries(baselines)) {
    const rel = `docs/reports/${n}/index.html`;
    const h = read(rel);
    const { body } = chrome.splitReportBody(h);
    if (body.includes('driftproof:term') || body.includes('class="term"')) bad.push(`${rel}: the body keeps a marker`);
    if (sha(body) !== rec.body_sha256) bad.push(`${rel}: the body digest moved`);
    if ((h.match(new RegExp(MARKER_RE.source, 'g')) || []).length === 0 && n !== '010') bad.push(`${rel}: no marker on a report page`);
  }
  assert.deepEqual(bad, []);
  for (const rel of [SAMPLE, 'docs/index.html', 'docs/how-it-works/index.html', 'docs/methodology/index.html']) {
    const h = read(rel);
    assert.equal(chrome.applyChrome(h, rel.replace(/^docs\//, '')), h, `${rel}: re-rendering is a no-op`);
  }
  const { toMarkdown } = require('../scripts/build-markdown.js');
  const md = toMarkdown(read(SAMPLE), 'reports/018/index.html');
  assert.doesNotMatch(md, /glossary\/#term-/, 'the Markdown copy carries no glossary marker link');
  assert.equal(md, read('docs/reports/018/index.md'), 'the committed copy is current');
  // Plant: a marker whose word changed moves the body. The TL;DR fence is chrome (and its plain summary
  // takes no marker), so the plant takes the first marker after the fence, in the body.
  const h = read(SAMPLE);
  const afterTldr = h.indexOf('<!--/driftproof:tldr-->');
  const m = new RegExp(MARKER_RE.source, 'g');
  m.lastIndex = afterTldr;
  const inBody = m.exec(h);
  assert.ok(inBody, 'a marker in the body');
  const moved = h.replace(inBody[0], inBody[0].replace(`>${inBody[1]}</a>`, `>${inBody[1]}x</a>`));
  assert.notEqual(sha(chrome.splitReportBody(moved).body), baselines['018'].body_sha256, 'a changed word under a marker moves the body');
});

// Spec 037's confidence and superlative words, as tests/home-page.test.js reads them.
const BANNED = /\bconfiden(t|ce)\b|\bsignifican(t|ce)\b|\bbest\b|\bleading\b|\bguarantee|\bworld-class\b|\bproves?\b/i;
const TOKENS = /\b(?:PASSED|REGRESSED|NO_EFFECT|UNDERPOWERED|INCONCLUSIVE|NOT_MEASURED|TESTED|DECLARED|UNVERIFIED|FORMAL|ABOVE_PLACEBO|BELOW_PLACEBO)\b|\bspec \d|\bissue \d|\bA-\d{3}-\d|\bAC-\d|[a-z]+\/[a-z-]+\.(?:js|mjs|json|md)/;
function plainProblems(id, s) {
  const out = [];
  if (/\d/.test(s)) out.push(`${id}: a digit`);
  if (/—/.test(s)) out.push(`${id}: an em dash`);
  if (BANNED.test(s)) out.push(`${id}: a confidence or superlative word: ${BANNED.exec(s)[0]}`);
  if (TOKENS.test(s)) out.push(`${id}: an internal token: ${TOKENS.exec(s)[0]}`);
  const sentences = s.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
  if (sentences.length < 1 || sentences.length > 2) out.push(`${id}: ${sentences.length} sentences`);
  if (!/[.!?]$/.test(s.trim())) out.push(`${id}: does not end as a sentence`);
  return out;
}
test('AC-6 the words: every plain line, the note and the card\'s fixed words are plain', async () => {
  const glossary = glossaryEntries();
  const bad = [];
  for (const [id, g] of glossary) bad.push(...plainProblems(id, g.plain || ''));
  // The island's own words: its single-quoted literals with a space in them, read with its comments gone.
  const island = read('docs/islands/jargon-cards.js').replace(/^\s*\/\/.*$/gm, '');
  const strings = [...island.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]).filter((s) => /\s/.test(s) && /[a-z]{3}/.test(s));
  assert.ok(strings.length >= 3, `the island's words: ${strings.length}`);
  for (const s of strings) if (/\d|—/.test(s) || BANNED.test(s) || TOKENS.test(s)) bad.push(`island: "${s}"`);
  const note = /<p class="jargon-note">([^<]+)<\/p>/.exec(read(SAMPLE));
  assert.ok(note, 'the note on the sample page');
  bad.push(...plainProblems('the note', text(note[1])));
  process.env.SPEC031_TMP = process.env.SPEC031_TMP || scratch('jargon-lexicon-');
  const { LEXICON } = await import(path.join(ROOT, 'specs', '031-artefact-claims', 'probes', 'bands.mjs'));
  for (const [id, g] of glossary) for (const { cls, re } of LEXICON) if (re.test(g.plain || '')) bad.push(`${id}: band lexicon ${cls}`);
  assert.deepEqual(bad, []);
  assert.match(text(read(GLOSSARY)), /plain words/, 'the introduction says each entry opens in plain words');
  assert.ok(plainProblems('x', 'A thing of 3 parts.').some((p) => /a digit/.test(p)), 'a digit reads red');
});

test('AC-7 the derived files are current: site pages, head tags, body baselines', { timeout: 600000 }, () => {
  const run = (args) => execFileSync('node', args.map((a) => (a.startsWith('scripts/') ? path.join(ROOT, a) : a)), { cwd: ROOT, encoding: 'utf8' });
  assert.match(run(['scripts/build-site-pages.js', '--check']), /rendered pages are current/);
  assert.match(run(['scripts/build-head-tags.js', '--check']), /carry current head tags/);
  assert.match(run(['scripts/build-report-baselines.mjs', '--check']), /baselines current/);
  assert.match(run(['scripts/glossary-terms.js', '--check']), /current/);
  // The stylesheet's new rules: tokens only, and every motion inside the guard.
  const css = read('docs/tokens.css');
  const rules = [...css.matchAll(/([^{}]*\.(?:term|jargon)[^{}]*)\{([^{}]*)\}/g)];
  assert.ok(rules.length >= 4, `rules for the markers and the cards: ${rules.length}`);
  for (const r of rules) assert.doesNotMatch(r[2], /#[0-9a-fA-F]{3,8}\b/, `a raw colour in ${r[1].trim()}`);
  const unguarded = css.replace(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?\n\}/g, ' ');
  for (const r of [...unguarded.matchAll(/([^{}]*\.(?:term|jargon)[^{}]*)\{([^{}]*)\}/g)]) assert.doesNotMatch(r[2], /\b(?:transition|animation)\s*:/, `motion outside the guard in ${r[1].trim()}`);
});

test('AC-5 Chromium: tap on the phone, keyboard on the desktop, Escape and focus, no shift, no motion asked away', { timeout: 300000 }, async () => {
  const { chromium } = require('playwright');
  const shots = scratch('jargon-cards-shots-');
  const planted = scratch('jargon-cards-planted-');
  const sample = read(SAMPLE);
  fs.mkdirSync(path.join(planted, 'reports', '018'), { recursive: true });
  fs.writeFileSync(path.join(planted, 'reports', '018', 'index.html'), plant(sample, 'data-island="jargon-cards"', 'data-planted="jargon-cards"'));
  const roots = [planted, DOCS];
  const server = http.createServer((req, res) => {
    const rel = '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    for (const root of (req.headers['x-planted'] ? roots : [DOCS])) {
      let file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep) && file !== root) continue;
      try {
        if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        const body = fs.readFileSync(file);
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
        return res.end(body);
      } catch { /* the next root */ }
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/reports/018/`;
  const BEACON = 'https://static.cloudflareinsights.com/beacon.min.js';
  const STATE = () => {
    const mark = document.querySelector('a.term');
    const cards = [...document.querySelectorAll('.jargon-card')].filter((c) => { const r = c.getBoundingClientRect(); return getComputedStyle(c).display !== 'none' && r.width > 0 && r.height > 0; });
    const card = cards[0] || null;
    const r = card ? card.getBoundingClientRect() : null;
    const mr = mark.getBoundingClientRect();
    return {
      open: cards.length, role: card ? card.getAttribute('role') : null, expanded: mark.getAttribute('aria-expanded'),
      inViewport: r ? r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight : null,
      cardText: card ? card.textContent.replace(/\s+/g, ' ').trim() : '', cardHref: card ? (card.querySelector('a') || {}).getAttribute?.('href') || null : null,
      scrollHeight: document.documentElement.scrollHeight, markBox: [Math.round(mr.left), Math.round(mr.top), Math.round(mr.width), Math.round(mr.height)],
      active: document.activeElement === mark ? 'mark' : card && card.contains(document.activeElement) ? 'card' : document.activeElement.tagName,
      outline: getComputedStyle(mark).outlineStyle, animations: document.getAnimations().length,
      name: mark.dataset.name, plain: mark.dataset.plain, href: mark.getAttribute('href'), note: (document.querySelector('.jargon-note') || {}).textContent,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  };
  let browser;
  const requests = [];
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    // The phone, with touch.
    let context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
    await context.route('**/*', async (route) => { requests.push(route.request().url()); return new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(); });
    let page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => /tap|click/i.test((document.querySelector('.jargon-note') || {}).textContent || ''));
    // The first marker sits below the fold (the plain summary takes none), so bring it into view first: the
    // tap must not be what scrolls it.
    await page.locator('a.term').first().scrollIntoViewIfNeeded();
    let s = await page.evaluate(STATE);
    assert.equal(s.open, 0, 'no card before a tap');
    assert.equal(s.expanded, 'false');
    assert.equal(s.overflow, 0, 'no sideways scroll at 390');
    const before = s;
    await page.locator('a.term').first().tap();
    s = await page.evaluate(STATE);
    assert.equal(s.open, 1, 'one card after a tap');
    assert.equal(s.role, 'dialog');
    assert.equal(s.expanded, 'true');
    assert.equal(s.inViewport, true, 'the card is inside the viewport');
    assert.ok(s.cardText.includes(s.name) && s.cardText.includes(s.plain), `the card carries the name and the plain line: ${s.cardText.slice(0, 80)}`);
    assert.equal(s.cardHref, s.href, 'the card links the entry');
    assert.equal(s.scrollHeight, before.scrollHeight, 'the page did not grow');
    assert.deepEqual(s.markBox, before.markBox, 'the marker did not move');
    // The card's guarded fade is 160 ms; the capture waits for it so the evidence shows the card.
    const settled = () => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    await settled();
    await page.screenshot({ path: path.join(shots, 'cards-390-open.png'), fullPage: false });
    await page.keyboard.press('Escape');
    s = await page.evaluate(STATE);
    assert.equal(s.open, 0, 'Escape closes the card');
    assert.equal(s.expanded, 'false');
    assert.equal(s.active, 'mark', 'focus returns to the marker');
    await page.locator('a.term').first().tap();
    assert.equal((await page.evaluate(STATE)).open, 1);
    await page.touchscreen.tap(380, 20);
    assert.equal((await page.evaluate(STATE)).open, 0, 'a tap outside closes the card');
    // Two markers never show two cards.
    const n = await page.locator('a.term').count();
    assert.ok(n >= 2, `markers on the page: ${n}`);
    await page.locator('a.term').nth(0).tap();
    await page.locator('a.term').nth(1).tap();
    assert.equal(await page.locator('.jargon-card').evaluateAll((cs) => cs.filter((c) => getComputedStyle(c).display !== 'none').length), 1, 'one card at a time');
    await page.keyboard.press('Escape');
    await context.close();
    // The desktop, keyboard only.
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await context.route('**/*', async (route) => { requests.push(route.request().url()); return new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(); });
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => /tap|click/i.test((document.querySelector('.jargon-note') || {}).textContent || ''));
    assert.equal((await page.evaluate(STATE)).overflow, 0, 'no sideways scroll at 1280');
    // Keyboard focus: to the marker by Tab, so :focus-visible applies as it does for a keyboard reader.
    await page.locator('a.term').first().focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    s = await page.evaluate(STATE);
    assert.equal(s.active, 'mark');
    assert.equal(s.open, 1, 'focus opens the card');
    assert.notEqual(s.outline, 'none', 'the marker keeps the focus outline');
    assert.equal(s.inViewport, true);
    await settled();
    await page.screenshot({ path: path.join(shots, 'cards-1280-open.png'), fullPage: false });
    await page.keyboard.press('Tab');
    s = await page.evaluate(STATE);
    assert.equal(s.active, 'card', 'Tab moves into the card');
    assert.equal(s.open, 1, 'the card stays open while focus is inside it');
    await page.keyboard.press('Escape');
    s = await page.evaluate(STATE);
    assert.equal(s.open, 0);
    assert.equal(s.active, 'mark', 'Escape from inside the card returns focus to the marker');
    // Focus moving on: a card is open exactly when a marker has focus, and never more than one.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      const t = await page.evaluate(() => ({ onMark: document.activeElement.matches('a.term') || !!document.activeElement.closest('.jargon-card'), open: [...document.querySelectorAll('.jargon-card')].filter((c) => getComputedStyle(c).display !== 'none').length }));
      assert.equal(t.open, t.onMark ? 1 : 0, `after Tab ${i + 1}: ${t.open} card(s) open, focus ${t.onMark ? 'on a marker or in its card' : 'elsewhere'}`);
    }
    // The page capture: Escape closes any card, and the wait lets its 160 ms fade settle.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, 'cards-1280-page.png'), fullPage: false });
    await context.close();
    // Less motion asked for: nothing animates when a card opens.
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await context.route('**/*', async (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => /tap|click/i.test((document.querySelector('.jargon-note') || {}).textContent || ''));
    await page.locator('a.term').first().click();
    s = await page.evaluate(STATE);
    assert.equal(s.open, 1, 'a click opens the card');
    assert.equal(s.animations, 0, 'no animation runs under reduced motion');
    await context.close();
    // The plant: the island removed from the mount leaves a plain link and no card.
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { 'x-planted': '1' } });
    await context.route('**/*', async (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('a.term').first().focus();
    assert.equal(await page.locator('.jargon-card').count(), 0, 'without the island there is no card');
    assert.equal(await page.locator('a.term').first().getAttribute('href'), (await page.locator('a.term').first().getAttribute('href')) && `/glossary/#${await page.locator('a.term').first().getAttribute('data-entry')}`, 'the marker is still a link to its entry');
    await context.close();
    assert.deepEqual(errors, []);
    assert.ok(requests.every((u) => u.startsWith(`${origin}/`) || u === BEACON), `only same-origin requests and the site's analytics tag: ${requests.filter((u) => !u.startsWith(`${origin}/`) && u !== BEACON).slice(0, 3)}`);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  console.log(`screenshots: ${shots}`);
});

// Issue 716: the skill lookup reads each /skills/ row strictly, so a skill-entry row carries no marker, even
// past a list nested inside it; the same words in prose after the row still take one.
test('AC-2 issue 716: no marker inside a skill-entry row, past a nested list, and prose after it still reads', () => {
  const { applyTerms } = require('../scripts/glossary-terms.js');
  const page = (row) => '<!doctype html>\n<html lang="en">\n<head>\n<title>Skills</title>\n</head>\n<body>\n<main>\n<ul class="skill-list">' + row + '</ul>\n<p>The judge scores each answer.</p>\n</main>\n</body>\n</html>\n';
  const row = '<li class="skill-entry"><a class="skill-name" href="/skills/a/b/c/">c</a> <div class="skill-entry-row"><ul><li>one task</li></ul><p>A band for each task, against the baseline run.</p></div></li>';
  const ids = (h) => [...h.matchAll(/data-entry="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids(applyTerms(page(row))), ['term-judge']);
  // Plant: the same words outside a skill-entry row take their markers.
  assert.deepEqual(ids(applyTerms(page(row.replace('class="skill-entry"', 'class="other-entry"')))), ['term-band', 'term-baseline', 'term-judge']);
});

// Issue 753 (A-689-2): "type token" is a commit label, not the unit a model counts in, so no token card lands
// on it; the card still takes the first use in the model's sense.
const TYPE_TOKEN_CARD = /\b[Tt]ype\s+<!--driftproof:term--><a class="term"[^>]*data-entry="term-token"/;
test('AC-2 issue 753: the token card does not land on "type token", and the model\'s sense still takes it', () => {
  const { applyTerms } = require('../scripts/glossary-terms.js');
  const page = (prose) => `<!doctype html>\n<html lang="en">\n<head>\n<title>Tokens</title>\n</head>\n<body>\n<main>\n<p>${prose}</p>\n</main>\n</body>\n</html>\n`;
  const tokenWords = (h) => [...h.matchAll(/data-entry="term-token"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(tokenWords(applyTerms(page('It asked for a specific Conventional Commits type token in the subject.'))), [], 'plant: the card on a type token');
  assert.deepEqual(tokenWords(applyTerms(page('It asked for a Type token in the subject.'))), [], 'with a capital');
  assert.ok(!TYPE_TOKEN_CARD.test(applyTerms(page('A type token here, and one token per word there.'))), 'the commit sense is passed over');
  assert.ok(applyTerms(page('A type token here, and one token per word there.')).includes(`and one ${'<!--driftproof:term-->'}`), 'the next use, in the model\'s sense, takes the card');
  // The exclusion is the whole word "type": every other use keeps its card.
  assert.deepEqual(tokenWords(applyTerms(page('Each token costs money.'))), ['token']);
  assert.deepEqual(tokenWords(applyTerms(page('Input tokens cost money.'))), ['tokens']);
  assert.deepEqual(tokenWords(applyTerms(page('A prototype token costs money.'))), ['token']);
  // No published page carries the card on that sense, and a copy that does reads red.
  assert.deepEqual(pages().filter((rel) => TYPE_TOKEN_CARD.test(read(rel))), []);
  const h = read('docs/reports/001/index.html');
  assert.deepEqual(readPage(h).markers.filter((m) => m.id === 'term-token'), [], 'Report 001 carries no token card');
  const planted = plant(h, 'Conventional Commits type token (e.g.', `Conventional Commits type ${TERM_OPEN}<a class="term" href="/glossary/#term-token" data-entry="term-token" data-name="Token" data-plain="x">token</a>${TERM_CLOSE} (e.g.`);
  assert.ok(TYPE_TOKEN_CARD.test(planted), 'plant: a copy with the card on "type token" reads red');
});
