// SPDX-License-Identifier: Apache-2.0
'use strict';

// Report #005 rebuilds from a clone, byte for byte (spec 007 AC-11, issue 390).
//
// The README carries the command a reader runs, under the heading below. This
// reads that block out of the README of the tree it is given and runs it there,
// so the check runs what the README says and types no rebuild argument of its own.
// The block's first three lines are the clone, the `cd` and `npm ci`: the tree
// given IS the clone, and its node_modules stands for `npm ci`. Every later line
// runs verbatim under bash, in the tree. Two things are added: a NODE_OPTIONS
// preload that makes every model call record itself and throw, and a TMPDIR of
// this module's own, so the block's `mktemp -d` lands where it can be read back
// and removed.
//
// Used by tests/gate.js on the tree that gate runs in, which is the built public
// tree whenever scripts/build-public.sh verifies a build, and by spec 007's gate
// on a scratch public build and on planted copies of it.
//
// runBlock({ root }) returns { pass, detail } for the whole claim and never
// throws on a failed run: a failed run is a failed check. refusesMissingReceipt
// ({ root, dir }) builds a linked copy of root's tracked files under `dir` with
// one receipt left out, and passes when the README's block refuses there. The
// caller removes `dir`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const HEADING = '### Rebuild Report #005 from a clone';
const STAND_INS = [
  'git clone https://github.com/driftproofhq/driftproof.git',
  'cd driftproof',
  'npm ci',
];
const PAGE = 'docs/reports/005/index.html';
const RECEIPTS = 'receipts/report-005';
const CALLED = 'MODEL CALL ATTEMPTED';

// The block: the first ```sh fence after the heading. Returns the lines after the
// three stand-ins, or throws naming what is missing.
function readBlock(readme) {
  const lines = readme.split('\n');
  const at = lines.indexOf(HEADING);
  if (at < 0) throw new Error(`the README has no "${HEADING}" heading`);
  const open = lines.findIndex((l, i) => i > at && l === '```sh');
  if (open < 0) throw new Error('no ```sh block follows the rebuild heading');
  const close = lines.findIndex((l, i) => i > open && l === '```');
  if (close < 0) throw new Error('the rebuild block is not closed');
  const body = lines.slice(open + 1, close);
  for (let i = 0; i < STAND_INS.length; i += 1) {
    if (body[i] !== STAND_INS[i]) throw new Error(`the block's line ${i + 1} is not "${STAND_INS[i]}": ${JSON.stringify(body[i])}`);
  }
  const run = body.slice(STAND_INS.length);
  if (!run.some((l) => l.startsWith('node scripts/rebuild-report-005.js '))) throw new Error('the block runs no scripts/rebuild-report-005.js');
  return run;
}

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const slash = (p) => p.split(path.sep).join('/');

function tracked(root, rel) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-C', root, 'ls-files', '--', rel], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

function pagesUnder(dir, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? path.join(rel, d.name) : d.name;
    if (d.isDirectory()) out.push(...pagesUnder(dir, r));
    else if (slash(r).endsWith(PAGE)) out.push(r);
  }
  return out;
}

