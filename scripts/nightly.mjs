#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/nightly.mjs - the nightly full sweep of dev (spec 051; CONSTITUTION § Proportional
// oversight, clause 3).
//
// One full sweep runs on dev each night, alone on the box. This script:
//   1. takes its own lock, so two nightlies never overlap, and records any other gate, sweep or
//      driver process running at its start and at its end (it stops nobody; the report says
//      whether it ran alone);
//   2. clones the source repository fresh, checks out dev, pins main to the source's main, and
//      copies in the ignored inputs the gates read (node_modules and the ignored run bundles under
//      specs/), from --inputs-from;
//   3. copies the reference OUT of the clone before the sweep writes over it: the last green
//      nightly's emission, or, before the first green, the emission committed in the tree;
//   4. runs spec 029's emitter, `sweep.mjs --emit --against <reference>`, in the clone;
//   5. keeps the emission (sweep-run.json and sweep-raw/) under <state>/runs/<stamp>-<sha8>/,
//      outside every tree: a nightly commit would move dev under every session every night;
//   6. reads each run against the reference with sweep.mjs's own newReds, lists the merges on dev
//      since the last green, and writes a one-screen report.md, morning-report.md, last.json and,
//      when green, last-green.json. A partial run (--only) writes its report and last-partial.json
//      only: it is never the reference a later check reads.
// Exit 0 green, 1 red, 2 when it could not sweep.
//
//   node scripts/nightly.mjs [--repo <path|url>] [--ref dev] [--state <dir>] [--inputs-from <checkout>]
//                            [--only <spec,spec>]
//
// Defaults: --repo is the `private` remote of the checkout this script sits in; --state is
// $DP_NIGHTLY_DIR or ~/.driftproof-nightly; --inputs-from is that checkout. `--only` makes a
// partial sweep, for a proof or a re-run, and the report says so. The cron line is scripts/nightly.cron.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EMISSION = 'specs/029-scanner-loop/evidence/sweep-run.json';
const RAW = 'specs/029-scanner-loop/evidence/sweep-raw';
const MAX_LINES = 40;

