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
//   text   (the default) the CLI child runs with no tool that writes a file or runs code, and its
//          reply is the answer. claude: --tools names CLAUDE_TEXT_TOOLS, the built-ins that only
//          read, and --strict-mcp-config loads no MCP server. codex: -s read-only, and every
//          feature in CODEX_TEXT_OFF off with no MCP server (spec 141 R-1).
//   files  the child may write files in its own fresh working directory; after it exits, every
//          regular file there is named, the first WORKSPACE_LIMITS.files read, and appended to its
//          reply as the judged answer. claude: --permission-mode acceptEdits and CLAUDE_FILES_TOOLS,
//          no tool that runs code. codex: -s workspace-write. Not offered on an api surface.
//
// PURE but for collectWorkspace, which reads one directory the caller made. No provider, no clock.
const fs = require('fs');
const path = require('path');

const CAPTURE_MODES = Object.freeze(['text', 'files']);
const DEFAULT_CAPTURE = 'text';

// Spec 141 R-1. An allow list, so a tool a later CLI adds is off unless it is named here. Text: the
// built-in tools that only read. Files: those and the file tools, and nothing that runs code. The
// tools each surface lists, and which of them write or run code, are read from the CLI itself by
// specs/141-lost-answer-narrowing/probes/tool-lists.mjs; this list is checked against that, never
// the other way round.
const CLAUDE_TEXT_TOOLS = Object.freeze(['Read', 'WebFetch', 'WebSearch']);
const CLAUDE_FILES_TOOLS = Object.freeze(['Read', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch']);
// The codex features a text-mode child runs without: every one `codex features list` names that
// writes a file or runs code (codex-cli 0.146.0). Each goes as `-c features.<name>=false`, which a
// codex that does not know the name ignores; `--disable` would refuse it. apply_patch has no feature
// of its own there: the read-only sandbox keeps its writes off.
const CODEX_TEXT_OFF = Object.freeze([
  'apply_patch_freeform', 'apply_patch_streaming_events', 'apps', 'artifact', 'browser_use', 'browser_use_external',
  'browser_use_full_cdp_access', 'chronicle', 'code_mode', 'code_mode_buffered_exec', 'code_mode_host', 'code_mode_only',
  'codex_git_commit', 'computer_use', 'deferred_executor', 'deferred_tool_world_state', 'enable_fanout', 'enable_mcp_apps',
  'exec_permission_approvals', 'executor_capability_discovery', 'external_agent_memory_import', 'goals',
  'guardian_approval', 'guardianv2', 'hooks', 'image_generation', 'in_app_browser', 'js_repl', 'js_repl_tools_only',
  'local_thread_store_compression', 'memories', 'multi_agent', 'multi_agent_mode', 'multi_agent_v2', 'plugin_hooks',
  'plugin_sharing', 'plugins', 'remote_control', 'remote_plugin', 'request_permissions_tool', 'shell_snapshot',
  'shell_tool', 'shell_zsh_fork', 'skill_mcp_dependency_install', 'skill_search', 'tool_suggest',
  'undo', 'unified_exec', 'unified_exec_zsh_fork', 'workspace_dependencies',
]);

function assertMode(mode) {
  if (!CAPTURE_MODES.includes(mode)) {
    throw Object.assign(new Error(`capture: expected one of ${CAPTURE_MODES.join(', ')}, got ${JSON.stringify(mode)}`), { code: 'CAPTURE_MODE' });
  }
  return mode;
}

// The claude -p arguments one mode adds. One element per value, so no tool list is split by a shell.
function claudeCaptureArgs(mode = DEFAULT_CAPTURE) {
  if (assertMode(mode) === 'files') return ['--permission-mode', 'acceptEdits', '--tools', CLAUDE_FILES_TOOLS.join(','), '--strict-mcp-config'];
  return ['--tools', CLAUDE_TEXT_TOOLS.join(','), '--strict-mcp-config'];
}

// The codex exec sandbox one mode runs under.
function codexSandbox(mode = DEFAULT_CAPTURE) {
  return assertMode(mode) === 'files' ? 'workspace-write' : 'read-only';
}

// The codex exec arguments one mode adds after the sandbox. Files capture adds none (spec 137).
function codexCaptureArgs(mode = DEFAULT_CAPTURE) {
  if (assertMode(mode) === 'files') return [];
  return [...CODEX_TEXT_OFF.flatMap((f) => ['-c', `features.${f}=false`]), '-c', 'mcp_servers={}'];
}

// What the collector takes from a workspace: every regular file, named by path in byte order; the
// first `files` read, each whole when it is UTF-8 text of at most `fileBytes` bytes, and at most
// `totalBytes` bytes together. Every other file is named in the judged answer as not included,
// with its own reason (spec 141 R-3), so none is dropped and none is shown as empty.
const WORKSPACE_LIMITS = Object.freeze({ files: 50, fileBytes: 65536, totalBytes: 262144 });

// ── the two collectors ────────────────────────────────────────────────────────────────────────
//
// ISOLATED: the collector runs INSIDE the eval-user hop, as the eval user, after the CLI exits and
// before the wrapper removes the directory, and prints the workspace to stdout after a frame line
// carrying a nonce the parent drew. The parent reads no file the child could have placed (spec 022
// AC-9): every read is the eval user's own. TRUSTED: parent and child are one uid, so the parent
// reads the fresh directory it made, never following a link (collectWorkspace).
//
// The frame: one `<nonce> FILE <base64 path> <size>[ P|U]` line per file, then one line of its
// base64 content (empty when it was not read). P: the collector's user may not read it. U: the
// read failed otherwise. A line without the field reads as spec 137 wrote it. A directory the
// collector's user may not list or enter is one entry, its path ending in "/", size 0 and P
// (A-141-1, F-5): what it holds cannot be named, so the directory is.
const nonceOk = (n) => /^[0-9a-f]{32}$/.test(String(n));
function collectStep(nonce) {
  if (!nonceOk(nonce)) throw new Error('collectStep: the nonce must be 32 hex characters');
  const { files, fileBytes } = WORKSPACE_LIMITS;
  return [
    `printf '\\n%s WORKSPACE\\n' ${nonce}`,
    `i=0; find . -type f -print0 -o ! -path . -type d \\( ! -readable -o ! -executable \\) -prune -printf '%p/\\0' 2>/dev/null | LC_ALL=C sort -z | while IFS= read -r -d '' f; do p=$(printf %s "\${f#./}" | base64 -w0); case "$f" in */) printf '%s FILE %s 0 P\\n\\n' ${nonce} "$p"; i=$((i+1)); continue ;; esac; s=$(stat -c %s -- "$f" 2>/dev/null || echo -1); if [ $i -lt ${files} ] && [ "$s" -ge 0 ] && [ "$s" -le ${fileBytes} ]; then if [ ! -r "$f" ]; then printf '%s FILE %s %s P\\n\\n' ${nonce} "$p" "$s"; elif b=$(base64 -w0 -- "$f" 2>/dev/null); then printf '%s FILE %s %s\\n%s\\n' ${nonce} "$p" "$s" "$b"; else printf '%s FILE %s %s U\\n\\n' ${nonce} "$p" "$s"; fi; else printf '%s FILE %s %s\\n\\n' ${nonce} "$p" "$s"; fi; i=$((i+1)); done`,
    `printf '%s END\\n' ${nonce}`,
  ].join('; ');
}

const isUtf8 = (buf) => Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const UNREADABLE = Object.freeze({ permission: 'permission denied', read: 'read error' });

// One list of entries { path, size, buf|null, unreadable? } in byte order of path, to the judged
// files: one per entry, so every file is named.
function admit(entries) {
  const { files, fileBytes, totalBytes } = WORKSPACE_LIMITS;
  let total = 0;
  return entries.map((e, i) => {
    const out = { path: e.path, bytes: e.size };
    if (i >= files) return { ...out, included: false, why: `over the ${files}-file cap; not read` };
    if (e.size > fileBytes) return { ...out, included: false, why: `truncated: ${e.size} bytes, over the ${fileBytes}-byte file cap; not shown` };
    if (e.size < 0) return { ...out, included: false, why: `unreadable: ${UNREADABLE.read}` };
    if (e.unreadable) return { ...out, included: false, why: `unreadable: ${UNREADABLE[e.unreadable] || UNREADABLE.read}` };
    if (!e.buf) return { ...out, included: false, why: `unreadable: ${UNREADABLE.read}` };
    if (e.buf.length !== e.size) return { ...out, included: false, why: 'changed while it was read' };
    if (e.buf.includes(0)) return { ...out, included: false, why: 'not text: binary (holds a NUL byte)' };
    if (!isUtf8(e.buf)) return { ...out, included: false, why: 'not text: not valid UTF-8' };
    if (total + e.size > totalBytes) return { ...out, included: false, why: `over the ${totalBytes}-byte total cap` };
    total += e.size;
    return { ...out, included: true, content: e.buf.toString('utf8') };
  });
}

// The parent's half of the isolated collector: the CLI's own stdout, and the files, or null when
// the frame is absent or did not end (the collection did not run to its end).
const FLAG = { P: 'permission', U: 'read' };
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
    const m = new RegExp(`^${nonce} FILE ([A-Za-z0-9+/=]*) (-?\\d+)(?: ([PU]))?$`).exec(lines[i]);
    if (!m) return { stdout: text.slice(0, at), files: null };
    const size = Number(m[2]);
    const body = lines[i + 1] === undefined ? '' : lines[i + 1];
    i += 1;
    const unreadable = m[3] ? FLAG[m[3]] : null;
    entries.push({ path: Buffer.from(m[1], 'base64').toString('utf8'), size, unreadable, buf: !unreadable && size >= 0 && size <= WORKSPACE_LIMITS.fileBytes ? Buffer.from(body, 'base64') : null });
  }
  if (!ended) return { stdout: text.slice(0, at), files: null };
  entries.sort((a, b) => byteOrder(a.path, b.path));
  return { stdout: text.slice(0, at), files: admit(entries) };
}

