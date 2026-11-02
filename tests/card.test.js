// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for spec 628: `driftproof card <receipt.json>` draws one sealed receipt's result, in the
// words `driftproof view` gives it, as one SVG that loads nothing, and prints a lift only for a state
// that measured one.
//
//   node --test tests/card.test.js
//
// No model is called. The receipts are committed ones (report 013's three runs, report 016, the
// bundled example and report 015's router receipt) and stub receipts (DRIFTPROOF_STUB=1) of a quick run
// and a full run. Every file is written under the system temp directory and removed after. A plant on
// lib/card.js is a copy of it in a temp directory, its requires pointed back at this tree, so the tree
// is never written. Every test name starts with the criterion it checks.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { listReceipts, sealReceipt } = require('../lib/receipt');
const { plainOf, LABELS } = require('../lib/plain');
const { receiptVerdict, placeboReading, placeboLine } = require('../lib/verdict');
const { cellOf, renderCell } = require('../lib/band-plot');
const { invisibleShown } = require('../lib/names');
const { DECLARATIONS } = require('../lib/view-tokens');
const policy = require('../lib/report-015-publication');
const { RUNNER_VERSION } = require('../config');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const CARD_JS = path.join(ROOT, 'lib', 'card.js');
const EXAMPLE = path.join(ROOT, 'receipts', 'commit-message-conventions-claude-haiku-4-5-20251001-2026-09-17.json');
const ROUTER = path.join(ROOT, 'receipts', 'skill-measurements', 'published', '55e499f055d657d74ea5c5bf0887eda697a500ec1f817fc69aa82d5fd7d27b6d.json');
const ASSET = path.join(ROOT, 'docs', 'assets', 'card-commit-message-conventions.svg');
const MODEL = 'claude-haiku-4-5';
const MEASURED = ['PASSED', 'REGRESSED', 'NO_EFFECT'];
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spec628-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const clone = (x) => JSON.parse(JSON.stringify(x));
const card = () => require(CARD_JS);

function env(extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^SPEC0|^SOURCE_DATE_EPOCH$|^GIT_/.test(k)) continue;
    e[k] = v;
  }
  return { ...e, ...extra };
}
const cli = (args, { cwd = ROOT, extra = {} } = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd, env: env(extra), encoding: 'utf8', timeout: 300000 });

// ── the receipts read ────────────────────────────────────────────────────────

function skill(root, n, name = `fx-card-${n}`) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\nversion: 1.0.0\n---\n\n# ${name}\n\nAnswer in one short sentence.\n`);
  const cases = Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, prompt: `Question ${i + 1}?`, rubric: 'One short sentence scores 0.80.' }));
  fs.writeFileSync(path.join(dir, 'evals', 'evals.json'), JSON.stringify({ cases }, null, 2));
  return dir;
}
function stubReceipt(root, args, out) {
  const r = cli(['run', skill(root, 3), '--models', MODEL, '--out', path.join(root, out), ...args], { cwd: root, extra: { DRIFTPROOF_STUB: '1' } });
  assert.equal(r.status, 0, r.stderr);
  const f = fs.readdirSync(path.join(root, out)).filter((x) => x.endsWith('.json'));
  assert.equal(f.length, 1, `one receipt in ${out}: ${f}`);
  return path.join(root, out, f[0]);
}

let FX = null;
function fixtures() {
  if (FX) return FX;
  const files = [];
  for (const run of ['run-1', 'run-2', 'run-3']) for (const x of listReceipts(path.join(ROOT, 'receipts', 'report-013', run))) files.push(x.file);
  for (const x of listReceipts(path.join(ROOT, 'receipts', 'report-016'))) files.push(x.file);
  const root = tmp();
  const quick = stubReceipt(root, ['--quick'], 'quick');
  const full = stubReceipt(root, [], 'full');
  files.push(EXAMPLE, quick, full);
  const list = files.map((file) => ({ file, receipt: JSON.parse(fs.readFileSync(file, 'utf8')) }));
  FX = { list, quick, full, root };
  return FX;
}

