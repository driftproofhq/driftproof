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
//   7. runs the local CodeQL scan over the tree the public build publishes (spec 148) and sets its
//      results against config/codeql-baseline.json. A result off the baseline makes the sweep RED,
//      so the release stops before the public push; a scan that cannot be read makes it ERROR, never
//      green. A full sweep always scans. A partial sweep (--only) scans only when asked with --codeql,
//      and says so in its report when it did not.
// Exit 0 green, 1 red, 2 when it could not sweep.
//
//   node scripts/nightly.mjs [--repo <path|url>] [--ref dev] [--state <dir>] [--inputs-from <checkout>]
//                            [--only <spec,spec>] [--candidate <candidate.json>]
//                            [--codeql] [--codeql-only] [--codeql-script <file>] [--codeql-out <dir>]
//
// Defaults: --repo is the `private` remote of the checkout this script sits in; --state is
// $DP_NIGHTLY_DIR or ~/.driftproof-nightly; --inputs-from is that checkout. `--only` makes a
// partial sweep, for a proof or a re-run, and the report says so. The cron line is scripts/nightly.cron.
// `--candidate` (spec 067) names the integrator's train/candidate.json: the sweep checks out the
// candidate's SHA, which must be on a branch of the clone, instead of the tip of --ref, and the result
// names the file. Without it nothing here changes.
// `--codeql` (spec 148) makes a partial sweep run the CodeQL scan too. `--codeql-only` runs the scan
// alone, on the same clone, and writes its report: exit 0 nothing new, 1 a result off the baseline, 2
// the scan could not be read; it moves no state file. `--codeql-script` names the script that makes the
// scan, in place of scripts/codeql-local.sh in the clone (a proof run's stand-in); the report names the
// script it ran. The scan's SARIF and summary go under --codeql-out, /var/tmp/codeql-scan by default.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const codeql = createRequire(import.meta.url)('./codeql-read.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EMISSION = 'specs/029-scanner-loop/evidence/sweep-run.json';
const RAW = 'specs/029-scanner-loop/evidence/sweep-raw';
const HOLDS = 'specs/029-scanner-loop/holds.json';
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
const candidateFile = opt('--candidate') ? path.resolve(opt('--candidate')) : null;
const flag = (k) => argv.includes(k);
const wantCodeql = flag('--codeql');
const codeqlOnly = flag('--codeql-only');
const codeqlScript = opt('--codeql-script') ? path.resolve(opt('--codeql-script')) : null;
const codeqlOut = path.resolve(opt('--codeql-out') || '/var/tmp/codeql-scan');

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

