#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/integrate.mjs - the integrator (spec 066): builders in parallel, merges in series onto the
// branch `staging`, which it owns, under a decision policy it enforces and never edits.
//
// One `tick` reads the policy file and the halts, collects the builders that ended, merges at most
// one approved item onto `staging`, and starts builders up to the limit. A builder is the driver
// (`scripts/drive.mjs`, spec 048) over a one-entry queue in a clone of its own; it never merges and
// pushes nothing. A merge runs merge-check (or, for T3, the driver's T3 path guard), the --no-ff
// merge, the item's gate and its figure against the approval's, the core set, the gates reading what
// it touches and those of the items above dev, the DECISIONS entry and the repository gate, each
// gate under the chain's lock and re-run once on a red; then `staging` is pushed with a lease read just before. `nightly` reads a sweep's record and
// finds the culprit of a red. Staging is not the record: dev, after the train (spec 067), is.
//
// The train (spec 067): `train` runs at the cutoff, 23:00 SGT (15:00 UTC), and pins the staging tip
// as the release candidate, or, when a release is requested on inbox, queues the bump item and pins
// the staging its merge leaves. `serve` is the service: a loop of passes that advances the train
// (a green nightly of the candidate moves dev; the release is staged in <stage_root>/<sha>, checked
// and tagged locally; the go on inbox moves main), hands the night's record to `nightly`, runs
// `tick`, and fast-forwards the operator's checkout when dev moved and it is idle and clean. The
// train moves dev and main only under its own hold (train/HOLD, read by `tick`) and only when no
// builder is alive. It pushes no tag and nothing to origin, and makes no commit.
//
//   node scripts/integrate.mjs tick <config.json> [--now <iso>] [--wait]
//   node scripts/integrate.mjs nightly <config.json> --result <sweep-run.json> [--now <iso>]
//   node scripts/integrate.mjs train <config.json> [--now <iso>]
//   node scripts/integrate.mjs serve <config.json> [--now <iso>] [--passes <n>] [--interval-seconds <s>]
//   node scripts/integrate.mjs pin-policy <config.json>
//   node scripts/integrate.mjs status <config.json>
//
// BUILT, NOT SWITCHED ON. Nothing here runs on a timer until the operator installs the units in
// deploy/ (spec 067). State is files under the config's state_dir (~/.driftproof-integrator by
// default): items/, merges/, ticks/, nightly/, agreements/, train/, serve/, flakes.jsonl and
// report.jsonl, which spec 068's digest reads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readPolicy, repoGateFigure, REPO_GATE_DEFAULT, STAGE_DEFAULTS, copyPaths, t3PathGuard, gateFigureAt, approvalFigure, receiptNamed } from './drive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DRIVE = path.join(HERE, 'drive.mjs');
const POLICY_REL = 'specs/000-governance/integrator-policy.md';
const SETTINGS_REL = 'specs/000-governance/integrator-settings.json';
// the release bump's fixed brief, until spec 068's intake writes briefs (spec 067 R-2)
const BUMP_BRIEF_REL = 'specs/000-governance/release-bump-brief.md';
// the train's cutoff, 23:00 SGT, in UTC (the brief's section on the nightly's time)
const CUTOFF = '15:00';
// the two files on inbox the train reads (spec 067, "The inbox files")
const INBOX = { ref: 'inbox', request: 'release/request', go: 'release/go' };
// the refs the integrator owns on the remote (ruling 6); it force-pushes staging alone
const INTEGRATOR_REFS = ['staging', 'inbox', 'status/digest'];
const QUIET = /^driftproof-.*quiet/;
// runners and builders stop 20 minutes before the nightly (the brief's section on the nightly's time)
const WINDOW_FROM = '19:40';
// the brief's limits, until spec 068's settings file names them; the driver keeps fix loops at or
// under the constitution's three, so the lower applies
const DEFAULT_LIMITS = { fix_loops: 2, reruns_per_gate: 1, session_minutes: 150, flake_days: 7, flake_count: 2 };
// R-7: Opus for briefs, fix loops and approvals, and the build; Sonnet for the mechanical triage
const STAGE_MODELS = { build: 'opus', approve: 'opus', triage: 'sonnet', fix: 'opus' };
const DAY = 86400000;