// ── the readers ──────────────────────────────────────────────────────────────

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// The text of every <text> element carrying data-field="<field>", in order, unescaped.
function fieldLines(svg, field) {
  const re = new RegExp(`<text\\b[^>]*\\bdata-field="${field}"[^>]*>([^<]*)</text>`, 'g');
  return [...svg.matchAll(re)].map((m) => unescape(m[1]));
}
const fieldText = (svg, field) => fieldLines(svg, field).join(' ');
const LIFT = /\blift [+-]\d\.\d{3}\b/;

// Well-formed XML, read by a small strict reader: one root element, every tag closed in order, every
// attribute quoted and unique, every `&` a known or numeric reference, no bare `<` in text.
function xmlProblems(src) {
  const problems = [];
  const stack = [];
  let roots = 0;
  let i = 0;
  const NAME = /^[A-Za-z_][\w.:-]*/;
  const refs = (s, where) => {
    for (const m of s.matchAll(/&([^;\s]*);?/g)) {
      if (!/^(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+)$/.test(m[1]) || !m[0].endsWith(';')) problems.push(`a bare & in ${where}: ${m[0].slice(0, 12)}`);
    }
  };
  if (src.startsWith('<?xml')) i = src.indexOf('?>') + 2;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const text = lt < 0 ? src.slice(i) : src.slice(i, lt);
    if (text.trim() && !stack.length) problems.push(`text outside the root: ${text.trim().slice(0, 20)}`);
    if (text.includes('>')) problems.push(`a bare > in text: ${text.slice(0, 20)}`);
    refs(text, 'text');
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); if (e < 0) { problems.push('an open comment'); break; } i = e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); if (e < 0) { problems.push('an open CDATA'); break; } i = e + 3; continue; }
    const gt = src.indexOf('>', lt);
    if (gt < 0) { problems.push('an open tag'); break; }
    const tag = src.slice(lt + 1, gt);
    if (tag.includes('<')) problems.push(`a bare < before a tag closed: ${tag.slice(0, 20)}`);
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const open = stack.pop();
      if (open !== name) problems.push(`</${name}> closes <${open}>`);
    } else {
      const selfClose = tag.endsWith('/');
      const body = selfClose ? tag.slice(0, -1) : tag;
      const m = body.match(NAME);
      if (!m) { problems.push(`a tag with no name: <${tag.slice(0, 20)}`); i = gt + 1; continue; }
      let rest = body.slice(m[0].length);
      const seen = new Set();
      while (rest.trim()) {
        const a = rest.match(/^\s+([A-Za-z_][\w.:-]*)="([^"<]*)"/);
        if (!a) { problems.push(`an attribute not name="value" in <${m[0]}: ${rest.trim().slice(0, 20)}`); break; }
        if (seen.has(a[1])) problems.push(`attribute ${a[1]} twice in <${m[0]}>`);
        seen.add(a[1]);
        refs(a[2], `${m[0]}@${a[1]}`);
        rest = rest.slice(a[0].length);
      }
      if (!stack.length) roots++;
      if (!selfClose) stack.push(m[0]);
    }
    i = gt + 1;
  }
  if (stack.length) problems.push(`unclosed: ${stack.join(' > ')}`);
  if (roots !== 1) problems.push(`${roots} root elements`);
  return problems;
}

// What may not be in a card: anything that loads or runs. `href` is the one link the person gave.
const SVG_NS = 'http://www.w3.org/2000/svg';
function unsafeParts(svg, href = null) {
  const out = [];
  for (const re of [/<script/i, /<image/i, /<foreignObject/i, /<iframe/i, /<use\b/i, /@import/i, /\son[a-z]+\s*=/i, /javascript:/i]) if (re.test(svg)) out.push(String(re));
  for (const m of svg.matchAll(/url\(([^)]*)\)/g)) if (!/^#[\w-]+$/.test(m[1])) out.push(`url(${m[1]})`);
  let rest = svg.split(`xmlns="${SVG_NS}"`).join('');
  if (href) rest = rest.split(`href="${href}"`).join('');
  if (/http/i.test(rest)) out.push('http');
  return out;
}

