// SPDX-License-Identifier: Apache-2.0
'use strict';

// A merged spec whose Tip slot is all zeros (spec 116).
//
// A spec's header carries a Tip slot, `<!--spec_tip-->...<!--/spec_tip-->`, all zeros until a
// later commit on its branch writes the last content commit into it; a reader takes zeros as
// HEAD. That is right on the branch and wrong once the branch is merged: on `dev`, HEAD is every
// later merge too, so a range read to HEAD takes in commits that are not the spec's. Spec 067
// merged with its slot at zeros, and its AC-10 read red on the nightly of 27 Sep 2026.
//
// MERGED, read from history and not from a merge subject (their form has changed over time): the
// commit that adds the spec's spec.md along HEAD's first-parent line is a merge. On the spec's own
// branch that commit is an ordinary one, so a zero slot there is the "until then" the header
// allows. A tree with no specs/ (the published tree) reads nothing, and so does a tree that is not
// the top of a repository with a HEAD (a scratch copy a sibling gate runs this gate in): with no
// history, merged cannot be read, and `history: false` says so rather than failing or passing
// quietly. A spec.md no commit adds (not yet committed) is not merged.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ZERO_SLOT = /<!--spec_tip-->0{40}<!--\/spec_tip-->/;

function mergedZeroTips(root) {
  const specs = path.join(root, 'specs');
  const out = { specs_read: 0, history: false, zero: [], merged: [], not_in_history: [], unreadable: [] };
  if (!fs.existsSync(specs)) return out;
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    execFileSync('git', ['-C', root, 'rev-parse', '--verify', '-q', 'HEAD'], { stdio: 'ignore' });
    out.history = fs.realpathSync(top) === fs.realpathSync(root);
  } catch (_e) { out.history = false; }
  for (const name of fs.readdirSync(specs).sort()) {
    const md = path.join(specs, name, 'spec.md');
    if (!fs.existsSync(md)) continue;
    out.specs_read += 1;
    if (!ZERO_SLOT.test(fs.readFileSync(md, 'utf8'))) continue;
    out.zero.push(name);
    if (!out.history) continue;
    let adds;
    try {
      adds = execFileSync('git', ['-C', root, 'log', '--first-parent', '--diff-filter=A', '--format=%H %P', 'HEAD', '--', `specs/${name}/spec.md`], { encoding: 'utf8' })
        .split('\n').filter(Boolean);
    } catch (e) {
      out.unreadable.push(`${name}: git log failed: ${String(e.message).split('\n')[0]}`);
      continue;
    }
    if (!adds.length) { out.not_in_history.push(name); continue; }
    const [commit, ...parents] = adds[adds.length - 1].split(' ');
    if (parents.length > 1) out.merged.push({ spec: name, merge: commit });
  }
  return out;
}

module.exports = { mergedZeroTips, ZERO_SLOT };
