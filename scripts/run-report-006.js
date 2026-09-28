#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Report #006 — revision drift. The study runner (spec 009).
//
// The substrate is held still and the SKILL'S OWN TEXT moves: pinned revision
// against the revision upstream ships today. Report #005's receipts serve as the
// pinned-text arm — free, on the Phase 2 comparability verdict — so only the
// CURRENT-TEXT arm is run here.
//
// THIS SCRIPT DOES NOT SPEND BY DEFAULT. A bare invocation is a dry run: it
// prints the cell plan, the call count and both cost projections, and makes no
// model call and no network call. Spending requires --execute AND an approval
// record, because spec 009 is T1 and a T1 loop's run follows a fresh-context
// approval, not a flag someone remembered to type.
//
// Usage:
//   node scripts/run-report-006.js                          # dry run (default)
//   node scripts/run-report-006.js --execute --approval specs/009-revision-drift/evidence/<approval>.md
//   node scripts/run-report-006.js ... --workdir <dir>      # stage dir for the current-text arm
//
// Before the first call of an --execute run, every cell's staged SKILL.md is
// hashed against the manifest pin it claims to be (AC-12). The workdir is a
// typed flag, never an environment variable — DECISIONS #27.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { estimateRunCostUSD } = require('../lib/cost');
const { projectCalls } = require('../lib/run');
// Spec 016 AC-7: `estimateRunCostUSD` requires an explicit draw factor. v0.5 draws
// the generation up to SAMPLING.max times per arm, so a projection at one draw
// understates a real run by up to that factor — in the figure a human reads
// before authorising a paid run.
const { SAMPLING } = require('../lib/sampling');
const { baselineControl } = require('../lib/revision');
const { buildDriftReport, revisionPairProblem } = require('../lib/diff');
const { approvalFields, approvalProblems, resolveSubject } = require('./merge-check');

const ROOT = path.join(__dirname, '..');
const R5 = path.join(ROOT, 'receipts', 'report-005');
const OUT = path.join(ROOT, 'receipts', 'report-006');
const WORKDIR = path.join(ROOT, '.skills-workdir-006');

// The cost cap each cell invocation carries. Spec 009 § Cost guard projection:
// the tightest cap that still clears every intended call ($1.0185 on the largest
// cell) while aborting an invocation that accidentally passes all three models
// ($2.4553) BEFORE the first call. NOT RAISED — see the spec for why the guard
// bounds call volume rather than dollars.
const MAX_USD_PER_CELL = 2;

const SAMPLES = 5;
const JUDGE_MODEL = 'claude-haiku-4-5';

// One substrate per skill: the substrate where #005 measured that skill's largest
// effect. Recorded with its basis so the choice is auditable rather than asserted.
const CELLS = [
  {
    slug: 'code-review-and-quality',
    model: 'claude-fable-5',
    report005Delta: 0.103,
    basis: 'largest #005 effect (+0.103; runner-up sonnet-5 +0.035)',
    prediction: 'WITHIN NOISE — null control. The revision repoints two references/ link paths, '
      + 'and references/ is outside the measured surface by the manifest\'s own scoping rule.',
  },
  {
    slug: 'git-workflow-and-versioning',
    model: 'claude-sonnet-5',
    report005Delta: 0.116,
    basis: 'largest #005 effect (+0.116; runner-up gpt-5.6-sol -0.002)',
    prediction: 'WITHIN NOISE — description-only revision, measurable as context and not as a trigger.',
  },
  {
    slug: 'writing-plans',
    model: 'claude-fable-5',
    report005Delta: 0.177,
    basis: 'largest #005 effect (+0.177), but a TIE — sonnet-5 at +0.176, inside its own band',
    prediction: 'the one cell with a plausible signal — a new required field in the plan-header template.',
  },
];

function suiteCaseCount(slug) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', slug, 'evals.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.cases || raw.evals);
  return list.length;
}

function measuredBasisUSD(slug, model) {
  // What #005 actually metered for this cell, which is the honest projection.
  //
  // SCALED BY THE DRAW FACTOR. #005 ran ONE generation draw per arm, so its
  // metered basis is a one-draw basis; a v0.5 run of the same cell draws up to
  // SAMPLING.max times. Comparing an unscaled basis against a scaled guard is
  // comparing two different runs, which is how this plan briefly reported a
  // ~1.1x under-projection for a table that under-projects by an order of
  // magnitude.
  const p = path.join(R5, `${slug}__${model}.json`);
  if (!fs.existsSync(p)) return null;
  const e = JSON.parse(fs.readFileSync(p, 'utf8')).economics;
  if (!e) return null;
  const n = suiteCaseCount(slug);
  const oneDraw = n * (e.with_skill.mean_cost_usd_per_call + e.baseline.mean_cost_usd_per_call)
    + e.judge_overhead.total_cost_usd;
  return oneDraw * SAMPLING.max;
}

