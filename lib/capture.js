// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 137. WHAT THE JUDGE SEES IS WHAT THE CHILD PRODUCED.
//
// On the two CLI surfaces the child is an agent with tools. Until spec 137 it ran with its
// harness's default tools, its working directory was removed after the call, and only its final
// message reached the judge. A child that wrote its answer to a file and replied "I've written the
// ADR to docs/adr/0001.md" was scored on that sentence. This module holds the two capture modes,
// the workspace collector, the judged answer, and the mechanical reading of an answer the judge
// would not have seen.
//
//   text   (the default) the CLI child runs with its file-writing tools off, and its reply is the
//          answer. claude: --disallowedTools names WRITE_TOOLS. codex: -s read-only, as before.
//   files  the child may write files in its own fresh working directory; after it exits, the
//          regular files there are collected, within WORKSPACE_LIMITS, and appended to its reply as
//          the judged answer. claude: --permission-mode acceptEdits, Bash and Task still off.
//          codex: -s workspace-write. Not offered on an api surface, where nothing can write.
//
// PURE but for collectWorkspace, which reads one directory the caller made. No provider, no clock.
const fs = require('fs');
const path = require('path');

const CAPTURE_MODES = Object.freeze(['text', 'files']);
const DEFAULT_CAPTURE = 'text';

// The claude tools a text-mode child runs without: every built-in that writes a file or runs a
// command that could, and the subagent tool, whose agents carry tools of their own.
const WRITE_TOOLS = Object.freeze(['Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Task']);
// In files mode the child writes through the file tools only, so Bash and Task stay off.
const FILES_MODE_OFF = Object.freeze(['Bash', 'Task']);

function assertMode(mode) {
  if (!CAPTURE_MODES.includes(mode)) {
    throw Object.assign(new Error(`capture: expected one of ${CAPTURE_MODES.join(', ')}, got ${JSON.stringify(mode)}`), { code: 'CAPTURE_MODE' });
  }
  return mode;
}

// The claude -p arguments one mode adds. One element per value, so no tool list is split by a shell.
function claudeCaptureArgs(mode = DEFAULT_CAPTURE) {
  if (assertMode(mode) === 'files') return ['--permission-mode', 'acceptEdits', '--disallowedTools', FILES_MODE_OFF.join(',')];
  return ['--disallowedTools', WRITE_TOOLS.join(',')];
}

// The codex exec sandbox one mode runs under.
function codexSandbox(mode = DEFAULT_CAPTURE) {
  return assertMode(mode) === 'files' ? 'workspace-write' : 'read-only';
}

// What the collector takes from a workspace: the first `files` regular files by path in byte
// order, each whole when it is text of at most `fileBytes` bytes, and at most `totalBytes` bytes
// together. Anything else is named in the judged answer as not included, with the reason.
const WORKSPACE_LIMITS = Object.freeze({ files: 50, fileBytes: 65536, totalBytes: 262144 });

// ── the two collectors ────────────────────────────────────────────────────────────────────────
//
// ISOLATED: the collector runs INSIDE the eval-user hop, as the eval user, after the CLI exits and
// before the wrapper removes the directory, and prints the workspace to stdout after a frame line
// carrying a nonce the parent drew. The parent reads no file the child could have placed (spec 022
// AC-9): every read is the eval user's own. TRUSTED: parent and child are one uid, so the parent
// reads the fresh directory it made, never following a link (collectWorkspace).
const nonceOk = (n) => /^[0-9a-f]{32}$/.test(String(n));
function collectStep(nonce) {
  if (!nonceOk(nonce)) throw new Error('collectStep: the nonce must be 32 hex characters');
  const { files, fileBytes } = WORKSPACE_LIMITS;
  return [
    `printf '\\n%s WORKSPACE\\n' ${nonce}`,
    `find . -type f -print0 2>/dev/null | LC_ALL=C sort -z | head -z -n ${files + 1} | while IFS= read -r -d '' f; do s=$(stat -c %s -- "$f" 2>/dev/null || echo -1); printf '%s FILE %s %s\\n' ${nonce} "$(printf %s "\${f#./}" | base64 -w0)" "$s"; if [ "$s" -ge 0 ] && [ "$s" -le ${fileBytes} ]; then base64 -w0 -- "$f" 2>/dev/null; fi; printf '\\n'; done`,
    `printf '%s END\\n' ${nonce}`,
  ].join('; ');
}

