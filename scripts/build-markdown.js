#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/build-markdown.js - a Markdown copy of each answer page, the methodology, the paper page
// and Reports 009 to 013 (spec 135), written beside the page as index.md.
//
// THE COPY IS DERIVED FROM THE PAGE, never written. It is the page's <main> as shipped, converted
// element by element: headings, paragraphs, lists, tables, code, links (made absolute), and the
// text of everything else. Drawings are left out (a figure keeps its caption), and so is the
// page's chrome, which sits outside <main>. A report's copy is a new file derived from the page;
// the page's body is not touched, so spec 020's body baselines do not move.
//
// The first line is the page's <h1>, the second block its canonical URL, so a reader of the copy
// knows what it is a copy of. The page's head links the copy (rel="alternate",
// type="text/markdown"); scripts/build-head-tags.js adds that link where a copy exists.
//
//   node scripts/build-markdown.js            write every copy
//   node scripts/build-markdown.js --check    fail if any copy is stale or missing
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const ORIGIN = 'https://driftproofhq.com';

// The set: these pages, and the reports docs/data/reports.json lists from COPIED_REPORTS.from to
// COPIED_REPORTS.to. The operator ruled on 1 Oct 2026 (spec 135 R-11): "No copies for 001-008".
// Reports 001 to 008 keep their frozen bodies on their pages only, in words the site no longer
// uses (spec 031's band lexicon, em dashes), so they get no copy and no alternate link. spec 135's
// gate reads these bounds against the ruling in the brief.
const PAGES = ['what-is-driftproof', 'agent-skill-evaluation', 'agent-skill-regression-testing', 'compare', 'methodology', 'paper'];
const COPIED_REPORTS = { from: '009', to: '013' };
const copied = (n) => String(n) >= COPIED_REPORTS.from && String(n) <= COPIED_REPORTS.to;
const reportRows = (root) => JSON.parse(fs.readFileSync(path.join(root, 'docs', 'data', 'reports.json'), 'utf8')).reports;
function pageSet(root = ROOT) {
  return [...PAGES.map((p) => `${p}/index.html`), ...reportRows(root).filter((r) => copied(r.number.value)).map((r) => `reports/${r.number.value}/index.html`)];
}
const urlOf = (rel) => `${ORIGIN}/${rel.replace(/(^|\/)index\.html$/, '$1')}`;
const mdOf = (rel) => rel.replace(/index\.html$/, 'index.md');

// ── a small, forgiving HTML reader ──────────────────────────────────────────────────────
const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'source', 'wbr', 'col', 'area', 'base', 'embed', 'track']);
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', times: '×', plusmn: '±', middot: '·',
  hellip: '…', ndash: '–', mdash: '—', minus: '−', rarr: '→', larr: '←',
};
const decode = (s) => String(s)
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 16)))
  .replace(/&([a-z]+);/g, (m, n) => (NAMED[n] === undefined ? m : NAMED[n]));

function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined || m[0] === '<') { stack[stack.length - 1].children.push({ text: m[5] !== undefined ? m[5] : '<' }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!VOID.has(tag) && !m[4]) stack.push(node);
  }
  return root;
}

// ── to Markdown ────────────────────────────────────────────────────────────────────────
const DROP = new Set(['script', 'style', 'svg', 'button', 'template', 'noscript', 'form', 'input', 'select', 'textarea', 'iframe']);
const INLINE = new Set(['a', 'abbr', 'b', 'strong', 'i', 'em', 'cite', 'dfn', 'code', 'kbd', 'samp', 'var', 'q', 'span', 'data', 'time', 'small', 'mark', 'sup', 'sub', 's', 'u', 'label', 'img', 'br', 'wbr']);
const isInline = (n) => n.text !== undefined || INLINE.has(n.tag);

function textContent(n) {
  if (n.text !== undefined) return decode(n.text);
  if (DROP.has(n.tag)) return '';
  if (n.tag === 'br') return '\n';
  return n.children.map(textContent).join('');
}