function plan() {
  const rows = CELLS.map((c) => {
    const n = suiteCaseCount(c.slug);
    // AT SAMPLING.max, like every other figure in this plan. Leaving this at one
    // draw while the dollar projection moved to ten made the three columns
    // describe three different runs, and the ratio printed below meaningless.
    const calls = projectCalls(n, SAMPLES, SAMPLING.max);
    const formula = estimateRunCostUSD({ draws: SAMPLING.max, caseCount: n, samples: SAMPLES, models: [c.model], judgeModel: JUDGE_MODEL,
    }).totalUSD;
    return { ...c, cases: n, calls, formulaUSD: formula, measuredUSD: measuredBasisUSD(c.slug, c.model) };
  });
  const totals = rows.reduce((a, r) => ({
    calls: a.calls + r.calls,
    formula: a.formula + r.formulaUSD,
    measured: a.measured + (r.measuredUSD || 0),
  }), { calls: 0, formula: 0, measured: 0 });
  return { rows, totals };
}

function printPlan({ rows, totals }, { dryRun }) {
  console.log('');
  console.log(`Report #006 — revision drift${dryRun ? '  [DRY RUN — no model call, no network call, nothing spent]' : ''}`);
  console.log('');
  console.log('  Pinned-text arm: REUSED from Report #005 (free) — the substrate resolves identically.');
  console.log('  Current-text arm: fresh runs, below.');
  console.log('');
  for (const r of rows) {
    console.log(`  cell  ${r.slug} @ ${r.model}`);
    console.log(`        substrate basis : ${r.basis}`);
    console.log(`        #005 delta      : ${r.report005Delta >= 0 ? '+' : ''}${r.report005Delta.toFixed(3)}`);
    console.log(`        pre-registered  : ${r.prediction}`);
    console.log(`        cases ${r.cases} × ${SAMPLING.max} draws × (2 + 2×${SAMPLES}) = ${r.calls} calls   guard $${r.formulaUSD.toFixed(4)}   measured basis $${(r.measuredUSD || 0).toFixed(3)}`);
    console.log(`        cap             : --max-usd ${MAX_USD_PER_CELL}`);
    console.log('');
  }
  console.log(`  TOTAL: ${totals.calls} model calls  ·  guard projection $${totals.formula.toFixed(4)}  ·  measured basis $${totals.measured.toFixed(2)}`);
  console.log('');
  console.log(`  The guard projection is a fixed token table and under-projects these cells ~${(totals.measured / totals.formula).toFixed(1)}×`);
  console.log('  (the CLI harness preamble it does not model). --max-usd bounds CALL VOLUME, not dollars;');
  console.log(`  the dollar figure this study carries is the measured basis, $${totals.measured.toFixed(2)}.`);
  console.log('');
}

// ── the current-text workdir preflight (AC-12) ───────────────────────────────
// The current-text arm runs against `<workdir>/<slug>/SKILL.md`, which this loop
// deliberately does not populate: `scripts/fetch-skills.js` is a non-goal here
// and is invoked separately. That left the whole measured basis with nothing
// checking that the bytes about to be measured are the bytes the manifest
// pinned. A run started before the staging fails at the first cell, which is
// merely annoying; a workdir staged from the WRONG revision spends the entire
// budget measuring the wrong text and reports the result as a revision verdict,
// which is not. One hash per cell closes both, and it runs before the first call
// rather than after it.
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function manifestPins() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', 'manifest.json'), 'utf8'));
  const out = {};
  for (const s of ((m.report_006_pins || {}).skills || [])) out[s.slug] = s;
  return out;
}

