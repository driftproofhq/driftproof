#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/drive.mjs - runs a queue of spec briefs through the whole chain (spec 048).
//
// For each brief, in order: a worktree cut from the base ref; a build session; the brief's checks
// (by default the spec's own gate and the core set, `sweep.mjs --core <id>`, where the repository
// has a core set, and the spec's `gate.sh --final` where it has none) as plain shell; for a T1 or
// T2 entry, a fresh-context approval launched
// from the home directory on the standard line; the decision CONSTITUTION § Decision policy gives
// each finding, with a fix loop in a fresh context where the class asks for one (at most three per
// spec); then `ready` (pushed to the private remote, stopped for the operator's approval) or the
// merge sequence of RUNBOOK § Merge a spec branch to dev, and, when the brief asks for it, the site
// or release push under the lease rule. Every session is its own `claude -p` process with auto
// memory off, a turn cap, a cost cap and a wall-clock limit. Heavy gates, sweeps, the emission and
// the repository gate run as shell commands of this process, never inside a session.
//
// THE TIER DECIDES THE STAGES (spec 051, CONSTITUTION § Proportional oversight). Each entry carries
// `tier` and the brief's two answers, `changes_verdict` and `ships_publicly`. T1 and T2 run the
// approval and may not skip it; T3 runs none, and its branch may change only internal paths. An
// entry with no tier is T1. No stage runs a sweep: the nightly sweeps dev.
//
// Crash-safe: each stage is recorded under specs/<id>/evidence/driver/ before the next starts, and
// a restarted driver resumes at the stage that was interrupted. It stops only for a finding that
// needs a ruling, a class the policy does not name, spent loops, a spent budget, a missing
// credential, or a fault it cannot repair (a moved ref, a dirty checkout, a failed session). A stop
// writes QUESTION-<id>.md in the state directory and POSTs to $DRIVE_NOTIFY_URL when that is set;
// the next run reads the answer written into that file.
//
//   node scripts/drive.mjs run <queue.json> [--state <dir>] [--jobs N] [--stop-after <stage>]
//   node scripts/drive.mjs status <queue.json> [--state <dir>]
//
// Environment: DRIVE_CLAUDE_BIN (default `claude`), DRIVE_NOTIFY_URL, DRIVE_GH_TOKEN (or GH_TOKEN)
// and NPM_TOKEN for public actions. Tokens are never passed to a session, never written to a file
// except as the `${NPM_TOKEN}` reference npm expands, and scrubbed from every record.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const HOME = os.homedir();
const STAGES = ['worktree', 'build', 'checks', 'approve', 'triage', 'fix', 'rebase', 'ready', 'merge', 'publish'];
const STAGE_DEFAULTS = {
  build: { max_turns: 250, minutes: 150, usd: 10 },
  approve: { max_turns: 150, minutes: 60, usd: 6 },
  triage: { max_turns: 20, minutes: 10, usd: 1 },
  fix: { max_turns: 200, minutes: 120, usd: 8 },
};
const MAX_LOOPS = 3;
const SESSION_ATTEMPTS = 2;
const RULE_HEAVY = "DRIVER-RULE: do not run gate.sh --final, sibling sweeps, spec 029's emission or the repository gate; the driver runs them as shell commands after this session.";
const RULE_REFS = 'DRIVER-RULE: push nothing, merge nothing, move no ref but this spec\'s branch, write no DECISIONS.md, touch no other worktree.';
// Spec 051: T1 and T2 are approved in a fresh context; T3 is not (CONSTITUTION § Proportional oversight).
const TIERS = ['T1', 'T2', 'T3'];
const needsApproval = (tier) => tier !== 'T3';
// The paths a T3 branch may change besides its own spec directory: internal only (spec 051 R-10,
// narrowed by A-051-1 for F-2). The scripts are named one by one: most of scripts/ builds a public
// surface (site pages, receipt pages, reports) or guards the merge (merge-check.js), and a path
// guard is the one mechanical backstop against a mis-declared T3. Anything else stops the merge.
const T3_PATHS = [/^scripts\/(drive\.mjs|nightly\.mjs|nightly\.cron|browser-lock\.sh)$/, /^tests\//, /^specs\/029-scanner-loop\//, /^RUNBOOK\.md$/, /^BACKLOG\.md$/];
const CORE_SWEEP = 'specs/029-scanner-loop/probes/sweep.mjs';

// ── small utilities ─────────────────────────────────────────────────────────────────────────────
const expand = (p) => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? path.join(HOME, p.slice(1)) : p);
const tilde = (p) => (typeof p === 'string' && (p === HOME || p.startsWith(HOME + path.sep)) ? '~' + p.slice(HOME.length) : p);
// The home directory anywhere in a text, followed by a separator or by the end of a path, the bare
// form included (approval F-1: a git_ceiling of exactly HOME stayed absolute).
const HOME_IN_TEXT = new RegExp(HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9._-])', 'g');
const tildeText = (t) => String(t).replace(HOME_IN_TEXT, '~');
const iso = () => new Date().toISOString();
const stampNow = () => iso().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function secrets() {
  return ['DRIVE_GH_TOKEN', 'GH_TOKEN', 'NPM_TOKEN'].map((k) => process.env[k]).filter((v) => v && v.length >= 8);
}
function scrub(text) {
  let s = String(text);
  for (const v of secrets()) s = s.split(v).join('[redacted]');
  return s;
}
// Every value a record carries passes through here: home paths in tilde form, tokens redacted.
function clean(value) {
  if (typeof value === 'string') return scrub(tildeText(value));
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
  return value;
}
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
const writeJson = (file, obj) => writeAtomic(file, JSON.stringify(clean(obj), null, 2) + '\n');
const readJson = (file, dflt = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; } };

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function gitOk(cwd, ...args) {
  for (let i = 0; ; i++) {
    const r = git(cwd, ...args);
    if (r.code === 0) return r.out;
    // two specs committing at once can race on a ref lock; one retry after a pause settles it
    if (i < 3 && /cannot lock ref|index\.lock|packed-refs/.test(r.err)) { spawnSync('sleep', ['0.3']); continue; }
    throw new Error(`git ${args.join(' ')} (in ${tilde(cwd)}): ${r.err || r.out}`);
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// A child process with its own process group, a wall-clock limit, stdout to a raw file and a
// line callback. Detached so a limit can kill the whole group; its pgid is recorded before it
// runs, so a restarted driver can kill a session its predecessor left behind.
function runChild(cmd, args, { cwd, env, rawFile, seconds, onLine, onSpawn }) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(rawFile), { recursive: true });
    const raw = fs.createWriteStream(rawFile);
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      raw.end(); resolve({ code: -1, signal: null, timed_out: false, error: e.message }); return;
    }
    if (onSpawn) onSpawn(child.pid);
    let buf = '';
    let timedOut = false;
    let tail = [];
    const feed = (d) => {
      raw.write(scrub(d));
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        tail.push(line); if (tail.length > 40) tail = tail.slice(-40);
        if (onLine) onLine(line);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', (d) => { raw.write(scrub(d)); for (const l of String(d).split('\n')) if (l.trim()) { tail.push(l); if (tail.length > 40) tail = tail.slice(-40); } });
    const limit = seconds ? setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000).unref();
    }, seconds * 1000) : null;
    child.on('error', (e) => { tail.push(String(e.message)); });
    child.on('close', (code, signal) => {
      if (limit) clearTimeout(limit);
      if (buf) { tail.push(buf); if (onLine) onLine(buf); }
      raw.end(() => resolve({ code, signal, timed_out: timedOut, tail }));
    });
  });
}

// ── the policy, read from CONSTITUTION.md at the base ref ───────────────────────────────────────
// Read from the base ref, never from the branch: a branch that edited the table would otherwise
// choose the rules its own findings are judged by.
function readPolicy(repo, baseRef) {
  const r = git(repo, 'show', `${baseRef}:CONSTITUTION.md`);
  const text = r.code === 0 ? r.out : '';
  const m = /^## Decision policy[ \t]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(text + '\n');
  const section = m ? m[1] : '';
  const classes = {};
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const id = /^`([a-z][a-z-]*)`$/.exec(cells[1]);
    const action = /^`([a-z][a-z-]*)`$/.exec(cells[cells.length - 2]);
    if (id && action) classes[id[1]] = action[1];
  }
  return { classes, section: section.trim() };
}

// ── the queue ───────────────────────────────────────────────────────────────────────────────────
// The entry's tier, or a refusal. No tier is T1, the fail-safe. The answers set a floor: a change
// that can alter a verdict is T1, one that ships publicly at least T2, and T3 records both as no.
function resolveTier(s) {
  const declared = s.tier == null ? null : String(s.tier).toUpperCase();
  if (declared !== null && !TIERS.includes(declared)) throw new Error(`queue: ${s.id}'s tier ${JSON.stringify(s.tier)} is not T1, T2 or T3; refused`);
  const tier = declared || 'T1';
  const floor = s.changes_verdict === true ? 'T1' : s.ships_publicly === true ? 'T2' : 'T3';
  if (TIERS.indexOf(tier) > TIERS.indexOf(floor)) throw new Error(`queue: ${s.id} is declared ${tier} and its answers need ${floor}; refused (CONSTITUTION § Proportional oversight, clause 1)`);
  if (tier === 'T3' && (s.changes_verdict !== false || s.ships_publicly !== false)) throw new Error(`queue: ${s.id} is T3 and does not record both answers (changes_verdict, ships_publicly) as false; refused`);
  if (tier !== 'T3' && (s.skip_approval === true || s.approve === false)) throw new Error(`queue: ${s.id} is ${tier} and asks to skip its approval; refused (CONSTITUTION § Proportional oversight)`);
  return tier;
}

function loadQueue(file, opts) {
  const qfile = path.resolve(expand(file));
  const q = JSON.parse(fs.readFileSync(qfile, 'utf8'));
  const dir = path.dirname(qfile);
  const name = q.queue || path.basename(qfile, '.json');
  const repo = path.resolve(dir, expand(q.repo || '.'));
  const state = path.resolve(expand(opts.state || q.state_dir || path.join(dir, `${name}.drive`)));
  const merge = q.merge || {};
  const specs = (q.specs || []).map((s) => {
    const id = s.id;
    if (!/^[0-9a-z][0-9a-z-]*$/.test(id || '')) throw new Error(`queue: bad spec id ${JSON.stringify(id)}`);
    const stages = {};
    for (const k of Object.keys(STAGE_DEFAULTS)) stages[k] = { ...STAGE_DEFAULTS[k], ...((s.stages || {})[k] || {}) };
    return {
      ...s, id,
      tier: resolveTier({ ...s, id }),
      brief: path.resolve(dir, expand(s.brief)),
      branch: s.branch || `spec/${id}`,
      worktree: path.resolve(expand(s.worktree || `~/driftproof-${id.split('-')[0]}`)),
      depends_on: s.depends_on || [],
      budget_usd: Number(s.budget_usd ?? 20),
      until: s.until || 'approval-ready',
      stages,
      max_loops: Math.min(MAX_LOOPS, Number(s.max_loops ?? MAX_LOOPS)),
      // null: resolved at the checks stage, from what the worktree carries (SpecRun.checks)
      checks: s.checks || null,
    };
  });
  const emitCmd = merge.emit && merge.emit.cmd;
  if (emitCmd && /sweep\.mjs/.test(emitCmd.join(' '))) throw new Error('queue: merge.emit.cmd runs sweep.mjs, and a per-change sweep is superseded (CONSTITUTION § Proportional oversight, clause 2); refused');
  const ids = new Set(specs.map((s) => s.id));
  for (const s of specs) for (const d of s.depends_on) if (!ids.has(d)) throw new Error(`queue: ${s.id} depends on ${d}, which is not in the queue`);
  for (const s of specs) if (!['approval-ready', 'approved', 'merged', 'site', 'release'].includes(s.until)) throw new Error(`queue: ${s.id} until ${s.until} is not a target`);
  return {
    file: qfile, name, repo, state, specs,
    base_ref: q.base_ref || 'dev', remote: q.remote || 'private', budget_usd: Number(q.budget_usd ?? 50),
    // a neutral directory under ~ that is not inside any git repository: ~ itself is one on this
    // box, so git discovery is stopped at the directory's parent (P-4, the ruling of 2026-09-23)
    approve_cwd: path.resolve(expand(q.approve_cwd || '~/.driftproof-approve')),
    permission_mode: q.permission_mode || 'bypassPermissions',
    merge: {
      repo_gate: { cmd: ['node', 'tests/gate.js'], figure_file: 'tests/gate-results.json', minutes: 60, ...(merge.repo_gate || {}) },
      emit: {
        cmd: null, only: null, clone: true, copy: ['node_modules'], minutes: 180, outputs: null,
        ...(merge.emit || {}),
      },
      copy: merge.copy || ['node_modules'],
    },
  };
}

// ── one spec's run ──────────────────────────────────────────────────────────────────────────────
class SpecRun {
  constructor(q, s, driver) {
    this.q = q; this.s = s; this.driver = driver;
    this.dir = path.join(s.worktree, 'specs', s.id);
    this.recDir = path.join(this.dir, 'evidence', 'driver');
    this.rawDir = path.join(q.state, 'raw', s.id);
    this.p = readJson(path.join(this.recDir, 'progress.json')) || readJson(path.join(q.state, 'pending', `${s.id}.json`));
  }
  get state() { return this.p ? this.p.state : 'new'; }
  log(msg) { process.stdout.write(`  [${this.s.id}] ${msg}\n`); }

  save() {
    this.p.updated = iso();
    if (fs.existsSync(this.s.worktree)) writeJson(path.join(this.recDir, 'progress.json'), this.p);
    else writeJson(path.join(this.q.state, 'pending', `${this.s.id}.json`), this.p);
  }
  // Records are committed on the branch as evidence-only commits, so a real approval sees a clean
  // tree and merge-check walks back over them to the subject. After the merge starts they stay on
  // disk: a commit on the branch then would sit outside what dev merged.
  commitRecords(msg) {
    if (!this.p.commit_records || this.p.merge_commit || !fs.existsSync(this.recDir)) return;
    const rel = path.relative(this.s.worktree, this.recDir);
    gitOk(this.s.worktree, 'add', '-A', '--', rel);
    if (git(this.s.worktree, 'diff', '--cached', '--quiet', '--', rel).code === 0) return;
    gitOk(this.s.worktree, 'commit', '-q', '--no-verify', '-m', `evidence(${this.s.id}): driver ${msg} (scripts/drive.mjs)`, '--', rel);
  }