const isText = (buf) => !buf.includes(0) && Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

// One list of entries { path, size, buf|null } in byte order of path, to the judged files.
function admit(entries) {
  const { files, fileBytes, totalBytes } = WORKSPACE_LIMITS;
  let total = 0;
  return entries.map((e, i) => {
    const out = { path: e.path, bytes: e.size };
    if (i >= files) return { ...out, included: false, why: `over the ${files}-file cap` };
    if (!e.buf || e.size > fileBytes) return { ...out, included: false, why: `over the ${fileBytes}-byte file cap` };
    if (e.buf.length !== e.size) return { ...out, included: false, why: 'changed while it was read' };
    if (!isText(e.buf)) return { ...out, included: false, why: 'not text' };
    if (total + e.size > totalBytes) return { ...out, included: false, why: `over the ${totalBytes}-byte total cap` };
    total += e.size;
    return { ...out, included: true, content: e.buf.toString('utf8') };
  });
}

// The parent's half of the isolated collector: the CLI's own stdout, and the files, or null when
// the frame is absent or did not end (the collection did not run to its end).
function parseWorkspace(stdout, nonce) {
  const text = String(stdout || '');
  const head = `\n${nonce} WORKSPACE\n`;
  const at = text.lastIndexOf(head);
  if (!nonceOk(nonce) || at < 0) return { stdout: text, files: null };
  const lines = text.slice(at + head.length).split('\n');
  const entries = [];
  let ended = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === `${nonce} END`) { ended = true; break; }
    const m = new RegExp(`^${nonce} FILE ([A-Za-z0-9+/=]*) (-?\\d+)$`).exec(lines[i]);
    if (!m) return { stdout: text.slice(0, at), files: null };
    const size = Number(m[2]);
    const body = lines[i + 1] === undefined ? '' : lines[i + 1];
    i += 1;
    entries.push({ path: Buffer.from(m[1], 'base64').toString('utf8'), size, buf: size >= 0 && size <= WORKSPACE_LIMITS.fileBytes ? Buffer.from(body, 'base64') : null });
  }
  if (!ended) return { stdout: text.slice(0, at), files: null };
  entries.sort((a, b) => byteOrder(a.path, b.path));
  return { stdout: text.slice(0, at), files: admit(entries) };
}