// Returns [] when every cell's staged SKILL.md hashes to its pin. Fetches
// nothing, writes nothing, spends nothing. `pins` is injectable so the passing
// path can be exercised by a gate without third-party bytes entering the tree.
function workdirPreflight(rows, { workdir = WORKDIR, pins = null } = {}) {
  const P = pins || manifestPins();
  const problems = [];
  for (const cell of rows) {
    const pin = P[cell.slug];
    if (!pin || !pin.content_sha256) {
      problems.push({ slug: cell.slug, reason: 'no report_006_pins entry carrying a content_sha256 — there is nothing to verify the staged text against' });
      continue;
    }
    const f = path.join(workdir, cell.slug, 'SKILL.md');
    if (!fs.existsSync(f)) {
      problems.push({ slug: cell.slug, reason: `no SKILL.md at ${f} — the current-text arm has not been staged` });
      continue;
    }
    const got = sha256(fs.readFileSync(f));
    if (got !== pin.content_sha256) {
      problems.push({ slug: cell.slug, reason: `staged SKILL.md is sha256 ${got.slice(0, 12)}…, the manifest pins ${pin.content_sha256.slice(0, 12)}… — this workdir holds a different revision from the one the study is pinned to` });
    }
  }
  return problems;
}

// ── the spend seam ───────────────────────────────────────────────────────────
// The one place this study spends. Isolated behind an injectable seam so the
// preflight that guards it can be exercised — and its ORDERING proved — by a
// gate that makes no model call.
function spawnRun(cell, dir, outDir) {
  execFileSync(process.execPath, [
    path.join(ROOT, 'bin', 'driftproof'), 'run', dir,
    '--models', cell.model,
    '--samples', String(SAMPLES),
    '--judge-model', JUDGE_MODEL,
    '--max-usd', String(MAX_USD_PER_CELL),
    '--out', outDir,
  ], { stdio: 'inherit' });
}

// The preflight lives in the same function as the loop it guards, ahead of it,
// so there is no arrangement of callers in which the spend happens and the check
// does not.
function executeCells(rows, { workdir = WORKDIR, outDir = OUT, pins = null, spawn = spawnRun } = {}) {
  const problems = workdirPreflight(rows, { workdir, pins });
  if (problems.length) {
    const err = new Error('workdir preflight failed');
    err.code = 'PREFLIGHT';
    err.problems = problems;
    throw err;
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const cell of rows) {
    console.log(`  running ${cell.slug} @ ${cell.model} (cap $${MAX_USD_PER_CELL}) …`);
    spawn(cell, path.join(workdir, cell.slug), outDir);
  }
  return rows.length;
}

// ── the control, recorded rather than logged (AC-6) ──────────────────────────
// AC-6 says the comparison is "computed and recorded per cell". It was computed
// and printed; the control object and the drift markdown were both discarded. A
// control nobody can re-read afterwards is not a record. Both are written beside
// the receipts, and a BLOCKED cell writes its control and NO markdown — which is
// the persisted, checkable proof that no verdict was emitted past a failed
// control.
function recordCell(outDir, cell, result, receiptFile = null) {
  fs.mkdirSync(outDir, { recursive: true });
  // The sidecars are named after the RECEIPT they describe, not after a second
  // convention invented here: a cell's receipt, control record and drift report
  // sort together and are obviously one another's. `receiptFile` is null only in
  // the gate's synthetic probes, which never touch a real receipt.
  const base = receiptFile ? path.basename(receiptFile, '.json') : `${cell.slug}__${cell.model}`;
  const controlPath = path.join(outDir, `${base}.control.json`);
  // A cell is NOT MEASURED for either of two reasons, and the record names which:
  // the pair was not a revision pair (AC-13), or the substrate did not reproduce
  // (AC-6). A record that said only "blocked" would lose that distinction, which
  // is the one a reader of the receipts needs.
  const blocked = Boolean(result.pairProblem) || result.control.blocked;
  fs.writeFileSync(controlPath, `${JSON.stringify({
    cell: cell.slug,
    model: cell.model,
    verdict: blocked ? 'NOT MEASURED' : 'MEASURED',
    blocked,
    pair_problem: result.pairProblem || null,
    control: result.control,
    recorded_at: new Date().toISOString(),
  }, null, 2)}\n`);
  let markdownPath = null;
  if (result.markdown) {
    markdownPath = path.join(outDir, `${base}.revision.md`);
    fs.writeFileSync(markdownPath, result.markdown);
  }
  return { controlPath, markdownPath };
}

