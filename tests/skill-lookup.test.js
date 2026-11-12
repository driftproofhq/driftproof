// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 315 (issue 315): the skill lookup at /skill-lookup/. Each criterion has a reader here that
// shares no code with the island, docs/islands/skill-lookup.js: the list page is parsed again with
// this file's own patterns, spec 267's manifest is read on its own, and every result is rebuilt from
// spec 315's fixed texts. The readers may call the repository's existing definitions of a word or of
// the site (lib/plain.js LABELS, spec 031's LEXICON, scripts/build-head-tags.js beaconFor and
// siteConfig, scripts/build-site-pages.js TARGETS, the CLI's own --help), since the claim is that the
// page says what those say.
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
  P1: "Paste a GitHub skill link. Find its page in this visit's list, or try a guided first run.",
  P2: "It takes a github.com link to a repository, a skill's folder or its SKILL.md, or a raw.githubusercontent.com link to a SKILL.md.",
  F2: 'Want a skill measured? See how to ask. A public request needs a GitHub account.',
  F1: 'The lookup needs JavaScript. Without it, every skill the index lists is on the list page.',
  H2: 'What it reads and sends',
  C1: "Looking up a link sends it nowhere. Requests are optional. Opening a request sends only the repository link and skill path read from your link to GitHub. The lookup reads one file from this site, the list at /skills/. Your browser's own features, such as spell check, autofill and page translation, are outside what this page controls.",
  C2: 'No model is called, so the lookup spends no tokens.',
  C3: "A match shows the skill's entry from the list loaded for this visit, and nothing more. A link that list has no page for gets a line that says so. Reload this page to read the list again. Each result names the folder the link was read as: a branch name that holds / is read as its first part.",
  C4: "Like every page on this site, this one counts a visit with Cloudflare Web Analytics. The lookup does not write the link into the page's address, title, cookies or storage.",
  M1: (id) => `The list loaded for this visit has a page for ${JSON.stringify(id)} (read from your link):`,
  M2: 'Each row on that page links to its receipt and names the skill commit it measured, where the source recorded one. The link you pasted may point at another version of the skill.',
  N1: (id) => `The list loaded for this visit has no page for ${JSON.stringify(id)} (read from your link).`,
  N2: (owner, repo) => `That list has a page for the repository ${owner}/${repo} as a whole:`,
  N3: (owner, repo) => `That list names skills in ${owner}/${repo} by folder. Paste the link to one skill's folder.`,
  R1: 'This lookup keeps the list loaded for this visit. Reload this page to read the list again.',
  N4: (identity) => {
    const folder = identity.path;
    return [
      folder ? `Guided first run in Claude Code. Folder in the pasted link: ${JSON.stringify(folder)}. You need a local copy of a skill and Node.js 22 or later.`
        : 'Guided first run in Claude Code. You need a local copy of a skill and Node.js 22 or later.',
      'To add the Driftproof plugin, run these two commands in your terminal:',
      'claude plugin marketplace add driftproofhq/driftproof',
      'claude plugin install driftproof@driftproofhq',
      folder ? 'If that folder contains a skill, open Claude Code in the folder above your local copy, then type /driftproof:start. Pick the matching local folder by its full path. Its local name may differ from the link. If names repeat, check the repository and path before choosing.'
        : 'Open Claude Code in the folder that holds your local skills, then type /driftproof:start. Pick the local skill folder you want to test by its full path. If names repeat, check the repository and path before choosing.',
      'It helps you draft test tasks and, after you agree, runs one test task with and without the skill. You see the answers side by side on your machine. This first look cannot produce a verdict.',
      'By default, the run uses your Claude Code account. Your target model, grader and provider settings decide which account or API key is used and where the tasks and answers are sent. It calls a model, so it spends tokens.',
      'If a completed search finds no local skill, it opens a sample result instead. That sample calls no model and is not a measurement of your skill. If the search is incomplete, it stops without opening a sample. Move to the folder that holds your skills and try again.',
      'For the command line: npx driftproof run <skill-dir> --models <model-id>. Replace <skill-dir> with the local skill folder and <model-id> with the model to run. It calls a model, so it spends tokens. How to write its test tasks:',
    ];
  },
  N4_LINK: { href: '/authoring/', text: 'Writing a fair set of test tasks' },
  U1: (id) => `The skill index could not be read, so this lookup says nothing about ${JSON.stringify(id)} (read from your link).`,
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
// Independent HTML tokenizer and tree reader; the island has its own strict data parser.
const {dom,all}=require('../specs/408-skill-measurements/page-reader.cjs');
const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
const shape = (e) => ({ owner:e.owner,repo:e.repo,path:e.path,href:e.href,text:e.text,rows:e.rows });
const listDom=html=>{const d=dom(html);return {d,list:all(d,n=>n.tag==='ul'&&n.attrs.class==='skill-list')[0]};};
const entryNodes=html=>{const {list}=listDom(html);return list?.children.filter(n=>n.tag==='li'&&n.attrs.class==='skill-entry')||[];};
const words=(html,n)=>htmlToText(html.slice(n.start,n.end),{decode,collapse:true,tagText:' '});
function parseList(html){
 return entryNodes(html).map(n=>{
  const parts=n.children.filter(x=>x.tag),a=parts[0],page=n.attrs['data-page']||'', [owner,repo,name]=page.split('/');
  const rows=parts.slice(1).filter(x=>x.attrs.class==='skill-entry-row'||x.attrs.class==='skill-repository').map(x=>words(html,x));
  return {owner,repo,name,page,path:n.attrs['data-path'],href:a?.tag==='a'?a.attrs.href:null,text:a?.tag==='a'?words(html,a):null,rows,liText:words(html,n)};
 });
}
function wholeHits(html){
 const {d,list}=listDom(html);if(!list)return ['no skill list'];
 const nodes=entryNodes(html),es=parseList(html),hits=[];
 if(!nodes.length)hits.push('no entry');
 if(all(d,n=>n.attrs?.class==='skill-entry').length!==nodes.length)hits.push('entry outside the list');
 if(list.children.some(n=>n.tag&&n.attrs.class!=='skill-entry'||n.text?.trim()))hits.push('extra list content');
 const tags=new Set(['li','a','span','div','p','section','data','details','summary','ul','time']);
 const attrs=new Set(['class','href','value','datetime','data-page','data-source','data-evidence','data-freshness','data-path','data-task','data-driver','data-result','data-at','data-cost','data-src','data-fn','data-dp','data-receipt-link','data-receipt-path','data-manifest','data-build-date']);
 for(const [i,e]of es.entries()){
  if(e.path===undefined)hits.push(e.page+': no data-path');
  if(!/^[^/]+\/[^/]+\/[^/]+\/$/.test(e.page))hits.push(e.page+': bad identity');
  if(e.href!=='/skills/'+e.page)hits.push(e.page+': bad href');
  const parts=nodes[i].children.filter(n=>n.tag),rows=parts.slice(1).filter(n=>n.attrs.class==='skill-entry-row');
  if(!rows.length)hits.push(e.page+': no row');
  if(nodes[i].children.some(n=>n.text?.trim())||parts.slice(1).some(n=>!['skill-repository','skill-entry-row'].includes(n.attrs.class)))hits.push(e.page+': extra content');
  if(e.liText!==collapse([e.text,...e.rows].join(' ')))hits.push(e.page+': unread text');
  for(const n of all(nodes[i],n=>n.tag))if(!tags.has(n.tag)||Object.keys(n.attrs).some(k=>!attrs.has(k)))hits.push(e.page+': unexpected markup');
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
  if (want.kind === 'match') return [{ text: TX.M1(idText(readId)) }, ...want.entries.map((k) => entryPart(HAND_BY_KEY[k])), { text: TX.M2 }, { text: TX.R1 }];
  return [
    { text: TX.N1(idText(readId)) },
    ...(want.repository ? [{ text: TX.N2(readId.owner, readId.repo) }, entryPart(HAND_BY_KEY[want.repository])] : []),
    ...(want.byFolder ? [{ text: TX.N3(readId.owner, readId.repo) }] : []),
    { text: TX.R1 }, ...TX.N4(readId).map((text) => ({ text })), { ...TX.N4_LINK },
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
    const found = manifest.receipts.some((r) => r.identity.owner === e.owner && r.identity.repo === e.repo && r.identity.path === e.path && r.name === e.name);
    if (!found) hits.push(`${e.page}: data-path "${e.path}" is no identity's path in the manifest`);
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
  // A-315-2: measured campaign identities are a second published source.
  const campaign = JSON.parse(fs.readFileSync(path.join(ROOT,'receipts/skill-measurements/published/campaign.json'),'utf8'));
  for (const attempt of campaign.roster) {
    const p=attempt.protocol,[owner,repo]=p.repository.split('/');
    manifest.receipts.push({name:p.skill,identity:{owner,repo,path:p.skill_path.replace(/\/?SKILL\.md$/,''),unit:'skill'}});
  }
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
  const noId = (P) => (r) => P(r).map((p) => (p.text && p.text.startsWith('The list loaded for this visit has no page for ') ? { text: 'The skill index has no page for this link.' } : p));
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
const ELEMENTS = new Set(['form', 'label', 'input', 'button', 'div', 'p', 'span', 'a', 'section', 'h2', 'h3', 'ol', 'li', 'pre', 'code', 'details', 'summary', 'textarea']);
function sourceHits(src) {
  const code = stripComments(src).replaceAll("a.rel = 'noopener noreferrer';",'');
  const hits = FORBIDDEN.filter(([, re]) => re.test(code)).map(([name]) => name);
  const made = [...code.matchAll(/\bcreateElement(NS)?\s*\(/g)].length;
  const named = [...code.matchAll(/\bcreateElement\s*\(\s*(['"])([a-z]+|h[23])\1\s*\)/g)].map((m) => m[2]);
  if (made !== named.length) hits.push('an element made from a name that is not a literal');
  for (const t of named) if (!ELEMENTS.has(t)) hits.push(`createElement('${t}')`);
  // One fetch, its first argument /skills/ and its second exactly { cache: 'no-cache' }.
  const fetches = [...code.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
  if (fetches.length !== 1 || [...code.matchAll(/\bfetch\b/g)].length !== 1) hits.push('fetch count differs from one');
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
  assert.ok(fs.existsSync(ISLAND), 'docs/islands/skill-lookup.js is not built yet');
  const src = fs.readFileSync(ISLAND, 'utf8');
  assert.deepEqual(islandFormHits(src), []);
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
  const want = [TX.H1, TX.P1, TX.F1, TX.F2, TX.H2, TX.P2, TX.C1, TX.C2, TX.C3, ...(hasBeacon ? [TX.C4] : [])].join(' ');
  return mainText === want ? [] : [`<main> reads ${JSON.stringify(mainText.slice(0, 120))}...`];
}
function commandHits(n4, help) {
  const m = /npx driftproof run <skill-dir> (--[a-z-]+) <model-id>\./.exec(n4);
  // A-315-6 (issue 553): the run line reads `run <skill-dir | rules-file>`; it is still the line read.
  const runLine = help.split('\n').find((l) => /^\s*driftproof run <skill-dir[ >]/.test(l)) || '';
  return m && runLine.includes(`[${m[1]} `) ? [] : [`N-4's command is not the CLI's: ${n4.slice(0, 80)}`];
}
test('AC-11: the page\'s words are its fixed texts, and each is true of the page', async () => {
  const { beaconFor, siteConfig } = require('../scripts/build-head-tags.js');
  const hasBeacon = !!beaconFor(siteConfig().cloudflare_analytics_token);
  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'driftproof'), '--help'], { encoding: 'utf8' }).stdout;
  assert.deepEqual(commandHits(TX.N4(id('o', 'r', 'skills/alpha')).join(' '), help), [], 'the spec\'s own N-4 against the CLI');
  assert.notDeepEqual(commandHits(TX.N4(id('o', 'r', 'skills/alpha')).join(' ').replace('--models', '--model'), help), [], 'plant: N-4 reading --model');
  assert.notDeepEqual(mainTextHits([TX.H1, TX.P1, TX.F1, TX.F2, TX.H2, TX.P2, TX.C1, TX.C2, TX.C3, TX.C4].join(' '), false), [], 'plant: C-4 on a page with no beacon');
  const fixed = [TX.R1, TX.T1, TX.H1, TX.P1, TX.P2, TX.F1, TX.F2, TX.H2, TX.C1, TX.C2, TX.C3, TX.C4, TX.M1('o/r/p'), TX.M2, TX.N1('o/r/p'), TX.N2('o', 'r'), TX.N3('o', 'r'), ...TX.N4(id('o', 'r', 'skills/alpha')), TX.N4_LINK.text, TX.U1('o/r/p'), TX.X1, TX.G6];
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

test('issue 414: nested scoreboard entries are read whole and unsafe or truncated rows refuse', async () => {
 const {readList}=await freshIsland();
 const rich=handList([HAND[0]]).replace('<a href=', '<a class="skill-name" href=').replace('</a> ', '</a> <span class="skill-repository">owner-a/repo-a</span> ').replace(/<span class="skill-entry-row">[\s\S]*<\/span><\/li>/, '<div class="skill-entry-row"><p>Measured result.</p><details><summary>Why?</summary><ul><li>First task.</li><li>Last task.</li></ul></details></div></li>');
 const got=readList(rich);assert.equal(got.ok,true);assert.equal(got.entries.length,1);
 assert.deepEqual(got.entries[0].rows,['owner-a/repo-a','Measured result. Why? First task. Last task.']);
 for(const plant of [rich.replace('</details>',''),rich.replace('Last task.','<script></script>Last task.'),rich.replace('<p>Measured','<p onclick="bad()">Measured'),rich.replace('</div></li>','</div> extra</li>')])assert.equal(readList(plant).ok,false);
});

// A-315-3 (issue 423): the guide is fixed public wording. The independent expectation above
// remains separate from the island. Run plants before the live comparison so the red round
// proves the readers reject every missing promise, wrong command and invented identity.
function guideHits(parts, identity) {
  const want = [...TX.N4(identity).map((text) => ({ text })), { ...TX.N4_LINK }];
  return JSON.stringify(parts.map(partShape)) === JSON.stringify(want) ? [] : ['N-4 differs from the complete guided route'];
}
const guideParts = (identity) => [...TX.N4(identity).map((text) => ({ text })), { ...TX.N4_LINK }];
const changeText = (parts, from, to) => parts.map((p) => ({ ...p, text: p.text.replace(from, to) }));

test('AC-423-1, AC-423-2 and AC-423-4: the named guided route precedes the CLI and states its scope and cost', async () => {
  const identity = { owner: 'owner-z', repo: 'repo-z', path: 'skills/Alpha' };
  const good = guideParts(identity);
  assert.deepEqual(guideHits(good, identity), []);
  const plants = {
    'the guide omitted': good.slice(-2),
    'the marketplace command omitted': good.filter((_, i) => i !== 2),
    'the install command omitted': good.filter((_, i) => i !== 3),
    'the CLI first': [good[8], ...good.slice(0, 8), good[9]],
    'two tasks promised': changeText(good, 'runs one test task', 'runs two test tasks'),
    'a verdict promised': changeText(good, 'cannot produce a verdict', 'produces a verdict'),
    'a sample promised on every run': changeText(good, 'If a completed search finds no local skill, it opens', 'It first opens'),
    'an API key required': changeText(good, 'By default, the run uses your Claude Code account. Your target model, grader and provider settings decide which account or API key is used and where the tasks and answers are sent.', 'The run requires your own API key.'),
    'token cost omitted': changeText(good, 'It calls a model, so it spends tokens.', ''),
    'with and without omitted': changeText(good, 'with and without the skill', 'with the skill'),
    'skill lowercased': changeText(good, 'Alpha', 'alpha'),
    'ref included in skill name': changeText(good, 'Alpha', 'main/Alpha'),
  };
  for (const [why, parts] of Object.entries(plants)) {
    assert.notDeepEqual(parts, good, why + ': the plant changes the subject');
    assert.notDeepEqual(guideHits(parts, identity), [], 'plant: ' + why);
  }
  const repository = { ...identity, path: '' };
  assert.deepEqual(guideHits(guideParts(repository), repository), []);
  const guessed = changeText(guideParts(repository), 'Guided first run in Claude Code.', 'Guided first run in Claude Code for repo-z.');
  assert.notDeepEqual(guideHits(guessed, repository), [], 'plant: repository guessed as a skill');
  const { resultParts } = await freshIsland();
  // Explicit names include markup, whitespace and mixed case; all remain text parts.
  for (const x of [identity, repository, { ...identity, path: 'v2/skills/alpha' }, { ...identity, path: 'skills/<img src=x>' }, { ...identity, path: 'skills/long skill name' }]) {
    const parts = resultParts({ kind: 'none', identity: x, entries: [], repository: [], byFolder: false });
    assert.deepEqual(guideHits(parts.slice(2), x), [], 'the complete guide for ' + idText(x));
  }
});

test('AC-423-1: matches, refusals and unreadable lists gain no guided-run claims', async () => {
  const { resultParts } = await freshIsland();
  for (const kind of ['match', 'refused', 'unreadable']) {
    const readId = { owner: 'owner-a', repo: 'repo-a', path: 'skills/alpha' };
    const result = { kind, identity: kind === 'refused' ? null : readId, entries: kind === 'match' ? [HAND_BY_KEY.A] : [], repository: [], byFolder: false };
    const expected = expectedParts('', readId, { kind, entries: ['A'] });
    const hits = (ps) => JSON.stringify(ps.map(partShape)) === JSON.stringify(expected) ? [] : ['non-none result changed'];
    assert.notDeepEqual(hits([...expected, ...guideParts(readId)]), [], 'plant: guide added to ' + kind);
    assert.deepEqual(hits(resultParts(result)), [], kind);
  }
});

function guidedCommandHits(paragraphs, artefacts) {
  const { marketplace, plugin, start, help } = artefacts;
  const repo = new URL(plugin.repository).pathname.replace(/^\//, '');
  const hits = [];
  const expected = [
    'claude plugin marketplace add ' + repo,
    'claude plugin install ' + plugin.name + '@' + marketplace.name,
  ];
  expected.forEach((command, i) => { if (paragraphs[i + 2] !== command) hits.push('plugin command ' + (i + 1)); });
  if (!marketplace.plugins.some((p) => p.name === plugin.name && p.source === './plugin/' + plugin.name)) hits.push('marketplace does not ship this plugin');
  const slash = /^# (\/[^\s]+)$/m.exec(start)?.[1];
  if (!slash || typeof paragraphs[4] !== 'string' || !paragraphs[4].includes('type ' + slash + '.')) hits.push('slash command');
  return [...hits, ...commandHits(paragraphs.join(' '), help)];
}
test('AC-423-3: both plugin commands and the slash command agree with the shipped artefacts', async () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const artefacts = {
    marketplace: JSON.parse(read('.claude-plugin/marketplace.json')),
    plugin: JSON.parse(read('plugin/driftproof/.claude-plugin/plugin.json')),
    start: read('plugin/driftproof/commands/start.md'),
    help: spawnSync(process.execPath, [path.join(ROOT, 'bin/driftproof'), '--help'], { encoding: 'utf8' }).stdout,
  };
  const identity = { owner: 'o', repo: 'r', path: 'skills/alpha' };
  const paragraphs = TX.N4(identity);
  assert.deepEqual(guidedCommandHits(paragraphs, artefacts), []);
  for (const [from, to] of [
    ['driftproofhq/driftproof', 'other/driftproof'], ['driftproof@driftproofhq', 'other@driftproofhq'],
    ['driftproof@driftproofhq', 'driftproof@other'], ['/driftproof:start', '/driftproof:begin'], ['--models', '--model'],
  ]) {
    const planted = paragraphs.map((p) => p.replace(from, to));
    assert.notDeepEqual(planted, paragraphs, 'command plant changes the subject');
    assert.notDeepEqual(guidedCommandHits(planted, artefacts), [], 'plant: ' + to);
  }
  const { resultParts } = await freshIsland();
  const live = resultParts({ kind: 'none', identity, entries: [], repository: [], byFolder: false }).slice(2, -1).map((p) => p.text);
  assert.deepEqual(guidedCommandHits(live, artefacts), [], 'the commands shown by the island');
});

test('AC-423-4 and AC-423-5: the scope has an artefact basis and new prose obeys the wording rules', async () => {
  const { QUICK } = require('../lib/firstrun');
  const start = fs.readFileSync(path.join(ROOT, 'plugin/driftproof/commands/start.md'), 'utf8');
  const steps = JSON.parse(/```driftproof-steps\s*([\s\S]*?)```/.exec(start)[1]);
  assert.equal(QUICK.maxCases, 1, 'the guided first look runs one test task');
  assert.ok(steps.some((s) => s.op === 'cli' && s.unless === 'full' && s.args.includes('--quick')));
  assert.ok(steps.some((s) => s.op === 'confirm-write'), 'the guided path waits for agreement');
  const access = fs.readFileSync(path.join(ROOT, 'plugin/driftproof/README.md'), 'utf8');
  assert.ok(access.includes('your own Claude Code account'));
  assert.ok(access.includes('CLAUDE_PROVIDER') && access.includes('ANTHROPIC_API_KEY'));
  const paragraphs = TX.N4({ owner: 'o', repo: 'r', path: 'skills/alpha' });
  assert.deepEqual(await wordHits(paragraphs), []);
  assert.notDeepEqual(await wordHits([paragraphs[5] + ' At 95% confidence.']), [], 'plant: confidence added to N-4');
});

// Issue 423 claim review: execute the shipped door and runner with all process boundaries
// intercepted. No package manager or model is called.
const FIXTURES423 = [];
test.after(() => { for (const d of FIXTURES423) fs.rmSync(d, { recursive: true, force: true }); });
function startFixture423() {
  const root = fs.mkdtempSync('/var/tmp/spec423-start-'); FIXTURES423.push(root);
  const plugin = path.join(root, 'plugin');
  for (const dir of ['lib', '.claude-plugin', 'commands', 'config']) fs.mkdirSync(path.join(plugin, dir), { recursive: true });
  for (const f of ['input-contract.json', 'draft-contract.json', 'version-guard.json', '.claude-plugin/plugin.json', 'config/models.json', 'lib/door.mjs', 'commands/start.md']) fs.copyFileSync(path.join(ROOT, 'plugin/driftproof', f), path.join(plugin, f));
  fs.symlinkSync(path.join(ROOT, 'plugin/driftproof/sample'), path.join(plugin, 'sample'));
  const work = path.join(root, 'work'); fs.mkdirSync(work);
  const log = path.join(root, 'events.jsonl'), hook = path.join(root, 'intercept.cjs');
  fs.writeFileSync(hook, `
    const fs = require('node:fs'), cp = require('node:child_process'), path = require('node:path');
    const realSpawn = cp.spawnSync;
    const record = x => fs.appendFileSync(process.env.SPEC423_EVENTS, JSON.stringify(x)+'\\n');
    const ok = (stdout='') => ({status:0,stdout,stderr:'',signal:null});
    cp.spawnSync = (cmd, args=[], opts={}) => {
      record({cmd,args});
      if(cmd==='git') return ok(args.includes('--show-toplevel') ? process.env.SPEC423_WORK+'\\n' : '0'.repeat(40)+'\\n');
      if(cmd==='npx') return realSpawn(process.execPath,['--require',__filename,path.join(process.env.SPEC423_ROOT,'bin/driftproof'),...args.slice(1)],{...opts,env:{...opts.env,DRIFTPROOF_STUB:'1',SPEC423_RUNNER:'1'},encoding:'utf8',timeout:1800000});
      if(['open','xdg-open','cmd'].includes(cmd)) return ok();
      if(['claude','codex'].includes(cmd) && args.includes('--version')) return ok('fixture harness\\n');
      throw Error('unexpected process: '+cmd);
    };
    if(process.env.SPEC423_UNREADABLE) {
      const read=fs.readdirSync;
      fs.readdirSync=(p,...args)=>{if(String(p)===process.env.SPEC423_UNREADABLE){const e=new Error('fixture unreadable');e.code='EACCES';throw e;}return read(p,...args);};
    }
    require('node:module').syncBuiltinESMExports();
    if(process.env.SPEC423_RUNNER) {
      const provider=require(path.join(process.env.SPEC423_ROOT,'lib/provider'));
      const surface=provider.surfaceForModel;
      provider.surfaceForModel=(model)=>{const result=surface(model);record({surface:result,model});return result;};
      if(process.env.SPEC423_TWO_TASKS) {
        const f=require.resolve(path.join(process.env.SPEC423_ROOT,'lib/firstrun'));
        const value=require(f);require.cache[f].exports={...value,QUICK:{...value.QUICK,maxCases:2}};
      }
    }
  `);
  return { root, plugin, work, log, hook };
}
function runStart423(fx, args = [], extra = {}) {
  const env = {};
  for (const [k,v] of Object.entries(process.env)) if (!/API_KEY|TOKEN|SECRET|^CLAUDE_|^OPENAI_|^ANTHROPIC_|^DRIFTPROOF_|^SPEC|^NODE_OPTIONS$|^GIT_/.test(k)) env[k]=v;
  Object.assign(env, { TMPDIR:'/var/tmp', SPEC423_EVENTS:fx.log, SPEC423_WORK:fx.work, SPEC423_ROOT:ROOT, ...extra });
  fs.writeFileSync(fx.log, '');
  const run = spawnSync(process.execPath, ['--require', fx.hook, path.join(fx.plugin,'lib/door.mjs'), 'start', ...args], { cwd:fx.work, env, encoding:'utf8', timeout:1800000 });
  const events=fs.readFileSync(fx.log,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
  const dir=path.join(fx.work,'receipts');
  const receipts=fs.existsSync(dir) ? fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&!f.endsWith('.summary.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))) : [];
  return { ...run, events, receipts, page:fs.existsSync(path.join(fx.work,'driftproof-view.html')) ? fs.readFileSync(path.join(fx.work,'driftproof-view.html'),'utf8') : '' };
}
function putSkill423(fx, name, { suite = false } = {}) {
  const dir=path.join(fx.work,name);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'SKILL.md'),'---\nname: fixture\nversion: 1.0.0\n---\n\nBe brief.\n');
  const draft=path.join(fx.root,'draft.json');
  fs.writeFileSync(draft, JSON.stringify({cases:[{id:'first',prompt:'Say hello.',rubric:'Says hello.'},{id:'second',prompt:'Say goodbye.',rubric:'Says goodbye.'}]}));
  if(suite){fs.mkdirSync(path.join(dir,'evals'));fs.copyFileSync(draft,path.join(dir,'evals/evals.json'));}
  return {dir,draft};
}
const runnerCalls423 = r => r.events.filter(e=>e.cmd==='npx').map(e=>e.args.slice(1));
const opens423 = r => r.events.filter(e=>['open','xdg-open','cmd'].includes(e.cmd));
function sampleHits423(r, shouldOpen) {
  const hits=[];
  if(r.status!==0) hits.push('search failed unexpectedly');
  if(runnerCalls423(r).length || r.receipts.length || r.page) hits.push('search ran or wrote');
  if(opens423(r).length !== (shouldOpen?1:0)) hits.push('wrong sample open count');
  if(shouldOpen && !/sample results page/.test(r.stdout)) hits.push('sample not disclosed');
  if(!shouldOpen && !/walk did not read every folder/.test(r.stdout)) hits.push('incomplete search not disclosed');
  return hits;
}
test('AC-423-4: only a completed empty search opens the sample; incomplete searches disclose and stop', () => {
  assert.deepEqual(sampleHits423(runStart423(startFixture423()),true),[]);
  const deep=startFixture423();fs.mkdirSync(path.join(deep.work,'a/b/c/d/e'),{recursive:true});
  assert.deepEqual(sampleHits423(runStart423(deep),false),[]);
  const unreadable=startFixture423(), blocked=path.join(unreadable.work,'blocked');fs.mkdirSync(blocked);
  assert.deepEqual(sampleHits423(runStart423(unreadable,[],{SPEC423_UNREADABLE:blocked}),false),[]);
});
function firstRunHits423(r) {
  const hits=[];
  if(r.status!==0) hits.push('guided run failed: '+r.stderr.slice(-500));
  if(JSON.stringify(runnerCalls423(r).map(a=>a[0]))!==JSON.stringify(['--version','init','run','view'])) hits.push('ordered steps not reached');
  if(r.receipts.length!==1) return [...hits,'not exactly one receipt'];
  const receipt=r.receipts[0];
  if(receipt.run.preset!=='quick') hits.push('not the quick preset');
  if(receipt.verification_level!=='UNVERIFIED') hits.push('smoke level changed');
  const rows=receipt.results.cases;
  if(new Set(rows.map(c=>c.id)).size!==1 || rows.some(c=>c.id!=='first')) hits.push('not exactly the first task');
  if(JSON.stringify([...new Set(rows.map(c=>c.mode))].sort())!==JSON.stringify(['baseline','with_skill'])) hits.push('not both arms');
  if(require('../lib/verdict').receiptVerdict(receipt).verdict!=='NOT_MEASURED') hits.push('a verdict admitted');
  if(!r.page.includes('Smoke run, no verdict') || !r.page.includes('With the skill') || !r.page.includes('Without the skill')) hits.push('local comparison or no-verdict disclosure missing');
  if(opens423(r).length!==1) hits.push('comparison not opened');
  return hits;
}
test('AC-423-4: approved draft reaches init, one-task quick comparison and local open; behavioural plants fail', () => {
  const run=(extra={})=>{const fx=startFixture423(), sk=putSkill423(fx,'local-skill');return runStart423(fx,['local-skill','--cases',sk.draft,'--confirm-write'],extra);};
  const baseline=run();assert.deepEqual(firstRunHits423(baseline),[]);
  assert.ok(firstRunHits423(run({SPEC423_TWO_TASKS:'1'})).includes('not exactly the first task'),'plant: two-task preset');
  const verdictFx=startFixture423();const skill=putSkill423(verdictFx,'local-skill');
  fs.appendFileSync(verdictFx.hook, `\nif(process.env.SPEC423_RUNNER){const f=require.resolve(require('node:path').join(process.env.SPEC423_ROOT,'lib/plain'));const v=require(f);require.cache[f].exports={...v,plainOf:r=>({...v.plainOf(r),state:'PASSED',label:'Clearly helped',sentence:'Clearly helped.'})};}\n`);
  const verdict=runStart423(verdictFx,['local-skill','--cases',skill.draft,'--confirm-write']);
  assert.equal(verdict.status,0,verdict.stderr.slice(-800));
  assert.ok(verdict.page.includes('Clearly helped'),'the planted renderer actually emitted a verdict');
  assert.ok(firstRunHits423(verdict).includes('local comparison or no-verdict disclosure missing'),'plant: renderer admits a verdict');
});
test('AC-423-4: no draft write or runner step precedes agreement; late confirmation is rejected', () => {
  function subject() {
    const fx=startFixture423();const sk=putSkill423(fx,'local-skill');
    const r=runStart423(fx,['local-skill','--cases',sk.draft]);
    return {r,wrote:fs.existsSync(path.join(sk.dir,'evals/evals.json'))};
  }
  const hits=({r,wrote})=>r.status===2 && /--confirm-write/.test(r.stderr) && runnerCalls423(r).length===0 && !wrote && !r.page && !r.receipts.length ? [] : ['work before agreement'];
  assert.deepEqual(hits(subject()),[]);
});

// These are observations of local paths, never an attempt to resolve a GitHub folder to a
// local name. The guide must leave that correspondence with the person using the listing.
test('AC-423-2: non-skill, renamed and duplicate-name folders keep selection conditional', async () => {
  const fx=startFixture423();
  putSkill423(fx,'first-repository/skills/alpha');
  putSkill423(fx,'second-repository/skills/alpha');
  putSkill423(fx,'renamed-local-copy');
  fs.mkdirSync(path.join(fx.work,'references'));
  const listing=runStart423(fx);
  assert.equal(listing.status,0,listing.stderr);
  const rows=listing.stdout.split('\n').filter(l=>/^  .*  \(no test cases yet\)$/.test(l));
  assert.deepEqual(rows.map(l=>l.trim().split('  ')[0]).sort(),['first-repository/skills/alpha','renamed-local-copy','second-repository/skills/alpha']);
  assert.equal(rows.some(l=>/^  references /.test(l)),false,'a non-skill folder is not selectable');
  const { resultParts }=await freshIsland();
  for(const folder of ['skills/alpha/references','skills/alpha']) {
    const identity={owner:'owner-z',repo:'repo-z',path:folder};
    const good=guideParts(identity);
    for(const choose of ['Choose references.','Choose alpha.','Choose renamed-local-copy.','Choose first-repository/skills/alpha.']) {
      const bad=good.map((p,i)=>i===4?{text:choose}:p);
      assert.notDeepEqual(guideHits(bad,identity),[],'plant: guessed selection '+choose);
    }
    assert.deepEqual(guideHits(resultParts({kind:'none',identity,entries:[]}).slice(2),identity),[]);
  }
});

async function publicationHits423(L, P) {
  const identity={owner:'owner-z',repo:'repo-z',path:'skills/new-skill'};
  const link='https://github.com/owner-z/repo-z/tree/main/skills/new-skill';
  let published=false;
  return withFetch(()=>respond(published?handList([...HAND,{page:'owner-z/repo-z/new-skill',path:identity.path,rows:['A new published entry.']}]):handList()),async(calls)=>{
    const first=await L(link);published=true;
    const again=await L(link), ps=P(again).map(partShape);
    const want=expectedParts(link,identity,{kind:'none'});
    const hits=[];
    if(first.kind!=='none'||again.kind!=='none'||calls.length!==1)hits.push('the visit did not keep its first list');
    if(JSON.stringify(ps)!==JSON.stringify(want))hits.push('cached absence not scoped or no reload instruction');
    const fresh=await freshIsland();
    const afterReload=await fresh.lookup(link);
    if(afterReload.kind!=='match'||calls.length!==2)hits.push('fresh visit did not read publication');
    return hits;
  });
}
test('AC-423-6: a publication between lookups keeps a scoped cached absence until reload', async () => {
  for(const plant of ['index-now','no-reload']) {
    const island=await freshIsland();
    const P=r=>island.resultParts(r).filter(p=>plant!=='no-reload'||p.text!==TX.R1).map(p=>plant==='index-now'&&p.text?.startsWith('The list loaded for this visit has no page')?{text:'The skill index has no page for this link.'}:p);
    assert.notDeepEqual(await publicationHits423(island.lookup,P),[],'plant: '+plant);
  }
  const {lookup,resultParts}=await freshIsland();
  assert.deepEqual(await publicationHits423(lookup,resultParts),[]);
});

function authoredParts423(parts, result) {
  const quoted=JSON.stringify(idText(result.identity));
  return parts.filter(p=>!p.entry).map((p,i)=>{
    if(i===0 && ['none','match','unreadable'].includes(result.kind)) {
      const fixed=result.kind==='none'?TX.N1(idText(result.identity)):result.kind==='match'?TX.M1(idText(result.identity)):TX.U1(idText(result.identity));
      // Extra words are left in the scan. Only an exact attributed slot is exempt.
      if(p.text===fixed)return p.text.replace(quoted,'[pasted identity]');
    }
    if(result.kind==='none' && result.identity.path && p.text===TX.N4(result.identity)[0])return p.text.replace(JSON.stringify(result.identity.path),'[pasted folder]');
    return p.text;
  });
}
test('AC-423-2 and AC-423-5: hostile names are delimited attributed input; adjacent claims are still rejected', async()=>{
  const {readLink,resultParts}=await freshIsland();
  for(const name of ['Clearly helped.','95% confidence','significantly','a "quoted" folder','<img src=x>']) {
    const r=readLink('https://github.com/owner-z/repo-z/tree/main/skills/'+encodeURIComponent(name));
    assert.equal(r.ok,true);
    const result={kind:'none',identity:r,entries:[]}, parts=resultParts(result);
    const good=[{text:TX.N1(idText(r))},{text:TX.R1},...guideParts(r)];
    assert.deepEqual(await wordHits(authoredParts423(good,result)),[]);
    const unquoted=good.map((p,i)=>i===2?{text:p.text.replace(JSON.stringify(r.path),r.path)}:p);
    assert.notDeepEqual(guideHits(unquoted.slice(2),r),[],'plant: folder delimiters lost');
    const editorial=good.map((p,i)=>i===2?{text:p.text+' At 95% confidence.'}:p);
    assert.notDeepEqual(await wordHits(authoredParts423(editorial,result)),[],'plant: adjacent editorial claim');
    assert.deepEqual(parts.map(partShape),good,'verbatim, attributed hostile folder '+name);
    assert.deepEqual(await wordHits(authoredParts423(parts,result)),[]);
  }
});

test('AC-423-4a: configured target and grader choose their own surfaces, including Codex and API destinations', () => {
  const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'plugin/driftproof/config/models.json'),'utf8'));
  const priced=registry.models.filter(m=>m.provider==='anthropic').sort((a,b)=>(a.input_price+a.output_price)-(b.input_price+b.output_price)||a.id.localeCompare(b.id));
  const target=priced[0].id, grader=registry.models.find(m=>m.provider==='openai').id;
  const fx=startFixture423();putSkill423(fx,'local-skill',{suite:true});
  fs.writeFileSync(path.join(fx.work,'.driftproofrc'),JSON.stringify({judge_model:grader}));
  const r=runStart423(fx,['local-skill'],{OPENAI_SURFACE:'cli'});
  assert.equal(r.status,0,r.stderr.slice(-800));
  assert.equal(r.receipts[0].run.model_id,target);
  assert.equal(r.receipts[0].run.judge.model_id,grader,'the runner read the configured grader');
  const surfaces=r.events.filter(e=>e.surface);
  const hits=events=>events.some(e=>e.model===target&&e.surface==='claude-cli')&&events.some(e=>e.model===grader&&e.surface==='openai-cli')?[]:['configured target or grader route missing'];
  assert.deepEqual(hits(surfaces),[]);
  fs.writeFileSync(path.join(fx.work,'.driftproofrc'),'{}');
  const ignored=runStart423(fx,['local-skill'],{OPENAI_SURFACE:'cli'});
  assert.equal(ignored.status,0,ignored.stderr.slice(-800));
  assert.notDeepEqual(hits(ignored.events.filter(e=>e.surface)),[],'plant: configured grader ignored');
  fs.writeFileSync(path.join(fx.work,'.driftproofrc'),JSON.stringify({judge_model:grader}));
  const api=runStart423(fx,['local-skill'],{OPENAI_SURFACE:'api',CLAUDE_PROVIDER:'api',OPENAI_BASE_URL:'https://configured.invalid/v1',ANTHROPIC_BASE_URL:'https://configured.invalid'});
  assert.equal(api.status,0,api.stderr.slice(-800));
  assert.ok(api.events.some(e=>e.model===target&&e.surface==='api'));
  assert.ok(api.events.some(e=>e.model===grader&&e.surface==='openai-api'));
  const prose=TX.N4({path:'skills/alpha'})[6];
  const routeProseHits=s=>s===TX.N4({path:''})[6]?[]:['model routing disclosure changed'];
  assert.deepEqual(routeProseHits(prose),[]);
  assert.notDeepEqual(routeProseHits('The run always uses your Claude Code account.'),[]);
  // Read the complete published disclosure as the basis, not isolated account/key words.
  const readme=fs.readFileSync(path.join(ROOT,'plugin/driftproof/README.md'),'utf8');
  const section=readme.split('## What it sends, and where\n')[1];
  assert.ok(section && section.split('\n').some(l=>l.startsWith('- Some settings change this.') && /OpenAI model.*codex.*OPENAI_SURFACE.*CLAUDE_PROVIDER.*judge_model/.test(l)));
  assert.deepEqual(registry.providers.openai.surfaces,['api','cli']);
});

// A-315-4, issue 423 design: the explanations remain real native content, with the same fallback.
function staticDesignHits423(html) {
  const {dom,all}=require('../specs/408-skill-measurements/page-reader.cjs');
  const tree=dom(html),fold=all(tree,n=>n.tag==='details'&&n.attrs.class==='lookup-privacy')[0];
  const hits=[];
  if(!fold || fold.attrs.open!==undefined)hits.push('privacy is not a closed native disclosure');
  if(fold && !html.slice(fold.start,fold.end).includes(TX.C1))hits.push('privacy disclosure lost C-1');
  if(!html.includes('<main class="skill-lookup-page">'))hits.push('lookup still takes the prose layout');
  if(!html.includes('data-island="skill-lookup"'))hits.push('loader mount absent');
  return hits;
}
test('AC-423-D1: a full workspace and native privacy fold keep every static disclosure and fallback',()=>{
  const good='<main class="skill-lookup-page"><div data-island="skill-lookup"></div><details class="lookup-privacy"><summary>What it reads and sends</summary><p>'+TX.C1+'</p></details></main>';
  assert.deepEqual(staticDesignHits423(good),[]);
  assert.notDeepEqual(staticDesignHits423(good.replace('<details','<div').replace('</details>','</div>')),[],'plant: no native privacy disclosure');
  assert.notDeepEqual(staticDesignHits423(good.replace('class="skill-lookup-page"','class="prose skill-lookup-page"')),[],'plant: old prose layout');
  assert.notDeepEqual(staticDesignHits423(good.replace(TX.C1,'')),[],'plant: dropped privacy claim');
  assert.deepEqual(staticDesignHits423(fs.readFileSync(PAGE,'utf8')),[]);
});

// A-315-4: status comes from the list's evidence attribute, never from a skill's name or prose.
test('A-315-4: the list evidence attribute survives reading, with a dropped-evidence plant',async()=>{
  const {readList}=await freshIsland();
  const html=handList();
  const published=fs.readFileSync(LIST,'utf8');
  assert.deepEqual(readList(published).entries.map(e=>e.evidence),entryNodes(published).map(n=>n.attrs['data-evidence']));
  const read=f=>f(html).entries.map(e=>e.evidence);
  assert.deepEqual(read(readList),['measured','measured','measured']);
  assert.notDeepEqual(read(h=>({...readList(h),entries:readList(h).entries.map(e=>({...e,evidence:undefined}))})),['measured','measured','measured'],'plant: evidence dropped');
  const changed=html.replaceAll('data-evidence="measured"','data-evidence="recomputed"');
  assert.deepEqual(readList(changed).entries.map(e=>e.evidence),['recomputed','recomputed','recomputed']);
});

test('A-315-4: headings remain in the exact literal element set, with rejected literal and dynamic plants',()=>{
  const request="fetch('/skills/', { cache: 'no-cache' });";
  assert.deepEqual(sourceHits(request+"document.createElement('h2');document.createElement('h3');"),[]);
  assert.notDeepEqual(sourceHits(request+"document.createElement('h4');"),[],'plant: unapproved literal');
  assert.notDeepEqual(sourceHits(request+"document.createElement('h' + '2');"),[],'plant: computed element');
});


// A-315-9, issue 787: the request opens the free offer's Measure a skill form. None of these helpers is
// product code. The form's fields are read from its YAML by this file's own pattern, and whether a value
// names the identity is asked of the offer's intake, scripts/offer.js parseIssue, never of the island.
const R787 = {
  repo: 'https://github.com/driftproofhq/driftproof/issues/new',
  dir: path.join(ROOT, '.github', 'ISSUE_TEMPLATE'),
  old: 'skill-request.md',
  oldTerms: ['No promise of testing or timing.', 'The operator chooses whether and when to run a public batch.', 'Driftproof reviews and may edit maintainer tasks.'],
  reviewer: 'Your skill clearly helped, at 95% confidence. Testing is guaranteed tomorrow.',
};
const OFFER787 = () => require('../scripts/offer.js');
const FORM787 = () => OFFER787().KINDS.skill.template;
// [{ type, id, label }] in the form's order; a markdown block has no id and is not a field.
function formFields787(yml) {
  const out = [];
  for (const block of yml.split(/^ {2}- type: /m).slice(1)) {
    const type = block.split('\n')[0].trim();
    const id = /^ {4}id: (\S+)\s*$/m.exec(block)?.[1];
    const label = /^ {6}label: (.+?)\s*$/m.exec(block)?.[1];
    if (id) out.push({ type, id, label });
  }
  return out;
}
const FIELDS787 = () => formFields787(fs.readFileSync(path.join(R787.dir, FORM787()), 'utf8'));
// An issue as GitHub renders an issue form: a ### heading per field, its value under it, the author answer.
function issueOf787(fields, values) {
  const body = fields.map((f) => `### ${f.label}\n\n${f.type === 'dropdown' ? 'Yes' : (values[f.id] || '_No response_')}`).join('\n\n');
  return { number: 1, state: 'OPEN', labels: ['offer', 'offer-skill'], body };
}
// AC-787-3 and AC-787-4: what the form may be filled with, decided by the intake reading each value back.
function intakeFill787(x, fields = FIELDS787()) {
  const { parseIssue } = OFFER787();
  const repository = `https://github.com/${x.owner}/${x.repo}`;
  const repoOk = parseIssue(issueOf787(fields, { repository, skill: 'skills/probe' })).repository === `${x.owner}/${x.repo}`;
  const skillOk = !!x.path && JSON.stringify(parseIssue(issueOf787(fields, { repository: 'https://github.com/probe/probe', skill: x.path })).skills) === JSON.stringify([`${x.path}/SKILL.md`]);
  return { ...(repoOk ? { repository } : {}), ...(skillOk ? { skill: x.path } : {}) };
}
function url787(fill) {
  const u = new URL(R787.repo);
  u.search = new URLSearchParams({ template: 'measure-skill.yml', ...fill }).toString();
  return u.href;
}
const boundHits787 = (value) => (Buffer.byteLength(String(value)) <= 8192 ? [] : ['over 8,192 bytes']);
function draftHits787(value, x, fields = FIELDS787()) {
  let u; try { u = new URL(value); } catch { return ['no request URL']; }
  const hits = [...boundHits787(value)];
  if (u.origin + u.pathname !== R787.repo || u.hash || u.username || u.password) hits.push('wrong public destination');
  const keys = [...u.searchParams.keys()];
  if (keys.filter((k) => k === 'template').length !== 1 || u.searchParams.get('template') !== FORM787()) hits.push('not the offer\'s Measure a skill form');
  if (new Set(keys).size !== keys.length) hits.push('a parameter given twice');
  const ids = new Set(fields.filter((f) => f.type === 'input').map((f) => f.id));
  for (const k of keys) if (k !== 'template' && !ids.has(k)) hits.push(`a parameter the form has no field for: ${k}`);
  const got = [...u.searchParams].filter(([k]) => k !== 'template').sort();
  const want = Object.entries(intakeFill787(x, fields)).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) hits.push(`fills ${JSON.stringify(got)}; the intake reads back ${JSON.stringify(want)}`);
  return hits;
}
function formHits787(name, build) {
  const hits = [];
  if (name !== FORM787()) hits.push('not the offer\'s Measure a skill form');
  if (!fs.existsSync(path.join(R787.dir, name))) hits.push('no such template');
  const exclude = /^EXCLUDE_RE='([^']*)'/m.exec(build)?.[1];
  if (!exclude) hits.push('public tree filter not read');
  else if (new RegExp(exclude).test(`.github/ISSUE_TEMPLATE/${name}`)) hits.push('template excluded from the public tree');
  return hits;
}
// Links the lookup reads whose identity the intake reads otherwise, or only in part (AC-787-4).
const EXTRA787 = [
  'https://github.com/owner-z/.github/tree/main/skills/alpha',
  'https://raw.githubusercontent.com/owner-z/x.git/main/skills/alpha/SKILL.md',
  'https://github.com/owner-z/repo-z/tree/main/skills/SKILL.md/SKILL.md',
  'https://github.com/owner-z/repo-z/tree/main/skills/caf%C3%A9',
  'https://github.com/owner-z/repo-z/tree/main/skills/.hidden',
  'https://github.com/owner-z/repo-z/tree/main/skills/a%20b',
  'https://github.com/-owner/repo-z/tree/main/skills/alpha',
  'https://github.com/owner-z/_repo/tree/main/skills/alpha',
];
const LINKS787 = () => [...TABLE.filter((r) => r[2].ok).map((r) => r[1]), ...EXTRA787];

test('AC-787-1 and AC-787-2: the request opens the offer\'s form, filled only by the form\'s own field ids; plants', () => {
  const fields = FIELDS787();
  assert.deepEqual(fields.map((f) => [f.type, f.id, f.label]), [['input', 'repository', 'Repository link'], ['input', 'skill', 'Skill path'], ['dropdown', 'author', 'Are you the author?']], 'the form as the offer ships it');
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-public.sh'), 'utf8');
  assert.deepEqual(formHits787('measure-skill.yml', build), []);
  assert.notDeepEqual(formHits787('skill-request.md', build), [], 'plant: the old template');
  assert.notDeepEqual(formHits787('measure-pack.yml', build), [], 'plant: the pack form');
  assert.notDeepEqual(formHits787('measure-skill.yml', "EXCLUDE_RE='^\\.github/ISSUE_TEMPLATE/'"), [], 'plant: the filter excludes the forms');
  const x = id('owner-z', 'repo-z', 'skills/alpha');
  const good = url787(intakeFill787(x, fields));
  assert.deepEqual(draftHits787(good, x, fields), []);
  const plants = {
    'old template': (u) => u.searchParams.set('template', 'skill-request.md'),
    'pack form': (u) => u.searchParams.set('template', 'measure-pack.yml'),
    'source repository': (u) => { u.pathname = '/driftproofhq/driftproof-source/issues/new'; },
    fragment: (u) => { u.hash = 'x'; },
    title: (u) => u.searchParams.set('title', 'Measure a skill: owner-z/repo-z/skills/alpha'),
    body: (u) => u.searchParams.set('body', 'note'),
    labels: (u) => u.searchParams.set('labels', 'offer'),
    author: (u) => u.searchParams.set('author', 'Yes'),
    'an id the form lacks': (u) => u.searchParams.set('skill_path', 'skills/alpha'),
    'repository twice': (u) => u.searchParams.append('repository', 'https://github.com/owner-z/repo-z'),
  };
  for (const [name, mutate] of Object.entries(plants)) {
    const u = new URL(good); mutate(u);
    assert.notDeepEqual(draftHits787(u.href, x, fields), [], `plant: ${name}`);
  }
});

test('AC-787-3 and AC-787-4: each filled value is the identity as the intake reads it, and nothing is guessed; plants', async () => {
  const fields = FIELDS787();
  // The reader's own expectations, read from the intake, on the rows the criterion names.
  const fill = (text) => intakeFill787(readLinkRef(text), fields);
  assert.deepEqual(fill(rowOf(1)[1]), { repository: 'https://github.com/owner-a/repo-a', skill: 'skills/alpha' });
  assert.deepEqual(fill(rowOf(7)[1]), { repository: 'https://github.com/OWNER-A/Repo-A', skill: 'skills/alpha' });
  assert.deepEqual(fill(rowOf(30)[1]), { repository: 'https://github.com/owner-a/repo-a', skill: 'v2/skills/alpha' });
  for (const n of [12, 13, 14]) assert.deepEqual(Object.keys(fill(rowOf(n)[1])), ['repository'], `row ${n}: an empty path fills no skill path`);
  assert.deepEqual(Object.keys(fill(rowOf(28)[1])), ['repository'], 'row 28: markup fills no skill path');
  for (const link of EXTRA787.slice(2, 6)) assert.deepEqual(Object.keys(fill(link)), ['repository'], link);
  for (const link of [EXTRA787[0], EXTRA787[1], ...EXTRA787.slice(6)]) assert.deepEqual(Object.keys(fill(link)), ['skill'], link);
  const run = (build) => LINKS787().flatMap((text) => {
    const x = readLinkRef(text);
    return draftHits787(build(x, text), x, fields).map((h) => `${text}: ${h}`);
  });
  assert.deepEqual(run((x) => url787(intakeFill787(x, fields))), [], 'the reader\'s own builder');
  // Builders with one fault each; every one reads red on the links the criterion names.
  const all = (x) => ({ repository: `https://github.com/${x.owner}/${x.repo}`, ...(x.path ? { skill: x.path } : {}) });
  const builders = {
    'lowercased owner': (x) => url787({ ...intakeFill787(x, fields), repository: `https://github.com/${x.owner.toLowerCase()}/${x.repo}` }),
    'ref kept': (x) => url787({ ...intakeFill787(x, fields), skill: `main/${x.path}` }),
    'path from the pasted text': (x, text) => url787({ ...intakeFill787(x, fields), ...(x.path ? { skill: x.path + new URL(text.trim().replace(/^(?![a-z]+:\/\/)/, 'https://')).search } : {}) }),
    'SKILL.md doubled': (x) => url787({ ...intakeFill787(x, fields), skill: `${x.path}/SKILL.md/SKILL.md` }),
    'another repository': () => url787({ repository: 'https://github.com/owner-a/repo-a' }),
    'empty path filled as SKILL.md': (x) => url787({ ...intakeFill787(x, fields), skill: x.path || 'SKILL.md' }),
    'every value filled unread': (x) => url787(all(x)),
  };
  for (const [name, build] of Object.entries(builders)) assert.notDeepEqual(run(build), [], `plant: ${name}`);
  // Each AC-787-4 subject reads red on its own under the unread builder.
  for (const text of [rowOf(28)[1], EXTRA787[0], EXTRA787[1], EXTRA787[2]]) {
    const x = readLinkRef(text);
    assert.notDeepEqual(draftHits787(url787(all(x)), x, fields), [], `plant: ${text} filled`);
  }
  assert.notDeepEqual(run((x, text) => (text === rowOf(8)[1] ? url787({ ...intakeFill787(x, fields), skill: `${x.path}?tab=readme` }) : url787(intakeFill787(x, fields)))), [], 'plant: row 8 query sent');
  // The island, read last.
  const island = await freshIsland();
  assert.equal(typeof island.requestIssueUrl, 'function', 'requestIssueUrl(identity) is not built');
  const real = await withFetch(() => { throw Error('a request builder must not fetch'); }, async (calls) => {
    const hits = run((x) => island.requestIssueUrl(island.readLink(x.text)));
    assert.equal(calls.length, 0);
    return hits;
  });
  assert.deepEqual(real, []);
  for (const bad of [null, {}, { owner: 'o', repo: 'r' }, { owner: 1, repo: 'r', path: '' }]) assert.equal(island.requestIssueUrl(bad), null, `refuses ${JSON.stringify(bad)}`);
});
// readLink by the island would make the reader share code with it; the table's own identities are the
// reader's. EXTRA787's identities are read here by § Reading a link's steps for the shapes they hold.
function readLinkRef(text) {
  const row = TABLE.find((r) => r[1] === text);
  if (row) return { ...row[2], text };
  const u = new URL(text);
  const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [owner, repo] = seg;
  let rest = u.hostname === 'raw.githubusercontent.com' ? seg.slice(3) : seg.slice(4);
  if (rest.length && rest[rest.length - 1].toLowerCase() === 'skill.md') rest = rest.slice(0, -1);
  return { ok: true, owner, repo, path: rest.join('/'), text };
}

test('AC-787-8: the old form is retired from the templates, the island, the page and its builder; plants', () => {
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const now = { oldExists: fs.existsSync(path.join(R787.dir, R787.old)), island: read(ISLAND), page: read(PAGE), builder: read(path.join(ROOT, 'scripts', 'build-site-pages.js')) };
  function retiredHits(s) {
    const hits = [];
    if (s.oldExists) hits.push('skill-request.md still ships');
    for (const k of ['island', 'page', 'builder']) {
      if (s[k].includes('skill-request')) hits.push(`${k} names skill-request`);
      for (const t of R787.oldTerms) if (s[k].includes(t)) hits.push(`${k} carries the old terms`);
      if (/data-request-(note|maintainer)|\brequest(Note|Maintainer)\b/.test(s[k])) hits.push(`${k} asks for the old note or maintainer choice`);
    }
    return hits;
  }
  const clean = { oldExists: false, island: 'export function requestIssueUrl() {}', page: '<main></main>', builder: '' };
  assert.deepEqual(retiredHits(clean), []);
  assert.notDeepEqual(retiredHits({ ...clean, oldExists: true }), [], 'plant: the template restored');
  assert.notDeepEqual(retiredHits({ ...clean, island: "url.search = new URLSearchParams({ template: 'skill-request.md' })" }), [], 'plant: the island names the old template');
  assert.notDeepEqual(retiredHits({ ...clean, page: `<p>${R787.oldTerms[0]}</p>` }), [], 'plant: the page carries the old terms');
  assert.deepEqual(retiredHits(now), []);
});

test('AC-787-9 and AC-787-10: the request and the fallback promise nothing of their own, and the fallback links /measure/; plants', async () => {
  function fallbackHits(html) {
    const mount = /<div class="skill-lookup" data-island="skill-lookup">([\s\S]*?)<\/div>/.exec(mainOf(html) || '')?.[1] || '';
    const hits = [];
    const links = [...mount.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    const f = links.filter((m) => /\sdata-request-fallback(\s|=|$)/.test(m[1]));
    if (f.length !== 1 || !/\shref="\/measure\/"/.test(f[0][1]) || f[0][2] !== 'how to ask') hits.push('F-2 does not link /measure/');
    if (!textOf(mount).includes(TX.F2)) hits.push('F-2 is not on the page');
    if (/github\.com/.test(mount)) hits.push('the fallback links GitHub');
    return hits;
  }
  const good = `<main><div class="skill-lookup" data-island="skill-lookup"><p>${TX.F1.replace('the list page.', '<a href="/skills/">the list page</a>.')}</p><p>Want a skill measured? See <a data-request-fallback href="/measure/">how to ask</a>. A public request needs a GitHub account.</p></div></main>`;
  assert.deepEqual(fallbackHits(good), []);
  assert.notDeepEqual(fallbackHits(good.replace('href="/measure/"', 'href="https://github.com/driftproofhq/driftproof/issues/new?template=skill-request.md"')), [], 'plant: F-2 linking the old template');
  assert.notDeepEqual(fallbackHits(good.replace(/<p>Want[\s\S]*?<\/p>/, '')), [], 'plant: F-2 removed');
  assert.notDeepEqual(fallbackHits(good.replace('href="/measure/"', 'href="https://github.com/driftproofhq/driftproof/issues/new"')), [], 'plant: F-2 linking a GitHub issue');
  assert.ok(fs.existsSync(PAGE), 'docs/skill-lookup/index.html is not built yet');
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.deepEqual(fallbackHits(html), []);
  assert.ok(fs.readFileSync(path.join(ROOT, 'docs', 'measure', 'index.html'), 'utf8').includes(`href="${R787.repo}?template=${FORM787()}"`), '/measure/ links the Measure a skill form');
  // Every authored string of the island, the page and the form passes 031/035; the reviewer sentence does not.
  const island = fs.readFileSync(ISLAND, 'utf8'), page = textOf(mainOf(html)), form = fs.readFileSync(path.join(R787.dir, FORM787()), 'utf8');
  assert.deepEqual(await wordHits([island, page, form]), []);
  assert.notDeepEqual(await wordHits([`${page} ${R787.reviewer}`]), [], 'plant: the reviewer sentence');
});

test('AC-787-11: every request URL is bounded, and the longest identity the lookup reads is far below it; plants', async () => {
  assert.deepEqual(boundHits787('x'.repeat(8192)), []);
  assert.notDeepEqual(boundHits787('x'.repeat(8193)), [], 'plant: an 8,193-byte URL');
  assert.notDeepEqual(boundHits787(url787({ repository: 'https://github.com/o/r', skill: '界'.repeat(2000) })), [], 'plant: a non-ASCII path filled');
  const island = await freshIsland();
  assert.equal(typeof island.requestIssueUrl, 'function', 'requestIssueUrl(identity) is not built');
  const head = `https://github.com/${'o'.repeat(39)}/${'r'.repeat(100)}/tree/main/`;
  const longest = head + 'a/'.repeat((2048 - head.length) >> 1).slice(0, 2048 - head.length).replace(/\/$/, 'a');
  assert.equal(longest.length, 2048);
  const x = island.readLink(longest);
  assert.equal(x.ok, true, 'the longest link reads');
  const url = island.requestIssueUrl(x);
  assert.deepEqual(draftHits787(url, { ...x }), []);
  assert.ok(Buffer.byteLength(url) < 8192 / 2, `${Buffer.byteLength(url)} bytes`);
});
