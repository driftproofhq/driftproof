// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 794: Report 019's page, plain answer first, one chart of all twenty, method folded. Written
// before the builder changes. Every check reads the base page (the Base commit's, through git) or
// the sealed receipts through the libraries, never the builder's output as its own oracle.
//
// Each check is a function over a page's HTML, run once on the committed page (the control) and
// once on each plant, which must read red.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
process.env.DRIFTPROOF_REGISTRY = path.join(ROOT, 'specs/783-fable-5-2-scope/registry.json');
const BASE = 'ea78279519c601042b2860c8b40ef061bbfc35b6';
const PAGE_REL = 'docs/reports/019/index.html';
const CSS_REL = 'docs/tokens.css';

const { placeboReading } = require(path.join(ROOT, 'lib/verdict'));
const { plainOf } = require(path.join(ROOT, 'lib/plain'));
const { htmlToText } = require(path.join(ROOT, 'scripts/html-text'));
const O = require(path.join(ROOT, 'scripts/offer.js'));
const B = () => require(path.join(ROOT, 'scripts/prepare-report-019.js'));

const gitShow = (rel) => { const r = spawnSync('git', ['show', BASE + ':' + rel], { cwd: ROOT, maxBuffer: 1 << 28 }); assert.equal(r.status, 0, 'the Base commit is readable: ' + rel); return r.stdout.toString('utf8'); };
const basePage = gitShow(PAGE_REL);
const newPage = () => fs.readFileSync(path.join(ROOT, PAGE_REL), 'utf8');
let model; const M = () => (model = model || B().readReport({}));

// ── HTML, read the way a person sees it ──
// Issue 807: the tags are read by spec 148's tokenizer, not a regex, and the entities decoded once.
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&amp;': '&' };
const decode = (s) => s.replace(/&(?:lt|gt|quot|#39|amp|#\d+);/g, (e) => ENTITIES[e] || String.fromCodePoint(Number(e.slice(2, -1))));
const BLOCK = ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'td', 'tr', 'dt', 'dd', 'div', 'section', 'summary', 'details', 'ul', 'ol', 'table', 'thead', 'tbody', 'caption', 'aside', 'header', 'footer', 'nav', 'main', 'br', 'pre', 'figure', 'figcaption', 'dl', 'blockquote'];
const visible = (html) => htmlToText(html, { skip: ['script', 'style', 'title'], blockTags: BLOCK, decode, collapse: true });
const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>') + 7);
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
function outer(html, start) {
  const name = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start))[1];
  const re = new RegExp('<(/?)' + name + '\\b[^>]*>', 'g'); re.lastIndex = start; let depth = 0, m;
  while ((m = re.exec(html))) { if (m[0].endsWith('/>')) { if (depth === 0) return html.slice(start, re.lastIndex); continue; } if (m[1]) { if (--depth === 0) return html.slice(start, re.lastIndex); } else depth++; }
  throw new Error('unclosed <' + name + '> at ' + start);
}
const all = (html, re) => [...html.matchAll(new RegExp(re.source, 'g'))].map((m) => ({ at: m.index, tag: m[0], a: attrs(m[0]), html: outer(html, m.index) }));
const one = (html, re, why) => { const xs = all(html, re); assert.equal(xs.length, 1, why || String(re)); return xs[0]; };
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const n3 = (x) => x.toFixed(3);
const BLOCKS = /<(?:p|li|h[1-3]|th|dt|dd|pre)\b[^>]*>/;
const sectionOf = (html, id) => one(mainOf(html), new RegExp('<section id="' + id + '"[^>]*>'), 'one section#' + id).html;

// ── the oracle: the counted twenty, read from their receipts here ──
const GROUPS = [['beat', 'Beat the fake', ['ABOVE_PLACEBO']], ['nobetter', 'Did not beat the fake', ['BELOW_PLACEBO', 'NO_DIFFERENCE']], ['cant', 'Can\'t tell yet', ['UNDERPOWERED', 'INCONCLUSIVE', 'NOT_MEASURED']]];
const groupOf = (reading) => GROUPS.find((g) => g[2].includes(reading));
const SAYS = {
  ABOVE_PLACEBO: 'Scored above the fake on at least one task, and below it on none.',
  BELOW_PLACEBO: 'Scored below the fake on at least one task.',
  NO_DIFFERENCE: 'No task differed from the fake by enough to count.',
  UNDERPOWERED: 'Not enough answers to tell it from the fake.',
  INCONCLUSIVE: 'Inconclusive against the fake.',
  NOT_MEASURED: 'Not measured against the fake.',
};
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function counted() {
  const m = M();
  return [...m.fourteen.map((r) => ({ r, kind: 'counted' })), ...m.six.map((r) => ({ r, kind: 'tools' }))].map(({ r, kind }, plan) => {
    const x = r.receipt, reading = placeboReading(x).reading, key = O.labelOf(reading);
    return { plan, skill: r.skill, repository: r.repository, attempt: r.attempt_id, src: r.src, kind, reading, group: groupOf(reading)[0], label: O.LABELS[key], key, none: plainOf(x).label,
      means: { with_skill: x.comparison.with_skill_score, placebo: x.placebo.comparison.placebo_score, baseline: x.comparison.baseline_score } };
  });
}
// In group order, plan order inside a group (AC-2, AC-4).
const ordered = () => GROUPS.flatMap(([g]) => counted().filter((w) => w.group === g));
function tally() {
  const want = counted(), n = (toks) => want.filter((w) => toks.includes(w.reading)).length;
  return { N: want.length, beat: n(GROUPS[0][2]), nobetter: n(GROUPS[1][2]), cant: n(GROUPS[2][2]), below: n(['BELOW_PLACEBO']), nodiff: n(['NO_DIFFERENCE']) };
}
// A-794-3 (PR 795, F-1): the middle group "did not beat it"; in the answer card its split follows
// while both parts are not zero. The summary has no room for the split.
const splitOf = (t) => (t.below && t.nodiff ? ' (' + t.below + ' scored below it, ' + t.nodiff + ' showed no clear difference)' : '');
const answerParts = (t, first, room) => [[t.beat, t.beat + ' ' + first + '.'], [t.nobetter, t.nobetter + ' did not beat it' + (room ? splitOf(t) : '') + '.'], [t.cant, 'For ' + t.cant + ' we can\'t tell yet.']].filter(([c]) => c > 0).map(([, s]) => s);