// A copy of lib/card.js with `from` replaced by `to`, its requires pointed at this tree.
function plantedCard(from, to) {
  const src = fs.readFileSync(CARD_JS, 'utf8');
  assert.ok(src.includes(from), `the plant's anchor is in lib/card.js: ${from}`);
  const text = src.split(from).join(to)
    .replace(/require\('\.\/([^']+)'\)/g, (_, p) => `require(${JSON.stringify(path.join(ROOT, 'lib', p))})`)
    .replace(/require\('\.\.\/([^']+)'\)/g, (_, p) => `require(${JSON.stringify(path.join(ROOT, p))})`);
  const file = path.join(tmp(), 'card.js');
  fs.writeFileSync(file, text);
  return { mod: require(file), src: text };
}

// The label and sentence of a card, against plainOf; the problems, or none.
function wordsProblems(svg, receipt) {
  const p = plainOf(receipt);
  const out = [];
  const label = fieldText(svg, 'label');
  if (label !== invisibleShown(p.label)) out.push(`label ${JSON.stringify(label)} is not plainOf's ${JSON.stringify(p.label)}`);
  if (!Object.values(LABELS).includes(label) && label !== 'Comparison unreliable') out.push(`label ${JSON.stringify(label)} is not in LABELS`);
  const sentence = fieldText(svg, 'sentence');
  if (sentence !== invisibleShown(p.sentence)) out.push(`sentence ${JSON.stringify(sentence)} is not plainOf's`);
  return out;
}
// A typed label: any of LABELS' words written in lib/card.js's text.
const typedLabels = (src) => Object.values(LABELS).filter((w) => src.includes(`'${w}'`) || src.includes(`"${w}"`) || src.includes(`\`${w}\``));
const liftShown = (svg) => LIFT.test(svg);
const liftExpected = (receipt) => MEASURED.includes(receiptVerdict(receipt).verdict) && !require('../lib/text-capture').fakeToolCallWarning(receipt);

// ── AC-1 ─────────────────────────────────────────────────────────────────────

test('AC-1 every card carries plainOf\'s label and sentence, and the label is one of LABELS', () => {
  const { cardSvg } = card();
  const { list } = fixtures();
  // Report 013's 27, report 016's 14, the example and the two stub receipts.
  assert.ok(list.length >= 44, `${list.length} receipts read`);
  for (const { file, receipt } of list) {
    if (policy.routerLimit(receipt)) continue;
    assert.deepEqual(wordsProblems(cardSvg(receipt), receipt), [], path.basename(file));
  }
});

test('AC-1 lib/card.js types none of LABELS\' words', () => {
  assert.deepEqual(typedLabels(fs.readFileSync(CARD_JS, 'utf8')), []);
});

test('AC-1 MUTATION: a label typed into a copy of lib/card.js reads RED, by its output and by its source', () => {
  const { list } = fixtures();
  const under = list.find((x) => plainOf(x.receipt).label === LABELS.UNDERPOWERED);
  const stale = plantedCard('const label = plain.label;', "const label = ({ UNDERPOWERED: 'Too few answers' })[plain.state] || plain.label;");
  assert.notDeepEqual(wordsProblems(stale.mod.cardSvg(under.receipt), under.receipt), [], 'a stale typed label reads RED by its output');
  const same = plantedCard('const label = plain.label;', "const label = ({ UNDERPOWERED: 'Too few answers to tell' })[plain.state] || plain.label;");
  assert.deepEqual(typedLabels(same.src), ['Too few answers to tell'], 'the same word typed in reads RED by the source check');
});

// ── AC-2 ─────────────────────────────────────────────────────────────────────

