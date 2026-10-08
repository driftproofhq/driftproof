#!/usr/bin/env node
'use strict';
// Rebuilds Report 005's published page in a sandbox, layer by layer, so it can be
// compared byte for byte with docs/reports/005/index.html (RUNBOOK § Approve and
// publish a drafted report, step 2; spec 002 AC-8, spec 007 AC-1).
//
// The page is the source of truth. It was rendered on 19 Aug 2026 and every later
// change reached it as a layer applied in place: amendment entries, the site's
// chrome and head block, a dated note. The render command alone has not reproduced
// it since the first of those layers (d5fbf2c5, 29 Aug). This script runs the
// render and then each layer, in the order they reached the page, against the
// sandbox named by --out-root. It never writes the tree: it refuses an --out-root
// that is the repository itself.
//
// Every step runs in this process, so a provider poisoned with `node -r` (as the
// gates do) covers all of them. No step makes a model call: the render is
// --render-only, and every later step is a text transform of the page.
//
//   node scripts/rebuild-report-005.js --render-only --published \
//        --receipts-label 'receipts/report-005/' --run-concurrency 2 --max-usd 40 \
//        [--out-root <dir>] [--now <iso>]
//
// Every argument is passed to the render as given. Without --out-root the rebuild
// makes a directory under the system temp directory and prints it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join('docs', 'reports', '005', 'index.html');
const REL = 'reports/005/index.html';

// The layers after the render, in the order they reached the page. `commit` is the
// commit that first applied the layer to docs/reports/005/index.html. Where a layer
// stamps a date into the page, `date` is the date that commit wrote, read from its
// diff; the builder itself stamps the day it runs, so the replay passes the date in.
const LAYERS = [
  {
    id: 'record wording',
    commit: 'cd101be0b097f272c97f9cee63bd77fd7bcbe54a',
    what: 'the cost-per-benefit wording as published: spec 031 changed lib/value.js NOISE_CELL on 14 Sep and left the page as published; the v1.3 entry quotes both strings',
  },
  {
    id: 'v1.1',
    commit: 'd5fbf2c5794dbfbbb0203bf59c30c6cadb578c72',
    date: '2026-08-29',
    what: 'spec 012: prepare-report-006.js applyStagedAmendment005, the staged amendment and the skill-versions-pinned anchor',
  },
  {
    id: 'v1.2',
    commit: '7d618edbe672d89c26bba6254a6cdea77e2c6ad5',
    date: '2026-09-01',
    what: 'Report 007: prepare-report-007.js amend005',
  },
  {
    id: 'v1.3',
    commit: 'e06035a5ae7fd7f375d710aa9dbf27aecdbb474b',
    what: 'spec 031: prepare-report-005.js applyWordingAmendment005',
  },
  {
    id: 'site',
    commit: '9daed332cbfd55759e96a8d8b6a5d53b58167806',
    what: 'specs 019a, 020, 025, 033, 037, 038, 125, 127, 133, 134 and 135: build-head-tags.js render, the head block and the site chrome at their current versions; each replaces its own fenced block, so one pass after the content layers stands for all of them',
  },
  {
    id: 'v1.4',
    commit: '1ebe209b9dd997b1fdbc1fcf109390d1dd6f4011',
    what: 'spec 161: report-corrections.js applyToPage, the dated note and its entry',
  },
  {
    id: 'site, page dates',
    commit: 'a3c5d81cc733ffc47b8c694b88f5981bab6422bf',
    what: 'spec 161: build-head-tags.js render again, dateModified read from docs/data/page-dates.json',
  },
];

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i > -1 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

