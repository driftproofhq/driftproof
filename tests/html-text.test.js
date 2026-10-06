// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for scripts/html-text.js (spec 148): the tokenizer and the text helper that replace
// every regex tag strip in the site builders.
//
//   node --test tests/html-text.test.js
//
// Each expected value below is written out by hand from the HTML tokenizer's rules (the WHATWG
// HTML standard's tokenization section). None is computed by the code under test.
//
// Every test name starts with the criterion it checks; spec 148's gate selects by that prefix.

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, htmlToText, attrOf } = require('../scripts/html-text.js');

const text = (html, opts = {}) => htmlToText(html, { collapse: true, ...opts });
const decodeBasic = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('AC-3 tags are removed and their text kept', () => {
  assert.equal(htmlToText('<p>a <b>b</b> <a href="x">c</a></p>'), 'a b c');
  assert.equal(htmlToText('plain'), 'plain');
  assert.equal(htmlToText(''), '');
});

test('AC-3 an attribute value that holds ">" does not end the tag', () => {
  assert.equal(htmlToText('<a title="x > y" href=\'>\'>link</a>'), 'link');
  assert.equal(htmlToText('<img alt="a>b" src=x>after'), 'after');
  assert.equal(htmlToText('<p data-x="</p>">kept</p>'), 'kept');
  const [t] = tokenize('<a title="x > y" href=\'>\' data-k=v>');
  assert.deepEqual(t.attrs, [['title', 'x > y'], ['href', '>'], ['data-k', 'v']]);
});

test('AC-3 names are lower-cased, an unquoted value ends at white space or ">", a bare attribute has no value', () => {
  const [a, b] = tokenize('<A HREF=/x/y CLASS="c d" hidden>t</A>');
  assert.equal(a.name, 'a');
  assert.deepEqual(a.attrs, [['href', '/x/y'], ['class', 'c d'], ['hidden', null]]);
  assert.equal(attrOf(a, 'class'), 'c d');
  assert.equal(attrOf(a, 'hidden'), null);
  assert.equal(attrOf(a, 'missing'), null);
  assert.deepEqual(b, { type: 'text', text: 't' });
});

test('AC-3 a self-closing slash is read, a slash inside an unquoted value is not', () => {
  const [br, a] = tokenize('<br/><a href=foo/>');
  assert.equal(br.selfClosing, true);
  assert.equal(a.selfClosing, false);
  assert.equal(attrOf(a, 'href'), 'foo/');
});

test('AC-3 comments are removed whole, in every form a browser ends them', () => {
  assert.equal(htmlToText('a<!-- <b>x</b> > -->b'), 'ab');
  assert.equal(htmlToText('a<!-->b'), 'ab');
  assert.equal(htmlToText('a<!--->b'), 'ab');
  assert.equal(htmlToText('a<!-- x --!>b'), 'ab');
  assert.equal(htmlToText('a<!---->b'), 'ab');
  assert.equal(htmlToText('a<!-- never closed <b>b</b>'), 'a');
  assert.equal(htmlToText('<!doctype html><?xml version="1.0"?>x<![CDATA[y]]>z'), 'xz');
  assert.equal(htmlToText('a</ b>c'), 'ac');
  assert.equal(htmlToText('a</>c'), 'ac');
  assert.equal(htmlToText('a<!-- x -->b', { commentText: ' ' }), 'a b');
});

test('AC-3 script and style content is dropped, in any letter case and with any closing form', () => {
  const opts = { skip: ['script', 'style'] };
  assert.equal(text('a<script>if (x<y) { s = "</p>"; }</script>b', opts), 'ab');
  assert.equal(text('a<SCRIPT>x</SCRIPT>b', opts), 'ab');
  assert.equal(text('a<script>x</script >b', opts), 'ab');
  assert.equal(text('a<script>x</script\n>b', opts), 'ab');
  assert.equal(text('a<script>x</script/>b', opts), 'ab');
  assert.equal(text('a<style>p > b { color: red }</STYLE>b', opts), 'ab');
  assert.equal(text('a<script src="x.js"></script>b<script>', opts), 'ab');
  assert.equal(text('a<script>never closed', opts), 'a');
  assert.equal(text('a<script>x</scripty>y</script>b', opts), 'ab');
  assert.equal(text('a<script>x</script>b', { ...opts, skipText: ' ' }), 'a b');
});

test('AC-3 a self-closing slash on a raw-text element does not close it, as a browser reads it', () => {
  const opts = { skip: ['script', 'style'] };
  assert.equal(text('a<script/>x()</script>b', opts), 'ab');
  assert.equal(text('a<style/>.c{}</style>b', opts), 'ab');
  assert.equal(text('a<SCRIPT src=x />y()</SCRIPT>b', opts), 'ab');
  assert.equal(text('a<script/>never closed', opts), 'a');
  // Unskipped, the content is one run of text and the element is not self-closing.
  assert.equal(htmlToText('a<script/>x()</script>b'), 'ax()b');
  const [open] = tokenize('<script/>');
  assert.equal(open.selfClosing, false);
  // Any other element keeps the flag the tokenizer read.
  assert.equal(tokenize('<br/>')[0].selfClosing, true);
  assert.equal(tokenize('<p/>')[0].selfClosing, true);
});

test('AC-3 a tag or comment token carries the source it was read from', () => {
  const toks = tokenize('a<B class="x>y">b</B><!-- c -->d<script/>e</script>');
  assert.deepEqual(toks.filter((t) => t.type !== 'text').map((t) => t.raw), ['<B class="x>y">', '</B>', '<!-- c -->', '<script/>', '</script>']);
  assert.equal(toks.map((t) => (t.type === 'text' ? t.text : t.raw)).join(''), 'a<B class="x>y">b</B><!-- c -->d<script/>e</script>');
});