test('AC-2 a lift figure is printed if and only if the state measured one, and it is the receipt\'s delta', () => {
  const { cardSvg } = card();
  const { list } = fixtures();
  const seen = new Set();
  for (const { file, receipt } of list) {
    const svg = cardSvg(receipt);
    const want = liftExpected(receipt) && !policy.routerLimit(receipt);
    seen.add(`${receiptVerdict(receipt).verdict}:${want}`);
    assert.equal(liftShown(svg), want, `${path.basename(file)} (${receiptVerdict(receipt).verdict})`);
    if (want) {
      const d = receipt.comparison.delta;
      assert.match(fieldText(svg, 'lift'), new RegExp(`^lift ${d >= 0 ? '\\+' : '-'}${Math.abs(d).toFixed(3).replace('.', '\\.')}\\b`), path.basename(file));
    } else assert.equal(fieldLines(svg, 'lift').length, 0, path.basename(file));
  }
  for (const k of ['PASSED:true', 'NO_EFFECT:true', 'UNDERPOWERED:false', 'NOT_MEASURED:false']) assert.ok(seen.has(k), `the receipts read hold ${k}`);
});

test('AC-2 a smoke receipt reads "Smoke run, no verdict" and a stub full run "Reported, not measured", neither with a lift', () => {
  const { cardSvg } = card();
  const { quick, full } = fixtures();
  const q = JSON.parse(fs.readFileSync(quick, 'utf8'));
  const f = JSON.parse(fs.readFileSync(full, 'utf8'));
  const qs = cardSvg(q); const fs_ = cardSvg(f);
  assert.equal(fieldText(qs, 'label'), LABELS.SMOKE);
  assert.equal(fieldText(fs_, 'label'), LABELS.REPORTED);
  assert.ok(!liftShown(qs) && !liftShown(fs_));
});

test('AC-2 MUTATION: a copy of lib/card.js that counts UNDERPOWERED as measured reads RED', () => {
  const { list } = fixtures();
  const { mod } = plantedCard("const MEASURED = ['PASSED', 'REGRESSED', 'NO_EFFECT'];", "const MEASURED = ['PASSED', 'REGRESSED', 'NO_EFFECT', 'UNDERPOWERED'];");
  const under = list.filter((x) => receiptVerdict(x.receipt).verdict === 'UNDERPOWERED');
  assert.ok(under.length > 0);
  assert.ok(under.some((x) => liftShown(mod.cardSvg(x.receipt)) !== liftExpected(x.receipt)), 'a lift on an UNDERPOWERED receipt reads RED');
});

// ── AC-3 ─────────────────────────────────────────────────────────────────────

const routerProblems = (svg) => {
  const out = [];
  if (fieldText(svg, 'label') !== policy.LABEL) out.push(`label ${fieldText(svg, 'label')}`);
  if (fieldText(svg, 'sentence') !== policy.REASON) out.push(`sentence ${fieldText(svg, 'sentence')}`);
  if (liftShown(svg)) out.push('a lift');
  if (/bandplot/.test(svg)) out.push('a band plot');
  for (const w of Object.values(LABELS)) if (svg.includes(w)) out.push(`the plain label ${w}`);
  return out;
};

