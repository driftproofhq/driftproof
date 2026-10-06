// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/html-text.js - one small HTML tokenizer and the text helper built on it (spec 148).
//
// WHY A SCAN AND NOT A REGEX. A pattern that removes tags (`/<[^>]*>/g`, `/<script[\s\S]*?<\/script>/g`)
// reads a page differently from a browser: it stops at a ">" inside a quoted attribute, misses
// `<SCRIPT>` and `</script >`, and leaves `<scr<script>ipt>` as a tag after one pass. CodeQL names
// each of those. This reads the input once, left to right, the way the HTML tokenizer does, and does
// the same work for every caller: scripts/answer-pages.js, scripts/build-sitemap.js,
// scripts/site-chrome.js and scripts/build-markdown.js.
//
// WHAT IT READS
//   - A start tag is `<` and an ASCII letter. Its attributes are read by the quoting rules: a value
//     opened by " or ' runs to the next same quote and may hold ">"; an unquoted value runs to white
//     space or ">". A tag name and an attribute name are lower-cased.
//   - A tag the input ends inside is dropped with the rest of the input, as a browser drops it.
//   - `<!--` opens a comment that ends at `-->` or `--!>` (`<!-->` and `<!--->` are empty comments);
//     a comment the input ends inside runs to the end. `<!doctype>`, `<?...>`, `<![CDATA[...>` and
//     `</` + a non-letter are comments that end at the first ">".
//   - script, style, textarea, title, xmp, iframe, noembed and noframes hold raw text: their content
//     is one text token, up to `</name` followed by white space, "/" or ">", in any letter case.
//   - Any other "<" is text. Entities are never decoded here: `&lt;script&gt;` stays text, and a
//     caller that wants it decoded passes `decode`, which runs on text only, after the tags are gone.
//
// Linear: every step moves the position forward and no step looks back, so a long run of "<" or of
// unclosed quotes costs the length of the input once.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes']);

const isSpace = (c) => c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

// The tag whose name starts at s[at]: { name, attrs, selfClosing, end }, `end` the index after the
// ">", or null when the input ends inside the tag.
function readTag(s, at) {
  const n = s.length;
  let i = at;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (isSpace(c) || c === 47 || c === 62) break;
    i += 1;
  }
  const name = s.slice(at, i).toLowerCase();
  const attrs = [];
  let selfClosing = false;
  for (;;) {
    while (i < n && (isSpace(s.charCodeAt(i)) || s.charCodeAt(i) === 47)) {
      if (s.charCodeAt(i) === 47 && s.charCodeAt(i + 1) === 62) selfClosing = true;
      i += 1;
    }
    if (i >= n) return null;
    if (s.charCodeAt(i) === 62) return { name, attrs, selfClosing, end: i + 1 };
    const from = i;
    i += 1; // the first character is part of the name whatever it is, "=" included
    while (i < n) {
      const c = s.charCodeAt(i);
      if (isSpace(c) || c === 47 || c === 62 || c === 61) break;
      i += 1;
    }
    const key = s.slice(from, i).toLowerCase();
    let j = i;
    while (j < n && isSpace(s.charCodeAt(j))) j += 1;
    let value = null;
    if (s.charCodeAt(j) === 61) {
      j += 1;
      while (j < n && isSpace(s.charCodeAt(j))) j += 1;
      const q = s.charCodeAt(j);
      if (q === 34 || q === 39) {
        const close = s.indexOf(s[j], j + 1);
        if (close < 0) return null;
        value = s.slice(j + 1, close);
        j = close + 1;
      } else {
        const v = j;
        while (j < n && !isSpace(s.charCodeAt(j)) && s.charCodeAt(j) !== 62) j += 1;
        value = s.slice(v, j);
      }
      i = j;
    }
    attrs.push([key, value]);
  }
}

// The index after the comment that opens at s[at] (`<!--`).
function commentEnd(s, at) {
  const body = at + 4;
  if (s.charCodeAt(body) === 62) return body + 1;
  if (s.charCodeAt(body) === 45 && s.charCodeAt(body + 1) === 62) return body + 2;
  let k = s.indexOf('--', body);
  while (k >= 0) {
    if (s.charCodeAt(k + 2) === 62) return k + 3;
    if (s.charCodeAt(k + 2) === 33 && s.charCodeAt(k + 3) === 62) return k + 4;
    k = s.indexOf('--', k + 1);
  }
  return s.length;
}

// The index of the `</name` that closes a raw-text element whose content starts at `from`, or -1.
function rawEnd(s, from, name) {
  let k = s.indexOf('</', from);
  while (k >= 0) {
    const after = k + 2 + name.length;
    if (s.slice(k + 2, after).toLowerCase() === name) {
      const c = s.charCodeAt(after);
      if (isSpace(c) || c === 47 || c === 62) return k;
    }
    k = s.indexOf('</', k + 2);
  }
  return -1;
}

