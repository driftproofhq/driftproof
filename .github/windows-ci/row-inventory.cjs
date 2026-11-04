// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 675: the expected row inventory is read from each suite's source at run time, by rule.
// The rule: every test declaration the scanner finds, with literal for-of name loops expanded and
// nested declarations prefixed by their parents. No test body or platform branch runs, so a row
// a conditional registration or a name filter omits is still expected (AC-16). Nothing is pinned.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function tokens(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const start = i, c = source[i], prev = out.at(-1)?.text;
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (source.startsWith('/*', i)) { i = source.indexOf('*/', i + 2); assert.ok(i >= 0); i += 2; continue; }
    if (c === "'" || c === '"' || c.charCodeAt(0) === 96) {
      i++;
      while (i < source.length) { if (source[i] === '\\') { i += 2; continue; } if (source[i++] === c) break; }
      out.push({ text: source.slice(start, i), kind: 'string' }); continue;
    }
    if (c === '/' && (!prev || /^(?:[=(,:!\[?{;]|return|=>|\|\||&&)$/.test(prev))) {
      let cls = false; i++;
      while (i < source.length) {
        const x = source[i++];
        if (x === '\\') { i++; continue; }
        if (x === '[') cls = true;
        if (x === ']') cls = false;
        if (x === '/' && !cls) break;
      }
      while (/[a-z]/i.test(source[i] || '') && i < source.length) i++;
      out.push({ text: source.slice(start, i), kind: 'regex' }); continue;
    }
    if (/[\w$]/.test(c)) { while (i < source.length && /[\w$]/.test(source[i])) i++; }
    else if (source.startsWith('=>', i)) i += 2;
    else i++;
    out.push({ text: source.slice(start, i), kind: 'code' });
  }
  return out;
}
function enumerate(source) {
  // V8 checks grammar; the scanner only recognizes declarations, not execution.
  new vm.Script('(function(require,module,exports,__dirname,__filename){\n' + source + '\n})');
  const t = tokens(source), pairs = new Map(), stack = [];
  for (let i = 0; i < t.length; i++) {
    if (['(', '[', '{'].includes(t[i].text)) stack.push(i);
    else if ([')', ']', '}'].includes(t[i].text)) {
      const open = stack.pop(); assert.ok(open !== undefined, 'balanced source');
      assert.equal('([{'.indexOf(t[open].text), ')]}'.indexOf(t[i].text)); pairs.set(open, i);
    }
  }
  assert.equal(stack.length, 0, 'source tokens balanced');
  const declarations = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i].text !== 'test' || t[i + 1]?.text !== '(' || t[i + 2]?.kind !== 'string') continue;
    if (t[i - 1]?.text === '.' && t[i - 2]?.kind !== 'code') continue;
    const end = pairs.get(i + 1);
    let arrow = i + 3;
    while (arrow < end && t[arrow].text !== '=>') arrow++;
    assert.ok(arrow < end && t[arrow + 1]?.text === '{', 'a test declaration has a block callback');
    const body = arrow + 1;
    const parent = declarations.findLast((d) => d.body < i && d.endBody > i);
    let contexts = [{}];
    for (let j = 0; j < i; j++) {
      if (t[j].text !== 'for' || t[j + 1]?.text !== '(' || t[j + 2]?.text !== 'const' || t[j + 4]?.text !== 'of' || t[j + 5]?.text !== '[') continue;
      const close = pairs.get(j + 5), forClose = pairs.get(j + 1), scope = forClose + 1;
      if (t[scope]?.text !== '{' || !(scope < i && pairs.get(scope) > i)) continue;
      const variable = t[j + 3].text;
      const values = vm.runInNewContext(t.slice(j + 5, close + 1).map((x) => x.text).join(' '), Object.create(null));
      assert.ok(Array.isArray(values) && values.every((v) => typeof v === 'string'), 'literal name loop');
      contexts = contexts.flatMap((ctx) => values.map((v) => ({ ...ctx, [variable]: v })));
    }
    const paths = contexts.map((context) => {
      const name = vm.runInNewContext(t[i + 2].text, context);
      assert.equal(typeof name, 'string');
      const prefix = parent ? parent.paths[contexts.indexOf(context)] || parent.paths[0] : [];
      return [...prefix, name];
    });
    declarations.push({ body, endBody: pairs.get(body), paths });
  }
  const rows = declarations.flatMap((d) => d.paths);
  assert.ok(rows.length, 'source declares tests');
  assert.equal(new Set(rows.map(JSON.stringify)).size, rows.length, 'duplicate source row identity');
  return rows;
}
// The inventory for each listed suite, read from the checkout as it stands.
function build(root, files) {
  return Object.fromEntries(files.map((file) => [file, enumerate(fs.readFileSync(path.join(root, file), 'utf8'))]));
}
module.exports = { enumerate, build };