test('AC-3 report 015\'s router receipt carries the publication label and reason, no lift and no plot', () => {
  const r = JSON.parse(fs.readFileSync(ROUTER, 'utf8'));
  assert.ok(policy.routerLimit(r), 'the receipt is one routerLimit names');
  assert.equal(plainOf(r).label, LABELS.REGRESSED, 'plainOf alone would say Clearly hurt');
  assert.deepEqual(routerProblems(card().cardSvg(r)), []);
  const out = cli(['card', ROUTER]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(routerProblems(out.stdout), []);
});

test('AC-3 MUTATION: a copy of lib/card.js with the routerLimit call taken out reads RED', () => {
  const r = JSON.parse(fs.readFileSync(ROUTER, 'utf8'));
  const { mod } = plantedCard('const limit = routerLimit(receipt);', 'const limit = null;');
  assert.notDeepEqual(routerProblems(mod.cardSvg(r)), []);
});

// ── AC-4 ─────────────────────────────────────────────────────────────────────

// The example receipt with one digit of one score moved, its hash left as it was.
function tampered(dir, reseal = false) {
  const r = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  const text = JSON.stringify(r, null, 2);
  const at = text.indexOf('"with_skill_score": 0.8') + '"with_skill_score": 0.8'.length;
  const moved = text.slice(0, at) + (text[at] === '9' ? '8' : '9') + text.slice(at + 1);
  assert.notEqual(moved, text);
  const file = path.join(dir, reseal ? 'resealed.json' : 'tampered.json');
  fs.writeFileSync(file, reseal ? JSON.stringify(sealReceipt(JSON.parse(moved)), null, 2) : moved);
  return file;
}

test('AC-4 a tampered receipt exits 4 with nothing on stdout and no file', () => {
  const dir = tmp();
  const file = tampered(dir);
  const a = cli(['card', file]);
  assert.equal(a.status, 4, a.stderr);
  assert.equal(a.stdout, '');
  assert.match(a.stderr, /REFUSED \(card\): receipt_hash does not verify/);
  const out = path.join(dir, 'card.svg');
  const b = cli(['card', file, '--out', out]);
  assert.equal(b.status, 4, b.stderr);
  assert.equal(b.stdout, '');
  assert.ok(!fs.existsSync(out), 'no file written');
});

test('AC-4 a receipt that does not validate exits 4; an ambiguous or unreadable one exits 2; each writes nothing', () => {
  const dir = tmp();
  const base = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  const invalid = clone(base); invalid.verification_level = 'VOUCHED'; sealReceipt(invalid);
  const ambiguous = clone(base); ambiguous.results.cases.push(clone(ambiguous.results.cases[0])); sealReceipt(ambiguous);
  const files = { invalid: [invalid, 4], ambiguous: [ambiguous, 2] };
  for (const [name, [r, code]] of Object.entries(files)) {
    const f = path.join(dir, `${name}.json`); fs.writeFileSync(f, JSON.stringify(r, null, 2));
    const out = path.join(dir, `${name}.svg`);
    const x = cli(['card', f, '--out', out]);
    assert.equal(x.status, code, `${name}: ${x.stderr}`);
    assert.equal(x.stdout, '', name);
    assert.ok(!fs.existsSync(out), name);
  }
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{ not json');
  const y = cli(['card', bad]);
  assert.equal(y.status, 2, y.stderr);
  assert.equal(y.stdout, '');
});

test('AC-4 MUTATION: the same edit resealed is drawn, exit 0, so the refusal reads the hash', () => {
  const file = tampered(tmp(), true);
  const r = cli(['card', file]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /<metadata>driftproof card<\/metadata>/);
});

// ── AC-5 ─────────────────────────────────────────────────────────────────────

test('AC-5 no card loads or runs anything: no script, image, foreign object, event, import, outside url or http', () => {
  const { cardSvg } = card();
  for (const { file, receipt } of fixtures().list) assert.deepEqual(unsafeParts(cardSvg(receipt)), [], path.basename(file));
  assert.deepEqual(unsafeParts(cardSvg(JSON.parse(fs.readFileSync(ROUTER, 'utf8')))), []);
});

test('AC-5 --href links the card; a javascript: or other scheme is refused, exit 2', () => {
  const href = 'https://example.org/receipts/x.json?a=1&b=2';
  const ok = cli(['card', EXAMPLE, '--href', href]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(ok.stdout.includes('<a href="https://example.org/receipts/x.json?a=1&amp;b=2">'));
  assert.deepEqual(unsafeParts(ok.stdout, 'https://example.org/receipts/x.json?a=1&amp;b=2'), []);
  const rel = cli(['card', EXAMPLE, '--href', 'receipts/x.json']);
  assert.equal(rel.status, 0, rel.stderr);
  for (const bad of ['javascript:alert(1)', 'JavaScript:x', 'data:text/html,x', 'file:///etc/passwd', ' https://x', 'https://x\ny']) {
    const r = cli(['card', EXAMPLE, '--href', bad]);
    assert.equal(r.status, 2, `${JSON.stringify(bad)}: ${r.stderr}`);
    assert.equal(r.stdout, '', bad);
  }
});

test('AC-5 MUTATION: a planted <script> and a planted http link each read RED', () => {
  const svg = card().cardSvg(JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')));
  assert.notDeepEqual(unsafeParts(svg.replace('</svg>\n', '<script>alert(1)</script></svg>\n')), []);
  assert.notDeepEqual(unsafeParts(svg.replace('</svg>\n', '<a href="http://example.org/x"><text>x</text></a></svg>\n')), []);
  assert.notDeepEqual(unsafeParts(svg.replace('</svg>\n', '<rect fill="url(https://x/y.svg#a)"/></svg>\n')), []);
});

// ── AC-6 ─────────────────────────────────────────────────────────────────────

test('AC-6 every card is well-formed XML', () => {
  const { cardSvg } = card();
  for (const { file, receipt } of fixtures().list) assert.deepEqual(xmlProblems(cardSvg(receipt)), [], path.basename(file));
  assert.deepEqual(xmlProblems(cardSvg(JSON.parse(fs.readFileSync(ROUTER, 'utf8')))), []);
});

test('AC-6 a hostile skill name and model are escaped, made visible and cut at 60 with an ellipsis', () => {
  const r = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  const rlo = String.fromCodePoint(0x202e);
  r.skill.name = `<script>&"x'${rlo}` + 'n'.repeat(80);
  r.run.model_id = `m&<b>${'z'.repeat(70)}`;
  sealReceipt(r);
  const svg = card().cardSvg(r);
  assert.deepEqual(xmlProblems(svg), []);
  assert.deepEqual(unsafeParts(svg), []);
  assert.ok(!svg.includes(rlo), 'the override is made visible');
  const name = fieldText(svg, 'name');
  const shown = invisibleShown(r.skill.name);
  assert.equal(name, `${[...shown].slice(0, 60).join('')}…`);
  const meta = fieldText(svg, 'model');
  assert.ok(meta.startsWith(`${[...r.run.model_id].slice(0, 60).join('')}…`), meta);
});

test('AC-6 MUTATION: a bare & or an unclosed element reads RED by the well-formedness reader', () => {
  const svg = card().cardSvg(JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')));
  assert.notDeepEqual(xmlProblems(svg.replace('</svg>\n', '<text>a & b</text></svg>\n')), []);
  assert.notDeepEqual(xmlProblems(svg.replace('</svg>\n', '<g><text>a</text></svg>\n')), []);
  assert.notDeepEqual(xmlProblems(svg.replace('</svg>\n', '<text x=1>a</text></svg>\n')), []);
});

// ── AC-7 ─────────────────────────────────────────────────────────────────────

test('AC-7 two runs of the command over each receipt write the same bytes, under another clock', () => {
  const files = [...fixtures().list.map((x) => x.file), ROUTER];
  for (const file of files) {
    const a = cli(['card', file]);
    const b = cli(['card', file], { extra: { SOURCE_DATE_EPOCH: '1700000000' } });
    assert.equal(a.status, 0, `${path.basename(file)}: ${a.stderr}`);
    assert.equal(a.stdout, b.stdout, path.basename(file));
    assert.equal(a.stdout, card().cardSvg(JSON.parse(fs.readFileSync(file, 'utf8'))), `${path.basename(file)}: the command prints cardSvg`);
  }
});

test('AC-7 MUTATION: two different receipts give different bytes', () => {
  const [x, y] = fixtures().list;
  assert.notEqual(card().cardSvg(x.receipt), card().cardSvg(y.receipt));
});

// ── AC-8 ─────────────────────────────────────────────────────────────────────

test('AC-8 --out at an existing receipt is refused, exit 2, and the receipt is unchanged', () => {
  const dir = tmp();
  const victim = path.join(dir, 'receipt.json');
  fs.copyFileSync(EXAMPLE, victim);
  const before = fs.readFileSync(victim);
  const r = cli(['card', EXAMPLE, '--out', victim]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /REFUSED \(card\): --out .* names an existing file this command did not write/);
  assert.ok(before.equals(fs.readFileSync(victim)));
  const self = cli(['card', victim, '--out', victim]);
  assert.equal(self.status, 2, self.stderr);
  assert.ok(before.equals(fs.readFileSync(victim)));
});

test('AC-8 --out writes the card and writes over a card it wrote; without --out the card is on stdout', () => {
  const dir = tmp();
  const out = path.join(dir, 'sub', 'card.svg');
  const a = cli(['card', ROUTER, '--out', out]);
  assert.equal(a.status, 0, a.stderr);
  assert.ok(card().isCardFile(out));
  const b = cli(['card', EXAMPLE, '--out', out]);
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /^card written to /);
  assert.equal(fs.readFileSync(out, 'utf8'), card().cardSvg(JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'))));
  const c = cli(['card', EXAMPLE]);
  assert.equal(c.stdout, fs.readFileSync(out, 'utf8'));
  assert.ok(c.stdout.slice(0, 4096).includes('<metadata>driftproof card</metadata>'));
});

// ── AC-9 ─────────────────────────────────────────────────────────────────────

test('AC-9 an unknown flag, a second positional, no positional, and a valueless --out or --href are refused, exit 2, stdout empty', () => {
  const dir = tmp();
  const out = path.join(dir, 'card.svg');
  for (const args of [
    ['card', EXAMPLE, '--outt', out],
    ['card', EXAMPLE, '--svg'],
    ['card', EXAMPLE, EXAMPLE],
    ['card'],
    ['card', EXAMPLE, '--out'],
    ['card', EXAMPLE, '--href'],
    ['card', EXAMPLE, '--out', '--href', 'x'],
  ]) {
    const r = cli(args);
    assert.equal(r.status, 2, `${args.slice(1).join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout, '', args.join(' '));
    assert.match(r.stderr, /REFUSED \(card\)/, args.join(' '));
  }
  assert.ok(!fs.existsSync(out));
});

test('AC-9 card runs the receipt validator check, as badge does', () => {
  const src = fs.readFileSync(BIN, 'utf8');
  const line = src.match(/^ {2}if \((\[[^\]]*\])\.includes\(cmd\)\) checkReceiptValidator\(\);$/m);
  assert.ok(line, 'the dependency check line');
  assert.ok(JSON.parse(line[1].replace(/'/g, '"')).includes('card'));
  assert.ok(JSON.parse(line[1].replace(/'/g, '"')).includes('badge'));
});

// ── AC-10 ────────────────────────────────────────────────────────────────────

test('AC-10 a card carries the name, model, date, the card-size band plot, the placebo line when there is one, the receipt and the version', () => {
  const { cardSvg } = card();
  let placebos = 0;
  for (const { file, receipt } of fixtures().list) {
    const svg = cardSvg(receipt);
    const n = path.basename(file);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="600" height="315" viewBox="0 0 600 315"/, n);
    assert.equal(fieldText(svg, 'name'), invisibleShown(receipt.skill.name), n);
    assert.equal(fieldText(svg, 'model'), `${invisibleShown(receipt.run.model_id)} · ${receipt.run.date_utc.slice(0, 10)}`, n);
    assert.ok(svg.includes(renderCell(cellOf(receipt), { size: 'card' })), `${n}: the band plot, byte for byte`);
    assert.equal(fieldText(svg, 'receipt'), `Receipt ${receipt.receipt_hash.slice(0, 12)}…`, n);
    assert.equal(fieldText(svg, 'version'), `driftproof ${RUNNER_VERSION}`, n);
    const hasArm = !!receipt.placebo || receipt.results.cases.some((c) => c.mode === 'placebo');
    if (hasArm) { placebos++; assert.equal(fieldText(svg, 'placebo'), placeboLine(placeboReading(receipt)), n); }
    else assert.equal(fieldLines(svg, 'placebo').length, 0, n);
  }
  assert.ok(placebos >= 14, `${placebos} placebo receipts read`);
});

test('AC-10 a smoke receipt\'s plot draws both arms', () => {
  const q = JSON.parse(fs.readFileSync(fixtures().quick, 'utf8'));
  const svg = card().cardSvg(q);
  assert.equal(cellOf(q).state === 'refused', false);
  assert.match(svg, /class="band band-baseline/);
  assert.match(svg, /class="band band-skill/);
  assert.doesNotMatch(svg, /unmeasured/);
});

// ── AC-11 ────────────────────────────────────────────────────────────────────

// The view's `.v-<state>` rules, read from a page renderView writes: state -> { token, dash }.
function viewStampRules() {
  const dir = tmp();
  fs.copyFileSync(EXAMPLE, path.join(dir, path.basename(EXAMPLE)));
  const { html } = require('../lib/view').renderView(dir, { now: new Date(0), label: 'r', stale: { noHarnessCheck: true } });
  const rules = {};
  for (const m of html.matchAll(/^((?:\.v-[A-Z_]+(?:, )?)+) \{ color: var\(--([a-z-]+)\);(?: border-style: ([a-z]+);)? \}$/gm)) {
    for (const sel of m[1].split(', ')) rules[sel.slice(3)] = { token: m[2], dash: m[3] || 'solid' };
  }
  return rules;
}
// The token's value, var() references followed, from lib/view-tokens.js.
function tokenHex(name) {
  const map = Object.fromEntries(DECLARATIONS.map((d) => d.match(/^--([a-z0-9-]+):\s*(.*);$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  let v = map[name];
  for (let i = 0; i < 8 && /^var\(--/.test(v); i++) v = map[v.slice(6, -1)];
  return v;
}
const stampMismatch = (table, view) => Object.keys(view).filter((s) => !table[s] || table[s].token !== view[s].token || table[s].dash !== view[s].dash);

test('AC-11 the stamp table is the view\'s .v-* rules, and each card paints its state\'s token', () => {
  const view = viewStampRules();
  assert.ok(Object.keys(view).length >= 10, `${Object.keys(view).length} view rules`);
  const { STAMP, cardSvg } = card();
  assert.deepEqual(stampMismatch(STAMP, view), []);
  assert.deepEqual(Object.keys(STAMP).sort(), Object.keys(view).sort());
  for (const { file, receipt } of fixtures().list) {
    const p = plainOf(receipt);
    const svg = cardSvg(receipt);
    const g = svg.match(/<g class="stamp v-([A-Z_]+)"[^>]*>\s*<rect [^>]*stroke="([^"]+)"[^>]*\/>/);
    assert.ok(g, path.basename(file));
    assert.equal(g[1], p.state, path.basename(file));
    assert.equal(g[2], tokenHex(view[p.state].token), path.basename(file));
  }
});

test('AC-11 MUTATION: the stamp table with one token moved reads RED', () => {
  const view = viewStampRules();
  const moved = clone(card().STAMP);
  moved.PASSED.token = 'reg';
  assert.deepEqual(stampMismatch(moved, view), ['PASSED']);
});

// ── AC-12 ────────────────────────────────────────────────────────────────────

const versionAside = (s) => s.replace(/(data-field="version"[^>]*>driftproof )\d+\.\d+\.\d+(?:-[\w.]+)?</, '$1x.y.z<');

test('AC-12 the README\'s example card is the command\'s output over the bundled example receipt', () => {
  const want = card().cardSvg(JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')));
  assert.ok(fs.existsSync(ASSET), 'docs/assets/card-commit-message-conventions.svg is committed');
  assert.equal(versionAside(fs.readFileSync(ASSET, 'utf8')), versionAside(want));
  assert.ok(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').includes('/assets/card-commit-message-conventions.svg'), 'README shows it');
});

test('AC-12 MUTATION: the asset with one byte of its sentence moved reads RED', () => {
  const want = card().cardSvg(JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')));
  const moved = want.replace('clearly helped', 'clearly helpeD');
  assert.notEqual(moved, want);
  assert.notEqual(versionAside(moved), versionAside(want));
});
