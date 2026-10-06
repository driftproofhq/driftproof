// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for the attribute escape the site builders share (spec 163): scripts/html-text.js
// escapeAttr, the canonical link a redirect stub's target is placed in (scripts/build-head-tags.js),
// and the anchor ids the contents rail writes (scripts/site-chrome.js).
//
//   node --test tests/attr-escape.test.js
//
// Each expected value is written out by hand from the rule (a value in a double-quoted attribute has
// its ampersand, double quote, less-than and greater-than escaped, ampersand first). None is
// computed by the code under test. Every test name starts with the criterion it checks; spec 163's
// gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, attrOf, escapeAttr } = require('../scripts/html-text.js');
const head = require('../scripts/build-head-tags.js');
const chrome = require('../scripts/site-chrome.js');

const { render } = head;
const { applyLayout, slugOf } = chrome;

const ORIGIN = 'https://driftproofhq.com';

// The canonical link a stub renders to, read by the tokenizer: its attributes, or null when the head
// has no link of that rel, so a quote that broke out of the value shows as an extra attribute.
function canonicalOf(target) {
  const stub = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=${target}"></head><body>moved</body></html>`;
  const lines = render(stub, 'zz/index.html').split('\n').filter((l) => /rel="canonical"/.test(l));
  assert.equal(lines.length, 1, 'one canonical link');
  const toks = tokenize(lines[0]).filter((t) => t.type === 'start');
  assert.equal(toks.length, 1, `one tag: ${lines[0]}`);
  return { line: lines[0], attrs: toks[0].attrs, href: attrOf(toks[0], 'href') };
}