// The trusted collector: the same files, limits, order and reasons, read by the parent from the
// directory it made. A link is never followed and never collected; neither is anything that is
// not a file. A directory it may not list or enter is named as the hop names it (F-5).
const deniedOf = (err) => (err && (err.code === 'EACCES' || err.code === 'EPERM') ? 'permission' : 'read');
function collectWorkspace(dir) {
  const found = [];
  const walk = (rel) => {
    let names;
    try { names = fs.readdirSync(path.join(dir, rel)); } catch (err) { if (rel) found.push({ path: `${rel}/`, size: 0, unreadable: deniedOf(err) }); return; }
    for (const name of names) {
      const r = rel ? `${rel}/${name}` : name;
      let st;
      try { st = fs.lstatSync(path.join(dir, r)); } catch { continue; }
      if (st.isDirectory()) {
        try { fs.accessSync(path.join(dir, r), fs.constants.R_OK | fs.constants.X_OK); } catch (err) { found.push({ path: `${r}/`, size: 0, unreadable: deniedOf(err) }); continue; }
        walk(r);
      } else if (st.isFile()) found.push({ path: r, size: st.size });
    }
  };
  walk('');
  found.sort((a, b) => byteOrder(a.path, b.path));
  const { files, fileBytes } = WORKSPACE_LIMITS;
  const entries = found.map((e, i) => {
    if (i >= files || e.size > fileBytes || e.unreadable) return { ...e, buf: null };
    try {
      const fd = fs.openSync(path.join(dir, e.path), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try { return { ...e, buf: fs.readFileSync(fd) }; } finally { fs.closeSync(fd); }
    } catch (err) {
      return { ...e, buf: null, unreadable: deniedOf(err) };
    }
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

// ── an answer the judge would not have seen (spec 137 R-4, R-5; spec 141 R-5 to R-10) ─────────
//
// Two readings, each a pattern over the reply's own lines, never a model call. A draw is lost only
// when it truly points at a file the judge was not shown, or holds no answer (spec 141).
//
// The reply is read with typographic apostrophes as plain ones, and a file name wrapped in
// emphasis (**, __, *, _, alone or around backticks) as a wrapped token (spec 141 R-9). A line
// inside a fenced block, or a fence line, is never a pointing claim (R-5).
//
// POINTS AT A FILE. A line carries a WRITE word (a past or future form of writing, saving or
// creating) that is a claim (`claims` below) and, after it on the same line, a PATH: either right
// after the word and at most two filler words ("Created `a.md`", "wrote the file notes.txt"), or
// after one of the prepositions to, at, in, into, as, under, inside, named, called in the 40
// characters before it ("saved it to docs/adr/0001.md"), in the same clause. A PATH is a token that
// names a file: it holds a slash and ends in a dot and an extension; or it is wrapped in backticks,
// quotes or emphasis and its extension is one of FILE_EXTENSIONS, so `cart.total` is a code name,
// not a file (R-8); or its extension is one of DOC_EXTENSIONS. A URL is never a PATH. The file is
// included when a collected file's path is the token, ends with "/" and the token, or the token
// ends with "/" and the file's path.
//
// A BARE claim is one made only by opening the line (no first-person subject, no passive, no future
// form): "- Added `src/payments/stripe.js`". It points at a file only when the reply holds no answer
// of its own: no CONTENT line, and no fenced block above its first pointing line. So a commit body
// or a PR description that lists the files it changed is judged, and "Created `CHANGELOG.md` with
// the entry." alone is lost (R-6).
//
// A pointing line SHOWS its file when a fenced block opens on a later line, before the next
// pointing line or the end of the reply (spec 137 R-4), or when the CONTENT lines there hold at
// least PROSE_MIN characters: a summary written to a file and then given in prose is judged on the
// prose (R-7). A line or two about the file does not show it.
const WRITE = String.raw`(?:created|wrote|written|saved|generated|drafted|placed|stored|exported|updated|edited|modified|added|appended|(?:will|I'll|I will|going to|let me)\s+(?:now\s+)?(?:create|write|save|generate|draft|place|store|export|update|edit|add|append|put)|put)`;
const WRITE_RE = new RegExp(String.raw`\b${WRITE}\b`, 'gi');
const PREP_RE = /\b(?:to|at|in|into|as|under|inside|named|called)\s+(?:the\s+|a\s+|an\s+|new\s+|this\s+)?(?:file\s+|path\s+|location\s+)?$/i;
const FILLER_RE = /^\s*(?:(?:the|a|an|new|file|following|this)\s+){0,2}$/i;
const DOC_EXTENSIONS = Object.freeze(['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'html', 'xml', 'toml', 'ini', 'log', 'patch', 'diff', 'rst', 'adoc']);
// The extensions a wrapped token with no slash must carry to name a file (spec 141 R-8).
const FILE_EXTENSIONS = Object.freeze([...DOC_EXTENSIONS,
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs',
  'php', 'pl', 'lua', 'r', 'scala', 'ex', 'exs', 'erl', 'hs', 'ml', 'dart', 'clj', 'groovy', 'vue', 'svelte', 'astro',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'proto', 'tf', 'hcl', 'nix',
  'css', 'scss', 'sass', 'less', 'htm', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'odt',
  'zip', 'tar', 'gz', 'tgz', 'ipynb', 'cfg', 'conf', 'env', 'lock', 'properties', 'gradle', 'mk', 'dockerfile', 'example', 'sample', 'template', 'tex', 'bib', 'org', 'txtx']);
const TOKEN_RE = /(^|[\s(\[{<,;])([`'"]?)((?:~|\.{1,2})?\/?(?:[\w@+-][\w@+.-]*\/)*[\w@+-][\w@+.-]*\.([A-Za-z][A-Za-z0-9]{0,7}))\2(?=$|[\s)\]}>,;:.!?])/g;
function pathTokens(line) {
  const out = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    const start = m.index + m[1].length;
    if (/:\/\/$/.test(line.slice(0, start)) || /^[a-z][\w+.-]*:\/\//i.test(m[3])) continue;
    const quoted = !!m[2];
    const ext = m[4].toLowerCase();
    if (!(m[3].includes('/') || (quoted && FILE_EXTENSIONS.includes(ext)) || DOC_EXTENSIONS.includes(ext))) continue;
    out.push({ token: m[3], start, end: start + m[2].length * 2 + m[3].length });
  }
  return out;
}
// The WRITE word is the child's own claim only where it opens the line (after a bullet, a number or
// a check mark), follows a first-person subject, follows a passive is, are, was, were, been or be,
// or is itself a future form. "the placeholder already added to `.env.example`" in a review of a
// diff is about the task's files, not the child's, and is not a claim (spec 137 R-4).
const LINE_START = /^\s*(?:[-*+>]|\d+[.)])?\s*(?:\*\*)?\s*(?:[✅✓✔]\s*)?$/;
const FIRST_PERSON = /\b(?:I|I've|I have|I had|We|We've|We have)\s+(?:(?:also|now|just|then|have)\s+){0,2}$/i;
const PASSIVE = /\b(?:is|are|was|were|been|be)\s+(?:now\s+)?$/i;
const FUTURE = /^(?:will|I'll|I will|going to|let me)\b/i;
// The WRITE word and its PATH are in one clause: no . ! ? : or ; and a space between them. "Added
// comments ... The discount applies to `cart.total`" is a note about code, not a file it wrote.
const CLAUSE_END_RE = /[.!?:;][*_`'")\]]*\s/;
const claims = (before, word) => LINE_START.test(before) || FIRST_PERSON.test(before) || PASSIVE.test(before) || FUTURE.test(word);
const bareClaim = (before, word) => LINE_START.test(before) && !FIRST_PERSON.test(before) && !PASSIVE.test(before) && !FUTURE.test(word);
// Spec 141 R-9: what the reply means, not how it was typed. A-141-1 (F-6): typographic double
// quotes read as plain ones too, so a file name in them is a quoted token.
const plainQuotes = (s) => s.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
const EMPHASIS_RE = /(^|[^\w*`])(\*{1,3}|_{1,3})(`?)([^\s*`]+\.[A-Za-z][A-Za-z0-9]{0,7})\3\2(?=$|[^\w*`])/g;
const unwrapEmphasis = (line) => line.replace(EMPHASIS_RE, (m, pre, mark, tick, tok) => `${pre}\`${tok}\``);
// A-141-1 (F-7): a bold label that opens the line and carries a WRITE word ("**Created:**",
// "**Files written**:") is a bare claim whose clause runs on past its colon, on every PATH after it
// in that clause; alone on its line, on the PATH that opens each list item under it (readLines).
const LABEL_RE = /^\s*(?:[-*+>]|\d+[.)])?\s*\*\*([^*]{1,40}?)(?::\*\*|\*\*:)(?=\s|$)/;
const WRITE_ONE_RE = new RegExp(String.raw`\b${WRITE}\b`, 'i');
const writeLabel = (line) => { const m = LABEL_RE.exec(line); return m && WRITE_ONE_RE.test(m[1]) ? m[0].length : -1; };
const ITEM_HEAD = /^\s*(?:[-*+]|\d+[.)])\s+$/;
// Each pointer a line makes: { path, bare, at, from, end }: where its claim opens, where its PATH
// opens and ends, on the line as unwrapEmphasis reads it.
function linePointers(raw) {
  const line = unwrapEmphasis(raw);
  const out = [];
  const tokens = pathTokens(line);
  if (!tokens.length) return out;
  const label = writeLabel(line);
  for (const t of tokens) if (label >= 0 && t.start >= label && !CLAUSE_END_RE.test(line.slice(label, t.start))) out.push({ path: t.token, bare: true, at: 0, from: t.start, end: t.end });
  for (const w of line.matchAll(WRITE_RE)) {
    if (w.index < label) continue;
    if (!claims(line.slice(0, w.index), w[0])) continue;
    const bare = bareClaim(line.slice(0, w.index), w[0]);
    const after = w.index + w[0].length;
    for (const t of tokens) {
      if (t.start < after) continue;
      if (CLAUSE_END_RE.test(line.slice(after, t.start))) continue;
      const between = line.slice(after, t.start).replace(/[`'"*]+$/, '');
      if (FILLER_RE.test(between) || PREP_RE.test(between.slice(-40))) out.push({ path: t.token, bare, at: w.index, from: t.start, end: t.end });
    }
  }
  return out;
}
// The reply's lines, which of them are fenced (a fence line or inside a block), where a block opens
// (a fence line opens a block only when no block is open), and each unfenced line's pointers.
const FENCE_RE = /^\s*(?:```|~~~)/;
function readLines(reply) {
  const lines = plainQuotes(String(reply == null ? '' : reply)).split('\n');
  const fenced = [];
  const opens = [];
  let open = false;
  for (const l of lines) {
    const fence = FENCE_RE.test(l);
    opens.push(fence && !open);
    fenced.push(fence || open);
    if (fence) open = !open;
  }
  const per = lines.map((l, i) => (fenced[i] ? [] : linePointers(l)));
  // A WRITE label alone on its line (F-7) claims the PATH that opens each list item under it, to the
  // first line that is neither blank nor an item.
  for (let i = 0; i < lines.length; i++) {
    const u = fenced[i] ? '' : unwrapEmphasis(lines[i]);
    const at = writeLabel(u);
    if (at < 0 || u.slice(at).trim()) continue;
    for (let j = i + 1; j < lines.length && !fenced[j]; j++) {
      if (!lines[j].trim()) continue;
      const item = unwrapEmphasis(lines[j]);
      const t = pathTokens(item)[0];
      if (!t || !ITEM_HEAD.test(item.slice(0, t.start))) break;
      per[j] = [...per[j], { path: t.token, bare: true, at: 0, from: t.start, end: t.end }];
    }
  }
  return { lines, fenced, opens, per };
}
// Every path a line outside a fence points at, bare claims included: the reading before R-6, R-7
// and the fence rule.
function pointedPaths(reply) {
  return [...new Set(readLines(reply).per.flat().map((p) => p.path))];
}

// A CONTENT line: part of an answer of the reply's own, rather than a report of work, a closing
// line, a heading, or a line that only describes a file (spec 141 R-6).
const DESCRIBE_LINE = /^(?:[-*+>]|\d+[.)])?\s*(?:it|this|that|these|the (?:file|document|doc|adr|report|summary|review|note|notes|changelog|readme))\s+(?:covers|contains|includes|records|documents|explains|lists|outlines|summari[sz]es|describes|details|captures|has|holds)\b/i;
const PROSE_MIN = 200;
const isContent = (raw) => {
  const l = raw.trim();
  return !!l && !WORK_LINE.test(l) && !DONE_LINE.test(l) && !CLOSER_LINE.test(l) && !HEADING_LINE.test(l) && !DESCRIBE_LINE.test(l);
};
function proseLength(lines, fenced, per, from, to) {
  let n = 0;
  for (let i = from; i < to; i++) if (!fenced[i] && !per[i].length && isContent(lines[i])) n += lines[i].trim().length;
  return n;
}
// A-141-1 (F-2): what a pointing line says outside its pointing clauses, as prose on each side: the
// text before the clause of its first claim, and the text after the clause of its last PATH.
const CLAUSE_ENDS_RE = new RegExp(CLAUSE_END_RE.source, 'g');
function sideProse(raw, ps) {
  const line = unwrapEmphasis(raw);
  const from = Math.min(...ps.map((p) => p.at));
  const to = Math.max(...ps.map((p) => p.end));
  let head = 0;
  for (const m of line.slice(0, from).matchAll(CLAUSE_ENDS_RE)) head = m.index + m[0].length;
  const m = CLAUSE_END_RE.exec(line.slice(to));
  const prose = (s) => (isContent(s) ? s.trim().length : 0);
  return { before: prose(line.slice(0, head)), after: m ? prose(line.slice(to + m.index + m[0].length)) : 0 };
}
// A-141-1 (F-1): the window above a pointing line, from the line after the previous pointing line
// (or the reply's start) to it, shows its file when its CONTENT, with the line's own text before
// its claim, holds PROSE_MIN characters; when a fenced block opens there and the claim refers back
// to it ("I saved this to ...": the file's content is in the answer); when the line is in a list
// under a CHANGES label below an answer of the reply's own; and in a reply that opens with a commit
// subject, whose pointing lines are the commit's list of the files it changed.
const REFER_BACK_RE = /\b(?:this|these|that|it|them|above)\b/i;
const CHANGES_LABEL = /^(?:#{1,6}\s+)?(?:\*\*)?(?:changes|changes made|changed files|files changed|what changed|summary of changes)(?::\*\*|\*\*:|\*\*|:)?$/i;
const COMMIT_SUBJECT = /^(?:[a-z]+(?:\([^)]*\))?!?: \S.*|(?:Add|Adds|Allow|Avoid|Bump|Change|Clean|Create|Disable|Document|Drop|Enable|Ensure|Extract|Fix|Handle|Implement|Improve|Introduce|Merge|Move|Prevent|Refactor|Reject|Remove|Rename|Replace|Return|Revert|Simplify|Split|Support|Update|Upgrade|Use|Validate)\s\S.*)$/;
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;
function opensWithCommitSubject(lines, fenced, per) {
  const i = lines.findIndex((l) => l.trim());
  if (i < 0 || fenced[i] || per[i].length || i + 1 >= lines.length || lines[i + 1].trim()) return false;
  const l = lines[i].trim();
  return l.length <= 72 && !/[.:]$/.test(l) && COMMIT_SUBJECT.test(l);
}
function shownAbove(lines, fenced, opens, per, pointing, k) {
  if (opensWithCommitSubject(lines, fenced, per)) return true;
  const p = pointing[k];
  const from = k > 0 ? pointing[k - 1].i + 1 : 0;
  if (proseLength(lines, fenced, per, from, p.i) + sideProse(lines[p.i], per[p.i]).before >= PROSE_MIN) return true;
  const u = unwrapEmphasis(lines[p.i]);
  if (opens.slice(from, p.i).some(Boolean) && per[p.i].some((q) => REFER_BACK_RE.test(u.slice(q.at, q.from)))) return true;
  let top = p.i;
  while (top > 0 && !fenced[top - 1] && (!lines[top - 1].trim() || per[top - 1].length || LIST_LINE.test(lines[top - 1]))) top -= 1;
  if (top === 0 || fenced[top - 1] || !CHANGES_LABEL.test(lines[top - 1].trim())) return false;
  return lines.slice(0, top - 1).some((l, i) => opens[i] || (!fenced[i] && !per[i].length && isContent(l)));
}
// The paths of the pointing lines the reply does not show.
function unshownPaths(reply) {
  const { lines, fenced, opens, per } = readLines(reply);
  const first = per.findIndex((ps) => ps.length);
  const own = lines.some((l, i) => !fenced[i] && !per[i].length && isContent(l)) || (first > 0 && opens.slice(0, first).some(Boolean));
  const pointing = per.map((ps, i) => ({ i, paths: ps.filter((p) => !p.bare || !own).map((p) => p.path) })).filter((p) => p.paths.length);
  const out = [];
  pointing.forEach((p, k) => {
    const next = k + 1 < pointing.length ? pointing[k + 1].i : lines.length;
    if (proseLength(lines, fenced, per, p.i + 1, next) + sideProse(lines[p.i], per[p.i]).after >= PROSE_MIN) return;
    if (shownAbove(lines, fenced, opens, per, pointing, k)) return;
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
// have or Let me, and carries a WORK verb. The subject is followed by a space and not by a word of
// advice, so "I'd add an index" and "I would add a retry" are answers (spec 141 R-10). Applied only
// when the answer includes no file.
const WORK_SUBJECT = String.raw`(?:I've|I have|I'll|I will|We've|We have|Let me|I|We)(?=\s)(?!\s+(?:would|could|should|might|may|can|recommend|suggest|propose|think|believe)\b)`;
const WORK_LINE = new RegExp(String.raw`^(?:[-*+>]|\d+[.)])?\s*(?:\*\*)?\s*(?:[✅✓✔]\s*)?${WORK_SUBJECT}.*\b(?:creat|writ|wrote|draft|sav|updat|add|generat|made|make|prepar|produc|put|plac|stor|edit|modif|chang|implement|complet|finish|document|commit|fix|refactor|set up)\w*`, 'i');
const DONE_LINE = /^[^\w]*(?:done|all done|complete|completed|finished)[^\w]*$/i;
const CLOSER_LINE = /^[^\w]*(?:let me know|if you(?:'d| would) like|would you like|want me to|shall I|should I|feel free)\b/i;
const HEADING_LINE = /^(?:#{1,6}\s+\S.{0,40}|\*\*[^*]{1,40}\*\*:?)$/;
// A-141-1 (F-2): a WORK line whose text after its first clause holds PROSE_MIN characters of
// CONTENT carries an answer on the line ("I wrote the summary to SUMMARY.md. In short: ...").
const tailProse = (l) => { const m = CLAUSE_END_RE.exec(l); const t = m ? l.slice(m.index + m[0].length) : ''; return isContent(t) ? t.trim().length : 0; };
function describesWorkOnly(reply) {
  const text = plainQuotes(String(reply == null ? '' : reply));
  if (/^\s*(```|~~~)/m.test(text)) return false;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => WORK_LINE.test(l) && tailProse(l) >= PROSE_MIN)) return false;
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
  CAPTURE_MODES, DEFAULT_CAPTURE, CLAUDE_TEXT_TOOLS, CLAUDE_FILES_TOOLS, CODEX_TEXT_OFF, WORKSPACE_LIMITS, DOC_EXTENSIONS, FILE_EXTENSIONS,
  assertMode, claudeCaptureArgs, codexSandbox, codexCaptureArgs, collectStep, parseWorkspace, collectWorkspace,
  judgedAnswer, replyOf, pointedPaths, describesWorkOnly, lostAnswer, captureLine,
};