  spent() {
    let t = 0;
    for (const st of (this.p ? this.p.stages : [])) t += st.cost_usd != null ? st.cost_usd : (st.reserved_usd || 0);
    return t;
  }
  budget() { return this.s.budget_usd + ((this.p && this.p.budget_extra) || 0); }

  lastStage() { return this.p && this.p.stages.length ? this.p.stages[this.p.stages.length - 1] : null; }
  begin(stage, extra = {}) {
    const n = this.p.stages.length + 1;
    const rec = { n, stage, attempt: 1 + this.p.stages.filter((x) => x.stage === stage && x.retry_of === extra.retry_of && extra.retry_of != null).length, status: 'started', started: iso(), ...extra };
    this.p.stages.push(rec);
    this.save();
    return rec;
  }
  finish(rec, status, record, fields = {}) {
    Object.assign(rec, fields, { status, ended: iso() });
    if (record) {
      rec.record = `${rec.stage}-${pad(rec.n)}.json`;
      writeJson(path.join(this.recDir, rec.record), { kind: 'shell', spec: this.s.id, stage: rec.stage, n: rec.n, status, started: rec.started, ended: rec.ended, ...record });
    }
    this.save();
  }

  refsSnapshot() {
    const out = git(this.q.repo, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').out;
    const snap = Object.fromEntries(out.split('\n').filter(Boolean).map((l) => l.split(' ')));
    // the public tree's refs too: a local push into it needs no credential (the push guard's residual)
    const pub = this.driver.publicDir();
    if (pub) for (const l of git(pub, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').out.split('\n').filter(Boolean)) { const [r, o] = l.split(' '); snap[`public:${r}`] = o; }
    return snap;
  }
  // AC-13 (approval F-4): after every stage, every ref under refs/heads must read as it did before
  // it, except this spec's own branch and a ref this driver itself wrote to the value it now holds.
  // Another queued spec's branch is exempt only when a stage of that spec ran at the same time
  // (--jobs above 1), and that attribution is written into the record, not assumed.
  // Spec 051 (D-1): only the refs this queue owns are read - the base ref, main, each queued spec's
  // branch, and the public tree's - so a branch another session makes beside the run is not a stop.
  refsMoved(before, windowStart) {
    const after = this.refsSnapshot();
    const moved = []; const attributed = [];
    const own = `refs/heads/${this.s.branch}`;
    for (const ref of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!this.driver.watches(ref)) continue;
      if (before[ref] === after[ref] || ref === own) continue;
      if (after[ref] && (this.driver.ownWrites.get(ref) || new Set()).has(after[ref])) continue;
      const other = this.driver.concurrentOwner(ref, this.s.id, windowStart, Date.now());
      const line = `${ref} ${String(before[ref] || 'absent').slice(0, 8)} -> ${String(after[ref] || 'deleted').slice(0, 8)}`;
      if (other) attributed.push(`${line} (spec ${other}, running at the same time)`);
      else moved.push(line);
    }
    return { moved, attributed };
  }
  remoteSnapshot() {
    const out = {};
    for (const remote of git(this.q.repo, 'remote').out.split('\n').filter(Boolean)) {
      const r = spawnSync('git', ['-C', this.q.repo, 'ls-remote', '--heads', '--tags', remote], { encoding: 'utf8', env: shellEnv(), timeout: 60000 });
      if (r.status !== 0) { out[`${remote} (unreadable)`] = String(r.status); continue; }
      for (const l of (r.stdout || '').split('\n').filter(Boolean)) { const [sha, ref] = l.split('\t'); out[`${remote} ${ref}`] = sha; }
    }
    return out;
  }
  // A remote ref this driver did not push is a push from a session that got past the push guard.
  remoteMoved(before) {
    const after = this.remoteSnapshot();
    const moved = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[k] === after[k] || / \(unreadable\)$/.test(k)) continue;
      if (after[k] && (this.driver.ownRemoteWrites.get(k) || new Set()).has(after[k])) continue;
      moved.push(`${k} ${String(before[k] || 'absent').slice(0, 8)} -> ${String(after[k] || 'deleted').slice(0, 8)}`);
    }
    return moved;
  }

  // ── stops, questions, answers ─────────────────────────────────────────────────────────────────
  async stop(cls, stage, detail, evidence = []) {
    const qfile = path.join(this.q.state, `QUESTION-${this.s.id}.md`);
    this.p.state = 'stopped';
    this.p.stop = { class: cls, stage, asked: iso(), question_file: qfile, detail };
    this.save();
    try { this.commitRecords(`stop (${cls})`); } catch {}
    const text = [
      `# Driver question: spec ${this.s.id}`, '',
      `class: ${cls}`, `stage: ${stage}`, `asked: ${this.p.stop.asked}`,
      `queue: ${tilde(this.q.file)}`, `worktree: ${tilde(this.s.worktree)}`, `branch: ${this.s.branch}`,
      `spent: ${this.spent().toFixed(2)} of ${this.budget().toFixed(2)} USD for this spec; ${this.driver.queueSpent().toFixed(2)} of ${this.q.budget_usd.toFixed(2)} USD for the queue`,
      `loops: ${this.p.loops} of ${this.s.max_loops + (this.p.loops_granted || 0)}`,
      ...evidence.map((e) => `evidence: ${tilde(e)}`), '',
      tildeText(scrub(detail)), '',
      'Write one line in the Answer section at the end of this file, then run the driver again:',
      '- `ruling: <text>`  continue; the text is recorded as the operator\'s ruling under the spec\'s evidence',
      '- `budget: +<usd>`  raise this spec\'s budget by that much and retry the stage',
      '- `retry`           run the stopped stage again (after fixing what the question names)',
      '- `skip`            end this spec; specs that depend on it stay blocked',
      '- `stop`            end this spec for this queue', '',
      '## Answer', '', '',
    ].join('\n');
    writeAtomic(qfile, text);
    this.log(`STOPPED (${cls}) at ${stage}: ${tilde(qfile)}`);
    await this.driver.notify({ spec: this.s.id, class: cls, stage, question_file: tilde(qfile), asked: this.p.stop.asked, summary: tildeText(scrub(detail)).slice(0, 500) });
    return 'stopped';
  }

  readAnswer() {
    if (!this.p || this.p.state !== 'stopped') return null;
    const qfile = path.join(this.q.state, `QUESTION-${this.s.id}.md`);
    if (!fs.existsSync(qfile)) return null;
    const text = fs.readFileSync(qfile, 'utf8');
    const i = text.indexOf('\n## Answer');
    if (i < 0) return null;
    const ans = text.slice(i + '\n## Answer'.length).replace(/<!--[\s\S]*?-->/g, '').trim();
    return ans ? { ans, qfile, text } : null;
  }
  applyAnswer() {
    const a = this.readAnswer();
    if (!a) return false;
    const stop = this.p.stop;
    const answered = path.join(this.q.state, 'answered', `QUESTION-${this.s.id}-${stampNow()}.md`);
    fs.mkdirSync(path.dirname(answered), { recursive: true });
    fs.renameSync(a.qfile, answered);
    const entry = { answered: iso(), class: stop.class, stage: stop.stage, answer: a.ans, question_sha256: sha256(a.text) };
    const m = /^(ruling|budget|retry|skip|stop)\b:?\s*(.*)$/is.exec(a.ans);
    const kind = m ? m[1].toLowerCase() : 'ruling';
    const rest = m ? m[2].trim() : a.ans;
    this.p.answers = [...(this.p.answers || []), entry];
    if (kind === 'skip' || kind === 'stop') {
      this.p.state = kind === 'skip' ? 'skipped' : 'ended';
      this.save();
      return true;
    }
    if (kind === 'budget') this.p.budget_extra = (this.p.budget_extra || 0) + (Number(rest.replace(/^\+/, '')) || 0);
    if (kind === 'ruling') {
      const rulings = readJson(path.join(this.recDir, 'rulings.json'), []);
      rulings.push({ date: iso().slice(0, 10), recorded: iso(), for_class: stop.class, stage: stop.stage, ruling: rest, question_sha256: entry.question_sha256 });
      writeJson(path.join(this.recDir, 'rulings.json'), rulings);
      this.p.rulings = rulings;
      if (stop.class === 'loops-spent') this.p.loops_granted = (this.p.loops_granted || 0) + 1;
    }
    this.p.resume = { from: stop.class, stage: stop.stage, kind, ruling: kind === 'ruling' ? rest : null };
    let resume = stop.stage;
    // A ruling on an approval's finding goes through a fix loop, which writes the ruling into the
    // packet: merge-check refuses a subject any record names with a blocking finding, so the same
    // subject can never be approved again, and the loop's commit is the new subject.
    if (kind === 'ruling' && stop.stage !== 'merge' && ['ruling-needed', 'loops-spent', 'not-in-policy', 'operator-ruling', 'needs-measurement'].includes(stop.class) && this.p.last_blocking_approval) {
      this.p.pending_fix = this.p.pending_fix || { kind: 'approval', record: this.p.last_blocking_approval.file };
      this.p.loops_granted = (this.p.loops_granted || 0) + (stop.class === 'loops-spent' ? 0 : 1);
      resume = 'fix';
    }
    this.p.resume_stage = resume;
    this.p.state = 'running';
    delete this.p.stop;
    this.save();
    this.commitRecords(`answer recorded (${kind})`);
    this.log(`answer read (${kind}); resuming`);
    return true;
  }

  // ── budget ────────────────────────────────────────────────────────────────────────────────────
  async fits(stage, cap) {
    const specLeft = this.budget() - this.spent();
    const queueLeft = this.q.budget_usd + this.driver.queueExtra() - this.driver.queueSpent();
    if (cap <= specLeft + 1e-9 && cap <= queueLeft + 1e-9) return true;
    await this.stop('budget', stage, `The ${stage} stage's cap is ${cap.toFixed(2)} USD. This spec has ${specLeft.toFixed(2)} USD left and the queue ${queueLeft.toFixed(2)} USD. The driver starts no stage whose cap exceeds either.`);
    return false;
  }

