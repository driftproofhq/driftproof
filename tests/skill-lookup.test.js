// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 315 (issue 315): the skill lookup at /skill-lookup/. Each criterion has a reader here that
// shares no code with the island, docs/islands/skill-lookup.js: the list page is parsed again with
// this file's own patterns, spec 267's manifest is read on its own, and every result is rebuilt from
// spec 315's fixed texts. The readers may call the repository's existing definitions of a word or of
// the site (lib/plain.js LABELS, spec 031's LEXICON, scripts/build-head-tags.js beaconFor and
// siteConfig, scripts/build-site-pages.js TARGETS, the CLI's own --help), since the claim is that the
// page says what those say. Each reader is shown to fail a planted subject.
//
// The list the readers run against is HAND-MADE, SPEC 267 MARKUP (spec 315 § The test list): built
// below, never tracked. The committed list page is read too, once spec 267 has merged and this spec's
// build has added data-path to it (AC-3, AC-4). AC-9, the browser run, is browser.test.mjs in the
// spec's folder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const ISLAND = path.join(ROOT, 'docs', 'islands', 'skill-lookup.js');
const PAGE = path.join(ROOT, 'docs', 'skill-lookup', 'index.html');
const LIST = path.join(ROOT, 'docs', 'skills', 'index.html');
const MANIFEST = path.join(ROOT, 'index-receipts', 'sources.json');
const SITEMAP = path.join(ROOT, 'docs', 'sitemap-pages.xml');
const SPEC = path.join(ROOT, 'specs', '315-skill-lookup');

// ── spec 315 § The page texts ──────────────────────────────────────────────────────────────────
const TX = {
  T1: 'Look up a skill in the index | Driftproof',
  H1: 'Look up a skill',
  P1: 'Paste a GitHub link to an agent skill and see whether the skill index has a page for it. The lookup runs in your browser.',
  P2: "It takes a github.com link to a repository, a skill's folder or its SKILL.md, or a raw.githubusercontent.com link to a SKILL.md.",
  F1: 'The lookup needs JavaScript. Without it, every skill the index lists is on the list page.',
  H2: 'What it reads and sends',
  C1: "This page sends the link you paste nowhere. The lookup reads one file from this site, the list at /skills/. Your browser's own features, such as spell check, autofill and page translation, are outside what this page controls.",
  C2: 'No model is called, so the lookup spends no tokens.',
  C3: "A match shows that skill's entry as the list shows it, and nothing more. A link the list has no page for gets a line that says so. Each result names the folder the link was read as: a branch name that holds / is read as its first part.",
  C4: "Like every page on this site, this one counts a visit with Cloudflare Web Analytics. The lookup does not write the link into the page's address, title, cookies or storage.",
  M1: (id) => `The skill index has a page for ${id}:`,
  M2: 'Each row on that page links to its receipt and names the skill commit it measured, where the source recorded one. The link you pasted may point at another version of the skill.',
  N1: (id) => `The skill index has no page for ${id}.`,
  N2: (owner, repo) => `It has a page for the repository ${owner}/${repo} as a whole:`,
  N3: (owner, repo) => `It lists skills in ${owner}/${repo} by folder. Paste the link to one skill's folder.`,
  N4: 'To measure a skill yourself: npx driftproof run <skill-dir> --models <model-id>. It calls a model, so it spends tokens. How to write its test tasks:',
  N4_LINK: { href: '/authoring/', text: 'Writing a fair set of test tasks' },
  U1: (id) => `The skill index could not be read, so this lookup says nothing about ${id}.`,
  X1: "This lookup does not read that link. It takes a github.com link to a repository, a skill's folder or its SKILL.md, or a raw.githubusercontent.com link to a SKILL.md.",
  G6: 'Have a GitHub link to a skill? Look it up.',
};
const idText = (x) => `${x.owner}/${x.repo}${x.path ? `/${x.path}` : ''}`;

// ── spec 315 § The test list, in spec 267's markup with AC-4's data-path ─────────────────────────
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const HAND = [
  { key: 'A', page: 'owner-a/repo-a/alpha', path: 'skills/alpha', rows: ['Driftproof, Claude Opus 5.5 (claude-opus-5-5): Too few answers to tell.', 'skill-placebo, Claude Opus 5.5 (claude-opus-5-5): Reported, not measured.'] },
  { key: 'B', page: 'Owner-B/repo-b/repo-b', path: '', rows: ['skill-placebo, Claude Opus 5.5 (claude-opus-5-5): Reported, not measured.'] },
  { key: 'C', page: 'owner-a/repo-a/gamma', path: 'skills/gamma', rows: ['NVIDIA, Claude Opus 4.8 (aws/anthropic/bedrock-claude-opus-4-8, as the source names it): NVIDIA\'s figures.'] },
];
// The entry markup of scripts/build-skill-index.mjs as read at private/spec/267 88ad2bc0, with AC-4's
// data-path added after data-freshness. bareRows writes the rows as bare text, extra adds bare text
// after the rows: both are lists AC-3 calls unreadable.
function entryHtml(e, { withPath = true, href, bareRows = false, extra = '' } = {}) {
  const rows = bareRows ? e.rows.map(escHtml).join(' ') : e.rows.map((r) => `<span class="skill-entry-row">${escHtml(r)}</span>`).join(' ');
  return `<li class="skill-entry" data-page="${escHtml(e.page)}/" data-source="driftproof" data-evidence="measured" data-freshness="no-newer"${withPath ? ` data-path="${escHtml(e.path)}"` : ''}><a href="${escHtml(href || `/skills/${e.page}/`)}">${escHtml(e.page)}</a> ${rows}${extra}</li>`;
}
function handList(entries = HAND, opts = {}) {
  return ['<!doctype html><html lang="en"><head><title>Worth installing: agent skills measured | Driftproof</title></head><body><main class="skill-index">',
    '<h1>Worth installing?</h1>',
    `<p class="skill-lede">Does an agent skill help, and on which model?</p>`,
    `<p class="skill-lookup-link">Have a GitHub link to a skill? <a href="/skill-lookup/">Look it up</a>.</p>`,
    '<div class="skill-filter" data-island="skill-filter"><p>One entry per skill. Each entry links to a page with one row per receipt.</p></div>',
    '<ul class="skill-list">',
    ...entries.map((e, i) => entryHtml(e, (opts.entry && opts.entry(i)) || {})),
    '</ul>', '</main></body></html>'].join('\n');
}
const HAND_MANIFEST = { receipts: [
  { name: 'alpha', identity: { owner: 'owner-a', repo: 'repo-a', path: 'skills/alpha', unit: 'skill' } },
  { name: 'alpha', identity: { owner: 'owner-a', repo: 'repo-a', path: 'skills/alpha', unit: 'skill' } },
  { name: 'repo-b', identity: { owner: 'Owner-B', repo: 'repo-b', path: '', unit: 'plugin' } },
  { name: 'gamma', identity: { owner: 'owner-a', repo: 'repo-a', path: 'skills/gamma', unit: 'skill' } },
] };

