// Report 021's offline check reads page text with a linear scanner (CodeQL: no regex tag filter).
// Regression: the scanner drops comments, script and style bodies and tags, and decodes entities once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { htmlText } = require('../scripts/analyze-report-021.js');

test('drops comments, script and style bodies and tags', () => {
  assert.equal(htmlText('<p>a<!-- 9 --> <b>b</b></p><SCRIPT>x=1</script ><style>p{}</style>c'), 'a bc');
});

test('decodes each entity once, never a decoded one again', () => {
  assert.equal(htmlText('&amp;lt; &lt;b&gt; &quot;q&quot; &#39;s&#39;&nbsp;x'), '&lt; <b> "q" \'s\' x');
});

test('an unclosed comment or script ends the text', () => {
  assert.equal(htmlText('a<!-- 5'), 'a');
  assert.equal(htmlText('a<script>5'), 'a');
});

test('the published page still reads the same numbers', () => {
  const html = fs.readFileSync(path.join(__dirname, '../docs/reports/021/index.html'), 'utf8');
  const text = htmlText(html);
  assert.ok(text.includes('65.8%') && !/<|\bpopular\b/i.test(text));
});