// The base page's rows: section.placebo-result, keyed by attempt and kind.
function rowsOf(html) {
  return all(html.includes('<main') ? mainOf(html) : html, /<section class="placebo-result[^"]*"[^>]*>/).map((s) => {
    const kind = /result-(\w+)/.exec(s.a.class)[1], d = s.html, i = d.indexOf('</summary>');
    return { at: s.at, key: s.a['data-attempt'] + ' ' + kind, kind, attempt: s.a['data-attempt'], id: s.a.id, reading: s.a['data-reading'], summary: d.slice(d.indexOf('<summary>'), i + 10), opened: d.slice(i + 10, d.lastIndexOf('</details>')) };
  });
}

// ── AC-1: the answer is the tally, in plain words ──
function checkAnswer(html) {
  const t = tally(), main = mainOf(html);
  assert.ok(/<!--\/driftproof:tldr-->\s*<section id="the-answer"/.test(main), 'the body opens with the answer');
  const s = sectionOf(html, 'the-answer');
  assert.equal(visible(one(s, /<h2\b[^>]*>/).html), 'Did these ' + t.N + ' skills beat a same-length fake?');
  const line = one(s, /<p class="r019-answer-line"[^>]*>/).html;
  assert.equal(visible(line), answerParts(t, 'beat it', true).join(' '), 'the answer line, from the tally');
  const parts = all(line, /<span class="r019-part[^"]*"[^>]*>/);
  const groups = GROUPS.filter(([g]) => t[g] > 0);
  assert.equal(parts.length, groups.length, 'one part per group with a count');
  const srcs = (toks) => counted().filter((w) => toks.includes(w.reading)).map((w) => w.src).sort();
  parts.forEach((p, i) => {
    const [g, , toks] = groups[i], ds = all(p.html, /<data\b[^>]*>/), d = ds[0];
    assert.ok(p.a.class.includes('is-' + g), 'the part names its group: ' + g);
    assert.equal(Number(d.a.value), t[g], 'the count is the tally: ' + g);
    assert.deepEqual(d.a['data-src'].split(' ').sort(), srcs(toks), 'the count names the receipts it counts: ' + g);
    // The split's counts are the tally of each reading, each naming its own receipts.
    const split = g === 'nobetter' && splitOf(t) ? [[t.below, ['BELOW_PLACEBO']], [t.nodiff, ['NO_DIFFERENCE']]] : [];
    assert.equal(ds.length, 1 + split.length, 'the count and its split: ' + g);
    split.forEach(([n, ts], k) => { assert.equal(Number(ds[k + 1].a.value), n, 'a split count is the tally'); assert.deepEqual(ds[k + 1].a['data-src'].split(' ').sort(), srcs(ts), 'a split count names its receipts'); });
  });
  assert.equal(parts.reduce((n, p) => n + Number(all(p.html, /<data\b[^>]*>/)[0].a.value), 0), t.N, 'the counts sum to the twenty');
  const how = visible(one(s, /<p class="r019-answer-how"[^>]*>/).html);
  assert.match(how, /^On Claude Fable 5\.2, three tasks per skill\./, 'the model and the tasks per skill');
  // The summary at the top says the same counts in the same words (spec 125's row, the chrome's fence).
  const summary = visible(one(main, /<section class="plain-summary"[^>]*>/).html);
  const said = answerParts(t, 'beat the fake', false).map((s) => (s.charAt(0).toLowerCase() + s.slice(1)).replace(/\.$/, ''));
  const sentence = 'Of the ' + t.N + ' skills, ' + (said.length < 2 ? said.join('') : said.slice(0, -1).join(', ') + ', and ' + said.at(-1)) + '.';
  assert.ok(summary.includes('What we found. ' + sentence), 'the summary says the answer in one sentence: ' + summary.slice(0, 300));
}

