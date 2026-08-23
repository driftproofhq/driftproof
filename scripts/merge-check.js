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
      const field = (name) => {
        const m = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
        return m ? m[1].trim() : null;
      };
      return {
        file: f, commit: field('commit'), verdict: field('verdict'), tree: field('tree'),
        blocking: field('blocking_findings'),
      };
    });
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
  // A rejected verdict is not an approval, whatever SHA it names.
  for (const a of matched) {
    if (a.verdict && /^(rejected|changes-requested)/i.test(a.verdict)) problems.push(`${a.file} names this SHA but its verdict is "${a.verdict}"`);
    if (a.tree && a.tree !== 'clean') problems.push(`${a.file} approved a tree recorded as "${a.tree}"`);
    if (a.blocking == null) {
      problems.push(`${a.file} carries no "blocking_findings:" field — an approval must state whether anything blocking is outstanding, and a missing field is refused rather than assumed zero`);
    } else if (!/^(0|none)$/i.test(a.blocking.trim())) {
      problems.push(`${a.file} records blocking_findings: ${a.blocking} — resolve them and re-approve`);
    }
  }
  return { ok: problems.length === 0, head, approvals, matched, problems };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const specDir = args.find((a) => !a.startsWith('--'));
  const headFlag = args.indexOf('--head');
  const dryRun = args.includes('--dry-run');
  if (!specDir) { console.error('usage: node scripts/merge-check.js <spec-dir> [--dry-run --head <sha>]'); process.exit(2); }
  if (headFlag >= 0 && !dryRun) {
    console.error('--head requires --dry-run: a caller-supplied SHA in a real check is a bypass.');
    process.exit(2);
  }
  const head = headFlag >= 0 ? args[headFlag + 1]
    : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const { subject, skipped } = dryRun && headFlag >= 0 ? { subject: head, skipped: [] } : resolveSubject(head);
  const r = mergeCheck(specDir, subject);
  if (r.ok) {
    if (skipped.length) console.log(`  (walked back ${skipped.length} evidence-only commit(s) to reach the subject)`);
    console.log(`MERGE OK${dryRun ? ' (dry run)' : ''} — ${r.matched[0].file} approves ${subject} (verdict: ${r.matched[0].verdict}, blocking_findings: ${r.matched[0].blocking})`);
    process.exit(0);
  }
  console.error(`MERGE REFUSED — ${specDir} @ ${subject}${subject !== head ? ` (subject of tip ${head})` : ''}`);
  for (const p of r.problems) console.error(`  · ${p}`);
  console.error('  An approval must name the SHA being merged (DECISIONS #4, #12).');
  process.exit(1);
}

module.exports = { mergeCheck, approvalsIn, resolveSubject };