  // ── the sessions ──────────────────────────────────────────────────────────────────────────────
  sessionEnv(addDir, extra = {}, ownBranch = null) {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (/^CLAUDE/.test(k)) continue;              // CLAUDECODE, CLAUDE_CODE_*, CLAUDE_PID, CLAUDE_EFFORT...
      if (/^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(k) || k === 'SSH_AUTH_SOCK') continue;
      if (['DRIVE_GH_TOKEN', 'GH_TOKEN', 'NPM_TOKEN', 'GITHUB_TOKEN', 'DRIVE_NOTIFY_URL'].includes(k)) continue;
      env[k] = v;
    }
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
    if (addDir) env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD = '1';
    return { ...env, ...this.driver.pushGuardEnv(this.s.worktree, ownBranch), ...extra };
  }
  async session(stage, { prompt, cwd, addDirs = [], tools, permissionMode, extra = {}, env: envExtra = {} }) {
    const cap = this.s.stages[stage];
    this.commitRecords(`before ${stage}`);
    if (!(await this.fits(stage, cap.usd))) return { stopped: true };
    const bin = process.env.DRIVE_CLAUDE_BIN || 'claude';
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
      '--max-turns', String(cap.max_turns), '--max-budget-usd', String(cap.usd),
      '--settings', JSON.stringify({ autoMemoryEnabled: false })];
    for (const d of addDirs) args.push('--add-dir', d);
    if (permissionMode) args.push('--permission-mode', permissionMode);
    if (tools && tools.allow) args.push('--allowedTools', tools.allow.join(','));
    if (tools && tools.deny) args.push('--disallowedTools', tools.deny.join(','));
    const rec = this.begin(stage, { reserved_usd: cap.usd, kind: 'session', ...extra });
    const rawFile = path.join(this.rawDir, `${stage}-${pad(rec.n)}.jsonl`);
    const seen = { model: null, cwd: null, session_id: null, result: null, memory_mentions: 0, memory_index_mentions: 0, gitstatus_mentions: 0 };
    const memRe = /\.claude\/projects\/[^"\s]*\/memory/g;
    const r = await runChild(bin, args, {
      cwd, env: this.sessionEnv(addDirs.length > 0, envExtra, stage === 'triage' ? null : `refs/heads/${this.s.branch}`), rawFile, seconds: cap.seconds || cap.minutes * 60,
      onSpawn: (pid) => { rec.pgid = pid; this.save(); },
      onLine: (line) => {
        seen.memory_mentions += (line.match(memRe) || []).length;
        seen.memory_index_mentions += (line.match(/MEMORY\.md/g) || []).length;
        seen.gitstatus_mentions += (line.match(/gitStatus/g) || []).length;
        let j; try { j = JSON.parse(line); } catch { return; }
        if (j.type === 'system' && j.subtype === 'init') { seen.model = j.model || null; seen.cwd = j.cwd || null; seen.session_id = j.session_id || null; }
        if (j.type === 'result') seen.result = j;
      },
    });
    const raw = fs.existsSync(rawFile) ? fs.readFileSync(rawFile) : Buffer.alloc(0);
    const res = seen.result || {};
    const ok = r.code === 0 && !r.timed_out && res.subtype === 'success' && !res.is_error;
    const cost = typeof res.total_cost_usd === 'number' ? res.total_cost_usd : (r.timed_out || !seen.result ? cap.usd : 0);
    const record = {
      kind: 'session', model: seen.model, model_binary: path.basename(bin), test_double: seen.model === 'test-double',
      verification_level: seen.model === 'test-double' ? 'UNVERIFIED' : undefined,
      cwd: seen.cwd || cwd, add_dirs: addDirs, caps: { max_turns: cap.max_turns, max_budget_usd: cap.usd, seconds: cap.seconds || cap.minutes * 60 },
      exit: r.code, signal: r.signal, timed_out: r.timed_out, result_subtype: res.subtype || null, is_error: !!res.is_error,
      turns: res.num_turns ?? null, cost_usd: cost,
      raw_stream: { path: rawFile, sha256: sha256(raw), bytes: raw.length },
      context_checks: { memory_path_mentions: seen.memory_mentions, memory_index_mentions: seen.memory_index_mentions, gitstatus_mentions: seen.gitstatus_mentions },
      prompt_sha256: sha256(prompt), prompt_first_line: prompt.split('\n')[0].slice(0, 200),
      stage_facts: extra,
    };
    this.finish(rec, ok ? 'done' : 'failed', record, { cost_usd: cost, timed_out: r.timed_out });
    return { ok, rec, record, seen };
  }

  prompt(stage, lines, body) {
    return [
      `DRIVER-READ-FIRST: ${path.join(this.s.worktree, 'CLAUDE.md')}`,
      `DRIVER-STAGE: ${stage}`, `SPEC: ${this.s.id}`, `WORKTREE: ${this.s.worktree}`, `BRANCH: ${this.s.branch}`,
      ...lines, RULE_HEAVY, RULE_REFS, '', body,
    ].join('\n');
  }

  // ── the stages ────────────────────────────────────────────────────────────────────────────────
  async stWorktree() {
    const rec = this.begin('worktree');
    const repo = this.q.repo;
    const wt = this.s.worktree;
    const commands = [];
    let base;
    if (fs.existsSync(wt)) {
      const br = git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').out;
      if (br !== this.s.branch) return this.stop('worktree-exists', 'worktree', `${tilde(wt)} exists on ${br || 'no branch'}, not ${this.s.branch}.`);
      base = this.p.base || gitOk(repo, 'merge-base', this.q.base_ref, this.s.branch);
    } else {
      base = gitOk(repo, 'rev-parse', this.q.base_ref);
      const exists = git(repo, 'rev-parse', '--verify', '-q', `refs/heads/${this.s.branch}`).code === 0;
      const args = exists ? ['worktree', 'add', wt, this.s.branch] : ['worktree', 'add', '-b', this.s.branch, wt, base];
      gitOk(repo, ...args);
      commands.push({ runner: 'shell', cmd: ['git', ...args], exit: 0 });
      if (exists) base = gitOk(repo, 'merge-base', this.q.base_ref, this.s.branch);
      for (const c of this.q.merge.copy) {
        const src = path.join(repo, c);
        if (fs.existsSync(src) && !fs.existsSync(path.join(wt, c))) spawnSync('cp', ['-a', src, path.join(wt, c)]);
      }
    }
    this.p.base = base;
    this.p.commit_records = true;
    // progress.json changes while a session runs; ignored, so the tree a session sees stays clean.
    // The stage records beside it are committed at every stage boundary.
    fs.mkdirSync(this.recDir, { recursive: true });
    fs.writeFileSync(path.join(this.recDir, '.gitignore'), 'progress.json\n*.tmp-*\n');
    const pending = path.join(this.q.state, 'pending', `${this.s.id}.json`);
    this.p.tier = this.s.tier;
    this.finish(rec, 'done', { base, base_ref: this.q.base_ref, branch: this.s.branch, worktree: wt, tier: this.s.tier, answers: { changes_verdict: this.s.changes_verdict ?? null, ships_publicly: this.s.ships_publicly ?? null }, commands });
    fs.rmSync(pending, { force: true });
    this.commitRecords('worktree');
    return 'build';
  }

  async stBuild() {
    const brief = fs.readFileSync(this.s.brief, 'utf8');
    const out = await this.session('build', {
      cwd: this.s.worktree,
      prompt: this.prompt('build', [`BASE: ${this.p.base}`, `BRIEF: ${this.s.brief}`], [
        `Read CLAUDE.md first. Then build spec ${this.s.id} from the brief below, in this worktree, on this branch, to approval-ready,`,
        `by the spec-anchored loop: classify; write specs/${this.s.id}/spec.md with its Base header line naming the BASE above;`,
        'write gate.sh against the criteria and run it red before the change; make the change; run gate.sh (plain) green;',
        'write PACKET.md and the tasks actuals. Commit everything and leave the tree clean.',
        'End with the report CLAUDE.md names.', '', '--- BRIEF ---', brief,
      ].join('\n')),
      permissionMode: this.q.permission_mode,
      tools: { deny: ['Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)', 'Bash(git update-ref:*)', 'Bash(git checkout dev:*)', 'Bash(git checkout main:*)'] },
    });
    if (out.stopped) return 'stopped';
    const why = [];
    if (!out.ok) why.push(`the session ended ${out.record.timed_out ? 'at its time limit' : `with ${out.record.result_subtype || `exit ${out.record.exit}`}`}`);
    if (!fs.existsSync(path.join(this.dir, 'spec.md')) || !fs.existsSync(path.join(this.dir, 'gate.sh'))) why.push(`specs/${this.s.id} lacks spec.md or gate.sh`);
    if (git(this.s.worktree, 'status', '--porcelain', '--untracked-files=all').out.split('\n').filter((l) => l && !l.includes(`specs/${this.s.id}/evidence/driver/`)).length) why.push('the tree is not clean');
    if (gitOk(this.s.worktree, 'rev-parse', 'HEAD') === this.p.base) why.push('the branch did not move');
    return this.afterSession('build', out, why, 'checks');
  }

  async afterSession(stage, out, why, next) {
    if (!why.length) { out.rec.result = { next }; this.save(); this.commitRecords(`${stage} done`); return next; }
    out.rec.status = 'failed'; out.rec.result = { why }; this.save();
    const attempts = this.p.stages.filter((x) => x.stage === stage && x.status === 'failed').length;
    this.commitRecords(`${stage} failed`);
    if (out.record.timed_out && attempts >= SESSION_ATTEMPTS) return this.stop('timed-out', stage, `The ${stage} session reached its time limit twice. ${why.join('; ')}.`, [path.join(this.recDir, out.rec.record)]);
    if (attempts >= SESSION_ATTEMPTS) return this.stop('session-failed', stage, `The ${stage} session failed twice: ${why.join('; ')}.`, [path.join(this.recDir, out.rec.record)]);
    this.log(`${stage} failed (${why.join('; ')}); one more attempt`);
    return stage;
  }

  async runShell(rec, c, cwd, env, tag) {
    const rawFile = path.join(this.rawDir, `${tag}-${pad(rec.n)}-${c.name || 'cmd'}.log`);
    const t0 = Date.now();
    const r = await runChild(c.cmd[0], c.cmd.slice(1), { cwd, env: env || shellEnv(), rawFile, seconds: c.seconds || (c.minutes || 60) * 60, onSpawn: (pid) => { rec.pgid = pid; this.save(); } });
    const summary = (r.tail || []).map((l) => l.trim()).filter(Boolean).reverse().find((l) => /row\(s\)|passed|failed|GREEN|emitted|mismatch|MERGE (OK|REFUSED)/.test(l)) || (r.tail || []).filter(Boolean).slice(-1)[0] || '';
    return { runner: 'shell', name: c.name || null, cmd: c.cmd, cwd, exit: r.code, timed_out: r.timed_out, wall_ms: Date.now() - t0, summary: summary.slice(0, 300), log: { path: rawFile, sha256: sha256(fs.existsSync(rawFile) ? fs.readFileSync(rawFile) : '') } };
  }
  gateFigure(root) {
    const f = path.join(root, 'specs', this.s.id, '.gate-results');
    if (!fs.existsSync(f)) return null;
    const rows = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('|'));
    return { passed: rows.filter((r) => r[1] === 'pass').length, failed: rows.filter((r) => r[1] !== 'pass').length, failing: rows.filter((r) => r[1] !== 'pass').map((r) => r[0]) };
  }

  // The default check: the spec's own gate and the core set, compared with the last nightly, where
  // the worktree carries a core set; the spec's own gate --final where it does not (spec 051).
  checks() {
    if (this.s.checks) return this.s.checks;
    if (fs.existsSync(path.join(this.s.worktree, 'specs', '000-governance', 'core-gates.txt'))) return [{ name: 'core', cmd: ['node', CORE_SWEEP, '--core', this.s.id], minutes: 180, usd: 0 }];
    return [{ name: 'final', cmd: ['bash', `specs/${this.s.id}/gate.sh`, '--final'], minutes: 90, usd: 0 }];
  }

  async stChecks() {
    const checks = this.checks();
    for (const c of checks) if (c.usd && !(await this.fits('checks', c.usd))) return 'stopped';
    const reserved = checks.reduce((t, c) => t + (c.usd || 0), 0);
    const rec = this.begin('checks', { reserved_usd: reserved });
    const commands = [];
    for (const c of checks) {
      const x = await this.runShell(rec, c, this.s.worktree, null, 'checks');
      if (/gate\.sh$/.test(c.cmd[1] || '') || c.cmd.some((a) => a.endsWith('/gate.sh')) || (c.cmd.includes('--core') && c.cmd.includes(this.s.id))) x.figure = this.gateFigure(this.s.worktree);
      commands.push(x);
    }
    const green = commands.every((c) => c.exit === 0);
    // A check may write evidence; anything else it writes is a fault, not a result.
    const dirty = git(this.s.worktree, 'status', '--porcelain', '--untracked-files=all').out.split('\n').filter((l) => l && !/ specs\/[^/]+\/evidence\//.test(l));
    const head = gitOk(this.s.worktree, 'rev-parse', 'HEAD');
    this.finish(rec, 'done', { commands, green, head }, { cost_usd: reserved, result: { green } });
    if (dirty.length) return this.stop('check-wrote-tree', 'checks', `The checks wrote outside specs/*/evidence/: ${dirty.slice(0, 5).join('; ')}. Commit or discard, then answer retry.`);
    gitOk(this.s.worktree, 'add', '-A', '--', path.relative(this.s.worktree, path.join(this.dir, 'evidence')));
    this.commitRecords(`checks ${green ? 'green' : 'red'}`);
    if (git(this.s.worktree, 'diff', '--cached', '--quiet').code !== 0) gitOk(this.s.worktree, 'commit', '-q', '--no-verify', '-m', `evidence(${this.s.id}): check outputs (scripts/drive.mjs)`);
    if (!green) {
      const findings = path.join(this.recDir, `findings-checks-${pad(rec.n)}.json`);
      writeJson(findings, { source: 'driver', stage: 'checks', red: commands.filter((c) => c.exit !== 0).map((c) => ({ name: c.name, cmd: c.cmd, exit: c.exit, summary: c.summary, failing: c.figure && c.figure.failing })) });
      this.commitRecords('checks red findings');
      return this.loopOr('checks', { kind: 'checks', findings });
    }
    const own = commands.find((c) => c.figure);
    this.p.checks_figure = own ? { ...own.figure, head, check: own.name } : null;
    this.p.checks_summary = commands.map((c) => `${c.name}: ${c.summary}`).join('; ');
    this.save();
    if (this.s.until === 'approval-ready') return 'ready';
    if (this.baseMoved()) return 'rebase';
    if (!needsApproval(this.s.tier)) return this.s.until === 'approved' ? 'ready' : 'merge';
    return 'approve';
  }

  baseMoved() { return gitOk(this.q.repo, 'rev-parse', this.q.base_ref) !== this.p.base; }

  async loopOr(stage, fix) {
    const allowed = this.s.max_loops + (this.p.loops_granted || 0);
    if (this.p.loops >= allowed) return this.stop('loops-spent', stage, `A ${fix.kind === 'unread-figures' ? 're-approval' : 'fix loop'} is needed and ${this.p.loops} of ${allowed} loops are spent.`, [fix.findings || fix.record].filter(Boolean));
    this.p.pending_fix = fix;
    this.save();
    return fix.kind === 'unread-figures' ? 'approve' : 'fix';
  }

  async stApprove() {
    const evDir = path.join(this.dir, 'evidence');
    const beforeFiles = new Set(fs.existsSync(evDir) ? fs.readdirSync(evDir) : []);
    if (this.p.pending_fix && this.p.pending_fix.kind === 'unread-figures') { this.p.loops += 1; this.p.pending_fix = null; this.save(); }
    const specPath = path.join(this.s.worktree, 'specs', this.s.id);
    // The launch directory: neutral, under ~, and inside no git repository once discovery is stopped
    // at its parent. Checked with the environment the session gets, so a git-status block has no
    // repository to describe (P-4).
    const launch = this.q.approve_cwd;
    fs.mkdirSync(launch, { recursive: true });
    const ceiling = { GIT_CEILING_DIRECTORIES: path.dirname(launch) };
    const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: launch, env: { ...shellEnv(), ...ceiling }, encoding: 'utf8' });
    if (probe.status === 0) return this.stop('operator-ruling', 'approve', `The approval launch directory ${tilde(launch)} is inside a git repository even with discovery stopped at ${tilde(path.dirname(launch))}. Name another in the queue's approve_cwd, then answer retry.`);
    const out = await this.session('approve', {
      cwd: launch, addDirs: [this.s.worktree], prompt: `/spec-approve ${specPath}`, env: ceiling,
      tools: { allow: ['Bash', 'Read', 'Grep', 'Glob', 'Write'] },
      extra: {
        claude_md_changed_on_branch: git(this.s.worktree, 'diff', '--quiet', this.p.base, 'HEAD', '--', 'CLAUDE.md').code !== 0,
        launch_dir: launch, launch_dir_in_git_repository: false, git_ceiling: ceiling.GIT_CEILING_DIRECTORIES,
      },
    });
    if (out.stopped) return 'stopped';
    this.p.approvals = (this.p.approvals || 0) + 1;
    const newRecs = (fs.existsSync(evDir) ? fs.readdirSync(evDir) : []).filter((n) => /^approval-.*\.md$/.test(n) && !beforeFiles.has(n)).sort();
    const why = [];
    if (!out.ok) why.push(`the session ended ${out.record.timed_out ? 'at its time limit' : `with ${out.record.result_subtype || `exit ${out.record.exit}`}`}`);
    if (!newRecs.length) why.push('no new approval record');
    if (why.length) return this.afterSession('approve', out, why, 'approve');
    const file = newRecs[newRecs.length - 1];
    const text = fs.readFileSync(path.join(evDir, file), 'utf8');
    const field = (k) => { const m = new RegExp(`^${k}:\\s*(.+)$`, 'mi').exec(text); return m ? m[1].trim() : null; };
    const a = { at: out.rec.started, file: path.join(evDir, file), commit: field('commit'), verdict: field('verdict'), tree: field('tree'), blocking: Number(field('blocking_findings')), findings: field('findings') || 'none', receipt: (/gate-\d{8}T\d{6}Z\.json/.exec(text) || [])[0] || null };
    const tracked = git(this.s.worktree, 'ls-files', '--error-unmatch', path.relative(this.s.worktree, a.file)).code === 0;
    const dry = await this.runShell(out.rec, { name: 'merge-check-dry-run', cmd: ['node', 'scripts/merge-check.js', `specs/${this.s.id}`, '--dry-run'], minutes: 5 }, this.s.worktree, null, 'approve');
    const channel = out.record.context_checks.memory_path_mentions + out.record.context_checks.memory_index_mentions;
    const mergeable = Number.isFinite(a.blocking) && a.blocking === 0 && !/^(rejected|changes-requested)/i.test(a.verdict || '') && dry.exit === 0 && tracked;
    const result = { approval: { ...a, tracked }, merge_check_dry_run: { exit: dry.exit, summary: dry.summary }, mergeable, channel_mentions: channel };
    writeJson(path.join(this.recDir, out.rec.record), { ...readJson(path.join(this.recDir, out.rec.record)), result, commands: [dry] });
    out.rec.result = result; this.save();
    this.commitRecords(`approve (${a.verdict}, blocking ${a.blocking})`);
    if (channel > 0) return this.stop('operator-ruling', 'approve', `The approval stream mentions the memory directory or its index ${channel} time(s). CONSTITUTION invariant 3: this is not a fresh-context record. Answer retry to approve again.`, [a.file]);
    if (mergeable) {
      this.p.last_approval = result.approval;
      const nb = a.findings === 'none' ? [] : a.findings.split(/;\s*/).filter(Boolean);
      if (nb.length) {
        const owed = readJson(path.join(this.recDir, 'owed.json'), []);
        for (const f of nb) owed.push({ recorded: iso(), approval: path.relative(this.s.worktree, a.file), finding: f, class: 'non-blocking' });
        writeJson(path.join(this.recDir, 'owed.json'), owed);
      }
      this.save(); this.commitRecords('approval mergeable');
      if (this.s.until === 'approved') return 'ready';
      return 'merge';
    }
    this.p.last_blocking_approval = result.approval; this.save();
    return 'triage';
  }

  async stTriage() {
    const a = this.p.last_blocking_approval;
    const policy = readPolicy(this.q.repo, this.q.base_ref);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `drive-triage-${this.s.id}-`));
    fs.writeFileSync(path.join(scratch, 'decision-policy.md'), `## Decision policy\n\n${policy.section}\n`);
    const out = path.join(scratch, 'triage.json');
    const res = await this.session('triage', {
      cwd: scratch, addDirs: [this.s.worktree],
      prompt: this.prompt('triage', [`APPROVAL-RECORD: ${a.file}`, `POLICY: ${path.join(scratch, 'decision-policy.md')}`, `WRITE: ${out}`], [
        'You are the triage context of CONSTITUTION § Decision policy. Read the approval record and the policy file named above, and nothing about how the work was built.',
        'For every finding in the record answer exactly one class that is a row of the policy table, and whether the record counts it as blocking.',
        `Write only this JSON to the WRITE path: {"findings":[{"id":"F-1","blocking":true,"class":"<a class id from the table>","reason":"<one sentence>"}]}`,
        'When no row fits, answer "operator-ruling". Edit nothing in the worktree.',
      ].join('\n')),
      tools: { allow: ['Read', 'Grep', 'Glob', 'Write'] },
    });
    if (res.stopped) return 'stopped';
    const t = readJson(out);
    const why = [];
    if (!res.ok) why.push('the triage session failed');
    if (!t || !Array.isArray(t.findings)) why.push('no triage.json with a findings list');
    if (why.length) return this.afterSession('triage', res, why, 'triage');
    const tri = path.join(this.recDir, `triage-${pad(res.rec.n)}-answer.json`);
    writeJson(tri, { approval: path.relative(this.s.worktree, a.file), policy_classes: policy.classes, ...t });
    fs.rmSync(scratch, { recursive: true, force: true });
    const blocking = t.findings.filter((f) => f.blocking !== false);
    const unknown = t.findings.filter((f) => !policy.classes[f.class]);
    res.rec.result = { classes: t.findings.map((f) => `${f.id}:${f.class}`) }; this.save();
    this.commitRecords('triage');
    if (unknown.length) return this.stop('not-in-policy', 'triage', `The triage answered ${unknown.map((f) => `${f.id} as "${f.class}"`).join(', ')}, and CONSTITUTION § Decision policy at ${this.q.base_ref} has no such row.`, [a.file, tri]);
    const action = (f) => policy.classes[f.class];
    const stopAt = blocking.find((f) => action(f) === 'stop' || action(f) === 'carry' || !['fix-loop', 'ruling', 're-approve', 'owed'].includes(action(f)));
    if (stopAt) return this.stop(action(stopAt) === 'carry' ? 'needs-measurement' : 'operator-ruling', 'approve', `Finding ${stopAt.id} is blocking and its class ${stopAt.class} asks for ${action(stopAt)}: ${stopAt.reason || ''}`, [a.file, tri]);
    const needRuling = blocking.filter((f) => action(f) === 'ruling');
    const ruled = (this.p.rulings || []).some((r) => r.for_class === 'ruling-needed' && r.recorded > (a.at || ''));
    if (needRuling.length && !ruled) {
      return this.stop('ruling-needed', 'approve', `Finding(s) ${needRuling.map((f) => f.id).join(', ')} are ${needRuling.map((f) => f.class).join(', ')}: the policy lets them merge only on a ruling recorded for them. ${needRuling.map((f) => f.reason || '').join(' ')}`, [a.file, tri]);
    }
    return this.loopOr('triage', { kind: 'approval', record: a.file, triage: tri });
  }

  async stFix(kindOverride) {
    const fx = kindOverride || this.p.pending_fix || {};
    const isRebase = fx.kind === 'rebase';
    const lines = [`LOOP-KIND: ${fx.kind}`];
    if (!isRebase) lines.unshift(`LOOP: ${this.p.loops + 1} of ${this.s.max_loops + (this.p.loops_granted || 0)}`);
    if (fx.record) lines.push(`APPROVAL-RECORD: ${fx.record}`);
    if (fx.triage) lines.push(`TRIAGE: ${fx.triage}`);
    if (fx.findings) lines.push(`FINDINGS-FILE: ${fx.findings}`);
    if (isRebase) lines.push(`OLD-BASE: ${fx.old_base}`, `NEW-BASE: ${fx.new_base}`);
    const rulings = path.join(this.recDir, 'rulings.json');
    if (fs.existsSync(rulings)) lines.push(`RULINGS: ${rulings}`);
    const body = isRebase ? [
      `Read CLAUDE.md first. The driver rebased this branch from OLD-BASE onto NEW-BASE. Follow CONSTITUTION § Fix loop checklist item 3: re-pin the spec's Base and Tip header lines, then item 4's dry run and spec-text pass.`,
      'Commit and leave the tree clean. The driver runs the checks (and the Tip sweep they declare) after this session.',
    ] : [
      'Read CLAUDE.md first. Run one fix loop by CONSTITUTION § Fix loop checklist, every item, from the approval record (or the driver\'s findings file) named above.',
      'Close every finding, blocking or not; § Decision policy says what each finding\'s class asks for, and TRIAGE names each class. A false red is fixed in the gate that reads it, by that spec\'s next amendment.',
      'An operator ruling in RULINGS is an instruction: write it into PACKET.md beside the finding it rules on. Run the merge-check dry run and the spec-text pass yourself; the driver runs gate.sh --final and the declared sweeps after this session.',
      'Commit and leave the tree clean. End with the report CLAUDE.md names.',
    ];
    const out = await this.session('fix', {
      cwd: this.s.worktree, prompt: this.prompt('fix', lines, body.join('\n')), permissionMode: this.q.permission_mode,
      tools: { deny: ['Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)', 'Bash(git update-ref:*)', 'Bash(git checkout dev:*)', 'Bash(git checkout main:*)'] },
      extra: { loop_kind: fx.kind },
    });
    if (out.stopped) return 'stopped';
    const why = [];
    if (!out.ok) why.push(`the session ended ${out.record.timed_out ? 'at its time limit' : `with ${out.record.result_subtype || `exit ${out.record.exit}`}`}`);
    if (git(this.s.worktree, 'status', '--porcelain', '--untracked-files=all').out.split('\n').filter((l) => l && !l.includes(`specs/${this.s.id}/evidence/driver/`)).length) why.push('the tree is not clean');
    if (why.length) return this.afterSession('fix', out, why, 'fix');
    if (!isRebase) { this.p.loops += 1; this.p.pending_fix = null; }
    else this.p.pending_rebase_fix = null;
    this.save();
    return this.afterSession('fix', out, [], 'checks');
  }

  async stRebase() {
    const rec = this.begin('rebase');
    const oldBase = this.p.base;
    const newBase = gitOk(this.q.repo, 'rev-parse', this.q.base_ref);
    const r = git(this.s.worktree, 'rebase', '--onto', newBase, oldBase, this.s.branch);
    if (r.code !== 0) {
      git(this.s.worktree, 'rebase', '--abort');
      this.finish(rec, 'failed', { old_base: oldBase, new_base: newBase, commands: [{ runner: 'shell', cmd: ['git', 'rebase', '--onto', newBase, oldBase, this.s.branch], exit: r.code, summary: r.err.slice(0, 300) }] });
      return this.stop('rebase-conflict', 'rebase', `Rebasing ${this.s.branch} from ${oldBase.slice(0, 8)} onto ${this.q.base_ref} ${newBase.slice(0, 8)} conflicts: ${r.err.slice(0, 300)}. Resolve by hand and answer retry.`);
    }
    this.p.base = newBase;
    this.p.pending_rebase_fix = { kind: 'rebase', old_base: oldBase, new_base: newBase };
    this.p.rebases = (this.p.rebases || 0) + 1;
    this.driver.ownWrites.set(`refs/heads/${this.s.branch}`, new Set([gitOk(this.s.worktree, 'rev-parse', 'HEAD')]));
    this.finish(rec, 'done', { old_base: oldBase, new_base: newBase, commands: [{ runner: 'shell', cmd: ['git', 'rebase', '--onto', newBase, oldBase, this.s.branch], exit: 0 }] }, { result: { next: 'fix' } });
    this.commitRecords('rebase');
    return 'fix';
  }

  async stReady() {
    const rec = this.begin('ready');
    const wt = this.s.worktree;
    const cmdA = needsApproval(this.s.tier) ? `cd ~ && claude-approve --add-dir ${tilde(wt)}` : `${this.s.tier}: no approval session (CONSTITUTION § Proportional oversight)`;
    const cmdB = needsApproval(this.s.tier) ? `/spec-approve ${tilde(path.join(wt, 'specs', this.s.id))}` : 'merges on the operator\'s word';
    this.finish(rec, 'done', { approval_command: [cmdA, cmdB], tip: gitOk(wt, 'rev-parse', 'HEAD') }, { result: { next: null } });
    this.p.state = 'ready';
    this.save();
    this.commitRecords('ready');
    const push = git(this.q.repo, 'push', '-q', this.q.remote, `refs/heads/${this.s.branch}:refs/heads/${this.s.branch}`);
    if (push.code === 0) this.driver.noteRemoteWrite(this.q.remote, `refs/heads/${this.s.branch}`, gitOk(this.q.repo, 'rev-parse', `refs/heads/${this.s.branch}`));
    if (push.code !== 0) return this.stop('push-failed', 'ready', `git push ${this.q.remote} ${this.s.branch}: ${push.err.slice(0, 300)}`);
    this.log(`ready at ${gitOk(wt, 'rev-parse', '--short', 'HEAD')}, pushed to ${this.q.remote}. Approve with:\n      ${cmdA}\n      ${cmdB}`);
    return null;
  }

  // ── the merge sequence ────────────────────────────────────────────────────────────────────────
  async stMerge() {
    return this.driver.withMergeLock(() => this.mergeLocked());
  }
  async mergeLocked() {
    const repo = this.q.repo;
    const base = this.q.base_ref;
    const tip = gitOk(this.s.worktree, 'rev-parse', 'HEAD');
    // resumed after the base ref already carries the tip: only main and the push remain
    const already = git(repo, 'merge-base', '--is-ancestor', tip, base).code === 0 && this.p.merge_commit;
    if (!already && this.baseMoved()) return 'rebase';
    const rec = this.begin('merge');
    const steps = []; const commands = [];
    const out = (extra = {}) => ({ steps, commands, tip, ...extra });
    const fail = async (cls, stage, detail) => { this.finish(rec, 'failed', out({ class: cls })); return this.stop(cls, stage, detail, [path.join(this.recDir, rec.record)]); };
    const checkout = this.driver.checkoutOf(base);
    const oldBase = gitOk(repo, 'rev-parse', base);
    const oldMain = git(repo, 'rev-parse', '--verify', '-q', 'refs/heads/main').out || null;
    let mergeSha = this.p.merge_commit || null;
    let work = null;
    try {
      if (!already) {
        if (checkout && git(checkout, 'status', '--porcelain').out) return fail('checkout-dirty', 'merge', `${tilde(checkout)} holds ${base} and is not clean; the driver moves ${base} there only by a fast-forward of a clean checkout.`);
        // 1. merge-check, at the branch tip; a T3 branch has no approval to check, so it gets
        // merge-check's own hygiene scan and the T3 path guard instead (spec 051)
        if (needsApproval(this.s.tier)) {
          const mc = await this.runShell(rec, { name: 'merge-check', cmd: ['node', 'scripts/merge-check.js', `specs/${this.s.id}`], minutes: 5 }, this.s.worktree, null, 'merge');
          commands.push(mc); steps.push({ step: 'merge-check', exit: mc.exit, summary: mc.summary });
          if (mc.exit !== 0) return fail('merge-check-refused', 'merge', `merge-check refused ${this.s.branch} at ${tip.slice(0, 8)}: ${mc.summary}`);
        } else {
          const pc = this.t3Precheck(tip);
          commands.push(pc); steps.push({ step: 't3-precheck', exit: pc.exit, summary: pc.summary });
          if (pc.exit !== 0) return fail('operator-ruling', 'merge', `${this.s.id} is T3 and ${pc.summary}. A T3 branch changes internal paths only; retier the entry or answer with a ruling.`);
        }
        // 2. the --no-ff merge, in a detached worktree: no ref moves until every step below is green
        work = path.join(this.q.state, 'merge', this.s.id);
        fs.rmSync(work, { recursive: true, force: true }); git(repo, 'worktree', 'prune');
        gitOk(repo, 'worktree', 'add', '--detach', work, oldBase);
        for (const c of this.q.merge.copy) { const src = path.join(repo, c); if (fs.existsSync(src)) spawnSync('cp', ['-a', src, path.join(work, c)]); }
        const title = ((/^# (.+)$/m.exec(fs.readFileSync(path.join(this.dir, 'spec.md'), 'utf8')) || [])[1] || `spec ${this.s.id}`).replace(/^spec \S+ - /, '');
        const subject = (this.p.last_approval && this.p.last_approval.commit) || tip;
        const m = git(work, 'merge', '--no-ff', '--no-edit', '-m', `merge(spec ${this.s.id}): ${title} - approved at ${subject.slice(0, 8)} (scripts/drive.mjs)`, tip);
        commands.push({ runner: 'shell', cmd: ['git', 'merge', '--no-ff', tip], cwd: work, exit: m.code });
        if (m.code !== 0) { git(work, 'merge', '--abort'); return fail('merge-conflict', 'merge', `The merge of ${tip.slice(0, 8)} onto ${base} conflicts: ${m.err.slice(0, 300)}`); }
        mergeSha = gitOk(work, 'rev-parse', 'HEAD');
        steps.push({ step: 'merge', merge_commit: mergeSha });
        // 3. the spec's gate on the merge result, against the figure the approval's receipt records
        const g = await this.runShell(rec, { name: 'gate-final-on-merge', cmd: ['bash', `specs/${this.s.id}/gate.sh`, '--final'], minutes: 90 }, work, null, 'merge');
        g.figure = this.gateFigure(work); commands.push(g);
        // T1 and T2 against the figure the approval read; T3 against the one the checks read
        const approved = needsApproval(this.s.tier) ? this.approvedFigure() : this.p.checks_figure;
        const same = approved && g.figure && approved.passed === g.figure.passed && approved.failed === g.figure.failed;
        steps.push({ step: 'figures', merge_result: g.figure, [needsApproval(this.s.tier) ? 'approval_read' : 'checks_read']: approved, equal: !!same });
        if (!same && !this.mergeRuling()) {
          // the class and its action come from § Decision policy, like a triage answer's
          const cls = 'unread-figures';
          const act = readPolicy(repo, base).classes[cls];
          this.finish(rec, 'failed', out({ class: cls, action: act || null }));
          this.removeWork(work); work = null;
          if (!act) return this.stop('not-in-policy', 'merge', `The merge result's figure differs from the approval's, and § Decision policy at ${base} has no ${cls} row.`, [path.join(this.recDir, rec.record)]);
          if (act !== 're-approve' || !needsApproval(this.s.tier)) return this.stop('operator-ruling', 'merge', `The merge result's figure (${JSON.stringify(g.figure)}) differs from the ${needsApproval(this.s.tier) ? 'approval' : 'checks'}'s (${JSON.stringify(approved)}); the policy's action for ${cls} is ${act}${needsApproval(this.s.tier) ? '' : ', and a T3 entry has no approval to repeat'}.`, [path.join(this.recDir, rec.record)]);
          return this.loopOr('merge', { kind: cls, record: path.join(this.recDir, rec.record) });
        }
        // 4. no emission: the core set ran at the checks stage and the nightly sweeps dev (spec 051).
        // A queue may still name a merge-time command that is not a sweep; loadQueue refuses one that is.
        let em = null;
        if (this.q.merge.emit.cmd) {
          em = await this.emit(rec, work, subject);
          commands.push(...em.commands); steps.push({ step: 'emit', ...em.step });
          if (em.stop) { this.removeWork(work); work = null; return fail(em.stop.class, 'merge', em.stop.detail); }
        }
        // 5. the DECISIONS entry
        const entry = this.decisionsEntry({ mergeSha, tip, subject, title, emit: em ? em.step : null, figure: g.figure });
        fs.appendFileSync(path.join(work, 'DECISIONS.md'), entry);
        gitOk(work, 'add', 'DECISIONS.md');
        gitOk(work, 'commit', '-q', '--no-verify', '-m', `decisions(${this.s.id}): the merge entry (scripts/drive.mjs)`);
        steps.push({ step: 'decisions', commit: gitOk(work, 'rev-parse', 'HEAD') });
        // 6. the repository gate on the result
        const rg = await this.runShell(rec, { name: 'repo-gate', ...this.q.merge.repo_gate }, work, null, 'merge');
        rg.figure = repoGateFigure(work, this.q.merge.repo_gate, rg); commands.push(rg);
        const green = rg.exit === 0 && rg.figure && rg.figure.failed === 0;
        steps.push({ step: 'repo-gate', exit: rg.exit, figure: rg.figure, green });
        const newBase = gitOk(work, 'rev-parse', 'HEAD');
        if (!green && !this.mergeRuling()) {
          this.removeWork(work); work = null;
          return fail('ruling-needed', 'merge', `The repository gate reads ${rg.figure ? `${rg.figure.passed} passed, ${rg.figure.failed} failed` : `exit ${rg.exit}`} on the merge result. A ruling lets ${base} move on it; the figure goes in the reflog either way. ${rg.summary}`);
        }
        // 7. the base ref only. A driven merge never moves main: main moves in the release stage, by
        // the runbook (the operator's ruling of 2026-09-23, spec 048 A-048-2).
        const fig = rg.figure || {};
        this.moveRef(base, newBase, oldBase, checkout, `merge(spec ${this.s.id}) onto ${base} ${newBase.slice(0, 8)}; repository gate ${fig.passed ?? '?'}/${(fig.passed ?? 0) + (fig.failed ?? 0)} passed, ${fig.failed ?? '?'} failed at ${newBase.slice(0, 8)}${green ? '' : ' (moved under a ruling)'} (scripts/drive.mjs)`);
        this.p.merge_commit = mergeSha; this.p.merged_base = newBase; this.p.repo_gate = rg.figure; this.p.repo_gate_green = green; this.save();
      }
      const newBase = this.p.merged_base;
      steps.push({ step: 'base', base_ref: base, from: oldBase, to: newBase, repo_gate_green: this.p.repo_gate_green, main: oldMain, main_moved: false });
      // 8. the private push: the base ref and the branch, never main
      const refs = [`refs/heads/${base}:refs/heads/${base}`, `refs/heads/${this.s.branch}:refs/heads/${this.s.branch}`];
      const p = git(repo, 'push', '-q', this.q.remote, ...refs);
      if (p.code === 0) for (const r of [base, this.s.branch]) this.driver.noteRemoteWrite(this.q.remote, `refs/heads/${r}`, gitOk(repo, 'rev-parse', `refs/heads/${r}`));
      commands.push({ runner: 'shell', cmd: ['git', 'push', this.q.remote, ...refs], exit: p.code, summary: p.err.slice(0, 200) });
      steps.push({ step: 'push', remote: this.q.remote, exit: p.code });
      if (p.code !== 0) return fail('push-failed', 'merge', `git push ${this.q.remote}: ${p.err.slice(0, 300)}`);
      const next = ['site', 'release'].includes(this.s.until) ? 'publish' : null;
      this.finish(rec, 'done', out({ merge_commit: this.p.merge_commit }), { result: { merge_commit: this.p.merge_commit, base_sha: newBase, next } });
      if (!next) { this.p.state = 'merged'; this.save(); }
      this.log(`merged: ${base} ${newBase.slice(0, 8)}, pushed to ${this.q.remote}; main not moved (it moves in the release stage)`);
      return next;
    } finally {
      if (work) this.removeWork(work);
    }
  }
  // A T3 merge's precondition in place of merge-check's approval test: merge-check.js's own hygiene
  // scan over the tip's tree, and every path the branch changes inside its spec directory or T3_PATHS.
  t3Precheck(tip) {
    const changed = gitOk(this.s.worktree, 'diff', '--name-only', `${this.p.base}...${tip}`).split('\n').filter(Boolean);
    const outside = changed.filter((f) => !f.startsWith(`specs/${this.s.id}/`) && !T3_PATHS.some((re) => re.test(f)));
    // the scanner as the BASE carries it, never the branch's own copy: a branch that edited
    // hygieneScan would otherwise pass a check it wrote itself (A-051-1, F-2)
    let hits = []; let scanError = null;
    const scanner = fs.mkdtempSync(path.join(os.tmpdir(), `drive-t3-${this.s.id}-`));
    try {
      for (const rel of ['scripts/merge-check.js', 'lib/hygiene.js']) {
        fs.mkdirSync(path.join(scanner, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(scanner, rel), gitOk(this.s.worktree, 'show', `${this.p.base}:${rel}`));
      }
      const mc = createRequire(import.meta.url)(path.join(scanner, 'scripts', 'merge-check.js'));
      const r = mc.hygieneScan(tip, this.s.worktree);
      scanError = r.error; hits = r.hits || [];
    } catch (e) { scanError = e.message; } finally { fs.rmSync(scanner, { recursive: true, force: true }); }
    const why = [];
    if (outside.length) why.push(`changes ${outside.length} path(s) outside T3's: ${outside.slice(0, 5).join(', ')}`);
    if (scanError) why.push(`the hygiene scan could not run: ${scanError}`);
    if (hits.length) why.push(`the hygiene scan finds ${hits.length} hit(s) in ${[...new Set(hits.map((h) => h.file))].slice(0, 5).join(', ')}`);
    return { runner: 'driver', name: 't3-precheck', cmd: ['merge-check.js hygieneScan', tip], exit: why.length ? 1 : 0, summary: why.length ? why.join('; ') : `${changed.length} path(s), all internal; hygiene scan clean`, changed };
  }
  removeWork(work) { git(this.q.repo, 'worktree', 'remove', '--force', work); fs.rmSync(work, { recursive: true, force: true }); git(this.q.repo, 'worktree', 'prune'); }
  // A ruling answered at the merge stage, after the approval the merge runs on, lets the merge go
  // ahead on the red it was asked about; it is quoted in the DECISIONS entry.
  mergeRuling() { const at = (this.p.last_approval || {}).at || ''; return (this.p.rulings || []).some((r) => r.stage === 'merge' && r.recorded > at); }
  approvedFigure() {
    const a = this.p.last_approval;
    if (!a) return null;
    const ev = path.join(this.dir, 'evidence');
    let r = a.receipt ? readJson(path.join(ev, a.receipt)) : null;
    if (!r) {
      const cands = fs.readdirSync(ev).filter((n) => /^gate-.*\.json$/.test(n)).sort().reverse().map((n) => readJson(path.join(ev, n))).filter((j) => j && (j.subject === a.commit || j.commit === a.commit));
      r = cands[0] || null;
    }
    return r && Number.isFinite(r.passed) ? { passed: r.passed, failed: r.failed, receipt: a.receipt } : null;
  }
  // Moves a ref by compare-and-swap. A checkout that holds the ref is fast-forwarded in place, so
  // its working tree follows; it was checked clean before the merge began.
  moveRef(ref, to, from, checkout, msg) {
    if (checkout) {
      // GIT_REFLOG_ACTION puts the message (and so the figure) in the reflog of a fast-forward
      const r = spawnSync('git', ['-C', checkout, 'merge', '--ff-only', '-q', to], { encoding: 'utf8', env: { ...shellEnv(), GIT_REFLOG_ACTION: msg } });
      if (r.status !== 0) throw new Error(`fast-forward of ${ref} in ${tilde(checkout)} refused: ${r.stderr}`);
    } else {
      gitOk(this.q.repo, 'update-ref', '-m', msg, `refs/heads/${ref}`, to, from);
    }
    if (!this.driver.ownWrites.has(`refs/heads/${ref}`)) this.driver.ownWrites.set(`refs/heads/${ref}`, new Set());
    this.driver.ownWrites.get(`refs/heads/${ref}`).add(to);
  }

  async emit(rec, work, subject) {
    const e = this.q.merge.emit;
    const only = this.s.emit && this.s.emit.only ? this.s.emit.only : e.only;
    const cmd = e.cmd;
    let where = work;
    const commands = [];
    if (e.clone) {
      // a clone at the approved subject with main and dev pinned to the refs the approval read
      where = path.join(this.q.state, 'emit', this.s.id);
      fs.rmSync(where, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(where), { recursive: true });
      gitOk(path.dirname(where), 'clone', '-q', '--no-checkout', this.q.repo, where);
      gitOk(where, 'checkout', '-q', '--detach', subject);
      gitOk(where, 'update-ref', `refs/heads/${this.q.base_ref}`, this.p.base);
      const mainSha = git(this.q.repo, 'rev-parse', '--verify', '-q', 'refs/heads/main').out;
      if (mainSha) gitOk(where, 'update-ref', 'refs/heads/main', mainSha);
      for (const c of [...(e.copy || []), ...((this.s.emit && this.s.emit.copy) || [])]) {
        const src = path.join(this.q.repo, c);
        if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(path.join(where, c)), { recursive: true }); spawnSync('cp', ['-a', src, path.join(where, c)]); }
      }
    }
    const x = await this.runShell(rec, { name: 'emit', cmd, minutes: e.minutes }, where, null, 'merge');
    commands.push(x);
    const sha8 = subject.slice(0, 8);
    const evRel = 'specs/029-scanner-loop/evidence';
    const outputs = e.outputs || (only ? [] : [`${evRel}/sweep-run.json`, `${evRel}/sweep-raw`]);
    if (where !== work) {
      for (const o of outputs) { const src = path.join(where, o); if (fs.existsSync(src)) { fs.rmSync(path.join(work, o), { recursive: true, force: true }); spawnSync('cp', ['-a', src, path.join(work, o)]); } }
      if (only) {
        const rec2 = path.join(where, evRel, 'sweep-run.json');
        if (fs.existsSync(rec2)) { fs.mkdirSync(path.join(work, evRel), { recursive: true }); fs.copyFileSync(rec2, path.join(work, evRel, `premerge-emit-${sha8}.json`)); }
      }
    }
    if (!e.cmd || e.clone) {
      fs.mkdirSync(path.join(work, evRel), { recursive: true });
      fs.writeFileSync(path.join(work, evRel, `premerge-emit-${sha8}.txt`), scrub(`# spec 029 emission for spec ${this.s.id} at ${sha8}, run by scripts/drive.mjs\n# ${cmd.join(' ')}\n# exit ${x.exit}\n${fs.existsSync(x.log.path) ? fs.readFileSync(x.log.path, 'utf8') : ''}`).replace(HOME_IN_TEXT, '~'));
    }
    // Which mismatches are figures the approval did not read. A partial emission is compared only
    // over the gates it ran (the rest read as absent, which is the partial's declared shape), and
    // the merging spec's own row is read when it equals the figure the approval's receipt records.
    const emitted = readJson(path.join(where, evRel, 'sweep-run.json'));
    const all = (emitted && emitted.against && emitted.against.mismatches) || [];
    const own = emitted && (emitted.runs || []).find((r) => r.spec === this.s.id);
    const ap = this.approvedFigure();
    const ownRead = !!(own && own.figure && ap && own.figure.pass === ap.passed && own.figure.fail === ap.failed);
    const unread = all.filter((m) => (!only || (only.includes(m.spec) && !/fresh emission carries no run/.test(m.why || ''))) && !(m.spec === this.s.id && ownRead));
    const n2 = emitted && emitted.conduct && emitted.conduct.nfr2; const n3 = emitted && emitted.conduct && emitted.conduct.nfr3;
    const conductBad = !emitted || !n2 || !n3 || !n2.refs_clean || n2.unexcused.length || n2.survived_restore.length || n3.left.length;
    if (e.clone) fs.rmSync(where, { recursive: true, force: true });
    const toAdd = [...outputs, ...(only ? [`${evRel}/premerge-emit-${sha8}.json`] : []), ...(!e.cmd || e.clone ? [`${evRel}/premerge-emit-${sha8}.txt`] : [])].filter((o) => fs.existsSync(path.join(work, o)));
    if (toAdd.length) {
      gitOk(work, 'add', '-A', '--', ...toAdd);
      if (git(work, 'diff', '--cached', '--quiet').code !== 0) gitOk(work, 'commit', '-q', '--no-verify', '-m', `evidence(029): spec ${this.s.id}'s pre-merge emission at ${sha8}${only ? ` (--only ${only.join(',')}, a declared departure)` : ' (full)'} (scripts/drive.mjs)`);
    }
    const step = { cmd, partial: !!only, only, exit: x.exit, summary: x.summary, in_clone: !!e.clone, mismatches: all.length, unread: unread.map((m) => m.spec), own_row_read: ownRead, conduct_clean: !conductBad };
    const custom = !!e.cmd && !/sweep\.mjs/.test(e.cmd.join(' '));
    const bad = custom ? x.exit !== 0 : (unread.length > 0 || conductBad);
    if (bad && !this.mergeRuling()) {
      return { commands, step, stop: { class: 'unread-figures', detail: `Spec 029's emission (exit ${x.exit}: ${x.summary}) reads ${custom ? 'a failure' : unread.length ? `figures the approval did not read for ${unread.map((m) => m.spec).join(', ')}` : 'a conduct failure (refs moved, writes unexcused or sandboxes left)'}. A ruling lets it merge, as on 22 and 23 Sep 2026.` } };
    }
    return { commands, step };
  }

  decisionsEntry({ mergeSha, tip, subject, title, emit, figure }) {
    const a = this.p.last_approval || null;
    const approvalText = a
      ? `approval \`${path.relative(this.s.worktree, a.file)}\`, ${a.verdict}, blocking_findings ${a.blocking})`
      : `${this.s.tier}, no approval session by CONSTITUTION § Proportional oversight)`;
    const owed = readJson(path.join(this.recDir, 'owed.json'), []);
    const rulings = this.p.rulings || [];
    const packet = path.join(this.dir, 'PACKET.md');
    const pending = fs.existsSync(packet) ? ((/^## Pending DECISIONS entries?\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(fs.readFileSync(packet, 'utf8') + '\n') || [])[1] || '').trim() : '';
    const date = iso().slice(0, 10);
    return clean([
      '', `## ${date} - spec ${this.s.id} merges: ${title}`, '',
      `**Chose:** spec ${this.s.id} merges to \`${this.q.base_ref}\` (\`${mergeSha.slice(0, 8)}\`, branch tip \`${tip.slice(0, 8)}\`, subject \`${subject.slice(0, 8)}\`,`,
      `${approvalText}. Run by \`scripts/drive.mjs\` under the queue`,
      `\`${path.basename(this.q.file)}\`, after ${this.p.loops} fix loop(s) and ${this.p.approvals || 0} approval(s). The spec's gate \`--final\` on the merge`,
      `result reads ${figure.passed} passed, ${figure.failed} failed, equal to ${a ? 'the approval\'s receipt' : 'the checks stage\'s reading'}.`,
      pending ? `\n**Pending entries from the packet.**\n\n${pending}\n` : '',
      emit
        ? `**Merge-time command.** \`${emit.cmd.join(' ')}\` at \`${subject.slice(0, 8)}\`${emit.in_clone ? ` in a clone with \`${this.q.base_ref}\` pinned to \`${this.p.base.slice(0, 8)}\`` : ''}, exit ${emit.exit}: ${emit.summary || 'no summary line'}.`
        : `**Checks, no sweep.** ${this.p.checks_summary || 'no summary recorded'}. The nightly sweeps \`${this.q.base_ref}\` (CONSTITUTION § Proportional oversight, clauses 2 and 3).`,
      rulings.length ? `\n**Rulings.** ${rulings.map((r) => `${r.date} (${r.for_class} at ${r.stage}): "${r.ruling}"`).join('; ')}.` : '',
      `\n**Findings carried.** ${owed.length ? owed.map((o) => o.finding).join('; ') : 'none'}.`,
      '', '**What this entry does not authorize.** No push to `origin`, no tag, no npm.', '',
      `**Decided by:** the operator's queue \`${path.basename(this.q.file)}\`, run by \`scripts/drive.mjs\` on ${date}.`, '',
    ].join('\n'));
  }

  // ── the public push ───────────────────────────────────────────────────────────────────────────
  async stPublish() {
    const pub = this.s.publish || {};
    const rel = this.s.until === 'release';
    const gh = process.env.DRIVE_GH_TOKEN || process.env.GH_TOKEN;
    const missing = [!gh && 'DRIVE_GH_TOKEN', rel && !process.env.NPM_TOKEN && 'NPM_TOKEN'].filter(Boolean);
    if (missing.length) return this.stop('credential-absent', 'publish', `The ${this.s.until} push needs ${missing.join(' and ')} in the environment and it is not set. Set it and answer retry, or push by hand.`);
    const rec = this.begin('publish');
    const commands = []; const result = { built: false };
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `drive-publish-${this.s.id}-`));
    try {
      // main moves here and nowhere else, by RUNBOOK § Approve and publish step 5 ("merge to main"):
      // a fast-forward when main is behind the base ref, a `merge dev` commit otherwise, and only
      // onto a base ref whose repository gate was read green at that SHA, with the figure and the
      // SHA in the reflog (the operator's ruling of 2026-09-23; BACKLOG § 2 step 5).
      const mv = await this.moveMainForRelease(rec, commands);
      result.main = mv;
      if (mv.stop) { this.finish(rec, 'failed', { commands, ...result }); return this.stop(mv.stop.class, 'publish', mv.stop.detail); }
      const pubDir = path.resolve(expand(pub.dir || path.join(path.dirname(this.q.repo), 'driftproof-public')));
      const src = this.driver.checkoutOf(this.q.base_ref) || this.q.repo;
      if (git(src, 'status', '--porcelain').out) { this.finish(rec, 'failed', { commands }); return this.stop('checkout-dirty', 'publish', `${tilde(src)} is not clean; the public build reads it.`); }
      const build = pub.build || { cmd: ['bash', 'scripts/build-public.sh', '-m', pub.message || `spec ${this.s.id}`], minutes: 60 };
      const b = await this.runShell(rec, { name: 'build-public', minutes: 60, ...build }, src, null, 'publish');
      commands.push(b); result.built = b.exit === 0;
      // the build commits in the public tree: a write of this driver's, not a session's
      if (fs.existsSync(path.join(pubDir, '.git'))) {
        for (const l of git(pubDir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').out.split('\n').filter(Boolean)) {
          const [r, o] = l.split(' ');
          if (!this.driver.ownWrites.has(`public:${r}`)) this.driver.ownWrites.set(`public:${r}`, new Set());
          this.driver.ownWrites.get(`public:${r}`).add(o);
        }
      }
      if (b.exit !== 0) { this.finish(rec, 'failed', { commands, ...result }); return this.stop('operator-ruling', 'publish', `The public build failed: ${b.summary}`); }
      const remote = pub.remote_url || 'origin';
      const askpass = path.join(scratch, 'askpass.sh');
      fs.writeFileSync(askpass, '#!/bin/sh\ncase "$1" in *sername*) echo x-access-token ;; *) printf \'%s\\n\' "$DRIVE_GH_TOKEN" ;; esac\n', { mode: 0o700 });
      const env = { ...shellEnv(), GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0', DRIVE_GH_TOKEN: gh };
      // the lease: the remote's main as ls-remote reads it just before the push, never remembered
      const ls = spawnSync('git', ['-C', pubDir, 'ls-remote', remote, 'refs/heads/main'], { env, encoding: 'utf8' });
      const lease = (ls.stdout || '').split(/\s/)[0];
      commands.push({ runner: 'shell', cmd: ['git', 'ls-remote', remote, 'refs/heads/main'], exit: ls.status });
      if (ls.status !== 0 || !/^[0-9a-f]{40}$/.test(lease)) { this.finish(rec, 'failed', { commands, ...result }); return this.stop('operator-ruling', 'publish', `ls-remote could not read the public main: ${scrub(ls.stderr || '').slice(0, 200)}`); }
      result.lease = lease;
      const pushArgs = ['-C', pubDir, 'push', remote, 'main', `--force-with-lease=main:${lease}`];
      const push = spawnSync('git', pushArgs, { env, encoding: 'utf8' });
      commands.push({ runner: 'shell', cmd: ['git', ...pushArgs.slice(2)], exit: push.status, summary: scrub(push.stderr || '').slice(0, 200) });
      if (push.status !== 0) { this.finish(rec, 'failed', { commands, ...result }); return this.stop('push-failed', 'publish', `The public push was refused: ${scrub(push.stderr || '').slice(0, 300)}`); }
      result.pushed = gitOk(pubDir, 'rev-parse', 'HEAD');
      if (rel) {
        const version = readJson(path.join(pubDir, 'package.json'), {}).version;
        const tag = spawnSync('git', ['-C', pubDir, 'push', remote, `refs/tags/v${version}`], { env, encoding: 'utf8' });
        commands.push({ runner: 'shell', cmd: ['git', 'push', remote, `refs/tags/v${version}`], exit: tag.status });
        const npmrc = path.join(scratch, 'npmrc');
        fs.writeFileSync(npmrc, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n', { mode: 0o600 });
        const npmEnv = { ...shellEnv(), NPM_CONFIG_USERCONFIG: npmrc, NPM_TOKEN: process.env.NPM_TOKEN };
        const np = spawnSync('npm', ['publish', '--access', 'public'], { cwd: pubDir, env: npmEnv, encoding: 'utf8' });
        commands.push({ runner: 'shell', cmd: ['npm', 'publish', '--access', 'public'], exit: np.status, summary: scrub(np.stderr || '').slice(-200) });
        if (np.status !== 0) { this.finish(rec, 'failed', { commands, ...result }); return this.stop('operator-ruling', 'publish', `npm publish failed: ${scrub(np.stderr || '').slice(-300)}`); }
        const view = spawnSync('npm', ['view', `driftproof@${version}`, 'version'], { env: npmEnv, encoding: 'utf8' });
        result.npm_view = (view.stdout || '').trim();
        result.version = version;
      }
      result.live_checks = await liveChecks(this.s.live_checks || pub.live_checks || [], pub.live_minutes || 10);
      const ok = result.live_checks.every((c) => c.ok) && (!rel || result.npm_view === result.version);
      this.finish(rec, ok ? 'done' : 'failed', { commands, ...result }, { result: { ...result, next: null } });
      if (!ok) return this.stop('operator-ruling', 'publish', `The push went out but a live check did not read: ${JSON.stringify(result.live_checks)}`);
      this.p.state = 'published'; this.save();
      return null;
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  async moveMainForRelease(rec, commands) {
    const repo = this.q.repo; const base = this.q.base_ref;
    const tip = gitOk(repo, 'rev-parse', base);
    const oldMain = git(repo, 'rev-parse', '--verify', '-q', 'refs/heads/main').out || null;
    if (oldMain && git(repo, 'merge-base', '--is-ancestor', tip, oldMain).code === 0) return { moved: false, reason: `main already carries ${base} ${tip.slice(0, 8)}` };
    // the repository gate at this exact SHA: the merge's reading when the base ref has not moved since
    let fig = this.p.merged_base === tip && this.p.repo_gate_green ? this.p.repo_gate : null;
    const work = path.join(this.q.state, 'release', this.s.id);
    fs.rmSync(work, { recursive: true, force: true }); git(repo, 'worktree', 'prune');
    try {
      if (!fig) {
        gitOk(repo, 'worktree', 'add', '--detach', work, tip);
        for (const c of this.q.merge.copy) { const src = path.join(repo, c); if (fs.existsSync(src)) spawnSync('cp', ['-a', src, path.join(work, c)]); }
        const rg = await this.runShell(rec, { name: 'repo-gate-at-release', ...this.q.merge.repo_gate }, work, null, 'publish');
        rg.figure = repoGateFigure(work, this.q.merge.repo_gate, rg); commands.push(rg);
        if (!(rg.exit === 0 && rg.figure && rg.figure.failed === 0)) return { moved: false, stop: { class: 'ruling-needed', detail: `main moves only onto a green repository gate, and at ${base} ${tip.slice(0, 8)} it reads ${rg.figure ? `${rg.figure.passed} passed, ${rg.figure.failed} failed` : `exit ${rg.exit}`}. Nothing was moved or pushed.` } };
        fig = rg.figure;
        this.removeWork(work);
      }
      const msg = `repository gate ${fig.passed}/${fig.passed + fig.failed} passed, 0 failed at ${base} ${tip.slice(0, 8)} (release stage, scripts/drive.mjs, spec ${this.s.id})`;
      let to = tip; let how = 'fast-forward';
      if (oldMain && git(repo, 'merge-base', '--is-ancestor', oldMain, tip).code !== 0) {
        gitOk(repo, 'worktree', 'add', '--detach', work, oldMain);
        const m = git(work, 'merge', '--no-ff', '--no-edit', '-m', `merge ${base}: ${msg}`, tip);
        if (m.code !== 0) { git(work, 'merge', '--abort'); return { moved: false, stop: { class: 'merge-conflict', detail: `merging ${base} into main conflicts: ${m.err.slice(0, 300)}` } }; }
        to = gitOk(work, 'rev-parse', 'HEAD'); how = 'merge';
      }
      this.moveRef('main', to, oldMain || '0'.repeat(40), this.driver.checkoutOf('main'), `${how} main to ${base} ${tip.slice(0, 8)}; ${msg}`);
      const push = git(repo, 'push', '-q', this.q.remote, 'refs/heads/main:refs/heads/main');
      if (push.code === 0) this.driver.noteRemoteWrite(this.q.remote, 'refs/heads/main', to);
      commands.push({ runner: 'shell', cmd: ['git', 'push', this.q.remote, 'refs/heads/main:refs/heads/main'], exit: push.code });
      if (push.code !== 0) return { moved: true, stop: { class: 'push-failed', detail: `git push ${this.q.remote} main: ${push.err.slice(0, 300)}` } };
      return { moved: true, how, from: oldMain, to, figure: fig };
    } finally {
      if (fs.existsSync(work)) this.removeWork(work);
    }
  }

  // ── the machine ───────────────────────────────────────────────────────────────────────────────
  nextStage() {
    if (!this.p) return 'worktree';
    if (this.p.resume_stage) { const r = this.p.resume_stage; delete this.p.resume_stage; this.save(); return r; }
    const last = this.lastStage();
    if (!last) return 'worktree';
    if (last.status === 'started') return last.stage;
    if (last.result && 'next' in last.result) return last.result.next;
    if (last.status === 'failed') return last.stage;
    return { worktree: 'build', build: 'checks', fix: 'checks', rebase: 'fix' }[last.stage] || null;
  }
  async drive(stopAfter) {
    for (;;) {
      if (!['new', 'running'].includes(this.state)) return;
      // a guard against a loop the stage machine did not foresee: no spec needs this many stages
      if (this.p && this.p.stages.length >= 60) { await this.stop('driver-error', (this.lastStage() || {}).stage || 'unknown', `The spec has run ${this.p.stages.length} stages; the driver stops rather than loop.`); return; }
      if (!this.p) this.p = { spec: this.s.id, queue: this.q.name, branch: this.s.branch, worktree: this.s.worktree, base_ref: this.q.base_ref, created: iso(), state: 'running', loops: 0, approvals: 0, stages: [] };
      const last = this.lastStage();
      if (last && last.status === 'started' && last.pgid && alive(last.pgid)) { try { process.kill(-last.pgid, 'SIGKILL'); } catch {} }
      if (last && last.status === 'started') { last.status = 'interrupted'; last.ended = iso(); this.save(); }
      let stage = last && last.status === 'interrupted' ? last.stage : this.nextStage();
      if (stage === 'fix' && this.p.pending_rebase_fix) stage = 'rebase-fix';
      if (!stage) { if (this.p.state === 'running') { this.p.state = 'done'; this.save(); } return; }
      this.log(`stage ${stage}`);
      const refsBefore = this.refsSnapshot();
      const remoteBefore = this.remoteSnapshot();
      const window = { spec: this.s.id, ref: `refs/heads/${this.s.branch}`, start: Date.now(), end: null };
      this.driver.stageWindows.push(window);
      const nBefore = this.p.stages.length;
      let next;
      try { switch (stage) {
        case 'worktree': next = await this.stWorktree(); break;
        case 'build': next = await this.stBuild(); break;
        case 'checks': next = await this.stChecks(); break;
        case 'approve': next = await this.stApprove(); break;
        case 'triage': next = await this.stTriage(); break;
        case 'fix': next = await this.stFix(); break;
        case 'rebase-fix': next = await this.stFix(this.p.pending_rebase_fix); break;
        case 'rebase': next = await this.stRebase(); break;
        case 'ready': next = await this.stReady(); break;
        case 'merge': next = await this.stMerge(); break;
        case 'publish': next = await this.stPublish(); break;
        default: throw new Error(`unknown stage ${stage}`);
      } } finally { window.end = Date.now(); }
      // the guards, after every stage whatever its kind (approval F-4), written into the stage's
      // own record; a stage that stopped is guarded too, and a move stops it with its own class
      const g = this.refsMoved(refsBefore, window.start);
      const rm = this.remoteMoved(remoteBefore);
      const recs = this.p.stages.slice(nBefore).filter((x) => x.record);
      for (const x of recs) {
        const f = path.join(this.recDir, x.record);
        const j = readJson(f);
        if (j) writeJson(f, { ...j, ref_guard: { checked: true, moved: g.moved, attributed: g.attributed, remote_moved: rm } });
      }
      if (g.moved.length || rm.length) {
        if (this.p.state === 'stopped') { this.p.stop.detail += ` Also, refs moved: ${[...g.moved, ...rm].join('; ')}.`; this.save(); }
        else { await this.stop(g.moved.length ? 'ref-moved' : 'remote-moved', stage, `During the ${stage} stage refs moved that it does not own: ${[...g.moved, ...rm].join('; ')}. Put them back, then answer retry.`, recs.map((x) => path.join(this.recDir, x.record))); }
        return;
      }
      if (recs.length && next !== 'stopped') this.commitRecords(`${stage} guard`);
      // the ready stage pushed before its guard ran; its guard commit goes to the remote too
      if (stage === 'ready' && next !== 'stopped') {
        const b = `refs/heads/${this.s.branch}`;
        if (git(this.q.repo, 'push', '-q', this.q.remote, `${b}:${b}`).code === 0) this.driver.noteRemoteWrite(this.q.remote, b, gitOk(this.q.repo, 'rev-parse', b));
      }
      if (next === 'stopped') return;
      const done = this.lastStage();
      if (done && ['done', 'failed'].includes(done.status) && (!done.result || !('next' in done.result) || done.result.next !== next)) { done.result = { ...(done.result || {}), next }; this.save(); }
      if (next == null) { if (this.p.state === 'running') { this.p.state = 'done'; this.save(); } return; }
      if (stopAfter && stage === stopAfter) { this.p.state = 'paused'; this.p.paused_before = next; this.save(); this.log(`paused after ${stage} (--stop-after); next would be ${next}`); return; }
    }
  }
}

function shellEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!['DRIVE_GH_TOKEN', 'GH_TOKEN', 'NPM_TOKEN', 'GITHUB_TOKEN'].includes(k) && !/^CLAUDE/.test(k)) env[k] = v;
  return env;
}
function repoGateFigure(root, cfg, run) {
  if (cfg.figure_file) {
    const j = readJson(path.join(root, cfg.figure_file));
    if (j && Number.isFinite(j.passed) && Number.isFinite(j.failed)) return { passed: j.passed, failed: j.failed, na: j.notApplicable ?? j.na ?? null, source: cfg.figure_file };
  }
  const m = /(\d+)\s+passed,\s+(\d+)\s+failed/.exec(run.summary || '');
  return m ? { passed: Number(m[1]), failed: Number(m[2]), source: 'summary line' } : null;
}
async function liveChecks(checks, minutes) {
  const out = [];
  for (const c of checks) {
    const t0 = Date.now(); let ok = false; let status = null;
    while (!ok && Date.now() - t0 < minutes * 60000) {
      try {
        const r = await fetch(c.url, { signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache' } });
        status = r.status;
        ok = r.ok && (await r.text()).includes(c.expect);
      } catch (e) { status = String(e.message).slice(0, 80); }
      if (!ok) await sleep(Math.min(20000, minutes * 60000));
    }
    out.push({ url: c.url, expect: c.expect, ok, status, waited_ms: Date.now() - t0 });
  }
  return out;
}

// The queue lock: created with O_EXCL, so of two drivers started together exactly one creates it
// (approval F-5). A lock whose pid is dead is taken over under a second O_EXCL file, re-read under
// it, so two drivers finding the same stale lock cannot both take it over.
function takeLock(lock) {
  const mine = JSON.stringify({ pid: process.pid, started: iso() });
  for (let i = 0; i < 20; i++) {
    try { fs.writeFileSync(lock, mine, { flag: 'wx' }); return true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const held = readJson(lock);
    if (held && alive(held.pid)) return held.pid;
    const take = `${lock}.takeover`;
    try { fs.writeFileSync(take, String(process.pid), { flag: 'wx' }); } catch {
      try { if (Date.now() - fs.statSync(take).mtimeMs > 60000) fs.rmSync(take, { force: true }); } catch {}
      spawnSync('sleep', ['0.2']);
      continue;
    }
    try {
      const again = readJson(lock);
      if (!again || !alive(again.pid)) fs.rmSync(lock, { force: true });
    } finally { fs.rmSync(take, { force: true }); }
  }
  const held = readJson(lock);
  return held ? held.pid : 'unknown';
}

// ── the queue driver ────────────────────────────────────────────────────────────────────────────
class Driver {
  constructor(q, opts) {
    this.q = q; this.opts = opts;
    this.ownWrites = new Map();
    this.ownRemoteWrites = new Map();
    this.stageWindows = [];
    this.mergeChain = Promise.resolve();
    this.runs = q.specs.map((s) => new SpecRun(q, s, this));
  }
  queueSpent() { return this.runs.reduce((t, r) => t + r.spent(), 0); }
  watches(ref) {
    if (ref.startsWith('public:')) return true;
    return ref === `refs/heads/${this.q.base_ref}` || ref === 'refs/heads/main' || this.q.specs.some((s) => ref === `refs/heads/${s.branch}`);
  }
  concurrentOwner(ref, me, from, to) {
    const w = this.stageWindows.find((x) => x.spec !== me && x.ref === ref && x.start < to && (x.end == null || x.end > from));
    return w ? w.spec : null;
  }
  noteRemoteWrite(remote, ref, sha) {
    const k = `${remote} ${ref}`;
    if (!this.ownRemoteWrites.has(k)) this.ownRemoteWrites.set(k, new Set());
    this.ownRemoteWrites.get(k).add(sha);
  }

  // THE PUSH GUARD (approval F-7). A session cannot push from, or into, the driven repository,
  // whatever the spelling: every git it runs reads this environment, so `git -C`, an alias,
  // `sh -c`, `env git` and `--no-verify` all meet
  //   - no credentials: GIT_SSH_COMMAND and core.sshCommand are /bin/false, no agent socket, no
  //     askpass, no credential helper, so no SSH or HTTPS push reaches any remote;
  //   - a pre-push hook that exits 1 when the pushing repository is the driven one;
  //   - url.<dead>.insteadOf for every URL of the driven repository's remotes, and for its own
  //     paths and the public tree's, which rewrites explicit pushurls too and which --no-verify does
  //     not skip;
  //   - a reference-transaction hook that, inside the driven repository, refuses any branch or tag
  //     update but the session's own branch.
  // Scratch repositories a gate makes under $TMPDIR are outside all four: their pushes and commits
  // run as usual, with their own hooks. What stays open is a session that deliberately strips its
  // environment, or pushes with --no-verify through a pushurl into some other local repository; the
  // ref and remote guards after every stage are what see the first, and the public tree's refs are
  // among those the guard reads.
  hooksDir() {
    if (this._hooks) return this._hooks;
    const dir = path.join(this.q.state, 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    const here = 'common=$(cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)';
    // inside the driven repository chain to its own hooks; elsewhere to that repository's defaults
    const chain = (name) => `${here}\nif [ "$common" = "$DRIVE_REPO_COMMON" ]; then orig="$DRIVE_ORIG_HOOKS/${name}"; else orig="$common/hooks/${name}"; fi\n`;
    for (const name of ['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'post-rewrite', 'pre-auto-gc', 'post-index-change']) {
      fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n# scripts/drive.mjs: chains to the repository's own hook\n${chain(name)}[ -x "$orig" ] && exec "$orig" "$@"\nexit 0\n`, { mode: 0o755 });
    }
    fs.writeFileSync(path.join(dir, 'pre-push'), `#!/bin/sh\n# scripts/drive.mjs: no push from the driven repository (spec 048 AC-17)\n${chain('pre-push')}if [ "$common" = "$DRIVE_REPO_COMMON" ]; then echo "drive.mjs: a push from a driven session is refused (spec 048 AC-17)" >&2; exit 1; fi\n[ -x "$orig" ] && exec "$orig" "$@"\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'reference-transaction'), [
      '#!/bin/sh',
      '# scripts/drive.mjs: inside the driven repository a session moves no branch or tag but its own (spec 048 AC-17)',
      'input=$(cat)',
      here,
      'if [ "$1" = prepared ] && [ "$common" = "$DRIVE_REPO_COMMON" ]; then',
      '  printf "%s\\n" "$input" | while read -r old new ref; do',
      '    case "$ref" in refs/heads/*|refs/tags/*) ;; *) continue ;; esac',
      '    if [ "$ref" != "$DRIVE_OWN_BRANCH" ]; then echo "drive.mjs: this session may not move $ref (spec 048 AC-17)" >&2; exit 1; fi',
      '  done || exit 1',
      'fi',
      'if [ "$common" = "$DRIVE_REPO_COMMON" ]; then orig="$DRIVE_ORIG_HOOKS/reference-transaction"; else orig="$common/hooks/reference-transaction"; fi',
      'if [ -x "$orig" ]; then printf "%s\\n" "$input" | exec "$orig" "$@"; fi',
      'exit 0', '',
    ].join('\n'), { mode: 0o755 });
    this._hooks = dir;
    return dir;
  }
  guardedTargets() {
    const repo = this.q.repo;
    const urls = new Set();
    for (const l of git(repo, 'config', '--get-regexp', '^remote\\..*\\.(url|pushurl)$').out.split('\n').filter(Boolean)) urls.add(l.split(' ').slice(1).join(' '));
    const common = fs.realpathSync(path.resolve(repo, git(repo, 'rev-parse', '--git-common-dir').out));
    const paths = [repo, common, path.dirname(common)];
    for (const l of git(repo, 'worktree', 'list', '--porcelain').out.split('\n')) if (l.startsWith('worktree ')) paths.push(l.slice(9));
    const pub = this.publicDir();
    if (pub) paths.push(pub);
    for (const p of paths) { urls.add(p); urls.add(`file://${p}`); try { const r = fs.realpathSync(p); urls.add(r); urls.add(`file://${r}`); } catch {} }
    return [...urls].filter(Boolean);
  }
  publicDir() {
    const specPub = this.q.specs.map((s) => s.publish && s.publish.dir).find(Boolean);
    const d = path.resolve(expand(specPub || path.join(path.dirname(this.q.repo), 'driftproof-public')));
    return fs.existsSync(path.join(d, '.git')) ? d : null;
  }
  pushGuardEnv(worktree, ownBranch) {
    const common = fs.realpathSync(path.resolve(this.q.repo, git(this.q.repo, 'rev-parse', '--git-common-dir').out));
    const configured = git(fs.existsSync(worktree) ? worktree : this.q.repo, 'config', '--get', 'core.hooksPath').out;
    const orig = configured ? path.resolve(fs.existsSync(worktree) ? worktree : this.q.repo, configured) : path.join(common, 'hooks');
    const dead = `${path.join(this.q.state, 'no-push')}/`;
    const cfg = [['core.hooksPath', this.hooksDir()], ['core.sshCommand', '/bin/false'], ['credential.helper', '']];
    for (const t of this.guardedTargets()) cfg.push([`url.${dead}.insteadOf`, t]);
    const env = { GIT_CONFIG_COUNT: String(cfg.length), GIT_SSH_COMMAND: '/bin/false', GIT_ASKPASS: '/bin/false', SSH_ASKPASS: '/bin/false', GIT_TERMINAL_PROMPT: '0',
      DRIVE_REPO_COMMON: common, DRIVE_OWN_BRANCH: ownBranch || 'none', DRIVE_ORIG_HOOKS: orig };
    cfg.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
    return env;
  }
  queueExtra() { return 0; }
  checkoutOf(ref) {
    const out = git(this.q.repo, 'worktree', 'list', '--porcelain').out;
    let cur = null;
    for (const l of out.split('\n')) {
      if (l.startsWith('worktree ')) cur = l.slice(9);
      if (l === `branch refs/heads/${ref}`) return cur;
    }
    return null;
  }
  async notify(payload) {
    const url = process.env.DRIVE_NOTIFY_URL;
    if (!url) return;
    let status;
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queue: this.q.name, ...payload }), signal: AbortSignal.timeout(10000) });
      status = r.status;
    } catch (e) { status = `error: ${String(e.message).slice(0, 80)}`; }
    fs.appendFileSync(path.join(this.q.state, 'notify-sent.jsonl'), JSON.stringify({ t: iso(), spec: payload.spec, class: payload.class, status }) + '\n');
  }
  // One merge at a time: in this process by a promise chain, across drivers by a lock file in the
  // repository's common git directory.
  withMergeLock(fn) {
    const run = async () => {
      const common = path.resolve(this.q.repo, git(this.q.repo, 'rev-parse', '--git-common-dir').out);
      const lock = path.join(common, 'drive-merge.lock');
      for (let i = 0; ; i++) {
        try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; } catch {
          const pid = Number(fs.readFileSync(lock, 'utf8')) || 0;
          if (!pid || !alive(pid)) { fs.rmSync(lock, { force: true }); continue; }
          if (i > 7200) throw new Error('the merge lock was held for two hours');
          await sleep(1000);
        }
      }
      try { return await fn(); } finally { fs.rmSync(lock, { force: true }); }
    };
    const p = this.mergeChain.then(run, run);
    this.mergeChain = p.catch(() => {});
    return p;
  }
  depsState(run) {
    for (const d of run.s.depends_on) {
      const dep = this.runs.find((r) => r.s.id === d);
      if (['merged', 'published'].includes(dep.state)) continue;
      if (['stopped', 'skipped', 'ended', 'ready', 'paused'].includes(dep.state) || (dep.state === 'done' && !['merged', 'published'].includes(dep.state))) return 'blocked';
      return 'waiting';
    }
    return 'ok';
  }
  async run() {
    fs.mkdirSync(this.q.state, { recursive: true });
    const lock = path.join(this.q.state, 'drive.lock');
    const got = takeLock(lock);
    if (got !== true) {
      process.stderr.write(`drive: the queue is locked by pid ${got} (${tilde(lock)})\n`);
      return 4;
    }
    const release = () => { try { if ((readJson(lock) || {}).pid === process.pid) fs.rmSync(lock, { force: true }); } catch {} };
    process.on('exit', release);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { release(); process.exit(130); });
    try {
      for (const r of this.runs) if (r.state === 'stopped') r.applyAnswer();
      for (const r of this.runs) if (r.state === 'paused' && !this.opts.stopAfter) { r.p.state = 'running'; r.save(); }
      const jobs = Math.max(1, Number(this.opts.jobs || 1));
      const active = new Map();
      for (;;) {
        for (const r of this.runs) {
          if (active.size >= jobs) break;
          if (active.has(r) || !['new', 'running'].includes(r.state)) continue;
          if (this.depsState(r) !== 'ok') continue;
          const p = r.drive(this.opts.stopAfter).catch(async (e) => {
            if (!r.p) throw e;
            await r.stop('driver-error', (r.lastStage() || {}).stage || 'unknown', `The driver failed: ${e.stack || e.message}`);
          }).finally(() => active.delete(r));
          active.set(r, p);
        }
        if (!active.size) break;
        await Promise.race(active.values());
      }
    } finally { release(); }
    let code = 0;
    for (const r of this.runs) {
      const dep = this.depsState(r);
      const st = r.state === 'new' && dep !== 'ok' ? `blocked (depends on ${r.s.depends_on.join(', ')})` : r.state;
      process.stdout.write(`  ${r.s.id.padEnd(40)} ${st}${r.p && r.p.stop ? ` (${r.p.stop.class})` : ''}  spent ${r.spent().toFixed(2)} USD\n`);
      const target = { 'approval-ready': ['ready'], approved: ['ready'], merged: ['merged'], site: ['published'], release: ['published'] }[r.s.until];
      // a pause asked for with --stop-after is where the run was told to end, not a stop
      if (!target.includes(r.state) && r.state !== 'done' && !(r.state === 'paused' && this.opts.stopAfter)) code = 3;
    }
    return code;
  }
  status() {
    for (const r of this.runs) {
      const last = r.lastStage();
      process.stdout.write(`  ${r.s.id.padEnd(40)} ${r.state.padEnd(9)} ${last ? `${last.stage} ${last.status}` : '-'}  loops ${r.p ? r.p.loops : 0}  spent ${r.spent().toFixed(2)} of ${r.budget().toFixed(2)} USD${r.p && r.p.stop ? `  QUESTION: ${r.p.stop.class}` : ''}\n`);
    }
    process.stdout.write(`  queue spent ${this.queueSpent().toFixed(2)} of ${this.q.budget_usd.toFixed(2)} USD\n`);
    return 0;
  }
}

// `summary`: what each spec's run did, derived by the driver from its own records and from the
// repository's refs as git reads them now; nothing in it is typed (approval F-2).
function summarize(q) {
  const selfDir = path.dirname(new URL(import.meta.url).pathname);
  const selfRepo = git(selfDir, 'rev-parse', '--show-toplevel').out;
  const selfRel = path.relative(selfRepo, new URL(import.meta.url).pathname);
  // the driver as it ran: the last commit that changed this file (HEAD of the repository it runs in
  // may be a merge made by this very run), the file's blob at HEAD, and whether the file on disk is it
  const driver = selfRepo ? {
    commit: git(selfRepo, 'log', '-1', '--format=%H', '--', selfRel).out, commit_rule: 'the last commit that changed the file',
    blob: git(selfRepo, 'rev-parse', `HEAD:${selfRel}`).out, file: selfRel,
    unmodified: git(selfRepo, 'diff', '--quiet', 'HEAD', '--', selfRel).code === 0, sha256: sha256(fs.readFileSync(new URL(import.meta.url))),
  } : null;
  const specs = [];
  for (const s of q.specs) {
    const recDir = path.join(s.worktree, 'specs', s.id, 'evidence', 'driver');
    const p = readJson(path.join(recDir, 'progress.json'));
    if (!p) { specs.push({ spec: s.id, state: 'new' }); continue; }
    const rec = (x) => (x.record ? readJson(path.join(recDir, x.record)) : null);
    const sessions = p.stages.filter((x) => x.kind === 'session').map((x) => ({ stage: x.stage, n: x.n, status: x.status, ...(({ model, turns, cost_usd, timed_out }) => ({ model, turns, cost_usd, timed_out }))(rec(x) || {}) }));
    const models = [...new Set(sessions.map((x) => x.model).filter(Boolean))];
    const approvals = p.stages.filter((x) => x.stage === 'approve' && x.status === 'done').map((x) => { const a = ((rec(x) || {}).result || {}).approval || {}; return { stage_n: x.n, record: a.file ? path.basename(a.file) : null, commit: a.commit, verdict: a.verdict, blocking: a.blocking }; });
    const merges = p.stages.filter((x) => x.stage === 'merge').map((x) => { const r = rec(x) || {}; return { stage_n: x.n, status: x.status, class: r.class || null, steps: (r.steps || []).map((y) => y.step), base: (r.steps || []).find((y) => y.step === 'base') || null, merge_commit: r.merge_commit || null }; });
    const refNow = (ref) => git(q.repo, 'rev-parse', '--verify', '-q', ref).out || null;
    const remote = {};
    const ls = spawnSync('git', ['-C', q.repo, 'ls-remote', '--heads', q.remote], { encoding: 'utf8', env: shellEnv(), timeout: 60000 });
    for (const l of (ls.stdout || '').split('\n').filter(Boolean)) { const [sha, ref] = l.split('\t'); if ([`refs/heads/${q.base_ref}`, 'refs/heads/main', `refs/heads/${s.branch}`].includes(ref)) remote[ref] = sha; }
    specs.push({
      spec: s.id, state: p.state, until: s.until, base: p.base,
      verification_level: models.length && models.every((m) => m === 'test-double') ? 'UNVERIFIED' : 'as each session record states',
      models, stages: p.stages.map((x) => `${x.stage}:${x.status}`), sessions,
      fix_loops: p.loops, approvals, merges, rulings: p.rulings || [],
      owed: readJson(path.join(recDir, 'owed.json'), []),
      refs_now: { [q.base_ref]: refNow(`refs/heads/${q.base_ref}`), main: refNow('refs/heads/main'), [s.branch]: refNow(`refs/heads/${s.branch}`) },
      remote_now: { remote: q.remote, refs: remote },
      spent_usd: p.stages.reduce((t, x) => t + (x.cost_usd != null ? x.cost_usd : (x.reserved_usd || 0)), 0),
    });
  }
  return clean({ generated_by: 'node scripts/drive.mjs summary', generated_at: iso(), queue: path.basename(q.file), driver, specs });
}

async function main(argv) {
  const [cmd, queue, ...rest] = argv;
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  if (!['run', 'status', 'summary'].includes(cmd) || !queue) {
    process.stderr.write('usage: node scripts/drive.mjs run <queue.json> [--state <dir>] [--jobs N] [--stop-after <stage>]\n       node scripts/drive.mjs status <queue.json> [--state <dir>]\n       node scripts/drive.mjs summary <queue.json> [--state <dir>] [--out <file>]\n');
    return 2;
  }
  const stopAfter = opt('--stop-after');
  if (stopAfter && !STAGES.includes(stopAfter)) { process.stderr.write(`drive: --stop-after takes one of ${STAGES.join(', ')}\n`); return 2; }
  const q = loadQueue(queue, { state: opt('--state') });
  if (cmd === 'summary') {
    const text = JSON.stringify(summarize(q), null, 2) + '\n';
    if (opt('--out')) writeAtomic(path.resolve(opt('--out')), text); else process.stdout.write(text);
    return 0;
  }
  const d = new Driver(q, { jobs: opt('--jobs'), stopAfter });
  return cmd === 'status' ? d.status() : d.run();
}

// a queue refusal (loadQueue's `queue: ...`) is the message, not a stack
main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`drive: ${/^queue: /.test(e.message) ? e.message : (e.stack || e.message)}\n`); process.exit(1); });