const HOME = os.homedir();
const tilde = (s) => String(s).split(HOME + '/').join('~/');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...o });
const git = (cwd, ...a) => { const r = run('git', ['-C', cwd, ...a]); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${(r.stderr || '').trim()}`); return r.stdout.trim(); };
const gitTry = (cwd, ...a) => { const r = run('git', ['-C', cwd, ...a]); return r.status === 0 ? r.stdout.trim() : null; };
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const repo = opt('--repo') || gitTry(ROOT, 'remote', 'get-url', 'private') || ROOT;
const ref = opt('--ref', 'dev');
const state = path.resolve(opt('--state') || process.env.DP_NIGHTLY_DIR || path.join(HOME, '.driftproof-nightly'));
const inputsFrom = path.resolve(opt('--inputs-from') || ROOT);
const only = opt('--only') ? opt('--only').split(',').filter(Boolean) : null;

// ── the lock and the box ─────────────────────────────────────────────────────────────────────
function takeLock(file) {
  for (let i = 0; i < 3; i++) {
    try { fs.writeFileSync(file, String(process.pid), { flag: 'wx' }); return true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const pid = Number(fs.readFileSync(file, 'utf8')) || 0;
    try { if (pid) { process.kill(pid, 0); return pid; } } catch { /* dead: take it over */ }
    fs.rmSync(file, { force: true });
  }
  return 'unknown';
}

// Other gate, sweep and driver processes: this process, its ancestors (whatever launched it) and
// its descendants are not "other".
function ppidOf(pid) { try { return Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')[1]); } catch { return 0; } }
function others() {
  const mine = new Set([process.pid]);
  for (let p = ppidOf(process.pid); p > 1; p = ppidOf(p)) mine.add(p);
  const found = [];
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number); } catch { return { readable: false, found }; }
  const descends = (pid) => { for (let p = pid, n = 0; p > 1 && n < 64; p = ppidOf(p), n++) if (p === process.pid) return true; return false; };
  for (const pid of pids) {
    if (mine.has(pid) || descends(pid)) continue;
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' '); } catch { continue; }
    if (/(^|\/)gate\.(sh|mjs)\b|sweep\.mjs|drive\.mjs|nightly\.mjs/.test(cmd)) found.push({ pid, cmd: tilde(cmd).slice(0, 140) });
  }
  return { readable: true, found };
}

// ── the clone ────────────────────────────────────────────────────────────────────────────────
function ignoredInputs(from) {
  const r = run('git', ['-C', from, 'status', '--porcelain=v1', '--ignored', '-z']);
  if (r.status !== 0) return ['node_modules'];
  const paths = r.stdout.split('\0').filter((e) => e.startsWith('!! ')).map((e) => e.slice(3).replace(/\/$/, ''));
  const specs = paths.filter((p) => p.startsWith('specs/') && !/(^|\/)\.gate-results$|\.log$|(^|\/)gate-results[^/]*\.json$/.test(p));
  return ['node_modules', ...specs];
}

async function main() {
  fs.mkdirSync(path.join(state, 'runs'), { recursive: true });
  const lockFile = path.join(state, 'nightly.lock');
  const got = takeLock(lockFile);
  if (got !== true) { process.stderr.write(`nightly: another nightly holds ${tilde(lockFile)} (pid ${got})\n`); return 2; }
  try { return await sweep(); } finally { fs.rmSync(lockFile, { force: true }); }
}

async function sweep() {
  const startedAt = new Date();
  const atStart = others();
  const runDir = path.join(state, 'runs', `${stamp()}`);
  const tree = path.join(runDir, 'tree');
  fs.mkdirSync(runDir, { recursive: true });
  const cl = run('git', ['clone', '-q', '--no-checkout', ...(fs.existsSync(path.join(inputsFrom, '.git')) ? ['--reference-if-able', inputsFrom, '--dissociate'] : []), repo, tree]);
  if (cl.status !== 0) { process.stderr.write(`nightly: clone of ${tilde(repo)} failed: ${cl.stderr}\n`); return 2; }
  const sha = git(tree, 'rev-parse', `origin/${ref}`);
  git(tree, 'checkout', '-q', '-B', ref, sha);
  const main = gitTry(tree, 'rev-parse', '--verify', '-q', 'origin/main');
  if (main && ref !== 'main') git(tree, 'branch', '-f', 'main', main);
  const copied = [];
  for (const rel of ignoredInputs(inputsFrom)) {
    const src = path.join(inputsFrom, rel);
    if (!fs.existsSync(src) || fs.existsSync(path.join(tree, rel))) continue;
    fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
    if (run('cp', ['-a', src, path.join(tree, rel)]).status === 0) copied.push(rel);
  }

  // The reference, copied out before the emitter writes over the tree's own emission.
  const lastGreen = readJson(path.join(state, 'last-green.json'));
  let reference = null; let refSource; let greenCommit;
  const greenRecord = lastGreen ? readJson(path.resolve(state, lastGreen.run_dir, 'sweep-run.json')) : null;
  // a partial record is refused as a reference wherever it came from (A-051-1)
  if (greenRecord && !lastGreen.partial && !(greenRecord.emission && greenRecord.emission.partial)) {
    reference = greenRecord;
    refSource = `the last green nightly, ${lastGreen.run_dir}`;
    greenCommit = lastGreen.commit;
  } else {
    const committed = gitTry(tree, 'show', `HEAD:${EMISSION}`);
    reference = committed ? JSON.parse(committed) : null;
    refSource = 'the emission committed in the tree (no green nightly yet)';
    greenCommit = reference && reference.emission ? reference.emission.commit : null;
  }
  const refFile = path.join(runDir, 'reference.json');
  if (reference) fs.writeFileSync(refFile, JSON.stringify(reference));

  const emitArgs = ['specs/029-scanner-loop/probes/sweep.mjs', '--emit', ...(reference ? ['--against', refFile] : []), ...(only ? ['--only', only.join(',')] : [])];
  const env = { ...process.env, DP_LOCK_OWNER: process.env.DP_LOCK_OWNER || 'nightly' };
  const t0 = Date.now();
  const em = run(process.execPath, emitArgs, { cwd: tree, env, timeout: 8 * 3600 * 1000 });
  fs.writeFileSync(path.join(runDir, 'emit.log'), tilde(`# node ${emitArgs.join(' ')}\n# exit ${em.status}\n${em.stdout || ''}${em.stderr || ''}`));
  const emission = readJson(path.join(tree, EMISSION));
  const fresh = emission && emission.emission && emission.emission.commit === sha;
  if (fresh) {
    fs.copyFileSync(path.join(tree, EMISSION), path.join(runDir, 'sweep-run.json'));
    if (fs.existsSync(path.join(tree, RAW))) run('cp', ['-a', path.join(tree, RAW), path.join(runDir, 'sweep-raw')]);
  }
  return report({ startedAt, atStart, runDir, tree, sha, emission: fresh ? emission : null, em, reference, refSource, greenCommit, copied, wall: Date.now() - t0 });
}

// ── the reading and the report ───────────────────────────────────────────────────────────────
function mergeLines(merges) {
  const out = [`Merges on ${ref} since the last green (${merges.length}):`];
  for (const m of merges.slice(0, 10)) out.push(`  - ${m.sha.slice(0, 8)} ${m.subject.slice(0, 100)}`);
  if (merges.length > 10) out.push(`  - ... and ${merges.length - 10} more (git log --first-parent --merges)`);
  if (!merges.length) out.push('  - none');
  return out;
}

async function readRows(reference, emission) {
  const { newReds } = await import(pathToFileURL(path.join(ROOT, 'specs/029-scanner-loop/probes/sweep.mjs')).href);
  return newReds(reference, emission.runs);
}