// ── finding the fresh receipt the spend actually produced ────────────────────
// The verdict path composed `${slug}__${model}.json` and read it. Nothing writes
// that name. `bin/driftproof run` — which IS the spend seam — names its output
// `<slug>-<model>-<YYYY-MM-DD>.json`, the CLI's own convention, and #005's
// `slug__model.json` receipts were written in-process by a generator that never
// shelled out. So the runner spent the study's whole basis and then read a path
// that had never existed on any run.
//
// Every test drove the seam through a recorder that returns without writing a
// file, because NFR-1 forbids the gate from spending. The isolation that made the
// spend safe to test is the same isolation that kept the real filename out of
// every assertion.
//
// The fix is on the READER. The receipts are hash-verified artifacts exactly as
// the CLI wrote them, and renaming a hash-covered artifact to satisfy a consumer
// is the wrong direction — so the consumer learns the convention instead. It
// matches on the receipt's own attested `skill.name` and `run.model_id` rather
// than on the filename, because slug and model both contain hyphens and any rule
// for splitting the name is a guess where the file itself holds the answer.
function freshReceiptFor(cell, outDir = OUT) {
  if (!fs.existsSync(outDir)) return null;
  const hits = fs.readdirSync(outDir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.control.json'))
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
        return (r && r.skill && r.run && r.skill.name === cell.slug && r.run.model_id === cell.model)
          ? path.join(outDir, f) : null;
      } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort();
  // More than one receipt for a cell means the cell was run twice. Picking one
  // silently would make the report depend on directory order, so it is named.
  if (hits.length > 1) throw new Error(`${cell.slug} @ ${cell.model}: ${hits.length} receipts in ${path.relative(ROOT, outDir)} — remove the stale one, the verdict must not depend on which is read: ${hits.map((h) => path.basename(h)).join(', ')}`);
  return hits[0] || null;
}

// The AC-6 control. Applied to every cell BEFORE any verdict is emitted: the
// fresh run's baseline arm carries no skill text, so it re-measures the substrate
// the reused pinned arm assumes. A cell that does not reproduce is NOT MEASURED.
function verdictForCell(cell, freshReceiptPath) {
  const reused = JSON.parse(fs.readFileSync(path.join(R5, `${cell.slug}__${cell.model}.json`), 'utf8'));
  const fresh = JSON.parse(fs.readFileSync(freshReceiptPath, 'utf8'));
  // AC-13, approval finding F-009-G. `--mode revision` refuses a pair that is not
  // a revision pair, but that refusal lives in bin/driftproof, which is where a
  // person types a diff. THIS is the path that produces the report's verdicts, and
  // it called buildDriftReport directly — so the check that exists to keep release
  // drift out of a revision report did not guard the verdicts the report publishes.
  // A differing model_id here would be release drift rendered under a revision
  // title; an equal content_hash would be a rendered tautology.
  const pairProblem = revisionPairProblem(reused, fresh);
  const control = baselineControl(reused, fresh);
  if (pairProblem) {
    return {
      cell: cell.slug, pairProblem, control, markdown: null,
      verdict: 'NOT MEASURED',
    };
  }
  if (control.blocked) {
    return { cell: cell.slug, pairProblem: null, control, verdict: 'NOT MEASURED', markdown: null };
  }
  const drift = buildDriftReport(reused, fresh, {
    labelA: 'pinned', labelB: 'current', mode: 'revision',
  });
  return { cell: cell.slug, pairProblem: null, control, verdict: drift.perCase, markdown: drift.markdown };
}

// ── the T1 spend gate (AC-12's sibling: AC-14) ───────────────────────────────
// Approval finding F-009-H. `--execute` checked that the approval path EXISTED,
// and nothing else — not the verdict, not the blocking findings, not the SHA. A
// rejected record, an approval of a different commit, or any unrelated file on
// disk bought the whole $26.88 run. scripts/merge-check.js already decides what
// makes an approval an approval, at the merge; the same two functions decide it
// here, at the spend, so the two gates cannot come to different answers.
//
// The commit is compared against the SUBJECT of HEAD — the tip with trailing
// evidence-only commits walked back, merge-check's own rule — so the study spends
// from the tree that was approved or it does not spend. This repo merges with a
// merge commit, and a merge commit is its own subject, so an approval of the
// branch tip stops matching once the branch lands: run before the merge, or take
// a fresh approval naming the commit the run will spend from. There is
// deliberately no flag that relaxes it, for the reason merge-check.js has no
// --force.
function approvalRunProblems(approvalPath, { head = null, root = ROOT } = {}) {
  if (!approvalPath) return ['no --approval <path> was given, and an approval is what permits the spend'];
  if (!fs.existsSync(approvalPath)) return [`no approval record at ${approvalPath} — the path names nothing on disk`];
  const tip = head || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const { subject } = resolveSubject(tip, root);
  const record = approvalFields(fs.readFileSync(approvalPath, 'utf8'), path.basename(approvalPath));
  return approvalProblems(record, subject);
}

