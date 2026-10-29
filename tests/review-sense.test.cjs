'use strict';
// Issue 509 (C-325): a review finding blocks only when it is wrong, broken or unsafe.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('509 the review prompt blocks only on a named wrong, broken or unsafe harm', () => {
  const prompt = read('.github/prompts/approve.md');
  assert.match(prompt, /blocks\s+only when you can name its concrete harm/);
  for (const word of ['wrong', 'broken', 'unsafe']) assert.match(prompt, new RegExp('\\b' + word + ' \\('));
  assert.match(prompt, /spec's letter missed while its substance\s+holds/);
  assert.doesNotMatch(prompt, /Unmet acceptance,\s+unsupported claims, material regressions and ineffective required checks\s+block/);
  assert.doesNotMatch(prompt, /re-derive numbers and framing/);
});

test('509 the Decision policy defect class is wrong, broken or unsafe, and the rest is non-blocking', () => {
  const policy = read('CONSTITUTION.md');
  const defect = policy.split('\n').find(l => l.startsWith('| `defect` |'));
  const optional = policy.split('\n').find(l => l.startsWith('| `non-blocking` |'));
  assert.match(defect, /Wrong, broken or unsafe/);
  assert.doesNotMatch(defect, /Unmet acceptance/);
  assert.match(optional, /spec's letter missed while its substance holds/);
  assert.match(read('DECISIONS.md'), /^\| C-325 \| review-policy \| Issue 509:/m);
});