// Where the history is present, each recorded date is checked against the commit
// that wrote it. A tracked-only tree (spec 007 AC-1) has no history: the dates are
// then used as recorded, and the comparison with the published page still holds them.
function checkDate(layer, entryHead) {
  if (!layer.date) return 'no date';
  let diff;
  try {
    execFileSync('git', ['cat-file', '-e', `${layer.commit}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    diff = execFileSync('git', ['show', '--format=', layer.commit, '--', PAGE], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch (_e) {
    return `date ${layer.date} as recorded (no history here)`;
  }
  const want = `${entryHead}${layer.date}</strong>`;
  if (!diff.split('\n').some((l) => l.startsWith('+') && l.includes(want))) {
    throw new Error(`layer ${layer.id}: commit ${layer.commit.slice(0, 8)} did not add "${want}" to ${PAGE}`);
  }
  return `date ${layer.date} checked against ${layer.commit.slice(0, 8)}`;
}

async function rebuildReport005(argv) {
  // One --out-root, read the same way here and by the render. With none, a fresh
  // directory under the system temp directory is made and printed.
  if (argv.filter((a) => a === '--out-root').length > 1) throw new Error('--out-root is given more than once');
  argv = argv.slice();
  let outArg = argValue(argv, '--out-root');
  if (argv.includes('--out-root') && !outArg) throw new Error('--out-root needs a directory');
  if (!outArg) {
    outArg = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-report-005-'));
    argv.push('--out-root', outArg);
  }
  const outRoot = path.resolve(outArg);
  const real = (d) => { try { return fs.realpathSync(d); } catch (_e) { return path.resolve(d); } };
  if (real(outRoot) === real(ROOT)) throw new Error('--out-root is the repository: the published page is never re-rendered in place');
  if (!argv.includes('--render-only')) throw new Error('the rebuild renders with --render-only only');
  for (const bad of ['--execute', '--smoke', '--fresh']) {
    if (argv.includes(bad)) throw new Error(`the rebuild refuses ${bad}: it renders from the receipts that exist`);
  }

  const p5 = require('./prepare-report-005.js');
  const p6 = require('./prepare-report-006.js');
  const p7 = require('./prepare-report-007.js');
  const headTags = require('./build-head-tags.js');
  const corrections = require('./report-corrections.js');
  const { NOISE_CELL } = require('../lib/value.js');

  // The render reads the receipts under the out-root. A sandbox that has none is
  // given copies of the tracked ones; one that has them (the gates copy their own)
  // is used as it is.
  const receipts = path.join(outRoot, 'receipts', 'report-005');
  if (!fs.existsSync(receipts)) {
    const src = path.join(ROOT, 'receipts', 'report-005');
    fs.mkdirSync(receipts, { recursive: true });
    for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.json'))) fs.copyFileSync(path.join(src, f), path.join(receipts, f));
  }

  // The render, as RUNBOOK pins it. It writes <out-root>/docs/reports/005/index.html.
  await p5.main(argv);
  const file = path.join(outRoot, PAGE);
  if (!fs.existsSync(file)) throw new Error(`the render did not write ${path.join(outArg, PAGE)}`);
  const edit = (fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
  const done = (layer, note) => console.log(`  layer ${layer.id} (${layer.commit.slice(0, 8)}): ${note}`);
  const [wording, v11, v12, v13, site, v14, dates] = LAYERS;

  // Record wording. The v1.3 entry names what the page reads and what the renderer
  // now writes; both strings are read from it, and the renderer's must be NOISE_CELL.
  const entry = p5.WORDING_ENTRY_005;
  const asPublished = (entry.match(/the cost-per-benefit cells and the method notes read <em>([^<]+)<\/em>/) || [])[1];
  const nowWrites = (entry.match(/the renderer now writes <code>([^<]+)<\/code>/) || [])[1];
  if (!asPublished || !nowWrites) throw new Error('the v1.3 entry no longer names the published and the current cost-per-benefit wording');
  if (nowWrites !== NOISE_CELL) throw new Error(`the v1.3 entry says the renderer writes "${nowWrites}", lib/value.js NOISE_CELL is "${NOISE_CELL}"`);
  let n = 0;
  edit((html) => {
    n = html.split(NOISE_CELL).length - 1;
    return html.split(NOISE_CELL).join(asPublished);
  });
  if (n === 0) throw new Error(`the render carries no "${NOISE_CELL}": the record-wording layer has nothing to restore`);
  done(wording, `${n} occurrence(s) of "${NOISE_CELL}" read "${asPublished}" as published`);

  // v1.1, v1.2: their builders stamp the day they run; the replay passes the recorded day.
  const a1 = p6.applyStagedAmendment005({ nowIso: `${v11.date}T00:00:00.000Z`, file });
  if (!a1.applied) throw new Error(`layer v1.1 not applied: ${a1.reason}`);
  done(v11, checkDate(v11, '<strong>v1.1 &middot; '));
  const a2 = p7.amend005(p7.readCells(), { nowIso: `${v12.date}T00:00:00.000Z`, file });
  if (!a2.applied) throw new Error(`layer v1.2 not applied: ${a2.reason}`);
  done(v12, checkDate(v12, '<strong>v1.2 &middot; '));

  // v1.3 takes a root, not a file.
  if (!p5.applyWordingAmendment005(outRoot)) throw new Error('layer v1.3 not applied: the entry was already on the render');
  done(v13, 'applied');

  edit((html) => headTags.render(html, REL));
  done(site, 'applied');
  edit((html) => corrections.applyToPage(html, '005', {}));
  done(v14, 'applied');
  edit((html) => headTags.render(html, REL));
  done(dates, 'applied');
  console.log(`rebuilt: ${path.join(outArg, PAGE)}`);
}

module.exports = { LAYERS, rebuildReport005 };

if (require.main === module) {
  rebuildReport005(process.argv.slice(2)).catch((e) => { console.error(`rebuild-report-005: ${e && (e.message || e)}`); process.exit(1); });
}
