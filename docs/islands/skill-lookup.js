// SPDX-License-Identifier: Apache-2.0
//
// docs/islands/skill-lookup.js - the skill lookup at /skill-lookup/, as an island (spec 315, spec 020
// AC-32).
//
// A visitor pastes a GitHub link to a skill and the lookup says whether the skill index has a page
// for the folder the link reads as. It reads one file, the list page at /skills/, and only when a
// link it reads is submitted. The pasted link is read as text and sent nowhere: the one request is
// a constant URL with no query, no body and no header taken from the input. A match shows the
// list's own entry for that skill, its link and its rows copied as text, and nothing more. No model
// is called.
//
// The page is complete before this runs: its mount point holds a static fallback that links to the
// list page (spec 020 AC-34). Every text below is one of spec 315 § The page texts.
const LIST = '/skills/';
const MAX = 2048;

const TX = {
  label: 'GitHub link to a skill',
  button: 'Look up',
  M1: (id) => `The skill index has a page for ${id}:`,
  M2: 'Each row on that page links to its receipt and names the skill commit it measured, where the source recorded one. The link you pasted may point at another version of the skill.',
  N1: (id) => `The skill index has no page for ${id}.`,
  N2: (owner, repo) => `It has a page for the repository ${owner}/${repo} as a whole:`,
  N3: (owner, repo) => `It lists skills in ${owner}/${repo} by folder. Paste the link to one skill's folder.`,
  N4: 'To measure a skill yourself: npx driftproof run <skill-dir> --models <model-id>. It calls a model, so it spends tokens. How to write its test tasks:',
  N4link: { href: '/authoring/', text: 'Writing a fair set of test tasks' },
  U1: (id) => `The skill index could not be read, so this lookup says nothing about ${id}.`,
  X1: "This lookup does not read that link. It takes a github.com link to a repository, a skill's folder or its SKILL.md, or a raw.githubusercontent.com link to a SKILL.md.",
};

const GITHUB = new Set(['github.com', 'www.github.com']);
const RAW = 'raw.githubusercontent.com';
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const BAD_SEGMENT = /[/\\\p{Cc}\p{Cf}]/u;
const lowerAscii = (s) => String(s).replace(/[A-Z]/g, (c) => c.toLowerCase());
const isSkillMd = (s) => lowerAscii(s) === 'skill.md';
const NO = { ok: false };