// ── AC-2, AC-3: one chart, every counted skill once, at its sealed averages, readable without it ──
function chartOf(html) { return one(sectionOf(html, 'the-answer'), /<table class="r019-chart"[^>]*>/, 'one chart').html; }
function scaleOf(chart) {
  const ticks = [...chart.matchAll(/<text class="r019-tick" x="([\d.]+)%"[^>]*>([\d.]+)<\/text>/g)].map((m) => [Number(m[2]), Number(m[1])]);
  assert.ok(ticks.length >= 3, 'the axis carries its ticks');
  const [[v0, x0], [v1, x1]] = [ticks[0], ticks.at(-1)], b = (x1 - x0) / (v1 - v0), a = x0 - b * v0;
  for (const [v, x] of ticks) assert.ok(Math.abs(a + b * v - x) < 0.02, 'one linear scale on the axis');
  const lo = Math.floor(Math.min(...counted().flatMap((w) => Object.values(w.means))) * 10) / 10;
  assert.deepEqual([ticks[0][0], ticks.at(-1)[0]], [lo, 1], 'the scale runs from the lowest average, down to a tenth, to 1');
  return (v) => a + b * v;
}
function checkChart(html) {
  const s = sectionOf(html, 'the-answer'), chart = chartOf(html), want = ordered(), t = tally(), at = scaleOf(chart);
  assert.ok(s.indexOf('<table class="r019-chart"') > s.indexOf('class="r019-answer-line"'), 'the chart comes after the answer');
  const groups = all(chart, /<tr class="r019-group[^"]*"[^>]*>/), bars = all(chart, /<tr class="r019-bar[^"]*"[^>]*>/);
  const shown = GROUPS.filter(([g]) => t[g] > 0);
  assert.deepEqual(groups.map((g) => /is-(\w+)/.exec(g.a.class)[1]), shown.map(([g]) => g), 'the groups, in order');
  groups.forEach((g, i) => {
    assert.ok(visible(g.html).startsWith(shown[i][1] + ' ' + t[shown[i][0]]), 'the group word and its count: ' + visible(g.html));
    assert.equal(Number(all(g.html, /<data\b[^>]*>/)[0].a.value), t[shown[i][0]], 'the group count is the tally');
  });
  assert.equal(bars.length, want.length, 'one row per counted skill');
  const rows = rowsOf(html);
  bars.forEach((b, i) => {
    const w = want[i], why = w.skill + ' (' + w.kind + ')';
    assert.equal(b.a['data-attempt'], w.attempt, 'group order, plan order inside: ' + why);
    assert.equal(b.a['data-reading'], w.reading, why);
    const g = groups.filter((x) => x.at < b.at).at(-1); assert.ok(g && g.a.class.includes('is-' + w.group), 'under its group: ' + why);
    assert.ok(b.a.class.includes('is-' + w.group), 'coloured by its group: ' + why);
    const href = /<a href="#([^"]+)"/.exec(b.html); assert.ok(href, 'the row links to its plain line: ' + why);
    const row = rows.filter((r) => r.id === href[1]); assert.equal(row.length, 1, why); assert.equal(row[0].attempt, w.attempt, why); assert.notEqual(row[0].kind, 'context', why);
    assert.equal(count(b.html, 'class="r019-tools"'), w.kind === 'tools' ? 1 : 0, 'tools on, the six only: ' + why);
    const mark = (re) => { const m = re.exec(b.html); assert.ok(m, 'a mark: ' + re + ' ' + why); return Number(m[1]); };
    for (const [arm, re] of [['with_skill', /class="r019-dot" cx="([\d.]+)%"/], ['placebo', /class="r019-fake" x1="([\d.]+)%"/], ['baseline', /class="r019-none" cx="([\d.]+)%"/]]) {
      assert.ok(Math.abs(mark(re) - at(w.means[arm])) < 0.02, 'the ' + arm + ' mark sits at its sealed average: ' + why);
    }
    // AC-3: the figures as data, the drawing titled.
    for (const arm of ['with_skill', 'placebo', 'baseline']) {
      const d = all(b.html, new RegExp('<data\\b[^>]*data-arm="' + arm + '"[^>]*>'));
      assert.equal(d.length, 1, 'one ' + arm + ' figure: ' + why);
      assert.equal(Number(d[0].a.value), w.means[arm], 'the sealed figure: ' + why); assert.equal(d[0].a['data-src'], w.src, why);
      assert.equal(visible(d[0].html), n3(w.means[arm]), 'three decimals: ' + why);
    }
    const title = /<svg\b[^>]*>\s*<title>([^<]+)<\/title>/.exec(b.html); assert.ok(title, 'the drawing has a title: ' + why);
    for (const arm of ['with_skill', 'placebo', 'baseline']) assert.ok(decode(title[1]).includes(n3(w.means[arm])), 'the title names the figures: ' + why);
  });
  assert.ok(!chart.includes('text-only, not counted'), 'no context receipt in the chart');
  const head = visible(one(chart, /<thead\b[^>]*>/).html);
  for (const c of ['With the skill', 'With the fake', 'With no skill']) assert.ok(head.includes(c), 'a column header: ' + c);
  const key = visible(one(s, /<p class="r019-key"[^>]*>/).html);
  for (const w of ['the skill', 'the fake', 'no skill', ...GROUPS.filter(([g]) => t[g] > 0).map(([, x]) => x.toLowerCase())]) assert.ok(key.toLowerCase().includes(w), 'the legend names ' + w);
  assert.equal(visible(one(s, /<p class="r019-chart-note"[^>]*>/).html), 'Each mark is an average over all of a skill\'s tasks. The verdict is decided task by task, so a mark can point the other way.');
}

// ── AC-4: each skill in one plain line ──
function checkSkills(html) {
  const s = sectionOf(html, 'each-skill'), want = ordered();
  const rows = rowsOf(s);
  assert.deepEqual(rows.map((r) => r.attempt), want.map((w) => w.attempt), 'the counted twenty, in the chart\'s order');
  rows.forEach((r, i) => {
    const w = want[i], why = w.skill;
    assert.equal(r.kind, w.kind, why);
    const chip = one(r.summary, /<span class="r019-verdict[^"]*"[^>]*>/, 'one verdict chip: ' + why);
    assert.ok(chip.a.class.includes('is-' + w.group), 'the chip names the group: ' + why);
    assert.equal(visible(chip.html), groupOf(w.reading)[1], 'the group word: ' + why);
    assert.equal(visible(one(r.summary, /<span class="r019-says"[^>]*>/).html), SAYS[w.reading] + ' Compared with no skill: ' + lc(w.none) + '.', 'the plain sentence: ' + why);
    const name = visible(one(r.summary, /<span class="row-skill"[^>]*>/).html);
    assert.equal(name, [w.skill, w.repository, ...(w.kind === 'tools' ? ['tools on'] : [])].join(' '), 'the name line: ' + why);
    assert.doesNotMatch(r.summary, /ABOVE_PLACEBO|BELOW_PLACEBO|NO_DIFFERENCE|UNDERPOWERED|INCONCLUSIVE|NOT_MEASURED/, 'no code in a summary: ' + why);
  });
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
}

