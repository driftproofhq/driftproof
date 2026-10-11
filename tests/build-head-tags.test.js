// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 5, spec 133 A-133-6. Independent expectations and in-memory plants.
//   nice -n 19 timeout 1800 node --test tests/build-head-tags.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { render, applyHeadTags } = require('../scripts/build-head-tags.js');
const FILE = path.join(__dirname, '..', 'scripts', 'build-head-tags.js');
const SOURCE = fs.readFileSync(FILE, 'utf8');
const HOSTILE = '& </ScRiPt ><script>"x"</script> & \\ café 雪';
const OPENING = 'Keep &lt;script&gt;data&lt;/script&gt; &amp; Unicode café as literal page text.';
const QUESTION = 'Can &lt;/ScRiPt &gt;&lt;script&gt;"x"&lt;/script&gt; &amp; \\ café stay?';
const ANSWER = 'Yes: &#60;/script&#62;&#60;script&#62;"x"&#60;/script&#62; &amp; \\ 雪.';
const EXPECTED_FAQ = {
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: [{ '@type': 'Question', name: 'Can </ScRiPt ><script>"x"</script> & \\ café stay?',
    acceptedAnswer: { '@type': 'Answer', text: 'Yes: </script><script>"x"</script> & \\ 雪.' } }],
};
function fixture(opening = OPENING, q = QUESTION, a = ANSWER) {
  return '<!doctype html><html><head><title>Fixture | Driftproof</title></head><body><main><h1>Fixture</h1><p>' + opening + '</p>'
    + '<section class="qa" id="fixture"><h2>' + q + '</h2><p class="answer">' + a + '</p></section></main></body></html>';
}
const HTML = fixture();
const PATHS = [
  ['fixture/index.html', ['FAQPage', 'Organization', 'WebPage']],
  ['index.html', ['Organization', 'SoftwareApplication', 'WebSite']],
  ['reports/001/index.html', ['BreadcrumbList', 'Organization', 'TechArticle']],
  ['paper/index.html', ['Dataset', 'FAQPage', 'Organization', 'ScholarlyArticle', 'WebPage']],
  ['maintainer/index.html', ['FAQPage', 'Organization', 'Person', 'WebPage']],
];
const TYPES = [...new Set(PATHS.flatMap(([, types]) => types))];

function compile(source, overrides = {}) {
  const copy = new Module(FILE, module);
  copy.filename = FILE;
  copy.paths = Module._nodeModulePaths(path.dirname(FILE));
  const realRequire = copy.require.bind(copy);
  copy.require = (id) => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id);
  copy._compile(source, FILE);
  return copy.exports;
}
function replaceOnce(source, old, next) {
  assert.equal(source.split(old).length, 2, 'plant anchor: ' + old);
  return source.replace(old, () => next);
}

