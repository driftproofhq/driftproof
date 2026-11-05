// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 687 (spec 687): the home page for non-technical readers, and the menu. Each test reads the
// built page, the data layer and the latest report page itself, so no row takes the builder's word
// for what the report says. Browser rows render the page in Chromium from node_modules and write
// their screenshots under TMPDIR (/var/tmp), never into the tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { htmlToText } = require('../scripts/html-text.js');
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const scratch = (name) => fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', name));
const text = (h) => htmlToText(h, { collapse: true });
const home = () => read('docs/index.html');
const stats = () => JSON.parse(read('docs/data/stats.json'));
const section = (h, id) => { const m = new RegExp(`<section[^>]*\\bid="${id}"[\\s\\S]*?</section>`).exec(h); return m ? m[0] : null; };
const hero = (h) => section(h, 'hero') || '';
// A plant on a copy of the page: the anchor must be there once, so a moved anchor reads as a failed
// plant rather than as a passing row.
const plant = (h, from, to) => { assert.equal(h.split(from).length, 2, `plant anchor once: ${from.slice(0, 60)}`); return h.replace(from, to); };
const latestNumber = () => stats().latest_report_number.value;
const latestPage = () => read(`docs/reports/${latestNumber()}/index.html`);
// The oracle for the tally: the latest report's own plain-words counts line, parsed here.
function tallyOf(reportHtml) {
  const m = /<p class="headline-counts-plain">([\s\S]*?)<\/p>/.exec(reportHtml);
  if (!m) return null;
  const t = text(m[1]);
  const head = /^Of the (\d+) skills counted: (.*)\.$/.exec(t);
  assert.ok(head, `the counts line parses: ${t}`);
  const items = head[2].split(', ').map((x) => { const q = /^(\d+) (.+)$/.exec(x); assert.ok(q, x); return { count: Number(q[1]), label: q[2] }; });
  return { total: Number(head[1]), items };
}
const TILE_CLASS = { 'beat the fake': 'is-up', 'below the fake': 'is-down', 'too few answers to tell': 'is-few', 'not measured': 'is-none' };
const tileClassOf = (label) => TILE_CLASS[label] || 'is-flat';
// The caveats: every summary sentence except the repeated headline sentence.
function caveatsOf(n, reportHtml) {
  const points = require('../scripts/site-chrome.js').summaryPoints(n) || [];
  const big = text((/<div class="headline">[\s\S]*?<p class="big"[^>]*>([\s\S]*?)<\/p>/.exec(reportHtml) || [])[1] || '');
  const head = big.slice(0, 40);
  // A-687-3, issue 702: retain all sentences after the repeated headline.
  return points.flatMap(p => {
    if (!(head && p.text.startsWith(head))) return [p];
    const sentences = p.text.match(/[^]*?[.!?](?=\s|$)|[^]+$/g) || [];
    const rest = sentences.slice(1).join('').trim();
    return rest ? [{...p, text: rest}] : [];
  });
}
// The finding's oracle (A-687-1): the headline block's text, its first sentence by the test's own rule
// (up to the first sentence end followed by white space or the end), and the clause before its first colon.
function findingOf(reportHtml) {
  const big = text((/<div class="headline">[\s\S]*?<p class="big"[^>]*>([\s\S]*?)<\/p>/.exec(reportHtml) || [])[1] || '');
  const m = /^[\s\S]*?[.?!](?=\s|$)/.exec(big);
  const sentence = (m ? m[0] : big).trim();
  return { sentence, claim: sentence.split(/:\s/)[0].replace(/[.?!]$/, '').trim() };
}
const statOf = (h, key) => { const m = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bdata-stat="${key}"[^>]*>([\\s\\S]*?)</\\1>`).exec(h); return m ? text(m[2]) : null; };
const JARGON = ['band', 'judge', 'substrate', 'arm', 'cell', 'lattice', 'stddev', 'effect floor', 'hash', 'placebo', 'baseline', 'sample'];

// ── readers, each written apart from the builder ──────────────────────────────
function readOpening(h) {
  const hits = [];
  const x = hero(h);
  if (!x) return ['no hero section'];
  const h1 = text((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(x) || [])[1] || '');
  const sub = text((/<p class="hero-sub">([\s\S]*?)<\/p>/.exec(x) || [])[1] || '');
  if (!h1) hits.push('no h1 in the hero');
  if (!sub) hits.push('no .hero-sub paragraph in the hero');
  const opening = `${h1} ${sub}`;
  if (!/\bskill/i.test(opening)) hits.push('the opening does not say what a skill is');
  if (!/sugar pill/i.test(opening)) hits.push('the opening does not say how it is tested (a sugar pill)');
  if (!/instruction/i.test(sub)) hits.push('the opening does not say a skill is a file of instructions');
  // The page's own words: the hero without the finding card, whose words are the report's.
  const own = text(x.replace(/<(div|article|aside)\b[^>]*class="[^"]*\bfinding\b[^"]*"[^>]*>[\s\S]*?<\/\1>\s*(?=<\/div>|<\/section>)/, ' '));
  for (const w of JARGON) if (new RegExp(`\\b${w}\\b`, 'i').test(own)) hits.push(`the hero says "${w}"`);
  for (const tag of ['<code', '<pre']) if (x.includes(tag)) hits.push(`the hero carries ${tag}>`);
  for (const cls of ['copy-cta', 'receipt-row-hash']) if (x.includes(`class="${cls}`) || x.includes(` ${cls}`)) hits.push(`the hero carries .${cls}`);
  if (/[0-9a-f]{64}/.test(x)) hits.push('the hero carries a hash');
  for (const s of opening.split(/(?<=[.?!])\s+/)) if (s.split(/\s+/).filter(Boolean).length > 28) hits.push(`a sentence over 28 words: ${s.slice(0, 50)}`);
  const quick = section(h, 'quickstart') || '';
  for (const c of ['claude plugin marketplace add driftproofhq/driftproof', 'claude plugin install driftproof@driftproofhq']) if (!quick.includes(`<code>${c}</code>`)) hits.push(`#quickstart lacks ${c}`);
  if (!/Install in Claude Code/.test(text(quick))) hits.push('#quickstart does not say Install in Claude Code');
  return hits;
}
const DOORS = [
  ['Just curious', ['/how-it-works/', '/reports/017/blind/', '/reports/']],
  ['I use AI skills', ['/skill-lookup/', '/skills/', '/placebo/']],
  ['I make skills', ['#quickstart', '#ci', '/methodology/']],
];
function readDoors(h) {
  const hits = [];
  const x = hero(h);
  const doors = [...x.matchAll(/<(a|div|article)\b[^>]*class="[^"]*\bdoor\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2]);
  if (doors.length !== 3) hits.push(`${doors.length} doors, not three`);
  doors.forEach((d, i) => {
    const want = DOORS[i];
    if (!want) return;
    const title = text((/<(?:h2|h3|p)[^>]*class="[^"]*\bdoor-title\b[^"]*"[^>]*>([\s\S]*?)<\/(?:h2|h3|p)>/.exec(d) || [])[1] || '');
    if (title !== want[0]) hits.push(`door ${i + 1} is titled "${title}", not "${want[0]}"`);
    for (const href of want[1]) if (!d.includes(`href="${href}"`)) hits.push(`door "${want[0]}" does not link ${href}`);
  });
  if (!x.includes('<a href="/how-it-works/">New to this? See how it works, step by step</a>')) hits.push('the curious door lacks spec 640 AC-13\'s words');
  for (const m of x.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^https?:/.test(href)) continue;
    if (href.startsWith('#')) { if (!new RegExp(`\\bid="${href.slice(1)}"`).test(h)) hits.push(`${href} names no id on the page`); continue; }
    // A-687-2 (issue 689): a link into another page's fragment resolves to that page, as readNav reads
    // the menu; the plain-word markers link /glossary/#term-<id> from the hero's own sentences.
    const rel = href.replace(/#.*$/, '').replace(/^\//, '');
    const f = path.join(DOCS, rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!fs.existsSync(f)) hits.push(`${href} resolves to nothing under docs/`);
  }
  return hits;
}
function readFinding(h, S, reportHtml, n) {
  const hits = [];
  const card = (/<(div|article|aside)\b[^>]*class="[^"]*\bfinding\b[^"]*"[^>]*>[\s\S]*?<\/\1>\s*(?=<\/div>|<\/section>)/.exec(hero(h)) || [])[0] || '';
  if (!card) return ['no .finding card in the hero'];
  if (!card.includes(`href="/reports/${n}/"`)) hits.push(`the finding does not link /reports/${n}/`);
  if (!new RegExp(`Report ${n}\\b`).test(text(card))) hits.push(`the finding is not headed with Report ${n}`);
  // The finding, never cut (A-687-1): the whole first sentence of the report's headline block, read
  // here by the test's own sentence rule, and its short form, the clause before the first colon.
  const oracle = findingOf(reportHtml);
  const claim = statOf(card, 'latest_report_claim');
  const sentence = statOf(card, 'latest_report_sentence');
  for (const [k, v] of [['claim', claim], ['sentence', sentence]]) if (v === null || /…|\.\.\./.test(v)) hits.push(`the finding's ${k} is missing or elided: ${v}`);
  if (sentence !== oracle.sentence) hits.push(`the finding's sentence is not the report's whole first sentence: ${sentence}`);
  if (claim !== oracle.claim) hits.push(`the finding's short form is not the sentence's first clause: ${claim}`);
  if (String(S.latest_report_sentence && S.latest_report_sentence.value) !== oracle.sentence) hits.push('stats.json latest_report_sentence is not the report\'s');
  const tally = tallyOf(reportHtml);
  if (tally) {
    if (statOf(card, 'latest_tally_total') !== String(tally.total)) hits.push('latest_tally_total is not the report\'s total');
    if (String(S.latest_tally_total && S.latest_tally_total.value) !== String(tally.total)) hits.push('stats.json latest_tally_total is not the report\'s');
    let shownSum = 0;
    tally.items.forEach((it, i) => {
      const k = i + 1;
      if (String(S[`latest_tally_${k}_count`] && S[`latest_tally_${k}_count`].value) !== String(it.count)) hits.push(`stats.json latest_tally_${k}_count is not ${it.count}`);
      if (String(S[`latest_tally_${k}_label`] && S[`latest_tally_${k}_label`].value) !== it.label) hits.push(`stats.json latest_tally_${k}_label is not "${it.label}"`);
      const shownCount = statOf(card, `latest_tally_${k}_count`);
      // A-687-1: a reading the report counted no skill under is not listed; every other is, in order.
      if (it.count === 0) { if (shownCount !== null || statOf(card, `latest_tally_${k}_label`) !== null) hits.push(`the legend lists a zero count: ${it.label}`); return; }
      if (shownCount !== String(it.count)) hits.push(`the legend's count ${k} is not ${it.count}`);
      if (statOf(card, `latest_tally_${k}_label`) !== it.label) hits.push(`the legend's label ${k} is not "${it.label}"`);
      shownSum += Number(shownCount);
    });
    if (shownSum !== tally.total) hits.push(`the legend's counts sum to ${shownSum}, not the report's ${tally.total}`);
    if (S[`latest_tally_${tally.items.length + 1}_count`]) hits.push('stats.json carries a tally field past the report\'s last reading');
    const svg = (/<svg\b[^>]*class="[^"]*\bfinding-tiles\b[^"]*"[\s\S]*?<\/svg>/.exec(card) || [])[0] || '';
    if (!svg) hits.push('no .finding-tiles svg');
    else {
      if (/<text\b/.test(svg) || /\d/.test(text(svg))) hits.push('the tiles svg carries text or a digit');
      const tiles = [...svg.matchAll(/<rect\b[^>]*class="[^"]*\btile\b[^"]*"[^>]*>/g)].map((m) => (/\bis-[a-z]+\b/.exec(m[0]) || [])[0]);
      const want = tally.items.flatMap((it) => Array(it.count).fill(tileClassOf(it.label)));
      if (tiles.length !== tally.total) hits.push(`${tiles.length} tiles for ${tally.total} skills counted`);
      if (JSON.stringify(tiles) !== JSON.stringify(want)) hits.push(`the tiles' classes in order are not the tally's: ${tiles.join(' ')}`);
    }
  } else if (S.latest_tally_total) hits.push('stats.json carries a tally for a report with no counts line');
  caveatsOf(n, reportHtml).forEach((p, i) => {
    const k = i + 1;
    if (statOf(card, `latest_point_${k}_lead`) !== p.lead) hits.push(`caveat ${k}'s lead is not "${p.lead}"`);
    if (statOf(card, `latest_point_${k}_text`) !== p.text) hits.push(`caveat ${k}'s text is not the report's: ${p.text.slice(0, 50)}`);
    if (String(S[`latest_point_${k}_text`] && S[`latest_point_${k}_text`].value) !== p.text) hits.push(`stats.json latest_point_${k}_text is not the summary's`);
  });
  return hits;
}
const TOP = [['Reports', '/reports/'], ['Skills', '/skills/'], ['How it works', '/how-it-works/'], ['For builders', ''], ['GitHub', 'https://github.com/driftproofhq/driftproof']];
const BASE_HREFS = ['/reports/', '/benchmark-gap/', '/leaderboard-noise/', '/skills/', '/findings/', '/paper/', '/#how-it-works', '/methodology/', '/neutrality/', '/interop/', '/authoring/', '/judge-policy/', '/how-this-is-built/', '/glossary/', '/report-types/', 'https://github.com/driftproofhq/driftproof'];
const NAV_FENCE = /<!--driftproof:nav-->[\s\S]*?<!--\/driftproof:nav-->/;
function htmlPages(dir = DOCS) {
  const out = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.html')) out.push(f); } })(dir);
  return out.sort();
}
function readNav(navFence, pages) {
  const hits = [];
  const site = (/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(navFence) || [])[1] || '';
  const group = (/<details class="docs-menu"><summary>([\s\S]*?)<\/summary><div class="docs-menu-list">([\s\S]*?)<\/div><\/details>/.exec(site) || []);
  const bare = site.replace(/<details class="docs-menu">[\s\S]*?<\/details>/, `<summary>${group[1] || ''}</summary>`);
  const top = [...bare.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<summary>([\s\S]*?)<\/summary>/g)].map((m) => (m[3] !== undefined ? [text(m[3]), ''] : [text(m[2]), m[1]]));
  if (JSON.stringify(top) !== JSON.stringify(TOP)) hits.push(`the top level is ${top.map((x) => x.join('|')).join(', ')}`);
  const hrefs = new Set([...site.matchAll(/href="([^"]+)"/g)].map((m) => m[1]));
  for (const href of BASE_HREFS) if (!hrefs.has(href)) hits.push(`the menu lost ${href}`);
  for (const href of hrefs) {
    if (/^https?:/.test(href)) continue;
    const rel = href.replace(/#.*$/, '').replace(/^\//, '');
    const f = path.join(DOCS, rel === '' ? 'index.html' : rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!fs.existsSync(f)) hits.push(`${href} points at nothing under docs/`);
  }
  if (!/<details class="nav-menu"><summary>Menu<\/summary><\/details>/.test(navFence)) hits.push('no Menu disclosure');
  for (const f of pages) {
    const m = NAV_FENCE.exec(fs.readFileSync(f, 'utf8'));
    if (m && m[0] !== navFence) hits.push(`${path.relative(DOCS, f)}: its nav fence is not the home page's`);
  }
  return hits;
}

// ── the rows ──────────────────────────────────────────────────────────────────
test('AC-1 a plain opening: no command, hash or jargon in the hero; the commands in #quickstart', () => {
  const h = home();
  assert.deepEqual(readOpening(h), []);
  const withCode = plant(h, '<p class="hero-sub">', '<p class="hero-sub"><span class="copy-cta"><code>claude plugin install driftproof@driftproofhq</code></span>');
  assert.ok(readOpening(withCode).some((x) => /copy-cta|<code/.test(x)), 'a command in the hero reads red');
  const withBand = plant(h, '<p class="hero-sub">', '<p class="hero-sub">A band. ');
  assert.ok(readOpening(withBand).some((x) => /"band"/.test(x)), 'jargon in the opening reads red');
});

test('AC-2 three doors, each link resolving', () => {
  const h = home();
  assert.deepEqual(readDoors(h), []);
  // The first occurrence on the page is the door's: the hero comes first.
  assert.ok(hero(h).includes('href="/skill-lookup/"'));
  const broken = h.replace('href="/skill-lookup/"', 'href="/skill-lookup-planted/"');
  assert.ok(readDoors(broken).some((x) => /resolves to nothing|does not link/.test(x)), 'a broken door link reads red');
});

test('AC-3 the latest finding is the report\'s own headline, tally and caveats, read not typed', async () => {
  const h = home(); const S = stats(); const n = latestNumber(); const rp = latestPage();
  assert.deepEqual(readFinding(h, S, rp, n), []);
  const tally = tallyOf(rp);
  if (tally) {
    const firstTile = /<rect class="tile is-[a-z]+"[^>]*\/>\n?/.exec(h);
    assert.ok(firstTile, 'a first tile to plant on');
    const oneLess = h.replace(firstTile[0], '');
    assert.ok(readFinding(oneLess, S, rp, n).some((x) => /tiles for/.test(x)), 'a tile removed reads red');
    const first = `data-stat="latest_tally_1_count">${tally.items[0].count}<`;
    const changed = plant(h, first, `data-stat="latest_tally_1_count">${tally.items[0].count + 1}<`);
    assert.ok(readFinding(changed, S, rp, n).some((x) => /legend's count 1/.test(x)), 'a changed legend count reads red');
    // The data layer: a page copy with the counts line removed yields no tally field; the caveats
    // are still read; a counts line whose counts do not sum to its total refuses.
    const D = await import(path.join(ROOT, 'scripts', 'site-data.mjs'));
    const noLine = rp.replace(/<p class="headline-counts-plain">[\s\S]*?<\/p>/, '');
    assert.deepEqual(D.latestTallyFields(noLine, 'x'), {}, 'no tally field for a report with no counts line');
    assert.ok(D.latestPointFields(n, noLine, 'x').latest_point_1_text, 'the caveats are still read');
    assert.deepEqual(D.latestTallyFields(rp, 'x').latest_tally_total.value, tally.total);
    const badSum = rp.replace(/<p class="headline-counts-plain">[\s\S]*?<\/p>/, '<p class="headline-counts-plain">Of the 99 skills counted: 12 beat the fake, 2 below the fake.</p>');
    assert.throws(() => D.latestTallyFields(badSum, 'x'), /do not sum/);
  }
  // A-687-1: a cut or elided finding sentence reads red, with and without the ellipsis; a zero count
  // listed in the legend reads red; the data layer refuses an elided headline.
  const whole = findingOf(rp).sentence;
  const cutAt = whole.lastIndexOf(' on none');
  const cut = cutAt > 0 ? whole.slice(0, cutAt) : whole.slice(0, Math.floor(whole.length * 0.8));
  const elided = plant(h, `data-stat="latest_report_sentence">${whole}<`, `data-stat="latest_report_sentence">${cut}…<`);
  assert.ok(readFinding(elided, S, rp, n).some((x) => /elided/.test(x)), 'an ellipsised finding sentence reads red');
  const silent = plant(h, `data-stat="latest_report_sentence">${whole}<`, `data-stat="latest_report_sentence">${cut}.<`);
  assert.ok(readFinding(silent, S, rp, n).some((x) => /not the report's whole first sentence/.test(x)), 'a cut finding sentence reads red');
  const D1 = await import(path.join(ROOT, 'scripts', 'site-data.mjs'));
  assert.throws(() => D1.latestFindingFields(`<p class="big">${cut}…</p>`, 'x'), /cut or elided/);
  if (tallyOf(rp) && tallyOf(rp).items.some((it) => it.count === 0)) {
    const zero = tallyOf(rp).items.findIndex((it) => it.count === 0) + 1;
    const withZero = plant(h, '<p class="finding-legend" id="finding-legend">', `<p class="finding-legend" id="finding-legend"><span data-stat="latest_tally_${zero}_count">0</span> `);
    assert.ok(readFinding(withZero, S, rp, n).some((x) => /lists a zero count/.test(x)), 'a zero count in the legend reads red');
  }
  const cav = caveatsOf(n, rp);
  assert.ok(cav.length >= 1, 'the latest report carries at least one caveat');
  const dropped = plant(h, `data-stat="latest_point_1_lead">`, `data-stat="latest_point_planted_lead">`);
  assert.ok(readFinding(dropped, S, rp, n).some((x) => /caveat 1/.test(x)), 'a dropped caveat reads red');
});

test('AC-5 the menu: five plain entries, the group keeps every old link, one fence on every page', () => {
  const h = home();
  const fence = (NAV_FENCE.exec(h) || [])[0];
  assert.ok(fence, 'the home page carries a nav fence');
  assert.deepEqual(readNav(fence, htmlPages()), []);
  assert.ok(readNav(fence.replace('<a href="/glossary/">Glossary</a>\n', ''), []).some((x) => /lost \/glossary\//.test(x)), 'a dropped link reads red');
  const dir = scratch('home-page-nav-');
  fs.writeFileSync(path.join(dir, 'planted.html'), h.replace('<a href="/glossary/">Glossary</a>', '<a href="/glossary/">Planted</a>'));
  assert.ok(readNav(fence, [path.join(dir, 'planted.html')]).some((x) => /not the home page's/.test(x)), 'a page with another fence reads red');
  const css = read('docs/tokens.css');
  for (const href of ['/reports/', '/skills/', '/how-it-works/']) assert.match(css, new RegExp(`href\\^="https://driftproofhq\\.com${href.replace(/\//g, '\\/')}"\\]\\)[^{]*nav\\.site-nav > a\\[href="${href.replace(/\//g, '\\/')}"\\]`), `a current-page rule for ${href}`);
  assert.match(css, /\[href\$="\/glossary\/"\][^{]*nav\.site-nav \.docs-menu > summary/, 'the group is marked current for a page it lists');
});

test('AC-6 no new script source', () => {
  const srcs = [...home().matchAll(/<script\b[^>]*\bsrc=['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
  assert.deepEqual(srcs, ['/copy-button.js', '/islands/loader.js', 'https://static.cloudflareinsights.com/beacon.min.js']);
});

test('AC-7 the committed page is its builder\'s', () => {
  const out = execFileSync('node', [path.join(ROOT, 'scripts', 'build-site-pages.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /rendered pages are current/);
});

test('AC-8 the hero\'s words: no superlative, confidence word, lexicon phrase, em dash or reading time', async () => {
  const x = text(hero(home()));
  assert.doesNotMatch(x, /\bconfiden(t|ce)\b|\bsignifican(t|ce)\b|\bbest\b|\bleading\b|\bguarantee|\bworld-class\b|\bproves?\b/i);
  assert.doesNotMatch(x, /\b(minute|minutes|second|seconds) (read|to read)\b|\bin a minute\b/i);
  assert.doesNotMatch(x, /—/);
  process.env.SPEC031_TMP = process.env.SPEC031_TMP || scratch('home-page-lexicon-');
  const { LEXICON } = await import(path.join(ROOT, 'specs', '031-artefact-claims', 'probes', 'bands.mjs'));
  for (const { cls, re } of LEXICON) assert.doesNotMatch(x, re, `band lexicon ${cls}`);
});

test('AC-2, AC-4 Chromium: the first phone screen, both widths, the doors and the screenshots', { timeout: 300000 }, async () => {
  const { chromium } = require('playwright');
  const shots = scratch('home-page-shots-');
  const planted = scratch('home-page-planted-');
  fs.writeFileSync(path.join(planted, 'index.html'), plant(home(), '<p class="hero-sub">', '<p class="copy-cta"><code>claude plugin install driftproof@driftproofhq</code></p><p class="hero-sub">'));
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
  const url = `http://127.0.0.1:${server.address().port}/`;
  const MEASURE = () => {
    const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const inFirst = (sel) => [...document.querySelectorAll(sel)].filter((el) => vis(el) && el.getBoundingClientRect().top < window.innerHeight).length;
    const hero = document.querySelector('#hero');
    const h1 = document.querySelector('h1');
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1Top: h1 ? h1.getBoundingClientRect().top : null,
      h1Lines: h1 ? Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)) : null,
      technical: ['code', 'pre', '.copy-cta', '.receipt-row-hash', '.receipt'].map((s) => [s, inFirst(s)]).filter(([, n]) => n > 0),
      heroColumns: hero ? getComputedStyle(hero).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      doorHeights: [...document.querySelectorAll('#hero .door')].map((d) => Math.round(d.getBoundingClientRect().height)),
      fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    };
  };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await context.route('**/*', async (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    let m = await page.evaluate(MEASURE);
    assert.ok(m.fonts.some((f) => /Newsreader|Alegreya/.test(f)), `the site's fonts loaded: ${m.fonts.join(', ')}`);
    assert.equal(m.overflow, 0, 'no sideways scroll at 390');
    assert.ok(m.h1Top !== null && m.h1Top < 844, 'the h1 is on the first phone screen');
    assert.deepEqual(m.technical, [], 'nothing technical on the first phone screen');
    assert.equal(m.doorHeights.length, 3);
    for (const d of m.doorHeights) assert.ok(d >= 44, `a door is ${d}px tall`);
    await page.screenshot({ path: path.join(shots, 'home-390.png'), fullPage: true });
    await page.screenshot({ path: path.join(shots, 'home-390-first-screen.png'), fullPage: false });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    m = await page.evaluate(MEASURE);
    assert.equal(m.overflow, 0, 'no sideways scroll at 1280');
    assert.equal(m.heroColumns, 2, 'the hero is two columns at 1280');
    assert.ok(m.h1Lines !== null && m.h1Lines <= 3, `the h1 sets in at most three lines at 1280 (${m.h1Lines})`);
    await page.screenshot({ path: path.join(shots, 'home-1280.png'), fullPage: true });
    await page.screenshot({ path: path.join(shots, 'home-1280-first-screen.png'), fullPage: false });
    // The plant: a command placed in the hero is seen on the first phone screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setExtraHTTPHeaders({ 'x-planted': '1' });
    await page.goto(url, { waitUntil: 'networkidle' });
    m = await page.evaluate(MEASURE);
    assert.ok(m.technical.length > 0, 'a command planted in the hero reads red at 390');
    await context.close();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  console.log(`screenshots: ${shots}`);
});