async function report(r) {
  const subject = gitTry(r.tree, 'log', '-1', '--format=%s', r.sha) || '';
  let merges = []; let mergeNote = '';
  if (r.greenCommit && gitTry(r.tree, 'merge-base', '--is-ancestor', r.greenCommit, r.sha) !== null) {
    const out = gitTry(r.tree, 'log', '--first-parent', '--merges', '--format=%H %s', `${r.greenCommit}..${r.sha}`) || '';
    merges = out.split('\n').filter(Boolean).map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) }));
  } else mergeNote = r.greenCommit ? `the last green ${r.greenCommit.slice(0, 8)} is not an ancestor of ${r.sha.slice(0, 8)}` : 'no last green to count from';
  const atEnd = others();
  const rows = r.emission ? await readRows(r.reference, r.emission) : [];
  const newRed = rows.filter((x) => x.verdict === 'new-red');
  const c = r.emission && r.emission.conduct;
  const conductClean = !!(c && c.nfr2.refs_clean && !c.nfr2.unexcused.length && !c.nfr2.survived_restore.length && !c.nfr3.left.length);
  const verdict = !r.emission ? 'ERROR' : (newRed.length === 0 && conductClean ? 'GREEN' : 'RED');
  const alone = r.atStart.found.length === 0 && atEnd.found.length === 0;
  const lines = [
    `# Driftproof nightly ${r.startedAt.toISOString().slice(0, 16)}Z: ${verdict}`,
    '',
    `${ref} at ${r.sha.slice(0, 8)} "${subject.slice(0, 90)}"`,
    `Compared with ${r.greenCommit ? r.greenCommit.slice(0, 8) : 'nothing'}: ${r.refSource}.`,
    r.emission ? `Swept ${r.emission.runs.length} gates in ${(r.wall / 60000).toFixed(1)} min${only ? ` (PARTIAL: --only ${only.join(',')})` : ' (full)'}; emitter exit ${r.em.status}.` : `The emitter wrote no emission for ${r.sha.slice(0, 8)} (exit ${r.em.status}); see emit.log.`,
    `Alone on the box: ${alone ? 'yes' : `no: ${r.atStart.found.length} other gate, sweep or driver process(es) at start, ${atEnd.found.length} at the end`}.`,
    c ? `Conduct: refs ${c.nfr2.refs_clean ? 'unmoved' : 'MOVED'}, ${c.nfr2.unexcused.length} unexcused write(s), ${c.nfr2.survived_restore.length} unrestored, ${c.nfr3.left.length} sandbox(es) left.` : 'Conduct: not recorded.',
    '',
    `New reds (${newRed.length}):`,
  ];
  for (const x of newRed.slice(0, 12)) lines.push(`  - ${x.spec}: fails ${x.failing.join(', ') || '(no id)'}; ${x.why}; reads ${x.reads || 'no figure'}, was ${x.reference_reads || 'not run'}`);
  if (newRed.length > 12) lines.push(`  - ... and ${newRed.length - 12} more in result.json`);
  if (!newRed.length) lines.push('  - none');
  lines.push('');
  lines.push(...mergeLines(merges));
  if (mergeNote) lines.push(`  (${mergeNote})`);
  lines.push('');
  lines.push(`Record: ${tilde(path.join(r.runDir, 'sweep-run.json'))}`);
  if (verdict !== 'GREEN') lines.push('Next: the next change is the fix or a revert (CONSTITUTION § Proportional oversight, clause 3).');
  const text = lines.slice(0, MAX_LINES).join('\n') + '\n';

  const rel = path.relative(state, r.runDir);
  const result = { verdict, commit: r.sha, subject, ref, repo: tilde(repo), started: r.startedAt.toISOString(), wall_ms: r.wall, partial: only, reference: { source: r.refSource, commit: r.greenCommit }, new_red: newRed, rows, merges, alone, others_at_start: r.atStart, others_at_end: atEnd, inputs_copied: r.copied, emitter_exit: r.em.status };
  fs.writeFileSync(path.join(r.runDir, 'report.md'), text);
  fs.writeFileSync(path.join(r.runDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  // A partial run (--only) is never a reference: it writes last-partial.json and nothing that
  // --core or the next nightly reads (spec 051 A-051-1, F-1). Only a full sweep moves last.json,
  // last-green.json and the morning report.
  const last = { run_dir: rel, commit: r.sha, verdict, partial: only, at: new Date().toISOString() };
  if (r.emission && !only) {
    fs.writeFileSync(path.join(state, 'morning-report.md'), text);
    fs.writeFileSync(path.join(state, 'last.json'), JSON.stringify(last, null, 2) + '\n');
    if (verdict === 'GREEN') fs.writeFileSync(path.join(state, 'last-green.json'), JSON.stringify(last, null, 2) + '\n');
  } else if (r.emission) {
    fs.writeFileSync(path.join(state, 'last-partial.json'), JSON.stringify(last, null, 2) + '\n');
  }
  fs.rmSync(r.tree, { recursive: true, force: true });
  process.stdout.write(text);
  return verdict === 'GREEN' ? 0 : verdict === 'RED' ? 1 : 2;
}

Promise.resolve(main()).then((code) => process.exit(code), (e) => { process.stderr.write(`nightly: ${e.stack || e.message}\n`); process.exit(2); });