function makeCtx(pageUrl) {
  const abs = (href) => {
    if (!href) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
    if (href.startsWith('#')) return `${pageUrl}${href}`;
    if (href.startsWith('/')) return `${ORIGIN}${href}`;
    return new URL(href, pageUrl).href;
  };

  function inline(n, inTable = false) {
    if (n.text !== undefined) return decode(n.text).replace(/\s+/g, ' ');
    if (DROP.has(n.tag)) return '';
    const kids = () => n.children.map((c) => inline(c, inTable)).join('');
    switch (n.tag) {
      case 'br': return inTable ? ' ' : '  \n';
      case 'img': return n.attrs.alt ? `![${n.attrs.alt.replace(/[[\]]/g, '')}](${abs(n.attrs.src)})` : '';
      case 'a': {
        const t = kids().trim();
        if (!t) return '';
        return n.attrs.href ? `[${t}](${abs(n.attrs.href)})` : t;
      }
      case 'code': case 'kbd': case 'samp': {
        const t = textContent(n).replace(/\s+/g, ' ');
        if (!t.trim()) return t;
        const tick = t.includes('`') ? '``' : '`';
        return `${tick}${tick.length > 1 ? ' ' : ''}${t}${tick.length > 1 ? ' ' : ''}${tick}`;
      }
      case 'strong': case 'b': { const t = kids(); return t.trim() ? `**${t.trim()}**${/\s$/.test(t) ? ' ' : ''}` : t; }
      case 'em': case 'i': case 'cite': case 'dfn': { const t = kids(); return t.trim() ? `*${t.trim()}*${/\s$/.test(t) ? ' ' : ''}` : t; }
      case 'q': return `“${kids()}”`;
      default: return kids();
    }
  }

  const clean = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^[ \t]+|[ \t]+$/g, '');
  const para = (nodes) => clean(nodes.map((c) => inline(c)).join('').replace(/ {2,}/g, ' ').trim());

  function table(n) {
    const rows = [];
    (function walk(x) {
      for (const c of x.children || []) {
        if (c.tag === 'tr') rows.push(c.children.filter((d) => d.tag === 'td' || d.tag === 'th').map((d) => clean(d.children.map((k) => inline(k, true)).join('')).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()));
        else if (c.tag && !DROP.has(c.tag)) walk(c);
      }
    })(n);
    // A caption is the table's own text (Report 007's cost basis): it stands above the table.
    const cap = n.children.find((c) => c.tag === 'caption');
    const above = cap ? para(cap.children) : '';
    if (!rows.length) return above;
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(width - r.length).fill('')];
    const line = (r) => `| ${pad(r).join(' | ')} |`;
    const grid = [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
    return above ? `${above}\n\n${grid}` : grid;
  }

  function list(n, ordered) {
    let i = 0;
    return n.children.filter((c) => c.tag === 'li').map((li) => {
      i += 1;
      const mark = ordered ? `${i}. ` : '- ';
      const body = blocks(li.children) || '';
      return mark + body.split('\n').map((l, k) => (k === 0 || !l ? l : ' '.repeat(mark.length) + l)).join('\n');
    }).join('\n');
  }

  function block(n) {
    if (DROP.has(n.tag)) return '';
    switch (n.tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const t = para(n.children);
        return t ? `${'#'.repeat(Number(n.tag[1]))} ${t.replace(/\n/g, ' ')}` : '';
      }
      case 'p': case 'figcaption': case 'caption': case 'address': return para(n.children);
      case 'summary': { const t = para(n.children); return t ? `**${t}**` : ''; }
      case 'ul': case 'menu': return list(n, false);
      case 'ol': return list(n, true);
      case 'dl': return n.children.filter((c) => c.tag).map((c) => (c.tag === 'dt' ? (para(c.children) ? `**${para(c.children)}**` : '') : c.tag === 'dd' ? blocks(c.children) : block(c))).filter(Boolean).join('\n\n');
      case 'table': return table(n);
      case 'pre': return `\`\`\`\n${textContent(n).replace(/^\n/, '').replace(/\s+$/, '')}\n\`\`\``;
      case 'blockquote': return blocks(n.children).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
      case 'hr': return '---';
      default: return blocks(n.children);
    }
  }

  // Children in order; a run of inline children is one paragraph.
  function blocks(children) {
    const out = [];
    let run = [];
    const flush = () => { const t = para(run); if (t) out.push(t); run = []; };
    for (const c of children) {
      if (isInline(c)) { run.push(c); continue; }
      flush();
      const b = block(c);
      if (b && b.trim()) out.push(b);
    }
    flush();
    return out.join('\n\n');
  }
  return { blocks };
}

function findMain(node) {
  if (node.tag === 'main') return node;
  for (const c of node.children || []) { const f = findMain(c); if (f) return f; }
  return null;
}
function findFirst(node, tag) {
  if (node.tag === tag) return node;
  for (const c of node.children || []) { const f = findFirst(c, tag); if (f) return f; }
  return null;
}

function toMarkdown(html, rel) {
  const tree = parse(html);
  const main = findMain(tree);
  if (!main) throw new Error(`${rel}: no <main>`);
  const h1 = findFirst(main, 'h1');
  if (!h1) throw new Error(`${rel}: no <h1> in <main>`);
  const title = textContent(h1).replace(/\s+/g, ' ').trim();
  // The <h1> is the copy's first line; it is not repeated where it stands in <main>.
  (function drop(n) { n.children = (n.children || []).filter((c) => c !== h1); n.children.forEach((c) => c.children && drop(c)); })(main);
  const url = urlOf(rel);
  const body = makeCtx(url).blocks(main.children);
  return `# ${title}\n\nCanonical: <${url}>\n\n${body}\n`;
}

function build(root = ROOT, check = false) {
  const stale = [];
  const set = pageSet(root);
  for (const rel of set) {
    const src = path.join(root, 'docs', rel);
    if (!fs.existsSync(src)) { stale.push(`${rel} (the page is missing)`); continue; }
    const want = toMarkdown(fs.readFileSync(src, 'utf8'), rel);
    const dest = path.join(root, 'docs', mdOf(rel));
    const have = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (have === want) continue;
    if (check) { stale.push(mdOf(rel)); continue; }
    fs.writeFileSync(dest, want);
  }
  // A report outside the set has no copy: one left from an earlier build is stale, and is removed.
  for (const r of reportRows(root).filter((x) => !copied(x.number.value))) {
    const dest = path.join(root, 'docs', 'reports', String(r.number.value), 'index.md');
    if (!fs.existsSync(dest)) continue;
    if (check) stale.push(`reports/${r.number.value}/index.md (outside the set)`);
    else fs.unlinkSync(dest);
  }
  return { set, stale };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const { set, stale } = build(ROOT, check);
  if (check && stale.length) {
    console.error(`stale Markdown copies - run: node scripts/build-markdown.js\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(check ? `all ${set.length} Markdown copies are current` : `${set.length} Markdown copies written`);
}

module.exports = { toMarkdown, pageSet, mdOf, PAGES, COPIED_REPORTS };
