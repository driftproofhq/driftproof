// SPDX-License-Identifier: Apache-2.0
//
// The single definition of what counts as a leak.
//
// Two callers scan for the same classes of secret: `tests/gate.js`, which walks
// the working tree at gate time, and `scripts/merge-check.js`, which walks the
// candidate tree read out of the commit before permitting a merge. They must
// agree. Two copies of a deny-list drift, and the copy that quietly stops
// matching still reads as protection — the same argument the acknowledgment
// deny-list bite test already makes, applied to the scanner itself.
//
// Backlog B-8 records four approval records that reached `dev` carrying a host
// path. The recorded cause — "the scan walks tracked files" — is false, and this
// module's existence does not depend on it: `listFiles()` in the repo gate has
// always enumerated untracked files too, and a planted path in an untracked
// evidence record does take the repo gate red. The real window is VANTAGE. An
// approval session measures in a disposable copy made before it writes its
// record into the shared checkout, so the record is simply not in the tree that
// was scanned. Scanning the working tree harder cannot close that. Scanning the
// commit that is about to merge does, and that is what merge-check now uses this
// for.
//
// Patterns are written so a regex literal cannot match its own text: a
// metacharacter or a character class follows each fixed prefix.

const dec = (b64) => JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

// Build-box host + private IP, base64 so the plaintext never lands in a file.
const HOSTIP = dec('WyJpcC0xNzItMzEtNDAtMTU5LmFwLXNvdXRoZWFzdC0xLmNvbXB1dGUuaW50ZXJuYWwiLCIxNzIuMzEuNDAuMTU5Il0=');

const EMAIL_ALLOW = new Set(['example.com', 'example.org', 'driftproofhq.com']);

const PATTERNS = [
  { name: 'home-path', re: /\/home\/[a-z0-9_-]+\/|\/Users\/[A-Za-z0-9_-]+\// },
  { name: 'ec2-internal-host', re: /ip-\d+-\d+-\d+-\d+\.[a-z0-9.-]*compute\.(internal|amazonaws\.com)/i },
  { name: 'private-ip', re: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/ },
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'env-secret-assignment', re: /\b(ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY)\s*=\s*\S+/ },
  // Codex subscription auth material (~/.codex/auth.json contents) must NEVER
  // land in a committed file: the id_token/access_token are JWTs, and an OpenAI
  // secret key is sk-proj-/sk-svcacct-/sk-admin-. We ban the CONTENTS (tokens),
  // not the documented path string (`~/.codex/auth.json` is referenced in help
  // text and docs by design).
  { name: 'jwt-token', re: /\beyJ[A-Za-z0-9_=-]{10,}\.eyJ[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{6,}/ },
  { name: 'openai-secret-key', re: /\bsk-(proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/ },
];

// A path is a hit on its own name, with no content read: a committed .env file
// is a leak whatever it happens to contain.
function scanPath(rel) {
  return /(^|\/)\.env(\.|$)/.test(rel) ? [{ file: rel, kind: 'env-file' }] : [];
}

function scanContent(rel, content) {
  const hits = [];
  for (const p of PATTERNS) {
    const m = content.match(p.re);
    if (m) hits.push({ file: rel, kind: p.name, sample: m[0].slice(0, 24) });
  }
  for (const hv of HOSTIP) if (content.includes(hv)) hits.push({ file: rel, kind: 'build-host-or-ip' });
  const emails = content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [];
  for (const e of emails) {
    const dom = e.split('@')[1].toLowerCase();
    if (!EMAIL_ALLOW.has(dom) && !dom.endsWith('.example')) hits.push({ file: rel, kind: 'email', sample: e });
  }
  return hits;
}

// scanFiles(files, read, readLink) — `read(rel)` returns the file's text, or
// throws/returns null for anything unreadable (binary, deleted, a symlink to
// nowhere), which is skipped exactly as the gate has always skipped it.
//
// `readLink(rel)` is optional and returns a symbolic link's TARGET PATH as a
// string, or null for an entry that is not a link. Where it is supplied, that
// target is scanned as the entry's content through `scanContent`, so every
// pattern above applies to it with no second deny-list to drift (spec 011,
// AC-2). A link's target is a path, and a path is exactly the class of leak the
// `home-path` pattern exists to catch: P-1 shipped `node_modules ->
// /home/<user>/... ` into a public tree past a scan that read the link as an
// unreadable file and skipped it.
//
// The argument is optional so a caller supplying nothing behaves exactly as
// before. That compatibility is deliberate, and it is also the standing risk: a
// caller added later is blind by default. The repo gate asserts that every call
// site supplies a reader, with `scripts/merge-check.js` the one exception — its
// reader is `git show <ref>:<path>`, and git stores a link's blob as its target
// string, so the target already arrives as content there.
function scanFiles(files, read, readLink) {
  const hits = [];
  for (const rel of files) {
    hits.push(...scanPath(rel));
    // The link branch is a single condition on purpose: it is the mutation seam
    // the spec-011 gate neutralises to prove the scanner goes blind without it.
    if (typeof readLink === 'function') {
      let target;
      try { target = readLink(rel); } catch (_e) { target = null; }
      if (typeof target === 'string') {
        hits.push(...scanContent(rel, target));
        continue;
      }
    }
    let c;
    try { c = read(rel); } catch (_e) { continue; }
    if (typeof c !== 'string') continue;
    hits.push(...scanContent(rel, c));
  }
  return hits;
}

module.exports = { PATTERNS, EMAIL_ALLOW, HOSTIP, scanPath, scanContent, scanFiles };
