// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for visibleText and documentText in tests/assertion-scope.js, the
// shared reader every count and claim assertion reads a document through.
//
//   node --test tests/visible-text.test.js
//
// Spec 013, amendment 5. A tag is a `<` followed by a letter, `/` or `!`. A bare
// `<` is text. Each expected value is written out by hand; none is computed by
// the code under test. Spec 013's gate runs this file, and runs it again against
// copies of the reader with the tag rule broken each way, expecting red.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const scope = require(path.join(__dirname, 'assertion-scope.js'));

test('A-013-5 a real tag is stripped: an element, a closing tag, a comment and a doctype', () => {
  assert.equal(scope.visibleText('<p>one <b>two</b></p>').trim(), 'one two');
  assert.equal(scope.visibleText('a<br/>b').trim(), 'a b');
  assert.equal(scope.visibleText('<!-- hidden -->kept').trim(), 'kept');
  assert.equal(scope.visibleText('<!doctype html><title>t</title>').trim(), 't');
});

test('A-013-5 a bare "<" is kept, and the text after it stays visible', () => {
  assert.equal(scope.visibleText('when n < 2 the rule holds. Later > text.').trim(), 'when n < 2 the rule holds. Later > text.');
  assert.equal(scope.visibleText('a <= b and c < d').trim(), 'a <= b and c < d');
  assert.equal(scope.visibleText('x < 1 <p>y</p>').trim(), 'x < 1 y');
});

test('A-013-5 documentText keeps the text after a bare "<" in a Markdown file', () => {
  const md = 'With n < 2 a band is not computed.\n\nA reader validates against the receipt\'s own schema_version.\n\n<a href="#x">link</a> end.';
  const t = scope.documentText(md);
  assert.ok(t.includes("validates against the receipt's own schema_version"), t);
  assert.ok(t.includes('n < 2'), t);
  assert.ok(!t.includes('href'), t);
});

test('issue 78: a script or style block is dropped whatever its case and however its end tag is spaced', () => {
  for (const src of ['a <SCRIPT>x = 1</SCRIPT> b', 'a <script>x = 1</script > b', 'a <Script type="m">x</script\n foo> b', 'a <STYLE>p{}</style > b']) {
    assert.equal(scope.visibleText(src).trim(), 'a b', src);
  }
});