function main(argv = process.argv.slice(2), { spawn = spawnRun } = {}) {
  const execute = argv.includes('--execute');
  const approvalIdx = argv.indexOf('--approval');
  const approval = approvalIdx >= 0 ? argv[approvalIdx + 1] : null;
  const workdirIdx = argv.indexOf('--workdir');
  const workdir = workdirIdx >= 0 && argv[workdirIdx + 1] ? path.resolve(argv[workdirIdx + 1]) : WORKDIR;

  const p = plan();

  // Re-drive the verdict/record phase over receipts that already exist. It
  // spends nothing — `executeCells` is not reachable from here — so it is not
  // gated on an approval, and it is deliberately a SEPARATE flag from --execute
  // rather than a fallback inside it: a path that can decide "the receipts look
  // present, skip the run" is a path that can skip a run nobody meant to skip.
  if (argv.includes('--record-only')) {
    console.log('');
    console.log('  Report #006 — verdict/record phase only. No model call, no network call, nothing spent.');
    console.log('');
    recordPhase(p.rows);
    return;
  }

  if (!execute) {
    printPlan(p, { dryRun: true });
    console.log('  To run: --execute --approval <path to the fresh-context approval record>');
    console.log('');
    return;
  }

  // Spec 009 is T1. A T1 run follows a fresh-context approval of the spec and
  // gate, and a separate green light for the spend. Neither is a flag this
  // script can grant itself, so it refuses without the record.
  const approvalProblemList = approvalRunProblems(approval);
  if (approvalProblemList.length) {
    console.error('  ✗ REFUSED: --approval must name a fresh-context approval record that approves THIS commit.');
    for (const pr of approvalProblemList) console.error(`    ${pr}`);
    console.error('    Spec 009 is T1: the run follows /spec-approve of the spec and gate, then a separate green light.');
    console.error('    NOTHING WAS SPENT.');
    process.exit(6);
  }

  printPlan(p, { dryRun: false });

  // AC-12. Nothing has been spent at this point, and nothing is spent past this
  // point unless every staged SKILL.md hashes to the revision the manifest pins.
  try {
    executeCells(p.rows, { workdir, spawn });
  } catch (e) {
    if (e && e.code === 'PREFLIGHT') {
      console.error('');
      console.error('  ✗ REFUSED (workdir preflight): the staged current-text arm is not the pinned revision.');
      for (const pr of e.problems) console.error(`    ${pr.slug}: ${pr.reason}`);
      console.error('    NOTHING WAS SPENT. Stage the workdir from the pinned raw URLs, then re-run.');
      process.exit(7);
    }
    throw e;
  }

  recordPhase(p.rows);
}

// The verdict/record phase, separated from the spend so it can be re-driven over
// receipts that already exist. It reads receipts and writes control records; it
// makes no model call and cannot reach the spend seam, which is why it does not
// sit behind the AC-14 approval gate — that gate exists to guard a spend, and
// there is none here.
function recordPhase(rows, { outDir = OUT } = {}) {
  for (const cell of rows) {
    const fresh = freshReceiptFor(cell, outDir);
    if (!fresh) {
      console.error(`  ✗ ${cell.slug} @ ${cell.model}: no receipt in ${path.relative(ROOT, outDir)} — this cell did not produce one`);
      process.exitCode = 1;
      continue;
    }
    const r = verdictForCell(cell, fresh);
    const written = recordCell(outDir, cell, r, fresh);
    if (r.pairProblem) {
      console.log(`  ${cell.slug}: NOT MEASURED — ${r.pairProblem} makes this pair a comparison other than a revision (AC-13)`);
    }
    console.log(`  ${cell.slug}: baseline control → ${r.control.verdict} (${r.control.reason})`);
    console.log(`      recorded: ${path.relative(ROOT, written.controlPath)}${written.markdownPath
      ? `  ·  drift report: ${path.relative(ROOT, written.markdownPath)}`
      : '  ·  no drift report written — the cell is NOT MEASURED'}`);
  }
}

if (require.main === module) main();
module.exports = {
  CELLS, MAX_USD_PER_CELL, plan, verdictForCell,
  workdirPreflight, executeCells, recordCell, spawnRun, approvalRunProblems, main,
  freshReceiptFor, recordPhase,
};