// ── the independent list reader ──────────────────────────────────────────────────────────────────
// An entry's text and markup are read by spec 148's tokenizer (scripts/html-text.js), never by a tag
// strip, and the island shares no code with it (issue 335).
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, '&');
const { tokenize, htmlToText } = require('../scripts/html-text');
// The tags spec 267's entry markup holds: its link and its row spans. Anything else is markup beside them.
const entryTag = (t) => (t.type === 'end' && (t.name === 'a' || t.name === 'span'))
  || (t.type === 'start' && t.name === 'a' && t.attrs.length === 1 && t.attrs[0][0] === 'href')
  || (t.type === 'start' && t.name === 'span' && t.attrs.length === 1 && t.attrs[0][0] === 'class' && t.attrs[0][1] === 'skill-entry-row');
function parseList(html) {
  const start = html.indexOf('<ul class="skill-list">');
  const end = start < 0 ? -1 : html.indexOf('</ul>', start);
  if (start < 0 || end < 0) return null;
  const out = [];
  for (const m of html.slice(start, end).matchAll(/<li class="skill-entry"([^>]*)>([\s\S]*?)<\/li>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/\s([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])]));
    const a = /<a href="([^"]*)">([\s\S]*?)<\/a>/.exec(m[2]);
    const page = attrs['data-page'] || '';
    const [owner, repo, name] = page.split('/');
    out.push({
      owner, repo, name, page, path: attrs['data-path'],
      href: a ? decode(a[1]) : null, text: a ? decode(a[2]) : null,
      rows: [...m[2].matchAll(/<span class="skill-entry-row">([\s\S]*?)<\/span>/g)].map((r) => decode(r[1])),
      liText: htmlToText(m[2], { decode, collapse: true }),
      markup: tokenize(m[2]).filter((t) => t.type !== 'text' && !entryTag(t)).map((t) => t.raw),
    });
  }
  return out;
}
const shape = (e) => ({ owner: e.owner, repo: e.repo, path: e.path, href: e.href, text: e.text, rows: e.rows });
const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();

// The independent whole read (AC-3, AC-5 of spec 315 § Claim and invariants, AC-6): every reason
// the list is unreadable. An empty array means the list was read whole.
function wholeHits(html) {
  const start = html.indexOf('<ul class="skill-list">');
  if (start < 0) return ['no <ul class="skill-list">'];
  const end = html.indexOf('</ul>', start);
  if (end < 0) return ['no </ul> after the list'];
  const hits = [];
  if (html.indexOf('<li class="skill-entry"', end) >= 0) hits.push('an entry after the </ul> the read closed on');
  const es = parseList(html);
  if (!es.length) hits.push('no entry');
  for (const e of es) {
    if (e.path === undefined) hits.push(`${e.page}: no data-path`);
    if (!/^[^/]+\/[^/]+\/[^/]+\/$/.test(e.page)) hits.push(`${e.page}: data-page is not owner/repo/name/`);
    if (e.href !== `/skills/${e.page}`) hits.push(`${e.page}: href ${e.href} is not /skills/ plus data-page`);
    if (!e.rows.length) hits.push(`${e.page}: no row`);
    if (e.liText !== collapse([e.text, ...e.rows].join(' '))) hits.push(`${e.page}: its text is not the link text and its rows`);
    if (e.markup.length) hits.push(`${e.page}: markup beside its link and rows: ${e.markup.join(' ')}`);
  }
  return hits;
}
// Lists AC-3 calls unreadable, each built from the hand-made list.
const BAD_LISTS = {
  'an entry with no data-path': () => handList(HAND, { entry: (i) => (i === 1 ? { withPath: false } : null) }),
  'an href that is not /skills/ plus data-page': () => handList(HAND, { entry: (i) => (i === 2 ? { href: '/skills/owner-a/repo-a/alpha/' } : null) }),
  'a data-page that is not owner/repo/name/': () => handList([{ ...HAND[0], page: 'owner-a/repo-a' }]),
  'an entry whose rows are bare text': () => handList(HAND, { entry: (i) => (i === 0 ? { bareRows: true } : null) }),
  'an entry with bare text beside its rows': () => handList(HAND, { entry: (i) => (i === 0 ? { extra: ' Clearly helped.' } : null) }),
  // Issue 335: markup beside the link and rows leaves the entry unread, whether or not it holds a word.
  // A tag strip read the first two as the link and its rows; the last is the shape one strip leaves.
  'an entry with an empty script beside its rows': () => handList(HAND, { entry: (i) => (i === 0 ? { extra: '<script></script>' } : null) }),
  'an entry with a script that loads a file beside its rows': () => handList(HAND, { entry: (i) => (i === 2 ? { extra: ' <script src="/x.js"></script>' } : null) }),
  'an entry with <scr<script>ipt> beside its rows': () => handList(HAND, { entry: (i) => (i === 1 ? { extra: '<scr<script>ipt>' } : null) }),
  'an entry after the </ul> the read closed on': () => handList().replace('</li>\n<li', '</li>\n</ul>\n<li'),
};