// Tokens, in order: { type: 'text', text } | { type: 'comment', raw } |
// { type: 'start', name, attrs: [[name, value|null], ...], selfClosing, raw } | { type: 'end', name, raw },
// `raw` the source slice of the tag or comment, so a caller can put it back unchanged.
function tokenize(html) {
  const s = String(html);
  const n = s.length;
  const out = [];
  let i = 0;
  let text = 0;
  const flush = (to) => { if (to > text) out.push({ type: 'text', text: s.slice(text, to) }); };
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    const c = s.charCodeAt(lt + 1);
    let tok = null;
    let end = 0;
    if (isAlpha(c)) {
      const t = readTag(s, lt + 1);
      if (!t) { flush(lt); text = n; i = n; break; }
      // A browser ignores the slash of `<script/>` and of every other non-void HTML element, so a
      // raw-text element opens whatever its tag ends in; build-markdown.js keeps the flag for the rest.
      tok = { type: 'start', name: t.name, attrs: t.attrs, selfClosing: t.selfClosing && !RAW_TEXT.has(t.name) };
      end = t.end;
    } else if (c === 47) {
      const d = s.charCodeAt(lt + 2);
      if (isAlpha(d)) {
        const t = readTag(s, lt + 2);
        if (!t) { flush(lt); text = n; i = n; break; }
        tok = { type: 'end', name: t.name };
        end = t.end;
      } else if (Number.isNaN(d)) {
        i = lt + 1;
        continue;
      } else {
        const gt = s.indexOf('>', lt + 2);
        tok = { type: 'comment' };
        end = gt < 0 ? n : gt + 1;
      }
    } else if (c === 33 && s.startsWith('--', lt + 2)) {
      tok = { type: 'comment' };
      end = commentEnd(s, lt);
    } else if (c === 33 || c === 63) {
      const gt = s.indexOf('>', lt + 2);
      tok = { type: 'comment' };
      end = gt < 0 ? n : gt + 1;
    } else {
      i = lt + 1;
      continue;
    }
    flush(lt);
    tok.raw = s.slice(lt, end);
    out.push(tok);
    i = end;
    text = end;
    if (tok.type === 'start' && RAW_TEXT.has(tok.name)) {
      const close = rawEnd(s, i, tok.name);
      const stop = close < 0 ? n : close;
      if (stop > i) out.push({ type: 'text', text: s.slice(i, stop) });
      i = stop;
      text = stop;
    }
  }
  flush(n);
  return out;
}

// The first value of an attribute on a start token, or null.
function attrOf(tok, name) {
  for (const [k, v] of tok.attrs || []) if (k === name) return v;
  return null;
}

// The text of an HTML string. Options, all optional:
//   skip       element names whose whole content is dropped (a skipped element nests by its own name)
//   skipIf     (startToken) => true drops that element and its content the same way
//   skipText   what a dropped element leaves behind (default '')
//   blockTags  element names whose start and end tags leave `blockText` (default ' ')
//   tagText    what any other tag leaves (default '')
//   commentText what a comment leaves (default '')
//   decode     (text) => text, run on each run of text
//   collapse   true: runs of white space become one space and the ends are trimmed
// A skipped element the input ends inside drops the rest of the input. As a browser does, a slash that
// ends a start tag closes nothing on an HTML element that is not void: `<section class="q"/>` opens a
// section that runs to its `</section>`. Only the void elements stand alone. (Inside <svg> or <math> the
// slash does close the element; the tokenizer has no foreign content, PACKET.md § Open.)
function htmlToText(html, opts = {}) {
  const skip = new Set((opts.skip || []).map((x) => String(x).toLowerCase()));
  const { skipIf = null, decode = null } = opts;
  const { skipText = '', blockText = ' ', tagText = '', commentText = '' } = opts;
  const blocks = opts.blockTags ? new Set(opts.blockTags.map((x) => String(x).toLowerCase())) : null;
  let out = '';
  let inside = null;
  let depth = 0;
  for (const t of tokenize(html)) {
    if (inside !== null) {
      if (t.name === inside) {
        if (t.type === 'start') depth += 1;
        else if (t.type === 'end') { depth -= 1; if (depth === 0) inside = null; }
      }
      continue;
    }
    if (t.type === 'text') { out += decode ? decode(t.text) : t.text; continue; }
    if (t.type === 'comment') { out += commentText; continue; }
    if (t.type === 'start' && (skip.has(t.name) || (skipIf && skipIf(t)))) {
      out += skipText;
      if (!VOID.has(t.name)) { inside = t.name; depth = 1; }
      continue;
    }
    out += blocks && blocks.has(t.name) ? blockText : tagText;
  }
  return opts.collapse ? out.replace(/\s+/g, ' ').trim() : out;
}

// A value that builds a RegExp is escaped whole, backslash included (CodeQL js/incomplete-sanitization).
// It lives here because this file requires nothing, so every builder can load it without a cycle.
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A value placed inside a double-quoted attribute is escaped for it: ampersand first, then the double
// quote, less-than and greater-than (CodeQL js/incomplete-html-attribute-sanitization). Same home as
// escapeRegExp, for the same reason; a value with none of the four comes back unchanged.
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = { tokenize, htmlToText, attrOf, escapeRegExp, escapeAttr, VOID, RAW_TEXT };