// The trusted collector: the same files, limits and order, read by the parent from the directory
// it made. A link is never followed and never collected; neither is anything that is not a file.
function collectWorkspace(dir) {
  const found = [];
  const walk = (rel) => {
    let names;
    try { names = fs.readdirSync(path.join(dir, rel)); } catch { return; }
    for (const name of names) {
      const r = rel ? `${rel}/${name}` : name;
      let st;
      try { st = fs.lstatSync(path.join(dir, r)); } catch { continue; }
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) found.push({ path: r, size: st.size });
    }
  };
  walk('');
  found.sort((a, b) => byteOrder(a.path, b.path));
  const { files, fileBytes } = WORKSPACE_LIMITS;
  const entries = found.slice(0, files + 1).map((e) => {
    if (e.size > fileBytes) return { ...e, buf: null };
    let buf = null;
    try {
      const fd = fs.openSync(path.join(dir, e.path), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try { buf = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
    } catch { buf = null; }
    return { ...e, buf };
  });
  return admit(entries);
}

// ── the judged answer ─────────────────────────────────────────────────────────────────────────
//
// The reply, then one block per collected file. With no file it is the reply, byte for byte, so a
// text-mode answer and its generation_hash are what they were before this spec.
const OPEN = (f) => `--- file: ${f.path} (${f.bytes} bytes) ---`;
const CLOSE = (f) => `--- end of file: ${f.path} ---`;
const SKIP = (f) => `--- file: ${f.path} (${f.bytes} bytes, not included: ${f.why}) ---`;
function judgedAnswer(reply, files) {
  const text = String(reply == null ? '' : reply);
  if (!Array.isArray(files) || !files.length) return text;
  const blocks = files.map((f) => (f.included ? `${OPEN(f)}\n${f.content}\n${CLOSE(f)}` : SKIP(f)));
  return `${text}\n\n${blocks.join('\n\n')}`;
}

// The reply a judged answer carries, read with the runner's own file list (the workspace in a
// run, a draw's captured_files in a regrade), never from markers in the answer: a reply that wraps
// its own lines in file markers hides nothing and includes nothing. With no file the answer is the
// reply. With files, the reply is what comes before the exact blocks judgedAnswer appended, each
// included file's content taken by its byte count. Null when the answer does not end in them.
const SKIP_HEAD = (f) => `--- file: ${f.path} (${f.bytes} bytes, not included: `;
function blocksEnd(buf, at, files) {
  let i = at;
  const take = (s) => {
    const b = Buffer.from(s, 'utf8');
    if (!buf.subarray(i, i + b.length).equals(b)) return false;
    i += b.length;
    return true;
  };
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    if (k > 0 && !take('\n\n')) return false;
    if (f.included === true) {
      if (!take(`${OPEN(f)}\n`)) return false;
      i += Number(f.bytes);
      if (!take(`\n${CLOSE(f)}`)) return false;
    } else {
      if (!take(SKIP_HEAD(f))) return false;
      const nl = buf.indexOf(0x0a, i);
      const end = nl < 0 ? buf.length : nl;
      if (!buf.subarray(i, end).toString('utf8').endsWith(') ---')) return false;
      i = end;
    }
  }
  return i === buf.length;
}
function replyOf(answer, files) {
  const text = String(answer == null ? '' : answer);
  if (!Array.isArray(files) || !files.length) return text;
  const buf = Buffer.from(text, 'utf8');
  const first = files[0];
  const head = Buffer.from(`\n\n${first.included === true ? `${OPEN(first)}\n` : SKIP_HEAD(first)}`, 'utf8');
  for (let at = buf.indexOf(head); at >= 0; at = buf.indexOf(head, at + 1)) {
    if (blocksEnd(buf, at + 2, files)) return buf.subarray(0, at).toString('utf8');
  }
  return null;
}