// ── spec 315 § The link table ────────────────────────────────────────────────────────────────────
const id = (owner, repo, p) => ({ ok: true, owner, repo, path: p });
const NO = { ok: false };
const TABLE = [
  [1, 'https://github.com/owner-a/repo-a/tree/main/skills/alpha', id('owner-a', 'repo-a', 'skills/alpha'), { kind: 'match', entries: ['A'] }],
  [2, 'https://github.com/owner-a/repo-a/tree/main/skills/alpha/', id('owner-a', 'repo-a', 'skills/alpha'), { kind: 'match', entries: ['A'] }],
  [3, 'https://github.com/owner-a/repo-a/blob/main/skills/alpha/SKILL.md', id('owner-a', 'repo-a', 'skills/alpha'), { kind: 'match', entries: ['A'] }],
  [4, 'https://github.com/owner-a/repo-a/tree/main/skills/alpha/skill.md', id('owner-a', 'repo-a', 'skills/alpha'), { kind: 'match', entries: ['A'] }],
  [5, 'https://raw.githubusercontent.com/owner-a/repo-a/main/skills/alpha/SKILL.md', id('owner-a', 'repo-a', 'skills/alpha'), { kind: 'match', entries: ['A'] }],
  [6, 'https://raw.githubusercontent.com/owner-a/repo-a/refs/heads/main/skills/alpha/SKILL.md', id('owner-a', 'repo-a', 'skills/alpha'), { kind: 'match', entries: ['A'] }],
  [7, '  github.com/OWNER-A/Repo-A/tree/v1.2.0/skills/alpha  ', id('OWNER-A', 'Repo-A', 'skills/alpha'), { kind: 'match', entries: ['A'] }],
  [8, 'http://www.github.com/owner-a/repo-a/tree/0123456789abcdef0123456789abcdef01234567/skills//alpha?tab=readme#top', id('owner-a', 'repo-a', 'skills/alpha'), { kind: 'match', entries: ['A'] }],
  [9, 'https://github.com/owner-a/repo-a/tree/main/skills/Alpha', id('owner-a', 'repo-a', 'skills/Alpha'), { kind: 'none' }],
  [10, 'https://github.com/owner-a/repo-a/tree/main/skills/alpha/references', id('owner-a', 'repo-a', 'skills/alpha/references'), { kind: 'none' }],
  [11, 'https://github.com/owner-a/repo-a/tree/main/alpha', id('owner-a', 'repo-a', 'alpha'), { kind: 'none' }],
  [12, 'https://github.com/owner-a/repo-a', id('owner-a', 'repo-a', ''), { kind: 'none', byFolder: true }],
  [13, 'https://github.com/owner-a/repo-a/blob/main/SKILL.md', id('owner-a', 'repo-a', ''), { kind: 'none', byFolder: true }],
  [14, 'https://github.com/Owner-B/repo-b.git', id('Owner-B', 'repo-b', ''), { kind: 'match', entries: ['B'] }],
  [15, 'https://github.com/owner-b/repo-b/tree/main/skills/beta', id('owner-b', 'repo-b', 'skills/beta'), { kind: 'none', repository: 'B' }],
  [16, 'https://github.com/owner-z/repo-z/tree/main/skills/alpha', id('owner-z', 'repo-z', 'skills/alpha'), { kind: 'none' }],
  [17, 'https://github.com/owner-a/repo-a/blob/main/skills/alpha/README.md', NO, { kind: 'refused' }],
  [18, 'https://raw.githubusercontent.com/owner-a/repo-a/main/skills/alpha/notes.md', NO, { kind: 'refused' }],
  [19, 'https://gist.github.com/owner-a/0123abcd', NO, { kind: 'refused' }],
  [20, 'https://github.com.example.org/owner-a/repo-a', NO, { kind: 'refused' }],
  [21, 'https://github.com/owner-a/repo-a/issues/3', NO, { kind: 'refused' }],
  [22, 'https://github.com/owner-a', NO, { kind: 'refused' }],
  [23, 'ftp://github.com/owner-a/repo-a', NO, { kind: 'refused' }],
  // A user name and password before the host, joined at run time so no file holds an address.
  [24, ['https://user:pw', 'github.com/owner-a/repo-a'].join(String.fromCharCode(64)), NO, { kind: 'refused' }],
  [25, 'https://github.com:8443/owner-a/repo-a', NO, { kind: 'refused' }],
  [26, 'https://github.com/owner-a/repo-a/tree/main/skills%2Falpha', NO, { kind: 'refused' }],
  [27, 'https://github.com/owner-a/repo-a/tree', NO, { kind: 'refused' }],
  [28, 'https://github.com/owner-a/repo-a/tree/main/skills/<img src=x>', id('owner-a', 'repo-a', 'skills/<img src=x>'), { kind: 'none' }],
  ['29a', '', NO, { kind: 'refused' }],
  ['29b', 'a'.repeat(2049), NO, { kind: 'refused' }],
  // A branch name holding /: read as its first part, and the result names the folder read (C-3).
  [30, 'https://github.com/owner-a/repo-a/tree/release/v2/skills/alpha', id('owner-a', 'repo-a', 'v2/skills/alpha'), { kind: 'none' }],
  [31, 'https://raw.githubusercontent.com/owner-a/repo-a/refs/heads/feature/x/skills/alpha/SKILL.md', id('owner-a', 'repo-a', 'x/skills/alpha'), { kind: 'none' }],
  // URL resolves dot segments before step 4 reads the path: the result names owner-b/repo-b.
  [32, 'https://github.com/owner-a/repo-a/tree/../../../owner-b/repo-b', id('owner-b', 'repo-b', ''), { kind: 'match', entries: ['B'] }],
  // A Unicode format character (U+202E, category Cf) in a segment.
  [33, 'https://github.com/owner-a/repo-a/tree/main/skills/al‮pha', NO, { kind: 'refused' }],
];
const rowOf = (n) => TABLE.find((r) => r[0] === n);
const HAND_BY_KEY = Object.fromEntries(HAND.map((e) => [e.key, shape(parseList(handList([e]))[0])]));

// ── the island, loaded fresh, with fetch stubbed ─────────────────────────────────────────────────
let seq = 0;
const freshIsland = () => import(`${pathToFileURL(ISLAND).href}?fresh=${++seq}`);
const respond = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
async function withFetch(handler, fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(url, init); };
  try { return await fn(calls); } finally { globalThis.fetch = prev; }
}

// A result's parts as the reader compares them.
const partShape = (p) => (p.entry ? { entry: { href: p.entry.href, text: p.entry.text, rows: p.entry.rows } }
  : p.href !== undefined ? { href: p.href, text: p.text } : { text: p.text });
const entryPart = (e) => ({ entry: { href: e.href, text: e.text, rows: e.rows } });
function expectedParts(text, readId, want) {
  if (want.kind === 'refused') return [{ text: TX.X1 }];
  if (want.kind === 'unreadable') return [{ text: TX.U1(idText(readId)) }];
  if (want.kind === 'match') return [{ text: TX.M1(idText(readId)) }, ...want.entries.map((k) => entryPart(HAND_BY_KEY[k])), { text: TX.M2 }];
  return [
    { text: TX.N1(idText(readId)) },
    ...(want.repository ? [{ text: TX.N2(readId.owner, readId.repo) }, entryPart(HAND_BY_KEY[want.repository])] : []),
    ...(want.byFolder ? [{ text: TX.N3(readId.owner, readId.repo) }] : []),
    { text: TX.N4 }, { ...TX.N4_LINK },
  ];
}