// ── AC-5: an opened skill shows what it shows today ──
// The site's glossary marks the first use of each term on a page (scripts/glossary-terms.js), so moving
// text moves a marker; the words are compared with the markers unwrapped (A-794-1).
const unwrapTerms = (h) => h.replace(/<!--driftproof:term--><a class="term"[^>]*>([^<]*)<\/a><!--\/driftproof:term-->/g, '$1');
function checkRows(html) {
  const was = rowsOf(basePage), now = rowsOf(html);
  assert.equal(now.length, was.length, 'the same 26 rows');
  for (const b of was) {
    const n = now.filter((r) => r.key === b.key); assert.equal(n.length, 1, 'the row is on the page once: ' + b.key);
    const r = n[0]; assert.equal(r.id, b.id, 'its id: ' + b.key); assert.equal(r.reading, b.reading, b.key);
    const was1 = one(r.opened, /<p class="r019-was"[^>]*>/, 'the label line: ' + b.key);
    assert.ok(r.opened.startsWith(was1.html), 'the label line comes first: ' + b.key);
    assert.ok(unwrapTerms(r.opened.slice(was1.html.length)) === unwrapTerms(b.opened), 'the opened row is today\'s: ' + b.key);
    const chip = /<span class="r019-chip[^"]*">[^<]*<\/span>/.exec(b.summary)[0], reading = one(b.summary, /<span class="row-reading"[^>]*>/).html;
    assert.ok(unwrapTerms(was1.html).includes(chip) && unwrapTerms(was1.html).includes(unwrapTerms(reading)), 'the label and the reading as the summary held them: ' + b.key);
  }
}

// ── AC-6: nothing is gone ──
const PINS = /<ul class="reader-pins">[\s\S]*?<\/ul>/;
function checkPins(html) {
  const pins = (h) => [...PINS.exec(mainOf(h))[0].matchAll(/<li><code>([^<]+)<\/code>, SHA-256 <code>([0-9a-f]{64})<\/code><\/li>/g)].map((m) => [m[1], m[2]]);
  const was = pins(basePage), now = pins(html);
  assert.deepEqual(now.map(([f]) => f), was.map(([f]) => f), 'the same reader files, in order');
  for (const [f, h] of now) assert.equal(h, require(path.join(ROOT, 'lib/canonical')).sha256(fs.readFileSync(path.join(ROOT, f))), 'each pin is its file\'s sha256: ' + f);
}
// The layout words this spec retires (AC-6): spec 792's glance and the old order.
const RETIRED = new Set(['The twenty at a glance', 'One entry for each skill counted, in the order of the rows below. The chip is the reading against the same-length placebo, by the case rule, task by task. Open a row for its tasks, bands and receipt.',
  'Means over all of a skill\'s tasks, apart from the case rule; they can point the other way.', 'Read this before the results', 'The fourteen, graded on the reply',
  'In plan (a)\'s order. Each row is one receipt, read by the receipt reader. Each opens on its summary line; open a row for its tasks, bands and receipt.']);
function baseBlocks() {
  let main = mainOf(basePage).replace(/<summary>[\s\S]*?<\/summary>/g, '').replace(PINS, '').replace(/<section class="plain-summary"[\s\S]*?<\/section>/, '');
  for (const x of [/<table class="r019-table"[\s\S]*?<\/table>/, /<p class="r019-figure">[\s\S]*?<\/p>/g]) main = main.replace(x, '');
  return main;
}
function checkWords(html) {
  checkPins(html);
  const text = visible(mainOf(html).replace(PINS, '')), want = new Map();
  for (const b of all(baseBlocks(), BLOCKS)) { const t = visible(b.html); if (/[A-Za-z0-9]/.test(t) && !RETIRED.has(t)) want.set(t, (want.get(t) || 0) + 1); }
  for (const [t, n] of want) assert.ok(count(text, t) >= n, 'a base block is still on the page ' + n + ' times: ' + t.slice(0, 120));
  const key = (d) => [d.a.value, d.a['data-src'], d.a['data-at'], d.a['data-fn']].join('|');
  const have = new Map();
  for (const d of all(mainOf(html), /<data\b[^>]*>/)) { const k = key(d); have.set(k, [...(have.get(k) || []), visible(d.html)]); }
  for (const d of all(mainOf(basePage).replace(/<p class="r019-figure">[\s\S]*?<\/p>/g, ''), /<data\b[^>]*>/)) {
    const k = key(d), xs = have.get(k) || [], at = xs.indexOf(visible(d.html));
    assert.ok(at >= 0, 'a base figure is still on the page with its source and text: ' + k + ' ' + visible(d.html)); xs.splice(at, 1);
  }
}

// ── AC-7: plain words above the fold ──
function aboveFold(html) {
  let main = mainOf(html);
  main = main.slice(0, main.indexOf('<section id="how-we-tested"')).replace(/<aside class="card receipt is-tldr"[\s\S]*?<\/aside>/, '');
  for (const d of all(main, /<details\b[^>]*>/).reverse()) if (!/\sopen\b/.test(d.tag)) { const i = d.html.indexOf('</summary>'); main = main.slice(0, d.at) + d.html.slice(0, i + 10) + '</details>' + main.slice(d.at + d.html.length); }
  return visible(main);
}
function checkPlain(html) {
  assert.ok(mainOf(html).includes('<section id="how-we-tested"'), 'the folded section');
  const t = aboveFold(html);
  for (const re of [/ABOVE_PLACEBO|BELOW_PLACEBO|NO_DIFFERENCE|INCONCLUSIVE|UNDERPOWERED|NOT_MEASURED/, /\b(case rule|arms?|draws?|end state)\b/i]) {
    const hit = re.exec(t);
    assert.ok(!hit, 'no reading code or engine word above the fold: ' + (hit ? t.slice(Math.max(0, hit.index - 60), hit.index + 30) : ''));
  }
}

// ── AC-8: four plain caveats ──
const CAVEATS = (t, m) => [
  ...(m.six.length ? ['The ' + m.sixWord + ' skills marked tools on ran with tools on and were graded on what Claude Code did, not on its reply. That is not the same test as the other ' + m.fourteenWord + '.'] : []),
  'Beating the fake is not the same as beating no skill. Each skill\'s details show both.',
  ...(t.cant ? ['Can\'t tell yet means there was not enough evidence to call it. It does not mean the skill had no effect.'] : []),
  'This is one model, Claude Fable 5.2, and three tasks per skill. It says nothing about other models or other tasks.',
];
function checkCaveats(html) {
  const s = sectionOf(html, 'keep-in-mind'), m = M();
  assert.equal(visible(one(s, /<h2\b[^>]*>/).html), 'Keep in mind');
  assert.deepEqual(all(s, /<li\b[^>]*>/).map((l) => visible(l.html)), CAVEATS(tally(), { six: m.six, sixWord: 'six', fourteenWord: 'fourteen' }));
  const main = mainOf(html);
  assert.ok(main.indexOf('<section id="each-skill"') < main.indexOf('<section id="keep-in-mind"') && main.indexOf('<section id="keep-in-mind"') < main.indexOf('<section id="report-020"'), 'after the skills, before Report 020');
}