// The block run once in `root`: exit status, output, whether a model call was
// attempted, the page it reported and every page written under its TMPDIR.
function execBlock({ root, timeout = 300000, env = process.env } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'r005-block-'));
  try {
    let run;
    try { run = readBlock(fs.readFileSync(path.join(root, 'README.md'), 'utf8')); } catch (e) {
      return { block: String(e.message || e) };
    }
    const tmp = path.join(scratch, 'tmp');
    fs.mkdirSync(tmp);
    const marker = path.join(scratch, 'model-calls');
    const poison = path.join(scratch, 'poison.js');
    fs.writeFileSync(poison, [
      "'use strict';",
      `const prov = require(${JSON.stringify(path.join(root, 'lib', 'provider.js'))});`,
      'prov.complete = async () => {',
      `  require('fs').appendFileSync(${JSON.stringify(marker)}, 'call\\n');`,
      `  throw new Error(${JSON.stringify(CALLED)});`,
      '};',
      '',
    ].join('\n'));
    // A reader's environment: nothing of this project's own variable family,
    // which selects stub runs and gate modes.
    const e = { ...env };
    for (const k of Object.keys(e)) if (k.startsWith('DRIFTPROOF_')) delete e[k];
    e.NODE_OPTIONS = `${e.NODE_OPTIONS ? `${e.NODE_OPTIONS} ` : ''}--require "${slash(poison)}"`;
    e.TMPDIR = slash(tmp);
    const r = spawnSync('bash', ['-euo', 'pipefail', '-c', run.join('\n')], {
      cwd: root, env: e, encoding: 'utf8', timeout, maxBuffer: 64 << 20,
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const rebuilt = (out.match(/^rebuilt: (.+)$/m) || [])[1] || null;
    const res = {
      rc: r.status, stdout: r.stdout || '', out,
      called: fs.existsSync(marker) || out.includes(CALLED),
      rebuilt, written: pagesUnder(tmp),
    };
    if (rebuilt && fs.existsSync(rebuilt)) res.rebuiltSha = sha256(rebuilt);
    // The receipts the rebuild copied, read from the sandbox under this TMPDIR
    // whether or not the render then succeeded: a receipt that breaks the render
    // was still read.
    const sandboxes = fs.readdirSync(tmp).map((d) => path.join(tmp, d, RECEIPTS)).filter((d) => fs.existsSync(d));
    res.sandboxes = sandboxes.length;
    if (sandboxes.length === 1) {
      res.sandboxReceipts = Object.fromEntries(fs.readdirSync(sandboxes[0]).sort()
        .map((f) => [f, sha256(path.join(sandboxes[0], f))]));
    }
    return res;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// The whole claim, in `root`: exit 0, no model call, the render's own receipt
// count, the README's two digests equal, the gate's own two digests equal, and
// the sandbox's receipts exactly the tree's tracked ones, name for name and byte
// for byte.
function runBlock({ root, timeout, env } = {}) {
  const r = execBlock({ root, timeout, env });
  if (r.block) return { pass: false, detail: { block: r.block } };
  const detail = { rc: r.rc, called: r.called, rebuilt: r.rebuilt };
  detail.skipped = /resume: 0 restored from backup, 30 completed pair\(s\) skipped\./.test(r.out);
  // The README's compare line: exactly two digest lines, the tree's page first.
  const digests = r.stdout.split('\n').map((l) => l.match(/^([0-9a-f]{64}) [ *](.+)$/)).filter(Boolean);
  detail.readmeDigests = digests.map((m) => m[1]);
  detail.readmeEqual = digests.length === 2 && digests[0][2] === PAGE && digests[0][1] === digests[1][1];
  detail.pageTracked = tracked(root, PAGE).includes(PAGE);
  const treeSha = fs.existsSync(path.join(root, PAGE)) ? sha256(path.join(root, PAGE)) : null;
  detail.digests = { tree: treeSha, rebuilt: r.rebuiltSha || null };
  detail.sameBytes = !!treeSha && treeSha === r.rebuiltSha;
  const want = Object.fromEntries(tracked(root, RECEIPTS).filter((f) => f.endsWith('.json')).sort()
    .map((f) => [path.basename(f), fs.existsSync(path.join(root, f)) ? sha256(path.join(root, f)) : null]));
  const got = r.sandboxReceipts || {};
  detail.sandboxes = r.sandboxes;
  detail.receipts = {
    tracked: Object.keys(want).length,
    sandbox: Object.keys(got).length,
    extra: Object.keys(got).filter((f) => !(f in want)),
    missing: Object.keys(want).filter((f) => !(f in got)),
    differ: Object.keys(want).filter((f) => f in got && got[f] !== want[f]),
  };
  detail.trackedOnly = r.sandboxes === 1 && detail.receipts.tracked > 0 && !detail.receipts.extra.length
    && !detail.receipts.missing.length && !detail.receipts.differ.length;
  if (r.rc !== 0 || !detail.sameBytes) detail.tail = r.out.split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 600);
  return {
    pass: r.rc === 0 && !r.called && detail.skipped && detail.readmeEqual && detail.pageTracked
      && detail.sameBytes && detail.trackedOnly,
    detail,
  };
}

// A copy of root's tracked files under `dest`, hard links where the filesystem
// allows and copies where it does not, leaving out `omit`. node_modules is linked.
function linkTree(root, dest, omit = []) {
  for (const f of tracked(root, '.')) {
    if (omit.includes(f)) continue;
    const from = path.join(root, f);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.linkSync(from, to); } catch (_e) { fs.copyFileSync(from, to); }
  }
  const nm = path.join(root, 'node_modules');
  if (fs.existsSync(nm)) fs.symlinkSync(fs.realpathSync(nm), path.join(dest, 'node_modules'), 'junction');
}

// The missing-receipt refusal: the README's block, in a copy of the tree with
// one tracked receipt left out, exits non-zero naming that receipt's pair,
// makes no model call and writes no page.
function refusesMissingReceipt({ root, dir, timeout, env } = {}) {
  const receipts = tracked(root, RECEIPTS).filter((f) => f.endsWith('.json')).sort();
  if (!receipts.length) return { pass: false, detail: { receipts: 0 } };
  const gone = receipts[0];
  // Each receipt is named <slug>__<model>.json.
  const slug = (path.basename(gone, '.json').match(/^(.+)__/) || [])[1] || null;
  const copy = path.join(dir, 'tree');
  linkTree(root, copy, [gone]);
  const r = execBlock({ root: copy, timeout, env });
  if (r.block) return { pass: false, detail: { block: r.block } };
  const named = !!slug && r.out.includes(`--render-only: no valid receipt for ${slug} `);
  const detail = { removed: gone, slug, rc: r.rc, called: r.called, named, written: r.written,
    tail: r.out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400) };
  return { pass: typeof r.rc === 'number' && r.rc !== 0 && !r.called && named && r.written.length === 0, detail };
}

module.exports = { HEADING, STAND_INS, PAGE, RECEIPTS, readBlock, execBlock, runBlock, refusesMissingReceipt, linkTree };