// ── § Reading a link: one closed rule, a refusal at the first step that fails ─────────────────────
export function readLink(text) {
  const t = String(text).trim();
  if (!t || t.length > MAX) return NO;
  let u;
  try { u = new URL(/^[A-Za-z]+:\/\//.test(t) ? t : `https://${t}`); } catch { return NO; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return NO;
  if (u.username || u.password || u.port) return NO;
  const host = u.hostname;
  if (!GITHUB.has(host) && host !== RAW) return NO;
  // The URL parser has already resolved . and .. segments, so the path read here is the resolved one.
  const segs = [];
  for (const raw of u.pathname.split('/')) {
    if (!raw) continue;
    let s;
    try { s = decodeURIComponent(raw); } catch { return NO; }
    if (BAD_SEGMENT.test(s) || s === '.' || s === '..') return NO;
    segs.push(s);
  }
  if (segs.length < 2) return NO;
  const owner = segs[0];
  let repo = segs[1];
  if (!OWNER.test(owner) || !REPO.test(repo)) return NO;
  let rest;
  if (GITHUB.has(host)) {
    if (repo.endsWith('.git')) repo = repo.slice(0, -4);
    if (!repo) return NO;
    if (segs.length === 2) rest = [];
    else {
      const kind = segs[2];
      if ((kind !== 'tree' && kind !== 'blob') || segs.length < 4) return NO;
      rest = segs.slice(4);
      // A blob names a file, and the only file the lookup reads past is SKILL.md.
      if (kind === 'blob' && (!rest.length || !isSkillMd(rest[rest.length - 1]))) return NO;
    }
  } else {
    const refLength = segs[2] === 'refs' && (segs[3] === 'heads' || segs[3] === 'tags') ? 3 : 1;
    rest = segs.slice(2 + refLength);
    if (segs.length < 2 + refLength || !rest.length || !isSkillMd(rest[rest.length - 1])) return NO;
  }
  if (rest.length && isSkillMd(rest[rest.length - 1])) rest = rest.slice(0, -1);
  return { ok: true, owner, repo, path: rest.join('/') };
}

// ── reading the list page whole (AC-3, AC-6) ──────────────────────────────────────────────────────
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, '&');
const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
// This is a data parser, not a browser document. Never instantiate the fetched markup.
const TAGS = new Set(['ul','li','a','span','div','p','section','data','details','summary','time']);
const ATTRS = new Set(['class','href','value','datetime','data-page','data-source','data-evidence','data-freshness','data-path','data-task','data-driver','data-result','data-at','data-cost','data-src','data-fn','data-dp','data-receipt-link','data-receipt-path','data-manifest','data-build-date']);
function listTree(source) {
  const root={tag:'root',children:[]},stack=[root];
  const token=/<\/[a-z]+\s*>|<[a-z]+(?:\s+[a-z-]+="[^"<>]*")*\s*>|[^<]+/y;
  let at=0;
  while(at<source.length){
    token.lastIndex=at;const m=token.exec(source);if(!m)return null;at=token.lastIndex;
    const raw=m[0];
    if(raw[0]!=='<'){stack.at(-1).children.push({text:decode(raw)});continue;}
    const tag=/^<\/?([a-z]+)/.exec(raw)[1];if(!TAGS.has(tag))return null;
    if(raw[1]==='/'){
      if(stack.length===1||stack.at(-1).tag!==tag)return null;
      stack.pop();if(stack.length===1)return {node:root.children[0],end:at};
    }else{
      const attrs={};
      for(const x of raw.matchAll(/\s([a-z-]+)="([^"]*)"/g)){
        if(!ATTRS.has(x[1])||Object.hasOwn(attrs,x[1]))return null;
        attrs[x[1]]=decode(x[2]);
      }
      if(attrs.class==='skill-entry'&&stack.length!==2)return null;
      const n={tag,attrs,children:[]};stack.at(-1).children.push(n);stack.push(n);
    }
  }
  return null;
}
const nodeText=n=>n.text!==undefined?n.text:n.children.map(nodeText).join(' ');
const hasClass=(n,c)=>n.attrs?.class===c;
function entryOf(n){
  if(n.tag!=='li'||!hasClass(n,'skill-entry'))return null;
  const page=n.attrs['data-page'],p=n.attrs['data-path'];
  if(typeof p!=='string'||!/^([^/]+)\/([^/]+)\/([^/]+)\/$/.test(page))return null;
  if(n.children.some(x=>x.text!==undefined&&x.text.trim()))return null;
  const parts=n.children.filter(x=>x.tag),link=parts.shift();
  if(!link||link.tag!=='a'||link.attrs.href!==LIST+page||link.children.some(x=>x.tag))return null;
  if(Object.keys(link.attrs).some(k=>k!=='href'&&k!=='class')||(link.attrs.class&&link.attrs.class!=='skill-name'))return null;
  const rows=[];
  if(parts[0]?.tag==='span'&&hasClass(parts[0],'skill-repository')){
    const context=parts.shift();if(context.children.some(x=>x.tag))return null;
    rows.push(collapse(nodeText(context)));
  }
  if(!parts.length)return null;
  for(const row of parts){
    if(!['span','div'].includes(row.tag)||!hasClass(row,'skill-entry-row'))return null;
    if(row.tag==='span'&&row.children.some(x=>x.tag))return null;
    rows.push(collapse(nodeText(row)));
  }
  const [owner,repo]=page.split('/');
  return {owner,repo,path:p,href:link.attrs.href,text:collapse(nodeText(link)),rows};
}
export function readList(html){
  const s=String(html),open='<ul class="skill-list">',start=s.indexOf(open);
  if(start<0||s.indexOf(open,start+open.length)>=0)return NO;
  const tree=listTree(s.slice(start));if(!tree)return NO;
  if(s.slice(start+tree.end).includes('<li class="skill-entry"'))return NO;
  if(tree.node.children.some(n=>n.text!==undefined&&n.text.trim()))return NO;
  const entries=tree.node.children.filter(n=>n.tag).map(entryOf);
  if(!entries.length||entries.some(e=>!e))return NO;
  return {ok:true,entries};
}