// ── AC-9: Report 020 in plain lines, its table folded ──
const R020 = { 'separated-up': 'scored higher on Fable 5.2', 'no-separation': 'no clear difference', 'separated-down': 'scored lower on Fable 5.2' };
function checkReport020(html) {
  const s = sectionOf(html, 'report-020');
  const lines = all(s, /<ul class="r020-lines"[^>]*>/); assert.equal(lines.length, 1, 'one list of lines');
  assert.deepEqual(all(lines[0].html, /<li\b[^>]*>/).map((l) => visible(l.html)), M().boundary.rows.map((r) => r.skill + ': ' + (R020[r.verdict] || r.label) + '.'), 'one plain line per row');
  const fold = one(s, /<details class="r019-fold r020-more"[^>]*>/, 'one fold').html;
  assert.ok(!/<details[^>]*\sopen/.test(fold.slice(0, 80)), 'closed by default');
  for (const x of ['<table class="boundary-table"', '<p class="boundary-effort">', '<p class="boundary-statement">', 'Limits']) assert.ok(fold.includes(x), 'in the fold: ' + x);
  assert.ok(s.indexOf('<ul class="r020-lines"') < s.indexOf('<details'), 'the lines come before the fold');
}

// ── AC-10: the frozen wording, verbatim, in the folded section ──
const FROZEN = ['<p class="report-type">', '<p class="report-meta">', '<div class="headline">', '<p class="big"', '<p class="headline-counts-plain">', '<p class="headline-counts" data-fn="placebo-tally">', '<p class="headline-labels">',
  '<p class="headline-method">', '<p class="headline-ruled-change">', '<p class="headline-bases">', '<p class="headline-caveat">', '<p class="headline-judge">', '<p class="headline-effort">',
  '<p class="tools-on-method">', '<p class="tools-on-caveat">', '<section id="campaign-run-record">', 'class="r019-fold"'];
function checkFold(html) {
  const s = sectionOf(html, 'how-we-tested'), d = one(s, /<details class="r019-how"[^>]*>/, 'one fold');
  assert.ok(!/\sopen\b/.test(d.tag), 'closed by default');
  assert.ok(/^<details class="r019-how"><summary>(?:<!--(?:[^-]|-(?!->))*-->|<span[^>]*><\/span>)*<h2[^>]*>How we tested<\/h2>/.test(d.html), 'its summary holds the heading: ' + d.html.slice(0, 200));
  for (const x of FROZEN) assert.ok(d.html.includes(x), 'in the folded section: ' + x);
  for (const cls of ['headline-method', 'headline-ruled-change', 'headline-bases', 'headline-caveat', 'headline-judge', 'headline-effort', 'headline-counts', 'big', 'headline-labels', 'headline-counts-plain']) {
    const re = new RegExp('<p class="' + cls + '"[^>]*>');
    assert.equal(visible(one(mainOf(html), re).html), visible(one(mainOf(basePage), re).html), 'verbatim: ' + cls);
  }
  const ctx = rowsOf(html).filter((r) => r.kind === 'context');
  assert.equal(ctx.length, 6); for (const r of ctx) assert.ok(d.html.includes('data-attempt="' + r.attempt + '"'), 'a context row in the fold');
  const v = visible(d.html), first = v.indexOf('text-only, not counted');
  for (const x of [B().METHOD_SENTENCE, B().RULED_CHANGE]) { assert.equal(count(visible(mainOf(html)), x), 1, x); assert.ok(v.indexOf(x) >= 0 && v.indexOf(x) < first, 'before the first context row: ' + x); }
  const main = mainOf(html), rec = main.search(/<h2[^>]*>Receipts<\/h2>/);
  assert.ok(rec > main.indexOf('<section id="how-we-tested"') + s.length - 10, 'the receipts list after the folded section, unfolded');
}

// ── AC-11: the headline is not repeated ──
function checkOnce(html) {
  const main = mainOf(html).replace(/<aside class="card receipt is-tldr"[\s\S]*?<\/aside>/, '');
  const big = visible(one(main, /<p class="big"[^>]*>/).html);
  assert.equal(count(visible(main), big), 1, 'the total line once in the page\'s own text');
  assert.ok(!visible(one(main, /<section class="plain-summary"[^>]*>/).html).includes(big.slice(0, 40)), 'not in the summary');
}
async function checkSummaryRow(row, body) {
  const { ENGINE_WORDS } = await import(path.join(ROOT, 'specs/125-site-wide-layout/probes/lib.mjs'));
  const pts = row.points;
  assert.ok(pts.length >= 4 && pts.length <= 5, 'four or five points');
  assert.equal(pts[0].lead, 'What we tested.'); assert.equal(pts.at(-1).lead, 'What it doesn\'t show.');
  const text = pts.map((p) => p.lead + ' ' + p.text).join(' '), words = text.split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 90 && words <= 120, words + ' words, not 90 to 120');
  for (const [re, w] of ENGINE_WORDS) assert.doesNotMatch(text, re, 'engine word: ' + w);
  assert.doesNotMatch(text.replace(/(?:Claude )?(?:Sonnet|Opus|Haiku|Fable) \d+(?:\.\d+)?/g, ''), /\d\.\d/, 'no decimal figure');
  for (const n of text.match(/\d+/g) || []) assert.ok(body.includes(n), 'the numeral ' + n + ' is in the body');
  for (const p of pts) assert.ok(p.sources.length && p.sources.every((s) => s.file === PAGE_REL), 'each point names the page');
}

// ── AC-12: the builder's output, no new script ──
const scripts = (h) => [...h.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]).sort();