// ── an answer the judge would not have seen (spec 137 R-4, R-5) ────────────────────────────────
//
// Two readings, each a pattern over the reply's own lines, never a model call.
//
// POINTS AT A FILE. A line carries a WRITE word (a past or future form of writing, saving or
// creating) that is a claim (`claims` below) and, after it on the same line, a PATH: either right
// after the word and at most two
// filler words ("Created `a.md`", "wrote the file notes.txt"), or after one of the prepositions
// to, at, in, into, as, under, inside, named, called in the 40 characters before it ("saved it to
// docs/adr/0001.md", "wrote the review to a.md and the summary to b.md"), in the same clause. A PATH is a token that names a file: it holds a slash and ends in a dot and
// an extension, or it is wrapped in backticks or quotes and ends in one, or its extension is one
// of DOC_EXTENSIONS. A URL is never a PATH. The file is included when a collected file's path is
// the token, ends with "/" and the token, or the token ends with "/" and the file's path. A
// pointing line SHOWS its file when a fenced block (``` or ~~~) opens on a later line, before the
// next pointing line or the end of the reply: "I'll create `notes.md` with the following content:"
// and then the file in a fence is an answer the judge sees whole (spec.md R-4).
const WRITE = String.raw`(?:created|wrote|written|saved|generated|drafted|placed|stored|exported|updated|edited|modified|added|appended|(?:will|I'll|I will|going to|let me)\s+(?:now\s+)?(?:create|write|save|generate|draft|place|store|export|update|edit|add|append|put)|put)`;
const WRITE_RE = new RegExp(String.raw`\b${WRITE}\b`, 'gi');
const PREP_RE = /\b(?:to|at|in|into|as|under|inside|named|called)\s+(?:the\s+|a\s+|an\s+|new\s+|this\s+)?(?:file\s+|path\s+|location\s+)?$/i;
const FILLER_RE = /^\s*(?:(?:the|a|an|new|file|following|this)\s+){0,2}$/i;
const DOC_EXTENSIONS = Object.freeze(['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'html', 'xml', 'toml', 'ini', 'log', 'patch', 'diff', 'rst', 'adoc']);
const TOKEN_RE = /(^|[\s(\[{<,;])([`'"]?)((?:~|\.{1,2})?\/?(?:[\w@+-][\w@+.-]*\/)*[\w@+-][\w@+.-]*\.([A-Za-z][A-Za-z0-9]{0,7}))\2(?=$|[\s)\]}>,;:.!?])/g;
function pathTokens(line) {
  const out = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    const start = m.index + m[1].length;
    if (/:\/\/$/.test(line.slice(0, start)) || /^[a-z][\w+.-]*:\/\//i.test(m[3])) continue;
    const quoted = !!m[2];
    const ext = m[4].toLowerCase();
    if (!(m[3].includes('/') || quoted || DOC_EXTENSIONS.includes(ext))) continue;
    out.push({ token: m[3], start });
  }
  return out;
}
// The WRITE word is the child's own claim only where it opens the line (after a bullet, a number or
// a check mark), follows a first-person subject, follows a passive is, are, was, were, been or be,
// or is itself a future form. "the placeholder already added to `.env.example`" in a review of a
// diff is about the task's files, not the child's, and is not a claim (spec.md R-4).
const LINE_START = /^\s*(?:[-*+>]|\d+[.)])?\s*(?:\*\*)?\s*(?:[✅✓✔]\s*)?$/;
const FIRST_PERSON = /\b(?:I|I've|I have|I had|We|We've|We have)\s+(?:(?:also|now|just|then|have)\s+){0,2}$/i;
const PASSIVE = /\b(?:is|are|was|were|been|be)\s+(?:now\s+)?$/i;
const FUTURE = /^(?:will|I'll|I will|going to|let me)\b/i;
// The WRITE word and its PATH are in one clause: no . ! ? : or ; and a space between them. "Added
// comments ... The discount applies to `cart.total`" is a note about code, not a file it wrote.
const CLAUSE_END_RE = /[.!?:;][*_`'")\]]*\s/;
const claims = (before, word) => LINE_START.test(before) || FIRST_PERSON.test(before) || PASSIVE.test(before) || FUTURE.test(word);
function linePointers(line) {
  const out = [];
  const tokens = pathTokens(line);
  if (!tokens.length) return out;
  for (const w of line.matchAll(WRITE_RE)) {
    if (!claims(line.slice(0, w.index), w[0])) continue;
    const after = w.index + w[0].length;
    for (const t of tokens) {
      if (t.start < after) continue;
      if (CLAUSE_END_RE.test(line.slice(after, t.start))) continue;
      const between = line.slice(after, t.start).replace(/[`'"*]+$/, '');
      if (FILLER_RE.test(between) || PREP_RE.test(between.slice(-40))) out.push(t.token);
    }
  }
  return out;
}
function pointedPaths(reply) {
  return [...new Set(String(reply == null ? '' : reply).split('\n').flatMap(linePointers))];
}
// The paths of the pointing lines no fenced block follows. A fence line opens a block only when no
// block is open, so the closer of a block above a pointing line does not show its file.
const FENCE_RE = /^\s*(?:```|~~~)/;
function unshownPaths(reply) {
  const lines = String(reply == null ? '' : reply).split('\n');
  const opens = [];
  let open = false;
  for (const l of lines) {
    const fence = FENCE_RE.test(l);
    opens.push(fence && !open);
    if (fence) open = !open;
  }
  const pointing = lines.map((l, i) => ({ i, paths: linePointers(l) })).filter((p) => p.paths.length);
  const out = [];
  pointing.forEach((p, k) => {
    const next = k + 1 < pointing.length ? pointing[k + 1].i : lines.length;
    if (!opens.slice(p.i + 1, next).some(Boolean)) out.push(...p.paths);
  });
  return [...new Set(out)];
}
const normPath = (p) => String(p).replace(/^\.\//, '');
function isIncluded(p, included) {
  const n = normPath(p);
  return included.some((f) => n === f || n.endsWith(`/${f}`) || f.endsWith(`/${n}`));
}

// ONLY DESCRIBES WORK. The reply carries no fenced block, at least one WORK line, and every other
// non-empty line is a WORK line, a DONE line, a CLOSER line or a short HEADING. A WORK line opens
// (after a bullet, a number or a check mark) with I, I've, I have, I'll, I will, We, We've, We
// have or Let me, and carries a WORK verb. Applied only when the answer includes no file.
const WORK_LINE = /^(?:[-*+>]|\d+[.)])?\s*(?:\*\*)?\s*(?:[✅✓✔]\s*)?(?:I|I've|I have|I'll|I will|We|We've|We have|Let me)\b.*\b(?:creat|writ|wrote|draft|sav|updat|add|generat|made|make|prepar|produc|put|plac|stor|edit|modif|chang|implement|complet|finish|document|commit|fix|refactor|set up)\w*/i;
const DONE_LINE = /^[^\w]*(?:done|all done|complete|completed|finished)[^\w]*$/i;
const CLOSER_LINE = /^[^\w]*(?:let me know|if you(?:'d| would) like|would you like|want me to|shall I|should I|feel free)\b/i;
const HEADING_LINE = /^(?:#{1,6}\s+\S.{0,40}|\*\*[^*]{1,40}\*\*:?)$/;
function describesWorkOnly(reply) {
  const text = String(reply == null ? '' : reply);
  if (/^\s*(```|~~~)/m.test(text)) return false;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.some((l) => WORK_LINE.test(l))) return false;
  return lines.every((l) => WORK_LINE.test(l) || DONE_LINE.test(l) || CLOSER_LINE.test(l) || HEADING_LINE.test(l));
}

// The reading. Null when the judge is shown the answer; else the kind and the reason a lost draw
// carries. `files` is the runner's own list for the draw (none in text capture), so the files the
// answer includes are the ones the runner collected, never ones the reply names in markers.
function lostAnswer(answer, files = []) {
  const list = Array.isArray(files) ? files : [];
  const reply = replyOf(answer, list);
  if (reply === null) return { kind: 'unreadable', reason: 'the answer does not end in the files the run collected, so what the judge was shown cannot be read' };
  const included = list.filter((f) => f.included === true).map((f) => f.path);
  const missing = unshownPaths(reply).filter((p) => !isIncluded(p, included));
  if (missing.length) {
    return { kind: 'points_at_file', paths: missing, reason: `the answer points at a file the judge was not shown (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', and more' : ''})` };
  }
  if (!included.length && describesWorkOnly(reply)) {
    return { kind: 'describes_work', reason: 'the answer only describes work the judge was not shown' };
  }
  return null;
}

// The mode in one plain line, for the receipt summary and the CLI.
function captureLine(capture) {
  const mode = capture && capture.mode;
  if (mode === 'files') return 'answer capture: files (the files the child wrote in its working directory are judged with its reply)';
  if (mode === 'text') return 'answer capture: text (file-writing tools off; the reply is the answer)';
  return 'answer capture: unrecorded (a receipt from before v0.10)';
}

module.exports = {
  CAPTURE_MODES, DEFAULT_CAPTURE, WRITE_TOOLS, FILES_MODE_OFF, WORKSPACE_LIMITS, DOC_EXTENSIONS,
  assertMode, claudeCaptureArgs, codexSandbox, collectStep, parseWorkspace, collectWorkspace,
  judgedAnswer, replyOf, pointedPaths, describesWorkOnly, lostAnswer, captureLine,
};
