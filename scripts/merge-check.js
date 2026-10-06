#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Merge precondition (DECISIONS #12). Refuses a merge unless the spec's
// evidence/ contains an approval record whose `commit:` field is EXACTLY the SHA
// being merged.
//
// Why this is a script and not a rule in a document: DECISIONS #4 already stated
// the rule and #5 already recorded one violation of it. It was violated a second
// time by a session that had read both. A rule that has to be remembered at the
// moment of merging is a rule that fails under momentum; a check either passes or
// it does not.
//
//   node scripts/merge-check.js <spec-dir>                  # checks git HEAD
//   node scripts/merge-check.js <spec-dir> --dry-run --head <sha>
//
// Exit 0 = an approval names this exact SHA, with a clean tree, a non-rejected
// verdict, and NO unresolved blocking findings. Exit 1 = anything else, including
// a missing record, an unreadable one, or a record naming a different commit.
//
// A LAYOUT OR VISUAL SPEC IS APPROVED ON THE BROWSER CHECKS' CURRENT RESULTS (spec 129). When the diff of
// the spec against its Base changes a layout path, the approval counts only when a visual receipt good
// for the subject is committed and a matching record cites it by file name; see the section below.
//
// There is deliberately no --force: bypassing is `git merge` without running this,
// which is at least visible in the RUNBOOK diff rather than hidden behind a flag.
// `--head` exists for testing only and requires `--dry-run`, because a
// caller-supplied SHA is otherwise the bypass the missing --force was meant to
// prevent (approval finding, 2026-08-19).
//
// ORDER IS NOT SUBSTANCE. An `approved-with-findings` verdict with a BLOCKING
// finding outstanding is not a mergeable approval — that is precisely what
// DECISIONS #12 was about — so the record must carry `blocking_findings:` and it
// must resolve to zero. A record without the field is refused rather than assumed
// clean: fail-safe default.
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Approvals are read from a COMMIT, never from the working tree (C-F6). Reading
// the checkout accepted a record that git does not have: `git rm --cached` the
// file, leave it on disk, and the merge passed on evidence that would vanish the
// moment anyone else cloned the branch. What merges is what is committed, so that
// is what the guard reads. `ref` defaults to HEAD — the evidence commit that
// carries the record, which is exactly where a compliant record lands under the
// DECISIONS #4 two-commit pattern.
function approvalsIn(specDir, ref = 'HEAD', root = ROOT) {
  const dir = `${specDir}/evidence`;
  let listing;
  try {
    // D-F4: NOT `-r`. Recursing accepted a record filed under `evidence/archive/`,
    // where records are parked precisely because they no longer apply. The
    // approval that governs a merge sits directly in `evidence/`, one level, the
    // same set a reader sees when they open the directory.
    listing = execFileSync('git', ['ls-tree', '--name-only', ref, '--', `${dir}/`],
      { cwd: root, encoding: 'utf8' });
  } catch (e) {
    return [];
  }
  return listing.trim().split('\n').filter(Boolean)
    .filter((f) => /^approval-.*\.md$/.test(path.basename(f)))
    .map((full) => {
      const f = path.basename(full);
      const text = execFileSync('git', ['show', `${ref}:${full}`], { cwd: root, encoding: 'utf8' });
      return approvalFields(text, f);
    });
}

// The gate receipts an approval record names, by file name, each once, in the order the text names them (spec 115).
// The driver and the integrator read the same definition: `receiptNamed` is the first of them.
const receiptsNamed = (text) => [...new Set(String(text).match(/gate-\d{8}T\d{6}Z\.json/g) || [])];
const receiptNamed = (text) => receiptsNamed(text)[0] || null;

// The fields an approval record carries, parsed out of its text. Extracted
// because TWO gates now read a record: the merge gate below, and the T1 spend
// gate in `scripts/run-report-006.js`, which refused to run without an approval
// but never read one (approval finding F-009-H). A second parser would be a
// second definition of what an approval says, and two definitions drift.
function approvalFields(text, file = '<record>') {
  const field = (name) => {
    const m = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : null;
  };
  return {
    file, commit: field('commit'), verdict: field('verdict'), tree: field('tree'),
    blocking: field('blocking_findings'),
    receipt: receiptNamed(text), receipts: receiptsNamed(text),
  };
}