const plantOn = (check, html, plants) => {
  check(html);
  for (const [why, edit] of plants) {
    const planted = edit(html); assert.notEqual(planted, html, 'the plant applies: ' + why);
    assert.throws(() => check(planted), assert.AssertionError, 'reads red: ' + why);
  }
};
const replaceOnce = (from, to) => (h) => { assert.ok(h.includes(from), 'plant anchor: ' + String(from).slice(0, 80)); return h.replace(from, to); };
const bars = (h) => all(chartOf(h), /<tr class="r019-bar[^"]*"[^>]*>/);

// ── the tests ──
test('AC-1: the answer is the tally, first, in plain words, and the summary says the same', () => {
  const h = newPage();
  plantOn(checkAnswer, h, [
    ['a count one up', (x) => x.replace(/(<span class="r019-part is-beat"[^>]*><data value=")(\d+)("[^>]*>)(\d+)/, (_, a, n, b) => a + (Number(n) + 1) + b + (Number(n) + 1))],
    ['no better counting NO_DIFFERENCE only', (x) => x.replace(/(<span class="r019-part is-nobetter"[^>]*><data value=")(\d+)("[^>]*>)(\d+)/, (_, a, n, b) => a + (Number(n) - 1) + b + (Number(n) - 1))],
    ['a zero-count sentence shown', (x) => x.replace(/(<p class="r019-answer-line"[^>]*>[\s\S]*?)(<\/p>)/, '$1 <span class="r019-part is-other"><data value="0" data-src="x">0</data> were not measured.</span>$2')],
    ['the summary\'s counts changed', (x) => x.replace(/(<li><b>What we found\.<\/b> Of the \d+ skills, )(\d+)/, (_, a, n) => a + (Number(n) + 1))],
    ['the answer line removed', (x) => x.replace(/<p class="r019-answer-line"[\s\S]*?<\/p>/, '')],
  ]);
});