// ── small utilities ─────────────────────────────────────────────────────────────────────────────
const HOME = os.homedir();
const expand = (p) => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? path.join(HOME, p.slice(1)) : p);
const iso = () => new Date().toISOString();
const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, f);
}
const appendJsonl = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(obj) + '\n'); };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function gitOk(cwd, ...args) {
  const r = git(cwd, ...args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.err || r.out}`);
  return r.out;
}
// tokens never reach a gate or a session
function baseEnv() {
  const env = { ...process.env };
  for (const k of ['DRIVE_GH_TOKEN', 'GH_TOKEN', 'NPM_TOKEN', 'GITHUB_TOKEN', 'DRIVE_NOTIFY_URL']) delete env[k];
  return env;
}

// ── the config ──────────────────────────────────────────────────────────────────────────────────
function loadConfig(file) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(path.resolve(file));
  const abs = (p) => path.resolve(dir, expand(p));
  if (!c.remote_url) throw new Error('config: remote_url is required');
  // AC-1: a builders value that is not a positive integer stops the integrator, never unlimited
  if ('builders' in c && !(Number.isInteger(c.builders) && c.builders >= 1)) throw new Error(`config: builders is ${JSON.stringify(c.builders)}, not a positive integer; the integrator stops rather than guess a limit`);
  const state = abs(c.state_dir || '~/.driftproof-integrator');
  const settings = readJson(path.join(ROOT, SETTINGS_REL), {}) || {};
  return {
    file: path.resolve(file), remote_url: c.remote_url, remote: c.remote || 'private', source: c.source ? abs(c.source) : null,
    state, base_ref: c.base_ref || 'dev', staging: c.staging || 'staging',
    stop_file: abs(c.stop_file || path.join(state, 'STOP')), pause_file: abs(c.pause_file || path.join(state, 'PAUSE')),
    marker_dir: abs(c.marker_dir || '/var/tmp'), lock: c.lock ? abs(c.lock) : null, builders: c.builders,
    approve_cwd: abs(c.approve_cwd || '~/.driftproof-approve'), agree_cwd: abs(c.agree_cwd || '~/.driftproof-agree'),
    policy: c.policy ? abs(c.policy) : path.join(ROOT, POLICY_REL),
    limits: { ...DEFAULT_LIMITS, ...(settings.limits || {}), ...(c.limits || {}) },
    builder_stages: c.builder_stages || {},
    train: {
      stage_root: abs((c.train || {}).stage_root || '/var/tmp'),
      nightly_state: abs((c.train || {}).nightly_state || '~/.driftproof-nightly'),
      checkout: abs((c.train || {}).checkout || '~/driftproof'),
      interval_seconds: Number((c.train || {}).interval_seconds || 600),
      stage_minutes: Number((c.train || {}).stage_minutes || 120),
    },
    merge: {
      repo_gate: { ...REPO_GATE_DEFAULT, ...((c.merge || {}).repo_gate || {}) },
      core: (c.merge || {}).core || null,
      gate_minutes: Number((c.merge || {}).gate_minutes || 90),
    },
  };
}

// ── the policy file ─────────────────────────────────────────────────────────────────────────────
// Every table row whose first cell is a backticked id, grouped under the `## ` heading above it.
function policyTables(text) {
  const out = {};
  let h = null;
  for (const line of text.split('\n')) {
    const m = /^## (.+)$/.exec(line);
    if (m) { h = m[1].trim(); continue; }
    const cells = line.split('|').map((x) => x.trim());
    if (cells.length < 4 || !h) continue;
    const id = /^`([a-z][a-z-]*)`$/.exec(cells[1]);
    if (id) (out[h] ||= []).push({ id: id[1], what: cells[2], action: (/^`([a-z][a-z-]*)`$/.exec(cells[cells.length - 2]) || [])[1] || null });
  }
  return out;
}
function readIntegratorPolicy(cfg) {
  const refuse = (kind, detail) => ({ ok: false, kind, detail });
  let text;
  try { text = fs.readFileSync(cfg.policy, 'utf8'); } catch (e) { return refuse('policy-unreadable', `${cfg.policy}: ${e.message}`); }
  const actual = sha256(text);
  const pinned = (() => { try { return fs.readFileSync(path.join(cfg.state, 'policy.sha256'), 'utf8').trim(); } catch { return null; } })();
  if (!pinned) return refuse('policy-not-pinned', 'no policy digest is pinned in the state directory: the integrator is not switched on (pin-policy is the switch-on step)');
  if (pinned !== actual) return refuse('policy-changed', `the policy file's digest is ${actual.slice(0, 12)}, not the pinned ${pinned.slice(0, 12)}: the policy file changed, and only the operator changes it`);
  const t = policyTables(text);
  const classes = Object.fromEntries((t.Classes || []).map((r) => [r.id, r.action]));
  const never = t["Never without the operator's go"] || [];
  const gov = never.find((r) => r.id === 'edit-governance');
  if (!Object.keys(classes).length || !gov) return refuse('policy-unreadable', 'the policy file carries no Classes table or no edit-governance row');
  return { ok: true, digest: actual, classes, never: never.map((r) => r.id), governance: [...gov.what.matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
}

// The model id for a family: the row with that family, no lifecycle field, the latest released.
function modelFor(family) {
  const rows = (readJson(path.join(ROOT, 'config', 'models.json'), {}) || {}).models || [];
  // a row with no release date is not a candidate (String(null) would sort after every date)
  const row = rows.filter((r) => r.family === family && !('lifecycle' in r) && /^\d{4}-\d{2}-\d{2}$/.test(String(r.released))).sort((a, b) => b.released.localeCompare(a.released))[0];
  return row ? row.id : null;
}

// ── the context of one run ──────────────────────────────────────────────────────────────────────
class Halt extends Error {}
function context(cfg, opts) {
  const t0 = Date.now();
  const base = opts.now ? Date.parse(opts.now) : t0;
  if (!Number.isFinite(base)) throw new Error(`--now ${opts.now} is not a time`);
  const ctx = { cfg, opts, clock: () => new Date(base + (Date.now() - t0)), record: { now: new Date(base).toISOString(), started: iso(), pid: process.pid } };
  ctx.itemsDir = path.join(cfg.state, 'items');
  ctx.item = (id) => readJson(path.join(ctx.itemsDir, `${id}.json`));
  ctx.items = () => (fs.existsSync(ctx.itemsDir) ? fs.readdirSync(ctx.itemsDir).filter((n) => n.endsWith('.json')).map((n) => readJson(path.join(ctx.itemsDir, n))).filter(Boolean) : []);
  ctx.save = (it) => { it.updated = iso(); writeJson(path.join(ctx.itemsDir, `${it.id}.json`), it); };
  ctx.report = (kind, it, extra = {}) => appendJsonl(path.join(cfg.state, 'report.jsonl'), { t: ctx.clock().toISOString(), kind, item: it ? it.id : null, ...extra });
  ctx.quiet = () => (fs.existsSync(cfg.marker_dir) ? fs.readdirSync(cfg.marker_dir).filter((n) => QUIET.test(n)) : []);
  ctx.inWindow = () => inWindow(ctx);
  ctx.gatesHalted = () => ctx.quiet().length > 0 || ctx.inWindow();
  return ctx;
}

// R-10: from 19:40 UTC until the night's result is read; the opening is kept in the state, so a
// result that lands after midnight still closes it. `read_for` names the night a read belongs to
// (nightOf), never the day of the read, so a read after midnight does not suppress the next night.
function inWindow(ctx) {
  const f = path.join(ctx.cfg.state, 'window.json');
  const w = readJson(f, {}) || {};
  if (w.open) return true;
  const now = ctx.clock().toISOString();
  const day = now.slice(0, 10);
  if (now.slice(11, 16) >= WINDOW_FROM && w.read_for !== day) { writeJson(f, { open: true, opened_for: day, opened: now }); return true; }
  return false;
}
// The night a result read now belongs to: the open window's; with none open, the latest night whose
// window has begun (before 19:40 that is the night before).
function nightOf(ctx, w) {
  if (w.open && w.opened_for) return w.opened_for;
  const now = ctx.clock();
  const night = now.toISOString().slice(11, 16) >= WINDOW_FROM ? now : new Date(now.getTime() - 86400000);
  const day = night.toISOString().slice(0, 10);
  return w.read_for && w.read_for > day ? w.read_for : day;
}

// ── the integrator's own clone ──────────────────────────────────────────────────────────────────
function ensureClone(ctx) {
  const { cfg } = ctx;
  const repo = path.join(cfg.state, 'integrator', 'repo');
  if (!fs.existsSync(path.join(repo, '.git'))) {
    fs.mkdirSync(path.dirname(repo), { recursive: true });
    gitOk(path.dirname(repo), 'clone', '-q', '--no-checkout', '-o', cfg.remote, cfg.remote_url, repo);
  }
  if (!git(repo, 'config', 'user.name').out) gitOk(repo, 'config', 'user.name', 'scripts/integrate.mjs');
  if (!git(repo, 'config', 'user.email').out) gitOk(repo, 'config', 'user.email', 'integrator@localhost');
  gitOk(repo, 'fetch', '-q', '--prune', cfg.remote, `+refs/heads/*:refs/remotes/${cfg.remote}/*`);
  // merge-check reads `git merge-base main HEAD`: a local main, the remote's
  for (const r of ['main', cfg.base_ref]) {
    const sha = git(repo, 'rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${r}`).out;
    if (sha) gitOk(repo, 'update-ref', `refs/heads/${r}`, sha);
  }
  // the local staging follows the remote's; created from dev when the remote has none
  const remoteStaging = git(repo, 'rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${cfg.staging}`).out;
  const dev = gitOk(repo, 'rev-parse', `refs/remotes/${cfg.remote}/${cfg.base_ref}`);
  gitOk(repo, 'update-ref', `refs/heads/${cfg.staging}`, remoteStaging || dev);
  ctx.repo = repo;
  ctx.stagingFile = path.join(cfg.state, 'staging.json');
  const st = readJson(ctx.stagingFile, null);
  ctx.staging = st && git(repo, 'merge-base', '--is-ancestor', st.base || dev, remoteStaging || dev).code === 0 ? st : { base: dev, merged: [] };
  if (!remoteStaging) ctx.staging = { base: dev, merged: [] };
  // an item dev already carries (after the train) is no longer above dev
  ctx.staging.merged = (ctx.staging.merged || []).filter((m) => m.merge && git(repo, 'merge-base', '--is-ancestor', m.merge, dev).code !== 0);
  return repo;
}
function addWorktree(repo, dir, sha) {
  removeWorktree(repo, dir);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  gitOk(repo, 'worktree', 'add', '-q', '--detach', dir, sha);
  return dir;
}
function removeWorktree(repo, dir) {
  if (fs.existsSync(dir)) git(repo, 'worktree', 'remove', '--force', dir);
  fs.rmSync(dir, { recursive: true, force: true });
  git(repo, 'worktree', 'prune');
}
// the refs the integrator may push, and how: staging alone is forced, and only under a lease read
// by ls-remote just before (the never-list's force-push-outside-staging)
function pushStaging(ctx) {
  const { cfg } = ctx;
  if (!INTEGRATOR_REFS.includes(cfg.staging)) throw new Error(`${cfg.staging} is not a ref the integrator owns`);
  const ref = `refs/heads/${cfg.staging}`;
  const ls = spawnSync('git', ['-C', ctx.repo, 'ls-remote', cfg.remote, ref], { encoding: 'utf8', env: baseEnv() });
  if (ls.status !== 0) return { argv: null, exit: ls.status, err: (ls.stderr || '').trim().slice(0, 300), at: iso() };
  const lease = (ls.stdout || '').split(/\s/)[0] || '';
  const argv = ['push', '-q', cfg.remote, `${ref}:${ref}`, `--force-with-lease=${ref}:${lease}`];
  const at = iso();
  const r = git(ctx.repo, ...argv);
  return { argv, lease, remote_before: lease, at, exit: r.code, err: r.err.slice(0, 300) };
}

// ── running a gate ──────────────────────────────────────────────────────────────────────────────
function runCmd(ctx, cmd, cwd, { minutes = 90, tag = 'cmd' } = {}) {
  const full = ctx.cfg.lock ? ['flock', ctx.cfg.lock, ...cmd] : cmd;
  const t = Date.now();
  const r = spawnSync(full[0], full.slice(1), { cwd, env: baseEnv(), encoding: 'utf8', timeout: minutes * 60000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const logDir = path.join(ctx.cfg.state, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const log = path.join(logDir, `${stampOf(new Date())}-${process.pid}-${tag}.log`);
  fs.appendFileSync(log, `$ ${cmd.join(' ')}\n${out}`);
  const summary = out.split('\n').map((l) => l.trim()).filter(Boolean).reverse().find((l) => /row\(s\)|passed|failed|GREEN|MERGE (OK|REFUSED)/.test(l)) || '';
  return { cmd, exit: r.status == null ? -1 : r.status, timed_out: !!(r.error && /ETIMEDOUT/.test(r.error.code || '')), wall_ms: Date.now() - t, summary: summary.slice(0, 300), log };
}
const failingRows = (cwd, gate) => {
  const f = path.join(cwd, 'specs', gate, '.gate-results');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('|')).filter((r) => r[1] !== 'pass').map((r) => r[0]) : [];
};
const gateCmd = (cwd, gate, final) => ['bash', `specs/${gate}/gate.sh`, ...(final ? ['--final'] : [])];
const browserGate = (cwd, gate) => { try { return /browser/.test(fs.readFileSync(path.join(cwd, 'specs', gate, 'gate.sh'), 'utf8')); } catch { return false; } };

// One gate on the merge result, re-run once on a red (environment-red: a pass on the rerun is a
// flake). A gate that would start inside a halt does not start: the merge rolls back.
function gateRun(ctx, it, cwd, gate, final) {
  if (ctx.gatesHalted()) throw new Halt(`a halt began before the gate ${gate} could start`);
  const r = runCmd(ctx, gateCmd(cwd, gate, final), cwd, { minutes: ctx.cfg.merge.gate_minutes, tag: `gate-${gate}` });
  const entry = { gate, exit: r.exit, summary: r.summary, log: r.log };
  let reruns = 0;
  while (entry.exit !== 0 && reruns < ctx.cfg.limits.reruns_per_gate) {
    if (ctx.gatesHalted()) throw new Halt(`a halt began before the rerun of ${gate}`);
    reruns += 1;
    const again = runCmd(ctx, gateCmd(cwd, gate, final), cwd, { minutes: ctx.cfg.merge.gate_minutes, tag: `rerun-${gate}` });
    entry.rerun = { exit: again.exit, summary: again.summary };
    if (again.exit === 0) { entry.exit = 0; entry.flake = true; flake(ctx, gate, it); }
  }
  if (entry.exit !== 0) entry.failing = failingRows(cwd, gate);
  return entry;
}

// environment-red and repeat-flake: the flake log, and a T2 queue item when the same gate flaked
// twice inside the window of days
function flake(ctx, gate, it) {
  const f = path.join(ctx.cfg.state, 'flakes.jsonl');
  const now = ctx.clock().toISOString();
  appendJsonl(f, { t: now, gate, item: it ? it.id : null });
  ctx.report('flake', it, { gate });
  const day = (t) => Date.parse(String(t).slice(0, 10));
  const recent = jsonl(f).filter((x) => x.gate === gate && (day(now) - day(x.t)) / DAY <= ctx.cfg.limits.flake_days);
  if (recent.length < ctx.cfg.limits.flake_count) return;
  const id = `flake-${gate}-${now.slice(0, 10).replace(/-/g, '')}`;
  if (ctx.item(id)) return;
  const brief = path.join(ctx.cfg.state, 'briefs', `${id}.md`);
  fs.mkdirSync(path.dirname(brief), { recursive: true });
  fs.writeFileSync(brief, `# Brief: ${id}\n\nThe gate \`specs/${gate}/gate.sh\` flaked ${recent.length} times in ${ctx.cfg.limits.flake_days} days (the integrator's flake log). Find why it reads red and then green on the same tree, and fix the gate. Tier T2 (Q-4, the operator's ruling of 27 Sep 2026): the fix edits another spec's gate, which an approval covers and the T3 path guard refuses.\n`);
  ctx.save({ id, tier: 'T2', changes_verdict: false, ships_publicly: false, brief, state: 'queued', origin: 'repeat-flake', gate, queued_at: now });
  ctx.report('flake-item', { id }, { gate, flakes: recent.length, tier: 'T2' });
}

// the paths an item changes, against where it meets staging: the dev it was cut from, or for a
// rebased item the staging it was rebased onto
function changedPaths(ctx, tip) {
  const mb = gitOk(ctx.repo, 'merge-base', `refs/heads/${ctx.cfg.staging}`, tip);
  return { mb, paths: gitOk(ctx.repo, 'diff', '--name-only', mb, tip).split('\n').filter(Boolean) };
}
// R-4: the gates whose gate.sh or probes name a path the item changes, on the merge result
function gatesReading(cwd, paths) {
  if (!paths.length) return [];
  // every file under a probes directory: git reads a bare `specs/*/probes/` as a pattern no file matches
  const args = ['grep', '-l', '-F', ...paths.flatMap((p) => ['-e', p]), '--', 'specs/*/gate.sh', ':(glob)specs/*/probes/**'];
  const r = git(cwd, ...args);
  return [...new Set(r.out.split('\n').filter(Boolean).map((f) => f.split('/')[1]))].filter((g) => g !== '_shared' && fs.existsSync(path.join(cwd, 'specs', g, 'gate.sh'))).sort();
}

// ── parking, and the class each outcome is ─────────────────────────────────────────────────────
function classAction(ctx, cls) {
  if (ctx.constitution && ctx.constitution[cls]) return { class: cls, action: ctx.constitution[cls], from: 'CONSTITUTION § Decision policy' };
  if (ctx.policy && ctx.policy.classes[cls]) return { class: cls, action: ctx.policy.classes[cls], from: POLICY_REL };
  return { class: cls, action: null, from: null };
}
function park(ctx, it, rec, cls, reason, extra = {}) {
  // a real red parks this item alone; the queue carries on (the brief's item 4)
  it.state = 'parked'; it.class = cls; it.reason = reason; it.parked_at = ctx.clock().toISOString();
  it.policy = classAction(ctx, cls);
  ctx.save(it);
  if (rec) { rec.status = 'parked'; rec.class = cls; rec.reason = reason; Object.assign(rec, extra); }
  ctx.report('parked', it, { class: cls, reason, ...extra });
  return 'parked';
}

// ── the merge of one item onto staging ─────────────────────────────────────────────────────────
function fetchItem(ctx, it) {
  if (it.local_ref) return gitOk(ctx.repo, 'rev-parse', it.local_ref);
  const from = it.from || ctx.cfg.remote;
  gitOk(ctx.repo, 'fetch', '-q', from, `+refs/heads/${it.branch}:refs/items/${it.id}`);
  return gitOk(ctx.repo, 'rev-parse', `refs/items/${it.id}`);
}
// R-3: the stamp of the newest approval record on the item's tip; a T3 item's checks time
function orderKey(ctx, it) {
  if (it.tier === 'T3') return String(it.checks_green_at || it.queued_at || '').replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  try {
    const tip = fetchItem(ctx, it);
    const names = git(ctx.repo, 'ls-tree', '--name-only', tip, `specs/${it.id}/evidence/`).out.split('\n').map((f) => path.basename(f)).filter((f) => /^approval-\d{8}T\d{6}Z\.md$/.test(f)).sort();
    return names.length ? names[names.length - 1].slice(9, 25) : null;
  } catch { return null; }
}
const byApproval = (a, b) => String(a.order_key || '~').localeCompare(String(b.order_key || '~')) || String(a.queued_at || '').localeCompare(String(b.queued_at || ''));

function mergeCheckStep(ctx, it, tip) {
  const { repo } = ctx;
  const checkAt = tip;
  if (it.tier === 'T3') {
    // Q-4 (a): the driver's own T3 path guard, with its hygiene scan as dev carries it (spec 051
    // A-051-1), over every path the item changes from where it meets staging
    const dev = `refs/remotes/${ctx.cfg.remote}/${ctx.cfg.base_ref}`;
    const { mb } = changedPaths(ctx, checkAt);
    const r = t3PathGuard(repo, it.id, mb, checkAt, dev);
    return { step: 'merge-check', how: 'T3 path guard and hygiene scan (scripts/drive.mjs)', at: checkAt, exit: r.exit, summary: r.summary };
  }
  const wt = addWorktree(repo, path.join(ctx.cfg.state, 'work', `${it.id}-check`), checkAt);
  try {
    const r = runCmd(ctx, ['node', 'scripts/merge-check.js', `specs/${it.id}`], wt, { minutes: 5, tag: `merge-check-${it.id}` });
    return { step: 'merge-check', how: 'merge-check.js', at: checkAt, exit: r.exit, summary: r.summary };
  } finally { removeWorktree(repo, wt); }
}

// R-11: a conflict is mechanical when every hunk, read in diff3 style, has an empty base side
function mechanicalConflict(work, files) {
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(work, f), 'utf8'); } catch { return false; }
    const blocks = [...text.matchAll(/^<<<<<<< [^\n]*\n[\s\S]*?^\|\|\|\|\|\|\| [^\n]*\n([\s\S]*?)^=======\n/gm)];
    if (!blocks.length || blocks.some((b) => b[1].trim() !== '')) return false;
  }
  return true;
}
// A mechanical conflict: the item's commits rebased onto staging in the integrator's own clone, each
// conflicted file kept with both sides' lines; the rebase stays local (no force push outside staging)
function rebaseLocal(ctx, it, tip, stagingSha) {
  const { repo } = ctx;
  const { mb } = changedPaths(ctx, tip);
  const wt = addWorktree(repo, path.join(ctx.cfg.state, 'work', `${it.id}-rebase`), tip);
  const env = { ...baseEnv(), GIT_EDITOR: 'true' };
  try {
    let r = spawnSync('git', ['-C', wt, 'rebase', '--onto', stagingSha, mb], { encoding: 'utf8', env });
    for (let i = 0; r.status !== 0 && i < 50; i++) {
      const files = git(wt, 'diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean);
      if (!files.length) throw new Error(`the rebase stopped with no conflicted file: ${(r.stderr || '').slice(0, 200)}`);
      for (const f of files) {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'integrate-union-'));
        const stage = (n) => { const p = path.join(scratch, String(n)); fs.writeFileSync(p, git(wt, 'show', `:${n}:${f}`).code === 0 ? spawnSync('git', ['-C', wt, 'show', `:${n}:${f}`], { encoding: 'buffer' }).stdout : ''); return p; };
        const u = spawnSync('git', ['merge-file', '--union', '-p', stage(2), stage(1), stage(3)], { encoding: 'buffer' });
        fs.writeFileSync(path.join(wt, f), u.stdout);
        fs.rmSync(scratch, { recursive: true, force: true });
        gitOk(wt, 'add', '--', f);
      }
      r = spawnSync('git', ['-C', wt, 'rebase', '--continue'], { encoding: 'utf8', env });
    }
    if (r.status !== 0) throw new Error(`the rebase did not finish: ${(r.stderr || '').slice(0, 200)}`);
    const rebased = gitOk(wt, 'rev-parse', 'HEAD');
    gitOk(repo, 'update-ref', `refs/heads/rebased/${it.id}`, rebased);
    return rebased;
  } finally { git(wt, 'rebase', '--abort'); removeWorktree(repo, wt); }
}
function conflict(ctx, it, rec, work, files, stagingSha, tip) {
  const mechanical = mechanicalConflict(work, files);
  git(work, 'merge', '--abort');
  rec.conflict = { files, mechanical };
  if (!mechanical) {
    it.state = 'sent-back'; it.class = 'conflict-logic'; it.reason = `the merge onto staging conflicts in ${files.join(', ')}, and the hunks overlap in logic: back to its builder`;
    it.policy = classAction(ctx, 'conflict-logic');
    ctx.save(it); rec.status = 'conflict';
    ctx.report('sent-back', it, { class: 'conflict-logic', files });
    return 'sent-back';
  }
  let rebased;
  try { rebased = rebaseLocal(ctx, it, tip, stagingSha); } catch (e) { return park(ctx, it, rec, 'conflict-mechanical', `the mechanical rebase failed: ${e.message}`); }
  it.old_tip = tip; it.local_ref = `refs/heads/rebased/${it.id}`; it.rebased = rebased;
  it.state = 'awaiting-approval';
  it.class = 'conflict-mechanical';
  it.reason = `rebased onto staging ${stagingSha.slice(0, 8)} with both sides kept (${files.join(', ')}); its approval covers nothing now, and it merges only when an approval names the rebased subject`;
  it.policy = classAction(ctx, 'conflict-mechanical');
  ctx.save(it); rec.status = 'conflict'; rec.rebased = rebased;
  ctx.report('awaiting-approval', it, { class: 'conflict-mechanical', files, rebased });
  return 'awaiting-approval';
}

// AC-5 and R-9: a separate fresh-context session, launched here from outside every repository with
// auto memory off, answers one class for the amendment; it agrees when the class is the one the
// amendment claims
async function agreementSession(ctx, it, tip, amended, diff) {
  const { cfg } = ctx;
  const kind = amended.some((a) => a.kind === 'gate-amendment') ? 'gate-amendment' : 're-baseline';
  const want = kind === 'gate-amendment' ? 'false-red' : 're-baseline';
  const dir = cfg.agree_cwd;
  fs.mkdirSync(dir, { recursive: true });
  const ceiling = path.dirname(dir);
  const inRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, env: { ...baseEnv(), GIT_CEILING_DIRECTORIES: ceiling }, encoding: 'utf8' }).status === 0;
  if (inRepo) return { agrees: false, why: `${dir} is inside a git repository` };
  const scratch = fs.mkdtempSync(path.join(cfg.state, 'agree-'));
  const recordFile = path.join(scratch, 'amendment-record.md');
  fs.writeFileSync(recordFile, [
    `# Amendment record: item ${it.id} at ${tip}`, '',
    `findings:          A-1 ${amended.map((a) => a.path).join(', ')} changed by the item (${kind})`,
    'blocking_findings: 1', `kind:              ${kind}`, `tip:               ${tip}`, '', '```diff', diff, '```', '',
  ].join('\n'));
  const policyFile = path.join(scratch, 'decision-policy.md');
  const constitution = readPolicy(ctx.repo, `refs/remotes/${cfg.remote}/${cfg.base_ref}`).section;
  fs.writeFileSync(policyFile, `## Decision policy\n\n${constitution}\n\n## The integrator's classes\n\n${fs.readFileSync(cfg.policy, 'utf8')}\n`);
  const answer = path.join(scratch, 'answer.json');
  const prompt = [
    'DRIVER-STAGE: triage', 'INTEGRATOR-CHECK: agreement', `SPEC: ${it.id}`,
    `APPROVAL-RECORD: ${recordFile}`, `POLICY: ${policyFile}`, `WRITE: ${answer}`, '',
    'You are the separate fresh-context reader of the integrator\'s decision policy, neither the builder nor the integrator. Read the amendment record and its diff, and the policy file, and nothing about how the change was built.',
    `Answer one class for finding A-1: false-red when the amended gate read red on a subject that meets its criterion and the amendment still catches what the gate guards; re-baseline when a pinned literal moved legitimately and the diff shows it; defect otherwise.`,
    'Write only this JSON to the WRITE path: {"findings":[{"id":"A-1","blocking":true,"class":"<class>","reason":"<one sentence>"}]}. Edit nothing else.',
  ].join('\n');
  const model = modelFor(STAGE_MODELS.approve);
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-turns', '20', '--max-budget-usd', '1',
    '--settings', JSON.stringify({ autoMemoryEnabled: false }), ...(model ? ['--model', model] : []), '--add-dir', scratch, '--allowedTools', 'Read,Grep,Glob,Write'];
  const env = {};
  for (const [k, v] of Object.entries(baseEnv())) if (!/^CLAUDE/.test(k) && !/^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(k) && k !== 'SSH_AUTH_SOCK') env[k] = v;
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  env.GIT_CEILING_DIRECTORIES = ceiling;
  const r = spawnSync(process.env.DRIVE_CLAUDE_BIN || 'claude', args, { cwd: dir, env, encoding: 'utf8', timeout: cfg.limits.session_minutes * 60000, maxBuffer: 64 * 1024 * 1024 });
  const seen = { model: null, session_id: null, cwd: null, memory: 0, gitstatus: 0 };
  for (const line of (r.stdout || '').split('\n')) {
    seen.memory += (line.match(/\.claude\/projects\/[^"\s]*\/memory|MEMORY\.md/g) || []).length;
    seen.gitstatus += (line.match(/gitStatus/g) || []).length;
    try { const j = JSON.parse(line); if (j.type === 'system' && j.subtype === 'init') Object.assign(seen, { model: j.model || null, session_id: j.session_id || null, cwd: j.cwd || null }); } catch {}
  }
  const ans = readJson(answer, null);
  const findings = ans && Array.isArray(ans.findings) ? ans.findings : [];
  const fresh = seen.memory === 0 && seen.gitstatus === 0;
  const agrees = r.status === 0 && fresh && findings.length > 0 && findings.every((f) => f.class === want);
  const record = {
    item: it.id, tip, kind, amendment: amended.map((a) => a.path), diff_sha256: sha256(diff), wanted_class: want,
    session: { cwd: seen.cwd || dir, session_id: seen.session_id, model: seen.model, exit: r.status, auto_memory_env: env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, launched_by: 'scripts/integrate.mjs', git_ceiling: ceiling },
    memory_line_injected: seen.memory > 0, git_status_injected: seen.gitstatus > 0,
    answer: findings, agrees, verification_level: seen.model === 'test-double' ? 'UNVERIFIED' : undefined, at: iso(),
  };
  const file = path.join(cfg.state, 'agreements', `${it.id}-${tip.slice(0, 8)}.json`);
  writeJson(file, record);
  fs.rmSync(scratch, { recursive: true, force: true });
  return { agrees, file, record };
}

// the gates and probes of other specs an item changes: a gate amendment, or a re-baseline
function amendmentsOf(it, paths) {
  const out = [];
  for (const p of paths) {
    // a frozen figure lives in a fixture, in a spec's text (its amendments log) or in its evidence
    const m = /^specs\/([^/]+)\/(gate\.sh$|probes\/|fixtures\/|spec\.md$|evidence\/)/.exec(p);
    if (!m || m[1] === it.id || m[1].startsWith('_') || m[1] === '000-governance') continue;
    out.push({ path: p, spec: m[1], kind: m[2] === 'gate.sh' || m[2] === 'probes/' ? 'gate-amendment' : 're-baseline' });
  }
  return out;
}

async function mergeItem(ctx, it, { push = true } = {}) {
  const { cfg, repo } = ctx;
  const n = fs.existsSync(path.join(cfg.state, 'merges')) ? fs.readdirSync(path.join(cfg.state, 'merges')).filter((f) => f.startsWith(`${it.id}-`)).length + 1 : 1;
  const recFile = path.join(cfg.state, 'merges', `${it.id}-${String(n).padStart(2, '0')}.json`);
  const tip = fetchItem(ctx, it);
  const stagingSha = gitOk(repo, 'rev-parse', `refs/heads/${cfg.staging}`);
  const rec = { item: it.id, n, started: iso(), tip, staging_before: stagingSha, status: 'started', steps: [] };
  const save = () => writeJson(recFile, rec);
  const work = path.join(cfg.state, 'work', it.id);
  save();
  try {
    const { mb, paths } = changedPaths(ctx, tip);
    // the never-list: an item never edits the governance files
    const gov = paths.filter((p) => ctx.policy.governance.includes(p));
    if (gov.length) return park(ctx, it, rec, 'edit-governance', `the diff edits ${gov.join(', ')}, which the never-list leaves to the operator's go`);
    const mc = (() => { try { return createRequire(import.meta.url)(path.join(HERE, 'merge-check.js')); } catch { return null; } })();
    const subject = mc ? mc.resolveSubject(tip, repo).subject : tip;
    const title = ((/^# (.+)$/m.exec(git(repo, 'show', `${tip}:specs/${it.id}/spec.md`).out) || [])[1] || `spec ${it.id}`).replace(/^spec \S+ - /, '');
    let mergeSha = null;
    const gates = [];
    const STEP = {
      'merge-check': () => {
        const s = mergeCheckStep(ctx, it, tip);
        rec.steps.push(s);
        if (s.exit !== 0 && it.tier === 'T3') return park(ctx, it, rec, 'operator-ruling', `${it.id} is T3 and ${s.summary}. A T3 item changes internal paths only; retier it or answer with a ruling`);
        if (s.exit !== 0) return park(ctx, it, rec, 'merge-check-refused', `merge-check refused ${it.id} at ${tip.slice(0, 8)}: ${s.summary}`);
        return null;
      },
      merge: async () => {
        addWorktree(repo, work, stagingSha);
        copyPaths(cfg.source || repo, work, ['node_modules']);
        const m = git(work, '-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-edit', '-m', `merge(spec ${it.id}): ${title} onto ${cfg.staging} - approved at ${subject.slice(0, 8)} (scripts/integrate.mjs)`, tip);
        if (m.code !== 0) {
          const files = git(work, 'diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean);
          rec.steps.push({ step: 'merge', exit: m.code, conflicted: files });
          if (!files.length) return park(ctx, it, rec, 'merge-failed', `git merge failed: ${m.err.slice(0, 200)}`);
          return conflict(ctx, it, rec, work, files, stagingSha, tip);
        }
        mergeSha = gitOk(work, 'rev-parse', 'HEAD');
        rec.steps.push({ step: 'merge', exit: 0, merge_commit: mergeSha });
        // AC-5: an amendment of another spec's gate carries its mutation and the separate agreement
        const amended = amendmentsOf(it, paths);
        if (amended.length) {
          const step = { step: 'amendment', amended: amended.map((a) => `${a.spec}: ${a.path} (${a.kind})`) };
          rec.steps.push(step);
          for (const spec of [...new Set(amended.filter((a) => a.kind === 'gate-amendment').map((a) => a.spec))]) {
            const added = git(repo, 'diff', '-U0', mb, tip, '--', `specs/${spec}/gate.sh`, `specs/${spec}/probes/`).out.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
            const run = gateRun(ctx, it, work, spec, false);
            const rows = fs.existsSync(path.join(work, 'specs', spec, '.gate-results')) ? fs.readFileSync(path.join(work, 'specs', spec, '.gate-results'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('|')) : [];
            const mutation = rows.filter((r) => /^MUTATION/.test(r[2] || ''));
            step[spec] = { added_mutation_lines: added.filter((l) => /MUTATION/.test(l)).length, mutation_rows: mutation.length, mutation_green: mutation.every((r) => r[1] === 'pass'), exit: run.exit };
            if (!step[spec].added_mutation_lines || !mutation.length || !step[spec].mutation_green) return park(ctx, it, rec, 'gate-amendment', `the amendment of specs/${spec}/gate.sh carries no MUTATION row that reads its plant RED on the merge result (${step[spec].added_mutation_lines} MUTATION line(s) added, ${mutation.length} MUTATION row(s) read, green: ${step[spec].mutation_green})`);
          }
          // AC-8: every halt is read again here, because the amended gate above may have run into one
          if (fs.existsSync(cfg.stop_file) || ctx.gatesHalted()) throw new Halt('a halt began before the separate agreement session could start');
          const diff = git(repo, 'diff', mb, tip, '--', ...amended.map((a) => a.path)).out;
          const agreement = await agreementSession(ctx, it, tip, amended, diff);
          step.agreement = { agrees: agreement.agrees, record: agreement.file || null, why: agreement.why || null };
          if (!agreement.agrees) return park(ctx, it, rec, amended[0].kind, `the separate fresh-context session did not agree to the ${amended[0].kind} of ${amended.map((a) => a.path).join(', ')}${agreement.why ? `: ${agreement.why}` : ''}`);
        }
        return null;
      },
      gate: () => {
        const g = gateRun(ctx, it, work, it.id, true);
        gates.push(g); rec.steps.push({ step: 'gate', ...g });
        if (g.exit !== 0) return park(ctx, it, rec, 'defect', `its own gate reads red on the merge result, and again on its rerun: ${g.summary}`, { gate: it.id, rows: g.failing });
        return null;
      },
      // Q-3 (a): the gate's figure on the merge result against the figure the approval read, from the
      // receipt of the approval merge-check accepted; any difference parks the item for re-approval
      figures: () => {
        const figure = gateFigureAt(work, it.id);
        if (it.tier === 'T3') { rec.steps.push({ step: 'figures', merge_result: figure, approval_read: null, compared: false, why: 'a T3 item has no approval' }); return null; }
        const at = (rec.steps.find((x) => x.step === 'merge-check') || {}).at || tip;
        const approvedAt = mc ? mc.resolveSubject(at, repo).subject : at;
        const evidence = `specs/${it.id}/evidence`;
        const records = mc ? mc.approvalsIn(`specs/${it.id}`, at, repo).filter((a) => a.commit === approvedAt).map((a) => a.file).sort() : [];
        const file = records[records.length - 1] || null;
        const names = git(repo, 'ls-tree', '--name-only', at, `${evidence}/`).out.split('\n').filter(Boolean).map((f) => path.basename(f));
        const read = (n) => { const r = git(repo, 'show', `${at}:${evidence}/${n}`); try { return r.code === 0 ? JSON.parse(r.out) : null; } catch { return null; } };
        const approved = file ? approvalFigure(receiptNamed(git(repo, 'show', `${at}:${evidence}/${file}`).out), names, read, approvedAt) : null;
        const equal = !!(approved && figure && approved.passed === figure.passed && approved.failed === figure.failed);
        rec.steps.push({ step: 'figures', merge_result: figure, approval_read: approved, approval: file, exit: equal ? 0 : 1 });
        const show = (f) => (f ? `${f.passed} passed, ${f.failed} failed` : 'no figure');
        if (!equal) return park(ctx, it, rec, 'unread-figures', `its gate reads ${show(figure)} on the merge result, and the approval of ${approvedAt.slice(0, 8)} read ${show(approved)}${approved && approved.receipt ? ` (${approved.receipt})` : ''}: nothing merges on a figure the approval did not read, and it is approved again at its current subject`, { gate: it.id });
        return null;
      },
      core: () => {
        const core = cfg.merge.core || (fs.existsSync(path.join(work, 'specs', '000-governance', 'core-gates.txt')) ? { cmd: ['node', 'specs/029-scanner-loop/probes/sweep.mjs', '--core', '{id}'], minutes: 180 } : null);
        if (!core) { rec.steps.push({ step: 'core', exit: null, summary: 'the tree carries no core set' }); return null; }
        if (ctx.gatesHalted()) throw new Halt('a halt began before the core set could start');
        const r = runCmd(ctx, core.cmd.map((a) => a.replace('{id}', it.id)), work, { minutes: core.minutes || 180, tag: `core-${it.id}` });
        rec.steps.push({ step: 'core', exit: r.exit, summary: r.summary });
        if (r.exit !== 0) return park(ctx, it, rec, 'defect', `the core set reads red on the merge result: ${r.summary}`, { gate: 'core set' });
        return null;
      },
      touches: () => {
        const touching = gatesReading(work, [...paths, ...(paths.some((p) => p.startsWith('receipts/')) ? ['receipts/'] : [])]);
        const above = (ctx.staging.merged || []).map((m) => m.id).filter((g) => fs.existsSync(path.join(work, 'specs', g, 'gate.sh')));
        const others = [...new Set([...touching, ...above])].filter((g) => g !== it.id);
        const runs = [];
        for (const g of others) {
          const r = gateRun(ctx, it, work, g, browserGate(work, g));
          runs.push(r);
          if (r.exit !== 0) {
            rec.steps.push({ step: 'touches', gates: runs, exit: r.exit });
            return park(ctx, it, rec, 'defect', `the gate of ${g} reads red on the merge result, and again on its rerun (rows ${(r.failing || []).join(', ') || 'unread'}): ${r.summary}`, { gate: g, rows: r.failing });
          }
        }
        rec.steps.push({ step: 'touches', gates: runs, reading: { touching, above }, exit: 0 });
        return null;
      },
      decisions: () => {
        const date = ctx.clock().toISOString().slice(0, 10);
        const approval = it.tier === 'T3' ? `${it.tier}, no approval session by CONSTITUTION § Proportional oversight` : `approved at \`${subject.slice(0, 8)}\` by the record on its branch`;
        fs.appendFileSync(path.join(work, 'DECISIONS.md'), [
          '', `## ${date} - spec ${it.id} merges onto ${cfg.staging}: ${title}`, '',
          `**Chose:** spec ${it.id} merges onto \`${cfg.staging}\` (\`${mergeSha.slice(0, 8)}\`, branch tip \`${tip.slice(0, 8)}\`), ${approval}. Run by \`scripts/integrate.mjs\`.`,
          `The item's gate \`--final\` on the merge result: ${(gates[0] || {}).summary || 'no summary line'}.`, '',
          `**Staging is not the record.** \`${cfg.base_ref}\`, after the train's fast-forward, is (spec 066 R-5); a reset of \`${cfg.staging}\` removes this entry with the merge.`, '',
          '**What this entry does not authorize.** No push to `origin`, no tag, no npm.', '',
        ].join('\n'));
        gitOk(work, 'add', 'DECISIONS.md');
        gitOk(work, 'commit', '-q', '--no-verify', '-m', `decisions(${it.id}): the merge entry onto ${cfg.staging} (scripts/integrate.mjs)`);
        rec.steps.push({ step: 'decisions', commit: gitOk(work, 'rev-parse', 'HEAD') });
        return null;
      },
      'repo-gate': () => {
        if (ctx.gatesHalted()) throw new Halt('a halt began before the repository gate could start');
        const r = runCmd(ctx, cfg.merge.repo_gate.cmd, work, { minutes: cfg.merge.repo_gate.minutes || 60, tag: `repo-gate-${it.id}` });
        const figure = repoGateFigure(work, cfg.merge.repo_gate, r);
        const green = r.exit === 0 && !!figure && figure.failed === 0;
        rec.steps.push({ step: 'repo-gate', exit: r.exit, figure, green, summary: r.summary });
        if (!green) return park(ctx, it, rec, 'defect', `the repository gate reads ${figure ? `${figure.passed} passed, ${figure.failed} failed` : `exit ${r.exit}`} on the merge result`, { gate: 'repository gate' });
        return null;
      },
    };
    const SEQUENCE = ['merge-check', 'merge', 'gate', 'figures', 'core', 'touches', 'decisions', 'repo-gate'];
    for (const s of SEQUENCE) {
      const out = await STEP[s]();
      if (out) { save(); return out; }
    }
    const newTip = gitOk(work, 'rev-parse', 'HEAD');
    // AC-8: the pause file is read again before staging moves, so a pause planted mid-merge holds it
    if (fs.existsSync(cfg.pause_file)) throw new Halt('the pause file appeared before staging could move');
    gitOk(repo, 'update-ref', `refs/heads/${cfg.staging}`, newTip, stagingSha);
    if (push) {
      const p = pushStaging(ctx);
      rec.push = p;
      rec.steps.push({ step: 'push', exit: p.exit });
      if (p.exit !== 0) {
        gitOk(repo, 'update-ref', `refs/heads/${cfg.staging}`, stagingSha, newTip);
        rec.status = 'push-failed'; save();
        ctx.report('push-failed', it, { err: p.err });
        return 'push-failed';
      }
    }
    rec.status = 'merged'; rec.merge_commit = mergeSha; rec.staging_after = newTip; rec.ended = iso(); save();
    ctx.staging.merged = [...(ctx.staging.merged || []).filter((m) => m.id !== it.id), { id: it.id, merge: mergeSha, tip: newTip, item_tip: tip }];
    writeJson(ctx.stagingFile, ctx.staging);
    Object.assign(it, { state: 'merged', merge_commit: mergeSha, staging_after: newTip, merged_at: ctx.clock().toISOString() });
    delete it.class; delete it.reason;
    ctx.save(it);
    ctx.report('merged', it, { merge_commit: mergeSha, staging: newTip });
    return 'merged';
  } catch (e) {
    if (!(e instanceof Halt)) throw e;
    // R-10: the merge is rolled back and the item waits in the queue
    rec.status = 'rolled-back'; rec.reason = e.message; save();
    ctx.report('rolled-back', it, { reason: e.message });
    return 'rolled-back';
  } finally { removeWorktree(repo, work); }
}

// ── builders ────────────────────────────────────────────────────────────────────────────────────
function startBuilder(ctx, it) {
  const { cfg } = ctx;
  const dir = path.join(cfg.state, 'clones', it.id);
  const repo = path.join(dir, 'repo');
  if (!fs.existsSync(path.join(repo, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    gitOk(dir, 'clone', '-q', '-o', cfg.remote, cfg.remote_url, repo);
  }
  for (const r of [cfg.base_ref, 'main']) {
    const sha = git(repo, 'rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${r}`).out;
    if (sha && !git(repo, 'rev-parse', '--verify', '-q', `refs/heads/${r}`).out) gitOk(repo, 'update-ref', `refs/heads/${r}`, sha);
  }
  const stages = {};
  for (const k of Object.keys(STAGE_MODELS)) {
    const given = cfg.builder_stages[k] || {};
    const model = modelFor(STAGE_MODELS[k]);
    stages[k] = { ...given, minutes: Math.min(Number(given.minutes ?? STAGE_DEFAULTS[k].minutes), cfg.limits.session_minutes), ...(model ? { model } : {}) };
  }
  const q = {
    queue: `build-${it.id}`, repo, base_ref: cfg.base_ref, remote: cfg.remote, budget_usd: Number(it.budget_usd ?? 20),
    approve_cwd: cfg.approve_cwd, copy_from: cfg.source || undefined, integrator_refs: INTEGRATOR_REFS, push_branch: false,
    specs: [{
      id: it.id, brief: it.brief, tier: it.tier, changes_verdict: it.changes_verdict, ships_publicly: it.ships_publicly,
      worktree: path.join(dir, 'wt'), until: 'approved', budget_usd: Number(it.budget_usd ?? 20),
      max_loops: cfg.limits.fix_loops, stages,
    }],
  };
  const qfile = path.join(dir, 'queue.json');
  writeJson(qfile, q);
  const log = fs.openSync(path.join(dir, 'drive.log'), 'a');
  const child = spawn(process.execPath, [DRIVE, 'run', qfile, '--state', path.join(dir, 'drive-state')], { cwd: dir, env: baseEnv(), detached: true, stdio: ['ignore', log, log] });
  child.unref();
  fs.closeSync(log);
  Object.assign(it, { state: 'building', pid: child.pid, clone_dir: dir, clone: repo, worktree: path.join(dir, 'wt'), queue_file: qfile, started_at: ctx.clock().toISOString() });
  delete it.interrupted;
  ctx.save(it);
  ctx.report('builder-started', it, { pid: child.pid });
  return child.pid;
}
const progressOf = (it) => readJson(path.join(it.worktree || '', 'specs', it.id, 'evidence', 'driver', 'progress.json'), null);

function collect(ctx) {
  const out = [];
  for (const it of ctx.items().filter((i) => i.state === 'building')) {
    if (it.pid && alive(it.pid)) continue;
    const p = progressOf(it);
    if (p && p.state === 'ready') {
      const checks = (p.stages || []).filter((s) => s.stage === 'checks' && s.status === 'done').pop();
      Object.assign(it, { state: 'approved', from: it.clone, branch: p.branch || `spec/${it.id}`, checks_green_at: checks ? checks.ended : null, approved_at: ctx.clock().toISOString() });
      delete it.pid;
      ctx.save(it);
      ctx.report('approved', it, {});
    } else if (p && p.state === 'stopped' && p.stop) {
      delete it.pid;
      park(ctx, it, null, p.stop.class, `the builder stopped at ${p.stop.stage} (${p.stop.class}): ${String(p.stop.detail || '').slice(0, 400)}`, { question: p.stop.question_file });
    } else {
      delete it.pid;
      park(ctx, it, null, 'builder-ended', `the builder's driver ended in state ${p ? p.state : 'unknown'}`);
    }
    out.push(it.id);
  }
  return out;
}

// Under a quiet marker or inside the window, running builders stop; the driver resumes them at the
// interrupted stage when the next builder starts (spec 048's crash-safe resume).
async function stopBuilders(ctx, why) {
  const stopped = [];
  for (const it of ctx.items().filter((i) => i.state === 'building' && i.pid)) {
    const p = progressOf(it);
    const last = p && p.stages && p.stages[p.stages.length - 1];
    const groups = [it.pid, ...(last && last.status === 'started' && last.pgid ? [last.pgid] : [])];
    for (const g of groups) { try { process.kill(-g, 'SIGTERM'); } catch {} }
    for (let i = 0; i < 50 && groups.some(alive); i++) await sleep(100);
    for (const g of groups) if (alive(g)) { try { process.kill(-g, 'SIGKILL'); } catch {} }
    it.state = 'queued'; it.interrupted = ctx.clock().toISOString(); it.interrupted_by = why;
    delete it.pid;
    ctx.save(it);
    ctx.report('builder-stopped', it, { why });
    stopped.push(it.id);
  }
  return stopped;
}

// ── the commands ────────────────────────────────────────────────────────────────────────────────
async function tick(cfg, opts) {
  const ctx = context(cfg, opts);
  const rec = ctx.record;
  const recFile = path.join(cfg.state, 'ticks', `${stampOf(new Date())}-${process.pid}.json`);
  const policy = readIntegratorPolicy(cfg);
  if (!policy.ok) {
    rec.refused = { kind: policy.kind, detail: policy.detail };
    writeJson(recFile, rec);
    ctx.report('refused', null, rec.refused);
    process.stderr.write(`integrate: refused (${policy.kind}): ${policy.detail}\n`);
    return 5;
  }
  ctx.policy = policy;
  const quiet = ctx.quiet();
  // spec 067 R-6a: while the train moves dev or main, nothing merges and no builder starts
  const hold = fs.existsSync(holdFile(cfg));
  const halts = { stop: fs.existsSync(cfg.stop_file), pause: fs.existsSync(cfg.pause_file), quiet, window: ctx.inWindow(), ...(hold ? { train_hold: true } : {}) };
  rec.halts = halts;
  const noGates = quiet.length > 0 || halts.window;
  const noSessions = halts.stop || noGates || hold;
  if (noGates) rec.stopped_builders = await stopBuilders(ctx, quiet.length ? `quiet marker ${quiet.join(', ')}` : 'the nightly window');
  rec.collected = collect(ctx);
  if (!halts.pause && !noGates && !hold) {
    ensureClone(ctx);
    ctx.constitution = readPolicy(ctx.repo, `refs/remotes/${cfg.remote}/${cfg.base_ref}`).classes;
    const approved = ctx.items().filter((i) => i.state === 'approved');
    for (const it of approved) it.order_key = orderKey(ctx, it);
    approved.sort(byApproval);
    if (approved.length) {
      const it = approved[0];
      delete it.order_key;
      rec.merge = { item: it.id, outcome: await mergeItem(ctx, it) };
    }
  }
  rec.started_builders = [];
  if (!noSessions) {
    // at most two build sessions on the box (CONSTITUTION § Proportional oversight, item 7)
    const limit = Math.min(2, Math.max(1, Number(cfg.builders ?? 2)));
    const running = () => ctx.items().filter((i) => i.state === 'building' && i.pid && alive(i.pid)).length;
    const queued = ctx.items().filter((i) => i.state === 'queued').sort((a, b) => String(a.queued_at || '').localeCompare(String(b.queued_at || '')));
    for (const it of queued) {
      if (running() >= limit) break;
      startBuilder(ctx, it);
      rec.started_builders.push(it.id);
    }
  }
  rec.ended = iso();
  writeJson(recFile, rec);
  process.stdout.write(`integrate: tick at ${rec.now}: halts ${JSON.stringify(halts)}; collected ${rec.collected.length}; ${rec.merge ? `merge ${rec.merge.item} ${rec.merge.outcome}` : 'no merge'}; started ${rec.started_builders.join(', ') || 'none'}\n`);
  if (opts.wait) {
    // waits on the pids the state recorded when each builder started, never on a pattern
    for (;;) {
      const live = ctx.items().filter((i) => i.state === 'building' && i.pid && alive(i.pid));
      if (!live.length) break;
      await sleep(500);
    }
  }
  return 0;
}

async function nightly(cfg, opts) {
  const ctx = context(cfg, opts);
  const policy = readIntegratorPolicy(cfg);
  if (!policy.ok) { process.stderr.write(`integrate: refused (${policy.kind}): ${policy.detail}\n`); return 5; }
  ctx.policy = policy;
  if (ctx.quiet().length) { process.stderr.write(`integrate: a quiet marker holds (${ctx.quiet().join(', ')}); read the night's result after it lifts\n`); return 6; }
  const result = readJson(opts.result, null);
  if (!result) { process.stderr.write(`integrate: ${opts.result} is not a sweep record\n`); return 2; }
  // the night's result is read: the window closes
  const windowFile = path.join(cfg.state, 'window.json');
  writeJson(windowFile, { open: false, read_for: nightOf(ctx, readJson(windowFile, {}) || {}), read: ctx.clock().toISOString(), result: opts.result });
  const rec = { result: opts.result, at: ctx.clock().toISOString(), verdict: 'green', red: [] };
  const recFile = path.join(cfg.state, 'nightly', `${stampOf(new Date())}-${process.pid}.json`);
  const done = (code) => { writeJson(recFile, rec); process.stdout.write(`integrate: nightly ${rec.verdict}${rec.culprit ? `, culprit ${rec.culprit}` : ''}\n`); return code; };
  const red = (result.runs || []).filter((r) => (r.figure && r.figure.fail > 0) || (r.failing_assertion_ids || []).length > 0);
  rec.red = red.map((r) => r.spec);
  if (!red.length) return done(0);
  ensureClone(ctx);
  ctx.constitution = readPolicy(ctx.repo, `refs/remotes/${cfg.remote}/${cfg.base_ref}`).classes;
  const { repo } = ctx;
  const gate = red[0].spec;
  const candidate = (result.emission && result.emission.commit) || gitOk(repo, 'rev-parse', `refs/heads/${cfg.staging}`);
  const base = gitOk(repo, 'merge-base', candidate, `refs/remotes/${cfg.remote}/${cfg.base_ref}`);
  const merges = gitOk(repo, 'rev-list', '--first-parent', '--merges', '--reverse', '--format=%H %P|%s', `${base}..${candidate}`).split('\n').filter((l) => l && !l.startsWith('commit '))
    .map((l) => { const [head, subject] = l.split('|'); const [sha, parent] = head.split(' '); return { sha, parent, id: (/^merge\(spec ([^)]+)\)/.exec(subject || '') || [])[1] || null }; });
  Object.assign(rec, { gate, candidate, base, merges: merges.map((m) => m.id) });
  const runAt = (sha, tag) => {
    const wt = addWorktree(repo, path.join(cfg.state, 'work', `nightly-${tag}`), sha);
    try {
      copyPaths(cfg.source || repo, wt, ['node_modules']);
      if (!fs.existsSync(path.join(wt, 'specs', gate, 'gate.sh'))) return { exit: 'absent' };
      return runCmd(ctx, gateCmd(wt, gate, browserGate(wt, gate)), wt, { minutes: cfg.merge.gate_minutes, tag: `nightly-${gate}` });
    } finally { removeWorktree(repo, wt); }
  };
  const flake = () => {
    appendJsonl(path.join(cfg.state, 'flakes.jsonl'), { t: ctx.clock().toISOString(), gate, item: null, nightly: true });
    ctx.report('flake', null, { gate, nightly: true });
    rec.verdict = 'flake';
    return done(0);
  };
  const resetTo = async (target, later, g, culprit) => {
    const from = gitOk(repo, 'rev-parse', `refs/heads/${cfg.staging}`);
    gitOk(repo, 'update-ref', `refs/heads/${cfg.staging}`, target);
    ctx.staging.merged = (ctx.staging.merged || []).filter((m) => m.merge && git(repo, 'merge-base', '--is-ancestor', m.merge, target).code === 0);
    writeJson(ctx.stagingFile, ctx.staging);
    const remerged = [];
    for (const l of later) {
      const it = l.id && ctx.item(l.id);
      if (!it) continue;
      it.state = 'approved';
      remerged.push({ id: it.id, outcome: await mergeItem(ctx, it, { push: false }) });
    }
    const p = pushStaging(ctx);
    if (culprit) {
      const it = ctx.item(culprit.id);
      if (it) {
        Object.assign(it, { state: 'sent-back', class: 'nightly-red', reason: `the nightly read ${g} red; it fails at this item's merge ${culprit.sha.slice(0, 8)}, passes just before, and no later merge touched the same files: back to its builder`, policy: classAction(ctx, 'nightly-red') });
        ctx.save(it);
        ctx.report('sent-back', it, { class: 'nightly-red', gate: g });
      }
    }
    ctx.report('reset', null, { from, to: target, gate: g, culprit: culprit ? culprit.id : null, remerged, push_exit: p.exit });
    Object.assign(rec, { verdict: culprit ? 'proven' : 'reset', culprit: culprit ? culprit.id : null, reset_to: target, remerged, push: p });
    return done(p.exit === 0 ? 0 : 1);
  };
  // nothing moves while the culprit is sought
  const rerun = runAt(candidate, 'candidate');
  rec.rerun_at_candidate = rerun.exit;
  if (rerun.exit === 0) return flake();
  let culprit = null;
  for (const m of merges) {
    m.exit = runAt(m.sha, m.sha.slice(0, 8)).exit;
    if (m.exit !== 0) { m.parent_exit = runAt(m.parent, `${m.sha.slice(0, 8)}-parent`).exit; if (m.parent_exit === 0) culprit = m; break; }
  }
  const later = culprit ? merges.slice(merges.indexOf(culprit) + 1) : [];
  const files = culprit ? gitOk(repo, 'diff', '--name-only', culprit.parent, culprit.sha).split('\n').filter(Boolean) : [];
  const overlap = later.flatMap((l) => gitOk(repo, 'diff', '--name-only', l.parent, l.sha).split('\n').filter((f) => files.includes(f)));
  rec.search = merges.map((m) => ({ id: m.id, exit: m.exit ?? null, parent_exit: m.parent_exit ?? null }));
  const proven = !!culprit && overlap.length === 0;
  if (!proven) {
    rec.verdict = 'not-proven';
    rec.why = culprit ? `a later merge touched the same files: ${[...new Set(overlap)].join(', ')}` : `${gate} does not pass just before any merge it fails at`;
    ctx.report('nightly-stop', null, { gate, why: rec.why });
    return done(3);
  }
  return resetTo(culprit.parent, later, gate, culprit);
}

// ── the release train (spec 067) ────────────────────────────────────────────────────────────────
const trainDir = (cfg) => path.join(cfg.state, 'train');
const holdFile = (cfg) => path.join(trainDir(cfg), 'HOLD');
const candidateFile = (cfg) => path.join(trainDir(cfg), 'candidate.json');
const short = (sha) => String(sha || 'none').slice(0, 8);
// The cutoff a time belongs to: the day of the latest 15:00 UTC at or before it.
const cutoffOf = (now) => (now.toISOString().slice(11, 16) >= CUTOFF ? now : new Date(now.getTime() - DAY)).toISOString().slice(0, 10);
function versionAt(repo, sha) {
  try { return JSON.parse(git(repo, 'show', `${sha}:package.json`).out).version || null; } catch { return null; }
}

// One of the inbox files, as the remote's inbox holds it, and the commit that last wrote it. A
// trailing newline is allowed; any other content is not a request or a go.
function readInbox(ctx, rel) {
  const ref = `refs/remotes/${ctx.cfg.remote}/${INBOX.ref}`;
  if (!git(ctx.repo, 'rev-parse', '--verify', '-q', ref).out) return null;
  const r = spawnSync('git', ['-C', ctx.repo, 'show', `${ref}:${rel}`], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const text = (r.stdout || '').replace(/\n$/, '');
  const commit = git(ctx.repo, 'log', '-1', '--format=%H', ref, '--', rel).out;
  if (rel === INBOX.request) return { commit, text, ok: text === 'release' };
  return { commit, text, ok: /^[0-9a-f]{40}$/.test(text), sha: text };
}

// A new candidate for a new cutoff; the one it replaces is kept under train/candidates/.
function writeCandidate(ctx, prev, next) {
  const { cfg } = ctx;
  if (prev && prev.cutoff_for !== next.cutoff_for && prev.phase !== 'released') {
    writeJson(path.join(trainDir(cfg), 'candidates', `${prev.cutoff_for}-${short(prev.sha)}.json`), { ...prev, superseded_at: ctx.clock().toISOString() });
  }
  writeJson(candidateFile(cfg), next);
  return next;
}
function pinned(ctx, sha, fields) {
  const at = ctx.clock().toISOString();
  ctx.report('train-pinned', null, { sha, cutoff_for: fields.cutoff_for, requested: fields.requested });
  return { ...fields, sha, phase: 'pinned', pinned_at: at, version: versionAt(ctx.repo, sha) };
}

// `train`: at the cutoff, pin the staging tip, or on a requested night queue the bump item. Once
// per cutoff: a second run for the same cutoff leaves the candidate. The train makes no commit.
async function trainCmd(cfg, opts) {
  const ctx = context(cfg, opts);
  const policy = readIntegratorPolicy(cfg);
  if (!policy.ok) { process.stderr.write(`integrate: refused (${policy.kind}): ${policy.detail}\n`); return 5; }
  if (fs.existsSync(cfg.stop_file)) { process.stderr.write(`integrate: the stop file ${cfg.stop_file} holds; the train pins nothing\n`); return 6; }
  ensureClone(ctx);
  const now = ctx.clock();
  const cutoffFor = cutoffOf(now);
  const prev = readJson(candidateFile(cfg), null);
  if (prev && prev.cutoff_for === cutoffFor) {
    process.stdout.write(`integrate: train: the cutoff of ${cutoffFor} already has its candidate ${short(prev.sha)} (${prev.phase})\n`);
    return 0;
  }
  const stagingTip = git(ctx.repo, 'rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${cfg.staging}`).out || gitOk(ctx.repo, 'rev-parse', `refs/remotes/${cfg.remote}/${cfg.base_ref}`);
  const usedFile = path.join(trainDir(cfg), 'requests.jsonl');
  const read = readInbox(ctx, INBOX.request);
  const request = { ...(read || {}), ok: !!(read && read.ok), used: !!read && jsonl(usedFile).some((x) => x.commit === read.commit) };
  if (read && !read.ok && !request.used) {
    appendJsonl(usedFile, { commit: read.commit, refused: true, text: read.text.slice(0, 80), at: now.toISOString() });
    ctx.report('train-request-refused', null, { commit: read.commit, why: `${INBOX.request} holds something other than the word release` });
  }
  const base = { cutoff_for: cutoffFor, staging_at_cutoff: stagingTip, cutoff_read: now.toISOString() };
  if (request.ok && !request.used) {
    // R-2: the bump goes in through the release process, as an item on the builder queue
    appendJsonl(usedFile, { commit: request.commit, cutoff_for: cutoffFor, at: now.toISOString() });
    const id = `release-bump-${cutoffFor.replace(/-/g, '')}`;
    if (!ctx.item(id)) {
      ctx.save({ id, tier: 'T1', changes_verdict: false, ships_publicly: true, brief: path.join(ROOT, BUMP_BRIEF_REL), state: 'queued', origin: 'release-request', request_commit: request.commit, queued_at: now.toISOString() });
      ctx.report('queued', { id }, { origin: 'release-request', tier: 'T1' });
    }
    writeCandidate(ctx, prev, { ...base, phase: 'awaiting-bump', requested: true, bump_item: id, request_commit: request.commit });
    process.stdout.write(`integrate: train: a release is requested for ${cutoffFor}; the bump item ${id} is queued and the candidate waits for its merge\n`);
    return 0;
  }
  const c = writeCandidate(ctx, prev, pinned(ctx, stagingTip, { ...base, requested: false }));
  process.stdout.write(`integrate: train: the candidate for ${cutoffFor} is ${short(c.sha)}, the staging tip, with no version bump\n`);
  return 0;
}

// A fast-forward of one ref on the remote: never forced; the remote's value, read by ls-remote just
// before, must be an ancestor. The message goes into the reflog of the integrator's clone.
function pushFastForward(ctx, ref, sha, message) {
  const { cfg, repo } = ctx;
  const full = `refs/heads/${ref}`;
  const ls = spawnSync('git', ['-C', repo, 'ls-remote', cfg.remote, full], { encoding: 'utf8', env: baseEnv() });
  if (ls.status !== 0) return { exit: ls.status, err: (ls.stderr || '').trim().slice(0, 300) };
  const lease = (ls.stdout || '').split(/\s/)[0] || '';
  if (lease && git(repo, 'merge-base', '--is-ancestor', lease, sha).code !== 0) return { exit: 1, lease, err: `${ref} on ${cfg.remote} is at ${short(lease)}, not an ancestor of ${short(sha)}: not a fast-forward` };
  gitOk(repo, 'update-ref', '-m', message, full, sha);
  const argv = ['push', '-q', cfg.remote, `${sha}:${full}`];
  const r = git(repo, ...argv);
  return { argv, lease, exit: r.code, err: r.err.slice(0, 300), pushed_at: iso(), reflog: git(repo, 'reflog', 'show', '-1', '--format=%gs', full).out };
}
// R-6a: the train's hold is raised, and the move waits, pass by pass, until no builder is alive.
function moveRef(ctx, ref, sha, message) {
  const { cfg } = ctx;
  if (!fs.existsSync(holdFile(cfg))) writeJson(holdFile(cfg), { ref, sha, raised: ctx.clock().toISOString(), by: 'scripts/integrate.mjs' });
  const live = ctx.items().filter((i) => i.state === 'building' && i.pid && alive(i.pid));
  if (live.length) {
    ctx.report('train-hold', null, { ref, waiting_for: live.map((i) => i.id) });
    return { waiting: { ref, builders: live.map((i) => i.id), at: ctx.clock().toISOString() } };
  }
  try { return pushFastForward(ctx, ref, sha, message); } finally { fs.rmSync(holdFile(cfg), { force: true }); }
}

// R-4: the night's record, read once; dev moves only on a full green record of the candidate
// written after the pin.
function readNight(ctx, c, save) {
  const { cfg } = ctx;
  const last = readJson(path.join(cfg.train.nightly_state, 'last.json'), null);
  if (!last || !last.at || !(Date.parse(last.at) >= Date.parse(c.pinned_at))) return null;
  if ((c.nights || []).some((x) => x.at === last.at)) return null;
  const result = readJson(path.resolve(cfg.train.nightly_state, String(last.run_dir || ''), 'result.json'), null);
  const night = { at: last.at, verdict: last.verdict, commit: last.commit, partial: last.partial || null, green: false };
  if (!result) night.why = 'the record names no readable result.json';
  else {
    const green = last.verdict === 'GREEN' && result.verdict === 'GREEN';
    const full = !last.partial && !result.partial;
    const ours = last.commit === c.sha && result.commit === c.sha;
    night.green = green && full && ours;
    night.why = night.green ? 'a full green nightly of the candidate' : !green ? `the nightly read ${last.verdict}` : !full ? 'a partial nightly is never the record' : `the nightly swept ${short(last.commit)}, not the candidate ${short(c.sha)}`;
  }
  (c.nights ||= []).push(night);
  if (!night.green) { save(); ctx.report('train-dev-held', null, { sha: c.sha, why: night.why }); return { did: 'dev-held', why: night.why }; }
  c.phase = 'green';
  save();
  return moveDev(ctx, c, save);
}
function moveDev(ctx, c, save) {
  const { cfg } = ctx;
  const r = moveRef(ctx, cfg.base_ref, c.sha, `train(${c.version || 'unversioned'}): ${cfg.base_ref} to the candidate ${c.sha} on a full green nightly of it (scripts/integrate.mjs)`);
  if (r.waiting) { c.waiting = r.waiting; save(); return { did: 'dev-waits', builders: r.waiting.builders }; }
  delete c.waiting;
  c.dev_move = { at: ctx.clock().toISOString(), pushed_at: r.pushed_at || null, lease: r.lease || null, exit: r.exit, err: r.err || null, reflog: r.reflog || null };
  if (r.exit !== 0) { c.phase = 'dev-refused'; save(); ctx.report('train-dev-refused', null, { sha: c.sha, err: r.err }); return { did: 'dev-refused', err: r.err }; }
  c.phase = 'dev-moved';
  save();
  ctx.report('train-dev-moved', null, { sha: c.sha, from: r.lease });
  return { did: 'dev-moved' };
}

// R-5: the public build of the candidate in <stage_root>/<sha>, its checks, a local tag. Never under
// a quiet marker or in the pre-nightly window; nothing is pushed.
function stageRelease(ctx, c, save) {
  const { cfg, repo } = ctx;
  if (ctx.gatesHalted()) return { did: 'stage-waits', why: 'a quiet marker or the pre-nightly window holds' };
  const dir = path.join(cfg.train.stage_root, c.sha);
  const version = c.version || 'unversioned';
  const message = `Driftproof ${version}: the release candidate ${c.sha}, staged by the train and held for the operator's go.`;
  const wt = addWorktree(repo, path.join(cfg.state, 'work', `stage-${short(c.sha)}`), c.sha);
  try {
    copyPaths(cfg.source || repo, wt, ['node_modules']);
    const r = runCmd(ctx, ['bash', 'scripts/build-public.sh', '--public-dir', dir, '-m', message], wt, { minutes: cfg.train.stage_minutes, tag: 'stage' });
    const figure = repoGateFigure(dir, REPO_GATE_DEFAULT, r);
    c.staged = { dir, exit: r.exit, figure, summary: r.summary, log: r.log, message, at: ctx.clock().toISOString() };
    if (!(r.exit === 0 && figure && figure.failed === 0)) {
      c.phase = 'stage-failed';
      save();
      ctx.report('train-stage-failed', null, { sha: c.sha, exit: r.exit, figure });
      return { did: 'stage-failed', exit: r.exit };
    }
    const tag = `candidate-${version}-${short(c.sha)}`;
    gitOk(repo, 'tag', '-f', '-a', tag, '-m', `the release candidate ${c.sha}, staged in ${dir}; the repository gate over the built tree read ${figure.passed} passed, ${figure.failed} failed (scripts/integrate.mjs)`, c.sha);
    c.staged.tag = tag;
    c.phase = 'staged';
    save();
    ctx.report('train-staged', null, { sha: c.sha, dir, figure, tag });
    return { did: 'staged', tag };
  } finally { removeWorktree(repo, wt); }
}

// R-6: the go on inbox, naming the candidate, moves main; any other go is refused, once.
function readGo(ctx, c, save) {
  if (c.phase === 'staged') {
    const go = readInbox(ctx, INBOX.go);
    if (!go) return null;
    const seen = (c.go_refused || []).some((g) => g.commit === go.commit) || (c.go && c.go.commit === go.commit);
    if (seen) return null;
    const refuse = (why) => {
      (c.go_refused ||= []).push({ commit: go.commit, text: go.text.slice(0, 80), why, at: ctx.clock().toISOString() });
      save();
      ctx.report('train-go-refused', null, { sha: c.sha, why });
      return { did: 'go-refused', why };
    };
    if (!go.ok) return refuse(`${INBOX.go} holds something other than a 40-character SHA`);
    if (go.sha !== c.sha) {
      return refuse(`the go names ${short(go.sha)}, not the candidate ${short(c.sha)}`);
    }
    c.phase = 'go-held';
    c.go = { commit: go.commit, read: ctx.clock().toISOString() };
    save();
  }
  const f = c.staged.figure;
  const r = moveRef(ctx, 'main', c.sha, `release(${c.version || 'unversioned'}): main to ${c.sha} at the operator's go; the repository gate over the staged build read ${f.passed} passed, ${f.failed} failed; local tag ${c.staged.tag} (scripts/integrate.mjs)`);
  if (r.waiting) { c.waiting = r.waiting; save(); return { did: 'main-waits', builders: r.waiting.builders }; }
  delete c.waiting;
  c.main_move = { at: ctx.clock().toISOString(), pushed_at: r.pushed_at || null, lease: r.lease || null, exit: r.exit, err: r.err || null, reflog: r.reflog || null };
  if (r.exit !== 0) { c.phase = 'main-refused'; save(); ctx.report('train-main-refused', null, { sha: c.sha, err: r.err }); return { did: 'main-refused', err: r.err }; }
  c.phase = 'released';
  // Q-2 (a): the go moves main only; the rest stays the RUNBOOK's
  c.owed = [
    `the public push of the staged build, by RUNBOOK § Publish to npm, with --force-with-lease=main:<the SHA ls-remote reads just before>`,
    `the tag push, by RUNBOOK § Publish to npm`,
    'npm publish, by a human: this box holds no npm credential',
  ];
  save();
  ctx.report('train-released', null, { sha: c.sha, reflog: r.reflog, owed: c.owed });
  return { did: 'main-moved' };
}

// One step of the train per pass, by its phase.
function trainStep(ctx) {
  const c = readJson(candidateFile(ctx.cfg), null);
  if (!c) return null;
  const save = () => writeJson(candidateFile(ctx.cfg), c);
  if (c.phase === 'awaiting-bump') {
    const it = ctx.item(c.bump_item);
    if (!it || it.state !== 'merged' || !it.staging_after) return null;
    Object.assign(c, pinned(ctx, it.staging_after, { requested: true }));
    save();
    return { did: 'pinned', sha: c.sha };
  }
  if (c.phase === 'pinned') return readNight(ctx, c, save);
  if (c.phase === 'green') return moveDev(ctx, c, save);
  if (c.phase === 'dev-moved') return stageRelease(ctx, c, save);
  if (c.phase === 'staged' || c.phase === 'go-held') return readGo(ctx, c, save);
  return null;
}

// The night's sweep record, handed once to `nightly` (spec 066), which closes the window and handles
// a red; not while a dev move waits, so the window holds until dev has moved.
async function nightHandoff(ctx, opts) {
  const { cfg } = ctx;
  const last = readJson(path.join(cfg.train.nightly_state, 'last.json'), null);
  if (!last || !last.at) return null;
  const f = path.join(trainDir(cfg), 'night-read.json');
  if ((readJson(f, {}) || {}).at === last.at) return null;
  if ((readJson(candidateFile(cfg), {}) || {}).phase === 'green') return { at: last.at, waits: 'the dev move waits for builders' };
  writeJson(f, { at: last.at, read: ctx.clock().toISOString() });
  const sweep = path.resolve(cfg.train.nightly_state, String(last.run_dir || ''), 'sweep-run.json');
  if (!fs.existsSync(sweep)) return { at: last.at, sweep: null };
  return { at: last.at, exit: await nightly(cfg, { now: opts.now, result: sweep }) };
}

// R-8: the processes working inside a directory, by their working directory or a path on their
// command line; this process and its ancestors are not counted.
function processesIn(dir) {
  const real = fs.realpathSync(dir);
  const inside = (p) => p === real || p.startsWith(real + path.sep);
  const parent = (pid) => { try { return Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')[1]); } catch { return 0; } };
  const mine = new Set([process.pid]);
  for (let p = parent(process.pid); p > 1; p = parent(p)) mine.add(p);
  const out = [];
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    const pid = Number(d);
    if (mine.has(pid)) continue;
    let cwd = null;
    let argv = [];
    try { cwd = fs.readlinkSync(`/proc/${pid}/cwd`); } catch {}
    try { argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch {}
    if ((cwd && inside(cwd)) || argv.some((a) => path.isAbsolute(a) && inside(a))) out.push({ pid, cmd: argv.join(' ').slice(0, 140) });
  }
  return out;
}
// R-8: the operator's checkout follows dev when it is on dev, idle and clean; otherwise the pass
// records why. Null when dev has not moved past it.
function fastForwardCheckout(ctx) {
  const { cfg } = ctx;
  const co = cfg.train.checkout;
  if (!fs.existsSync(path.join(co, '.git'))) return { moved: false, why: `no checkout at ${co}` };
  const dev = git(ctx.repo, 'rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${cfg.base_ref}`).out;
  const head = git(co, 'rev-parse', 'HEAD').out;
  if (!dev || head === dev) return null;
  const rec = { from: head, to: dev, moved: false };
  const branch = git(co, 'symbolic-ref', '-q', '--short', 'HEAD').out;
  if (branch !== cfg.base_ref) return { ...rec, why: `the checkout is on ${branch || 'a detached HEAD'}, not ${cfg.base_ref}` };
  const busy = processesIn(co);
  if (busy.length) return { ...rec, why: `busy: ${busy.length} process(es) work inside the checkout`, pids: busy.map((p) => p.pid), cmds: busy.map((p) => p.cmd).slice(0, 5) };
  const dirty = git(co, 'status', '--porcelain', '--untracked-files=all').out;
  if (dirty) return { ...rec, why: `dirty: ${dirty.split('\n').length} path(s) changed or untracked`, paths: dirty.split('\n').slice(0, 5) };
  const remoteRef = `refs/remotes/${cfg.remote}/${cfg.base_ref}`;
  const f = git(co, 'fetch', '-q', cfg.remote, `+refs/heads/${cfg.base_ref}:${remoteRef}`);
  if (f.code !== 0) return { ...rec, why: `the fetch failed: ${f.err.slice(0, 200)}` };
  if (git(co, 'merge-base', '--is-ancestor', 'HEAD', remoteRef).code !== 0) return { ...rec, why: `${cfg.base_ref} on ${cfg.remote} is not a fast-forward of the checkout` };
  const m = git(co, 'merge', '-q', '--ff-only', remoteRef);
  if (m.code !== 0) return { ...rec, why: `the fast-forward failed: ${m.err.slice(0, 200)}` };
  const after = git(co, 'rev-parse', 'HEAD').out;
  ctx.report('checkout-moved', null, { checkout: co, from: head, to: after });
  return { ...rec, to: after, moved: true };
}

// One pass of the service. Under a quiet marker or the stop file only `tick` runs, and its own halt
// stops running builders and starts and merges nothing (R-10).
async function servePass(cfg, opts, n) {
  const ctx = context(cfg, opts);
  const pass = { n, now: ctx.record.now, started: iso(), halted: null, quiet: [], train: null, nightly: null, tick: null, checkout: null };
  const file = path.join(cfg.state, 'serve', `${new Date().toISOString().replace(/[-:]/g, '')}-${process.pid}-${String(n).padStart(4, '0')}.json`);
  const done = () => { pass.ended = iso(); writeJson(file, pass); process.stdout.write(`integrate: serve pass ${n}: ${pass.halted ? `halted (${pass.halted})` : `train ${pass.train ? pass.train.did : 'idle'}; checkout ${pass.checkout ? (pass.checkout.moved ? 'moved' : pass.checkout.why) : 'current'}`}\n`); };
  const policy = readIntegratorPolicy(cfg);
  if (!policy.ok) { pass.halted = `refused (${policy.kind})`; done(); return; }
  ctx.policy = policy;
  const quiet = ctx.quiet();
  pass.quiet = quiet;
  if (quiet.length || fs.existsSync(cfg.stop_file)) {
    pass.halted = quiet.length ? `quiet marker ${quiet.join(', ')}` : 'the stop file';
    pass.tick = await tick(cfg, opts);
    done();
    return;
  }
  ensureClone(ctx);
  pass.train = trainStep(ctx);
  pass.nightly = await nightHandoff(ctx, opts);
  pass.tick = await tick(cfg, opts);
  ensureClone(ctx);
  pass.checkout = fastForwardCheckout(ctx);
  done();
}

// `serve`: the service's loop. SIGTERM ends it after the current pass.
async function serve(cfg, opts) {
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  const t0 = Date.now();
  const interval = 1000 * Number(opts.interval ?? cfg.train.interval_seconds);
  const passes = opts.passes ? Number(opts.passes) : Infinity;
  for (let n = 1; ; n++) {
    const now = opts.now ? new Date(Date.parse(opts.now) + (Date.now() - t0)).toISOString() : null;
    await servePass(cfg, { ...opts, now }, n);
    if (stopping || n >= passes) break;
    for (let t = 0; t < interval && !stopping; t += 200) await sleep(Math.min(200, interval - t));
  }
  return 0;
}

function pinPolicy(cfg) {
  const text = fs.readFileSync(cfg.policy, 'utf8');
  fs.mkdirSync(cfg.state, { recursive: true });
  fs.writeFileSync(path.join(cfg.state, 'policy.sha256'), `${sha256(text)}\n`);
  process.stdout.write(`integrate: pinned the policy file's digest ${sha256(text).slice(0, 12)}\n`);
  return 0;
}

function status(cfg) {
  const ctx = context(cfg, {});
  for (const it of ctx.items().sort((a, b) => String(a.queued_at).localeCompare(String(b.queued_at)))) process.stdout.write(`  ${it.id.padEnd(40)} ${String(it.state).padEnd(18)} ${it.class || ''}\n`);
  return 0;
}

async function main(argv) {
  const [cmd, file, ...rest] = argv;
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  if (!['tick', 'nightly', 'train', 'serve', 'pin-policy', 'status'].includes(cmd) || !file) {
    process.stderr.write('usage: node scripts/integrate.mjs tick <config.json> [--now <iso>] [--wait]\n       node scripts/integrate.mjs nightly <config.json> --result <sweep-run.json> [--now <iso>]\n       node scripts/integrate.mjs train <config.json> [--now <iso>]\n       node scripts/integrate.mjs serve <config.json> [--now <iso>] [--passes <n>] [--interval-seconds <s>]\n       node scripts/integrate.mjs pin-policy <config.json>\n       node scripts/integrate.mjs status <config.json>\n');
    return 2;
  }
  const cfg = loadConfig(file);
  if (cmd === 'pin-policy') return pinPolicy(cfg);
  if (cmd === 'status') return status(cfg);
  if (cmd === 'nightly') {
    if (!opt('--result')) { process.stderr.write('integrate: nightly needs --result <sweep-run.json>\n'); return 2; }
    return nightly(cfg, { now: opt('--now'), result: path.resolve(opt('--result')) });
  }
  if (cmd === 'train') return trainCmd(cfg, { now: opt('--now') });
  if (cmd === 'serve') return serve(cfg, { now: opt('--now'), passes: opt('--passes'), interval: opt('--interval-seconds') });
  return tick(cfg, { now: opt('--now'), wait: rest.includes('--wait') });
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`integrate: ${e.stack || e.message}\n`); process.exit(1); });
