// SPDX-License-Identifier: Apache-2.0
//
// docs/islands/skill-lookup.js - the skill lookup at /skill-lookup/, as an island (spec 315, spec 020
// AC-32).
//
// A visitor pastes a GitHub link to a skill and the lookup says whether the list loaded for this visit has
// a page for the folder the link reads as. It reads one file, the list page at /skills/, and only when a
// link it reads is submitted. The pasted link is read as text and sent nowhere: the one request is
// a constant URL with no query, no body and no header taken from the input. A match shows the
// list's own entry for that skill, its link and its rows copied as text, with compact navigation. No model
// is called.
//
// The page is complete before this runs: its mount point holds a static fallback that links to the
// list page (spec 020 AC-34). Every text below is one of spec 315 § The page texts.
const LIST = '/skills/';
const MAX = 2048;

const TX = {
  label: 'GitHub link to a skill',
  button: 'Look up',
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
  N4link: { href: '/authoring/', text: 'Writing a fair set of test tasks' },
  U1: (id) => `The skill index could not be read, so this lookup says nothing about ${JSON.stringify(id)} (read from your link).`,
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
  return {owner,repo,path:p,evidence:n.attrs['data-evidence'],href:link.attrs.href,text:collapse(nodeText(link)),rows};
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
  if (r.kind === 'match') return [{ text: TX.M1(id) }, ...r.entries.map(entryPart), { text: TX.M2 }, { text: TX.R1 }];
  const repository = r.repository || [];
  return [
    { text: TX.N1(id) },
    ...(repository.length ? [{ text: TX.N2(r.identity.owner, r.identity.repo) }, ...repository.map(entryPart)] : []),
    ...(r.byFolder ? [{ text: TX.N3(r.identity.owner, r.identity.repo) }] : []),
    { text: TX.R1 },
    ...TX.N4(r.identity).map((text) => ({ text })),
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

// The compact view adds navigation and actions. The complete original record stays available.
const VIEW = {
  cache: 'List loaded for this visit. Reload this page to check again.',
  outcome: 'One test task, with and without the skill. Answers side by side. A first look, no verdict.',
  cost: 'Calls a model and spends tokens. Your Claude Code account is the default. Target, grader and provider settings choose the account or API key and destination.',
};
function append(parent, ...children) {
  for (const child of children) parent.append(child, ' ');
}
function paragraph(text, className = '') {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}
function heading(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}
function recordOf(result, title) {
  const details = document.createElement('details');
  details.className = 'lookup-record';
  const summary = document.createElement('summary');
  summary.textContent = title;
  append(details, summary, ...resultParts(result).map(nodeOf));
  return details;
}
function stepOf(number, title, note, command, copyLabel, after) {
  const li = document.createElement('li');
  const marker = document.createElement('span');
  marker.className = 'lookup-step-number';
  marker.textContent = number;
  const body = document.createElement('div');
  const h = document.createElement('h3');
  h.textContent = title;
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = command;
  pre.append(code);
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.copy = command;
  button.textContent = copyLabel;
  append(body, h, paragraph(note), pre, button);
  if (after) append(body, paragraph(after, 'lookup-pick'));
  append(li, marker, body);
  return li;
}

// A-315-9, issue 787: an explicit request, separate from the private lookup, opens the free offer's
// Measure a skill form. Only the form's own fields are filled, by their ids, and only with a value the
// offer's intake reads back as this identity; any other field is left for the reader on GitHub.
const REQUEST_REPO = 'https://github.com/driftproofhq/driftproof/issues/new';
const REQUEST = {
  summary: 'Ask us to measure it (needs a GitHub account)',
  intro: "This opens the free offer's Measure a skill form on GitHub. Fields read from your link are filled in. You say there whether you are the author, then submit the issue.",
  empty: 'An empty field was not read from your link. Fill it in on GitHub.',
  disclosure: 'Opening the form sends only the repository link and skill path shown here to GitHub.',
  status: 'Submit the issue on GitHub to finish.',
};
// The intake's plain names (scripts/offer.js REPO_RE, SEGMENT and skillPath), restated: an island imports nothing.
const PLAIN_OWNER = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function requestFields(identity) {
  const x = identity || {};
  if (typeof x.owner !== 'string' || typeof x.repo !== 'string' || typeof x.path !== 'string') return null;
  const fields = {};
  if (PLAIN_OWNER.test(x.owner) && PLAIN_NAME.test(x.repo) && !x.repo.endsWith('.git')) fields.repository = `https://github.com/${x.owner}/${x.repo}`;
  const segments = x.path.split('/');
  // An empty path is not filled: a repository link may name a pack, not a skill at its root.
  if (x.path && segments.every((s) => PLAIN_NAME.test(s)) && segments[segments.length - 1] !== 'SKILL.md') fields.skill = x.path;
  return fields;
}
export function requestIssueUrl(identity) {
  const fields = requestFields(identity);
  if (!fields) return null;
  const url = new URL(REQUEST_REPO);
  url.search = new URLSearchParams({ template: 'measure-skill.yml', ...fields }).toString();
  return new TextEncoder().encode(url.href).byteLength <= 8192 ? url.href : null;
}
function requestLink(href, text) {
  const a = linkOf(href, text);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
function requestField(labelText, field) {
  const label = document.createElement('label');
  label.append(labelText, ' ', field);
  return label;
}
function shownField(value) {
  const input = document.createElement('input');
  input.type = 'text'; input.readOnly = true; input.value = value || '';
  input.autocomplete = 'off'; input.spellcheck = false;
  return input;
}
function requestOf(identity) {
  const fields = requestFields(identity) || {};
  const url = requestIssueUrl(identity);
  const details = document.createElement('details');
  details.className = 'lookup-request';
  const summary = document.createElement('summary');
  summary.textContent = REQUEST.summary;
  const form = document.createElement('form');
  form.className = 'lookup-request-form';
  const repository = shownField(fields.repository);
  repository.dataset.requestRepository = '';
  const skill = shownField(fields.skill);
  skill.dataset.requestSkill = '';
  const terms = document.createElement('p');
  terms.append('The terms and the queue are on ', linkOf('/measure/', 'the offer page'), '.');
  const submit = document.createElement('button');
  submit.type = 'submit'; submit.textContent = 'Open the form on GitHub'; submit.disabled = !url;
  const github = requestLink(url || '', 'Continue on GitHub');
  github.dataset.requestGithub = ''; github.hidden = !url;
  const status = paragraph('');
  status.dataset.requestStatus = ''; status.setAttribute('aria-live', 'polite');
  let opening = false;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (opening || !url) return;
    opening = true; submit.disabled = true; status.textContent = REQUEST.status;
    github.click();
    queueMicrotask(() => { opening = false; submit.disabled = false; });
  });
  append(form, paragraph(REQUEST.intro), requestField('Repository link', repository), requestField('Skill path', skill));
  if (!fields.repository || !fields.skill) append(form, paragraph(REQUEST.empty));
  append(form, terms, paragraph(REQUEST.disclosure, 'lookup-request-disclosure'), submit, github, status);
  append(details, summary, form);
  return details;
}

function compactResult(r) {
  const section = document.createElement('section');
  section.className = 'lookup-summary lookup-' + r.kind;
  if (r.kind === 'refused' || r.kind === 'unreadable') {
    append(section, heading(r.kind === 'refused' ? 'Check the link' : 'List unavailable'), ...resultParts(r).map(nodeOf));
    return section;
  }
  if (r.kind === 'match') {
    const measured = r.entries.every(e => e.evidence === 'measured');
    append(section, paragraph(measured ? 'Measured results' : 'Page found', 'lookup-status'),
      paragraph('In the list loaded for this visit', 'lookup-scope'),
      heading('Open the skill page'), paragraph('Read its results and test records.'));
    for (const entry of r.entries) {
      const a = linkOf(entry.href, entry.text);
      a.className = 'lookup-primary';
      append(section, a);
    }
    append(section, paragraph(VIEW.cache, 'lookup-cache'), recordOf(r, 'Results and limits from the loaded list'));
    return section;
  }
  const x = r.identity, guide = TX.N4(x);
  // Both setup commands and the start command are the artefact-checked N-4 commands.
  const setup = guide[2] + '\n' + guide[3];
  const start = /type ([^ ]+)\./.exec(guide[4])[1];
  const folder = x.path ? 'Folder in the pasted link: ' + JSON.stringify(x.path)
    : 'Repository in the pasted link: ' + JSON.stringify(x.owner + '/' + x.repo);
  append(section, paragraph("Not in this visit's list", 'lookup-status'), heading('Try one task on your machine'),
    paragraph(folder, 'lookup-identity'), paragraph(VIEW.outcome, 'lookup-outcome'));
  const steps = document.createElement('ol');
  steps.className = 'lookup-steps';
  append(steps,
    stepOf('1', 'Add the plugin', 'In your terminal. Node.js 22 or later.', setup, 'Copy setup'),
    stepOf('2', 'Start in Claude Code', 'Open the folder above your local skill.', start, 'Copy start',
      x.path ? 'If the linked folder is a skill, pick the matching local folder by its full path.'
        : 'Pick the local skill folder you want to test by its full path.'));
  append(section, steps, paragraph(VIEW.cost, 'lookup-cost'), paragraph(VIEW.cache, 'lookup-cache'),
    recordOf(r, 'Run details, sample result and CLI'), requestOf(r.identity));
  return section;
}
function previewOf() {
  const section = document.createElement('section');
  section.className = 'lookup-preview';
  append(section, heading('Find a page. Or try a first run.'));
  const paths = document.createElement('div');
  paths.className = 'lookup-paths';
  const found = document.createElement('div');
  const missing = document.createElement('div');
  append(found, paragraph('In the list', 'lookup-preview-label'), paragraph('Read results and test records.'));
  append(missing, paragraph('No page for this folder', 'lookup-preview-label'), paragraph('Try one test task on your machine.'));
  append(paths, found, missing);
  append(section, paths);
  return section;
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
  input.placeholder = 'https://github.com/owner/repo/tree/main/skills/…';
  label.append(TX.label, ' ', input);
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = TX.button;
  form.append(label, ' ', button);
  const note = paragraph('Browser lookup. No model call. No tokens.', 'lookup-form-note');
  const area = document.createElement('div');
  area.className = 'skill-lookup-result';
  area.setAttribute('aria-live', 'polite');
  area.append(previewOf());
  // Only the latest submit's result is written: an earlier one that resolves later is dropped.
  let latest = 0;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = ++latest;
    const submittedLink = input.value.trim();
    lookup(submittedLink).then((r) => {
      if (n === latest) area.replaceChildren(compactResult(r));
    });
  });
  el.replaceChildren(form, note, area);
}