test('AC-2, AC-3: one chart of the twenty, at their sealed averages, readable without the drawing', () => {
  const h = newPage();
  plantOn(checkChart, h, [
    ['two rows\' dots swapped', (x) => { const b = bars(x), d0 = /class="r019-dot" cx="[\d.]+%"/.exec(b[0].html)[0], d1 = /class="r019-dot" cx="[\d.]+%"/.exec(b[1].html)[0]; assert.notEqual(d0, d1); return x.replace(b[0].html, b[0].html.replace(d0, d1)); }],
    ['a row moved to another group', (x) => { const b = bars(x); return x.replace(b[0].html, '').replace(b.at(-1).html, b.at(-1).html + b[0].html); }],
    ['a row removed', (x) => x.replace(bars(x)[2].html, '')],
    ['a context receipt\'s row added', (x) => { const b = bars(x)[0]; return x.replace(b.html, b.html + b.html.replace(/data-attempt="[0-9a-f]+"/, 'data-attempt="' + rowsOf(x).find((r) => r.kind === 'context').attempt + '"')); }],
    ['the tools-on mark moved to a text-only skill', (x) => x.replace(/ <span class="r019-tools">tools on<\/span>/, '').replace(/(<tr class="r019-bar[^"]*"[^>]*><th[^>]*><a [^>]*>[^<]*<\/a>)/, '$1 <span class="r019-tools">tools on</span>')],
    ['a mark not at its value', (x) => x.replace(/(class="r019-fake" x1=")([\d.]+)(%" x2=")([\d.]+)/, (_, a, v, b, w) => a + (Number(v) + 5).toFixed(2) + b + (Number(w) + 5).toFixed(2))],
    ['a figure\'s value changed', (x) => x.replace(/(<data value=")([\d.]+)("[^>]*data-arm="placebo")/, (_, a, v, b) => a + (Number(v) / 2) + b)],
    ['a figure at two decimals', (x) => x.replace(/(data-arm="with_skill"[^>]*>)(\d\.\d\d)\d</, '$1$2<')],
    ['a title removed', (x) => x.replace(/(<tr class="r019-bar[\s\S]*?<svg\b[^>]*>)\s*<title>[^<]*<\/title>/, '$1')],
    ['the note removed', (x) => x.replace(/<p class="r019-chart-note"[^>]*>[\s\S]*?<\/p>/, '')],
  ]);
});

test('AC-4: each skill in one plain line, in the chart\'s order', () => {
  const h = newPage();
  plantOn(checkSkills, h, [
    ['a chip\'s word swapped', (x) => x.replace(/(<span class="r019-verdict is-beat"[^>]*>)Beat the fake/, '$1Can&#39;t tell yet')],
    ['a sentence for another reading', replaceOnce('Scored above the fake on at least one task, and below it on none.', 'Scored below the fake on at least one task.')],
    ['the no-skill label changed', (x) => x.replace(/(<span class="r019-says"[^>]*>[^<]*Compared with no skill: )clearly helped/, '$1clearly hurt')],
    ['a code put into a summary', (x) => x.replace(/(<span class="r019-says"[^>]*>)/, '$1ABOVE_PLACEBO ')],
    ['two rows swapped', (x) => { const r = all(sectionOf(x, 'each-skill'), /<section class="placebo-result[^"]*"[^>]*>/); return x.replace(r[0].html + r[1].html, r[1].html + r[0].html); }],
  ]);
});

test('AC-5: each opened skill shows what it shows today, after the line its summary held', () => {
  const h = newPage();
  plantOn(checkRows, h, [
    ['a task band changed in one row', (x) => x.replace(/(<ul class="placebo-tasks"><li[^>]*>[^<]*: with the skill <data value=")([\d.]+)/, (_, a, v) => a + v + '1')],
    ['one row removed', (x) => x.replace(/<section class="placebo-result[\s\S]*?<\/details><\/section>/, '')],
    ['the label line removed from one row', (x) => x.replace(/<p class="r019-was">[\s\S]*?<\/p>/, '')],
  ]);
});

test('AC-6: every block and every figure of today\'s page is still on the page', () => {
  const h = newPage();
  plantOn(checkWords, h, [
    ['a caveat word changed', replaceOnce('so there was little room for a difference', 'so there was some room for a difference')],
    ['a block removed', (x) => x.replace(/<p class="headline-judge">[\s\S]*?<\/p>/, '')],
    ['a figure\'s value changed', (x) => x.replace(/(<p class="tools-on-caveat">[\s\S]*?<data value=")(\d+)/, (_, a, n) => a + (Number(n) + 1))],
    ['a figure\'s source changed', (x) => x.replace(/(<p class="tools-on-caveat">[\s\S]*?<data value="\d+" data-src=")[^"]+/, '$1elsewhere.json')],
    ['a reader pin that is not its file\'s', (x) => x.replace(/(<ul class="reader-pins"><li><code>[^<]+<\/code>, SHA-256 <code>)[0-9a-f]/, '$1z')],
  ]);
});

test('AC-7: no code, case rule, arm, draw or end state above the fold', () => {
  const h = newPage();
  plantOn(checkPlain, h, [
    ['a code in a skill\'s sentence', (x) => x.replace(/(<span class="r019-says"[^>]*>)/, '$1UNDERPOWERED ')],
    ['end state in a caveat', (x) => x.replace(/(<section id="keep-in-mind"[\s\S]*?<li>)/, '$1Graded on the end state. ')],
  ]);
});

test('AC-8: four plain caveats after the skills', () => {
  const h = newPage();
  plantOn(checkCaveats, h, [
    ['a caveat removed', (x) => x.replace(/(<section id="keep-in-mind"[\s\S]*?)<li>[\s\S]*?<\/li>/, '$1')],
    ['the caveats moved after Report 020', (x) => { const s = sectionOf(x, 'keep-in-mind'); return x.replace(s, '').replace('<section id="how-we-tested"', s + '<section id="how-we-tested"'); }],
  ]);
  const zero = structuredClone(tally()); zero.cant = 0;
  assert.equal(CAVEATS(zero, { six: M().six, sixWord: 'six', fourteenWord: 'fourteen' }).length, 3, 'with no skill to tell, the third caveat is not said');
});

test('AC-9: Report 020 in plain lines, its table folded', () => {
  const h = newPage();
  plantOn(checkReport020, h, [
    ['two lines\' words swapped', replaceOnce('scored higher on Fable 5.2', 'scored lower on Fable 5.2')],
    ['a line removed', (x) => x.replace(/(<ul class="r020-lines"[^>]*>)<li>[\s\S]*?<\/li>/, '$1')],
  ]);
});

test('AC-10: the frozen wording, verbatim, in one folded section, and the home page still reads the counts', async () => {
  const h = newPage();
  plantOn(checkFold, h, [
    ['the section open by default', replaceOnce('<details class="r019-how">', '<details class="r019-how" open>')],
    ['the ruled change removed', (x) => x.replace(/<p class="headline-ruled-change">[^<]*<\/p>/, '')],
    ['the method sentence after the first context row', (x) => { const p = /<p class="headline-method">[\s\S]*?<\/p>/.exec(x)[0]; return x.replace(p, '').replace(/(<section class="placebo-result result-context[\s\S]*?<\/section>)/, '$1' + p); }],
  ]);
  // Spec 792 AC-5's reading, carried (A-792-3): the home page parses the same counts off the page.
  const { latestTally } = await import(path.join(ROOT, 'scripts/site-data.mjs'));
  assert.deepEqual(latestTally(h), latestTally(basePage), 'the home page parses the same counts');
});

test('AC-11: the headline said once in the page\'s own text, and the summary row in spec 125\'s form', async () => {
  const h = newPage();
  plantOn(checkOnce, h, [['the total line put back into the summary', (x) => x.replace(/(<li><b>What we found\.<\/b> )/, (_, a) => a + visible(one(mainOf(x), /<p class="big"[^>]*>/).html) + ' ')]]);
  const row = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/report-summaries.json'), 'utf8')).reports['019'];
  const body = visible(require(path.join(ROOT, 'scripts/site-chrome.js')).splitReportBody(h).body);
  await checkSummaryRow(row, body);
  const planted = structuredClone(row); planted.points.splice(1, 0, { lead: 'More.', text: 'Each skill ran three draws per arm.', sources: row.points[0].sources });
  await assert.rejects(checkSummaryRow(planted, body), assert.AssertionError, 'plant: an engine word reads red');
});

// A-794-3 (PR 795, F-1): "no better than the fake" is a claim the frozen Terms say no reading
// supports. It appears on no surface the page feeds, except in that Terms sentence itself.
const TERMS_SENTENCE = 'None of them shows that a skill does no better than the fake.';
const SURFACES = ['docs/reports/019/index.html', 'docs/reports/019/index.md', 'docs/index.html', 'docs/llms.txt', 'docs/llms-full.txt'];
function surfaces() {
  const out = Object.fromEntries(SURFACES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  out['docs/data/report-summaries.json#019'] = JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/report-summaries.json'), 'utf8')).reports['019']);
  out['docs/data/stats.json#latest_point_2_text'] = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/stats.json'), 'utf8')).latest_point_2_text.value;
  return out;
}
function checkPhrase(all) {
  for (const [f, text] of Object.entries(all)) {
    const hit = /no better than the fake/i.exec(text.split(TERMS_SENTENCE).join(' '));
    assert.ok(!hit, 'no "no better than the fake" on ' + f + (hit ? ': ' + text.split(TERMS_SENTENCE).join(' ').slice(Math.max(0, hit.index - 60), hit.index + 40) : ''));
  }
}
test('AC-1, A-794-3: "no better than the fake" is on no surface outside the frozen Terms sentence', () => {
  const s = surfaces();
  assert.ok(s['docs/reports/019/index.html'].includes(TERMS_SENTENCE), 'control: the frozen Terms sentence stays on the page');
  plantOn(checkPhrase, s, [
    ['the old group word on the page', (x) => ({ ...x, 'docs/reports/019/index.html': x['docs/reports/019/index.html'].replace('Did not beat the fake', 'No better than the fake') })],
    ['the old answer in the summary row', (x) => ({ ...x, 'docs/data/report-summaries.json#019': x['docs/data/report-summaries.json#019'].replace('did not beat it', 'did no better than the fake') })],
    ['the old answer on the home page', (x) => ({ ...x, 'docs/index.html': x['docs/index.html'].replace('did not beat it', 'did No Better Than The Fake') })],
  ]);
});

test('AC-12: --check rebuilds the committed page, and no new script loads', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/prepare-report-019.js'), '--check'], { cwd: ROOT, encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(scripts(newPage()), scripts(basePage), 'the same scripts as today');
});

// AC-14: the styles are one block, scoped, and nothing else in the stylesheet moves.
const BLOCK_RE = /\/\* report 019 \(spec 794\) \*\/[\s\S]*?\/\* \/report 019 \(spec 794\) \*\/\n/;
const OLD_RE = /\/\* report 019 \(spec 792\) \*\/[\s\S]*?\/\* \/report 019 \(spec 792\) \*\/\n/;
function checkCss(css) {
  const m = BLOCK_RE.exec(css); assert.ok(m, 'one report 019 block'); assert.equal(css.match(new RegExp(BLOCK_RE.source, 'g')).length, 1);
  assert.ok(css.replace(BLOCK_RE, '') === gitShow(CSS_REL).replace(OLD_RE, ''), 'outside the block, the stylesheet is the Base\'s without spec 792\'s block');
  assert.ok(css.endsWith(m[0]), 'the block comes after every other rule');
  const body = m[0].replace(/\/\*[\s\S]*?\*\//g, '');
  for (const s of body.matchAll(/([^{}]+)\{/g)) {
    const sel = s[1].trim(); if (sel.startsWith('@') || /^(from|to|\d+%)$/.test(sel)) continue;
    const parts = []; let depth = 0, cur = '';
    for (const ch of sel) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    for (const part of parts) assert.match(part, /\.r0(19|20)-/, 'a selector names a report 019 class: ' + part.trim());
  }
}
test('AC-14: the new styles are one scoped block at the end of docs/tokens.css, replacing spec 792\'s', () => {
  const css = fs.readFileSync(path.join(ROOT, CSS_REL), 'utf8');
  plantOn(checkCss, css, [
    ['a selector with no report 019 class', (x) => x.replace('/* /report 019 (spec 794) */', '.placebo-row { color: var(--ink); }\n/* /report 019 (spec 794) */')],
    ['a byte changed outside the block', (x) => x.replace(':focus-visible { outline: 2px solid', ':focus-visible { outline: 3px solid')],
  ]);
});

// ── AC-13: in a browser ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
function serve() {
  const docs = path.join(ROOT, 'docs');
  const server = http.createServer((req, res) => {
    let f = path.join(docs, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(docs)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
async function withPage(width, height, fn, scheme = 'no-preference') {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
  const server = await serve(), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme }), page = await ctx.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto('http://127.0.0.1:' + server.address().port + '/reports/019/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally { await browser.close(); server.close(); }
}
const pageWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth);
const marksInside = (page) => page.evaluate(() => [...document.querySelectorAll('table.r019-chart tr.r019-bar')].map((tr) => {
  const svg = tr.querySelector('svg.r019-track').getBoundingClientRect();
  // A vertical tick's box is zero wide, so a mark is drawn when its box has a width or a height (A-794-1).
  return [...tr.querySelectorAll('.r019-dot, .r019-fake, .r019-none')].every((m) => { const r = m.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && r.left >= svg.left - 1 && r.right <= svg.right + 1; });
}));
test('AC-13: no sideways scroll at 375 px, marks inside their tracks, the table fits at 1280 px, focus shows, one look', async () => {
  await withPage(375, 812, async (page) => {
    assert.ok(await pageWidth(page) <= 375, 'no sideways scroll at 375 px');
    const m = await marksInside(page); assert.equal(m.length, 20); assert.ok(m.every(Boolean), 'every mark inside its track');
    await page.addStyleTag({ content: 'table.r019-chart { min-width: 600px; }' });
    assert.ok(await pageWidth(page) > 375 || !(await marksInside(page)).every(Boolean) || await page.evaluate(() => { const w = document.querySelector('table.r019-chart').closest('.table-wrap'); return w.scrollWidth > w.clientWidth; }), 'plant: a wide chart reads red');
  });
  await withPage(1280, 900, async (page) => {
    await page.evaluate(() => { document.querySelector('#report-020 details').open = true; });
    const f = await page.evaluate(() => { const w = document.querySelector('#report-020 .table-wrap'), t = w.querySelector('table'); return { table: t.scrollWidth, wrap: w.clientWidth }; });
    assert.ok(f.table <= f.wrap, 'Report 020\'s table fits its wrapper: ' + JSON.stringify(f));
    const focusOf = async (sel) => { await page.focus(sel); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); return page.evaluate((q) => { const e = document.activeElement, c = getComputedStyle(e); return { same: e === document.querySelector(q), style: c.outlineStyle, width: parseFloat(c.outlineWidth) }; }, sel); };
    for (const sel of ['table.r019-chart tr.r019-bar a', '#each-skill section.placebo-result > details > summary']) {
      const r = await focusOf(sel); assert.ok(r.same && r.style !== 'none' && r.width >= 2, 'focus shows on ' + sel + ': ' + JSON.stringify(r));
    }
    await page.addStyleTag({ content: 'table.r019-chart a:focus-visible { outline: none !important; }' });
    const r = await focusOf('table.r019-chart tr.r019-bar a'); assert.equal(r.style, 'none', 'plant: no outline reads red');
  });
  const colours = (scheme) => withPage(1280, 900, (page) => page.evaluate(() => ['.r019-card', 'table.r019-chart .r019-dot', '.r019-verdict', '#each-skill section.placebo-result > details > summary'].map((s) => { const c = getComputedStyle(document.querySelector(s)); return [s, c.color, c.backgroundColor, c.fill]; })), scheme);
  assert.deepEqual(await colours('light'), await colours('dark'), 'one committed look in both colour schemes');
});