// Hostile data enters each object at its construction site, before the actual shared writer.
// The observer saves the selected objects; it does not serialize or escape them.
function observed(plant = '') {
  let source = SOURCE.replaceAll('ld({', 'ld({ testHostile: ' + JSON.stringify(HOSTILE) + ',');
  source = replaceOnce(source, 'ld(organization())', 'ld({ ...organization(), testHostile: ' + JSON.stringify(HOSTILE) + ' })');
  if (plant.startsWith('M-18-') && plant !== 'M-18-drop') {
    const type = plant.slice('M-18-'.length);
    source = replaceOnce(source, 'JSON.stringify(obj, null, 2)', '(obj["@type"] === ' + JSON.stringify(type) + ' ? JSON.stringify(obj, null, 2) : JSON.stringify(obj, null, 2))');
    // A targeted writer bypass, while the other types keep the product serializer.
    source = source.replace(/const ld = /, 'const serializeLd = ');
    source = source.replace('// ── the Organization', 'const ld = (obj) => obj["@type"] === ' + JSON.stringify(type)
      + ' ? \'<script type="application/ld+json">\\n\' + JSON.stringify(obj, null, 2) + \'\\n</script>\' : serializeLd(obj);\n// ── the Organization');
  }
  if (plant === 'M-17') source = replaceOnce(source, 'name: strip(q)', 'name: "Lost question"');
  const marker = '// ── the Organization';
  assert.ok(source.includes(marker));
  source = source.replace(/const ld = /, 'const observedWriter = ');
  source = source.replace(marker, 'const selected = [];\nconst ld = (obj) => { selected.push(structuredClone(obj)); '
    + (plant === 'M-17s' ? 'if (obj.description) obj = { ...obj, description: "Lost description" }; ' : '')
    + (plant === 'M-18-drop' ? 'if (obj["@type"] === "Organization") return ""; ' : '')
    + 'return observedWriter(obj); };\n' + marker);
  if (plant === 'M-22') source = replaceOnce(source, 'const beacon = beaconFor(cfg.cloudflare_analytics_token);',
    'const beacon = beaconFor(cfg.cloudflare_analytics_token) + \'<script>extra()</script>\';');
  source += '\nmodule.exports.selected = selected;\n';
  return compile(source);
}
function readPage(page, types, cfg = {}) {
  const head = page.slice(0, page.indexOf('</head>') + 7);
  const blocks = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(blocks.length, types.length, 'AC-18 block count');
  for (const [, payload] of blocks) {
    for (const char of ['<', '>', '&']) assert.ok(!payload.includes(char), 'AC-16 raw ' + char + ' in JSON-LD');
  }
  const authorized = cfg.cloudflare_analytics_token ? 1 : 0;
  assert.equal((head.match(/<script\b/gi) || []).length, types.length + authorized, 'AC-22 authorized script count');
  assert.equal((head.match(/<\/script\s*>/gi) || []).length, types.length + authorized, 'AC-16 wrapper containment');
  if (authorized) {
    const expected = '<script type=\'module\' src=\'https://static.cloudflareinsights.com/beacon.min.js\' data-cf-beacon=\'{"token": "abc"}\'></script>';
    assert.ok(head.includes(expected), 'AC-22 configured beacon');
  }
  const objects = blocks.map(([, payload]) => JSON.parse(payload));
  assert.deepEqual(objects.map((o) => o['@type']).sort(), types, 'AC-18 block types');
  return objects;
}
function readPaths(product, observedValues = false) {
  for (const cfg of [{}, { cloudflare_analytics_token: 'abc' }]) {
    for (const [rel, types] of PATHS) {
      if (observedValues) product.selected.length = 0;
      const objects = readPage(product.render(HTML, rel, cfg), types, cfg);
      if (observedValues) {
        assert.ok(product.selected.every((o) => o.testHostile === HOSTILE), 'AC-18 hostile data in every type');
        assert.deepEqual(objects, product.selected, 'AC-17 selected metadata values');
      }
      if (types.includes('FAQPage')) {
        const faq = structuredClone(objects.find((o) => o['@type'] === 'FAQPage'));
        delete faq.testHostile;
        assert.deepEqual(faq, EXPECTED_FAQ, 'AC-17 FAQ text');
        assert.equal(objects.find((o) => o['@type'] === 'WebPage').description,
          'Keep <script>data</script> & Unicode café as literal page text.', 'AC-17 selected description');
      }
    }
  }
}
function omitEscape(char) {
  // Replace only the shared writer. No product escaping helper is used by the reader.
  return compile(SOURCE.replace(/const ld = [\s\S]*?(?=\n\/\/ ── the Organization)/,
    () => 'const ld = (obj) => { const escapes = { "<": "\\\\u003c", ">": "\\\\u003e", "&": "\\\\u0026" }; '
      + 'const json = JSON.stringify(obj, null, 2).replace(/[<>&]/g, c => c === ' + JSON.stringify(char) + ' ? c : escapes[c]); '
      + 'return \'<script type="application/ld+json">\\n\' + json + \'\\n</script>\'; };\n'));
}

test('AC-16 to AC-18 and AC-22 production paths contain data and preserve selected values with analytics', () => {
  readPaths({ render });
  readPaths(observed(), true);
});
test('AC-16 each omitted escape reads RED', () => {
  for (const char of ['<', '>', '&']) assert.throws(() => readPaths(omitEscape(char)), /AC-16 raw/, 'M-16 ' + char);
});
test('AC-18 each independent type bypass and a dropped block read RED', () => {
  readPaths(observed(), true);
  for (const type of TYPES) assert.throws(() => readPaths(observed('M-18-' + type), true), /AC-16 raw|AC-18 block count/, type);
  assert.throws(() => readPaths(observed('M-18-drop'), true), /AC-18 block count/);
});
test('AC-17 value corruption and AC-22 unauthorized scripts read RED', () => {
  assert.throws(() => readPaths(observed('M-17'), true), /AC-17 FAQ text/);
  assert.throws(() => readPaths(observed('M-17s'), true), /AC-17 selected metadata values/);
  assert.throws(() => readPaths(observed('M-22'), true), /AC-22 authorized script count/);
});