test('AC-1 escapeAttr escapes the ampersand first, then the double quote, less-than and greater-than', () => {
  assert.equal(escapeAttr('a&b"c<d>e'), 'a&amp;b&quot;c&lt;d&gt;e');
  assert.equal(escapeAttr('&quot;'), '&amp;quot;');
  assert.equal(escapeAttr('"><script>x</script>'), '&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
  assert.equal(escapeAttr('/reports/013/#a-b'), '/reports/013/#a-b');
  assert.equal(escapeAttr(''), '');
  assert.equal(escapeAttr(5), '5');
});

test('AC-1 both builders take the shared helper as their esc, not a copy of it', () => {
  assert.equal(head.esc, escapeAttr);
  assert.equal(chrome.esc, escapeAttr);
  assert.equal(head.escapeAttr, escapeAttr);
});

test('AC-2 a stub whose target has no ampersand, quote or angle bracket keeps its canonical byte for byte', () => {
  for (const target of ['/authoring/', '/reports/013/', '/a/b-c_d/?x=1#frag', '/']) {
    const c = canonicalOf(target);
    assert.equal(c.line, `<link rel="canonical" href="${ORIGIN}${target}">`);
  }
});

test('AC-2 a stub target that spells an ampersand, quote or angle bracket reaches the canonical escaped, in one attribute', () => {
  const cases = [
    // [what the stub's attribute holds, the URL it spells, the canonical's href as written]
    ['/x?a=1&amp;b=2', '/x?a=1&b=2', '/x?a=1&amp;b=2'],
    ['/x?a=1&b=2', '/x?a=1&b=2', '/x?a=1&amp;b=2'],
    ['/x&quot;&gt;&lt;script&gt;', '/x"><script>', '/x&quot;&gt;&lt;script&gt;'],
    ['/x&#34; onmouseover=&#34;y', '/x" onmouseover="y', '/x&quot; onmouseover=&quot;y'],
    ['/x<b>', '/x<b>', '/x&lt;b&gt;'],
    ['/x&amp;quot;', '/x&quot;', '/x&amp;quot;'],
    // an ampersand spelled by a numeric reference is read once: the text after it stays text
    ['/x?q=&#38;lt;', '/x?q=&lt;', '/x?q=&amp;lt;'],
    ['/x&#38;amp;y', '/x&amp;y', '/x&amp;amp;y'],
    ['/x&#x26;quot;y', '/x&quot;y', '/x&amp;quot;y'],
    // a reference with no code point behind it stays as written, and the builder does not throw
    ['/x&#99999999;', '/x&#99999999;', '/x&amp;#99999999;'],
  ];
  for (const [held, , written] of cases) {
    const c = canonicalOf(held);
    assert.equal(c.line, `<link rel="canonical" href="${ORIGIN}${written}">`, held);
    assert.deepEqual(c.attrs.map((a) => a[0]), ['rel', 'href'], `no attribute beyond rel and href: ${held}`);
    assert.doesNotMatch(c.href, /["<>]/, held);
    assert.doesNotMatch(c.href, /&(?!(?:amp|quot|lt|gt);)/, held);
  }
});

test('AC-3 a heading\'s slug carries only lower-case letters, digits and hyphens, whatever the heading holds, a single hyphen at most at the cut', () => {
  const headings = [
    'Plain heading',
    'a "quoted" heading',
    'a &quot;quoted&quot; heading',
    'a &#34;numeric&#34; heading',
    `${'a'.repeat(59)} bb`,
    `${'b'.repeat(30)} "${'c'.repeat(40)}"`,
    '"><img src=x onerror=alert(1)>',
    '<b>bold</b> and <i>it\'s</i> "mixed"',
    'x" onmouseover="y',
    '“smart” quotes ‘here’',
    '&amp;&lt;&gt;&quot;',
    '"""',
    '',
  ];
  for (const h of headings) {
    const s = slugOf(h);
    assert.match(s, /^[a-z0-9]+(?:-[a-z0-9]+)*-?$/, JSON.stringify(h));
    assert.ok(s.length >= 1 && s.length <= 60, JSON.stringify(h));
  }
  assert.equal(slugOf('a "quoted" heading'), 'a-quoted-heading');
  assert.equal(slugOf('"""'), 'section');
  // the cut at 60 can leave the one hyphen the heading had there at the end; no other hyphen ends a slug
  assert.equal(slugOf(`${'a'.repeat(59)} bb`), `${'a'.repeat(59)}-`);
  assert.equal(slugOf(`${'a'.repeat(58)} bb`), `${'a'.repeat(58)}-b`);
});

function anchorsOf(html, rel) {
  return tokenize(applyLayout(html, rel))
    .filter((t) => t.type === 'start' && t.name === 'span' && /toc-anchor/.test(t.raw));
}

test('AC-3 an adversarial heading writes an anchor of one id and one class, and the same id in the rail', () => {
  const main = `<main><h1>t</h1>
<h2>a "quoted" heading</h2><p>x</p>
<h2>x" onmouseover="y</h2><p>x</p>
<h2>&quot;&gt;&lt;img src=x&gt;</h2><p>x</p>
<h2>a "quoted" heading</h2><p>x</p>
</main>`;
  const out = applyLayout(main, 'zz/index.html');
  const spans = anchorsOf(main, 'zz/index.html');
  assert.equal(spans.length, 4);
  assert.deepEqual(spans.map((s) => attrOf(s, 'id')), ['a-quoted-heading', 'x-onmouseover-y', 'img-src-x', 'a-quoted-heading-2']);
  for (const s of spans) assert.deepEqual(s.attrs.map((a) => a[0]), ['id', 'class']);
  for (const id of ['a-quoted-heading', 'x-onmouseover-y', 'img-src-x', 'a-quoted-heading-2']) assert.ok(out.includes(`<a href="#${id}">`), id);
});

test('AC-3 the anchor an essay\'s report link writes is on-report-NNN, one id and one class', () => {
  const main = `<main class="report"><p>See <a href="/reports/013/">the first "report"</a>.</p><p>Then <a href="/reports/007/">the second</a>.</p></main>`;
  const spans = anchorsOf(main, 'writing/zz/index.html');
  assert.deepEqual(spans.map((s) => attrOf(s, 'id')), ['on-report-013', 'on-report-007']);
  for (const s of spans) assert.deepEqual(s.attrs.map((a) => a[0]), ['id', 'class']);
});