// ── AC-1 ─────────────────────────────────────────────────────────────────────────────────────────
function readLinkHits(readLink) {
  const hits = [];
  for (const [n, text, want] of TABLE) {
    let got;
    try { got = readLink(text); } catch (e) { hits.push(`row ${n}: threw ${e.message}`); continue; }
    const g = got && got.ok ? { ok: true, owner: got.owner, repo: got.repo, path: got.path } : { ok: !!(got && got.ok) };
    try { assert.deepEqual(g, want); } catch { hits.push(`row ${n}: read ${JSON.stringify(g)}, the table says ${JSON.stringify(want)}`); }
  }
  return hits;
}
test('AC-1: a link is read by one closed rule, every row of the link table', async () => {
  const { readLink } = await freshIsland();
  assert.deepEqual(readLinkHits(readLink), []);
  const wrap = (f) => (t) => { const r = readLink(t); return f(r, t); };
  const plants = {
    'the ref kept in the path': wrap((r, t) => (r.ok && /\/(tree|blob)\/main\//.test(t) ? { ...r, path: `main/${r.path}`.replace(/\/$/, '') } : r)),
    'a trailing SKILL.md not dropped': wrap((r, t) => (r.ok && /skill\.md$/i.test(t.trim()) ? { ...r, path: `${r.path}/SKILL.md` } : r)),
    'the path lowercased': wrap((r) => (r.ok ? { ...r, path: r.path.toLowerCase() } : r)),
    'gist.github.com accepted': wrap((r, t) => (/gist\.github\.com/.test(t) ? id('owner-a', '0123abcd', '') : r)),
    'a blob link to README.md accepted': wrap((r, t) => (/README\.md$/.test(t) ? id('owner-a', 'repo-a', 'skills/alpha') : r)),
    'github.com.example.org accepted': wrap((r, t) => (/github\.com\.example\.org/.test(t) ? id('owner-a', 'repo-a', '') : r)),
    'a ref holding / guessed': wrap((r, t) => (r.ok && t.includes('/tree/release/') ? { ...r, path: r.path.split('/').slice(1).join('/') } : r)),
    'the dot segments read from the raw text': wrap((r, t) => (t.includes('/../') ? id('owner-a', 'repo-a', '') : r)),
    'a format character let through': wrap((r, t) => (t.includes('‮') ? id('owner-a', 'repo-a', 'skills/al‮pha') : r)),
  };
  for (const [name, f] of Object.entries(plants)) assert.notDeepEqual(readLinkHits(f), [], `plant: ${name}`);
});

// ── AC-2 ─────────────────────────────────────────────────────────────────────────────────────────
function matchHits(readLink, matchEntries, entries) {
  const hits = [];
  for (const [n, text, , want] of TABLE) {
    if (want.kind === 'refused') continue;
    const got = matchEntries(readLink(text), entries).map((e) => HAND.find((h) => `/skills/${h.page}/` === e.href).key);
    const exp = want.kind === 'match' ? want.entries : [];
    if (JSON.stringify(got) !== JSON.stringify(exp)) hits.push(`row ${n}: matched ${JSON.stringify(got)}, the table says ${JSON.stringify(exp)}`);
  }
  return hits;
}
test('AC-2: a match is the identity and only the identity', async () => {
  const { readLink, readList, matchEntries } = await freshIsland();
  const list = readList(handList());
  assert.equal(list.ok, true);
  assert.deepEqual(matchHits(readLink, matchEntries, list.entries), []);
  const lc = (s) => s.toLowerCase();
  const last = (p) => p.split('/').pop();
  const plants = {
    'paths compared ignoring case': (x, es) => es.filter((e) => lc(e.owner) === lc(x.owner) && lc(e.repo) === lc(x.repo) && lc(e.path) === lc(x.path)),
    'the last segment alone': (x, es) => es.filter((e) => lc(e.owner) === lc(x.owner) && lc(e.repo) === lc(x.repo) && last(e.path || e.repo) === last(x.path || x.repo)),
    'a deeper path': (x, es) => es.filter((e) => lc(e.owner) === lc(x.owner) && lc(e.repo) === lc(x.repo) && (x.path === e.path || x.path.startsWith(`${e.path}/`))),
  };
  for (const [name, f] of Object.entries(plants)) assert.notDeepEqual(matchHits(readLink, f, list.entries), [], `plant: ${name}`);
});

// ── AC-3 ─────────────────────────────────────────────────────────────────────────────────────────
function listHits(readList, html) {
  const mine = parseList(html);
  const got = readList(html);
  if (!got || !got.ok) return ['readList refused a list the independent reader reads'];
  const a = JSON.stringify(got.entries.map(shape));
  const b = JSON.stringify(mine.map(shape));
  return a === b ? [] : [`readList read ${got.entries.length} entries, the independent reader ${mine.length}, or they differ`];
}
// The bad lists readList reads as ok: each must be unreadable.
function unreadableHits(readList) {
  return Object.entries(BAD_LISTS).filter(([, make]) => { const r = readList(make()); return !r || r.ok !== false; }).map(([name]) => `readList read ${name}`);
}
test('AC-3: the one file read is the published list, read whole', async () => {
  assert.deepEqual(wholeHits(handList()), [], 'the hand-made list reads whole');
  for (const [name, make] of Object.entries(BAD_LISTS)) assert.notDeepEqual(wholeHits(make()), [], `the independent reader finds ${name} unreadable`);
  const { readList } = await freshIsland();
  assert.deepEqual(listHits(readList, handList()), []);
  assert.notDeepEqual(listHits((h) => { const r = readList(h); return { ...r, entries: r.entries.slice(0, -1) }; }, handList()), [], 'plant: the last entry dropped');
  assert.deepEqual(unreadableHits(readList), []);
  // Plant: a readList that takes whatever entries the markup holds.
  assert.notDeepEqual(unreadableHits((h) => ({ ok: true, entries: parseList(h) || [] })), [], 'plant: a lenient readList');
  // The committed list page, once spec 267 has merged and this spec's build has added data-path.
  assert.ok(fs.existsSync(LIST), 'docs/skills/index.html is not built yet (spec 267 not merged)');
  const html = fs.readFileSync(LIST, 'utf8');
  assert.ok(parseList(html).length > 0, 'the committed list page has no entry');
  assert.deepEqual(wholeHits(html), [], 'the committed list page reads whole');
  assert.deepEqual(listHits(readList, html), []);
});

// ── AC-4 ─────────────────────────────────────────────────────────────────────────────────────────
function pathHits(html, manifest) {
  const ids = manifest.receipts.map((r) => r.identity);
  const hits = [];
  for (const e of parseList(html) || []) {
    if (e.path === undefined) { hits.push(`${e.page}: no data-path`); continue; }
    const name = e.path ? e.path.split('/').pop() : e.repo;
    const found = ids.some((x) => x.owner === e.owner && x.repo === e.repo && x.path === e.path);
    if (!found || name !== e.name) hits.push(`${e.page}: data-path "${e.path}" is no identity's path in the manifest`);
  }
  return hits;
}
// The other direction (mirrors spec 267 AC-17): every manifest identity not held has exactly one entry.
function coverHits(html, manifest, heldPages) {
  const entries = parseList(html) || [];
  const hits = [];
  const seen = new Set();
  for (const r of manifest.receipts) {
    const x = r.identity;
    const key = JSON.stringify([x.owner, x.repo, x.path]);
    if (seen.has(key)) continue;
    seen.add(key);
    const page = `${x.owner}/${x.repo}/${r.name}`;
    if (heldPages.has(page)) continue;
    const n = entries.filter((e) => e.owner === x.owner && e.repo === x.repo && e.path === x.path).length;
    if (n !== 1) hits.push(`${page}: ${n} entries on the list`);
  }
  return hits;
}
test('AC-4: an entry\'s data-path is its identity\'s path, and every identity not held has one entry', async () => {
  assert.deepEqual(pathHits(handList(), HAND_MANIFEST), []);
  assert.notDeepEqual(pathHits(handList().replace('data-path="skills/alpha"', 'data-path="alpha"'), HAND_MANIFEST), [], 'plant: the name as the path');
  assert.notDeepEqual(pathHits(handList().replace('data-path=""', 'data-path="repo-b"'), HAND_MANIFEST), [], 'plant: a root identity carrying its repository as its path');
  assert.deepEqual(coverHits(handList(), HAND_MANIFEST, new Set()), []);
  assert.notDeepEqual(coverHits(handList(HAND.slice(0, 2)), HAND_MANIFEST, new Set()), [], 'plant: an identity left off the list');
  assert.notDeepEqual(coverHits(handList([HAND[0], ...HAND]), HAND_MANIFEST, new Set()), [], 'plant: an identity listed twice');
  assert.deepEqual(coverHits(handList(HAND.slice(0, 2)), HAND_MANIFEST, new Set(['owner-a/repo-a/gamma'])), [], 'a held identity has no entry');
  assert.ok(fs.existsSync(LIST), 'docs/skills/index.html is not built yet (spec 267 not merged)');
  assert.ok(fs.existsSync(MANIFEST), 'index-receipts/sources.json is not committed yet (spec 267 not merged)');
  const html = fs.readFileSync(LIST, 'utf8');
  assert.ok(parseList(html).length > 0, 'the committed list page has no entry');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.deepEqual(pathHits(html, manifest), []);
  // The held identities are spec 267's ruling, read from its builder at the list page's build date.
  const date = /<time data-build-date datetime="(\d{4}-\d{2}-\d{2})">/.exec(html);
  assert.ok(date, 'the committed list page carries no build date');
  const { buildSkillIndex } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'build-skill-index.mjs')).href);
  const held = new Set(buildSkillIndex({ root: ROOT, buildDate: date[1] }).held.map((h) => h.identity));
  assert.deepEqual(coverHits(html, manifest, held), []);
});