test('AC-3 a tag nested inside a tag name cannot survive one pass', () => {
  assert.equal(text('<scr<script>ipt>alert(1)</script>', { skip: ['script'] }), 'ipt>alert(1)');
  assert.equal(text('<<script>script>x</script>y', { skip: ['script'] }), '<y');
  assert.equal(text('<!<!-- -->-- x -->'), '-- x -->');
});

test('AC-3 script content is text, not markup, when the caller does not skip it', () => {
  assert.equal(htmlToText('<script>a<b>c</script>d'), 'a<b>cd');
  assert.equal(htmlToText('<title>a <b> c</title>d'), 'a <b> cd');
  assert.equal(htmlToText('<textarea><p>x</p></textarea>y'), '<p>x</p>y');
});

test('AC-3 entities are text: never decoded before the tags are gone, decoded after when asked', () => {
  const html = '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;</p>';
  assert.equal(htmlToText(html), '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;');
  assert.equal(htmlToText(html, { decode: decodeBasic }), '<script>alert(1)</script> & "q"');
  assert.equal(htmlToText('&lt;b&gt;x<i>y</i>', { decode: decodeBasic, skip: ['b'] }), '<b>xy');
});

test('AC-3 decode runs on each run of text and not across a tag', () => {
  const seen = [];
  htmlToText('a&am<b>p;c', { decode: (t) => { seen.push(t); return t; } });
  assert.deepEqual(seen, ['a&am', 'p;c']);
});

test('AC-3 an unclosed tag is dropped with the rest of the input, an unclosed element keeps its text', () => {
  assert.equal(htmlToText('a <b c="d'), 'a ');
  assert.equal(htmlToText('a <b c=\'d>e'), 'a ');
  assert.equal(htmlToText('a <b c'), 'a ');
  assert.equal(htmlToText('a <b'), 'a ');
  assert.equal(htmlToText('a </b'), 'a ');
  assert.equal(htmlToText('<div><p>one<p>two <b>bold'), 'onetwo bold');
  assert.equal(text('<div><p>one<p>two', { blockTags: ['div', 'p'] }), 'one two');
});

test('AC-3 a "<" that opens no tag is text', () => {
  assert.equal(htmlToText('1 < 2 and 3 > 2'), '1 < 2 and 3 > 2');
  assert.equal(htmlToText('a <3 b'), 'a <3 b');
  assert.equal(htmlToText('x <'), 'x <');
  assert.equal(htmlToText('x </'), 'x </');
  assert.equal(htmlToText('<'), '<');
});

test('AC-3 block tags leave a space and inline tags leave none', () => {
  const opts = { blockTags: ['p', 'li', 'br'] };
  assert.equal(text('<p>0.05</p><p>next</p>', opts), '0.05 next');
  assert.equal(text('<p>0.05<data>x</data>.</p>', opts), '0.05x.');
  assert.equal(text('<li>a<br>b</li>', opts), 'a b');
  assert.equal(text('<P>a</P><LI>b', opts), 'a b');
  assert.equal(text('a<b>c</b>', { tagText: ' ' }), 'a c');
});

test('AC-3 skipIf drops an element and its content, nesting by name', () => {
  const skipIf = (t) => t.name === 'section' && attrOf(t, 'class') === 'q';
  assert.equal(text('x<section class="q">a<section>b</section>c</section>y', { skipIf }), 'xy');
  assert.equal(text('x<section class="q">a</section>b<section>c</section>', { skipIf }), 'xbc');
  assert.equal(text('x<section class="q">a</section>y', { skipIf, skipText: ' ' }), 'x y');
});

// A browser ignores the slash on an HTML element that is not void: the section runs to its end tag.
test('AC-3 a self-closing slash on a non-void element closes nothing, and on a void element it is harmless', () => {
  const skipIf = (t) => t.name === 'section' && attrOf(t, 'class') === 'q';
  assert.equal(text('x<section class="q"/>y', { skipIf }), 'x');
  assert.equal(text('x<section class="q"/>y</section>z', { skipIf }), 'xz');
  assert.equal(text('x<section class="q"/>a<section>b</section>c</section>z', { skipIf }), 'xz');
  assert.equal(text('x<section class="q"/>a<section/>b</section>c</section>z', { skipIf }), 'xz');
  assert.equal(text('x<img class="q"/>y', { skipIf: (t) => t.name === 'img' }), 'xy');
  assert.equal(text('x<p/>y', { skip: ['p'] }), 'x');
});

test('AC-3 a skipped void element does not swallow what follows', () => {
  assert.equal(text('a<img src=x>b<br>c', { skip: ['img', 'br'] }), 'abc');
});

test('AC-3 collapse reads runs of white space as one space and trims the ends', () => {
  assert.equal(htmlToText('  a \n\t b  <p> c </p> ', { collapse: true }), 'a b c');
  assert.equal(htmlToText('a  b'), 'a  b');
});

test('AC-3 an input of hostile shapes is read in linear time', () => {
  const shapes = {
    angle: '<'.repeat(300000),
    openTags: '<a '.repeat(100000),
    quotes: '<a b="'.repeat(100000),
    comments: '<!--'.repeat(100000),
    dashes: `<!--${'-'.repeat(300000)}`,
    scripts: '<script>'.repeat(100000),
    endTags: '</script x'.repeat(100000),
    bang: '<!'.repeat(150000),
    equals: `<a ${'="" !='.repeat(60000)}`,
    spaces: `<a${' '.repeat(300000)}b`,
  };
  for (const [name, html] of Object.entries(shapes)) {
    const t0 = Date.now();
    htmlToText(html, { skip: ['script', 'style'], collapse: true });
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, `${name}: ${html.length} characters took ${ms} ms`);
  }
});