// ── the local CodeQL scan (spec 148) ─────────────────────────────────────────────────────────
// scripts/codeql-local.sh scan exits 0 (nothing off the baseline), 1 (a result off it) or 2 (not
// made or not read), and writes summary.json beside the SARIF. It scans --rev <sha>, the committed
// bytes the public push publishes, and not the working copy a gate may have rewritten. Anything else, or an exit 0 or 1
// with no readable summary, is a scan that was not read.
function runCodeql(tree, sha) {
  const script = codeqlScript || path.join(tree, 'scripts', 'codeql-local.sh');
  const base = { script: codeqlScript ? tilde(codeqlScript) : 'scripts/codeql-local.sh in the swept tree' };
  if (!fs.existsSync(script)) return { ...base, state: 'unreadable', why: `${base.script} does not exist` };
  const out = path.join(codeqlOut, `${stamp()}-${sha.slice(0, 8)}`);
  const r = run('bash', [script, 'scan', '--tree', tree, '--rev', sha, '--out', out], { timeout: 60 * 60 * 1000 });
  const summary = readJson(path.join(out, 'summary.json'));
  const tail = tilde(`${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').slice(-2).join(' / ')).slice(0, 200);
  if (r.status === 0 && summary && summary.state === 'clean') return { ...base, out: tilde(out), state: 'clean', summary };
  if (r.status === 1 && summary && summary.state === 'new' && summary.new.length) return { ...base, out: tilde(out), state: 'new', summary };
  return { ...base, out: tilde(out), state: 'unreadable', why: `the scan exited ${r.status === null ? 'with a signal' : r.status} and left ${summary ? `a ${summary.state} summary` : 'no summary'}: ${tail}` };
}
// ── the tools the gates need (spec 029 A-029-2) ─────────────────────────────────────────────
// Three gates read a CLI that is not on PATH as a failure of their own. On 6 Oct 2026 a unit whose
// PATH lacked ~/.local/bin read 013, 028 and 131 red, and the report said nothing of PATH. So a
// sweep with either CLI missing does not run: it stops at its start, exit 2, naming the tool and the
// PATH it read. A scan alone (--codeql-only) runs no gate and is not held to it.
const REQUIRED_TOOLS = ['claude', 'spectrace'];
function onPath(name, PATH = process.env.PATH || '') {
  for (const dir of PATH.split(path.delimiter).filter(Boolean)) {
    const f = path.join(dir, name);
    try { if (fs.statSync(f).isFile()) { fs.accessSync(f, fs.constants.X_OK); return true; } } catch { /* not here */ }
  }
  return false;
}
const shownPath = () => tilde(process.env.PATH || '(unset)');

async function main() {
  process.stderr.write(`nightly: PATH ${shownPath()}\n`);
  if (!codeqlOnly) {
    const missing = REQUIRED_TOOLS.filter((t) => !onPath(t));
    if (missing.length) {
      process.stderr.write(`nightly: REFUSING: ${missing.join(' and ')} not found on PATH, so the gates that run ${missing.length > 1 ? 'them' : 'it'} would read red for a missing tool. Set PATH where this runs (the CLIs live in ~/.local/bin) and run again.\n  PATH: ${shownPath()}\n`);
      return 2;
    }
  }
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
  let sha; let candidate = null;
  if (candidateFile) {
    const cand = readJson(candidateFile);
    const held = cand && /^[0-9a-f]{40}$/.test(String(cand.sha)) && (gitTry(tree, 'branch', '-r', '--contains', cand.sha) || '').trim();
    if (!held) { process.stderr.write(`nightly: the candidate in ${tilde(candidateFile)} is not a commit on a branch of ${tilde(repo)}\n`); fs.rmSync(runDir, { recursive: true, force: true }); return 2; }
    sha = cand.sha;
    candidate = { file: tilde(candidateFile), sha };
  } else sha = git(tree, 'rev-parse', `origin/${ref}`);
  git(tree, 'checkout', '-q', '-B', ref, sha);
  const main = gitTry(tree, 'rev-parse', '--verify', '-q', 'origin/main');
  if (main && ref !== 'main') git(tree, 'branch', '-f', 'main', main);
  if (codeqlOnly) return reportCodeqlOnly({ startedAt, runDir, tree, sha, candidate, codeql: runCodeql(tree, sha) });
  const copied = [];
  for (const rel of ignoredInputs(inputsFrom)) {
    const src = path.join(inputsFrom, rel);
    if (!fs.existsSync(src) || fs.existsSync(path.join(tree, rel))) continue;
    // An input the swept tree has no ignore rule for would read there as untracked, and the emitter
    // refuses an unclean tree: a nested sweep of an older commit skips inputs a later spec added.
    if (rel !== 'node_modules' && run('git', ['-C', tree, 'check-ignore', '-q', `${rel}${fs.statSync(src).isDirectory() ? '/' : ''}`]).status !== 0) continue;
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
  // The scan runs after the gates, so it never shares the box with a measurement.
  const codeqlWhy = !fresh ? 'the emitter wrote no emission' : (only && !wantCodeql) ? 'a partial sweep (--only) scans only when asked with --codeql' : null;
  const cq = codeqlWhy ? { state: 'not-run', why: codeqlWhy } : runCodeql(tree, sha);
  if (fresh) {
    fs.copyFileSync(path.join(tree, EMISSION), path.join(runDir, 'sweep-run.json'));
    if (fs.existsSync(path.join(tree, RAW))) run('cp', ['-a', path.join(tree, RAW), path.join(runDir, 'sweep-raw')]);
  }
  return report({ startedAt, atStart, runDir, tree, sha, candidate, emission: fresh ? emission : null, codeql: cq, em, reference, refSource, greenCommit, copied, wall: Date.now() - t0 });
}

// ── the reading and the report ───────────────────────────────────────────────────────────────
function mergeLines(merges) {
  const out = [`Merges on ${ref} since the last green (${merges.length}):`];
  for (const m of merges.slice(0, 10)) out.push(`  - ${m.sha.slice(0, 8)} ${m.subject.slice(0, 100)}`);
  if (merges.length > 10) out.push(`  - ... and ${merges.length - 10} more (git log --first-parent --merges)`);
  if (!merges.length) out.push('  - none');
  return out;
}

// spec 065: the holds come from the tree swept, and "now" is the run's start
async function readRows(reference, emission, tree, startedAt) {
  const { newReds, readHolds } = await import(pathToFileURL(path.join(ROOT, 'specs/029-scanner-loop/probes/sweep.mjs')).href);
  return newReds(reference, emission.runs, { holds: readHolds(path.join(tree, HOLDS)), now: startedAt });
}

async function report(r) {
  const { candidate } = r;
  const subject = gitTry(r.tree, 'log', '-1', '--format=%s', r.sha) || '';
  let merges = []; let mergeNote = '';
  if (r.greenCommit && gitTry(r.tree, 'merge-base', '--is-ancestor', r.greenCommit, r.sha) !== null) {
    const out = gitTry(r.tree, 'log', '--first-parent', '--merges', '--format=%H %s', `${r.greenCommit}..${r.sha}`) || '';
    merges = out.split('\n').filter(Boolean).map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) }));
  } else mergeNote = r.greenCommit ? `the last green ${r.greenCommit.slice(0, 8)} is not an ancestor of ${r.sha.slice(0, 8)}` : 'no last green to count from';
  const atEnd = others();
  const rows = r.emission ? await readRows(r.reference, r.emission, r.tree, r.startedAt) : [];
  const newRed = rows.filter((x) => x.verdict === 'new-red');
  const c = r.emission && r.emission.conduct;
  const conductClean = !!(c && c.nfr2.refs_clean && !c.nfr2.unexcused.length && !c.nfr2.survived_restore.length && !c.nfr3.left.length);
  const cqVerdict = codeql.sweepVerdict(r.codeql);
  const verdict = !r.emission ? 'ERROR' : (newRed.length === 0 && conductClean && cqVerdict !== 'RED' ? (cqVerdict === 'ERROR' ? 'ERROR' : 'GREEN') : 'RED');
  const alone = r.atStart.found.length === 0 && atEnd.found.length === 0;
  const lines = [
    `# Driftproof nightly ${r.startedAt.toISOString().slice(0, 16)}Z: ${verdict}`,
    '',
    `${ref} at ${r.sha.slice(0, 8)} "${subject.slice(0, 90)}"`,
    `Compared with ${r.greenCommit ? r.greenCommit.slice(0, 8) : 'nothing'}: ${r.refSource}.`,
    r.emission ? `Swept ${r.emission.runs.length} gates in ${(r.wall / 60000).toFixed(1)} min${only ? ` (PARTIAL: --only ${only.join(',')})` : ' (full)'}; emitter exit ${r.em.status}.` : `The emitter wrote no emission for ${r.sha.slice(0, 8)} (exit ${r.em.status}); see emit.log.`,
    `Alone on the box: ${alone ? 'yes' : `no: ${r.atStart.found.length} other gate, sweep or driver process(es) at start, ${atEnd.found.length} at the end`}.`,
    `PATH: ${shownPath()}`,
    c ? `Conduct: refs ${c.nfr2.refs_clean ? 'unmoved' : 'MOVED'}, ${c.nfr2.unexcused.length} unexcused write(s), ${c.nfr2.survived_restore.length} unrestored, ${c.nfr3.left.length} sandbox(es) left.` : 'Conduct: not recorded.',
    ...codeql.sweepLines(r.codeql),
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
  const result = { verdict, commit: r.sha, subject, ref, repo: tilde(repo), path: shownPath(), started: r.startedAt.toISOString(), wall_ms: r.wall, partial: only, codeql: r.codeql, reference: { source: r.refSource, commit: r.greenCommit }, new_red: newRed, rows, merges, alone, others_at_start: r.atStart, others_at_end: atEnd, inputs_copied: r.copied, emitter_exit: r.em.status, ...(candidate ? { candidate } : {}) };
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

// --codeql-only: the scan's own report. It moves no state file (last.json, last-green.json, the
// morning report): it is a reading of one commit, not a sweep.
function reportCodeqlOnly(r) {
  const verdict = codeql.sweepVerdict(r.codeql) || 'GREEN';
  const subject = gitTry(r.tree, 'log', '-1', '--format=%s', r.sha) || '';
  const lines = [
    `# Driftproof CodeQL scan ${r.startedAt.toISOString().slice(0, 16)}Z: ${verdict}`,
    '',
    `${ref} at ${r.sha.slice(0, 8)} "${subject.slice(0, 90)}"`,
    ...codeql.sweepLines(r.codeql),
    `Script: ${r.codeql.script}.`,
    r.codeql.out ? `Record: ${r.codeql.out}` : 'Record: none.',
    ...(verdict === 'GREEN' ? [] : ['Next: the next change fixes the result or a recorded decision adds it to config/codeql-baseline.json.']),
  ];
  const text = `${lines.join('\n')}\n`;
  fs.writeFileSync(path.join(r.runDir, 'report.md'), text);
  fs.writeFileSync(path.join(r.runDir, 'result.json'), `${JSON.stringify({ verdict, commit: r.sha, subject, ref, repo: tilde(repo), started: r.startedAt.toISOString(), codeql: r.codeql, ...(r.candidate ? { candidate: r.candidate } : {}) }, null, 2)}\n`);
  fs.rmSync(r.tree, { recursive: true, force: true });
  process.stdout.write(text);
  return verdict === 'GREEN' ? 0 : verdict === 'RED' ? 1 : 2;
}

Promise.resolve(main()).then((code) => process.exit(code), (e) => { process.stderr.write(`nightly: ${e.stack || e.message}\n`); process.exit(2); });