// ── matching (AC-2): owner and repository ignoring ASCII case, the path exactly ───────────────────
const sameRepo = (x, e) => lowerAscii(e.owner) === lowerAscii(x.owner) && lowerAscii(e.repo) === lowerAscii(x.repo);
export function matchEntries(identity, entries) {
  return entries.filter((e) => sameRepo(identity, e) && e.path === identity.path);
}

// ── the one request (AC-8, AC-14): shared while in flight, kept after a whole read ────────────────
let kept = null;
let inFlight = null;
function readListOnce() {
  if (kept) return Promise.resolve(kept);
  if (!inFlight) {
    inFlight = Promise.resolve()
      .then(() => fetch(LIST, { cache: 'no-cache' }))
      .then((res) => (res && res.status === 200 ? res.text() : null))
      .then((html) => (html === null ? NO : readList(html)), () => NO)
      .then((list) => { if (list.ok) kept = list; inFlight = null; return list; });
  }
  return inFlight;
}

export async function lookup(text) {
  const x = readLink(text);
  if (!x.ok) return { kind: 'refused', identity: null, entries: [], repository: [], byFolder: false };
  const identity = { owner: x.owner, repo: x.repo, path: x.path };
  const list = await readListOnce();
  if (!list.ok) return { kind: 'unreadable', identity, entries: [], repository: [], byFolder: false };
  const entries = matchEntries(identity, list.entries);
  if (entries.length) return { kind: 'match', identity, entries, repository: [], byFolder: false };
  const repository = identity.path ? list.entries.filter((e) => sameRepo(identity, e) && e.path === '') : [];
  const byFolder = !identity.path && list.entries.some((e) => sameRepo(identity, e) && e.path !== '');
  return { kind: 'none', identity, entries: [], repository, byFolder };
}

// ── what the lookup says (AC-5, AC-6, AC-7) ───────────────────────────────────────────────────────
const idText = (x) => `${x.owner}/${x.repo}${x.path ? `/${x.path}` : ''}`;
const entryPart = (e) => ({ entry: { href: e.href, text: e.text, rows: e.rows.slice() } });
export function resultParts(result) {
  const r = result || {};
  if (r.kind === 'refused') return [{ text: TX.X1 }];
  const id = idText(r.identity);
  if (r.kind === 'unreadable') return [{ text: TX.U1(id) }];
  if (r.kind === 'match') return [{ text: TX.M1(id) }, ...r.entries.map(entryPart), { text: TX.M2 }];
  const repository = r.repository || [];
  return [
    { text: TX.N1(id) },
    ...(repository.length ? [{ text: TX.N2(r.identity.owner, r.identity.repo) }, ...repository.map(entryPart)] : []),
    ...(r.byFolder ? [{ text: TX.N3(r.identity.owner, r.identity.repo) }] : []),
    { text: TX.N4 },
    { href: TX.N4link.href, text: TX.N4link.text },
  ];
}

// Each part is one element of the result area, its words set as text, never as markup.
function linkOf(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}
function nodeOf(part) {
  const p = document.createElement('p');
  if (part.entry) {
    p.append(linkOf(part.entry.href, part.entry.text));
    for (const row of part.entry.rows) {
      const span = document.createElement('span');
      span.className = 'skill-entry-row';
      span.textContent = row;
      p.append(' ', span);
    }
  } else if (part.href !== undefined) p.append(linkOf(part.href, part.text));
  else p.textContent = part.text;
  return p;
}

export function mount(el) {
  if (el.dataset.mounted) return;
  el.dataset.mounted = 'true';
  const form = document.createElement('form');
  form.className = 'skill-lookup-form';
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('autocomplete', 'off');
  input.spellcheck = false;
  label.append(TX.label, ' ', input);
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = TX.button;
  form.append(label, ' ', button);
  const area = document.createElement('div');
  area.className = 'skill-lookup-result';
  area.setAttribute('aria-live', 'polite');
  // Only the latest submit's result is written: an earlier one that resolves later is dropped.
  let latest = 0;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = ++latest;
    lookup(input.value).then((r) => {
      if (n === latest) area.replaceChildren(...resultParts(r).map(nodeOf));
    });
  });
  el.replaceChildren(form, area);
}