// ── AC-5, AC-6, AC-7 ─────────────────────────────────────────────────────────────────────────────
async function resultHits(lookupOf, partsOf, rows, handler) {
  const hits = [];
  for (const [n, text, readId, want] of rows) {
    const { lookup, resultParts } = await freshIsland();
    await withFetch(handler, async (calls) => {
      const L = lookupOf(lookup);
      const P = partsOf(resultParts);
      const r = await L(text);
      const parts = P(r).map(partShape);
      const exp = expectedParts(text, readId, want);
      if (r.kind !== want.kind) hits.push(`row ${n}: kind ${r.kind}, expected ${want.kind}`);
      if (JSON.stringify(parts) !== JSON.stringify(exp)) hits.push(`row ${n}: parts ${JSON.stringify(parts)}`);
      if (want.kind === 'refused' && calls.length) hits.push(`row ${n}: a refusal made ${calls.length} request(s)`);
    });
  }
  return hits;
}
const same = (f) => f;
const listHandler = () => respond(handList());
test('AC-5: a match says what the list says and nothing more', async () => {
  const rows = TABLE.filter((r) => r[3].kind === 'match' || r[3].repository);
  assert.deepEqual(await resultHits(same, same, rows, listHandler), []);
  const tweak = (f) => (P) => (r) => f(P(r));
  const plants = {
    '"Clearly helped" after the label': tweak((ps) => ps.map((p) => (p.entry ? { entry: { ...p.entry, rows: p.entry.rows.map((x) => `${x} Clearly helped`) } } : p))),
    'a row dropped': tweak((ps) => ps.map((p) => (p.entry ? { entry: { ...p.entry, rows: p.entry.rows.slice(1) } } : p))),
    '"Reported, not measured." rewritten as "Measured."': tweak((ps) => ps.map((p) => (p.entry ? { entry: { ...p.entry, rows: p.entry.rows.map((x) => x.replace('Reported, not measured.', 'Measured.')) } } : p))),
    'the link pointed at /skills/': tweak((ps) => ps.map((p) => (p.entry ? { entry: { ...p.entry, href: '/skills/' } } : p))),
  };
  for (const [name, f] of Object.entries(plants)) assert.notDeepEqual(await resultHits(same, f, rows, listHandler), [], `plant: ${name}`);
});

test('AC-6: no page is said only after the whole list was read', async () => {
  // Read whole: every row that reads a link and is not refused.
  const read = TABLE.filter((r) => r[3].kind !== 'refused');
  assert.deepEqual(await resultHits(same, same, read, listHandler), []);
  const unreadable = read.map(([n, t, x]) => [n, t, x, { kind: 'unreadable' }]);
  const cut = handList().split('\n').filter((l) => l !== '</ul>').join('\n');
  const broken = {
    'a 404': () => respond('not found', 404),
    'a network error': () => { throw new TypeError('Failed to fetch'); },
    'a list cut with no closing </ul>': () => respond(cut),
    'an empty list': () => respond(handList([])),
    // The rest are AC-3's unreadable lists.
    ...Object.fromEntries(Object.entries(BAD_LISTS).map(([name, make]) => [name, () => respond(make())])),
  };
  for (const [name, h] of Object.entries(broken)) assert.deepEqual(await resultHits(same, same, unreadable, h), [], name);
  // Plant: a lookup that reads an unreadable list as a list with no page.
  const asNone = (L) => async (t) => { const r = await L(t); return r.kind === 'unreadable' ? { ...r, kind: 'none', entries: [] } : r; };
  assert.notDeepEqual(await resultHits(asNone, same, unreadable.slice(0, 1), broken['a 404']), [], 'plant: a 404 read as no page');
  // Plant: N-1 that does not name the folder the link was read as (C-3).
  const noId = (P) => (r) => P(r).map((p) => (p.text && p.text.startsWith('The skill index has no page for ') ? { text: 'The skill index has no page for this link.' } : p));
  assert.notDeepEqual(await resultHits(same, noId, [rowOf(30)], listHandler), [], 'plant: N-1 without its {id}');
});

test('AC-7: a refusal says what the lookup takes, and makes no request', async () => {
  const refused = TABLE.filter((r) => r[3].kind === 'refused');
  assert.deepEqual(await resultHits(same, same, refused, listHandler), []);
  const fetchFirst = (L) => async (t) => { await globalThis.fetch('/skills/'); return L(t); };
  assert.notDeepEqual(await resultHits(fetchFirst, same, refused.slice(0, 1), listHandler), [], 'plant: a fetch before the link is read');
});