// What makes a parsed record an approval OF `head`. Returns [] when it is one.
// The checks are the ones stated at the top of this file, in one place, so the
// spend gate and the merge gate cannot disagree about which records count.
function approvalProblems(a, head) {
  const problems = [];
  if (a.commit !== head) problems.push(`${a.file} names commit ${a.commit || 'none'}, not ${head}`);
  if (a.verdict && /^(rejected|changes-requested)/i.test(a.verdict)) problems.push(`${a.file} names this SHA but its verdict is "${a.verdict}"`);
  if (a.tree && a.tree !== 'clean') problems.push(`${a.file} approved a tree recorded as "${a.tree}"`);
  if (a.blocking == null) {
    problems.push(`${a.file} carries no "blocking_findings:" field — an approval must state whether anything blocking is outstanding, and a missing field is refused rather than assumed zero`);
  } else if (!/^(0|none)$/i.test(a.blocking.trim())) {
    problems.push(`${a.file} records blocking_findings: ${a.blocking} — resolve them and re-approve`);
  }
  return problems;
}

// The gate receipt an approval cites as its own must be of the commit the approval names (spec 115). An approval
// that read its figures from a receipt of an older commit read a tree that is not the one being merged: the
// figures it recorded are not the merge's, and the merge stops on them later, or does not (067 and 068, 27 Sep
// 2026). A record may name more than one receipt (fix-loop evidence it read, then its own), so the record is
// refused only when NONE of the receipts it names is of the approved commit (A-115-1: reading the first one
// refused 030's record, which cites its own second). A record that names none is not refused here. A receipt
// that is not committed under evidence/ at `ref`, or cannot be parsed, is not of the commit: absence is not a
// match. A receipt's `subject` is the commit it gated, evidence-only commits above it walked back; a receipt
// without one is read by its `commit`. The refusal names the approved commit and every receipt's commit in full.
function gateReceiptProblems(a, specDir, ref = 'HEAD', root = ROOT) {
  const names = a.receipts || (a.receipt ? [a.receipt] : []);
  if (!names.length) return [];
  const read = [];
  for (const name of names) {
    let r;
    try {
      r = JSON.parse(execFileSync('git', ['show', `${ref}:${specDir}/evidence/${name}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
      read.push(`${name} (not a readable receipt committed under ${specDir}/evidence/ at ${ref})`);
      continue;
    }
    const gated = r && (r.subject || r.commit);
    if (gated && gated === a.commit) return [];
    read.push(`${name} (a gate receipt of ${gated || 'no commit'})`);
  }
  return [`${a.file} approves ${a.commit} but none of the gate receipts it cites is of that commit: ${read.join('; ')}. The figures it read are not of the commit being merged`];
}

// DECISIONS #4's two-commit pattern: a CODE commit carrying the change, then an
// EVIDENCE commit carrying the receipt that pins it (a receipt records the commit
// it gated, so it cannot live inside that commit). The approval record itself
// lands the same way. So the tip of an approved branch is normally an evidence
// commit that no approval can name — checking the raw tip would refuse every
// correctly-approved merge, which is a guard nobody can comply with.
//
// The SUBJECT commit is therefore the tip with any trailing evidence-only commits
// walked back. An evidence-only commit touches nothing outside `specs/*/evidence/`;
// the moment a commit touches code, spec text, or a gate, it is the subject and
// the walk stops. Evidence cannot smuggle a change past the check.
function resolveSubject(head, root = ROOT) {
  const shas = execFileSync('git', ['rev-list', '--max-count=25', head], { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  const skipped = [];
  for (const sha of shas) {
    const files = execFileSync('git', ['show', '--pretty=format:', '--name-only', sha], { cwd: root, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const evidenceOnly = files.length > 0 && files.every((f) => /^specs\/[^/]+\/evidence\//.test(f));
    if (!evidenceOnly) return { subject: sha, skipped };
    skipped.push(sha);
  }
  return { subject: head, skipped };
}

// ── an approval-record commit touches nothing else (spec 015 AC-8) ──────────
//
// DECISIONS #4's two-commit pattern, made a control rather than a convention. It
// is not hypothetical: `44c4a60` carried `specs/011/.../approval-20260829T074054Z.md`
// alongside `gate.sh`, `plan.md`, `spec.md` and `tasks.md`, and `1db61dd` carried
// an 010 record alongside `DECISIONS.md`, two libraries, a gate and two spec
// files. The rule was written down twice and checked never.
//
// WHY IT MATTERS BEYOND TIDINESS. `resolveSubject` walks back evidence-only
// commits to find the SHA an approval must name. A record riding inside a code
// commit means the approval and the thing it approves moved together, in one
// step, by one hand — which is the separation of generation and approval
// dissolving into a commit message.
//
// THE SCOPE IS THE RANGE A MERGE WOULD BRING IN, not the tip. A guard reading
// only HEAD passes a violation two commits back, and the range is exactly the
// set of commits the merge is about.
const APPROVAL_RECORD = /^specs\/[^/]+\/evidence\/approval-[^/]*\.md$/;

function approvalCommitProblems(base, head, root = ROOT) {
  let shas;
  try {
    shas = execFileSync('git', ['rev-list', `${base}..${head}`], { cwd: root, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
  } catch (e) {
    return [`cannot read the commit range ${base}..${head}: ${e.message}`];
  }
  const problems = [];
  for (const sha of shas) {
    const files = execFileSync('git', ['show', '--pretty=format:', '--name-only', sha], { cwd: root, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const records = files.filter((f) => APPROVAL_RECORD.test(f));
    if (!records.length) continue;
    const others = files.filter((f) => !APPROVAL_RECORD.test(f));
    if (!others.length) continue;
    // FULL SHA, for the reason the gate already holds elsewhere: a truncated one
    // in a refusal is unreadable the moment two of them differ only in format.
    problems.push(`${sha} commits an approval record (${records[0]}) alongside ${others.length} other file(s): ${others.slice(0, 4).join(', ')}${others.length > 4 ? ', …' : ''}`);
  }
  return problems;
}

function mergeCheck(specDir, head, ref = 'HEAD', root = ROOT) {
  const approvals = approvalsIn(specDir, ref, root);
  const matched = approvals.filter((a) => a.commit === head);
  const problems = [];
  if (!approvals.length) problems.push(`no approval record committed under ${specDir}/evidence/ at ${ref} (an uncommitted record on disk does not count)`);
  else if (!matched.length) {
    // FULL SHAs: truncating both sides prints "no approval names 9a363ba —
    // records name: 9a363ba" when the mismatch is a format difference.
    problems.push(`no approval names ${head} — records name: ${approvals.map((a) => `${a.commit || 'none'} (${a.file})`).join(', ')}`);
  }
  // A rejected verdict is not an approval, whatever SHA it names. `matched`
  // already carries the SHA, so the commit check inside is a no-op here; it is
  // what the spend gate needs from the same function.
  for (const a of matched) problems.push(...approvalProblems(a, head));
  for (const a of matched) problems.push(...gateReceiptProblems(a, specDir, ref, root));
  return { ok: problems.length === 0, head, approvals, matched, problems };
}

// ── a layout or visual change owes the browser checks before its approval (spec 129) ───────────────
//
// Spec 125's approvals passed three times without the browser captures, which only ran at merge, so a
// layout spec was approved without its layout ever being measured. This section is the one place that
// answers four questions, for the driver (scripts/drive.mjs) and for the merge check below, so the two
// cannot disagree. It lives in this file, not beside it, because the specs' scratch repositories copy
// this file alone: a guard that needed a second file would fail open or closed in every one of them.
//
//   1. Is the change a layout or visual one? Decided from the spec's diff against its Base with
//      LAYOUT_PATHS. Nothing the spec or its queue entry says changes the answer.
//   2. Which gates take a browser capture, and which of them must run? A BROWSER GATE is one whose
//      gate.sh sources scripts/browser-lock.sh (spec 051's rule; the sweep's SOURCES_HELPER, held
//      equal by spec 129's gate). The spec's own gate, if it is one, and every other browser gate that
//      reads a changed path. A gate whose captures are taken outside it names its taker in
//      specs/000-governance/capture-takers.txt.
//   3. What does the run leave? A VISUAL RECEIPT, specs/<id>/evidence/visual-<UTC stamp>.json, written
//      by the driver: each gate run as `gate.sh --final`, with its rows.
//   4. Is a receipt good for a commit? receiptProblems(): at that commit, every gate expected, each
//      run `--final`, every row a pass, the gate file the one the commit carries.
//
// Everything is read from a git ref, never from a working tree: what merges is what is committed.
// The paths a layout or visual change touches. Anything under docs/ that renders (the pages, the
// style sheets, the page scripts, the plots, cards, fonts and images), the builders and page
// templates under scripts/ that write those pages, and the renderers of the plot, the card and the
// view page. A path that is not listed here is not layout; a path that is, is, whatever the spec says.
const LAYOUT_PATHS = [
  /^docs\/.*\.(css|html|js|svg|png|woff2?)$/,
  /^docs\/(plots|cards|fonts|assets|textures|islands|badges)\//,
  /^scripts\/(site-chrome|build-site-pages|build-receipt-pages|build-head-tags|answer-pages|apply-receipt-links|receipt-links|report-answers|build-report-baselines|site-data|build-facts|band-plot|render-check|build-report-001|prepare-report(-\d+)?)\.(js|mjs)$/,
  /^scripts\/build-og-card\.py$/,
  /^lib\/(band-plot|badge-svg|view|view-tokens)\.js$/,
];
const isLayoutPath = (p) => LAYOUT_PATHS.some((re) => re.test(p));

// The line of a gate that sources the browser lock: a sourcing line, not a comment naming the helper.
// Spec 029's sweep reads a browser gate the same way (probes/sweep.mjs SOURCES_HELPER); spec 129's
// gate holds the two patterns equal.
const SOURCES_HELPER = /^[ \t]*(\.|source)[ \t]+[^\n#]*scripts\/browser-lock\.sh\b/m;
const isBrowserGateText = (text) => SOURCES_HELPER.test(text);
// The same pattern for `git grep -E`, which has no \t, \n or \b.
const SOURCES_HELPER_ERE = '^[[:space:]]*(\\.|source)[[:space:]]+[^#]*scripts/browser-lock\\.sh([^A-Za-z0-9_]|$)';

const TAKERS_FILE = 'specs/000-governance/capture-takers.txt';
const RECEIPT_RE = /^visual-\d{8}T\d{6}Z\.json$/;

function gitOut(root, args, opts = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

// The Base a spec's header names: the 40-character sha after `**Base:** <branch> at`, at `ref`. The
// form spec 070's baseSha reads; the line may also carry the Loop and Branch lines' text.
function specBase(root, ref, spec) {
  let text;
  try { text = gitOut(root, ['show', `${ref}:specs/${spec}/spec.md`]); } catch { return null; }
  const m = /\*\*Base:\*\*\s*`[^`]+` at `([0-9a-f]{40})`/.exec(text);
  return m ? m[1] : null;
}

// Where `ref` left the integration branch: `git merge-base` with origin/dev, then with dev; null
// when neither resolves, which leaves the header (or the caller's own Base) to be read instead.
function branchPoint(root, ref) {
  for (const dev of ['origin/dev', 'dev']) {
    try {
      const sha = gitOut(root, ['merge-base', dev, ref]).trim();
      if (/^[0-9a-f]{40}$/.test(sha)) return sha;
    } catch { /* that ref is not here */ }
  }
  return null;
}

// The layout paths the spec's diff against its Base changes (the branch's own changes: the merge
// base of the two, to `ref`). Throws when the diff cannot be read: that is not "no layout change".
function layoutChanges(root, base, ref) {
  return lines(gitOut(root, ['diff', '--name-only', `${base}...${ref}`])).filter(isLayoutPath).sort();
}

// The ids of the specs whose gate.sh, at `ref`, is a browser gate.
function browserGates(root, ref) {
  let out = '';
  try { out = gitOut(root, ['grep', '-l', '-E', '-e', SOURCES_HELPER_ERE, ref, '--', 'specs/*/gate.sh']); } catch (e) { if (e.status !== 1) throw e; }
  return lines(out).map((l) => /^[^:]+:specs\/([^/]+)\/gate\.sh$/.exec(l)).filter(Boolean).map((m) => m[1]).sort();
}

// What reading a path looks like in a gate's text: the path, its file name, and for a page under
// docs/ the directory it sits in (a gate reads the built site wholesale).
function needlesFor(paths) {
  const n = new Set();
  for (const p of paths) {
    n.add(p); n.add(path.posix.basename(p));
    if (p.startsWith('docs/')) n.add(`${path.posix.dirname(p)}/`);
  }
  return [...n];
}
// The changed paths a gate reads, by its text (gate.sh and probes/) at `ref`: those with a needle the
// text carries. Empty when the gate reads none. One `git grep -o` per gate, however many paths changed.
function gateReads(root, ref, id, changed) {
  const needles = needlesFor(changed);
  let out = '';
  try {
    out = gitOut(root, ['grep', '-o', '-h', '-F', ...needles.flatMap((n) => ['-e', n]), ref, '--', `specs/${id}/gate.sh`, `specs/${id}/probes`]);
  } catch (e) { if (e.status !== 1) throw e; }
  const seen = new Set(lines(out));
  return changed.filter((p) => needlesFor([p]).some((n) => seen.has(n)));
}

// specs/000-governance/capture-takers.txt: `<spec id> <bash|node> <script under specs/<id>/> [args]`.
// A line that is anything else is an error, so a registry that cannot be read is not read as empty.
function parseTakers(text) {
  const takers = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [id, ...cmd] = line.split(/\s+/);
    if (!/^[0-9a-z][0-9a-z-]*$/.test(id) || !['bash', 'node'].includes(cmd[0]) || !cmd[1] || !cmd[1].startsWith(`specs/${id}/`) || cmd[1].includes('..')) {
      throw new Error(`${TAKERS_FILE}: ${JSON.stringify(raw.trim())} is not "<spec id> <bash|node> specs/<spec id>/<script> [args]"`);
    }
    takers[id] = cmd;
  }
  return takers;
}
function takersAt(root, ref) {
  let text;
  try { text = gitOut(root, ['show', `${ref}:${TAKERS_FILE}`]); } catch { return {}; }
  return parseTakers(text);
}

// What a spec owes. `base` is the Base the caller holds (the driver's own record, which a spec's
// header cannot change); the spec's header Base is read first only where the caller has none.
//   { layout, base, changed, gates: [{ spec, role: 'own'|'sibling', reads }], taker }
function visualScope(root, { spec, ref = 'HEAD', base = null }) {
  const b = base || specBase(root, ref, spec);
  if (!b) throw new Error(`no Base for spec ${spec}: the caller gave none and its spec.md at ${ref} names none`);
  const changed = layoutChanges(root, b, ref);
  if (!changed.length) return { layout: false, base: b, changed: [], gates: [], taker: null };
  const browser = browserGates(root, ref);
  const gates = [];
  if (browser.includes(spec)) gates.push({ spec, role: 'own', reads: changed });
  for (const id of browser) {
    if (id === spec) continue;
    const reads = gateReads(root, ref, id, changed);
    if (reads.length) gates.push({ spec: id, role: 'sibling', reads });
  }
  const taker = takersAt(root, ref)[spec] || null;
  return { layout: true, base: b, changed, gates, taker };
}

// ── the receipt ─────────────────────────────────────────────────────────────────────────────────

// What the driver writes after running a scope's gates. `ran` is, per gate, { spec, role, reads,
// cmd, exit, rows, gate_sha, taker }. Nothing here is typed: each value is read from the run.
function buildReceipt({ spec, scope, ran, commit, subject, timestamp }) {
  return {
    type: 'visual-receipt',
    spec, timestamp, commit, subject, base: scope.base, layout_paths: scope.changed,
    gates: ran.map((g) => ({
      spec: g.spec, role: g.role, reads: g.reads, gate_sha: g.gate_sha, taker: g.taker || null, cmd: g.cmd, exit: g.exit,
      passed: g.rows.filter((r) => r.result === 'pass').length,
      failed: g.rows.filter((r) => r.result !== 'pass').length,
      rows: g.rows,
    })),
  };
}

// Why a receipt is not good for `subject`. `ctx`: { spec, subject, base, expected: [ids], blobOf(id) }.
// [] when it is. Each reading is its own line, so a refusal says which.
function receiptProblems(r, ctx) {
  const p = [];
  if (!r || r.type !== 'visual-receipt') return ['it is not a visual receipt'];
  if (r.spec !== ctx.spec) p.push(`it is for spec ${r.spec}, not ${ctx.spec}`);
  if (r.subject !== ctx.subject) p.push(`it was taken at ${r.subject || 'no commit'}, the subject is ${ctx.subject}`);
  if (ctx.base && r.base !== ctx.base) p.push(`it was taken against Base ${r.base || 'none'}, the spec's Base is ${ctx.base}`);
  const gates = Array.isArray(r.gates) ? r.gates : [];
  for (const id of ctx.expected) {
    const g = gates.find((x) => x && x.spec === id);
    if (!g) { p.push(`it has no run of ${id}'s gate, which a changed path reaches`); continue; }
    if (!Array.isArray(g.cmd) || !g.cmd.includes('--final')) p.push(`${id}'s gate was not run with --final, so its capture rows did not run`);
    if (g.exit !== 0) p.push(`${id}'s gate exited ${g.exit}`);
    const rows = Array.isArray(g.rows) ? g.rows : [];
    if (!rows.length) p.push(`${id}'s run carries no rows`);
    else if (rows.some((x) => x.result !== 'pass') || g.failed !== 0) p.push(`${id}'s run carries a row that is not a pass`);
    const blob = ctx.blobOf(id);
    if (!blob || g.gate_sha !== blob) p.push(`${id}'s gate.sh is not the one the run read (${g.gate_sha || 'none'} against ${blob || 'none'})`);
  }
  return p;
}

// The receipts under specs/<spec>/evidence/ at `ref`, one level (the way merge-check reads records).
function receiptsAt(root, ref, spec) {
  let names = [];
  try { names = lines(gitOut(root, ['ls-tree', '--name-only', ref, '--', `specs/${spec}/evidence/`])).map((f) => path.posix.basename(f)).filter((n) => RECEIPT_RE.test(n)); } catch { return []; }
  return names.sort().map((name) => {
    let json = null; let error = null;
    try { json = JSON.parse(gitOut(root, ['show', `${ref}:specs/${spec}/evidence/${name}`])); } catch (e) { error = `unreadable: ${String(e.message).split('\n')[0]}`; }
    return { name, json, error };
  });
}

// Where a spec stands. `ref` is where the receipts are read (the tip), `subject` the commit they
// must name. { layout, changed, expected, receipts, valid: [names], problems: [lines] }; `problems`
// is [] for a spec that changes no layout path and for a layout spec with a good receipt.
function visualStatus(root, { spec, ref = 'HEAD', subject, base = null }) {
  const scope = visualScope(root, { spec, ref: subject, base });
  if (!scope.layout) return { layout: false, changed: [], expected: [], receipts: [], valid: [], problems: [] };
  const expected = scope.gates.map((g) => g.spec);
  const blobOf = (id) => { try { return gitOut(root, ['rev-parse', `${subject}:specs/${id}/gate.sh`]).trim(); } catch { return null; } };
  const receipts = receiptsAt(root, ref, spec).map((r) => ({ name: r.name, subject: r.json && r.json.subject, problems: r.error ? [r.error] : receiptProblems(r.json, { spec, subject, base: scope.base, expected, blobOf }) }));
  const valid = receipts.filter((r) => !r.problems.length).map((r) => r.name);
  const problems = [];
  if (!valid.length) {
    const head = `${spec} changes layout (${scope.changed.slice(0, 3).join(', ')}${scope.changed.length > 3 ? `, and ${scope.changed.length - 3} more` : ''}) and no visual receipt is good for ${subject}`;
    if (!receipts.length) problems.push(`${head}: none exists under specs/${spec}/evidence/`);
    else { const last = receipts[receipts.length - 1]; problems.push(`${head}: the latest, ${last.name}: ${last.problems.join('; ')}`); }
  }
  return { layout: true, changed: scope.changed, expected, receipts, valid, problems };
}

// Whether an approval record's text cites one of the receipts good for its subject.
const citesReceipt = (text, valid) => valid.some((n) => String(text).includes(n));


// THE MERGE CHECK'S CLAUSE. Spec 125's approvals passed three times without the browser captures, which
// only ran at merge. For a spec whose diff against its Base changes a layout path (decided from the
// diff, not from anything the spec says), an approval counts only when a visual receipt good for the
// subject is committed beside it and the approval record cites that receipt by its file name.
// `ref` is where the evidence is read (the tip), `subject` the commit the approval names. A spec whose
// layout question cannot be read is refused, not passed: `absence-vs-unreadable`.
// The Base is the branch's own branch point, read from git; the spec's header is only a fallback,
// because the header is the build's own text and a spec that names its tip there would diff to nothing.
// `explicitBase` is the `--base` test affordance (a dry run only): the caller's sha is used as given.
function visualProblems(specDir, subject, ref, base, matched, root = ROOT, explicitBase = false) {
  const spec = path.basename(String(specDir).replace(/\/+$/, ''));
  let st;
  try {
    st = visualStatus(root, { spec, ref, subject, base: explicitBase ? base : (branchPoint(root, subject) || specBase(root, subject, spec) || base) });
  } catch (e) {
    return [`whether ${spec} changes layout could not be read: ${String(e.message).split('\n')[0]}`];
  }
  if (!st.layout) return [];
  if (st.problems.length) return st.problems;
  const cites = matched.filter((a) => {
    let text = '';
    try { text = execFileSync('git', ['show', `${ref}:${specDir}/evidence/${a.file}`], { cwd: root, encoding: 'utf8' }); } catch { /* an unreadable record cites nothing */ }
    return citesReceipt(text, st.valid);
  });
  if (cites.length) return [];
  return [`${spec} changes layout and no approval record cites a visual receipt good for ${subject} (${st.valid.join(', ')}): an approval that did not read the browser checks' results does not count`];
}

// ── The candidate tree is scanned before the merge is permitted ─────────────
//
// Backlog B-8: four approval records reached `dev` carrying an absolute host
// path, each caught only by the gate run AFTER the merge. The recorded cause is
// wrong — the repo gate's file walk has always included untracked files — and the
// real one is vantage: an approval session measures in a disposable copy made
// before it writes its record into the shared checkout, so the record is not in
// the tree that was scanned. Nothing about scanning a working tree closes that.
//
// The tree that MERGES is a commit, so that is the tree scanned here, read with
// `git ls-tree`/`git show` exactly as the approvals are (C-F6). By this point the
// record is committed on the branch, which is precisely the window that was open.
//
// It runs BEFORE the approval verdict is reported, and independently of it: a
// candidate with no approval at all still has its leak named, because "you also
// have a leak" is information the operator needs on the same run.
function hygieneScan(ref, root = ROOT) {
  const hygiene = require('../lib/hygiene.js');
  let listing;
  try {
    listing = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return { error: `cannot read the candidate tree at ${ref}: ${e.message}`, hits: [] };
  }
  const files = listing.split('\n').map((f) => f.trim()).filter(Boolean);
  // A PNG arrives as BYTES so the scan reads its text-bearing chunks and not its compressed image
  // data (spec 038 A-038-5); everything else arrives as text, and a link's target still arrives as
  // content because git stores it that way.
  const hits = hygiene.scanFiles(files, (rel) => execFileSync('git', ['show', `${ref}:${rel}`],
    { cwd: root, ...(rel.endsWith('.png') ? {} : { encoding: 'utf8' }), maxBuffer: 64 * 1024 * 1024 }));
  return { error: null, hits };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const specDir = args.find((a) => !a.startsWith('--'));
  const headFlag = args.indexOf('--head');
  const dryRun = args.includes('--dry-run');
  if (!specDir) { console.error('usage: node scripts/merge-check.js <spec-dir> [--dry-run [--head <sha>] [--base <sha>] [--repo <path>]]'); process.exit(2); }
  if (headFlag >= 0 && !dryRun) {
    console.error('--head requires --dry-run: a caller-supplied SHA in a real check is a bypass.');
    process.exit(2);
  }
  // `--repo` and `--base` are test affordances and carry the same condition as
  // `--head`: a caller-supplied value in a real check is a bypass, so both
  // require `--dry-run`. Default base is the merge point with `main`, which is
  // the range a merge would actually bring in.
  const repoFlag = args.indexOf('--repo');
  const baseFlag = args.indexOf('--base');
  for (const [flag, i] of [['--repo', repoFlag], ['--base', baseFlag]]) {
    if (i >= 0 && !dryRun) {
      console.error(`${flag} requires --dry-run: a caller-supplied value in a real check is a bypass.`);
      process.exit(2);
    }
  }
  const root = repoFlag >= 0 ? path.resolve(args[repoFlag + 1]) : ROOT;
  const head = headFlag >= 0 ? args[headFlag + 1]
    : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const { subject, skipped } = dryRun && headFlag >= 0 ? { subject: head, skipped: [] } : resolveSubject(head, root);

  // THE APPROVAL-RECORD RULE, checked before the verdict is reported and
  // independently of it: a candidate with no approval at all still has this
  // named, because it is information the operator needs on the same run.
  //
  // FAIL CLOSED WHEN THE RANGE CANNOT BE DERIVED. The first version set
  // `base = null` on a failed `merge-base` and then skipped the check entirely,
  // printing nothing — so a repository with no `main` reported MERGE OK with
  // this rule never run, and a commit mixing an approval record with code passed
  // unmentioned (reproduced: a branch named `trunk`). That is
  // `absence-vs-unreadable` — a search reporting nothing because it could not
  // read, indistinguishable from the property holding — in the guard this loop
  // added to close a different instance of the same class. `approvalCommitProblems`
  // already returns a problem string when `rev-list` fails; the derivation now
  // does the same instead of returning silence. Approval finding 2.
  let base = baseFlag >= 0 ? args[baseFlag + 1] : null;
  let baseError = null;
  if (!base) {
    try { base = execFileSync('git', ['merge-base', 'main', head], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch (e) { base = null; baseError = (e.stderr || e.message || '').toString().trim().split('\n')[0]; }
  }
  {
    const mixed = base
      ? approvalCommitProblems(base, head, root)
      : [`the commit range could not be derived (git merge-base main ${head}: ${baseError || 'failed'}), so the approval-record rule could not run. Pass --base <sha> with --dry-run, or run this where main is reachable.`];
    if (mixed.length) {
      console.error(`MERGE REFUSED — ${specDir} @ ${head}`);
      for (const m of mixed) console.error(`  \u00b7 ${m}`);
      console.error('  An approval record is committed alone, first (DECISIONS #4). A commit that');
      console.error('  carries a record and the code it approves moves both in one step, by one');
      console.error('  hand, which is the separation of generation and approval dissolving into a');
      console.error('  commit message. Split the commit and re-run.');
      process.exit(1);
    }
  }

  // The candidate tree is the TIP being merged, not the approved subject: an
  // evidence-only commit on top is exactly where an approval record — and the
  // host path in it — lands.
  const scan = hygieneScan(head, root);
  if (scan.error || scan.hits.length) {
    console.error(`MERGE REFUSED — ${specDir} @ ${head}`);
    if (scan.error) console.error(`  \u00b7 hygiene scan could not read the candidate tree: ${scan.error}`);
    for (const h of scan.hits.slice(0, 20)) {
      // A RECORD OF A SCAN HIT NAMES THE ASSERTION AND THE LOCATION, NEVER THE MATCHED STRING
      // (CONSTITUTION § Threat model): a transcript that quotes what the scan matched reproduces the
      // disclosure the scan exists to prevent, and the scan then fires on the record of its own
      // firing - which is how this output made its own evidence file unmergeable (spec 038 A-038-6).
      console.error(`  \u00b7 hygiene: ${h.file} matches ${h.kind}`);
    }
    if (scan.hits.length > 20) console.error(`  \u00b7 hygiene: and ${scan.hits.length - 20} more`);
    console.error('  The blocking hygiene scan runs against the COMMIT being merged, because that');
    console.error('  is the tree that merges — an approval record written into a checkout after the');
    console.error('  session measured it is the window this closes (backlog B-8).');
    process.exit(1);
  }

  const r = mergeCheck(specDir, subject, 'HEAD', root);
  if (r.ok) {
    const vp = visualProblems(specDir, subject, 'HEAD', base, r.matched, root, baseFlag >= 0);
    if (vp.length) {
      console.error(`MERGE REFUSED — ${specDir} @ ${subject}${subject !== head ? ` (subject of tip ${head})` : ''}`);
      for (const p of vp) console.error(`  \u00b7 ${p}`);
      console.error('  A layout or visual change is approved on the browser checks\' current results,');
      console.error('  by the receipt the driver wrote for this subject (CONSTITUTION § Fix loop checklist).');
      process.exit(1);
    }
    if (skipped.length) console.log(`  (walked back ${skipped.length} evidence-only commit(s) to reach the subject)`);
    console.log(`MERGE OK${dryRun ? ' (dry run)' : ''} — ${r.matched[0].file} approves ${subject} (verdict: ${r.matched[0].verdict}, blocking_findings: ${r.matched[0].blocking})`);
    process.exit(0);
  }
  console.error(`MERGE REFUSED — ${specDir} @ ${subject}${subject !== head ? ` (subject of tip ${head})` : ''}`);
  for (const p of r.problems) console.error(`  · ${p}`);
  console.error('  An approval must name the SHA being merged (DECISIONS #4, #12).');
  process.exit(1);
}

module.exports = {
  mergeCheck, approvalsIn, approvalFields, approvalProblems, gateReceiptProblems, receiptNamed, receiptsNamed, resolveSubject, hygieneScan,
  approvalCommitProblems, APPROVAL_RECORD, visualProblems,
  LAYOUT_PATHS, isLayoutPath, SOURCES_HELPER, isBrowserGateText, TAKERS_FILE, RECEIPT_RE,
  specBase, layoutChanges, browserGates, gateReads, parseTakers, takersAt, visualScope,
  buildReceipt, receiptProblems, visualStatus, citesReceipt,
};