const ENTITY_INPUT = '&#38;lt;script&#38;gt; &amp;lt;tag&amp;gt; &copy; &quot; &#x1F雪; &#x1F600; &nbsp; &#0; &#xD800; &#x110000; &#99999999999999999999999; &unknown; &#xzz;';
const ENTITY_EXPECTED = '&lt;script&gt; &lt;tag&gt; © " &#x1F雪; 😀 � � � � &unknown; &#xzz;';
function readEntities(product) {
  const objects = readPage(product.render(fixture(OPENING, ENTITY_INPUT, ENTITY_INPUT), 'fixture/index.html', {}), PATHS[0][1]);
  const faq = objects.find((o) => o['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity[0].name, ENTITY_EXPECTED, 'AC-19 one-pass entities');
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, ENTITY_EXPECTED, 'AC-19 answer entities');
}
test('AC-19 references decode once and invalid scalar references do not throw', () => { readEntities({ render }); });
test('AC-19 repeat, copyright omission and invalid numeric conversion read RED', () => {
  readEntities({ render });
  for (const [plant, from, to] of [
    ['M-19-repeat', '{ decode, collapse: true }', '{ decode: s => decode(decode(s)), collapse: true }'],
    ['M-19-copy', "copy: '©'", "copy: '&copy;'"],
    ['M-19-invalid', "return valid ? String.fromCodePoint(cp) : '\\uFFFD';", 'return String.fromCodePoint(cp);'],
  ]) assert.throws(() => readEntities(compile(replaceOnce(SOURCE, from, to))), /AC-19|Invalid code point/, plant);
});

function readSelection(product) {
  const cases = [
    ['word '.repeat(32).trim(), 'word '.repeat(30).trim() + '…'],
    ['Opening \u2014 and literal text.', 'Opening. Yes: </script><script>"x"</script> & \\ 雪.'],
  ];
  for (const [opening, expected] of cases) {
    const objects = readPage(product.render(fixture(opening), 'fixture/index.html', {}), PATHS[0][1]);
    assert.equal(objects.find((o) => o['@type'] === 'WebPage').description, expected, 'AC-17 existing summarization');
  }
}
test('AC-17 existing description truncation and punctuation rules remain', () => { readSelection({ render }); });

const MAX_PAGE = 2 * 1024 * 1024;
const invalid = (e) => e instanceof Error && e.code === 'HEAD_INPUT_INVALID' && e.name === 'HeadInputError';
const UNCLOSED = '<section class="qa" id="unclosed"><h2>Question?</h2><p class="answer">Answer.</p>';
function readRefusal(product) {
  for (const fn of [product.render, product.applyHeadTags]) {
    const sized = HTML + 'x'.repeat(MAX_PAGE - Buffer.byteLength(HTML));
    assert.doesNotThrow(() => fn(sized, 'fixture/index.html', {}), 'AC-20 size boundary');
    assert.throws(() => fn(sized + 'é', 'fixture/index.html', {}), invalid, 'AC-20 oversized UTF-8');
    for (const bad of [UNCLOSED, UNCLOSED.repeat(1000), '<section class="qa" id="x"><h2>Question?</h2></section>']) {
      assert.throws(() => fn(HTML.replace('</main>', bad + '</main>'), 'fixture/index.html', {}), invalid, 'AC-20 malformed QA');
    }
  }
}
test('AC-20 both entry points refuse oversized and malformed QA with a named error', () => { readRefusal({ render, applyHeadTags }); });
test('AC-20 bound bypass and unclosed-section omission read RED', () => {
  readRefusal({ render, applyHeadTags });
  assert.throws(() => readRefusal(compile(replaceOnce(SOURCE, 'if (bytes > MAX_PAGE_BYTES)', 'if (false)'))), /AC-20 oversized/);
  assert.throws(() => readRefusal(compile(replaceOnce(SOURCE, 'if (active) throw headInputError', 'if (false) throw headInputError'))), /AC-20 malformed/);
});
test('AC-20 repeated unclosed QA refuses within five seconds in a separate process', () => {
  const code = 'const {render}=require(' + JSON.stringify(FILE) + '); try {render(' + JSON.stringify(HTML)
    + '.replace("</main>", ' + JSON.stringify(UNCLOSED) + '.repeat(20000)+"</main>"),"fixture/index.html",{});process.exitCode=2;}'
    + 'catch(e){if(e.code!=="HEAD_INPUT_INVALID")throw e; console.log("HEAD_INPUT_INVALID");}';
  const r = spawnSync('nice', ['-n', '19', process.execPath, '-e', code], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, 'AC-20 bounded refusal: ' + r.stderr + (r.error || ''));
  assert.equal(r.stdout.trim(), 'HEAD_INPUT_INVALID');
});

// Exercise the real CLI branch, replacing only its page enumeration and filesystem at the boundary.
// No tree files are written. Every fake path is under the system temp directory's namespace.
function cli(source, pages, { check = false } = {}) {
  const writes = [];
  const messages = [];
  const entries = Object.entries(pages);
  const fakeFs = Object.create(fs);
  fakeFs.statSync = f => Object.hasOwn(pages, f) ? { size: Buffer.byteLength(pages[f]) } : fs.statSync(f);
  fakeFs.readFileSync = (f, ...args) => Object.hasOwn(pages, f) ? pages[f] : fs.readFileSync(f, ...args);
  fakeFs.writeFileSync = (f, data) => { writes.push([f, data]); };
  const fakeProcess = { argv: check ? ['node', FILE, '--check'] : ['node', FILE], exit: code => { const e = new Error('CLI exit'); e.exitCode = code; throw e; }, exitCode: 0 };
  const prelude = 'const process = module.testProcess; const console = module.testConsole;\n';
  source = source.replace('if (require.main === module)', 'pageFiles = () => ' + JSON.stringify(entries.map(([f]) => f)) + ';\nif (true)');
  const copy = new Module(FILE, module);
  copy.filename = FILE; copy.paths = Module._nodeModulePaths(path.dirname(FILE));
  copy.testProcess = fakeProcess; copy.testConsole = { log: x => messages.push(x), error: x => messages.push(x) };
  const realRequire = copy.require.bind(copy);
  copy.require = id => id === 'fs' ? fakeFs : realRequire(id);
  let code = 0;
  try { copy._compile(prelude + source.replace(/^#![^\n]*\n/, ''), FILE); code = fakeProcess.exitCode; } catch (e) { if (e.exitCode === undefined) throw e; code = e.exitCode; }
  return { writes, messages, code };
}
const fakePath = i => path.join(path.dirname(FILE), '..', 'docs', 'test-' + i + '.html');
function readBatch(source) {
  for (const bad of [HTML.replace('</main>', UNCLOSED + '</main>'), HTML + 'x'.repeat(MAX_PAGE)]) {
    for (const check of [false, true]) {
      const r = cli(source, { [fakePath(0)]: HTML, [fakePath(1)]: bad }, { check });
      assert.equal(r.code, 1, 'AC-21 invalid batch exit');
      assert.equal(r.writes.length, 0, 'AC-21 no partial writes');
      assert.match(r.messages.join('\n'), /head input refused/, 'AC-21 short refusal diagnostic');
    }
  }
  const many = Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [fakePath(i), HTML]));
  const total = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [fakePath(i), HTML + 'x'.repeat(MAX_PAGE - Buffer.byteLength(HTML))]));
  for (const [pages, label] of [[many, 'page count'], [total, 'total bytes']]) {
    const r = cli(source, pages);
    assert.equal(r.code, 1, 'AC-21 ' + label + ' refusal');
    assert.equal(r.writes.length, 0, 'AC-21 ' + label + ' no writes');
  }
  const good = cli(source, { [fakePath(0)]: HTML, [fakePath(1)]: HTML });
  assert.equal(good.code, 0, 'AC-21 valid batch');
  assert.equal(good.writes.length, 2, 'AC-21 writes both valid pages');
}
test('AC-21 CLI renders and validates the bounded batch before any page write', () => { readBatch(SOURCE); });
test('AC-21 early write and each batch-bound bypass read RED', () => {
  readBatch(SOURCE);
  for (const [from, to, reason] of [
    ['pending.push({ f, after });', 'fs.writeFileSync(f, after); pending.push({ f, after });', /AC-21 no partial writes/],
    ['if (files.length > MAX_BATCH_PAGES)', 'if (false)', /AC-21 page count refusal/],
    ['if (total > MAX_BATCH_BYTES)', 'if (false)', /AC-21 total bytes refusal/],
  ]) assert.throws(() => readBatch(replaceOnce(SOURCE, from, to)), reason);
});