// ── AC-8 ─────────────────────────────────────────────────────────────────────────────────────────
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const FORBIDDEN = [
  ['XMLHttpRequest', /\bXMLHttpRequest\b/], ['sendBeacon', /\bsendBeacon\b/], ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/], ['import(', /\bimport\s*\(/], ['new Image', /\bnew\s+Image\b/], ['Worker', /\bWorker\b/],
  ['postMessage', /\bpostMessage\b/], ['window.open', /\bwindow\.open\b/], ['location written', /\blocation\s*(\.\s*(href|search|hash|pathname)\s*)?=(?!=)|\blocation\.(assign|replace|reload)\s*\(/],
  ['pushState', /\bpushState\b/], ['replaceState', /\breplaceState\b/], ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/], ['indexedDB', /\bindexedDB\b/], ['document.cookie', /\bdocument\.cookie\b/],
  ['caches', /\bcaches\b/], ['innerHTML', /\binnerHTML\b/], ['outerHTML', /\bouterHTML\b/], ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\.write/],
  ['src, srcset or action set', /\.(src|srcset|action|formAction)\s*=(?!=)/],
  ['a request-making attribute set', /setAttribute\(\s*['"](src|srcset|action|formaction|href|ping|style|rel|on\w+)['"]/i],
  // Claim review finding 10: a call reached by name, by reflection or by evaluated text.
  ['bracket access on a global', /\b(window|globalThis|self|navigator|document|location)\s*\[/],
  ['Reflect', /\bReflect\b/], ['eval', /\beval\b/], ['Function(', /\bFunction\s*\(/],
  ['ping', /\bping\b/], ['rel or relList', /\.(rel|relList)\b/], ['style', /\.style\b|\bcssText\b|\burl\s*\(/],
  ['Object.assign', /\bObject\.assign\b/], ['a static import', /^\s*import\b/m],
];
// The elements the island may build: its form and its result (spec 315 § The page texts).
const ELEMENTS = new Set(['form', 'label', 'input', 'button', 'div', 'p', 'span', 'a']);
function sourceHits(src) {
  const code = stripComments(src);
  const hits = FORBIDDEN.filter(([, re]) => re.test(code)).map(([name]) => name);
  const made = [...code.matchAll(/\bcreateElement(NS)?\s*\(/g)].length;
  const named = [...code.matchAll(/\bcreateElement\s*\(\s*(['"])([a-z]+)\1\s*\)/g)].map((m) => m[2]);
  if (made !== named.length) hits.push('an element made from a name that is not a literal');
  for (const t of named) if (!ELEMENTS.has(t)) hits.push(`createElement('${t}')`);
  // One fetch, its first argument /skills/ and its second exactly { cache: 'no-cache' }.
  const fetches = [...code.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
  if (fetches.length !== 1 || [...code.matchAll(/\bfetch\b/g)].length !== 1) hits.push(`${fetches.length} fetch calls`);
  for (const args of fetches) {
    const m = /^([^,]*?)\s*,\s*\{\s*cache\s*:\s*(['"])no-cache\2\s*\}$/.exec(args);
    if (!m) { hits.push(`fetch(${args}) without { cache: 'no-cache' }`); continue; }
    const arg = m[1];
    const literal = /^(['"`])\/skills\/\1$/.test(arg);
    const bound = /^[A-Za-z_$][\w$]*$/.test(arg) && new RegExp(`\\bconst\\s+${arg}\\s*=\\s*(['"\`])/skills/\\1\\s*;`).test(code);
    if (!literal && !bound) hits.push(`fetch(${args})`);
  }
  return hits;
}
async function requestHits(lookupOf, text) {
  const { lookup } = await freshIsland();
  return withFetch(listHandler, async (calls) => {
    const L = lookupOf(lookup);
    const hits = [];
    await L(text);
    await L(text);
    if (calls.length !== 1) hits.push(`${calls.length} requests for two lookups`);
    for (const c of calls) {
      if (c.url !== '/skills/') hits.push(`a request to ${c.url}`);
      const init = c.init || {};
      if (init.cache !== 'no-cache') hits.push(`a request with cache ${init.cache}`);
      if (init.body !== undefined) hits.push('a request with a body');
      if (init.method && String(init.method).toUpperCase() !== 'GET') hits.push(`method ${init.method}`);
      if (JSON.stringify(init.headers || {}).includes(text.trim().slice(8, 40))) hits.push('a header holding the link');
    }
    return hits;
  });
}
test('AC-8: one request, fixed, and only when asked', async () => {
  assert.ok(fs.existsSync(ISLAND), 'docs/islands/skill-lookup.js is not built yet');
  const src = fs.readFileSync(ISLAND, 'utf8');
  assert.deepEqual(sourceHits(src), []);
  for (const leak of [
    "\nfetch('/skills/?q=' + encodeURIComponent(text));",
    '\nfetch(text);',
    "\nnavigator.sendBeacon('/x', 'y');",
    "\nhistory.replaceState(null, '', '?u=1');",
    '\nel.innerHTML = text;',
    "\nglobalThis['fe' + 'tch']('/x');",
    "\nReflect.apply(fetch, null, ['/x']);",
    "\neval('1');",
    "\nFunction('return 1')();",
    "\na.ping = '/x';",
    "\ndocument.createElement('link').href = '/x';",
    "\nel.style.backgroundImage = 'url(/x)';",
    "\nObject.assign(img, { src: '/x' });",
    "\nwindow['open']('/x');",
  ]) assert.notDeepEqual(sourceHits(src + leak), [], `plant: ${leak.trim()}`);
  assert.notDeepEqual(sourceHits(src.replace(/,\s*\{\s*cache\s*:\s*(['"])no-cache\1\s*\}/, '')), [], 'plant: the fetch without no-cache');
  // On load, the module makes no request.
  await withFetch(listHandler, async (calls) => { await freshIsland(); assert.equal(calls.length, 0, 'a request on load'); });
  for (const [n, text, , want] of TABLE) {
    if (want.kind === 'refused') continue;
    assert.deepEqual(await requestHits(same, text), [], `row ${n}`);
  }
  const t = TABLE[0][1];
  const withQuery = (L) => async (x) => { await globalThis.fetch(`/skills/?q=${encodeURIComponent(x)}`); return L(x); };
  assert.notDeepEqual(await requestHits(withQuery, t), [], 'plant: the link sent as a query');
  const again = (L) => async (x) => { await globalThis.fetch('/skills/', { cache: 'no-cache' }); return L(x); };
  assert.notDeepEqual(await requestHits(again, t), [], 'plant: a second lookup fetches again');
  const cached = (L) => async (x) => {
    const f = globalThis.fetch;
    globalThis.fetch = (u, i) => f(u, { ...i, cache: 'default' });
    try { return await L(x); } finally { globalThis.fetch = f; }
  };
  assert.notDeepEqual(await requestHits(cached, t), [], 'plant: the list read from the HTTP cache');
});

// ── AC-14 ────────────────────────────────────────────────────────────────────────────────────────
// Two lookups in flight together share one request, and each resolves to its own link's result.
async function raceHits(lookupOf) {
  const { lookup } = await freshIsland();
  const slow = () => new Promise((r) => setTimeout(() => r(respond(handList())), 50));
  return withFetch(slow, async (calls) => {
    const L = lookupOf(lookup);
    const [a, b] = await Promise.all([L(rowOf(1)[1]), L(rowOf(16)[1])]);
    const hits = [];
    if (calls.length !== 1) hits.push(`${calls.length} requests for two lookups in flight together`);
    if (!(a && a.kind === 'match' && idText(a.identity) === idText(rowOf(1)[2]))) hits.push(`the first lookup read ${JSON.stringify(a && a.kind)}`);
    if (!(b && b.kind === 'none' && idText(b.identity) === idText(rowOf(16)[2]))) hits.push(`the second lookup read ${JSON.stringify(b && b.kind)}`);
    return hits;
  });
}
test('AC-14: lookups in flight together share one request (the shown result is the browser run\'s)', async () => {
  assert.deepEqual(await raceHits(same), []);
  const own = (L) => async (x) => { await globalThis.fetch('/skills/', { cache: 'no-cache' }); return L(x); };
  assert.notDeepEqual(await raceHits(own), [], 'plant: each lookup in flight fetches its own list');
});

// ── AC-10 ────────────────────────────────────────────────────────────────────────────────────────
const mainOf = (html) => { const m = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html); return m ? m[1] : null; };
const ALLOWED_SCRIPT = (tag) => /type="application\/ld\+json"/.test(tag) || /\bsrc="\/islands\/loader\.js"/.test(tag)
  || /\bsrc="\/copy-button\.js"/.test(tag) || /\bsrc='https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js'/.test(tag);
function pageHits(html) {
  const hits = [];
  const main = mainOf(html);
  if (main === null) return ['no <main>'];
  for (const m of main.matchAll(/<(form|input|textarea|select|button)\b/gi)) hits.push(`<${m[1]}> in <main>`);
  const mount = /<div class="skill-lookup" data-island="skill-lookup">([\s\S]*?)<\/div>/.exec(main);
  if (!mount) hits.push('no mount point');
  else if (!mount[1].includes('<a href="/skills/">the list page</a>') || !textOf(mount[1]).includes(TX.F1)) hits.push('the mount point has no fallback F-1');
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) if (!ALLOWED_SCRIPT(m[0])) hits.push(`script ${m[0]}`);
  return hits;
}
function islandFormHits(src) {
  const code = stripComments(src);
  const hits = [];
  if (!/addEventListener\(\s*['"]submit['"]/.test(code) || !/\.preventDefault\(\)/.test(code)) hits.push('no prevented submit');
  if (/\.(action|method|name)\s*=(?!=)|setAttribute\(\s*['"](action|method|name)['"]/.test(code)) hits.push('a form action, method or input name set');
  // Claim review finding 3: the field asks the browser for no autofill and no spell check, and has
  // no id for autofill history to key on (the label wraps the input, so no for is needed).
  if (!/\.autocomplete\s*=\s*(['"])off\1|setAttribute\(\s*(['"])autocomplete\2\s*,\s*(['"])off\3\s*\)/.test(code)) hits.push('autocomplete is not set off');
  if (!/\.spellcheck\s*=\s*false\b|setAttribute\(\s*(['"])spellcheck\1\s*,\s*(['"])false\2\s*\)/.test(code)) hits.push('spellcheck is not set false');
  if (/\.spellcheck\s*=\s*true\b|setAttribute\(\s*(['"])spellcheck\1\s*,\s*(['"])true\2/.test(code)) hits.push('spellcheck set true');
  if (/\.(id|htmlFor)\s*=(?!=)|setAttribute\(\s*(['"])(id|for)\2/.test(code)) hits.push('an id or a for set');
  return hits;
}
test('AC-10: the page reads without JavaScript and holds nothing that could submit', () => {
  assert.ok(fs.existsSync(PAGE), 'docs/skill-lookup/index.html is not built yet');
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.deepEqual(pageHits(html), []);
  assert.notDeepEqual(pageHits(html.replace('</main>', '<form action="/search"><input name="q"></form></main>')), [], 'plant: a form in <main>');
  assert.notDeepEqual(pageHits(html.replace('</main>', '</main><script src="/islands/skill-lookup.js"></script>')), [], 'plant: the island by its own script tag');
  assert.notDeepEqual(pageHits(html.replace(/(<div class="skill-lookup" data-island="skill-lookup">)[\s\S]*?(<\/div>)/, '$1$2')), [], 'plant: the mount point without its fallback');
  assert.ok(fs.existsSync(ISLAND), 'docs/islands/skill-lookup.js is not built yet');
  const src = fs.readFileSync(ISLAND, 'utf8');
  assert.deepEqual(islandFormHits(src), []);
  assert.notDeepEqual(islandFormHits(`${src}\nform.action = '/search';`), [], 'plant: a form action');
  assert.notDeepEqual(islandFormHits(`${src}\ninput.id = 'link';`), [], 'plant: an id on the input');
  assert.notDeepEqual(islandFormHits(`${src}\nlabel.htmlFor = 'link';`), [], 'plant: a label for an id');
  assert.notDeepEqual(islandFormHits(`${src}\ninput.spellcheck = true;`), [], 'plant: spell check turned on');
  assert.notDeepEqual(islandFormHits(src.replace(/\.autocomplete\s*=\s*(['"])off\1/g, ".autocomplete = 'on'").replace(/setAttribute\(\s*(['"])autocomplete\1\s*,\s*(['"])off\2\s*\)/g, "setAttribute('autocomplete', 'on')")), [], 'plant: autocomplete not set off');
});

// ── AC-11 ────────────────────────────────────────────────────────────────────────────────────────
function textOf(html) {
  return htmlToText(html, { blockTags: ['p', 'h1', 'h2', 'h3', 'div', 'li', 'ul', 'section', 'br'], decode, collapse: true });
}
const CONFIDENCE = /\bconfiden(t|ce|tly)\b|\bsignifican(t|ce|tly)\b/i;
async function wordHits(texts) {
  const { LEXICON } = await import(pathToFileURL(path.join(ROOT, 'specs', '031-artefact-claims', 'probes', 'bands.mjs')).href);
  const { LABELS } = require('../lib/plain');
  const hits = [];
  for (const s of texts) {
    if (CONFIDENCE.test(s)) hits.push(`confidence: ${s.slice(0, 60)}`);
    for (const { cls, re } of LEXICON) if (re.test(s)) hits.push(`lexicon ${cls}: ${s.slice(0, 60)}`);
    for (const v of Object.values(LABELS)) if (s.includes(v)) hits.push(`verdict word "${v}": ${s.slice(0, 60)}`);
  }
  return hits;
}
function mainTextHits(mainText, hasBeacon) {
  const want = [TX.H1, TX.P1, TX.P2, TX.F1, TX.H2, TX.C1, TX.C2, TX.C3, ...(hasBeacon ? [TX.C4] : [])].join(' ');
  return mainText === want ? [] : [`<main> reads ${JSON.stringify(mainText.slice(0, 120))}...`];
}
function commandHits(n4, help) {
  const m = /npx driftproof run <skill-dir> (--[a-z-]+) <model-id>\./.exec(n4);
  const runLine = help.split('\n').find((l) => /^\s*driftproof run <skill-dir>/.test(l)) || '';
  return m && runLine.includes(`[${m[1]} `) ? [] : [`N-4's command is not the CLI's: ${n4.slice(0, 80)}`];
}
test('AC-11: the page\'s words are its fixed texts, and each is true of the page', async () => {
  const { beaconFor, siteConfig } = require('../scripts/build-head-tags.js');
  const hasBeacon = !!beaconFor(siteConfig().cloudflare_analytics_token);
  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'driftproof'), '--help'], { encoding: 'utf8' }).stdout;
  assert.deepEqual(commandHits(TX.N4, help), [], 'the spec\'s own N-4 against the CLI');
  assert.notDeepEqual(commandHits(TX.N4.replace('--models', '--model'), help), [], 'plant: N-4 reading --model');
  assert.notDeepEqual(mainTextHits([TX.H1, TX.P1, TX.P2, TX.F1, TX.H2, TX.C1, TX.C2, TX.C3, TX.C4].join(' '), false), [], 'plant: C-4 on a page with no beacon');
  const fixed = [TX.T1, TX.H1, TX.P1, TX.P2, TX.F1, TX.H2, TX.C1, TX.C2, TX.C3, TX.C4, TX.M1('o/r/p'), TX.M2, TX.N1('o/r/p'), TX.N2('o', 'r'), TX.N3('o', 'r'), TX.N4, TX.N4_LINK.text, TX.U1('o/r/p'), TX.X1, TX.G6];
  assert.deepEqual(await wordHits(fixed), [], 'the fixed texts');
  assert.notDeepEqual(await wordHits([TX.C3.replace('nothing more', 'nothing more, at 95% confidence')]), [], 'plant: confidence language in C-3');
  assert.notDeepEqual(await wordHits([`${TX.M2} Clearly helped.`]), [], 'plant: a verdict word in M-2');
  // The built page and the island's own result texts.
  assert.ok(fs.existsSync(PAGE), 'docs/skill-lookup/index.html is not built yet');
  const html = fs.readFileSync(PAGE, 'utf8');
  const title = /<title>([\s\S]*?)<\/title>/.exec(html);
  assert.equal(title && decode(title[1]), TX.T1);
  assert.equal(html.includes('cloudflareinsights.com/beacon.min.js'), hasBeacon, 'the page carries the beacon exactly when the site config names one');
  assert.deepEqual(mainTextHits(textOf(mainOf(html)), hasBeacon), []);
  const { lookup, resultParts } = await freshIsland();
  const texts = [];
  await withFetch(listHandler, async () => {
    for (const [, text] of TABLE) for (const p of resultParts(await lookup(text))) if (!p.entry) texts.push(p.text);
  });
  assert.deepEqual(await wordHits(texts), [], 'the island\'s result texts');
});

// ── AC-12 ────────────────────────────────────────────────────────────────────────────────────────
function linkedHits({ targets, sitemap, list }) {
  const hits = [];
  if (!Object.prototype.hasOwnProperty.call(targets, 'skill-lookup/index.html')) hits.push('no skill-lookup/index.html target');
  if (!sitemap.includes('<loc>https://driftproofhq.com/skill-lookup/</loc>')) hits.push('the sitemap does not list /skill-lookup/');
  const main = mainOf(list) || '';
  const g6 = main.indexOf('<a href="/skill-lookup/">Look it up</a>');
  const lede = main.indexOf('class="skill-lede"');
  const filter = main.indexOf('data-island="skill-filter"');
  if (g6 < 0 || !textOf(main).includes(TX.G6)) hits.push('the list page carries no G-6');
  else if (!(lede >= 0 && lede < g6 && g6 < filter)) hits.push('G-6 is not between P-3 and the filters\' mount point');
  return hits;
}
test('AC-12: the page is built by the site builder, current, in the sitemap, and linked from the list', () => {
  const { TARGETS } = require('../scripts/build-site-pages.js');
  // The reader against the hand-made list, and its plants.
  const ok = { targets: { 'skill-lookup/index.html': () => '' }, sitemap: '<url><loc>https://driftproofhq.com/skill-lookup/</loc></url>', list: handList() };
  assert.deepEqual(linkedHits(ok), []);
  assert.notDeepEqual(linkedHits({ ...ok, targets: {} }), [], 'plant: the target removed');
  assert.notDeepEqual(linkedHits({ ...ok, sitemap: '' }), [], 'plant: the sitemap without the page');
  assert.notDeepEqual(linkedHits({ ...ok, list: ok.list.replace(/<p class="skill-lookup-link">[\s\S]*?<\/p>\n/, '') }), [], 'plant: the list without G-6');
  // The tree.
  assert.ok(fs.existsSync(LIST), 'docs/skills/index.html is not built yet (spec 267 not merged)');
  assert.deepEqual(linkedHits({ targets: TARGETS, sitemap: fs.readFileSync(SITEMAP, 'utf8'), list: fs.readFileSync(LIST, 'utf8') }), []);
  for (const script of ['build-site-pages.js', 'build-head-tags.js', 'build-sitemap.js']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    assert.equal(r.status, 0, `${script} --check: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
});

// ── AC-13 ────────────────────────────────────────────────────────────────────────────────────────
function siblingHits(list, readSpec) {
  const hits = [];
  if (!list.some((s) => s.spec === '267-skill-index')) hits.push('spec 267 is not listed');
  for (const s of list) {
    const text = readSpec(s.spec);
    if (!text) { hits.push(`${s.spec}: no spec.md`); continue; }
    const line = text.split('\n').find((l) => l.includes(s.amendment) && /\bissue 315\b/.test(l));
    if (!line) hits.push(`${s.spec}: no ${s.amendment} naming issue 315`);
  }
  return hits;
}
test('AC-13: sibling readings move only by their own amendments, each naming issue 315', () => {
  const readSpec = (s) => { const f = path.join(ROOT, 'specs', s, 'spec.md'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const planted = [{ spec: '267-skill-index', amendment: 'A-267-99' }];
  assert.notDeepEqual(siblingHits(planted, () => '## Amendments\n\nnone'), [], 'plant: a listed spec with no amendment');
  const file = path.join(SPEC, 'siblings.json');
  assert.ok(fs.existsSync(file), 'specs/315-skill-lookup/siblings.json is not written yet (the build writes it)');
  assert.deepEqual(siblingHits(JSON.parse(fs.readFileSync(file, 'utf8')).siblings, readSpec), []);
});
